// Verbatim report text (backend/routes/report-verbatim.js): the signed auditor's / Board's report is transcribed word
// for word (scanned PDF: Claude; .docx: read directly) and split by its headings into the "Extract of Auditor's report"
// and "Extract of Board's report" answers. Rule-based split, no summarising.
import { API_ORIGIN } from './api.js';

const BASE = `${API_ORIGIN}/api/report-text`;

async function post(url, body) {
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error('The Germin8 backend is not reachable — start it and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.message || `The backend answered ${res.status}`);
  return data;
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

/** {cin, base64|docxBase64, fileName, pages?, refresh?} → {kind, sha256, pages, text, cached, warnings, pageCount} */
export const transcribeReport = body => post(`${BASE}/transcribe`, body);

/** {cin, text, kind, save?, force?} → {sections, missingHeadings, lengths, warnings, notes, actions, saved?, skipped?} */
export const splitReportText = body => post(`${BASE}/split`, body);
