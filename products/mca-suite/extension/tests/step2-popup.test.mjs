// node --test extension/tests/step2-popup.test.mjs
// Page 2 upload: MCA's own popups (AEM *modal_container*) are seen, closed for sure, and errors reported.
import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { FakeEl, installDom, installComputedStyle, flush } from './fake-dom.mjs';
const require = createRequire(import.meta.url);
const S2 = require('../js/step2-attach.js');

globalThis.DataTransfer = class { constructor() { const l = []; this.items = { add: f => l.push(f) }; this.files = l; } };
const el = (tag, opts) => new FakeEl(tag, opts);

// The (a) slot: file input + Upload + Preview (disabled until MCA has the file). onUpload builds MCA's reply.
function slotA(onUpload) {
  const input = el('input', { type: 'file', name: 'x_panel_985107667-fileuploadwithplaceh___jqName' });
  const preview = el('button', { text: 'Preview', disabled: true });
  const upload = el('button', { text: 'Upload', onClick: () => onUpload({ preview }) });
  const widget = el('div', { cls: 'afFileUpload', children: [input, upload, preview] });
  const dom = installDom([widget]);
  return { ...dom, input, preview, upload };
}
// MCA's popup: a modal_container box with a message and an OK that (like the live portal sometimes) does not close it.
function mcaPopup(body, msg, { okCloses = false } = {}) {
  const box = el('div', { id: 'guideContainer-rootPanel-modal_container_123', children: [el('p', { text: msg })] });
  box.append(el('button', { text: 'OK', onClick: () => { if (okCloses) box.hidden = true; } }));
  body.append(box);
  return box;
}
async function settle(promise, maxMs = 120000) {
  let done = false, out, err;
  promise.then(v => { done = true; out = v; }, e => { done = true; err = e; });
  for (let t = 0; !done && t < maxMs; t += 100) { mock.timers.tick(100); await flush(); }
  if (err) throw err;
  assert.ok(done, 'page call did not finish');
  return out;
}
const FILE = { name: 'dummy-fs.pdf', type: 'application/pdf', b64: Buffer.from('%PDF-1.4 dummy').toString('base64') };

beforeEach(() => { mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_700_000_000_000 }); });
afterEach(() => { mock.timers.reset(); });

test('upload success popup in a modal_container is closed (hidden for sure) and the upload counts', async () => {
  let popup;
  const page = slotA(({ preview }) => { popup = mcaPopup(page.body, 'File uploaded successfully'); preview.disabled = false; });
  const s = S2.STEP2_SLOTS.a;
  const r = await settle(S2.pageStep2Attach('a', s.input, s.labelRe, FILE, 90000));
  assert.equal(r.ok, true);
  assert.ok(r.dialogs.some(d => /uploaded successfully/i.test(d)));
  assert.equal(popup.getClientRects().length > 0 && popup.style.display !== 'none', false, 'page is not left behind the popup');
});

test('MCA size error popup: the upload stops with MCA’s words, the popup is closed, no 90 s wait', async () => {
  let popup;
  const page = slotA(() => { popup = mcaPopup(page.body, 'File size exceeds the maximum limit of 6 MB', { okCloses: true }); });
  const s = S2.STEP2_SLOTS.a;
  const t0 = Date.now();
  const r = await settle(S2.pageStep2Attach('a', s.input, s.labelRe, FILE, 90000));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'mca-error');
  assert.ok(r.dialogs.some(d => /exceeds the maximum/i.test(d)));
  assert.ok(Date.now() - t0 < 10000, 'reported at once');
  assert.equal(popup.getClientRects().length, 0);
});

test('a popup asking Yes / Remove is never answered by the upload', async () => {
  let popup, yes;
  const page = slotA(({ preview }) => {
    popup = mcaPopup(page.body, 'Do you want to remove the attachment?');
    popup.children = popup.children.filter(c => !/^OK$/.test(c.textContent));
    yes = popup.append(el('button', { text: 'Yes' }));
    preview.disabled = false;
  });
  const s = S2.STEP2_SLOTS.a;
  await settle(S2.pageStep2Attach('a', s.input, s.labelRe, FILE, 90000));
  assert.equal(yes.clicks, 0);
});

// ───────── MCA's hidden popup templates (v1.9.0): laid out, but visibility:hidden / opacity:0 / aria-hidden /
// zero size / inside a hidden box. They must never be read, clicked or hidden. Made-up texts only. ─────────
installComputedStyle();
const TEMPLATE_TEXTS = [
  'Error Type Error Message',
  'Your request for Form DUMMY-9 has been submitted against SRN X00000000.',
  'Technical Error Occurred. Please Try Again After Some Time.',
  'The total size of all attachments should not be more than 10 MB',
  'Form filing is not allowed since dummy declaration is not filed',
];
// One template per hiding style MCA uses; each has an OK button and error / success words.
function templates(body) {
  const mk = (i, opts = {}) => el('div', {
    id: `guideContainer-rootPanel-panel_tpl${i}-modal_container_${900 + i}`, ...opts,
    children: [el('p', { text: TEMPLATE_TEXTS[i % TEMPLATE_TEXTS.length] }), el('button', { text: 'OK' })],
  });
  const list = [
    mk(0, { invisible: true }),                  // visibility:hidden
    mk(1, { style: { opacity: '0' } }),          // opacity 0
    mk(2, { attrs: { 'aria-hidden': 'true' } }), // aria-hidden
    mk(3),                                       // zero size
  ];
  list[3].getBoundingClientRect = () => ({ width: 0, height: 0 });
  const wrap = el('div', { cls: 'tplHost', invisible: true, children: [mk(4)] }); // hidden ancestor
  for (const b of list) body.append(b);
  body.append(wrap);
  list.push(wrap.children[0]);
  return list;
}
const okOf = box => box.children.find(c => c.tagName === 'BUTTON');
function assertUntouched(list, r) {
  for (const t of list) {
    assert.equal(okOf(t).clicks, 0, `template OK clicked: ${t.id}`);
    assert.notEqual(t.style.display, 'none', `template force-hidden: ${t.id}`);
  }
  for (const d of r.dialogs || []) for (const tt of TEMPLATE_TEXTS) assert.ok(!d.includes(tt), `template text reported: ${d}`);
}

test('fake-dom: invisible templates keep layout and textContent but have no innerText and computed style hidden', () => {
  const { body } = installDom([]);
  const [t] = templates(body);
  assert.ok(t.getClientRects().length > 0);
  assert.equal(t.innerText, '');
  assert.ok(t.textContent.includes('Error Type'));
  assert.equal(getComputedStyle(t).visibility, 'hidden');
  assert.equal(getComputedStyle(body).visibility, 'visible');
  assert.equal(new FakeEl('div').invisible, false, 'default stays visible');
});

test('upload: hidden templates with OK / error words are ignored; the upload succeeds and nothing is clicked or hidden', async () => {
  const page = slotA(({ preview }) => { preview.disabled = false; });
  const list = templates(page.body);
  const s = S2.STEP2_SLOTS.a;
  const r = await settle(S2.pageStep2Attach('a', s.input, s.labelRe, FILE, 90000));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.dialogs, []);
  assertUntouched(list, r);
});

test('upload: a real error popup next to hidden templates is reported alone and closed; templates untouched', async () => {
  let popup;
  const page = slotA(() => { popup = mcaPopup(page.body, 'File size exceeds the maximum limit of 6 MB', { okCloses: true }); });
  const list = templates(page.body);
  const s = S2.STEP2_SLOTS.a;
  const r = await settle(S2.pageStep2Attach('a', s.input, s.labelRe, FILE, 90000));
  assert.equal(r.reason, 'mca-error');
  assert.deepEqual(r.dialogs.map(d => /exceeds the maximum/.test(d)), [true]);
  assert.equal(popup.getClientRects().length, 0);
  assertUntouched(list, r);
});

test('upload: force-close hides only the real stuck popup, never a template (DOM nor guideBridge)', async () => {
  let popup;
  const page = slotA(({ preview }) => { popup = mcaPopup(page.body, 'File uploaded successfully'); preview.disabled = false; });
  const list = templates(page.body);
  const nodes = list.map(b => ({ id: b.id, visible: true }));
  globalThis.guideBridge = { visit: f => { nodes.forEach(f); } };
  try {
    const s = S2.STEP2_SLOTS.a;
    const r = await settle(S2.pageStep2Attach('a', s.input, s.labelRe, FILE, 90000));
    assert.equal(r.ok, true);
    assert.equal(popup.style.display, 'none', 'real stuck popup hidden');
    assert.ok(nodes.every(n => n.visible === true), 'no template node made invisible');
    assertUntouched(list, r);
  } finally { delete globalThis.guideBridge; }
});

test('upload: nested container + inner dialog gives one message from the inner box, closed with the container OK', async () => {
  let outer, ok;
  const page = slotA(({ preview }) => {
    const inner = el('div', { cls: 'guideDialogNode', children: [el('p', { text: 'File uploaded successfully' })] });
    ok = el('button', { text: 'OK', onClick: () => { outer.hidden = true; } });
    outer = el('div', { id: 'guideContainer-rootPanel-modal_container_77', children: [inner, ok] });
    page.body.append(outer);
    preview.disabled = false;
  });
  const s = S2.STEP2_SLOTS.a;
  const r = await settle(S2.pageStep2Attach('a', s.input, s.labelRe, FILE, 90000));
  assert.equal(r.ok, true);
  assert.deepEqual(r.dialogs, ['File uploaded successfully']);
  assert.ok(ok.clicks >= 1);
  assert.equal(outer.getClientRects().length, 0);
});

// Wizard header (1 Company details, 2 Attachment & Declaration, 3 Review & Submit) on the FakeEl DOM.
function wizard(active) {
  const steps = ['Company details', 'Attachment & Declaration', 'Review & Submit']
    .map((t, i) => el('li', { text: t, cls: 'listep progress-step' + (i + 1 === active ? ' active' : '') }));
  const ul = el('ul', { children: steps });
  ul.go = n => steps.forEach((x, i) => { x.className = 'listep progress-step' + (i + 1 === n ? ' active' : ''); });
  return ul;
}
function infoPopup(body, msg) {
  const box = el('div', { id: 'guideContainer-rootPanel-modal_container_55', children: [el('p', { text: msg })] });
  box.append(el('button', { text: 'OK', onClick: () => { box.hidden = true; } }));
  body.append(box);
  return box;
}

test('step 2 open: templates are not clicked or reported; a real info popup is read and closed', async () => {
  const w = wizard(1);
  let real, dom;
  const next = el('button', { text: 'Next', onClick: () => { real = infoPopup(dom.body, 'Data saved successfully'); setTimeout(() => w.go(2), 1000); } });
  dom = installDom([w, next]);
  const list = templates(dom.body);
  const r = await settle(S2.pageStep2Open(20000));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.dialogs, ['Data saved successfully OK']);
  assert.equal(okOf(real).clicks, 1);
  assertUntouched(list, r);
});

test('next to review: templates are not clicked or reported; a real info popup is read and closed', async () => {
  const w = wizard(2);
  let real, dom;
  const next = el('button', { text: 'Next', onClick: () => { real = infoPopup(dom.body, 'Data saved successfully'); setTimeout(() => w.go(3), 1000); } });
  dom = installDom([w, next]);
  const list = templates(dom.body);
  const r = await settle(S2.pageStep2NextToReview(20000));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.dialogs, ['Data saved successfully OK']);
  assert.equal(okOf(real).clicks, 1);
  assertUntouched(list, r);
});

test('next to review: a hidden field-error template is not a validation error; a shown one is', async () => {
  const ghost = () => el('div', { cls: 'guideFieldError', invisible: true, text: 'Dummy field is mandatory' });
  installDom([wizard(2), el('button', { text: 'Next' }), ghost()]);
  let r = await settle(S2.pageStep2NextToReview(6000));
  assert.equal(r.reason, 'timeout', JSON.stringify(r));
  installDom([wizard(2), el('button', { text: 'Next' }), ghost(), el('div', { cls: 'guideFieldError', text: 'Dummy date is invalid' })]);
  r = await settle(S2.pageStep2NextToReview(6000));
  assert.equal(r.reason, 'validation');
  assert.deepEqual(r.errors, ['Dummy date is invalid']);
});

test('step 2 save: a Save inside a hidden template is never the one clicked', () => {
  const save = el('button', { text: 'Save' });
  const dom = installDom([wizard(2), save]);
  const tpl = el('div', { id: 'x-modal_container_1', invisible: true, children: [el('button', { text: 'Save' })] });
  dom.body.append(tpl);
  const r = S2.pageStep2ClickSave();
  assert.equal(r.clicked, true);
  assert.equal(save.clicks, 1);
  assert.equal(tpl.children[0].clicks, 0);
});

test('upload: a real stuck popup inside a zero-size modal_container wrapper is still force-closed', async () => {
  let inner, host;
  const page = slotA(({ preview }) => {
    inner = el('div', { cls: 'guideDialogNode', children: [el('p', { text: 'File uploaded successfully' }), el('button', { text: 'OK' })] });
    host = el('div', { id: 'guideContainer-rootPanel-modal_container_88', children: [inner] });
    host.getBoundingClientRect = () => ({ width: 0, height: 0 });
    page.body.append(host);
    preview.disabled = false;
  });
  const s = S2.STEP2_SLOTS.a;
  const r = await settle(S2.pageStep2Attach('a', s.input, s.labelRe, FILE, 90000));
  assert.equal(r.ok, true);
  assert.equal(host.style.display, 'none', 'page not left dimmed');
});
