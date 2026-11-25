// Correction popup for the Next guard: lists every field the validation engine rejected with its
// exact reason, asks for a value, checks it with the same engine, and hands it back.
//
//   const r = await RequiredPanel.ask({ fields, remembered, check, title, note });
//   fields:     engine results with status MISSING_REQUIRED / INVALID_FORMAT / CROSS_FIELD_ERROR / MCA_ERROR
//   remembered: approved values by answerKey (pre-filled into the inputs)
//   check:      (field, value) => { ok, reason, value }   — normally ValidationEngine.checkValue
//   r = { action: 'fill', values: [{ fid, type, label, value }] } | { action: 'recheck' } | { action: 'stop' }
(function () {
  const $ = id => document.getElementById(id);
  const el = (tag, props = {}, kids = []) => {
    const n = Object.assign(document.createElement(tag), props);
    for (const k of [].concat(kids)) if (k) n.append(k);
    return n;
  };
  const V = () => window.Validators;
  const STATUS_TEXT = {
    MISSING_REQUIRED: 'Required — empty',
    INVALID_FORMAT: 'Wrong format',
    CROSS_FIELD_ERROR: 'Does not match other fields',
    MCA_ERROR: 'MCA shows an error',
  };

  // Fallback when no engine check is passed in: emptiness, type and date only.
  function basicCheck(field, value) {
    const v = field.type === 'date' ? (V().toMcaDate(value) || String(value || '').trim()) : String(value ?? '').trim();
    if (V().isEmpty(field.type, v)) return { ok: false, reason: `Please fill the required field: ${field.label}` };
    const err = V().checkType(field.type, v, field.options) || V().checkFormat(field.format, v);
    return err ? { ok: false, reason: err } : { ok: true, value: v };
  }

  function inputFor(field, idx, start) {
    const id = `req_${idx}`;
    const opts = field.options || [];
    if (field.type === 'radio' || (field.type === 'select' && opts.length && opts.length <= 4)) {
      const box = el('div', { className: 'req-choices', role: 'radiogroup' });
      opts.forEach((o, i) => {
        const r = el('input', { type: 'radio', name: id, value: o.label || o.value, id: `${id}_${i}` });
        if (start && (start === o.value || String(start).toLowerCase() === String(o.label).toLowerCase())) r.checked = true;
        box.append(el('label', { htmlFor: r.id }, [r, o.label || o.value]));
      });
      return { node: box, read: () => (box.querySelector('input:checked') || {}).value || '' };
    }
    if (field.type === 'checkbox') {
      const c = el('input', { type: 'checkbox', id });
      c.checked = V().YES.test(String(start || ''));
      return { node: el('div', { className: 'req-choices' }, [el('label', { htmlFor: id }, [c, 'Tick this box on MCA'])]), read: () => (c.checked ? 'true' : '') };
    }
    if (field.type === 'select' && opts.length) {
      const s = el('select', { id }, [el('option', { value: '', textContent: '— Select —' })]);
      opts.forEach(o => s.append(el('option', { value: o.label || o.value, textContent: o.label || o.value })));
      if (start) s.value = (opts.find(o => o.value === start || String(o.label).toLowerCase() === String(start).toLowerCase()) || {}).label || '';
      return { node: s, read: () => s.value };
    }
    if (field.type === 'file') {
      return { node: el('p', { className: 'fix-hint', textContent: 'Attach this file on the MCA page, then choose "check again".' }), read: () => '' };
    }
    const i = el('input', {
      id, type: field.type === 'number' ? 'text' : 'text', inputMode: field.type === 'number' ? 'decimal' : 'text',
      value: start || '', autocomplete: 'off', placeholder: field.type === 'date' ? 'DD/MM/YYYY' : '',
    });
    return { node: i, read: () => i.value.trim() };
  }

  let pending = null;
  function close(result) {
    $('reqPanel').classList.add('hidden');
    const done = pending;
    pending = null;
    if (done) done(result);
  }

  function ask({ fields, remembered = {}, check, title, note }) {
    if (pending) close({ action: 'stop' });
    const verify = typeof check === 'function' ? check : basicCheck;
    $('reqTitle').textContent = title || 'Please correct the following fields before continuing';
    $('reqExplain').textContent = note
      || `${fields.length} field${fields.length > 1 ? 's' : ''} must be corrected before this section can be saved. The extension will not click Save/Next until they pass.`;
    const errBox = $('reqError');
    errBox.textContent = '';
    errBox.classList.add('hidden');

    const list = $('reqFields');
    list.textContent = '';
    const rows = fields.map((f, idx) => {
      const start = f.status === 'MISSING_REQUIRED'
        ? (remembered[f.answerKey] ?? (f.key ? remembered[f.key] : '') ?? '')
        : (f.value || remembered[f.answerKey] || '');
      const ctrl = inputFor(f, idx, f.type === 'date' ? (V().toMcaDate(start) || start) : start);
      const hint = el('p', { className: 'fix-err-hint' });
      const why = el('p', { className: 'req-current', textContent: `${STATUS_TEXT[f.status] || f.status}: ${f.reason}${f.status !== 'MISSING_REQUIRED' && f.value ? ` (now "${f.value}")` : ''}` });
      const row = el('div', { className: 'fix-field' }, [el('label', { htmlFor: `req_${idx}`, textContent: f.label }), why, ctrl.node, hint]);
      list.append(row);
      return { f, ctrl, hint, row };
    });

    $('reqPanel').classList.remove('hidden');
    $('reqPanel').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    (list.querySelector('input, select') || {}).focus?.();

    return new Promise(resolve => {
      pending = resolve;
      $('reqApply').onclick = () => {
        const values = [];
        const bad = [];
        for (const r of rows) {
          if (r.f.type === 'file') { bad.push({ r, err: `${r.f.label}: attach the file on MCA, then choose "check again"` }); continue; }
          const res = verify(r.f, r.ctrl.read());
          r.hint.textContent = res.ok ? '' : res.reason;
          r.row.classList.toggle('req-bad', !res.ok);
          if (!res.ok) bad.push({ r, err: `${r.f.label}: ${res.reason}` });
          else values.push({ fid: r.f.fid, type: r.f.type, label: r.f.label, value: res.value });
        }
        if (bad.length) {
          errBox.textContent = `Please correct the following fields before continuing — ${bad.map(b => b.err).join(' · ')}`;
          errBox.classList.remove('hidden');
          bad[0].r.row.querySelector('input, select')?.focus();
          return;   // nothing reaches MCA until every value passes
        }
        close({ action: 'fill', values });
      };
      $('reqRecheck').onclick = () => close({ action: 'recheck' });
      $('reqStop').onclick = () => close({ action: 'stop' });
    });
  }

  window.RequiredPanel = { ask, close: () => close({ action: 'stop' }), basicCheck };
})();
