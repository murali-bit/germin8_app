// Mapping decisions, template registry, rejection handling, verification and the identifier crosswalk.
//
// ASSUMED FILE FORMATS (to be confirmed with real Zoho Books files):
//  - Rejection file: a CSV with the same columns as the file we generated, plus one column whose
//    heading contains "error", "reason" or "message".
//  - Zoho report for verification: a CSV that has the module's identifying column (for example
//    "Display Name" or "Invoice Number"), optionally a column ending in "ID", and optionally one
//    amount column (a heading containing total, amount, balance or value) holding the record's amount.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Decimal from 'decimal.js';
import { ZOHO_ACCOUNT_TYPES, canonicalAccountType, standardAccountType, resolveAccountType, groupSection, isPrimaryMarker, unusualSide, parseCsv } from './zoho.js';
import { money, jobYear, tallyText, entryType } from './tally.js';
import { readTallyFile } from './tallystream.js';
import { ALL_FILES, defaultColumns, idColumnId, csvFor } from './columns.js';
import { loadDecisions } from './decisions.js';
import { readTable } from './sheet.js';
import { detectRejectionColumns, rejectionRecords, causeOf, causeOfRecord, groupRejections, ERROR_FILE_NOTE, zohoErrorRows, explainErrorRows, refusedNames } from './zohoerrors.js';
import { identColumnsOf } from './zohocheck.js';
import { knownNames } from './zohoverify.js';

export { ALL_FILES };
const SENSITIVE = /balance|debit|credit|total|price|rate|value|date|stock/i; // columns that carry accounting values

// ---------- the column layout a generated file was built with ----------
// Other code never looks a column up by its heading text. It asks here for the file's columns (as recorded when
// the file was created) and works with column ids. Stored row values are keyed by column id, so they stay usable
// when a heading is renamed later. Files created before layouts were recorded have no columns stored and their
// rows are keyed by the original headings: they are read as the default layout.
export function fileLayout(db, jobId, key) {
  const f = db.prepare('SELECT columns, mapping_hash FROM generated_files WHERE job_id = ? AND key = ?').get(jobId, key);
  const legacy = !f?.columns;
  const defaults = defaultColumns(key);
  const columns = legacy ? defaults : JSON.parse(f.columns);
  const defaultHeading = Object.fromEntries(defaults.map(c => [c.id, c.heading]));
  const idId = idColumnId(key);
  // A column still carries its standard value when it is present and reads its own built-in value.
  const standard = id => columns.some(c => c.id === id && c.source?.type === 'builtin' && c.source.builtin === id);
  return {
    columns, legacy, mappingHash: f?.mapping_hash ?? null,
    headings: columns.map(c => c.heading),
    headingOf: Object.fromEntries(columns.map(c => [c.id, c.heading])),
    idByHeading: Object.fromEntries(columns.map(c => [c.heading, c.id])),
    idHeading: columns.find(c => c.id === idId)?.heading ?? ALL_FILES[key].idColumn,
    standard,
    // The values of one stored row, keyed by column id.
    values: g => {
      const v = JSON.parse(g.row_data || '{}');
      return legacy ? Object.fromEntries(defaults.map(c => [c.id, v[c.heading]])) : v;
    },
    // A column carries an accounting value when its heading, its original heading, or what it reads says so.
    sensitive: c => SENSITIVE.test(c.heading) || SENSITIVE.test(defaultHeading[c.id] || '')
      || (c.source?.type === 'builtin' && SENSITIVE.test(defaultHeading[c.source.builtin] || '')) || (c.source?.type === 'field' && SENSITIVE.test(c.source.path)),
  };
}

const CATEGORIES = [
  [/not found|does not exist|doesn't exist|no such|unknown (customer|vendor|account|item)/i, 'Missing customer, vendor, account or item', 'Import the missing master first, or correct the name so it matches Zoho.'],
  [/duplicate|already exists|already been/i, 'Duplicate record', 'The record is already in Zoho. Usually no retry is needed; confirm in Zoho.'],
  [/tax/i, 'Tax or account not configured in Zoho', 'Create the tax in Zoho Books, then check the tax mapping.'],
  [/mandatory|required|cannot be empty|can't be empty|is empty|blank|missing/i, 'Missing mandatory field', 'Fill the missing value. If it does not exist in Tally, an accountant must decide.'],
  [/date|format|numeric|number/i, 'Date or number format', 'Correct the format of the value. The accounting value itself must not change.'],
  [/invalid|not supported|unsupported|not allowed/i, 'Invalid or unsupported value', 'Replace the value with one Zoho accepts.'],
];
const diagnose = msg => {
  const hit = CATEGORIES.find(([re]) => re.test(msg));
  return hit ? { category: hit[1], suggestion: hit[2] } : { category: 'Other', suggestion: 'Review the Zoho message and decide the correction.' };
};
const norm = v => String(v ?? '').trim().toLowerCase();
const MAX_NAME_LENGTH = 100; // longest Zoho unit or tax name accepted from the user

export function setupExtras(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tax_mappings (job_id TEXT NOT NULL, ledger TEXT NOT NULL, zoho_tax TEXT NOT NULL, decided_by TEXT, at TEXT, PRIMARY KEY (job_id, ledger));
    CREATE TABLE IF NOT EXISTS account_type_overrides (job_id TEXT NOT NULL, tally_group TEXT NOT NULL, zoho_type TEXT NOT NULL, decided_by TEXT, at TEXT, PRIMARY KEY (job_id, tally_group));
    CREATE TABLE IF NOT EXISTS rejections (
      id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, key TEXT NOT NULL, ident TEXT, error TEXT, category TEXT, suggestion TEXT,
      row_nos TEXT, source_id TEXT, source_name TEXT, status TEXT NOT NULL, uploaded_at TEXT);
    CREATE TABLE IF NOT EXISTS corrections (
      id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, key TEXT NOT NULL, row_no INTEGER NOT NULL, column_name TEXT NOT NULL,
      original TEXT, new_value TEXT, reason TEXT, approver TEXT, at TEXT);
    CREATE TABLE IF NOT EXISTS verification (job_id TEXT NOT NULL, key TEXT NOT NULL, ident TEXT NOT NULL, status TEXT NOT NULL, zoho_id TEXT, at TEXT, PRIMARY KEY (job_id, key, ident));
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS unit_mappings (job_id TEXT NOT NULL, tally_unit TEXT NOT NULL, zoho_unit TEXT NOT NULL, decided_by TEXT, at TEXT, PRIMARY KEY (job_id, tally_unit));
    CREATE TABLE IF NOT EXISTS verification_runs (job_id TEXT NOT NULL, key TEXT NOT NULL, amount_column TEXT, note TEXT, at TEXT, PRIMARY KEY (job_id, key));
  `);
  for (const col of ['row_data TEXT', 'ident TEXT']) { try { db.exec(`ALTER TABLE generated_rows ADD COLUMN ${col}`); } catch { /* exists */ } }
  db.exec('CREATE INDEX IF NOT EXISTS idx_generated_rows ON generated_rows (job_id, key)');
  // column_id: the stable id of the corrected column. column_name keeps the heading as it was when the correction was approved.
  try { db.exec('ALTER TABLE corrections ADD COLUMN column_id TEXT'); } catch { /* exists */ }
  migrateAccountTypes(db);
  // amount_status: 'agrees', 'differs' or 'not_available' (no amount column, blank, unreadable, or unclear in the report)
  for (const col of ['expected_amount TEXT', 'zoho_amount TEXT', 'amount_status TEXT']) { try { db.exec(`ALTER TABLE verification ADD COLUMN ${col}`); } catch { /* exists */ } }
  // messages: JSON, every different message Zoho gave for the record; causes: JSON, the cause of each (zohoerrors.js).
  // NULL for rejections stored before these existed: the error column is then the only message.
  for (const col of ['messages TEXT', 'causes TEXT']) { try { db.exec(`ALTER TABLE rejections ADD COLUMN ${col}`); } catch { /* exists */ } }
  // How the last error file of each generated file was read: the file, its format and the columns used.
  db.exec(`CREATE TABLE IF NOT EXISTS rejection_runs (job_id TEXT NOT NULL, key TEXT NOT NULL, file_name TEXT, format TEXT, header_row INTEGER, id_column TEXT,
    error_column TEXT, how TEXT, rows_read INTEGER, blank_ident INTEGER, uploaded_by TEXT, at TEXT, PRIMARY KEY (job_id, key))`);
  // error_rows: JSON, the rows of an error file in Zoho's own layout (ROWNUMBER, ERRORMESSAGE, ...), kept small
  // (zohoErrorRows), so the file can be explained by root cause whenever it is asked for. NULL for any other layout.
  try { db.exec('ALTER TABLE rejection_runs ADD COLUMN error_rows TEXT'); } catch { /* exists */ }
}

// Account type decisions stored with another spelling of a Zoho account type (for example "Cost of Goods Sold") are
// rewritten with the spelling Zoho Books uses (ZOHO_ACCOUNT_TYPES). A stored type that is not a Zoho type at all is
// left as it is (it is then flagged as having no approved type when the files are created).
export function migrateAccountTypes(db) {
  for (const r of db.prepare('SELECT job_id, tally_group, zoho_type FROM account_type_overrides').all()) {
    const c = canonicalAccountType(r.zoho_type);
    if (c && c !== r.zoho_type) db.prepare('UPDATE account_type_overrides SET zoho_type = ? WHERE job_id = ? AND tally_group = ?').run(c, r.job_id, r.tally_group);
  }
}

// The Currency masters of the All Masters file (tally.js currencyCode reads the three-letter code from them): [{ name,
// originalname, expandedsymbol, mailingname, formalname, isocurrencycode }]. Read once from the kept All Masters file
// and kept on the bundle (master_bundles.currencies). [] when no All Masters file was uploaded or it has none.
const CURRENCY_FIELDS = ['name', 'originalname', 'expandedsymbol', 'mailingname', 'formalname', 'isocurrencycode'];
export function currencyRecords(db, jobId) {
  let b;
  try { b = db.prepare('SELECT currencies, path FROM master_bundles WHERE job_id = ?').get(jobId); } catch { return []; }
  if (!b) return [];
  if (b.currencies) { try { return JSON.parse(b.currencies); } catch { /* read again */ } }
  const list = [];
  try {
    for (const ev of readTallyFile(b.path)) {
      if (ev.type !== 'record' || entryType(ev.value) !== 'Currency') continue;
      const m = ev.value;
      list.push(Object.fromEntries(CURRENCY_FIELDS.map(f => [f, f === 'name' ? tallyText(m.metadata?.name ?? m.name) || tallyText(m.name) : tallyText(m[f])])));
    }
  } catch { return []; }
  try { db.prepare('UPDATE master_bundles SET currencies = ? WHERE job_id = ?').run(JSON.stringify(list), jobId); } catch { /* the column is added by index.js */ }
  return list;
}

// The user's approved decisions for a migration, used when generating files.
export function makeContext(db, jobId, opts = {}) {
  // Group -> parent, from Group records uploaded with the Chart of Accounts. Empty when none were uploaded.
  // groupReserved: group -> Tally's reserved name (metadata.reservedname), so a renamed Tally group keeps its
  // standard type and its "no inherit" rule (resolveAccountType in zoho.js).
  // groupNature: group -> { revenue, positive }: Tally's own "isrevenue" and "isdeemedpositive" of the group (true /
  // false, or null when the record does not say), used for the default account type of a group nobody decided
  // (defaultAccountType in zoho.js).
  const groupParents = {}, groupReserved = {}, groupNature = {};
  const yesNo = v => (v === 1 || v === true || /^(yes|true)$/i.test(String(v ?? '').trim()) ? true : v === 0 || v === false || /^(no|false)$/i.test(String(v ?? '').trim()) ? false : null);
  for (const g of db.prepare(`SELECT name, json_extract(data, '$.parent') parent, json_extract(data, '$.metadata.reservedname') reserved, json_extract(data, '$.isrevenue') revenue,
    json_extract(data, '$.isdeemedpositive') positive FROM source_records WHERE job_id = ? AND slot = 'accounts' AND object_type = 'Group' ORDER BY id`).all(jobId)) {
    if (g.name && !(g.name in groupParents) && !isPrimaryMarker(g.parent)) groupParents[g.name] = String(g.parent);
    const r = typeof g.reserved === 'string' ? g.reserved.trim() : '';
    if (g.name && r && !(g.name in groupReserved)) groupReserved[g.name] = r;
    if (g.name && !(g.name in groupNature)) groupNature[g.name] = { revenue: yesNo(g.revenue), positive: yesNo(g.positive) };
  }
  // The end of the migration's financial year ("YYYYMMDD"): dated Tally details (mailing address, GST registration)
  // are taken as they apply on that date.
  const range = jobYear(db.prepare('SELECT * FROM migrations WHERE id = ?').get(jobId));
  const ctx = {
    asOf: range ? range.to.replace(/-/g, '') : null,
    accountTypes: Object.fromEntries(db.prepare('SELECT tally_group, zoho_type FROM account_type_overrides WHERE job_id = ?').all(jobId).filter(r => canonicalAccountType(r.zoho_type)).map(r => [r.tally_group, canonicalAccountType(r.zoho_type)])),
    groupParents, groupReserved, groupNature,
    taxMap: Object.fromEntries(db.prepare('SELECT ledger, zoho_tax FROM tax_mappings WHERE job_id = ?').all(jobId).map(r => [r.ledger, r.zoho_tax])),
    unitMap: Object.fromEntries(db.prepare('SELECT tally_unit, zoho_unit FROM unit_mappings WHERE job_id = ?').all(jobId).map(r => [r.tally_unit, r.zoho_unit])),
    // the Currency masters (a party, bank or document kept in another currency: zohocodes.js currencyCode)
    currencies: currencyRecords(db, jobId),
    // gstCodes, itemSettings, itemAccounts, clashDecisions, openingJournalDate (decisions.js)
    ...loadDecisions(db, jobId, opts),
  };
  // openingAnchor: the ONE chart ledger whose opening balance is not in the opening balance journal (the date anchor,
  // defaults.js chooseDateAnchor; { name, mode, recId } or null). Worked out once per context, the first time a row asks
  // for it, by the resolver index.js registers. While it is being worked out it reads as null (the resolver builds the
  // chart rows itself), and a context made without a resolver (a test of the row builders) has none.
  const resolve = anchorResolvers.get(db);
  let anchor = null, state = resolve ? 0 : 2;
  Object.defineProperty(ctx, 'openingAnchor', { enumerable: true, configurable: true,
    get() { if (state === 2) return anchor; if (state === 1) return null; state = 1; try { anchor = resolve(jobId, ctx) || null; } catch (e) { anchor = null; console.error(`opening anchor of ${jobId}: ${e?.message || e}`); } state = 2; return anchor; },
    set(v) { anchor = v || null; state = 2; } });
  return ctx;
}
const anchorResolvers = new WeakMap();
export const setOpeningAnchorResolver = (db, fn) => { anchorResolvers.set(db, fn); };

// ---------- amount comparison (Reconciliation) ----------
// ASSUMED: the Zoho report has one amount column per record. Not confirmed against real Zoho Books reports.
export const RECONCILIATION_NOTE = 'Records and amounts are compared using an assumed Zoho report format that has not been confirmed against real Zoho Books reports.';

// How the expected amount of one record is worked out, and which report headings are preferred.
// Each rule gets the record's generated rows with their Tally source record: [{ row, source }] (row values keyed by
// column id), and returns { amount: Decimal, unusual: true when the Tally balance is on the unusual side }.
// needs: the ids of the columns the rule depends on. If one of them was removed from the file's layout, or no longer
// carries its standard value, the file's amounts are not compared (they are never guessed from another column).
// basis(h): how the expected amount is worked out, in words; h maps a column id to the heading written in the file.
const sumCol = col => list => ({ amount: list.reduce((t, x) => t.plus(x.row[col] || 0), new Decimal(0)), unusual: false });
// Customers, Vendors and Items: the generated file carries the figure WITHOUT its sign, so the expected amount is
// taken from the Tally source record with its sign (Tally: debit is negative). debitPositive says which side is
// written as a positive figure. A balance on the other side is "unusual": it is never reported as agreeing.
const signedSource = (field, debitPositive) => list => {
  let amount = new Decimal(0), unusual = false;
  for (const { source } of list) {
    const a = source ? money(source[field]) : null;
    if (a === null) throw new Error('unreadable source amount');
    if (unusualSide(source[field], debitPositive)) unusual = true;
    amount = amount.plus(debitPositive ? a.negated() : a);
  }
  return { amount, unusual };
};
// Invoices and Bills: the document total as Zoho Books works it out from the rows written (it equals Tally's party
// amount unless the file flagged the document with "document_total_differs"). Each line's quantity times price (rate),
// plus the tax Zoho works out from the line's rate, each part of a tax group (CGST and SGST, half the rate each) rounded
// to the paisa on its own, as a test import showed (a bill row with a tax name and no percentage: its Tax Amount); on a
// bill less the TDS Amount (Zoho keeps the TDS Amount as written: a test import showed tds_total equal to it), plus Adjustment.
const dec = v => new Decimal(String(v ?? '').trim() || 0);
const r2 = d => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
// the tax of the taxed rows of one document: taxed: [{ line, pct, type }]. mode 'line' (Zoho's item-level rounding, the
// default): each part of each row rounded; 'entity' (transaction level): each part added up over the document, then rounded.
const docTax = (taxed, mode) => {
  const parts = t => (String(t.type ?? '').trim() === 'Tax Group' ? [t.pct.div(2), t.pct.div(2)] : [t.pct]);
  if (mode !== 'entity') return taxed.reduce((sum, t) => parts(t).reduce((x, p) => x.plus(r2(t.line.times(p).div(100))), sum), new Decimal(0));
  const byPart = new Map();
  for (const t of taxed) parts(t).forEach((p, i) => { const k = `${parts(t).length}|${i}|${p}`; byPart.set(k, (byPart.get(k) || new Decimal(0)).plus(t.line.times(p).div(100))); });
  return [...byPart.values()].reduce((x, v) => x.plus(r2(v)), new Decimal(0));
};
const invoiceTotal = (list, mode) => {
  const lines = list.map(({ row }) => r2(dec(row.quantity).times(dec(row.item_price))));
  const tax = docTax(list.map(({ row }, i) => (row.item_tax ? { line: lines[i], pct: dec(row.item_tax_percent), type: row.item_tax_type } : null)).filter(Boolean), mode);
  return { unusual: false, amount: lines.reduce((t, x) => t.plus(x), new Decimal(0)).plus(tax).plus(dec(list[0]?.row.adjustment)) };
};
// (v2: the Bills file has no Item Total column any more, so the line amount is Quantity times Rate, as Zoho works it out)
const billTotal = (list, mode) => {
  const lines = list.map(({ row }) => r2(dec(row.quantity).times(dec(row.rate))));
  const byRate = ({ row }) => row.tax_percentage !== undefined && String(row.tax_percentage).trim() !== '' && row.tax_name;
  const tax = docTax(list.map((x, i) => (byRate(x) ? { line: lines[i], pct: dec(x.row.tax_percentage), type: x.row.tax_type } : null)).filter(Boolean), mode)
    .plus(list.reduce((t, x) => (byRate(x) ? t : t.plus(dec(x.row.tax_amount))), new Decimal(0)));
  const first = list[0]?.row || {};
  return { unusual: false, amount: lines.reduce((t, x) => t.plus(x), new Decimal(0)).plus(tax).minus(dec(first.tds_amount)).plus(dec(first.adjustment)) };
};
const AMOUNT_RULES = {
  invoices: { needs: ['quantity', 'item_price', 'item_tax', 'item_tax_percent', 'adjustment'], expected: invoiceTotal, prefer: ['Total', 'Invoice Total', 'Invoice Amount', 'Amount'],
    basis: h => `For each invoice: "${h.quantity}" times "${h.item_price}" on every row, plus the tax at "${h.item_tax_percent}" on each row with "${h.item_tax}" (each part of a tax group rounded on its own), plus "${h.adjustment}" (the total Zoho Books works out, which equals Tally's customer amount)` },
  bills: { needs: ['quantity', 'rate', 'tax_amount', 'tds_amount', 'adjustment'], expected: billTotal, prefer: ['Total', 'Bill Total', 'Bill Amount', 'Amount'],
    basis: h => `For each bill: "${h.quantity}" times "${h.rate}" plus the tax Zoho Books works out from the tax percentage (or "${h.tax_amount}" on a row with none) on every row, less "${h.tds_amount}" (Zoho keeps the TDS Amount as written), plus "${h.adjustment}" (the total Zoho Books works out, which equals Tally's vendor amount)` },
  journals: { needs: ['debit'], expected: sumCol('debit'), basis: h => `Sum of "${h.debit}" over the journal rows`, prefer: ['Total', 'Amount', 'Journal Amount', 'Total Debit'] },
  // the journals of Receipt, Payment, Contra and Debit / Credit Note vouchers: the same rule (each journal's debits)
  other_journals: { needs: ['debit'], expected: sumCol('debit'), basis: h => `Sum of "${h.debit}" over the journal rows`, prefer: ['Total', 'Amount', 'Journal Amount', 'Total Debit'] },
  customers: { needs: ['opening_balance'], expected: signedSource('openingbalance', true), prefer: ['Opening Balance'],
    basis: () => 'Opening balance from Tally with its sign: a debit balance (the customer owes money) is positive. A customer in credit is not compared, because its Opening Balance cell is left empty (the column carries no sign)' },
  vendors: { needs: ['opening_balance'], expected: signedSource('openingbalance', false), prefer: ['Opening Balance'],
    basis: () => 'Opening balance from Tally with its sign: a credit balance (money owed to the vendor) is positive. A vendor in debit is not compared, because its Opening Balance cell is left empty (the column carries no sign)' },
  opening_balances: { needs: ['debit', 'credit'], expected: list => ({ amount: sumCol('debit')(list).amount.minus(sumCol('credit')(list).amount), unusual: false }),
    basis: h => `"${h.debit}" minus "${h.credit}" (a credit balance is negative)`, prefer: ['Balance', 'Closing Balance', 'Opening Balance', 'Amount'], debitCredit: true },
  items: null, // the Items file carries no opening stock (Initial Stock is left empty by default)
  // Chart of Accounts: the opening balances are not compared (no Zoho report format for accounts has been confirmed)
  accounts: null,
};
// The amount rule of a generated file. usable is false when a column the rule needs is missing or changed.
function amountRule(key, layout) {
  const rule = AMOUNT_RULES[key];
  if (!rule) return { rule: null, usable: false, missing: [] };
  const missing = rule.needs.filter(id => !layout.standard(id));
  const defaults = Object.fromEntries(defaultColumns(key).map(c => [c.id, c.heading]));
  return { rule, usable: !missing.length, missing: missing.map(id => layout.headingOf[id] ?? defaults[id]) };
}

// An amount as text. Two decimal places when the figure has no more than two; otherwise every digit is kept,
// so a figure such as 100.004 is never rounded into agreement with 100.00.
const amountText = d => (d.isZero() ? '0.00' : d.decimalPlaces() <= 2 ? d.toFixed(2) : d.toFixed());

// Reads an amount as written in a report: thousands separators, currency symbols, brackets or a trailing minus for negatives.
// Returns a Decimal (exact, not rounded), or null when the cell is blank or cannot be read with certainty. Nothing is guessed:
//  - more than one negative marker, for example "(-500)" or "-500-", is unclear and gives null;
//  - commas are accepted only as thousands separators before the decimal point (1,234,567.00 or the Indian 12,34,567.00),
//    so "500,00" or "1.234,56" (comma as decimal mark) give null.
export function parseReportAmount(v) {
  let s = String(v ?? '').trim();
  if (!s) return null;
  let markers = 0;
  const strip = re => { const m = s.match(re); if (m) { markers++; s = m[1].trim(); } };
  strip(/^\((.*)\)$/); strip(/^-(.*)$/); strip(/^(.*)-$/);
  s = s.replace(/^(rs\.?|inr|[₹$€£])\s*/i, '').replace(/\s*(rs\.?|inr|[₹$€£])$/i, '');
  strip(/^-(.*)$/);
  if (markers > 1) return null;
  if (s.startsWith('+')) { if (markers) return null; s = s.slice(1); }
  if (!/^((\d{1,3}(,\d{3})+|\d{1,2}(,\d{2})*,\d{3}|\d+)(\.\d*)?|\.\d+)$/.test(s)) return null;
  const d = new Decimal(s.replace(/,/g, '').replace(/\.$/, ''));
  return markers ? d.negated() : d;
}

// Picks the amount column of a Zoho report. Returns { read(row) -> raw text, label } or null.
function findAmountColumn(headers, rule, skip) {
  const has = name => headers.find(h => norm(h) === norm(name) && !skip.includes(h));
  for (const p of rule.prefer) { const h = has(p); if (h) return { label: h, read: r => parseReportAmount(r[h]) }; }
  const any = headers.find(h => /total|amount|balance|value/i.test(h) && !skip.includes(h));
  if (any) return { label: any, read: r => parseReportAmount(r[any]) };
  if (rule.debitCredit && has('Debit') && has('Credit')) {
    const dr = has('Debit'), cr = has('Credit');
    return { label: `${dr} minus ${cr}`, read: r => {
      const blank = x => String(x ?? '').trim() === '';
      if (blank(r[dr]) && blank(r[cr])) return null;
      const d = blank(r[dr]) ? new Decimal(0) : parseReportAmount(r[dr]), c = blank(r[cr]) ? new Decimal(0) : parseReportAmount(r[cr]);
      return d && c ? d.minus(c) : null;
    } };
  }
  return null;
}

const notComparable = missing => `Amounts are not compared for this file: the column ${missing.map(h => `"${h}"`).join(' and ')} was removed from the file's layout or no longer carries its standard value.`;

// Per-module reconciliation summary, used by GET verification and by the report.
export function verificationSummary(db, jobId) {
  const money2 = amountText;
  return db.prepare('SELECT key, module FROM generated_files WHERE job_id = ?').all(jobId).map(f => {
    const v = db.prepare('SELECT ident, status, zoho_id zohoId, expected_amount expectedAmount, zoho_amount zohoAmount, amount_status amountStatus FROM verification WHERE job_id = ? AND key = ? ORDER BY status, ident').all(jobId, f.key);
    const run = db.prepare('SELECT amount_column, note FROM verification_runs WHERE job_id = ? AND key = ?').get(jobId, f.key);
    const expected = db.prepare('SELECT COUNT(DISTINCT ident) n FROM generated_rows WHERE job_id = ? AND key = ?').get(jobId, f.key).n;
    const count = s => v.filter(x => x.status === s).length;
    const compared = v.filter(x => x.amountStatus === 'agrees' || x.amountStatus === 'differs');
    const total = (list, field) => money2(list.reduce((t, x) => t.plus(x[field] || 0), new Decimal(0)));
    const ours = v.filter(x => x.status !== 'extra');
    const hasAmounts = !!AMOUNT_RULES[f.key] && ours.some(x => x.expectedAmount != null);
    const layout = fileLayout(db, jobId, f.key);
    const ar = amountRule(f.key, layout);
    return {
      key: f.key, module: f.module, idColumn: layout.idHeading, idColumnId: idColumnId(f.key), expected, checked: v.length > 0, matched: count('matched'), missing: count('missing'), extra: count('extra'),
      amountBasis: ar.usable ? ar.rule.basis(layout.headingOf) : null, // how the expected amount is worked out; null when the module has no amount or it cannot be compared
      // false when the file's layout no longer has the column(s) the amount is taken from, with their standard value
      amountsComparable: ar.usable, amountsNotComparableReason: ar.rule && !ar.usable ? notComparable(ar.missing) : null,
      amountColumn: run?.amount_column || null,         // the report column used; null when amounts were not compared
      amountsCompared: compared.length, amountsDiffering: compared.filter(x => x.amountStatus === 'differs').length,
      amountsNotAvailable: v.filter(x => x.status === 'matched' && x.amountStatus === 'not_available').length,
      totalExpected: hasAmounts ? total(ours, 'expectedAmount') : null,             // every record in the generated file
      totalExpectedCompared: compared.length ? total(compared, 'expectedAmount') : null, // only the records whose amount was compared
      totalInZoho: compared.length ? total(compared, 'zohoAmount') : null,           // the same records, as shown in the Zoho report
      note: run?.note || null,
      problems: v.filter(x => x.status !== 'matched' || x.amountStatus === 'differs'),
    };
  });
}

export function registerExtras(app, { db, need, audit, now, tx, DATA_DIR, slotByKey, markStale = () => {} }) {
  const actor = req => req.user?.email || 'system';

  // The template registry (GET /api/templates) and the column layout routes are in columns.js.

  // ----- account type decisions (Mapping Studio) -----
  const accountTypes = jobId => {
    const ctx = makeContext(db, jobId);
    // Ledgers under Sundry Debtors and Sundry Creditors are Zoho contacts, not accounts (they are not written to the
    // Chart of Accounts), so their groups need no account type and are not listed.
    const groups = db.prepare("SELECT json_extract(data, '$.parent') grp, COUNT(*) n FROM source_records WHERE job_id = ? AND slot = 'accounts' AND object_type = 'Ledger' GROUP BY grp ORDER BY grp").all(jobId)
      // A ledger with no group (Tally's own Profit & Loss A/c, which is not written to the Chart of Accounts, or any other
      // such ledger, flagged as account_without_group when the files are created) has no group to decide a type on.
      .filter(g => g.grp && !['customers', 'vendors'].includes(groupSection(g.grp, ctx)));
    // Also list the groups above them (known from uploaded Group records), so a decision can be made once on a parent.
    const listed = new Set(groups.map(g => g.grp));
    const above = [];
    for (const g of groups) {
      const seen = new Set([g.grp]);
      for (let p = ctx.groupParents[g.grp]; p && !seen.has(p); p = ctx.groupParents[p]) {
        seen.add(p);
        if (!listed.has(p)) { listed.add(p); above.push({ grp: p, n: 0 }); }
      }
    }
    above.sort((a, b) => a.grp.localeCompare(b.grp));
    return {
      options: ZOHO_ACCOUNT_TYPES,
      // counted from the stored Group records, so a file whose groups are all top-level still counts as having them
      hasGroupRecords: db.prepare("SELECT COUNT(*) n FROM source_records WHERE job_id = ? AND slot = 'accounts' AND object_type = 'Group'").get(jobId).n > 0,
      groups: [...groups, ...above].map(g => {
        const r = resolveAccountType(g.grp, ctx);
        return {
          group: g.grp || '(none)', ledgers: g.n, parent: ctx.groupParents[g.grp] || null,
          standard: standardAccountType(g.grp, ctx), reservedName: ctx.groupReserved[g.grp] && ctx.groupReserved[g.grp] !== g.grp ? ctx.groupReserved[g.grp] : null, decided: ctx.accountTypes[g.grp] || null,
          zohoType: r.type || null,          // the type that will be written for ledgers directly under this group
          source: r.source,                  // 'decided', 'standard', 'inherited', or null when there is no answer
          inheritedFrom: r.inheritedFrom,    // the group the type came from, when source is 'inherited'
          needsDecision: !r.type && g.n > 0, // ledgers sit under this group and no type could be found
        };
      }),
    };
  };
  app.get('/api/migrations/:id/account-types', (req, reply) => { const job = need(req, reply); if (!job) return; return accountTypes(job.id); });
  app.put('/api/migrations/:id/account-types', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const { group, zohoType } = req.body || {};
    if (group && (zohoType === null || zohoType === '')) { // remove the decision: the group goes back to its standard or inherited type
      const had = db.prepare('SELECT zoho_type FROM account_type_overrides WHERE job_id = ? AND tally_group = ?').get(job.id, group);
      db.prepare('DELETE FROM account_type_overrides WHERE job_id = ? AND tally_group = ?').run(job.id, group);
      if (had) {
        audit(job.id, 'account_type_decision_removed', `Tally group "${group}" (was ${had.zoho_type})`);
        markStale(job.id, `The account type decision for Tally group "${group}" was removed (it was ${had.zoho_type}).`, ['accounts']);
      }
      return { ok: true };
    }
    if (!group || !ZOHO_ACCOUNT_TYPES.includes(zohoType)) return reply.code(400).send({ error: 'Choose a Zoho account type from the list.' });
    // What the group had before this decision, so the audit entry shows what was replaced.
    const before = resolveAccountType(group, makeContext(db, job.id));
    const was = before.source === 'decided' ? (before.type === zohoType ? '' : ` (was ${before.type})`)
      : before.source === 'standard' ? ` (was the standard type: ${before.type})`
      : before.source === 'inherited' ? ` (was inherited from "${before.inheritedFrom}": ${before.type})`
      : ' (no type before)';
    db.prepare('INSERT OR REPLACE INTO account_type_overrides VALUES (?,?,?,?,?)').run(job.id, group, zohoType, actor(req), now());
    audit(job.id, 'account_type_decided', `Tally group "${group}" -> ${zohoType}${was}`);
    // Deciding the type the group already had been given changes nothing in the files.
    if (!(before.source === 'decided' && before.type === zohoType)) markStale(job.id, `The account type for Tally group "${group}" was set to ${zohoType}${was}.`, ['accounts']);
    return { ok: true };
  });

  // Tax mapping and the Zoho tax list are in taxes.js.

  // ----- unit mapping: Tally unit -> the unit text written in the Zoho Items file -----
  // Default is "as written in Tally" (zohoUnit null). The source records are never changed.
  const unitList = jobId => {
    const ctx = makeContext(db, jobId);
    const unitsUploaded = !!db.prepare("SELECT 1 FROM uploads WHERE job_id = ? AND slot = 'units'").get(jobId);
    const units = new Map(); // tally unit -> { fullName, items, inFile }
    const entry = name => { if (!units.has(name)) units.set(name, { fullName: null, items: 0, inFile: false }); return units.get(name); };
    for (const u of db.prepare("SELECT name, json_extract(data, '$.originalname') full_name FROM source_records WHERE job_id = ? AND slot = 'units' AND object_type = 'Unit' ORDER BY id").all(jobId)) {
      const name = String(u.name ?? '').trim();
      if (!name) continue;
      const e = entry(name); e.inFile = true; e.fullName = e.fullName || (u.full_name ? String(u.full_name) : null);
    }
    for (const i of db.prepare("SELECT json_extract(data, '$.baseunits') unit FROM source_records WHERE job_id = ? AND slot = 'stock_items' AND object_type = 'StockItem' ORDER BY id").all(jobId)) {
      const name = tallyText(i.unit).trim(); // Tally's "not applicable" marker is no unit
      if (name) entry(name).items++;
    }
    return {
      unitsFileUploaded: unitsUploaded,
      units: [...units.entries()].map(([tallyUnit, e]) => ({
        tallyUnit, fullName: e.fullName, items: e.items, zohoUnit: ctx.unitMap[tallyUnit] || null,
        missingFromUnitsFile: unitsUploaded ? !e.inFile : null, // null when no Units file was uploaded, so nothing can be said
      })),
    };
  };
  app.get('/api/migrations/:id/unit-mappings', (req, reply) => { const job = need(req, reply); if (!job) return; return unitList(job.id); });
  app.put('/api/migrations/:id/unit-mappings', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const tallyUnit = String(req.body?.tallyUnit ?? '').trim(); const zohoUnit = String(req.body?.zohoUnit ?? '').trim();
    if (!unitList(job.id).units.some(u => u.tallyUnit === tallyUnit)) return reply.code(404).send({ error: 'That unit is not used by any stock item and is not in the Units file.' });
    if (zohoUnit.length > MAX_NAME_LENGTH) return reply.code(400).send({ error: `The Zoho unit is too long. Use ${MAX_NAME_LENGTH} characters or fewer.` });
    const had = db.prepare('SELECT zoho_unit FROM unit_mappings WHERE job_id = ? AND tally_unit = ?').get(job.id, tallyUnit);
    if (!zohoUnit) {
      db.prepare('DELETE FROM unit_mappings WHERE job_id = ? AND tally_unit = ?').run(job.id, tallyUnit);
      if (had) {
        audit(job.id, 'unit_mapping_removed', `Tally unit "${tallyUnit}" is written as in Tally again (was "${had.zoho_unit}")`);
        markStale(job.id, `The unit mapping for Tally unit "${tallyUnit}" was removed (it was "${had.zoho_unit}").`, ['items']);
      }
      return { ok: true };
    }
    db.prepare('INSERT OR REPLACE INTO unit_mappings VALUES (?,?,?,?,?)').run(job.id, tallyUnit, zohoUnit, actor(req), now());
    audit(job.id, 'unit_mapped', `Tally unit "${tallyUnit}" -> Zoho unit "${zohoUnit}"${had && had.zoho_unit !== zohoUnit ? ` (was "${had.zoho_unit}")` : had ? '' : ' (was written as in Tally)'}`);
    if (had?.zoho_unit !== zohoUnit) markStale(job.id, `Tally unit "${tallyUnit}" was mapped to Zoho unit "${zohoUnit}"${had ? ` (it was "${had.zoho_unit}")` : ''}.`, ['items']);
    return { ok: true };
  });

  // ----- rejections -----
  const genRows =(jobId, key) => db.prepare('SELECT g.*, s.name source_name FROM generated_rows g LEFT JOIN source_records s ON s.id = g.source_record_id WHERE g.job_id = ? AND g.key = ? ORDER BY g.row_no').all(jobId, key);
  // The latest approved correction per row and column id. A correction stored before column ids existed is
  // found through the heading it was saved with.
  const latestCorrections = (jobId, key, layout) => {
    const map = {};
    for (const c of db.prepare('SELECT * FROM corrections WHERE job_id = ? AND key = ? ORDER BY id').all(jobId, key)) {
      const cid = c.column_id || layout.idByHeading[c.column_name];
      if (cid) map[`${c.row_no}|${cid}`] = c;
    }
    return map;
  };
  // Row values keyed by the headings written in the file, in file order (what the screen shows).
  const byHeading = (layout, values) => Object.fromEntries(layout.columns.map(c => [c.heading, values[c.id] ?? '']));

  app.put('/api/migrations/:id/rejections/:key', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const t = ALL_FILES[req.params.key];
    const rows = t ? genRows(job.id, req.params.key) : [];
    if (!t || !rows.length) return reply.code(404).send({ error: 'That file has not been generated for this migration.' });
    if (!Buffer.isBuffer(req.body) || !req.body.length) return reply.code(400).send({ error: 'No file received.' });
    // CSV, XLSX or XLS; the heading row and the two columns are found by their headings, or picked by the user
    // (?idColumn=&errorColumn=). The layout of Zoho's error file is assumed (zohoerrors.js).
    const table = readTable(req.body);
    if (table.error) return reply.code(422).send({ error: table.error });
    // The identifying column is found by its id; its heading is the one written in the file when it was created.
    const layout = fileLayout(db, job.id, req.params.key);
    const idHeading = layout.idHeading;
    // A record known by several columns together (a journal: Journal Number Prefix and Journal Number Suffix, so RCT-1,
    // PMT-1 and CTR-1, which share the suffix 1, stay three records): the headings as written in the file created here.
    const stdIds = Object.fromEntries(defaultColumns(req.params.key).map(c => [c.heading, c.id]));
    const joinIds = identColumnsOf(req.params.key).length > 1 ? identColumnsOf(req.params.key).map(h => stdIds[h]).filter(id => id && layout.headingOf[id]) : [];
    const joinHeadings = joinIds.length > 1 ? joinIds.map(id => layout.headingOf[id]) : null;
    const cols = detectRejectionColumns(table.rows, { idHeading, joinHeadings, idColumn: String(req.query?.idColumn || '').trim() || null, errorColumn: String(req.query?.errorColumn || '').trim() || null });
    if (cols.error) return reply.code(422).send({ error: cols.error, needsColumns: true, headers: cols.headers, idHeading, note: ERROR_FILE_NOTE });
    const { records, blankIdent } = rejectionRecords(table.rows, cols);
    if (!records.length) return reply.code(422).send({ error: 'The file has no rejected rows.' });

    // the identifier of a row of the file created here, the same way the error file's records are known: the joined
    // columns when the error file was read that way, else the identifying column
    const identOfRow = cols.joined ? g => { const v = layout.values(g); return joinIds.map(id => String(v[id] ?? '').trim()).join(''); } : g => g.ident;
    const byIdent = {};
    for (const g of rows) (byIdent[norm(identOfRow(g))] ||= []).push(g);
    // Zoho's own layout has ROWNUMBER (the heading row is row 1): row N of the error file is row N - 1 of the file
    // imported. It is used only when every such row of the file created here carries the same identifier (a retry
    // file has other row numbers); otherwise the record is linked by its identifier, as before.
    const byRowNo = new Map(rows.map(g => [g.row_no, g]));
    const linkOf = r => {
      const byNo = (r.rowNumbers || []).map(n => byRowNo.get(n - 1)).filter(g => g && norm(identOfRow(g)) === norm(r.ident));
      return byNo.length && byNo.length === r.rowNumbers.length ? byNo : byIdent[norm(r.ident)];
    };
    const zoho = zohoErrorRows(table.rows, req.params.key);
    let linked = 0;
    const fileName = (() => { try { return decodeURIComponent(String(req.headers['x-filename'] || '')); } catch { return String(req.headers['x-filename'] || ''); } })();
    tx(() => {
      db.prepare('DELETE FROM rejections WHERE job_id = ? AND key = ?').run(job.id, req.params.key); // a new upload is a new import attempt
      const ins = db.prepare('INSERT INTO rejections (job_id, key, ident, error, category, suggestion, row_nos, source_id, source_name, status, uploaded_at, messages, causes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
      for (const r of records) { // one rejection per document, even if Zoho lists every line
        const hit = linkOf(r);
        const messages = r.messages.length ? r.messages : [''];
        const d = diagnose(messages[0]);
        if (hit) linked++;
        ins.run(job.id, req.params.key, r.ident, messages.join(' | '), d.category, d.suggestion, JSON.stringify(hit ? hit.map(g => g.row_no) : []), hit?.[0].source_id || null, hit?.[0].source_name || null, hit ? 'open' : 'unlinked', now(),
          JSON.stringify(messages), JSON.stringify(messages.map(m => causeOfRecord(m, r))));
      }
      db.prepare('INSERT OR REPLACE INTO rejection_runs (job_id, key, file_name, format, header_row, id_column, error_column, how, rows_read, blank_ident, uploaded_by, at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(job.id, req.params.key, fileName || null, table.format, cols.headerRow + 1, cols.idColumn, cols.errorColumn, JSON.stringify({ ...cols.how, otherErrorColumns: cols.otherErrorColumns }),
          table.rows.length - cols.headerRow - 1, blankIdent, actor(req), now());
      db.prepare('UPDATE rejection_runs SET error_rows = ? WHERE job_id = ? AND key = ?').run(zoho.zohoLayout ? JSON.stringify(zoho.rows) : null, job.id, req.params.key);
    });
    const total = db.prepare('SELECT COUNT(*) n FROM rejections WHERE job_id = ? AND key = ?').get(job.id, req.params.key).n;
    audit(job.id, 'rejection_file_uploaded', `${t.module}: ${total} rejected, ${linked} linked to Tally records (${table.format.toUpperCase()} file; identifying column "${cols.idColumn}", ${cols.how.id}; error column "${cols.errorColumn}", ${cols.how.error})`);
    return { rejected: total, linked, unlinked: total - linked };
  });

  // The rejections of every file grouped by cause, each cause with ONE suggested action and the place where it is
  // fixed, and how each error file was read (the columns used). Assumed error file layout (zohoerrors.js).
  app.get('/api/migrations/:id/rejections/groups', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const list = db.prepare('SELECT id, key, ident, error, status, messages, causes FROM rejections WHERE job_id = ? ORDER BY key, id').all(job.id).map(r => {
      const messages = (() => { try { return JSON.parse(r.messages || 'null'); } catch { return null; } })() || [r.error || ''];
      const causes = (() => { try { return JSON.parse(r.causes || 'null'); } catch { return null; } })() || messages.map(m => causeOf(m, [r.ident]));
      return { id: r.id, key: r.key, module: ALL_FILES[r.key]?.module || r.key, ident: r.ident, status: r.status, messages, causes };
    });
    const stored = db.prepare('SELECT * FROM rejection_runs WHERE job_id = ?').all(job.id).filter(x => list.some(r => r.key === x.key));
    const runs = stored.map(x => ({
      key: x.key, module: ALL_FILES[x.key]?.module || x.key, fileName: x.file_name, format: x.format, headerRow: x.header_row, idColumn: x.id_column, errorColumn: x.error_column,
      how: (() => { try { return JSON.parse(x.how || '{}'); } catch { return {}; } })(), rowsRead: x.rows_read, rowsWithoutIdentifier: x.blank_ident, uploadedBy: x.uploaded_by, at: x.at,
      zohoLayout: !!x.error_rows })); // the file has Zoho's own layout (ROWNUMBER, ERRORMESSAGE): confirmed, not assumed
    // explained: every error file in Zoho's own layout, by ROOT CAUSE (zohoerrors.js): the rule the message belongs
    // to, real errors apart from follow-on rows, and rows refused only because a name they use was refused in the
    // error file of an earlier import (a cascade). In the order the files are imported.
    const errorRows = Object.fromEntries(stored.filter(x => x.error_rows).map(x => [x.key, (() => { try { return JSON.parse(x.error_rows); } catch { return []; } })()]));
    const refused = Object.fromEntries(['accounts', 'customers', 'vendors', 'items'].filter(k => errorRows[k]).map(k => [k, refusedNames(k, errorRows[k])]));
    const order = Object.keys(ALL_FILES);
    // known: the names of the migration's own Customers, Vendors and Chart of Accounts files, and of Zoho's exports of
    // its contacts when they were given in the Import Wizard: an "Invalid row" on a contact is then explained as what
    // it is (the contact is not in Zoho Books, is on the wrong account, or is there by now)
    let known = null;
    try { known = Object.keys(errorRows).length ? knownNames(db, job.id) : null; } catch { known = null; }
    const explained = Object.keys(errorRows).sort((a, b) => order.indexOf(a) - order.indexOf(b))
      .map(k => ({ ...explainErrorRows(errorRows[k], { key: k, refused, known }), module: ALL_FILES[k]?.module || k }));
    return { note: ERROR_FILE_NOTE, runs, groups: groupRejections(list), rejected: list.length, explained };
  });

  app.get('/api/migrations/:id/rejections', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const cache = {}; // per file: layout, corrections and rows are read once
    const forKey = key => (cache[key] ||= (() => { const layout = fileLayout(db, job.id, key); return { layout, corr: latestCorrections(job.id, key, layout), rows: genRows(job.id, key) }; })());
    return db.prepare('SELECT * FROM rejections WHERE job_id = ? ORDER BY key, id').all(job.id).map(r => {
      const t = ALL_FILES[r.key];
      const nos = JSON.parse(r.row_nos || '[]');
      const { layout, corr, rows: all } = forKey(r.key);
      const rows = all.filter(g => nos.includes(g.row_no)).map(g => {
        const values = layout.values(g);
        return {
          rowNo: g.row_no, values: byHeading(layout, values), // keyed by the heading written in the file
          valuesById: Object.fromEntries(layout.columns.map(c => [c.id, values[c.id] ?? ''])),
          corrections: layout.columns.filter(c => corr[`${g.row_no}|${c.id}`]).map(c => {
            const x = corr[`${g.row_no}|${c.id}`];
            return { column: c.heading, columnId: c.id, original: x.original, newValue: x.new_value, reason: x.reason, approver: x.approver, at: x.at };
          }),
        };
      });
      return { id: r.id, key: r.key, module: t.module, columns: layout.headings,
        // The same columns with their stable ids. needsConfirmation: the column carries an accounting value.
        columnDefs: layout.columns.map(c => ({ id: c.id, heading: c.heading, identifying: c.id === idColumnId(r.key), needsConfirmation: layout.sensitive(c) })),
        idColumn: layout.idHeading, ident: r.ident, error: r.error, category: r.category, suggestion: r.suggestion, status: r.status, sourceId: r.source_id, sourceName: r.source_name, rows };
    });
  });

  app.post('/api/migrations/:id/rejections/:rid/corrections', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const r = db.prepare('SELECT * FROM rejections WHERE job_id = ? AND id = ?').get(job.id, Number(req.params.rid));
    if (!r) return reply.code(404).send({ error: 'Rejection not found.' });
    const t = ALL_FILES[r.key];
    const { rowNo, newValue, reason, confirmAccountingChange } = req.body || {};
    if (!JSON.parse(r.row_nos || '[]').includes(rowNo)) return reply.code(400).send({ error: 'That row is not part of this rejection.' });
    // The column is named by its id (columnId), or by the heading written in the file (column).
    const layout = fileLayout(db, job.id, r.key);
    const col = layout.columns.find(c => (req.body?.columnId != null ? c.id === req.body.columnId : c.heading === req.body?.column));
    if (!col) return reply.code(400).send({ error: 'Unknown column.' });
    const column = col.heading;
    if (!String(reason || '').trim()) return reply.code(400).send({ error: 'A reason is required for every correction.' });
    if (layout.sensitive(col) && confirmAccountingChange !== true) {
      return reply.code(409).send({ error: `"${column}" carries an accounting value. Confirm that this change is approved before saving it.`, needsConfirmation: true });
    }
    const g = db.prepare('SELECT * FROM generated_rows WHERE job_id = ? AND key = ? AND row_no = ?').get(job.id, r.key, rowNo);
    const original = layout.values(g)[col.id] ?? '';
    db.prepare('INSERT INTO corrections (job_id, key, row_no, column_name, original, new_value, reason, approver, at, column_id) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(job.id, r.key, rowNo, column, String(original), String(newValue ?? ''), String(reason).trim(), actor(req), now(), col.id);
    db.prepare("UPDATE rejections SET status = 'corrected' WHERE id = ?").run(r.id);
    audit(job.id, 'correction_approved', `${t.module} ${r.ident}, row ${rowNo}, ${column}: "${original}" -> "${newValue ?? ''}". Reason: ${String(reason).trim()}`);
    return { ok: true };
  });

  const retryPath = (jobId, key) => path.join(DATA_DIR, 'output', jobId, `retry_${ALL_FILES[key].file}`);

  // Retry file: only the rejected records, with approved corrections applied. Other records are untouched.
  app.post('/api/migrations/:id/rejections/:key/retry', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const t = ALL_FILES[req.params.key];
    if (!t) return reply.code(404).send({ error: 'Unknown file.' });
    const rej = db.prepare("SELECT * FROM rejections WHERE job_id = ? AND key = ? AND status <> 'unlinked'").all(job.id, req.params.key);
    if (!rej.length) return reply.code(409).send({ error: 'There are no linked rejections for this file.' });
    const nos = new Set(rej.flatMap(r => JSON.parse(r.row_nos || '[]')));
    // Same columns and headings as the file the rejections belong to.
    const layout = fileLayout(db, job.id, req.params.key);
    const corr = latestCorrections(job.id, req.params.key, layout);
    const rows = genRows(job.id, req.params.key).filter(g => nos.has(g.row_no)).map(g => {
      const v = layout.values(g);
      for (const c of layout.columns) if (corr[`${g.row_no}|${c.id}`]) v[c.id] = corr[`${g.row_no}|${c.id}`].new_value;
      return v;
    });
    const csv = csvFor(layout.columns, rows);
    fs.mkdirSync(path.dirname(retryPath(job.id, req.params.key)), { recursive: true });
    fs.writeFileSync(retryPath(job.id, req.params.key), csv);
    db.prepare("UPDATE rejections SET status = 'retried' WHERE job_id = ? AND key = ? AND status <> 'unlinked'").run(job.id, req.params.key);
    const applied = Object.values(corr).filter(c => nos.has(c.row_no)).length;
    audit(job.id, 'retry_file_generated', `${t.module}: ${rej.length} record(s), ${rows.length} row(s), ${applied} correction(s) applied`);
    return { fileName: `retry_${t.file}`, records: rej.length, rows: rows.length, corrections: applied, sha256: createHash('sha256').update(csv).digest('hex') };
  });

  app.get('/api/migrations/:id/rejections/:key/retry/download', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const t = ALL_FILES[req.params.key];
    if (!t || !fs.existsSync(retryPath(job.id, req.params.key))) return reply.code(404).send({ error: 'Retry file not generated yet.' });
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="retry_${t.file}"`).send(fs.readFileSync(retryPath(job.id, req.params.key)));
  });

  // ----- verification against a Zoho report -----
  app.put('/api/migrations/:id/verification/:key', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const t = ALL_FILES[req.params.key];
    const rows = t ? genRows(job.id, req.params.key) : [];
    if (!t || !rows.length) return reply.code(404).send({ error: 'That file has not been generated for this migration.' });
    if (!Buffer.isBuffer(req.body) || !req.body.length) return reply.code(400).send({ error: 'No file received.' });
    const csv = parseCsv(req.body.toString('utf8'));
    const layout = fileLayout(db, job.id, req.params.key);
    const idHeading = layout.idHeading; // the identifying column, found by its id, with the heading written in the file
    let idCol = csv.headers.find(h => norm(h) === norm(idHeading));
    // A journal is known by its WHOLE number (the Reference Number the tool writes is Journal Number Prefix + Suffix):
    // a report without that column can still be matched by the prefix and suffix columns joined, or by a column with
    // the whole journal number. Never by the suffix alone (RCT-1, PMT-1 and CTR-1 share the suffix 1).
    const joinCols = identColumnsOf(req.params.key).length > 1 ? identColumnsOf(req.params.key).map(h => csv.headers.find(x => norm(x) === norm(h))) : [];
    const JOINED = '\u0001joined';
    if (!idCol && joinCols.length > 1 && joinCols.every(Boolean)) { for (const r of csv.rows) r[JOINED] = joinCols.map(h => String(r[h] ?? '').trim()).join(''); idCol = JOINED; }
    else if (!idCol && joinCols.length > 1) idCol = csv.headers.find(h => /^(journal|entry)\s*(number|no\.?|#)$/i.test(String(h).trim())) || null;
    if (!idCol) return reply.code(422).send({ error: `The report needs a "${idHeading}" column to match ${t.module}${joinCols.length > 1 ? ` (or the columns ${identColumnsOf(req.params.key).map(h => `"${h}"`).join(' and ')}, or "Journal Number")` : ''}. Found: ${csv.headers.join(', ') || 'nothing'}.` });
    const zohoIdCol = csv.headers.find(h => /(^|[\s_])id$/i.test(h) && h !== idCol);
    const inZoho = new Map(csv.rows.map(r => [norm(r[idCol]), zohoIdCol ? String(r[zohoIdCol]).trim() : '']));
    const expected = [...new Set(rows.map(g => String(g.ident).trim()))];

    // Amounts. Expected amount per record comes from the generated rows; the Zoho amount from the report's amount column.
    // The amount rule reads columns by id. If a column it needs was removed from the layout, or no longer carries
    // its standard value, amounts are not compared for this file.
    const ar = amountRule(req.params.key, layout);
    const rule = ar.usable ? ar.rule : null;
    const amountCol = rule ? findAmountColumn(csv.headers, rule, [idCol, zohoIdCol].filter(Boolean)) : null;
    // how Zoho rounds the tax (voucher setting zohoTaxRounding): the expected totals are worked out the same way
    let taxRounding = 'line';
    try { taxRounding = JSON.parse(db.prepare('SELECT extra FROM voucher_settings WHERE job_id = ?').get(job.id)?.extra || '{}')?.zohoTaxRounding === 'entity' ? 'entity' : 'line'; } catch { taxRounding = 'line'; }
    const expectedAmount = {};
    const unusual = new Set(); // records whose Tally balance is on the unusual side: never reported as agreeing
    if (rule) {
      const sources = new Map(db.prepare('SELECT g.row_no, s.data FROM generated_rows g JOIN source_records s ON s.id = g.source_record_id WHERE g.job_id = ? AND g.key = ?')
        .all(job.id, req.params.key).map(x => [x.row_no, x.data]));
      const byIdent = {};
      for (const g of rows) (byIdent[String(g.ident).trim()] ||= []).push({ row: layout.values(g), source: sources.has(g.row_no) ? JSON.parse(sources.get(g.row_no)) : null });
      for (const [ident, list] of Object.entries(byIdent)) {
        try {
          const e = rule.expected(list, taxRounding);
          expectedAmount[ident] = amountText(e.amount);
          if (e.unusual) unusual.add(ident);
        } catch { expectedAmount[ident] = null; } // unreadable value: not compared
      }
    }
    // The amount shown in Zoho for each identifier. If the report lists the same identifier on several rows with
    // different amounts, it is unclear which one is the record's amount, so it is treated as not available.
    const zohoAmount = new Map();
    if (amountCol) {
      for (const r of csv.rows) {
        const k = norm(r[idCol]);
        const a = amountCol.read(r);
        const text = a ? amountText(a) : null; // exact: a figure with more than two decimal places is kept as written
        if (!zohoAmount.has(k)) zohoAmount.set(k, text);
        else if (zohoAmount.get(k) !== text) zohoAmount.set(k, null);
      }
    }
    let note = !ar.rule ? `${t.module} has no amount to compare. Records were matched by "${idHeading}" only.`
      : !rule ? `${notComparable(ar.missing)} Records were matched by "${idHeading}" only.`
      : !amountCol ? `Amounts were not compared: the report has no column whose heading contains total, amount, balance or value. Records were matched by "${idHeading}" only.`
      : `Amounts were compared using the report column "${amountCol.label}". This follows an assumed report format that has not been confirmed against real Zoho Books reports.`;

    let matched = 0, extra = 0, compared = 0, differing = 0, notAvailable = 0, unusualSkipped = 0;
    let totalCompared = new Decimal(0), totalZoho = new Decimal(0);
    tx(() => {
      db.prepare('DELETE FROM verification WHERE job_id = ? AND key = ?').run(job.id, req.params.key);
      const ins = db.prepare('INSERT OR IGNORE INTO verification (job_id, key, ident, status, zoho_id, at, expected_amount, zoho_amount, amount_status) VALUES (?,?,?,?,?,?,?,?,?)');
      for (const ident of expected) {
        const hit = inZoho.has(norm(ident));
        const exp = expectedAmount[ident] ?? null;
        let zoho = null, amountStatus = null;
        if (hit) {
          matched++;
          if (amountCol) {
            zoho = zohoAmount.get(norm(ident)) ?? null;
            if (exp === null || zoho === null) { amountStatus = 'not_available'; notAvailable++; }
            // The Opening Balance cell of this contact is empty: its balance (a customer in credit, a vendor in debit) is a line of
            // journal OB-2 in the opening balance journal file. A contacts report shows it as a credit of the contact, not as a balance. Not compared.
            else if (unusual.has(ident)) { amountStatus = 'not_available'; notAvailable++; unusualSkipped++; }
            else {
              amountStatus = exp === zoho ? 'agrees' : 'differs'; // both are exact decimals; nothing is rounded before comparing
              compared++; if (amountStatus === 'differs') differing++;
              totalCompared = totalCompared.plus(exp); totalZoho = totalZoho.plus(zoho);
            }
          }
        }
        ins.run(job.id, req.params.key, ident, hit ? 'matched' : 'missing', hit ? inZoho.get(norm(ident)) || null : null, now(), exp, zoho, amountStatus);
      }
      const exp = new Set(expected.map(norm));
      for (const r of csv.rows) {
        const ident = String(r[idCol]).trim();
        if (ident && !exp.has(norm(ident))) {
          const done = ins.run(job.id, req.params.key, ident, 'extra', zohoIdCol ? String(r[zohoIdCol]).trim() : null, now(), null, amountCol ? zohoAmount.get(norm(ident)) ?? null : null, null);
          if (done.changes) extra++;
        }
      }
      if (unusualSkipped) {
        note += ` ${unusualSkipped} record(s) have a balance on the unusual side in Tally (for example a customer in credit or a vendor in debit). Their amounts were not compared with this report: the balance is not in the Opening Balance column but in journal OB-2 of the opening balance journal file, and Zoho Books shows it as a credit of the contact (unused credits). Check them there.`;
      }
      db.prepare('INSERT OR REPLACE INTO verification_runs VALUES (?,?,?,?,?)').run(job.id, req.params.key, amountCol?.label || null, note, now());
    });
    audit(job.id, 'zoho_report_uploaded', `${t.module}: ${matched} of ${expected.length} matched`
      + (amountCol ? `; amounts compared on column "${amountCol.label}": ${compared} compared, ${differing} differ` : '; amounts not compared'));
    const allExpected = Object.values(expectedAmount);
    return {
      expected: expected.length, matched, missing: expected.length - matched, extra, hasZohoIds: !!zohoIdCol,
      amountColumn: amountCol?.label || null, amountsCompared: compared, amountsDiffering: differing, amountsNotAvailable: notAvailable,
      totalExpected: rule && allExpected.every(a => a !== null) ? amountText(allExpected.reduce((s, a) => s.plus(a), new Decimal(0))) : null,
      totalExpectedCompared: compared ? amountText(totalCompared) : null, totalInZoho: compared ? amountText(totalZoho) : null,
      note,
    };
  });

  app.get('/api/migrations/:id/verification', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    return verificationSummary(db, job.id);
  });

  // ----- identifier crosswalk: Tally record -> migration row -> Zoho record -----
  app.get('/api/migrations/:id/crosswalk', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const q = norm(req.query.q);
    // Verification and rejection rows are looked up from maps keyed by file and identifier (trimmed, lower case,
    // the same rule the Zoho report upload uses), so the time taken grows in step with the number of rows.
    const byIdent = list => new Map(list.map(x => [`${x.key}|${norm(x.ident)}`, x]));
    const ver = byIdent(db.prepare('SELECT key, ident, status, zoho_id, expected_amount, zoho_amount, amount_status FROM verification WHERE job_id = ?').all(job.id));
    const rej = byIdent(db.prepare('SELECT key, ident, status FROM rejections WHERE job_id = ? ORDER BY id DESC').all(job.id));
    const rows = db.prepare(`
      SELECT g.key, MIN(g.row_no) rowNo, MIN(g.row_key) rowKey, g.ident, g.source_id sourceId, s.name sourceName, s.slot
      FROM generated_rows g
      LEFT JOIN source_records s ON s.id = g.source_record_id
      WHERE g.job_id = ? GROUP BY g.key, g.ident, g.source_id ORDER BY g.key, rowNo`).all(job.id).map(g => {
      const v = ver.get(`${g.key}|${norm(g.ident)}`), r = rej.get(`${g.key}|${norm(g.ident)}`);
      return { ...g, vstatus: v?.status, zohoId: v?.zoho_id, expectedAmount: v?.expected_amount, zohoAmount: v?.zoho_amount, amountStatus: v?.amount_status, rstatus: r?.status };
    });
    const out = rows.map(r => ({
      module: ALL_FILES[r.key]?.module || r.key, fileRow: r.rowNo, rowKey: r.rowKey, ident: r.ident, sourceId: r.sourceId, sourceName: r.sourceName, dataset: slotByKey[r.slot]?.name,
      zohoId: r.zohoId || '', expectedAmount: r.expectedAmount ?? null, zohoAmount: r.zohoAmount ?? null, amountStatus: r.amountStatus ?? null,
      status: r.vstatus === 'matched' && r.amountStatus === 'differs' ? 'Amount differs in Zoho' : r.vstatus === 'matched' ? 'Verified in Zoho' : r.vstatus === 'missing' ? 'Not found in Zoho' : r.rstatus && r.rstatus !== 'unlinked' ? 'Rejected by Zoho' : 'Pending',
    }));
    // Vouchers held for a Zoho module with no import sample yet (payments.js): in no file, listed so every voucher can be found
    let held = [];
    try {
      held = db.prepare(`SELECT h.file_key, h.number, h.source_record_id recId, s.source_id sourceId, s.name sourceName, s.slot FROM held_vouchers h LEFT JOIN source_records s ON s.id = h.source_record_id
        WHERE h.job_id = ? ORDER BY h.rowid`).all(job.id);
    } catch { /* table not created yet */ }
    const HELD_MODULES = { payments_received: 'Payments Received', payments_made: 'Payments Made', vendor_credits: 'Vendor Credits', credit_notes: 'Credit Notes' };
    for (const h of held) {
      out.push({ module: HELD_MODULES[h.file_key] || h.file_key, fileRow: null, rowKey: `held-${h.file_key}-${h.recId}`, ident: h.number, sourceId: h.sourceId, sourceName: h.sourceName, dataset: slotByKey[h.slot]?.name,
        zohoId: '', expectedAmount: null, zohoAmount: null, amountStatus: null, status: 'Waiting for a Zoho sample (no file built)' });
    }
    const hit = q ? out.filter(r => [r.module, r.rowKey, r.ident, r.sourceId, r.sourceName, r.zohoId].some(x => norm(x).includes(q))) : out;
    return { total: hit.length, rows: hit.slice(0, 300) };
  });

  // Used by the test run report.
  return { accountTypes, unitList };
}
