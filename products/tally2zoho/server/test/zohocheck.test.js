// The Zoho check: every rule of zohorules.json on every row of every file, the prediction per file and per cause,
// the drill-down, the CSV, and Zoho's error file explained by root cause.
// Every name, GSTIN, number and amount here is MADE UP. The known causes of the first test import (Zoho's own
// accounts, a bank row with an opening balance, a duplicate display name, an empty item rate, a 5-digit HSN, a
// registered vendor's bill line without tax, an empty Total column, journals on accounts refused earlier) are rebuilt
// with invented data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-zohocheck-'));
const { checkFiles, summaryOf, causeRows, parseCsvTable, moduleRules, RULES, toPaise, placeForRule, evidenceLevel } = await import('../src/zohocheck.js');
const { zohoErrorRows, explainErrorRows, explainErrorFile, refusedNames, matchErrorMessage, rejectionRecords, detectRejectionColumns } = await import('../src/zohoerrors.js');

// ---------- made-up files ----------
// headers: the columns used; rows: objects by heading (a missing heading is an empty cell)
const file = (headers, rows) => ({ headers, rows: rows.map(r => headers.map(h => r[h] ?? '')), bytes: 1000 });
const ACC = ['Account Name', 'Account Code', 'Description', 'Account Type', 'Parent Account', 'Account # ', 'Currency', 'Opening Balance', 'Debit or Credit'];
const acc = (name, type, ob = '', side = '') => ({ 'Account Name': name, 'Account Type': type, 'Opening Balance': ob, 'Debit or Credit': side });
const CUS = ['Display Name', 'Company Name', 'GST Treatment', 'GST Identification Number (GSTIN)', 'Place Of Contact', 'Currency Code', 'Billing Country', 'Opening Balance', 'Status'];
const VEN = ['Display Name', 'Company Name', 'GST Treatment', 'GST Identification Number (GSTIN)', 'Source Of Supply', 'Currency Code', 'Billing Country', 'Opening Balance', 'Status'];
const contact = (name, treatment, gstin = '', state = '') => ({ 'Display Name': name, 'Company Name': name, 'GST Treatment': treatment, 'GST Identification Number (GSTIN)': gstin,
  'Place Of Contact': state, 'Source Of Supply': state, 'Currency Code': 'INR', 'Billing Country': 'India', Status: 'Active' });
const ITM = ['Item Name', 'HSN/SAC', 'Rate', 'Product Type', 'Account', 'Purchase Rate', 'Item Type', 'Purchase Account', 'Status'];
const INV = ['Invoice Number', 'Invoice Date', 'Invoice Status', 'Customer Name', 'GST Treatment', 'GST Identification Number (GSTIN)', 'Place of Supply', 'Currency Code', 'Account', 'Item Name', 'Item Desc', 'HSN/SAC',
  'Quantity', 'Item Price', 'Is Inclusive Tax', 'Item Tax', 'Item Tax Type', 'Item Tax %'];
const BIL = ['Bill Date', 'Bill Number', 'Bill Status', 'Source of Supply', 'Destination of Supply', 'GST Treatment', 'GST Identification Number (GSTIN)', 'Is Inclusive Tax', 'Vendor Name', 'Currency Code',
  'Item Description', 'Account', 'Quantity', 'Rate', 'Tax Name', 'Tax Percentage', 'Tax Type', 'Item Exemption Code', 'Reverse Charge Tax Name', 'Reverse Charge Tax Rate', 'Reverse Charge Tax Type'];
const JRN = ['Journal Date', 'Reference Number', 'Journal Number Prefix', 'Journal Number Suffix', 'Notes', 'Journal Type', 'Currency', 'Account', 'Description', 'Contact Name', 'Debit', 'Credit', 'Status'];
const jl = (no, account, debit, credit, extra = {}) => ({ 'Journal Date': '2024-05-01', 'Reference Number': `J-${no}`, 'Journal Number Prefix': 'J-', 'Journal Number Suffix': String(no), Notes: `Journal ${no} from Tally`,
  'Journal Type': 'both', Currency: 'INR', Account: account, Debit: debit, Credit: credit, Status: 'published', ...extra });
const GSTIN_MH = '27ABCDE1234F1Z5', GSTIN_KA = '29PQRSX5678K1Z2';

const accounts = () => file(ACC, [
  acc('Office Rent', 'Expense'),
  acc('Cedar Bank Current', 'Bank', '1000.00', 'Debit'),   // a bank row with an opening balance
  acc('Maple Bank Savings', 'Bank'),
  acc('TDS Payable', 'Other Current Liability', '25.00', 'Credit'), // an account Zoho creates itself (confirmed)
  acc('Rent Expense', 'Expense'),                         // an account Zoho creates itself (in both live organisations read)
  acc('Term Loan: Birch', 'Non Current Liability'),       // a long term loan, written with the India type
  acc('Service Income', 'Income'),
  acc('office rent', 'Expense'),                          // the same name again
]);
const customers = () => file(CUS, [contact('Alder Retail', 'business_gst', GSTIN_MH, 'MH'), contact('Birch Stores', 'business_none', '', 'KA')]);
const vendors = () => file(VEN, [contact('Elm Works', 'business_gst', GSTIN_KA, 'KA'), contact('Fir Traders', 'business_none', '', 'KA'), contact('elm works', 'business_none', '', 'KA')]);
const items = () => file(ITM, [
  { 'Item Name': 'Consulting Hour', 'Product Type': 'service', 'Item Type': 'Sales and Purchases', Status: 'Active' }, // no selling rate
  { 'Item Name': 'Design Day', 'HSN/SAC': '99831', Rate: '100.00', 'Product Type': 'service', Account: 'Service Income', 'Item Type': 'Sales', Status: 'Active' }, // 5 digits
  { 'Item Name': 'Audit Day', 'HSN/SAC': '998311', Rate: '50.00', 'Product Type': 'service', Account: 'Service Income', 'Item Type': 'Sales', Status: 'Active' },
]);
const invLine = (no, customer, extra = {}) => ({ 'Invoice Number': no, 'Invoice Date': '2024-05-02', 'Invoice Status': 'open', 'Customer Name': customer, 'GST Treatment': 'business_gst', 'GST Identification Number (GSTIN)': GSTIN_MH,
  'Place of Supply': 'MH', 'Currency Code': 'INR', Account: 'Service Income', 'Item Name': 'Audit Day', 'Item Desc': 'Audit', 'HSN/SAC': '998311', Quantity: '1', 'Item Price': '50.00', 'Is Inclusive Tax': 'false',
  'Item Tax': 'IGST18', 'Item Tax Type': 'ItemAmount', 'Item Tax %': '18', ...extra });
const invoices = () => file(INV, [
  invLine('INV-1', 'Alder Retail'),
  invLine('INV-1', 'Alder Retail', { 'HSN/SAC': '99831' }), // one line with a 5-digit code: the whole invoice is refused
  invLine('INV-2', 'Alder Retail'),
  invLine('INV-3', 'Unknown Buyer'),                        // not in the Customers file
]);
const billLine = (no, vendor, treatment, extra = {}) => ({ 'Bill Date': '2024-05-03', 'Bill Number': no, 'Bill Status': 'open', 'Source of Supply': 'KA', 'Destination of Supply': 'KA', 'GST Treatment': treatment,
  'GST Identification Number (GSTIN)': treatment === 'business_gst' ? GSTIN_KA : '', 'Is Inclusive Tax': 'FALSE', 'Vendor Name': vendor, 'Currency Code': 'INR', 'Item Description': 'Rent', Account: 'Office Rent', Quantity: '1', Rate: '100.00', ...extra });
const bills = (headers = BIL) => file(headers, [
  billLine('B-1', 'Elm Works', 'business_gst', { 'Tax Name': 'GST18', 'Tax Percentage': '18', 'Tax Type': 'Tax Group' }),
  billLine('B-2', 'Elm Works', 'business_gst'),             // registered vendor, no tax, no exemption, no reverse charge
  billLine('B-2', 'Elm Works', 'business_gst', { 'Tax Name': 'GST18', 'Tax Percentage': '18', 'Tax Type': 'Tax Group' }),
  billLine('B-3', 'Fir Traders', 'business_none'),          // an unregistered vendor needs no tax
]);
const journals = () => file(JRN, [
  jl(1, 'Office Rent', '100.00', ''), jl(1, 'Maple Bank Savings', '', '100.00'),
  jl(2, 'Office Rent', '50.00', ''), jl(2, 'Cedar Bank Current', '', '50.00'),         // the bank account that is refused
  jl(3, 'Term Loan: Birch', '10.00', ''), jl(3, 'Maple Bank Savings', '', '10.00'),     // the watch list account
  jl(4, 'Accounts Receivable', '20.00', '', { 'Contact Name': 'Alder Retail' }), jl(4, 'Service Income', '', '20.00'),
  jl(5, 'TDS Payable', '5.00', ''), jl(5, 'Office Rent', '', '5.00'),                   // Zoho's own account exists, whatever happens to our row
  jl(6, 'Office Rent', '7.00', ''), jl(6, 'Service Income', '', '6.00'),                // does not balance
  jl(7, 'Ghost Account', '1.00', ''), jl(7, 'Office Rent', '', '1.00'),                 // not in the Chart of Accounts at all
]);
const all = () => ({ accounts: accounts(), customers: customers(), vendors: vendors(), items: items(), invoices: invoices(), bills: bills(), journals: journals() });
const byKey = result => Object.fromEntries(result.files.map(f => [f.key, f]));
const causeIds = f => f.causes.map(c => c.id);
const rowNumbers = (f, id) => causeRows(f, id, { limit: 1000 }).rows.map(r => r.rowNumber);

test('the engine understands every rule of the files it checks: applied, or listed with the reason it is not about the file', () => {
  const result = checkFiles(all(), { homeState: 'KA' });
  for (const f of result.files) {
    const total = moduleRules(f.key).length;
    assert.equal(f.rulesApplied + f.notChecked.length, total, f.key);
    for (const n of f.notChecked) assert.doesNotMatch(n.reason, /not one this engine knows|is not known/, `${n.ruleId}: ${n.reason}`);
  }
  // the journal files share the rules of Manual Journals; a file with no rules is not checked silently
  assert.equal(moduleRules('other_journals').length, moduleRules('journals').length);
  assert.ok(moduleRules('opening_balances_for_zoho_accounts').length > moduleRules('journals').length);
  // every rule id is unique and every error message names rules that exist
  const ids = [...RULES.general.rules, ...Object.values(RULES.modules).flatMap(m => m.rules || [])].map(r => r.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const e of RULES.lists.error_messages) for (const id of e.rule_ids) assert.ok(ids.includes(id), id);
});

test('Chart of Accounts: Zoho\'s own accounts, a bank opening balance, and the later row of a repeated name', () => {
  const f = byKey(checkFiles(all(), { homeState: 'KA' })).accounts;
  assert.deepEqual(rowNumbers(f, 'COA-BANK-NO-OB'), [3]);
  // changed on purpose (wizard-check batch): the list of Zoho's own accounts was read from two live new India
  // organisations. "Rent Expense" is in both, so it is no longer "only said to be created" (may be refused): Zoho has
  // it, like TDS Payable. No name of the list is documentation-only any more.
  assert.deepEqual(rowNumbers(f, 'COA-NAME-NOT-ZOHO-ACCOUNT'), [5, 6]);
  assert.equal(f.causes.find(c => c.id === 'COA-NAME-NOT-ZOHO-ACCOUNT:documented'), undefined);
  // a name a help page gave and neither live organisation has is an ordinary account: nothing is said about it
  const plain = byKey(checkFiles({ accounts: file(ACC, [acc('Parking', 'Expense'), acc('Input CESS', 'Other Current Asset'), acc('Material', 'Expense')]) }, { homeState: 'KA' })).accounts;
  assert.equal(plain.causes.find(c => /^COA-NAME-NOT-ZOHO-ACCOUNT/.test(c.id)), undefined);
  // and the two names the live organisations have that the help pages did not give are Zoho's own
  const own = byKey(checkFiles({ accounts: file(ACC, [acc('Materials', 'Cost Of Goods Sold'), acc('Investments', 'Equity')]) }, { homeState: 'KA' })).accounts;
  assert.deepEqual(rowNumbers(own, 'COA-NAME-NOT-ZOHO-ACCOUNT'), [2, 3]);
  // changed on purpose (test 2): the type the loan is written with is a valid Zoho India type, so the row passes; the old name is refused
  assert.equal(f.causes.find(c => c.id === 'COA-TYPE-ALLOWED'), undefined);
  const old = byKey(checkFiles({ accounts: file(ACC, [acc('Term Loan: Birch', 'Long Term Liability')]) }, { homeState: 'KA' })).accounts;
  assert.deepEqual([rowNumbers(old, 'COA-TYPE-ALLOWED'), old.causes.find(c => c.id === 'COA-TYPE-ALLOWED').tier], [[2], 'will']);
  // Zoho imports the first row of a name and refuses the later one
  assert.deepEqual(rowNumbers(f, 'COA-NAME-UNIQUE'), [9]);
  assert.deepEqual([f.rows, f.rowsWill, f.rowsMay, f.rowsOk, f.rowsWithWarnings], [8, 4, 0, 4, 0]);
  assert.deepEqual([f.percent, f.percentLow], [50, 50]);
  const bank = f.causes.find(c => c.id === 'COA-BANK-NO-OB');
  assert.deepEqual([bank.tier, bank.tierLabel, bank.evidenceLevel, bank.evidenceLabel, bank.place.screen], ['will', 'Will be refused', 'confirmed', 'Confirmed by our import', 'screen-25']);
  assert.ok(bank.message && bank.fix);
});

test('contacts and items: duplicate display name, empty selling rate, 5-digit HSN', () => {
  const r = byKey(checkFiles(all(), { homeState: 'KA' }));
  assert.deepEqual(rowNumbers(r.vendors, 'VEN-NAME-UNIQUE'), [4], 'only the later row');
  assert.deepEqual([r.vendors.rowsWill, r.customers.rowsWill, r.customers.rowsMay, r.customers.percent], [1, 0, 0, 100]);
  assert.deepEqual(rowNumbers(r.items, 'ITM-RATE-REQUIRED'), [2]);
  assert.deepEqual(rowNumbers(r.items, 'ITM-HSN-FORMAT'), [3]);
  // ALL rules are applied to a row: Zoho would show only one of these two at a time
  assert.ok(causeIds(r.items).includes('ITM-PURCHASE-ACCOUNT-REQUIRED'));
  assert.deepEqual([r.items.rows, r.items.rowsWill, r.items.rowsOk], [3, 2, 1]);
  assert.equal(r.items.causes.find(c => c.id === 'ITM-HSN-FORMAT').place.anchor, 'ms-hsn');
});

test('documents are refused as a whole; names must exist in the master file being imported', () => {
  const r = byKey(checkFiles(all(), { homeState: 'KA' }));
  const inv = r.invoices;
  assert.deepEqual(rowNumbers(inv, 'INV-HSN-FORMAT'), [3]);
  assert.deepEqual(rowNumbers(inv, 'INV-CUSTOMER-EXISTS'), [5]);
  // INV-1 has two lines and one is wrong: both rows are refused; INV-2 imports
  assert.deepEqual([inv.rows, inv.documents, inv.rowsWill, inv.docsWill, inv.rowsOk, inv.docsOk], [4, 3, 3, 2, 1, 1]);
  assert.deepEqual([...inv.detail.status], [3, 3, 0, 3]);
  // bills without a Total column: only the registered vendor's line without tax fails, and takes its bill with it
  const bil = r.bills;
  assert.deepEqual(rowNumbers(bil, 'BIL-TAX-REQUIRED-REGISTERED'), [3]);
  assert.deepEqual([bil.rows, bil.documents, bil.rowsWill, bil.docsWill, bil.docsOk], [4, 3, 2, 1, 2]);
  assert.ok(!causeIds(bil).some(id => id.startsWith('BIL-TOTAL-COLUMNS-OMIT')));
});

test('bills with an empty Total column are refused, every row (Zoho reads it as 0)', () => {
  const withTotal = checkFiles({ ...all(), bills: bills([...BIL, 'Total']) }, { homeState: 'KA' });
  const bil = byKey(withTotal).bills;
  assert.deepEqual(rowNumbers(bil, 'BIL-TOTAL-COLUMNS-OMIT'), [2, 3, 4, 5]);
  assert.deepEqual([bil.rowsWill, bil.docsWill, bil.percent], [4, 3, 0]);
  assert.equal(bil.causes.find(c => c.id === 'BIL-TOTAL-COLUMNS-OMIT').place.screen, 'screen-23');
});

test('journals: a cascade from a refused account, Zoho\'s own accounts, balance, and an account that is nowhere', () => {
  const r = byKey(checkFiles(all(), { homeState: 'KA' }));
  const j = r.journals;
  const cascade = j.causes.find(c => c.id === 'JRN-ACCOUNT-EXISTS:cascade');
  assert.deepEqual([cascade.tier, cascade.rows, cascade.documents, cascade.cascadeFrom, cascade.place.screen, cascade.place.anchor], ['will', 1, 1, 'accounts', 'screen-38', 'zc-file-accounts']);
  assert.match(cascade.message, /Nothing is wrong with the row itself/);
  assert.deepEqual(rowNumbers(j, 'JRN-ACCOUNT-EXISTS:cascade'), [5]);
  // the long term loan account is written with a valid type now: no warning, the journal that uses it imports
  assert.equal(j.causes.find(c => c.id === 'JRN-ACCOUNT-EXISTS:watch'), undefined);
  assert.deepEqual(rowNumbers(j, 'JRN-ACCOUNT-EXISTS'), [14], 'an account that is in no file and is not one of Zoho\'s');
  assert.deepEqual(rowNumbers(j, 'JRN-BALANCED'), [12]);
  // journal 1, 3 (watch) and 4 (Accounts Receivable with its customer) import; journal 5 has a line on TDS Payable, Zoho's
  // own account, but no import has shown a journal line on it yet: "may be refused" (TDS-024)
  assert.deepEqual([j.rows, j.documents, j.docsWill, j.docsMay, j.docsOk, j.rowsWill, j.rowsOk], [14, 7, 3, 1, 3, 6, 6]);
  assert.deepEqual([...j.detail.docStatus], [0, 3, 0, 0, 2, 3, 3]);
  assert.deepEqual(j.causes.filter(c => c.tier === 'may').map(c => [c.id, c.evidenceLevel]), [['JRN-TDS-PAYABLE-LINE', 'assumed']]);
});

test('overall prediction, the summary without rows, and files that are all fine', () => {
  const result = checkFiles(all(), { homeState: 'KA' });
  const o = result.overall;
  assert.equal(o.rows, result.files.reduce((t, f) => t + f.rows, 0));
  assert.equal(o.rowsOk + o.rowsMay + o.rowsWill, o.rows);
  assert.equal(o.docsOk + o.docsMay + o.docsWill, o.documents);
  assert.ok(o.percentRowsLow <= o.percentRows && o.percentRows < 100);
  const s = summaryOf(result);
  assert.ok(s.files.every(f => !('detail' in f)));
  assert.ok(JSON.stringify(s).length < 60000);
  // a clean set of files: 100%, nothing blocking
  const clean = checkFiles({
    accounts: file(ACC, [acc('Office Rent', 'Expense'), acc('Maple Bank Savings', 'Bank'), acc('Service Income', 'Income'), acc('Cash Box', 'Cash'), acc('Owner Funds', 'Equity', '10.00', 'Credit')]),
    customers: customers(),
    vendors: file(VEN, [contact('Elm Works', 'business_gst', GSTIN_KA, 'KA'), contact('Fir Traders', 'business_none', '', 'KA')]),
    items: file(ITM, [{ 'Item Name': 'Audit Day', 'HSN/SAC': '998311', Rate: '50.00', 'Product Type': 'service', Account: 'Service Income', 'Item Type': 'Sales', Status: 'Active' }]),
    invoices: file(INV, [invLine('INV-2', 'Alder Retail')]),
    bills: file(BIL, [billLine('B-1', 'Elm Works', 'business_gst', { 'Tax Name': 'GST18', 'Tax Percentage': '18', 'Tax Type': 'Tax Group' }), billLine('B-3', 'Fir Traders', 'business_none')]),
    journals: file(JRN, [jl(1, 'Office Rent', '100.00', ''), jl(1, 'Maple Bank Savings', '', '100.00')]),
    other_journals: file(JRN, [jl(2, 'Office Rent', '5.00', '', { 'Journal Number Prefix': 'PMT-' }), jl(2, 'Cash Box', '', '5.00', { 'Journal Number Prefix': 'PMT-' })]),
  }, { homeState: 'KA' });
  assert.deepEqual([clean.overall.rowsWill, clean.overall.rowsMay, clean.overall.percentRows, clean.overall.percentDocuments], [0, 0, 100, 100],
    JSON.stringify(clean.files.flatMap(f => f.causes.filter(c => c.tier !== 'warning').map(c => `${f.key} ${c.id}`))));
});

test('more rules: tax of the wrong kind for the states, required columns, names only Zoho can confirm, numbers shared by journal files', () => {
  // intra-state bill with IGST, and a tax name that is not one of Zoho's own
  const b = byKey(checkFiles({ ...all(), bills: file(BIL, [
    billLine('B-1', 'Elm Works', 'business_gst', { 'Tax Name': 'IGST18', 'Tax Percentage': '18', 'Tax Type': 'ItemAmount' }),
    billLine('B-2', 'Elm Works', 'business_gst', { 'Tax Name': 'My Own Tax', 'Tax Percentage': '18', 'Tax Type': 'Tax Group' }),
    billLine('B-3', 'Elm Works', 'business_gst', { 'Tax Name': 'GST18', 'Tax Percentage': '18%', 'Tax Type': 'Tax Group' }),
  ]) }, { homeState: 'KA' })).bills;
  assert.deepEqual(rowNumbers(b, 'BIL-TAX-INTRA-INTER'), [2]);
  const unverified = b.causes.find(c => c.id === 'BIL-TAX-EXISTS:unverified');
  assert.deepEqual([unverified.tier, unverified.rows, unverified.place.screen], ['may', 1, null]);
  assert.deepEqual(rowNumbers(b, 'GEN-PERCENT-NO-SIGN'), [4]);
  // ... unless the user saved that name as a tax that exists in Zoho Books
  const known = byKey(checkFiles({ ...all(), bills: file(BIL, [billLine('B-2', 'Elm Works', 'business_gst', { 'Tax Name': 'My Own Tax', 'Tax Percentage': '18', 'Tax Type': 'Tax Group' })]) }, { homeState: 'KA', zohoNames: { taxes: ['My Own Tax'] } })).bills;
  assert.ok(!causeIds(known).includes('BIL-TAX-EXISTS:unverified'));
  // a TDS Name that cannot be checked: the cause says exactly what to do, with each name, section and rate
  const TDS = [...BIL, 'TDS Name', 'TDS Percentage', 'TDS Section Code', 'TDS Amount'];
  const tdsBills = byKey(checkFiles({ ...all(), bills: file(TDS, [
    billLine('B-7', 'Fir Traders', 'business_none', { 'TDS Name': 'Professional Fees', 'TDS Percentage': '10', 'TDS Amount': '10.00' }),
    billLine('B-8', 'Fir Traders', 'business_none', { 'TDS Name': 'Commission or Brokerage', 'TDS Percentage': '5', 'TDS Section Code': '194H', 'TDS Amount': '5.00' }),
  ]) }, { homeState: 'KA' })).bills;
  const tdsCause = tdsBills.causes.find(c => c.id === 'BIL-TDS-NAME-EXISTS:unverified');
  assert.deepEqual([tdsCause.tier, tdsCause.rows, tdsCause.place.screen, tdsCause.place.params.step], ['may', 2, 'screen-40', 'setup']);
  assert.deepEqual(tdsCause.tdsTaxes.map(t => [t.name, t.section, t.rate]), [['Commission or Brokerage', '194H', '5'], ['Professional Fees', '194J or 194JB', '10']]);
  assert.match(tdsCause.fix, /^Create these TDS taxes in Zoho with these names, or upload Zoho's TDS export: Commission or Brokerage \(section 194H, 5%\); Professional Fees \(section 194J or 194JB, 10%\)\./);
  assert.match(tdsCause.message, /Names in this file: Commission or Brokerage/);
  // once the names are known (TDS mapping or Zoho's TDS export) there is nothing to say
  const tdsKnown = byKey(checkFiles({ ...all(), bills: file(TDS, [billLine('B-7', 'Fir Traders', 'business_none', { 'TDS Name': 'Professional Fees', 'TDS Percentage': '10', 'TDS Amount': '10.00' })]) },
    { homeState: 'KA', zohoNames: { tds_taxes: ['Professional Fees'] } })).bills;
  assert.ok(!causeIds(tdsKnown).includes('BIL-TDS-NAME-EXISTS:unverified'));
  // a required column that is not in the file at all: every row
  const noNotes = byKey(checkFiles({ accounts: accounts(), journals: file(JRN.filter(h => h !== 'Notes'), [jl(1, 'Office Rent', '1.00', ''), jl(1, 'Service Income', '', '1.00')]) })).journals;
  const missing = noNotes.causes.find(c => c.id === 'GEN-REQUIRED-MAPPED:missing:Notes');
  assert.deepEqual([missing.wholeFile, missing.tier, noNotes.rowsWill], [true, 'will', 2]);
  // the same journal number in two journal files (assumed rule: may be refused)
  const two = byKey(checkFiles({ accounts: accounts(), journals: file(JRN, [jl(1, 'Office Rent', '1.00', ''), jl(1, 'Service Income', '', '1.00')]),
    other_journals: file(JRN, [jl(1, 'Office Rent', '2.00', ''), jl(1, 'Service Income', '', '2.00')]) }));
  assert.equal(two.other_journals.causes.find(c => c.id === 'JRN-NUMBER-UNIQUE:other_file').tier, 'may');
  assert.deepEqual([two.other_journals.rowsMay, two.journals.rowsMay], [2, 0]);
  // helpers
  assert.deepEqual([toPaise('12.5'), toPaise('0.07'), toPaise('-3'), toPaise(''), Number.isNaN(toPaise('1,000'))], [1250, 7, -300, 0, true]);
  assert.deepEqual([evidenceLevel('Zoho sample file'), evidenceLevel('forum'), evidenceLevel('confirmed by our import')], ['documented', 'assumed', 'confirmed']);
  assert.equal(placeForRule('CUS-GSTIN-FORMAT').anchor, 'ms-fix-contacts');
  assert.deepEqual(parseCsvTable('﻿A,B\r\n"x, ""y""",2\r\n\r\n"line\nbreak",3\n'), [['A', 'B'], ['x, "y"', '2'], ['line\nbreak', '3']]);
});

test('speed: a 50,000-row journal file is checked in one pass', () => {
  const rows = [];
  const names = Array.from({ length: 400 }, (_, i) => `Ledger ${i}`);
  for (let i = 0; i < 25000; i++) {
    rows.push(jl(i + 1, names[i % 400], '10.00', ''), jl(i + 1, i % 50 === 0 ? 'Cedar Bank Current' : names[(i + 7) % 400], '', '10.00'));
  }
  const big = { accounts: file(ACC, [...names.map(n => acc(n, 'Expense')), acc('Cedar Bank Current', 'Bank', '5.00', 'Debit')]), other_journals: file(JRN, rows) };
  const t0 = performance.now();
  const result = checkFiles(big);
  const ms = performance.now() - t0;
  const j = byKey(result).other_journals;
  assert.deepEqual([j.rows, j.documents, j.docsWill, j.rowsWill], [50000, 25000, 500, 1000]);
  console.log(`    50,000 rows (25,000 journals, 13 columns) checked in ${Math.round(ms)} ms`);
  assert.ok(ms < 5000, `took ${Math.round(ms)} ms`);
});

// ---------- Zoho's error file, explained ----------
const errorFile = (headers, rows) => [['ROWNUMBER', 'ERRORMESSAGE', ...headers], ...rows.map(([n, m, r]) => [String(n), m, ...headers.map(h => r[h] ?? '')])];

test('Zoho error file: real errors apart from follow-on rows, a cascade from the Chart of Accounts, and unknown messages', () => {
  const accErr = errorFile(ACC, [
    [3, 'Opening Balance cannot be associated with the given account.', acc('Cedar Bank Current', 'Bank', '1000.00', 'Debit')],
    [5, 'Row already exists', acc('TDS Payable', 'Other Current Liability')],
    [7, 'Invalid row', acc('Term Loan: Birch', 'Long Term Liability')],
  ]);
  const a = explainErrorFile(accErr, { key: 'accounts' });
  assert.deepEqual([a.zohoLayout, a.rows, a.realErrors, a.followOn, a.unassigned], [true, 3, 3, 0, 0]);
  assert.deepEqual(a.causes.map(c => c.ruleIds[0]).sort(), ['COA-BANK-NO-OB', 'COA-NAME-NOT-ZOHO-ACCOUNT', 'COA-TYPE-ALLOWED']);
  assert.ok(a.causes.every(c => c.meaning && c.fix && c.place.label && c.assigned));

  const jErr = errorFile(JRN, [
    [4, 'This error is related to Row 5 - Account.', jl(2, 'Office Rent', '50.00', '')],
    [5, 'Invalid row', jl(2, 'Cedar Bank Current', '', '50.00')],
    [6, 'Invalid row', jl(3, 'Term Loan: Birch', '10.00', '')],
    [7, 'This error is related to Row 6 - Account.', jl(3, 'Maple Bank Savings', '', '10.00')],
    [14, 'Invalid row', jl(7, 'Ghost Account', '1.00', '')],
    [15, 'This error is related to Row 14 - Account.', jl(7, 'Office Rent', '', '1.00')],
    [20, 'Something Zoho never said before 42', jl(9, 'Office Rent', '1.00', '')],
    [22, 'This error is related to Row 99 - Notes.', jl(10, 'Office Rent', '1.00', '')],
  ]);
  const refused = { accounts: refusedNames('accounts', zohoErrorRows(accErr, 'accounts').rows) };
  assert.deepEqual([...refused.accounts.keys()], ['Cedar Bank Current', 'TDS Payable', 'Term Loan: Birch']);
  const j = explainErrorRows(zohoErrorRows(jErr, 'journals').rows, { key: 'journals', refused });
  assert.deepEqual([j.rows, j.realErrors, j.followOn, j.cascadeRows, j.unassigned, j.documents], [8, 4, 4, 2, 2, 5]);
  const bank = j.causes.find(c => c.cascade?.ruleIds[0] === 'COA-BANK-NO-OB');
  assert.deepEqual([bank.rows, bank.followOnRows, bank.documents, bank.cascade.from, bank.cascade.names, bank.column, bank.ruleIds[0]], [1, 1, 1, 'accounts', 1, 'Account', 'JRN-ACCOUNT-EXISTS']);
  assert.match(bank.meaning, /Refused only because/);
  assert.match(bank.fix, /import this file again as it is/);
  assert.equal(bank.place.anchor, 'bank-opening-balances', 'the fix is where the account is fixed');
  const plain = j.causes.find(c => c.id === 'JRN-ACCOUNT-EXISTS');
  assert.deepEqual([plain.rows, plain.followOnRows, plain.cascade], [1, 1, null]);
  const unknown = j.causes.find(c => c.id.startsWith('unknown:'));
  assert.deepEqual([unknown.rows, unknown.assigned, unknown.zohoMessage], [1, false, 'Something Zoho never said before N']);
  assert.equal(j.causes.find(c => c.id === 'follow-on-without-its-row').followOnRows, 1);
  // without the Chart of Accounts error file the journals are explained, but not as a cascade
  const alone = explainErrorFile(jErr, { key: 'journals' });
  assert.deepEqual([alone.cascadeRows, alone.causes.find(c => c.id === 'JRN-ACCOUNT-EXISTS').rows], [0, 3]);
  // messages: figures do not split a cause; a file in another layout is not Zoho's
  const bErr = errorFile(BIL, [[2, 'The given total value 0 and the system generated total value 1,180.00 are not same.', billLine('B-1', 'Elm Works', 'business_gst')],
    [3, 'The given total value 0 and the system generated total value 95 are not same.', billLine('B-2', 'Elm Works', 'business_gst')],
    [4, 'Specify either a Tax or Tax Exemption or Reverse Charge.', billLine('B-3', 'Elm Works', 'business_gst')]]);
  const b = explainErrorFile(bErr, { key: 'bills' });
  assert.deepEqual(b.causes.map(c => [c.ruleIds[0], c.rows, c.documents]), [['BIL-TOTAL-COLUMNS-OMIT', 2, 2], ['BIL-TAX-REQUIRED-REGISTERED', 1, 1]]);
  assert.equal(explainErrorFile([['Invoice Number', 'Error'], ['INV-1', 'bad']], { key: 'invoices' }).zohoLayout, false);
  assert.equal(matchErrorMessage('items', 'Enter the selling price of the item.').entry.rule_ids[0], 'ITM-RATE-REQUIRED');
  assert.equal(matchErrorMessage('journals', 'This error is related to Row 12 - Account.').row, 12);
  // the Rejection Manager's own reader: the follow-on message is not a message of the record, and row numbers are kept
  const cols = detectRejectionColumns(jErr, { idHeading: 'Reference Number' });
  assert.deepEqual([cols.idColumn, cols.errorColumn], ['Reference Number', 'ERRORMESSAGE']);
  const rec = rejectionRecords(jErr, cols).records.find(x => x.ident === 'J-2');
  assert.deepEqual([rec.messages, rec.rowNumbers], [['Invalid row'], [4, 5]]);
});

// ---------- end to end ----------
const { buildApp } = await import('../src/index.js');
const { safeText } = await import('../src/zohocheckapi.js');
const { mastersDoc, VOUCHERS, transactionsDoc, trialBalanceReport, utf16le } = await import('../fixtures/allTransactions.js');
const here = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(fs.readFileSync(path.resolve(here, '../seed-users.json'), 'utf8'));
const app = buildApp();
let cookie = '';
const call = opts => app.inject({ ...opts, headers: { ...(opts.headers || {}), ...(cookie ? { cookie } : {}) } });
const get = async url => { const r = await call({ url }); assert.equal(r.statusCode, 200, `${url}: ${r.body}`); return r.json(); };
const put = (id, slot, obj, name) => call({ method: 'PUT', url: `/api/migrations/${id}/uploads/${slot}`, headers: { 'content-type': 'application/octet-stream', 'x-filename': name }, payload: utf16le(obj) });
const send = (method, url, payload) => call({ method, url, ...(payload !== undefined ? { payload } : {}) });
const login = async role => {
  const u = seed.users.find(x => x.role === role);
  cookie = String((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: u.password } })).headers['set-cookie']).split(';')[0];
};

test('end to end: the check runs when the files are created; summary, rows behind a cause, CSV, viewers, out of date', async () => {
  await login('analyst');
  const viewerCompany = seed.users.find(x => x.role === 'viewer').company || 'Sample Masters Co';
  const id = (await send('POST', '/api/migrations', { company: viewerCompany, financialYear: '2024-25' })).json().id;
  const base = `/api/migrations/${id}`;
  assert.equal((await put(id, 'all_masters', mastersDoc(), 'Master.json')).statusCode, 200);
  assert.equal((await put(id, 'all_transactions', transactionsDoc(VOUCHERS), 'Transactions.json')).statusCode, 200);
  await send('PUT', `${base}/waivers/stock_summary`, { reason: 'Not needed for test' });
  assert.equal((await put(id, 'trial_balance', trialBalanceReport(), 'TrialBal.json')).statusCode, 200);
  assert.equal((await send('POST', `${base}/process?wait=1`)).statusCode, 200);

  // before the files exist there is nothing to check
  assert.equal((await get(`${base}/zoho-check`)).available, false);
  assert.equal((await send('GET', `${base}/zoho-check/rows?file=accounts&cause=x`)).statusCode, 409);
  assert.equal((await send('GET', `${base}/zoho-check/findings.csv`)).statusCode, 409);

  const g = await send('POST', `${base}/generate`);
  assert.equal(g.statusCode, 200, g.body);
  // the check ran with the files: its result is stored before anyone asks for it
  const audits = await get(`${base}/audit`).catch(() => null);
  if (audits) assert.ok(!JSON.stringify(audits).includes('zoho_check_failed'), 'the check did not fail');
  const s = await get(`${base}/zoho-check`);
  assert.equal(s.available, true);
  assert.equal(s.outOfDate, false);
  assert.ok(s.checkedAt && s.rulesVersion);
  // every file that is imported is checked, with the rows of the file; the reference report is not
  const files = (await get(`${base}/files`));
  const imported = files.filter(f => !f.referenceOnly);
  assert.deepEqual(s.files.map(f => f.key).sort(), imported.map(f => f.key).sort());
  for (const f of s.files) {
    assert.equal(f.rows, imported.find(x => x.key === f.key).rows, f.key);
    assert.equal(f.rowsOk + f.rowsMay + f.rowsWill, f.rows, f.key);
    assert.equal(f.docsOk + f.docsMay + f.docsWill, f.documents, f.key);
    assert.equal(f.blocking, f.rowsWill > 0);
    assert.ok(f.percentLow <= f.percent);
  }
  assert.ok(s.filesNotChecked.every(f => files.find(x => x.key === f.key)?.referenceOnly));
  assert.equal(s.overall.rows, s.files.reduce((t, f) => t + f.rows, 0));
  assert.ok(s.rulesApplied > 100 && s.rulesNotAboutTheFile > 0);
  // causes: each with its count, words, fix, how sure it is and the screen; the per-file counts add up
  for (const c of s.causes) {
    assert.ok(['will', 'may', 'warning'].includes(c.tier) && c.message && c.fix && c.evidenceLabel && c.place?.label, c.id);
    assert.equal(c.files.reduce((t, f) => t + f.rows, 0), c.rows, c.id);
  }
  // the rows behind every cause, in pages; a row number is the row of the file (the heading row is row 1)
  for (const c of s.causes) {
    for (const f of c.files) {
      const page = await get(`${base}/zoho-check/rows?file=${f.key}&cause=${encodeURIComponent(f.cause)}&pageSize=2`);
      if (f.wholeFile && !page.total) continue;
      assert.ok(page.total >= 1 && page.rows.length <= 2 && page.pages === Math.ceil(page.total / 2), `${f.key} ${f.cause}`);
      assert.ok(page.rows.every(r => r.rowNumber >= 2 && r.values && typeof r.ident === 'string'));
    }
  }
  assert.equal((await send('GET', `${base}/zoho-check/rows?file=nowhere&cause=x`)).statusCode, 400);
  assert.equal((await send('GET', `${base}/zoho-check/rows?file=${s.files[0].key}&cause=NOT-A-RULE`)).statusCode, 400);

  // the CSV of all findings
  const csv = await call({ url: `${base}/zoho-check/findings.csv` });
  assert.equal(csv.statusCode, 200);
  assert.equal(csv.body.charCodeAt(0), 0xfeff, 'starts with a byte order mark for Excel');
  assert.match(csv.headers['content-disposition'], /zoho_check_/);
  const table = parseCsvTable(csv.body);
  assert.deepEqual(table[0].slice(0, 5), ['File', 'Row in the file', 'Record', 'Zoho is expected to', 'Rule']);
  const perRow = s.files.reduce((t, f) => t + f.causes.reduce((u, c) => u + (c.wholeFile && c.rows === f.rows ? 0 : 0), 0), 0);
  assert.ok(table.length - 1 >= s.causes.length - perRow);
  assert.deepEqual(['=1+1', '+91', '-5', '@x', 'INV-1', 12].map(safeText), ["'=1+1", "'+91", "'-5", "'@x", 'INV-1', 12]);

  // downloading a file with blocking problems anyway is written to the audit log
  const blocking = s.files.find(f => f.blocking) || s.files[0];
  assert.equal((await send('POST', `${base}/zoho-check/acknowledge`, { key: blocking.key })).statusCode, 200);
  assert.equal((await send('POST', `${base}/zoho-check/acknowledge`, { key: 'nowhere' })).statusCode, 404);

  // viewers read all of it, and change nothing
  await login('viewer');
  assert.equal((await get(`${base}/zoho-check`)).available, true);
  assert.equal((await call({ url: `${base}/zoho-check/findings.csv` })).statusCode, 200);
  assert.equal((await send('POST', `${base}/zoho-check/acknowledge`, { key: blocking.key })).statusCode, 403);
  await login('analyst');

  // out of date with the files; up to date again when they are created again; gone when the data is processed again
  await send('PUT', `${base}/voucher-settings`, { documentStatus: 'draft' });
  const stale = await get(`${base}/zoho-check`);
  assert.equal(stale.outOfDate, true);
  assert.ok(stale.outOfDateReasons.length > 0 && stale.files.some(f => f.outOfDate));
  assert.equal((await send('POST', `${base}/generate`)).statusCode, 200);
  const again = await get(`${base}/zoho-check`);
  assert.equal(again.outOfDate, false);
  assert.ok(again.checkedAt >= s.checkedAt);
  assert.equal((await send('POST', `${base}/process?wait=1`)).statusCode, 200);
  assert.equal((await get(`${base}/zoho-check`)).available, false);
});

test('Rejection Manager: Zoho error files of a migration are explained by root cause, with a journal refused because of its account', async () => {
  await login('analyst');
  const company = seed.users.find(x => x.role === 'viewer').company || 'Sample Masters Co';
  const id = (await send('POST', '/api/migrations', { company, financialYear: '2024-25' })).json().id;
  const base = `/api/migrations/${id}`;
  assert.equal((await put(id, 'all_masters', mastersDoc(), 'Master.json')).statusCode, 200);
  assert.equal((await put(id, 'all_transactions', transactionsDoc(VOUCHERS), 'Transactions.json')).statusCode, 200);
  await send('PUT', `${base}/waivers/stock_summary`, { reason: 'Not needed for test' });
  assert.equal((await put(id, 'trial_balance', trialBalanceReport(), 'TrialBal.json')).statusCode, 200);
  assert.equal((await send('POST', `${base}/process?wait=1`)).statusCode, 200);
  assert.equal((await send('POST', `${base}/generate`)).statusCode, 200);
  const read = async key => { const r = await call({ url: `${base}/files/${key}/download?confirmed=1` }); assert.equal(r.statusCode, 200, key); return parseCsvTable(r.body); };
  // a journal line and the Chart of Accounts row of its account
  const files = (await get(`${base}/files`)).map(f => f.key);
  const jKey = ['other_journals', 'journals'].find(k => files.includes(k));
  const acc = await read('accounts'), jrn = await read(jKey);
  const aName = acc[0].indexOf('Account Name'), jAcc = jrn[0].indexOf('Account');
  const names = new Set(acc.slice(1).map(r => r[aName].trim()));
  const ji = jrn.findIndex((r, i) => i > 0 && names.has(r[jAcc].trim()));
  assert.ok(ji > 0, 'a journal line names an account of the Chart of Accounts file');
  const ai = acc.findIndex((r, i) => i > 0 && r[aName].trim() === jrn[ji][jAcc].trim());
  const csv = t => t.map(r => r.map(c => (/[",\r\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\r\n');
  const errorCsv = (table, list) => csv([['ROWNUMBER', 'ERRORMESSAGE', ...table[0]], ...list.map(([i, m]) => [String(i + 1), m, ...table[i]])]);
  const upload = (key, text) => call({ method: 'PUT', url: `${base}/rejections/${key}`, headers: { 'content-type': 'application/octet-stream', 'x-filename': `${key}_errors.csv` }, payload: Buffer.from(text, 'utf8') });
  assert.equal((await upload('accounts', errorCsv(acc, [[ai, 'Row already exists']]))).statusCode, 200);
  // the real error on the line, and Zoho's follow-on message on a second line pointing at it
  const other = jrn.findIndex((r, i) => i > 0 && i !== ji);
  assert.equal((await upload(jKey, errorCsv(jrn, [[ji, 'Invalid row'], [other, `This error is related to Row ${ji + 1} - Account.`]]))).statusCode, 200);
  const g = await get(`${base}/rejections/groups`);
  assert.deepEqual(g.explained.map(f => f.key), ['accounts', jKey], 'in the order the files are imported');
  const [a, j] = g.explained;
  assert.deepEqual([a.rows, a.realErrors, a.unassigned, a.causes[0].ruleIds[0]], [1, 1, 0, 'COA-NAME-NOT-ZOHO-ACCOUNT']);
  assert.deepEqual([j.rows, j.realErrors, j.followOn, j.cascadeRows, j.unassigned], [2, 1, 1, 1, 0]);
  const c = j.causes[0];
  assert.deepEqual([c.cascade.from, c.cascade.ruleIds[0], c.rows, c.followOnRows, c.place.anchor], ['accounts', 'COA-NAME-NOT-ZOHO-ACCOUNT', 1, 1, 'ms-zoho-accounts']);
  assert.ok(c.meaning && c.fix);
  // viewers read the explanation
  await login('viewer');
  assert.equal((await get(`${base}/rejections/groups`)).explained.length, 2);
  await login('analyst');
});
