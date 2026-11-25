// Generality review: four MADE-UP companies of different shapes are run through the voucher pipeline and the Zoho check.
// Nothing here is taken from a real company. Every name, state, GSTIN, code and amount is invented. The rules under test
// must read Tally fields (group, duty head, GST registration type, state, nature of payment, voucher type) and the
// tool's settings, never a name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-generality-'));
const { NameSet } = await import('../src/tally.js');
const { buildVoucherOutput, taxLedgerInfo, BILL_HEADERS, INVOICE_HEADERS } = await import('../src/vouchers.js');
const D = await import('../src/defaults.js');
const Z = await import('../src/zoho.js');
const { checkFiles } = await import('../src/zohocheck.js');
const { classifyTaxLedger } = await import('../src/taxaccounts.js');

let nextId = 0;
const rec = (slot, data, decision) => ({ id: ++nextId, source_id: `g${nextId}`, name: `${slot} ${data.vouchernumber}`, slot, data, decision });
const mkVoucher = (state, number, lines, over = {}) => ({ vouchernumber: number, date: '20250815', cmpgststate: state,
  allledgerentries: lines.map(([ledgername, amount, more]) => ({ ledgername, amount, ...(more || {}) })), ...over });
const rates = (...pairs) => ({ ratedetails: [...pairs.map(([h, r]) => ({ gstratedutyhead: h, gstratevaluationtype: 'Based on Value', gstrate: ` ${r}` })), { gstratedutyhead: 'Cess', gstratevaluationtype: ' Not Applicable' }] });
const party = (name, amount) => [name, amount, { ispartyledger: true }];

// A company: its ledgers (masters), contacts and settings. Everything else is the same code path for all of them.
function company({ masters, kinds, customers = {}, vendors = {}, taxMap = {}, year = { from: '2025-04-01', to: '2026-03-31' }, hsn, settings, ...more }) {
  const kindOf = n => kinds[n] ?? (masters[n] ? 'tax' : customers[n] ? 'customer' : vendors[n] ? 'vendor' : null);
  return {
    customers: new NameSet(Object.keys(customers)), vendors: new NameSet(Object.keys(vendors)), taxLedgers: new NameSet(Object.keys(masters)),
    taxMap, taxInfo: n => (masters[n] ? taxLedgerInfo(masters[n]) : null), kindOf, tdsMap: {},
    tdsDefault: n => D.tdsSuggestion(taxLedgerInfo(masters[n] || {}), n), contactOf: (section, ledger) => (section === 'customers' ? customers : vendors)[ledger] || null,
    gstRegisteredCodes: new Set(['business_gst', 'business_sez', 'business_registered_composition']), defaultRouting: true, year, hsn, settings, ...more,
  };
}
const run = (c, recs) => buildVoucherOutput(recs, c);
const rowsOf = (built, file, r) => built[file].rows.filter(x => x.rec === r).map(x => x.row);
const flagsOf = (built, r) => built.exceptions.filter(e => e.rec === r && e.kind).map(e => e.kind);
const fileOf = (built, key, headers) => ({ headers, rows: built[key].rows.map(x => headers.map(h => x.row[h] ?? '')), bytes: 1000 });
const causes = (files, options = {}) => checkFiles(files, { zohoNames: { taxes: [], tds_taxes: [] }, ...options }).files.flatMap(f => f.causes.map(c => `${f.key || f.module || ''}:${c.id}`));
// The causes of a check, without "the account does not exist" (these small companies have no Chart of Accounts file) and
// without the assumed bill HSN rule (only invoices are confirmed by a real import).
const relevant = list => list.filter(c => !/ACCOUNT-EXISTS|^bills:BIL-HSN-REQUIRED-WHEN-ENABLED$/.test(c));
const checkOf = (built, options) => relevant(causes({ invoices: fileOf(built, 'invoices', INVOICE_HEADERS), bills: fileOf(built, 'bills', BILL_HEADERS) }, options));

const GST = { 'Input CGST': { taxtype: 'GST', gstdutyhead: 'CGST' }, 'Input SGST': { taxtype: 'GST', gstdutyhead: 'SGST/UTGST' }, 'Input IGST': { taxtype: 'GST', gstdutyhead: 'IGST' },
  'Output CGST': { taxtype: 'GST', gstdutyhead: 'CGST' }, 'Output SGST': { taxtype: 'GST', gstdutyhead: 'SGST/UTGST' }, 'Output IGST': { taxtype: 'GST', gstdutyhead: 'IGST' } };
const MAP = { 'Output IGST': 'IGST18', 'Output CGST': 'GST18', 'Output SGST': 'GST18', 'Input IGST': 'IGST18', 'Input CGST': 'GST18', 'Input SGST': 'GST18' };
const stockLine = (item, qty, rate, amount, hsn, ratedetails) => ({ stockitemname: item, billedqty: qty, rate, gsthsnname: hsn, ratedetails, accountingallocations: [{ ledgername: 'Hardware Sales', amount }] });

// ======================= (a) a goods trader with stock, selling inside and outside its state =======================
// Run for four home states: nothing may depend on a state, a state code or a GSTIN of any real company.
const HOMES = [['Maharashtra', 'MH', '27'], ['Kerala', 'KL', '32'], ['Punjab', 'PB', '03'], ['Assam', 'AS', '18']];
for (const [home, code, gp] of HOMES) {
  test(`A (${home}): goods trader with stock: GST group inside the state, IGST between states, HSN and unit from the stock line`, () => {
    const other = home === 'Kerala' ? ['Tamil Nadu', 'TN', '33'] : ['Kerala', 'KL', '32'];
    const c = company({ masters: GST, kinds: { 'Hardware Sales': 'income', 'Hardware Purchases': 'expense' }, taxMap: MAP, hsn: { enabled: true, minDigits: 6 },
      customers: { 'Local Buyer': { treatment: 'business_gst', gstin: `${gp}AAAAA0000A1Z5`, place: code }, 'Far Buyer': { treatment: 'business_gst', gstin: `${other[2]}AAAAA0000A1Z5`, place: other[1] } },
      vendors: { 'Far Supplier': { treatment: 'business_gst', gstin: `${other[2]}BBBBB0000B1Z5`, place: other[1] } } });
    const intra = rec('sales', mkVoucher(home, 'S1', [party('Local Buyer', '-11800.00'), ['Output CGST', '900.00'], ['Output SGST', '900.00']], { placeofsupply: home,
      allinventoryentries: [stockLine('Bolt', '100 nos', '100.00/nos', '10000.00', '731815', rates(['CGST', 9], ['SGST/UTGST', 9]).ratedetails)] }));
    const inter = rec('sales', mkVoucher(home, 'S2', [party('Far Buyer', '-11800.00'), ['Output IGST', '1800.00']], { placeofsupply: other[0],
      allinventoryentries: [stockLine('Bolt', '100 nos', '100.00/nos', '10000.00', '731815', rates(['IGST', 18]).ratedetails)] }));
    const buy = rec('purchase', mkVoucher(home, 'P1', [party('Far Supplier', '11800.00'), ['Hardware Purchases', '-10000.00', rates(['IGST', 18])], ['Input IGST', '-1800.00']], { placeofsupply: home }));
    const b = run(c, [intra, inter, buy]);
    const inv = r => rowsOf(b, 'invoices', r)[0];
    assert.deepEqual([inv(intra)['Item Tax'], inv(intra)['Item Tax Type'], inv(intra)['Place of Supply'], inv(intra)['HSN/SAC'], inv(intra)['Usage unit'], inv(intra).Quantity, inv(intra)['Item Price']],
      ['GST18', 'Tax Group', code, '731815', 'nos', '100', '100.00']);
    assert.deepEqual([inv(inter)['Item Tax'], inv(inter)['Item Tax Type'], inv(inter)['Place of Supply']], ['IGST18', 'ItemAmount', other[1]]);
    const bl = rowsOf(b, 'bills', buy)[0];
    assert.deepEqual([bl['Tax Name'], bl['Tax Amount'], bl['Source of Supply'], bl['Destination of Supply']], ['IGST18', '1800.00', other[1], code]);
    for (const r of [intra, inter, buy]) assert.deepEqual(flagsOf(b, r), [], `${r.name} must carry no flag`);
    assert.deepEqual(checkOf(b, { homeState: code, hsnEnabled: true, hsnMinDigits: 6 }), [], 'the Zoho check finds nothing to refuse');
    assert.equal(b.recomputeDocs.length, 0);
  });
}

test('A: IGST booked on a sale inside the state, or CGST+SGST on a sale between states, is flagged and never changed', () => {
  const c = company({ masters: GST, kinds: { 'Hardware Sales': 'income' }, taxMap: MAP, hsn: { enabled: false },
    customers: { 'Local Buyer': { treatment: 'business_gst', gstin: '27AAAAA0000A1Z5', place: 'MH' }, 'Far Buyer': { treatment: 'business_gst', gstin: '32AAAAA0000A1Z5', place: 'KL' } } });
  const wrongIgst = rec('sales', mkVoucher('Maharashtra', 'W1', [party('Local Buyer', '-11800.00'), ['Hardware Sales', '10000.00', rates(['IGST', 18])], ['Output IGST', '1800.00']], { placeofsupply: 'Maharashtra' }));
  const wrongSplit = rec('sales', mkVoucher('Maharashtra', 'W2', [party('Far Buyer', '-11800.00'), ['Hardware Sales', '10000.00', rates(['CGST', 9], ['SGST/UTGST', 9])], ['Output CGST', '900.00'], ['Output SGST', '900.00']], { placeofsupply: 'Kerala' }));
  const b = run(c, [wrongIgst, wrongSplit]);
  assert.ok(flagsOf(b, wrongIgst).includes('tax_type_state_mismatch'));
  assert.ok(flagsOf(b, wrongSplit).includes('tax_type_state_mismatch'));
  assert.equal(rowsOf(b, 'invoices', wrongIgst)[0]['Item Tax'], 'IGST18', 'the tax Tally booked is kept');
});

// ======================= (b) a services company with TDS on rent, contractors, fees and commission =======================
// The nature of payment is written the way Tally's own list words it (no section number): the section comes from the
// words table lists.tds.nature_words, and every such choice is an assumption the accountant sees.
const natureLedgers = {
  'TDS Rent': 'Rent of Land, Building or Furniture', 'TDS Contractors': 'Payment to Contractors - Others', 'TDS Fees': 'Fees for Professional Services',
  'TDS Commission': 'Commission or Brokerage', 'TDS Section Only': '194H', 'TDS Plain': '',
};
const TDSM = Object.fromEntries(Object.entries(natureLedgers).map(([k, v]) => [k, { taxtype: 'TDS', ...(v ? { tdsratename: v } : {}) }]));
const servicesCompany = (over = {}) => company({ masters: { ...GST, ...TDSM }, taxMap: MAP, hsn: { enabled: true, minDigits: 6 },
  kinds: { 'Rent Paid': 'expense', 'Site Work': 'expense', 'Legal Fees': 'expense', 'Agent Commission': 'expense', 'Consulting Income': 'income' },
  customers: { 'Delhi Client': { treatment: 'business_gst', gstin: '07CCCCC0000C1Z5', place: 'DL' } },
  vendors: { Landlord: { treatment: 'business_none', gstin: '', place: 'DL' }, Builder: { treatment: 'business_none', gstin: '', place: 'DL' },
    Lawyer: { treatment: 'business_none', gstin: '', place: 'DL' }, Agent: { treatment: 'business_none', gstin: '', place: 'DL' } }, ...over });
const tdsBill = (n, exp, vendor, tdsLedger, base, tds, over = {}) => rec('purchase', mkVoucher('Delhi', n, [[exp, '-' + base], party(vendor, (Number(base) - Number(tds)).toFixed(2)), [tdsLedger, tds]], { placeofsupply: 'Delhi', ...over }));
const tdsCells = (b, r) => rowsOf(b, 'bills', r).map(x => [x['TDS Name'], x['TDS Percentage'], x['TDS Section Code'], x['TDS Amount']]);

test('B: services company in Delhi: each TDS row has a name, a percentage and a section code, in the old act form before 01/04/2026', () => {
  const rent = tdsBill('R1', 'Rent Paid', 'Landlord', 'TDS Rent', '50000.00', '5000.00'), con = tdsBill('C1', 'Site Work', 'Builder', 'TDS Contractors', '100000.00', '2000.00');
  const fee = tdsBill('F1', 'Legal Fees', 'Lawyer', 'TDS Fees', '20000.00', '2000.00'), com = tdsBill('H1', 'Agent Commission', 'Agent', 'TDS Commission', '10000.00', '500.00');
  const sec = tdsBill('H2', 'Agent Commission', 'Agent', 'TDS Section Only', '10000.00', '200.00');
  const b = run(servicesCompany(), [rent, con, fee, com, sec]);
  assert.deepEqual(tdsCells(b, rent), [['Rent on land or furniture etc', '10', '194I', '5000.00']]);
  assert.deepEqual(tdsCells(b, con), [['Payment of contractors for Others 194C 2%', '2', '194C', '2000.00']], 'a rate of 2% is the "others" tax; its name clashes with a Zoho default, so it is made unique');
  assert.deepEqual(tdsCells(b, fee), [['Professional Fees', '10', '194J', '2000.00']]);
  assert.deepEqual(tdsCells(b, com), [['Commission or Brokerage 194H 5%', '5', '194H', '500.00']]);
  assert.deepEqual(tdsCells(b, sec), [['Commission or Brokerage 194H 2%', '2', '194H', '200.00']], 'a section number alone in the nature works too');
  for (const r of [rent, con, fee, com]) {
    assert.ok(flagsOf(b, r).includes('tds_details_filled') && !flagsOf(b, r).includes('tds_details_missing'), r.name);
    assert.ok(flagsOf(b, r).includes('tds_name_default'), `${r.name}: the section was chosen by the tool, so the assumption is listed`);
  }
  assert.ok(flagsOf(b, con).includes('tds_tax_name_made_unique') && flagsOf(b, com).includes('tds_tax_name_made_unique'));
  assert.ok(b.tdsTaxes.every(t => t.act === 'old' && t.startDate === '2025-04-01' && t.rate && t.section));
  assert.equal(b.tdsTaxes.length, 5, 'one tax to create for each name, rate and section');
  // the amounts of Tally are the amounts written
  assert.deepEqual(b.bills.rows.map(x => x.row['TDS Amount']), ['5000.00', '2000.00', '2000.00', '500.00', '200.00']);
  assert.deepEqual(checkOf(b, { homeState: 'DL' }).filter(x => /TDS-THREE|TDS-SECTION/.test(x)), [], 'the check finds no TDS row with details missing');
});

test('B: the new Income Tax Act form of the section code is written from 01/04/2026, a setting forces either form', () => {
  const rent = tdsBill('R3', 'Rent Paid', 'Landlord', 'TDS Rent', '50000.00', '5000.00', { date: '20260615' });
  const fee = tdsBill('F3', 'Legal Fees', 'Lawyer', 'TDS Fees', '20000.00', '2000.00', { date: '20260615' });
  const b = run(servicesCompany({ year: null }), [rent, fee]);
  assert.deepEqual([tdsCells(b, rent)[0][2], tdsCells(b, fee)[0][2]], ['rent_land_furniture', 'professional_fees']);
  assert.ok(b.tdsTaxes.every(t => t.act === 'new' && t.startDate === '2026-04-01'));
  const forced = run(servicesCompany({ year: null, settings: { tdsAct: 'old' } }), [rent]);
  assert.equal(tdsCells(forced, rent)[0][2], '194I');
  assert.deepEqual(checkOf(b, { homeState: 'DL' }).filter(x => /TDS-THREE/.test(x)), []);
});

test('B: a TDS ledger whose nature says nothing is not guessed: the row has no TDS name and the ledger is listed as unmapped', () => {
  const r = tdsBill('X1', 'Rent Paid', 'Landlord', 'TDS Plain', '1000.00', '100.00');
  const b = run(servicesCompany(), [r]);
  assert.deepEqual(tdsCells(b, r).map(x => x[0]), [''], 'one line: the TDS is in the Adjustment column (changed on purpose, round 1 issue 12)');
  assert.deepEqual(b.tdsUnmapped.map(x => x.ledger), ['TDS Plain']);
});

test('B: TDS words of Tally\'s nature of payment give the section; a ledger name never does', () => {
  const sec = n => D.tdsSuggestion({ nature: n }, 'Unrelated Ledger')?.section ?? null;
  assert.deepEqual(['Rent of Plant & Machinery', 'Payment to Contractors - Individual/HUF', 'Fees for Technical Services', 'Insurance Commission', 'Interest other than Interest on Securities', 'Interest on Securities', 'Payment of Dividend', 'Purchase of Goods'].map(sec),
    ['194I', '194C', '194JA', '194D', '194A', '193', '194', '194Q'], 'TDS-009 (changed on purpose): technical services alone are 194JA (2%)');
  assert.equal(D.tdsSuggestion({ nature: 'Fees for Professional or Technical Services' }, 'x')?.section, '194J', 'the nature Tally has for both stays 194J');
  // TDS-008 (changed on purpose): salary and non-residents have sections now
  assert.equal(sec('Salary'), '192');
  assert.equal(sec('Payment to Non-Residents'), '195');
  assert.equal(sec('Payment to Non-Resident Sportsmen'), '194E');
  assert.equal(sec('Something Unknown'), null, 'no table row: nothing is invented');
  assert.equal(sec(''), null);
  assert.equal(D.tdsSuggestion({ nature: '' }, 'Rent Expense TDS'), null, 'a ledger name with a word but no section number gives nothing');
  assert.match(D.tdsSuggestion({ nature: 'Commission or Brokerage' }, 'x').why, /assumed/);
  assert.doesNotMatch(D.tdsSuggestion({ nature: '194H' }, 'x').why, /assumed/, 'a section number in Tally is not an assumption');
});

// ======================= (c) an exporter: overseas customers, LUT, import of services under reverse charge =======================
test('C: exporter: overseas customer is written as overseas with no state and IGST 0; an import of services keeps IGST and no state', () => {
  const masters = { ...GST, 'RCM IGST Payable': { taxtype: 'GST', gstdutyhead: 'IGST' } };
  const c = company({ masters, kinds: { 'Export Sales': 'income', 'Foreign Software': 'expense' }, taxMap: MAP, hsn: { enabled: true, minDigits: 6 },
    customers: { 'Berlin Client': { treatment: 'overseas', gstin: '', place: '' }, 'Pune Client': { treatment: 'business_gst', gstin: '27AAAAA0000A1Z5', place: 'MH' } },
    vendors: { 'Dublin Vendor': { treatment: 'overseas', gstin: '', place: '' } }, hsnDefaults: { account: { 'Export Sales': '998314' } } });
  const exp = rec('sales', mkVoucher('Tamil Nadu', 'E1', [party('Berlin Client', '-50000.00'), ['Export Sales', '50000.00']]));
  const imp = rec('purchase', mkVoucher('Tamil Nadu', 'I1', [['Foreign Software', '-10000.00'], ['Input IGST', '-1800.00'], ['RCM IGST Payable', '1800.00'], party('Dublin Vendor', '10000.00')]));
  const b = run(c, [exp, imp]);
  const e = rowsOf(b, 'invoices', exp)[0], i = rowsOf(b, 'bills', imp)[0];
  assert.deepEqual([e['GST Treatment'], e['Place of Supply'], e['Item Tax'], e['Item Tax %'], e['HSN/SAC']], ['overseas', '', 'IGST0', '0', '998314'], 'the code chosen for the income account fills the gap');
  assert.deepEqual([i['GST Treatment'], i['Source of Supply'], i['Destination of Supply'], i['Reverse Charge Tax Name'], i['Reverse Charge Tax Type'], i['GST Identification Number (GSTIN)']], ['overseas', '', 'TN', 'IGST18', 'ItemAmount', '']);
  assert.ok(flagsOf(b, imp).includes('reverse_charge_written') && !flagsOf(b, imp).includes('rcm_tax_type_changed'));
  assert.deepEqual(checkOf(b, { homeState: 'TN', hsnEnabled: true, hsnMinDigits: 6 }), []);
});

test('C: reverse charge from an unregistered vendor of another state is IGST; of the company\'s own state it is the GST group (any home state)', () => {
  for (const [home, code, other] of [['Gujarat', 'GJ', 'MH'], ['Haryana', 'HR', 'DL']]) {
    const masters = { ...GST, 'RCM CGST Payable': { taxtype: 'GST', gstdutyhead: 'CGST' }, 'RCM SGST Payable': { taxtype: 'GST', gstdutyhead: 'SGST/UTGST' }, 'RCM IGST Payable': { taxtype: 'GST', gstdutyhead: 'IGST' } };
    const c = company({ masters, kinds: { 'Legal Fees': 'expense' }, taxMap: MAP, hsn: { enabled: false },
      vendors: { Near: { treatment: 'business_none', gstin: '', place: code }, Away: { treatment: 'business_none', gstin: '', place: other } } });
    const mk = (n, v, split) => rec('purchase', mkVoucher(home, n, split
      ? [['Legal Fees', '-1000.00'], ['Input CGST', '-90.00'], ['Input SGST', '-90.00'], ['RCM CGST Payable', '90.00'], ['RCM SGST Payable', '90.00'], party(v, '1000.00')]
      : [['Legal Fees', '-1000.00'], ['Input IGST', '-180.00'], ['RCM IGST Payable', '180.00'], party(v, '1000.00')], { placeofsupply: home }));
    const near = mk('N1', 'Near', false), away = mk('A1', 'Away', true);
    const b = run(c, [near, away]);
    assert.deepEqual([rowsOf(b, 'bills', near)[0]['Reverse Charge Tax Name'], rowsOf(b, 'bills', near)[0]['Reverse Charge Tax Type']], ['GST18', 'Tax Group'], home);
    assert.deepEqual([rowsOf(b, 'bills', away)[0]['Reverse Charge Tax Name'], rowsOf(b, 'bills', away)[0]['Reverse Charge Tax Type']], ['IGST18', 'ItemAmount'], home);
    assert.ok(flagsOf(b, near).includes('rcm_tax_type_changed') && flagsOf(b, away).includes('rcm_tax_type_changed'), 'the change of the tax account is always listed');
    assert.deepEqual(checkOf(b, { homeState: code }).filter(x => /RCM/.test(x)), []);
  }
});

// ======================= (d) composition vendor, unregistered vendors, and HSN/SAC switched off =======================
const shopVendors = { 'Comp Vendor': { treatment: 'business_registered_composition', gstin: '29DDDDD0000D1Z5', place: 'KA' }, 'Small Shop': { treatment: 'business_none', gstin: '', place: 'KA' },
  'Regular Vendor': { treatment: 'business_gst', gstin: '29EEEEE0000E1Z5', place: 'KA' } };
const shop = hsn => company({ masters: GST, kinds: { Supplies: 'expense', 'Shop Sales': 'income', 'Consulting Income': 'income' }, taxMap: MAP, hsn,
  customers: { 'Walk-in': { treatment: 'business_none', gstin: '', place: 'KA' } }, vendors: shopVendors });
const shopRecs = () => [rec('purchase', mkVoucher('Karnataka', 'P1', [['Supplies', '-500.00'], party('Comp Vendor', '500.00')], { placeofsupply: 'Karnataka' })),
  rec('purchase', mkVoucher('Karnataka', 'P2', [['Supplies', '-300.00'], party('Small Shop', '300.00')], { placeofsupply: 'Karnataka' })),
  rec('purchase', mkVoucher('Karnataka', 'P3', [['Supplies', '-1000.00', rates(['CGST', 9], ['SGST/UTGST', 9])], ['Input CGST', '-90.00'], ['Input SGST', '-90.00'], party('Regular Vendor', '1180.00')], { placeofsupply: 'Karnataka' })),
  rec('sales', mkVoucher('Karnataka', 'S1', [party('Walk-in', '-200.00'), ['Consulting Income', '200.00']], { placeofsupply: 'Karnataka' }))];

test('D: a composition vendor is treated as registered (zero-rate tax, listed); an unregistered vendor gets no tax; a regular vendor its GST', () => {
  const recs = shopRecs();
  const b = run(shop({ enabled: false }), recs);
  const bill = n => rowsOf(b, 'bills', recs[n])[0];
  assert.deepEqual([0, 1, 2].map(n => [bill(n)['GST Treatment'], bill(n)['Tax Name'], bill(n)['Tax Amount']]),
    [['business_registered_composition', 'GST0', '0.00'], ['business_none', '', ''], ['business_gst', 'GST18', '180.00']]);
  assert.deepEqual([0, 1, 2].map(n => flagsOf(b, recs[n])), [['bill_line_zero_tax'], [], []], 'the zero-rate tax of a composition vendor is an assumption the accountant sees');
  // GST-024: no import has shown that Zoho takes a 0% tax on a composition vendor's bill, so the check says "may be
  // refused" for exactly that line (and nothing else)
  assert.deepEqual(checkOf(b, { homeState: 'KA', hsnEnabled: false }), ['bills:BIL-ZERO-TAX-REGISTERED'], 'and the Zoho check agrees with what is written');
  // the real wiring (index.js) must use the same three codes as this test
  assert.ok(fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8').includes('gstRegisteredCodes: new Set([codes.regular, codes.sez, codes.composition]'));
});

test('D: with HSN/SAC switched off in Zoho nothing is written, flagged or predicted as refused; with it on, a line with no code is blocked', () => {
  const recs = shopRecs();
  const off = run(shop({ enabled: false }), recs);
  assert.equal(rowsOf(off, 'invoices', recs[3])[0]['HSN/SAC'], '');
  assert.deepEqual(off.exceptions.filter(e => /^hsn_/.test(e.kind || '')), []);
  assert.deepEqual(checkOf(off, { homeState: 'KA', hsnEnabled: false }).filter(x => /HSN/.test(x)), []);
  assert.deepEqual(causes({ bills: fileOf(off, 'bills', BILL_HEADERS) }, { homeState: 'KA', hsnEnabled: false }).filter(x => /HSN/.test(x)), [], 'bills too');
  // on: the service income gets a suggestion from the words of its name (listed), a name with no words gives a blocking flag
  const on = run(shop({ enabled: true, minDigits: 6 }), recs);
  assert.equal(rowsOf(on, 'invoices', recs[3])[0]['HSN/SAC'], '998311');
  assert.ok(flagsOf(on, recs[3]).includes('hsn_suggested'));
  const blind = rec('sales', mkVoucher('Karnataka', 'S2', [party('Walk-in', '-200.00'), ['Shop Sales', '200.00']], { placeofsupply: 'Karnataka' }));
  const b2 = run(shop({ enabled: true, minDigits: 6 }), [blind]);
  assert.equal(rowsOf(b2, 'invoices', blind)[0]['HSN/SAC'], '');
  assert.ok(flagsOf(b2, blind).includes('hsn_missing_required'));
  assert.ok(checkOf(b2, { homeState: 'KA', hsnEnabled: true, hsnMinDigits: 6 }).includes('invoices:INV-HSN-REQUIRED-WHEN-ENABLED'), 'the Zoho check predicts the refusal before download');
  // 4-digit mode: a 4-digit code of Tally is kept; 6-digit mode drops it
  const four = rec('sales', mkVoucher('Karnataka', 'S3', [party('Walk-in', '-200.00'), ['Shop Sales', '200.00', { gsthsnname: '7213' }]], { placeofsupply: 'Karnataka' }));
  assert.equal(rowsOf(run(shop({ enabled: true, minDigits: 4 }), [four]), 'invoices', four)[0]['HSN/SAC'], '7213');
  assert.equal(rowsOf(run(shop({ enabled: true, minDigits: 6 }), [four]), 'invoices', four)[0]['HSN/SAC'], '');
});

// ======================= the contacts of different shapes =======================
test('contacts of every shape: registration type, GSTIN and state decide the treatment and the place, never a name', () => {
  const gst = (over, set) => Z.gstTreatment({ registrationType: '', country: 'India', gstin: '', ...over }, set);
  assert.equal(gst({ registrationType: 'Regular', gstin: '29AAAAA0000A1Z5' }).value, 'business_gst');
  assert.equal(gst({ registrationType: 'Regular', gstin: '29AAAAA0000A1Z5' }, 'help').value, 'business_registered_regular');
  assert.equal(gst({ registrationType: 'Composition', gstin: '29AAAAA0000A1Z5' }).value, 'business_registered_composition');
  assert.equal(gst({ registrationType: 'Regular', gstin: '29AAAAA0000A1Z5', sez: true }).value, 'business_sez');
  assert.equal(gst({ registrationType: 'Unregistered' }).value, 'business_none');
  assert.equal(gst({ registrationType: 'Consumer' }).value, 'business_none');
  assert.equal(gst({ registrationType: 'Unregistered', country: 'Germany' }).value, 'overseas');
  assert.equal(gst({ registrationType: '', country: 'United Arab Emirates' }).value, 'overseas');
  assert.equal(gst({ registrationType: '' }).value, '', 'an Indian party with no type is not guessed');
  assert.ok(gst({ registrationType: '' }).problem);
  const place = (state, gstin = '', treatment = 'business_gst') => Z.placeOfContact({ state, gstin }, treatment);
  assert.deepEqual([place('Delhi').value, place('Jammu & Kashmir').value, place('Odisha').value, place('Dadra & Nagar Haveli and Daman & Diu').value], ['DL', 'JK', 'OD', 'DN']);
  assert.equal(place('', '33AAAAA0000A1Z5').value, 'TN', 'the state of the GSTIN when Tally has none');
  assert.equal(place('Goa', '', 'overseas').value, '', 'an overseas party has no state');
  assert.equal(place('').value, '');
  assert.ok(place('').problem);
});

// ======================= Tally GST ledgers on any names =======================
test('GST ledgers are told by duty head, side and group, not by their names', () => {
  const led = (name, over) => ({ metadata: { type: 'Ledger', name }, name, parent: 'Duties & Taxes', taxtype: 'GST', ...over });
  const c = over => classifyTaxLedger(led('Zz Ledger', over), {});
  assert.deepEqual([c({ gstdutyhead: 'CGST' }).head, c({ gstdutyhead: 'CGST' }).side], ['CGST', 'output']);
  assert.equal(c({ gstdutyhead: 'SGST/UTGST', isinputcredit: true }).side, 'input');
  assert.equal(c({ gstdutyhead: 'IGST', isinputcredit: 'Yes' }).side, 'input');
  assert.equal(classifyTaxLedger(led('Anything', { gstdutyhead: 'IGST', parent: 'Indirect Expenses' }), {}), null, 'outside Duties & Taxes it is an ordinary account');
  assert.equal(classifyTaxLedger(led('Anything', { taxtype: 'Others' }), {}), null);
  const tds = classifyTaxLedger(led('Anything', { taxtype: 'TDS' }), {});
  assert.deepEqual([tds.kind, tds.certainty], ['tds', 'ask']);
});

// ======================= nothing of a real company is in the code or the rules =======================
test('no GSTIN of a real party is written in the source or the rules (only made-up or documentation examples)', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = path.join(here, '../src');
  const gstin = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g;
  for (const f of fs.readdirSync(dir).filter(x => /\.(js|json)$/.test(x))) {
    for (const m of fs.readFileSync(path.join(dir, f), 'utf8').match(gstin) || []) assert.match(m, /^\d{2}(ABCDE1234F1Z5|AAAAA0000A1Z5)$/, `${f} has the GSTIN-like value ${m}`);
  }
});
