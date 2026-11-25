// Autopilot — one click for AOC-4 and its linked forms, the way MCA really moves:
//   check   → asks once for everything the run needs (AOC-4 facts, page-2 declaration + certificate, the (a) PDF,
//             the linked forms' answers), saved to the company master;
//   aoc4p1  → doFill() via startRun(): the 7 sections of page 1, each saved, then MCA's Next (pageApForward);
//   aoc4p2  → step2Run({auto:true}): attachments, declaration, certificate, Save, then MCA's Proceed;
//   aoc2 / eauditor → lfRun({auto:true}) on whichever linked form MCA shows (fill → Save → Proceed);
//   eboard  → lfRun: fill → Save (its next button is Submit, which is the user's);
//   finish  → the Board's report is saved; its Submit and the DSC are the user's.
// After every forward click the page is detected again at once: a linked form runs, a second page of the same
// linked form is filled once more, a page already done in this run is never refilled (one forward click, at most
// 3 per page), AOC-4 Review & Submit is passed with Proceed or left to the user when MCA shows only Submit.
// Getting to the form (only when Run everything starts and no MCA form page is showing): an existing MCA tab in
// any window is focused and used (never a second one — that logs MCA out); with no MCA tab anywhere, exactly one
// tab is opened on the MCA login page. The user logs in by hand (ID, password, OTP, captcha are never typed or
// read here); once logged in, that tab is sent to the AOC-4 form and the run goes on.
// Safety: nothing here clicks a button containing "submit". The only tab opened is AP_LOGIN_URL (when no MCA tab
// exists); the only URLs a tab is ever sent to are AP_LOGIN_URL and AP_FORM_URL, and never from a form page (the
// user's draft). After the start, the autopilot only reacts to pages the user or MCA opened.
// Stop is final: after it nothing more is clicked on MCA.
// Classic script sharing globals with popup.js and js/*.js: every optional global is guarded with typeof.

const AP_KEY = 'autopilot.v1';
const AP_CERT_KEY = 'certifier.v1';       // the CA's own certificate details, same for every company
const AP_MAX_AGE_MS = 6 * 3600 * 1000;
const AP_DEBOUNCE_MS = 800;
// Looking for MCA's Next / Proceed follows the page, not a fixed time: while MCA is loading (page not complete,
// requests running, its spinner / overlay up) the side panel keeps looking; once MCA is idle and the button is still
// not there for AP_FWD_IDLE_PROBES probes in a row (400 ms apart, ~2 s), it gives up. AP_FWD_MAX_PROBES is only a
// safety cap for a page that never stops loading (~90 s).
const AP_FWD_IDLE_PROBES = 5;
const AP_FWD_MAX_PROBES = 225;
const AP_FWD_POLLS = 150;                 // × 400 ms = 60 s waiting for MCA to move after the click
const AP_FWD_MAX = 3;                     // forward clicks per page per run (loop guard)
// The only two MCA addresses the autopilot ever opens / sends a tab to.
const AP_LOGIN_URL = 'https://www.mca.gov.in/content/mca/global/en/foportal/fologin.html';
const AP_FORM_URL = 'https://www.mca.gov.in/content/mca/global/en/mca/e-filing/annual-filings/form-aoc4.html';
const AP_LOGIN_POLL_MS = 3000;            // while waiting for the user to log in
const AP_LOGIN_MAX_MS = 20 * 60 * 1000;   // give up waiting for the login after 20 min
const AP_WIZARD_POLL_MS = 1000;           // after opening AOC-4: wait for its wizard to render
const AP_WIZARD_MAX_MS = 90 * 1000;
const AP_NAV_LOADING_POLLS = 30;          // wait (x 1 s) for a loading MCA tab before deciding what it shows
const AP_LOGIN_SNAPSHOTS = 3;             // a page counts as logged out only when 3 snapshots ~1 s apart agree
const AP_STAGE_DEFS = [
  ['check', 'Check data'],
  ['aoc4p1', 'AOC-4 page 1 — fill, Save, Next'],
  ['aoc4p2', 'AOC-4 page 2 — fill, attach, Save, Proceed'],
  ['aoc2', 'AOC-2 — fill, Save, Proceed'],
  ['eauditor', "Auditor's report — fill, Save, Proceed"],
  ['eboard', "Board's report — fill, Save"],
  ['finish', "Board's report saved — you click Submit + sign"],
];
// AOC-4 page 2 "Certificate by Practicing Professional": [key, label, options].
const AP_CERT = [
  ['CERT_PROFESSION', 'Certificate — you are a', ['Chartered Accountant', 'Cost Accountant', 'Company Secretary']],
  ['CERT_ASSOC_FELLOW', 'Certificate — Associate or Fellow', ['Associate', 'Fellow']],
  ['CERT_MEMBERSHIP_NO', 'Certificate — membership number', null],
  ['CERT_COP_NO', 'Certificate — certificate of practice number', null],
];
// Short names of the 7 page-1 sections (status line: "Phase 3 of 7 — Balance sheet: saving…").
const AP_PHASE_NAMES = { 1: 'General info', 2: 'Subsidiary, auditor & service provider', 3: 'Balance sheet', 4: 'Financial parameters',
  5: 'Share capital & cost records', 6: 'Profit and loss', 7: 'Products & disclosures' };
const AP_STATES = ['pending', 'active', 'done', 'warn', 'error', 'skipped', 'waiting'];
const AP_LOCKED = ['done', 'skipped'];           // never reopened within a run
const AP_LINKED = ['aoc2', 'eauditor', 'eboard'];
// Declaration answers shared by AOC-4 page 2 and the linked forms (company master formType 'aoc4').
const AP_SHARED_KEYS = ['BOARD_RESOLUTION_NO', 'BOARD_RESOLUTION_DATE', 'DECL_DESIGNATION', 'DECL_DIN'];
// Page-2 declaration: [answer key, step2 value name, label, type].
const AP_DECL = [
  ['BOARD_RESOLUTION_NO', 'resNo', 'Declaration — board resolution number', 'text'],
  ['BOARD_RESOLUTION_DATE', 'resDate', 'Declaration — board resolution date', 'date'],
  ['DECL_DIN', 'din', 'Declaration — DIN / PAN / membership no. of the signatory', 'text'],
];
const AP_ICON = { pending: '○', active: '◐', done: '✓', warn: '!', error: '✗', skipped: '–', waiting: '⏸' };
const AP_YOU = {
  review: 'MCA shows only Submit on AOC-4 Review. Click it yourself; the autopilot continues on the next form.',
  wentBack: name => `MCA went back to ${name}. Check MCA for an error message, then press Run everything.`,
  finish: "Everything is saved. Review the Board's report, then click Submit and sign with your DSC yourself.",
  login: 'Log in again and reopen the form — the autopilot resumes where it stopped.',
  unknown: 'This page is not automated: fill this one yourself and click Proceed; the autopilot continues on the next known form.',
  tab: 'Open the MCA form tab in this window — the autopilot continues by itself.',
  stopped: 'Stopped. Nothing more is clicked on MCA. Press Run everything to start again.',
  manual: n => `Fill Q12(c) (service provider) on MCA yourself — its Save clicks by itself (click Save there if it does not). The autopilot then carries on with Phase ${n} by itself.`,
  manualReloaded: n => `The MCA page was reloaded, so Q12(c) is no longer watched. Fill Q12(c) (service provider) on MCA and click its Save yourself, then press Run everything — it carries on with Phase ${n}. Nothing is filled or clicked until then.`,
  opening: 'MCA is opening. Log in yourself (user ID, password, OTP, captcha). The autopilot opens AOC-4 and carries on as soon as you are logged in.',
  loginPage: 'MCA shows its login page. Log in yourself (user ID, password, OTP, captcha). The autopilot opens AOC-4 and carries on as soon as you are logged in.',
  loginHere: 'Log in to MCA yourself on the MCA tab (user ID, password, OTP, captcha). The autopilot opens AOC-4 and carries on as soon as you are logged in.',
  loginTimeout: 'Still not logged in to MCA after 20 minutes — stopped waiting. Log in, then press Run everything again.',
  reopen: 'You are logged in again. Reopen your AOC-4 draft from My Application on MCA — the autopilot resumes where it stopped (it does not open a new form, that would start a new filing).',
};
// After the side panel is reopened, an armed run looks at the MCA page at once only while it was waiting for one
// of these (not while a stage was running, nor after an error).
const AP_NUDGE = ['submit', 'next', 'unknown', 'login', 'tab', 'manual', 'reopen'];
// Waiting states in which an MCA wizard step can change without any tab event: the page is polled.
const AP_STEP_WAIT = ['next', 'submit'];

// ───────────────────────── pure helpers (tested in tests/autopilot.test.mjs) ─────────────────────────

function apStagesInit() {
  return AP_STAGE_DEFS.map(([id, label]) => ({ id, label, state: 'pending', detail: '', startedAt: null, ms: null }));
}

// Returns a new stage list. done / skipped are never reopened (the same state may update its detail);
// warn / error / waiting may be retried. Elapsed ms accumulates over every active spell of a stage.
function apStageUpdate(stages, id, state, detail, now = Date.now()) {
  if (!AP_STATES.includes(state)) return stages;
  return (stages || []).map(s => {
    if (s.id !== id) return s;
    if (AP_LOCKED.includes(s.state) && state !== s.state) return s;
    const n = { ...s, state, detail: detail == null ? s.detail : String(detail) };
    if (state === 'active' && s.state !== 'active') n.startedAt = now;
    if (s.state === 'active' && state !== 'active') {
      n.ms = (s.ms || 0) + Math.max(0, now - (s.startedAt == null ? now : s.startedAt));
      n.startedAt = null;
    } else if (state !== 'active' && state !== 'pending' && state !== 'waiting' && n.ms == null) n.ms = 0;
    return n;
  });
}

// Elapsed ms of a stage, live while it is active.
function apStageMs(s, now = Date.now()) {
  if (!s) return null;
  if (s.state === 'active' && s.startedAt != null) return (s.ms || 0) + Math.max(0, now - s.startedAt);
  return s.ms;
}

// The first stage that is not finished (pending, active or waiting), or null.
function apNextStage(stages) {
  const s = (stages || []).find(x => x.state === 'pending' || x.state === 'active' || x.state === 'waiting');
  return s ? s.id : null;
}

function apIsMca(url) { return /^https:\/\/([a-z0-9-]+\.)*mca\.gov\.in\//i.test(String(url || '')); }

// MCA sign-in pages (the session timed out or the user logged out).
function apIsLogin(url) {
  const u = String(url || '');
  return /^https?:\/\/([a-z0-9-]+\.)*mca\.gov\.in\//i.test(u) && /login|signin|fologin/i.test(u);
}

// Any MCA address (http or https, also a tab still loading it).
function apIsMcaAny(url) { return /^https?:\/\/([a-z0-9-]+\.)*mca\.gov\.in(\/|$)/i.test(String(url || '')); }

// An MCA e-form page (AOC-4, a linked form, any e-filing form): it may hold the user's draft, so the autopilot
// never sends such a tab anywhere else.
function apIsFormUrl(url, forms) {
  const u = String(url || '');
  if (!apIsMcaAny(u)) return false;
  if ((forms || []).some(f => f && f.urlRe instanceof RegExp && f.urlRe.test(u))) return true;
  return /\/e-filing\//i.test(u) || /\/form-[\w-]+\.html/i.test(u);
}

// The MCA tab to use when Run everything starts: a form page first, then the tab the side panel already uses,
// then a logged-in page, the login page last; ties by the active tab, then the most recently used.
function apRankMcaTabs(tabs, forms, preferId) {
  const url = t => String((t && (t.url || t.pendingUrl)) || '');
  const both = t => [t && t.url, t && t.pendingUrl].map(u => String(u || ''));
  // A form the autopilot can run (AOC-4 / a linked form, also while it is still loading) first; any other form
  // page (e.g. an MGT-7 draft) is never preferred over a usable tab (and never navigated), but ranks above login.
  const rank = t => (both(t).some(u => apFormToAwait(u, forms)) ? 0 : t.id === preferId ? 1
    : both(t).some(u => apIsFormUrl(u, forms)) ? 2.5 : !apIsLogin(url(t)) ? 2 : 3);
  return (tabs || []).filter(t => t && t.id != null && both(t).some(u => apIsMcaAny(u)))
    .sort((a, b) => rank(a) - rank(b) || Number(!!b.active) - Number(!!a.active) || (b.lastAccessed || 0) - (a.lastAccessed || 0));
}

// The two addresses a tab may be sent to (anything else is refused).
function apAllowedNav(url) { return url === AP_LOGIN_URL || url === AP_FORM_URL; }

// Which page the open MCA tab shows: a linked form (its stage id) by its module's urlRe, AOC-4 by its active
// wizard step ('aoc4p1' / 'aoc4p2' / 'review' — Review & Submit is a page, not a stage). null when none of them.
function apStageForPage(url, step, forms) {
  const u = String(url || '');
  if (!apIsMca(u)) return null;
  const f = (forms || []).find(x => x && x.urlRe instanceof RegExp && x.urlRe.test(u));
  if (f && AP_LINKED.includes(f.id)) return f.id;
  if (/form-aoc4/i.test(u) && !/offline/i.test(u)) {
    const s = String(step || '');
    if (/review/i.test(s)) return 'review';
    if (/att\w*ment/i.test(s)) return 'aoc4p2';
    if (/company details|registration/i.test(s)) return 'aoc4p1';
  }
  return null;
}

// What to do on the detected page given the stage list:
//   {run: id}                     fill this page;
//   {forward: page, prefer: [...]} the page is finished: move on with MCA's Proceed / Next (never refilled);
//   {wait: reason}                nothing to do here.
// `left`: page keys this run already moved away from — a finished linked form is only moved on from when MCA
// brought the run back to it (otherwise its own Proceed setting / result stands).
function apPlan(stages, detected, opts = {}) {
  const st = id => ((stages || []).find(s => s.id === id) || {}).state;
  // An AOC-4 page counts as finished once done, skipped or saved with warnings (an error ends the run).
  const open = id => !['done', 'skipped', 'warn'].includes(st(id));
  if (!detected) return { wait: 'unknown' };
  if (detected === 'aoc4p1') return open('aoc4p1') ? { run: 'aoc4p1' } : { forward: 'aoc4p1', prefer: ['Proceed', 'Next'] };
  if (detected === 'aoc4p2') return open('aoc4p2') ? { run: 'aoc4p2' } : { forward: 'aoc4p2', prefer: ['Proceed', 'Next'] };
  if (detected === 'review') return { forward: 'review', prefer: ['Proceed'] };
  if (AP_LINKED.includes(detected)) {
    if (['pending', 'active', 'waiting'].includes(st(detected))) return { run: detected };
    if (st(detected) === 'done' && opts.revisit) return { forward: detected, prefer: ['Proceed', 'Next'] };
    return { wait: 'linked-done', form: detected };
  }
  return { wait: 'unknown' };
}

// The pages in the order MCA shows them (a lower index = earlier in the filing).
const AP_PAGE_ORDER = ['aoc4p1', 'aoc4p2', 'review', 'aoc2', 'eauditor', 'eboard'];
// While the run waits for the user in one of these, a finished page is never moved on from by itself.
const AP_HOLD_WAITS = ['next', 'submit', 'fix', 'manual'];
const apPageIdx = page => AP_PAGE_ORDER.indexOf(page);

// True when a forward click (Next / Proceed) from `detected` must not happen: the run waits for the user on
// `waitPage` (a failed forward, Review & Submit, a hand step — or that page's stage is 'warn') and MCA shows that
// page or an earlier one, i.e. the user went back (or just came back to the page) to correct something.
function apHoldForward(detected, waitPage, waitingFor, waitState) {
  if (!detected || !waitPage) return false;
  const at = apPageIdx(detected), w = apPageIdx(waitPage);
  if (at < 0 || w < 0 || at > w) return false;
  return AP_HOLD_WAITS.includes(waitingFor) || waitState === 'warn';
}

// The CIN of another company when the MCA page shows CINs and none of them is this run's company; else ''.
function apOtherCompany(cins, cin) {
  const own = String(cin || '').toUpperCase();
  const re = /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;
  if (!re.test(own)) return '';
  const seen = (Array.isArray(cins) ? cins : []).map(c => String(c || '').trim().toUpperCase()).filter(c => re.test(c));
  if (!seen.length || seen.includes(own)) return '';
  return seen[0];
}

// One key per MCA page: the URL without query / hash plus the wizard step shown.
function apPageKey(url, step) {
  return `${String(url || '').split(/[?#]/)[0]}|${String(step || '').replace(/\s+/g, ' ').trim().toLowerCase()}`;
}

function apPageName(detected, forms) {
  const names = { aoc4p1: 'AOC-4 page 1', aoc4p2: 'AOC-4 page 2', review: 'AOC-4 Review & Submit' };
  if (names[detected]) return names[detected];
  const f = (forms || []).find(x => x && x.id === detected);
  return (f && f.label) || detected || 'this page';
}

// Why a forward click did not move MCA on (pageApForward / apForwardAndWait result) — for the "You:" line.
function apForwardWhy(r) {
  if (!r) return 'no answer from the MCA page';
  if (r.reason === 'field-errors') return 'MCA shows: ' + (r.errors || []).join(' · ');
  if (r.reason === 'several') return `MCA shows more than one “${r.label}” button`;
  if (r.reason === 'none') return `MCA shows only: ${(r.seen || []).join(', ') || 'no buttons'}`;
  if (r.reason === 'loop') return 'MCA keeps coming back to this page';
  if (r.reason === 'mca-error') return 'MCA says: ' + (r.errors || []).join(' · ');
  if (r.clicked) return `${r.label} was clicked, but MCA did not move${r.reason && r.reason !== 'did not move' ? ` (${r.reason})` : ''}`;
  return r.reason || 'the button was not clicked';
}

// The phase runner's live timeline (js/ui/timeline.js calls) → one detail line for the page-1 stage.
// method: setActive | setDone | setError | note; stepId: prepare | open | phase1 | phase2 | phase3_6 | phase7.
function apTimelineDetail(method, stepId, sub) {
  const text = String(sub == null ? '' : sub).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const tag = method === 'setError' ? '⚠ ' : '';
  const name = n => AP_PHASE_NAMES[n] ? ` — ${AP_PHASE_NAMES[n]}` : '';
  const m = text.match(/^Phase (\d)\s*:\s*(.*)$/i);
  if (m) return `${tag}Phase ${m[1]} of 7${name(+m[1])}: ${m[2]}`;
  const byStep = { phase1: 1, phase2: 2, phase7: 7 }[stepId];
  if (byStep) return `${tag}Phase ${byStep} of 7${name(byStep)}: ${text}`;
  if (stepId === 'phase3_6') return `${tag}Phases 3–6: ${text}`;
  if (stepId === 'prepare') return `${tag}Preparing: ${text}`;
  if (stepId === 'open') return `${tag}MCA tab: ${text}`;
  return tag + text;
}

// "N filled · M failed" from the linked-form runner's step list (LF.steps) after an lfRun.
function apLinkedCounts(steps) {
  const fill = (steps || []).find(s => s && s.id === 'fill');
  const m = fill && String(fill.detail || '').match(/(\d+) filled\b.*?(\d+) failed/);
  return m ? `${m[1]} filled · ${m[2]} failed` : '';
}

// The CA's certificate details: which are missing or not one of the offered options.
function apCertMissing(cert) {
  if (!cert) return [];
  const out = [];
  // MCA shows a certificate-of-practice box only for a Company Secretary / Cost Accountant; a Chartered
  // Accountant gives the membership number alone, so the COP number is not asked for a CA.
  const isCA = /chartered/i.test(String(cert.CERT_PROFESSION || ''));
  for (const [key, label, options] of AP_CERT) {
    const v = String(cert[key] == null ? '' : cert[key]).trim();
    if (key === 'CERT_COP_NO' && !v && isCA) continue;
    if (v && (!options || options.includes(v))) continue;
    out.push({ key, label, type: options ? 'select' : 'text', ...(options ? { options } : {}), formType: 'aoc4', ...(v ? { default: v } : {}) });
  }
  return out;
}
const apCertPick = o => Object.fromEntries(AP_CERT.map(([k]) => [k, o && o[k] != null ? String(o[k]) : '']).filter(([, v]) => v.trim()));

// Missing answers → ask groups. Shared declaration keys go to one 'aoc4' group (asked once even when
// several forms need them); the rest stay with their form. Optional items are not asked up front.
function apGroupMissing(byForm, forms) {
  const shared = { id: 'aoc4', label: 'Declaration (AOC-4 page 2 and linked forms)', answersForm: 'aoc4', missing: [] };
  const groups = [];
  for (const form of forms || []) {
    const own = { id: form.id, label: form.label || form.id, answersForm: form.answersForm || form.id, missing: [] };
    for (const m of (byForm || {})[form.id] || []) {
      if (!m || !m.key || m.optional) continue;
      if (AP_SHARED_KEYS.includes(m.key) || m.formType === 'aoc4') {
        if (!shared.missing.some(x => x.key === m.key)) shared.missing.push({ ...m, formType: 'aoc4' });
      } else if (!own.missing.some(x => x.key === m.key)) own.missing.push(m);
    }
    if (own.missing.length) groups.push(own);
  }
  return shared.missing.length ? [shared, ...groups] : groups;
}

// Any common date spelling → DD/MM/YYYY (step2Run's rule), or null when it is not a real date.
function apDateDDMMYYYY(s) {
  const p = String(s == null ? '' : s).trim().split(/[\/\-.]/);
  if (p.length !== 3 || p.some(x => !/^\d+$/.test(x))) return null;
  let [d, m, y] = p[0].length === 4 ? [p[2], p[1], p[0]] : p;
  if (y.length === 2) y = '20' + y;
  if (y.length !== 4) return null;
  const dt = new Date(Date.UTC(+y, +m - 1, +d));
  if (dt.getUTCFullYear() !== +y || dt.getUTCMonth() !== +m - 1 || dt.getUTCDate() !== +d) return null;
  return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
}

// Page-2 declaration values that are present but would fail step2Run's checks (step2Validate) — found before
// page 1 runs, not after it. Returns [{key, error}].
function apStep2Invalid(step2) {
  if (!step2) return [];
  const s = k => String(step2[k] == null ? '' : step2[k]).trim();
  const out = [];
  if (s('resDate') && !apDateDDMMYYYY(s('resDate'))) out.push({ key: 'BOARD_RESOLUTION_DATE', error: 'use DD/MM/YYYY (a real date)' });
  // MCA's box takes at most 10 characters (it cut "TEST-01/2026-27" to "TEST-01/20" on the live form).
  if (s('resNo').length > 10) out.push({ key: 'BOARD_RESOLUTION_NO', error: `MCA takes at most 10 characters (this has ${s('resNo').length})` });
  const desig = s('desig') || 'Director';
  if (s('din') && desig === 'Director' && !/^\d{8}$/.test(s('din'))) out.push({ key: 'DECL_DIN', error: 'a Director’s DIN must be 8 digits' });
  return out;
}

// Everything the run will need that is not known yet, grouped for one ask.
// answersByForm: {formId: merged answers}; step2: {resNo,resDate,din,desig} or null (page 2 not run);
// cert: the certificate details known so far ({CERT_…}) or null when page 2 is not run.
function apCollectPreflight({ client, answersByForm, forms, step2, needFileA, cert } = {}) {
  const missingByForm = {}, notes = [];
  for (const form of forms || []) {
    if (!form || typeof form.buildData !== 'function') continue;
    try {
      const b = form.buildData(client, (answersByForm || {})[form.id] || {}) || {};
      missingByForm[form.id] = b.missing || [];
    } catch (e) { notes.push(`${form.label || form.id}: ${e.message}`); }
  }
  const groups = apGroupMissing(missingByForm, forms);
  if (step2) {
    let shared = groups.find(g => g.id === 'aoc4');
    const invalid = apStep2Invalid(step2);
    for (const [key, name, label, type] of AP_DECL) {
      const bad = invalid.find(x => x.key === key);
      const value = String(step2[name] == null ? '' : step2[name]).trim();
      if (value && !bad) continue;
      if (!shared) { shared = { id: 'aoc4', label: 'Declaration (AOC-4 page 2 and linked forms)', answersForm: 'aoc4', missing: [] }; groups.unshift(shared); }
      let m = shared.missing.find(x => x.key === key);
      if (!m) { m = { key, label, type, formType: 'aoc4' }; shared.missing.push(m); }
      if (bad) {
        if (m.default == null) m.default = value;
        (shared.errors = shared.errors || []).push(`${shared.label}: ${m.label || key}: ${bad.error}`);
      }
    }
  }
  const certMissing = apCertMissing(cert);
  if (certMissing.length) {
    const g = { id: 'cert', label: 'Certificate by Practicing Professional — your details (asked once, kept for every company)', answersForm: 'aoc4', missing: certMissing };
    const at = groups.findIndex(x => x.id === 'aoc4');
    groups.splice(at + 1, 0, g);
  }
  const count = groups.reduce((n, g) => n + g.missing.length, 0) + (needFileA ? 1 : 0);
  return { groups, count, needFileA: !!needFileA, notes };
}

function apProgress(stages) {
  const list = stages || [];
  const done = list.filter(s => ['done', 'skipped', 'warn'].includes(s.state) || (s.id === 'finish' && s.state === 'waiting')).length;
  return { done, total: list.length, pct: list.length ? Math.round((done / list.length) * 100) : 0 };
}

function apFmt(ms) {
  if (ms == null) return '';
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

function apSummaryLine(stages, totalMs) {
  const c = { done: 0, warn: 0, error: 0, skipped: 0 };
  for (const s of stages || []) if (c[s.state] != null) c[s.state]++;
  return `${c.done} done · ${c.warn} warning · ${c.error} error · ${c.skipped} skipped${totalMs != null ? ` · total ${apFmt(totalMs)}` : ''}`;
}

// doFill() result → a short reason.
function apFillWhy(r) {
  if (!r) return 'no result from the fill';
  const reasons = {
    busy: 'another fill is already running', 'no-client': 'no company loaded', 'data-errors': 'the client data has errors',
    preflight: 'stopped at the questions before filling', 'no-tab': 'no MCA tab', 'autosave-off': '"Click each section’s Save" is off',
    'required-fields': 'MCA needs fields the data does not have', validation: 'MCA shows validation errors',
    'section-locked': 'MCA did not open the next section', stopped: 'stopped',
    'manual-step': 'Q12(c) must be completed by hand on MCA, then Save',
    'phase-not-started': 'a section could not start (see the message above)',
    'phase-missing': 'a section definition is missing', 'not-saved': 'MCA did not confirm every Save',
  };
  // Which sections MCA refused says more than the bare 'not-saved' code.
  if (Array.isArray(r.notSaved) && r.notSaved.length) {
    // Short form: "Phases 1, 2, 3 not saved — <reason>" (one reason when they share it), not one long sentence each.
    const parts = r.notSaved.map(x => { const seg = String(x).split(' — '); const m = seg[0].match(/^Phase\s*(\d+)/); return m && seg.length > 2 ? { n: m[1], why: seg.slice(2).join(' — ') } : { n: '', why: String(x) }; });
    const whys = [...new Set(parts.map(p => p.why))];
    const nums = parts.map(p => p.n).filter(Boolean);
    const which = nums.length ? `Phase${nums.length > 1 ? 's' : ''} ${nums.join(', ')} not saved` : 'not saved';
    if (whys.length === 1) {
      const hint = /greyed out/i.test(whys[0]) ? '. Reload the MCA page (F5), wait until it has fully loaded and Save is blue, then press Run everything again' : '';
      return `${which} — ${whys[0]}${hint}`;
    }
    return `${which}: ` + parts.map(p => (p.n ? `Phase ${p.n}: ` : '') + p.why).join('; ');
  }
  if (r.reason && reasons[r.reason]) return reasons[r.reason];
  if (r.reason) return String(r.reason);
  if (!r.completedAll) return 'did not reach the last section';
  return 'did not finish';
}

// ───────────────────────── page function (MCA tab, world MAIN — self-contained) ─────────────────────────

// MCA's error popup ("Error Type | Error Message" table, or a dialog that says ERROR): reads the message(s),
// then clicks its OK / Close so the page is usable again. Never clicks anything that mentions submit.
// Returns {errors: [...]} or null when no error popup is showing.
async function pageApErrorDialog() {
  const visible = el => !!el && el.getClientRects().length > 0;
  // Popup text comes from innerText ONLY: MCA keeps its popup templates hidden in the DOM (visibility / opacity /
  // aria-hidden / zero size), and their textContent would read every template as an open popup.
  const t = el => String((el && el.innerText) || '').replace(/\s+/g, ' ').trim();
  // A popup box is open only when it is really shown (not merely laid out). Not limited to the viewport.
  const shown = el => {
    if (!el || el.getClientRects().length === 0) return false;
    for (let x = el; x && x.nodeType === 1; x = x.parentElement) {
      if (x.getAttribute && x.getAttribute('aria-hidden') === 'true') return false;
      if (typeof getComputedStyle === 'function') {
        const cs = getComputedStyle(x);
        if (cs && (cs.display === 'none' || (x === el && (cs.visibility === 'hidden' || cs.visibility === 'collapse')) || parseFloat(cs.opacity) === 0)) return false;
      }
    }
    const r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    if (r && (r.width < 2 || r.height < 2)) return false;
    return String(el.innerText || '').trim().length > 0;
  };
  // Close for sure: the popup's own OK first; if MCA's popup is still up, hide it through the AEM form model
  // (exact node id only), then hide its box and the backdrop so the page is never left blocked.
  const forceClose = box => {
    const host = (box.closest && box.closest('[id*="modal_container"]')) || box;
    try {
      const gb = window.guideBridge;
      if (gb && typeof gb.visit === 'function' && host.id) gb.visit(n => { if (n && n.id === host.id) { try { n.visible = false; } catch (_) { } } });
    } catch (_) { }
    if (host.style && host.getClientRects().length > 0) host.style.display = 'none';
    try { document.querySelectorAll('.modal-backdrop').forEach(b => b.remove()); } catch (_) { }
    try { if (document.body && document.body.classList) document.body.classList.remove('modal-open'); } catch (_) { }
  };
  const boxes = [...document.querySelectorAll('[id*="modal_container"], [role="dialog"], [role="alertdialog"], .modal, .modal-dialog, .modal-content, .ui-dialog, .swal2-popup, .guideDialogNode, [class*="popup"], div')]
    .filter(n => visible(n) && t(n).length <= 1500 && /error message|\berror\b/i.test(t(n)) && !/success/i.test(t(n))
      && [...n.querySelectorAll('button, [role="button"], input[type="button"]')].some(b => visible(b) && /^(ok|okay|close)$/i.test(t(b) || b.value || ''))
      && shown(n))
    .sort((a, b) => t(a).length - t(b).length);
  const box = boxes[0];
  if (!box || !shown(box)) return null;
  // Rows of the error table: the last cell is the message; else the dialog text without the headings / OK.
  const rows = [...box.querySelectorAll('tr')].map(r => [...r.querySelectorAll('td')].map(t)).filter(c => c.length >= 2 && c[c.length - 1]);
  let errors = rows.map(c => c[c.length - 1]).filter(m => !/^error message$/i.test(m));
  if (!errors.length) errors = [t(box).replace(/error type|error message|\bOK\b/gi, ' ').replace(/\s+/g, ' ').trim()];
  const ok = [...box.querySelectorAll('button, [role="button"], input[type="button"]')].find(b => visible(b) && /^(ok|okay|close)$/i.test(t(b) || b.value || '') && !/submit/i.test(t(b)));
  if (ok) ok.click();
  await new Promise(r => setTimeout(r, 700));
  let forced = false;
  // Only the box that was shown before the OK click, and is still shown now, is ever force-closed.
  if (shown(box)) { forceClose(box); forced = true; }
  return { errors: [...new Set(errors)].slice(0, 6), closed: true, forced };
}

// Closes MCA's information popups that may still be up ("Data Added Successfully", "Document Uploaded Succesfully",
// "saved" …): OK first, then the sure way. Never touches a popup that mentions submit or an error (those are read
// by pageApErrorDialog). Returns {closed: [texts]}.
async function pageApCloseInfoPopups() {
  const visible = el => !!el && el.getClientRects().length > 0;
  // Popup text comes from innerText ONLY: MCA keeps its popup templates hidden in the DOM (visibility / opacity /
  // aria-hidden / zero size), and their textContent would read every template as an open popup.
  const t = el => String((el && el.innerText) || '').replace(/\s+/g, ' ').trim();
  // A popup box is open only when it is really shown (not merely laid out). Not limited to the viewport.
  const shown = el => {
    if (!el || el.getClientRects().length === 0) return false;
    for (let x = el; x && x.nodeType === 1; x = x.parentElement) {
      if (x.getAttribute && x.getAttribute('aria-hidden') === 'true') return false;
      if (typeof getComputedStyle === 'function') {
        const cs = getComputedStyle(x);
        if (cs && (cs.display === 'none' || (x === el && (cs.visibility === 'hidden' || cs.visibility === 'collapse')) || parseFloat(cs.opacity) === 0)) return false;
      }
    }
    const r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    if (r && (r.width < 2 || r.height < 2)) return false;
    return String(el.innerText || '').trim().length > 0;
  };
  // Close for sure: the popup's own OK first; if MCA's popup is still up, hide it through the AEM form model
  // (exact node id only), then hide its box and the backdrop so the page is never left blocked.
  const forceClose = box => {
    const host = (box.closest && box.closest('[id*="modal_container"]')) || box;
    try {
      const gb = window.guideBridge;
      if (gb && typeof gb.visit === 'function' && host.id) gb.visit(n => { if (n && n.id === host.id) { try { n.visible = false; } catch (_) { } } });
    } catch (_) { }
    if (host.style && host.getClientRects().length > 0) host.style.display = 'none';
    try { document.querySelectorAll('.modal-backdrop').forEach(b => b.remove()); } catch (_) { }
    try { if (document.body && document.body.classList) document.body.classList.remove('modal-open'); } catch (_) { }
  };
  const INFO = /(added|saved|uploaded|updated|filled)\s+succes+ful+y|succes+ful+y\s+(saved|added|uploaded|updated)|data saved/i;
  const closed = [];
  for (let round = 0; round < 4; round++) {
    const box = [...document.querySelectorAll('[id*="modal_container"], [role="dialog"], [role="alertdialog"], .modal, .modal-dialog, .ui-dialog, .swal2-popup')]
      .filter(n => visible(n) && t(n).length <= 600 && INFO.test(t(n)) && !/submit|error/i.test(t(n)) && shown(n))
      .sort((a, b) => t(a).length - t(b).length)[0];
    if (!box || !shown(box)) break;
    closed.push(t(box).slice(0, 80));
    const ok = [...box.querySelectorAll('button, [role="button"], input[type="button"]')].find(b => visible(b) && /^(ok|okay|close|×|✕)$/i.test(t(b) || b.value || ''));
    if (ok) ok.click();
    await new Promise(r => setTimeout(r, 500));
    // Only the box that was shown before the OK click, and is still shown now, is ever force-closed.
    if (shown(box)) forceClose(box);
  }
  return { closed };
}

function pageApWhere() {
  const t = el => String((el && (el.innerText || el.textContent)) || '').replace(/\s+/g, ' ').trim();
  // CIN-shaped values in the page's boxes (the company's own CIN is prefilled by MCA): lets the side panel see
  // that a tab belongs to another company. Reads values only, changes nothing.
  let cins = [];
  try {
    cins = [...new Set([...document.querySelectorAll('input, textarea')].map(e => String(e.value || '').trim().toUpperCase())
      .filter(v => /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/.test(v)))].slice(0, 20);
  } catch (_) { cins = []; }
  return { url: location.href, step: t([...document.querySelectorAll('.listep.progress-step.active')].pop()), title: document.title, cins };
}

// Is the user logged in to MCA on this page? Reads only what the page shows: MCA's user menu ("Hello <NAME>")
// or a visible Logout / Sign out control. Never reads or touches any input (no credentials, OTP or captcha).
// loginLink: a visible Login / Sign in control (a logged-out MCA page).
function pageApLoginState() {
  const href = String(location.href || '');
  const onLoginPage = /fologin|login|signin/i.test(href);
  const visible = el => !!el && typeof el.getClientRects === 'function' && el.getClientRects().length > 0;
  const t = el => String((el && (el.innerText || el.textContent)) || '').replace(/\s+/g, ' ').trim();
  let hello = false, logout = false, loginLink = false, name = '';
  for (const el of document.querySelectorAll('a, button, span, div, li, p, strong, [role="button"], [role="menuitem"]')) {
    const s = t(el);
    if (!s || s.length > 60 || !visible(el)) continue;
    if (/^hello\b/i.test(s)) {
      hello = true;
      if (!name) name = s.replace(/^hello\b[\s,!]*/i, '').slice(0, 40);
    } else if (/^(log ?out|sign ?out)$/i.test(s)) logout = true;
    else if (/^(log ?in|sign ?in)$/i.test(s) && /^(a|button)$/i.test(el.tagName || '')) loginLink = true;
  }
  const loggedIn = !onLoginPage && (hello || logout);
  return { loggedIn, onLoginPage, loginLink: loginLink && !hello && !logout, ...(loggedIn && name ? { name } : {}) };
}

// Q12(c): the automatic Save armed by pageArmManualSave (page-automation.js) — has it been clicked yet?
function pageApManualState() {
  const s = window.__aoc4ManualProviderSave;
  return { armed: !!(s && s.armed), completed: !!(s && s.completed) };
}

// Moves MCA on from a saved page: clicks the one visible, enabled button (outside any dialog) whose text / value
// EQUALS one of `prefer` (case-insensitive), tried in that order. Anything containing "submit" is never a
// candidate. Visible field errors → nothing is clicked. It does not wait for MCA to move (the side panel does);
// waitMs only bounds the wait for a matching button to appear.
// Returns {clicked, label, seen (visible button labels, max 10), reason?: 'field-errors'|'several'|'none', errors?}.
async function pageApForward(prefer = ['Proceed', 'Next'], waitMs = 60000, opts = {}) {
  const pause = ms => new Promise(r => setTimeout(r, ms));
  const visible = el => !!el && typeof el.getClientRects === 'function' && el.getClientRects().length > 0;
  const text = el => String((el && (el.innerText || el.textContent)) || '').replace(/\s+/g, ' ').trim();
  const label = el => text(el) || String((el && el.value) || '').replace(/\s+/g, ' ').trim();
  const isSubmit = b => /submit/i.test(label(b)) || /submit/i.test(String((b && b.value) || ''));
  const inDialog = b => !!(b.closest && b.closest('[id*="modal_container"], [role="dialog"], [role="alertdialog"], .modal, .modal-dialog, .ui-dialog, .swal2-popup'));
  // A button counts only when really displayed: MCA keeps hidden popup templates (with their own Proceed / Yes / OK
  // buttons) laid out in the DOM under visibility:hidden / opacity:0 / aria-hidden. Clicking one of those sent the
  // form back to page 1.
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
  const off = b => !!b.disabled || (typeof b.getAttribute === 'function' && b.getAttribute('aria-disabled') === 'true');
  const wanted = (Array.isArray(prefer) ? prefer : [prefer]).map(x => String(x == null ? '' : x).trim()).filter(x => x && !/submit/i.test(x));
  const buttons = () => [...document.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"]')]
    .filter(b => displayed(b) && !inDialog(b));
  const seen = () => [...new Set(buttons().map(label).filter(Boolean))].slice(0, 10);
  const errors = () => [...document.querySelectorAll('.guideFieldError')].filter(e => displayed(e) && String(e.innerText || '').trim())
    .map(e => String(e.innerText).replace(/\s+/g, ' ').trim());
  // Is MCA still working? The document is loading, jQuery / AEM requests are running, or a spinner / loading
  // overlay is on screen. Read only, changes nothing.
  const busy = () => {
    try { if (document.readyState && document.readyState !== 'complete') return true; } catch (_) { }
    try { if (window.jQuery && window.jQuery.active > 0) return true; } catch (_) { }
    try {
      return [...document.querySelectorAll('.guide-loading, .guideLoading, .loading, .loader, .spinner, .blockUI, .blockOverlay, .ui-widget-overlay, [class*="spinner"], [class*="loading-overlay"], [class*="loader"]')]
        .some(el => displayed(el) && (!el.getBoundingClientRect || el.getBoundingClientRect().width >= 8));
    } catch (_) { return false; }
  };
  const t0 = Date.now();
  for (;;) {
    const errs = errors();
    // Field errors stop a move forward; going back (Previous, to correct them) is allowed.
    if (errs.length && !(opts && opts.back)) return { clicked: false, label: '', seen: seen(), reason: 'field-errors', errors: [...new Set(errs)].slice(0, 8) };
    const live = buttons().filter(b => !off(b) && !isSubmit(b));
    for (const want of wanted) {
      const hits = live.filter(b => label(b).toLowerCase() === want.toLowerCase());
      if (!hits.length) continue;
      if (hits.length > 1) return { clicked: false, label: want, seen: seen(), reason: 'several' };
      const b = hits[0];
      const dialogs = [];
      const saved = { alert: window.alert, confirm: window.confirm };
      window.alert = m => { dialogs.push(String(m)); };
      // A plain "do you want to proceed?" is accepted; anything about submitting is declined.
      window.confirm = m => { dialogs.push(String(m)); return !/submit/i.test(String(m)); };
      try {
        if (typeof b.scrollIntoView === 'function') b.scrollIntoView({ block: 'center' });
        b.click();
      } finally { window.alert = saved.alert; window.confirm = saved.confirm; }
      return { clicked: true, label: want, seen: seen(), dialogs };
    }
    if (Date.now() - t0 >= waitMs) return { clicked: false, label: '', seen: seen(), reason: 'none', busy: busy() };
    await pause(300);
  }
}

// ───────────────────────── state ─────────────────────────

const AP = {
  stages: apStagesInit(), armed: false, running: false, stopRequested: false, cin: '', waitingFor: '', tabId: null,
  windowId: null, startedAt: null, endedAt: null, updatedAt: 0, now: '', you: '', summary: '', current: null,
  askResolve: null, ticker: null, watchOff: null, debounce: null, pendingTab: null, preferTab: null, deps: null,
  files: { a: null, g: [] }, remembered: null, rememberedCin: '',
  dashNote: '',        // "Using (a) from dashboard: …" shown in the Autopilot card
  // gen: bumped by every Run and Reset — a loop started by an older run sees the change and stops (it never
  // acts on a newer run's state). runningGen: the run whose loop holds `running`.
  gen: 0, runningGen: null,
  answersByForm: {},   // linked-form answers collected in this run (passed to lfRun even if the backend is offline)
  p1From: null,        // page 1 resumes from this phase (after the Q12(c) hand step)
  manualPoll: null,    // stops the page watcher (Q12(c) Save, or a wizard step change while waiting)
  fwd: {},             // forward clicks per page key in this run (loop guard)
  left: [],            // page keys this run moved away from (coming back to one = MCA went back)
  second: {},          // linked form id → its second page was already filled in this run
  cert: null,          // certificate details for AOC-4 page 2 (after the check stage)
  waitKey: '',         // the page the run is waiting on (the watcher resumes when it changes)
  createdTab: null,    // the MCA login tab this side panel opened (never a second one)
  waitPage: '',        // the page the run waits on for the user (pages up to it are never moved on from by itself)
  knownTabs: [],       // MCA tab ids that existed when the run last used its tab (a new one may be a linked form)
  linkedWait: null,    // {id, key}: a linked form left 'waiting' on this page — rerun only once the page changes
};
const apRunFresh = () => ({ fwd: {}, left: [], second: {}, cert: null, waitKey: '', certFlipped: false, waitPage: '', knownTabs: [], linkedWait: null });

function apEl(id) { return typeof document !== 'undefined' ? document.getElementById(id) : null; }
function apMake(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

// ───────────────────────── attachments remembered per CIN (IndexedDB germin8/attachments) ─────────────────────────

function apIdb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no IndexedDB'));
    const req = indexedDB.open('germin8', 1);
    req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains('attachments')) db.createObjectStore('attachments'); };
    req.onsuccess = () => {
      const db = req.result;
      if (db.objectStoreNames.contains('attachments')) return resolve(db);
      db.close(); reject(new Error('attachments store missing'));
    };
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
}

async function apAttachGet(cin) {
  try {
    const db = await apIdb();
    return await new Promise(res => {
      const r = db.transaction('attachments', 'readonly').objectStore('attachments').get(String(cin || '').toUpperCase());
      r.onsuccess = () => res(r.result || null); r.onerror = () => res(null);
    });
  } catch (_) { return null; }
}

async function apAttachPut(cin, rec) {
  try {
    const db = await apIdb();
    await new Promise(res => {
      const tx = db.transaction('attachments', 'readwrite');
      tx.objectStore('attachments').put(rec, String(cin || '').toUpperCase());
      tx.oncomplete = () => res(true); tx.onerror = () => res(false); tx.onabort = () => res(false);
    });
    return true;
  } catch (_) { return false; }
}

const apFileRec = f => (f ? { name: f.name, type: f.type || 'application/pdf', size: f.size || 0, blob: f } : null);
function apRecFile(rec) {
  if (!rec || !rec.blob) return null;
  try { return typeof File === 'function' ? new File([rec.blob], rec.name, { type: rec.type || 'application/pdf' }) : Object.assign(rec.blob, { name: rec.name }); }
  catch (_) { return null; }
}
const apMb = n => `${((n || 0) / 1048576).toFixed(1)} MB`;

async function apLoadRemembered(cin) {
  const key = String(cin || '').toUpperCase();
  if (AP.rememberedCin === key) return AP.remembered;
  AP.rememberedCin = key;
  AP.files = { a: null, g: [] };
  AP.remembered = key ? await apAttachGet(key) : null;
  apRenderFiles();
  return AP.remembered;
}

async function apRemember(cin) {
  const key = String(cin || '').toUpperCase();
  if (!key) return;
  const prev = AP.remembered || { a: null, g: [] };
  const rec = { a: AP.files.a ? apFileRec(AP.files.a) : prev.a || null, g: AP.files.g.length ? AP.files.g.map(apFileRec) : prev.g || [] };
  AP.remembered = rec; AP.rememberedCin = key;
  await apAttachPut(key, rec);
}

// Files for page 2: picked now, else remembered for this company. allowNoFileA = "(a) already attached".
async function apGetFilesDefault(cin) {
  await apLoadRemembered(cin);
  const r = AP.remembered || {};
  const a = AP.files.a || apRecFile(r.a);
  const g = AP.files.g.length ? AP.files.g : (r.g || []).map(apRecFile).filter(Boolean);
  const cb = apEl('apAttached');
  return { a: a || null, g, allowNoFileA: !!(cb && cb.checked) };
}

function apRenderFiles() {
  if (typeof document === 'undefined') return;
  const r = AP.remembered || {};
  const show = (infoId, inputId, files, recs) => {
    const info = apEl(infoId);
    if (!info) return;
    info.innerHTML = '';
    const list = files && files.length ? files.map(f => ({ name: f.name, size: f.size })) : (recs || []).filter(Boolean);
    if (!list.length) return;
    info.appendChild(document.createTextNode(`${files && files.length ? 'Chosen' : 'Saved for this company'}: ${list.map(f => `${f.name} (${apMb(f.size)})`).join(', ')} · `));
    const ch = apMake('button', 'ap-link', 'change');
    ch.type = 'button';
    ch.addEventListener('click', () => { const i = apEl(inputId); if (i) i.click(); });
    info.appendChild(ch);
  };
  show('apFileAInfo', 'apFileA', AP.files.a ? [AP.files.a] : [], r.a ? [r.a] : []);
  show('apFileGInfo', 'apFileG', AP.files.g, r.g || []);
}

// ───────────────────────── attachments uploaded in the dashboard ─────────────────────────
// AOC-4 Page 2 in the dashboard stores (a)/(g) PDFs per company (GET /api/attachments?cin=…). They fill the slots the
// side panel leaves empty: a file picked here (or remembered for this company) always wins, and "(a) is already
// attached on MCA" still skips (a). Backend offline → nothing changes (the panel asks for the file as before).

function apRenderDash() {
  const info = apEl('apDashInfo');
  if (!info) return;
  info.textContent = AP.dashNote || '';
  info.hidden = !AP.dashNote;
}

function apSetDashNote(text) {
  AP.dashNote = text || '';
  apRenderDash();
}

// The card's note for the company before a run: which dashboard files page 2 will use (only for empty slots).
async function apDashPreview(d, cin) {
  let dash = null;
  try { dash = await d.dashboardList(cin); } catch (_) { dash = null; }
  if (String(AP.cin || '').toUpperCase() !== String(cin || '').toUpperCase() && AP.cin) return dash;
  let f = {};
  try { f = (await d.getFiles()) || {}; } catch (_) { f = {}; }
  const parts = [];
  if (dash && dash.a && !f.a && !f.allowNoFileA) parts.push(`Using (a) from dashboard: ${dash.a.fileName} (${apMb(dash.a.size)})`);
  if (dash && dash.g && dash.g.length && !(f.g && f.g.length)) parts.push(`Using (g) from dashboard: ${dash.g.map(m => `${m.fileName} (${apMb(m.size)})`).join(', ')}`);
  apSetDashNote(parts.join(' · '));
  return dash;
}

// ───────────────────────── dependencies (globals by default; tests inject stubs) ─────────────────────────

function apDefaultDeps() {
  const has = name => { try { return typeof globalThis[name] === 'function'; } catch (_) { return false; } };
  const g = typeof window !== 'undefined' ? window : globalThis;
  const hasChrome = typeof chrome !== 'undefined' && chrome;
  return {
    now: () => Date.now(),
    client: () => (has('lfClient') ? g.lfClient() : null),
    cin: () => (has('lfCin') ? g.lfCin() : ''),
    forms: () => Object.values(g.LINKED_FORMS || {}),
    getActiveMcaTab: has('getActiveMcaTab') ? () => g.getActiveMcaTab() : async () => null,
    tabsGet: id => (hasChrome && chrome.tabs ? chrome.tabs.get(id) : Promise.resolve(null)),
    queryMcaTabs: async () => {
      if (!hasChrome || !chrome.tabs) return [];
      const q = { url: ['https://www.mca.gov.in/*', 'https://*.mca.gov.in/*'] };
      if (AP.windowId != null) q.windowId = AP.windowId;
      try { return await chrome.tabs.query(q); } catch (_) { return []; }
    },
    // Every MCA tab in every window (also one still loading MCA), for the start of a run.
    queryAllMcaTabs: async () => {
      if (!hasChrome || !chrome.tabs || typeof chrome.tabs.query !== 'function') return [];
      const out = new Map();
      try { for (const t of (await chrome.tabs.query({ url: ['*://*.mca.gov.in/*', '*://mca.gov.in/*'] })) || []) out.set(t.id, t); } catch (_) { }
      try { for (const t of (await chrome.tabs.query({})) || []) if (!out.has(t.id) && apIsMcaAny(t.url || t.pendingUrl)) out.set(t.id, t); } catch (_) { }
      return [...out.values()];
    },
    // The only tab the autopilot ever opens: the MCA login page, and only when no MCA tab exists anywhere.
    createLoginTab: async () => chrome.tabs.create({ url: AP_LOGIN_URL, active: true }),
    // The only two addresses a tab is ever sent to.
    navigateTab: async (tabId, url) => {
      if (url === AP_LOGIN_URL) return chrome.tabs.update(tabId, { url: AP_LOGIN_URL });
      if (url === AP_FORM_URL) return chrome.tabs.update(tabId, { url: AP_FORM_URL });
      throw new Error('the autopilot only opens the MCA login page or the AOC-4 form');
    },
    // The window this side panel belongs to.
    panelWindowId: async () => {
      if (!hasChrome || !chrome.windows || typeof chrome.windows.getCurrent !== 'function') return null;
      try { const w = await chrome.windows.getCurrent(); return w && w.id != null ? w.id : null; } catch (_) { return null; }
    },
    focusTab: async tab => {
      if (!hasChrome || !tab) return;
      try { await chrome.tabs.update(tab.id, { active: true }); } catch (_) { }
      try { if (tab.windowId != null && chrome.windows && chrome.windows.update) await chrome.windows.update(tab.windowId, { focused: true }); } catch (_) { }
    },
    setRunTab: id => { try { if (typeof RUN !== 'undefined' && RUN) RUN.tabId = id; } catch (_) { } },
    exec: (tabId, func, args, ms) => {
      const p = chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func, args: args || [] });
      return (has('withTimeout') ? g.withTimeout(p, ms || 30000, 'timeout') : p).then(r => r && r[0] && r[0].result);
    },
    startRun: async () => {
      // The autopilot needs each section's Save: tick it (the user asked for the whole run).
      const cb = apEl('autoSubmit'); if (cb && !cb.checked) cb.checked = true;
      // doFill directly: the popup's startRun() forgets RUN.tabId, so the fill could land on another MCA tab
      // than the one the autopilot chose (setRunTab).
      return has('doFill') ? g.doFill() : has('startRun') ? g.startRun() : { ok: false, reason: 'fill module missing' };
    },
    // The tab the phase runner filled (RUN.tabId), or null when unknown.
    runTabId: () => { try { return typeof RUN !== 'undefined' && RUN && RUN.tabId != null ? RUN.tabId : null; } catch (_) { return null; } },
    step2Run: opts => (has('step2Run') ? g.step2Run(opts) : Promise.resolve({ ok: false, items: [['err', 'step 2 module missing']], saved: false })),
    lfRun: opts => (has('lfRun') ? g.lfRun(opts) : Promise.resolve({ state: 'error', proceeded: false, note: 'linked-form module missing' })),
    lfStop: () => (has('lfStop') ? g.lfStop() : undefined),
    requestFillStop: () => (typeof g.requestFillStop === 'function' ? g.requestFillStop() : undefined),
    // Closes an open RequiredPanel (preflightQuestions) as a Stop.
    cancelPanels: () => { try { if (g.RequiredPanel && typeof g.RequiredPanel.close === 'function') g.RequiredPanel.close(); } catch (_) { } },
    getPhase: () => { const e = apEl('phaseSelect'); return e ? Number(e.value) || 1 : 1; },
    setPhase: n => { const e = apEl('phaseSelect'); if (e && n) e.value = String(n); },
    every: (ms, fn) => { const t = setInterval(fn, ms); return () => clearInterval(t); },
    preflightQuestions: has('preflightQuestions') ? () => g.preflightQuestions() : null,
    step2Prefill: () => (has('step2Prefill') ? g.step2Prefill() : undefined),
    lfFetchAnswers: (cin, form) => (has('lfFetchAnswers') ? g.lfFetchAnswers(cin, form) : Promise.resolve({})),
    // Placeholder answers for the linked forms (js/linked/dummy-fill.js); null when the module is not loaded.
    linkedDummy: () => (g.LinkedDummy || null),
    lfSaveAnswers: (cin, byForm) => (has('lfSaveAnswers') ? g.lfSaveAnswers(cin, byForm) : Promise.resolve(Object.keys(byForm || {}))),
    collectMissing: (missing, raw, form) => (has('lfCollectMissing') ? g.lfCollectMissing(missing, raw, form) : { answers: {}, byForm: {}, errors: ['answers module missing'] }),
    readStep2: () => {
      const v = id => { const e = apEl(id); return e ? String(e.value || '').trim() : ''; };
      return { resNo: v('s2ResNo'), resDate: v('s2ResDate'), desig: v('s2Desig') || 'Director', din: v('s2Din').toUpperCase() };
    },
    writeStep2: vals => {
      const set = (id, x) => { const e = apEl(id); if (e && x != null && String(x).trim()) e.value = String(x); };
      set('s2ResNo', vals.resNo); set('s2ResDate', vals.resDate); set('s2Din', vals.din);
    },
    getFiles: () => apGetFilesDefault(AP.cin),
    // Dashboard attachments (step2-attach.js): the list (no bytes) and the empty slots filled with downloaded files.
    dashboardList: cin => (has('step2DashList') ? g.step2DashList(cin) : Promise.resolve(null)),
    dashboardFiles: (cin, files, opts) => (has('step2UseDashboard') ? g.step2UseDashboard(cin, files, opts)
      : Promise.resolve({ files, used: [], failed: [], offline: true })),
    setFileA: async file => { AP.files.a = file; await apRemember(AP.cin); apRenderFiles(); },
    setAlreadyAttached: on => { const cb = apEl('apAttached'); if (cb) cb.checked = !!on; },
    ask: (groups, ctx) => apAskUi(groups, ctx),
    pageWhere: pageApWhere,
    sleep: ms => new Promise(r => setTimeout(r, ms)),
    // Mirrors the phase runner's live timeline into the page-1 stage while it runs; returns the unhook.
    hookTimeline: cb => apHookTimeline(cb),
    lfSteps: () => { try { return typeof LF !== 'undefined' && LF ? LF.steps : null; } catch (_) { return null; } },
    mark: (cin, part, state, note) => { try { if (g.FilingChecklist) return g.FilingChecklist.mark(cin, part, state, note); } catch (_) { } },
    log: entry => { try { if (typeof Storage !== 'undefined' && Storage && typeof Storage.saveLogs === 'function') return Storage.saveLogs(entry); } catch (_) { } },
    storageGet: async key => { try { const o = await chrome.storage.local.get(key); return (o && o[key]) || null; } catch (_) { return null; } },
    storageSet: async (key, val) => { try { await chrome.storage.local.set({ [key]: val }); } catch (_) { } },
    storageRemove: async key => { try { await chrome.storage.local.remove(key); } catch (_) { } },
    watch: handler => apWatchTabs(handler),
    render: () => apRender(),
  };
}

function apDeps(over) { return Object.assign(apDefaultDeps(), over || {}); }

// Wraps window.Timeline's setActive / setDone / setError / note non-destructively: the originals still run first,
// then cb(method, args, Timeline). The returned function restores them (only where the wrapper is still in place).
function apHookTimeline(cb) {
  const g = typeof window !== 'undefined' ? window : globalThis;
  const T = g && g.Timeline;
  if (!T || typeof cb !== 'function') return () => {};
  const orig = {}, wrapped = {};
  for (const m of ['setActive', 'setDone', 'setError', 'note']) {
    if (typeof T[m] !== 'function') continue;
    orig[m] = T[m];
    wrapped[m] = function () {
      const r = orig[m].apply(this, arguments);
      try { cb(m, [...arguments], T); } catch (_) { }
      return r;
    };
    T[m] = wrapped[m];
  }
  return () => { for (const m of Object.keys(wrapped)) if (T[m] === wrapped[m]) T[m] = orig[m]; };
}

// ───────────────────────── stage bookkeeping ─────────────────────────

function apPersistState() {
  const stages = {};
  for (const s of AP.stages) stages[s.id] = { state: s.state, detail: s.detail, ms: apStageMs(s, Date.now()) };
  return { armed: AP.armed, cin: AP.cin, stages, waitingFor: AP.waitingFor, tabId: AP.tabId, windowId: AP.windowId,
    updatedAt: AP.updatedAt, startedAt: AP.startedAt, you: AP.you, summary: AP.summary, p1From: AP.p1From };
}

function apSave(d) {
  AP.updatedAt = d.now();
  try { const p = d.storageSet(AP_KEY, apPersistState()); if (p && p.catch) p.catch(() => {}); } catch (_) { }
  try { d.render(); } catch (_) { }
}

function apStage(d, id, state, detail) {
  const before = (AP.stages.find(s => s.id === id) || {}).state;
  AP.stages = apStageUpdate(AP.stages, id, state, detail, d.now());
  const after = AP.stages.find(s => s.id === id) || {};
  if (before !== after.state || state === after.state) {
    try { const p = d.log({ action: 'autopilot', stage: id, state: after.state, detail: after.detail, cin: AP.cin }); if (p && p.catch) p.catch(() => {}); } catch (_) { }
  }
  apSave(d);
}

function apSetYou(d, text, waitingFor) {
  AP.you = text || '';
  if (waitingFor !== undefined) AP.waitingFor = waitingFor || '';
  apSave(d);
}

function apMark(d, part, state, note) {
  try { const p = d.mark(AP.cin, part, state, note); if (p && p.catch) p.catch(() => {}); } catch (_) { }
}

function apDisarm(d) {
  AP.armed = false;
  apStopManualPoll();
  if (AP.watchOff) { try { AP.watchOff(); } catch (_) { } AP.watchOff = null; }
  if (AP.debounce) { clearTimeout(AP.debounce); AP.debounce = null; }
  AP.endedAt = d.now();
  AP.summary = apSummaryLine(AP.stages, AP.startedAt != null ? AP.endedAt - AP.startedAt : null);
  apSave(d);
}

function apArm(d) {
  AP.armed = true;
  if (!AP.watchOff) { try { AP.watchOff = d.watch(apOnTabEvent) || null; } catch (_) { AP.watchOff = null; } }
  apSave(d);
}

// Stop pressed, or (with gen) a Run / Reset started after this loop: either way nothing more is done.
const apHalted = gen => AP.stopRequested || (gen != null && AP.gen !== gen);
const apStateOf = id => (AP.stages.find(s => s.id === id) || {}).state;

// Q12(c) hand step: watch the page until its armed Save has been clicked, then carry on with page 1.
function apStopManualPoll() {
  const stop = AP.manualPoll;
  AP.manualPoll = null;
  if (stop) { try { stop(); } catch (_) { } }
}
// One page watcher at a time (every 3 s while armed and idle): `waiting` says whether it is still wanted,
// `ready` (async) whether the page moved on — then the run continues by itself.
function apStartPoll(d, waiting, ready) {
  apStopManualPoll();
  const gen = AP.gen;
  let busy = false, cancel = null;
  const stop = () => { try { if (cancel) cancel(); } catch (_) { } if (AP.manualPoll === stop) AP.manualPoll = null; };
  const gone = () => AP.gen !== gen || !AP.armed || apHalted() || !waiting();
  try {
    cancel = d.every(3000, async () => {
      if (busy) return;
      if (gone()) { stop(); return; }
      if (AP.running || AP.tabId == null) return;
      busy = true;
      try {
        let ok = false;
        try { ok = await ready(); } catch (_) { ok = false; }
        if (ok && !gone() && !AP.running) { stop(); await apContinue(d); }
      } finally { busy = false; }
    });
  } catch (_) { cancel = null; }
  AP.manualPoll = stop;
}

function apStartManualPoll(d) {
  apStartPoll(d, () => AP.waitingFor === 'manual', async () => {
    const st = await d.exec(AP.tabId, pageApManualState, [], 10000);
    return !!(st && st.completed);
  });
}

// AEM wizard steps (Next / Previous / a redirect to page 1) change without any tab event: while the run waits
// for the user on an MCA page, watch that page and continue as soon as it shows something else.
function apStartStepPoll(d) {
  apStartPoll(d, () => AP_STEP_WAIT.includes(AP.waitingFor), async () => {
    const w = await apWhereNow(d, AP.tabId);
    return !!(w && w.url && AP.waitKey && apPageKey(w.url, w.step) !== AP.waitKey);
  });
}

// The run waits on this MCA page for the user (or MCA): say what to do and watch the page.
function apWaitOnPage(d, text, waitingFor, where) {
  AP.waitKey = where && where.url ? apPageKey(where.url, where.step) : '';
  apSetYou(d, text, waitingFor);
  if (AP_STEP_WAIT.includes(waitingFor) && AP.waitKey) apStartStepPoll(d);
  return 'wait';
}

// {url, step} of the MCA tab now (page location first, tab URL as fallback), or null.
async function apWhereNow(d, tabId) {
  let t = null, w = null;
  try { t = await d.tabsGet(tabId); } catch (_) { t = null; }
  try { w = await d.exec(tabId, d.pageWhere, [], 10000); } catch (_) { w = null; }
  const url = (w && w.url) || (t && t.url) || '';
  return url ? { url, step: (w && w.step) || '', status: t ? t.status : undefined } : null;
}

// Clicks MCA's Proceed / Next (pageApForward) on the page `from` and waits (poll 400 ms, max 60 s) until the tab
// URL changes and has loaded, or the AOC-4 wizard step changes. Closes nothing, never navigates.
// Returns the pageApForward result plus {moved, url?, step?, from: key}.
async function apForwardAndWait(d, tabId, from, gen, prefer = ['Proceed', 'Next'], opts = {}) {
  const start = from && from.url ? from : await apWhereNow(d, tabId);
  const key = apPageKey(start && start.url, start && start.step);
  let base = null;
  try { base = await d.tabsGet(tabId); } catch (_) { base = null; }
  const baseUrl = (base && base.url) || (start && start.url) || '';
  if ((AP.fwd[key] || 0) >= AP_FWD_MAX) return { clicked: false, moved: false, reason: 'loop', seen: [], from: key };
  // Wait for the button here in the side panel (not inside the page), so a Stop pressed meanwhile is seen before
  // anything is clicked: each probe looks once (waitMs 0) and the halt check runs right before every probe.
  let r = null;
  // A leftover "saved / uploaded successfully" popup must not sit over the page: close it first.
  try { await d.exec(tabId, pageApCloseInfoPopups, [], 10000); } catch (_) { }
  let idle = 0;
  for (let probe = 1; ; probe++) {
    if (apHalted(gen)) return { clicked: false, moved: false, reason: 'stopped', seen: [], from: key };
    try { r = await d.exec(tabId, pageApForward, [prefer, 0, { back: !!opts.back }], 15000); }
    catch (e) { r = { clicked: false, seen: [], reason: e.message === 'timeout' ? 'the MCA page did not answer in time' : e.message }; }
    if (!r) r = { clicked: false, seen: [], reason: 'no answer from the MCA page' };
    if (r.clicked || r.reason !== 'none') break;
    // MCA still loading → keep looking; idle with no button → give up after a few probes.
    idle = r.busy ? 0 : idle + 1;
    if (idle >= AP_FWD_IDLE_PROBES || probe >= AP_FWD_MAX_PROBES) break;
    await d.sleep(400);
  }
  const out = { ...r, from: key, moved: false };
  if (!r.clicked) return out;
  AP.fwd[key] = (AP.fwd[key] || 0) + 1;
  for (let i = 0; i < AP_FWD_POLLS; i++) {
    await d.sleep(400);
    if (apHalted(gen)) return { ...out, reason: 'stopped' };
    let t = null;
    try { t = await d.tabsGet(tabId); } catch (_) { t = null; }
    if (!t) return { ...out, reason: 'the MCA tab was closed' };
    if (t.status && t.status !== 'complete') continue;
    let moved = !!(t.url && baseUrl && t.url !== baseUrl);
    let w = null;
    try { w = await d.exec(tabId, d.pageWhere, [], 10000); } catch (_) { w = null; }
    if (apHalted(gen)) return { ...out, reason: 'stopped' };
    if (!moved) {
      let e = null;
      try { e = await d.exec(tabId, pageApErrorDialog, [], 8000); } catch (_) { e = null; }
      if (e && e.errors && e.errors.length) return { ...out, reason: 'mca-error', errors: e.errors };
    }
    if (!moved && w && w.step && start && w.step !== start.step) moved = true;
    // A reload into AOC-4 shows the URL before AEM has drawn the wizard: wait for its step text.
    if (moved && /form-aoc4/i.test((w && w.url) || t.url || '') && !(w && w.step)) continue;
    if (moved) {
      if (!AP.left.includes(key)) AP.left.push(key);
      return { ...out, moved: true, url: (w && w.url) || t.url, step: (w && w.step) || '' };
    }
  }
  return { ...out, reason: 'did not move' };
}

// The MCA session ended (a login page, or the module said so): the run waits for the user to log in again.
async function apSessionEnded(d, why) {
  if (/session expired|logged out|log ?in again|sign in again/i.test(String(why || ''))) return true;
  let t = null;
  try { t = await d.getActiveMcaTab(); } catch (_) { t = null; }
  return !!(t && apIsLogin(t.url));
}

// ───────────────────────── asking (one box for everything) ─────────────────────────

// Validates and stores the answers; re-asks with the errors until they are valid or the user stops.
async function apAskAll(d, groups, opts = {}) {
  let errors = [];
  let ask = groups;
  for (let round = 0; round < 8; round++) {
    const ans = await d.ask(ask, { fileNeeded: !!opts.fileNeeded, errors, title: opts.title });
    if (!ans || ans.action !== 'save' || apHalted(opts.gen)) return { ok: false, reason: 'stopped' };
    errors = [];
    const byForm = {}, answersByGroup = {};
    for (const g of ask) {
      const got = d.collectMissing(g.missing, (ans.raw || {})[g.id] || {}, g.answersForm) || { answers: {}, byForm: {}, errors: [] };
      for (const e of got.errors || []) errors.push(`${g.label}: ${e}`);
      for (const [f, list] of Object.entries(got.byForm || {})) (byForm[f] = byForm[f] || []).push(...list);
      answersByGroup[g.id] = got.answers || {};
    }
    if (opts.fileNeeded && !ans.fileA && !ans.alreadyAttached) errors.push('(a) PDF: choose the file, or tick “(a) is already attached on MCA”');
    if (ans.fileA && !/\.pdf$/i.test(ans.fileA.name || '')) errors.push('(a) must be a PDF');
    if (errors.length) { ask = groups.map(g => ({ ...g, errors: errors.filter(e => e.startsWith(g.label + ':')) })); continue; }
    let notSaved = [];
    if (Object.keys(byForm).length) {
      try { notSaved = (await d.lfSaveAnswers(AP.cin, byForm)) || []; } catch (_) { notSaved = Object.keys(byForm); }
    }
    return { ok: true, answersByGroup, byForm, notSaved, fileA: ans.fileA || null, alreadyAttached: !!ans.alreadyAttached,
      count: Object.values(answersByGroup).reduce((n, a) => n + Object.keys(a).length, 0) };
  }
  return { ok: false, reason: 'answers still invalid' };
}

function apAskUi(groups, ctx = {}) {
  const box = apEl('apAsk'), body = apEl('apAskBody'), btn = apEl('apAskSave');
  if (!box || !body || !btn) return Promise.resolve({ action: 'stop' });
  const typed = {};
  body.querySelectorAll('[data-key]').forEach(i => { typed[`${i.dataset.group}|${i.dataset.key}`] = i.value; });
  body.innerHTML = '';
  const count = groups.reduce((n, g) => n + g.missing.length, 0) + (ctx.fileNeeded ? 1 : 0);
  body.appendChild(apMake('div', 'ap-ask-title', ctx.title || `Needed once before the run (${count}) — saved to the company master`));
  if (ctx.errors && ctx.errors.length) body.appendChild(apMake('div', 'ap-ask-err', ctx.errors.slice(0, 6).join(' · ')));
  for (const g of groups) {
    if (!g.missing.length) continue;
    body.appendChild(apMake('div', 'ap-ask-group', g.label));
    for (const m of g.missing) {
      const f = apMake('div', 'field');
      const id = `ap_m_${g.id}_${m.key}`;
      const lab = apMake('label', null, (m.label || m.key) + (m.optional ? ' (optional)' : ''));
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
      inp.id = id; inp.dataset.group = g.id; inp.dataset.key = m.key;
      const pre = typed[`${g.id}|${m.key}`] != null ? typed[`${g.id}|${m.key}`] : m.default;
      if (pre != null) inp.value = String(pre);
      f.appendChild(inp);
      if (m.hint) f.appendChild(apMake('small', 'hint', m.hint));
      for (const e of g.errors || []) if (e.includes(m.label || m.key)) f.appendChild(apMake('small', 'ap-err', e.slice(g.label.length + 2)));
      body.appendChild(f);
    }
  }
  if (ctx.fileNeeded) {
    body.appendChild(apMake('div', 'ap-ask-group', 'AOC-4 page 2 attachment'));
    const f = apMake('div', 'field');
    const lab = apMake('label', null, '(a) Financial statements + auditor’s report + Board’s report (one PDF)');
    lab.htmlFor = 'apAskFileA';
    const inp = document.createElement('input'); inp.type = 'file'; inp.id = 'apAskFileA'; inp.accept = 'application/pdf,.pdf';
    const opt = apMake('label', 'ap-check');
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.id = 'apAskAttached';
    opt.appendChild(cb); opt.appendChild(document.createTextNode(' (a) is already attached on MCA'));
    f.appendChild(lab); f.appendChild(inp); f.appendChild(opt);
    body.appendChild(f);
  }
  box.hidden = false; box.open = true;
  try { box.scrollIntoView({ block: 'nearest' }); } catch (_) { }
  return new Promise(resolve => {
    AP.askResolve = v => { AP.askResolve = null; btn.onclick = null; box.hidden = true; resolve(v); };
    btn.onclick = () => {
      const raw = {};
      body.querySelectorAll('[data-key]').forEach(i => { (raw[i.dataset.group] = raw[i.dataset.group] || {})[i.dataset.key] = i.value; });
      const fa = apEl('apAskFileA'), at = apEl('apAskAttached');
      AP.askResolve({ action: 'save', raw, fileA: (fa && fa.files && fa.files[0]) || null, alreadyAttached: !!(at && at.checked) });
    };
  });
}

// ───────────────────────── check stage (preflight) ─────────────────────────

// Certificate details: firm-wide (chrome.storage 'certifier.v1') with the company's own answers (formType 'aoc4')
// over them. A company that has them while the firm-wide copy does not fills the firm-wide copy.
async function apLoadCert(d, cin) {
  let firm = null, company = {};
  try { firm = await d.storageGet(AP_CERT_KEY); } catch (_) { firm = null; }
  try { company = apCertPick(await d.lfFetchAnswers(cin, { id: 'aoc4', label: 'AOC-4', answersForm: 'aoc4' })); } catch (_) { company = {}; }
  const merged = { ...apCertPick(firm), ...company };
  if (apCertMissing(apCertPick(firm)).length && !apCertMissing(company).length) {
    try { await d.storageSet(AP_CERT_KEY, company); } catch (_) { }
  }
  return merged;
}

async function apPreflight(d, gen) {
  const stays = id => apStateOf(id) !== 'skipped';
  const cin = AP.cin, client = d.client();
  let asked = 0;
  const notes = [];
  // 1. AOC-4 page 1: facts the documents do not contain (its own RequiredPanel).
  if (stays('aoc4p1') && typeof d.preflightQuestions === 'function') {
    apStage(d, 'check', 'active', 'AOC-4 page 1: checking the facts MCA always asks for…');
    let p = null;
    try { p = await d.preflightQuestions(); } catch (e) { p = { ok: false, reason: e.message }; }
    if (apHalted(gen)) return { ok: false, reason: 'stopped' };
    if (!p || !p.ok) return { ok: false, reason: (p && p.reason) || 'stopped at the AOC-4 questions' };
    asked += p.asked || 0;
  }
  // 2. Page 2: declaration, certificate by practicing professional, the (a) PDF.
  let step2 = null, needFileA = false, cert = null;
  if (stays('aoc4p2')) {
    apStage(d, 'check', 'active', 'AOC-4 page 2: declaration, certificate and attachment…');
    try { await d.step2Prefill(); } catch (_) { }
    step2 = d.readStep2() || {};
    const f = (await d.getFiles()) || {};
    needFileA = !f.a && !f.allowNoFileA;
    // No (a) in the side panel: one uploaded in the dashboard counts (page 2 downloads it).
    if (needFileA) {
      let dash = null;
      try { dash = await d.dashboardList(cin); } catch (_) { dash = null; }
      if (dash && dash.a) {
        needFileA = false;
        notes.push(`(a) from dashboard: ${dash.a.fileName} (${apMb(dash.a.size)})`);
        apSetDashNote(`Using (a) from dashboard: ${dash.a.fileName} (${apMb(dash.a.size)})`);
      }
    }
    cert = await apLoadCert(d, cin);
    if (apHalted(gen)) return { ok: false, reason: 'stopped' };
  }
  // 3. Linked forms still to come: load saved answers, build, collect what is missing.
  const forms = d.forms().filter(f => f && AP_LINKED.includes(f.id) && stays(f.id));
  const answersByForm = {};
  if (forms.length) apStage(d, 'check', 'active', `Linked forms: loading saved answers for ${forms.map(f => f.label || f.id).join(', ')}…`);
  for (const f of forms) {
    try { answersByForm[f.id] = (await d.lfFetchAnswers(cin, f)) || {}; }
    catch (_) { answersByForm[f.id] = {}; if (!notes.includes('company master offline')) notes.push('company master offline'); }
    if (apHalted(gen)) return { ok: false, reason: 'stopped' };
  }
  const autoTried = {};
  let rejected = [];
  for (let round = 0; round < 6; round++) {
    const pre = apCollectPreflight({ client, answersByForm, forms, step2, needFileA, cert });
    if (!pre.groups.length && !pre.needFileA) break;
    // Linked forms of a company whose master allows placeholders (LINKED_DUMMY_OK = Yes): answered here and saved
    // to the company master, no question. Once per field; AOC-4's own questions are never answered this way.
    const auto = await apAutoAnswerLinked(d, pre.groups, answersByForm, autoTried);
    for (const r of auto.rejected || []) if (!rejected.includes(r)) rejected.push(r);
    if (auto.count) {
      asked += auto.count;
      notes.push(`${auto.count} placeholder answer(s) for ${auto.forms.join(', ')} (saved to the company master — replace before Submit)`);
      if (auto.notSaved.length) notes.push(`not saved to the company master: ${auto.notSaved.join(', ')}`);
      continue;
    }
    apStage(d, 'check', 'waiting', `${pre.count} answer(s) needed — see the box below`);
    apSetYou(d, 'Answer the questions in the box below once — then everything runs by itself.', 'answers');
    const title = rejected.length ? `Needed once before the run (${pre.count}) — placeholders rejected by the form: ${rejected.slice(0, 6).join(', ')}` : undefined;
    if (rejected.length) notes.push(`placeholders rejected: ${rejected.join(', ')}`);
    rejected = [];
    const got = await apAskAll(d, pre.groups, { fileNeeded: pre.needFileA, gen, title });
    if (!got.ok || apHalted(gen)) return { ok: false, reason: 'stopped at the questions' };
    apSetYou(d, '', '');
    apStage(d, 'check', 'active', 'answers saved — checking again…');
    asked += got.count;
    const shared = got.answersByGroup.aoc4 || {};
    for (const f of forms) answersByForm[f.id] = { ...answersByForm[f.id], ...shared, ...(got.answersByGroup[f.id] || {}) };
    if (step2) {
      const next = { ...step2 };
      for (const [key, name] of AP_DECL) if (shared[key] != null && String(shared[key]).trim()) next[name] = shared[key];
      step2 = next;
      try { d.writeStep2(step2); } catch (_) { }
    }
    if (got.fileA) { try { await d.setFileA(got.fileA); } catch (_) { } needFileA = false; }
    if (got.alreadyAttached) { try { d.setAlreadyAttached(true); } catch (_) { } needFileA = false; }
    if (cert && got.answersByGroup.cert && Object.keys(got.answersByGroup.cert).length) {
      // The CA's own details: stored with the company (lfSaveAnswers above, formType 'aoc4') and firm-wide.
      cert = { ...cert, ...got.answersByGroup.cert };
      try { await d.storageSet(AP_CERT_KEY, apCertPick(cert)); } catch (_) { }
    }
    if (got.notSaved.length) notes.push(`not saved to the company master: ${got.notSaved.join(', ')}`);
  }
  const still = apCollectPreflight({ client, answersByForm, forms, step2, needFileA, cert });
  if (still.groups.length || still.needFileA) return { ok: false, reason: `${still.count} answer(s) still missing or invalid` };
  AP.cert = cert ? apCertPick(cert) : null;
  // Kept for the linked forms: lfRun gets them directly, so an offline company master never means asking again.
  for (const f of forms) AP.answersByForm[f.id] = { ...(answersByForm[f.id] || {}) };
  return { ok: true, detail: [`${asked ? `${asked} answer(s) saved` : 'nothing missing'}`, `${forms.length} linked form(s) ready`, ...notes].join(' · ') };
}

// Placeholder answers for linked-form groups (id aoc2 / eauditor / eboard) when the company master allows them.
// Mutates answersByForm; tried: {'form|key': true} so a field is auto-answered at most once per check. A placeholder
// the form rejects is tried once more with the field's default / first option; one still rejected is left for the
// normal question (out.rejected says which).
async function apAutoAnswerLinked(d, groups, answersByForm, tried) {
  const LD = d.linkedDummy ? d.linkedDummy() : null;
  const out = { count: 0, forms: [], notSaved: [], rejected: [] };
  if (!LD || typeof LD.dummy !== 'function' || typeof LD.allowed !== 'function') return out;
  const byForm = {};
  const empty = { answers: {}, byForm: {}, errors: [] };
  const name = m => m.label || m.key;
  const failed = (got, m) => (got.errors || []).some(e => String(e).startsWith(`${name(m)}:`));
  const firstOpt = m => {
    const o = (m.options || []).map(x => (x && typeof x === 'object' ? x.value : x)).find(v => v != null && String(v).trim() !== '');
    return o == null ? '' : String(o);
  };
  for (const g of groups || []) {
    if (!AP_LINKED.includes(g.id) || !LD.allowed(answersByForm[g.id])) continue;
    const todo = g.missing.filter(m => !tried[`${g.id}|${m.key}`]);
    if (!todo.length) continue;
    const raw = {};
    for (const m of todo) raw[m.key] = m.default != null && String(m.default).trim() !== '' ? String(m.default) : LD.dummy(m);
    const got = d.collectMissing(todo, raw, g.answersForm) || empty;
    const answers = { ...(got.answers || {}) };
    const lists = Object.entries(got.byForm || {}).map(([f, list]) => [f, [...list]]);
    // Rejected placeholders: once more with the default, else the first option.
    const retry = todo.filter(m => failed(got, m) && answers[m.key] == null);
    const raw2 = {};
    for (const m of retry) {
      const alt = m.default != null && String(m.default).trim() !== '' && String(m.default) !== raw[m.key] ? String(m.default) : firstOpt(m);
      if (alt && alt !== raw[m.key]) raw2[m.key] = alt;
    }
    const again = retry.filter(m => raw2[m.key] != null);
    const got2 = again.length ? (d.collectMissing(again, raw2, g.answersForm) || empty) : empty;
    Object.assign(answers, got2.answers || {});
    for (const [f, list] of Object.entries(got2.byForm || {})) {
      const at = lists.find(x => x[0] === f);
      if (at) at[1].push(...list); else lists.push([f, [...list]]);
    }
    for (const m of todo) {
      if (answers[m.key] != null) tried[`${g.id}|${m.key}`] = true;
      else if (failed(got, m) || failed(got2, m)) out.rejected.push(`${g.label || g.id}: ${name(m)}`);
    }
    if (!Object.keys(answers).length) continue;
    answersByForm[g.id] = { ...(answersByForm[g.id] || {}), ...answers };
    for (const [f, list] of lists) (byForm[f] = byForm[f] || []).push(...list.map(x => ({ ...x, label: `PLACEHOLDER — ${x.label || x.key}` })));
    out.count += Object.keys(answers).length;
    out.forms.push(g.label || g.id);
  }
  if (Object.keys(byForm).length) {
    try { out.notSaved = (await d.lfSaveAnswers(AP.cin, byForm)) || []; } catch (_) { out.notSaved = Object.keys(byForm); }
  }
  return out;
}

// ───────────────────────── stage runners ─────────────────────────

// The MCA session ended while a page ran: wait for the user to log in again (the run stays armed and the
// stage reruns on the next MCA page event).
function apWaitLogin(d, id) {
  apStage(d, id, 'waiting', 'MCA session ended — waiting for you to log in again');
  apSetYou(d, AP_YOU.login, 'login');
  return 'wait';
}

// A forward click (Next / Proceed) after a page was saved did not move MCA on: the stage keeps its Save, the CA is
// told what MCA shows, and the page is watched so the run carries on as soon as MCA moves.
function apForwardFailed(d, id, savedText, fw, prefer, where) {
  const why = apForwardWhy(fw);
  apStage(d, id, 'warn', `${savedText} · ${why}`);
  const name = apPageName(id, d.forms());
  return apWaitOnPage(d, `${name} is saved, but ${why}. Fix it on MCA and click ${prefer.join(' or ')} yourself — the autopilot carries on by itself.`, 'next', where);
}

async function apRunAoc4p1(d, gen, tab, where) {
  // Resuming after the Q12(c) hand step (or a restored run): page 1 carries on from that phase.
  if (AP.p1From) { try { d.setPhase(AP.p1From); } catch (_) { } }
  let from = 1;
  try { from = Number(d.getPhase()) || 1; } catch (_) { from = 1; }
  apStage(d, 'aoc4p1', 'active', from > 1 ? `resuming from Phase ${from} of 7 — filling and saving each section…` : 'filling the 7 sections and saving each…');
  apMark(d, 'phase1', 'active', 'Autopilot running…');
  AP.current = 'aoc4p1';
  // The phase runner's live timeline becomes this stage's detail ("Phase 3 of 7 — Balance sheet: saving…").
  let unhook = () => {};
  try {
    unhook = d.hookTimeline((method, args, T) => {
      if (AP.gen !== gen || apStateOf('aoc4p1') !== 'active') return;
      const stepId = method === 'note' ? (T && typeof T.activeStep === 'function' ? T.activeStep() : null) : args[0];
      const sub = method === 'note' ? args[0] : method === 'setError' ? args[1] && args[1].title : args[1];
      const text = apTimelineDetail(method, stepId, sub);
      if (!text) return;
      AP.stages = apStageUpdate(AP.stages, 'aoc4p1', 'active', text, d.now());
      try { d.render(); } catch (_) { }
    }) || unhook;
  } catch (_) { }
  let r;
  try { r = await d.startRun(); } catch (e) { r = { ok: false, reason: 'exception: ' + e.message }; }
  finally { try { unhook(); } catch (_) { } }
  if (AP.gen === gen) AP.current = null;
  if (apHalted(gen)) return 'end';
  // The fill must have run on this tab: if the phase runner used another MCA tab, Next is never clicked here.
  let ranOn = null;
  try { ranOn = d.runTabId ? d.runTabId() : null; } catch (_) { ranOn = null; }
  if (ranOn != null && ranOn !== tab.id) {
    const why = 'the fill ran on another MCA tab than the one the autopilot uses';
    apStage(d, 'aoc4p1', 'error', why);
    apMark(d, 'phase1', 'error', why);
    apSetYou(d, `Page 1 needs you: ${why}. Keep only this company’s AOC-4 tab open, then press Run everything again.`, 'fix');
    apDisarm(d);
    return 'end';
  }
  // Q12(c) (service provider) is filled by hand; MCA's Save for it is armed and clicks itself. The run stays
  // armed and continues with the next phase on its own once that Save has been clicked.
  if (r && r.reason === 'manual-step') {
    const at = Number(r.stoppedAt) || 2, next = at + 1;
    AP.p1From = next;
    try { d.setPhase(next); } catch (_) { }
    apStage(d, 'aoc4p1', 'waiting', `Phase ${at}: Q12(c) is filled by you on MCA — then Phase ${next} runs by itself`);
    apMark(d, 'phase1', 'active', `Waiting for Q12(c) on MCA (Phase ${at})`);
    apSetYou(d, AP_YOU.manual(next), 'manual');
    apStartManualPoll(d);
    return 'wait';
  }
  if (!r || !r.ok) {
    if (await apSessionEnded(d, r && r.reason)) { if (apHalted(gen)) return 'end'; return apWaitLogin(d, 'aoc4p1'); }
    if (apHalted(gen)) return 'end';
    const why = apFillWhy(r);
    apStage(d, 'aoc4p1', 'error', why);
    apMark(d, 'phase1', 'error', why);
    apSetYou(d, `Page 1 needs you: ${why}. Fix what the message above says, then press Run everything again.`, 'fix');
    apDisarm(d);
    return 'end';
  }
  AP.p1From = null;
  const notes = r.issues && r.issues.length ? ` · ${r.issues.length} note(s)` : '';
  const saved = from > 1 ? `Phases ${from}–7 saved (resumed from Phase ${from})${notes}` : `all sections saved${notes}`;
  apMark(d, 'phase1', 'done', 'Saved by the autopilot');
  // Page 1 ends with MCA's Next (the autopilot clicks it; page 2 then runs at once).
  apStage(d, 'aoc4p1', 'active', `${saved} — clicking Next…`);
  const fw = await apForwardAndWait(d, tab.id, null, gen, ['Next']);
  if (apHalted(gen)) return 'end';
  if (fw.reason === 'mca-error') { apStage(d, 'aoc4p1', 'error', `${saved} · MCA refused Next`); return apMcaErrorStop(d, 'AOC-4 page 1', fw.errors || []); }
  if (!fw.moved) return apForwardFailed(d, 'aoc4p1', saved, fw, ['Next'], where);
  apStage(d, 'aoc4p1', 'done', `${saved} · Next → page 2`);
  return 'continue';
}

async function apRunAoc4p2(d, gen, tab, where) {
  apStage(d, 'aoc4p2', 'active', 'attachments → declaration → certificate → Save…');
  apMark(d, 'step2', 'active', 'Autopilot running…');
  AP.current = 'aoc4p2';
  let r;
  try {
    let files = (await d.getFiles()) || {};
    // Empty slots → the company's dashboard attachments (downloaded now). Panel files always win.
    if ((!files.a && !files.allowNoFileA) || !(files.g && files.g.length)) {
      let u = null;
      try { u = await d.dashboardFiles(AP.cin, { a: files.a || null, g: files.g || [] }, { skipA: !!files.allowNoFileA }); } catch (_) { u = null; }
      if (apHalted(gen)) return 'end';
      if (u && u.files) {
        files = { ...files, a: u.files.a || null, g: u.files.g || [] };
        const note = [...(u.used || []), ...(u.failed || [])].join(' · ');
        if (note) { apSetDashNote(note); apStage(d, 'aoc4p2', 'active', `${note} — attachments → declaration → certificate → Save…`); }
      }
    }
    const values = d.readStep2();
    // shouldStop: step2Run checks it before every upload, every declaration field and the Save click.
    const opts = { auto: true, files: { a: files.a || null, g: files.g || [] }, save: true, allowNoFileA: !!files.allowNoFileA, values,
      shouldStop: () => apHalted(gen) };
    // A run restored after the side panel was reopened has no AP.cert yet: reload it (firm-wide + company), no asking.
    if (!AP.cert || !Object.keys(AP.cert).length) { try { AP.cert = apCertPick(await apLoadCert(d, AP.cin)); } catch (_) { } }
    if (AP.cert && Object.keys(AP.cert).length) opts.certificate = { ...AP.cert };
    r = await d.step2Run(opts);
  } catch (e) { r = { ok: false, items: [['err', e.message]], saved: false }; }
  if (AP.gen === gen) AP.current = null;
  if (apHalted(gen)) return 'end';
  const items = (r && r.items) || [];
  if (!r || !r.ok || !r.saved) {
    const err = items.find(([k]) => k === 'err');
    const why = err ? err[1] : r && r.reason ? r.reason : r && !r.saved ? 'MCA did not confirm the Save' : 'no result';
    if (await apSessionEnded(d, `${(r && r.reason) || ''} ${why}`)) { if (apHalted(gen)) return 'end'; return apWaitLogin(d, 'aoc4p2'); }
    if (apHalted(gen)) return 'end';
    apStage(d, 'aoc4p2', 'error', why);
    apMark(d, 'step2', 'error', why);
    apSetYou(d, `Page 2 needs you: ${why}. Fix it on MCA (or in the boxes above), then press Run everything again.`, 'fix');
    apDisarm(d);
    return 'end';
  }
  const ok = items.filter(([k]) => k === 'ok').length, warn = items.filter(([k]) => k === 'warn').length;
  const state = warn ? 'warn' : 'done';
  const saved = `saved · ${ok} step(s) ok${warn ? ` · ${warn} to check` : ''}`;
  apMark(d, 'step2', state, 'Saved by the autopilot');
  // Page 2 ends with MCA's Proceed (it opens the linked forms); Next only where MCA shows no Proceed.
  apStage(d, 'aoc4p2', 'active', `${saved} — clicking Proceed…`);
  const fw = await apForwardAndWait(d, tab.id, null, gen, ['Proceed', 'Next']);
  if (apHalted(gen)) return 'end';
  if (fw.reason === 'mca-error') { apStage(d, 'aoc4p2', 'error', `${saved} · MCA refused ${fw.label || 'Proceed'}`); return apMcaErrorStop(d, 'AOC-4 page 2', fw.errors || []); }
  if (!fw.moved) return apForwardFailed(d, 'aoc4p2', saved, fw, ['Proceed'], await apWhereNow(d, tab.id) || where);
  apStage(d, 'aoc4p2', state, `${saved} · ${fw.label} clicked`);
  return 'continue';
}

// A page that is already finished in this run (or AOC-4 Review & Submit): never refilled, only moved on from.
// A page this run already left (MCA went back to it) gets one forward click per visit, at most AP_FWD_MAX in all;
// when MCA does not move on from it, the run stops so the CA can read MCA's message.
async function apRunForward(d, gen, tab, where, plan) {
  const forms = d.forms();
  const page = plan.forward;
  const name = apPageName(page, forms);
  const key = apPageKey(where.url, where.step);
  const revisit = AP.left.includes(key);
  const fw = await apForwardAndWait(d, tab.id, where, gen, plan.prefer);
  if (apHalted(gen)) return 'end';
  if (fw.moved) return 'continue';
  const stopBack = () => { apSetYou(d, AP_YOU.wentBack(name), 'fix'); apDisarm(d); return 'end'; };
  if (fw.reason === 'loop') return stopBack();
  if (fw.reason === 'mca-error') {
    const retry = await apCertCategoryRetry(d, gen, tab, fw.errors || []);
    if (retry) return retry;
    return apMcaErrorStop(d, name, fw.errors || []);
  }
  if (page === 'review') {
    // Review & Submit without Proceed: the Submit is the CA's; the linked forms open after it.
    if (!fw.clicked && fw.reason === 'none' && (fw.seen || []).some(l => /submit/i.test(l))) return apWaitOnPage(d, AP_YOU.review, 'submit', where);
    return apWaitOnPage(d, `${name}: ${apForwardWhy(fw)}. Check MCA, then click Proceed (or Submit) yourself — the autopilot continues on the next form.`, 'submit', where);
  }
  if (revisit) return stopBack();
  return apWaitOnPage(d, `${name} is saved, but ${apForwardWhy(fw)}. Click ${plan.prefer.join(' or ')} on MCA yourself — the autopilot carries on by itself.`, 'next', where);
}

// MCA: "Membership number … does not correspond to the member category of Associate/Fellow". The number itself
// is checked with the institute, so with a real number the category is the usual culprit and the documents rarely
// say ACA or FCA. Once per run: switch Associate <-> Fellow (company answers + firm-wide), click Previous back to
// AOC-4 page 2 and run page 2 again (certificate refilled, Save, Next, Proceed). Returns 'continue' / 'end' / null.
async function apCertCategoryRetry(d, gen, tab, errors) {
  const msg = (errors || []).join(' · ');
  if (!/member(ship)? category|associate\s*\/\s*fellow/i.test(msg) || AP.certFlipped) return null;
  if (!AP.cert) { try { AP.cert = apCertPick(await apLoadCert(d, AP.cin)); } catch (_) { AP.cert = null; } }
  if (!AP.cert || !AP.cert.CERT_MEMBERSHIP_NO) return null;
  const cur = /fellow/i.test(AP.cert.CERT_ASSOC_FELLOW || '') ? 'Fellow' : 'Associate';
  const next = cur === 'Fellow' ? 'Associate' : 'Fellow';
  apStage(d, 'aoc4p2', 'warn', `MCA rejected membership no. ${AP.cert.CERT_MEMBERSHIP_NO} as ${cur} — going back to page 2 to try ${next}…`);
  const back = await apForwardAndWait(d, tab.id, null, gen, ['Previous'], { back: true });
  if (apHalted(gen)) return 'end';
  if (!back.moved) return null;   // could not get back to page 2: nothing switched, the CA is told
  AP.certFlipped = true;
  AP.cert = { ...AP.cert, CERT_ASSOC_FELLOW: next };
  try { await d.lfSaveAnswers(AP.cin, { aoc4: [{ key: 'CERT_ASSOC_FELLOW', label: 'Certificate — Associate or Fellow', value: next }] }); } catch (_) { }
  try { await d.storageSet(AP_CERT_KEY, AP.cert); } catch (_) { }
  if (apHalted(gen)) return 'end';
  // Page 2 runs again: reopen its stage and forget the pages left so far (they are new visits now).
  AP.stages = AP.stages.map(x => (x.id === 'aoc4p2' ? { ...x, state: 'pending', detail: `retrying with ${next}` } : x));
  AP.left = []; AP.fwd = {};
  apSave(d);
  return 'continue';
}

// MCA refused to move on and said why (its error popup). Membership-number errors mean the certificate details
// are wrong (MCA checks them with the institute): the firm-wide copy is forgotten so the next run asks again.
function apMcaErrorStop(d, name, errors) {
  const msg = errors.join(' · ');
  let what = 'Fix it on MCA, then press Run everything again.';
  if (/membership number|certificate of practice/i.test(msg)) {
    what = AP.certFlipped ? `MCA rejected membership no. ${(AP.cert && AP.cert.CERT_MEMBERSHIP_NO) || ''} as both Associate and Fellow, so the number itself is not the one ICAI has for this category. Go back to AOC-4 page 2 (Previous), press Run everything, and enter the correct membership number when asked.` : 'MCA checks the membership number with ICAI, so it must be the real one. Go back to AOC-4 page 2 (Previous), press Run everything, and enter your real membership number and Associate / Fellow when asked.';
    try { const p = d.storageSet(AP_CERT_KEY, null); if (p && p.catch) p.catch(() => {}); } catch (_) { }
    AP.cert = null;
  }
  apSetYou(d, `${name}: MCA says “${msg}”. ${what}`, 'fix');
  apDisarm(d);
  return 'end';
}

function apFinish(d) {
  for (const id of AP_LINKED) if (apStateOf(id) === 'pending') apStage(d, id, 'skipped', 'MCA did not open it');
  apStage(d, 'finish', 'waiting', 'your turn: Submit + DSC');
  apSetYou(d, AP_YOU.finish, 'finish');
  apDisarm(d);
  return 'end';
}

async function apRunLinked(d, id, gen, tab, where) {
  const forms = d.forms();
  const form = forms.find(f => f && f.id === id) || { id, label: id };
  const label = form.label || id;
  apStage(d, id, 'active', 'wait for MCA → fill → Save → confirm' + (id === 'eboard' ? '' : ' → Proceed'));
  AP.current = id;
  // lfRun waits for the MCA page to be ready itself (auto mode); it gets this run's answers directly and
  // checks the autopilot's Stop after every await.
  const runOpts = () => {
    const o = { auto: true, shouldStop: () => apHalted(gen) };
    const a = AP.answersByForm[id];
    if (a && Object.keys(a).length) o.answers = { ...a };
    return o;
  };
  const release = () => { if (AP.gen === gen) AP.current = null; };
  let r = null, offline = false;
  let fromKey = where && where.url ? apPageKey(where.url, where.step) : '';
  const counts = [];
  // pass 0: the form's page MCA showed; pass 1 (once): its next page when Proceed opened a second page of the
  // same form (lfRun skips fields that are already right, then Save → Proceed as usual).
  for (let pass = 0; pass < 2; pass++) {
    for (let round = 0; round < 4; round++) {
      try { r = await d.lfRun(runOpts()); } catch (e) { r = { state: 'error', proceeded: false, note: e.message }; }
      if (apHalted(gen)) { release(); return 'end'; }
      if (!r || r.state !== 'needs-answers') break;
      // Answers were given and passed in, yet the form still asks: do not ask the CA the same again.
      if (offline) break;
      const groups = apGroupMissing({ [id]: r.missing || [] }, [form]);
      if (!groups.length) break;
      apStage(d, id, 'waiting', `${groups.reduce((n, g) => n + g.missing.length, 0)} answer(s) needed — see the box below`);
      apSetYou(d, `${label} needs a few answers — fill the box below and press Save & continue.`, 'answers');
      const got = await apAskAll(d, groups, { title: `${label}: answers needed`, gen });
      if (!got.ok || apHalted(gen)) { release(); return 'end'; }
      const shared = got.answersByGroup.aoc4 || {};
      AP.answersByForm[id] = { ...(AP.answersByForm[id] || {}), ...shared, ...(got.answersByGroup[id] || {}) };
      for (const other of AP_LINKED) if (other !== id && Object.keys(shared).length) AP.answersByForm[other] = { ...(AP.answersByForm[other] || {}), ...shared };
      if (got.notSaved.length) offline = true;
      apSetYou(d, '', '');
      apStage(d, id, 'active', got.notSaved.length ? 'answers kept for this run (company master offline) — running again…' : 'answers saved — running again…');
    }
    let c = '';
    try { c = apLinkedCounts(d.lfSteps()); } catch (_) { c = ''; }
    if (c) counts.push(c);
    if (r && r.proceeded && fromKey && !AP.left.includes(fromKey)) AP.left.push(fromKey);
    if (pass > 0 || !r || !['done', 'warn', 'error'].includes(r.state) || r.proceeded || id === 'eboard') break;
    // Proceed did not leave the form: is MCA showing another page of the same form?
    const now = tab ? await apWhereNow(d, tab.id) : null;
    if (apHalted(gen)) { release(); return 'end'; }
    if (!now || apStageForPage(now.url, now.step, forms) !== id || !fromKey || apPageKey(now.url, now.step) === fromKey || AP.second[id]) break;
    AP.second[id] = true;
    if (!AP.left.includes(fromKey)) AP.left.push(fromKey);
    fromKey = apPageKey(now.url, now.step);
    apStage(d, id, 'active', `first page saved${c ? ` (${c})` : ''} — filling the form’s next page${now.step ? ` “${now.step}”` : ''}…`);
  }
  release();
  const st = r ? r.state : 'error';
  const baseNote = (r && r.note) || '';
  const countText = counts.length > 1 ? `pages: ${counts.join(' / ')}` : counts[0] || '';
  const note = countText && !/\bfilled\b/.test(baseNote) ? [baseNote, countText].filter(Boolean).join(' · ')
    : counts.length > 1 ? `${baseNote} · ${countText}` : baseNote;
  if (st === 'stopped') {
    // Stopped from the linked-form panel's own Stop: the autopilot stops too (nothing more on MCA).
    if (!apHalted(gen)) {
      AP.stopRequested = true;
      apStage(d, id, 'warn', 'stopped by you');
      apSetYou(d, AP_YOU.stopped, 'stopped');
      apDisarm(d);
    }
    return 'end';
  }
  if (st === 'done' || st === 'warn') {
    apStage(d, id, st, note || (st === 'done' ? 'saved' : 'saved — check MCA'));
    if (id === 'eboard') {
      if (st === 'done') return apFinish(d);
      apSetYou(d, `${label}: ${note || 'check the MCA page'}. Fix it on MCA and click Save, then Submit and sign yourself.`, 'fix');
      return 'wait';
    }
    if (r.proceeded) { apSetYou(d, '', ''); return 'continue'; }
    const other = await apFindPendingTab(d);
    if (other) { AP.preferTab = other.id; return 'continue'; }
    apSetYou(d, st === 'done'
      ? `${label} is saved. Click Proceed on MCA if it did not move — the autopilot continues on the next form.`
      : `${label}: ${note || 'check the MCA page'}. Fix it on MCA, Save and Proceed yourself — the autopilot continues on the next form.`, 'next');
    return 'wait';
  }
  if (st === 'needs-answers') {
    apStage(d, id, 'error', offline ? 'answers could not be stored in the company master — is the backend running?' : 'the form still needs answers');
    apSetYou(d, offline ? `${label}: start the backend (localhost:4000) and press Run everything again, or fill this form yourself.`
      : `${label}: some answers are still missing — fill this form yourself on MCA, or press Run everything again.`, 'fix');
    return 'wait';
  }
  // Left 'waiting': rerun only once MCA shows another page (not on every tab event on this one).
  const holdHere = () => { AP.linkedWait = { id, key: where && where.url ? apPageKey(where.url, where.step) : '' }; };
  if (st === 'busy') {
    apStage(d, id, 'waiting', 'the linked-form panel is busy');
    apSetYou(d, 'The linked-form panel is already running — wait for it to finish, then click Proceed on MCA (or press Run everything).', 'busy');
    holdHere();
    return 'wait';
  }
  if (st === 'not-linked') {
    apStage(d, id, 'waiting', 'the MCA page changed');
    holdHere();
    return 'wait';
  }
  apStage(d, id, 'error', note || 'failed');
  apSetYou(d, `${label}: ${note || 'failed'}. Fix it on MCA, Save and Proceed yourself — the autopilot continues on the next form.`, 'next');
  return 'wait';
}

// Another MCA tab of this window showing a known linked form that is still to do (MCA may open a new tab).
async function apFindPendingTab(d) {
  let tabs = [];
  try { tabs = (await d.queryMcaTabs()) || []; } catch (_) { return null; }
  const forms = d.forms();
  for (const t of tabs) {
    if (!t || t.id === AP.tabId || (AP.knownTabs || []).includes(t.id)) continue;
    const id = apStageForPage(t.url, '', forms);
    if (id && AP_LINKED.includes(id) && ['pending', 'waiting'].includes(apStateOf(id))) return t;
  }
  return null;
}

// The run's tab first (a tab event from another tab was already vetted by apTabAllowed and set preferTab);
// the active MCA tab only when the run has no tab yet or its tab is gone.
async function apPickTab(d) {
  for (const id of [AP.preferTab, AP.tabId]) {
    if (id == null) continue;
    if (id === AP.preferTab) AP.preferTab = null;
    let t = null;
    try { t = await d.tabsGet(id); } catch (_) { t = null; }
    if (t && apIsMca(t.url)) { try { d.setRunTab(t.id); } catch (_) { } return t; }
  }
  try { return await d.getActiveMcaTab(); } catch (_) { return null; }
}

// The MCA tabs that exist now (while the run uses its own tab): a tab not in this list that later shows a linked
// form still to do is one MCA opened for the run.
async function apRememberTabs(d) {
  try { AP.knownTabs = ((await d.queryMcaTabs()) || []).map(t => t && t.id).filter(x => x != null); } catch (_) { }
}

// Once the run has a tab, events from other tabs are ignored — except a new tab showing a linked form still to do.
async function apTabAllowed(d, tabId) {
  if (tabId == null || AP.tabId == null || tabId === AP.tabId) return true;
  if ((AP.knownTabs || []).includes(tabId)) return false;
  let t = null;
  try { t = await d.tabsGet(tabId); } catch (_) { t = null; }
  if (!t || !apIsMca(t.url)) return false;
  const id = apStageForPage(t.url, '', d.forms());
  return !!(id && AP_LINKED.includes(id) && ['pending', 'waiting'].includes(apStateOf(id)));
}

// The stage a detected page stands for in the stage order (AOC-4 Review & Submit comes after page 2).
const apStageAt = page => (page === 'review' ? 'aoc2' : page);

// Marks what MCA has evidently moved past: page-1/page-2 stages still pending are skipped.
function apCloseEarlier(d, page) {
  const order = AP_STAGE_DEFS.map(([x]) => x);
  const idx = order.indexOf(apStageAt(page));
  for (const s of ['aoc4p1', 'aoc4p2']) {
    if (idx < 0 || order.indexOf(s) >= idx) continue;
    if (apStateOf(s) === 'pending') apStage(d, s, 'skipped', 'already done on MCA');
  }
}

// A stage / forward ended waiting for the user on `page`: remember the furthest such page (apHoldForward).
function apNoteWait(page) {
  if (!AP.armed || !AP_HOLD_WAITS.includes(AP.waitingFor) || apPageIdx(page) < 0) return;
  if (!AP.waitPage || apPageIdx(page) > apPageIdx(AP.waitPage)) AP.waitPage = page;
}

// The MCA tab shows another company: the run stops (Stop is final) and the CA is told.
function apOtherCompanyStop(d, other) {
  apSetYou(d, `This MCA tab shows another company (CIN ${other}), not ${AP.cin}. The autopilot stopped and clicked nothing there. Open this company’s AOC-4 draft, then press Run everything.`, 'fix');
  apDisarm(d);
}

// Looks at the MCA page and runs whatever comes next, until something needs the user.
async function apContinue(d) {
  if (AP.running || !AP.armed || apHalted()) return;
  const gen = AP.gen;
  AP.running = true; AP.runningGen = gen;
  apStartTicker();
  try {
    for (let guard = 0; guard < 24; guard++) {
      if (apHalted(gen) || !AP.armed) return;
      const tab = await apPickTab(d);
      if (apHalted(gen)) return;
      if (!tab) { apSetYou(d, AP_YOU.tab, 'tab'); return; }
      if (apIsLogin(tab.url)) { apSetYou(d, AP_YOU.login, 'login'); return; }
      let where = null;
      try { where = await d.exec(tab.id, d.pageWhere, [], 15000); } catch (_) { where = null; }
      if (apHalted(gen)) return;
      const url = (where && where.url) || tab.url;
      if (apIsLogin(url)) { apSetYou(d, AP_YOU.login, 'login'); return; }
      const here = { url, step: (where && where.step) || '' };
      // A tab of another company (its CIN shows, this company's does not): stop, nothing is clicked there.
      const other = apOtherCompany(where && where.cins, AP.cin);
      if (other) { apOtherCompanyStop(d, other); return; }
      const detected = apStageForPage(url, here.step, d.forms());
      const plan = apPlan(AP.stages, detected, { revisit: AP.left.includes(apPageKey(here.url, here.step)) });
      AP.tabId = tab.id;
      if (tab.windowId != null && AP.windowId == null) AP.windowId = tab.windowId;
      if (plan.wait) {
        if (plan.wait === 'unknown') {
          // Logged in again after the session ended mid-run, but MCA shows no form: the draft is reopened by the
          // user from My Application (a fresh form would start a new filing, so none is opened here).
          if (['login', 'reopen'].includes(AP.waitingFor) && !apIsFormUrl(url, d.forms())) apSetYou(d, AP_YOU.reopen, 'reopen');
          else apSetYou(d, AP_YOU.unknown, 'unknown');
        }
        else if (plan.wait === 'linked-done') {
          const f = d.forms().find(x => x && x.id === plan.form);
          const label = (f && f.label) || plan.form;
          const s = AP.stages.find(x => x.id === plan.form) || {};
          // Only a form that really saved is "done"; a failed one keeps telling the CA what to do.
          if (s.state === 'done') apSetYou(d, `${label} is done. Waiting for MCA to open the next form — click Proceed on MCA if needed.`, 'next');
          else if (s.state === 'error' || s.state === 'warn') {
            apSetYou(d, `${label} was not saved cleanly${s.detail ? ` (${s.detail})` : ''}. Fix it on MCA and click Save, then Proceed yourself — or press Run everything to retry it.`, 'next');
          }
        }
        return;
      }
      if (plan.forward) {
        // The run waits for the user and MCA shows that page or an earlier one (the user went back to correct
        // something, or only switched back to the tab): nothing is clicked; the run carries on once MCA shows a
        // later page.
        if (apHoldForward(detected, AP.waitPage, AP.waitingFor, apStateOf(AP.waitPage))) {
          const prefer = plan.prefer.join(' or ');
          const text = detected === AP.waitPage && AP.you ? AP.you
            : `You went back to ${apPageName(detected, d.forms())}. The autopilot clicks nothing here — make your changes, then click ${prefer} on MCA yourself; it carries on as soon as MCA shows the next page.`;
          apWaitOnPage(d, text, AP.waitingFor, here);
          return;
        }
        // A finished page (or Review & Submit): move on with Proceed / Next, never refill it.
        try { d.setRunTab(tab.id); } catch (_) { }
        apSetYou(d, '', '');
        apCloseEarlier(d, plan.forward);
        await apRememberTabs(d);
        const next = await apRunForward(d, gen, tab, here, plan);
        if (next !== 'continue') { apNoteWait(detected); return; }
        AP.waitPage = '';
        continue;
      }
      // Q12(c) hand step: continue page 1 only once its Save has really been clicked on this page. No answer from
      // the page → keep waiting; the page was reloaded (its armed Save is gone) → the user is told, nothing is filled.
      if (plan.run === 'aoc4p1' && AP.waitingFor === 'manual') {
        let st = null;
        try { st = await d.exec(tab.id, pageApManualState, [], 10000); } catch (_) { st = null; }
        if (apHalted(gen)) return;
        if (!st || !st.completed) {
          apSetYou(d, st && !st.armed ? AP_YOU.manualReloaded(AP.p1From || 3) : AP_YOU.manual(AP.p1From || 3), 'manual');
          return;
        }
        apStopManualPoll();
      }
      // A linked form left 'waiting' (panel busy, page changed) reruns only once MCA shows another page.
      if (AP_LINKED.includes(plan.run) && apStateOf(plan.run) === 'waiting' && AP.linkedWait && AP.linkedWait.id === plan.run
        && AP.linkedWait.key === apPageKey(here.url, here.step)) return;
      AP.linkedWait = null;
      AP.waitPage = '';
      try { d.setRunTab(tab.id); } catch (_) { }
      apSetYou(d, '', '');
      apCloseEarlier(d, plan.run);
      await apRememberTabs(d);
      let next;
      if (plan.run === 'aoc4p1') next = await apRunAoc4p1(d, gen, tab, here);
      else if (plan.run === 'aoc4p2') next = await apRunAoc4p2(d, gen, tab, here);
      else next = await apRunLinked(d, plan.run, gen, tab, here);
      if (next !== 'continue') { apNoteWait(plan.run); return; }
    }
  } finally {
    // An older loop (Reset / a new Run since) never touches the newer run's state.
    if (AP.runningGen === gen) { AP.running = false; AP.runningGen = null; }
    if (AP.gen === gen) { AP.current = null; apSave(d); }
  }
}

// ───────────────────────── getting to the form (start of a run) ─────────────────────────

// Sends a tab to one of the two allowed MCA addresses — never a tab that shows a form (the user's draft).
// A tab still loading (the user may just have clicked to reopen a draft) is waited for first; both `url` and
// `pendingUrl` are checked — during a navigation Chrome keeps the old address in `url`.
async function apNavigate(d, tab, url, gen) {
  if (!apAllowedNav(url)) return { ok: false, reason: 'not an allowed address' };
  let cur = null;
  for (let i = 0; ; i++) {
    try { cur = await d.tabsGet(tab.id); } catch (_) { cur = null; }
    if (gen != null && apHalted(gen)) return { ok: false, reason: 'stopped' };
    if (!cur || cur.status !== 'loading') break;
    if (i >= AP_NAV_LOADING_POLLS) return { ok: false, reason: 'the MCA tab is still loading' };
    await d.sleep(AP_WIZARD_POLL_MS);
  }
  const forms = d.forms();
  if ([cur && cur.url, cur && cur.pendingUrl, tab.url, tab.pendingUrl].some(u => apIsFormUrl(u, forms))) return { ok: false, reason: 'the MCA tab shows a form' };
  if (gen != null && apHalted(gen)) return { ok: false, reason: 'stopped' };
  try { await d.navigateTab(tab.id, url); } catch (e) { return { ok: false, reason: (e && e.message) || String(e) }; }
  return { ok: true };
}

// Logged in or not, from up to 3 snapshots ~1 s apart: MCA's header fills in "Hello <NAME>" after the page loads,
// so one early snapshot can show "Login" for a logged-in user. Returns {loggedIn, loginLink, name} | {stop: true}.
async function apSettledLoginState(d, gen, tabId) {
  for (let i = 0; i < AP_LOGIN_SNAPSHOTS; i++) {
    if (i) await d.sleep(AP_WIZARD_POLL_MS);
    if (apHalted(gen)) return { stop: true };
    const st = await apLoginState(d, tabId);
    if (apHalted(gen)) return { stop: true };
    if (st && st.loggedIn) return { loggedIn: true, loginLink: false, name: st.name || '' };
    if (!(st && st.loginLink)) return { loggedIn: false, loginLink: false };
  }
  return { loggedIn: false, loginLink: true };
}

async function apLoginState(d, tabId) {
  try { return (await d.exec(tabId, pageApLoginState, [], 10000)) || null; } catch (_) { return null; }
}

// The user logs in by hand: poll the tab every 3 s (max 20 min) until MCA shows a logged-in page (or a form).
// Returns {ok: true, tab, name} | {ok: false, stopped} | {ok: false, reason}.
async function apWaitForLogin(d, gen, tabId, youText) {
  apStage(d, 'check', 'waiting', 'waiting for you to log in to MCA…');
  apSetYou(d, youText, 'mcaLogin');
  const t0 = d.now();
  const polls = Math.ceil(AP_LOGIN_MAX_MS / AP_LOGIN_POLL_MS);
  for (let i = 0; i < polls; i++) {
    if (apHalted(gen)) return { ok: false, stopped: true };
    let t = null;
    try { t = await d.tabsGet(tabId); } catch (_) { t = null; }
    if (apHalted(gen)) return { ok: false, stopped: true };
    if (!t) return { ok: false, reason: 'the MCA tab was closed' };
    const url = String(t.url || '');
    if (t.status !== 'loading' && apIsMcaAny(url) && !apIsLogin(url)) {
      if (apIsFormUrl(url, d.forms())) return { ok: true, tab: t, name: '' };
      const st = await apLoginState(d, tabId);
      if (apHalted(gen)) return { ok: false, stopped: true };
      if (st && st.loggedIn) return { ok: true, tab: t, name: st.name || '' };
    }
    if (d.now() - t0 >= AP_LOGIN_MAX_MS) break;
    await d.sleep(AP_LOGIN_POLL_MS);
  }
  return apHalted(gen) ? { ok: false, stopped: true } : { ok: false, reason: 'timeout' };
}

// AOC-4 (or a linked form) is loading in the tab: wait (max 90 s) until the page can be detected.
// Returns {tab, where, start} | {login: true} | {stopped: true} | {reason}.
async function apWaitForForm(d, gen, tabId) {
  const t0 = d.now();
  const polls = Math.ceil(AP_WIZARD_MAX_MS / AP_WIZARD_POLL_MS);
  for (let i = 0; i < polls; i++) {
    if (apHalted(gen)) return { stopped: true };
    let t = null;
    try { t = await d.tabsGet(tabId); } catch (_) { t = null; }
    if (apHalted(gen)) return { stopped: true };
    if (!t) return { reason: 'the MCA tab was closed' };
    if (!t.status || t.status === 'complete') {
      let w = null;
      try { w = await d.exec(tabId, d.pageWhere, [], 10000); } catch (_) { w = null; }
      if (apHalted(gen)) return { stopped: true };
      const url = (w && w.url) || t.url || '';
      if (apIsLogin(url)) return { login: true };
      const start = apStageForPage(url, w && w.step, d.forms());
      if (start) return { tab: t, where: w, start };
    }
    if (d.now() - t0 >= AP_WIZARD_MAX_MS) break;
    await d.sleep(AP_WIZARD_POLL_MS);
  }
  return apHalted(gen) ? { stopped: true } : { reason: 'timeout' };
}

// A form page the autopilot can wait on: AOC-4 (its wizard renders after the page) or a linked form.
const apFormToAwait = (url, forms) => (/form-aoc4/i.test(String(url || '')) && !/offline/i.test(String(url || '')))
  || (forms || []).some(f => f && AP_LINKED.includes(f.id) && f.urlRe instanceof RegExp && f.urlRe.test(String(url || '')));

// Run everything from anywhere: finds the MCA form page to run on. An MCA tab already showing a form is used as it
// is; otherwise any MCA tab (any window) is focused — or, with none, one tab is opened on the login page — the
// user logs in by hand, and that tab is sent to the AOC-4 form.
// Returns {tab, where, start} | {stop: true} | {error, you}.
// opts.draftExists: this company's AOC-4 draft already exists on MCA (an earlier run saved a page, or the session
// ended mid-run): a logged-in tab that is not on a form is then never sent to a fresh AOC-4 (a new filing).
async function apGetToForm(d, gen, opts = {}) {
  const forms = d.forms();
  const reopen = 'Open the AOC-4 form (or the linked form) on mca.gov.in, then press Run everything.';
  let tab0 = null;
  try { tab0 = await d.getActiveMcaTab(); } catch (_) { tab0 = null; }
  if (apHalted(gen)) return { stop: true };
  if (tab0 && !apIsLogin(tab0.url)) {
    let where = null;
    try { where = await d.exec(tab0.id, d.pageWhere, [], 15000); } catch (_) { where = null; }
    if (apHalted(gen)) return { stop: true };
    const start = apStageForPage((where && where.url) || tab0.url, where && where.step, forms);
    if (start) {
      // Already on the form: bring it to the front when it is behind another tab or in another window.
      let win = null;
      try { win = await d.panelWindowId(); } catch (_) { win = null; }
      if (tab0.active === false || (win != null && tab0.windowId != null && tab0.windowId !== win)) { try { await d.focusTab(tab0); } catch (_) { } }
      if (apHalted(gen)) return { stop: true };
      return { tab: tab0, where, start };
    }
  }
  // Not on a form page: any MCA tab in any window (a second MCA tab would log the user out).
  let all = [];
  try { all = (await d.queryAllMcaTabs()) || []; } catch (_) { all = []; }
  if (apHalted(gen)) return { stop: true };
  if (tab0 && !all.some(t => t && t.id === tab0.id)) all.push(tab0);
  let tab = apRankMcaTabs(all, forms, tab0 && tab0.id)[0] || null;
  if (!tab && AP.createdTab != null) {
    // The login tab opened by an earlier Run may still be loading (no MCA address yet): use it, never open another.
    try { tab = (await d.tabsGet(AP.createdTab)) || null; } catch (_) { tab = null; }
  }
  let you = AP_YOU.loginPage;
  if (!tab) {
    apStage(d, 'check', 'active', 'no MCA tab is open — opening the MCA login page…');
    try { tab = await d.createLoginTab(); } catch (e) { tab = null; }
    if (!tab || tab.id == null) return { error: 'could not open mca.gov.in', you: 'Open mca.gov.in yourself, log in, then press Run everything.' };
    AP.createdTab = tab.id;
    you = AP_YOU.opening;
  } else {
    try { await d.focusTab(tab); } catch (_) { }
  }
  if (apHalted(gen)) return { stop: true };
  AP.tabId = tab.id; AP.windowId = tab.windowId != null ? tab.windowId : null;
  try { d.setRunTab(tab.id); } catch (_) { }
  for (let round = 0; round < 4; round++) {
    let t = null;
    try { t = await d.tabsGet(tab.id); } catch (_) { t = null; }
    if (apHalted(gen)) return { stop: true };
    if (!t) return { error: 'the MCA tab was closed', you: 'The MCA tab was closed. Press Run everything again.' };
    // Decide only once the tab has finished loading (a draft being reopened, MCA's header still filling in).
    for (let i = 0; t.status === 'loading' && i < AP_NAV_LOADING_POLLS; i++) {
      await d.sleep(AP_WIZARD_POLL_MS);
      if (apHalted(gen)) return { stop: true };
      let t2 = null;
      try { t2 = await d.tabsGet(tab.id); } catch (_) { t2 = null; }
      if (apHalted(gen)) return { stop: true };
      if (!t2) return { error: 'the MCA tab was closed', you: 'The MCA tab was closed. Press Run everything again.' };
      t = t2;
    }
    const url = String(t.url || t.pendingUrl || '');
    const isForm = [t.url, t.pendingUrl].some(u => apIsFormUrl(u, forms));
    let needLogin = !isForm && (!apIsMcaAny(url) || apIsLogin(url));
    if (isForm && ![t.url, t.pendingUrl].some(u => apFormToAwait(u, forms))) return { error: 'Open the AOC-4 form', you: reopen };
    if (!needLogin && !isForm) {
      const st = await apSettledLoginState(d, gen, t.id);
      if (st.stop || apHalted(gen)) return { stop: true };
      if (!st.loggedIn) {
        needLogin = true;
        you = AP_YOU.loginHere;
        // A logged-out MCA page with a Login button (seen on every snapshot): show the login page.
        if (st.loginLink && (await apNavigate(d, t, AP_LOGIN_URL, gen)).ok) you = AP_YOU.loginPage;
        if (apHalted(gen)) return { stop: true };
      }
    }
    if (needLogin) {
      const w = await apWaitForLogin(d, gen, t.id, you);
      if (w.stopped || apHalted(gen)) return { stop: true };
      if (!w.ok) {
        if (w.reason === 'timeout') return { error: 'not logged in to MCA (waited 20 minutes)', you: AP_YOU.loginTimeout };
        return { error: w.reason, you: `${w.reason}. Press Run everything again.` };
      }
      t = w.tab;
      apSetYou(d, '', '');
      apStage(d, 'check', 'active', `logged in to MCA${w.name ? ` (${w.name})` : ''} — opening AOC-4…`);
    }
    const now = String(t.url || '');
    if (![t.url, t.pendingUrl].some(u => apIsFormUrl(u, forms))) {
      // The draft already exists: the user reopens it from My Application (a fresh form would be a new filing).
      if (opts.draftExists) return { error: 'reopen your draft', you: AP_YOU.reopen, waitingFor: 'reopen' };
      const nav = await apNavigate(d, t, AP_FORM_URL, gen);
      if (apHalted(gen)) return { stop: true };
      if (!nav.ok) return { error: `could not open the AOC-4 form (${nav.reason})`, you: reopen };
    } else if (!apFormToAwait(now, forms)) return { error: 'Open the AOC-4 form', you: reopen };
    apStage(d, 'check', 'active', 'waiting for the AOC-4 form to load on MCA…');
    const f = await apWaitForForm(d, gen, t.id);
    if (f.stopped || apHalted(gen)) return { stop: true };
    if (f.start) return f;
    if (f.login) { you = AP_YOU.loginPage; continue; }
    return { error: f.reason === 'timeout' ? 'the AOC-4 form did not load within 90 s' : f.reason, you: reopen };
  }
  return { error: 'Open the AOC-4 form', you: reopen };
}

// ───────────────────────── public entry points ─────────────────────────

// One click: check everything, then run from wherever the user is on MCA.
async function apRun(deps) {
  if (AP.running) return { state: 'busy' };
  const d = apDeps(deps);
  AP.deps = d;
  if (AP.watchOff) { try { AP.watchOff(); } catch (_) { } AP.watchOff = null; }
  apStopManualPoll();
  AP.gen++;
  const gen = AP.gen;
  // The previous run of this company (in memory): did it save a page on MCA or lose the session mid-run?
  const prev = { waitingFor: AP.waitingFor, stages: AP.stages, cin: AP.cin };
  Object.assign(AP, { stages: apStagesInit(), armed: false, stopRequested: false, waitingFor: '', you: '', now: '', summary: '',
    current: null, preferTab: null, tabId: null, startedAt: d.now(), endedAt: null, cin: String(d.cin() || '').toUpperCase(),
    answersByForm: {}, p1From: null, ...apRunFresh() });
  AP.running = true; AP.runningGen = gen;
  apStartTicker();
  let started = false;
  try {
    const draftExists = await apDraftExists(d, prev, AP.cin);
    if (apHalted(gen)) return apResult();
    apStage(d, 'check', 'active', 'looking at the MCA page…');
    if (!AP.cin || !d.client()) { apStage(d, 'check', 'error', 'load the company’s AOC-4 data first'); apSetYou(d, 'Choose the client above, then press Run everything.', 'fix'); return apResult(); }
    // On an MCA form already, or: focus / open MCA, wait for the user's login, open AOC-4.
    const got = await apGetToForm(d, gen, { draftExists });
    if (got.stop || apHalted(gen)) return apResult();
    if (got.error) { apStage(d, 'check', got.waitingFor ? 'warn' : 'error', got.error); apSetYou(d, got.you || '', got.waitingFor || 'fix'); return apResult(); }
    const { tab, start } = got;
    const other = apOtherCompany(got.where && got.where.cins, AP.cin);
    if (other) { apStage(d, 'check', 'error', `the MCA tab shows another company (CIN ${other})`); apOtherCompanyStop(d, other); return apResult(); }
    AP.tabId = tab.id; AP.windowId = tab.windowId != null ? tab.windowId : null;
    await apRememberTabs(d);
    try { d.setRunTab(tab.id); } catch (_) { }
    apStage(d, 'check', 'active', 'looking at the MCA page…');
    const order = AP_STAGE_DEFS.map(([x]) => x);
    for (const id of order.slice(1, order.indexOf(apStageAt(start)))) apStage(d, id, 'skipped', 'already done on MCA');
    const pre = await apPreflight(d, gen);
    if (apHalted(gen)) return apResult();
    if (!pre.ok) { apStage(d, 'check', 'error', pre.reason); apSetYou(d, `Not started: ${pre.reason}. Press Run everything when ready.`, 'fix'); return apResult(); }
    apStage(d, 'check', 'done', pre.detail);
    started = true;
  } finally {
    if (AP.runningGen === gen) { AP.running = false; AP.runningGen = null; }
    if (AP.gen === gen) {
      if (!started && !apHalted(gen)) apDisarm(d);
      apSave(d);
    }
  }
  if (apHalted(gen)) return apResult();
  apArm(d);
  await apContinue(d);
  return apResult();
}

// True when this company's AOC-4 draft already exists on MCA: the previous run (in memory or, after the side panel
// was reopened, the stored state of the same company < 6 h old) lost the MCA session mid-run, or saved / stopped /
// failed on an AOC-4 page or a linked form.
const AP_DRAFT_STAGES = ['aoc4p1', 'aoc4p2', ...AP_LINKED];
function apDraftSeen(waitingFor, stages) {
  if (['login', 'reopen'].includes(waitingFor)) return true;
  const st = id => (Array.isArray(stages) ? (stages.find(s => s && s.id === id) || {}).state : ((stages && stages[id]) || {}).state);
  return AP_DRAFT_STAGES.some(id => ['done', 'warn', 'error', 'skipped'].includes(st(id)));
}
async function apDraftExists(d, prev, cin) {
  if (!cin) return false;
  if (String(prev.cin || '').toUpperCase() === cin && apDraftSeen(prev.waitingFor, prev.stages)) return true;
  let o = null;
  try { o = await d.storageGet(AP_KEY); } catch (_) { o = null; }
  if (!o || String(o.cin || '').toUpperCase() !== cin || !(d.now() - (o.updatedAt || 0) < AP_MAX_AGE_MS)) return false;
  return apDraftSeen(o.waitingFor, o.stages);
}

function apResult() {
  return { armed: AP.armed, waitingFor: AP.waitingFor, you: AP.you, stages: AP.stages.map(s => ({ id: s.id, state: s.state, detail: s.detail })) };
}

// A tab event (debounced) or a manual nudge: resume if armed and idle.
async function apOnTabChange(deps, tabId) {
  const d = deps ? apDeps(deps) : AP.deps || apDeps();
  if (deps) AP.deps = d;
  if (!AP.armed || AP.running || apHalted()) return apResult();
  if (tabId != null) {
    // Locked to the run's tab: another tab counts only when it is a new tab showing a linked form still to do.
    if (!(await apTabAllowed(d, tabId))) return apResult();
    if (!AP.armed || AP.running || apHalted()) return apResult();
    AP.preferTab = tabId;
  }
  await apContinue(d);
  return apResult();
}

function apOnTabEvent(tabId) {
  if (!AP.armed) return;
  // An event of the run's own tab is not replaced by one from another tab within the debounce.
  if (!(AP.debounce && AP.tabId != null && AP.pendingTab === AP.tabId && tabId !== AP.tabId)) AP.pendingTab = tabId;
  if (AP.debounce) clearTimeout(AP.debounce);
  AP.debounce = setTimeout(() => {
    AP.debounce = null;
    if (AP.running || !AP.armed) return; // a stage is running: it re-checks the page itself when done
    apOnTabChange(null, AP.pendingTab);
  }, AP_DEBOUNCE_MS);
}

// MCA tabs of this window only; never navigates.
function apWatchTabs(handler) {
  if (typeof chrome === 'undefined' || !chrome || !chrome.tabs || !chrome.tabs.onUpdated) return () => {};
  const inWindow = w => AP.windowId == null || w == null || w === AP.windowId;
  const onUpd = (tabId, info, tab) => {
    if (!info || info.status !== 'complete' || !tab || !apIsMca(tab.url) || !inWindow(tab.windowId)) return;
    handler(tabId);
  };
  const onAct = async info => {
    if (!info || !inWindow(info.windowId)) return;
    let t = null;
    try { t = await chrome.tabs.get(info.tabId); } catch (_) { return; }
    if (t && apIsMca(t.url)) handler(info.tabId);
  };
  try { chrome.tabs.onUpdated.addListener(onUpd); chrome.tabs.onActivated.addListener(onAct); } catch (_) { }
  return () => { try { chrome.tabs.onUpdated.removeListener(onUpd); chrome.tabs.onActivated.removeListener(onAct); } catch (_) { } };
}

// Stop is final on the page too: the Q12(c) automatic Save (pageArmManualSave) is switched off on the run's tab.
// pageDisarmManualSave lives in page-automation.js; errors are ignored (tab closed, page reloaded).
function apDisarmPageSave(d) {
  if (typeof pageDisarmManualSave !== 'function' || AP.tabId == null || !d || typeof d.exec !== 'function') return;
  try { const p = d.exec(AP.tabId, pageDisarmManualSave, [], 5000); if (p && p.catch) p.catch(() => {}); } catch (_) { }
}

async function apStop(deps) {
  const d = deps ? apDeps(deps) : AP.deps || apDeps();
  if (!AP.running && !AP.armed && !AP.askResolve) return apResult();
  AP.stopRequested = true;
  apStopManualPoll();
  apDisarmPageSave(d);
  const cur = AP.current;
  if (AP.askResolve) { try { AP.askResolve({ action: 'stop' }); } catch (_) { } }
  try {
    // page 2 (step2Run) and the linked forms (lfRun) also read the stop flag through their shouldStop option.
    if (cur === 'aoc4p1') await d.requestFillStop();
    else if (AP_LINKED.includes(cur)) await d.lfStop();
    else if (!cur && ['active', 'waiting'].includes(apStateOf('check'))) d.cancelPanels(); // preflightQuestions' panel
  } catch (_) { }
  for (const s of AP.stages) if (s.state === 'active' || (s.state === 'waiting' && s.id !== 'finish')) apStage(d, s.id, 'warn', 'stopped by you');
  apSetYou(d, AP_YOU.stopped, 'stopped');
  apDisarm(d);
  return apResult();
}

async function apResetAll(deps) {
  const d = deps ? apDeps(deps) : AP.deps || apDeps();
  if (AP.running || AP.armed) await apStop(d);
  apReset();
  try { await d.storageRemove(AP_KEY); } catch (_) { }
  try { d.render(); } catch (_) { }
}

// Back to a clean state (tests, Reset). Does not touch storage. A loop still running from before stops at its
// next check (the generation changed) and clears `running` itself when it ends, so Run stays disabled until then.
function apReset() {
  if (AP.deps) apDisarmPageSave(AP.deps);
  if (AP.watchOff) { try { AP.watchOff(); } catch (_) { } }
  if (AP.debounce) clearTimeout(AP.debounce);
  apStopManualPoll();
  apStopTicker();
  AP.gen++;
  Object.assign(AP, { stages: apStagesInit(), armed: false, stopRequested: false, cin: '', waitingFor: '', tabId: null,
    windowId: null, startedAt: null, endedAt: null, updatedAt: 0, now: '', you: '', summary: '', current: null, askResolve: null,
    watchOff: null, debounce: null, pendingTab: null, preferTab: null, deps: null, answersByForm: {}, p1From: null, createdTab: null, dashNote: '', ...apRunFresh() });
}

// Side panel reopened: bring back the stage list of the same company (< 6 h) and keep watching when armed.
async function apRestore(deps) {
  const d = deps ? apDeps(deps) : AP.deps || apDeps();
  AP.deps = d;
  if (AP.running || AP.armed) return false;
  let o = null;
  try { o = await d.storageGet(AP_KEY); } catch (_) { o = null; }
  const cin = String(d.cin() || '').toUpperCase();
  if (!o || !o.stages || !cin || String(o.cin || '').toUpperCase() !== cin) return false;
  if (!(d.now() - (o.updatedAt || 0) < AP_MAX_AGE_MS)) return false;
  const interrupted = [];
  AP.stages = apStagesInit().map(s => {
    const p = o.stages[s.id];
    if (!p || !AP_STATES.includes(p.state)) return s;
    const base = { ...s, ms: p.ms == null ? null : p.ms };
    if (p.state !== 'active') return { ...base, state: p.state, detail: String(p.detail || '') };
    // An AOC-4 page that was running when the panel closed is never restarted on its own (it would fill and
    // save every section again): the CA presses Run everything. A linked form waits for the next page event.
    if (s.id === 'aoc4p1' || s.id === 'aoc4p2') { interrupted.push(s.id); return { ...base, state: 'warn', detail: 'interrupted — the side panel was closed' }; }
    return { ...base, state: 'waiting', detail: 'interrupted — the side panel was closed' };
  });
  Object.assign(AP, { cin, waitingFor: o.waitingFor || '', tabId: o.tabId == null ? null : o.tabId, windowId: o.windowId == null ? null : o.windowId,
    startedAt: o.startedAt || null, you: o.you || '', summary: o.summary || '', stopRequested: false, updatedAt: o.updatedAt,
    p1From: Number(o.p1From) || null });
  const chk = (o.stages && o.stages.check) || {};
  if (interrupted.length) {
    AP.armed = false;
    AP.waitingFor = 'fix';
    AP.you = `AOC-4 page ${interrupted.includes('aoc4p1') ? 1 : 2} was interrupted when the side panel closed. Press Run everything to continue it.`;
  } else if (o.waitingFor === 'mcaLogin' || (!o.armed && ['waiting', 'active'].includes(chk.state))) {
    // The wait for the MCA login (and opening AOC-4) runs only inside the side panel: it ended when the panel closed.
    AP.armed = false;
    AP.stages = AP.stages.map(s => (s.id === 'check' ? { ...s, state: 'warn', detail: 'interrupted — the side panel was closed', startedAt: null } : s));
    AP.waitingFor = 'fix';
    AP.you = 'The side panel was closed while waiting for your MCA login. Log in on the MCA tab, then press Run everything.';
  } else if (o.armed) {
    AP.armed = true;
    await apRememberTabs(d);
    if (!AP.watchOff) { try { AP.watchOff = d.watch(apOnTabEvent) || null; } catch (_) { AP.watchOff = null; } }
    if (AP.waitingFor === 'manual' && apStateOf('aoc4p1') === 'waiting') apStartManualPoll(d);
  }
  try { d.render(); } catch (_) { }
  return true;
}

// Restored and armed: look at the MCA page now only while the run was waiting for the user or MCA.
function apShouldNudge() { return AP.armed && !AP.running && AP_NUDGE.includes(AP.waitingFor); }

// ───────────────────────── UI ─────────────────────────

function apLiveNow() {
  try {
    if (AP.current && AP_LINKED.includes(AP.current) && typeof LF !== 'undefined' && LF && Array.isArray(LF.steps)) {
      const a = LF.steps.find(s => s.state === 'active');
      if (a) return `${a.label}${a.detail ? ' — ' + a.detail : ''}`;
    }
    if (AP.current === 'aoc4p2' && typeof document !== 'undefined') {
      const li = document.querySelector('#s2Result li:last-child');
      if (li && li.textContent) return li.textContent;
    }
  } catch (_) { }
  return AP.now;
}

function apRender() {
  if (typeof document === 'undefined') return;
  const card = apEl('apCard');
  if (!card) return;
  const now = Date.now();
  const ol = apEl('apStages');
  if (ol) {
    ol.innerHTML = '';
    for (const s of AP.stages) {
      const li = apMake('li', `ap-stage is-${s.state}`);
      li.appendChild(apMake('span', 'ap-ico', AP_ICON[s.state] || '○'));
      const body = apMake('span', 'ap-stage-body');
      body.appendChild(apMake('span', 'ap-stage-name', s.label));
      if (s.detail) body.appendChild(apMake('span', 'ap-stage-detail', s.detail));
      li.appendChild(body);
      li.appendChild(apMake('span', 'ap-ms', apFmt(apStageMs(s, now))));
      ol.appendChild(li);
    }
  }
  const pr = apProgress(AP.stages);
  const bar = apEl('apBar'); if (bar) bar.style.width = pr.pct + '%';
  const cnt = apEl('apCount'); if (cnt) cnt.textContent = `${pr.done} / ${pr.total}`;
  const tot = apEl('apTotal');
  if (tot) tot.textContent = AP.startedAt ? apFmt((AP.running || AP.armed ? now : AP.endedAt || AP.updatedAt || now) - AP.startedAt) : '';
  const nowEl = apEl('apNow');
  if (nowEl) {
    const active = AP.stages.find(s => s.state === 'active');
    const live = AP.running ? apLiveNow() : '';
    nowEl.textContent = active ? `${active.label}${live ? ' — ' + live : active.detail ? ' — ' + active.detail : ''}`
      : AP.running && AP.waitingFor === 'mcaLogin' ? 'Waiting for you to log in to MCA…'
        : AP.armed ? 'Watching the MCA tab…' : AP.summary ? 'Finished' : 'Idle';
  }
  const you = apEl('apYou');
  if (you) { you.textContent = AP.you || ''; you.hidden = !AP.you; }
  const sum = apEl('apSummary'); if (sum) sum.textContent = !AP.running && !AP.armed ? AP.summary || '' : '';
  const run = apEl('apRunBtn'); if (run) run.disabled = AP.running;
  const reset = apEl('apResetBtn'); if (reset) reset.disabled = AP.running; // Stop first; Reset never runs alongside a stage
  const stop = apEl('apStopBtn'); if (stop) stop.disabled = !(AP.running || AP.armed);
  card.dataset.state = AP.running ? 'running' : AP.armed ? 'watching' : 'idle';
}

function apStartTicker() {
  if (typeof document === 'undefined' || typeof setInterval !== 'function') return;
  if (AP.ticker) return;
  AP.ticker = setInterval(() => {
    apRender();
    if (!AP.running && !AP.stages.some(s => s.state === 'active')) apStopTicker();
  }, 250);
}
function apStopTicker() { if (AP.ticker) clearInterval(AP.ticker); AP.ticker = null; }

// "Now:" mirrors the running module's latest message: showMessage is wrapped once, non-destructively.
function apHookShowMessage() {
  try {
    const g = window;
    const orig = g.showMessage;
    if (typeof orig !== 'function' || orig.__apWrapped) return;
    const wrapped = function (type, text) {
      try { if (AP.running) AP.now = String(text == null ? '' : text); } catch (_) { }
      return orig.apply(this, arguments);
    };
    wrapped.__apWrapped = true;
    g.showMessage = wrapped;
  } catch (_) { }
}

function initAutopilot() {
  const card = apEl('apCard');
  if (!card) return;
  apHookShowMessage();
  apEl('apRunBtn').addEventListener('click', () => { apRun().catch(e => { apSetYou(AP.deps || apDeps(), 'Autopilot error: ' + e.message, 'fix'); }); });
  apEl('apStopBtn').addEventListener('click', () => { apStop(); });
  apEl('apResetBtn').addEventListener('click', () => { apResetAll(); });
  const fa = apEl('apFileA'), fg = apEl('apFileG');
  const at = apEl('apAttached');
  if (at) at.addEventListener('change', () => { apDashPreview(AP.deps || apDeps(), AP.cin).catch(() => {}); });
  if (fa) fa.addEventListener('change', async () => {
    const f = fa.files && fa.files[0];
    if (!f) return;
    AP.cin = AP.cin || String((AP.deps || apDeps()).cin() || '').toUpperCase();
    await apLoadRemembered(AP.cin);
    AP.files.a = f;
    await apRemember(AP.cin);
    apRenderFiles();
    apDashPreview(AP.deps || apDeps(), AP.cin).catch(() => {});
  });
  if (fg) fg.addEventListener('change', async () => {
    const fs = [...(fg.files || [])];
    if (!fs.length) return;
    AP.cin = AP.cin || String((AP.deps || apDeps()).cin() || '').toUpperCase();
    await apLoadRemembered(AP.cin);
    AP.files.g = fs;
    await apRemember(AP.cin);
    apRenderFiles();
    apDashPreview(AP.deps || apDeps(), AP.cin).catch(() => {});
  });
  apRender();
  // The company loads after the panel: restore the run (and the remembered files) once its CIN is known,
  // and follow company changes.
  let lastCin = '', restored = false;
  const tick = async () => {
    const d = AP.deps || apDeps();
    const cin = String(d.cin() || '').toUpperCase();
    if (cin === lastCin) return;
    lastCin = cin;
    if (!AP.running && !AP.armed) AP.cin = cin;
    if (!AP.running) { await apLoadRemembered(cin); apDashPreview(d, cin).catch(() => {}); }
    if (!restored && cin) {
      restored = true;
      if (await apRestore(d)) { apStartTicker(); if (apShouldNudge()) apOnTabChange(null, null); }
    }
  };
  tick();
  setInterval(tick, 1500);
}

if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', initAutopilot);
if (typeof module !== 'undefined') module.exports = {
  apStageForPage, apStagesInit, apIsFormUrl, apIsMcaAny, apRankMcaTabs, pageApLoginState, AP_LOGIN_URL, AP_FORM_URL, AP_YOU, apStageUpdate, apStageMs, apNextStage, apIsLogin, apIsMca, apPlan, apGroupMissing,
  apCollectPreflight, apStep2Invalid, apDateDDMMYYYY, apProgress, apFmt, apSummaryLine, apFillWhy, pageApWhere, pageApManualState,
  pageApForward, pageApErrorDialog, pageApCloseInfoPopups, apForwardAndWait, apPageKey, apHoldForward, apOtherCompany, apPageName, apForwardWhy, apTimelineDetail, apLinkedCounts, apCertMissing, apHookTimeline,
  apDashPreview, apGetFilesDefault,
  apRun, apOnTabChange, apStop, apRestore, apDeps, apReset, apResetAll, apShouldNudge, AP, AP_KEY, AP_CERT_KEY, AP_CERT, AP_STAGE_DEFS,
};

// Shows the running extension version in the Autopilot card, so it is clear whether Chrome loaded the latest build.
if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => {
  try {
    const el = document.getElementById('apVersion');
    if (el && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) el.textContent = 'v' + chrome.runtime.getManifest().version;
  } catch (_) { }
});
