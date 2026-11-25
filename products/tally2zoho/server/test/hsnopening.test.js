// S3: HSN/SAC when the field is on in Zoho Books, the Migration Date, and Tally GST ledgers against Zoho's own tax
// accounts, for ANY company. Every company here is MADE UP, in a different shape (a goods trader with stock in another
// state, a services company with TDS on rent, an exporter with overseas customers, a composition vendor, a company
// whose Zoho has HSN/SAC switched off). The rules read Tally fields (duty head, type of duty, group chain, "is input
// credit") and the tables of zohorules.json; no test depends on a real party, ledger, GSTIN or code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-hsnopening-'));
const { buildApp } = await import('../src/index.js');
const D = await import('../src/defaults.js');
const { classifyTaxLedger, taxLedgerDefaults } = await import('../src/taxaccounts.js');
const { checkFiles } = await import('../src/zohocheck.js');
const TB = await import('../src/zohotb.js');
const { parseCsv } = await import('../src/zoho.js');
const { mastersDoc, VOUCHERS, transactionsDoc, trialBalanceReport, utf16le, ledger } = await import('../fixtures/allTransactions.js');
const { RULES } = await import('../src/importwizard.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(fs.readFileSync(path.resolve(here, '../seed-users.json'), 'utf8'));

// ================= HSN/SAC, as a pure function =================
test('HSN/SAC: Tally\'s code, then the code chosen for the item, then for the account, then a suggestion; never silent', () => {
  const org = { enabled: true, minDigits: 6, corrections: {}, defaults: { item: { 'Steel Rod': '721399' }, account: { 'Consulting Income': '998311' } } };
  // a goods trader: the stock item has a code in Tally
  assert.deepEqual(D.resolveHsn({ raw: '7213 99', account: 'Sales' }, org).source, 'tally' === 'x' ? '' : 'missing', 'a value with a space is not a code');
  assert.deepEqual([D.resolveHsn({ raw: '721399' }, org).value, D.resolveHsn({ raw: '721399' }, org).source], ['721399', 'tally']);
  // a 5-digit SAC (a real Tally habit) is refused by Zoho: the chosen code for the account is written instead, and the status says why
  let r = D.resolveHsn({ raw: '99829', account: 'Consulting Income' }, org);
  assert.deepEqual([r.value, r.source, r.status, r.from], ['998311', 'chosen_account', 'not_written', '99829']);
  // an item choice wins over an account choice
  assert.equal(D.resolveHsn({ raw: '', item: 'Steel Rod', account: 'Consulting Income' }, org).value, '721399');
  // nothing in Tally and nothing chosen: a suggestion from the words, marked as such
  r = D.resolveHsn({ raw: '', account: 'Tuition Fees Received' }, org);
  assert.deepEqual([r.value, r.source], ['999293', 'suggested']);
  assert.equal(r.suggestion.label, 'Commercial training and coaching');
  // no words to go on: nothing is invented
  r = D.resolveHsn({ raw: '', account: 'Misc Receipts' }, org);
  assert.deepEqual([r.value, r.source], ['', 'missing']);
  // a correction that says "write empty" is a decision: nothing is put over it
  r = D.resolveHsn({ raw: '1234', account: 'Tuition Fees' }, { ...org, corrections: { 1234: '' } });
  assert.deepEqual([r.value, r.source], ['', 'missing']);
  // a company whose Zoho has HSN/SAC switched off: the cell is empty and nothing is said, whatever Tally has
  r = D.resolveHsn({ raw: '721399', account: 'Tuition Fees' }, { ...org, enabled: false });
  assert.deepEqual([r.value, r.source], ['', 'off']);
  // 4-digit mode (an organisation whose Zoho takes 4 digits): a 4-digit code is fine, and 6 digits stays fine
  assert.deepEqual([D.resolveHsn({ raw: '7213' }, { ...org, minDigits: 4 }).value, D.resolveHsn({ raw: '7213' }, org).value], ['7213', '']);
  // a chosen code that is too short for the organisation is not used
  assert.equal(D.resolveHsn({ raw: '', account: 'A' }, { enabled: true, minDigits: 6, defaults: { account: { A: '9983' } }, sacTable: null }).value, '');
});

test('SAC suggestions: words of the name, several kinds of service, no match gives nothing', () => {
  const s = n => D.sacSuggestion(n)?.code ?? null;
  assert.deepEqual(['Software Development Fees', 'Office Rent Received', 'Freight Outward', 'Consultancy Charges', 'Audit Fees', 'Advertising Income'].map(s),
    ['998314', '997212', '996511', '998311', '998221', '998361']);
  assert.equal(s('Interest on Deposits'), null);
  assert.ok(RULES.lists.sac_suggestions.entries.every(e => /^\d{6}$/.test(e.code) && e.keywords.length), 'every suggestion is a 6-digit code with words');
  assert.equal(RULES.lists.sac_suggestions.evidence, 'assumed');
});

// ================= Tally GST ledgers against Zoho's own accounts =================
const ctx = { groupParents: { 'Taxes Kolkata': 'Duties & Taxes', 'Output Group': 'Taxes Kolkata' }, groupReserved: {} };
const L = (name, parent, extra = {}) => ({ name, parent, ...extra });

test('Tally GST ledgers: the duty head and the side decide the Zoho account, never the name', () => {
  const c = (d, known) => classifyTaxLedger(d, ctx, known);
  // a goods trader: outputs and inputs of every head, the names are unlike Zoho's
  assert.deepEqual(['CGST', 'SGST/UTGST', 'IGST'].map(h => c(L('Collected tax X', 'Duties & Taxes', { taxtype: 'GST', gstdutyhead: h })).account), ['Output CGST', 'Output SGST', 'Output IGST']);
  // the input side: Tally's own field, or the word in the name when Tally leaves the field false
  assert.equal(c(L('Whatever', 'Duties & Taxes', { taxtype: 'GST', gstdutyhead: 'IGST', isinputcredit: 'Yes' })).account, 'Input IGST');
  assert.equal(c(L('ITC on goods', 'Duties & Taxes', { taxtype: 'GST', gstdutyhead: 'CGST', isinputcredit: 'No' })).account, 'Input CGST');
  // a group below Duties & Taxes (a state-wise group) is the same
  assert.equal(c(L('Tax a', 'Output Group', { taxtype: 'GST', gstdutyhead: 'SGST' })).account, 'Output SGST');
  assert.equal(c(L('Tax a', 'Output Group', { taxtype: 'GST', gstdutyhead: 'SGST' })).certainty, 'sure');
  // not under Duties & Taxes: not a tax ledger, whatever it is called
  assert.equal(c(L('Output IGST', 'Indirect Expenses', { taxtype: 'GST', gstdutyhead: 'IGST' })), null);
  // a composition vendor's tax ledger has no duty head: left alone
  assert.equal(c(L('Composition tax', 'Duties & Taxes', { taxtype: 'GST' })), null);
  assert.equal(c(L('Professional tax', 'Duties & Taxes', { taxtype: 'Others' })), null);
  // cess, reverse charge and TDS are only suggested (ask), with the account when one is known
  assert.deepEqual(['Cess', 'State Cess'].map(h => [c(L('Cess ledger', 'Duties & Taxes', { taxtype: 'GST', gstdutyhead: h })).certainty, c(L('Cess ledger', 'Duties & Taxes', { taxtype: 'GST', gstdutyhead: h })).account]), [['ask', 'Output CESS'], ['ask', 'Output CESS']]);
  const rcm = c(L('RCM input credit IGST', 'Duties & Taxes', { taxtype: 'GST', gstdutyhead: 'IGST' }));
  assert.deepEqual([rcm.kind, rcm.certainty, rcm.account], ['rcm', 'ask', 'Reverse Charge Tax Input but not due']);
  // a services company: TDS payable and TDS receivable
  const tdsP = c(L('Tax deducted on rent', 'Duties & Taxes', { taxtype: 'TDS' })), tdsR = c(L('TDS recoverable', 'Duties & Taxes', { taxtype: 'TDS' }));
  assert.deepEqual([tdsP.account, tdsP.certainty, tdsR.account, tdsR.certainty], ['TDS Payable', 'ask', 'TDS Receivable', 'ask']);
  // the organisation's own account list decides what exists: an account it does not have is never applied
  const known = ['Output CGST', 'Output SGST'];
  assert.deepEqual([c(L('x', 'Duties & Taxes', { taxtype: 'GST', gstdutyhead: 'CGST' }), known).certainty, c(L('x', 'Duties & Taxes', { taxtype: 'GST', gstdutyhead: 'IGST' }), known).certainty], ['sure', 'ask']);
});

test('Tally GST ledgers: sure ones are moved by default, asked ones are listed, and a person\'s decision wins', () => {
  const recs = [
    { name: 'A out', data: L('A out', 'Duties & Taxes', { taxtype: 'GST', gstdutyhead: 'IGST' }) },
    { name: 'B cess', data: L('B cess', 'Duties & Taxes', { taxtype: 'GST', gstdutyhead: 'Cess' }) },
    { name: 'C plain', data: L('C plain', 'Indirect Expenses') },
  ];
  let r = taxLedgerDefaults(recs, ctx, {});
  assert.deepEqual([Object.keys(r.decisions), r.decisions['A out'].zohoName, r.decisions['A out'].byDefault, r.decisions['A out'].taxLedger, Object.keys(r.asks)], [['A out'], 'Output IGST', true, true, ['B cess']]);
  r = taxLedgerDefaults(recs, ctx, { 'A out': { decision: 'rename', newName: 'A out (Tally)' } });
  assert.deepEqual([Object.keys(r.decisions), Object.keys(r.asks)], [[], ['B cess']], 'a decision stored by a person is left alone');
});

// ================= the engine and the Migration Date =================
const invoiceHeaders = ['Invoice Number', 'Customer Name', 'Item Name', 'HSN/SAC'];
test('Zoho check: an empty or short HSN/SAC is refused while the field is on, and not while it is off', () => {
  const rows = [['I-1', 'Cust', 'Svc', '998311'], ['I-2', 'Cust', 'Svc', ''], ['I-3', 'Cust', 'Svc', '99829'], ['I-4', 'Cust', 'Svc', '9983'], ['I-5', 'Cust', 'Svc', '12AB56']];
  const run = options => checkFiles({ invoices: { headers: invoiceHeaders, rows, bytes: 100, fileName: 'invoices.csv' } }, options).files.find(f => f.key === 'invoices');
  const on = run({ hsnEnabled: true, hsnMinDigits: 6 });
  const cause = on.causes.find(c => c.id === 'INV-HSN-REQUIRED-WHEN-ENABLED');
  assert.deepEqual([cause.rows, cause.tier], [4, 'will'], 'rows 2 to 5 are refused: empty, 5 digits, 4 digits, a letter');
  // 4-digit organisation: a 4-digit code passes
  const four = run({ hsnEnabled: true, hsnMinDigits: 4 }).causes.find(c => c.id === 'INV-HSN-REQUIRED-WHEN-ENABLED');
  assert.equal(four.rows, 3);
  // switched off in Zoho, or no answer: the rule is not applied
  assert.equal(run({ hsnEnabled: false }).causes.find(c => c.id === 'INV-HSN-REQUIRED-WHEN-ENABLED'), undefined);
  assert.equal(run({}).causes.find(c => c.id === 'INV-HSN-REQUIRED-WHEN-ENABLED'), undefined);
  assert.equal(cause.place.anchor, 'ms-hsn');
});

test('Zoho check: contacts with opening balances warn until the Migration Date step is ticked', () => {
  const headers = ['Display Name', 'Opening Balance'];
  const run = (rows, options) => checkFiles({ customers: { headers, rows, bytes: 50, fileName: 'customers.csv' } }, options).files.find(f => f.key === 'customers');
  const warn = run([['A', '100.00'], ['B', '']], { openingDateConfirmed: false }).causes.find(c => c.id === 'CUS-OPENING-BALANCE-DATE');
  assert.deepEqual([warn.tier, warn.place.params.step], ['warning', 'date']);
  assert.equal(run([['A', '']], { openingDateConfirmed: false }).causes.find(c => c.id === 'CUS-OPENING-BALANCE-DATE'), undefined, 'no balance, nothing to date');
  assert.equal(run([['A', '100.00']], { openingDateConfirmed: true }).causes.find(c => c.id === 'CUS-OPENING-BALANCE-DATE'), undefined);
});

test('Zoho Trial Balance: the period of the export is read, an export that starts after the opening date is warned about, and GST ledgers match account to account', async () => {
  const rows = [['Example Org'], ['Trial Balance\nBasis: Accrual\nFrom 01/04/2025 To 31/03/2026'], ['Account', 'Net Debit', 'Net Credit']];
  const p = TB.readTbPeriod(rows);
  assert.deepEqual(p, { from: '2025-04-01', to: '2026-03-31' });
  assert.match(TB.periodWarning(p, '2025-03-31').warning, /^This export starts on 2025-04-01, after the opening balance date 2025-03-31/, 'the opening journal is dated the day before the year: a range from the year start leaves it out');
  assert.equal(TB.periodWarning({ from: '2025-03-01', to: '2026-03-31' }, '2025-03-31').warning, null);
  assert.deepEqual(TB.periodWarning(null, '2025-03-31'), { period: null, warning: null });
  // the matching: a GST ledger entered on Zoho's own tax account is compared with that one account, many ledgers as one total
  const ctx2 = { clashDecisions: { 'Collected tax a': { decision: 'zoho', taxLedger: true, zohoName: 'Output IGST' }, 'Collected tax b': { decision: 'zoho', taxLedger: true, zohoName: 'Output IGST' } },
    outputName: n => (n.startsWith('Collected') ? 'Output IGST' : n), groupParents: {} };
  const a = TB.zohoAccountOf('Collected tax a', { parent: 'Duties & Taxes', tax: true }, ctx2), b = TB.zohoAccountOf('Collected tax b', { parent: 'Duties & Taxes', tax: true }, ctx2);
  assert.deepEqual([a.zohoName, a.how, b.zohoName], ['Output IGST', 'zoho_tax_account', 'Output IGST']);
  const Dec = (await import('decimal.js')).default;
  const cmp = TB.compareTb([{ ledger: 'Collected tax a', amount: new Dec('700'), ...a }, { ledger: 'Collected tax b', amount: new Dec('300'), ...b }], [{ name: 'Output IGST', amount: new Dec('1000') }]);
  assert.deepEqual([cmp.counts.matched, cmp.counts.differing, cmp.matched[0].ledgerCount], [1, 0, 2]);
  assert.match(cmp.matched[0].note, /2 Tally GST ledger\(s\) are entered on this one Zoho tax account/);
});

// ================= end to end =================
const app = buildApp();
let cookie = '';
const call = opts => app.inject({ ...opts, headers: { ...(opts.headers || {}), ...(cookie ? { cookie } : {}) } });
const get = async url => { const r = await call({ url }); assert.equal(r.statusCode, 200, `${url}: ${r.body}`); return r.json(); };
const send = (method, url, payload) => call({ method, url, ...(payload !== undefined ? { payload } : {}) });
const putFile = (url, buffer, name) => call({ method: 'PUT', url, headers: { 'content-type': 'application/octet-stream', 'x-filename': name }, payload: buffer });
const login = async role => {
  const u = seed.users.find(x => x.role === role);
  cookie = String((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: u.password } })).headers['set-cookie']).split(';')[0];
};
const csvOf = async (base, key) => {
  const r = await call({ url: `${base}/files/${key}/download?confirmed=1` });
  assert.equal(r.statusCode, 200, `${key}: ${r.body}`);
  return parseCsv(r.body);
};
// the made-up masters plus GST duty ledgers of a goods trader and an exporter: names unlike Zoho's own
const masters = () => {
  const doc = mastersDoc();
  const led = name => doc.tallymessage.find(r => r.metadata.type === 'Ledger' && r.metadata.name === name);
  led('Bank of Example').openingbalance = '-5000.00';
  const duty = (name, head, opening, extra = {}) => ledger(name, 'Duties & Taxes', { taxtype: 'GST', gstdutyhead: head, isinputcredit: 'No', openingbalance: opening, ...extra });
  doc.tallymessage.push(
    duty('Collected integrated tax', 'IGST', '700.00'), duty('ITC central tax', 'CGST', '-300.00'), duty('Collected state tax', 'SGST/UTGST', '300.00'),
    duty('Cess ledger', 'Cess', '50.00'), ledger('Professional tax', 'Duties & Taxes', { taxtype: 'Others', openingbalance: '10.00' }));
  return doc;
};

test('end to end: HSN/SAC answers and defaults, the Migration Date, and GST ledgers moved to Zoho\'s own accounts', async () => {
  await login('analyst');
  const viewerCompany = seed.users.find(x => x.role === 'viewer').company || 'Sample Masters Co';
  const id = (await send('POST', '/api/migrations', { company: viewerCompany, financialYear: '2024-25', gstin: '27AAAAA0000A1Z2' })).json().id;
  const base = `/api/migrations/${id}`;
  assert.equal((await putFile(`${base}/uploads/all_masters`, utf16le(masters()), 'Master.json')).statusCode, 200);
  assert.equal((await putFile(`${base}/uploads/all_transactions`, utf16le(transactionsDoc(VOUCHERS)), 'Transactions.json')).statusCode, 200);
  await send('PUT', `${base}/waivers/stock_summary`, { reason: 'Not needed for test' });
  assert.equal((await putFile(`${base}/uploads/trial_balance`, utf16le(trialBalanceReport()), 'TrialBal.json')).statusCode, 200);
  assert.equal((await send('POST', `${base}/process?wait=1`)).statusCode, 200);
  const generate = async () => { const g = await send('POST', `${base}/generate`); assert.equal(g.statusCode, 200, g.body); return g.json(); };
  await generate();

  // ---------- GST ledgers: not in the Chart of Accounts, on Zoho's own accounts in the opening balance journal ----------
  let acc = await csvOf(base, 'accounts');
  const names = acc.rows.map(r => r['Account Name']);
  assert.deepEqual(names.filter(n => /collected|ITC central|state tax/i.test(n)), [], 'the three certain GST ledgers are not written as accounts');
  assert.ok(names.includes('Cess ledger') && names.includes('Professional tax'), 'a cess ledger (doubtful) and a non-GST duty stay accounts of their own');
  let ob = await csvOf(base, 'opening_balances_for_zoho_accounts');
  const line = a => ob.rows.find(r => r.Account === a);
  assert.deepEqual([line('Output IGST').Credit, line('Input CGST').Debit, line('Output SGST').Credit], ['700.00', '300.00', '300.00']);
  assert.equal(ob.rows[0]['Journal Date'], '2024-03-31', 'the day before the financial year starts, by default');
  // Mapping Studio lists them, with why; the cess one only needs a decision
  let v = await get(`${base}/account-clashes`);
  const tax = v.clashes.filter(c => c.taxLedger);
  assert.deepEqual(tax.map(c => [c.ledger, c.zohoAccount, c.effective, c.needsDecision]).sort(),
    [['Cess ledger', 'Output CESS', 'own', true], ['Collected integrated tax', 'Output IGST', 'zoho', false], ['Collected state tax', 'Output SGST', 'zoho', false], ['ITC central tax', 'Input CGST', 'zoho', false]]);
  assert.match(tax.find(c => c.ledger === 'Collected integrated tax').why, /GST, duty head IGST, output side/);
  // the assumption is raised, and the doubtful ledger is flagged for a decision
  const kinds = (await get(`${base}/assumptions`)).items?.map(a => a.kind) || (await get(`${base}/assumptions`)).assumptions?.map(a => a.kind) || [];
  assert.ok(kinds.includes('tax_ledger_to_zoho_account'), JSON.stringify(kinds));
  // a person puts the cess ledger on Zoho's account: it follows the same path
  assert.equal((await send('PUT', `${base}/account-clashes`, { ledger: 'Cess ledger', decision: 'zoho' })).statusCode, 200);
  await generate();
  acc = await csvOf(base, 'accounts');
  ob = await csvOf(base, 'opening_balances_for_zoho_accounts');
  assert.ok(!acc.rows.some(r => r['Account Name'] === 'Cess ledger'));
  assert.equal(ob.rows.find(r => r.Account === 'Output CESS').Credit, '50.00');
  // and a rename keeps a ledger as an account of its own
  assert.equal((await send('PUT', `${base}/account-clashes`, { ledger: 'Collected state tax', decision: 'rename', newName: 'Collected state tax (Tally)' })).statusCode, 200);
  await generate();
  assert.ok((await csvOf(base, 'accounts')).rows.some(r => r['Account Name'] === 'Collected state tax (Tally)'));

  // ---------- HSN/SAC ----------
  // the answer is on by default; the made-up sales lines carry no HSN, and nothing says what to write: Zoho will refuse them
  let s = await get(`${base}/voucher-settings`);
  assert.deepEqual([s.hsnEnabled, s.hsnMinDigits, s.openingDate], ['on', '6', '']);
  let inv = await csvOf(base, 'invoices');
  assert.ok(inv.rows.every(r => r['HSN/SAC'] === ''));
  let zc = await get(`${base}/zoho-check`);
  const hsnCause = zc.causes.find(c => c.id === 'INV-HSN-REQUIRED-WHEN-ENABLED');
  assert.ok(hsnCause && hsnCause.rows > 0 && hsnCause.tier === 'will', 'the check predicts the refusal before the download');
  // the code is chosen for the income ledger (a general default, per account or item); a code Zoho does not take is refused
  let h = await get(`${base}/hsn-corrections`);
  assert.deepEqual([h.enabled, h.minDigits], [true, 6]);
  const need = h.noCode.find(x => x.name === 'Domestic Sales');
  assert.deepEqual([need.kind, need.source, need.chosen], ['account', 'missing', '']);
  assert.equal((await send('PUT', `${base}/hsn-defaults`, { defaults: [{ kind: 'account', name: 'Domestic Sales', code: '99829' }] })).statusCode, 400);
  assert.equal((await send('PUT', `${base}/hsn-defaults`, { defaults: [{ kind: 'thing', name: 'x', code: '998311' }] })).statusCode, 400);
  let r = await send('PUT', `${base}/hsn-defaults`, { defaults: [{ kind: 'account', name: 'Domestic Sales', code: '998311' }] });
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual([r.json().changed, r.json().noCode.find(x => x.name === 'Domestic Sales').source], [1, 'chosen']);
  assert.ok((await get(base)).outOfDateFiles.includes('invoices'));
  await generate();
  inv = await csvOf(base, 'invoices');
  assert.ok(inv.rows.some(r => r['HSN/SAC'] === '998311'));
  zc = await get(`${base}/zoho-check`);
  const after = zc.causes.find(c => c.id === 'INV-HSN-REQUIRED-WHEN-ENABLED');
  assert.ok(!after || after.rows < hsnCause.rows, 'the lines on the chosen ledger are no longer predicted as refused');
  // the company says its Zoho has HSN/SAC switched off: empty cells, no refusal predicted, nothing flagged
  assert.equal((await send('PUT', `${base}/voucher-settings`, { hsnEnabled: 'off' })).statusCode, 200);
  assert.ok((await get(base)).outOfDateFiles.includes('invoices'));
  await generate();
  inv = await csvOf(base, 'invoices');
  assert.ok(inv.rows.every(r => r['HSN/SAC'] === ''));
  assert.equal((await get(`${base}/zoho-check`)).causes.find(c => c.id === 'INV-HSN-REQUIRED-WHEN-ENABLED'), undefined);
  assert.equal((await send('PUT', `${base}/voucher-settings`, { hsnEnabled: 'maybe' })).statusCode, 400);
  assert.equal((await send('PUT', `${base}/voucher-settings`, { hsnEnabled: 'on', hsnMinDigits: '4' })).statusCode, 200);

  // ---------- the Migration Date ----------
  assert.equal((await send('PUT', `${base}/voucher-settings`, { openingDate: '31/03/2024' })).statusCode, 400, 'a date is year-month-day');
  assert.equal((await send('PUT', `${base}/voucher-settings`, { openingDate: '2024-02-30' })).statusCode, 400);
  r = await send('PUT', `${base}/voucher-settings`, { openingDate: '2024-03-30' });
  assert.equal(r.statusCode, 200, r.body);
  assert.ok((await get(base)).outOfDateFiles.includes('opening_balances_for_zoho_accounts'));
  await generate();
  ob = await csvOf(base, 'opening_balances_for_zoho_accounts');
  assert.ok(ob.rows.every(r => r['Journal Date'] === '2024-03-30'), 'the journal carries the chosen Migration Date');
  // the wizard shows the same date, editable, and stops the contacts until it is confirmed
  let w = await get(`${base}/import-wizard`);
  const dateStep = w.steps.find(x => x.id === 'date');
  assert.deepEqual([dateStep.date.value, dateStep.date.chosen, dateStep.date.default], ['2024-03-30', true, '2024-03-31']);
  // changed on purpose (opening balance batch): no balance is typed and nothing is ticked. The step is done only when the
  // date Zoho Books shows is typed and is the chosen Migration Date
  assert.deepEqual([dateStep.ticks, dateStep.zohoDate.expected, dateStep.zohoDate.matches, dateStep.done], [[], '2024-03-30', false, false]);
  assert.equal(dateStep.journalDate.value, '2024-03-30', 'the opening balance journal carries the same date');
  // the set-up questions: HSN/SAC on or off, and its length
  const q = w.steps.find(x => x.id === 'setup').questions;
  assert.deepEqual(q.map(x => [x.id, x.value]), [['hsnEnabled', 'on'], ['hsnMinDigits', '4']]);
  const guide = RULES.organisation_setup.find(x => /Preferences/.test(x.what)).do;
  // changed on purpose (wizard-check batch): the HSN switch is under Module Settings > General > Items, tab Preferences
  // (zoho-screens/README.md, zoho_screen_50), not under Setup & Configurations
  assert.match(guide, /Settings > Module Settings > General > Items, tab Preferences/);
  assert.doesNotMatch(guide, /Setup & Configurations > Items/);
  assert.match(guide, /switch it off/);
});

// A company with no GSTIN (not registered for GST, or GST not switched on in Zoho Books) has no HSN/SAC field in Zoho:
// with no answer given the field is taken as off; an answer always wins; a GSTIN makes the default on.
test('HSN/SAC default: off for a company with no GSTIN until it answers, on with a GSTIN', async () => {
  await login('analyst');
  const co = seed.users.find(x => x.role === 'viewer').company || 'Sample Masters Co';
  const make = async gstin => (await send('POST', '/api/migrations', { company: co, financialYear: '2024-25', ...(gstin ? { gstin } : {}) })).json().id;
  const noGst = `/api/migrations/${await make('')}`, withGst = `/api/migrations/${await make('27AAAAA0000A1Z2')}`;
  assert.equal((await get(`${noGst}/voucher-settings`)).hsnEnabled, 'off');
  assert.equal((await get(`${withGst}/voucher-settings`)).hsnEnabled, 'on');
  // the Zoho check gets the same answer, so the blocking rule is skipped for the company with no GSTIN
  const { hsnFieldOn } = await import('../src/vouchers.js');
  assert.deepEqual([hsnFieldOn(undefined, ''), hsnFieldOn(undefined, '  '), hsnFieldOn(undefined, '27AAAAA0000A1Z2'), hsnFieldOn('on', ''), hsnFieldOn('off', '27AAAAA0000A1Z2')], [false, false, true, true, false]);
  // an answer is kept
  assert.equal((await send('PUT', `${noGst}/voucher-settings`, { hsnEnabled: 'on' })).statusCode, 200);
  assert.equal((await get(`${noGst}/voucher-settings`)).hsnEnabled, 'on');
});

test('Zoho check: an empty HSN/SAC on a bill is only a warning (the second import accepted such bills); on an invoice it still blocks', () => {
  const billHeaders = ['Bill Number', 'Vendor Name', 'Item Name', 'HSN/SAC'];
  const files = { bills: { headers: billHeaders, rows: [['B-1', 'Vend', 'Svc', '']], bytes: 100, fileName: 'bills.csv' } };
  const f = checkFiles(files, { hsnEnabled: true, hsnMinDigits: 6 }).files.find(x => x.key === 'bills');
  const cause = f.causes.find(c => c.id === 'BIL-HSN-REQUIRED-WHEN-ENABLED');
  assert.ok(cause, 'still shown');
  assert.equal(cause.severity, 'warning');
  assert.notEqual(cause.tier, 'will');
  assert.notEqual(cause.tier, 'may');
  assert.equal(cause.evidenceLevel, 'assumed');
});

test('GST ledger side: a name that disagrees with the opening balance is only suggested, never moved by default', () => {
  const { taxLedgerDefaults: defaults } = { taxLedgerDefaults };
  const duty = (name, ob, extra = {}) => L(name, 'Duties & Taxes', { taxtype: 'GST', gstdutyhead: 'CGST', isinputcredit: 'No', ...(ob ? { openingbalance: ob } : {}), ...extra });
  const cl = d => classifyTaxLedger(d, ctx);
  // an output ledger whose name has an input word: the credit balance disagrees
  const rev = cl(duty('Output CGST (ITC reversal)', '500.00'));
  assert.equal(rev.certainty, 'ask');
  assert.equal(rev.account, 'Output CGST', 'the balance decides the suggestion');
  assert.match(rev.why, /different sides/);
  const adv = cl(duty('Output CGST on advance tax', '200.00'));
  assert.equal(adv.certainty, 'ask');
  // a name with no input word but a debit balance is an input ledger (another language, or "paid")
  const paid = cl(duty('CGST Paid', '-300.00'));
  assert.deepEqual([paid.side, paid.account, paid.certainty], ['input', 'Input CGST', 'sure']);
  // agreeing signals are moved as before
  assert.deepEqual([cl(duty('ITC CGST', '-100.00')).certainty, cl(duty('Output CGST', '100.00')).certainty, cl(duty('Collected tax', '')).certainty], ['sure', 'sure', 'sure']);
  // Tally's own field wins over everything
  assert.deepEqual([cl(duty('Output CGST', '100.00', { isinputcredit: 'Yes' })).side], ['input']);
  // and the ask ledger is listed, not moved
  const r = defaults([{ name: 'Output CGST (ITC reversal)', data: duty('Output CGST (ITC reversal)', '500.00') }, { name: 'Plain', data: duty('Plain', '') }], ctx, {});
  assert.deepEqual([Object.keys(r.decisions), Object.keys(r.asks)], [['Plain'], ['Output CGST (ITC reversal)']]);
});
