// Placeholder answers for the LINKED forms only (AOC-2, Auditor's report, Board's report) of a company whose
// company master says so: answer LINKED_DUMMY_OK = "Yes" (formType aoc4) in the backend. AOC-4 pages 1 and 2
// never use these. Every placeholder is saved to the company master (so the dashboard shows it) and the run
// goes on by itself. Replace them with the real values before the final Submit.
(function (root) {
  const T = { fyFrom: '', fyTo: '' };
  // Linked-form placeholders allowed for this company? (answers = the company master answers, aoc4 merged in)
  T.allowed = answers => /^yes$/i.test(String((answers || {}).LINKED_DUMMY_OK || '').trim());

  // FY of the loaded company (falls back to the latest Indian FY).
  T.fy = () => {
    let from = T.fyFrom, to = T.fyTo;
    try { const c = typeof currentData !== 'undefined' ? currentData : null; if (c) { from = from || c.FY_FROM; to = to || c.FY_TO; } } catch (_) { }
    const y = new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1;
    return { from: from || `01/04/${y - 1}`, to: to || `31/03/${y}` };
  };

  // A dummy answer for one question: {key, label, type, options}.
  T.dummy = f => {
    const key = String((f && f.key) || ''), label = String((f && f.label) || ''), type = String((f && f.type) || 'text');
    const both = `${key} ${label}`;
    const { from, to } = T.fy();
    const opts = (f && f.options || []).map(o => (typeof o === 'object' ? (o.value ?? o.label) : o)).filter(o => o !== '' && o != null);
    if (/BOARD_MEETINGS/i.test(key)) {
      const y1 = to.slice(-4) - 1, y2 = to.slice(-4);
      return [`15/05/${y1} | 2 | 2`, `14/08/${y1} | 2 | 2`, `13/11/${y1} | 2 | 2`, `12/02/${y2} | 2 | 2`].join('\n');
    }
    if (/(^|_)ROWS$/i.test(key)) return '[]';
    if (type === 'select' || type === 'radio' || opts.length) return opts.find(o => /^no$/i.test(String(o))) ?? opts[0] ?? 'No';
    if (type === 'date' || /date/i.test(both)) return /from|start/i.test(both) ? from : to;
    if (/BOARD_RESOLUTION_NO|resolution number/i.test(both)) return 'TEST-01/26';
    if (/email/i.test(both)) return 'test@example.com';
    if (/\bpin\b|zip/i.test(both)) return '560001';
    if (/\bpan\b/i.test(both)) return 'ABCDE1234F';
    if (/\bdin\b|director identification/i.test(both)) return '07654321';
    if (/membership/i.test(both)) return '123456';
    if (/\bsrn\b/i.test(both)) return 'F12345678';
    if (type === 'number' || /^EMP_|count|number of|amount|turnover|percent|\bno\.? of\b/i.test(both)) return '0';
    if (/emphasis|fraud|material change|order|other info|other matter|director change|5b/i.test(both)) return 'Nil';
    return 'TEST DATA';
  };

  root.LinkedDummy = T;
  if (typeof module !== 'undefined') module.exports = T;
})(typeof window !== 'undefined' ? window : globalThis);

// MCA tab (world MAIN, self-contained): fills visible boxes MCA marks empty/required ("Please enter the relevant
// details", red error, or an empty required control) with dummy values; radios pick "No" when offered. Never clicks
// a button. ctx: {from, to} (DD/MM/YYYY). Returns {filled: [labels]}.
async function pageLinkedFillEmpty(ctx) {
  const visible = el => !!el && el.getClientRects().length > 0;
  const t = el => String((el && (el.innerText || el.textContent)) || '').replace(/\s+/g, ' ').trim();
  const fire = el => { for (const n of ['input', 'change', 'blur']) { try { el.dispatchEvent(new Event(n, { bubbles: true })); } catch (_) { } } };
  let nodes = null;
  const model = el => {
    const gb = window.guideBridge;
    if (!gb || typeof gb.visit !== 'function') return null;
    if (!nodes) { nodes = new Map(); try { gb.visit(c => { if (c && c.id) nodes.set(c.id, c); }); } catch (_) { return null; } }
    const id = String(el.id || '').replace(/-\d+_widget$/, '').replace(/_widget$/, '');
    const name = String(el.name || '').replace(/___jqName$/, '');
    return nodes.get(id) || nodes.get(name) || null;
  };
  const setVal = (el, v) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const n = model(el);
    let mv = v;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(v) && (el.placeholder === 'DD/MM/YYYY' || /date/i.test(el.getAttribute('aria-label') || ''))) mv = `${v.slice(6)}-${v.slice(3, 5)}-${v.slice(0, 2)}`;
    try { if (n) n.value = mv; } catch (_) { }
    try { Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); } catch (_) { el.value = v; }
    fire(el);
  };
  const fieldOf = el => el.closest('.guideFieldNode, .guidefield, [data-guide-au]') || el.parentElement;
  const labelOf = el => `${el.getAttribute('aria-label') || ''} ${t((fieldOf(el) || {}).querySelector ? fieldOf(el).querySelector('.guideFieldLabel, label') : null)}`.trim();
  const flagged = el => {
    const f = fieldOf(el);
    const err = f && [...f.querySelectorAll('.guideFieldError')].some(e => visible(e) && t(e));
    return err || el.required || el.getAttribute('aria-required') === 'true';
  };
  const dummyText = lab => {
    if (/email/i.test(lab)) return 'test@example.com';
    if (/\bpin\b|\bpin ?code\b|\bzip\b|postal code/i.test(lab)) return '560001';
    if (/\bpan\b/i.test(lab)) return 'ABCDE1234F';
    if (/\bsrn\b/i.test(lab)) return 'F12345678';
    if (/number|amount|count|turnover|percent|\(in|rs\.|inr/i.test(lab)) return '0';
    return 'Not applicable';
  };
  // Login / search / captcha boxes are never touched. Names are split into lowercase words first (camelCase,
  // "_", "-", spaces), so "captchaInput", "searchText", "otpValue" and "userId" match, while "rootPanel" (it
  // contains the letters "otp") does not.
  const words = value => String(value || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const LOGIN_WORDS = new Set(['search', 'captcha', 'password', 'otp', 'userid']);
  const loginBox = el => {
    const w = words(`${el.name || ''} ${el.id || ''} ${el.getAttribute('aria-label') || ''} ${el.type || ''}`);
    return w.some((x, i) => LOGIN_WORDS.has(x) || (x === 'user' && w[i + 1] === 'id'));
  };
  const filled = [];
  // Radio groups: none chosen and flagged → "No" if offered, else the first option.
  const groups = new Map();
  for (const r of document.querySelectorAll('input[type="radio"]')) if (visible(r) && !r.disabled && r.name) (groups.get(r.name) || groups.set(r.name, []).get(r.name)).push(r);
  for (const [, rs] of groups) {
    if (rs.some(r => r.checked) || !rs.some(flagged) || loginBox(rs[0])) continue;
    const no = rs.find(r => /^no$/i.test((r.getAttribute('aria-label') || r.value || '').trim())) || rs[0];
    no.click(); if (!no.checked) { no.checked = true; fire(no); }
    try { const n = model(no); if (n) n.value = no.value; } catch (_) { }
    filled.push(labelOf(no) || no.name);
  }
  for (const el of document.querySelectorAll('input:not([type]), input[type="text"], input[type="number"], input[type="email"], textarea, select')) {
    if (!visible(el) || el.disabled || el.readOnly || String(el.value || '').trim() || !flagged(el)) continue;
    if (loginBox(el)) continue;
    const lab = labelOf(el);
    if (el.tagName === 'SELECT') {
      const opt = [...el.options].find(o => o.value && /^no$/i.test(o.text.trim())) || [...el.options].find(o => o.value);
      if (!opt) continue;
      setVal(el, opt.value);
    } else if (el.placeholder === 'DD/MM/YYYY' || /date/i.test(lab)) {
      setVal(el, ctx && ctx.to ? ctx.to : '31/03/2026');
    } else setVal(el, dummyText(lab) || 'Not applicable');
    filled.push(lab.slice(0, 60) || el.name);
    await new Promise(r => setTimeout(r, 30));
  }
  return { filled };
}
