// B6-B7: the Invoices, Bills and Manual Journals files in the layouts of Zoho's official import samples, the GST of a
// voucher on the line it belongs to (never guessed), and tax deducted at source in the bill's TDS columns.
// The headings are compared with the official sample files when they are present in zoho-samples/ (public Zoho
// material). Every other name, number and amount here is MADE UP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-vouchers-'));
const { buildApp } = await import('../src/index.js');
const { NameSet } = await import('../src/tally.js');
const { buildVoucherOutput, attributeTax, journalNumberParts, taxLedgerInfo, dutyHead, INVOICE_HEADERS, BILL_HEADERS, BILL_SAMPLE_HEADERS, BILL_COLUMNS_LEFT_OUT, JOURNAL_HEADERS, VOUCHER_FILES } = await import('../src/vouchers.js');
const { defaultColumns, layoutGaps } = await import('../src/columns.js');
const { parseCsv } = await import('../src/zoho.js');
const { tdsSuggestion } = await import('../src/defaults.js');
const { sampleHeadings } = await import('../fixtures/zohoSamples.js');
const { mastersDoc, VOUCHERS, transactionsDoc, trialBalanceReport, utf16le } = await import('../fixtures/allTransactions.js');
const Decimal = (await import('decimal.js')).default;

const here = path.dirname(fileURLToPath(import.meta.url));
const ZOHO_SAMPLES = path.resolve(here, '../../zoho-samples');
const seed = JSON.parse(fs.readFileSync(path.resolve(here, '../seed-users.json'), 'utf8'));

// ================= the layouts =================
// v2 (changed on purpose, docs/ZOHO_IMPORT_RULES.md rule BIL-TOTAL-COLUMNS-OMIT): the Bills file no longer has every
// heading of the sample. Its headings are a SUBSET of the sample's, in the sample's order: Item Total, SubTotal, Total
// and Balance are left out (Zoho reads an empty Total as 0 and refuses the bill), and so are the five Attachment columns
// and the demo custom field CF.Transporte_Name. Invoices and Manual Journals still carry every heading.
test('B6: the three voucher layouts are the official Zoho samples, byte for byte and in order', t => {
  assert.deepEqual([INVOICE_HEADERS.length, BILL_HEADERS.length, BILL_SAMPLE_HEADERS.length, JOURNAL_HEADERS.length], [70, 55, 65, 15]);
  assert.deepEqual(BILL_COLUMNS_LEFT_OUT, ['Item Total', 'SubTotal', 'Total', 'Balance', 'Attachment ID', 'Attachment Preview ID', 'Attachment Name', 'Attachment Type', 'Attachment Size', 'CF.Transporte_Name']);
  assert.deepEqual(BILL_HEADERS, BILL_SAMPLE_HEADERS.filter(h => !BILL_COLUMNS_LEFT_OUT.includes(h)), "a subset of the sample's headings, in its order");
  assert.ok(!BILL_HEADERS.some(h => /total|balance/i.test(h)), 'no total column is left to be mapped by mistake');
  assert.ok(!INVOICE_HEADERS.some(h => /^(sub ?total|total|balance|item total)$/i.test(h)), 'the invoice sample has no total column');
  for (const [key, file] of [['invoices', 'sample_invoices.xls'], ['bills', 'sample_bills.csv'], ['journals', 'sample_journals.xls']]) {
    assert.deepEqual([VOUCHER_FILES[key].verified, VOUCHER_FILES[key].sampleFile], [true, file]);
    assert.deepEqual(defaultColumns(key).map(c => c.heading), VOUCHER_FILES[key].headers);
    assert.ok(Object.values(VOUCHER_FILES[key].sources).every(Boolean), `${key}: every column says where it comes from`);
  }
  assert.equal(VOUCHER_FILES.journals.idColumn, 'Reference Number');
  // "Item Tax" and "Item Tax %" are two columns with two ids
  const ids = defaultColumns('invoices').map(c => c.id);
  assert.ok(ids.includes('item_tax') && ids.includes('item_tax_percent') && ids.includes('shipping_charge_tax_percent'));
  const files = [['sample_invoices.xls', INVOICE_HEADERS], ['sample_bills.csv', BILL_SAMPLE_HEADERS], ['sample_journals.xls', JOURNAL_HEADERS]];
  if (!files.every(([f]) => fs.existsSync(path.join(ZOHO_SAMPLES, f)))) { t.skip('the official sample files are not in zoho-samples'); return; }
  for (const [f, headers] of files) {
    const official = sampleHeadings(path.join(ZOHO_SAMPLES, f));
    assert.deepEqual(headers, official, f);
    assert.deepEqual(headers.map(h => Buffer.from(h).toString('hex')), official.map(h => Buffer.from(h).toString('hex')), `${f}: byte for byte`);
  }
});

test('B6: a saved voucher layout made for the old headings is reported, not a crash', () => {
  const old = [{ id: 'journal_date', heading: 'Journal Date', source: { type: 'builtin', builtin: 'journal_date' } }, { id: 'journal_number', heading: 'Journal Number', source: { type: 'builtin', builtin: 'journal_number' } },
    { id: 'line_type', heading: 'Line Type', source: { type: 'builtin', builtin: 'line_type' } }];
  const g = layoutGaps('journals', old);
  assert.deepEqual(g.gone, ['Journal Number', 'Line Type']);
  assert.equal(g.missing.length, 14);
  assert.deepEqual(layoutGaps('journals', defaultColumns('journals')), { missing: [], gone: [] });
  assert.deepEqual(layoutGaps('invoices', [...defaultColumns('invoices')].reverse().map(c => ({ ...c, heading: `${c.heading} x` }))), { missing: [], gone: [] }, 'renamed and reordered is fine');
});

// ================= building documents =================
const R = (...pairs) => ({ ratedetails: [...pairs.map(([h, r]) => ({ gstratedutyhead: h, gstratevaluationtype: 'Based on Value', gstrate: ` ${r}` })), { gstratedutyhead: 'Cess', gstratevaluationtype: ' Not Applicable' }] });
const vch = (number, lines, extra = {}) => ({ vouchernumber: number, date: '20250601', ...extra, allledgerentries: lines.map(([ledgername, amount, more]) => ({ ledgername, amount, ...(more || {}) })) });
let nextId = 0;
const rec = (slot, data, decision) => ({ id: ++nextId, source_id: `g${nextId}`, name: `${slot} ${data.vouchernumber}`, slot, data, decision });
const MASTERS = {
  'Out CGST': { taxtype: 'GST', gstdutyhead: 'CGST' }, 'Out SGST': { taxtype: 'GST', gstdutyhead: 'SGST/UTGST' }, 'Out IGST': { taxtype: 'GST', gstdutyhead: 'IGST' },
  'In CGST': { taxtype: 'GST', gstdutyhead: 'CGST' }, 'In SGST': { taxtype: 'GST', gstdutyhead: 'SGST/UTGST' },
  'Out CGST 9': { taxtype: 'GST', gstdutyhead: 'CGST', rateoftaxcalculation: ' 9' }, 'Out SGST 9': { taxtype: 'GST', gstdutyhead: 'SGST/UTGST', rateoftaxcalculation: ' 9' },
  'TDS Fees': { taxtype: 'TDS', tdsratename: '194J' }, 'TDS Contract': { taxtype: 'TDS', tdsratename: 'Contract' },
  'TDS Named Only': { taxtype: 'Others' }, 'RCM IGST Payable': { taxtype: 'GST', gstdutyhead: 'IGST' },
};
const CONTACTS = { customers: { 'Cust Alpha': { treatment: 'business_gst', gstin: '29AAAAA0000A1Z5', place: 'KA' }, 'Cust Abroad': { treatment: 'overseas', gstin: '', place: '' }, 'Cust Nowhere': { treatment: 'business_none', gstin: '', place: '' } },
  vendors: { 'Vend Beta': { treatment: 'business_gst', gstin: '29BBBBB0000B1Z5', place: 'KA' } } };
const opts = (over = {}) => ({
  customers: new NameSet(Object.keys(CONTACTS.customers)), vendors: new NameSet(Object.keys(CONTACTS.vendors)), taxLedgers: new NameSet(Object.keys(MASTERS)),
  taxMap: { 'Out CGST': 'GST18', 'Out SGST': 'GST18', 'Out IGST': 'IGST18', 'In CGST': 'GST18', 'In SGST': 'GST18', 'Out CGST 9': 'GST18', 'Out SGST 9': 'GST18', 'RCM IGST Payable': 'IGST18' },
  taxInfo: name => (MASTERS[name] ? taxLedgerInfo(MASTERS[name]) : null),
  tdsMap: { 'TDS Fees': { tdsName: 'Professional Fees', section: '194J', percent: '10' } },
  contactOf: (section, ledger) => CONTACTS[section][ledger] || null, ...over,
});
const build = (recs, over) => buildVoucherOutput(recs, opts(over));
const flagsOf = (built, r) => built.exceptions.filter(e => e.rec === r && e.kind).map(e => e.kind);
const rowsOf = (built, file, r) => built[file].rows.filter(x => x.rec === r).map(x => x.row);

test('B6: the GST of a one-line invoice goes on its line: a group for CGST and SGST, a single tax for IGST', () => {
  const a = rec('sales', vch('INV-1', [['Cust Alpha', '-1180.00'], ['Sales Goods', '1000.00', R(['CGST', 9], ['SGST/UTGST', 9], ['IGST', 18])], ['Out CGST', '90.00'], ['Out SGST', '90.00']], { narration: 'Made-up sale' }));
  const b = rec('sales', vch('INV-2', [['Cust Alpha', '-590.00'], ['Sales Goods', '500.00'], ['Out IGST', '90.00']], { placeofsupply: 'Maharashtra' }));
  const c = rec('sales', vch('INV-3', [['Cust Abroad', '-300.00'], ['Export Sales', '300.00']]));
  const built = build([a, b, c]);
  const [ra] = rowsOf(built, 'invoices', a);
  assert.equal(rowsOf(built, 'invoices', a).length, 1, 'one row per line, no tax rows');
  assert.deepEqual(['Invoice Number', 'Invoice Date', 'Invoice Status', 'Customer Name', 'GST Treatment', 'GST Identification Number (GSTIN)', 'Place of Supply', 'Currency Code', 'Account',
    'Item Name', 'Item Desc', 'Quantity', 'Item Price', 'Is Inclusive Tax', 'Item Tax', 'Item Tax Type', 'Item Tax %', 'Notes', 'Adjustment', 'Discount'].map(h => ra[h] ?? ''),
  // v2 (changed on purpose): Item Name is mandatory on an invoice line; an account line carries the service item of its account
  ['INV-1', '2025-06-01', 'open', 'Cust Alpha', 'business_gst', '29AAAAA0000A1Z5', 'KA', 'INR', 'Sales Goods', 'Sales Goods', 'Sales Goods', '1', '1000.00', 'false', 'GST18', 'Tax Group', '18', 'Made-up sale', '', '']);
  assert.deepEqual(flagsOf(built, a), []);
  const [rb] = rowsOf(built, 'invoices', b);
  // no rate in Tally: worked out from the amounts because exactly one standard GST rate fits; Tally's place of supply
  assert.deepEqual([rb['Item Tax'], rb['Item Tax Type'], rb['Item Tax %'], rb['Place of Supply']], ['IGST18', 'ItemAmount', '18', 'MH']);
  assert.deepEqual(flagsOf(built, b), []);
  // an overseas customer has no place of supply, and that is not flagged; v2: a line with no GST of an export carries IGST0
  const [rc] = rowsOf(built, 'invoices', c);
  assert.deepEqual([rc['Place of Supply'], rc['GST Treatment'], rc['Item Tax'], rc['Item Tax Type'], rc['Item Tax %'], flagsOf(built, c)], ['', 'overseas', 'IGST0', 'ItemAmount', '0', ['invoice_line_zero_tax']]);
  // one service item per account written, for the Items file
  assert.deepEqual(built.serviceItems.map(s => [s.name, s.account, s.lines, s.vouchers]), [['Sales Goods', 'Sales Goods', 2, 2], ['Export Sales', 'Export Sales', 1, 1]]);
  assert.deepEqual(built.taxOnVouchers.filter(x => x.rec === a).map(x => x.taxes), [[{ ledger: 'Out CGST', zohoTax: 'GST18' }, { ledger: 'Out SGST', zohoTax: 'GST18' }]]);
  // a customer with no state: flagged, left empty
  const d = rec('sales', vch('INV-4', [['Cust Nowhere', '-10.00'], ['Sales Goods', '10.00']]));
  assert.deepEqual(flagsOf(build([d]), d), ['place_of_supply_missing']);
});

test('B6: several lines carry tax only when Tally\'s rates account for every tax ledger; otherwise nothing is guessed', () => {
  // each line has its own rate in Tally: 18% and 5%
  const a = rec('sales', vch('M-1', [['Cust Alpha', '-1600.00'], ['Sales A', '1000.00', R(['CGST', 9], ['SGST/UTGST', 9])], ['Sales B', '400.00', R(['CGST', 2.5], ['SGST/UTGST', 2.5])], ['Out CGST', '100.00'], ['Out SGST', '100.00']]));
  // no rates at all: which line carries the tax is not certain
  const b = rec('sales', vch('M-2', [['Cust Alpha', '-1354.00'], ['Sales A', '1000.00'], ['Sales B', '300.00'], ['Out IGST', '54.00']]));
  // the tax ledgers' own rate (9 + 9) on every line accounts for the tax: certain
  const c = rec('sales', vch('M-3', [['Cust Alpha', '-354.00'], ['Sales A', '100.00'], ['Sales B', '200.00'], ['Out CGST 9', '27.00'], ['Out SGST 9', '27.00']]));
  // the same rate would give 27, but the ledgers carry 9: one line must be exempt, and which one is not known
  const d = rec('sales', vch('M-4', [['Cust Alpha', '-318.00'], ['Sales A', '100.00'], ['Sales B', '200.00'], ['Out CGST 9', '9.00'], ['Out SGST 9', '9.00']]));
  const built = build([a, b, c, d]);
  // changed on purpose (S6, GST-001): the ledgers are mapped to GST18, but the 5% line is written with Zoho's tax of its own
  // rate (GST5), never GST18 at 5%, and the line says so
  assert.deepEqual(rowsOf(built, 'invoices', a).map(r => [r.Account, r['Item Tax'], r['Item Tax Type'], r['Item Tax %']]), [['Sales A', 'GST18', 'Tax Group', '18'], ['Sales B', 'GST5', 'Tax Group', '5']]);
  assert.deepEqual(flagsOf(built, a), ['tax_mapping_rate_differs'], 'the totals tie: 1000 + 180 + 400 + 20');
  // no Zoho tax named for a rate is written at another rate any more
  assert.ok(!built.taxNameRates.some(x => x.zohoTax === 'GST18' && x.rates.includes('5')));
  assert.deepEqual(rowsOf(built, 'invoices', b).map(r => r['Item Tax']), ['', '']);
  assert.deepEqual(flagsOf(built, b), ['tax_not_attributable', 'document_total_differs']);
  assert.match(built.exceptions.find(e => e.rec === b && e.kind === 'tax_not_attributable').message, /2 lines that could carry the tax on "Out IGST" \(54\.00\), and Tally gives no GST rate for them/);
  assert.match(built.exceptions.find(e => e.rec === b && e.kind === 'document_total_differs').message, /comes to 1300\.00 .* Tally's customer amount is 1354\.00 .*Tax that could not be put on its line explains it/);
  assert.deepEqual(rowsOf(built, 'invoices', c).map(r => [r['Item Tax'], r['Item Tax %']]), [['GST18', '18'], ['GST18', '18']]);
  assert.deepEqual(flagsOf(built, c), []);
  assert.deepEqual(flagsOf(built, d), ['tax_not_attributable', 'document_total_differs']);
  assert.match(built.exceptions.find(e => e.rec === d && e.kind === 'tax_not_attributable').message, /come to 27\.00 on "Out CGST 9", but the ledger carries 9\.00/);
});

test('B6: a rate that cannot be told, a tax that differs from the rate by more than rounding, and two Zoho taxes for one line are flagged', () => {
  const a = rec('sales', vch('R-1', [['Cust Alpha', '-1037.00'], ['Sales A', '1000.00'], ['Out IGST', '37.00']])); // 3.7%: no standard rate fits
  const b = rec('sales', vch('R-2', [['Cust Alpha', '-1188.00'], ['Sales A', '1003.00', R(['IGST', 18])], ['Out IGST', '185.00']])); // 18% of 1003 is 180.54
  const c = rec('sales', vch('R-3', [['Cust Alpha', '-1184.00'], ['Sales A', '1003.00', R(['IGST', 18])], ['Out IGST', '181.00']])); // rounded up to the rupee in Tally
  const built = build([a, b, c]);
  assert.deepEqual([rowsOf(built, 'invoices', a)[0]['Item Tax'], flagsOf(built, a)], ['', ['tax_rate_unknown', 'document_total_differs']]);
  assert.match(built.exceptions.find(e => e.rec === a && e.kind === 'tax_rate_unknown').message, /no standard GST rate fits a tax of 37\.00 on 1000\.00/);
  // changed on purpose (S2): the difference between Tally's tax and the rate times the amount is a Zoho recomputation, said as such
  assert.deepEqual([rowsOf(built, 'invoices', b)[0]['Item Tax %'], flagsOf(built, b)], ['18', ['tax_amount_differs', 'zoho_recompute_differs']]);
  assert.match(built.exceptions.find(e => e.rec === b && e.kind === 'tax_amount_differs').message, /18%, which on 1003\.00 is 180\.54, but the tax ledgers "Out IGST" carry 185\.00/);
  // within a rupee: not a tax difference. Zoho works the tax out as 180.54 (invoice 1183.54, Tally 1184.00): changed on
  // purpose (S2), the 0.46 is written in the Adjustment column so the invoice ties to Tally, and the voucher says so
  assert.deepEqual(flagsOf(built, c), ['zoho_recompute_adjusted']);
  assert.match(built.exceptions.find(e => e.rec === c && e.kind === 'zoho_recompute_adjusted').message, /tax Zoho works out from the rates \(each part of the tax rounded on its own\) is 180\.54, but Tally's tax is 181\.00 \(-0\.46\).*written in the Adjustment column \(0\.46\)/);
  assert.deepEqual([rowsOf(built, 'invoices', c)[0].Adjustment, rowsOf(built, 'invoices', c)[0]['Adjustment Description']], ['0.46', 'Tax rounding']);
  assert.equal(built.recomputeDocs.length, 2, 'the two documents Zoho works out differently are listed (one adjusted, one flagged)');
  // with the setting "flag only" nothing is adjusted: the document is flagged as Zoho will work it out
  const flagOnly = build([c], { settings: { recomputeDiffPolicy: 'flag' } });
  assert.deepEqual([flagsOf(flagOnly, c), rowsOf(flagOnly, 'invoices', c)[0].Adjustment ?? ''], [['zoho_recompute_differs'], '']);
  // a small line: several standard rates come within a rupee, so only an exact fit decides it
  const e = rec('sales', vch('R-4', [['Cust Alpha', '-5.90'], ['Sales A', '5.00'], ['Out IGST', '0.90']]));
  const g = rec('sales', vch('R-5', [['Cust Alpha', '-5.50'], ['Sales A', '5.00'], ['Out IGST', '0.50']]));
  const small = build([e, g]);
  assert.deepEqual([rowsOf(small, 'invoices', e)[0]['Item Tax %'], flagsOf(small, e)], ['18', []]);
  assert.deepEqual([rowsOf(small, 'invoices', g)[0]['Item Tax %'], flagsOf(small, g)], ['', ['tax_rate_unknown', 'document_total_differs']]);
  assert.match(small.exceptions.find(x => x.rec === g && x.kind === 'tax_rate_unknown').message, /standard rates \(.*\) fit a tax of 0\.50 on 5\.00/);
  // CGST and SGST mapped to two different Zoho taxes cannot both go on one line
  const d = rec('purchase', vch('P-1', [['Vend Beta', '1180.00'], ['Repairs', '-1000.00'], ['In CGST', '-90.00'], ['In SGST', '-90.00']], { cmpgststate: 'Karnataka' }));
  const b2 = build([d], { taxMap: { 'In CGST': 'CGST9', 'In SGST': 'SGST9' } });
  assert.deepEqual([rowsOf(b2, 'bills', d)[0]['Tax Name'], flagsOf(b2, d)], ['', ['line_tax_names_differ', 'document_total_differs']]);
  // a tax ledger not mapped: reported per ledger, the line is left without tax
  const b3 = build([d], { taxMap: { 'In CGST': 'GST18' } });
  assert.deepEqual([b3.unmappedTax, rowsOf(b3, 'bills', d)[0]['Tax Name']], [['In SGST'], '']);
});

test('B6: bill header values, the bill number setting, drafts, and the tax amount on each bill line', () => {
  const a = rec('journal', vch('JB-1', [['Repairs', '-1000.00'], ['In CGST', '-90.00'], ['In SGST', '-90.00'], ['Vend Beta', '1180.00']], { cmpgststate: 'Karnataka', reference: 'SUP/77', narration: 'Made-up purchase' }), 'Bill');
  let built = build([a]);
  const [r] = rowsOf(built, 'bills', a);
  // v2 default 9 (changed on purpose): the Bill Number is the supplier's invoice number (Tally's reference) when the
  // voucher has one, without anyone choosing it. v2 default 10: the row has no Item Total, SubTotal or Total cell.
  assert.deepEqual(['Bill Date', 'Bill Number', 'Bill Status', 'Source of Supply', 'Destination of Supply', 'GST Treatment', 'GST Identification Number (GSTIN)', 'Is Inclusive Tax', 'Vendor Name',
    'Currency Code', 'Account', 'Item Description', 'Quantity', 'Rate', 'Tax Name', 'Tax Percentage', 'Tax Amount', 'Tax Type', 'Vendor Notes', 'TDS Name'].map(h => r[h] ?? ''),
  ['2025-06-01', 'SUP/77', 'open', 'KA', 'KA', 'business_gst', '29BBBBB0000B1Z5', 'FALSE', 'Vend Beta', 'INR', 'Repairs', 'Repairs', '1', '1000.00', 'GST18', '18', '180.00', 'Tax Group', 'Made-up purchase', '']);
  assert.deepEqual(Object.keys(r).filter(h => !BILL_HEADERS.includes(h)), [], 'only headings of the file');
  assert.deepEqual(['Item Total', 'SubTotal', 'Total', 'Balance'].filter(h => h in r), [], 'no total cell is written');
  assert.deepEqual(flagsOf(built, a), []);
  assert.deepEqual([built.billNumbers.fromReference, built.billNumbers.sharedByVendors], [1, 0]);
  built = build([a], { settings: { billNumber: 'voucher', documentStatus: 'draft' } });
  assert.deepEqual([rowsOf(built, 'bills', a)[0]['Bill Number'], rowsOf(built, 'bills', a)[0]['Bill Status']], ['JB-1', 'draft'], 'the Tally voucher number when the accountant chooses it');
  // without a reference the voucher number is kept
  const b = rec('journal', vch('JB-2', [['Repairs', '-10.00'], ['Vend Beta', '10.00']], { cmpgststate: 'Karnataka' }), 'Bill');
  assert.equal(rowsOf(build([b], { settings: { billNumber: 'reference' } }), 'bills', b)[0]['Bill Number'], 'JB-2');
  // several lines with their rates: each line carries its own tax amount, and the paise of rounding go on the last line
  const c = rec('journal', vch('JB-3', [['Repairs', '-100.05', R(['CGST', 9], ['SGST/UTGST', 9])], ['Freight', '-100.05', R(['CGST', 9], ['SGST/UTGST', 9])], ['In CGST', '-18.02'], ['In SGST', '-18.02'], ['Vend Beta', '236.14']], { cmpgststate: 'Karnataka' }), 'Bill');
  built = build([c]);
  assert.deepEqual(rowsOf(built, 'bills', c).map(x => x['Tax Amount']), ['18.00', '18.04']);
  // changed on purpose (amounts batch): Zoho rounds CGST and SGST of each line on their own (9% of 100.05 is 9.00, so
  // 18.00 a line, 36.00 in all); Tally's 36.04 is 0.04 more, which is written in the Adjustment column so the bill ties to Tally
  assert.deepEqual([flagsOf(built, c), rowsOf(built, 'bills', c).map(x => x.Adjustment)], [['zoho_recompute_adjusted'], ['0.04', '0.04']]);
  // no company state on the voucher: Destination of Supply is flagged
  const d = rec('journal', vch('JB-4', [['Repairs', '-10.00'], ['Vend Beta', '10.00']]), 'Bill');
  assert.deepEqual(flagsOf(build([d]), d), ['place_of_supply_missing']);
});

test('B7: TDS on the vendor side goes to the bill\'s TDS columns when the ledger is TDS in Tally and is mapped; the total is the amount owed', () => {
  const vendorSide = (number, tdsLines, more = []) => rec('journal', vch(number, [['Professional Charges', '-1000.00'], ['In CGST', '-90.00'], ['In SGST', '-90.00'], ...more,
    ['Vend Beta', String(new Decimal(1180).minus(tdsLines.reduce((t, [, a]) => t.plus(a), new Decimal(0))).plus(more.reduce((t, [, a]) => t.plus(a), new Decimal(0)).negated()).toFixed(2))], ...tdsLines], { cmpgststate: 'Karnataka' }), 'Bill');
  const a = vendorSide('T-1', [['TDS Fees', '100.00']]);
  let built = build([a]);
  const rows = rowsOf(built, 'bills', a);
  assert.equal(rows.length, 1, 'the TDS is not a line');
  assert.deepEqual(['TDS Name', 'TDS Section Code', 'TDS Percentage', 'TDS Amount', 'Rate', 'Tax Amount'].map(h => rows[0][h]), ['Professional Fees', '194J', '10', '100.00', '1000.00', '180.00']);
  assert.deepEqual(flagsOf(built, a), [], '1000 + 180 - 100 = 1080, the vendor amount');
  assert.deepEqual(built.tdsUsed, [{ ledger: 'TDS Fees', zohoTds: 'Professional Fees', file: 'bills', byDefault: false, vouchers: 1 }]);
  // a TDS ledger with no Zoho TDS tax chosen and none to suggest (no section in Tally): in the Adjustment column (changed
  // on purpose, round 1 issue 12: no negative line taxed GST0), flagged, and listed so the accountant can map it
  const b = vendorSide('T-2', [['TDS Contract', '20.00']]);
  built = build([b]);
  assert.deepEqual(rowsOf(built, 'bills', b).map(x => [x.Account, x.Rate, x['TDS Name'], x.Adjustment]), [['Professional Charges', '1000.00', '', '-20.00']]);
  assert.deepEqual([flagsOf(built, b), built.tdsUnmapped], [['tds_to_adjustment'], [{ ledger: 'TDS Contract', file: 'bills', vouchers: 1 }]]);
  // the deducted amount is not the mapped rate on the sub total: Tally's amount is kept and Zoho keeps it (changed on
  // purpose, amounts batch: a test import showed Zoho takes the file's TDS Amount), so the total is Tally's and only the
  // percentage is flagged
  const c = vendorSide('T-3', [['TDS Fees', '50.00']]);
  built = build([c]);
  assert.deepEqual([rowsOf(built, 'bills', c)[0]['TDS Amount'], flagsOf(built, c)], ['50.00', ['tds_amount_differs']]);
  assert.match(built.exceptions.find(e => e.rec === c).message, /TDS at 10% of the bill's sub total 1000\.00 would be 100\.00, but Tally deducted 50\.00 on "TDS Fees".*Zoho Books keeps it/);
  // two TDS ledgers on one bill: Zoho takes one, so both are negative lines
  const d = vendorSide('T-4', [['TDS Fees', '100.00'], ['TDS Contract', '20.00']]);
  built = build([d]);
  assert.deepEqual([rowsOf(built, 'bills', d).map(x => x['TDS Name']).join(''), flagsOf(built, d)], ['', ['negative_row', 'tds_several_on_bill']]);
  // never decided from the name: a ledger called "TDS ..." whose Tally type is not TDS stays a flagged party-side tax
  const e = vendorSide('T-5', [['TDS Named Only', '30.00']]);
  built = build([e]);
  assert.deepEqual([rowsOf(built, 'bills', e)[1]?.Account, flagsOf(built, e), built.partySideTax], ['TDS Named Only', ['negative_row'], [{ ledger: 'TDS Named Only', file: 'bills', vouchers: 1 }]]);
  // a GST ledger on the vendor side (for example reverse charge) is not TDS either
  const f = vendorSide('T-6', [['RCM IGST Payable', '10.00']]);
  assert.deepEqual(build([f]).partySideTax, [{ ledger: 'RCM IGST Payable', file: 'bills', vouchers: 1 }]);
  // a TDS ledger debited on a bill is not tax deducted from the vendor: an ordinary line, flagged
  const g = rec('journal', vch('T-7', [['Professional Charges', '-100.00'], ['TDS Fees', '-10.00'], ['Vend Beta', '110.00']], { cmpgststate: 'Karnataka' }), 'Bill');
  built = build([g]);
  assert.deepEqual([rowsOf(built, 'bills', g).map(x => x.Account), flagsOf(built, g)], [['Professional Charges', 'TDS Fees'], ['tds_on_other_side']]);
  // v2 (changed on purpose): on an invoice, tax deducted by the customer goes to the invoice's TDS columns too
  const h = rec('sales', vch('T-8', [['Cust Alpha', '-90.00'], ['TDS Fees', '-10.00'], ['Sales A', '100.00']]));
  built = build([h]);
  assert.deepEqual(rowsOf(built, 'invoices', h).map(x => [x.Account, x['Item Price'], x['TDS Name'], x['TDS Percentage'], x['TDS Amount']]), [['Sales A', '100.00', 'Professional Fees', '10', '10.00']]);
  assert.deepEqual(flagsOf(built, h), [], '100 - 10 = 90, the customer amount');
  assert.deepEqual(built.recon.find(x => x.id === h.id).roles, ['party', 'tds_column', 'row']);
  assert.deepEqual(built.recon.find(x => x.id === h.id).posting, { debit: '100.00', credit: '100.00' });
});

test('v2 invoices: TDS suggested from the section, TDS Receivable ledgers, round-off in Adjustment, Item Name, zero-rate tax', () => {
  // the ledger's nature of payment names section 194J: written with the suggested Zoho TDS tax (no mapping), flagged
  const tdsDefault = name => tdsSuggestion(taxLedgerInfo(MASTERS[name] || {}), name);
  const a = rec('sales', vch('V-1', [['Cust Alpha', '-90.00'], ['TDS Fees', '-10.00'], ['Sales A', '100.00']], { cmpgststate: 'Karnataka' }));
  let built = build([a], { tdsMap: {}, tdsDefault });
  assert.deepEqual(rowsOf(built, 'invoices', a).map(x => [x['TDS Name'], x['TDS Section Code'], x['TDS Amount'], x['Item Name'], x['Item Tax'], x['Item Tax %']]),
    [['Professional Fees', '194J', '10.00', 'Sales A', 'GST0', '0']]);
  // changed on purpose (S2): Zoho refuses a TDS row without percentage and section code, so both are written (10% is
  // what Tally's own amount shows: 10 on 100) and the assumption says so
  assert.equal(rowsOf(built, 'invoices', a)[0]['TDS Percentage'], '10');
  assert.deepEqual(flagsOf(built, a), ['tds_name_default', 'tds_details_filled', 'invoice_line_zero_tax']);
  assert.deepEqual(built.tdsUsed, [{ ledger: 'TDS Fees', zohoTds: 'Professional Fees', file: 'invoices', byDefault: true, vouchers: 1 }]);
  // a ledger named like Zoho's TDS Receivable that is not a TDS ledger in Tally: changed on purpose (audit item 2): the
  // TDS columns even before it is mapped, with the default TDS tax for customers (Professional Fees, 194J), flagged;
  // never a negative line carrying a zero-rate tax and a service item on TDS Receivable
  const b = rec('sales', vch('V-2', [['Cust Alpha', '-90.00'], ['TDS Receivable', '-10.00'], ['Sales A', '100.00']], { cmpgststate: 'Karnataka' }));
  const customerTds = n => (n === 'TDS Receivable' ? 'TDS Receivable' : null);
  built = build([b], { customerTds });
  assert.deepEqual([rowsOf(built, 'invoices', b).map(x => [x.Account, x['TDS Name'], x['TDS Amount'], x['Item Tax']]), flagsOf(built, b), built.tdsUnmapped],
    [[['Sales A', 'Professional Fees', '10.00', 'GST0']], ['tds_name_default', 'tds_details_filled', 'invoice_line_zero_tax'], []]);
  assert.match(built.exceptions.find(e => e.rec === b && e.kind === 'tds_name_default').message, /Tally gives no section for this ledger/);
  assert.deepEqual(built.serviceItems.map(s => s.account), ['Sales A'], 'no service item on TDS Receivable');
  built = build([b], { customerTds, tdsMap: { 'TDS Receivable': { tdsName: 'Commission or Brokerage', section: '', percent: '' } } });
  // TDS-004 (changed on purpose): the chosen tax is a 2% tax and the customer deducted 10%: a tax of its own, said
  assert.deepEqual(rowsOf(built, 'invoices', b).map(x => [x.Account, x['TDS Name'], x['TDS Amount']]), [['Sales A', 'Commission or Brokerage 194H 10%', '10.00']]);
  assert.deepEqual(flagsOf(built, b), ['tds_details_filled', 'tds_tax_name_made_unique', 'invoice_line_zero_tax'], 'a mapping with a name only: the percentage (10, from the amount) and the section code are filled and said');
  // round-off (Tally type Invoice Rounding): the Adjustment column of every row, with "Round Off"; the total ties to Tally
  const c = rec('sales', vch('V-3', [['Cust Alpha', '-1180.00'], ['Sales Goods', '1000.42', R(['CGST', 9], ['SGST/UTGST', 9])], ['Out CGST', '90.04'], ['Out SGST', '90.04'], ['Rounding Off', '-0.50']], { cmpgststate: 'Karnataka' }));
  built = build([c], { isRoundOff: n => n === 'Rounding Off' });
  const rc = rowsOf(built, 'invoices', c);
  assert.deepEqual(rc.map(x => [x.Account, x.Adjustment, x['Adjustment Description']]), [['Sales Goods', '-0.50', 'Round Off']]);
  assert.deepEqual(flagsOf(built, c), ['round_off_adjustment']);
  assert.deepEqual(built.recon.find(x => x.id === c.id).roles, ['party', 'row', 'tax_column', 'tax_column', 'adjustment_column']);
  // on a bill the round-off goes to Adjustment too (the bill sample has no description column)
  const d = rec('purchase', vch('V-4', [['Vend Beta', '1180.00'], ['Repairs', '-1000.42'], ['In CGST', '-90.04'], ['In SGST', '-90.04'], ['Rounding Off', '0.50']], { cmpgststate: 'Karnataka' }));
  built = build([d], { isRoundOff: n => n === 'Rounding Off' });
  assert.deepEqual(rowsOf(built, 'bills', d).map(x => [x.Rate, x.Adjustment, x['Adjustment Description'] ?? '']), [['1000.42', '-0.50', '']]);
  assert.ok(!flagsOf(built, d).includes('document_total_differs'), 'the bill total ties to Tally');
  // a stock item keeps its name; a name taken by a stock item is not used for a service item
  const e = rec('sales', vch('V-5', [['Cust Alpha', '-100.00'], ['Widget', '100.00']], { cmpgststate: 'Karnataka', placeofsupply: 'Karnataka' }));
  built = build([e], { stockItemNames: ['WIDGET'] });
  assert.deepEqual([rowsOf(built, 'invoices', e)[0]['Item Name'], built.serviceItems.map(s => s.name)], ['Widget (service)', ['Widget (service)']]);
  // a journal written as a Manual Journal in the end makes no service item
  assert.deepEqual(build([rec('journal', vch('V-6', [['Office Expenses', '-1.00'], ['Cash', '1.00']]), 'Manual Journal')]).serviceItems, []);
});

test('B6: stock item lines, negative rows, and discounts or adjustments that are never guessed', () => {
  const inv = (number, qty, rate, amount) => ({ vouchernumber: number, date: '20250601', ledgerentries: [{ ledgername: 'Cust Alpha', amount: `-${amount}` }],
    allinventoryentries: [{ stockitemname: 'Widget', billedqty: qty, rate, gsthsnname: '84821011', accountingallocations: [{ ledgername: 'Sales Goods', amount }] }] });
  const a = rec('sales', inv('S-1', ' 2 Nos', '50.00/Nos', '100.00'));
  const b = rec('sales', inv('S-2', ' 3 Nos', '30.00/Nos', '100.00'));
  const c = rec('sales', vch('S-3', [['Cust Alpha', '-95.00'], ['Sales Goods', '100.00'], ['Discount Allowed', '-5.00']]));
  const built = build([a, b, c], { kindOf: n => (n === 'Discount Allowed' ? 'expense' : null) });
  assert.deepEqual(['Item Name', 'Item Desc', 'Quantity', 'Usage unit', 'Item Price', 'HSN/SAC', 'Account'].map(h => rowsOf(built, 'invoices', a)[0][h]), ['Widget', '', '2', 'Nos', '50.00', '84821011', 'Sales Goods']);
  assert.deepEqual(flagsOf(built, a), []);
  // 3 x 30 is not 100, and 100 / 3 has more than two decimals: quantity 1 at the line amount, flagged
  assert.deepEqual(['Quantity', 'Item Price'].map(h => rowsOf(built, 'invoices', b)[0][h]), ['1', '100.00']);
  assert.deepEqual(flagsOf(built, b), ['item_line_rate_differs']);
  // changed on purpose (audit item 2): a line on an expense ledger is not an invoice line Zoho takes (an income account
  // and an item are needed; a zero-rate tax on it would be a wrong nil-rated line): it goes to the Adjustment column,
  // named in the description, flagged; Zoho's Discount field is not used (nothing says it is a discount)
  assert.deepEqual(rowsOf(built, 'invoices', c).map(x => [x.Account, x['Item Price'], x.Discount ?? '', x.Adjustment ?? '', x['Adjustment Description'] ?? '']), [['Sales Goods', '100.00', '', '-5.00', 'Discount Allowed']]);
  assert.deepEqual(flagsOf(built, c), ['invoice_line_to_adjustment']);
  assert.deepEqual(built.recon.find(x => x.id === c.id).roles, ['party', 'row', 'adjustment_column']);
  assert.deepEqual(built.serviceItems.map(s => s.account), ['Sales Goods'], 'no service item on the expense account');
});

test('B6: manual journals: Zoho\'s journal number, Accounts Receivable and Payable with the contact, notes and status', () => {
  const a = rec('journal', vch('JV/24/0012', [['Office Expenses', '-500.00'], ['Vend Beta', '300.00'], ['Cust Alpha', '200.00']]), 'Manual Journal');
  const b = rec('journal', vch('ADJ-A', [['Office Expenses', '-1.00'], ['Cash', '1.00']], { narration: 'Made-up note' }), 'Manual Journal');
  const c = rec('journal', vch('VERY/LONG/NUMBER/0001', [['Office Expenses', '-1.00'], ['Cash', '1.00']]), 'Manual Journal');
  let built = build([a, b, c], { accountName: n => (n === 'Cust Alpha' ? 'Cust Alpha (written)' : n) });
  assert.deepEqual(rowsOf(built, 'journals', a).map(r => JOURNAL_HEADERS.map(h => r[h] ?? '')), [
    ['2025-06-01', 'JV/24/0012', 'JV/24/', '0012', 'Journal JV/24/0012 from Tally', 'both', 'INR', 'Office Expenses', '', '', '500.00', '', 'published', '', ''],
    ['2025-06-01', 'JV/24/0012', 'JV/24/', '0012', 'Journal JV/24/0012 from Tally', 'both', 'INR', 'Accounts Payable', '', 'Vend Beta', '', '300.00', 'published', '', ''],
    ['2025-06-01', 'JV/24/0012', 'JV/24/', '0012', 'Journal JV/24/0012 from Tally', 'both', 'INR', 'Accounts Receivable', '', 'Cust Alpha (written)', '', '200.00', 'published', '', '']]);
  // changed on purpose (S4, TALLY-009/OB-003): a number Zoho cannot take gets a generated one (never empty); the Tally
  // number is kept in the Notes. "VERY/LONG/NUMBER/0001" is over 16 characters: JRN- and the digits it ends in.
  assert.deepEqual([rowsOf(built, 'journals', b)[0].Notes, flagsOf(built, b), flagsOf(built, c)], ['Made-up note (Tally voucher number ADJ-A)', ['journal_number_generated'], ['journal_number_generated']]);
  assert.deepEqual([rowsOf(built, 'journals', b)[0]['Journal Number Prefix'], rowsOf(built, 'journals', b)[0]['Journal Number Suffix'], rowsOf(built, 'journals', b)[0]['Reference Number']], ['JRN-', '000001', 'JRN-000001']);
  assert.deepEqual([rowsOf(built, 'journals', c)[0]['Journal Number Prefix'], rowsOf(built, 'journals', c)[0]['Journal Number Suffix'], rowsOf(built, 'journals', c)[0].Notes], ['JRN-', '0001', 'Journal VERY/LONG/NUMBER/0001 from Tally']);
  built = build([a], { settings: { documentStatus: 'draft' } });
  assert.ok(rowsOf(built, 'journals', a).every(r => r.Status === 'draft'));
  assert.deepEqual([journalNumberParts('123'), journalNumberParts('JV-0001'), journalNumberParts('JV-A'), journalNumberParts('ABCDEFGHIJKLMNOP1')], [{ prefix: '', suffix: '123' }, { prefix: 'JV-', suffix: '0001' }, null, null]);
});

test('B6-B7: what the masters say about a tax ledger: TDS from Tally\'s tax type only; duty heads in one spelling', () => {
  assert.deepEqual(taxLedgerInfo({ taxtype: 'TDS', tdsratename: '\u0004 Any' }), { tds: true, gst: false, other: false, type: 'TDS', head: null, rate: null, nature: 'Any' });
  assert.equal(taxLedgerInfo({ taxtype: 'Others', name: 'TDS Payable' }).tds, false, 'never from the name');
  assert.deepEqual(taxLedgerInfo({ taxtype: 'GST', gstdutyhead: 'SGST/UTGST', rateoftaxcalculation: ' 9' }), { tds: false, gst: true, other: false, type: 'GST', head: 'SGST', rate: new Decimal(9), nature: '' });
  assert.deepEqual(['CGST', 'Central Tax', 'SGST', 'State Tax', 'IGST', 'Integrated Tax', 'State Cess', 'Something'].map(dutyHead), ['CGST', 'CGST', 'SGST', 'SGST', 'IGST', 'IGST', 'State Cess', null]);
  // attributeTax on its own: one line, two ledgers with Tally's rates
  const line = { ledger: 'X', total: new Decimal(200), rates: { CGST: new Decimal(6), SGST: new Decimal(6) } };
  const res = attributeTax([line], [{ ledger: 'C', amount: new Decimal(12), head: 'CGST', rate: null }, { ledger: 'S', amount: new Decimal(12), head: 'SGST', rate: null }]);
  assert.deepEqual([res.problem, res.perLine.get(line).rate.toString(), res.perLine.get(line).amount.toFixed(2), res.perLine.get(line).ledgers], [null, '12', '24.00', ['C', 'S']]);
});

// ================= end to end =================
const app = buildApp();
let cookie = '';
const call = o => app.inject({ ...o, headers: { ...(o.headers || {}), ...(cookie ? { cookie } : {}) } });
const get = async url => { const r = await call({ url }); assert.equal(r.statusCode, 200, `${url}: ${r.body}`); return r.json(); };
const send = (method, url, payload) => call({ method, url, ...(payload !== undefined ? { payload } : {}) });
const put = (id, slot, obj, name) => call({ method: 'PUT', url: `/api/migrations/${id}/uploads/${slot}`, headers: { 'content-type': 'application/octet-stream', 'x-filename': name }, payload: utf16le(obj) });
const login = async role => {
  const u = seed.users.find(x => x.role === role);
  cookie = String((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: u.password } })).headers['set-cookie']).split(';')[0];
};
const csvRows = async (base, key) => { const r = await call({ url: `${base}/files/${key}/download?confirmed=1` }); assert.equal(r.statusCode, 200, r.body); return parseCsv(r.body).rows; };

test('B6-B7 end to end: TDS mapping, voucher settings, the import order, reconciliation, the test report and an old saved layout', async () => {
  await login('analyst');
  const id = (await send('POST', '/api/migrations', { company: 'Sample Masters Co', financialYear: '2024-25' })).json().id;
  const base = `/api/migrations/${id}`;
  // the made-up "TDS Payable" is a TDS ledger in Tally here (type of duty/tax TDS, nature of payment 194J)
  const masters = mastersDoc();
  for (const m of masters.tallymessage) if (m.metadata?.name === 'TDS Payable') Object.assign(m, { taxtype: 'TDS', tdsratename: '194J' });
  assert.equal((await put(id, 'all_masters', masters, 'Master.json')).statusCode, 200);
  assert.equal((await put(id, 'all_transactions', transactionsDoc(VOUCHERS), 'Transactions.json')).statusCode, 200);
  assert.equal((await put(id, 'trial_balance', trialBalanceReport(), 'TrialBal.json')).statusCode, 200);
  await send('PUT', `${base}/waivers/stock_summary`, { reason: 'Not needed for test' });
  assert.equal((await send('POST', `${base}/process?wait=1`)).statusCode, 200);
  await send('POST', `${base}/journals/accept-suggestions`);
  await send('POST', `${base}/journals/accept-suggestions`, { group: 'needs_check' });
  assert.equal((await send('POST', `${base}/generate`)).statusCode, 200);
  const genFlags = async kind => (await get(`${base}/summary`)).exceptions.filter(e => e.stage === 'generate' && e.kind === kind);

  // ---- v2 (changed on purpose): before any TDS mapping, the section in Tally (194J) gives a suggested Zoho TDS tax,
  // written in the TDS columns by default and flagged as an assumption; nothing is a negative line or blocks ----
  let f = await genFlags('tds_name_default');
  assert.equal(f.length, 1);
  assert.match(f[0].message, /No Zoho TDS tax is chosen for TDS ledger "TDS Payable", so "Professional Fees" is written/);
  assert.deepEqual(await genFlags('tds_not_mapped'), []);
  assert.deepEqual(await genFlags('tax_ledger_party_side'), [], 'a TDS ledger is not reported as an undecided party-side tax');
  let bills = await csvRows(base, 'bills');
  assert.deepEqual(bills.filter(x => x['Bill Number'] === 'J-2').map(x => [x['TDS Name'], x['TDS Section Code'], x['TDS Amount']]), [['Professional Fees', '194J', '30.00']]);
  let rep = await get(`${base}/test-report`);
  assert.ok(!rep.whatToFixNext.some(x => x.blocking && /"tds_not_mapped"/.test(x.message)));
  let tds = await get(`${base}/tds-mappings`);
  assert.deepEqual(tds.ledgers.map(l => [l.ledger, l.nature, l.partySideVouchers, l.tdsName, l.source, l.written.tdsName]), [['TDS Payable', '194J', 1, '', 'auto', 'Professional Fees']]);
  assert.equal(tds.unmapped, 0);
  assert.ok(tds.choices.some(c => c.name === 'Professional Fees' && c.sections.includes('194J')));

  // ---- the mapping is checked, audited and marks only the Bills file out of date ----
  const map = body => send('PUT', `${base}/tds-mappings`, body);
  assert.equal((await map({ ledger: 'Input CGST', tdsName: 'X' })).statusCode, 404, 'not a TDS ledger in Tally');
  assert.equal((await map({ ledger: 'TDS Payable', tdsName: 'Professional Fees', percent: 'ten' })).statusCode, 400);
  assert.equal((await map({ ledger: 'TDS Payable', tdsName: 'Professional Fees', percent: '101' })).statusCode, 400);
  assert.equal((await map({ ledger: 'TDS Payable', section: '194J' })).statusCode, 400, 'a section without a name');
  assert.equal((await map({ ledger: 'TDS Payable', tdsName: 'Fees\r\n' })).statusCode, 200, 'outer spaces and line breaks are trimmed');
  let r = await map({ ledger: 'TDS Payable', tdsName: 'Professional Fees', section: '194J', percent: '10' });
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(r.json().ledgers.map(l => [l.tdsName, l.section, l.percent, l.source]), [['Professional Fees', '194J', '10', 'explicit']]);
  // v2: invoices carry TDS deducted by customers too, so both files are out of date
  assert.deepEqual((await get(base)).outOfDateFiles.filter(k => k === 'bills' || k === 'invoices').sort(), ['bills', 'invoices']);
  const trail = async () => (await get(`${base}/audit`)).map(a => `${a.action} | ${a.detail}`);
  assert.ok((await trail()).includes('tds_mapped | TDS ledger "TDS Payable": "Fees" -> "Professional Fees", section 194J, 10%'));
  assert.equal((await map({ ledger: 'TDS Payable', tdsName: 'Professional Fees', section: '194J', percent: '10' })).json().changed, false);
  assert.equal((await send('POST', `${base}/generate`)).statusCode, 200);
  bills = await csvRows(base, 'bills');
  const j2 = bills.filter(x => x['Bill Number'] === 'J-2');
  assert.deepEqual(j2.map(x => [x.Account, x.Rate, x['TDS Name'], x['TDS Section Code'], x['TDS Percentage'], x['TDS Amount']]), [['Staff Tea Expenses', '300.07', 'Professional Fees', '194J', '10', '30.00']]);
  assert.ok(bills.every(x => !('Total' in x) && !('SubTotal' in x) && !('Item Total' in x) && !('Balance' in x)), 'v2 default 10: the Bills file has no total column');
  assert.deepEqual([await genFlags('tds_not_mapped'), (await genFlags('document_total_differs')).filter(x => /J-2/.test(x.name))], [[], []], '300.07 less 30.00 is the 270.07 owed to the vendor');
  rep = await get(`${base}/test-report`);
  assert.ok(!rep.whatToFixNext.some(x => /"tds_not_mapped"/.test(x.message)));

  // ---- reconciliation: the expected bill amount is Zoho's total, after TDS ----
  r = await call({ method: 'PUT', url: `${base}/verification/bills`, headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('Bill Number,Total\r\nJ-2,270.07\r\n') });
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual([r.json().matched, r.json().amountsCompared, r.json().amountsDiffering], [1, 1, 0]);
  const ver = (await get(`${base}/verification`)).find(x => x.key === 'bills');
  // changed on purpose (amounts batch): Zoho keeps the TDS Amount as written (a test import), so the expected total uses it
  assert.match(ver.amountBasis, /less "TDS Amount" \(Zoho keeps the TDS Amount as written\)/);

  // ---- import order and what Zoho needs first ----
  const imports = await get(`${base}/imports`);
  assert.ok(imports.find(i => i.key === 'bills').zohoSetup.some(s => /TDS taxes named in Mapping Studio \(TDS mapping\)/.test(s)));
  assert.deepEqual(imports.find(i => i.key === 'journals').zohoSetup, []);

  // ---- voucher file settings ----
  // v2 default 9 (changed on purpose): the Bill Number is the supplier's invoice number when the voucher has one,
  // WITHOUT anyone choosing it (the default was the Tally voucher number). The Tally number can still be chosen.
  let vs = await get(`${base}/voucher-settings`);
  assert.deepEqual([vs.billNumber, vs.documentStatus, vs.vouchersWithSupplierReference, vs.outOfYear, vs.billNoTaxMode], ['reference', 'final', 1, 'exclude', 'zero_tax']);
  assert.ok(bills.some(x => x['Bill Number'] === 'B-77') && !bills.some(x => x['Bill Number'] === 'J-1'), 'J-1 carries the supplier reference B-77 by default');
  assert.deepEqual((await genFlags('bill_number_from_reference')).map(x => x.uses), [1]);
  assert.equal((await send('PUT', `${base}/voucher-settings`, { billNumber: 'supplier' })).statusCode, 400);
  assert.equal((await send('PUT', `${base}/voucher-settings`, { documentStatus: 'posted' })).statusCode, 400);
  assert.equal((await send('PUT', `${base}/voucher-settings`, { outOfYear: 'sometimes' })).statusCode, 400);
  assert.equal((await send('PUT', `${base}/voucher-settings`, { billNoTaxMode: 'exemption' })).statusCode, 400, 'an exemption needs its name');
  assert.equal((await send('PUT', `${base}/voucher-settings`, { billNoTaxMode: 'reverse_charge', billReverseChargeName: 'GST18' })).statusCode, 400, 'reverse charge needs name, rate and type');
  vs = (await send('PUT', `${base}/voucher-settings`, { billNumber: 'voucher' })).json();
  assert.deepEqual([vs.changed, vs.billNumber], [true, 'voucher']);
  assert.deepEqual((await get(base)).outOfDateFiles, ['bills']);
  assert.ok((await trail()).some(x => /^voucher_settings_changed \| Bill Number: the supplier's invoice number \(Tally reference\) when the voucher has one -> the Tally voucher number/.test(x)));
  assert.equal((await send('POST', `${base}/generate`)).statusCode, 200);
  bills = await csvRows(base, 'bills');
  assert.ok(bills.some(x => x['Bill Number'] === 'J-1') && !bills.some(x => x['Bill Number'] === 'B-77'), 'J-1 carries its Tally voucher number when that is chosen');
  assert.deepEqual(await genFlags('bill_number_from_reference'), []);
  await send('PUT', `${base}/voucher-settings`, { documentStatus: 'draft' });
  assert.deepEqual((await get(base)).outOfDateFiles, ['invoices', 'bills', 'journals', 'other_journals']); // changed on purpose in B8: the journals of receipts, payments and contra take the status too
  assert.equal((await send('POST', `${base}/generate`)).statusCode, 200);
  assert.ok((await csvRows(base, 'journals')).every(x => x.Status === 'draft') && (await csvRows(base, 'invoices')).every(x => x['Invoice Status'] === 'draft'));

  // ---- a viewer reads only ----
  await login('viewer');
  assert.equal((await send('PUT', `${base}/tds-mappings`, { ledger: 'TDS Payable', tdsName: 'Y' })).statusCode, 403);
  assert.equal((await send('PUT', `${base}/voucher-settings`, { billNumber: 'voucher' })).statusCode, 403);

  // ---- a layout saved for the old placeholder headings: written, flagged and blocking until it is reset ----
  const db = new DatabaseSync(path.join(process.env.DATA_DIR, 'migration.db'));
  const firm = db.prepare('SELECT COALESCE(firm_id, 1) f FROM migrations WHERE id = ?').get(id).f;
  db.prepare('INSERT OR REPLACE INTO column_mappings (firm_id, key, columns, updated_by, updated_at) VALUES (?,?,?,?,?)').run(firm, 'journals', JSON.stringify(
    ['Journal Date', 'Journal Number', 'Notes', 'Account', 'Debit', 'Credit'].map(h => { const cid = h.toLowerCase().replace(/ /g, '_'); return { id: cid, heading: h, source: { type: 'builtin', builtin: cid } }; })), 'admin@demo.test', new Date().toISOString());
  db.close();
  await login('analyst');
  assert.equal((await send('POST', `${base}/generate`)).statusCode, 200, 'an old layout does not stop the files');
  const old = await call({ url: `${base}/files/journals/download?confirmed=1` });
  assert.equal(old.body.split('\r\n')[0], 'Journal Date,Journal Number,Notes,Account,Debit,Credit');
  f = await genFlags('voucher_layout_outdated');
  assert.equal(f.length, 1);
  assert.match(f[0].message, /made for an earlier version of the file: 10 columns of the official Zoho sample are missing .* 1 column reads a value the file no longer has and is written empty \("Journal Number"\)/);
  rep = await get(`${base}/test-report`);
  assert.ok(rep.whatToFixNext.some(x => x.blocking && /"voucher_layout_outdated"/.test(x.message)));
  await login('admin');
  assert.equal((await send('DELETE', '/api/templates/journals/columns')).statusCode, 200);
  assert.equal((await send('POST', `${base}/generate`)).statusCode, 200);
  assert.deepEqual(await genFlags('voucher_layout_outdated'), []);
});

test('v2 tax mapping: GST ledgers mapped automatically by rate and kind; non-GST duties never asked; only what needs a person is open', async () => {
  await login('analyst');
  const id = (await send('POST', '/api/migrations', { company: 'Sample Masters Co', financialYear: '2024-25' })).json().id;
  const base = `/api/migrations/${id}`;
  const masters = mastersDoc();
  const byName = n => masters.tallymessage.find(m => m.metadata?.name === n);
  Object.assign(byName('Output CGST'), { taxtype: 'GST', gstdutyhead: 'CGST' });
  Object.assign(byName('Input CGST'), { taxtype: 'GST', gstdutyhead: 'CGST' });
  Object.assign(byName('TDS Payable'), { taxtype: 'TDS', tdsratename: '194C' });
  const pt = JSON.parse(JSON.stringify(byName('TDS Payable')));
  pt.metadata.name = 'Professional Tax'; Object.assign(pt, { taxtype: 'Others', tdsratename: '' });
  masters.tallymessage.push(pt);
  // S-1 with its GST split into CGST and SGST (the usual shape)
  const sgst = JSON.parse(JSON.stringify(byName('Output CGST'))); sgst.metadata.name = 'Output SGST'; Object.assign(sgst, { taxtype: 'GST', gstdutyhead: 'SGST/UTGST' });
  masters.tallymessage.push(sgst);
  const docs = transactionsDoc(VOUCHERS);
  const s1 = docs.tallymessage.find(v => v.vouchernumber === 'S-1');
  const entries = s1.allledgerentries || s1.ledgerentries;
  const cg = entries.find(l => l.ledgername === 'Output CGST'); cg.amount = '90.00';
  entries.push({ ...JSON.parse(JSON.stringify(cg)), ledgername: 'Output SGST' });
  assert.equal((await put(id, 'all_masters', masters, 'Master.json')).statusCode, 200);
  assert.equal((await put(id, 'all_transactions', docs, 'Transactions.json')).statusCode, 200);
  await send('PUT', `${base}/waivers/stock_summary`, { reason: 'Not needed for test' });
  assert.equal((await put(id, 'trial_balance', trialBalanceReport(), 'TrialBal.json')).statusCode, 200);
  assert.equal((await send('POST', `${base}/process?wait=1`)).statusCode, 200);

  let taxes = await get(`${base}/tax-mappings`);
  const t = n => taxes.find(x => x.ledger === n);
  // Output CGST: Tally's rate on the line is CGST 9%, so the line rate is 18% and Zoho's own GST18 is written
  assert.deepEqual([t('Output CGST').kind, t('Output CGST').head, t('Output CGST').rates, t('Output CGST').source, t('Output CGST').written, t('Output CGST').needsPerson],
    ['gst', 'CGST', [{ rate: '18', vouchers: 1, auto: 'GST18' }], 'auto', 'GST18', false]);
  assert.deepEqual([t('Output SGST').head, t('Output SGST').rates, t('Output SGST').source], ['SGST', [{ rate: '18', vouchers: 1, auto: 'GST18' }], 'auto']);
  // Input CGST: no rate anywhere in Tally and none fits the amounts: the one that needs a person
  assert.deepEqual([t('Input CGST').source, t('Input CGST').needsPerson, t('Input CGST').rateUnknownVouchers > 0], ['none', true, true]);
  assert.match(t('Input CGST').needsPersonWhy, /No rate in Tally/);
  // TDS goes to TDS mapping; a duty that is neither GST nor TDS (professional tax) is never asked for
  assert.deepEqual([t('TDS Payable').kind, t('Professional Tax').kind, t('Professional Tax').needsPerson], ['tds', 'other', false]);
  let item = async () => (await get(`${base}/prepare`)).steps.find(s => s.key === 'decisions').items.find(i => i.key === 'tax_mapping');
  assert.equal((await item()).open, 1);
  // the pick lists: Zoho's own GST taxes, and TDS taxes with their sections
  const choices = await get(`${base}/tax-choices`);
  assert.ok(choices.gst.some(x => x.name === 'GST18' && x.rate === 18) && choices.igst.some(x => x.name === 'IGST18'));
  assert.ok(choices.tds.some(x => x.name === 'Contract payments - other than individual or HUF' && x.sections.includes('194C')));
  assert.deepEqual(choices.savedList, []);
  // the TDS ledger's suggestion comes from its section
  const tds = await get(`${base}/tds-mappings`);
  assert.deepEqual([tds.ledgers[0].suggestion.tdsName, tds.ledgers[0].suggestion.section, tds.ledgers[0].source], ['Contract payments - other than individual or HUF', '194C', 'auto']);
  // an explicit choice wins and closes the item
  assert.equal((await send('PUT', `${base}/tax-mappings`, { ledger: 'Input CGST', zohoTax: 'GST18' })).statusCode, 200);
  taxes = await get(`${base}/tax-mappings`);
  assert.deepEqual([t('Input CGST').source, t('Input CGST').written, t('Input CGST').needsPerson], ['explicit', 'GST18', false]);
  assert.equal((await item()).open, 0);
  // the invoice line carries the automatic name
  assert.equal((await send('POST', `${base}/generate`)).statusCode, 200);
  const inv = (await csvRows(base, 'invoices')).filter(x => x['Invoice Number'] === 'S-1');
  assert.deepEqual(inv.map(x => [x['Item Name'], x['Item Tax'], x['Item Tax %']]), [['Domestic Sales', 'GST18', '18']]);
  const items = await csvRows(base, 'items');
  assert.deepEqual(items.filter(x => x['Item Name'] === 'Domestic Sales').map(x => [x.Rate, x['Item Type'], x['Product Type'], x.Account]), [['0.00', 'Sales', 'service', 'Domestic Sales']]);
});
