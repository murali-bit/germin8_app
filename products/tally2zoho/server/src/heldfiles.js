// Files for the vouchers that were held because Zoho's import sample was missing: Payments Received and Payments Made.
//
// The rule has not changed: no column is invented. The headings written are exactly the headings of the sample the user
// uploads (Zoho Books gives it on the module's Import screen). What this file adds is the step after the upload:
//  1. learn the layout: which heading of the sample carries which meaning (date, party, amount, bank account, invoice or
//     bill number, amount applied ...). The meanings come from Zoho's API and help pages (zohorules.json lists.held_modules,
//     evidence "Zoho documentation"); the words used to recognise a heading are matching hints only.
//  2. build the file: one row per payment, or one row per invoice or bill the payment is applied to when the sample has
//     columns for that. A heading that is not recognised is written empty and shown to the user.
//  3. when a field that the file needs is not found in the sample, nothing is built: the module stays held and the
//     answer says exactly which meaning has no heading.
//
// Vendor Credits and Credit Notes stay held. Each is a document with item or account lines and tax; Zoho's pages do not
// list its import columns, so those lines cannot be placed without a real sample of that module to test against.
//
// Vouchers that carry lines besides the party and the bank (bank charges, tax deducted) stay held too: this file would
// post the party's whole amount to the bank and the trial balance would differ by those lines.
//
// Money is kept as the strings the held list already holds (two decimals); nothing is recalculated here.

import fs from 'node:fs';
import Decimal from 'decimal.js';
import { headingKey } from './sheet.js';
import { toCsv } from './zoho.js';

const RULES = JSON.parse(fs.readFileSync(new URL('./zohorules.json', import.meta.url), 'utf8'));
export const HELD_MODULES = RULES.lists?.held_modules || {};

// The modules a file can be built for (the others are held with the reason given in the rules).
export const BUILDABLE = Object.keys(HELD_MODULES).filter(k => HELD_MODULES[k]?.concepts);
export const isBuildable = key => BUILDABLE.includes(key);

const CODE = { payments_received: 'RCT-', payments_made: 'PMT-' };
const PAYMENT_MODE = 'Others';
const safeText = v => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Which heading of the sample carries which meaning. Exact match on the heading with spaces and signs removed, in the
// order of the concepts; a heading serves one meaning only. Returns:
//  { buildable, columns: [{ heading, concept }], missing: [{ concept, meaning }], notUnderstood: [heading], warnings: [text] }
export function learnLayout(key, headings) {
  const spec = HELD_MODULES[key];
  if (!spec?.concepts) return { buildable: false, columns: [], missing: [], notUnderstood: [], warnings: [], held: true, why: spec?.why_held || 'No Zoho sample layout is known for this module.' };
  const heads = (headings || []).map(h => String(h ?? '').trim()).filter(Boolean);
  const taken = new Map(); // heading index -> concept
  const found = {};
  for (const [id, c] of Object.entries(spec.concepts)) {
    const i = heads.findIndex((h, n) => !taken.has(n) && (c.hints || []).includes(headingKey(h)));
    if (i >= 0) { taken.set(i, id); found[id] = heads[i]; }
  }
  const columns = heads.map((heading, i) => ({ heading, concept: taken.get(i) || null }));
  const missing = Object.entries(spec.concepts)
    .filter(([id, c]) => !found[id] && (c.required || (id === 'applied' && found.document)))
    .map(([id, c]) => ({ concept: id, meaning: c.meaning }));
  const warnings = [];
  if (found.applied && !found.document) warnings.push('The sample has an applied-amount column but no invoice or bill number column, so no payment is linked to a document.');
  if (!found.document) warnings.push(`The sample has no column for the ${key === 'payments_made' ? 'bill' : 'invoice'} number, so every payment is written without being applied to a ${key === 'payments_made' ? 'bill' : 'invoice'}. Apply them in Zoho Books afterwards if you want them linked.`);
  return { buildable: missing.length === 0, columns, found, missing, notUnderstood: columns.filter(c => !c.concept).map(c => c.heading), warnings };
}

// The words that say what is missing, for the screen and the API.
export function missingWords(key, layout) {
  const spec = HELD_MODULES[key];
  if (!layout.missing?.length) return '';
  return `The sample for ${spec.module} has no heading that means: ${layout.missing.map(m => m.meaning.replace(/\s*\(API:[^)]*\)\.?/, '').replace(/\.$/, '')).join('; ')}. `
    + `Headings in the sample: ${layout.columns.map(c => `"${c.heading}"`).join(', ') || '(none)'}. Send the sample exactly as Zoho Books gives it on the Import screen of ${spec.module} (${spec.import_path}).`;
}

// Builds the file of one module from the sample headings and the held vouchers (the `detail` of held_vouchers rows).
// Returns { built: false, reason } or { built: true, csv, rows, vouchers, heldBack: [{ number, why }], notes: [text], columns, notUnderstood }.
export function buildHeldFile(key, headings, details) {
  const spec = HELD_MODULES[key];
  if (!spec?.concepts) return { built: false, reason: spec?.why_held || 'This module is not built.' };
  const layout = learnLayout(key, headings);
  if (!layout.buildable) return { built: false, reason: missingWords(key, layout), layout };
  // a cell is addressed by the POSITION of its column, never by its heading: a sample may repeat a heading
  const col = id => { const i = layout.columns.findIndex(c => c.concept === id); return i < 0 ? null : `c${i}`; };
  const heldBack = [], use = [];
  for (const d of details) {
    const other = (d.flags || []).find(f => f.kind === 'money_voucher_other_lines');
    if (other) heldBack.push({ number: d.number, why: 'It has lines besides the party and the bank or cash account (for example bank charges or tax deducted), which this file cannot carry.' });
    else use.push(d);
  }
  use.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.number || '').localeCompare(String(b.number || ''), undefined, { numeric: true }));
  const rows = [];
  let unappliedVouchers = 0, unappliedTotal = new Decimal(0);
  const put = (row, id, value) => { const h = col(id); if (h) row[h] = value; };
  for (const d of use) {
    const base = {};
    put(base, 'date', d.date || '');
    put(base, 'party', safeText(d.party || ''));
    put(base, 'amount', d.amount || '');
    put(base, 'account', safeText(d.bank || ''));
    put(base, 'mode', PAYMENT_MODE);
    put(base, 'number', `${CODE[key] || ''}${d.number || ''}`);
    put(base, 'reference', safeText(String(d.number || '')));
    const applied = col('document') ? (d.applied || []) : [];
    if (Number(d.unapplied) > 0.004) { unappliedVouchers++; unappliedTotal = unappliedTotal.plus(new Decimal(String(d.unapplied))); }
    if (applied.length) for (const a of applied) { const r = { ...base }; put(r, 'document', safeText(String(a.number || ''))); put(r, 'applied', a.amount || ''); rows.push(r); }
    else rows.push({ ...base });
  }
  const notes = [];
  if (col('mode')) notes.push(`Payment Mode is written as "${PAYMENT_MODE}" on every row, because Tally does not say how the money was paid. Change it in the file if you need another mode.`);
  notes.push('Dates are written as yyyy-mm-dd: choose that date format on the Map Fields page of the import.');
  if (col('number')) notes.push(`The payment number is the Tally voucher number with ${CODE[key]} before it, because Tally numbers each voucher type on its own. The Tally voucher number is also in the reference.`);
  else notes.push('The sample has no payment number column: Zoho Books numbers the payments itself (tick the auto-number option on the Configure page). The Tally voucher number is in the reference when the sample has one.');
  if (col('document')) notes.push(`A payment applied to more than one ${key === 'payments_made' ? 'bill' : 'invoice'} has one row for each, with the same payment number. This layout of the rows was not tested with Zoho Books: try the file with one payment first.`);
  if (unappliedVouchers) notes.push(`${plural(unappliedVouchers, 'payment')} ${unappliedVouchers === 1 ? 'has' : 'have'} a part that is not applied to any ${key === 'payments_made' ? 'bill' : 'invoice'} (${unappliedTotal.toDecimalPlaces(2).toFixed(2)} in all): an advance, money on account, or a document from before the period. Zoho Books keeps that part as an excess payment.`);
  if (heldBack.length) notes.push(`${plural(heldBack.length, 'voucher')} stay${heldBack.length === 1 ? 's' : ''} held, not in this file (they have lines besides the party and the bank): ${heldBack.slice(0, 8).map(h => h.number).join(', ')}${heldBack.length > 8 ? ', ...' : ''}.`);
  for (const w of layout.warnings) notes.push(w);
  if (layout.notUnderstood.length) notes.push(`Columns of the sample that the tool does not fill, left empty: ${layout.notUnderstood.map(h => `"${h}"`).join(', ')}.`);
  const heads = layout.columns.map(c => c.heading);
  const keys = heads.map((_, i) => `c${i}`), keyed = toCsv(keys, rows);
  const csv = '﻿' + toCsv(heads, []) + keyed.slice(keyed.indexOf('\r\n') + 2);
  return { built: true, csv, rows: rows.length, vouchers: use.length, heldBack, notes, columns: layout.columns, notUnderstood: layout.notUnderstood, layout };
}

// What is known about each held module for one migration: whether a sample was given, whether it could be understood,
// and what a file built from it holds. Reads the held_vouchers and zoho_sample_uploads tables.
export function heldFileState(db, jobId, keys) {
  const out = {};
  for (const key of keys) {
    const spec = HELD_MODULES[key];
    if (!spec) continue;
    if (!spec.concepts) { out[key] = { buildable: false, stillHeld: true, why: spec.why_held, importPath: spec.import_path }; continue; }
    const up = db.prepare('SELECT headings, file_name FROM zoho_sample_uploads WHERE job_id = ? AND module = ? ORDER BY id DESC LIMIT 1').get(jobId, key);
    if (!up) { out[key] = { buildable: false, sampleReceived: false, importPath: spec.import_path }; continue; }
    let headings = [];
    try { headings = JSON.parse(up.headings); } catch { headings = []; }
    const details = db.prepare('SELECT detail FROM held_vouchers WHERE job_id = ? AND file_key = ?').all(jobId, key).map(r => { try { return JSON.parse(r.detail || '{}'); } catch { return {}; } });
    const built = buildHeldFile(key, headings, details);
    out[key] = built.built
      ? { sampleReceived: true, buildable: true, rows: built.rows, vouchers: built.vouchers, heldBack: built.heldBack.length, notes: built.notes, notUnderstood: built.notUnderstood, importPath: spec.import_path, fileName: up.file_name }
      : { sampleReceived: true, buildable: false, why: built.reason, notUnderstood: built.layout?.notUnderstood || [], importPath: spec.import_path, fileName: up.file_name };
  }
  return out;
}

// The built files of a migration, for the zip and the download route: [{ key, module, name, data (Buffer), rows, vouchers, notes }].
export function heldFilesOf(db, jobId) {
  const files = [];
  for (const key of BUILDABLE) {
    const up = db.prepare('SELECT headings FROM zoho_sample_uploads WHERE job_id = ? AND module = ? ORDER BY id DESC LIMIT 1').get(jobId, key);
    if (!up) continue;
    let headings = [];
    try { headings = JSON.parse(up.headings); } catch { headings = []; }
    const details = db.prepare('SELECT detail FROM held_vouchers WHERE job_id = ? AND file_key = ?').all(jobId, key).map(r => { try { return JSON.parse(r.detail || '{}'); } catch { return {}; } });
    if (!details.length) continue;
    const built = buildHeldFile(key, headings, details);
    if (built.built && built.rows) files.push({ key, module: HELD_MODULES[key].module, name: `${key}_from_your_zoho_sample.csv`, data: Buffer.from(built.csv, 'utf8'), rows: built.rows, vouchers: built.vouchers, notes: built.notes, importPath: HELD_MODULES[key].import_path, heldBack: built.heldBack.length });
  }
  return files;
}
