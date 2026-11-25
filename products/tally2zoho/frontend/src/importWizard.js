// Small rules of the Import Wizard screen. Plain JavaScript with no React, so they can be tested with node
// (frontend/test/importWizard.test.js).

export const WIZARD_SCREEN = 'screen-40';

// { index, prev, next } of a step in the wizard's list. An unknown id is read as the first step.
export function stepPosition(steps, id) {
  const list = Array.isArray(steps) ? steps : [];
  const found = list.findIndex(s => s.id === id);
  const index = found < 0 ? 0 : found;
  return { index, step: list[index] || null, prev: list[index - 1] || null, next: list[index + 1] || null, total: list.length };
}

// How a step is shown in the side list: 'done', 'locked', 'attention' (rows were refused) or 'open'.
export function stepMark(step) {
  if (!step) return 'open';
  if (step.kind === 'held' && !step.done) return 'held'; // vouchers in no file yet: an open item
  if (step.done) return 'done';
  if (step.locked) return 'locked';
  const f = step.file || step;
  // rows refused, or Zoho Books has fewer records than the file (its export lacks some, or the figure recorded is short)
  if (['refused', 'failed', 'missing_in_zoho', 'short'].includes(f.importState)) return 'attention';
  return 'open';
}

// What the Zoho check (GET /migrations/:id/zoho-check, built separately) expects for one file: how many rows Zoho
// will accept and how many it will refuse. The answer's layout is read tolerantly: per file under files, modules,
// results or checks (a list with key / file / module, or an object by key), with the counts under any of the usual
// names. Returns { accepted, refused, rows } or null when nothing usable is there.
export function expectedFromZohoCheck(data, key) {
  if (!data || typeof data !== 'object' || !key) return null;
  let entry = null;
  for (const pool of [data.files, data.modules, data.results, data.checks, data.byFile]) {
    if (!pool || typeof pool !== 'object') continue;
    if (Array.isArray(pool)) entry = pool.find(x => x && typeof x === 'object' && [x.key, x.file, x.fileKey, x.module].includes(key)) || null;
    else if (pool[key] && typeof pool[key] === 'object') entry = pool[key];
    if (entry) break;
  }
  if (!entry) return null;
  const read = (...names) => {
    for (const name of names) {
      const v = name.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), entry);
      if (typeof v === 'number' && Number.isFinite(v)) return v;
    }
    return null;
  };
  const accepted = read('expectedAccepted', 'accepted', 'willBeAccepted', 'rowsAccepted', 'expected.accepted', 'summary.accepted', 'counts.accepted');
  const refused = read('expectedRefused', 'refused', 'rowsWill', 'willBeRefused', 'rowsRefused', 'expected.refused', 'summary.refused', 'counts.refused');
  if (accepted == null && refused == null) return null;
  return { accepted, refused, mayBeRefused: read('rowsMay', 'mayBeRefused', 'summary.may'), rows: read('rows', 'total', 'rowsChecked', 'summary.rows', 'counts.rows') };
}

// The files of a download that the Zoho check expects Zoho Books to refuse rows of ("will be refused"): these are
// downloaded only after "Download anyway". keys: the files downloaded (all files of the check when null).
// Also the files whose opening balances wait for the Migration Date (download 'confirm_date'): nothing is refused, but
// the file must not be imported before the date is saved and checked in Zoho Books (waitsForDate, dateRows).
// Returns [{ key, module, rows, rowsWill, waitsForDate?, dateRows? }].
export function refusedFiles(check, keys = null) {
  if (!check?.available || !Array.isArray(check.files)) return [];
  return check.files.filter(f => f && (f.rowsWill > 0 || f.blocking || f.download === 'confirm_date') && !f.outOfDate && (!keys || keys.includes(f.key)))
    .map(f => ({ key: f.key, module: f.module || f.key, rows: f.rows, rowsWill: f.rowsWill, ...(f.download === 'confirm_date' ? { waitsForDate: true, dateRows: f.dateRows || 0 } : {}) }));
}
// The words of the "Download anyway" question for those files, in plain sentences.
export function refusedWords(files) {
  const n = v => Number(v || 0).toLocaleString('en-IN');
  const refused = files.filter(f => f.rowsWill > 0), date = files.filter(f => f.waitsForDate && !(f.rowsWill > 0));
  const out = [];
  if (refused.length === 1) out.push(`Zoho Books is expected to refuse ${n(refused[0].rowsWill)} of ${n(refused[0].rows)} rows of ${refused[0].module}. Fix them first, or download anyway.`);
  else if (refused.length) out.push(`Zoho Books is expected to refuse rows of ${refused.length} files: ${refused.map(f => `${f.module} ${n(f.rowsWill)} of ${n(f.rows)}`).join(', ')}. Fix them first, or download anyway.`);
  if (date.length) out.push(`${date.map(f => `${f.module} (${n(f.dateRows)} opening ${f.dateRows === 1 ? 'balance' : 'balances'})`).join(' and ')} must not be imported before the Migration Date is saved and checked in Zoho Books (Import Wizard, step "Save the Migration Date"). You may download now, but import ${date.length === 1 ? 'it' : 'them'} only after that step.`);
  return out;
}

// What to choose on Zoho's import screens, one line each, from a file step's guide (GET /import-wizard):
// the options of the click path with the reason the rules give, then what to leave as it is.
// Returns [{ label, value, why, others: [text], keep }].
export function optionLines(guide) {
  if (!guide) return [];
  const notes = Array.isArray(guide.notes) ? guide.notes : [];
  const out = [];
  const seen = new Set();
  for (const c of Array.isArray(guide.clicks) ? guide.clicks : []) {
    if (!c?.option) continue;
    const label = c.label || c.text;
    const note = notes.find(n => n.label === label || n.label === c.text);
    out.push({ label, value: c.value || '', why: note?.why || null, others: note?.others || [], keep: false });
    seen.add(label);
  }
  for (const n of notes) if (!seen.has(n.label) && n.value) { out.push({ label: n.label, value: n.value, why: n.why || null, others: n.others || [], keep: false }); seen.add(n.label); }
  for (const d of Array.isArray(guide.defaults) ? guide.defaults : []) {
    const i = String(d).indexOf(':');
    out.push(i > 0 ? { label: d.slice(0, i).trim(), value: d.slice(i + 1).trim(), why: null, others: [], keep: true } : { label: d, value: '', why: null, others: [], keep: true });
  }
  return out;
}

// The Trial Balance comparison (GET /zoho-trial-balance) in one word for the last step:
// 'none' (Zoho's Trial Balance not uploaded), 'problem' (cannot be compared), 'differs' or 'agrees'.
// Returns { state, accounts: accounts that differ or are on one side only }.
export function trialBalanceState(view) {
  if (!view || !view.check) return { state: 'none', accounts: 0 };
  if (view.problem || !view.comparison) return { state: 'problem', accounts: 0 };
  const c = view.comparison.counts || {};
  const accounts = (c.differing || 0) + (c.onlyTally || 0) + (c.onlyZoho || 0);
  return { state: accounts === 0 ? 'agrees' : 'differs', accounts };
}

// The step shown: the one named in the address (#/import-wizard?step=customers) when it is a step of this wizard,
// else the one the server remembers (fallback), else the first.
export function stepFromParams(steps, params, fallback) {
  const list = Array.isArray(steps) ? steps : [];
  const wanted = params?.step;
  if (wanted && list.some(s => s.id === wanted)) return wanted;
  if (fallback && list.some(s => s.id === fallback)) return fallback;
  return list[0]?.id || null;
}

// The "Not in any file yet" step (GET held-vouchers): vouchers held because Zoho's import sample of their module is
// missing. It is an open item, never done while any voucher is held, and comes just before the trial balance comparison
// (which cannot reach zero without them). The steps are numbered again. held: { notInAnyFile, modules, words }.
export const HELD_STEP = 'held';
export function withHeldStep(steps, held) {
  const list = (Array.isArray(steps) ? steps : []).filter(s => s.id !== HELD_STEP);
  if (!held || !(held.notInAnyFile > 0)) return list.map((s, i) => ({ ...s, n: i + 1 }));
  const step = { id: HELD_STEP, kind: 'held', title: 'Not in any file yet', short: 'Not in any file yet', done: false, locked: false, blockers: [], held };
  const at = list.findIndex(s => s.kind === 'finish');
  const out = at < 0 ? [...list, step] : [...list.slice(0, at), step, ...list.slice(at)];
  return out.map((s, i) => ({ ...s, n: i + 1 }));
}

// The page "Apply the credits" (step kind 'credits'; rows of GET credits-to-apply: { 'Contact Type', Contact,
// 'Journal Number', 'Journal Date', 'What To Do', 'Invoice or Bill Number', Amount, Note, what }).
// what: 'apply' (to the invoice or bill named), 'opening_balance' (a document from before the migration) or 'leave'
// (stays a credit, as in Tally). show: one of those, or 'all'. Returns the rows grouped by contact, in the order
// given: [{ contact, contactType, rows: [row], amount (the rows added up, 2 decimals) }].
export const CREDIT_FILTERS = [
  { id: 'apply', label: 'To apply' },
  { id: 'opening_balance', label: 'Opening balance' },
  { id: 'leave', label: 'Stays a credit' },
  { id: 'all', label: 'All' },
];
export function creditGroups(list, show = 'apply') {
  const out = [];
  const at = new Map();
  for (const r of Array.isArray(list) ? list : []) {
    if (!r || (show !== 'all' && r.what !== show)) continue;
    const key = `${r['Contact Type']}\u0001${r.Contact}`;
    if (!at.has(key)) { at.set(key, { contact: r.Contact, contactType: r['Contact Type'], rows: [], paise: 0 }); out.push(at.get(key)); }
    const g = at.get(key);
    g.rows.push(r);
    g.paise += Math.round(Number(r.Amount || 0) * 100);
  }
  return out.map(({ paise, ...g }) => ({ ...g, amount: (paise / 100).toFixed(2) }));
}
// The first filter that has rows (what the page opens on): rows to apply, else the opening balance rows, else all.
export function firstCreditFilter(counts) {
  const has = id => (Array.isArray(counts) ? counts : []).some(c => c.id === id && c.rows > 0);
  return has('apply') ? 'apply' : has('opening_balance') ? 'opening_balance' : 'all';
}

// One import order everywhere: the order of the server's import list (GET imports, taken from the Zoho rules, the same
// order as the wizard's steps). order: [key] or [{ key }]. Items whose key is not in the order keep their place after
// the ordered ones, in the order they came.
export function sortByImportOrder(items, order, keyOf = x => x?.key) {
  const keys = (Array.isArray(order) ? order : []).map(o => (typeof o === 'string' ? o : o?.key));
  const rank = new Map(keys.map((k, i) => [k, i]));
  return (Array.isArray(items) ? items : []).map((x, i) => ({ x, i, r: rank.has(keyOf(x)) ? rank.get(keyOf(x)) : Infinity }))
    .sort((a, b) => a.r - b.r || a.i - b.i).map(o => o.x);
}

// A row of the completeness table (GET completeness-table) in one word: 'matches', 'explained', 'not_matched',
// 'no_files', or 'not_in_file' when vouchers of the row are held for a Zoho sample or wait for routing: they are in
// no file yet, an open item, never "Explained".
export function completenessRowState(row) {
  if (!row) return 'no_files';
  if (row.status === 'not_matched' || row.status === 'no_files') return row.status;
  if ((row.reasons || []).some(r => String(r.kind).startsWith('held:') || r.kind === 'awaiting_routing')) return 'not_in_file';
  return row.status === 'matches' ? 'matches' : 'explained';
}
// A count difference (Tally less Zoho) in words: 0, 3 (fewer in Zoho), or "3 more in Zoho".
export const countDifferenceWords = n => (n == null ? '–' : n < 0 ? `${Number(-n).toLocaleString('en-IN')} more in Zoho` : Number(n).toLocaleString('en-IN'));

// "Do this first in Zoho Books": the steps to do by hand before an import, in one shape whatever they come from.
// From the Zoho check (GET zoho-check preSteps, or Prepare's zohoCheck.preSteps: { what, where, then, rows, files }) or
// from the wizard's Chart of Accounts step (createFirst: { accounts: [{ account, accountType }], path: [..], words }).
// Returns [{ what, path: [part], then, rows, accounts: [{ account, accountType }], files: [key] }].
export function preStepList(source) {
  if (!source) return [];
  const pathOf = where => (Array.isArray(where) ? where : String(where || '').split('>').map(s => s.trim()).filter(Boolean));
  if (!Array.isArray(source) && typeof source === 'object' && Array.isArray(source.accounts)) {
    if (!source.accounts.length) return [];
    return [{ id: null, what: source.words || '', path: pathOf(source.path), then: null, rows: source.accounts.length, accounts: source.accounts, files: ['accounts'] }];
  }
  return (Array.isArray(source) ? source : []).filter(p => p && (p.what || p.where))
    .map(p => ({ id: p.id || null, what: p.what || '', path: pathOf(p.where), then: p.then || null, rows: p.rows ?? null, accounts: Array.isArray(p.accounts) ? p.accounts : [], files: Array.isArray(p.files) ? p.files : [] }));
}

// A download confirmed with "Download anyway". A viewer cannot record the confirmation (POST acknowledge), so the
// request itself says so: ?confirmed=1 (the server then writes only the audit log). Others acknowledge first and
// download the plain address.
export function downloadAddress(url, { viewer = false, confirmed = false } = {}) {
  if (!viewer || !confirmed) return url;
  return `${url}${url.includes('?') ? '&' : '?'}confirmed=1`;
}

// The set-up item "TDS taxes" (uploadTds of GET import-wizard): the line said under the upload button.
export function tdsUploadWords(u) {
  if (!u) return '';
  if (!u.given) return 'No file yet. The files use the TDS names the tool suggests from the section in Tally; create them in Zoho Books with exactly those names, or upload the export.';
  const n = Number(u.taxes || 0);
  return `${n.toLocaleString('en-IN')} TDS ${n === 1 ? 'tax' : 'taxes'} read${u.fileName ? ` from "${u.fileName}"` : ''}. The files use these names. Create the files again if they were created before.`;
}

// "1,234" for counts; a dash when there is none.
export const count = n => (n == null ? '–' : Number(n).toLocaleString('en-IN'));

// The trial balance Zoho Books should show, worked out from the files before any import (GET predicted-trial-balance,
// server predictedtb.js), in a few words and rows for the page. state: 'none' (no files yet), 'problem' (nothing to
// compare with), 'agrees', 'rounding' (only differences of a rupee or less) or 'differs'.
// rows: [{ part: 'Account' | 'Customer' | 'Vendor' | 'Must end at zero', name, tally, zoho, difference, rounding, from }]
// with the amounts as { amount, side } and from: the files the expected figure comes from, in words.
export function expectedTbState(p) {
  if (!p || !p.available) return { state: 'none', rows: [], headline: p?.message || '' };
  if (!p.comparison) return { state: 'problem', rows: [], headline: p.words || p.problem || '' };
  const c = p.comparison;
  const from = r => (r.sources || []).map(s => s.label).join(', ');
  const rows = [
    ...(c.mustBeZero || []).filter(z => !z.ok).map(z => ({ part: 'Must end at zero', name: z.account, tally: z.expected, zoho: z.predicted, difference: z.predicted, rounding: false, from: from(z), words: z.words || '' })),
    ...(c.accounts?.differing || []).map(r => ({ part: 'Account', name: r.account, tally: r.tally, zoho: r.zoho, difference: r.difference, rounding: !!r.rounding, from: from(r) })),
    ...(c.accounts?.onlyTally || []).map(r => ({ part: 'Account', name: r.account, tally: r.tally, zoho: r.zoho, difference: r.difference, rounding: !!r.rounding, from: 'In Tally only: no file posts to it' })),
    ...(c.accounts?.onlyZoho || []).map(r => ({ part: 'Account', name: r.account, tally: { amount: '0.00', side: '' }, zoho: r.zoho, difference: r.zoho, rounding: !!r.rounding, from: from(r) })),
    ...['customers', 'vendors'].flatMap(side => (c.contacts?.[side]?.rows || []).map(r => ({ part: side === 'customers' ? 'Customer' : 'Vendor', name: r.contact, tally: r.tally, zoho: r.zoho, difference: r.difference, rounding: !!r.rounding, from: r.notInTally ? 'Not a customer or vendor in Tally' : '' }))),
  ];
  const real = rows.filter(r => !r.rounding).length;
  const state = !rows.length ? 'agrees' : real === 0 ? 'rounding' : 'differs';
  return { state, rows, real, headline: p.words || '' };
}

// The check that the records of a master file really arrived in Zoho Books (wizard file step .verify, server
// zohoverify.js): 'not_given' (no export yet), 'all_there' or 'missing', with the tone to show it in.
export function verifyTone(v) {
  if (!v) return null;
  return v.state === 'missing' ? 'warning' : v.state === 'all_there' ? 'success' : 'info';
}

// ---------- words of the pages, from the server's fields (GET /import-wizard, GET held-vouchers) ----------

// Why vouchers are in no file, in one or two sentences (the "Not in any file yet" step, the notice on other screens and
// the dashboard). Under the default route (Manual Journals) nothing is held for a module; vouchers are held for a module
// only when Payments files were chosen in Voucher files, so the words say how to bring them in now. held: GET
// held-vouchers ({ modules: [{ module, vouchers, file? }], awaitingRouting }).
export function heldWords(held) {
  const modules = Array.isArray(held?.modules) ? held.modules : [];
  const out = [];
  const waiting = modules.filter(m => !m.file?.buildable);
  if (modules.length) out.push(`${modules.map(m => `${m.module} ${Number(m.vouchers || 0).toLocaleString('en-IN')}`).join(', ')}.`);
  if (waiting.length) out.push('They are held because Payments files were chosen in Voucher files instead of the default, Manual Journals. Choose Manual Journals there and create the files again to bring them in now, or add Zoho\'s import sample for each module.');
  const routing = Number(held?.awaitingRouting || 0);
  if (routing > 0) out.push(`${routing.toLocaleString('en-IN')} journal ${routing === 1 ? 'voucher waits' : 'vouchers wait'} for a decision in Voucher Classification.`);
  return out.join(' ');
}

// The Opening balances step (kind 'opening'): what to say at the top, and whether the list of balances to type is the
// plan (no journal file), a last resort (the journal was refused) or hidden behind a "show" (the journal is the plan).
// Returns { intro, typing: 'plan' | 'refused' | 'hidden' | 'none', typeTitle }.
export function openingWords(step) {
  const lines = Array.isArray(step?.lines) ? step.lines.length : 0;
  const date = step?.journalDate?.nice ? `, dated ${step.journalDate.nice},` : '';
  if (!step?.file) {
    return { intro: lines ? 'These balances are in no file. Type each one once in Zoho Books, on the Opening Balances page, and tick it here.' : 'Nothing to do on this step.',
      typing: lines ? 'plan' : 'none', typeTitle: 'Type them in Zoho Books' };
  }
  const ob2 = step.contactCredits > 0 ? ' Journal OB-2 in the same file carries the customers in credit and the vendors in debit.' : '';
  const intro = `This file is the opening balance journal. Journal OB-1${date} carries every opening balance that is not in the Chart of Accounts, Customers or Vendors file: bank, cash and card accounts, Zoho's own accounts and every other account.${ob2} Import it like the other journals. Nothing is typed.`;
  if (!lines) return { intro, typing: 'none', typeTitle: '' };
  if (step.typeNeeded) return { intro, typing: 'refused', typeTitle: 'Zoho refused the journal: type these balances instead' };
  return { intro, typing: 'hidden', typeTitle: 'The same balances as a list (only if Zoho Books refuses the journal)' };
}

// The tips of a file step (guide.tips of GET /import-wizard, from the rules' general.while_importing): the ones about
// this file first, then the general ones. Returns [{ id, text, general }].
export function fileTips(f) {
  const tips = Array.isArray(f?.guide?.tips) ? f.guide.tips.filter(t => t && t.text) : [];
  return [...tips.filter(t => !t.general), ...tips.filter(t => t.general)];
}

// What is still open before the trial balances can agree (finish step stillOpen), as rows with the step to go to. The
// step "held" exists only on this screen (withHeldStep), so it is kept only when the wizard shows it.
export function stillOpenRows(step, steps = []) {
  const ids = new Set((Array.isArray(steps) ? steps : []).map(s => s.id));
  return (Array.isArray(step?.stillOpen) ? step.stillOpen : []).map(o => ({ step: o.step, words: o.words, canGo: ids.has(o.step) }));
}
