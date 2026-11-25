// Page side of the validation engine. Injected into the MCA tab with
// chrome.scripting.executeScript({ world: 'MAIN', func }), so every function here must be
// self-contained (no outside references). It only reports facts; the engine (engine.js) decides.

// Collects every visible control of one AOC-4 section (after the previous Save button, before this
// section's Save, optionally cut before `endBeforeSelectors` when two phases share a Save) and the
// page value of every mapped data key anywhere on the page (for conditions and cross-field rules).
//   mappings: [{ key, selector, index, dateInRow, name }]  — the extension's field map
// Returns { fields: [{ fid, key, label, type, visible, readOnly, disabled, mcaRequired, value, options, mcaError }],
//           pageValues: { KEY: value }, scope }
function pageCollectFields(saveIndex, saveAnchor, mappings, endBeforeSelectors, bounds) {
  const visible = el => !!el && el.getClientRects().length > 0;
  const follows = (ref, cand) => !!(ref.compareDocumentPosition(cand) & Node.DOCUMENT_POSITION_FOLLOWING);
  const compact = v => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const clean = s => String(s || '').replace(/Please Enter date in DD\/MM\/YYYY format only/gi, '')
    .replace(/\*/g, '').replace(/\s+/g, ' ').trim();

  // ── Section scope (same Save-button logic as pageSave) ──
  const buttons = [...document.querySelectorAll('button, input[type="button"], input[type="submit"]')]
    .filter(b => /^\s*save\s*$/i.test(b.textContent || b.value || '') && visible(b) && !b.disabled);
  let saveBtn = null;
  if (saveAnchor) {
    const key = compact(saveAnchor);
    const anchor = [...document.querySelectorAll('h1,h2,h3,h4,h5,legend,label,p,span,strong,div')]
      .filter(el => visible(el) && compact(el.innerText || el.textContent).includes(key)
        && compact(el.innerText || el.textContent).length < key.length + 120)
      .sort((a, b) => (a.innerText || a.textContent || '').length - (b.innerText || b.textContent || '').length)[0];
    if (anchor) saveBtn = buttons.find(b => follows(anchor, b)) || null;
  }
  if (!saveBtn) saveBtn = (saveIndex !== undefined && buttons[saveIndex]) || buttons[buttons.length - 1] || null;
  const prevBtn = saveBtn ? buttons[buttons.indexOf(saveBtn) - 1] || null : null;
  let endEl = null;
  for (const sel of endBeforeSelectors || []) {
    let found = [];
    try { found = [...document.querySelectorAll(sel)]; } catch (_) { /* bad selector */ }
    for (const e of found) {
      if (saveBtn && !follows(e, saveBtn)) continue;
      if (prevBtn && !follows(prevBtn, e)) continue;
      if (!endEl || follows(e, endEl)) endEl = e;
    }
  }
  // Section headings bound the scope too: a hidden Save button must never let one section's check
  // run into the next section (bounds = { start: 'heading text', end: "next section's heading" }).
  const heading = text => {
    if (!text) return null;
    const key = compact(text);
    return [...document.querySelectorAll('h1,h2,h3,h4,h5,legend,label,p,span,strong,div')]
      .filter(el => visible(el) && compact(el.innerText || el.textContent).includes(key)
        && compact(el.innerText || el.textContent).length < key.length + 60)
      .sort((a, b) => (a.innerText || a.textContent || '').length - (b.innerText || b.textContent || '').length)[0] || null;
  };
  const startEl = heading(bounds && bounds.start);
  const endHeading = heading(bounds && bounds.end);
  const inScope = el => (!saveBtn || follows(el, saveBtn)) && (!prevBtn || follows(prevBtn, el)) && (!endEl || follows(el, endEl))
    && (!startEl || follows(startEl, el)) && (!endHeading || follows(el, endHeading));

  // ── AEM model (only for MCA's own "mandatory" marker and dropdown items) ──
  const nodes = new Map();
  try { window.guideBridge && window.guideBridge.visit(c => { if (c && c.id) nodes.set(c.id, c); }); } catch (_) { /* model not ready */ }
  const prop = (node, name) => { try { return node ? node[name] : undefined; } catch (_) { return undefined; } };
  const nodeOf = el => nodes.get((el.name || '').replace(/_jqName$/, '')) || nodes.get((el.id || '').replace(/(-\d+)?_widget$/, ''));

  const boxOf = el => el.closest('.guideFieldNode') || el.parentElement;
  const labelFor = el => { const l = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null; return l ? l.innerText : ''; };
  const questionOf = el => { const b = boxOf(el); const q = b && b.querySelector('legend, .guideFieldLabel, label'); return q ? q.innerText : ''; };
  const radioText = r => clean(r.getAttribute('aria-label') || labelFor(r) || r.value);
  const typeOf = el => {
    const t = String(el.type || '').toLowerCase();
    if (t === 'radio' || t === 'checkbox' || t === 'file' || t === 'email') return t;
    if (el.tagName === 'SELECT') return 'select';
    const cls = String((boxOf(el) || {}).className || '');
    if (/guideDatePicker/i.test(cls) || el.placeholder === 'DD/MM/YYYY') return 'date';
    if (/guideNumericBox/i.test(cls) || t === 'number') return 'number';
    if (/guideDropDownList/i.test(cls)) return 'select';
    return 'text';
  };
  const valueOf = (el, group) => {
    const t = String(el.type || '').toLowerCase();
    if (t === 'radio') { const hit = (group || [el]).find(r => r.checked); return hit ? radioText(hit) : ''; }
    if (t === 'checkbox') return el.checked ? 'true' : '';
    if (t === 'file') { const b = boxOf(el); const shown = b && b.querySelector('.guide-fu-fileItemList li, .fileName, [class*="fileItem"]'); return (el.files && el.files.length) || (shown && shown.innerText.trim()) ? 'attached' : ''; }
    if (el.tagName === 'SELECT') { const o = el.selectedOptions && el.selectedOptions[0]; return o && el.value && !/^\s*(--|select)/i.test(o.text) ? clean(o.text) : ''; }
    return String(el.value || '').trim();
  };

  // ── Data key of each element, resolved the way the filler resolves it ──
  const keyOfEl = new Map();
  for (const m of mappings || []) {
    if (m.name) {   // radio groups are addressed by name
      document.querySelectorAll(`input[type="radio"]`).forEach(r => { if (r.name === m.name && !keyOfEl.has(r)) keyOfEl.set(r, m.key); });
      continue;
    }
    let hits = [];
    try { hits = [...document.querySelectorAll(m.selector)].filter(visible); } catch (_) { continue; }
    let target = m.index !== undefined && m.index !== null ? hits[m.index] : null;
    if (m.dateInRow) {
      const row = target && target.closest('tr');
      target = row ? [...row.querySelectorAll('input')].find(i => i !== hits[m.index] && typeOf(i) === 'date') : null;
      if (target && !keyOfEl.has(target)) keyOfEl.set(target, m.key);
      continue;
    }
    if (target) { if (!keyOfEl.has(target)) keyOfEl.set(target, m.key); continue; }
    if (hits.length === 1 && !keyOfEl.has(hits[0])) keyOfEl.set(hits[0], m.key);
  }
  const pageValues = {};
  for (const [el, key] of keyOfEl) {
    if (pageValues[key]) continue;
    const group = el.type === 'radio' ? [...document.querySelectorAll('input[type="radio"]')].filter(r => r.name === el.name) : null;
    const v = valueOf(el, group);
    if (v) pageValues[key] = v;
  }

  // ── Every visible control in this section ──
  const SKIP = ['hidden', 'button', 'submit', 'reset', 'image'];
  const groups = new Map();
  let seq = 0;
  for (const el of document.querySelectorAll('input, select, textarea')) {
    const t = String(el.type || '').toLowerCase();
    if (SKIP.includes(t) || !inScope(el)) continue;
    // Only MCA's own form controls (site header, search box and the CIN finder are not part of it).
    if (!el.closest('.guideFieldNode') || !/guideContainer/.test(`${el.name || ''}${el.id || ''}`)) continue;
    if (!visible(el) && t !== 'file') continue;   // MCA hides the real file input behind a button
    if (t === 'file' && !visible(boxOf(el))) continue;
    if (!el.dataset.g8fid) el.dataset.g8fid = t === 'radio' && el.name ? `r:${el.name}` : `f${Date.now().toString(36)}${seq++}`;
    const k = el.dataset.g8fid;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(el);
  }

  const fields = [];
  for (const [fid, els] of groups) {
    const first = els[0];
    const node = nodeOf(first);
    const type = typeOf(first);
    const question = questionOf(first);
    const label = clean((type === 'radio' || type === 'checkbox' ? question : '') || first.getAttribute('aria-label') || labelFor(first) || question || first.name);
    const mcaRequired = prop(node, 'mandatory') === true
      || els.some(e => e.required || e.getAttribute('aria-required') === 'true' || /\*/.test(e.getAttribute('aria-label') || ''))
      || /\*/.test(question);
    let options = [];
    if (first.tagName === 'SELECT') options = [...first.options].filter(o => o.value && !/^\s*(--|select)/i.test(o.text)).map(o => ({ value: o.value, label: clean(o.text) }));
    else if (type === 'radio') options = els.map(r => ({ value: r.value, label: radioText(r) }));
    const box = boxOf(first);
    let errEl = box && [...box.querySelectorAll('.guideFieldError')].find(e => visible(e) && clean(e.innerText));
    // MCA's message can be stale (it stays after the value was corrected) until MCA re-checks that
    // one field. Ask it to — the same check MCA runs when the user leaves the box — then re-read.
    if (errEl && node && typeof node.validate === 'function') {
      try { node.validate([]); } catch (_) { /* MCA's own rule threw: keep its message */ }
      errEl = [...box.querySelectorAll('.guideFieldError')].find(e => visible(e) && clean(e.innerText));
    }
    const keyed = els.find(e => keyOfEl.has(e));
    fields.push({
      fid, key: keyed ? keyOfEl.get(keyed) : null, label, type,
      visible: true,
      readOnly: els.every(e => e.readOnly) || prop(node, 'readOnly') === true,
      disabled: els.every(e => e.disabled) || prop(node, 'enabled') === false,
      mcaRequired,
      value: valueOf(first, els),
      options,
      mcaError: errEl ? clean(errEl.innerText) : '',
    });
  }
  return { fields, pageValues, scope: { saveFound: !!saveBtn, previousSave: !!prevBtn, cutBefore: !!endEl,
    startHeading: !!startEl, endHeading: !!endHeading, saveAfterNextSection: !!(saveBtn && endHeading && follows(endHeading, saveBtn)) } };
}

// Outlines the fields the engine rejected (dashed amber — never confused with MCA's red) and
// clears every earlier mark, so a field fixed by hand or by MCA does not stay outlined.
function pageMarkFields(fids) {
  document.querySelectorAll('[data-g8req]').forEach(e => { e.style.outline = ''; e.style.outlineOffset = ''; delete e.dataset.g8req; });
  let first = null;
  for (const fid of fids || []) {
    const els = String(fid).startsWith('r:')
      ? [...document.querySelectorAll('input[type="radio"]')].filter(r => r.name === String(fid).slice(2))
      : [...document.querySelectorAll(`[data-g8fid="${CSS.escape(fid)}"]`)];
    els.forEach(e => { e.style.outline = '2px dashed #e37400'; e.style.outlineOffset = '2px'; e.dataset.g8req = '1'; });
    if (!first && els[0]) first = els[0];
  }
  if (first) first.scrollIntoView({ block: 'center' });
  return !!first;
}

// Fills [{ fid, type, value }] on the page: the AEM model value where there is one (so MCA's
// own rules run), then the visible control with input/change/blur events.
function pageFillRequired(values) {
  const clean = s => String(s || '').replace(/\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const gb = window.guideBridge;
  const nodes = new Map();
  if (gb && typeof gb.visit === 'function') {
    try { gb.visit(c => { if (c && c.id) nodes.set(c.id, c); }); } catch (_) { /* model not ready */ }
  }
  const fire = el => ['input', 'change', 'blur'].forEach(t => el.dispatchEvent(new Event(t, { bubbles: true })));
  const setNative = (el, v) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    fire(el);
  };
  const setModel = (node, v) => { if (!node) return; try { node.value = v; } catch (_) { /* read-only model */ } };
  const radioLabel = e => {
    const byFor = e.id ? document.querySelector(`label[for="${CSS.escape(e.id)}"]`) : null;
    return clean(e.getAttribute('aria-label') || (byFor && byFor.innerText) || e.value);
  };

  const results = [];
  for (const item of values) {
    const fid = String(item.fid);
    let els = fid.startsWith('r:')
      ? [...document.querySelectorAll(`input[type="radio"][name="${CSS.escape(fid.slice(2))}"]`)]
      : [...document.querySelectorAll(`[data-g8fid="${CSS.escape(fid)}"]`)];
    if (!els.length) { results.push({ fid: item.fid, ok: false, err: 'field not found on the page' }); continue; }
    const el = els[0];
    const node = nodes.get((el.name || '').replace(/_jqName$/, '') || (el.id || '').replace(/(-\d+)?_widget$/, ''));
    const v = String(item.value ?? '').trim();
    try {
      if (item.type === 'radio') {
        const target = els.find(e => e.value === v) || els.find(e => radioLabel(e) === clean(v))
          || els.find(e => clean(v) && radioLabel(e).includes(clean(v)));
        if (!target) throw new Error(`option "${v}" not found`);
        target.click();
        if (!target.checked) { target.checked = true; fire(target); }
        setModel(node, target.value);
      } else if (item.type === 'checkbox') {
        const want = /^(true|yes|1|on|checked|y)$/i.test(v);
        if (el.checked !== want) el.click();
        if (el.checked !== want) { el.checked = want; fire(el); }
      } else if (el.tagName === 'SELECT') {
        // Exact value / text first; then an option whose text contains the answer ("adopted" →
        // "Adopted financial statements"), never its negation ("Un-adopted …", "not adopted"); shortest wins.
        const cv = clean(v), real = [...el.options].filter(o => o.value !== '');
        const esc = cv.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const negated = t => new RegExp('\\b(un-?|non-?|not\\s+)' + esc, 'i').test(t);
        const opt = real.find(o => o.value === v) || real.find(o => clean(o.text) === cv)
          || (cv ? real.filter(o => clean(o.text).includes(cv) && !negated(clean(o.text))).sort((x, y) => x.text.length - y.text.length)[0] : null);
        if (!opt) throw new Error(`option "${v}" not found (MCA offers: ${real.map(o => o.text.trim()).slice(0, 6).join(' | ') || 'no options yet'})`);
        el.selectedIndex = opt.index;
        fire(el);
        setModel(node, opt.value);
      } else if (item.type === 'date') {
        const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (!m) throw new Error('date must be DD/MM/YYYY');
        setModel(node, `${m[3]}-${m[2]}-${m[1]}`);   // AEM date model is ISO; the widget shows DD/MM/YYYY
        if (el.value !== v) setNative(el, v);
      } else if (item.type === 'select') {
        setModel(node, v);                          // AEM dropdown rendered as an input
        if (!String(el.value || '').trim()) setNative(el, item.label || v);
      } else {
        setModel(node, v);
        if (el.value !== v) setNative(el, v);
      }
      // Let MCA re-check this one field so its message reflects the new value.
      if (node && typeof node.validate === 'function') { try { node.validate([]); } catch (_) { /* MCA rule threw */ } }
      els.forEach(e => { e.style.outline = ''; e.style.outlineOffset = ''; delete e.dataset.g8req; });
      results.push({ fid: item.fid, ok: true });
    } catch (e) {
      results.push({ fid: item.fid, ok: false, err: e.message });
    }
  }
  return results;
}
