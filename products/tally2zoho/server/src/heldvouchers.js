// Vouchers that are in NO Zoho file yet: receipts, payments and notes held because the Zoho module they belong in has
// no import sample in the platform (payments.js SAMPLE_NEEDED), and journals still waiting for routing (none with the
// v2 defaults). They are an open item until a file carries them or they are entered by hand in Zoho Books.
//
//  GET /api/migrations/:id/held-vouchers                  the count written to files and the count in no file, per module
//  GET /api/migrations/:id/held-vouchers/:module.csv      the held vouchers of one module (date, number, party, amount),
//                                                         to enter by hand in Zoho Books if wanted
//  PUT /api/migrations/:id/zoho-samples/:module           Zoho's import sample for that module (CSV or XLSX with a heading
//                                                         row): stored under zoho-samples/received/, audit-logged, and read
//                                                         at once: the answer says whether the file can be built (heldfiles.js).
//  GET /api/migrations/:id/held-vouchers/:module/zoho-file  the file built from that sample (Payments Received and Payments
//                                                         Made; the other two modules stay held, see heldfiles.js)
//
// Every count is read from the voucher control total of the files created last (index.js voucherControl) and the
// held_vouchers table written with those files, so this module, the Export Center, the voucher reconciliation and
// Prepare migration say the same numbers.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SAMPLE_NEEDED, CREDIT_LIST_HEADINGS, creditListRows, creditSummary } from './payments.js';
import { readTable } from './sheet.js';
import { toCsv } from './zoho.js';
import { heldFileState, buildHeldFile, isBuildable, HELD_MODULES } from './heldfiles.js';

const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// Where Zoho's samples live (the official ones in zoho-samples/, received ones in zoho-samples/received/).
export const samplesDir = () => process.env.ZOHO_SAMPLES_DIR || path.join(PROJECT, 'zoho-samples');

const MODULE_LABEL = { invoices: 'Invoices', bills: 'Bills', journals: 'Manual Journals', other_journals: 'Journals of receipts, payments and contras' };
const safeText = v => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
const sum = o => Object.values(o || {}).reduce((t, n) => t + (Number(n) || 0), 0);

export function setupHeldVouchers(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS zoho_sample_uploads (
    id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, module TEXT NOT NULL, file_name TEXT, stored_as TEXT NOT NULL,
    format TEXT, headings TEXT, sha256 TEXT, uploaded_by TEXT, at TEXT)`);
}

// Reads an uploaded sample: CSV or XLSX, whose first row is a heading row (at least two headings, none of them a number
// or a date). Returns { format, headings, rows } or { error }.
export function readSample(buf, fileName = '') {
  const ext = path.extname(String(fileName || '')).toLowerCase();
  if (ext && !['.csv', '.xlsx'].includes(ext)) return { error: 'Upload the sample as Zoho Books gives it: a CSV or XLSX file.' };
  const table = readTable(buf);
  if (table.error) return { error: table.error };
  if (!['csv', 'xlsx'].includes(table.format)) return { error: 'Upload the sample as a CSV or XLSX file. Open an XLS file in Excel and save it as XLSX.' };
  const head = (table.rows[0] || []).map(c => String(c ?? '').trim());
  const filled = head.filter(Boolean);
  const looksLikeValue = h => /^-?[\d.,]+$/.test(h) || /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/.test(h);
  if (filled.length < 2 || filled.some(looksLikeValue)) return { error: 'The first row of the file must be the heading row of Zoho\'s sample (the column names). This file does not start with one.' };
  return { format: table.format, headings: filled, rows: Math.max(0, table.rows.length - 1) };
}

// What is in a file and what is not. control: voucherControl(jobId) or null (no files created).
// Returns { available, written, notInAnyFile, held, awaitingRouting, leftOut, keptWithoutZohoFile, stored, modules: [...] }.
export function heldState(db, jobId, control) {
  if (!control) return { available: false, message: 'No files have been created yet.', written: 0, notInAnyFile: 0, held: 0, modules: [] };
  const written = sum(control.written);
  const held = sum(control.waitingForZohoSample);
  const awaitingRouting = control.awaitingRouting || 0;
  const received = {};
  for (const r of db.prepare('SELECT module, file_name, uploaded_by, at, headings FROM zoho_sample_uploads WHERE job_id = ? ORDER BY id').all(jobId)) {
    received[r.module] = { fileName: r.file_name, by: r.uploaded_by, at: r.at, headings: (() => { try { return JSON.parse(r.headings).length; } catch { return null; } })() };
  }
  const amounts = Object.fromEntries(db.prepare('SELECT file_key, detail FROM held_vouchers WHERE job_id = ?').all(jobId).reduce((m, r) => {
    let a = 0; try { a = Number(JSON.parse(r.detail).amount) || 0; } catch { a = 0; }
    m.set(r.file_key, (m.get(r.file_key) || 0) + a);
    return m;
  }, new Map()));
  const fileStates = heldFileState(db, jobId, Object.keys(SAMPLE_NEEDED).filter(k => control.waitingForZohoSample?.[k]));
  const modules = Object.entries(SAMPLE_NEEDED).filter(([k]) => control.waitingForZohoSample?.[k]).map(([key, s]) => ({
    key, module: s.module, vouchers: control.waitingForZohoSample[key], amount: (amounts[key] || 0).toFixed(2), what: s.what,
    sample: s.sample, importAfter: s.importAfter, importAfterModule: MODULE_LABEL[s.importAfter] || s.importAfter,
    sampleReceived: received[key] || null,
    // what the sample gives: a file ready to download, or the exact reason it cannot be built yet (heldfiles.js)
    file: fileStates[key] || null,
  }));
  return { available: true, stored: control.stored, written, held, awaitingRouting, notInAnyFile: held + awaitingRouting,
    leftOut: control.leftOut || 0, keptWithoutZohoFile: sum(control.keptWithoutZohoFile), modules,
    words: `${written} written to files, ${held + awaitingRouting} not in any file yet` };
}

// ---------- credits to apply (customer and vendor lines of the Manual Journals) ----------
// Read from the journal_credits table written with the files (index.js). Not an import file: a list for the person,
// in the zip under not_for_import/ and on the Import Wizard page "Apply the credits".
export const CREDITS_FILE = 'credits_to_apply.csv';
const JOURNAL_FILE_NAMES = { journals: 'journals.csv', other_journals: 'journals_receipts_payments_contra.csv' };
const creditViews = (db, jobId) => {
  let rows = [];
  try { rows = db.prepare('SELECT detail FROM journal_credits WHERE job_id = ? ORDER BY rowid').all(jobId); } catch { rows = []; }
  return rows.map(r => { try { return JSON.parse(r.detail); } catch { return null; } }).filter(Boolean);
};
// { available, rows, summary (payments.js creditSummary), fileName }
export function creditsState(db, jobId) {
  const views = creditViews(db, jobId);
  const rows = creditListRows(views, k => JOURNAL_FILE_NAMES[k] || k);
  return { available: views.length > 0, rows: rows.length, fileName: CREDITS_FILE, summary: creditSummary(views) };
}
// The CSV (with a byte order mark, so Excel reads the names right), or null when there is no credit.
export function creditsCsv(db, jobId) {
  const views = creditViews(db, jobId);
  if (!views.length) return null;
  const rows = creditListRows(views, k => JOURNAL_FILE_NAMES[k] || k).map(r => Object.fromEntries(CREDIT_LIST_HEADINGS.map(h => [h, safeText(r[h] ?? '')])));
  return '\ufeff' + toCsv(CREDIT_LIST_HEADINGS, rows);
}

// deps: { db, need, audit, now, voucherControl(jobId) }
export function registerHeldVouchers(app, { db, need, audit, now, voucherControl }) {
  setupHeldVouchers(db);
  const actor = req => req.user?.email || 'system';

  app.get('/api/migrations/:id/held-vouchers', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    return heldState(db, job.id, voucherControl(job.id));
  });

  // The credits to apply: the counts, and the first rows for the screen (?limit=, default 200).
  app.get('/api/migrations/:id/credits-to-apply', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const views = creditViews(db, job.id);
    const rows = creditListRows(views, k => JOURNAL_FILE_NAMES[k] || k).map(({ _what, ...r }) => ({ ...r, what: _what }));
    const limit = Math.min(Math.max(Number(req.query?.limit) || 200, 1), 5000);
    return { ...creditsState(db, job.id), headings: CREDIT_LIST_HEADINGS, total: rows.length, list: rows.slice(0, limit) };
  });
  app.get('/api/migrations/:id/credits-to-apply.csv', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const csv = creditsCsv(db, job.id);
    if (!csv) return reply.code(404).send({ error: 'There is no credit to apply: no Manual Journal of the files credits a customer or debits a vendor. Create the files first if you have not.' });
    audit(job.id, 'download', 'credits to apply: the list of journal credits and the invoice or bill each one settles (not an import file)');
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="credits_to_apply_${job.id}.csv"`).send(csv);
  });

  app.get('/api/migrations/:id/held-vouchers/:file', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const key = String(req.params.file || '').replace(/\.csv$/i, '');
    if (!SAMPLE_NEEDED[key]) return reply.code(404).send({ error: `No held vouchers for "${key}". Use one of: ${Object.keys(SAMPLE_NEEDED).join(', ')}.` });
    const rows = db.prepare('SELECT h.number, h.detail, s.slot FROM held_vouchers h LEFT JOIN source_records s ON s.id = h.source_record_id WHERE h.job_id = ? AND h.file_key = ? ORDER BY h.rowid').all(job.id, key)
      .map(r => { let d = {}; try { d = JSON.parse(r.detail || '{}'); } catch { d = {}; } return d; })
      .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.number || '').localeCompare(String(b.number || ''), undefined, { numeric: true }));
    // nothing held for this module (the default: these vouchers are Manual Journals): there is no list, not an empty file
    if (!rows.length) return reply.code(404).send({ error: `No voucher is held for ${SAMPLE_NEEDED[key].module}: every voucher of that kind is in a file.` });
    const head = ['Date', 'Voucher number', 'Party', 'Amount', 'Bank or cash account'];
    const csv = '﻿' + toCsv(head, rows.map(d => ({ Date: d.date || '', 'Voucher number': safeText(d.number || ''), Party: safeText(d.party || ''), Amount: d.amount || '', 'Bank or cash account': safeText(d.bank || '') })));
    audit(job.id, 'download', `${SAMPLE_NEEDED[key].module}: list of ${rows.length} held voucher${rows.length === 1 ? '' : 's'} to enter by hand`);
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="not_in_any_file_${key}_${job.id}.csv"`).send(csv);
  });

  app.put('/api/migrations/:id/zoho-samples/:module', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const key = String(req.params.module || '');
    if (!SAMPLE_NEEDED[key]) return reply.code(404).send({ error: `There is no missing Zoho sample called "${key}".` });
    if (!Buffer.isBuffer(req.body) || !req.body.length) return reply.code(400).send({ error: 'No file received.' });
    const fileName = (() => { try { return decodeURIComponent(String(req.headers['x-filename'] || '')); } catch { return String(req.headers['x-filename'] || ''); } })();
    const read = readSample(req.body, fileName);
    if (read.error) return reply.code(422).send({ error: read.error });
    const dir = path.join(samplesDir(), 'received');
    fs.mkdirSync(dir, { recursive: true });
    const sha = createHash('sha256').update(req.body).digest('hex');
    const storedAs = `${key}_${job.id}_${sha.slice(0, 12)}.${read.format}`;
    fs.writeFileSync(path.join(dir, storedAs), req.body);
    db.prepare('INSERT INTO zoho_sample_uploads (job_id, module, file_name, stored_as, format, headings, sha256, uploaded_by, at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(job.id, key, fileName || null, path.join('received', storedAs), read.format, JSON.stringify(read.headings), sha, actor(req), now());
    const state = heldFileState(db, job.id, [key])[key];
    audit(job.id, 'zoho_sample_received', `${SAMPLE_NEEDED[key].module}: Zoho's import sample received${fileName ? ` ("${fileName}")` : ''}, ${read.headings.length} columns; stored as zoho-samples/received/${storedAs}. ${state?.buildable ? `The file can be built: ${state.vouchers} voucher(s) in ${state.rows} row(s).` : state?.why || 'The file is not built.'}`);
    const message = state?.buildable ? `Sample received. The file for ${SAMPLE_NEEDED[key].module} is ready: ${state.vouchers} voucher(s) in ${state.rows} row(s).`
      : state?.stillHeld ? `Sample received and kept. ${SAMPLE_NEEDED[key].module} stays held: ${state.why}`
        : `Sample received, but the file cannot be built yet. ${state?.why || ''}`;
    return { ok: true, module: SAMPLE_NEEDED[key].module, headings: read.headings.length, file: state, message, held: heldState(db, job.id, voucherControl(job.id)) };
  });

  // The file built from the sample the user uploaded: Payments Received and Payments Made.
  app.get('/api/migrations/:id/held-vouchers/:module/zoho-file', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const key = String(req.params.module || '');
    if (!SAMPLE_NEEDED[key]) return reply.code(404).send({ error: `There is no held module called "${key}".` });
    if (!isBuildable(key)) return reply.code(409).send({ error: `${SAMPLE_NEEDED[key].module} stays held: ${HELD_MODULES[key]?.why_held || 'no file can be built for it yet.'}` });
    const up = db.prepare('SELECT headings FROM zoho_sample_uploads WHERE job_id = ? AND module = ? ORDER BY id DESC LIMIT 1').get(job.id, key);
    if (!up) return reply.code(409).send({ error: `Upload Zoho Books' import sample for ${SAMPLE_NEEDED[key].module} first (${SAMPLE_NEEDED[key].sample}).` });
    let headings = []; try { headings = JSON.parse(up.headings); } catch { headings = []; }
    const details = db.prepare('SELECT detail FROM held_vouchers WHERE job_id = ? AND file_key = ?').all(job.id, key).map(r => { try { return JSON.parse(r.detail || '{}'); } catch { return {}; } });
    const built = buildHeldFile(key, headings, details);
    if (!built.built) return reply.code(409).send({ error: built.reason });
    if (!built.rows) return reply.code(409).send({ error: 'There is no voucher to write for this module.' });
    audit(job.id, 'download', `${SAMPLE_NEEDED[key].module}: file built from the uploaded Zoho sample (${built.vouchers} voucher(s), ${built.rows} row(s))`);
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${key}_from_your_zoho_sample_${job.id}.csv"`).send(built.csv);
  });
}
