// Routes for: report-ai — AI reads the company's documents for the report-only fields of the AOC-4 linked forms.
// ctx: { url, pathname, method, db, sendJson, parseJsonBody }. Returns true when the request was handled.
//
// POST /api/aoc4/report-ai { cin, jobId?, attachmentId? | base64? | text?, save?:false, refresh?:false, formTypes?:[] }
//   → { ok, cin, source:{kind, fileName}, model, cached, opinionType,
//       proposals:[{formType, key, label, value, quote, page, current, currentLabel, action:'fill'|'replace-test'|'keep'}],
//       dropped:[{formType,key,reason}], saved?, skipped? }
//   Uses the company's (a) attachment (Page 2 of the dashboard) unless a PDF/text is given.
// POST /api/aoc4/report-ai/save { cin, items:[{formType, key, value, quote, page, force?}] } → { ok, saved, skipped }
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readDocument, buildProposals, saveItems, FORM_TYPES } from '../report-ai.js';
import { guardOrigin } from './attachments.js';

const CIN_RE = /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;
const MAX_PDF_BYTES = 15 * 1024 * 1024;
const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const NO_ATTACHMENT_MSG = 'Upload the (a) PDF on Page 2 first (financial statements + auditor\'s report + Board\'s report, one PDF) — the AI reads it from there.';

// Part B's helpers (routes/attachments.js) when they exist; otherwise the same table/folder read directly.
let helpers;
async function attachmentHelpers() {
  if (helpers === undefined) {
    try {
      const m = await import('./attachments.js');
      helpers = typeof m.listAttachments === 'function' && typeof m.readAttachment === 'function' ? m : null;
    } catch { helpers = null; }
  }
  return helpers;
}

function hasTable(db) {
  try { return !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'attachments'").get(); } catch { return false; }
}

async function listAtt(db, cin) {
  const h = await attachmentHelpers();
  if (h) return h.listAttachments(db, cin, 'aoc4') || [];
  if (!hasTable(db)) return [];
  return db.prepare("SELECT * FROM attachments WHERE cin = ? AND COALESCE(form_type, 'aoc4') = 'aoc4' ORDER BY created_at DESC").all(cin);
}

async function readAtt(db, id) {
  const h = await attachmentHelpers();
  if (h) return h.readAttachment(db, id);
  if (!hasTable(db)) return null;
  const row = db.prepare('SELECT * FROM attachments WHERE id = ?').get(id);
  if (!row || !row.path) return null;
  const tries = path.isAbsolute(row.path) ? [row.path]
    : [path.resolve(BACKEND_DIR, row.path), path.resolve(BACKEND_DIR, 'data', 'attachments', row.path)];
  const file = tries.find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } });
  if (!file) return null;
  return { fileName: row.file_name, mime: row.mime, buffer: fs.readFileSync(file), cin: row.cin };
}

const slotOf = a => String(a?.slot ?? '').toLowerCase();
const isPdf = buf => !!buf && buf.length > 4 && buf.subarray(0, 1024).indexOf('%PDF') !== -1;

/** Picks the document to read: {input, source} or {error:{status, code, message}}. */
async function pickDocument(db, cin, body) {
  if (body.base64) {
    const buf = Buffer.from(String(body.base64).replace(/^data:[^,]*,/, ''), 'base64');
    if (!isPdf(buf)) return { error: { status: 400, code: 'NOT_PDF', message: 'Only a PDF can be read — the file given is not a PDF.' } };
    if (buf.length > MAX_PDF_BYTES) return { error: { status: 413, code: 'TOO_LARGE', message: 'The PDF is over 15 MB — too large to read in one go.' } };
    return { input: { pdfBase64: buf.toString('base64') }, source: { kind: 'upload', fileName: String(body.fileName || 'document.pdf').slice(0, 200) } };
  }
  if (typeof body.text === 'string' && body.text.trim()) {
    return { input: { text: body.text.slice(0, 400000) }, source: { kind: 'text', fileName: null } };
  }
  let id = body.attachmentId ? String(body.attachmentId) : '';
  let listed = null;
  if (!id) {
    const list = await listAtt(db, cin);
    listed = list.find(a => slotOf(a) === 'a');
    if (!listed) return { error: { status: 404, code: 'NO_ATTACHMENT', message: NO_ATTACHMENT_MSG } };
    id = String(listed.id);
  }
  const att = await readAtt(db, id);
  if (!att || !att.buffer) return { error: { status: 404, code: 'NO_ATTACHMENT', message: body.attachmentId ? 'That attachment was not found — upload it again on Page 2.' : NO_ATTACHMENT_MSG } };
  if (att.cin && String(att.cin).toUpperCase() !== cin) return { error: { status: 400, code: 'WRONG_COMPANY', message: 'That attachment belongs to another company.' } };
  if (!isPdf(att.buffer)) return { error: { status: 400, code: 'NOT_PDF', message: 'The (a) attachment is not a readable PDF — upload it again on Page 2.' } };
  if (att.buffer.length > MAX_PDF_BYTES) return { error: { status: 413, code: 'TOO_LARGE', message: 'The (a) PDF is over 15 MB — too large to read in one go.' } };
  return { input: { pdfBase64: att.buffer.toString('base64') }, source: { kind: 'attachment', id, fileName: att.fileName || listed?.file_name || listed?.fileName || null } };
}

export async function handle(req, res, ctx) {
  const { pathname, method, db, sendJson, parseJsonBody } = ctx;
  if (method !== 'POST' || (pathname !== '/api/aoc4/report-ai' && pathname !== '/api/aoc4/report-ai/save')) return false;
  // Paid AI calls on a client's documents: only the dashboard / extension origins (see attachments.js).
  if (!guardOrigin(req, res, sendJson)) return true;

  let body;
  try { body = (await parseJsonBody(req)) || {}; } catch (err) { sendJson(res, 400, { ok: false, message: err.message || 'Bad JSON' }); return true; }
  const cin = String(body.cin || '').trim().toUpperCase();
  if (!CIN_RE.test(cin)) { sendJson(res, 400, { ok: false, message: 'A valid CIN is required — enter it on Page 1 first.' }); return true; }

  if (pathname === '/api/aoc4/report-ai/save') {
    if (!Array.isArray(body.items) || !body.items.length) { sendJson(res, 400, { ok: false, message: 'Nothing selected to save.' }); return true; }
    if (body.items.length > 200) { sendJson(res, 400, { ok: false, message: 'Too many items in one save.' }); return true; }
    const tooLong = body.items.find(it => JSON.stringify(it?.value ?? '').length > 200000);
    if (tooLong) { sendJson(res, 413, { ok: false, message: `The value for ${tooLong.key} is too long — nothing was saved.` }); return true; }
    const r = saveItems(db, cin, body.items);
    sendJson(res, 200, { ok: true, saved: r.saved.length, savedItems: r.saved, skipped: r.skipped });
    return true;
  }

  const doc = await pickDocument(db, cin, body);
  if (doc.error) { sendJson(res, doc.error.status, { ok: false, code: doc.error.code, message: doc.error.message }); return true; }

  let read;
  try {
    read = await readDocument(doc.input, { refresh: !!body.refresh });
  } catch (err) {
    console.warn('[report-ai] reading failed:', err.message);       // never the document itself
    const timeout = /within \d+s/.test(err.message);
    sendJson(res, timeout ? 504 : 502, { ok: false, code: timeout ? 'TIMEOUT' : 'AI_FAILED',
      message: timeout ? 'The AI took too long to read the document. Try again in a minute.' : `The AI could not read the document: ${err.message}` });
    return true;
  }

  const want = Array.isArray(body.formTypes) && body.formTypes.length ? new Set(body.formTypes.filter(f => FORM_TYPES.includes(f))) : null;
  const findings = want ? read.findings.filter(f => want.has(f.formType)) : read.findings;
  const proposals = buildProposals(db, cin, findings);
  const reply = {
    ok: true, cin, jobId: body.jobId || null, source: doc.source, model: read.model, cached: read.cached,
    opinionType: read.opinionType, proposals, dropped: want ? read.dropped.filter(d => want.has(d.formType)) : read.dropped,
  };
  if (body.save) {
    const items = proposals.filter(p => p.action === 'fill' || p.action === 'replace-test');
    const r = saveItems(db, cin, items);
    reply.saved = r.saved.length; reply.skipped = r.skipped;
  }
  sendJson(res, 200, reply);
  return true;
}
