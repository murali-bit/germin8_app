// UI audit fixes (main part): vouchers in no file yet (held for a missing Zoho sample) are an open item with one set of
// numbers (GET held-vouchers, GET prepare), a list to enter by hand, and an upload slot for Zoho's sample.
// Every value here is MADE UP (fixtures/allTransactions.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-uifix-'));
process.env.ZOHO_SAMPLES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-uifix-samples-'));
const { buildApp } = await import('../src/index.js');
const { readSample } = await import('../src/heldvouchers.js');
const { mastersDoc, VOUCHERS, transactionsDoc, trialBalanceReport, utf16le } = await import('../fixtures/allTransactions.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(fs.readFileSync(path.resolve(here, '../seed-users.json'), 'utf8'));

test('a Zoho sample must be a CSV or XLSX whose first row is a heading row', () => {
  assert.deepEqual(readSample(Buffer.from('Date,Payment Number,Customer Name,Amount\r\n2024-04-01,P-1,A,10\r\n'), 'sample.csv').headings, ['Date', 'Payment Number', 'Customer Name', 'Amount']);
  assert.match(readSample(Buffer.from('2024-04-01,P-1,A,10\r\n'), 'sample.csv').error, /heading row/);
  assert.match(readSample(Buffer.from('Only\r\n'), 'sample.csv').error, /heading row/);
  assert.match(readSample(Buffer.from('a,b'), 'sample.pdf').error, /CSV or XLSX/);
});

const app = buildApp();
let cookie = '';
const call = opts => app.inject({ ...opts, headers: { ...(opts.headers || {}), ...(cookie ? { cookie } : {}) } });
const get = async url => { const r = await call({ url }); assert.equal(r.statusCode, 200, `${url}: ${r.body}`); return r.json(); };
const put = (id, slot, obj, name) => call({ method: 'PUT', url: `/api/migrations/${id}/uploads/${slot}`, headers: { 'content-type': 'application/octet-stream', 'x-filename': name }, payload: utf16le(obj) });
const send = (method, url, payload) => call({ method, url, ...(payload !== undefined ? { payload } : {}) });
const login = async role => {
  const u = seed.users.find(x => x.role === role);
  cookie = String((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: u.password } })).headers['set-cookie']).split(';')[0];
};

test('held vouchers: one count everywhere, an open item on Prepare, a list to enter by hand, and the sample upload', async () => {
  await login('analyst');
  const id = (await send('POST', '/api/migrations', { company: 'Sample Masters Co', financialYear: '2024-25' })).json().id;
  const base = `/api/migrations/${id}`;
  assert.equal((await put(id, 'all_masters', mastersDoc(), 'Master.json')).statusCode, 200);
  assert.equal((await put(id, 'all_transactions', transactionsDoc(VOUCHERS), 'Transactions.json')).statusCode, 200);
  await send('PUT', `${base}/waivers/stock_summary`, { reason: 'Not needed for test' });
  assert.equal((await put(id, 'trial_balance', trialBalanceReport(), 'TrialBal.json')).statusCode, 200);
  assert.equal((await send('POST', `${base}/process?wait=1`)).statusCode, 200);

  // before the files: nothing to say
  assert.equal((await get(`${base}/held-vouchers`)).available, false);
  assert.equal((await get(`${base}/prepare`)).held, null);

  // this test is about the route "module_files" (vouchers held for Zoho's Payments files); the default route writes
  // them as Manual Journals and holds nothing (heldjournals.test.js)
  assert.equal((await send('PUT', `${base}/voucher-settings`, { paymentsRoute: 'module_files' })).statusCode, 200);
  const r = await send('POST', `${base}/generate`);
  assert.equal(r.statusCode, 200, r.body);
  const vc = r.json().vouchers;
  const held = await get(`${base}/held-vouchers`);
  const heldTotal = Object.values(vc.waitingForZohoSample).reduce((t, n) => t + n, 0);
  const writtenTotal = Object.values(vc.written).reduce((t, n) => t + n, 0);
  assert.ok(heldTotal > 0, 'the made-up data holds some vouchers');
  // the same numbers as the voucher control total of the Export Center
  assert.deepEqual([held.available, held.held, held.notInAnyFile, held.written], [true, heldTotal, heldTotal + vc.awaitingRouting, writtenTotal]);
  assert.equal(held.words, `${writtenTotal} written to files, ${heldTotal + vc.awaitingRouting} not in any file yet`);
  assert.deepEqual(held.modules.map(m => [m.key, m.vouchers]), Object.entries(vc.waitingForZohoSample));
  assert.ok(held.modules.every(m => m.sample && m.importAfterModule && m.sampleReceived === null));

  // the voucher reconciliation says the same
  const rec = await get(`${base}/voucher-reconciliation`);
  assert.equal(rec.notInAnyFile.heldForZohoSample, heldTotal);

  // Prepare migration: an open item (never done), with the same numbers; the checklist is not finished
  const prep = await get(`${base}/prepare`);
  const item = prep.steps.find(s => s.key === 'held');
  assert.deepEqual([item.done, item.open, prep.held.notInAnyFile, prep.held.written], [false, heldTotal, heldTotal, writtenTotal]);
  assert.ok(prep.steps.findIndex(s => s.key === 'held') < prep.steps.findIndex(s => s.key === 'download'));
  assert.notEqual(prep.current, null);
  // the Zoho check counts are on Prepare too (the same as GET zoho-check)
  const zc = await get(`${base}/zoho-check`);
  assert.deepEqual([prep.zohoCheck.rowsWill, prep.zohoCheck.rowsMay], [zc.overall.rowsWill, zc.overall.rowsMay]);

  // the list to enter by hand: date, number, party, amount; audited as a download
  const first = held.modules[0];
  const csv = await call({ url: `${base}/held-vouchers/${first.key}.csv` });
  assert.equal(csv.statusCode, 200);
  const lines = csv.body.replace(/^﻿/, '').trim().split(/\r\n/);
  assert.equal(lines[0], 'Date,Voucher number,Party,Amount,Bank or cash account');
  assert.equal(lines.length - 1, first.vouchers);
  assert.equal((await call({ url: `${base}/held-vouchers/bank_transfers.csv` })).statusCode, 404);

  // Zoho's sample: refused without a heading row, stored under zoho-samples/received/ and audited when it has one
  const upload = (body, name) => call({ method: 'PUT', url: `${base}/zoho-samples/${first.key}`, headers: { 'content-type': 'application/octet-stream', 'x-filename': name }, payload: Buffer.from(body) });
  assert.equal((await upload('1,2,3\r\n', 'sample.csv')).statusCode, 422);
  const ok = await upload('Date,Payment Number,Customer Name,Amount\r\n', 'zoho_sample.csv');
  assert.equal(ok.statusCode, 200, ok.body);
  // the sample has no heading for the bank or cash account: the module stays held and the answer says what is missing
  assert.match(ok.json().message, /^Sample received, but the file cannot be built yet. The sample for Payments Received has no heading that means: .*bank or cash account/i);
  assert.equal(ok.json().file.buildable, false);
  const stored = fs.readdirSync(path.join(process.env.ZOHO_SAMPLES_DIR, 'received'));
  assert.equal(stored.length, 1);
  assert.ok(stored[0].startsWith(`${first.key}_${id}_`));
  const again = await get(`${base}/held-vouchers`);
  assert.equal(again.modules.find(m => m.key === first.key).sampleReceived.fileName, 'zoho_sample.csv');
  assert.equal(again.notInAnyFile, heldTotal, 'the vouchers stay open: the file cannot be built from this sample');
  assert.ok(JSON.stringify(await get(`${base}/audit`)).includes('zoho_sample_received'), 'the upload is in the audit log');

  // a sample that has every heading the file needs: the file is built from it, with the sample's own headings
  const heads = first.key === 'payments_made' ? 'Date,Vendor Name,Amount,Paid Through,Bill Number,Amount Applied' : 'Date,Customer Name,Amount,Deposit To,Invoice Number,Amount Applied';
  const full = await upload(`${heads}\r\n`, 'full_sample.csv');
  assert.equal(full.statusCode, 200, full.body);
  assert.equal(full.json().file.buildable, true, JSON.stringify(full.json().file));
  assert.match(full.json().message, /^Sample received\. The file for .* is ready: \d+ voucher/);
  const built = await call({ url: `${base}/held-vouchers/${first.key}/zoho-file` });
  assert.equal(built.statusCode, 200, built.body);
  assert.equal(built.body.replace(/^﻿/, '').split(/\r?\n/)[0], heads);
  assert.equal((await get(`${base}/held-vouchers`)).notInAnyFile, heldTotal, 'the control total is unchanged: the file is a download beside the other files');
  // Vendor Credits and Credit Notes stay held
  const stillHeld = held.modules.find(m => m.key === 'vendor_credits' || m.key === 'credit_notes');
  if (stillHeld) assert.equal((await call({ url: `${base}/held-vouchers/${stillHeld.key}/zoho-file` })).statusCode, 409);

  // viewers can read but not upload
  await login('viewer');
  const viewerTry = await upload('Date,Payment Number\r\n', 'x.csv');
  assert.notEqual(viewerTry.statusCode, 200);
});
