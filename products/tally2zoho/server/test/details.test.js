// New Migration details: the start date (stored, inside the financial year) and editing a migration's details
// (going back to New Migration changes the same migration, never creates another one).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-details-'));
const { buildApp } = await import('../src/index.js');
const here = path.dirname(fileURLToPath(import.meta.url));
const samples = path.resolve(here, '../../sample-data');
const seed = JSON.parse(fs.readFileSync(path.resolve(here, '../seed-users.json'), 'utf8'));
const app = buildApp();
let cookie = '';
const call = opts => app.inject({ ...opts, headers: { ...(opts.headers || {}), ...(cookie ? { cookie } : {}) } });
const login = async role => {
  const u = seed.users.find(x => x.role === role);
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: u.password } });
  assert.equal(r.statusCode, 200);
  cookie = String(r.headers['set-cookie']).split(';')[0];
};
const create = payload => call({ method: 'POST', url: '/api/migrations', payload });
const edit = (id, payload) => call({ method: 'PUT', url: `/api/migrations/${id}`, payload });
const count = async () => (await call({ url: '/api/migrations' })).json().length;

test('the start date is stored, defaults to the first day of the year, and must be inside the year', async () => {
  await login('analyst');
  let r = await create({ company: 'Demo Traders', financialYear: '2024-25' });
  assert.equal(r.statusCode, 201);
  assert.equal(r.json().start_date, '2024-04-01', 'no date given: the first day of the financial year');

  r = await create({ company: 'Demo Traders', financialYear: '2024–25', startDate: '2025-01-15' });
  assert.equal(r.statusCode, 201);
  assert.equal(r.json().start_date, '2025-01-15');
  r = await call({ url: `/api/migrations/${r.json().id}` });
  assert.equal(r.json().start_date, '2025-01-15', 'read back as stored');

  const before = await count();
  for (const [startDate, words] of [['2024-03-31', /outside financial year/], ['2025-04-01', /outside financial year/], ['2025-02-30', /not a date/], ['01/04/2024', /not a date/], ['2025', /not a date/]]) {
    r = await create({ company: 'Demo Traders', financialYear: '2024-25', startDate });
    assert.equal(r.statusCode, 400, startDate);
    assert.match(r.json().error, words, startDate);
  }
  r = await create({ company: 'Demo Traders', financialYear: '2024-26' });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /not one year/);
  assert.equal(await count(), before, 'nothing created by a refused request');
});

test('editing the details changes the same migration, audits it, locks the year once files are uploaded, and checks the files again when the company changes', async () => {
  await login('analyst');
  const id = (await create({ company: 'Demo Works', gstin: '', financialYear: '2024-25', method: 'Full Migration' })).json().id;
  const before = await count();

  // (changed on purpose, audit item 12: the GSTIN is checked, so the made-up one carries its right check character)
  let r = await edit(id, { company: 'Demo Works Ltd', gstin: '27AAAAA0000A1Z2', startDate: '2024-10-01', method: 'Opening Balances' });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().id, id);
  assert.equal(r.json().company, 'Demo Works Ltd');
  assert.equal(r.json().start_date, '2024-10-01');
  assert.equal(r.json().method, 'Opening Balances');
  assert.equal(await count(), before, 'no new migration');

  // nothing changed: nothing audited
  r = await edit(id, { company: 'Demo Works Ltd', financialYear: '2024–25' });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().financial_year, '2024-25', 'the same year written with another dash is not a change');
  let log = (await call({ url: `/api/migrations/${id}/audit` })).json().filter(a => a.action === 'migration_details_changed');
  assert.equal(log.length, 1);
  assert.match(log[0].detail, /company: Demo Works -> Demo Works Ltd/);
  assert.match(log[0].detail, /start date: 2024-04-01 -> 2024-10-01/);

  // the start date must stay inside the year
  r = await edit(id, { startDate: '2025-06-01' });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /outside financial year 2024-25/);

  // a new year with no date moves the date to the first day of the new year; with a date outside it, refused
  r = await edit(id, { financialYear: '2025-26', startDate: '2024-10-01' });
  assert.equal(r.statusCode, 400);
  r = await edit(id, { financialYear: '2025-26' });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().financial_year, '2025-26');
  assert.equal(r.json().start_date, '2025-04-01');
  r = await edit(id, { financialYear: '2024-25', startDate: '2024-04-01' });
  assert.equal(r.statusCode, 200);

  // once a file is uploaded the company and the year are locked; the other details can still change
  r = await call({ method: 'PUT', url: `/api/migrations/${id}/uploads/customers`, headers: { 'content-type': 'application/octet-stream', 'x-filename': '01_customers.json' }, payload: fs.readFileSync(path.join(samples, '01_customers.json')) });
  assert.equal(r.statusCode, 200);
  r = await edit(id, { financialYear: '2025-26' });
  assert.equal(r.statusCode, 409);
  assert.match(r.json().error, /financial year cannot change after files are uploaded/);
  // the company name can still change: the uploaded files are checked against the new name (warnings only)
  r = await edit(id, { company: 'Another Name' });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json().companyRecheck, { checked: 1, differ: 1, unknown: 0 });
  const fileCompany = r.json().fileCompanies[0];
  assert.ok(fileCompany, 'the company named in the uploaded file is offered');
  r = await edit(id, { company: fileCompany }); // "Use the name in the Tally file"
  assert.equal(r.statusCode, 200);
  assert.deepEqual([r.json().companyRecheck.differ, r.json().fileCompanies.length], [0, 0]);
  const ups = (await call({ url: `/api/migrations/${id}/uploads` }));
  if (ups.statusCode === 200) assert.ok(!JSON.stringify(ups.json()).includes('The file says company'), 'the company warning is gone');
  r = await edit(id, { startDate: '2024-05-01', method: 'Full Migration' });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().start_date, '2024-05-01');
  assert.equal(r.json().uploads, 1);

  r = await edit('MIG-0000-999', { company: 'X' });
  assert.equal(r.statusCode, 404);

  // a viewer cannot change the details
  await login('viewer');
  r = await edit(id, { method: 'Opening Balances' });
  assert.equal(r.statusCode, 403);
});
