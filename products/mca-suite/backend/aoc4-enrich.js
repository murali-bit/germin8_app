// AOC-4 enrich step (spec v6): fills what the financial statements do not print, from company records and
// rules that work a value out from figures already read, and lists what the CA should check.
// Never invents a value: anything not found stays empty and becomes a check item.
//
// Pure apart from the `lookups` the caller passes (DB / FileSure reads), so tests use fakes:
//   lookups.resolveCin(name)          -> {cin, source, candidates} | null
//   lookups.findAdtSrn({cin, frn})    -> {srn, from} | null
//   lookups.firmPan(frn)              -> {pan, name?, from} | null
// Every lookup may be sync or async and may be missing.

import { getCode as npcsCode } from './npcs.js';

export const CIN_RE = /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;
export const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
export const SRN_RE = /^[A-Z]{1,2}\d{7,8}$/;

const PERIODS = ['current', 'previous'];

/**
 * One printed unit in rupees: the smallest step the statements print (meta.printedPrecision, measured from the
 * decimals of the printed figures by postProcessAoc4), else the unit multiplier. At least ₹1.
 */
export function printedTolerance(meta = {}) {
  const p = Number(meta.printedPrecision);
  if (Number.isFinite(p) && p > 0) return Math.max(1, p);
  return Math.max(1, Number(meta.unitMultiplier) || 1);
}
const round2 = n => Math.round(n * 100) / 100;
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v.replace(/,/g, ''))) ? Number(v.replace(/,/g, '')) : 0));
const blank = v => v === undefined || v === null || String(v).trim() === '';
const inr = n => '₹' + Math.round(n).toLocaleString('en-IN');
const perLabel = per => (per === 'current' ? 'current year' : 'previous year');

// ─── Company names ──────────────────────────────────────────────────────────

// "Dummy-Test Pvt. Ltd." and "DUMMY TEST PRIVATE LIMITED" compare equal.
export function normaliseCompanyName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\bprivate\b/g, 'pvt')
    .replace(/\blimited\b/g, 'ltd')
    .replace(/\bcompany\b/g, 'co')
    .replace(/\s+/g, '')
    .trim();
}

// ─── Break-up groups ────────────────────────────────────────────────────────
// Each group must add up to its balance-sheet line (same arithmetic as extension/js/aoc4-checks.js).
// `specific` lines (related parties / directors) win over `generic` ones ("other loans and advances",
// "from other parties") when the same amount was read into both.
export const BREAKUP_GROUPS = [
  {
    id: 'lt-borrowings', label: 'Long-term borrowings (unsecured) break-up', line: 'LONG_TERM_BORROWINGS',
    plus: ['BS_UNSEC_LT_BONDS', 'BS_UNSEC_LT_BANK_LOANS', 'BS_UNSEC_LT_OTHER_TERM_LOANS', 'BS_UNSEC_LT_DEFERRED_PAYMENT',
      'BS_UNSEC_LT_DEPOSITS', 'BS_UNSEC_LT_RELATED_PARTIES', 'BS_UNSEC_LT_FINANCE_LEASE', 'BS_UNSEC_LT_OTHER_ADVANCES'],
    minus: [],
    specific: ['BS_UNSEC_LT_RELATED_PARTIES'],
    generic: ['BS_UNSEC_LT_OTHER_ADVANCES', 'BS_UNSEC_LT_OTHER_TERM_LOANS'],
    partial: true,   // secured borrowings are not in this break-up
  },
  {
    id: 'st-borrowings', label: 'Short-term borrowings (unsecured) break-up', line: 'SHORT_TERM_BORROWINGS',
    plus: ['BS_UNSEC_ST_BANK_DEMAND', 'BS_UNSEC_ST_OTHER_DEMAND', 'BS_UNSEC_ST_RELATED_PARTIES', 'BS_UNSEC_ST_DEPOSITS',
      'BS_UNSEC_ST_OTHER_ADVANCES'],
    minus: [],
    specific: ['BS_UNSEC_ST_RELATED_PARTIES'],
    generic: ['BS_UNSEC_ST_OTHER_ADVANCES', 'BS_UNSEC_ST_OTHER_DEMAND'],
    partial: true,
  },
  {
    id: 'trade-receivables', label: 'Trade receivables break-up', line: 'TRADE_RECEIVABLES',
    plus: ['BS_TRADE_RECEIVABLES_SECURED_GOOD', 'BS_TRADE_RECEIVABLES_UNSECURED_GOOD', 'BS_TRADE_RECEIVABLES_DOUBTFUL'],
    minus: ['BS_TRADE_RECEIVABLES_PROVISION'],
    specific: [], generic: [],
    partial: false,
  },
  {
    id: 'lt-loans-given', label: 'Long-term loans & advances given break-up', line: 'LONG_TERM_LOANS_ADVANCES',
    plus: ['BS_LT_LOANS_GOOD_CAPITAL_ADVANCES', 'BS_LT_LOANS_GOOD_RELATED_PARTIES', 'BS_LT_LOANS_GOOD_OTHER',
      'BS_LT_LOANS_DOUBTFUL_CAPITAL_ADVANCES', 'BS_LT_LOANS_DOUBTFUL_RELATED_PARTIES', 'BS_LT_LOANS_DOUBTFUL_OTHER'],
    minus: ['BS_LT_LOANS_GOOD_PROVISION_RELATED', 'BS_LT_LOANS_GOOD_PROVISION_OTHER',
      'BS_LT_LOANS_DOUBTFUL_PROVISION_RELATED', 'BS_LT_LOANS_DOUBTFUL_PROVISION_OTHER'],
    specific: ['BS_LT_LOANS_GOOD_RELATED_PARTIES', 'BS_LT_LOANS_DOUBTFUL_RELATED_PARTIES'],
    generic: ['BS_LT_LOANS_GOOD_OTHER', 'BS_LT_LOANS_DOUBTFUL_OTHER'],
    partial: true,   // secured loans given are not in this break-up
  },
];

const keyText = k => k.replace(/^BS_(UNSEC_(LT|ST)_|LT_LOANS_|TRADE_RECEIVABLES_)/, '').replace(/_/g, ' ').toLowerCase();

// ctx: {tol, derived[], uncertain[], notes[], sticky[], fresh[], sources{}}
// sticky = checks that record what a rule did (kept across runs); fresh = conditions recomputed every run.
export function balanceBreakups(data, ctx) {
  const br = data.balanceSheetBreakup;
  if (!br || typeof br !== 'object') return;
  const v = (k, per) => num(br[k]?.[per]);
  for (const g of BREAKUP_GROUPS) {
    for (const per of PERIODS) {
      const b = data.balanceSheet?.[per];
      if (!b || blank(b[g.line])) continue;
      const line = num(b[g.line]);
      const total = () => g.plus.reduce((s, k) => s + v(k, per), 0) - g.minus.reduce((s, k) => s + v(k, per), 0);
      let over = round2(total() - line);

      // One amount read into a specific and a generic line, and the group is over by exactly that amount.
      if (over > ctx.tol) {
        for (const s of g.specific) {
          const amt = v(s, per);
          if (!amt) continue;
          // The two amounts must be the same figure (not merely close), and the group over by that figure.
          const dup = g.generic.find(k => Math.abs(v(k, per) - amt) < 0.5 && Math.abs(over - v(k, per)) <= ctx.tol);
          if (!dup) continue;
          const removed = v(dup, per);
          br[dup][per] = 0;
          const path = `balanceSheetBreakup.${dup}.${per}`;
          ctx.derived.push(path);
          ctx.sources[path] = 'derived';
          ctx.notes.push(`${g.label} (${perLabel(per)}): ${inr(removed)} was read into both "${keyText(s)}" and "${keyText(dup)}"; kept it under ${keyText(s)} and set ${keyText(dup)} to 0.`);
          ctx.sticky.push({
            id: `breakup-duplicate:${g.id}:${per}`, level: 'info',
            message: `${g.label} (${perLabel(per)}): the same ${inr(removed)} was in "${keyText(s)}" and "${keyText(dup)}". Kept ${keyText(s)}, cleared ${keyText(dup)} so the break-up equals the balance sheet.`,
            paths: [path, `balanceSheetBreakup.${s}.${per}`],
          });
          over = round2(total() - line);
          break;
        }
      }

      const sum = round2(total());
      const anyLine = [...g.plus, ...g.minus].some(k => v(k, per));
      if (!anyLine && !line) continue;
      if (Math.abs(sum - line) <= ctx.tol) continue;
      const under = sum < line;
      ctx.fresh.push({
        id: `breakup-mismatch:${g.id}:${per}`,
        level: under && g.partial ? 'info' : 'warn',
        message: !anyLine
          ? `${g.label} (${perLabel(per)}) is empty but the balance sheet shows ${inr(line)} — fill the break-up${g.partial ? ' (secured amounts are not part of it)' : ''}.`
          : `${g.label} (${perLabel(per)}) adds up to ${inr(sum)} but the balance sheet shows ${inr(line)}${under && g.partial ? ' — fine only if the difference is secured' : ''}. Check the lines.`,
        paths: [`balanceSheet.${per}.${g.line}`, ...[...g.plus, ...g.minus].filter(k => v(k, per)).map(k => `balanceSheetBreakup.${k}.${per}`)],
      });
    }
  }
}

// ─── AS-18 related-party transactions ───────────────────────────────────────
// Rows read from the related-party note: {name, relationship, nature, current, previous}.
const BALANCE_ROW = /closing|balance|outstanding|as at|year[- ]end/i;

/** A row copied from the extraction skeleton (hint text with "|" alternatives) or without any amount. */
export function isPlaceholderRow(r) {
  if (!r || typeof r !== 'object') return true;
  if (/\|/.test(`${r.relationship || ''}`) || /^related party$/i.test(String(r.name || '').trim())) return true;
  return !num(r.current) && !num(r.previous);
}

export function relatedPartyRows(data) {
  return (Array.isArray(data.relatedPartyTransactions) ? data.relatedPartyTransactions : [])
    .filter(r => !isPlaceholderRow(r) && !BALANCE_ROW.test(`${r.nature || ''}`));
}

export function relatedPartyTotal(data, per = 'current') {
  return round2(relatedPartyRows(data).reduce((s, r) => s + Math.abs(num(r[per])), 0));
}

const AS18_FIELDS = [['financialParametersBS', 'FP_BS_22'], ['financialParametersPL', 'FP_PL_RELATED_PARTY_GROSS']];

export function applyRelatedPartyTotals(data, ctx) {
  const total = relatedPartyTotal(data, 'current');
  if (!(total > 0)) {
    // Transactions exist (or their rows were never read) but there is nothing to add up: ask, never guess.
    const any = /^yes$/i.test(String(data.relatedParty?.ANY_TRANSACTION || '').trim());
    const empty = AS18_FIELDS.filter(([sec, key]) => !num(data[sec]?.[key])).map(([sec, key]) => `${sec}.${key}`);
    if (any && empty.length) {
      ctx.fresh.push({
        id: 'as18-missing', level: 'warn',
        message: 'Related-party transactions exist but the AS-18 gross amount is 0 — enter it from the related-party note or rescan.',
        paths: empty,
      });
    }
    return;
  }
  for (const [sec, key] of AS18_FIELDS) {
    data[sec] = data[sec] && typeof data[sec] === 'object' ? data[sec] : {};
    const path = `${sec}.${key}`;
    const cur = num(data[sec][key]);
    if (!cur) {
      data[sec][key] = total;
      ctx.derived.push(path);
      ctx.sources[path] = 'derived';
      ctx.sticky.push({
        id: `as18-total:${key}`, level: 'info',
        message: `Gross related-party transactions (AS-18) ${inr(total)} = sum of this year's transactions in the related-party note (balances not counted).`,
        paths: [path],
      });
    } else if (Math.abs(cur - total) > ctx.tol) {
      ctx.fresh.push({
        id: `as18-differs:${key}`, level: 'info',
        message: `${key} is ${inr(cur)} but this year's related-party transactions in the note add up to ${inr(total)}. Check.`,
        paths: [path],
      });
    }
  }
  const rp = data.relatedParty || (data.relatedParty = {});
  if (blank(rp.ANY_TRANSACTION)) {
    rp.ANY_TRANSACTION = 'Yes';
    ctx.derived.push('relatedParty.ANY_TRANSACTION');
    ctx.sources['relatedParty.ANY_TRANSACTION'] = 'derived';
  }
}

// ─── Depreciation: face P&L vs the fixed-assets note ────────────────────────
// The face P&L prints depreciation rounded on its own; the fixed-assets note's "charge for the year" (tangible +
// intangible, read into data.depreciationNote) is the figure filed. Within one printed unit the note total is
// taken and total expenses / profit before and after tax move by the same difference; a bigger gap is a check.
export function reconcileDepreciationNote(data, ctx) {
  const note = data.depreciationNote;
  if (!note || typeof note !== 'object') return;
  for (const per of PERIODS) {
    const p = data.profitLoss?.[per];
    const dn = note[per];
    if (!p || typeof dn !== 'number' || !Number.isFinite(dn) || dn <= 0 || blank(p.DEPRECIATION)) continue;
    const face = num(p.DEPRECIATION);
    const diff = round2(dn - face);
    if (Math.abs(diff) < 0.5) continue;
    const path = `profitLoss.${per}.DEPRECIATION`;
    if (Math.abs(diff) > ctx.tol) {
      ctx.fresh.push({
        id: `depreciation-note:${per}`, level: 'warn',
        message: `Depreciation (${perLabel(per)}) is ${inr(face)} on the P&L but the fixed-assets note charges ${inr(dn)}. Check which is right.`,
        paths: [path],
      });
      continue;
    }
    const changed = [path];
    p.DEPRECIATION = round2(dn);
    if (!blank(p.TOTAL_EXPENSES)) { p.TOTAL_EXPENSES = round2(num(p.TOTAL_EXPENSES) + diff); changed.push(`profitLoss.${per}.TOTAL_EXPENSES`); }
    for (const k of ['PROFIT_BEFORE_TAX', 'PROFIT_AFTER_TAX']) {
      if (!blank(p[k])) { p[k] = round2(num(p[k]) - diff); changed.push(`profitLoss.${per}.${k}`); }
    }
    const det = data.profitLossDetails?.PL_DEPRECIATION;
    if (det && typeof det === 'object' && Math.abs(num(det[per]) - face) <= ctx.tol) {
      det[per] = round2(dn);
      changed.push(`profitLossDetails.PL_DEPRECIATION.${per}`);
    }
    for (const c of changed) { ctx.derived.push(c); ctx.sources[c] = 'derived'; }
    ctx.notes.push(`Depreciation (${perLabel(per)}) printed as ${inr(face)} on the P&L; the fixed-assets note charges ${inr(dn)}, which is used (total expenses and profit adjusted by ${inr(Math.abs(diff))}).`);
    ctx.sticky.push({
      id: `depreciation-note:${per}`, level: 'info',
      message: `Depreciation (${perLabel(per)}) taken from the fixed-assets note (${inr(dn)}) instead of the rounded P&L figure (${inr(face)}); total expenses and profit moved by ${inr(Math.abs(diff))}.`,
      paths: changed,
    });
  }
}

// ─── PIN → district ─────────────────────────────────────────────────────────
// PIN prefix -> the main district of that city. A prefix also covers suburbs in neighbouring districts
// (parts of 600xxx, 560xxx, 700xxx …), so a district found this way is ALWAYS marked "to check".
// Cities with several districts on one prefix (Delhi, Mumbai, Hyderabad …) are deliberately absent.
const PIN_PREFIX_DISTRICT = {
  '560': 'Bengaluru', '600': 'Chennai', '700': 'Kolkata', '411': 'Pune', '380': 'Ahmedabad',
  '302': 'Jaipur', '226': 'Lucknow', '641': 'Coimbatore', '570': 'Mysuru', '625': 'Madurai',
  '440': 'Nagpur', '452': 'Indore', '462': 'Bhopal', '395': 'Surat', '390': 'Vadodara',
  '695': 'Thiruvananthapuram', '530': 'Visakhapatnam', '800': 'Patna', '160': 'Chandigarh',
};
// Cities that are their own district's headquarters (used when the PIN rule is not certain).
const DISTRICT_HQ = new Set([...Object.values(PIN_PREFIX_DISTRICT), 'Hyderabad', 'Ludhiana', 'Amritsar', 'Rajkot',
  'Nashik', 'Thane', 'Gurugram', 'Faridabad', 'Ghaziabad', 'Ranchi', 'Raipur', 'Dehradun', 'Guwahati', 'Vijayawada'
].map(c => c.toLowerCase()));
const CITY_ALIAS = {
  bangalore: 'Bengaluru', bengaluru: 'Bengaluru', madras: 'Chennai', calcutta: 'Kolkata', poona: 'Pune',
  mysore: 'Mysuru', gurgaon: 'Gurugram', trivandrum: 'Thiruvananthapuram', vizag: 'Visakhapatnam',
  baroda: 'Vadodara',
};
function cityName(city) {
  const c = String(city || '').trim().replace(/\s+/g, ' ');
  if (!c) return '';
  const alias = CITY_ALIAS[c.toLowerCase()];
  if (alias) return alias;
  return c.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

// -> {district, certain:false} or null when it cannot be told. Never certain: there is no 6-digit PIN table.
export function districtFromPin(pin, city) {
  const p = String(pin || '').replace(/\D/g, '');
  const c = cityName(city);
  const byPin = p.length === 6 ? PIN_PREFIX_DISTRICT[p.slice(0, 3)] : undefined;
  if (byPin && (!c || c.toLowerCase() === byPin.toLowerCase())) return { district: byPin, certain: false };
  if (c && DISTRICT_HQ.has(c.toLowerCase())) return { district: c, certain: false };
  return null;
}

// ─── Smaller rules ──────────────────────────────────────────────────────────

const squash = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

// Area that only repeats an address line (ignoring case and punctuation) is cleared.
function cleanAuditorArea(data, ctx) {
  const a = data.auditor;
  if (!a || blank(a.AUDITOR_AREA)) return;
  const area = squash(a.AUDITOR_AREA);
  const lines = [a.AUDITOR_ADDR1, a.AUDITOR_ADDR2].map(squash).filter(Boolean);
  if (!area || !lines.includes(area)) return;
  a.AUDITOR_AREA = '';
  ctx.derived.push('auditor.AUDITOR_AREA');
  ctx.sources['auditor.AUDITOR_AREA'] = 'derived';
  ctx.notes.push('Auditor area repeated an address line; cleared.');
}

const DIRECTOR_REL = /director|kmp|key managerial|key management|managing|whole[- ]?time|\bmd\b|\bceo\b|manager/i;
const PAY_NATURE = /salary|remuneration|sitting fee|commission|perquisite/i;

function managerialChecks(data, ctx) {
  const det = data.profitLossDetails || {};
  for (const per of PERIODS) {
    const amount = round2(relatedPartyRows(data)
      .filter(r => DIRECTOR_REL.test(`${r.relationship || ''} ${r.name || ''}`) && PAY_NATURE.test(String(r.nature || '')))
      .reduce((s, r) => s + Math.abs(num(r[per])), 0));
    if (!(amount > 0)) continue;
    if (num(det.PL_MANAGERIAL_REMUNERATION?.[per]) || num(data.profitLoss?.[per]?.MANAGERIAL_REMUNERATION)) continue;
    if (num(det.PL_EMPLOYEE_BENEFITS?.[per]) < amount) continue;   // cannot come out of employee benefits (same limit as the Yes action)
    ctx.fresh.push({
      id: `managerial:${per}`, level: 'warn',
      message: `Notes show directors' salary ${inr(amount)} (${perLabel(per)}) — is it managerial remuneration? Yes moves it out of employee benefits (totals stay the same).`,
      paths: [`profitLossDetails.PL_MANAGERIAL_REMUNERATION.${per}`, `profitLossDetails.PL_EMPLOYEE_BENEFITS.${per}`],
      action: { type: 'managerial-remuneration', per, amount },
    });
  }
}

// CATEGORY_DESC / HIGHEST_DESC = the official NPCS description of a valid code read from the document.
function npcsDescriptions(data, ctx) {
  const pp = data.principalProducts;
  if (!pp) return;
  for (const [codeKey, descKey] of [['CATEGORY_CODE', 'CATEGORY_DESC'], ['HIGHEST_CODE', 'HIGHEST_DESC']]) {
    const code = String(pp[codeKey] || '').trim();
    if (!/^\d{4}(\d{4})?$/.test(code)) continue;
    const hit = npcsCode(code);
    if (!hit || (codeKey === 'CATEGORY_CODE' && hit.level !== 'category')) continue;
    if (String(pp[descKey] || '').trim().toLowerCase() === hit.desc.toLowerCase()) continue;
    pp[descKey] = hit.desc;
    const path = `principalProducts.${descKey}`;
    ctx.derived.push(path);
    ctx.sources[path] = 'derived';
  }
}

const SUB_WORDS = /subsidiar|associate|joint venture|\bjv\b/i;

function hasSubsidiary(data, ctx) {
  const s = data.subsidiary || (data.subsidiary = {});
  if (!blank(s.HAS_SUBSIDIARY_OR_JV)) return;
  const path = 'subsidiary.HAS_SUBSIDIARY_OR_JV';
  const evidence = [];
  if (/^yes$/i.test(String(data.industry?.CONSOLIDATED_FS || '').trim())) evidence.push('consolidated statements are prepared');
  if (num(data.financialParametersBS?.FP_BS_17)) evidence.push('investment in subsidiary companies is shown');
  if (relatedPartyRows(data).some(r => SUB_WORDS.test(`${r.relationship || ''} ${r.name || ''}`))) evidence.push('the related-party list names a subsidiary / associate / JV');
  if (num(data.balanceSheet?.current?.NON_CURRENT_INVESTMENTS)) evidence.push('the company holds non-current investments');
  if (evidence.length) {
    ctx.fresh.push({ id: 'has-subsidiary', level: 'warn', message: `Has subsidiary / associate / JV? Not answered: ${evidence.join('; ')}.`, paths: [path] });
    return;
  }
  s.HAS_SUBSIDIARY_OR_JV = 'No';
  ctx.derived.push(path);
  ctx.uncertain.push(path);
  ctx.sources[path] = 'derived';
  ctx.sticky.push({ id: 'has-subsidiary', level: 'info', message: 'Has subsidiary / associate / JV set to "No": the notes and related-party list show none — to check.', paths: [path] });
}

// ─── Enrich ─────────────────────────────────────────────────────────────────

function addNotes(meta, notes) {
  if (!notes.length) return;
  if (Array.isArray(meta.notes)) meta.notes = [...meta.notes, ...notes.filter(n => !meta.notes.includes(n))];
  else {
    const prev = String(meta.notes || '');
    const add = notes.filter(n => !prev.includes(n));
    meta.notes = [prev, ...add].filter(Boolean).join(' ');
  }
}

function dedupeChecks(list) {
  const seen = new Map();
  for (const c of list) if (c && c.id && !seen.has(c.id)) seen.set(c.id, c);
  return [...seen.values()];
}

async function safe(fn, ...args) {
  if (typeof fn !== 'function') return null;
  try { return await fn(...args); } catch { return null; }
}

/** Runs only the document rules (no lookups) on a scan; used by reconcileForMca during the scan itself. */
export function applyDocumentRules(data, meta, { tol = 1 } = {}) {
  const ctx = { tol, derived: [], uncertain: [], notes: [], sticky: [], fresh: [], sources: {} };
  reconcileDepreciationNote(data, ctx);
  balanceBreakups(data, ctx);
  applyRelatedPartyTotals(data, ctx);
  cleanAuditorArea(data, ctx);
  return ctx;
}

/**
 * @param {object} data   merged scan data (without meta)
 * @param {object} meta   its meta (derived / uncertain / notes …)
 * @param {object} lookups  see top of file
 * @returns {Promise<{data, meta, sources, checks}>}  inputs are not modified
 */
export async function enrichAoc4(data, meta = {}, lookups = {}) {
  data = structuredClone(data || {});
  meta = structuredClone(meta || {});
  delete data.meta;
  const derived = Array.isArray(meta.derived) ? meta.derived : [];
  const uncertain = Array.isArray(meta.uncertain) ? meta.uncertain : [];
  const ctx = { tol: printedTolerance(meta), derived, uncertain, notes: [], sticky: [], fresh: [], sources: {} };
  const recordsFill = (path, obj, key, value, message) => {
    obj[key] = value;
    ctx.sources[path] = 'records';
    ctx.sticky.push({ id: `records:${path}`, level: 'info', message, paths: [path] });
  };
  const g = data.general || (data.general = {});
  const a = data.auditor || (data.auditor = {});

  // 1. CIN from company records / FileSure.
  if (blank(g.CIN)) {
    const name = String(g.COMPANY_NAME || '').trim();
    const r = name ? await safe(lookups.resolveCin, name) : null;
    const cin = String(r?.cin || '').trim().toUpperCase();
    if (CIN_RE.test(cin)) {
      recordsFill('general.CIN', g, 'CIN', cin, `CIN from ${r.source === 'filesure' ? 'FileSure (MCA master data)' : 'company records'} for "${name}" — confirm.`);
    } else {
      const cands = (r?.candidates || []).filter(c => c?.cin).slice(0, 5).map(c => `${c.name} (${c.cin})`);
      ctx.fresh.push({
        id: 'cin-missing', level: 'warn',
        message: cands.length ? `CIN not printed. Possible matches: ${cands.join('; ')} — pick one.` : 'CIN not printed in the documents and not found in company records — enter it.',
        paths: ['general.CIN'],
      });
    }
  }

  // 2–4. Document rules: depreciation note, break-ups, AS-18 total, auditor area.
  reconcileDepreciationNote(data, ctx);
  balanceBreakups(data, ctx);
  applyRelatedPartyTotals(data, ctx);
  cleanAuditorArea(data, ctx);

  // 5. Managerial remuneration question (never changed here).
  managerialChecks(data, ctx);

  // NPCS descriptions for codes read from the document.
  npcsDescriptions(data, ctx);

  const cin = String(g.CIN || '').trim().toUpperCase();
  const frn = String(a.AUDITOR_FIRM_REG || '').trim().toUpperCase();

  // 6. ADT-1 SRN from earlier filings / answers / drafts.
  if (blank(a.ADT_SRN)) {
    const r = cin ? await safe(lookups.findAdtSrn, { cin, frn }) : null;
    const srn = String(r?.srn || '').trim().toUpperCase();
    if (SRN_RE.test(srn)) {
      recordsFill('auditor.ADT_SRN', a, 'ADT_SRN', srn, `ADT-1 SRN from ${r.from || 'company records'} — confirm it is the SRN of the current auditor's appointment.`);
      if (r.uncertain) uncertain.push('auditor.ADT_SRN');
    } else {
      ctx.fresh.push({ id: 'adt-srn-missing', level: 'warn', message: "ADT-1 SRN (auditor's appointment) is not in the documents or company records — enter it.", paths: ['auditor.ADT_SRN'] });
    }
  }

  // 7. Auditor firm PAN remembered per FRN.
  if (blank(a.AUDITOR_PAN)) {
    const r = frn ? await safe(lookups.firmPan, frn) : null;
    const pan = String(r?.pan || '').trim().toUpperCase();
    if (PAN_RE.test(pan)) {
      recordsFill('auditor.AUDITOR_PAN', a, 'AUDITOR_PAN', pan, `Auditor PAN remembered for firm ${frn}${r.from ? ` (${r.from})` : ''}.`);
    } else {
      ctx.fresh.push({ id: 'auditor-pan-missing', level: 'warn', message: `Auditor${frn ? ` (firm ${frn})` : ''} PAN is not in the documents — enter it once; it is remembered for the firm.`, paths: ['auditor.AUDITOR_PAN'] });
    }
  }

  // 8. District from PIN + city.
  if (blank(a.AUDITOR_DISTRICT) && (!blank(a.AUDITOR_PIN) || !blank(a.AUDITOR_CITY))) {
    const d = districtFromPin(a.AUDITOR_PIN, a.AUDITOR_CITY);
    const path = 'auditor.AUDITOR_DISTRICT';
    if (d) {
      a.AUDITOR_DISTRICT = d.district;
      derived.push(path);
      ctx.sources[path] = 'derived';
      if (!d.certain) {
        uncertain.push(path);
        ctx.sticky.push({ id: 'district-guess', level: 'info', message: `Auditor district set to ${d.district} from the PIN / city — confirm (suburbs can lie in a neighbouring district).`, paths: [path] });
      }
    } else {
      ctx.fresh.push({ id: 'district-missing', level: 'warn', message: 'Auditor district could not be told from the PIN and city — enter it.', paths: [path] });
    }
  }

  // 9. Has subsidiary / JV.
  hasSubsidiary(data, ctx);

  // Bookkeeping: what enrich (and the scan-time rules) changed, kept in meta so a second run reports the same.
  const prevSources = meta.enrichSources && typeof meta.enrichSources === 'object' ? meta.enrichSources : {};
  const sources = { ...prevSources, ...ctx.sources };
  for (const [p, s] of Object.entries(sources)) if (s === 'derived') derived.push(p);
  const ruleChecks = dedupeChecks([...(Array.isArray(meta.ruleChecks) ? meta.ruleChecks : []), ...ctx.sticky]);
  const resolved = new Set(Array.isArray(meta.resolvedChecks) ? meta.resolvedChecks.map(String) : []);
  const checks = dedupeChecks([...ruleChecks, ...ctx.fresh]).filter(c => !resolved.has(c.id));

  addNotes(meta, ctx.notes);
  meta.derived = [...new Set(derived)];
  meta.uncertain = [...new Set(uncertain)];
  meta.enrichSources = sources;
  meta.ruleChecks = ruleChecks;
  return { data, meta, sources, checks };
}
