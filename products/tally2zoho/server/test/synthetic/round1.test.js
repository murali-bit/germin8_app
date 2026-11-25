// Round 1 of the re-check (made-up companies only): a ledger in Tally's Trial Balance but missing from the masters is
// created from the report, so no file names an account or contact Zoho Books does not have; every difference of the
// predicted trial balance carries the tool's own reason (left-out vouchers included); a Trial Balance line no file
// creates keeps its amount.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runCompany, closeApp, refusedFindings } from './harness.js';
import { ledgersFromTrialBalance } from '../../src/tbledgers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const load = async n => import(pathToFileURL(path.resolve(here, '../../fixtures/synthetic', `${n}.js`)).href);
after(() => closeApp());
const runs = new Map();
const run = async n => { if (!runs.has(n)) runs.set(n, await runCompany(await load(n))); return runs.get(n); };
const rowsOf = (r, k) => r.files[k]?.rows || [];

test('a customer missing from the masters is created from the Trial Balance with the party details of its voucher, and its invoice is not refused', async () => {
  const r = await run('c01_services_gst');
  const c = rowsOf(r, 'customers').find(x => x['Display Name'] === 'Zephyr Analytics');
  assert.ok(c, 'the customer is in the Customers file');
  assert.equal(c['GST Treatment'], 'business_gst');
  assert.match(c['GST Identification Number (GSTIN)'], /^29/);
  assert.equal(c['Place Of Contact'], 'KA');
  assert.ok(rowsOf(r, 'invoices').some(x => x['Customer Name'] === 'Zephyr Analytics'));
  assert.deepEqual(refusedFindings(r).map(f => `${f.File} | ${f.Record} | ${f.Rule}`), []);
  assert.equal(r.predicted.comparison.agrees, true, 'Zoho Books receivables equal Tally once the customer exists');
  assert.ok(r.assumptions.assumptions.some(a => a.kind === 'ledger_added_from_trial_balance' && a.count === 1), 'listed under Assumptions the tool made');
  assert.ok(r.exceptions.some(e => e.kind === 'party_missing' && /Zephyr/.test(e.name)), 'the missing party is still flagged');
});

test('a vendor kept in dollars missing from the masters becomes an overseas USD vendor, and its bill is written in dollars at Tally\'s rate', async () => {
  const r = await run('c07_forex');
  const v = rowsOf(r, 'vendors').find(x => x['Display Name'] === 'Pacific Tern Components LLC');
  assert.ok(v);
  assert.equal(v['Currency Code'], 'USD');
  assert.equal(v['GST Treatment'], 'overseas');
  const b = rowsOf(r, 'bills').filter(x => x['Vendor Name'] === 'Pacific Tern Components LLC');
  assert.equal(b.length, 1);
  assert.deepEqual([b[0]['Currency Code'], b[0]['Exchange Rate'], b[0].Rate], ['USD', '85.7', '1800.00']);
  assert.ok(!refusedFindings(r).some(f => /PTC-551|Pacific/.test(`${f.Record}`)));
});

for (const [company, ledger, type, journal] of [
  ['c03_manufacturing', 'Factory Overheads Suspense', 'Other Current Liability', 'J/003'],
  ['c06_multi_state', 'Branch Suspense - Chennai', 'Other Current Liability', 'J/001'],
  ['c10_complex_openings', 'Director Remuneration Payable', 'Other Current Liability', 'J/004'],
]) {
  test(`${company}: the ledger "${ledger}" missing from the masters is a Chart of Accounts row typed from its Trial Balance group, and ${journal} is not refused`, async () => {
    const r = await run(company);
    const a = rowsOf(r, 'accounts').find(x => x['Account Name'] === ledger);
    assert.ok(a, 'the account is in the Chart of Accounts file');
    assert.equal(a['Account Type'], type);
    const doc = r.vouchers.find(x => x.number === journal);
    assert.equal(doc.fileKey, 'journals');
    assert.deepEqual(refusedFindings(r).map(f => `${f.File} | ${f.Record} | ${f.Rule}`), []);
  });
}

test('every difference of the predicted trial balance that is not rounding says why (refused documents and left-out vouchers)', async () => {
  for (const n of ['c01_services_gst', 'c02_trading_stock', 'c03_manufacturing', 'c04_exporter', 'c05_rcm_heavy', 'c06_multi_state', 'c08_no_gst', 'c09_tds_heavy', 'c10_complex_openings']) {
    const r = await run(n);
    const c = r.predicted.comparison;
    const bare = [...c.accounts.differing, ...c.accounts.onlyTally, ...c.accounts.onlyZoho].filter(a => !a.rounding && !a.reasons?.length).map(a => a.account);
    for (const side of ['customers', 'vendors']) for (const x of c.contacts[side].rows) if (x.difference && Number(x.difference.amount) && !x.reasons?.length) bare.push(x.contact);
    assert.deepEqual(bare, [], `${n}: differences with no reason`);
  }
});

test('a payment left out for a date that does not exist is named, with its accounts, in the predicted trial balance', async () => {
  const r = await run('c04_exporter');
  const p = r.predicted;
  assert.ok(p.leftOutVouchers.some(v => v.number === 'PY/004' && /does not exist/.test(v.why)));
  assert.ok(p.leftOut.some(w => /PY\/004/.test(w)));
  const bank = [...p.comparison.accounts.differing].find(a => /Bank Current/.test(a.account));
  assert.ok(bank?.reasons?.some(w => /PY\/004/.test(w)));
});

test('ledgersFromTrialBalance: no record for a line with no group above it, or under Duties & Taxes', () => {
  const groups = [{ metadata: { type: 'Group', name: 'Duties & Taxes', reservedname: 'Duties & Taxes' }, parent: 'Current Liabilities' }, { metadata: { type: 'Group', name: 'Current Liabilities', reservedname: 'Current Liabilities' } }];
  const analysed = [
    { lineNo: 1, name: 'Current Liabilities', hasChildren: true, matchType: 'group', matchName: 'Current Liabilities', parentLine: null },
    { lineNo: 2, name: 'Duties & Taxes', hasChildren: true, matchType: 'group', matchName: 'Duties & Taxes', parentLine: 1 },
    { lineNo: 3, name: 'Some Cess Payable', hasChildren: false, matchType: null, parentLine: 2, opening: '-100.00' },
    { lineNo: 4, name: 'Orphan Line', hasChildren: false, matchType: null, parentLine: null, opening: '' },
    { lineNo: 5, name: 'Accrued Wages', hasChildren: false, matchType: null, parentLine: 1, opening: '2500.00' },
  ];
  const { added, skipped } = ledgersFromTrialBalance({ analysed, groupRecords: groups });
  assert.deepEqual(added.map(a => [a.name, a.slots, a.record.parent, a.record.openingbalance]), [['Accrued Wages', ['accounts'], 'Current Liabilities', '2500.00']]);
  assert.deepEqual(skipped.map(s => s.name), ['Some Cess Payable', 'Orphan Line']);
});

// ---------- the Zoho check says what no import has shown yet (issues 4, 5, 6, 13) ----------
const findingsOf = (r, rule) => r.findings.filter(f => f.Rule === rule);
// (changed on purpose, round 2: a receipt or payment of a foreign-currency party at one rate is written in its currency,
// so only the journals with no foreign amount stay in rupees and are "may be refused")
test('a rupee journal on a contact kept in dollars or euros is "may be refused" (JRN-CONTACT-CURRENCY), and its credit is never applied to an invoice in another currency', async () => {
  const c04 = await run('c04_exporter');
  assert.deepEqual([...new Set(findingsOf(c04, 'JRN-CONTACT-CURRENCY').map(f => f.Record))].sort(), ['J/001', 'J/002']);
  assert.ok(findingsOf(c04, 'JRN-CONTACT-CURRENCY').every(f => /not confirmed/.test(f['Zoho is expected to'])));
  assert.ok(c04.exceptions.some(e => e.kind === 'allocation_across_currencies' && plainEnough(e.message)));
  const c07 = await run('c07_forex');
  assert.deepEqual([...new Set(findingsOf(c07, 'JRN-CONTACT-CURRENCY').map(f => f.Record))].sort(), ['FX/001', 'FX/002', 'FX/003', 'FX/004']);
  // a rupee contact on a rupee journal is not flagged
  const c01 = await run('c01_services_gst');
  assert.equal(findingsOf(c01, 'JRN-CONTACT-CURRENCY').length, 0);
});
const plainEnough = m => typeof m === 'string' && m.length > 40 && !/undefined|NaN/.test(m);

test('an ordinary GST tax on a bill of a vendor written as unregistered is "may be refused" (BIL-TAX-UNREGISTERED-VENDOR); amounts and tax are not changed', async () => {
  const r = await run('c02_trading_stock');
  const f = findingsOf(r, 'BIL-TAX-UNREGISTERED-VENDOR');
  assert.deepEqual([...new Set(f.map(x => x.Record))], ['SHD-778']);
  const rows = rowsOf(r, 'bills').filter(x => x['Bill Number'] === 'SHD-778');
  assert.ok(rows.some(x => x['Tax Name'] === 'GST5' && x['GST Treatment'] === 'business_none'), 'the tax is written as Tally has it');
});

test('BIL-LINE-ACCOUNT-TYPE: no bill line of a made-up company is on a kind of account no import has shown', async () => {
  for (const n of ['c02_trading_stock', 'c05_rcm_heavy', 'c09_tds_heavy']) assert.equal(findingsOf(await run(n), 'BIL-LINE-ACCOUNT-TYPE').length, 0, n);
});

// ---------- TDS with no Zoho TDS tax (issue 12) ----------
test('TDS with no Zoho TDS tax is in the Adjustment column of the bill, not a negative GST0 line on TDS Payable; the trial balance is still Tally\'s', async () => {
  const r = await run('c09_tds_heavy');
  const rows = rowsOf(r, 'bills').filter(x => x['Bill Number'] === 'QH/0922');
  assert.deepEqual(rows.map(x => [x.Account, x.Rate, x.Adjustment]), [['Housekeeping Charges', '40000.00', '-800.00']]);
  assert.ok(!rowsOf(r, 'bills').some(x => Number(x.Rate) < 0), 'no negative line on any bill');
  assert.ok(r.exceptions.some(e => e.kind === 'tds_to_adjustment'));
  assert.equal(r.predicted.comparison.agrees, true);
});

// ---------- Product Type of service items (issue 10) ----------
test('the Product Type of a service item follows Tally\'s type of supply, else its HSN/SAC; a disagreement is flagged', async () => {
  const { serviceItemProductType } = await import('../../src/zoho.js');
  assert.deepEqual(serviceItemProductType({ hsn: '998314', typeOfSupply: 'Services' }), { value: 'service', source: 'tally', tally: 'Services', disagrees: false });
  assert.deepEqual(serviceItemProductType({ hsn: '851762', typeOfSupply: 'Goods' }), { value: 'goods', source: 'tally', tally: 'Goods', disagrees: false });
  assert.equal(serviceItemProductType({ hsn: '851762', typeOfSupply: 'Services' }).disagrees, true);
  assert.deepEqual(serviceItemProductType({ hsn: '851762', typeOfSupply: '' }), { value: 'goods', source: 'hsn', tally: '', disagrees: false });
  assert.deepEqual(serviceItemProductType({ hsn: '', typeOfSupply: '' }).value, 'service');
  const r = await run('c07_forex');
  const it = rowsOf(r, 'items').find(x => x['Item Name'] === 'Export Sales');
  assert.equal(it['Product Type'], 'service', 'Tally says Services: written as Tally says');
  assert.ok(r.exceptions.some(e => e.kind === 'item_type_of_supply_differs_from_hsn' && e.name === 'Export Sales'));
});

// ---------- the date anchor never rests on an unproven Stock balance (issue 14) ----------
// (changed on purpose, round 2: the Stock balance is in OB-3, not in the chart)
test('with a Stock opening balance, an Equity row is still the date anchor of the Chart of Accounts', async () => {
  const r = await run('c10_complex_openings');
  const kept = rowsOf(r, 'accounts').filter(x => x['Opening Balance']).map(x => [x['Account Type'], x['Debit or Credit']]);
  assert.ok(kept.some(([t]) => t === 'Equity'), JSON.stringify(kept));
  assert.ok(!kept.some(([t]) => t === 'Stock'), 'no Stock balance in the chart');
  const stock = rowsOf(r, 'accounts').filter(x => x['Account Type'] === 'Stock').map(x => x['Account Name']);
  assert.ok(rowsOf(r, 'opening_balances_for_zoho_accounts').some(x => stock.includes(x.Account) && x['Journal Number Suffix'] === '3'), 'it is in OB-3');
  for (const z of r.predicted.comparison.mustBeZero) assert.equal(z.ok, true, z.account);
});

// ---------- GSTIN check character (issue 9) ----------
// (changed in round 2 on evidence: Zoho Books accepted a registered contact only with the GSTIN's state as its place of
// contact, third test import; Tally's other state is listed under Assumptions and the GSTIN stays flagged)
test('a GSTIN whose check character is wrong is flagged; a registered contact keeps the GSTIN\'s state, any other Tally\'s', async () => {
  const { gstinCheckDigitOk } = await import('../../src/tally.js');
  const { placeOfContact } = await import('../../src/zoho.js');
  const { gstin } = await import('../../fixtures/synthetic/lib.js');
  const good = gstin('21', 'ABCDE1234F');
  const bad = good.slice(0, 14) + (good[14] === 'A' ? 'B' : 'A');
  assert.equal(gstinCheckDigitOk(good), true);
  assert.equal(gstinCheckDigitOk(bad), false);
  const base = { placeOfSupply: '', gstin: '' };
  assert.equal(placeOfContact({ ...base, state: 'West Bengal', gstin: good }, 'business_gst').value, 'OD', 'a real GSTIN: its state (the tool\'s default)');
  const p = placeOfContact({ ...base, state: 'West Bengal', gstin: bad }, 'business_gst');
  assert.equal(p.value, 'OD', 'an invalid GSTIN on a registered contact: the GSTIN\'s state, the value Zoho accepted');
  assert.equal(p.problem.kind, 'place_differs_from_gstin', 'listed under Assumptions the tool made');
  assert.match(p.problem.message, /check character/);
  assert.match(p.problem.message, /code WB/, 'Tally\'s state is named');
  assert.equal(placeOfContact({ ...base, state: 'West Bengal', gstin: bad }, 'business_none').value, 'WB', 'not written as registered: Tally\'s state');
});
