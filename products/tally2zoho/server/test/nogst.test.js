// Fix set S2: companies with no GST registration, no Duties & Taxes ledger, or stock without a Stock Summary (SYN-12,
// SYN-13, SYN-1, GST-012, GST-013). Every name, number and amount here is MADE UP (GSTINs carry a worked-out check
// character, none is real).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-nogst-'));
const { buildApp } = await import('../src/index.js');
const { NameSet } = await import('../src/tally.js');
const { buildVoucherOutput, taxLedgerInfo } = await import('../src/vouchers.js');
const { companyGstOf, registrationStatus, companyGstinForHsn } = await import('../src/companygst.js');
const { checkFiles } = await import('../src/zohocheck.js');
const { gstin, utf16le } = await import('../fixtures/synthetic/lib.js');
const noGst = await import('../fixtures/synthetic/c08_no_gst.js');
const trading = await import('../fixtures/synthetic/c02_trading_stock.js');
const services = await import('../fixtures/synthetic/c01_services_gst.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const seedPath = [path.resolve(here, '../seed-users.json'), path.resolve(here, '../seed-users.example.json')].find(p => fs.existsSync(p));
const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
const RULES = JSON.parse(fs.readFileSync(path.resolve(here, '../src/zohorules.json'), 'utf8'));

// ---------- the company GST identity (companygst.js) on a small in-memory store ----------
const GSTIN_KA = gstin('29', 'ABCDE1234F');
const GSTIN_TN = gstin('33', 'ABCDE1234F');
function store({ typed = '', vouchers = [], taxLedgers = [] } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE migrations (id TEXT PRIMARY KEY, gstin TEXT)');
  db.exec('CREATE TABLE source_records (id INTEGER PRIMARY KEY, job_id TEXT, slot TEXT, object_type TEXT, name TEXT, data TEXT)');
  db.prepare('INSERT INTO migrations VALUES (?, ?)').run('m1', typed);
  for (const v of vouchers) db.prepare("INSERT INTO source_records (job_id, slot, object_type, name, data) VALUES ('m1', 'sales', 'Voucher', 'v', ?)").run(JSON.stringify(v));
  for (const t of taxLedgers) db.prepare("INSERT INTO source_records (job_id, slot, object_type, name, data) VALUES ('m1', 'taxes', 'Ledger', ?, ?)").run(t.name, JSON.stringify(t));
  return db;
}

test('registrationStatus: Tally\'s registration type words', () => {
  assert.deepEqual(['Regular', 'Composition', 'Unregistered', 'Regular - SEZ', '', 'Something else'].map(registrationStatus), ['regular', 'composition', 'unregistered', 'regular', '', '']);
});

test('companyGstOf: the typed GSTIN wins; Tally\'s company fields fill in; nothing about GST means not registered', () => {
  // typed GSTIN: regular, state from the GSTIN, not derived; a different GSTIN on the vouchers is a mismatch
  let cg = companyGstOf(store({ typed: GSTIN_KA, vouchers: [{ cmpgstin: GSTIN_TN, cmpgststate: 'Tamil Nadu' }] }), 'm1');
  assert.deepEqual([cg.status, cg.gstin, cg.state, cg.derived], ['regular', GSTIN_KA, 'KA', false]);
  assert.match(cg.mismatch, /not the company GSTIN on Tally's vouchers/);
  // no GSTIN typed: the most common values of the vouchers (a contra without the fields does not count)
  cg = companyGstOf(store({ vouchers: [{ cmpgstin: GSTIN_KA, cmpgststate: 'Karnataka', cmpgstregistrationtype: 'Regular' }, { cmpgstin: GSTIN_KA, cmpgststate: 'Karnataka', cmpgstregistrationtype: 'Regular' }, {}] }), 'm1');
  assert.deepEqual([cg.status, cg.gstin, cg.state, cg.derived, cg.mismatch], ['regular', GSTIN_KA, 'KA', true, null]);
  assert.equal(companyGstinForHsn(store({ vouchers: [{ cmpgstin: GSTIN_KA }] }), 'm1'), GSTIN_KA, 'the HSN/SAC default follows the GSTIN on the vouchers');
  // composition, from Tally's registration type
  cg = companyGstOf(store({ vouchers: [{ cmpgststate: 'Karnataka', cmpgstregistrationtype: 'Composition' }] }), 'm1');
  assert.deepEqual([cg.status, cg.state], ['composition', 'KA']);
  // nothing about GST: no GSTIN, no company field, the only tax ledger is a levy of type "Others"
  cg = companyGstOf(store({ vouchers: [{}, {}], taxLedgers: [{ name: 'Professional Tax', taxtype: 'Others' }] }), 'm1');
  assert.deepEqual([cg.status, cg.gstin, cg.state], ['unregistered', '', '']);
  assert.equal(companyGstOf(store(), 'm1').status, 'unregistered', 'no tax ledger at all');
  // a GST ledger, or a tax ledger whose type Tally does not give, keeps the company registered (as before)
  assert.equal(companyGstOf(store({ taxLedgers: [{ name: 'Output CGST', taxtype: 'GST', gstdutyhead: 'Central Tax' }] }), 'm1').status, 'regular');
  assert.equal(companyGstOf(store({ taxLedgers: [{ name: 'Duty' }] }), 'm1').status, 'regular');
  assert.equal(companyGstOf(store({ taxLedgers: [{ name: 'TDS 194C', taxtype: 'TDS' }] }), 'm1').status, 'unregistered', 'TDS alone is not GST');
});

// ---------- the voucher files ----------
const KINDS = { 'Sales Account': 'income', 'Purchase Account': 'expense' };
const MASTERS = { 'Out CGST': { taxtype: 'GST', gstdutyhead: 'CGST' } };
const CONTACTS = { customers: { 'Cust Teak': { treatment: 'business_gst', gstin: GSTIN_KA, place: 'KA' } },
  vendors: { 'Vend Oak': { treatment: 'business_gst', gstin: GSTIN_KA, place: 'KA' } } };
const ctx = (over = {}) => ({
  customers: new NameSet(Object.keys(CONTACTS.customers)), vendors: new NameSet(Object.keys(CONTACTS.vendors)), taxLedgers: new NameSet(Object.keys(MASTERS)),
  taxMap: {}, taxInfo: n => (MASTERS[n] ? taxLedgerInfo(MASTERS[n]) : null), kindOf: n => KINDS[n] ?? (CONTACTS.customers[n] ? 'customer' : CONTACTS.vendors[n] ? 'vendor' : null),
  tdsMap: {}, contactOf: (section, ledger) => CONTACTS[section][ledger] || null, gstRegisteredCodes: new Set(['business_gst']), ...over,
});
let nextId = 0;
const rec = (slot, number, lines, extra = {}) => ({ id: ++nextId, source_id: `n${nextId}`, name: `${slot} ${number}`, slot,
  data: { vouchernumber: number, date: '20250601', ...extra, allledgerentries: lines.map(([ledgername, amount]) => ({ ledgername, amount })) } });
const rowsOf = (built, file, r) => built[file].rows.filter(x => x.rec === r).map(x => x.row);
const flagsOf = (built, r) => built.exceptions.filter(e => e.rec === r && e.kind).map(e => e.kind);
const sale = () => rec('sales', `S-${nextId + 1}`, [['Cust Teak', '-1000.00'], ['Sales Account', '1000.00']], { placeofsupply: 'Karnataka' });
const purchase = () => rec('purchase', `P-${nextId + 1}`, [['Purchase Account', '-500.00'], ['Vend Oak', '500.00']], { placeofsupply: 'Karnataka' });

test('a company NOT registered for GST: no zero-rate tax on an invoice line, no tax and no blocking flag on a registered vendor\'s bill (GST-012, SYN-13)', () => {
  const s = sale(), p = purchase();
  const built = buildVoucherOutput([s, p], ctx({ companyGst: { status: 'unregistered', gstin: '', state: '' } }));
  assert.deepEqual(rowsOf(built, 'invoices', s).map(r => [r['Item Tax'], r['Item Tax Type'], r['Item Tax %']]), [['', '', '']]);
  assert.deepEqual(rowsOf(built, 'bills', p).map(r => [r['Tax Name'], r['Item Exemption Code'] || '', r['Reverse Charge Tax Name'] || '']), [['', '', '']]);
  for (const r of [s, p]) assert.deepEqual(flagsOf(built, r).filter(k => /tax/.test(k)), [], 'no tax flag at all');
});

test('a Regular company: the company state from its GSTIN or other vouchers when a voucher lacks it (GST-013); a blocking flag when no state is known', () => {
  // the voucher has no cmpgststate: the company's state (KA) gives GST0 (place of supply KA)
  const s1 = sale(), p1 = purchase();
  const b1 = buildVoucherOutput([s1, p1], ctx({ companyGst: { status: 'regular', gstin: GSTIN_KA, state: 'KA' } }));
  assert.deepEqual(rowsOf(b1, 'invoices', s1).map(r => r['Item Tax']), ['GST0']);
  assert.deepEqual(rowsOf(b1, 'bills', p1).map(r => [r['Tax Name'], r['Destination of Supply']]), [['GST0', 'KA']]);
  // a regular company whose state is known nowhere: the line has no tax and the invoice carries the blocking flag
  const s2 = sale();
  const b2 = buildVoucherOutput([s2], ctx({ companyGst: { status: 'regular', gstin: '', state: '' } }));
  assert.deepEqual(rowsOf(b2, 'invoices', s2).map(r => r['Item Tax']), ['']);
  assert.ok(flagsOf(b2, s2).includes('invoice_line_tax_state_unknown'), flagsOf(b2, s2).join(', '));
  // without a company identity (the voucher alone, as before): Tally's state on the voucher decides
  const s3 = rec('sales', 'S-old', [['Cust Teak', '-1000.00'], ['Sales Account', '1000.00']], { placeofsupply: 'Karnataka', cmpgststate: 'Karnataka' });
  assert.deepEqual(rowsOf(buildVoucherOutput([s3], ctx()), 'invoices', s3).map(r => r['Item Tax']), ['GST0']);
});

test('a Composition company: no output tax on an invoice line; bills of registered vendors still get the zero-rate tax', () => {
  const s = sale(), p = purchase();
  const built = buildVoucherOutput([s, p], ctx({ companyGst: { status: 'composition', gstin: GSTIN_KA, state: 'KA' } }));
  assert.deepEqual(rowsOf(built, 'invoices', s).map(r => r['Item Tax']), ['']);
  assert.deepEqual(rowsOf(built, 'bills', p).map(r => r['Tax Name']), ['GST0']);
});

// ---------- the Zoho check: GST line rules only for a GST-registered organisation ----------
test('Zoho check: INV-TAX-OR-EXEMPTION and BIL-TAX-REQUIRED-REGISTERED do not apply to an organisation not registered for GST', () => {
  const ruleOf = id => Object.values(RULES.modules).flatMap(m => m.rules || []).find(r => r.id === id);
  assert.deepEqual(ruleOf('INV-TAX-OR-EXEMPTION').org_gst, ['regular']);
  assert.deepEqual(ruleOf('BIL-TAX-REQUIRED-REGISTERED').org_gst, ['regular', 'composition']);
  const inv = { headers: ['Invoice Number', 'Invoice Date', 'Customer Name', 'Item Name', 'Item Price', 'Quantity', 'Item Tax', 'GST Treatment', 'Place of Supply'],
    rows: [['S-1', '2025-06-01', 'Cust Teak', 'Sales Account', '1000.00', '1', '', 'business_none', 'KL']] };
  const fired = res => res.files.flatMap(f => f.causes.map(c => c.ruleId || c.rule?.id || c.id)).filter(Boolean);
  assert.ok(fired(checkFiles({ invoices: inv }, {})).some(id => /INV-TAX-OR-EXEMPTION/.test(id)), 'unknown status: the rule applies as before');
  assert.ok(fired(checkFiles({ invoices: inv }, { orgGstStatus: 'regular' })).some(id => /INV-TAX-OR-EXEMPTION/.test(id)));
  const off = checkFiles({ invoices: inv }, { orgGstStatus: 'unregistered' });
  assert.ok(!fired(off).some(id => /INV-TAX-OR-EXEMPTION/.test(id)));
  assert.ok(off.files[0].notChecked.some(n => n.ruleId === 'INV-TAX-OR-EXEMPTION' && /not registered for GST/.test(n.reason)), JSON.stringify(off.files[0].notChecked));
});

// ---------- the whole app: no Duties & Taxes ledger (SYN-12), stock without a Stock Summary (SYN-1) ----------
let app = null, cookie = '';
after(async () => { if (app) await app.close(); });
async function call(o) {
  if (!app) {
    app = buildApp(); await app.ready();
    const u = seed.users.find(x => x.role === 'analyst') || seed.users[0];
    const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: u.password } });
    cookie = String(r.headers['set-cookie']).split(';')[0];
  }
  return app.inject({ ...o, headers: { ...(o.headers || {}), cookie } });
}
async function uploaded(company) {
  const p = company.profile;
  const id = (await call({ method: 'POST', url: '/api/migrations', payload: { company: p.name, financialYear: p.fy, gstin: p.gstin } })).json().id;
  const base = `/api/migrations/${id}`;
  for (const [slot, obj, file] of [['all_masters', company.masters(), 'Master.json'], ['all_transactions', company.transactions(), 'Transactions.json'], ['trial_balance', company.trialBalance(), 'TrialBal.json']]) {
    const r = await call({ method: 'PUT', url: `${base}/uploads/${slot}`, headers: { 'content-type': 'application/octet-stream', 'x-filename': file }, payload: utf16le(obj) });
    assert.equal(r.statusCode, 200, r.body);
  }
  return base;
}
const slotOf = (c, key) => c.slots.find(s => s.key === key);

test('SYN-12: an All Masters file with no Duties & Taxes ledger marks Tax Configuration not applicable; it can be marked again after undoing; processing runs', async () => {
  const base = await uploaded(noGst.variants.no_duty_ledgers);
  let c = (await call({ url: `${base}/completeness` })).json();
  assert.equal(slotOf(c, 'taxes').status, 'not_applicable');
  assert.equal(slotOf(c, 'taxes').autoNotApplicable, true);
  assert.match(slotOf(c, 'taxes').waiver.reason, /no ledger under Duties & Taxes/);
  assert.ok(!c.missingRequired.includes('Tax Configuration'));
  // undone by the user, it can be marked again (the file is the evidence)
  const undone = (await call({ method: 'DELETE', url: `${base}/waivers/taxes` })).json();
  assert.equal(undone.canMarkAgain, true);
  c = (await call({ url: `${base}/completeness` })).json();
  assert.ok(c.missingRequired.includes('Tax Configuration'));
  assert.equal((await call({ method: 'PUT', url: `${base}/waivers/taxes`, payload: {} })).statusCode, 200);
  for (const s of (await call({ url: `${base}/completeness` })).json().awaitingConfirmation) {
    const key = { 'Stock Summary': 'stock_summary', 'Stock Items': 'stock_items', 'Units of Measurement': 'units' }[s] || s;
    await call({ method: 'PUT', url: `${base}/waivers/${key}`, payload: { reason: 'Made-up test company: not exported' } });
  }
  const r = await call({ method: 'POST', url: `${base}/process?wait=1` });
  assert.equal(r.statusCode, 200, r.body);
});

test('SYN-12: a company WITH Duties & Taxes ledgers keeps Tax Configuration required (it cannot be marked)', async () => {
  const base = await uploaded(services);
  const c = (await call({ url: `${base}/completeness` })).json();
  assert.equal(slotOf(c, 'taxes').status, 'uploaded');
  assert.equal((await call({ method: 'PUT', url: `${base}/waivers/taxes`, payload: { reason: 'x' } })).statusCode, 400);
});

test('SYN-1: marking the Stock Summary not applicable keeps a company that moves stock a goods company (business type read from the vouchers)', async () => {
  const base = await uploaded(trading);
  await call({ method: 'PUT', url: `${base}/waivers/stock_summary`, payload: { reason: 'Made-up test company: not exported' } });
  assert.equal((await call({ method: 'POST', url: `${base}/process?wait=1` })).statusCode, 200);
  // the business type as Mapping Studio (Rates) shows it
  const bt = (await call({ url: `${base}/item-rates` })).json().business;
  assert.deepEqual([bt.value, bt.source, bt.derived], ['goods', 'default', true]);
  assert.match(bt.defaultReason, /inventory lines/);
  assert.equal((await call({ method: 'POST', url: `${base}/process?wait=1` })).statusCode, 200);
  await call({ method: 'POST', url: `${base}/generate` });
  const files = (await call({ url: `${base}/files` })).json();
  const itemsFile = files.find(f => f.key === 'items');
  const text = (await call({ url: `${base}/files/items/download?confirmed=1` })).body;
  assert.ok(itemsFile && text, 'an Items file');
  assert.doesNotMatch(text.split(/\r?\n/)[1] || '', /,service,/i, 'stock items are not written as services');
  assert.match(text, /Sales and Purchases/, 'stock items can be bought');
  const a = (await call({ url: `${base}/assumptions` })).json();
  assert.ok(a.assumptions.some(x => x.kind === 'business_type_derived'), a.assumptions.map(x => x.kind).join(', '));
});

test('SYN-13 end to end: the no-GST company is said to be not registered, and no invoice is expected to be refused for want of a tax', async () => {
  const base = await uploaded(noGst);
  for (const s of (await call({ url: `${base}/completeness` })).json().awaitingConfirmation) {
    const key = { 'Stock Summary': 'stock_summary', 'Stock Items': 'stock_items', 'Units of Measurement': 'units' }[s] || s;
    await call({ method: 'PUT', url: `${base}/waivers/${key}`, payload: { reason: 'Made-up test company: not exported' } });
  }
  assert.equal((await call({ method: 'POST', url: `${base}/process?wait=1` })).statusCode, 200);
  await call({ method: 'POST', url: `${base}/generate` });
  const text = (await call({ url: `${base}/files/invoices/download?confirmed=1` })).body;
  assert.doesNotMatch(text, /GST0|IGST0/, 'no zero-rate tax for a company outside GST');
  const a = (await call({ url: `${base}/assumptions` })).json();
  assert.ok(a.assumptions.some(x => x.kind === 'company_not_gst_registered' && x.unconfirmed), a.assumptions.map(x => x.kind).join(', '));
  const findings = (await call({ url: `${base}/zoho-check/findings.csv` })).body;
  assert.doesNotMatch(findings, /INV-TAX-OR-EXEMPTION/);
});
