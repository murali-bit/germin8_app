// AOC-4 linked forms runner: AOC-2, Auditor's report extract, Board's report extract.
// Each form is a module in js/linked/<id>.js registered on window.LINKED_FORMS (see the module contract).
// This file:
//   - detects which linked form the active MCA tab shows,
//   - loads the company's saved answers, builds every value, asks only for what is missing,
//   - runs the form's pre-steps, fills ALL fields in one executeScript call, clicks Save, confirms it,
//   - optionally clicks Proceed (AOC-2 / Auditor's report only) — never Submit,
//   - shows a live step list, a field results table and an AOC-4 filing checklist per CIN.
// Page functions (page*) run in the MCA page (world MAIN) and must stay self-contained.

const LF_API = 'http://localhost:4000/api/company-answers';
const LF_CHECKLIST_KEY = 'filingChecklist.v1';
const LF_PARTS = [
  ['phase1', 'Phase 1 — Company details'],
  ['step2', 'Step 2 — Attachments & declaration'],
  ['aoc2', 'AOC-2'],
  ['eauditor', "Auditor's report extract"],
  ['eboard', "Board's report extract"],
];
const LF_STATES = ['pending', 'active', 'done', 'warn', 'error', 'skipped'];
const LF_TERMINAL = ['done', 'warn', 'error', 'skipped'];
// Declaration answers shared with AOC-4 step 2 live under formType 'aoc4'.
const LF_SHARED_AOC4_KEYS = ['BOARD_RESOLUTION_NO', 'BOARD_RESOLUTION_DATE', 'DECL_DESIGNATION', 'DECL_DIN'];
const LF_STEP_DEFS = [
  ['detect', 'Detect form'], ['load', 'Load data'], ['ask', 'Ask missing'], ['pre', 'Pre-steps'],
  ['fill', 'Fill fields'], ['save', 'Save'], ['confirm', 'Confirm'], ['proceed', 'Proceed'],
];

// ───────────────────────── pure helpers (tested in tests/linked-runner.test.mjs) ─────────────────────────

function lfForms() {
  const g = typeof window !== 'undefined' ? window : globalThis;
  return Object.values(g.LINKED_FORMS || {});
}

// The linked form whose urlRe matches the URL, or null. Only mca.gov.in pages count.
function lfDetectForm(url, forms) {
  const u = String(url || '');
  if (!/^https:\/\/([a-z0-9-]+\.)*mca\.gov\.in\//i.test(u)) return null;
  return (forms || []).find(f => f && f.urlRe instanceof RegExp && f.urlRe.test(u)) || null;
}

function lfStepsInit(defs = LF_STEP_DEFS) {
  return defs.map(([id, label]) => ({ id, label, state: 'pending', detail: '', startedAt: null, ms: null }));
}

// Returns a new step list. pending → active → done|warn|error|skipped; pending may jump straight to a
// terminal state. A finished step is never reopened (start a new run instead); the same state may
// update its detail. Elapsed ms is measured from the moment the step became active.
function lfStepUpdate(steps, id, state, detail, now = Date.now()) {
  if (!LF_STATES.includes(state)) return steps;
  return steps.map(s => {
    if (s.id !== id) return s;
    if (LF_TERMINAL.includes(s.state) && state !== s.state) return s;
    if (s.state === 'active' && state === 'pending') return s;
    const n = { ...s, state, detail: detail == null ? s.detail : String(detail) };
    if (state === 'active' && s.state !== 'active') n.startedAt = now;
    if (LF_TERMINAL.includes(state) && s.state !== state) n.ms = s.startedAt != null ? Math.max(0, now - s.startedAt) : 0;
    return n;
  });
}

function lfStepsSummary(steps) {
  const c = { pending: 0, active: 0, done: 0, warn: 0, error: 0, skipped: 0, totalMs: 0 };
  for (const s of steps) { c[s.state]++; c.totalMs += s.ms || 0; }
  return c;
}

// Merge one checklist mark into the store {[cin]:{[part]:{state,at,note}}}. Returns a new store.
// 'pending' never replaces an existing mark unless force (manual reset).
function lfChecklistMerge(store, cin, part, state, note, at = new Date().toISOString(), force = false) {
  const key = String(cin || '').trim().toUpperCase();
  if (!key || !LF_PARTS.some(([p]) => p === part) || !LF_STATES.includes(state)) return store || {};
  const s = { ...(store || {}) };
  const row = { ...(s[key] || {}) };
  if (state === 'pending' && row[part] && !force) return s;
  if (state === 'pending' && force) delete row[part];
  else row[part] = { state, at, note: note == null ? '' : String(note) };
  s[key] = row;
  return s;
}

function lfChecklistView(store, cin) {
  const row = (store || {})[String(cin || '').trim().toUpperCase()] || {};
  return LF_PARTS.map(([part, label]) => ({ part, label, state: 'pending', at: null, note: '', ...(row[part] || {}) }));
}

// Any common date spelling → DD/MM/YYYY, or null when it is not a real date.
function lfNormDate(s) {
  const t = String(s || '').trim();
  let m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})$/);
  let d, mo, y;
  if (m) { [, d, mo, y] = m; if (y.length === 2) y = '20' + y; }
  else if ((m = t.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/))) { [, y, mo, d] = m; }
  else return null;
  const dt = new Date(Date.UTC(+y, +mo - 1, +d));
  if (dt.getUTCFullYear() !== +y || dt.getUTCMonth() !== +mo - 1 || dt.getUTCDate() !== +d) return null;
  return `${String(d).padStart(2, '0')}/${String(mo).padStart(2, '0')}/${y}`;
}

// Turns the raw answers typed in the panel into stored values, grouped by company-answers formType.
// missing: [{key,label,type,options?,optional?,formType?,parse?}]; raw: {key: string}.
function lfCollectMissing(missing, raw, defaultForm) {
  const answers = {}, byForm = {}, errors = [];
  for (const m of missing || []) {
    let v = String((raw || {})[m.key] == null ? '' : raw[m.key]).trim();
    if (!v) { if (!m.optional) { errors.push(`${m.label || m.key}: required`); continue; } }
    else if (m.type === 'date') {
      const d = lfNormDate(v);
      if (!d) { errors.push(`${m.label || m.key}: use DD/MM/YYYY`); continue; }
      v = d;
    } else if (m.type === 'number') {
      const n = v.replace(/[,₹\s]/g, '');
      if (!/^-?\d+(\.\d+)?$/.test(n)) { errors.push(`${m.label || m.key}: must be a number`); continue; }
      v = n;
    } else if (m.type === 'select' && Array.isArray(m.options) && m.options.length) {
      const opts = m.options.map(o => (typeof o === 'object' ? String(o.value) : String(o)));
      if (!opts.includes(v)) { errors.push(`${m.label || m.key}: choose one of the options`); continue; }
    }
    if (v && typeof m.parse === 'function') {
      try { const p = m.parse(v); v = typeof p === 'string' ? p : JSON.stringify(p); }
      catch (e) { errors.push(`${m.label || m.key}: ${e.message}`); continue; }
    }
    answers[m.key] = v;
    const form = m.formType || (LF_SHARED_AOC4_KEYS.includes(m.key) ? 'aoc4' : defaultForm);
    (byForm[form] = byForm[form] || []).push({ key: m.key, label: m.label || m.key, value: v });
  }
  return { answers, byForm, errors };
}

// Label shown above a missing-answer input; optional ones say so.
function lfMissingLabel(m) { return (m.label || m.key) + (m.optional ? ' (optional)' : ''); }

function lfShort(v, n = 48) {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// pageFill results → one row per job: filled | skipped | failed (+ reason), and counts.
function lfFieldRows(jobs, results, labels = {}) {
  // The same id may appear several times (table rows): match results to jobs in order, per id.
  const queues = new Map();
  for (const r of results || []) {
    if (!r || r.id == null) continue;
    if (!queues.has(r.id)) queues.set(r.id, []);
    queues.get(r.id).push(r);
  }
  const counts = { filled: 0, skipped: 0, failed: 0, total: 0 };
  const rows = (jobs || []).map(j => {
    const q = queues.get(j.id);
    const r = q && q.length ? q.shift() : null;
    let status, reason = '';
    if (!r) { status = 'failed'; reason = 'no result from page'; }
    else if (!r.ok) { status = 'failed'; reason = r.err || 'not filled'; }
    else if (r.hidden || r.stopped || r.optionalMissing) { status = 'skipped'; reason = r.note || 'not shown'; }
    else { status = 'filled'; reason = r.note || ''; }
    counts[status]++; counts.total++;
    const label = j.label || labels[j.id] || j.id;
    return { id: j.id, label, value: lfShort(j.value, 40), status, reason };
  });
  return { rows, counts };
}

// One executeScript for all fields: allow ~1.5 s per field, at least 30 s, at most 4 min.
function lfFillTimeout(n) { return Math.min(240000, Math.max(30000, 15000 + 1500 * (n || 0))); }

// Jobs flagged beforePre are filled before the pre-steps (the AOC-2 / Board's report modules set their
// counts inside their own pre-steps, so normally everything goes in the single main pass).
function lfSplitJobs(jobs, hasPre) {
  if (!hasPre) return { first: [], rest: jobs || [] };
  const isFirst = j => j.beforePre === true;
  return { first: (jobs || []).filter(isFirst), rest: (jobs || []).filter(j => !isFirst(j)) };
}

// True once the user pressed Stop, or the page reported fields skipped because of a Stop. After that the
// runner must not touch MCA again (no more fills, no Save, no Proceed).
function lfHalted(stopRequested, results) { return !!stopRequested || (results || []).some(r => r && r.stopped); }

function lfMs(ms) { return ms == null ? '' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`; }

// ───────────────────────── page functions (MCA tab) ─────────────────────────

// Clicks the one Save of a linked form: visible, enabled, text exactly "Save", outside dialogs. Never Submit.
function pageLinkedClickSave() {
  const visible = el => !!el && el.getClientRects().length > 0;
  // Only really displayed buttons count (MCA's hidden popup templates carry buttons of their own).
  const displayed = el => {
    if (!visible(el)) return false;
    for (let x = el; x && x.nodeType === 1; x = x.parentElement) {
      if (x.getAttribute && x.getAttribute('aria-hidden') === 'true') return false;
      if (typeof getComputedStyle === 'function') {
        const cs = getComputedStyle(x);
        if (cs && (cs.display === 'none' || (x === el && (cs.visibility === 'hidden' || cs.visibility === 'collapse')) || parseFloat(cs.opacity) === 0)) return false;
      }
    }
    const r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    return !(r && (r.width < 1 || r.height < 1));
  };
  const label = el => String(el.textContent || el.value || '').replace(/\s+/g, ' ').trim();
  const all = [...document.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"]')];
  const saves = all.filter(b => displayed(b) && !b.disabled && label(b) === 'Save' && !/submit/i.test(label(b))
    && !b.closest('[id*="modal_container"], [role="dialog"], [role="alertdialog"], .modal, .modal-dialog, .ui-dialog, .swal2-popup'));
  if (!saves.length) return { clicked: false, reason: 'no-save' };
  const b = saves[saves.length - 1];
  if (/submit/i.test(label(b))) return { clicked: false, reason: 'refused-submit' };
  b.scrollIntoView({ block: 'center' });
  b.click();
  return { clicked: true, count: saves.length };
}

// Refuses when MCA shows field errors; otherwise clicks exactly "Proceed" (never Submit) and returns at once
// (the page may navigate away). The side panel waits for the navigation.
function pageLinkedProceed() {
  const visible = el => !!el && el.getClientRects().length > 0;
  const label = el => String(el.textContent || el.value || '').replace(/\s+/g, ' ').trim();
  const errors = [...document.querySelectorAll('.guideFieldError')].filter(e => visible(e) && label(e)).map(label);
  if (errors.length) return { clicked: false, reason: 'field-errors', errors: [...new Set(errors)].slice(0, 8) };
  // Only really displayed buttons count (a hidden popup template's Proceed must never be clicked).
  const displayed = el => {
    if (!visible(el)) return false;
    for (let x = el; x && x.nodeType === 1; x = x.parentElement) {
      if (x.getAttribute && x.getAttribute('aria-hidden') === 'true') return false;
      if (typeof getComputedStyle === 'function') {
        const cs = getComputedStyle(x);
        if (cs && (cs.display === 'none' || (x === el && (cs.visibility === 'hidden' || cs.visibility === 'collapse')) || parseFloat(cs.opacity) === 0)) return false;
      }
    }
    const r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    return !(r && (r.width < 1 || r.height < 1));
  };
  const btns = [...document.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"]')]
    .filter(b => displayed(b) && !b.disabled && label(b) === 'Proceed'
      && !b.closest('[id*="modal_container"], [role="dialog"], [role="alertdialog"], .modal, .modal-dialog, .ui-dialog, .swal2-popup'));
  if (btns.length !== 1) return { clicked: false, reason: btns.length ? 'several-proceed' : 'no-proceed' };
  if (/submit/i.test(label(btns[0]))) return { clicked: false, reason: 'refused-submit' };
  const url = location.href;
  btns[0].scrollIntoView({ block: 'center' });
  btns[0].click();
  return { clicked: true, url };
}

// Waits until MCA is idle. Only OK / Okay / Close inside a dialog is ever clicked. Reports field errors.
async function pageLinkedIdle(maxMs = 10000) {
  const pause = ms => new Promise(r => setTimeout(r, ms));
  const visible = el => !!el && el.getClientRects().length > 0;
  const label = el => String(el.textContent || el.value || '').replace(/\s+/g, ' ').trim();
  // A popup counts only when really on screen: MCA keeps hidden popup templates in the DOM (visibility:hidden,
  // opacity:0, aria-hidden, zero size) that still have client rects. Popup text comes from innerText only.
  // innerText only: a hidden HTML box has innerText '' and is never read through textContent. (textContent only
  // where innerText does not exist at all, i.e. a non-HTML node — never true of an MCA popup box.)
  const inner = el => String(el && typeof el.innerText === 'string' ? el.innerText : (el && el.textContent) || '');
  const styleHidden = el => {
    for (let x = el; x && x.nodeType === 1; x = x.parentElement) {
      if (x.getAttribute && x.getAttribute('aria-hidden') === 'true') return true;
      if (typeof getComputedStyle === 'function') {
        const cs = getComputedStyle(x);
        if (cs && (cs.display === 'none' || (x === el && (cs.visibility === 'hidden' || cs.visibility === 'collapse')) || parseFloat(cs.opacity) === 0)) return true;
      }
    }
    return false;
  };
  const shown = el => {
    if (!el || el.getClientRects().length === 0 || styleHidden(el)) return false;
    const r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    if (r && (r.width < 2 || r.height < 2)) return false;
    return inner(el).trim().length > 0;
  };
  // A control inside a shown popup: laid out and not hidden by style.
  const live = el => !!el && el.getClientRects().length > 0 && !styleHidden(el);
  const popText = el => inner(el).replace(/\s+/g, ' ').trim();
  const dialogs = [];
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    for (const d of [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], .modal-dialog, .ui-dialog, .swal2-popup')].filter(shown)) {
      const ok = [...d.querySelectorAll('button, [role="button"]')].find(b => live(b) && /^(ok|okay|close)$/i.test(label(b)));
      if (ok) { dialogs.push(popText(d).slice(0, 160)); ok.click(); }
    }
    let busy = document.readyState !== 'complete';
    try { if (window.jQuery && window.jQuery.active > 0) busy = true; } catch (_) { }
    if (!busy) busy = [...document.querySelectorAll('.guide-loading, .guideLoading, .loader, .spinner, .blockUI, .blockOverlay')].some(visible);
    if (!busy) break;
    await pause(300);
  }
  const errors = [...document.querySelectorAll('.guideFieldError')].filter(shown).map(popText);
  return { idle: Date.now() - t0 < maxMs, waitedMs: Date.now() - t0, dialogs, errors: [...new Set(errors)].slice(0, 8), url: location.href };
}

// Waits for MCA's answer to Save. Looks for the success message ONLY inside a dialog and clicks ONLY a visible
// OK / Okay / Close there (never Proceed / Yes / Submit: the shared pageConfirmSave is too permissive for
// linked forms). Returns {confirmed, errorsVisible, errorTexts, dialogs, waitedMs}.
async function pageLinkedConfirmSave(waitMs = 12000) {
  const pause = ms => new Promise(r => setTimeout(r, ms));
  const visible = el => !!el && el.getClientRects().length > 0;
  const label = el => String(el.textContent || el.value || '').replace(/\s+/g, ' ').trim();
  // A popup counts only when really on screen: MCA keeps hidden popup templates in the DOM (visibility:hidden,
  // opacity:0, aria-hidden, zero size) that still have client rects; a hidden "Data saved successfully" template
  // must never confirm a Save. Popup text comes from innerText only (never textContent).
  // innerText only: a hidden HTML box has innerText '' and is never read through textContent. (textContent only
  // where innerText does not exist at all, i.e. a non-HTML node — never true of an MCA popup box.)
  const inner = el => String(el && typeof el.innerText === 'string' ? el.innerText : (el && el.textContent) || '');
  const styleHidden = el => {
    for (let x = el; x && x.nodeType === 1; x = x.parentElement) {
      if (x.getAttribute && x.getAttribute('aria-hidden') === 'true') return true;
      if (typeof getComputedStyle === 'function') {
        const cs = getComputedStyle(x);
        if (cs && (cs.display === 'none' || (x === el && (cs.visibility === 'hidden' || cs.visibility === 'collapse')) || parseFloat(cs.opacity) === 0)) return true;
      }
    }
    return false;
  };
  const shown = el => {
    if (!el || el.getClientRects().length === 0 || styleHidden(el)) return false;
    const r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    if (r && (r.width < 2 || r.height < 2)) return false;
    return inner(el).trim().length > 0;
  };
  // A control inside a shown popup: laid out and not hidden by style (an × icon may have no text).
  const live = el => !!el && el.getClientRects().length > 0 && !styleHidden(el);
  const popText = el => inner(el).replace(/\s+/g, ' ').trim();
  const DLG = '[id*="modal_container"], [role="dialog"], [role="alertdialog"], .modal-dialog, .ui-dialog, .swal2-popup, .guideDialogNode';
  // Close for sure: the popup's own OK first; if MCA's popup is still up, hide it through the AEM form model
  // (exact node id only), then hide its box and the backdrop so the page is never left blocked.
  const forceClose = box => {
    const host = (box.closest && box.closest('[id*="modal_container"]')) || box;
    try {
      const gb = window.guideBridge;
      if (gb && typeof gb.visit === 'function' && host.id) gb.visit(n => { if (n && n.id === host.id) { try { n.visible = false; } catch (_) { } } });
    } catch (_) { }
    if (host.style && (shown(host) || shown(box))) host.style.display = 'none';
    try { document.querySelectorAll('.modal-backdrop').forEach(b => b.remove()); } catch (_) { }
    try { if (document.body && document.body.classList) document.body.classList.remove('modal-open'); } catch (_) { }
  };

  const success = /(data|details|form) (added|saved|filled|updated|submitted) successfully|saved successfully|successfully (saved|added|filled|updated)/i;
  const dialogs = [];
  const busy = () => {
    try { if (window.jQuery && window.jQuery.active > 0) return true; } catch (_) { }
    return [...document.querySelectorAll('.guide-loading, .guideLoading, .loader, .spinner, .blockUI, .blockOverlay')].some(visible);
  };
  const t0 = Date.now(), hardStop = t0 + Math.max(waitMs, 40000); // the side panel allows 50 s for this call
  while (Date.now() < hardStop) {
    // Shown boxes only; the innermost (shortest text) first when a container and its content both match.
    const boxes = [...document.querySelectorAll(DLG)].filter(shown).sort((a, b) => popText(a).length - popText(b).length);
    for (const d of boxes) {
      const t = popText(d);
      if (!success.test(t)) { if (t && !dialogs.includes(t.slice(0, 160))) dialogs.push(t.slice(0, 160)); continue; }
      // OK / Okay / Close by text, or an ×-icon / control whose aria-label or title says close (never Submit / Proceed).
      const meta = b => `${b.getAttribute('aria-label') || ''} ${b.getAttribute('title') || ''}`;
      const ok = [...d.querySelectorAll('button, input[type="button"], [role="button"], a, span[class*="close"], i[class*="close"]')]
        .find(b => live(b) && !/submit|proceed/i.test(label(b) + ' ' + meta(b))
          && (/^(ok|okay|close|×|✕)$/i.test(label(b)) || /\b(close|dismiss)\b/i.test(meta(b))));
      if (ok) ok.click();
      await pause(500);
      // Only an OK/Close that did not close the popup gets the sure way (d was shown before the click and must still
      // be shown after it); a popup offering only Proceed / Yes is a question for the CA and is left alone.
      const forced = !!ok && shown(d);
      if (forced) forceClose(d);
      return { confirmed: true, closed: !!ok, forced, dialogs, msg: t.slice(0, 120), waitedMs: Date.now() - t0 };
    }
    if (!busy()) {
      const errs = [...document.querySelectorAll('.guideFieldError')].filter(shown).map(popText);
      if (errs.length) return { confirmed: false, errorsVisible: true, errorTexts: [...new Set(errs)].slice(0, 8), dialogs, waitedMs: Date.now() - t0 };
      if (Date.now() - t0 >= waitMs) break;
    }
    await pause(250);
  }
  return { confirmed: false, errorsVisible: false, errorTexts: [], dialogs, waitedMs: Date.now() - t0 };
}

// Stop button: pageFill checks this flag before each field.
function pageLinkedStop() { window.__germin8StopFill = true; return true; }

// Waits (MutationObserver, no fixed sleep) until `selector` exists on the page — the AEM guide renders its
// fields after the tab reports 'complete'. Clicks nothing. Returns {found, waitedMs}.
function pageLinkedWaitFor(selector, maxMs = 15000) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const has = () => { try { return !!document.querySelector(selector); } catch (_) { return true; } };
    if (has()) { resolve({ found: true, waitedMs: 0 }); return; }
    let timer = null;
    const obs = new MutationObserver(() => {
      if (!has()) return;
      obs.disconnect(); clearTimeout(timer);
      resolve({ found: true, waitedMs: Date.now() - t0 });
    });
    obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
    timer = setTimeout(() => { obs.disconnect(); resolve({ found: has(), waitedMs: Date.now() - t0 }); }, maxMs);
  });
}

// ───────────────────────── filing checklist (chrome.storage.local) ─────────────────────────

const FilingChecklist = {
  KEY: LF_CHECKLIST_KEY,
  PARTS: LF_PARTS.map(([part, label]) => ({ part, label })),
  async load() {
    try { const o = await chrome.storage.local.get(LF_CHECKLIST_KEY); return (o && o[LF_CHECKLIST_KEY]) || {}; } catch (_) { return {}; }
  },
  // mark('U01100KA2019PTC000001', 'step2', 'done', 'Saved') — callable from step2-attach / phase-runner.
  // Marks are queued so two quick calls (e.g. 'active' then 'done') never overwrite each other.
  _queue: Promise.resolve(),
  mark(cin, part, state, note, force = false) {
    const run = async () => {
      const store = await FilingChecklist.load();
      const next = lfChecklistMerge(store, cin, part, state, note, new Date().toISOString(), force);
      try { await chrome.storage.local.set({ [LF_CHECKLIST_KEY]: next }); } catch (_) { }
      lfRenderChecklist();
      return lfChecklistView(next, cin);
    };
    const p = FilingChecklist._queue.then(run, run);
    FilingChecklist._queue = p.catch(() => {});
    return p;
  },
  async get(cin) { return lfChecklistView(await FilingChecklist.load(), cin); },
};

// ───────────────────────── side panel ─────────────────────────

// lastRunKey = `${tab url}|${cin}` of the last Run: its step list is kept until the form or company changes.
// preparing / stopPending: a Stop pressed while lfRun is still detecting and loading (before `running`) is kept
// and honoured before anything is done on MCA.
const LF = { form: null, tab: null, answers: {}, built: null, jobs: [], steps: lfStepsInit(), running: false, ticker: null, loadedAt: 0, loadedKey: '',
  stopRequested: false, lastRunKey: '', preparing: false, stopPending: false };

function lfEl(id) { return document.getElementById(id); }
function lfMake(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

function lfClient() { try { return typeof currentClient !== 'undefined' ? currentClient : null; } catch (_) { return null; } }
function lfCin() {
  try {
    const d = typeof currentData !== 'undefined' ? currentData : null;
    const c = lfClient();
    return String((d && (d.CIN || d.cin)) || (c && c.general && c.general.CIN) || '').trim().toUpperCase();
  } catch (_) { return ''; }
}

const LF_ICON = { pending: '○', active: '◐', done: '✓', warn: '!', error: '✗', skipped: '–' };

function lfStep(id, state, detail) { LF.steps = lfStepUpdate(LF.steps, id, state, detail); lfRenderSteps(); }

function lfRenderSteps() {
  const ul = lfEl('lfSteps');
  if (!ul) return;
  ul.innerHTML = '';
  const now = Date.now();
  for (const s of LF.steps) {
    const li = lfMake('li', `lf-step is-${s.state}`);
    li.appendChild(lfMake('span', 'lf-ico', LF_ICON[s.state]));
    const body = lfMake('span', 'lf-step-body');
    body.appendChild(lfMake('span', 'lf-step-name', s.label));
    if (s.detail) body.appendChild(lfMake('span', 'lf-step-detail', s.detail));
    li.appendChild(body);
    const ms = s.state === 'active' && s.startedAt != null ? now - s.startedAt : s.ms;
    li.appendChild(lfMake('span', 'lf-ms', lfMs(ms)));
    ul.appendChild(li);
  }
  const sum = lfStepsSummary(LF.steps);
  const el = lfEl('lfSummary');
  if (el) el.textContent = LF.steps.every(s => s.state === 'pending') ? ''
    : `${sum.done} done · ${sum.warn} warning · ${sum.error} error · ${sum.pending + sum.active} to go · ${lfMs(sum.totalMs)}`;
}

function lfStartTicker() { lfStopTicker(); LF.ticker = setInterval(lfRenderSteps, 250); }
function lfStopTicker() { if (LF.ticker) clearInterval(LF.ticker); LF.ticker = null; }

function lfRenderMissing(missing, answers) {
  const box = lfEl('lfMissing');
  if (!box) return;
  // Keep what the user already typed when the list is re-rendered.
  const typed = {};
  box.querySelectorAll('[data-key]').forEach(i => { typed[i.dataset.key] = i.value; });
  box.innerHTML = '';
  if (!missing || !missing.length) return;
  box.appendChild(lfMake('div', 'lf-sub', `Needed from you (${missing.length}) — saved to the company master on Run`));
  for (const m of missing) {
    const f = lfMake('div', 'field');
    const id = 'lf_m_' + m.key;
    const lab = lfMake('label', null, lfMissingLabel(m));
    lab.htmlFor = id;
    f.appendChild(lab);
    let inp;
    if (m.type === 'textarea') { inp = document.createElement('textarea'); inp.rows = 3; }
    else if (m.type === 'select') {
      inp = document.createElement('select');
      inp.appendChild(new Option('Select…', ''));
      for (const o of m.options || []) inp.appendChild(typeof o === 'object' ? new Option(o.label || o.value, o.value) : new Option(o, o));
    } else {
      inp = document.createElement('input'); inp.type = 'text';
      if (m.type === 'date') inp.placeholder = 'DD/MM/YYYY';
      if (m.type === 'number') inp.inputMode = 'decimal';
    }
    inp.id = id; inp.dataset.key = m.key;
    const pre = typed[m.key] != null ? typed[m.key] : (answers || {})[m.key] != null ? answers[m.key] : m.default;
    if (pre != null) inp.value = String(pre);
    f.appendChild(inp);
    if (m.hint) f.appendChild(lfMake('small', 'hint lf-hint', m.hint));
    for (const e of m.errors || []) f.appendChild(lfMake('small', 'lf-err', e));
    box.appendChild(f);
  }
}

function lfRenderPreview(values, notes) {
  const box = lfEl('lfPreview');
  if (!box) return;
  const list = lfEl('lfPreviewList');
  list.innerHTML = '';
  const keys = Object.keys(values || {}).filter(k => values[k] !== '' && values[k] != null);
  lfEl('lfPreviewSum').textContent = `Values to fill (${LF.jobs.length} fields from ${keys.length} values)`;
  for (const n of notes || []) list.appendChild(lfMake('li', 'lf-note', n));
  for (const k of keys) {
    const li = lfMake('li');
    li.appendChild(lfMake('span', 'lf-k', k));
    li.appendChild(lfMake('span', 'lf-v', lfShort(typeof values[k] === 'object' ? JSON.stringify(values[k]) : values[k], 140)));
    list.appendChild(li);
  }
  box.hidden = !keys.length;
}

function lfRenderFields(rows, counts) {
  const box = lfEl('lfFields');
  if (!box) return;
  const tbody = lfEl('lfFieldsBody');
  tbody.innerHTML = '';
  for (const r of rows) {
    const tr = lfMake('tr', `is-${r.status}`);
    tr.appendChild(lfMake('td', null, r.label));
    tr.appendChild(lfMake('td', 'lf-v', r.value));
    const st = lfMake('td', 'lf-st', r.status + (r.reason ? ` — ${r.reason}` : ''));
    tr.appendChild(st);
    tbody.appendChild(tr);
  }
  lfEl('lfFieldsSum').textContent = `Field results: ${counts.filled} filled · ${counts.skipped} skipped · ${counts.failed} failed`;
  box.hidden = !rows.length;
  if (counts.failed) box.open = true;
}

async function lfRenderChecklist() {
  if (typeof document === 'undefined') return;
  let box = lfEl('lfChecklist');
  if (!box) {
    const anchor = lfEl('s2Panel') || lfEl('lfPanel');
    if (!anchor) return;
    box = lfMake('div', 'lf-checklist');
    box.id = 'lfChecklist';
    anchor.parentElement.insertBefore(box, anchor);
  }
  const cin = lfCin();
  box.innerHTML = '';
  const head = lfMake('div', 'lf-check-head', 'AOC-4 filing checklist');
  head.appendChild(lfMake('span', 'lf-cin', cin || 'no company loaded'));
  box.appendChild(head);
  if (!cin) return;
  const view = lfChecklistView(await FilingChecklist.load(), cin);
  const ul = lfMake('ul', 'lf-check');
  for (const v of view) {
    const li = lfMake('li', `is-${v.state}`);
    const b = lfMake('button', 'lf-check-btn');
    b.type = 'button';
    b.title = v.state === 'done' ? 'Click to mark as not done' : 'Click to mark as done';
    b.textContent = LF_ICON[v.state];
    b.addEventListener('click', () => FilingChecklist.mark(cin, v.part, v.state === 'done' ? 'pending' : 'done', v.state === 'done' ? '' : 'Marked by you', true));
    li.appendChild(b);
    li.appendChild(lfMake('span', 'lf-check-label', v.label));
    const when = v.at ? new Date(v.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
    li.appendChild(lfMake('span', 'lf-check-note', [v.note, when].filter(Boolean).join(' · ')));
    ul.appendChild(li);
  }
  box.appendChild(ul);
}

function lfFormLabel() { return LF.form ? LF.form.label : 'none'; }

// Merged answers: aoc4 (shared declaration) <- form.extraAnswers (e.g. another linked form's keys) <- the form's own.
async function lfFetchAnswers(cin, form) {
  const get = async f => {
    const r = await fetch(`${LF_API}?cin=${encodeURIComponent(cin)}&form=${encodeURIComponent(f)}`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error('company master answered ' + r.status);
    const body = await r.json();
    return Object.fromEntries((body.answers || []).map(x => [x.field_key, x.value]));
  };
  const extraForms = (form.extraAnswers || []).filter(f => f && f !== 'aoc4' && f !== form.answersForm);
  const [a, own, ...extra] = await Promise.all([get('aoc4'), form.answersForm && form.answersForm !== 'aoc4' ? get(form.answersForm) : {}, ...extraForms.map(get)]);
  return Object.assign({}, a, ...extra, own);
}

function lfBuild(answers) {
  const b = LF.form.buildData(lfClient(), answers || {}) || {};
  LF.built = { values: b.values || {}, missing: b.missing || [], notes: b.notes || [] };
  LF.jobs = LF.form.jobs(LF.built.values) || [];
  return LF.built;
}

function lfResetSteps() {
  LF.steps = lfStepsInit();
  const body = lfEl('lfFieldsBody'); if (body) body.innerHTML = '';
  const box = lfEl('lfFields'); if (box) box.hidden = true;
  lfRenderSteps();
}

// Detect + load. Answers are cached for 60 s for the same tab URL and CIN so Run does not refetch (force refetches).
// The last run's step list and field results stay while the same form + company is shown, so a redetect from a
// tab event does not wipe them; `fresh` (Run, Check page) always starts a new step list.
// extraAnswers (autopilot): answers the CA already gave in this run, merged over the company master's so a
// failed save to the backend never makes the run ask again.
async function lfPrepare(force = false, fresh = force, extraAnswers = null) {
  if (LF.running) return false;
  const tab = typeof getActiveMcaTab === 'function' ? await getActiveMcaTab() : null;
  if (LF.running) return false; // Run started while we were waiting
  const cin = lfCin();
  const key = tab ? `${tab.url}|${cin}` : '';
  const hasRun = !!LF.lastRunKey && LF.steps.some(s => s.state !== 'pending');
  if (!fresh && hasRun && (!tab || key === LF.lastRunKey)) {
    if (!tab) lfEl('lfForm').textContent = 'Open the linked form on mca.gov.in in this window.';
    return false;
  }
  lfResetSteps();
  LF.lastRunKey = '';
  lfStep('detect', 'active');
  const form = tab ? lfDetectForm(tab.url, lfForms()) : null;
  LF.tab = tab; LF.form = form;
  lfEl('lfForm').textContent = form ? `On MCA: ${form.label}` : tab ? 'This MCA page is not AOC-2, Auditor’s report or Board’s report.' : 'Open the linked form on mca.gov.in in this window.';
  if (!form) { lfStep('detect', 'error', tab ? 'not a linked form page' : 'no MCA tab'); return false; }
  if (typeof form.buildData !== 'function' || typeof form.jobs !== 'function') { lfStep('detect', 'error', `${form.label} module incomplete`); return false; }
  lfStep('detect', 'done', form.label);
  const client = lfClient();
  lfStep('load', 'active');
  if (!cin || !client) { lfStep('load', 'error', 'load the company’s AOC-4 data first'); return false; }
  try {
    if (force || LF.loadedKey !== key || Date.now() - LF.loadedAt > 60000) {
      LF.answers = await lfFetchAnswers(cin, form).catch(e => { lfStep('load', 'active', 'company master offline — using AOC-4 data only'); return {}; });
      LF.loadedKey = key; LF.loadedAt = Date.now();
    }
    if (extraAnswers && typeof extraAnswers === 'object') LF.answers = { ...LF.answers, ...extraAnswers };
    lfBuild(LF.answers);
  } catch (e) { lfStep('load', 'error', 'could not build values: ' + e.message); return false; }
  lfStep('load', 'done', `${cin} · ${LF.jobs.length} fields`);
  lfRenderMissing(LF.built.missing, LF.answers);
  lfRenderPreview(LF.built.values, LF.built.notes);
  const need = LF.built.missing.filter(m => !m.optional).length, opt = LF.built.missing.length - need;
  lfStep('ask', LF.built.missing.length ? 'active' : 'done', LF.built.missing.length
    ? `${need} answer(s) needed below${opt ? ` · ${opt} optional (defaults shown)` : ''}` : 'nothing missing');
  lfEl('lfProceedRow').hidden = form.nextButton !== 'Proceed';
  return true;
}

// Stores the typed answers; returns the formTypes that could not be saved (offline, HTTP error, 10 s timeout).
async function lfSaveAnswers(cin, byForm) {
  const res = await Promise.all(Object.entries(byForm).map(([formType, answers]) => fetch(LF_API, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cin, formType, answers }),
    signal: AbortSignal.timeout(10000),
  }).then(r => (r.ok ? null : formType), () => formType)));
  return res.filter(Boolean);
}

// Waits for the tab to leave `fromUrl` and finish loading; falls back to an idle check on the same page.
async function lfWaitNavigation(tabId, fromUrl, ms = 30000) {
  const t0 = Date.now();
  let moved = false;
  while (Date.now() - t0 < ms) {
    await new Promise(r => setTimeout(r, 400));
    let t = null;
    try { t = await chrome.tabs.get(tabId); } catch (_) { return { navigated: false, reason: 'tab closed' }; }
    if (t.url && t.url !== fromUrl) moved = true;
    if (moved && t.status === 'complete') return { navigated: true, url: t.url };
  }
  return { navigated: moved, reason: moved ? 'still loading' : 'no navigation' };
}

// Builds a linked form's values outside a run (the autopilot's preflight uses it with lfFetchAnswers).
function lfBuildFor(form, client, answers) { return form.buildData(client, answers || {}); }

// opts (optional; a click Event is ignored): { auto:true, shouldStop?:()=>boolean, answers?:{} } — the autopilot.
// In auto mode answers are always refetched (opts.answers merged over them), the run waits for the MCA page to
// finish rendering before filling, and when required answers are missing it returns 'needs-answers' before
// touching MCA. shouldStop is checked after every await, like the panel's own Stop.
// Returns { state:'done'|'warn'|'error'|'needs-answers'|'stopped'|'not-linked'|'busy', form?, proceeded,
//           nextUrl?, note, missing? }.
async function lfRun(opts) {
  const o = opts && typeof opts === 'object' && typeof opts.preventDefault !== 'function' ? opts : {};
  const rv = { result: null };
  const auto = o.auto === true;
  if (auto) LF.autoRuns = (LF.autoRuns || 0) + 1; // blocks the panel's redetect for the whole autopilot run
  try { await lfRunMain(auto, rv, { shouldStop: o.shouldStop, answers: o.answers }); } finally { if (auto) LF.autoRuns = Math.max(0, (LF.autoRuns || 1) - 1); }
  return rv.result || { state: 'busy', proceeded: false, note: 'a linked form is already running' };
}

async function lfRunMain(auto, rv, extra = {}) {
  const busy = { state: 'busy', proceeded: false, note: 'a linked form is already running' };
  const stopNow = () => { try { return typeof extra.shouldStop === 'function' && !!extra.shouldStop(); } catch (_) { return false; } };
  if (LF.running || LF.preparing) { rv.result = busy; return; }
  const runBtn = lfEl('lfRunBtn');
  LF.preparing = true; LF.stopPending = false;
  let ok;
  try { ok = await lfPrepare(auto, true, auto ? extra.answers : null); } finally { LF.preparing = false; }
  if (LF.running) { rv.result = busy; return; }
  // Stop pressed while the form was being detected / its answers loaded: nothing is done on MCA.
  const stoppedEarly = LF.stopPending || stopNow();
  LF.stopPending = false;
  if (stoppedEarly) {
    if (LF.form) lfStep('pre', 'warn', 'stopped by you');
    rv.result = { state: 'stopped', ...(LF.form ? { form: LF.form.id } : {}), proceeded: false, note: 'Stopped' };
    return;
  }
  if (!ok) {
    if (!LF.form) {
      const shown = lfEl('lfForm');
      rv.result = { state: 'not-linked', proceeded: false, note: (shown && shown.textContent) || 'not a linked form page' };
    } else {
      const bad = LF.steps.find(s => s.state === 'error');
      rv.result = { state: 'error', form: LF.form.id, proceeded: false, note: bad ? `${bad.label}: ${bad.detail}` : 'could not prepare the form' };
    }
    return;
  }
  const form = LF.form, tab = LF.tab, cin = lfCin();
  // Outcome for the caller (computed in finally).
  let halted = false, needs = null, proceeded = false, nextUrl;
  LF.running = true; LF.stopRequested = false; LF.lastRunKey = `${tab.url}|${cin}`;
  runBtn.disabled = true; lfEl('lfStopBtn').disabled = false;
  lfStartTicker();
  const exec = (func, args, ms) => withTimeout(chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func, args }), ms, 'timeout')
    .then(r => r && r[0] && r[0].result);
  // finalState null = nothing done on MCA yet (checklist untouched).
  let finalState = null, finalNote = '';
  const allResults = [];
  let preStopped = false; // a pageFill-style pre-step reported fields skipped because of Stop
  // Checked after every await: once Stop is pressed nothing more is done on MCA (no fill, no Save, no Proceed).
  // (pageFill resets the page's stop flag at its start, so the side-panel flag is the one that counts.)
  const halt = id => {
    if (!lfHalted(LF.stopRequested || preStopped || stopNow(), allResults)) return false;
    halted = true;
    lfStep(id, 'warn', 'stopped by you');
    if (finalState !== null) { finalState = 'warn'; finalNote = 'Stopped — not saved'; } else finalNote = 'Stopped';
    return true;
  };
  try {
    // Ask missing: read, validate, store in the company master, rebuild.
    if (LF.built.missing.length) {
      const raw = {};
      lfEl('lfMissing').querySelectorAll('[data-key]').forEach(i => { raw[i.dataset.key] = i.value; });
      const got = lfCollectMissing(LF.built.missing, raw, form.answersForm);
      if (got.errors.length) {
        needs = LF.built.missing.filter(m => !(m.key in got.answers));
        lfStep('ask', 'error', got.errors.slice(0, 3).join(' · ')); finalNote = 'answers needed'; return;
      }
      const notSaved = await lfSaveAnswers(cin, got.byForm);
      LF.answers = { ...LF.answers, ...got.answers };
      lfBuild(LF.answers);
      lfRenderPreview(LF.built.values, LF.built.notes);
      lfEl('lfMissing').innerHTML = '';
      lfRenderMissing(LF.built.missing, LF.answers);
      const still = LF.built.missing.filter(m => !m.optional);
      if (still.length) { needs = still; lfStep('ask', 'error', `${still.length} answer(s) still needed: ${still.map(m => m.label || m.key).slice(0, 3).join(' · ')}`); finalNote = 'answers needed'; return; }
      if (notSaved.length) lfStep('ask', 'warn', `answers used for this run but not saved to company master (${notSaved.join(', ')})`);
      else lfStep('ask', 'done', `${Object.keys(got.answers).length} answer(s) saved to company master`);
    }
    if (halt('pre')) return;
    // Autopilot: the tab reports 'complete' before the AEM guide has rendered and MCA's prefill requests are
    // done. Wait for MCA to be idle and for the form's first field before filling anything.
    if (auto) {
      lfStep('pre', 'active', 'waiting for the MCA page to finish loading…');
      await exec(pageLinkedIdle, [20000], 30000).catch(() => null);
      if (halt('pre')) return;
      const firstSel = (LF.jobs || []).map(j => j && j.selector).find(s => typeof s === 'string' && s);
      if (firstSel) {
        const w = await exec(pageLinkedWaitFor, [firstSel, 15000], 25000).catch(() => null);
        if (halt('pre')) return;
        if (w && w.found === false) lfStep('pre', 'active', 'the form’s fields did not appear in 15 s — filling anyway');
      }
    }
    FilingChecklist.mark(cin, form.id, 'active', 'Running…');
    finalState = 'error'; finalNote = 'stopped';
    const values = LF.built.values;
    const { first, rest } = lfSplitJobs(LF.jobs, !!(form.pre && form.pre.length));
    const labels = Object.fromEntries((LF.built.missing || []).map(m => [m.key, m.label]));
    const fill = async jobs => {
      if (!jobs.length) return;
      const r = await exec(pageFill, [jobs], lfFillTimeout(jobs.length));
      allResults.push(...((r && r.results) || []));
    };

    // Pre-steps, in the module's order (AOC-2: counts → Excel upload; Board's report: meeting rows).
    // Step contract: {label, func, args(v), skip?(v), prepare?(v)}; prepare runs here in the side panel
    // (e.g. fetches the AOC-2 Excel from the backend via fetchAoc2Excel) and may add keys to v.
    let preFailed = false;
    if (form.pre && form.pre.length) {
      lfStep('pre', 'active', first.length ? `setting ${first.length} field(s) first` : '');
      await fill(first);
      if (halt('pre')) return;
      const v = { ...values };
      const done = [];
      for (const p of form.pre) {
        if (halt('pre')) return;
        if (typeof p.skip === 'function' && p.skip(v)) { done.push(`${p.label}: not needed`); continue; }
        try {
          if (typeof p.prepare === 'function') { lfStep('pre', 'active', `${p.label}: preparing…`); await p.prepare(v); }
          if (halt('pre')) return;
          lfStep('pre', 'active', `${p.label}…`);
          const func = p.func;
          if (typeof func !== 'function') throw new Error('page function missing');
          const args = typeof p.args === 'function' ? p.args(v) : [];
          const r = await exec(func, args, 150000);
          if (r && Array.isArray(r.results) && r.results.some(x => x && x.stopped)) preStopped = true;
          if (halt('pre')) return;
          // pageFill-style answers carry per-field results; anything else uses ok:false.
          const bad = r && Array.isArray(r.results) ? r.results.filter(x => x && !x.ok) : [];
          if (!r || r.ok === false || bad.length) {
            const why = !r ? 'no answer from the MCA page'
              : bad.length ? bad.map(x => `${x.id}: ${x.err || 'not filled'}`).join(' · ')
              : [r.reason, r.err, ...(r.dialogs || [])].filter(Boolean).join(' · ');
            throw new Error(why || 'failed');
          }
          done.push(p.label + (r.records != null ? ` (${r.records} record(s))` : r.rows != null ? ` (${r.rows} row(s))` : ''));
        } catch (e) {
          preFailed = true;
          lfStep('pre', 'error', lfShort(`${p.label}: ${e.message === 'timeout' ? 'the MCA page did not answer in time' : e.message}`, 220));
          break;
        }
      }
      if (!preFailed) lfStep('pre', 'done', done.join(' · ') || 'done');
    } else lfStep('pre', 'skipped', 'none for this form');
    if (halt('fill')) return;

    // All remaining fields in one call.
    lfStep('fill', 'active', `filling ${rest.length} field(s) in one pass…`);
    await fill(rest);
    const { rows, counts } = lfFieldRows([...first, ...rest], allResults, labels);
    lfRenderFields(rows, counts);
    if (halt('fill')) return;
    lfStep('fill', counts.failed ? 'warn' : 'done', `${counts.filled} filled · ${counts.skipped} skipped · ${counts.failed} failed`);

    // Save — only while the tab still shows this form.
    const now = await chrome.tabs.get(tab.id).catch(() => null);
    if (halt('save')) return;
    if (!now || !form.urlRe.test(now.url || '')) { lfStep('save', 'error', 'the MCA tab moved away from this form'); finalNote = 'tab changed'; return; }
    if (!lfEl('lfSave').checked) {
      lfStep('save', 'skipped', 'Save is off'); lfStep('confirm', 'skipped'); lfStep('proceed', 'skipped');
      finalState = 'active'; finalNote = 'Filled — not saved yet';
      return;
    }
    lfStep('save', 'active');
    const s = await exec(pageLinkedClickSave, [], 15000);
    if (!s || !s.clicked) { lfStep('save', 'error', `not clicked (${s ? s.reason : 'no answer'}) — click Save on MCA`); finalState = 'warn'; finalNote = 'Save not clicked'; return; }
    lfStep('save', 'done', 'clicked');
    lfStep('confirm', 'active');
    let c = await exec(pageLinkedConfirmSave, [12000], 50000).catch(() => null);
    // MCA cleared or did not take some boxes ("Please enter the relevant details"): fill everything once more
    // (pageFill skips boxes that are already right) and Save again — once.
    if (c && !c.confirmed && c.errorsVisible && !halt('confirm')) {
      lfStep('confirm', 'active', `MCA shows ${c.errorTexts.length} empty box(es) — filling them again and saving once more…`);
      await fill([...first, ...rest]);
      // Company master allows placeholders on linked forms: boxes MCA still reports empty get one.
      const LD = typeof window !== 'undefined' ? window.LinkedDummy : null;
      if (LD && LD.allowed(LF.answers) && typeof pageLinkedFillEmpty === 'function') {
        try {
          const fy = LD.fy();
          const r = await exec(pageLinkedFillEmpty, [{ from: fy.from, to: fy.to }], 30000);
          if (r && r.filled && r.filled.length) lfStep('confirm', 'active', `placeholder in ${r.filled.length} box(es) MCA reported empty — saving again…`);
        } catch (_) { }
      }
      if (halt('confirm')) return;
      // Let MCA / AEM finish reacting to the refill (dependent boxes, rules) and make sure the tab is still on
      // this form before Save is clicked a second time.
      await exec(pageLinkedIdle, [8000], 20000).catch(() => null);
      if (halt('confirm')) return;
      const still = await chrome.tabs.get(tab.id).catch(() => null);
      if (halt('confirm')) return;
      if (!still || !form.urlRe.test(still.url || '')) {
        lfStep('confirm', 'error', 'the MCA tab moved away from this form — Save was not clicked again');
        lfStep('proceed', 'skipped', 'not saved');
        finalState = 'warn'; finalNote = 'tab changed — Save not clicked again';
        return;
      }
      const s2 = await exec(pageLinkedClickSave, [], 15000);
      if (s2 && s2.clicked) c = await exec(pageLinkedConfirmSave, [12000], 50000).catch(() => null);
    }
    if (!c || !c.confirmed) {
      const why = c && c.errorsVisible ? 'MCA: ' + c.errorTexts.join(' · ') : 'no confirmation — check the MCA page';
      lfStep('confirm', c && c.errorsVisible ? 'error' : 'warn', lfShort(why, 220));
      lfStep('proceed', 'skipped', 'not saved');
      finalState = c && c.errorsVisible ? 'error' : 'warn'; finalNote = c && c.errorsVisible ? 'MCA errors after Save' : 'Save not confirmed';
      return;
    }
    lfStep('confirm', 'done', 'MCA confirmed the save');
    finalState = counts.failed || preFailed ? 'warn' : 'done';
    finalNote = `Saved · ${counts.filled} filled${counts.failed ? ` · ${counts.failed} failed` : ''}${preFailed ? ' · pre-step failed' : ''}`;

    // Proceed (AOC-2 / Auditor's report). The Board's report's next button is Submit: never clicked.
    if (form.nextButton !== 'Proceed') { lfStep('proceed', 'skipped', "Saved — Board's report has no Next (its next button is Submit, which you click)"); return; }
    if (!lfEl('lfProceed').checked) { lfStep('proceed', 'skipped', 'Proceed is off'); return; }
    if (preFailed) { lfStep('proceed', 'skipped', 'fix the failed pre-step first'); return; }
    // Autopilot: nobody is watching, so a form with fields that could not be filled is saved but not moved on.
    if (auto && counts.failed) { lfStep('proceed', 'skipped', `${counts.failed} field(s) not filled — check the form on MCA, then Proceed yourself`); return; }
    lfStep('proceed', 'active');
    // Baseline = the tab's own URL (the page's location.href can be spelled differently).
    const before = ((await chrome.tabs.get(tab.id).catch(() => null)) || tab).url;
    if (LF.stopRequested || stopNow()) { halted = true; lfStep('proceed', 'warn', 'stopped by you — saved, not proceeded'); finalState = 'warn'; finalNote = 'Saved — stopped before Proceed'; return; }
    const p = await exec(pageLinkedProceed, [], 15000).catch(e => ({ clicked: true, note: e.message }));
    if (!p || !p.clicked) {
      const why = !p ? 'no answer' : p.reason === 'field-errors' ? 'MCA shows: ' + p.errors.join(' · ') : p.reason;
      lfStep('proceed', p && p.reason === 'field-errors' ? 'error' : 'warn', lfShort(why, 220));
      return;
    }
    const nav = await lfWaitNavigation(tab.id, before, 30000);
    if (nav.navigated) {
      proceeded = true;
      nextUrl = nav.url || ((await chrome.tabs.get(tab.id).catch(() => null)) || {}).url;
      const next = lfDetectForm(nav.url, lfForms());
      lfStep('proceed', 'done', next ? `now on ${next.label} — ${auto ? 'the autopilot continues' : 'press Fill & Save again'}` : 'MCA moved on');
    } else {
      const idle = await exec(pageLinkedIdle, [8000], 20000).catch(() => null);
      if (idle && idle.errors.length) lfStep('proceed', 'error', lfShort('MCA shows: ' + idle.errors.join(' · '), 220));
      else lfStep('proceed', 'warn', 'clicked — the page did not move; check MCA' + (idle && idle.dialogs.length ? ': ' + idle.dialogs.join(' · ') : ''));
    }
  } catch (e) {
    const active = LF.steps.find(s => s.state === 'active');
    if (active) lfStep(active.id, 'error', e.message === 'timeout' ? 'the MCA page did not answer in time' : e.message);
    finalState = 'error'; finalNote = 'stopped: ' + e.message;
  } finally {
    for (const s of LF.steps) if (s.state === 'pending') LF.steps = lfStepUpdate(LF.steps, s.id, 'skipped');
    lfStopTicker(); lfRenderSteps();
    LF.running = false; runBtn.disabled = false; lfEl('lfStopBtn').disabled = true;
    LF.loadedAt = 0; // reload answers next time
    if (finalState && cin && form) await FilingChecklist.mark(cin, form.id, finalState, finalNote);
    if (typeof showMessage === 'function') {
      const level = finalState === 'done' ? 'success' : finalState === 'error' ? 'error' : 'warning';
      showMessage(level, `${form.label}: ${finalNote || 'see the step list'}`, 12000);
    }
    const proceedStep = LF.steps.find(s => s.id === 'proceed') || {};
    const state = halted ? 'stopped'
      : needs ? 'needs-answers'
        : finalState === 'done' ? (proceedStep.state === 'error' ? 'error' : proceedStep.state === 'warn' ? 'warn' : 'done')
          : finalState === 'warn' || finalState === 'active' ? 'warn' : 'error';
    const lastDetail = [...LF.steps].reverse().find(s => s.detail && s.state !== 'pending');
    rv.result = { state, form: form.id, proceeded, note: finalNote || (lastDetail ? lastDetail.detail : '') };
    if (nextUrl) rv.result.nextUrl = nextUrl;
    if (needs) rv.result.missing = needs;
  }
}

// The panel's tab-event redetect may re-prepare only when nothing is preparing or running (an autopilot lfRun
// included): a concurrent lfPrepare would replace LF.form / LF.tab / LF.jobs / LF.answers under that run.
function lfMayRedetect(panelOpen) {
  return !!panelOpen && !LF.running && !LF.preparing && !(LF.autoRuns > 0);
}

async function lfStop() {
  // Still detecting / loading answers: remember the Stop; lfRun honours it before touching MCA.
  if (!LF.running) { if (LF.preparing) LF.stopPending = true; return; }
  if (!LF.tab) return;
  LF.stopRequested = true; // lfRun checks this after every await and never reaches Save / Proceed afterwards
  lfEl('lfStopBtn').disabled = true;
  try { await chrome.scripting.executeScript({ target: { tabId: LF.tab.id }, world: 'MAIN', func: pageLinkedStop }); } catch (_) { }
  const active = LF.steps.find(s => s.state === 'active');
  if (active) lfStep(active.id, 'active', 'stopping after the current field…');
}

function initLinkedForms() {
  const panel = lfEl('lfPanel');
  if (!panel) return;
  lfRenderSteps();
  lfRenderChecklist();
  panel.addEventListener('toggle', () => { if (panel.open) lfPrepare(); });
  lfEl('lfCheckBtn').addEventListener('click', () => lfPrepare(true));
  lfEl('lfRunBtn').addEventListener('click', lfRun);
  lfEl('lfStopBtn').addEventListener('click', lfStop);
  // Keep the checklist in step with the loaded company and with marks from other modules.
  try {
    chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && (ch[LF_CHECKLIST_KEY] || ch.currentClient || ch.lastClient)) lfRenderChecklist(); });
  } catch (_) { }
  let t = null;
  const redetect = () => { clearTimeout(t); t = setTimeout(() => { if (lfMayRedetect(panel.open)) lfPrepare(); }, 600); };
  try { chrome.tabs.onActivated.addListener(redetect); chrome.tabs.onUpdated.addListener((id, info, t) => {
      // Only MCA tabs (once a form tab is known, only that tab): loading Gmail or the dashboard must not redetect.
      if (info.status === 'complete' && (!LF.tab || id === LF.tab.id) && t && /mca\.gov\.in/i.test(t.url || '')) redetect();
    }); } catch (_) { }
  // The loaded company changes without a storage event: refresh the checklist header now and then.
  let lastCin = lfCin();
  setInterval(() => { const c = lfCin(); if (c !== lastCin) { lastCin = c; lfRenderChecklist(); } }, 2000);
}

if (typeof window !== 'undefined') window.FilingChecklist = FilingChecklist;
if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', initLinkedForms);
if (typeof module !== 'undefined') module.exports = {
  lfDetectForm, lfStepsInit, lfStepUpdate, lfStepsSummary, lfChecklistMerge, lfChecklistView, lfNormDate, lfCollectMissing,
  lfShort, lfFieldRows, lfFillTimeout, lfSplitJobs, lfMs, lfHalted, lfMayRedetect, pageLinkedClickSave, pageLinkedProceed, pageLinkedIdle, pageLinkedStop, pageLinkedWaitFor,
  pageLinkedConfirmSave, lfMissingLabel, lfFetchAnswers, lfSaveAnswers, lfBuildFor, lfRun, lfStop, lfPrepare, LF,
  FilingChecklist, LF_PARTS, LF_STEP_DEFS, LF_CHECKLIST_KEY,
};
