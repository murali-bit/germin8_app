// Pure merge of several scans of one e-form (no browser or Vite imports, so node tests can import it:
// backend/tests/merge-scans.test.mjs).
//
// Priority when two files give a value for the same field: PDF / image (signed statements) > Excel > text.
// The first non-empty value in that order wins; a different non-empty value from another file is
// listed as a conflict for the CA to pick.
// One exception: an amount the PDF printed in a unit (hundreds / thousands / lakhs / crores) is taken
// from the Excel when the Excel figure is within one printed unit of it — the Excel holds the exact rupees the
// PDF rounded. Text fields always prefer the PDF. Values the PDF scan worked out itself (meta.derived /
// meta.enrichSources: totals such as the AS-18 gross, or depreciation taken from the fixed-assets note) are not
// printed rounded amounts and are never swapped. (A face-P&L figure that both files print the same — e.g.
// depreciation 274 hundreds in both — is not changed here; the depreciation-note rule in backend/aoc4-enrich.js
// handles that case.)

// kind -> priority rank (lower wins) and a short label for the UI
export const KINDS = {
  pdf: { rank: 0, label: 'PDF' },
  image: { rank: 0, label: 'Image' },
  xlsx: { rank: 1, label: 'Excel' },
  text: { rank: 2, label: 'Text' },
  saved: { rank: 0, label: 'Saved scan' },   // a scan opened from "Saved scans" (already reviewed)
  report: { rank: 9, label: 'Report text' }, // a .docx report: not scanned, read only for its verbatim text
};

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const META_KEYS = new Set(['meta']);
const isBlank = v => v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
  || (Array.isArray(v) && v.length === 0);

export function pathKey(path) {
  return path.map((p, i) => (typeof p === 'number' ? `[${p}]` : (i ? `.${p}` : p))).join('');
}

/** Value at a path in an object (undefined when absent). */
export function getIn(obj, path) {
  let v = obj;
  for (const p of path) v = v?.[p];
  return v;
}

const norm = v => {
  if (typeof v === 'number') return v;
  if (Array.isArray(v) || isObj(v)) return JSON.stringify(v);
  const s = String(v).trim();
  const n = Number(s.replace(/,/g, ''));
  if (s !== '' && /^-?[\d,]+(\.\d+)?$/.test(s) && !Number.isNaN(n)) return n;
  return s.replace(/\s+/g, ' ').toLowerCase();
};

/**
 * Same value for review purposes: strings ignoring case/spacing; numbers within half a printed unit of the coarser
 * file (`tol` = that file's unit in rupees, e.g. 100000 for a PDF in lakhs), at least ₹1.
 */
export function sameValue(a, b, tol = 1) {
  const x = norm(a), y = norm(b);
  if (typeof x === 'number' && typeof y === 'number') return Math.abs(x - y) <= Math.max(1, tol / 2);
  return x === y;
}

/**
 * A scan's printed unit in rupees. postProcessAoc4 records meta.unitMultiplier (1, 100, 1000, 100000, 10000000)
 * and a scale note like "Converted from … to Rupees (x100)." on the balance sheet; the note is the fallback
 * (saved scans and older results may have only the note).
 */
export function unitOfFields(fields) {
  const m = Number(fields?.meta?.unitMultiplier);
  if (Number.isFinite(m) && m > 1) return m;
  const note = String(fields?.balanceSheet?.scaleNote || '');
  const x = note.match(/\(x\s*([\d,]+)\)/i);
  const n = x ? Number(x[1].replace(/,/g, '')) : NaN;
  return Number.isFinite(n) && n > 1 ? n : 1;
}
const unitOf = s => unitOfFields(s?.json?.extractedFields);

// Amount fields the backend converts by the printed unit (backend/scanner-schemas.js postProcessAoc4): only these
// can be "rounded" in a PDF. Counts, percentages, EPS, face value, codes and dates are never swapped for Excel.
const AMOUNT_SECTIONS = new Set(['balanceSheet', 'profitLoss', 'balanceSheetBreakup', 'profitLossDetails',
  'financialParametersBS', 'financialParametersPL', 'foreignExchange', 'shareCapitalRaised', 'shareCapital', 'principalProducts']);
const NOT_AMOUNT = /PERCENT|EPS|SHARES|FACE_VALUE|TOTAL_CATEGORIES|_CODE$|_DESC$|asOf|scaleNote/i;

export function isScaledAmount(path) {
  const sec = path[0];
  if (!AMOUNT_SECTIONS.has(sec)) return false;
  const keys = path.filter(p => typeof p === 'string' && p !== 'current' && p !== 'previous');
  const leaf = keys[keys.length - 1] || '';
  if (NOT_AMOUNT.test(leaf)) return false;
  if (sec === 'shareCapital') return /NOMINAL/.test(leaf);
  if (sec === 'principalProducts') return /TURNOVER$/.test(leaf);
  return true;
}

const asNumber = v => {
  const n = norm(v);
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/** 'document' | 'excel' for a scan kind (a saved scan keeps what its own merge recorded). */
const sourceTypeOf = (s, key) => {
  if (s.kind === 'xlsx') return 'excel';
  if (s.kind === 'saved') return s.json.extractedFields?.meta?.sourceTypes?.[key] || 'document';
  return 'document';
};

const matchesAny = (key, list) => (list || []).some(p => key === p || key.startsWith(`${p}.`) || key.startsWith(`${p}[`));

const UNIT_WORD = { 100: 'hundreds', 1000: 'thousands', 100000: 'lakhs', 10000000: 'crores' };

/**
 * Merge scans into one form.
 * @param {{id: string, name: string, kind: string, json: object}[]} scans  in the order the CA added them
 * @returns {null | {result: object, data: object, sources: object}}  result is a gateway-like JSON; data.meta carries
 *   sources {pathKey: fileName}, sourceTypes {pathKey: 'document'|'excel'}, conflicts [{key, path, values:[{value, file}]}],
 *   roundingChoices [{key, path, document, excel, unit, file}], files [{name, kind}].
 *   The returned `sources` is data.meta.sourceTypes.
 */
export function mergeScans(scans) {
  const list = (scans || []).filter(s => s?.json?.extractedFields);
  if (!list.length) return null;
  const ordered = list
    .map((s, i) => ({ ...s, i, rank: KINDS[s.kind]?.rank ?? 3 }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i);

  const sources = {};
  const sourceTypes = {};
  const conflicts = [];
  const roundingChoices = [];
  const uncertain = new Set(), derived = new Set(), nil = new Set();

  const winnerMeta = (key, s) => {
    const m = s.json.extractedFields.meta || {};
    if (matchesAny(key, m.uncertain)) uncertain.add(key);
    if (matchesAny(key, m.derived)) derived.add(key);
    if ((m.nil || []).includes(key)) nil.add(key);
  };

  // A rounded PDF amount gives way to the Excel figure within one printed unit of it. The Excel may have been
  // read in the same unit (its "hundreds" columns): its cells still hold the figure the PDF rounded (e.g. 1482.5
  // hundreds), so an Excel unit no coarser than the PDF's counts. Worked-out values are skipped (see top).
  const pickExact = (path, win, filled) => {
    const unit = unitOf(win.s);
    if (unit <= 1 || win.s.kind === 'xlsx' || !isScaledAmount(path)) return null;
    const wm = win.s.json.extractedFields.meta || {};
    const key = pathKey(path);
    // A worked-out balance-sheet line is the PDF scan's own rounding plug (reconcileForMca puts the printed total's
    // rounding gap into one line): the exact Excel figure is better there. Other worked-out values stay.
    const bsPlug = /^balanceSheet\.(current|previous)\./.test(key);
    if ((matchesAny(key, wm.derived) && !bsPlug) || (wm.enrichSources && wm.enrichSources[key])) return null;
    const doc = asNumber(win.v);
    if (doc === null) return null;
    const exact = filled.find(x => x.s.kind === 'xlsx' && unitOf(x.s) <= unit && asNumber(x.v) !== null
      && Math.abs(asNumber(x.v) - doc) <= unit);
    if (!exact || asNumber(exact.v) === doc) return null;
    return { exact, unit, doc };
  };

  // Arrays and scalars are leaves; objects are walked (keys in first-seen order across files).
  const mergeAt = (path, items) => {   // items: [{s, v}] in priority order (v may be undefined)
    const present = items.filter(x => x.v !== undefined);
    if (!present.length) return undefined;
    if (present.some(x => isObj(x.v))) {
      const objs = present.filter(x => isObj(x.v));
      const keys = [];
      const seen = new Set();
      for (const x of ordered.map(s => objs.find(o => o.s === s)).filter(Boolean)) {
        for (const k of Object.keys(x.v)) if (!seen.has(k) && !(path.length === 0 && META_KEYS.has(k))) { seen.add(k); keys.push(k); }
      }
      const out = {};
      for (const k of keys) {
        const v = mergeAt([...path, k], objs.map(o => ({ s: o.s, v: o.v[k] })));
        if (v !== undefined) out[k] = v;
      }
      return out;
    }
    const key = pathKey(path);
    const filled = present.filter(x => !isBlank(x.v));
    if (!filled.length) return present[0].v;   // keep the blank shape (null / '' / [])
    let win = filled[0];
    const choice = pickExact(path, win, filled);
    if (choice) {
      roundingChoices.push({ key, path, document: win.v, excel: choice.exact.v, unit: choice.unit, file: choice.exact.s.name, documentFile: win.s.name });
      win = choice.exact;
    }
    sources[key] = win.s.name;
    sourceTypes[key] = sourceTypeOf(win.s, key);
    winnerMeta(key, win.s);
    const others = [];
    for (const x of filled) {
      if (x === win) continue;
      const tol = Math.max(unitOf(x.s), unitOf(win.s));
      // The rounded PDF figure the Excel replaced is the same amount, not a conflict.
      const sameRounded = choice && x.s === filled[0].s && Math.abs(asNumber(x.v) - asNumber(win.v)) <= tol;
      if (sameRounded) continue;
      if (!sameValue(x.v, win.v, tol) && !others.some(o => sameValue(o.value, x.v, Math.max(tol, o.unit)))) others.push({ value: x.v, file: x.s.name, unit: unitOf(x.s) });
    }
    if (others.length) {
      conflicts.push({ key, path, values: [{ value: win.v, file: win.s.name }, ...others.map(({ unit: _unit, ...o }) => o)] });
      uncertain.add(key);
    }
    return win.v;
  };

  const data = mergeAt([], ordered.map(s => ({ s, v: s.json.extractedFields }))) || {};
  const first = ordered[0];
  const firstMeta = first.json.extractedFields.meta || {};
  const notes = ordered.flatMap(s => [s.json.extractedFields.meta?.notes, s.json.note].filter(Boolean)
    .map(n => (ordered.length > 1 ? `${s.name}: ${n}` : n)));
  if (roundingChoices.length) {
    const units = [...new Set(roundingChoices.map(r => r.unit))].map(u => UNIT_WORD[u] || `units of ${u}`).join(' / ');
    const files = [...new Set(roundingChoices.map(r => r.file))].join(', ');
    notes.push(`${roundingChoices.length} amount(s) taken from ${files}: the PDF prints them rounded to ${units}, the Excel has the exact figure.`);
  }
  const failedParts = ordered.flatMap(s => (s.json.extractedFields.meta?.failedParts || []).map(p => (ordered.length > 1 ? `${p} (${s.name})` : p)));
  data.meta = {
    ...firstMeta,
    uncertain: [...uncertain], derived: [...derived], nil: [...nil],
    notes: notes.join(' · ') || undefined,
    failedParts,
    sourceUnit: ordered.map(s => s.json.extractedFields.meta?.sourceUnit).find(Boolean),
    sources, sourceTypes, conflicts, roundingChoices,
    files: list.map(s => ({ name: s.name, kind: s.kind })),
  };
  delete data.meta.npcsSuggested;   // recomputed on the merged data

  const fieldLabels = Object.assign({}, ...ordered.slice().reverse().map(s => s.json.fieldLabels || {}));
  const result = {
    ...first.json,
    extractedFields: data,
    fieldLabels,
    fieldGroups: ordered.map(s => s.json.fieldGroups).find(Array.isArray),
    model: [...new Set(ordered.map(s => s.json.model).filter(Boolean))].join(' + '),
    seconds: ordered.reduce((t, s) => t + (s.json.seconds || 0), 0),
  };
  return { result, data, sources: sourceTypes };
}

// ─── Managerial remuneration (enrich check action, applied here so totals stay intact) ─────────────────────

/**
 * "Directors' salary ₹X is managerial remuneration": moves X from employee benefits to managerial remuneration
 * in the P&L details (both are separate lines there, so the expense total is unchanged), and mirrors the
 * managerial figure on the face P&L (whose employee expenses already include it and whose total excludes it).
 * Returns [{path, value}] — the writes to apply (empty when the amount is not usable).
 */
export function managerialMoves(data, per, amount) {
  const x = Number(amount);
  if (!Number.isFinite(x) || x <= 0 || (per !== 'current' && per !== 'previous')) return [];
  const det = data?.profitLossDetails || {};
  const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const round2 = v => Math.round(v * 100) / 100;
  const writes = [];
  const emp = det.PL_EMPLOYEE_BENEFITS?.[per];
  if (typeof emp !== 'number' || emp < x) return [];   // nothing to move it from
  writes.push({ path: ['profitLossDetails', 'PL_EMPLOYEE_BENEFITS', per], value: round2(emp - x) });
  const mr = round2(num(det.PL_MANAGERIAL_REMUNERATION?.[per]) + x);
  writes.push({ path: ['profitLossDetails', 'PL_MANAGERIAL_REMUNERATION', per], value: mr });
  if (isObj(data?.profitLoss?.[per]) && 'MANAGERIAL_REMUNERATION' in data.profitLoss[per]) {
    writes.push({ path: ['profitLoss', per, 'MANAGERIAL_REMUNERATION'], value: mr });
  }
  return writes;
}
