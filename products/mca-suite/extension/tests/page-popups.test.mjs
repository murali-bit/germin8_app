// node --test tests/page-popups.test.mjs   (from extension/)
// MCA keeps its popup templates in the DOM, hidden by visibility:hidden / opacity:0 / aria-hidden (not display:none).
// Every in-page popup reader in page-automation.js and srn-cleanup.js must ignore them: not report their text, not
// click their OK / Yes, not force-hide them, while a popup that is really shown is still read and closed.
// Made-up data only.
import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import { FakeEl, installDom, installComputedStyle, flush } from './fake-dom.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
globalThis.window = globalThis;
vm.runInThisContext(readFileSync(path.join(here, '../js/page-automation.js'), 'utf8'), { filename: 'page-automation.js' });
vm.runInThisContext(readFileSync(path.join(here, '../js/srn-cleanup.js'), 'utf8'), { filename: 'srn-cleanup.js' });

const el = (tag, opts) => new FakeEl(tag, opts);

// An MCA-style popup box: message + one button. `how` makes it a hidden template.
function popup(message, button = 'OK', how = {}, extra = {}) {
  const btn = button ? el('button', { text: button }) : null;
  const box = el('div', {
    id: extra.id || `modal_container_${Math.random().toString(36).slice(2, 8)}`,
    cls: 'modal', attrs: { role: 'dialog', ...(how.attrs || {}) },
    invisible: !!how.invisible, style: { position: 'fixed', ...(how.style || {}) },
    children: [el('p', { text: message }), ...(btn ? [btn] : [])],
  });
  if (btn) btn.onClick = b => { if (extra.closeOnClick !== false) box.remove(); };
  return { box, btn };
}
// The hidden templates seen on the live page, each hidden a different way.
function templates() {
  return [
    popup('Your request for the form has been submitted successfully against SRN', 'OK', { invisible: true }),
    popup('Data saved successfully', 'OK', { style: { opacity: '0' } }),
    popup('Technical Error Occurred. Please Try Again After Some Time.', 'OK', { attrs: { 'aria-hidden': 'true' } }),
    popup('Changing CIN reset the entire form. Do you wish to proceed', 'Yes', { style: { visibility: 'hidden' } }),
    popup('SRN selected will be cancelled. Do you want to proceed?', 'Yes', { invisible: true }),
  ];
}
const untouched = list => {
  for (const t of list) {
    assert.equal(t.btn.clicks, 0, `template button clicked: ${t.box.textContent}`);
    assert.notEqual(t.box.style.display, 'none', `template force-hidden: ${t.box.textContent}`);
    assert.ok(t.box.parentElement, 'template still in the DOM');
  }
};

// getComputedStyle from fake-dom, plus position / pointer-events (pageWaitForIdle only dismisses floating boxes).
function installStyle() {
  const base = installComputedStyle();
  const stub = e => ({ ...base(e), position: (e && e.style && e.style.position) || 'static', pointerEvents: 'auto', overflowY: 'visible' });
  globalThis.getComputedStyle = stub;
  return stub;
}

async function settle(promise, maxMs = 60000) {
  let done = false, out, err;
  promise.then(v => { done = true; out = v; }, e => { done = true; err = e; });
  for (let t = 0; !done && t < maxMs; t += 100) { mock.timers.tick(100); await flush(); }
  if (err) throw err;
  assert.ok(done, 'page call did not finish');
  return out;
}

beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_700_000_000_000 });
  delete globalThis.__aoc4ManualProviderSave;
  delete globalThis.__germin8StopFill;
  delete globalThis.__g8SaveRun;
  delete globalThis.guideBridge;
  installStyle();
});
afterEach(() => { mock.timers.reset(); delete globalThis.getComputedStyle; });

// â”€â”€ pageConfirmSave â”€â”€
test('pageConfirmSave: hidden templates (success / error words, OK buttons) are not read, clicked or hidden', async () => {
  const tpl = templates();
  const hiddenErr = el('div', { cls: 'guideFieldError', text: 'This field is required', invisible: true });
  installDom([...tpl.map(t => t.box), el('div', { cls: 'guideFieldNode', children: [hiddenErr] })]);
  const r = await settle(pageConfirmSave(2000));
  assert.equal(r.confirmed, false);
  assert.equal(r.errorsVisible, false, 'a hidden field-error template is not an error');
  assert.deepEqual(r.dialogs, []);
  untouched(tpl);
});

test('pageConfirmSave: a really shown success popup is still read and closed', async () => {
  const tpl = templates();
  const real = popup('Data saved successfully for this section');
  installDom([...tpl.map(t => t.box), real.box]);
  const r = await settle(pageConfirmSave(2000));
  assert.equal(r.confirmed, true);
  assert.equal(real.btn.clicks, 1);
  assert.match(r.dialogs[0].msg, /saved successfully for this section/);
  untouched(tpl);
});

test('pageConfirmSave: a shown success popup without a button is force-closed; the templates never are', async () => {
  const tpl = templates();
  const real = popup('Record saved successfully', null, {}, { id: 'modal_container_real' });
  const { body } = installDom([...tpl.map(t => t.box), real.box]);
  body.classList = { remove() { } };
  const r = await settle(pageConfirmSave(5000));
  assert.equal(r.confirmed, true);
  assert.equal(real.box.style.display, 'none', 'the shown popup is hidden');
  assert.equal(r.popupOpen, false);
  untouched(tpl);
});

test('pageConfirmSave: a shown field error is still reported', async () => {
  const tpl = templates();
  const shownErr = el('div', { cls: 'guideFieldError', text: 'Please enter a valid PIN code' });
  installDom([...tpl.map(t => t.box), el('div', { cls: 'guideFieldNode', children: [shownErr] })]);
  const r = await settle(pageConfirmSave(2000));
  assert.equal(r.errorsVisible, true);
  assert.deepEqual(r.errorTexts, ['Please enter a valid PIN code']);
  untouched(tpl);
});

// â”€â”€ pageSave â”€â”€
test('pageSave: hidden templates are not closed before or after Save; the real success popup is', async () => {
  const tpl = templates();
  const hiddenErr = el('div', { cls: 'guideFieldError', text: 'This field is required', invisible: true });
  const real = popup('Data saved successfully');
  const save = el('button', { text: 'Save' });
  const { body } = installDom([...tpl.map(t => t.box), el('div', { children: [el('input', { type: 'text', label: 'X', value: 'v' }), hiddenErr] }), save]);
  save.onClick = () => body.append(real.box);
  const r = await settle(pageSave(0, null, 1, [], []));
  assert.equal(save.clicks, 1);
  assert.equal(r.clicked, true);
  assert.equal(r.successModalClosed, true);
  assert.equal(real.btn.clicks, 1);
  assert.equal(r.dialogs.filter(d => d.type === 'page-success').length, 1);
  untouched(tpl);
});

test('pageSave: with only templates on screen, no success is claimed and a hidden error template is not a validation error', async () => {
  const tpl = templates();
  const hiddenErr = el('span', { cls: 'guideFieldError', text: 'Please enter Name of the auditor', invisible: true });
  const save = el('button', { text: 'Save' });
  // Directly under body: the fake DOM's innerText of a parent would still include a hidden child's text.
  installDom([...tpl.map(t => t.box), hiddenErr, save]);
  const r = await settle(pageSave(0, null, 2, ['Name of the auditor'], []));
  assert.equal(save.clicks, 1);
  assert.equal(r.successModalClosed, false);
  assert.equal(r.validationErrors, undefined);
  untouched(tpl);
});

// â”€â”€ pageWaitForIdle â”€â”€
test('pageWaitForIdle: dismisses only the shown popup, never a hidden template', async () => {
  const tpl = templates();
  const real = popup('Your session is about to expire. Continue', 'Continue');
  installDom([...tpl.map(t => t.box), real.box,
    el('input', {}), el('input', {}), el('input', {}), el('input', {}), el('input', {})]);
  const r = await settle(pageWaitForIdle(2000));
  assert.equal(real.btn.clicks, 1);
  assert.equal(r.dialogs.length, 1);
  assert.match(r.dialogs[0].msg, /session is about to expire/);
  untouched(tpl);
});

test('pageWaitForIdle: with only templates, nothing is clicked and no dialog is reported', async () => {
  const tpl = templates();
  installDom([...tpl.map(t => t.box), el('input', {}), el('input', {}), el('input', {}), el('input', {}), el('input', {})]);
  const r = await settle(pageWaitForIdle(1000));
  assert.deepEqual(r.dialogs, []);
  assert.equal(r.idle, true);
  untouched(tpl);
});

// â”€â”€ pageArmManualSave (Q12(c) watcher) â”€â”€
const ANCHOR = 'Particulars of the service provider (if any)';
function q12(extraBoxes, real) {
  const boxes = ['Acme Cloud', 'Line 1', 'Bengaluru'].map((v, i) => el('input', { type: 'text', label: `Provider ${i}`, value: v }));
  const yes = el('input', { type: 'radio', name: 'cloud', value: 'Yes', checked: true });
  const section = el('div', { children: [el('span', { text: ANCHOR }), ...boxes, yes] });
  const save = el('button', { text: 'Save' });
  const dom = installDom([...extraBoxes, section, save]);
  if (real) save.onClick = () => dom.body.append(real.box);
  return { ...dom, save };
}
// The fake DOM has no id / textContent setters, so find the toast by its colour: green = MCA confirmed, amber = not.
const toastColour = () => (document.body.children.find(c => c.style.background) || { style: {} }).style.background || '';

test('Q12(c) watcher: after its Save, a hidden success template is not taken as MCA\'s confirmation', async () => {
  const tpl = templates();
  const p = q12(tpl.map(t => t.box), null);
  pageArmManualSave(0, ANCHOR);
  for (let t = 0; t < 4000; t += 100) { mock.timers.tick(100); await flush(); }
  assert.equal(p.save.clicks, 1);
  assert.equal(toastColour(), '#8b5d00', 'reported as clicked-unconfirmed');
  untouched(tpl);
});

test('Q12(c) watcher: the real success popup is closed and reported as confirmed', async () => {
  const tpl = templates();
  const real = popup('Data added successfully');
  const p = q12(tpl.map(t => t.box), real);
  pageArmManualSave(0, ANCHOR);
  for (let t = 0; t < 4000; t += 100) { mock.timers.tick(100); await flush(); }
  assert.equal(p.save.clicks, 1);
  assert.equal(real.btn.clicks, 1);
  assert.equal(toastColour(), '#176b3a', 'reported as confirmed by MCA');
  untouched(tpl);
});

// â”€â”€ pageDiagnoseSave â”€â”€
test('pageDiagnoseSave: visibleModals lists the shown popup only', () => {
  const tpl = templates();
  const real = popup('Please wait for the earlier request');
  installDom([...tpl.map(t => t.box), real.box]);
  globalThis.location = { href: 'https://example.test/form' };
  const r = pageDiagnoseSave();
  assert.equal(r.visibleModals.length, 1);
  assert.match(r.visibleModals[0].text, /earlier request/);
});

// â”€â”€ pageSrn cancelFirst (srn-cleanup.js) â”€â”€
function srnPage(tpl, showReal) {
  const cancel = el('button', { text: 'Cancel SRN' });
  const row = el('div', { children: [el('span', { text: 'AOC-4 U12345KA2020PTC000001 Example Pvt Ltd Draft/Pending Submission' }), cancel] });
  const realBox = popup('SRN selected will be cancelled. Do you want to proceed?', 'Yes');
  const dom = installDom([...tpl.map(t => t.box), el('div', { children: [row] })]);
  if (showReal) cancel.onClick = () => dom.body.append(realBox.box);
  return { cancel, real: realBox };
}

test('pageSrn cancelFirst: the hidden "confirm cancel" template is never answered Yes', async () => {
  const tpl = templates();
  const p = srnPage(tpl, false);
  const r = await settle(pageSrn('cancelFirst', {}), 20000);
  assert.equal(p.cancel.clicks, 1);
  assert.equal(r.clicked, false);
  assert.match(r.err, /did not appear/);
  untouched(tpl);
});

test('pageSrn cancelFirst: the shown "confirm cancel" popup is answered Yes', async () => {
  const tpl = templates();
  const p = srnPage(tpl, true);
  const r = await settle(pageSrn('cancelFirst', {}), 20000);
  assert.equal(r.clicked, true);
  assert.equal(p.real.btn.clicks, 1);
  untouched(tpl);
});
