// Verbatim report text for the AOC-4 linked forms "Extract of Auditor's report" (eauditor) and "Extract of Board's
// report" (eboard). The CA files these with the SAME words as the signed reports, so nothing here summarises:
//
//   1. transcribePdf(): a scanned report PDF is transcribed word for word (Claude, strict TRANSCRIBE-EXACTLY prompt),
//      a few pages per call in parallel, cached by the file's sha256 in the report_texts table. A .docx needs no AI
//      (docx-text.js) and a text layer can be sent as text.
//   2. splitAuditorReport() / splitBoardReport(): RULE-BASED. Headings are found with regexes and each key gets the
//      text between its heading and the next one. A key whose heading is not in the text is left out (listed in
//      missingHeadings) — never a default or an invented sentence.
//   3. cleanVerbatim(): the only change made to the words' characters (see there why).
//   4. saveVerbatim(): company answers labelled "Verbatim from document (p.N): …", which the extension fills.
//
// Pure parts are exported for tests; the Claude call is gateway.extractReportFields, swappable with _setExtractor().
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { extractReportFields } from './gateway.js';

const require = createRequire(import.meta.url);
const EAUDITOR = require('../extension/js/linked/eauditor.js');

// ───────────────────────── cleaning ─────────────────────────

/**
 * Makes report text fit MCA's text boxes while keeping every WORD identical.
 *
 * Why: the extracts MCA accepted for filed reports show that MCA's boxes do not keep special characters (curly
 * apostrophes and quotes, bullet glyphs and the rupee sign were missing from the filed text, and line breaks were
 * not kept). So, and only so:
 *   - curly apostrophes / quotes → straight ASCII ' and " (MCA dropped them, which made "Company's" read "Companys";
 *     the straight ones keep the word as written);
 *   - en/em dashes → "-", "…" → "...", ₹ → "Rs.";
 *   - bullet glyphs (•, ▪, Wingdings bullets …) and invisible characters are removed;
 *   - all whitespace (line breaks between paragraphs, tabs, double spaces) collapses to one space, so a section's
 *     paragraphs are joined with single spaces and numbering such as (a) / i. stays inline.
 * Nothing is shortened, reworded, corrected or re-ordered.
 */
export function cleanVerbatim(s) {
  return String(s ?? '')
    .replace(/[‘’‚‛′´]/g, "'")
    .replace(/[“”„‟″«»]/g, '"')
    .replace(/₹\s*/g, 'Rs. ')
    .replace(/[‐-―−]/g, '-')
    .replace(/…/g, '...')
    .replace(/[­​-‍⁠﻿]/g, '')
    .replace(/[•‣⁃⁌⁍∙■-▫▶►○●◦✓✔❖➢➤·-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ───────────────────────── text → lines ─────────────────────────

const PAGE_MARK = /^=== Page (\d+) ===$/;

// Lower case, no quotes/apostrophes, "&" → "and", leading numbering ("1.", "(a)", "II.", "•") and trailing ":" removed.
export function normHead(s) {
  return String(s ?? '')
    .replace(/[‘’‚‛′'`´]/g, '')
    .replace(/[“”„‟″"]/g, '')
    .replace(/&amp;|&/g, ' and ')
    .replace(/[‐-―]/g, '-')
    .toLowerCase()
    .replace(/^\s*(?:\(?(?:\d{1,2}|[ivx]{1,5}|[a-h])[.)]|[•▪●\-])\s*/, '')
    .replace(/\s+/g, ' ')
    .replace(/[\s:.\-]+$/, '')
    .trim();
}

/** Text (optionally with "=== Page N ===" markers from transcribePdf) → [{raw, norm, page}]; page-number lines dropped. */
export function toLines(text) {
  const out = [];
  let page = null;
  for (const l of String(text ?? '').replace(/\r\n?/g, '\n').replace(/\f/g, '\n').split('\n')) {
    const raw = l.replace(/\s+$/, '');
    const pm = PAGE_MARK.exec(raw.trim());
    if (pm) { page = Number(pm[1]); continue; }
    const t = raw.trim();
    if (!t) continue;
    if (/^(page\s*)?-?\s*\d{1,3}\s*-?(\s*(of|\/)\s*\d{1,3})?$/i.test(t)) continue;      // "Page 2 of 4", "- 3 -", "3"
    out.push({ raw: t, norm: normHead(t), page });
  }
  return out;
}

const isUpperish = s => {
  const letters = s.replace(/[^A-Za-z]/g, '');
  if (letters.length < 4) return false;
  return letters.replace(/[^A-Z]/g, '').length / letters.length >= 0.85;
};
const wordCount = s => s.split(/\s+/).filter(Boolean).length;
const isTableRow = s => / \| /.test(s) || /^\|/.test(s);
// "(e) the directors had laid down …" / "ii. the Company …": a clause of a list, not a heading. A lettered or roman
// numbered line is a clause when it is long or its text starts in lower case.
const CLAUSE_NUM = /^\s*(?:\((?:[a-h]|[ivx]{1,5})\)|(?:[a-h]|[ivx]{1,5})[.)])\s*/i;
const isClause = raw => {
  const m = CLAUSE_NUM.exec(raw);
  if (!m) return false;
  const rest = raw.slice(m[0].length);
  return wordCount(rest) > 8 || /^[a-z]/.test(rest);
};
// A line that can be a heading at all: short, not a table row, not a list clause, not a sentence (a sentence ends
// with "." ";" or ",", unless it is in capitals, or runs on with "and" / "or").
const headingLike = l => l.raw.length <= 220 && !isTableRow(l.raw) && wordCount(l.raw) <= 30
  && !isClause(l.raw) && !/\b(and|or)\s*$/i.test(l.raw)
  && (isUpperish(l.raw) || !/[.;,]\s*$/.test(l.raw));
const TITLE_STOP = new Set(['of', 'and', 'the', 'in', 'on', 'for', 'to', 'or', 'a', 'an', 'by', 'with', 'under', 'as', 'at', 'from', 'if', 'any', 'its', 'their', 'into']);
/** "Particulars of Loans, Guarantees or Investments": most significant words start with a capital. */
export const isTitleCase = s => {
  const ws = String(s).split(/\s+/).map(w => w.replace(/[^A-Za-z]/g, '')).filter(w => w.length >= 3 && !TITLE_STOP.has(w.toLowerCase()));
  return ws.length >= 2 && ws.filter(w => /^[A-Z]/.test(w)).length / ws.length >= 0.75;
};
const fullMatch = (re, norm) => { const m = re.exec(norm); return !!m && m.index === 0 && m[0].length === norm.length; };
/**
 * The first of `heads` whose pattern matches the line, when the line is a heading. A heading written with a final
 * period ("Basis for Opinion.") counts when it is exactly the heading or written in Title Case.
 */
function matchHead(l, heads) {
  const h = heads.find(x => x.re.test(l.norm));
  if (!h) return null;
  if (headingLike(l)) return h;
  const raw = l.raw;
  if (/[^.]\.\s*$/.test(raw) && raw.length <= 160 && wordCount(raw) <= 14 && !isTableRow(raw) && !isClause(raw)
    && (fullMatch(h.re, l.norm) || isTitleCase(raw))) return h;
  return null;
}
/**
 * "Key Audit Matters: We have determined …" / "Conservation of energy: The Company …" → the heading and its text
 * as two lines, for the keyed headings in `heads`.
 */
function splitInlineHeads(lines, heads) {
  const out = [];
  for (const l of lines) {
    const m = /^([^:]{3,120}?)\s*:\s+(\S.*)$/.exec(l.raw);
    if (m && !isTableRow(l.raw) && !isClause(m[1]) && wordCount(m[1]) <= 14 && !/[.;]/.test(m[1].replace(/\b(no|rs|nos?)\./gi, ''))) {
      const norm = normHead(m[1]);
      const h = heads.find(x => x.key && x.re.test(norm));
      if (h) { out.push({ raw: m[1].trim(), norm, page: l.page }, { raw: m[2].trim(), norm: normHead(m[2]), page: l.page }); continue; }
    }
    out.push(l);
  }
  return out;
}
// Running headers repeated at the top of pages ("Independent Auditor's Report (continued)", the company name,
// "BOARD'S REPORT (Contd.)"): page furniture, not a heading — dropped so they neither end a section nor enter its text.
const CONTD = /\s*[(\[]?\b(continued|contd)\b\.?[)\]]?\.?\s*$/i;
const TITLE_LINE = /^independent auditors? ?s? report\b|^(the )?(boards?|directors?) ?s? report\b|^report of the (board of )?directors\b|^to the members of\b/;
export function dropRunningHeads(lines, isKnown) {
  const out = [], seen = new Set();
  let page, pos = 0;
  lines.forEach((l, i) => {
    if (l.page !== page) { page = l.page; pos = 0; } else pos++;
    const bare = l.raw.replace(CONTD, '');
    if (bare && !isKnown(l) && headingLike({ ...l, raw: bare }) && wordCount(l.raw) <= 20) {
      const base = normHead(bare);
      const pageTop = l.page != null && pos < 2;
      const title = TITLE_LINE.test(base);
      if (i > 0 && CONTD.test(l.raw) && base) return;
      if (seen.has(base) && (pageTop || title)) return;
      if (i < 3 || pageTop || title) seen.add(base);
    }
    out.push(l);
  });
  return out;
}

// ───────────────────────── auditor's report ─────────────────────────

export const AUDITOR_KEYS = ['OPINION', 'BASIS', 'EMPHASIS', 'KAM', 'OTHER_INFO', 'MGMT_RESP', 'AUDITOR_RESP', 'OTHER_5B',
  'LEGAL_6A', 'RULE11', 'IFC', 'CARO'];
const AUD_HEADS = [
  { key: 'OPINION', re: /^(qualified |adverse |unmodified |unqualified )?opinion$|^disclaimer of opinion$/ },
  { key: 'BASIS', re: /^basis for (qualified |adverse |unmodified )?opinion$|^basis for disclaimer of opinion$/ },
  { key: 'EMPHASIS', re: /^emphasis of matters?$|^material uncertainty (related|relating) to going concern$/ },
  { key: 'KAM', re: /^key audit matters?$/ },
  { key: 'OTHER_INFO', re: /^(the )?information other than the (standalone |consolidated )?financial statements\b|^other information$/ },
  { key: 'MGMT_RESP', re: /^(the )?(managements?|board of directors?|directors?)( and (the )?(board of directors?|those charged with governance))? ?s? responsibilit(y|ies)\b|^responsibilit(y|ies) of (the )?(management|board)\b/ },
  { key: 'AUDITOR_RESP', re: /^(the )?auditors? ?s? responsibilit(y|ies)\b/ },
  { key: 'OTHER_5B', re: /^other matters?$/ },
  { key: 'LEGAL', re: /^report on other legal and regulatory requirements?$/ },
  { key: 'ANNEX', re: /^annexure\s*-?\s*[a-z0-9]{0,3}\b\s*(to\b|referred\b|$)/ },
  { key: 'IFC_REPORT', re: /^report on the internal financial controls?\b|internal financial controls?.{0,60}under clause \(i\) of sub-?section/ },
  { key: null, re: /^report on the audit of the (standalone |consolidated )?financial statements$|^independent auditors? ?s? report\b|^to the members of\b|^(standalone )?balance sheet as at\b|^statement of profit and loss\b|^meaning of internal financial controls|^inherent limitations|^notes? (forming part|to the financial)/ },
];
// What each key's heading looks like, for the "not found" list.
export const EXPECTED_HEADING = {
  OPINION: 'Opinion / Qualified Opinion / Adverse Opinion / Disclaimer of Opinion',
  BASIS: 'Basis for (Qualified) Opinion', EMPHASIS: 'Emphasis of Matter', KAM: 'Key Audit Matters',
  OTHER_INFO: "Information Other than the Financial Statements and Auditor's Report Thereon",
  MGMT_RESP: "Management's Responsibility / Responsibilities of Management … for the Financial Statements",
  AUDITOR_RESP: "Auditor's Responsibilities for the Audit of the Financial Statements", OTHER_5B: 'Other Matter',
  LEGAL_6A: 'Report on Other Legal and Regulatory Requirements',
  RULE11: '"(h) With respect to the other matters to be included in the Auditor\'s Report in accordance with Rule 11 …"',
  IFC: 'Annexure on Internal Financial Controls, or the internal financial controls clause under section 143(3)',
  CARO: 'Report on Other Legal and Regulatory Requirements (CARO paragraph)',
  DRS: "Directors' Responsibility Statement", STATE_OF_AFFAIRS: "State of Company's Affairs", RISK: 'Risk Management',
  TECH: 'Technology Absorption', ENERGY: 'Conservation of Energy', FOREX: 'Foreign Exchange Earnings and Outgo',
  COST_RECORDS: 'Cost Records', IBC: 'Insolvency and Bankruptcy Code', NATURE_CHANGE: 'Change in Nature of Business',
  MATERIAL_CHANGES: 'Material Changes …', FRAUDS: 'Reporting of Frauds by Auditors', DEPOSITS: 'Deposits',
  RESERVES_DESC: 'Transfer to Reserves', DIVIDEND_DESC: 'Dividend', FIN_SUMMARY: 'Financial Highlights / Financial Results',
  DIRECTOR_CHANGES: 'Directors and KMP', BOARD_MEETINGS: 'Number of Board Meetings (with the meetings table)',
  ORDERS: 'Significant and Material Orders …', WEBSITE: 'Annual Return (web address)',
};

// Signature block / end of the main report.
const SIGNATURE = [
  /^for\s+(m\/s\.?\s*)?.{1,80}?(\s(&|and)\s*(co|company|associates)\b|chartered accountants|\bllp\b)/i,
  /^chartered accountants\.?$/i, /^\(?firm.{0,3}s?\s*(registration|reg)/i, /^\(?(icai\s+)?frn\b/i,
  /^(place|date|udin)\s*[:\-]/i, /^partner\.?$/i, /^\(?membership\s+no/i, /^\(?m\.?\s?no\.?\s*[:.]?\s*\d/i,
];
const isSignature = raw => SIGNATURE.some(re => re.test(raw.trim()));
/** Index of the signature block in lines: a signature line, or "For <anyone>" right above one. -1 when none. */
export function signatureAt(ls) {
  return ls.findIndex((l, i) => isSignature(l.raw) || (/^for\s+\S/i.test(l.raw.trim()) && wordCount(l.raw) <= 12 && ls[i + 1] && isSignature(ls[i + 1].raw)));
}

const audHeadingOf = l => matchHead(l, AUD_HEADS);
const audKnown = l => !!audHeadingOf(l)?.key;

const joinLines = ls => ls.map(l => l.raw).join('\n');
const firstPage = ls => (ls.find(l => l.page != null) || {}).page ?? null;

// A region of the lines starting at a title, ending where another document's title starts.
const AUD_TITLE = /^independent auditors? ?s? report\b/;
const BOARD_TITLE = /^(the )?(boards?|directors?) ?s? report\b|^report of the (board of )?directors\b/;
function region(lines, ownTitle, otherTitle) {
  const own = lines.findIndex(l => headingLike(l) && ownTitle.test(l.norm));
  const other = lines.findIndex(l => headingLike(l) && otherTitle.test(l.norm));
  const start = own >= 0 ? own : 0;
  const end = other > start ? other : lines.length;
  return lines.slice(start, end);
}

export function detectKinds(text) {
  const lines = toLines(text);
  const has = re => lines.some(l => headingLike(l) && re.test(l.norm));
  const auditor = has(AUD_TITLE) || has(/^basis for (qualified |adverse )?opinion$/) || has(/^report on other legal and regulatory requirements?$/);
  const board = has(BOARD_TITLE) || has(/^directors?s? responsibility statement/);
  return { auditor, board };
}

const ROMAN_II = /(^|\n)\s*\(?ii[.)]/i;
const RULE11_START = /(?:\(([a-z])\)|(?:^|\n)\s*([a-z])[.)])\s*with\s+respect\s+to\s+the\s+other\s+matters?\s+to\s+be\s+included\s+in\s+(the\s+)?auditor.{0,2}s?\s+report\s+in\s+accordance\s+with\s+rule\s+11/i;

/** Splits the "Report on Other Legal and Regulatory Requirements" body into LEGAL_6A (without Rule 11) and RULE11. */
export function splitLegal(body) {
  const m = RULE11_START.exec(body);
  if (!m) return { legal: body, rule11: null };
  const start = m.index + (m[0].length - m[0].replace(/^\n/, '').length);
  const letter = (m[1] || m[2]).toLowerCase();
  const next = String.fromCharCode(letter.charCodeAt(0) + 1);
  const from = m.index + m[0].length;
  const rest = body.slice(from);
  const ends = [];
  const s197 = /\(?\w\)\s*with\s+respect\s+to\s+the\s+matters?\s+to\s+be\s+included\s+in\s+(the\s+)?auditor.{0,2}s?\s+report\s+under\s+section\s+197/i.exec(rest);
  if (s197) ends.push(s197.index);
  // A new top-level numbered paragraph ("2. With respect to …", "3. As required by …") is not part of clause (h).
  const numbered = /\n\s*\d{1,2}\s*[.)]\s+\S/.exec(rest);
  if (numbered) ends.push(numbered.index);
  // The signature block: "For <firm>" with "Chartered Accountants" / FRN / Partner on the next line.
  const sig = /\n\s*for\s+[^\n]{1,100}\n\s*(chartered accountants|\(?firm|\(?(icai\s+)?frn\b|partner\b|\(?membership)/i.exec(rest);
  if (sig) ends.push(sig.index);
  if (next === 'i') {
    // "(i)" is both the next clause letter and the first roman item: only an "(i)" after "(ii)" is the next clause.
    const ii = ROMAN_II.exec(rest);
    if (ii) {
      const after = rest.slice(ii.index + ii[0].length);
      const ni = /\n\s*\(i\)\s/i.exec(after);
      if (ni) ends.push(ii.index + ii[0].length + ni.index);
    }
  } else {
    const nl = new RegExp(`\\n\\s*\\(${next}\\)\\s`, 'i').exec(rest);
    if (nl) ends.push(nl.index);
  }
  const end = from + (ends.length ? Math.min(...ends) : rest.length);
  return { legal: (body.slice(0, start) + '\n' + body.slice(end)).trim(), rule11: body.slice(start, end).trim() };
}

// Lines → paragraphs. A docx / transcription line is a paragraph already, but a text layer or pasted text wraps one
// paragraph over several lines: a line continues the previous one unless the previous ends a sentence (. : ; ?)
// and this one starts with a capital, or this one starts with numbering / a bullet.
const PARA_START = /^\s*(?:\(?(?:\d{1,2}|[a-z]|[ivx]{1,5})[.)]\s|[•▪●-]\s)/i;
export function toParagraphs(ls) {
  const out = [];
  for (const l of ls) {
    const prev = out[out.length - 1];
    if (!prev || PARA_START.test(l.raw) || (/[.:;?]["')\]]?\s*$/.test(prev.raw) && /^["'“‘(]?[A-Z]/.test(l.raw.trim()))) out.push({ raw: l.raw, page: l.page });
    else prev.raw += ' ' + l.raw;
  }
  return out;
}

const OPINION_TYPE = norm => /^qualified/.test(norm) ? 'qualified' : /^adverse/.test(norm) ? 'adverse' : /^disclaimer/.test(norm) ? 'disclaimer' : 'unmodified';
const QUAL_TYPE = { qualified: 'Qualification', adverse: 'Adverse remarks', disclaimer: 'Disclaimer' };

/**
 * Auditor's report text → { sections: {KEY: {value, heading, page}}, opinionType, missingHeadings: [KEY], notes: [] }.
 * Keys: OPINION, BASIS, EMPHASIS, KAM, OTHER_INFO, MGMT_RESP, AUDITOR_RESP, OTHER_5B, LEGAL_6A, RULE11, IFC, CARO,
 * and for a modified opinion QUAL_COUNT, QUAL_TYPE_1, QUAL_COMMENT_1.
 */
export function splitAuditorReport(text) {
  const lines = region(dropRunningHeads(splitInlineHeads(toLines(text), AUD_HEADS), audKnown), AUD_TITLE, BOARD_TITLE);
  const heads = [];
  lines.forEach((l, i) => { const h = audHeadingOf(l); if (h) heads.push({ i, key: h.key, line: l }); });
  const sections = {}, notes = [];
  const bodyOf = k => lines.slice(heads[k].i + 1, k + 1 < heads.length ? heads[k + 1].i : lines.length);
  // The main report ends at the first annexure / IFC report that follows the legal section (or the opinion).
  const legalAt = heads.findIndex(h => h.key === 'LEGAL');
  const annexAt = heads.findIndex((h, k) => (h.key === 'ANNEX' || h.key === 'IFC_REPORT') && k > Math.max(legalAt, heads.findIndex(x => x.key === 'OPINION')));
  const mainEnd = annexAt >= 0 ? annexAt : heads.length;
  let opinionType = null;

  const put = (key, value, heading, page) => {
    const v = cleanVerbatim(value);
    if (!v) return;
    if (sections[key]) { sections[key].value += ' ' + v; return; }   // e.g. Emphasis of Matter + Material Uncertainty
    sections[key] = { value: v, heading: cleanVerbatim(heading), page: page ?? null };
  };

  let basisLines = null;
  for (let k = 0; k < mainEnd; k++) {
    const h = heads[k];
    if (!h.key || h.key === 'ANNEX' || h.key === 'IFC_REPORT') continue;
    let body = bodyOf(k);
    if (h.key === 'LEGAL') {
      const sig = signatureAt(body);
      if (sig >= 0) body = body.slice(0, sig);
      const { legal, rule11 } = splitLegal(joinLines(body));
      if (!sections.LEGAL_6A) put('LEGAL_6A', legal, h.line.raw, h.line.page ?? firstPage(body));
      if (rule11 && !sections.RULE11) {
        const at = body.find(l => /with\s+respect\s+to\s+the\s+other\s+matters/i.test(l.raw));
        put('RULE11', rule11, h.line.raw, at?.page ?? h.line.page);
      }
      // CARO only from positive evidence: "Yes" from the paragraph that gives the Order's statement (it names the
      // Order or section 143(11)), "No" only from a sentence saying the Order does not apply. Without either (a page
      // not transcribed, the Order cited only as "the Order" …) CARO is left out — never "No" from absence.
      if (!sections.CARO) {
        const caroRe = /companies\s*\(auditor.{0,2}s?\s*report\)\s*order|section\s*143\s*\(\s*11\s*\)/i;
        const caroLine = body.find(l => caroRe.test(l.raw)) || lines.find(l => caroRe.test(l.raw) && /annexure/i.test(l.raw));
        if (caroLine) sections.CARO = { value: /not\s+applicable|does\s+not\s+apply|not\s+required/i.test(caroLine.raw) ? 'No' : 'Yes', heading: cleanVerbatim(h.line.raw), page: caroLine.page ?? h.line.page, basis: cleanVerbatim(caroLine.raw).slice(0, 300) };
        else notes.push('CARO: no paragraph naming the Companies (Auditor\'s Report) Order or section 143(11) was found, so CARO is not set — choose Yes/No on MCA (check that every page of the report was read).');
      }
      // IFC clause of section 143(3) (exemption or "see Annexure"): used when there is no IFC annexure.
      const ifcLine = body.find(l => /internal\s+financial\s+controls?/i.test(l.raw));
      if (ifcLine) sections._IFC_CLAUSE = { value: cleanVerbatim(ifcLine.raw), heading: cleanVerbatim(h.line.raw), page: ifcLine.page ?? h.line.page };
      continue;
    }
    if (sections[h.key] && h.key !== 'EMPHASIS') continue;           // first occurrence wins
    if (h.key === 'OPINION') { if (opinionType) continue; opinionType = OPINION_TYPE(h.line.norm); }
    if (h.key === 'BASIS') basisLines = body;
    put(h.key, joinLines(body), h.line.raw, h.line.page ?? firstPage(body));
  }

  // IFC: the opinion paragraph of the annexure on internal financial controls, else the s.143(3) clause.
  const ifcAt = heads.findIndex((h, k) => k >= mainEnd && (h.key === 'IFC_REPORT' || (h.key === 'ANNEX' && /internal financial control/.test(h.line.norm))));
  let ifcFound = false;
  if (ifcAt >= 0) {
    for (let k = ifcAt + 1; k < heads.length; k++) {
      if (heads[k].key === 'ANNEX' && !/internal financial control/.test(heads[k].line.norm)) break;
      if (heads[k].key === 'OPINION') {
        const body = bodyOf(k);
        const sig = signatureAt(body);
        put('IFC', joinLines(sig >= 0 ? body.slice(0, sig) : body), heads[k].line.raw, heads[k].line.page ?? firstPage(body));
        ifcFound = !!sections.IFC;
        break;
      }
    }
  }
  if (!ifcFound && sections._IFC_CLAUSE) sections.IFC = sections._IFC_CLAUSE;
  delete sections._IFC_CLAUSE;
  if (sections.CARO?.value === 'Yes') notes.push('CARO applies: the clause-by-clause CARO comments (6(c)) are not split from the text — enter them on MCA.');

  // Modified opinion: each paragraph of the basis before the standard "We conducted our audit…" one is a remark.
  if (opinionType && opinionType !== 'unmodified' && basisLines) {
    const std = basisLines.findIndex(l => /we\s+conducted\s+our\s+audit/i.test(l.raw));
    const paras = toParagraphs((std >= 0 ? basisLines.slice(0, std) : basisLines).filter(l => cleanVerbatim(l.raw)));
    if (paras.length) {
      const pg = paras[0].page ?? sections.BASIS?.page ?? null;
      sections.QUAL_COUNT = { value: String(paras.length), heading: sections.BASIS?.heading || '', page: pg };
      sections.QUAL_TYPE_1 = { value: QUAL_TYPE[opinionType], heading: sections.OPINION?.heading || '', page: sections.OPINION?.page ?? null };
      sections.QUAL_COMMENT_1 = { value: cleanVerbatim(paras[0].raw), heading: sections.BASIS?.heading || '', page: pg };
      if (paras.length > 1) notes.push(`${paras.length} remark paragraphs found: only remark 1 is filled by the extension; add the others on MCA.`);
    } else notes.push('Modified opinion, but no remark paragraph was found before "We conducted our audit…": enter the remarks by hand.');
  }

  const missingHeadings = AUDITOR_KEYS.filter(k => !sections[k]);
  return { sections, opinionType, missingHeadings, notes };
}

// ───────────────────────── Board's report ─────────────────────────

export const BOARD_KEYS = ['DRS', 'STATE_OF_AFFAIRS', 'RISK', 'TECH', 'ENERGY', 'FOREX', 'IFC', 'COST_RECORDS', 'IBC', 'NATURE_CHANGE',
  'MATERIAL_CHANGES', 'FRAUDS', 'DEPOSITS', 'RESERVES_DESC', 'DIVIDEND_DESC', 'FIN_SUMMARY', 'DIRECTOR_CHANGES', 'ORDERS',
  'BOARD_MEETINGS', 'WEBSITE'];
const BOARD_HEADS = [
  { key: 'ANNUAL_RETURN', re: /^(extract of (the )?)?annual return\b/ },
  { key: 'BOARD_MEETINGS', re: /^(number of |no\.? of )?(meetings of (the )?board( of directors)?|board meetings)\b|^number of (board )?meetings\b/ },
  { key: 'DRS', re: /^directors? ?s? responsibility statements?\b/ },
  { key: 'FRAUDS', re: /^(reporting|details) (of|in respect of) frauds?\b|^frauds? reported by\b/ },
  { key: 'COST_RECORDS', re: /^(maintenance of )?cost records?\b|^cost audit\b/ },
  { key: 'IBC', re: /^(the )?(details of )?(any )?(applications?|proceedings?)\b[^.]{0,120}insolvency and bankruptcy code|^(the )?insolvency and bankruptcy code/ },
  { key: 'STATE_OF_AFFAIRS', re: /^states? of (the )?compan(y|ys|ies) ?s? affairs|^state of affairs\b|^review of (business )?operations\b/ },
  { key: 'DIVIDEND_DESC', re: /^dividends?\b/ },
  { key: 'RESERVES_DESC', re: /^(transfer|amounts?) (transferred |proposed to be carried )?to (the )?(general )?reserves?\b|^reserves$/ },
  { key: null, re: /^(particulars of )?conservation of energy,? (and )?technology absorption/ },
  { key: 'ENERGY', re: /^(the )?conservation of energy$/ },
  { key: 'TECH', re: /^(the )?technology absorption$/ },
  { key: 'FOREX', re: /^foreign exchange earnings? and outgo$/ },
  { key: 'RISK', re: /^risk management\b|^(development and implementation of )?(a )?risk management policy/ },
  { key: 'FIN_SUMMARY', re: /^financial (highlights|results|summary|performance)\b/ },
  { key: 'NATURE_CHANGE', re: /^changes? in (the )?nature of (the )?business/ },
  { key: 'MATERIAL_CHANGES', re: /^material changes\b/ },
  { key: 'DIRECTOR_CHANGES', re: /^(changes in )?directors? (and|&) (key managerial personnel|kmp)\b|^(board of )?directors and key managerial/ },
  { key: 'DEPOSITS', re: /^(public )?deposits?\b/ },
  { key: 'ORDERS', re: /^(details of )?significant (and|&) material orders\b/ },
  { key: 'IFC', re: /^((details|statement|disclosure) (in respect )?of )?(the )?(adequacy of )?internal financial controls?\b|^internal control systems?\b/ },
];
const boardKnown = l => !!matchHead(l, BOARD_HEADS)?.key;
const HONORIFIC = /^(mr|mrs|ms|dr|shri|smt|sri|m\/s)\.?\s/i;
// Any other heading ends the section before it (so another section's words are never saved under the wrong key):
// a short line in capitals, or in Title Case without final punctuation ("Particulars of Loans, Guarantees or
// Investments", "Statutory Auditors"). Names and DIN lines are not headings.
const otherHeading = l => headingLike(l) && !/\d{6,}/.test(l.raw) && !HONORIFIC.test(l.raw.trim())
  && (isUpperish(l.raw) || (wordCount(l.raw) <= 14 && !/[.;,]\s*$/.test(l.raw) && isTitleCase(l.raw)));
const BOARD_END = [/^for and on behalf of the board/i, /^(place|date)\s*[:\-]/i, /^_{3,}/, /^sd\/?-?$/i];

/** Any of 18-03-25, 18/03/2025, 18.3.2025, 18th March 2025, March 18, 2025 → "18/03/2025"; '' when not a date. */
export function meetingDate(cell) {
  const s = String(cell ?? '').trim();
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  let d, m, y;
  let r = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
  if (r) [, d, m, y] = r;
  else if ((r = /^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]{3,9})[\s,.-]+(\d{4})$/i.exec(s))) { d = r[1]; m = MONTHS.indexOf(r[2].slice(0, 3).toLowerCase()) + 1; y = r[3]; }
  else if ((r = /^([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i.exec(s))) { d = r[2]; m = MONTHS.indexOf(r[1].slice(0, 3).toLowerCase()) + 1; y = r[3]; }
  else return '';
  d = Number(d); m = Number(m); y = Number(y);
  if (y < 100) y += 2000;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (!m || dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return '';
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

const PRESENT = /^(present|p|yes|y|attended|attend|✓|✔|√)$/i;
const ABSENT = /^(absent|a|no|n|leave( of absence)?|leave granted|lob|-|x|✗|✘)$/i;

/**
 * Board meetings table rows ("cell | cell" lines) → [{date, total, attended}] (sorted by date), plus errors.
 * Two layouts: an attendance matrix (date | director 1 | director 2 … with Present/Absent), or a summary
 * (date | board strength / total | directors present / attended).
 */
export function parseMeetingTable(rawLines) {
  const rows = rawLines.filter(isTableRow).map(l => l.split('|').map(c => c.trim()));
  const errors = [];
  if (!rows.length) return { meetings: [], errors: ['no meetings table'] };
  const isDataRow = r => r.some(c => meetingDate(c));
  const header = rows.find(r => !isDataRow(r) && r.some(c => /date/i.test(c))) || rows.find(r => !isDataRow(r)) || null;
  const col = re => (header ? header.findIndex(c => re.test(c)) : -1);
  const totalCol = col(/strength|total|no\.? of directors|entitled|number of directors/i);
  const attCol = col(/attend|present/i);
  const skip = c => /^(s\.?\s?no\.?|sl\.?\s?no\.?|sr\.?\s?no\.?|serial|date)/i.test(c);
  const out = [];
  for (const r of rows.filter(isDataRow)) {
    const di = r.findIndex(c => meetingDate(c));
    const date = meetingDate(r[di]);
    let total, attended;
    if (totalCol >= 0 && attCol >= 0 && totalCol !== attCol) {
      total = Number(String(r[totalCol] || '').replace(/[^\d]/g, '')); attended = Number(String(r[attCol] || '').replace(/[^\d]/g, ''));
    } else {
      const cols = r.map((c, i) => i).filter(i => i !== di && !(header && skip(header[i] || '')) && !(i < di && /^\d{1,3}$/.test(r[i])));
      const marks = cols.map(i => r[i] ?? '');
      const n = header ? header.filter((c, i) => i !== di && c && !skip(c) && !(i < di)).length : marks.length;
      if (marks.some(c => c && !PRESENT.test(c) && !ABSENT.test(c))) { errors.push(`${date}: attendance "${marks.join(' | ')}" is not Present/Absent`); continue; }
      total = n; attended = marks.filter(c => PRESENT.test(c)).length;
    }
    if (!(Number.isInteger(total) && total > 0) || !(Number.isInteger(attended) && attended >= 0 && attended <= total)) { errors.push(`${date}: directors ${attended} of ${total} is not valid`); continue; }
    if (!out.some(x => x.date === date)) out.push({ date, total, attended });
  }
  const key = d => d.split('/').reverse().join('');
  out.sort((a, b) => key(a.date).localeCompare(key(b.date)));
  return { meetings: out, errors };
}

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s|,;()<>"']+/i;

/**
 * Board's report text → { sections: {KEY: {value, heading, page}}, missingHeadings: [KEY], notes: [] }.
 * BOARD_MEETINGS is a JSON string [{date:"DD/MM/YYYY", total, attended}] when the table can be read.
 */
export function splitBoardReport(text) {
  const lines = region(dropRunningHeads(splitInlineHeads(toLines(text), BOARD_HEADS), boardKnown), BOARD_TITLE, AUD_TITLE);
  const heads = [];
  lines.forEach((l, i) => {
    if (BOARD_END.some(re => re.test(l.raw))) { heads.push({ i, key: null, line: l, end: true }); return; }
    const h = matchHead(l, BOARD_HEADS);
    if (h) heads.push({ i, key: h.key, line: l });
    else if (otherHeading(l)) heads.push({ i, key: null, line: l });   // any other heading ends a section
  });
  const sections = {}, notes = [];
  for (let k = 0; k < heads.length; k++) {
    const h = heads[k];
    if (!h.key || sections[h.key]) continue;
    const body = lines.slice(h.i + 1, k + 1 < heads.length ? heads[k + 1].i : lines.length);
    const page = h.line.page ?? firstPage(body);
    if (h.key === 'ANNUAL_RETURN') {
      const url = URL_RE.exec(joinLines(body));
      if (url) sections.WEBSITE = { value: url[0].replace(/[.]+$/, ''), heading: cleanVerbatim(h.line.raw), page };
      continue;
    }
    if (h.key === 'BOARD_MEETINGS') {
      const { meetings, errors } = parseMeetingTable(body.map(l => l.raw));
      if (meetings.length) sections.BOARD_MEETINGS = { value: JSON.stringify(meetings), heading: cleanVerbatim(h.line.raw), page, rows: meetings };
      if (errors.length || !meetings.length) notes.push(`Board meetings table: ${meetings.length ? errors.join('; ') : 'could not be read (' + errors.join('; ') + ')'} — check the meetings on the Board's report tab.`);
      continue;
    }
    const v = cleanVerbatim(joinLines(body));
    if (v) sections[h.key] = { value: v, heading: cleanVerbatim(h.line.raw), page };
  }
  if (!sections.WEBSITE) {
    const url = URL_RE.exec(lines.map(l => l.raw).join('\n'));
    if (url) sections.WEBSITE = { value: url[0].replace(/[.]+$/, ''), heading: 'Web address in the report', page: null };
  }
  if (sections.DEPOSITS) sections.DEPOSITS.reference = true;   // MCA asks for deposit amounts only: shown, not saved
  const missingHeadings = BOARD_KEYS.filter(k => !sections[k]);
  return { sections, missingHeadings, notes };
}

// ───────────────────────── lengths, labels, warnings ─────────────────────────

// MCA box limits known from filed extracts (the DRS box cut a filed text at about 1,000 characters).
export const KNOWN_LIMITS = { eboard: { DRS: 1000 } };
// The longest text MCA is known to have accepted in a box (auditor's responsibilities, about 3,200 characters).
export const LONGEST_ACCEPTED = 3250;

const BOARD_LABELS = {
  DRS: "3 Directors' responsibility statement", FRAUDS: '4 Frauds reported by auditors u/s 143(12)', STATE_OF_AFFAIRS: "11 State of company's affairs",
  RESERVES_DESC: '12 Amount transferred to reserves', DIVIDEND_DESC: '13 Dividend recommended', MATERIAL_CHANGES: '14 Material changes after year end',
  RISK: '15 Risk management policy', TECH: '23(a) Technology absorption', ENERGY: '23(b) Conservation of energy', FOREX: '23(c) Foreign exchange earnings and outgo',
  IFC: '23(e)(iii) Internal financial controls', COST_RECORDS: '23(e)(iv) Cost records', IBC: '23(e)(v) Insolvency and Bankruptcy Code',
  FIN_SUMMARY: '23(e)(vii) Financial summary', NATURE_CHANGE: '23(e)(viii) Change in nature of business', DIRECTOR_CHANGES: '23(e)(ix) Directors / KMP changes',
  DEPOSITS: '23(f) Deposits (reference only)', ORDERS: '23(g) Significant orders', BOARD_MEETINGS: '2(b) Board meetings', WEBSITE: '1 Web address of the annual return',
};
export const labelOf = (form, key) => (form === 'eauditor' ? EAUDITOR.labels[key] : BOARD_LABELS[key]) || key;

/** Per key length and warnings (never cuts). */
export function measure(sections) {
  const lengths = {}, warnings = [];
  for (const form of ['eauditor', 'eboard']) {
    lengths[form] = {};
    for (const [key, s] of Object.entries(sections[form] || {})) {
      const n = String(s.value).length;
      lengths[form][key] = n;
      if (key === 'BOARD_MEETINGS') continue;
      const label = labelOf(form, key), limit = KNOWN_LIMITS[form]?.[key];
      if (limit && n > limit) warnings.push({ form, key, text: `${label}: ${n} characters — MCA's box took about ${limit}. The text is NOT cut here: check what MCA keeps, or shorten it on MCA with the CA's approval.` });
      else if (!limit && n > LONGEST_ACCEPTED) warnings.push({ form, key, text: `${label}: ${n} characters — longer than any text MCA is known to have accepted (about ${LONGEST_ACCEPTED}). Not cut: check on MCA that all of it is kept.` });
      if (/\[illegible\]/i.test(s.value)) warnings.push({ form, key, text: `${label}: part of the scan could not be read ([illegible]) — complete it from the signed report.` });
      const odd = [...new Set(String(s.value).match(/[^\x20-\x7E]/g) || [])];
      if (odd.length) warnings.push({ form, key, text: `${label}: has characters MCA may not keep (${odd.join(' ')}).` });
    }
  }
  return { lengths, warnings };
}

/** Runs the splitter(s) for kind 'auditor' | 'board' | 'auto' (auto: by the titles/headings found; both if unsure). */
export function splitReport(text, kind = 'auto') {
  let doAud = kind === 'auditor', doBoard = kind === 'board';
  if (kind === 'auto' || (!doAud && !doBoard)) {
    const k = detectKinds(text);
    doAud = k.auditor; doBoard = k.board;
    if (!doAud && !doBoard) { doAud = true; doBoard = true; }
  }
  const out = { sections: { eauditor: {}, eboard: {} }, missingHeadings: [], notes: [], opinionType: null, kinds: [] };
  if (doAud) {
    const a = splitAuditorReport(text);
    out.sections.eauditor = a.sections; out.opinionType = a.opinionType; out.kinds.push('auditor');
    out.missingHeadings.push(...a.missingHeadings.map(key => ({ form: 'eauditor', key, label: labelOf('eauditor', key), expected: EXPECTED_HEADING[key] || key })));
    out.notes.push(...a.notes);
  }
  if (doBoard) {
    const b = splitBoardReport(text);
    out.sections.eboard = b.sections; out.kinds.push('board');
    out.missingHeadings.push(...b.missingHeadings.map(key => ({ form: 'eboard', key, label: labelOf('eboard', key), expected: EXPECTED_HEADING[key] || key })));
    out.notes.push(...b.notes);
  }
  for (const form of ['eauditor', 'eboard']) for (const [key, s] of Object.entries(out.sections[form])) s.label = labelOf(form, key);
  const m = measure(out.sections);
  return { ...out, lengths: m.lengths, warnings: m.warnings };
}

// ───────────────────────── saving ─────────────────────────

export const SAVE_KEYS = {
  eauditor: ['OPINION', 'BASIS', 'EMPHASIS', 'KAM', 'OTHER_INFO', 'MGMT_RESP', 'AUDITOR_RESP', 'RULE11', 'OTHER_5B', 'LEGAL_6A', 'IFC', 'CARO',
    'QUAL_COUNT', 'QUAL_TYPE_1', 'QUAL_COMMENT_1'],
  eboard: ['DRS', 'STATE_OF_AFFAIRS', 'RISK', 'TECH', 'ENERGY', 'FOREX', 'IFC', 'COST_RECORDS', 'IBC', 'NATURE_CHANGE', 'MATERIAL_CHANGES', 'FRAUDS',
    'RESERVES_DESC', 'DIVIDEND_DESC', 'FIN_SUMMARY', 'DIRECTOR_CHANGES', 'ORDERS', 'BOARD_MEETINGS', 'WEBSITE'],
};
export const MAX_VALUE = 200000;
// Answers the verbatim text may replace: blank, test data, earlier AI / verbatim readings, placeholders.
export const isReplaceableLabel = l => /^\s*(TEST DATA|AI from document|Verbatim from document|PLACEHOLDER)\b/i.test(String(l || ''));
// Who owns a stored answer. A machine-made label is not enough: the dashboard's editor sends the stored label back
// when the CA corrects the value, so POST /api/company-answers marks a changed value source 'ca' (answerSource) and
// such a row is the CA's own, whatever its label says.
export const isReplaceableRow = cur => !!cur && isReplaceableLabel(cur.label) && cur.source !== 'ca';
/** The source for a row saved through POST /api/company-answers (cur: the stored {value, source} or undefined). */
export function answerSource(cur, label, value) {
  const curVal = cur ? String(cur.value ?? '') : '';
  if (cur && curVal === String(value ?? '')) return cur.source || 'extension';   // re-sent unchanged: owner unchanged
  if (isReplaceableLabel(label) && !curVal.trim()) return 'extension';           // a new machine-labelled row
  return 'ca';                                                                   // typed or changed by the CA
}
export const verbatimLabel = (page, label) => `Verbatim from document${page ? ` (p.${page})` : ''}: ${label}`.slice(0, 300);

function checkValue(form, key, v) {
  const s = String(v ?? '').trim();
  if (!s || s.length > MAX_VALUE) return null;
  if (key === 'CARO') return /^(Yes|No)$/.test(s) ? s : null;
  if (key === 'QUAL_COUNT') return /^\d{1,3}$/.test(s) ? s : null;
  if (key === 'BOARD_MEETINGS') {
    try { const a = JSON.parse(s); return Array.isArray(a) && a.length && a.every(m => meetingDate(m?.date) && Number.isInteger(m.total) && Number.isInteger(m.attended)) ? s : null; } catch { return null; }
  }
  return s;
}

const sameText = (a, b) => cleanVerbatim(a) === cleanVerbatim(b);

/** What saving would do with each key: 'fill' | 'replace' | 'same' | 'keep' (the CA's own answer). */
export function plannedActions(db, cin, byForm) {
  const get = db.prepare('SELECT label, value, source FROM company_answers WHERE cin = ? AND form_type = ? AND field_key = ?');
  const out = { eauditor: {}, eboard: {} };
  for (const form of ['eauditor', 'eboard']) {
    for (const [key, s] of Object.entries(byForm?.[form] || {})) {
      if (!SAVE_KEYS[form].includes(key)) continue;
      const cur = get.get(cin, form, key);
      const blank = !cur || String(cur.value ?? '').trim() === '';
      const value = typeof s === 'object' && s ? s.value : s;
      out[form][key] = blank ? 'fill' : sameText(cur.value, value) ? 'same' : isReplaceableRow(cur) ? 'replace' : 'keep';
    }
  }
  return out;
}

/**
 * Upserts the verbatim sections as company answers (source 'report-verbatim').
 * byForm: {eauditor: {KEY: {value, page?} | string}, eboard: {...}}. A CA's own answer is kept unless force.
 * Returns {saved: [{formType, key}], skipped: [{formType, key, reason}]}.
 */
export function saveVerbatim(db, cin, byForm, { force = false } = {}) {
  const get = db.prepare('SELECT label, value, source FROM company_answers WHERE cin = ? AND form_type = ? AND field_key = ?');
  const up = db.prepare(`INSERT INTO company_answers (cin, form_type, field_key, label, value, source, updated_at)
                         VALUES (?, ?, ?, ?, ?, 'report-verbatim', CURRENT_TIMESTAMP)
                         ON CONFLICT(cin, form_type, field_key) DO UPDATE SET label = excluded.label, value = excluded.value,
                           source = excluded.source, updated_at = CURRENT_TIMESTAMP`);
  const saved = [], skipped = [];
  for (const form of ['eauditor', 'eboard']) {
    for (const [key, s] of Object.entries(byForm?.[form] || {})) {
      if (!SAVE_KEYS[form].includes(key)) { skipped.push({ formType: form, key, reason: 'not a field the extension fills from the report text' }); continue; }
      const raw = s && typeof s === 'object' ? s.value : s;
      const value = checkValue(form, key, raw);
      if (value == null) { skipped.push({ formType: form, key, reason: 'empty or not in the expected format' }); continue; }
      const cur = get.get(cin, form, key);
      const real = cur && String(cur.value ?? '').trim() !== '' && !isReplaceableRow(cur);
      if (real && !force && !sameText(cur.value, value)) { skipped.push({ formType: form, key, reason: "the CA's own answer is kept (save with force to replace it)" }); continue; }
      const page = s && typeof s === 'object' && Number.isInteger(s.page) && s.page > 0 ? s.page : null;
      up.run(cin, form, key, verbatimLabel(page, labelOf(form, key)), value);
      saved.push({ formType: form, key });
    }
  }
  return { saved, skipped };
}

// ───────────────────────── transcription (scanned PDF) ─────────────────────────

export const REPORT_TEXTS_DDL = `
  CREATE TABLE IF NOT EXISTS report_texts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cin TEXT,
    sha256 TEXT NOT NULL,
    kind TEXT NOT NULL,
    pages_json TEXT NOT NULL,
    model TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (sha256, kind)
  );`;

export const TRANSCRIBE_SYSTEM = 'You are a transcription engine for scanned Indian company reports (independent auditor\'s report, '
  + 'Board\'s report and their annexures). TRANSCRIBE EXACTLY, character for character: the same words, spelling (even mistakes), '
  + 'punctuation, capitals, numbers, headings and numbering such as 1. (a) (i) i. as printed. Do NOT summarise, shorten, paraphrase, '
  + 'correct, translate, re-order or complete anything, and never add words of your own. Put every heading, paragraph, bullet and list '
  + 'item on its own line; join the wrapped lines of ONE paragraph with a single space (do not split words); keep bullet characters. '
  + 'Write a table row as one line with its cells separated by " | " (header row first). Leave out signatures, stamps, seals, '
  + 'handwriting that is only a signature, printed page numbers, and running headers / footers repeated on every page (such as '
  + '"Independent Auditor\'s Report (continued)", "Board\'s Report (Contd.)", the company name or the firm\'s letterhead at the top '
  + 'or bottom of a later page) — keep the report\'s title where it first appears. Write any word you cannot read with certainty as [illegible]. '
  + 'Reply with JSON only, no markdown.';

export function transcribePrompt(from, to) {
  const which = from ? (from === to ? `page ${from}` : `pages ${from} to ${to}`) : 'every page';
  return `Transcribe ${which} of the attached PDF (1-based page numbers of the PDF file). Return exactly: `
    + '{"pages":[{"page":<page number>,"text":"<the full text of that page, lines separated by \\n>"}]} '
    + 'with one entry per page, in page order. A blank page has "text":"".';
}

/** Number of pages in a PDF (counts /Type /Page objects), or null when it cannot be told. */
export function countPdfPages(buf) {
  const n = (buf.toString('latin1').match(/\/Type\s*\/Page(?![a-zA-Z])/g) || []).length;
  return n || null;
}

/** pages: [from, to] | "3-6" | undefined → [[a, b], …] chunks of `size` pages; [[null, null]] = all pages in one call. */
export function pageRanges(total, pages, size = 3) {
  let from = 1, to = total;
  if (pages != null && pages !== '') {
    const p = Array.isArray(pages) ? pages : String(pages).split(/\s*[-–,]\s*/);
    const a = Number(p[0]), b = Number(p[1] ?? p[0]);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b < a) throw new Error('pages must be [from, to] with 1 ≤ from ≤ to');
    from = a; to = total ? Math.min(b, total) : b;
    if (total && from > total) throw new Error(`the PDF has only ${total} page(s)`);
  }
  if (!to) return [[null, null]];
  const out = [];
  for (let a = from; a <= to; a += size) out.push([a, Math.min(to, a + size - 1)]);
  return out;
}

let extractor = extractReportFields;
const inflight = new Map();
/** Tests: replace the Claude call (same signature as gateway.extractReportFields). Pass null to restore. */
export function _setExtractor(fn) { extractor = fn || extractReportFields; inflight.clear(); }

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

export const joinPages = pages => pages.map(p => (p.page != null ? `=== Page ${p.page} ===\n` : '') + String(p.text || '')).join('\n');

/**
 * Verbatim transcription of a (scanned) PDF.
 * @param {string} base64  the PDF
 * @param {{pages?, refresh?, db?, cin?, chunk?}} opts
 * @returns {Promise<{sha256, pages:[{page,text}], text, model, cached, warnings, pageCount}>}
 */
export async function transcribePdf(base64, { pages, refresh = false, db = null, cin = null, chunk = 3 } = {}) {
  const b64 = String(base64 || '').replace(/^data:[^,]*,/, '');
  const buf = Buffer.from(b64, 'base64');
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const pageCount = countPdfPages(buf);
  const ranges = pageRanges(pageCount, pages, chunk);
  const kind = `pdf:${ranges[0][0] ? `${ranges[0][0]}-${ranges[ranges.length - 1][1]}` : 'all'}`;
  if (db && !refresh) {
    const row = db.prepare('SELECT pages_json, model FROM report_texts WHERE sha256 = ? AND kind = ?').get(sha256, kind);
    if (row) {
      const pg = JSON.parse(row.pages_json);
      return { sha256, pages: pg, text: joinPages(pg), model: row.model, cached: true, warnings: [], pageCount };
    }
  }
  const key = `${sha256}|${kind}`;
  if (!refresh && inflight.has(key)) return { ...(await inflight.get(key)), cached: true };
  const promise = (async () => {
    const results = await pool(ranges, 4, ([a, b]) => extractor({ pdfBase64: b64 }, { system: TRANSCRIBE_SYSTEM, prompt: transcribePrompt(a, b), maxTokens: 16000, timeoutMs: 240000 })
      .then(r => ({ ok: true, r, a, b }), err => ({ ok: false, err, a, b })));
    const byPage = new Map(), warnings = [];
    let model = null, firstErr = null;
    for (const x of results) {
      if (!x.ok) { firstErr = firstErr || x.err; warnings.push(`Pages ${x.a ?? 'all'}${x.b && x.b !== x.a ? `-${x.b}` : ''} could not be transcribed: ${x.err.message}`); continue; }
      model = model || x.r?.model || null;
      const list = Array.isArray(x.r?.json?.pages) ? x.r.json.pages : [];
      for (const p of list) {
        const n = Number(p?.page);
        if (!Number.isInteger(n) || n < 1 || typeof p?.text !== 'string') continue;
        if (x.a && (n < x.a || n > x.b)) continue;
        if (!byPage.has(n)) byPage.set(n, p.text);
      }
      if (x.a) for (let n = x.a; n <= x.b; n++) if (!byPage.has(n)) warnings.push(`Page ${n} was not returned by the transcription.`);
    }
    if (!byPage.size) throw firstErr || new Error('nothing could be transcribed from this PDF');
    const pg = [...byPage.entries()].sort((p, q) => p[0] - q[0]).map(([page, text]) => ({ page, text }));
    if (db && !results.some(x => !x.ok)) {
      db.prepare(`INSERT INTO report_texts (cin, sha256, kind, pages_json, model) VALUES (?, ?, ?, ?, ?)
                  ON CONFLICT(sha256, kind) DO UPDATE SET cin = excluded.cin, pages_json = excluded.pages_json, model = excluded.model, created_at = CURRENT_TIMESTAMP`)
        .run(cin, sha256, kind, JSON.stringify(pg), model);
    }
    return { sha256, pages: pg, text: joinPages(pg), model, cached: false, warnings, pageCount };
  })();
  inflight.set(key, promise);
  try { return await promise; } finally { inflight.delete(key); }
}
