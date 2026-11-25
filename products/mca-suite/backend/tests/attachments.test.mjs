// node --test backend/tests/attachments.test.mjs
// Attachment routes against an in-memory database and a temp folder. Made-up company, tiny fake PDFs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Readable } from 'node:stream';
import {
  handle, setAttachmentsDir, listAttachments, readAttachment, safeName, sizeWarning, ATTACHMENTS_DDL,
} from '../routes/attachments.js';

const CIN = 'U01100KA2019PTC000001';
let dir, db;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g8-att-'));
  setAttachmentsDir(dir);
  db = new DatabaseSync(':memory:');
  db.exec(ATTACHMENTS_DDL);
});
after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const pdf = (text, pad = 0) => Buffer.concat([Buffer.from(`%PDF-1.4\n% ${text}\n`), Buffer.alloc(pad, 0x20), Buffer.from('%%EOF\n')]);

function sendJson(res, status, data) { res.status = status; res.json = data; res.done = true; }
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', c => { b += c; });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
  });
}
async function call(method, urlPath, body) {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  req.method = method;
  const url = new URL(urlPath, 'http://localhost');
  const res = {
    headers: null, body: null,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(buf) { this.body = buf; this.done = true; },
  };
  const handled = await handle(req, res, { url, pathname: url.pathname, method, db, sendJson, parseJsonBody });
  return { handled, ...res };
}
const upload = (slot, buf, extra = {}) => call('POST', '/api/attachments',
  { cin: CIN, slot, fileName: `${slot}.pdf`, mime: 'application/pdf', base64: buf.toString('base64'), ...extra });

test('other paths are left to the server', async () => {
  assert.equal((await call('GET', '/api/health')).handled, false);
  assert.equal((await call('GET', '/api/attachmentsX')).handled, false);
});

test('validation: CIN, slot, PDF only, size', async () => {
  let r = await upload('a', pdf('x'), { cin: 'BAD' });
  assert.equal(r.status, 400); assert.match(r.json.message, /CIN/);
  r = await upload('b', pdf('x'));
  assert.equal(r.status, 400); assert.match(r.json.message, /slot/);
  r = await upload('a', Buffer.from('PK\x03\x04 not a pdf'));
  assert.equal(r.status, 400); assert.match(r.json.message, /PDF/);
  r = await upload('a', Buffer.alloc(0));
  assert.equal(r.status, 400);
  r = await upload('g', pdf('big', 10 * 1024 * 1024 + 10));
  assert.equal(r.status, 413);
  assert.equal(listAttachments(db, CIN).length, 0);
});

test('upload, list, content, (a) replaces the previous (a), duplicates kept once, delete', async () => {
  const a1 = await upload('a', pdf('first'), { fileName: 'FS 2025 (signed).pdf', jobId: 'job_1' });
  assert.equal(a1.status, 201);
  assert.equal(a1.json.attachment.slot, 'a');
  assert.equal(a1.json.attachment.jobId, 'job_1');
  assert.equal(a1.json.attachment.fileName, 'FS 2025 (signed).pdf');
  assert.equal(a1.json.warning, undefined);
  const stored = fs.readdirSync(path.join(dir, CIN));
  assert.equal(stored.length, 1);
  assert.match(stored[0], /^att_[0-9a-f-]{36}-FS_2025_signed\.pdf$/);

  const a2 = await upload('a', pdf('second'));
  assert.equal(a2.status, 201);
  assert.deepEqual(a2.json.replaced, [a1.json.attachment.id]);
  assert.equal(fs.readdirSync(path.join(dir, CIN)).length, 1, 'the old (a) file is removed from disk');

  const g1 = await upload('g', pdf('extra one'));
  const g2 = await upload('g', pdf('extra two'));
  const gDup = await upload('g', pdf('extra one'));
  assert.equal(gDup.status, 200); assert.equal(gDup.json.duplicate, true); assert.equal(gDup.json.attachment.id, g1.json.attachment.id);

  const list = await call('GET', `/api/attachments?cin=${CIN.toLowerCase()}&formType=aoc4`);
  assert.equal(list.status, 200);
  assert.deepEqual(list.json.attachments.map(x => x.slot), ['a', 'g', 'g']);
  assert.deepEqual(list.json.attachments.map(x => x.id), [a2.json.attachment.id, g1.json.attachment.id, g2.json.attachment.id]);
  assert.ok(list.json.attachments.every(x => !('buffer' in x) && !('path' in x)), 'no bytes or disk paths in the list');
  assert.equal((await call('GET', '/api/attachments?cin=U01100KA2019PTC000002')).json.attachments.length, 0);
  assert.equal((await call('GET', '/api/attachments')).status, 400);

  const c = await call('GET', `/api/attachments/${a2.json.attachment.id}/content`);
  assert.equal(c.status, 200);
  assert.equal(c.headers['Content-Type'], 'application/pdf');
  assert.match(c.headers['Content-Disposition'], /^attachment; filename="a\.pdf"/);
  assert.ok(Buffer.compare(c.body, pdf('second')) === 0);

  const read = readAttachment(db, g2.json.attachment.id);
  assert.equal(read.fileName, 'g.pdf');
  assert.equal(read.buffer.toString(), pdf('extra two').toString());
  assert.equal(readAttachment(db, 'att_nope'), null);

  const del = await call('DELETE', `/api/attachments/${g1.json.attachment.id}`);
  assert.equal(del.status, 200);
  assert.equal((await call('DELETE', `/api/attachments/${g1.json.attachment.id}`)).status, 404);
  assert.equal((await call('GET', `/api/attachments/${g1.json.attachment.id}/content`)).status, 404);
  assert.equal(listAttachments(db, CIN).length, 2);
  assert.equal((await call('GET', '/api/attachments/..%2F..%2Fsecret/content')).status, 404);
});

test('MCA size warnings: (g) over 2 MB, (a) over 6 MB', async () => {
  const r = await upload('g', pdf('large g', 2 * 1024 * 1024 + 1));
  assert.equal(r.status, 201);
  assert.match(r.json.warning, /at most 2\.0 MB for \(g\)/);
  assert.equal(sizeWarning('a', 5 * 1024 * 1024), '');
  assert.match(sizeWarning('a', 7 * 1024 * 1024), /6\.0 MB for \(a\)/);
});

test('safe file names', () => {
  assert.equal(safeName('../../etc/passwd'), 'passwd.pdf');
  assert.equal(safeName('Balance sheet 2024-25.PDF'), 'Balance_sheet_2024-25.pdf');
  assert.equal(safeName(''), 'document.pdf');
});

test('origin guard: foreign web pages are refused, dashboard/extension get their own origin back', async () => {
  const { originAllowed, guardOrigin } = await import('../routes/attachments.js');
  assert.equal(originAllowed(undefined), true);
  assert.equal(originAllowed('http://localhost:5173'), true);
  assert.equal(originAllowed('http://127.0.0.1:5174'), true);
  assert.equal(originAllowed('chrome-extension://abcdefghijklmnopabcdefghijklmnop'), true);
  assert.equal(originAllowed('https://evil.example.com'), false);
  assert.equal(originAllowed('http://localhost.evil.com'), false);
  assert.equal(originAllowed('null'), false);

  const mkReq = (method, origin) => { const r = Readable.from([]); r.method = method; r.headers = { origin }; return r; };
  const mkRes = () => ({ writeHead(status, headers) { this.status = status; this.headers = headers; }, end(b) { this.body = b; } });
  // Refused before anything is read or deleted.
  const url = new URL('/api/attachments?cin=' + CIN, 'http://localhost');
  let res = mkRes();
  let sent = null;
  await handle(mkReq('GET', 'https://evil.example.com'), res, { url, pathname: url.pathname, method: 'GET', db, sendJson: (r, s, d) => { sent = { s, d }; }, parseJsonBody });
  assert.equal(sent.s, 403);
  // Allowed origin: the server-wide "*" becomes that origin.
  res = mkRes();
  assert.equal(guardOrigin(mkReq('GET', 'http://localhost:5173'), res, () => {}), true);
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  assert.equal(res.headers['Access-Control-Allow-Origin'], 'http://localhost:5173');
  res = mkRes();
  guardOrigin(mkReq('GET', undefined), res, () => {});
  res.writeHead(200, { 'Access-Control-Allow-Origin': '*' });
  assert.equal(res.headers['Access-Control-Allow-Origin'], undefined);
});
