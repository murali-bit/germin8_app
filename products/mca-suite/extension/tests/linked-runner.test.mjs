// node --test extension/tests/linked-runner.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
const R = require('../js/linked/runner.js');
const here = path.dirname(fileURLToPath(import.meta.url));

const CIN = 'U01100KA2019PTC000001'; // Demo Terra Technology Private Limited
const FORMS = [
  { id: 'aoc2', urlRe: /form-aoc2\.html/i },
  { id: 'eauditor', urlRe: /extract-of-auditor-standalone/i },
  { id: 'eboard', urlRe: /form-extract-of-boards-report/i },
];

test('detects each linked form only on mca.gov.in', () => {
  const base = 'https://www.mca.gov.in/content/mca/global/en/mca/e-filing/annual-filings/';
  assert.equal(R.lfDetectForm(base + 'form-aoc2.html', FORMS).id, 'aoc2');
  assert.equal(R.lfDetectForm(base + 'extract-of-auditor-standalone.html?x=1', FORMS).id, 'eauditor');
  assert.equal(R.lfDetectForm(base + 'form-extract-of-boards-report.html', FORMS).id, 'eboard');
  assert.equal(R.lfDetectForm(base + 'form-aoc4.html', FORMS), null);
  assert.equal(R.lfDetectForm('https://evil.example/mca.gov.in/form-aoc2.html', FORMS), null);
  assert.equal(R.lfDetectForm('', FORMS), null);
});

test('step machine: pending → active → done records elapsed ms', () => {
  let s = R.lfStepsInit();
  assert.deepEqual(s.map(x => x.id), ['detect', 'load', 'ask', 'pre', 'fill', 'save', 'confirm', 'proceed']);
  s = R.lfStepUpdate(s, 'fill', 'active', 'filling 40', 1000);
  s = R.lfStepUpdate(s, 'fill', 'active', 'still filling', 1500); // detail update keeps start time
  assert.equal(s.find(x => x.id === 'fill').startedAt, 1000);
  s = R.lfStepUpdate(s, 'fill', 'done', '40 filled', 4200);
  const f = s.find(x => x.id === 'fill');
  assert.equal(f.state, 'done'); assert.equal(f.ms, 3200); assert.equal(f.detail, '40 filled');
});

test('step machine: finished steps are not reopened, bad states ignored, direct skip has 0 ms', () => {
  let s = R.lfStepsInit();
  s = R.lfStepUpdate(s, 'save', 'error', 'no-save', 10);
  assert.equal(R.lfStepUpdate(s, 'save', 'active', 'x', 20).find(x => x.id === 'save').state, 'error');
  assert.equal(R.lfStepUpdate(s, 'save', 'bogus', 'x', 20), s);
  s = R.lfStepUpdate(s, 'proceed', 'skipped', 'Submit is yours', 30);
  assert.equal(s.find(x => x.id === 'proceed').ms, 0);
  s = R.lfStepUpdate(s, 'detect', 'active', '', 0);
  assert.equal(R.lfStepUpdate(s, 'detect', 'pending', '', 5).find(x => x.id === 'detect').state, 'active');
  const sum = R.lfStepsSummary(s);
  assert.equal(sum.error, 1); assert.equal(sum.skipped, 1); assert.equal(sum.active, 1); assert.equal(sum.pending, 5);
});

test('checklist merge: per CIN and part, upper-cases CIN, pending never overwrites unless forced', () => {
  let st = R.lfChecklistMerge({}, CIN.toLowerCase(), 'aoc2', 'done', 'Saved · 6 filled', '2026-11-24T10:00:00Z');
  assert.deepEqual(st[CIN].aoc2, { state: 'done', at: '2026-11-24T10:00:00Z', note: 'Saved · 6 filled' });
  st = R.lfChecklistMerge(st, CIN, 'eauditor', 'warn', 'Save not confirmed', 't2');
  st = R.lfChecklistMerge(st, CIN, 'aoc2', 'pending', '', 't3');
  assert.equal(st[CIN].aoc2.state, 'done');
  st = R.lfChecklistMerge(st, CIN, 'aoc2', 'pending', '', 't3', true);
  assert.equal(st[CIN].aoc2, undefined);
  assert.equal(st[CIN].eauditor.state, 'warn');
  // unknown part / state / empty CIN leave the store as it is
  assert.equal(R.lfChecklistMerge(st, CIN, 'mgt7', 'done'), st);
  assert.equal(R.lfChecklistMerge(st, CIN, 'aoc2', 'finished'), st);
  assert.equal(R.lfChecklistMerge(st, '', 'aoc2', 'done'), st);
  // other companies are untouched
  const other = R.lfChecklistMerge(st, 'U01100KA2019PTC000002', 'step2', 'done', '', 't4');
  assert.equal(other[CIN].eauditor.state, 'warn');
  assert.equal(other.U01100KA2019PTC000002.step2.state, 'done');
});

test('checklist view lists all five AOC-4 parts in order with defaults', () => {
  const st = R.lfChecklistMerge({}, CIN, 'eboard', 'error', 'MCA errors after Save', 't');
  const v = R.lfChecklistView(st, CIN);
  assert.deepEqual(v.map(x => x.part), ['phase1', 'step2', 'aoc2', 'eauditor', 'eboard']);
  assert.equal(v[0].state, 'pending');
  assert.equal(v[4].state, 'error'); assert.equal(v[4].note, 'MCA errors after Save');
  assert.equal(R.lfChecklistView({}, '').length, 5);
});

test('date normalisation', () => {
  assert.equal(R.lfNormDate('30/09/2026'), '30/09/2026');
  assert.equal(R.lfNormDate('2026-09-30'), '30/09/2026');
  assert.equal(R.lfNormDate('1-4-25'), '01/04/2025');
  assert.equal(R.lfNormDate('31/02/2026'), null);
  assert.equal(R.lfNormDate('Sept 30'), null);
});

test('missing inputs: validation, normalisation and grouping by company-answers formType', () => {
  const missing = [
    { key: 'BOARD_RESOLUTION_NO', label: 'Board resolution number', type: 'text' },
    { key: 'BOARD_RESOLUTION_DATE', label: 'Resolution date', type: 'date' },
    { key: 'EMP_FEMALE', label: 'Female employees', type: 'number' },
    { key: 'WEBSITE', label: 'Website', type: 'text', optional: true },
    { key: 'DECL_DESIGNATION', label: 'Designation', type: 'select', options: ['Director', 'Liquidator/IRP/RP'] },
    { key: 'BOARD_MEETINGS', label: 'Board meetings', type: 'textarea',
      parse: s => s.split('\n').map(l => { const [date, total, attended] = l.split('|').map(x => x.trim()); return { date, total, attended }; }) },
  ];
  const ok = R.lfCollectMissing(missing, {
    BOARD_RESOLUTION_NO: ' BR/03/2026 ', BOARD_RESOLUTION_DATE: '2026-09-30', EMP_FEMALE: '1,0', WEBSITE: '',
    DECL_DESIGNATION: 'Director', BOARD_MEETINGS: '15/05/2025 | 3 | 3\n30/09/2025 | 3 | 2',
  }, 'eboard');
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.answers.BOARD_RESOLUTION_NO, 'BR/03/2026');
  assert.equal(ok.answers.BOARD_RESOLUTION_DATE, '30/09/2026');
  assert.equal(ok.answers.EMP_FEMALE, '10');
  assert.equal(ok.answers.WEBSITE, '');
  assert.deepEqual(JSON.parse(ok.answers.BOARD_MEETINGS)[1], { date: '30/09/2025', total: '3', attended: '2' });
  // shared declaration keys go to 'aoc4', the rest to the form's own formType
  assert.deepEqual(ok.byForm.aoc4.map(a => a.key), ['BOARD_RESOLUTION_NO', 'BOARD_RESOLUTION_DATE', 'DECL_DESIGNATION']);
  assert.deepEqual(ok.byForm.eboard.map(a => a.key), ['EMP_FEMALE', 'WEBSITE', 'BOARD_MEETINGS']);
  assert.equal(ok.byForm.eboard[0].label, 'Female employees');

  const bad = R.lfCollectMissing(missing, { BOARD_RESOLUTION_DATE: '31/02/2026', EMP_FEMALE: 'ten', DECL_DESIGNATION: 'CEO' }, 'eboard');
  assert.equal(bad.errors.length, 5); // resolution no, date, number, select, meetings — website is optional
  assert.match(bad.errors.join('\n'), /Resolution date: use DD\/MM\/YYYY/);
  assert.match(bad.errors.join('\n'), /Female employees: must be a number/);
  assert.equal(R.lfCollectMissing([{ key: 'X', label: 'X', formType: 'aoc2' }], { X: 'y' }, 'eboard').byForm.aoc2[0].value, 'y');
});

test('field results: filled / skipped / failed per job, repeated ids matched in order', () => {
  const jobs = [
    { id: 'NOT_AT_ARM_COUNT', label: 'Contracts not at arm’s length', value: '0' },
    { id: 'MEET_DATE', value: '15/05/2025', index: 0 },
    { id: 'MEET_DATE', value: '30/09/2025', index: 1 },
    { id: 'DECL_NAME', value: 'Arun Rao' },
    { id: 'DECL_DIN', value: '07654321' },
  ];
  const results = [
    { id: 'NOT_AT_ARM_COUNT', ok: true, note: 'already correct' },
    { id: 'MEET_DATE', ok: true },
    { id: 'MEET_DATE', ok: false, err: 'row 2 not found (form has 1)' },
    { id: 'DECL_NAME', ok: true, hidden: true, note: 'locked by MCA — skipped' },
  ];
  const { rows, counts } = R.lfFieldRows(jobs, results, { DECL_DIN: 'DIN of signatory' });
  assert.deepEqual(rows.map(r => r.status), ['filled', 'filled', 'failed', 'skipped', 'failed']);
  assert.equal(rows[2].reason, 'row 2 not found (form has 1)');
  assert.equal(rows[4].label, 'DIN of signatory'); assert.equal(rows[4].reason, 'no result from page');
  assert.deepEqual(counts, { filled: 2, skipped: 1, failed: 2, total: 5 });
  assert.equal(R.lfShort('x'.repeat(60), 10).length, 10);
});

test('only beforePre jobs go ahead of the pre-steps; everything else is one pass', () => {
  const jobs = [{ id: 'AT_ARM_COUNT' }, { id: 'DECL_RES_NO' }, { id: 'X', beforePre: true }];
  assert.deepEqual(R.lfSplitJobs(jobs, true).first.map(j => j.id), ['X']);
  assert.deepEqual(R.lfSplitJobs(jobs, true).rest.map(j => j.id), ['AT_ARM_COUNT', 'DECL_RES_NO']);
  assert.equal(R.lfSplitJobs(jobs, false).rest.length, 3);
  assert.equal(R.lfFillTimeout(0), 30000);
  assert.equal(R.lfFillTimeout(60), 105000);
  assert.equal(R.lfFillTimeout(1000), 240000);
  assert.equal(R.lfMs(950), '950 ms'); assert.equal(R.lfMs(3200), '3.2 s');
});

test('page functions are self-contained and never target Submit', () => {
  for (const f of [R.pageLinkedClickSave, R.pageLinkedProceed, R.pageLinkedIdle, R.pageLinkedStop, R.pageLinkedWaitFor]) {
    const src = f.toString();
    assert.doesNotMatch(src, /\blf[A-Z]\w*\(|\bLF\.|FilingChecklist/, f.name + ' uses an outer reference');
  }
  assert.match(R.pageLinkedClickSave.toString(), /=== 'Save'/);
  assert.match(R.pageLinkedProceed.toString(), /=== 'Proceed'/);
});

// When the form modules written alongside this runner exist, check they keep the contract.
for (const id of ['aoc2', 'eauditor', 'eboard']) {
  const file = path.join(here, '..', 'js', 'linked', id + '.js');
  test(`module contract: ${id}`, { skip: !existsSync(file) && `${id}.js not present` }, () => {
    const F = require(file);
    assert.equal(F.id, id);
    assert.ok(F.urlRe instanceof RegExp);
    assert.equal(typeof F.buildData, 'function');
    assert.equal(typeof F.jobs, 'function');
    assert.equal(F.nextButton === 'Proceed' || F.nextButton === null, true);
    if (id === 'eboard') assert.equal(F.nextButton, null);
  });
}

// ── minimal fake DOM for the page functions (selectors: tag, .class, [attr="v"], tag[attr="v"], comma lists) ──
function el(tag, { text = '', cls = '', attrs = {}, hidden = false, children = [] } = {}) {
  const e = { tag, cls: cls.split(/\s+/).filter(Boolean), attrs, hidden, children, clicks: 0, parent: null, _text: text };
  Object.defineProperty(e, 'textContent', { get() { return [e._text, ...e.children.map(c => c.textContent)].join(' '); } });
  e.getClientRects = () => (isHidden(e) ? [] : [{}]);
  e.getAttribute = k => (k in e.attrs ? e.attrs[k] : null);
  e.click = () => { e.clicks++; };
  e.querySelectorAll = sel => descendants(e).filter(d => matches(d, sel));
  for (const c of children) c.parent = e;
  return e;
}
const isHidden = e => { for (let x = e; x; x = x.parent) if (x.hidden) return true; return false; };
const descendants = e => e.children.flatMap(c => [c, ...descendants(c)]);
const matches = (e, sel) => sel.split(',').map(s => s.trim()).some(s => {
  const m = s.match(/^([a-z]*)(?:\.([\w-]+))?(?:\[([\w-]+)="([^"]*)"\])?$/i);
  if (!m) return false;
  const [, tag, cls, ak, av] = m;
  return (!tag || e.tag === tag) && (!cls || e.cls.includes(cls)) && (!ak || e.attrs[ak] === av);
});
function withDom(body, fn) {
  const root = el('body', { children: body });
  const saved = { document: globalThis.document, window: globalThis.window };
  globalThis.document = { readyState: 'complete', querySelectorAll: s => root.querySelectorAll(s) };
  globalThis.window = {};
  return Promise.resolve(fn()).finally(() => { globalThis.document = saved.document; globalThis.window = saved.window; });
}

test('confirm save: clicks only OK/Okay/Close in a success dialog, never Proceed or Yes', async () => {
  const proceed = el('button', { text: 'Proceed' }), yes = el('button', { text: 'Yes' }), ok = el('button', { text: 'OK' });
  const dlg = el('div', { attrs: { role: 'dialog' }, children: [el('p', { text: 'Data Added Successfully' }), proceed, yes, ok] });
  await withDom([dlg], async () => {
    const r = await R.pageLinkedConfirmSave(500);
    assert.equal(r.confirmed, true); assert.equal(r.closed, true);
  });
  assert.equal(ok.clicks, 1); assert.equal(proceed.clicks, 0); assert.equal(yes.clicks, 0);

  // Success dialog offering only Proceed / Yes / Continue: confirmed, but nothing is clicked.
  const p2 = el('button', { text: 'Proceed' }), y2 = el('button', { text: 'Yes' }), c2 = el('button', { text: 'Continue' });
  await withDom([el('div', { cls: 'modal-dialog', children: [el('span', { text: 'Saved successfully' }), p2, y2, c2] })], async () => {
    const r = await R.pageLinkedConfirmSave(500);
    assert.equal(r.confirmed, true); assert.equal(r.closed, false);
  });
  assert.equal(p2.clicks + y2.clicks + c2.clicks, 0);

  // A plain container (not a dialog) next to the form toolbar is ignored completely.
  const p3 = el('button', { text: 'Proceed' }), ok3 = el('button', { text: 'OK' });
  await withDom([el('div', { children: [el('span', { text: 'Data Added Successfully' }), p3, ok3] })], async () => {
    const r = await R.pageLinkedConfirmSave(300);
    assert.equal(r.confirmed, false); assert.equal(r.errorsVisible, false);
  });
  assert.equal(p3.clicks + ok3.clicks, 0);
});

test('confirm save: reports visible MCA field errors, ignores hidden dialogs', async () => {
  const ok = el('button', { text: 'OK' });
  await withDom([
    el('div', { attrs: { role: 'dialog' }, hidden: true, children: [el('p', { text: 'Data Added Successfully' }), ok] }),
    el('div', { cls: 'guideFieldError', text: 'This field is required' }),
    el('div', { cls: 'guideFieldError', text: 'This field is required' }),
    el('div', { cls: 'guideFieldError', text: '' }),
  ], async () => {
    const r = await R.pageLinkedConfirmSave(300);
    assert.equal(r.confirmed, false); assert.equal(r.errorsVisible, true);
    assert.deepEqual(r.errorTexts, ['This field is required']);
  });
  assert.equal(ok.clicks, 0);
  assert.doesNotMatch(R.pageLinkedConfirmSave.toString(), /\blf[A-Z]\w*\(|\bLF\.|FilingChecklist|pageConfirmSave/);
});

test('stop: a Stop request or any page result marked stopped halts the run', () => {
  assert.equal(R.lfHalted(false, [{ id: 'A', ok: true }, { id: 'B', ok: false }]), false);
  assert.equal(R.lfHalted(true, []), true);
  // pageFill reports stopped fields as ok:true — they must still halt (not count as a clean fill).
  assert.equal(R.lfHalted(false, [{ id: 'A', ok: true }, { id: 'B', ok: true, hidden: true, stopped: true }]), true);
  assert.equal(R.lfHalted(false, [null, undefined]), false);
});

test('missing-answer label marks optional questions even when a label is given', () => {
  assert.equal(R.lfMissingLabel({ key: 'WEBSITE', label: 'Web address', optional: true }), 'Web address (optional)');
  assert.equal(R.lfMissingLabel({ key: 'WEBSITE', optional: true }), 'WEBSITE (optional)');
  assert.equal(R.lfMissingLabel({ key: 'DECL_DIN', label: 'DIN' }), 'DIN');
});

test('company master: answers merged aoc4 <- extraAnswers <- own, with a timeout signal; failed saves reported', async () => {
  const saved = globalThis.fetch;
  const calls = [];
  const data = { aoc4: { DECL_DIN: '07654321', X: 'aoc4' }, aoc2: { ROWS: '[]', X: 'aoc2' }, eboard: { X: 'eboard', EMP_MALE: '2' } };
  globalThis.fetch = async (url, opt = {}) => {
    calls.push({ url, opt });
    if (opt.method === 'POST') { const b = JSON.parse(opt.body); return { ok: b.formType !== 'eboard' }; }
    const f = new URL(url).searchParams.get('form');
    return { ok: true, json: async () => ({ answers: Object.entries(data[f] || {}).map(([field_key, value]) => ({ field_key, value })) }) };
  };
  try {
    const a = await R.lfFetchAnswers(CIN, { answersForm: 'eboard', extraAnswers: ['aoc2'] });
    assert.deepEqual(a, { DECL_DIN: '07654321', X: 'eboard', ROWS: '[]', EMP_MALE: '2' });
    assert.equal(calls.length, 3);
    assert.ok(calls.every(c => c.opt.signal instanceof AbortSignal), 'every GET has a timeout signal');
    const b = await R.lfFetchAnswers(CIN, { answersForm: 'aoc2' });
    assert.equal(b.X, 'aoc2');
    calls.length = 0;
    const failed = await R.lfSaveAnswers(CIN, { aoc4: [{ key: 'DECL_DIN', value: '07654321' }], eboard: [{ key: 'EMP_MALE', value: '2' }] });
    assert.deepEqual(failed, ['eboard']);
    assert.ok(calls.every(c => c.opt.signal instanceof AbortSignal), 'every POST has a timeout signal');
    globalThis.fetch = async () => { throw new Error('offline'); };
    assert.deepEqual(await R.lfSaveAnswers(CIN, { aoc2: [] }), ['aoc2']);
    await assert.rejects(R.lfFetchAnswers(CIN, { answersForm: 'aoc2' }), /offline/);
  } finally { globalThis.fetch = saved; }
});

// ── lfRun end to end against stubbed side-panel DOM + chrome APIs: Stop must prevent Save and Proceed ──
async function runWithStop({ pre, stopDuring, auto = false, missing = [], url, nextButton = 'Proceed', running = false, onFetch, onExec, failFill = false, opts = {}, respond }) {
  const stub = () => ({ innerHTML: '', textContent: '', hidden: false, checked: true, disabled: false, open: false, dataset: {},
    children: [], appendChild(c) { this.children.push(c); return c; }, querySelectorAll: () => [], addEventListener() {}, parentElement: null });
  const ids = {};
  const URL_ = 'https://www.mca.gov.in/content/mca/global/en/mca/e-filing/annual-filings/form-aoc2.html';
  const execs = [];
  const tab = { id: 7, url: url || URL_, status: 'complete' };
  const g = globalThis;
  const saved = {};
  const set = (k, v) => { saved[k] = g[k]; g[k] = v; };
  set('document', { getElementById: id => (ids[id] = ids[id] || stub()), createElement: stub });
  set('currentClient', { general: { CIN } });
  set('currentData', { CIN });
  set('getActiveMcaTab', async () => tab);
  set('withTimeout', p => p);
  set('pageFill', function pageFill() {});
  set('fetch', async () => { if (onFetch) await onFetch(); return { ok: true, json: async () => ({ answers: [] }) }; });
  const mem = {};
  set('chrome', {
    storage: { local: { get: async k => ({ [k]: mem[k] }), set: async o => { Object.assign(mem, o); } } },
    tabs: { get: async () => ({ ...tab }) },
    scripting: { executeScript: async ({ func, args }) => {
      execs.push(func.name);
      if (onExec) onExec(func.name);
      if (respond) { const out = respond(func.name, tab); if (out !== undefined) return [{ result: out }]; }
      if (func.name === 'pageLinkedProceed') tab.url = URL_.replace('form-aoc2', 'extract-of-auditor-standalone'); // MCA moves on
      if (func.name === stopDuring) await R.lfStop(); // the user presses Stop while this page call runs
      if (func.name === 'pageFill') return [{ result: { results: args[0].map((j, i) => (i === 0 ? { id: j.id, ok: !failFill, err: failFill ? 'element not found' : undefined } : { id: j.id, ok: true, hidden: true, stopped: func.name === stopDuring })) } }];
      if (func.name === 'pageLinkedWaitFor') return [{ result: { found: true, waitedMs: 0 } }];
      if (func.name === 'pageLinkedIdle') return [{ result: { idle: true, dialogs: [], errors: [] } }];
      if (func.name === 'preStep') return [{ result: { ok: true } }];
      return [{ result: { clicked: true, confirmed: true } }];
    } },
  });
  const form = { id: 'aoc2', label: 'AOC-2', urlRe: /form-aoc2\.html/i, answersForm: 'aoc2', nextButton,
    buildData: (client, answers) => ({ values: { A: '1', B: '2' }, missing: missing.filter(m => !(answers && answers[m.key])), notes: [] }),
    jobs: () => [{ id: 'A', value: '1', selector: 'input[name="a"]' }, { id: 'B', value: '2' }],
    pre: pre ? [{ label: 'Upload', func: function preStep() {}, args: () => [] }] : undefined };
  set('LINKED_FORMS', { aoc2: form });
  if (running) R.LF.running = true;
  try {
    const res = await R.lfRun(auto ? { auto: true, ...opts } : undefined);
    const store = mem[R.LF_CHECKLIST_KEY];
    return { res, execs, steps: Object.fromEntries(R.LF.steps.map(s => [s.id, s.state])), mark: store && store[CIN] && store[CIN].aoc2 };
  } finally {
    for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete g[k]; else g[k] = saved[k]; }
    R.LF.lastRunKey = ''; R.LF.loadedKey = ''; R.LF.running = false; R.LF.preparing = false; R.LF.stopPending = false;
  }
}

test('Stop during the fill: no Save, no Proceed, run ends as a warning', async () => {
  const r = await runWithStop({ pre: false, stopDuring: 'pageFill' });
  assert.deepEqual(r.execs, ['pageFill', 'pageLinkedStop']);
  assert.equal(r.steps.fill, 'warn'); assert.equal(r.steps.save, 'skipped'); assert.equal(r.steps.proceed, 'skipped');
  assert.equal(r.mark.state, 'warn'); assert.match(r.mark.note, /Stopped/);
  assert.equal(r.res.state, 'stopped'); assert.equal(r.res.proceeded, false); assert.equal(r.res.form, 'aoc2');
});

test('Stop during a pre-step: the main fill (which would reset the page flag) never runs', async () => {
  const r = await runWithStop({ pre: true, stopDuring: 'preStep' });
  assert.deepEqual(r.execs, ['preStep', 'pageLinkedStop']);
  assert.equal(r.steps.pre, 'warn'); assert.equal(r.steps.fill, 'skipped'); assert.equal(r.steps.save, 'skipped');
});

test('without Stop the same run saves, confirms with the linked confirm and proceeds', async () => {
  const r = await runWithStop({ pre: true, stopDuring: null });
  assert.deepEqual(r.execs.slice(0, 5), ['preStep', 'pageFill', 'pageLinkedClickSave', 'pageLinkedConfirmSave', 'pageLinkedProceed']);
  assert.ok(!r.execs.includes('pageConfirmSave'));
  assert.equal(r.res.state, 'done'); assert.equal(r.res.form, 'aoc2'); assert.equal(r.res.proceeded, true);
  assert.match(r.res.nextUrl, /extract-of-auditor-standalone/);
  assert.match(r.res.note, /Saved/);
});

test('lfRun result: auto mode with required answers missing returns needs-answers without touching MCA', async () => {
  const missing = [
    { key: 'EMP_FEMALE', label: 'Female employees', type: 'number' },
    { key: 'WEBSITE', label: 'Website', type: 'text', optional: true },
  ];
  const r = await runWithStop({ pre: true, stopDuring: null, auto: true, missing });
  assert.deepEqual(r.execs, [], 'no page function ran');
  assert.equal(r.res.state, 'needs-answers'); assert.equal(r.res.form, 'aoc2'); assert.equal(r.res.proceeded, false);
  assert.deepEqual(r.res.missing.map(m => m.key), ['EMP_FEMALE']);
  assert.equal(r.mark, undefined, 'checklist untouched');
});

test('lfRun result: auto mode with only optional answers missing runs the form', async () => {
  const r = await runWithStop({ pre: false, stopDuring: null, auto: true, missing: [{ key: 'WEBSITE', label: 'Website', optional: true }] });
  assert.equal(r.res.state, 'done'); assert.equal(r.res.proceeded, true);
  assert.ok(r.execs.includes('pageLinkedClickSave'));
});

test("lfRun result: a form without Proceed (Board's report) is done, not proceeded", async () => {
  const r = await runWithStop({ pre: false, stopDuring: null, auto: true, nextButton: null });
  assert.equal(r.res.state, 'done'); assert.equal(r.res.proceeded, false); assert.equal(r.res.nextUrl, undefined);
  assert.ok(!r.execs.includes('pageLinkedProceed'));
});

test('lfRun result: busy while another run is going, not-linked on a non-linked page', async () => {
  const busy = await runWithStop({ pre: false, stopDuring: null, auto: true, running: true });
  assert.equal(busy.res.state, 'busy'); assert.deepEqual(busy.execs, []);
  const other = await runWithStop({ pre: false, stopDuring: null, auto: true,
    url: 'https://www.mca.gov.in/content/mca/global/en/mca/e-filing/annual-filings/form-aoc4.html' });
  assert.equal(other.res.state, 'not-linked'); assert.equal(other.res.proceeded, false); assert.deepEqual(other.execs, []);
});

test('auto mode waits for the MCA page (idle + first field) before filling', async () => {
  const r = await runWithStop({ pre: false, stopDuring: null, auto: true });
  assert.deepEqual(r.execs.slice(0, 3), ['pageLinkedIdle', 'pageLinkedWaitFor', 'pageFill']);
  assert.equal(r.res.state, 'done');
});

test('Stop pressed while the form is still loading (lfRun not yet running) is honoured: nothing on MCA', async () => {
  // The panel/autopilot Stop arrives during the company-master fetch, before LF.running is set.
  const r = await runWithStop({ pre: true, stopDuring: null, auto: true, onFetch: async () => { await R.lfStop(); } });
  assert.deepEqual(r.execs, [], 'no page function ran');
  assert.equal(r.res.state, 'stopped'); assert.equal(r.res.proceeded, false);
  assert.equal(r.mark, undefined, 'checklist untouched');
});

test('opts.shouldStop: a caller Stop during loading or during the fill stops before Save / Proceed', async () => {
  let stop = false;
  const early = await runWithStop({ pre: false, stopDuring: null, auto: true, onFetch: async () => { stop = true; }, opts: { shouldStop: () => stop } });
  assert.deepEqual(early.execs, []); assert.equal(early.res.state, 'stopped');
  let filled = false;
  const mid = await runWithStop({ pre: false, stopDuring: null, auto: true, onExec: n => { if (n === 'pageFill') filled = true; }, opts: { shouldStop: () => filled } });
  assert.deepEqual(mid.execs, ['pageLinkedIdle', 'pageLinkedWaitFor', 'pageFill'], 'no Save / Proceed after the stop');
  assert.equal(mid.res.state, 'stopped'); assert.equal(mid.res.proceeded, false);
});

test('auto mode: fields that could not be filled → saved but not proceeded (warn)', async () => {
  const r = await runWithStop({ pre: false, stopDuring: null, auto: true, failFill: true });
  assert.ok(r.execs.includes('pageLinkedClickSave'));
  assert.ok(!r.execs.includes('pageLinkedProceed'), 'Proceed is never clicked with failed fields in auto mode');
  assert.equal(r.res.state, 'warn'); assert.equal(r.res.proceeded, false);
  assert.equal(r.steps.proceed, 'skipped');
  // The manual button keeps its behaviour (the CA is watching).
  const manual = await runWithStop({ pre: false, stopDuring: null, failFill: true });
  assert.ok(manual.execs.includes('pageLinkedProceed'));
});

test('auto mode: answers given by the caller are used even when the company master has none', async () => {
  const missing = [{ key: 'EMP_FEMALE', label: 'Female employees', type: 'number' }];
  const r = await runWithStop({ pre: false, stopDuring: null, auto: true, missing, opts: { answers: { EMP_FEMALE: '3' } } });
  assert.equal(r.res.state, 'done');
  assert.ok(r.execs.includes('pageFill'));
});

test('lfBuildFor passes client and answers to the module', () => {
  const seen = [];
  const out = R.lfBuildFor({ buildData: (c, a) => { seen.push([c, a]); return { values: { X: 1 }, missing: [] }; } }, { general: { CIN } }, { A: '1' });
  assert.deepEqual(out.values, { X: 1 });
  assert.deepEqual(seen[0], [{ general: { CIN } }, { A: '1' }]);
  R.lfBuildFor({ buildData: (c, a) => { assert.deepEqual(a, {}); return {}; } }, null);
});

test('FilingChecklist.mark queues writes: concurrent marks never lose an update', async () => {
  const mem = {};
  globalThis.chrome = { storage: { local: {
    get: async k => { await new Promise(r => setTimeout(r, 5)); return { [k]: mem[k] && JSON.parse(JSON.stringify(mem[k])) }; },
    set: async o => { await new Promise(r => setTimeout(r, 5)); Object.assign(mem, o); },
  } } };
  try {
    const a = R.FilingChecklist.mark(CIN, 'step2', 'done', 'Saved');
    const b = R.FilingChecklist.mark(CIN, 'aoc2', 'active', 'Running…');
    const c = R.FilingChecklist.mark(CIN, 'aoc2', 'done', 'Saved · 6 filled');
    await Promise.all([a, b, c]);
    const v = await R.FilingChecklist.get(CIN);
    assert.equal(v.find(x => x.part === 'step2').state, 'done');
    assert.equal(v.find(x => x.part === 'aoc2').state, 'done');
    assert.equal(v.find(x => x.part === 'aoc2').note, 'Saved · 6 filled');
  } finally { delete globalThis.chrome; }
});

test('confirm save: an OK that does not close the popup gets the sure close (popup hidden)', async () => {
  const ok = el('button', { text: 'OK' });
  const dlg = el('div', { attrs: { role: 'dialog', id: 'guideContainer-rootPanel-modal_container_copy_354090110__' }, children: [el('p', { text: 'Data Added Successfully' }), ok] });
  dlg.style = {};
  await withDom([dlg], async () => {
    const r = await R.pageLinkedConfirmSave(500);
    assert.equal(r.confirmed, true); assert.equal(r.closed, true); assert.equal(r.forced, true);
  });
  assert.equal(dlg.style.display, 'none');
});

// ── second Save after MCA reported empty boxes: wait for MCA, re-check the tab ──
test('refill after MCA errors: waits for the page to be idle, then saves once more on the same form', async () => {
  let confirms = 0;
  const r = await runWithStop({ pre: false, stopDuring: null, respond: name => {
    if (name === 'pageLinkedConfirmSave') return ++confirms === 1
      ? { confirmed: false, errorsVisible: true, errorTexts: ['Please enter the relevant details'] } : { confirmed: true };
    return undefined;
  } });
  const i = r.execs.lastIndexOf('pageLinkedClickSave');
  assert.equal(r.execs.filter(n => n === 'pageLinkedClickSave').length, 2);
  assert.equal(r.execs[i - 1], 'pageLinkedIdle', 'MCA idle before the second Save');
  assert.equal(r.res.state, 'done');
});

test('refill after MCA errors: the tab left the form meanwhile → no second Save, no Proceed', async () => {
  let confirms = 0;
  const r = await runWithStop({ pre: false, stopDuring: null, respond: (name, tab) => {
    if (name === 'pageLinkedConfirmSave' && ++confirms === 1) return { confirmed: false, errorsVisible: true, errorTexts: ['Please enter the relevant details'] };
    // MCA redirected (session expiry) while the boxes were filled again.
    if (name === 'pageFill' && confirms === 1) tab.url = 'https://www.mca.gov.in/content/mca/global/en/foportal/fologin.html';
    return undefined;
  } });
  assert.equal(r.execs.filter(n => n === 'pageLinkedClickSave').length, 1, 'Save is not clicked a second time');
  assert.ok(!r.execs.includes('pageLinkedProceed'));
  assert.equal(r.res.state, 'warn'); assert.equal(r.res.proceeded, false);
  assert.match(r.res.note, /tab changed/);
});

// ── the panel's redetect never re-prepares under a running / preparing / autopilot run ──
test('redetect guard: only with the panel open and no run preparing, running or driven by the autopilot', async () => {
  assert.equal(R.lfMayRedetect(false), false);
  assert.equal(R.lfMayRedetect(true), true);
  R.LF.preparing = true; assert.equal(R.lfMayRedetect(true), false); R.LF.preparing = false;
  R.LF.running = true; assert.equal(R.lfMayRedetect(true), false); R.LF.running = false;
  const seen = [];
  const r = await runWithStop({ pre: false, stopDuring: null, auto: true,
    onFetch: async () => { seen.push(['prepare', R.lfMayRedetect(true)]); },
    onExec: n => { seen.push([n, R.lfMayRedetect(true)]); } });
  assert.equal(r.res.state, 'done');
  assert.ok(seen.length >= 3);
  assert.ok(seen.every(([, ok]) => ok === false), 'blocked for the whole autopilot run: ' + JSON.stringify(seen));
  assert.equal(R.lfMayRedetect(true), true, 'allowed again once the run ended');
});
