// AI for report-only fields (backend/routes/report-ai.js): reads the company's (a) attachment PDF and proposes
// values for the Auditor's report, Board's report, AOC-2 and the AOC-4 declaration, each with a quote and page.
import { API_ORIGIN } from './api.js';

const BASE = `${API_ORIGIN}/api/aoc4/report-ai`;

async function post(url, body, signal) {
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw Object.assign(new Error('The Germin8 backend is not reachable — start it and try again.'), { code: 'OFFLINE' });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw Object.assign(new Error(data.message || `The backend answered ${res.status}`), { code: data.code || `HTTP_${res.status}`, status: res.status });
  }
  return data;
}

/**
 * @param {{cin:string, jobId?:string, formTypes?:string[], refresh?:boolean, attachmentId?:string}} opts
 * @returns {Promise<{proposals:Array, dropped:Array, opinionType:string|null, source:object, cached:boolean, model:string}>}
 */
export function readReportFields({ cin, jobId, formTypes, refresh = false, attachmentId } = {}, signal) {
  return post(BASE, { cin, jobId, formTypes, refresh, attachmentId, save: false }, signal);
}

/** items: [{formType, key, value, quote, page, force?}] → {saved, skipped:[{formType,key,reason}]} */
export function saveReportFields(cin, items) {
  return post(`${BASE}/save`, { cin, items });
}
