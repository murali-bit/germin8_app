// Large files (A6): the record-by-record reader, streamed uploads, and processing as a background job.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-large-'));
process.env.PROCESS_BATCH = '5'; // tiny batches, so a small test file already takes many steps
const { buildApp, recoverInterruptedRuns } = await import('../src/index.js');
const { readTallyFile, pause } = await import('../src/tallystream.js');
const here = path.dirname(fileURLToPath(import.meta.url));
const samples = path.resolve(here, '../../sample-data');
const app = buildApp();
const seed = JSON.parse(fs.readFileSync(path.resolve(here, '../seed-users.json'), 'utf8'));
const cookieOf = async role => {
  const u = seed.users.find(x => x.role === role);
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: u.password } });
  assert.equal(r.statusCode, 200, `login as ${role}`);
  return String(r.headers['set-cookie']).split(';')[0];
};
let cookie = '';
const call = opts => app.inject({ ...opts, headers: { ...(opts.headers || {}), cookie: opts.cookie || cookie } });
const get = async url => (await call({ url })).json();
const send = (method, url, payload) => call({ method, url, payload });
const putRaw = (id, slot, buffer, extra = {}) => call({ method: 'PUT', url: `/api/migrations/${id}/uploads/${slot}`, headers: { 'content-type': 'application/octet-stream', 'x-filename': 'test.json' }, payload: buffer, ...extra });
const putFile = (id, slot, file) => putRaw(id, slot, fs.readFileSync(file));
const FILES = {
  customers: '01_customers.json', vendors: '02_vendors.json', accounts: '03_chart_of_accounts.json', stock_items: '04_stock_items.json',
  units: '05_units.json', taxes: '06_tax_configuration.json', sales: '07_sales_vouchers.json', purchase: '08_purchase_vouchers.json',
  receipt: '09_receipt_vouchers.json', payment: '10_payment_vouchers.json', journal: '11_journal_vouchers.json', trial_balance: '13_trial_balance.json',
};
const tmpFile = (name, content) => { const p = path.join(process.env.DATA_DIR, name); fs.writeFileSync(p, content); return p; };
const read = (file, opts) => { const out = { records: [], envelope: {}, end: null }; for (const ev of readTallyFile(file, opts)) { if (ev.type === 'record') out.records.push(ev.value); else if (ev.type === 'envelope') out.envelope[ev.key] = ev.value; else out.end = ev; } return out; };
// Sales vouchers that balance and use ledgers of the sample masters.
const salesVouchers = n => Array.from({ length: n }, (_, i) => ({
  metadata: { type: 'Voucher', vchtype: 'Sales' }, guid: `big-${i}`, date: '20240612', vouchertypename: 'Sales', vouchernumber: `BIG/${i + 1}`, partyledgername: 'Kaveri Components',
  ledgerentries: [{ ledgername: 'Kaveri Components', amount: '-118.00', ispartyledger: true }, { ledgername: 'Sales - Spares', amount: '100.00' }, { ledgername: 'Output CGST', amount: '9.00' }, { ledgername: 'Output SGST', amount: '9.00' }],
}));

test('the record-by-record reader handles awkward but valid JSON', () => {
  const tricky = [
    { metadata: { type: 'Ledger' }, name: 'Brackets ] } [ { and "quotes" inside', note: 'a comma, a colon: and a backslash \\ at the end \\' },
    { metadata: { type: 'Ledger' }, name: 'Unicode: ₹ हिन्दी café 😀', escaped: 'tab\there, newline\nhere, unicode escape \u0004 Not Applicable', nested: { list: [[1, [2, { deep: '}]' }]], 'x'] } },
    { metadata: { type: 'Ledger' }, name: '', empty: {}, none: [], n: -1.5e3, yes: true, no: false, nothing: null },
  ];
  const doc = { Header: 'text with { and [', static_variables: [{ name: 'svCurrentCompany', value: 'A "quoted" Co.' }], TallyMessage: tricky, after: { late: ['key', 'after the list'] }, number: 12.5, flag: true, nil: null };
  // written with escapes (\uXXXX) and with a byte order mark; read in chunks of every awkward size
  const escaped = JSON.stringify(doc, null, 1).replace(/[\u007f-￿]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  for (const [label, text] of [['compact', JSON.stringify(doc)], ['indented', JSON.stringify(doc, null, 2)], ['escaped', escaped], ['BOM', `﻿${JSON.stringify(doc)}`], ['outer space', ` \r\n\t${JSON.stringify(doc)}\n\n `]]) {
    const file = tmpFile('tricky.json', text);
    for (const chunkSize of [1, 2, 3, 7, 64, 1024 * 1024]) {
      const r = read(file, { chunkSize });
      assert.deepEqual(r.records, tricky, `${label}, chunks of ${chunkSize}`);
      assert.deepEqual(r.envelope, { Header: doc.Header, static_variables: doc.static_variables, after: doc.after, number: 12.5, flag: true, nil: null }, `${label}: keys before and after the list`);
      assert.deepEqual([r.end.records, r.end.hasList], [3, true]);
    }
  }
  // the key is found whatever its capital letters; static_variables may come after the records
  let r = read(tmpFile('t.json', '{"TALLYMESSAGE":[{"a":1}],"static_variables":[{"name":"svCurrentCompany","value":"X"}]}'));
  assert.deepEqual([r.records, r.envelope.static_variables[0].value], [[{ a: 1 }], 'X']);
  // an empty list, no list, a list that is not a list, and a file that is not an object
  assert.deepEqual([read(tmpFile('t.json', '{"tallymessage":[]}')).end.hasList, read(tmpFile('t.json', '{"tallymessage":[]}')).end.records], [true, 0]);
  assert.equal(read(tmpFile('t.json', '{}')).end.hasList, false);
  assert.equal(read(tmpFile('t.json', '{"tallymessage":{"a":[1]}}')).end.hasList, false);
  assert.equal(read(tmpFile('t.json', '[{"tallymessage":[1]}]')).end.hasList, false);
  assert.equal(read(tmpFile('t.json', '"just text"')).end.hasList, false);
  // records need not be objects for the reader; the upload check decides what they are
  assert.deepEqual(read(tmpFile('t.json', '{"tallymessage":[1,"two",null,[3]]}')).records, [1, 'two', null, [3]]);
});

test('the reader refuses broken JSON with a plain message', () => {
  const broken = {
    '': /the file is empty/,
    '   ': /the file is empty/,
    '{"tallymessage":[{"a":1},{"b":2}': /ends in the middle of the "tallymessage" list/,
    '{"tallymessage":[{"a":1},{"b":': /ends in the middle of record 2/,
    '{"tallymessage":[{"a":1} {"b":2}]}': /a comma or the end of the list was expected after record 1/,
    '{"tallymessage":[{"a":1},]}': /a value is missing/,
    '{"tallymessage":[{"a":1,}]}': /record 1 is not valid JSON/,
    '{"tallymessage":[{"a":"unfinished]}': /ends in the middle of record 1/,
    '{"tallymessage":[{"a":tru}]}': /record 1 is not valid JSON/,
    '{"tallymessage":[{"a":1}]': /ends before the data is complete/,
    '{"tallymessage":[{"a":1}]}}': /unexpected text after the end of the data/,
    '{"tallymessage":[{"a":1}],}': /a field name in double quotes was expected/,
    '{tallymessage:[]}': /a field name in double quotes was expected/,
    '{"tallymessage" [1]}': /a colon was expected after "tallymessage"/,
    '{"a":[1 2],"tallymessage":[]}': /the value of "a" is not valid JSON/,
    '{"tallymessage":[1],"TallyMessage":[2]}': /more than one "tallymessage" list/,
    '[1,2': /ends in the middle of the file/,
    'not json at all': /not valid JSON/,
  };
  for (const [text, message] of Object.entries(broken)) {
    for (const chunkSize of [1, 5, 4096]) assert.throws(() => read(tmpFile('broken.json', text), { chunkSize }), message, JSON.stringify(text));
  }
});

test('uploads are streamed to disk and checked record by record', async () => {
  cookie = await cookieOf('analyst');
  let r = await send('POST', '/api/migrations', { company: 'Apex Engineering Technologies Pvt. Ltd.', financialYear: '2024-25' });
  const id = r.json().id;
  const base = `/api/migrations/${id}`;
  const tmpDir = path.join(process.env.DATA_DIR, 'tmp');
  const leftovers = () => fs.readdirSync(tmpDir).length;

  // byte order mark, the company named AFTER the records, capital letters in the list key, awkward text in a value
  const body = Buffer.from(`﻿{"TallyMessage":[{"metadata":{"type":"Ledger"},"name":"Odd ] } \\" name ₹","parent":"Sundry Debtors"}],"STATIC_VARIABLES":[{"name":"svCurrentCompany","value":"Some Other Co."}]}`);
  r = await putRaw(id, 'customers', body);
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual([r.json().records, r.json().recordTypes], [1, { Ledger: 1 }]);
  assert.ok(r.json().warnings.some(w => /The file says company "Some Other Co\."/.test(w)), 'the company is read even when it comes after the records');
  const { createHash } = await import('node:crypto');
  assert.equal(r.json().sha256, createHash('sha256').update(body).digest('hex'), 'the checksum is of the bytes as sent');
  const stored = path.join(process.env.DATA_DIR, 'uploads', id, 'customers.json');
  assert.ok(fs.readFileSync(stored).equals(body), 'the stored file is the file as sent');
  assert.equal((await get(`${base}/completeness`)).slots.find(s => s.key === 'customers').upload.size, body.length);

  // the earlier messages, unchanged
  r = await putRaw(id, 'vendors', Buffer.from('{"tallymessage":[{"metadata":{"type":"Ledger"},"name":"A"'));
  assert.equal(r.statusCode, 422); assert.match(r.json().error, /^This is not a valid JSON file \(/);
  r = await putRaw(id, 'vendors', Buffer.from('{"something":[]}'));
  assert.equal(r.statusCode, 422); assert.match(r.json().error, /has no "tallymessage" list/);
  r = await putRaw(id, 'vendors', Buffer.from('[1,2,3]'));
  assert.equal(r.statusCode, 422); assert.match(r.json().error, /has no "tallymessage" list/);
  r = await putRaw(id, 'vendors', Buffer.from('{"tallymessage":[]}'));
  assert.equal(r.statusCode, 422); assert.match(r.json().error, /contains no records/);
  r = await putRaw(id, 'vendors', Buffer.from('{"tallymessage":[null, 5]}'));
  assert.equal(r.statusCode, 422); assert.match(r.json().error, /Wrong file for this slot.*2 Unknown/);
  r = await putRaw(id, 'vendors', Buffer.alloc(0));
  assert.equal(r.statusCode, 400); assert.match(r.json().error, /No file received/);
  r = await putRaw(id, 'nonsense', body);
  assert.equal(r.statusCode, 404);
  r = await app.inject({ method: 'PUT', url: `${base}/uploads/vendors`, headers: { 'content-type': 'application/octet-stream' }, payload: body });
  assert.equal(r.statusCode, 401, 'not signed in');
  await pause(); await pause();
  assert.equal(leftovers(), 0, 'no temporary file is left behind by a refused, rejected or accepted upload');
  assert.ok(!fs.existsSync(path.join(process.env.DATA_DIR, 'uploads', id, 'vendors.json')));

  // a long check pauses, and another user's request runs in between: the upload is still recorded under the uploader
  const adminCookie = await cookieOf('admin');
  const many = Buffer.from(JSON.stringify({ tallymessage: Array.from({ length: 4500 }, (_, i) => ({ metadata: { type: 'Unit' }, name: `unit ${i}` })) }));
  const [up, other] = await Promise.all([putRaw(id, 'units', many), (async () => { await pause(); return call({ url: '/api/migrations', cookie: adminCookie }); })()]);
  assert.deepEqual([up.statusCode, up.json().records, other.statusCode], [200, 4500, 200]);
  const entry = (await get(`${base}/audit`)).find(a => a.action === 'upload' && /Units of Measurement/.test(a.detail));
  assert.equal(entry.actor, 'analyst@demo.test');
});

test('processing runs in the background, reports progress and cleans up after a failure', async () => {
  cookie = await cookieOf('analyst');
  let r = await send('POST', '/api/migrations', { company: 'Apex Engineering Technologies Pvt. Ltd.', financialYear: '2024-25' });
  const id = r.json().id;
  const base = `/api/migrations/${id}`;
  for (const [slot, f] of Object.entries(FILES)) assert.equal((await putFile(id, slot, path.join(samples, f))).statusCode, 200, slot);
  await send('PUT', `${base}/waivers/stock_summary`, { reason: 'Not needed for test' });
  const big = Buffer.from(JSON.stringify({ tallymessage: salesVouchers(120) }));
  assert.equal((await putRaw(id, 'sales', big)).statusCode, 200);
  const totalRecords = (await get(`${base}/completeness`)).slots.reduce((t, s) => t + (s.upload?.records || 0), 0);

  let st = await get(`${base}/process-status`);
  assert.deepEqual([st.state, st.runId, st.recordsDone, st.percent, st.migrationStatus], ['idle', null, 0, 0, 'awaiting_uploads']);

  // ---- start without waiting: the answer comes at once, with the job ----
  r = await send('POST', `${base}/process?wait=0`);
  assert.equal(r.statusCode, 202, r.body);
  const first = r.json();
  assert.deepEqual([first.alreadyRunning, first.job.state, first.job.recordsTotal, first.job.error, first.job.startedBy], [false, 'queued', totalRecords, null, 'analyst@demo.test']);
  assert.ok(first.job.runId);
  // a second request while it runs returns the same job and does not start another
  r = await send('POST', `${base}/process?wait=0`);
  assert.equal(r.statusCode, 202);
  assert.deepEqual([r.json().alreadyRunning, r.json().job.runId], [true, first.job.runId]);

  // ---- progress: poll until it ends ----
  const seen = [];
  let busyChecked = false;
  for (let i = 0; i < 5000; i++) {
    await pause(); // a real client waits between polls; without this the test never lets the event loop turn
    st = await get(`${base}/process-status`);
    seen.push(st);
    if (st.state !== 'queued' && st.state !== 'running') break;
    if (st.state === 'running' && !busyChecked) {
      busyChecked = true;
      // the server answers other requests meanwhile; changes to the uploads and file creation are refused until it ends
      assert.equal((await app.inject({ url: '/api/health' })).json().ok, true);
      assert.equal((await get(base)).status, 'processing');
      assert.equal((await get(base)).processing.runId, first.job.runId);
      r = await putFile(id, 'units', path.join(samples, FILES.units));
      assert.equal(r.statusCode, 409); assert.match(r.json().error, /is being processed/);
      assert.equal((await send('DELETE', `${base}/uploads/units`)).statusCode, 409);
      assert.equal((await send('POST', `${base}/generate`)).statusCode, 409);
      assert.equal((await get(`${base}/report`)).staleSinceUpload, false);
    }
  }
  assert.ok(busyChecked, 'the job was seen running');
  assert.deepEqual([st.state, st.phase, st.recordsDone, st.recordsTotal, st.percent, st.error, st.estimatedSecondsRemaining, st.migrationStatus], ['done', 'Finished', totalRecords, totalRecords, 100, null, null, 'processed']);
  assert.ok(seen.every(s => s.runId === first.job.runId), 'one job throughout');
  const running = seen.filter(s => s.state === 'running');
  assert.ok(running.length >= 3, 'several progress readings while running');
  assert.ok(running.some(s => s.recordsDone > 0 && s.recordsDone < totalRecords), 'records done is seen part-way');
  assert.ok(running.every((s, i) => i === 0 || (s.recordsDone >= running[i - 1].recordsDone && s.percent >= running[i - 1].percent)), 'progress never goes backwards');
  assert.ok(running.every(s => s.percent >= 0 && s.percent < 100 && s.elapsedSeconds >= 0 && s.recordsTotal === totalRecords));
  assert.ok(running.some(s => /^Reading /.test(s.phase)) && running.every(s => typeof s.phase === 'string'));
  assert.ok(running.every(s => s.estimatedSecondsRemaining === null || s.estimatedSecondsRemaining >= 0), 'no estimate until there is enough to go on');
  assert.equal(typeof st.elapsedSeconds, 'number');

  // ---- the result is what synchronous processing gave: everything stored, cross-checks run at the end ----
  const summary = await get(`${base}/summary`);
  assert.equal(summary.status, 'processed');
  assert.equal(summary.bySlot.reduce((t, s) => t + s.n, 0), totalRecords);
  assert.equal(summary.bySlot.find(s => s.slot === 'sales').n, 120);
  assert.deepEqual(summary.exceptions, []);
  const cgst = (await get(`${base}/tax-mappings`)).find(t => t.ledger === 'Output CGST');
  assert.deepEqual([cgst.vouchers, cgst.appearsWith.map(a => [a.ledger, a.vouchers])], [121, [['Output SGST', 121]]], 'tax ledger use is worked out during processing');
  const audit = await get(`${base}/audit`);
  assert.equal(audit.find(a => a.action === 'process').actor, 'analyst@demo.test');

  // ---- asking to wait gives the result in the answer; small uploads wait by default ----
  r = await send('POST', `${base}/process?wait=1`);
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual([r.json().job.state, r.json().alreadyRunning, r.json().crossChecks], ['done', false, 0]);
  assert.ok(r.json().summary.every(s => s.inFile === s.stored));
  assert.notEqual(r.json().job.runId, first.job.runId);
  // a request that waits while a job is running waits for that job
  const [a, b] = await Promise.all([send('POST', `${base}/process?wait=1`), send('POST', `${base}/process?wait=1`)]);
  assert.deepEqual([a.statusCode, b.statusCode, a.json().job.runId === b.json().job.runId, [a.json().alreadyRunning, b.json().alreadyRunning].sort()], [200, 200, true, [false, true]]);
  assert.equal((await send('POST', `${base}/generate`)).statusCode, 200);

  // ---- a dataset that fails: nothing is left looking processed ----
  const salesPath = path.join(process.env.DATA_DIR, 'uploads', id, 'sales.json');
  fs.writeFileSync(salesPath, big.subarray(0, Math.floor(big.length * 0.6))); // the stored file is cut short after it was accepted
  r = await send('POST', `${base}/process?wait=1`);
  assert.equal(r.statusCode, 422, r.body);
  assert.match(r.json().error, /^Processing stopped: Sales Vouchers: the uploaded file "test\.json" could not be read \(.*\)\. Upload the file again\./);
  st = await get(`${base}/process-status`);
  assert.deepEqual([st.state, st.migrationStatus, st.error], ['failed', 'awaiting_uploads', r.json().error]);
  const after = await get(`${base}/summary`);
  assert.deepEqual([after.status, after.bySlot, after.exceptions], ['awaiting_uploads', [], []], 'the records stored before the failure were removed');
  assert.deepEqual(await get(`${base}/files`), []);
  assert.equal((await get('/api/migrations')).find(m => m.id === id).records, 0);
  assert.equal((await send('POST', `${base}/generate`)).statusCode, 409);
  const failed = (await get(`${base}/audit`)).find(x => x.action === 'process_failed');
  assert.equal(failed.actor, 'analyst@demo.test');
  assert.match(failed.detail, /nothing is shown as processed/);
  const rep = await get(`${base}/test-report`);
  assert.equal(rep.processing.lastRun.state, 'failed');
  assert.ok(rep.whatToFixNext.some(f => f.stage === 'Processing' && f.blocking && /The last processing run failed: Processing stopped: Sales Vouchers/.test(f.message)));
  // a file whose record count changed on disk is caught by the control total
  fs.writeFileSync(salesPath, JSON.stringify({ tallymessage: salesVouchers(7) }));
  r = await send('POST', `${base}/process?wait=1`);
  assert.equal(r.statusCode, 422);
  assert.match(r.json().error, /Control total failed for Sales Vouchers: the file had 120 records when it was uploaded, but 7 were read now/);
  // uploading the file again puts it right
  assert.equal((await putRaw(id, 'sales', big)).statusCode, 200);
  r = await send('POST', `${base}/process?wait=1`);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal((await get(`${base}/process-status`)).state, 'done');

  // ---- a server restart during a job must not leave the migration stuck ----
  const raw = new DatabaseSync(path.join(process.env.DATA_DIR, 'migration.db'));
  raw.prepare("UPDATE process_runs SET state = 'running', finished_at = NULL WHERE job_id = ?").run(id);
  raw.prepare("UPDATE migrations SET status = 'processing' WHERE id = ?").run(id);
  raw.close();
  recoverInterruptedRuns(); // what the server does when it starts
  st = await get(`${base}/process-status`);
  assert.deepEqual([st.state, st.migrationStatus], ['failed', 'awaiting_uploads']);
  assert.match(st.error, /the server was restarted while processing was running/);
  assert.deepEqual((await get(`${base}/summary`)).bySlot, []);
  r = await send('POST', `${base}/process`); // no wait parameter: these files are small, so it waits as it always did
  assert.equal(r.statusCode, 200, r.body);
  assert.ok(r.json().summary.length > 0);

  // blocked requests do not start a job; a viewer can read the status but not start one
  await send('PUT', `${base}/expected-counts/customers`, { expected: 99 });
  assert.equal((await send('POST', `${base}/process?wait=0`)).statusCode, 409);
  assert.equal((await get(`${base}/process-status`)).state, 'done');
  cookie = await cookieOf('viewer');
  assert.equal((await call({ url: `${base}/process-status` })).statusCode, 200);
  assert.equal((await send('POST', `${base}/process?wait=0`)).statusCode, 403);
});
