// UI audit fixes (fork C): one number for "flagged items" on every screen. GET /summary gives counts.flagged (every
// flagged item stored), counts.warnings (names passed as in Tally) and counts.toCheck; the test report's processing
// block gives the same total. Uses the made-up three-file samples (15, 16, 17).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-uifix-c-'));
const { buildApp } = await import('../src/index.js');
const { NAME_WARNING_KINDS } = await import('../src/testreport.js');

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
const send = (method, url, payload) => call({ method, url, payload });
const upload = (id, slot, f) => call({ method: 'PUT', url: `/api/migrations/${id}/uploads/${slot}`, headers: { 'content-type': 'application/octet-stream', 'x-filename': f }, payload: fs.readFileSync(path.join(samples, f)) });
const company = () => {
  const doc = JSON.parse(fs.readFileSync(path.join(samples, '15_all_masters_for_transactions_utf16.json')).toString('utf16le').replace(/^﻿/, ''));
  return (doc.static_variables || []).find(v => v.name === 'svCurrentCompany')?.value || 'Made-up Company';
};

test('GET /summary counts: one number for flagged items, warnings apart, the same total as the test report', async () => {
  await login('analyst');
  const r = await send('POST', '/api/migrations', { company: company(), financialYear: '2024-25' });
  assert.equal(r.statusCode, 201);
  const id = r.json().id;
  const base = `/api/migrations/${id}`;

  // before anything is read: zero, and the fields are there
  let s = await get(`${base}/summary`);
  assert.deepEqual([s.counts.flagged, s.counts.warnings, s.counts.toCheck], [0, 0, 0]);

  assert.equal((await upload(id, 'all_masters', '15_all_masters_for_transactions_utf16.json')).statusCode, 200);
  assert.equal((await upload(id, 'all_transactions', '16_all_transactions_utf16.json')).statusCode, 200);
  assert.equal((await upload(id, 'trial_balance', '17_trial_balance_report_utf16.json')).statusCode, 200);
  const comp = await get(`${base}/completeness`);
  for (const d of comp.slots.filter(x => x.requirement !== 'optional' && x.status === 'missing')) {
    assert.equal((await send('PUT', `${base}/waivers/${d.key}`, { reason: 'Made-up company keeps no inventory' })).statusCode, 200);
  }
  assert.equal((await send('POST', `${base}/process?wait=1`)).statusCode, 200);
  assert.equal((await send('POST', `${base}/generate`)).statusCode, 200);

  s = await get(`${base}/summary`);
  assert.ok(s.counts.flagged > 0, 'the made-up data has flagged items');
  assert.equal(s.counts.flagged, s.exceptions.length, 'flagged = every flagged item listed');
  assert.equal(s.counts.warnings, s.exceptions.filter(e => NAME_WARNING_KINDS.has(e.kind)).length);
  assert.equal(s.counts.warnings, s.exceptions.filter(e => e.warning).length, 'the same items carry warning: true');
  assert.equal(s.counts.toCheck, s.counts.flagged - s.counts.warnings);
  assert.equal(Object.values(s.counts.byStage).reduce((t, n) => t + n, 0), s.counts.flagged, 'every item is in one stage');
  assert.equal(s.counts.byStage.process || 0, s.exceptions.filter(e => e.stage === 'process').length);

  // the test report (Reports and Audit) says the same total
  const report = await get(`${base}/test-report`);
  assert.equal(report.processing.flaggedItems.total, s.counts.flagged);
  assert.equal(report.processing.flaggedItems.warnings, s.counts.warnings);
  // and so does the one-page report's list
  const page = await get(`${base}/report`);
  assert.equal(page.exceptions.length, s.counts.flagged);
});
