// Helpers for the AOC-4 workspace: read the nested job payload as flat keys (exactly as the
// extension does), write edits back to the right place, talk to the company master.
import {
  AOC4_PHASES, AOC4_PAGE2, AOC4_PAYLOAD_PATHS, AOC4_SECTION_PRECEDENCE, flattenClient,
} from '../../data/aoc4Sections.js';
import { API_ORIGIN } from '../../lib/api.js';

export const PAGE1_FIELDS = AOC4_PHASES.flatMap(p => p.fields);
export const PAGE1_BY_KEY = Object.fromEntries(PAGE1_FIELDS.map(f => [f.key, f]));

// Declaration answers shared by AOC-4 Page 2, AOC-2 and the report extracts live under formType 'aoc4'
// (same rule as extension/js/linked/runner.js).
export const SHARED_AOC4_KEYS = ['BOARD_RESOLUTION_NO', 'BOARD_RESOLUTION_DATE', 'DECL_DESIGNATION', 'DECL_DIN'];

export const isBlank = v => v == null || (typeof v === 'string' && v.trim() === '')
  || (Array.isArray(v) && v.length === 0);

export function flatten(payload) {
  try { return flattenClient(payload || {}); } catch { return {}; }
}

const norm = v => String(v ?? '').trim().toLowerCase();

// Required now? `required`, or `requiredIf {key, equals | in}` against the current values.
export function isRequired(field, valueOf) {
  if (field.required) return true;
  const c = field.requiredIf;
  if (!c) return false;
  const other = norm(valueOf(c.key));
  if (c.equals != null) return other === norm(c.equals);
  if (Array.isArray(c.in)) return c.in.some(x => norm(x) === other);
  return false;
}

function setPath(obj, path, value) {
  const parts = path.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const seg = parts[i];
    const nextIsIndex = /^\d+$/.test(parts[i + 1]);
    if (o[seg] == null || typeof o[seg] !== 'object') o[seg] = nextIsIndex ? [] : {};
    if (Array.isArray(o[seg]) && nextIsIndex) {
      // flattenClient walks the list with forEach: keep it dense.
      const idx = Number(parts[i + 1]);
      for (let k = 0; k <= idx; k++) if (o[seg][k] == null) o[seg][k] = {};
    }
    o = o[seg];
  }
  o[parts[parts.length - 1]] = value;
}

// Numbers stay numbers in the payload (the scanner writes numbers); everything else is a string.
export function coerce(field, raw) {
  const s = typeof raw === 'string' ? raw.trim() : raw;
  if (field && field.kind === 'number' && typeof s === 'string' && s !== '') {
    const n = s.replace(/[,₹\s]/g, '');
    if (/^-?\d+(\.\d+)?$/.test(n)) return Number(n);
  }
  return s ?? '';
}

// Writes one flat key into a payload (mutates). Returns false when the key has no payload path.
export function writeKey(payload, key, value) {
  const path = AOC4_PAYLOAD_PATHS[key];
  if (!path) return false;
  const [section] = path.split('.');
  // A scalar key may already live in another section; flattenClient lets the later section win,
  // so update the section that currently wins rather than adding a copy that would be shadowed.
  if (AOC4_SECTION_PRECEDENCE.includes(section)) {
    const owner = AOC4_SECTION_PRECEDENCE.find(s => payload[s] && typeof payload[s] === 'object'
      && Object.prototype.hasOwnProperty.call(payload[s], key));
    if (owner) { payload[owner][key] = value; return true; }
  }
  setPath(payload, path, value);
  return true;
}

// Applies page-1 edits. Returns { payload, unmapped:[{key,label,value}] } — unmapped go to the company master.
export function applyEdits(payload, edits) {
  const next = JSON.parse(JSON.stringify(payload || {}));
  const unmapped = [];
  for (const [key, raw] of Object.entries(edits || {})) {
    const field = PAGE1_BY_KEY[key];
    const value = coerce(field, raw);
    if (!writeKey(next, key, value)) unmapped.push({ key, label: field?.label || key, value: String(value ?? '') });
  }
  return { payload: next, unmapped };
}

// ───────────────────────── validation ─────────────────────────

export function normDate(s) {
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

const dateNum = ddmmyyyy => { const [d, m, y] = ddmmyyyy.split('/'); return +(y + m + d); };
const todayNum = () => { const t = new Date(); return t.getFullYear() * 10000 + (t.getMonth() + 1) * 100 + t.getDate(); };
export const isFutureDate = ddmmyyyy => dateNum(ddmmyyyy) > todayNum();

// One field's problem in plain English, or ''.
export function fieldProblem(field, value) {
  if (isBlank(value)) return '';
  const s = String(value).trim();
  if (field.kind === 'date' && !normDate(s)) return 'Use DD/MM/YYYY';
  if (field.kind === 'number' && !/^-?[\d,]+(\.\d+)?$/.test(s.replace(/[₹\s]/g, ''))) return 'Must be a number';
  if (field.maxLength && s.length > field.maxLength) return `Up to ${field.maxLength} characters`;
  if (field.pattern && !new RegExp(field.pattern).test(s)) return field.hint || 'Check the format';
  return '';
}

// ───────────────────────── Page 2 ─────────────────────────

// The declaration ID depends on who signs: Director → DIN, Secretary → membership no., others → PAN.
export function page2Fields(values) {
  const desig = values.DECL_DESIGNATION || 'Director';
  return AOC4_PAGE2.map(f => {
    if (f.key !== 'DECL_DIN') return f;
    if (desig === 'Director') return f;
    if (desig === 'Secretary') return { ...f, label: 'Membership number of the company secretary', pattern: '^[AFaf]?\\d{1,6}$', hint: 'e.g. A12345 or F1234' };
    return { ...f, label: `PAN of the ${desig}`, pattern: '^[A-Za-z]{5}\\d{4}[A-Za-z]$', hint: 'e.g. ABCDE1234F' };
  });
}

// ───────────────────────── company master ─────────────────────────

const ANSWERS_API = `${API_ORIGIN}/api/company-answers`;

// All saved answers of one company, grouped by form type: { aoc4:{KEY:value}, aoc2:{…}, … }.
export async function fetchCompanyAnswers(cin) {
  const res = await fetch(`${ANSWERS_API}?cin=${encodeURIComponent(cin)}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) throw new Error(body.message || `Company master answered ${res.status}`);
  const out = { aoc4: {}, aoc2: {}, eauditor: {}, eboard: {} };
  const labels = {};
  for (const r of body.answers || []) {
    (out[r.form_type] = out[r.form_type] || {})[r.field_key] = r.value;
    labels[`${r.form_type}:${r.field_key}`] = r.label;
  }
  return { answers: out, labels };
}

export async function saveCompanyAnswers(cin, formType, answers) {
  if (!answers.length) return { ok: true, saved: 0 };
  const res = await fetch(ANSWERS_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cin, formType, answers }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) throw new Error(body.message || `Saving ${formType} answers failed (${res.status})`);
  return body;
}

// A short, readable rendering of any value from the linked-form preview.
export function showValue(v) {
  if (v == null || v === '') return '—';
  if (Array.isArray(v)) {
    if (!v.length) return 'None';
    if (v.every(x => x == null || typeof x !== 'object')) return v.join(', ');
    return `${v.length} row${v.length === 1 ? '' : 's'}`;
  }
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
