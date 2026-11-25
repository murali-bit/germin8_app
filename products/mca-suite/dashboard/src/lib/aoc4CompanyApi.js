// AOC-4 filings grouped by company, and "+ New company": CIN lookup (FileSure gateway) and creating an empty
// AOC-4 filing job with the same payload shape the scanner pushes ({ general: { CIN, COMPANY_NAME, FY_FROM, FY_TO } }).
import { listRecentJobs, getJob, lookupCinGateway, pushToExtension } from './api.js';

export const CIN_RE = /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;
const CLIENT_ID_RE = /^([lu]\d{5}[a-z]{2}\d{4}[a-z]{3}\d{6})_(\d{2})(\d{2})(\d{4})$/i;
const LAST_JOB_KEY = 'aoc4.lastJobId';

export const normCin = s => String(s || '').trim().toUpperCase().replace(/\s+/g, '');

// "31/03/2026" → "31032026" (the clientId suffix used by existing jobs)
export const fyKey = ddmmyyyy => String(ddmmyyyy || '').replace(/\D/g, '');

export function cinProblem(cin) {
  const c = normCin(cin);
  if (!c) return 'Enter the CIN.';
  if (c.length !== 21) return `A CIN has 21 characters — this one has ${c.length}.`;
  if (!CIN_RE.test(c)) return 'That is not a valid CIN. It looks like U12345MH2020PTC000001: L or U, 5 digits, 2 letters, 4 digits, 3 letters, 6 digits.';
  return null;
}

// Default financial year by today's date: 01/04/<last year> – 31/03/<this year>.
export function defaultFy(today = new Date()) {
  const y = today.getFullYear();
  return { from: `01/04/${y - 1}`, to: `31/03/${y}` };
}

// DD/MM/YYYY (or D-M-YYYY / YYYY-MM-DD) → DD/MM/YYYY, or null when it is not a real date.
export function toDdMmYyyy(s) {
  const t = String(s || '').trim();
  let m = t.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  let d, mo, y;
  if (m) [, d, mo, y] = m;
  else if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) [, y, mo, d] = m;
  else return null;
  const dt = new Date(Date.UTC(+y, +mo - 1, +d));
  if (dt.getUTCFullYear() !== +y || dt.getUTCMonth() !== +mo - 1 || dt.getUTCDate() !== +d) return null;
  return `${String(d).padStart(2, '0')}/${String(mo).padStart(2, '0')}/${y}`;
}

const dateValue = ddmmyyyy => {
  const m = String(ddmmyyyy || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) : NaN;
};

export function fyProblem(from, to) {
  const f = toDdMmYyyy(from), t = toDdMmYyyy(to);
  if (!f) return 'Enter the start of the financial year as DD/MM/YYYY.';
  if (!t) return 'Enter the end of the financial year as DD/MM/YYYY.';
  if (dateValue(t) <= dateValue(f)) return 'The financial year must end after it starts.';
  return null;
}

const cleanName = s => String(s || '').replace(/\s*\(AOC-4\)\s*$/i, '').replace(/\s*—\s*AOC-4\s*$/i, '').trim();

// ───────────────────────── last opened job ─────────────────────────

export function getLastJobId() {
  try { return localStorage.getItem(LAST_JOB_KEY) || ''; } catch { return ''; }
}
export function setLastJobId(id) {
  try { if (id) localStorage.setItem(LAST_JOB_KEY, id); else localStorage.removeItem(LAST_JOB_KEY); } catch { /* storage blocked */ }
}

// ───────────────────────── filings list ─────────────────────────

function describe(job, payload) {
  const m = String(job.client_id || '').match(CLIENT_ID_RE);
  const g = (payload && payload.general) || {};
  const cin = normCin(g.CIN) || (m ? m[1].toUpperCase() : '');
  const fyTo = toDdMmYyyy(g.FY_TO) || (m ? `${m[2]}/${m[3]}/${m[4]}` : '');
  const companyName = String(g.COMPANY_NAME || '').trim() || cleanName(job.client_name) || cleanName(payload?.displayName) || '';
  return {
    id: job.id,
    status: String(job.status || '').toLowerCase(),
    createdAt: job.created_at || '',
    updatedAt: job.updated_at || '',
    clientId: job.client_id || '',
    cin,
    fyTo,
    companyName,
  };
}

// Every AOC-4 job the backend returns (newest first) as { id, status, createdAt, cin, fyTo, companyName }.
// CIN and FY end come from the clientId ('<cin>_<ddmmyyyy>'); jobs with another clientId are opened to read them.
export async function listAoc4Filings() {
  const res = await listRecentJobs({ formType: 'aoc4', limit: 500 });
  const jobs = (res?.jobs || (Array.isArray(res) ? res : []))
    .filter(j => String(j.form_type || j.formType || '').toLowerCase() === 'aoc4');
  const out = await Promise.all(jobs.map(async j => {
    if (CLIENT_ID_RE.test(String(j.client_id || '')) && j.client_name) return describe(j, null);
    try {
      const full = (await getJob(j.id))?.job;
      let payload = full?.payload;
      if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch { payload = null; } }
      return describe(j, payload);
    } catch {
      return describe(j, null);
    }
  }));
  return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

// One job → the same shape (for a job that is not in the recent list).
export async function describeJob(id) {
  const full = (await getJob(id))?.job;
  if (!full) return null;
  let payload = full.payload;
  if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch { payload = null; } }
  return { ...describe(full, payload), formType: String(full.form_type || '').toLowerCase() };
}

// Groups filings by CIN (or by name when there is no CIN), newest company first.
export function groupByCompany(filings) {
  const groups = new Map();
  for (const f of filings) {
    const key = f.cin || `name:${f.companyName.toLowerCase()}` || f.id;
    if (!groups.has(key)) groups.set(key, { key, cin: f.cin, companyName: f.companyName, filings: [] });
    const g = groups.get(key);
    if (!g.companyName && f.companyName) g.companyName = f.companyName;
    g.filings.push(f);
  }
  return [...groups.values()];
}

// A filing that is not cancelled for the same CIN and FY end, or null.
export function findDuplicate(filings, cin, fyTo) {
  const c = normCin(cin), t = toDdMmYyyy(fyTo);
  return filings.find(f => f.status !== 'cancelled' && f.cin === c && f.fyTo === t) || null;
}

// ───────────────────────── CIN lookup ─────────────────────────

const normKey = k => String(k).toLowerCase().replace(/[^a-z0-9]/g, '');

// Finds the first non-empty scalar under any of the keys (case/underscore-insensitive), searching nested objects.
function pick(obj, keys, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 5) return '';
  const wanted = keys.map(normKey);
  for (const [k, v] of Object.entries(obj)) {
    if (wanted.includes(normKey(k)) && v != null && typeof v !== 'object' && String(v).trim()) return String(v).trim();
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const r = pick(v, keys, depth + 1);
      if (r) return r;
    }
  }
  return '';
}

function joinAddress(obj) {
  const direct = pick(obj, ['registeredAddress', 'registered_office_address', 'registeredOfficeAddress', 'address', 'fullAddress', 'regAddress']);
  if (direct) return direct;
  const parts = ['addressLine1', 'address_line1', 'line1', 'addressLine2', 'address_line2', 'line2', 'city', 'district', 'state', 'pincode', 'pin']
    .map(k => pick(obj, [k])).filter(Boolean);
  return [...new Set(parts)].join(', ');
}

// Backend / gateway messages are for developers; the CA sees plain English.
function plainLookupError(raw) {
  if (raw) console.warn('[aoc4] company lookup failed:', raw);
  const m = String(raw || '');
  if (!m || /not configured|G8_GATEWAY|Failed to fetch|NetworkError|status 5\d\d|gateway|timeout|ECONN/i.test(m)) {
    return 'The company lookup service is not available right now';
  }
  if (/not found|no (company|record)|invalid cin/i.test(m)) return 'No company was found for this CIN';
  return 'The company lookup service is not available right now';
}

// { ok, details: { companyName, registeredAddress, email, companyClass, companyCategory, status }, error }
export async function lookupCompany(cin) {
  try {
    const res = await lookupCinGateway(normCin(cin));
    if (res && res.ok === false) return { ok: false, error: plainLookupError(res.message) };
    const body = res?.data ?? res;
    const details = {
      companyName: pick(body, ['companyName', 'company_name', 'name', 'entityName', 'entity_name', 'legalName']),
      registeredAddress: joinAddress(body),
      email: pick(body, ['email', 'emailId', 'email_id', 'emailAddress', 'companyEmail']),
      companyClass: pick(body, ['classOfCompany', 'class_of_company', 'companyClass', 'company_class', 'class']),
      companyCategory: pick(body, ['companyCategory', 'company_category', 'category', 'categoryOfCompany']),
      status: pick(body, ['companyStatus', 'company_status', 'status']),
    };
    if (!details.companyName) return { ok: false, details, error: 'No company details came back for this CIN.' };
    return { ok: true, details };
  } catch (err) {
    return { ok: false, error: plainLookupError(err?.message) };
  }
}

// ───────────────────────── create ─────────────────────────

// Creates an empty AOC-4 filing for the company. Returns the new job id.
export async function createAoc4Filing({ cin, fyFrom, fyTo, details = {} }) {
  const c = normCin(cin);
  const from = toDdMmYyyy(fyFrom), to = toDdMmYyyy(fyTo);
  const name = String(details.companyName || '').trim();
  const general = { CIN: c, COMPANY_NAME: name, FY_FROM: from, FY_TO: to };
  if (details.registeredAddress) general.REGISTERED_ADDRESS = details.registeredAddress;
  if (details.email) general.COMPANY_EMAIL = details.email;
  if (details.companyClass) general.COMPANY_CLASS = details.companyClass;
  if (details.companyCategory) general.COMPANY_CATEGORY = details.companyCategory;
  const clientId = `${c.toLowerCase()}_${fyKey(to)}`;
  const res = await pushToExtension({
    formType: 'aoc4',
    clientId,
    clientName: `${name || c} (AOC-4)`,
    payload: { general, clientId, displayName: `${name || c} — AOC-4`, source: 'germin8-new-company' },
  });
  if (!res?.jobId) throw new Error(res?.message || 'The filing could not be created.');
  return res.jobId;
}
