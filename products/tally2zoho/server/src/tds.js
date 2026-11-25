// THE TDS MODEL: which Zoho TDS tax, rate and section code a TDS amount of Tally is written with.
//
// Zoho Books refuses a bill or invoice row that has a TDS Name and a TDS Amount but no TDS Percentage or no TDS
// Section Code ("Enter the required TDS details.", second test import). So every row with TDS carries all three.
// Nothing here knows a company: it works from what Tally gives (the ledger's nature of payment, its rate, the TDS amount
// and the taxable base of the document) and from the table in zohorules.json (lists.tds.nature_table).
//
//  Percentage, in this order: a percentage chosen in Mapping Studio; the rate Tally's own amount shows (the amount
//    divided by the base, when it is one standard rate); the rate on the Tally ledger; the rate of the matching tax in
//    Zoho's TDS export; the usual rate of the section (the table). The source is told in the Assumptions list.
//  Section code: exactly what Zoho's TDS export says for the matching tax; else the section number (194J) for a
//    transaction before 01/04/2026 and the Income Tax Act 2025 code (professional_fees) from that date (setting tdsAct).
//  Name: a name chosen in Mapping Studio; else the matching tax of Zoho's TDS export (same section, same rate, valid on
//    the date); else the name of the table, made unique (section and rate added) when Zoho already has a tax of that
//    name with another rate or section. A tax that does not exist yet is listed in "TDS taxes to create".

import fs from 'node:fs';
import Decimal from 'decimal.js';
import { tdsSectionOf, TDS_CHOICES, tdsSectionsOfCode, tdsCodeOfSection, TDS_NEW_CODES } from './defaults.js';

const LIST = (() => { try { return JSON.parse(fs.readFileSync(new URL('./zohorules.json', import.meta.url), 'utf8')).lists.tds || {}; } catch { return {}; } })();
export const TDS_ACT_CUTOVER = LIST.act_cutover?.date || '2026-04-01';
export const TDS_ACT_OPTIONS = ['auto', 'old', 'new'];
export const TDS_BASE_OPTIONS = ['subtotal', 'total'];
const STANDARD_RATES = (LIST.standard_rates || ['0.1', '0.5', '1', '1.5', '2', '2.5', '3', '5', '7.5', '10', '15', '20', '30']).map(x => new Decimal(x));
const DEFAULT_TAXES = (LIST.zoho_default_taxes?.taxes || []).map(t => ({ ...t, start: LIST.zoho_default_taxes?.start_date || TDS_ACT_CUTOVER, end: '', status: 'Active', zohoDefault: true }));
const r2 = d => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const sameRate = (a, b) => { try { return new Decimal(String(a).replace('%', '')).equals(new Decimal(String(b).replace('%', ''))); } catch { return false; } };

// ---------- the table: section -> the Zoho TDS tax(es) ----------
// Every row: { section (old-act number), name, rate, codeNew, aliases, forServices, customerDefault }. A section with
// variants (one section, taxes of different rates) gives several rows.
const TABLE = (LIST.nature_table || []).flatMap(e => (e.variants || [e]).map(x => ({
  section: e.section, oldCode: x.section_old || e.section, name: x.name, rate: x.rate || '', codeNew: x.code_new || null, aliases: x.aliases || [], forServices: !!(x.for_services ?? e.for_services), customerDefault: !!(x.customer_default ?? e.customer_default) })));
export const natureEntries = section => {
  const own = TABLE.filter(e => e.section === section);
  if (own.length) return own;
  // a section the table has no row for: its Zoho code from the pick list (defaults.js), no usual rate
  const choice = TDS_CHOICES.find(c => c.sections.includes(section));
  return choice ? [{ section, oldCode: section, name: choice.name, rate: '', codeNew: choice.code, aliases: [], forServices: false, customerDefault: false }] : [];
};

// A section text -> the key two spellings of one tax share: the new-act code of the table ("194J", "professional_fees"
// and "194JB" all give professional_fees). '' for an empty text; the text itself, lower case, when it is not known.
export function sectionKeyOf(text) {
  const s = String(text ?? '').trim();
  if (!s) return '';
  const low = s.toLowerCase();
  const byCode = TABLE.find(e => e.codeNew === low || e.aliases.includes(low));
  if (byCode) return byCode.codeNew;
  const old = tdsSectionOf(s);
  if (old) return natureEntries(old)[0]?.codeNew || old;
  return low;
}
const entryKeys = e => new Set([e.codeNew, ...e.aliases, e.oldCode || e.section].filter(Boolean).map(sectionKeyOf));
export const iso = d => String(d ?? '').slice(0, 10);
export const actFor = (date, setting = 'auto') => (setting === 'old' || setting === 'new' ? setting : iso(date) && iso(date) >= TDS_ACT_CUTOVER ? 'new' : 'old');
export const ACT_WORDS = { old: 'Income Tax Act, 1961', new: 'Income Tax Act, 2025' };
const validOn = (t, date) => { const d = iso(date); return !d || ((!t.start || t.start <= d) && (!t.end || d <= t.end)); };

// THE one answer to "which TDS taxes exist in the Zoho Books organisation" (TDS-011), used by the generator (resolveTds,
// the "TDS taxes to create" list) and by the Zoho check alike:
//  - Zoho's own TDS export of the organisation, when it was given: every tax of it (evidence 'zoho_export'), with its
//    status (an Inactive tax exists but may be refused on a document: the check says so);
//  - plus the taxes a new organisation has by itself (zohorules.json lists.tds.zoho_default_taxes, confirmed by import),
//    each only on the dates it is valid for (evidence 'zoho_default'). With an export a default name the export has is
//    the export's row (the export is the organisation as it is).
// date: 'YYYY-MM-DD' of the document; '' gives every tax whatever its dates. A name only chosen in Mapping Studio is NOT
// here: a choice is not proof that the tax exists (TDS-002).
export function knownTdsTaxes(exported = null, date = '') {
  const own = (exported || []).map(t => ({ ...t, start: t.start || '', end: t.end || '', status: t.status || '', evidence: 'zoho_export' }));
  const names = new Set(own.map(t => String(t.name).trim().toLowerCase()));
  const defaults = DEFAULT_TAXES.filter(t => !names.has(t.name.toLowerCase()) && (!iso(date) || validOn(t, date))).map(t => ({ ...t, evidence: 'zoho_default' }));
  return [...own, ...defaults];
}
export const DEFAULT_TDS_START = DEFAULT_TAXES[0]?.start || TDS_ACT_CUTOVER;
// a tax Zoho Books has by itself: the same name, rate and section (section in any spelling; an empty one does not decide)
export const isDefaultTdsTax = (name, rate, section) => DEFAULT_TAXES.some(t => t.name.toLowerCase() === String(name ?? '').trim().toLowerCase()
  && sameRate(t.rate, rate) && (!String(section ?? '').trim() || String(section).split(/\s*,\s*|\s+or\s+/).some(s => sectionKeyOf(s) === sectionKeyOf(t.section))));

// The rate Tally's own TDS amount shows: amount / base when exactly one standard rate gives the amount (to the paisa,
// else within a rupee: Tally often rounds TDS to the rupee). null when none or several do.
export function cleanTdsRate(amount, base) {
  if (!amount || !base || amount.lessThanOrEqualTo(0) || base.lessThanOrEqualTo(0)) return null;
  const within = limit => STANDARD_RATES.filter(s => r2(base.times(s).div(100)).minus(amount).abs().lessThanOrEqualTo(limit));
  const exact = within(new Decimal('0.01'));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const near = within(new Decimal(1));
  return near.length === 1 ? near[0] : null;
}

// The name made unique: "Commission or Brokerage 194H 5%".
export const uniqueTdsName = (name, section, rate) => `${String(name).trim()} ${section ? `${section} ` : ''}${rate}%`.slice(0, 100).trim();

// ---------- the resolution ----------
// in: { amount (Decimal, positive) | null, subTotal, taxTotal (Decimals), date ('YYYY-MM-DD'), settings: { tdsAct, tdsBase },
//   mapping: { tdsName, section, percent } | null (Mapping Studio), suggestion: { section, percent, tdsName } | null (the
//   section and rate Tally gives, defaults.js tdsSuggestion), customer: true when the TDS is deducted by a customer,
//   exported: [{ name, rate, section, start, end, status }] | null (Zoho's TDS export) }
// out: { tdsName, section, percent, act, create (the tax does not exist in Zoho yet), madeUnique, rateFrom, nameFrom,
//   sectionFrom, entry, inferred, missing: [what could not be worked out] }
export function resolveTds({ amount = null, subTotal = null, taxTotal = null, date = '', settings = {}, mapping = null, suggestion = null, customer = false, exported = null, claims = null, businessType = '' }) {
  void claims; // TDS-017: names no longer depend on the order of the documents in a run (kept for callers)
  const act = actFor(date, settings.tdsAct);
  const base = subTotal && settings.tdsBase === 'total' ? subTotal.plus(taxTotal || 0) : subTotal;
  const alt = subTotal && settings.tdsBase === 'total' ? subTotal : subTotal ? subTotal.plus(taxTotal || 0) : null;
  const evidence = amount && base ? cleanTdsRate(amount, base) || (alt && !alt.equals(base) ? cleanTdsRate(amount, alt) : null) : null;
  // every tax whatever its dates: usable() below decides by the date and the status
  const known = knownTdsTaxes(exported).map(t => (t.evidence === 'zoho_default' ? { ...t, zohoDefault: true } : t));
  const mapped = !!mapping?.tdsName;
  const mappedName = mapped ? mapping.tdsName.trim() : '';
  const warnings = []; // [{ kind, text }]: said by the caller as flagged items

  // 1. the table row. TDS-018: the section of the mapping is read in any spelling (194-J, professional_fees) and written in
  // the form of the document's act; TDS-001: a mapped name that is a name of the table or of the pick list gives its section
  const mapSec = normaliseTdsSection(mapping?.section);
  let section = mapSec?.section || '';
  let namedEntry = null;
  if (!section && mapped && !mapSec) section = tdsSectionOf(mappedName);
  if (mapped && !mapSec) {
    namedEntry = TABLE.find(e => e.name.toLowerCase() === mappedName.toLowerCase() && (!section || e.section === section || e.oldCode === section)) || null;
    if (!namedEntry && !section) {
      const choice = TDS_CHOICES.find(c => c.name.toLowerCase() === mappedName.toLowerCase());
      if (choice) namedEntry = TABLE.find(e => e.codeNew === choice.code) || { section: choice.sections[0] || '', oldCode: choice.sections[0] || '', name: choice.name, rate: '', codeNew: choice.code, aliases: [], forServices: false, customerDefault: false };
    }
    if (namedEntry && !section) section = namedEntry.section;
  }
  // the section Tally gives stays the fallback when the mapped name says nothing (TDS-001)
  if (!section && !namedEntry && !mapSec?.code) section = suggestion?.section || '';
  const rateHint = mapping?.percent || (evidence ? evidence.toString() : '') || suggestion?.percent || '';
  let entries = namedEntry ? [namedEntry] : section ? natureEntries(section) : [];
  if (!entries.length && mapSec?.code) entries = [TABLE.find(e => e.codeNew === mapSec.code || e.aliases.includes(mapSec.code)) || { section: '', oldCode: '', name: '', rate: '', codeNew: mapSec.code, aliases: [], forServices: false, customerDefault: false }];
  let inferred = false, ambiguous = false;
  if (!entries.length && !mapped && customer) {
    // TDS deducted by a customer on a ledger whose section Tally does not give: the rate decides which section fits;
    // with no usable rate the table's customer default. TDS-010: whenever more than one Zoho tax (code) fits the rate it is
    // said (ambiguous), and for a goods business 0.1% is a purchase of goods (194Q), not e-commerce.
    const services = TABLE.filter(e => e.forServices);
    let fit = rateHint ? services.filter(e => sameRate(e.rate, rateHint)) : [];
    if (fit.length) ambiguous = new Set(fit.map(e => e.codeNew || e.section)).size > 1;
    // no service section has this rate (for example 0.1%, which fits 194O and 194Q): look at every section of the table.
    // A rate that fits no section leaves the TDS unresolved (the person chooses in Mapping Studio); 194J is never written
    // just because nothing else fits.
    if (!fit.length && rateHint) {
      fit = TABLE.filter(e => e.rate && sameRate(e.rate, rateHint));
      ambiguous = new Set(fit.map(e => e.codeNew || e.section)).size > 1;
    }
    const goods = businessType === 'goods' ? fit.find(e => e.section === '194Q') : null;
    const pick = goods || fit.find(e => e.customerDefault) || fit[0] || (rateHint ? null : TABLE.find(e => e.customerDefault) || services[0]);
    if (pick) { entries = [pick]; section = pick.section; inferred = true; }
  }
  const entry = entries.find(e => rateHint && sameRate(e.rate, rateHint)) || entries[0] || null;
  const keys = entry ? entryKeys(entry) : null;

  // 2. the taxes of Zoho's export (or Zoho's own default taxes). TDS-003: a tax counts for a document only when it is valid
  // on the document's date and not Inactive; a tax of the same section and rate that is not valid then is said, and the
  // tax is listed to create.
  const usable = t => validOn(t, date) && !/inactive/i.test(String(t.status || ''));
  const sameSection = keys ? known.filter(t => keys.has(sectionKeyOf(t.section))) : [];
  const byNameRows = mapped ? known.filter(t => t.name.toLowerCase() === mappedName.toLowerCase()) : [];
  const pickRow = (rows, rate) => rows.find(t => rate && sameRate(t.rate, rate) && usable(t)) || null;

  // 3. the percentage
  let percent = '', rateFrom = '';
  const take = (v, from) => { if (!percent && v !== '' && v != null) { percent = String(v); rateFrom = from; } };
  take(mapping?.percent, 'mapping');
  take(evidence ? evidence.toString() : '', 'tally_amount');
  take(suggestion?.percent, 'tally_ledger');
  const exportRow = mapped ? byNameRows.find(usable) : sameSection.find(usable);
  take(exportRow?.rate ? String(Number(exportRow.rate)) : '', 'zoho_export');
  take(entry?.rate, 'table');
  if (percent) percent = String(new Decimal(percent).toString());

  // 4. the name and the section code
  const oldOf = e => e?.oldCode || e?.section || '';
  let codeNote = '';
  const codeFromAct = () => {
    if (act === 'new') return entry?.codeNew || oldOf(entry) || '';
    if (oldOf(entry)) return oldOf(entry);
    // a code of Zoho's new-act list with no section of the old act: the code is written (the only form known), and said
    if (entry?.codeNew) { codeNote = entry.codeNew; return entry.codeNew; }
    return '';
  };
  let tdsName = '', sectionCode = '', nameFrom = '', sectionFrom = '', create = false, madeUnique = false, row = null;
  // taxes of the organisation's export of this rate that are not usable on the date (Zoho's own default taxes are known to
  // start at the cutover, so they are not said for every older document)
  const notValidRows = rows => rows.filter(t => !t.zohoDefault && percent && sameRate(t.rate, percent) && !usable(t));
  if (mapped) {
    tdsName = mappedName; nameFrom = 'mapping';
    row = pickRow(byNameRows, percent);
    // TDS-004: the rate of the mapped tax (Zoho's export, Zoho's own default, else the table or pick-list row of that name)
    // differs from this document's percentage: the document gets a tax of its own, never one name with two rates
    const theirRate = (byNameRows.find(usable) || byNameRows[0])?.rate
      || TABLE.find(e => e.name.toLowerCase() === mappedName.toLowerCase())?.rate || '';
    if (!row && percent && theirRate && !sameRate(theirRate, percent)) {
      tdsName = uniqueTdsName(mappedName, oldOf(entry) || tdsSectionOf(mappedName) || '', percent);
      madeUnique = true; create = true; nameFrom = 'unique';
    } else if (!row && byNameRows.length && notValidRows(byNameRows).length) {
      create = true;
      warnings.push({ kind: 'tds_tax_not_valid_on_date', text: notValidText(notValidRows(byNameRows)[0], date) });
    }
  } else if (entry) {
    row = pickRow(sameSection, percent);
    if (row) { tdsName = row.name; nameFrom = row.zohoDefault ? 'zoho_default' : 'zoho_export'; }
    else {
      create = true; nameFrom = 'table'; tdsName = entry.name;
      const stale = notValidRows(sameSection);
      if (stale.length) warnings.push({ kind: 'tds_tax_not_valid_on_date', text: notValidText(stale[0], date) });
      // TDS-017: the plain name only for the table's usual rate, and only when no tax Zoho has uses that name for another
      // rate, section or act (a tax of that name Zoho has but not usable on this date included: two taxes never share a name);
      // every other rate gets a unique name, whatever the order of the documents in a run
      const clash = known.some(t => t.name.toLowerCase() === tdsName.toLowerCase());
      if (percent && tdsName && (clash || !entry.rate || !sameRate(entry.rate, percent))) {
        tdsName = uniqueTdsName(entry.name, oldOf(entry) || codeFromAct(), percent);
        madeUnique = true; nameFrom = 'unique';
      }
    }
  }
  if (mapSec?.section || mapSec?.code) {
    sectionCode = act === 'old' ? (mapSec.section || mapSec.code) : (mapSec.code || mapSec.section);
    if (act === 'old' && !mapSec.section) codeNote = mapSec.code;
    sectionFrom = 'mapping';
  } else if (mapSec?.unknown) {
    // a section nobody knows (neither an old section nor a code of Zoho's list): written as given, and said (the check refuses it)
    sectionCode = mapSec.unknown; sectionFrom = 'mapping';
    warnings.push({ kind: 'tds_section_not_known', text: `The section "${mapSec.unknown}" chosen in TDS mapping is neither a section of the Income Tax Act, 1961 (for example 194J) nor a code of Zoho's list (for example professional_fees). Zoho will refuse it.` });
  } else if (row?.section) { sectionCode = row.section; sectionFrom = 'zoho_export'; }
  else if (entry) { sectionCode = codeFromAct(); sectionFrom = 'table'; }
  if (codeNote && sectionCode === codeNote) warnings.push({ kind: 'tds_new_code_on_old_date', text: `Section code "${codeNote}" is a code of the Income Tax Act, 2025, written on a document dated before ${TDS_ACT_CUTOVER}: no section of the 1961 Act is known for it. Zoho may refuse it; choose the section in Mapping Studio (TDS mapping).` });
  const missing = [];
  if (!tdsName) missing.push('the Zoho TDS tax');
  if (!percent) missing.push('the percentage');
  if (!sectionCode) missing.push('the section code');
  return { tdsName, section: sectionCode, percent, act, create, madeUnique, rateFrom, nameFrom, sectionFrom, entry, inferred, ambiguous, missing, warnings, tallyRate: evidence ? evidence.toString() : '' };
}
const notValidText = (t, date) => `Zoho's TDS export has "${t.name}" (${t.rate}%, ${t.section || 'no section'}), but ${/inactive/i.test(String(t.status || '')) ? 'it is Inactive' : `it is valid only${t.start ? ` from ${t.start}` : ''}${t.end ? ` to ${t.end}` : ''}`}, and this document is dated ${iso(date)}. It is not used here: the tax is listed under TDS taxes to create with the right act and start date.`;

// TDS-018: a section as typed (194-J, 194J, professional_fees) -> { section (old act), code (new act) } | { unknown } | null.
export function normaliseTdsSection(text) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  const low = s.toLowerCase();
  const byTable = TABLE.find(e => e.codeNew === low || e.aliases.includes(low));
  if (byTable || TDS_NEW_CODES.has(low)) return { section: byTable ? byTable.oldCode : (tdsSectionsOfCode(low)[0] || ''), code: low };
  const old = tdsSectionOf(s);
  if (old) return { section: old, code: TABLE.find(e => e.oldCode === old)?.codeNew || tdsCodeOfSection(old) || natureEntries(old)[0]?.codeNew || null };
  return { unknown: s };
}
// The stored form of a section typed in TDS mapping: the old section (194J) or the code as typed; '' for nothing; null
// when it is neither (the API refuses it).
export const storedTdsSection = text => { const n = normaliseTdsSection(text); if (!n) return ''; if (n.unknown) return null; return TDS_NEW_CODES.has(String(text).trim().toLowerCase()) || !n.section ? n.code : n.section; };

// ---------- TCS (TDS-015) ----------
// The Nature Of Collection of a TCS ledger from Tally's nature of goods (words only, never the ledger name), in the form of
// the document's act: { section (old act, 206C(1H)), code (new act, sale_scrap or null), value (what is written), rate
// (usual) } or null when nothing fits or the act has no form for it.
const TCS_TABLE = LIST.tcs_nature_table || [];
export function tcsNatureOf(nature, date = '', setting = 'auto') {
  const norm = x => ' ' + String(x ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
  const t = norm(nature);
  if (!t.trim()) return null;
  const has = w => t.includes(norm(w));
  const own = String(nature).toUpperCase().match(/206\s*C\s*\(?\s*(1[A-H]?|6CC)\s*\)?/);
  const e = own ? TCS_TABLE.find(x => x.section_old.replace(/\s/g, '') === `206C(${own[1]})`) || { code_new: null, section_old: `206C(${own[1]})`, rate: '' }
    : TCS_TABLE.find(x => (!x.all || x.all.every(has)) && (!x.any || x.any.some(has)) && (!x.any2 || x.any2.some(has)) && (x.all || x.any));
  if (!e) return null;
  const act = actFor(date, setting);
  const value = act === 'new' ? e.code_new : e.section_old;
  return value ? { section: e.section_old, code: e.code_new, value, rate: e.rate || '', act } : null;
}
export const tcsTaxName = (section, rate) => `TCS ${section} ${rate}%`.slice(0, 100);

// Words for where a percentage or a name came from (the Assumptions list, the TDS mapping card).
export const RATE_WORDS = {
  mapping: 'the percentage chosen in Mapping Studio', tally_amount: "the rate Tally's own TDS amount shows", tally_ledger: 'the rate on the Tally ledger',
  zoho_export: "the rate of the tax in Zoho's TDS export", table: 'the usual rate of the section (zohorules.json, lists.tds)',
};

// The line of a "TDS taxes to create" list: the name, rate, section code, tax act and start date.
export function tdsTaxToCreate({ tdsName, percent, section, act }, from) {
  return { name: tdsName, rate: percent, section, act, actWords: ACT_WORDS[act], startDate: act === 'new' ? TDS_ACT_CUTOVER : (from || ''), endDate: act === 'old' ? iso(new Date(Date.parse(TDS_ACT_CUTOVER) - 86400000).toISOString()) : '' };
}
