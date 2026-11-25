// The server fixes of the data and code audit (items 1-18). Every name, number and amount here is MADE UP; the only
// real GSTIN is none (the GSTINs below are made up, with their check character worked out).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-auditfixes-'));
const { buildApp, withDependentFiles } = await import('../src/index.js');
const { NameSet } = await import('../src/tally.js');
const { buildVoucherOutput, suggestJournal, routingOptions, taxLedgerInfo, DEFAULT_ROUTE_REFUSED_KINDS } = await import('../src/vouchers.js');
const { tdsSuggestion, defaultClashDecisions, CUSTOMER_TDS_DEFAULT } = await import('../src/defaults.js');
const { gstinProblem, ZOHO_BUILTIN_ACCOUNTS, builtinAccount } = await import('../src/zohocodes.js');
const { mappingConflict, taxLedgersToDecide } = await import('../src/taxes.js');
const { isInputSideTaxLedger, ledgerAccountType } = await import('../src/zoho.js');
const { checkFiles } = await import('../src/zohocheck.js');
const { mastersDoc, VOUCHERS, transactionsDoc, trialBalanceReport, utf16le } = await import('../fixtures/allTransactions.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(fs.readFileSync(path.resolve(here, '../seed-users.json'), 'utf8'));
const RULES = JSON.parse(fs.readFileSync(path.resolve(here, '../src/zohorules.json'), 'utf8'));

// ---------- a small made-up company ----------
const MASTERS = {
  'In CGST': { taxtype: 'GST', gstdutyhead: 'CGST' }, 'In SGST': { taxtype: 'GST', gstdutyhead: 'SGST/UTGST' }, 'In IGST': { taxtype: 'GST', gstdutyhead: 'IGST' },
  'RCM IGST Out': { taxtype: 'GST', gstdutyhead: 'IGST' }, 'Out CGST': { taxtype: 'GST', gstdutyhead: 'CGST', rateoftaxcalculation: ' 9' },
  'TDS Prof 194J': { taxtype: 'TDS', tdsratename: 'Fees for professional services 194J' }, 'TDS No Section': { taxtype: 'TDS' },
};
const KINDS = { Consultancy: 'expense', Freight: 'expense', 'Bank Charges': 'expense', 'Service Income': 'income', 'Service Returns': 'income' };
const CONTACTS = { customers: { 'Cust Alder': { treatment: 'business_gst', gstin: '29AAAAA0000A1Z2', place: 'KA' } },
  vendors: { 'Vend Birch': { treatment: 'business_gst', gstin: '29BBBBB0000B1Z5', place: 'KA' }, 'Vend Cedar': { treatment: 'business_none', gstin: '', place: 'MH' } } };
const ctx = (over = {}) => ({
  customers: new NameSet(Object.keys(CONTACTS.customers)), vendors: new NameSet(Object.keys(CONTACTS.vendors)), taxLedgers: new NameSet(Object.keys(MASTERS)),
  taxMap: {}, taxInfo: n => (MASTERS[n] ? taxLedgerInfo(MASTERS[n]) : null), kindOf: n => KINDS[n] ?? (MASTERS[n] ? 'tax' : CONTACTS.customers[n] ? 'customer' : CONTACTS.vendors[n] ? 'vendor' : null),
  tdsMap: {}, tdsDefault: n => tdsSuggestion(taxLedgerInfo(MASTERS[n] || {}), n), contactOf: (section, ledger) => CONTACTS[section][ledger] || null,
  gstRegisteredCodes: new Set(['business_gst']), defaultRouting: true, ...over,
});
let nextId = 0;
const vch = (number, lines) => ({ vouchernumber: number, date: '20250601', cmpgststate: 'Karnataka', allledgerentries: lines.map(([ledgername, amount]) => ({ ledgername, amount })) });
const rec = (slot, data, decision) => ({ id: ++nextId, source_id: `g${nextId}`, name: `${slot} ${data.vouchernumber}`, slot, data, decision });
const rowsOf = (built, file, r) => built[file].rows.filter(x => x.rec === r).map(x => x.row);
const flagsOf = (built, r) => built.exceptions.filter(e => e.rec === r && e.kind).map(e => e.kind);

// ================= item 1: purchases with TDS are Bills with the TDS columns by default =================
test('item 1: a purchase journal with ONE TDS ledger that has a Zoho TDS tax is a Bill by default, with the TDS in its columns', () => {
  const withSection = rec('journal', vch('J-1', [['Consultancy', '-1000.00'], ['Vend Birch', '900.00'], ['TDS Prof 194J', '100.00']]));
  const noSection = rec('journal', vch('J-2', [['Consultancy', '-1000.00'], ['Vend Birch', '900.00'], ['TDS No Section', '100.00']]));
  const c = ctx();
  // the suggestion: the TDS is not a negative row when it goes to the TDS columns
  const s1 = suggestJournal(withSection.data, c.customers, c.vendors, routingOptions(c));
  assert.deepEqual([s1.suggested, s1.clear, s1.needsCheck, s1.tdsColumns], ['Bill', true, false, true]);
  assert.match(s1.reason, /goes to the bill's TDS columns/);
  const s2 = suggestJournal(noSection.data, c.customers, c.vendors, routingOptions(c));
  assert.deepEqual([s2.suggested, s2.needsCheck, s2.tdsColumns], ['Bill', true, false], 'no Zoho TDS tax: still a negative row, so a person decides');
  // the files: the Bill carries TDS Name and Amount; the other stays a Manual Journal (posts exactly as Tally)
  const built = buildVoucherOutput([withSection, noSection], c);
  assert.deepEqual([built.bills.vouchers, built.journals.vouchers], [1, 1]);
  const rows = rowsOf(built, 'bills', withSection);
  assert.deepEqual(rows.map(r => [r.Account, r.Rate, r['TDS Name'], r['TDS Amount'], r['Tax Name']]), [['Consultancy', '1000.00', 'Professional Fees', '100.00', 'GST0']]);
  assert.deepEqual([built.routes.get(withSection.id).decision, built.routes.get(withSection.id).kind, built.routes.get(noSection.id).decision], ['Bill', 'journal_default_suggestion', 'Manual Journal']);
  // a person's TDS mapping makes the second one a Bill too
  const mapped = buildVoucherOutput([noSection], ctx({ tdsMap: { 'TDS No Section': { tdsName: 'Commission or Brokerage', section: '', percent: '' } } }));
  // TDS-004 (changed on purpose): Commission or Brokerage is a 2% tax (Zoho's own, and the table's); this bill deducted 10%,
  // so it gets a tax of its own instead of one name with two rates
  assert.deepEqual([mapped.bills.vouchers, rowsOf(mapped, 'bills', noSection)[0]['TDS Name']], [1, 'Commission or Brokerage 194H 10%']);
});

test('item 1: reverse charge (the same GST debited and credited) is a Bill with the Reverse Charge columns by default', () => {
  const rcm = rec('journal', vch('J-3', [['Freight', '-1000.00'], ['In IGST', '-180.00'], ['RCM IGST Out', '180.00'], ['Vend Cedar', '1000.00']]));
  const c = ctx();
  const s = suggestJournal(rcm.data, c.customers, c.vendors, routingOptions(c));
  assert.deepEqual([s.suggested, s.needsCheck, s.reverseCharge], ['Bill', false, true]);
  const built = buildVoucherOutput([rcm], c);
  assert.equal(built.bills.vouchers, 1);
  const r = rowsOf(built, 'bills', rcm)[0];
  assert.deepEqual([r.Rate, r['Tax Name'], r['Reverse Charge Tax Name'], r['Reverse Charge Tax Rate'], r['Reverse Charge Tax Type']], ['1000.00', '', 'IGST18', '18', 'ItemAmount']);
  assert.deepEqual(flagsOf(built, rcm).filter(k => k !== 'journal_default_suggestion'), ['reverse_charge_written']);
  // what the bill posts in Zoho: the line, the reverse-charge input and output (equal), the vendor at 1000: as Tally
  assert.deepEqual(built.recon[0].posting, { debit: '1180.00', credit: '1180.00' });
  assert.ok(DEFAULT_ROUTE_REFUSED_KINDS.includes('reverse_charge_bill'), 'when it cannot be written so, the default is a Manual Journal');
});

// ================= item 2: invoices never zero-rate a negative or non-income line =================
test('item 2: an invoice line on a non-income account goes to Adjustment; no GST0 on a negative line; no service item on a non-income account', () => {
  const sale = rec('sales', vch('S-1', [['Cust Alder', '-950.00'], ['Bank Charges', '-50.00'], ['Service Income', '1000.00']]));
  const returned = rec('sales', vch('S-2', [['Cust Alder', '-900.00'], ['Service Income', '1000.00'], ['Service Returns', '-100.00']]));
  const customerTds = rec('sales', vch('S-3', [['Cust Alder', '-900.00'], ['TDS No Section', '-100.00'], ['Service Income', '1000.00']]));
  const built = buildVoucherOutput([sale, returned, customerTds], ctx());
  const s1 = rowsOf(built, 'invoices', sale);
  assert.deepEqual(s1.map(r => [r.Account, r['Item Price'], r['Item Name'], r['Item Tax'], r.Adjustment, r['Adjustment Description']]), [['Service Income', '1000.00', 'Service Income', 'GST0', '-50.00', 'Bank Charges']]);
  assert.ok(flagsOf(built, sale).includes('invoice_line_to_adjustment'));
  const s2 = rowsOf(built, 'invoices', returned);
  assert.deepEqual(s2.map(r => [r['Item Price'], r['Item Tax']]), [['1000.00', 'GST0'], ['-100.00', '']], 'never a zero-rate tax on a negative line');
  // TDS deducted by the customer on a ledger with no section: the invoice's TDS columns, with the default TDS tax
  const s3 = rowsOf(built, 'invoices', customerTds);
  assert.deepEqual(s3.map(r => [r.Account, r['TDS Name'], r['TDS Amount']]), [['Service Income', CUSTOMER_TDS_DEFAULT.tdsName, '100.00']]);
  assert.deepEqual(built.serviceItems.map(x => x.account), ['Service Income', 'Service Returns'], 'service items only for income accounts (not Bank Charges, not TDS)');
  // a journal routed BY DEFAULT to an Invoice with such a line is a Manual Journal: it keeps each ledger
  const j = rec('journal', vch('J-4', [['Cust Alder', '-950.00'], ['Bank Charges', '-50.00'], ['Service Income', '1000.00']]));
  const bj = buildVoucherOutput([j], ctx());
  assert.deepEqual([bj.invoices.vouchers, bj.journals.vouchers, bj.routes.get(j.id).decision], [0, 1, 'Manual Journal']);
});

test('item 2: the Zoho check refuses an invoice line on an account that is not an income account, and an item sold on one', () => {
  const accounts = { headers: ['Account Name', 'Account Type'], rows: [['Service Income', 'Income'], ['Bank Charges', 'Expense']] };
  const invoices = { headers: ['Invoice Number', 'Invoice Date', 'Customer Name', 'Account', 'Item Name', 'Item Price', 'Quantity'], rows: [['S-1', '2025-06-01', 'Cust Alder', 'Service Income', 'Svc', '1000.00', '1'], ['S-2', '2025-06-01', 'Cust Alder', 'Bank Charges', 'Svc 2', '50.00', '1']] };
  const r = checkFiles({ accounts, invoices }, {});
  const f = r.files.find(x => x.key === 'invoices');
  const cause = f.causes.find(c => c.ruleId === 'INV-ACCOUNT-EXISTS');
  assert.ok(cause && cause.rows === 1 && cause.variant === 'where', 'only the line on the expense account');
  const items = { headers: ['Item Name', 'Rate', 'Account', 'Item Type'], rows: [['Svc', '0.00', 'Service Income', 'Sales'], ['Svc 2', '0.00', 'Bank Charges', 'Sales']] };
  const ri = checkFiles({ accounts, items }, {}).files.find(x => x.key === 'items');
  assert.equal(ri.causes.find(c => c.ruleId === 'ITM-SALES-ACCOUNT-INCOME')?.rows, 1);
});

// ================= item 3 (changed on purpose after test 2): there is no "Long Term Liability" in Zoho Books India =================
// It was a pre-step (create the account by hand) when the cause of the refusal was not known. The cause is known now: the
// type does not exist, Zoho's India list has "Non Current Liability". No account is created by hand any more.
test('item 3: an account type that Zoho Books India does not have is refused by the check, with no pre-step; Non Current Liability passes', () => {
  const accounts = { headers: ['Account Name', 'Account Type'], rows: [['Term Loan', 'Long Term Liability'], ['Office Rent', 'Expense'], ['Bank Loan', 'Non Current Liability'], ['Odd', 'Deferred Tax Liability'], ['Nonsense', 'Made Up Type']] };
  const f = checkFiles({ accounts }, {}).files[0];
  const c = f.causes.find(x => x.ruleId === 'COA-TYPE-ALLOWED');
  assert.deepEqual([c.rows, c.tier], [3, 'will'], 'Long Term Liability, Deferred Tax Liability and a made up type; Non Current Liability is fine');
  assert.ok(!f.causes.some(x => x.preStep) && !f.causes.some(x => x.ruleId === 'COA-TYPE-LONG-TERM-LIABILITY'), 'no pre-step and no rule that asks for one');
});

// ================= item 5: out of date =================
test('item 5: a change to invoices or bills marks the Manual Journals file (and for invoices the Items file) out of date too', () => {
  assert.deepEqual(withDependentFiles(['invoices', 'bills']), ['invoices', 'bills', 'journals', 'items']);
  assert.deepEqual(withDependentFiles(['vendors', 'bills']), ['vendors', 'bills', 'journals']);
  assert.deepEqual(withDependentFiles(['items', 'invoices', 'bills']), ['items', 'invoices', 'bills'], 'a list naming Items is exact (HSN/SAC)');
  assert.deepEqual(withDependentFiles(['invoices'], 'columns:invoices'), ['invoices'], 'a column layout changes its own file only');
  assert.equal(withDependentFiles(null), null, 'every file');
});

// ================= item 10: one list of Zoho's own accounts =================
test('item 10: ONE list of Zoho\'s own accounts (zohorules.json), and the organisation\'s export wins when given', () => {
  const yes = RULES.lists.default_accounts.filter(a => a.exists_by_default === 'yes' && a.name !== 'TCS Receivable').map(a => a.name);
  assert.deepEqual(ZOHO_BUILTIN_ACCOUNTS, yes);
  assert.equal(builtinAccount('input tax credits'), 'Input Tax Credits');
  const exported = ['GST Payable', 'My Own Clearing'];
  assert.equal(builtinAccount('advance tax', exported), null, 'not in the export: not one of this organisation\'s accounts');
  assert.equal(builtinAccount('my own clearing', exported), 'My Own Clearing');
  const d = defaultClashDecisions(['Advance Tax', 'My Own Clearing'], {}, exported);
  assert.deepEqual(Object.keys(d), ['My Own Clearing']);
  assert.equal(d['My Own Clearing'].zohoName, 'My Own Clearing');
  // the Zoho check compares with the export too
  const journals = { headers: ['Journal Date', 'Journal Number Suffix', 'Notes', 'Currency', 'Account', 'Debit', 'Credit'], rows: [['2025-06-01', '1', 'x', 'INR', 'My Own Clearing', '10.00', ''], ['2025-06-01', '1', 'x', 'INR', 'Advance Tax', '', '10.00']] };
  const byDefault = checkFiles({ journals }, {}).files[0], byExport = checkFiles({ journals }, { zohoAccounts: exported.map(name => ({ name, accountType: null })) }).files[0];
  const rowsOf2 = f => f.causes.filter(c => c.ruleId === 'JRN-ACCOUNT-EXISTS').reduce((t, c) => t + c.rows, 0);
  assert.deepEqual([rowsOf2(byDefault), rowsOf2(byExport)], [1, 1], 'a different account is missing in each case');
});

// ================= item 12: GSTIN =================
test('item 12: a GSTIN is checked for its format, state code and check character', () => {
  assert.equal(gstinProblem('29AAAAA0000A1ZY'), null);
  assert.match(gstinProblem('29AAAAA0000A1Z5'), /check character\) should be Y/);
  assert.match(gstinProblem('99XYZ'), /does not have the format of a GSTIN/);
  assert.match(gstinProblem('00AAAAA0000A1Z9'), /not a GST state code/);
});

// ================= item 13: tax mapping =================
test('item 13: a mapping that contradicts Tally is refused; one count of the ledgers that need a person', () => {
  const t = { ledger: 'In CGST', kind: 'gst', head: 'CGST', rates: [{ rate: '18' }] };
  assert.match(mappingConflict(t, 'IGST18'), /IGST tax \(between states\), but Tally says "In CGST" is CGST/);
  assert.match(mappingConflict(t, 'GST12'), /is 12%, but Tally uses "In CGST" at 18%/);
  assert.equal(mappingConflict(t, 'GST18'), null);
  assert.equal(mappingConflict(t, 'My own CGST 9'), null, 'a name of the organisation\'s own: its rate is not known here');
  // a ledger written automatically at one rate but needing a person for another is counted as open
  assert.deepEqual(taxLedgersToDecide([{ ledger: 'X', mapped: false, kind: 'gst', needsPerson: true, source: 'auto', taxRowVouchers: 2 }]).unmapped.map(x => x.ledger), ['X']);
  // CGST without SGST: no tax is invented, the document is flagged (blocking) and a default-routed journal is a Manual Journal
  const half = rec('sales', vch('S-9', [['Cust Alder', '-1090.00'], ['Service Income', '1000.00'], ['Out CGST', '90.00']]));
  const built = buildVoucherOutput([half], ctx());
  assert.ok(flagsOf(built, half).includes('tax_heads_incomplete'));
  assert.ok(DEFAULT_ROUTE_REFUSED_KINDS.includes('tax_heads_incomplete'));
});

// ================= item 17: input-side tax ledgers are assets =================
test('item 17: a Duties & Taxes ledger holding input credit or a receivable is an Other Current Asset', () => {
  const ctxA = { groupParents: { 'Duties & Taxes': 'Current Liabilities' }, accountTypes: {} };
  assert.equal(isInputSideTaxLedger({ name: 'Input CGST Receivable' }), true);
  assert.equal(isInputSideTaxLedger({ name: 'Output IGST' }), false);
  assert.equal(ledgerAccountType({ name: 'RCM IGST Input', parent: 'Duties & Taxes' }, ctxA), 'Other Current Asset');
  assert.equal(ledgerAccountType({ name: 'GST Payable Ledger', parent: 'Duties & Taxes' }, ctxA), 'Other Current Liability');
  assert.equal(ledgerAccountType({ name: 'Input CGST', parent: 'Duties & Taxes' }, { ...ctxA, accountTypes: { 'Duties & Taxes': 'Other Current Liability' } }), 'Other Current Liability', 'a type decided for the group wins');
});

// ================= end to end: GSTIN on the API, the index, one import order, routing views =================
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

test('item 12 on the API: New Migration and editing refuse a GSTIN that cannot be right', async () => {
  await login('analyst');
  let r = await send('POST', '/api/migrations', { company: 'Made Up Co', financialYear: '2024-25', gstin: '29AAAAA0000A1Z5' });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /^GSTIN: .*check character/);
  r = await send('POST', '/api/migrations', { company: 'Made Up Co', financialYear: '2024-25', gstin: ' 29aaaaa0000a1zy ' });
  assert.equal(r.statusCode, 201);
  assert.equal(r.json().gstin, '29AAAAA0000A1ZY', 'stored in capitals, without spaces');
  const id = r.json().id;
  assert.equal((await send('PUT', `/api/migrations/${id}`, { gstin: '12345' })).statusCode, 400);
  assert.equal((await send('PUT', `/api/migrations/${id}`, { gstin: '' })).statusCode, 200, 'empty is allowed');
});

test('items 4, 6, 9, 11: the index, one routing for every view, one import order, Opening Balance Date and documents', async () => {
  await login('analyst');
  const id = (await send('POST', '/api/migrations', { company: 'Sample Masters Co', financialYear: '2024-25', startDate: '2024-10-01' })).json().id;
  const base = `/api/migrations/${id}`;
  assert.equal((await putFile(`${base}/uploads/all_masters`, utf16le(mastersDoc()), 'Master.json')).statusCode, 200);
  assert.equal((await putFile(`${base}/uploads/all_transactions`, utf16le(transactionsDoc(VOUCHERS)), 'Transactions.json')).statusCode, 200);
  await send('PUT', `${base}/waivers/stock_summary`, { reason: 'Not needed for test' });
  assert.equal((await putFile(`${base}/uploads/trial_balance`, utf16le(trialBalanceReport()), 'TrialBal.json')).statusCode, 200);
  assert.equal((await send('POST', `${base}/process?wait=1`)).statusCode, 200);
  const g = await send('POST', `${base}/generate`);
  assert.equal(g.statusCode, 200, g.body);

  // item 4: held_vouchers has its index, and the check of "held and written" uses it (no scan of a join)
  const db = new DatabaseSync(path.join(process.env.DATA_DIR, 'migration.db'), { readOnly: true });
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'held_vouchers'").all().map(r => r.name);
  assert.ok(idx.includes('idx_held_vouchers'));
  const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT COUNT(DISTINCT h.source_record_id) n FROM held_vouchers h WHERE h.job_id = ? AND EXISTS (SELECT 1 FROM generated_rows g WHERE g.job_id = h.job_id AND g.source_record_id = h.source_record_id AND g.key IN ('invoices','bills'))`).all(id).map(r => r.detail).join(' | ');
  assert.match(plan, /idx_held_vouchers/);
  assert.match(plan, /idx_generated_rows_source/);
  db.close();
  // the voucher reconciliation still balances, and answers the same twice (kept while nothing changes)
  const recon = await get(`${base}/voucher-reconciliation`);
  assert.equal(recon.allChecksPass, true, JSON.stringify(recon.checks.filter(c => !c.ok)));
  assert.deepEqual(await get(`${base}/assumptions`), await get(`${base}/assumptions`));

  // item 6: Voucher Classification, Prepare and the files say the same for every journal with no decision
  const journals = (await get(`${base}/journals/review?state=all&pageSize=200`)).items.filter(j => !j.decision && !j.notPosted);
  const files = Object.fromEntries((await get(`${base}/files`)).map(f => [f.key, f]));
  const toDocs = journals.filter(j => j.defaultDecision !== 'Manual Journal').length;
  const mj = journals.filter(j => j.defaultDecision === 'Manual Journal').length;
  const dest = recon.rows.find(r => r.slot === 'journal')?.destinations || {};
  assert.deepEqual([toDocs, mj], [(dest['written:invoices'] || 0) + (dest['written:bills'] || 0), dest['written:journals'] || 0], 'Voucher Classification says what the files did');
  const prep = await get(`${base}/prepare`);
  const routing = prep.steps.find(s => s.key === 'decisions').items.find(i => i.key === 'journal_routing');
  if (journals.length) assert.match(routing.words, new RegExp(`written by default: ${toDocs} as the Invoice or Bill the tool suggests, ${mj} as a Manual Journal`));

  // item 9: ONE import order: the Import Tracker's list, Prepare's download step and the wizard's file steps
  const wizard = await get(`${base}/import-wizard`);
  const wizardFiles = wizard.steps.flatMap(s => (s.file ? [s.file.key] : s.key ? [s.key] : []));
  const imports = (await get(`${base}/imports`)).map(i => i.key);
  assert.deepEqual(imports, wizardFiles.filter(k => imports.includes(k)));
  assert.deepEqual(prep.steps.find(s => s.key === 'download').files.map(f => f.key), imports);
  assert.ok(files.accounts);

  // item 11 (changed after test 2, on purpose): the Migration Date cannot be saved in Zoho on its own, so it is no set-up
  // item: it is its own wizard step before the contacts, and its default is the day before the financial year starts
  // (the date of the opening balance journal), whatever start date was typed
  const setup = wizard.steps.find(s => s.id === 'setup');
  assert.ok(!setup.items.some(i => /Opening Balance Date/.test(i.what)));
  const dateStep = wizard.steps.find(s => s.id === 'date');
  assert.deepEqual([dateStep.date.value, dateStep.date.default, dateStep.date.chosen], ['2024-03-31', '2024-03-31', false]);
  assert.deepEqual(wizard.steps.map(s => s.id).slice(0, 4), ['setup', 'accounts', 'bank', 'date']);
  // the opening balance journal is ONE document
  const opening = wizard.steps.find(s => s.id === 'opening');
  if (opening?.file) assert.equal(opening.file.expects.documents, 1);
  // the TDS export is an upload, not a tick
  const tdsItem = setup.items.find(i => i.uploadTds);
  assert.ok(tdsItem && /TDS/.test(tdsItem.what) && !tdsItem.ticks.some(t => /Export TDS Taxes/i.test(t.text)));
  assert.deepEqual([tdsItem.uploadTds.route, tdsItem.uploadTds.given], [`${base}/zoho-tds-taxes`, false]);
  const csv = Buffer.from('Tax Name,Rate (%),Section\r\nProf Fees 10%,10,194J\r\nContractors 2%,2,194C\r\n');
  let r = await putFile(`${base}/zoho-tds-taxes`, csv, 'tds.csv');
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual([r.json().taxes, r.json().tds.choicesFrom, r.json().tds.choices.map(c => c.name)], [2, 'zoho_export', ['Prof Fees 10%', 'Contractors 2%']]);
  assert.equal((await putFile(`${base}/zoho-tds-taxes`, Buffer.from('a,b\r\n1,2\r\n'), 'x.csv')).statusCode, 422);
  assert.equal((await send('DELETE', `${base}/zoho-tds-taxes`)).statusCode, 200);

  // item 18: a GET of the wizard writes nothing
  const before = JSON.stringify(await get(`${base}/imports`));
  await get(`${base}/import-wizard`);
  assert.equal(JSON.stringify(await get(`${base}/imports`)), before);
  // and a file that is gone from the disk is a clear 409, never a 500
  const accountsPath = path.join(process.env.DATA_DIR, 'output', id);
  const gone = fs.readdirSync(accountsPath).find(f => /chart_of_accounts/.test(f));
  fs.renameSync(path.join(accountsPath, gone), path.join(accountsPath, `${gone}.moved`));
  r = await call({ url: `${base}/files/accounts/download?confirmed=1` });
  assert.equal(r.statusCode, 409);
  assert.match(r.json().error, /not on the server any more/);
  fs.renameSync(path.join(accountsPath, `${gone}.moved`), path.join(accountsPath, gone));
});
