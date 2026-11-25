// Tally JSON (JSONEx-style) reader.
// Structure is based on the sample payloads published in Tally's help pages:
//   { static_variables: [...], tallymessage: [ { metadata: { type, vchtype }, ...lowercase keys } ] }
// Field names for masters beyond name/parent are assumptions from Tally's object schema
// and must be confirmed against real exports.

import Decimal from 'decimal.js';

// ---------- text encoding of an uploaded file ----------
// TallyPrime 7.1 saves JSON exports in UTF-16 little endian with a byte order mark (bytes FF FE). Other versions
// and other tools write UTF-8. A file is read correctly in UTF-8, UTF-16 LE or UTF-16 BE, with or without a byte
// order mark. Without a mark the encoding is recognised from the first two bytes: a JSON file starts with an
// ASCII character ("{" or white space), so in UTF-16 one of its first two bytes is zero.
// Returns { encoding: 'utf8' | 'utf16le' | 'utf16be', bomLength }.
export function detectEncoding(head) {
  const b = head || Buffer.alloc(0);
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return { encoding: 'utf8', bomLength: 3 };
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return { encoding: 'utf16le', bomLength: 2 };
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return { encoding: 'utf16be', bomLength: 2 };
  if (b.length >= 2 && b[0] !== 0 && b[1] === 0) return { encoding: 'utf16le', bomLength: 0 };
  if (b.length >= 2 && b[0] === 0 && b[1] !== 0) return { encoding: 'utf16be', bomLength: 0 };
  return { encoding: 'utf8', bomLength: 0 };
}
export const ENCODING_NAMES = { utf8: 'UTF-8', utf16le: 'UTF-16 (little endian)', utf16be: 'UTF-16 (big endian)' };

// Swaps the bytes of each pair (UTF-16 BE <-> LE). The length must be even.
export const swapBytePairs = buf => { const out = Buffer.from(buf); out.swap16(); return out; };

// The whole text of a small file, whatever its encoding.
export function decodeText(buffer) {
  const { encoding, bomLength } = detectEncoding(buffer.subarray(0, 4));
  let body = buffer.subarray(bomLength);
  if (encoding === 'utf8') return body.toString('utf8'); // small files only (reports); Tally uploads are read by tallystream.js, which refuses bytes that are not UTF-8
  if (body.length % 2) body = body.subarray(0, body.length - 1); // a stray last byte cannot be a character
  return (encoding === 'utf16be' ? swapBytePairs(body) : body).toString('utf16le');
}

export function parseJsonFile(buffer) {
  let text = decodeText(buffer);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
  return JSON.parse(text);
}

// ---------- reading values the way Tally writes them ----------
// Tally writes "no value" as control character 4 followed by " Not Applicable" (or " Unknown", for example for a GST
// registration type never set). Other values with control character 4 (" Primary", " Any", " Applicable") have a meaning.
export const isNotApplicable = v => typeof v === 'string' && v.includes('\u0004') && /not applicable|^\W*unknown\W*$/i.test(v);
// A plain text value: '' for nothing, a list, an object or Tally's "no value" marker. Nothing is trimmed.
export function tallyText(v) {
  if (v == null || typeof v === 'object') return '';
  const s = String(v);
  return isNotApplicable(s) ? '' : s;
}
const filled = v => tallyText(v).trim() !== '';

// ---------- hidden characters in Tally values ----------
// Real TallyPrime exports carry line breaks (CR LF) inside some values: at the end of ledger names, mailing names and
// GSTINs, at the start of address lines; and the invisible character U+FEFF inside some address lines. Control
// character 4 is NOT counted: Tally uses it for its own markers ("Not Applicable", "Primary").
// ONE set of invisible characters (TALLY-015), written as \u escapes so the source holds no raw control character:
// INVISIBLE_CHARS = the soft hyphen U+00AD, zero-width space / non-joiner / joiner and the direction marks U+200B-U+200F,
// the embedding marks U+202A-U+202E, the word joiner U+2060 and the byte order mark U+FEFF. A no-break space U+00A0 in a
// name is counted as hidden too (it looks like a space but is not one); for matching it is read as a plain space.
// These only FLAG and COMPARE: a name is never changed by them (pick and drop).
const CONTROL_CHARS = '\\u0000-\\u0003\\u0005-\\u001f\\u007f';
const INVISIBLE_CHARS = '\\u00ad\\u200b-\\u200f\\u202a-\\u202e\\u2060\\ufeff';
const HIDDEN = new RegExp(`[${CONTROL_CHARS}${INVISIBLE_CHARS}\\u00a0]`);
const CONTROL_RE = new RegExp(`[${CONTROL_CHARS}]`, 'g');
const CONTROL_RUN = new RegExp(`[${CONTROL_CHARS}]+`, 'g');
const INVISIBLE_RE = new RegExp(`[${INVISIBLE_CHARS}]`, 'g');
const SPACE_RUN = new RegExp(`[${CONTROL_CHARS}\\s]+`, 'g');
export const hasHiddenCharacters = s => typeof s === 'string' && HIDDEN.test(s);
// Spaces (plain spaces or tabs) at the start or end, when the value has no other hidden character.
export const hasEdgeSpaces = s => typeof s === 'string' && s !== s.trim();
// An identifier (GSTIN, PAN, PIN code, state) without line breaks, invisible characters and spaces around it.
// Used only where the value is written to a Zoho file, and every change is reported (see contactInfo in masters.js).
export const cleanIdentifier = s => String(s ?? '').replace(CONTROL_RE, '').replace(INVISIBLE_RE, '').replace(/\u00a0/g, '').trim();
// A line of text (an address line): line breaks and other control characters become a space, invisible characters are
// removed, and spaces around the line are removed. Spaces inside the line are kept as written.
export const cleanLine = s => String(s ?? '').replace(INVISIBLE_RE, '').replace(CONTROL_RUN, ' ').trim();
// The form of a name used to find likely duplicates: hidden characters removed, runs of spaces made one, no spaces
// around it, capital letters ignored. Never written anywhere: the name itself is kept exactly as in Tally.
export const nameKey = s => String(s ?? '').replace(INVISIBLE_RE, '').replace(SPACE_RUN, ' ').trim().toLowerCase();

// Formats of Indian tax identifiers. They are only CHECKED: a value that does not match is flagged, never changed.
export const GSTIN_FORMAT = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
// The 15th character of a GSTIN is a check character (mod 36 over the first 14, the weights 1 and 2 alternating), as the
// GST portal works it out. A GSTIN of the right format whose check character is not that one is not a real GSTIN.
const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export function gstinCheckDigitOk(g) {
  const s = String(g ?? '');
  if (!GSTIN_FORMAT.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) { const p = GSTIN_CHARS.indexOf(s[i]) * (i % 2 ? 2 : 1); sum += Math.floor(p / 36) + (p % 36); }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36] === s[14];
}
export const PAN_FORMAT = /^[A-Z]{5}\d{4}[A-Z]$/;

// The name of a master record. Real TallyPrime exports have no top-level "name" on ledgers, groups and stock items:
// the name is in metadata.name, and again in languagename[0].name as a Tally list [ {metadata:true,...}, "Name", "Alias" ].
// Order: the top-level name when it has a value, else metadata.name, else the first name in the languagename list.
// The name is returned exactly as written (not trimmed), because vouchers refer to it that way.
export function recordName(m) {
  if (!m || typeof m !== 'object') return '';
  if (filled(m.name)) return tallyText(m.name);
  if (filled(m.metadata?.name)) return tallyText(m.metadata.name);
  const lang = listValues(m.languagename).find(x => x && typeof x === 'object');
  const first = listValues(lang?.name).find(filled);
  return first == null ? '' : tallyText(first);
}
// Where the record's name was found: 'name', 'metadata.name', 'languagename' or null.
export function nameSource(m) {
  if (!m || typeof m !== 'object') return null;
  if (filled(m.name)) return 'name';
  if (filled(m.metadata?.name)) return 'metadata.name';
  return recordName(m) ? 'languagename' : null;
}
// The group above a ledger, group or stock item (top-level "parent"). '' when there is none.
export const recordParent = m => (m && typeof m === 'object' ? tallyText(m.parent) : '');

const lowerKeys = obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v]));

export function getMessages(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
  const msgs = lowerKeys(doc).tallymessage;
  return Array.isArray(msgs) ? msgs : null;
}

// The warning given when a file names another company than the migration's. null when they agree or none is named.
export function companyWarning(company, job) {
  if (!company || company.trim().toLowerCase() === String(job.company || '').trim().toLowerCase()) return null;
  return `The file says company "${company}", but this migration is for "${job.company}". Your selection was not changed.`;
}

export function getCompany(doc) {
  const vars = lowerKeys(doc).static_variables;
  if (!Array.isArray(vars)) return null;
  const v = vars.find(x => String(x?.name || '').toLowerCase() === 'svcurrentcompany');
  return v ? String(v.value) : null;
}

// Tally lists come as [ {metadata:true,...}, "v1", "v2" ]
export function listValues(v) {
  if (!Array.isArray(v)) return v == null ? [] : [v];
  return v.filter(x => !(x && typeof x === 'object' && x.metadata === true));
}

// The record type. Real TallyPrime exports write some types with a space ("Stock Item"); the platform uses one
// spelling for each type it reads, so "Stock Item" and "StockItem" are the same type. Other types are kept as written.
const TYPE_SPELLING = { stockitem: 'StockItem', stockgroup: 'StockGroup', stockcategory: 'StockCategory', vouchertype: 'Voucher Type', costcentre: 'Cost Centre', costcategory: 'Cost Category' };
export const entryType = e => {
  const t = String(e?.metadata?.type || '').trim();
  return TYPE_SPELLING[t.toLowerCase().replace(/\s+/g, '')] || t;
};
export const entryVchType = e => String(e?.metadata?.vchtype || e?.vouchertypename || '').trim();

// ---------- amounts ----------
// Tally writes an amount in Tally's sign (a debit negative) as plain decimal text ("-1180.50"). Two other forms are read:
//  - an amount on a ledger kept in another currency: the foreign amount, the rate of exchange and the rupee (base
//    currency) value: "-€8500.00 @ ₹91.80/€ = -₹780300.00" (spaces after the symbols and a missing rupee sign are
//    accepted: "-$ 1000.00 @ 80.00/$ = -80000.00");
//  - a figure with a Dr / Cr suffix ("100.00 Dr" is a debit, -100.00; "100.00 Cr" a credit, +100.00).
// ASSUMED SHAPE: the foreign-currency form is the one of Tally's XML export; no real TallyPrime JSON export with a
// foreign-currency ledger has been seen. When the text has no "= <rupee value>" part, it is not guessed: unreadable.
// Returns { inr: Decimal (the base-currency amount, Tally's sign), fx: Decimal | null (the foreign amount, same sign),
// currencySymbol: string | null, rate: Decimal | null (rupees per unit) } or null when the text is not an amount.
const finite = d => (d && d.isFinite() ? d : null);
const plainNumber = s => { if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return null; try { return finite(new Decimal(s)); } catch { return null; } };
// "-₹ 780300.00", "-780300.00", "₹-780300.00", "Rs. 780300" -> Decimal (a currency sign before or after the sign)
function signedFigure(text, symbol = null) {
  let s = String(text).replace(/,/g, '').trim();
  let neg = false;
  if (s.startsWith('-')) { neg = true; s = s.slice(1).trim(); } else if (s.startsWith('+')) s = s.slice(1).trim();
  const strip = x => {
    if (symbol && x.startsWith(symbol)) return x.slice(symbol.length).trim();
    const m = /^(₹|Rs\.?|INR)\s*/i.exec(x);
    return m ? x.slice(m[0].length).trim() : x;
  };
  s = strip(s);
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1).trim(); }
  const d = plainNumber(s);
  return d ? (neg ? d.negated() : d) : null;
}
const FOREX = /^\s*([+-]?)\s*([^\d\s@=+.-][^\d@=]*?)?\s*([\d,]*\.?\d+)\s*@\s*(?:₹|Rs\.?|INR)?\s*([\d,]*\.?\d+)\s*\/\s*([^=]*?)\s*=\s*(.+?)\s*$/i;
export function parseTallyAmount(v) {
  if (v == null || v === '') return { inr: new Decimal(0), fx: null, currencySymbol: null, rate: null };
  if (typeof v === 'number') return Number.isFinite(v) ? { inr: new Decimal(v), fx: null, currencySymbol: null, rate: null } : null;
  if (typeof v !== 'string') return null;
  const s = v.replace(/,/g, '').trim();
  const plain = plainNumber(s);
  if (plain) return { inr: plain, fx: null, currencySymbol: null, rate: null };
  const dc = /^([+-]?[\d.]+)\s*(Dr|Cr)\.?$/i.exec(s);
  if (dc) {
    const d = plainNumber(dc[1]);
    if (!d) return null;
    return { inr: /^dr/i.test(dc[2]) ? d.abs().negated() : d.abs(), fx: null, currencySymbol: null, rate: null };
  }
  const m = FOREX.exec(v);
  if (!m) return null;
  const symbol = (m[2] || '').trim() || (m[5] || '').trim() || null;
  const fxAbs = plainNumber(m[3].replace(/,/g, '')), rate = plainNumber(m[4].replace(/,/g, ''));
  const inr = signedFigure(m[6]);
  if (!fxAbs || !rate || !inr) return null;
  // the foreign amount takes the sign of the rupee value (Tally writes both with the same sign)
  const fx = inr.isNegative() ? fxAbs.abs().negated() : fxAbs.abs();
  return { inr, fx, currencySymbol: symbol, rate };
}

export function money(v) {
  const a = parseTallyAmount(v);
  return a ? a.inr : null;
}

// "20250903" -> "2025-09-03". null for anything that is not a real calendar day: not 8 digits, or a day that does not
// exist (Tally's export can carry "20250931" or "20260229"; such a date is never guessed into another one).
export function isoDate(d) {
  const s = String(d ?? '');
  if (!/^\d{8}$/.test(s)) return null;
  return realDate(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`);
}
// "2025-09-31" -> null, "2025-09-30" -> "2025-09-30": a yyyy-mm-dd text that is a real calendar day (years 1000-9999).
export function realDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v ?? ''));
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (y < 1000 || mo < 1 || mo > 12 || d < 1) return null;
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? m[0] : null;
}
// An 8-digit Tally date that is not a real day, in words: "31 September 2025", "29 February 2026", "month 13 of 2024".
// '' when it is a real day, or not 8 digits at all (that is "not readable", not "impossible").
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function impossibleDateWords(d) {
  const s = String(d ?? '');
  if (!/^\d{8}$/.test(s) || isoDate(s)) return '';
  const y = Number(s.slice(0, 4)), mo = Number(s.slice(4, 6)), day = Number(s.slice(6, 8));
  if (mo < 1 || mo > 12) return `month ${s.slice(4, 6)} of ${y}`;
  return `${day} ${MONTH_NAMES[mo - 1]} ${y}`;
}

// "2024-25" or "2024–25" -> { from: "2024-04-01", to: "2025-03-31" } (the Indian financial year, the default).
// yearStart (yyyy-mm-dd, optional): the first day of a year that does not start on 1 April (Tally allows any start, for
// example 1 January for a company whose books run January to December): the year is the twelve months from that day.
export function fyRange(fy, yearStart = null) {
  const start = yearStart ? realDate(yearStart) : null;
  if (start) {
    const [y, mo, d] = start.split('-').map(Number);
    const end = new Date(Date.UTC(y + 1, mo - 1, d));
    end.setUTCDate(end.getUTCDate() - 1);
    return { from: start, to: end.toISOString().slice(0, 10) };
  }
  const m = String(fy ?? '').match(/^(\d{4})/);
  if (!m) return null;
  const y = Number(m[1]);
  return { from: `${y}-04-01`, to: `${y + 1}-03-31` };
}
// THE financial year of a migration (a migrations row): { from, to }. The year start found in the Tally data or typed
// on New Migration (year_start) wins; else 1 April of the year financial_year names. Every reader of the year (the
// out-of-year rule, the dated master details, the Migration Date, the checks) calls this, so they can never differ.
export const jobYear = job => (job ? fyRange(job.financial_year, job.year_start) : null);
// The year start the Tally data shows, when it is not 1 April. booksFrom: Tally's "starting from" date of the ledgers
// (yyyymmdd, the start of the books); voucherDates: { yyyymmdd: count } of the vouchers exported. A company's own year
// starts on the first day of the month its books begin in, so the twelve months from that day, in the year that
// financial_year names, are a candidate. The candidate is taken only when more vouchers fall inside it than inside the
// April to March year: a company that simply began its books in the middle of an April to March year keeps April.
// Returns { yearStart, booksFrom, inYear, inApril } or null (April to March stays).
export function yearStartFromData(fy, booksFrom, voucherDates = {}) {
  const april = fyRange(fy);
  const books = isoDate(booksFrom);
  if (!april || !books || books.slice(8) !== '01' || books.slice(5, 7) === '04') return null;
  const candidate = fyRange(fy, `${april.from.slice(0, 4)}-${books.slice(5, 7)}-01`);
  let inYear = 0, inApril = 0;
  for (const [d, n] of Object.entries(voucherDates)) {
    const iso = isoDate(d);
    if (!iso) continue;
    if (iso >= candidate.from && iso <= candidate.to) inYear += Number(n) || 0;
    if (iso >= april.from && iso <= april.to) inApril += Number(n) || 0;
  }
  return inYear > inApril ? { yearStart: candidate.from, booksFrom: books, inYear, inApril } : null;
}

// THE identity of a Tally record: its guid, else its remote id, else the fallback the caller gives. For a voucher the
// caller's fallback includes the record's position in its file (TALLY-001), so two vouchers without a number never
// collide; a copy of the same voucher (same guid) gets the same identity and is written once (vouchers.js).
export function sourceId(e, fallback) {
  return String(e.guid || e.remoteid || e.metadata?.remoteid || fallback);
}

// ---------- comparing names between vouchers, reports and masters ----------
// Real master names can end in a line break (CR LF) that the same name on a voucher or in a report does not have.
// Names are compared by this key: hidden characters removed, then spaces around the name removed. Capital letters and
// spaces inside the name still count. The key is used only to compare: neither value is ever changed or written.
export const matchKey = s => String(s ?? '').replace(CONTROL_RE, '').replace(INVISIBLE_RE, '').replace(/\u00a0/g, ' ').trim();
// A set of master names that also finds a name differing only by hidden characters or spaces around it.
// has(name): true for such a name too. canonical(name): the name as the master writes it (the first master met), or
// the name given when no master has it.
export class NameSet extends Set {
  constructor(names = []) {
    super(names);
    this.byKey = new Map();
    for (const n of names) { const k = matchKey(n); if (k && !this.byKey.has(k)) this.byKey.set(k, n); }
  }
  has(name) { return super.has(name) || this.byKey.has(matchKey(name)); }
  canonical(name) { return super.has(name) ? name : this.byKey.get(matchKey(name)) ?? name; }
}

// ---------- vouchers that Tally does not post to the books ----------
// A cancelled voucher keeps its number but has no effect; an optional voucher is a draft that is not posted; a deleted
// voucher is kept by Tally only as a trace. None of them may reach a Zoho file. Real TallyPrime 7.1 exports write these
// flags as true / false; "Yes" is accepted too. Returns 'deleted', 'cancelled', 'optional', 'void' or null.
// TALLY-007: a real TallyPrime export also carries isvoid, isdeletedretained and isdeletedvchretained (a deleted voucher
// kept by the Edit Log): a void voucher is left out (reason void) and a deleted-but-retained one as deleted. Their
// meaning is the tool's reading, not yet confirmed by a real export with one of them true.
const flagOn = v => v === true || (typeof v === 'string' && /^(yes|true)$/i.test(v.trim()));
export function voucherStatus(v) {
  if (!v || typeof v !== 'object') return null;
  if (flagOn(v.isdeleted) || flagOn(v.vchstatusisdeleted) || flagOn(v.isdeletedretained) || flagOn(v.isdeletedvchretained)) return 'deleted';
  if (flagOn(v.iscancelled) || flagOn(v.vchstatusiscancelled)) return 'cancelled';
  if (flagOn(v.isvoid) || flagOn(v.vchstatusisvoid)) return 'void';
  if (flagOn(v.isoptional) || flagOn(v.vchstatusisoptional)) return 'optional';
  return null;
}
// TALLY-007: the other Tally status flags that may mean the voucher is not posted in the books of the period (on hold,
// post-dated, an opening balance entered as a voucher). Their effect has not been confirmed with a real export, so the
// voucher is written as Tally holds it and FLAGGED (kind voucher_status_unverified), never silently. Returns the flag
// names that are on, [] when none.
export const UNVERIFIED_STATUS_FLAGS = ['isonhold', 'ispostdated', 'isopbaltransaction', 'vchstatusisopeningbalance'];
export const unverifiedStatusFlags = v => (v && typeof v === 'object' ? UNVERIFIED_STATUS_FLAGS.filter(f => flagOn(v[f])) : []);
export const VOUCHER_STATUS_TEXT = {
  cancelled: 'This voucher is cancelled in Tally. It is kept and counted, but it is never written to a Zoho file and is left out of the checks.',
  optional: 'This voucher is marked optional in Tally (a draft that is not posted to the books). It is kept and counted, but it is never written to a Zoho file and is left out of the checks.',
  deleted: 'This voucher is marked deleted in Tally. It is kept and counted, but it is never written to a Zoho file and is left out of the checks.',
  void: 'This voucher is marked void in Tally (isvoid). It is kept and counted, but it is never written to a Zoho file and is left out of the checks. This reading of the flag is not yet confirmed by a real export.',
};

// ---------- the ledger lines of a voucher ----------
// Real TallyPrime 7.1 exports write the lines of a voucher in ONE of two lists: "allledgerentries" (vouchers entered
// in the accounting view) or "ledgerentries" (vouchers entered in the invoice view). No real voucher seen so far has
// both. If a voucher does carry both lists with lines, they must not simply be added up (that would count every line
// twice when the lists repeat each other). The list used is then the first of these under which the voucher balances:
// allledgerentries alone, ledgerentries alone, both together. When none balances, both together are used (as before)
// and the voucher is flagged as unbalanced. Returns { entries, both, used }: both is true when both lists had lines.
const isObject = x => !!x && typeof x === 'object' && !Array.isArray(x);
// TALLY-013: a list Tally writes as a single object is read as a one-item list; items that are not objects (null) are
// skipped (oddListShape says so, for a flag). Every list of lines is read through this one helper.
export const lineList = v => (Array.isArray(v) ? v.filter(isObject) : isObject(v) ? [v] : []);
// Whether a voucher's lists of lines had to be normalised: a list written as one object, or items that are not objects.
export function oddListShape(v) {
  const odd = x => x != null && (isObject(x) || (Array.isArray(x) && x.some(i => !isObject(i))));
  if (!v || typeof v !== 'object') return false;
  if ([v.allledgerentries, v.ledgerentries, v.allinventoryentries].some(odd)) return true;
  return lineList(v.allinventoryentries).some(inv => odd(inv.accountingallocations));
}
function sumOf(entries, v) {
  let total = new Decimal(0);
  for (const le of entries) { const a = money(le.amount); if (a === null) return null; total = total.plus(a); }
  for (const inv of lineList(v.allinventoryentries)) for (const al of lineList(inv.accountingallocations)) { const a = money(al.amount); if (a === null) return null; total = total.plus(a); }
  return total;
}
export function ledgerEntryList(v) {
  const all = lineList(v?.allledgerentries), led = lineList(v?.ledgerentries);
  if (!all.length || !led.length) return { entries: all.length ? all : led, both: false, used: all.length ? 'allledgerentries' : led.length ? 'ledgerentries' : null };
  for (const [used, entries] of [['allledgerentries', all], ['ledgerentries', led], ['both lists together', [...led, ...all]]]) {
    if (sumOf(entries, v)?.isZero()) return { entries, both: true, used };
  }
  return { entries: [...led, ...all], both: true, used: 'both lists together' };
}

// Returns { ok, total, error, unreadable } where a balanced voucher has entries summing to exactly zero; unreadable is
// true when an amount cannot be read at all (it is never counted as zero).
export function voucherBalance(v) {
  const entries = ledgerEntryList(v).entries;
  let total = new Decimal(0);
  for (const le of entries) {
    const a = money(le.amount);
    if (a === null) return { ok: false, unreadable: true, error: `Unreadable amount "${le.amount}" on ledger "${le.ledgername}"` };
    total = total.plus(a);
  }
  for (const inv of lineList(v.allinventoryentries)) {
    for (const al of lineList(inv.accountingallocations)) {
      const a = money(al.amount);
      if (a === null) return { ok: false, unreadable: true, error: `Unreadable amount "${al.amount}" on item "${inv.stockitemname}"` };
      total = total.plus(a);
    }
  }
  if (!entries.length && !lineList(v.allinventoryentries).length) return { ok: false, error: 'Voucher has no ledger entries' };
  return total.isZero() ? { ok: true, total } : { ok: false, total, error: `Debits and credits differ by ${total.abs().toFixed(2)}` };
}

// TALLY-002: whether a voucher carries an accounting line with an amount that is not zero (a ledger line, or the
// accounting allocation of an item line). An amount that cannot be read counts as a line (it is never taken as zero):
// the voucher then goes the way of a posting voucher and is left out there with the reason unreadable amount.
export function hasPostingLines(v) {
  if (!v || typeof v !== 'object') return false;
  const amounts = [...ledgerEntryList(v).entries.map(le => le.amount),
    ...lineList(v.allinventoryentries).flatMap(inv => lineList(inv.accountingallocations).map(al => al.amount))];
  return amounts.some(a => { const m = money(a); return m === null || !m.isZero(); });
}
