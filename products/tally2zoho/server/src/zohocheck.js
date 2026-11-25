// THE ZOHO CHECK: every rule of zohorules.json applied to every row of every Zoho file, BEFORE the file is downloaded.
//
// Why: in the first real import Zoho Books refused all invoices, all bills and 234 journals for reasons that could
// have been seen in the files. Zoho also reports only ONE error per row, so correcting it can uncover the next. This
// engine therefore applies ALL rules to every row and says, per file, how many rows and documents are expected to
// import, how many may be refused (a rule that is only assumed, or something only Zoho Books can confirm) and how
// many will be refused (a rule confirmed by our import or stated by Zoho).
//
// How it works:
//  1. The rules of a module (zohorules.json: modules.<key>.rules, plus general.rules) are compiled once per file into
//     small functions over column positions. A rule the engine cannot check from a file (an organisation setting, a
//     step of the import screen, a fact to know) is listed in notChecked with the reason; none is dropped silently.
//  2. One pass over the rows runs every row rule. Rules about a whole document or file (unique names, a journal that
//     must balance, the Total column) run once over indexes built in that pass.
//  3. Files are checked in import order. Each master file leaves an index of the names it will create in Zoho Books
//     (a name on a row that is refused is NOT created), and the voucher files are checked against those indexes and
//     against the accounts and taxes Zoho creates itself. A journal that names a bank account whose row is refused is
//     reported as refused BECAUSE of that row (a cascade), not as a problem of its own.
//  4. A document (invoice, bill, journal) is refused as a whole when one of its lines is, as Zoho does.
//  5. The result is counted per file and per cause: rows, documents, the plain message, the fix, how sure the rule is,
//     and the screen where it is fixed.
//
// This module is pure (no database, no other module of the server): it can be run on any set of CSV files.

import fs from 'node:fs';
import { TDS_CHOICES, tdsSectionOf } from './defaults.js';
import { sectionKeyOf, knownTdsTaxes, isDefaultTdsTax, DEFAULT_TDS_START } from './tds.js';
import { accountNameKey, contactNameKey } from './zohocodes.js';
import { realDate } from './tally.js';

export const RULES = JSON.parse(fs.readFileSync(new URL('./zohorules.json', import.meta.url), 'utf8'));

// The order in which files are checked: masters before the files that name them.
export const CHECK_ORDER = ['accounts', 'customers', 'vendors', 'items', 'opening_balances_for_zoho_accounts', 'invoices', 'bills', 'journals', 'other_journals'];

// ---------- how sure a rule is ----------
// tier 3 "will be refused": the rule blocks the import and is confirmed by our import or stated by Zoho (help page or sample file).
// tier 2 "may be refused": the rule blocks the import but is only assumed (or from a forum), or only Zoho Books can confirm it.
// tier 1 "warning": Zoho may accept the row; the result may be wrong.
export const TIERS = { warning: 1, may: 2, will: 3 };
const TIER_NAME = { 1: 'warning', 2: 'may', 3: 'will' };
export const TIER_LABEL = { will: 'Will be refused', may: 'May be refused', warning: 'Warning' };
export const PRE_STEP_LABEL = 'Do this first in Zoho Books';
// "Read from live organisations": read from Zoho Books itself (its own lists, read only); it counts as confirmed
export const evidenceLevel = evidence => (/^(confirmed by (our|second) import|read from live organisations)$/i.test(String(evidence)) ? 'confirmed' : evidence === 'assumed' || evidence === 'forum' || /^contradicted by/i.test(String(evidence)) ? 'assumed' : 'documented');
export const EVIDENCE_LABEL = { confirmed: 'Confirmed by our import', documented: 'Zoho documentation', assumed: 'Assumed' };
const tierOfRule = rule => (rule.severity !== 'blocks_import' ? 1 : evidenceLevel(rule.evidence) === 'assumed' ? 2 : 3);

// ---------- where each cause is fixed ----------
const MS = (anchor, label) => ({ screen: 'screen-19', anchor, label: `Mapping Studio, ${label}` });
const PLACES = [
  [/NAME-NOT-ZOHO-ACCOUNT$/, MS('ms-zoho-accounts', "Zoho's own accounts")],
  [/^COA-(BANK-NO-OB|OB-|SIDE-)/, { screen: 'screen-25', anchor: 'bank-opening-balances', label: 'Export Center, Bank opening balances' }],
  [/^COA-(TYPE|PARENT)/, MS('ms-account-types', 'Account types')],
  [/GST-TREATMENT-ALLOWED$/, { screen: 'screen-32', anchor: 'gst-codes', label: 'Company Settings, GST treatment codes' }],
  [/OPENING-BALANCE-DATE$/, { screen: 'screen-40', anchor: null, params: { step: 'date' }, label: 'Import Wizard, Save the Migration Date' }],
  [/HSN|SAC-FOR-SERVICE/, MS('ms-hsn', 'HSN/SAC')],
  [/TDS/, MS('ms-tds-mapping', 'TDS mapping')],
  [/^(BIL-TOTAL-COLUMNS-OMIT|GEN-MAX-COLUMNS|GEN-NO-EMPTY-HEADINGS|GEN-SAME-FIELD-COUNT|GEN-REQUIRED-MAPPED|ITM-NO-SAMPLE-CUSTOM-FIELD|GEN-FILE-|BIL-FILE-SIZE)/, { screen: 'screen-23', anchor: null, label: 'Template Mapping' }],
  [/^(INV|BIL)-(GST|GSTIN|PLACE|SOURCE|SUPPLY-STATES|DESTINATION)/, MS('ms-fix-contacts', 'Fix contacts')],
  [/^(BIL-TAX-REQUIRED-REGISTERED|BIL-NUMBER|INV-NUMBER|INV-ITEM-NAME|BIL-ITEM|.*-STATUS-ALLOWED|BIL-NO-EXEMPTION|BIL-SUPPLY-TYPE|INV-SUPPLY-TYPE|BIL-ACCOUNT-REQUIRED|BIL-PO-EMPTY|.*-REFERENCES-EMPTY)/, MS('ms-voucher-files', 'Voucher files')],
  [/TOTAL-DIFFERS-FROM-TALLY$/, MS('ms-tax-mapping', 'Tax mapping')],
  [/^(INV|BIL)-(TAX|EXEMPTION|RCM)/, MS('ms-tax-mapping', 'Tax mapping')],
  [/^(INV-CUSTOMER|BIL-VENDOR|JRN-CONTACT)-EXISTS$/, { screen: 'screen-20', anchor: 'journal-review', label: 'Voucher Classification' }],
  [/-ACCOUNT-EXISTS$/, MS('ms-zoho-accounts', "Zoho's own accounts")],
  [/^JRN-|NEGATIVE/, { screen: 'screen-20', anchor: 'journal-review', label: 'Voucher Classification' }],
  [/^ITM-/, MS('ms-item-rates', 'Rates')],
  [/(NAME-UNIQUE|NAME-NOT-IN-OTHER|NAME-LENGTH|NAME-REQUIRED|HIDDEN-CHARACTERS|OUTER-SPACES|APOSTROPHE)/, MS('ms-names', 'Names')],
  [/^(CUS|VEN)-/, MS('ms-fix-contacts', 'Fix contacts')],
];
export const ZOHO_CHECK_SCREEN = 'screen-38';
// Where TDS taxes that cannot be checked are settled: the Import Wizard's set-up step takes Zoho's TDS export.
export const TDS_EXPORT_PLACE = { screen: 'screen-40', anchor: null, params: { step: 'setup' }, label: 'Import Wizard, Set up Zoho Books (TDS taxes)' };
// "Professional Fees (section 194J, 10%)"
export const tdsTaxWords = t => `${t.name}${t.section || t.rate ? ` (${[t.section ? `section ${t.section}` : '', t.rate ? `${t.rate}%` : ''].filter(Boolean).join(', ')})` : ''}`;

// The step of the Import Wizard where one file is imported (and where Zoho's export of it is checked).
export const wizardStepPlace = key => ({ screen: 'screen-40', anchor: null, params: { step: key }, label: `Import Wizard, ${RULES.modules[key]?.label || key}` });
export function placeForRule(ruleId, variant = '', targetKey = null) {
  // a name Zoho Books does not have (its own export says so): fixed where that file is imported
  if (variant === 'not_in_zoho' && targetKey) return wizardStepPlace(targetKey);
  if (/^(cascade|cascade_may|watch)$/.test(variant) && targetKey) {
    return { screen: ZOHO_CHECK_SCREEN, anchor: `zc-file-${targetKey}`, label: `Zoho check, ${RULES.modules[targetKey]?.label || targetKey}` };
  }
  if (variant === 'unverified') return { screen: null, anchor: null, label: 'Zoho Books (check that it exists there)' };
  return PLACES.find(([re]) => re.test(ruleId))?.[1] || { screen: 'screen-19', anchor: null, label: 'Mapping Studio' };
}

// ---------- small helpers ----------
export const isBlank = v => v == null || v === '' || (v.charCodeAt(0) <= 32 && v.trim() === '');
const trimmed = v => (v == null ? '' : v.charCodeAt(0) <= 32 || v.charCodeAt(v.length - 1) <= 32 ? v.trim() : v);
const lower = v => trimmed(v).toLowerCase();
const headKey = h => String(h ?? '').trim();
// An amount as whole paise, without floating point: "1234.5" -> 123450. NaN when it is not a plain number.
export function toPaise(v) {
  const m = /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed(v));
  if (!m) return trimmed(v) === '' ? 0 : NaN;
  const n = Number(m[2]) * 100 + Number((m[3] || '').padEnd(2, '0'));
  return m[1] === '-' ? -n : n;
}
const num = v => { const n = Number(trimmed(v)); return trimmed(v) === '' ? NaN : n; };

// CSV text -> [[cell]]: the heading row first, cells exactly as written (not trimmed). Rows with nothing in them are dropped.
export function parseCsvTable(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const table = [];
  let row = [], start = 0, i = 0, any = false;
  const n = text.length;
  while (i <= n) {
    let cell;
    if (text.charCodeAt(i) === 34) { // quoted
      let s = '', j = i + 1;
      for (;;) {
        const q = text.indexOf('"', j);
        if (q < 0) { s += text.slice(j); j = n; break; }
        if (text.charCodeAt(q + 1) === 34) { s += text.slice(j, q + 1); j = q + 2; continue; }
        s += text.slice(j, q); j = q + 1; break;
      }
      cell = s; i = j;
      // anything written after the closing quote up to the separator belongs to the cell
      start = i;
      while (i < n && text.charCodeAt(i) !== 44 && text.charCodeAt(i) !== 10 && text.charCodeAt(i) !== 13) i++;
      if (i > start) cell += text.slice(start, i);
    } else {
      start = i;
      while (i < n && text.charCodeAt(i) !== 44 && text.charCodeAt(i) !== 10 && text.charCodeAt(i) !== 13) i++;
      cell = text.slice(start, i);
    }
    row.push(cell);
    if (cell !== '') any = true;
    const c = text.charCodeAt(i);
    if (c === 44) { i++; continue; }
    if (any) table.push(row);
    row = []; any = false;
    if (i >= n) break;
    if (c === 13 && text.charCodeAt(i + 1) === 10) i++;
    i++;
    if (i >= n) break;
  }
  return table;
}

// ---------- rule lookup ----------
export function moduleRules(key) {
  const m = RULES.modules[key];
  if (!m) return null;
  const base = m.rules_same_as ? RULES.modules[m.rules_same_as]?.rules || [] : [];
  return [...RULES.general.rules, ...base, ...(m.rules || [])];
}
const RULE_INDEX = new Map();
for (const r of RULES.general.rules) RULE_INDEX.set(r.id, r);
for (const m of Object.values(RULES.modules)) for (const r of m.rules || []) RULE_INDEX.set(r.id, r);
export const ruleById = id => RULE_INDEX.get(id) || null;
export const moduleLabel = key => RULES.modules[key]?.label || key;
// What identifies one record of a file. A journal is known by its WHOLE number: Journal Number Prefix and Journal Number
// Suffix together (modules.<key>.id_columns), because RCT-1, PMT-1 and CTR-1 share the suffix 1. Every other file has
// one identifying column (id_column). identColumnsOf: the headings to join, in order; identLabelOf: what to call it.
export const identColumnsOf = key => { const m = RULES.modules[key]; return Array.isArray(m?.id_columns) && m.id_columns.length ? m.id_columns : m?.id_column ? [m.id_column] : []; };
export const identLabelOf = key => { const m = RULES.modules[key]; return Array.isArray(m?.id_columns) && m.id_columns.length ? m.id_label || m.id_columns.join(' + ') : m?.id_column || null; };

const listOf = name => name.replace(/^lists\./, '').split('.').reduce((o, k) => o?.[k], RULES.lists);
const DEFAULT_ACCOUNTS = new Map(RULES.lists.default_accounts.map(a => [a.name.toLowerCase(), a]));
const DEFAULT_TAXES = new Set([...RULES.lists.default_taxes.intra_state_tax_groups, ...RULES.lists.default_taxes.inter_state_taxes].map(t => t.name));
const STATE_BY_PREFIX = new Map(RULES.lists.state_codes.map(s => [s.gstin_prefix, s.code]));
const PREFIX_BY_STATE = new Map(RULES.lists.state_codes.map(s => [s.code, s.gstin_prefix]));
export const stateOfGstin = gstin => STATE_BY_PREFIX.get(String(gstin || '').trim().slice(0, 2)) || null;

const CLASSES = RULES.general.column_classes || {};
const classRe = name => (CLASSES[name]?.pattern ? new RegExp(CLASSES[name].pattern, 'i') : null);
const DATE_RE = classRe('date_columns') || /\bDate$/i;
const PERCENT_RE = classRe('percentage_columns') || /(%|Percentage|Percent|Tax Rate)$/i;
const AMOUNT_COLUMNS = new Set(CLASSES.amount_columns?.columns || ['Opening Balance', 'Item Price', 'Debit', 'Credit', 'TDS Amount', 'TCS Amount', 'Tax Amount', 'Adjustment', 'Shipping Charge', 'Entity Discount Amount', 'Discount Amount']);
const NAME_COLUMNS = new Set(CLASSES.name_columns?.columns || ['Account Name', 'Parent Account', 'Display Name', 'Item Name', 'Customer Name', 'Vendor Name', 'Account', 'Contact Name']);

// Rules that are not about a cell of the file. They are listed, with this reason, and never fire.
const NOT_A_FILE_CHECK = {
  information: 'A fact to know; nothing in the file to check.',
  process: 'About the order or way of working in Zoho Books.',
  organisation_setting: 'Depends on a setting in Zoho Books.',
  date_on_or_before_setting: 'Depends on the Opening Balance Date set in Zoho Books.',
  sum_equal: 'About the Opening Balances screen of Zoho Books.',
};

// ---------- the check of one file ----------
// file: { headers: [heading], rows: [[cell]], bytes?, fileName? }. ctx: the indexes left by the files checked before
// (ctx.names[key]: Map of trimmed name -> { tier, where }), ctx.journalNumbers, and the options.
function checkOneFile(key, file, ctx) {
  const mod = RULES.modules[key];
  const rules = moduleRules(key);
  const headers = file.headers.map(headKey);
  const rows = file.rows;
  const n = rows.length;
  const col = new Map();
  headers.forEach((h, i) => { if (h && !col.has(h)) col.set(h, i); });
  const ci = name => (col.has(headKey(name)) ? col.get(headKey(name)) : -1);
  const idCol = ci(mod.id_column || '');
  // What Zoho Books really holds for this master file, when its own export was given in the Import Wizard (options.
  // zohoArrived: { <file key>: [name keys] }, zohoverify.js). null: not given, nothing is known.
  const arrived = Array.isArray(ctx.options.zohoArrived?.[key]) ? new Set(ctx.options.zohoArrived[key]) : null;
  const arrivedAccounts = Array.isArray(ctx.options.zohoArrived?.accounts) ? new Set(ctx.options.zohoArrived.accounts) : null;
  const nameKeyOf = key === 'accounts' ? accountNameKey : contactNameKey;
  // the columns that together identify one record (a journal: prefix and suffix); a column the file lacks is left out
  const identCols = identColumnsOf(key).map(ci).filter(x => x >= 0);

  const causes = new Map(); // id -> { ruleId, variant, tier, rows: [row index], cols: [column index], whole, target }
  const notChecked = [];
  const cause = (rule, variant, tier, extra) => {
    const id = variant ? `${rule.id}:${variant}` : rule.id;
    let c = causes.get(id);
    if (!c) { c = { id, rule, variant: variant || '', tier, rows: [], cols: [], whole: false, ...extra }; causes.set(id, c); }
    return c;
  };
  // one finding: rule (with an optional variant and tier) on row i, column c (-1: the rule's columns)
  const add = (rule, i, c = -1, variant = '', tier = tierOfRule(rule), extra = null) => { const k = cause(rule, variant, tier, extra); k.rows.push(i); k.cols.push(c); };
  // a finding about the whole file: every row is affected when it blocks
  const addFile = (rule, variant = '', tier = tierOfRule(rule), extra = null) => { cause(rule, variant, tier, extra).whole = true; };
  const skip = (rule, reason) => notChecked.push({ ruleId: rule.id, module: key, reason });
  // a name of a later file must be written exactly as in its master file (applied by every reference rule)
  const SAME_AS_MASTER = rules.find(r => r.params?.check === 'reference_written_as_master') || null;

  // --- conditions ---
  const cond = c => {
    if (!c || !c.column) return null;
    const x = ci(c.column);
    const get = row => (x < 0 ? '' : trimmed(row[x]));
    const vals = Array.isArray(c.value) ? new Set(c.value) : null;
    switch (c.op) {
      case 'empty': return row => get(row) === '';
      case 'notEmpty': return row => get(row) !== '';
      case 'equals': return row => get(row) === c.value;
      case 'in': return row => vals.has(get(row));
      case 'notIn': return row => !vals.has(get(row));
      case 'matches': { const re = new RegExp(c.value); return row => re.test(get(row)); }
      case 'notMatches': { const re = new RegExp(c.value); return row => !re.test(get(row)); }
      case 'lt': return row => { const v = num(get(row)); return !Number.isNaN(v) && v < c.value; };
      case 'gt': return row => { const v = num(get(row)); return !Number.isNaN(v) && v > c.value; };
      default: return null;
    }
  };

  // --- document groups ---
  const groupCache = new Map();
  const groupsOf = names => {
    const k = names.join('\u0001');
    if (groupCache.has(k)) return groupCache.get(k);
    const idx = names.map(ci);
    const ids = new Int32Array(n);
    const byKey = new Map();
    const first = [];
    for (let i = 0; i < n; i++) {
      const row = rows[i];
      let gk = '';
      for (const x of idx) gk += (x < 0 ? '' : trimmed(row[x])) + '\u0001';
      let id = byKey.get(gk);
      if (id === undefined) { id = first.length; byKey.set(gk, id); first.push(i); }
      ids[i] = id;
    }
    const g = { ids, count: first.length, first };
    groupCache.set(k, g);
    return g;
  };
  const docRule = rules.find(r => r.kind === 'unique' && r.params?.scope === 'document');
  const docBy = docRule ? docRule.params.groupBy : null;

  const notes = [];     // facts to know that are counted in the file: never a finding, never blocking
  const rowChecks = []; // fn(row, i)
  const after = [];     // fn(): checks over the whole file
  const requiredCols = new Set(rules.filter(r => r.kind === 'required' && !r.params?.target).flatMap(r => r.columns));
  const ownRegexCols = new Set(rules.filter(r => r.kind === 'regex' && !r.params?.target).flatMap(r => r.columns));

  for (const rule of rules) {
    const p = rule.params || {};
    // org_gst: the GST statuses of the organisation the rule applies to (zohorules.json). A rule about GST on the lines
    // does not apply to an organisation not registered for GST, which has no tax fields (companygst.js). Applied when
    // the status is known (options.orgGstStatus); unknown: the rule applies as before.
    if (Array.isArray(rule.org_gst) && ctx.options.orgGstStatus && !rule.org_gst.includes(ctx.options.orgGstStatus)) {
      skip(rule, ctx.options.orgGstStatus === 'unregistered' ? 'The company is not registered for GST, so the Zoho Books organisation has no GST: this rule does not apply.'
        : 'The company is registered under the GST Composition scheme and charges no GST on its sales: this rule does not apply.');
      continue;
    }
    const colsOf = (rule.columns || []).filter(c => c !== '*');
    const present = colsOf.map(ci).filter(x => x >= 0);
    switch (rule.kind) {
      case 'required': {
        if (p.target) { skip(rule, p.target === 'mapping' ? 'About the Map Fields page; a required column missing from the file is reported under it.' : NOT_A_FILE_CHECK.organisation_setting); break; }
        for (const name of colsOf) {
          const x = ci(name);
          if (x < 0) { addFile(ruleById('GEN-REQUIRED-MAPPED') || rule, `missing:${name}`, 3, { note: `The column "${name}" is not in the file.` }); continue; }
          rowChecks.push((row, i) => { if (isBlank(row[x])) add(rule, i, x); });
        }
        break;
      }
      case 'enum': {
        if (p.target === 'file_extension') { if (file.fileName && !new RegExp(`\\.(${p.values.join('|')})$`, 'i').test(file.fileName)) addFile(rule); break; }
        let values = p.values;
        if (p.list) values = (listOf(p.list) || []).filter(e => !p.allowedStatuses || p.allowedStatuses.includes(e.status)).map(e => e[p.field]);
        if (!values) { skip(rule, 'The rule has no list of values.'); break; }
        const cs = p.caseSensitive !== false;
        const set = new Set(cs ? values : values.map(v => String(v).toLowerCase()));
        const emptyOk = p.allowEmpty !== false;
        for (const x of present) {
          rowChecks.push((row, i) => {
            const v = trimmed(row[x]);
            if (v === '') { if (!emptyOk && !set.has('')) add(rule, i, x); return; }
            if (!set.has(cs ? v : v.toLowerCase())) add(rule, i, x);
          });
        }
        break;
      }
      case 'regex': {
        const re = new RegExp(p.pattern);
        let targets = present;
        if (p.target === 'date_columns') targets = headers.map((h, x) => (DATE_RE.test(h) ? x : -1)).filter(x => x >= 0);
        else if (p.target === 'amount_columns') targets = headers.map((h, x) => (AMOUNT_COLUMNS.has(h) && !ownRegexCols.has(h) ? x : -1)).filter(x => x >= 0);
        else if (p.target === 'percentage_columns') targets = headers.map((h, x) => (PERCENT_RE.test(h) && !ownRegexCols.has(h) ? x : -1)).filter(x => x >= 0);
        else if (p.target === 'name_values') {
          // a name is compared as written: the test is on the raw value
          targets = headers.map((h, x) => (NAME_COLUMNS.has(h) ? x : -1)).filter(x => x >= 0);
          for (const x of targets) rowChecks.push((row, i) => { const v = row[x] ?? ''; if (v !== '' && !re.test(v)) add(rule, i, x); });
          break;
        } else if (p.target) { skip(rule, `Target "${p.target}" is not a column of the file.`); break; }
        for (const x of targets) {
          // an empty cell is the business of the "required" rule of that column, when there is one
          const emptyFails = !p.allowEmpty && !requiredCols.has(headers[x]);
          rowChecks.push((row, i) => {
            const v = trimmed(row[x]);
            if (v === '') { if (emptyFails && !re.test('')) add(rule, i, x); return; }
            if (!re.test(v)) { add(rule, i, x); return; }
            // p.calendar: a yyyy-mm-dd date must also be a real calendar day (2025-09-31 or 2026-02-29 is refused)
            if (p.calendar && /^\d{4}-\d{2}-\d{2}$/.test(v) && !realDate(v)) add(rule, i, x);
          });
        }
        break;
      }
      case 'maxLength': {
        if (p.concat) {
          const xs = p.concat.map(ci).filter(x => x >= 0);
          rowChecks.push((row, i) => { let len = 0; for (const x of xs) len += trimmed(row[x]).length; if (len > p.max) add(rule, i, xs[xs.length - 1]); });
        } else for (const x of present) rowChecks.push((row, i) => { const v = row[x]; if (v && v.length > p.max && trimmed(v).length > p.max) add(rule, i, x); });
        break;
      }
      case 'unique': {
        if (p.scope === 'file') {
          for (const x of present) {
            after.push(() => {
              const seen = new Map();
              for (let i = 0; i < n; i++) {
                let v = p.trim === false ? rows[i][x] ?? '' : trimmed(rows[i][x]);
                if (v === '') continue; // an empty name is the "required" rule's business
                if (p.caseSensitive === false) v = v.toLowerCase();
                if (seen.has(v)) add(rule, i, x); // Zoho imports the first and refuses the later one
                else seen.set(v, i);
              }
            });
          }
        } else if (p.scope === 'document') {
          const must = (p.headerColumnsMustMatch || []).map(ci).filter(x => x >= 0);
          after.push(() => {
            const g = groupsOf(p.groupBy);
            for (let i = 0; i < n; i++) {
              const f = g.first[g.ids[i]];
              if (f === i) continue;
              for (const x of must) if (trimmed(rows[i][x]) !== trimmed(rows[f][x])) { add(rule, i, x); break; }
            }
            if (p.warnWhenSameNumberForDifferentVendors && p.groupBy.length > 1) {
              const x = ci(p.groupBy[0]);
              const owner = new Map();
              for (let d = 0; d < g.count; d++) {
                const v = trimmed(rows[g.first[d]][x]);
                if (v === '') continue;
                if (owner.has(v)) add(rule, g.first[d], x, 'other_vendor', 1, { note: 'The same Bill Number is used by more than one vendor. Each is a separate bill. In the third test import such bills were all accepted: Zoho Books keeps bill numbers per vendor.' });
                else owner.set(v, d);
              }
            }
            if (p.acrossFiles) {
              // the journal files share one numbering in Zoho Books
              const seen = ctx.journalNumbers;
              const xs = p.groupBy.map(ci);
              const mine = new Set();
              for (let d = 0; d < g.count; d++) {
                const row = rows[g.first[d]];
                const numb = xs.map(x => (x < 0 ? '' : trimmed(row[x]))).join('');
                if (numb === '') continue;
                if (seen.has(numb) && seen.get(numb) !== key) add(rule, g.first[d], xs[xs.length - 1], 'other_file', tierOfRule(rule), { note: `The same journal number is also in the file ${moduleLabel(seen.get(numb))}.` });
                mine.add(numb);
              }
              for (const m of mine) if (!seen.has(m)) seen.set(m, key);
            }
          });
        } else if (p.scope === 'across_files') {
          const x = present[0];
          if (x === undefined) break;
          after.push(() => {
            for (const other of p.files.filter(f => f !== key)) {
              const names = ctx.namesLower[other];
              if (!names) continue;
              for (let i = 0; i < n; i++) { const v = lower(rows[i][x]); if (v && names.has(v)) add(rule, i, x); }
            }
          });
        } else skip(rule, `Scope "${p.scope}" is not known.`);
        break;
      }
      case 'reference': {
        if (!p.target) { skip(rule, 'A principle (names are matched exactly); applied by every reference rule.'); break; }
        const targets = Array.isArray(p.target) ? p.target : [p.target];
        const emptyOk = p.allowEmpty === true;
        if (targets.every(t => t.startsWith('zoho.'))) {
          // something that must exist in Zoho Books: known only when it is one of Zoho's own taxes, or in the list the user saved
          const known = new Set([...(p.orIn === 'lists.default_taxes' ? DEFAULT_TAXES : []), ...(ctx.options.zohoNames?.[targets[0].slice(5)] || [])]);
          // a TDS tax: Zoho creates none whose name is known, so every TDS Name written (the tool's suggestion from the
          // section in Tally, or a mapping) is listed with its section and rate, and the cause says exactly what to do
          const tds = targets[0] === 'zoho.tds_taxes' ? new Map() : null;
          const secX = tds ? ci('TDS Section Code') : -1, pctX = tds ? ci('TDS Percentage') : -1;
          // a TDS tax (TDS-011, TDS-002, TDS-024): the one list of tds.js knownTdsTaxes, by the date of the row (the
          // organisation's export when given, and Zoho's default taxes on the dates they are valid for). A name only chosen
          // in Mapping Studio stays "may be refused" (chosen, not checked); a tax the export marks Inactive too.
          const dateX = tds ? [ci('Bill Date'), ci('Invoice Date'), ci('Date')].find(k => k >= 0) ?? -1 : -1;
          const exportRows = tds && ctx.options.tdsExportGiven ? (ctx.options.zohoTdsTaxes || []) : null;
          const chosen = tds ? new Set((ctx.options.tdsChosen || []).map(s => String(s).trim())) : null;
          const tdsKnown = tds ? new Map() : null;
          const knownOn = date => {
            const d = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : (ctx.options.migrationDate || '');
            if (!tdsKnown.has(d)) tdsKnown.set(d, new Map(knownTdsTaxes(exportRows, d).map(t => [String(t.name).trim(), t])));
            return tdsKnown.get(d);
          };
          for (const x of present) {
            rowChecks.push((row, i) => {
              const v = trimmed(row[x]);
              if (v === '') return;
              if (tds) {
                const hit = knownOn(dateX >= 0 ? trimmed(row[dateX]) : '').get(v);
                if (hit) {
                  if (/^inactive$/i.test(String(hit.status || '').trim())) add(rule, i, x, 'inactive', 2, { note: `"${v}" is a TDS tax of your Zoho Books organisation, but its TDS export marks it Inactive. No import has shown whether Zoho Books takes an Inactive tax on a document (assumed: it may refuse the row).`, fixText: 'Make the tax Active in Zoho Books (Settings > Taxes & Compliance > Direct Taxes > Income TDS Rates), export the TDS taxes again and upload the export in the Import Wizard; or choose an active tax in Mapping Studio (TDS mapping).' });
                  return;
                }
                if (known.has(v)) return;
                if (chosen.has(v)) {
                  add(rule, i, x, 'chosen', 2, { note: `"${v}" was chosen in Mapping Studio (TDS mapping). A choice is not proof that Zoho Books has this tax: only Zoho's own TDS export shows that, so the row stays "may be refused" until the export is given.`, fixText: 'Export the TDS taxes from Zoho Books (Settings > Taxes & Compliance > Direct Taxes > Income TDS Rates > More > Export TDS Taxes) and upload the file in the Import Wizard, step "Set up Zoho Books". If the tax is not in Zoho Books yet, create it there first with exactly this name, rate and section.' });
                  return;
                }
              } else if (known.has(v)) return;
              if (tds) {
                if (!tds.has(v)) tds.set(v, { name: v, sections: new Set(), rates: new Set() });
                const t = tds.get(v);
                if (secX >= 0 && trimmed(row[secX])) t.sections.add(trimmed(row[secX]));
                if (pctX >= 0 && trimmed(row[pctX])) t.rates.add(trimmed(row[pctX]));
              }
              add(rule, i, x, 'unverified', Math.min(2, tierOfRule(rule)), { note: `"${headers[x]}" names something that must exist in Zoho Books with exactly this name. It is not one of the names Zoho creates itself, so it cannot be checked here.` });
            });
          }
          if (tds) {
            after.push(() => {
              const c = causes.get(`${rule.id}:unverified`);
              if (!c || !tds.size) return;
              // the section code written on the rows is told; when a row has none, the one the name stands for in the pick list
              // (defaults.js TDS_CHOICES)
              const choice = name => TDS_CHOICES.find(x => x.name.toLowerCase() === name.toLowerCase());
              c.tdsTaxes = [...tds.values()].sort((a, b) => a.name.localeCompare(b.name))
                .map(t => ({ name: t.name, section: [...t.sections].sort().join(', ') || (choice(t.name)?.sections || []).join(' or '),
                  rate: [...t.rates].sort((a, b) => Number(a) - Number(b)).join(', '), zohoCode: choice(t.name)?.code || null }));
              // a name Zoho Books has by default (from its start date) is never to be created again: the rows naming it are
              // dated before that date, so the tax may not be valid for them (TDS-011)
              const isDefault = t => String(t.rate || '').split(', ').some(rate => isDefaultTdsTax(t.name, rate, t.section));
              const own = c.tdsTaxes.filter(t => !isDefault(t)), dflt = c.tdsTaxes.filter(isDefault);
              const listed = c.tdsTaxes.map(tdsTaxWords).join('; ');
              const dfltWords = dflt.length ? ` ${dflt.map(tdsTaxWords).join('; ')}: ${dflt.length === 1 ? 'a tax' : 'taxes'} Zoho Books has by itself from ${DEFAULT_TDS_START}, and the rows naming ${dflt.length === 1 ? 'it' : 'them'} are dated before that: do not create ${dflt.length === 1 ? 'it' : 'them'} again; choose the tax valid on the date in Mapping Studio (TDS mapping), or check in Zoho Books that the tax takes these dates.` : '';
              c.note = `The TDS Name written on these rows must be a TDS tax of your Zoho Books organisation, with exactly this name. The TDS taxes of the organisation are not known to the tool yet, so it cannot check them. Names in this file: ${listed}.`;
              c.fixText = own.length ? `Create these TDS taxes in Zoho with these names, or upload Zoho's TDS export: ${own.map(tdsTaxWords).join('; ')}. Create them in Settings > Taxes & Compliance > Direct Taxes > Income TDS Rates > + New TDS Tax, with exactly the name, section and rate shown. Or export Zoho's TDS taxes there (More > Export TDS Taxes) and upload the file in the Import Wizard, step "Set up Zoho Books": the files then use Zoho's own names.${dfltWords}` : dfltWords.trim();
            });
          }
          break;
        }
        // A DOCUMENT of another file (an invoice or a bill a payment or a note is applied to), named by its number and,
        // with params.compositeWith { column, targetColumn }, by its party too: Zoho keeps bill numbers per vendor, so a
        // bill number alone can belong to several vendors. The document's own outcome decides: a payment against a bill
        // Zoho will refuse is a cascade, not a fresh error. When the target file is not part of the check, the rule
        // says so ("cannot be checked") instead of passing quietly.
        if (p.compositeWith || p.document) {
          const [tf, ...tc] = targets[0].split('.');
          const tcol = tc.join('.'), partyCol = p.compositeWith?.targetColumn || null;
          const wx = p.compositeWith ? ci(p.compositeWith.column) : -1;
          for (const x of present) {
            let index = null;
            rowChecks.push((row, i) => {
              const v = trimmed(row[x]);
              if (v === '') { if (!emptyOk && !requiredCols.has(headers[x])) add(rule, i, x); return; }
              const src = ctx.docs[tf];
              if (!src) { add(rule, i, x, 'unverified', Math.min(2, tierOfRule(rule)), { note: `"${headers[x]}" names a document of the ${moduleLabel(tf)} file, and that file is not part of this check, so it cannot be checked here. Zoho refuses the row when the document is not in Zoho Books.` }); return; }
              index ||= src.index(tcol, partyCol);
              const parties = index.get(v);
              if (!parties) { add(rule, i, x); return; }
              const party = wx >= 0 ? lower(row[wx]) : null;
              const tier = party === null || !partyCol ? Math.min(...parties.values()) : parties.get(party);
              if (tier === undefined) { add(rule, i, x, 'other_party', tierOfRule(rule), { note: `The number "${v}" is in the ${moduleLabel(tf)} file, but for another ${partyCol} than the "${headers[wx]}" of this row. ${rule.message}` }); return; }
              if (tier >= 3) add(rule, i, x, 'cascade', tierOfRule(rule), { target: tf });
              else if (tier === 2) add(rule, i, x, 'cascade_may', Math.min(2, tierOfRule(rule)), { target: tf });
            });
          }
          break;
        }
        const fileTargets = targets.map(t => { const [f, ...c] = t.split('.'); return { file: f, column: c.join('.') }; });
        const useDefaults = p.orIn === 'lists.default_accounts' || p.orIn === 'zoho.accounts';
        const orIn = Array.isArray(p.orIn) ? new Set(p.orIn) : null;
        const sideCol = p.sideRule ? ci('Account') : -1;
        for (const x of present) {
          const earlier = p.mustComeEarlierInFile ? new Set() : null;
          const selfX = p.mustComeEarlierInFile ? ci(fileTargets[0].column) : -1;
          rowChecks.push((row, i) => {
            const v = trimmed(row[x]);
            const done = () => { if (earlier && selfX >= 0) earlier.add(trimmed(row[selfX])); };
            if (v === '') { if (!emptyOk && !requiredCols.has(headers[x])) add(rule, i, x); return done(); }
            if (orIn?.has(v)) return done();
            if (earlier) { // a parent account: an earlier row of this file, or one of Zoho's own accounts
              if (!earlier.has(v) && ctx.defaultAccounts.get(v.toLowerCase())?.exists_by_default !== 'yes') add(rule, i, x);
              return done();
            }
            let wanted = fileTargets;
            if (p.sideRule && sideCol >= 0) { const side = p.sideRule[trimmed(row[sideCol])]; if (side) wanted = fileTargets.filter(t => t.file === side); }
            let best = null, checked = false, whereFail = false;
            for (const t of wanted) {
              const index = ctx.names[t.file];
              if (!index) continue; // that file is not part of this check
              checked = true;
              const hit = index.get(v);
              if (!hit) continue;
              if (p.where && !Object.entries(p.where).every(([c, allowed]) => allowed.includes(hit.values?.[c] ?? ''))) { whereFail = true; continue; }
              if (!best || hit.tier < best.tier) best = { ...hit, file: t.file };
            }
            if (useDefaults) {
              const d = ctx.defaultAccounts.get(v.toLowerCase());
              if (d && d.exists_by_default === 'yes' && !(best && best.tier < 2)) {
                // one of Zoho's own accounts; a rule that needs a kind of account (an income account on an invoice
                // line) checks its type too (audit item 2)
                const typeWanted = p.where?.['Account Type'];
                if (typeWanted && d.account_type && !typeWanted.includes(d.account_type)) add(rule, i, x, 'where');
                // Zoho usually has this account, but its own export (given after the import) does not list it
                else if (!best && arrivedAccounts && !arrivedAccounts.has(accountNameKey(v)) && !p.typeOnly) add(rule, i, x, 'not_in_zoho', 3, { target: 'accounts', note: 'It is one of the accounts Zoho Books usually creates itself, but this organisation does not have it.' });
                return undefined;
              }
              if (d && d.exists_by_default === 'unknown' && !best) { if (!p.typeOnly) add(rule, i, x, 'unverified', 2, { note: 'The account is not in the Chart of Accounts file. Zoho may create an account of this name itself, but that is not confirmed.' }); return undefined; }
            }
            if (!checked && !useDefaults) return undefined;
            // typeOnly: the rule is about the kind of the account named, not whether it exists (another rule says that)
            if (p.typeOnly) { if (!best && whereFail) add(rule, i, x, 'where'); return undefined; }
            if (!best) { add(rule, i, x, whereFail ? 'where' : ''); return undefined; }
            // the name is the master's only once the spaces and line breaks at its ends are left out: the two files
            // do not write it the same way (the tool never does this: the file was changed by hand)
            if (SAME_AS_MASTER && best.raw != null && (row[x] ?? '') !== best.raw) add(SAME_AS_MASTER, i, x, '', tierOfRule(SAME_AS_MASTER), { target: best.file });
            // the name is in the master file, but Zoho's own export of that master does not have it: Zoho did not create it
            if (best.notInZoho) add(rule, i, x, 'not_in_zoho', 3, { target: best.file });
            else if (best.tier >= 3) add(rule, i, x, 'cascade', tierOfRule(rule), { target: best.file });
            else if (best.tier === 2) add(rule, i, x, 'cascade_may', Math.min(2, tierOfRule(rule)), { target: best.file });
            else if (best.watch) add(rule, i, x, 'watch', 1, { target: best.file });
            return undefined;
          });
        }
        break;
      }
      case 'conditional': {
        const check = p.check || p.then?.check;
        if (p.when && p.then) {
          const when = cond(p.when);
          if (!when) { skip(rule, 'The condition of the rule is not about a column.'); break; }
          if (p.then.check === 'flag') { rowChecks.push((row, i) => { if (when(row)) add(rule, i, ci(p.when.column)); }); break; }
          if (p.then.check === 'at_least_one') {
            const any = p.then.anyOf.map(cond);
            rowChecks.push((row, i) => { if (when(row) && !any.some(f => f(row))) add(rule, i, -1); });
            break;
          }
          const then = cond(p.then);
          if (!then) { skip(rule, 'The rule is not about a column.'); break; }
          const tx = ci(p.then.column);
          rowChecks.push((row, i) => { if (when(row) && !then(row)) add(rule, i, tx); });
          break;
        }
        // a dated row on or before the Opening Balance Date Zoho Books was seen to show (Import Wizard, step "Save the
        // Migration Date"): it counts in the opening balances only after Sync. Without that date the rule cannot be checked.
        if (check === 'date_on_or_before_setting' && /^\d{4}-\d{2}-\d{2}$/.test(String(ctx.options.zohoOpeningDate || ''))) {
          const limit = ctx.options.zohoOpeningDate;
          for (const x of present) rowChecks.push((row, i) => { const v = trimmed(row[x]); if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v <= limit) add(rule, i, x, '', 1, { note: `Dated ${v}, on or before the Opening Balance Date ${limit} that Zoho Books shows. Press Sync on Settings > Setup & Configurations > Opening Balances after the import.` }); });
          break;
        }
        // A fact to know that CAN be counted in the file (params.note): the rule gives a note with the number of
        // documents it is about. A note is never a finding: it is outside the refused / may be refused / warning
        // counts and the percentages, and it blocks nothing. note: { column (must be filled), accountColumn + accounts
        // (the row's account must be one of them, with its amount in the column named for it) }.
        if (check === 'information' && p.note) {
          const nx = ci(p.note.column), ax = p.note.accountColumn ? ci(p.note.accountColumn) : -1;
          // accounts: { account name: the amount column that must be filled } (a customer credited, a vendor debited)
          const wanted = new Map(Object.entries(p.note.accounts || {}).map(([a, side]) => [String(a).toLowerCase(), ci(side)]));
          if (nx < 0 || (p.note.accountColumn && ax < 0)) { skip(rule, NOT_A_FILE_CHECK.information); break; }
          const hit = [];
          rowChecks.push((row, i) => {
            if (isBlank(row[nx])) return;
            if (ax >= 0) { const sx = wanted.get(lower(row[ax])); if (sx === undefined || sx < 0 || isBlank(row[sx])) return; }
            hit.push(i);
          });
          after.push(() => {
            if (!hit.length) return;
            const g = docBy ? groupsOf(docBy) : null;
            const documents = g ? new Set(hit.map(i => g.ids[i])).size : hit.length;
            notes.push({ rule: rule.id, rows: hit.length, journals: documents, documents, blocking: false,
              words: `${documents} ${documents === 1 ? (p.note.one || 'document') : (p.note.many || 'documents')} ${p.note.words || rule.message}`,
              fix: rule.fix || null, sourceUrl: rule.source_url || null, place: p.note.place || null });
          });
          break;
        }
        if (NOT_A_FILE_CHECK[check]) { skip(rule, NOT_A_FILE_CHECK[check]); break; }
        switch (check) {
          case 'flag': skip(rule, NOT_A_FILE_CHECK.information); break;
          case 'all_or_none': case 'both_or_neither': {
            const xs = p.columns.map(ci);
            rowChecks.push((row, i) => {
              let filled = 0;
              for (const x of xs) if (x >= 0 && !isBlank(row[x])) filled++;
              if (filled !== 0 && filled !== xs.length) add(rule, i, xs.find(x => x < 0 || isBlank(row[x])) ?? -1);
            });
            break;
          }
          case 'at_least_one': { const any = p.anyOf.map(cond); rowChecks.push((row, i) => { if (!any.some(f => f(row))) add(rule, i, -1); }); break; }
          case 'at_most_one': {
            const xs = p.columns.map(ci).filter(x => x >= 0);
            rowChecks.push((row, i) => { let filled = 0, last = -1; for (const x of xs) if (!isBlank(row[x])) { filled++; last = x; } if (filled > 1) add(rule, i, last); });
            break;
          }
          case 'exactly_one_positive': {
            const xs = p.columns.map(ci).filter(x => x >= 0);
            rowChecks.push((row, i) => { let pos = 0; for (const x of xs) { const v = toPaise(row[x]); if (v > 0) pos++; } if (pos !== 1) add(rule, i, xs[0] ?? -1); });
            break;
          }
          case 'group_sum_equal': {
            const l = ci(p.left), r = ci(p.right);
            after.push(() => {
              const g = groupsOf(p.groupBy);
              const sums = new Float64Array(g.count);
              for (let i = 0; i < n; i++) { const a = toPaise(l < 0 ? '' : rows[i][l]), b = toPaise(r < 0 ? '' : rows[i][r]); sums[g.ids[i]] += (Number.isNaN(a) ? 0 : a) - (Number.isNaN(b) ? 0 : b); }
              for (let d = 0; d < g.count; d++) if (Math.abs(sums[d]) > (p.tolerance || 0) * 100) add(rule, g.first[d], l);
            });
            break;
          }
          case 'group_min_rows': {
            after.push(() => {
              const g = groupsOf(p.groupBy);
              const counts = new Int32Array(g.count);
              for (let i = 0; i < n; i++) counts[g.ids[i]]++;
              for (let d = 0; d < g.count; d++) if (counts[d] < p.min) add(rule, g.first[d], -1);
            });
            break;
          }
          case 'document_sum_min': {
            const [a, b] = String(p.sum).split('*').map(s => ci(s.trim()));
            after.push(() => {
              const g = groupsOf(p.groupBy);
              const sums = new Float64Array(g.count);
              for (let i = 0; i < n; i++) { const r = num(a < 0 ? '' : rows[i][a]); const q = b === undefined || b < 0 || isBlank(rows[i][b]) ? 1 : num(rows[i][b]); if (!Number.isNaN(r) && !Number.isNaN(q)) sums[g.ids[i]] += r * q; }
              for (let d = 0; d < g.count; d++) if (sums[d] < p.min - 0.005) add(rule, g.first[d], a);
            });
            break;
          }
          case 'intra_inter_state': {
            const sx = ci(p.state_column), ox = p.other_state_column ? ci(p.other_state_column) : -1;
            const home = p.other_state_column ? null : ctx.options.homeState;
            const taxCol = ci(colsOf[0]), typeCol = ci(colsOf[1]), gt = ci('GST Treatment');
            if (taxCol < 0 || sx < 0 || (!p.other_state_column && !home)) { skip(rule, p.other_state_column ? 'The file has no tax or state column.' : "The organisation's own state is not known (no GSTIN on the migration)."); break; }
            rowChecks.push((row, i) => {
              const tax = trimmed(row[taxCol]);
              const m = /^(I?GST)\d/.exec(tax); // only Zoho's own tax names say which kind they are
              if (!m) return;
              let a = trimmed(row[sx]);
              const b = p.other_state_column ? (ox < 0 ? '' : trimmed(row[ox])) : home;
              const treatment = gt < 0 ? '' : trimmed(row[gt]);
              // Zoho reads a supply with no Source of Supply from an unregistered vendor as inside the state (test 2: 11 bills)
              if (!a && b && p.emptyStateMeans === 'same_for_unregistered' && (treatment === 'business_none' || treatment === 'consumer' || treatment === '')) a = b;
              if (!a || !b) return;
              const inter = a !== b || treatment === 'overseas' || treatment === 'business_sez';
              const want = inter ? p.inter : p.intra;
              if (m[1] !== want.taxPrefix) add(rule, i, taxCol);
              else if (typeCol >= 0 && trimmed(row[typeCol]) !== '' && trimmed(row[typeCol]) !== want.type) add(rule, i, typeCol);
            });
            break;
          }
          // an HSN/SAC of at least params.minDigits digits, only while the organisation says the field is on in Zoho Books
          // (Import Wizard answer, options.hsnEnabled); skipped when it is off or not known
          // one of Zoho's taxes named for its rate (GST18, IGST5) with another percentage on the row (GST-001)
          case 'tax_name_rate_matches': {
            const nx = ci(p.name_column), rx = ci(p.rate_column);
            if (nx < 0 || rx < 0) { skip(rule, 'The file has no tax name or percentage column.'); break; }
            rowChecks.push((row, i) => {
              const m = /^I?GST(\d+(?:\.\d+)?)$/i.exec(trimmed(row[nx]));
              const r = trimmed(row[rx]).replace(/%$/, '');
              if (!m || r === '' || Number.isNaN(Number(r))) return;
              if (Math.round(Number(m[1]) * 10000) !== Math.round(Number(r) * 10000)) add(rule, i, rx);
            });
            break;
          }
          // a document the tool itself knows will come to another total in Zoho Books than in Tally (options.docTotalDiffers:
          // { <file key>: [{ number, party, difference }] }, from the generation): it imports, with a wrong amount, so it is said
          case 'document_listed_in_option': {
            const listed = ctx.options[p.option]?.[key] || [];
            if (!listed.length) { skip(rule, p.noneWords || 'No document of this file is known to come to another total than in Tally.'); break; }
            const nx = ci(p.numberColumn), px = ci(p.partyColumn);
            const k = (a, b) => `${trimmed(a)}${lower(b)}`;
            const want = new Map(listed.map(d => [k(d.number, d.party), d]));
            after.push(() => {
              const seen = new Set();
              for (let i = 0; i < n; i++) {
                const id = k(nx < 0 ? '' : rows[i][nx], px < 0 ? '' : rows[i][px]);
                if (!want.has(id)) continue;
                const first = !seen.has(id); seen.add(id);
                const c = cause(rule, '', tierOfRule(rule), { docs: [] });
                c.rows.push(i); c.cols.push(nx);
                if (first) { c.docs.push(want.get(id)); c.note = `${c.docs.length === 1 ? 'It is' : 'They are'}: ${c.docs.slice(0, 20).map(d => `${d.number} (${Number(d.difference) > 0 ? '+' : ''}${d.difference})`).join(', ')}${c.docs.length > 20 ? ', and more' : ''}.`; }
              }
            });
            break;
          }
          case 'required_when_setting': {
            if (ctx.options[p.setting] !== true) { skip(rule, 'The HSN/SAC field is switched off in Zoho Books, or no Import Wizard answer was given.'); break; }
            const min = ctx.options.hsnMinDigits || p.minDigits || 6;
            for (const x of present) rowChecks.push((row, i) => { const v = trimmed(row[x]); if (!/^(\d{4}|\d{6}|\d{8})$/.test(v) || v.length < min) add(rule, i, x); });
            break;
          }
          // a contacts file with opening balances while the Migration Date step of the Import Wizard is not ticked
          case 'opening_date_confirmed': {
            if (ctx.options.openingDateConfirmed !== false) { skip(rule, 'The date Zoho Books shows was checked in the Import Wizard and is the Migration Date, or the migration has no wizard answer yet.'); break; }
            // one finding per row WITH a balance (not the whole file): a step to do first, never a refused row
            const seen = ctx.options.zohoOpeningDate, want = ctx.options.migrationDate;
            const note = seen ? `Zoho Books was seen to show the Opening Balance Date ${seen}; the Migration Date is ${want || 'another date'}.` : `The Migration Date${want ? ` ${want}` : ''} is not checked in Zoho Books yet (Import Wizard, step "Save the Migration Date").`;
            for (const x of present) rowChecks.push((row, i) => { if (!isBlank(row[x])) add(rule, i, x, '', 1, { note }); });
            break;
          }
          case 'tds_name_not_zoho_default': {
            // a TDS Name that is the name of a tax Zoho has (its export, or the taxes a new organisation has) must be that tax: the
            // same rate and the same section; with another rate or section two taxes would share one name
            const nx = ci('TDS Name'), rx = ci('TDS Percentage'), sx2 = ci('TDS Section Code');
            if (nx < 0) break;
            const known = new Map();
            for (const t of [...(ctx.options.zohoTdsTaxes || []), ...(RULES.lists.tds?.zoho_default_taxes?.taxes || [])]) {
              const k = String(t.name).trim().toLowerCase();
              if (!known.has(k)) known.set(k, []);
              known.get(k).push({ rate: Number(String(t.rate ?? '').replace('%', '')), key: sectionKeyOf(t.section) });
            }
            rowChecks.push((row, i) => {
              const name = lower(row[nx]);
              const list = name ? known.get(name) : null;
              if (!list) return;
              const rate = rx < 0 ? NaN : num(row[rx]), sec = sx2 < 0 ? '' : sectionKeyOf(trimmed(row[sx2]));
              if (!list.some(t => (Number.isNaN(rate) || t.rate === rate) && (!sec || !t.key || t.key === sec))) add(rule, i, nx);
            });
            break;
          }
          case 'tds_section_code_valid': {
            // TDS-018: a section of the 1961 Act (194J, 194-J is not: the files write 194J) or a code of Zoho's 2025 list;
            // neither: will be refused. The other act's form for the document's date: may be refused (not tried).
            const sx3 = ci('TDS Section Code'), dx = [ci('Bill Date'), ci('Invoice Date'), ci('Date')].find(k => k >= 0) ?? -1;
            if (sx3 < 0) break;
            const codes = new Set((RULES.lists.tds?.section_codes_income_tax_act_2025?.codes || []).map(c => String(c.code).toLowerCase()));
            const cutover = RULES.lists.tds?.act_cutover?.date || '2026-04-01';
            rowChecks.push((row, i) => {
              const v = trimmed(row[sx3]);
              if (!v) return;
              const isOld = /^19[2-6][A-Z]{0,3}$/.test(v) && tdsSectionOf(v) === v, isNew = codes.has(v.toLowerCase());
              if (!isOld && !isNew) { add(rule, i, sx3, 'unknown', 3, { note: `"${v}" is neither a section of the Income Tax Act, 1961 nor a code of Zoho's list.` }); return; }
              const d = dx >= 0 ? trimmed(row[dx]).slice(0, 10) : '';
              if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
              if (isOld && !isNew && d >= cutover) add(rule, i, sx3, 'act', 2, { note: `Section ${v} is the form of the Income Tax Act, 1961, on a document dated ${d} (the Income Tax Act, 2025 applies from ${cutover}).` });
              else if (isNew && !isOld && d < cutover) add(rule, i, sx3, 'act', 2, { note: `Code ${v} is the form of the Income Tax Act, 2025, on a document dated ${d} (before ${cutover}).` });
            });
            break;
          }
          case 'gstin_prefix_matches_state': {
            const gx = ci(colsOf[0]), sx = ci(p.state_column);
            if (gx < 0 || sx < 0) break;
            rowChecks.push((row, i) => { const g = trimmed(row[gx]), s = trimmed(row[sx]); if (g && s && PREFIX_BY_STATE.has(s) && PREFIX_BY_STATE.get(s) !== g.slice(0, 2)) add(rule, i, sx); });
            break;
          }
          case 'equals_setting': {
            const home = ctx.options.homeState;
            if (!home || !present.length) { skip(rule, "The organisation's own state is not known (no GSTIN on the migration)."); break; }
            rowChecks.push((row, i) => { const v = trimmed(row[present[0]]); if (v && v !== home) add(rule, i, present[0]); });
            break;
          }
          case 'reference_or_empty':
            for (const x of present) rowChecks.push((row, i) => { if (!isBlank(row[x])) add(rule, i, x); });
            break;
          case 'file_size_max_mb': {
            const max = p.max ?? RULES.general.file_format.max_file_mb?.[key] ?? mod.max_file_mb;
            if (rule.id === 'GEN-FILE-SIZE' && rules.some(r => r.id !== rule.id && r.params?.check === 'file_size_max_mb')) break; // the module has its own limit
            if (max && file.bytes > max * 1024 * 1024) addFile(rule, '', tierOfRule(rule), { note: `The file is ${(file.bytes / 1048576).toFixed(1)} MB; Zoho accepts ${max} MB for this module.` });
            break;
          }
          // a record of a master file that Zoho's own export, taken after the import, does not have
          case 'arrived_in_zoho': {
            if (!['accounts', 'customers', 'vendors', 'items'].includes(key)) break;
            if (!arrived) { skip(rule, "Checked only when Zoho's own export of this file, taken after the import, is given in the Import Wizard."); break; }
            if (idCol < 0) break;
            const seen = new Set();
            rowChecks.push((row, i) => { const k = nameKeyOf(row[idCol] ?? ''); if (!k || seen.has(k)) return; seen.add(k); if (!arrived.has(k)) add(rule, i, idCol); });
            break;
          }
          // a row on which every condition of params.all holds (column, op, value as in params.when) is shown with the
          // rule's tier: for Zoho behaviour no import has shown yet (evidence 'assumed': "may be refused")
          case 'all_of': {
            const all = (p.all || []).map(cond);
            if (!all.length || all.some(f => !f)) { skip(rule, 'The conditions of the rule are not about columns of this file.'); break; }
            if ((p.all || []).some(c => ci(c.column) < 0 && !['empty', 'notIn'].includes(c.op))) { skip(rule, 'A column the rule needs is not in this file.'); break; }
            const fx = ci(p.flagColumn || p.all[0].column);
            rowChecks.push((row, i) => { if (all.every(f => f(row))) add(rule, i, fx); });
            break;
          }
          // round 1: a journal line naming a contact whose Currency Code (Customers or Vendors file) is not the journal's
          // Currency (empty on either side is the base currency, INR)
          // round 2: a journal line whose Account is a Chart of Accounts row with an Account Type in params.types
          case 'account_type_in': {
            const ax = ci(p.accountColumn || 'Account');
            if (ax < 0) { skip(rule, 'The file has no Account column.'); break; }
            const types = new Set(p.types || []);
            rowChecks.push((row, i) => {
              const hit = ctx.names.accounts?.get(trimmed(row[ax]));
              if (hit && types.has(String(hit.values?.['Account Type'] || '').trim())) add(rule, i, ax);
            });
            break;
          }
          case 'contact_currency_matches': {
            const cx = ci(p.contactColumn || 'Contact Name'), kx = ci(p.currencyColumn || 'Currency'), ax = ci('Account');
            if (cx < 0) { skip(rule, 'The file has no contact column.'); break; }
            const base = String(p.baseCurrency || 'INR');
            rowChecks.push((row, i) => {
              const contact = trimmed(row[cx]);
              if (!contact) return;
              const side = p.sideRule && ax >= 0 ? p.sideRule[trimmed(row[ax])] : null;
              let hit = null;
              for (const f of side ? [side] : (p.targets || ['customers', 'vendors'])) { const h = ctx.names[f]?.get(contact); if (h) { hit = h; break; } }
              if (!hit) return;
              const contactCurrency = String(hit.values?.['Currency Code'] || '').trim() || base;
              const rowCurrency = (kx >= 0 ? trimmed(row[kx]) : '') || base;
              if (contactCurrency !== rowCurrency) add(rule, i, cx);
            });
            break;
          }
          case 'reference_written_as_master': break; // applied where a reference rule finds the name (kind 'reference')
          case 'column_count_max': if (headers.length > p.max) addFile(rule); break;
          case 'every_row_has_as_many_fields_as_headings': rowChecks.push((row, i) => { if (row.length !== headers.length) add(rule, i, -1); }); break;
          default: skip(rule, `The check "${check}" is not one this engine knows.`);
        }
        break;
      }
      case 'forbidden': {
        if (p.target === 'headings') {
          if (p.pattern) { const re = new RegExp(p.pattern); if (file.headers.some(h => re.test(String(h ?? '')))) addFile(rule); break; }
          if (p.unlessEveryRowFilledWithExactTotal) {
            // "Total": present and empty is read as 0 and compared with Zoho's own total (confirmed). The other total
            // columns are not needed either; whether Zoho minds them is not known.
            const tx = ci('Total');
            if (tx >= 0) rowChecks.push((row, i) => { if (isBlank(row[tx])) add(rule, i, tx); });
            const others = colsOf.filter(c => c !== 'Total' && ci(c) >= 0);
            if (others.length) addFile(rule, 'other_totals', 1, { note: `The file has the column${others.length > 1 ? 's' : ''} ${others.join(', ')}. Zoho works these out itself; leave them out.` });
            if (tx >= 0) after.push(() => { if (rows.some(r => !isBlank(r[tx]))) addFile(rule, 'total_filled', 1, { note: 'The Total column is filled on some rows. Zoho refuses the bill unless it equals the total Zoho works out itself, to the paisa.' }); });
            break;
          }
          if (colsOf.some(c => ci(c) >= 0)) addFile(rule);
          break;
        }
        if (p.target === 'values' || p.target === 'name_values') {
          const re = new RegExp(p.pattern);
          const xs = p.target === 'values' ? headers.map((h, x) => x) : headers.map((h, x) => (NAME_COLUMNS.has(h) ? x : -1)).filter(x => x >= 0);
          // endsAllowed: { modules, columns, lineBreaks? }: in these columns of these files, spaces and line breaks at
          // the START or END of the value do not count, nor (lineBreaks) a line break inside it: Zoho Books accepted
          // such contact names and keeps them exactly as written (the rule about outer spaces says so as a warning).
          // Any other hidden character still counts.
          const ends = p.endsAllowed && (p.endsAllowed.modules || []).includes(key) ? new Set((p.endsAllowed.columns || []).map(ci).filter(x => x >= 0)) : null;
          const allowed = v => { const t = v.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, ''); return p.endsAllowed?.lineBreaks ? t.replace(/\r\n|\r|\n/g, ' ') : t; };
          rowChecks.push((row, i) => { for (const x of xs) { const v = row[x]; if (v && re.test(ends?.has(x) ? allowed(v) : v)) { add(rule, i, x); break; } } });
          break;
        }
        if (p.unlessExistsIn) { for (const x of present) rowChecks.push((row, i) => { if (!isBlank(row[x])) add(rule, i, x); }); break; }
        if (p.mustBeEmpty) {
          const when = p.when ? cond(p.when) : () => true;
          if (!when) { skip(rule, 'About another screen of Zoho Books, not this file.'); break; }
          const xs = p.mustBeEmpty.map(ci).filter(x => x >= 0);
          rowChecks.push((row, i) => { if (!when(row)) return; for (const x of xs) if (!isBlank(row[x])) { add(rule, i, x); break; } });
          break;
        }
        if (p.when?.check === 'group_contains') {
          const x = present[0], ax = ci(p.when.column);
          if (x === undefined || ax < 0) break;
          const bad = new Set(p.values), marks = new Set(p.when.values);
          after.push(() => {
            const g = groupsOf(p.when.groupBy);
            const has = new Uint8Array(g.count);
            for (let i = 0; i < n; i++) if (marks.has(trimmed(rows[i][ax]))) has[g.ids[i]] = 1;
            for (let i = 0; i < n; i++) if (has[g.ids[i]] && bad.has(trimmed(rows[i][x]))) add(rule, i, x);
          });
          break;
        }
        let values = p.values;
        let entries = null;
        if (p.list) {
          // Zoho's own accounts: the organisation's own export when the accountant gave it (ctx.options.zohoAccounts)
          const list = p.list === 'lists.default_accounts' && ctx.options.zohoAccounts ? [...ctx.defaultAccounts.values()] : listOf(p.list) || [];
          entries = list.filter(e => !p.where || Object.entries(p.where).every(([k, v]) => e[k] === v));
          values = entries.map(e => e[p.field]);
        }
        if (!values) { skip(rule, 'The rule has no list of values.'); break; }
        const cs = p.caseSensitive !== false && !p.list;
        const set = new Map(values.map((v, j) => [cs ? v : String(v).toLowerCase(), entries?.[j] || null]));
        for (const x of present) {
          rowChecks.push((row, i) => {
            const v = cs ? trimmed(row[x]) : lower(row[x]);
            if (v === '' || !set.has(v)) return;
            // an entry of a list carries its own evidence: an account Zoho is only SAID to create may not be there
            const e = set.get(v);
            if (e && evidenceLevel(e.evidence) !== 'confirmed' && tierOfRule(rule) === 3) add(rule, i, x, 'documented', 2, { note: "Zoho's help pages say Zoho creates an account of this name itself. It was not in our test import, so it is not confirmed." });
            else add(rule, i, x);
          });
        }
        break;
      }
      default: skip(rule, `The kind "${rule.kind}" is not one this engine knows.`);
    }
  }

  // --- the one pass over the rows ---
  for (let i = 0; i < n; i++) { const row = rows[i]; for (let k = 0; k < rowChecks.length; k++) rowChecks[k](row, i); }
  for (const f of after) f();

  // --- what each row comes to ---
  const status = new Uint8Array(n); // 0 fine, 1 warning, 2 may be refused, 3 will be refused
  let fileTier = 0;
  for (const c of causes.values()) {
    if (c.whole && c.tier >= 2) fileTier = Math.max(fileTier, c.tier);
    for (const i of c.rows) if (status[i] < c.tier) status[i] = c.tier;
  }
  const watch = new Uint8Array(n);
  for (const c of causes.values()) if (c.rule.params?.watchList || c.variant === 'watch') for (const i of c.rows) watch[i] = 1;
  // a document is refused as a whole
  const doc = docBy ? groupsOf(docBy) : null;
  const docStatus = doc ? new Uint8Array(doc.count) : status;
  if (doc) {
    for (let i = 0; i < n; i++) { const d = doc.ids[i]; if (status[i] >= 2 && docStatus[d] < status[i]) docStatus[d] = status[i]; }
    for (let i = 0; i < n; i++) { const d = doc.ids[i]; if (docStatus[d] >= 2 && status[i] < docStatus[d]) status[i] = docStatus[d]; }
    for (let d = 0; d < doc.count; d++) if (docStatus[d] < 2) docStatus[d] = 0;
  }
  if (fileTier) { for (let i = 0; i < n; i++) if (status[i] < fileTier) status[i] = fileTier; if (doc) for (let d = 0; d < doc.count; d++) if (docStatus[d] < fileTier) docStatus[d] = fileTier; }

  const count = (arr, t) => { let c = 0; for (let i = 0; i < arr.length; i++) if (arr[i] === t) c++; return c; };
  const rowsWill = count(status, 3), rowsMay = count(status, 2), rowsWarn = count(status, 1);
  const docs = doc ? doc.count : n;
  const docsWill = doc ? count(docStatus, 3) : rowsWill, docsMay = doc ? count(docStatus, 2) : rowsMay;

  // --- the index of names this file will create in Zoho Books ---
  if (idCol >= 0 && ['accounts', 'customers', 'vendors', 'items'].includes(key)) {
    const index = new Map(), low = new Set();
    const typeCol = ci('Item Type'), accountTypeCol = ci('Account Type'), currencyCol = ['customers', 'vendors'].includes(key) ? ci('Currency Code') : -1;
    for (let i = 0; i < n; i++) {
      const name = trimmed(rows[i][idCol]);
      if (!name) continue;
      low.add(name.toLowerCase());
      const tier = status[i] >= 2 ? status[i] : 0;
      const had = index.get(name);
      const values = typeCol >= 0 || accountTypeCol >= 0 || currencyCol >= 0
        ? { ...(typeCol >= 0 ? { 'Item Type': trimmed(rows[i][typeCol]) } : {}), ...(accountTypeCol >= 0 ? { 'Account Type': trimmed(rows[i][accountTypeCol]) } : {}),
          ...(currencyCol >= 0 ? { 'Currency Code': trimmed(rows[i][currencyCol]) } : {}) } : null;
      if (!had || tier < had.tier) index.set(name, { tier, watch: !!watch[i], row: i, values, raw: rows[i][idCol] ?? '', notInZoho: arrived ? !arrived.has(nameKeyOf(name)) : false });
    }
    ctx.names[key] = index; ctx.namesLower[key] = low;
  }

  // --- the documents this file will create in Zoho Books (invoices, bills): for the rules of a later file that name
  // one. index(column, partyColumn): Map of the trimmed number -> Map of the party (lower case, '' without a party
  // column) -> the outcome of that document (0 fine, 2 may be refused, 3 will be refused; the best when several).
  if (doc) {
    const made = new Map();
    ctx.docs[key] = { index(column, partyColumn) {
      const k = `${column}${partyColumn || ''}`;
      if (made.has(k)) return made.get(k);
      const nx = ci(column), px = partyColumn ? ci(partyColumn) : -1;
      const index = new Map();
      if (nx >= 0) for (let i = 0; i < n; i++) {
        const number = trimmed(rows[i][nx]);
        if (!number) continue;
        const party = px >= 0 ? lower(rows[i][px]) : '';
        const tier = docStatus[doc.ids[i]] >= 2 ? docStatus[doc.ids[i]] : 0;
        if (!index.has(number)) index.set(number, new Map());
        const m = index.get(number);
        if (!m.has(party) || tier < m.get(party)) m.set(party, tier);
      }
      made.set(k, index);
      return index;
    } };
  }

  const pct = (a, b) => (b ? Math.floor((a / b) * 1000) / 10 : 100);
  const list = [...causes.values()].map(c => {
    const documents = doc ? new Set(c.rows.map(i => doc.ids[i])).size : c.rows.length;
    const lvl = ['documented', 'unverified', 'chosen', 'inactive'].includes(c.variant) ? 'assumed' : evidenceLevel(c.rule.evidence);
    return {
      id: c.id, ruleId: c.rule.id, variant: c.variant, tier: TIER_NAME[c.tier], tierLabel: TIER_LABEL[TIER_NAME[c.tier]],
      severity: c.rule.severity, evidence: c.rule.evidence, evidenceLevel: lvl, evidenceLabel: EVIDENCE_LABEL[lvl],
      columns: (c.rule.columns || []).filter(x => x !== '*'),
      rows: c.whole ? n : new Set(c.rows).size, documents: c.whole ? docs : documents, wholeFile: c.whole,
      message: [variantWords(c), c.note].filter(Boolean).join(' '), fix: variantFix(c), sourceUrl: c.rule.source_url || null,
      cascadeFrom: c.target || null, place: c.tdsTaxes ? TDS_EXPORT_PLACE : c.rule.params?.check === 'arrived_in_zoho' ? wizardStepPlace(key) : placeForRule(c.rule.id, c.variant, c.target),
      // the TDS taxes the file names that cannot be checked: [{ name, section, rate }] (create them in Zoho Books)
      ...(c.tdsTaxes ? { tdsTaxes: c.tdsTaxes } : {}),
      // a step to do by hand in Zoho Books BEFORE this file is imported (a rule can ask for one with params.preStep; none does at present)
      // and then the import with Skip Duplicates leaves the row alone. Not a mere warning.
      ...(c.rule.params?.preStep && !c.target ? { preStep: { what: c.rule.params.preStep.what, where: c.rule.params.preStep.where, then: c.rule.params.preStep.then || null }, tierLabel: PRE_STEP_LABEL } : {}),
    };
  }).sort((a, b) => TIERS[b.tier] - TIERS[a.tier] || b.rows - a.rows || a.id.localeCompare(b.id));

  return {
    key, module: mod.label || key, zohoModule: mod.zoho_module || null, fileName: file.fileName || null, idColumn: identLabelOf(key),
    oneRowIs: mod.one_row_is || 'one record', hasDocuments: !!doc,
    rows: n, rowsOk: n - rowsWill - rowsMay, rowsMay, rowsWill, rowsWithWarnings: rowsWarn,
    documents: docs, docsOk: docs - docsWill - docsMay, docsMay, docsWill,
    percent: pct(n - rowsWill, n), percentLow: pct(n - rowsWill - rowsMay, n),
    percentDocuments: pct(docs - docsWill, docs), percentDocumentsLow: pct(docs - docsWill - docsMay, docs),
    rulesApplied: rules.length - notChecked.length, causes: list, notChecked,
    // facts to know, counted (for example: journals that leave a credit on a customer or vendor). Not findings.
    notes,
    // kept for the drill-down and the replay; not part of the stored summary
    detail: { headers, rows, status, docIds: doc ? doc.ids : null, docStatus: doc ? docStatus : null, causes, idCol, identCols },
  };
}

// What a cause says: the rule's message, or the words for a cascade.
function variantWords(c) {
  const r = c.rule;
  const target = c.target ? moduleLabel(c.target) : '';
  if (c.variant === 'not_in_zoho') return `Zoho Books does not have the name written here: it is not in the export of Zoho Books given in the Import Wizard (${target}). Zoho Books refuses this ${c.rule.id.startsWith('JRN') ? 'journal' : 'row'}. Nothing is wrong with the row itself.`;
  if (c.variant === 'cascade') return `The name written here is on a row of the ${target} file that Zoho will refuse, so it will not exist in Zoho Books and this ${c.rule.id.startsWith('JRN') ? 'journal' : 'document'} is refused too. Nothing is wrong with the row itself.`;
  if (c.variant === 'cascade_may') return `The name written here is on a row of the ${target} file that Zoho may refuse. If it does, this row is refused too.`;
  if (c.variant === 'watch') return `The name written here is on a row of the ${target} file that is on the watch list: a row like it was refused once, for a reason that is not known.`;
  if (c.variant === 'where') return `${r.message} The name is in the file, but not with what this rule needs.`;
  // these variants say it all in their note
  if (['unverified', 'other_vendor', 'other_party', 'other_totals', 'total_filled'].includes(c.variant)) return '';
  return r.message;
}
function variantFix(c) {
  if (c.fixText) return c.fixText;
  const target = c.target ? moduleLabel(c.target) : '';
  if (c.variant === 'not_in_zoho') return `Import Wizard, step of the ${target} file: download the file with only the missing rows and import it (an account Zoho usually creates itself is made by hand, with exactly this name). Then export from Zoho Books again and upload the new export. These rows then import as they are.`;
  if (c.variant === 'cascade' || c.variant === 'cascade_may' || c.variant === 'watch') return `Correct the rows of the ${target} file first (see that file in this check). Once they import, these rows import as they are.`;
  if (c.variant === 'other_party') return 'Write the number of a document of the same customer or vendor, or leave the number empty: the amount then stays unapplied (on account) and can be applied in Zoho Books.';
  if (c.variant === 'unverified') return 'Check in Zoho Books that it exists with exactly this name before importing, or choose one of the names Zoho creates itself.';
  return c.rule.fix;
}

// ---------- the check of a set of files ----------
// files: { <key>: { headers, rows, bytes?, fileName? } }, keys as in zohorules.json modules.
// options: { homeState (Zoho state code of the organisation), zohoNames: { taxes: [], tds_taxes: [], tax_exemptions: [] } }
// options.zohoAccounts: [{ name, accountType }] of Zoho's own Chart of Accounts export of the organisation (Import Wizard,
// set-up), when given: then the accounts Zoho has are those (certain), not the researched list (audit item 10).
export function checkFiles(files, options = {}) {
  const t0 = performance.now();
  const defaultAccounts = options.zohoAccounts?.length
    ? new Map(options.zohoAccounts.map(a => [String(a.name).trim().toLowerCase(), { name: String(a.name).trim(), account_type: a.accountType || null, exists_by_default: 'yes', evidence: 'confirmed by our import' }]))
    : DEFAULT_ACCOUNTS;
  const ctx = { names: {}, namesLower: {}, docs: {}, journalNumbers: new Map(), options, defaultAccounts };
  const order = [...CHECK_ORDER.filter(k => files[k]), ...Object.keys(files).filter(k => !CHECK_ORDER.includes(k))];
  const out = [];
  const skipped = [];
  for (const key of order) {
    if (!RULES.modules[key] || !moduleRules(key)) { skipped.push({ key, reason: 'No rules for this file.' }); continue; }
    out.push(checkOneFile(key, files[key], ctx));
  }
  const sum = f => out.reduce((t, x) => t + f(x), 0);
  const rows = sum(f => f.rows), will = sum(f => f.rowsWill), may = sum(f => f.rowsMay);
  const docs = sum(f => f.documents), dWill = sum(f => f.docsWill), dMay = sum(f => f.docsMay);
  const pct = (a, b) => (b ? Math.floor((a / b) * 1000) / 10 : 100);
  return {
    rulesVersion: RULES.meta.version, rulesDate: RULES.meta.date,
    overall: {
      files: out.length, rows, rowsOk: rows - will - may, rowsMay: may, rowsWill: will,
      documents: docs, docsOk: docs - dWill - dMay, docsMay: dMay, docsWill: dWill,
      percentRows: pct(rows - will, rows), percentRowsLow: pct(rows - will - may, rows),
      percentDocuments: pct(docs - dWill, docs), percentDocumentsLow: pct(docs - dWill - dMay, docs),
      causesWill: sum(f => f.causes.filter(c => c.tier === 'will').length), causesMay: sum(f => f.causes.filter(c => c.tier === 'may').length),
      warnings: sum(f => f.causes.filter(c => c.tier === 'warning').length),
    },
    files: out, skipped, ms: Math.round(performance.now() - t0),
  };
}

// The result without the rows (what is stored and sent as the summary).
export const summaryOf = result => ({ ...result, files: result.files.map(({ detail, ...f }) => f) });

// The rows behind one cause of one file: [{ rowNumber (the heading row is row 1, as in Zoho's error file), ident, column, values }].
export function causeRows(fileResult, causeId, { offset = 0, limit = 50 } = {}) {
  const c = fileResult.detail.causes.get(causeId);
  if (!c) return null;
  const { headers, rows, idCol, status } = fileResult.detail;
  // the record a row belongs to: its identifying columns joined (a journal: "RCT-" + "1" = RCT-1)
  const identCols = fileResult.detail.identCols?.length ? fileResult.detail.identCols : idCol >= 0 ? [idCol] : [];
  const identOf = i => identCols.map(x => rows[i][x] ?? '').join('');
  const ruleCols = (c.rule.columns || []).filter(x => x !== '*').map(h => headers.indexOf(headKey(h))).filter(x => x >= 0);
  const pick = (i, x) => {
    const cols = [...new Set([...(x >= 0 ? [x] : []), ...ruleCols])];
    return Object.fromEntries(cols.map(k => [headers[k], rows[i][k] ?? '']));
  };
  if (c.whole && !c.rows.length) return { total: 0, wholeFile: true, rows: [] };
  return {
    total: c.rows.length, wholeFile: c.whole,
    rows: c.rows.slice(offset, offset + limit).map((i, k) => ({
      rowNumber: i + 2, ident: identOf(i), column: c.cols[offset + k] >= 0 ? headers[c.cols[offset + k]] : null,
      values: pick(i, c.cols[offset + k]), outcome: TIER_NAME[status[i]] || 'ok',
    })),
  };
}
