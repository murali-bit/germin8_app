// Validation engine: decides the status of every field the page collector found, using the rules
// config (js/validation/rules/<form>.js) and the shared validators. Pure logic, no DOM — the MCA
// page only supplies facts (pageCollectFields), so this runs and is tested outside MCA.
//
// Status of a field:
//   FILLED            has a value that passes every check
//   MISSING_REQUIRED  visible, applicable, required, and empty
//   OPTIONAL_EMPTY    empty but not required (never an error)
//   INVALID_FORMAT    the value does not fit the field type or its format rule
//   CROSS_FIELD_ERROR a business rule across fields fails (severity "error")
//   MCA_ERROR         MCA shows its own error message under the field (always wins)
//   NOT_APPLICABLE    the field's condition (rule.when) is not met — never an error
//   NOT_VISIBLE       not on screen — never an error
//
// Priority when deciding: MCA's field error › MCA's mandatory marker / rule.required ›
// business rules › approved (dashboard) data › the page's own value.
(function (root) {
  'use strict';
  const V = root.Validators || (typeof require === 'function' ? require('./validators.js') : null);

  const BLOCKING = new Set(['MISSING_REQUIRED', 'INVALID_FORMAT', 'CROSS_FIELD_ERROR', 'MCA_ERROR']);
  const str = v => (v === undefined || v === null ? '' : String(v)).trim();
  const norm = s => str(s).toLowerCase().replace(/\b(private|pvt|limited|ltd|the)\b/g, '').replace(/[^a-z0-9]/g, '');

  function ruleFor(field, rules) {
    let key = field.key || null;
    let rule = key && rules.fields ? rules.fields[key] : null;
    let labelRule = null;
    for (const r of rules.byLabel || []) {
      if (r.match.test(field.label || '')) { labelRule = r; break; }
    }
    if (!key && labelRule && labelRule.key) { key = labelRule.key; rule = (rules.fields || {})[key] || null; }
    return { key, rule: Object.assign({}, labelRule || {}, rule || {}) };
  }

  // Value used by conditions and cross rules: what is on the MCA page, else the approved data.
  function makeValueOf(ctx) {
    return key => {
      const p = ctx.pageValues ? ctx.pageValues[key] : undefined;
      if (str(p)) return str(p);
      const d = ctx.data ? ctx.data[key] : undefined;
      return str(d);
    };
  }

  function applies(rule, valueOf) {
    const w = rule.when;
    if (!w) return true;
    const v = valueOf(w.key).toLowerCase();
    if (w.is) return w.is.some(x => str(x).toLowerCase() === v);
    if (w.not) return !w.not.some(x => str(x).toLowerCase() === v);
    return true;
  }

  const date = v => V.parseDate(V.toMcaDate(v) || v);
  const fmt = d => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

  // Business rules. Each returns '' (pass or not enough data to judge) or the failure text.
  // A rule never fails because a value is missing: missing values are judged by "required".
  const CROSS = {
    dayMonth(c, val) { const d = date(val(c.key)); return d && (d.getDate() !== c.day || d.getMonth() + 1 !== c.month) ? `${c.message} (got ${fmt(d)})` : ''; },
    before(c, val) { const a = date(val(c.a)), b = date(val(c.b)); return a && b && !(a < b) ? c.message : ''; },
    after(c, val) { const a = date(val(c.key)), b = date(val(c.ref)); return a && b && !(a > b) ? `${c.message} (${fmt(a)} is not after ${fmt(b)})` : ''; },
    onOrAfter(c, val) { const a = date(val(c.key)), b = date(val(c.ref)); return a && b && a < b ? `${c.message} (${fmt(a)} is before ${fmt(b)})` : ''; },
    notFuture(c, val, ctx) { const a = date(val(c.key)); const t = ctx.today || new Date(); return a && a > t ? c.message : ''; },
    sameAsData(c, val, ctx) {
      const page = str(ctx.pageValues && ctx.pageValues[c.key]); const data = str(ctx.data && ctx.data[c.key]);
      if (!page || !data) return '';
      const a = date(page), b = date(data);
      const same = a && b ? a.getTime() === b.getTime() : norm(page) === norm(data);
      return same ? '' : `${c.message} (MCA: ${page}, documents: ${data})`;
    },
    sameText(c, val, ctx) {
      const page = str(ctx.pageValues && ctx.pageValues[c.key]); const data = str(ctx.data && ctx.data[c.key]);
      return page && data && norm(page) !== norm(data) ? `${c.message} (MCA: ${page}, dashboard: ${data})` : '';
    },
    notMore(c, val) { const a = V.toNumber(val(c.key)), b = V.toNumber(val(c.ref)); return Number.isFinite(a) && Number.isFinite(b) && a > b ? `${c.message} (${a} > ${b})` : ''; },
    startsWith(c, val) { const a = str(val(c.key)), b = str(val(c.ref)); return a && b && !a.startsWith(b) ? `${c.message} (${a} vs ${b})` : ''; },
    periodCovers(c, val) {
      const f = date(val(c.from)), t = date(val(c.to)), s = date(val(c.start)), e = date(val(c.end));
      return f && t && s && e && (s < f || e > t) ? `${c.message} (appointed ${fmt(f)}–${fmt(t)})` : '';
    },
  };

  function crossResults(key, valueOf, ctx, rules) {
    const errors = [], warnings = [];
    for (const c of rules.cross || []) {
      if (c.key !== key) continue;
      const fn = CROSS[c.fn];
      if (!fn) continue;
      let msg = '';
      try { msg = fn(c, valueOf, ctx); } catch (_) { msg = ''; }
      if (msg) (c.severity === 'warning' ? warnings : errors).push(msg);
    }
    return { errors, warnings };
  }

  // Checks one value for a field (type, format, cross rules) as if it were on the page.
  // Used before auto-filling approved data and before accepting what the user typed.
  function checkValue(field, value, ctx) {
    const rules = ctx.rules || {};
    const { key, rule } = ruleFor(field, rules);
    const type = rule.type || field.type || 'text';
    const v = type === 'date' ? (V.toMcaDate(value) || str(value)) : str(value);
    if (V.isEmpty(type, v)) return { ok: false, reason: `Please fill the required field: ${rule.label || field.label}` };
    const typeErr = V.checkType(type, v, field.options) || V.checkFormat(rule.format, v);
    if (typeErr) return { ok: false, reason: typeErr };
    if (key) {
      const pv = Object.assign({}, ctx.pageValues, { [key]: v });
      const { errors } = crossResults(key, makeValueOf(Object.assign({}, ctx, { pageValues: pv })), Object.assign({}, ctx, { pageValues: pv }), rules);
      if (errors.length) return { ok: false, reason: errors[0] };
    }
    return { ok: true, value: v };
  }

  function validateFields(fields, ctx) {
    const rules = ctx.rules || {};
    const valueOf = makeValueOf(ctx);
    return (fields || []).map(f => {
      const { key, rule } = ruleFor(f, rules);
      const label = rule.label || f.label || key || 'field';
      const type = rule.type || f.type || 'text';
      const out = Object.assign({}, f, { key, label, type, format: rule.format || null, warnings: [] });
      const done = (status, reason = '') => Object.assign(out, { status, reason, blocking: BLOCKING.has(status) });

      // 1. Visible on the current page?
      if (f.visible === false) return done('NOT_VISIBLE');
      // 2. Applicable to this company (conditional fields)?
      if (!applies(rule, valueOf)) return done('NOT_APPLICABLE');
      // 3–4. Required: the rules config decides when it says true/false, otherwise MCA's marker does.
      const required = rule.required === true ? true : rule.required === false ? false : !!f.mcaRequired;
      out.required = required;
      // MCA's own message under the field outranks every rule.
      if (str(f.mcaError)) return done('MCA_ERROR', f.mcaError);
      const empty = V.isEmpty(type, f.value);
      if (empty) return done(required ? 'MISSING_REQUIRED' : 'OPTIONAL_EMPTY', required ? `Please fill the required field: ${label}` : '');
      // MCA-owned (read-only / disabled) values are MCA's to decide; only its own error counts.
      if (f.readOnly || f.disabled) return done('FILLED');
      // 5–6. Field type, then the field's format rule.
      const typeErr = V.checkType(type, f.value, f.options);
      if (typeErr) return done('INVALID_FORMAT', typeErr);
      const fmtErr = V.checkFormat(rule.format, f.value);
      if (fmtErr) return done('INVALID_FORMAT', rule.message ? `${fmtErr}. ${rule.message}` : fmtErr);
      // 7. Cross-field business rules — the field's own value counts for its own key.
      if (key) {
        const own = Object.assign({}, ctx, { pageValues: Object.assign({}, ctx.pageValues, { [key]: f.value }) });
        const { errors, warnings } = crossResults(key, makeValueOf(own), own, rules);
        out.warnings = warnings;
        if (errors.length) return done('CROSS_FIELD_ERROR', errors.join(' · '));
      }
      return done('FILLED');
    });
  }

  const blockers = results => results.filter(r => r.blocking);
  const summary = results => results.reduce((m, r) => { m[r.status] = (m[r.status] || 0) + 1; return m; }, {});

  const api = { validateFields, checkValue, blockers, summary, BLOCKING, CROSS, ruleFor };
  root.ValidationEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
