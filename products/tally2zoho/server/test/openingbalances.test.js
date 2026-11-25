// The opening balance batch: every balance of an account that is not a customer or vendor is in the dated opening
// balance journal (OB-1); customers in credit and vendors in debit are carried by journal OB-2; one balance stays in the
// Chart of Accounts file so that Zoho Books can save its Opening Balance Date; the Migration Date step is checked from
// the date Zoho Books shows and hard-locks every later file; the last check explains Opening Balance Adjustments.
// Every name and amount here is MADE UP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Decimal from 'decimal.js';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-opening-'));
const { buildApp } = await import('../src/index.js');
const { TEMPLATES, parseCsv, migrationDateOf, contactCreditOpeningRow, contactCreditBalancingRow, profitAndLossOpeningRow, isCreditCardLedger, ledgerAccountType, openingBalanceForJournal } = await import('../src/zoho.js');
const { readTypedDate, dateStepLines, RULES } = await import('../src/importwizard.js');
const { periodWarning, explainAdjustment } = await import('../src/zohotb.js');
const { explainErrorRows } = await import('../src/zohoerrors.js');
const { checkFiles } = await import('../src/zohocheck.js');
const { ASSUMPTIONS } = await import('../src/defaults.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const samples = path.resolve(here, '../../sample-data');
const SAMPLE_FILES = { taxes: '06_tax_configuration.json', sales: '07_sales_vouchers.json', purchase: '08_purchase_vouchers.json', receipt: '09_receipt_vouchers.json', payment: '10_payment_vouchers.json', journal: '11_journal_vouchers.json', trial_balance: '13_trial_balance.json' };
const seed = JSON.parse(fs.readFileSync(path.resolve(here, '../seed-users.json'), 'utf8'));
const D = v => new Decimal(v);

// ---------- the rows ----------
test('journal OB-2: a customer in credit and a vendor in debit are lines with their Contact Name; another currency is not carried', () => {
  const ctx = { accountTypes: {}, groupParents: {}, asOf: '20250331', openingJournalDate: '2024-03-31' };
  const cust = (name, ob, extra = {}) => ({ metadata: { type: 'Ledger', name }, name, parent: 'Sundry Debtors', openingbalance: ob, ...extra });
  const vend = (name, ob, extra = {}) => ({ metadata: { type: 'Ledger', name }, name, parent: 'Sundry Creditors', openingbalance: ob, ...extra });
  const a = contactCreditOpeningRow(cust('Aspen Mart', '250'), ctx, 'customer');
  assert.deepEqual([a.row['Journal Date'], a.row['Journal Number Prefix'], a.row['Journal Number Suffix'], a.row.Account, a.row['Contact Name'], a.row.Debit, a.row.Credit, a.row.Status, a.row.Currency],
    ['2024-03-31', 'OB-', '2', 'Accounts Receivable', 'Aspen Mart', '', '250.00', 'published', 'INR']);
  const b = contactCreditOpeningRow(vend('Hazel Works', '-150'), ctx, 'vendor');
  assert.deepEqual([b.row.Account, b.row['Contact Name'], b.row.Debit, b.row.Credit], ['Accounts Payable', 'Hazel Works', '150.00', '']);
  // the usual side stays in the contact's Opening Balance column, never in the journal (no double count)
  assert.equal(contactCreditOpeningRow(cust('Birch Retail', '-800'), ctx, 'customer'), null);
  assert.equal(contactCreditOpeningRow(vend('Larch Supply', '1100'), ctx, 'vendor'), null);
  assert.equal(contactCreditOpeningRow(cust('No Balance', '0'), ctx, 'customer'), null);
  // another currency: the journal is in rupees, so it is not carried, and the flag says so under another kind
  const usd = cust('Yew Global', '90', { currencyname: 'USD' });
  assert.equal(contactCreditOpeningRow(usd, ctx, 'customer'), null);
  assert.equal(TEMPLATES.customers.row(usd, ctx)['Opening Balance'], '');
  assert.deepEqual(TEMPLATES.customers.check(usd, ctx).filter(f => /balance_unusual_side/.test(f.kind)).map(f => f.kind), ['balance_unusual_side_not_carried']);
  // contacts treated as one party: the merged total decides, and it is the amount written
  const merged = { ...ctx, mergedBalances: { 'Aspen Mart': [{ ledger: 'Aspen Mart (old)', amount: '100' }] } };
  assert.equal(contactCreditOpeningRow(cust('Aspen Mart', '250'), merged, 'customer').row.Credit, '350.00');
  assert.equal(contactCreditOpeningRow(cust('Aspen Mart', '-250'), { ...ctx, mergedBalances: { 'Aspen Mart': [{ ledger: 'Aspen Mart (old)', amount: '100' }] } }, 'customer'), null, 'net debit: the usual side');
  // the journal balances on Opening Balance Adjustments, and each journal of the file is checked on its own
  const other = contactCreditBalancingRow([a.amount, b.amount], ctx);
  assert.deepEqual([other.Account, other['Journal Number Suffix'], other.Debit, other.Credit, other['Contact Name'] ?? ''], ['Opening Balance Adjustments', '2', '100.00', '', '']);
  assert.equal(contactCreditBalancingRow([D('250'), D('-250')], ctx), null);
  const check = TEMPLATES.opening_balances_for_zoho_accounts.fileCheck;
  assert.equal(check([a.row, b.row, other]), null);
  assert.match(check([a.row, b.row]), /journal OB-2 does not balance: total debit 150\.00, total credit 250\.00/);
  const ob1 = { 'Journal Number Suffix': '1', Debit: '10.00', Credit: '' };
  assert.match(check([ob1, a.row, b.row, other]), /^The opening balance journal does not balance: total debit 10\.00, total credit 0\.00\.$/, 'OB-1 is not hidden by a balanced OB-2');
  // it is listed as an assumption, not as something an accountant must decide
  assert.ok(ASSUMPTIONS.balance_unusual_side && ASSUMPTIONS.opening_date_anchor && ASSUMPTIONS.bank_ledger_as_credit_card);
});

test('one Migration Date for the journal and the wizard; a credit card under Bank Accounts needs two signs; Profit & Loss goes to Retained Earnings', () => {
  assert.deepEqual(migrationDateOf('', '2024-04-01'), { date: '2024-03-31', chosen: false, default: '2024-03-31' });
  assert.deepEqual(migrationDateOf(undefined, '2025-01-01'), { date: '2024-12-31', chosen: false, default: '2024-12-31' }, 'any financial year, not only April to March');
  assert.deepEqual(migrationDateOf('2024-03-30', '2024-04-01'), { date: '2024-03-30', chosen: true, default: '2024-03-31' });
  assert.deepEqual(migrationDateOf('30/03/2024', '2024-04-01'), { date: '2024-03-31', chosen: false, default: '2024-03-31' }, 'not a date: the default');
  const ctx = { accountTypes: {}, groupParents: {}, openingJournalDate: '2024-03-31' };
  const led = (name, parent, ob) => ({ name, parent, openingbalance: ob });
  // a card: the name says credit card AND the balance is a credit
  assert.equal(ledgerAccountType(led('Travel Credit Card', 'Bank Accounts', '700'), ctx), 'Credit Card');
  assert.ok(isCreditCardLedger(led('Staff Credit Cards', 'Bank Accounts', '5'), ctx));
  // one sign alone is not enough: an overdrawn bank account, a card with a debit balance, a name that only looks like one
  for (const d of [led('Town Bank', 'Bank Accounts', '700'), led('Travel Credit Card', 'Bank Accounts', '-700'), led('Travel Credit Card', 'Bank Accounts', '0'), led('Town Bank CC', 'Bank Accounts', '700'), led('Credit Card Charges', 'Indirect Expenses', '700')]) {
    assert.equal(isCreditCardLedger(d, ctx), false, d.name);
  }
  assert.equal(ledgerAccountType(led('Town Bank', 'Bank Accounts', '700'), ctx), 'Bank');
  // a type decided for the group in Mapping Studio always wins
  assert.equal(ledgerAccountType(led('Travel Credit Card', 'Bank Accounts', '700'), { ...ctx, accountTypes: { 'Bank Accounts': 'Bank' } }), 'Bank');
  const kinds = d => [].concat(TEMPLATES.accounts.check(d, ctx)).map(f => f.kind);
  assert.deepEqual(kinds(led('Travel Credit Card', 'Bank Accounts', '700')), ['opening_balance_in_journal', 'bank_ledger_as_credit_card']);
  assert.deepEqual(kinds(led('Town Bank', 'Bank Accounts', '700')), ['opening_balance_in_journal', 'bank_ledger_credit_balance'], 'a credit balance on a bank ledger is said, not guessed');
  assert.deepEqual(kinds(led('Town Bank', 'Bank Accounts', '-700')), ['opening_balance_in_journal']);
  // overdraft and cash credit groups are bank accounts, and cash goes through the journal like a bank account
  assert.deepEqual(['Bank OD A/c', 'Bank OCC A/c', 'Cash-in-Hand'].map(g => TEMPLATES.accounts.row(led('X', g, '-10'), ctx)['Account Type']), ['Bank', 'Bank', 'Cash']);
  for (const g of ['Bank OD A/c', 'Bank OCC A/c', 'Cash-in-Hand', 'Capital Account', 'Fixed Assets', 'Indirect Expenses']) {
    assert.equal(TEMPLATES.accounts.row(led('X', g, '-10'), ctx)['Opening Balance'], '', g);
    assert.equal(openingBalanceForJournal(led('X', g, '-10'), ctx).toFixed(2), '-10.00', g);
  }
  // (changed on purpose, round 2) a Stock balance goes to the journal (OB-3) and never stays in the Chart of Accounts,
  // so it cannot lock the Opening Balance Date (COA-STOCK-OB-LOCKS-DATE); the date anchor is in neither twice
  assert.equal(openingBalanceForJournal(led('Goods', 'Stock-in-Hand', '-10'), ctx).toFixed(2), '-10.00');
  assert.equal(TEMPLATES.accounts.row(led('Goods', 'Stock-in-Hand', '-10'), ctx)['Opening Balance'], '');
  for (const mode of ['chart', 'typed']) assert.equal(openingBalanceForJournal(led('Capital', 'Capital Account', '10'), { ...ctx, openingAnchor: { name: 'Capital', mode } }), null, mode);
  assert.equal(TEMPLATES.accounts.row(led('Capital', 'Capital Account', '10'), { ...ctx, openingAnchor: { name: 'Capital', mode: 'typed' } })['Opening Balance'], '', 'a typed anchor is in no file');
  assert.deepEqual([].concat(TEMPLATES.accounts.check(led('Capital', 'Capital Account', '10'), { ...ctx, openingAnchor: { name: 'Capital', mode: 'chart' } })).map(f => f.kind), ['opening_date_anchor']);
  assert.deepEqual([].concat(TEMPLATES.accounts.check(led('Town Bank', 'Bank Accounts', '-10'), { ...ctx, openingAnchor: { name: 'Town Bank', mode: 'typed' } })).map(f => f.kind), ['opening_date_balance_to_type']);
  const pl = profitAndLossOpeningRow({ name: 'Profit & Loss A/c', openingbalance: '5410' }, ctx);
  assert.deepEqual([pl.Account, pl.Debit, pl.Credit, pl['Journal Number Suffix'], pl['Journal Date']], ['Retained Earnings', '', '5410.00', '1', '2024-03-31']);
});

// ---------- the Migration Date step ----------
test('the date Zoho Books shows is read as typed; the step text says what depends on it and never asks to type and reset a balance', () => {
  assert.deepEqual(['2025-03-31', '31/03/2025', '31-03-2025', '31.03.2025', '31 Mar 2025', '1 April 2025', ' 31/3/2025 '].map(readTypedDate), ['2025-03-31', '2025-03-31', '2025-03-31', '2025-03-31', '2025-03-31', '2025-04-01', '2025-03-31']);
  assert.deepEqual(['', '31/02/2025', '2025-13-01', 'March', '31/03/25', null].map(readTypedDate), [null, null, null, null, null, null]);
  const step = RULES.import_order.find(o => o.kind === 'date');
  assert.match(step.do, /click Edit/);
  assert.match(step.do, /Type no balance/);
  assert.match(step.do, /does not let the date be changed once customer or vendor opening balances exist/);
  assert.doesNotMatch(step.do, /set it back|type any one|bank account is the simplest/i);
  const edit = dateStepLines({ mode: 'edit', date: { nice: '31/12/2024' }, dependsOn: [{ module: 'Customers', rows: 1 }, { module: 'Vendors', rows: 3 }], balancesToType: [] }).join('\n');
  assert.match(edit, /1 opening balance in Customers and 3 opening balances in Vendors/);
  assert.match(edit, /type NO balance/);
  assert.match(edit, /only when that date is 31\/12\/2024/);
  // the last check asks for the date, Sync and a trial balance that starts before the date
  const fin = RULES.import_order.find(o => o.kind === 'check' && !/bank/i.test(o.what)).do;
  assert.match(fin, /check that the date it shows is the Migration Date/);
  assert.match(fin, /From date before the Migration Date/);
  // the Chart of Accounts advice for "Row already exists" no longer tells to rename or to type a balance
  const msg = RULES.lists.error_messages.find(e => /Row already exists/.test(e.pattern));
  assert.match(msg.fix, /Do not rename the ledger and do not type a balance/);
});

// ---------- the Zoho check ----------
test('Zoho check: contact rows with an opening balance are a step to do first until the date is checked; dated rows are compared with the date Zoho shows', () => {
  const CUS = ['Display Name', 'GST Treatment', 'Place Of Contact', 'Opening Balance', 'Status'];
  const rows = [['Birch Retail', 'consumer', 'KA', '800.00', 'Active'], ['Aspen Mart', 'consumer', 'KA', '', 'Active'], ['Cedar Stores', 'consumer', 'KA', '5.00', 'Active']];
  const run = options => checkFiles({ customers: { headers: CUS, rows } }, { homeState: 'KA', ...options }).files[0];
  const cause = f => f.causes.find(c => c.ruleId === 'CUS-OPENING-BALANCE-DATE');
  // not checked yet: the two rows with a balance (not the whole file), as a step to do first; no row is counted as refused
  let f = run({ openingDateConfirmed: false, migrationDate: '2024-03-31', zohoOpeningDate: '' });
  assert.deepEqual([cause(f).rows, cause(f).tier, cause(f).preStep.where, f.rowsWill], [2, 'warning', 'Import Wizard, step "Save the Migration Date"', 0]);
  assert.match(cause(f).note || cause(f).message, /Migration Date/);
  // Zoho shows another date: said in the note
  f = run({ openingDateConfirmed: false, migrationDate: '2024-03-31', zohoOpeningDate: '2026-11-14' });
  assert.equal(cause(f).rows, 2);
  // checked, or no wizard answer at all (the engine used on its own): nothing
  assert.equal(cause(run({ openingDateConfirmed: true })), undefined);
  assert.equal(cause(run({})), undefined);
  // journals on or before the Opening Balance Date Zoho shows need Sync: flagged only when that date is known
  const JRN = ['Journal Date', 'Journal Number Prefix', 'Journal Number Suffix', 'Notes', 'Journal Type', 'Currency', 'Account', 'Description', 'Contact Name', 'Debit', 'Credit', 'Status'];
  const jl = (date, n, account, dr, cr) => [date, 'JV-', String(n), 'made up', 'both', 'INR', account, '', '', dr, cr, 'published'];
  const journals = { headers: JRN, rows: [jl('2024-03-31', 1, 'Office Rent', '10.00', ''), jl('2024-03-31', 1, 'Rent Due', '', '10.00'), jl('2024-04-05', 2, 'Office Rent', '7.00', ''), jl('2024-04-05', 2, 'Rent Due', '', '7.00')] };
  const sync = options => checkFiles({ journals }, { homeState: 'KA', ...options }).files[0].causes.find(c => c.ruleId === 'JRN-BEFORE-OPENING-DATE-NEEDS-SYNC');
  assert.equal(sync({}), undefined, 'the date Zoho shows is not known: the rule cannot be checked');
  assert.deepEqual([sync({ zohoOpeningDate: '2024-03-31' }).rows, sync({ zohoOpeningDate: '2024-03-31' }).tier], [2, 'warning']);
  assert.equal(sync({ zohoOpeningDate: '2026-11-14' }).rows, 4, 'the date was never changed: every journal is before it');
});

// ---------- the last check ----------
test('the trial balance check: both dates against the export, and what Opening Balance Adjustments is made of', () => {
  const p = { from: '2024-04-01', to: '2025-03-31' };
  assert.equal(periodWarning(null, '2024-03-31', '2024-03-31').warning, null);
  assert.equal(periodWarning({ from: '2023-04-01', to: '2025-03-31' }, '2024-03-31', '2024-03-31').warning, null);
  assert.match(periodWarning(p, '2024-03-31').warning, /starts on 2024-04-01, after the opening balance date 2024-03-31/);
  // Zoho's own date after the end of the export: the contacts' balances are outside it
  const late = periodWarning({ from: '2023-04-01', to: '2025-03-31' }, '2024-03-31', '2026-11-14').warning;
  assert.match(late, /Zoho Books shows the Opening Balance Date 2026-11-14, which is after the end of this export \(2025-03-31\)/);
  assert.match(periodWarning(p, '2024-03-31', '2024-01-01').warning, /2024-01-01, which is before the start of this export/);
  // what each source puts on Opening Balance Adjustments (a credit is positive)
  const groups = [
    { key: 'customers', label: 'the opening balances of the Customers file', amount: D('800') },
    { key: 'vendors', label: 'the opening balances of the Vendors file', amount: D('-1100') },
    { key: 'accounts', label: 'the opening balances of the Chart of Accounts file', amount: D('300') },
    { key: 'journal_ob1', label: 'the opening balance journal OB-1', amount: D('190') },
    { key: 'journal_ob2', label: 'the journal OB-2 of customer and vendor advances', amount: D('-190') },
  ];
  const singles = [{ key: 'customers', label: 'Customers', name: 'Birch Retail', amount: D('500') }, { key: 'customers', label: 'Customers', name: 'Cedar Stores', amount: D('300') }, { key: 'vendors', label: 'Vendors', name: 'Larch Supply', amount: D('-1100') }];
  assert.deepEqual([explainAdjustment(D('0'), groups, singles).cause, explainAdjustment(D('0'), groups, singles).words], ['none', 'Opening Balance Adjustments is zero, as it should be.']);
  // the contacts' balances are not in the report (the date was not saved): exactly those two files
  let x = explainAdjustment(D('300'), groups, singles);
  assert.deepEqual([x.cause, x.missing], ['groups', ['the opening balances of the Customers file', 'the opening balances of the Vendors file']]);
  assert.match(x.words, /Opening Balance Adjustments shows 300\.00 Cr\. That is exactly what is left when the opening balances of the Customers file and the opening balances of the Vendors file are not in this report/);
  assert.match(x.words, /check that date on Settings > Setup & Configurations > Opening Balances/);
  // the journal was not imported
  x = explainAdjustment(D('-190'), groups, singles);
  assert.deepEqual([x.cause, x.missing], ['groups', ['the opening balance journal OB-1']]);
  // one customer row did not reach Zoho
  x = explainAdjustment(D('-500'), groups, singles);
  assert.deepEqual([x.cause, x.missing], ['single', ['Birch Retail']]);
  assert.match(x.words, /exactly the opening balance of one row of the Customers file: "Birch Retail"/);
  // nothing fits: said plainly, with what to check
  x = explainAdjustment(D('12.34'), groups, singles);
  assert.equal(x.cause, 'unknown');
  assert.match(x.words, /cannot tie this to one file/);
  // Tally's own opening balances do not add up: that is what is left, and it is not a fault of the import
  x = explainAdjustment(D('25'), [...groups, { key: 'journal_ob1b', label: 'x', amount: D('25') }], singles);
  assert.equal(x.cause, 'none');
  assert.match(x.words, /Tally's own opening balances do not add up to zero/);
});

// ---------- Zoho's error file ----------
test('"Row already exists" on the Chart of Accounts: a second import is told apart from one of Zoho\'s own accounts, and no balance is typed', () => {
  const names = Array.from({ length: 60 }, (_, i) => `Made Up Ledger ${i + 1}`);
  const rows = names.map((id, i) => ({ n: i + 2, m: 'Row already exists', id }));
  const out = explainErrorRows(rows, { key: 'accounts' });
  assert.equal(out.causes.length, 1);
  assert.deepEqual([out.causes[0].rows, out.causes[0].alreadyExists, out.causes[0].place.label], [60, 'earlier_import', 'Import Wizard']);
  assert.match(out.causes[0].fix, /do NOT rename the ledger, do NOT import it again, and do NOT type its opening balance/);
  assert.match(out.causes[0].fix, /Enter it only if it is missing/);
  assert.match(out.note, /second import of the same Chart of Accounts file: 60 of the 60 refused rows/);
  // one of Zoho's own accounts keeps the advice to decide it under Zoho's own accounts, in a cause of its own
  const mixed = explainErrorRows([...rows.slice(0, 3), { n: 99, m: 'Row already exists', id: 'Undeposited Funds' }], { key: 'accounts' });
  assert.deepEqual(mixed.causes.map(c => [c.alreadyExists, c.rows]).sort(), [['earlier_import', 3], ['zoho_own_account', 1]]);
  const own = mixed.causes.find(c => c.alreadyExists === 'zoho_own_account');
  assert.match(own.fix, /Zoho's own accounts/);
  assert.doesNotMatch(own.fix, /Enter its opening balance/);
  assert.equal(explainErrorRows([{ n: 2, m: 'Row already exists', id: 'Undeposited Funds' }], { key: 'accounts' }).note, undefined);
});

// ---------- end to end ----------
const app = buildApp();
let cookie = '';
const call = opts => app.inject({ ...opts, headers: { ...(opts.headers || {}), ...(cookie ? { cookie } : {}) } });
const get = async url => { const r = await call({ url }); assert.equal(r.statusCode, 200, `${url}: ${r.body}`); return r.json(); };
const send = (method, url, payload) => call({ method, url, ...(payload !== undefined ? { payload } : {}) });
const login = async role => {
  const u = seed.users.find(x => x.role === role);
  cookie = String((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: u.password } })).headers['set-cookie']).split(';')[0];
};
const ledger = (name, parent, openingbalance, extra = {}) => ({ metadata: { type: 'Ledger', name }, name, ...(parent ? { parent } : {}), ...(openingbalance != null ? { openingbalance } : {}), ...extra });
const putDoc = (base, slot, records) => call({ method: 'PUT', url: `${base}/uploads/${slot}`, headers: { 'content-type': 'application/octet-stream', 'x-filename': `${slot}.json` }, payload: Buffer.from(JSON.stringify({ tallymessage: records })) });
async function migration({ accounts, customers, vendors }) {
  const company = seed.users.find(x => x.role === 'viewer').company || 'Sample Masters Co';
  const id = (await send('POST', '/api/migrations', { company, financialYear: '2024-25' })).json().id;
  const base = `/api/migrations/${id}`;
  for (const [slot, records] of [['accounts', accounts], ['customers', customers], ['vendors', vendors]]) assert.equal((await putDoc(base, slot, records)).statusCode, 200, slot);
  // the datasets a migration must have, from the made-up sample data (their vouchers name other ledgers: they do not matter here)
  for (const [slot, file] of Object.entries(SAMPLE_FILES)) {
    const u = await call({ method: 'PUT', url: `${base}/uploads/${slot}`, headers: { 'content-type': 'application/octet-stream', 'x-filename': file }, payload: fs.readFileSync(path.join(samples, file)) });
    assert.equal(u.statusCode, 200, `${slot}: ${u.body}`);
  }
  for (const s of (await get(`${base}/completeness`)).slots.filter(x => x.requirement !== 'optional' && x.status === 'missing')) await send('PUT', `${base}/waivers/${s.key}`, { reason: 'Made-up company: masters only' });
  const p = await send('POST', `${base}/process?wait=1`);
  assert.equal(p.statusCode, 200, p.body);
  const g = await send('POST', `${base}/generate`);
  assert.equal(g.statusCode, 200, g.body);
  const csv = async key => { const r = await call({ url: `${base}/files/${key}/download?confirmed=1` }); return r.statusCode === 200 ? parseCsv(r.body).rows : null; };
  return { base, files: Object.fromEntries(g.json().files.map(f => [f.key, f])), csv };
}
const step = (w, id) => w.steps.find(s => s.id === id);

test('end to end: every chart balance is in OB-1, advances in OB-2, Stock in OB-3 (not in the chart), the date is checked from what Zoho shows', async () => {
  await login('analyst');
  // Tally sign: a debit is negative. The balances add up to zero.
  const m = await migration({
    accounts: [ledger('Town Bank', 'Bank Accounts', '-9000'), ledger('Shop Till', 'Cash-in-Hand', '-500'), ledger('Travel Credit Card', 'Bank Accounts', '700'), ledger('Overdraft Line', 'Bank OD A/c', '1200'),
      ledger('Partner Capital', 'Capital Account', '6000'), ledger('Delivery Van', 'Fixed Assets', '-4000'), ledger('Goods Store', 'Stock-in-Hand', '-300'), ledger('Office Rent Paid', 'Indirect Expenses', '0'),
      { metadata: { type: 'Ledger', name: 'Profit & Loss A/c', reservedname: 'Profit & Loss A/c' }, name: 'Profit & Loss A/c', openingbalance: '5410' }],
    customers: [ledger('Birch Retail', 'Sundry Debtors', '-800'), ledger('Aspen Mart', 'Sundry Debtors', '250'), ledger('Yew Global', 'Sundry Debtors', '90', { currencyname: 'USD' })],
    vendors: [ledger('Larch Supply', 'Sundry Creditors', '1100'), ledger('Hazel Works', 'Sundry Creditors', '-150')],
  });
  const { base } = m;
  // the Chart of Accounts: (changed on purpose, round 2) the Stock account has no balance in the chart (it is in OB-3, so it
  // cannot lock the Opening Balance Date), and (round 1 issue 14) the Equity row is the date anchor
  const coa = await m.csv('accounts');
  assert.deepEqual(coa.map(x => [x['Account Name'], x['Account Type'], x['Opening Balance'], x['Debit or Credit']]), [
    ['Town Bank', 'Bank', '', ''], ['Shop Till', 'Cash', '', ''], ['Travel Credit Card', 'Credit Card', '', ''], ['Overdraft Line', 'Bank', '', ''],
    ['Partner Capital', 'Equity', '6000.00', 'Credit'], ['Delivery Van', 'Fixed Asset', '', ''], ['Goods Store', 'Stock', '', ''], ['Office Rent Paid', 'Expense', '', '']]);
  // the journal file: OB-1 with every other balance and Tally's Profit & Loss on Retained Earnings; OB-2 with the advances
  const ob = await m.csv('opening_balances_for_zoho_accounts');
  // OB-007: the bank lines (a kind Zoho took in our imports) in OB-1; every other kind in OB-3, balanced on its own; the
  // two lines on Opening Balance Adjustments together are the 190.00 one journal had
  assert.deepEqual(ob.map(x => [x['Journal Number Suffix'], x.Account, x['Contact Name'], x.Debit, x.Credit]), [
    ['1', 'Town Bank', '', '9000.00', ''], ['1', 'Overdraft Line', '', '', '1200.00'], ['1', 'Opening Balance Adjustments', '', '', '7800.00'],
    ['3', 'Shop Till', '', '500.00', ''], ['3', 'Travel Credit Card', '', '', '700.00'],
    ['3', 'Delivery Van', '', '4000.00', ''], ['3', 'Goods Store', '', '300.00', ''], ['3', 'Retained Earnings', '', '', '5410.00'], ['3', 'Opening Balance Adjustments', '', '1310.00', ''],
    ['2', 'Accounts Receivable', 'Aspen Mart', '', '250.00'], ['2', 'Accounts Payable', 'Hazel Works', '150.00', ''], ['2', 'Opening Balance Adjustments', '', '100.00', '']]);
  assert.ok(ob.every(x => x['Journal Date'] === '2024-03-31' && x.Status === 'published'));
  // contacts: the usual side in the column, the advance left empty (it is in OB-2), the foreign one in no file and said so
  const cust = await m.csv('customers'), vend = await m.csv('vendors');
  assert.deepEqual(cust.map(x => [x['Display Name'], x['Opening Balance']]), [['Birch Retail', '800.00'], ['Aspen Mart', ''], ['Yew Global', '']]);
  assert.deepEqual(vend.map(x => [x['Display Name'], x['Opening Balance']]), [['Larch Supply', '1100.00'], ['Hazel Works', '']]);
  // every opening balance is in exactly one file (debit positive), except the one in another currency
  const cents = v => Math.round(Number(v || 0) * 100);
  const inFiles = coa.reduce((t, x) => t + (x['Debit or Credit'] === 'Debit' ? cents(x['Opening Balance']) : -cents(x['Opening Balance'])), 0)
    + ob.filter(x => x.Account !== 'Opening Balance Adjustments').reduce((t, x) => t + cents(x.Debit) - cents(x.Credit), 0)
    + cust.reduce((t, x) => t + cents(x['Opening Balance']), 0) - vend.reduce((t, x) => t + cents(x['Opening Balance']), 0);
  assert.equal(inFiles, cents('90'), 'only the 90.00 credit of the customer in another currency is in no file');
  // flags: assumptions, not decisions; the Profit & Loss balance is not left for a person
  const gen = (await get(`${base}/summary`)).exceptions.filter(e => e.stage === 'generate');
  const names = k => gen.filter(e => e.kind === k).map(e => e.name).sort();
  assert.deepEqual(names('balance_unusual_side'), ['Aspen Mart', 'Hazel Works']);
  assert.deepEqual(names('balance_unusual_side_not_carried'), ['Yew Global']);
  assert.deepEqual(names('bank_ledger_as_credit_card'), ['Travel Credit Card']);
  assert.deepEqual(names('opening_date_anchor'), ['Partner Capital'], 'the Stock balance is unproven, so the Equity row is the date anchor (round 1 issue 14)');
  assert.deepEqual(names('profit_and_loss_balance_in_journal'), ['Profit & Loss A/c']);
  assert.deepEqual(names('profit_and_loss_balance_not_written'), []);
  assert.deepEqual(names('opening_balance_in_journal'), ['Delivery Van', 'Goods Store', 'Overdraft Line', 'Shop Till', 'Town Bank', 'Travel Credit Card']);
  const assumed = (await get(`${base}/assumptions`)).assumptions.map(a => a.kind);
  for (const k of ['balance_unusual_side', 'bank_ledger_as_credit_card', 'opening_balance_in_journal', 'profit_and_loss_balance_in_journal']) assert.ok(assumed.includes(k), k);
  // the bank list keeps to the accounts Zoho has in Banking
  assert.deepEqual((await get(`${base}/bank-opening-balances`)).accounts.map(a => [a.account, a.accountType]).sort(), [['Overdraft Line', 'Bank'], ['Shop Till', 'Cash'], ['Town Bank', 'Bank'], ['Travel Credit Card', 'Credit Card']]);
  // the completeness table: the advances are counted from OB-2; the foreign one is a real gap, said as such
  const table = await get(`${base}/completeness-table`);
  const row = k => table.rows.find(r => r.key === k);
  assert.deepEqual([row('accounts').tally.amount.signed, row('accounts').zoho.amount.signed, row('accounts').status], ['-490.00', '-490.00', 'explained']);
  assert.deepEqual([row('vendors').tally.amount.signed, row('vendors').zoho.amount.signed, row('vendors').status], ['950.00', '950.00', 'matches']);
  assert.deepEqual([row('customers').tally.amount.signed, row('customers').zoho.amount.signed, row('customers').status], ['-460.00', '-550.00', 'not_matched']);
  assert.deepEqual(row('customers').reasons.map(x => [x.kind, x.count, x.explained]), [['unusual_side_in_journal', 1, true], ['unusual_side', 1, false]]);

  // the wizard: the date step right after the accounts, an edit of the date (the chart file has a balance), no tick
  let w = await get(`${base}/import-wizard`);
  assert.deepEqual(w.steps.map(s => s.id), ['setup', 'accounts', 'bank', 'date', 'customers', 'vendors', 'items', 'opening', 'bills', 'invoices', 'journals', 'other_journals', 'finish']);
  const date = step(w, 'date');
  assert.deepEqual([date.mode, date.ticks, date.balancesToType, date.date.value], ['edit', [], [], '2024-03-31']);
  // (round 2) the Stock balance is in OB-3, so the anchor is the only balance of the chart file
  assert.deepEqual(date.chartBalances, [{ account: 'Partner Capital', side: 'Credit', amount: '6000.00' }]);
  assert.deepEqual(date.dependsOn.map(d => [d.key, d.rows]), [['accounts', 1], ['customers', 1], ['vendors', 1]]);
  assert.deepEqual(date.journalDate, { value: '2024-03-31', nice: '31/03/2024' });
  // the opening balance journal step: three journals in the file (OB-1, OB-3 with the kinds not yet imported, OB-2), the advances not in the list to type
  const opening = step(w, 'opening');
  assert.deepEqual([opening.file.expects.documents, opening.contactCredits, opening.lines.length], [3, 2, 7]); // (round 2: the Stock line is one of them)
  assert.match(opening.contactCreditWords, /journal OB-2: 2 customers and vendors with an advance/);
  assert.ok(!opening.lines.some(l => /Accounts (Receivable|Payable)/.test(l.account)));
  // the bank step lists the cash and card accounts too
  assert.deepEqual(step(w, 'bank').accounts.map(a => a.accountType).sort(), ['Bank', 'Bank', 'Cash', 'Credit Card']);
  // every later file is hard-locked; a typed reason does not open it
  for (const k of ['customers', 'vendors', 'items', 'opening', 'bills', 'invoices', 'journals', 'other_journals']) assert.deepEqual([step(w, k).locked, step(w, k).hardLocked], [true, true], k);
  let r = await send('PUT', `${base}/import-wizard/overrides/vendors`, { reason: 'The date was saved in Zoho Books by hand' });
  assert.deepEqual([r.statusCode, r.json().hard], [409, true]);
  // the date cannot be recorded before the Chart of Accounts is imported (its balance creates the record to edit)
  r = await send('PUT', `${base}/import-wizard/zoho-opening-date`, { date: '31/03/2024' });
  assert.deepEqual([r.statusCode, r.json().locked], [409, true]);
  for (const t of step(w, 'setup').items.flatMap(i => i.ticks)) await send('PUT', `${base}/import-wizard/ticks`, { step: 'setup', item: t.id, done: true });
  assert.equal((await send('PUT', `${base}/import-wizard/results/accounts`, { imported: m.files.accounts.rows, refused: 0 })).statusCode, 200);
  // the wrong date keeps everything locked and is said in the lock; the right date opens the files
  w = (await send('PUT', `${base}/import-wizard/zoho-opening-date`, { date: '2026-11-14' })).json();
  assert.deepEqual([step(w, 'date').done, step(w, 'customers').locked, step(w, 'opening').locked, step(w, 'finish').openingDate.zoho], [false, true, true, '2026-11-14']);
  assert.match(step(w, 'finish').openingDate.words, /must show 31\/03\/2024\. It was last seen to show 14\/11\/2026/);
  assert.equal((await send('PUT', `${base}/import-wizard/results/customers`, { imported: 3, refused: 0 })).statusCode, 409);
  w = (await send('PUT', `${base}/import-wizard/zoho-opening-date`, { date: '31/03/2024' })).json();
  assert.deepEqual([step(w, 'date').done, step(w, 'customers').locked, step(w, 'customers').hardLocked, step(w, 'vendors').locked], [true, false, false, false]);
  assert.match(step(w, 'opening').lockReason, /Not imported yet: Customers and Vendors|bank account/, 'the journal still waits for the contacts and the bank accounts, not for the date');
  // removing the date locks them again; the audit log has every change
  w = (await send('PUT', `${base}/import-wizard/zoho-opening-date`, { date: '' })).json();
  assert.deepEqual([step(w, 'date').done, step(w, 'customers').hardLocked], [false, true]);
  const audit = (await get(`${base}/audit`)).map(a => a.action);
  for (const a of ['migration_date_differs', 'migration_date_confirmed']) assert.ok(audit.includes(a), a);
  // the zip: both read-me files tell the same step, and never ask to type and reset a balance
  r = await call({ url: `${base}/download-all?confirmed=1` });
  assert.equal(r.statusCode, 200, r.body);
  const text = r.rawPayload.toString('latin1');
  assert.match(text, /DO NOT SKIP THIS/);
  assert.match(text, /type NO balance/);
  assert.doesNotMatch(text, /type one real opening balance|set it back to 0/i);
  // the trial balance check knows what each file puts on Opening Balance Adjustments
  const { openingSources } = await import('../src/zohotb.js');
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(process.env.DATA_DIR, 'migration.db'));
  const src = openingSources(db, base.split('/').pop());
  assert.deepEqual(src.groups.map(g => [g.key, g.rows, g.amount.toFixed(2)]), [['customers', 1, '800.00'], ['vendors', 1, '-1100.00'], ['accounts', 1, '-6000.00'], ['journal_ob1', 7, '6490.00'], ['journal_ob2', 2, '-100.00']]);
  assert.equal(src.groups.reduce((t, g) => t.plus(g.amount), D(0)).toFixed(2), '90.00', 'what is left is the one balance in no file');
  db.close();
});

test('end to end: with no customer or vendor balance nothing depends on a Zoho setting; with only a bank balance one named balance is typed', async () => {
  await login('analyst');
  // no contact has a balance: the chart file carries none, there is no Migration Date step and no file waits for one
  let m = await migration({
    accounts: [ledger('Town Bank', 'Bank Accounts', '-1000'), ledger('Partner Capital', 'Capital Account', '1000')],
    customers: [ledger('Birch Retail', 'Sundry Debtors', '0')], vendors: [ledger('Larch Supply', 'Sundry Creditors')],
  });
  assert.ok((await m.csv('accounts')).every(x => x['Opening Balance'] === '' && x['Debit or Credit'] === ''));
  // OB-007: the bank line (proven) in OB-1, the capital (a kind not yet imported) in OB-3, each balanced on its own
  assert.deepEqual((await m.csv('opening_balances_for_zoho_accounts')).map(x => [x['Journal Number Suffix'], x.Account, x.Debit, x.Credit]),
    [['1', 'Town Bank', '1000.00', ''], ['1', 'Opening Balance Adjustments', '', '1000.00'], ['3', 'Partner Capital', '', '1000.00'], ['3', 'Opening Balance Adjustments', '1000.00', '']], 'each balance once; Opening Balance Adjustments nets to zero');
  let w = await get(`${m.base}/import-wizard`);
  assert.deepEqual(w.steps.map(s => s.id), ['setup', 'accounts', 'bank', 'customers', 'vendors', 'items', 'opening', 'bills', 'invoices', 'journals', 'other_journals', 'finish']);
  assert.ok(w.steps.every(s => !s.hardLocked));
  assert.match(step(w, 'finish').openingDate.words, /No file of this migration carries a balance that Zoho Books dates itself/);
  assert.equal((await send('PUT', `${m.base}/import-wizard/zoho-opening-date`, { date: '31/03/2024' })).statusCode, 409);
  let zc = await get(`${m.base}/zoho-check`);
  assert.ok(zc.files.every(f => f.download !== 'confirm_date') && zc.preSteps.length === 0);
  assert.equal((await call({ url: `${m.base}/files/customers/download` })).statusCode, 200);

  // contacts have balances and the chart has one: ONE Equity balance stays in the chart file (the anchor), the rest is in OB-1
  m = await migration({
    accounts: [ledger('Town Bank', 'Bank Accounts', '-2000'), ledger('Reserve Fund', 'Capital Account', '900'), ledger('Partner Capital', 'Capital Account', '700'), ledger('Delivery Van', 'Fixed Assets', '-100')],
    customers: [ledger('Birch Retail', 'Sundry Debtors', '-500')], vendors: [ledger('Larch Supply', 'Sundry Creditors', '1000')],
  });
  assert.deepEqual((await m.csv('accounts')).filter(x => x['Opening Balance']).map(x => [x['Account Name'], x['Opening Balance'], x['Debit or Credit']]), [['Partner Capital', '700.00', 'Credit']], 'the smallest balance of the first preferred type');
  assert.deepEqual((await m.csv('opening_balances_for_zoho_accounts')).map(x => [x['Journal Number Suffix'], x.Account, x.Debit, x.Credit]),
    [['1', 'Town Bank', '2000.00', ''], ['1', 'Opening Balance Adjustments', '', '2000.00'], ['3', 'Reserve Fund', '', '900.00'], ['3', 'Delivery Van', '100.00', ''], ['3', 'Opening Balance Adjustments', '800.00', '']]);
  w = await get(`${m.base}/import-wizard`);
  assert.deepEqual([step(w, 'date').mode, step(w, 'date').chartBalances, step(w, 'date').balancesToType], ['edit', [{ account: 'Partner Capital', side: 'Credit', amount: '700.00' }], []]);
  assert.ok(!step(w, 'opening').lines.some(l => l.account === 'Partner Capital'), 'the anchor is not in the list of the journal');
  assert.deepEqual((await get(`${m.base}/summary`)).exceptions.filter(e => e.kind === 'opening_date_anchor').map(e => e.name), ['Partner Capital']);

  // contacts have balances but only a bank account has one: that ONE balance is typed, and it is left out of the journal
  m = await migration({
    accounts: [ledger('Town Bank', 'Bank Accounts', '-1000'), ledger('Office Rent Paid', 'Indirect Expenses', '0')],
    customers: [ledger('Birch Retail', 'Sundry Debtors', '-500')], vendors: [ledger('Larch Supply', 'Sundry Creditors', '1500')],
  });
  assert.ok((await m.csv('accounts')).every(x => x['Opening Balance'] === ''), 'a bank row never carries a balance');
  assert.equal(m.files.opening_balances_for_zoho_accounts, undefined, 'nothing is left for the journal');
  w = await get(`${m.base}/import-wizard`);
  const date = step(w, 'date');
  assert.deepEqual([date.mode, date.balancesToType, date.chartBalances, date.ticks], ['type', [{ account: 'Town Bank', side: 'Debit', amount: '1000.00' }], [], []]);
  assert.ok(date.lines.some(l => /type the ONE balance shown below\. It is in no file, so it is not counted twice and is never set back/.test(l)));
  assert.equal(step(w, 'opening'), undefined, 'the typed balance is not asked for a second time');
  assert.deepEqual((await get(`${m.base}/summary`)).exceptions.filter(e => e.kind === 'opening_date_balance_to_type').map(e => e.name), ['Town Bank']);
  const acc = (await get(`${m.base}/completeness-table`)).rows.find(r => r.key === 'accounts');
  assert.deepEqual(acc.reasons.filter(x => x.kind === 'typed_for_migration_date').map(x => [x.count, x.amount.signed, x.explained]), [[1, '-1000.00', true]]);
  assert.equal(acc.status, 'explained');
});
