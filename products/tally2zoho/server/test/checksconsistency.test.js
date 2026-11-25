// Fix set S5 "checks consistency": the Zoho check and the expected trial balance describe the same files, and Zoho
// behaviour that no import has shown yet is "may be refused", never ready. Every company, name, GSTIN and amount here is
// MADE UP.
//  - SYN-4  the expected trial balance leaves out what the check says Zoho will refuse, names it on every account and
//           contact it touches, and lists (but posts) what Zoho may refuse
//  - TDS-011 one list of the TDS taxes that exist (tds.js knownTdsTaxes): Zoho's default taxes count on their dates
//  - TDS-002 a name only chosen in Mapping Studio is "chosen, not checked": it stays "may be refused"
//  - TDS-024 journal lines on TDS Payable; a tax the export marks Inactive
//  - TDS-005 a TDS Amount that is not the TDS Percentage of the base
//  - GST-006 journal lines on Zoho's own GST accounts
//  - GST-024 a 0% tax on a bill of a registered, composition or SEZ vendor; a taxed line with no state
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Decimal from 'decimal.js';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-s5-'));
const { checkFiles } = await import('../src/zohocheck.js');
const T = await import('../src/tds.js');
const { NameSet } = await import('../src/tally.js');
const { buildVoucherOutput, taxLedgerInfo, BILL_HEADERS } = await import('../src/vouchers.js');
const D = await import('../src/defaults.js');
const { predictedTrialBalance, predictedCsv } = await import('../src/predictedtb.js');
const { tdsTaxesInFiles } = await import('../src/importwizard.js');
const { DatabaseSync } = await import('node:sqlite');

const file = (headers, rows) => ({ headers, rows: rows.map(r => headers.map(h => String(r[h] ?? ''))), bytes: 1000 });
const causesOf = (res, key) => res.files.find(f => f.key === key).causes;
const notWarnings = (res, key) => causesOf(res, key).filter(c => c.tier !== 'warning').map(c => [c.id, c.tier]);

// ---------- TDS-011: which TDS taxes exist ----------
test('TDS-011: knownTdsTaxes gives Zoho\'s default taxes only on their dates, and the export as it is', () => {
  const on = d => T.knownTdsTaxes(null, d).map(t => t.name);
  assert.ok(on('2026-06-03').includes('Payment of contractors HUF/Indiv'), 'a default tax on a date it is valid for');
  assert.ok(!on('2025-06-03').includes('Payment of contractors HUF/Indiv'), 'not before its start date');
  assert.ok(T.knownTdsTaxes(null, '').length >= 6, 'with no date: every default tax');
  // the export is the organisation as it is: its own row of a default name wins, and it keeps its status
  const exported = [{ name: 'Payment of contractors HUF/Indiv', rate: '1', section: 'contract_payments_individual_or_huf', start: '2026-04-01', end: '', status: 'Inactive' }, { name: 'Custom Fees', rate: '10', section: '194J', start: '', end: '', status: 'Active' }];
  const k = T.knownTdsTaxes(exported, '2026-06-03');
  assert.deepEqual(k.filter(t => t.name === 'Payment of contractors HUF/Indiv').map(t => [t.evidence, t.status]), [['zoho_export', 'Inactive']]);
  assert.ok(k.some(t => t.name === 'Custom Fees' && t.evidence === 'zoho_export'));
  assert.equal(T.isDefaultTdsTax('Commission or Brokerage', '2', 'commission_or_brokerage'), true);
  assert.equal(T.isDefaultTdsTax('Commission or Brokerage', '5', '194H'), false, 'the same name at another rate is not Zoho\'s tax');
  // the generator: a 194C 1% bill of 2026 names Zoho's default tax and creates nothing
  const r = T.resolveTds({ amount: new Decimal('100'), subTotal: new Decimal('10000'), taxTotal: new Decimal('0'), date: '2026-06-10', suggestion: { section: '194C', percent: '1' }, settings: {} });
  assert.deepEqual([r.tdsName, r.nameFrom, r.create], ['Payment of contractors HUF/Indiv', 'zoho_default', false]);
});

const TDS_BILL = ['Bill Date', 'Bill Number', 'Vendor Name', 'Account', 'Rate', 'Quantity', 'GST Treatment', 'TDS Name', 'TDS Percentage', 'TDS Section Code', 'TDS Amount'];
const tdsBill = (n, date, name, pct, section, over = {}) => ({ 'Bill Date': date, 'Bill Number': n, 'Vendor Name': 'Quill Contractors', Account: 'Site Work', Rate: '10000.00', Quantity: '1', 'GST Treatment': 'business_none', 'TDS Name': name, 'TDS Percentage': pct, 'TDS Section Code': section, 'TDS Amount': '100.00', ...over });

test('TDS-011: the check counts Zoho\'s default tax as existing on its dates and never tells to create it', () => {
  const name = 'Payment of contractors HUF/Indiv', sec = 'contract_payments_individual_or_huf';
  const after = checkFiles({ bills: file(TDS_BILL, [tdsBill('QB-1', '2026-06-03', name, '1', sec)]) }, { homeState: 'KA' });
  assert.ok(!causesOf(after, 'bills').some(c => c.ruleId === 'BIL-TDS-NAME-EXISTS'), 'dated after the start: the tax exists, nothing to say');
  const before = checkFiles({ bills: file(TDS_BILL, [tdsBill('QB-2', '2025-06-03', name, '1', sec)]) }, { homeState: 'KA' });
  const c = causesOf(before, 'bills').find(x => x.id === 'BIL-TDS-NAME-EXISTS:unverified');
  assert.equal(c.tier, 'may', 'dated before Zoho has the tax: not proven');
  assert.doesNotMatch(c.fix, /^Create these TDS taxes/, 'never "create" a tax Zoho has by itself');
  assert.match(c.fix, /has by itself from 2026-04-01/);
});

// ---------- TDS-002: a choice is not proof ----------
test('TDS-002: a name only chosen in Mapping Studio stays "may be refused"; the export decides; an Inactive tax may be refused', () => {
  const rows = [tdsBill('QB-3', '2025-08-01', 'Profesional Fees', '10', '194J')]; // a misspelt name, chosen by hand
  const chosen = checkFiles({ bills: file(TDS_BILL, rows) }, { homeState: 'KA', tdsChosen: ['Profesional Fees'] });
  const c = causesOf(chosen, 'bills').find(x => x.ruleId === 'BIL-TDS-NAME-EXISTS');
  assert.deepEqual([c.id, c.tier, c.evidenceLevel], ['BIL-TDS-NAME-EXISTS:chosen', 'may', 'assumed']);
  assert.match(c.message, /chosen in Mapping Studio/);
  assert.equal(c.rows, 1);
  // with Zoho's TDS export holding the name: nothing to say
  const exported = [{ name: 'Profesional Fees', rate: '10', section: '194J', start: '', end: '', status: 'Active' }];
  const proven = checkFiles({ bills: file(TDS_BILL, rows) }, { homeState: 'KA', tdsChosen: ['Profesional Fees'], tdsExportGiven: true, zohoTdsTaxes: exported, zohoNames: { tds_taxes: ['Profesional Fees'] } });
  assert.ok(!causesOf(proven, 'bills').some(x => x.ruleId === 'BIL-TDS-NAME-EXISTS'));
  // the export marks it Inactive: may be refused (TDS-024)
  const inactive = checkFiles({ bills: file(TDS_BILL, rows) }, { homeState: 'KA', tdsExportGiven: true, zohoTdsTaxes: [{ ...exported[0], status: 'Inactive' }], zohoNames: { tds_taxes: ['Profesional Fees'] } });
  assert.deepEqual(notWarnings(inactive, 'bills').filter(([id]) => id.startsWith('BIL-TDS-NAME-EXISTS')), [['BIL-TDS-NAME-EXISTS:inactive', 'may']]);
});

test('TDS-011: "TDS taxes to create" leaves out Zoho\'s default tax on its dates, and keeps it on a date before Zoho has it', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE generated_rows (job_id TEXT, key TEXT, row_no INTEGER, row_key TEXT, source_record_id INTEGER, source_id TEXT, row_data TEXT, ident TEXT);
    CREATE TABLE generated_files (job_id TEXT, key TEXT, columns TEXT, mapping_hash TEXT);
    CREATE TABLE zoho_tds_taxes (job_id TEXT, seq INTEGER, name TEXT, rate TEXT, section TEXT, start_date TEXT, end_date TEXT, status TEXT);
    CREATE TABLE zoho_tds_taxes_meta (job_id TEXT PRIMARY KEY, file_name TEXT, taxes INTEGER, uploaded_by TEXT, at TEXT);`);
  const add = (n, date, name, pct, sec) => db.prepare('INSERT INTO generated_rows VALUES (?,?,?,?,?,?,?,?)').run('J', 'bills', n, `r${n}`, n, `s${n}`, JSON.stringify({ 'Bill Date': date, 'TDS Name': name, 'TDS Percentage': pct, 'TDS Section Code': sec }), `i${n}`);
  add(1, '2026-05-02', 'Payment of contractors HUF/Indiv', '1', 'contract_payments_individual_or_huf');
  add(2, '2026-05-02', 'Technical Fees (2%)', '2', 'technical_services'); add(3, '2026-03-02', 'Technical Fees (2%)', '2', 'technical_services');
  const r = tdsTaxesInFiles(db, 'J', { financial_year: '2025-26' });
  assert.deepEqual(r.taxes.map(t => [t.name, t.inZoho, !!t.zohoDefault]), [['Payment of contractors HUF/Indiv', true, true], ['Technical Fees (2%)', null, false]]);
  assert.equal(r.toCreate, 1);
});

// ---------- GST-006 / TDS-024: journal lines on Zoho's own tax accounts ----------
const JRN = ['Journal Date', 'Reference Number', 'Journal Number Prefix', 'Journal Number Suffix', 'Notes', 'Journal Type', 'Currency', 'Account', 'Description', 'Contact Name', 'Debit', 'Credit', 'Status'];
const jl = (n, account, debit, credit) => ({ 'Journal Date': '2025-09-01', 'Reference Number': `R${n}`, 'Journal Number Prefix': 'JV-', 'Journal Number Suffix': String(n), Notes: 'made up', 'Journal Type': 'both', Currency: 'INR', Account: account, Debit: debit, Credit: credit, Status: 'published' });
const ZOHO = ['Office Rent', 'Main Bank', 'Input CGST', 'Output IGST', 'Reverse Charge Tax Input but not due', 'TDS Payable', 'TDS Receivable', 'GST Payable'].map(name => ({ name, accountType: 'Expense' }));

test('GST-006 / TDS-024: a journal line on Zoho\'s own GST accounts or on TDS Payable "may be refused" (assumed); GST Payable and TDS Receivable are confirmed', () => {
  const res = checkFiles({ journals: file(JRN, [
    jl(1, 'Input CGST', '18.00', ''), jl(1, 'Main Bank', '', '18.00'),
    jl(2, 'Reverse Charge Tax Input but not due', '5.00', ''), jl(2, 'Output IGST', '', '5.00'),
    jl(3, 'Office Rent', '10.00', ''), jl(3, 'TDS Payable', '', '10.00'),
    jl(4, 'GST Payable', '7.00', ''), jl(4, 'TDS Receivable', '3.00', ''), jl(4, 'Main Bank', '', '10.00'),
  ]) }, { zohoAccounts: ZOHO });
  const j = res.files.find(f => f.key === 'journals');
  const by = Object.fromEntries(j.causes.filter(c => c.tier !== 'warning').map(c => [c.id, [c.tier, c.evidenceLevel, c.rows, c.documents]]));
  assert.deepEqual(by, { 'JRN-GST-SYSTEM-ACCOUNT-LINE': ['may', 'assumed', 3, 2], 'JRN-TDS-PAYABLE-LINE': ['may', 'assumed', 1, 1] });
  assert.deepEqual([j.docsWill, j.docsMay, j.docsOk], [0, 3, 1], 'journal 4 (GST Payable, TDS Receivable) is ready; nothing is refused');
});

// ---------- GST-024 ----------
const BIL = ['Bill Date', 'Bill Number', 'Vendor Name', 'Account', 'Rate', 'Quantity', 'GST Treatment', 'GST Identification Number (GSTIN)', 'Source of Supply', 'Destination of Supply', 'Tax Name', 'Tax Percentage', 'Tax Type', 'Item Exemption Code', 'Reverse Charge Tax Name'];
const bl = (n, treatment, over = {}) => ({ 'Bill Date': '2025-09-01', 'Bill Number': n, 'Vendor Name': 'Ridge Supplies', Account: 'Office Rent', Rate: '100.00', Quantity: '1', 'GST Treatment': treatment, 'Source of Supply': 'KA', 'Destination of Supply': 'KA', ...over });
test('GST-024: a 0% tax on a bill of a registered, composition or SEZ vendor and a taxed line with no state "may be refused"', () => {
  const zero = { 'Tax Name': 'GST0', 'Tax Percentage': '0', 'Tax Type': 'Tax Group' };
  const res = checkFiles({ bills: file(BIL, [
    bl('Z-1', 'business_gst', zero), bl('Z-2', 'business_registered_composition', zero), bl('Z-3', 'business_sez', { 'Tax Name': 'IGST0', 'Tax Percentage': '0', 'Tax Type': 'ItemAmount', 'Destination of Supply': 'KA', 'Source of Supply': 'TN' }),
    bl('Z-4', 'business_gst', { 'Tax Name': 'GST18', 'Tax Percentage': '18', 'Tax Type': 'Tax Group' }),
    bl('Z-5', 'business_gst', { 'Tax Name': 'GST18', 'Tax Percentage': '18', 'Tax Type': 'Tax Group', 'Source of Supply': '' }),
    bl('Z-6', 'business_none'),
  ]) }, { homeState: 'KA', orgGstStatus: 'regular' });
  const rows = id => causesOf(res, 'bills').find(c => c.id === id);
  assert.deepEqual([rows('BIL-ZERO-TAX-REGISTERED').tier, rows('BIL-ZERO-TAX-REGISTERED').rows, rows('BIL-ZERO-TAX-REGISTERED').evidenceLevel], ['may', 3, 'assumed']);
  assert.deepEqual([rows('BIL-TAX-NO-SOURCE-OF-SUPPLY').tier, rows('BIL-TAX-NO-SOURCE-OF-SUPPLY').rows], ['may', 1]);
  // an organisation not registered for GST: the GST rules are not about it
  const none = checkFiles({ bills: file(BIL, [bl('Z-1', 'business_gst', zero)]) }, { homeState: 'KA', orgGstStatus: 'unregistered' });
  assert.ok(!causesOf(none, 'bills').some(c => c.id === 'BIL-ZERO-TAX-REGISTERED'));
  // an invoice with a tax and no Place of Supply (an overseas one is confirmed and not said)
  const INV = ['Invoice Date', 'Invoice Number', 'Customer Name', 'Item Name', 'Item Price', 'Quantity', 'GST Treatment', 'Place of Supply', 'Item Tax', 'Item Tax %', 'Item Tax Type'];
  const il = (n, treatment, place) => ({ 'Invoice Date': '2025-09-01', 'Invoice Number': n, 'Customer Name': 'Larch Stores', 'Item Name': 'Audit', 'Item Price': '100.00', Quantity: '1', 'GST Treatment': treatment, 'Place of Supply': place, 'Item Tax': 'IGST18', 'Item Tax %': '18', 'Item Tax Type': 'ItemAmount' });
  const inv = checkFiles({ invoices: file(INV, [il('I-1', 'business_gst', ''), il('I-2', 'overseas', ''), il('I-3', 'business_gst', 'TN')]) }, { homeState: 'KA', orgGstStatus: 'regular' });
  const c = causesOf(inv, 'invoices').find(x => x.id === 'INV-TAX-NO-PLACE-OF-SUPPLY');
  assert.deepEqual([c.tier, c.rows], ['may', 1]);
});

// ---------- TDS-005: a TDS Amount that is not the percentage of the base ----------
const natureLedgers = { 'TDS Contractors': { taxtype: 'TDS', tdsratename: 'Payment to Contractors - Others' } };
let nextId = 0;
const rec = (slot, data) => ({ id: ++nextId, source_id: `s5-${nextId}`, name: `${slot} ${data.vouchernumber}`, slot, data });
const voucher = (number, base, tds) => rec('purchase', { vouchernumber: number, date: '20250815', cmpgststate: 'Delhi', placeofsupply: 'Delhi',
  allledgerentries: [{ ledgername: 'Site Work', amount: `-${base}` }, { ledgername: 'Builder', amount: (Number(base) - Number(tds)).toFixed(2), ispartyledger: true }, { ledgername: 'TDS Contractors', amount: tds }] });
const shop = () => ({
  customers: new NameSet([]), vendors: new NameSet(['Builder']), taxLedgers: new NameSet(Object.keys(natureLedgers)), taxMap: {},
  taxInfo: n => (natureLedgers[n] ? taxLedgerInfo(natureLedgers[n]) : null), kindOf: n => (n === 'Site Work' ? 'expense' : n === 'Builder' ? 'vendor' : natureLedgers[n] ? 'tax' : null), tdsMap: {},
  tdsDefault: n => D.tdsSuggestion(taxLedgerInfo(natureLedgers[n] || {}), n), contactOf: (s, l) => (s === 'vendors' && l === 'Builder' ? { treatment: 'business_none', gstin: '', place: 'DL' } : null),
  gstRegisteredCodes: new Set(['business_gst', 'business_sez', 'business_registered_composition']), defaultRouting: true, year: { from: '2025-04-01', to: '2026-03-31' },
});
test('TDS-005: a bill whose TDS Amount is not its TDS Percentage of the base is kept for the check, which says "may be refused"', () => {
  const odd = voucher('C9', '100000.00', '1234.00'), even = voucher('C8', '100000.00', '2000.00');
  const b = buildVoucherOutput([odd, even], shop());
  const row = r => b.bills.rows.find(x => x.rec === r).row;
  assert.equal(row(odd)['TDS Amount'], '1234.00', "Tally's amount is written as it is");
  assert.equal(b.tdsDiffersDocs.length, 1, 'only the bill whose amount is not the percentage');
  const d = b.tdsDiffersDocs[0];
  assert.deepEqual([d.file, d.number, d.party], ['bills', row(odd)['Bill Number'], row(odd)['Vendor Name']]);
  assert.ok(new Decimal(d.difference).abs().greaterThan(1));
  const res = checkFiles({ bills: { headers: BILL_HEADERS, rows: b.bills.rows.map(x => BILL_HEADERS.map(h => String(x.row[h] ?? ''))), bytes: 1000 } },
    { homeState: 'DL', tdsAmountDiffers: { bills: b.tdsDiffersDocs.map(({ number, party, difference }) => ({ number, party, difference })) } });
  const c = causesOf(res, 'bills').find(x => x.id === 'BIL-TDS-AMOUNT-NOT-PERCENT');
  assert.deepEqual([c.tier, c.rows, c.documents, c.evidenceLevel], ['may', 1, 1, 'assumed']);
  assert.match(c.message, new RegExp(row(odd)['Bill Number']));
  // without such a document the rule is not about the file
  const clean = checkFiles({ bills: { headers: BILL_HEADERS, rows: [], bytes: 10 } }, { homeState: 'DL' });
  assert.ok(!causesOf(clean, 'bills').some(x => x.id === 'BIL-TDS-AMOUNT-NOT-PERCENT'));
});

// ---------- SYN-4: the expected trial balance and the check describe the same files ----------
test('SYN-4: a refused journal is not posted and every account it touches says why; a journal Zoho may refuse is posted and listed', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE generated_files (job_id TEXT, key TEXT); CREATE TABLE generated_rows (job_id TEXT, key TEXT, row_no INTEGER, row_data TEXT);');
  db.prepare("INSERT INTO generated_files VALUES ('J', 'journals')").run();
  const rows = [['JV-', '1', 'Input CGST', '18.00', ''], ['JV-', '1', 'Main Bank', '', '18.00'], ['JV-', '2', 'Travel', '50.00', ''], ['JV-', '2', 'Main Bank', '', '50.00']];
  rows.forEach(([p, s, account, debit, credit], i) => db.prepare("INSERT INTO generated_rows VALUES ('J', 'journals', ?, ?)").run(i + 1, JSON.stringify({ journal_number_prefix: p, journal_number_suffix: s, account, debit, credit, status: 'published' })));
  const head = r => ({ 'Journal Number Prefix': r[0], 'Journal Number Suffix': r[1], Account: r[2], Debit: r[3], Credit: r[4] });
  const checked = { refused: { journals: rows.slice(2).map(head) }, may: { journals: rows.slice(0, 2).map(head) },
    rules: { refused: { journals: [['JRN-ACCOUNT-EXISTS'], ['JRN-ACCOUNT-EXISTS']] }, may: { journals: [['JRN-GST-SYSTEM-ACCOUNT-LINE'], ['JRN-GST-SYSTEM-ACCOUNT-LINE']] } } };
  const tally = [['Input CGST', '-18'], ['Travel', '-50'], ['Main Bank', '68']].map(([n, a]) => ({ ledger: n, zohoName: n, amount: new Decimal(a), how: 'account' }));
  const p = predictedTrialBalance(db, 'J', { fileLayout: () => ({ values: g => JSON.parse(g.row_data) }), checked: () => checked, tallySide: () => ({ entries: tally, notCompared: [] }) });
  assert.equal(p.files.find(f => f.key === 'journals').documents, 1, 'only the journal Zoho takes is posted');
  assert.deepEqual(p.refusedDocuments, [{ file: 'journals', label: 'Manual Journals', document: 'JV-2', rules: ['JRN-ACCOUNT-EXISTS'] }]);
  assert.deepEqual(p.mayBeRefused, [{ file: 'journals', label: 'Manual Journals', document: 'JV-1', rules: ['JRN-GST-SYSTEM-ACCOUNT-LINE'] }]);
  const c = p.comparison;
  const diff = [...c.accounts.differing, ...c.accounts.onlyTally, ...c.accounts.onlyZoho];
  assert.deepEqual(diff.map(r => r.account).sort(), ['Main Bank', 'Travel']);
  for (const r of diff) assert.deepEqual(r.reasons, ['Manual Journals JV-2 will be refused by Zoho Books (JRN-ACCOUNT-EXISTS), so it is not in these figures'], r.account);
  assert.ok(c.accounts.matched.some(r => r.account === 'Input CGST'), 'the journal Zoho may refuse is posted');
  assert.match(p.leftOut.join(' '), /JV-2/);
  assert.match(p.words, /1 document the Zoho check says Zoho Books may refuse/);
  assert.match(predictedCsv(p), /In Tally only: Manual Journals JV-2 will be refused by Zoho Books \(JRN-ACCOUNT-EXISTS\)/);
});
