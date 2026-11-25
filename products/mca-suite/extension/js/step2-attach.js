// AOC-4 step 2 ("Attachment & Declaration").
// After step 1 (Company details) is filled and saved, this panel:
//   1. clicks MCA's Next once to open step 2 (only when step 1 is the active step),
//   2. attaches the PDF(s) chosen in the side panel and clicks that slot's Upload,
//   3. fills the declaration (board resolution number + date, designation, DIN) and, when given, the
//      "Certificate by Practicing Professional" (pageStep2FillCertificate),
//   4. clicks this step's Save (optional) and reports MCA's response.
// step2Run never moves on from step 2: the autopilot clicks MCA's Proceed itself after the Save (pageApForward in
// autopilot.js). pageStep2NextToReview stays for the manual tools. Nothing here ever clicks Submit.
// Page functions run in the MCA page (world MAIN) and must stay self-contained.

const STEP2_ANSWERS_API = 'http://localhost:4000/api/company-answers';
// PDFs uploaded in the dashboard (AOC-4 Page 2) per company: used when the side panel has no file chosen.
const STEP2_ATTACH_API = 'http://localhost:4000/api/attachments';
const STEP2_CIN_RE = /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;
// MCA's resolution-number box (page 2 declaration) cuts anything longer than this (seen on the live form).
const STEP2_RESNO_MAX = 10;
const STEP2_DECL = {
  resNo:   'input[name$="panel_985107667-panel-guidetextbox___jqName"]',
  resDate: 'input[name$="panel_985107667-panel-guidetextbox_copy_co___jqName"]',
  desig:   'select[name$="panel_985107667-panel-guidedropdownlist___jqName"]',
  din:     'input[name$="panel_985107667-panel-guidetextbox_6793388___jqName"]',
};
const STEP2_SLOTS = {
  a: { input: 'input[type="file"][name$="panel_985107667-fileuploadwithplaceh___jqName"]', labelRe: '^\\s*\\(a\\)' },
  g: { input: 'input[type="file"][name*="guidefileupload_copy_651054413"]', labelRe: '^\\s*\\(g\\)' },
};

// ───────────────────────── page functions (MCA tab) ─────────────────────────

// Opens step 2. Clicks Next only while "Company details" is the active step.
async function pageStep2Open(waitMs = 45000) {
  const pause = ms => new Promise(r => setTimeout(r, ms));
  const visible = el => !!el && el.getClientRects().length > 0;
  const text = el => String(el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
  // A popup / field error counts only when really shown (MCA keeps hidden popup templates in the DOM: laid out but
  // visibility:hidden / opacity:0 / aria-hidden / zero size). Their message is read from innerText only.
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
  const popupText = el => String((el && el.innerText) || '').replace(/\s+/g, ' ').trim();
  // Shown popup boxes; when a container and its inner content both match, the innermost one is used (its OK may sit
  // in the shown container around it: okScope).
  let lastShown = [];
  const innermostShown = sel => {
    lastShown = [...document.querySelectorAll(sel)].filter(shown);
    return lastShown.filter(d => !lastShown.some(o => o !== d && d.contains(o)));
  };
  const okScope = d => {
    const hasOk = box => [...box.querySelectorAll('button, input[type="button"], [role="button"], a')].some(b => visible(b) && /^(ok|okay|close)$/i.test(text(b)));
    if (hasOk(d)) return d;
    for (let x = d.parentElement; x; x = x.parentElement) if (lastShown.includes(x) && shown(x)) return x;
    return d;
  };
  const activeStep = () => text([...document.querySelectorAll('.listep.progress-step.active')].pop());
  const errors = () => [...document.querySelectorAll('.guideFieldError')].filter(shown).map(popupText).filter(Boolean);
  const dialogs = [];
  const saved = { alert: window.alert, confirm: window.confirm };
  window.alert = m => { dialogs.push(String(m)); };
  window.confirm = m => { dialogs.push(String(m)); return true; };
  try {
    const from = activeStep();
    if (/att\w*ment/i.test(from)) return { ok: true, from, to: from, clicked: false };
    if (/review/i.test(from)) return { ok: false, from, reason: 'review' };
    if (!/company details/i.test(from)) return { ok: false, from, reason: 'unknown-step' };
    const next = [...document.querySelectorAll('button, input[type="button"], [role="button"]')]
      .filter(b => visible(b) && !b.disabled && /^next$/i.test(text(b) || b.value || '')
        && !b.closest('[id*="modal_container"], [role="dialog"], [role="alertdialog"], .modal, .ui-dialog'));
    if (next.length !== 1) return { ok: false, from, reason: next.length ? 'several-next' : 'no-next' };
    next[0].scrollIntoView({ block: 'center' });
    next[0].click();
    const t0 = Date.now();
    while (Date.now() - t0 < waitMs) {
      await pause(400);
      // Close an informational OK dialog (e.g. "data saved") that can appear on the way.
      for (const d of innermostShown('[id*="modal_container"], [role="dialog"], [role="alertdialog"], .modal-dialog, .ui-dialog, .swal2-popup, .guideDialogNode')) {
        const ok = [...okScope(d).querySelectorAll('button, [role="button"]')].find(b => visible(b) && /^(ok|okay|close)$/i.test(text(b)));
        if (ok && shown(d)) { dialogs.push(popupText(d).slice(0, 160)); ok.click(); }
      }
      const now = activeStep();
      if (/att\w*ment/i.test(now)) return { ok: true, from, to: now, clicked: true, dialogs };
      const errs = errors();
      if (errs.length && Date.now() - t0 > 4000) return { ok: false, from, reason: 'validation', errors: [...new Set(errs)].slice(0, 8), dialogs };
    }
    return { ok: false, from, reason: 'timeout', dialogs };
  } finally { window.alert = saved.alert; window.confirm = saved.confirm; }
}

// Puts one file into an attachment slot and clicks its Upload. b64 is the file content.
async function pageStep2Attach(slot, inputSelector, labelRe, file, waitMs = 90000) {
  const pause = ms => new Promise(r => setTimeout(r, ms));
  const visible = el => !!el && el.getClientRects().length > 0;
  const text = el => String(el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
  // A popup / field error counts only when really shown (MCA keeps hidden popup templates in the DOM: laid out but
  // visibility:hidden / opacity:0 / aria-hidden / zero size). Their message is read from innerText only.
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
  const popupText = el => String((el && el.innerText) || '').replace(/\s+/g, ' ').trim();
  // Shown popup boxes; when a container and its inner content both match, the innermost one is used (its OK may sit
  // in the shown container around it: okScope).
  let lastShown = [];
  const innermostShown = sel => {
    lastShown = [...document.querySelectorAll(sel)].filter(shown);
    return lastShown.filter(d => !lastShown.some(o => o !== d && d.contains(o)));
  };
  const okScope = d => {
    const hasOk = box => [...box.querySelectorAll('button, input[type="button"], [role="button"], a')].some(b => visible(b) && /^(ok|okay|close)$/i.test(text(b)));
    if (hasOk(d)) return d;
    for (let x = d.parentElement; x; x = x.parentElement) if (lastShown.includes(x) && shown(x)) return x;
    return d;
  };
  const dialogs = [];
  const saved = { alert: window.alert, confirm: window.confirm };
  window.alert = m => { dialogs.push(String(m)); };
  window.confirm = m => { dialogs.push(String(m)); return true; };
  const widgetOf = input => input.closest('.afFileUpload, .guideFieldWidget') || input.parentElement;
  const btn = (w, re) => [...w.querySelectorAll('button')].find(b => re.test(text(b)));
  try {
    // Locate the slot: by its field name first, then by the "(a)"/"(g)" label next to it.
    let inputs = [...document.querySelectorAll(inputSelector)].filter(i => visible(widgetOf(i)));
    if (!inputs.length) {
      const re = new RegExp(labelRe, 'i');
      inputs = [...document.querySelectorAll('input[type="file"]')].filter(i => {
        const node = i.closest('.guidefield, .guideFieldNode') || widgetOf(i).parentElement;
        const lab = node && node.querySelector('.guideFieldLabel, label');
        return visible(widgetOf(i)) && lab && re.test(text(lab));
      });
    }
    if (!inputs.length) return { ok: false, reason: 'slot-not-found' };
    // For the optional slot, use the first empty instance; add one with "+" when all are used.
    let input = inputs.find(i => { const p = btn(widgetOf(i), /^preview$/i); return !p || p.disabled; });
    if (!input && slot === 'g') {
      const plus = btn(widgetOf(inputs[inputs.length - 1]), /^\+$/);
      if (!plus) return { ok: false, reason: 'no-free-slot' };
      plus.click();
      for (let w = 0; w < 20 && !input; w++) {
        await pause(300);
        input = [...document.querySelectorAll(inputSelector)].filter(i => visible(widgetOf(i)))
          .find(i => { const p = btn(widgetOf(i), /^preview$/i); return !p || p.disabled; });
      }
    }
    if (!input) {
      const shown = text(widgetOf(inputs[0])).replace(/Choose File|Upload|Preview|Remove|\+/g, '').trim();
      return { ok: true, skipped: true, reason: 'already-attached', current: shown.slice(0, 120) };
    }
    const w = widgetOf(input);
    // Build the File and hand it to the input the same way a user's file picker does.
    const bin = atob(file.b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const f = new File([bytes], file.name, { type: file.type || 'application/pdf', lastModified: Date.now() });
    const dt = new DataTransfer();
    dt.items.add(f);
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await pause(800);
    if (dialogs.length) return { ok: false, reason: 'rejected', dialogs };
    const up = btn(w, /^upload$/i);
    if (!up) return { ok: false, reason: 'no-upload-button' };
    for (let i = 0; i < 10 && up.disabled; i++) await pause(300);
    if (up.disabled) return { ok: false, reason: 'upload-disabled', shown: text(w).slice(0, 160) };
    up.click();
    // MCA answers an upload with its own popup (AEM *modal_container*): "uploaded successfully", or an error such as
    // a file that is too large. Every popup is read, closed with its OK / Close (and hidden for sure when that did not
    // close it, so the page is never left dimmed), and an error popup ends the upload with MCA's own words.
    const DLG = '[id*="modal_container"], [role="dialog"], [role="alertdialog"], .modal-dialog, .ui-dialog, .swal2-popup, .guideDialogNode';
    const bad = /error|fail|invalid|exceed|not allowed|maximum|max\.? size|size limit|too large|larger than|virus|corrupt|password.protected|encrypted|only pdf/i;
    const meta = b => `${b.getAttribute('aria-label') || ''} ${b.getAttribute('title') || ''}`;
    // Only for a box that was shown before its OK click and is still shown after it (never a hidden template).
    const forceClose = box => {
      if (!shown(box)) return;
      // box is shown, so none of its ancestors (the modal_container host included) is hidden: the host may still be a
      // zero-size wrapper around a fixed-position popup, so it is not size-checked again.
      const host = (box.closest && box.closest('[id*="modal_container"]')) || box;
      try {
        const gb = window.guideBridge;
        if (gb && typeof gb.visit === 'function' && host.id) gb.visit(n => { if (n && n.id === host.id) { try { n.visible = false; } catch (_) { } } });
      } catch (_) { }
      if (host.style) host.style.display = 'none';
      try { document.querySelectorAll('.modal-backdrop').forEach(b => b.remove()); } catch (_) { }
      try { if (document.body && document.body.classList) document.body.classList.remove('modal-open'); } catch (_) { }
    };
    const closePopups = async () => {
      const seen = [];
      for (const d of innermostShown(DLG)) {
        if (!shown(d)) continue; // closed meanwhile (e.g. with a box handled just before)
        const msg = popupText(d);
        if (!msg) continue;
        seen.push(msg.slice(0, 200));
        if (!dialogs.includes(msg.slice(0, 200))) dialogs.push(msg.slice(0, 200));
        const ok = [...okScope(d).querySelectorAll('button, input[type="button"], [role="button"], a, span[class*="close"], i[class*="close"]')]
          .find(b => visible(b) && !/submit|proceed|yes|remove|delete/i.test(text(b) + ' ' + meta(b))
            && (/^(ok|okay|close|×|✕)$/i.test(text(b)) || /\b(close|dismiss)\b/i.test(meta(b))));
        if (ok) { ok.click(); await pause(500); if (shown(d)) forceClose(d); }
      }
      return seen;
    };
    const t0 = Date.now();
    while (Date.now() - t0 < waitMs) {
      await pause(500);
      const seen = await closePopups();
      const err = seen.find(m => bad.test(m) && !/success/i.test(m));
      if (err) return { ok: false, reason: 'mca-error', dialogs };
      const prev = btn(w, /^preview$/i);
      if (prev && !prev.disabled) {
        // A success popup can come a moment after Preview is enabled: close it too.
        await pause(700);
        await closePopups();
        return { ok: true, name: file.name, dialogs, waitedMs: Date.now() - t0 };
      }
    }
    await closePopups();
    return { ok: false, reason: 'timeout', dialogs };
  } finally { window.alert = saved.alert; window.confirm = saved.confirm; }
}

// Moves from "Attachment & Declaration" to "Review & Submit" by clicking that step's Next (used by the
// autopilot after step 2 is saved). Clicks only a single visible, enabled button whose text is exactly
// "Next" outside any dialog — never Submit. Closes only plain OK / Okay / Close info dialogs on the way.
async function pageStep2NextToReview(waitMs = 45000) {
  const pause = ms => new Promise(r => setTimeout(r, ms));
  const visible = el => !!el && el.getClientRects().length > 0;
  const text = el => String(el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
  // A popup / field error counts only when really shown (MCA keeps hidden popup templates in the DOM: laid out but
  // visibility:hidden / opacity:0 / aria-hidden / zero size). Their message is read from innerText only.
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
  const popupText = el => String((el && el.innerText) || '').replace(/\s+/g, ' ').trim();
  // Shown popup boxes; when a container and its inner content both match, the innermost one is used (its OK may sit
  // in the shown container around it: okScope).
  let lastShown = [];
  const innermostShown = sel => {
    lastShown = [...document.querySelectorAll(sel)].filter(shown);
    return lastShown.filter(d => !lastShown.some(o => o !== d && d.contains(o)));
  };
  const okScope = d => {
    const hasOk = box => [...box.querySelectorAll('button, input[type="button"], [role="button"], a')].some(b => visible(b) && /^(ok|okay|close)$/i.test(text(b)));
    if (hasOk(d)) return d;
    for (let x = d.parentElement; x; x = x.parentElement) if (lastShown.includes(x) && shown(x)) return x;
    return d;
  };
  const label = el => text(el) || String(el?.value || '').replace(/\s+/g, ' ').trim();
  const activeStep = () => text([...document.querySelectorAll('.listep.progress-step.active')].pop());
  const errors = () => [...document.querySelectorAll('.guideFieldError')].filter(shown).map(popupText).filter(Boolean);
  const inDialog = b => !!b.closest('[id*="modal_container"], [role="dialog"], [role="alertdialog"], .modal, .modal-dialog, .ui-dialog, .swal2-popup');
  const dialogs = [];
  const saved = { alert: window.alert, confirm: window.confirm };
  // The autopilot's Stop sets window.__germin8StopNav (a separate page call): after it no dialog is closed.
  window.__germin8StopNav = false;
  const stopped = () => window.__germin8StopNav === true;
  window.alert = m => { dialogs.push(String(m)); };
  window.confirm = m => { dialogs.push(String(m)); return true; };
  try {
    const from = activeStep();
    if (/review/i.test(from)) return { ok: true, from, to: from, clicked: false, dialogs };
    if (!/att\w*ment/i.test(from)) return { ok: false, from, clicked: false, reason: 'not-on-step-2', dialogs };
    const candidates = [...document.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"]')]
      .filter(b => visible(b) && !b.disabled && !inDialog(b) && /\bnext\b|submit/i.test(label(b)));
    const next = candidates.filter(b => /^next$/i.test(label(b)) && !/submit/i.test(label(b)));
    if (next.length !== 1) {
      const reason = !next.length && candidates.length && candidates.every(b => /submit/i.test(label(b))) ? 'submit-only'
        : next.length ? 'several-next' : 'no-next';
      return { ok: false, from, clicked: false, reason, dialogs };
    }
    const b = next[0];
    if (/submit/i.test(label(b)) || /submit/i.test(String(b.value || ''))) return { ok: false, from, clicked: false, reason: 'submit-only', dialogs };
    if (typeof b.scrollIntoView === 'function') b.scrollIntoView({ block: 'center' });
    b.click();
    const t0 = Date.now();
    while (Date.now() - t0 < waitMs) {
      await pause(400);
      if (stopped()) return { ok: false, from, to: activeStep(), clicked: true, reason: 'stopped', dialogs };
      // Close an informational OK dialog (e.g. "data saved") that can appear on the way.
      for (const d of innermostShown('[id*="modal_container"], [role="dialog"], [role="alertdialog"], .modal-dialog, .ui-dialog, .swal2-popup, .guideDialogNode')) {
        const ok = [...okScope(d).querySelectorAll('button, [role="button"]')].find(x => visible(x) && /^(ok|okay|close)$/i.test(text(x)));
        if (ok && shown(d)) { dialogs.push(popupText(d).slice(0, 160)); ok.click(); }
      }
      const now = activeStep();
      if (/review/i.test(now)) return { ok: true, from, to: now, clicked: true, dialogs };
      const errs = errors();
      if (errs.length && Date.now() - t0 > 4000) return { ok: false, from, to: now, clicked: true, reason: 'validation', errors: [...new Set(errs)].slice(0, 8), dialogs };
    }
    return { ok: false, from, to: activeStep(), clicked: true, reason: 'timeout', dialogs };
  } finally { window.alert = saved.alert; window.confirm = saved.confirm; }
}

// Fills "Certificate by Practicing Professional" on Attachment & Declaration. Its field names are not known, so
// controls are found by their label text inside the smallest panel around that heading which holds inputs.
// values: {CERT_PROFESSION, CERT_ASSOC_FELLOW, CERT_MEMBERSHIP_NO, CERT_COP_NO} (any may be empty = not filled).
// Readonly / disabled controls and controls already holding the value are left alone.
// Returns {found:boolean, results:[{key, ok, err?, skipped?}]} — found:false when the section is not on the page.
function pageStep2FillCertificate(values) {
  const v = values || {};
  const norm = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const text = el => norm(el && (el.innerText || el.textContent));
  const HEAD = /certificate by practi[cs]ing professional/i;
  const tagOf = el => String((el && (el.tagName || el.tag)) || '').toLowerCase();
  const classOf = el => String((el && (typeof el.className === 'string' ? el.className : (el.cls || []).join(' '))) || '');
  const parentOf = el => (el && (el.parentElement || el.parent)) || null;
  // Rendered on screen (a hidden wizard panel's copy is never filled). Stub DOMs without layout count as shown.
  const shown = el => !el || typeof el.getClientRects !== 'function' || el.getClientRects().length > 0
    || (String(el.type || '').toLowerCase() === 'radio' && !!(el.closest && el.closest('label') && el.closest('label').getClientRects().length));
  // The page-2 declaration fields (resolution no/date, designation, DIN) are never touched here.
  const DECL = ['panel_985107667-panel-guidetextbox___jqName', 'panel_985107667-panel-guidetextbox_copy_co___jqName',
    'panel_985107667-panel-guidedropdownlist___jqName', 'panel_985107667-panel-guidetextbox_6793388___jqName'];
  const isDecl = i => { const n = String(i.name || (typeof i.getAttribute === 'function' && i.getAttribute('name')) || ''); return DECL.some(x => n.endsWith(x)); };
  const controls = root => [...root.querySelectorAll('input, select, textarea')]
    .filter(i => !/^(hidden|file|button|submit)$/i.test(String(i.type || (i.attrs && i.attrs.type) || '')) && shown(i) && !isDecl(i));
  // 1. The heading: the visible element with the shortest text that names the section.
  const heads = [...document.querySelectorAll('label, legend, h1, h2, h3, h4, h5, h6, p, span, div, b, strong, td, th')]
    .filter(e => HEAD.test(text(e)) && shown(e));
  if (!heads.length) return { found: false, results: [] };
  heads.sort((a, b) => text(a).length - text(b).length);
  // 2. Scope: the smallest panel around it that holds inputs (else the nearest ancestor with a few inputs).
  let scope = null, fallback = null;
  for (let x = parentOf(heads[0]), depth = 0; x && depth < 12; x = parentOf(x), depth++) {
    const n = controls(x).length;
    if (!n) continue;
    const panel = /^(fieldset|section)$/.test(tagOf(x)) || /panel/i.test(classOf(x));
    if (panel) { scope = x; break; }
    if (!fallback && n <= 12) fallback = x;
  }
  scope = scope || fallback;
  if (!scope) return { found: false, results: [] };
  // Only controls AFTER the heading (the certificate follows its heading; the declaration comes before it).
  const after = c => typeof heads[0].compareDocumentPosition !== 'function' || !!(heads[0].compareDocumentPosition(c) & 4);
  const all = controls(scope).filter(after);
  // Label of a control: aria-label, placeholder, <label for>, a wrapping <label>, the AEM field label next to it.
  const labelOf = el => {
    const parts = [];
    const attr = k => (typeof el.getAttribute === 'function' ? el.getAttribute(k) : null);
    parts.push(attr('aria-label'), attr('placeholder'), attr('title'));
    if (el.id) { try { const l = document.querySelector(`label[for="${el.id}"]`); if (l) parts.push(text(l)); } catch (_) { } }
    const wrap = el.closest && el.closest('label');
    if (wrap) parts.push(text(wrap));
    const field = el.closest && el.closest('.guidefield, .guideFieldNode, .form-group, .field');
    const fl = field && field.querySelector('.guideFieldLabel, label');
    if (fl) parts.push(text(fl));
    return norm(parts.filter(Boolean).join(' | '));
  };
  // A radio option's own label only (the group's label names every option).
  const optionLabel = el => {
    const attr = k => (typeof el.getAttribute === 'function' ? el.getAttribute(k) : null);
    if (attr('aria-label')) return norm(attr('aria-label'));
    if (el.id) { try { const l = document.querySelector(`label[for="${el.id}"]`); if (l && text(l)) return text(l); } catch (_) { } }
    const wrap = el.closest && el.closest('label');
    if (wrap && text(wrap)) return text(wrap);
    const sib = el.nextElementSibling || null;
    if (sib && text(sib)) return text(sib);
    return norm(el.value);
  };
  const off = el => !!(el.disabled || el.readOnly || (typeof el.getAttribute === 'function' && (el.getAttribute('readonly') != null || el.getAttribute('aria-readonly') === 'true')));
  const fire = (el, names) => {
    for (const n of names) { try { el.dispatchEvent(new Event(n, { bubbles: true })); } catch (_) { } }
    try { if (window.jQuery) for (const n of names) window.jQuery(el).trigger(n); } catch (_) { }
  };
  // AEM keeps the real value in its form model (guideBridge); MCA validates the model, not the box on screen.
  // Widget ids are "<componentId>_widget" (radios "<componentId>-N_widget"); else the name without ___jqName.
  let nodes = null;
  const modelNode = el => {
    const gb = window.guideBridge;
    if (!gb || typeof gb.visit !== 'function') return null;
    if (!nodes) { nodes = new Map(); try { gb.visit(c => { if (c && c.id) nodes.set(c.id, c); }); } catch (_) { return null; } }
    const id = String(el.id || '').replace(/-\d+_widget$/, '').replace(/_widget$/, '');
    const name = String(el.name || '').replace(/___jqName$/, '').replace(/_widget$/, '');
    let node = nodes.get(id) || nodes.get(name) || null;
    if (!node) {
      const key = id || name, hits = [];
      if (key.length >= 12) for (const [k, v] of nodes) if (k.length >= 12 && (key.endsWith(k) || k.endsWith(key))) hits.push(v);
      if (hits.length === 1) node = hits[0];
    }
    return node;
  };
  const setModel = (el, value) => {
    const node = modelNode(el);
    if (!node) return null;
    try { if (String(node.value ?? '') === String(value)) return true; node.value = value; return String(node.value ?? '') === String(value); } catch (_) { return false; }
  };
  const modelOf = el => { const n = modelNode(el); try { return n ? String(n.value ?? '') : null; } catch (_) { return null; } };
  const setValue = (el, value) => {
    const proto = tagOf(el) === 'select' ? (typeof HTMLSelectElement !== 'undefined' && HTMLSelectElement.prototype)
      : tagOf(el) === 'textarea' ? (typeof HTMLTextAreaElement !== 'undefined' && HTMLTextAreaElement.prototype)
        : (typeof HTMLInputElement !== 'undefined' && HTMLInputElement.prototype);
    const desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value); else el.value = value; // the native setter (Angular / AEM)
    fire(el, ['input', 'change', 'blur']);
  };
  const isRadio = el => String(el.type || (el.attrs && el.attrs.type) || '').toLowerCase() === 'radio';
  const isText = el => tagOf(el) === 'textarea' || (tagOf(el) === 'input' && !isRadio(el) && !/^(checkbox)$/i.test(String(el.type || (el.attrs && el.attrs.type) || '')));
  // A choice (radio option or select option) whose label matches re.
  const choose = (key, re) => {
    const radio = all.filter(isRadio).find(r => re.test(optionLabel(r)));
    if (radio) {
      const m0 = modelOf(radio);
      if (radio.checked && (m0 === null || m0 === String(radio.value))) return { key, ok: true, skipped: true };
      if (off(radio)) return { key, ok: false, err: 'read-only' };
      setModel(radio, radio.value);
      radio.click();
      if (!radio.checked) { radio.checked = true; fire(radio, ['change']); }
      const m1 = modelOf(radio);
      if (m1 !== null && m1 !== String(radio.value)) return { key, ok: false, err: `MCA kept "${m1}"` };
      return { key, ok: true };
    }
    for (const sel of all.filter(e => tagOf(e) === 'select')) {
      const opt = [...(sel.options || sel.querySelectorAll('option'))].find(o => re.test(text(o)) || re.test(norm(o.value)));
      if (!opt) continue;
      if (String(sel.value) === String(opt.value)) return { key, ok: true, skipped: true };
      if (off(sel)) return { key, ok: false, err: 'read-only' };
      setValue(sel, opt.value);
      return { key, ok: String(sel.value) === String(opt.value), ...(String(sel.value) === String(opt.value) ? {} : { err: 'option not taken' }) };
    }
    return { key, ok: false, err: 'not found' };
  };
  const typeInto = (key, re, value, reNot) => {
    const el = all.filter(isText).find(i => re.test(labelOf(i)) && !(reNot && reNot.test(labelOf(i))));
    if (!el) return { key, ok: false, err: 'not found' };
    const m0 = modelOf(el);
    if (norm(el.value) === norm(value) && (m0 === null || norm(m0) === norm(value))) return { key, ok: true, skipped: true };
    if (off(el)) return { key, ok: false, err: 'read-only' };
    const viaModel = setModel(el, value);
    setValue(el, value);
    const m1 = modelOf(el);
    if (m1 !== null && norm(m1) !== norm(value)) return { key, ok: false, err: `MCA kept "${m1}"` };
    return norm(el.value) === norm(value) ? { key, ok: true, model: viaModel !== null } : { key, ok: false, err: 'value not taken' };
  };
  const results = [];
  const prof = norm(v.CERT_PROFESSION);
  if (prof) {
    const re = /chartered/i.test(prof) ? /chartered accountant/i : /cost/i.test(prof) ? /cost accountant/i : /secretary/i.test(prof) ? /company secretary/i : null;
    results.push(re ? choose('CERT_PROFESSION', re) : { key: 'CERT_PROFESSION', ok: false, err: 'unknown profession' });
  }
  const af = norm(v.CERT_ASSOC_FELLOW);
  if (af) {
    const re = /fellow/i.test(af) ? /^\s*fellow\b/i : /associate/i.test(af) ? /^\s*associate\b/i : null;
    results.push(re ? choose('CERT_ASSOC_FELLOW', re) : { key: 'CERT_ASSOC_FELLOW', ok: false, err: 'choose Associate or Fellow' });
  }
  if (norm(v.CERT_MEMBERSHIP_NO)) results.push(typeInto('CERT_MEMBERSHIP_NO', /membership/i, norm(v.CERT_MEMBERSHIP_NO), /director identification|\bDIN\b|\bPAN\b|secretary of the company/i));
  if (norm(v.CERT_COP_NO)) results.push(typeInto('CERT_COP_NO', /certificate of practi[cs]e|\bcop\b|practi[cs]e (number|no)/i, norm(v.CERT_COP_NO)));
  return { found: true, results };
}

// Clicks the Save of the Attachment & Declaration step (never Next / Submit).
function pageStep2ClickSave() {
  const visible = el => !!el && el.getClientRects().length > 0;
  const text = el => String(el?.innerText || el?.textContent || el?.value || '').replace(/\s+/g, ' ').trim();
  if (!/att\w*ment/i.test(text([...document.querySelectorAll('.listep.progress-step.active')].pop()))) return { clicked: false, reason: 'not-on-step-2' };
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
  const saves = [...document.querySelectorAll('button, input[type="button"], [role="button"]')]
    .filter(b => displayed(b) && !b.disabled && /^save$/i.test(text(b)) && !b.closest('[id*="modal_container"], [role="dialog"], [role="alertdialog"], .modal, .ui-dialog'));
  if (!saves.length) return { clicked: false, reason: 'no-save' };
  const b = saves[saves.length - 1];
  b.scrollIntoView({ block: 'center' });
  b.click();
  return { clicked: true };
}

// ───────────────────────── side panel ─────────────────────────

function step2El(id) { return document.getElementById(id); }

function step2Result(items) {
  const ul = step2El('s2Result');
  if (!ul) return;
  ul.innerHTML = '';
  for (const [kind, msg] of items) {
    const li = document.createElement('li');
    li.className = kind === 'ok' ? 'ok' : kind === 'warn' ? 'warn' : kind === 'err' ? 'err' : '';
    li.textContent = (kind === 'ok' ? '✓ ' : kind === 'err' ? '✗ ' : kind === 'warn' ? '! ' : '• ') + msg;
    ul.appendChild(li);
  }
}

function step2Cin() {
  try { return (typeof currentData !== 'undefined' && currentData && (currentData.CIN || currentData.cin)) || ''; } catch (_) { return ''; }
}

async function step2Prefill(force = false) {
  const set = (id, v) => { const el = step2El(id); if (el && v && (force || !el.value)) el.value = v; };
  try {
    const c = typeof currentClient !== 'undefined' ? currentClient : null;
    const s = c && Array.isArray(c.signatoriesFS) && c.signatoriesFS[0];
    if (s) { set('s2Din', s.din); }
    const d = typeof currentData !== 'undefined' ? currentData : null;
    if (d) { set('s2ResNo', d.BOARD_RESOLUTION_NO); set('s2ResDate', d.BOARD_RESOLUTION_DATE); set('s2Din', d.DECL_DIN); }
  } catch (_) { /* no client loaded */ }
  const cin = step2Cin();
  if (!cin) return;
  try {
    const r = await fetch(`${STEP2_ANSWERS_API}?cin=${encodeURIComponent(cin)}&form=aoc4`, { cache: 'no-store' });
    const body = await r.json();
    const a = Object.fromEntries((body.answers || []).map(x => [x.field_key, x.value]));
    set('s2ResNo', a.BOARD_RESOLUTION_NO); set('s2ResDate', a.BOARD_RESOLUTION_DATE);
    set('s2Din', a.DECL_DIN);
    if (a.DECL_DESIGNATION && step2El('s2Desig') && (force || !step2El('s2Desig').dataset.touched)) step2El('s2Desig').value = a.DECL_DESIGNATION;
  } catch (_) { /* backend offline */ }
}

// ───────────────────────── dashboard attachments ─────────────────────────

// fetch with a time limit (the backend may be offline: the run must never hang on it).
async function step2FetchTimed(fetchFn, url, ms) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  let timer;
  const timeout = new Promise((_, rej) => { timer = setTimeout(() => { try { if (ctl) ctl.abort(); } catch (_) { } rej(new Error('timeout')); }, ms); });
  try { return await Promise.race([fetchFn(url, { cache: 'no-store', ...(ctl ? { signal: ctl.signal } : {}) }), timeout]); }
  finally { clearTimeout(timer); }
}

// The company's dashboard attachments: { a: meta | null, g: [meta] } (no bytes), or null when the backend cannot be
// reached. meta = { id, fileName, size, slot, ... } as GET /api/attachments returns it.
async function step2DashList(cin, fetchFn) {
  const f = fetchFn || (typeof fetch === 'function' ? fetch : null);
  const key = String(cin || '').trim().toUpperCase();
  if (!f || !STEP2_CIN_RE.test(key)) return null;
  try {
    const r = await step2FetchTimed(f, `${STEP2_ATTACH_API}?cin=${encodeURIComponent(key)}&formType=aoc4`, 5000);
    if (!r || !r.ok) return null;
    const body = await r.json();
    const list = Array.isArray(body && body.attachments) ? body.attachments.filter(x => x && x.id) : [];
    return { a: list.find(x => x.slot === 'a') || null, g: list.filter(x => x.slot === 'g') };
  } catch (_) { return null; }
}

// One dashboard attachment as a File (name, type, size, arrayBuffer) — or null when it cannot be downloaded.
async function step2DashFile(meta, fetchFn) {
  const f = fetchFn || (typeof fetch === 'function' ? fetch : null);
  if (!f || !meta || !meta.id) return null;
  try {
    const r = await step2FetchTimed(f, `${STEP2_ATTACH_API}/${encodeURIComponent(meta.id)}/content`, 60000);
    if (!r || !r.ok) return null;
    const blob = await r.blob();
    const name = meta.fileName || 'attachment.pdf';
    const type = meta.mime || 'application/pdf';
    if (typeof File === 'function') return new File([blob], name, { type });
    return Object.assign(blob, { name });
  } catch (_) { return null; }
}

const step2Mb = n => `${((n || 0) / 1048576).toFixed(1)} MB`;

// Fills the empty slots of files = {a, g} from the dashboard. Files already chosen always win; skipA leaves (a)
// alone ("(a) is already attached on MCA"). Returns { files, used: [text], failed: [text], offline }.
async function step2UseDashboard(cin, files, { skipA = false, fetchFn, list } = {}) {
  const out = { a: files && files.a ? files.a : null, g: files && Array.isArray(files.g) ? files.g.filter(Boolean) : [] };
  const wantA = !out.a && !skipA, wantG = !out.g.length;
  const res = { files: out, used: [], failed: [], offline: false };
  if (!wantA && !wantG) return res;
  const dash = list !== undefined ? list : await step2DashList(cin, fetchFn);
  if (!dash) { res.offline = true; return res; }
  if (wantA && dash.a) {
    const file = await step2DashFile(dash.a, fetchFn);
    if (file) { out.a = file; res.used.push(`Using (a) from dashboard: ${dash.a.fileName} (${step2Mb(dash.a.size || file.size)})`); }
    else res.failed.push(`(a) ${dash.a.fileName} could not be downloaded from the dashboard`);
  }
  if (wantG && dash.g.length) {
    const got = [];
    for (const m of dash.g) {
      const file = await step2DashFile(m, fetchFn);
      if (file) { out.g.push(file); got.push(`${m.fileName} (${step2Mb(m.size || file.size)})`); }
      else res.failed.push(`(g) ${m.fileName} could not be downloaded from the dashboard`);
    }
    if (got.length) res.used.push(`Using (g) from dashboard: ${got.join(', ')}`);
  }
  return res;
}

function step2ToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function step2Validate(v) {
  const errs = [];
  if (!v.fileA && !v.skipA) errs.push('Choose the (a) PDF: financial statements + auditor’s report + Board’s report in one file.');
  if (v.fileA && !/\.pdf$/i.test(v.fileA.name)) errs.push('(a) must be a PDF.');
  if (!v.resNo) errs.push('Enter the board resolution number.');
  else if (String(v.resNo).length > STEP2_RESNO_MAX) errs.push(`Board resolution number: MCA takes at most ${STEP2_RESNO_MAX} characters ("${v.resNo}" has ${String(v.resNo).length}).`);
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(v.resDate)) errs.push('Resolution date must be DD/MM/YYYY.');
  if (v.desig === 'Director' && !/^\d{8}$/.test(v.din)) errs.push('Director’s DIN must be 8 digits.');
  if (v.desig !== 'Director' && !v.din) errs.push('Enter the DIN / PAN / membership number of the signatory.');
  return errs;
}

// Date as MCA wants it (DD/MM/YYYY): phase-runner's toDDMMYYYY when loaded (the side panel), else the same rule here.
function step2DateDDMMYYYY(s) {
  if (!s) return s;
  if (typeof toDDMMYYYY === 'function') return toDDMMYYYY(s);
  const p = String(s).trim().split(/[\/\-.]/);
  if (p.length !== 3) return String(s);
  let [d, m, y] = p[0].length === 4 ? [p[2], p[1], p[0]] : p;
  if (y.length === 2) y = '20' + y;
  return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
}

// The certificate values worth sending to the page ({CERT_…} with at least one non-empty), else null.
function step2CertValues(c) {
  if (!c || typeof c !== 'object') return null;
  const keys = ['CERT_PROFESSION', 'CERT_ASSOC_FELLOW', 'CERT_MEMBERSHIP_NO', 'CERT_COP_NO'];
  const out = {};
  for (const k of keys) if (c[k] != null && String(c[k]).trim()) out[k] = String(c[k]).trim();
  return Object.keys(out).length ? out : null;
}

// opts (all optional; a click Event is ignored): { auto, files:{a, g}, save, values:{resNo,resDate,desig,din},
// certificate:{CERT_PROFESSION, CERT_ASSOC_FELLOW, CERT_MEMBERSHIP_NO, CERT_COP_NO}, allowNoFileA, shouldStop() }.
// Returns { ok, items:[[kind,msg]...], reason?, saved }.
async function step2Run(opts) {
  const o = opts && typeof opts === 'object' && typeof opts.preventDefault !== 'function' ? opts : {};
  const auto = o.auto === true;
  const stopNow = () => { try { return typeof o.shouldStop === 'function' && !!o.shouldStop(); } catch (_) { return false; } };
  const runBtn = step2El('s2RunBtn');
  // Auto mode without values: take the same prefill the panel shows (company master / client data).
  if (auto && !o.values) await step2Prefill();
  const val = (key, id) => {
    const given = o.values && o.values[key];
    if (given != null && String(given).trim() !== '') return String(given);
    const el = step2El(id);
    return el ? String(el.value || '') : '';
  };
  const filesGiven = o.files && typeof o.files === 'object';
  const inputFiles = id => { const el = step2El(id); return el && el.files ? [...el.files] : []; };
  // The manual button with nothing chosen in the panel: the company's dashboard attachments fill the empty slots.
  let dashNotes = [];
  let panelFiles = null;
  if (!filesGiven) {
    panelFiles = { a: inputFiles('s2FileA')[0] || null, g: inputFiles('s2FileG') };
    if (!panelFiles.a || !panelFiles.g.length) {
      const d = await step2UseDashboard(step2Cin(), panelFiles);
      panelFiles = d.files;
      dashNotes = [...d.used.map(t => ['ok', t]), ...d.failed.map(t => ['warn', t])];
    }
  }
  const v = {
    fileA: filesGiven ? (o.files.a || null) : panelFiles.a,
    filesG: filesGiven ? (Array.isArray(o.files.g) ? o.files.g.filter(Boolean) : []) : panelFiles.g,
    skipA: !!(filesGiven && o.files.a == null && o.allowNoFileA),
    resNo: val('resNo', 's2ResNo').trim(),
    resDate: step2DateDDMMYYYY(val('resDate', 's2ResDate').trim()),
    desig: val('desig', 's2Desig'),
    din: val('din', 's2Din').trim().toUpperCase(),
    save: typeof o.save === 'boolean' ? o.save : !!(step2El('s2Save') && step2El('s2Save').checked),
  };
  const errs = step2Validate(v);
  if (errs.length) {
    const items = errs.map(e => ['err', e]);
    step2Result(items);
    return { ok: false, items, reason: 'validation', saved: false };
  }
  const tab = await getActiveMcaTab();
  if (!tab || !/form-aoc4(?!.*offline)/i.test(tab.url || '')) {
    const items = [['err', 'Open the AOC-4 form on mca.gov.in (in this window) first.']];
    step2Result(items);
    return { ok: false, items, reason: 'no-tab', saved: false };
  }
  const out = dashNotes.slice();
  let saved = false, reason;
  const done = () => {
    const failed = out.some(([k]) => k === 'err');
    const ok = !failed && !reason && (!v.save || saved);
    return { ok, items: out.slice(), ...(ok ? {} : { reason: reason || (failed ? 'errors' : 'not-saved') }), saved };
  };
  const stoppedHere = () => {
    if (!stopNow()) return false;
    reason = 'stopped';
    out.push(['warn', 'Stopped by you — nothing more was done on MCA.']);
    step2Result(out);
    return true;
  };
  const exec = (func, args, ms) => withTimeout(chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func, args }), ms, 'timeout')
    .then(r => r && r[0] && r[0].result);
  if (runBtn) runBtn.disabled = true;
  try {
    if (stoppedHere()) return done();
    // 1. Open step 2.
    step2Result([['', 'Opening Attachment & Declaration…']]);
    const open = await exec(pageStep2Open, [45000], 60000);
    if (!open || !open.ok) {
      const why = !open ? 'no answer from the MCA page'
        : open.reason === 'review' ? 'the form is on Review & Submit — click Previous on MCA to go back to Attachment & Declaration, then run this again'
        : open.reason === 'validation' ? 'MCA did not move to the next step: ' + open.errors.join(' · ')
        : open.reason === 'no-next' ? 'the Next button was not found'
        : open.reason === 'timeout' ? 'MCA did not open the next step in time — check the page for a message'
        : `unexpected step "${open.from || '?'}"`;
      out.push(['err', 'Could not open step 2: ' + why]);
      step2Result(out);
      reason = 'open-failed';
      return done();
    }
    out.push(['ok', open.clicked ? 'Clicked Next — Attachment & Declaration is open' : 'Attachment & Declaration is already open']);
    step2Result(out);

    // 2. Attachments.
    const files = [];
    if (v.fileA) files.push(['a', v.fileA]);
    for (const f of v.filesG) files.push(['g', f]);
    for (const [slot, file] of files) {
      if (stoppedHere()) return done();
      const mb = (file.size / 1048576).toFixed(1);
      step2Result([...out, ['', `Uploading (${slot}) ${file.name} (${mb} MB)…`]]);
      const b64 = step2ToBase64(await file.arrayBuffer());
      const s = STEP2_SLOTS[slot];
      const r = await exec(pageStep2Attach, [slot, s.input, s.labelRe, { name: file.name, type: file.type || 'application/pdf', b64 }, 90000], 120000);
      if (r && r.ok && r.skipped) out.push(['warn', `(${slot}) already has a file on MCA (${r.current || 'attached'}) — left as it is. Use Remove on MCA to replace it.`]);
      else if (r && r.ok) out.push(['ok', `(${slot}) ${file.name} (${mb} MB) uploaded`]);
      else {
        const why = !r ? 'no answer from the MCA page' : r.reason === 'mca-error' || r.reason === 'rejected'
          ? 'MCA said: ' + (r.dialogs || []).join(' · ') : r.reason;
        out.push(['err', `(${slot}) ${file.name} not uploaded — ${why}`]);
      }
      step2Result(out);
    }

    // 3. Declaration (pageFill handles AEM's events, the date field and the designation list).
    const jobs = [
      { id: 'DECL_RES_NO', kind: 'text', selector: STEP2_DECL.resNo, index: 0, value: v.resNo },
      { id: 'DECL_RES_DATE', kind: 'date', selector: STEP2_DECL.resDate, index: 0, value: v.resDate },
      { id: 'DECL_DESIGNATION', kind: 'select', selector: STEP2_DECL.desig, index: 0, value: v.desig },
      { id: 'DECL_DIN', kind: 'text', selector: STEP2_DECL.din, index: 0, value: v.din, typeChars: true },
    ];
    const LABEL = { DECL_RES_NO: 'Resolution number', DECL_RES_DATE: 'Resolution date', DECL_DESIGNATION: 'Designation', DECL_DIN: 'DIN' };
    for (const job of jobs) {
      if (stoppedHere()) return done();
      const r = await exec(pageFill, [[job]], 30000).catch(e => ({ error: e.message }));
      const res = r && (r.results || r)[0];
      const ok = res && res.ok;
      out.push([ok ? 'ok' : 'err', `${LABEL[job.id]}: ${job.value}${ok ? '' : ' — not filled' + (res && res.err ? ' (' + res.err + ')' : '')}`]);
      step2Result(out);
    }
    // Certificate by Practicing Professional (the CA's own details). Not finding it never stops the run.
    const cert = step2CertValues(o.certificate);
    if (cert) {
      if (stoppedHere()) return done();
      const CERT_LABEL = { CERT_PROFESSION: 'Certificate: profession', CERT_ASSOC_FELLOW: 'Certificate: Associate / Fellow',
        CERT_MEMBERSHIP_NO: 'Certificate: membership number', CERT_COP_NO: 'Certificate: certificate of practice number' };
      let c = null;
      try { c = await exec(pageStep2FillCertificate, [cert], 30000); } catch (e) { c = { error: e.message }; }
      if (!c || c.error) out.push(['warn', `Certificate by Practicing Professional not filled (${c && c.error === 'timeout' ? 'the MCA page did not answer in time' : (c && c.error) || 'no answer'}) — fill it on MCA`]);
      else if (!c.found) out.push(['warn', 'Certificate by Practicing Professional not found on this page — fill it on MCA']);
      else {
        for (const r of c.results || []) {
          const label = CERT_LABEL[r.key] || r.key;
          if (r.ok) out.push(['ok', `${label}: ${cert[r.key]}${r.skipped ? ' (already on MCA)' : ''}`]);
          else out.push(['warn', `${label}: not filled (${r.err || 'not found'}) — fill it on MCA`]);
        }
      }
      step2Result(out);
    }
    // Keep the declaration for next time (company master).
    const cin = step2Cin();
    if (cin) {
      fetch(STEP2_ANSWERS_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cin, formType: 'aoc4', answers: [
        { key: 'BOARD_RESOLUTION_NO', label: 'Declaration — board resolution number', value: v.resNo },
        { key: 'BOARD_RESOLUTION_DATE', label: 'Declaration — board resolution date', value: v.resDate },
        { key: 'DECL_DESIGNATION', label: 'Declaration — designation of the signatory', value: v.desig },
        { key: 'DECL_DIN', label: 'Declaration — DIN/PAN of the signatory', value: v.din },
      ] }) }).catch(() => {});
    }

    // 4. Save this step.
    if (v.save) {
      if (stoppedHere()) return done();
      const s = await exec(pageStep2ClickSave, [], 15000);
      if (!s || !s.clicked) { out.push(['warn', 'Save not clicked (' + (s ? s.reason : 'no answer') + ') — click Save on MCA']); reason = 'save-not-clicked'; }
      else {
        // MCA's first Save after an upload is often slow and its "saved" popup can be missed; a second Save then
        // goes through (what a rerun did by hand). So: wait for MCA's answer; if none came and MCA shows no error
        // (field errors or its error popup), click Save again — at most 3 Saves in all.
        const errorPopup = typeof pageApErrorDialog === 'function' ? pageApErrorDialog : null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          const c = await exec(pageConfirmSave, [attempt === 1 ? 12000 : 20000, null, []], 50000).catch(() => null);
          if (c && c.confirmed) {
            out.push(['ok', attempt === 1 ? 'Saved — MCA confirmed' : `Saved — MCA confirmed (Save clicked ${attempt} times)`]); saved = true;
            if (c.popupOpen) out.push(['warn', `MCA's "${(c.popup && c.popup.msg) || 'saved'}" popup has no button the extension knows${c.popup && c.popup.buttons && c.popup.buttons.length ? ` (it shows: ${c.popup.buttons.join(', ')})` : ''} — close it on MCA if it is still open`]);
            break;
          }
          if (c && c.errorsVisible) { out.push(['err', 'MCA did not save: ' + c.errorTexts.join(' · ')]); break; }
          let e = null;
          if (errorPopup) { try { e = await exec(errorPopup, [], 10000); } catch (_) { e = null; } }
          if (e && e.errors && e.errors.length) { out.push(['err', 'MCA did not save — MCA said: ' + e.errors.join(' · ')]); break; }
          if (attempt === 3) {
            out.push(['warn', 'Save was clicked 3 times but MCA showed no "saved" message and no error — check page 2 on MCA']);
            reason = 'not-confirmed';
            break;
          }
          if (stoppedHere()) return done();
          step2Result([...out, ['', `MCA has not confirmed the Save yet — clicking Save again (${attempt + 1} of 3)…`]]);
          const again = await exec(pageStep2ClickSave, [], 15000).catch(() => null);
          if (!again || !again.clicked) {
            out.push(['warn', 'Save not confirmed, and it could not be clicked again (' + (again ? again.reason : 'no answer') + ') — click Save on MCA']);
            reason = 'not-confirmed';
            break;
          }
        }
      }
    }
    const failed = out.some(([k]) => k === 'err');
    // Auto mode (autopilot) clicks Proceed itself after this, so the "click Next yourself" hint is left out.
    if (failed) out.push(['warn', 'Fix the items marked ✗ on the MCA page.']);
    else if (!auto) out.push(['ok', 'Step 2 done. Check the attachments with Preview, then click Next → Review & Submit, sign with the DSC and submit yourself.']);
    else out.push(['ok', 'Step 2 done.']);
    step2Result(out);
    if (typeof showMessage === 'function') showMessage(failed ? 'warning' : 'success', failed ? 'Step 2: some items need attention' : 'Step 2: attachments uploaded and declaration filled', 15000);
    return done();
  } catch (e) {
    out.push(['err', 'Stopped: ' + (e.message === 'timeout' ? 'the MCA page did not answer in time' : e.message)]);
    step2Result(out);
    reason = 'exception: ' + (e.message === 'timeout' ? 'the MCA page did not answer in time' : e.message);
    return done();
  } finally {
    if (runBtn) runBtn.disabled = false;
  }
}

function initStep2() {
  const panel = step2El('s2Panel');
  if (!panel) return;
  panel.addEventListener('toggle', () => { if (panel.open) step2Prefill(); });
  step2El('s2Desig').addEventListener('change', e => { e.target.dataset.touched = '1'; });
  step2El('s2PrefillBtn').addEventListener('click', () => step2Prefill(true));
  step2El('s2RunBtn').addEventListener('click', step2Run);
  const showSize = (input, out) => input.addEventListener('change', () => {
    const fs = [...input.files];
    step2El(out).textContent = fs.map(f => `${f.name} — ${(f.size / 1048576).toFixed(1)} MB`).join(', ');
  });
  showSize(step2El('s2FileA'), 's2FileAInfo');
  showSize(step2El('s2FileG'), 's2FileGInfo');
}

if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', initStep2);
if (typeof module !== 'undefined') module.exports = { step2DashList, step2DashFile, step2UseDashboard, STEP2_ATTACH_API, pageStep2Open, pageStep2NextToReview, pageStep2Attach, pageStep2ClickSave, pageStep2FillCertificate, step2CertValues, step2Validate, step2ToBase64, step2Run, STEP2_DECL, STEP2_SLOTS };
