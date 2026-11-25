import Fastify from 'fastify';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOGUE, slotByKey } from './catalogue.js';
import { getCompany, entryType, entryVchType, isoDate, fyRange, jobYear, realDate, impossibleDateWords, yearStartFromData, sourceId, voucherBalance, recordName, recordParent, tallyText, ENCODING_NAMES,
  companyWarning, hasHiddenCharacters, hasEdgeSpaces, nameKey, money, NameSet, matchKey, voucherStatus, VOUCHER_STATUS_TEXT, ledgerEntryList, decodeText, oddListShape, hasPostingLines } from './tally.js';
import { groupTree, routeMaster, ALL_MASTERS_SLOTS, NOT_FROM_THIS_FILE, contactInfo, itemInfo } from './masters.js';
import { voucherTypeMap, voucherRouter, otherTypeMessage, ALL_TRANSACTIONS_SLOTS, OTHER_SLOT, isNonPostingBase } from './transactions.js';
import { ledgersFromTrialBalance, addedLedgerWords } from './tbledgers.js';
import { reportBody, flattenTrialBalance, analyseTrialBalance, describeTrialBalance, movementCollector, masterIndex, isReportLine, parseReportText } from './trialbalance.js';
import { TEMPLATES, groupSection, gstTreatment, placeOfContact, isProfitAndLossLedger, openingBalancingRow, openingBalanceForJournal, serviceItemRow, serviceItemProductType, ledgerAccountType, contactCreditOpeningRow, contactCreditBalancingRow, profitAndLossOpeningRow, ZOHO_RETAINED_EARNINGS } from './zoho.js';
import { builtinAccount, gstCodeSet, gstinProblem, accountNameKey } from './zohocodes.js';
import { setupAuth } from './auth.js';
import { setupExtras, registerExtras, makeContext, setOpeningAnchorResolver, verificationSummary, RECONCILIATION_NOTE, ALL_FILES, fileLayout } from './extras.js';
import { correctionsOf, voucherKey, validateCorrection, suggestAmount, correctionProblem, ensureCorrectionsTable } from './vouchercorrections.js';
import { DECISIONS, VOUCHER_FILES, suggestJournal, voucherLines, buildVoucherOutput, LEDGER_KIND_BY_GROUP, partyDocParty, routingOptions, FALLBACK_WORDS, voucherYearOutcome } from './vouchers.js';
import { setupVoucherOptions, registerVoucherOptions, voucherSettings, tdsMappings, taxLedgerInfos, tdsView, voucherDefaults } from './voucheropts.js';
import { fieldsNotReadCollector, keyFieldCollector, NOT_TRANSFERRED_YET } from './fields.js';
import { readTallyFile, pause, NOT_UTF8_ADVICE } from './tallystream.js';
// why an uploaded file cannot be read: a file that is not UTF-8 or UTF-16 is said as such (TALLY-005), the rest is broken JSON
const notReadable = e => (String(e?.message).includes(NOT_UTF8_ADVICE) ? `The file cannot be read: ${e.message}` : `This is not a valid JSON file (${e.message}).`);
import { setupColumns, registerColumns, getMapping, rowValues, csvFor, columnsToWrite, idColumnId, layoutStatement, layoutGaps } from './columns.js';
import { createCrossCheck } from './crosscheck.js';
import { setupTaxes, registerTaxes, taxGenerateChecks, taxUsageCollector, saveTaxUsage, taxMappingList, zohoTaxList } from './taxes.js';
import { buildTestReport, NAME_WARNING_KINDS } from './testreport.js';
import { taxEvidenceFrom } from './taxposting.js';
import { companyGstOf } from './companygst.js';
import { setupDecisions, registerDecisions, accountNameMapper, mergedAway, loadDecisions, setTaxEvidenceProvider, gstCodesForFirm, gstUnregisteredConsumerForFirm, businessTypeOf, stepReviews } from './decisions.js';
import { registerNames, decidedLedgerNames } from './names.js';
import { visibleName, cleanName, openingWithMerged } from './namefix.js';
import { resolveHsn, summariseAssumptions, defaultJournalRoute, isReimbursementJournal, ASSUMPTIONS, chooseDateAnchor, openingBalanceViaJournal, BANK_LIKE_TYPES, OB_PROVEN_TYPES, OB_PROVEN_ZOHO_ACCOUNTS } from './defaults.js';
import Decimal from 'decimal.js';
import { journalPattern, parseReviewQuery, reviewPage, reviewCounts, ledgerFacet, patternFacet, planDecision, planWords, patternWords } from './journalreview.js';
import { buildPrepareState } from './prepare.js';
import { MONEY_SLOTS, SAMPLE_NEEDED, JOURNAL_CATEGORIES, heldView, heldSummary, creditView, creditSummary } from './payments.js';
import { registerZohoTb, ledgerInfoFrom } from './zohotb.js';
import { registerPredictedTb } from './predictedtb.js';
import { registerProfiles } from './profiles.js';
import { setupVoucherRecon, saveRecon, registerVoucherRecon } from './voucherrecon.js';
import { registerImportSteps, planFor, syncImportStatus } from './importwizard.js';
import { setupZohoCheck, registerZohoCheck, runZohoCheck, zohoCheckSummary, downloadBlockers, downloadBlockedMessage, checkedRows } from './zohocheckapi.js';
import { registerHeldVouchers, heldState } from './heldvouchers.js';
import { isBuildable } from './heldfiles.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'migration.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS migrations (
    id TEXT PRIMARY KEY, company TEXT NOT NULL, gstin TEXT, financial_year TEXT NOT NULL, method TEXT NOT NULL,
    source TEXT NOT NULL, destination TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS uploads (
    job_id TEXT NOT NULL, slot TEXT NOT NULL, file_name TEXT, size INTEGER, sha256 TEXT, records INTEGER,
    warnings TEXT, uploaded_at TEXT, path TEXT, PRIMARY KEY (job_id, slot));
  CREATE TABLE IF NOT EXISTS waivers (job_id TEXT NOT NULL, slot TEXT NOT NULL, reason TEXT, at TEXT, PRIMARY KEY (job_id, slot));
  CREATE TABLE IF NOT EXISTS source_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, slot TEXT NOT NULL, object_type TEXT, source_id TEXT, name TEXT, data TEXT);
  CREATE INDEX IF NOT EXISTS idx_src ON source_records (job_id, slot);
  CREATE TABLE IF NOT EXISTS exceptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, stage TEXT, slot TEXT, source_id TEXT, name TEXT, message TEXT);
  CREATE TABLE IF NOT EXISTS generated_files (
    job_id TEXT NOT NULL, module TEXT NOT NULL, key TEXT NOT NULL, file_name TEXT, rows INTEGER, sha256 TEXT,
    template_verified INTEGER, generated_at TEXT, path TEXT, PRIMARY KEY (job_id, key));
  CREATE TABLE IF NOT EXISTS generated_rows (
    job_id TEXT NOT NULL, key TEXT NOT NULL, row_no INTEGER, row_key TEXT, source_record_id INTEGER, source_id TEXT);
  -- Receipt, Payment and Debit / Credit Note vouchers held when the files were created last, because the Zoho module
  -- they belong in has no import sample yet (payments.js): file_key payments_received | payments_made | vendor_credits |
  -- credit_notes; detail: their view (party, bank, amount, allocations) as JSON
  CREATE TABLE IF NOT EXISTS held_vouchers (
    job_id TEXT NOT NULL, source_record_id INTEGER NOT NULL, file_key TEXT NOT NULL, number TEXT, detail TEXT);
  -- The credits that the Manual Journals written last leave on customers and vendors in Zoho Books (a customer credited or
  -- a vendor debited on Accounts Receivable / Accounts Payable), with what each settles by Tally's bill-wise allocations:
  -- the list "credits to apply" (payments.js creditView), not an import file. detail: the view as JSON
  CREATE TABLE IF NOT EXISTS journal_credits (
    job_id TEXT NOT NULL, source_record_id INTEGER NOT NULL, detail TEXT);
  CREATE TABLE IF NOT EXISTS journal_decisions (
    job_id TEXT NOT NULL, source_record_id INTEGER NOT NULL, decision TEXT NOT NULL, suggested TEXT, decided_by TEXT, at TEXT,
    PRIMARY KEY (job_id, source_record_id));
  CREATE TABLE IF NOT EXISTS import_status (
    job_id TEXT NOT NULL, key TEXT NOT NULL, status TEXT NOT NULL, note TEXT, updated_at TEXT, PRIMARY KEY (job_id, key));
  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT, at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT);
`);

try { db.exec('ALTER TABLE generated_files ADD COLUMN notes TEXT'); } catch { /* column already exists */ }
try { db.exec('ALTER TABLE migrations ADD COLUMN firm_id INTEGER DEFAULT 1'); } catch { /* column already exists */ }
// start_date: the migration start date chosen on New Migration (yyyy-mm-dd, inside the financial year). Stored and shown only;
// no file is built from it yet. NULL for migrations made before it existed (read as the first day of the financial year).
try { db.exec('ALTER TABLE migrations ADD COLUMN start_date TEXT'); } catch { /* column already exists */ }
// year_start: the first day of the migration's financial year when it is not 1 April (yyyy-mm-dd; NULL: 1 April of the
// year financial_year names). year_source: 'user' when typed on New Migration (kept), 'data' when found in the Tally
// files at processing (tally.js yearStartFromData; worked out again at every processing), NULL for April to March.
// Every reader of the year calls jobYear (tally.js).
for (const col of ['year_start TEXT', 'year_source TEXT']) { try { db.exec(`ALTER TABLE migrations ADD COLUMN ${col}`); } catch { /* column already exists */ } }
// main_records: how many records of the slot's main type the file holds (Group records in the Chart of Accounts are not counted).
// record_types: JSON { type: count }. unread_fields: JSON { count, fields: [{ name, records }], truncated }.
// key_fields: JSON, the key-field findings of the upload (see keyFieldCollector in fields.js). NULL for uploads made before it existed.
for (const col of ['main_records INTEGER', 'record_types TEXT', 'unread_fields TEXT', 'key_fields TEXT']) { try { db.exec(`ALTER TABLE uploads ADD COLUMN ${col}`); } catch { /* column already exists */ } }
for (const col of ['kind TEXT', 'uses INTEGER']) { try { db.exec(`ALTER TABLE exceptions ADD COLUMN ${col}`); } catch { /* column already exists */ } }
// bundle_sha: set when the dataset's records came from an "All Masters" file (the checksum of that file); NULL for a
// file uploaded on its own. sha256 of such a row is also the All Masters file's checksum; path is the dataset's part.
try { db.exec('ALTER TABLE uploads ADD COLUMN bundle_sha TEXT'); } catch { /* column already exists */ }
// file_company: the company name the uploaded file carries (Tally's current company; '' when it has none). NULL when not
// known (uploads made before it was stored, and the Trial Balance report). The files are checked against the company
// name again when it is changed on New Migration.
try { db.exec('ALTER TABLE uploads ADD COLUMN file_company TEXT'); } catch { /* column already exists */ }
// The All Masters file of a migration (one at most): the file as uploaded, and which datasets were taken from it.
// datasets: JSON { slot: records }. not_used: JSON { record type: count }. auto_waived: JSON [slot] marked not applicable by it.
db.exec('CREATE TABLE IF NOT EXISTS doc_total_differs (job_id TEXT NOT NULL, key TEXT NOT NULL, number TEXT, party TEXT, difference TEXT)');
// the bills and invoices whose TDS Amount (Tally's) is not the TDS Percentage of the base by more than a rupee (TDS-005)
db.exec('CREATE TABLE IF NOT EXISTS doc_tds_differs (job_id TEXT NOT NULL, key TEXT NOT NULL, number TEXT, party TEXT, difference TEXT)');
db.exec(`CREATE TABLE IF NOT EXISTS master_bundles (
  job_id TEXT PRIMARY KEY, file_name TEXT, size INTEGER, sha256 TEXT, encoding TEXT, records INTEGER, record_types TEXT, datasets TEXT,
  not_used TEXT, auto_waived TEXT, messages TEXT, uploaded_at TEXT, path TEXT, actor TEXT);`);
// voucher_types: JSON { name: { parent, reserved } } from the file's "Voucher Type" records (see transactions.js), used to
// route vouchers of a custom voucher type. NULL for a file uploaded before this existed: it is then read from the kept file.
try { db.exec('ALTER TABLE master_bundles ADD COLUMN voucher_types TEXT'); } catch { /* column already exists */ }
// currencies: JSON [{ name, expandedsymbol, mailingname ... }] of the file's Currency masters (extras.js currencyRecords),
// read from the kept file the first time it is needed. NULL until then.
try { db.exec('ALTER TABLE master_bundles ADD COLUMN currencies TEXT'); } catch { /* column already exists */ }
// bundle_kind: 'transactions' when bundle_sha is the checksum of an "All transactions" file; NULL or 'masters' otherwise.
// extra: JSON with what is known about the dataset beyond the usual (for the Trial Balance: how the Tally report was read).
for (const col of ['bundle_kind TEXT', 'extra TEXT']) { try { db.exec(`ALTER TABLE uploads ADD COLUMN ${col}`); } catch { /* column already exists */ } }
// The All Transactions file of a migration (one at most): the file as uploaded, and how its vouchers were sorted.
// voucher_types: JSON [{ type, slot, base, how, vouchers }]. datasets: JSON { slot: records }. not_used: JSON { record type: count }.
// auto_waived: JSON [slot] confirmed empty by the file. statuses: JSON { cancelled, optional, deleted }.
db.exec(`CREATE TABLE IF NOT EXISTS transaction_bundles (
  job_id TEXT PRIMARY KEY, file_name TEXT, size INTEGER, sha256 TEXT, encoding TEXT, records INTEGER, vouchers INTEGER, voucher_types TEXT, datasets TEXT,
  not_used TEXT, auto_waived TEXT, statuses TEXT, messages TEXT, uploaded_at TEXT, path TEXT, actor TEXT, masters_sha TEXT);`);
// not_placed: JSON { slot: { baseline, vouchers, why: 'own_file' | 'removed', fileName } }. Written when the kept file is
// sorted again: vouchers that the new sorting moves INTO a dataset that is held by a file uploaded on its own (or that
// the user removed) are not written there, so they are in no dataset. baseline: how many vouchers of the file that
// dataset had when it was replaced or removed; vouchers: how many more it would have now.
try { db.exec('ALTER TABLE transaction_bundles ADD COLUMN not_placed TEXT'); } catch { /* column already exists */ }
// The lines of a Tally Trial Balance report as they were matched and checked when the data was processed (see
// trialbalance.js). Rebuilt by every processing run. trial_balance_summary.data: JSON, the summary of that analysis.
db.exec(`CREATE TABLE IF NOT EXISTS trial_balance_lines (
  job_id TEXT NOT NULL, line_no INTEGER NOT NULL, source_record_id INTEGER, data TEXT, PRIMARY KEY (job_id, line_no));
  CREATE TABLE IF NOT EXISTS trial_balance_summary (job_id TEXT PRIMARY KEY, data TEXT);`);
db.exec(`CREATE TABLE IF NOT EXISTS expected_counts (
  job_id TEXT NOT NULL, slot TEXT NOT NULL, expected INTEGER NOT NULL, decided_by TEXT, at TEXT, PRIMARY KEY (job_id, slot));`);
setupExtras(db);
setupColumns(db);
setupTaxes(db);
setupDecisions(db);
setupVoucherOptions(db);
setupVoucherRecon(db);
// v2. journal_decisions_kept: the journal routing decisions saved by the voucher's Tally identifier while the data is
// read again (M1; see reattachJournalDecisions). applied_defaults: the assumptions (defaults applied) the files created
// last were built with: data is the JSON list of summariseAssumptions (defaults.js).
db.exec(`CREATE TABLE IF NOT EXISTS journal_decisions_kept (
    job_id TEXT NOT NULL, source_id TEXT NOT NULL, number TEXT, date TEXT, decision TEXT NOT NULL, suggested TEXT, decided_by TEXT, at TEXT, PRIMARY KEY (job_id, source_id));
  CREATE TABLE IF NOT EXISTS applied_defaults (job_id TEXT PRIMARY KEY, at TEXT, data TEXT);`);
// Each generated file records the column layout it was built with: mapping_hash is the layout version, columns is
// the JSON list [{ id, heading, source }], attestation is the admin's "matches the official Zoho sample" statement
// in force at that time (JSON, or NULL). Files created before these columns existed have NULL in all three.
for (const col of ['mapping_hash TEXT', 'columns TEXT', 'attestation TEXT']) { try { db.exec(`ALTER TABLE generated_files ADD COLUMN ${col}`); } catch { /* column already exists */ } }
// Why a migration's generated files are out of date. One row per change made since the files were last created.
// files: JSON list of the file keys the change affects, or NULL for every file. kind groups rows that replace each other.
db.exec(`CREATE TABLE IF NOT EXISTS stale_reasons (
  id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, at TEXT NOT NULL, reason TEXT NOT NULL, files TEXT, kind TEXT, actor TEXT);`);

// The latest processing run of each migration: state is queued, running, done or failed.
db.exec(`CREATE TABLE IF NOT EXISTS process_runs (
  job_id TEXT PRIMARY KEY, state TEXT NOT NULL, phase TEXT, done INTEGER, total INTEGER, started_at TEXT, finished_at TEXT, error TEXT, actor TEXT, result TEXT);`);
try { db.exec('ALTER TABLE process_runs ADD COLUMN run_id TEXT'); } catch { /* column already exists */ }
// Size limits. A Tally upload is written to disk as it arrives, so its limit is about disk space, not memory.
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES) || 4 * 1024 * 1024 * 1024;
// Other binary bodies (Zoho rejection files and reports) are held in memory, so they are kept small (M8): a real Zoho
// error file or report is a few megabytes. sheet.js refuses a file over 50 MB and caps what an .xlsx may unpack to.
const MAX_BUFFERED_BYTES = Number(process.env.MAX_BUFFERED_BYTES) || 60 * 1024 * 1024;
// POST process waits for the result by itself only when the uploaded files are this small in total.
const SMALL_PROCESS_BYTES = Number(process.env.SMALL_PROCESS_BYTES) || 2 * 1024 * 1024;

const now = () => new Date().toISOString();
// The signed-in user for the request being handled. It is only right while a handler runs without pausing.
// Anything asynchronous (uploads, the processing job) captures the user first and passes it to audit() and markStale().
let currentActor = 'system';
const audit = (jobId, action, detail = '', actor = currentActor) =>
  db.prepare('INSERT INTO audit_logs (job_id, at, actor, action, detail) VALUES (?,?,?,?,?)').run(jobId, now(), actor, action, detail);
const tx = fn => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };

// ---------- "files are out of date" ----------
// A change to anything the files are built from is recorded here, but only when files exist. Creating the files
// again (or processing again, which removes them) clears the list.
const generatedKeys = jobId => db.prepare('SELECT key FROM generated_files WHERE job_id = ? ORDER BY rowid').all(jobId).map(f => f.key); // in the order the files are written
// Whatever changes what an invoice or a bill can carry (a tax or TDS mapping, a contact's GST details, the voucher
// settings, a routing decision ...) can move a journal voucher routed by default between the Invoices or Bills file and
// the Manual Journals file (vouchers.js DEFAULT_ROUTE_REFUSED_KINDS), and the service items of the Items file follow the
// invoice lines: so a change to invoices or bills marks journals and items out of date too. A list that already names
// the Items file is exact (for example an HSN/SAC correction: it changes cells, never what a document can carry).
// A change of a file's column layout (kind "columns:<file>"), or one the caller marks as exact (kind "exact:..."),
// changes the files named only.
export const withDependentFiles = (keys, kind = null) => {
  if (!keys || /^(columns|exact):/.test(String(kind || '')) || keys.includes('items') || !keys.some(k => k === 'invoices' || k === 'bills')) return keys;
  return [...new Set([...keys, 'journals', ...(keys.includes('invoices') ? ['items'] : [])])];
};
const markStale = (jobId, reason, fileKeys = null, kind = null, actor = currentActor) => {
  if (!generatedKeys(jobId).length) return;
  const files = withDependentFiles(fileKeys, kind);
  db.prepare('INSERT INTO stale_reasons (job_id, at, reason, files, kind, actor) VALUES (?,?,?,?,?,?)').run(jobId, now(), reason, files ? JSON.stringify(files) : null, kind, actor);
};
// ---------- answers worked out from the whole migration, kept while nothing changes ----------
// The signature of "nothing changed": SQLite's count of rows changed on this connection (every write of the server goes
// through it: uploads, processing, decisions, files), and whether a processing run is active. A cached answer is used
// only while both are the same, so it can never be older than the data (audit item 4: /prepare is polled every few
// seconds, /assumptions is a dry run of creating the files, the default routing of the journals needs the voucher build).
const stateCache = new Map(); // `${what}|${jobId}` -> { sig, value }
const stateSig = jobId => `${db.prepare('SELECT total_changes() n').get().n}|${activeRuns.has(jobId) ? 1 : 0}`;
function cachedState(what, jobId, compute) {
  const key = `${what}|${jobId}`;
  const hit = stateCache.get(key);
  if (hit && hit.sig === stateSig(jobId)) return hit.value;
  const value = compute();
  stateCache.delete(key); stateCache.set(key, { sig: stateSig(jobId), value });
  if (stateCache.size > 64) stateCache.delete(stateCache.keys().next().value);
  return value;
}
const clearStale = (jobId, kind = null) => (kind
  ? db.prepare('DELETE FROM stale_reasons WHERE job_id = ? AND kind = ?').run(jobId, kind)
  : db.prepare('DELETE FROM stale_reasons WHERE job_id = ?').run(jobId));
function staleInfo(jobId) {
  const keys = generatedKeys(jobId);
  const reasons = !keys.length ? [] : db.prepare('SELECT at, reason, files, actor FROM stale_reasons WHERE job_id = ? ORDER BY id').all(jobId)
    .map(r => ({ at: r.at, by: r.actor, reason: r.reason, files: r.files ? JSON.parse(r.files).filter(k => keys.includes(k)) : keys }));
  const forFile = key => reasons.filter(r => r.files.includes(key)).map(r => r.reason);
  return { filesOutOfDate: reasons.length > 0, outOfDateSince: reasons[0]?.at ?? null, outOfDateReasons: reasons, outOfDateFiles: keys.filter(k => forFile(k).length), forFile };
}
const staleFields = jobId => { const { forFile, ...rest } = staleInfo(jobId); return rest; };
const staleMessage = (job, what, reasons) => `${what} is out of date, because something it is built from changed after it was created. ${[...new Set(reasons)].join(' ')} `
  + (['processed', 'generated'].includes(job.status) ? 'Create the files again first.' : 'Process the data and create the files again first.');

// The latest processing run, as shown in the test run report and the status endpoint's history.
function processRun(jobId) {
  const r = db.prepare('SELECT * FROM process_runs WHERE job_id = ?').get(jobId);
  if (!r) return null;
  const secondsTaken = r.started_at && r.finished_at ? Math.round((new Date(r.finished_at) - new Date(r.started_at)) / 100) / 10 : null;
  return { state: r.state, startedAt: r.started_at, finishedAt: r.finished_at, secondsTaken, startedBy: r.actor, error: r.error };
}

const getJob = id => db.prepare('SELECT * FROM migrations WHERE id = ?').get(id);

// ---------- migration details (New Migration) ----------
// A financial year is written "2024-25" (any one character between): the second part must be the year after the first.
const checkFinancialYear = fy => {
  const m = /^(\d{4})\D(\d{2})$/.exec(String(fy || '').trim());
  if (!m) return 'Financial year is required, for example 2024-25.';
  const y = Number(m[1]);
  if (y < 1990 || y > 2100) return `Financial year ${fy} is not a year this platform can handle.`;
  if ((y + 1) % 100 !== Number(m[2])) return `Financial year ${fy} is not one year: it should be ${y}-${String((y + 1) % 100).padStart(2, '0')}.`;
  return '';
};
const shortDate = iso => { const [y, mo, d] = iso.split('-'); return `${d}/${mo}/${y}`; };
// The year start typed on New Migration (optional): the first day of the company's financial year when it is not
// 1 April, as yyyy-mm-dd (for example 2025-01-01 for a January to December year). Empty: worked out from the Tally data
// at processing (1 April unless the data shows another start). Returns { value } (null for empty) or { error }.
const checkYearStart = value => {
  if (value == null || String(value).trim() === '') return { value: null };
  const s = String(value).trim();
  if (!realDate(s)) return { error: `The year start "${s}" is not a date. Use the form yyyy-mm-dd, for example 2025-01-01 for a year from January to December.` };
  const y = Number(s.slice(0, 4));
  if (y < 1990 || y > 2100) return { error: `The year start ${s} is not a year this platform can handle.` };
  return { value: s };
};
// The start date must be a real yyyy-mm-dd date inside the financial year (1 April to 31 March). None given: the first
// day of the financial year. Returns { date } or { error }.
const checkStartDate = (value, fy, yearStart = null) => {
  const range = fyRange(fy, yearStart);
  if (value == null || value === '') return { date: range?.from || null };
  const s = String(value).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const d = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
  if (!m || d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) {
    return { error: `The start date "${s}" is not a date. Use the form yyyy-mm-dd, for example ${range?.from || '2024-04-01'}.` };
  }
  if (range && (s < range.from || s > range.to)) {
    return { error: `The start date ${shortDate(s)} is outside financial year ${fy} (${shortDate(range.from)} to ${shortDate(range.to)}). Choose a date inside the year, or change the financial year.` };
  }
  return { date: s };
};
// The migration as the screens read it: start_date filled in for migrations made before it was stored, and the
// number of uploaded files (the company and financial year are locked once there is one).
// fileCompanies: the company names carried by the uploaded files that differ from the migration's company name.
const jobView = job => job && ({
  ...job,
  start_date: job.start_date || jobYear(job)?.from || null,
  // the financial year the files follow ({ from, to }): 1 April to 31 March unless the Tally data or New Migration says
  // another start (year_start, year_source)
  year: jobYear(job),
  uploads: db.prepare('SELECT COUNT(*) n FROM uploads WHERE job_id = ?').get(job.id).n,
  fileCompanies: [...new Set(uploadCompanies(job.id).map(u => u.company).filter(c => c && companyWarning(c, job)))],
});
const setFileCompany = (jobId, slot, company) => db.prepare('UPDATE uploads SET file_company = ? WHERE job_id = ? AND slot = ?').run(company == null ? '' : String(company), jobId, slot);
// The company warning written by companyWarning (tally.js), read back to find the company of an older upload.
const COMPANY_WARNING = /^The file says company "(.*)", but this migration is for ".*"\. Your selection was not changed\.$/s;
const parseWarnings = w => { try { const a = JSON.parse(w || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
// The company of each upload: stored with the upload, or read back from its company warning; null when not known.
function uploadCompanies(jobId) {
  return db.prepare('SELECT slot, file_company, warnings FROM uploads WHERE job_id = ?').all(jobId).map(u => {
    if (u.file_company != null) return { slot: u.slot, company: u.file_company, known: true, warnings: parseWarnings(u.warnings) };
    const warnings = parseWarnings(u.warnings);
    const m = warnings.map(x => String(x).match(COMPANY_WARNING)).find(Boolean);
    return { slot: u.slot, company: m ? m[1] : null, known: !!m, warnings };
  });
}
// After the company name changed: each upload's company warning is worked out again against the new name.
// Returns { checked, differ, unknown } (unknown: uploads whose company is not known, left as they are).
function recheckCompany(jobId, company) {
  let checked = 0, differ = 0, unknown = 0;
  const upd = db.prepare('UPDATE uploads SET warnings = ? WHERE job_id = ? AND slot = ?');
  for (const u of uploadCompanies(jobId)) {
    if (!u.known) { unknown++; continue; }
    checked++;
    const cw = companyWarning(u.company, { company });
    if (cw) differ++;
    const next = [...(cw ? [cw] : []), ...u.warnings.filter(x => !COMPANY_WARNING.test(String(x)))];
    upd.run(JSON.stringify(next), jobId, u.slot);
  }
  return { checked, differ, unknown };
}
const setStatus = (id, status) => db.prepare('UPDATE migrations SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), id);

// ---------- upload validation ----------
// Reads the uploaded file from disk record by record (it is never held in memory as a whole) and pauses between
// batches so other requests are served. Asynchronous: the caller must not rely on currentActor afterwards.
const VALIDATE_BATCH = 2000;
// opts.tree: the group hierarchy of an All Masters file (groupTree in masters.js). With it, a ledger counts as being
// under the slot's group when the group chain above it reaches that group (a custom sub-group, for example).
export async function validateUploadFile(slot, filePath, job, opts = {}) {
  const types = {}, vt = {};
  let records = 0, outside = 0, otherGroup = 0, company = null, hasList = false, encoding = 'utf8', startsLater = 0, latestStart = '';
  // A voucher dataset holds the vouchers of ONE of Tally's own voucher types, together with the company's own types
  // placed under it (opts.voucherTypes: the Voucher Type records of the All Masters file, see transactions.js).
  const isVoucherSlot = slot.expects === 'Voucher';
  const router = isVoucherSlot ? voucherRouter(opts.voucherTypes ?? null) : null;
  const statuses = { cancelled: 0, optional: 0, deleted: 0 }; // and void, only when a voucher is void (TALLY-007)
  const range = isVoucherSlot ? jobYear(job) : null;
  const yearEnd = (jobYear(job)?.to || '').replace(/-/g, '') || null;
  const unread = fieldsNotReadCollector(slot.key);
  const kf = keyFieldCollector(slot, { asOf: yearEnd }); // dated details are read as the Zoho files read them
  try {
    for (const ev of readTallyFile(filePath)) {
      if (ev.type === 'record') {
        const m = ev.value;
        const o = m && typeof m === 'object' ? m : {};
        const t = entryType(m) || 'Unknown';
        types[t] = (types[t] || 0) + 1;
        if (isVoucherSlot) {
          const v = entryVchType(m) || 'Unknown';
          vt[v] = (vt[v] || 0) + 1;
          router.route(v).vouchers++;
          if (range) { const d = isoDate(o.date); if (!d || d < range.from || d > range.to) outside++; }
          const st = t === 'Voucher' ? voucherStatus(o) : null;
          if (st) statuses[st] = (statuses[st] || 0) + 1;
        }
        if (slot.group && t === 'Ledger' && (opts.tree ? !opts.tree.isUnder(recordParent(o), slot.group) : String(o.parent || '') !== slot.group)) otherGroup++;
        // Tally's "starting from" date of a ledger (the start of its books). After the end of the migration's
        // financial year, the year chosen is probably wrong, and the dated details would be read for the wrong date.
        if (t === 'Ledger' && yearEnd && /^\d{8}$/.test(String(o.startingfrom ?? '')) && String(o.startingfrom) > yearEnd) {
          startsLater++; if (String(o.startingfrom) > latestStart) latestStart = String(o.startingfrom);
        }
        unread.add(m);
        kf.add(m);
        if (++records % VALIDATE_BATCH === 0) await pause();
      } else if (ev.type === 'envelope') {
        if (String(ev.key).toLowerCase() === 'static_variables') company = getCompany({ static_variables: ev.value });
      } else { hasList = ev.hasList; encoding = ev.encoding || 'utf8'; }
    }
  } catch (e) { return { ok: false, error: notReadable(e) }; }
  if (!hasList) return { ok: false, error: 'The file has no "tallymessage" list, so it does not look like a Tally JSON export.' };
  if (!records) return { ok: false, error: 'The file contains no records.' };

  const warnings = [];
  const found = Object.entries(types).map(([t, n]) => `${n} ${t}`).join(', ');
  if (!types[slot.expects]) return { ok: false, error: `Wrong file for this slot. "${slot.name}" expects ${slot.expects} records, but the file contains: ${found}.` };
  const allowed = [slot.expects, ...(slot.alsoAccepts || [])];
  if (Object.keys(types).some(t => !allowed.includes(t))) {
    return { ok: false, error: `The file mixes record types (${found}). "${slot.name}" expects only ${slot.expects} records${slot.alsoAccepts ? ` (${slot.alsoAccepts.join(', ')} records may be included)` : ''}.` };
  }

  if (isVoucherSlot) {
    const others = Object.keys(vt).filter(t => router.route(t).slot !== slot.key);
    if (others.length) {
      const contains = Object.entries(vt).map(([t, n]) => `${n} ${t}`).join(', ');
      return { ok: false, error: slot.otherTypes
        ? `"${slot.name}" is only for vouchers of a type that has no dataset of its own, but the file contains: ${contains}. Upload those vouchers into their own slots, or upload the whole file into "All transactions in one file".`
        : `"${slot.name}" expects only ${slot.vchtype} vouchers, but the file contains: ${contains}.` };
    }
    if (outside) warnings.push(`${outside} voucher(s) are dated outside financial year ${job.financial_year}.`);
    // the company's own voucher types that were followed up to this dataset's type
    for (const t of router.summary().filter(x => x.how === 'master')) {
      warnings.push(`${t.vouchers} voucher(s) of type "${t.type}" were read as ${t.base} vouchers, because the Voucher Type records of the All Masters file place "${t.type}" under ${t.base}.`);
    }
    const flagged = Object.entries(statuses).filter(([, n]) => n);
    if (flagged.length) {
      warnings.push(`${flagged.map(([s, n]) => `${n} ${s}`).join(', ')} voucher(s) in this file are kept and counted, but they are never written to a Zoho file and are left out of the checks. Each one is listed as a flagged item when the data is processed.`);
    }
  }

  if (slot.group && otherGroup) warnings.push(`${otherGroup} of ${records} ledger(s) are not directly under "${slot.group}". Check this is the right file.`);

  const cw = companyWarning(company, job);
  if (cw) warnings.push(cw);
  if (startsLater) {
    warnings.push(`${slot.name}: ${startsLater} ledger(s) in this file start in Tally after the end of financial year ${job.financial_year} (the latest on ${isoDate(latestStart)}). `
      + 'Check the financial year of this migration: the dated mailing and GST details are taken as they apply at the end of that year.');
  }
  // Key fields the platform depends on: a required one that is in no record is a strong warning. Never blocks or rejects.
  const keyFields = kf.result();
  warnings.push(...keyFields.warnings);
  // Information only: fields present in the file that the platform does not read. Never blocks or rejects.
  return { ok: true, records, mainRecords: types[slot.expects], recordTypes: types, warnings, fieldsNotRead: unread.result(), keyFields, encoding, company,
    ...(isVoucherSlot ? { voucherTypes: router.summary(), statuses } : {}) };
}

// ---------- expected record counts (what Tally shows, entered by the user) ----------
const noun = (slot, n) => `${n} ${slot.expects === 'Ledger' ? 'ledger' : slot.expects === 'Voucher' ? 'voucher' : slot.expects === 'StockItem' ? 'stock item' : slot.expects === 'Unit' ? 'unit' : 'line'}${n === 1 ? '' : 's'}`;
const countMessage = (slot, expected, actual) =>
  `${slot.name}: Tally shows ${noun(slot, expected)}, but the uploaded file has ${noun(slot, actual)}${slot.alsoAccepts ? ` (${slot.alsoAccepts.join(', ')} records are not counted)` : ''}. Upload the complete file, or correct or clear the number entered from Tally.`;

// ---------- completeness ----------
function completeness(jobId) {
  const ups = Object.fromEntries(db.prepare('SELECT * FROM uploads WHERE job_id = ?').all(jobId).map(u => [u.slot, u]));
  const wv = Object.fromEntries(db.prepare('SELECT * FROM waivers WHERE job_id = ?').all(jobId).map(w => [w.slot, w]));
  const exp = Object.fromEntries(db.prepare('SELECT slot, expected FROM expected_counts WHERE job_id = ?').all(jobId).map(e => [e.slot, e.expected]));
  const txnBundle = db.prepare('SELECT file_name, datasets FROM transaction_bundles WHERE job_id = ?').get(jobId);
  const mstBundle = db.prepare('SELECT file_name, datasets FROM master_bundles WHERE job_id = ?').get(jobId);
  const slots = CATALOGUE.map(s => {
    const u = ups[s.key];
    const status = u ? 'uploaded' : wv[s.key] ? 'not_applicable' : 'missing';
    // the All Transactions file in place has no vouchers for this dataset: it is the evidence that there are none
    const confirmedEmpty = !!transactionsEmptyReason(s.key, txnBundle) || !!mastersEmptyReason(s.key, mstBundle);
    const expectedCount = exp[s.key] ?? null;
    const actualCount = u ? u.main_records ?? u.records : null; // uploads made before this column existed fall back to the record count
    return {
      key: s.key, name: s.name, category: s.category, requirement: s.requirement, zoho: s.zoho, desc: s.desc, report: s.report, status,
      upload: u ? { fileName: u.file_name, size: u.size, sha256: u.sha256, records: u.records, recordTypes: u.record_types ? JSON.parse(u.record_types) : null,
        warnings: JSON.parse(u.warnings || '[]'), uploadedAt: u.uploaded_at, fieldsNotRead: u.unread_fields ? JSON.parse(u.unread_fields) : null,
        keyFields: u.key_fields ? JSON.parse(u.key_fields) : null, // null for an upload made before key fields were checked
        fromAllMasters: !!u.bundle_sha && u.bundle_kind !== 'transactions', // true when the records came from the All Masters file
        fromAllTransactions: !!u.bundle_sha && u.bundle_kind === 'transactions', // true when they came from the All Transactions file
        ...(u.extra ? JSON.parse(u.extra) : {}) } : null, // for the Trial Balance: trialBalance (how the Tally report was read)
      // set for datasets that are read and kept but from which no Zoho file is created yet
      noZohoFile: NOT_TRANSFERRED_YET[s.key] ?? null,
      autoNotApplicable: !!wv[s.key] && String(wv[s.key].reason || '').startsWith(AUTO_WAIVER_PREFIX), // marked not applicable by the All Masters or All Transactions upload
      // true when every field the platform needs is missing from every record of the file: the screens must show this prominently
      mayNotBeReadable: u?.key_fields ? JSON.parse(u.key_fields).mayNotBeReadable === true : false,
      waiver: wv[s.key] ? { reason: wv[s.key].reason, at: wv[s.key].at } : null,
      // The dataset has no file and may be marked not applicable: a conditional one always (with a reason); a required
      // voucher dataset only while the All Transactions file in place has no vouchers for it (the reason is then the file's).
      confirmedEmptyByAllTransactions: confirmedEmpty,
      canMarkNotApplicable: status === 'missing' && (s.requirement === 'conditional' || (s.requirement === 'required' && confirmedEmpty)),
      // countMatches is null when there is nothing to compare (no number entered, or no file uploaded)
      expectedCount, actualCount, countMatches: expectedCount === null || actualCount === null ? null : expectedCount === actualCount,
    };
  });
  const missingRequired = slots.filter(s => s.requirement === 'required' && s.status === 'missing');
  const awaiting = slots.filter(s => s.requirement === 'conditional' && s.status === 'missing');
  const countMismatches = slots.filter(s => s.countMatches === false)
    .map(s => ({ slot: s.key, name: s.name, expected: s.expectedCount, actual: s.actualCount, message: countMessage(slotByKey[s.key], s.expectedCount, s.actualCount) }));
  return {
    slots,
    uploaded: slots.filter(s => s.status === 'uploaded').length,
    total: slots.length,
    missingRequired: missingRequired.map(s => s.name),
    awaitingConfirmation: awaiting.map(s => s.name),
    countMismatches,
    // Datasets whose file was accepted but may not be readable. Information only: it does not change "ready".
    mayNotBeReadable: slots.filter(s => s.mayNotBeReadable).map(s => ({ slot: s.key, name: s.name })),
    allMasters: allMastersInfo(jobId, ups),
    allTransactions: allTransactionsInfo(jobId, ups, wv),
    // Optional datasets with no file: they never block. Listed so the screens can say what is not there.
    optionalMissing: slots.filter(s => s.requirement === 'optional' && s.status === 'missing').map(s => s.name),
    ready: missingRequired.length === 0 && awaiting.length === 0 && countMismatches.length === 0,
  };
}

// ---------- the All Masters file ----------
// One file holding every master (Tally: Export > Masters > All Masters). It is split into the existing datasets:
// see uploadAllMasters below. ALL_MASTERS is the upload slot name used for it in the API.
const ALL_MASTERS = 'all_masters';
const AUTO_WAIVER_PREFIX = 'Set automatically: ';
const typeWords = { Ledger: 'ledger', Group: 'group', StockItem: 'stock item', Unit: 'unit' };

// What the screens show about the All Masters file: null when none was uploaded.
function allMastersInfo(jobId, ups = null) {
  const b = db.prepare('SELECT * FROM master_bundles WHERE job_id = ?').get(jobId);
  if (!b) return null;
  ups ||= Object.fromEntries(db.prepare('SELECT * FROM uploads WHERE job_id = ?').all(jobId).map(u => [u.slot, u]));
  const datasets = JSON.parse(b.datasets || '{}');
  return {
    fileName: b.file_name, size: b.size, sha256: b.sha256, encoding: b.encoding, encodingName: ENCODING_NAMES[b.encoding] || b.encoding, records: b.records,
    recordTypes: JSON.parse(b.record_types || '{}'), uploadedAt: b.uploaded_at, uploadedBy: b.actor,
    // how many records went to each dataset, and whether that dataset still comes from this file
    // records: every record that went to the dataset; mainRecords: the ones counted against Tally (for the Chart of
    // Accounts the ledgers, not the groups).
    datasets: Object.entries(datasets).map(([slot, d]) => {
      const u = ups[slot];
      const current = !!u && u.bundle_sha === b.sha256 && u.bundle_kind !== 'transactions';
      return { slot, name: slotByKey[slot]?.name ?? slot, records: d.records, mainRecords: d.main, groups: slot === 'accounts' ? d.records - d.main : 0,
        current, replacedBy: u && !current ? u.file_name : null, // a file uploaded on its own later replaced it
        removed: !u }; // the dataset was removed later
    }),
    notUsed: Object.entries(JSON.parse(b.not_used || '{}')).map(([type, records]) => ({ type, records })),
    autoNotApplicable: JSON.parse(b.auto_waived || '[]').map(slot => ({ slot, name: slotByKey[slot]?.name ?? slot })),
    messages: JSON.parse(b.messages || '[]'),
    // the file's Voucher Type records: used to sort vouchers of the company's own voucher types (null: not recorded for this file)
    voucherTypes: b.voucher_types ? Object.keys(JSON.parse(b.voucher_types)).length : null,
  };
}

// A required MASTER dataset the All Masters file in place shows to be empty. Today only the Tax Configuration (ledgers
// under Duties & Taxes): a company not registered for GST and without TDS (a small unregistered trader) has none, and
// the All Masters file holds every ledger of the company, so it is the evidence that there is nothing to upload.
// Customers, vendors and the chart of accounts stay required: a company with none of them cannot be migrated.
const MASTERS_EMPTY_SLOTS = ['taxes'];
const mastersWaiverReason = (key, fileName) => `${AUTO_WAIVER_PREFIX}the All Masters file "${fileName}" has no ledger under Duties & Taxes, and that file holds every ledger of the company, so there is no tax ledger to upload. `
  + 'No tax is mapped and no GST or TDS tax is written for this company.';
// The reason, when the All Masters file in place (bundle: its row, with file_name and datasets) has no records for this
// dataset; null when there is no such file, the dataset may not be left empty, or the file has records for it.
function mastersEmptyReason(key, bundle) {
  if (!bundle || !MASTERS_EMPTY_SLOTS.includes(key)) return null;
  return (JSON.parse(bundle.datasets || '{}')[key]?.main ?? 0) > 0 ? null : mastersWaiverReason(key, bundle.file_name);
}

// ---------- the All Transactions file ----------
// One file holding every voucher of the year (Tally: Gateway > E: Export > Transactions). It is split by voucher type
// into the voucher datasets: see applyAllTransactions below. ALL_TRANSACTIONS is the upload slot name used in the API.
const ALL_TRANSACTIONS = 'all_transactions';
const typePlural = slot => (slotByKey[slot]?.vchtype ? `${slotByKey[slot].vchtype} vouchers` : 'vouchers of other types');
// The reason kept with a voucher dataset that the All Transactions file shows to be empty.
const TRANSACTIONS_WAIVER_START = `${AUTO_WAIVER_PREFIX}the All Transactions file`;
const transactionsWaiverReason = (key, fileName) => `${TRANSACTIONS_WAIVER_START} "${fileName}" has no ${typePlural(key)}, and that file holds every voucher of the period, so there is nothing to upload for this dataset.`
  + (key === 'purchase' ? ' If this company enters its purchases as journals, they are in Journal Vouchers and are routed in Voucher Classification.' : '');
// The reason, when the All Transactions file in place (bundle: its row, with file_name and datasets) has no vouchers for
// this dataset; null when there is no such file, the dataset is not a voucher dataset, or the file has vouchers for it.
// While this holds, the file is the evidence that the dataset is empty, whatever was uploaded, removed or undone since.
function transactionsEmptyReason(key, bundle) {
  if (!bundle || !ALL_TRANSACTIONS_SLOTS.includes(key)) return null;
  return (JSON.parse(bundle.datasets || '{}')[key] ?? 0) > 0 ? null : transactionsWaiverReason(key, bundle.file_name);
}

// The Voucher Type records of the migration's All Masters file: { name: { parent, reserved } }, or null when there is
// no All Masters file. For a file uploaded before the records were kept, they are read from the kept file once.
// TALLY-001: the second copies of a Tally voucher over every dataset of a job: record id -> { id, slot, name } of the copy
// stored first (the lowest record id with the same Tally identifier). A copy is left out as a duplicate of that one.
function duplicateVoucherMap(jobId) {
  const rows = db.prepare(`SELECT s.id, f.id first_id, f.slot first_slot, f.name first_name FROM source_records s
    JOIN (SELECT source_id, MIN(id) mid FROM source_records WHERE job_id = ? AND object_type = 'Voucher' AND source_id IS NOT NULL GROUP BY source_id HAVING COUNT(*) > 1) d ON d.source_id = s.source_id
    JOIN source_records f ON f.id = d.mid
    WHERE s.job_id = ? AND s.object_type = 'Voucher' AND s.id <> d.mid`).all(jobId, jobId);
  return new Map(rows.map(r => [r.id, { id: r.first_id, slot: r.first_slot, name: r.first_name }]));
}
function voucherTypesOf(jobId) {
  const b = db.prepare('SELECT voucher_types, path FROM master_bundles WHERE job_id = ?').get(jobId);
  if (!b) return null;
  if (b.voucher_types) return JSON.parse(b.voucher_types);
  const records = [];
  try { for (const ev of readTallyFile(b.path)) if (ev.type === 'record' && entryType(ev.value) === 'Voucher Type') records.push(ev.value); } catch { return null; }
  const map = voucherTypeMap(records);
  db.prepare('UPDATE master_bundles SET voucher_types = ? WHERE job_id = ?').run(JSON.stringify(map), jobId);
  return map;
}

// What the screens show about the All Transactions file: null when none was uploaded.
function allTransactionsInfo(jobId, ups = null, wv = null) {
  const b = db.prepare('SELECT * FROM transaction_bundles WHERE job_id = ?').get(jobId);
  if (!b) return null;
  ups ||= Object.fromEntries(db.prepare('SELECT * FROM uploads WHERE job_id = ?').all(jobId).map(u => [u.slot, u]));
  wv ||= Object.fromEntries(db.prepare('SELECT * FROM waivers WHERE job_id = ?').all(jobId).map(w => [w.slot, w]));
  const datasets = JSON.parse(b.datasets || '{}');
  const types = JSON.parse(b.voucher_types || '[]');
  const notPlacedRaw = JSON.parse(b.not_placed || '{}');
  const isCurrent = slot => (datasets[slot] ?? 0) > 0 && !!ups[slot] && ups[slot].bundle_sha === b.sha256 && ups[slot].bundle_kind === 'transactions';
  // vouchers that sorting the file again moved into a dataset held by a file uploaded on its own, or removed by the user
  const notPlaced = Object.entries(notPlacedRaw).filter(([slot, n]) => n.vouchers > 0 && !isCurrent(slot))
    .map(([slot, n]) => ({ slot, name: slotByKey[slot]?.name ?? slot, vouchers: n.vouchers, why: n.why, fileName: n.why === 'own_file' ? ups[slot]?.file_name ?? n.fileName : null }));
  const list = ALL_TRANSACTIONS_SLOTS.map(slot => {
    const u = ups[slot], records = datasets[slot] ?? 0;
    const current = isCurrent(slot);
    return { slot, name: slotByKey[slot].name, records, current,
      replacedBy: records > 0 && u && !current ? u.file_name : null, removed: records > 0 && !u,
      ownFile: records === 0 && u ? u.file_name : null, // the file has none, and a file uploaded on its own is in place
      // the file has none, no file of its own is in place, and the dataset is marked not applicable with the file's reason
      notApplicable: records === 0 && !u && String(wv[slot]?.reason || '').startsWith(TRANSACTIONS_WAIVER_START),
      notPlaced: notPlaced.find(n => n.slot === slot)?.vouchers ?? 0,
      types: types.filter(t => t.slot === slot).map(t => ({ type: t.type, vouchers: t.vouchers, base: t.base, how: t.how })),
      noZohoFile: NOT_TRANSFERRED_YET[slot] ?? null };
  });
  const sum = f => list.filter(f).reduce((t, d) => t + d.records, 0);
  return {
    fileName: b.file_name, size: b.size, sha256: b.sha256, encoding: b.encoding, encodingName: ENCODING_NAMES[b.encoding] || b.encoding,
    records: b.records, vouchers: b.vouchers, uploadedAt: b.uploaded_at, uploadedBy: b.actor,
    // one entry per voucher dataset, also the ones the file has no vouchers for
    datasets: list,
    notPlaced,
    // Control total: every voucher of the file is in a dataset that still comes from the file, or belongs to a dataset
    // that was replaced by a file uploaded on its own, or to a dataset that was removed. notPlaced (part of the last
    // two) are the vouchers that a later sorting moved into such a dataset: they are in no dataset.
    control: { vouchers: b.vouchers, inDatasets: sum(d => d.current), replacedByOwnFile: sum(d => !!d.replacedBy), removed: sum(d => d.removed),
      notPlaced: notPlaced.reduce((t, n) => t + n.vouchers, 0),
      balanced: sum(d => d.current) + sum(d => !!d.replacedBy) + sum(d => d.removed) === b.vouchers },
    // voucher types that could not be traced to one of Tally's own types, and Tally types with no dataset
    unresolvedTypes: types.filter(t => t.how === 'unresolved').map(t => ({ type: t.type, vouchers: t.vouchers })),
    otherTallyTypes: types.filter(t => t.how === 'no_dataset').map(t => ({ type: t.type, vouchers: t.vouchers, base: t.base })),
    customTypes: types.filter(t => t.how === 'master').map(t => ({ type: t.type, vouchers: t.vouchers, base: t.base })),
    statuses: JSON.parse(b.statuses || '{}'),
    notUsed: Object.entries(JSON.parse(b.not_used || '{}')).map(([type, records]) => ({ type, records })),
    // the datasets that ARE marked not applicable now with this file's reason (a mark the user undid, or a dataset
    // that has a file of its own, is not listed)
    autoNotApplicable: list.filter(d => d.notApplicable).map(d => ({ slot: d.slot, name: d.name })),
    messages: JSON.parse(b.messages || '[]'),
    mastersUsed: !!b.masters_sha, // the Voucher Type records of an All Masters file were available when the file was sorted
  };
}

// What is said about vouchers of the All Transactions file that are in no dataset. n: { slot, name, vouchers, why, fileName }.
const notPlacedMessage = n => `${n.name}: ${n.vouchers} voucher${n.vouchers === 1 ? '' : 's'} of the All Transactions file ${n.vouchers === 1 ? 'belongs' : 'belong'} to this dataset since the file was sorted again `
  + '(the Voucher Type records of the All Masters file changed), but '
  + (n.why === 'own_file' ? `the file uploaded on its own for this dataset${n.fileName ? ` ("${n.fileName}")` : ''} was kept and not changed` : 'this dataset was removed after the file was uploaded and was not put back')
  + `. ${n.vouchers === 1 ? 'That voucher is' : 'Those vouchers are'} in no dataset now, so ${n.vouchers === 1 ? 'it is' : 'they are'} not processed, checked or written to any file. `
  + (n.why === 'own_file' ? 'Check that the file uploaded on its own holds them, or upload' : 'Upload') + ' the All Transactions file again: that sorts every voucher into its dataset.';

// Splits an All Transactions file into one file per voucher dataset, in workDir, in one pass over the file. Each
// voucher goes to the dataset of its voucher type (routeVoucherType in transactions.js). The dataset files are ordinary
// UTF-8 Tally JSON files that the rest of the platform reads exactly like files uploaded on their own.
async function splitAllTransactionsFile(filePath, workDir, voucherTypes) {
  const types = {}, notUsed = {}, out = {};
  const router = voucherRouter(voucherTypes);
  let records = 0, vouchers = 0, hasList = false, encoding = 'utf8', staticVariables;
  const envelopeOf = () => (staticVariables !== undefined ? `"static_variables":${JSON.stringify(staticVariables)},` : '');
  fs.mkdirSync(workDir, { recursive: true });
  try {
    for (const ev of readTallyFile(filePath)) {
      if (ev.type === 'envelope') { if (String(ev.key).toLowerCase() === 'static_variables') staticVariables = ev.value; continue; }
      if (ev.type === 'end') { hasList = ev.hasList; encoding = ev.encoding || 'utf8'; continue; }
      const m = ev.value;
      const t = entryType(m) || 'Unknown';
      types[t] = (types[t] || 0) + 1;
      if (++records % VALIDATE_BATCH === 0) await pause();
      if (t !== 'Voucher') { notUsed[t] = (notUsed[t] || 0) + 1; continue; }
      vouchers++;
      const r = router.route(entryVchType(m));
      r.vouchers++;
      let o = out[r.slot];
      // Tally's envelope normally comes before the list; when it does, it is copied into each part (as for masters)
      if (!o) { const p = path.join(workDir, `${r.slot}.json`); o = out[r.slot] = { fd: fs.openSync(p, 'w'), n: 0, path: p }; fs.writeSync(o.fd, `{${envelopeOf()}"tallymessage":[\n`); }
      fs.writeSync(o.fd, (o.n ? ',\n' : '') + JSON.stringify(m));
      o.n++;
    }
  } catch (e) { return { ok: false, error: notReadable(e) }; }
  finally { for (const o of Object.values(out)) { try { fs.writeSync(o.fd, '\n]}\n'); } finally { fs.closeSync(o.fd); } } }
  if (!hasList) return { ok: false, error: 'The file has no "tallymessage" list, so it does not look like a Tally JSON export.' };
  if (!records) return { ok: false, error: 'The file contains no records.' };
  if (!vouchers) {
    return { ok: false, error: `This file has no vouchers, so it does not look like a Transactions export (it contains: ${Object.entries(types).map(([t, n]) => `${n} ${t}`).join(', ')}). In Tally use Gateway of Tally > E: Export > Transactions.` };
  }
  const company = staticVariables !== undefined ? getCompany({ static_variables: staticVariables }) : null;
  return { ok: true, records, vouchers, recordTypes: types, encoding, company, notUsed, voucherTypes: router.summary(),
    files: Object.fromEntries(Object.entries(out).map(([s, o]) => [s, o.path])), split: Object.fromEntries(Object.entries(out).map(([s, o]) => [s, o.n])) };
}

// Splits an All Masters file into one file per dataset, in workDir. Two passes over the file, record by record:
// the first collects the Group records (to know the group chain above every ledger) and counts the record types;
// the second writes each record to its dataset's file. The dataset files are ordinary UTF-8 Tally JSON files that the
// rest of the platform reads exactly like files uploaded on their own.
async function splitAllMastersFile(filePath, workDir) {
  const types = {}, groups = [], voucherTypeRecords = [];
  let records = 0, hasList = false, encoding = 'utf8', staticVariables;
  try {
    for (const ev of readTallyFile(filePath)) {
      if (ev.type === 'record') {
        const t = entryType(ev.value) || 'Unknown';
        types[t] = (types[t] || 0) + 1;
        if (t === 'Group') groups.push(ev.value);
        // kept to sort vouchers of the company's own voucher types (only the name, the parent and the reserved name are used)
        if (t === 'Voucher Type') voucherTypeRecords.push({ metadata: ev.value?.metadata, parent: ev.value?.parent });
        if (++records % VALIDATE_BATCH === 0) await pause();
      } else if (ev.type === 'envelope') {
        // Tally's envelope (static_variables, with svCurrentCompany) is copied into every dataset file, so each one is
        // checked exactly like a file uploaded on its own (the company name among others).
        if (String(ev.key).toLowerCase() === 'static_variables') staticVariables = ev.value;
      } else if (ev.type === 'end') { hasList = ev.hasList; encoding = ev.encoding || 'utf8'; }
    }
  } catch (e) { return { ok: false, error: notReadable(e) }; }
  if (!hasList) return { ok: false, error: 'The file has no "tallymessage" list, so it does not look like a Tally JSON export.' };
  if (!records) return { ok: false, error: 'The file contains no records.' };
  const found = Object.entries(types).map(([t, n]) => `${n} ${t}`).join(', ');
  if (!['Ledger', 'Group', 'StockItem', 'Unit'].some(t => types[t])) {
    return { ok: false, error: `This file has no ledgers, groups, stock items or units, so it does not look like an All Masters export (it contains: ${found}). In Tally use Export > Masters, with Type of Masters: All Masters.` };
  }
  const tree = groupTree(groups);
  fs.mkdirSync(workDir, { recursive: true });
  const out = {}; // slot -> { fd, n, path }
  const notUsed = {}, notFromThisFile = {}, itemUnits = new Set();
  let n = 0;
  try {
    for (const ev of readTallyFile(filePath)) {
      if (ev.type !== 'record') continue;
      const m = ev.value;
      const slots = m && typeof m === 'object' ? routeMaster(m, tree) : [];
      if (!slots.length) {
        const t = entryType(m) || 'Unknown';
        if (NOT_FROM_THIS_FILE.has(t)) notFromThisFile[t] = (notFromThisFile[t] || 0) + 1;
        else if (t !== 'Voucher Type') notUsed[t] = (notUsed[t] || 0) + 1; // Voucher Type records are used: see voucherTypes below
      }
      const text = slots.length ? JSON.stringify(m) : '';
      for (const slot of slots) {
        let o = out[slot];
        if (!o) { const p = path.join(workDir, `${slot}.json`); o = out[slot] = { fd: fs.openSync(p, 'w'), n: 0, path: p };
          fs.writeSync(o.fd, `{${staticVariables !== undefined ? `"static_variables":${JSON.stringify(staticVariables)},` : ''}"tallymessage":[\n`); }
        fs.writeSync(o.fd, (o.n ? ',\n' : '') + text);
        o.n++;
        if (slot === 'stock_items') { const u = itemInfo(m).unit.trim(); if (u) itemUnits.add(u); }
      }
      if (++n % VALIDATE_BATCH === 0) await pause();
    }
  } finally {
    for (const o of Object.values(out)) { try { fs.writeSync(o.fd, '\n]}\n'); } finally { fs.closeSync(o.fd); } }
  }
  if (n !== records) return { ok: false, error: `The file had ${records} records on the first reading but ${n} on the second. Upload the file again.` };
  const company = staticVariables !== undefined ? getCompany({ static_variables: staticVariables }) : null;
  return { ok: true, records, recordTypes: types, encoding, tree, company, voucherTypes: voucherTypeMap(voucherTypeRecords),
    files: Object.fromEntries(Object.entries(out).map(([s, o]) => [s, o.path])),
    split: Object.fromEntries(Object.entries(out).map(([s, o]) => [s, o.n])), notUsed, notFromThisFile, itemUnits: [...itemUnits] };
}

// ---------- processing ----------
// Processing runs as a background job, one per migration at a time. It reads each uploaded file record by record,
// stores the records in batches (one database transaction per batch) and pauses between batches, so the server
// keeps answering other requests and the screens can show progress.
//
// HOW A FAILURE IS HANDLED. A batch is committed before the job pauses, so while a run is going the tables hold
// part of the data. To make sure half-stored data is never shown as processed:
//   - when a run starts, the migration's status becomes 'processing' and the earlier results (records, flagged
//     items, generated files, routing decisions, Zoho report checks, rejections) are removed, as before;
//   - the status becomes 'processed' only in the last step, together with the cross-check items;
//   - if anything fails, every record and flagged item stored by the run is removed again, the status goes back
//     to 'awaiting_uploads' and the run is recorded as failed with the reason. Nothing from the failed run stays.
//   - if the server stops during a run, the same clean-up is done when it starts again (see recoverInterruptedRuns).
// The job never uses currentActor: the user who started it is carried in the run and passed to audit().
const PROCESS_BATCH = Math.max(1, Number(process.env.PROCESS_BATCH) || 1000);
const VOUCHER_SLOTS = ALL_TRANSACTIONS_SLOTS; // sales, purchase, receipt, payment, journal, contra, debit and credit notes, other types
const activeRuns = new Map(); // migration id -> the run in progress
let runCounter = 0;

const saveRun = run => db.prepare('INSERT OR REPLACE INTO process_runs (job_id, state, phase, done, total, started_at, finished_at, error, actor, result, run_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
  .run(run.jobId, run.state, run.phase, run.stored, run.recordsTotal, run.startedAt, run.finishedAt, run.error, run.actor, run.result ? JSON.stringify(run.result) : null, run.runId);

// Deletes a migration's rows from a table a batch at a time, pausing in between.
async function deleteInBatches(table, jobId) {
  const stmt = db.prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE job_id = ? LIMIT 20000)`);
  while (Number(stmt.run(jobId).changes) > 0) await pause();
}

// What the screens show for a migration's processing: the run in progress, or else the last finished run.
function processStatus(jobId) {
  const run = activeRuns.get(jobId);
  if (run) {
    const elapsed = (Date.now() - run.startedMs) / 1000;
    const workDone = run.stored + run.checked, workTotal = run.recordsTotal + run.checkTotal;
    // The time left is worked out from the rate seen so far, once there is at least two seconds of it.
    const working = run.workStartedMs ? (Date.now() - run.workStartedMs) / 1000 : 0;
    const eta = run.state === 'running' && working >= 2 && workDone > 0 ? Math.max(0, Math.round((workTotal - workDone) / (workDone / working))) : null;
    return { runId: run.runId, state: run.state, phase: run.phase, recordsDone: run.stored, recordsTotal: run.recordsTotal,
      percent: workTotal ? Math.min(99.9, Math.floor((workDone / workTotal) * 1000) / 10) : 0,
      elapsedSeconds: Math.round(elapsed * 10) / 10, estimatedSecondsRemaining: eta, error: null,
      startedAt: run.startedAt, finishedAt: null, startedBy: run.actor };
  }
  const r = db.prepare('SELECT * FROM process_runs WHERE job_id = ?').get(jobId);
  if (!r) return { runId: null, state: 'idle', phase: null, recordsDone: 0, recordsTotal: null, percent: 0, elapsedSeconds: null, estimatedSecondsRemaining: null, error: null, startedAt: null, finishedAt: null, startedBy: null };
  return { runId: r.run_id ?? null, state: r.state, phase: r.phase, recordsDone: r.done ?? 0, recordsTotal: r.total ?? null, percent: r.state === 'done' ? 100 : 0,
    elapsedSeconds: r.started_at && r.finished_at ? Math.round((new Date(r.finished_at) - new Date(r.started_at)) / 100) / 10 : null,
    estimatedSecondsRemaining: null, error: r.error ?? null, startedAt: r.started_at, finishedAt: r.finished_at, startedBy: r.actor,
    // M1: the journal routing decisions of the last finished run: how many were kept, and the ones that no longer match
    journalDecisions: lastRunJournalDecisions(r.result) };
}
function lastRunJournalDecisions(result) {
  try { const j = JSON.parse(result || 'null')?.journalDecisions; return j ? { kept: Number(j.kept) || 0, lost: Array.isArray(j.lost) ? j.lost : [] } : null; } catch { return null; }
}

// Starts a run, or returns the one already going for this migration.
function startProcessing(job, actor) {
  const existing = activeRuns.get(job.id);
  if (existing) return existing;
  const uploads = db.prepare('SELECT * FROM uploads WHERE job_id = ?').all(job.id);
  const run = {
    runId: `${job.id}-${Date.now().toString(36)}-${++runCounter}`, jobId: job.id, actor, state: 'queued', phase: 'Waiting to start',
    stored: 0, recordsTotal: uploads.reduce((t, u) => t + (u.records || 0), 0),
    checked: 0, checkTotal: uploads.filter(u => VOUCHER_SLOTS.includes(u.slot)).reduce((t, u) => t + (u.records || 0), 0),
    startedAt: now(), startedMs: Date.now(), workStartedMs: null, finishedAt: null, error: null, result: null,
  };
  activeRuns.set(job.id, run);
  saveRun(run);
  run.promise = pause().then(() => runProcessing(job, uploads, run));
  return run;
}

async function runProcessing(job, uploads, run) {
  const actor = run.actor;
  try {
    run.state = 'running'; run.phase = 'Removing the earlier results';
    saveRun(run);
    let reconciliationCleared = [], rejectionsCleared = [];
    tx(() => {
      // The data is read again, so earlier Zoho report checks no longer describe it. They are removed, never shown against new data.
      reconciliationCleared = clearReconciliation(job.id, null);
      rejectionsCleared = clearRejections(job.id, null);
      clearStale(job.id); // the generated files are removed below, so nothing is left to be out of date
      // M1: the journal routing decisions SURVIVE reading the files again. They are stored against the record id of
      // the voucher, which changes when the records are stored again, so each is saved here by the voucher's Tally
      // identifier (its guid) and attached to the same voucher again at the end of the run (reattachJournalDecisions).
      // The saved rows stay until a run finishes, so a run that fails loses nothing.
      db.prepare(`INSERT OR REPLACE INTO journal_decisions_kept (job_id, source_id, number, date, decision, suggested, decided_by, at)
        SELECT d.job_id, s.source_id, json_extract(s.data, '$.vouchernumber'), json_extract(s.data, '$.date'), d.decision, d.suggested, d.decided_by, d.at
        FROM journal_decisions d JOIN source_records s ON s.id = d.source_record_id AND s.job_id = d.job_id WHERE d.job_id = ? AND s.source_id IS NOT NULL`).run(job.id);
      for (const t of ['generated_files', 'held_vouchers', 'journal_credits', 'voucher_recon', 'journal_decisions', 'import_status', 'tax_usage', 'trial_balance_lines', 'trial_balance_summary', 'applied_defaults']) db.prepare(`DELETE FROM ${t} WHERE job_id = ?`).run(job.id);
      setStatus(job.id, 'processing');
    });
    auditReconciliationCleared(job.id, reconciliationCleared, 'the data was processed again', actor);
    for (const key of Object.keys(ALL_FILES)) fs.rmSync(retryFile(job.id, key), { force: true });
    auditRejectionsCleared(job.id, rejectionsCleared, 'the data was processed again', actor);
    for (const t of ['exceptions', 'generated_rows', 'source_records']) await deleteInBatches(t, job.id);

    // ---- store every record of every file ----
    run.workStartedMs = Date.now();
    const summary = [];
    const insRec = db.prepare('INSERT INTO source_records (job_id, slot, object_type, source_id, name, data) VALUES (?,?,?,?,?,?)');
    const insExc = db.prepare('INSERT INTO exceptions (job_id, stage, slot, source_id, name, message, kind) VALUES (?,?,?,?,?,?,?)');
    const asOf = (jobYear(job)?.to || '').replace(/-/g, '') || null;
    // Every voucher met so far, by its Tally identifier, with the dataset it is in: a voucher that is in two datasets
    // (for example in a file uploaded on its own and again in the All Transactions file, sorted elsewhere) is flagged.
    const voucherSeenIn = new Map();
    for (const u of uploads) {
      const slot = slotByKey[u.slot];
      run.phase = `Reading ${slot.name}`;
      await pause();
      const seen = new Set(); // identifiers met in this file, to flag duplicates
      // Likely duplicates: master names that are the same once line breaks, spaces and capital letters are ignored
      // (nameKey). Tally does not allow two masters with the same name, so this happens only through hidden characters.
      const byKey = new Map(); // type|nameKey -> { name, sid, gstin }
      let stored = 0, exceptions = 0, inFile = 0, pending = 0, open = false;
      try {
        db.exec('BEGIN'); open = true;
        for (const ev of readTallyFile(u.path)) {
          if (ev.type !== 'record') continue;
          const m = ev.value;
          inFile++;
          if (!m || typeof m !== 'object') throw new Error(`record ${inFile} is not a Tally record`);
          const type = entryType(m);
          const isVoucher = type === 'Voucher';
          // A master's name: top-level name, else metadata.name, else languagename (recordName); then the older fallbacks.
          const name = isVoucher ? `${entryVchType(m)} ${m.vouchernumber ?? ''}`.trim() : recordName(m) || tallyText(m.ledgername) || tallyText(m.stockitemname);
          // TALLY-001: a voucher with no guid or remote id is identified by its type, number, date AND its place in the file,
          // so two vouchers without a number never collide (a copy of a voucher is recognised by its guid only)
          const natural = isVoucher ? `${entryVchType(m)}|${m.vouchernumber}|${m.date}|${u.slot}#${inFile}` : `${type}|${name}`;
          const sid = sourceId(m, natural);
          const raise = (msg, kind = null) => { insExc.run(job.id, 'process', u.slot, sid, name, msg, kind); exceptions++; };
          if (!name) raise('Record has no name.');
          if (seen.has(sid)) {
            if (isVoucher) raise('This voucher is in this file twice (the same Tally identifier). A Tally voucher reaches Zoho Books once: only the first copy is written to a file; this copy is left out as a duplicate and is not counted in the checks. Export the file again from Tally if it should not hold the voucher twice.', 'voucher_duplicate');
            else raise('Duplicate record in this file.');
          }
          const firstTime = !seen.has(sid);
          seen.add(sid);
          if (!isVoucher && name && firstTime && !isReportLine(m)) { // the lines of a Trial Balance report are matched to the masters instead
            // The name is stored and written exactly as in Tally (vouchers refer to it that way); problems are flagged only.
            if (hasHiddenCharacters(name)) {
              raise(`The name contains ${/[\r\n]/.test(name) ? 'a line break' : 'a hidden character (for example an invisible character or a tab)'}${/^[\s​﻿]|[\s​﻿]$/.test(name) ? ' at its start or end' : ''}. `
                + 'It is kept and written to every Zoho file exactly as in Tally (vouchers that name this master without it are written with the same name). '
                + 'A warning only: names are passed as in Tally and will be filled in from the GST portal later. If Zoho Books rejects the name, clean it in Mapping Studio (Names).', 'name_hidden_characters');
            } else if (hasEdgeSpaces(name)) {
              raise('The name has spaces at its start or end. It is kept and written exactly as in Tally. A warning only: if Zoho Books rejects the name, clean it in Mapping Studio (Names).', 'name_edge_spaces');
            }
            const key = `${type}|${nameKey(name)}`;
            const gstin = type === 'Ledger' ? contactInfo(m, asOf).gstin : '';
            const other = byKey.get(key);
            if (other && other.sid !== sid) {
              const sameGstin = gstin && other.gstin && gstin === other.gstin;
              raise(`Possible duplicate: "${other.name}" in this file has the same name once line breaks, spaces and capital letters are ignored`
                + `${sameGstin ? ', and the same GSTIN' : gstin && other.gstin ? ', but a different GSTIN' : ''}. Both records are read from Tally and kept in the data. `
                // what the Zoho files do is decided later (names.js), so this message must not say more than is true here:
                // two contacts with one name are written as ONE party by default; it does not say "both are kept" in the files
                + (type === 'Ledger'
                  ? 'In the Zoho files, two customers or vendors with the same name are written as ONE party by default, because Zoho Books refuses two contacts with the same Display Name (see "Assumptions the tool made"). If they are different parties, choose "keep both" in Mapping Studio (Names, possible duplicates) and give one another name. Two accounts with the same name need a decision there.'
                  : 'Zoho Books would get two records whose names look the same: decide in Mapping Studio (Names, possible duplicates) whether they are the same.'), 'possible_duplicate');
            } else if (!other) byKey.set(key, { name, sid, gstin });
          }
          if (isVoucher) {
            const elsewhere = voucherSeenIn.get(sid);
            if (elsewhere && elsewhere !== u.slot) {
              raise(`This voucher is also in ${slotByKey[elsewhere].name}: the same Tally voucher is held in two datasets. A Tally voucher reaches Zoho Books once: only the copy stored first is written to a file and counted in the checks; this copy is left out as a duplicate. `
                + 'To clear this, remove it from one of the two uploaded files (or upload the All Transactions file again, which sorts every voucher into one dataset), then process again.', 'voucher_in_two_datasets');
            } else if (!elsewhere) voucherSeenIn.set(sid, u.slot);
            if (!isoDate(m.date)) {
              const impossible = impossibleDateWords(m.date);
              // an impossible day ("20250931") is never guessed into another date: the voucher is left out of the files
              // (vouchers.js, reason invalid_date) until the date is corrected in Tally and exported again
              if (impossible) raise(`The voucher date in the Tally export is "${m.date}", which is ${impossible}: there is no such day. Zoho Books refuses a date that does not exist, and the tool does not guess the right one, so this voucher is left out of the Zoho files. Correct the date of ${name} in Tally, export again and process again.`, 'voucher_date_invalid');
              else raise(`Voucher date "${m.date ?? ''}" is not readable (a date is written yyyymmdd, for example 20250401). The voucher is left out of the Zoho files until the date is corrected in Tally and exported again.`, 'voucher_date_invalid');
            }
            // A cancelled, optional or deleted voucher is kept and counted as its own flagged kind. Tally does not post
            // it to the books, so its lines are not checked (a cancelled voucher normally has none).
            const status = voucherStatus(m);
            if (status) raise(VOUCHER_STATUS_TEXT[status], `voucher_${status}`);
            else {
              const bal = voucherBalance(m);
              if (!bal.ok) raise(bal.unreadable ? `${bal.error}. The amount is not in a form the tool reads (plain figures, a figure with Dr or Cr, or Tally's foreign-currency form "-€8500.00 @ ₹91.80/€ = -₹780300.00"), so it is never counted as zero: the voucher is left out of the Zoho files. Check the voucher in Tally and export again.` : bal.error, bal.unreadable ? 'unreadable_amount' : null);
              // TALLY-013: a list of lines written as a single object, or with items that are not objects, is read safely
              if (oddListShape(m)) raise('A list of lines of this voucher is written in an unusual form in the export (a single object instead of a list, or an empty item). It was read as a list and empty items were skipped; nothing else was changed. Check the voucher in Tally.', 'voucher_list_shape');
              const picked = ledgerEntryList(m);
              if (picked.both) {
                raise(`This voucher carries lines in both "allledgerentries" and "ledgerentries". Adding both up could count every line twice, so ${picked.used === 'both lists together' ? 'the two lists were read together, because neither balances alone' : `only "${picked.used}" was read, because the voucher balances on it`}. Check this voucher in Tally.`, 'voucher_lines_in_both_lists');
              }
            }
          }
          insRec.run(job.id, u.slot, type, sid, name, JSON.stringify(m)); // source values stored unchanged
          stored++; run.stored++;
          if (++pending >= PROCESS_BATCH) {
            db.exec('COMMIT'); open = false; pending = 0;
            await pause(); // other requests are served here; no transaction is open meanwhile
            db.exec('BEGIN'); open = true;
          }
        }
        db.exec('COMMIT'); open = false;
      } catch (e) {
        if (open) { try { db.exec('ROLLBACK'); } catch { /* nothing open */ } }
        throw new Error(`${slot.name}: the uploaded file "${u.file_name}" could not be read (${e.message}). Upload the file again.`);
      }
      // control totals: the file must hold what it held when it was uploaded, and every record must be stored
      if (inFile !== u.records) throw new Error(`Control total failed for ${slot.name}: the file had ${u.records} records when it was uploaded, but ${inFile} were read now. Upload the file again.`);
      if (stored !== inFile) throw new Error(`Control total failed for ${slot.name}: file has ${inFile}, stored ${stored}`);
      summary.push({ slot: u.slot, name: slot.name, inFile, stored, exceptions });
    }

    // ---- the financial year the files follow (tally.js jobYear) ----
    // A year typed on New Migration is kept. Otherwise the year is worked out again from the files just stored: 1 April
    // to 31 March, unless Tally's books begin on the first day of another month and the vouchers fall in the twelve
    // months from that day (yearStartFromData). The year found is flagged, so it is never silent.
    if (job.year_source !== 'user') {
      const books = db.prepare("SELECT json_extract(data, '$.startingfrom') d, COUNT(*) n FROM source_records WHERE job_id = ? AND object_type = 'Ledger' AND json_extract(data, '$.startingfrom') IS NOT NULL GROUP BY d ORDER BY n DESC, d LIMIT 1").get(job.id)?.d;
      const dates = Object.fromEntries(db.prepare("SELECT json_extract(data, '$.date') d, COUNT(*) n FROM source_records WHERE job_id = ? AND object_type = 'Voucher' GROUP BY d").all(job.id).map(r => [String(r.d ?? ''), r.n]));
      const found = yearStartFromData(job.financial_year, books, dates);
      db.prepare('UPDATE migrations SET year_start = ?, year_source = ? WHERE id = ?').run(found?.yearStart || null, found ? 'data' : null, job.id);
      job = getJob(job.id);
      if (found) {
        const y = jobYear(job);
        insExc.run(job.id, 'process', 'accounts', null, `Financial year ${y.from} to ${y.to}`,
          `The financial year of this migration is taken as ${y.from} to ${y.to}, not 1 April to 31 March: Tally's books begin on ${found.booksFrom} (the "starting from" date of the ledgers), `
          + `and ${found.inYear} vouchers fall in these twelve months against ${found.inApril} in 1 April to 31 March. Vouchers outside this year are left out of the files, `
          + `and the opening balance journal is dated the day before it starts. If this is not the company's year, set the year start on New Migration and process again.`, 'financial_year_from_data');
      }
    }
    const year = jobYear(job);

    // ---- cross-checks between vouchers and masters. They flag only: nothing is blocked or changed. ----
    run.phase = 'Checking vouchers against the masters';
    await pause();
    const names = (slot, type = 'Ledger') => db.prepare('SELECT name FROM source_records WHERE job_id = ? AND slot = ? AND object_type = ? ORDER BY id').all(job.id, slot, type).map(r => r.name);
    const has = slot => uploads.some(u => u.slot === slot);
    const taxNames = names('taxes');
    const checker = createCrossCheck({
      masters: { customers: names('customers'), vendors: names('vendors'), accounts: names('accounts'), taxes: taxNames },
      items: has('stock_items') ? db.prepare("SELECT id, name, json_extract(data, '$.baseunits') unit FROM source_records WHERE job_id = ? AND slot = 'stock_items' AND object_type = 'StockItem' ORDER BY id").all(job.id)
        .map(i => ({ ...i, unit: tallyText(i.unit) })) : null, // Tally's "not applicable" marker is no unit
      units: has('units') ? names('units', 'Unit') : null,
    });
    // which tax ledgers are used, on which side of an invoice or bill, and together with which, for tax mapping
    const usage = taxUsageCollector(taxNames, { customers: new NameSet(names('customers')), vendors: new NameSet(names('vendors')) });
    const page = db.prepare("SELECT id, slot, name, data FROM source_records WHERE job_id = ? AND slot = ? AND object_type = 'Voucher' AND id > ? ORDER BY id LIMIT ?");
    // The movement of every ledger (total debits and credits of its voucher lines), for the Trial Balance check.
    const movement = movementCollector();
    const excluded = { cancelled: 0, optional: 0, deleted: 0 }; // vouchers Tally does not post: left out of every check (and void, only when one is: TALLY-007)
    const otherRouter = voucherRouter(voucherTypesOf(job.id)); // the voucher types met in "Other Voucher Types"
    // TALLY-001: a second copy of a voucher (same Tally identifier) is counted once: the copy stored first
    const duplicateIds = new Set(duplicateVoucherMap(job.id).keys());
    let otherNotPosted = 0;
    for (const slot of VOUCHER_SLOTS) {
      let last = 0;
      for (;;) {
        const rows = page.all(job.id, slot, last, PROCESS_BATCH);
        if (!rows.length) break;
        for (const r of rows) {
          const data = JSON.parse(r.data);
          if (duplicateIds.has(r.id)) continue;
          const status = voucherStatus(data);
          // TALLY-002: a voucher of another type is counted by type; one that posts to the ledgers (not a type Tally never
          // posts, and a ledger amount on it) is written as a Manual Journal, so it is checked and in the movement too
          const other = slot === OTHER_SLOT ? otherRouter.route(entryVchType(data)) : null;
          if (other) other.vouchers++;
          if (other && (isNonPostingBase(other.base) || !hasPostingLines(data))) { otherNotPosted++; continue; }
          if (status) excluded[status] = (excluded[status] || 0) + 1;
          else {
            checker.add({ id: r.id, slot: r.slot, name: r.name, data });
            usage.add(r.slot, data);
            // Tally's Trial Balance of the year holds only the vouchers of the year: a voucher dated outside it is not in
            // the movement (the same rule as the files: vouchers.js voucherYearOutcome). A voucher whose date cannot be
            // read is counted: Tally posted it in the year (the export only wrote its date wrong).
            if (voucherYearOutcome(data, year) !== 'outside_year') movement.add(voucherLines(data));
          }
        }
        last = rows[rows.length - 1].id;
        run.checked += rows.length;
        await pause();
      }
    }
    // The Trial Balance: a file of Trial Balance lines is checked by name as before; the lines of a Tally Trial Balance
    // report are matched to ledgers and groups and checked against the vouchers (trialbalance.js).
    const tbRows = db.prepare("SELECT id, slot, name, data FROM source_records WHERE job_id = ? AND slot = 'trial_balance' AND object_type = 'TrialBalanceLine' ORDER BY id").all(job.id)
      .map(r => ({ ...r, data: JSON.parse(r.data) }));
    const reportRows = tbRows.filter(r => isReportLine(r.data));
    const crossChecks = checker.finish(tbRows.filter(r => !isReportLine(r.data)).map(({ id, slot, name }) => ({ id, slot, name })));
    const otherTypes = otherRouter.summary();
    for (const t of otherTypes) {
      crossChecks.push({ kind: t.how === 'unresolved' ? 'voucher_type_not_resolved' : 'voucher_type_no_dataset', slot: OTHER_SLOT, name: t.type, uses: t.vouchers,
        message: otherTypeMessage(t, !!voucherTypesOf(job.id)) });
    }
    // Vouchers of the All Transactions file that are in no dataset (see not_placed on transaction_bundles).
    for (const n of allTransactionsInfo(job.id)?.notPlaced || []) {
      crossChecks.push({ kind: 'vouchers_in_no_dataset', slot: n.slot, name: n.name, uses: n.vouchers, message: notPlacedMessage(n) });
    }
    let trialBalance = null;
    if (reportRows.length) {
      run.phase = 'Checking the Trial Balance against the vouchers';
      await pause();
      const masters = masterIndex(db.prepare("SELECT object_type type, data FROM source_records WHERE job_id = ? AND slot IN ('customers','vendors','accounts','taxes') AND object_type IN ('Ledger','Group') ORDER BY id").all(job.id)
        .map(r => ({ type: r.type, data: (({ metadata, name, parent, languagename }) => ({ metadata, name, parent, languagename }))(JSON.parse(r.data)) })));
      const otherVouchers = otherNotPosted; // the vouchers of other types that post nothing (the others are in the movement)
      const tbContext = { excluded: excluded.cancelled + excluded.optional + excluded.deleted + (excluded.void || 0), otherVouchers };
      trialBalance = analyseTrialBalance({ lines: reportRows.map(r => r.data), ...masters, movement, context: tbContext });
      // Round 1 (issues 3, 7, 8, 11): a ledger in the Trial Balance report, missing from the masters, under a known group:
      // its record is made from the report (and the party details of its vouchers), so the files create it. The report
      // is then read again with it, so its line is compared like any other ledger.
      if (trialBalance.summary.mastersAvailable) {
        const groupRecords = db.prepare("SELECT data FROM source_records WHERE job_id = ? AND slot = 'accounts' AND object_type = 'Group' ORDER BY id").all(job.id).map(r => JSON.parse(r.data));
        const vouchersNaming = name => db.prepare("SELECT data FROM source_records WHERE job_id = ? AND object_type = 'Voucher' AND (json_extract(data, '$.partyledgername') = ? OR instr(data, ?) > 0) ORDER BY id LIMIT 50")
          .all(job.id, name, JSON.stringify(name)).map(r => JSON.parse(r.data));
        const made = ledgersFromTrialBalance({ analysed: trialBalance.lines, groupRecords, vouchersNaming });
        if (made.added.length) {
          const insMade = db.prepare('INSERT INTO source_records (job_id, slot, object_type, source_id, name, data) VALUES (?,?,?,?,?,?)');
          tx(() => { for (const a of made.added) for (const slot of a.slots) insMade.run(job.id, slot, 'Ledger', `trial-balance-line-${a.lineNo}`, a.name, JSON.stringify(a.record)); });
          for (const a of made.added) {
            masters.ledgers.push({ name: a.name, parent: a.group });
            crossChecks.push({ kind: 'trial_balance_ledger_added', slot: a.slots[0], name: a.name, uses: 1, message: addedLedgerWords(a.name, a.record.__fromTrialBalance, a.slots) });
          }
          trialBalance = analyseTrialBalance({ lines: reportRows.map(r => r.data), ...masters, movement, context: tbContext });
        }
      }
      trialBalance.ids = Object.fromEntries(reportRows.map(r => [r.data.lineno, r.id]));
      for (const f of trialBalance.flags) crossChecks.push({ ...f, slot: 'trial_balance' });
    }

    // ---- the last step: only now is the migration shown as processed ----
    run.phase = 'Finishing';
    let journalDecisions = { kept: 0, lost: [] };
    tx(() => {
      journalDecisions = reattachJournalDecisions(job.id);
      const insCheck = db.prepare("INSERT INTO exceptions (job_id, stage, slot, source_id, name, message, kind, uses) VALUES (?,'crosscheck',?,NULL,?,?,?,?)");
      for (const c of crossChecks) insCheck.run(job.id, c.slot, c.name, c.message, c.kind, c.uses);
      saveTaxUsage(db, job.id, usage.result(), now());
      db.prepare('DELETE FROM trial_balance_lines WHERE job_id = ?').run(job.id);
      db.prepare('DELETE FROM trial_balance_summary WHERE job_id = ?').run(job.id);
      if (trialBalance) {
        const insLine = db.prepare('INSERT INTO trial_balance_lines (job_id, line_no, source_record_id, data) VALUES (?,?,?,?)');
        for (const l of trialBalance.lines) insLine.run(job.id, l.lineNo, trialBalance.ids[l.lineNo] ?? null, JSON.stringify(l));
        db.prepare('INSERT INTO trial_balance_summary (job_id, data) VALUES (?,?)').run(job.id, JSON.stringify(trialBalance.summary));
      }
      setStatus(job.id, 'processed');
    });
    audit(job.id, 'process', `${summary.reduce((a, s) => a + s.stored, 0)} records stored, ${summary.reduce((a, s) => a + s.exceptions, 0)} exceptions, ${crossChecks.length} cross-check item(s)`
      + (trialBalance ? `; Trial Balance report: ${trialBalance.summary.lines} lines, ${trialBalance.summary.movement.agree} of ${trialBalance.summary.movement.checked} movement checks agree${trialBalance.summary.movement.unreadableLines ? `, unreadable lines: ${trialBalance.summary.movement.unreadableLines}` : ''}` : ''), actor);
    if (journalDecisions.kept || journalDecisions.lost.length) {
      audit(job.id, 'journal_decisions_kept', `${journalDecisions.kept} journal routing decision(s) were kept: each was attached again to the same Tally voucher.`
        + (journalDecisions.lost.length ? ` ${journalDecisions.lost.length} decision(s) no longer match a journal voucher and were dropped: ${journalDecisions.lost.map(l => `journal ${l.number || '(no number)'} of ${l.date || '(no date)'}, was ${l.decision} (${l.why})`).join('; ')}.` : ''), actor);
    }
    run.state = 'done'; run.phase = 'Finished';
    // ledgerNames: how the different ledger names on voucher lines compare with the masters (exact, only after ignoring hidden characters, not found)
    // journalDecisions: the routing decisions made before this run: how many were kept, and the ones that no longer match
    run.result = { summary, crossChecks: crossChecks.length, ledgerNames: checker.stats(), vouchersNotPosted: excluded, journalDecisions,
      ...(trialBalance ? { trialBalance: trialBalance.summary } : {}) };
  } catch (e) {
    run.state = 'failed';
    run.error = `Processing stopped: ${e.message}`;
    try { await removePartialRun(job.id); } catch (e2) { run.error += ` The clean-up also failed (${e2.message}).`; }
    audit(job.id, 'process_failed', `${run.error} Everything stored by this run was removed; nothing is shown as processed.`, actor);
  } finally {
    run.finishedAt = now();
    activeRuns.delete(job.id);
    saveRun(run);
  }
  return run;
}

// M1: attaches the journal routing decisions saved before the run (journal_decisions_kept) to the vouchers stored now,
// each to the journal voucher with the same Tally identifier. A decision whose voucher is no longer a journal in the
// files, is cancelled or optional now, or can no longer be written that way (the party is on the other side) is not
// attached: it is returned in lost, audited and shown, never dropped silently. Call inside a transaction.
// Returns { kept, lost: [{ number, date, decision, decidedBy, why }] }.
function reattachJournalDecisions(jobId) {
  const saved = db.prepare('SELECT * FROM journal_decisions_kept WHERE job_id = ? ORDER BY rowid').all(jobId);
  if (!saved.length) return { kept: 0, lost: [] };
  const find = db.prepare("SELECT id, data FROM source_records WHERE job_id = ? AND slot = 'journal' AND source_id = ? ORDER BY id LIMIT 1");
  const ins = db.prepare('INSERT OR REPLACE INTO journal_decisions (job_id, source_record_id, decision, suggested, decided_by, at) VALUES (?,?,?,?,?,?)');
  const party = partySets(jobId);
  let kept = 0;
  const lost = [];
  for (const k of saved) {
    const r = find.get(jobId, k.source_id);
    const v = r ? JSON.parse(r.data) : null;
    let why = null;
    if (!r) why = 'the voucher is no longer a journal voucher in the files';
    else if (voucherStatus(v)) why = `the voucher is ${voucherStatus(v)} in Tally now`;
    else if (!DECISIONS.includes(k.decision)) why = 'the decision is not one the platform knows';
    else if (k.decision !== 'Manual Journal' && partyDocParty(v, k.decision, k.decision === 'Invoice' ? party.customers : party.vendors).kind === 'left_out_party_side') why = `the voucher changed and can no longer be ${k.decision === 'Invoice' ? 'an invoice' : 'a bill'}`;
    if (why) { lost.push({ number: tallyText(k.number), date: isoDate(k.date) || '', decision: k.decision, decidedBy: k.decided_by, why }); continue; }
    ins.run(jobId, r.id, k.decision, k.suggested, k.decided_by, k.at);
    kept++;
  }
  db.prepare('DELETE FROM journal_decisions_kept WHERE job_id = ?').run(jobId);
  return { kept, lost };
}

// Removes what an unfinished run stored and puts the migration back to "not processed".
async function removePartialRun(jobId) {
  for (const t of ['exceptions', 'source_records']) await deleteInBatches(t, jobId);
  for (const t of ['tax_usage', 'trial_balance_lines', 'trial_balance_summary']) db.prepare(`DELETE FROM ${t} WHERE job_id = ?`).run(jobId);
  setStatus(jobId, 'awaiting_uploads');
}

// A server that stopped during a run leaves the run marked queued or running, with part of the data stored.
// At start-up such runs are closed as failed and their partial data is removed, so a migration is never stuck.
export function recoverInterruptedRuns() {
  const stuck = new Set([
    ...db.prepare("SELECT job_id FROM process_runs WHERE state IN ('queued', 'running')").all().map(r => r.job_id),
    ...db.prepare("SELECT id FROM migrations WHERE status = 'processing'").all().map(r => r.id),
  ]);
  for (const jobId of stuck) {
    for (const t of ['exceptions', 'source_records', 'tax_usage', 'trial_balance_lines', 'trial_balance_summary']) db.prepare(`DELETE FROM ${t} WHERE job_id = ?`).run(jobId);
    setStatus(jobId, 'awaiting_uploads');
    const error = 'Processing stopped: the server was restarted while processing was running. Everything stored by that run was removed. Start processing again.';
    const changed = db.prepare("UPDATE process_runs SET state = 'failed', phase = 'Stopped', error = ?, finished_at = ? WHERE job_id = ?").run(error, now(), jobId).changes;
    if (!Number(changed)) db.prepare("INSERT INTO process_runs (job_id, state, phase, error, finished_at, actor) VALUES (?, 'failed', 'Stopped', ?, ?, 'system')").run(jobId, error, now());
    audit(jobId, 'process_failed', error, 'system');
  }
}
recoverInterruptedRuns();

// ---------- reconciliation results follow the generated files ----------
// A Zoho report check (records matched, amounts compared) describes one generated file. When that file changes,
// the check is removed so it is never shown against different figures. keep(key) says which checks may stay;
// pass null to remove all. Returns the modules whose check was removed. Call inside a transaction.
function clearReconciliation(jobId, keep) {
  const cleared = [];
  const keys = new Set([
    ...db.prepare('SELECT DISTINCT key FROM verification WHERE job_id = ?').all(jobId).map(r => r.key),
    ...db.prepare('SELECT key FROM verification_runs WHERE job_id = ?').all(jobId).map(r => r.key),
  ]);
  for (const key of keys) {
    if (keep && keep(key)) continue;
    db.prepare('DELETE FROM verification WHERE job_id = ? AND key = ?').run(jobId, key);
    db.prepare('DELETE FROM verification_runs WHERE job_id = ? AND key = ?').run(jobId, key);
    cleared.push(ALL_FILES[key]?.module || key);
  }
  return cleared;
}
const auditReconciliationCleared = (jobId, modules, why, actor = currentActor) => {
  if (modules.length) audit(jobId, 'reconciliation_cleared', `${modules.join(', ')}: the earlier Zoho report check was removed because ${why}. Upload the Zoho report again.`, actor);
};

// ---------- rejections follow the generated files ----------
// Rejections, their corrections and the retry file describe the rows of one generated file. When that file changes
// they are removed, exactly like the Zoho report checks above. keep(key) says which may stay; null removes all.
// Returns [{ key, module, rejections, corrections }] for what was removed. Call inside a transaction.
const retryFile = (jobId, key) => path.join(DATA_DIR, 'output', jobId, `retry_${ALL_FILES[key].file}`);
function clearRejections(jobId, keep) {
  const cleared = [];
  const keys = new Set([
    ...db.prepare('SELECT DISTINCT key FROM rejections WHERE job_id = ?').all(jobId).map(r => r.key),
    ...db.prepare('SELECT DISTINCT key FROM corrections WHERE job_id = ?').all(jobId).map(r => r.key),
  ]);
  for (const key of keys) {
    if (keep && keep(key)) continue;
    const rejections = db.prepare('DELETE FROM rejections WHERE job_id = ? AND key = ?').run(jobId, key).changes;
    const corrections = db.prepare('DELETE FROM corrections WHERE job_id = ? AND key = ?').run(jobId, key).changes;
    db.prepare('DELETE FROM rejection_runs WHERE job_id = ? AND key = ?').run(jobId, key);
    cleared.push({ key, module: ALL_FILES[key]?.module || key, rejections: Number(rejections), corrections: Number(corrections) });
  }
  return cleared;
}
const auditRejectionsCleared = (jobId, cleared, why, actor = currentActor) => {
  for (const c of cleared) {
    audit(jobId, 'rejections_cleared', `${c.module}: ${c.rejections} rejection(s), ${c.corrections} correction(s) and the retry file were removed because ${why}. If Zoho rejects rows of the new file, upload that rejection file.`, actor);
  }
};

// ---------- journal routing ----------
// The customer, vendor and tax ledger names of the masters. A NameSet also finds a name that differs from the master's
// only by hidden characters (a line break at the end of the master's name), so vouchers that write the name without
// them are still recognised. Every ledger under Sundry Debtors, Sundry Creditors and Duties & Taxes is in these sets,
// at any depth of sub-group: the All Masters upload follows the group chain when it fills the three datasets.
function partySets(jobId) {
  const names = slot => new NameSet(db.prepare('SELECT name FROM source_records WHERE job_id = ? AND slot = ?').all(jobId, slot).map(r => r.name));
  return { customers: names('customers'), vendors: names('vendors'), taxLedgers: names('taxes') };
}

// What kind of ledger a name is (income, expense, asset, tax, bank ...), from Tally's own group above it. The group
// chain is walked up through the uploaded Group records; a renamed Tally group is recognised by its reserved name.
// Returns kindOf(name): the kind, 'other' when no group of the chain is one the platform knows, or null when the ledger
// is not in the masters or its group chain cannot be followed (no Group records uploaded and a sub-group above it).
// The Tally group of each ledger of the masters (its own group, not the main group), keyed by matchKey of its name.
function ledgerParents(jobId) {
  const parents = new Map();
  for (const r of db.prepare("SELECT name, json_extract(data, '$.parent') parent FROM source_records WHERE job_id = ? AND slot IN ('customers','vendors','accounts','taxes') AND object_type = 'Ledger' ORDER BY id").all(jobId)) {
    const k = matchKey(r.name);
    if (k && !parents.has(k)) parents.set(k, tallyText(r.parent));
  }
  return parents;
}

function ledgerKinds(jobId, parents = ledgerParents(jobId)) {
  const tree = groupTree(db.prepare("SELECT data FROM source_records WHERE job_id = ? AND slot = 'accounts' AND object_type = 'Group' ORDER BY id").all(jobId)
    .map(r => (({ metadata, name, parent, languagename }) => ({ metadata, name, parent, languagename }))(JSON.parse(r.data))));
  const cache = new Map();
  return name => {
    const key = matchKey(name);
    if (cache.has(key)) return cache.get(key);
    let kind = null;
    if (parents.has(key)) {
      const seen = new Set();
      let g = parents.get(key), complete = false;
      for (; g && !seen.has(g); g = tree.parents[g]) {
        seen.add(g);
        kind = LEDGER_KIND_BY_GROUP[g] || LEDGER_KIND_BY_GROUP[tree.reserved[g]] || null;
        if (kind) break;
        if (!(g in tree.parents)) break;            // the group is not in the uploaded Group records: the chain stops here
        if (!tree.parents[g] || String(tree.parents[g]).includes('\u0004')) { complete = true; break; } // a top-level group
      }
      if (!kind && (complete || !g)) kind = 'other';
    }
    cache.set(key, kind);
    return kind;
  };
}

// Journal vouchers that are cancelled, optional or deleted in Tally (each was flagged when the data was processed).
const journalsNotPosted = jobId => db.prepare("SELECT COUNT(*) n FROM exceptions WHERE job_id = ? AND stage = 'process' AND slot = 'journal' AND kind IN ('voucher_cancelled','voucher_optional','voucher_deleted')").get(jobId).n;

// Every journal voucher with its suggestion, its decision and what the review screen needs (journalreview.js):
//   lines: [{ ledger (as Tally writes it), name (shown: without hidden characters), written (the name in the Zoho files,
//     through the one name resolver), group (the ledger's Tally group, null when not in the masters), kind, debit, credit }]
//   total: the debit total; party: 'customer' | 'vendor' | 'both' | 'none' (which kinds of party ledger are on it);
//   pattern: { key, debit: [groups], credit: [groups] };
//   refused: { Invoice?, Bill? }: why the journal cannot be routed there (the customer credited, the vendor debited);
//     the same rule the routing routes apply, one journal or many;
//   leftOut: { Invoice?, Bill?, 'Manual Journal'? }: why the journal would be routed but still left out of the file;
//   notParty: { Invoice?, Bill? }: the party it would be written with is not a customer (vendor) in the masters.
// The voucher build of the current data and decisions (what "Create the files" writes for the vouchers), kept while
// nothing changes. Read only: callers must not change it.
// What the documents of the batch show about its TDS and reverse charge ledgers and its vendors outside India
// (taxposting.js): from a first pass over the sales, purchase and journal vouchers, built WITHOUT that evidence. Kept
// while nothing changes. The decisions (decisions.js loadDecisions) read it through the provider below.
let taxEvidenceRunning = false;
function taxEvidenceOf(jobId) {
  if (taxEvidenceRunning) return null; // the first pass itself never asks for the evidence
  return cachedState('taxEvidence', jobId, () => {
    taxEvidenceRunning = true;
    try { return taxEvidenceFrom(voucherBuild(jobId, makeContext(db, jobId, { noTaxEvidence: true }), ['sales', 'purchase', 'journal']).built.taxPostings); }
    catch { return null; }
    finally { taxEvidenceRunning = false; }
  });
}
setTaxEvidenceProvider((d, jobId) => (d === db ? taxEvidenceOf(jobId) : null));
const cachedVoucherBuild = jobId => cachedState('voucherBuild', jobId, () => voucherBuild(jobId, makeContext(db, jobId)));
// What the routing of a journal needs, the same as the voucher build (routingOptions in vouchers.js).
const journalContext = (jobId, parents = ledgerParents(jobId)) => ({ ...partySets(jobId), kindOf: ledgerKinds(jobId, parents), taxInfo: taxLedgerInfos(db, jobId),
  tdsMap: tdsMappings(db, jobId), ...voucherDefaults(db, jobId) });
// The routing the files give the journals with no decision: from the voucher build when it is kept already, else from a
// build of the journal vouchers alone (the routing of a journal depends on that journal only; audit item 4: faster).
const journalRoutes = jobId => {
  const full = stateCache.get(`voucherBuild|${jobId}`);
  if (full && full.sig === stateSig(jobId)) return full.value.built.routes;
  return cachedState('journalRoutes', jobId, () => voucherBuild(jobId, makeContext(db, jobId), ['journal']).built.routes);
};
// listJournals, kept while nothing changes (a new array each time; the journals in it must not be changed)
const listJournals = jobId => cachedState('journals', jobId, () => listJournalsNow(jobId)).slice();
function listJournalsNow(jobId) {
  const parents = ledgerParents(jobId);
  const ctx = journalContext(jobId, parents);
  const kindOf = ctx.kindOf;
  const routing = routingOptions(ctx);
  // v2 (audit item 6): what the files do with a journal that has no decision is read from the SAME build as the files
  // (after the fallback to Manual Journal), so Voucher Classification, Prepare and the files agree
  let routes = new Map();
  try { routes = journalRoutes(jobId) || new Map(); } catch { routes = new Map(); }
  const outputName = loadDecisions(db, jobId).outputName;
  const decisions = Object.fromEntries(db.prepare('SELECT * FROM journal_decisions WHERE job_id = ?').all(jobId).map(d => [d.source_record_id, d]));
  return db.prepare("SELECT * FROM source_records WHERE job_id = ? AND slot = 'journal' ORDER BY id").all(jobId).map(r => {
    const v = JSON.parse(r.data);
    const s = suggestJournal(v, ctx.customers, ctx.vendors, routing);
    const bal = voucherBalance(v);
    const status = voucherStatus(v); // cancelled, optional or deleted: never written to a file, so it needs no routing
    const vl = voucherLines(v);
    let total = new Decimal(0);
    const lines = vl.map(l => {
      if (l.amount?.isNegative()) total = total.plus(l.amount.abs());
      const group = parents.get(matchKey(l.ledger));
      return { ledger: l.ledger, name: cleanName(l.ledger), written: visibleName(outputName(l.ledger)), group: group || null, kind: kindOf(l.ledger),
        debit: l.amount?.isNegative() ? l.amount.abs().toFixed(2) : '', credit: l.amount && !l.amount.isNegative() ? l.amount.toFixed(2) : '' };
    });
    const hasCustomer = vl.some(l => ctx.customers.has(l.ledger)), hasVendor = vl.some(l => ctx.vendors.has(l.ledger));
    const refused = {}, leftOut = {}, notParty = {};
    for (const [decision, set] of [['Invoice', ctx.customers], ['Bill', ctx.vendors]]) {
      const p = partyDocParty(v, decision, set);
      if (p.kind === 'left_out_party_side') refused[decision] = p.error.replace(/^Left out of the file: /, '');
      else if (p.error) leftOut[decision] = p.error.replace(/^Left out of the file: /, '');
      // the voucher names a party ledger that is not of this kind (for example a vendor named as the party of an invoice)
      else if (p.party && !set.has(p.party.ledger)) notParty[decision] = `The ${decision === 'Invoice' ? 'invoice' : 'bill'} would be made out to "${cleanName(p.party.ledger)}", which is not a ${decision === 'Invoice' ? 'customer' : 'vendor'} in the masters, so the import is expected to fail for it.`;
    }
    if (!bal.ok) for (const d of DECISIONS) leftOut[d] ||= `${bal.error}.`;
    const d = decisions[r.id];
    // v2 default 8: what the files do with this journal while no decision is made (the same rule as buildVoucherOutput)
    const built = routes.get(r.id);
    const byDefault = d || status ? null : built || defaultJournalRoute(s, {
      reimbursement: isReimbursementJournal(lines.map(l => ({ ledger: l.ledger, debit: !!l.debit, kind: ctx.taxLedgers.has(l.ledger) ? 'tax' : l.kind })), v.narration),
      usable: x => x === 'Manual Journal' || (!refused[x] && !leftOut[x] && !notParty[x]) });
    return {
      defaultDecision: byDefault?.decision || null, defaultKind: byDefault?.kind || null,
      defaultWords: byDefault ? ASSUMPTIONS[byDefault.kind]?.words || null : null,
      // the suggestion was a Bill or Invoice, but as one Zoho would refuse it or lose its GST (vouchers.js FALLBACK_WORDS)
      defaultFallback: byDefault?.fallback || null, defaultFallbackWords: byDefault?.fallback ? FALLBACK_WORDS[byDefault.fallback] || null : null,
      id: r.id, sourceId: r.source_id, number: v.vouchernumber ?? '', date: isoDate(v.date), narration: v.narration || '',
      lines, total: total.toFixed(2), party: hasCustomer && hasVendor ? 'both' : hasCustomer ? 'customer' : hasVendor ? 'vendor' : 'none',
      pattern: journalPattern(lines),
      balanced: bal.ok, problem: bal.ok ? null : bal.error,
      // clear false: not a plain sale, purchase or journal. needsCheck true: a Bill or Invoice that would carry a
      // negative row. Neither is approved by "accept the clear suggestions".
      suggested: s.suggested, reason: s.reason, clear: s.clear, needsCheck: !!s.needsCheck, decision: d?.decision || null,
      decidedBy: d?.decided_by || null, decidedAt: d?.at || null, refused, leftOut, notParty,
      notPosted: status, notPostedReason: status ? VOUCHER_STATUS_TEXT[status] : null,
    };
  });
}

// ---------- import tracking ----------
// Import order and prerequisites: ONE source, the Import Wizard's plan (importwizard.js stepPlan, from zohorules.json
// import_order), so Prepare migration, the test report, the dashboard, the wizard and the zip all give the same order.
// A file is ready only when every prerequisite file that exists for this migration has been confirmed as imported.
// The Opening Balances file is a reference report (TEMPLATES.opening_balances.referenceOnly), not imported. Each
// opening balance goes in exactly once: with the Chart of Accounts (ordinary accounts), the Customers and Vendors files
// (contacts), or the opening balance journal opening_balances_for_zoho_accounts (the wizard's opening balances step).
// zohoSetup: what must exist in Zoho Books before the file is imported and is not in any file.
const ZOHO_SETUP = {
  invoices: ['The GST taxes and tax groups named in Mapping Studio (Tax mapping) exist in Zoho Books with those exact names and rates.',
    'The TDS taxes named in Mapping Studio (TDS mapping) exist in Zoho Books (tax deducted by customers).'],
  bills: ['The GST taxes and tax groups named in Mapping Studio (Tax mapping) exist in Zoho Books with those exact names and rates.',
    'TDS is turned on in Zoho Books and the TDS taxes named in Mapping Studio (TDS mapping) exist with those names, sections and rates.',
    'Reverse charge is turned on in Zoho Books (GST Settings) when a bill carries the Reverse Charge columns.'],
};
const importOrder = (jobId, fileKeys) => planFor(db, jobId, fileKeys).filter(p => (p.kind === 'file' || p.kind === 'opening') && p.key && fileKeys.includes(p.key))
  .map(p => ({ key: p.key, needs: p.needs.filter(n => n !== p.key), zohoSetup: ZOHO_SETUP[p.key] || [] }));
const IMPORT_STATES = ['generated', 'downloaded', 'imported', 'partial', 'failed'];

function importList(jobId) {
  const files = Object.fromEntries(db.prepare('SELECT * FROM generated_files WHERE job_id = ?').all(jobId).map(f => [f.key, f]));
  const st = Object.fromEntries(db.prepare('SELECT * FROM import_status WHERE job_id = ?').all(jobId).map(r => [r.key, r]));
  let step = 0;
  const stale = staleInfo(jobId);
  const IMPORT_ORDER = importOrder(jobId, Object.keys(files).filter(k => !ALL_FILES[k]?.referenceOnly));
  // Rows Zoho refused in a file (from its error file, uploaded in the Rejection Manager) that have not been imported
  // again yet. v2 (docs/ZOHO_IMPORT_RULES.md, "One failure caused most of the others"): a file is NOT ready while a file
  // it depends on has refused rows, even when that file is marked as imported: in the first test import every bank
  // journal failed only because four account rows had been refused.
  const refused = Object.fromEntries(db.prepare("SELECT key, COUNT(*) n FROM rejections WHERE job_id = ? AND status <> 'retried' GROUP BY key").all(jobId).map(r => [r.key, r.n]));
  return IMPORT_ORDER.filter(o => files[o.key]).map(o => {
    const f = files[o.key];
    const why = stale.forFile(o.key);
    const notImported = o.needs.filter(n => files[n] && st[n]?.status !== 'imported');
    const withRefused = o.needs.filter(n => files[n] && refused[n] && !notImported.includes(n));
    const waitingFor = [...notImported, ...withRefused].map(n => files[n].module);
    return {
      step: ++step, key: o.key, module: f.module, fileName: f.file_name, rows: f.rows,
      status: st[o.key]?.status || 'generated', note: st[o.key]?.note || '', updatedAt: st[o.key]?.updated_at || f.generated_at,
      ready: waitingFor.length === 0, waitingFor, zohoSetup: o.zohoSetup || [],
      // refusedRows: rows of THIS file Zoho refused and that are not imported again; waitingForRefused: the files it
      // depends on that still have such rows, with how many
      refusedRows: refused[o.key] || 0, waitingForRefused: withRefused.map(n => ({ key: n, module: files[n].module, rows: refused[n] })),
      outOfDate: why.length > 0, outOfDateReasons: why, // while true the file cannot be downloaded or marked as imported
    };
  });
}

// ---------- generation ----------
// The vouchers that feed Invoices, Bills and Manual Journals, built with the user's routing and tax decisions.
// slots: the voucher datasets to build (default: every one that feeds a file). The routing of the journals depends on
// the journals alone, so it can be worked out from them only (journalRoutes).
function voucherBuild(jobId, gctx, slots = VOUCHER_FILE_SLOTS) {
  // accountName: THE name resolver (namefix.js), the same one the master files use: a ledger renamed or put on Zoho's own
  // account, cleaned, renamed or treated as one with a duplicate in Mapping Studio is written that way in the party
  // and Account columns too
  const accountName = gctx.outputName || accountNameMapper(gctx.clashDecisions);
  // GST Treatment, GSTIN and state of each contact as written in the Customers and Vendors files (after Fix contacts),
  // found by the name written there, so a contact treated as the same party as another gives the kept contact's values
  const contacts = { customers: new Map(), vendors: new Map() };
  for (const section of ['customers', 'vendors']) {
    for (const r of db.prepare("SELECT name, data FROM source_records WHERE job_id = ? AND slot = ? AND object_type = 'Ledger' ORDER BY id").all(jobId, section)) {
      if (mergedAway(gctx, r.name)) continue;
      const row = TEMPLATES[section].row(JSON.parse(r.data), gctx);
      if (!contacts[section].has(row['Display Name'])) {
        contacts[section].set(row['Display Name'], { treatment: row['GST Treatment'] || '', gstin: row['GST Identification Number (GSTIN)'] || '', place: row[section === 'customers' ? 'Place Of Contact' : 'Source Of Supply'] || '', currency: row['Currency Code'] || '' });
      }
    }
  }
  const codes = gstCodeSet(gctx.gstCodes).codes;
  const year = jobYear(getJob(jobId));
  // the HSN/SAC of each ledger master that has one (hsncode, or the hsndetails entry that applies at the end of the year)
  const ledgerHsnCodes = new Map();
  for (const r of db.prepare("SELECT name, data FROM source_records WHERE job_id = ? AND object_type = 'Ledger' AND (json_extract(data, '$.hsndetails') IS NOT NULL OR json_extract(data, '$.hsncode') IS NOT NULL) ORDER BY id").all(jobId)) {
    const k = matchKey(r.name), code = String(itemInfo(JSON.parse(r.data), year?.to?.replace(/-/g, '') || null).hsn ?? '').trim();
    if (k && code && !ledgerHsnCodes.has(k)) ledgerHsnCodes.set(k, code);
  }
  // round 1 (issue 10): Tally's type of supply of each ledger master (gsttypeofsupply: Goods or Services)
  const ledgerSupply = new Map();
  for (const r of db.prepare("SELECT name, json_extract(data, '$.gsttypeofsupply') t FROM source_records WHERE job_id = ? AND object_type = 'Ledger' AND json_extract(data, '$.gsttypeofsupply') IS NOT NULL ORDER BY id").all(jobId)) {
    const k = matchKey(r.name), t = tallyText(r.t).trim();
    if (k && /^(goods|services)$/i.test(t) && !ledgerSupply.has(k)) ledgerSupply.set(k, t);
  }
  const ctx = { ...partySets(jobId), taxMap: gctx.taxMap, kindOf: ledgerKinds(jobId), accountName,
    taxInfo: taxLedgerInfos(db, jobId), tdsMap: tdsMappings(db, jobId), settings: voucherSettings(db, jobId),
    contactOf: (section, ledger) => contacts[section].get(accountName(ledger)) || null,
    // v2 (defaults.js): journals with no decision are routed by default; vouchers dated outside the financial year are
    // left out unless the switch says include; HSN/SAC corrections; the codes that mean "registered" for bill lines
    defaultRouting: true, year, hsnCorrections: gctx.hsnCorrections || {}, hsn: gctx.hsn, hsnDefaults: gctx.hsnDefaults,
    ledgerHsn: ledger => ledgerHsnCodes.get(matchKey(ledger)) || '',
    ledgerTypeOfSupply: ledger => ledgerSupply.get(matchKey(ledger)) || '',
    // the vendors written as overseas because of their reverse charge bills (decisions.js, taxposting.js)
    rcmForeignVendors: gctx.rcmForeignVendors || new Set(),
    // the taxes of the Zoho organisation, when the accountant saved the list (Zoho's own tax names are then used by
    // default only when they are in it)
    zohoTaxNames: zohoTaxList(db, jobId).map(r => r.name),
    // regular, SEZ and composition: the Zoho check rule BIL-TAX-REQUIRED-REGISTERED asks a tax, an exemption or a reverse
    // charge on every line of all three, so the generator treats all three alike (a composition vendor's line gets the
    // zero-rate tax and the flagged assumption, never an empty tax cell the check predicts as refused)
    gstRegisteredCodes: new Set([codes.regular, codes.sez, codes.composition].filter(Boolean)),
    // the company's own GST identity (companygst.js): registered or not, its GSTIN and home state (GST-012, GST-013)
    companyGst: companyGstOf(db, jobId),
    // v2 defaults 14 and 15: the suggested TDS tax, round-off ledgers, the stock item names (service items)
    ...voucherDefaults(db, jobId),
    // TDS-010: the business type decides 0.1% TDS deducted by a customer with no section (goods: 194Q)
    businessType: (() => { try { return businessTypeOf(db, jobId).value || ''; } catch { return ''; } })(),
    // TALLY-002: the Voucher Type records, to tell a type Tally never posts in Other Voucher Types; TALLY-001: the second
    // copies of a voucher (same Tally identifier) over every dataset, with the copy stored first
    voucherTypes: voucherTypesOf(jobId), duplicateOf: duplicateVoucherMap(jobId) };
  const decisions = Object.fromEntries(db.prepare('SELECT source_record_id, decision FROM journal_decisions WHERE job_id = ?').all(jobId).map(d => [d.source_record_id, d.decision]));
  // round 2 (SYN-5): the corrections the accountant entered (a date that is not a real day, an unbalanced voucher)
  const corrections = correctionsOf(db, jobId);
  const vouchers = db.prepare(`SELECT * FROM source_records WHERE job_id = ? AND object_type = 'Voucher' AND slot IN (${slots.map(s => `'${s}'`).join(',')}) ORDER BY id`).all(jobId)
    .map(r => { const data = JSON.parse(r.data); const correction = corrections.get(voucherKey(r, data)); return { ...r, data, decision: decisions[r.id], ...(correction ? { correction } : {}) }; });
  return { vouchers, built: buildVoucherOutput(vouchers, ctx) };
}

// ---------- the Opening Balances file ----------
// Which Trial Balance records the Opening Balances file is built from. recs: the stored TrialBalanceLine records.
//  - A file of Trial Balance lines (name and closing balance): every line, as before.
//  - A Tally Trial Balance report: ONLY when the report is at ledger level (every lowest line is a ledger), and then
//    only the lowest lines that were matched to a ledger and carry an opening balance. The OPENING balance column is
//    written (the balance at the start of the period, because the vouchers of the period are transferred as well),
//    under the ledger's name as the masters write it. When the report is not at ledger level, or has no opening
//    balances, NO file is created and `problem` says why: a file built from group lines, or from part of the ledgers,
//    would be misleading. Nothing else is used in its place.
// Returns { recs, names: { lineNo: ledger name } | null, problem: string | null, note: string | null }.
function openingBalanceSource(jobId, recs) {
  const report = recs.filter(r => isReportLine(JSON.parse(r.data)));
  if (!report.length) return { recs, names: null, problem: null, note: null };
  const s = db.prepare('SELECT data FROM trial_balance_summary WHERE job_id = ?').get(jobId);
  if (!s) return { recs: [], names: null, note: null, problem: 'The Opening Balances file was not created: the Trial Balance report has not been checked yet. Process the data again.' };
  const summary = JSON.parse(s.data);
  if (!summary.atLedgerLevel) {
    return { recs: [], names: null, note: null,
      problem: `The Opening Balances file was not created. The Trial Balance uploaded is not at ledger level: ${summary.lowestGroups} of its ${summary.lowestLines} lowest line(s) are groups${summary.mastersAvailable ? '' : ' or could not be matched, because no masters were uploaded'}, `
        + 'and an opening balance can only be entered per ledger. In Tally open the Trial Balance, press Alt+F5 for the detailed view so every ledger is listed, export it again with Show Opening Balance turned on, and upload it. No other figures were used in its place.' };
  }
  if (!summary.hasOpeningBalances) {
    return { recs: [], names: null, note: null,
      problem: 'The Opening Balances file was not created. The Trial Balance report has no opening balance figures. In Tally turn on Show Opening Balance, export the Trial Balance again and upload it. The closing balances were not used in their place.' };
  }
  const lines = new Map(db.prepare('SELECT source_record_id id, data FROM trial_balance_lines WHERE job_id = ?').all(jobId).map(l => [l.id, JSON.parse(l.data)]));
  const keep = report.filter(r => { const l = lines.get(r.id); return l && !l.hasChildren && l.matchType === 'ledger' && l.opening !== '' && Number(l.opening) !== 0; });
  const names = Object.fromEntries(keep.map(r => { const l = lines.get(r.id); return [l.lineNo, l.matchName]; }));
  return { recs: keep, names, problem: null,
    note: `From the Tally Trial Balance report: the Opening Balance column of ${keep.length} ledger line(s). Group lines and ledgers with no opening balance are not written.` };
}

const OB3_NOTES = 'Opening balances from Tally of accounts of a kind Zoho Books has not taken in this journal in a test import yet';
// ---------- the opening balances of the masters, checked (OB-002, OB-011) ----------
// Every opening balance of the files comes from Tally's ledger masters. Two checks, both on the Tally data alone:
//  - the masters must add up to zero. When they do not, Tally itself shows a "Difference in opening balances"; the
//    files would push it silently into Opening Balance Adjustments (OB-011).
//  - a ledger master's opening balance is the balance on the day its books begin ("starting from"). When the books begin
//    before the migrated year, that is NOT the balance at the start of the year; the Tally Trial Balance report of the
//    year (Opening column) is, so every master is compared with it, and a difference blocks the files (OB-002). The
//    comparison is made whenever the report has ledger-level opening figures.
// Returns { total (Decimal, Tally sign), unread: [name], earliestStart, latestStart, booksBeforeYear, tbAvailable,
//   differences: [{ name, master, tb }] }.
export function openingSourceChecks(jobId, year = jobYear(getJob(jobId))) {
  const seen = new Map();
  for (const r of db.prepare("SELECT name, json_extract(data, '$.openingbalance') ob, json_extract(data, '$.startingfrom') sf FROM source_records WHERE job_id = ? AND object_type = 'Ledger' ORDER BY id").all(jobId)) {
    if (!seen.has(r.name)) seen.set(r.name, r);
  }
  let total = new Decimal(0);
  const unread = [], master = new Map();
  for (const r of seen.values()) {
    const raw = r.ob == null ? '' : String(r.ob).trim();
    if (!raw) { master.set(r.name, new Decimal(0)); continue; }
    const a = money(raw);
    if (!a) { unread.push(r.name); continue; }
    master.set(r.name, a);
    total = total.plus(a);
  }
  const starts = [...seen.values()].map(r => isoDate(r.sf)).filter(Boolean).sort();
  const earliestStart = starts[0] || null, latestStart = starts[starts.length - 1] || null;
  const booksBeforeYear = !!(year && earliestStart && earliestStart < year.from);
  let tbAvailable = false;
  const differences = [];
  try {
    const sum = db.prepare('SELECT data FROM trial_balance_summary WHERE job_id = ?').get(jobId);
    const summary = sum ? JSON.parse(sum.data) : null;
    if (summary?.atLedgerLevel && summary?.hasOpeningBalances) {
      tbAvailable = true;
      const tb = new Map();
      for (const l of db.prepare('SELECT data FROM trial_balance_lines WHERE job_id = ?').all(jobId).map(x => JSON.parse(x.data))) {
        if (l.hasChildren || l.matchType !== 'ledger' || !l.matchName) continue;
        const v = l.opening === '' || l.opening == null ? new Decimal(0) : money(String(l.opening));
        if (v) tb.set(l.matchName, (tb.get(l.matchName) || new Decimal(0)).plus(v));
      }
      for (const [name, m] of master) {
        const t = tb.get(name) || new Decimal(0);
        if (!t.equals(m)) differences.push({ name, master: m, tb: t });
      }
    }
  } catch { tbAvailable = false; }
  return { total, unread, earliestStart, latestStart, booksBeforeYear, tbAvailable, differences };
}

// ---------- the Chart of Accounts file ----------
// Which ledgers go in. Customers (Sundry Debtors) and vendors (Sundry Creditors) are Zoho CONTACTS, not accounts: they
// are left out, and Zoho Books keeps their balances in its own Accounts Receivable and Accounts Payable. A ledger is a
// customer or vendor when its group chain reaches Sundry Debtors or Sundry Creditors (also a renamed one), or when
// the same name is in the Customer or Vendor dataset. Every other ledger (bank, cash, tax, income, expense, asset,
// liability, capital) is written. recs: the stored Ledger records of the Chart of Accounts dataset.
// A ledger left out as a customer or vendor that is NOT in the Customer or Vendor dataset (possible when the Chart of
// Accounts was uploaded on its own) would be in no file: it is listed in notInContacts and flagged, never dropped silently.
// Tally's own Profit & Loss A/c ledger (no group, reserved name) is left out as well: Zoho Books keeps the accumulated
// profit in its own Retained Earnings, and a row for it would have no account type. It is listed in profitAndLoss and
// flagged; when it has an opening balance, the flag says that amount must be entered on Retained Earnings.
// A ledger whose name is the name of one of Zoho's own accounts and that the accountant chose, in Mapping Studio, to
// enter on Zoho's own account (decision 'zoho', decisions.js) is left out as well: it is listed in toZoho, and its
// opening balance is written to the opening balance journal for Zoho's accounts instead. candidates: the ledgers that
// would be written without such decisions (what Mapping Studio lists).
// Returns { recs, candidates, toZoho: [rec], customers, vendors, taxes, notInContacts: [{ rec, section }], profitAndLoss: [rec], note }.
function accountRecords(jobId, recs, gctx) {
  const party = partySets(jobId);
  let customers = 0, vendors = 0, taxes = 0;
  const notInContacts = [], profitAndLoss = [];
  let keep = recs.filter(r => {
    const d = JSON.parse(r.data);
    if (isProfitAndLossLedger(d)) { profitAndLoss.push(r); return false; }
    const parent = tallyText(d.parent);
    const section = groupSection(parent, gctx);
    if (section === 'customers' || (!section && party.customers.has(r.name))) { customers++; if (!party.customers.has(r.name)) notInContacts.push({ rec: r, section, parent }); return false; }
    if (section === 'vendors' || (!section && party.vendors.has(r.name))) { vendors++; if (!party.vendors.has(r.name)) notInContacts.push({ rec: r, section, parent }); return false; }
    return true;
  });
  const candidates = keep;
  // ledgers treated as the same account as another (Mapping Studio, Names): their balance is added to the kept one's
  const merged = keep.filter(r => mergedAway(gctx, r.name));
  if (merged.length) keep = keep.filter(r => !merged.includes(r));
  const zohoOf = name => gctx?.clashDecisions?.[name]?.zohoName || builtinAccount(name);
  const toZoho = keep.filter(r => gctx?.clashDecisions?.[r.name]?.decision === 'zoho' && zohoOf(r.name));
  const renamed = keep.filter(r => gctx?.clashDecisions?.[r.name]?.decision === 'rename' && builtinAccount(r.name)).length;
  if (toZoho.length) keep = keep.filter(r => !toZoho.includes(r));
  // the ledgers under Duties & Taxes still written as accounts of their own (the ones moved to Zoho's accounts are not)
  taxes = keep.filter(r => groupSection(tallyText(JSON.parse(r.data).parent), gctx) === 'taxes').length;
  // v2 default 2: every account stays in the file WITHOUT its opening balance; the balance is written once, in the
  // dated opening balance journal (so it does not depend on Zoho's Opening Balance Date). Not a Stock account, and not
  // the date anchor (gctx.openingAnchor, openingAnchorFor). viaJournal: [{ rec, balance }].
  const viaJournal = keep.map(r => ({ rec: r, balance: openingBalanceForJournal(JSON.parse(r.data), gctx) })).filter(x => x.balance);
  const anchor = gctx?.openingAnchor || null;
  const inChart = keep.filter(r => { const row = TEMPLATES.accounts.row(JSON.parse(r.data), gctx); return String(row['Opening Balance'] ?? '') !== ''; }).length;
  const toZohoByDefault = toZoho.filter(r => gctx.clashDecisions[r.name].byDefault).length;
  const note = `${keep.length} ledger(s).`
    + (merged.length ? ` ${merged.length} ledger(s) are not written on their own: the accountant treated each as the same account as another (Mapping Studio, Names), whose opening balance includes theirs.` : '')
    + (toZoho.length ? ` ${toZoho.length} ledger(s) whose names are the names of Zoho's own accounts are not in this file: Zoho's own account is used (${toZohoByDefault ? `${toZohoByDefault} by default` : 'chosen in Mapping Studio'}${toZohoByDefault && toZohoByDefault < toZoho.length ? `, ${toZoho.length - toZohoByDefault} chosen in Mapping Studio` : ''}), and their opening balances are in the file opening_balances_for_zoho_accounts.csv.` : '')
    + (viaJournal.length ? ` ${viaJournal.length} ledger(s) with an opening balance are written without it: the balance is in the file opening_balances_for_zoho_accounts.csv (journal OB-1), which carries its own date, so it does not depend on the Opening Balance Date of Zoho Books.` : '')
    + (anchor?.mode === 'chart' ? ' One ledger keeps its opening balance in this file: its import creates the opening balance record of Zoho Books, whose date is then edited (Import Wizard, step "Save the Migration Date").' : '')
    + (anchor?.mode === 'typed' ? ' One opening balance is in no file: it is typed in Zoho Books in the Import Wizard step "Save the Migration Date".' : '')
    + (renamed ? ` ${renamed} ledger(s) are written with a new name chosen in Mapping Studio, because their Tally names are the names of Zoho's own accounts.` : '')
    + ` Customers and vendors are not in this file: ${customers} customer ledger(s) (Sundry Debtors) and ${vendors} vendor ledger(s) (Sundry Creditors) are Zoho contacts, in the Customers and Vendors files with their opening balances, and Zoho Books keeps their balances in Accounts Receivable and Accounts Payable. `
    + (taxes ? `${taxes} ledger(s) under Duties & Taxes are written as accounts and flagged: Zoho Books creates its own GST tax accounts. ` : '')
    + (profitAndLoss.length ? 'Tally\'s own Profit & Loss A/c ledger is not in this file: Zoho Books keeps the accumulated profit in its Retained Earnings. ' : '')
    + (inChart ? `${inChart} row(s) carry an opening balance in this file (Opening Balance and Debit or Credit). ` : 'No row carries an opening balance in this file. ')
    + 'Parent Account is left empty: Tally groups are not accounts.';
  return { recs: keep, candidates, merged, toZoho, viaJournal, anchor, customers, vendors, taxes, notInContacts, profitAndLoss, note };
}
// The date anchor of a migration (defaults.js chooseDateAnchor): the ONE chart ledger whose opening balance is not in
// the opening balance journal, so that Zoho Books can save its Opening Balance Date before the contacts are imported.
// Needed only when a Customers or Vendors row carries an Opening Balance (Zoho dates those with that setting) and no
// chart row keeps a balance anyway (a Stock account). Returns { name, mode: 'chart' | 'typed', recId } or null.
// Resolved once per context, lazily (extras.js makeContext reads it through setOpeningAnchorResolver).
function openingAnchorFor(jobId, gctx) {
  const contactBalance = ['customers', 'vendors'].some(key => {
    const t = TEMPLATES[key];
    return db.prepare('SELECT name, data FROM source_records WHERE job_id = ? AND slot = ? AND object_type = ? ORDER BY id').all(jobId, t.slot, t.objectType)
      .some(r => { if (mergedAway(gctx, r.name)) return false; try { return String(t.row(JSON.parse(r.data), gctx)['Opening Balance'] ?? '') !== ''; } catch { return false; } });
  });
  if (!contactBalance) return null;
  const ar = accountRecords(jobId, chartRecords(jobId), gctx);
  const cands = ar.recs.map(r => { const d = JSON.parse(r.data); return { id: r.id, name: r.name, type: ledgerAccountType(d, gctx), balance: openingWithMerged(r.name, d.openingbalance, gctx).total }; });
  // a balance kept in the chart (not posted through the journal) dates the contacts' balances itself, so no anchor is
  // needed; but a Stock balance is not proven by any import (COA-STOCK-OB-LOCKS-DATE), so it never stands in for the
  // anchor (round 1, issue 14): an Equity, Fixed Asset or Other Current Liability row is still chosen
  if (cands.some(c => c.balance && !c.balance.isZero() && c.type && !openingBalanceViaJournal(c.type) && c.type !== 'Stock')) return null;
  const a = chooseDateAnchor(cands);
  if (a) return { name: a.name, mode: a.mode, recId: a.id };
  // OB-009: no chart ledger has a balance (only ledgers put on Zoho's own accounts, or Tally's Profit & Loss A/c, have
  // one). There must still be exactly ONE balance to type, or Zoho does not save the Migration Date and every later
  // file stays locked: the smallest balance on Zoho's own account, else the Profit & Loss A/c (on Retained Earnings).
  // It is typed, and left out of the opening balance journal, so it is never counted twice.
  const live = list => list.map(r => { const d = JSON.parse(r.data); return { r, ob: openingWithMerged(r.name, d.openingbalance, gctx).total }; }).filter(x => x.ob && !x.ob.isZero());
  const pick = list => [...list].sort((x, y) => x.ob.abs().comparedTo(y.ob.abs()) || String(x.r.name).localeCompare(String(y.r.name)))[0];
  const onZoho = live(ar.toZoho);
  if (onZoho.length) { const x = pick(onZoho); return { name: x.r.name, mode: 'typed', recId: x.r.id, onZoho: true }; }
  const pl = live(ar.profitAndLoss);
  if (pl.length) { const x = pick(pl); return { name: x.r.name, mode: 'typed', recId: x.r.id, profitAndLoss: true }; }
  return null;
}
setOpeningAnchorResolver(db, (jobId, gctx) => openingAnchorFor(jobId, gctx));
// The date anchor as the Import Wizard shows it: the account as written, the side and the amount; null when there is none.
function openingAnchorView(jobId, gctx = makeContext(db, jobId)) {
  const a = gctx.openingAnchor;
  if (!a) return null;
  const rec = db.prepare('SELECT name, data FROM source_records WHERE id = ?').get(a.recId);
  if (!rec) return null;
  const ob = openingWithMerged(rec.name, JSON.parse(rec.data).openingbalance, gctx).total;
  if (!ob || ob.isZero()) return null;
  const account = a.profitAndLoss ? ZOHO_RETAINED_EARNINGS : a.onZoho ? (gctx.clashDecisions?.[rec.name]?.zohoName || builtinAccount(rec.name) || rec.name) : gctx.outputName ? gctx.outputName(rec.name) : rec.name;
  return { mode: a.mode, recId: a.recId, account, tallyLedger: visibleName(rec.name), side: ob.isNegative() ? 'Debit' : 'Credit', amount: ob.abs().toFixed(2), signed: ob.toFixed(2) };
}
const chartRecords = jobId => db.prepare("SELECT * FROM source_records WHERE job_id = ? AND slot = 'accounts' AND object_type = 'Ledger' ORDER BY id").all(jobId);

// ---------- the opening balance journal for Zoho's own accounts ----------
// The rows of opening_balances_for_zoho_accounts.csv: one line per ledger put on Zoho's own account that has an opening
// balance, then the line on Opening Balance Adjustments that balances the journal (see zoho.js). Ledgers put on Zoho's
// own account WITHOUT a balance need no line. Returns [{ builtin, record, recId, sourceId }] (empty: no file).
// Journal OB-1: those lines. Journal OB-2 (same file, same date): one line per customer in credit and vendor in debit,
// whose balance Zoho's Opening Balance column cannot carry, on Accounts Receivable / Accounts Payable with the Contact
// Name, and its own balancing line (zoho.js contactCreditOpeningRow). A row with `contact: true` is an OB-2 line.
function zohoAccountOpeningRows(jobId, gctx) {
  const t = TEMPLATES.opening_balances_for_zoho_accounts;
  const { toZoho, viaJournal, profitAndLoss } = accountRecords(jobId, chartRecords(jobId), gctx);
  // the ONE typed balance (OB-009: a ledger on Zoho's own account or the Profit & Loss A/c) is in no file
  const typedAnchor = gctx.openingAnchor && gctx.openingAnchor.mode === 'typed' ? gctx.openingAnchor.recId : null;
  // the balance of a ledger includes the ledgers treated as the same account (namefix.js openingWithMerged)
  const withBalance = [
    ...toZoho.filter(r => r.id !== typedAnchor).map(r => ({ r, d: JSON.parse(r.data) })).filter(x => { const ob = openingWithMerged(x.r.name, x.d.openingbalance, gctx).total; return ob && !ob.isZero(); }),
    // v2 default 2: every other ledger of the chart with a balance (not a Stock account, not the date anchor)
    ...viaJournal.map(x => ({ r: x.rec, d: JSON.parse(x.rec.data) })),
    // Tally's own Profit & Loss A/c ledger (the profit of earlier years): on Zoho's Retained Earnings
    ...profitAndLoss.filter(r => r.id !== typedAnchor).map(r => ({ r, d: JSON.parse(r.data), pl: true })).filter(x => { const ob = money(x.d.openingbalance); return ob && !ob.isZero(); }),
  ];
  // OB-007: a line of a kind Zoho Books accepted in our imports (a bank account, or one of its own accounts listed in
  // zohorules.json journal_lines_confirmed) stays in OB-1; a line of any other kind goes to OB-3, a journal of the same
  // date with its own line on Opening Balance Adjustments, so that one refused line cannot refuse every balance. When
  // every line is of one sort, there is one journal (OB-1), as before.
  const provenAccounts = new Set(OB_PROVEN_ZOHO_ACCOUNTS.map(accountNameKey));
  const proven = x => {
    if (x.pl) return false;
    if (toZoho.includes(x.r)) return provenAccounts.has(accountNameKey(gctx.clashDecisions?.[x.r.name]?.zohoName || builtinAccount(x.r.name) || ''));
    return OB_PROVEN_TYPES.includes(ledgerAccountType(x.d, gctx));
  };
  const groups = [withBalance.filter(proven), withBalance.filter(x => !proven(x))].filter(g => g.length);
  const rows = [];
  for (const [i, g] of groups.entries()) {
    const suffix = i === 0 || groups.length === 1 ? '1' : '3';
    const tag = r => (suffix === '1' ? r : { ...r, 'Journal Number Suffix': suffix, 'Notes': OB3_NOTES });
    rows.push(...g.map(x => ({ builtin: tag(x.pl ? profitAndLossOpeningRow(x.d, gctx) : t.row(x.d, gctx)), record: x.d, recId: x.r.id, sourceId: x.r.source_id, ...(suffix === '3' ? { unproven: true } : {}) })));
    const balancing = openingBalancingRow(g.map(x => x.d), gctx);
    if (balancing) rows.push({ builtin: tag(balancing), record: {}, recId: null, sourceId: null });
  }
  const credits = [];
  for (const [key, who] of [['customers', 'customer'], ['vendors', 'vendor']]) {
    const ct = TEMPLATES[key];
    for (const r of db.prepare('SELECT id, source_id, name, data FROM source_records WHERE job_id = ? AND slot = ? AND object_type = ? ORDER BY id').all(jobId, ct.slot, ct.objectType)) {
      if (mergedAway(gctx, r.name)) continue;
      let d, line; try { d = JSON.parse(r.data); line = contactCreditOpeningRow(d, gctx, who); } catch { line = null; }
      if (line) credits.push({ builtin: line.row, record: d, recId: r.id, sourceId: r.source_id, contact: true, who, amount: line.amount });
    }
  }
  if (credits.length) {
    rows.push(...credits);
    const other = contactCreditBalancingRow(credits.map(c => c.amount), gctx);
    if (other) rows.push({ builtin: other, record: {}, recId: null, sourceId: null });
  }
  return rows;
}

// The opening balances of the bank (and credit card) accounts as a plain list: the account as written in the Chart of
// Accounts file, the side and the amount. They are in the opening balance journal, which has not been tried in a real
// import; Zoho's documented way is to type them under Settings > Opening Balances once the bank accounts exist, so a
// later step can show this list when the journal is refused.
function bankOpeningBalances(jobId, gctx = makeContext(db, jobId)) {
  const { viaJournal } = accountRecords(jobId, chartRecords(jobId), gctx);
  // only the accounts Zoho keeps in Banking (Bank, Credit Card, Cash): the journal now carries every other ledger too
  const accounts = viaJournal.map(x => ({ account: gctx.outputName ? gctx.outputName(x.rec.name) : x.rec.name, tallyLedger: visibleName(x.rec.name), id: x.rec.source_id,
    accountType: TEMPLATES.accounts.row(JSON.parse(x.rec.data), gctx)['Account Type'], side: x.balance.isNegative() ? 'Debit' : 'Credit', amount: x.balance.abs().toFixed(2) }))
    .filter(a => BANK_LIKE_TYPES.includes(a.accountType));
  const sum = side => accounts.filter(a => a.side === side).reduce((t, a) => t.plus(a.amount), new Decimal(0)).toFixed(2);
  return { accounts, totalDebit: sum('Debit'), totalCredit: sum('Credit'), openingJournalDate: gctx.openingJournalDate,
    inFile: TEMPLATES.opening_balances_for_zoho_accounts.file,
    note: 'Zoho Books does not take the opening balance of a bank account in the Chart of Accounts import. These balances are in the opening balance journal. If Zoho Books refuses that journal, type each balance in Zoho Books under Settings > Setup & Configurations > Opening Balances after the bank accounts exist.' };
}

// The first rows a file would have, before the column layout is applied: { total, rows: [{ builtin, record }] }.
// builtin is the row keyed by the original headings; record is the Tally source record. Used by the layout preview.
function previewRows(job, key, limit) {
  const gctx = makeContext(db, job.id);
  const t = TEMPLATES[key];
  if (key === 'opening_balances') {
    const ob = openingBalanceSource(job.id, db.prepare('SELECT * FROM source_records WHERE job_id = ? AND slot = ? AND object_type = ? ORDER BY id').all(job.id, t.slot, t.objectType));
    gctx.trialBalanceNames = ob.names;
    return { total: ob.recs.length, rows: ob.recs.slice(0, limit).map(r => { const d = JSON.parse(r.data); return { builtin: t.row(d, gctx), record: d }; }) };
  }
  if (key === 'opening_balances_for_zoho_accounts') {
    const rows = zohoAccountOpeningRows(job.id, gctx);
    return { total: rows.length, rows: rows.slice(0, limit).map(b => ({ builtin: b.builtin, record: b.record })) };
  }
  if (key === 'accounts') {
    const { recs } = accountRecords(job.id, db.prepare('SELECT * FROM source_records WHERE job_id = ? AND slot = ? AND object_type = ? ORDER BY id').all(job.id, t.slot, t.objectType), gctx);
    return { total: recs.length, rows: recs.slice(0, limit).map(r => { const d = JSON.parse(r.data); return { builtin: t.row(d, gctx), record: d }; }) };
  }
  if (key === 'customers' || key === 'vendors') {
    // a contact treated as the same party as another (Mapping Studio, Names) is not written on its own
    const recs = db.prepare('SELECT name, data FROM source_records WHERE job_id = ? AND slot = ? AND object_type = ? ORDER BY id').all(job.id, t.slot, t.objectType).filter(r => !mergedAway(gctx, r.name));
    return { total: recs.length, rows: recs.slice(0, limit).map(r => { const d = JSON.parse(r.data); return { builtin: t.row(d, gctx), record: d }; }) };
  }
  if (t) {
    const total = db.prepare('SELECT COUNT(*) n FROM source_records WHERE job_id = ? AND slot = ? AND object_type = ?').get(job.id, t.slot, t.objectType).n;
    const recs = db.prepare('SELECT data FROM source_records WHERE job_id = ? AND slot = ? AND object_type = ? ORDER BY id LIMIT ?').all(job.id, t.slot, t.objectType, limit);
    return { total, rows: recs.map(r => { const d = JSON.parse(r.data); return { builtin: t.row(d, gctx), record: d }; }) };
  }
  const rows = voucherBuild(job.id, gctx).built[key].rows;
  return { total: rows.length, rows: rows.slice(0, limit).map(r => ({ builtin: r.row, record: r.rec.data })) };
}

// dry: true works everything out exactly as when the files are created (the same rows, the same flagged items, the same
// voucher control total) but writes NOTHING: no file, no row in the database, no audit entry. It returns
// { files: [{ key, module, fileName, rows }], vouchers, flags: [{ slot, sourceId, name, message, kind, uses }] } and is
// what "Assumptions the tool made" is read from, so that list can never differ from what creating the files does.
function generate(job, { dry = false } = {}) {
  const outDir = path.join(DATA_DIR, 'output', job.id);
  // Retry files live in the same folder. They are put back below for files that come out unchanged.
  const retryKept = {};
  if (!dry) {
    for (const key of Object.keys(ALL_FILES)) { const p = retryFile(job.id, key); if (fs.existsSync(p)) retryKept[key] = fs.readFileSync(p); }
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
  }
  const files = [];
  const flags = []; // every flagged item raised, in order (also written to the exceptions table unless dry)
  let reconciliationCleared = [], rejectionsCleared = [], voucherTotals = null;
  const oldSha = Object.fromEntries(db.prepare('SELECT key, sha256 FROM generated_files WHERE job_id = ?').all(job.id).map(f => [f.key, f.sha256]));
  const unchanged = key => !!oldSha[key] && oldSha[key] === files.find(f => f.key === key)?.sha256;
  // Writes one file with the firm's column layout and records the layout version and headings it was built with.
  // built: [{ builtin (row keyed by the original headings), record (Tally source record), recId, sourceId }]
  const insRow = db.prepare('INSERT INTO generated_rows (job_id, key, row_no, row_key, source_record_id, source_id, row_data, ident) VALUES (?,?,?,?,?,?,?,?)');
  const writeFile = (key, t, built, extra = {}) => {
    if (dry) { files.push({ key, module: t.module, fileName: t.file, rows: built.length, ...(extra.vouchers !== undefined ? { vouchers: extra.vouchers } : {}) }); return; }
    const layout = getMapping(db, job.firm_id ?? 1, key);
    const idId = idColumnId(key);
    const rows = built.map((b, i) => {
      const values = rowValues(key, layout.columns, b.builtin, b.record); // keyed by column id, so a later rename does not break stored rows
      insRow.run(job.id, key, i + 1, `${job.id}-${key}-${i + 1}`, b.recId, b.sourceId, JSON.stringify(values), String(values[idId] ?? ''));
      return values;
    });
    const written = columnsToWrite(key, layout, rows); // Customers and Vendors: columns that are empty on every row are left out
    const csv = csvFor(written, rows);
    const p = path.join(outDir, t.file);
    fs.writeFileSync(p, csv);
    const sha = createHash('sha256').update(csv).digest('hex');
    // verified: the default layout of a template checked against the official sample, or an admin's statement
    const lv = layoutStatement(key, layout);
    db.prepare('INSERT INTO generated_files (job_id, module, key, file_name, rows, sha256, template_verified, generated_at, path, notes, mapping_hash, columns, attestation, build_settings) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(job.id, t.module, key, t.file, rows.length, sha, lv.verified ? 1 : 0, now(), p, extra.notes ?? null, layout.hash, JSON.stringify(written), lv.statement ? JSON.stringify(lv.statement) : null,
        extra.buildSettings ? JSON.stringify(extra.buildSettings) : null);
    files.push({ key, module: t.module, fileName: t.file, rows: rows.length, ...(extra.vouchers !== undefined ? { vouchers: extra.vouchers } : {}), sha256: sha,
      templateVerified: lv.verified, ...(t.referenceOnly ? { referenceOnly: true } : {}), ...(extra.notes ? { notes: extra.notes } : {}),
      mappingHash: layout.hash, customLayout: layout.customised, headings: written.map(c => c.heading) });
  };
  const build = () => {
    if (!dry) {
      db.prepare('DELETE FROM generated_rows WHERE job_id = ?').run(job.id);
      db.prepare('DELETE FROM generated_files WHERE job_id = ?').run(job.id);
      db.prepare('DELETE FROM import_status WHERE job_id = ?').run(job.id);
      db.prepare("DELETE FROM exceptions WHERE job_id = ? AND stage = 'generate'").run(job.id);
    }
    const gctx = makeContext(db, job.id); // the decisions made, and the defaults where there is none (decisions.js, defaults.js)
    // Every flagged item goes through one of these: it is collected in flags, and written to the table unless dry.
    const sink = (stmt, toFlag) => ({ run: (...a) => { flags.push(toFlag(...a)); if (!dry) stmt.run(...a); } });
    const insExc = sink(db.prepare('INSERT INTO exceptions (job_id, stage, slot, source_id, name, message) VALUES (?,?,?,?,?,?)'),
      (j, stage, slot, sourceId, name, message) => ({ slot, sourceId, name, message, kind: null, uses: null }));
    const insExcKind = sink(db.prepare("INSERT INTO exceptions (job_id, stage, slot, source_id, name, message, kind) VALUES (?,'generate',?,?,?,?,?)"),
      (j, slot, sourceId, name, message, kind) => ({ slot, sourceId, name, message, kind, uses: null }));
    // a flagged item about a whole dataset or file: (slot, name, message, kind, uses)
    const insFlag = sink(db.prepare("INSERT INTO exceptions (job_id, stage, slot, source_id, name, message, kind, uses) VALUES (?,'generate',?,NULL,?,?,?,?)"),
      (j, slot, name, message, kind, uses) => ({ slot, sourceId: null, name, message, kind, uses }));
    const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    // the financial year found in the Tally data (not 1 April to 31 March, not typed by a person): an assumption
    const yearNow = jobYear(getJob(job.id));
    if (getJob(job.id)?.year_source === 'data' && yearNow) {
      insFlag.run(job.id, 'accounts', `Financial year ${yearNow.from} to ${yearNow.to}`,
        `The files follow the financial year ${yearNow.from} to ${yearNow.to}, found in the Tally data (the books begin on the first day of that month and the vouchers fall in these twelve months), not 1 April to 31 March. `
        + `Vouchers outside it are left out, and the opening balance journal is dated ${gctx.openingJournalDate}. Set the year start on New Migration if the company's year is another.`, 'financial_year_from_data', null);
    }
    // the company's own GST identity (companygst.js): said when it was read from the data rather than typed (GST-012/013)
    {
      const cg = companyGstOf(db, job.id);
      if (cg.status === 'unregistered') {
        insFlag.run(job.id, 'taxes', 'Company GST status: not registered',
          `The company is taken as not registered for GST: ${cg.source.status}. The invoices and bills are written with no tax, no exemption and no supply type, and no zero-rate tax is added to a line without GST. `
          + 'Create the Zoho Books organisation without GST. Zoho Books has not confirmed by an import what it does with such lines in an organisation without GST. If the company is registered, enter its GSTIN on the migration and create the files again.', 'company_not_gst_registered', null);
      } else if (cg.status === 'composition') {
        insFlag.run(job.id, 'taxes', 'Company GST status: composition',
          `The company is registered under the GST Composition scheme (${cg.source.status}). Its invoices charge no GST, so no zero-rate tax is added to an invoice line; bills from registered vendors are treated as for a regular company. `
          + 'Zoho Books has not confirmed by an import what a composition organisation accepts: check the first import.', 'company_gst_composition', null);
      }
      if (cg.derived && cg.status !== 'unregistered' && (cg.gstin || cg.state)) {
        insFlag.run(job.id, 'taxes', `Company GSTIN ${cg.gstin || '(none)'}, state ${cg.state || '(unknown)'}`,
          `No GSTIN is entered on the migration, so the company's GSTIN${cg.gstin ? ` ${cg.gstin}` : ''} and GST state ${cg.state || '(unknown)'} are read from Tally's vouchers (the most common value). `
          + 'They decide the zero-rate tax of a line without GST when a voucher lacks the company state, the default of the HSN/SAC field and the state the Zoho check compares with. Enter the GSTIN on the migration if it is another.', 'company_gst_from_vouchers', null);
      }
      if (cg.mismatch) insFlag.run(job.id, 'taxes', 'Company GSTIN differs from Tally', cg.mismatch + ' Check which one is right before the import.', 'company_gstin_mismatch', null);
    }
    // Round 1: the ledgers made from the Trial Balance report at processing (tbledgers.js): an assumption each
    for (const r of db.prepare("SELECT slot, source_id, name, data FROM source_records WHERE job_id = ? AND object_type = 'Ledger' AND slot IN ('customers','vendors','accounts') AND json_extract(data, '$.__fromTrialBalance') IS NOT NULL ORDER BY id").all(job.id)) {
      let d; try { d = JSON.parse(r.data); } catch { continue; }
      const slots = db.prepare("SELECT slot FROM source_records WHERE job_id = ? AND source_id = ? AND object_type = 'Ledger'").all(job.id, r.source_id).map(x => x.slot);
      if (r.slot === 'accounts' && slots.some(x => x !== 'accounts')) continue; // said once, on the Customers or Vendors side
      insExcKind.run(job.id, r.slot, r.source_id, r.name, addedLedgerWords(r.name, d.__fromTrialBalance, slots), 'ledger_added_from_trial_balance');
    }
    // the opening balances of the masters: they add up to zero, and they are the balances at the start of the year (OB-011, OB-002)
    {
      const oc = openingSourceChecks(job.id, yearNow);
      const side = d => `${d.abs().toFixed(2)} ${d.isNegative() ? 'Debit' : 'Credit'}`;
      if (!oc.total.isZero()) {
        insFlag.run(job.id, 'accounts', `Tally opening balances do not add up to zero (difference ${side(oc.total)})`,
          `The opening balances of the ledger masters add up to ${side(oc.total)}, not zero: Tally shows this as "Difference in opening balances". `
          + 'The files would carry every balance as Tally has it, and Zoho Books would keep the difference on Opening Balance Adjustments, so its balance sheet would not be Tally\'s. '
          + 'Correct the opening balances in Tally (or enter the difference on the ledger it belongs to), export the masters again and process them. The files are not to be imported until then.'
          + (oc.unread.length ? ` ${oc.unread.length} opening balance(s) could not be read and are not in this total: ${oc.unread.slice(0, 10).map(visibleName).join(', ')}.` : ''),
          'opening_balances_differ_in_tally', null);
      }
      if (gctx.booksBeginInYear && !gctx.openingDateChosen) {
        insFlag.run(job.id, 'accounts', `Books begin on ${gctx.booksBeginInYear}, inside the year: Migration Date ${gctx.openingJournalDate}`,
          `Tally's books begin on ${gctx.booksBeginInYear} ("starting from" of the ledgers), after the year starts (${yearNow.from}). The opening balances of the masters are the balances of that day, so the Migration Date and the opening balance journal are dated ${gctx.openingJournalDate}, the day before the books begin, and not the day before the year starts. `
          + 'Choose another Migration Date in Voucher files if the company wants another.', 'migration_date_books_begin', null);
      }
      if (oc.booksBeforeYear && !oc.tbAvailable) {
        insFlag.run(job.id, 'accounts', `Tally's books begin on ${oc.earliestStart}, before the year ${yearNow.from}`,
          `The ledger masters say the books begin on ${oc.earliestStart} ("starting from"), before the migrated year starts (${yearNow.from}). A master's opening balance is the balance on the day the books begin, not at the start of this year, so the opening balances of the files would be wrong. `
          + 'Upload the Tally Trial Balance report of this year at ledger level with Show Opening Balance turned on: every master is then checked against its Opening column. The files are not to be imported until then.',
          'opening_balances_books_begin_earlier', null);
      }
      if (oc.differences.length) {
        const list = oc.differences.slice(0, 15).map(x => `"${visibleName(x.name)}" master ${side(x.master)}, Trial Balance ${x.tb.isZero() ? '0.00' : side(x.tb)}`).join('; ');
        insFlag.run(job.id, 'accounts', `${oc.differences.length} opening balance(s) differ from the Tally Trial Balance`,
          `The opening balance of ${oc.differences.length} ledger master(s) is not the Opening column of the Tally Trial Balance report: ${list}${oc.differences.length > 15 ? ', and more' : ''}. `
          + (oc.booksBeforeYear ? `The books begin on ${oc.earliestStart}, before the year (${yearNow.from}), so the masters hold the balances of that day. ` : '')
          + 'The files are built from the masters, so these balances would be wrong in Zoho Books. Export the masters and the Trial Balance for the same company and year (or correct Tally), and process them again. The files are not to be imported until then.',
          'opening_balance_differs_from_trial_balance', oc.differences.length);
      }
    }
    // OB-006: a company with stock. The files carry the stock account at its opening value all year (items are written
    // without inventory tracking and no closing stock entry is built), so Zoho's profit and balance sheet differ from
    // Tally's by the change in stock. Said with the figures the data gives, as a decision for the accountant.
    {
      const stockLedgers = [];
      for (const r of db.prepare("SELECT name, data FROM source_records WHERE job_id = ? AND slot = 'accounts' AND object_type = 'Ledger' ORDER BY id").all(job.id)) {
        let d; try { d = JSON.parse(r.data); } catch { continue; }
        if (ledgerAccountType(d, gctx) === 'Stock' && !stockLedgers.some(x => x.name === r.name)) stockLedgers.push({ name: r.name, opening: money(d.openingbalance) || new Decimal(0) });
      }
      const opening = stockLedgers.reduce((t, x) => t.plus(x.opening), new Decimal(0));
      let tbClosing = null;
      try {
        const lines = db.prepare('SELECT data FROM trial_balance_lines WHERE job_id = ?').all(job.id).map(x => JSON.parse(x.data)).filter(l => !l.hasChildren && l.matchType === 'ledger' && stockLedgers.some(x => x.name === l.matchName) && l.closing !== '' && l.closing != null);
        if (lines.length) tbClosing = lines.reduce((t, l) => t.plus(money(String(l.closing)) || 0), new Decimal(0));
      } catch { tbClosing = null; }
      let summaryClosing = null;
      const sumRows = db.prepare("SELECT json_extract(data, '$.closingvalue') v FROM source_records WHERE job_id = ? AND slot = 'stock_summary' AND object_type = 'StockSummaryLine'").all(job.id);
      if (sumRows.length) summaryClosing = sumRows.reduce((t, r) => t.plus(money(r.v == null ? '' : String(r.v)) || 0), new Decimal(0));
      const goods = gctx.businessType === 'goods';
      if (stockLedgers.length && (goods || !opening.isZero())) {
        const fig = d => `${d.abs().toFixed(2)} ${d.isNegative() ? 'Debit' : d.isZero() ? '' : 'Credit'}`.trim();
        const closing = summaryClosing ?? tbClosing;
        const change = closing ? closing.minus(opening) : null;
        insFlag.run(job.id, 'accounts', 'Closing stock is not carried to Zoho Books',
          `The company keeps stock: ${stockLedgers.map(x => `"${visibleName(x.name)}"`).join(', ')} (Stock-in-Hand) with an opening value of ${fig(opening)}. `
          + 'The files write the items without inventory tracking and build no closing stock entry, so in Zoho Books the stock account keeps its opening value all year and the purchases stay in their accounts: '
          + (change && !change.isZero() ? `the profit and the balance sheet stock will differ from Tally's by the change in stock, ${fig(change)} (closing ${fig(closing)} from the ${summaryClosing ? 'Stock Summary' : 'Trial Balance report'}). ` : closing ? `the closing stock in Tally (${fig(closing)}, from the ${summaryClosing ? 'Stock Summary' : 'Trial Balance report'}) is the same as the opening, so nothing differs now; check it after the year is closed. ` : 'the closing stock is not known (no Stock Summary and no closing figure in the Trial Balance report). ')
          + 'Decide how the stock is carried: a manual journal on the last day of the year (stock account against Cost of Goods Sold, or the account the accountant chooses), or inventory tracking in Zoho Books. No Zoho import has tried a journal on a Stock account yet.',
          'closing_stock_not_carried', stockLedgers.length);
      }
    }
    // the voucher files are worked out first: the Items file carries the service items their invoice lines use (v2)
    // (a dry run reads the voucher build kept while nothing changes: it is not changed here)
    const early = dry ? cachedVoucherBuild(job.id) : voucherBuild(job.id, gctx);
    for (const [key, t] of Object.entries(TEMPLATES)) {
      let recs = db.prepare('SELECT * FROM source_records WHERE job_id = ? AND slot = ? AND object_type = ? ORDER BY id').all(job.id, t.slot, t.objectType);
      let fileNote = null;
      if (key === 'opening_balances_for_zoho_accounts') {
        // OB-009: the one balance to type is on Zoho's own account or Retained Earnings (no chart row carries the flag)
        const an = gctx.openingAnchor;
        if (an && an.mode === 'typed' && (an.onZoho || an.profitAndLoss)) {
          const v = openingAnchorView(job.id, gctx);
          if (v) insExcKind.run(job.id, t.slot, null, v.tallyLedger,
            `The opening balance of "${v.tallyLedger}" (${v.amount} ${v.side}, on Zoho's account "${v.account}") is in no file: it is the one balance to type in Zoho Books in the Import Wizard step "Save the Migration Date". `
            + 'Customers or vendors have opening balances, Zoho does not save the Opening Balance Date while every balance is 0, and no ledger of the Chart of Accounts file has a balance that could stay there. It is left out of the opening balance journal, so it is not counted twice.', 'opening_date_balance_to_type');
        }
        // one journal for the ledgers the accountant put on Zoho's own accounts (see zohoAccountOpeningRows)
        const built = zohoAccountOpeningRows(job.id, gctx);
        if (!built.length) continue;
        const fileProblem = t.fileCheck(built.map(b => b.builtin));
        if (fileProblem) insExc.run(job.id, 'generate', t.slot, null, `${t.module} (whole file)`, fileProblem);
        const lines = built.filter(b => b.recId && !b.contact).length;
        const credits = built.filter(b => b.contact);
        const onZoho = built.filter(b => b.recId && !b.contact && gctx.clashDecisions?.[recordName(b.record)]?.decision === 'zoho' && (gctx.clashDecisions[recordName(b.record)].zohoName || builtinAccount(recordName(b.record)))).length;
        const own = lines - onZoho;
        const dateWords = gctx.openingDateChosen ? 'the Migration Date chosen in Voucher files' : 'the day before the financial year starts';
        const creditWords = credits.length ? `Journal OB-2 (same date) carries the opening balance of ${count(credits.filter(c => c.who === 'customer').length, 'customer')} in credit and ${count(credits.filter(c => c.who === 'vendor').length, 'vendor')} in debit, on Accounts Receivable and Accounts Payable with the Contact Name. ` : '';
        if (lines || credits.length) {
          insFlag.run(job.id, t.slot, `${t.module} (whole file)`,
            (lines ? `The opening balance${lines === 1 ? '' : 's'} of ${count(lines, 'ledger')} of the Chart of Accounts ${lines === 1 ? 'is' : 'are'} in this file${onZoho ? `: ${onZoho} entered on Zoho's own account${onZoho === 1 ? '' : 's'} (the default for a ledger named like one, or chosen in Mapping Studio)` : ''}${own ? `${onZoho ? ', and' : ':'} ${own} on the ledger's own account, as written in the Chart of Accounts file` : ''}. `
            + `It is one manual journal (OB-1) dated ${gctx.openingJournalDate}, ${dateWords}, balanced on "Opening Balance Adjustments", where Zoho puts the other side of every opening balance. `
            + 'A journal carries its own date, so these balances do not depend on the Opening Balance Date saved in Zoho Books. ' : '')
            + creditWords
            + 'Import the file after the Chart of Accounts, Customers and Vendors. Zoho Books accepted such a journal with lines on its own accounts and on bank accounts in two test imports; lines on other kinds of account, and the lines of OB-2, are new: check the first import.',
            'opening_balance_journal_for_zoho_accounts', lines + credits.length);
        }
        // OB-016: the journal is dated ON the Migration Date (the Opening Balance Date), which Zoho advises against (rule
        // OB-NO-TRANSACTION-ON-THE-DATE). Two imports accepted it, neither with a saved Opening Balance Date: kept, and said
        insFlag.run(job.id, t.slot, `Opening balance journal dated on the Migration Date (${gctx.openingJournalDate})`,
          `The opening balance journal is dated ${gctx.openingJournalDate}, the Migration Date itself. Zoho advises not to date transactions on the Opening Balance Date (rule OB-NO-TRANSACTION-ON-THE-DATE). `
          + 'Two test imports accepted such a journal, but neither had saved an Opening Balance Date first, so it is not proven. The Import Wizard asks for Sync (Settings > Opening Balances) after the last file; check there that Opening Balance Adjustments ends at zero.', 'opening_journal_on_migration_date', null);
        const unproven = built.filter(b => b.unproven && b.recId).length;
        if (unproven) {
          const accs = [...new Set(built.filter(b => b.unproven && b.recId).map(b => b.builtin.Account))];
          const stockLines = [...new Set(built.filter(b => b.unproven && b.recId && ledgerAccountType(b.record, gctx) === 'Stock').map(b => b.builtin.Account))];
          insFlag.run(job.id, t.slot, 'Opening balance journal OB-3',
            `${count(unproven, 'opening balance line')} ${unproven === 1 ? 'is' : 'are'} on a kind of account Zoho Books has not taken in this journal in our test imports (${accs.slice(0, 8).join(', ')}${accs.length > 8 ? ', ...' : ''}). `
            + "They are written in journal OB-3 (same date, its own line on Opening Balance Adjustments), so that if Zoho refuses one of them the proven balances in OB-1 (bank accounts and Zoho's own GST Payable, Advance Tax, TDS Receivable) still go in. The totals per account are the same as in one journal. "
            + 'If Zoho Books refuses OB-3, enter its balances by hand under Settings > Opening Balances.'
            + (stockLines.length ? ` The balance of ${stockLines.length === 1 ? 'the Stock account' : 'the Stock accounts'} ${stockLines.map(x => `"${x}"`).join(", ")} is in OB-3 and not in the Chart of Accounts file: Zoho's help says the Opening Balance Date cannot be changed once a stock opening balance exists, so a balance in the chart could lock the date before the step "Save the Migration Date" (COA-STOCK-OB-LOCKS-DATE). If Zoho refuses a journal line on a Stock account, type the balance on Settings > Opening Balances after the Migration Date is saved, never in the chart file before it.` : ''), 'opening_journal_split', unproven);
        }
        writeFile(key, t, built, { notes: `${lines ? `One manual journal (OB-1) dated ${gctx.openingJournalDate} with the opening balances of ${count(lines, 'ledger')} (${onZoho} on Zoho's own accounts, ${own} on their own account), balanced on Opening Balance Adjustments. ` : ''}${credits.length ? `Journal OB-2: ${count(credits.length, 'contact')} with an advance (a customer in credit or a vendor in debit). ` : ''}Import after the Chart of Accounts, Customers and Vendors.` });
        continue;
      }
      if (key === 'opening_balances') {
        // A reference report, not imported (see TEMPLATES.opening_balances). From a Tally Trial Balance report it is
        // built only when the report is at ledger level: see openingBalanceSource.
        const ob = openingBalanceSource(job.id, recs);
        if (ob.problem) insExcKind.run(job.id, t.slot, null, 'Opening Balances (file not created)', ob.problem, 'opening_balances_not_created');
        recs = ob.recs; gctx.trialBalanceNames = ob.names; fileNote = [t.referenceNote, ob.note].filter(Boolean).join(' ');
      }
      if (key === 'accounts') {
        // customers and vendors are contacts: left out of the Chart of Accounts (see accountRecords)
        const a = accountRecords(job.id, recs, gctx);
        recs = a.recs; fileNote = a.note;
        for (const r of a.merged) {
          const into = gctx.nameDecisions[r.name].mergeInto;
          insExcKind.run(job.id, t.slot, r.source_id, r.name,
            `Not written to the Chart of Accounts on its own: ${gctx.nameDecisions[r.name].by || 'the accountant'} decided in Mapping Studio (Names) that it is the same account as "${visibleName(into)}", written as "${visibleName(gctx.outputName(into))}". `
            + 'Its opening balance is added to that account\'s, and vouchers that name it are written with that account.', 'merged_into_other_account');
        }
        for (const r of a.toZoho) {
          const ob = money(JSON.parse(r.data).openingbalance);
          const has = ob && !ob.isZero();
          const byDefault = !!gctx.clashDecisions[r.name].byDefault;
          const taxLedger = !!gctx.clashDecisions[r.name].taxLedger;
          const fromDocs = taxLedger && byDefault && gctx.clashDecisions[r.name].fromDocuments ? gctx.clashDecisions[r.name] : null;
          insExcKind.run(job.id, t.slot, r.source_id, r.name,
            (fromDocs
              ? `Not written to the Chart of Accounts: ${fromDocs.why}. By default that account is used, so the balance is not split between two accounts. `
              : taxLedger && byDefault
              ? `Not written to the Chart of Accounts: it is a GST ledger under Duties & Taxes (${gctx.clashDecisions[r.name].why || 'told from its duty head and side in Tally'}), and Zoho Books posts invoices and bills to its own account "${gctx.clashDecisions[r.name].zohoName}". By default that account is used, so the balance is not split between two accounts. `
              : byDefault
              ? `Not written to the Chart of Accounts: its name is the name of "${gctx.clashDecisions[r.name].zohoName || builtinAccount(r.name)}", an account Zoho Books creates itself, and Zoho rejects a second account with that name ("Row already exists"). By default Zoho's own account is used. `
              : `Not written to the Chart of Accounts: ${gctx.clashDecisions[r.name].by || 'the accountant'} decided in Mapping Studio to use Zoho's own account "${gctx.clashDecisions[r.name].zohoName || builtinAccount(r.name)}". `)
            + (has ? `Its opening balance of ${ob.abs().toFixed(2)} ${ob.isNegative() ? 'Debit' : 'Credit'} is in the file opening_balances_for_zoho_accounts.csv instead.` : 'It has no opening balance, so nothing else is needed.')
            + ' Vouchers that name this ledger are written with the name of the Zoho account.'
            + (byDefault ? " To keep it as an account of its own, rename it in Mapping Studio (Zoho's own accounts)." : ''), fromDocs ? (fromDocs.taxKind === 'tds' ? 'tds_ledger_to_zoho_account' : 'rcm_ledger_to_zoho_account') : taxLedger && byDefault ? 'tax_ledger_to_zoho_account' : byDefault ? 'default_zoho_own_account' : 'zoho_builtin_account_used');
        }
        // OB-004: a ledger named like one of Zoho's own accounts whose type is of another kind (or that names an account
        // the Adjustment of invoices or bills posts to) keeps an account of its own, renamed so that Zoho accepts it
        for (const r of a.recs) {
          const cd = gctx.clashDecisions?.[r.name];
          if (!cd || cd.decision !== 'rename' || !cd.byDefault || !cd.why) continue;
          insExcKind.run(job.id, t.slot, r.source_id, r.name,
            `Written to the Chart of Accounts as "${visibleName(cd.newName)}", not on Zoho's own account "${cd.zohoName}": `
            + (cd.why === 'adjustment_account'
              ? `"${cd.zohoName}" is the account Zoho Books posts the Adjustment of invoices or bills to, which the adjustment journals are expected to bring back to zero, so a Tally ledger is not put on it. `
              : `the Tally ledger is of type "${cd.ledgerType}" (from its Tally group) and Zoho's account is of type "${cd.zohoType}", a different kind of account, so its balance would be shown in the wrong place. `)
            + 'Zoho does not accept a second account with the same name, so " (Tally)" is added to the name; the balance and every voucher that names the ledger use this account. '
            + "To use Zoho's own account anyway, or another name, decide it in Mapping Studio (Zoho's own accounts).", 'zoho_own_account_name_renamed');
        }
        for (const x of a.notInContacts) {
          const cust = x.section === 'customers';
          insExcKind.run(job.id, t.slot, x.rec.source_id, x.rec.name,
            `This ledger is under ${cust ? 'Sundry Debtors' : 'Sundry Creditors'} (group "${x.parent}"), so it is a ${cust ? 'customer' : 'vendor'} in Zoho Books and is not written to the Chart of Accounts. It is not in the ${cust ? 'Customer' : 'Vendor'} Master dataset, so it is in no file${money(JSON.parse(x.rec.data).openingbalance)?.isZero() === false ? ', and its opening balance is not entered' : ''}. `
            + `Upload a ${cust ? 'Customer' : 'Vendor'} Master file that includes it (or the All Masters file), or an accountant must decide how to enter it.`, 'party_ledger_not_in_contacts');
        }
        for (const r of a.profitAndLoss) {
          const ob = money(JSON.parse(r.data).openingbalance);
          const has = ob && !ob.isZero();
          insExcKind.run(job.id, t.slot, r.source_id, r.name,
            'Tally\'s own Profit & Loss A/c ledger is not written to the Chart of Accounts: Zoho Books keeps the accumulated profit in its own Retained Earnings account (and works out the current year\'s profit itself). '
            + (has && gctx.openingAnchor?.profitAndLoss && gctx.openingAnchor.recId === r.id ? `Its opening balance of ${ob.abs().toFixed(2)} ${ob.isNegative() ? 'Debit' : 'Credit'} in Tally (the profit or loss of earlier years) is the one balance to type on Zoho's "${ZOHO_RETAINED_EARNINGS}" account in the Import Wizard step "Save the Migration Date"; it is not in the opening balance journal, so it is not counted twice.`
              : has ? `Its opening balance of ${ob.abs().toFixed(2)} ${ob.isNegative() ? 'Debit' : 'Credit'} in Tally (the profit or loss of earlier years) is written in the opening balance journal (opening_balances_for_zoho_accounts.csv, journal OB-1) on Zoho's "${ZOHO_RETAINED_EARNINGS}" account, so nothing has to be typed.`
              : 'It has no opening balance in Tally, so nothing is missing from the files.'),
            has ? 'profit_and_loss_balance_in_journal' : 'profit_and_loss_ledger_left_out');
        }
      }
      if (key === 'customers' || key === 'vendors') {
        // a contact treated as the same party as another (Mapping Studio, Names) is not written on its own
        for (const r of recs.filter(x => mergedAway(gctx, x.name))) {
          const into = gctx.nameDecisions[r.name].mergeInto;
          const byDefault = !!gctx.nameDecisions[r.name].byDefault;
          insExcKind.run(job.id, t.slot, r.source_id, r.name,
            (byDefault
              ? `Not written to the ${t.module} file on its own: it has the same name as "${visibleName(into)}" (written as "${visibleName(gctx.outputName(into))}"), and Zoho Books rejects two rows with one Display Name ("Duplicate row found in your CSV/TSV file"). By default the two are treated as one party. `
              : `Not written to the ${t.module} file on its own: ${gctx.nameDecisions[r.name].by || 'the accountant'} decided in Mapping Studio (Names) that it is the same party as "${visibleName(into)}", written as "${visibleName(gctx.outputName(into))}". `)
            + 'Its opening balance is added to that contact\'s, and invoices, bills and journals that name it are written with that contact.'
            + (byDefault ? ' If they are two parties, choose "keep both" in Mapping Studio (Names) and give one a different name.' : ''), byDefault ? 'contact_merged_by_default' : 'merged_into_other_contact');
        }
        recs = recs.filter(x => !mergedAway(gctx, x.name));
        // v2 default 6: contacts with the same GSTIN and different names are kept apart (never merged by default):
        // one flagged item per GSTIN, unless a person already decided the group in Mapping Studio (Names)
        const decidedGroups = db.prepare("SELECT members FROM duplicate_decisions WHERE job_id = ?").all(job.id).flatMap(g => { try { return JSON.parse(g.members || '[]'); } catch { return []; } });
        const byGstin = new Map();
        for (const r of recs) {
          const row = t.row(JSON.parse(r.data), gctx);
          const g = row['GST Identification Number (GSTIN)'];
          if (!g) continue;
          if (!byGstin.has(g)) byGstin.set(g, []);
          byGstin.get(g).push({ rec: r, name: row['Display Name'] });
        }
        for (const [g, members] of byGstin) {
          if (new Set(members.map(m => m.name)).size < 2 || members.every(m => decidedGroups.includes(m.rec.name))) continue;
          insExcKind.run(job.id, t.slot, members[0].rec.source_id, members[0].rec.name,
            `${members.length} ${key === 'customers' ? 'customers' : 'vendors'} have the same GSTIN ${g} and different names: ${members.map(m => `"${visibleName(m.name)}"`).join(', ')}. They are written as separate contacts (the tool's default: contacts are joined only when their names are the same). `
            + 'If they are one party, choose "treat as one" in Mapping Studio (Names, possible duplicates).', 'same_gstin_kept_apart');
        }
      }
      if (!recs.length && !(key === 'items' && early.built.serviceItems.length)) continue;
      const built = recs.map(r => {
        const d = JSON.parse(r.data);
        // a check returns a message, a list of messages or of { kind, message }, or null
        for (const p of [].concat(t.check?.(d, gctx) || [])) {
          if (typeof p === 'string') insExc.run(job.id, 'generate', t.slot, r.source_id, r.name, p);
          else insExcKind.run(job.id, t.slot, r.source_id, r.name, p.message, p.kind);
        }
        return { builtin: t.row(d, gctx), record: d, recId: r.id, sourceId: r.source_id };
      });
      // File-level checks look at the standard values, whatever the column layout is.
      const fileProblem = t.fileCheck?.(built.map(b => b.builtin));
      if (fileProblem) insExc.run(job.id, 'generate', t.slot, null, `${t.module} (whole file)`, fileProblem);
      for (const f of t.fileFlags?.(built.map(b => b.builtin), gctx, built.map(b => b.record)) || []) insFlag.run(job.id, t.slot, `${t.module} (whole file)`, f.message, f.kind, f.uses ?? null);
      // Opening balances are entered once: customers and vendors in the Opening Balance column of their contact file;
      // every other ledger in the Chart of Accounts, EXCEPT bank (and credit card) accounts, whose balance Zoho does
      // not take there, and ledgers entered on one of Zoho's own accounts: those are in the opening balance journal
      // (opening_balances_for_zoho_accounts.csv), and the bank balances are also listed plainly (bankOpeningBalances)
      // so they can be typed in Zoho Books under Settings > Opening Balances if the journal is refused.
      // The Opening Balances file is a reference report and is not imported, so no balance is in two import files
      // (the former flag "opening_balance_in_two_files" no longer applies).
      // v2 default 15: the service items of the invoice lines that are not stock items, after the stock items
      if (key === 'items' && early.built.serviceItems.length) {
        const s = early.built.serviceItems;
        built.push(...s.map(x => ({ builtin: serviceItemRow({ ...x, hsn: x.hsn || resolveHsn({ raw: '', account: x.account, item: x.name }, { enabled: gctx.hsn?.enabled !== false, minDigits: gctx.hsn?.minDigits || 4, defaults: gctx.hsnDefaults }).value }), record: {}, recId: null, sourceId: null })));
        // round 1 (issue 10): the Product Type of each service item, from Tally's type of supply, else from its HSN/SAC
        for (const b of built.slice(-s.length)) {
          const it = b.builtin, pt = serviceItemProductType({ hsn: it['HSN/SAC'], typeOfSupply: s.find(x => x.name === it['Item Name'])?.typeOfSupply });
          if (pt.source === 'hsn') insFlag.run(job.id, t.slot, it['Item Name'], `Tally gives no type of supply (Goods or Services) for the ledger of the item "${it['Item Name']}", so its Product Type is "${pt.value}", read from its HSN/SAC ${it['HSN/SAC']} (a code starting with 99 is a service, any other code is goods). Zoho Books takes the goods or service nature of an invoice line from the item (GSTR-1, e-invoice). Change it in Mapping Studio (Rates) if it is wrong.`, 'item_product_type_from_hsn', 1);
          if (pt.disagrees) insFlag.run(job.id, t.slot, it['Item Name'], `The ledger of the item "${it['Item Name']}" is "${pt.tally}" in Tally, but its HSN/SAC ${it['HSN/SAC']} is ${pt.value === 'goods' ? 'a service code (starting with 99)' : 'a goods code (not starting with 99)'}. The Product Type is written as Tally says ("${pt.value}"). GSTR-1 and the e-invoice take the nature from the item, so correct the ledger's type of supply or its HSN/SAC in Tally (or in Mapping Studio, HSN/SAC) before the import.`, 'item_type_of_supply_differs_from_hsn', 1);
        }
        fileNote = [fileNote, `${count(s.length, 'service item')} added for invoice lines that are a ledger amount, not a stock item (Zoho requires an Item Name on every invoice line).`].filter(Boolean).join(' ');
        insFlag.run(job.id, t.slot, `${t.module} (whole file)`, `${count(s.length, 'service item')} ${s.length === 1 ? 'is' : 'are'} added after the stock items: one per account used on an invoice line that is not a stock item (${count(s.reduce((n, x) => n + x.lines, 0), 'line')}). `
          + 'Each is named after its account, with Rate 0.00, Item Type "Sales", the Product Type given by the type of supply of its ledger in Tally (goods or service; from the HSN/SAC when Tally gives none) and that account, so the Item Name the invoices carry exists in Zoho Books. Import the Items file before the invoices.', 'service_item_for_account', s.length);
      }
      writeFile(key, t, built, { ...(fileNote ? { notes: fileNote } : {}),
        // the settings the file depends on, so a later change marks it out of date only when it really differs
        ...(key === 'customers' || key === 'vendors' ? { buildSettings: { gstCodes: gctx.gstCodes, gstUnregisteredConsumerAs: gctx.gstUnregisteredConsumerAs } } : {}) });
    }

    // Voucher files: Invoices, Bills, Manual Journals (worked out above, before the Items file)
    const { vouchers, built } = early;
    for (const e of built.exceptions) {
      if (e.kind) insExcKind.run(job.id, e.rec.slot, e.rec.source_id, e.rec.name, e.message, e.kind); // left_out_cancelled, left_out_optional, left_out_deleted
      else insExc.run(job.id, 'generate', e.rec.slot, e.rec.source_id, e.rec.name, e.message);
    }
    for (const ledger of built.unmappedTax) insExc.run(job.id, 'generate', 'taxes', null, ledger, `Tax ledger "${ledger}" is not mapped to a Zoho tax. Map it in Mapping Studio.`);
    // Tax ledgers that appear together on a voucher where only some are mapped, and mappings not in the user's Zoho tax list.
    const insKind = sink(db.prepare("INSERT INTO exceptions (job_id, stage, slot, source_id, name, message, kind, uses) VALUES (?,'generate','taxes',NULL,?,?,?,?)"),
      (j, name, message, kind, uses) => ({ slot: 'taxes', sourceId: null, name, message, kind, uses }));
    for (const c of taxGenerateChecks(db, job.id, built, partySets(job.id).taxLedgers, gctx.taxMap)) insKind.run(job.id, c.name, c.message, c.kind, c.uses);
    // A tax ledger on the party's side of a bill or invoice (tax deducted at source, the liability side of tax under
    // reverse charge): one item per ledger and file, with the number of vouchers. No Zoho tax mapping is asked for it.
    const partyTaxInfo = taxLedgerInfos(db, job.id);
    for (const p of built.partySideTax) {
      const bill = p.file === 'bills';
      const isGst = !!partyTaxInfo(p.ledger)?.gst;
      insKind.run(job.id, p.ledger, `Tax ledger "${p.ledger}" is ${bill ? 'credited' : 'debited'} on ${count(p.vouchers, bill ? 'bill' : 'invoice')} of the ${bill ? 'Bills' : 'Invoices'} file, the same side as the ${bill ? 'vendor' : 'customer'}. `
        + `That is not a tax rate on a line of the ${bill ? 'bill' : 'invoice'}, so it is written as a line with a negative amount and no tax, and no Zoho tax mapping is asked for it. `
        + (isGst
          ? `It is a GST ledger in Tally. A ${bill ? 'bill' : 'invoice'} where the same GST is debited and credited by equal amounts is flagged as reverse charge instead; here the amounts do not match that shape. An accountant must decide how to enter it in Zoho Books (for example a ${bill ? 'vendor credit' : 'credit note'} or a separate journal).`
          : (bill ? 'Tally does not say its type of duty/tax is TDS, so it is not put in Zoho\'s TDS columns (that is never decided from the name). ' : '')
            + `An accountant must decide how to enter it in Zoho Books: ${bill ? 'in Zoho\'s TDS field (if it is TDS, set its type to TDS in Tally and export the masters again), as a vendor credit' : 'as a credit note'}, or as a separate journal.`), 'tax_ledger_party_side', p.vouchers);
    }
    // Lines that are an account, not a stock item, have no Item Name. Zoho's invoice sample marks Item Name as required,
    // and no real import has shown whether Zoho accepts a line without one: one flagged item per file, never blocking.
    for (const key of ['invoices', 'bills']) {
      const rows = built[key].rows.filter(r => !String(r.row['Item Name'] ?? '').trim());
      if (!rows.length) continue;
      const docs = new Set(rows.map(r => r.rec.id)).size;
      insFlag.run(job.id, null, `${VOUCHER_FILES[key].module} (whole file)`, `${count(rows.length, 'line')} on ${count(docs, key === 'invoices' ? 'invoice' : 'bill')} ${rows.length === 1 ? 'has' : 'have'} no Item Name: in Tally ${rows.length === 1 ? 'it is' : 'they are'} a ledger (an account), not a stock item, so the account is in Account and in the description. `
        + `${key === 'invoices' ? "Zoho's invoice sample marks Item Name as required" : "Zoho's bill sample does not say whether Item Name is required"}, and no real import has shown whether Zoho Books accepts a line without one. `
        + 'Import one document first. If Zoho rejects it for the missing item, create a service item in Zoho Books for each account used (or an accountant decides another way), then correct the file before importing the rest.', 'line_without_item_name', docs);
    }
    // TDS ledgers on the vendor side of bills with no Zoho TDS tax chosen yet (Mapping Studio, TDS mapping)
    for (const t of built.tdsUnmapped) {
      const inv = t.file === 'invoices';
      insKind.run(job.id, t.ledger, `TDS ledger "${t.ledger}" is ${inv ? 'debited' : 'credited'} on ${count(t.vouchers, inv ? 'invoice' : 'bill')} (tax deducted at source ${inv ? 'by the customer' : 'from the vendor'}), but no Zoho TDS tax is chosen for it and none can be suggested from its section in Tally. Until one is chosen, the TDS is written ${inv ? 'as a line with a negative amount, which Zoho Books may reject' : 'in the Adjustment column of the bill (or, on a bill with no other line, as a line with a negative amount), so the totals are those of Tally, but the TDS reports of Zoho Books do not show it'}. `
        + `Choose the Zoho TDS tax in Mapping Studio (TDS mapping), then create the files again: the ${inv ? 'invoices' : 'bills'} then carry it in Zoho's TDS columns.`,
        // on bills a blocker, as before; on invoices a negative line Zoho MAY refuse (not confirmed): not blocking
        inv ? 'tds_not_mapped_invoice' : 'tds_not_mapped', t.vouchers);
    }
    // a Zoho tax name written with more than one rate: the tax mapping cannot be right for all of them
    for (const n of built.taxNameRates) {
      insKind.run(job.id, n.zohoTax, `Zoho tax "${n.zohoTax}" is written with ${n.rates.length} different rates (${n.rates.map(r => `${r}%`).join(', ')}) on ${count(n.vouchers, 'voucher')}: the tax ledgers mapped to it are used at more than one GST rate in Tally. `
        + 'A Zoho tax has one rate, so the rows at the other rate are expected to be rejected or taxed wrongly. Use one Tally tax ledger per rate, or set the tax on those documents in Zoho Books.', 'tax_name_rate_mixed', n.vouchers);
    }
    // A document number that more than one Tally voucher brings into the same file. Both are written as in Tally.
    for (const d of built.repeatedNumbers) {
      const t = VOUCHER_FILES[d.file];
      const bySlot = {};
      for (const r of d.recs) bySlot[r.slot] = (bySlot[r.slot] || 0) + 1;
      insFlag.run(job.id, d.recs[0].slot, `${t.module}: ${t.idColumn} ${d.number === '' ? '(empty)' : `"${d.number}"`}`,
        `${t.idColumn} ${d.number === '' ? '(empty)' : `"${d.number}"`} is carried by ${d.recs.length} different Tally vouchers in the ${t.module} file (${Object.entries(bySlot).map(([s, n]) => `${slotByKey[s]?.name ?? s}: ${n}`).join(', ')}). `
        + (d.file === 'bills' ? 'They are bills of the same vendor, and Zoho Books keeps one bill per number and vendor, so it would read their rows as one bill, or reject the second. '
          : 'Tally numbers each voucher type on its own, so two vouchers of different types can carry the same number. Zoho Books would read their rows as one document, or reject the second. ')
        + 'Both are written with the number they have in Tally. An accountant must decide which number to change before the import.', 'document_number_repeated', d.recs.length);
    }
    // v2 default 9: Bill Number. The supplier's invoice number is used when Tally has one (never asked); a number used
    // by more than one vendor is said once, because Zoho keeps bill numbers per vendor but that has not been confirmed
    // for the import.
    if (built.billNumbers.fromReference) {
      insFlag.run(job.id, null, `${VOUCHER_FILES.bills.module} (whole file)`, `${count(built.billNumbers.fromReference, 'bill')} of ${built.bills.vouchers} carry the supplier's invoice number from Tally (the voucher's reference) as Bill Number; the others carry the Tally voucher number, because Tally has no supplier's invoice number for them. `
        + 'This is the tool\'s default. To number every bill with its Tally voucher number, change the Bill Number setting in Mapping Studio (Voucher files).', 'bill_number_from_reference', built.billNumbers.fromReference);
    }
    if (built.billNumbers.sharedByVendors) {
      insFlag.run(job.id, null, `${VOUCHER_FILES.bills.module} (whole file)`, `${count(built.billNumbers.sharedByVendors, 'Bill Number')} ${built.billNumbers.sharedByVendors === 1 ? 'is' : 'are'} used by more than one vendor (different suppliers can use the same invoice number). Each vendor's bill is a separate bill in Zoho Books, which keeps bill numbers per vendor. `
        + 'If Zoho Books joins or rejects these bills on import, change the Bill Number setting to the Tally voucher number in Mapping Studio (Voucher files).', 'bill_number_shared_by_vendors', built.billNumbers.sharedByVendors);
    }
    // the invoices and bills that will come to another total in Zoho Books than in Tally (not adjusted): kept for the Zoho
    // check (rule ...-TOTAL-DIFFERS-FROM-TALLY), so such a document never goes into Zoho unsaid
    if (!dry) {
      db.prepare('DELETE FROM doc_total_differs WHERE job_id = ?').run(job.id);
      const insDiffers = db.prepare('INSERT INTO doc_total_differs (job_id, key, number, party, difference) VALUES (?,?,?,?,?)');
      for (const d of built.recomputeDocs || []) if (!d.adjusted) insDiffers.run(job.id, d.file, String(d.number ?? ''), String(d.party ?? ''), d.difference);
      // the documents whose TDS Amount is not the TDS Percentage of the base (rule ...-TDS-AMOUNT-NOT-PERCENT, "may be refused")
      db.prepare('DELETE FROM doc_tds_differs WHERE job_id = ?').run(job.id);
      const insTds = db.prepare('INSERT INTO doc_tds_differs (job_id, key, number, party, difference) VALUES (?,?,?,?,?)');
      for (const d of built.tdsDiffersDocs || []) insTds.run(job.id, d.file, String(d.number ?? ''), String(d.party ?? ''), d.difference);
    }
    // the adjustment journals generated in the Manual Journals file (vouchers.js adjustmentJournalRows)
    if (built.adjustmentJournals?.length) {
      const j = built.adjustmentJournals;
      insFlag.run(job.id, null, `${VOUCHER_FILES.journals.module} (whole file)`, `${count(j.length, 'adjustment journal')} (${j.map(x => x.number).join(', ')}) ${j.length === 1 ? 'is' : 'are'} generated at the end of the Manual Journals file: Zoho Books posts the Adjustment of an invoice or bill to an account of its own, and ${j.length === 1 ? 'this journal moves' : 'these journals move'} each amount back to the Tally ledger it belongs to (round-off, a line that is not income, or the tax account whose tax Zoho rounded differently), so the trial balance stays Tally's. `
        + 'This is the tool\'s default and is not confirmed until the next test import. Import them after the invoices and bills.', 'adjustment_journal', j.length);
    }
    // the tax alignment journals generated in the Manual Journals file (vouchers.js taxAlignmentJournalRows)
    if (built.taxAlignmentJournals?.length) {
      const j = built.taxAlignmentJournals;
      const what = [j.some(x => x.tds) ? 'the TDS' : '', j.some(x => x.reverseCharge) ? 'the reverse charge' : ''].filter(Boolean).join(' and ') || 'the tax';
      insFlag.run(job.id, null, `${VOUCHER_FILES.journals.module} (whole file)`, `${count(j.length, 'tax alignment journal')} (${j.map(x => x.number).join(', ')}) ${j.length === 1 ? 'is' : 'are'} generated at the end of the Manual Journals file: Zoho Books posts ${what} of bills and invoices to its own tax accounts, and ${j.length === 1 ? 'this journal moves' : 'these journals move'} the difference to the accounts Tally used (${[...new Set(j.flatMap(x => x.accounts.map(a => a.account)))].map(a => `"${a}"`).join(', ')}; ${j.reduce((t, x) => t.plus(x.amount), new Decimal(0)).toFixed(2)} in all), so every account ends at Tally's figure. `
        + 'This is the tool\'s default and is not confirmed until the next test import. Import them after the invoices and bills.', 'tax_alignment_journal', j.length);
    }
    if (built.invoices.rows.some(r => r.row['Item Tax']) || built.bills.rows.some(r => r.row['Tax Name'] || r.row['Reverse Charge Tax Name'])) {
      const s = voucherSettings(db, job.id);
      insFlag.run(job.id, null, 'Invoices and Bills (whole files)', s.zohoTaxRounding === 'entity'
        ? 'The tax Zoho Books works out is expected to be rounded per document (each part of the tax added up over the document, then rounded), as chosen in Mapping Studio (Voucher files). The rounding Adjustments are worked out that way.'
        : "The tax Zoho Books works out is expected to be rounded per line (each part of the tax, CGST, SGST or IGST, of each line rounded to the paisa), as a test import showed. If your organisation rounds the tax per transaction (Settings > Taxes), choose that in Mapping Studio (Voucher files), then create the files again.", 'zoho_tax_rounding', null);
    }
    for (const [key, t] of Object.entries(VOUCHER_FILES)) {
      const b = built[key];
      if (!b.rows.length) continue;
      const notes = `${b.vouchers} voucher(s) in ${b.rows.length} rows, one row per line.` + (key === 'other_journals'
        // the parts add up to the voucher count said first: the groups written as a matter of course, and the rest
        // (vouchers whose pattern is not clear, flagged one by one)
        ? (() => {
          const parts = built.journalCategories.map(c => `${slotByKey[c.slot]?.name ?? c.slot}: ${c.vouchers}`);
          const unclear = b.vouchers - built.journalCategories.reduce((t, c) => t + c.vouchers, 0);
          if (unclear > 0) parts.push(`pattern not clear: ${unclear}`);
          const asJournals = built.journalCategories.filter(c => /_as_journal$/.test(c.category)).reduce((t, c) => t + c.vouchers, 0);
          return built.held.length
            ? ` Receipt, Payment, Contra and Debit / Credit Note vouchers that are not a customer or vendor payment, a vendor credit or a credit note (${parts.join(', ') || 'see the flagged items'}). `
            : ` Every Receipt, Payment, Contra and Debit / Credit Note voucher (${parts.join(', ') || 'see the flagged items'})${asJournals ? `; ${asJournals} of them are customer or vendor payments or notes, written on Accounts Receivable or Accounts Payable with the contact` : ''}. `;
        })()
          + 'Reference Number and the journal number carry the voucher type code (RCT-, PMT-, CTR-, DN-, CN-) before the Tally number. Customer and vendor lines are entered on Accounts Receivable and Accounts Payable with the contact in Contact Name.'
        : key === 'journals'
        ? ' Customer and vendor lines are entered on Accounts Receivable and Accounts Payable with the contact in Contact Name.'
        : ' The GST of each voucher is on the line it belongs to (the mapped Zoho tax, its rate and type); there are no separate tax rows.'
          + (built.tdsUsed.some(x => x.file === key) ? ` Tax deducted at source is in the TDS columns of ${count(built.tdsUsed.filter(x => x.file === key).reduce((t, x) => t + x.vouchers, 0), key === 'bills' ? 'bill' : 'invoice')}.` : '')
          + (b.rows.some(r => r.row.Adjustment) ? ' Round-off is in the Adjustment column: check that Adjustments is ticked in Zoho Books (Settings > Setup & Configurations > General; it is ticked by default in a new organisation) before the import.' : '')
          + (key === 'invoices' && built.serviceItems.length ? ` Lines that are not stock items carry the service item of their account (${count(built.serviceItems.length, 'service item')}, in the Items file): import the Items file first.` : '')
          + (built.partySideTax.some(p => p.file === key) ? ` A tax ledger on the same side as the ${key === 'bills' ? 'vendor' : 'customer'} that is not Zoho TDS is a line with a negative amount and no tax.` : ''));
      // A layout saved before the file took the official sample's headings may lack columns or read ones that no
      // longer exist: it is still written (those cells empty), and flagged so the layout is reset or corrected.
      const gaps = layoutGaps(key, getMapping(db, job.firm_id ?? 1, key).columns);
      if (gaps.missing.length || gaps.gone.length) {
        insFlag.run(job.id, null, `${t.module} (whole file)`, `The column layout saved for the ${t.module} file was made for an earlier version of the file: `
          + `${gaps.missing.length ? `${count(gaps.missing.length, 'column')} of the official Zoho sample ${gaps.missing.length === 1 ? 'is' : 'are'} missing (${gaps.missing.slice(0, 5).map(h => `"${h}"`).join(', ')}${gaps.missing.length > 5 ? ', ...' : ''})` : ''}`
          + `${gaps.missing.length && gaps.gone.length ? ', and ' : ''}${gaps.gone.length ? `${count(gaps.gone.length, 'column')} ${gaps.gone.length === 1 ? 'reads' : 'read'} a value the file no longer has and ${gaps.gone.length === 1 ? 'is' : 'are'} written empty (${gaps.gone.slice(0, 5).map(h => `"${h}"`).join(', ')})` : ''}. `
          + 'Reset the layout to the standard one in Template Mapping (an admin can do this), then create the files again.', 'voucher_layout_outdated', null);
      }
      writeFile(key, t, b.rows.map(({ rec, row }) => ({ builtin: row, record: rec.data, recId: rec.id, sourceId: rec.source_id })), { vouchers: b.vouchers, notes,
        // Invoices and Bills write the contact's GST Treatment, so they depend on the GST code set too
        ...(key === 'invoices' || key === 'bills' ? { buildSettings: { gstCodes: gctx.gstCodes, gstUnregisteredConsumerAs: gctx.gstUnregisteredConsumerAs } } : {}) });
    }
    // Voucher datasets that are stored but have no Zoho file: one flagged item per dataset, with its voucher count,
    // so the result says plainly what does not reach Zoho Books through these files.
    const storedBySlot = Object.fromEntries(db.prepare("SELECT slot, COUNT(*) n FROM source_records WHERE job_id = ? AND object_type = 'Voucher' GROUP BY slot").all(job.id).map(r => [r.slot, r.n]));
    // TALLY-002/TALLY-008: the vouchers with no Zoho file are counted from the outcome of each voucher (vouchers of a type
    // Tally does not post, or with no ledger amount), never from the dataset they are in
    const keptWithoutFile = {};
    for (const e of built.recon) if (e.outcome === 'no_file') keptWithoutFile[e.slot] = (keptWithoutFile[e.slot] || 0) + 1;
    for (const slot of Object.keys(keptWithoutFile)) {
      const n = keptWithoutFile[slot];
      insFlag.run(job.id, slot, `${slotByKey[slot].name} (no Zoho file)`,
        `${count(n, 'voucher')} of ${slotByKey[slot].name} ${n === 1 ? 'is' : 'are'} stored, counted and checked, but no Zoho file is created for ${n === 1 ? 'it' : 'them'} yet, so ${n === 1 ? 'it is' : 'they are'} in none of the files created now. `
        + (slot === OTHER_SLOT ? NO_FILE_EFFECT[slot] : `${NO_FILE_EFFECT[slot] || ''} ${n === 1 ? 'It has' : 'They have'} to be entered in Zoho Books another way until the platform creates a file for ${n === 1 ? 'it' : 'them'}.`.trim()),
        'vouchers_without_zoho_file', n);
    }
    // control total over EVERY voucher dataset: each stored voucher is written to a file, left out with a reason,
    // awaiting routing, or kept without a Zoho file
    // Receipt, Payment, Contra and Debit / Credit Note vouchers (payments.js): the ones held because the Zoho module they
    // belong in has no import sample yet are stored with their allocations, one flagged item per module says which
    // sample is needed, and the groups written as Manual Journals as a matter of course get one flagged item each.
    if (!dry) {
      const insHeld = db.prepare('INSERT INTO held_vouchers (job_id, source_record_id, file_key, number, detail) VALUES (?,?,?,?,?)');
      db.prepare('DELETE FROM held_vouchers WHERE job_id = ?').run(job.id);
      const accountName = gctx.outputName || (x => x);
      for (const h of built.held) insHeld.run(job.id, h.rec.id, h.file, String(h.rec.data.vouchernumber ?? ''), JSON.stringify(heldView(h, accountName)));
      // the credits the journals leave on contacts, with what each settles (the list credits_to_apply.csv)
      const insCredit = db.prepare('INSERT INTO journal_credits (job_id, source_record_id, detail) VALUES (?,?,?)');
      db.prepare('DELETE FROM journal_credits WHERE job_id = ?').run(job.id);
      for (const c of built.credits) insCredit.run(job.id, c.rec.id, JSON.stringify(creditView(c, accountName)));
    }
    // one flagged item (an assumption the tool made) for the credits to apply: what Zoho Books does with a contact line
    // of a journal, and where the list is
    if (built.credits.length) {
      const cs = creditSummary(built.credits.map(c => creditView(c, gctx.outputName || (x => x))));
      insFlag.run(job.id, null, 'Manual Journals (credits of customers and vendors)',
        `${count(cs.journals, 'Manual Journal')} credit a customer or debit a vendor on Accounts Receivable or Accounts Payable (${count(cs.credits, 'line')}, ${count(cs.contacts, 'contact')}). Zoho Books keeps each such line as a credit of the contact: the balances and the trial balance are right at once, but the invoice or bill it pays stays open until the credit is applied to it. `
        + `From Tally's bill-wise details: ${count(cs.apply.rows, 'amount')} (${cs.apply.amount}) ${cs.apply.rows === 1 ? 'settles' : 'settle'} ${count(cs.apply.invoices, 'invoice')} and ${count(cs.apply.bills, 'bill')} of these files; ${count(cs.openingBalance.rows, 'amount')} (${cs.openingBalance.amount}) ${cs.openingBalance.rows === 1 ? 'is' : 'are'} against documents from before the migration (the opening balance of the contact); ${count(cs.leave.rows, 'amount')} (${cs.leave.amount}) ${cs.leave.rows === 1 ? 'stays' : 'stay'} a credit as in Tally (advances and money on account). `
        + 'The list is the file credits_to_apply.csv (in the folder not_for_import of the zip; it is not imported), and the Import Wizard has the page "Apply the credits" after the journals. That Zoho Books lets a journal credit be applied to an opening balance was not tried yet.', 'journal_credits_to_apply', cs.credits);
    }
    const waiting = heldSummary(built.held);
    for (const [file, s] of Object.entries(waiting)) {
      insFlag.run(job.id, s.slot, `${s.module} (no Zoho sample)`,
        `${count(s.vouchers, 'voucher')} (${s.what}) belong in Zoho's ${s.module}, but no file is created for ${s.module}: its import sample is not in the platform, and no column is invented. `
        + `${s.vouchers === 1 ? 'It is' : 'They are'} held, counted in the voucher control total and listed in the Export Center, with the invoice or bill each amount would be applied to (${s.allocationsApplied} allocation(s) found from Tally's bill-wise details). `
        + `Needed: ${s.sample}. Until then ${s.vouchers === 1 ? 'it has' : 'they have'} to be entered in Zoho Books by hand, after the ${ALL_FILES[s.importAfter]?.module ?? s.importAfter} file.`
        + (isBuildable(file) ? ' Upload that sample in the Export Center (held vouchers) and the tool builds the file from its headings.' : ' This module stays held even with the sample uploaded now: its lines and tax have to be tested against a real sample first.'),
        'vouchers_waiting_for_zoho_sample', s.vouchers);
    }
    for (const c of built.journalCategories) {
      insFlag.run(job.id, c.slot, `${slotByKey[c.slot]?.name ?? c.slot} (written as Manual Journals)`,
        `${count(c.vouchers, 'voucher')} of ${slotByKey[c.slot]?.name ?? c.slot}: ${JOURNAL_CATEGORIES[c.category]} They are in the file ${VOUCHER_FILES.other_journals.file}.`, /_as_journal$/.test(c.category) ? 'payments_written_as_journals' : 'vouchers_written_as_journals', c.vouchers);
    }
    const written = built.invoices.vouchers + built.bills.vouchers + built.journals.vouchers + built.other_journals.vouchers;
    // TALLY-008: counted from the outcome recorded for each voucher, never from the wording of a message
    const leftOut = built.recon.filter(e => e.outcome === 'left_out').length;
    const notHandled = built.recon.filter(e => e.outcome === 'not_handled').length;
    if (notHandled) throw new Error(`Voucher control total failed: ${notHandled} voucher(s) were not handled by the file builder`);
    if (built.recon.length !== vouchers.length || new Set(built.recon.map(e => e.id)).size !== vouchers.length) throw new Error(`Voucher control total failed: ${vouchers.length} vouchers, ${built.recon.length} outcomes recorded`);
    const keptNoFile = Object.values(keptWithoutFile).reduce((a, b) => a + b, 0);
    const heldCount = built.held.length;
    const storedVouchers = VOUCHER_SLOTS.reduce((t, s) => t + (storedBySlot[s] || 0), 0);
    if (written + leftOut + built.undecided + heldCount + keptNoFile !== vouchers.length || vouchers.length !== storedVouchers) {
      throw new Error(`Voucher control total failed: ${storedVouchers} stored, ${written} written, ${leftOut} left out, ${built.undecided} unrouted, ${heldCount} waiting for a Zoho sample, ${keptNoFile} kept without a Zoho file`);
    }
    // where every voucher went and how each of its lines is written, for the voucher reconciliation (voucherrecon.js)
    voucherTotals = { stored: storedVouchers, written: { invoices: built.invoices.vouchers, bills: built.bills.vouchers, journals: built.journals.vouchers, other_journals: built.other_journals.vouchers },
      leftOut, awaitingRouting: built.undecided, waitingForZohoSample: Object.fromEntries(Object.entries(waiting).map(([k, s]) => [k, s.vouchers])), keptWithoutZohoFile: keptWithoutFile, balanced: true,
      // v2: of the vouchers left out, the ones dated outside the financial year (0 when the switch says include)
      leftOutOutsideYear: built.outsideYear.included ? 0 : built.outsideYear.vouchers };
    if (dry) return;
    saveRecon(db, job.id, built.recon, now()); // one outcome per voucher of every dataset (no_file ones included)
    // A Zoho report check stays only when its file came out exactly the same as before (same checksum).
    reconciliationCleared = clearReconciliation(job.id, unchanged);
    // The same rule for rejections, their corrections and the retry file.
    rejectionsCleared = clearRejections(job.id, unchanged);
    clearStale(job.id); // the files are now built from the current decisions and layouts
    // the assumptions (defaults applied) these files were built with, kept with the files
    db.prepare('INSERT OR REPLACE INTO applied_defaults (job_id, at, data) VALUES (?,?,?)').run(job.id, now(), JSON.stringify(summariseAssumptions(flags)));
    setStatus(job.id, 'generated');
  };
  if (dry) { build(); return { files, vouchers: voucherTotals, flags }; }
  tx(build);
  for (const [key, buf] of Object.entries(retryKept)) if (unchanged(key)) fs.writeFileSync(retryFile(job.id, key), buf);
  // an import result recorded in the Import Wizard for a file that came out unchanged still counts (import_status)
  try { syncImportStatus(db, job.id); } catch (e) { audit(job.id, 'import_status_sync_failed', String(e?.message || e)); }
  fs.writeFileSync(path.join(outDir, 'migration_manifest.json'), JSON.stringify({ job: job.id, company: job.company, financialYear: job.financial_year, generatedAt: now(), files, vouchers: voucherTotals }, null, 2));
  audit(job.id, 'generate', files.map(f => `${f.fileName} (${f.rows} rows)`).join(', ')
    + `; vouchers: ${voucherTotals.stored} stored, ${Object.values(voucherTotals.written).reduce((a, b) => a + b, 0)} written, ${voucherTotals.leftOut} left out, ${voucherTotals.awaitingRouting} awaiting routing, `
    + `${Object.values(voucherTotals.waitingForZohoSample).reduce((a, b) => a + b, 0)} waiting for a Zoho sample, `
    + `${Object.values(voucherTotals.keptWithoutZohoFile).reduce((a, b) => a + b, 0)} kept without a Zoho file`);
  auditReconciliationCleared(job.id, reconciliationCleared, 'the file was created again with different contents');
  auditRejectionsCleared(job.id, rejectionsCleared, 'the file was created again with different contents');
  // v2: nothing is silent. Every kind of default applied to these files is in the audit log, with how many records
  // it was applied to (each record carries its own flagged item of that kind).
  const assumptions = summariseAssumptions(flags);
  for (const a of assumptions) audit(job.id, 'default_applied', `${a.title}: ${a.count}. ${a.words}${a.blocking ? ' Zoho is expected to reject these rows until someone acts.' : ''} (flagged items of kind ${a.kind})`);
  // the Zoho check (zohocheckapi.js): every rule of zohorules.json on every row of the files just written
  try { runZohoCheck(db, job, now); } catch (e) { audit(job.id, 'zoho_check_failed', String(e?.message || e)); }
  return { files, vouchers: voucherTotals, assumptions };
}

// "Assumptions the tool made": every default applied (no decision was stored), counted per kind, with examples by
// Tally identifier and the screen where it can be changed. Worked out from a dry run of creating the files, so it is
// what the next "Create the files" will do. inFiles: the same list as stored with the files created last (null: none).
const assumptionsOf = job => cachedState('assumptions', job.id, () => assumptionsNow(getJob(job.id) || job));
function assumptionsNow(job) {
  const stored = db.prepare('SELECT at, data FROM applied_defaults WHERE job_id = ?').get(job.id);
  let inFiles = null;
  try { inFiles = stored ? { at: stored.at, assumptions: JSON.parse(stored.data) } : null; } catch { inFiles = null; }
  const processed = ['processed', 'generated'].includes(job.status) && !activeRuns.has(job.id);
  if (!processed) return { available: false, reason: 'The data has not been processed yet.', assumptions: [], total: 0, toCheck: 0, blocking: 0, inFiles: null, filesOutOfDate: false };
  let dryRun;
  try { dryRun = generate(job, { dry: true }); } catch (e) { return { available: false, reason: `The assumptions could not be worked out: ${e.message}`, assumptions: [], total: 0, toCheck: 0, blocking: 0, inFiles, filesOutOfDate: staleInfo(job.id).filesOutOfDate }; }
  const list = summariseAssumptions(dryRun.flags);
  const sig = l => JSON.stringify((l || []).map(a => [a.kind, a.count]));
  return { available: true, assumptions: list, total: list.reduce((t, a) => t + a.count, 0), toCheck: list.filter(a => a.check).reduce((t, a) => t + a.count, 0),
    blocking: list.filter(a => a.blocking).reduce((t, a) => t + a.count, 0), kinds: list.length,
    inFiles, sameAsFiles: inFiles ? sig(inFiles.assumptions) === sig(list) : null, filesOutOfDate: staleInfo(job.id).filesOutOfDate,
    note: 'A default is used only where no decision was made. A decision made in Mapping Studio or Voucher Classification always wins.' };
}

// The voucher datasets that feed a Zoho file (Invoices, Bills, Manual Journals; Receipt, Payment, Contra and Debit /
// Credit Notes as Manual Journals, or held for a Zoho module with no sample yet: payments.js). Every other voucher
// dataset (other voucher types) is kept without one.
// TALLY-002: Other Voucher Types feed the builder too: a voucher that posts to the ledgers is a Manual Journal, one that
// does not (Memorandum, orders, no ledger amount) has the outcome no_file.
const VOUCHER_FILE_SLOTS = ['sales', 'purchase', 'journal', ...MONEY_SLOTS, OTHER_SLOT];
// What it means for the files created that a voucher dataset has no Zoho file.
const NO_FILE_EFFECT = {
  receipt: 'The invoices in the Invoices file therefore reach Zoho Books without the money received against them.',
  payment: 'The bills in the Bills file therefore reach Zoho Books without the payments made against them.',
  contra: 'Transfers between bank and cash accounts are therefore not in the files.',
  debit_note: 'Debit notes (for example purchase returns) are therefore not in the files, so vendor balances in Zoho Books would not include them.',
  credit_note: 'Credit notes (for example sales returns) are therefore not in the files, so customer balances in Zoho Books would not include them.',
  other_vouchers: 'Tally does not post them to the ledgers (a type such as Memorandum, Reversing Journal or an order, or no ledger amount on the voucher), so they change no balance and need no Zoho file. A voucher of another type that does post is written as a Manual Journal.',
};
// The voucher control total of the files created last, worked out from what is stored: every stored voucher is written
// to a file, left out with a reason, awaiting routing, waiting for a Zoho sample (held_vouchers: Payments Received,
// Payments Made, Vendor Credits, Credit Notes), or kept without a Zoho file. null when no files were created.
function voucherControl(jobId) {
  if (!generatedKeys(jobId).length) return null;
  const one = (sql, ...a) => db.prepare(sql).get(jobId, ...a).n;
  const writtenTo = key => one('SELECT COUNT(DISTINCT source_record_id) n FROM generated_rows WHERE job_id = ? AND key = ?', key);
  const bySlot = Object.fromEntries(db.prepare("SELECT slot, COUNT(*) n FROM source_records WHERE job_id = ? AND object_type = 'Voucher' GROUP BY slot").all(jobId).map(r => [r.slot, r.n]));
  const written = { invoices: writtenTo('invoices'), bills: writtenTo('bills'), journals: writtenTo('journals'), other_journals: writtenTo('other_journals') };
  const waitingForZohoSample = Object.fromEntries(db.prepare('SELECT file_key, COUNT(*) n FROM held_vouchers WHERE job_id = ? GROUP BY file_key').all(jobId)
    .sort((a, b) => Object.keys(SAMPLE_NEEDED).indexOf(a.file_key) - Object.keys(SAMPLE_NEEDED).indexOf(b.file_key)).map(r => [r.file_key, r.n]));
  const waiting = Object.values(waitingForZohoSample).reduce((a, b) => a + b, 0);
  // TALLY-008: counted from the outcome recorded for each voucher (voucher_recon), never from message wording
  // (the outcome is read as the reconciliation reads it: a value kept in the entry's data wins over the column)
  const OUTCOME = "COALESCE(json_extract(data, '$.outcome'), outcome)";
  const leftOut = one(`SELECT COUNT(*) n FROM voucher_recon WHERE job_id = ? AND ${OUTCOME} = 'left_out'`);
  const awaitingRouting = one(`SELECT COUNT(*) n FROM voucher_recon WHERE job_id = ? AND ${OUTCOME} = 'awaiting_routing'`);
  const keptWithoutZohoFile = Object.fromEntries(db.prepare(`SELECT slot, COUNT(*) n FROM voucher_recon WHERE job_id = ? AND ${OUTCOME} = 'no_file' GROUP BY slot`).all(jobId)
    .sort((a, b) => VOUCHER_SLOTS.indexOf(a.slot) - VOUCHER_SLOTS.indexOf(b.slot)).map(r => [r.slot, r.n]));
  const stored = VOUCHER_SLOTS.reduce((t, s) => t + (bySlot[s] || 0), 0);
  const kept = Object.values(keptWithoutZohoFile).reduce((a, b) => a + b, 0);
  return { stored, written, leftOut, awaitingRouting, waitingForZohoSample, keptWithoutZohoFile,
    balanced: Object.values(written).reduce((a, b) => a + b, 0) + leftOut + awaitingRouting + waiting + kept === stored,
    // v2 (M6): of the vouchers left out, the ones dated outside the financial year
    leftOutOutsideYear: one("SELECT COUNT(*) n FROM exceptions WHERE job_id = ? AND stage = 'generate' AND kind = 'left_out_outside_year'") };
}

// ---------- API ----------
export function buildApp() {
  const app = Fastify({ bodyLimit: 300 * 1024 * 1024 });
  // Binary request bodies. A Tally file sent to an upload slot is written straight to a temporary file on disk
  // while its SHA-256 is worked out, so it is never held in memory: the handler gets { tempPath, size, sha256 }.
  // Every other binary body (a Zoho rejection file or report, which are small) is collected in memory as before.
  const TMP_DIR = path.join(DATA_DIR, 'tmp');
  fs.mkdirSync(TMP_DIR, { recursive: true });
  // Temporary files left behind by a server that stopped during an upload are removed once they are a day old.
  for (const f of fs.readdirSync(TMP_DIR)) { try { const p = path.join(TMP_DIR, f); if (Date.now() - fs.statSync(p).mtimeMs > 24 * 3600 * 1000) fs.rmSync(p, { force: true }); } catch { /* in use */ } }
  const tooLarge = limit => Object.assign(new Error(`The file is larger than the ${Math.round(limit / 1024 / 1024)} MB this server accepts.`), { statusCode: 413 });
  app.addContentTypeParser('application/octet-stream', (req, payload, done) => {
    const isTallyUpload = req.method === 'PUT' && /^\/api\/migrations\/[^/]+\/uploads\/[^/?]+/.test(req.url);
    let finished = false;
    const finish = (err, body) => { if (!finished) { finished = true; done(err, body); } };
    if (!isTallyUpload) {
      const chunks = []; let size = 0;
      payload.on('data', c => { size += c.length; if (size > MAX_BUFFERED_BYTES) { payload.destroy(); finish(tooLarge(MAX_BUFFERED_BYTES)); } else chunks.push(c); });
      payload.on('end', () => finish(null, Buffer.concat(chunks)));
      payload.on('error', finish);
      return;
    }
    const tempPath = path.join(TMP_DIR, `upload-${Date.now().toString(36)}-${randomBytes(8).toString('hex')}.part`);
    const out = fs.createWriteStream(tempPath);
    const hash = createHash('sha256');
    let size = 0;
    let failed = null;
    const abort = err => { if (failed) return; failed = err || new Error('The upload was interrupted.'); payload.destroy(); out.destroy(); };
    payload.on('data', c => {
      if (failed) return;
      size += c.length;
      if (size > MAX_UPLOAD_BYTES) return abort(tooLarge(MAX_UPLOAD_BYTES));
      hash.update(c);
      if (!out.write(c)) { payload.pause(); out.once('drain', () => payload.resume()); } // do not read faster than the disk writes
    });
    payload.on('end', () => out.end());
    payload.on('error', abort);
    payload.on('close', () => { if (!payload.readableEnded) abort(new Error('The upload was interrupted.')); });
    out.on('error', abort);
    // The request is handed on only when the file is fully written and closed, so it can be moved or removed safely.
    out.on('close', () => {
      if (failed) { try { fs.rmSync(tempPath, { force: true }); } catch { /* removed at the next start */ } finish(failed); }
      else finish(null, { tempPath, size, sha256: hash.digest('hex') });
    });
  });
  // An uploaded file that was not taken over by the handler (not signed in, wrong slot, rejected file) is removed.
  app.addHook('onResponse', (req, reply, done) => { const t = req.body?.tempPath; if (t) { try { fs.rmSync(t, { force: true }); } catch { /* removed at the next start */ } } done(); });

  const canSee = setupAuth(app, { db, ROOT, now, audit });
  app.addHook('preHandler', (req, reply, done) => { currentActor = req.user?.email || 'anonymous'; done(); });

  const need = (req, reply) => {
    let job = getJob(req.params.id);
    if (job && !canSee(req.user, job)) job = null; // other firms' migrations look like they do not exist
    if (!job) { reply.code(404).send({ error: 'Migration not found.' }); return null; }
    return job;
  };

  app.get('/api/health', () => ({ ok: true }));
  app.get('/api/catalogue', () => CATALOGUE);

  app.get('/api/migrations', req =>
    db.prepare('SELECT * FROM migrations ORDER BY created_at DESC').all().filter(j => canSee(req.user, j)).map(j => ({
      ...jobView(j),
      records: db.prepare('SELECT COUNT(*) n FROM source_records WHERE job_id = ?').get(j.id).n,
      uploads: db.prepare('SELECT COUNT(*) n FROM uploads WHERE job_id = ?').get(j.id).n,
      ...staleFields(j.id), // filesOutOfDate, outOfDateSince, outOfDateReasons, outOfDateFiles
    })));

  app.post('/api/migrations', (req, reply) => {
    const b = req.body || {};
    const company = String(b.company || '').trim();
    const fy = String(b.financialYear || '').trim();
    if (!company) return reply.code(400).send({ error: 'Company name is required.' });
    const fyError = checkFinancialYear(fy);
    if (fyError) return reply.code(400).send({ error: fyError });
    const ys = checkYearStart(b.yearStart);
    if (ys.error) return reply.code(400).send({ error: ys.error });
    const start = checkStartDate(b.startDate, fy, ys.value);
    if (start.error) return reply.code(400).send({ error: start.error });
    // the company's GSTIN: empty, or a GSTIN that can be right (format, state code, check character)
    const gstin = String(b.gstin || '').trim().toUpperCase();
    if (gstin && gstinProblem(gstin)) return reply.code(400).send({ error: `GSTIN: ${gstinProblem(gstin)}` });
    const n = db.prepare('SELECT COUNT(*) n FROM migrations').get().n + 1;
    const id = `MIG-${fy.slice(0, 4)}-${String(n).padStart(3, '0')}`;
    db.prepare('INSERT INTO migrations (id, company, gstin, financial_year, method, source, destination, status, created_at, updated_at, firm_id, start_date, year_start, year_source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, company, gstin, fy, b.method || 'Full Migration', 'TallyPrime', 'Zoho Books', 'awaiting_uploads', now(), now(), req.user.firm_id, start.date, ys.value, ys.value ? 'user' : null);
    audit(id, 'create_migration', `${company}, FY ${fy}${ys.value ? ` (year from ${ys.value})` : ''}, ${b.method || 'Full Migration'}, start date ${start.date}`);
    return reply.code(201).send(jobView(getJob(id)));
  });

  app.get('/api/migrations/:id', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    return { ...jobView(job), completeness: completeness(job.id), ...staleFields(job.id), processing: processStatus(job.id) };
  });

  // Changes the details entered on New Migration (going back to that page edits the same migration, never a new one).
  // Body: any of { company, gstin, financialYear, method, startDate }; fields left out are kept. The financial year
  // cannot change once a file is uploaded (uploads are read against it); a new company name is checked against the
  // uploaded files again (their company warnings are worked out again). The start date must stay inside the year. Each change is audited with the old and the new value. No file is built from these
  // details (the financial year is used when files are read, and it is locked by then), so nothing is marked out of date.
  app.put('/api/migrations/:id', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const b = req.body || {};
    const next = {
      company: b.company === undefined ? job.company : String(b.company || '').trim(),
      gstin: b.gstin === undefined ? (job.gstin || '') : String(b.gstin || '').trim().toUpperCase(),
      financial_year: b.financialYear === undefined ? job.financial_year : String(b.financialYear || '').trim(),
      method: b.method === undefined ? job.method : String(b.method || '').trim(),
    };
    if (!next.company) return reply.code(400).send({ error: 'Company name is required.' });
    if (!next.method) return reply.code(400).send({ error: 'Choose a migration method.' });
    if (b.gstin !== undefined && next.gstin && gstinProblem(next.gstin)) return reply.code(400).send({ error: `GSTIN: ${gstinProblem(next.gstin)}` });
    const fyChanged = fyRange(next.financial_year)?.from !== fyRange(job.financial_year)?.from;
    if (fyChanged) { const fyError = checkFinancialYear(next.financial_year); if (fyError) return reply.code(400).send({ error: fyError }); }
    else next.financial_year = job.financial_year; // the same year written another way (2024-25 / 2024–25) is not a change
    const files = db.prepare('SELECT COUNT(*) n FROM uploads WHERE job_id = ?').get(job.id).n;
    // The financial year is locked: the uploaded files were read against it (dates, dated details). The company name
    // can change; the uploaded files are checked against the new name (warnings only, as at upload).
    if (files && fyChanged) {
      return reply.code(409).send({ error: 'The financial year cannot change after files are uploaded: the files were read against it. Remove the uploaded files first, or start a new migration.' });
    }
    // the year start typed (yearStart: '' clears it, and the year is worked out from the Tally data again at processing)
    const ys = b.yearStart === undefined ? { value: job.year_source === 'user' ? job.year_start : undefined } : checkYearStart(b.yearStart);
    if (ys.error) return reply.code(400).send({ error: ys.error });
    if (b.yearStart !== undefined) { next.year_start = ys.value; next.year_source = ys.value ? 'user' : null; }
    const yearChanged = b.yearStart !== undefined && (ys.value || null) !== (job.year_source === 'user' ? job.year_start : null);
    const startWanted = b.startDate === undefined ? (fyChanged || yearChanged ? null : jobView(job).start_date) : b.startDate;
    const start = checkStartDate(startWanted, next.financial_year, b.yearStart !== undefined ? ys.value : job.year_start);
    if (start.error) return reply.code(400).send({ error: start.error });
    next.start_date = start.date;
    const before = { ...jobView(job) };
    const words = { company: 'company', gstin: 'GSTIN', financial_year: 'financial year', method: 'method', start_date: 'start date', year_start: 'year start' };
    if (next.year_start === undefined) next.year_start = before.year_start;
    const changes = Object.keys(words).filter(k => String(before[k] ?? '') !== String(next[k] ?? ''));
    if (!changes.length) return jobView(job);
    let recheck = null;
    tx(() => {
      db.prepare('UPDATE migrations SET company = ?, gstin = ?, financial_year = ?, method = ?, start_date = ?, updated_at = ? WHERE id = ?')
        .run(next.company, next.gstin, next.financial_year, next.method, next.start_date, now(), job.id);
      // a year start typed (or cleared) is applied at the next processing and file creation
      if (b.yearStart !== undefined) db.prepare('UPDATE migrations SET year_start = ?, year_source = ? WHERE id = ?').run(next.year_start, next.year_source, job.id);
      if (changes.includes('year_start') && files) markStale(job.id, `The year start was changed to ${next.year_start || '1 April (or the year found in the Tally data)'}: process the data again and create the files again.`, null, 'setting:year_start');
      if (files && next.company !== job.company) recheck = recheckCompany(job.id, next.company);
    });
    audit(job.id, 'migration_details_changed', changes.map(k => `${words[k]}: ${before[k] || '(none)'} -> ${next[k] || '(none)'}`).join('; ')
      + (recheck ? `; the uploaded files were checked against the new company name: ${recheck.checked} checked, ${recheck.differ} name a different company${recheck.unknown ? `, ${recheck.unknown} not known (uploaded before the company of a file was kept)` : ''}` : ''));
    return { ...jobView(getJob(job.id)), ...(recheck ? { companyRecheck: recheck } : {}) };
  });

  const PROCESSING_BUSY = 'The data of this migration is being processed. Wait until processing has finished, then try again.';

  // Asynchronous (the file is checked record by record, with pauses), so the signed-in user is captured first
  // and passed to every audit entry: currentActor may belong to another request by the time the check ends.
  // ----- the All Masters file (PUT /uploads/all_masters) -----
  // The file is checked and split into the existing datasets (see splitAllMastersFile and routeMaster):
  //   Group records and every ledger not under the three groups below -> Chart of Accounts
  //   ledgers under Sundry Debtors / Sundry Creditors / Duties & Taxes (at any depth) -> Customer / Vendor / Tax Configuration
  //   Stock Item records -> Stock Items; Unit records -> Units of Measurement
  //   every other record type -> counted and listed as "kept for reference, not used"; never an error.
  // Each dataset with records becomes an ordinary upload of its slot (marked with the file's checksum in bundle_sha), so
  // processing, counts, checks and files work exactly as for files uploaded on their own.
  // Separate files and the All Masters file: the LATER upload wins for a dataset. This file replaces a dataset uploaded
  // on its own earlier (the message says so); a file uploaded on its own later replaces that one dataset only.
  // A dataset this file has no records for keeps a file uploaded on its own. Units and Stock Items with no records here
  // (and no file of their own) are marked not applicable automatically, with the reason; the user can undo that.
  const uploadAllMasters = async (req, reply, job, actor) => {
    const fileName = path.basename(decodeURIComponent(String(req.headers['x-filename'] || 'all_masters.json')));
    const workDir = path.join(TMP_DIR, `split-${Date.now().toString(36)}-${randomBytes(6).toString('hex')}`);
    const cleanUp = () => { try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* removed at the next start */ } };
    const reject = (code, error) => { cleanUp(); audit(job.id, 'upload_rejected', `All Masters: ${fileName}: ${error}`, actor); return reply.code(code).send({ error }); };
    const split = await splitAllMastersFile(req.body.tempPath, workDir);
    if (!split.ok) return reject(422, split.error);
    // every dataset part is checked exactly like a file uploaded on its own (record types, key fields, fields not read)
    const parts = {};
    for (const [key, file] of Object.entries(split.files)) {
      const v = await validateUploadFile(slotByKey[key], file, job, { tree: split.tree });
      if (!v.ok) return reject(422, `${slotByKey[key].name}: ${v.error}`);
      parts[key] = v;
    }
    if (!getJob(job.id)) { cleanUp(); return reply.code(404).send({ error: 'Migration not found.' }); }
    if (activeRuns.has(job.id)) { cleanUp(); return reply.code(409).send({ error: PROCESSING_BUSY }); }

    const dir = path.join(DATA_DIR, 'uploads', job.id);
    fs.mkdirSync(dir, { recursive: true });
    const sha = req.body.sha256;
    const original = path.join(dir, 'all_masters.original'); // kept as uploaded (any encoding), for reference
    const ups = Object.fromEntries(db.prepare('SELECT * FROM uploads WHERE job_id = ?').all(job.id).map(u => [u.slot, u]));
    const waivers = Object.fromEntries(db.prepare('SELECT * FROM waivers WHERE job_id = ?').all(job.id).map(w => [w.slot, w]));
    const messages = [], autoWaived = [], datasets = [];
    const cw = companyWarning(split.company, job); // also in each dataset's warnings (the envelope is copied into each part)
    if (cw) messages.push(cw);
    const at = now();
    tx(() => {
      for (const key of ALL_MASTERS_SLOTS) {
        const slot = slotByKey[key], before = ups[key], part = parts[key];
        if (part) {
          const p = path.join(dir, `${key}.json`);
          fs.renameSync(split.files[key], p);
          if (before && !before.bundle_sha) messages.push(`${slot.name}: the file uploaded on its own earlier ("${before.file_name}") was replaced by the records from this file.`);
          db.prepare('INSERT OR REPLACE INTO uploads (job_id, slot, file_name, size, sha256, records, warnings, uploaded_at, path, main_records, record_types, unread_fields, key_fields, bundle_sha) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
            .run(job.id, key, fileName, fs.statSync(p).size, sha, part.records, JSON.stringify(part.warnings), at, p,
              part.mainRecords, JSON.stringify(part.recordTypes), JSON.stringify(part.fieldsNotRead), JSON.stringify(part.keyFields), sha);
          setFileCompany(job.id, key, split.company);
          db.prepare('DELETE FROM waivers WHERE job_id = ? AND slot = ?').run(job.id, key);
          datasets.push({ key, records: part.records, main: part.mainRecords });
          continue;
        }
        // no records for this dataset in the file
        if (before?.bundle_sha) { // it came from an earlier All Masters file: that is replaced as a whole
          fs.rmSync(before.path, { force: true });
          db.prepare('DELETE FROM uploads WHERE job_id = ? AND slot = ?').run(job.id, key);
          messages.push(`${slot.name}: this file has no records for it, so the records taken from the earlier All Masters file were removed.`);
        } else if (before) {
          messages.push(`${slot.name}: this file has no records for it. The file uploaded on its own earlier ("${before.file_name}") is kept.`);
          continue;
        }
        if (slot.requirement === 'conditional' && !waivers[key]) {
          const reason = key === 'units'
            ? `${AUTO_WAIVER_PREFIX}the All Masters file "${fileName}" has no Unit records. `
              + (split.itemUnits.length
                ? `Its stock items name ${split.itemUnits.length} unit(s); they are written in the Items file as they are in Tally and can be changed in unit mapping. They are not checked against a Units file.`
                : 'Its stock items name no unit either.')
            : `${AUTO_WAIVER_PREFIX}the All Masters file "${fileName}" has no Stock Item records.`;
          db.prepare('INSERT OR REPLACE INTO waivers VALUES (?,?,?,?)').run(job.id, key, reason, at);
          autoWaived.push(key);
          messages.push(`${slot.name}: marked not applicable automatically, because this file has no ${key === 'units' ? 'Unit' : 'Stock Item'} records. Upload a file for it if your company uses ${key === 'units' ? 'units' : 'stock items'}.`);
        } else if (slot.requirement === 'required' && MASTERS_EMPTY_SLOTS.includes(key)) {
          // the All Masters file holds every ledger: no Duties & Taxes ledger in it means the company has none
          // (an automatic mark of an earlier All Masters file is renewed with this file's name; a user's own mark is kept)
          if (!waivers[key] || String(waivers[key].reason || '').startsWith(AUTO_WAIVER_PREFIX)) {
            db.prepare('INSERT OR REPLACE INTO waivers VALUES (?,?,?,?)').run(job.id, key, mastersWaiverReason(key, fileName), at);
            autoWaived.push(key);
          }
          messages.push(`${slot.name}: marked not applicable automatically, because this file has no ledger under Duties & Taxes (the company has no GST or TDS ledger). Upload a file for it if your company has tax ledgers.`);
        } else if (slot.requirement === 'required') {
          messages.push(`${slot.name}: this file has no records for it. Upload a file for it on its own, if Tally has any.`);
        }
      }
      // an earlier All Masters file's automatic "not applicable" that no longer applies is removed
      const earlier = db.prepare('SELECT auto_waived FROM master_bundles WHERE job_id = ?').get(job.id);
      for (const key of JSON.parse(earlier?.auto_waived || '[]')) {
        if (!autoWaived.includes(key) && String(waivers[key]?.reason || '').startsWith(AUTO_WAIVER_PREFIX)) db.prepare('DELETE FROM waivers WHERE job_id = ? AND slot = ?').run(job.id, key);
      }
      const notUsed = { ...split.notUsed };
      if (Object.keys(split.notFromThisFile).length) {
        messages.push(`${Object.entries(split.notFromThisFile).map(([t, n]) => `${n} ${t}`).join(', ')} record(s) in this file were not used. Vouchers and reports are taken only from their own upload slots.`);
        Object.assign(notUsed, split.notFromThisFile);
      }
      fs.renameSync(req.body.tempPath, original);
      db.prepare('INSERT OR REPLACE INTO master_bundles (job_id, file_name, size, sha256, encoding, records, record_types, datasets, not_used, auto_waived, messages, uploaded_at, path, actor, voucher_types) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(job.id, fileName, req.body.size, sha, split.encoding, split.records, JSON.stringify(split.recordTypes),
          JSON.stringify(Object.fromEntries(datasets.map(d => [d.key, { records: d.records, main: d.main }]))), JSON.stringify(notUsed), JSON.stringify(autoWaived), JSON.stringify(messages), at, original, actor,
          JSON.stringify(split.voucherTypes));
      setStatus(job.id, 'awaiting_uploads');
    });
    cleanUp();
    // An All Transactions file uploaded earlier is sorted again when its voucher types may now be traced differently.
    const resorted = await resortTransactions(job, actor, `the All Masters file "${fileName}" was uploaded`);
    if (resorted) messages.push(resorted);
    messages.push(...await recheckOwnVoucherFiles(job, actor, `the All Masters file "${fileName}" was uploaded`));
    markStale(job.id, `A new All Masters file was uploaded (${datasets.map(d => slotByKey[d.key].name).join(', ')}).`, null, null, actor);
    const counted = d => `${d.main} ${d.key === 'accounts' ? 'ledgers' : d.key === 'stock_items' ? 'stock items' : d.key === 'units' ? 'units' : d.key === 'taxes' ? 'tax ledgers' : d.key}`;
    audit(job.id, 'upload_all_masters', `${fileName}, ${split.records} records (${ENCODING_NAMES[split.encoding]}), sha256 ${sha.slice(0, 12)}: `
      + datasets.map(d => `${slotByKey[d.key].name} ${counted(d)}`).join(', ')
      + (Object.keys(split.notUsed).length ? `; not used: ${Object.entries(split.notUsed).map(([t, n]) => `${n} ${t}`).join(', ')}` : '')
      + (autoWaived.length ? `; marked not applicable automatically: ${autoWaived.map(k => slotByKey[k].name).join(', ')}` : ''), actor);
    const expected = Object.fromEntries(db.prepare('SELECT slot, expected FROM expected_counts WHERE job_id = ?').all(job.id).map(e => [e.slot, e.expected]));
    return {
      slot: ALL_MASTERS, fileName, sha256: sha, size: req.body.size, records: split.records, recordTypes: split.recordTypes,
      encoding: split.encoding, encodingName: ENCODING_NAMES[split.encoding],
      datasets: datasets.map(d => {
        const part = parts[d.key], exp = expected[d.key] ?? null;
        return { slot: d.key, name: slotByKey[d.key].name, records: d.records, mainRecords: d.main, groups: d.records - d.main,
          warnings: part.warnings, fieldsNotRead: part.fieldsNotRead, keyFields: part.keyFields, mayNotBeReadable: part.keyFields.mayNotBeReadable,
          expectedCount: exp, actualCount: d.main, countMatches: exp === null ? null : exp === d.main };
      }),
      notUsed: Object.entries(split.notUsed).map(([type, records]) => ({ type, records })),
      notFromThisFile: Object.entries(split.notFromThisFile).map(([type, records]) => ({ type, records })),
      // Voucher Type records: not a dataset, but used to sort vouchers of the company's own voucher types
      voucherTypes: Object.keys(split.voucherTypes).length,
      autoNotApplicable: autoWaived.map(k => ({ slot: k, name: slotByKey[k].name })),
      messages,
      // warnings of the dataset parts; a warning about the whole file (the company name) is given once, first
      warnings: [...new Set([...(cw ? [cw] : []), ...datasets.flatMap(d => parts[d.key].warnings)])],
    };
  };

  // ----- the All Transactions file (PUT /uploads/all_transactions) -----
  // Designed like the All Masters upload. The file is read record by record and split by voucher type into the voucher
  // datasets (splitAllTransactionsFile; the routing is in transactions.js):
  //   Sales, Purchase, Receipt, Payment, Journal, Contra, Debit Note, Credit Note -> the dataset of that type, together
  //   with the company's own voucher types placed under it (followed through the Voucher Type records of the All Masters file);
  //   every other voucher type, and any type that cannot be traced -> Other Voucher Types (flagged when processed);
  //   records that are not vouchers -> counted and listed as not used; never an error.
  // Each dataset with vouchers becomes an ordinary upload of its slot (bundle_sha = the file's checksum, bundle_kind =
  // 'transactions'), so processing, counts, checks and files work exactly as for files uploaded on their own.
  // The LATER upload wins for a dataset, as for masters: this file replaces a dataset uploaded on its own earlier (the
  // message says so); a file uploaded on its own later replaces that one dataset only.
  // A VOUCHER TYPE WITH NO VOUCHERS IN THE FILE (for example Purchase, when purchases are entered as journals): the file
  // holds every voucher of the period, so it is the evidence that there are none. The dataset is marked not applicable
  // automatically, with that reason, unless a file uploaded on its own is in place (which is kept). This is the only way
  // a required voucher dataset can be left without a file: without an All Transactions file, a missing Sales, Purchase,
  // Receipt, Payment or Journal file cannot be told from a forgotten one, so those five stay required. Removing the All
  // Transactions file removes its automatic marks again. The user can undo a mark in Completeness Check.
  // resort: the kept file is sorted again (after an All Masters file was uploaded or removed): datasets replaced since
  // by a file uploaded on its own are then left alone.
  // Returns { ok: true, result } or { ok: false, code, error }.
  const applyAllTransactions = async ({ job, sourcePath, fileName, sha, size, actor, resort = false }) => {
    const workDir = path.join(TMP_DIR, `split-${Date.now().toString(36)}-${randomBytes(6).toString('hex')}`);
    const cleanUp = () => { try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* removed at the next start */ } };
    const fail = (code, error) => { cleanUp(); return { ok: false, code, error }; };
    const voucherTypes = voucherTypesOf(job.id);
    const mastersSha = db.prepare('SELECT sha256 FROM master_bundles WHERE job_id = ?').get(job.id)?.sha256 ?? null;
    // how the file was sorted last time (only used when it is sorted again)
    const earlierSort = resort ? db.prepare('SELECT datasets, not_placed FROM transaction_bundles WHERE job_id = ?').get(job.id) : null;
    const earlierCounts = JSON.parse(earlierSort?.datasets || '{}'), earlierNotPlaced = JSON.parse(earlierSort?.not_placed || '{}');
    const notPlaced = {};
    const split = await splitAllTransactionsFile(sourcePath, workDir, voucherTypes);
    if (!split.ok) return fail(422, split.error);
    // every dataset part is checked exactly like a file uploaded on its own (voucher types, dates, key fields, fields not read)
    const parts = {};
    for (const [key, file] of Object.entries(split.files)) {
      const v = await validateUploadFile(slotByKey[key], file, job, { voucherTypes });
      if (!v.ok) return fail(422, `${slotByKey[key].name}: ${v.error}`);
      parts[key] = v;
    }
    if (!getJob(job.id)) return fail(404, 'Migration not found.');
    if (activeRuns.has(job.id)) return fail(409, PROCESSING_BUSY);

    const dir = path.join(DATA_DIR, 'uploads', job.id);
    fs.mkdirSync(dir, { recursive: true });
    const original = path.join(dir, 'all_transactions.original'); // kept as uploaded (any encoding), for reference and for sorting again
    const ups = Object.fromEntries(db.prepare('SELECT * FROM uploads WHERE job_id = ?').all(job.id).map(u => [u.slot, u]));
    const waivers = Object.fromEntries(db.prepare('SELECT * FROM waivers WHERE job_id = ?').all(job.id).map(w => [w.slot, w]));
    const messages = [], autoWaived = [], datasets = [];
    const statuses = { cancelled: 0, optional: 0, deleted: 0 }; // and void, only when a voucher is void (TALLY-007)
    for (const p of Object.values(parts)) for (const [k, n] of Object.entries(p.statuses || {})) if (n || k in statuses) statuses[k] = (statuses[k] || 0) + (n || 0);
    const cw = companyWarning(split.company, job);
    if (cw) messages.push(cw);
    const fromThisKind = u => !!u?.bundle_sha && u.bundle_kind === 'transactions';
    const at = now();
    tx(() => {
      for (const key of ALL_TRANSACTIONS_SLOTS) {
        const slot = slotByKey[key], before = ups[key], part = parts[key];
        const ownFile = before && !fromThisKind(before); // a file uploaded on its own is in place
        if (part) {
          // Sorting again never undoes what the user did since the file was uploaded: a dataset replaced by a file
          // uploaded on its own keeps that file, and a dataset the user removed is not put back. Vouchers that the new
          // sorting moves INTO such a dataset would then be in no dataset at all: they are counted (against the number
          // the dataset had when it was replaced or removed), said in the result, kept with the file and flagged when
          // the data is processed. They are never dropped silently.
          const removedSince = resort && !before && (earlierCounts[key] ?? 0) > 0;
          if (resort && (ownFile || removedSince)) {
            const baseline = earlierNotPlaced[key]?.baseline ?? earlierCounts[key] ?? 0;
            const n = { baseline, vouchers: Math.max(0, part.records - baseline), why: ownFile ? 'own_file' : 'removed', fileName: ownFile ? before.file_name : null };
            notPlaced[key] = n;
            if (n.vouchers) messages.push(notPlacedMessage({ slot: key, name: slot.name, ...n }));
            continue;
          }
          const p = path.join(dir, `${key}.json`);
          fs.renameSync(split.files[key], p);
          if (ownFile) messages.push(`${slot.name}: the file uploaded on its own earlier ("${before.file_name}") was replaced by the vouchers from this file.`);
          db.prepare('INSERT OR REPLACE INTO uploads (job_id, slot, file_name, size, sha256, records, warnings, uploaded_at, path, main_records, record_types, unread_fields, key_fields, bundle_sha, bundle_kind) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
            .run(job.id, key, fileName, fs.statSync(p).size, sha, part.records, JSON.stringify(part.warnings), at, p,
              part.mainRecords, JSON.stringify(part.recordTypes), JSON.stringify(part.fieldsNotRead), JSON.stringify(part.keyFields), sha, 'transactions');
          setFileCompany(job.id, key, split.company);
          db.prepare('DELETE FROM waivers WHERE job_id = ? AND slot = ?').run(job.id, key);
          datasets.push({ key, records: part.records });
          continue;
        }
        // no vouchers of this type in the file
        if (before && !ownFile) { // it came from an earlier All Transactions file (or from this one, sorted differently)
          fs.rmSync(before.path, { force: true });
          db.prepare('DELETE FROM uploads WHERE job_id = ? AND slot = ?').run(job.id, key);
          if (!resort) messages.push(`${slot.name}: this file has no ${typePlural(key)}, so the vouchers taken from the earlier All Transactions file were removed.`);
        } else if (before) {
          messages.push(`${slot.name}: this file has no ${typePlural(key)}. The file uploaded on its own earlier ("${before.file_name}") is kept.`);
          continue;
        }
        const w = waivers[key];
        if (!w || String(w.reason || '').startsWith(AUTO_WAIVER_PREFIX)) {
          db.prepare('INSERT OR REPLACE INTO waivers VALUES (?,?,?,?)').run(job.id, key, transactionsWaiverReason(key, fileName), at);
          autoWaived.push(key);
        }
      }
      // No clean-up of an earlier file's automatic marks is needed here: a dataset that gets vouchers has its mark
      // removed above, and every other dataset without a file of its own is marked (again) by this file.
      if (autoWaived.length) {
        messages.push(`No vouchers of these types are in this file, so their datasets were marked not applicable automatically: ${autoWaived.map(k => slotByKey[k].name).join(', ')}. `
          + 'The reason is kept with each one, and you can undo it in Completeness Check.');
      }
      for (const t of split.voucherTypes.filter(x => x.how === 'master')) messages.push(`${t.vouchers} voucher(s) of your own voucher type "${t.type}" were sorted as ${t.base} vouchers, following the Voucher Type records of the All Masters file.`);
      for (const t of split.voucherTypes.filter(x => x.slot === OTHER_SLOT)) messages.push(otherTypeMessage(t, !!voucherTypes));
      const flagged = Object.entries(statuses).filter(([, n]) => n);
      if (flagged.length) messages.push(`${flagged.map(([s, n]) => `${n} ${s}`).join(', ')} voucher(s) in this file are kept and counted, but they are never written to a Zoho file and are left out of the checks.`);
      const noFile = datasets.filter(d => NOT_TRANSFERRED_YET[d.key]);
      if (noFile.length) messages.push(`Read and kept; no Zoho file is created for these yet: ${noFile.map(d => `${slotByKey[d.key].name} (${d.records})`).join(', ')}.`);
      const moneyDs = datasets.filter(d => MONEY_SLOTS.includes(d.key) && d.records);
      if (moneyDs.length) {
        messages.push(`${moneyDs.map(d => `${slotByKey[d.key].name} (${d.records})`).join(', ')}: contra vouchers, and payments, receipts and notes that are not with a vendor or customer, are written as Manual Journals. `
          + 'Payments to vendors, receipts from customers, debit notes to vendors and credit notes to customers are written as Manual Journals too, on Accounts Receivable or Accounts Payable with the contact, so every voucher is in a file. The list credits_to_apply.csv says which invoice or bill each one pays.');
      }
      if (Object.keys(split.notUsed).length) messages.push(`${Object.entries(split.notUsed).map(([t, n]) => `${n} ${t}`).join(', ')} record(s) in this file are not vouchers and were not used.`);
      if (!resort) fs.renameSync(sourcePath, original);
      db.prepare('INSERT OR REPLACE INTO transaction_bundles (job_id, file_name, size, sha256, encoding, records, vouchers, voucher_types, datasets, not_used, auto_waived, statuses, messages, uploaded_at, path, actor, masters_sha, not_placed) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(job.id, fileName, size, sha, split.encoding, split.records, split.vouchers, JSON.stringify(split.voucherTypes),
          JSON.stringify(split.split), JSON.stringify(split.notUsed), JSON.stringify(autoWaived), JSON.stringify(statuses), JSON.stringify(messages), at, original, actor, mastersSha, JSON.stringify(notPlaced));
      setStatus(job.id, 'awaiting_uploads');
    });
    cleanUp();
    const expected = Object.fromEntries(db.prepare('SELECT slot, expected FROM expected_counts WHERE job_id = ?').all(job.id).map(e => [e.slot, e.expected]));
    return { ok: true, datasets, autoWaived, split, notPlaced, result: {
      slot: ALL_TRANSACTIONS, fileName, sha256: sha, size, records: split.records, vouchers: split.vouchers, recordTypes: split.recordTypes,
      encoding: split.encoding, encodingName: ENCODING_NAMES[split.encoding],
      datasets: datasets.map(d => {
        const part = parts[d.key], exp = expected[d.key] ?? null;
        return { slot: d.key, name: slotByKey[d.key].name, records: d.records, voucherTypes: part.voucherTypes.map(t => ({ type: t.type, vouchers: t.vouchers, base: t.base, how: t.how })),
          noZohoFile: NOT_TRANSFERRED_YET[d.key] ?? null, statuses: part.statuses,
          warnings: part.warnings, fieldsNotRead: part.fieldsNotRead, keyFields: part.keyFields, mayNotBeReadable: part.keyFields.mayNotBeReadable,
          expectedCount: exp, actualCount: d.records, countMatches: exp === null ? null : exp === d.records };
      }),
      voucherTypes: split.voucherTypes, statuses,
      notUsed: Object.entries(split.notUsed).map(([type, records]) => ({ type, records })),
      autoNotApplicable: autoWaived.map(k => ({ slot: k, name: slotByKey[k].name })),
      messages,
      warnings: [...new Set([...(cw ? [cw] : []), ...datasets.flatMap(d => parts[d.key].warnings)])],
    } };
  };

  const uploadAllTransactions = async (req, reply, job, actor) => {
    const fileName = path.basename(decodeURIComponent(String(req.headers['x-filename'] || 'all_transactions.json')));
    const r = await applyAllTransactions({ job, sourcePath: req.body.tempPath, fileName, sha: req.body.sha256, size: req.body.size, actor });
    if (!r.ok) {
      if (r.code === 422) audit(job.id, 'upload_rejected', `All Transactions: ${fileName}: ${r.error}`, actor);
      return reply.code(r.code).send({ error: r.error });
    }
    markStale(job.id, `A new All Transactions file was uploaded (${r.datasets.map(d => slotByKey[d.key].name).join(', ')}).`, null, null, actor);
    audit(job.id, 'upload_all_transactions', `${fileName}, ${r.split.vouchers} vouchers (${ENCODING_NAMES[r.split.encoding]}), sha256 ${req.body.sha256.slice(0, 12)}: `
      + r.datasets.map(d => `${slotByKey[d.key].name} ${d.records}`).join(', ')
      + (r.autoWaived.length ? `; no vouchers, marked not applicable automatically: ${r.autoWaived.map(k => slotByKey[k].name).join(', ')}` : ''), actor);
    return r.result;
  };

  // Sorts the kept All Transactions file again, when the Voucher Type records it was sorted with have changed and it
  // has voucher types of the company's own (or types that could not be traced). Returns a message, or null.
  const resortTransactions = async (job, actor, why) => {
    const b = db.prepare('SELECT * FROM transaction_bundles WHERE job_id = ?').get(job.id);
    if (!b || !b.path || !fs.existsSync(b.path)) return null;
    if (!JSON.parse(b.voucher_types || '[]').some(t => t.how === 'master' || t.how === 'unresolved')) return null;
    const r = await applyAllTransactions({ job, sourcePath: b.path, fileName: b.file_name, sha: b.sha256, size: b.size, actor, resort: true });
    if (!r.ok) return `The All Transactions file "${b.file_name}" could not be sorted again (${r.error}). Upload it again.`;
    // vouchers the new sorting could not place, because their dataset is held by a file uploaded on its own or was removed
    const lost = Object.entries(r.notPlaced).filter(([, n]) => n.vouchers > 0).map(([slot, n]) => notPlacedMessage({ slot, name: slotByKey[slot].name, ...n }));
    const lostCount = Object.values(r.notPlaced).reduce((t, n) => t + n.vouchers, 0);
    audit(job.id, 'all_transactions_sorted_again', `${b.file_name}: sorted again because ${why}: ${r.datasets.map(d => `${slotByKey[d.key].name} ${d.records}`).join(', ')}`
      + (lostCount ? `; ${lostCount} voucher(s) are in no dataset: ${lost.join(' ')}` : ''), actor);
    return `The All Transactions file "${b.file_name}" was sorted again, because ${why}: ${r.datasets.map(d => `${slotByKey[d.key].name} ${d.records}`).join(', ')}.${lost.length ? ` ${lost.join(' ')}` : ''}`;
  };

  // Voucher files uploaded on their own are checked again when the Voucher Type records change (an All Masters file
  // was uploaded or removed): a file accepted because the company's own voucher type was placed under the dataset's
  // type may no longer fit, and the reverse. The file is never removed or changed: what was found is kept with the
  // upload as a warning (and returned as messages), and a voucher that is now held in two datasets is flagged when the
  // data is processed.
  const TYPES_CHANGED = 'Voucher types changed: ';
  const recheckOwnVoucherFiles = async (job, actor, why) => {
    const messages = [];
    const voucherTypes = voucherTypesOf(job.id);
    for (const u of db.prepare("SELECT * FROM uploads WHERE job_id = ? AND COALESCE(bundle_kind, '') <> 'transactions'").all(job.id)) {
      const slot = slotByKey[u.slot];
      if (slot?.expects !== 'Voucher' || !fs.existsSync(u.path)) continue;
      const v = await validateUploadFile(slot, u.path, job, { voucherTypes });
      const old = JSON.parse(u.warnings || '[]');
      const kept = old.filter(w => !w.startsWith(TYPES_CHANGED) && !/were read as .* vouchers, because the Voucher Type records/.test(w));
      const fresh = v.ok ? v.warnings.filter(w => /were read as .* vouchers, because the Voucher Type records/.test(w))
        : [`${TYPES_CHANGED}since ${why}, the file "${u.file_name}" no longer fits ${slot.name}. ${v.error} The file was kept as it is and its vouchers are still read as ${slot.name}. `
          + 'Check it: upload the All Masters file with the Voucher Type records again, upload the right file for this dataset, or remove this file.'];
      const next = [...fresh, ...kept];
      if (JSON.stringify(next) === JSON.stringify(old)) continue;
      // the upload may have been replaced or removed while the file was being read: only the same file is updated
      db.prepare('UPDATE uploads SET warnings = ? WHERE job_id = ? AND slot = ? AND sha256 = ?').run(JSON.stringify(next), job.id, u.slot, u.sha256);
      if (!v.ok) { messages.push(fresh[0]); audit(job.id, 'upload_no_longer_fits', `${slot.name}: ${fresh[0]}`, actor); }
    }
    return messages;
  };

  // ----- a Tally Trial Balance report in the Trial Balance slot -----
  // The report export has no "tallymessage" list (see trialbalance.js). It is flattened into ordinary Trial Balance
  // line records, stored as the dataset's file; the report as uploaded is kept beside it, with its checksum.
  // The body of the report when the file is one, else null (the file is then checked as a file of Trial Balance lines).
  const trialBalanceReportBody = filePath => {
    let body = null;
    try {
      let hasList = false;
      for (const ev of readTallyFile(filePath)) {
        if (ev.type === 'envelope' && String(ev.key).toLowerCase() === 'dspaccbody') body = reportBody({ dspaccbody: ev.value });
        else if (ev.type === 'end') hasList = ev.hasList;
      }
      if (hasList || !body) return null;
    } catch { return null; }
    // The report is read once more with every amount kept as the digits written in the file (parseReportText), so no
    // figure passes through a binary number. If that reading is not possible, the body read above is used: its
    // amounts are plain numbers, and one too large to hold every paisa is noted on its line.
    try { return reportBody(parseReportText(decodeText(fs.readFileSync(filePath)))) || body; } catch { return body; }
  };
  // The ledgers and groups of the master files uploaded so far (read from the files: nothing is processed yet).
  const uploadedMasters = async jobId => {
    const records = [];
    let n = 0;
    for (const u of db.prepare("SELECT path FROM uploads WHERE job_id = ? AND slot IN ('customers','vendors','accounts','taxes')").all(jobId)) {
      try {
        for (const ev of readTallyFile(u.path)) {
          if (ev.type !== 'record') continue;
          const type = entryType(ev.value);
          if (type === 'Ledger' || type === 'Group') records.push({ type, data: { metadata: ev.value.metadata, name: ev.value.name, parent: ev.value.parent, languagename: ev.value.languagename } });
          if (++n % VALIDATE_BATCH === 0) await pause();
        }
      } catch { /* an unreadable master file is reported when the data is processed */ }
    }
    return masterIndex(records);
  };
  const uploadTrialBalanceReport = async (req, reply, job, actor, slot, fileName, body) => {
    const reject = error => { audit(job.id, 'upload_rejected', `${slot.name}: ${fileName}: ${error}`, actor); return reply.code(422).send({ error }); };
    const flat = flattenTrialBalance(body);
    if (!flat.lines.length) return reject('This Trial Balance report has no lines ("dspaccline"). Export the Trial Balance from Tally again.');
    const converted = path.join(TMP_DIR, `tb-${Date.now().toString(36)}-${randomBytes(6).toString('hex')}.json`);
    fs.writeFileSync(converted, `{"tallymessage":[\n${flat.lines.map(l => JSON.stringify(l)).join(',\n')}\n]}\n`);
    const drop = () => { try { fs.rmSync(converted, { force: true }); } catch { /* removed at the next start */ } };
    const result = await validateUploadFile(slot, converted, job);
    if (!result.ok) { drop(); return reject(result.error); }
    const analysis = analyseTrialBalance({ lines: flat.lines, ...(await uploadedMasters(job.id)) });
    if (!getJob(job.id)) { drop(); return reply.code(404).send({ error: 'Migration not found.' }); }
    if (activeRuns.has(job.id)) { drop(); return reply.code(409).send({ error: PROCESSING_BUSY }); }
    const encoding = (() => { for (const ev of readTallyFile(req.body.tempPath)) if (ev.type === 'end') return ev.encoding || 'utf8'; return 'utf8'; })();
    const description = describeTrialBalance(analysis.summary);
    const trialBalance = { ...analysis.summary, description, encoding, encodingName: ENCODING_NAMES[encoding],
      note: 'This is how the report compared with the master files in place when it was uploaded. It is matched again, and checked against the vouchers, when the data is processed.' };
    result.warnings.unshift(description);
    if (!analysis.summary.totals.openingBalanced || !analysis.summary.totals.closingBalanced) result.warnings.push('The debit and credit balances of this Trial Balance do not add up to the same total. It is flagged with the figures when the data is processed.');
    // the fields of the report itself that are not read (the converted records hold only what is read)
    const unreadFields = Object.entries(flat.unread).map(([name, records]) => ({ name, records })).sort((a, b) => b.records - a.records || a.name.localeCompare(b.name));
    result.fieldsNotRead = { count: unreadFields.length, fields: unreadFields.slice(0, 50), truncated: unreadFields.length > 50 };
    const dir = path.join(DATA_DIR, 'uploads', job.id);
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, `${slot.key}.json`), original = path.join(dir, `${slot.key}.original`);
    fs.renameSync(converted, p);
    fs.renameSync(req.body.tempPath, original); // the report exactly as uploaded
    const sha = req.body.sha256;
    db.prepare('INSERT OR REPLACE INTO uploads (job_id, slot, file_name, size, sha256, records, warnings, uploaded_at, path, main_records, record_types, unread_fields, key_fields, extra) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(job.id, slot.key, fileName, req.body.size, sha, result.records, JSON.stringify(result.warnings), now(), p,
        result.mainRecords, JSON.stringify(result.recordTypes), JSON.stringify(result.fieldsNotRead), JSON.stringify(result.keyFields), JSON.stringify({ trialBalance }));
    db.prepare('DELETE FROM waivers WHERE job_id = ? AND slot = ?').run(job.id, slot.key);
    setStatus(job.id, 'awaiting_uploads');
    markStale(job.id, `A new file was uploaded for ${slot.name}.`, null, null, actor);
    const s = analysis.summary;
    audit(job.id, 'upload', `${slot.name}: ${fileName}, Tally Trial Balance report (${ENCODING_NAMES[encoding]}), ${s.lines} lines, `
      + (s.mastersAvailable ? `${s.ledgers} ledgers, ${s.groups} groups, ${s.unmatched} not matched; ${s.atLedgerLevel ? 'at ledger level' : 'NOT at ledger level'}` : 'not matched yet (no masters uploaded)')
      + `, sha256 ${sha.slice(0, 12)}`, actor);
    const expected = db.prepare('SELECT expected FROM expected_counts WHERE job_id = ? AND slot = ?').get(job.id, slot.key)?.expected ?? null;
    return { slot: slot.key, fileName, records: result.records, recordTypes: result.recordTypes, sha256: sha, warnings: result.warnings, fieldsNotRead: result.fieldsNotRead,
      keyFields: result.keyFields, mayNotBeReadable: result.keyFields.mayNotBeReadable, trialBalance,
      expectedCount: expected, actualCount: result.mainRecords, countMatches: expected === null ? null : expected === result.mainRecords };
  };

  app.put('/api/migrations/:id/uploads/:slot', async (req, reply) => {
    const actor = req.user?.email || 'anonymous';
    const job = need(req, reply); if (!job) return reply;
    if (req.params.slot === ALL_MASTERS || req.params.slot === ALL_TRANSACTIONS) {
      if (!req.body?.tempPath || !req.body.size) return reply.code(400).send({ error: 'No file received.' });
      if (activeRuns.has(job.id)) return reply.code(409).send({ error: PROCESSING_BUSY });
      return req.params.slot === ALL_MASTERS ? uploadAllMasters(req, reply, job, actor) : uploadAllTransactions(req, reply, job, actor);
    }
    const slot = slotByKey[req.params.slot];
    if (!slot) return reply.code(404).send({ error: 'Unknown upload slot.' });
    if (!req.body?.tempPath || !req.body.size) return reply.code(400).send({ error: 'No file received.' });
    if (activeRuns.has(job.id)) return reply.code(409).send({ error: PROCESSING_BUSY });
    const fileName = path.basename(decodeURIComponent(String(req.headers['x-filename'] || `${slot.key}.json`)));
    if (slot.key === 'trial_balance') {
      const body = trialBalanceReportBody(req.body.tempPath);
      if (body) return uploadTrialBalanceReport(req, reply, job, actor, slot, fileName, body);
    }
    const result = await validateUploadFile(slot, req.body.tempPath, job, slot.expects === 'Voucher' ? { voucherTypes: voucherTypesOf(job.id) } : {});
    if (!result.ok) { audit(job.id, 'upload_rejected', `${slot.name}: ${fileName}: ${result.error}`, actor); return reply.code(422).send({ error: result.error }); }
    if (!getJob(job.id)) return reply.code(404).send({ error: 'Migration not found.' });
    if (activeRuns.has(job.id)) return reply.code(409).send({ error: PROCESSING_BUSY }); // processing started while the file was being checked
    const dir = path.join(DATA_DIR, 'uploads', job.id);
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, `${slot.key}.json`);
    // This file replaces records that came from the All Masters file: said in the result and kept with the upload.
    const before = db.prepare('SELECT file_name, bundle_sha, bundle_kind FROM uploads WHERE job_id = ? AND slot = ?').get(job.id, slot.key);
    const replacedAllMasters = before?.bundle_sha && before.bundle_kind !== 'transactions' ? before.file_name : null;
    const replacedAllTransactions = before?.bundle_sha && before.bundle_kind === 'transactions' ? before.file_name : null;
    if (replacedAllMasters) result.warnings.unshift(`This file replaces the ${slot.name} records that came from the All Masters file "${replacedAllMasters}". The other datasets from that file are not changed.`);
    if (replacedAllTransactions) result.warnings.unshift(`This file replaces the ${slot.name} that came from the All Transactions file "${replacedAllTransactions}". The other datasets from that file are not changed.`);
    fs.renameSync(req.body.tempPath, p); // the temporary file becomes the stored upload; nothing is copied through memory
    if (slot.key === 'trial_balance') fs.rmSync(path.join(dir, `${slot.key}.original`), { force: true }); // a Tally report kept by an earlier upload
    const sha = req.body.sha256;
    db.prepare('INSERT OR REPLACE INTO uploads (job_id, slot, file_name, size, sha256, records, warnings, uploaded_at, path, main_records, record_types, unread_fields, key_fields) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(job.id, slot.key, fileName, req.body.size, sha, result.records, JSON.stringify(result.warnings), now(), p,
        result.mainRecords, JSON.stringify(result.recordTypes), JSON.stringify(result.fieldsNotRead), JSON.stringify(result.keyFields));
    setFileCompany(job.id, slot.key, result.company);
    db.prepare('DELETE FROM waivers WHERE job_id = ? AND slot = ?').run(job.id, slot.key);
    setStatus(job.id, 'awaiting_uploads'); // any new upload means processing must be run again
    markStale(job.id, `A new file was uploaded for ${slot.name}.`, null, null, actor);
    audit(job.id, 'upload', `${slot.name}: ${fileName}, ${result.records} records, sha256 ${sha.slice(0, 12)}, ${result.fieldsNotRead.count} field(s) not read`
      + (result.keyFields.mayNotBeReadable ? '; the file may not be readable (every field the platform needs is missing)' : result.keyFields.warnings.length ? `; ${result.keyFields.warnings.length} field(s) the platform needs are missing from every record` : '')
      + (replacedAllMasters ? `; replaces the records from the All Masters file "${replacedAllMasters}"` : '')
      + (replacedAllTransactions ? `; replaces the vouchers from the All Transactions file "${replacedAllTransactions}"` : ''), actor);
    const expected = db.prepare('SELECT expected FROM expected_counts WHERE job_id = ? AND slot = ?').get(job.id, slot.key)?.expected ?? null;
    return { slot: slot.key, fileName, records: result.records, recordTypes: result.recordTypes, sha256: sha, warnings: result.warnings, fieldsNotRead: result.fieldsNotRead,
      keyFields: result.keyFields, mayNotBeReadable: result.keyFields.mayNotBeReadable,
      expectedCount: expected, actualCount: result.mainRecords, countMatches: expected === null ? null : expected === result.mainRecords,
      ...(replacedAllMasters ? { replacedAllMasters } : {}), ...(replacedAllTransactions ? { replacedAllTransactions } : {}),
      ...(result.voucherTypes ? { voucherTypes: result.voucherTypes, statuses: result.statuses } : {}),
      ...(NOT_TRANSFERRED_YET[slot.key] ? { noZohoFile: NOT_TRANSFERRED_YET[slot.key] } : {}) };
  });

  // The number of records Tally shows for a dataset, entered by the user. Send { expected: null } to clear it.
  app.put('/api/migrations/:id/expected-counts/:slot', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const slot = slotByKey[req.params.slot];
    if (!slot) return reply.code(404).send({ error: 'Unknown upload slot.' });
    const raw = req.body?.expected;
    const before = db.prepare('SELECT expected FROM expected_counts WHERE job_id = ? AND slot = ?').get(job.id, slot.key)?.expected ?? null;
    if (raw === null || raw === undefined || String(raw).trim() === '') {
      db.prepare('DELETE FROM expected_counts WHERE job_id = ? AND slot = ?').run(job.id, slot.key);
      if (before !== null) audit(job.id, 'expected_count_cleared', `${slot.name}: was ${before}`);
    } else {
      // Whole numbers of up to 9 digits only: longer input cannot be stored exactly and is never a real record count.
      // A number sent as a JSON number must also be exact (not already rounded by the sender).
      if (!/^\d{1,9}$/.test(String(raw).trim()) || (typeof raw === 'number' && !Number.isSafeInteger(raw))) {
        return reply.code(400).send({ error: 'Enter the number of records Tally shows as a whole number of up to 9 digits, for example 42.' });
      }
      const expected = Number(String(raw).trim());
      db.prepare('INSERT OR REPLACE INTO expected_counts VALUES (?,?,?,?,?)').run(job.id, slot.key, expected, currentActor, now());
      audit(job.id, 'expected_count_set', `${slot.name}: Tally shows ${expected}${before !== null && before !== expected ? ` (was ${before})` : ''}`);
    }
    const s = completeness(job.id).slots.find(x => x.key === slot.key);
    return { slot: slot.key, expectedCount: s.expectedCount, actualCount: s.actualCount, countMatches: s.countMatches };
  });

  app.delete('/api/migrations/:id/uploads/:slot', async (req, reply) => {
    const actor = req.user?.email || 'anonymous';
    const job = need(req, reply); if (!job) return reply;
    if (activeRuns.has(job.id)) return reply.code(409).send({ error: PROCESSING_BUSY });
    if (req.params.slot === ALL_TRANSACTIONS) {
      // Removes the All Transactions file, every dataset that still comes from it, and its automatic "not applicable"
      // marks (so Sales, Purchase, Receipt, Payment and Journal are required again). Datasets replaced later by a file
      // uploaded on their own are kept.
      const b = db.prepare('SELECT * FROM transaction_bundles WHERE job_id = ?').get(job.id);
      if (!b) return { ok: true };
      const removed = [];
      tx(() => {
        for (const u of db.prepare("SELECT * FROM uploads WHERE job_id = ? AND bundle_sha = ? AND bundle_kind = 'transactions'").all(job.id, b.sha256)) {
          fs.rmSync(u.path, { force: true });
          db.prepare('DELETE FROM uploads WHERE job_id = ? AND slot = ?').run(job.id, u.slot);
          removed.push(slotByKey[u.slot]?.name ?? u.slot);
        }
        // every mark that rests on this file (known by its reason), also one put back after a file of its own was removed
        db.prepare('DELETE FROM waivers WHERE job_id = ? AND substr(reason, 1, ?) = ?').run(job.id, TRANSACTIONS_WAIVER_START.length, TRANSACTIONS_WAIVER_START);
        db.prepare('DELETE FROM transaction_bundles WHERE job_id = ?').run(job.id);
        setStatus(job.id, 'awaiting_uploads');
      });
      if (b.path) fs.rmSync(b.path, { force: true });
      markStale(job.id, `The All Transactions file "${b.file_name}" was removed.`);
      audit(job.id, 'upload_removed', `All Transactions: ${b.file_name}${removed.length ? ` (removed with it: ${removed.join(', ')})` : ''}`);
      return { ok: true, removed };
    }
    if (req.params.slot === ALL_MASTERS) {
      // Removes the All Masters file and every dataset that still comes from it, and its automatic "not applicable" marks.
      // Datasets replaced later by a file uploaded on their own are kept.
      const b = db.prepare('SELECT * FROM master_bundles WHERE job_id = ?').get(job.id);
      if (!b) return { ok: true };
      const removed = [];
      tx(() => {
        for (const u of db.prepare("SELECT * FROM uploads WHERE job_id = ? AND bundle_sha = ? AND COALESCE(bundle_kind, 'masters') <> 'transactions'").all(job.id, b.sha256)) {
          fs.rmSync(u.path, { force: true });
          db.prepare('DELETE FROM uploads WHERE job_id = ? AND slot = ?').run(job.id, u.slot);
          removed.push(slotByKey[u.slot]?.name ?? u.slot);
        }
        for (const key of JSON.parse(b.auto_waived || '[]')) db.prepare('DELETE FROM waivers WHERE job_id = ? AND slot = ? AND reason LIKE ?').run(job.id, key, `${AUTO_WAIVER_PREFIX}%`);
        db.prepare('DELETE FROM master_bundles WHERE job_id = ?').run(job.id);
        setStatus(job.id, 'awaiting_uploads');
      });
      if (b.path) fs.rmSync(b.path, { force: true });
      markStale(job.id, `The All Masters file "${b.file_name}" was removed.`);
      audit(job.id, 'upload_removed', `All Masters: ${b.file_name}${removed.length ? ` (removed with it: ${removed.join(', ')})` : ''}`, actor);
      // without its Voucher Type records, vouchers of the company's own voucher types can no longer be traced
      const resorted = await resortTransactions(job, actor, `the All Masters file "${b.file_name}" was removed`);
      const messages = [...(resorted ? [resorted] : []), ...await recheckOwnVoucherFiles(job, actor, `the All Masters file "${b.file_name}" was removed`)];
      return { ok: true, removed, ...(messages.length ? { messages } : {}) };
    }
    const u = db.prepare('SELECT * FROM uploads WHERE job_id = ? AND slot = ?').get(job.id, req.params.slot);
    if (u) { fs.rmSync(u.path, { force: true }); db.prepare('DELETE FROM uploads WHERE job_id = ? AND slot = ?').run(job.id, req.params.slot); setStatus(job.id, 'awaiting_uploads');
      if (u.slot === 'trial_balance') fs.rmSync(path.join(path.dirname(u.path), 'trial_balance.original'), { force: true }); // the Tally report as uploaded
      markStale(job.id, `The uploaded file for ${slotByKey[u.slot]?.name ?? u.slot} was removed.`); audit(job.id, 'upload_removed', u.file_name);
      // A voucher dataset whose own file is removed while the All Transactions file in place has no vouchers of that
      // type: that file is still the evidence that there are none, so the automatic mark is put back (otherwise a
      // required dataset would block processing with no way to mark it).
      const reason = transactionsEmptyReason(u.slot, db.prepare('SELECT file_name, datasets FROM transaction_bundles WHERE job_id = ?').get(job.id));
      if (reason) {
        db.prepare('INSERT OR REPLACE INTO waivers VALUES (?,?,?,?)').run(job.id, u.slot, reason, now());
        audit(job.id, 'marked_not_applicable', `${slotByKey[u.slot].name}: ${reason}`);
        return { ok: true, autoNotApplicable: true, message: `${slotByKey[u.slot].name} was marked not applicable again automatically. ${reason.slice(AUTO_WAIVER_PREFIX.length).replace(/^t/, 'T')}` };
      }
    }
    return { ok: true };
  });

  // The default business type follows the Stock Summary mark (decisions.js defaultBusinessType). When marking or
  // unmarking a dataset changes the business type the Items file is built with, that file is out of date (audited).
  const businessTypeFollows = (jobId, before) => {
    const after = businessTypeOf(db, jobId);
    if (after.value === before) return;
    audit(jobId, 'business_type_changed', `Business type (default): ${before} -> ${after.value}. ${after.defaultReason}`);
    markStale(jobId, `The business type is now ${after.value} (${after.defaultReason}), so the Product Type of the items changes.`, ['items']);
  };
  // Mark a conditional dataset as not applicable (or undo it). A REQUIRED voucher dataset can be marked only while the
  // All Transactions file in place has no vouchers of its type (the mark the upload made, undone by the user): the
  // reason is then the file's, not the user's. In every other case a required dataset cannot be marked.
  app.put('/api/migrations/:id/waivers/:slot', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const slot = slotByKey[req.params.slot];
    if (!slot) return reply.code(404).send({ error: 'Unknown upload slot.' });
    if (slot.requirement === 'optional') return reply.code(400).send({ error: `${slot.name} is optional: it never blocks processing, so it does not need to be marked not applicable.` });
    if (slot.requirement !== 'conditional') {
      const auto = transactionsEmptyReason(slot.key, db.prepare('SELECT file_name, datasets FROM transaction_bundles WHERE job_id = ?').get(job.id))
        || mastersEmptyReason(slot.key, db.prepare('SELECT file_name, datasets FROM master_bundles WHERE job_id = ?').get(job.id));
      if (!auto) return reply.code(400).send({ error: `${slot.name} is required and cannot be marked not applicable.` });
      if (db.prepare('SELECT 1 FROM uploads WHERE job_id = ? AND slot = ?').get(job.id, slot.key)) return reply.code(400).send({ error: `${slot.name} has an uploaded file, so it cannot be marked not applicable. Remove the file first.` });
      db.prepare('INSERT OR REPLACE INTO waivers VALUES (?,?,?,?)').run(job.id, slot.key, auto, now());
      audit(job.id, 'marked_not_applicable', `${slot.name}: ${auto}`);
      return { ok: true, reason: auto };
    }
    const reason = String(req.body?.reason || '').trim();
    if (!reason) return reply.code(400).send({ error: 'A reason is required.' });
    const business = businessTypeOf(db, job.id).value;
    db.prepare('INSERT OR REPLACE INTO waivers VALUES (?,?,?,?)').run(job.id, slot.key, reason, now());
    audit(job.id, 'marked_not_applicable', `${slot.name}: ${reason}`);
    businessTypeFollows(job.id, business);
    return { ok: true };
  });
  app.delete('/api/migrations/:id/waivers/:slot', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const had = db.prepare('SELECT reason FROM waivers WHERE job_id = ? AND slot = ?').get(job.id, req.params.slot);
    const business = businessTypeOf(db, job.id).value;
    db.prepare('DELETE FROM waivers WHERE job_id = ? AND slot = ?').run(job.id, req.params.slot);
    if (had) audit(job.id, 'not_applicable_undone', `${slotByKey[req.params.slot]?.name ?? req.params.slot}: was "${had.reason}"`);
    businessTypeFollows(job.id, business);
    // canMarkAgain: the dataset can be marked not applicable again (see PUT above); false for a required dataset with no such evidence
    const s = completeness(job.id).slots.find(x => x.key === req.params.slot);
    return { ok: true, canMarkAgain: !!s?.canMarkNotApplicable };
  });

  app.get('/api/migrations/:id/completeness', (req, reply) => { const job = need(req, reply); if (!job) return; return completeness(job.id); });

  // Starts processing as a background job and answers at once with the job's state (202), or, when asked to wait,
  // answers when the job has ended with its result (200) or its error (422).
  //   ?wait=0  never wait: the screens use this, then poll GET process-status.
  //   ?wait=1  always wait.
  //   no wait parameter: wait only when the uploaded files are small (SMALL_PROCESS_BYTES in total), as before.
  // If a job is already running for the migration, that job is returned and no second one is started.
  app.post('/api/migrations/:id/process', async (req, reply) => {
    const actor = req.user?.email || 'anonymous';
    const job = need(req, reply); if (!job) return reply;
    const waitParam = String(req.query.wait ?? '').toLowerCase();
    const shouldWait = () => (['1', 'true'].includes(waitParam) ? true : ['0', 'false'].includes(waitParam) ? false
      : db.prepare('SELECT COALESCE(SUM(size), 0) n FROM uploads WHERE job_id = ?').get(job.id).n <= SMALL_PROCESS_BYTES);
    const answer = async (run, alreadyRunning) => {
      if (!shouldWait()) return reply.code(202).send({ job: processStatus(job.id), alreadyRunning });
      await run.promise;
      if (run.state === 'failed') return reply.code(422).send({ error: run.error, job: processStatus(job.id), alreadyRunning });
      return { ...run.result, job: processStatus(job.id), alreadyRunning }; // { summary, crossChecks, job, alreadyRunning }
    };
    if (activeRuns.has(job.id)) return answer(activeRuns.get(job.id), true);
    const c = completeness(job.id);
    if (c.missingRequired.length || c.awaitingConfirmation.length) {
      return reply.code(409).send({ error: 'Processing is blocked until all required datasets are uploaded and conditional ones are confirmed.', missingRequired: c.missingRequired, awaitingConfirmation: c.awaitingConfirmation, countMismatches: c.countMismatches });
    }
    if (c.countMismatches.length) {
      return reply.code(409).send({ error: `Processing is blocked because the record count does not match what Tally shows. ${c.countMismatches.map(m => m.message).join(' ')}`,
        missingRequired: [], awaitingConfirmation: [], countMismatches: c.countMismatches });
    }
    return answer(startProcessing(job, actor), false);
  });

  // Progress of the processing job: poll this while state is 'queued' or 'running'.
  app.get('/api/migrations/:id/process-status', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    return { ...processStatus(job.id), migrationStatus: getJob(job.id).status };
  });

  app.get('/api/migrations/:id/summary', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    // warning: a flag about a name passed as in Tally (pick and drop), never a blocker
    const exceptions = db.prepare('SELECT * FROM exceptions WHERE job_id = ? ORDER BY id').all(job.id).map(e => ({ ...e, slotName: slotByKey[e.slot]?.name, warning: NAME_WARNING_KINDS.has(e.kind) }));
    const warnings = exceptions.filter(e => e.warning).length;
    return {
      status: job.status,
      bySlot: db.prepare('SELECT slot, object_type type, COUNT(*) n FROM source_records WHERE job_id = ? GROUP BY slot, object_type').all(job.id)
        .map(r => ({ ...r, name: slotByKey[r.slot]?.name })),
      exceptions,
      // one number for "flagged items" on every screen (Dashboard, Validation Center, Processing Status, Reports):
      // flagged = every flagged item stored; warnings = names passed as in Tally; toCheck = the rest.
      // byStage: the same items per stage (process = while reading the data).
      counts: { flagged: exceptions.length, warnings, toCheck: exceptions.length - warnings,
        byStage: exceptions.reduce((o, e) => { const k = e.stage || 'other'; o[k] = (o[k] || 0) + 1; return o; }, {}) },
    };
  });

  app.get('/api/migrations/:id/records', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    // Optional filters: slot, and type (for example type=Ledger to leave out Group records in the Chart of Accounts).
    const where = ['job_id = ?'], args = [job.id];
    if (req.query.slot) { where.push('slot = ?'); args.push(String(req.query.slot)); }
    if (req.query.type) { where.push('object_type = ?'); args.push(String(req.query.type)); }
    const rows = db.prepare(`SELECT * FROM source_records WHERE ${where.join(' AND ')} ORDER BY id LIMIT ?`).all(...args, limit);
    const total = db.prepare(`SELECT COUNT(*) n FROM source_records WHERE ${where.join(' AND ')}`).get(...args).n;
    // view: the values the platform reads from the record, the same way the Zoho files are built (name from metadata.name,
    // contact details from the latest dated mailing and GST details, and so on). data: the record exactly as in Tally.
    const asOf = (jobYear(job)?.to || '').replace(/-/g, '') || null;
    const view = (type, d) => {
      if (type === 'Ledger') {
        const c = contactInfo(d, asOf);
        // the Zoho codes the Customers and Vendors files carry for this ledger ('' when not certain, and flagged)
        const treatment = gstTreatment(c).value;
        return { name: c.name, parent: recordParent(d), gstin: c.gstin, state: c.state, openingBalance: c.openingBalance,
          mailingName: c.mailingName, address: c.address, pincode: c.pincode, country: c.country, pan: c.pan, registrationType: c.registrationType, placeOfSupply: c.placeOfSupply,
          zohoGstTreatment: treatment, zohoStateCode: placeOfContact(c, treatment).value, email: c.email, phone: c.phone, mobile: c.mobile, legacy: c.legacy };
      }
      if (type === 'StockItem') { const i = itemInfo(d, asOf); return { name: i.name, parent: i.parent, unit: i.unit, hsn: i.hsn, hsnSource: i.hsnSource, openingQuantity: i.openingQuantity, openingValue: i.openingValue }; }
      if (type === 'Voucher') {
        // The lines as the platform reads them: from "allledgerentries" or "ledgerentries", and the item lines.
        const lines = voucherLines(d).map(l => ({ ledger: l.ledger, item: l.item || '', qty: l.qty || '', rate: l.rate || '', amount: l.amount ? l.amount.toFixed(2) : '' }));
        const total = voucherLines(d).reduce((t, l) => (l.amount?.isNegative() ? t.plus(l.amount.abs()) : t), money(0));
        return { voucherType: entryVchType(d), notPosted: voucherStatus(d), linesFrom: ledgerEntryList(d).used, lines, total: total.toFixed(2) };
      }
      return { name: recordName(d), parent: recordParent(d) };
    };
    return { total, records: rows.map(r => { const data = JSON.parse(r.data); return { id: r.id, slot: r.slot, type: r.object_type, sourceId: r.source_id, name: r.name, view: view(r.object_type, data), data }; }) };
  });

  // The Trial Balance as it was read, matched and checked by the last processing run.
  //   shape 'report': a Tally Trial Balance report. lines: every line in the order of the report, with its depth, the
  //     four figures (opening and closing in Tally's sign: debit negative), what it was matched to, the movement worked
  //     out from the stored vouchers and whether the checks agree. summary: see analyseTrialBalance in trialbalance.js.
  //   shape 'lines': a file of Trial Balance lines (name and closing balance): shown from the stored records.
  //   shape null: no Trial Balance was processed.
  app.get('/api/migrations/:id/trial-balance', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const s = db.prepare('SELECT data FROM trial_balance_summary WHERE job_id = ?').get(job.id);
    if (s) {
      return { shape: 'report', summary: JSON.parse(s.data),
        lines: db.prepare('SELECT source_record_id id, data FROM trial_balance_lines WHERE job_id = ? ORDER BY line_no').all(job.id).map(l => ({ id: l.id, ...JSON.parse(l.data) })) };
    }
    const n = db.prepare("SELECT COUNT(*) n FROM source_records WHERE job_id = ? AND slot = 'trial_balance'").get(job.id).n;
    return { shape: n ? 'lines' : null, summary: null, lines: [] };
  });

  app.get('/api/migrations/:id/journals', (req, reply) => { const job = need(req, reply); if (!job) return; return listJournals(job.id); });

  // The file a routing decision writes the voucher to.
  const FILE_OF = { Invoice: 'invoices', Bill: 'bills', 'Manual Journal': 'journals' };
  // Returns the files the decision changes: none when the voucher already had this decision.
  // how: words for the audit when the decision was made for many journals at once (for example "selected in the review").
  const decide = (job, j, decision, how = '') => {
    db.prepare('INSERT OR REPLACE INTO journal_decisions VALUES (?,?,?,?,?,?)').run(job.id, j.id, decision, j.suggested, currentActor, now());
    audit(job.id, 'journal_routed', `${j.number} -> ${decision}${j.decision && j.decision !== decision ? ` (was ${j.decision})` : ''}${decision === j.suggested ? '' : ` (suggestion was ${j.suggested})`}${how ? `, ${how}` : ''}`);
    // v2: a journal with no decision is already written by default (defaultDecision), so the files change only when
    // the decision differs from what they were built with
    const was = j.decision || j.defaultDecision;
    return was === decision ? [] : [...new Set([FILE_OF[was], FILE_OF[decision]].filter(Boolean))];
  };

  app.put('/api/migrations/:id/journals/:recordId', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const decision = req.body?.decision;
    if (!DECISIONS.includes(decision)) return reply.code(400).send({ error: `Decision must be one of: ${DECISIONS.join(', ')}.` });
    const j = listJournals(job.id).find(x => x.id === Number(req.params.recordId));
    if (!j) return reply.code(404).send({ error: 'Journal voucher not found.' });
    if (j.notPosted) return reply.code(409).send({ error: `This journal voucher is ${j.notPosted} in Tally. It is never written to a Zoho file, so it cannot be routed.` });
    // A journal with the vendor debited is not a bill, and one with the customer credited is not an invoice: written
    // as one it would post the opposite of the Tally entry. The decision is refused, with the reason (listJournals).
    if (j.refused[decision]) {
      return reply.code(409).send({ error: `This journal cannot be routed to ${decision}: ${j.refused[decision]} Route it to Manual Journal, or leave it for the accountant.` });
    }
    decide(job, j, decision);
    journalStale(job, j, j.decision || j.defaultDecision, decision, `Journal voucher ${j.number} was routed to ${decision}${j.decision ? ` (it was ${j.decision})` : ''}.`);
    return { ok: true };
  });

  // ----- corrections of a voucher the export cannot give as it is (round 2, SYN-5; vouchercorrections.js) -----
  // GET: the vouchers whose exported date is not a real day, or whose exported debits and credits differ, with the
  // correction saved (if any) and, for an unbalanced voucher, the amount the tool suggests (never applied by itself).
  const correctable = jobId => {
    ensureCorrectionsTable(db);
    const saved = correctionsOf(db, jobId);
    const tbLines = db.prepare('SELECT data FROM trial_balance_lines WHERE job_id = ?').all(jobId).map(x => JSON.parse(x.data));
    const out = [];
    for (const r of db.prepare("SELECT * FROM source_records WHERE job_id = ? AND object_type = 'Voucher' ORDER BY id").all(jobId)) {
      const v = JSON.parse(r.data);
      const kind = !correctionProblem(v, 'date') ? 'date' : !correctionProblem(v, 'amount') ? 'amount' : null;
      if (!kind) continue;
      const lines = voucherLines(v).map(l => ({ ledger: l.ledger, amount: l.amount == null ? null : l.amount.abs().toFixed(2), side: l.amount?.isNegative() ? 'Debit' : 'Credit' }));
      const bal = voucherBalance(v);
      out.push({ id: r.id, slot: r.slot, number: String(v.vouchernumber ?? ''), exportedDate: String(v.date ?? ''), kind, lines,
        difference: kind === 'amount' && bal.total ? bal.total.abs().toFixed(2) : null,
        suggestion: kind === 'amount' ? suggestAmount(v, tbLines) : null, correction: saved.get(voucherKey(r, v)) || null });
    }
    return out;
  };
  app.get('/api/migrations/:id/voucher-corrections', (req, reply) => { const job = need(req, reply); if (!job) return; return { vouchers: correctable(job.id) }; });
  // PUT: { kind: 'date', date: 'YYYY-MM-DD' } or { kind: 'amount', ledger, exported, amount }: saved after it is checked
  // (a real day; one named line, and the voucher then balances). The files are out of date until created again.
  app.put('/api/migrations/:id/voucher-corrections/:recordId', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const r = db.prepare("SELECT * FROM source_records WHERE job_id = ? AND id = ? AND object_type = 'Voucher'").get(job.id, Number(req.params.recordId));
    if (!r) return reply.code(404).send({ error: 'Voucher not found.' });
    const v = JSON.parse(r.data);
    const checked = validateCorrection(v, req.body || {});
    if (!checked.ok) return reply.code(400).send({ error: checked.error });
    ensureCorrectionsTable(db);
    db.prepare('INSERT OR REPLACE INTO voucher_corrections (job_id, voucher_key, kind, data, decided_by, at) VALUES (?,?,?,?,?,?)').run(job.id, voucherKey(r, v), checked.correction.kind, JSON.stringify(checked.correction), currentActor, now());
    const c = checked.correction;
    const what = c.kind === 'date' ? `date ${c.date} (exported "${c.exported}")` : `${c.amount} on "${c.ledger}" (exported ${c.exported})`;
    audit(job.id, 'voucher_corrected', `Voucher ${v.vouchernumber ?? ''}: ${what}`);
    markStale(job.id, `A correction was entered for voucher ${v.vouchernumber ?? ''}: ${what}.`);
    return { ok: true, correction: c };
  });
  app.delete('/api/migrations/:id/voucher-corrections/:recordId', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const r = db.prepare("SELECT * FROM source_records WHERE job_id = ? AND id = ? AND object_type = 'Voucher'").get(job.id, Number(req.params.recordId));
    if (!r) return reply.code(404).send({ error: 'Voucher not found.' });
    ensureCorrectionsTable(db);
    const v = JSON.parse(r.data);
    const n = db.prepare('DELETE FROM voucher_corrections WHERE job_id = ? AND voucher_key = ?').run(job.id, voucherKey(r, v)).changes;
    if (!n) return reply.code(409).send({ error: 'This voucher has no correction.' });
    audit(job.id, 'voucher_correction_cleared', `Voucher ${v.vouchernumber ?? ''}: correction cleared`);
    markStale(job.id, `The correction of voucher ${v.vouchernumber ?? ''} was cleared.`);
    return { ok: true };
  });

  // One out-of-date reason per journal, and none when the net change is zero: the reason remembers (in its kind) the
  // route the files were built with, so a decision changed and changed back (or cleared back to the same default)
  // leaves the files up to date.
  const journalStale = (job, j, before, after, reason) => {
    const prefix = `journal|${j.id}|`;
    const old = db.prepare('SELECT kind FROM stale_reasons WHERE job_id = ? AND substr(kind, 1, ?) = ?').get(job.id, prefix.length, prefix);
    const built = old ? old.kind.slice(prefix.length) : before;
    db.prepare('DELETE FROM stale_reasons WHERE job_id = ? AND substr(kind, 1, ?) = ?').run(job.id, prefix.length, prefix);
    if (after !== built) markStale(job.id, reason, [...new Set([FILE_OF[built], FILE_OF[after]].filter(Boolean))], `${prefix}${built}`);
  };

  // Clear decision: the journal goes back to the tool's default (v2). Audited with the decision it had; the files change
  // only when the default differs from the decision. Viewers are refused like every change.
  app.delete('/api/migrations/:id/journals/:recordId', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const j = listJournals(job.id).find(x => x.id === Number(req.params.recordId));
    if (!j) return reply.code(404).send({ error: 'Journal voucher not found.' });
    if (!j.decision) return reply.code(409).send({ error: `Journal voucher ${j.number} has no decision of its own: it already uses the default.` });
    db.prepare('DELETE FROM journal_decisions WHERE job_id = ? AND source_record_id = ?').run(job.id, j.id);
    const now2 = listJournals(job.id).find(x => x.id === j.id);
    const fallback = now2?.defaultDecision || 'Manual Journal';
    audit(job.id, 'journal_decision_cleared', `${j.number}: decision ${j.decision} cleared; the default is used again (${fallback})`);
    journalStale(job, j, j.decision, fallback, `The decision on journal voucher ${j.number} (${j.decision}) was cleared; the default (${fallback}) is used again.`);
    return { ok: true, defaultDecision: fallback };
  });

  // ----- the journal review (Voucher Classification; rules in journalreview.js) -----
  // GET .../journals/review?suggestion=&review=clear|needs_check|not_clear&state=all|undecided|decided|not_posted&decision=
  //   &party=customer|vendor|both|none&ledger=&pattern=&q=&min=&max=&from=yyyy-mm-dd&to=&sort=date|number|amount|suggestion|decision
  //   &dir=asc|desc&page=1&pageSize=50
  // Returns one page of journals and, over all journals, the counts, the ledgers used and the patterns.
  app.get('/api/migrations/:id/journals/review', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const p = parseReviewQuery(req.query);
    if (p.error) return reply.code(400).send({ error: p.error });
    const all = listJournals(job.id);
    return { ...reviewPage(all, p.query), query: { ...p.query, min: p.query.min?.toFixed(2) ?? null, max: p.query.max?.toFixed(2) ?? null },
      counts: reviewCounts(all), ledgers: ledgerFacet(all), patterns: patternFacet(all), canChange: req.user?.role !== 'viewer' };
  });

  // A decision for many journals. Both actions work in two steps: without confirmCount (or with preview: true) they only
  // say what would happen; the decision is made only when confirmCount equals the number of journals that would change
  // (otherwise 409 with the current plan: something changed since the preview). Every journal changed is audited one by
  // one (who, the old and the new decision) and once more for the action as a whole.
  const planResponse = (plan, extra = {}) => ({ ...extra, decision: plan.decision, counts: plan.counts, words: planWords(plan),
    refused: plan.refused.slice(0, 20), leftOutAnyway: plan.leftOutAnyway.slice(0, 20), notParty: plan.notParty.slice(0, 20), changeIds: plan.change.map(j => j.id) });
  const applyPlan = (req, reply, job, plan, how, extra) => {
    const preview = req.body?.preview === true || req.body?.confirmCount == null;
    if (preview) return { ...planResponse(plan, extra), applied: false };
    if (Number(req.body.confirmCount) !== plan.counts.change) {
      return reply.code(409).send({ error: `The number of journal vouchers to change is now ${plan.counts.change}, not ${req.body.confirmCount}. Something changed since the preview. Check the new numbers and confirm again.`, ...planResponse(plan, extra) });
    }
    if (!plan.counts.change) return { ...planResponse(plan, extra), applied: true, changed: 0 };
    tx(() => {
      const affected = [...new Set(plan.change.flatMap(j => decide(job, j, plan.decision, how)))];
      audit(job.id, 'journals_bulk_routed', `${plan.counts.change} journal voucher(s) routed to ${plan.decision}, ${how}. ${planWords(plan)}`);
      if (affected.length) markStale(job.id, `${plan.counts.change} journal voucher(s) were routed to ${plan.decision} (${how}).`, affected);
    });
    return { ...planResponse(plan, extra), applied: true, changed: plan.counts.change };
  };

  // { ids: [record id], decision, preview?, confirmCount? }: the journals the user selected. A journal that already has
  // another decision is changed too (the user selected it).
  app.post('/api/migrations/:id/journals/bulk', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const decision = req.body?.decision;
    if (!DECISIONS.includes(decision)) return reply.code(400).send({ error: `Decision must be one of: ${DECISIONS.join(', ')}.` });
    const ids = Array.isArray(req.body?.ids) ? [...new Set(req.body.ids.map(Number))] : null;
    if (!ids || !ids.length) return reply.code(400).send({ error: 'Select at least one journal voucher.' });
    const byId = new Map(listJournals(job.id).map(j => [j.id, j]));
    const missing = ids.filter(id => !byId.has(id));
    if (missing.length) return reply.code(404).send({ error: `${missing.length} of the selected journal vouchers are not in this migration any more. Reload the list and select again.` });
    return applyPlan(req, reply, job, planDecision(ids.map(id => byId.get(id)), decision, { includeDecided: true }), 'selected in the journal review');
  });

  // { recordId, decision, includeDecided?: false, preview?, confirmCount? }: every journal with the same pattern as the
  // journal recordId (the same Tally groups debited and credited). By default only journals without a decision change.
  app.post('/api/migrations/:id/journals/pattern', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const decision = req.body?.decision;
    if (!DECISIONS.includes(decision)) return reply.code(400).send({ error: `Decision must be one of: ${DECISIONS.join(', ')}.` });
    const all = listJournals(job.id);
    const j = all.find(x => x.id === Number(req.body?.recordId));
    if (!j) return reply.code(404).send({ error: 'Journal voucher not found.' });
    const same = all.filter(x => x.pattern.key === j.pattern.key);
    const words = patternWords(j.pattern);
    const plan = planDecision(same, decision, { includeDecided: req.body?.includeDecided === true });
    return applyPlan(req, reply, job, plan, `same pattern as ${j.number} (${words})`, { pattern: { key: j.pattern.key, words, journals: same.length } });
  });

  // Applies the suggestion to journals that have no decision yet. This is an explicit user action, in two named groups:
  //   group 'clear' (the default): only the suggestions the platform itself calls clear and that carry no warning;
  //   group 'needs_check': only the Bills and Invoices whose reason warns that they would carry a negative row (a tax
  //     ledger or another ledger on the party's side). The user asks for these by name, after reading the warning.
  // A suggestion marked "not a clear pattern, please review" is NEVER accepted in bulk: it is decided one by one.
  // Returns { accepted, group, leftForReview: { needsCheck, notClear } }: what still waits for a decision.
  app.post('/api/migrations/:id/journals/accept-suggestions', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const group = req.body?.group ?? 'clear';
    if (!['clear', 'needs_check'].includes(group)) return reply.code(400).send({ error: 'Group must be "clear" or "needs_check".' });
    const open = listJournals(job.id).filter(j => !j.decision && !j.notPosted); // cancelled, optional and deleted journals need no routing
    const pending = open.filter(j => j.clear !== false && (group === 'needs_check' ? j.needsCheck : !j.needsCheck));
    tx(() => {
      const affected = [...new Set(pending.flatMap(j => decide(job, j, j.suggested)))];
      if (affected.length) markStale(job.id, `${pending.length} journal voucher(s) were routed by accepting ${group === 'needs_check' ? 'the suggestions that carry a negative row' : 'the clear suggestions'}.`, affected);
    });
    const left = open.filter(j => !pending.includes(j));
    return { accepted: pending.length, group, leftForReview: { needsCheck: left.filter(j => j.clear !== false && j.needsCheck).length, notClear: left.filter(j => j.clear === false).length } };
  });

  app.post('/api/migrations/:id/generate', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    if (activeRuns.has(job.id) || job.status === 'processing') return reply.code(409).send({ error: PROCESSING_BUSY });
    if (!['processed', 'generated'].includes(job.status)) return reply.code(409).send({ error: 'Process the uploaded data before generating files.' });
    // A count entered (or changed) after processing must not be bypassed: files are not created while it disagrees with the file.
    const mismatches = completeness(job.id).countMismatches;
    if (mismatches.length) {
      return reply.code(409).send({ error: `Files cannot be created because the record count does not match what Tally shows. ${mismatches.map(m => m.message).join(' ')}`, countMismatches: mismatches });
    }
    // files: the files created; vouchers: the control total over every voucher dataset (see generate);
    // assumptions: the defaults applied to these files, per kind (also in the audit log)
    return generate(job);
  });

  // v2: "Assumptions the tool made". Every default applied where no decision was made: { available, assumptions:
  // [{ kind, title, words, count, check, blocking, where: { screen, anchor }, examples: [{ dataset, id }] }], total,
  // toCheck, blocking, inFiles (the list stored with the files created last), sameAsFiles }. Read only; viewers too.
  app.get('/api/migrations/:id/assumptions', (req, reply) => { const job = need(req, reply); if (!job) return; return assumptionsOf(job); });
  // v2: the opening balances of the bank accounts as a plain list (account, Debit or Credit, amount), for typing in
  // Zoho Books under Settings > Opening Balances if the opening balance journal is refused. Read only.
  app.get('/api/migrations/:id/bank-opening-balances', (req, reply) => { const job = need(req, reply); if (!job) return; return bankOpeningBalances(job.id); });

  // The generated files of a migration, with the layout each was built with and whether it is out of date.
  const fileList = job => {
    const stale = staleInfo(job.id);
    return db.prepare('SELECT module, key, file_name fileName, rows, sha256, template_verified templateVerified, generated_at generatedAt, notes, mapping_hash, columns, attestation FROM generated_files WHERE job_id = ?').all(job.id)
      .map(({ mapping_hash, columns, attestation, ...f }) => {
        const why = stale.forFile(f.key);
        const layout = columns ? JSON.parse(columns) : null; // null for a file created before layouts were recorded
        const t = ALL_FILES[f.key];
        return {
          ...f,
          // a reference report that must not be imported into Zoho Books (the Opening Balances file)
          referenceOnly: !!t?.referenceOnly, referenceNote: t?.referenceOnly ? t.referenceNote : null,
          // templateVerified: the layout matched the official Zoho sample when the file was created (the default layout of a
          // template checked in code, or an admin's statement); templateAttestation says which.
          templateAttestation: attestation ? JSON.parse(attestation) : null,
          mappingHash: mapping_hash ?? null,                       // the layout version the file was built with
          headings: layout ? layout.map(c => c.heading) : null,    // the headings written in the file's first row
          columns: layout,                                          // [{ id, heading, source }]
          currentLayout: mapping_hash ? mapping_hash === getMapping(db, job.firm_id ?? 1, f.key).hash : null, // false when the firm's layout changed since
          outOfDate: why.length > 0, outOfDateReasons: why,
        };
      });
  };
  app.get('/api/migrations/:id/files', (req, reply) => { const job = need(req, reply); if (!job) return; return fileList(job); });
  // The voucher control total of the files created last: { stored, written, leftOut, awaitingRouting, keptWithoutZohoFile, balanced }, or null.
  // The voucher reconciliation of the files created last (voucherrecon.js): per voucher type, where every voucher and
  // every Tally line went, the amounts in and as written, the vouchers behind each cell, and a CSV report. Read only.
  registerVoucherRecon(app, { need, db, audit, slots: VOUCHER_SLOTS, slotName: s => slotByKey[s]?.name ?? s, staleInfo, generatedKeys, voucherControl });
  // Vouchers in no file yet (held for a missing Zoho sample): counts, a list to enter by hand, the sample upload slot.
  registerHeldVouchers(app, { db, need, audit, now, voucherControl });
  // The Zoho check: predicted import success per file and per cause, the rows behind each cause, and a CSV. Read only.
  setupZohoCheck(db); registerZohoCheck(app, { db, need, audit, now, staleInfo });
  // The Import Wizard (one step per page, download all, Zoho's own accounts) and the completeness table (importwizard.js, completenesstable.js).
  // (the expected trial balance is registered further down, with the Zoho trial balance comparison: read when asked)
  let predictedTb = null;
  const importWizard = registerImportSteps(app, { db, need, audit, now, tx, staleInfo, staleMessage, markStale, generatedKeys, voucherControl, predictedTb: jobId => (predictedTb ? predictedTb.predictedTbView(jobId) : null), slots: VOUCHER_SLOTS, slotName: s => slotByKey[s]?.name ?? s, accountRecords, chartRecords, bankOpeningBalances: typeof bankOpeningBalances === 'function' ? bankOpeningBalances : null, openingAnchor: openingAnchorView,
    // the defaults the tool used where nobody decided: listed in READ_ME_FIRST.txt of the zip
    assumptions: jobId => { const j = getJob(jobId); return j ? assumptionsOf(j) : null; } });
  app.get('/api/migrations/:id/voucher-control', (req, reply) => { const job = need(req, reply); if (!job) return; return { control: voucherControl(job.id), names: Object.fromEntries(VOUCHER_SLOTS.map(s => [s, slotByKey[s].name])) }; });

  // Receipt, Payment, Contra and Debit / Credit Note vouchers (payments.js).
  //  samplesNeeded: the Zoho modules these vouchers belong in whose import sample is not in the platform, so no file is
  //    built for them: [{ key, module, what, sample, importAfter, importAfterModule }].
  //  files: what the files created last hold (null when no files were created): per held module the vouchers, amounts
  //    and allocations (from held_vouchers), and how many vouchers are in the journals file of these vouchers.
  //  now: the same worked out from the current data and decisions (null before processing), with every held voucher:
  //    party and bank as written, amount, the invoices or bills it would be applied to, what stays unapplied and why.
  //    ?file=payments_received|payments_made|vendor_credits|credit_notes and ?limit (default 200, at most 2000) narrow the list.
  app.get('/api/migrations/:id/payments', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const samplesNeeded = Object.entries(SAMPLE_NEEDED).map(([key, s]) => ({ key, module: s.module, what: s.what, sample: s.sample, importAfter: s.importAfter, importAfterModule: ALL_FILES[s.importAfter]?.module ?? s.importAfter }));
    const file = req.query.file ? String(req.query.file) : null;
    if (file && !SAMPLE_NEEDED[file]) return reply.code(400).send({ error: `file must be one of: ${Object.keys(SAMPLE_NEEDED).join(', ')}.` });
    const limit = Math.min(2000, Math.max(1, Number(req.query.limit) || 200));
    let files = null;
    if (generatedKeys(job.id).length) {
      const rows = db.prepare('SELECT file_key, detail FROM held_vouchers WHERE job_id = ?').all(job.id).map(r => ({ file: r.file_key, ...JSON.parse(r.detail) }));
      const sum = list => list.reduce((t, x) => t.plus(x), new Decimal(0)).toFixed(2);
      files = { journals: db.prepare("SELECT COUNT(DISTINCT source_record_id) n FROM generated_rows WHERE job_id = ? AND key = 'other_journals'").get(job.id).n,
        held: Object.fromEntries(Object.keys(SAMPLE_NEEDED).map(k => [k, rows.filter(r => r.file === k)]).filter(([, l]) => l.length).map(([k, l]) => [k, {
          module: SAMPLE_NEEDED[k].module, vouchers: l.length, amount: sum(l.map(x => x.amount)), applied: sum(l.flatMap(x => x.applied.map(a => a.amount))), unapplied: sum(l.map(x => x.unapplied)),
          allocationsApplied: l.reduce((t, x) => t + x.applied.length, 0), flagged: l.filter(x => x.flags.length).length }])) };
    }
    let current = null;
    if (['processed', 'generated'].includes(job.status)) {
      const gctx = makeContext(db, job.id);
      const { built } = voucherBuild(job.id, gctx);
      const accountName = gctx.outputName || (x => x);
      const list = built.held.filter(h => !file || h.file === file);
      const unclear = built.exceptions.filter(e => ['money_voucher_unclear', 'note_written_as_journal'].includes(e.kind));
      current = { summary: heldSummary(built.held), journals: built.other_journals.vouchers, journalGroups: built.journalCategories.map(c => ({ ...c, slotName: slotByKey[c.slot]?.name ?? c.slot, words: JOURNAL_CATEGORIES[c.category] })),
        needALook: unclear.map(e => ({ id: e.rec.id, slot: e.rec.slot, slotName: slotByKey[e.rec.slot]?.name ?? e.rec.slot, number: String(e.rec.data.vouchernumber ?? ''), kind: e.kind, message: e.message })),
        total: list.length, vouchers: list.slice(0, limit).map(h => heldView(h, accountName)) };
    }
    return { samplesNeeded, files, now: current };
  });

  app.get('/api/migrations/:id/files/:key/download', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const f = db.prepare('SELECT * FROM generated_files WHERE job_id = ? AND key = ?').get(job.id, req.params.key);
    if (!f) return reply.code(404).send({ error: 'File not generated yet.' });
    const why = staleInfo(job.id).forFile(f.key);
    if (why.length) return reply.code(409).send({ error: staleMessage(job, `The ${f.module} file`, why), outOfDate: true, reasons: why });
    // "Download anyway" is enforced by the server too (audit item 18): rows Zoho is expected to refuse need a confirmation
    const blocked = downloadBlockers(db, job, [f.key], { staleInfo, now, confirmed: ['1', 'true'].includes(String(req.query?.confirmed || '')), by: req.user?.email || null, audit, record: req.user?.role !== 'viewer' });
    if (blocked.length) return reply.code(409).send({ error: downloadBlockedMessage(blocked), needsConfirmation: true, files: blocked });
    let data;
    try { data = fs.readFileSync(f.path); } catch { return reply.code(409).send({ error: `The ${f.module} file is not on the server any more. Create the files again.`, missing: true }); }
    audit(job.id, 'download', f.file_name);
    // marked as downloaded for the Import Tracker; a viewer's download changes nothing (only the audit log records it)
    if (req.user?.role !== 'viewer') db.prepare("INSERT INTO import_status VALUES (?,?,'downloaded','',?) ON CONFLICT (job_id, key) DO NOTHING").run(job.id, f.key, now());
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${f.file_name}"`).send(data);
  });

  // Trace a generated row back to its Tally record.
  app.get('/api/migrations/:id/trace', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    return db.prepare(`SELECT g.key, g.row_no rowNo, g.row_key rowKey, g.source_id sourceId, s.name, s.slot
      FROM generated_rows g JOIN source_records s ON s.id = g.source_record_id WHERE g.job_id = ? ORDER BY g.key, g.row_no LIMIT 500`).all(job.id);
  });

  app.get('/api/migrations/:id/imports', (req, reply) => { const job = need(req, reply); if (!job) return; return importList(job.id); });

  app.put('/api/migrations/:id/imports/:key', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const item = importList(job.id).find(i => i.key === req.params.key);
    if (!item) return reply.code(404).send({ error: 'File not generated yet.' });
    const status = req.body?.status;
    const note = String(req.body?.note || '').trim();
    if (!IMPORT_STATES.includes(status)) return reply.code(400).send({ error: `Status must be one of: ${IMPORT_STATES.join(', ')}.` });
    if (['imported', 'partial'].includes(status) && item.outOfDate) {
      return reply.code(409).send({ error: staleMessage(job, `The ${item.module} file`, item.outOfDateReasons), outOfDate: true, reasons: item.outOfDateReasons });
    }
    if (['imported', 'partial'].includes(status) && !item.ready) {
      return reply.code(409).send({ error: `Import these first: ${item.waitingFor.join(', ')}.` });
    }
    // The Import Wizard's locks (set-up, Migration Date, masters arrived in Zoho) apply here too: this older route must
    // not mark a file imported while its wizard step is locked.
    if (['imported', 'partial'].includes(status)) {
      let ws = null;
      try { ws = importWizard?.wizardState(job, req.user); } catch { ws = null; }
      const step = ws?.available ? (ws.steps.find(x => x.key === item.key) || ws.steps.find(x => x.file?.key === item.key)) : null;
      if (step?.locked) return reply.code(409).send({ error: step.lockReason, locked: true });
    }
    if (['partial', 'failed'].includes(status) && !note) return reply.code(400).send({ error: 'Add a short note on what failed.' });
    db.prepare('INSERT OR REPLACE INTO import_status VALUES (?,?,?,?,?)').run(job.id, item.key, status, note, now());
    audit(job.id, 'import_status', `${item.module}: ${status}${note ? ` (${note})` : ''}`);
    return { ok: true };
  });

  // One-page transfer report for the migration.
  app.get('/api/migrations/:id/report', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const one = (sql, ...a) => db.prepare(sql).get(job.id, ...a).n;
    const recordsStored = one('SELECT COUNT(*) n FROM source_records WHERE job_id = ?');
    return {
      job,
      // True when a file was replaced or removed after the data was last processed: the datasets below show the
      // current files, while the stored records, flagged items and reconciliation are from the earlier run.
      staleSinceUpload: !['processed', 'generated', 'processing'].includes(job.status) && recordsStored > 0,
      datasets: completeness(job.id).slots.map(s => ({ key: s.key, name: s.name, status: s.status, records: s.upload?.records ?? null, fileName: s.upload?.fileName ?? null, sha256: s.upload?.sha256 ?? null, reason: s.waiver?.reason ?? null,
        expectedCount: s.expectedCount, actualCount: s.actualCount, countMatches: s.countMatches, fieldsNotRead: s.upload?.fieldsNotRead?.count ?? null,
        fromAllMasters: s.upload?.fromAllMasters ?? false, fromAllTransactions: s.upload?.fromAllTransactions ?? false,
        requirement: s.requirement, noZohoFile: s.noZohoFile, trialBalance: s.upload?.trialBalance ?? null,
        // key fields the platform needs that are missing from every record of the file, and whether the file may not be readable at all
        mayNotBeReadable: s.mayNotBeReadable, keyFieldsMissing: s.upload?.keyFields ? s.upload.keyFields.fields.filter(f => f.severity === 'warning').map(f => ({ field: f.field, recordType: f.recordType, similar: f.similar })) : null })),
      allMasters: allMastersInfo(job.id), // the All Masters file and how its records were split, or null
      allTransactions: allTransactionsInfo(job.id), // the All Transactions file and how its vouchers were sorted, or null
      recordsStored,
      // total: the journal vouchers that need routing; notPosted: cancelled, optional and deleted journals, which never do
      journals: { total: one("SELECT COUNT(*) n FROM source_records WHERE job_id = ? AND slot = 'journal'") - journalsNotPosted(job.id), notPosted: journalsNotPosted(job.id),
        decided: one('SELECT COUNT(*) n FROM journal_decisions WHERE job_id = ?'),
        overridden: one('SELECT COUNT(*) n FROM journal_decisions WHERE job_id = ? AND decision <> suggested') },
      // the Trial Balance report as matched and checked by the last processing run, or null
      trialBalance: (() => { const s = db.prepare('SELECT data FROM trial_balance_summary WHERE job_id = ?').get(job.id); return s ? JSON.parse(s.data) : null; })(),
      files: importList(job.id),
      // the voucher control total of the files created last (every voucher dataset), or null when there are no files
      voucherControl: voucherControl(job.id),
      ...staleFields(job.id),
      // Rejections recorded against the current files, per file. Rejections of an earlier version of a file are removed when the file changes.
      rejections: db.prepare('SELECT key, status, COUNT(*) n FROM rejections WHERE job_id = ? GROUP BY key, status').all(job.id).reduce((list, r) => {
        let e = list.find(x => x.key === r.key);
        if (!e) list.push(e = { key: r.key, module: ALL_FILES[r.key]?.module || r.key, total: 0, open: 0, corrected: 0, retried: 0, unlinked: 0,
          corrections: db.prepare('SELECT COUNT(*) n FROM corrections WHERE job_id = ? AND key = ?').get(job.id, r.key).n });
        e.total += r.n; if (r.status in e) e[r.status] += r.n;
        return list;
      }, []),
      exceptions: db.prepare('SELECT stage, slot, name, message, kind, uses FROM exceptions WHERE job_id = ? ORDER BY id').all(job.id).map(e => ({ ...e, slotName: slotByKey[e.slot]?.name })),
      // Reconciliation totals per module, from the Zoho reports uploaded so far (assumed report format).
      reconciliation: verificationSummary(db, job.id).map(({ problems, ...totals }) => totals),
      reconciliationNote: RECONCILIATION_NOTE,
      audit: db.prepare('SELECT at, actor, action, detail FROM audit_logs WHERE job_id = ? ORDER BY id').all(job.id),
    };
  });

  app.get('/api/migrations/:id/audit', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    return db.prepare('SELECT at, actor, action, detail FROM audit_logs WHERE job_id = ? ORDER BY id DESC').all(job.id);
  });

  const { accountTypes, unitList } = registerExtras(app, { db, need, audit, now, tx, DATA_DIR, slotByKey, markStale });
  registerTaxes(app, { db, need, audit, now, tx, markStale });
  const { itemView, clashView, hsnView } = registerDecisions(app, { db, need, audit, now, tx, markStale, clearStale,
    chartLedgers: jobId => accountRecords(jobId, chartRecords(jobId), makeContext(db, jobId)).candidates, kindOf: jobId => ledgerKinds(jobId) });
  const { namesView, contactView } = registerNames(app, { db, need, audit, now, tx, markStale,
    chartLedgers: jobId => accountRecords(jobId, chartRecords(jobId), makeContext(db, jobId)).candidates, context: jobId => makeContext(db, jobId) });

  // "Prepare migration": the whole way from the three Tally files to the files to download, in one answer (prepare.js).
  // Every count is read from the same function as the screen where it is decided.
  app.get('/api/migrations/:id/prepare', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const firmId = job.firm_id ?? 1;
    const id = job.id;
    // kept while nothing changes (the screen asks every few seconds): the same answer, worked out once
    return cachedState(`prepare:${req.user?.role === 'viewer' ? 'viewer' : 'change'}`, id, () => buildPrepareState({
      job, user: req.user, comp: completeness(id), processing: processStatus(id), active: activeRuns.has(id) || job.status === 'processing',
      recordsStored: db.prepare('SELECT COUNT(*) n FROM source_records WHERE job_id = ?').get(id).n,
      views: {
        accountTypes: () => accountTypes(id), taxes: () => taxMappingList(db, id), tds: () => tdsView(db, id), units: () => unitList(id),
        items: () => itemView(id), clashes: () => clashView(id), names: () => namesView(id), contacts: () => contactView(id), journals: () => listJournals(id),
        hsn: () => hsnView(id),
        gst: () => { const codeSet = gstCodesForFirm(db, firmId); return { codeSet, label: gstCodeSet(codeSet).label, unregisteredConsumerAs: gstUnregisteredConsumerForFirm(db, firmId) }; },
        reviews: () => stepReviews(db, id), // v2: steps accepted as per Tally
      },
      files: () => fileList(job), imports: () => importList(id),
      // the same numbers as GET held-vouchers and GET zoho-check (one source each)
      held: () => heldState(db, id, voucherControl(id)),
      zohoCheck: () => { try { return zohoCheckSummary(db, job, { staleInfo, now }); } catch { return null; } },
    }));
  });
  registerVoucherOptions(app, { db, need, audit, now, tx, markStale });
  registerColumns(app, { db, need, audit, now, tx, slotByKey, previewRows, markStale, clearStale });

  // Reconciliation: Zoho Books' Trial Balance against Tally's, account by account (zohotb.js; assumed report format).
  const zohoTb = registerZohoTb(app, { db, need, audit, now, tx, context: jobId => makeContext(db, jobId),
    tallyTrialBalance: jobId => {
      const s = db.prepare('SELECT data FROM trial_balance_summary WHERE job_id = ?').get(jobId);
      return { summary: s ? JSON.parse(s.data) : null, lines: db.prepare('SELECT data FROM trial_balance_lines WHERE job_id = ? ORDER BY line_no').all(jobId).map(l => JSON.parse(l.data)) };
    },
    ledgerInfo: jobId => { const p = partySets(jobId); return ledgerInfoFrom({ parents: ledgerParents(jobId), customers: p.customers, vendors: p.vendors, taxes: p.taxLedgers }); } });
  // The trial balance Zoho Books should show, worked out from the files before any import, against Tally's closing
  // balances (predictedtb.js). A report: it never blocks a download.
  predictedTb = registerPredictedTb(app, { db, need, audit, fileLayout, settings: jobId => voucherSettings(db, jobId), tallySide: jobId => zohoTb.tallySide(jobId, 'closing'),
    // the ONE opening balance typed in Zoho Books (the date anchor in 'typed' mode): in no file, but in Zoho's figures
    typedOpening: jobId => { const v = openingAnchorView(jobId); return v && v.mode === 'typed' ? { account: v.account, amount: v.signed } : null; },
    contactName: jobId => { const name = makeContext(db, jobId).outputName; return name ? ledger => name(ledger) : null; },
    held: jobId => heldState(db, jobId, voucherControl(jobId)),
    // Round 1 (issue 2): the vouchers Tally posted inside the year that are left out of the files with a reason (a date
    // that does not exist, debits and credits that differ, an amount that cannot be read ...): their Tally lines, so
    // every difference they cause on the expected balances says why. Not a duplicate copy, not a voucher Tally does not
    // post (cancelled, optional, deleted, void) and not one dated outside the year (not in Tally's figures either).
    leftOutPosted: jobId => {
      const NOT_POSTED = new Set(['duplicate', 'cancelled', 'optional', 'deleted', 'void', 'outside_year']);
      const out = [];
      for (const r of db.prepare("SELECT vr.slot, vr.data rd, sr.data sd, sr.name FROM voucher_recon vr JOIN source_records sr ON sr.id = vr.source_record_id WHERE vr.job_id = ? AND COALESCE(json_extract(vr.data, '$.outcome'), vr.outcome) = 'left_out' ORDER BY vr.source_record_id").all(jobId)) {
        let rd, v; try { rd = JSON.parse(r.rd || '{}'); v = JSON.parse(r.sd); } catch { continue; }
        const reason = String(rd.reason || '');
        if (NOT_POSTED.has(reason)) continue;
        const number = String(v.vouchernumber ?? rd.number ?? '').trim() || r.name;
        const why = reason === 'invalid_date' ? `its date "${v.date ?? ''}" does not exist` : reason === 'not_balanced' ? 'its debits and credits differ'
          : reason === 'unreadable_amount' ? 'an amount on it cannot be read' : 'see the voucher reconciliation';
        const lines = voucherLines(v).filter(l => l.ledger && l.amount && !l.amount.isZero()).map(l => ({ ledger: l.ledger, amount: l.amount }));
        out.push({ type: entryVchType(v) || r.slot, number, why, lines });
      }
      return out;
    },
    // the rows the Zoho check expects Zoho Books to refuse: left out of the expected balances (SYN-4)
    // and the rows it says Zoho MAY refuse: posted, but listed. One run of the check on the files as they are now, so the
    // check and the expected balances always describe the same files.
    checked: jobId => { const job = getJob(jobId); return job ? checkedRows(db, job, now) : null; } });

  // Mapping Profiles: the decisions of one migration saved for the firm and applied to another (profiles.js).
  registerProfiles(app, { db, need, audit, now, tx,
    views: id => ({
      accountTypes: () => accountTypes(id), taxes: () => taxMappingList(db, id), tds: () => tdsView(db, id), units: () => unitList(id),
      items: () => itemView(id), clashes: () => clashView(id), names: () => namesView(id), journals: () => listJournals(id),
      voucherSettings: () => voucherSettings(db, id), decisions: () => loadDecisions(db, id),
      contacts: () => db.prepare("SELECT DISTINCT name FROM source_records WHERE job_id = ? AND slot IN ('customers','vendors') AND object_type = 'Ledger'").all(id).map(r => r.name),
    }),
    firmSettings: firmId => ({ gst: { codeSet: gstCodesForFirm(db, firmId), unregisteredConsumerAs: gstUnregisteredConsumerForFirm(db, firmId) },
      layouts: Object.keys(ALL_FILES).map(key => { const m = getMapping(db, firmId, key); return { key, module: ALL_FILES[key].module, hash: m.hash, isDefault: !m.customised }; }) }) });

  // Test run report: everything needed to review a test round, in one response. Add ?download=1 to get it as a JSON file.
  app.get('/api/migrations/:id/test-report', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const report = buildTestReport({ db, job, slotByKey, completeness, importList, fileList, accountTypes, unitList, processRun, journalsNotPosted, voucherControl, decidedNames: decidedLedgerNames,
      // the assumptions (defaults applied) stored with the files created last
      assumptions: jobId => { const r = db.prepare('SELECT data FROM applied_defaults WHERE job_id = ?').get(jobId); try { return r ? JSON.parse(r.data) : null; } catch { return null; } } });
    if (!['1', 'true'].includes(String(req.query.download || ''))) return report;
    audit(job.id, 'test_report_downloaded', `${report.whatToFixNext.length} item(s) in "what to fix next"`);
    return reply.header('content-type', 'application/json; charset=utf-8').header('content-disposition', `attachment; filename="test-report-${job.id}.json"`).send(JSON.stringify(report, null, 2));
  });

  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3001;
  buildApp().listen({ port, host: '127.0.0.1' }).then(() => console.log(`Migration API running at http://127.0.0.1:${port}`));
}
