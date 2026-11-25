// DID THE MASTERS REALLY ARRIVE IN ZOHO BOOKS? (Import Wizard, after each master file.)
//
// Why: in the third test import Zoho's preview said every customer row was ready, and Zoho then created one customer
// fewer than the file had. Nothing told the person. Its opening balance was missing from Accounts Receivable, and the
// one journal that named that customer was refused much later with "Invalid row". The wizard had only the number the
// person typed from the preview. So the wizard now CHECKS what Zoho Books holds:
//
//  - the person gives Zoho's own export of the Chart of Accounts, Customers, Vendors or Items taken AFTER the import
//    (or whoever can read Zoho Books sends the list of names: source 'zoho_api');
//  - the names of the export are compared with the names of the file. Names are compared the way Zoho keeps them:
//    without spaces around them, runs of spaces and line breaks as one space, without capital letters
//    (zohocodes.js contactNameKey; accounts as accountNameKey). The files themselves are never changed;
//  - every name of the file that the export does not have is listed, with the row of the file, and a CSV with ONLY
//    those rows (the same columns, the same values, the Opening Balance too) is offered for import;
//  - the later steps of the wizard stay locked while a name is missing, and the Zoho check marks every row of a later
//    file that names a missing contact or account as "will be refused".
//
// This is kept apart from the Chart of Accounts export of the SET-UP step (importwizard.js zoho_existing_accounts):
// that one is taken before the first import and says which accounts Zoho made itself. An export taken after the import
// also lists the accounts the import created, so it must never be read as "Zoho's own accounts".
//
// Nothing here knows a company: the kinds, the column ids and the click paths are the only fixed things.
import { readTable, headingKey } from './sheet.js';
import { accountNameKey, contactNameKey } from './zohocodes.js';
import { ALL_FILES, defaultColumns, csvFor } from './columns.js';

// kind: the file key. nameId: the column id of the name in the generated file. headings: the heading (as headingKey)
// of the name column in Zoho's export, in order of preference. typeHeadings / typeValue: a column that says which kind
// of contact a row is, when one export holds customers and vendors together.
export const VERIFY_KINDS = {
  accounts: { nameId: 'account_name', headings: ['accountname', 'account'], keyOf: accountNameKey, one: 'account', many: 'accounts',
    listPath: 'Accountant > Chart of Accounts', exportPath: 'Accountant > Chart of Accounts > More (three dots, top right) > Export Chart of Accounts', column: 'Account Name' },
  customers: { nameId: 'display_name', headings: ['displayname', 'customername', 'contactname', 'name'], keyOf: contactNameKey, one: 'customer', many: 'customers', typeValue: /customer/i,
    listPath: 'Sales > Customers', exportPath: 'Sales > Customers > More (three dots, top right) > Export Customers', column: 'Display Name' },
  vendors: { nameId: 'display_name', headings: ['displayname', 'vendorname', 'contactname', 'name'], keyOf: contactNameKey, one: 'vendor', many: 'vendors', typeValue: /vendor|supplier/i,
    listPath: 'Purchases > Vendors', exportPath: 'Purchases > Vendors > More (three dots, top right) > Export Vendors', column: 'Display Name' },
  items: { nameId: 'item_name', headings: ['itemname', 'name'], keyOf: contactNameKey, one: 'item', many: 'items',
    listPath: 'Items', exportPath: 'Items > More (three dots, top right) > Export Items', column: 'Item Name' },
};
export const isVerifyKind = kind => Object.prototype.hasOwnProperty.call(VERIFY_KINDS, kind);
const TYPE_HEADINGS = ['contacttype', 'type'];
const BALANCE_HEADINGS = ['openingbalance'];
const HEADER_SCAN = 20;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function setupZohoVerify(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS zoho_arrived (job_id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, name_key TEXT NOT NULL, opening_balance TEXT, PRIMARY KEY (job_id, kind, name_key));
    CREATE TABLE IF NOT EXISTS zoho_arrived_meta (job_id TEXT NOT NULL, kind TEXT NOT NULL, file_name TEXT, records INTEGER, source TEXT, uploaded_by TEXT, at TEXT, PRIMARY KEY (job_id, kind));
  `);
}

// Reads Zoho's export of one kind (CSV, XLSX or XLS). The heading row is the first of the first 20 rows that holds a
// name column of the kind. When the export has a contact type column, only the rows of the kind asked for are kept.
// Returns { names: [{ name, openingBalance }], format, column, leftOut } or { error }.
export function readZohoExport(buf, kind) {
  const k = VERIFY_KINDS[kind];
  if (!k) return { error: 'That list cannot be checked against Zoho Books.' };
  const table = readTable(buf);
  if (table.error) return { error: table.error };
  let headerRow = -1, nameIndex = -1;
  for (const want of k.headings) {
    headerRow = table.rows.slice(0, HEADER_SCAN).findIndex(r => r.some(c => headingKey(c) === want));
    if (headerRow >= 0) { nameIndex = table.rows[headerRow].findIndex(c => headingKey(c) === want); break; }
  }
  if (headerRow < 0) return { error: `The file has no "${k.column}" column. Export it from Zoho Books: ${k.exportPath}.` };
  const head = table.rows[headerRow];
  const typeIndex = k.typeValue ? head.findIndex(c => TYPE_HEADINGS.includes(headingKey(c))) : -1;
  const balanceIndex = head.findIndex(c => BALANCE_HEADINGS.includes(headingKey(c)));
  const seen = new Set(), names = [];
  let leftOut = 0;
  // a type column counts only when it really says customer or vendor somewhere (a column "Type" can mean anything)
  const typed = typeIndex >= 0 && table.rows.slice(headerRow + 1).some(r => /customer|vendor|supplier/i.test(String(r[typeIndex] ?? '')));
  for (const r of table.rows.slice(headerRow + 1)) {
    const name = String(r[nameIndex] ?? '');
    const key = k.keyOf(name);
    if (!key) continue;
    if (typed && String(r[typeIndex] ?? '').trim() && !k.typeValue.test(String(r[typeIndex]))) { leftOut++; continue; }
    if (seen.has(key)) continue;
    seen.add(key);
    names.push({ name: name.trim(), openingBalance: balanceIndex >= 0 ? String(r[balanceIndex] ?? '').trim() : '' });
  }
  if (!names.length) return { error: `The file has a "${String(head[nameIndex]).trim()}" column but no ${k.one} in it.` };
  return { names, format: table.format, column: String(head[nameIndex]).trim(), leftOut };
}

// Keeps the names Zoho Books holds for one kind (replacing what was kept). names: [{ name, openingBalance? }] or [name].
export function storeArrived(db, jobId, kind, names, { fileName = null, source = 'zoho_export', by = null, at = new Date().toISOString() } = {}) {
  const k = VERIFY_KINDS[kind];
  db.prepare('DELETE FROM zoho_arrived WHERE job_id = ? AND kind = ?').run(jobId, kind);
  const ins = db.prepare('INSERT OR IGNORE INTO zoho_arrived (job_id, kind, name, name_key, opening_balance) VALUES (?,?,?,?,?)');
  let n = 0;
  for (const x of names) {
    const name = String(typeof x === 'string' ? x : x?.name ?? '').trim();
    const key = k.keyOf(name);
    if (!key) continue;
    n += ins.run(jobId, kind, name, key, typeof x === 'string' ? null : String(x.openingBalance ?? '').trim() || null).changes;
  }
  db.prepare('INSERT OR REPLACE INTO zoho_arrived_meta (job_id, kind, file_name, records, source, uploaded_by, at) VALUES (?,?,?,?,?,?,?)').run(jobId, kind, fileName, n, source, by, at);
  return n;
}
export function removeArrived(db, jobId, kind) {
  db.prepare('DELETE FROM zoho_arrived WHERE job_id = ? AND kind = ?').run(jobId, kind);
  return db.prepare('DELETE FROM zoho_arrived_meta WHERE job_id = ? AND kind = ?').run(jobId, kind).changes > 0;
}

const tableThere = (db, name) => { try { return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name); } catch { return false; } };
// What Zoho Books holds for one kind, as given: { given, keys: Set, fileName, records, source, by, at } (given false: nothing was given).
export function arrivedOf(db, jobId, kind) {
  if (!tableThere(db, 'zoho_arrived_meta')) return { given: false, keys: null };
  const meta = db.prepare('SELECT * FROM zoho_arrived_meta WHERE job_id = ? AND kind = ?').get(jobId, kind);
  if (!meta) return { given: false, keys: null };
  const rows = db.prepare('SELECT name, name_key, opening_balance FROM zoho_arrived WHERE job_id = ? AND kind = ?').all(jobId, kind);
  return { given: true, keys: new Set(rows.map(r => r.name_key)), names: new Map(rows.map(r => [r.name_key, r])), fileName: meta.file_name, records: meta.records, source: meta.source || 'zoho_export', by: meta.uploaded_by, at: meta.at };
}
// For the Zoho check and the Rejection Manager: { accounts?: [key], customers?: [key], vendors?: [key], items?: [key] },
// only the kinds that were given (sorted, so the result is the same each time).
export function arrivedKeys(db, jobId) {
  const out = {};
  for (const kind of Object.keys(VERIFY_KINDS)) { const a = arrivedOf(db, jobId, kind); if (a.given) out[kind] = [...a.keys].sort(); }
  return out;
}

const rowsOf = (db, jobId, key) => { try { return db.prepare('SELECT row_no, row_data, ident FROM generated_rows WHERE job_id = ? AND key = ? ORDER BY row_no').all(jobId, key); } catch { return []; } };
const valuesOf = g => { try { return JSON.parse(g.row_data || '{}') || {}; } catch { return {}; } };
const amount = v => { const n = Number(String(v ?? '').replace(/,/g, '').trim()); return Number.isFinite(n) ? n : 0; };

// The names of one master file as created: [{ rowNo, name, key, openingBalance }], one per different name (the first
// row that carries it: Zoho imports the first and treats a later one as a duplicate).
export function fileNames(db, jobId, kind) {
  const k = VERIFY_KINDS[kind];
  const seen = new Set(), out = [];
  for (const g of rowsOf(db, jobId, kind)) {
    const v = valuesOf(g);
    const name = String(v[k.nameId] ?? g.ident ?? '');
    const key = k.keyOf(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ rowNo: g.row_no, name, key, openingBalance: String(v.opening_balance ?? '').trim() });
  }
  return out;
}
// How many different records the file of a master kind holds (what Zoho Books must show after the import).
export const expectedMasterRecords = (db, jobId, kind) => fileNames(db, jobId, kind).length;

// The check of one master file against what Zoho Books holds.
// Returns { kind, one, many, expected, withBalance, given, fileName, records, source, by, at, found, missing: [{ rowNo,
//   fileRow (the row of the CSV: the heading row is row 1), name, openingBalance }], missingCount, missingWithBalance,
//   balanceDiffers: [{ name, file, zoho }], state: 'not_given' | 'all_there' | 'missing', words, exportPath, listPath }.
export function verifyMaster(db, jobId, kind) {
  const k = VERIFY_KINDS[kind];
  const names = fileNames(db, jobId, kind);
  const withBalance = names.filter(n => n.openingBalance !== '' && amount(n.openingBalance) !== 0).length;
  const base = { kind, one: k.one, many: k.many, expected: names.length, withBalance, exportPath: k.exportPath, listPath: k.listPath, column: k.column };
  const a = arrivedOf(db, jobId, kind);
  if (!a.given) {
    return { ...base, given: false, state: 'not_given', missing: [], missingCount: 0, missingWithBalance: 0, balanceDiffers: [],
      words: `After the import Zoho Books must list ${plural(names.length, k.one)} from this file (${k.listPath})${withBalance ? `, ${withBalance} of them with an opening balance` : ''}. To be sure, export them from Zoho Books (${k.exportPath}) and upload the file here: the tool then checks every name.` };
  }
  const missing = names.filter(n => !a.keys.has(n.key)).map(n => ({ rowNo: n.rowNo, fileRow: n.rowNo + 1, name: n.name, openingBalance: n.openingBalance }));
  const missingWithBalance = missing.filter(m => m.openingBalance !== '' && amount(m.openingBalance) !== 0).length;
  // an opening balance that Zoho's export shows with another figure (only when the export carries the column)
  const balanceDiffers = [];
  for (const n of names) {
    const z = a.names.get(n.key);
    if (!z || z.opening_balance == null || z.opening_balance === '') continue;
    if (n.openingBalance !== '' && Math.abs(Math.abs(amount(z.opening_balance)) - Math.abs(amount(n.openingBalance))) > 0.004) balanceDiffers.push({ name: n.name, file: n.openingBalance, zoho: z.opening_balance });
  }
  const from = a.source === 'zoho_api' ? 'the list read from Zoho Books' : `Zoho's export${a.fileName ? ` "${a.fileName}"` : ''}`;
  const words = missing.length
    ? `${plural(missing.length, k.one)} of this file ${missing.length === 1 ? 'is' : 'are'} NOT in Zoho Books (${from} has ${plural(a.records, k.one)}; the file has ${names.length})${missingWithBalance ? `, ${missingWithBalance} of them with an opening balance` : ''}. Every later file that names ${missing.length === 1 ? 'it' : 'one of them'} would be refused. Download the file with only the missing ${missing.length === 1 ? 'row' : 'rows'} and import it, then export from Zoho Books again and upload the new export here.`
    : `All ${plural(names.length, k.one)} of this file are in Zoho Books (${from}).`;
  return { ...base, given: true, fileName: a.fileName, records: a.records, source: a.source, by: a.by, at: a.at, found: names.length - missing.length,
    missing, missingCount: missing.length, missingWithBalance, balanceDiffers, state: missing.length ? 'missing' : 'all_there', words };
}

// The CSV with ONLY the rows of a master file that Zoho Books does not have: the same columns, headings and values as
// the file that was imported (the Opening Balance too), so it can be imported as it is. null when nothing is missing
// or no export was given. Returns { csv, rows, fileName }.
export function missingRowsCsv(db, jobId, kind) {
  const v = verifyMaster(db, jobId, kind);
  if (!v.given || !v.missing.length) return null;
  const f = db.prepare('SELECT file_name, columns FROM generated_files WHERE job_id = ? AND key = ?').get(jobId, kind);
  if (!f) return null;
  let columns = null;
  try { columns = JSON.parse(f.columns || 'null'); } catch { columns = null; }
  const legacy = !columns;
  if (legacy) columns = defaultColumns(kind);
  const want = new Set(v.missing.map(m => m.rowNo));
  const rows = rowsOf(db, jobId, kind).filter(g => want.has(g.row_no)).map(g => {
    const x = valuesOf(g);
    return legacy ? Object.fromEntries(columns.map(c => [c.id, x[c.heading]])) : x;
  });
  return { csv: csvFor(columns, rows), rows: rows.length, fileName: `missing_rows_${f.file_name || ALL_FILES[kind].file}` };
}

// Which later files name a contact or an account that Zoho Books does not have. Read only when something is missing.
// missing: { customers?: Set(key), vendors?: Set(key), accounts?: Set(key), items?: Set(key) }.
// Returns { <file key>: { customers: n, vendors: n, accounts: n, items: n, rows: n } } for the files that name one.
const RECEIVABLE = 'accounts receivable', PAYABLE = 'accounts payable';
const USES = {
  invoices: [['customers', 'customer_name'], ['accounts', 'account'], ['items', 'item_name']],
  bills: [['vendors', 'vendor_name'], ['accounts', 'account'], ['items', 'item_name']],
  journals: [['contact', 'contact_name'], ['accounts', 'account']],
  other_journals: [['contact', 'contact_name'], ['accounts', 'account']],
  opening_balances_for_zoho_accounts: [['contact', 'contact_name'], ['accounts', 'account']],
};
export function filesNamingMissing(db, jobId, missing) {
  const out = {};
  const any = Object.values(missing).some(s => s && s.size);
  if (!any) return out;
  for (const [key, uses] of Object.entries(USES)) {
    const hit = { customers: new Set(), vendors: new Set(), accounts: new Set(), items: new Set() };
    let rows = 0;
    for (const g of rowsOf(db, jobId, key)) {
      const v = valuesOf(g);
      let bad = false;
      for (const [kind, id] of uses) {
        const raw = String(v[id] ?? '');
        if (!raw.trim()) continue;
        if (kind === 'contact') {
          // a customer on Accounts Receivable, a vendor on Accounts Payable (Zoho takes a contact on these two accounts)
          const acc = String(v.account ?? '').trim().toLowerCase();
          const side = acc === RECEIVABLE ? 'customers' : acc === PAYABLE ? 'vendors' : null;
          const ck = contactNameKey(raw);
          if (side && missing[side]?.has(ck)) { hit[side].add(ck); bad = true; }
        } else {
          const kk = VERIFY_KINDS[kind].keyOf(raw);
          if (missing[kind]?.has(kk)) { hit[kind].add(kk); bad = true; }
        }
      }
      if (bad) rows++;
    }
    if (rows) out[key] = { customers: hit.customers.size, vendors: hit.vendors.size, accounts: hit.accounts.size, items: hit.items.size, rows };
  }
  return out;
}

// For the Rejection Manager (zohoerrors.js contactCause): the names of the migration's own contact and account files,
// and what Zoho's exports hold. { customers: Set, vendors: Set, accounts: Set, zoho: { customers: Set|null, vendors: Set|null } }
export function knownNames(db, jobId) {
  const keys = kind => new Set(fileNames(db, jobId, kind).map(n => n.key));
  const zoho = kind => { const a = arrivedOf(db, jobId, kind); return a.given ? a.keys : null; };
  return { customers: keys('customers'), vendors: keys('vendors'), accounts: keys('accounts'), zoho: { customers: zoho('customers'), vendors: zoho('vendors') } };
}
