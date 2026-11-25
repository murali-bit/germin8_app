// S6 GST correctness of the generator: SEZ and overseas parties (between states whatever the states say), untaxed lines
// next to taxed ones, Zoho's own tax names of any standard rate, the rate of a mapped tax, HSN of goods lines, and the
// country of a reverse-charge vendor. Every name, GSTIN, number and amount here is MADE UP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-gstfixes-'));
const { NameSet } = await import('../src/tally.js');
const { buildVoucherOutput, taxLedgerInfo } = await import('../src/vouchers.js');
const { checkFiles } = await import('../src/zohocheck.js');
const { invoiceLineWithoutTax, billLineWithoutTax } = await import('../src/defaults.js');

const vch = (number, lines, extra = {}) => ({ vouchernumber: number, date: '20250601', cmpgststate: 'Karnataka', ...extra, allledgerentries: lines.map(([ledgername, amount, more]) => ({ ledgername, amount, ...(more || {}) })) });
let nextId = 0;
const rec = (slot, data, decision) => ({ id: ++nextId, source_id: `g${nextId}`, name: `${slot} ${data.vouchernumber}`, slot, data, decision });
const MASTERS = {
  'Out CGST': { taxtype: 'GST', gstdutyhead: 'CGST' }, 'Out SGST': { taxtype: 'GST', gstdutyhead: 'SGST/UTGST' }, 'Out IGST': { taxtype: 'GST', gstdutyhead: 'IGST' },
  'In CGST': { taxtype: 'GST', gstdutyhead: 'CGST' }, 'In SGST': { taxtype: 'GST', gstdutyhead: 'SGST/UTGST' }, 'In IGST': { taxtype: 'GST', gstdutyhead: 'IGST' },
};
const CONTACTS = {
  customers: { 'Zone Unit': { treatment: 'business_sez', gstin: '29AAAAA0000A1Z5', place: 'KA' }, 'Far Buyer': { treatment: 'overseas', gstin: '', place: '' },
    'Home Buyer': { treatment: 'business_gst', gstin: '29BBBBB0000B1Z5', place: 'KA' } },
  vendors: { 'Zone Supplier': { treatment: 'business_sez', gstin: '29CCCCC0000C1Z5', place: 'KA' }, 'Home Supplier': { treatment: 'business_gst', gstin: '29DDDDD0000D1Z5', place: 'KA' } },
};
const build = (recs, over = {}) => buildVoucherOutput(recs, {
  customers: new NameSet(Object.keys(CONTACTS.customers)), vendors: new NameSet(Object.keys(CONTACTS.vendors)), taxLedgers: new NameSet(Object.keys(MASTERS)),
  taxMap: {}, taxInfo: n => (MASTERS[n] ? taxLedgerInfo(MASTERS[n]) : null), contactOf: (s, l) => CONTACTS[s][l] || null,
  gstRegisteredCodes: new Set(['business_gst', 'business_sez']), ...over,
});
const flagsOf = (b, r) => b.exceptions.filter(e => e.rec === r && e.kind).map(e => e.kind);
const rowsOf = (b, file, r) => b[file].rows.filter(x => x.rec === r).map(x => x.row);
// the generator's rows as a file the Zoho check reads
const asFile = rows => { const headers = [...new Set(rows.flatMap(r => Object.keys(r)))]; return { headers, rows: rows.map(r => headers.map(h => r[h] ?? '')), bytes: 1000 }; };
const causesOf = (key, rows) => checkFiles({ [key]: asFile(rows) }, { homeState: 'KA' }).files[0].causes.map(c => c.id);

test('SEZ: the zero-rate helpers give IGST0 for an SEZ or overseas party, whatever the two states say', () => {
  assert.equal(invoiceLineWithoutTax({ from: 'KA', to: 'KA', sez: true })['Item Tax'], 'IGST0');
  assert.equal(invoiceLineWithoutTax({ from: 'KA', to: 'KA' })['Item Tax'], 'GST0');
  assert.equal(billLineWithoutTax({}, { source: 'KA', destination: 'KA', interState: true }).cells['Tax Name'], 'IGST0');
  assert.equal(billLineWithoutTax({}, { source: 'KA', destination: 'KA' }).cells['Tax Name'], 'GST0');
});

test('SEZ in the company\'s own state: IGST is not flagged, untaxed lines get IGST0, and the rows pass the Zoho check intra/inter rule', () => {
  const taxed = rec('sales', vch('Z-1', [['Zone Unit', '-1180.00'], ['Sales', '1000.00'], ['Out IGST', '180.00']], { placeofsupply: 'Karnataka' }));
  const untaxed = rec('sales', vch('Z-2', [['Zone Unit', '-500.00'], ['Sales', '500.00']], { placeofsupply: 'Karnataka' }));
  const bill = rec('purchase', vch('Z-3', [['Zone Supplier', '700.00'], ['Purchases', '-700.00']]), 'Bill');
  const built = build([taxed, untaxed, bill]);
  assert.deepEqual(flagsOf(built, taxed).filter(k => /mismatch/.test(k)), []);
  assert.equal(rowsOf(built, 'invoices', taxed)[0]['Item Tax'], 'IGST18');
  assert.equal(rowsOf(built, 'invoices', untaxed)[0]['Item Tax'], 'IGST0');
  assert.equal(rowsOf(built, 'bills', bill)[0]['Tax Name'], 'IGST0');
  const inv = causesOf('invoices', built.invoices.rows.map(x => x.row));
  const bil = causesOf('bills', built.bills.rows.map(x => x.row));
  assert.ok(!inv.some(c => /INV-TAX-INTRA-INTER/.test(c)), inv.join(', '));
  assert.ok(!bil.some(c => /BIL-TAX-INTRA-INTER/.test(c)), bil.join(', '));
});

test('SEZ or overseas party billed CGST + SGST: flagged tax_type_treatment_mismatch with the two ways out, nothing changed', () => {
  const sez = rec('sales', vch('Z-4', [['Zone Unit', '-1180.00'], ['Sales', '1000.00'], ['Out CGST', '90.00'], ['Out SGST', '90.00']], { placeofsupply: 'Karnataka' }));
  const far = rec('sales', vch('Z-5', [['Far Buyer', '-1180.00'], ['Sales', '1000.00'], ['Out CGST', '90.00'], ['Out SGST', '90.00']]));
  const home = rec('sales', vch('Z-6', [['Home Buyer', '-1180.00'], ['Sales', '1000.00'], ['Out CGST', '90.00'], ['Out SGST', '90.00']], { placeofsupply: 'Karnataka' }));
  const built = build([sez, far, home]);
  assert.ok(flagsOf(built, sez).includes('tax_type_treatment_mismatch'));
  assert.ok(flagsOf(built, far).includes('tax_type_treatment_mismatch'));
  assert.deepEqual(flagsOf(built, home).filter(k => /mismatch/.test(k)), []);
  assert.equal(rowsOf(built, 'invoices', far)[0]['Item Tax'], 'GST18', 'the tax is written as Tally has it');
  assert.match(built.exceptions.find(e => e.rec === far && e.kind === 'tax_type_treatment_mismatch').message, /Either .* or the tax in Tally should have been IGST/);
});

// ---------- GST-002: an untaxed or rate-less line never drops the GST of the others ----------
const R = (...pairs) => ({ ratedetails: pairs.map(([h, r]) => ({ gstratedutyhead: h, gstratevaluationtype: 'Based on Value', gstrate: ` ${r}` })) });
test('GST-002: an 18% line next to an exempt line without a rate keeps its GST; the exempt line is untaxed (zero-rate), and the total ties', () => {
  const a = rec('sales', vch('E-1', [['Home Buyer', '-2180.00'], ['Sales', '1000.00', R(['CGST', 9], ['SGST/UTGST', 9])], ['Exempt Sales', '1000.00'], ['Out CGST', '90.00'], ['Out SGST', '90.00']], { placeofsupply: 'Karnataka' }));
  const built = build([a]);
  const rows = rowsOf(built, 'invoices', a);
  assert.deepEqual(rows.map(r => [r.Account, r['Item Tax'], r['Item Tax %']]), [['Sales', 'GST18', '18'], ['Exempt Sales', 'GST0', '0']]);
  const flags = flagsOf(built, a);
  assert.ok(flags.includes('tax_unrated_line_untaxed'), flags.join(', '));
  assert.ok(!flags.includes('tax_not_attributable') && !flags.includes('document_total_differs'), flags.join(', '));
});

test('GST-002: a charge taxed with the goods (no rate on either line) is written at the one standard rate that alone fits; an uncertain split is still flagged', () => {
  // 1000 + 100 with 99 + 99: only 18% on both fits (no mixed choice of standard rates gives 198)
  const both = rec('sales', vch('F-1', [['Home Buyer', '-1298.00'], ['Sales', '1000.00'], ['Freight Income', '100.00'], ['Out CGST', '99.00'], ['Out SGST', '99.00']], { placeofsupply: 'Karnataka' }));
  // 1000 + 500 with 90 + 90: 12% on both, or 18% on the first only: not certain
  const unsure = rec('sales', vch('F-2', [['Home Buyer', '-1680.00'], ['Sales', '1000.00'], ['Freight Income', '500.00'], ['Out CGST', '90.00'], ['Out SGST', '90.00']], { placeofsupply: 'Karnataka' }));
  const built = build([both, unsure]);
  assert.deepEqual(rowsOf(built, 'invoices', both).map(r => [r['Item Tax'], r['Item Tax %']]), [['GST18', '18'], ['GST18', '18']]);
  assert.ok(flagsOf(built, both).includes('tax_rate_from_amount'));
  assert.ok(!flagsOf(built, both).includes('document_total_differs'));
  assert.deepEqual(rowsOf(built, 'invoices', unsure).map(r => r['Item Tax']), ['', '']);
  assert.ok(flagsOf(built, unsure).includes('tax_not_attributable'));
});

// ---------- GST-014: no service code suggested on a goods line ----------
test('GST-014: a stock item line under a 4-digit goods heading never gets a 99.. service code from the words', async () => {
  const { resolveHsn } = await import('../src/defaults.js');
  const h = resolveHsn({ raw: '8471', item: 'Server Rack Hosting' }, { enabled: true, minDigits: 6 });
  assert.ok(!String(h.value).startsWith('99'), JSON.stringify(h));
  assert.equal(resolveHsn({ raw: '', item: 'Transport Trolley' }, { enabled: true, minDigits: 6, headingOnly: true }).source, 'missing');
});

// ---------- GST-011: rates Zoho does not create by itself ----------
test('GST-011: a 3% or 40% line uses GST3 / IGST40 when the saved Zoho tax list has them; otherwise a blocking flag names the tax to create', async () => {
  const { BLOCKS_IMPORT } = await import('../src/testreport.js');
  const three = rec('sales', vch('T-1', [['Home Buyer', '-1030.00'], ['Jewellery Sales', '1000.00'], ['Out CGST', '15.00'], ['Out SGST', '15.00']], { placeofsupply: 'Karnataka' }));
  const forty = rec('purchase', vch('T-2', [['Zone Supplier', '1400.00'], ['Purchases', '-1000.00'], ['In IGST', '-400.00']]), 'Bill');
  let built = build([three, forty], { zohoTaxNames: ['GST3', 'IGST40', 'GST18', 'IGST18'] });
  assert.equal(rowsOf(built, 'invoices', three)[0]['Item Tax'], 'GST3');
  assert.equal(rowsOf(built, 'bills', forty)[0]['Tax Name'], 'IGST40');
  assert.ok(!flagsOf(built, three).includes('gst_rate_without_zoho_tax'));
  built = build([three, forty]);
  assert.equal(rowsOf(built, 'invoices', three)[0]['Item Tax'], '');
  assert.ok(flagsOf(built, three).includes('gst_rate_without_zoho_tax'));
  assert.match(built.exceptions.find(e => e.rec === forty && e.kind === 'gst_rate_without_zoho_tax').message, /Create the tax "IGST40"/);
  assert.ok(BLOCKS_IMPORT.has('gst_rate_without_zoho_tax'));
});

// ---------- GST-001: a tax mapped per ledger never overrides the rate of a line ----------
test('GST-001: a ledger mapped to GST18 writes its 5% line as GST5 (flagged); mapping a ledger used at several rates to one rate-named tax is refused', async () => {
  const { mappingConflict } = await import('../src/taxes.js');
  const a = rec('sales', vch('M-1', [['Home Buyer', '-1390.00'], ['Sales A', '1000.00', R(['CGST', 9], ['SGST/UTGST', 9])], ['Sales B', '200.00', R(['CGST', 2.5], ['SGST/UTGST', 2.5])], ['Out CGST', '95.00'], ['Out SGST', '95.00']], { placeofsupply: 'Karnataka' }));
  // 1000 at 18% and 200 at 5%: CGST and SGST 90 + 5 each
  const built = build([a], { taxMap: { 'Out CGST': 'GST18', 'Out SGST': 'GST18' } });
  assert.deepEqual(rowsOf(built, 'invoices', a).map(r => [r['Item Tax'], r['Item Tax %']]), [['GST18', '18'], ['GST5', '5']]);
  assert.ok(flagsOf(built, a).includes('tax_mapping_rate_differs'));
  // with a saved list that lacks GST5, the line is left without a tax (never GST18 at 5%)
  const strict = build([a], { taxMap: { 'Out CGST': 'GST18', 'Out SGST': 'GST18' }, zohoTaxNames: ['GST18'] });
  assert.deepEqual(rowsOf(strict, 'invoices', a).map(r => r['Item Tax']), ['GST18', '']);
  const t = { ledger: 'Out CGST', head: 'CGST', kind: 'gst', rates: [{ rate: '5', vouchers: 1 }, { rate: '18', vouchers: 3 }] };
  assert.match(mappingConflict(t, 'GST18'), /several rates/);
  assert.equal(mappingConflict({ ...t, rates: [{ rate: '18', vouchers: 3 }] }, 'GST18'), null);
});

test('GST-001: the Zoho check says a GSTnn / IGSTnn tax written with another percentage may be refused', () => {
  const inv = r => ({ 'Invoice Number': 'C-1', 'Invoice Date': '2025-06-01', 'Customer Name': 'Home Buyer', 'GST Treatment': 'business_gst', 'Place of Supply': 'KA', Account: 'Sales', 'Item Name': 'Sales', Quantity: '1', 'Item Price': '100', 'Item Tax Type': 'Tax Group', ...r });
  assert.ok(causesOf('invoices', [inv({ 'Item Tax': 'GST18', 'Item Tax %': '5' })]).some(c => /^INV-TAX-NAME-RATE/.test(c)));
  assert.ok(!causesOf('invoices', [inv({ 'Item Tax': 'GST18', 'Item Tax %': '18' })]).some(c => /^INV-TAX-NAME-RATE/.test(c)));
  assert.ok(!causesOf('invoices', [inv({ 'Item Tax': 'My Tax', 'Item Tax %': '5' })]).some(c => /^INV-TAX-NAME-RATE/.test(c)));
});

// ---------- GST-004: several company GST registrations ----------
test('GST-004: a document of another company GSTIN than the Zoho organisation\'s is flagged as blocking; the organisation\'s own are not', async () => {
  const { BLOCKS_IMPORT } = await import('../src/testreport.js');
  const companyGst = { status: 'regular', gstin: '29ABCDE1234F1Z5', state: 'KA', registrations: [{ gstin: '29ABCDE1234F1Z5', state: 'KA', vouchers: 5 }, { gstin: '27ABCDE1234F1Z5', state: 'MH', vouchers: 2 }] };
  const other = rec('sales', vch('G-1', [['Home Buyer', '-1180.00'], ['Sales', '1000.00'], ['Out IGST', '180.00']], { cmpgstin: '27ABCDE1234F1Z5', cmpgststate: 'Maharashtra', placeofsupply: 'Karnataka' }));
  const mine = rec('sales', vch('G-2', [['Home Buyer', '-1180.00'], ['Sales', '1000.00'], ['Out CGST', '90.00'], ['Out SGST', '90.00']], { cmpgstin: '29ABCDE1234F1Z5', placeofsupply: 'Karnataka' }));
  const built = build([other, mine], { companyGst });
  assert.ok(flagsOf(built, other).includes('multiple_gst_registrations'));
  assert.ok(!flagsOf(built, mine).includes('multiple_gst_registrations'));
  assert.match(built.exceptions.find(e => e.rec === other && e.kind === 'multiple_gst_registrations').message, /27ABCDE1234F1Z5 \(state MH\).*2 company GSTINs/);
  assert.ok(BLOCKS_IMPORT.has('multiple_gst_registrations'));
  // one registration only: nothing to say
  assert.ok(!flagsOf(build([other], { companyGst: { ...companyGst, registrations: companyGst.registrations.slice(0, 1) } }), other).includes('multiple_gst_registrations'));
});

// ---------- GST-005: cess ----------
test('GST-005: GST with cess on a line and no Zoho tax chosen is a blocking flag, never a silently untaxed line; a mapped group is written', async () => {
  const { BLOCKS_IMPORT } = await import('../src/testreport.js');
  const masters = { ...MASTERS, 'Out Cess': { taxtype: 'GST', gstdutyhead: 'Cess' } };
  const over = { taxLedgers: new NameSet(Object.keys(masters)), taxInfo: n => (masters[n] ? taxLedgerInfo(masters[n]) : null) };
  const a = rec('sales', vch('K-1', [['Home Buyer', '-1400.00'], ['Motor Cars', '1000.00', R(['CGST', 14], ['SGST/UTGST', 14], ['Cess', 12])], ['Out CGST', '140.00'], ['Out SGST', '140.00'], ['Out Cess', '120.00']], { placeofsupply: 'Karnataka' }));
  let built = build([a], over);
  assert.equal(rowsOf(built, 'invoices', a)[0]['Item Tax'], '');
  assert.ok(flagsOf(built, a).includes('gst_cess_not_mapped'), flagsOf(built, a).join(', '));
  assert.ok(BLOCKS_IMPORT.has('gst_cess_not_mapped'));
  built = build([a], { ...over, taxMap: { 'Out CGST': 'GST28 + Cess 12', 'Out SGST': 'GST28 + Cess 12', 'Out Cess': 'GST28 + Cess 12' } });
  assert.deepEqual([rowsOf(built, 'invoices', a)[0]['Item Tax'], rowsOf(built, 'invoices', a)[0]['Item Tax %']], ['GST28 + Cess 12', '40']);
  assert.ok(!flagsOf(built, a).includes('gst_cess_not_mapped'));
});

// ---------- GST-010 (part): a reversal of input credit is not reverse charge ----------
test('GST-010: the same GST ledger debited and credited on a bill is not read as reverse charge', () => {
  const a = rec('purchase', vch('V-1', [['Home Supplier', '1000.00'], ['Repairs', '-1000.00'], ['In IGST', '-180.00'], ['In IGST', '180.00']]), 'Bill');
  const built = build([a]);
  assert.ok(!flagsOf(built, a).some(k => /^reverse_charge/.test(k)), flagsOf(built, a).join(', '));
  assert.ok(rowsOf(built, 'bills', a).every(r => !r['Reverse Charge Tax Name']));
});
