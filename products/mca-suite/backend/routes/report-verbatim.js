// Routes for: report-verbatim — the EXACT text of the signed auditor's / Board's report for the AOC-4 linked forms.
// ctx: { url, pathname, method, db, sendJson, parseJsonBody }. Returns true when the request was handled.
//
// POST /api/report-text/transcribe { cin?, base64 | docxBase64 | text, fileName?, pages?:[from,to]|"1-6", refresh? }
//   → { ok, kind:'pdf'|'docx'|'text', sha256, pages:[{page,text}], text, cached, model, warnings, pageCount }
//   A scanned PDF is transcribed word for word by Claude (cached by sha256 in report_texts); a .docx is read
//   directly (no AI); text is passed through. `text` carries "=== Page N ===" markers for a PDF.
// POST /api/report-text/split { cin, text, kind:'auditor'|'board'|'auto', save?:false, force?:false }
//   → { ok, kinds, opinionType, sections:{eauditor:{KEY:{value,heading,page}}, eboard:{…}}, missingHeadings, lengths,
//       warnings, notes, actions?, saved?, skipped? }   (rule-based, no AI; save:true writes company answers)
import { createHash } from 'node:crypto';
import { transcribePdf, splitReport, saveVerbatim, plannedActions } from '../report-verbatim.js';
import { docxToText, DocxError, isZip } from '../docx-text.js';
import { guardOrigin } from './attachments.js';

const CIN_RE = /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_TEXT = 400000;
const isPdf = buf => !!buf && buf.length > 4 && buf.subarray(0, 1024).indexOf('%PDF') !== -1;
const sha = x => createHash('sha256').update(x).digest('hex');

async function transcribe(body, db, sendJson, res) {
  const cin = String(body.cin || '').trim().toUpperCase();
  const fileName = String(body.fileName || '').slice(0, 260);
  if (typeof body.text === 'string' && body.text.trim() && !body.base64 && !body.docxBase64) {
    const text = body.text.slice(0, MAX_TEXT);
    sendJson(res, 200, { ok: true, kind: 'text', sha256: sha(text), pages: [{ page: null, text }], text, cached: false, model: null, warnings: [], pageCount: null });
    return;
  }
  const b64 = String(body.docxBase64 || body.base64 || '').replace(/^data:[^,]*,/, '');
  if (!b64) { sendJson(res, 400, { ok: false, message: 'Send the report as base64 (PDF or .docx) or as text.' }); return; }
  const buf = Buffer.from(b64, 'base64');
  if (buf.length > MAX_BYTES) { sendJson(res, 413, { ok: false, code: 'TOO_LARGE', message: 'The file is over 15 MB — too large to read in one go.' }); return; }
  if (body.docxBase64 || /\.docx$/i.test(fileName) || (isZip(buf) && !isPdf(buf))) {
    try {
      const d = docxToText(buf);
      const warnings = [];
      if (d.numbered) warnings.push(`${d.numbered} paragraph(s) use Word's automatic numbering: those numbers are not in the text — check them against the report.`);
      if (d.truncated) warnings.push('Only the first 400 KB of text was read.');
      sendJson(res, 200, { ok: true, kind: 'docx', sha256: sha(buf), pages: [{ page: null, text: d.text }], text: d.text, cached: false, model: null, warnings, pageCount: null });
    } catch (err) {
      sendJson(res, 400, { ok: false, code: 'BAD_DOCX', message: err instanceof DocxError ? err.message : 'This .docx file could not be read.' });
    }
    return;
  }
  if (!isPdf(buf)) { sendJson(res, 400, { ok: false, code: 'NOT_SUPPORTED', message: 'Only a PDF or a .docx report can be read here.' }); return; }
  try {
    const r = await transcribePdf(b64, { pages: body.pages, refresh: !!body.refresh, db, cin: CIN_RE.test(cin) ? cin : null });
    sendJson(res, 200, { ok: true, kind: 'pdf', ...r });
  } catch (err) {
    console.warn('[report-verbatim] transcription failed:', err.message);     // never the document itself
    if (/pages must be|has only/.test(err.message)) { sendJson(res, 400, { ok: false, code: 'BAD_PAGES', message: err.message }); return; }
    const timeout = /within \d+s/.test(err.message);
    sendJson(res, timeout ? 504 : 502, { ok: false, code: timeout ? 'TIMEOUT' : 'AI_FAILED',
      message: timeout ? 'The transcription took too long. Try fewer pages, or again in a minute.' : `The report could not be transcribed: ${err.message}` });
  }
}

function split(body, db, sendJson, res) {
  const cin = String(body.cin || '').trim().toUpperCase();
  const cinOk = CIN_RE.test(cin);
  if (body.save && !cinOk) { sendJson(res, 400, { ok: false, message: 'A valid CIN is required to save the report text.' }); return; }
  const text = typeof body.text === 'string' ? body.text.slice(0, MAX_TEXT) : '';
  if (!text.trim()) { sendJson(res, 400, { ok: false, message: 'text (the report text) is required.' }); return; }
  const kind = ['auditor', 'board', 'auto'].includes(body.kind) ? body.kind : 'auto';
  const r = splitReport(text, kind);
  const reply = { ok: true, cin: cinOk ? cin : null, kinds: r.kinds, opinionType: r.opinionType, sections: r.sections,
    missingHeadings: r.missingHeadings, lengths: r.lengths, warnings: r.warnings, notes: r.notes };
  if (cinOk) reply.actions = plannedActions(db, cin, r.sections);
  if (body.save) {
    const s = saveVerbatim(db, cin, r.sections, { force: !!body.force });
    reply.saved = s.saved; reply.skipped = s.skipped;
    reply.actions = plannedActions(db, cin, r.sections);
  }
  sendJson(res, 200, reply);
}

export async function handle(req, res, ctx) {
  const { pathname, method, db, sendJson, parseJsonBody } = ctx;
  if (pathname !== '/api/report-text/transcribe' && pathname !== '/api/report-text/split') return false;
  if (method !== 'POST') { sendJson(res, 405, { ok: false, message: 'Use POST' }); return true; }
  // Paid AI calls on a client's documents: only the dashboard / extension origins (see attachments.js).
  if (!guardOrigin(req, res, sendJson)) return true;
  let body;
  try { body = (await parseJsonBody(req)) || {}; } catch (err) { sendJson(res, 400, { ok: false, message: err.message || 'Bad JSON' }); return true; }
  if (pathname === '/api/report-text/transcribe') await transcribe(body, db, sendJson, res);
  else split(body, db, sendJson, res);
  return true;
}
