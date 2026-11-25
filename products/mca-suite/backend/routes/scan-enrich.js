// Company records for the AOC-4 scanner (spec v6).
//   POST /api/company/resolve-cin {name}            -> {ok, cin, source:'company records'|'filesure'|null, candidates:[{name,cin}]}
//   POST /api/scan/enrich {formType:'AOC-4', data, meta} -> {ok, data, meta, sources, checks}
//   GET  /api/audit-firms/:frn                       -> {ok, firm:{frn, pan, name}|null}
//   PUT  /api/audit-firms/:frn {pan, name}           -> {ok, firm}
// ctx: { pathname, method, db, sendJson, parseJsonBody, filesureResolve? }. Returns true when the request was handled.
// Values only ever come from the DB (clients, earlier jobs, saved scans, company answers, ADT-1 drafts, audit
// firms) or FileSure; nothing is guessed.

import { enrichAoc4, normaliseCompanyName, PAN_RE, SRN_RE } from '../aoc4-enrich.js';

export const AUDIT_FIRMS_DDL = `
  -- Audit firms remembered by ICAI firm registration number (FRN): the firm PAN is typed once and reused
  -- for every client of that firm.
  CREATE TABLE IF NOT EXISTS audit_firms (
    frn TEXT PRIMARY KEY,
    pan TEXT,
    name TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`;

// ICAI firm registration numbers: 6 digits + region letter (e.g. 000000S), or a letter + 5-6 digits (LLPs).
export const FRN_RE = /^(\d{6}[A-Z]|[A-Z]\d{5,6})$/;   // same rule as extension/js/validation/validators.js
export const normFrn = frn => String(frn || '').trim().toUpperCase().replace(/\s+/g, '');

const parse = s => { try { return JSON.parse(s); } catch { return null; } };
const cinIn = v => { const m = String(v || '').toUpperCase().match(/[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}/); return m ? m[0] : ''; };
const hasTable = (db, name) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
const rows = (db, table, sql, ...args) => (hasTable(db, table) ? db.prepare(sql).all(...args) : []);

// Every (name, CIN) pair the DB knows, newest first where there is a date.
function knownCompanies(db) {
  const out = [];
  const add = (name, cin) => { cin = cinIn(cin); if (name && cin) out.push({ name: String(name).trim(), cin }); };
  for (const r of rows(db, 'clients', 'SELECT name, cin FROM clients')) add(r.name, r.cin);
  for (const r of rows(db, 'extension_jobs', 'SELECT client_id, client_name, payload FROM extension_jobs ORDER BY updated_at DESC')) {
    const p = parse(r.payload) || {};
    const cin = p.general?.CIN || p.cin || p.CIN || r.client_id;
    for (const n of [r.client_name, p.general?.COMPANY_NAME, p.companyNameFilingDate, p.companyNameFyEnd, p.companyName]) add(n, cin);
  }
  for (const r of rows(db, 'saved_scans', 'SELECT company_name, cin FROM saved_scans ORDER BY updated_at DESC')) add(r.company_name, r.cin);
  return out;
}

/** CIN for a company name from the DB: exact match after normalising the name. */
export function resolveCinFromRecords(db, name) {
  const key = normaliseCompanyName(name);
  if (!key) return { cin: null, candidates: [] };
  const seen = new Map();
  for (const c of knownCompanies(db)) if (normaliseCompanyName(c.name) === key && !seen.has(c.cin)) seen.set(c.cin, c);
  const candidates = [...seen.values()];
  return { cin: candidates.length === 1 ? candidates[0].cin : null, candidates };
}

/** FileSure name search replies differ by version; collect any {name, cin} objects found in it. */
export function parseFilesureCandidates(reply) {
  const out = [];
  const visit = (v, depth) => {
    if (!v || depth > 4) return;
    if (Array.isArray(v)) { for (const x of v) visit(x, depth + 1); return; }
    if (typeof v !== 'object') return;
    const cin = cinIn(v.cin || v.CIN || v.company_cin || v.companyCin);
    const name = v.name || v.company_name || v.companyName || v.COMPANY_NAME || v.company;
    if (cin && typeof name === 'string') out.push({ name: name.trim(), cin });
    for (const x of Object.values(v)) if (x && typeof x === 'object') visit(x, depth + 1);
  };
  visit(reply, 0);
  const seen = new Set();
  return out.filter(c => (seen.has(c.cin) ? false : seen.add(c.cin)));
}

async function defaultFilesure() {
  const { filesureResolve } = await import('../gateway.js');
  return filesureResolve;
}

/** Records first, then FileSure (only an exact name match is taken; others are candidates). */
export async function resolveCin(db, name, { filesureResolve, timeoutMs = 8000 } = {}) {
  const rec = resolveCinFromRecords(db, name);
  if (rec.cin) return { cin: rec.cin, source: 'company records', candidates: rec.candidates };
  let candidates = rec.candidates;
  const search = filesureResolve === undefined ? await defaultFilesure().catch(() => null) : filesureResolve;
  if (typeof search === 'function' && String(name || '').trim()) {
    try {
      const reply = await Promise.race([
        search(String(name).trim()),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs).unref?.()),
      ]);
      const found = parseFilesureCandidates(reply);
      const key = normaliseCompanyName(name);
      const exact = found.filter(c => normaliseCompanyName(c.name) === key);
      if (exact.length === 1) return { cin: exact[0].cin, source: 'filesure', candidates: exact };
      candidates = [...candidates, ...found.filter(f => !candidates.some(c => c.cin === f.cin))].slice(0, 10);
    } catch { /* FileSure not configured or not reachable: records only */ }
  }
  return { cin: null, source: null, candidates };
}

const frnOf = p => normFrn(p?.auditor?.AUDITOR_FIRM_REG);

// The appointed firm's FRN in an ADT-1 payload / result (any nesting up to 3 levels; never the vacating firm's).
function adtFrnOf(obj) {
  let found = '';
  const visit = (v, depth) => {
    if (found || !v || typeof v !== 'object' || depth > 3) return;
    for (const [k, x] of Object.entries(v)) {
      if (found) return;
      if (/vacat|previous|old/i.test(k)) continue;
      if (typeof x === 'string' && /^(firmRegistrationNumber|AUDITOR_FIRM_REG|frn|firmRegNo)$/i.test(k) && normFrn(x)) { found = normFrn(x); return; }
      if (x && typeof x === 'object') visit(x, depth + 1);
    }
  };
  visit(obj, 0);
  return found;
}

const isAdt1 = t => String(t || '').replace(/[^a-z0-9]/gi, '').toUpperCase() === 'ADT1';

/**
 * ADT-1 SRN for a company from company answers, its ADT-1 filing (job result) or earlier AOC-4 jobs.
 * A record of a different audit firm is skipped; when the firm cannot be compared the SRN comes back with
 * `uncertain: true` (enrich marks it "to check"). ADT-1 drafts are not used: an unfiled draft has no SRN of its
 * own, and its other SRN fields (INC-28, ADT-3 …) belong to other forms.
 */
export function findAdtSrnInRecords(db, { cin, frn } = {}) {
  cin = cinIn(cin);
  frn = normFrn(frn);
  if (!cin) return null;
  const sameFirm = other => (!frn || !other ? null : other === frn);   // null: cannot be compared
  const answerFrn = normFrn(rows(db, 'company_answers', "SELECT value FROM company_answers WHERE cin = ? AND field_key IN ('AUDITOR_FIRM_REG', 'firmRegistrationNumber') ORDER BY updated_at DESC", cin)[0]?.value);
  for (const r of rows(db, 'company_answers', "SELECT value FROM company_answers WHERE cin = ? AND field_key IN ('ADT_SRN', 'ADT1_SRN') ORDER BY updated_at DESC", cin)) {
    const v = String(r.value || '').trim().toUpperCase();
    if (!SRN_RE.test(v)) continue;
    const same = sameFirm(answerFrn);
    if (same === false) break;   // the saved answer belongs to the earlier auditor
    return { srn: v, from: 'company answers', uncertain: same !== true };
  }
  for (const r of rows(db, 'extension_jobs', 'SELECT client_id, payload, result, form_type FROM extension_jobs ORDER BY updated_at DESC')) {
    const p = parse(r.payload) || {};
    if (cinIn(p.general?.CIN || p.cin || p.CIN || r.client_id) !== cin) continue;
    if (isAdt1(r.form_type)) {
      const res = parse(r.result) || {};
      const v = String(res.srn || res.SRN || '').trim().toUpperCase();
      if (!SRN_RE.test(v)) continue;
      const same = sameFirm(adtFrnOf(p) || adtFrnOf(res));
      if (same === false) continue;   // a different auditor's appointment
      return { srn: v, from: 'the ADT-1 filing', uncertain: same !== true };
    }
    if (/adt/i.test(r.form_type || '')) continue;   // ADT-3 etc.: not an appointment
    const v = String(p.auditor?.ADT_SRN || '').trim().toUpperCase();
    if (!SRN_RE.test(v)) continue;
    const same = sameFirm(frnOf(p));
    if (same === false) continue;   // a different auditor's appointment
    return { srn: v, from: 'an earlier AOC-4 filing', uncertain: same !== true };
  }
  return null;
}

export function getAuditFirm(db, frn) {
  frn = normFrn(frn);
  if (!frn || !hasTable(db, 'audit_firms')) return null;
  const r = db.prepare('SELECT frn, pan, name FROM audit_firms WHERE frn = ?').get(frn);
  return r ? { frn: r.frn, pan: r.pan || '', name: r.name || '' } : null;
}

export function saveAuditFirm(db, frn, { pan, name } = {}) {
  frn = normFrn(frn);
  pan = String(pan || '').trim().toUpperCase();
  db.exec(AUDIT_FIRMS_DDL);
  db.prepare(`INSERT INTO audit_firms (frn, pan, name, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(frn) DO UPDATE SET pan = excluded.pan, name = COALESCE(NULLIF(excluded.name, ''), audit_firms.name), updated_at = CURRENT_TIMESTAMP`)
    .run(frn, pan, String(name || '').trim());
  return getAuditFirm(db, frn);
}

/** Firm PAN for an FRN: the audit firms table, else an earlier AOC-4 job / company answer of the same firm. */
export function firmPanFromRecords(db, frn) {
  frn = normFrn(frn);
  if (!frn) return null;
  const firm = getAuditFirm(db, frn);
  if (firm && PAN_RE.test(firm.pan)) return { pan: firm.pan, name: firm.name, from: 'audit firms' };
  const cins = new Set();
  for (const r of rows(db, 'extension_jobs', 'SELECT client_id, payload FROM extension_jobs ORDER BY updated_at DESC')) {
    const p = parse(r.payload) || {};
    if (frnOf(p) !== frn) continue;
    const pan = String(p.auditor?.AUDITOR_PAN || '').trim().toUpperCase();
    if (PAN_RE.test(pan)) return { pan, name: p.auditor?.AUDITOR_NAME || '', from: 'an earlier AOC-4 filing' };
    const cin = cinIn(p.general?.CIN || r.client_id);
    if (cin) cins.add(cin);
  }
  for (const cin of cins) {
    for (const r of rows(db, 'company_answers', "SELECT value FROM company_answers WHERE cin = ? AND field_key = 'AUDITOR_PAN' ORDER BY updated_at DESC", cin)) {
      const pan = String(r.value || '').trim().toUpperCase();
      if (PAN_RE.test(pan)) return { pan, from: 'company answers' };
    }
  }
  return null;
}

export function makeLookups(db, opts = {}) {
  return {
    resolveCin: name => resolveCin(db, name, opts),
    findAdtSrn: q => findAdtSrnInRecords(db, q),
    firmPan: frn => firmPanFromRecords(db, frn),
  };
}

// Origins allowed to write audit-firm data: local dashboards, plus DASHBOARD_ORIGIN (comma-separated) when deployed.
// A request without an Origin header (curl, server-side, tests) is not a browser cross-site write.
export function writeOriginAllowed(req, extra = process.env.DASHBOARD_ORIGIN) {
  const origin = String(req?.headers?.origin || '').trim();
  if (!origin) return true;
  let u;
  try { u = new URL(origin); } catch { return false; }
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname) || u.hostname.endsWith('.localhost')) return true;
  return String(extra || '').split(',').map(x => x.trim().replace(/\/+$/, '')).filter(Boolean).includes(u.origin);
}

async function body(req, ctx, res) {
  try { return (await ctx.parseJsonBody(req)) || {}; } catch (err) {
    ctx.sendJson(res, 400, { ok: false, message: err.message || 'Invalid request body' });
    return null;
  }
}

export async function handle(req, res, ctx) {
  const { pathname, method, db, sendJson } = ctx;
  const opts = 'filesureResolve' in ctx ? { filesureResolve: ctx.filesureResolve } : {};

  if (pathname === '/api/company/resolve-cin') {
    if (method !== 'POST') { sendJson(res, 405, { ok: false, message: 'Use POST' }); return true; }
    const b = await body(req, ctx, res);
    if (!b) return true;
    const name = String(b.name || '').trim().slice(0, 300);
    if (!name) { sendJson(res, 400, { ok: false, message: 'name is required' }); return true; }
    try {
      const r = await resolveCin(db, name, opts);
      sendJson(res, 200, { ok: true, cin: r.cin, source: r.source, candidates: r.candidates });
    } catch (err) {
      sendJson(res, 500, { ok: false, message: err.message || 'Lookup failed' });
    }
    return true;
  }

  if (pathname === '/api/scan/enrich') {
    if (method !== 'POST') { sendJson(res, 405, { ok: false, message: 'Use POST' }); return true; }
    const b = await body(req, ctx, res);
    if (!b) return true;
    if (String(b.formType || '').replace(/[^a-z0-9]/gi, '').toUpperCase() !== 'AOC4') {
      sendJson(res, 400, { ok: false, message: 'Only formType AOC-4 can be enriched' });
      return true;
    }
    if (!b.data || typeof b.data !== 'object' || Array.isArray(b.data)) {
      sendJson(res, 400, { ok: false, message: 'data (the merged scan) is required' });
      return true;
    }
    try {
      const out = await enrichAoc4(b.data, b.meta && typeof b.meta === 'object' ? b.meta : (b.data.meta || {}), makeLookups(db, opts));
      sendJson(res, 200, { ok: true, ...out });
    } catch (err) {
      sendJson(res, 500, { ok: false, message: err.message || 'Enrich failed' });
    }
    return true;
  }

  const m = pathname.match(/^\/api\/audit-firms\/([^/]+)$/);
  if (m) {
    let frn;
    try { frn = normFrn(decodeURIComponent(m[1])); } catch { frn = ''; }
    if (!FRN_RE.test(frn)) { sendJson(res, 400, { ok: false, message: 'Invalid firm registration number' }); return true; }
    if (method === 'GET') {
      sendJson(res, 200, { ok: true, firm: getAuditFirm(db, frn) });
      return true;
    }
    if (method === 'PUT') {
      if (!writeOriginAllowed(req)) { sendJson(res, 403, { ok: false, message: 'Audit firm details can only be saved from the dashboard' }); return true; }
      const b = await body(req, ctx, res);
      if (!b) return true;
      const pan = String(b.pan || '').trim().toUpperCase();
      if (!PAN_RE.test(pan)) { sendJson(res, 400, { ok: false, message: 'PAN must be 5 letters, 4 digits and a letter (e.g. ABCDE1234F)' }); return true; }
      sendJson(res, 200, { ok: true, firm: saveAuditFirm(db, frn, { pan, name: String(b.name || '').slice(0, 200) }) });
      return true;
    }
    sendJson(res, 405, { ok: false, message: 'Use GET or PUT' });
    return true;
  }
  return false;
}

