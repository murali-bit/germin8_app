// Zoho Books error files (Rejection Manager).
// CONFIRMED in three test imports: Zoho's error file is the file that was imported with two columns in front,
// ROWNUMBER (the heading row is row 1) and ERRORMESSAGE. Such a file is explained by ROOT CAUSE (zohoErrorRows and
// explainErrorRows at the end of this file). The reader stays tolerant for any other layout and says what it used:
//  - the file may be CSV, XLSX or XLS (sheet.js), and the headings need not be on the first row: the heading row is the
//    first of the first 20 rows that holds the identifying column;
//  - the identifying column is the heading of that column as written in the file that was imported (compared without
//    capital letters, spaces and punctuation), or the column the user picks. A journal is known by its whole number:
//    when the file has Journal Number Prefix and Journal Number Suffix, the two are joined (RCT-1, PMT-1 and CTR-1
//    share the suffix 1 and are three journals);
//  - the error column is the first heading that says error, then reason, message, remark, failure, problem (in that
//    order of preference), or the column the user picks.
// Rejections are then grouped by their CAUSE: the message with the record's own values, quoted text, GSTINs, e-mail
// addresses and numbers replaced by placeholders, so "Customer 'A' does not exist" and "Customer 'B' does not exist"
// are one cause. Each cause gets ONE suggested action that names the place in the platform where it is fixed.
import { headingKey } from './sheet.js';
import { RULES, ruleById, moduleRules, moduleLabel, placeForRule } from './zohocheck.js';
import { builtinAccount, accountNameKey, contactNameKey } from './zohocodes.js';

export const ERROR_FILE_NOTE = "Zoho's error file is the file you imported with two columns in front: ROWNUMBER and ERRORMESSAGE (seen in three test imports). A file in another layout is read too: the columns used are shown, and can be changed if they are wrong.";
const HEADER_SCAN = 20;
const ERROR_HEADINGS = [/^errors?$/, /error/, /reason/, /message/, /remark/, /fail/, /problem|issue/];

const cell = (row, i) => String(row?.[i] ?? '').trim();
const headingsOf = row => (row || []).map(h => String(h ?? '').trim());

// rows: [[cell]] (sheet.js). want: { idHeading (the heading written in the generated file), idColumn?, errorColumn? (picked),
//   joinHeadings? (the headings that TOGETHER identify a record, as written in the generated file: a journal's
//   Journal Number Prefix and Journal Number Suffix) }.
// When the file has every one of joinHeadings, the record is known by those columns joined, unless the user picked a
// column that is not one of them. Returns { headerRow, headers, idIndex, idIndexes, joined, errorIndex, idColumn,
// errorColumn, how: { id, error }, otherErrorColumns } or { error, status: 422, needsColumns: true, headers }.
export function detectRejectionColumns(rows, want) {
  const idWanted = String(want.idColumn || want.idHeading || '');
  const idKey = headingKey(idWanted);
  const join = Array.isArray(want.joinHeadings) && want.joinHeadings.length > 1 ? want.joinHeadings.map(headingKey) : null;
  const joinRow = join && (!want.idColumn || join.includes(headingKey(want.idColumn)))
    ? rows.slice(0, HEADER_SCAN).findIndex(r => join.every(k => r.some(h => headingKey(h) === k))) : -1;
  let headerRow = joinRow >= 0 ? joinRow : rows.slice(0, HEADER_SCAN).findIndex(r => r.some(h => headingKey(h) === idKey && idKey));
  const found = headerRow >= 0;
  if (!found) headerRow = Math.max(0, rows.slice(0, HEADER_SCAN).findIndex(r => r.filter(c => String(c).trim()).length >= 2));
  const headers = headingsOf(rows[headerRow]);
  const needs = error => ({ error, status: 422, needsColumns: true, headers: headers.filter(Boolean) });
  const idIndexes = joinRow >= 0 ? join.map(k => headers.findIndex(h => headingKey(h) === k)) : found ? [headers.findIndex(h => headingKey(h) === idKey)] : [];
  const idIndex = idIndexes.length ? idIndexes[idIndexes.length - 1] : -1;
  // the error column
  let errorIndex = -1, howError = '';
  if (want.errorColumn) {
    errorIndex = headers.findIndex(h => headingKey(h) === headingKey(want.errorColumn));
    if (errorIndex < 0) return needs(`The column "${want.errorColumn}" chosen as the error column is not in the file. Found: ${headers.filter(Boolean).join(', ') || 'nothing'}.`);
    howError = 'chosen by you';
  } else {
    for (const re of ERROR_HEADINGS) {
      errorIndex = headers.findIndex((h, i) => !idIndexes.includes(i) && re.test(h.toLowerCase()));
      if (errorIndex >= 0) break;
    }
    if (errorIndex < 0) return needs(`No error column found. Expected a column whose heading contains "error", "reason" or "message". Found: ${headers.filter(Boolean).join(', ') || 'nothing'}. Choose the column that holds Zoho's message.`);
    howError = 'found by its heading';
  }
  if (!found) {
    return needs(want.idColumn
      ? `The column "${want.idColumn}" chosen as the identifying column is not in the file. Found: ${headers.filter(Boolean).join(', ') || 'nothing'}.`
      : `The file has no "${want.idHeading}" column, so rejected rows cannot be linked to the file. Choose the column that holds "${want.idHeading}".`);
  }
  if (idIndexes.includes(errorIndex)) return needs('The identifying column and the error column must be different columns.');
  const otherErrorColumns = want.errorColumn ? [] : headers.filter((h, i) => i !== errorIndex && !idIndexes.includes(i) && ERROR_HEADINGS.some(re => re.test(h.toLowerCase())));
  const joined = joinRow >= 0;
  return { headerRow, headers, idIndex, idIndexes, joined, errorIndex, idColumn: joined ? idIndexes.map(i => headers[i]).join(' + ') : headers[idIndex], errorColumn: headers[errorIndex],
    how: { id: joined ? 'these columns together are the number of the record' : want.idColumn ? 'chosen by you' : headers[idIndex] === want.idHeading ? 'the heading of the file you imported' : `the heading of the file you imported, written "${headers[idIndex]}"`, error: howError },
    otherErrorColumns };
}

// The records of an error file: one per identifier (Zoho may list every line of a document), with every different
// message given for it. Returns { records: [{ ident, messages: [text], values: [cell text of its rows], rowNumbers,
// followOnColumns }], blankIdent }.
// ident: the identifying column, or the identifying columns joined (cols.idIndexes: a journal's prefix and suffix, so
// RCT-1 and PMT-1 stay two records).
// rowNumbers: Zoho's ROWNUMBER of each of its rows, when the file has that column (the heading row is row 1).
// "This error is related to Row N - <column>." is not a message of its own (it points at the line with the real
// error): it is kept only when the record has no other message. followOnColumns: the columns those lines name.
const FOLLOW_ON = /^This error is related to Row \d+/i;
const FOLLOW_ON_COLUMN = /^This error is related to Row \d+\s*-\s*(.+?)\.?\s*$/i;
export function rejectionRecords(rows, cols) {
  const byIdent = new Map();
  let blankIdent = 0;
  const rowIndex = (rows[cols.headerRow] || []).findIndex(h => headingKey(h) === 'rownumber');
  const idIndexes = cols.idIndexes?.length ? cols.idIndexes : [cols.idIndex];
  for (const r of rows.slice(cols.headerRow + 1)) {
    const ident = idIndexes.map(i => cell(r, i)).join('');
    const msg = cell(r, cols.errorIndex);
    if (!ident) { if (msg) blankIdent++; continue; }
    const k = ident.toLowerCase();
    if (!byIdent.has(k)) byIdent.set(k, { ident, messages: [], followOn: [], followOnColumns: [], values: new Set(), rowNumbers: [] });
    const e = byIdent.get(k);
    if (msg && FOLLOW_ON.test(msg)) {
      if (!e.followOn.includes(msg)) e.followOn.push(msg);
      const column = String(FOLLOW_ON_COLUMN.exec(msg)?.[1] || '').trim();
      if (column && !e.followOnColumns.includes(column)) e.followOnColumns.push(column);
    } else if (msg && !e.messages.includes(msg)) e.messages.push(msg);
    const n = rowIndex >= 0 && !idIndexes.includes(rowIndex) && rowIndex !== cols.errorIndex ? Number(cell(r, rowIndex)) : NaN;
    if (Number.isInteger(n) && n > 1) e.rowNumbers.push(n);
    r.forEach((c, i) => { if (i !== cols.errorIndex && i !== rowIndex && String(c).trim().length >= 3) e.values.add(String(c).trim()); });
  }
  return { records: [...byIdent.values()].map(({ followOn, ...e }) => ({ ...e, messages: e.messages.length ? e.messages : followOn, values: [...e.values] })), blankIdent };
}

// The cause of one message of a record, for the grouping by cause. "Invalid row" alone says nothing; the other lines of
// the same document name the column at fault ("This error is related to Row N - Contact Name."), so that column is
// part of the cause: "invalid row (contact name)" and "invalid row (account)" are two causes with two different fixes.
export function causeOfRecord(message, record) {
  const cause = causeOf(message, [record.ident, ...(record.values || [])]);
  const columns = record.followOnColumns || [];
  return /^invalid row\b/i.test(String(message || '').trim()) && columns.length ? `${cause} (${columns.map(c => c.toLowerCase()).join(', ')})` : cause;
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// The cause of a message: the message without what is particular to one record. values: the record's own cell values
// (its identifier, name, amounts...), replaced first, longest first.
export function causeOf(message, values = []) {
  let s = String(message ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ');
  for (const v of [...values].filter(x => x && x.length >= 3).sort((a, b) => b.length - a.length)) {
    s = s.replace(new RegExp(escapeRe(v), 'gi'), '…');
  }
  s = s.replace(/"[^"]{0,200}"|“[^”]{0,200}”|‘[^’]{0,200}’/g, '"…"')
    .replace(/(^|[\s(:=])'[^']{1,200}'(?=$|[\s).,:;])/g, '$1"…"')
    .replace(/\b\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/gi, '<GSTIN>')
    .replace(/\S+@\S+\.\S+/g, '<e-mail>')
    .replace(/\d+(?:[.,/-]\d+)*/g, '#')
    .replace(/…(\s*…)+/g, '…')
    .replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
  return s.toLowerCase() || '(no message)';
}

// Where each kind of cause is fixed. screen / anchor: the place in the platform (as the Prepare migration checklist).
const PLACES = {
  contact_fixes: { screen: 'screen-19', anchor: 'ms-fix-contacts', place: 'Mapping Studio, Fix contacts' },
  names: { screen: 'screen-19', anchor: 'ms-names', place: 'Mapping Studio, Names' },
  builtin_accounts: { screen: 'screen-19', anchor: 'ms-zoho-accounts', place: "Mapping Studio, Zoho's own accounts" },
  item_rates: { screen: 'screen-19', anchor: 'ms-item-rates', place: 'Mapping Studio, Rates' },
  tax_mapping: { screen: 'screen-19', anchor: 'ms-tax-mapping', place: 'Mapping Studio, Tax mapping' },
  tds_mapping: { screen: 'screen-19', anchor: 'ms-tds-mapping', place: 'Mapping Studio, TDS mapping' },
  account_types: { screen: 'screen-19', anchor: 'ms-account-types', place: 'Mapping Studio, Account types' },
  units: { screen: 'screen-19', anchor: 'ms-units', place: 'Mapping Studio, Units' },
  journal_routing: { screen: 'screen-20', anchor: 'journal-review', place: 'Voucher Classification' },
  import_order: { screen: 'screen-40', anchor: null, place: 'Import Wizard' },
  gst_codes: { screen: 'screen-32', anchor: 'gst-codes', place: 'Company Settings, GST treatment codes' },
  by_hand: { screen: null, anchor: null, place: 'Rejection Manager (below)' },
};
const CONTACT_FILES = ['customers', 'vendors'];
const VOUCHER_FILES = ['invoices', 'bills', 'journals', 'opening_balances_for_zoho_accounts'];

// ONE suggested action for a cause, from the words of the message and the file it came from. The first rule that fits
// wins; when none fits, the record is corrected by hand here. Returns { code, words, screen, anchor, place }.
export function suggestAction(cause, fileKey) {
  const c = String(cause || '').toLowerCase();
  const isContactFile = CONTACT_FILES.includes(fileKey), isVoucher = VOUCHER_FILES.includes(fileKey);
  const act = (code, place, words) => ({ code, words, ...PLACES[place] });
  if (/gst treatment/.test(c) && /invalid|not valid|not supported|allowed|accepted/.test(c)) {
    return act('gst_codes', 'gst_codes', 'Zoho did not accept the GST Treatment code. If every contact is refused this way, an admin switches the set of GST treatment codes once in Company Settings; then create the files again.');
  }
  if (fileKey !== 'items' && /gstin|gst identification|gst treatment|gst registration|place of (supply|contact)|source of supply|destination of supply|(?<!(intra|inter)[ -]?)\bstate\b|billing state/.test(c)) {
    return act('contact_fixes', 'contact_fixes', 'Correct the GSTIN, the GST treatment or the state of these contacts in Fix contacts (the Tally data is not changed), create the files again, and import the Customers or Vendors file before the documents again.');
  }
  if (/\btds\b|tax deducted/.test(c)) return act('tds_mapping', 'tds_mapping', 'Check the TDS mapping: the TDS tax must exist in Zoho Books with exactly the name chosen there. Then create the Bills file again.');
  if (/hidden|special character|invalid character|line break|newline/.test(c)) return act('names', 'names', 'Clean the names with hidden characters in Names, so the same cleaned name is written in every file.');
  if (/(already exists|duplicate|already been|already in use|already used|exists already)/.test(c)) {
    if (fileKey === 'accounts' || (/account/.test(c) && !isContactFile && !isVoucher)) {
      return act('builtin_accounts', 'builtin_accounts', "Zoho already has an account with this name. If an earlier import of this same file created it, nothing has to be done: do not rename it and do not type a balance (the opening balances are in the opening balance journal). If it is one of Zoho's own accounts, decide it under Zoho's own accounts: use Zoho's own account, or rename the Tally ledger.");
    }
    if (isContactFile) return act('names', 'names', 'Two contacts have the same name, or the contact is already in Zoho Books. Decide it under Names, Possible duplicates. If the contact was imported in an earlier attempt, no retry is needed: check it in Zoho Books.');
    if (isVoucher) return act('by_hand', 'by_hand', 'The document is already in Zoho Books, probably from an earlier import attempt. No retry is needed: check it in Zoho Books and leave it out of the retry file.');
  }
  // "Invalid row" on a line whose other lines say "related to Row N - Contact Name": Zoho could not use the contact
  if (/^invalid row\b/.test(c) && /\((?:[^)]*,\s*)?(contact name|customer name|vendor name)\b/.test(c)) {
    return act('contact_missing', 'import_order', 'Zoho Books could not use the customer or vendor named on this line: it does not have that contact. The account is not the problem. Look for the contact in Zoho Books (Sales > Customers, or Purchases > Vendors). In the Import Wizard, on the Customers or Vendors step, upload Zoho\'s export of its contacts: the tool lists the contacts that are missing and gives a file with only those rows. Import that file (after the Migration Date is saved), then import the retry file of this journal.');
  }
  // the same message when the other lines name the Account column: the account is not in Zoho Books
  if (/^invalid row\b/.test(c) && /\((?:[^)]*,\s*)?account\b/.test(c)) {
    return act('builtin_accounts', 'builtin_accounts', "Zoho Books does not have the account named on this line. Import the Chart of Accounts first (Import Wizard) and clear every refused row there; check that ledgers named like Zoho's own accounts are decided under Zoho's own accounts. Then import the retry file.");
  }
  if (/(customer|vendor|contact)/.test(c) && /(not found|does not exist|doesn't exist|not exist|invalid|not available|no such|unknown|not valid)/.test(c)) {
    return act('import_order', 'import_order', 'Zoho could not find the customer or vendor named on the document. Import the Customers and Vendors files first (Import Wizard), and check under Names that the name is written the same way in both files.');
  }
  if (/\btax(es)?\b|igst|cgst|sgst|gst rate|tax group|exemption/.test(c)) {
    if (fileKey === 'items') return act('item_rates', 'item_rates', 'Check the tax preference of these items under Rates: the intra-state and inter-state taxes must exist in Zoho Books with exactly these names.');
    return act('tax_mapping', 'tax_mapping', 'Check the tax mapping: the tax or tax group must exist in Zoho Books with exactly the name chosen there. Create it in Zoho Books, or choose another name, then create the files again.');
  }
  if (/account type/.test(c)) return act('account_types', 'account_types', 'Choose the Zoho account type of the Tally group under Account types, then create the Chart of Accounts again.');
  if (/\baccount\b/.test(c) && /(not found|does not exist|doesn't exist|not exist|invalid|inactive|no such|unknown)/.test(c)) {
    return act('builtin_accounts', 'builtin_accounts', "Zoho could not find the account. Import the Chart of Accounts first (Import Wizard), and check that ledgers named like Zoho's own accounts are decided under Zoho's own accounts.");
  }
  if (/\bitem\b/.test(c) && /(not found|does not exist|doesn't exist|not exist|no such|unknown)/.test(c)) return act('import_order', 'import_order', 'Import the Items file before the documents (Import Wizard).');
  if (fileKey === 'items' && /\b(rate|price|selling price|purchase price|cost)\b/.test(c)) return act('item_rates', 'item_rates', 'Enter the selling and purchase rates of these items under Rates, then create the Items file again.');
  if (fileKey === 'items' && /\bunit\b/.test(c)) return act('units', 'units', 'Map the Tally unit to a unit Zoho accepts under Units, then create the Items file again.');
  if (/journal|debit|credit|not balanced|balance/.test(c) && fileKey === 'journals') {
    return act('journal_routing', 'journal_routing', 'Check how these journal vouchers are routed in Voucher Classification (Invoice, Bill or Manual Journal), then create the files again.');
  }
  return act('by_hand', 'by_hand', 'Correct the value in the rejected record below, approve the correction with its reason, and create the retry file.');
}

// Groups the stored rejections of a migration by cause. rejections: [{ id, key, module, ident, status, causes: [cause],
// messages: [text] }]. Returns [{ key, module, cause, example, records, open, idents (first 20), action }], the largest first.
export function groupRejections(rejections) {
  const groups = new Map();
  for (const r of rejections) {
    r.causes.forEach((cause, i) => {
      const k = `${r.key}|${cause}`;
      if (!groups.has(k)) groups.set(k, { key: r.key, module: r.module, cause, example: r.messages[i] || r.messages[0] || '', ids: [], idents: [], open: 0 });
      const g = groups.get(k);
      if (g.ids.includes(r.id)) return;
      g.ids.push(r.id); g.idents.push(r.ident);
      if (r.status === 'open' || r.status === 'unlinked') g.open++;
    });
  }
  return [...groups.values()].map(g => ({ key: g.key, module: g.module, cause: g.cause, example: g.example, records: g.ids.length, open: g.open,
    rejectionIds: g.ids, idents: g.idents.slice(0, 20), action: suggestAction(g.cause, g.key) }))
    .sort((a, b) => b.records - a.records || a.module.localeCompare(b.module) || a.cause.localeCompare(b.cause));
}

// ---------- Zoho's real error file, explained by root cause (docs/ZOHO_IMPORT_RULES.md, section 11) ----------
// CONFIRMED by the first test import: the error file is the imported file with two columns in front, ROWNUMBER (the
// heading row is row 1) and ERRORMESSAGE; Zoho gives ONE message per row; when one line of a document is wrong, that
// line carries the real message and every other line says "This error is related to Row N - <column>."
//
// zohoErrorRows reads such a file into small rows that can be stored. explainErrorRows then groups them by ROOT CAUSE
// (the rule of zohorules.json that Zoho's message belongs to, lists.error_messages), keeps the real errors apart from
// the follow-on rows, and finds CASCADES: a row refused only because the account, customer, vendor or item it names
// was itself refused in an earlier import (in the first import all 234 bank journals failed that way).

const REFERENCE_COLUMNS = ['Account', 'Customer Name', 'Vendor Name', 'Contact Name', 'Item Name', 'Parent Account'];
const MASTER_FILES = ['accounts', 'customers', 'vendors', 'items'];
const idColumnOf = key => RULES.modules[key]?.id_column || null;
const docColumnsOf = key => (moduleRules(key) || []).find(r => r.kind === 'unique' && r.params?.scope === 'document')?.params.groupBy || null;

// table: [[cell]] (sheet.js). Returns { zohoLayout: false } when the file has no ROWNUMBER and ERRORMESSAGE columns,
// else { zohoLayout: true, headerRow, rows: [{ n, m, id, d, v }] }: Zoho's row number, the message, the value of the
// file's own name column (for a master file), the document the row belongs to, and the names the row refers to.
export function zohoErrorRows(table, key) {
  const headerRow = table.slice(0, HEADER_SCAN).findIndex(r => r.some(h => headingKey(h) === 'rownumber') && r.some(h => headingKey(h) === 'errormessage'));
  if (headerRow < 0) return { zohoLayout: false };
  const headers = headingsOf(table[headerRow]);
  const at = name => headers.findIndex(h => h === name);
  const nI = headers.findIndex(h => headingKey(h) === 'rownumber'), mI = headers.findIndex(h => headingKey(h) === 'errormessage');
  const idI = MASTER_FILES.includes(key) ? at(idColumnOf(key)) : -1;
  const docI = (docColumnsOf(key) || []).map(at);
  const refI = REFERENCE_COLUMNS.map(c => [c, at(c)]).filter(([, i]) => i >= 0 && i !== idI);
  const rows = [];
  for (const r of table.slice(headerRow + 1)) {
    const n = Number(cell(r, nI)), m = cell(r, mI);
    if (!Number.isInteger(n) || !m) continue;
    const row = { n, m };
    if (idI >= 0) row.id = cell(r, idI);
    if (docI.length && docI.every(i => i >= 0)) row.d = docI.map(i => cell(r, i)).join('\u0001');
    const v = {};
    for (const [c, i] of refI) if (cell(r, i)) v[c] = cell(r, i);
    if (Object.keys(v).length) row.v = v;
    rows.push(row);
  }
  return { zohoLayout: true, headerRow, rows };
}

const messagePatterns = new Map(); // file key -> [{ entry, re, followOn }]
function patternsFor(key) {
  if (!messagePatterns.has(key)) {
    messagePatterns.set(key, RULES.lists.error_messages.filter(e => e.modules.includes(key) || e.modules.includes('*'))
      .map(entry => ({ entry, re: new RegExp(entry.pattern, 'i'), followOn: !entry.rule_ids.length && /related to Row/i.test(entry.pattern) })));
  }
  return messagePatterns.get(key);
}
// The entry of lists.error_messages a message of a file belongs to: { entry, followOn, row, column }, or null.
// row and column: for a follow-on message, the row with the real error and the column Zoho names.
export function matchErrorMessage(key, message) {
  const text = String(message ?? '').trim();
  for (const p of patternsFor(key)) {
    const m = p.re.exec(text);
    if (!m) continue;
    return p.followOn ? { entry: p.entry, followOn: true, row: Number(m[1]), column: String(m[2] || '').trim() } : { entry: p.entry, followOn: false };
  }
  return null;
}
// A message without the figures of one row, so rows with the same message are one line on the screen.
const maskNumbers = s => String(s).replace(/\d[\d,]*(\.\d+)?/g, 'N');

// The names Zoho refused in a master file, for the cascade check: Map of name -> { message, ruleIds, meaning, fix }.
export function refusedNames(key, rows) {
  const out = new Map();
  for (const r of rows || []) {
    if (!r.id) continue;
    const hit = matchErrorMessage(key, r.m);
    out.set(r.id.trim(), { message: r.m, ruleIds: hit?.entry.rule_ids || [], meaning: hit?.entry.meaning || '', fix: hit?.entry.fix || '' });
  }
  return out;
}

// rows: from zohoErrorRows. refused: { accounts?: Map, customers?: Map, vendors?: Map, items?: Map } (refusedNames of
// the error files of the master files, when they were uploaded).
// Returns { key, module, rows, realErrors, followOn, cascadeRows, unassigned, documents, causes: [{ id, ruleIds,
//   zohoMessage, meaning, fix, place, evidence, column, rows, followOnRows, documents, rowNumbers (first 20),
//   assigned, cascade: null | { from, fromModule, names, zohoMessage, ruleIds, meaning, fix } }] }, the largest cause first.
// unassigned: rows whose message is not in lists.error_messages (each still gets a suggested action), and follow-on
// rows whose row with the real error is not in the file.
// zohoOwnNames (optional): a list of the account names Zoho Books made itself; without it the researched list is used
// (zohocodes.js builtinAccount). The Chart of Accounts export of the organisation is NOT passed here by the routes: an
// export taken after an import also lists the accounts that import created, and they would all look like Zoho's own.
// "Row already exists" on the Chart of Accounts has two very different causes, and they are kept apart (ALREADY_EXISTS):
//  - the name is one of Zoho's own accounts: decide it under Zoho's own accounts;
//  - any other name: the account is in Zoho Books already, almost always from an earlier import of this same file.
//    Nothing is to be done, and no balance is typed (typing it would count it twice when the first import set it).
const ALREADY_EXISTS_RULE = 'COA-NAME-NOT-ZOHO-ACCOUNT';
const ALREADY_EXISTS = {
  own: { meaning: "The name is the name of one of Zoho's own accounts: Zoho Books made that account itself, so the row is skipped.",
    fix: "Decide it under Zoho's own accounts: use Zoho's own account (the default), or rename the ledger. Do not type a balance: the tool writes the opening balance in the opening balance journal." },
  earlier: { meaning: "An account with this name is already in Zoho Books, and it is not one of Zoho's own accounts: an earlier import of this same Chart of Accounts file created it (or someone made it by hand). The row is skipped.",
    fix: 'Nothing to do for an account an earlier import created: do NOT rename the ledger, do NOT import it again, and do NOT type its opening balance (the opening balances are in the opening balance journal, not on the rows of this file). Only for an account with a balance in the Chart of Accounts file (the Import Wizard, step "Save the Migration Date", names it): open Settings > Setup & Configurations > Opening Balances and check that the balance is there. Enter it only if it is missing: that page sets the value, it does not add to it.' },
};

// ---------- "Invalid row" on a line of a document: the column at fault decides the cause ----------
// Zoho says only "Invalid row" on the line it could not read; the other lines of the same document name the column
// ("This error is related to Row N - Contact Name."). An entry of lists.error_messages can therefore carry rules per
// column (by_column: { "<column>": { rule_ids, meaning, fix, contact? } }), and the cause is chosen from the column
// Zoho names, never guessed. With no follow-on line (a document of one line, or every line wrong) the row's own values
// decide, when the names of the migration are known (known). When nothing decides, both causes are said.
//
// A contact column (contact: true): Zoho could not use the customer or vendor. Which case it is, is read from what the
// tool knows (known), so the person is never sent to import a contact that is already there:
//   known: { customers: Set, vendors: Set (the Display Names of the Customers and Vendors files, as contactNameKey),
//            accounts?: Set (accountNameKey of the Chart of Accounts file),
//            zoho?: { customers?: Set | null, vendors?: Set | null } (the names of Zoho's own export of its contacts,
//            given in the Import Wizard; null: not given) }
const CONTACT_SIDE = { 'accounts receivable': 'customers', 'accounts payable': 'vendors' };
const SIDE = {
  customers: { one: 'customer', many: 'customers', file: 'Customers', where: 'Sales > Customers', step: 'customers' },
  vendors: { one: 'vendor', many: 'vendors', file: 'Vendors', where: 'Purchases > Vendors', step: 'vendors' },
  either: { one: 'customer or vendor', many: 'customers and vendors', file: 'Customers or Vendors', where: 'Sales > Customers, or Purchases > Vendors', step: 'customers' },
};
const RETRY_WORDS = 'Then create the retry file here (Rejection Manager) and import it: it holds only the refused rows.';
const wizardStepPlace = (step, label) => ({ screen: PLACES.import_order.screen, anchor: null, params: { step }, label: `Import Wizard, ${label}` });
const sideOfColumn = (column, row) => (/^customer/i.test(column) ? 'customers' : /^vendor/i.test(column) ? 'vendors' : CONTACT_SIDE[String(row.v?.Account || '').trim().toLowerCase()] || null);
// The cause of an "Invalid row" whose column at fault is a contact column. Returns { variant, meaning, fix, place, name }.
//   check_zoho:      nothing says whether Zoho has the contact (no export given): look, and give the export
//   missing_in_zoho: the contact is in the file and NOT in Zoho's export: import the missing rows
//   in_zoho:         Zoho's export has the contact: it is there now, so only the retry is left
//   wrong_side:      a vendor on Accounts Receivable or a customer on Accounts Payable
//   not_in_files:    the name is in neither contact file of this migration
//   no_name:         the column Zoho names is empty on the line
export function contactCause(row, column, known, docWord = 'journal') {
  const name = String(row.v?.[column] || '').trim();
  const account = String(row.v?.Account || '').trim();
  const side = sideOfColumn(column, row);
  const w = SIDE[side || 'either'];
  const start = `Zoho Books could not use the ${w.one} named in ${column} on this line, so it refused the whole ${docWord}. The account is not the problem.`;
  if (!name) {
    return { variant: 'no_name', name, place: placeForRule('JRN-CONTACT-EXISTS', '', null),
      meaning: `Zoho Books names the column ${column}, and this line has no name in it. A line on Accounts Receivable needs the customer and a line on Accounts Payable needs the vendor.`,
      fix: 'Check how this voucher is entered in Voucher Classification, create the files again and import the file again.' };
  }
  const k = contactNameKey(name);
  const inFile = s => !!known?.[s]?.has(k);
  if (known?.customers && known?.vendors) {
    const here = side ? inFile(side) : inFile('customers') || inFile('vendors');
    const other = side ? (side === 'customers' ? 'vendors' : 'customers') : null;
    if (!here && other && inFile(other)) {
      return { variant: 'wrong_side', name, place: placeForRule('JRN-CONTACT-EXISTS', '', null),
        meaning: `This line is on ${account || 'an account'}, which takes a ${w.one}, but the name in ${column} is only in the ${SIDE[other].file} file. Zoho Books refuses a ${SIDE[other].one} on that account.`,
        fix: 'A line of a customer goes on Accounts Receivable and a line of a vendor on Accounts Payable. Check how this voucher is entered in Voucher Classification. If the party is both a customer and a vendor, it must be in both files. Then create the files again.' };
    }
    if (!here) {
      return { variant: 'not_in_files', name, place: wizardStepPlace(w.step, w.file),
        meaning: `${start} The name is not in the ${w.file} file of this migration, so Zoho Books cannot have it.`,
        fix: `Import the file as the tool wrote it: the tool writes the same name in every file. If the name was changed by hand, write it exactly as in the ${w.file} file. ${RETRY_WORDS}` };
    }
    const zoho = side ? known.zoho?.[side] : (known.zoho?.customers && known.zoho?.vendors ? new Set([...known.zoho.customers, ...known.zoho.vendors]) : null);
    if (zoho && !zoho.has(k)) {
      return { variant: 'missing_in_zoho', name, place: wizardStepPlace(w.step, w.file),
        meaning: `${start} The ${w.one} is in the ${w.file} file, but not in the export of Zoho Books you gave in the Import Wizard: the ${w.file} import did not create it.`,
        fix: `Import Wizard, step "Import ${w.file}": download the file with the missing rows and import it. Check first that the Migration Date is saved, so its opening balance gets the right date. ${RETRY_WORDS}` };
    }
    if (zoho) {
      return { variant: 'in_zoho', name, place: wizardStepPlace('date', 'Save the Migration Date'),
        meaning: `Zoho Books refused the ${docWord} because of the ${w.one} named in ${column}. The account is not the problem. That ${w.one} is in the export of Zoho Books you gave, so Zoho Books has it now.`,
        fix: `If the ${w.one} was added after this import, nothing more is wrong: create the retry file here and import it. If it was there all along, check that the Migration Date is saved (Import Wizard, step "Save the Migration Date") and that Zoho Books writes the name the same way. ${RETRY_WORDS}` };
    }
  }
  return { variant: 'check_zoho', name, place: wizardStepPlace(w.step, w.file),
    meaning: `${start} ${known?.customers ? `The ${w.one} is in the ${w.file} file of this migration, so most likely` : 'Most likely'} the ${w.file} import did not create it in Zoho Books. In a test import Zoho Books showed every row as ready in its preview and still left one customer out.`,
    fix: `Look for it in Zoho Books (${w.where}). In the Import Wizard, step "Import ${w.file}", upload Zoho's export of its ${w.many}: the tool lists every one that is missing and gives a file with only those rows. Check that the Migration Date is saved, then import that file. ${RETRY_WORDS}` };
}
// The by_column part of an entry that fits one row: { column, part } or null. columnNamed: the column the follow-on
// rows of this row name (undefined when there is none).
function columnPart(entry, row, columnNamed, known) {
  const by = entry.by_column;
  if (!by) return null;
  const find = name => { const k = Object.keys(by).find(c => c.toLowerCase() === String(name || '').trim().toLowerCase()); return k ? { column: k, part: by[k] } : null; };
  if (columnNamed) return find(columnNamed);
  // no other line names a column: the row's own values decide
  const accountCol = Object.keys(by).find(c => !by[c].contact && row.v?.[c]);
  const contactCol = Object.keys(by).find(c => by[c].contact && String(row.v?.[c] || '').trim());
  if (!contactCol) return accountCol ? find(accountCol) : null; // a line with no contact: only the account can be wrong
  if (known?.accounts && accountCol) {
    const a = String(row.v[accountCol]).trim();
    if (!known.accounts.has(accountNameKey(a)) && !builtinAccount(a)) return find(accountCol);
    if (known.customers && known.vendors) return find(contactCol); // the account is known, so it is the contact
  }
  return null;
}

export function explainErrorRows(rows, { key, refused = {}, zohoOwnNames = null, known = null } = {}) {
  const ruleIds = new Set((moduleRules(key) || []).map(r => r.id));
  const ownKeys = zohoOwnNames ? new Set(zohoOwnNames.map(accountNameKey)) : null;
  const isZohoOwn = name => (ownKeys ? ownKeys.has(accountNameKey(name)) : !!builtinAccount(name));
  const causes = new Map();
  const causeOfRow = new Map(); // Zoho row number -> cause id
  const pending = [];
  const get = (id, make) => { if (!causes.has(id)) causes.set(id, { id, rows: 0, followOnRows: 0, docs: new Set(), rowNumbers: [], names: new Set(), columns: new Set(), ...make() }); return causes.get(id); };
  let realErrors = 0, followOn = 0, unassigned = 0, cascadeRows = 0;
  const docs = new Set();
  // first what the follow-on rows say: the column at fault of each row with a real error
  const hits = rows.map(r => matchErrorMessage(key, r.m));
  const columnNamed = new Map();
  rows.forEach((r, i) => { const h = hits[i]; if (h?.followOn && h.column && !columnNamed.has(h.row)) columnNamed.set(h.row, h.column); });
  const docWord = /journal/i.test(RULES.modules[key]?.one_row_is || '') ? 'journal' : 'document';
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.d) docs.add(r.d);
    const hit = hits[i];
    if (hit?.followOn) { pending.push({ r, hit }); continue; }
    realErrors++;
    let c;
    if (!hit) {
      const cause = causeOf(r.m, [r.id || '', ...Object.values(r.v || {})]);
      const action = suggestAction(cause, key);
      c = get(`unknown:${cause}`, () => ({ ruleIds: [], zohoMessage: maskNumbers(r.m), meaning: 'This message is not in the list of Zoho messages the tool knows yet.', fix: action.words,
        place: { screen: action.screen, anchor: action.anchor, label: action.place }, evidence: null, assigned: false, cascade: null }));
      unassigned++;
    } else {
      // an entry with rules per column: the column Zoho names (or the row's own values) chooses the part
      const part = columnPart(hit.entry, r, columnNamed.get(r.n), known);
      const entry = part ? { ...hit.entry, ...part.part } : hit.entry;
      const own = entry.rule_ids.filter(id => ruleIds.has(id));
      const mine = own.length ? own : entry.rule_ids;
      // a cascade: the rule is "the name must exist", and the name is one Zoho refused in an earlier file
      let cascade = null;
      for (const id of mine) {
        const rule = ruleById(id);
        if (rule?.kind !== 'reference' || !rule.params?.target) continue;
        const value = (r.v?.[rule.columns[0]] || '').trim();
        if (!value) continue;
        for (const t of [].concat(rule.params.target)) {
          const from = t.split('.')[0];
          const was = refused[from]?.get(value);
          if (was) { cascade = { from, value, was }; break; }
        }
        if (cascade) break;
      }
      if (cascade) {
        cascadeRows++;
        const w = cascade.was;
        const fromModule = moduleLabel(cascade.from);
        c = get(`${mine[0] || hit.entry.pattern}<-${cascade.from}:${maskNumbers(w.message)}`, () => ({ ruleIds: mine, zohoMessage: maskNumbers(r.m),
          meaning: `Refused only because a name on the row was itself refused in the ${fromModule} import (Zoho said: "${maskNumbers(w.message)}"). Nothing is wrong with these rows.`,
          fix: `Correct the ${fromModule} rows first${w.fix ? `: ${w.fix}` : '.'} Then import this file again as it is.`,
          place: placeForRule(w.ruleIds[0] || mine[0] || '', '', null), evidence: hit.entry.evidence, assigned: true,
          cascade: { from: cascade.from, fromModule, zohoMessage: maskNumbers(w.message), ruleIds: w.ruleIds, meaning: w.meaning, fix: w.fix } }));
        c.names.add(cascade.value);
      } else if (key === 'accounts' && mine.includes(ALREADY_EXISTS_RULE) && r.id) {
        const own = isZohoOwn(r.id);
        const words = own ? ALREADY_EXISTS.own : ALREADY_EXISTS.earlier;
        c = get(`${mine.join('+')}${own ? '' : ':earlier-import'}`, () => ({ ruleIds: mine, zohoMessage: maskNumbers(r.m), meaning: words.meaning, fix: words.fix,
          place: own ? placeForRule(mine[0] || '', '', null) : { screen: PLACES.import_order.screen, anchor: PLACES.import_order.anchor, label: PLACES.import_order.place },
          evidence: hit.entry.evidence, assigned: true, cascade: null, alreadyExists: own ? 'zoho_own_account' : 'earlier_import' }));
      } else if (part?.part.contact) {
        // the contact column: what the tool knows about the name decides the words (contactCause)
        const cc = contactCause(r, part.column, known, docWord);
        c = get(`${mine.join('+') || hit.entry.pattern}:${cc.variant}`, () => ({ ruleIds: mine, zohoMessage: maskNumbers(r.m), meaning: cc.meaning, fix: cc.fix,
          place: cc.place, evidence: hit.entry.evidence, assigned: true, cascade: null, contact: cc.variant, zohoColumn: part.column }));
        if (cc.name) c.names.add(cc.name);
      } else {
        c = get(mine.join('+') || hit.entry.pattern, () => ({ ruleIds: mine, zohoMessage: maskNumbers(r.m), meaning: entry.meaning, fix: entry.fix,
          place: placeForRule(mine[0] || '', '', null), evidence: hit.entry.evidence, assigned: true, cascade: null, ...(part ? { zohoColumn: part.column } : {}) }));
      }
      for (const id of mine) for (const col of ruleById(id)?.columns || []) if (col !== '*') c.columns.add(col);
    }
    c.rows++;
    if (r.d) c.docs.add(r.d);
    if (c.rowNumbers.length < 20) c.rowNumbers.push(r.n);
    causeOfRow.set(r.n, c.id);
  }
  for (const { r, hit } of pending) {
    followOn++;
    const c = causes.get(causeOfRow.get(hit.row));
    if (c) { c.followOnRows++; if (hit.column) c.zohoColumn = hit.column; if (r.d) c.docs.add(r.d); continue; }
    unassigned++;
    const o = get('follow-on-without-its-row', () => ({ ruleIds: [], zohoMessage: 'This error is related to Row N', meaning: 'These rows point at another row of the file for the real error, and that row is not in the error file.',
      fix: 'Open the row named in the message in the file you imported and read the column it names.', place: { screen: null, anchor: null, label: 'The file you imported' }, evidence: null, assigned: false, cascade: null }));
    o.followOnRows++;
  }
  // names: the names at fault (a contact Zoho does not have, a name refused in an earlier file), the first 20
  const list = [...causes.values()].map(({ docs: d, names, columns, zohoColumn, ...c }) => ({ ...c, documents: d.size, column: zohoColumn || [...columns].join(', ') || null,
    ...(names.size ? { names: [...names].slice(0, 20), nameCount: names.size } : {}),
    cascade: c.cascade ? { ...c.cascade, names: names.size } : null }))
    .sort((a, b) => (b.rows + b.followOnRows) - (a.rows + a.followOnRows) || a.id.localeCompare(b.id));
  // every refused row says "already exists", and most names are not Zoho's own: the same file was imported before
  const earlier = list.filter(c => c.alreadyExists === 'earlier_import').reduce((t, c) => t + c.rows, 0);
  const exists = list.filter(c => c.alreadyExists).reduce((t, c) => t + c.rows, 0);
  const note = key === 'accounts' && realErrors > 0 && exists === realErrors && earlier * 2 > realErrors
    ? `This looks like a second import of the same Chart of Accounts file: ${earlier} of the ${realErrors} refused rows are accounts an earlier import already created. Nothing is lost and nothing has to be typed.` : null;
  return { key, module: moduleLabel(key), rows: rows.length, realErrors, followOn, cascadeRows, unassigned, documents: docs.size, causes: list, ...(note ? { note } : {}) };
}

// Both steps at once, for a file just read (the replay script and the tests). opts: { key, refused, known } or
// { key, refusedAccounts: Map of account name -> Zoho's message }.
export function explainErrorFile(table, opts) {
  const read = zohoErrorRows(table, opts.key);
  if (!read.zohoLayout) return { zohoLayout: false };
  const refused = opts.refused || (opts.refusedAccounts ? { accounts: refusedNames('accounts', [...opts.refusedAccounts].map(([id, m]) => ({ id, m }))) } : {});
  return { zohoLayout: true, ...explainErrorRows(read.rows, { key: opts.key, refused, known: opts.known || null }) };
}
