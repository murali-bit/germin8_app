// node --test tests/save-guards.test.mjs   (from extension/)
// Save guards on AOC-4 page 1, on a tiny fake DOM with mocked timers (no MCA, no browser):
// - the Q12(c) watcher (pageArmManualSave): automatic only when the extension filled every box; after the CA
//   types it waits for 4 s idle with the cursor out of the section; a Save the CA clicks is never clicked again;
//   Stop / pageDisarmManualSave / expiry switch it off for good;
// - pageSave never guesses a Save when the phase's anchor is missing, and a stale (timed-out / stopped) call
//   cannot click;
// - runSaveLoop treats a timed-out Save as clicked-unconfirmed (one Save click, one confirm, no re-click);
// - requestFillStop disarms the Q12(c) watcher on its tab;
// - the fix panel writer (pageApplyCorrections) only writes exact matches.
import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import { FakeEl, installDom, flush } from './fake-dom.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
globalThis.window = globalThis;
// Page functions and the side-panel runner, loaded as the side panel loads them (plain scripts, shared globals).
vm.runInThisContext(readFileSync(path.join(here, '../js/page-automation.js'), 'utf8'), { filename: 'page-automation.js' });
vm.runInThisContext(readFileSync(path.join(here, '../js/phase-runner.js'), 'utf8'), { filename: 'phase-runner.js' });
globalThis.withTimeout = p => p; // no dangling 60 s timers in tests
globalThis.FIELD_MAPPINGS = [];

const el = (tag, opts) => new FakeEl(tag, opts);
const ANCHOR = 'Particulars of the service provider (if any)';

// Q12(c): heading, three text boxes, cloud Yes/No radios, then Part A's Save below the section.
function q12({ values = ['', '', ''], cloud = false } = {}) {
  const boxes = values.map((v, i) => el('input', { type: 'text', label: `Provider ${i}`, value: v }));
  const yes = el('input', { type: 'radio', name: 'cloud', value: 'Yes', checked: cloud });
  const no = el('input', { type: 'radio', name: 'cloud', value: 'No' });
  const section = el('div', { children: [el('span', { text: ANCHOR }), ...boxes, yes, no] });
  const save = el('button', { text: 'Save' });
  const dom = installDom([section, save]);
  return { ...dom, section, boxes, yes, save };
}
async function advance(ms) {
  for (let t = 0; t < ms; t += 100) { mock.timers.tick(100); await flush(); }
}
// Runs a page call under the mocked clock until it settles (at most maxMs of page time).
async function settle(promise, maxMs = 60000) {
  let done = false, out, err;
  promise.then(v => { done = true; out = v; }, e => { done = true; err = e; });
  for (let t = 0; !done && t < maxMs; t += 100) { mock.timers.tick(100); await flush(); }
  if (err) throw err;
  assert.ok(done, "page call did not finish");
  return out;
}

beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_700_000_000_000 });
  delete globalThis.__aoc4ManualProviderSave;
  delete globalThis.__germin8StopFill;
  delete globalThis.__g8SaveRun;
});
afterEach(() => { mock.timers.reset(); });

// ── Q12(c) watcher ──
test('Q12(c): the extension filled every box → Save is clicked automatically once (the automatic path)', async () => {
  const p = q12({ values: ['Acme Cloud', 'Line 1', 'Bengaluru'], cloud: true });
  assert.deepEqual(pageArmManualSave(0, ANCHOR), { armed: true, sectionFound: true });
  await advance(700);
  assert.equal(p.save.clicks, 1);
  assert.equal(globalThis.__aoc4ManualProviderSave.completed, true);
  assert.equal(p.listenerCount(), 0, 'listeners removed after the click');
  await advance(10000);
  assert.equal(p.save.clicks, 1, 'never a second click');
});

test('Q12(c): while the CA types, nothing is clicked; Save only after 4 s idle with the cursor out of the section', async () => {
  const p = q12({ values: ['Acme Cloud', 'Line 1', ''], cloud: true });
  pageArmManualSave(0, ANCHOR);
  await advance(700);
  assert.equal(p.save.clicks, 0, 'a box is still empty');
  // The CA types one letter into the last box and pauses with the cursor still in it.
  p.doc.activeElement = p.boxes[2];
  p.boxes[2].value = 'A';
  p.fire('input', p.boxes[2]);
  await advance(1000);
  assert.equal(p.save.clicks, 0, 'no click 1 s after a keystroke (the old watcher clicked at 0.6 s)');
  await advance(10000);
  assert.equal(p.save.clicks, 0, 'no click while the cursor is still in a Q12(c) box');
  // The CA finishes and leaves the box.
  p.boxes[2].value = 'Address line';
  p.fire('input', p.boxes[2]);
  p.doc.activeElement = p.doc.body;
  p.fire('focusout', p.boxes[2]);
  await advance(3000);
  assert.equal(p.save.clicks, 0, 'still inside the 4 s idle window');
  await advance(1500);
  assert.equal(p.save.clicks, 1, 'clicked once the CA has been idle 4 s with the cursor out of the section');
});

test('Q12(c): a Save the CA clicks is the save — the watcher never clicks it a second time', async () => {
  const p = q12({ values: ['Acme Cloud', 'Line 1', ''], cloud: true });
  pageArmManualSave(0, ANCHOR);
  await advance(700);
  p.boxes[2].value = 'Address line';
  p.fire('input', p.boxes[2]);
  p.fire('focusout', p.boxes[2]);
  // The CA clicks MCA's Save before the idle window ends.
  p.fire('click', p.save); p.save.clicks++;
  await advance(10000);
  assert.equal(p.save.clicks, 1, 'only the CA\'s own click');
  assert.equal(globalThis.__aoc4ManualProviderSave.completed, true);
  assert.equal(globalThis.__aoc4ManualProviderSave.clickedBy, 'user');
  assert.equal(p.listenerCount(), 0);
});

test('Q12(c): Stop (page stop flag) is final — no click afterwards', async () => {
  const p = q12({ values: ['Acme Cloud', 'Line 1', ''], cloud: true });
  pageArmManualSave(0, ANCHOR);
  await advance(700);
  globalThis.__germin8StopFill = true;
  p.boxes[2].value = 'Address line';
  p.fire('input', p.boxes[2]);
  p.doc.activeElement = p.doc.body;
  p.fire('focusout', p.boxes[2]);
  await advance(10000);
  assert.equal(p.save.clicks, 0);
  assert.equal(p.listenerCount(), 0, 'the watcher switched itself off');
});

test('Q12(c): pageDisarmManualSave removes listeners, observer and toast; nothing is clicked later', async () => {
  const p = q12({ values: ['Acme Cloud', 'Line 1', ''], cloud: true });
  pageArmManualSave(0, ANCHOR);
  const toast = p.body.append(el('div', { id: 'aoc4-manual-save-toast', text: 'x' }));
  assert.ok(p.listenerCount() > 0);
  assert.deepEqual(pageDisarmManualSave(), { disarmed: true });
  assert.equal(p.listenerCount(), 0);
  assert.equal(p.observers.every(o => !o.on), true, 'observer disconnected');
  assert.equal(toast.parentElement, null, 'toast removed');
  p.boxes[2].value = 'Address line';
  p.fire('input', p.boxes[2]);
  await advance(10000);
  assert.equal(p.save.clicks, 0);
  assert.deepEqual(pageDisarmManualSave(), { disarmed: false }, 'second call: nothing armed');
  assert.equal(globalThis.__aoc4ManualProviderSave.completed, false, 'not reported as saved');
});

test('Q12(c): the watcher expires — an edit 31 minutes later clicks nothing', async () => {
  const p = q12({ values: ['Acme Cloud', 'Line 1', ''], cloud: true });
  pageArmManualSave(0, ANCHOR);
  await advance(700);
  mock.timers.setTime(Date.now() + 31 * 60 * 1000);
  p.boxes[2].value = 'Address line';
  p.fire('input', p.boxes[2]);
  p.doc.activeElement = p.doc.body;
  p.fire('focusout', p.boxes[2]);
  await advance(6000);
  assert.equal(p.save.clicks, 0);
});

// ── pageSave: no guessing, abortable ──
function partAB({ withAnchor = false, labelsTo = 'b' } = {}) {
  const saveA = el('button', { text: 'Save' });
  const saveB = el('button', { text: 'Save' });
  const field = el('input', { type: 'text', label: 'Details of trade receivables amount', value: '100' });
  const nodes = [el('div', { text: 'Part A' }), saveA, el('div', { text: 'Part B' })];
  if (withAnchor) nodes.push(el('span', { text: 'Details of trade receivables' }));
  if (labelsTo === 'b') nodes.push(field);
  nodes.push(saveB);
  const dom = installDom(nodes);
  return { ...dom, saveA, saveB };
}

test('pageSave: anchor missing → no fallback to the last Save; not clicked, reported as anchorMissing', async () => {
  const p = partAB({ labelsTo: 'none' });
  const r = await settle(pageSave(1, 'Details of trade receivables', 3, ['Some label nobody has'], []));
  assert.equal(r.clicked, false);
  assert.equal(r.anchorMissing, true);
  assert.equal(p.saveA.clicks + p.saveB.clicks, 0);
});

test('pageSave: anchor missing → the Save right after the phase\'s filled field is used', async () => {
  const p = partAB({ labelsTo: 'b' });
  const r = await settle(pageSave(1, 'Section title not on page', 3, ['Details of trade receivables amount'], []));
  assert.equal(r.clicked, true);
  assert.equal(r.via, 'after-first-field');
  assert.equal(p.saveB.clicks, 1);
  assert.equal(p.saveA.clicks, 0);
});

test('pageSave: no anchor configured (Phase 1) and no Save at its index → not clicked (no "last Save" guess)', async () => {
  const p = installDom([el('button', { text: 'Save', hidden: true }), el('button', { text: 'Save' })]);
  const r = await settle(pageSave(1, null, 1, [], []));
  assert.equal(r.clicked, false);
  assert.equal(p.body.children.reduce((n, b) => n + b.clicks, 0), 0);
});

test('pageSave: a stopped / replaced call never clicks', async () => {
  const p = partAB({ withAnchor: true });
  globalThis.__germin8StopFill = true;
  const r = await settle(pageSave(1, 'Details of trade receivables', 3, [], []));
  assert.equal(r.clicked, false); assert.equal(r.aborted, true);
  assert.equal(p.saveB.clicks, 0);
  // A greyed Save keeps an earlier call waiting; the side panel then replaces the token (timeout) → no click later.
  globalThis.__germin8StopFill = false;
  p.saveB.disabled = true;
  const run = pageSave(1, 'Details of trade receivables', 3, [], []);
  await advance(1000);
  globalThis.__g8SaveRun = { aborted: true };
  p.saveB.disabled = false;
  const late = await settle(run);
  assert.equal(late.clicked, false);
  assert.equal(p.saveB.clicks, 0, 'the stale call did not click');
});

// ── runSaveLoop: timeout = clicked, unconfirmed ──
test('runSaveLoop: a timed-out Save is never clicked again — one confirm, not left for the final sweep', async () => {
  mock.timers.reset();
  const calls = [];
  globalThis.chrome = { scripting: { executeScript: async ({ func }) => {
    calls.push(func === pageSave || func === pageConfirmSave ? func.name : 'abort');
    if (func === pageSave) throw new Error('save-timeout');
    if (func === pageConfirmSave) return [{ result: { confirmed: false, errorsVisible: false, dialogs: [] } }];
    return [{ result: null }];
  } } };
  const { save } = await runSaveLoop(7, { id: 3, saveIndex: 1, saveAnchor: 'Details of trade receivables' }, [], () => { });
  assert.equal(calls.filter(n => n === 'pageSave').length, 1, 'Save clicked once only');
  assert.equal(calls.filter(n => n === 'pageConfirmSave').length, 1);
  assert.ok(calls.indexOf('abort') > -1 && calls.indexOf('abort') < calls.indexOf('pageConfirmSave'), 'the stale in-page call is aborted first');
  assert.equal(save.clicked, true); assert.equal(save.timedOut, true); assert.equal(save.unconfirmed, true);
});

test('runSaveLoop: a missing anchor is not retried', async () => {
  mock.timers.reset();
  const calls = [];
  globalThis.chrome = { scripting: { executeScript: async ({ func }) => {
    calls.push(func.name);
    if (func === pageSave) return [{ result: { clicked: false, found: 2, anchorMissing: true, dialogs: [] } }];
    return [{ result: null }];
  } } };
  const { save } = await runSaveLoop(7, { id: 3, saveIndex: 1, saveAnchor: 'x' }, [], () => { });
  assert.deepEqual(calls, ['pageSave']);
  assert.equal(save.clicked, false); assert.equal(save.anchorMissing, true);
});

// ── Stop disarms the watcher ──
test('requestFillStop runs pageDisarmManualSave on the tab where Q12(c) was armed (fill already finished)', async () => {
  mock.timers.reset();
  const calls = [];
  globalThis.chrome = { scripting: { executeScript: async ({ target, func }) => { calls.push([target.tabId, func === pageDisarmManualSave ? func.name : 'stopFlag']); return [{ result: {} }]; } } };
  vm.runInThisContext('fillRunTabId = null; manualArmTabId = 42; fillStopRequested = false;');
  await requestFillStop();
  assert.deepEqual(calls, [[42, 'stopFlag'], [42, 'pageDisarmManualSave']]);
  // Errors on the page are ignored: Stop itself never throws.
  globalThis.chrome = { scripting: { executeScript: async () => { throw new Error('No tab with id'); } } };
  vm.runInThisContext('manualArmTabId = 43;');
  await requestFillStop();
  vm.runInThisContext('fillStopRequested = false;');
});

// ── Fix panel writer ──
test('pageApplyCorrections: exact label / formcontrolname / id only; never unlabeled, hidden, disabled or read-only', () => {
  mock.timers.reset();
  let selectSet = null;
  class FakeSelect extends FakeEl { set value(v) { selectSet = v; this._value = v; } get value() { return this._value; } }
  const unlabeled = el('input', { type: 'text' });
  const hiddenOne = el('input', { type: 'hidden', label: 'Date of AGM' });
  const disabledOne = el('input', { type: 'text', label: 'Date of AGM', disabled: true });
  const roOne = el('input', { type: 'text', label: 'Date of AGM', readOnly: true });
  const longer = el('input', { type: 'text', label: 'Date of AGM if held' }); // the old reverse "includes" matched this
  const agm = el('input', { type: 'text', label: 'Date of AGM' });
  const byControl = el('input', { type: 'text', attrs: { formcontrolname: 'auditor_pan' } });
  const sel = new FakeSelect('select', { label: 'State' });
  installDom([unlabeled, hiddenOne, disabledOne, roOne, longer, agm, byControl, sel]);
  const r = pageApplyCorrections({ date_of_agm: '30/09/2025', auditor_pan: 'ABCDE1234F', state: 'Karnataka', field_0: 'junk', unknown_box: 'x' });
  assert.equal(r.written, 3);
  assert.equal(agm.value, '30/09/2025');
  assert.equal(byControl.value, 'ABCDE1234F');
  assert.equal(selectSet, 'Karnataka', 'the select is written with its own prototype setter');
  for (const e of [unlabeled, hiddenOne, disabledOne, roOne, longer]) assert.equal(e.value, '', 'untouched');
  assert.equal(pageApplyCorrections({ field_0: 'x' }).written, 0, 'unparsed MCA text is left for the CA');
});
