// Attachments uploaded in the dashboard (AOC-4 page 2: (a) the one PDF with the financial statements + auditor's
// report + Board's report, (g) optional extra PDFs). The extension's autopilot downloads them for page 2 when its side
// panel has no file chosen for that company. Files live on disk under backend/data/attachments/<CIN>/<id>-<name>
// (gitignored); the table only holds the metadata. File contents are never logged.
//
//   POST   /api/attachments               {cin, jobId?, formType='aoc4', slot:'a'|'g', fileName, mime, base64}
//   GET    /api/attachments?cin=&formType= list (no bytes)
//   GET    /api/attachments/:id/content    raw bytes
//   DELETE /api/attachments/:id
//
// ctx: { url, pathname, method, db, sendJson, parseJsonBody }
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Executed by db.js (and by ensureTable for a database handed in by a test).
export const ATTACHMENTS_DDL = `
  CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    cin TEXT NOT NULL,
    job_id TEXT,
    form_type TEXT DEFAULT 'aoc4',
    slot TEXT NOT NULL,
    file_name TEXT,
    mime TEXT,
    size INTEGER,
    sha256 TEXT,
    path TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_attachments_cin ON attachments (cin, form_type);
`;

export const CIN_RE = /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;
export const MAX_BYTES = 10 * 1024 * 1024;
// MCA's own size limits per slot (the upload is refused on MCA above these).
export const MCA_LIMIT = { a: 6 * 1024 * 1024, g: 2 * 1024 * 1024 };
const SLOTS = new Set(['a', 'g']);
const FORM_RE = /^[a-z0-9-]{1,20}$/;
const ID_RE = /^att_[0-9a-f-]{36}$/;

let baseDir = process.env.GERMIN8_ATTACH_DIR || path.join(__dirname, '..', 'data', 'attachments');
/** Tests point the store at a temp folder. */
export function setAttachmentsDir(dir) { baseDir = dir; }
export function attachmentsDir() { return baseDir; }

const ready = new WeakSet();
export function ensureTable(db) {
  if (ready.has(db)) return;
  db.exec(ATTACHMENTS_DDL);
  ready.add(db);
}

const mb = n => `${(n / 1048576).toFixed(1)} MB`;

/** Size warning for a slot (MCA refuses bigger files), or ''. */
export function sizeWarning(slot, size) {
  const lim = MCA_LIMIT[slot];
  if (!lim || size <= lim) return '';
  return `This file is ${mb(size)}; MCA accepts at most ${mb(lim)} for (${slot}). Compress it before the extension uploads it, or MCA will refuse it.`;
}

/** File name safe for the disk: letters, digits, dot, dash, underscore; ends in .pdf. */
export function safeName(name) {
  const base = String(name || 'document').split(/[\\/]/).pop();
  const s = base.replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+|_+$/g, '').slice(0, 80);
  return `${s || 'document'}.pdf`;
}

const toMeta = r => ({
  id: r.id, cin: r.cin, jobId: r.job_id || null, formType: r.form_type, slot: r.slot, fileName: r.file_name,
  mime: r.mime, size: r.size, sha256: r.sha256, createdAt: r.created_at, warning: sizeWarning(r.slot, r.size) || undefined,
});

// The stored relative path, resolved and kept inside the store (a tampered row can never point elsewhere).
function absPath(rel) {
  const root = path.resolve(baseDir);
  const p = path.resolve(root, String(rel || ''));
  return p.startsWith(root + path.sep) ? p : null;
}

function removeFile(rel) {
  const p = absPath(rel);
  if (!p) return;
  try { fs.unlinkSync(p); } catch (_) { /* already gone */ }
}

/** Every attachment of a company for one form, (a) first, oldest first. No bytes. */
export function listAttachments(db, cin, formType = 'aoc4') {
  ensureTable(db);
  const rows = db.prepare(`SELECT * FROM attachments WHERE cin = ? AND form_type = ? ORDER BY slot ASC, created_at ASC, rowid ASC`)
    .all(String(cin || '').trim().toUpperCase(), String(formType || 'aoc4'));
  return rows.map(toMeta);
}

/** One attachment with its bytes: {fileName, mime, buffer, ...meta} or null (unknown id / file missing on disk). */
export function readAttachment(db, id) {
  ensureTable(db);
  const r = db.prepare('SELECT * FROM attachments WHERE id = ?').get(String(id || ''));
  if (!r) return null;
  const p = absPath(r.path);
  if (!p) return null;
  let buffer;
  try { buffer = fs.readFileSync(p); } catch (_) { return null; }
  return { ...toMeta(r), fileName: r.file_name, mime: r.mime || 'application/pdf', buffer };
}

/** Validates and stores one upload. Returns {status, body}. */
export function saveAttachment(db, input) {
  ensureTable(db);
  const cin = String(input?.cin || '').trim().toUpperCase();
  const slot = String(input?.slot || '').trim().toLowerCase();
  const formType = String(input?.formType || 'aoc4').trim().toLowerCase();
  const jobId = input?.jobId ? String(input.jobId).slice(0, 100) : null;
  const fileName = String(input?.fileName || '').trim().slice(0, 200) || 'document.pdf';
  if (!CIN_RE.test(cin)) return { status: 400, body: { ok: false, message: 'Enter a valid CIN first (21 characters, like U01100KA2019PTC000001).' } };
  if (!SLOTS.has(slot)) return { status: 400, body: { ok: false, message: 'slot must be "a" or "g".' } };
  if (!FORM_RE.test(formType)) return { status: 400, body: { ok: false, message: 'Unknown form type.' } };
  const b64 = String(input?.base64 || '').replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  if (!b64) return { status: 400, body: { ok: false, message: 'The file is empty.' } };
  // Rough size check before decoding: base64 is 4/3 of the bytes.
  if (b64.length * 0.75 > MAX_BYTES + 4) return { status: 413, body: { ok: false, message: `The file is larger than ${mb(MAX_BYTES)}. Compress it first.` } };
  const buffer = Buffer.from(b64, 'base64');
  if (!buffer.length) return { status: 400, body: { ok: false, message: 'The file is empty.' } };
  if (buffer.length > MAX_BYTES) return { status: 413, body: { ok: false, message: `The file is larger than ${mb(MAX_BYTES)}. Compress it first.` } };
  if (buffer.subarray(0, 1024).indexOf('%PDF') === -1) return { status: 400, body: { ok: false, message: 'Only PDF files can be attached (this file is not a PDF).' } };

  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const existing = db.prepare('SELECT * FROM attachments WHERE cin = ? AND form_type = ? AND slot = ?').all(cin, formType, slot);
  // The same file uploaded again for the same slot: keep the one already stored.
  const same = existing.find(r => r.sha256 === sha256 && absPath(r.path) && fs.existsSync(absPath(r.path)));
  if (same) {
    const meta = toMeta(same);
    return { status: 200, body: { ok: true, attachment: meta, duplicate: true, replaced: [], warning: meta.warning } };
  }

  const id = `att_${crypto.randomUUID()}`;
  const rel = `${cin}/${id}-${safeName(fileName)}`;
  const abs = absPath(rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buffer);
  const mime = 'application/pdf';
  try {
    db.prepare(`INSERT INTO attachments (id, cin, job_id, form_type, slot, file_name, mime, size, sha256, path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, cin, jobId, formType, slot, fileName, mime, buffer.length, sha256, rel);
  } catch (err) {
    removeFile(rel);
    throw err;
  }
  // (a) is one file per company and form: the new one replaces the previous.
  const replaced = [];
  if (slot === 'a') {
    for (const r of existing) {
      db.prepare('DELETE FROM attachments WHERE id = ?').run(r.id);
      removeFile(r.path);
      replaced.push(r.id);
    }
  }
  const meta = toMeta(db.prepare('SELECT * FROM attachments WHERE id = ?').get(id));
  return { status: 201, body: { ok: true, attachment: meta, replaced, warning: meta.warning } };
}

/** Removes the row and its file. true when it existed. */
export function deleteAttachment(db, id) {
  ensureTable(db);
  const r = db.prepare('SELECT * FROM attachments WHERE id = ?').get(String(id || ''));
  if (!r) return false;
  db.prepare('DELETE FROM attachments WHERE id = ?').run(r.id);
  removeFile(r.path);
  return true;
}

// ───────── origin guard ─────────
// These routes carry a client's signed financial statements, so only the dashboard and the extension may use them:
// any other web page open in the CA's browser while the backend runs must not list, download or delete them (CINs are
// public). Allowed: http(s)://localhost / 127.0.0.1 on any port (the Vite dashboard), chrome-extension:// origins
// (restricted to G8_EXTENSION_IDS when set), and the comma-separated G8_ALLOWED_ORIGINS. No Origin header (curl,
// local scripts, same-origin navigation) is allowed.
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;
const EXT_ORIGIN = /^chrome-extension:\/\/([a-p]{32})$/;
const envList = name => String(process.env[name] || '').split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);

/** true when a request with this Origin header may use the sensitive routes. */
export function originAllowed(origin) {
  if (origin === undefined || origin === null || origin === '') return true;
  const o = String(origin).trim().replace(/\/+$/, '');
  if (LOCAL_ORIGIN.test(o)) return true;
  const ext = EXT_ORIGIN.exec(o);
  if (ext) { const ids = envList('G8_EXTENSION_IDS'); return !ids.length || ids.includes(ext[1]); }
  return envList('G8_ALLOWED_ORIGINS').includes(o);
}

/**
 * Answers 403 for a foreign origin (returns false). For an allowed one, rewrites the server-wide
 * "Access-Control-Allow-Origin: *" of every response on `res` to that origin only (none without an Origin header).
 */
export function guardOrigin(req, res, sendJson) {
  const origin = req?.headers?.origin;
  if (!originAllowed(origin)) {
    sendJson(res, 403, { ok: false, code: 'ORIGIN_NOT_ALLOWED', message: 'This page may not use the Germin8 attachment and AI routes.' });
    return false;
  }
  if (res && typeof res.writeHead === 'function' && !res.__g8OriginGuard) {
    const orig = res.writeHead;
    res.__g8OriginGuard = true;
    res.writeHead = function (status, ...rest) {
      const h = rest.find(x => x && typeof x === 'object' && !Array.isArray(x));
      if (h) {
        for (const k of Object.keys(h)) if (k.toLowerCase() === 'access-control-allow-origin') delete h[k];
        if (origin) { h['Access-Control-Allow-Origin'] = String(origin); h.Vary = 'Origin'; }
      }
      return orig.call(this, status, ...rest);
    };
  }
  return true;
}

// RFC 6266 header: an ASCII fallback plus the UTF-8 name.
function disposition(name) {
  const n = String(name || 'document.pdf');
  const ascii = n.replace(/[^\x20-\x7e]+/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(n)}`;
}

export async function handle(req, res, ctx) {
  const { pathname, method, db, sendJson, parseJsonBody, url } = ctx;
  if (pathname !== '/api/attachments' && !pathname.startsWith('/api/attachments/')) return false;
  if (!guardOrigin(req, res, sendJson)) return true;

  if (pathname === '/api/attachments') {
    if (method === 'GET') {
      const cin = String(url.searchParams.get('cin') || '').trim().toUpperCase();
      const formType = String(url.searchParams.get('formType') || 'aoc4').trim().toLowerCase();
      if (!CIN_RE.test(cin)) { sendJson(res, 400, { ok: false, message: 'cin is required (a valid 21-character CIN).' }); return true; }
      if (!FORM_RE.test(formType)) { sendJson(res, 400, { ok: false, message: 'Unknown form type.' }); return true; }
      sendJson(res, 200, { ok: true, cin, formType, attachments: listAttachments(db, cin, formType) });
      return true;
    }
    if (method === 'POST') {
      let body;
      try { body = await parseJsonBody(req); } catch (err) {
        sendJson(res, /too large/i.test(err.message) ? 413 : 400, { ok: false, message: /too large/i.test(err.message) ? 'The file is too large.' : 'Invalid request.' });
        return true;
      }
      const r = saveAttachment(db, body);
      sendJson(res, r.status, r.body);
      return true;
    }
    sendJson(res, 405, { ok: false, message: 'Method not allowed' });
    return true;
  }

  const m = pathname.match(/^\/api\/attachments\/([^/]+)(\/content)?$/);
  if (!m || !ID_RE.test(m[1])) { sendJson(res, 404, { ok: false, message: 'Attachment not found' }); return true; }
  const [, id, content] = m;
  if (content && method === 'GET') {
    const a = readAttachment(db, id);
    if (!a) { sendJson(res, 404, { ok: false, message: 'Attachment not found' }); return true; }
    res.writeHead(200, {
      'Content-Type': a.mime || 'application/pdf',
      'Content-Length': a.buffer.length,
      'Content-Disposition': disposition(a.fileName),
      'Access-Control-Expose-Headers': 'Content-Disposition',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(a.buffer);
    return true;
  }
  if (!content && method === 'DELETE') {
    const ok = deleteAttachment(db, id);
    sendJson(res, ok ? 200 : 404, ok ? { ok: true, id } : { ok: false, message: 'Attachment not found' });
    return true;
  }
  if (!content && method === 'GET') {
    ensureTable(db);
    const r = db.prepare('SELECT * FROM attachments WHERE id = ?').get(id);
    sendJson(res, r ? 200 : 404, r ? { ok: true, attachment: toMeta(r) } : { ok: false, message: 'Attachment not found' });
    return true;
  }
  sendJson(res, 405, { ok: false, message: 'Method not allowed' });
  return true;
}
