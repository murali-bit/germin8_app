// S2: TDS, reverse charge and Zoho's own recomputation of tax and TDS, for ANY company. Nothing here names a party,
// a ledger, a GSTIN, an HSN code, a state or an amount of a real company: every company below is MADE UP, in a different
// shape (a goods trader with stock in another state, a services company with TDS on rent, contractors and commission,
// an exporter with overseas customers and an import of services, a composition vendor). The rules under test read Tally
// fields (the ledger's duty head and nature of payment, the GST registration of the party, the state of the supply, the
// voucher date) and the settings and tables of the tool, never a name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-anycompany-'));
const { buildApp } = await import('../src/index.js');
const { NameSet } = await import('../src/tally.js');
const { buildVoucherOutput, taxLedgerInfo, BILL_HEADERS } = await import('../src/vouchers.js');
const { tdsSuggestion } = await import('../src/defaults.js');
const T = await import('../src/tds.js');
const { readZohoTdsTaxes } = await import('../src/voucheropts.js');
const { checkFiles } = await import('../src/zohocheck.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(fs.readFileSync(path.resolve(here, '../seed-users.json'), 'utf8'));
const Decimal = (await import('decimal.js')).default;
const dec = x => new Decimal(x);

// ================= the TDS model, as a pure function =================
test('TDS: the rate is what Tally\'s own amount shows; a standard rate only, to the paisa or within the rupee Tally rounds to', () => {
  assert.equal(T.cleanTdsRate(dec('1000'), dec('10000')).toString(), '10');
  assert.equal(T.cleanTdsRate(dec('2'), dec('100')).toString(), '2');
  assert.equal(T.cleanTdsRate(dec('2488'), dec('24876')).toString(), '10', 'rounded to the rupee by Tally: 2487.60');
  assert.equal(T.cleanTdsRate(dec('77'), dec('1000')), null, '7.7% is no standard rate');
  assert.equal(T.cleanTdsRate(dec('0'), dec('1000')), null);
  assert.equal(T.cleanTdsRate(dec('10'), dec('0')), null);
});

test('TDS: the old section number and the new Income Tax Act code are one tax; the act follows the date of the document', () => {
  assert.equal(T.sectionKeyOf('194J'), T.sectionKeyOf('professional_fees'));
  assert.equal(T.sectionKeyOf('194JB'), T.sectionKeyOf('professional_fees'));
  assert.equal(T.sectionKeyOf('194C'), T.sectionKeyOf('contract_payments_individual_or_huf'));
  assert.equal(T.sectionKeyOf('payment_contractors_and_professionals'), T.sectionKeyOf('contract_payments_other_individual_or_huf'));
  assert.notEqual(T.sectionKeyOf('194H'), T.sectionKeyOf('194J'));
  assert.equal(T.sectionKeyOf(''), '');
  assert.deepEqual(['2025-06-01', '2026-03-31', '2026-04-01', '2027-01-01'].map(d => T.actFor(d)), ['old', 'old', 'new', 'new']);
  assert.deepEqual([T.actFor('2025-06-01', 'new'), T.actFor('2027-01-01', 'old'), T.actFor('', 'auto')], ['new', 'old', 'old']);
});

test('TDS, a services company: rent, contractors, commission and professional fees each get a name, a rate and a section code', () => {
  const base = { settings: { tdsAct: 'auto', tdsBase: 'subtotal' }, subTotal: dec('10000'), taxTotal: dec('0') };
  // rent of land: 10% of the base; the old act form before 01/04/2026, the new act code from that date
  let r = T.resolveTds({ ...base, amount: dec('1000'), date: '2025-06-01', suggestion: tdsSuggestion({ nature: '194I' }, 'Rent') });
  assert.deepEqual([r.tdsName, r.percent, r.section, r.rateFrom, r.act], ['Rent on land or furniture etc', '10', '194I', 'tally_amount', 'old']);
  r = T.resolveTds({ ...base, amount: dec('1000'), date: '2026-05-01', suggestion: tdsSuggestion({ nature: '194I' }, 'Rent') });
  assert.deepEqual([r.section, r.act], ['rent_land_furniture', 'new']);
  // the same section at another rate is the other tax of the section (rent of plant and machinery, 2%)
  r = T.resolveTds({ ...base, amount: dec('200'), date: '2025-06-01', suggestion: tdsSuggestion({ nature: '194I' }, 'Rent') });
  assert.deepEqual([r.tdsName, r.percent], ['Rent on plant and machinery', '2']);
  // contractors: 1% (individual or HUF) or 2% (others), the rate says which
  r = T.resolveTds({ ...base, amount: dec('100'), date: '2025-06-01', suggestion: tdsSuggestion({ nature: 'Contract 194C' }, 'TDS Contract') });
  assert.deepEqual([r.tdsName, r.percent, r.section], ['Payment of contractors HUF/Indiv 194C 1%', '1', '194C'], 'the old-act tax shares its name with a tax Zoho has by default (new act): a name of its own');
  r = T.resolveTds({ ...base, amount: dec('200'), date: '2026-06-01', suggestion: tdsSuggestion({ nature: 'Contract 194C' }, 'TDS Contract') });
  assert.deepEqual([r.tdsName, r.percent, r.section], ['Payment of contractors for Others', '2', 'payment_contractors_and_professionals']);
  // no amount to read a rate from: the rate on the Tally ledger, else the usual rate of the section (the table)
  r = T.resolveTds({ ...base, amount: null, date: '2025-06-01', suggestion: { tdsName: 'Professional Fees', section: '194J', percent: '7.5' } });
  assert.deepEqual([r.percent, r.rateFrom], ['7.5', 'tally_ledger']);
  r = T.resolveTds({ ...base, amount: dec('77'), date: '2025-06-01', suggestion: { tdsName: 'Professional Fees', section: '194J', percent: '' } });
  assert.deepEqual([r.percent, r.rateFrom], ['10', 'table']);
  // a percentage and a section typed in Mapping Studio are used as typed
  r = T.resolveTds({ ...base, amount: dec('1000'), date: '2025-06-01', mapping: { tdsName: 'My TDS tax', section: 'X-1', percent: '3.5' } });
  assert.deepEqual([r.tdsName, r.percent, r.section, r.rateFrom, r.sectionFrom, r.missing], ['My TDS tax', '3.5', 'X-1', 'mapping', 'mapping', []]);
  // a name chosen with nothing to work the rest out from: said, never invented
  r = T.resolveTds({ ...base, amount: null, date: '2025-06-01', mapping: { tdsName: 'My TDS tax', section: '', percent: '' } });
  assert.deepEqual(r.missing, ['the percentage', 'the section code']);
  // the base Zoho works TDS out on: when Tally deducted on the total with tax, the rate still comes out clean
  r = T.resolveTds({ amount: dec('118'), subTotal: dec('1000'), taxTotal: dec('180'), date: '2025-06-01', settings: { tdsBase: 'subtotal' }, suggestion: tdsSuggestion({ nature: '194J' }, 'Fees') });
  assert.deepEqual([r.percent, r.rateFrom], ['10', 'tally_amount']);
});

test('TDS, the name of a tax Zoho already has: a tax of another rate or section gets a name of its own; Zoho\'s own tax is used when it fits', () => {
  const suggestion = tdsSuggestion({ nature: '194H' }, 'Commission');
  const common = { settings: { tdsAct: 'auto' }, subTotal: dec('80000'), taxTotal: dec('0'), suggestion };
  // Tally deducted 5%; Zoho's own "Commission or Brokerage" is 2% (new act): a new tax with section and rate in its name
  let r = T.resolveTds({ ...common, amount: dec('4000'), date: '2025-10-31' });
  assert.deepEqual([r.tdsName, r.percent, r.section, r.create, r.madeUnique], ['Commission or Brokerage 194H 5%', '5', '194H', true, true]);
  // 2% after the change of act: that is Zoho's own tax, nothing to create, and its own section code
  r = T.resolveTds({ ...common, amount: dec('1600'), date: '2026-05-01' });
  assert.deepEqual([r.tdsName, r.percent, r.section, r.create, r.madeUnique, r.nameFrom], ['Commission or Brokerage', '2', 'commission_or_brokerage', false, false, 'zoho_default']);
  // the organisation's own export, with two taxes of one name (an old-act 5% and Zoho's new-act 2%): section AND rate decide
  const exported = [{ name: 'Commission or Brokerage', rate: '2.000000', section: 'commission_or_brokerage', start: '2026-04-01', end: '', status: 'Active' },
    { name: 'Commission or Brokerage', rate: '5.000000', section: '194H', start: '2025-04-01', end: '2026-03-31', status: 'Expired' }];
  r = T.resolveTds({ ...common, amount: dec('4000'), date: '2025-10-31', exported });
  assert.deepEqual([r.tdsName, r.section, r.create, r.nameFrom], ['Commission or Brokerage', '194H', false, 'zoho_export'], "the export's own spelling of the section is used as it is");
  // a rate the export does not have for that section: a tax of its own to create, with a name that cannot be mixed up
  r = T.resolveTds({ ...common, amount: dec('2400'), date: '2025-10-31', exported });
  assert.deepEqual([r.tdsName, r.percent, r.create, r.madeUnique], ['Commission or Brokerage 194H 3%', '3', true, true]);
  // a name of the table that Zoho does not use for anything else stays as it is
  r = T.resolveTds({ ...common, suggestion: tdsSuggestion({ nature: '194J' }, 'Fees'), amount: dec('8000'), date: '2025-10-31', exported });
  assert.deepEqual([r.tdsName, r.create, r.madeUnique], ['Professional Fees', true, false]);
});

test('TDS, an exporter or a trader with TDS deducted by a customer and no section in Tally: the rate decides the section; with no rate the table\'s default', () => {
  const base = { settings: {}, subTotal: dec('50000'), taxTotal: dec('0'), customer: true, date: '2025-08-01' };
  let r = T.resolveTds({ ...base, amount: dec('5000') });
  assert.deepEqual([r.inferred, r.percent, r.section], [true, '10', '194J']);
  r = T.resolveTds({ ...base, amount: dec('500') });
  assert.deepEqual([r.inferred, r.percent], [true, '1']);
  assert.ok(['194C', '194H', '194JA', '194M', '194Q'].includes(r.section) || r.tdsName, 'a section of services that has 1%');
  r = T.resolveTds({ ...base, amount: dec('3333') });
  assert.deepEqual([r.inferred, r.section, r.rateFrom], [true, '194J', 'table'], 'no standard rate: the default of the table, said');
});

test('TDS export of Zoho: two taxes of one name are two taxes, with their dates and status (the format of Zoho\'s own export)', () => {
  const csv = ['Tax ID,TDS Name,TDS Percentage,TDS Section Code,Account To Track Sales,Account To Track Purchases,Start Date,End Date,Tax Status,High TDS Rate Reason',
    '1,Dividend,10.000000,dividend,TDS Receivable,TDS Payable,2026-04-01,,Active,',
    '2,Rent,10.000000,194I,TDS Receivable,TDS Payable,2025-04-01,2026-03-31,Expired,',
    '3,Commission or Brokerage,2.000000,commission_or_brokerage,TDS Receivable,TDS Payable,2026-04-01,,Active,',
    '4,Commission or Brokerage,5.000000,194H,TDS Receivable,TDS Payable,2025-04-01,2026-03-31,Expired,'].join('\r\n');
  const r = readZohoTdsTaxes(Buffer.from(csv));
  assert.deepEqual(r.taxes.map(t => [t.name, t.rate, t.section, t.start, t.end, t.status]), [
    ['Dividend', '10.000000', 'dividend', '2026-04-01', '', 'Active'], ['Rent', '10.000000', '194I', '2025-04-01', '2026-03-31', 'Expired'],
    ['Commission or Brokerage', '2.000000', 'commission_or_brokerage', '2026-04-01', '', 'Active'], ['Commission or Brokerage', '5.000000', '194H', '2025-04-01', '2026-03-31', 'Expired']]);
});

// ================= the bills and invoices of made-up companies =================
const MASTERS = {
  'Input CGST': { taxtype: 'GST', gstdutyhead: 'CGST' }, 'Input SGST': { taxtype: 'GST', gstdutyhead: 'SGST/UTGST' }, 'Input IGST': { taxtype: 'GST', gstdutyhead: 'IGST' },
  'RCM CGST Payable': { taxtype: 'GST', gstdutyhead: 'CGST' }, 'RCM SGST Payable': { taxtype: 'GST', gstdutyhead: 'SGST/UTGST' }, 'RCM IGST Payable': { taxtype: 'GST', gstdutyhead: 'IGST' },
  'Output IGST': { taxtype: 'GST', gstdutyhead: 'IGST' },
  'TDS on Rent': { taxtype: 'TDS', tdsratename: 'Rent 194I' }, 'TDS on Commission': { taxtype: 'TDS', tdsratename: '194H' }, 'TDS on Fees': { taxtype: 'TDS', tdsratename: '194J' },
  'TDS Unknown': { taxtype: 'TDS' },
};
const KINDS = { 'Office Rent': 'expense', 'Software Charges': 'expense', Purchases: 'expense', 'Service Income': 'income', 'Export Sales': 'income' };
const CONTACTS = {
  customers: { 'Buyer Local': { treatment: 'business_gst', gstin: '29AAAAA0000A1Z2', place: 'KA' }, 'Buyer Overseas': { treatment: 'overseas', gstin: '', place: '' } },
  vendors: { 'Vendor Local': { treatment: 'business_gst', gstin: '29BBBBB0000B1Z5', place: 'KA' }, 'Vendor Other State': { treatment: 'business_gst', gstin: '27CCCCC0000C1Z5', place: 'MH' },
    'Vendor No State': { treatment: 'business_none', gstin: '', place: '' }, 'Vendor Abroad': { treatment: 'overseas', gstin: '', place: '' },
    'Vendor Composition': { treatment: 'business_registered_composition', gstin: '29DDDDD0000D1Z5', place: 'KA' } },
};
const ctxOf = (over = {}) => ({
  customers: new NameSet(Object.keys(CONTACTS.customers)), vendors: new NameSet(Object.keys(CONTACTS.vendors)), taxLedgers: new NameSet(Object.keys(MASTERS)),
  taxMap: { 'Input IGST': 'IGST18', 'Input CGST': 'GST18', 'Input SGST': 'GST18' }, taxInfo: n => (MASTERS[n] ? taxLedgerInfo(MASTERS[n]) : null),
  kindOf: n => KINDS[n] ?? (MASTERS[n] ? 'tax' : CONTACTS.customers[n] ? 'customer' : CONTACTS.vendors[n] ? 'vendor' : null),
  tdsMap: {}, tdsDefault: n => tdsSuggestion(taxLedgerInfo(MASTERS[n] || {}), n), contactOf: (section, ledger) => CONTACTS[section][ledger] || null,
  gstRegisteredCodes: new Set(['business_gst']), defaultRouting: true, year: { from: '2025-04-01', to: '2026-03-31' }, ...over,
});
let nextId = 0;
const vch = (number, lines, over = {}) => ({ vouchernumber: number, date: '20250601', cmpgststate: 'Karnataka', allledgerentries: lines.map(([ledgername, amount, more]) => ({ ledgername, amount, ...(more || {}) })), ...over });
const rec = (slot, data, decision) => ({ id: ++nextId, source_id: `g${nextId}`, name: `${slot} ${data.vouchernumber}`, slot, data, decision });
const build = (recs, over) => buildVoucherOutput(recs, ctxOf(over));
const rowsOf = (built, file, r) => built[file].rows.filter(x => x.rec === r).map(x => x.row);
const flagsOf = (built, r) => built.exceptions.filter(e => e.rec === r && e.kind).map(e => e.kind);
const bill = (number, lines, over) => rec('purchase', vch(number, lines, over));
const R = (...pairs) => ({ ratedetails: [...pairs.map(([h, r]) => ({ gstratedutyhead: h, gstratevaluationtype: 'Based on Value', gstrate: ` ${r}` })), { gstratedutyhead: 'Cess', gstratevaluationtype: ' Not Applicable' }] });

test('TDS rows: every row with a TDS Amount carries the TDS Name, Percentage and Section Code, and the taxes to create are listed', () => {
  // a services company: rent (10%) and commission (5%) on bills of its vendors, dated in the financial year (the old act)
  const rent = bill('B-1', [['Office Rent', '-10000.00'], ['Vendor Local', '9000.00', { ispartyledger: true }], ['TDS on Rent', '1000.00']]);
  const comm = bill('B-2', [['Software Charges', '-80000.00'], ['Vendor Local', '76000.00', { ispartyledger: true }], ['TDS on Commission', '4000.00']]);
  const built = build([rent, comm]);
  const cells = r => rowsOf(built, 'bills', r).map(x => [x['TDS Name'], x['TDS Percentage'], x['TDS Section Code'], x['TDS Amount']]);
  assert.deepEqual(cells(rent), [['Rent on land or furniture etc', '10', '194I', '1000.00']]);
  assert.deepEqual(cells(comm), [['Commission or Brokerage 194H 5%', '5', '194H', '4000.00']], 'Zoho has its own "Commission or Brokerage" at 2%: this one is a tax of its own');
  assert.ok(flagsOf(built, rent).includes('tds_details_filled') && !flagsOf(built, rent).includes('tds_details_missing'));
  assert.ok(flagsOf(built, comm).includes('tds_tax_name_made_unique'));
  assert.deepEqual(built.tdsTaxes.map(t => [t.name, t.rate, t.section, t.act, t.startDate, t.rows]),
    [['Commission or Brokerage 194H 5%', '5', '194H', 'old', '2025-04-01', 1], ['Rent on land or furniture etc', '10', '194I', 'old', '2025-04-01', 1]]);
  // the same company the next year: the new act's form of the section code; the setting can force either form
  const later = bill('B-3', [['Office Rent', '-10000.00'], ['Vendor Local', '9000.00', { ispartyledger: true }], ['TDS on Rent', '1000.00']], { date: '20260510' });
  assert.equal(rowsOf(build([later], { year: null }), 'bills', later)[0]['TDS Section Code'], 'rent_land_furniture');
  assert.equal(rowsOf(build([later], { year: null, settings: { tdsAct: 'old' } }), 'bills', later)[0]['TDS Section Code'], '194I');
  assert.equal(rowsOf(build([rent], { settings: { tdsAct: 'new' } }), 'bills', rent)[0]['TDS Section Code'], 'rent_land_furniture');
  // the export of the organisation decides the code and the name when it has the tax
  const tdsExport = [{ name: 'Rent', rate: '10.000000', section: '194I', start: '2025-04-01', end: '2026-03-31', status: 'Expired' }];
  const b2 = build([rent], { tdsExport });
  assert.deepEqual(cells.call(null, rent).length, 1);
  assert.deepEqual(rowsOf(b2, 'bills', rent).map(x => [x['TDS Name'], x['TDS Section Code']]), [['Rent', '194I']]);
  assert.deepEqual(b2.tdsTaxes.map(t => t.name), [], 'the tax is in the export: nothing to create');
  // a TDS ledger with no section and no choice: no TDS columns invented; the TDS is in the Adjustment column (changed on
  // purpose, round 1 issue 12: no negative line, no zero-rate GST line), and the ledger is listed as unmapped
  const none = bill('B-4', [['Office Rent', '-10000.00'], ['Vendor Local', '9500.00', { ispartyledger: true }], ['TDS Unknown', '500.00']]);
  const b3 = build([none]);
  assert.deepEqual(rowsOf(b3, 'bills', none).map(x => [x['TDS Name'], x.Adjustment]), [['', '-500.00']]);
  assert.deepEqual(b3.tdsUnmapped.map(x => x.ledger), ['TDS Unknown']);
  // a name typed in Mapping Studio with nothing to work the section code out from: said as blocking. A journal routed by
  // default stays a Manual Journal (a default never writes a row known to be refused) ...
  const lines = [['Office Rent', '-10000.00'], ['Vendor Local', '9500.00', { ispartyledger: true }], ['TDS Unknown', '500.00']];
  const typed = rec('journal', vch('J-1', lines));
  const own = { tdsMap: { 'TDS Unknown': { tdsName: 'Own tax', section: '', percent: '' } } };
  const b4 = build([typed], own);
  assert.deepEqual([b4.bills.vouchers, b4.journals.vouchers], [0, 1]);
  assert.match(b4.exceptions.find(e => e.rec === typed && e.kind === 'journal_default_manual').message, /percentage or the section code of its TDS could not be worked out/);
  // ... and one a person routed to a Bill is written, with the rate Tally's amount shows and the blocking flag
  const asBill = rec('journal', vch('J-2', lines), 'Bill');
  const b5 = build([asBill], own);
  assert.deepEqual(rowsOf(b5, 'bills', asBill).map(x => [x['TDS Name'], x['TDS Percentage'], x['TDS Section Code']]), [['Own tax', '5', '']]);
  assert.ok(flagsOf(b5, asBill).includes('tds_details_missing'));
});

test('TDS on an invoice (deducted by the customer) carries the same three columns; with no section in Tally the rate decides', () => {
  const inv = rec('sales', vch('S-1', [['Buyer Local', '-9000.00', { ispartyledger: true }], ['TDS on Fees', '-1000.00'], ['Service Income', '10000.00']]));
  const built = build([inv]);
  assert.deepEqual(rowsOf(built, 'invoices', inv).map(x => [x['TDS Name'], x['TDS Percentage'], x['TDS Section Code'], x['TDS Amount']]), [['Professional Fees', '10', '194J', '1000.00']]);
  assert.equal(built.recomputeDocs.length, 0, 'ties to Tally to the paisa');
});

test('reverse charge: the tax is chosen from the two states, not from the duty head Tally booked; the amounts never change', () => {
  const rcmIgst = (number, vendor, over) => bill(number, [['Software Charges', '-1000.00'], ['Input IGST', '-180.00'], ['RCM IGST Payable', '180.00'], [vendor, '1000.00', { ispartyledger: true }]], over);
  const rcmSplit = (number, vendor) => bill(number, [['Software Charges', '-1000.00'], ['Input CGST', '-90.00'], ['Input SGST', '-90.00'], ['RCM CGST Payable', '90.00'], ['RCM SGST Payable', '90.00'], [vendor, '1000.00', { ispartyledger: true }]]);
  const rc = (built, r) => rowsOf(built, 'bills', r).map(x => [x['Reverse Charge Tax Name'], x['Reverse Charge Tax Type'], x['Source of Supply'], x['GST Treatment']]);
  // 1. IGST booked, supply inside the state (a vendor of the company's own state): the GST group
  const inState = rcmIgst('R-1', 'Vendor Local');
  let built = build([inState]);
  assert.deepEqual(rc(built, inState), [['GST18', 'Tax Group', 'KA', 'business_gst']]);
  assert.deepEqual(flagsOf(built, inState), ['reverse_charge_written', 'rcm_tax_type_changed']);
  assert.match(built.exceptions.find(e => e.kind === 'rcm_tax_type_changed').message, /booked the reverse charge on this bill as IGST.*inside one state.*"GST18" \(CGST and SGST\) is written.*amounts are unchanged but the tax accounts differ/i);
  // 2. CGST and SGST booked, supply between two states: IGST
  const between = rcmSplit('R-2', 'Vendor Other State');
  built = build([between]);
  assert.deepEqual(rc(built, between), [['IGST18', 'ItemAmount', 'MH', 'business_gst']]);
  assert.deepEqual(flagsOf(built, between), ['reverse_charge_written', 'rcm_tax_type_changed']);
  // 3. what Tally booked already fits the states: nothing is changed or said
  const fits = rcmIgst('R-3', 'Vendor Other State');
  built = build([fits]);
  assert.deepEqual([rc(built, fits), flagsOf(built, fits)], [[['IGST18', 'ItemAmount', 'MH', 'business_gst']], ['reverse_charge_written']]);
  // 4. an import of services (an overseas vendor): IGST stays, the supply has no state
  const abroad = rcmIgst('R-4', 'Vendor Abroad');
  built = build([abroad]);
  assert.deepEqual([rc(built, abroad), flagsOf(built, abroad)], [[['IGST18', 'ItemAmount', '', 'overseas']], ['reverse_charge_written']]);
  // 5. a vendor with no state and no GSTIN: the setting decides. (Changed on purpose, tax-ledgers-rcm batch, user decision 4:
  // the default is now an import of services.) With the setting GST: the GST group (Zoho reads an empty Source of Supply
  // as inside the state)
  const nowhere = rcmIgst('R-5', 'Vendor No State');
  built = build([nowhere], { settings: { rcmUnknownState: 'intra' } });
  assert.deepEqual(rc(built, nowhere), [['GST18', 'Tax Group', '', 'business_none']]);
  assert.deepEqual(flagsOf(built, nowhere), ['reverse_charge_written', 'place_of_supply_missing', 'rcm_state_unknown_assumed']);
  // the default: an import of services. IGST kept, the bill written as overseas, with no GSTIN
  built = build([nowhere]);
  assert.deepEqual(rc(built, nowhere), [['IGST18', 'ItemAmount', '', 'overseas']]);
  assert.deepEqual(flagsOf(built, nowhere), ['reverse_charge_written', 'place_of_supply_missing', 'rcm_state_unknown_assumed']);
  assert.equal(rowsOf(built, 'bills', nowhere)[0]['GST Identification Number (GSTIN)'], '');
  // 6. the organisation's own tax list has no tax to write instead: nothing is invented, the mismatch is flagged
  built = build([inState], { zohoTaxNames: ['IGST18'] });
  assert.deepEqual(rc(built, inState), [['IGST18', 'ItemAmount', 'KA', 'business_gst']]);
  assert.ok(flagsOf(built, inState).includes('tax_type_state_mismatch'));
  // 7. a composition vendor charges no GST and has no reverse charge: its bill is untouched
  const comp = bill('R-7', [['Purchases', '-500.00'], ['Vendor Composition', '500.00', { ispartyledger: true }]]);
  built = build([comp]);
  assert.deepEqual(rowsOf(built, 'bills', comp).map(x => x['Reverse Charge Tax Name'] ?? ''), ['']);
});

test('Zoho recomputes tax and TDS from the rate and the base: a rounding difference goes to Adjustment, a larger one is flagged and listed, never hidden', () => {
  // a goods trader with stock in another state: Tally's IGST is 0.40 more than 18% of the line (Tally rounds on its own)
  const small = bill('Z-1', [['Purchases', '-1000.00', R(['IGST', 18])], ['Input IGST', '-180.40'], ['Vendor Other State', '1180.40', { ispartyledger: true }]]);
  let built = build([small]);
  assert.deepEqual(rowsOf(built, 'bills', small).map(x => [x['Tax Amount'], x.Adjustment]), [['180.40', '0.40']]);
  assert.deepEqual(flagsOf(built, small), ['zoho_recompute_adjusted']);
  assert.equal(built.bills.rows[0].row.Adjustment, '0.40');
  assert.deepEqual(built.recomputeDocs.map(d => [d.number, d.difference, d.adjusted]), [['Z-1', '-0.40', true]]);
  // "rounding differences: flag only": nothing is added, the document is flagged and listed
  built = build([small], { settings: { recomputeDiffPolicy: 'flag' } });
  assert.deepEqual([flagsOf(built, small), rowsOf(built, 'bills', small)[0].Adjustment ?? ''], [['zoho_recompute_differs'], '']);
  // a large difference (a non-taxable component Tally taxed at a lower amount): never adjusted away; the two ways out are said
  // (changed on purpose, amounts batch: 1000.00 on 21000.00 fits no standard GST rate; a tax that is exactly a standard
  // rate of the line is now written at that rate, see the test below)
  const big = bill('Z-2', [['Purchases', '-21000.00', R(['IGST', 18])], ['Input IGST', '-1000.00'], ['Vendor Other State', '22000.00', { ispartyledger: true }]]);
  built = build([big]);
  assert.ok(flagsOf(built, big).includes('zoho_recompute_differs') && !flagsOf(built, big).includes('zoho_recompute_adjusted'));
  assert.match(built.exceptions.find(e => e.kind === 'zoho_recompute_differs').message, /Zoho works out from the rates \(each part of the tax rounded on its own\) is 3780\.00, but Tally's tax is 1000\.00 \(\+2780\.00\).*accept Zoho's figure.*correct the rate or the amount in Tally/);
  assert.deepEqual(built.recomputeDocs.map(d => [d.difference, d.adjusted]), [['2780.00', false]]);
  assert.equal(rowsOf(built, 'bills', big)[0].Adjustment ?? '', '');
  // TDS (changed on purpose, amounts batch): Tally rounds 10% of 12345.67 (1234.567) up to the rupee. Zoho keeps the
  // TDS Amount of the file (a test import: tds_total equal to it), so nothing goes to Adjustment and the total is Tally's
  const tds = bill('Z-3', [['Software Charges', '-12345.67'], ['Vendor Local', '11110.67', { ispartyledger: true }], ['TDS on Fees', '1235.00']]);
  built = build([tds]);
  assert.deepEqual(rowsOf(built, 'bills', tds).map(x => [x['TDS Percentage'], x['TDS Amount'], x.Adjustment ?? '']), [['10', '1235.00', '']]);
  assert.deepEqual(flagsOf(built, tds).filter(k => /^zoho|tds_amount/.test(k)), []);
  assert.equal(built.recomputeDocs.length, 0);
  // TDS deducted on the total with tax: Tally's amount is kept by Zoho, so the total is Tally's; only the percentage
  // (100 on the sub total against 118) is flagged as a check; the setting says the base
  const onTotal = bill('Z-4', [['Software Charges', '-1000.00', R(['IGST', 18])], ['Input IGST', '-180.00'], ['Vendor Other State', '1062.00', { ispartyledger: true }], ['TDS on Fees', '118.00']]);
  built = build([onTotal]);
  assert.deepEqual([rowsOf(built, 'bills', onTotal)[0]['TDS Percentage'], flagsOf(built, onTotal).filter(k => /^zoho|tds_amount/.test(k))], ['10', ['tds_amount_differs']]);
  built = build([onTotal], { settings: { tdsBase: 'total' } });
  assert.deepEqual(flagsOf(built, onTotal).filter(k => /^zoho|tds_amount/.test(k)), [], 'on the total with tax Zoho deducts exactly what Tally did');
  // a company whose Tally amounts are exact is never touched: no flag, no Adjustment
  const exact = bill('Z-5', [['Purchases', '-1000.00', R(['IGST', 18])], ['Input IGST', '-180.00'], ['Vendor Other State', '1180.00', { ispartyledger: true }]]);
  built = build([exact]);
  assert.deepEqual([flagsOf(built, exact), rowsOf(built, 'bills', exact)[0].Adjustment ?? '', built.recomputeDocs.length], [[], '', 0]);
  // an exporter: an export invoice with no GST in Tally carries nothing to recompute
  const exportInv = rec('sales', vch('E-1', [['Buyer Overseas', '-500.00', { ispartyledger: true }], ['Export Sales', '500.00']]));
  built = build([exportInv]);
  assert.equal(built.recomputeDocs.length, 0);
});

// ================= the Zoho check predicts what Zoho refused in the second test import =================
const BILL_FILE = rows => ({ headers: BILL_HEADERS, rows: rows.map(r => BILL_HEADERS.map(h => r[h] ?? '')), bytes: 1000 });
const causeIds = (rows, options = {}) => checkFiles({ bills: BILL_FILE(rows) }, { homeState: 'KA', zohoNames: { taxes: [], tds_taxes: [] }, ...options }).files[0].causes.map(c => c.id);
const baseRow = (extra = {}) => ({ 'Bill Date': '2025-06-01', 'Bill Number': 'X-1', 'Bill Status': 'open', 'Source of Supply': 'KA', 'Destination of Supply': 'KA', 'GST Treatment': 'business_none', 'Is Inclusive Tax': 'FALSE',
  'Vendor Name': 'V', 'Currency Code': 'INR', 'Account': 'Office Rent', 'Item Description': 'x', 'Quantity': '1', 'Rate': '1000.00', ...extra });

test('Zoho check: TDS with a name and an amount but no percentage or section code is predicted as refused', () => {
  const tds = (pct, sec, name = 'Professional Fees') => baseRow({ 'TDS Name': name, 'TDS Percentage': pct, 'TDS Section Code': sec, 'TDS Amount': '100.00' });
  assert.ok(causeIds([tds('', '')]).includes('BIL-TDS-THREE-TOGETHER'));
  assert.ok(causeIds([tds('10', '')]).includes('BIL-TDS-THREE-TOGETHER'));
  assert.ok(causeIds([tds('', '194J')]).includes('BIL-TDS-THREE-TOGETHER'));
  assert.ok(!causeIds([tds('10', '194J')]).includes('BIL-TDS-THREE-TOGETHER'));
  const cause = checkFiles({ bills: BILL_FILE([tds('', '')]) }, { homeState: 'KA', zohoNames: {} }).files[0].causes.find(c => c.id === 'BIL-TDS-THREE-TOGETHER');
  assert.deepEqual([cause.tier, cause.rows], ['will', 1]);
  assert.match(cause.message, /Enter the required TDS details/);
});

test('Zoho check: a TDS name that is also a Zoho tax with another rate or section is flagged; the same tax is not', () => {
  const row = (name, pct, sec) => baseRow({ 'TDS Name': name, 'TDS Percentage': pct, 'TDS Section Code': sec, 'TDS Amount': '100.00' });
  assert.ok(causeIds([row('Commission or Brokerage', '5', '194H')]).includes('BIL-TDS-NAME-NOT-ZOHO-DEFAULT'));
  assert.ok(!causeIds([row('Commission or Brokerage', '2', 'commission_or_brokerage')]).includes('BIL-TDS-NAME-NOT-ZOHO-DEFAULT'), "Zoho's own tax");
  assert.ok(!causeIds([row('Commission or Brokerage 194H 5%', '5', '194H')]).includes('BIL-TDS-NAME-NOT-ZOHO-DEFAULT'), 'a name of its own');
  assert.ok(!causeIds([row('Commission or Brokerage', '5', '194H')], { zohoTdsTaxes: [{ name: 'Commission or Brokerage', rate: '5.000000', section: '194H' }] }).includes('BIL-TDS-NAME-NOT-ZOHO-DEFAULT'), 'it is in the organisation\'s export');
  assert.ok(!causeIds([row('Professional Fees', '10', '194J')]).includes('BIL-TDS-NAME-NOT-ZOHO-DEFAULT'));
});

test('Zoho check: reverse charge IGST on a supply inside one state, or with no Source of Supply on an unregistered vendor, is predicted as refused', () => {
  const rcm = (extra = {}) => baseRow({ 'Reverse Charge Tax Name': 'IGST18', 'Reverse Charge Tax Rate': '18', 'Reverse Charge Tax Type': 'ItemAmount', ...extra });
  assert.ok(causeIds([rcm({ 'Source of Supply': '' })]).includes('BIL-RCM-INTRA-INTER'), 'unregistered, no state: inside the state for Zoho');
  assert.ok(causeIds([rcm({ 'Source of Supply': 'KA' })]).includes('BIL-RCM-INTRA-INTER'), 'the same state');
  assert.ok(!causeIds([rcm({ 'Source of Supply': 'MH' })]).includes('BIL-RCM-INTRA-INTER'), 'another state');
  assert.ok(!causeIds([rcm({ 'Source of Supply': '', 'GST Treatment': 'overseas' })]).includes('BIL-RCM-INTRA-INTER'), 'an import of services');
  assert.ok(causeIds([rcm({ 'Reverse Charge Tax Name': 'GST18', 'Reverse Charge Tax Type': 'Tax Group', 'Source of Supply': 'MH' })]).includes('BIL-RCM-INTRA-INTER'), 'GST between two states');
  assert.ok(!causeIds([rcm({ 'Reverse Charge Tax Name': 'GST18', 'Reverse Charge Tax Type': 'Tax Group', 'Source of Supply': '' })]).includes('BIL-RCM-INTRA-INTER'), 'GST with no state is fine');
});

// ================= settings and the list of TDS taxes through the API =================
test('settings: tax act, TDS base, reverse charge with no state and rounding differences are saved, audited and checked', async () => {
  const app = buildApp();
  const u = seed.users.find(x => x.role === 'analyst');
  const cookie = String((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: u.password } })).headers['set-cookie']).split(';')[0];
  const call = o => app.inject({ ...o, headers: { ...(o.headers || {}), cookie } });
  const id = (await call({ method: 'POST', url: '/api/migrations', payload: { company: seed.users.find(x => x.role === 'viewer').company, financialYear: '2025-26' } })).json().id;
  const base = `/api/migrations/${id}`;
  let r = (await call({ url: `${base}/voucher-settings` })).json();
  assert.deepEqual([r.tdsAct, r.tdsBase, r.rcmUnknownState, r.recomputeDiffPolicy], ['auto', 'subtotal', 'overseas', 'adjustment']); // overseas: the default since the tax-ledgers-rcm batch
  assert.deepEqual(r.options.tdsAct.map(o => o.id), ['auto', 'old', 'new']);
  assert.ok(r.options.recomputeDiffPolicy.every(o => o.words));
  r = await call({ method: 'PUT', url: `${base}/voucher-settings`, payload: { tdsAct: 'new', tdsBase: 'total', rcmUnknownState: 'intra', recomputeDiffPolicy: 'flag' } });
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual([r.json().tdsAct, r.json().tdsBase, r.json().rcmUnknownState, r.json().recomputeDiffPolicy, r.json().changed], ['new', 'total', 'intra', 'flag', true]);
  assert.equal((await call({ method: 'PUT', url: `${base}/voucher-settings`, payload: { tdsAct: 'both' } })).statusCode, 400);
  assert.equal((await call({ method: 'PUT', url: `${base}/voucher-settings`, payload: { recomputeDiffPolicy: 'sometimes' } })).statusCode, 400);
  // the list of TDS taxes to create is empty before any file exists
  const list = (await call({ url: `${base}/tds-taxes-to-create` })).json();
  assert.deepEqual([list.taxes, list.exportGiven, list.toCreate], [[], false, 0]);
  // Zoho's export in its own format is read in full, two taxes of one name included
  const csv = 'Tax ID,TDS Name,TDS Percentage,TDS Section Code,Account To Track Sales,Account To Track Purchases,Start Date,End Date,Tax Status,High TDS Rate Reason\r\n'
    + '1,Commission or Brokerage,2.000000,commission_or_brokerage,TDS Receivable,TDS Payable,2026-04-01,,Active,\r\n2,Commission or Brokerage,5.000000,194H,TDS Receivable,TDS Payable,2025-04-01,2026-03-31,Expired,\r\n';
  r = await call({ method: 'PUT', url: `${base}/zoho-tds-taxes`, headers: { 'content-type': 'application/octet-stream', 'x-filename': 'tds.csv' }, payload: Buffer.from(csv) });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().taxes, 2);
  const got = (await call({ url: `${base}/zoho-tds-taxes` })).json();
  assert.deepEqual(got.taxes.map(t => [t.name, t.section, t.status]), [['Commission or Brokerage', 'commission_or_brokerage', 'Active'], ['Commission or Brokerage', '194H', 'Expired']]);
});

test('TDS taxes to create: read from the rows of the files, compared with the organisation\'s own TDS export when it was given', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { tdsTaxesInFiles } = await import('../src/importwizard.js');
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE generated_rows (job_id TEXT, key TEXT, row_no INTEGER, row_key TEXT, source_record_id INTEGER, source_id TEXT, row_data TEXT, ident TEXT);
    CREATE TABLE generated_files (job_id TEXT, key TEXT, columns TEXT, mapping_hash TEXT);
    CREATE TABLE zoho_tds_taxes (job_id TEXT, seq INTEGER, name TEXT, rate TEXT, section TEXT, start_date TEXT, end_date TEXT, status TEXT);
    CREATE TABLE zoho_tds_taxes_meta (job_id TEXT PRIMARY KEY, file_name TEXT, taxes INTEGER, uploaded_by TEXT, at TEXT);`);
  const add = (key, n, name, pct, sec) => db.prepare('INSERT INTO generated_rows VALUES (?,?,?,?,?,?,?,?)').run('J', key, n, `r${n}`, n, `s${n}`, JSON.stringify({ 'TDS Name': name, 'TDS Percentage': pct, 'TDS Section Code': sec }), `i${n}`);
  add('bills', 1, 'Rent on land or furniture etc', '10', '194I'); add('bills', 2, 'Rent on land or furniture etc', '10', '194I');
  add('bills', 3, 'Commission or Brokerage 194H 5%', '5', '194H'); add('bills', 4, '', '', '');
  add('invoices', 1, 'Dividend', '10', 'dividend');
  const job = { financial_year: '2025-26' };
  let r = tdsTaxesInFiles(db, 'J', job);
  assert.deepEqual(r.taxes.map(t => [t.name, t.rate, t.section, t.act, t.startDate, t.rows, t.inZoho]), [
    ['Commission or Brokerage 194H 5%', '5', '194H', 'old', '2025-04-01', 1, null], ['Dividend', '10', 'dividend', 'new', '2026-04-01', 1, true], ['Rent on land or furniture etc', '10', '194I', 'old', '2025-04-01', 2, null]]);
  // TDS-011: "Dividend" 10% (dividend) is a tax every new organisation has by itself: it is never to be created
  assert.equal(r.taxes.find(t => t.name === 'Dividend').zohoDefault, true);
  assert.deepEqual([r.exportGiven, r.toCreate], [false, 2]);
  // with the export: what Zoho has (same name, rate and section) is not to be created
  db.prepare("INSERT INTO zoho_tds_taxes VALUES ('J',1,'Dividend','10.000000','dividend','2026-04-01','','Active')").run();
  db.prepare("INSERT INTO zoho_tds_taxes VALUES ('J',2,'Rent on land or furniture etc','10.000000','194I','2025-04-01','2026-03-31','Expired')").run();
  db.prepare("INSERT INTO zoho_tds_taxes_meta VALUES ('J','t.csv',2,'x','now')").run();
  r = tdsTaxesInFiles(db, 'J', job);
  assert.deepEqual(r.taxes.map(t => [t.name, t.inZoho]), [['Commission or Brokerage 194H 5%', false], ['Dividend', true], ['Rent on land or furniture etc', true]]);
  assert.deepEqual([r.exportGiven, r.toCreate], [true, 1]);
});

// ================= one tool run never creates two TDS taxes with one name =================
test('TDS names: the same section at two rates in one run gives two different names (any company)', () => {
  const claims = new Map();
  const one = (pct, section) => T.resolveTds({ amount: dec(pct), subTotal: dec('100'), taxTotal: dec('0'), date: '2025-06-01', suggestion: { section, percent: pct }, settings: {}, claims });
  // a services company: professional fees at 10% and at 5% (a lower-rate deduction), rent at 10%
  const a = one('10', '194J'), b = one('5', '194J'), a2 = one('10', '194J'), b2 = one('5', '194J');
  assert.equal(a.madeUnique, false);
  assert.notEqual(a.tdsName.toLowerCase(), b.tdsName.toLowerCase(), 'two rates, two names');
  assert.equal(b.madeUnique, true);
  assert.match(b.tdsName, /5%/);
  assert.deepEqual([a2.tdsName, b2.tdsName], [a.tdsName, b.tdsName], 'the same tax always gets the same name');
  // every (name, rate, section) the run would create has a name of its own
  const all = [a, b, a2, b2].map(r => `${r.tdsName.toLowerCase()}|${r.percent}|${r.section}`);
  const byName = new Map();
  for (const k of new Set(all)) { const n = k.split('|')[0]; byName.set(n, (byName.get(n) || 0) + 1); }
  assert.ok([...byName.values()].every(n => n === 1));
  // another section of another company is not touched
  assert.equal(one('2', '194IB').madeUnique, false);
  // TDS-017: the name no longer depends on a shared run or on the order of the documents: a rate other than the section's
  // usual rate always gets its own name, with or without claims
  assert.equal(T.resolveTds({ amount: dec('5'), subTotal: dec('100'), taxTotal: dec('0'), date: '2025-06-01', suggestion: { section: '194J', percent: '5' }, settings: {} }).madeUnique, true);
});

test('TDS deducted by a customer with no section: a rate no service section has is not written as Professional Fees', () => {
  const r = (amt, base) => T.resolveTds({ amount: dec(amt), subTotal: dec(base), taxTotal: dec('0'), date: '2025-06-01', customer: true, settings: {} });
  const small = r('10', '10000'); // 0.1%, as a goods trader sees on sales (more than one section fits)
  assert.equal(small.percent, '0.1');
  assert.notEqual(small.section, '194J');
  assert.equal(small.ambiguous, true);
  const odd = r('500', '10000'); // 5%: no section has it
  assert.equal(odd.percent, '5');
  assert.deepEqual([odd.tdsName, odd.section, odd.missing], ['', '', ['the Zoho TDS tax', 'the section code']], 'left for the person to choose');
  assert.equal(r('100', '10000').section, '194C', 'a rate a service section has still picks that section');
});

test('contacts registered with no GSTIN are a blocking assumption that points to the one-click fix; TDS ambiguity is listed too', async () => {
  const { ASSUMPTIONS } = await import('../src/defaults.js');
  assert.equal(ASSUMPTIONS.gst_registered_without_gstin.blocking, true);
  assert.match(ASSUMPTIONS.gst_registered_without_gstin.words, /one button treats all of them as unregistered/);
  assert.ok(ASSUMPTIONS.tds_section_ambiguous && ASSUMPTIONS.tds_section_ambiguous.check);
});
