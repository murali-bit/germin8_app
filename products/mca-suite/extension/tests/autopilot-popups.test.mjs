// node --test tests/autopilot-popups.test.mjs   (from extension/)
// The autopilot's in-page popup readers (pageApErrorDialog, pageApCloseInfoPopups) must only see popups MCA really
// shows. MCA keeps its popup templates in the DOM, hidden by visibility / opacity / aria-hidden (still laid out):
// those must never be read, clicked or force-hidden. Made-up text only.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { FakeEl, installDom, installComputedStyle } from './fake-dom.mjs';
const require = createRequire(import.meta.url);
const A = require('../js/autopilot.js');

const el = (tag, opts = {}, children = []) => new FakeEl(tag, { ...opts, children });

// An MCA-style popup: modal_container host > content div > (message | error table) + OK button.
function popup(id, { message = '', rows = null, button = 'OK', hostOpts = {}, onOk = null } = {}) {
  const ok = el('button', { text: button, onClick: onOk });
  const parts = [];
  if (rows) {
    parts.push(el('table', {}, [
      el('tr', {}, [el('td', { text: 'Error Type' }), el('td', { text: 'Error Message' })]),
      ...rows.map(r => el('tr', {}, [el('td', { text: 'Error' }), el('td', { text: r })])),
    ]));
  } else parts.push(el('p', { text: message }));
  const content = el('div', { cls: 'modal-content' }, [...parts, ok]);
  const host = el('div', { id, ...hostOpts }, [content]);
  return { host, content, ok };
}

// The hidden templates seen on the live page (made-up wording close to MCA's).
function templates() {
  return [
    popup('guide_modal_container_1', { rows: ['Form filing is not allowed since a declaration is pending'], hostOpts: { invisible: true } }),
    popup('guide_modal_container_2', { message: 'Technical Error Occurred. Please Try Again After Some Time.', hostOpts: { style: { opacity: '0' } } }),
    popup('guide_modal_container_3', { message: 'Error: The total size of all attachments should not be more than 10 MB', hostOpts: { attrs: { 'aria-hidden': 'true' } } }),
    popup('guide_modal_container_4', { message: 'Data Added Successfully', hostOpts: { invisible: true } }),
    popup('guide_modal_container_5', { message: 'Document Uploaded Succesfully', hostOpts: { style: { visibility: 'hidden' } } }),
  ];
}

const untouched = ps => {
  for (const p of ps) {
    assert.equal(p.ok.clicks, 0, `${p.host.id}: OK must not be clicked`);
    assert.notEqual(p.host.style.display, 'none', `${p.host.id}: must not be force-hidden`);
  }
};

beforeEach(() => {
  delete globalThis.guideBridge;
  installComputedStyle();
});

test('pageApErrorDialog: hidden templates with error text and OK are ignored', async () => {
  const ts = templates();
  installDom(ts.map(p => p.host));
  const r = await A.pageApErrorDialog();
  assert.equal(r, null);
  untouched(ts);
});

test('pageApErrorDialog: a shown error popup is read and closed; templates stay untouched', async () => {
  const ts = templates();
  const real = popup('guide_modal_container_9', { rows: ['Made-up refusal for a test company'], onOk: () => { real.host.hidden = true; } });
  installDom([...ts.map(p => p.host), real.host]);
  const r = await A.pageApErrorDialog();
  assert.deepEqual(r.errors, ['Made-up refusal for a test company']);
  assert.equal(r.closed, true);
  assert.equal(r.forced, false);
  assert.equal(real.ok.clicks, 1);
  untouched(ts);
});

test('pageApErrorDialog: a shown popup that stays up after OK is force-closed (only that one)', async () => {
  const ts = templates();
  const real = popup('guide_modal_container_9', { message: 'Error: made-up date problem' });
  installDom([...ts.map(p => p.host), real.host]);
  const r = await A.pageApErrorDialog();
  assert.equal(r.forced, true);
  assert.equal(real.ok.clicks, 1);
  assert.equal(real.host.style.display, 'none');
  assert.ok(r.errors[0].includes('made-up date problem'));
  assert.ok(!r.errors.join(' ').includes('10 MB'));
  untouched(ts);
});

test('pageApErrorDialog: a shown-looking box inside a hidden ancestor is ignored', async () => {
  const inner = popup('guide_modal_container_7', { message: 'Error: hidden by its wrapper' });
  const wrap = el('div', { cls: 'wrap', style: { visibility: 'hidden' } }, [inner.host]);
  installDom([wrap]);
  assert.equal(await A.pageApErrorDialog(), null);
  untouched([inner]);
});

test('pageApCloseInfoPopups: hidden success templates are not closed', async () => {
  const ts = templates();
  installDom(ts.map(p => p.host));
  const r = await A.pageApCloseInfoPopups();
  assert.deepEqual(r.closed, []);
  untouched(ts);
});

test('pageApCloseInfoPopups: a shown success popup is closed; templates stay untouched', async () => {
  const ts = templates();
  const real = popup('guide_modal_container_8', { message: 'Data Saved Successfully', hostOpts: { attrs: { role: 'dialog' } }, onOk: () => { real.host.hidden = true; } });
  installDom([...ts.map(p => p.host), real.host]);
  const r = await A.pageApCloseInfoPopups();
  assert.equal(r.closed.length, 1);
  assert.match(r.closed[0], /Data Saved Successfully/);
  assert.equal(real.ok.clicks, 1);
  assert.notEqual(real.host.style.display, 'none');
  untouched(ts);
});

test('pageApCloseInfoPopups: a shown success popup that stays up is force-closed', async () => {
  const ts = templates();
  const real = popup('guide_modal_container_8', { message: 'Document Uploaded Successfully', hostOpts: { attrs: { role: 'dialog' } } });
  // The host is hidden by force-close (inline display none); the fake DOM models that through `hidden`.
  const style = real.host.style;
  real.host.style = new Proxy(style, { set(o, k, v) { o[k] = v; if (k === 'display' && v === 'none') real.host.hidden = true; return true; } });
  installDom([...ts.map(p => p.host), real.host]);
  const r = await A.pageApCloseInfoPopups();
  assert.equal(r.closed.length, 1);
  assert.equal(real.host.style.display, 'none');
  untouched(ts);
});

// Live bug (v1.9.0): after the page-2 Save, a hidden popup template's own "Proceed" button was clicked (Proceed is
// tried before Next) and MCA went back to page 1. Only buttons really on screen may be clicked.
test('pageApForward: a hidden template\'s Proceed is never clicked; the page\'s Next is', async () => {
  const tplProceed = el('button', { text: 'Proceed' });
  const tplYes = el('button', { text: 'Proceed' });
  const tpl1 = el('div', { id: 'guide_modal_container_7', invisible: true }, [el('p', { text: 'The form will be processed through non-STP mode' }), tplProceed]);
  // Hidden by opacity, and outside any modal box: still not a page button.
  const tpl2 = el('div', { style: { opacity: '0' } }, [tplYes]);
  const next = el('button', { text: 'Next' });
  installDom([tpl1, tpl2, el('button', { text: 'Previous' }), el('button', { text: 'Save' }), next]);
  const r = await A.pageApForward(['Proceed', 'Next'], 0);
  assert.equal(r.clicked, true);
  assert.equal(r.label, 'Next');
  assert.equal(next.clicks, 1);
  assert.equal(tplProceed.clicks + tplYes.clicks, 0);
  assert.ok(!r.seen.includes('Proceed'), 'hidden buttons are not reported as seen');
});

// Live bug (AOC-4): after page 2 MCA redirects back to page 1, whose real Proceed sits inside an AEM wrapper with
// visibility:hidden while the button (or an inner wrapper) sets visibility:visible. It is on screen and must be clicked.
test('pageApForward: a Proceed that overrides a visibility-hidden ancestor with visibility visible is clicked', async () => {
  const proceed = el('button', { text: 'Proceed', style: { visibility: 'visible' } });
  const wrap = el('div', { cls: 'guideContainerNode', style: { visibility: 'hidden' } }, [proceed]);
  installDom([wrap]);
  const r = await A.pageApForward(['Proceed', 'Next'], 0);
  assert.equal(r.clicked, true);
  assert.equal(r.label, 'Proceed');
  assert.equal(proceed.clicks, 1);
});

test('pageApForward: an inner wrapper with visibility visible re-shows a Proceed under a hidden outer wrapper', async () => {
  const proceed = el('button', { text: 'Proceed' });
  const inner = el('div', { style: { visibility: 'visible' } }, [proceed]);
  const outer = el('div', { invisible: true }, [el('div', {}, [inner])]);
  installDom([outer]);
  const r = await A.pageApForward(['Proceed', 'Next'], 0);
  assert.equal(r.clicked, true);
  assert.equal(proceed.clicks, 1);
});

test('pageApForward: a Proceed inside a visibility-hidden template with no override is still not clicked', async () => {
  const proceed = el('button', { text: 'Proceed' });
  const tpl = el('div', { style: { visibility: 'hidden' } }, [el('div', {}, [proceed])]);
  installDom([tpl]);
  const r = await A.pageApForward(['Proceed', 'Next'], 0);
  assert.equal(r.clicked, false);
  assert.equal(proceed.clicks, 0);
});

test('pageApErrorDialog: a visibility-hidden popup template is still ignored after the visibility fix', async () => {
  const tpl = popup('guide_modal_container_9', { rows: ['Made-up error that must not be read'], hostOpts: { style: { visibility: 'hidden' } } });
  const tpl2 = popup('guide_modal_container_10', { message: 'Error: made-up hidden message', hostOpts: { invisible: true } });
  installDom([tpl.host, tpl2.host]);
  assert.equal(await A.pageApErrorDialog(), null);
  untouched([tpl, tpl2]);
});

test('pageApForward: hidden field errors do not block the move', async () => {
  const next = el('button', { text: 'Next' });
  installDom([el('div', { cls: 'guideFieldError', text: 'This field is required', invisible: true }), next]);
  const r = await A.pageApForward(['Next'], 0);
  assert.equal(r.clicked, true);
  assert.equal(next.clicks, 1);
});

test('pageApForward: reports MCA busy (spinner on screen) when the button is not there yet', async () => {
  installDom([el('div', { cls: 'spinner' }, [el('span', { text: '…' })]), el('button', { text: 'Previous' })]);
  const r = await A.pageApForward(['Proceed'], 0);
  assert.equal(r.clicked, false);
  assert.equal(r.reason, 'none');
  assert.equal(r.busy, true);
  installDom([el('button', { text: 'Previous' })]);
  const r2 = await A.pageApForward(['Proceed'], 0);
  assert.equal(r2.busy, false);
});
