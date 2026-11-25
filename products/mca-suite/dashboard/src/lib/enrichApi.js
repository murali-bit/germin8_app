// After the merge, the backend fills what the documents do not print, from company records and rules
// (CIN, ADT-1 SRN, auditor firm PAN, district, break-up balancing, AS-18 totals…) and lists what to check.
// Contract (spec v6): POST /api/scan/enrich, POST /api/company/resolve-cin, GET/PUT /api/audit-firms/:frn.
// Any failure leaves the scan as it is: callers show one warning.

import { API_ORIGIN } from './api';

export const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
const OWN_META = ['sources', 'sourceTypes', 'conflicts', 'roundingChoices', 'files', 'enrichSources', 'checks', 'resolvedChecks'];

async function call(method, path, body) {
  let res;
  try {
    res = await fetch(`${API_ORIGIN}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new Error(err?.message === 'Failed to fetch' ? `Backend not reachable on ${API_ORIGIN}` : (err?.message || 'Network error'));
  }
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  if (res.status === 404 && !json?.ok) throw Object.assign(new Error('not available on this backend yet'), { status: 404 });
  if (!res.ok || !json?.ok) throw Object.assign(new Error(json?.message || json?.error || `Backend answered ${res.status}`), { status: res.status });
  return json;
}

/**
 * Enrich a merged scan. `data` is the scanner's object (with data.meta).
 * @returns {Promise<{data: object, sources: object, checks: object[]}>}  data has the backend's meta merged in
 *   (the dashboard's own meta keys — files, conflicts, sourceTypes… — are kept when the backend omits them).
 */
export async function enrichScan(formType, data) {
  const { meta = {}, ...fields } = data || {};
  const json = await call('POST', '/api/scan/enrich', { formType, data: fields, meta });
  if (!json.data || typeof json.data !== 'object') throw new Error('The enrich step returned no data');
  const { meta: innerMeta, ...outFields } = json.data;
  const outMeta = { ...meta, ...(innerMeta || {}), ...(json.meta || {}) };
  // The merge's own bookkeeping (file names per path, document/excel, conflicts…) is the dashboard's.
  for (const k of OWN_META) if (meta[k] !== undefined) outMeta[k] = meta[k];
  return {
    data: { ...outFields, meta: outMeta },
    sources: json.sources && typeof json.sources === 'object' ? json.sources : {},
    checks: Array.isArray(json.checks) ? json.checks : [],
  };
}

/** CIN for a company name from company records / FileSure: {cin, source, candidates}. */
export async function resolveCin(name) {
  const json = await call('POST', '/api/company/resolve-cin', { name });
  return { cin: json.cin || null, source: json.source || null, candidates: Array.isArray(json.candidates) ? json.candidates : [] };
}

/** The remembered firm (PAN) for an audit firm registration number, or null. */
export async function getAuditFirm(frn) {
  const json = await call('GET', `/api/audit-firms/${encodeURIComponent(String(frn).trim())}`);
  return json.firm || null;
}

/** Remember an audit firm's PAN (and name) under its FRN, for every client of that firm. */
export async function saveAuditFirm(frn, { pan, name }) {
  return call('PUT', `/api/audit-firms/${encodeURIComponent(String(frn).trim())}`, { pan, name: name || undefined });
}
