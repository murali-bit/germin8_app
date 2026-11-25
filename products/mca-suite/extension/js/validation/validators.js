// Field-type and format validators shared by the validation engine and the correction popup.
// Pure functions, no DOM: usable in the side panel and in Node tests.
//
//   Validators.isEmpty(type, value)            → true when the field holds no answer
//   Validators.checkType(type, value, options) → '' or the reason the value does not fit the type
//   Validators.checkFormat(format, value)      → '' or the reason the value breaks the format rule
//   Validators.parseDate('31/03/2026')         → Date | null   (MCA format DD/MM/YYYY, strict)
//   Validators.toMcaDate('2026-03-31')         → '31/03/2026' | ''
(function (root) {
  'use strict';

  const str = v => (v === undefined || v === null ? '' : String(v)).trim();

  // Strict DD/MM/YYYY — the only format MCA date boxes accept.
  function parseDate(v) {
    const m = str(v).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return null;
    const d = new Date(+m[3], +m[2] - 1, +m[1]);
    return d.getFullYear() === +m[3] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[1] ? d : null;
  }

  // Accepts DD/MM/YYYY, D-M-YYYY, DD.MM.YYYY and YYYY-MM-DD; returns MCA's DD/MM/YYYY or ''.
  function toMcaDate(v) {
    const s = str(v);
    let d, m, y, x;
    if ((x = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/))) [, d, m, y] = x;
    else if ((x = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) [, y, m, d] = x;
    else return '';
    const out = `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
    return parseDate(out) ? out : '';
  }

  const toNumber = v => {
    const s = str(v).replace(/,/g, '');
    return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
  };

  const YES = /^(true|yes|y|1|on|checked)$/i;

  function isEmpty(type, value) {
    if (type === 'checkbox') return !YES.test(str(value));
    if (type === 'file') return !str(value);
    const s = str(value);
    return !s || /^(--|select|select here|dd\/mm\/yyyy|enter here)$/i.test(s);
  }

  // Type validation: does the value fit the kind of box at all?
  function checkType(type, value, options) {
    const s = str(value);
    if (!s) return '';
    switch (type) {
      case 'date': return parseDate(s) ? '' : 'Date must be a real date in DD/MM/YYYY format';
      case 'number': return Number.isFinite(toNumber(s)) ? '' : 'Only numbers are allowed (no letters, symbols or spaces)';
      case 'email': return FORMATS.email.re.test(s) ? '' : FORMATS.email.message;
      case 'select':
      case 'radio': {
        if (!Array.isArray(options) || !options.length) return '';
        const ok = options.some(o => str(o.value) === s || str(o.label).toLowerCase() === s.toLowerCase());
        return ok ? '' : `"${s}" is not one of the options MCA offers`;
      }
      default: return '';
    }
  }

  // Format rules referenced by name from the rules config ("format": "cin").
  const FORMATS = {
    cin: { re: /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/i, message: 'CIN must be 21 characters, e.g. U74999MH2010PTC123456' },
    llpin: { re: /^[A-Z]{3}-\d{4}$/i, message: 'LLPIN looks like AAA-1234' },
    pan: { re: /^[A-Z]{5}\d{4}[A-Z]$/i, message: 'PAN must look like ABCDE1234F' },
    din: { re: /^\d{8}$/, message: 'DIN must be exactly 8 digits' },
    din_or_pan: { re: /^(\d{8}|[A-Z]{5}\d{4}[A-Z])$/i, message: 'Enter an 8-digit DIN or a 10-character PAN' },
    srn: { re: /^[A-Z]{1,2}\d{7,8}$/i, message: 'SRN looks like AC6797408 or F12345678' },
    email: { re: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, message: 'Enter a valid e-mail address (name@domain.com)' },
    phone: { re: /^(\+?91[\s-]?)?[6-9]\d{9}$/, message: 'Enter a 10-digit mobile number' },
    pin: { re: /^[1-9]\d{5}$/, message: 'PIN code must be 6 digits' },
    frn: { re: /^\d{6}[A-Z]$|^[A-Z]\d{5,6}$/i, message: 'Firm registration number looks like 018971S' },
    membership: { re: /^\d{5,7}$/, message: 'Membership number is 5–7 digits' },
    itc_category: { re: /^\d{4}$/, message: 'ITC / NPCS category code is 4 digits' },
    itc_product: { re: /^\d{8}$/, message: 'ITC / NPCS product code is 8 digits' },
    percent: { test: v => { const n = toNumber(v); return Number.isFinite(n) && n >= 0 && n <= 100; }, message: 'Percentage must be between 0 and 100' },
    non_negative: { test: v => { const n = toNumber(v); return Number.isFinite(n) && n >= 0; }, message: 'Amount cannot be negative here' },
    integer: { test: v => /^-?\d+$/.test(str(v).replace(/,/g, '')), message: 'Whole numbers only' },
  };

  function checkFormat(format, value) {
    const s = str(value);
    if (!s || !format) return '';
    const f = FORMATS[format];
    if (!f) return '';
    const ok = f.re ? f.re.test(s) : f.test(s);
    return ok ? '' : f.message;
  }

  const api = { parseDate, toMcaDate, toNumber, isEmpty, checkType, checkFormat, FORMATS, YES };
  root.Validators = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
