// node --test tests/autopilot.test.mjs   (from extension/)
// Drives the autopilot with stubs only: no DOM, no MCA, no network. Made-up company data.
// MCA flow modelled here: AOC-4 page 1 → Save → Next → page 2 → Save → Proceed → linked forms (each Save →
// Proceed; the Board's report ends with Save) — or Review & Submit, where the Submit is always the user's.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const A = require('../js/autopilot.js');
const R = require('../js/linked/runner.js'); // real lfCollectMissing for answer validation
const S2 = require('../js/step2-attach.js'); // real dashboard-attachment helpers (fetch stubbed)

const CIN = 'U01100KA2019PTC000001';
const BASE = 'https://www.mca.gov.in/content/mca/global/en/mca/e-filing/annual-filings/';
const URL_AOC4 = BASE + 'form-aoc4.html';
const URL_AOC2 = BASE + 'form-aoc2.html';
const URL_AUD = BASE + 'extract-of-auditor-standalone.html';
const URL_BOARD = BASE + 'form-extract-of-boards-report.html';
const URL_LOGIN = 'https://www.mca.gov.in/content/mca/global/en/foportal/fologin.html';
const URL_CSR = BASE + 'form-csr-2.html';
const URL_HOME = 'https://www.mca.gov.in/content/mca/global/en/home.html';
// The CA's own certificate details (made up).
const CERT = { CERT_PROFESSION: 'Chartered Accountant', CERT_ASSOC_FELLOW: 'Associate', CERT_MEMBERSHIP_NO: '123456', CERT_COP_NO: '654321' };

const plainForms = () => [
  { id: 'aoc2', label: 'AOC-2', urlRe: /form-aoc2\.html/i, answersForm: 'aoc2', nextButton: 'Proceed', buildData: () => ({ values: {}, missing: [] }) },
  { id: 'eauditor', label: "Auditor's report", urlRe: /extract-of-auditor-standalone/i, answersForm: 'eauditor', nextButton: 'Proceed', buildData: () => ({ values: {}, missing: [] }) },
  { id: 'eboard', label: "Board's report", urlRe: /form-extract-of-boards-report/i, answersForm: 'eboard', nextButton: null, buildData: () => ({ values: {}, missing: [] }) },
];

// A fake MCA tab + every dependency the autopilot uses. `calls` records the order of side effects.
// page.afterP2: where page 2's Proceed leads — 'review' (Review & Submit, only Submit there), 'page1' (MCA
// redirects back to page 1), a URL (a linked form), or an array of those used one by one.
function harness(over = {}) {
  const calls = [];
  const forwards = [];
  const tab = { id: 7, windowId: 1, url: URL_AOC4, status: 'complete', active: true };
  const page = { step: 'Company details', linked: '', afterP2: 'review', reviewProceed: null, forward: null };
  const store = { [A.AP_CERT_KEY]: { ...CERT } };
  const chromeCalls = [];
  globalThis.chrome = { tabs: { create: (...a) => chromeCalls.push(['create', a]), update: (...a) => chromeCalls.push(['update', a]) } };
  const nextLinked = { aoc2: URL_AUD, eauditor: URL_BOARD };
  const manual = { armed: false, completed: false };
  const timers = [];
  // MCA tabs / login as the autopilot sees them before a run: none = no MCA tab anywhere; tabs = what a query of
  // every window returns (default: the one tab); the user logs in by hand after `loginAfter` 3-second waits.
  const mca = { none: false, tabs: null, loggedIn: true, loginLink: false, loginAfter: 2, waits: 0, lateStep: '', lateN: 0, onWait: null };
  const loginTick = () => {
    if (++mca.waits < mca.loginAfter) return;
    if (A.apIsLogin(tab.url)) tab.url = URL_HOME;
    mca.loggedIn = true;
  };
  // MCA's answer to a forward click (pageApForward): moves the fake page like MCA would.
  const defaultForward = prefer => {
    if (/form-aoc4/.test(tab.url)) {
      if (/company details/i.test(page.step) && prefer.includes('Next')) {
        page.step = 'Attachment & Declaration';
        return { clicked: true, label: 'Next', seen: ['Previous', 'Save', 'Next'] };
      }
      if (/attachment/i.test(page.step) && prefer.includes('Proceed')) {
        const dest = Array.isArray(page.afterP2) ? page.afterP2.shift() : page.afterP2;
        if (dest === 'review') page.step = 'Review & Submit';
        else if (dest === 'page1') page.step = 'Company details';
        else if (dest) tab.url = dest;
        return { clicked: true, label: 'Proceed', seen: ['Previous', 'Save', 'Proceed'] };
      }
      if (/review/i.test(page.step)) {
        if (page.reviewProceed && prefer.includes('Proceed')) { tab.url = page.reviewProceed; return { clicked: true, label: 'Proceed', seen: ['Previous', 'Proceed', 'Submit'] }; }
        return { clicked: false, label: '', reason: 'none', seen: ['Previous', 'Submit'] };
      }
    }
    return { clicked: false, label: '', reason: 'none', seen: [] };
  };
  const deps = {
    now: () => Date.now(),
    client: () => ({ general: { CIN } }),
    cin: () => CIN,
    forms: plainForms,
    getActiveMcaTab: async () => (mca.none ? null : { ...tab }),
    tabsGet: async id => (id === tab.id ? { ...tab } : null),
    queryMcaTabs: async () => [{ ...tab }],
    queryAllMcaTabs: async () => (mca.none ? [] : mca.tabs ? mca.tabs.map(t => ({ ...t })) : [{ ...tab }]),
    createLoginTab: async () => { chromeCalls.push(['create', A.AP_LOGIN_URL]); mca.none = false; tab.url = URL_LOGIN; tab.windowId = 1; return { ...tab }; },
    navigateTab: async (id, url) => {
      chromeCalls.push(['navigate', id, url]);
      if (url === A.AP_FORM_URL) { tab.url = URL_AOC4; page.step = mca.lateStep ? '' : 'Company details'; } else tab.url = URL_LOGIN;
    },
    focusTab: async t => { chromeCalls.push(['focus', t.id, t.windowId]); },
    panelWindowId: async () => 1,
    setRunTab: () => {},
    sleep: async ms => {
      if (ms === 3000) { if (mca.onWait) await mca.onWait(); loginTick(); }
      if (ms === 1000 && mca.lateStep && ++mca.lateN >= 2) page.step = mca.lateStep;
    },
    exec: async (tabId, func, args) => {
      calls.push('exec:' + func.name);
      if (func.name === 'pageApWhere') return { url: tab.url, step: /form-aoc4/.test(tab.url) ? page.step : page.linked, ...(page.cins ? { cins: page.cins } : {}) };
      if (func.name === 'pageApForward') {
        const prefer = args[0];
        assert.ok(Array.isArray(prefer) && !prefer.some(p => /submit/i.test(p)), 'the autopilot never asks for Submit');
        forwards.push(prefer.join('/'));
        return (page.forward || defaultForward)(prefer);
      }
      if (func.name === 'pageApManualState') return { ...manual };
      if (func.name === 'pageApLoginState') {
        const onLogin = A.apIsLogin(tab.url);
        return { loggedIn: mca.loggedIn && !onLogin, onLoginPage: onLogin, loginLink: mca.loginLink && !mca.loggedIn };
      }
      throw new Error('unexpected page function ' + func.name);
    },
    startRun: async () => { calls.push('startRun'); return { ok: true, completedAll: true, notSaved: [], issues: [] }; },
    step2Run: async opts => {
      calls.push('step2Run');
      deps.lastStep2 = opts;
      page.step = 'Attachment & Declaration';
      return { ok: true, saved: true, items: [['ok', 'Saved — MCA confirmed']] };
    },
    lfRun: async opts => {
      const form = plainForms().find(f => f.urlRe.test(tab.url));
      calls.push('lfRun:' + (form ? form.id : '?'));
      deps.lastLf = opts;
      assert.equal(opts.auto, true);
      assert.equal(typeof opts.shouldStop, 'function');
      assert.equal(opts.shouldStop(), false);
      if (!form) return { state: 'not-linked', proceeded: false, note: '' };
      if (nextLinked[form.id]) { tab.url = nextLinked[form.id]; page.linked = ''; return { state: 'done', form: form.id, proceeded: true, nextUrl: tab.url, note: 'Saved' }; }
      return { state: 'done', form: form.id, proceeded: false, note: 'Saved' };
    },
    lfStop: async () => { calls.push('lfStop'); },
    lfSteps: () => null,
    requestFillStop: async () => { calls.push('requestFillStop'); },
    preflightQuestions: async () => { calls.push('preflightQuestions'); return { ok: true, asked: 0 }; },
    step2Prefill: async () => { calls.push('step2Prefill'); },
    lfFetchAnswers: async () => ({}),
    lfSaveAnswers: async (cin, byForm) => { calls.push('lfSaveAnswers'); deps.saved = byForm; return []; },
    collectMissing: R.lfCollectMissing,
    readStep2: () => ({ resNo: '1/2025', resDate: '01/09/2025', desig: 'Director', din: '07654321' }),
    writeStep2: v => { deps.step2Written = v; },
    getFiles: async () => ({ a: { name: 'fs.pdf', size: 10 }, g: [], allowNoFileA: false }),
    // Dashboard attachments: none / backend offline unless a test says otherwise (never the network).
    dashboardList: async () => null,
    dashboardFiles: async (cin, files) => ({ files, used: [], failed: [], offline: true }),
    setFileA: async f => { deps.fileA = f; },
    setAlreadyAttached: () => {},
    ask: async () => { calls.push('ask'); return { action: 'stop' }; },
    pageWhere: A.pageApWhere,
    hookTimeline: cb => { deps.timelineCb = cb; return () => { deps.timelineCb = null; calls.push('unhook'); }; },
    mark: (cin, part, state) => { calls.push(`mark:${part}:${state}`); },
    log: () => {},
    storageGet: async k => store[k] || null,
    storageSet: async (k, v) => { store[k] = JSON.parse(JSON.stringify(v)); },
    storageRemove: async k => { delete store[k]; },
    watch: () => { calls.push('watch'); return () => calls.push('unwatch'); },
    render: () => {},
    cancelPanels: () => { calls.push('cancelPanels'); },
    phase: 1,
    getPhase: () => deps.phase,
    setPhase: n => { deps.phase = n; },
    every: (ms, fn) => { const t = { fn, on: true }; timers.push(t); return () => { t.on = false; }; },
    ...over,
  };
  // Runs every live interval callback once (the Q12(c) / page-step watchers).
  const tick = async () => { for (const t of timers.filter(x => x.on)) await t.fn(); };
  return { deps, calls, forwards, tab, page, store, chromeCalls, manual, timers, tick, mca };
}

const stateOf = (res, id) => res.stages.find(s => s.id === id).state;
const detailOf = (res, id) => res.stages.find(s => s.id === id).detail;
const noSubmit = calls => assert.equal(calls.filter(c => /submit/i.test(c)).length, 0, 'nothing named like submit may run: ' + calls.join(', '));
const sideEffects = calls => calls.filter(c => !c.startsWith('exec:pageApWhere') && c !== 'exec:pageApErrorDialog' && c !== 'exec:pageApCloseInfoPopups' && !c.startsWith('mark:') && !['watch', 'unwatch', 'unhook'].includes(c));

beforeEach(() => A.apReset());

test('stage detection: AOC-4 wizard steps, linked forms, anything else', () => {
  const F = plainForms();
  assert.equal(A.apStageForPage(URL_AOC4, 'Company details', F), 'aoc4p1');
  assert.equal(A.apStageForPage(URL_AOC4 + '?srn=1', 'Registration details', F), 'aoc4p1');
  assert.equal(A.apStageForPage(URL_AOC4, 'Attachment & Declaration', F), 'aoc4p2');
  assert.equal(A.apStageForPage(URL_AOC4, 'Review & Submit', F), 'review');
  assert.equal(A.apStageForPage(URL_AOC4, '', F), null);
  assert.equal(A.apStageForPage(BASE + 'form-aoc4-offline.html', 'Company details', F), null);
  assert.equal(A.apStageForPage(URL_AOC2, '', F), 'aoc2');
  assert.equal(A.apStageForPage(URL_AUD + '?x=1', '', F), 'eauditor');
  assert.equal(A.apStageForPage(URL_BOARD, '', F), 'eboard');
  assert.equal(A.apStageForPage(URL_CSR, '', F), null);
  assert.equal(A.apStageForPage('https://evil.example/form-aoc4.html', 'Company details', F), null);
  assert.ok(A.apIsLogin(URL_LOGIN));
  assert.ok(A.apIsLogin('https://www.mca.gov.in/content/mca/global/en/login.html'));
  assert.ok(!A.apIsLogin(URL_AOC4));
  assert.ok(!A.apIsLogin('https://example.com/login'));
  assert.equal(A.apPageKey(URL_AOC4 + '?a=1#x', ' Attachment &  Declaration '), URL_AOC4 + '|attachment & declaration');
  assert.equal(A.apPageName('aoc4p1', F), 'AOC-4 page 1');
  assert.equal(A.apPageName('eauditor', F), "Auditor's report");
});

test('stage list: ids, labels, elapsed time, done/skipped never reopened, next stage', () => {
  let s = A.apStagesInit();
  assert.deepEqual(s.map(x => x.id), ['check', 'aoc4p1', 'aoc4p2', 'aoc2', 'eauditor', 'eboard', 'finish']);
  assert.match(s[1].label, /page 1 — fill, Save, Next/);
  assert.match(s[2].label, /page 2 — fill, attach, Save, Proceed/);
  assert.match(s[5].label, /fill, Save$/);
  s = A.apStageUpdate(s, 'aoc4p1', 'active', 'filling', 1000);
  assert.equal(A.apStageMs(s[1], 1500), 500);
  s = A.apStageUpdate(s, 'aoc4p1', 'done', 'saved', 4000);
  assert.equal(s[1].ms, 3000);
  assert.equal(A.apStageUpdate(s, 'aoc4p1', 'active', 'x', 5000)[1].state, 'done');
  assert.equal(A.apStageUpdate(s, 'aoc4p1', 'bogus', 'x', 5000), s);
  s = A.apStageUpdate(s, 'check', 'skipped', 'already', 10);
  assert.equal(A.apNextStage(s), 'aoc4p2');
  s = A.apStageUpdate(s, 'aoc4p2', 'waiting', 'answers', 10);
  s = A.apStageUpdate(s, 'aoc4p2', 'active', 'again', 20);
  s = A.apStageUpdate(s, 'aoc4p2', 'error', 'x', 50);
  assert.equal(s[2].ms, 30);
  assert.equal(A.apProgress(s).done, 2);
  assert.match(A.apSummaryLine(s, 65000), /1 done · 0 warning · 1 error · 1 skipped · total 1m 05s/);
});

test('plan: a finished page is moved on from, never refilled; Review & Submit only with Proceed', () => {
  let s = A.apStagesInit();
  assert.deepEqual(A.apPlan(s, 'aoc4p1'), { run: 'aoc4p1' });
  s = A.apStageUpdate(s, 'aoc4p1', 'done', '', 1);
  assert.deepEqual(A.apPlan(s, 'aoc4p1'), { forward: 'aoc4p1', prefer: ['Proceed', 'Next'] });
  assert.deepEqual(A.apPlan(s, 'aoc4p2'), { run: 'aoc4p2' });
  s = A.apStageUpdate(s, 'aoc4p2', 'warn', 'saved, check (g)', 1);
  assert.deepEqual(A.apPlan(s, 'aoc4p2'), { forward: 'aoc4p2', prefer: ['Proceed', 'Next'] });
  assert.deepEqual(A.apPlan(s, 'review'), { forward: 'review', prefer: ['Proceed'] });
  assert.deepEqual(A.apPlan(s, 'eauditor'), { run: 'eauditor' });
  s = A.apStageUpdate(s, 'eauditor', 'done', '', 1);
  assert.equal(A.apPlan(s, 'eauditor').wait, 'linked-done');
  assert.deepEqual(A.apPlan(s, 'eauditor', { revisit: true }), { forward: 'eauditor', prefer: ['Proceed', 'Next'] });
  s = A.apStageUpdate(s, 'aoc2', 'error', 'x', 1);
  assert.equal(A.apPlan(s, 'aoc2', { revisit: true }).wait, 'linked-done', 'a failed form is never moved on from');
  assert.deepEqual(A.apPlan(s, null), { wait: 'unknown' });
});

test('status helpers: timeline → "Phase N of 7", forward reasons, linked counts', () => {
  assert.equal(A.apTimelineDetail('note', 'phase3_6', 'Phase 3: saving…'), 'Phase 3 of 7 — Balance sheet: saving…');
  assert.equal(A.apTimelineDetail('setActive', 'phase2', 'Phase 2: filling 12/40'), 'Phase 2 of 7 — Subsidiary, auditor & service provider: filling 12/40');
  assert.equal(A.apTimelineDetail('setDone', 'phase1', 'Saved'), 'Phase 1 of 7 — General info: Saved');
  assert.equal(A.apTimelineDetail('setError', 'phase3_6', 'Phase 4: fix validation errors'), '⚠ Phase 4 of 7 — Financial parameters: fix validation errors');
  assert.equal(A.apTimelineDetail('setActive', 'prepare', 'Reading client data…'), 'Preparing: Reading client data…');
  assert.equal(A.apTimelineDetail('note', 'phase7', ''), '');
  assert.equal(A.apForwardWhy({ clicked: false, reason: 'none', seen: ['Previous', 'Save', 'Submit'] }), 'MCA shows only: Previous, Save, Submit');
  assert.equal(A.apForwardWhy({ clicked: false, reason: 'field-errors', errors: ['a', 'b'] }), 'MCA shows: a · b');
  assert.match(A.apForwardWhy({ clicked: true, label: 'Proceed', reason: 'did not move' }), /^Proceed was clicked, but MCA did not move$/);
  assert.equal(A.apLinkedCounts([{ id: 'fill', detail: '12 filled · 3 skipped · 1 failed' }]), '12 filled · 1 failed');
  assert.equal(A.apLinkedCounts(null), '');
  assert.deepEqual(A.apCertMissing({ CERT_PROFESSION: 'Plumber', CERT_ASSOC_FELLOW: 'Fellow', CERT_MEMBERSHIP_NO: '1', CERT_COP_NO: '' }).map(m => m.key), ['CERT_PROFESSION', 'CERT_COP_NO']);
  assert.deepEqual(A.apCertMissing(CERT), []);
  assert.deepEqual(A.apCertMissing(null), []);
});

test('preflight: missing answers of every form are merged, shared declaration asked once', () => {
  const forms = [
    { id: 'aoc2', label: 'AOC-2', answersForm: 'aoc2', buildData: (c, a) => ({ missing: [
      ...(a.BOARD_RESOLUTION_NO ? [] : [{ key: 'BOARD_RESOLUTION_NO', label: 'Resolution no', type: 'text' }]),
      ...(a.ROWS ? [] : [{ key: 'ROWS', label: 'Contracts', type: 'textarea' }]),
      { key: 'NOTE', label: 'Note', type: 'text', optional: true },
    ] }) },
    { id: 'eauditor', label: "Auditor's report", answersForm: 'eauditor', buildData: (c, a) => ({ missing: [
      ...(a.BOARD_RESOLUTION_NO ? [] : [{ key: 'BOARD_RESOLUTION_NO', label: 'Resolution no', type: 'text' }]),
      ...(a.DECL_DIN ? [] : [{ key: 'DECL_DIN', label: 'DIN', type: 'text' }]),
    ] }) },
    { id: 'eboard', label: "Board's report", answersForm: 'eboard', buildData: () => { throw new Error('bad data'); } },
  ];
  const pre = A.apCollectPreflight({ client: {}, answersByForm: {}, forms, step2: { resNo: '', resDate: '', din: '07654321' }, needFileA: true });
  assert.deepEqual(pre.groups.map(g => g.id), ['aoc4', 'aoc2']);
  assert.deepEqual(pre.groups[0].missing.map(m => m.key), ['BOARD_RESOLUTION_NO', 'DECL_DIN', 'BOARD_RESOLUTION_DATE']);
  assert.ok(pre.groups[0].missing.every(m => m.formType === 'aoc4'));
  assert.deepEqual(pre.groups[1].missing.map(m => m.key), ['ROWS']);
  assert.equal(pre.count, 5); // 3 shared + ROWS + the (a) PDF
  assert.equal(pre.notes.length, 1);
  const none = A.apCollectPreflight({ client: {}, answersByForm: { aoc2: { BOARD_RESOLUTION_NO: '1', ROWS: 'x' }, eauditor: { BOARD_RESOLUTION_NO: '1', DECL_DIN: '07654321' } },
    forms: forms.slice(0, 2), step2: null });
  assert.equal(none.groups.length, 0);
  // Certificate details: their own group right after the declaration, all four as select / text questions.
  const withCert = A.apCollectPreflight({ client: {}, answersByForm: {}, forms: forms.slice(0, 1), step2: { resNo: '', resDate: '01/09/2025', din: '07654321' }, cert: {} });
  assert.deepEqual(withCert.groups.map(g => g.id), ['aoc4', 'cert', 'aoc2']);
  const certGroup = withCert.groups[1];
  assert.deepEqual(certGroup.missing.map(m => [m.key, m.type]), [['CERT_PROFESSION', 'select'], ['CERT_ASSOC_FELLOW', 'select'], ['CERT_MEMBERSHIP_NO', 'text'], ['CERT_COP_NO', 'text']]);
  assert.deepEqual(certGroup.missing[0].options, ['Chartered Accountant', 'Cost Accountant', 'Company Secretary']);
  assert.deepEqual(certGroup.missing[1].options, ['Associate', 'Fellow']);
  assert.ok(certGroup.missing.every(m => m.formType === 'aoc4'));
  assert.equal(A.apCollectPreflight({ client: {}, forms: [], step2: null, cert: { ...CERT } }).groups.length, 0);
});

test('run: preflight asks everything once, stores answers, then runs', async () => {
  const forms = () => [
    { ...plainForms()[0], buildData: (c, a) => ({ missing: a.ROWS ? [] : [{ key: 'ROWS', label: 'Contracts', type: 'textarea' }] }) },
    { ...plainForms()[1], buildData: (c, a) => ({ missing: a.DECL_DIN ? [] : [{ key: 'DECL_DIN', label: 'DIN', type: 'text' }] }) },
    plainForms()[2],
  ];
  const asks = [];
  const h = harness({
    forms,
    readStep2: () => ({ resNo: '', resDate: '', desig: 'Director', din: '' }),
    getFiles: async () => ({ a: null, g: [], allowNoFileA: false }),
    ask: async (groups, ctx) => {
      asks.push({ groups: groups.map(g => [g.id, g.missing.map(m => m.key)]), ctx });
      if (asks.length === 1) return { action: 'save', raw: { aoc4: { BOARD_RESOLUTION_NO: '', BOARD_RESOLUTION_DATE: '2025-09-01', DECL_DIN: '07654321' }, aoc2: { ROWS: 'x' } }, fileA: null, alreadyAttached: true };
      return { action: 'save', raw: { aoc4: { BOARD_RESOLUTION_NO: '3/2025', BOARD_RESOLUTION_DATE: '01-09-2025', DECL_DIN: '07654321' }, aoc2: { ROWS: 'x' } }, fileA: null, alreadyAttached: true };
    },
  });
  const res = await A.apRun(h.deps);
  // Asked twice only because the first answers were invalid (empty resolution number); one ask box per run.
  assert.equal(asks.length, 2);
  assert.deepEqual(asks[0].groups, [['aoc4', ['DECL_DIN', 'BOARD_RESOLUTION_NO', 'BOARD_RESOLUTION_DATE']], ['aoc2', ['ROWS']]]);
  assert.equal(asks[0].ctx.fileNeeded, true);
  assert.ok(asks[1].ctx.errors.some(e => /Resolution|resolution/.test(e)));
  assert.deepEqual(Object.keys(h.deps.saved).sort(), ['aoc2', 'aoc4']);
  assert.equal(h.deps.saved.aoc4.find(x => x.key === 'BOARD_RESOLUTION_DATE').value, '01/09/2025');
  assert.equal(h.deps.step2Written.resNo, '3/2025');
  assert.equal(h.calls.filter(c => c === 'lfSaveAnswers').length, 1);
  assert.equal(stateOf(res, 'check'), 'done');
  assert.equal(res.waitingFor, 'submit');
});

test('linked-form placeholders: company master allows them → answered and saved without a question; AOC-4 still asked', async () => {
  const LD = require('../js/linked/dummy-fill.js');
  const forms = () => [
    { ...plainForms()[0], buildData: (c, a) => ({ missing: a.ROWS ? [] : [{ key: 'ROWS', label: 'Contracts', type: 'textarea' }] }) },
    { ...plainForms()[1], buildData: (c, a) => ({ missing: a.EMPHASIS ? [] : [{ key: 'EMPHASIS', label: '1(c) Emphasis of matter', type: 'textarea' }] }) },
    plainForms()[2],
  ];
  const asks = [];
  const mk = allow => harness({
    forms,
    linkedDummy: () => LD,
    lfFetchAnswers: async () => ({ ...CERT, ...(allow ? { LINKED_DUMMY_OK: 'Yes' } : {}) }),
    readStep2: () => ({ resNo: '3/2025', resDate: '01/09/2025', desig: 'Director', din: '07654321' }),
    getFiles: async () => ({ a: null, g: [], allowNoFileA: true }),
    ask: async groups => { asks.push(groups.map(g => g.id + ':' + g.missing.map(m => m.key).join('+'))); return { action: 'save', raw: { aoc2: { ROWS: '[]' }, eauditor: { EMPHASIS: 'Nil' } }, fileA: null, alreadyAttached: true }; },
  });
  const h = mk(true);
  const res = await A.apRun(h.deps);
  assert.equal(asks.length, 0, 'no question for the linked forms: ' + JSON.stringify(asks));
  assert.equal(h.calls.filter(c => c === 'lfSaveAnswers').length, 1, 'placeholders saved to the company master');
  assert.deepEqual(Object.keys(h.deps.saved).sort(), ['aoc2', 'eauditor']);
  assert.ok(h.deps.saved.eauditor.every(x => /^PLACEHOLDER — /.test(x.label)));
  assert.equal(h.deps.saved.eauditor[0].value, 'Nil');
  assert.equal(stateOf(res, 'check'), 'done');
  // Not allowed for this company: asked as before.
  asks.length = 0;
  const h2 = mk(false);
  await A.apRun(h2.deps);
  assert.equal(asks.length, 1);
});

test('happy path: page 1 → Next → page 2 → Proceed → AOC-2 → auditor → board → finish; never submit, never tabs', async () => {
  const h = harness();
  h.page.afterP2 = URL_AOC2;
  const res = await A.apRun(h.deps);
  assert.deepEqual(['check', 'aoc4p1', 'aoc4p2', 'aoc2', 'eauditor', 'eboard'].map(id => stateOf(res, id)), ['done', 'done', 'done', 'done', 'done', 'done']);
  assert.equal(stateOf(res, 'finish'), 'waiting');
  assert.match(res.you, /click Submit and sign with your DSC yourself/);
  assert.equal(res.armed, false);
  assert.match(detailOf(res, 'aoc4p1'), /all sections saved · Next → page 2/);
  assert.match(detailOf(res, 'aoc4p2'), /saved · .* · Proceed clicked/);
  assert.equal(h.deps.lastStep2.auto, true);
  assert.equal(h.deps.lastStep2.save, true);
  assert.equal(h.deps.lastStep2.files.a.name, 'fs.pdf');
  assert.equal(h.deps.lastStep2.values.din, '07654321');
  assert.deepEqual(h.deps.lastStep2.certificate, CERT, 'page 2 gets the certificate details');
  assert.deepEqual(sideEffects(h.calls), ['preflightQuestions', 'step2Prefill', 'startRun', 'exec:pageApForward', 'step2Run', 'exec:pageApForward', 'lfRun:aoc2', 'lfRun:eauditor', 'lfRun:eboard']);
  assert.deepEqual(h.forwards, ['Next', 'Proceed/Next']);
  assert.ok(h.calls.includes('mark:phase1:done') && h.calls.includes('mark:step2:done'));
  assert.ok(h.calls.includes('unwatch'));
  assert.ok(h.calls.includes('unhook'), 'the timeline hook is removed after page 1');
  noSubmit(h.calls);
  assert.deepEqual(h.chromeCalls, []);
  assert.equal(h.store[A.AP_KEY].armed, false);
});

test('MCA redirects to page 1 after page 2’s Proceed: no refill — Next, Proceed, then the linked forms', async () => {
  const h = harness();
  h.page.afterP2 = ['page1', URL_AOC2];
  const res = await A.apRun(h.deps);
  assert.equal(h.calls.filter(c => c === 'startRun').length, 1, 'page 1 is not filled again');
  assert.equal(h.calls.filter(c => c === 'step2Run').length, 1, 'page 2 is not filled again');
  assert.deepEqual(h.forwards, ['Next', 'Proceed/Next', 'Proceed/Next', 'Proceed/Next']);
  assert.equal(stateOf(res, 'aoc2'), 'done');
  assert.equal(stateOf(res, 'finish'), 'waiting');
  noSubmit(h.calls);
});

test('loop guard: MCA keeps going back to page 1 → at most 3 forward clicks per page, then the run stops', async () => {
  const h = harness();
  h.page.afterP2 = 'page1';
  const res = await A.apRun(h.deps);
  assert.equal(res.armed, false);
  assert.match(res.you, /MCA went back to AOC-4 page 1\. Check MCA for an error message, then press Run everything\./);
  assert.equal(h.forwards.length, 6, 'page 1: 3 Next, page 2: 3 Proceed');
  assert.equal(h.calls.filter(c => c === 'startRun').length, 1);
  assert.equal(h.calls.filter(c => c === 'step2Run').length, 1);
  assert.ok(!h.calls.some(c => c.startsWith('lfRun')));
  // Nothing more happens on a later tab event.
  const n = h.calls.length;
  await A.apOnTabChange(h.deps, 7);
  assert.equal(h.calls.length, n);
});

test('back on a finished page with nothing to click → stop with "MCA went back to …"', async () => {
  const h = harness();
  h.page.afterP2 = 'page1';
  let n = 0;
  h.page.forward = prefer => {
    n++;
    if (n === 1) { h.page.step = 'Attachment & Declaration'; return { clicked: true, label: 'Next', seen: ['Next'] }; }
    if (n === 2) { h.page.step = 'Company details'; return { clicked: true, label: 'Proceed', seen: ['Proceed'] }; }
    return { clicked: false, label: '', reason: 'none', seen: ['Previous', 'Save'] };
  };
  const res = await A.apRun(h.deps);
  assert.ok(n >= 3); // the side panel probes again for the button (Stop is checked between probes) before giving up
  assert.equal(res.armed, false);
  assert.match(res.you, /^MCA went back to AOC-4 page 1/);
  assert.equal(stateOf(res, 'aoc4p1'), 'done');
  assert.equal(stateOf(res, 'aoc4p2'), 'done');
});

test('Review & Submit with a Proceed button: Proceed is clicked and the linked forms run', async () => {
  const h = harness();
  h.page.step = 'Review & Submit';
  h.page.reviewProceed = URL_AOC2;
  const res = await A.apRun(h.deps);
  assert.equal(stateOf(res, 'aoc4p1'), 'skipped');
  assert.equal(stateOf(res, 'aoc4p2'), 'skipped');
  assert.ok(!h.calls.includes('startRun') && !h.calls.includes('step2Run') && !h.calls.includes('preflightQuestions'));
  assert.deepEqual(h.forwards, ['Proceed']);
  assert.equal(stateOf(res, 'finish'), 'waiting');
});

test('Review & Submit with only Submit: the CA clicks it; the watcher continues on the linked form', async () => {
  const h = harness();
  h.page.step = 'Review & Submit';
  let res = await A.apRun(h.deps);
  assert.equal(res.armed, true);
  assert.equal(res.waitingFor, 'submit');
  assert.equal(res.you, 'MCA shows only Submit on AOC-4 Review. Click it yourself; the autopilot continues on the next form.');
  assert.ok(h.forwards.length >= 1 && h.forwards.every(f => f === 'Proceed')); // probed for Proceed only, never Submit
  await h.tick(); // the page has not changed: nothing happens
  assert.ok(!h.calls.some(c => c.startsWith('lfRun')));
  h.tab.url = URL_AOC2; // the CA submitted; MCA opened AOC-2 (no tab event needed)
  await h.tick();
  res = A.apOnTabChange(h.deps, 7);
  res = await res;
  for (const id of ['aoc2', 'eauditor', 'eboard']) assert.equal(stateOf(res, id), 'done');
  assert.equal(stateOf(res, 'finish'), 'waiting');
  noSubmit(h.calls);
});

test('page 2 Proceed: MCA does not move or shows errors → saved, the CA is told, the run keeps watching', async () => {
  const h = harness();
  h.page.forward = prefer => {
    if (prefer.includes('Next') && /company/i.test(h.page.step)) { h.page.step = 'Attachment & Declaration'; return { clicked: true, label: 'Next', seen: [] }; }
    return { clicked: true, label: 'Proceed', seen: ['Previous', 'Save', 'Proceed'] }; // MCA stays on page 2
  };
  let res = await A.apRun(h.deps);
  assert.equal(stateOf(res, 'aoc4p2'), 'warn');
  assert.match(detailOf(res, 'aoc4p2'), /Proceed was clicked, but MCA did not move/);
  assert.equal(res.armed, true); assert.equal(res.waitingFor, 'next');
  assert.match(res.you, /AOC-4 page 2 is saved, but Proceed was clicked, but MCA did not move/);
  // MCA moves on later (slow server): the page watcher sees it and the linked forms run.
  h.tab.url = URL_AOC2;
  await h.tick();
  res = await A.apOnTabChange(h.deps, 7);
  assert.equal(stateOf(res, 'finish'), 'waiting');

  A.apReset();
  const e = harness();
  e.page.forward = prefer => (prefer.includes('Next') && /company/i.test(e.page.step)
    ? (e.page.step = 'Attachment & Declaration', { clicked: true, label: 'Next', seen: [] })
    : { clicked: false, label: '', reason: 'field-errors', errors: ['Membership number is required'], seen: ['Proceed'] });
  res = await A.apRun(e.deps);
  assert.match(res.you, /MCA shows: Membership number is required/);
  assert.equal(res.waitingFor, 'next');
});

test('a second page of the same linked form is filled once more, then the run goes on', async () => {
  const h = harness();
  h.page.afterP2 = URL_AOC2;
  let aoc2Runs = 0;
  const base = h.deps.lfRun;
  h.deps.lfRun = async opts => {
    if (/form-aoc2/.test(h.tab.url) && aoc2Runs++ === 0) {
      h.calls.push('lfRun:aoc2');
      h.page.linked = 'Part B — details of contracts'; // Proceed opened the form's next page, same URL
      return { state: 'warn', form: 'aoc2', proceeded: false, note: 'clicked — the page did not move; check MCA' };
    }
    return base(opts);
  };
  h.deps.lfSteps = () => [{ id: 'fill', detail: '4 filled · 0 skipped · 0 failed' }];
  const res = await A.apRun(h.deps);
  assert.equal(h.calls.filter(c => c === 'lfRun:aoc2').length, 2);
  assert.equal(stateOf(res, 'aoc2'), 'done');
  assert.match(detailOf(res, 'aoc2'), /pages: 4 filled · 0 failed \/ 4 filled · 0 failed/);
  assert.equal(stateOf(res, 'finish'), 'waiting');
});

test('linked form detail shows "N filled · M failed" from the linked runner', async () => {
  const h = harness();
  h.tab.url = URL_BOARD;
  h.deps.lfSteps = () => [{ id: 'fill', detail: '9 filled · 2 skipped · 1 failed' }];
  h.deps.lfRun = async () => ({ state: 'warn', form: 'eboard', proceeded: false, note: 'Saved' });
  const res = await A.apRun(h.deps);
  assert.equal(detailOf(res, 'eboard'), 'Saved · 9 filled · 1 failed');
});

test('certificate details: asked once, saved with the company and firm-wide, then remembered for every company', async () => {
  const asks = [];
  const h = harness({
    ask: async groups => {
      asks.push(groups.map(g => [g.id, g.missing.map(m => m.key)]));
      return { action: 'save', raw: { cert: { ...CERT } } };
    },
  });
  delete h.store[A.AP_CERT_KEY];
  let res = await A.apRun(h.deps);
  assert.deepEqual(asks, [[['cert', ['CERT_PROFESSION', 'CERT_ASSOC_FELLOW', 'CERT_MEMBERSHIP_NO', 'CERT_COP_NO']]]]);
  assert.deepEqual(h.store[A.AP_CERT_KEY], CERT, 'kept firm-wide');
  assert.deepEqual(h.deps.saved.aoc4.map(x => x.key), ['CERT_PROFESSION', 'CERT_ASSOC_FELLOW', 'CERT_MEMBERSHIP_NO', 'CERT_COP_NO'], 'and with the company (formType aoc4)');
  assert.deepEqual(h.deps.lastStep2.certificate, CERT);
  assert.equal(stateOf(res, 'check'), 'done');

  // Another company: nothing asked, the remembered details are used.
  A.apReset();
  const other = harness({ cin: () => 'U01100KA2019PTC000002', ask: async () => { asks.push('again'); return { action: 'stop' }; } });
  other.store[A.AP_CERT_KEY] = h.store[A.AP_CERT_KEY];
  res = await A.apRun(other.deps);
  assert.equal(asks.length, 1, 'not asked again');
  assert.deepEqual(other.deps.lastStep2.certificate, CERT);

  // Only the company master has them: no question, and the firm-wide copy is filled from it.
  A.apReset();
  const fromCompany = harness({ lfFetchAnswers: async (cin, form) => (form.answersForm === 'aoc4' ? { ...CERT, DECL_DIN: '07654321' } : {}),
    ask: async () => { asks.push('company'); return { action: 'stop' }; } });
  delete fromCompany.store[A.AP_CERT_KEY];
  await A.apRun(fromCompany.deps);
  assert.equal(asks.length, 1);
  assert.deepEqual(fromCompany.store[A.AP_CERT_KEY], CERT);
  assert.deepEqual(fromCompany.deps.lastStep2.certificate, CERT);
});

test('page 1 status mirrors the phase runner timeline while it runs', async () => {
  const h = harness();
  const seen = [];
  h.deps.startRun = async () => {
    h.calls.push('startRun');
    assert.equal(typeof h.deps.timelineCb, 'function', 'the timeline is hooked while page 1 runs');
    h.deps.timelineCb('setActive', ['phase3_6', 'Phase 3: starting…'], {});
    seen.push(A.AP.stages.find(s => s.id === 'aoc4p1').detail);
    h.deps.timelineCb('note', ['Phase 3: saving…'], { activeStep: () => 'phase3_6' });
    seen.push(A.AP.stages.find(s => s.id === 'aoc4p1').detail);
    return { ok: true, completedAll: true, notSaved: [], issues: [] };
  };
  await A.apRun(h.deps);
  assert.deepEqual(seen, ['Phase 3 of 7 — Balance sheet: starting…', 'Phase 3 of 7 — Balance sheet: saving…']);
  assert.equal(h.deps.timelineCb, null, 'unhooked afterwards');
});

test('apHookTimeline wraps window.Timeline non-destructively and restores it', () => {
  const calls = [];
  const T = { setActive(id, sub) { calls.push(['orig', id, sub]); return 'r'; }, note(t) { calls.push(['note', t]); }, activeStep: () => 'phase7' };
  const origSet = T.setActive;
  const saved = globalThis.Timeline;
  globalThis.Timeline = T;
  try {
    const unhook = A.apHookTimeline((m, args) => calls.push(['cb', m, ...args]));
    assert.equal(T.setActive('phase1', 'x'), 'r');
    T.note('y');
    assert.deepEqual(calls, [['orig', 'phase1', 'x'], ['cb', 'setActive', 'phase1', 'x'], ['note', 'y'], ['cb', 'note', 'y']]);
    unhook();
    assert.equal(T.setActive, origSet);
  } finally { if (saved === undefined) delete globalThis.Timeline; else globalThis.Timeline = saved; }
});

test('page 1 failure stops the run before page 2', async () => {
  const h = harness({ startRun: async () => { return { ok: false, completedAll: false, notSaved: [], issues: [], reason: 'validation', stoppedAt: 3 }; } });
  const res = await A.apRun(h.deps);
  assert.equal(stateOf(res, 'aoc4p1'), 'error');
  assert.match(detailOf(res, 'aoc4p1'), /validation/);
  assert.equal(stateOf(res, 'aoc4p2'), 'pending');
  assert.equal(res.armed, false);
  assert.ok(!h.calls.includes('step2Run'));
  assert.deepEqual(h.forwards, [], 'no Next after a failed page 1');
  assert.ok(h.calls.includes('mark:phase1:error'));
});

test('Stop during page 2: nothing is clicked afterwards', async () => {
  const h = harness();
  let seen = null;
  h.deps.step2Run = async opts => {
    h.calls.push('step2Run');
    assert.equal(typeof opts.shouldStop, 'function', 'step2Run gets the stop hook');
    assert.equal(opts.shouldStop(), false);
    await A.apStop();
    seen = opts.shouldStop(); // step2Run checks it before every upload, field and the Save click
    return { ok: true, saved: true, items: [] };
  };
  const res = await A.apRun(h.deps);
  assert.equal(seen, true, 'shouldStop is true after Stop');
  assert.equal(stateOf(res, 'aoc4p2'), 'warn');
  assert.match(detailOf(res, 'aoc4p2'), /stopped by you/);
  assert.equal(res.armed, false);
  assert.deepEqual(h.forwards, ['Next'], 'no Proceed after Stop');
  const after = h.calls.length;
  h.page.step = 'Attachment & Declaration';
  await A.apOnTabChange(h.deps, 7);
  assert.equal(h.calls.length, after);
});

test('Stop while page 1 runs asks the fill to stop', async () => {
  const h = harness();
  h.deps.startRun = async () => { h.calls.push('startRun'); await A.apStop(); return { ok: false, reason: 'stopped' }; };
  const res = await A.apRun(h.deps);
  assert.ok(h.calls.includes('requestFillStop'));
  assert.equal(stateOf(res, 'aoc4p1'), 'warn');
  assert.ok(!h.calls.includes('step2Run'));
});

test('Stop while waiting for MCA to move after Next: nothing more is done', async () => {
  const h = harness();
  h.page.forward = () => ({ clicked: true, label: 'Next', seen: ['Next'] }); // MCA is slow to move
  let stops = 0;
  h.deps.sleep = async () => { if (!stops++) await A.apStop(); };
  const res = await A.apRun(h.deps);
  assert.equal(stops > 0, true);
  assert.equal(res.armed, false); assert.equal(res.waitingFor, 'stopped');
  assert.equal(stateOf(res, 'aoc4p1'), 'warn');
  assert.ok(!h.calls.includes('step2Run'));
  assert.equal(h.forwards.length, 1);
});

test('session timeout: login page → waiting, then resumes on the linked form', async () => {
  const h = harness();
  await A.apRun(h.deps);
  h.tab.url = URL_LOGIN;
  let res = await A.apOnTabChange(h.deps, 7);
  assert.equal(res.waitingFor, 'login');
  assert.match(res.you, /Log in again/);
  assert.equal(res.armed, true);
  assert.ok(!h.calls.some(c => c.startsWith('lfRun')));
  h.tab.url = URL_AUD; // MCA skipped AOC-2 for this company
  res = await A.apOnTabChange(h.deps, 7);
  assert.equal(stateOf(res, 'eauditor'), 'done');
  assert.equal(stateOf(res, 'eboard'), 'done');
  assert.equal(stateOf(res, 'aoc2'), 'skipped');
  assert.equal(stateOf(res, 'finish'), 'waiting');
});

test('unknown linked form (e.g. CSR-2) → waiting with a note, continues on the next known form', async () => {
  const h = harness();
  await A.apRun(h.deps);
  h.tab.url = URL_CSR;
  let res = await A.apOnTabChange(h.deps, 7);
  assert.equal(res.waitingFor, 'unknown');
  assert.match(res.you, /not automated/);
  assert.equal(res.armed, true);
  h.tab.url = URL_BOARD;
  res = await A.apOnTabChange(h.deps, 7);
  assert.equal(stateOf(res, 'eboard'), 'done');
  assert.equal(stateOf(res, 'finish'), 'waiting');
});

test('linked form needing answers: asks for that form, stores them, reruns', async () => {
  const h = harness();
  let n = 0;
  h.deps.lfRun = async () => {
    h.calls.push('lfRun');
    if (n++ === 0) return { state: 'needs-answers', proceeded: false, note: '', missing: [{ key: 'CM_COUNT', label: 'Committee meetings', type: 'number' }] };
    return { state: 'done', proceeded: false, note: 'Saved' };
  };
  h.deps.ask = async groups => { h.calls.push('ask:' + groups.map(g => g.id).join('+')); return { action: 'save', raw: { eboard: { CM_COUNT: '4' } } }; };
  await A.apRun(h.deps);
  h.tab.url = URL_BOARD;
  const res = await A.apOnTabChange(h.deps, 7);
  assert.ok(h.calls.includes('ask:eboard'));
  assert.deepEqual(h.deps.saved, { eboard: [{ key: 'CM_COUNT', label: 'Committee meetings', value: '4' }] });
  assert.equal(h.calls.filter(c => c === 'lfRun').length, 2);
  assert.equal(stateOf(res, 'finish'), 'waiting');
});

test('starting on a linked form skips the AOC-4 stages', async () => {
  const h = harness();
  h.tab.url = URL_AOC2;
  const res = await A.apRun(h.deps);
  for (const id of ['aoc4p1', 'aoc4p2']) assert.equal(stateOf(res, id), 'skipped');
  assert.ok(!h.calls.includes('preflightQuestions') && !h.calls.includes('startRun'));
  assert.equal(stateOf(res, 'finish'), 'waiting');
});

test('a form page the autopilot cannot run (CSR-2) or MCA cannot be opened → check error, not armed, nothing navigated', async () => {
  let h = harness();
  h.tab.url = URL_CSR;
  let res = await A.apRun(h.deps);
  assert.equal(stateOf(res, 'check'), 'error');
  assert.match(res.stages[0].detail, /Open the AOC-4 form/);
  assert.equal(res.armed, false);
  assert.ok(!h.chromeCalls.some(c => c[0] === 'navigate' || c[0] === 'create'), 'a form page (the user’s draft) is never navigated');
  A.apReset();
  h = harness({ createLoginTab: async () => { throw new Error('blocked'); } });
  h.mca.none = true;
  res = await A.apRun(h.deps);
  assert.equal(stateOf(res, 'check'), 'error');
  assert.match(res.you, /Open mca\.gov\.in yourself/);
  assert.equal(res.armed, false);
});

// ── Run everything from outside MCA: open MCA / wait for the user's login / open AOC-4 ──

test('no MCA tab anywhere: opens one login tab, waits for the login, then opens AOC-4 and runs', async () => {
  const h = harness();
  h.mca.none = true;
  h.mca.loggedIn = false;
  h.mca.loginAfter = 3;
  const seen = [];
  h.mca.onWait = () => { seen.push({ you: A.AP.you, check: A.AP.stages[0].state, waitingFor: A.AP.waitingFor, ran: h.calls.includes('startRun') }); };
  const res = await A.apRun(h.deps);
  assert.deepEqual(h.chromeCalls, [['create', A.AP_LOGIN_URL], ['navigate', 7, A.AP_FORM_URL]]);
  assert.equal(A.AP_LOGIN_URL, URL_LOGIN);
  assert.equal(A.AP_FORM_URL, URL_AOC4);
  assert.equal(seen.length, 3, 'polled until the user had logged in');
  assert.equal(seen[0].you, 'MCA is opening. Log in yourself (user ID, password, OTP, captcha). The autopilot opens AOC-4 and carries on as soon as you are logged in.');
  assert.equal(seen[0].check, 'waiting');
  assert.equal(seen[0].waitingFor, 'mcaLogin');
  assert.ok(seen.every(x => !x.ran), 'page 1 runs only after the login');
  assert.equal(stateOf(res, 'check'), 'done');
  assert.equal(stateOf(res, 'aoc4p1'), 'done');
  assert.equal(stateOf(res, 'aoc4p2'), 'done');
  assert.equal(res.waitingFor, 'submit');
  noSubmit(h.calls);
});

test('an MCA tab in another window on the form: focused and used, nothing opened or navigated', async () => {
  const h = harness();
  h.tab.windowId = 2;
  const res = await A.apRun(h.deps);
  assert.deepEqual(h.chromeCalls, [['focus', 7, 2]]);
  assert.equal(stateOf(res, 'aoc4p1'), 'done');
  assert.equal(A.AP.windowId, 2);
});

test('an MCA tab in another window on the home page (logged in): focused, sent to AOC-4, never a second tab', async () => {
  const h = harness();
  h.tab.url = URL_HOME; h.tab.windowId = 2;
  h.deps.getActiveMcaTab = async () => (A.apIsFormUrl(h.tab.url) ? { ...h.tab } : null); // the active tab is not MCA
  const res = await A.apRun(h.deps);
  assert.deepEqual(h.chromeCalls, [['focus', 7, 2], ['navigate', 7, A.AP_FORM_URL]]);
  assert.equal(stateOf(res, 'aoc4p1'), 'done');
});

test('the MCA tab is on the login page: waits for the login, then opens AOC-4', async () => {
  const h = harness();
  h.tab.url = URL_LOGIN;
  h.mca.loggedIn = false;
  const seen = [];
  h.mca.onWait = () => { seen.push(A.AP.you); assert.ok(!h.chromeCalls.some(c => c[0] === 'navigate'), 'nothing navigates before the login'); };
  const res = await A.apRun(h.deps);
  assert.equal(seen.length, 2);
  assert.match(seen[0], /^MCA shows its login page\. Log in yourself \(user ID, password, OTP, captcha\)/);
  assert.deepEqual(h.chromeCalls, [['focus', 7, 1], ['navigate', 7, A.AP_FORM_URL]]);
  assert.equal(stateOf(res, 'aoc4p1'), 'done');
});

test('a logged-out MCA page with a Login button: shown the login page, waits, then AOC-4', async () => {
  const h = harness();
  h.tab.url = URL_HOME;
  h.mca.loggedIn = false; h.mca.loginLink = true;
  const res = await A.apRun(h.deps);
  assert.deepEqual(h.chromeCalls, [['focus', 7, 1], ['navigate', 7, A.AP_LOGIN_URL], ['navigate', 7, A.AP_FORM_URL]]);
  assert.equal(stateOf(res, 'aoc4p1'), 'done');
});

test('AOC-4 already open but its wizard still loading: waited for, never navigated', async () => {
  const h = harness();
  h.page.step = '';
  h.mca.lateStep = 'Company details';
  const res = await A.apRun(h.deps);
  assert.ok(!h.chromeCalls.some(c => c[0] === 'navigate' || c[0] === 'create'));
  assert.equal(stateOf(res, 'aoc4p1'), 'done');
});

test('Stop while waiting for the login: nothing navigates, nothing runs', async () => {
  const h = harness();
  h.mca.none = true; h.mca.loggedIn = false; h.mca.loginAfter = 99;
  let waits = 0;
  h.mca.onWait = async () => { if (++waits === 2) await A.apStop(h.deps); };
  const res = await A.apRun(h.deps);
  assert.deepEqual(h.chromeCalls, [['create', A.AP_LOGIN_URL]]);
  assert.equal(res.armed, false);
  assert.equal(res.waitingFor, 'stopped');
  assert.equal(stateOf(res, 'check'), 'warn');
  assert.ok(!h.calls.includes('startRun') && !h.calls.includes('preflightQuestions'));
  // The user logs in afterwards: still nothing happens.
  h.tab.url = URL_HOME; h.mca.loggedIn = true;
  await A.apOnTabChange(h.deps, 7);
  assert.ok(!h.chromeCalls.some(c => c[0] === 'navigate'));
});

test('never two login tabs: a second Run reuses the tab the first one opened', async () => {
  const h = harness();
  h.mca.none = true; h.mca.loggedIn = false; h.mca.loginAfter = 99;
  let waits = 0;
  h.mca.onWait = async () => { if (++waits === 1) await A.apStop(h.deps); };
  await A.apRun(h.deps);
  // The login tab is still loading (a query finds no MCA address yet).
  h.deps.queryAllMcaTabs = async () => [];
  h.deps.getActiveMcaTab = async () => null;
  h.mca.loginAfter = 0; h.mca.onWait = null;
  const res = await A.apRun(h.deps);
  assert.equal(h.chromeCalls.filter(c => c[0] === 'create').length, 1);
  assert.deepEqual(h.chromeCalls.slice(1), [['focus', 7, 1], ['navigate', 7, A.AP_FORM_URL]]);
  assert.equal(stateOf(res, 'check'), 'done');
});

test('not logged in after 20 minutes: stops waiting with a message, nothing navigated', async () => {
  let clock = 1000000;
  const h = harness({ now: () => clock });
  h.tab.url = URL_LOGIN;
  h.mca.loggedIn = false; h.mca.loginAfter = 1e9;
  const sleep = h.deps.sleep;
  h.deps.sleep = async ms => { clock += ms; return sleep(ms); };
  const res = await A.apRun(h.deps);
  assert.equal(stateOf(res, 'check'), 'error');
  assert.match(res.you, /20 minutes/);
  assert.equal(res.armed, false);
  assert.ok(h.mca.waits <= 400 && h.mca.waits >= 399, String(h.mca.waits));
  assert.ok(!h.chromeCalls.some(c => c[0] === 'navigate'));
});

test('session ends mid-run and the user logs in again on the home page: told to reopen the draft, no new form opened', async () => {
  const h = harness();
  await A.apRun(h.deps);
  h.tab.url = URL_LOGIN;
  let res = await A.apOnTabChange(h.deps, 7);
  assert.equal(res.waitingFor, 'login');
  h.tab.url = URL_HOME;
  res = await A.apOnTabChange(h.deps, 7);
  assert.equal(res.waitingFor, 'reopen');
  assert.match(res.you, /My Application/);
  assert.equal(res.armed, true);
  assert.ok(!h.chromeCalls.some(c => c[0] === 'navigate' || c[0] === 'create'));
  h.tab.url = URL_BOARD; // the CA reopened the draft and MCA shows the Board's report
  res = await A.apOnTabChange(h.deps, 7);
  assert.equal(stateOf(res, 'eboard'), 'done');
});

test('session ends mid-run, re-login on the home page, then Run everything: no fresh AOC-4 is opened', async () => {
  const h = harness();
  await A.apRun(h.deps);
  h.tab.url = URL_LOGIN;
  await A.apOnTabChange(h.deps, 7);
  h.tab.url = URL_HOME;
  let res = await A.apOnTabChange(h.deps, 7);
  assert.equal(res.waitingFor, 'reopen');
  res = await A.apRun(h.deps);
  assert.ok(!h.chromeCalls.some(c => c[0] === 'navigate' || c[0] === 'create'), JSON.stringify(h.chromeCalls));
  assert.equal(res.waitingFor, 'reopen');
  assert.match(res.you, /My Application/);
  assert.equal(stateOf(res, 'check'), 'warn');
  // Pressed again (still on home): still no new form.
  res = await A.apRun(h.deps);
  assert.ok(!h.chromeCalls.some(c => c[0] === 'navigate'));
  assert.equal(res.waitingFor, 'reopen');
  // The CA reopens the draft (page 2 already saved) and presses Run: it carries on from there.
  h.tab.url = URL_AOC4; h.page.step = 'Attachment & Declaration';
  res = await A.apRun(h.deps);
  assert.ok(!h.chromeCalls.some(c => c[0] === 'navigate'));
  assert.equal(stateOf(res, 'aoc4p1'), 'skipped');
});

test('page 1 saved earlier (also after the side panel reopened), CA on the home page, Run: no fresh AOC-4', async () => {
  const h = harness();
  await A.apRun(h.deps);
  assert.equal(A.AP.stages.find(s => s.id === 'aoc4p1').state, 'done');
  await A.apStop(h.deps);
  h.tab.url = URL_HOME;
  let res = await A.apRun(h.deps);
  assert.ok(!h.chromeCalls.some(c => c[0] === 'navigate'), JSON.stringify(h.chromeCalls));
  assert.equal(res.waitingFor, 'reopen');
  // Side panel closed and reopened (nothing in memory): the stored state of the same company still counts.
  A.apReset();
  h.store[A.AP_KEY].waitingFor = 'stopped';
  h.store[A.AP_KEY].stages.aoc4p1 = { state: 'done' };
  res = await A.apRun(h.deps);
  assert.ok(!h.chromeCalls.some(c => c[0] === 'navigate'));
  assert.equal(res.waitingFor, 'reopen');
  // Another company: its first run opens AOC-4 as usual.
  A.apReset();
  const o = harness({ cin: () => 'U01100KA2019PTC000002' });
  o.store[A.AP_KEY] = h.store[A.AP_KEY];
  o.tab.url = URL_HOME;
  await A.apRun(o.deps);
  assert.deepEqual(o.chromeCalls.filter(c => c[0] === 'navigate'), [['navigate', 7, A.AP_FORM_URL]]);
});

test('a draft still loading (url = home, pendingUrl = AOC-4): waited for, never navigated', async () => {
  const h = harness();
  h.tab.url = URL_HOME; h.tab.status = 'loading'; h.tab.pendingUrl = URL_AOC4 + '?draft=1';
  h.deps.getActiveMcaTab = async () => (A.apIsFormUrl(h.tab.url) ? { ...h.tab } : null); // the active tab is not MCA yet
  const sleep = h.deps.sleep;
  h.deps.sleep = async ms => {
    if (ms === 1000 && h.tab.status === 'loading') { h.tab.url = h.tab.pendingUrl; delete h.tab.pendingUrl; h.tab.status = 'complete'; }
    return sleep(ms);
  };
  const res = await A.apRun(h.deps);
  assert.ok(!h.chromeCalls.some(c => c[0] === 'navigate' || c[0] === 'create'), JSON.stringify(h.chromeCalls));
  assert.equal(stateOf(res, 'aoc4p1'), 'done');
  // Ranking sees the pending form address too.
  assert.deepEqual(A.apRankMcaTabs([{ id: 1, url: URL_HOME }, { id: 2, url: URL_HOME, pendingUrl: URL_AOC4 }], plainForms(), 1).map(t => t.id), [2, 1]);
});

test('"Login" shown for a moment while MCA fills in its header: not sent to the login page', async () => {
  const h = harness();
  h.tab.url = URL_HOME;
  let n = 0;
  const exec = h.deps.exec;
  h.deps.exec = async (id, func, args) => {
    if (func.name === 'pageApLoginState') return ++n === 1 ? { loggedIn: false, onLoginPage: false, loginLink: true } : { loggedIn: true, onLoginPage: false, loginLink: false, name: 'DEMO' };
    return exec(id, func, args);
  };
  const res = await A.apRun(h.deps);
  assert.deepEqual(h.chromeCalls, [['focus', 7, 1], ['navigate', 7, A.AP_FORM_URL]]);
  assert.equal(stateOf(res, 'aoc4p1'), 'done');
});

test('restore while the run was waiting for the MCA login: told to log in and press Run, not a silent wait', async () => {
  const h = harness();
  const stages = Object.fromEntries(A.apStagesInit().map(s => [s.id, { state: 'pending', detail: '', ms: null }]));
  stages.check = { state: 'waiting', detail: 'waiting for you to log in to MCA…' };
  h.store[A.AP_KEY] = { armed: false, cin: CIN, stages, waitingFor: 'mcaLogin', tabId: 7, updatedAt: Date.now() - 1000, you: A.AP_YOU.opening };
  assert.equal(await A.apRestore(h.deps), true);
  assert.equal(A.AP.armed, false);
  assert.equal(A.AP.waitingFor, 'fix');
  assert.equal(A.AP.stages[0].state, 'warn');
  assert.match(A.AP.stages[0].detail, /interrupted/);
  assert.match(A.AP.you, /Log in on the MCA tab, then press Run everything/);
  assert.equal(A.apShouldNudge(), false);
});

test('tab helpers: form pages, any MCA address, ranking (form first, login last)', () => {
  const F = plainForms();
  assert.ok(A.apIsFormUrl(URL_AOC4, F) && A.apIsFormUrl(URL_AUD, F) && A.apIsFormUrl(URL_CSR, F));
  assert.ok(!A.apIsFormUrl(URL_HOME, F) && !A.apIsFormUrl(URL_LOGIN, F) && !A.apIsFormUrl('https://evil.example/form-aoc4.html', F));
  assert.ok(A.apIsMcaAny('http://mca.gov.in/') && A.apIsMcaAny(URL_HOME) && !A.apIsMcaAny('https://mca.gov.in.evil.example/'));
  const tabs = [{ id: 1, url: URL_LOGIN, active: true }, { id: 2, url: URL_HOME }, { id: 3, url: URL_AOC4 }, { id: 4, url: 'https://example.com/' }];
  assert.deepEqual(A.apRankMcaTabs(tabs, F, null).map(t => t.id), [3, 2, 1]);
  assert.deepEqual(A.apRankMcaTabs([{ id: 5, pendingUrl: URL_LOGIN }], F, null).map(t => t.id), [5]);
  // A form the autopilot cannot run (CSR-2 in another window) never beats a usable tab, but ranks above login.
  assert.deepEqual(A.apRankMcaTabs([{ id: 1, url: URL_CSR, active: true }, { id: 2, url: URL_HOME }], F, 2).map(t => t.id), [2, 1]);
  assert.deepEqual(A.apRankMcaTabs([{ id: 1, url: URL_CSR }, { id: 2, url: URL_HOME }], F, null).map(t => t.id), [2, 1]);
  assert.deepEqual(A.apRankMcaTabs([{ id: 1, url: URL_LOGIN, active: true }, { id: 2, url: URL_CSR }], F, null).map(t => t.id), [2, 1]);
});

test('pageApLoginState: "Hello <NAME>" or Logout = logged in; never on the login page; reads no inputs', () => {
  const el = (text, tag = 'SPAN', shown = true) => ({ innerText: text, tagName: tag, getClientRects: () => (shown ? [1] : []) });
  const run = (href, els) => {
    const saved = { document: globalThis.document, location: globalThis.location };
    const selectors = [];
    globalThis.document = { querySelectorAll: sel => { selectors.push(sel); return els; } };
    globalThis.location = { href };
    try { return { r: A.pageApLoginState(), selectors }; } finally {
      if (saved.document === undefined) delete globalThis.document; else globalThis.document = saved.document;
      if (saved.location === undefined) delete globalThis.location; else globalThis.location = saved.location;
    }
  };
  const o = run(URL_HOME, [el('Hello DEMO USER', 'BUTTON'), el('Home', 'A')]);
  assert.deepEqual(o.r, { loggedIn: true, onLoginPage: false, loginLink: false, name: 'DEMO USER' });
  assert.ok(!o.selectors.some(s => /input/i.test(s)), 'no inputs are read');
  assert.equal(run(URL_HOME, [el('Logout', 'A')]).r.loggedIn, true);
  assert.equal(run(URL_HOME, [el('Hello DEMO USER', 'BUTTON', false)]).r.loggedIn, false, 'hidden text does not count');
  assert.deepEqual(run(URL_HOME, [el('Login', 'A')]).r, { loggedIn: false, onLoginPage: false, loginLink: true });
  assert.equal(run(URL_LOGIN, [el('Hello DEMO USER')]).r.loggedIn, false);
  assert.equal(run(URL_LOGIN, []).r.onLoginPage, true);
});

test('restore from storage: same company, recent → list back and watching again (an old "review" entry is ignored)', async () => {
  const h = harness();
  const stages = Object.fromEntries(A.apStagesInit().map(s => [s.id, { state: 'pending', detail: '', ms: null }]));
  Object.assign(stages, { check: { state: 'done', detail: 'ok', ms: 900 }, aoc4p1: { state: 'done', ms: 60000 }, aoc4p2: { state: 'done', ms: 30000 }, review: { state: 'waiting', detail: 'waiting for your Submit' } });
  h.store[A.AP_KEY] = { armed: true, cin: CIN, stages, waitingFor: 'submit', tabId: 7, updatedAt: Date.now() - 60000, you: 'x' };
  assert.equal(await A.apRestore(h.deps), true);
  assert.equal(A.AP.armed, true);
  assert.ok(h.calls.includes('watch'));
  assert.ok(!A.AP.stages.some(s => s.id === 'review'));
  assert.equal(A.AP.stages.find(s => s.id === 'aoc4p1').ms, 60000);
  h.tab.url = URL_BOARD;
  const res = await A.apOnTabChange(h.deps, 7);
  assert.equal(stateOf(res, 'finish'), 'waiting');

  A.apReset();
  const old = harness();
  old.store[A.AP_KEY] = { armed: true, cin: CIN, stages, updatedAt: Date.now() - 7 * 3600 * 1000 };
  assert.equal(await A.apRestore(old.deps), false);
  A.apReset();
  const other = harness({ cin: () => 'U01100KA2019PTC000002' });
  other.store[A.AP_KEY] = { armed: true, cin: CIN, stages, updatedAt: Date.now() };
  assert.equal(await A.apRestore(other.deps), false);
  assert.equal(A.AP.armed, false);
});

test('linked panel Stop (lfRun → stopped) stops the autopilot: no rerun on the next tab event', async () => {
  const h = harness();
  await A.apRun(h.deps);
  h.deps.lfRun = async () => { h.calls.push('lfRun'); return { state: 'stopped', form: 'aoc2', proceeded: false, note: 'Stopped' }; };
  h.tab.url = URL_AOC2;
  let res = await A.apOnTabChange(h.deps, 7);
  assert.equal(stateOf(res, 'aoc2'), 'warn');
  assert.match(detailOf(res, 'aoc2'), /stopped by you/);
  assert.equal(res.armed, false); assert.equal(res.waitingFor, 'stopped');
  res = await A.apOnTabChange(h.deps, 7);
  assert.equal(h.calls.filter(c => c === 'lfRun').length, 1, 'lfRun is not called again after the Stop');
});

test('linked forms get this run’s answers; an offline company master never means asking again', async () => {
  const h = harness();
  await A.apRun(h.deps);
  const seen = [];
  h.deps.lfRun = async opts => {
    seen.push(opts.answers || null);
    return { state: 'needs-answers', proceeded: false, note: '', missing: [{ key: 'CM_COUNT', label: 'Committee meetings', type: 'number' }] };
  };
  let asks = 0;
  h.deps.ask = async () => { asks++; return { action: 'save', raw: { eboard: { CM_COUNT: '4' } } }; };
  h.deps.lfSaveAnswers = async byForm => Object.keys(byForm); // backend offline: nothing stored
  h.tab.url = URL_BOARD;
  const res = await A.apOnTabChange(h.deps, 7);
  assert.equal(asks, 1, 'asked once only');
  assert.equal(seen.length, 2);
  assert.deepEqual(seen[1], { CM_COUNT: '4' }, 'the answer reaches lfRun directly');
  assert.equal(stateOf(res, 'eboard'), 'error');
  assert.match(res.you, /backend/);
});

test('Stop while the AOC-4 questions panel is open closes it (the run ends at once)', async () => {
  const h = harness();
  h.deps.preflightQuestions = async () => { h.calls.push('preflightQuestions'); await A.apStop(); return { ok: false, reason: 'stopped' }; };
  const res = await A.apRun(h.deps);
  assert.ok(h.calls.includes('cancelPanels'));
  assert.equal(res.armed, false);
  assert.ok(!h.calls.includes('startRun'));
});

test('Reset while a stage runs: the old loop stops and a new run cannot start alongside it', async () => {
  const h = harness();
  let release;
  h.deps.step2Run = async () => { h.calls.push('step2Run'); await new Promise(r => { release = r; }); return { ok: true, saved: true, items: [] }; };
  const first = A.apRun(h.deps);
  for (let i = 0; !release && i < 500; i++) await new Promise(r => setTimeout(r, 1));
  assert.ok(release, 'page 2 is running');
  await A.apResetAll(h.deps);
  assert.deepEqual(await A.apRun(h.deps), { state: 'busy' }, 'no second run while the old stage is still on MCA');
  release();
  await first;
  assert.deepEqual(h.forwards, ['Next'], 'the old loop did nothing after Reset (no Proceed)');
  assert.equal(A.AP.running, false);
  assert.equal(h.calls.filter(c => c === 'step2Run').length, 1);
  h.deps.step2Run = async () => { h.page.step = 'Attachment & Declaration'; return { ok: true, saved: true, items: [] }; };
  const again = await A.apRun(h.deps);
  assert.equal(stateOf(again, 'aoc4p1'), 'skipped');
  assert.equal(again.waitingFor, 'submit');
});

test('MCA session ends during page 1 → waiting for login (still armed), then page 1 reruns', async () => {
  let n = 0;
  const h = harness({ startRun: async () => { h.calls.push('startRun'); return n++ === 0
    ? { ok: false, completedAll: false, notSaved: [], issues: [], reason: 'exception: MCA login/session expired before Save. Sign in again on the MCA tab.' }
    : { ok: true, completedAll: true, notSaved: [], issues: [] }; } });
  let res = await A.apRun(h.deps);
  assert.equal(stateOf(res, 'aoc4p1'), 'waiting');
  assert.equal(res.armed, true); assert.equal(res.waitingFor, 'login');
  assert.match(res.you, /Log in again/);
  res = await A.apOnTabChange(h.deps, 7);
  assert.equal(stateOf(res, 'aoc4p1'), 'done');
  assert.equal(stateOf(res, 'aoc4p2'), 'done');
  assert.equal(res.waitingFor, 'submit');
});

test('session ends during page 2 (tab on the login page) → waiting, not an error', async () => {
  const h = harness();
  h.deps.step2Run = async () => { h.tab.url = URL_LOGIN; return { ok: false, saved: false, items: [['err', 'Stopped: Cannot access contents of the page']], reason: 'exception: x' }; };
  const res = await A.apRun(h.deps);
  assert.equal(stateOf(res, 'aoc4p2'), 'waiting');
  assert.equal(res.armed, true); assert.equal(res.waitingFor, 'login');
});

test('Q12(c) hand step: page 1 waits, then carries on from Phase 3 by itself once MCA saved it', async () => {
  let n = 0;
  const h = harness();
  h.deps.startRun = async () => {
    h.calls.push('startRun@' + h.deps.phase);
    if (n++ === 0) { h.manual.armed = true; return { ok: false, completedAll: false, notSaved: [], issues: [], reason: 'manual-step', stoppedAt: 2 }; }
    return { ok: true, completedAll: true, notSaved: [], issues: [] };
  };
  let res = await A.apRun(h.deps);
  assert.equal(stateOf(res, 'aoc4p1'), 'waiting');
  assert.equal(res.armed, true); assert.equal(res.waitingFor, 'manual');
  assert.match(res.you, /Q12\(c\).*Phase 3/);
  assert.equal(h.deps.phase, 3);
  // A tab event while Q12(c) is still being filled: nothing runs.
  res = await A.apOnTabChange(h.deps, 7);
  assert.deepEqual(h.calls.filter(c => c.startsWith('startRun')), ['startRun@1']);
  await h.tick(); // the watcher sees the armed Save not clicked yet
  assert.deepEqual(h.calls.filter(c => c.startsWith('startRun')), ['startRun@1']);
  h.manual.completed = true; // MCA's Save for Q12(c) clicked itself
  await h.tick();
  assert.deepEqual(h.calls.filter(c => c.startsWith('startRun')), ['startRun@1', 'startRun@3']);
  res = await A.apOnTabChange(h.deps, 7); // the watcher already ran page 1 → page 2 → Review; this only reads the state
  assert.equal(stateOf(res, 'aoc4p1'), 'done');
  assert.match(detailOf(res, 'aoc4p1'), /resumed from Phase 3/);
  assert.equal(stateOf(res, 'aoc4p2'), 'done');
  assert.equal(res.waitingFor, 'submit');
});

test('fill reasons read as words; refused sections are named', () => {
  assert.match(A.apFillWhy({ reason: 'manual-step' }), /Q12\(c\)/);
  assert.match(A.apFillWhy({ reason: 'phase-not-started' }), /could not start/);
  assert.match(A.apFillWhy({ reason: 'phase-missing' }), /definition/);
  assert.match(A.apFillWhy({ reason: 'not-saved' }), /did not confirm/);
  assert.equal(A.apFillWhy({ reason: 'not-saved', notSaved: ['Phase 3 — MCA shows: x'] }), 'not saved — Phase 3 — MCA shows: x');
  // Several sections with the same reason: one short line, and a greyed-out Save says what to do.
  const greyed = 'MCA’s Save button is greyed out (MCA is busy or has locked the form)';
  const w = A.apFillWhy({ reason: 'not-saved', notSaved: [`Phase 1 — Part A — ${greyed}`, `Phase 2 — Subsidiary — ${greyed}`] });
  assert.match(w, /^Phases 1, 2 not saved — MCA’s Save button is greyed out/);
  assert.match(w, /Reload the MCA page \(F5\)/);
  assert.equal(A.apFillWhy({ reason: 'not-saved', notSaved: ['Phase 1 — A — x', 'Phase 2 — B — y'] }), 'Phases 1, 2 not saved: Phase 1: x; Phase 2: y');
});

test('page 1 resumed from a later phase says so', async () => {
  const h = harness();
  h.deps.phase = 4;
  const res = await A.apRun(h.deps);
  assert.match(detailOf(res, 'aoc4p1'), /Phases 4–7 saved \(resumed from Phase 4\)/);
});

test('a linked form that failed is not reported as done when the CA comes back to it', async () => {
  const h = harness();
  await A.apRun(h.deps);
  h.deps.lfRun = async () => ({ state: 'error', form: 'aoc2', proceeded: false, note: 'MCA errors after Save' });
  h.tab.url = URL_AOC2;
  let res = await A.apOnTabChange(h.deps, 7);
  assert.equal(stateOf(res, 'aoc2'), 'error');
  res = await A.apOnTabChange(h.deps, 7);
  assert.doesNotMatch(res.you, /is done/);
  assert.match(res.you, /not saved cleanly \(MCA errors after Save\)/);
});

test('preflight: an invalid page-2 DIN or date is asked for before page 1 runs', () => {
  assert.deepEqual(A.apStep2Invalid({ resNo: '1', resDate: '31/02/2025', desig: 'Director', din: '1234' }).map(x => x.key), ['BOARD_RESOLUTION_DATE', 'DECL_DIN']);
  assert.deepEqual(A.apStep2Invalid({ resNo: '1', resDate: '2025-09-01', desig: 'Director', din: '07654321' }), []);
  assert.deepEqual(A.apStep2Invalid({ resNo: '1', resDate: '01/09/2025', desig: 'Company Secretary', din: 'A12345' }), []);
  const pre = A.apCollectPreflight({ client: {}, answersByForm: {}, forms: [], step2: { resNo: '1', resDate: '01/09/2025', desig: 'Director', din: '1234' } });
  assert.deepEqual(pre.groups.map(g => [g.id, g.missing.map(m => m.key)]), [['aoc4', ['DECL_DIN']]]);
  assert.equal(pre.groups[0].missing[0].default, '1234');
  assert.match(pre.groups[0].errors[0], /8 digits/);
});

test('run: an invalid DIN is fixed in the one ask box, then the run goes on', async () => {
  const asks = [];
  const h = harness({
    readStep2: () => ({ resNo: '1/2025', resDate: '01/09/2025', desig: 'Director', din: '1234' }),
    ask: async (groups, ctx) => { asks.push(groups); return { action: 'save', raw: { aoc4: { DECL_DIN: '07654321' } } }; },
  });
  const res = await A.apRun(h.deps);
  assert.equal(asks.length, 1);
  assert.deepEqual(asks[0][0].missing.map(m => m.key), ['DECL_DIN']);
  assert.equal(h.deps.step2Written.din, '07654321');
  assert.equal(stateOf(res, 'check'), 'done');
  assert.ok(h.calls.indexOf('startRun') > 0);
});

test('restore: an interrupted AOC-4 page is never restarted on its own; waiting runs resume', async () => {
  const h = harness();
  const stages = Object.fromEntries(A.apStagesInit().map(s => [s.id, { state: 'pending', detail: '', ms: null }]));
  Object.assign(stages, { check: { state: 'done', detail: 'ok', ms: 900 }, aoc4p1: { state: 'active', detail: 'filling', ms: 1000 } });
  h.store[A.AP_KEY] = { armed: true, cin: CIN, stages, waitingFor: '', tabId: 7, updatedAt: Date.now() - 1000 };
  assert.equal(await A.apRestore(h.deps), true);
  assert.equal(A.AP.stages.find(s => s.id === 'aoc4p1').state, 'warn');
  assert.equal(A.AP.armed, false);
  assert.equal(A.apShouldNudge(), false);
  assert.match(A.AP.you, /Press Run everything/);
  assert.ok(!h.calls.includes('watch'));

  A.apReset();
  const w = harness();
  w.store[A.AP_KEY] = { armed: true, cin: CIN, stages: { ...stages, aoc4p1: { state: 'done' }, aoc4p2: { state: 'done' }, review: { state: 'waiting' } }, waitingFor: 'submit', tabId: 7, updatedAt: Date.now() };
  assert.equal(await A.apRestore(w.deps), true);
  assert.equal(A.apShouldNudge(), true);
  A.apReset();
  const f = harness();
  f.store[A.AP_KEY] = { armed: true, cin: CIN, stages: { ...stages, aoc4p1: { state: 'done' }, aoc2: { state: 'error' } }, waitingFor: 'fix', tabId: 7, updatedAt: Date.now() };
  await A.apRestore(f.deps);
  assert.equal(A.apShouldNudge(), false, 'no immediate run after an error');
});

test('phase-runner: Stop is checked inside the retry / verify-fix loops and the required-field gate', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../js/phase-runner.js', import.meta.url), 'utf8');
  const body = (start, end) => { const i = src.indexOf(start); assert.ok(i >= 0, start); return src.slice(i, src.indexOf(end, i + start.length)); };
  assert.match(body('for (const idx of retryInteractiveIdxs) {', 'catch'), /if \(fillStopRequested\) break;/);
  assert.match(body('for (const fJob of fixInteractive) {', 'catch'), /if \(fillStopRequested\) break;/);
  assert.match(src, /if \(fixBatch\.length && !fillStopRequested\)/);
  assert.match(src, /if \(r\.reset\.length && !fillStopRequested\)/);
  const gate = body('async function requiredFieldGate(', '\nfunction toDDMMYYYY');
  assert.ok((gate.match(/if \(fillStopRequested\) return \{ ok: false, stopped: true/g) || []).length >= 4, 'gate checks Stop each round, after the panel and before every fill');
  const stopFn = body('async function requestFillStop() {', '\n}');
  assert.match(stopFn, /RequiredPanel\.close\(\)/);
  assert.match(stopFn, /FixPanel\.dismiss\(\)/);
  assert.match(readFileSync(new URL('../popup.js', import.meta.url), 'utf8'), /return \{ bind, show, hide, dismiss \}/);
});

test('tabs: only the login tab is ever created, a tab only ever goes to the login page or AOC-4; no submit click', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../js/autopilot.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n').replace(/^\s*\/\/.*$/gm, '');
  const fn = name => { const i = src.indexOf(name); assert.ok(i >= 0, name); return src.slice(i, src.indexOf('\n}', i)); };
  // Exactly one tab creation, on the MCA login page — and only from apGetToForm when no MCA tab exists.
  const creates = src.match(/tabs\.create\([^)]*\)/g) || [];
  assert.deepEqual(creates, ['tabs.create({ url: AP_LOGIN_URL, active: true })']);
  assert.equal((src.match(/d\.createLoginTab\(/g) || []).length, 1);
  const getTo = fn('async function apGetToForm(');
  assert.match(getTo, /if \(!tab\) \{\s*apStage\(d, 'check', 'active', 'no MCA tab is open[^\n]*\n\s*try \{ tab = await d\.createLoginTab\(\)/);
  assert.match(getTo, /AP\.createdTab != null/, 'a tab opened earlier is reused');
  // Every tabs.update either activates a tab or sends it to one of the two fixed addresses.
  const updates = src.match(/tabs\.update\([^;]*?\}\)/g) || [];
  assert.ok(updates.length >= 3, updates.join(' | '));
  for (const u of updates) assert.match(u, /\{ active: true \}|\{ url: AP_LOGIN_URL \}|\{ url: AP_FORM_URL \}/, u);
  assert.equal((src.match(/tabs\.update\(/g) || []).length, updates.length);
  assert.match(src, /const AP_LOGIN_URL = 'https:\/\/www\.mca\.gov\.in\/content\/mca\/global\/en\/foportal\/fologin\.html';/);
  assert.match(src, /const AP_FORM_URL = 'https:\/\/www\.mca\.gov\.in\/content\/mca\/global\/en\/mca\/e-filing\/annual-filings\/form-aoc4\.html';/);
  // Navigation only through apNavigate, which refuses other addresses and tabs that show a form.
  assert.equal((src.match(/d\.navigateTab\(/g) || []).length, 1);
  const nav = fn('async function apNavigate(');
  assert.match(nav, /if \(!apAllowedNav\(url\)\)/);
  assert.match(nav, /if \(\[cur && cur\.url, cur && cur\.pendingUrl, tab\.url, tab\.pendingUrl\]\.some\(u => apIsFormUrl\(u, forms\)\)\) return \{ ok: false/);
  assert.match(nav, /cur\.status !== 'loading'/, 'a loading tab is waited for before deciding');
  assert.doesNotMatch(src, /windows\.create|window\.open|location\.href\s*=|location\.assign|location\.replace/);
  assert.doesNotMatch(src, /\.click\(\)[^;]*submit/i);
  assert.doesNotMatch(src, /lfPanel|pageStep2NextToReview|pageApStopNav/);
  // The login page is never typed into: the login check reads no inputs and sets no values.
  const login = fn('function pageApLoginState(');
  assert.doesNotMatch(login, /input|\.value|password|otp|captcha|\.click\(/i);
});

test('the default tab dependencies call chrome only with the allowed addresses', async () => {
  const calls = [];
  const saved = globalThis.chrome;
  globalThis.chrome = {
    tabs: { create: async o => { calls.push(['create', o]); return { id: 9, ...o }; }, update: async (id, o) => { calls.push(['update', id, o]); return { id }; },
      query: async q => (q && q.url ? [{ id: 1, url: URL_HOME }] : [{ id: 1, url: URL_HOME }, { id: 2, pendingUrl: URL_LOGIN }, { id: 3, url: 'https://example.com/' }]) },
    windows: { update: async (id, o) => { calls.push(['window', id, o]); }, getCurrent: async () => ({ id: 4 }) },
  };
  try {
    const d = A.apDeps();
    assert.deepEqual((await d.queryAllMcaTabs()).map(t => t.id), [1, 2]);
    await d.createLoginTab();
    await d.navigateTab(5, A.AP_FORM_URL);
    await d.navigateTab(5, A.AP_LOGIN_URL);
    await assert.rejects(d.navigateTab(5, URL_HOME));
    await d.focusTab({ id: 5, windowId: 6 });
    assert.equal(await d.panelWindowId(), 4);
    assert.deepEqual(calls, [
      ['create', { url: A.AP_LOGIN_URL, active: true }],
      ['update', 5, { url: A.AP_FORM_URL }],
      ['update', 5, { url: A.AP_LOGIN_URL }],
      ['update', 5, { active: true }],
      ['window', 6, { focused: true }],
    ]);
  } finally { globalThis.chrome = saved; }
});

test('Stop pressed while the side panel waits for the Next button: nothing is clicked', async () => {
  const h = harness();
  let probes = 0;
  h.page.forward = prefer => {
    probes++;
    if (probes === 2) A.apStop(h.deps);
    if (probes >= 3) throw new Error('probed after Stop');
    return { clicked: false, label: '', reason: 'none', seen: ['Previous', 'Save'] };
  };
  await A.apRun(h.deps);
  assert.equal(probes, 2);
  noSubmit(h.calls);
});

test('preflight: a resolution number over 10 characters is asked for again', () => {
  const bad = A.apStep2Invalid({ resNo: 'TEST-01/2026-27', resDate: '30/09/2026', desig: 'Director', din: '07654321' });
  assert.ok(bad.some(x => x.key === 'BOARD_RESOLUTION_NO' && /at most 10/.test(x.error)));
  assert.deepEqual(A.apStep2Invalid({ resNo: 'TEST-01/26', resDate: '30/09/2026', desig: 'Director', din: '07654321' }), []);
});

test('started while MCA shows page 2: page 1 is skipped (not refilled) and the run continues from page 2', async () => {
  const h = harness();
  h.page.step = 'Attachment & Declaration';
  h.page.afterP2 = URL_AOC2; // page 2's Proceed opens AOC-2
  const res = await A.apRun(h.deps);
  assert.equal(stateOf(res, 'aoc4p1'), 'skipped');
  assert.ok(!h.calls.includes('startRun'), 'page 1 is not filled again');
  assert.ok(!h.calls.includes('preflightQuestions'), 'page-1 questions are not asked');
  assert.ok(h.calls.indexOf('step2Run') >= 0);
  for (const id of ['aoc2', 'eauditor', 'eboard']) assert.equal(stateOf(res, id), 'done');
  noSubmit(h.calls);
});

test('MCA’s own spelling "Attchement & Declaration" is still page 2', () => {
  assert.equal(A.apStageForPage('https://www.mca.gov.in/content/mca/global/en/mca/e-filing/annual-filings/form-aoc4.html', 'Attchement & Declaration', []), 'aoc4p2');
});

test('run again after a page-2 error, while MCA still shows page 2: continues from page 2, page 1 untouched', async () => {
  const h = harness();
  h.page.afterP2 = URL_AOC2;
  let fail = true;
  const step2 = h.deps.step2Run;
  h.deps.step2Run = async opts => { if (fail) { h.calls.push('step2Run'); return { ok: false, saved: false, reason: 'errors', items: [['err', 'Resolution number: too long']] }; } return step2(opts); };
  let res = await A.apRun(h.deps);
  assert.equal(stateOf(res, 'aoc4p2'), 'error');
  assert.equal(h.page.step, 'Attachment & Declaration');
  const startsBefore = h.calls.filter(c => c === 'startRun').length;
  fail = false;
  res = await A.apRun(h.deps);
  assert.equal(h.calls.filter(c => c === 'startRun').length, startsBefore, 'page 1 not filled again');
  assert.equal(stateOf(res, 'aoc4p1'), 'skipped');
  assert.equal(stateOf(res, 'aoc4p2'), 'done');
  for (const id of ['aoc2', 'eauditor', 'eboard']) assert.equal(stateOf(res, id), 'done');
});

test('MCA error popup after Proceed on Review: run stops with MCA’s message; a membership error forgets the certificate', async () => {
  const h = harness();
  h.page.step = 'Review & Submit';
  h.page.reviewProceed = null;
  h.page.forward = () => ({ clicked: true, label: 'Proceed', seen: ['Previous', 'Save', 'Proceed'] }); // MCA stays put
  const exec = h.deps.exec;
  h.deps.exec = async (tabId, func, args) => {
    if (func.name === 'pageApErrorDialog') return { errors: ['Membership number/ Certificate of practice number does not correspond to the member category of Associate/Fellow.'], closed: true };
    return exec(tabId, func, args);
  };
  const res = await A.apRun(h.deps);
  assert.equal(res.armed, false);
  assert.match(res.you, /MCA says “Membership number/);
  assert.match(res.you, /real membership number/);
  assert.equal(h.store['certifier.v1'], null);
  noSubmit(h.calls);
});

test('certificate: a Chartered Accountant is not asked for a COP number; a Company Secretary is', () => {
  const ca = { CERT_PROFESSION: 'Chartered Accountant', CERT_ASSOC_FELLOW: 'Associate', CERT_MEMBERSHIP_NO: '700001', CERT_COP_NO: '' };
  assert.deepEqual(A.apCertMissing(ca).map(m => m.key), []);
  assert.deepEqual(A.apCertMissing({ ...ca, CERT_PROFESSION: 'Company Secretary' }).map(m => m.key), ['CERT_COP_NO']);
});

test('member category rejected on Review: switches Associate → Fellow, goes back to page 2, refills, then Proceeds', async () => {
  const h = harness();
  h.page.step = 'Review & Submit';
  let errorShown = false, proceeds = 0;
  h.page.forward = prefer => {
    if (prefer.includes('Previous') && /review/i.test(h.page.step)) { h.page.step = 'Attachment & Declaration'; return { clicked: true, label: 'Previous', seen: ['Previous', 'Proceed'] }; }
    if (/attachment/i.test(h.page.step) && prefer.includes('Next')) { h.page.step = 'Review & Submit'; return { clicked: true, label: 'Next', seen: ['Previous', 'Save', 'Next'] }; }
    if (/review/i.test(h.page.step) && prefer.includes('Proceed')) {
      proceeds++;
      if (proceeds === 1) { errorShown = true; return { clicked: true, label: 'Proceed', seen: ['Previous', 'Proceed'] }; } // MCA stays, error popup
      h.tab.url = URL_AOC2; return { clicked: true, label: 'Proceed', seen: ['Previous', 'Proceed'] };
    }
    return { clicked: false, label: '', reason: 'none', seen: [] };
  };
  const exec = h.deps.exec;
  h.deps.exec = async (tabId, func, args) => {
    if (func.name === 'pageApErrorDialog') {
      if (errorShown) { errorShown = false; return { errors: ['Membership number/ Certificate of practice number does not correspond to the member category of Associate/Fellow.'], closed: true }; }
      return null;
    }
    return exec(tabId, func, args);
  };
  const res = await A.apRun(h.deps);
  assert.equal(h.deps.lastStep2 && h.deps.lastStep2.certificate && h.deps.lastStep2.certificate.CERT_ASSOC_FELLOW, 'Fellow', 'page 2 refilled as Fellow');
  assert.equal(h.store[A.AP_CERT_KEY].CERT_ASSOC_FELLOW, 'Fellow', 'remembered firm-wide');
  assert.equal(proceeds, 2);
  for (const id of ['aoc2', 'eauditor', 'eboard']) assert.equal(stateOf(res, id), 'done');
  noSubmit(h.calls);
});

// ── attachments uploaded in the dashboard (AOC-4 Page 2) → page 2 of the autopilot ──
// A stubbed backend: GET /api/attachments?cin=… lists, …/content returns the bytes. `seen` records every URL.
function dashBackend({ a = { id: 'att_a', fileName: 'FS 2025.pdf', size: 3 * 1048576 }, g = [], offline = false, broken = [] } = {}) {
  const seen = [];
  const list = [...(a ? [{ ...a, slot: 'a' }] : []), ...g.map(x => ({ ...x, slot: 'g' }))];
  const fetchFn = async url => {
    seen.push(url);
    if (offline) throw new Error('ECONNREFUSED');
    const m = url.match(/\/api\/attachments\/([^/?]+)\/content$/);
    if (m) {
      if (broken.includes(m[1])) return { ok: false, status: 404 };
      return { ok: true, blob: async () => new Blob([`%PDF-1.4 ${m[1]}`], { type: 'application/pdf' }) };
    }
    assert.match(url, /\/api\/attachments\?cin=U01100KA2019PTC000001&formType=aoc4$/);
    return { ok: true, json: async () => ({ ok: true, attachments: list }) };
  };
  return {
    seen,
    deps: {
      dashboardList: cin => S2.step2DashList(cin, fetchFn),
      dashboardFiles: (cin, files, opts) => S2.step2UseDashboard(cin, files, { ...(opts || {}), fetchFn }),
    },
  };
}

test('dashboard (a): no file in the side panel → preflight does not ask, page 2 uploads the dashboard PDF', async () => {
  const be = dashBackend({ g: [{ id: 'att_g1', fileName: 'extra.pdf', size: 1048576 }] });
  const h = harness({ ...be.deps, getFiles: async () => ({ a: null, g: [], allowNoFileA: false }), ask: async () => { throw new Error('must not ask'); } });
  h.page.afterP2 = 'review';
  const res = await A.apRun(h.deps);
  assert.equal(stateOf(res, 'check'), 'done');
  assert.match(detailOf(res, 'check'), /\(a\) from dashboard: FS 2025\.pdf \(3\.0 MB\)/);
  const f = h.deps.lastStep2.files;
  assert.equal(f.a.name, 'FS 2025.pdf');
  assert.equal(f.a.type, 'application/pdf');
  assert.match(await f.a.text(), /^%PDF-1\.4 att_a/);
  assert.deepEqual(f.g.map(x => x.name), ['extra.pdf']);
  assert.equal(h.deps.lastStep2.allowNoFileA, false);
  assert.match(A.AP.dashNote, /^Using \(a\) from dashboard: FS 2025\.pdf \(3\.0 MB\) · Using \(g\) from dashboard: extra\.pdf \(1\.0 MB\)$/);
  assert.equal(be.seen.filter(u => /\/content$/.test(u)).length, 2, 'each file downloaded once');
  noSubmit(h.calls);
});

test('dashboard: files picked in the side panel win; only the empty (g) slot is filled', async () => {
  const be = dashBackend({ g: [{ id: 'att_g1', fileName: 'extra.pdf', size: 1000 }] });
  const panelA = { name: 'picked.pdf', size: 10 };
  const h = harness({ ...be.deps, getFiles: async () => ({ a: panelA, g: [], allowNoFileA: false }) });
  await A.apRun(h.deps);
  assert.equal(h.deps.lastStep2.files.a, panelA, 'the panel file is used as it is');
  assert.deepEqual(h.deps.lastStep2.files.g.map(x => x.name), ['extra.pdf']);
  assert.ok(!be.seen.some(u => /att_a\/content/.test(u)), 'the dashboard (a) is never downloaded');
  // Both slots chosen in the panel: the backend is not even asked.
  const be2 = dashBackend();
  const h2 = harness({ ...be2.deps, getFiles: async () => ({ a: panelA, g: [{ name: 'g.pdf', size: 1 }], allowNoFileA: false }) });
  await A.apRun(h2.deps);
  assert.deepEqual(be2.seen, []);
  assert.deepEqual(h2.deps.lastStep2.files.g.map(x => x.name), ['g.pdf']);
});

test('dashboard: "(a) is already attached on MCA" still skips (a)', async () => {
  const be = dashBackend({ g: [{ id: 'att_g1', fileName: 'extra.pdf', size: 1000 }] });
  const h = harness({ ...be.deps, getFiles: async () => ({ a: null, g: [], allowNoFileA: true }) });
  await A.apRun(h.deps);
  assert.equal(h.deps.lastStep2.files.a, null);
  assert.equal(h.deps.lastStep2.allowNoFileA, true);
  assert.deepEqual(h.deps.lastStep2.files.g.map(x => x.name), ['extra.pdf']);
  assert.ok(!be.seen.some(u => /att_a\/content/.test(u)));
});

test('dashboard offline or without (a): the run asks for the (a) PDF as before', async () => {
  for (const be of [dashBackend({ offline: true }), dashBackend({ a: null })]) {
    const asks = [];
    const h = harness({ ...be.deps, getFiles: async () => ({ a: null, g: [], allowNoFileA: false }),
      ask: async (groups, ctx) => { asks.push(ctx); return { action: 'stop' }; } });
    const res = await A.apRun(h.deps);
    assert.equal(asks.length, 1);
    assert.equal(asks[0].fileNeeded, true);
    assert.ok(!h.calls.includes('step2Run'));
    assert.notEqual(stateOf(res, 'check'), 'done');
  }
});

test('dashboard (a) listed but its download fails: page 2 reports it and step2Run gets no (a)', async () => {
  const be = dashBackend({ broken: ['att_a'] });
  const h = harness({ ...be.deps, getFiles: async () => ({ a: null, g: [], allowNoFileA: false }) });
  await A.apRun(h.deps);
  assert.equal(h.deps.lastStep2.files.a, null);
  assert.match(A.AP.dashNote, /\(a\) FS 2025\.pdf could not be downloaded from the dashboard/);
});

test('card note before a run: what page 2 will take from the dashboard', async () => {
  const be = dashBackend({ g: [{ id: 'att_g1', fileName: 'extra.pdf', size: 1048576 }] });
  A.AP.cin = CIN;
  await A.apDashPreview({ ...be.deps, getFiles: async () => ({ a: null, g: [], allowNoFileA: false }) }, CIN);
  assert.equal(A.AP.dashNote, 'Using (a) from dashboard: FS 2025.pdf (3.0 MB) · Using (g) from dashboard: extra.pdf (1.0 MB)');
  await A.apDashPreview({ ...be.deps, getFiles: async () => ({ a: { name: 'p.pdf' }, g: [], allowNoFileA: false }) }, CIN);
  assert.equal(A.AP.dashNote, 'Using (g) from dashboard: extra.pdf (1.0 MB)');
  await A.apDashPreview({ ...dashBackend({ offline: true }).deps, getFiles: async () => ({ a: null, g: [] }) }, CIN);
  assert.equal(A.AP.dashNote, '');
});

test('category retry: Previous is clicked even though MCA marks the membership field in red', async () => {
  const backs = [];
  const h = harness();
  h.page.step = 'Review & Submit';
  let errorShown = false, proceeds = 0;
  h.page.forward = (prefer, opts) => {
    if (prefer.includes('Previous')) { backs.push(opts); h.page.step = 'Attachment & Declaration'; return { clicked: true, label: 'Previous', seen: [] }; }
    if (/attachment/i.test(h.page.step) && prefer.includes('Next')) { h.page.step = 'Review & Submit'; return { clicked: true, label: 'Next', seen: [] }; }
    if (/review/i.test(h.page.step) && prefer.includes('Proceed')) {
      proceeds++;
      if (proceeds === 1) { errorShown = true; return { clicked: true, label: 'Proceed', seen: [] }; }
      h.tab.url = URL_AOC2; return { clicked: true, label: 'Proceed', seen: [] };
    }
    return { clicked: false, label: '', reason: 'none', seen: [] };
  };
  const exec = h.deps.exec;
  h.deps.exec = async (tabId, func, args) => {
    if (func.name === 'pageApErrorDialog') { if (errorShown) { errorShown = false; return { errors: ['Membership number/ Certificate of practice number does not correspond to the member category of Associate/Fellow.'] }; } return null; }
    if (func.name === 'pageApForward' && args[0].includes('Previous')) { backs.push(args[2]); }
    return exec(tabId, func, args);
  };
  await A.apRun(h.deps);
  assert.ok(backs.some(o => o && o.back === true), 'Previous is sent with back:true (field errors do not block it)');
  assert.equal(proceeds, 2);
});

// ── nothing is clicked behind the CA's back (review fixes) ──

test('hold helpers: no forward from the waited-on page or an earlier one; another company’s CIN is seen', () => {
  assert.equal(A.apHoldForward('aoc4p1', 'aoc4p2', 'next', 'warn'), true, 'went back to page 1');
  assert.equal(A.apHoldForward('aoc4p2', 'aoc4p2', 'next', 'warn'), true, 'back on the waited page (tab switch)');
  assert.equal(A.apHoldForward('aoc4p2', 'review', 'submit', ''), true);
  assert.equal(A.apHoldForward('aoc4p2', 'aoc4p1', 'next', 'warn'), false, 'MCA moved on past the waited page');
  assert.equal(A.apHoldForward('aoc4p1', '', '', ''), false, 'not waiting: MCA’s own redirect is followed');
  assert.equal(A.apHoldForward('aoc4p1', 'aoc4p2', 'login', 'done'), false);
  assert.equal(A.apHoldForward('aoc4p1', 'aoc4p2', '', 'warn'), true, 'a warn stage holds too');
  assert.equal(A.apOtherCompany(['U01100KA2019PTC000002'], CIN), 'U01100KA2019PTC000002');
  assert.equal(A.apOtherCompany(['U01100KA2019PTC000002', CIN], CIN), '', 'own CIN on the page (e.g. with a subsidiary’s)');
  assert.equal(A.apOtherCompany([], CIN), '');
  assert.equal(A.apOtherCompany(undefined, CIN), '');
});

test('page 2 Proceed refused, the CA goes back to page 1 to fix it: Next is never clicked by itself', async () => {
  const h = harness();
  let failP2 = true;
  h.page.forward = prefer => {
    if (prefer.includes('Next') && /company/i.test(h.page.step) && h.forwards.length === 1) { h.page.step = 'Attachment & Declaration'; return { clicked: true, label: 'Next', seen: [] }; }
    if (/attachment/i.test(h.page.step) && !failP2) { h.tab.url = URL_AOC2; return { clicked: true, label: 'Proceed', seen: [] }; }
    if (/attachment/i.test(h.page.step)) return { clicked: false, label: '', reason: 'field-errors', errors: ['Membership number is required'], seen: ['Proceed'] };
    return { clicked: true, label: prefer[0], seen: [] };
  };
  let res = await A.apRun(h.deps);
  assert.equal(res.waitingFor, 'next');
  const n = h.forwards.length;
  h.page.step = 'Company details'; // the CA clicked Previous
  await h.tick();                  // the step watcher sees the change
  assert.equal(h.forwards.length, n, 'no Next on page 1');
  assert.match(A.AP.you, /You went back to AOC-4 page 1\. The autopilot clicks nothing here/);
  res = await A.apOnTabChange(h.deps, 7); // switching back to the MCA tab
  assert.equal(h.forwards.length, n);
  assert.equal(res.armed, true);
  h.page.step = 'Attachment & Declaration'; // the CA clicked Next back to page 2
  await h.tick();
  await A.apOnTabChange(h.deps, 7);
  assert.equal(h.forwards.length, n, 'no Proceed on the waited page either');
  assert.equal(h.calls.filter(c => c === 'startRun').length, 1);
  assert.equal(h.calls.filter(c => c === 'step2Run').length, 1);
  failP2 = false;
  h.tab.url = URL_AOC2; // the CA clicked Proceed: MCA opened AOC-2 → the run carries on by itself
  await h.tick();
  res = await A.apOnTabChange(h.deps, 7);
  assert.equal(stateOf(res, 'finish'), 'waiting');
  noSubmit(h.calls);
});

test('waiting on Review & Submit, the CA goes back to page 2: Proceed is not clicked there', async () => {
  const h = harness();
  let res = await A.apRun(h.deps);
  assert.equal(res.waitingFor, 'submit');
  const n = h.forwards.length;
  h.page.step = 'Attachment & Declaration';
  await h.tick();
  await A.apOnTabChange(h.deps, 7);
  assert.equal(h.forwards.length, n);
  assert.match(A.AP.you, /You went back to AOC-4 page 2/);
  h.page.step = 'Review & Submit';
  await h.tick();
  assert.equal(h.forwards.length, n, 'Review is not probed again on a tab switch');
  h.tab.url = URL_BOARD;
  await h.tick();
  res = await A.apOnTabChange(h.deps, 7);
  assert.equal(stateOf(res, 'finish'), 'waiting');
});

test('locked to the run’s tab: another tab’s events are ignored; a new linked-form tab MCA opens is followed', async () => {
  const h = harness();
  const other = { id: 8, windowId: 1, url: URL_AOC4, status: 'complete' };
  const fresh = { id: 9, windowId: 1, url: URL_AOC2, status: 'complete' };
  const tabsGet = h.deps.tabsGet;
  h.deps.tabsGet = async id => (id === 8 ? { ...other } : id === 9 ? { ...fresh } : tabsGet(id));
  h.deps.queryMcaTabs = async () => [{ ...h.tab }, { ...other }];
  let res = await A.apRun(h.deps);
  assert.equal(res.waitingFor, 'submit');
  const n = h.forwards.length, c = h.calls.length;
  h.deps.getActiveMcaTab = async () => ({ ...other }); // the CA clicked the other company's tab
  res = await A.apOnTabChange(h.deps, 8);
  assert.equal(h.forwards.length, n, 'nothing clicked on the other tab');
  assert.equal(h.calls.length, c, 'the other tab is not even looked at');
  assert.equal(A.AP.tabId, 7);
  // A tab MCA opened for AOC-2 (unknown before): the run follows it.
  h.deps.lfRun = async () => { h.calls.push('lfRun@' + A.AP.tabId); return { state: 'done', form: 'aoc2', proceeded: false, note: 'Saved' }; };
  const exec = h.deps.exec;
  h.deps.exec = async (id, func, args) => (id === 9 && func.name === 'pageApWhere' ? { url: fresh.url, step: '' } : exec(id, func, args));
  await A.apOnTabChange(h.deps, 9);
  assert.ok(h.calls.includes('lfRun@9'), h.calls.join(','));
});

test('a tab of another company (its CIN, not this one): stop and tell the CA, nothing filled or clicked', async () => {
  let h = harness();
  h.page.cins = ['U01100KA2019PTC000002'];
  let res = await A.apRun(h.deps);
  assert.equal(res.armed, false);
  assert.match(res.you, /another company \(CIN U01100KA2019PTC000002\)/);
  assert.ok(!h.calls.includes('startRun') && !h.calls.includes('preflightQuestions'));
  assert.deepEqual(h.forwards, []);
  // Mid-run: the tab now shows another company's draft.
  A.apReset();
  h = harness();
  res = await A.apRun(h.deps);
  assert.equal(res.waitingFor, 'submit');
  const n = h.forwards.length;
  h.tab.url = URL_AOC2; h.page.cins = ['U01100KA2019PTC000002'];
  res = await A.apOnTabChange(h.deps, 7);
  assert.equal(res.armed, false);
  assert.match(res.you, /another company/);
  assert.ok(!h.calls.some(c => c.startsWith('lfRun')));
  assert.equal(h.forwards.length, n);
  // Its own CIN next to another (a subsidiary): runs as usual.
  A.apReset();
  h = harness();
  h.page.cins = ['U01100KA2019PTC000002', CIN];
  h.page.afterP2 = URL_AOC2;
  res = await A.apRun(h.deps);
  assert.equal(stateOf(res, 'finish'), 'waiting');
});

test('Q12(c) hand step: no answer from the page or a reloaded page → nothing is filled; only a real Save continues', async () => {
  let n = 0;
  const h = harness();
  h.deps.startRun = async () => {
    h.calls.push('startRun@' + h.deps.phase);
    if (n++ === 0) { h.manual.armed = true; return { ok: false, completedAll: false, notSaved: [], issues: [], reason: 'manual-step', stoppedAt: 2 }; }
    return { ok: true, completedAll: true, notSaved: [], issues: [] };
  };
  let res = await A.apRun(h.deps);
  assert.equal(res.waitingFor, 'manual');
  const exec = h.deps.exec;
  // The page does not answer (busy / timeout).
  h.deps.exec = async (id, func, args) => { if (func.name === 'pageApManualState') throw new Error('timeout'); return exec(id, func, args); };
  res = await A.apOnTabChange(h.deps, 7);
  assert.equal(res.waitingFor, 'manual');
  assert.deepEqual(h.calls.filter(c => c.startsWith('startRun')), ['startRun@1']);
  h.deps.exec = exec;
  // MCA reloaded the page: its armed Save is gone (armed=false, completed=false).
  h.manual.armed = false; h.manual.completed = false;
  res = await A.apOnTabChange(h.deps, 7);
  await h.tick();
  assert.equal(res.waitingFor, 'manual');
  assert.match(res.you, /page was reloaded.*press Run everything/);
  assert.deepEqual(h.calls.filter(c => c.startsWith('startRun')), ['startRun@1'], 'Phases 3–7 are not filled');
  // The CA saved Q12(c) by hand and pressed Run everything: page 1 carries on from Phase 3.
  res = await A.apRun(h.deps);
  assert.deepEqual(h.calls.filter(c => c.startsWith('startRun')), ['startRun@1', 'startRun@3']);
  assert.equal(stateOf(res, 'aoc4p1'), 'done');
});

test('Stop while waiting for Q12(c) (and Reset) switches off the page’s automatic Save', async () => {
  const disarm = [];
  globalThis.pageDisarmManualSave = function pageDisarmManualSave() { return { disarmed: true }; };
  try {
    const h = harness();
    const exec = h.deps.exec;
    h.deps.exec = async (id, func, args) => { if (func.name === 'pageDisarmManualSave') { disarm.push(id); return { disarmed: true }; } return exec(id, func, args); };
    h.deps.startRun = async () => { h.manual.armed = true; return { ok: false, completedAll: false, notSaved: [], issues: [], reason: 'manual-step', stoppedAt: 2 }; };
    let res = await A.apRun(h.deps);
    assert.equal(res.waitingFor, 'manual');
    res = await A.apStop(h.deps);
    assert.equal(res.armed, false);
    assert.deepEqual(disarm, [7]);
    h.manual.completed = true;
    await h.tick();
    await A.apOnTabChange(h.deps, 7);
    assert.equal(h.forwards.length, 0, 'nothing clicked after Stop');
    A.apReset();
    assert.deepEqual(disarm, [7, 7], 'Reset disarms too');
    // A failing page call is ignored.
    const e = harness();
    e.deps.exec = async (id, func, args) => { if (func.name === 'pageDisarmManualSave') throw new Error('tab closed'); return exec(id, func, args); };
    e.deps.startRun = h.deps.startRun;
    await A.apRun(e.deps);
    await A.apStop(e.deps);
    await new Promise(r => setTimeout(r, 5));
  } finally { delete globalThis.pageDisarmManualSave; }
});

test('page 1: the autopilot fills through doFill (keeps its tab); a fill on another tab never gets a Next', async () => {
  const saved = { doFill: globalThis.doFill, startRun: globalThis.startRun };
  const called = [];
  globalThis.doFill = async () => { called.push('doFill'); return { ok: true }; };
  globalThis.startRun = async () => { called.push('startRun'); return { ok: true }; };
  try {
    await A.apDeps().startRun();
    assert.deepEqual(called, ['doFill']);
  } finally {
    if (saved.doFill === undefined) delete globalThis.doFill; else globalThis.doFill = saved.doFill;
    if (saved.startRun === undefined) delete globalThis.startRun; else globalThis.startRun = saved.startRun;
  }
  const h = harness({ runTabId: () => 8 });
  const res = await A.apRun(h.deps);
  assert.equal(stateOf(res, 'aoc4p1'), 'error');
  assert.match(res.you, /another MCA tab/);
  assert.deepEqual(h.forwards, [], 'no Next on the autopilot’s tab');
  assert.equal(res.armed, false);
  A.apReset();
  const ok = harness({ runTabId: () => 7 });
  assert.equal(stateOf(await A.apRun(ok.deps), 'aoc4p1'), 'done');
});

test('linked placeholders rejected by the form: retried with the first option, else asked (and said so)', async () => {
  const LD = { allowed: () => true, dummy: m => (m.type === 'select' ? 'No' : 'TEST') };
  const forms = () => [
    { ...plainForms()[0], buildData: (c, a) => ({ missing: [
      ...(a.KIND ? [] : [{ key: 'KIND', label: 'Kind', type: 'select', options: ['X', 'No'], parse: v => { if (v === 'No') throw new Error('not allowed'); return v; } }]),
      ...(a.CODE ? [] : [{ key: 'CODE', label: 'Code', type: 'text', parse: () => { throw new Error('bad code'); } }]),
    ] }) },
    plainForms()[1], plainForms()[2],
  ];
  const asks = [];
  const h = harness({
    forms, linkedDummy: () => LD,
    ask: async (groups, ctx) => { asks.push({ keys: groups.map(g => g.id + ':' + g.missing.map(m => m.key).join('+')), title: ctx.title }); return { action: 'stop' }; },
  });
  await A.apRun(h.deps);
  assert.equal(h.deps.saved.aoc2.find(x => x.key === 'KIND').value, 'X', 'retried with the first option');
  assert.equal(asks.length, 1);
  assert.deepEqual(asks[0].keys, ['aoc2:CODE'], 'only the still-rejected field is asked');
  assert.match(asks[0].title, /placeholders rejected by the form: AOC-2: Code/);
});

test('a linked form left waiting (panel busy) is not rerun on every tab event — only when the page changes', async () => {
  const h = harness();
  await A.apRun(h.deps);
  let n = 0;
  h.deps.lfRun = async () => { n++; h.calls.push('lfRun'); return n === 1 ? { state: 'busy', proceeded: false, note: '' } : { state: 'done', form: 'eboard', proceeded: false, note: 'Saved' }; };
  h.tab.url = URL_BOARD;
  let res = await A.apOnTabChange(h.deps, 7);
  assert.equal(stateOf(res, 'eboard'), 'waiting');
  await A.apOnTabChange(h.deps, 7);
  await A.apOnTabChange(h.deps, 7);
  assert.equal(n, 1, 'not rerun on the same page');
  h.page.linked = 'Part B'; // MCA shows another page of the form
  res = await A.apOnTabChange(h.deps, 7);
  assert.equal(n, 2);
  assert.equal(stateOf(res, 'finish'), 'waiting');
});

// The search for Proceed / Next follows MCA: while MCA reports it is loading the side panel keeps looking (no fixed
// time); once MCA is idle and the button is still missing, it gives up after a few probes.
test('forward search: keeps looking while MCA is loading, clicks Proceed the moment it shows', async () => {
  const h = harness();
  let n = 0;
  h.deps.exec = (orig => async (tabId, func, args, ms) => {
    if (func.name === 'pageApForward') {
      n++;
      if (n < 30) return { clicked: false, label: '', reason: 'none', seen: [], busy: true };
      return { clicked: true, label: 'Proceed', seen: ['Proceed'] };
    }
    return orig(tabId, func, args, ms);
  })(h.deps.exec);
  const r = await A.apForwardAndWait(h.deps, 7, { url: 'https://www.mca.gov.in/x/form-aoc4.html', step: 'Company details' }, A.AP.gen, ['Proceed', 'Next']);
  assert.equal(n, 30, '29 loading probes, then the click');
  assert.equal(r.clicked, true);
});

test('forward search: MCA idle and no button → gives up after a few probes (not a fixed wait)', async () => {
  const h = harness();
  let n = 0;
  h.deps.exec = (orig => async (tabId, func, args, ms) => {
    if (func.name === 'pageApForward') { n++; return { clicked: false, label: '', reason: 'none', seen: ['Previous'], busy: false }; }
    return orig(tabId, func, args, ms);
  })(h.deps.exec);
  const r = await A.apForwardAndWait(h.deps, 7, { url: 'https://www.mca.gov.in/x/form-aoc4.html', step: 'Company details' }, A.AP.gen, ['Proceed']);
  assert.equal(n, 5);
  assert.equal(r.clicked, false);
  assert.equal(r.reason, 'none');
});
