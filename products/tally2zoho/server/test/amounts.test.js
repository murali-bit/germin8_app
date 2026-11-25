// The "amounts" batch: bills and invoices carry Tally's exact amounts into Zoho Books. Every company, ledger, party,
// number and amount below is MADE UP. The rules under test read Tally's amounts, duty heads and types, never a name.
//  - Zoho keeps the TDS Amount of the file: TDS never reaches the Adjustment column
//  - Zoho rounds each part of the tax on its own (CGST and SGST of a tax group), per line or per document (a setting)
//  - the GST rate is taken from Tally's amounts when the ledger's rate does not fit them and one standard rate does
//  - GST that Tally worked out on a base that includes a duty line of type "Others" is put on that line too
//  - round-off and tax rounding in the Adjustment column are moved back to the Tally ledgers by a generated journal
//  - SAC: a code under Tally's own shorter heading; suggestions match whole words and say a tie
//  - a document that will still come to another total in Zoho than in Tally is a cause in the Zoho check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-amounts-'));
const { NameSet } = await import('../src/tally.js');
const V = await import('../src/vouchers.js');
const D = await import('../src/defaults.js');
const { checkFiles } = await import('../src/zohocheck.js');
const Decimal = (await import('decimal.js')).default;
const dec = x => new Decimal(x);
const { buildVoucherOutput, taxLedgerInfo, taxComponents, zohoTaxModel, gstBaseWithOtherDuty, adjustmentJournalRows, BILL_HEADERS } = V;

const MASTERS = {
  'Input CGST': { taxtype: 'GST', gstdutyhead: 'CGST' }, 'Input SGST': { taxtype: 'GST', gstdutyhead: 'SGST/UTGST' },
  'Input IGST': { taxtype: 'GST', gstdutyhead: 'IGST', rateoftaxcalculation: ' 18' },
  'Output CGST': { taxtype: 'GST', gstdutyhead: 'CGST' }, 'Output SGST': { taxtype: 'GST', gstdutyhead: 'SGST/UTGST' },
  'TDS on Fees': { taxtype: 'TDS', tdsratename: '194J' }, 'Staff Welfare Levy': { taxtype: 'Others' },
};
const KINDS = { 'Consulting Charges': 'expense', 'Travel Cost': 'expense', Purchases: 'expense', 'Service Income': 'income', Rounding: 'expense' };
const CONTACTS = {
  customers: { 'Buyer Local': { treatment: 'business_gst', gstin: '29AAAAA0000A1Z2', place: 'KA' } },
  vendors: { 'Vendor Local': { treatment: 'business_gst', gstin: '29BBBBB0000B1Z5', place: 'KA' }, 'Vendor Other State': { treatment: 'business_gst', gstin: '27CCCCC0000C1Z5', place: 'MH' } },
};
const ctxOf = (over = {}) => ({
  customers: new NameSet(Object.keys(CONTACTS.customers)), vendors: new NameSet(Object.keys(CONTACTS.vendors)), taxLedgers: new NameSet(Object.keys(MASTERS)),
  taxMap: {}, taxInfo: n => (MASTERS[n] ? taxLedgerInfo(MASTERS[n]) : null),
  kindOf: n => KINDS[n] ?? (MASTERS[n] ? 'tax' : CONTACTS.customers[n] ? 'customer' : CONTACTS.vendors[n] ? 'vendor' : null),
  tdsMap: {}, tdsDefault: n => D.tdsSuggestion(taxLedgerInfo(MASTERS[n] || {}), n), contactOf: (section, ledger) => CONTACTS[section][ledger] || null,
  isRoundOff: n => n === 'Rounding',
  gstRegisteredCodes: new Set(['business_gst']), defaultRouting: true, year: { from: '2025-04-01', to: '2026-03-31' }, ...over,
});
let nextId = 0;
const vch = (number, lines, over = {}) => ({ vouchernumber: number, date: '20250601', cmpgststate: 'Karnataka', allledgerentries: lines.map(([ledgername, amount, more]) => ({ ledgername, amount, ...(more || {}) })), ...over });
const rec = (slot, data, decision) => ({ id: ++nextId, source_id: `g${nextId}`, name: `${slot} ${data.vouchernumber}`, slot, data, decision });
const build = (recs, over) => buildVoucherOutput(recs, ctxOf(over));
const rowsOf = (built, file, r) => built[file].rows.filter(x => x.rec === r).map(x => x.row);
const flagsOf = (built, r) => built.exceptions.filter(e => e.rec === r && e.kind).map(e => e.kind);
const bill = (number, lines, over) => rec('purchase', vch(number, lines, over));
const sale = (number, lines, over) => rec('sales', vch(number, lines, over));
const R = (...pairs) => ({ ratedetails: pairs.map(([h, r]) => ({ gstratedutyhead: h, gstratevaluationtype: 'Based on Value', gstrate: ` ${r}` })) });
const HALVES = R(['CGST', 9], ['SGST/UTGST', 9]);
const P = { ispartyledger: true };
// the total Zoho Books works out from the rows of a bill: lines, the tax per part of each line, less TDS Amount, plus Adjustment
const r2 = d => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const zohoBillTotal = rows => rows.reduce((t, x) => {
  const line = dec(x.Rate), pct = dec(x['Tax Percentage'] || 0);
  return t.plus(line).plus(x['Tax Type'] === 'Tax Group' ? r2(line.times(pct.div(2)).div(100)).times(2) : r2(line.times(pct).div(100)));
}, dec(0)).minus(dec(rows[0]['TDS Amount'] || 0)).plus(dec(rows[0].Adjustment || 0)).toFixed(2);

test('the tax Zoho works out: each part of a tax group is rounded on its own; per line, or per document', () => {
  const group = rate => taxComponents({ type: 'Tax Group', rate: dec(rate) }), single = rate => taxComponents({ type: 'ItemAmount', rate: dec(rate) });
  const tax = (amount, comps, mode) => zohoTaxModel([{ amount: dec(amount), comps }], mode).total.toFixed(2);
  // one rounding at 18% would give 5644.07, 14268.51, 724.27 and 65.93
  assert.deepEqual(['31355.94', '79269.49', '4023.72', '366.30'].map(a => tax(a, group(18))), ['5644.06', '14268.50', '724.26', '65.94']);
  assert.equal(tax('31355.94', single(18)), '5644.07', 'IGST is one part: one rounding');
  assert.deepEqual(group(18).map(c => c.rate.toString()), ['9', '9']);
  assert.deepEqual(taxComponents({ type: 'Tax Group', rate: dec(18), rates: [dec(12), dec(6)], ledgers: ['A', 'B'] }).map(c => [c.rate.toString(), c.ledger]), [['12', 'A'], ['6', 'B']], 'uneven parts of the Tally ledgers are kept');
  // three lines of 10.05 at 9% + 9%: per line 0.90 + 0.90 each (5.40 in all); per document 2.7135 rounded twice (5.42)
  const lines = [1, 2, 3].map(() => ({ amount: dec('10.05'), comps: group(18) }));
  assert.deepEqual([zohoTaxModel(lines, 'line').total.toFixed(2), zohoTaxModel(lines, 'entity').total.toFixed(2)], ['5.40', '5.42']);
  // the amount per Tally tax ledger, for the adjustment journal
  const m = zohoTaxModel([{ amount: dec('100.05'), comps: taxComponents({ type: 'Tax Group', rate: dec(18), rates: [dec(9), dec(9)], ledgers: ['Input CGST', 'Input SGST'] }) }]);
  assert.deepEqual([...m.byLedger].map(([k, v]) => [k, v.toFixed(2)]), [['Input CGST', '9.00'], ['Input SGST', '9.00']]);
});

test('an invoice or bill whose CGST and SGST are each the rounded half gets no Adjustment (18% rounded once would be a paisa more)', () => {
  const inv = sale('S-1', [['Buyer Local', '-37000.00', P], ['Service Income', '31355.94', HALVES], ['Output CGST', '2822.03'], ['Output SGST', '2822.03']]);
  const b = bill('B-1', [['Purchases', '-79269.49', HALVES], ['Input CGST', '-7134.25'], ['Input SGST', '-7134.25'], ['Vendor Local', '93537.99', P]]);
  let built = build([inv, b]);
  assert.deepEqual([rowsOf(built, 'invoices', inv)[0].Adjustment ?? '', rowsOf(built, 'bills', b)[0].Adjustment ?? ''], ['', '']);
  assert.deepEqual([...flagsOf(built, inv), ...flagsOf(built, b)].filter(k => /^zoho_recompute/.test(k)), []);
  assert.equal(zohoBillTotal(rowsOf(built, 'bills', b)), '93537.99');
  assert.deepEqual([built.recomputeDocs.length, built.adjustmentJournals.length], [0, 0]);
  // a real difference still reaches the Adjustment: Tally's 2.68 + 2.68 on 29.70 against Zoho's 2.67 + 2.67
  const real = bill('B-2', [['Purchases', '-29.70', HALVES], ['Input CGST', '-2.68'], ['Input SGST', '-2.68'], ['Vendor Local', '35.06', P]]);
  built = build([real]);
  assert.deepEqual([rowsOf(built, 'bills', real)[0].Adjustment, flagsOf(built, real).filter(k => /^zoho_recompute/.test(k))], ['0.02', ['zoho_recompute_adjusted']]);
  assert.equal(zohoBillTotal(rowsOf(built, 'bills', real)), '35.06');
  // an organisation that rounds the tax per document: two lines of 10.05 are 0.90 + 0.90 each per line (3.60), and
  // 1.809 rounded twice (3.62) per document; Tally booked 1.81 + 1.81
  const two = bill('B-3', [['Purchases', '-10.05', HALVES], ['Travel Cost', '-10.05', HALVES], ['Input CGST', '-1.81'], ['Input SGST', '-1.81'], ['Vendor Local', '23.72', P]]);
  assert.equal(rowsOf(build([two]), 'bills', two)[0].Adjustment, '0.02');
  assert.equal(rowsOf(build([two], { settings: { zohoTaxRounding: 'entity' } }), 'bills', two)[0].Adjustment ?? '', '');
});

test('TDS never reaches the Adjustment column: Zoho keeps the TDS Amount written; a tax rounding difference on the same bill still does', () => {
  // Tally rounds 10% of 24876.00 (2487.60) to the rupee
  const b = bill('T-1', [['Consulting Charges', '-24876.00'], ['Vendor Local', '22388.00', P], ['TDS on Fees', '2488.00']]);
  let built = build([b]);
  assert.deepEqual(rowsOf(built, 'bills', b).map(x => [x['TDS Percentage'], x['TDS Amount'], x.Adjustment ?? '']), [['10', '2488.00', '']]);
  assert.equal(zohoBillTotal(rowsOf(built, 'bills', b)), '22388.00');
  assert.deepEqual(flagsOf(built, b).filter(k => /^zoho|tds_amount/.test(k)), []);
  // GST rounding (0.02) and TDS rounded to the rupee on one bill: only the tax part is adjusted
  const both = bill('T-2', [['Consulting Charges', '-4023.72', HALVES], ['Input CGST', '-362.14'], ['Input SGST', '-362.14'], ['Vendor Local', '4346.00', P], ['TDS on Fees', '402.00']]);
  built = build([both]);
  assert.deepEqual(rowsOf(built, 'bills', both).map(x => [x['TDS Amount'], x.Adjustment]), [['402.00', '0.02']]);
  assert.equal(zohoBillTotal(rowsOf(built, 'bills', both)), '4346.00');
  assert.match(built.exceptions.find(e => e.rec === both && e.kind === 'zoho_recompute_adjusted').message, /724\.26, but Tally's tax is 724\.28/);
});

test('the GST rate comes from Tally\'s amounts when the rate on the tax ledger does not fit them and exactly one standard rate does', () => {
  // the tax ledger says 18%, the amounts say 5% (1065.00 on 21300.00); the line itself has no rate
  const air = bill('A-1', [['Travel Cost', '-21300.00'], ['Input IGST', '-1065.00'], ['Vendor Other State', '22365.00', P]]);
  let built = build([air]);
  assert.deepEqual(rowsOf(built, 'bills', air).map(x => [x['Tax Name'], x['Tax Percentage'], x['Tax Amount'], x['Tax Type'], x.Adjustment ?? '']), [['IGST5', '5', '1065.00', 'ItemAmount', '']]);
  assert.ok(flagsOf(built, air).includes('tax_rate_from_amount'));
  assert.deepEqual(flagsOf(built, air).filter(k => /^zoho_recompute|tax_amount_differs/.test(k)), []);
  assert.equal(zohoBillTotal(rowsOf(built, 'bills', air)), '22365.00');
  assert.match(built.exceptions.find(e => e.rec === air && e.kind === 'tax_rate_from_amount').message, /Tally gives for the line is 18%.*carry 1065\.00, which is 5% of the line/);
  // the ledger is mapped to a Zoho tax of the ledger's rate: the mapped 18% tax is never written at the wrong rate
  built = build([air], { taxMap: { 'Input IGST': 'IGST18' } });
  assert.deepEqual(rowsOf(built, 'bills', air).map(x => [x['Tax Name'], x['Tax Percentage']]), [['IGST5', '5']]);
  // a CGST + SGST pair whose line says 9% + 9% while the amounts are 6% + 6%: half the fitted rate each
  const pair = bill('A-2', [['Purchases', '-1000.00', HALVES], ['Input CGST', '-60.00'], ['Input SGST', '-60.00'], ['Vendor Local', '1120.00', P]]);
  built = build([pair]);
  assert.deepEqual(rowsOf(built, 'bills', pair).map(x => [x['Tax Name'], x['Tax Percentage'], x['Tax Type']]), [['GST12', '12', 'Tax Group']]);
  assert.equal(zohoBillTotal(rowsOf(built, 'bills', pair)), '1120.00');
  // no standard rate fits (20%): Tally's rate stays and the bill is flagged, never adjusted away
  const odd = bill('A-3', [['Purchases', '-9000.00', R(['IGST', 18])], ['Input IGST', '-1800.00'], ['Vendor Other State', '10800.00', P]]);
  built = build([odd]);
  assert.deepEqual(rowsOf(built, 'bills', odd).map(x => [x['Tax Name'], x['Tax Percentage']]), [['IGST18', '18']]);
  assert.ok(flagsOf(built, odd).includes('tax_amount_differs') && flagsOf(built, odd).includes('zoho_recompute_differs') && !flagsOf(built, odd).includes('tax_rate_from_amount'));
  assert.deepEqual(built.recomputeDocs.map(d => [d.file, d.number, d.adjusted]), [['bills', 'A-3', false]]);
  // a rate that fits is never touched
  const fine = bill('A-4', [['Purchases', '-1000.00'], ['Input IGST', '-180.00'], ['Vendor Other State', '1180.00', P]]);
  built = build([fine]);
  assert.deepEqual([rowsOf(built, 'bills', fine)[0]['Tax Name'], flagsOf(built, fine).filter(k => /rate_from|recompute/.test(k))], ['IGST18', []]);
});

test('GST that Tally worked out on the lines together with a duty line of type "Others" is put on that line too (bills)', () => {
  const lines = (fee, levy, half, tds) => [['Consulting Charges', `-${fee}.00`], ['Staff Welfare Levy', `-${levy}.00`], ['Input CGST', `-${half}.00`], ['Input SGST', `-${half}.00`],
    ['Vendor Local', `${fee + levy + 2 * half - tds}.00`, P], ['TDS on Fees', `${tds}.00`]];
  // 900 + 900 is 18% of 10000 (9000 + 1000), not of 9000
  const a = bill('O-1', lines(9000, 1000, 900, 1000)), b = bill('O-2', lines(9000, 600, 864, 960));
  let built = build([a, b]);
  const cells = r => rowsOf(built, 'bills', r).map(x => [x.Account, x.Rate, x['Tax Name'], x['Tax Percentage'], x['Tax Amount'], x['Tax Type']]);
  assert.deepEqual(cells(a), [['Consulting Charges', '9000.00', 'GST18', '18', '1620.00', 'Tax Group'], ['Staff Welfare Levy', '1000.00', 'GST18', '18', '180.00', 'Tax Group']]);
  assert.deepEqual(cells(b), [['Consulting Charges', '9000.00', 'GST18', '18', '1620.00', 'Tax Group'], ['Staff Welfare Levy', '600.00', 'GST18', '18', '108.00', 'Tax Group']]);
  assert.deepEqual([zohoBillTotal(rowsOf(built, 'bills', a)), zohoBillTotal(rowsOf(built, 'bills', b))], ['10800.00', '10368.00'], "Tally's vendor amounts");
  for (const r of [a, b]) {
    assert.ok(flagsOf(built, r).includes('gst_on_other_duty_line') && !flagsOf(built, r).includes('non_gst_duty_on_document'));
    assert.deepEqual(flagsOf(built, r).filter(k => /recompute|tax_amount_differs/.test(k)), []);
  }
  assert.match(built.exceptions.find(e => e.rec === a && e.kind === 'gst_on_other_duty_line').message, /is 18% of the lines together with "Staff Welfare Levy"/);
  // the GST fits the fee alone (810 + 810 on 9000): the "Others" line stays a line with no GST, as before
  const alone = bill('O-3', lines(9000, 1000, 810, 1000));
  built = build([alone]);
  assert.deepEqual(rowsOf(built, 'bills', alone).map(x => [x.Account, x['Tax Percentage']]), [['Consulting Charges', '18'], ['Staff Welfare Levy', '0']]);
  assert.ok(flagsOf(built, alone).includes('non_gst_duty_on_document') && !flagsOf(built, alone).includes('gst_on_other_duty_line'));
  assert.equal(zohoBillTotal(rowsOf(built, 'bills', alone)), '10620.00');
  // neither base fits a standard rate: nothing is guessed
  const neither = bill('O-4', lines(9000, 1000, 777, 1000));
  built = build([neither]);
  assert.ok(!flagsOf(built, neither).includes('gst_on_other_duty_line'));
  // the rule itself, from amounts only
  const L = (total, more) => ({ total: dec(total), ...more }), T = (head, amount) => ({ head, amount: dec(amount), ledger: head });
  const other = { noTax: true, otherDuty: true };
  assert.equal(gstBaseWithOtherDuty([L(9000), L(1000, other)], [T('CGST', 900), T('SGST', 900)]).rate.toString(), '18');
  assert.equal(gstBaseWithOtherDuty([L(9000), L(1000, other)], [T('IGST', 500)]).rate.toString(), '5');
  assert.equal(gstBaseWithOtherDuty([L(9000), L(1000, other)], [T('CGST', 810), T('SGST', 810)]), null, 'fits the taxed lines alone');
  assert.equal(gstBaseWithOtherDuty([L(9000), L(1000, { noTax: true })], [T('CGST', 900), T('SGST', 900)]), null, 'a TDS line on the other side is never taxed');
  assert.equal(gstBaseWithOtherDuty([L(9000), L(1000, other)], [T('CGST', 900)]), null, 'CGST without SGST decides nothing');
});

test('adjustment journals: what Zoho posts to its own adjustment account is moved back to the Tally ledger, one journal a month', () => {
  // an invoice with Tally round-off of -0.04 (a debit on the round-off ledger), and bills with 0.02 of tax rounding
  const inv = sale('R-1', [['Buyer Local', '-1180.00', P], ['Service Income', '1000.04', HALVES], ['Output CGST', '90.00'], ['Output SGST', '90.00'], ['Rounding', '-0.04']]);
  const taxRounding = [['Purchases', '-29.70', HALVES], ['Input CGST', '-2.68'], ['Input SGST', '-2.68'], ['Vendor Local', '35.06', P]];
  const b = bill('R-2', taxRounding, { date: '20250615' }), later = bill('R-3', taxRounding, { date: '20250702' });
  let built = build([inv, b, later]);
  assert.equal(rowsOf(built, 'invoices', inv)[0].Adjustment, '-0.04');
  assert.deepEqual(built.adjustmentJournals.map(j => [j.number, j.date, j.documents]), [['ADJ-202506', '2025-06-15', 2], ['ADJ-202507', '2025-07-02', 1]]);
  const gen = built.journals.rows.filter(x => x.generated).map(x => x.row);
  const line = x => [x['Reference Number'], x['Journal Date'], x.Account, x['Contact Name'], x.Debit, x.Credit];
  assert.deepEqual(gen.filter(x => x['Reference Number'] === 'ADJ-202506').map(line).sort((p, q) => p[2].localeCompare(q[2])), [
    ['ADJ-202506', '2025-06-15', 'Input CGST', '', '0.01', ''], ['ADJ-202506', '2025-06-15', 'Input SGST', '', '0.01', ''],
    ['ADJ-202506', '2025-06-15', 'Other Charges', '', '', '0.04'], ['ADJ-202506', '2025-06-15', 'Other Expenses', '', '', '0.02'],
    ['ADJ-202506', '2025-06-15', 'Rounding', '', '0.04', '']]);
  // every generated journal balances, and names no customer, vendor or bank
  for (const n of new Set(gen.map(x => x['Reference Number']))) {
    const mine = gen.filter(x => x['Reference Number'] === n);
    assert.equal(mine.reduce((t, x) => t.plus(dec(x.Debit || 0)).minus(dec(x.Credit || 0)), dec(0)).toFixed(2), '0.00');
  }
  assert.match(built.exceptions.find(e => e.rec === inv && e.kind === 'round_off_adjustment').message, /posts it to "Other Charges"; the adjustment journal generated/);
  // the organisation uses other accounts; with a name left empty no journal is written for those documents
  built = build([inv, b], { settings: { invoiceAdjustmentAccount: 'Sundry Adjustments', billAdjustmentAccount: '' } });
  assert.deepEqual(built.journals.rows.filter(x => x.generated).map(x => [x.row.Account, x.row.Debit, x.row.Credit]).sort(), [['Rounding', '0.04', ''], ['Sundry Adjustments', '', '0.04']]);
  // the function: amounts that cancel within a month write nothing; a number already taken is not reused
  const part = (ledger, amount, why) => ({ ledger, amount: dec(amount), why });
  let out = adjustmentJournalRows([{ file: 'invoices', date: '2025-08-03', number: 'X1', parts: [part('Rounding', '0.05', 'round_off')] }, { file: 'invoices', date: '2025-08-09', number: 'X2', parts: [part('Rounding', '-0.05', 'round_off')] }], {});
  assert.deepEqual([out.rows.length, out.journals.length], [0, 0]);
  out = adjustmentJournalRows([{ file: 'bills', date: '2025-08-03', number: 'X1', parts: [part('Rounding', '0.05', 'round_off')] }], { settings: { documentStatus: 'draft' } }, new Set(['ADJ-202508']));
  assert.deepEqual(out.rows.map(x => [x['Reference Number'], x.Account, x.Debit, x.Credit, x.Status]), [['ADJ2-202508', 'Rounding', '0.05', '', 'draft'], ['ADJ2-202508', 'Other Expenses', '', '0.05', 'draft']]);
});

test('SAC: a code under the shorter heading Tally has; suggestions match whole words, are scored, and say a tie', () => {
  const table = { entries: [
    { code: '999293', label: 'Training and coaching', keywords: ['class', 'course', 'training', 'coaching'] },
    { code: '998314', label: 'Software design', keywords: ['software', 'it support'] },
    { code: '997212', label: 'Rent of property', keywords: ['rent', 'lease'] },
    { code: '998361', label: 'Advertising', keywords: ['advertis*'] }] };
  const s = n => D.sacSuggestion(n, table)?.code ?? null;
  assert.deepEqual(['Classic Furniture Sales', 'Classified Ads Income', 'Discourse fees', 'Sales - Current Year', 'Parent company recharge', 'Release fees', 'Audit support fees'].map(s), [null, null, null, null, null, null, null]);
  assert.deepEqual(['Coaching classes', 'Online Courses', 'Office Rent', 'Advertising income', 'IT  Support charges'].map(s), ['999293', '999293', '997212', '998361', '998314']);
  assert.deepEqual(D.sacSuggestion('Software training', table), { code: '999293', label: 'Training and coaching', ambiguous: [{ code: '998314', label: 'Software design' }] });
  assert.equal(s('Software training course'), '999293', 'two words of one entry beat one word of another');
  assert.equal(D.sacSuggestion('Office Rent', table, '9993'), null, 'only codes under the heading');
  // the tool's own table: common words of ledger names are not mistaken for a service
  assert.deepEqual(['Sales - Current Year', 'Parent company recharge', 'Classic Furniture Sales'].map(n => D.sacSuggestion(n)), [null, null, null]);
  // Tally has a 5-digit heading: the code written lies under it
  const org = { enabled: true, minDigits: 6, sacTable: table };
  let r = D.resolveHsn({ raw: '99929', account: 'Coaching Income' }, org);
  assert.deepEqual([r.value, r.source, r.from], ['999293', 'heading', '99929']);
  // no suggestion under the heading: the suggestion from the words is written (never an empty cell) and said to be outside it
  r = D.resolveHsn({ raw: '99831', account: 'Coaching Income' }, org);
  assert.deepEqual([r.value, r.source, r.outsideHeading], ['999293', 'suggested', true]);
  // a code chosen for the account wins; a stock item gets a code under its heading but never one from the words alone
  r = D.resolveHsn({ raw: '99929', account: 'Coaching Income' }, { ...org, defaults: { account: { 'Coaching Income': '999299' } } });
  assert.deepEqual([r.value, r.source], ['999299', 'chosen_account']);
  assert.deepEqual([D.resolveHsn({ raw: '99929', item: 'Coaching batch' }, { ...org, headingOnly: true }).value, D.resolveHsn({ raw: '', item: 'Coaching batch' }, { ...org, headingOnly: true }).value], ['999293', '']);
});

test('Zoho check: a document that will come to another total than in Tally is a cause, named with its difference', () => {
  const row = (number, vendor) => ({ 'Bill Date': '2025-06-01', 'Bill Number': number, 'Bill Status': 'open', 'Vendor Name': vendor, Account: 'Purchases', Quantity: '1', Rate: '100.00' });
  const file = rows => ({ headers: BILL_HEADERS, rows: rows.map(r => BILL_HEADERS.map(h => r[h] ?? '')), bytes: 1000 });
  const run = options => checkFiles({ bills: file([row('B-1', 'Vendor One'), row('B-2', 'Vendor One'), row('B-2', 'Vendor One'), row('B-2', 'Vendor Two')]) }, { homeState: 'KA', zohoNames: { taxes: [], tds_taxes: [] }, ...options }).files[0];
  assert.ok(!run({}).causes.some(c => c.ruleId === 'BIL-TOTAL-DIFFERS-FROM-TALLY'));
  const f = run({ docTotalDiffers: { bills: [{ number: 'B-2', party: 'vendor one', difference: '-180.00' }] } });
  const c = f.causes.find(x => x.ruleId === 'BIL-TOTAL-DIFFERS-FROM-TALLY');
  assert.deepEqual([c.tier, c.rows, c.documents], ['warning', 2, 1], 'the two rows of the one bill; the bill of the other vendor with the same number is not it');
  assert.match(c.message, /comes to another total than in Tally\. It is: B-2 \(-180\.00\)\./);
});
