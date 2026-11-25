// The Import Wizard: one step per page from "set up the Zoho Books organisation" to "compare the trial balances".
//
// What is said on each step comes from the researched rules (zohorules.json): organisation_setup (the set-up ticks),
// import_order (the order and what each file depends on) and modules.<file> (the click path, the options to choose on
// Zoho's import screens, the columns not to map, the file size Zoho accepts).
//
// Stored per migration, apart from the Tally data:
//  - wizard_state: the step the person is on, so a restart or another browser returns to it;
//  - wizard_ticks: the ticks (set-up items, bank accounts present in Zoho, balances typed by hand, the credits applied,
//    the last checks);
//  - wizard_results: what happened in Zoho for each file (rows imported, rows refused), with the checksum of the file
//    it was said about: when a file is created again with other contents, its result no longer counts;
//  - wizard_overrides: a locked step opened anyway, with the typed reason;
//  - zoho_existing_accounts: the account names of Zoho's own Chart of Accounts export (optional).
// import_status (the Import Tracker's table) is kept in step, so Prepare migration and the reports agree.
//
// Locking: a step is locked until every file it depends on is marked imported with no refused rows (typed here, or
// rows of Zoho's error file not imported again). Ticks, results, overrides and uploads are audit-logged.

import fs from 'node:fs';
import Decimal from 'decimal.js';
import { ALL_FILES, fileLayout } from './extras.js';
import { readTable, headingKey } from './sheet.js';
import { accountNameKey, gstinStateCode, STATE_CODES } from './zohocodes.js';
import { money, jobYear } from './tally.js';
import { zipStore } from './zipstore.js';
import { registerCompletenessTable } from './completenesstable.js';
import { downloadBlockers, downloadBlockedMessage } from './zohocheckapi.js';
import { ZOHO_TAX_POSTING_ACCOUNTS } from './taxposting.js';
import { sectionKeyOf, TDS_ACT_CUTOVER, ACT_WORDS, knownTdsTaxes, actFor } from './tds.js';
import { heldFilesOf } from './heldfiles.js';
import { TDS_NEW_CODES } from './defaults.js';
import { hsnFieldOn } from './vouchers.js';
import { companyGstinForHsn } from './companygst.js';
import { heldState, creditsState, creditsCsv, CREDITS_FILE } from './heldvouchers.js';
import { migrationDateOf } from './zoho.js';
import { openingBalancesFrom } from './decisions.js';
import { identLabelOf } from './zohocheck.js';
import { predictedCsv, PREDICTED_FILE } from './predictedtb.js';
import { setupZohoVerify, VERIFY_KINDS, isVerifyKind, readZohoExport, storeArrived, removeArrived, verifyMaster, missingRowsCsv, filesNamingMissing, expectedMasterRecords } from './zohoverify.js';

export const RULES = JSON.parse(fs.readFileSync(new URL('./zohorules.json', import.meta.url), 'utf8'));
const OPENING_JOURNAL = 'opening_balances_for_zoho_accounts';
const MIN_REASON = 10; // characters of a typed reason to open a locked step

// Account types Zoho keeps in Banking, whose opening balance it refuses in the Chart of Accounts file (rule COA-BANK-NO-OB).
export const BANK_TYPES = (() => {
  const rule = (RULES.modules?.accounts?.rules || []).find(r => r.id === 'COA-BANK-NO-OB');
  const v = rule?.params?.when?.value;
  return Array.isArray(v) && v.length ? v : ['Bank', 'Credit Card', 'Cash'];
})();

const ZERO = new Decimal(0);
const dec = v => { const s = String(v ?? '').replace(/,/g, '').trim(); if (!s) return ZERO; try { return new Decimal(s); } catch { return ZERO; } };
const list = words => (words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pathParts = where => String(where || '').split(/\s*;\s*/).map(p => p.split(/\s*>\s*/).map(x => x.trim()).filter(Boolean)).filter(p => p.length);
// "A. B. C." -> ['A.', 'B.', 'C.']: one line per sentence of the rules' text
const sentences = text => String(text || '').split(/(?<=\.)\s+(?=[A-Z+])/).map(s => s.trim()).filter(Boolean);
const isExplanation = s => /^(Zoho then|It is|It can)\b/.test(s);
const niceDate = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };

// The TDS taxes the Bills and Invoices files name (TDS Name, TDS Percentage, TDS Section Code), for the set-up guide
// "TDS taxes to create in Zoho Books": name, rate, section code, tax act and start date, and whether the organisation's
// own TDS export (when given) already has that tax. Read from the rows of the files as created, so the list is exactly
// what the files need. exportGiven false: Zoho's TDS export was not given, so it is not known what Zoho has.
export function tdsTaxesInFiles(db, jobId, job) {
  const found = new Map();
  for (const key of ['bills', 'invoices']) {
    let rows = [];
    try { rows = db.prepare('SELECT row_no, source_record_id, source_id, row_data, ident FROM generated_rows WHERE job_id = ? AND key = ? ORDER BY row_no').all(jobId, key); } catch { rows = []; }
    if (!rows.length) continue;
    const layout = fileLayout(db, jobId, key);
    for (const g of rows) {
      const v = layout.values(g);
      const name = String(v.tds_name ?? '').trim();
      if (!name) continue;
      const rate = String(v.tds_percentage ?? '').trim(), section = String(v.tds_section_code ?? '').trim();
      const k = [name, rate, section].join('|');
      if (!found.has(k)) found.set(k, { name, rate, section, rows: 0, onBills: false, onInvoices: false, dates: new Set() });
      found.get(k).rows++;
      found.get(k).dates.add(String((key === 'bills' ? v.bill_date : v.invoice_date) ?? '').trim().slice(0, 10));
      found.get(k)[key === 'bills' ? 'onBills' : 'onInvoices'] = true;
    }
  }
  let exported = null;
  try { exported = db.prepare('SELECT 1 FROM zoho_tds_taxes_meta WHERE job_id = ?').get(jobId) ? db.prepare('SELECT name, rate, section, sales_account, purchase_account, start_date start, end_date end, status FROM zoho_tds_taxes WHERE job_id = ?').all(jobId).map(t => ({ ...t, start: t.start || '', end: t.end || '', status: t.status || '' })) : null; }
  catch {
    // a table from before the account columns existed: the accounts are then not known
    try { exported = db.prepare('SELECT 1 FROM zoho_tds_taxes_meta WHERE job_id = ?').get(jobId) ? db.prepare('SELECT name, rate, section, start_date start, end_date end, status FROM zoho_tds_taxes WHERE job_id = ?').all(jobId).map(t => ({ ...t, start: t.start || '', end: t.end || '', status: t.status || '' })) : null; }
    catch { try { exported = db.prepare('SELECT 1 FROM zoho_tds_taxes_meta WHERE job_id = ?').get(jobId) ? db.prepare('SELECT name, rate, section FROM zoho_tds_taxes WHERE job_id = ?').all(jobId) : null; } catch { exported = null; } }
  }
  const from = jobYear(job)?.from || '';
  let settings = {};
  try { settings = { tdsAct: JSON.parse(db.prepare('SELECT extra FROM voucher_settings WHERE job_id = ?').get(jobId)?.extra || '{}')?.tdsAct || 'auto' }; } catch { settings = {}; }
  const sameNumber = (a, b) => a !== '' && b !== '' && Number(a) === Number(b);
  const same = t => x => x.name.toLowerCase() === t.name.toLowerCase() && sameNumber(String(x.rate).replace('%', ''), t.rate) && sectionKeyOf(x.section) === sectionKeyOf(t.section);
  const taxes = [...found.values()].map(({ dates, ...t }) => {
    // TDS-001: the act of the tax from the dates of the documents that name it (the section form follows the act the
    // generator chose by the same date); an empty or unknown section no longer means the new act
    const ds = [...dates].filter(Boolean).sort();
    // with no date on the rows (an older stored file) the form of the section says it
    const act = ds.length ? actFor(ds[0], settings.tdsAct) : TDS_NEW_CODES.has(String(t.section).toLowerCase()) ? 'new' : /^19[2-6][A-Z]{0,3}$/i.test(t.section) ? 'old' : actFor(from, settings.tdsAct);
    // TDS-003: a tax of the export counts only when it is valid on every date of the documents naming it and is not
    // Inactive; otherwise it is to create, with the reason
    const twin = exported ? exported.find(same(t)) : null;
    const fits = x => !/inactive/i.test(String(x.status || '')) && ds.every(d => (!x.start || x.start <= d) && (!x.end || d <= x.end));
    const match = exported ? exported.filter(same(t)).find(fits) || null : null;
    const notValid = twin && !match ? (/inactive/i.test(String(twin.status || '')) ? 'inactive' : twin.start && ds[0] && ds[0] < twin.start ? 'starts after' : 'ends before') : '';
    // the one list of taxes that exist (tds.js knownTdsTaxes, TDS-011): the export, and Zoho's default taxes on the dates
    // they are valid for. A default tax valid on every date of the rows naming it is in Zoho already: never to create.
    const onEveryDate = [...dates].every(d => knownTdsTaxes(exported, d).filter(k => k.evidence === 'zoho_default').some(same(t)));
    const zohoDefault = onEveryDate && !match;
    const inZoho = exported ? (!!match || zohoDefault) : (zohoDefault ? true : null);
    // The accounts the tax must post to: Zoho's own TDS Payable and TDS Receivable (the default of every TDS tax). The
    // files enter the Tally TDS ledgers on those accounts, so a tax linked to another account would split the balance.
    // accountDiffers: what the organisation's export says when it names another account for a side the files use; an
    // export without the account columns says nothing (not known is never a mismatch).
    const A = ZOHO_TAX_POSTING_ACCOUNTS;
    const differs = (found, wanted) => (found && accountNameKey(found) !== accountNameKey(wanted) ? found : '');
    const accountDiffers = match ? [t.onBills ? differs(match.purchase_account, A.tdsPayable) : '', t.onInvoices ? differs(match.sales_account, A.tdsReceivable) : ''].filter(Boolean) : [];
    return { ...t, act, actWords: ACT_WORDS[act], startDate: act === 'new' ? TDS_ACT_CUTOVER : from, inZoho,
      ...(notValid ? { notValid, notValidWords: notValid === 'inactive' ? 'the tax in your Zoho export is Inactive' : notValid === 'starts after' ? 'the tax in your Zoho starts after your first document that uses it' : 'the tax in your Zoho ends before your last document that uses it' } : {}), ...(zohoDefault ? { zohoDefault: true } : {}), payableAccount: A.tdsPayable, receivableAccount: A.tdsReceivable, accountDiffers };
  }).sort((a, b) => a.name.localeCompare(b.name) || Number(a.rate) - Number(b.rate));
  return { taxes, exportGiven: !!exported, toCreate: taxes.filter(t => t.inZoho !== true).length };
}

// What the generated rows say about the company, for the set-up guide: parties outside India or in an SEZ, parties under
// the composition scheme, bills that carry reverse charge. Counted from the rows (never from names), so the guide fits
// every company. rows: { customers: [{ treatment }], vendors: [{ treatment }], bills: [{ doc, reverseCharge }] }.
export function companyFactsOf(rows) {
  const has = (list, re) => (list || []).filter(r => re.test(String(r.treatment || ''))).length;
  const reverseDocs = new Set((rows.bills || []).filter(r => r.reverseCharge).map(r => r.doc));
  return {
    overseas: { customers: has(rows.customers, /^overseas$/i), vendors: has(rows.vendors, /^overseas$/i) },
    sez: { customers: has(rows.customers, /sez/i), vendors: has(rows.vendors, /sez/i) },
    composition: { customers: has(rows.customers, /composition/i), vendors: has(rows.vendors, /composition/i) },
    reverseChargeBills: reverseDocs.size,
    // reverse charge bills of a vendor with no state: Tally does not say whether the vendor is overseas
    reverseChargeNoState: new Set((rows.bills || []).filter(r => r.reverseCharge && r.noState).map(r => r.doc)).size,
  };
}

// The words of the dynamic hints of the set-up steps, from the facts above and the migration's own data (state of the
// GSTIN, financial year, TDS taxes the files need). Returns { profile: [text], gst: [text], tds: [text] }.
export function setupHints({ job, fy, facts, tds }) {
  const out = { profile: [], gst: [], tds: [] };
  const code = job?.gstin ? gstinStateCode(job.gstin) : '';
  if (code) out.profile.push(`The GSTIN of this migration starts with the state code of ${STATE_CODES[code]}, so set the state of the organisation to ${STATE_CODES[code]}.`);
  const outside = facts.overseas.customers + facts.overseas.vendors + facts.sez.customers + facts.sez.vendors;
  if (outside) {
    const parts = [['customer', facts.overseas.customers + facts.sez.customers], ['vendor', facts.overseas.vendors + facts.sez.vendors]].filter(([, n]) => n);
    out.gst.push(`${parts.map(([w, n]) => plural(n, w)).join(' and ')} in these files ${outside === 1 ? 'is' : 'are'} outside India or in an SEZ: tick SEZ / Overseas Trading, and choose any expense account as the Custom Duty Tracking Account (Zoho Books will not save without it).`);
  } else out.gst.push('No customer or vendor in these files is outside India or in an SEZ. Leave SEZ / Overseas Trading unticked, unless your business needs it for another reason (then Zoho Books also asks for a Custom Duty Tracking Account: choose any expense account).');
  if (facts.reverseChargeBills) out.gst.push(`${plural(facts.reverseChargeBills, 'bill')} in these files carry${facts.reverseChargeBills === 1 ? 'es' : ''} reverse charge GST: tick Reverse Charge.`);
  else out.gst.push('No bill in these files uses reverse charge. Tick Reverse Charge only if your business needs it.');
  const comp = facts.composition.customers + facts.composition.vendors;
  if (comp) out.gst.push(`${plural(comp, 'party', 'parties')} in these files ${comp === 1 ? 'is' : 'are'} under the composition scheme. That is about them, not about you: choose Composition Scheme in GST Settings only if your own business is under it.`);
  if (fy?.from) {
    const old = fy.from < TDS_ACT_CUTOVER;
    out.tds.push(old
      ? `This migration's financial year starts on ${niceDate(fy.from)}, before ${niceDate(TDS_ACT_CUTOVER)}: choose the Old Income Tax Act 1961 and set every start date on or before ${niceDate(fy.from)}.`
      : `This migration's financial year starts on ${niceDate(fy.from)}, on or after ${niceDate(TDS_ACT_CUTOVER)}: the New Income Tax Act 2025 (the default in Zoho Books) fits.`);
  }
  if (tds?.taxes.length) {
    const A = ZOHO_TAX_POSTING_ACCOUNTS;
    out.tds.push(`Leave the accounts of every TDS tax as Zoho Books sets them: TDS Payable Account "${A.tdsPayable}" and TDS Receivable Account "${A.tdsReceivable}". The files enter Tally's TDS ledgers on these two accounts, because Zoho Books posts the TDS of each bill and invoice there.`);
    const wrong = tds.taxes.filter(t => t.accountDiffers?.length);
    if (wrong.length) out.tds.push(`Check before you import: in the TDS export you gave, ${wrong.map(t => `"${t.name}" posts to "${t.accountDiffers.join('" and "')}"`).join('; ')}. Change ${wrong.length === 1 ? 'it' : 'them'} back to "${A.tdsPayable}" (bills) and "${A.tdsReceivable}" (invoices) in Income TDS Rates, or Zoho's trial balance will not match Tally on these accounts.`);
  }
  if (tds) {
    if (!tds.taxes.length) out.tds.push('No bill or invoice in these files carries TDS, so no TDS tax has to be created for this migration.');
    else out.tds.push(`${plural(tds.taxes.length, 'TDS tax', 'TDS taxes')} ${tds.taxes.length === 1 ? 'is' : 'are'} named in the files${tds.exportGiven ? `; ${tds.toCreate} of them ${tds.toCreate === 1 ? 'is' : 'are'} not in the TDS export you gave` : ' (give the TDS export of your organisation before you download: without it the tool only knows six of the taxes a new organisation has, so it cannot see a tax with the same name and another rate, which Zoho Books refuses)'}. The list "TDS taxes to create" below has the name, rate, section code and start date of each.`);
  }
  return out;
}

export function setupImportWizard(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wizard_state (job_id TEXT PRIMARY KEY, current_step TEXT, updated_by TEXT, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS wizard_ticks (job_id TEXT NOT NULL, step TEXT NOT NULL, item TEXT NOT NULL, value TEXT, done_by TEXT, at TEXT, PRIMARY KEY (job_id, step, item));
    CREATE TABLE IF NOT EXISTS wizard_results (job_id TEXT NOT NULL, key TEXT NOT NULL, imported INTEGER, refused INTEGER, file_sha TEXT, recorded_by TEXT, at TEXT, PRIMARY KEY (job_id, key));
    CREATE TABLE IF NOT EXISTS wizard_overrides (job_id TEXT NOT NULL, step TEXT NOT NULL, reason TEXT NOT NULL, blocked_by TEXT, decided_by TEXT, at TEXT, PRIMARY KEY (job_id, step));
    CREATE TABLE IF NOT EXISTS zoho_existing_accounts (job_id TEXT NOT NULL, name TEXT NOT NULL, account_type TEXT, PRIMARY KEY (job_id, name));
    CREATE TABLE IF NOT EXISTS zoho_existing_accounts_meta (job_id TEXT PRIMARY KEY, file_name TEXT, accounts INTEGER, uploaded_by TEXT, at TEXT);
  `);
  // what Zoho Books holds AFTER an import (its own export of accounts, customers, vendors or items): zohoverify.js
  setupZohoVerify(db);
}

// ---------- the accounts the Zoho Books organisation already has ----------
// For the code that builds the files: the names of the accounts that exist in the new organisation.
//  source 'uploaded': read from Zoho's own Chart of Accounts export, given in the wizard's first step (certain);
//  source 'default': the researched list of accounts Zoho creates (zohorules.json lists.default_accounts with
//    exists_by_default "yes"), used while no export was uploaded.
// Returns { source, names: [name], accounts: [{ name, accountType }], fileName, uploadedAt, uploadedBy }.
export function zohoExistingAccounts(db, jobId) {
  const meta = db.prepare('SELECT * FROM zoho_existing_accounts_meta WHERE job_id = ?').get(jobId);
  if (meta) {
    const accounts = db.prepare('SELECT name, account_type accountType FROM zoho_existing_accounts WHERE job_id = ? ORDER BY rowid').all(jobId);
    return { source: 'uploaded', names: accounts.map(a => a.name), accounts, fileName: meta.file_name, uploadedAt: meta.at, uploadedBy: meta.uploaded_by };
  }
  const accounts = (RULES.lists?.default_accounts || []).filter(a => a.exists_by_default === 'yes').map(a => ({ name: a.name, accountType: a.account_type || null }));
  return { source: 'default', names: accounts.map(a => a.name), accounts, fileName: null, uploadedAt: null, uploadedBy: null };
}

// Reads Zoho's Chart of Accounts export (CSV, XLSX or XLS): the heading row is the first of the first 20 rows with an
// "Account Name" column. Returns { accounts: [{ name, accountType }] } or { error }.
export function readZohoAccounts(buf) {
  const table = readTable(buf);
  if (table.error) return { error: table.error };
  const NAME = ['accountname', 'account'], TYPE = ['accounttype', 'type'];
  let headerRow = -1, nameIndex = -1;
  for (const want of NAME) {
    headerRow = table.rows.slice(0, 20).findIndex(r => r.some(c => headingKey(c) === want));
    if (headerRow >= 0) { nameIndex = table.rows[headerRow].findIndex(c => headingKey(c) === want); break; }
  }
  if (headerRow < 0) return { error: 'The file has no "Account Name" column. Export it from Zoho Books: Accountant > Chart of Accounts > More > Export Chart of Accounts.' };
  const typeIndex = table.rows[headerRow].findIndex(c => TYPE.includes(headingKey(c)));
  const seen = new Set(), accounts = [];
  for (const r of table.rows.slice(headerRow + 1)) {
    const name = String(r[nameIndex] ?? '').trim();
    if (!name || seen.has(accountNameKey(name))) continue;
    seen.add(accountNameKey(name));
    accounts.push({ name, accountType: typeIndex >= 0 ? String(r[typeIndex] ?? '').trim() || null : null });
  }
  if (!accounts.length) return { error: 'The file has an "Account Name" column but no account in it.' };
  return { accounts, format: table.format };
}

// What to know while importing (zohorules.json general.while_importing): the lessons of the test imports that are
// about the import itself, not about a value of the file. key: a file key, to get the entries about that file first and
// then the general ones (modules null); no key: every entry, in the order of the rules.
export function whileImporting(key = null) {
  const all = (RULES.general?.while_importing?.entries || []).filter(e => e && e.id && e.text);
  if (key == null) return all;
  return [...all.filter(e => Array.isArray(e.modules) && e.modules.includes(key)), ...all.filter(e => !Array.isArray(e.modules))];
}

// The months of a financial year in the words of Zoho's Fiscal Year list ("April - March"), from its first and last
// day (yyyy-MM-dd). Empty when the dates are not known.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function fiscalYearWords(fy) {
  const m = d => { const x = /^\d{4}-(\d{2})-\d{2}$/.exec(String(d || '')); return x ? MONTHS[Number(x[1]) - 1] || '' : ''; };
  const from = m(fy?.from), to = m(fy?.to);
  return from && to ? `${from} - ${to}` : '';
}

/// ---------- what the rules say about importing one file ----------
// { zohoModule, clicks: [{ text, option, label?, value? }] (the whole click path, in order; option: something to choose
//   on Zoho's import screen), defaults: [text] (what to leave as it is when the path does not say), notes: [{ label,
//   value, why, others }] (why an option is chosen, and the other choices Zoho offers), doNotMap: [headings],
//   mustExistFirst: [text], maxFileMb, idColumn, oneRowIs }
export function importGuide(key, headings = null) {
  const m = RULES.modules?.[key] || {};
  const clicks = (Array.isArray(m.click_path) ? m.click_path : []).map(raw => {
    const text = String(raw);
    const i = text.indexOf(':');
    if (i > 0) return { text, option: true, label: text.slice(0, i).trim(), value: text.slice(i + 1).trim() };
    return { text, option: /not ticked|\(duplicates\)/i.test(text) };
  });
  const says = re => clicks.some(c => re.test(c.text));
  const defaults = [];
  if (!says(/encoding/i)) defaults.push('Character Encoding: UTF-8 (Unicode)');
  if (!says(/delimiter/i)) defaults.push('File Delimiter: Comma');
  // why an option is chosen: matched to the line of the click path that names it (most words in common)
  const notes = [];
  const options = m.options && typeof m.options === 'object' ? m.options : {};
  for (const [name, o] of Object.entries(options)) {
    if (!o || typeof o !== 'object') continue;
    const words = name.split('_').filter(w => w.length > 3);
    const score = c => words.filter(w => c.text.toLowerCase().includes(w)).length;
    const best = clicks.filter(c => c.option).sort((a, b) => score(b) - score(a))[0];
    const hit = best && score(best) >= Math.max(1, Math.ceil(words.length / 2)) ? best : null;
    const others = Array.isArray(o.choices) ? o.choices.filter(x => x !== o.recommended) : [];
    const why = [o.why, o.how_duplicates_are_found ? `Duplicates are found ${o.how_duplicates_are_found}.` : ''].filter(Boolean).join(' ') || null;
    const label = hit ? hit.label || hit.text : name.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
    const value = hit ? hit.value || '' : o.recommended === false ? 'NOT ticked' : typeof o.recommended === 'string' ? o.recommended : '';
    if (hit || value) notes.push({ label, value, why, others, inPath: !!hit });
  }
  // columns the rules say must not be in the file or mapped: only those this file really has
  const forbidden = (m.rules || []).filter(r => r.kind === 'forbidden' && r.params?.target === 'headings').flatMap(r => r.columns || []);
  const present = headings ? forbidden.filter(h => headings.some(x => headingKey(x) === headingKey(h))) : forbidden;
  return { zohoModule: m.zoho_module || null, label: m.label || ALL_FILES[key]?.module || key, clicks, defaults, notes, doNotMap: [...new Set(present)],
    // what to know while importing this file (general.while_importing): the entries about this file, then the general ones
    tips: whileImporting(key).map(e => ({ id: e.id, text: e.text, evidence: e.evidence || null, general: !e.modules })),
    // idColumn: what identifies one record. A journal: its whole number, "Journal Number" (prefix and suffix together)
    mustExistFirst: Array.isArray(m.must_exist_first) ? m.must_exist_first : [], maxFileMb: m.max_file_mb ?? null, idColumn: identLabelOf(key) || m.id_column || null, oneRowIs: m.one_row_is || null, sourceUrl: m.source_url || null };
}

// The order of the steps, from the rules: set-up first, then every import_order entry that applies.
// Returns [{ id, kind: 'setup' | 'file' | 'bank' | 'date' | 'opening' | 'finish', key?, needs: [file key], rule }].
export function stepPlan(fileKeys) {
  const order = Array.isArray(RULES.import_order) ? RULES.import_order : [];
  const has = k => fileKeys.includes(k);
  const plan = [{ id: 'setup', kind: 'setup', needs: [] }];
  for (const o of order) {
    if (o.kind === 'setup') continue;
    if (o.kind === 'import' && has(o.module)) plan.push({ id: o.module, kind: 'file', key: o.module, needs: (o.needs || []).filter(has), rule: o });
    else if (o.kind === 'check' && /bank/i.test(o.what || '') && has('accounts')) plan.push({ id: 'bank', kind: 'bank', needs: ['accounts'], rule: o });
    // Zoho's "opening balances" entry: the tool's opening balance journal, and the list to type when it is refused
    else if (o.kind === 'entry' && o.module === 'opening_balances') plan.push({ id: 'opening', kind: 'opening', key: has(OPENING_JOURNAL) ? OPENING_JOURNAL : null, needs: ['accounts'].filter(has), rule: o });
    // the Migration Date: saved in Zoho Books right after the accounts and before every other file. It dates every
    // opening balance that is not in a journal (state() drops the step when no file carries such a balance)
    else if (o.kind === 'date' && (has('accounts') || has('customers') || has('vendors'))) plan.push({ id: 'date', kind: 'date', needs: ['accounts'].filter(has), rule: o });
    else if (o.kind === 'check' && !/bank/i.test(o.what || '')) plan.push({ id: 'finish', kind: 'finish', needs: [], rule: o });
  }
  // a file the rules do not place (a module added later): after the last file step, so it is never lost
  const placed = new Set(plan.map(p => p.key).filter(Boolean));
  const at = () => { const i = plan.findIndex(p => p.kind === 'finish'); return i < 0 ? plan.length : i; };
  for (const k of fileKeys) if (!placed.has(k) && !ALL_FILES[k]?.referenceOnly) plan.splice(at(), 0, { id: k, kind: 'file', key: k, needs: ['accounts'].filter(x => has(x) && x !== k), rule: null });
  if (!plan.some(p => p.kind === 'finish')) plan.push({ id: 'finish', kind: 'finish', needs: [], rule: null });
  return plan;
}

// The plan of a migration's files: stepPlan, where a Bills or Invoices file whose rows name no item does not wait for
// the Items file (an account line needs only the account). The ONE import order: index.js importList, Prepare
// migration, the test report and the dashboard read it too.
export function planFor(db, jobId, fileKeys) {
  const usesItems = key => {
    if (!fileKeys.includes(key)) return false;
    try {
      const layout = fileLayout(db, jobId, key);
      return db.prepare('SELECT row_no, source_record_id, source_id, row_data, ident FROM generated_rows WHERE job_id = ? AND key = ?').all(jobId, key).some(g => String(layout.values(g).item_name ?? '').trim() !== '');
    } catch { return true; }
  };
  return stepPlan(fileKeys).map(p => (p.kind === 'file' && ['bills', 'invoices'].includes(p.key) && p.needs.includes('items') && !usesItems(p.key)
    ? { ...p, needs: p.needs.filter(n => n !== 'items'), itemsNotNeeded: true } : p));
}

// import_status follows the Import Wizard's results, so the Import Tracker's list, Prepare migration and the reports
// agree. Creating the files again clears import_status; a result recorded for a file that came out unchanged still
// counts. Called when the files are created and when a result is recorded (never by a GET).
// expected: the records the file holds (expectedRecords), when known. A result that accounts for FEWER records than
// the file has, with nothing refused, is not "imported": Zoho left records out without saying so (in a test import
// its preview said every customer was ready and it created one fewer). It is 'partial' until the missing records are
// found (Zoho's export, zohoverify.js) or the result is recorded again.
const statusFor = (imported, refused, expected = null) => (refused === 0 ? (expected != null && imported < expected ? 'partial' : 'imported') : imported > 0 ? 'partial' : 'failed');

// The records Zoho Books must show after one file is imported, counted from the file as created:
//  - Customers, Vendors, Items: the different names (one row is one record);
//  - Bills: the different bills (number AND vendor); Invoices and the journal files: the different documents;
//  - the opening balance journal: its journals (OB-1, and OB-2 when contacts have advances);
//  - Chart of Accounts: null. Zoho skips an account it already has as a duplicate, so a lower figure is expected there
//    and says nothing (the check of that file is Zoho's own export, zohoverify.js).
const MASTER_COUNTED = ['customers', 'vendors', 'items'];
export function expectedRecords(db, jobId, key) {
  try {
    if (MASTER_COUNTED.includes(key)) return expectedMasterRecords(db, jobId, key);
    if (key === 'accounts') return null;
    if (key === 'bills') return db.prepare("SELECT COUNT(DISTINCT ident || char(1) || COALESCE(json_extract(row_data, '$.vendor_name'), '')) n FROM generated_rows WHERE job_id = ? AND key = ?").get(jobId, key).n;
    if (key === OPENING_JOURNAL) return db.prepare("SELECT COUNT(DISTINCT COALESCE(json_extract(row_data, '$.journal_number_prefix'), '') || COALESCE(json_extract(row_data, '$.journal_number_suffix'), '')) n FROM generated_rows WHERE job_id = ? AND key = ?").get(jobId, key).n;
    if (/line/i.test(RULES.modules?.[key]?.one_row_is || '')) return db.prepare('SELECT COUNT(DISTINCT ident) n FROM generated_rows WHERE job_id = ? AND key = ?').get(jobId, key).n;
  } catch { return null; }
  return null;
}
// The status of a recorded result. For a master file Zoho's own export decides when it was given (zohoverify.js): every
// record there means imported, whatever figure was typed (a second import with Skip Duplicates shows a small figure);
// a record missing there means 'partial'.
export function resultStatus(db, jobId, key, imported, refused) {
  let expected = expectedRecords(db, jobId, key);
  if (isVerifyKind(key)) {
    let state = 'not_given';
    try { state = verifyMaster(db, jobId, key).state; } catch { state = 'not_given'; }
    if (state === 'missing' && refused === 0) return 'partial';
    if (state === 'all_there') expected = null;
  }
  return statusFor(imported, refused, expected);
}
export function syncImportStatus(db, jobId) {
  const files = Object.fromEntries(db.prepare('SELECT key, sha256 FROM generated_files WHERE job_id = ?').all(jobId).map(f => [f.key, f]));
  const status = Object.fromEntries(db.prepare('SELECT * FROM import_status WHERE job_id = ?').all(jobId).map(r => [r.key, r]));
  for (const r of db.prepare('SELECT * FROM wizard_results WHERE job_id = ?').all(jobId)) {
    const f = files[r.key];
    if (!f || f.sha256 !== r.file_sha) continue;
    if (['imported', 'partial', 'failed'].includes(status[r.key]?.status)) continue;
    const s = resultStatus(db, jobId, r.key, r.imported, r.refused);
    db.prepare('INSERT OR REPLACE INTO import_status VALUES (?,?,?,?,?)').run(jobId, r.key, s, s === 'imported' ? '' : `${r.imported} imported, ${r.refused} refused`, r.at);
  }
}

// READ_ME_FIRST.txt of the zip: everything to do in Zoho Books before the first import, in plain words, written from
// this company's own data (state of the GSTIN, financial year, the TDS taxes the files name, parties outside India,
// reverse charge, the HSN/SAC answer, the Migration Date) and the set-up text of the rules. Nothing here is fixed text
// about one company. s: the wizard state (state()).
// extra: { assumptions } (GET assumptions: the defaults the tool used where nobody decided), printed as a short list.
export function readMeFirst(job, s, held = [], extra = {}) {
  const out = [`Read this first: ${job.company}, financial year ${job.financial_year}`, '',
    'Do these things in Zoho Books before you import the first file. The Import Wizard in the tool shows the same list with a tick box for each line, and the file READ_ME_IMPORT_ORDER.txt gives the order of the files.', ''];
  const setup = s.steps.find(x => x.kind === 'setup');
  let n = 0;
  for (const item of setup?.items || []) {
    n++;
    out.push(`${n}. ${item.what}`);
    if (item.paths?.length) out.push(`   Where: ${item.paths.map(p => p.join(' > ')).join('; ')}`);
    for (const note of item.notes || []) out.push(`   Note: ${note}`);
    for (const h of item.hints || []) out.push(`   For this company: ${h}`);
    for (const t of item.ticks || []) out.push(`   [ ] ${t.text}`);
    for (const l of item.lines || []) out.push(`   ${l}${/export tds taxes/i.test(l) ? ' (the tool reads it in the Import Wizard, step "Set up Zoho Books")' : ''}`);
    if (item.tdsToCreate?.taxes?.length) {
      out.push('   TDS taxes to create (name, rate, section code, tax act, start date):');
      for (const t of item.tdsToCreate.taxes.filter(x => x.inZoho !== true)) out.push(`   - ${t.name}: ${t.rate}%, ${t.section}, ${t.actWords}, start ${niceDate(t.startDate) || 'on or before the first day of the financial year'}`);
    }
    out.push('');
  }
  for (const q of setup?.questions || []) {
    out.push(`Question for you: ${q.text}`, `   ${q.help}`, `   Answered in the tool: ${q.options.find(o => o.id === q.value)?.label || q.value}`, '');
  }
  const date = s.steps.find(x => x.kind === 'date');
  if (date) {
    n++;
    out.push(`${n}. Migration Date (the Opening Balance Date of Zoho Books). DO NOT SKIP THIS.`, ...dateStepLines(date).map(l => `   ${l}`), '');
  }
  out.push(...held);
  out.push(...assumptionLines(extra.assumptions));
  out.push(...whileImportingLines());
  return out;
}

// "While you import": every entry of general.while_importing, one line each (both READ_ME files print it).
export function whileImportingLines() {
  const list = whileImporting();
  if (!list.length) return [];
  return ['While you import', ...list.map(e => `   - ${e.text}`), ''];
}

// "Assumptions the tool made": the defaults the tool used because nobody decided (GET assumptions), so the accountant
// sees them before the import. Counts and plain words only; where to change each one is in the tool.
export function assumptionLines(a) {
  const list = Array.isArray(a?.assumptions) ? a.assumptions.filter(x => x && x.title) : [];
  if (!a?.available || !list.length) return [];
  const out = ['Assumptions the tool made', `   Where nobody made a decision, the tool used a safe default so the files can be imported. ${list.length === 1 ? 'This one is' : `These ${list.length} are`} in the files. Each can be changed in the tool (Prepare migration or the Export Center, "Assumptions the tool made"); then create the files again.`];
  for (const x of list) out.push(`   - ${x.title} (${x.count}): ${x.words}${x.blocking ? ' Zoho Books would still refuse these rows.' : x.check ? ' Please check.' : ''}${x.unconfirmed ? ' Not confirmed by a Zoho import yet.' : ''}`);
  out.push('');
  return out;
}

// The Migration Date step in plain lines, for both READ_ME files of the zip: what depends on the date (counts per file,
// from this migration's own files), what happens when it is skipped, and exactly what to do. date: the wizard's date step.
export function dateStepLines(date) {
  const deps = (date.dependsOn || []).map(d => `${plural(d.rows, 'opening balance')} in ${d.module}`);
  const out = [
    `The Migration Date of this migration is ${date.date.nice}.`,
    `Zoho Books keeps ONE Opening Balance Date for every opening balance that is not in a journal. In these files that is ${list(deps) || 'no balance'}.`,
    'If you skip this step, Zoho Books dates those balances on the day the organisation was made, after every voucher: they are then missing from the trial balance of the year, and it will not match Tally.',
    'Zoho Books does not let the date be changed once customer or vendor opening balances exist. So do this right after the Chart of Accounts import and before every other file.',
    'Where: Settings > Setup & Configurations > Opening Balances',
  ];
  if (date.mode === 'edit') out.push('The Chart of Accounts import has created the opening balance record. Click Edit, change the date to the Migration Date, type NO balance, click Continue, check that the balance listed is unchanged, and click Confirm.');
  else out.push(`Zoho Books does not save the date while every balance is 0, and no balance of this migration is in the Chart of Accounts file. Set the date to the Migration Date and type this ONE balance: ${(date.balancesToType || []).map(b => `"${b.account}" ${b.amount} ${b.side}`).join('; ') || 'the balance the Import Wizard shows'}. It is in no file, so it is not counted twice. Click Continue and Confirm.`);
  out.push(`Then open the page again, read the date it shows, and type it in the Import Wizard (step "Save the Migration Date"). The wizard opens the other files only when that date is ${date.date.nice}.`,
    `The opening balance journal is dated ${date.date.nice} in its own file, so its balances do not depend on this step.`);
  return out;
}

// A date as a person types or pastes it, to yyyy-MM-dd: 2025-03-31, 31/03/2025, 31-03-2025, 31.03.2025, 31 Mar 2025.
// Day first (the India format); null when it is not a real date.
export function readTypedDate(text) {
  const s = String(text ?? '').trim();
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  let y, m, d, hit;
  if ((hit = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) [y, m, d] = [hit[1], hit[2], hit[3]].map(Number);
  else if ((hit = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(s))) [d, m, y] = [hit[1], hit[2], hit[3]].map(Number);
  else if ((hit = /^(\d{1,2})[\s-]+([A-Za-z]{3,9})\.?,?[\s-]+(\d{4})$/.exec(s))) { d = Number(hit[1]); m = MONTHS.indexOf(hit[2].slice(0, 3).toLowerCase()) + 1; y = Number(hit[3]); }
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (!m || dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

// The lines of the zip READ_ME files about vouchers that are in no file: how many there are in each Zoho module, why, and
// what the person can do (upload the Zoho import sample of the module). held: heldState() (heldvouchers.js), or null.
// Nothing here names a party or an amount; the counts come from the migration.
export function heldLines(held) {
  if (!held?.available || !held.modules?.length) return [];
  const out = ['Vouchers that are not in any file', `   ${held.notInAnyFile} voucher${held.notInAnyFile === 1 ? ' is' : 's are'} in no file, so the trial balance in Zoho Books will not agree with Tally until they are entered:`];
  for (const m of held.modules) {
    const built = m.file?.buildable;
    out.push(`   - ${m.module}: ${m.vouchers} voucher${m.vouchers === 1 ? '' : 's'}. ${built ? 'The file is in this zip (see READ_ME_IMPORT_ORDER.txt).' : m.file?.stillHeld ? `They stay held: ${m.file.why}` : `Zoho's import sample for ${m.module} is not in the platform, so no file can be built. Upload the sample in the tool (Import Wizard, vouchers not in any file) and the file is built from its headings.`}`);
  }
  if (held.awaitingRouting) out.push(`   - ${held.awaitingRouting} journal voucher${held.awaitingRouting === 1 ? '' : 's'} wait${held.awaitingRouting === 1 ? 's' : ''} for a decision in Voucher Classification.`);
  // vouchers held for a module file are held only because that route was chosen: the default writes them as journals now
  if (held.modules.some(m => !m.file?.buildable)) out.push('   To bring them in now instead, choose the default in the tool: Voucher files, "Receipts from customers, payments to vendors, debit and credit notes": Manual Journals. Create the files again: they are then lines of the journals file of receipts and payments, with the customer or vendor named, and nothing is held.');
  out.push('   The list of each module can be downloaded from the tool.', '');
  return out;
}

// ---------- routes ----------
// deps: { db, need, audit, now, tx, staleInfo(jobId), staleMessage(job, what, reasons), bankOpeningBalances?(jobId) }
export function registerImportWizard(app, deps) {
  const { db, need, audit, now, tx, staleInfo, staleMessage } = deps;
  const markStale = deps.markStale || (() => {});
  const actor = req => req.user?.email || 'system';
  const filesOf = jobId => Object.fromEntries(db.prepare('SELECT * FROM generated_files WHERE job_id = ? ORDER BY rowid').all(jobId).map(f => [f.key, f]));
  const genRows = (jobId, key) => db.prepare('SELECT row_no, source_record_id, source_id, row_data, ident FROM generated_rows WHERE job_id = ? AND key = ? ORDER BY row_no').all(jobId, key);

  // The bank and credit card accounts of the Chart of Accounts file, and every opening balance that is not in the
  // Chart of Accounts, Customers or Vendors files. Read from the opening balance journal when the files have one;
  // otherwise worked out from the stored Tally ledgers of bank type. source says which.
  function openingBalances(jobId, files) {
    if (!files.accounts) return { bankAccounts: [], lines: [], source: null, contactCredits: 0 };
    let contactCredits = 0; // lines of journal OB-2 (a customer in credit, a vendor in debit): not typed on the Opening Balances page
    const layout = fileLayout(db, jobId, 'accounts');
    const accounts = genRows(jobId, 'accounts').map(g => { const v = layout.values(g); return { recId: g.source_record_id, id: g.source_id, account: String(v.account_name ?? g.ident ?? ''), accountType: String(v.account_type ?? '') }; });
    const bank = accounts.filter(a => BANK_TYPES.includes(a.accountType));
    const typeOf = new Map(accounts.map(a => [a.recId, a.accountType]));
    const lines = [];
    let source = null;
    if (files[OPENING_JOURNAL]) {
      const jl = fileLayout(db, jobId, OPENING_JOURNAL);
      for (const g of genRows(jobId, OPENING_JOURNAL)) {
        if (g.source_record_id == null) continue; // the balancing line on Opening Balance Adjustments
        const v = jl.values(g);
        if (String(v.contact_name ?? '').trim() !== '') { contactCredits++; continue; }
        const debit = dec(v.debit), credit = dec(v.credit);
        const amount = debit.isZero() ? credit : debit;
        if (amount.isZero()) continue;
        lines.push({ id: String(g.source_id ?? g.source_record_id), recId: g.source_record_id, account: String(v.account ?? g.ident ?? ''), side: debit.isZero() ? 'Credit' : 'Debit', amount: amount.toFixed(2),
          bank: BANK_TYPES.includes(typeOf.get(g.source_record_id)), from: 'opening_balance_file' });
      }
      source = 'opening_balance_file';
    }
    // bank accounts with a balance in Tally that the journal does not carry
    const inJournal = new Set(lines.map(l => l.recId));
    // (not the one balance typed in the Migration Date step: it is left out of the journal on purpose)
    let typedAnchor = null;
    try { const a = deps.openingAnchor ? deps.openingAnchor(jobId) : null; typedAnchor = a?.mode === 'typed' ? a.recId : null; } catch { typedAnchor = null; }
    const missing = bank.filter(a => !inJournal.has(a.recId) && a.recId !== typedAnchor);
    if (missing.length) {
      let computed = null;
      try { computed = deps.bankOpeningBalances ? Object.fromEntries((deps.bankOpeningBalances(jobId).accounts || []).map(a => [a.id, a])) : null; } catch { computed = null; }
      const stored = db.prepare(`SELECT id, data FROM source_records WHERE job_id = ? AND id IN (${missing.map(() => '?').join(',')})`).all(jobId, ...missing.map(a => a.recId));
      const own = new Map(stored.map(r => { try { return [r.id, money(JSON.parse(r.data).openingbalance)]; } catch { return [r.id, null]; } }));
      for (const a of missing) {
        const c = computed?.[a.id];
        const bal = c ? (c.side === 'Debit' ? new Decimal(c.amount).negated() : new Decimal(c.amount)) : own.get(a.recId);
        if (!bal || bal.isZero()) continue;
        lines.push({ id: String(a.id ?? a.recId), recId: a.recId, account: a.account, side: bal.isNegative() ? 'Debit' : 'Credit', amount: bal.abs().toFixed(2), bank: true, from: 'ledgers' });
        source = source || 'ledgers';
      }
    }
    const lineOf = new Map(lines.map(l => [l.recId, l]));
    return { source, lines, contactCredits,
      bankAccounts: bank.map(a => ({ id: String(a.id ?? a.recId), account: a.account, accountType: a.accountType, side: lineOf.get(a.recId)?.side || '', amount: lineOf.get(a.recId)?.amount || '' })) };
  }

  // Everything the wizard shows for one migration.
  function state(job, user) {
    const jobId = job.id;
    const files = filesOf(jobId);
    const fileKeys = Object.keys(files).filter(k => !ALL_FILES[k]?.referenceOnly);
    const canChange = user?.role !== 'viewer';
    if (!fileKeys.length) {
      return { available: false, canChange, processed: ['processed', 'generated'].includes(job.status),
        message: ['processed', 'generated'].includes(job.status) ? 'Create the files first.' : 'Read the Tally files and create the Zoho files first.' };
    }
    const stale = staleInfo(jobId);
    const status = Object.fromEntries(db.prepare('SELECT * FROM import_status WHERE job_id = ?').all(jobId).map(r => [r.key, r]));
    const results = Object.fromEntries(db.prepare('SELECT * FROM wizard_results WHERE job_id = ?').all(jobId).map(r => [r.key, r]));
    const openRejections = Object.fromEntries(db.prepare("SELECT key, COUNT(*) n FROM rejections WHERE job_id = ? AND status <> 'retried' GROUP BY key").all(jobId).map(r => [r.key, r.n]));
    const ticks = {};
    for (const t of db.prepare('SELECT * FROM wizard_ticks WHERE job_id = ?').all(jobId)) (ticks[t.step] ||= {})[t.item] = t;
    const overrides = Object.fromEntries(db.prepare('SELECT * FROM wizard_overrides WHERE job_id = ?').all(jobId).map(r => [r.step, r]));
    const tick = (step, item, value = null) => { const t = ticks[step]?.[item]; return t && (value == null || t.value === value) ? { done: true, by: t.done_by, at: t.at } : { done: false }; };
    const fy = jobYear(job);
    const existing = zohoExistingAccounts(db, jobId);
    const ob = openingBalances(jobId, files);

    // ----- did the masters arrive? what Zoho Books holds after the import of a master file (zohoverify.js) -----
    const verifyOf = {};
    for (const k of fileKeys) if (isVerifyKind(k)) { try { verifyOf[k] = verifyMaster(db, jobId, k); } catch { /* the check is a help: the wizard does not depend on it */ } }
    const expectedOf = Object.fromEntries(fileKeys.map(k => [k, verifyOf[k] && MASTER_COUNTED.includes(k) ? verifyOf[k].expected : expectedRecords(db, jobId, k)]));

    // ----- what happened to one file -----
    // importState: 'not_imported' | 'failed' | 'refused' | 'missing_in_zoho' (Zoho's export lacks records of the file) |
    //   'short' (the figures recorded account for fewer records than the file has, and nothing was refused) | 'imported'
    const fileFacts = key => {
      const f = files[key];
      const res = results[key];
      const st = status[key]?.status;
      const valid = !!res && res.file_sha === f.sha256;
      let result = null;
      if (valid) result = { imported: res.imported, refused: res.refused, by: res.recorded_by, at: res.at };
      else if (['imported', 'partial', 'failed'].includes(st)) result = { imported: null, refused: null, fromTracker: true, by: null, at: status[key].updated_at, note: status[key].note || '' };
      const fromErrorFile = openRejections[key] || 0;
      const refused = Math.max(result?.refused || 0, fromErrorFile);
      const verify = verifyOf[key] || null;
      const expected = expectedOf[key] ?? null;
      const allThere = verify?.state === 'all_there';
      const short = valid && !allThere && expected != null && refused === 0 && res.imported < expected;
      const importState = !result ? 'not_imported'
        : valid && res.imported === 0 && res.refused > 0 ? 'failed'
          : result.fromTracker && st !== 'imported' ? (st === 'failed' ? 'failed' : 'refused')
            : refused > 0 ? 'refused'
              : verify?.state === 'missing' ? 'missing_in_zoho'
                : short ? 'short' : 'imported';
      const why = stale.forFile(key);
      let size = null; try { size = fs.statSync(f.path).size; } catch { size = null; }
      return { key, module: f.module, fileName: f.file_name, rows: f.rows, sha256: f.sha256, sizeBytes: size, generatedAt: f.generated_at, notes: f.notes || null,
        result, previous: res && !valid ? { imported: res.imported, refused: res.refused, at: res.at } : null,
        refused, refusedFromErrorFile: fromErrorFile, importState, imported: importState === 'imported',
        expectedRecords: expected, shortBy: short ? expected - res.imported : 0,
        outOfDate: why.length > 0, outOfDateReasons: why };
    };
    const facts = Object.fromEntries(fileKeys.map(k => [k, fileFacts(k)]));
    // which later files name a record Zoho Books does not have (read only when something is missing)
    const missingKeys = {};
    for (const [k, v] of Object.entries(verifyOf)) if (v.missingCount) missingKeys[k] = new Set(v.missing.map(m => VERIFY_KINDS[k].keyOf(m.name)));
    const namingMissing = (() => { try { return filesNamingMissing(db, jobId, missingKeys); } catch { return {}; } })();

    // ----- set-up -----
    // facts about this company, counted from the rows of the files as created (read once, only for the hints below)
    const company = (() => {
      const rows = { customers: [], vendors: [], bills: [] };
      try {
        for (const k of ['customers', 'vendors']) {
          if (!files[k]) continue;
          const layout = fileLayout(db, jobId, k);
          rows[k] = genRows(jobId, k).map(g => ({ treatment: layout.values(g).gst_treatment }));
        }
        if (files.bills) {
          const layout = fileLayout(db, jobId, 'bills');
          rows.bills = genRows(jobId, 'bills').map(g => ({ doc: g.ident, reverseCharge: String(layout.values(g).reverse_charge_tax_name ?? '').trim() !== '', noState: String(layout.values(g).source_of_supply ?? '').trim() === '' }));
        }
      } catch { /* the hints are a help; the guide does not depend on them */ }
      return companyFactsOf(rows);
    })();
    const tdsFacts = (() => { try { return tdsTaxesInFiles(db, jobId, job); } catch { return null; } })();
    const dynamic = setupHints({ job, fy, facts: company, tds: tdsFacts });
    const setupItems = (Array.isArray(RULES.organisation_setup) ? RULES.organisation_setup : (RULES.import_order || []).filter(o => o.kind === 'setup')).map(o => {
      const id = `s${o.step}`;
      const upload = /export chart of accounts/i.test(o.where || '');
      const isGst = /^gst$/i.test(String(o.what).trim());
      const outsideCount = [['customer', company.overseas.customers + company.sez.customers], ['vendor', company.overseas.vendors + company.sez.vendors]].filter(([, n]) => n);
      const outsideParties = outsideCount.reduce((t, [, n]) => t + n, 0);
      const outsideWords = outsideCount.map(([w, n]) => plural(n, w)).join(' and ');
      const lines = sentences(o.do);
      const hints = [];
      if (/profile/i.test(o.what) && fy) hints.push(`This migration: financial year ${job.financial_year} (${niceDate(fy.from)} to ${niceDate(fy.to)}).${fiscalYearWords(fy) ? ` Choose the Fiscal Year ${fiscalYearWords(fy)}.` : ''}`);
      if (/profile/i.test(o.what)) hints.push(...dynamic.profile);
      if (/^gst$/i.test(String(o.what).trim()) && job.gstin) hints.push(`GSTIN of this migration: ${job.gstin}.`);
      if (/^gst$/i.test(String(o.what).trim())) hints.push(...dynamic.gst);
      if (/\btds\b/i.test(o.what || '')) hints.push(...dynamic.tds);
      // the TDS taxes item: "Export TDS Taxes and give the file to the tool" is an upload (PUT zoho-tds-taxes), not a tick
      // (audit item 11); the export's names become the TDS pick list and the names written by default
      const tdsExport = /\btds\b/i.test(o.what || '');
      const isUploadLine = s => tdsExport && /export tds taxes/i.test(s);
      const tdsGiven = tdsExport ? (() => { try { return db.prepare('SELECT taxes, file_name, at FROM zoho_tds_taxes_meta WHERE job_id = ?').get(jobId) || null; } catch { return null; } })() : null;
      return { id, what: o.what, paths: pathParts(o.where), optional: upload, upload, hints, notes: lines.filter(isExplanation), sourceUrl: o.source_url || null,
        lines: upload ? lines.filter(s => !isExplanation(s)) : lines.filter(isUploadLine),
        ...(tdsExport ? { tdsToCreate: (() => { try { return tdsTaxesInFiles(db, jobId, job); } catch { return null; } })() } : {}),
        ...(tdsExport ? { uploadTds: { route: `/api/migrations/${jobId}/zoho-tds-taxes`, given: !!tdsGiven, taxes: tdsGiven?.taxes ?? 0, fileName: tdsGiven?.file_name ?? null, at: tdsGiven?.at ?? null, optional: true } } : {}),
        ticks: [
          ...(upload ? [] : lines.filter(s => !isExplanation(s) && !isUploadLine(s)).map((text, i) => ({ id: `${id}.${i + 1}`, text, ...tick('setup', `${id}.${i + 1}`) }))),
          // a party outside India or in an SEZ is in the files: SEZ / Overseas Trading is then REQUIRED, with its Custom
          // Duty Tracking Account (Zoho refuses an overseas contact or bill without it); a tick of its own, so the
          // accounts and every later file wait for it like for any other set-up tick
          ...(isGst && outsideParties ? [{ id: `${id}.overseas`, required: true, text: `SEZ / Overseas Trading is ticked in GST Settings and a Custom Duty Tracking Account is chosen (any expense account). Needed: ${outsideWords} in these files ${outsideParties === 1 ? 'is' : 'are'} outside India or in an SEZ, and Zoho Books refuses such a party and its bills or invoices without it.`, ...tick('setup', `${id}.overseas`) }] : []),
        ] };
    });
    // ----- the organisation's answers (voucher settings): HSN/SAC on or off, and the Migration Date -----
    let answers = {};
    try { answers = JSON.parse(db.prepare('SELECT extra FROM voucher_settings WHERE job_id = ?').get(jobId)?.extra || '{}') || {}; } catch { answers = {}; }
    const hsnOn = hsnFieldOn(answers.hsnEnabled, companyGstinForHsn(db, jobId));
    const settingsRoute = `/api/migrations/${jobId}/voucher-settings`;
    const questions = [
      { id: 'hsnEnabled', key: 'hsnEnabled', route: settingsRoute, value: hsnOn ? 'on' : 'off',
        text: 'Is the HSN Code or SAC field switched on in your Zoho Books?',
        help: 'It is on in every new India organisation. While it is on, Zoho refuses an invoice line that has no HSN/SAC code of at least 6 digits. The tool then writes the code from Tally, or the code you choose in Mapping Studio (HSN/SAC), or a suggested code that you confirm. To switch it off: Settings > Module Settings > General > Items (tab Preferences), and untick "Enable the HSN Code or SAC field". Then answer No here and the HSN/SAC column is left empty.',
        options: [{ id: 'on', label: 'Yes (the default)' }, { id: 'off', label: 'No, I switched it off' }] },
      ...(hsnOn ? [{ id: 'hsnMinDigits', key: 'hsnMinDigits', route: settingsRoute, value: answers.hsnMinDigits === '4' ? '4' : '6',
        text: 'How many digits does Zoho Books ask for in the HSN/SAC code?',
        help: 'Zoho Books asks for at least 6 digits in a new organisation. Choose 4 only if your Zoho Books is set to "4-digit HSN Code or SAC" (Settings > Module Settings > General > Items, tab Preferences).',
        options: [{ id: '6', label: '6 digits (the default)' }, { id: '4', label: '4 digits' }] }] : []),
      // asked only when it matters: reverse charge bills of a vendor with no state (an overseas vendor, or a state not set in Tally)
      ...(company.reverseChargeNoState ? [{ id: 'rcmUnknownState', key: 'rcmUnknownState', route: settingsRoute, value: answers.rcmUnknownState === 'intra' ? 'intra' : 'overseas',
        text: `${plural(company.reverseChargeNoState, 'bill')} with reverse charge ${company.reverseChargeNoState === 1 ? 'is' : 'are'} from a vendor with no state. Are these vendors outside India?`,
        help: 'Tally does not say, but it booked IGST under reverse charge for a vendor with no GSTIN and no state: that is how an import of services is booked. So the tool takes these vendors as outside India: the vendor and its bills are written as overseas with IGST. If the vendors are in India, answer No: the supply is then taken as inside your state and written with GST (CGST and SGST). Better still, give the vendor its state in Mapping Studio (Fix contacts). What was tried in Zoho Books: with the answer No, bills of a vendor with no state written with GST (CGST and SGST) under reverse charge were accepted in a test import. With the answer Yes, bills written as overseas with IGST under reverse charge were not tried in a test import yet: read the preview of the Bills import before you click Import. The order stays the usual one: vendors before bills.',
        options: [{ id: 'overseas', label: 'Yes, outside India (import of services, the default)' }, { id: 'intra', label: 'No, in India' }] }] : []),
    ];
    // the Migration Date: what was typed in Voucher files, else the day before the financial year starts (the date of the
    // opening balance journal). Zoho keeps ONE date, so the journal and the contacts' opening balances share it.
    // (the same helper dates the opening balance journal: zoho.js migrationDateOf)
    const mig = migrationDateOf(answers.openingDate, openingBalancesFrom(db, jobId, fy) || fy?.from);
    const defaultDate = mig.default, chosenDate = mig.chosen ? mig.date : '', migrationDate = mig.date;
    // The balances Zoho dates with its Opening Balance Date: every Opening Balance cell of the Chart of Accounts,
    // Customers and Vendors files (the opening balance journal carries its own date). balanceRows: per file, the rows.
    const balanceRows = key => {
      if (!files[key]) return [];
      try {
        const layout = fileLayout(db, jobId, key);
        return genRows(jobId, key).map(g => ({ g, v: layout.values(g) })).filter(x => String(x.v.opening_balance ?? '').trim() !== '');
      } catch { return []; }
    };
    const dated = Object.fromEntries(['accounts', 'customers', 'vendors'].map(k => [k, balanceRows(k)]));
    const dateNeeded = Object.values(dated).some(rows => rows.length > 0);
    const contactHasBalance = key => (dated[key] || []).length > 0;
    // The step is done only when the date Zoho Books SHOWS (typed here from Settings > Opening Balances, or sent by
    // whoever read it from Zoho) is the Migration Date. A tick alone does not count: in three test imports the date
    // was never saved, and every such balance landed after the whole year.
    const zohoDateTick = ticks.date?.['d.zohoDate'] || null;
    const zohoDate = /^\d{4}-\d{2}-\d{2}$/.test(String(zohoDateTick?.value || '')) ? zohoDateTick.value : '';
    const dateDone = !dateNeeded || (zohoDate !== '' && zohoDate === migrationDate);
    // a locked period refuses every dated row (rules INV-DATE-NOT-LOCKED, BIL-DATE-NOT-LOCKED, JRN-DATE-NOT-LOCKED)
    const lockRules = Object.values(RULES.modules || {}).flatMap(m => m.rules || []).filter(r => r.params?.setting === 'Transaction Locking').map(r => r.id);
    if (lockRules.length) {
      setupItems.push({ id: 'locking', what: 'Transaction locking', paths: [['Accountant', 'Transaction Locking']], optional: false, upload: false, hints: [], notes: [], sourceUrl: null,
        ticks: [{ id: 'locking.1', text: 'Locking is off for the financial year you import.', ...tick('setup', 'locking.1') }] });
    }
    const setupTicks = setupItems.flatMap(i => i.ticks);
    const setupOpen = setupTicks.filter(t => !t.done).length;

    // ----- the steps -----
    const plan = planFor(db, jobId, fileKeys).filter(p => (p.kind !== 'bank' || ob.bankAccounts.length > 0) && (p.kind !== 'opening' || p.key || ob.lines.length > 0) && (p.kind !== 'date' || dateNeeded));
    // "Apply the credits": one page after the last journals file, only when a journal of these files leaves a credit on
    // a customer or vendor (heldvouchers.js creditsState). It waits for the journals, the invoices and the bills.
    const credits = (() => { try { return creditsState(db, jobId); } catch { return { available: false }; } })();
    if (credits.available) {
      const last = Math.max(...['journals', 'other_journals'].map(k => plan.findIndex(p => p.kind === 'file' && p.key === k)));
      if (last >= 0) plan.splice(last + 1, 0, { id: 'credits', kind: 'credits', needs: ['invoices', 'bills', 'journals', 'other_journals'].filter(k => fileKeys.includes(k)), rule: null });
    }
    const bankAccounts = ob.bankAccounts.map(a => ({ ...a, ...tick('bank', a.id) }));
    const bankOpen = bankAccounts.filter(a => !a.done).length;
    const hasBankStep = plan.some(p => p.kind === 'bank');
    const typed = ob.lines.map(l => ({ ...l, recId: undefined, typed: tick('opening', l.id, `${l.side} ${l.amount}`) }));
    const typedAll = typed.length > 0 && typed.every(l => l.typed.done);
    const doneOf = {};
    const steps = [];
    for (const p of plan) {
      const step = { id: p.id, kind: p.kind };
      const blockers = [];
      // the opening balance journal file also holds journal OB-2 when contacts have advances: its lines name customers
      // and vendors, so it waits for those files like every other file that names a contact
      const alsoNeeds = p.kind === 'opening' && p.key && ob.contactCredits > 0 ? ['customers', 'vendors'].filter(k => fileKeys.includes(k) && !p.needs.includes(k)) : [];
      const needFiles = [...p.needs, ...alsoNeeds].filter(k => facts[k]);
      for (const k of needFiles) {
        const d = facts[k];
        if (d.importState === 'not_imported') blockers.push({ step: k, module: d.module, why: 'not_imported', words: `${d.module} is not imported yet.` });
        else if (d.importState === 'missing_in_zoho') {
          // Zoho's own export lacks records of that file: a row of this file that names one would be refused
          const v = verifyOf[k];
          const mine = p.key ? namingMissing[p.key]?.[k] || 0 : 0;
          blockers.push({ step: k, module: d.module, why: 'missing_in_zoho', rows: v.missingCount,
            words: `${plural(v.missingCount, `${v.one} of the ${d.module} file is`, `${v.many} of the ${d.module} file are`)} not in Zoho Books (Zoho's export shows it).${mine ? ` This file names ${mine} of them, so Zoho Books would refuse those rows.` : ''} Import the missing ${v.missingCount === 1 ? 'row' : 'rows'} first (step "Import ${d.module}").` });
        } else if (d.importState === 'short') {
          blockers.push({ step: k, module: d.module, why: 'short', rows: d.shortBy,
            words: isVerifyKind(k)
              ? `Zoho Books was recorded with ${d.result.imported} of the ${d.expectedRecords} ${verifyOf[k]?.many || 'records'} of the ${d.module} file, and none refused: ${d.shortBy} ${d.shortBy === 1 ? 'is' : 'are'} not accounted for. On the step "Import ${d.module}", upload Zoho's export so the tool can name ${d.shortBy === 1 ? 'it' : 'them'}, or record the figure Zoho Books shows after the import.`
              : `${d.module} was recorded with ${d.result.imported} of its ${d.expectedRecords} documents imported, and none refused: ${d.shortBy} ${d.shortBy === 1 ? 'is' : 'are'} not accounted for. Record the refused rows on that step, or upload Zoho's error file.` });
        } else if (!d.imported) blockers.push({ step: k, module: d.module, why: 'refused', rows: d.refused, words: d.refused > 0 ? `${plural(d.refused, 'row was', 'rows were')} refused in ${d.module}.` : `${d.module} was not imported in full.` });
      }
      // files that post to bank accounts need those accounts in Zoho Books
      const usesBank = p.kind === 'opening' || (p.kind === 'file' && /bank accounts/i.test((RULES.modules?.[p.key]?.must_exist_first || []).join(' ')));
      if (usesBank && hasBankStep && bankOpen > 0) blockers.push({ step: 'bank', why: 'bank', rows: bankOpen, words: `${plural(bankOpen, 'bank, credit card or cash account is', 'bank, credit card or cash accounts are')} not ticked as present in Zoho Books.` });
      // EVERY file after the Chart of Accounts waits for the Migration Date: Zoho dates the opening balances of the
      // contacts with it, does not let it be changed once those balances (or opening stock) exist, and counts dated
      // documents against it. A HARD lock: it cannot be opened with a typed reason (hard: true).
      if ((p.kind === 'opening' || (p.kind === 'file' && p.key !== 'accounts')) && plan.some(x => x.kind === 'date') && !dateDone) {
        blockers.push({ step: 'date', why: 'date', hard: true, words: zohoDate
          ? `Zoho Books shows the Opening Balance Date ${niceDate(zohoDate)}; the Migration Date is ${niceDate(migrationDate)} (step "Save the Migration Date"). Change it in Zoho Books first.`
          : `The Migration Date ${niceDate(migrationDate)} is not checked in Zoho Books yet (step "Save the Migration Date")${contactHasBalance(p.key) ? ': it dates the opening balances of this file' : ''}.` });
      }
      if (p.kind === 'file' && p.key === 'accounts' && setupOpen > 0) blockers.push({ step: 'setup', why: 'setup', rows: setupOpen, words: `${plural(setupOpen, 'set-up item is', 'set-up items are')} not ticked.` });
      const override = blockers.some(b => b.hard) ? null : overrides[p.id] || null;
      if (blockers.length) {
        const needs = [...needFiles.map(k => facts[k].module), ...(usesBank && hasBankStep ? ['the bank accounts'] : []), ...(p.key === 'accounts' ? ['the set-up'] : []), ...(blockers.some(b => b.why === 'date') ? ['the Migration Date'] : [])];
        const waiting = blockers.filter(b => b.why === 'not_imported').map(b => b.module);
        const said = [waiting.length ? `Not imported yet: ${list(waiting)}.` : '', ...blockers.filter(b => b.why !== 'not_imported').map(b => b.words)].filter(Boolean);
        const fix = blockers.some(b => b.why === 'refused') ? 'Fix those first.' : 'Do that first.';
        step.lockReason = `Needs ${list(needs)}. ${said.join(' ')} ${fix}`;
      }
      step.blockers = blockers;
      step.hardLocked = blockers.some(b => b.hard); // the Migration Date: no "open anyway"
      step.locked = blockers.length > 0 && !override;
      step.override = override && blockers.length ? { reason: override.reason, by: override.decided_by, at: override.at } : null;

      if (p.kind === 'setup') {
        Object.assign(step, { title: 'Set up Zoho Books', short: 'Set up Zoho Books', items: setupItems, questions, open: setupOpen, done: setupOpen === 0,
          existingAccounts: { source: existing.source, count: existing.names.length, fileName: existing.fileName, uploadedAt: existing.uploadedAt, uploadedBy: existing.uploadedBy } });
      } else if (p.kind === 'bank') {
        Object.assign(step, { title: 'Check the bank accounts', short: 'Bank accounts', paths: pathParts(p.rule?.where), lines: sentences(p.rule?.do), accounts: bankAccounts, open: bankOpen, done: bankOpen === 0,
          balancesIn: ob.source === 'opening_balance_file' ? 'opening_balance_file' : ob.lines.some(l => l.bank) ? 'ledgers' : null });
      } else if (p.kind === 'date') {
        // 'edit': the Chart of Accounts file carries a balance, so its import created Zoho's opening balance record and the
        // person only changes the date (nothing is typed). 'type' (rare): no chart row can carry one, so the ONE balance
        // the files leave out for this purpose is typed (deps.openingAnchor); it is in no file, so nothing is set back.
        const chartBalances = dated.accounts.map(x => ({ account: String(x.v.account_name ?? x.g.ident ?? ''), side: String(x.v.debit_or_credit ?? ''), amount: String(x.v.opening_balance ?? '') }));
        const mode = chartBalances.length ? 'edit' : 'type';
        let toType = [];
        if (mode === 'type') { try { const a = deps.openingAnchor ? deps.openingAnchor(jobId) : null; if (a?.mode === 'typed') toType = [{ account: a.account, side: a.side, amount: a.amount }]; } catch { toType = []; } }
        const dependsOn = ['accounts', 'customers', 'vendors'].filter(k => dated[k].length).map(k => ({ key: k, module: facts[k]?.module || k, rows: dated[k].length }));
        const editLines = sentences(p.rule?.do);
        const typeLines = ['Do this after the Chart of Accounts is imported and before every other file.',
          'Zoho Books keeps ONE Opening Balance Date for every opening balance that is not in a journal: the opening balances of the Customers and Vendors files take it.',
          'Open Settings > Setup & Configurations > Opening Balances and set the date to the Migration Date shown above.',
          'Zoho Books does not save the date while every balance is 0, and no balance of this migration is in the Chart of Accounts file. So type the ONE balance shown below. It is in no file, so it is not counted twice and is never set back.',
          'Click Continue and Confirm.',
          'Zoho Books does not let the date be changed once customer or vendor opening balances exist, so do it now.',
          'Open the page again, read the date it shows, and type that date in the box below.',
          'Every later file stays locked until the date Zoho Books shows is the Migration Date.'];
        Object.assign(step, { title: 'Save the Migration Date', short: 'Migration Date', paths: pathParts(p.rule?.where), lines: mode === 'edit' ? editLines : typeLines, mode,
          date: { value: migrationDate, nice: niceDate(migrationDate), default: defaultDate, niceDefault: niceDate(defaultDate), chosen: !!chosenDate, route: settingsRoute, key: 'openingDate' },
          // what depends on the date, per file; and what does not (the journal carries its own date)
          dependsOn, journalDate: files[OPENING_JOURNAL] ? { value: migrationDate, nice: niceDate(migrationDate) } : null,
          consequence: 'If this step is skipped, Zoho Books dates these balances on the day the organisation was made, after every voucher: they are missing from the trial balance of the year, and it will not match Tally.',
          chartBalances, balancesToType: toType,
          contactsWithBalances: ['customers', 'vendors'].filter(contactHasBalance),
          // the check: the date Zoho Books shows, typed here (or sent by whoever read it from Zoho). No tick.
          zohoDate: { value: zohoDate, nice: niceDate(zohoDate), expected: migrationDate, niceExpected: niceDate(migrationDate), matches: zohoDate !== '' && zohoDate === migrationDate,
            by: zohoDateTick?.done_by || null, at: zohoDateTick?.at || null, route: `/api/migrations/${jobId}/import-wizard/zoho-opening-date`,
            ask: 'Which date does Zoho Books show on Settings > Setup & Configurations > Opening Balances?',
            words: zohoDate === '' ? `Type the date Zoho Books shows. It must be ${niceDate(migrationDate)}.`
              : zohoDate === migrationDate ? `Zoho Books shows ${niceDate(zohoDate)}: that is the Migration Date. The other files are open.`
                : `Zoho Books shows ${niceDate(zohoDate)}, but the Migration Date is ${niceDate(migrationDate)}. Open Settings > Setup & Configurations > Opening Balances, click Edit, change the date to ${niceDate(migrationDate)}, click Continue and Confirm. Then type the date it shows here again.` },
          ticks: [], sourceUrl: p.rule?.source_url || null, done: dateDone });
      } else if (p.kind === 'opening') {
        const f = p.key ? facts[p.key] : null;
        const entry = RULES.modules?.opening_balances || {};
        Object.assign(step, { title: 'Opening balances', short: 'Opening balances', file: f ? fileStep(p.key, f) : null, lines: typed, source: ob.source,
          sourceWords: ob.lines.some(l => l.from === 'ledgers') && ob.source === 'opening_balance_file' ? 'Read from the opening balance journal file. Balances of bank accounts that are not in it were worked out from the Tally ledgers.'
            : ob.source === 'opening_balance_file' ? 'Read from the opening balance journal file.'
              : ob.source === 'ledgers' ? 'Worked out from the Tally ledgers of type Bank and Credit Card: the files have no opening balance journal.' : '',
          // journal OB-2 of the file: customers in credit and vendors in debit (not typed on the Opening Balances page)
          contactCredits: ob.contactCredits,
          contactCreditWords: ob.contactCredits ? `The file also holds journal OB-2: ${plural(ob.contactCredits, 'customer or vendor', 'customers and vendors')} with an advance (a customer in credit, a vendor in debit), on Accounts Receivable or Accounts Payable with the Contact Name. They are not in the list below. If Zoho Books refuses OB-2, enter them as Zoho's help says for advances (the Zoho check, rule OB-CUSTOMER-CREDIT-BALANCE).` : '',
          typePaths: pathParts(entry.zoho_module), typeClicks: Array.isArray(entry.click_path) ? entry.click_path.filter(c => !/^or:/i.test(c)) : [],
          typedAll, bothWays: !!f && f.imported && typed.some(l => l.typed.done),
          // the list to type is the plan only when there is no journal file; with the file it is a last resort, shown
          // when Zoho Books refused the journal (nothing is typed otherwise)
          typeNeeded: !f || ['refused', 'failed'].includes(f.importState),
          journalDate: f ? { value: migrationDate, nice: niceDate(migrationDate) } : null,
          done: (f ? f.imported : false) || typedAll });
      } else if (p.kind === 'file') {
        const f = facts[p.key];
        Object.assign(step, fileStep(p.key, f), { title: `Import ${f.module}`, short: f.module, done: f.imported, itemsNotNeeded: !!p.itemsNotNeeded });
      } else if (p.kind === 'credits') {
        const cs = credits.summary;
        const t = tick('credits', 'c.applied');
        Object.assign(step, { title: 'Apply the credits', short: 'Apply credits', optional: true,
          paths: [['Sales', 'Invoices'], ['Purchases', 'Bills']],
          summary: cs, rows: credits.rows, fileName: CREDITS_FILE,
          listRoute: `/api/migrations/${jobId}/credits-to-apply`, downloadRoute: `/api/migrations/${jobId}/credits-to-apply.csv`,
          counts: [
            { id: 'apply', label: 'To apply to an invoice or bill', rows: cs.apply.rows, amount: cs.apply.amount, words: `${plural(cs.apply.invoices, 'invoice')} and ${plural(cs.apply.bills, 'bill')}` },
            { id: 'opening_balance', label: 'Against a document from before the migration (opening balance)', rows: cs.openingBalance.rows, amount: cs.openingBalance.amount, words: 'apply to the opening balance if Zoho Books offers it, else leave' },
            { id: 'leave', label: 'Stays a credit, as in Tally', rows: cs.leave.rows, amount: cs.leave.amount, words: 'advances and money on account: nothing to do' },
          ],
          // the page in parts (the screen), and the same sentences in one list (READ_ME_IMPORT_ORDER.txt)
          intro: `${plural(cs.journals, 'journal')} you imported put a receipt from a customer or a payment to a vendor on the contact (${plural(cs.contacts, 'contact')}). Zoho Books keeps each as a credit of that contact.`,
          why: 'The invoices and bills that were paid still show as unpaid in Zoho Books until the credit is applied to them. Apply the credits so that paid documents, ageing and statements are right.',
          how: [
            'For each row "Apply to invoice": open the invoice in Zoho Books (Sales > Invoices). Zoho Books shows the credits available for the customer. Choose to apply credits, pick the journal with the Journal Number of the row, type the Amount of the row and save.',
            'For each row "Apply to bill": open the bill of that vendor (Purchases > Bills) and do the same. A bill number can belong to more than one vendor: use the Contact of the row.',
            'Rows "Leave as credit" need nothing: they are advances or money on account in Tally too.',
            'Rows "Opening balance" are against invoices or bills from before the migration. Apply them to the opening balance of the contact if Zoho Books offers it. If it does not, leave them: the balance of the contact is right either way.',
            'Rows "Note" have no amount and need nothing: they only say what Tally shows on the other side of that line.',
          ],
          later: 'You can do this step later. The next step does not wait for it.',
          notes: ['The amounts come from the bill-wise details in Tally (Agst Ref). The tool never applies more than what is left of an invoice or bill.',
            'Not tried in a test import yet: applying a journal credit to the opening balance of a contact.'],
          sourceUrl: 'https://www.zoho.com/books/kb/accountant/credits-manual-journals.html',
          ticks: [{ id: 'c.applied', text: 'The credits are applied in Zoho Books, or I will apply them later (the trial balance does not depend on it).', ...t }],
          done: t.done });
        step.lines = [step.intro, 'The balances of the contacts and the trial balance are already right. Nothing here changes them.', step.why,
          `Download the list ${CREDITS_FILE}. It is not an import file. It is also in the zip, in the folder not_for_import.`, ...step.how, step.later];
      } else {
        const lines = sentences(p.rule?.do);
        // what is still open before the comparison can agree (the page stays reachable: it is how differences are found)
        const stillOpen = steps.filter(x => !x.done && x.kind !== 'setup' && !x.optional).map(x => ({ step: x.id, title: x.title,
          words: x.kind === 'file' ? (x.importState === 'not_imported' ? `${x.module} is not imported yet.` : `${x.module}: ${plural(x.refused || 0, 'row was', 'rows were')} refused.`) : `"${x.title}" is not done.` }));
        let heldNow = null;
        try { heldNow = heldState(db, jobId, deps.voucherControl ? deps.voucherControl(jobId) : null); } catch { heldNow = null; }
        if (heldNow?.available && heldNow.notInAnyFile > 0) stillOpen.push({ step: 'held', title: 'Vouchers that are in no file', words: `${plural(heldNow.notInAnyFile, 'voucher is', 'vouchers are')} in no file.` });
        step.stillOpen = stillOpen;
        step.stillOpenWords = stillOpen.length ? `The trial balances cannot agree yet: ${stillOpen.map(o => o.words).join(' ')}` : '';
        Object.assign(step, { title: 'Compare the trial balances', short: 'Compare trial balances', paths: pathParts(p.rule?.where),
          ticks: lines.map((text, i) => ({ id: `f.${i + 1}`, text, ...tick('finish', `f.${i + 1}`) })), trialBalanceScreen: 'screen-30',
          // what Zoho Books should show, worked out from the files before any import (read when the page asks: predictedtb.js)
          expectedRoute: `/api/migrations/${jobId}/predicted-trial-balance`, expectedCsvRoute: `/api/migrations/${jobId}/predicted-trial-balance.csv`,
          // the date the last checks are about: the Migration Date, and what Zoho Books was last seen to show
          openingDate: { expected: migrationDate, niceExpected: niceDate(migrationDate), zoho: zohoDate, niceZoho: niceDate(zohoDate), needed: dateNeeded,
            words: !dateNeeded ? `No file of this migration carries a balance that Zoho Books dates itself: every opening balance is in the opening balance journal, dated ${niceDate(migrationDate)}.`
              : zohoDate === migrationDate ? `Zoho Books was seen to show the Opening Balance Date ${niceDate(zohoDate)}, the Migration Date. Check that it still does.`
                : `Settings > Setup & Configurations > Opening Balances must show ${niceDate(migrationDate)}. ${zohoDate ? `It was last seen to show ${niceDate(zohoDate)}.` : 'It was not checked in the step "Save the Migration Date".'} With another date, the opening balances of the contacts fall outside the year and Opening Balance Adjustments is not zero.` } });
        step.done = false; // finished when the Trial Balance comparison shows no difference (read on the page)
      }
      doneOf[p.id] = step.done;
      steps.push(step);
    }
    steps.forEach((s, i) => { s.n = i + 1; });

    const saved = db.prepare('SELECT current_step, updated_at FROM wizard_state WHERE job_id = ?').get(jobId);
    const current = steps.some(s => s.id === saved?.current_step) ? saved.current_step : (steps.find(s => !s.done) || steps[steps.length - 1]).id;
    const fileSteps = steps.filter(s => s.key || s.file);
    return { available: true, canChange, current, remembered: !!saved?.current_step, total: steps.length, steps,
      filesOutOfDate: stale.filesOutOfDate,
      progress: { files: fileSteps.length, imported: fileSteps.filter(s => (s.file || s).imported).length },
      rules: { version: RULES.meta?.version ?? null, date: RULES.meta?.date ?? null, orderSource: RULES.import_order_source?.source_url ?? null } };

    // The fields of a file step: the file, what the rules say about importing it, and what the tool expects.
    function fileStep(key, f) {
      const headings = (() => { try { return JSON.parse(files[key].columns || 'null')?.map(c => c.heading) || null; } catch { return null; } })();
      const guide = importGuide(key, headings);
      const expects = { rows: f.rows };
      const t = ALL_FILES[key];
      // one document can be several rows: Zoho counts documents
      // the opening balance journal is ONE journal (OB-1), whatever its lines
      // the opening balance journal file is one journal (OB-1), or two when customers are in credit or vendors in debit (OB-2)
      if (key === OPENING_JOURNAL) {
        try { const jl = fileLayout(db, jobId, key); expects.documents = new Set(genRows(jobId, key).map(g => `${jl.values(g).journal_number_prefix ?? ''}${jl.values(g).journal_number_suffix ?? ''}`)).size; }
        catch { expects.documents = f.rows > 0 ? 1 : 0; }
      }
      // a bill is its number AND its vendor: two vendors' bills of the same number are two bills (as the Zoho check
      // counts them; BIL-NUMBER-UNIQUE), so they are not counted as one document here
      else if (key === 'bills') expects.documents = db.prepare("SELECT COUNT(DISTINCT ident || char(1) || COALESCE(json_extract(row_data, '$.vendor_name'), '')) n FROM generated_rows WHERE job_id = ? AND key = ?").get(jobId, key).n;
      else if (guide.oneRowIs && /line/i.test(guide.oneRowIs)) expects.documents = db.prepare('SELECT COUNT(DISTINCT ident) n FROM generated_rows WHERE job_id = ? AND key = ?').get(jobId, key).n;
      if (key === 'accounts') {
        const known = new Set(existing.names.map(accountNameKey));
        const hit = genRows(jobId, key).map(g => g.ident).filter(n => n && known.has(accountNameKey(n)));
        expects.alreadyInZoho = { count: hit.length, names: hit.slice(0, 20), source: existing.source };
      }
      // records: what Zoho Books must show after the import (the different names of a master file, the documents of a
      // voucher file); null for the Chart of Accounts, where Zoho skips the accounts it already has
      if (f.expectedRecords != null) expects.records = f.expectedRecords;
      // the check that the records really arrived: Zoho's own export of this master, taken after the import
      const v = verifyOf[key];
      const verify = v ? { ...v, missing: v.missing.slice(0, 200),
        uploadRoute: `/api/migrations/${jobId}/import-wizard/zoho-export/${key}`,
        missingRoute: v.missingCount ? `/api/migrations/${jobId}/import-wizard/zoho-export/${key}/missing.csv` : null,
        missingFileName: v.missingCount ? `missing_rows_${f.fileName}` : null,
        // which later files name a missing record, in the order of the steps
        usedBy: Object.entries(namingMissing).filter(([, n]) => n[key]).map(([k, n]) => ({ key: k, module: files[k]?.module || k, names: n[key], rows: n.rows })),
        // the opening balance of a missing contact is missing from Accounts Receivable or Payable too
        balanceWords: v.missingWithBalance ? `${plural(v.missingWithBalance, 'missing row carries', 'missing rows carry')} an opening balance: it is missing from Zoho's ${key === 'customers' ? 'Accounts Receivable' : key === 'vendors' ? 'Accounts Payable' : 'opening balances'} until the row is imported. Import it after the Migration Date is saved.` : '' } : null;
      const stateWords = f.importState === 'missing_in_zoho' ? `Not finished: ${plural(v.missingCount, `${v.one} is`, `${v.many} are`)} missing in Zoho Books. The next steps stay locked until every one is there.`
        : f.importState === 'short' ? `Not finished: ${f.result.imported} of ${f.expectedRecords} ${v ? v.many : 'documents'} recorded as imported and none refused, so ${f.shortBy} ${f.shortBy === 1 ? 'is' : 'are'} not accounted for. ${v ? "Upload Zoho's export below so the tool can name them, or record the figure Zoho Books shows after the import (not the figure of the preview)." : "Record the refused rows, or upload Zoho's error file."}` : '';
      const tooLarge = guide.maxFileMb != null && f.sizeBytes != null && f.sizeBytes > guide.maxFileMb * 1024 * 1024;
      return { ...f, sha256: undefined, key, guide, expects, verify, stateWords, idColumn: guide.idColumn || t?.idColumn || null,
        tooLarge, sizeWords: tooLarge ? `The file is larger than the ${guide.maxFileMb} MB Zoho accepts for this import. Split it, keeping each document whole.` : null };
    }
  }

  // The wizard as it stands. A GET writes nothing (audit item 18): import_status is kept in step when the files are
  // created and when a result is recorded (syncImportStatus).
  const view = (job, user) => state(job, user);
  const findStep = (s, id) => (s.available ? s.steps.find(x => x.id === id) : null);

  // The TDS taxes to create in Zoho Books (name, rate, section code, tax act, start date) for the files as created.
  app.get('/api/migrations/:id/tds-taxes-to-create', (req, reply) => { const job = need(req, reply); if (!job) return; return tdsTaxesInFiles(db, job.id, job); });
  app.get('/api/migrations/:id/import-wizard', (req, reply) => { const job = need(req, reply); if (!job) return; return view(job, req.user); });

  // The step the person is on. Body: { step }.
  app.put('/api/migrations/:id/import-wizard/current', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const s = view(job, req.user);
    const step = findStep(s, String(req.body?.step || ''));
    if (!step) return reply.code(400).send({ error: 'That step is not in this migration\'s import wizard.' });
    db.prepare('INSERT OR REPLACE INTO wizard_state VALUES (?,?,?,?)').run(job.id, step.id, actor(req), now());
    return { ok: true, current: step.id };
  });

  // A tick. Body: { step: 'setup' | 'bank' | 'opening' | 'credits' | 'finish', item, done }.
  app.put('/api/migrations/:id/import-wizard/ticks', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const s = view(job, req.user);
    if (!s.available) return reply.code(409).send({ error: s.message });
    const stepId = String(req.body?.step || ''), item = String(req.body?.item || ''), done = req.body?.done !== false;
    const step = findStep(s, stepId);
    let what = null, value = null;
    if (step?.kind === 'setup') what = step.items.flatMap(i => i.ticks.map(t => ({ ...t, group: i.what }))).find(t => t.id === item);
    else if (step?.kind === 'bank') { const a = step.accounts.find(x => x.id === item); what = a && { text: `"${a.account}" is in Zoho Books`, group: 'Bank accounts' }; }
    else if (step?.kind === 'opening') { const l = step.lines.find(x => x.id === item); what = l && { text: `Opening balance of "${l.account}" typed in Zoho Books: ${l.amount} ${l.side}`, group: 'Opening balances' }; value = l ? `${l.side} ${l.amount}` : null; }
    else if (step?.kind === 'finish') what = step.ticks.map(t => ({ ...t, group: 'Last checks' })).find(t => t.id === item);
    else if (step?.kind === 'credits') what = step.ticks.map(t => ({ ...t, group: 'Apply the credits' })).find(t => t.id === item);
    else if (step?.kind === 'date') what = step.ticks.map(t => ({ ...t, group: 'Migration Date' })).find(t => t.id === item);
    if (!what) return reply.code(400).send({ error: 'That item is not on this step.' });
    if (step.locked && done) return reply.code(409).send({ error: step.lockReason, locked: true });
    if (done) db.prepare('INSERT OR REPLACE INTO wizard_ticks VALUES (?,?,?,?,?,?)').run(job.id, stepId, item, value, actor(req), now());
    else db.prepare('DELETE FROM wizard_ticks WHERE job_id = ? AND step = ? AND item = ?').run(job.id, stepId, item);
    audit(job.id, done ? 'import_wizard_ticked' : 'import_wizard_unticked', `${what.group}: ${what.text}`);
    return view(job, req.user);
  });

  // The date Zoho Books shows on Settings > Setup & Configurations > Opening Balances, for the step "Save the Migration
  // Date". Body: { date, source? }: the date as typed (31/03/2025, 2025-03-31, 31 Mar 2025), or as read from Zoho by
  // whoever has access to it (source 'zoho_api' / 'zoho_export'; the tool itself has no connection to Zoho Books).
  // An empty date removes it. The step is done only when this date IS the Migration Date; any other date is kept and
  // shown, and every later file stays locked.
  app.put('/api/migrations/:id/import-wizard/zoho-opening-date', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const s = view(job, req.user);
    if (!s.available) return reply.code(409).send({ error: s.message });
    const step = findStep(s, 'date');
    if (!step) return reply.code(409).send({ error: 'This migration has no Migration Date step: no file carries a balance that Zoho Books dates itself.' });
    const raw = String(req.body?.date ?? '').trim();
    if (raw === '') {
      db.prepare("DELETE FROM wizard_ticks WHERE job_id = ? AND step = 'date' AND item = 'd.zohoDate'").run(job.id);
      audit(job.id, 'import_wizard_unticked', 'Migration Date: the date Zoho Books shows was removed');
      return view(job, req.user);
    }
    if (step.locked) return reply.code(409).send({ error: step.lockReason, locked: true });
    const date = readTypedDate(raw);
    if (!date) return reply.code(400).send({ error: 'Type the date as Zoho Books shows it, for example 31/03/2025.' });
    const source = ['zoho_api', 'zoho_export'].includes(String(req.body?.source || '')) ? String(req.body.source) : 'typed';
    db.prepare('INSERT OR REPLACE INTO wizard_ticks VALUES (?,?,?,?,?,?)').run(job.id, 'date', 'd.zohoDate', date, actor(req), now());
    const ok = date === step.date.value;
    audit(job.id, ok ? 'migration_date_confirmed' : 'migration_date_differs',
      `Migration Date: Zoho Books shows the Opening Balance Date ${niceDate(date)} (${source === 'typed' ? 'typed in the Import Wizard' : source === 'zoho_api' ? 'read from Zoho Books' : 'read from a Zoho Books export'}); the Migration Date is ${step.date.nice}. ${ok ? 'They agree: the other files are open.' : 'They differ: the other files stay locked.'}`);
    const out = view(job, req.user);
    return ok ? out : reply.code(200).send({ ...out, dateDiffers: true });
  });

  // What happened in Zoho Books for one file ("Mark as imported"). Body: { imported, refused }.
  app.put('/api/migrations/:id/import-wizard/results/:key', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const s = view(job, req.user);
    if (!s.available) return reply.code(409).send({ error: s.message });
    const key = req.params.key;
    const step = s.steps.find(x => x.key === key) || s.steps.find(x => x.file?.key === key);
    const f = step?.file || step;
    if (!f?.key) return reply.code(404).send({ error: 'That file is not in this migration\'s import wizard.' });
    const whole = v => (typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v.trim())) ? Number(v) : NaN);
    const imported = whole(req.body?.imported), refused = whole(req.body?.refused ?? 0);
    if (!Number.isInteger(imported) || !Number.isInteger(refused) || imported < 0 || refused < 0) return reply.code(400).send({ error: 'Type the number of rows Zoho imported and the number it refused, as whole numbers.' });
    if (imported + refused === 0 && f.rows > 0) return reply.code(400).send({ error: 'Type how many rows Zoho imported.' });
    if (f.outOfDate) return reply.code(409).send({ error: staleMessage(job, `The ${f.module} file`, f.outOfDateReasons), outOfDate: true, reasons: f.outOfDateReasons });
    if (step.locked) return reply.code(409).send({ error: step.lockReason, locked: true });
    const sha = db.prepare('SELECT sha256 FROM generated_files WHERE job_id = ? AND key = ?').get(job.id, key).sha256;
    // fewer records than the file has and nothing refused is 'partial', not imported (resultStatus): the figure to
    // type is the one Zoho Books shows AFTER the import, not the "ready" figure of its preview
    const st = resultStatus(db, job.id, key, imported, refused);
    const expected = expectedRecords(db, job.id, key);
    tx(() => {
      db.prepare('INSERT OR REPLACE INTO wizard_results VALUES (?,?,?,?,?,?,?)').run(job.id, key, imported, refused, sha, actor(req), now());
      db.prepare('INSERT OR REPLACE INTO import_status VALUES (?,?,?,?,?)').run(job.id, key, st, st === 'imported' ? '' : `${imported} imported, ${refused} refused`, now());
    });
    audit(job.id, 'import_result_recorded', `${f.module}: ${imported} imported, ${refused} refused (${st})${st === 'partial' && refused === 0 && expected != null && imported < expected ? `; the file has ${expected} records, so the next steps stay locked` : ''}${step.override ? `; step unlocked with the reason "${step.override.reason}"` : ''}`);
    return view(job, req.user);
  });

  // Undo "Mark as imported".
  app.delete('/api/migrations/:id/import-wizard/results/:key', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const f = filesOf(job.id)[req.params.key];
    if (!f) return reply.code(404).send({ error: 'File not generated yet.' });
    tx(() => {
      db.prepare('DELETE FROM wizard_results WHERE job_id = ? AND key = ?').run(job.id, f.key);
      db.prepare("INSERT OR REPLACE INTO import_status VALUES (?,?,'downloaded','',?)").run(job.id, f.key, now());
    });
    audit(job.id, 'import_result_removed', `${f.module}: no longer marked as imported`);
    return view(job, req.user);
  });

  // Open a locked step anyway. Body: { reason } (typed, at least a few words).
  app.put('/api/migrations/:id/import-wizard/overrides/:step', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const s = view(job, req.user);
    const step = findStep(s, req.params.step);
    if (!step) return reply.code(404).send({ error: 'That step is not in this migration\'s import wizard.' });
    if (!step.blockers.length) return reply.code(409).send({ error: 'This step is not locked.' });
    // the Migration Date is a hard lock: a reason does not open it (Zoho cannot change the date once the balances are in)
    if (step.hardLocked) return reply.code(409).send({ error: `${step.blockers.find(b => b.hard).words} This lock cannot be opened with a reason: Zoho Books does not let the date be changed once customer or vendor opening balances exist.`, locked: true, hard: true });
    const reason = String(req.body?.reason || '').trim();
    if (reason.length < MIN_REASON) return reply.code(400).send({ error: `Type the reason for opening this step (at least ${MIN_REASON} characters).` });
    db.prepare('INSERT OR REPLACE INTO wizard_overrides VALUES (?,?,?,?,?,?)').run(job.id, step.id, reason, step.lockReason, actor(req), now());
    audit(job.id, 'import_lock_overridden', `${step.title}: opened although locked. Lock: ${step.lockReason} Reason typed: ${reason}`);
    return view(job, req.user);
  });
  app.delete('/api/migrations/:id/import-wizard/overrides/:step', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const had = db.prepare('SELECT * FROM wizard_overrides WHERE job_id = ? AND step = ?').get(job.id, req.params.step);
    if (!had) return reply.code(404).send({ error: 'This step was not opened with a reason.' });
    db.prepare('DELETE FROM wizard_overrides WHERE job_id = ? AND step = ?').run(job.id, req.params.step);
    audit(job.id, 'import_lock_restored', `Step "${req.params.step}": the lock applies again (reason removed: ${had.reason})`);
    return view(job, req.user);
  });

  // Zoho's own Chart of Accounts export of the new organisation (optional).
  app.get('/api/migrations/:id/import-wizard/zoho-accounts', (req, reply) => { const job = need(req, reply); if (!job) return; return zohoExistingAccounts(db, job.id); });
  app.put('/api/migrations/:id/import-wizard/zoho-accounts', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    if (!Buffer.isBuffer(req.body) || !req.body.length) return reply.code(400).send({ error: 'No file received.' });
    const read = readZohoAccounts(req.body);
    if (read.error) return reply.code(422).send({ error: read.error });
    const fileName = (() => { try { return decodeURIComponent(String(req.headers['x-filename'] || '')); } catch { return String(req.headers['x-filename'] || ''); } })();
    tx(() => {
      db.prepare('DELETE FROM zoho_existing_accounts WHERE job_id = ?').run(job.id);
      const ins = db.prepare('INSERT OR IGNORE INTO zoho_existing_accounts VALUES (?,?,?)');
      for (const a of read.accounts) ins.run(job.id, a.name, a.accountType);
      db.prepare('INSERT OR REPLACE INTO zoho_existing_accounts_meta VALUES (?,?,?,?,?)').run(job.id, fileName || null, read.accounts.length, actor(req), now());
    });
    audit(job.id, 'zoho_accounts_uploaded', `${read.accounts.length} account names read from Zoho's Chart of Accounts export${fileName ? ` "${fileName}"` : ''}`);
    // the export now says which ledgers are entered on Zoho's own accounts (the default) and what the check compares with
    db.prepare("DELETE FROM stale_reasons WHERE job_id = ? AND kind = 'setting:zoho_accounts_export'").run(job.id);
    markStale(job.id, `Zoho's Chart of Accounts export was given (${read.accounts.length} accounts): the ledgers named like one of Zoho's own accounts follow it.`, null, 'setting:zoho_accounts_export');
    return { ok: true, accounts: read.accounts.length, wizard: view(job, req.user) };
  });
  app.delete('/api/migrations/:id/import-wizard/zoho-accounts', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    tx(() => {
      db.prepare('DELETE FROM zoho_existing_accounts WHERE job_id = ?').run(job.id);
      db.prepare('DELETE FROM zoho_existing_accounts_meta WHERE job_id = ?').run(job.id);
    });
    audit(job.id, 'zoho_accounts_removed', "Zoho's Chart of Accounts export removed: the researched default list is used again");
    // given and removed again since the files were created: the files are as they were (no net change)
    const given = db.prepare("DELETE FROM stale_reasons WHERE job_id = ? AND kind = 'setting:zoho_accounts_export'").run(job.id).changes;
    if (!given) markStale(job.id, "Zoho's Chart of Accounts export was removed: the researched list of Zoho's own accounts is used again.", null, 'setting:zoho_accounts_export');
    return { ok: true, wizard: view(job, req.user) };
  });

  // ----- did the records arrive? Zoho's own export of a master, taken AFTER its import (zohoverify.js) -----
  // PUT    .../import-wizard/zoho-export/:kind   the export file (CSV, XLSX, XLS) of accounts | customers | vendors | items;
  //        or JSON { names: [name | { name, openingBalance }], source: 'zoho_api' } from whoever read Zoho Books itself
  // DELETE .../import-wizard/zoho-export/:kind   forget it
  // GET    .../import-wizard/zoho-export/:kind/missing.csv   only the rows of the file Zoho Books does not have
  // The later steps of the wizard stay locked while a record is missing, and the Zoho check marks the rows of later
  // files that name one. Uploading again after the missing rows were imported opens them.
  const refreshImportStatus = (jobId, key) => {
    const f = db.prepare('SELECT sha256 FROM generated_files WHERE job_id = ? AND key = ?').get(jobId, key);
    const r = db.prepare('SELECT * FROM wizard_results WHERE job_id = ? AND key = ?').get(jobId, key);
    if (!f || !r || r.file_sha !== f.sha256) return;
    const st = resultStatus(db, jobId, key, r.imported, r.refused);
    db.prepare('INSERT OR REPLACE INTO import_status VALUES (?,?,?,?,?)').run(jobId, key, st, st === 'imported' ? '' : `${r.imported} imported, ${r.refused} refused`, now());
  };
  const kindOf = (req, reply) => {
    const kind = String(req.params.kind || '');
    if (!isVerifyKind(kind)) { reply.code(404).send({ error: 'That list cannot be checked against Zoho Books. Use accounts, customers, vendors or items.' }); return null; }
    return kind;
  };
  app.put('/api/migrations/:id/import-wizard/zoho-export/:kind', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const kind = kindOf(req, reply); if (!kind) return;
    const k = VERIFY_KINDS[kind];
    const f = filesOf(job.id)[kind];
    if (!f) return reply.code(409).send({ error: `This migration has no ${ALL_FILES[kind]?.module || kind} file.` });
    let names, source = 'zoho_export', format = null;
    if (Buffer.isBuffer(req.body)) {
      if (!req.body.length) return reply.code(400).send({ error: 'No file received.' });
      const read = readZohoExport(req.body, kind);
      if (read.error) return reply.code(422).send({ error: read.error });
      names = read.names; format = read.format;
    } else if (Array.isArray(req.body?.names)) {
      names = req.body.names.filter(x => String(typeof x === 'string' ? x : x?.name ?? '').trim());
      if (!names.length) return reply.code(400).send({ error: `The list has no ${k.one} in it.` });
      source = 'zoho_api';
    } else return reply.code(400).send({ error: 'No file received.' });
    const fileName = (() => { try { return decodeURIComponent(String(req.headers['x-filename'] || '')); } catch { return String(req.headers['x-filename'] || ''); } })();
    let stored = 0;
    tx(() => { stored = storeArrived(db, job.id, kind, names, { fileName: fileName || null, source, by: actor(req), at: now() }); refreshImportStatus(job.id, kind); });
    const v = verifyMaster(db, job.id, kind);
    audit(job.id, 'zoho_export_checked', `${f.module}: ${stored} ${stored === 1 ? k.one : k.many} read from ${source === 'zoho_api' ? 'Zoho Books' : `Zoho's export${fileName ? ` "${fileName}"` : ''}${format ? ` (${format.toUpperCase()})` : ''}`}. The file has ${v.expected}; ${v.missingCount ? `${v.missingCount} ${v.missingCount === 1 ? 'is' : 'are'} not in Zoho Books (rows ${v.missing.slice(0, 20).map(m => m.fileRow).join(', ')}${v.missingCount > 20 ? ', and more' : ''})` : 'all of them are in Zoho Books'}.`);
    // Every record of the file is in Zoho Books and nothing was recorded for the step yet: the export is the proof of
    // the import, so the result is recorded from it (nothing to type). Not while the step is locked or the file is
    // out of date: the same conditions as "Mark as imported".
    if (v.state === 'all_there') {
      const st = view(job, req.user).steps?.find(x => x.key === kind);
      if (st && !st.locked && !st.outOfDate && !st.result) {
        tx(() => {
          db.prepare('INSERT OR REPLACE INTO wizard_results VALUES (?,?,?,?,?,?,?)').run(job.id, kind, v.expected, 0, f.sha256, actor(req), now());
          db.prepare("INSERT OR REPLACE INTO import_status VALUES (?,?,'imported','',?)").run(job.id, kind, now());
        });
        audit(job.id, 'import_result_recorded', `${f.module}: ${v.expected} imported, 0 refused (imported): recorded from Zoho's own list, which has every ${k.one} of the file`);
      }
    }
    return { ok: true, records: stored, verify: v, wizard: view(job, req.user) };
  });
  app.delete('/api/migrations/:id/import-wizard/zoho-export/:kind', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const kind = kindOf(req, reply); if (!kind) return;
    let had = false;
    tx(() => { had = removeArrived(db, job.id, kind); refreshImportStatus(job.id, kind); });
    if (had) audit(job.id, 'zoho_export_removed', `${ALL_FILES[kind]?.module || kind}: Zoho's export was removed; the records of this file are no longer checked against Zoho Books.`);
    return { ok: true, wizard: view(job, req.user) };
  });
  app.get('/api/migrations/:id/import-wizard/zoho-export/:kind/missing.csv', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const kind = kindOf(req, reply); if (!kind) return;
    const stale = staleInfo(job.id).forFile(kind);
    if (stale.length) return reply.code(409).send({ error: staleMessage(job, `The ${ALL_FILES[kind]?.module || kind} file`, stale), outOfDate: true, reasons: stale });
    const out = missingRowsCsv(db, job.id, kind);
    if (!out) return reply.code(404).send({ error: `Nothing is missing: give Zoho's export of the ${VERIFY_KINDS[kind].many} first, or every ${VERIFY_KINDS[kind].one} of the file is already in Zoho Books.` });
    audit(job.id, 'download', `${ALL_FILES[kind]?.module || kind}: the file with the ${out.rows} row${out.rows === 1 ? '' : 's'} Zoho Books does not have (${out.fileName})`);
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${out.fileName}"`).send(out.csv);
  });

  // Download all: one zip of every current file, numbered in import order, with a short READ_ME_IMPORT_ORDER.txt.
  app.get('/api/migrations/:id/download-all', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const s = view(job, req.user);
    if (!s.available) return reply.code(409).send({ error: s.message });
    const files = filesOf(job.id);
    // "Download anyway" is enforced here too, not only on the screen (audit item 18): a file with rows Zoho is expected
    // to refuse goes in the zip only once someone confirmed it (POST zoho-check/acknowledge, or ?confirmed=1)
    const blocked = downloadBlockers(db, job, null, { staleInfo, now, confirmed: ['1', 'true'].includes(String(req.query?.confirmed || '')), by: actor(req), audit, record: req.user?.role !== 'viewer' });
    if (blocked.length) return reply.code(409).send({ error: downloadBlockedMessage(blocked), needsConfirmation: true, files: blocked });
    const built = buildZip(job, s, files);
    if (!built.included.length) return reply.code(409).send({ error: built.missing.length ? `${built.missing.join(', ')}: the file is not on the server any more. Create the files again.` : staleMessage(job, 'Every file', staleInfo(job.id).outOfDateReasons.map(r => r.reason)), outOfDate: !built.missing.length });
    // marked as downloaded for the Import Tracker; a viewer's download changes nothing (only the audit log records it)
    if (req.user?.role !== 'viewer') tx(() => { for (const k of built.included) db.prepare("INSERT INTO import_status VALUES (?,?,'downloaded','',?) ON CONFLICT (job_id, key) DO NOTHING").run(job.id, k, now()); });
    audit(job.id, 'download', `all files in one zip (${built.included.length} to import${built.reference.length ? `, ${built.reference.length} for reference` : ''}${built.leftOut.length ? `; left out because out of date: ${built.leftOut.join(', ')}` : ''}${built.missing.length ? `; left out because not on the server: ${built.missing.join(', ')}` : ''})`);
    return reply.header('content-type', 'application/zip').header('content-disposition', `attachment; filename="zoho-import-${job.id}.zip"`).send(built.zip);
  });

  // files: generated_files rows by key. Returns { zip, included: [key], reference: [key], leftOut: [module] }.
  function buildZip(job, s, files) {
    const entries = [], included = [], reference = [], leftOut = [], missing = [];
    const read = p => { try { return fs.readFileSync(p); } catch { return null; } }; // a file removed from disk is left out, never a 500
    const two = n => String(n).padStart(2, '0');
    const lines = [`Import order for ${job.company}, financial year ${job.financial_year}`, '',
      'Import the files below in this order. The Import Wizard in the tool shows each step and what to do when Zoho refuses rows.', '',
      ...whileImportingLines()];
    let fileNo = 0;
    for (const step of s.steps) {
      const f = step.file || (step.key ? step : null);
      if (!f) {
        lines.push(`Step ${step.n}. ${step.title} (no file)`);
        if (step.kind === 'setup') for (const i of step.items) lines.push(`   - ${i.what}: ${i.paths.map(p => p.join(' > ')).join('; ')}`);
        if (step.kind === 'setup') for (const q of step.questions || []) lines.push(`   - ${q.text} Answered in the tool: ${q.options.find(o => o.id === q.value)?.label || q.value}.${q.id === 'hsnEnabled' && q.value === 'off' ? ' The HSN/SAC column is left empty; the field must be switched off in Zoho Books (Settings > Module Settings > General > Items, tab Preferences).' : ''}`);
        else if (step.kind === 'date') lines.push(...dateStepLines(step).map(l => `   ${l}`));
        else if (step.kind === 'bank') lines.push(...step.lines.map(l => `   ${l}`), `   The accounts to check: ${step.accounts.map(a => `"${a.account}" (${a.accountType})`).join(', ')}.`);
        else if (step.kind === 'opening') lines.push('   These files have no opening balance journal for these balances. Type each balance shown in the Import Wizard, step "Opening balances", once, in Zoho Books: Settings > Setup & Configurations > Opening Balances.');
        else if (step.kind === 'credits') lines.push(...step.lines.map(l => `   ${l}`), `   The list: not_for_import/${step.fileName} (${plural(step.rows, 'row')}).`);
        else if (step.kind === 'finish') lines.push(`   ${step.ticks.map(t => t.text).join(' ')}`);
        lines.push('');
        continue;
      }
      fileNo++;
      const name = `${two(fileNo)}_${f.fileName}`;
      if (f.outOfDate) { leftOut.push(f.module); lines.push(`Step ${step.n}. ${f.module}: NOT IN THIS ZIP. The file is out of date. Create the files again.`, ''); continue; }
      const data = read(files[f.key].path);
      if (!data) { missing.push(f.module); lines.push(`Step ${step.n}. ${f.module}: NOT IN THIS ZIP. The file is not on the server any more. Create the files again.`, ''); continue; }
      entries.push({ name, data });
      included.push(f.key);
      const g = f.guide;
      lines.push(`Step ${step.n}. ${name} (${f.rows} rows) - ${f.module}`);
      if (f.itemsNotNeeded) lines.push('   No line of this file names an item, so it does not wait for the Items file.');
      if (g.clicks.length) lines.push(`   Click: ${g.clicks.map(c => c.text).join(' > ')}`);
      if (g.defaults.length) lines.push(`   Leave as it is: ${g.defaults.join('; ')}`);
      if (g.doNotMap.length) lines.push(`   Do not map: ${g.doNotMap.join(', ')}`);
      // after a master file: check that every record arrived. Zoho's preview can say "ready" for a row it then leaves out
      if (f.verify) {
        const v = f.verify;
        lines.push(`   CHECK AFTER THE IMPORT: Zoho Books must list ${plural(v.expected, v.one)} from this file (${v.listPath})${v.withBalance ? `, ${v.withBalance} of them with an opening balance` : ''}.`,
          `   The figure of the preview is not enough. Export from Zoho Books (${v.exportPath}) and upload that file in the Import Wizard, step "${step.title}": the tool names every ${v.one} that is missing and gives a file with only those rows.`,
          `   Do not import a later file that names a missing ${v.one}: Zoho Books refuses the row ("Invalid row").`);
      } else if (f.expects?.records != null && f.expects.records !== f.rows) {
        const [one, many] = f.key === 'bills' ? ['bill', 'bills'] : f.key === 'invoices' ? ['invoice', 'invoices'] : ['journal', 'journals'];
        lines.push(`   After the import Zoho Books must show ${plural(f.expects.records, one, many)} from this file.`);
      }
      // what to know about this file in particular (the general entries are at the top)
      for (const t of (g.tips || []).filter(x => !x.general && !(f.verify && x.id === 'count-after-the-import'))) lines.push(`   Good to know: ${t.text}`);
      lines.push('');
    }
    for (const [key, f] of Object.entries(files)) {
      if (!ALL_FILES[key]?.referenceOnly || staleInfo(job.id).forFile(key).length) continue;
      const data = read(f.path);
      if (!data) continue;
      entries.push({ name: `not_for_import/${f.file_name}`, data });
      reference.push(key);
    }
    // Payments Received and Payments Made built from the Zoho sample the user uploaded (heldfiles.js): last, because every
    // invoice, bill, contact and account they refer to is imported before
    try {
      const held = heldFilesOf(db, job.id);
      if (held.length) {
        lines.push('Payments built from the Zoho import sample you uploaded (import them after every file above):');
        for (const h of held) {
          fileNo++;
          const name = `${two(fileNo)}_${h.name}`;
          entries.push({ name, data: h.data });
          lines.push(`   ${name} (${h.rows} rows, ${plural(h.vouchers, 'voucher')}) - ${h.module}`, `   Click: ${h.importPath}`);
          for (const n of h.notes) lines.push(`   - ${n}`);
        }
        lines.push('');
      }
    } catch { /* a held file that cannot be built is simply not in the zip */ }
    // the TDS taxes the files name: create them in Zoho Books first (Settings > Taxes & Compliance > Direct Taxes > Income TDS Rates)
    try {
      const tds = tdsTaxesInFiles(db, job.id, job);
      const missing = tds.taxes.filter(t => t.inZoho !== true);
      if (missing.length) {
        lines.push(tds.exportGiven ? 'TDS taxes to create in Zoho Books (the TDS export you gave does not have them):' : 'TDS taxes the files name (create the ones Zoho Books does not have yet; give the tool the TDS export of your Zoho organisation to see which):',
          '   Settings > Taxes & Compliance > Direct Taxes > Income TDS Rates > + New TDS Tax. Choose the tax act first.');
        for (const t of missing) lines.push(`   - ${t.name}: ${t.rate}%, section code ${t.section}, ${t.actWords}, start date ${niceDate(t.startDate) || 'on or before the first day of the financial year'}`);
        lines.push('');
      }
    } catch { /* the list is a help; the zip does not depend on it */ }
    // the credits to apply (customer and vendor lines of the journals): a list for the person, never imported
    let creditsIn = false;
    try {
      const csv = s.steps.some(x => x.kind === 'credits') && included.some(k => ['journals', 'other_journals'].includes(k)) ? creditsCsv(db, job.id) : null;
      if (csv) { entries.push({ name: `not_for_import/${CREDITS_FILE}`, data: Buffer.from(csv, 'utf8') }); creditsIn = true; }
    } catch { creditsIn = false; }
    // the trial balance Zoho Books should show, worked out from these files and compared with Tally (predictedtb.js):
    // a list for the person, never imported, so a difference is seen before the first import
    let expected = null;
    try {
      const p = included.length && deps.predictedTb ? deps.predictedTb(job.id) : null;
      if (p?.available && p.comparison) { entries.push({ name: `not_for_import/${PREDICTED_FILE}`, data: Buffer.from(predictedCsv(p), 'utf8') }); expected = p; }
    } catch { expected = null; }
    const expectedLines = expected ? ['The trial balance Zoho Books should show after these files (worked out by the tool, compared with the Tally Trial Balance)',
      `   ${expected.words}`, ...expected.leftOut.map(l => `   ${l}`),
      `   The list account by account: not_for_import/${PREDICTED_FILE}. After the last import, compare the real trial balance of Zoho Books with Tally (last step of the Import Wizard).`, ''] : [];
    lines.push(...expectedLines);
    const holds = [creditsIn ? `the list ${CREDITS_FILE} (which invoice or bill each journal credit pays, see the step "Apply the credits")` : '', expected ? `the list ${PREDICTED_FILE} (the trial balance Zoho Books should show, against Tally)` : '', reference.length ? 'reports for checking only' : ''].filter(Boolean);
    if (holds.length) lines.push(`The folder not_for_import holds ${list(holds)}. Do not import them.`, '');
    // vouchers in no file: the counts, the reason and the sample to upload (in both read-me files)
    let heldText = [];
    try { heldText = heldLines(heldState(db, job.id, deps.voucherControl ? deps.voucherControl(job.id) : null)); } catch { heldText = []; }
    lines.push(...heldText);
    entries.unshift({ name: 'READ_ME_IMPORT_ORDER.txt', data: lines.join('\r\n') });
    let assumptions = null;
    try { assumptions = deps.assumptions ? deps.assumptions(job.id) : null; } catch { assumptions = null; }
    entries.unshift({ name: 'READ_ME_FIRST.txt', data: readMeFirst(job, s, [...heldText, ...expectedLines], { assumptions }).join('\r\n') });
    return { zip: included.length ? zipStore(entries) : null, included, reference, leftOut, missing };
  }

  return { wizardState: view, zohoExistingAccounts: jobId => zohoExistingAccounts(db, jobId) };
}

// One call for index.js: the wizard's tables and routes, and the completeness table.
// deps: { db, need, audit, now, tx, staleInfo, staleMessage, generatedKeys, voucherControl, slots, slotName,
//         accountRecords, chartRecords, bankOpeningBalances? }
export function registerImportSteps(app, deps) {
  setupImportWizard(deps.db);
  registerCompletenessTable(app, deps);
  return registerImportWizard(app, deps);
}
