// UI audit fixes (Mapping Studio, Voucher Classification): "Clear decision" back to the default, one out-of-date reason
// per journal / contact and none when the net change is zero, the counts on the default vs decided by a person, the
// possible duplicates on the default counted as decided, and GST treatment labels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-uifixb-'));
const { buildApp } = await import('../src/index.js');
const { reviewCounts } = await import('../src/journalreview.js');
const { gstTreatmentLabel } = await import('../src/zohocodes.js');
const here = path.dirname(fileURLToPath(import.meta.url));
const samples = path.resolve(here, '../../sample-data');
const app = buildApp();
const seed = JSON.parse(fs.readFileSync(path.resolve(here, '../seed-users.json'), 'utf8'));
let cookie = '';
const call = opts => app.inject({ ...opts, headers: { ...(opts.headers || {}), ...(cookie ? { cookie } : {}) } });
const login = async role => {
  const u = seed.users.find(x => x.role === role);
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: u.password } });
  assert.equal(r.statusCode, 200, `login as ${role}`);
  cookie = String(r.headers['set-cookie']).split(';')[0];
};
const get = async url => (await call({ url })).json();
const send = (method, url, payload) => call({ method, url, payload });
const putFile = (id, slot, file) => call({ method: 'PUT', url: `/api/migrations/${id}/uploads/${slot}`, headers: { 'content-type': 'application/octet-stream', 'x-filename': path.basename(file) }, payload: fs.readFileSync(file) });
const FILES = {
  customers: '01_customers.json', vendors: '02_vendors.json', accounts: '03_chart_of_accounts.json', stock_items: '04_stock_items.json',
  units: '05_units.json', taxes: '06_tax_configuration.json', sales: '07_sales_vouchers.json', purchase: '08_purchase_vouchers.json',
  receipt: '09_receipt_vouchers.json', payment: '10_payment_vouchers.json', journal: '11_journal_vouchers.json', trial_balance: '13_trial_balance.json',
};

test('labels and counts: GST treatment in words, journals on the default vs decided by a person', () => {
  assert.equal(gstTreatmentLabel('business_gst'), 'Registered (regular)');
  assert.equal(gstTreatmentLabel('business_none'), 'Unregistered');
  assert.equal(gstTreatmentLabel('overseas'), 'Overseas');
  assert.equal(gstTreatmentLabel(''), '');
  const c = reviewCounts([
    { id: 1, decision: 'Bill', defaultDecision: null, pattern: { key: 'a' }, suggested: 'Bill', party: 'vendor' },
    { id: 2, decision: null, defaultDecision: 'Manual Journal', pattern: { key: 'a' }, suggested: 'Bill', party: 'vendor', needsCheck: true },
    { id: 3, decision: null, defaultDecision: 'Invoice', pattern: { key: 'b' }, suggested: 'Invoice', party: 'customer' },
    { id: 4, decision: null, notPosted: 'cancelled', pattern: { key: 'b' }, suggested: 'Invoice', party: 'customer' },
  ]);
  assert.deepEqual([c.byPerson, c.onDefault, c.onDefaultAs], [1, 2, { Invoice: 1, Bill: 0, 'Manual Journal': 1 }]);
});

test('clear decision, net-zero out-of-date reasons, contact labels and duplicates on the default', async () => {
  await login('analyst');
  const r = await send('POST', '/api/migrations', { company: 'Apex Engineering Technologies Pvt. Ltd.', financialYear: '2024-25' });
  assert.equal(r.statusCode, 201);
  const id = r.json().id;
  const base = `/api/migrations/${id}`;
  for (const [slot, f] of Object.entries(FILES)) assert.equal((await putFile(id, slot, path.join(samples, f))).statusCode, 200, slot);
  await send('PUT', `${base}/waivers/stock_summary`, { reason: 'Not needed for test' });
  assert.equal((await send('POST', `${base}/process`)).statusCode, 200);
  const g = await send('POST', `${base}/generate`);
  assert.equal(g.statusCode, 200, g.body);
  const migration = () => get(base);
  const trail = async () => (await get(`${base}/audit`)).map(a => `${a.action} | ${a.detail}`);

  // ----- journals: a decision that differs from the default, then cleared: back to the default, files up to date -----
  const journals = (await get(`${base}/journals`)).filter(j => !j.notPosted);
  assert.ok(journals.length > 0, 'the sample has journal vouchers');
  const j = journals[0];
  assert.equal(j.decision, null);
  const other = (j.defaultDecision || 'Manual Journal') === 'Manual Journal' ? ['Bill', 'Invoice'].find(d => !j.refused[d]) || null : 'Manual Journal';
  assert.ok(other, 'a destination other than the default is possible');
  let rev = await get(`${base}/journals/review?state=all`);
  assert.equal(rev.counts.byPerson, 0);
  assert.equal(rev.counts.onDefault, rev.counts.toDecide);
  assert.equal((await send('PUT', `${base}/journals/${j.id}`, { decision: other })).statusCode, 200);
  let m = await migration();
  assert.equal(m.filesOutOfDate, true);
  assert.equal(m.outOfDateReasons.length, 1);
  // the same decision again: still one reason (not two)
  assert.equal((await send('PUT', `${base}/journals/${j.id}`, { decision: other })).statusCode, 200);
  assert.equal((await migration()).outOfDateReasons.length, 1);
  rev = await get(`${base}/journals/review?state=all`);
  assert.deepEqual([rev.counts.byPerson, rev.counts.onDefault], [1, rev.counts.toDecide - 1]);

  // a viewer cannot clear
  await login('viewer');
  const viewerTry = await send('DELETE', `${base}/journals/${j.id}`);
  assert.ok([403, 404].includes(viewerTry.statusCode), `viewer refused (${viewerTry.statusCode})`);
  await login('analyst');

  const cleared = await send('DELETE', `${base}/journals/${j.id}`);
  assert.equal(cleared.statusCode, 200, cleared.body);
  assert.equal(cleared.json().defaultDecision, j.defaultDecision || 'Manual Journal');
  const after = (await get(`${base}/journals`)).find(x => x.id === j.id);
  assert.equal(after.decision, null);
  m = await migration();
  assert.deepEqual([m.filesOutOfDate, m.outOfDateReasons], [false, []], 'changed and changed back: the net change is zero');
  assert.ok((await trail()).some(x => x.startsWith(`journal_decision_cleared | ${j.number}: decision ${other} cleared`)));
  // nothing to clear
  assert.equal((await send('DELETE', `${base}/journals/${j.id}`)).statusCode, 409);
  assert.equal((await send('DELETE', `${base}/journals/999999`)).statusCode, 404);

  // ----- contacts: GST treatment in words; a correction undone leaves the files up to date -----
  const cv = await get(`${base}/contact-fixes`);
  assert.ok(cv.treatments.every(t => t.label && !/business_/.test(t.words)), 'the treatments are offered in words');
  for (const row of cv.rows) assert.equal(row.written.gstTreatmentLabel, gstTreatmentLabel(row.written.gstTreatment));
  const rec = await get(`${base}/records?slot=customers&type=Ledger&limit=1`);
  const ledger = rec.records?.[0]?.name;
  assert.ok(ledger, 'a customer ledger');
  const before = cv.rows.find(x => x.ledger === ledger)?.fix || null;
  assert.equal(before, null);
  let p = await send('PATCH', `${base}/contact-fixes`, { fixes: [{ ledger, state: 'KA', reason: 'test' }] });
  if (p.statusCode !== 200) p = await send('PATCH', `${base}/contact-fixes`, { fixes: [{ ledger, treatment: 'unregistered', gstin: '', reason: 'test' }] });
  assert.equal(p.statusCode, 200, p.body);
  m = await migration();
  assert.equal(m.filesOutOfDate, true);
  const reasons = m.outOfDateReasons.length;
  assert.equal(reasons, 1);
  // undo: every field back to empty (no correction): nothing is out of date any more
  assert.equal((await send('PATCH', `${base}/contact-fixes`, { fixes: [{ ledger, gstin: '', pan: '', state: '', treatment: '', reason: 'Undo in Fix contacts' }] })).statusCode, 200);
  m = await migration();
  assert.deepEqual([m.filesOutOfDate, m.outOfDateReasons], [false, []], 'a correction undone: the net change is zero');

  // ----- possible duplicates: a group on the default (or accepted as per Tally) is not open -----
  const names = await get(`${base}/names`);
  for (const grp of names.duplicates) {
    assert.ok(['decided', 'needs_decision', 'accepted', 'default'].includes(grp.status));
    if (grp.status === 'default') assert.match(grp.defaultWords, /^Default: /);
  }
  assert.equal(names.counts.duplicatesUndecided, names.duplicates.filter(x => !x.decision && x.sameWrittenName).length);
  assert.equal(names.counts.duplicatesOnDefault + names.counts.duplicatesUndecided + names.counts.duplicatesDecided, names.counts.duplicates);
  assert.equal(names.counts.asInTally + names.counts.cleaned + names.counts.cleanedByDefault, names.counts.names);
  assert.equal((await send('PUT', `${base}/reviews/duplicates`, { accepted: true })).statusCode, 200);
  const acc = await get(`${base}/names`);
  assert.equal(acc.counts.duplicatesUndecided, names.counts.duplicatesUndecided, 'accepting does not hide names Zoho would refuse');
  assert.equal(acc.counts.duplicatesAccepted, acc.duplicates.filter(x => x.status === 'accepted').length);
});
