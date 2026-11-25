// The Zoho check of a migration (zohocheck.js is the rule engine; this module runs it on the files of a migration,
// keeps the result and answers the screens).
//
//  - runZohoCheck(db, job) runs when the files are created (one line in index.js) and whenever the stored result was
//    made for other files: the result carries a signature of the files it was made from (their checksums, the rules
//    version and the settings used), so it can never describe files that are no longer there.
//  - The files are read from disk exactly as they will be downloaded, so the check sees what Zoho will see.
//  - It is "out of date" exactly when the files are: the summary restates the reasons the files are out of date.
//  - GET /api/migrations/:id/zoho-check               the summary: per file and per cause (viewers may read)
//  - GET /api/migrations/:id/zoho-check/rows          the rows behind one cause of one file, in pages
//  - GET /api/migrations/:id/zoho-check/findings.csv  every finding, for Excel
//  - POST /api/migrations/:id/zoho-check/acknowledge  records that a file with blocking problems was downloaded anyway
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { checkFiles, summaryOf, causeRows, parseCsvTable, RULES, moduleRules, stateOfGstin, TIERS, TIER_LABEL, ZOHO_CHECK_SCREEN } from './zohocheck.js';
import { ALL_FILES, defaultColumns } from './columns.js';
import { hsnFieldOn } from './vouchers.js';
import { companyGstOf, companyGstinForHsn } from './companygst.js';
import { migrationDateOf } from './zoho.js';
import { openingBalancesFrom } from './decisions.js';
import { jobYear } from './tally.js';
import { arrivedKeys } from './zohoverify.js';

export function setupZohoCheck(db) {
  db.exec('CREATE TABLE IF NOT EXISTS zoho_checks (job_id TEXT PRIMARY KEY, signature TEXT NOT NULL, at TEXT NOT NULL, ms INTEGER, summary TEXT NOT NULL)');
  // "Download anyway": a file with rows Zoho is expected to refuse, confirmed for download, for the file's checksum (a
  // file created again with other contents needs a new confirmation)
  db.exec('CREATE TABLE IF NOT EXISTS zoho_check_acks (job_id TEXT NOT NULL, key TEXT NOT NULL, sha256 TEXT NOT NULL, by TEXT, at TEXT, PRIMARY KEY (job_id, key))');
}

// The files of keys (null: every file) that may not be downloaded yet: the Zoho check expects Zoho to refuse rows of
// them, and nobody confirmed "Download anyway" for the file as it is now. confirmed: the request itself confirms (the
// download asked with ?confirmed=1): the confirmation is then recorded. record false (a viewer, who cannot
// acknowledge): the download goes ahead and only the audit log says so; no confirmation is stored, so the viewer's
// next download asks again and nobody else's download is unlocked by it. Returns [{ key, module, rowsWill, rows }].
export function downloadBlockers(db, job, keys, { staleInfo, now = () => new Date().toISOString(), confirmed = false, by = null, audit = null, record = true } = {}) {
  let s;
  try { s = zohoCheckSummary(db, job, { staleInfo, now }); } catch { return []; }
  if (!s.available) return [];
  const sha = Object.fromEntries(db.prepare('SELECT key, sha256 FROM generated_files WHERE job_id = ?').all(job.id).map(f => [f.key, f.sha256]));
  const acked = new Set(db.prepare('SELECT key, sha256 FROM zoho_check_acks WHERE job_id = ?').all(job.id).filter(a => sha[a.key] === a.sha256).map(a => a.key));
  // also a file whose opening balances wait for the Migration Date (download 'confirm_date'): it must not be imported yet
  const open = s.files.filter(f => (f.rowsWill > 0 || f.download === 'confirm_date') && (!keys || keys.includes(f.key)) && !acked.has(f.key));
  if (open.length && confirmed) {
    for (const f of open) {
      if (record) db.prepare('INSERT OR REPLACE INTO zoho_check_acks (job_id, key, sha256, by, at) VALUES (?,?,?,?,?)').run(job.id, f.key, sha[f.key] || '', by, now());
      if (audit) audit(job.id, 'zoho_check_download_confirmed', `${f.module}: downloaded although ${f.rowsWill > 0 ? `${f.rowsWill} of ${f.rows} rows are expected to be refused by Zoho Books${f.rowsMay ? ` and ${f.rowsMay} may be` : ''}` : `the Migration Date is not checked in Zoho Books yet (${f.dateRows} opening balances wait for it)`}${record ? '' : ' (view-only user: confirmed for this download only)'}.`);
    }
    return [];
  }
  return open.map(f => ({ key: f.key, module: f.module, rowsWill: f.rowsWill, rows: f.rows, ...(f.download === 'confirm_date' ? { waitsForDate: true, dateRows: f.dateRows } : {}) }));
}
export const downloadBlockedMessage = list => {
  const refuse = list.filter(f => f.rowsWill > 0), date = list.filter(f => f.waitsForDate && !(f.rowsWill > 0));
  return [refuse.length ? `Zoho Books is expected to refuse rows of ${refuse.map(f => `${f.module} (${f.rowsWill} of ${f.rows} rows)`).join(', ')}. Fix them first (Zoho check), or confirm "Download anyway" and download again.` : '',
    date.length ? `${date.map(f => `${f.module} (${f.dateRows} opening balance${f.dateRows === 1 ? '' : 's'})`).join(' and ')} must not be imported before the Migration Date is saved and checked in Zoho Books (Import Wizard, step "Save the Migration Date"): Zoho Books dates these balances with it and does not let it be changed afterwards. Do that step first, or confirm "Download anyway" and import the file only after that step.` : ''].filter(Boolean).join(' ');
};

// Text cells of the findings CSV that Excel would run as a formula get a leading apostrophe (as the voucher
// reconciliation report does). Only this report: the Zoho files are written as they are.
export const safeText = v => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
const csvCell = v => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csvLine = cells => cells.map(csvCell).join(',');

const tableExists = (db, name) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);

// What the check knows about the Zoho Books organisation: its own state (from the GSTIN of the migration), the tax
// names the user saved as existing in Zoho Books, and the TDS taxes chosen in Mapping Studio.
function optionsFor(db, job) {
  const companyGst = companyGstOf(db, job.id);
  const names = (table, column) => (tableExists(db, table) ? db.prepare(`SELECT DISTINCT ${column} v FROM ${table} WHERE job_id = ?`).all(job.id).map(r => String(r.v || '').trim()).filter(Boolean) : []);
  // Zoho's own Chart of Accounts export of the organisation (Import Wizard, set-up), when given: the check compares
  // with it instead of the researched list of Zoho's accounts (audit item 10)
  const exported = tableExists(db, 'zoho_existing_accounts_meta') && db.prepare('SELECT 1 FROM zoho_existing_accounts_meta WHERE job_id = ?').get(job.id)
    ? db.prepare('SELECT name, account_type accountType FROM zoho_existing_accounts WHERE job_id = ? ORDER BY name').all(job.id) : null;
  // TDS taxes known to exist: only those of Zoho's own TDS export (voucheropts.js) and Zoho's default taxes on their dates
  // (tds.js knownTdsTaxes, applied by the check per row date). A name chosen in TDS mapping is a choice, not proof
  // (TDS-002): it is passed apart (tdsChosen) and stays "may be refused" until the export shows it.
  const exportGiven = tableExists(db, 'zoho_tds_taxes_meta') && !!db.prepare('SELECT 1 FROM zoho_tds_taxes_meta WHERE job_id = ?').get(job.id);
  const tds = exportGiven ? names('zoho_tds_taxes', 'name').sort() : [];
  const tdsChosen = names('tds_mappings', 'tds_name').filter(n => !tds.includes(n)).sort();
  // the TDS taxes of Zoho's own export with their rate, section, dates and status (the check compares a TDS Name written
  // with the tax it names, and says when the tax is Inactive)
  const zohoTdsTaxes = exportGiven && tableExists(db, 'zoho_tds_taxes')
    ? db.prepare('SELECT name, rate, section, start_date start, end_date end, status FROM zoho_tds_taxes WHERE job_id = ? ORDER BY seq').all(job.id).map(t => ({ ...t, start: t.start || '', end: t.end || '', status: t.status || '' })) : [];
  // the bills and invoices whose TDS Amount (Tally's) is not the TDS Percentage of the base (index.js, TDS-005)
  const tdsDiffers = {};
  if (tableExists(db, 'doc_tds_differs')) for (const d of db.prepare('SELECT key, number, party, difference FROM doc_tds_differs WHERE job_id = ? ORDER BY rowid').all(job.id)) (tdsDiffers[d.key] ||= []).push({ number: d.number, party: d.party, difference: d.difference });
  // the Import Wizard answers: is the HSN/SAC field on in Zoho Books (voucher setting hsnEnabled, on by default) and, when it is, the
  // shortest code it takes; is the Migration Date step ticked (a warning on a contacts file with opening balances until it is)
  let extra = {};
  try { extra = JSON.parse(db.prepare('SELECT extra FROM voucher_settings WHERE job_id = ?').get(job.id)?.extra || '{}') || {}; } catch { extra = {}; }
  // the Migration Date step of the Import Wizard: done only when the date Zoho Books was seen to show (typed there, or
  // sent by whoever read it from Zoho) IS the Migration Date of the tool. zohoOpeningDate: that date, '' when not given.
  const migrationDate = migrationDateOf(extra.openingDate, openingBalancesFrom(db, job.id, jobYear(job)) || jobYear(job)?.from).date;
  const seen = tableExists(db, 'wizard_ticks') ? String(db.prepare("SELECT value FROM wizard_ticks WHERE job_id = ? AND step = 'date' AND item = 'd.zohoDate'").get(job.id)?.value || '') : '';
  const zohoOpeningDate = /^\d{4}-\d{2}-\d{2}$/.test(seen) ? seen : '';
  const dateTick = zohoOpeningDate !== '' && zohoOpeningDate === migrationDate;
  // the invoices and bills the generation found will come to another total in Zoho Books than in Tally (index.js)
  const differs = {};
  if (tableExists(db, 'doc_total_differs')) for (const d of db.prepare('SELECT key, number, party, difference FROM doc_total_differs WHERE job_id = ? ORDER BY rowid').all(job.id)) (differs[d.key] ||= []).push({ number: d.number, party: d.party, difference: d.difference });
  // what Zoho Books really holds after the import of a master file: the names of its own export of the Chart of Accounts,
  // Customers, Vendors or Items, given in the Import Wizard (zohoverify.js). A name of the file that is not there was not
  // created, so every row of a later file that names it is marked "will be refused".
  let zohoArrived = {};
  try { zohoArrived = arrivedKeys(db, job.id); } catch { zohoArrived = {}; }
  return { ...(Object.keys(differs).length ? { docTotalDiffers: differs } : {}), ...(Object.keys(tdsDiffers).length ? { tdsAmountDiffers: tdsDiffers } : {}),
    ...(tdsChosen.length ? { tdsChosen } : {}), tdsExportGiven: exportGiven, ...(Object.keys(zohoArrived).length ? { zohoArrived } : {}), hsnEnabled: hsnFieldOn(extra.hsnEnabled, companyGstinForHsn(db, job.id)), hsnMinDigits: extra.hsnMinDigits === '4' ? 4 : 6, openingDateConfirmed: dateTick, migrationDate, zohoOpeningDate,
    // the organisation's own state: the GSTIN of the migration, else the company's state read from Tally's vouchers
    // (companygst.js, GST-013); orgGstStatus: rules that apply only to a GST-registered organisation (zohorules.json
    // org_gst) are not checked for a company not registered for GST
    homeState: stateOfGstin(job.gstin) || companyGst.state || null, orgGstStatus: companyGst.status, zohoNames: { taxes: names('zoho_tax_list', 'name').sort(), tds_taxes: tds }, zohoTdsTaxes,
    ...(exported ? { zohoAccounts: exported } : {}) };
}

// The files of a migration as the engine wants them. A column is known by its standard heading even when the firm
// renamed it (the rules name the standard headings). The reference report is not imported and is not checked.
function loadFiles(db, jobId) {
  const input = {}, notChecked = [], parts = [];
  for (const f of db.prepare('SELECT key, module, file_name, path, sha256, columns FROM generated_files WHERE job_id = ? ORDER BY rowid').all(jobId)) {
    const t = ALL_FILES[f.key];
    if (!t || t.referenceOnly) { notChecked.push({ key: f.key, module: f.module, reason: 'A reference report: it is not imported into Zoho Books.' }); continue; }
    if (!RULES.modules[f.key] || !moduleRules(f.key)) { notChecked.push({ key: f.key, module: f.module, reason: 'There are no rules for this file yet.' }); continue; }
    let text;
    try { text = fs.readFileSync(f.path, 'utf8'); } catch { notChecked.push({ key: f.key, module: f.module, reason: 'The file is not on the server any more. Create the files again.' }); continue; }
    const table = parseCsvTable(text);
    const written = table[0] || [];
    const layout = f.columns ? JSON.parse(f.columns) : null;
    const standard = Object.fromEntries(defaultColumns(f.key).map(c => [c.id, c.heading]));
    const headers = layout && layout.length === written.length ? layout.map(c => standard[c.id] || c.heading) : written;
    input[f.key] = { headers, rows: table.slice(1), bytes: Buffer.byteLength(text), fileName: f.file_name, writtenHeaders: written };
    parts.push(`${f.key}:${f.sha256}`);
  }
  return { input, notChecked, parts };
}

const cache = new Map(); // job id -> { signature, result }: the full result with its rows, for the drill-down
const remember = (jobId, signature, result) => { cache.delete(jobId); cache.set(jobId, { signature, result }); if (cache.size > 4) cache.delete(cache.keys().next().value); };

const signatureOf = (db, job) => {
  const files = db.prepare('SELECT key, sha256 FROM generated_files WHERE job_id = ? ORDER BY rowid').all(job.id);
  if (!files.length) return null;
  return createHash('sha256').update(JSON.stringify({ files: files.map(f => `${f.key}:${f.sha256}`), rules: `${RULES.meta.version}|${RULES.meta.date}`, options: optionsFor(db, job) })).digest('hex');
};

// The same cause in several files is one line (a journal refused because of a bank account is the same problem in
// both journal files), with the count per file.
function groupCauses(files) {
  const by = new Map();
  for (const f of files) {
    for (const c of f.causes) {
      const id = `${c.id}${c.cascadeFrom ? `<-${c.cascadeFrom}` : ''}${c.wholeFile ? `@${f.key}` : ''}`;
      if (!by.has(id)) by.set(id, { ...c, id, rows: 0, documents: 0, files: [] });
      const g = by.get(id);
      g.rows += c.rows; g.documents += c.documents;
      g.files.push({ key: f.key, module: f.module, cause: c.id, rows: c.rows, documents: c.documents, hasDocuments: f.hasDocuments, wholeFile: c.wholeFile });
      if (c.message.length > g.message.length) g.message = c.message;
    }
  }
  return [...by.values()].sort((a, b) => TIERS[b.tier] - TIERS[a.tier] || b.rows - a.rows || a.id.localeCompare(b.id));
}

// Runs the check on the files of the migration as they are now, stores the summary and returns the full result.
export function runZohoCheck(db, job, now = () => new Date().toISOString()) {
  const signature = signatureOf(db, job);
  if (!signature) { db.prepare('DELETE FROM zoho_checks WHERE job_id = ?').run(job.id); cache.delete(job.id); return null; }
  const { input, notChecked } = loadFiles(db, job.id);
  const result = checkFiles(input, optionsFor(db, job));
  result.filesNotChecked = notChecked;
  result.checkedAt = now();
  const summary = summaryOf(result);
  db.prepare('INSERT OR REPLACE INTO zoho_checks (job_id, signature, at, ms, summary) VALUES (?,?,?,?,?)').run(job.id, signature, result.checkedAt, result.ms, JSON.stringify(summary));
  remember(job.id, signature, result);
  return result;
}

// The rows of each file that Zoho Books is expected to refuse (tier "will"), as { file key: [{ heading: value }] }: every
// row of a document (invoice, bill, journal) that will be refused, since Zoho refuses the document as a whole. Used by the
// expected trial balance (predictedtb.js), which leaves them out (SYN-4). {} when there are no files.
export function refusedRows(db, job, now = () => new Date().toISOString()) {
  return checkedRows(db, job, now).refused;
}
// The same, both tiers, from ONE run of the check on the files as they are (the expected trial balance uses it, so the
// two never disagree): { refused: { key: [row] }, may: { key: [row] }, rules: { refused: { key: [[rule id]] }, may: {...} } }.
// rules: per row (same order), the rules that make the row or its document refused / possibly refused (a row refused only
// because another row of its document is refused names that row's rules).
export function checkedRows(db, job, now = () => new Date().toISOString()) {
  const result = fullResult(db, job, now);
  const out = { refused: {}, may: {}, rules: { refused: {}, may: {} } };
  for (const f of result?.files || []) {
    const d = f.detail;
    if (!d || (!f.rowsWill && !f.rowsMay)) continue;
    const tierOf = i => (d.docIds && d.docStatus ? d.docStatus[d.docIds[i]] : d.status[i]);
    // the rules of each row, and of each document (a row is refused with its document)
    const rowRules = new Map(), docRules = new Map();
    for (const c of d.causes.values()) {
      if (c.tier < 2) continue;
      const rows = c.whole ? d.rows.map((_, i) => i) : c.rows;
      for (const i of rows) {
        const k = d.docIds ? `d${d.docIds[i]}` : `r${i}`;
        if (!docRules.has(k)) docRules.set(k, new Set());
        docRules.get(k).add(c.rule.id);
        if (!rowRules.has(i)) rowRules.set(i, new Set());
        rowRules.get(i).add(c.rule.id);
      }
    }
    for (const [tier, side] of [[3, 'refused'], [2, 'may']]) {
      const list = [], rules = [];
      d.rows.forEach((r, i) => {
        if (tierOf(i) !== tier) return;
        list.push(Object.fromEntries(d.headers.map((h, k) => [h, r[k] ?? ''])));
        rules.push([...(docRules.get(d.docIds ? `d${d.docIds[i]}` : `r${i}`) || rowRules.get(i) || [])].sort());
      });
      if (list.length) { out[side][f.key] = list; out.rules[side][f.key] = rules; }
    }
  }
  return out;
}

// The stored summary when it was made for the files of now; otherwise the check runs first.
function currentSummary(db, job, now) {
  const signature = signatureOf(db, job);
  if (!signature) return null;
  const row = db.prepare('SELECT signature, summary FROM zoho_checks WHERE job_id = ?').get(job.id);
  if (row?.signature === signature) { try { return JSON.parse(row.summary); } catch { /* run again */ } }
  return summaryOf(runZohoCheck(db, job, now));
}
function fullResult(db, job, now) {
  const signature = signatureOf(db, job);
  if (!signature) return null;
  const hit = cache.get(job.id);
  return hit?.signature === signature ? hit.result : runZohoCheck(db, job, now);
}

// The download state of one file of the summary (see zohoCheckSummary).
const rulesById = new Map(Object.keys(RULES.modules).flatMap(k => (moduleRules(k) || []).map(r => [r.id, r])));
const isDateRule = id => rulesById.get(id)?.params?.check === 'opening_date_confirmed';
function dateGate(f) {
  const waits = (f.causes || []).filter(c => isDateRule(c.ruleId));
  const dateRows = waits.reduce((t, c) => t + (c.rows || 0), 0);
  if (f.rowsWill > 0) return { download: 'confirm', ...(waits.length ? { waitsForDate: true, dateRows } : {}) };
  return waits.length ? { download: 'confirm_date', waitsForDate: true, dateRows } : { download: 'ok' };
}

// The summary as the screens read it.
export function zohoCheckSummary(db, job, { staleInfo, now } = {}) {
  const s = currentSummary(db, job, now);
  if (!s) return { available: false, message: 'The Zoho files have not been created yet. The check runs by itself when they are.' };
  const stale = staleInfo ? staleInfo(job.id) : { filesOutOfDate: false, outOfDateReasons: [], forFile: () => [] };
  // accepted / refused: the same counts under the names the Import Wizard reads (accepted = not "will be refused")
  const files = s.files.map(({ notChecked, ...f }) => ({ ...f, outOfDate: stale.forFile ? stale.forFile(f.key).length > 0 : false,
    accepted: f.rows - f.rowsWill, refused: f.rowsWill, blocking: f.rowsWill > 0,
    // 'confirm': rows Zoho will refuse. 'confirm_date': nothing is refused, but the opening balances of the file wait for
    // the Migration Date (the cause of a rule with check opening_date_confirmed): the file is not "ready" until the
    // date Zoho Books shows was checked in the Import Wizard. dateRows: the rows with such a balance.
    ...dateGate(f) }));
  const notAboutTheFile = new Map();
  for (const f of s.files) for (const n of f.notChecked) if (!notAboutTheFile.has(n.ruleId)) notAboutTheFile.set(n.ruleId, n);
  const causes = groupCauses(s.files);
  const tierCount = t => causes.filter(c => c.tier === t).length;
  return {
    available: true, checkedAt: s.checkedAt, ms: s.ms, rulesVersion: s.rulesVersion, rulesDate: s.rulesDate, screen: ZOHO_CHECK_SCREEN,
    outOfDate: !!stale.filesOutOfDate, outOfDateReasons: (stale.outOfDateReasons || []).map(r => r.reason),
    overall: { ...s.overall, causesWill: tierCount('will'), causesMay: tierCount('may'), warnings: tierCount('warning') },
    files, causes, filesNotChecked: s.filesNotChecked || [],
    // facts to know, counted per file (never findings: outside every count above, and they block nothing). For
    // example the journals that leave a credit on a customer or vendor, with the page where the credits are applied.
    notes: files.flatMap(f => (f.notes || []).map(n => ({ ...n, file: f.key, module: f.module }))),
    // what must be done by hand in Zoho Books before a file is imported (a cause with preStep), per file
    preSteps: causes.filter(c => c.preStep).map(c => ({ id: c.id, ruleId: c.ruleId, files: c.files.map(f => f.key), rows: c.rows, what: c.preStep.what, where: c.preStep.where, then: c.preStep.then, message: c.message })),
    rulesApplied: new Set(s.files.flatMap(f => (moduleRules(f.key) || []).map(r => r.id))).size - notAboutTheFile.size,
    rulesNotAboutTheFile: notAboutTheFile.size,
    labels: { will: TIER_LABEL.will, may: TIER_LABEL.may, warning: TIER_LABEL.warning },
  };
}

export function registerZohoCheck(app, { db, need, audit, now, staleInfo }) {
  app.get('/api/migrations/:id/zoho-check', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    return zohoCheckSummary(db, job, { staleInfo, now });
  });

  // The rows behind one cause of one file: ?file=<key>&cause=<cause id of that file>&page=&pageSize= (up to 200).
  app.get('/api/migrations/:id/zoho-check/rows', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const result = fullResult(db, job, now);
    if (!result) return reply.code(409).send({ error: 'The Zoho files have not been created yet.' });
    const file = result.files.find(f => f.key === String(req.query.file || ''));
    if (!file) return reply.code(400).send({ error: `file must be one of: ${result.files.map(f => f.key).join(', ')}.` });
    const cause = file.causes.find(c => c.id === String(req.query.cause || ''));
    if (!cause) return reply.code(400).send({ error: `That cause is not in the ${file.module} file. Causes: ${file.causes.map(c => c.id).join(', ') || 'none'}.` });
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 25));
    const total = file.detail.causes.get(cause.id).rows.length;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(pages, Math.max(1, Number(req.query.page) || 1));
    const list = causeRows(file, cause.id, { offset: (page - 1) * pageSize, limit: pageSize });
    return { file: file.key, module: file.module, idColumn: file.idColumn, cause, total, page, pages, pageSize, wholeFile: list.wholeFile,
      columns: [...new Set(list.rows.flatMap(r => Object.keys(r.values)))], rows: list.rows };
  });

  app.get('/api/migrations/:id/zoho-check/findings.csv', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const result = fullResult(db, job, now);
    if (!result) return reply.code(409).send({ error: 'The Zoho files have not been created yet.' });
    const stale = staleInfo ? staleInfo(job.id) : { filesOutOfDate: false };
    const lines = [csvLine(['File', 'Row in the file', 'Record', 'Zoho is expected to', 'Rule', 'Kind of problem', 'How sure', 'Column', 'Value written', 'What is wrong', 'How to fix it', 'Where to fix it'])];
    const outcome = { will: 'refuse the row', may: 'accept the row, or refuse it (not confirmed)', warning: 'accept the row', ok: 'accept the row' };
    let findings = 0;
    for (const f of result.files) {
      for (const c of f.causes) {
        const base = [c.ruleId + (c.variant ? ` (${c.variant.split(':')[0]})` : ''), c.tierLabel, c.evidenceLabel];
        const tail = [safeText(c.message), safeText(c.fix), c.place?.label || ''];
        const all = causeRows(f, c.id, { offset: 0, limit: Infinity });
        if (c.wholeFile && !all.rows.length) { lines.push(csvLine([f.module, 'every row', '', c.tier === 'warning' ? outcome.warning : outcome[c.tier], ...base, c.columns.join(', '), '', ...tail])); findings++; continue; }
        for (const r of all.rows) {
          lines.push(csvLine([f.module, r.rowNumber, safeText(r.ident), outcome[r.outcome] || outcome.ok, ...base, r.column || c.columns.join(', '), safeText(r.column ? r.values[r.column] ?? '' : ''), ...tail]));
          findings++;
        }
      }
    }
    audit(job.id, 'download', `Zoho check findings (${findings} finding${findings === 1 ? '' : 's'})${stale.filesOutOfDate ? ' (files out of date)' : ''}`);
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="zoho_check_${job.id}.csv"`).send('﻿' + lines.join('\r\n') + '\r\n');
  });

  // A file with rows Zoho will refuse may still be downloaded, after an explicit confirmation on the screen. That
  // choice is written to the audit log. Body: { key }.
  app.post('/api/migrations/:id/zoho-check/acknowledge', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const s = zohoCheckSummary(db, job, { staleInfo, now });
    const f = s.available ? s.files.find(x => x.key === String(req.body?.key || '')) : null;
    if (!f) return reply.code(404).send({ error: 'That file is not part of the Zoho check.' });
    // recorded for the file as it is now: the download routes check it (downloadBlockers)
    const sha = db.prepare('SELECT sha256 FROM generated_files WHERE job_id = ? AND key = ?').get(job.id, f.key)?.sha256 || '';
    db.prepare('INSERT OR REPLACE INTO zoho_check_acks (job_id, key, sha256, by, at) VALUES (?,?,?,?,?)').run(job.id, f.key, sha, req.user?.email || null, now());
    audit(job.id, 'zoho_check_download_confirmed', `${f.module}: downloaded although ${f.rowsWill > 0 ? `${f.rowsWill} of ${f.rows} rows are expected to be refused by Zoho Books${f.rowsMay ? ` and ${f.rowsMay} may be` : ''}` : f.download === 'confirm_date' ? `the Migration Date is not checked in Zoho Books yet (${f.dateRows} opening balances wait for it)` : 'nothing blocks it'}.`);
    return { ok: true, key: f.key, rowsWill: f.rowsWill, rows: f.rows };
  });
}
