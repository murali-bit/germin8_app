// Multi-file scanner: read several documents (PDF, images, Excel, text) for one e-form and merge
// the extracted fields into ONE form, remembering which file each value came from.
//
// Merge priority and the rounded-PDF / exact-Excel rule: see scanMerge.js.

import { API_ORIGIN } from './api';
import { KINDS } from './scanMerge.js';

const GATEWAY = `${API_ORIGIN}/api/gateway/claude`;
const XLSX_API = `${API_ORIGIN}/api/scan/xlsx-text`;

// Files go to the backend as base64 inside JSON (4/3 larger) and the backend refuses bodies over 20 MB.
export const MAX_FILE_BYTES = 14 * 1024 * 1024;
export const MAX_FILE_MB = 14;
export const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.xlsx,.xlsm,.docx';

// kind -> priority rank (lower wins) and a short label for the UI
export { KINDS };

/** 'pdf' | 'image' | 'xlsx' | 'text' | 'report' (.docx: read only for its verbatim text, not scanned) | null (unsupported) */
export function fileKind(file) {
  const name = String(file?.name || '').toLowerCase();
  const type = String(file?.type || '').toLowerCase();
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (/^image\/(png|jpe?g|webp)$/.test(type) || /\.(png|jpe?g|webp)$/.test(name)) return 'image';
  if (/\.(xlsx|xlsm)$/.test(name)) return 'xlsx';
  if (/\.(txt|csv)$/.test(name) || type.startsWith('text/')) return 'text';
  if (/\.docx$/.test(name)) return 'report';
  return null;
}

/** Why a file cannot be scanned, or null. */
export function fileProblem(file) {
  const name = String(file?.name || '');
  if (/\.xls$/i.test(name)) return 'Old .xls files are not supported — save it as .xlsx.';
  if (/\.doc$/i.test(name)) return 'Old .doc files are not supported — save it as .docx.';
  if (!fileKind(file)) return 'Unsupported type — use PDF, PNG, JPG, WEBP, XLSX, TXT, CSV or DOCX.';
  if (file.size > MAX_FILE_BYTES) return `${(file.size / 1048576).toFixed(1)} MB — the limit is ${MAX_FILE_MB} MB.`;
  if (file.size === 0) return 'The file is empty.';
  return null;
}

/** Identity used to avoid scanning the same file twice. */
export const fileHash = f => `${f.name}|${f.size}|${f.lastModified || 0}`;

function readFile(file, as) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(as === 'base64' ? String(reader.result).split(',')[1] : reader.result);
    reader.onerror = () => reject(new Error('Could not read the file'));
    if (as === 'base64') reader.readAsDataURL(file); else reader.readAsText(file);
  });
}

async function postJson(url, body) {
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch (err) {
    throw new Error(err?.message === 'Failed to fetch' ? `Backend not reachable on ${API_ORIGIN} — is it running?` : (err?.message || 'Network error'));
  }
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  if (!json) throw new Error(`Backend answered ${res.status} without data`);
  return json;
}

/** Excel workbook -> text ({ok, text, sheets}). */
export async function xlsxToText(file) {
  const json = await postJson(XLSX_API, { fileName: file.name, base64: await readFile(file, 'base64') });
  if (!json.ok) throw new Error(json.message || 'Could not read the Excel file');
  return json;
}

// The text extraction reads at most this much (backend/gateway.js: 120k characters for AOC-4, 15k for the others):
// sending more only costs upload time, and what is cut is reported to the CA instead of silently ignored.
export const textCap = formType => (/^AOC-4/i.test(String(formType)) ? 115000 : 14500);

/**
 * Scan one file with the existing extraction calls. Returns the gateway JSON
 * ({ok, schema, extractedFields, model, fieldLabels, fieldGroups, ...}) plus `kind` and `seconds`.
 */
export async function scanFile(file, formType) {
  const kind = fileKind(file);
  const problem = fileProblem(file);
  if (problem) throw new Error(problem);
  if (kind === 'report') throw new Error('A Word report is not scanned for figures — its text is read under "Report text (verbatim)".');
  const t0 = Date.now();
  let json;
  let note;
  if (kind === 'pdf' || kind === 'image') {
    const mimeType = file.type || (kind === 'pdf' ? 'application/pdf' : `image/${file.name.split('.').pop().toLowerCase().replace('jpg', 'jpeg')}`);
    json = await postJson(`${GATEWAY}/vision`, { fileBase64: await readFile(file, 'base64'), mimeType, formType });
  } else {
    let text;
    let body;
    const cap = textCap(formType);
    if (kind === 'xlsx') {
      const x = await xlsxToText(file);
      const head = `Excel workbook "${file.name}" (sheets: ${x.sheets.map(s => s.name).join(', ')}). Amounts are as typed in the cells; ` +
        `Excel dates are day-serial numbers (days since 30/12/1899).\n\n`;
      body = String(x.text || '');
      if (body.length > cap - head.length || x.truncated) {
        body = body.slice(0, Math.max(0, cap - head.length));
        const all = x.sheets.length;
        const read = (body.match(/^=== Sheet: /gm) || []).length;
        note = `Only part of this workbook was read (${read} of ${all} sheet${all === 1 ? '' : 's'}, the rest is too long). Upload the sheets you need as a separate .xlsx if fields are missing.`;
      }
      text = head + body;
    } else {
      text = String(await readFile(file, 'text'));
      if (text.length > cap) {
        text = text.slice(0, cap);
        note = `Only the first ${Math.round(cap / 1000)}k characters of this file were read.`;
      }
    }
    if (!String(text).trim()) throw new Error('The file has no text');
    json = await postJson(`${GATEWAY}/extract`, { text, formType });
  }
  if (!json.ok || !json.extractedFields) throw new Error(json.message || 'Extraction returned no data');
  // AOC-4 needs the AI's structured reading; a plain keyword fallback must never be merged into the form.
  if (/^AOC-4/i.test(String(formType)) && json.schema !== 'aoc4-client') throw new Error('AI extraction unavailable — try this file again in a minute.');
  return { ...json, kind, note, seconds: Math.round((Date.now() - t0) / 1000) };
}

// ─── merge ─────────────────────────────────────────────────────────────────────
// The merge is pure and lives in scanMerge.js (node tests import it directly).
export { mergeScans, sameValue, pathKey, getIn, unitOfFields, isScaledAmount, managerialMoves } from './scanMerge.js';
