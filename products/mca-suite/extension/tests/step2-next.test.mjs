// node --test tests/step2-next.test.mjs  (from extension/)
// pageStep2NextToReview, pageApForward (autopilot) and pageStep2FillCertificate on a tiny fake DOM, and
// step2Run's auto mode against stubbed chrome / side panel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const S = require('../js/step2-attach.js');
const A = require('../js/autopilot.js'); // pageApForward

const CIN = 'U01100KA2019PTC000001'; // made-up company

// ── minimal fake DOM: selectors tag, .a.b, [attr="v"], tag[attr="v"], comma lists; closest(); innerText ──
function el(tag, { text = '', cls = '', attrs = {}, hidden = false, disabled = false, value, children = [], onClick } = {}) {
  const e = { tag, cls: cls.split(/\s+/).filter(Boolean), attrs, hidden, disabled, value, children, clicks: 0, parent: null, _text: text,
    type: attrs.type, id: attrs.id, checked: false, readOnly: 'readonly' in attrs, events: [] };
  e.dispatchEvent = ev => { e.events.push(ev.type); return true; };
  Object.defineProperty(e, 'textContent', { get() { return [e._text, ...e.children.map(c => c.textContent)].join(' '); } });
  Object.defineProperty(e, 'innerText', { get() { return isHidden(e) ? '' : e.textContent; } });
  e.getClientRects = () => (isHidden(e) ? [] : [{}]);
  e.getAttribute = k => (k in e.attrs ? e.attrs[k] : null);
  e.click = () => { e.clicks++; if (onClick) onClick(e); };
  e.scrollIntoView = () => {};
  e.querySelectorAll = sel => descendants(e).filter(d => matches(d, sel));
  e.querySelector = sel => e.querySelectorAll(sel)[0] || null;
  e.closest = sel => { for (let x = e; x; x = x.parent) if (matches(x, sel)) return x; return null; };
  for (const c of children) c.parent = e;
  return e;
}
const isHidden = e => { for (let x = e; x; x = x.parent) if (x.hidden) return true; return false; };
const descendants = e => e.children.flatMap(c => [c, ...descendants(c)]);
const matches = (e, sel) => sel.split(',').map(s => s.trim()).some(s => {
  const m = s.match(/^([a-z]*)((?:\.[\w-]+)*)(?:\[([\w-]+)="([^"]*)"\])?$/i);
  if (!m) return false;
  const [, tag, clsPart, ak, av] = m;
  const classes = clsPart ? clsPart.split('.').filter(Boolean) : [];
  return (!tag || e.tag === tag) && classes.every(c => e.cls.includes(c)) && (!ak || e.attrs[ak] === av);
});
function withDom(body, fn) {
  const root = el('body', { children: body });
  const saved = { document: globalThis.document, window: globalThis.window };
  globalThis.document = { readyState: 'complete', querySelectorAll: s => root.querySelectorAll(s), querySelector: s => root.querySelector(s) };
  globalThis.window = {};
  return Promise.resolve(fn(root)).finally(() => { globalThis.document = saved.document; globalThis.window = saved.window; });
}
// Wizard header with the given active step: 1 Company details, 2 Attachment & Declaration, 3 Review & Submit.
function wizard(active) {
  const steps = ['Company details', 'Attachment & Declaration', 'Review & Submit']
    .map((t, i) => el('li', { text: t, cls: 'listep progress-step' + (i + 1 === active ? ' active' : '') }));
  const ul = el('ul', { children: steps });
  ul.go = n => steps.forEach((s, i) => { s.cls = ['listep', 'progress-step', ...(i + 1 === n ? ['active'] : [])]; });
  return ul;
}

test('Next on Attachment & Declaration: clicks the one Next and waits for Review & Submit', async () => {
  const w = wizard(2);
  const next = el('button', { text: 'Next', onClick: () => setTimeout(() => w.go(3), 50) });
  const prev = el('button', { text: 'Previous' }), save = el('button', { text: 'Save' });
  await withDom([w, prev, save, next], async () => {
    const r = await S.pageStep2NextToReview(3000);
    assert.equal(r.ok, true); assert.equal(r.clicked, true);
    assert.match(r.from, /Attachment/); assert.match(r.to, /Review/);
    assert.ok(Array.isArray(r.dialogs));
  });
  assert.equal(next.clicks, 1); assert.equal(prev.clicks + save.clicks, 0);
});

test('closes a plain OK info dialog on the way, never other dialog buttons', async () => {
  const w = wizard(2);
  const ok = el('button', { text: 'OK' }), proceed = el('button', { text: 'Proceed' });
  const dlg = el('div', { attrs: { role: 'dialog' }, hidden: true, children: [el('p', { text: 'Data saved successfully' }), proceed, ok] });
  const next = el('button', { text: 'Next', onClick: () => { dlg.hidden = false; setTimeout(() => w.go(3), 900); } });
  ok.click = () => { ok.clicks++; dlg.hidden = true; };
  await withDom([w, next, dlg], async () => {
    const r = await S.pageStep2NextToReview(4000);
    assert.equal(r.ok, true);
    assert.equal(r.dialogs.length, 1); assert.match(r.dialogs[0], /saved successfully/);
  });
  assert.equal(ok.clicks, 1); assert.equal(proceed.clicks, 0);
});

test('already on Review & Submit: ok without clicking anything', async () => {
  const next = el('button', { text: 'Next' }), submit = el('button', { text: 'Submit' });
  await withDom([wizard(3), next, submit], async () => {
    const r = await S.pageStep2NextToReview(500);
    assert.deepEqual([r.ok, r.clicked], [true, false]);
  });
  assert.equal(next.clicks + submit.clicks, 0);
});

test('refuses on any other step, with no Next, several Next, or a Submit-only candidate', async () => {
  const n1 = el('button', { text: 'Next' });
  await withDom([wizard(1), n1], async () => {
    const r = await S.pageStep2NextToReview(300);
    assert.equal(r.ok, false); assert.equal(r.reason, 'not-on-step-2');
  });
  assert.equal(n1.clicks, 0);

  await withDom([wizard(2), el('button', { text: 'Save' })], async () => {
    assert.equal((await S.pageStep2NextToReview(300)).reason, 'no-next');
  });

  const a = el('button', { text: 'Next' }), b = el('button', { text: 'Next' });
  await withDom([wizard(2), a, b], async () => {
    assert.equal((await S.pageStep2NextToReview(300)).reason, 'several-next');
  });
  assert.equal(a.clicks + b.clicks, 0);

  const sub = el('button', { text: 'Submit' }), nextSub = el('button', { text: 'Next & Submit' });
  await withDom([wizard(2), sub, nextSub], async () => {
    const r = await S.pageStep2NextToReview(300);
    assert.equal(r.ok, false); assert.equal(r.reason, 'submit-only'); assert.equal(r.clicked, false);
  });
  assert.equal(sub.clicks + nextSub.clicks, 0);
});

test('ignores hidden, disabled and in-dialog Next buttons', async () => {
  const hidden = el('button', { text: 'Next', hidden: true });
  const disabled = el('button', { text: 'Next', disabled: true });
  const inDlg = el('button', { text: 'Next' });
  const w = wizard(2);
  const real = el('button', { text: 'Next', onClick: () => setTimeout(() => w.go(3), 20) });
  await withDom([w, hidden, disabled, el('div', { cls: 'modal', children: [inDlg] }), real], async () => {
    const r = await S.pageStep2NextToReview(2000);
    assert.equal(r.ok, true);
  });
  assert.equal(real.clicks, 1); assert.equal(hidden.clicks + disabled.clicks + inDlg.clicks, 0);
});

test('reports MCA field errors when the step does not move', async () => {
  const next = el('button', { text: 'Next' });
  await withDom([wizard(2), next, el('div', { cls: 'guideFieldError', text: 'Please attach the mandatory file' })], async () => {
    const r = await S.pageStep2NextToReview(6000);
    assert.equal(r.ok, false); assert.equal(r.clicked, true); assert.equal(r.reason, 'validation');
    assert.deepEqual(r.errors, ['Please attach the mandatory file']);
  });
});

test('Stop (page flag set by the autopilot) after Next: no dialog is closed, returns stopped', async () => {
  const w = wizard(2);
  const ok = el('button', { text: 'OK' });
  const dlg = el('div', { attrs: { role: 'dialog' }, hidden: true, children: [el('p', { text: 'Data saved successfully' }), ok] });
  const next = el('button', { text: 'Next', onClick: () => {
    // The user presses Stop in the side panel; then MCA shows a dialog and later moves on.
    globalThis.window.__germin8StopNav = true;
    dlg.hidden = false;
    setTimeout(() => w.go(3), 1500);
  } });
  await withDom([w, next, dlg], async () => {
    const r = await S.pageStep2NextToReview(4000);
    assert.equal(r.ok, false); assert.equal(r.reason, 'stopped'); assert.equal(r.clicked, true);
  });
  assert.equal(next.clicks, 1); assert.equal(ok.clicks, 0, 'no dialog button clicked after Stop');
});

test('a stale Stop flag from an earlier run is cleared when the page function starts', async () => {
  const w = wizard(2);
  const next = el('button', { text: 'Next', onClick: () => setTimeout(() => w.go(3), 50) });
  await withDom([w, next], async () => {
    globalThis.window.__germin8StopNav = true;
    const r = await S.pageStep2NextToReview(3000);
    assert.equal(r.ok, true);
  });
});

test('page function is self-contained and never targets Submit', () => {
  const src = S.pageStep2NextToReview.toString();
  assert.doesNotMatch(src, /\bstep2[A-Z]\w*\(|STEP2_|getActiveMcaTab|chrome\./);
  assert.match(src, /submit-only/);
});

// ── step2Run auto mode with stubbed side panel + chrome ──
async function runStep2(opts, { url = 'https://www.mca.gov.in/content/mca/global/en/mca/e-filing/annual-filings/form-aoc4.html', confirm = { confirmed: true }, cert = { found: false, results: [] }, fetchExtra = null, panel = {}, errorPopup = undefined } = {}) {
  const stub = () => ({ value: '', checked: true, disabled: false, files: [], dataset: {}, textContent: '', innerHTML: '', appendChild() {} });
  const ids = {};
  const execs = [];
  const posts = [];
  const g = globalThis;
  const saved = {};
  const set = (k, v) => { saved[k] = g[k]; g[k] = v; };
  set('document', { getElementById: id => (ids[id] = ids[id] || Object.assign(stub(), panel[id] || {})), createElement: stub });
  set('currentData', { CIN });
  set('currentClient', { general: { CIN } });
  set('getActiveMcaTab', async () => ({ id: 3, url }));
  set('withTimeout', p => p);
  set('pageFill', function pageFill() {});
  set('pageConfirmSave', function pageConfirmSave() {});
  if (errorPopup !== undefined) set('pageApErrorDialog', function pageApErrorDialog() {});
  set('fetch', async (u, o = {}) => {
    if (fetchExtra) { const r = await fetchExtra(u, o); if (r) return r; }
    if (o.method === 'POST') posts.push(JSON.parse(o.body)); return { ok: true, json: async () => ({ answers: [] }) };
  });
  set('chrome', { scripting: { executeScript: async ({ func, args }) => {
    execs.push(func.name);
    if (/submit/i.test(func.name)) throw new Error('submit must never be called');
    if (func.name === 'pageStep2Open') return [{ result: { ok: true, clicked: true } }];
    if (func.name === 'pageStep2Attach') return [{ result: { ok: true, name: args[3].name } }];
    if (func.name === 'pageFill') return [{ result: { results: args[0].map(j => ({ id: j.id, ok: true })) } }];
    if (func.name === 'pageStep2FillCertificate') return [{ result: cert }];
    if (func.name === 'pageStep2ClickSave') return [{ result: { clicked: true } }];
    if (func.name === 'pageConfirmSave') return [{ result: Array.isArray(confirm) ? confirm.shift() : confirm }];
    if (func.name === 'pageApErrorDialog') return [{ result: errorPopup }];
    return [{ result: null }];
  } }, tabs: { create() { throw new Error('no tabs'); }, update() { throw new Error('no tabs'); } } });
  try {
    const res = await S.step2Run(opts);
    return { res, execs, posts, ids };
  } finally {
    for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete g[k]; else g[k] = saved[k]; }
  }
}
const VALUES = { resNo: 'BR/01/2026', resDate: '2026-09-30', desig: 'Director', din: '07654321' };

test('step2Run auto: (a) already on MCA, given values → opens, fills, saves, returns ok + saved', async () => {
  const r = await runStep2({ auto: true, files: { a: null, g: [] }, allowNoFileA: true, save: true, values: VALUES });
  assert.equal(r.res.ok, true); assert.equal(r.res.saved, true); assert.equal(r.res.reason, undefined);
  assert.deepEqual(r.execs, ['pageStep2Open', 'pageFill', 'pageFill', 'pageFill', 'pageFill', 'pageStep2ClickSave', 'pageConfirmSave']);
  assert.ok(r.res.items.every(([k]) => k !== 'err'));
  assert.ok(!r.res.items.some(([, m]) => /Review & Submit/.test(m)), 'no "click Next yourself" hint in auto mode');
  assert.ok(r.res.items.some(([, m]) => /Resolution date: 30\/09\/2026/.test(m)), 'date normalised');
  assert.equal(r.posts[0].cin, CIN);
});

test('step2Run auto: given files are uploaded instead of the inputs', async () => {
  const blob = name => ({ name, type: 'application/pdf', size: 2048, arrayBuffer: async () => new Uint8Array([37, 80, 68, 70]).buffer });
  const r = await runStep2({ auto: true, files: { a: blob('fs.pdf'), g: [blob('extra.pdf')] }, save: true, values: VALUES });
  assert.equal(r.res.ok, true);
  assert.deepEqual(r.execs.slice(0, 3), ['pageStep2Open', 'pageStep2Attach', 'pageStep2Attach']);
  assert.ok(r.res.items.some(([k, m]) => k === 'ok' && /\(a\) fs\.pdf/.test(m)));
});

test('step2Run auto: no (a) file without allowNoFileA → validation error, MCA untouched', async () => {
  const r = await runStep2({ auto: true, files: { a: null, g: [] }, save: true, values: VALUES });
  assert.equal(r.res.ok, false); assert.equal(r.res.reason, 'validation'); assert.equal(r.res.saved, false);
  assert.deepEqual(r.execs, []);
  assert.match(r.res.items[0][1], /\(a\) PDF/);
});

test('step2Run auto: Save not confirmed → ok false, saved false', async () => {
  const r = await runStep2({ auto: true, files: { a: null, g: [] }, allowNoFileA: true, save: true, values: VALUES }, { confirm: { confirmed: false, errorsVisible: false } });
  assert.equal(r.res.ok, false); assert.equal(r.res.saved, false); assert.equal(r.res.reason, 'not-confirmed');
  assert.equal(r.execs.filter(x => x === 'pageStep2ClickSave').length, 3, 'Save clicked at most 3 times');
});

test('step2Run auto: first Save not confirmed, no MCA error → Save clicked again and confirmed', async () => {
  const r = await runStep2({ auto: true, files: { a: null, g: [] }, allowNoFileA: true, save: true, values: VALUES },
    { confirm: [{ confirmed: false, errorsVisible: false }, { confirmed: true }], errorPopup: null });
  assert.equal(r.res.ok, true); assert.equal(r.res.saved, true);
  assert.deepEqual(r.execs.slice(-5), ['pageStep2ClickSave', 'pageConfirmSave', 'pageApErrorDialog', 'pageStep2ClickSave', 'pageConfirmSave']);
  assert.ok(r.res.items.some(([k, m]) => k === 'ok' && /Save clicked 2 times/.test(m)));
});

test('step2Run auto: Save not confirmed and MCA shows an error popup → stops with the MCA words, no second Save', async () => {
  const r = await runStep2({ auto: true, files: { a: null, g: [] }, allowNoFileA: true, save: true, values: VALUES },
    { confirm: [{ confirmed: false, errorsVisible: false }], errorPopup: { errors: ['Made-up error: resolution date is invalid'] } });
  assert.equal(r.res.ok, false); assert.equal(r.res.saved, false);
  assert.equal(r.execs.filter(x => x === 'pageStep2ClickSave').length, 1);
  assert.ok(r.res.items.some(([k, m]) => k === 'err' && /MCA said: Made-up error/.test(m)));
});

test('step2Run: wrong tab → no-tab; shouldStop prevents every MCA call', async () => {
  const wrong = await runStep2({ auto: true, files: { a: null, g: [] }, allowNoFileA: true, values: VALUES }, { url: 'https://www.mca.gov.in/x/form-aoc2.html' });
  assert.equal(wrong.res.reason, 'no-tab'); assert.deepEqual(wrong.execs, []);
  const stopped = await runStep2({ auto: true, files: { a: null, g: [] }, allowNoFileA: true, save: true, values: VALUES, shouldStop: () => true });
  assert.equal(stopped.res.ok, false); assert.equal(stopped.res.reason, 'stopped'); assert.deepEqual(stopped.execs, []);
});

test('step2Run: a click Event is not taken as options (manual button keeps reading the panel)', async () => {
  const evt = { type: 'click', preventDefault() {}, auto: true, files: { a: null }, allowNoFileA: true };
  const r = await runStep2(evt);
  assert.equal(r.res.reason, 'validation'); // panel inputs are empty: (a) file and declaration are asked for
  assert.deepEqual(r.execs, []);
});

// ── pageApForward (autopilot): moves MCA on with Proceed / Next, never Submit ──
const btn = (text, o = {}) => el('button', { text, ...o });

test('pageApForward: Proceed is preferred over Next; only that button is clicked', async () => {
  const prev = btn('Previous'), save = btn('Save'), next = btn('Next'), proceed = btn('Proceed');
  await withDom([prev, save, next, proceed], async () => {
    const r = await A.pageApForward(['Proceed', 'Next'], 300);
    assert.equal(r.clicked, true); assert.equal(r.label, 'Proceed');
    assert.deepEqual(r.seen, ['Previous', 'Save', 'Next', 'Proceed']);
  });
  assert.equal(proceed.clicks, 1);
  assert.equal(prev.clicks + save.clicks + next.clicks, 0);
  // Without a Proceed, Next is the one.
  const n2 = btn('Next');
  await withDom([btn('Save'), n2], async () => {
    const r = await A.pageApForward(['Proceed', 'Next'], 300);
    assert.equal(r.label, 'Next');
  });
  assert.equal(n2.clicks, 1);
});

test('pageApForward: anything with "submit" is never clicked, even when asked for', async () => {
  const sub = btn('Submit'), inp = el('input', { attrs: { type: 'submit' }, value: 'Submit' }), mixed = btn('Proceed & Submit');
  await withDom([btn('Previous'), sub, inp, mixed], async () => {
    const r = await A.pageApForward(['Submit', 'Proceed', 'Proceed & Submit'], 300);
    assert.equal(r.clicked, false); assert.equal(r.reason, 'none');
    assert.ok(r.seen.includes('Submit'), 'reports what MCA shows');
  });
  assert.equal(sub.clicks + inp.clicks + mixed.clicks, 0);
  assert.doesNotMatch(A.pageApForward.toString(), /\bap[A-Z]\w*\(|\bAP\.|chrome\.|step2[A-Z]/, 'self-contained page function');
});

test('pageApForward: visible field errors → nothing clicked, the errors are returned', async () => {
  const proceed = btn('Proceed');
  await withDom([proceed, el('div', { cls: 'guideFieldError', text: 'Membership number is required' }), el('div', { cls: 'guideFieldError', text: 'x', hidden: true })], async () => {
    const r = await A.pageApForward(['Proceed'], 300);
    assert.equal(r.clicked, false); assert.equal(r.reason, 'field-errors');
    assert.deepEqual(r.errors, ['Membership number is required']);
  });
  assert.equal(proceed.clicks, 0);
});

test('pageApForward: several matching buttons → several; none → none with the labels MCA shows', async () => {
  const a = btn('Proceed'), b = btn('Proceed');
  await withDom([a, b, btn('Next')], async () => {
    const r = await A.pageApForward(['Proceed', 'Next'], 300);
    assert.equal(r.clicked, false); assert.equal(r.reason, 'several'); assert.equal(r.label, 'Proceed');
  });
  assert.equal(a.clicks + b.clicks, 0);
  const labels = ['Previous', 'Save', 'Submit', 'Help', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map(t => btn(t));
  await withDom(labels, async () => {
    const r = await A.pageApForward(['Proceed', 'Next'], 300);
    assert.equal(r.reason, 'none');
    assert.equal(r.seen.length, 10);
    assert.deepEqual(r.seen.slice(0, 3), ['Previous', 'Save', 'Submit']);
  });
  assert.equal(labels.reduce((n, x) => n + x.clicks, 0), 0);
});

test('pageApForward: hidden, disabled, aria-disabled and in-dialog buttons are ignored; waits for one to appear', async () => {
  const hidden = btn('Proceed', { hidden: true }), dis = btn('Proceed', { disabled: true });
  const aria = btn('Proceed', { attrs: { 'aria-disabled': 'true' } }), inDlg = btn('Proceed');
  const late = btn('Proceed', { hidden: true });
  setTimeout(() => { late.hidden = false; }, 200);
  await withDom([hidden, dis, aria, el('div', { attrs: { role: 'dialog' }, children: [inDlg] }), late], async () => {
    const r = await A.pageApForward(['Proceed'], 3000);
    assert.equal(r.clicked, true);
  });
  assert.equal(late.clicks, 1);
  assert.equal(hidden.clicks + dis.clicks + aria.clicks + inDlg.clicks, 0);
});

// ── pageStep2FillCertificate: "Certificate by Practicing Professional" by label text ──
function radio(label, group, value) {
  const r = el('input', { attrs: { type: 'radio', name: group }, value });
  r.click = () => { r.clicks++; for (const o of r.group) o.checked = o === r; };
  return [el('label', { text: label, children: [r] }), r];
}
function certPanel({ readonlyMem = false } = {}) {
  const [lCA, rCA] = radio('Chartered Accountant', 'prof', '1');
  const [lCost, rCost] = radio('Cost Accountant', 'prof', '2');
  const [lCS, rCS] = radio('Company Secretary', 'prof', '3');
  const [lA, rA] = radio('Associate', 'af', 'A');
  const [lF, rF] = radio('Fellow', 'af', 'F');
  for (const g of [[rCA, rCost, rCS], [rA, rF]]) for (const r of g) r.group = g;
  const mem = el('input', { attrs: { type: 'text', ...(readonlyMem ? { readonly: '' } : {}) }, value: '' });
  const cop = el('input', { attrs: { type: 'text' }, value: '' });
  const panel = el('div', { cls: 'guidePanel', children: [
    el('div', { cls: 'guidePanelTitle', children: [el('span', { text: 'Certificate by Practicing Professional' })] }),
    el('div', { cls: 'guidefield', children: [el('div', { cls: 'guideFieldLabel', text: 'Whether practicing professional is chartered accountant, cost accountant or company secretary' }), lCA, lCost, lCS] }),
    el('div', { cls: 'guidefield', children: [el('div', { cls: 'guideFieldLabel', text: 'Whether associate or fellow' }), lA, lF] }),
    el('div', { cls: 'guidefield', children: [el('div', { cls: 'guideFieldLabel', text: 'Membership number' }), mem] }),
    el('div', { cls: 'guidefield', children: [el('div', { cls: 'guideFieldLabel', text: 'Certificate of practice number' }), cop] }),
  ] });
  // The declaration's own "membership" field outside the panel must never be touched.
  const decoy = el('input', { attrs: { type: 'text' }, value: '' });
  const decl = el('div', { cls: 'guidefield', children: [el('div', { cls: 'guideFieldLabel', text: 'DIN / PAN / Membership number of the signatory' }), decoy] });
  return { nodes: [decl, panel], rCA, rCost, rCS, rA, rF, mem, cop, decoy };
}
const CERT = { CERT_PROFESSION: 'Company Secretary', CERT_ASSOC_FELLOW: 'Fellow', CERT_MEMBERSHIP_NO: 'F1234', CERT_COP_NO: 'CP5678' };

test('certificate: fills profession, associate/fellow, membership and COP numbers inside the section only', async () => {
  const p = certPanel();
  await withDom(p.nodes, async () => {
    const r = S.pageStep2FillCertificate(CERT);
    assert.equal(r.found, true);
    assert.deepEqual(r.results.map(x => [x.key, x.ok]), [['CERT_PROFESSION', true], ['CERT_ASSOC_FELLOW', true], ['CERT_MEMBERSHIP_NO', true], ['CERT_COP_NO', true]]);
  });
  assert.deepEqual([p.rCA.checked, p.rCost.checked, p.rCS.checked], [false, false, true]);
  assert.deepEqual([p.rA.checked, p.rF.checked], [false, true]);
  assert.equal(p.mem.value, 'F1234'); assert.equal(p.cop.value, 'CP5678');
  assert.deepEqual(p.mem.events, ['input', 'change', 'blur']);
  assert.equal(p.decoy.value, '', 'the declaration field is untouched');
});

test('certificate: values already there are skipped, read-only fields are reported, absent section → found:false', async () => {
  const p = certPanel({ readonlyMem: true });
  p.rCS.checked = true; p.cop.value = 'CP5678';
  await withDom(p.nodes, async () => {
    const r = S.pageStep2FillCertificate(CERT);
    const by = Object.fromEntries(r.results.map(x => [x.key, x]));
    assert.equal(by.CERT_PROFESSION.skipped, true);
    assert.equal(p.rCS.clicks, 0);
    assert.deepEqual([by.CERT_MEMBERSHIP_NO.ok, by.CERT_MEMBERSHIP_NO.err], [false, 'read-only']);
    assert.equal(by.CERT_COP_NO.skipped, true);
  });
  assert.equal(p.mem.value, '');
  await withDom([btn('Save'), el('input', { attrs: { type: 'text' } })], async () => {
    assert.deepEqual(S.pageStep2FillCertificate(CERT), { found: false, results: [] });
  });
  // Empty values are not filled at all.
  const q = certPanel();
  await withDom(q.nodes, async () => {
    assert.deepEqual(S.pageStep2FillCertificate({ CERT_MEMBERSHIP_NO: 'F1' }).results.map(x => x.key), ['CERT_MEMBERSHIP_NO']);
  });
  assert.equal(q.rCA.checked || q.rCost.checked || q.rCS.checked, false);
  assert.doesNotMatch(S.pageStep2FillCertificate.toString(), /\bstep2[A-Z]\w*\(|STEP2_|chrome\./, 'self-contained page function');
});

test('step2Run auto: certificate values → filled after the declaration and listed; not found is only a warning', async () => {
  const r = await runStep2({ auto: true, files: { a: null, g: [] }, allowNoFileA: true, save: true, values: VALUES, certificate: CERT },
    { cert: { found: true, results: [{ key: 'CERT_PROFESSION', ok: true }, { key: 'CERT_ASSOC_FELLOW', ok: true }, { key: 'CERT_MEMBERSHIP_NO', ok: false, err: 'not found' }, { key: 'CERT_COP_NO', ok: true, skipped: true }] } });
  assert.deepEqual(r.execs, ['pageStep2Open', 'pageFill', 'pageFill', 'pageFill', 'pageFill', 'pageStep2FillCertificate', 'pageStep2ClickSave', 'pageConfirmSave']);
  assert.equal(r.res.ok, true); assert.equal(r.res.saved, true);
  assert.ok(r.res.items.some(([k, m]) => k === 'ok' && /Certificate: profession: Company Secretary/.test(m)));
  assert.ok(r.res.items.some(([k, m]) => k === 'warn' && /membership number: not filled \(not found\) — fill it on MCA/.test(m)));
  assert.ok(r.res.items.some(([, m]) => /CP5678 \(already on MCA\)/.test(m)));
  const none = await runStep2({ auto: true, files: { a: null, g: [] }, allowNoFileA: true, save: true, values: VALUES, certificate: CERT }, { cert: { found: false, results: [] } });
  assert.equal(none.res.ok, true);
  assert.ok(none.res.items.some(([k, m]) => k === 'warn' && /not found on this page — fill it on MCA/.test(m)));
  const empty = await runStep2({ auto: true, files: { a: null, g: [] }, allowNoFileA: true, save: true, values: VALUES, certificate: { CERT_COP_NO: ' ' } });
  assert.ok(!empty.execs.includes('pageStep2FillCertificate'), 'no values → not called');
});

test('board resolution number longer than MCA’s 10 characters is caught before the run', async () => {
  const { createRequire } = await import('node:module');
  const req = createRequire(import.meta.url);
  const { step2Validate } = req('../js/step2-attach.js');
  const base = { fileA: { name: 'a.pdf' }, resDate: '30/09/2026', desig: 'Director', din: '07654321' };
  assert.ok(step2Validate({ ...base, resNo: 'TEST-01/2026-27' }).some(e => /at most 10 characters/.test(e)));
  assert.deepEqual(step2Validate({ ...base, resNo: 'TEST-01/26' }), []);
});

// ── dashboard attachments (AOC-4 Page 2 in the dashboard) ──
function dashFetch({ list, offline = false, hang = false, broken = [] } = {}) {
  const seen = [];
  const fn = async (url, o = {}) => {
    seen.push(url);
    if (offline) throw new Error('ECONNREFUSED');
    if (hang) return new Promise((_, rej) => { if (o.signal) o.signal.addEventListener('abort', () => rej(new Error('aborted'))); });
    const m = url.match(/\/api\/attachments\/([^/?]+)\/content$/);
    if (m) return broken.includes(m[1]) ? { ok: false, status: 404 } : { ok: true, blob: async () => new Blob(['%PDF-1.4 ' + m[1]]) };
    if (/\/api\/attachments\?/.test(url)) return { ok: true, json: async () => ({ ok: true, attachments: list }) };
    return null;
  };
  return { fn, seen };
}
const LIST = [
  { id: 'att_a', slot: 'a', fileName: 'FS.pdf', size: 2 * 1048576, mime: 'application/pdf' },
  { id: 'att_g1', slot: 'g', fileName: 'one.pdf', size: 1048576 },
  { id: 'att_g2', slot: 'g', fileName: 'two.pdf', size: 524288 },
];

test('dashboard list: (a) and (g) split; invalid CIN or offline → null, no network for a bad CIN', async () => {
  const f = dashFetch({ list: LIST });
  const d = await S.step2DashList(CIN.toLowerCase(), f.fn);
  assert.equal(d.a.id, 'att_a');
  assert.deepEqual(d.g.map(x => x.id), ['att_g1', 'att_g2']);
  assert.equal(f.seen[0], `${S.STEP2_ATTACH_API}?cin=${CIN}&formType=aoc4`);
  const none = dashFetch({ list: LIST });
  assert.equal(await S.step2DashList('BAD', none.fn), null);
  assert.deepEqual(none.seen, []);
  assert.equal(await S.step2DashList(CIN, dashFetch({ offline: true }).fn), null);
  assert.equal(await S.step2DashList(CIN, async () => ({ ok: false, status: 500 })), null);
  const empty = await S.step2DashList(CIN, dashFetch({ list: [] }).fn);
  assert.deepEqual(empty, { a: null, g: [] });
});

test('dashboard file: downloaded as a named PDF File; failure → null', async () => {
  const f = dashFetch({ list: LIST });
  const file = await S.step2DashFile(LIST[0], f.fn);
  assert.equal(file.name, 'FS.pdf');
  assert.equal(file.type, 'application/pdf');
  assert.equal(await file.text(), '%PDF-1.4 att_a');
  assert.equal(f.seen[0], `${S.STEP2_ATTACH_API}/att_a/content`);
  assert.equal(await S.step2DashFile(LIST[0], dashFetch({ broken: ['att_a'] }).fn), null);
  assert.equal(await S.step2DashFile(null, f.fn), null);
});

test('use dashboard: only empty slots are filled, skipA keeps (a) out, offline leaves the files as they were', async () => {
  const f = dashFetch({ list: LIST });
  const r = await S.step2UseDashboard(CIN, { a: null, g: [] }, { fetchFn: f.fn });
  assert.equal(r.files.a.name, 'FS.pdf');
  assert.deepEqual(r.files.g.map(x => x.name), ['one.pdf', 'two.pdf']);
  assert.deepEqual(r.used, ['Using (a) from dashboard: FS.pdf (2.0 MB)', 'Using (g) from dashboard: one.pdf (1.0 MB), two.pdf (0.5 MB)']);
  const mine = { name: 'mine.pdf', size: 1 };
  const kept = await S.step2UseDashboard(CIN, { a: mine, g: [mine] }, { fetchFn: f.fn });
  assert.equal(kept.files.a, mine); assert.deepEqual(kept.files.g, [mine]); assert.deepEqual(kept.used, []);
  const skip = dashFetch({ list: LIST });
  const s2 = await S.step2UseDashboard(CIN, { a: null, g: [] }, { skipA: true, fetchFn: skip.fn });
  assert.equal(s2.files.a, null);
  assert.ok(!skip.seen.some(u => /att_a/.test(u)));
  const off = await S.step2UseDashboard(CIN, { a: null, g: [] }, { fetchFn: dashFetch({ offline: true }).fn });
  assert.equal(off.offline, true); assert.equal(off.files.a, null);
  const broken = await S.step2UseDashboard(CIN, { a: null, g: [] }, { fetchFn: dashFetch({ list: LIST, broken: ['att_g1'] }).fn });
  assert.deepEqual(broken.files.g.map(x => x.name), ['two.pdf']);
  assert.deepEqual(broken.failed, ['(g) one.pdf could not be downloaded from the dashboard']);
  assert.match(broken.used[1], /^Using \(g\) from dashboard: two\.pdf/);
});

test('manual step 2 button with no file picked: the dashboard (a) and (g) are uploaded', async () => {
  const f = dashFetch({ list: LIST });
  const panel = { s2ResNo: { value: 'BR/01' }, s2ResDate: { value: '30/09/2026' }, s2Desig: { value: 'Director' }, s2Din: { value: '07654321' }, s2Save: { checked: true } };
  const r = await runStep2({ type: 'click', preventDefault() {} }, { fetchExtra: f.fn, panel });
  assert.equal(r.res.ok, true, JSON.stringify(r.res.items));
  assert.deepEqual(r.execs.slice(0, 4), ['pageStep2Open', 'pageStep2Attach', 'pageStep2Attach', 'pageStep2Attach']);
  assert.ok(r.res.items.some(([k, m]) => k === 'ok' && /^Using \(a\) from dashboard: FS\.pdf/.test(m)));
  assert.ok(r.res.items.some(([k, m]) => k === 'ok' && /\(a\) FS\.pdf \([0-9.]+ MB\) uploaded/.test(m)));
});
