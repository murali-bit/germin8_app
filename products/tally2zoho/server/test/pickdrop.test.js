// Pick and drop: names are passed exactly as in Tally (hidden characters are warnings, cleaning is opt-in), and the
// business type (services, or goods) decides the Product Type of the items. Every name and value here is MADE UP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-pickdrop-'));
const { buildApp } = await import('../src/index.js');
const { TEMPLATES, toCsv, parseCsv, itemProductType } = await import('../src/zoho.js');
const { BLOCKS_IMPORT, NAME_WARNING_KINDS } = await import('../src/testreport.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const samples = path.resolve(here, '../../sample-data');
const seed = JSON.parse(fs.readFileSync(path.resolve(here, '../seed-users.json'), 'utf8'));
const app = buildApp();
let cookie = '';
const call = opts => app.inject({ ...opts, headers: { ...(opts.headers || {}), ...(cookie ? { cookie } : {}) } });
const login = async role => {
  const u = seed.users.find(x => x.role === role);
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: u.password } });
  assert.equal(r.statusCode, 200, `login as ${role}`);
  cookie = String(r.headers['set-cookie']).split(';')[0];
};
const get = async url => { const r = await call({ url }); assert.equal(r.statusCode, 200, `${url}: ${r.body}`); return r.json(); };
const ok = async (method, url, payload) => { const r = await call({ method, url, payload }); assert.equal(r.statusCode, 200, `${method} ${url}: ${r.body}`); return r.json(); };
const FILES = {
  customers: '01_customers.json', vendors: '02_vendors.json', accounts: '03_chart_of_accounts.json', stock_items: '04_stock_items.json',
  units: '05_units.json', taxes: '06_tax_configuration.json', sales: '07_sales_vouchers.json', purchase: '08_purchase_vouchers.json',
  receipt: '09_receipt_vouchers.json', payment: '10_payment_vouchers.json', journal: '11_journal_vouchers.json', trial_balance: '13_trial_balance.json',
};
const csv = async (base, key) => { const r = await call({ url: `${base}/files/${key}/download?confirmed=1` }); assert.equal(r.statusCode, 200, `${key}: ${r.body}`); return parseCsv(r.body).rows; };

test('a name with a line break stays one valid CSV cell, and reads back exactly', () => {
  const text = toCsv(['Display Name', 'Status'], [{ 'Display Name': 'Oak Line Traders\r\n', Status: 'Active' }, { 'Display Name': 'Say "Hi", Co', Status: 'Active' }]);
  assert.match(text, /^Display Name,Status\r\n"Oak Line Traders\r\n",Active\r\n"Say ""Hi"", Co",Active\r\n$/, 'the cell is quoted, so the line break is inside it');
  const back = parseCsv(text);
  assert.deepEqual(back.rows.map(r => r['Display Name']), ['Oak Line Traders\r\n', 'Say "Hi", Co']);
  assert.equal(back.rows.length, 2, 'the line break does not start a new row');
});

test('names: hidden characters and names the same only once cleaned are warnings; names written the same block', () => {
  for (const k of ['display_name_hidden_characters', 'account_name_hidden_characters', 'display_name_collides_after_cleaning', 'account_name_collides_after_cleaning']) {
    assert.ok(!BLOCKS_IMPORT.has(k), `${k} does not block`);
    assert.ok(NAME_WARNING_KINDS.has(k), `${k} is a warning`);
  }
  assert.ok(BLOCKS_IMPORT.has('display_name_duplicate') && BLOCKS_IMPORT.has('account_name_duplicate'));
  const ctx = { accountTypes: {}, groupParents: {}, asOf: '20250331' };
  const vendor = name => TEMPLATES.vendors.row({ metadata: { type: 'Ledger', name }, parent: 'Sundry Creditors' }, ctx);
  assert.equal(vendor('Teak Supplies\r\n')['Display Name'], 'Teak Supplies\r\n', 'written exactly as in Tally');
  const warn = TEMPLATES.vendors.fileFlags([vendor('Teak Supplies\r\n'), vendor('Teak Supplies')]);
  assert.deepEqual(warn.map(f => f.kind), ['display_name_collides_after_cleaning']);
  assert.match(warn[0].message, /a warning, not a blocker/);
  const same = TEMPLATES.vendors.fileFlags([vendor('Teak Supplies'), vendor('TEAK SUPPLIES'), vendor('Teak Supplies\n')]);
  assert.deepEqual(same.map(f => [f.kind, f.uses]), [['display_name_duplicate', 3]], 'two written the same (capital letters ignored): the whole group blocks');
  const acc = name => TEMPLATES.accounts.row({ name, parent: 'Indirect Expenses' }, ctx);
  assert.deepEqual(TEMPLATES.accounts.fileFlags([acc('Rent\r\n'), acc('Rent')]).map(f => f.kind), ['account_name_collides_after_cleaning']);
  assert.deepEqual(TEMPLATES.accounts.fileFlags([acc('Rent'), acc('Rent')]).map(f => f.kind), ['account_name_duplicate']);
  const check = TEMPLATES.accounts.check({ name: 'Rent\r\n', parent: 'Indirect Expenses' }, ctx).find(x => x.kind === 'account_name_hidden_characters');
  assert.match(check.message, /written exactly as in Tally[^]*GST portal later[^]*clean it in Mapping Studio \(Names\)/);
});

test('items: the business type sets the Product Type; one item can be set apart; Tally is not changed', () => {
  const item = (name, extra = {}) => ({ metadata: { type: 'Stock Item', name }, baseunits: 'nos', ...extra });
  const recs = [item('Design work', { gsttypeofsupply: 'Goods' }), item('Annual support'), item('Site visit', { gsttypeofsupply: 'Services' }), item('Printed manual', { gsttypeofsupply: 'Goods' })];
  const services = { asOf: '20250331', businessType: 'services', itemSettings: { 'Printed manual': { productType: 'goods' } } };
  const rows = recs.map(d => TEMPLATES.items.row(d, services));
  assert.deepEqual(rows.map(r => r['Product Type']), ['service', 'service', 'service', 'goods'], 'services business, with one item chosen as goods');
  assert.ok(rows.every(r => r['HSN/SAC'] === ''), 'no HSN/SAC is invented');
  const flag = TEMPLATES.items.fileFlags(rows, services, recs).find(f => f.kind === 'items_written_as_services');
  assert.equal(flag.uses, 3);
  assert.match(flag.message, /3 of 4 item\(s\) are written with Product Type "service" \(Tally's type of supply says Goods for 1 and is empty for 1\)/);
  assert.ok(!BLOCKS_IMPORT.has('items_written_as_services'));
  const goods = { asOf: '20250331', businessType: 'goods' };
  assert.deepEqual(recs.map(d => TEMPLATES.items.row(d, goods)['Product Type']), ['goods', 'goods', 'service', 'goods'], 'goods business: from Tally as before');
  assert.ok(!TEMPLATES.items.fileFlags(rows, goods, recs).some(f => f.kind === 'items_written_as_services'));
  assert.deepEqual(itemProductType({ typeOfSupply: 'Capital Goods' }, {}, goods), { value: '', source: 'tally' }, 'not guessed');
  assert.deepEqual(itemProductType({ typeOfSupply: 'Capital Goods' }, {}, { businessType: 'services' }), { value: 'service', source: 'business' });
});

test('business type: default from the Stock Summary mark, a choice per migration and per item, audited, and the Items file out of date', async () => {
  await login('analyst');
  const r0 = await call({ method: 'POST', url: '/api/migrations', payload: { company: 'Apex Engineering Technologies Pvt. Ltd.', financialYear: '2024-25' } });
  assert.equal(r0.statusCode, 201);
  const id = r0.json().id, base = `/api/migrations/${id}`;
  for (const [slot, f] of Object.entries(FILES)) {
    const u = await call({ method: 'PUT', url: `${base}/uploads/${slot}`, headers: { 'content-type': 'application/octet-stream', 'x-filename': f }, payload: fs.readFileSync(path.join(samples, f)) });
    assert.equal(u.statusCode, 200, slot);
  }
  await ok('PUT', `${base}/waivers/stock_summary`, { reason: 'Service company: no stock' });
  assert.equal((await call({ method: 'POST', url: `${base}/process?wait=1` })).statusCode, 200);

  // changed on purpose (fix set S2, SYN-1): marking the Stock Summary not applicable no longer makes the company a
  // services company when its vouchers move stock (inventory lines): the default is goods, read from the vouchers, and
  // said as an assumption. Before, every stock item became a sales-only service and every bill naming one was refused.
  let v = await get(`${base}/item-rates`);
  assert.deepEqual([v.business.value, v.business.source, v.business.derived], ['goods', 'default', true]);
  assert.match(v.business.defaultReason, /Stock Summary is marked not applicable.*inventory lines/);
  assert.ok((await get(`${base}/prepare`)).steps.find(s => s.key === 'decisions').items.find(i => i.key === 'item_rates').words.includes('Business type: goods (trading or manufacturing) (the default)'));

  // services, chosen: every item is written as a service, and that is flagged
  assert.equal((await call({ method: 'PUT', url: `${base}/business-type`, payload: { businessType: 'shop' } })).statusCode, 400);
  v = await ok('PUT', `${base}/business-type`, { businessType: 'services' });
  assert.deepEqual([v.business.value, v.business.source, v.changed], ['services', 'decided', true]);
  assert.ok(v.items.length > 0 && v.items.every(i => i.productTypeUsed === 'service' && i.productTypeSource === 'business'));
  assert.equal(v.counts.services, v.items.length);
  assert.ok((await get(`${base}/prepare`)).steps.find(s => s.key === 'decisions').items.find(i => i.key === 'item_rates').words.includes('Business type: services,'));
  assert.equal((await call({ method: 'POST', url: `${base}/generate` })).statusCode, 200);
  let items = await csv(base, 'items');
  assert.ok(items.every(r => r['Product Type'] === 'service'));
  assert.ok((await get(`${base}/summary`)).exceptions.some(e => e.kind === 'items_written_as_services'));

  // goods (trading or manufacturing), chosen: audited, the Items file is out of date (and only it)
  v = await ok('PUT', `${base}/business-type`, { businessType: 'goods' });
  assert.deepEqual([v.business.value, v.business.source, v.changed], ['goods', 'decided', true]);
  assert.deepEqual((await get(base)).outOfDateFiles, ['items']);
  const audit = (await get(`${base}/audit`)).map(a => `${a.action} | ${a.detail}`);
  assert.ok(audit.some(t => /^business_type_changed \| Business type: services .*chosen -> goods.*chosen/.test(t)), audit.join('\n'));
  assert.equal((await ok('PUT', `${base}/business-type`, { businessType: 'goods' })).changed, false, 'no change, nothing audited');

  // one item set apart
  const first = v.items[0].item;
  assert.equal((await call({ method: 'PUT', url: `${base}/item-rates`, payload: { item: first, productType: 'gadget' } })).statusCode, 400);
  v = await ok('PUT', `${base}/item-rates`, { item: first, productType: 'service' });
  assert.deepEqual([v.items[0].productType, v.items[0].productTypeUsed, v.items[0].productTypeSource], ['service', 'service', 'item']);
  assert.equal((await call({ method: 'POST', url: `${base}/generate` })).statusCode, 200);
  items = await csv(base, 'items');
  assert.equal(items.find(r => r['Item Name'] === first)['Product Type'], 'service');
  // (v2: the service items added for invoice lines that are not stock items are not Tally items)
  const stockNames = new Set(v.items.map(i => i.item));
  assert.ok(items.filter(r => r['Item Name'] !== first && stockNames.has(r['Item Name'])).every(r => r['Product Type'] === 'goods'), 'the others from Tally (goods when not set)');

  // back to the default (goods, read from the vouchers); undoing the Stock Summary mark keeps goods (the vouchers have
  // inventory lines either way), so the Items file stays up to date
  v = await ok('PUT', `${base}/business-type`, { businessType: '' });
  assert.deepEqual([v.business.value, v.business.source], ['goods', 'default']);
  assert.equal((await call({ method: 'POST', url: `${base}/generate` })).statusCode, 200);
  assert.deepEqual((await get(base)).outOfDateFiles, []);
  await ok('DELETE', `${base}/waivers/stock_summary`);
  v = await get(`${base}/item-rates`);
  assert.deepEqual([v.business.value, v.business.source, v.business.derived], ['goods', 'default', false]);
  assert.match(v.business.defaultReason, /inventory lines/);
  assert.deepEqual((await get(base)).outOfDateFiles, [], 'the default did not change, so the Items file is not out of date');

  // a viewer reads only
  await login('viewer');
  assert.equal((await call({ method: 'PUT', url: `${base}/business-type`, payload: { businessType: 'services' } })).statusCode, 403);
  await login('analyst');
});
