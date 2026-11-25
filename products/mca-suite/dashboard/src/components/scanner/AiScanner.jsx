import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Download,
  FileText, Plus, RefreshCw, Send, Trash2, Upload, XCircle,
} from 'lucide-react';
import clsx from 'clsx';
import {
  API_ORIGIN, getJob, listRecentJobs, pushToExtension, suggestNpcs, updateExtensionJob, updateJobPayload,
} from '../../lib/api';
import {
  ACCEPT, KINDS, MAX_FILE_MB, fileHash, fileKind, fileProblem, getIn, managerialMoves, mergeScans, scanFile,
} from '../../lib/scanFilesApi';
import { PAN_RE, enrichScan, resolveCin, saveAuditFirm } from '../../lib/enrichApi';
import ScanChecks, { SourceKindTag } from './ScanChecks';
import ReportVerbatimPanel from './ReportVerbatimPanel';
import NpcsPicker from '../npcs/NpcsPicker';
import {
  getSavedExtensionConfig, sendAoc4ClientToExtension, sendDraftToExtension,
} from '../../lib/extensionConnector';

const CIN_RE = /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;

const FORMS = [
  { id: 'AOC-4', label: 'AOC-4 (Financial Statements)', ext: 'aoc4', code: 'AOC-4', hint: 'Audited financial statements: audit report, balance sheet, P&L and notes' },
  { id: 'ADT-1', label: 'ADT-1 (Auditor Appointment)', ext: 'adt1', code: 'ADT-1', hint: 'AGM / board resolution and auditor consent letter' },
  { id: 'MGT-7', label: 'MGT-7 (Annual Return)', ext: 'mgt7', code: 'MGT-7', hint: 'Annual return draft, incorporation certificate, AGM notice' },
  { id: 'DIR-3 KYC', label: 'DIR-3 KYC', ext: 'dir3', code: 'DIR-3-KYC', hint: 'Director PAN, Aadhaar and address proof' },
];

// ─── NPCS service type (AOC-4 Segment IV) ────────────────────────────────────
const NPCS_PATHS = ['CATEGORY_CODE', 'CATEGORY_DESC', 'HIGHEST_CODE', 'HIGHEST_DESC'].map(k => `principalProducts.${k}`);

// What the company does, as text for the NPCS suggester.
function npcsText(d) {
  const pp = d?.principalProducts || {};
  const parts = [pp.BUSINESS_ACTIVITY, pp.REVENUE_LINES, pp.HIGHEST_DESC, pp.CATEGORY_DESC].map(x => String(x || '').trim()).filter(Boolean);
  return [...new Set(parts)].join('. ');
}

// After a scan: when the document printed no NPCS codes, pre-fill them from the best suggestion and mark
// them "to check" (meta.uncertain) with meta.npcsSuggested, so the CA confirms before pushing.
// `cache` ({text, top}) keeps the last answer: a re-merge with the same activity text does not ask the AI again.
async function withNpcsSuggestion(d, cache) {
  const pp = d?.principalProducts;
  if (!pp || (String(pp.CATEGORY_CODE || '').trim() && String(pp.HIGHEST_CODE || '').trim())) return d;
  const text = npcsText(d);
  if (!text) return d;
  try {
    let top;
    if (cache && cache.text === text) top = cache.top;
    else {
      const r = await suggestNpcs(text, 6, { useAi: true });
      top = r.suggestions?.[0];
      if (cache) { cache.text = text; cache.top = top; }
    }
    if (!top) return d;
    const next = structuredClone(d);
    const p = next.principalProducts;
    const filled = [];
    const set = (k, v) => { if (!String(p[k] ?? '').trim() && v) { p[k] = v; filled.push(`principalProducts.${k}`); } };
    const catCode = String(p.CATEGORY_CODE || '').trim();
    if (!String(p.HIGHEST_CODE || '').trim() && (!catCode || catCode === top.category)) {
      set('HIGHEST_CODE', top.code);
      set('HIGHEST_DESC', top.desc);
    }
    set('CATEGORY_CODE', top.category);
    set('TOTAL_CATEGORIES', '1');
    if (String(p.CATEGORY_CODE) === top.category) set('CATEGORY_DESC', top.categoryDesc);
    if (!filled.length) return d;
    const meta = { ...(next.meta || {}) };
    meta.uncertain = [...new Set([...(meta.uncertain || []), ...filled])];
    meta.npcsSuggested = { fields: filled, code: top.code, category: top.category, from: text.slice(0, 300) };
    next.meta = meta;
    return next;
  } catch {
    return d; // backend NPCS unavailable: leave the codes for the CA
  }
}

const AOC4_SECTIONS = [
  ['general', 'General Information'],
  ['signatoriesFS', 'Signatories — Financial Statements'],
  ['signatoriesBR', "Signatories — Board's Report"],
  ['auditor', 'Auditor Details'],
  ['balanceSheet', 'Balance Sheet'],
  ['profitLoss', 'Statement of Profit & Loss'],
  ['balanceSheetBreakup', 'Balance Sheet Break-up'],
  ['profitLossDetails', 'Profit & Loss Details'],
  ['foreignExchange', 'Foreign Exchange Earnings & Outgo'],
  ['shareCapital', 'Share Capital'],
  ['shareholders', 'Shareholders (above 5%)'],
  ['shareCapitalRaised', 'Share Capital Raised During the Year'],
  ['financialParametersBS', 'Financial Parameters — Balance Sheet'],
  ['financialParametersPL', 'Financial Parameters — Profit & Loss'],
  ['principalProducts', 'Principal Products / Services'],
  ['industry', 'Industry & Reporting'],
  ['subsidiary', 'Subsidiary / Joint Venture'],
  ['relatedParty', 'Related Party Transactions'],
  ['auditorReport', "Auditor's Report"],
  ['csr', 'CSR'],
  ['secretarialAudit', 'Secretarial Audit'],
  ['costRecords', 'Cost Records'],
];
const NON_FIELD_KEYS = new Set(['meta', 'clientId', 'displayName', 'source', 'scaleNote']);

const LIAB_KEYS = ['SHARE_CAPITAL', 'RESERVES_SURPLUS', 'MONEY_AGAINST_WARRANTS', 'SHARE_APP_PENDING', 'LONG_TERM_BORROWINGS',
  'DEFERRED_TAX_LIAB', 'OTHER_LONG_TERM_LIAB', 'LONG_TERM_PROVISIONS', 'SHORT_TERM_BORROWINGS', 'TRADE_PAYABLES_MSME',
  'TRADE_PAYABLES_OTHER', 'OTHER_CURRENT_LIAB', 'SHORT_TERM_PROVISIONS'];
const ASSET_KEYS = ['PPE', 'INTANGIBLE_ASSETS', 'CWIP', 'INTANGIBLE_UNDER_DEV', 'NON_CURRENT_INVESTMENTS', 'DEFERRED_TAX_ASSETS',
  'LONG_TERM_LOANS_ADVANCES', 'OTHER_NON_CURRENT_ASSETS', 'CURRENT_INVESTMENTS', 'INVENTORIES', 'TRADE_RECEIVABLES',
  'CASH_EQUIVALENTS', 'SHORT_TERM_LOANS_ADVANCES', 'OTHER_CURRENT_ASSETS'];

const ACRONYMS = new Set(['CIN', 'PAN', 'DIN', 'FY', 'AGM', 'ADT', 'SRN', 'PPE', 'CWIP', 'MSME', 'EPS', 'UDIN', 'CSR',
  'PIN', 'BS', 'PL', 'FS', 'BR', 'JV', 'LT', 'ST', 'FP', 'CAG', 'DOB']);

function humanize(key) {
  const words = key.includes('_') ? key.split('_') : key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(' ');
  return words.filter(Boolean).map(w => (ACRONYMS.has(w.toUpperCase())
    ? w.toUpperCase()
    : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join(' ');
}

const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isEmpty = v => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
const fmtINR = v => (typeof v === 'number' ? v.toLocaleString('en-IN') : String(v ?? ''));

function setIn(obj, path, value) {
  const next = structuredClone(obj);
  let o = next;
  for (let i = 0; i < path.length - 1; i++) o = o[path[i]];
  o[path[path.length - 1]] = value;
  return next;
}

function pathKey(path) {
  return path.map((p, i) => (typeof p === 'number' ? `[${p}]` : (i ? `.${p}` : p))).join('');
}

function matchesAny(key, list) {
  return (list || []).some(p => key === p || key.startsWith(`${p}.`) || key.startsWith(`${p}[`));
}

function fieldStatus(path, value, meta, edited) {
  const key = pathKey(path);
  if (edited.has(key)) return 'edited';
  if (isEmpty(value)) return 'missing';
  if (matchesAny(key, meta?.uncertain)) return 'check';
  if (matchesAny(key, meta?.derived)) return 'derived';
  if (value === 0 && meta?.nil?.includes(key)) return 'nil';
  return 'found';
}

const STATUS_STYLE = {
  found: { label: 'Found', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  derived: { label: 'Derived', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  nil: { label: 'Nil', cls: 'bg-page text-ink-muted border-line' },
  check: { label: 'Check', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  missing: { label: 'Missing', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  edited: { label: 'Edited', cls: 'bg-gold-100 text-gold-800 border-gold-200' },
};

// Every editable leaf as { path, value } — drives stats, filters and checks.
function collectLeaves(data, schema) {
  const out = [];
  const walk = (v, path) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...path, i]));
    else if (isPlainObject(v)) Object.entries(v).forEach(([k, x]) => { if (!NON_FIELD_KEYS.has(k)) walk(x, [...path, k]); });
    else out.push({ path, value: v });
  };
  if (schema === 'aoc4-client') {
    Object.entries(data).forEach(([k, v]) => { if (!NON_FIELD_KEYS.has(k)) walk(v, [k]); });
  } else {
    walk(data, []);
  }
  return out;
}

function sumKeys(o, keys) {
  if (keys.some(k => typeof o?.[k] !== 'number' && o?.[k] !== null && o?.[k] !== undefined)) return null;
  return keys.reduce((s, k) => s + (o?.[k] || 0), 0);
}

function aoc4Checks(d) {
  const checks = [];
  const near = (a, b) => Math.abs(a - b) <= 1;
  const add = (label, a, b, describe) => {
    if (typeof a !== 'number' || typeof b !== 'number') {
      checks.push({ label, ok: null, detail: 'Not enough data to check' });
    } else {
      checks.push({ label, ok: near(a, b), detail: describe(fmtINR(a), fmtINR(b)) });
    }
  };
  const cin = d.general?.CIN || '';
  checks.push({ label: 'CIN format', ok: CIN_RE.test(cin), detail: cin || 'CIN missing' });
  for (const per of ['current', 'previous']) {
    const b = d.balanceSheet?.[per];
    if (!b) continue;
    add(`Balance sheet tallies (${per})`, b.TOTAL_ASSETS, b.TOTAL_EQUITY_LIABILITIES, (x, y) => `Assets ${x} vs Equity + Liabilities ${y}`);
    add(`Equity & liabilities add up (${per})`, sumKeys(b, LIAB_KEYS), b.TOTAL_EQUITY_LIABILITIES, (x, y) => `Lines ${x} vs total ${y}`);
    add(`Assets add up (${per})`, sumKeys(b, ASSET_KEYS), b.TOTAL_ASSETS, (x, y) => `Lines ${x} vs total ${y}`);
  }
  for (const per of ['current', 'previous']) {
    const p = d.profitLoss?.[per];
    if (!p) continue;
    add(`Total income (${per})`, sumKeys(p, ['REVENUE_OPERATIONS', 'OTHER_INCOME']), p.TOTAL_INCOME, (x, y) => `Revenue + other ${x} vs total ${y}`);
    add(`Profit before tax (${per})`, typeof p.TOTAL_INCOME === 'number' && typeof p.TOTAL_EXPENSES === 'number' ? p.TOTAL_INCOME - p.TOTAL_EXPENSES : null,
      p.PROFIT_BEFORE_TAX, (x, y) => `Income − expenses ${x} vs PBT ${y}`);
    add(`Profit after tax (${per})`, typeof p.PROFIT_BEFORE_TAX === 'number' && typeof p.TOTAL_TAX === 'number' ? p.PROFIT_BEFORE_TAX - p.TOTAL_TAX : null,
      p.PROFIT_AFTER_TAX, (x, y) => `PBT − tax ${x} vs PAT ${y}`);
  }
  add('Share capital matches paid-up', d.balanceSheet?.current?.SHARE_CAPITAL, d.shareCapital?.PAID_UP_NOMINAL, (x, y) => `Balance sheet ${x} vs note ${y}`);
  // MCA asks how revenue splits into manufactured / traded / services (domestic and export).
  const split = ['PL_DOMESTIC_MANUFACTURED', 'PL_DOMESTIC_TRADED', 'PL_DOMESTIC_SERVICES', 'PL_EXPORT_MANUFACTURED', 'PL_EXPORT_TRADED', 'PL_EXPORT_SERVICES'];
  const splitVals = split.map(k => d.profitLossDetails?.[k]?.current);
  add('Revenue split adds up to revenue (current)',
    splitVals.every(v => typeof v === 'number') ? splitVals.reduce((s, v) => s + v, 0) : null,
    d.profitLoss?.current?.REVENUE_OPERATIONS,
    (x, y) => `Manufactured + traded + services ${x} vs revenue ${y} — set the split in Profit & Loss Details`);
  const sigs = (d.signatoriesFS || []).filter(s => /^\d{8}$/.test(String(s.din || '').trim()));
  checks.push({ label: 'Financial statement signatory with DIN', ok: sigs.length > 0, detail: `${sigs.length} signatory(ies) with a valid 8-digit DIN` });
  return checks;
}

// What the extension needs before it will accept a push.
function pushBlocker(formId, data) {
  if (formId === 'AOC-4') return CIN_RE.test(data.general?.CIN || '') ? null : 'Enter a valid CIN in General Information first.';
  if (formId === 'ADT-1' || formId === 'MGT-7') return CIN_RE.test(String(data.cin || '').toUpperCase()) ? null : 'Enter a valid CIN first.';
  if (formId === 'DIR-3 KYC') return /^\d{8}$/.test(String(data.din || '')) ? null : 'Enter the 8-digit DIN first.';
  return null;
}

const JOBS_API = `${API_ORIGIN}/api/extension/jobs`;

// ─── Landing a scan in an AOC-4 filing job (Forms Hub, embedded mode) ───────
// FY end as ddmmyyyy ("31/03/2025", "2025-03-31" → "31032025"), the suffix of AOC-4 job client ids.
function fyEndDigits(v) {
  const t = String(v || '').trim();
  let m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[1].padStart(2, '0')}${m[2].padStart(2, '0')}${m[3]}`;
  m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[3].padStart(2, '0')}${m[2].padStart(2, '0')}${m[1]}`;
  return t.replace(/\D/g, '');
}

const isBlankValue = v => v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

// Scanned non-empty values fill or replace; a value already in the job stays only where the scan is empty.
// Objects are merged key by key; a list (signatories, shareholders…) is taken whole from the scan when it has rows.
function mergeScanIntoPayload(existing, scanned) {
  if (isPlainObject(existing) && isPlainObject(scanned)) {
    const out = { ...existing };
    for (const [k, v] of Object.entries(scanned)) out[k] = k in existing ? mergeScanIntoPayload(existing[k], v) : v;
    return out;
  }
  return isBlankValue(scanned) ? existing : scanned;
}

// The newest non-cancelled AOC-4 job for this CIN and FY end (a job that is not yet filled wins), with its payload.
async function findAoc4Job(cin, fyDigits) {
  const body = await listRecentJobs({ formType: 'aoc4', limit: 500 });
  const jobs = (body.jobs || []).filter(j => j.form_type === 'aoc4' && j.status !== 'cancelled');
  const wantId = `${cin.toLowerCase()}_${fyDigits}`;
  const ranked = [...jobs.filter(j => j.status !== 'filled'), ...jobs.filter(j => j.status === 'filled')];
  // Exact client id first (no payload download); otherwise look inside each payload (older ids differ).
  for (const j of ranked) {
    if (String(j.client_id || '').toLowerCase() === wantId) {
      const full = await getJob(j.id);
      if (full.ok) return full.job;
    }
  }
  // Payload fallback only for jobs whose client id is not the standard '<cin>_<ddmmyyyy>' form (those were checked above).
  const STD_ID = /^[lu]\d{5}[a-z]{2}\d{4}[a-z]{3}\d{6}_\d{8}$/i;
  const odd = ranked.filter(j => !STD_ID.test(String(j.client_id || '')));
  const fulls = await Promise.all(odd.map(j => getJob(j.id).then(b => (b.ok ? b.job : null)).catch(() => null)));
  return fulls.find(j => j && String(j.payload?.general?.CIN || '').trim().toUpperCase() === cin
    && fyEndDigits(j.payload?.general?.FY_TO) === fyDigits) || null;
}
const SCANS_API = `${API_ORIGIN}/api/scans`;
const SCAN_STATUS = {
  scanned: { label: 'Not reviewed', cls: 'bg-page text-ink-muted border-line' },
  reviewed: { label: 'Reviewed', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  pushed: { label: 'Pushed', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
};
const TERMINAL_JOB = new Set(['filled', 'cancelled']);
const EXT_FORM_LABEL = { aoc4: 'AOC-4', adt1: 'ADT-1', mgt7: 'MGT-7', mgt7a: 'MGT-7A', dir3: 'DIR-3 KYC', aoc4_offline: 'AOC-4 Offline', spice_a: 'SPICe+ A', inc32: 'INC-32' };

// What the extension last reported for a job (see extension/js/job-sync.js).
function describeJob(job) {
  const r = job.result || {};
  switch (job.status) {
    case 'ready': return { tone: 'gray', label: 'Queued', text: 'Waiting for the extension to load it' };
    case 'started': return { tone: 'gray', label: 'Loaded', text: 'Loaded in the extension — open the MCA form and start the fill' };
    case 'filling': return {
      tone: 'blue', label: 'Filling',
      text: `Filling: ${r.stepLabel || 'in progress'}${r.totalSteps ? ` (step ${job.phase} of ${r.totalSteps})` : ''}${r.message ? ` — ${r.message}` : ''}`,
    };
    case 'needs_attention': return { tone: 'amber', label: 'Needs attention', text: `Needs attention: ${r.message || r.stepLabel || 'check the extension side panel'}` };
    case 'filled': return { tone: 'green', label: 'Filled', text: 'Filled — review on MCA and submit yourself' };
    case 'cancelled': return { tone: 'gray', label: 'Cancelled', text: 'Cancelled' };
    default: return { tone: 'gray', label: job.status, text: job.status };
  }
}

const TONE = {
  gray: 'text-ink-muted bg-page border-line',
  blue: 'text-sky-700 bg-sky-50 border-sky-200',
  amber: 'text-amber-800 bg-amber-50 border-amber-200',
  green: 'text-emerald-700 bg-emerald-50 border-emerald-200',
};

function ageOf(ts) {
  const t = Date.parse(String(ts || '').replace(' ', 'T') + 'Z');
  if (!t) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

function downloadJson(obj, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ─── CELLS & SECTIONS ────────────────────────────────────────────────────────

function Cell({ value, onCommit, status, label, source }) {
  const numeric = typeof value === 'number';
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState('');
  const display = focused ? text : (numeric ? fmtINR(value) : (value ?? ''));

  const commit = () => {
    setFocused(false);
    const raw = text.trim();
    let next = raw;
    if (numeric || value === null) {
      const n = Number(raw.replace(/,/g, ''));
      next = raw === '' ? null : (Number.isNaN(n) ? raw : n);
    }
    if (next !== value) onCommit(next);
  };

  return (
    <input
      value={display}
      onFocus={() => { setFocused(true); setText(value === null || value === undefined ? '' : String(value)); }}
      onChange={e => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      placeholder="—"
      aria-label={label}
      title={source ? `From ${source}` : undefined}
      aria-invalid={status === 'missing' || undefined}
      className={clsx(
        'w-full px-2.5 py-1.5 text-xs text-ink rounded-lg border bg-white focus:outline-none focus:border-gold-600 focus:ring-2 focus:ring-gold-500 transition-colors',
        numeric && 'font-mono text-right',
        status === 'missing' ? 'border-rose-300 bg-rose-50/40' : status === 'check' ? 'border-amber-400 bg-amber-50/40' : 'border-line-input',
      )}
    />
  );
}

// Source tag: Excel / Company records / Worked out / Your answer when the value did not come straight from the
// document; otherwise the small "F2" tag (which uploaded file, only when several files were merged).
function SourceTag({ src, kind }) {
  if (kind) return <SourceKindTag kind={kind} file={kind === 'excel' ? src?.name : undefined} />;
  if (!src) return null;
  return (
    <span title={`From ${src.name}`} className="text-[9px] font-mono font-semibold px-1 py-px rounded border border-line bg-page text-ink-subtle shrink-0 cursor-help">
      F{src.n}<span className="sr-only"> — from {src.name}</span>
    </span>
  );
}

function StatusPill({ status }) {
  const s = STATUS_STYLE[status];
  return <span className={clsx('text-[10px] font-semibold px-1.5 py-0.5 rounded-md border whitespace-nowrap', s.cls)}>{s.label}</span>;
}

function sectionKind(value) {
  if (Array.isArray(value)) return 'array';
  if (!isPlainObject(value)) return 'scalar';
  if (isPlainObject(value.current) && isPlainObject(value.previous)) return 'period';
  const vals = Object.values(value);
  if (vals.length && vals.every(v => isPlainObject(v) && ('current' in v || 'previous' in v))) return 'pair';
  return 'flat';
}

function SectionBody({ sectionKey, value, ctx }) {
  const base = sectionKey ? [sectionKey] : [];
  const kind = sectionKind(value);
  const show = path => !ctx.reviewOnly || ['missing', 'check'].includes(ctx.statusOf(path));

  if (kind === 'flat') {
    const rows = Object.entries(value).filter(([k, v]) => !NON_FIELD_KEYS.has(k) && !isPlainObject(v) && !Array.isArray(v));
    return (
      <div className="divide-y divide-line">
        {rows.filter(([k]) => show([...base, k])).map(([k, v]) => (
          <div key={k} className="grid grid-cols-1 sm:grid-cols-[minmax(140px,220px)_1fr_64px] gap-1 sm:gap-3 px-4 py-2 sm:items-center">
            <span className="text-xs text-ink font-medium flex items-center gap-1.5">{ctx.labelOf(k)} <SourceTag src={ctx.sourceOf([...base, k])} kind={ctx.kindOf([...base, k])} /></span>
            <Cell value={v} label={ctx.labelOf(k)} status={ctx.statusOf([...base, k])} source={ctx.sourceOf([...base, k])?.name} onCommit={nv => ctx.update([...base, k], nv)} />
            <StatusPill status={ctx.statusOf([...base, k])} />
          </div>
        ))}
      </div>
    );
  }

  if (kind === 'period' || kind === 'pair') {
    const keys = kind === 'period'
      ? [...new Set([...Object.keys(value.current), ...Object.keys(value.previous)])].filter(k => !NON_FIELD_KEYS.has(k))
      : Object.keys(value);
    const cellPath = (k, per) => (kind === 'period' ? [...base, per, k] : [...base, k, per]);
    const cellVal = (k, per) => (kind === 'period' ? value[per]?.[k] : value[k]?.[per]);
    return (
      <div>
        <div className="grid grid-cols-[minmax(140px,1fr)_1fr_1fr] gap-3 px-4 py-2 bg-page text-[10px] font-semibold text-ink-muted uppercase tracking-wider">
          <span>Line item</span><span className="text-right">Current year</span><span className="text-right">Previous year</span>
        </div>
        <div className="divide-y divide-line">
          {keys.filter(k => show(cellPath(k, 'current')) || show(cellPath(k, 'previous'))).map(k => (
            <div key={k} className="grid grid-cols-[minmax(140px,1fr)_1fr_1fr] gap-3 px-4 py-2 items-center">
              <span className="text-xs text-ink font-medium">{ctx.labelOf(k)}</span>
              {['current', 'previous'].map(per => (
                <div key={per} className="flex items-center gap-1.5">
                  <Cell value={cellVal(k, per)} label={`${ctx.labelOf(k)} — ${per === 'current' ? 'current' : 'previous'} year`}
                    status={ctx.statusOf(cellPath(k, per))} source={ctx.sourceOf(cellPath(k, per))?.name} onCommit={nv => ctx.update(cellPath(k, per), nv)} />
                  <SourceTag src={ctx.sourceOf(cellPath(k, per))} kind={ctx.kindOf(cellPath(k, per))} />
                  {['missing', 'check', 'derived', 'edited'].includes(ctx.statusOf(cellPath(k, per))) && (
                    <>
                      <span aria-hidden="true" title={STATUS_STYLE[ctx.statusOf(cellPath(k, per))].label}
                        className={clsx('w-1.5 h-1.5 rounded-full shrink-0', {
                          missing: 'bg-rose-500', check: 'bg-amber-500', derived: 'bg-sky-500', edited: 'bg-gold-600',
                        }[ctx.statusOf(cellPath(k, per))])} />
                      <span className="sr-only">{STATUS_STYLE[ctx.statusOf(cellPath(k, per))].label}</span>
                    </>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (kind === 'array') {
    const cols = [...new Set(value.flatMap(r => (isPlainObject(r) ? Object.keys(r) : [])))];
    const blank = Object.fromEntries(cols.map(c => [c, typeof value[0]?.[c] === 'number' ? null : '']));
    return (
      <div className="px-4 py-3 space-y-2">
        {value.length === 0 && <p className="text-xs text-ink-subtle">No rows found in the document.</p>}
        {value.length > 0 && ctx.sourceOf(base) && <p className="text-[10px] text-ink-subtle">Rows from {ctx.sourceOf(base).name}</p>}
        <div className="overflow-x-auto -mx-4 px-4 space-y-2">
        {value.map((row, i) => (
          <div key={i} className="grid gap-2 items-center" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(120px,1fr)) 28px` }}>
            {cols.map(c => (
              <div key={c}>
                {i === 0 && <p className="text-[10px] text-ink-muted font-semibold uppercase tracking-wider mb-1">{humanize(c)}</p>}
                <Cell value={row[c]} label={`${humanize(c)} row ${i + 1}`} status={ctx.statusOf([...base, i, c])} onCommit={nv => ctx.update([...base, i, c], nv)} />
              </div>
            ))}
            <button onClick={() => ctx.update(base, value.filter((_, j) => j !== i))} title="Remove row" aria-label={`Remove row ${i + 1}`}
              className={clsx('p-1 text-ink-subtle hover:text-rose-700 cursor-pointer', i === 0 && 'mt-5')}>
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        </div>
        {cols.length > 0 && (
          <button onClick={() => ctx.update(base, [...value, { ...blank }])}
            className="text-[11px] font-semibold text-ink hover:underline flex items-center gap-1 cursor-pointer">
            <Plus className="w-3 h-3" /> Add row
          </button>
        )}
      </div>
    );
  }

  return null;
}

function Section({ title, sectionKey, value, ctx }) {
  const [open, setOpen] = useState(true);
  const leaves = collectLeaves(sectionKey ? { [sectionKey]: value } : value, sectionKey ? 'aoc4-client' : 'flat');
  const missing = leaves.filter(l => ctx.statusOf(l.path) === 'missing').length;
  const check = leaves.filter(l => ctx.statusOf(l.path) === 'check').length;
  if (ctx.reviewOnly && missing + check === 0) return null;
  return (
    <div className="bg-surface border border-line rounded-xl shadow-sm overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 px-4 py-3 hover:bg-gold-50/50 cursor-pointer text-left">
        {open ? <ChevronDown className="w-4 h-4 text-ink-muted" /> : <ChevronRight className="w-4 h-4 text-ink-muted" />}
        <span className="text-sm font-semibold text-ink flex-1">{title}</span>
        <span className="text-[11px] text-ink-muted font-mono">{leaves.length - missing}/{leaves.length} filled</span>
        {check > 0 && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200">{check} to check</span>}
        {missing > 0 && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-rose-50 text-rose-700 border border-rose-200">{missing} missing</span>}
      </button>
      {open && <div className="border-t border-line"><SectionBody sectionKey={sectionKey} value={value} ctx={ctx} /></div>}
    </div>
  );
}

// ─── FILE LIST ───────────────────────────────────────────────────────────────

const FILE_STATUS = {
  queued: { label: 'Queued', cls: 'bg-page text-ink-muted border-line' },
  reading: { label: 'Reading…', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  done: { label: 'Done', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  error: { label: 'Error', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
};
const fmtSize = b => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

function FileList({ files, busy, onRemove, onRetry, numbered }) {
  if (!files.length) return null;
  const done = files.filter(x => x.status === 'done');
  return (
    <ul className="divide-y divide-line">
      {files.map(f => {
        const st = FILE_STATUS[f.status] || FILE_STATUS.queued;
        return (
          <li key={f.id} className="px-4 py-2 flex items-center gap-3">
            {numbered && f.status === 'done'
              ? <span className="text-[10px] font-mono font-semibold px-1 py-px rounded border border-line bg-page text-ink-subtle shrink-0">F{done.indexOf(f) + 1}</span>
              : <FileText className="w-4 h-4 text-ink-muted shrink-0" />}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-ink truncate" title={f.name}>{f.name}</p>
              <p className="text-[11px] truncate text-ink-muted">
                {KINDS[f.kind]?.label || 'Unknown'}{f.size ? ` · ${fmtSize(f.size)}` : ''}
                {f.status === 'done' && f.seconds ? ` · ${f.seconds}s` : ''}
              </p>
              {f.error && <p className="text-[11px] text-rose-700 break-words">{f.error}</p>}
              {!f.error && f.note && <p className="text-[11px] text-amber-700 break-words">{f.note}</p>}
            </div>
            <span className={clsx('text-[10px] font-semibold px-2 py-0.5 rounded-md border whitespace-nowrap flex items-center gap-1', st.cls)}>
              {f.status === 'reading' && <RefreshCw className="w-3 h-3 animate-spin" />}{st.label}
            </span>
            {f.status === 'error' && f.file && !fileProblem(f.file) && (
              <button type="button" onClick={() => onRetry(f.id)} disabled={busy}
                className="text-[11px] font-semibold text-ink hover:underline cursor-pointer disabled:opacity-40">Retry</button>
            )}
            <button type="button" onClick={() => onRemove(f.id)} disabled={busy} title="Remove" aria-label={`Remove ${f.name}`}
              className="p-1 text-ink-subtle hover:text-rose-700 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

// embedded: shown inside the Forms Hub for one e-form (lockForm). There, "Save to AOC-4 filing" puts the
// reviewed data into the company's AOC-4 job (update if the CIN + FY end exists, else create) and calls
// onLanded({ jobId, action: 'updated'|'created', companyName, cin, fyTo }).
export default function AiScanner({ embedded = false, lockForm = null, onLanded = null } = {}) {
  const [formId, setFormId] = useState(lockForm || 'AOC-4');
  // Uploaded files: { id, file, name, kind, size, status: 'queued'|'reading'|'done'|'error', error, seconds }
  const [files, setFiles] = useState([]);
  const scansRef = useRef(new Map());   // file hash -> gateway JSON: a file is never scanned twice
  const editsRef = useRef(new Map());   // pathKey -> { path, value }: the CA's edits, re-applied after a re-merge
  const [progress, setProgress] = useState(null);   // { n, total, name } while reading
  const [savedFileName, setSavedFileName] = useState('');
  const [merging, setMerging] = useState(false);     // merge + NPCS suggestion + first save after the reading
  const scanning = !!progress || merging;
  const npcsCacheRef = useRef({ text: null, top: null });   // last NPCS suggestion, by activity text
  const savePromiseRef = useRef(null);                      // the first POST of this scan, while in flight
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState(null);
  const [enrichWarn, setEnrichWarn] = useState(null);   // one warning when company records / checks are unavailable
  const [notice, setNotice] = useState(null);         // { ok, text }: firm PAN remembered, a check answer that could not apply
  const [metaTick, setMetaTick] = useState(0);        // a check answered without a field edit: still saved to the scan
  const resolvedRef = useRef(new Set());                // enrich check ids the CA answered or ticked, kept across re-merges
  const dataRef = useRef(null);                         // latest data, for the debounced re-enrich after an edit
  const mergingRef = useRef(false);
  const reEnrichRef = useRef({ timer: null, keys: new Set() });
  const [result, setResult] = useState(null);
  const [data, setData] = useState(null);
  const [edited, setEdited] = useState(() => new Set());
  const [reviewOnly, setReviewOnly] = useState(false);
  const [push, setPush] = useState(null);
  const [liveJob, setLiveJob] = useState(null);
  const [recentJobs, setRecentJobs] = useState(null);
  const [savedId, setSavedId] = useState(null);
  const savedIdRef = useRef(null);
  const [saveState, setSaveState] = useState(null);
  const [savedScans, setSavedScans] = useState(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef();
  const addMoreRef = useRef();
  const form = FORMS.find(f => f.id === formId);
  const setSaved = (id) => { savedIdRef.current = id; setSavedId(id); };

  const progressN = progress?.n || 0;
  useEffect(() => {
    if (!progressN) return undefined;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [progressN]);

  // Company records and rules (backend enrich step): CIN, ADT-1 SRN, firm PAN, district, break-ups, AS-18…
  // Any failure keeps the scan as read and shows one warning; the CIN is then looked up on its own.
  const enrich = async (d) => {
    try {
      const r = await enrichScan('AOC-4', d);
      setEnrichWarn(null);
      return { ...r.data, meta: { ...r.data.meta, enrichSources: r.sources, checks: r.checks, enriched: true } };
    } catch (err) {
      let next = d;
      let cinNote = '';
      const name = String(d.general?.COMPANY_NAME || '').trim();
      if (!String(d.general?.CIN || '').trim() && name) {
        try {
          const c = await resolveCin(name);
          if (c.cin && CIN_RE.test(c.cin)) {
            next = setIn(d, ['general', 'CIN'], c.cin);
            next.meta = { ...(next.meta || {}), enrichSources: { ...(next.meta?.enrichSources || {}), 'general.CIN': 'records' } };
            cinNote = ` The CIN was found in ${c.source || 'company records'}.`;
          }
        } catch { /* lookup not available either */ }
      }
      setEnrichWarn(`Company records and rule checks are not available (${err.message}) — the scan is shown as read.${cinNote}`);
      return next;
    }
  };

  // Merge every successfully read file into one form (cached scans only — nothing is re-read).
  // Busy (merging) until the merged form is shown, so nothing can start a second merge or save meanwhile.
  const applyMerge = async (list) => {
    setMerging(true);
    mergingRef.current = true;
    try {
      const scans = list.filter(f => f.status === 'done' && scansRef.current.has(f.id))
        .map(f => ({ id: f.id, name: f.name, kind: f.kind, json: scansRef.current.get(f.id) }));
      const merged = mergeScans(scans);
      if (!merged) {
        if (list.some(f => f.status === 'error')) setError('No file could be read — see the list for the reason.');
        return;
      }
      let d = merged.data;
      // The NPCS suggestion (an AI call) is skipped once the CA chose the codes: their edit is applied over it anyway.
      const npcsChosen = editsRef.current.has('principalProducts.CATEGORY_CODE') || editsRef.current.has('principalProducts.HIGHEST_CODE');
      if (merged.result.schema === 'aoc4-client' && !npcsChosen) d = await withNpcsSuggestion(d, npcsCacheRef.current);
      // The CA's edits (and answers) win over the files and the records. They go in before enrich too, so the
      // records lookups use them (a typed CIN finds the ADT-1 SRN, a corrected FRN the firm PAN).
      const applyEdits = (x) => {
        for (const { path, value } of editsRef.current.values()) {
          try { x = setIn(x, path, value); } catch { /* the field no longer exists */ }
        }
        return x;
      };
      d = applyEdits(d);
      if (merged.result.schema === 'aoc4-client') d = applyEdits(await enrich(d));
      if (resolvedRef.current.size) d = { ...d, meta: { ...(d.meta || {}), resolvedChecks: [...resolvedRef.current] } };
      setResult(merged.result);
      setData(d);
      setPush(null);
      // A first save still in flight: wait for its id, so this merge updates that record instead of adding another.
      if (savePromiseRef.current) await savePromiseRef.current;
      const id = savedIdRef.current;
      if (id) {
        // With edits, the autosave effect sends the new data (one PUT, not two).
        if (editsRef.current.size > 0) return;
        setSaveState('saving');
        fetch(`${SCANS_API}/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: d }) })
          .then(r => r.json())
          .then(body => setSaveState(body.ok ? 'saved' : 'error'))
          .catch(() => setSaveState('error'));
        return;
      }
      const fieldCount = collectLeaves(d, merged.result.schema === 'aoc4-client' ? 'aoc4-client' : 'flat').length;
      const fileName = scans.map(s => s.name).join(', ').slice(0, 250);
      setSaveState('saving');
      const first = fetch(SCANS_API, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formType: form.id, fileName, result: merged.result, data: d, fieldCount, seconds: merged.result.seconds }),
      }).then(r => r.json())
        .then(body => { if (body.ok) setSaved(body.id); setSaveState(body.ok ? 'saved' : 'error'); })
        .catch(() => setSaveState('error'))
        .finally(() => { if (savePromiseRef.current === first) savePromiseRef.current = null; });
      savePromiseRef.current = first;
    } finally {
      setMerging(false);
      mergingRef.current = false;
    }
  };

  // An edit to the CIN, company name or audit firm re-runs enrich (debounced), so the records lookups that hang on
  // them run again. Values filled from records for the old CIN / firm are cleared first so they are looked up anew.
  const RE_ENRICH = {
    'general.CIN': ['auditor.ADT_SRN'],
    'general.COMPANY_NAME': [],
    'auditor.AUDITOR_FIRM_REG': ['auditor.AUDITOR_PAN', 'auditor.ADT_SRN'],
  };
  useEffect(() => { dataRef.current = data; }, [data]);
  useEffect(() => () => clearTimeout(reEnrichRef.current.timer), []);
  const scheduleReEnrich = (key) => {
    const st = reEnrichRef.current;
    st.keys.add(key);
    clearTimeout(st.timer);
    st.timer = setTimeout(async () => {
      if (mergingRef.current || !dataRef.current) return;
      const keys = [...st.keys];
      st.keys = new Set();
      let d = dataRef.current;
      const es = { ...(d.meta?.enrichSources || {}) };
      const stale = new Set(keys.flatMap(k => RE_ENRICH[k] || []).filter(p => es[p] === 'records' && !editsRef.current.has(p)));
      for (const p of stale) {
        d = setIn(d, p.split('.'), '');
        delete es[p];
      }
      const ruleChecks = (d.meta?.ruleChecks || []).filter(c => !stale.has(String(c?.id || '').replace(/^records:/, '')));
      d = { ...d, meta: { ...(d.meta || {}), enrichSources: es, ruleChecks } };
      let out = await enrich(d);
      if (mergingRef.current) return;   // a re-merge started meanwhile: it enriches with the edits itself
      for (const { path, value } of editsRef.current.values()) {
        try { out = setIn(out, path, value); } catch { /* the field no longer exists */ }
      }
      if (resolvedRef.current.size) out = { ...out, meta: { ...(out.meta || {}), resolvedChecks: [...resolvedRef.current] } };
      setData(out);
    }, 900);
  };

  // Read the queued files one after another ("file 2 of 3"), then merge.
  const runScans = async (list) => {
    const todo = list.filter(f => f.status === 'queued');
    let cur = list;
    const patch = (id, p) => { cur = cur.map(f => (f.id === id ? { ...f, ...p } : f)); setFiles(cur); };
    setError(null);
    for (let i = 0; i < todo.length; i++) {
      const f = todo[i];
      setElapsed(0);
      setProgress({ n: i + 1, total: todo.length, name: f.name });
      patch(f.id, { status: 'reading', error: null, note: null });
      try {
        const json = await scanFile(f.file, form.id);
        scansRef.current.set(f.id, json);
        patch(f.id, { status: 'done', seconds: json.seconds, note: json.note || null });
      } catch (err) {
        patch(f.id, { status: 'error', error: err.message });
      }
    }
    setProgress(null);
    await applyMerge(cur);
  };

  const addFiles = (fileList, { run = false } = {}) => {
    const incoming = [...(fileList || [])];
    if (!incoming.length || scanning) return;
    setError(null);
    const have = new Set(files.map(f => f.id));
    const next = [...files];
    for (const f of incoming) {
      const id = fileHash(f);
      if (have.has(id)) continue;
      have.add(id);
      const problem = fileProblem(f);
      next.push({
        id, file: f, name: f.name, kind: fileKind(f), size: f.size, error: problem,
        // A .docx report is not scanned for figures: its text is read by "Report text (verbatim)" after the merge.
        status: problem ? 'error' : (fileKind(f) === 'report' || scansRef.current.has(id) ? 'done' : 'queued'),
        ...(fileKind(f) === 'report' && !problem ? { note: 'Report: its text is read under "Report text (verbatim)" after the scan.' } : {}),
      });
    }
    setFiles(next);
    if (run) runScans(next);
  };

  const retryFile = (id) => {
    if (scanning) return;
    const next = files.map(f => (f.id === id ? { ...f, status: 'queued', error: null } : f));
    setFiles(next);
    if (data) runScans(next);
  };

  const removeFile = (id) => {
    if (scanning) return;
    const next = files.filter(f => f.id !== id);
    setFiles(next);
    if (data) {
      if (next.some(f => f.status === 'done')) applyMerge(next);
      else reset();
    }
  };

  const schema = result?.schema === 'aoc4-client' ? 'aoc4-client' : 'flat';
  const meta = useMemo(() => data?.meta || {}, [data]);

  const ctx = useMemo(() => ({
    reviewOnly,
    labelOf: key => result?.fieldLabels?.[key] || humanize(key),
    statusOf: (path) => {
      let v = data;
      for (const p of path) v = v?.[p];
      return fieldStatus(path, v, meta, edited);
    },
    sourceOf: (path) => {
      const names = meta.files || [];
      if (names.length < 2 || edited.has(pathKey(path))) return null;
      const src = meta.sources || {};
      for (let n = path.length; n > 0; n--) {
        const name = src[pathKey(path.slice(0, n))];
        if (name) return { name, n: names.findIndex(f => f.name === name) + 1 || '?' };
      }
      return null;
    },
    // Document (null: not tagged) · excel · records · derived (worked out) · answer (typed or chosen by the CA).
    kindOf: (path) => {
      const key = pathKey(path);
      if (edited.has(key)) return 'answer';
      const es = meta.enrichSources?.[key];
      if (es) return es === 'records' ? 'records' : 'derived';
      if (matchesAny(key, meta.derived)) return 'derived';
      if ((meta.files || []).length > 1) {
        for (let n = path.length; n > 0; n--) {
          const t = meta.sourceTypes?.[pathKey(path.slice(0, n))];
          if (t) return t === 'excel' ? 'excel' : null;
        }
      }
      return null;
    },
    update: (path, value) => {
      const key = pathKey(path);
      if (key === 'auditor.AUDITOR_PAN' && typeof value === 'string') value = value.trim().toUpperCase();
      editsRef.current.set(key, { path, value });
      setData(d => setIn(d, path, value));
      setEdited(s => new Set(s).add(key));
      setPush(null);
      if (schema === 'aoc4-client' && key in RE_ENRICH) scheduleReEnrich(key);
      // Auditor PAN typed for a firm with an FRN: remember it for every client of that firm. (An FRN edit does not
      // save anything: the PAN on screen may belong to the old firm; the re-enrich looks the new firm up instead.)
      if (schema === 'aoc4-client' && key === 'auditor.AUDITOR_PAN') {
        const a = { ...(data?.auditor || {}), AUDITOR_PAN: value };
        const pan = String(a.AUDITOR_PAN || '').trim().toUpperCase();
        const frn = String(a.AUDITOR_FIRM_REG || '').trim();
        if (frn && PAN_RE.test(pan)) {
          saveAuditFirm(frn, { pan, name: String(a.AUDITOR_NAME || '').trim() || undefined })
            .then(() => setNotice({ ok: true, text: `Firm PAN remembered for FRN ${frn} — it is filled in for this firm's other clients.` }))
            .catch(err => setNotice({ ok: false, text: `Could not remember the firm PAN (${err.message}); it is still in this scan.` }));
        }
      }
    },
  }), [data, meta, edited, reviewOnly, result, schema]);

  // Service type (NPCS) panel: the four Segment IV fields edited together.
  const pp = data?.principalProducts || {};
  const npcsValue = {
    categoryCode: String(pp.CATEGORY_CODE ?? ''), categoryDesc: String(pp.CATEGORY_DESC ?? ''),
    productCode: String(pp.HIGHEST_CODE ?? ''), productDesc: String(pp.HIGHEST_DESC ?? ''),
  };
  const setNpcs = (v) => {
    const next = { CATEGORY_CODE: v.categoryCode, CATEGORY_DESC: v.categoryDesc, HIGHEST_CODE: v.productCode, HIGHEST_DESC: v.productDesc };
    setData(d => ({ ...d, principalProducts: { ...(d.principalProducts || {}), ...next } }));
    setEdited(s => { const n = new Set(s); NPCS_PATHS.forEach(p => n.add(p)); return n; });
    Object.entries(next).forEach(([k, v]) => editsRef.current.set(`principalProducts.${k}`, { path: ['principalProducts', k], value: v }));
    setPush(null);
  };
  const npcsPending = (meta.npcsSuggested?.fields || []).filter(p => !edited.has(p));
  const npcsSuggestText = npcsText(data) || (schema === 'aoc4-client' ? String(data?.general?.COMPANY_NAME || '') : '');

  const leaves = useMemo(() => (data ? collectLeaves(data, schema) : []), [data, schema]);
  const counts = useMemo(() => {
    const c = { found: 0, derived: 0, nil: 0, check: 0, missing: 0, edited: 0 };
    leaves.forEach(l => { c[ctx.statusOf(l.path)]++; });
    return c;
  }, [leaves, ctx]);
  const checks = useMemo(() => (data && schema === 'aoc4-client' ? aoc4Checks(data) : []), [data, schema]);
  const failedChecks = checks.filter(c => c.ok === false).length;

  // "Check these" (enrich step): open items, the CA's Yes / No / Checked answers.
  const openChecks = useMemo(() => {
    const done = new Set(meta.resolvedChecks || []);
    return (Array.isArray(meta.checks) ? meta.checks : []).filter(c => c && c.id && !done.has(c.id));
  }, [meta]);
  const resolveCheck = (c, writes = []) => {
    resolvedRef.current.add(c.id);
    for (const w of writes) ctx.update(w.path, w.value);
    setData(d => ({ ...d, meta: { ...(d.meta || {}), resolvedChecks: [...resolvedRef.current] } }));
    if (!writes.length) setMetaTick(t => t + 1);
  };
  const answerCheck = (c, yes) => {
    if (!yes || c.action?.type !== 'managerial-remuneration') { resolveCheck(c); return; }
    const writes = managerialMoves(data, c.action.per, c.action.amount);
    if (!writes.length) {
      setNotice({ ok: false, text: `Could not move ${fmtINR(c.action.amount)}: employee benefits (${c.action.per} year) are empty or smaller. Enter managerial remuneration and employee benefits by hand.` });
      return;
    }
    setNotice(null);
    resolveCheck(c, writes);
  };

  const sections = useMemo(() => {
    if (!data) return [];
    // Flat forms with MCA section groups (MGT-7): one section per group, empty groups hidden.
    if (schema !== 'aoc4-client' && Array.isArray(result?.fieldGroups)) {
      const grouped = new Set(result.fieldGroups.flatMap(g => g.keys));
      const groups = result.fieldGroups
        .map(g => ({ key: null, id: g.title, title: g.title, value: Object.fromEntries(g.keys.filter(k => k in data).map(k => [k, data[k]])) }))
        .filter(g => Object.keys(g.value).length > 0);
      const rest = Object.fromEntries(Object.entries(data).filter(([k]) => !grouped.has(k) && !NON_FIELD_KEYS.has(k)));
      return Object.keys(rest).length ? [...groups, { key: null, id: 'other', title: 'Other fields', value: rest }] : groups;
    }
    if (schema !== 'aoc4-client') return [{ key: null, title: `${form.id} Fields`, value: data }];
    const known = AOC4_SECTIONS.filter(([k]) => data[k] !== undefined).map(([k, t]) => ({ key: k, title: t, value: data[k] }));
    const extra = Object.keys(data).filter(k => !NON_FIELD_KEYS.has(k) && !AOC4_SECTIONS.some(([s]) => s === k))
      .map(k => ({ key: k, title: humanize(k), value: data[k] }));
    return [...known, ...extra];
  }, [data, schema, form.id, result]);

  const companyName = schema === 'aoc4-client'
    ? (data?.general?.COMPANY_NAME || data?.general?.CIN)
    : (data?.companyName || data?.name || data?.firmName || data?.cin || data?.din);
  const blocker = data
    ? (pushBlocker(form.id, data)
      || (embedded && schema === 'aoc4-client' && fyEndDigits(data.general?.FY_TO).length !== 8
        ? 'Enter the financial year end (FY to, DD/MM/YYYY) in General Information first.' : null))
    : null;
  const fileLabel = files.filter(f => f.status === 'done').map(f => f.name).join(', ') || savedFileName;
  const openConflicts = (meta.conflicts || []).filter(c => !edited.has(c.key));
  const conflictLabel = (path) => {
    const sec = AOC4_SECTIONS.find(([k]) => k === path[0]);
    const per = path.find(p => p === 'current' || p === 'previous');
    const names = path.filter((p, i) => typeof p === 'string' && p !== per && !(i === 0 && sec)).map(k => ctx.labelOf(k));
    const rows = path.filter(p => typeof p === 'number').map(n => `row ${n + 1}`);
    return [sec?.[1], ...names].filter(Boolean).join(' › ') + (rows.length ? ` (${rows.join(', ')})` : '') + (per ? ` (${per} year)` : '');
  };
  const showValue = v => (Array.isArray(v) ? `${v.length} row(s)` : isPlainObject(v) ? JSON.stringify(v).slice(0, 80) : fmtINR(v));
  const queued = files.filter(f => f.status === 'queued').length;
  const savedList = lockForm ? (savedScans || []).filter(s => s.form_type === lockForm) : savedScans;

  const handlePush = async () => {
    const { meta: _meta, ...payload } = data;
    const clientName = companyName || form.id;
    if (schema === 'aoc4-client') {
      // The CIN is often typed in during review, after the scan assigned a placeholder id.
      payload.clientId = `${payload.general.CIN}_${String(payload.general.FY_TO || '').replace(/\D/g, '')}`.toLowerCase();
      payload.displayName = `${payload.general.COMPANY_NAME || payload.general.CIN} — AOC-4`;
    }
    const clientId = schema === 'aoc4-client'
      ? payload.clientId
      : String(payload.cin || payload.din || `${form.ext}_${Date.now()}`).toLowerCase();
    setPush({ status: 'pushing' });
    const outcome = { status: 'done' };
    try {
      const q = await pushToExtension({ formType: form.ext, clientId, clientName, payload });
      outcome.jobId = q.jobId;
    } catch (err) {
      outcome.queueError = err.message;
    }
    if (getSavedExtensionConfig().extId) {
      const direct = schema === 'aoc4-client'
        ? await sendAoc4ClientToExtension(payload)
        : await sendDraftToExtension(form.code, payload);
      outcome.direct = direct.ok ? { ok: true, name: direct.name } : { ok: false, error: direct.error };
    }
    setPush(outcome);
    if (savedId && outcome.jobId) {
      fetch(`${SCANS_API}/${savedId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'pushed' }) }).catch(() => {});
    }
  };

  // Embedded (Forms Hub): put the reviewed scan into this company's AOC-4 filing job.
  const handleLand = async () => {
    const { meta: _meta, ...scan } = data;
    const g = scan.general || {};
    const cin = String(g.CIN || '').trim().toUpperCase();
    const fy = fyEndDigits(g.FY_TO);
    const name = String(g.COMPANY_NAME || '').trim() || cin;
    scan.clientId = `${cin.toLowerCase()}_${fy}`;
    scan.displayName = `${name} — AOC-4`;
    setPush({ status: 'pushing' });
    try {
      const existing = await findAoc4Job(cin, fy);
      let jobId;
      let action;
      let warning = '';
      if (existing) {
        const merged = mergeScanIntoPayload(existing.payload || {}, scan);
        // Keep the filing's identity: the extension uses payload.clientId as its local client id.
        if (existing.payload?.clientId) merged.clientId = existing.payload.clientId;
        if (existing.payload?.displayName) merged.displayName = existing.payload.displayName;
        await updateJobPayload(existing.id, merged);
        // The extension only picks up a payload while the job is 'ready' (same rule as the full form's Save).
        const st = String(existing.status || '').toLowerCase();
        if (st === 'filling') {
          warning = 'The extension is filling this filing right now; the scanned values reach it on the next run.';
        } else if (st && st !== 'ready') {
          await updateExtensionJob(existing.id, { status: 'ready' });
        }
        jobId = existing.id;
        action = 'updated';
      } else {
        const q = await pushToExtension({ formType: 'aoc4', clientId: scan.clientId, clientName: `${name} (AOC-4)`, payload: scan });
        if (!q?.jobId) throw new Error(q?.message || 'The job queue did not return a job id');
        jobId = q.jobId;
        action = 'created';
      }
      if (savedId) {
        fetch(`${SCANS_API}/${savedId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'pushed' }) }).catch(() => {});
      }
      setPush({ status: 'landed', jobId, action, warning });
      onLanded?.({ jobId, action, companyName: name, cin, fyTo: g.FY_TO });
    } catch (err) {
      setPush({ status: 'error', error: err.message === 'Failed to fetch' ? `Backend not reachable on ${API_ORIGIN} — is it running?` : err.message });
    }
  };

  // "Scan another": forget the files and the form (the scan cache stays, so re-adding a file is instant).
  function reset() {
    setFiles([]); setSavedFileName(''); setResult(null); setData(null); setError(null); setPush(null); setEdited(new Set());
    setEnrichWarn(null); setNotice(null); setMetaTick(0);
    editsRef.current = new Map();
    resolvedRef.current = new Set();
    savePromiseRef.current = null;
    setSaved(null); setSaveState(null);
  }

  const openSaved = async (id) => {
    setError(null);
    try {
      const body = await fetch(`${SCANS_API}/${id}`).then(r => r.json());
      if (!body.ok) throw new Error(body.message || 'Could not open the saved scan');
      const s = body.scan;
      if (lockForm && s.form_type !== lockForm) throw new Error(`This saved scan is for ${s.form_type} — open it from AI Scanner.`);
      if (FORMS.some(f => f.id === s.form_type)) setFormId(s.form_type);
      editsRef.current = new Map();
      resolvedRef.current = new Set(s.data?.meta?.resolvedChecks || []);
      setEnrichWarn(null); setNotice(null); setMetaTick(0);
      setSavedFileName(s.file_name || 'saved scan');
      // The saved scan takes part in later merges ("Add files") as its own source, with the CA's edits in it.
      const savedKey = `saved:${s.id}`;
      scansRef.current.set(savedKey, { ...s.result, extractedFields: s.data });
      setFiles([{ id: savedKey, file: null, name: s.file_name || 'Saved scan', kind: 'saved', size: 0, status: 'done', error: null }]);
      setResult({ ...s.result, seconds: s.seconds });
      // Older scans had no service-type suggestion; add one (shown as "to check", saved on the next edit).
      let sd = s.data;
      setMerging(true);   // busy while the suggestion / records are fetched
      try {
        if (s.result?.schema === 'aoc4-client' && !sd?.meta?.npcsSuggested) sd = await withNpcsSuggestion(sd, npcsCacheRef.current);
        // Scans saved before the enrich step get it now (company records, checks); saved with the next edit.
        if (s.result?.schema === 'aoc4-client' && !sd?.meta?.enriched) sd = await enrich(sd);
      } finally {
        setMerging(false);
      }
      setData(sd);
      setEdited(new Set());
      setPush(null);
      setSaved(s.id);
      setSaveState('saved');
    } catch (err) {
      setError(err.message === 'Failed to fetch' ? `Backend not reachable on ${API_ORIGIN} — is it running?` : err.message);
    }
  };

  // Review edits are saved back to the stored scan shortly after typing stops.
  useEffect(() => {
    if (!savedId || (edited.size === 0 && !metaTick)) return undefined;
    setSaveState('saving');
    const timer = setTimeout(() => {
      fetch(`${SCANS_API}/${savedId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data, status: 'reviewed' }),
      }).then(r => r.json())
        .then(body => setSaveState(body.ok ? 'saved' : 'error'))
        .catch(() => setSaveState('error'));
    }, 800);
    return () => clearTimeout(timer);
  }, [data, savedId, edited, metaTick]);

  // Saved scans list on the upload screen.
  useEffect(() => {
    if (data) return undefined;
    let stopped = false;
    fetch(SCANS_API).then(r => r.json())
      .then(body => { if (!stopped && body.ok) setSavedScans(body.scans); })
      .catch(() => { if (!stopped) setSavedScans(null); });
    return () => { stopped = true; };
  }, [data]);

  // Live status of the pushed job, until it is filled or cancelled.
  const pushedJobId = push?.jobId;
  useEffect(() => {
    setLiveJob(null);
    if (!pushedJobId) return undefined;
    let stopped = false;
    let timer;
    const tick = async () => {
      try {
        const body = await fetch(`${JOBS_API}/${pushedJobId}`).then(r => r.json());
        if (stopped || !body.ok) return;
        setLiveJob(body.job);
        if (TERMINAL_JOB.has(body.job.status)) return;
      } catch { /* backend briefly unreachable: keep trying */ }
      if (!stopped) timer = setTimeout(tick, 3000);
    };
    tick();
    return () => { stopped = true; clearTimeout(timer); };
  }, [pushedJobId]);

  // Recent jobs list on the upload screen.
  const showRecent = !data && !embedded;
  useEffect(() => {
    if (!showRecent) return undefined;
    let stopped = false;
    const load = () => fetch(`${JOBS_API}?scope=recent`).then(r => r.json())
      .then(body => { if (!stopped && body.ok) setRecentJobs(body.jobs); })
      .catch(() => { if (!stopped) setRecentJobs(null); });
    load();
    const id = setInterval(load, 5000);
    return () => { stopped = true; clearInterval(id); };
  }, [showRecent]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={clsx('space-y-4', !embedded && 'max-w-5xl')}>
      {/* Header */}
      {embedded ? (
        <div className="bg-surface border border-line rounded-xl shadow-sm px-4 py-3">
          <p className="text-sm font-semibold text-ink">Scan {form.id} documents — the full form</p>
          <p className="text-[11px] text-ink-muted mt-0.5 max-w-2xl">
            Add the audited financial statements, audit report and any Excel or CSV schedules. Every AOC-4 field is read
            and merged; you review it, then save it to the company&apos;s AOC-4 filing (the same CIN and year end updates the existing filing).
          </p>
        </div>
      ) : (
      <div className="bg-surface border border-line rounded-xl shadow-sm p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-base font-semibold text-ink">MCA Document Scanner</h2>
            <p className="text-xs text-ink-muted mt-1 max-w-lg">
              Upload the real document. Claude reads every page, you review and correct each field, then push it to the Germin8 extension for filing.
            </p>
          </div>
          <div>
            <label htmlFor="scan-form" className="block text-[10px] text-ink-muted font-semibold uppercase tracking-wider mb-1">Target e-form</label>
            <select id="scan-form" value={formId} disabled={scanning || !!data || files.length > 0} onChange={e => setFormId(e.target.value)}
              className="text-xs border border-line rounded-lg px-3 py-2 bg-white text-ink font-semibold cursor-pointer disabled:opacity-60">
              {FORMS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </div>
        </div>
      </div>
      )}

      {!data && (
        <>
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); if (!scanning) addFiles(e.dataTransfer.files); }}
            onClick={() => !scanning && inputRef.current?.click()}
            role="button"
            tabIndex={scanning ? -1 : 0}
            aria-label={`Add ${form.id} documents`}
            aria-disabled={scanning || undefined}
            onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && !scanning) { e.preventDefault(); inputRef.current?.click(); } }}
            className={clsx(
              'border-2 border-dashed rounded-xl p-6 sm:p-12 flex flex-col items-center gap-3 bg-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
              scanning ? 'border-line cursor-wait' : 'cursor-pointer hover:border-gold-400 hover:bg-gold-50/50',
              dragging ? 'border-gold-400 bg-gold-50' : 'border-line-strong',
            )}
          >
            <input ref={inputRef} type="file" multiple className="hidden" accept={ACCEPT}
              onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
            <div className="w-14 h-14 rounded-xl bg-page border border-line flex items-center justify-center">
              {scanning ? <RefreshCw className="w-7 h-7 animate-spin" /> : <Upload className="w-7 h-7" />}
            </div>
            {merging && !progress ? (
              <div className="text-center" role="status">
                <p className="text-sm font-semibold text-ink">Merging the files{form.id === 'AOC-4' ? ', checking company records and suggesting the service code (NPCS)' : ''}…</p>
                <p className="text-[11px] text-ink-subtle mt-1">A few seconds.</p>
              </div>
            ) : scanning ? (
              <div className="text-center">
                <p className="text-sm font-semibold text-ink">Reading file {progress.n} of {progress.total}: {progress.name}…</p>
                <p className="text-xs text-ink-muted mt-1 font-mono">{elapsed}s elapsed</p>
                <p className="text-[11px] text-ink-subtle mt-1">
                  {form.id === 'AOC-4'
                    ? 'Company, balance sheet, P&L and share capital are read in parallel. A scanned 10-page PDF takes about 30–60 seconds.'
                    : 'Usually 15–40 seconds.'}
                </p>
              </div>
            ) : (
              <div className="text-center">
                <p className="text-sm font-semibold text-ink">Drop the {form.id} documents here, or click to browse</p>
                <p className="text-xs text-ink-muted mt-1">{form.hint}</p>
                <p className="text-[11px] text-ink-subtle mt-1">
                  Several files at once: PDF (scanned is fine), PNG, JPG, WEBP, Excel (.xlsx), TXT or CSV — up to {MAX_FILE_MB} MB each.
                  They are merged into one form (PDF first, then Excel, then text).
                </p>
              </div>
            )}
          </div>
          {files.length > 0 && (
            <div className="bg-surface border border-line rounded-xl shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-line flex items-center justify-between gap-3 flex-wrap">
                <p className="text-sm font-semibold text-ink">
                  Files <span className="text-ink-subtle font-normal">({files.length})</span>
                  {progress && <span className="text-xs text-ink-muted font-normal"> · file {progress.n} of {progress.total}</span>}
                  {merging && !progress && <span className="text-xs text-ink-muted font-normal"> · merging…</span>}
                </p>
                <div className="flex items-center gap-2">
                  {!scanning && <button type="button" onClick={() => setFiles([])} className="text-[11px] font-semibold text-ink-muted hover:underline cursor-pointer">Clear</button>}
                  <button type="button" onClick={() => runScans(files)} disabled={scanning || (queued === 0 && !files.some(f => f.status === 'done'))}
                    className="py-1.5 px-4 rounded-full bg-gold-700 hover:bg-gold-800 text-white text-xs font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5">
                    {scanning ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    {merging && !progress ? 'Merging…' : scanning ? 'Reading…' : queued > 0 ? `Read ${queued} file${queued > 1 ? 's' : ''} and merge` : 'Merge into one form'}
                  </button>
                </div>
              </div>
              <FileList files={files} busy={scanning} onRemove={removeFile} onRetry={retryFile} />
            </div>
          )}
          {error && (
            <div className="flex items-start gap-3 p-4 bg-rose-50 border border-rose-200 rounded-xl">
              <AlertCircle className="w-5 h-5 text-rose-700 shrink-0 mt-0.5" />
              <p className="text-xs text-rose-700 font-medium">{error}</p>
            </div>
          )}
          {savedList && savedList.length > 0 && (
            <div className="bg-surface border border-line rounded-xl shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-line flex items-center justify-between">
                <p className="text-sm font-semibold text-ink">Saved scans <span className="text-ink-subtle font-normal">({savedList.length})</span></p>
                <p className="text-[11px] text-ink-subtle">{embedded ? 'Open one to review it and save it to the filing' : 'Open one to review, edit and push it'}</p>
              </div>
              <ul className="divide-y divide-line max-h-[420px] overflow-y-auto">
                {savedList.map(s => {
                  const st = SCAN_STATUS[s.status] || SCAN_STATUS.scanned;
                  return (
                    <li key={s.id} className="px-4 py-2.5 flex items-center gap-3">
                      <span className="px-2 py-0.5 rounded-md bg-gold-50 border border-gold-200 text-[11px] font-mono font-bold text-ink shrink-0">{s.form_type}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-ink truncate">{s.company_name || s.file_name || s.id}</p>
                        <p className="text-[11px] text-ink-muted truncate">
                          {s.file_name}{s.field_count ? ` · ${s.field_count} fields` : ''}{s.seconds ? ` · ${s.seconds}s` : ''} · {ageOf(s.updated_at || s.created_at)}
                        </p>
                      </div>
                      <span className={clsx('text-[10px] font-semibold px-2 py-0.5 rounded-md border whitespace-nowrap', st.cls)}>{st.label}</span>
                      <button onClick={() => openSaved(s.id)}
                        className="px-3 py-1.5 rounded-full border border-line-strong text-xs font-semibold text-ink hover:bg-gold-50 cursor-pointer shrink-0">
                        Open
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {!embedded && recentJobs && recentJobs.length > 0 && (
            <div className="bg-surface border border-line rounded-xl shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-line flex items-center justify-between">
                <p className="text-sm font-semibold text-ink">Recent extension jobs</p>
                <p className="text-[11px] text-ink-subtle">Updates every few seconds</p>
              </div>
              <ul className="divide-y divide-line">
                {recentJobs.slice(0, 8).map(j => {
                  const d = describeJob(j);
                  return (
                    <li key={j.id} className="px-4 py-2.5 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-ink truncate">{j.client_name || j.client_id || j.id}</p>
                        <p className="text-[11px] text-ink-muted truncate">
                          <span className="font-mono">{EXT_FORM_LABEL[j.form_type] || j.form_type}</span> · {ageOf(j.updated_at || j.created_at)}
                          {['filling', 'needs_attention'].includes(j.status) && <> · {d.text}</>}
                        </p>
                      </div>
                      <span className={clsx('text-[10px] font-semibold px-2 py-0.5 rounded-md border whitespace-nowrap', TONE[d.tone])}>{d.label}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}

      {data && (
        <>
          {/* Summary */}
          <div className="bg-surface border border-line rounded-xl shadow-sm p-4 space-y-3">
            <div className="flex items-start gap-3 flex-wrap">
              <FileText className="w-5 h-5 text-ink mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-ink truncate">{companyName || fileLabel}</p>
                <p className="text-[11px] text-ink-muted">
                  {files.filter(f => f.status === 'done').length > 1 ? `${files.filter(f => f.status === 'done').length} files merged` : fileLabel} · {leaves.length} fields · {result.seconds}s · {result.model}
                  {meta.sourceUnit && <> · amounts converted from “{meta.sourceUnit}” to Rupees</>}
                </p>
                <p className={clsx('text-[11px] mt-0.5 font-medium', saveState === 'error' ? 'text-rose-700' : 'text-ink-muted')}>
                  {saveState === 'saving' && 'Saving changes…'}
                  {saveState === 'saved' && (embedded ? 'Scan saved in the dashboard — open it again from Saved scans on this tab.' : 'Saved in the dashboard — open it again any time from AI Scanner → Saved scans.')}
                  {saveState === 'error' && 'Could not save to the dashboard — your edits are only on this page.'}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <input ref={addMoreRef} type="file" multiple className="hidden" accept={ACCEPT}
                  onChange={e => { addFiles(e.target.files, { run: true }); e.target.value = ''; }} />
                <button onClick={() => addMoreRef.current?.click()} disabled={scanning}
                  className="text-xs font-semibold text-ink hover:underline flex items-center gap-1 cursor-pointer disabled:opacity-40">
                  <Plus className="w-3 h-3" /> Add files
                </button>
                <button onClick={reset} disabled={scanning} className="text-xs font-semibold text-ink hover:underline flex items-center gap-1 cursor-pointer disabled:opacity-40">
                  <RefreshCw className="w-3 h-3" /> Scan another
                </button>
              </div>
            </div>
            {files.length > 0 && (
              <div className="border border-line rounded-lg overflow-hidden">
                {scanning && (
                  <p className="px-4 py-2 text-[11px] text-sky-700 bg-sky-50 border-b border-sky-200 flex items-center gap-1.5">
                    <RefreshCw className="w-3 h-3 animate-spin" /> Reading file {progress.n} of {progress.total}: {progress.name} · {elapsed}s
                  </p>
                )}
                <FileList files={files} busy={scanning} onRemove={removeFile} onRetry={retryFile} numbered={files.length > 1} />
                {files.filter(f => f.status === 'done').length > 1 && (
                  <p className="px-4 py-1.5 text-[10px] text-ink-subtle bg-page border-t border-line">
                    F1, F2… next to a value show which file it came from (hover for the name). PDF wins over Excel, Excel over text; blanks are filled from the next file.
                    An amount the PDF prints rounded (hundreds, thousands…) is taken from the Excel when it is within one printed unit.
                  </p>
                )}
              </div>
            )}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {[
                ['Found', counts.found, 'text-emerald-700'],
                ['Derived', counts.derived, 'text-sky-700'],
                ['Nil (0)', counts.nil, 'text-ink-muted'],
                ['To check', counts.check, 'text-amber-700'],
                ['Missing', counts.missing, 'text-rose-700'],
                ['Edited', counts.edited, 'text-ink'],
              ].map(([l, v, c]) => (
                <div key={l} className="rounded-xl border border-line bg-page px-3 py-2">
                  <p className="text-[10px] text-ink-muted font-semibold uppercase tracking-wider">{l}</p>
                  <p className={clsx('text-lg font-bold font-mono', c)}>{v}</p>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-ink-subtle flex items-center gap-1 flex-wrap">
              Source tags: <SourceKindTag kind="excel" /> <SourceKindTag kind="records" /> <SourceKindTag kind="derived" /> <SourceKindTag kind="answer" />
              <span>· untagged values are read from the document.</span>
            </p>
            {enrichWarn && (
              <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {enrichWarn}
              </p>
            )}
            {notice && (
              <p className={clsx('text-[11px] rounded-lg px-3 py-2 border', notice.ok ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-amber-800 bg-amber-50 border-amber-200')}>
                {notice.text}
              </p>
            )}
            {(meta.notes || meta.failedParts?.length > 0) && (
              <div className="text-[11px] text-ink-muted bg-page border border-line rounded-lg px-3 py-2 space-y-1">
                {meta.notes && <p>Scanner note: {meta.notes}</p>}
                {meta.failedParts?.map(p => <p key={p} className="text-rose-700">Could not read part — {p}. Fill these fields manually or rescan.</p>)}
              </div>
            )}
          </div>

          {/* Check these: results of the enrich rules (break-ups, duplicates, managerial remuneration, CIN…) */}
          <ScanChecks checks={openChecks} labelOf={conflictLabel} onAnswer={answerCheck} onDismiss={c => resolveCheck(c)} />

          {/* Verbatim auditor's / Board's report text for the linked extract forms (after the merge, once the CIN is valid) */}
          {schema === 'aoc4-client' && CIN_RE.test(String(data?.general?.CIN || '').trim().toUpperCase()) && (
            <ReportVerbatimPanel cin={String(data.general.CIN).trim().toUpperCase()}
              files={files.filter(f => f.file && (f.kind === 'pdf' || f.kind === 'report') && f.status !== 'error')} />
          )}

          {/* Conflicts between files */}
          {openConflicts.length > 0 && (
            <div className="bg-surface border border-amber-200 rounded-xl shadow-sm p-4">
              <p className="text-sm font-semibold text-ink flex items-center gap-1.5 flex-wrap">
                <AlertTriangle className="w-4 h-4 text-amber-600" /> Files disagree
                <span className="text-xs font-semibold text-amber-700">· {openConflicts.length} field(s) differ between files</span>
              </p>
              <p className="text-[11px] text-ink-muted mt-0.5">The value from the higher-priority file is filled in (highlighted). Click the right one to confirm it.</p>
              <ul className="mt-2 divide-y divide-line max-h-[360px] overflow-y-auto">
                {openConflicts.map(c => {
                  const cur = JSON.stringify(getIn(data, c.path));
                  return (
                    <li key={c.key} className="py-2 flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3">
                      <span className="text-xs font-medium text-ink sm:w-72 shrink-0">{conflictLabel(c.path)}</span>
                      <div className="flex flex-wrap gap-1.5 min-w-0">
                        {c.values.map((v, i) => (
                          <button key={i} type="button" onClick={() => ctx.update(c.path, v.value)} title={`From ${v.file}`}
                            className={clsx('px-2.5 py-1 rounded-lg border text-[11px] cursor-pointer text-left max-w-full sm:max-w-xs truncate',
                              cur === JSON.stringify(v.value) ? 'border-gold-600 bg-gold-50 text-ink font-semibold' : 'border-line-strong bg-white text-ink hover:bg-gold-50')}>
                            <span className="font-mono">{showValue(v.value)}</span>
                            <span className="text-ink-subtle font-normal"> · {v.file}</span>
                          </button>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Cross-checks */}
          {checks.length > 0 && (
            <div className="bg-surface border border-line rounded-xl shadow-sm p-4">
              <p className="text-sm font-semibold text-ink mb-2">
                Cross-checks {failedChecks > 0
                  ? <span className="text-rose-700 text-xs font-semibold">· {failedChecks} failing</span>
                  : <span className="text-emerald-700 text-xs font-semibold">· all passing</span>}
              </p>
              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
                {checks.map(c => (
                  <div key={c.label} className="flex items-start gap-2 text-xs">
                    {c.ok === true && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />}
                    {c.ok === false && <XCircle className="w-3.5 h-3.5 text-rose-700 shrink-0 mt-0.5" />}
                    {c.ok === null && <AlertTriangle className="w-3.5 h-3.5 text-ink-subtle shrink-0 mt-0.5" />}
                    <span><span className="font-medium text-ink">{c.label}</span> <span className="text-ink-muted">— {c.detail}</span></span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Service type (NPCS) */}
          {schema === 'aoc4-client' && (
            <div className="bg-surface border border-line rounded-xl shadow-sm p-4 space-y-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">Service type (NPCS)</p>
                  <p className="text-[11px] text-ink-muted mt-0.5 max-w-xl">
                    AOC-4 Segment IV asks for the 4-digit category and the 8-digit code of the service that earns the most.
                    {pp.BUSINESS_ACTIVITY ? <> Read from the document: “{String(pp.BUSINESS_ACTIVITY).slice(0, 240)}”</> : ' The document did not say clearly what the company does — search below.'}
                  </p>
                </div>
                {npcsPending.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold px-2 py-1 rounded-md bg-amber-50 text-amber-700 border border-amber-200 whitespace-nowrap">
                      Suggested — please confirm
                    </span>
                    <button type="button" onClick={() => setNpcs(npcsValue)}
                      className="px-3 py-1 rounded-lg bg-gold-700 hover:bg-gold-800 text-white text-[11px] font-semibold cursor-pointer flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Confirm
                    </button>
                  </div>
                )}
              </div>
              <NpcsPicker value={npcsValue} onChange={setNpcs} suggestText={npcsSuggestText} />
            </div>
          )}

          {/* Review */}
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-ink">Review extracted data</p>
            <div className="flex rounded-full border border-line p-0.5 text-[11px] font-semibold">
              {[[false, 'All fields'], [true, `Needs review (${counts.missing + counts.check})`]].map(([v, l]) => (
                <button key={l} type="button" aria-pressed={reviewOnly === v} onClick={() => setReviewOnly(v)}
                  className={clsx('px-3 py-1 rounded-full cursor-pointer', reviewOnly === v ? 'bg-gold-700 text-white' : 'text-ink-muted')}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-3">
            {sections.map(s => <Section key={s.id || s.key || 'root'} title={s.title} sectionKey={s.key} value={s.value} ctx={ctx} />)}
          </div>

          {/* Push */}
          <div className="sticky bottom-4 bg-surface border border-line rounded-xl shadow-sm p-4 shadow-lg space-y-2">
            {schema === 'aoc4-client' && (
              <p className="text-[11px] text-ink-muted font-mono" aria-label="Data quality">
                Data quality: {leaves.length} fields · {openConflicts.length} conflict{openConflicts.length === 1 ? '' : 's'} · {openChecks.length} to check
                {counts.missing > 0 ? ` · ${counts.missing} empty` : ''}
              </p>
            )}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex-1 min-w-[200px] text-xs text-ink-muted">
                {blocker
                  ? <span className="text-rose-700 font-medium">{blocker}</span>
                  : failedChecks > 0
                    ? <span className="text-amber-700 font-medium">{failedChecks} cross-check(s) failing — review before pushing.</span>
                    : openChecks.length > 0
                      ? <span className="text-amber-700 font-medium">{openChecks.length} item(s) in “Check these” — answer or tick them before {embedded ? 'saving' : 'pushing'}.</span>
                    : npcsPending.length > 0
                      ? <span className="text-amber-700 font-medium">The service type (NPCS) codes were suggested — confirm them above before pushing.</span>
                      : <span>{counts.edited > 0 ? `Reviewed and edited ${counts.edited} field(s).` : 'Reviewed.'} Ready for the extension.</span>}
              </div>
              <button onClick={() => downloadJson(Object.fromEntries(Object.entries(data).filter(([k]) => k !== 'meta')), `${(data.clientId || form.ext)}.json`)}
                className="py-2 px-4 rounded-full border border-line-strong text-xs font-semibold text-ink hover:bg-gold-50 cursor-pointer flex items-center gap-1.5">
                <Download className="w-3.5 h-3.5" /> Export JSON
              </button>
              {embedded ? (
                <button onClick={handleLand} disabled={!!blocker || push?.status === 'pushing'}
                  className="py-2 px-5 rounded-full bg-gold-700 text-white text-xs font-semibold hover:bg-gold-800 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5">
                  {push?.status === 'pushing' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  Save to {form.id} filing
                </button>
              ) : (
                <button onClick={handlePush} disabled={!!blocker || push?.status === 'pushing'}
                  className="py-2 px-5 rounded-full bg-gold-700 text-white text-xs font-semibold hover:bg-gold-800 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5">
                  {push?.status === 'pushing' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  Push to Extension
                </button>
              )}
            </div>
            {push?.status === 'error' && (
              <p className="text-[11px] text-rose-700 border-t border-line pt-2">Could not save to the filing: {push.error}</p>
            )}
            {push?.status === 'landed' && (
              <p className="text-[11px] text-emerald-700 border-t border-line pt-2">
                {push.action === 'updated' ? 'Updated the existing filing' : 'Created a new filing'} <span className="font-mono">{push.jobId}</span>.
              </p>
            )}
            {push?.status === 'landed' && push.warning && (
              <p className="text-[11px] text-amber-700">{push.warning}</p>
            )}
            {push?.status === 'done' && (
              <div className="text-[11px] space-y-0.5 border-t border-line pt-2">
                {push.jobId && <p className="text-emerald-700">Saved to the extension job queue as <span className="font-mono">{push.jobId}</span>.</p>}
                {push.queueError && <p className="text-rose-700">Job queue failed: {push.queueError}</p>}
                {push.direct?.ok && <p className="text-emerald-700">Sent straight to the extension{push.direct.name ? ` as “${push.direct.name}”` : ''} — open the side panel on the MCA portal to start filling.</p>}
                {push.direct && !push.direct.ok && <p className="text-amber-700">Direct send failed: {push.direct.error}</p>}
                {!push.direct && push.jobId && <p className="text-ink-muted">The extension picks this up from the queue: open its side panel → Jobs from dashboard → Load.</p>}
                {liveJob && (() => {
                  const d = describeJob(liveJob);
                  return (
                    <p className={clsx('mt-1 px-2.5 py-1.5 rounded-lg border font-medium flex items-center gap-1.5', TONE[d.tone])}>
                      {!TERMINAL_JOB.has(liveJob.status) && liveJob.status !== 'needs_attention' && <RefreshCw className="w-3 h-3 animate-spin shrink-0" />}
                      {liveJob.status === 'filled' && <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />}
                      {liveJob.status === 'needs_attention' && <AlertTriangle className="w-3.5 h-3.5 shrink-0" />}
                      <span>{d.text}</span>
                    </p>
                  );
                })()}
              </div>
            )}
          </div>
        </>
      )}
    </motion.div>
  );
}
