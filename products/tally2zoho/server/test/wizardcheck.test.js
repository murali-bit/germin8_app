// The wizard checks what really arrived in Zoho Books, the Rejection Manager names the column Zoho blames, journals are
// known by their whole number, the click paths are the ones Zoho shows, and the trial balance Zoho Books should show is
// worked out from the files before anything is imported.
// Every name, number and amount here is MADE UP (the fixtures and the small files below); only the structure copies
// what Zoho Books and Tally export.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Decimal from 'decimal.js';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-wizardcheck-'));
const { buildApp } = await import('../src/index.js');
const { RULES } = await import('../src/importwizard.js');
const { readZohoExport, VERIFY_KINDS } = await import('../src/zohoverify.js');
const { checkFiles, causeRows } = await import('../src/zohocheck.js');
const { explainErrorFile, rejectionRecords, detectRejectionColumns } = await import('../src/zohoerrors.js');
const { contactNameKey, builtinAccount, ZOHO_OPENING_BALANCE_ACCOUNT } = await import('../src/zohocodes.js');
const { predictZohoTb, compareWithTally, POSTING_RULES } = await import('../src/predictedtb.js');
const { parseCsv } = await import('../src/zoho.js');
const { mastersDoc, VOUCHERS, transactionsDoc, trialBalanceReport, utf16le } = await import('../fixtures/allTransactions.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(fs.readFileSync(path.resolve(here, '../seed-users.json'), 'utf8'));

// ---------- made-up files for the check ----------
const file = (headers, rows) => ({ headers, rows: rows.map(r => headers.map(h => r[h] ?? '')), bytes: 1000 });
const ACC = ['Account Name', 'Account Code', 'Description', 'Account Type', 'Parent Account', 'Account # ', 'Currency', 'Opening Balance', 'Debit or Credit'];
const acc = (name, type) => ({ 'Account Name': name, 'Account Type': type });
const CUS = ['Display Name', 'Company Name', 'GST Treatment', 'GST Identification Number (GSTIN)', 'Place Of Contact', 'Currency Code', 'Billing Country', 'Opening Balance', 'Status'];
const VEN = ['Display Name', 'Company Name', 'GST Treatment', 'GST Identification Number (GSTIN)', 'Source Of Supply', 'Currency Code', 'Billing Country', 'Opening Balance', 'Status'];
const contact = name => ({ 'Display Name': name, 'Company Name': name, 'GST Treatment': 'business_none', 'Place Of Contact': 'KA', 'Source Of Supply': 'KA', 'Currency Code': 'INR', 'Billing Country': 'India', Status: 'Active' });
const JRN = ['Journal Date', 'Reference Number', 'Journal Number Prefix', 'Journal Number Suffix', 'Notes', 'Journal Type', 'Currency', 'Account', 'Description', 'Contact Name', 'Debit', 'Credit', 'Status'];
const jl = (pre, no, account, debit, credit, contactName = '') => ({ 'Journal Date': '2024-05-01', 'Reference Number': `${pre}${no}`, 'Journal Number Prefix': pre, 'Journal Number Suffix': String(no),
  Notes: `${pre}${no} from Tally`, 'Journal Type': 'both', Currency: 'INR', Account: account, Debit: debit, Credit: credit, 'Contact Name': contactName, Status: 'published' });
const checkSet = () => ({
  accounts: file(ACC, [acc('Cedar Bank Current', 'Bank'), acc('Gateway Fees', 'Expense'), acc('Service Income', 'Income'), acc('Petty Box', 'Cash')]),
  customers: file(CUS, [contact('Alder Retail'), contact('Birch Stores\r\n'), contact('Cedar Mart \r\n(North)')]),
  vendors: file(VEN, [contact('Pay Gateway Co')]),
  other_journals: file(JRN, [
    // a receipt through a payment gateway: Accounts Receivable, Accounts Payable AND a bank line in one journal
    jl('RCT-', 1, 'Accounts Receivable', '', '100.00', 'Alder Retail'), jl('RCT-', 1, 'Accounts Payable', '2.00', '', 'Pay Gateway Co'), jl('RCT-', 1, 'Cedar Bank Current', '98.00', ''),
    // a payment from cash: Accounts Payable and a cash line; the same suffix as RCT-1
    jl('PMT-', 1, 'Accounts Payable', '50.00', '', 'Pay Gateway Co'), jl('PMT-', 1, 'Petty Box', '', '50.00'),
    jl('RCT-', 2, 'Accounts Receivable', '', '10.00', 'Cedar Mart \r\n(North)'), jl('RCT-', 2, 'Cedar Bank Current', '10.00', ''),
  ]),
});
const byKey = r => Object.fromEntries(r.files.map(f => [f.key, f]));

test('Zoho check: a journal with Accounts Receivable or Payable AND a bank or cash line has no blocking cause (Zoho accepted that shape)', () => {
  const f = byKey(checkFiles(checkSet(), { homeState: 'KA' }));
  const j = f.other_journals;
  assert.deepEqual([j.rowsWill, j.causes.filter(c => c.tier === 'will').map(c => c.id)], [0, []]);
  // the journals are known by their WHOLE number: RCT-1 and PMT-1 share the suffix 1 and are two journals
  assert.equal(j.idColumn, 'Journal Number');
  const rows = causeRows(j, j.causes.find(c => c.id === 'GEN-NO-OUTER-SPACES').id, { limit: 10 }).rows;
  assert.deepEqual(rows.map(r => r.ident), ['RCT-2']);
  // no rule that refuses or holds this shape was added
  assert.ok(!JSON.stringify(RULES).includes('JRN-NO-AR-AP-WITH-BANK'));
});

test('Zoho check: spaces and line breaks in a customer or vendor name are a warning (accepted by Zoho, kept as written); elsewhere they still count', () => {
  const f = byKey(checkFiles(checkSet(), { homeState: 'KA' }));
  // "Birch Stores" ends in a line break, "Cedar Mart (North)" has one inside: both are only a warning in the Customers file
  assert.deepEqual(f.customers.causes.map(c => [c.id, c.tier, c.rows]), [['GEN-NO-OUTER-SPACES', 'warning', 2]]);
  assert.equal(f.customers.rowsMay, 0);
  // the same name written in a journal (never tried in Zoho) and a line break in an account name still count
  const set = checkSet();
  set.other_journals.rows.push(...[jl('CTR-', 1, 'Gateway\r\nFees', '1.00', ''), jl('CTR-', 1, 'Cedar Bank Current', '', '1.00')].map(r => JRN.map(h => r[h] ?? '')));
  const j = byKey(checkFiles(set, { homeState: 'KA' })).other_journals;
  assert.deepEqual(causeRows(j, 'GEN-NO-HIDDEN-CHARACTERS', { limit: 10 }).rows.map(r => [r.ident, r.column]), [['RCT-2', 'Contact Name'], ['CTR-1', 'Account']]);
  const rule = RULES.general.rules.find(r => r.id === 'GEN-NO-OUTER-SPACES');
  assert.match(rule.evidence_note, /exactly as written/);
  assert.doesNotMatch(JSON.stringify(RULES.general.rules), /stored them trimmed|stores a name trimmed|stores the name without them/);
});

test('Zoho check: a later file that writes a contact other than the master file does (only the line break or spaces at its end differ) is flagged', () => {
  const set = { customers: file(CUS, [contact('Alder Retail\r\n')]), journals: file(JRN, [jl('J-', 1, 'Accounts Receivable', '', '5.00', 'Alder Retail'), jl('J-', 1, 'Sales', '5.00', '')]) };
  const j = byKey(checkFiles(set, { homeState: 'KA' })).journals;
  assert.deepEqual(j.causes.map(c => [c.id, c.tier]), [['GEN-NAME-WRITTEN-AS-IN-MASTER', 'may']]);
  // written exactly as in the master (what the tool always does): nothing to say
  set.journals.rows[0][JRN.indexOf('Contact Name')] = 'Alder Retail\r\n';
  assert.ok(!byKey(checkFiles(set, { homeState: 'KA' })).journals.causes.some(c => c.id === 'GEN-NAME-WRITTEN-AS-IN-MASTER'));
});

test("Zoho check: with Zoho's own export of the customers, a customer Zoho did not create is named, and every journal line that names it will be refused", () => {
  const keys = [contactNameKey('Alder Retail'), contactNameKey('cedar mart (north)')]; // Zoho's export: without the line break, other capitals
  const f = byKey(checkFiles(checkSet(), { homeState: 'KA', zohoArrived: { customers: keys } }));
  assert.deepEqual(causeRows(f.customers, 'GEN-RECORD-ARRIVED-IN-ZOHO', { limit: 10 }).rows.map(r => r.ident), ['Birch Stores\r\n']);
  assert.equal(f.customers.causes.find(c => c.id === 'GEN-RECORD-ARRIVED-IN-ZOHO').tier, 'warning');
  // no journal names Birch Stores: nothing else changes
  assert.equal(f.other_journals.rowsWill, 0);
  // now Alder Retail is the one missing: the gateway receipt RCT-1 will be refused as a whole (3 rows), and why
  const g = byKey(checkFiles(checkSet(), { homeState: 'KA', zohoArrived: { customers: [contactNameKey('Birch Stores'), keys[1]] } }));
  const c = g.other_journals.causes.find(x => x.id === 'JRN-CONTACT-EXISTS:not_in_zoho');
  assert.equal(c.tier, 'will');
  assert.deepEqual(causeRows(g.other_journals, c.id, { limit: 10 }).rows.map(r => r.ident), ['RCT-1']);
  assert.equal(g.other_journals.rowsWill, 3);
  assert.match(c.message, /not in the export of Zoho Books/);
  assert.deepEqual(c.place.params, { step: 'customers' }, 'fixed on the Customers step of the Import Wizard');
});

test("Zoho's export of customers or vendors is read wherever its heading row is, with the type column respected", () => {
  const csv = Buffer.from('Contacts\r\n\r\nDisplay Name,Company Name,Contact Type,Opening Balance\r\n  alder retail ,Alder Retail,customer,100.00\r\nPay Gateway Co,Pay Gateway Co,vendor,\r\nBirch Stores,Birch Stores,customer,\r\nalder retail,Alder Retail,customer,\r\n');
  const c = readZohoExport(csv, 'customers');
  assert.deepEqual([c.column, c.leftOut, c.names.map(n => n.name)], ['Display Name', 1, ['alder retail', 'Birch Stores']]);
  assert.equal(c.names[0].openingBalance, '100.00');
  assert.deepEqual(readZohoExport(csv, 'vendors').names.map(n => n.name), ['Pay Gateway Co']);
  assert.match(readZohoExport(Buffer.from('Name Of Thing,Other\r\nx,y\r\n'), 'accounts').error, /no "Account Name" column/);
  assert.match(readZohoExport(Buffer.from('a,b\r\n'), 'nothing').error, /cannot be checked/);
  // every kind says where its export is in Zoho Books
  for (const k of Object.values(VERIFY_KINDS)) assert.match(k.exportPath, /Export/);
});

// ---------- the Rejection Manager ----------
// Zoho's error file: ROWNUMBER and ERRORMESSAGE in front of the columns that were imported
const errorFile = (headers, rows) => [['ROWNUMBER', 'ERRORMESSAGE', ...headers], ...rows.map(([n, m, r]) => [String(n), m, ...headers.map(h => r[h] ?? '')])];
const receipt = no => [jl('RCT-', no, 'Accounts Receivable', '', '100.00', 'Alder Retail'), jl('RCT-', no, 'Accounts Payable', '2.00', '', 'Pay Gateway Co'), jl('RCT-', no, 'Cedar Bank Current', '98.00', '')];

test('Rejection Manager: "Invalid row" with "related to Row N - Contact Name" is a missing contact, never a missing account', () => {
  const [ar, ap, bank] = receipt(1);
  const rows = errorFile(JRN, [[3, 'Invalid row', ar], [4, 'This error is related to Row 3 - Contact Name.', ap], [5, 'This error is related to Row 3 - Contact Name.', bank]]);
  const e = explainErrorFile(rows, { key: 'other_journals' });
  assert.deepEqual([e.realErrors, e.followOn, e.unassigned, e.causes.length], [1, 2, 0, 1]);
  const c = e.causes[0];
  assert.deepEqual([c.ruleIds, c.column, c.followOnRows, c.contact], [['JRN-CONTACT-EXISTS'], 'Contact Name', 2, 'check_zoho']);
  assert.doesNotMatch(`${c.meaning} ${c.fix}`, /create or import the account/i);
  assert.match(c.meaning, /The account is not the problem/);
  assert.match(c.fix, /upload Zoho's export/);
  assert.deepEqual(c.names, ['Alder Retail']);
  assert.deepEqual(c.place.params, { step: 'customers' }, 'the fix is the Customers step of the Import Wizard');

  // the tool knows the contacts: the customer is in the file but not in Zoho's export -> import the missing rows
  const known = { customers: new Set([contactNameKey('Alder Retail')]), vendors: new Set([contactNameKey('Pay Gateway Co')]), accounts: new Set(), zoho: { customers: new Set(), vendors: null } };
  const m = explainErrorFile(rows, { key: 'other_journals', known }).causes[0];
  assert.equal(m.contact, 'missing_in_zoho');
  assert.match(m.fix, /download the file with the missing rows/);
  // a vendor named on Accounts Receivable: the wrong side
  const w = explainErrorFile(errorFile(JRN, [[3, 'Invalid row', { ...ar, 'Contact Name': 'Pay Gateway Co' }], [4, 'This error is related to Row 3 - Contact Name.', ap]]), { key: 'other_journals', known }).causes[0];
  assert.equal(w.contact, 'wrong_side');
});

test('Rejection Manager: "- Account" stays a missing account; with no follow-on row the row decides, or both causes are said', () => {
  const [ar, ap, bank] = receipt(1);
  const acc1 = explainErrorFile(errorFile(JRN, [[5, 'Invalid row', bank], [3, 'This error is related to Row 5 - Account.', ar], [4, 'This error is related to Row 5 - Account.', ap]]), { key: 'other_journals' }).causes[0];
  assert.deepEqual([acc1.ruleIds, acc1.column], [['JRN-ACCOUNT-EXISTS'], 'Account']);
  assert.match(acc1.meaning, /account named in the Account column is not in Zoho Books/);
  // one line alone, nothing known: both causes, in neutral words
  const both = explainErrorFile(errorFile(JRN, [[3, 'Invalid row', ar]]), { key: 'other_journals' }).causes[0];
  assert.deepEqual(both.ruleIds, ['JRN-ACCOUNT-EXISTS', 'JRN-CONTACT-EXISTS']);
  assert.match(both.meaning, /the account in the Account column, or the customer or vendor in the Contact Name column/);
  // one line alone, and the tool knows the account is in the Chart of Accounts: then it is the contact
  const known = { customers: new Set([contactNameKey('Alder Retail')]), vendors: new Set(), accounts: new Set(['accounts receivable']), zoho: { customers: null, vendors: null } };
  assert.deepEqual(explainErrorFile(errorFile(JRN, [[3, 'Invalid row', ar]]), { key: 'other_journals', known }).causes[0].ruleIds, ['JRN-CONTACT-EXISTS']);
  // a line on an account the tool never wrote: the account
  assert.deepEqual(explainErrorFile(errorFile(JRN, [[3, 'Invalid row', { ...ar, Account: 'Ghost Ledger', 'Contact Name': 'Alder Retail' }]]), { key: 'other_journals', known }).causes[0].ruleIds, ['JRN-ACCOUNT-EXISTS']);
});

test('Rejection Manager: RCT-1 and PMT-1 (the same suffix) stay two refused journals', () => {
  const rows = errorFile(JRN, [[2, 'Invalid row', receipt(1)[0]], [3, 'This error is related to Row 2 - Contact Name.', receipt(1)[2]],
    [6, 'Invalid row', jl('PMT-', 1, 'Accounts Payable', '50.00', '', 'Pay Gateway Co')], [7, 'This error is related to Row 6 - Contact Name.', jl('PMT-', 1, 'Petty Box', '', '50.00')]]);
  const cols = detectRejectionColumns(rows, { idHeading: 'Reference Number', joinHeadings: ['Journal Number Prefix', 'Journal Number Suffix'] });
  assert.equal(cols.joined, true);
  const { records } = rejectionRecords(rows, cols);
  assert.deepEqual(records.map(r => [r.ident, r.rowNumbers, r.followOnColumns]), [['RCT-1', [2, 3], ['Contact Name']], ['PMT-1', [6, 7], ['Contact Name']]]);
  // with the suffix column alone (a file someone cut down), the records are still kept apart by what they hold
  assert.equal(rejectionRecords(rows, detectRejectionColumns(rows, { idHeading: 'Reference Number' })).records.length, 2);
});

// ---------- Zoho's own accounts, as two live new India organisations have them ----------
test("Zoho's own accounts: a name a help page gave but a new India organisation does not have is written to the Chart of Accounts", () => {
  for (const name of ['Parking', 'Material', 'Input CESS', 'Fuel/Mileage Expenses', 'Depreciation and Amortization']) assert.equal(builtinAccount(name), null, name);
  for (const name of ['Lodging', 'Materials', 'Investments', 'TDS Payable', 'Opening Balance Adjustments', 'Advertising And Marketing']) assert.ok(builtinAccount(name), name);
  const entry = RULES.lists.default_accounts.find(a => a.name === 'Parking');
  assert.equal(entry.exists_by_default, 'no_in_live_org');
});

// ---------- the click paths Zoho Books shows (zoho-screens/README.md) ----------
const WRONG_PATHS = [/Setup & Configurations > Items/, /Setup & Configurations > Customers and Vendors/, /Preferences > General/];
test('click paths: no text of the rules or the wizard sends the person to a page Zoho Books does not have', () => {
  const text = fs.readFileSync(path.resolve(here, '../src/zohorules.json'), 'utf8') + fs.readFileSync(path.resolve(here, '../src/importwizard.js'), 'utf8');
  for (const re of WRONG_PATHS) assert.doesNotMatch(text, re);
  assert.match(text, /Settings > Module Settings > General > Items/);
  assert.match(text, /Settings > Setup & Configurations > General/);
  // the reverse charge question says what was tried, not "not tried yet: import these bills first"
  const wiz = fs.readFileSync(path.resolve(here, '../src/importwizard.js'), 'utf8');
  assert.doesNotMatch(wiz, /The first import with such bills was not tried in Zoho Books yet/);
  assert.match(wiz, /with the answer No, bills of a vendor with no state written with GST \(CGST and SGST\) under reverse charge were accepted in a test import/);
});

// ---------- the trial balance Zoho Books should show ----------
const d = v => new Decimal(v);
test('expected trial balance: openings, journals, invoices and bills posted the way Zoho Books does, compared account by account and contact by contact', () => {
  const files = {
    accounts: [{ account_name: 'Owner Funds', opening_balance: '1000.00', debit_or_credit: 'Credit' }],
    customers: [{ display_name: 'Alder Retail', opening_balance: '200.00' }],
    vendors: [{ display_name: 'Pay Gateway Co', opening_balance: '50.00' }],
    opening_balances_for_zoho_accounts: [
      { journal_number_prefix: 'OB-', journal_number_suffix: '1', account: 'Cedar Bank Current', debit: '850.00', credit: '' },
      { journal_number_prefix: 'OB-', journal_number_suffix: '1', account: ZOHO_OPENING_BALANCE_ACCOUNT, debit: '', credit: '850.00' }],
    invoices: [{ invoice_number: 'S-1', invoice_status: 'open', customer_name: 'Alder Retail', account: 'Service Income', quantity: '1', item_price: '1000.00', item_tax: 'GST18', item_tax_type: 'Tax Group', item_tax_percent: '18', adjustment: '0.40' }],
    bills: [{ bill_number: 'B-1', bill_status: 'open', vendor_name: 'Pay Gateway Co', account: 'Gateway Fees', quantity: '1', rate: '100.00', tax_name: 'IGST18', tax_type: 'ItemAmount', tax_percentage: '18', tds_amount: '10.00' }],
    // the generated ADJ journal moves the invoice adjustment back to the Tally ledger
    journals: [
      { journal_number_prefix: 'ADJ-', journal_number_suffix: '1', account: 'Other Charges', debit: '0.40', credit: '' },
      { journal_number_prefix: 'ADJ-', journal_number_suffix: '1', account: 'Round Off', debit: '', credit: '0.40' },
      { journal_number_prefix: 'J-', journal_number_suffix: '9', account: 'Gateway Fees', debit: '5.00', credit: '', status: 'draft' }],
  };
  const p = predictZohoTb(files, { invoiceAdjustmentAccount: 'Other Charges', billAdjustmentAccount: 'Other Expenses' });
  const bal = name => p.accounts.get(name.toLowerCase())?.amount.toFixed(2) ?? '0.00';
  // Tally's sign: a debit is negative
  assert.deepEqual([bal('Owner Funds'), bal('Cedar Bank Current'), bal(ZOHO_OPENING_BALANCE_ACCOUNT)], ['1000.00', '-850.00', '0.00']);
  assert.deepEqual([bal('Service Income'), bal('Output CGST'), bal('Output SGST'), bal('Other Charges'), bal('Round Off')], ['1000.00', '90.00', '90.00', '0.00', '0.40']);
  assert.deepEqual([bal('Gateway Fees'), bal('Input IGST'), bal('TDS Payable')], ['-100.00', '-18.00', '10.00']);
  assert.equal(bal('Accounts Receivable'), '-1380.40'); // opening 200 + invoice 1180.40
  assert.equal(bal('Accounts Payable'), '158.00');     // opening 50 + bill 118 - TDS 10
  assert.deepEqual([p.drafts.journals, p.documents.invoices, p.documents.bills], [1, 1, 1], 'a draft journal is not posted');
  // Tally's closing balances, as the files name the accounts; one customer differs by a paisa of rounding
  const t = (ledger, amount, zohoName = ledger, how = 'ledger') => ({ ledger, amount: d(amount), zohoName, how });
  const tally = [t('Owner Funds', '1000.00'), t('Cedar Bank Current', '-850.00'), t('Service Income', '1000.00'), t('Output CGST', '90.00'), t('Output SGST', '90.00'), t('Round Off', '0.40'),
    t('Gateway Fees', '-100.00'), t('Input IGST', '-18.00'), t('TDS on fees', '10.00', 'TDS Payable'),
    { ledger: 'Alder Retail', amount: d('-1380.41'), zohoName: 'Accounts Receivable', how: 'customer', contact: 'customers', contactName: 'Alder Retail' },
    { ledger: 'Pay Gateway Co', amount: d('158.00'), zohoName: 'Accounts Payable', how: 'vendor', contact: 'vendors', contactName: 'Pay Gateway Co' }];
  const zero = [{ account: ZOHO_OPENING_BALANCE_ACCOUNT, role: 'opening_balance_adjustments' }, { account: 'Other Charges', role: 'invoice_adjustment' }, { account: 'Other Expenses', role: 'bill_adjustment' }];
  const c = compareWithTally(p, tally, { zeroAccounts: zero });
  assert.equal(c.agrees, false);
  assert.deepEqual(c.accounts.differing.map(r => [r.account, r.difference.signed, r.rounding]), [['Accounts Receivable', '0.01', true]]);
  assert.deepEqual(c.contacts.customers.rows.map(r => [r.contact, r.difference.signed, r.rounding]), [['Alder Retail', '0.01', true]]);
  assert.deepEqual(c.mustBeZero.map(z => [z.account, z.ok]), [[ZOHO_OPENING_BALANCE_ACCOUNT, true], ['Other Charges', true], ['Other Expenses', true]]);
  assert.equal(c.totals.zoho.balanced, true);
  // without the ADJ journal the invoice adjustment stays on Zoho's adjustment account, and the check says so
  const noAdj = predictZohoTb({ ...files, journals: [] }, { invoiceAdjustmentAccount: 'Other Charges' });
  const c2 = compareWithTally(noAdj, tally, { zeroAccounts: zero });
  assert.deepEqual(c2.mustBeZero.filter(z => !z.ok).map(z => [z.account, z.predicted.signed]), [['Other Charges', '0.40']]);
  // every posting rule says what is known about it
  assert.ok(POSTING_RULES.every(r => ['confirmed', 'documentation', 'assumed'].includes(r.evidence) && r.what));
});

// ---------- end to end: the wizard checks what arrived ----------
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
const step = (w, id) => w.steps.find(s => s.id === id);

test("end to end: a customer missing from Zoho's export locks the later steps, is offered as a one-row file, and the export proves the import", async () => {
  await login('analyst');
  const company = seed.users.find(x => x.role === 'analyst').company || 'Sample Masters Co';
  const id = (await send('POST', '/api/migrations', { company, financialYear: '2024-25' })).json().id;
  const base = `/api/migrations/${id}`;
  const doc = mastersDoc();
  doc.tallymessage.find(r => r.metadata.type === 'Ledger' && r.metadata.name === 'Bank of Example').openingbalance = '-5000.00';
  assert.equal((await putFile(`${base}/uploads/all_masters`, utf16le(doc), 'Master.json')).statusCode, 200);
  assert.equal((await putFile(`${base}/uploads/all_transactions`, utf16le(transactionsDoc(VOUCHERS)), 'Transactions.json')).statusCode, 200);
  await send('PUT', `${base}/waivers/stock_summary`, { reason: 'Not needed for test' });
  assert.equal((await putFile(`${base}/uploads/trial_balance`, utf16le(trialBalanceReport()), 'TrialBal.json')).statusCode, 200);
  assert.equal((await send('POST', `${base}/process?wait=1`)).statusCode, 200);
  assert.equal((await send('POST', `${base}/generate`)).statusCode, 200);

  let w = await get(`${base}/import-wizard`);
  // before any export: what Zoho Books must show, and how to check it
  const v0 = step(w, 'customers').verify;
  assert.deepEqual([v0.state, v0.expected, v0.withBalance], ['not_given', 2, 1]);
  assert.match(v0.words, /Zoho Books must list 2 customers/);
  assert.equal(step(w, 'customers').expects.records, 2);
  // the set-up, the Chart of Accounts and the Migration Date first (the date is a hard lock for every later file)
  for (const i of step(w, 'setup').items) for (const t of i.ticks) await send('PUT', `${base}/import-wizard/ticks`, { step: 'setup', item: t.id, done: true });
  w = (await send('PUT', `${base}/import-wizard/results/accounts`, { imported: step(w, 'accounts').rows, refused: 0 })).json();
  assert.equal(step(w, 'accounts').done, true);
  w = (await send('PUT', `${base}/import-wizard/zoho-opening-date`, { date: step(w, 'date').date.value })).json();
  assert.equal(step(w, 'date').done, true);

  // Zoho's export of the customers: a title row, the other customer written with other capitals and spaces
  let r = await putFile(`${base}/import-wizard/zoho-export/customers`, Buffer.from('Customers\r\nDisplay Name,Company Name,Opening Balance\r\n  pine hill stores ,Pine Hill Stores,\r\n'), 'Contacts.csv');
  assert.equal(r.statusCode, 200, r.body);
  let v = r.json().verify;
  assert.deepEqual([v.state, v.missingCount, v.missing.map(m => [m.name, m.fileRow, m.openingBalance]), v.missingWithBalance], ['missing', 1, [['Maple Leaf Traders', 2, '1500.00']], 1]);
  w = r.json().wizard;
  const cs = step(w, 'customers');
  assert.equal(cs.done, false, 'an export that lacks a record does not mark the step imported');
  assert.deepEqual(cs.verify.usedBy.map(u => u.key).sort(), ['invoices', 'other_journals']);
  assert.match(cs.verify.balanceWords, /opening balance/);
  // the file with only the missing row: the same heading row and values, the opening balance too
  r = await call({ url: cs.verify.missingRoute });
  assert.equal(r.statusCode, 200);
  assert.match(r.headers['content-disposition'], /missing_rows_contacts_customers\.csv/);
  const full = parseCsv((await call({ url: `${base}/files/customers/download?confirmed=1` })).body);
  const missing = parseCsv(r.body);
  assert.deepEqual(missing.headers, full.headers);
  assert.deepEqual(missing.rows, full.rows.filter(x => x['Display Name'] === 'Maple Leaf Traders'));
  // the Zoho check: the customer is named, and every later row that names it will be refused
  let zc = await get(`${base}/zoho-check`);
  const cause = (key, id) => zc.files.find(f => f.key === key)?.causes.find(c => c.id === id);
  assert.equal(cause('customers', 'GEN-RECORD-ARRIVED-IN-ZOHO').rows, 1);
  assert.equal(cause('other_journals', 'JRN-CONTACT-EXISTS:not_in_zoho').tier, 'will');

  // the figure typed from the preview ("2 ready") does not open the next steps while the export lacks a customer
  w = (await send('PUT', `${base}/import-wizard/results/customers`, { imported: 2, refused: 0 })).json();
  assert.deepEqual([step(w, 'customers').importState, step(w, 'customers').done], ['missing_in_zoho', false]);
  assert.match(step(w, 'customers').stateWords, /1 customer is missing in Zoho Books/);
  const jb = step(w, 'other_journals').blockers.find(b => b.step === 'customers');
  assert.equal(jb.why, 'missing_in_zoho');
  assert.match(jb.words, /This file names 1 of them, so Zoho Books would refuse those rows/);
  assert.equal((await get(`${base}/imports`)).find(i => i.key === 'customers').status, 'partial');

  // the missing row was imported: the new export has both, so the step is done and the check is clean
  r = await putFile(`${base}/import-wizard/zoho-export/customers`, Buffer.from('Display Name,Company Name\r\nPine Hill Stores,Pine Hill Stores\r\nMaple Leaf Traders,Maple Leaf Traders Pvt Ltd\r\n'), 'Contacts2.csv');
  w = r.json().wizard;
  assert.deepEqual([r.json().verify.state, step(w, 'customers').importState, step(w, 'customers').done], ['all_there', 'imported', true]);
  assert.ok(!step(w, 'other_journals').blockers.some(b => b.step === 'customers'));
  zc = await get(`${base}/zoho-check`);
  assert.equal(cause('customers', 'GEN-RECORD-ARRIVED-IN-ZOHO'), undefined);
  assert.equal(cause('other_journals', 'JRN-CONTACT-EXISTS:not_in_zoho'), undefined);

  // no export for the vendors, and a figure lower than the file: 'short', the next steps stay locked
  const expectedVendors = step(w, 'vendors').expects.records;
  w = (await send('PUT', `${base}/import-wizard/results/vendors`, { imported: expectedVendors - 1, refused: 0 })).json();
  assert.deepEqual([step(w, 'vendors').importState, step(w, 'vendors').shortBy, step(w, 'vendors').done], ['short', 1, false]);
  assert.equal(step(w, 'journals').blockers.find(b => b.step === 'vendors').why, 'short');
  // the export of the vendors (sent as a list by whoever read Zoho Books) has every one: imported
  const vendorNames = parseCsv((await call({ url: `${base}/files/vendors/download?confirmed=1` })).body).rows.map(x => x['Display Name'].trim());
  r = await send('PUT', `${base}/import-wizard/zoho-export/vendors`, { names: vendorNames });
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual([step(r.json().wizard, 'vendors').importState, step(r.json().wizard, 'vendors').done], ['imported', true]);

  // the items: nothing recorded, and Zoho's export has every item -> recorded from the export, nothing to type
  const itemNames = parseCsv((await call({ url: `${base}/files/items/download?confirmed=1` })).body).rows.map(x => x['Item Name']);
  r = await putFile(`${base}/import-wizard/zoho-export/items`, Buffer.from(`Item Name,Rate\r\n${itemNames.map(n => `"${n}",1`).join('\r\n')}\r\n`), 'Items.csv');
  assert.deepEqual([step(r.json().wizard, 'items').done, step(r.json().wizard, 'items').result.imported], [true, itemNames.length]);
  assert.ok((await get(`${base}/audit`)).some(a => a.action === 'import_result_recorded' && /recorded from Zoho's own list/.test(a.detail)));
  // forgetting an export is allowed and audited; a kind the tool cannot check is refused
  assert.equal((await send('DELETE', `${base}/import-wizard/zoho-export/items`)).statusCode, 200);
  assert.equal((await putFile(`${base}/import-wizard/zoho-export/bills`, Buffer.from('a\r\n'), 'x.csv')).statusCode, 404);

  // the zip says to check the counts after each master file; the expected trial balance is worked out and listed
  const readme = await call({ url: `${base}/download-all?confirmed=1` });
  assert.equal(readme.statusCode, 200);
  const text = readme.rawPayload.toString('latin1');
  assert.match(text, /CHECK AFTER THE IMPORT: Zoho Books must list 2 customers from this file/);
  for (const re of WRONG_PATHS) assert.doesNotMatch(text, re);
  const p = await get(`${base}/predicted-trial-balance`);
  assert.equal(p.available, true);
  assert.deepEqual(p.comparison.mustBeZero.map(z => z.role), ['opening_balance_adjustments', 'invoice_adjustment', 'bill_adjustment']);
  assert.equal(step(w, 'finish').expectedRoute, `${base}/predicted-trial-balance`);

  // a Zoho report of the journals without a Reference Number column is matched by prefix and suffix together
  const oj = parseCsv((await call({ url: `${base}/files/other_journals/download?confirmed=1` })).body);
  const numbers = [...new Set(oj.rows.map(x => `${x['Journal Number Prefix']},${x['Journal Number Suffix']}`))];
  r = await putFile(`${base}/verification/other_journals`, Buffer.from(`Journal Number Prefix,Journal Number Suffix,Notes\r\n${numbers.map(n => `${n},x`).join('\r\n')}\r\n`), 'journals.csv');
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual([r.json().matched, r.json().missing], [numbers.length, 0]);
  r = await putFile(`${base}/verification/other_journals`, Buffer.from('Journal Number Suffix,Notes\r\n1,x\r\n'), 'journals.csv');
  assert.equal(r.statusCode, 422, 'never matched by the suffix alone');
});

test('the older route PUT /imports/:key follows the Import Wizard locks: no file is marked imported before the set-up, and no contact file before the Migration Date', async () => {
  await login('analyst');
  const company = seed.users.find(x => x.role === 'analyst').company || 'Sample Masters Co';
  const id = (await send('POST', '/api/migrations', { company, financialYear: '2024-25' })).json().id;
  const base = `/api/migrations/${id}`;
  const doc = mastersDoc();
  doc.tallymessage.find(r => r.metadata.type === 'Ledger' && r.metadata.name === 'Bank of Example').openingbalance = '-5000.00';
  assert.equal((await putFile(`${base}/uploads/all_masters`, utf16le(doc), 'Master.json')).statusCode, 200);
  assert.equal((await putFile(`${base}/uploads/all_transactions`, utf16le(transactionsDoc(VOUCHERS)), 'Transactions.json')).statusCode, 200);
  await send('PUT', `${base}/waivers/stock_summary`, { reason: 'Not needed for test' });
  assert.equal((await putFile(`${base}/uploads/trial_balance`, utf16le(trialBalanceReport()), 'TrialBal.json')).statusCode, 200);
  assert.equal((await send('POST', `${base}/process?wait=1`)).statusCode, 200);
  assert.equal((await send('POST', `${base}/generate`)).statusCode, 200);

  let r = await send('PUT', `${base}/imports/accounts`, { status: 'imported' });
  assert.equal(r.statusCode, 409, 'the set-up is not confirmed yet');
  assert.equal(r.json().locked, true);
  let w = await get(`${base}/import-wizard`);
  for (const i of step(w, 'setup').items) for (const t of i.ticks) await send('PUT', `${base}/import-wizard/ticks`, { step: 'setup', item: t.id, done: true });
  assert.equal((await send('PUT', `${base}/imports/accounts`, { status: 'imported' })).statusCode, 200);
  r = await send('PUT', `${base}/imports/customers`, { status: 'imported' });
  assert.equal(r.statusCode, 409, 'the Migration Date is not confirmed yet');
  assert.equal(r.json().locked, true);
  w = await get(`${base}/import-wizard`);
  assert.equal((await send('PUT', `${base}/import-wizard/zoho-opening-date`, { date: step(w, 'date').date.value })).statusCode, 200);
  assert.equal((await send('PUT', `${base}/imports/customers`, { status: 'imported' })).statusCode, 200);
});
