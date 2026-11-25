// Verifier findings after stage B8: narration cleaned in Notes, a Duties & Taxes ledger that is neither GST nor TDS kept
// out of the GST, tax under reverse charge not written as the vendor's tax, IGST / CGST + SGST checked against the two
// states, a missing state on a taxed document blocking, a line without an Item Name flagged, and mapping profiles
// hidden from a viewer of another company (and readable by a viewer of the same one).
// Every name, number and amount here is MADE UP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-fixes-'));
const { buildApp } = await import('../src/index.js');
const { NameSet } = await import('../src/tally.js');
const { buildVoucherOutput, taxLedgerInfo, cleanText } = await import('../src/vouchers.js');
const { taxLedgersToDecide } = await import('../src/taxes.js');
const { BLOCKS_IMPORT } = await import('../src/testreport.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const samples = path.resolve(here, '../../sample-data');
const seed = JSON.parse(fs.readFileSync(path.resolve(here, '../seed-users.json'), 'utf8'));

// ---------- building documents ----------
const vch = (number, lines, extra = {}) => ({ vouchernumber: number, date: '20250601', ...extra, allledgerentries: lines.map(([ledgername, amount]) => ({ ledgername, amount })) });
let nextId = 0;
const rec = (slot, data, decision) => ({ id: ++nextId, source_id: `f${nextId}`, name: `${slot} ${data.vouchernumber}`, slot, data, decision });
const MASTERS = {
  'In CGST': { taxtype: 'GST', gstdutyhead: 'CGST' }, 'In SGST': { taxtype: 'GST', gstdutyhead: 'SGST/UTGST' }, 'In IGST': { taxtype: 'GST', gstdutyhead: 'IGST' },
  'RCM IGST Payable': { taxtype: 'GST', gstdutyhead: 'IGST' }, 'Other Levy': { taxtype: 'Others' }, 'Out IGST': { taxtype: 'GST', gstdutyhead: 'IGST' },
};
const CONTACTS = { vendors: { 'Vend Same': { treatment: 'business_gst', gstin: '29BBBBB0000B1Z5', place: 'KA' }, 'Vend Other': { treatment: 'business_gst', gstin: '27CCCCC0000C1Z5', place: 'MH' },
  'Vend Nostate': { treatment: 'business_none', gstin: '', place: '' } }, customers: { 'Cust Home': { treatment: 'business_gst', gstin: '29AAAAA0000A1Z5', place: 'KA' } } };
const build = (recs, over = {}) => buildVoucherOutput(recs, {
  customers: new NameSet(Object.keys(CONTACTS.customers)), vendors: new NameSet(Object.keys(CONTACTS.vendors)), taxLedgers: new NameSet(Object.keys(MASTERS)),
  taxMap: { 'In CGST': 'GST18', 'In SGST': 'GST18', 'In IGST': 'IGST18', 'RCM IGST Payable': 'IGST18', 'Out IGST': 'IGST18' },
  taxInfo: n => (MASTERS[n] ? taxLedgerInfo(MASTERS[n]) : null), contactOf: (s, l) => CONTACTS[s][l] || null, ...over,
});
const flagsOf = (b, r) => b.exceptions.filter(e => e.rec === r && e.kind).map(e => e.kind);
const rowsOf = (b, file, r) => b[file].rows.filter(x => x.rec === r).map(x => x.row);
// v2 (changed on purpose): the Bills file has no Item Total column any more (Zoho works the totals out itself), so the
// line amount is Quantity times Rate, as Zoho reads it.
const lineOf = r => (Number(r.Quantity) * Number(r.Rate)).toFixed(2);
const totalOf = rows => rows.reduce((t, r) => t + Number(lineOf(r)) + Number(r['Tax Amount'] || 0) - Number(r['TDS Amount'] || 0), 0);

test('the narration is written to Notes and Vendor Notes without line breaks or spaces at its ends; Tally is not changed', () => {
  const narration = '  First line\r\nsecond\tline  ';
  const j = rec('journal', vch('J-1', [['Office Expenses', '-10.00'], ['Cash', '10.00']], { narration }), 'Manual Journal');
  const b = rec('journal', vch('B-1', [['Repairs', '-10.00'], ['Vend Same', '10.00']], { narration, cmpgststate: 'Karnataka' }), 'Bill');
  const built = build([j, b]);
  assert.ok(rowsOf(built, 'journals', j).every(r => r.Notes === 'First line second line'));
  assert.equal(rowsOf(built, 'bills', b)[0]['Vendor Notes'], 'First line second line');
  assert.equal(j.data.narration, narration, 'the Tally value is unchanged');
  assert.equal(cleanText(' '), '');
  // an empty or blank narration still gives Zoho's required Notes
  const k = rec('journal', vch('J-2', [['Office Expenses', '-1.00'], ['Cash', '1.00']], { narration: ' \r\n ' }), 'Manual Journal');
  assert.equal(rowsOf(build([k]), 'journals', k)[0].Notes, 'Journal J-2 from Tally');
});

test('a Duties & Taxes ledger whose Tally type is neither GST nor TDS is its own line: the GST still goes on the line and the bill ties', () => {
  assert.deepEqual([taxLedgerInfo({ taxtype: 'Others' }).other, taxLedgerInfo({}).other, taxLedgerInfo({ taxtype: 'GST' }).other], [true, false, false]);
  const a = rec('journal', vch('O-1', [['Repairs', '-1000.00'], ['In IGST', '-180.00'], ['Other Levy', '-25.00'], ['Vend Other', '1205.00']], { cmpgststate: 'Karnataka' }), 'Bill');
  const built = build([a]);
  const rows = rowsOf(built, 'bills', a);
  assert.deepEqual(rows.map(r => [r.Account, lineOf(r), r['Tax Name'], r['Tax Amount']]), [['Repairs', '1000.00', 'IGST18', '180.00'], ['Other Levy', '25.00', '', '']]);
  assert.equal(totalOf(rows), 1205, 'the bill ties to the vendor amount');
  assert.deepEqual(flagsOf(built, a), ['non_gst_duty_on_document']);
  assert.deepEqual(built.taxOnVouchers.flatMap(x => x.taxes.map(t => t.ledger)), ['In IGST'], 'not a GST tax of the bill');
  // not asked for in Tax mapping
  const list = [{ ledger: 'Other Levy', mapped: false, notGst: true, taxRowVouchers: 3 }, { ledger: 'In IGST', mapped: false, notGst: false, taxRowVouchers: 1 }];
  assert.deepEqual(taxLedgersToDecide(list).unmapped.map(t => t.ledger), ['In IGST']);
});

test('GST debited and credited by equal amounts on a bill (reverse charge) is not written as the vendor\'s tax, nor as a negative line', () => {
  const a = rec('journal', vch('RC-1', [['Freight', '-1000.00'], ['In IGST', '-180.00'], ['RCM IGST Payable', '180.00'], ['Vend Other', '1000.00']], { cmpgststate: 'Karnataka' }), 'Bill');
  const built = build([a]);
  const rows = rowsOf(built, 'bills', a);
  // changed on purpose (audit item 1): written in the Reverse Charge columns (Zoho's IGST18 of the rate), so Zoho posts
  // the input credit and the tax payable; the bill total is still the amount owed to the vendor
  assert.deepEqual(rows.map(r => [r.Account, lineOf(r), r['Tax Name'], r['Reverse Charge Tax Name'] ?? '', r['Reverse Charge Tax Rate'] ?? '', r['Reverse Charge Tax Type'] ?? '']), [['Freight', '1000.00', '', 'IGST18', '18', 'ItemAmount']]);
  assert.equal(totalOf(rows), 1000);
  assert.deepEqual(flagsOf(built, a), ['reverse_charge_written']);
  assert.deepEqual(built.partySideTax, []);
  // when it cannot be put on the lines with certainty (two lines and no rate in Tally), it is flagged as before
  // changed on purpose (S6, GST-002): 1000 + 500 with 180 is 12% on both or 18% on the first only (500 + 500 could only be 18% on both)
  const two = rec('journal', vch('RC-3', [['Freight', '-1000.00'], ['Repairs', '-500.00'], ['In IGST', '-180.00'], ['RCM IGST Payable', '180.00'], ['Vend Other', '1500.00']], { cmpgststate: 'Karnataka' }), 'Bill');
  const t2 = build([two]);
  assert.ok(rowsOf(t2, 'bills', two).every(r => !r['Reverse Charge Tax Name']));
  assert.ok(flagsOf(t2, two).includes('reverse_charge_bill'));
  // unequal amounts are not that shape: unchanged (forward tax on the line, the credit a flagged negative line)
  const b = rec('journal', vch('RC-2', [['Freight', '-1000.00'], ['In IGST', '-180.00'], ['RCM IGST Payable', '10.00'], ['Vend Other', '1170.00']], { cmpgststate: 'Karnataka' }), 'Bill');
  const b2 = build([b]);
  assert.deepEqual(flagsOf(b2, b), ['negative_row']);
  assert.equal(rowsOf(b2, 'bills', b)[0]['Tax Name'], 'IGST18');
});

test('IGST within one state, or CGST + SGST between two states, is flagged with both states; nothing is changed', () => {
  const a = rec('journal', vch('S-1', [['Repairs', '-100.00'], ['In IGST', '-18.00'], ['Vend Same', '118.00']], { cmpgststate: 'Karnataka' }), 'Bill');
  const b = rec('journal', vch('S-2', [['Repairs', '-100.00'], ['In CGST', '-9.00'], ['In SGST', '-9.00'], ['Vend Other', '118.00']], { cmpgststate: 'Karnataka' }), 'Bill');
  const c = rec('journal', vch('S-3', [['Repairs', '-100.00'], ['In CGST', '-9.00'], ['In SGST', '-9.00'], ['Vend Same', '118.00']], { cmpgststate: 'Karnataka' }), 'Bill');
  const d = rec('sales', vch('S-4', [['Cust Home', '-118.00'], ['Sales', '100.00'], ['Out IGST', '18.00']], { cmpgststate: 'Karnataka' }));
  const built = build([a, b, c, d]);
  assert.deepEqual([flagsOf(built, a), flagsOf(built, b), flagsOf(built, c), flagsOf(built, d)], [['tax_type_state_mismatch'], ['tax_type_state_mismatch'], [], ['tax_type_state_mismatch']]);
  assert.match(built.exceptions.find(e => e.rec === a).message, /IGST .*Source of Supply is KA and Destination of Supply is KA/);
  assert.equal(rowsOf(built, 'bills', a)[0]['Tax Name'], 'IGST18', 'the tax is still written as mapped');
});

test('a missing state blocks only a document that carries GST', () => {
  const a = rec('journal', vch('N-1', [['Repairs', '-100.00'], ['In IGST', '-18.00'], ['Vend Nostate', '118.00']], { cmpgststate: 'Karnataka' }), 'Bill');
  const b = rec('journal', vch('N-2', [['Repairs', '-100.00'], ['Vend Nostate', '100.00']], { cmpgststate: 'Karnataka' }), 'Bill');
  const built = build([a, b]);
  assert.deepEqual([flagsOf(built, a), flagsOf(built, b)], [['place_of_supply_missing_taxed'], ['place_of_supply_missing']]);
});

// ---------- through the app ----------
const app = buildApp();
let cookie = '';
const call = opts => app.inject({ ...opts, headers: { ...(opts.headers || {}), ...(cookie ? { cookie } : {}) } });
const loginAs = async (email, password) => {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  assert.equal(r.statusCode, 200, `login as ${email}`);
  cookie = String(r.headers['set-cookie']).split(';')[0];
};
const login = role => { const u = seed.users.find(x => x.role === role); return loginAs(u.email, u.password); };
const ok = async (method, url, payload) => { const r = await call({ method, url, payload }); assert.equal(r.statusCode < 300, true, `${method} ${url}: ${r.body}`); return r.json(); };
const upload = (id, slot, f) => call({ method: 'PUT', url: `/api/migrations/${id}/uploads/${slot}`, headers: { 'content-type': 'application/octet-stream', 'x-filename': f }, payload: fs.readFileSync(path.join(samples, f)) });
const companyOf = () => {
  const doc = JSON.parse(fs.readFileSync(path.join(samples, '15_all_masters_for_transactions_utf16.json')).toString('utf16le').replace(/^﻿/, ''));
  return (doc.static_variables || []).find(v => v.name === 'svCurrentCompany')?.value || 'Made-up Company';
};

test('the files: a line without an Item Name is flagged once per file; an account without a type and a taxed document without a state block the import', async () => {
  await login('admin');
  const id = (await ok('POST', '/api/migrations', { company: companyOf(), financialYear: '2024-25' })).id;
  for (const [slot, f] of [['all_masters', '15_all_masters_for_transactions_utf16.json'], ['all_transactions', '16_all_transactions_utf16.json'], ['trial_balance', '17_trial_balance_report_utf16.json']]) {
    assert.equal((await upload(id, slot, f)).statusCode, 200);
  }
  for (const s of (await ok('GET', `/api/migrations/${id}/completeness`)).slots.filter(x => x.requirement !== 'optional' && x.status === 'missing')) {
    await ok('PUT', `/api/migrations/${id}/waivers/${s.key}`, { reason: 'Made-up company keeps no inventory' });
  }
  assert.equal((await call({ method: 'POST', url: `/api/migrations/${id}/process?wait=1` })).statusCode, 200);
  await ok('POST', `/api/migrations/${id}/generate`, {});
  const report = await ok('GET', `/api/migrations/${id}/test-report`);
  const gen = report.processing.flaggedItems.groups.filter(g => g.stage === 'generate');
  const noItem = gen.find(g => g.kind === 'line_without_item_name');
  assert.ok(noItem, 'flagged');
  assert.ok(noItem.count <= 2, 'one item per file');
  const fix = report.whatToFixNext.filter(f => f.stage === 'Files');
  assert.equal(fix.find(f => /line_without_item_name/.test(f.message))?.blocking, false);
  assert.ok(BLOCKS_IMPORT.has('account_type_missing') && BLOCKS_IMPORT.has('place_of_supply_missing_taxed') && !BLOCKS_IMPORT.has('line_without_item_name'));
  for (const k of ['account_type_missing', 'place_of_supply_missing_taxed']) {
    const f = fix.find(x => x.message.includes(`"${k}"`));
    if (f) assert.equal(f.blocking, true, k);
  }
  return id;
});

test('mapping profiles: a viewer of another company sees none of them; a viewer of the same company can preview with a GET', async () => {
  await login('admin');
  const company = companyOf();
  const id = (await ok('POST', '/api/migrations', { company, financialYear: '2024-25' })).id;
  for (const [slot, f] of [['all_masters', '15_all_masters_for_transactions_utf16.json'], ['all_transactions', '16_all_transactions_utf16.json'], ['trial_balance', '17_trial_balance_report_utf16.json']]) {
    assert.equal((await upload(id, slot, f)).statusCode, 200);
  }
  for (const s of (await ok('GET', `/api/migrations/${id}/completeness`)).slots.filter(x => x.requirement !== 'optional' && x.status === 'missing')) {
    await ok('PUT', `/api/migrations/${id}/waivers/${s.key}`, { reason: 'Made-up company keeps no inventory' });
  }
  assert.equal((await call({ method: 'POST', url: `/api/migrations/${id}/process?wait=1` })).statusCode, 200);
  const p = await ok('POST', `/api/migrations/${id}/profiles`, { name: 'Made-up profile', includeClientSpecific: true });
  await ok('POST', '/api/users', { name: 'Other Viewer', email: 'other.viewer@example.test', password: 'made-up-password-1', role: 'viewer', company: 'Another Made-up Company' });
  await ok('POST', '/api/users', { name: 'Same Viewer', email: 'same.viewer@example.test', password: 'made-up-password-2', role: 'viewer', company });

  await loginAs('other.viewer@example.test', 'made-up-password-1');
  assert.deepEqual((await ok('GET', '/api/profiles')).profiles.map(x => x.id), []);
  for (const url of [`/api/profiles/${p.id}`, `/api/profiles/${p.id}/export`]) assert.equal((await call({ url })).statusCode, 404, url);

  await loginAs('same.viewer@example.test', 'made-up-password-2');
  assert.deepEqual((await ok('GET', '/api/profiles')).profiles.map(x => x.id), [p.id]);
  const prev = await ok('GET', `/api/migrations/${id}/profiles/${p.id}/preview`);
  assert.ok(Array.isArray(prev.entries));
  assert.equal((await call({ method: 'POST', url: `/api/migrations/${id}/profiles/${p.id}/apply`, payload: { confirmCount: 0 } })).statusCode, 403, 'a viewer still cannot apply');
});
