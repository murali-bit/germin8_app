// AI for report-only fields: the AOC-4 linked forms (Auditor's report extract, Board's report extract, AOC-2) and the
// AOC-4 declaration ask for facts that differ for every company and are written only in its signed documents
// (emphasis of matter, Rule 11 matters, board meetings, related-party contracts, …). One Claude call reads the
// (a) attachment PDF (financial statements + auditor's report + Board's report) and proposes values; every value
// carries a short verbatim quote and its page, or it is dropped. Nothing here invents a value or a default.
//
// Pure parts (prompt, post-validation, proposals, save rules) are exported for tests; the Claude call itself is
// gateway.extractReportFields, swappable with _setExtractor() in tests.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { extractReportFields } from './gateway.js';

const require = createRequire(import.meta.url);
const AOC2 = require('../extension/js/linked/aoc2.js');
const EAUDITOR = require('../extension/js/linked/eauditor.js');

export const NATURES = AOC2.NATURES;
export const QUAL_OPTIONS = ['Qualification', 'Reservation', 'Adverse remarks', 'Disclaimer'];
export const OPINION_TYPES = ['unmodified', 'qualified', 'adverse', 'disclaimer'];
const MAX_TEXT = 4000;
const MAX_QUOTE = 200;
const QUAL_MAX = 5;

// ───────────────────────── field catalogue ─────────────────────────
// kind: text | count | yesno | enum | date | resno | meetings | rows. `ask` is the instruction given to Claude.
const F = (formType, key, label, kind, ask, extra) => ({ formType, key, label, kind, ask, ...(extra || {}) });

export const FIELDS = [
  // Auditor's report (extract of the auditor's report, standalone).
  F('eauditor', 'OPINION', EAUDITOR.labels.OPINION, 'text', 'The opinion paragraph as written, shortened to its substance; also set "type" to unmodified | qualified | adverse | disclaimer.'),
  F('eauditor', 'BASIS', EAUDITOR.labels.BASIS, 'text', 'ONLY if the opinion is modified (qualified/adverse/disclaimer): the matter described under "Basis for qualified/adverse opinion / disclaimer". null when unmodified.'),
  F('eauditor', 'EMPHASIS', EAUDITOR.labels.EMPHASIS, 'text', 'The "Emphasis of Matter" paragraph (e.g. going concern, material uncertainty). Use "Nil" only if the report clearly has no such paragraph AND you quote the heading that proves where it would be (else null).'),
  F('eauditor', 'KAM', EAUDITOR.labels.KAM, 'text', 'Key audit matters as written; "Not applicable" when the report says KAM reporting does not apply (unlisted company).'),
  F('eauditor', 'OTHER_INFO', EAUDITOR.labels.OTHER_INFO, 'text', 'The "Other Information" paragraph (usually about the Board\'s report), as written, shortened.'),
  F('eauditor', 'RULE11', EAUDITOR.labels.RULE11, 'text', 'The Rule 11 of the Companies (Audit and Auditors) Rules matters exactly as reported: pending litigations, long-term contracts / foreseeable losses, IEPF transfer, Rule 11(e) representations, dividend under s.123, audit trail (edit log). Keep the sub-points (i)…(vi).'),
  F('eauditor', 'OTHER_5B', EAUDITOR.labels.OTHER_5B, 'text', 'Any "Other Matter" paragraph; "None" only if the report clearly has none and you can quote where.'),
  F('eauditor', 'CARO', EAUDITOR.labels.CARO, 'yesno', '"Yes" if the report includes / refers to a CARO 2020 annexure ("Report on Other Legal and Regulatory Requirements … Companies (Auditor\'s Report) Order"), "No" if it states CARO is not applicable.'),
  F('eauditor', 'IFC', EAUDITOR.labels.IFC, 'text', 'The statement on internal financial controls (s.143(3)(i)) as written: the opinion in the IFC annexure, or the exemption statement.'),
  F('eauditor', 'QUAL_COUNT', '2 Number of qualifications / reservations / adverse remarks', 'count', 'Number of qualifications/reservations/adverse remarks/disclaimers in the report (0 when the opinion is unmodified and there are none).'),
  ...Array.from({ length: QUAL_MAX }, (_, i) => [
    F('eauditor', `QUAL_TYPE_${i + 1}`, `2 Remark ${i + 1} — type`, 'enum', `Only when qualified: type of remark ${i + 1}: one of ${QUAL_OPTIONS.join(' | ')}.`, { options: QUAL_OPTIONS }),
    F('eauditor', `QUAL_COMMENT_${i + 1}`, `2 Remark ${i + 1} — the auditor's comment`, 'text', `Only when qualified: the auditor's comment for remark ${i + 1}.`),
  ]).flat(),

  // Board's report.
  F('eboard', 'BOARD_MEETINGS', 'Board meetings held during the year', 'meetings', 'Every board meeting held in the financial year: [{"date":"DD/MM/YYYY","total":<directors on the board then>,"attended":<directors present>}]. Use the attendance table if printed.'),
  F('eboard', 'CM_COUNT', 'Number of committee meetings held during the year', 'count', 'Total committee meetings held, only if stated.'),
  F('eboard', 'EMP_FEMALE', 'Number of women employees', 'count', 'Number of women employees, only if stated (POSH / Maternity Benefit disclosure).'),
  F('eboard', 'EMP_MALE', 'Number of men employees', 'count', 'Number of men employees, only if stated.'),
  F('eboard', 'EMP_TRANSGENDER', 'Number of transgender employees', 'count', 'Number of transgender employees, only if stated.'),
  F('eboard', 'MATERIAL_CHANGES', 'Material changes after the year end up to the report date', 'text', 'Material changes and commitments after the year end, as written ("None" if the report says there were none).'),
  F('eboard', 'DIRECTOR_CHANGES', 'Directors / KMP appointed or resigned during the year', 'text', 'Directors / KMP appointed, re-appointed or resigned in the year, as written ("None" if the report says so).'),
  F('eboard', 'FRAUDS', 'Frauds reported by the auditor under section 143(12)', 'text', 'Frauds reported by the auditors under s.143(12), as written ("Nil" if the report says none).'),
  F('eboard', 'IBC', 'Applications or proceedings under the Insolvency and Bankruptcy Code, 2016', 'text', 'Statement on IBC applications/proceedings, as written.'),
  F('eboard', 'NATURE_CHANGE', 'Change in the nature of business during the year', 'text', 'Statement on change in the nature of business, as written.'),
  F('eboard', 'ORDERS', 'Significant orders passed by regulators, courts or tribunals', 'text', 'Significant and material orders by regulators/courts/tribunals, as written ("None" if the report says none).'),
  F('eboard', 'WEBSITE', 'Company website', 'text', 'The web address where the annual return is placed (s.92(3)/134(3)(a)), only if printed.'),
  F('eboard', 'POSH_STATEMENT', 'POSH Act statement', 'text', 'The statement on the Sexual Harassment of Women at Workplace (POSH) Act, as written.'),
  F('eboard', 'DIRECTOR_LOAN_DECLARATION', 'Directors declared the money they lent was not borrowed', 'yesno', '"Yes" ONLY if the report or notes say the director(s) declared in writing that the money lent was not borrowed (Rule 2(1)(c)(viii)); "No" only if it says no such declaration was given; else null.'),
  F('eboard', 'S186_DETAILS', 'Brief particulars of loans, guarantees and investments under section 186', 'text', 'Particulars of loans, guarantees and investments under s.186, as written.'),

  // AOC-2.
  F('aoc2', 'ROWS', 'Related-party contracts at arm’s length (AOC-2)', 'rows', 'Contracts/arrangements with related parties under s.188(1) at arm\'s length, from Form AOC-2 annexed to the Board\'s report or the related-party note. NOT a director\'s remuneration as director, NOT loans/interest/guarantees/reimbursements. Each: {"name","id" (PAN/CIN only if printed, else ""),"relationship","nature" (one of the 7 natures listed),"duration","terms" (salient terms with amount),"approvalDate" (DD/MM/YYYY or ""),"advance" (number, "0" if none)}. [] when the report says there were none.'),

  // AOC-4 declaration (shared by AOC-4 step 2, AOC-2 and the Board's report).
  F('aoc4', 'BOARD_RESOLUTION_NO', 'Declaration — board resolution number', 'resno', 'Board resolution number approving the financial statements / Board\'s report, only if printed (max 10 characters).'),
  F('aoc4', 'BOARD_RESOLUTION_DATE', 'Declaration — board resolution date', 'date', 'Date of the board meeting/resolution that approved the financial statements (the date the Board\'s report / financial statements were signed), DD/MM/YYYY.'),
];
export const FIELD_BY = Object.fromEntries(FIELDS.map(f => [`${f.formType}:${f.key}`, f]));
export const FORM_TYPES = ['eauditor', 'eboard', 'aoc2', 'aoc4'];

// ───────────────────────── prompt ─────────────────────────

export const SYSTEM_PROMPT = 'You read an Indian company\'s signed annual documents (financial statements, independent auditor\'s report with '
  + 'its annexures, Board\'s report with its annexures) and pull out facts for MCA e-forms AOC-4 / AOC-2. '
  + 'RULES: (1) Never invent, assume or use a standard wording: every value must be supported by the document. '
  + '(2) Every non-null value needs "quote": a short VERBATIM extract (max 200 characters) copied from the document that supports it, '
  + 'and "page": the 1-based page number of the PDF where that quote is. (3) If a fact is not in the document, give null for that key. '
  + '(4) Dates DD/MM/YYYY. Counts as integers. (5) Text values: plain English, the substance as written, at most 1500 characters. '
  + 'Reply with JSON only, no markdown.';

export function buildPrompt() {
  const group = ft => FIELDS.filter(f => f.formType === ft).map(f => `  "${f.key}": ${f.ask}`).join('\n');
  return [
    'Return exactly this JSON shape (each key either null or {"value":…, "quote":"…", "page":N}):',
    '{"eauditor":{KEY:…}, "eboard":{KEY:…}, "aoc2":{"ROWS":…}, "aoc4":{KEY:…}}',
    'For eauditor.OPINION also add "type": "unmodified" | "qualified" | "adverse" | "disclaimer".',
    '',
    'eauditor (Independent Auditor\'s Report):', group('eauditor'),
    '',
    'eboard (Board\'s / Directors\' report):', group('eboard'),
    '',
    'aoc2:', group('aoc2'),
    `The 7 allowed natures (copy one exactly): ${NATURES.map((n, i) => `${i + 1}. ${n}`).join(' ; ')}`,
    '',
    'aoc4 (declaration):', group('aoc4'),
  ].join('\n');
}

// ───────────────────────── post-validation ─────────────────────────

const squash = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const clean = s => String(s ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

// Any of 2025-09-30 / 30-9-2025 / 30.09.25 → 30/09/2025; '' if not a real date or after `today`.
export function toDDMMYYYY(v, today = new Date()) {
  const d = AOC2.toDDMMYYYY(v);
  if (!d) return '';
  const [dd, mm, yy] = d.split('/');
  return +(yy + mm + dd) > today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate() ? '' : d;
}

function toCount(v) {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 ? v : null;
  const s = String(v ?? '').trim();
  return /^\d{1,6}$/.test(s) ? Number(s) : null;
}

function cleanMeetings(v, today) {
  if (!Array.isArray(v)) return null;
  const out = [];
  for (const m of v) {
    const date = toDDMMYYYY(m?.date, today), total = toCount(m?.total), attended = toCount(m?.attended);
    if (!date || !total || attended == null || attended > total) continue;
    if (!out.some(x => x.date === date)) out.push({ date, total, attended });
  }
  const key = d => d.split('/').reverse().join('');
  out.sort((a, b) => key(a.date).localeCompare(key(b.date)));
  return out.length ? out : null;
}

const RELATIVE = /relative|wife|husband|spouse|son|daughter|father|mother|brother|sister|firm|company|ltd|limited|llp|huf|partner|proprietor|trust/i;
const BODY_CORP = /\b(ltd|limited|llp|inc|corp|corporation|gmbh|plc|pte|company|co)\b/i;

// Classifies one row: {row} for a s.188 contract, {excluded: reason} for a legitimate exclusion (loan, interest,
// guarantee, reimbursement, a director's own pay as director), {invalid: reason} when it cannot be classified.
export function classifyContract(r, today) {
  if (!r || typeof r !== 'object') return { invalid: 'not a contract row' };
  const s = k => clean(r[k]).replace(/\s+/g, ' ');
  const name = s('name').slice(0, 160), relationship = s('relationship').slice(0, 160), terms = s('terms').slice(0, 500);
  if (/loan|interest|deposit|guarantee|reimburs/i.test(s('nature'))) return { excluded: 'loans, interest, deposits, guarantees and reimbursements are not s.188 contracts' };
  const nature = AOC2.matchNature(r.nature);
  if (!name) return { invalid: 'no party name' };
  // Explanation (a) to s.188(1): a director's remuneration as director is not a related-party contract.
  const ownPay = /director/i.test(relationship) && !RELATIVE.test(relationship) && /salary|remuneration|sitting fee/i.test(terms + ' ' + s('nature'));
  if (ownPay && (!nature || nature === NATURES[3])) return { excluded: 'a director\'s remuneration as director is not a s.188 contract' };
  if (!nature) return { invalid: `nature "${s('nature').slice(0, 60)}" is not one of the 7 s.188 natures` };
  let id = s('id').toUpperCase().slice(0, 50);
  if (/^\d{8}$/.test(id) && !BODY_CORP.test(name)) id = '';          // a DIN is not accepted by MCA's AOC-2 Excel
  const advance = s('advance').replace(/\/-$/, '').replace(/[,₹\s]|rs\.?|inr/gi, '');
  return { row: {
    name, id, relationship, nature,
    duration: s('duration').slice(0, 160), terms,
    approvalDate: toDDMMYYYY(r.approvalDate, today),
    advance: /^\d{1,15}(\.\d{1,2})?$/.test(advance) ? advance : '0',
  } };
}

// A s.188 contract row, or null when it is not one (director's own pay, loans, unknown nature, no name).
export function cleanContract(r, today) { return classifyContract(r, today).row || null; }

/** Splits Claude's rows into s.188 contracts, legitimate exclusions and rows that cannot be classified. */
export function classifyRows(raw, today) {
  const rows = [], excluded = [], invalid = [];
  for (const r of raw) {
    const c = classifyContract(r, today);
    const name = String(r?.name ?? '').trim().slice(0, 80) || '(no name)', nature = String(r?.nature ?? '').trim().slice(0, 60);
    if (c.row) rows.push(c.row);
    else if (c.excluded) excluded.push({ name, nature, reason: c.excluded });
    else invalid.push({ name, nature, reason: c.invalid });
  }
  return { rows, excluded, invalid };
}

/** Checks one value for a field. Returns the cleaned value, or undefined when it is not acceptable. */
export function validateValue(field, raw, today = new Date()) {
  if (raw === null || raw === undefined) return undefined;
  switch (field.kind) {
    case 'text': {
      if (typeof raw === 'object') return undefined;
      const t = clean(raw);
      return t && t.length <= MAX_TEXT ? t : t ? t.slice(0, MAX_TEXT) : undefined;
    }
    case 'count': { const n = toCount(raw); return n == null ? undefined : String(n); }
    case 'yesno': { const t = String(raw).trim(); return /^yes$/i.test(t) ? 'Yes' : /^no$/i.test(t) ? 'No' : undefined; }
    case 'enum': return (field.options || []).find(o => squash(o) === squash(raw));
    case 'date': return toDDMMYYYY(raw, today) || undefined;
    case 'resno': { const t = String(raw ?? '').trim(); return t && t.length <= 10 && !/\n/.test(t) ? t : undefined; }
    case 'meetings': return cleanMeetings(raw, today) || undefined;
    case 'rows': {
      if (!Array.isArray(raw)) return undefined;
      if (raw.length === 0) return [];                       // the document says there are none
      // Rows that cannot be classified, or a list where nothing is a s.188 contract, never become an explicit "None".
      const { rows, invalid } = classifyRows(raw, today);
      return invalid.length || !rows.length ? undefined : rows;
    }
    default: return undefined;
  }
}

const normQuote = q => String(q ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const MIN_QUOTE = 8;                                   // normalised characters: shorter is not proof
const toPage = p => { const n = Number(p); return p !== null && p !== '' && Number.isInteger(n) && n >= 1 && n <= 5000 ? n : null; };

/**
 * Turns Claude's JSON into a flat list of checked findings: [{formType, key, label, value, quote, page}].
 * Drops values without a quote, of the wrong format, or (when `sourceText` is given) whose quote is not in it.
 * Also returns `dropped` [{formType,key,reason}] and `opinionType`.
 */
export function postProcess(json, { sourceText, today = new Date() } = {}) {
  const out = [], dropped = [];
  const src = sourceText ? normQuote(sourceText) : null;
  const j = json && typeof json === 'object' ? json : {};
  const raw = (ft, key) => { const g = j[ft]; return g && typeof g === 'object' ? g[key] : undefined; };
  const op = raw('eauditor', 'OPINION');
  let opinionType = op && typeof op === 'object' ? String(op.type || '').trim().toLowerCase() : '';
  if (!OPINION_TYPES.includes(opinionType)) {
    const t = squash(op && typeof op === 'object' ? op.value : '');
    opinionType = /\b(disclaimer|do not express an opinion)\b/.test(t) ? 'disclaimer'
      : /\badverse opinion\b/.test(t) ? 'adverse'
      : /\b(unqualified|unmodified)\b/.test(t) ? 'unmodified'
      : /\bqualified\b|\bexcept for\b/.test(t) ? 'qualified'
      : /\btrue and fair\b/.test(t) ? 'unmodified' : '';
  }
  const modified = opinionType && opinionType !== 'unmodified';

  for (const field of FIELDS) {
    const item = raw(field.formType, field.key);
    if (item === undefined || item === null) continue;
    const drop = reason => dropped.push({ formType: field.formType, key: field.key, reason });
    if (typeof item !== 'object' || Array.isArray(item)) { drop('not in {value, quote, page} form'); continue; }
    if (item.value === null || item.value === undefined || item.value === '') continue;
    const quote = clean(item.quote).replace(/\s+/g, ' ').slice(0, MAX_QUOTE);
    if (!quote) { drop('no quote from the document'); continue; }
    if (normQuote(quote).length < MIN_QUOTE) { drop('quote too short'); continue; }
    if (src && normQuote(quote).length >= 8 && !src.includes(normQuote(quote).slice(0, 120))) { drop('quote not found in the document'); continue; }
    const page = toPage(item.page);
    if (!page) { drop('no page'); continue; }
    // Basis and remarks belong only to a modified opinion (the unmodified basis text is standard and built).
    if (!modified && (field.key === 'BASIS' || /^QUAL_(TYPE|COMMENT)_/.test(field.key))) { drop('opinion is not modified'); continue; }
    if (field.kind === 'rows' && Array.isArray(item.value) && item.value.length) {
      const { rows, excluded, invalid } = classifyRows(item.value, today);
      for (const x of invalid) drop(`row "${x.name}" (${x.nature || 'no nature'}): ${x.reason}`);
      if (invalid.length) { drop('some contracts could not be classified, enter them by hand'); continue; }
      if (!rows.length) { drop('no row is a s.188 contract'); continue; }
      if (excluded.length) drop(`${excluded.length} row(s) were not s.188 contracts (${excluded.map(x => x.name).join(', ').slice(0, 200)})`);
    }
    let value = validateValue(field, item.value, today);
    if (value === undefined) { drop('value has the wrong format'); continue; }
    if (field.key === 'OPINION' && opinionType) {
      const word = opinionType[0].toUpperCase() + opinionType.slice(1);
      if (!new RegExp(`^${opinionType}\\b`, 'i').test(value)) value = `${word} opinion. ${value}`;
    }
    out.push({ formType: field.formType, key: field.key, label: field.label, value, quote, page });
  }
  // Remarks beyond the stated count are dropped.
  const qc = out.find(x => x.key === 'QUAL_COUNT');
  if (qc) {
    const n = Number(qc.value);
    for (let i = out.length - 1; i >= 0; i--) {
      const m = out[i].key.match(/^QUAL_(TYPE|COMMENT)_(\d)$/);
      if (m && Number(m[2]) > n) { dropped.push({ formType: 'eauditor', key: out[i].key, reason: 'beyond the number of remarks' }); out.splice(i, 1); }
    }
  }
  return { findings: out, dropped, opinionType: opinionType || null };
}

// ───────────────────────── proposals and saving ─────────────────────────

export const isTestLabel = l => /^\s*TEST DATA\b/i.test(String(l || ''));
export const isAiLabel = l => /^\s*AI from document\b/i.test(String(l || ''));
// Text saved by the verbatim step (report-verbatim.js) and placeholders: a reading may replace them too.
export const isVerbatimLabel = l => /^\s*(Verbatim from document|PLACEHOLDER)\b/i.test(String(l || ''));
// A machine-labelled row the CA has not edited (POST /api/company-answers sets source 'ca' when the CA changes a
// value but keeps the stored label): only such a row may be replaced without force.
const machineRow = cur => (isTestLabel(cur.label) || isAiLabel(cur.label) || isVerbatimLabel(cur.label)) && cur.source !== 'ca';
const asStored = v => (Array.isArray(v) || (v && typeof v === 'object') ? JSON.stringify(v) : String(v ?? ''));
const sameValue = (a, b) => squash(asStored(a)) === squash(asStored(b));

function currentRow(db, cin, formType, key) {
  return db.prepare('SELECT label, value, source FROM company_answers WHERE cin = ? AND form_type = ? AND field_key = ?').get(cin, formType, key) || null;
}

/** Findings + the company's saved answers → proposals with the action the dashboard pre-selects. */
export function buildProposals(db, cin, findings) {
  return findings.map(f => {
    const cur = currentRow(db, cin, f.formType, f.key);
    const curVal = cur ? cur.value : null;
    const blank = curVal == null || String(curVal).trim() === '';
    let action;
    if (blank) action = 'fill';
    else if (sameValue(curVal, f.value)) action = 'keep';
    else if (machineRow(cur)) action = 'replace-test';
    else action = 'keep';
    return { ...f, current: curVal, currentLabel: cur ? cur.label : null, action };
  });
}

const aiLabel = (page, label) => `AI from document (p.${page || '?'}): ${label}`.slice(0, 300);

/**
 * Saves accepted proposals as company answers. Never overwrites a real (non-TEST, non-AI) non-blank answer unless the
 * item has force:true. Values are checked again (the client may have changed them). Returns {saved, skipped}.
 */
export function saveItems(db, cin, items, { today = new Date() } = {}) {
  const up = db.prepare(`INSERT INTO company_answers (cin, form_type, field_key, label, value, source, updated_at)
                         VALUES (?, ?, ?, ?, ?, 'report-ai', CURRENT_TIMESTAMP)
                         ON CONFLICT(cin, form_type, field_key) DO UPDATE SET label = excluded.label, value = excluded.value,
                           source = excluded.source, updated_at = CURRENT_TIMESTAMP`);
  const saved = [], skipped = [];
  for (const it of items || []) {
    const field = FIELD_BY[`${it?.formType}:${it?.key}`];
    if (!field) { skipped.push({ formType: it?.formType, key: it?.key, reason: 'not a field the AI may fill' }); continue; }
    let value = typeof it.value === 'string' && /^(rows|meetings)$/.test(field.kind) ? safeParse(it.value) : it.value;
    value = validateValue(field, value, today);
    if (value === undefined) { skipped.push({ formType: field.formType, key: field.key, reason: 'value has the wrong format' }); continue; }
    const cur = currentRow(db, cin, field.formType, field.key);
    const real = cur && String(cur.value ?? '').trim() !== '' && !machineRow(cur);
    if (real && !it.force) { skipped.push({ formType: field.formType, key: field.key, reason: 'the company already has an answer (use force to replace it)' }); continue; }
    // The "AI from document" label needs the proof (quote + page); anything else is the CA's own entry.
    const page = toPage(it.page);
    const quoted = normQuote(it.quote).length >= MIN_QUOTE && page;
    up.run(cin, field.formType, field.key, quoted ? aiLabel(page, field.label) : `Entered by CA: ${field.label}`.slice(0, 300), asStored(value));
    saved.push({ formType: field.formType, key: field.key });
  }
  return { saved, skipped };
}
function safeParse(s) { try { return JSON.parse(s); } catch { return undefined; } }

// ───────────────────────── extraction with cache ─────────────────────────

let extractor = extractReportFields;
/** Tests: replace the Claude call. Pass null to restore. */
export function _setExtractor(fn) { extractor = fn || extractReportFields; cache.clear(); }

// One extraction per document (a 30-60 s call): the three dashboard tabs share it. In-flight calls are shared too.
const cache = new Map();                     // hash → {at, promise}
const CACHE_MS = 60 * 60 * 1000;
const CACHE_MAX = 20;

/**
 * @param input {pdfBase64} | {text}
 * @returns {findings, dropped, opinionType, model, cached}
 */
export async function readDocument(input, { refresh = false, today } = {}) {
  const hash = createHash('sha256').update(input.pdfBase64 ? 'pdf:' + input.pdfBase64 : 'text:' + String(input.text || '')).digest('hex');
  const hit = cache.get(hash);
  if (hit && !refresh && Date.now() - hit.at < CACHE_MS) return { ...(await hit.promise), cached: true };
  const promise = (async () => {
    const r = await extractor(input, { system: SYSTEM_PROMPT, prompt: buildPrompt() });
    const p = postProcess(r?.json, { sourceText: input.text || null, today });
    return { ...p, model: r?.model || null };
  })();
  cache.set(hash, { at: Date.now(), promise });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  try { return { ...(await promise), cached: false }; } catch (err) { cache.delete(hash); throw err; }
}
