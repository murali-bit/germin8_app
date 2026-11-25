// node --test tests/linked-popups.test.mjs  (from D:/MCA_final/extension)
// MCA keeps hidden popup templates in the DOM (visibility:hidden / opacity:0 / aria-hidden boxes that still have
// client rects). The page functions below must read, click and force-close only popups that are really shown.
// Made-up data only.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeEl, installDom, installComputedStyle, matches } from './fake-dom.mjs';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const R = require('../js/linked/runner.js');
const F = require('../js/linked/aoc2.js');
const ENGINE = new Function(fs.readFileSync(path.join(here, '../js/adt1-engine.js'), 'utf8') + '\nreturn { pageAdt1, pageAttach };')();

const el = (tag, opts) => new FakeEl(tag, opts);
let tplN = 0;
// One of MCA's hidden popup templates: an AEM modal_container box, laid out but invisible, with its own OK.
function template(msg, how = { invisible: true }) {
  const ok = el('button', { text: 'OK' });
  const box = el('div', {
    id: `guideContainer-rootPanel-modal_container_${++tplN}__`, cls: 'guideDialogNode',
    ...how, children: [el('p', { text: msg }), ok],
  });
  return { box, ok };
}
// The texts the side panel wrongly reported on AOC-4 page 2 (generic wording, no client data).
const TEMPLATE_TEXTS = [
  'Error Type Error Message',
  'Please verify that date entered is correct. Do you want to change the entered date',
  'Form filing is not allowed since Declaration for commencement of business is not filed',
  'The total size of all attachments should not be more than 10 MB',
  'Technical Error Occurred. Please Try Again After Some Time.',
];
const templates = () => TEMPLATE_TEXTS.map(t => template(t));

beforeEach(() => {
  delete globalThis.getComputedStyle;
  globalThis.location = { href: 'https://www.mca.gov.in/form.html' };
});

function setup(children) {
  const dom = installDom(children);
  installComputedStyle();
  return dom;
}

// ───────────────────────── runner.js: pageLinkedConfirmSave ─────────────────────────

test('confirm save: a hidden "Data saved successfully" template never confirms, is not clicked, not hidden', async () => {
  for (const how of [{ invisible: true }, { attrs: { 'aria-hidden': 'true' } }, { style: { opacity: '0' } }, { zero: true }]) {
    const t = template('Data saved successfully', how.zero ? {} : how);
    if (how.zero) t.box.getBoundingClientRect = () => ({ width: 0, height: 0 });
    const others = templates();
    setup([t.box, ...others.map(o => o.box)]);
    const r = await R.pageLinkedConfirmSave(300);
    assert.equal(r.confirmed, false, JSON.stringify(how));
    assert.equal(r.errorsVisible, false);
    assert.deepEqual(r.dialogs, [], 'hidden templates are not reported');
    assert.equal(t.ok.clicks, 0);
    assert.equal(t.box.style.display, '', 'a hidden template is never force-hidden');
    for (const o of others) { assert.equal(o.ok.clicks, 0); assert.equal(o.box.style.display, ''); }
  }
});

test('confirm save: a really shown success popup is read and closed; templates around it are left alone', async () => {
  const others = templates();
  const ok = el('button', { text: 'OK', onClick: () => popup.remove() });
  const popup = el('div', { id: 'guideContainer-rootPanel-modal_container_shown__', children: [el('p', { text: 'Data Saved Successfully' }), ok] });
  setup([...others.map(o => o.box), popup]);
  const r = await R.pageLinkedConfirmSave(300);
  assert.equal(r.confirmed, true);
  assert.equal(r.closed, true);
  assert.equal(r.forced, false);
  assert.match(r.msg, /Data Saved Successfully/);
  assert.equal(ok.clicks, 1);
  for (const o of others) { assert.equal(o.ok.clicks, 0); assert.equal(o.box.style.display, ''); }
});

test('confirm save: force-close only hits the shown popup whose OK did not close it', async () => {
  const t = template('Data saved successfully');
  const ok = el('button', { text: 'OK' }); // does not close the popup
  const popup = el('div', { id: 'guideContainer-rootPanel-modal_container_real__', children: [el('p', { text: 'Data Added Successfully' }), ok] });
  setup([t.box, popup]);
  const r = await R.pageLinkedConfirmSave(300);
  assert.equal(r.confirmed, true); assert.equal(r.forced, true);
  assert.equal(popup.style.display, 'none');
  assert.equal(t.box.style.display, '');
  assert.equal(t.ok.clicks, 0);
});

test('confirm save: nested container + content: the inner (shortest) box is the one read', async () => {
  const ok = el('button', { text: 'OK', onClick: () => outer.remove() });
  const inner = el('div', { cls: 'modal-dialog', children: [el('p', { text: 'Data saved successfully' }), ok] });
  const outer = el('div', { id: 'x-modal_container_7__', children: [el('span', { text: 'Message' }), inner] });
  setup([outer]);
  const r = await R.pageLinkedConfirmSave(300);
  assert.equal(r.confirmed, true);
  assert.equal(r.msg, 'Data saved successfully OK');
  assert.equal(ok.clicks, 1);
});

test('confirm save: a hidden field-error template is not reported; a shown one is', async () => {
  setup([el('div', { cls: 'guideFieldError', text: 'Please enter a valid date', invisible: true })]);
  let r = await R.pageLinkedConfirmSave(300);
  assert.equal(r.errorsVisible, false);
  setup([el('div', { cls: 'guideFieldError', text: 'Please enter a valid date' })]);
  r = await R.pageLinkedConfirmSave(300);
  assert.equal(r.errorsVisible, true);
  assert.deepEqual(r.errorTexts, ['Please enter a valid date']);
});

// ───────────────────────── runner.js: pageLinkedIdle ─────────────────────────

test('idle: hidden error templates are not clicked or reported; a shown popup is', async () => {
  const others = TEMPLATE_TEXTS.map(t => {
    const ok = el('button', { text: 'OK' });
    return { ok, box: el('div', { attrs: { role: 'dialog' }, invisible: true, children: [el('p', { text: t }), ok] }) };
  });
  setup(others.map(o => o.box));
  let r = await R.pageLinkedIdle(500);
  assert.deepEqual(r.dialogs, []);
  for (const o of others) assert.equal(o.ok.clicks, 0);

  const ok = el('button', { text: 'OK' });
  const real = el('div', { attrs: { role: 'dialog' }, children: [el('p', { text: 'Please check the values entered' }), ok] });
  setup([...others.map(o => o.box), real]);
  r = await R.pageLinkedIdle(500);
  assert.deepEqual(r.dialogs, ['Please check the values entered OK']);
  assert.equal(ok.clicks, 1);
  for (const o of others) assert.equal(o.ok.clicks, 0);
});

// ───────────────────────── aoc2.js: pageAoc2Upload ─────────────────────────

const TAIL = 'panel_885569515-panel_copy-panel-panel_copy-saveguidedraft_919477717';
function uploadPage(extra, onUpload) {
  const data = el('input', { label: 'atArmSubmitData', value: '[{},{}]' });
  const btn = el('button', {
    text: 'Upload',
    onClick: () => {
      const input = new globalThis.HTMLInputElement();
      input.type = 'file';
      input.dispatchEvent = () => true;
      input.click();
      if (onUpload) onUpload();
    },
  });
  const box = el('div', { id: 'guideContainer-' + TAIL, children: [btn] });
  box.matches = s => matches(box, s);
  setup([box, data, ...extra]);
  globalThis.DataTransfer = class { constructor() { const a = []; this.items = { add: f => a.push(f) }; this.files = a; } };
  return { btn, data };
}

test('AOC-2 upload: hidden error/success templates are ignored (no mca-error, no click, no success)', async () => {
  const others = TEMPLATE_TEXTS.map(t => {
    const ok = el('button', { text: 'OK' });
    return { ok, box: el('div', { attrs: { role: 'dialog' }, invisible: true, children: [el('p', { text: t }), ok] }) };
  });
  const okS = el('button', { text: 'OK' });
  const succ = el('div', { cls: 'modal-dialog', invisible: true, children: [el('p', { text: 'File uploaded successfully' }), okS] });
  uploadPage([...others.map(o => o.box), succ]);
  const r = await F.pageAoc2Upload('QUJD', 'x.xlsm', 'atArm', 2, 1200);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'timeout', JSON.stringify(r));
  assert.deepEqual(r.dialogs, []);
  for (const o of others) assert.equal(o.ok.clicks, 0);
  assert.equal(okS.clicks, 0);
});

test('AOC-2 upload: a shown MCA error popup is read and closed with OK', async () => {
  const t = TEMPLATE_TEXTS.map(x => template(x));
  const ok = el('button', { text: 'OK' });
  const real = el('div', { attrs: { role: 'dialog' }, children: [el('p', { text: 'Excel File do not match with the number of records' }), ok] });
  uploadPage([...t.map(o => o.box), real]);
  const r = await F.pageAoc2Upload('QUJD', 'x.xlsm', 'atArm', 2, 3000);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'mca-error');
  assert.equal(r.dialogs.length, 1);
  assert.match(r.dialogs[0], /do not match/);
  assert.equal(ok.clicks, 1);
  for (const o of t) assert.equal(o.ok.clicks, 0);
});

// ───────────────────────── adt1-engine.js: pageAdt1 / pageAttach ─────────────────────────

test('ADT-1 save: a hidden "Data saved successfully" template is not clicked; a shown one is', async () => {
  const t = template('Data saved successfully');
  const others = templates();
  setup([t.box, ...others.map(o => o.box)]);
  let r = await ENGINE.pageAdt1('save', { enableWait: 200 });
  assert.equal(r.clicked, false);
  assert.equal(t.ok.clicks, 0);
  for (const o of others) assert.equal(o.ok.clicks, 0);

  const ok = el('button', { text: 'OK' });
  const real = el('div', { attrs: { role: 'dialog' }, children: [el('p', { text: 'Data saved successfully' }), ok] });
  setup([t.box, real]);
  r = await ENGINE.pageAdt1('save', { enableWait: 200 });
  assert.equal(ok.clicks, 1);
  assert.equal(t.ok.clicks, 0);
});

test('ADT-1 next (Company Information): hidden success template is not reported or clicked', async () => {
  const t = template('Details saved successfully');
  const next = el('button', { text: 'Next' });
  setup([t.box, next]);
  const r = await ENGINE.pageAdt1('next', {});
  assert.equal(r.clicked, true); assert.equal(r.advanced, true);
  assert.deepEqual(r.dialogs, []);
  assert.equal(t.ok.clicks, 0);
  assert.equal(next.clicks, 1);

  const ok = el('button', { text: 'OK', onClick: () => real.remove() });
  const real = el('div', { cls: 'modal-dialog', children: [el('p', { text: 'Details saved successfully' }), ok] });
  setup([t.box, real, el('button', { text: 'Next' })]);
  const r2 = await ENGINE.pageAdt1('next', {});
  assert.deepEqual(r2.dialogs, ['Details saved successfully OK']);
  assert.equal(ok.clicks, 1);
  assert.equal(t.ok.clicks, 0);
});

test('ADT-1 nextStep: hidden success template is not clicked; a shown one is', async () => {
  const t = template('Data saved successfully');
  const ok = el('button', { text: 'OK' });
  const real = el('div', { attrs: { role: 'dialog' }, children: [el('p', { text: 'Data saved successfully' }), ok] });
  const next = el('button', { text: 'Next' });
  setup([t.box, next]);
  // The shown popup appears after the click, as MCA does.
  next.onClick = () => document.body.append(real);
  const r = await ENGINE.pageAdt1('nextStep', {});
  assert.equal(r.clicked, true); assert.equal(r.advanced, true);
  assert.equal(ok.clicks, 1);
  assert.equal(t.ok.clicks, 0);
  assert.deepEqual(r.dialogs, ['Data saved successfully OK']);
});

function attachPage(extra, onUpload) {
  const file = el('input', { type: 'file', name: 'guide-fileuploadwithplaceh_913864895' });
  const nameBox = el('input', { type: 'text', readOnly: true, value: 'notice.pdf' });
  const up = el('button', { text: 'Upload' });
  const rm = el('button', { text: 'Remove', disabled: true });
  up.onClick = () => { up.disabled = true; rm.disabled = false; if (onUpload) onUpload(); };
  const widget = el('div', { children: [file, nameBox, up, rm] });
  setup([widget, ...extra]);
  globalThis.DataTransfer = class { constructor() { const a = []; this.items = { add: f => a.push(f) }; this.files = a; } };
  return { up, rm };
}
const PDF = { name: 'notice.pdf', type: 'application/pdf', b64: 'JVBERi0=' };

test('ADT-1 attach: hidden size/error templates do not make MCA "refuse" the upload and are not clicked', async () => {
  const t = templates();
  attachPage(t.map(o => o.box));
  const r = await ENGINE.pageAttach('attach', { slot: 'intimation', file: PDF });
  assert.equal(r.ok, true, JSON.stringify(r));
  for (const o of t) assert.equal(o.ok.clicks, 0);
});

test('ADT-1 attach: a shown refusal popup is read; a shown success popup is closed with OK', async () => {
  const t = templates();
  const bad = el('div', { cls: 'modal-dialog', children: [el('p', { text: 'File size exceeds the limit' }), el('button', { text: 'OK' })] });
  attachPage(t.map(o => o.box), () => document.body.append(bad));
  let r = await ENGINE.pageAttach('attach', { slot: 'intimation', file: PDF });
  assert.equal(r.ok, false);
  assert.match(r.err, /MCA said: File size exceeds the limit/);
  assert.doesNotMatch(r.err, /10 MB|Technical Error/);

  const ok = el('button', { text: 'OK' });
  const good = el('div', { cls: 'modal-dialog', children: [el('p', { text: 'File uploaded successfully' }), ok] });
  attachPage(t.map(o => o.box), () => document.body.append(good));
  r = await ENGINE.pageAttach('attach', { slot: 'intimation', file: PDF });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(ok.clicks, 1);
  for (const o of t) assert.equal(o.ok.clicks, 0);
});
