// S7 TDS/TCS: sections in any spelling, the act by date, a tax name per rate, the taxes of Zoho's export only on the
// dates they are valid, TCS, the posting choice and one evidence record per posting rule. Every company, ledger, party
// and amount here is MADE UP; nothing reads a name to decide.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-tdstcs-'));
const D = await import('../src/defaults.js');
const T = await import('../src/tds.js');
const { NameSet } = await import('../src/tally.js');
const { buildVoucherOutput, taxLedgerInfo, BILL_HEADERS, INVOICE_HEADERS, taxAlignmentJournalRows } = await import('../src/vouchers.js');
const { readZohoTdsTaxes } = await import('../src/voucheropts.js');
const { checkFiles } = await import('../src/zohocheck.js');
const { POSTING_RULES } = await import('../src/predictedtb.js');
const { taxLedgerDefaults } = await import('../src/taxaccounts.js');
const Decimal = (await import('decimal.js')).default;
const dec = x => new Decimal(x);
const RULES = JSON.parse(fs.readFileSync(new URL('../src/zohorules.json', import.meta.url), 'utf8'));

// ---------- TDS-007 / TDS-008: sections in any spelling, every section Zoho has a code for ----------
test('TDS-007: a section written with a separator is read as that section, never as 194 (dividend)', () => {
  assert.equal(D.tdsSectionOf('Sec 194-J'), '194J');
  assert.equal(D.tdsSectionOf('u/s 194(C)'), '194C');
  assert.equal(D.tdsSectionOf('194.I'), '194I');
  assert.equal(D.tdsSectionOf('TDS 194-C @2%'), '194C');
  assert.equal(D.tdsSectionOf('194 JB'), '194JB');
  assert.equal(D.tdsSectionOf('194J'), '194J');
  assert.equal(D.tdsSectionOf('Payment of Dividend 194'), '194', 'the bare number with nothing after it');
  assert.equal(D.tdsSectionOf('194-XY'), '', 'letters after a separator that are no section: not the bare 194');
  assert.equal(D.tdsSectionOf('Plot 1945'), '', 'a longer number is no section');
  // a rent ledger named with a separator and no nature of payment is no longer suggested as dividend
  assert.equal(D.tdsSuggestion({ nature: '' }, 'TDS Sec 194-I Rent')?.section, '194I');
});

test('TDS-008: salary, provident fund, business trusts, non-residents and 196A-D are recognised, with their new-act codes', () => {
  for (const [s, code] of [['192', 'payment_to_non_govt_employee'], ['192A', 'accumulated_balance_payment'], ['194LBA', 'interest_business_unit'], ['194LBB', 'income_from_investment_fund'],
    ['194LBC', 'income_from_securitization_trust'], ['195', 'other_sums_payable_non_resident'], ['196A', 'income_respect_of_units_mutual_funds'], ['196D', 'income_securities_section_210_foreign_investor']]) {
    assert.equal(D.tdsSectionOf(`TDS u/s ${s}`), s, s);
    assert.equal(T.natureEntries(s)[0]?.codeNew, code, `${s} -> ${code}`);
  }
  assert.equal(D.tdsSuggestion({ nature: 'Payment to Non-Resident' }).section, '195');
  const r = T.resolveTds({ amount: dec('2000'), subTotal: dec('10000'), date: '2026-08-01', suggestion: D.tdsSuggestion({ nature: 'Payment to Non-Resident' }) });
  assert.deepEqual([r.section, r.percent, r.missing], ['other_sums_payable_non_resident', '20', []]);
  const old = T.resolveTds({ amount: dec('2000'), subTotal: dec('10000'), date: '2025-08-01', suggestion: D.tdsSuggestion({ nature: 'Payment to Non-Resident' }) });
  assert.equal(old.section, '195');
});

// ---------- TDS-009: 194J by rate ----------
test('TDS-009: 194J at 2% is technical services (194JA, technical_services, Zoho\'s Technical Fees (2%)); at 10% professional fees', () => {
  const tech25 = T.resolveTds({ amount: dec('200'), subTotal: dec('10000'), date: '2025-08-01', suggestion: { section: '194J' } });
  // Zoho already has a tax of that name (its own, new act from 01/04/2026): the old-act tax gets a name of its own
  assert.deepEqual([tech25.tdsName, tech25.percent, tech25.section, tech25.madeUnique], ['Technical Fees (2%) 194JA 2%', '2', '194JA', true]);
  const tech26 = T.resolveTds({ amount: dec('200'), subTotal: dec('10000'), date: '2026-08-01', suggestion: { section: '194J' } });
  assert.deepEqual([tech26.tdsName, tech26.section, tech26.create, tech26.nameFrom], ['Technical Fees (2%)', 'technical_services', false, 'zoho_default'], "Zoho's own default tax is used");
  const prof = T.resolveTds({ amount: dec('1000'), subTotal: dec('10000'), date: '2025-08-01', suggestion: { section: '194J' } });
  assert.deepEqual([prof.tdsName, prof.section], ['Professional Fees', '194J']);
  assert.equal(D.tdsSuggestion({ nature: 'Technical Services' }).section, '194JA');
});

// ---------- TDS-010: a customer's TDS with no section ----------
test('TDS-010: a rate that fits several sections is said (ambiguous); 0.1% for a goods business is 194Q', () => {
  const two = T.resolveTds({ amount: dec('200'), subTotal: dec('10000'), date: '2025-08-01', customer: true });
  assert.equal(two.ambiguous, true, '2% fits 194C, 194H, 194JA and 194M');
  const ten = T.resolveTds({ amount: dec('1000'), subTotal: dec('10000'), date: '2025-08-01', customer: true });
  assert.deepEqual([ten.section, ten.ambiguous], ['194J', false], '194J and 194JB are one tax');
  const goods = T.resolveTds({ amount: dec('10'), subTotal: dec('10000'), date: '2025-08-01', customer: true, businessType: 'goods' });
  assert.deepEqual([goods.section, goods.ambiguous], ['194Q', true]);
  const services = T.resolveTds({ amount: dec('10'), subTotal: dec('10000'), date: '2025-08-01', customer: true, businessType: 'services' });
  assert.equal(services.ambiguous, true);
});

// ---------- TDS-001: a name chosen from the pick list keeps its section ----------
test('TDS-001: every name of the pick list, chosen with no section, writes a section (old act) and its code (new act)', () => {
  const empty = [], wrongNew = [];
  for (const c of D.TDS_CHOICES) {
    const mapping = { tdsName: c.name, section: '', percent: '' };
    const a = T.resolveTds({ amount: dec('1000'), subTotal: dec('10000'), date: '2025-08-01', mapping });
    if (!a.section) empty.push(c.name);
    const b = T.resolveTds({ amount: dec('1000'), subTotal: dec('10000'), date: '2026-08-01', mapping });
    if (c.code && b.section !== c.code) wrongNew.push(`${c.name}: ${b.section}`);
  }
  assert.deepEqual(empty, [], 'no choice leaves the section empty on a 2025-26 document');
  assert.deepEqual(wrongNew, [], 'on a 2026-27 document the code of the choice is written');
  // the option shown as 194C writes 194C; Tally's section stays the fallback for a name the list does not know
  assert.equal(T.resolveTds({ amount: dec('200'), subTotal: dec('10000'), date: '2025-08-01', mapping: { tdsName: 'Contract payments - other than individual or HUF', section: '', percent: '' } }).section, '194C');
  assert.equal(T.resolveTds({ amount: dec('1000'), subTotal: dec('10000'), date: '2025-08-01', mapping: { tdsName: 'Our own name', section: '', percent: '' }, suggestion: { section: '194I' } }).section, '194I');
});

// ---------- TDS-018: the section of a mapping ----------
test('TDS-018: a typed section is stored in one form, written in the form of the document\'s act, and an unknown one is refused', () => {
  assert.equal(T.storedTdsSection('194-J'), '194J');
  assert.equal(T.storedTdsSection('professional_fees'), 'professional_fees');
  assert.equal(T.storedTdsSection(''), '');
  assert.equal(T.storedTdsSection('X-1'), null);
  const at = (date, section) => T.resolveTds({ amount: dec('1000'), subTotal: dec('10000'), date, mapping: { tdsName: 'Fees Tax', section, percent: '' } });
  assert.equal(at('2025-08-01', '194-J').section, '194J');
  assert.equal(at('2026-06-10', '194J').section, 'professional_fees', 'the new-act code on a 2026 document');
  assert.equal(at('2025-08-01', 'professional_fees').section, '194J', 'the old section on a 2025 document');
  const bad = at('2025-08-01', 'X-1');
  assert.deepEqual(bad.warnings.map(w => w.kind), ['tds_section_not_known']);
  assert.equal(D.ASSUMPTIONS.tds_section_not_known.blocking, true);
});

test('TDS-018: the Zoho check refuses a section code in no list and says a form of the other act may be refused', () => {
  const rows = extra => [{ 'Bill Date': '2025-06-01', 'Bill Number': 'X-1', 'Bill Status': 'open', 'Source of Supply': 'KA', 'Destination of Supply': 'KA', 'GST Treatment': 'business_none', 'Is Inclusive Tax': 'FALSE',
    'Vendor Name': 'V', 'Currency Code': 'INR', 'Account': 'Office Rent', 'Item Description': 'x', 'Quantity': '1', 'Rate': '1000.00', 'TDS Name': 'Fees Tax', 'TDS Percentage': '10', 'TDS Amount': '100.00', ...extra }];
  const causes = extra => checkFiles({ bills: { headers: BILL_HEADERS, rows: rows(extra).map(r => BILL_HEADERS.map(h => r[h] ?? '')), bytes: 1000 } }, { homeState: 'KA', zohoNames: { taxes: [], tds_taxes: [] } })
    .files[0].causes.filter(c => c.ruleId === 'BIL-TDS-SECTION-CODE-VALID' || c.id?.startsWith('BIL-TDS-SECTION-CODE-VALID')).map(c => [c.variant, c.tier]);
  assert.deepEqual(causes({ 'TDS Section Code': 'X-1' }), [['unknown', 'will']]);
  assert.deepEqual(causes({ 'TDS Section Code': '194J', 'Bill Date': '2026-06-10' }), [['act', 'may']]);
  assert.deepEqual(causes({ 'TDS Section Code': 'professional_fees', 'Bill Date': '2025-06-10' }), [['act', 'may']]);
  assert.deepEqual(causes({ 'TDS Section Code': '194J' }), []);
  assert.deepEqual(causes({ 'TDS Section Code': 'professional_fees', 'Bill Date': '2026-06-10' }), []);
});

// ---------- TDS-003: the export's taxes only on their dates ----------
test('TDS-003: a tax of Zoho\'s export is not used outside its dates or when Inactive; it is listed to create and said', () => {
  const later = T.resolveTds({ amount: dec('1000'), subTotal: dec('10000'), date: '2025-08-01', suggestion: { section: '194J' }, exported: [{ name: 'Fees New', rate: '10', section: 'professional_fees', start: '2026-04-01', end: '', status: 'Active' }] });
  assert.equal(later.create, true);
  assert.notEqual(later.tdsName, 'Fees New');
  assert.deepEqual(later.warnings.map(w => w.kind), ['tds_tax_not_valid_on_date']);
  const inactive = T.resolveTds({ amount: dec('1000'), subTotal: dec('10000'), date: '2025-08-01', suggestion: { section: '194J' }, exported: [{ name: 'Fees Old', rate: '10', section: '194J', start: '2025-04-01', end: '', status: 'Inactive' }] });
  assert.equal(inactive.create, true);
  assert.notEqual(inactive.tdsName, 'Fees Old');
  // an Expired tax of the old act is still used for a document inside its dates (second test import)
  const expired = T.resolveTds({ amount: dec('1000'), subTotal: dec('10000'), date: '2025-08-01', suggestion: { section: '194J' }, exported: [{ name: 'Fees Old', rate: '10', section: '194J', start: '2025-04-01', end: '2026-03-31', status: 'Expired' }] });
  assert.deepEqual([expired.tdsName, expired.create], ['Fees Old', false]);
});

test('TDS-003: the list of TDS taxes to create says a tax of the export that starts after the documents is not in Zoho', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { tdsTaxesInFiles } = await import('../src/importwizard.js');
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE generated_rows (job_id TEXT, key TEXT, row_no INTEGER, row_key TEXT, source_record_id INTEGER, source_id TEXT, row_data TEXT, ident TEXT);
    CREATE TABLE generated_files (job_id TEXT, key TEXT, columns TEXT, mapping_hash TEXT);
    CREATE TABLE zoho_tds_taxes (job_id TEXT, seq INTEGER, name TEXT, rate TEXT, section TEXT, start_date TEXT, end_date TEXT, status TEXT);
    CREATE TABLE zoho_tds_taxes_meta (job_id TEXT PRIMARY KEY, file_name TEXT, taxes INTEGER, uploaded_by TEXT, at TEXT);`);
  db.prepare('INSERT INTO generated_rows VALUES (?,?,?,?,?,?,?,?)').run('J', 'bills', 1, 'r1', 1, 's1', JSON.stringify({ 'Bill Date': '2025-08-01', 'TDS Name': 'Fees Tax', 'TDS Percentage': '10', 'TDS Section Code': '194J' }), 'i1');
  db.prepare("INSERT INTO zoho_tds_taxes VALUES ('J',1,'Fees Tax','10','194J','2026-04-01','','Active')").run();
  db.prepare("INSERT INTO zoho_tds_taxes_meta VALUES ('J','t.csv',1,'x','now')").run();
  const r = tdsTaxesInFiles(db, 'J', { financial_year: '2025-26' });
  assert.deepEqual(r.taxes.map(t => [t.name, t.inZoho, t.notValid, t.act]), [['Fees Tax', false, 'starts after', 'old']]);
  assert.equal(r.toCreate, 1);
});

// ---------- TDS-004 / TDS-017: one name, one rate; names never depend on the order ----------
test('TDS-004: a mapped tax whose rate differs from the document\'s gets a unique name and is listed to create', () => {
  const exported = [{ name: 'Professional Fees', rate: '10', section: '194J', start: '2025-04-01', end: '', status: 'Active' }];
  const low = T.resolveTds({ amount: dec('200'), subTotal: dec('10000'), date: '2025-08-01', mapping: { tdsName: 'Professional Fees', section: '', percent: '' }, exported });
  assert.deepEqual([low.tdsName, low.create, low.madeUnique], ['Professional Fees 194J 2%', true, true]);
  const same = T.resolveTds({ amount: dec('1000'), subTotal: dec('10000'), date: '2025-08-01', mapping: { tdsName: 'Professional Fees', section: '', percent: '' }, exported });
  assert.deepEqual([same.tdsName, same.create], ['Professional Fees', false]);
});

test('TDS-017: without an export the names are the same whatever the order of the documents', () => {
  const run = rates => { const claims = new Map(); return rates.map(p => T.resolveTds({ amount: dec(p), subTotal: dec('100'), date: '2025-06-01', suggestion: { section: '194I', percent: '' }, claims })).map(r => `${r.percent}:${r.tdsName}`); };
  const a = run(['2', '10']), b = run(['10', '2']);
  assert.deepEqual([...a].sort(), [...b].sort());
  const lower = T.resolveTds({ amount: dec('1'), subTotal: dec('100'), date: '2025-06-01', suggestion: { section: '194J' } });
  assert.equal(lower.tdsName, 'Professional Fees 194J 1%', 'a lower deduction gets its own name even as the first document');
});

// ---------- TDS-025: the export reader ----------
test('TDS-025: another export (the GST tax list) is refused; Zoho\'s TDS export is read; an Inactive tax is never offered', () => {
  assert.ok(readZohoTdsTaxes(Buffer.from('Tax Name,Tax Percentage,Tax Type\r\nGST18,18,Tax Group')).error);
  assert.ok(readZohoTdsTaxes(Buffer.from('TDS Name,TDS Percentage\r\nFees Tax,10')).error, 'no section column');
  const ok = readZohoTdsTaxes(Buffer.from('Tax ID,TDS Name,TDS Percentage,TDS Section Code,Start Date,End Date,Tax Status\r\n1,Fees Tax,10.000000,194J,2025-04-01,,Active\r\n2,Old Tax,5,194H,2025-04-01,,Inactive'));
  assert.deepEqual(ok.taxes.map(t => [t.name, t.rate, t.section, t.status]), [['Fees Tax', '10.000000', '194J', 'Active'], ['Old Tax', '5', '194H', 'Inactive']]);
});

// ---------- TDS-019: one evidence record ----------
test('TDS-019: the evidence of every posting rule is the one record in zohorules.json', () => {
  const record = new Map(RULES.lists.posting_rules.rules.map(r => [r.id, r]));
  for (const r of POSTING_RULES) {
    assert.ok(record.has(r.id), `${r.id} has a record`);
    assert.equal(r.evidence, record.get(r.id).evidence, r.id);
    assert.equal(r.note || null, record.get(r.id).note || null, r.id);
  }
  // the TDS Receivable entry of the tax ledger table points at that record instead of claiming its own evidence
  assert.match(RULES.lists.tax_ledger_zoho_accounts.entries.find(e => e.tds && e.side === 'input').evidence, /lists\.posting_rules/);
});

// ---------- TDS-015: TCS ----------
const MASTERS = { 'Input IGST': { taxtype: 'GST', gstdutyhead: 'IGST' }, 'TCS on Scrap': { taxtype: 'TCS', tcsnatureofgoods: 'Scrap' }, 'TCS Plain': { taxtype: 'TCS' } };
const CONTACTS = { customers: { 'Buyer Local': { treatment: 'business_gst', gstin: '29AAAAA0000A1Z2', place: 'KA' } }, vendors: { 'Vendor Local': { treatment: 'business_gst', gstin: '29BBBBB0000B1Z5', place: 'KA' } } };
const KINDS = { 'Scrap Sales': 'income', Purchases: 'expense' };
const ctxOf = (over = {}) => ({
  customers: new NameSet(Object.keys(CONTACTS.customers)), vendors: new NameSet(Object.keys(CONTACTS.vendors)), taxLedgers: new NameSet(Object.keys(MASTERS)),
  taxMap: {}, taxInfo: n => (MASTERS[n] ? taxLedgerInfo(MASTERS[n]) : null),
  kindOf: n => KINDS[n] ?? (MASTERS[n] ? 'tax' : CONTACTS.customers[n] ? 'customer' : CONTACTS.vendors[n] ? 'vendor' : null),
  tdsMap: {}, contactOf: (section, ledger) => CONTACTS[section][ledger] || null, companyGst: { status: 'regular', state: 'KA' },
  gstRegisteredCodes: new Set(['business_gst']), defaultRouting: true, year: { from: '2025-04-01', to: '2026-03-31' }, ...over,
});
let nextId = 0;
const vch = (number, lines) => ({ vouchernumber: number, date: '20250601', cmpgststate: 'Karnataka', allledgerentries: lines.map(([ledgername, amount, more]) => ({ ledgername, amount, ...(more || {}) })) });
const rec = (slot, data) => ({ id: ++nextId, source_id: `g${nextId}`, name: `${slot} ${data.vouchernumber}`, slot, data });
const rowsOf = (built, file, r) => built[file].rows.filter(x => x.rec === r).map(x => x.row);
const flagsOf = (built, r) => built.exceptions.filter(e => e.rec === r && e.kind).map(e => e.kind);

test('TDS-015: TCS on an invoice is never a GST line; by default the Adjustment column, with the TCS setting the TCS columns', () => {
  const inv = rec('sales', vch('S-1', [['Buyer Local', '-1010.00', { ispartyledger: true }], ['Scrap Sales', '1000.00'], ['TCS on Scrap', '10.00']]));
  const dflt = buildVoucherOutput([inv], ctxOf());
  const d = rowsOf(dflt, 'invoices', inv);
  assert.deepEqual(d.map(x => [x.Account, x.Adjustment, x['TCS Tax Name'] || '']), [['Scrap Sales', '10.00', '']]);
  assert.ok(flagsOf(dflt, inv).includes('tcs_to_adjustment'));
  assert.ok(!flagsOf(dflt, inv).includes('invoice_line_to_adjustment'));
  assert.ok(!flagsOf(dflt, inv).includes('non_gst_duty_on_document'));
  const cols = buildVoucherOutput([inv], ctxOf({ settings: { tcsMode: 'columns' } }));
  const c = rowsOf(cols, 'invoices', inv);
  assert.deepEqual(c.map(x => [x.Account, x.Adjustment || '', x['TCS Tax Name'], x['TCS Percentage'], x['TCS Amount'], x['Nature Of Collection'], x['TCS Payable Account']]),
    [['Scrap Sales', '', 'TCS 206C(1) 1%', '1', '10.00', '206C(1)', 'TCS on Scrap']]);
  assert.ok(flagsOf(cols, inv).includes('tcs_in_columns'));
  assert.ok(!flagsOf(cols, inv).includes('document_total_differs'), 'the invoice total is Tally\'s');
  assert.deepEqual(cols.tcsTaxes.map(t => [t.name, t.rate, t.natureOfCollection, t.act]), [['TCS 206C(1) 1%', '1', '206C(1)', 'old']]);
  for (const h of ['TCS Tax Name', 'TCS Percentage', 'TCS Amount', 'Nature Of Collection', 'TCS Payable Account']) assert.ok(INVOICE_HEADERS.includes(h), h);
  // the new-act code from 01/04/2026
  const later = rec('sales', { ...vch('S-2', [['Buyer Local', '-1010.00', { ispartyledger: true }], ['Scrap Sales', '1000.00'], ['TCS on Scrap', '10.00']]), date: '20260601' });
  const l = rowsOf(buildVoucherOutput([later], ctxOf({ settings: { tcsMode: 'columns' }, year: { from: '2026-04-01', to: '2027-03-31' } })), 'invoices', later);
  assert.equal(l[0]['Nature Of Collection'], 'sale_scrap');
  // a TCS ledger whose nature of goods is not known: the Adjustment column, said
  const plain = rec('sales', vch('S-3', [['Buyer Local', '-1010.00', { ispartyledger: true }], ['Scrap Sales', '1000.00'], ['TCS Plain', '10.00']]));
  const p = buildVoucherOutput([plain], ctxOf({ settings: { tcsMode: 'columns' } }));
  assert.deepEqual(rowsOf(p, 'invoices', plain).map(x => [x.Adjustment, x['TCS Tax Name'] || '']), [['10.00', '']]);
  assert.ok(flagsOf(p, plain).includes('tcs_details_missing'));
});

test('TDS-015: TCS on a bill is never a zero-rated GST0 line; in the TCS columns the alignment journal moves it to the TCS ledger', () => {
  const b = rec('purchase', vch('P-1', [['Purchases', '-1000.00'], ['Vendor Local', '1010.00', { ispartyledger: true }], ['TCS on Scrap', '-10.00']]));
  const dflt = buildVoucherOutput([b], ctxOf());
  const rows = rowsOf(dflt, 'bills', b);
  assert.ok(!rows.some(x => x.Account === 'TCS on Scrap'), 'no line of its own');
  assert.deepEqual(rows.map(x => [x.Account, x.Adjustment]), [['Purchases', '10.00']]);
  const cols = buildVoucherOutput([b], ctxOf({ settings: { tcsMode: 'columns' } }));
  const c = rowsOf(cols, 'bills', b);
  assert.deepEqual(c.map(x => [x.Account, x.Adjustment || '', x['TCS Tax Name'], x['TCS Amount'], x['Nature Of Collection']]), [['Purchases', '', 'TCS 206C(1) 1%', '10.00', '206C(1)']]);
  for (const h of ['TCS Tax Name', 'TCS Percentage', 'TCS Amount', 'Nature Of Collection']) assert.ok(BILL_HEADERS.includes(h), h);
  // Zoho posts the bill's TCS on TCS Receivable: the tax alignment journal moves it to the Tally TCS ledger
  const tax = taxAlignmentJournalRows([{ file: 'bills', date: '2025-06-01', number: 'P-1', taxPosting: { tds: null, rcm: null, tcs: { ledger: 'TCS on Scrap', amount: dec('10'), zoho: 'TCS Receivable' } } }], { accountName: x => x });
  assert.deepEqual(tax.rows.map(r => [r.Account, r.Debit, r.Credit]).sort(), [['TCS Receivable', '', '10.00'], ['TCS on Scrap', '10.00', '']].sort());
});

// ---------- TDS-016: the posting choice ----------
test('TDS-016: with the posting choice per ledger a TDS ledger the bills use stays an account of its own', () => {
  const records = [{ name: 'TDS on Fees', data: { parent: 'Duties & Taxes', taxtype: 'TDS', tdsratename: '194J' } }];
  const evidence = { tds: { 'TDS on Fees': { payable: { documents: 3, amount: '300.00' } } }, rcmInput: {}, rcmOutput: {}, ordinaryTax: [], foreignVendors: [] };
  const merged = taxLedgerDefaults(records, { groupParents: {}, groupReserved: {} }, {}, null, evidence);
  assert.equal(merged.decisions['TDS on Fees']?.zohoName, 'TDS Payable', 'merge: the default');
  const own = taxLedgerDefaults(records, { groupParents: {}, groupReserved: {}, tdsPosting: 'per_ledger' }, {}, null, evidence);
  assert.equal(own.decisions['TDS on Fees'], undefined);
  assert.equal(own.asks['TDS on Fees'], undefined);
  // the bills' TDS then goes from TDS Payable to the ledger by the tax alignment journal
  const tax = taxAlignmentJournalRows([{ file: 'bills', date: '2025-06-01', number: 'P-1', taxPosting: { tds: { ledger: 'TDS on Fees', amount: dec('100') }, rcm: null } }], { accountName: x => x });
  assert.deepEqual(tax.rows.map(r => [r.Account, r.Debit, r.Credit]).sort(), [['TDS Payable', '100.00', ''], ['TDS on Fees', '', '100.00']].sort());
});
