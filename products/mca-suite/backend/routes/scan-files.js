// Multi-file scanner helpers.
//   POST /api/scan/xlsx-text {fileName, base64} -> {ok, text, sheets:[{name, rows}], truncated}
// ctx: { url, pathname, method, db, sendJson, parseJsonBody }. Returns true when the request was handled.

import { xlsxToText, XlsxError } from '../xlsx-text.js';

const MAX_BYTES = 15 * 1024 * 1024;

export async function handle(req, res, ctx) {
  const { pathname, method, sendJson, parseJsonBody } = ctx;
  if (pathname !== '/api/scan/xlsx-text') return false;
  if (method !== 'POST') {
    sendJson(res, 405, { ok: false, message: 'Use POST' });
    return true;
  }
  let body;
  try { body = await parseJsonBody(req); } catch (err) {
    sendJson(res, 400, { ok: false, message: err.message || 'Invalid request body' });
    return true;
  }
  const fileName = String(body?.fileName || '').slice(0, 260);
  const b64 = String(body?.base64 || '').replace(/^data:[^,]*,/, '');
  if (!b64) {
    sendJson(res, 400, { ok: false, message: 'base64 (the Excel file) is required' });
    return true;
  }
  if (/\.xls$/i.test(fileName)) {
    sendJson(res, 400, { ok: false, message: 'Old .xls files are not supported. Save it as .xlsx and upload again.' });
    return true;
  }
  const buf = Buffer.from(b64, 'base64');
  if (buf.length > MAX_BYTES) {
    sendJson(res, 413, { ok: false, message: 'Excel file is larger than 15 MB' });
    return true;
  }
  try {
    const { text, sheets, truncated } = xlsxToText(buf);
    if (!text.trim() || sheets.every(s => s.rows === 0)) {
      sendJson(res, 422, { ok: false, message: 'No cell values found in this workbook.', sheets });
      return true;
    }
    sendJson(res, 200, { ok: true, fileName, text, sheets, truncated });
  } catch (err) {
    const known = err instanceof XlsxError;
    sendJson(res, known ? 400 : 500, { ok: false, message: known ? err.message : 'Could not read the Excel file. Save it as .xlsx and try again.' });
  }
  return true;
}
