// Validation rules for the other MCA forms, in the same shape as rules/aoc4.js (see that file for
// what each property means). The engine is form-agnostic; a form's filler uses its rules by name:
//   ValidationRules.mgt7 · mgt7a · dir3 · aoc4_xbrl
// Keys are the data keys each form's field map uses (js/field-maps/<form>.js).
(function (root) {
  'use strict';
  const YES = ['Yes', 'Y', 'true'];
  const after = (key, ref, message, severity = 'error') => ({ id: `${key}_after_${ref}`, fn: 'after', key, ref, severity, message });

  // ── MGT-7 (annual return) ──
  const mgt7 = {
    form: 'mgt7', label: 'MGT-7',
    fields: {
      cin: { label: 'CIN', required: true, format: 'cin' },
      finYearFrom: { label: 'Financial year from', type: 'date', required: true },
      finYearTo: { label: 'Financial year to', type: 'date', required: true },
      filingType: { label: 'Type of filing (Original / Revised)', required: true },
      companyPan: { label: 'PAN of the company', format: 'pan' },
      companyEmail: { label: 'E-mail of the company', type: 'email', required: true, format: 'email' },
      companyPhone: { label: 'Telephone of the company', required: true },
      dateOfIncorporation: { label: 'Date of incorporation', type: 'date' },
      agmHeld: { label: 'Whether AGM held', required: true },
      agmDate: { label: 'Date of AGM', type: 'date', when: { key: 'agmHeld', is: YES } },
      agmDueDate: { label: 'Due date of AGM', type: 'date' },
      agmExtendedDueDate: { label: 'Extended due date of AGM', type: 'date', when: { key: 'agmExtensionGranted', is: YES } },
      gnl1Srn: { label: 'SRN of GNL-1', format: 'srn', when: { key: 'agmExtensionGranted', is: YES } },
      srnEarlierMgt7: { label: 'SRN of the earlier MGT-7', format: 'srn', when: { key: 'filingType', is: ['Revised'] } },
      director1DinPan: { label: 'Director 1 DIN/PAN', format: 'din_or_pan' },
    },
    byLabel: [
      { match: /e-?mail/i, format: 'email', type: 'email' },
      { match: /\bpin ?code\b/i, format: 'pin' },
      { match: /\bDIN\b/i, format: 'din_or_pan' },
    ],
    cross: [
      { id: 'fy_start_april', fn: 'dayMonth', key: 'finYearFrom', day: 1, month: 4, severity: 'warning', message: 'The financial year normally starts on 1 April.' },
      { id: 'fy_end_march', fn: 'dayMonth', key: 'finYearTo', day: 31, month: 3, severity: 'warning', message: 'The financial year normally ends on 31 March.' },
      { id: 'fy_order', fn: 'before', a: 'finYearFrom', b: 'finYearTo', key: 'finYearTo', severity: 'error', message: 'Financial year "to" must be after "from".' },
      after('agmDate', 'finYearTo', 'The AGM must be after the financial year end.'),
      { id: 'agm_not_future', fn: 'notFuture', key: 'agmDate', severity: 'error', message: 'AGM date cannot be in the future.' },
      { id: 'fy_matches_filing', fn: 'sameAsData', key: 'finYearTo', severity: 'error', message: 'The financial year on MCA differs from the year being filed.' },
    ],
  };

  // ── MGT-7A (OPC / small company abridged annual return): same core, no AGM for OPCs ──
  const mgt7a = {
    ...mgt7, form: 'mgt7a', label: 'MGT-7A',
    fields: { ...mgt7.fields, agmHeld: { label: 'Whether AGM held (not required for an OPC)', required: 'mca' } },
  };

  // ── DIR-3 KYC ──
  const dir3 = {
    form: 'dir3', label: 'DIR-3 KYC',
    fields: {
      din: { label: 'DIN', required: true, format: 'din' },
      pan: { label: 'Income-tax PAN', required: true, format: 'pan' },
      name: { label: 'Full name', required: true },
      dob: { label: 'Date of birth', type: 'date', required: true },
      mobile: { label: 'Mobile number', required: true, format: 'phone' },
      email: { label: 'E-mail', type: 'email', required: true, format: 'email' },
      pincode: { label: 'PIN code', required: true, format: 'pin' },
    },
    byLabel: [{ match: /e-?mail/i, format: 'email', type: 'email' }, { match: /\bpin ?code\b/i, format: 'pin' }],
    cross: [
      { id: 'dob_past', fn: 'notFuture', key: 'dob', severity: 'error', message: 'Date of birth cannot be in the future.' },
    ],
  };

  // ── AOC-4 XBRL: Part A general information is the same as AOC-4; financials come from the XBRL file ──
  const aoc4 = (root.ValidationRules || {}).aoc4 || { fields: {}, byLabel: [], cross: [] };
  const aoc4_xbrl = {
    form: 'aoc4_xbrl', label: 'AOC-4 XBRL',
    fields: {
      ...Object.fromEntries(Object.entries(aoc4.fields).filter(([k]) => !/^(CATEGORY|HIGHEST|FP_)/.test(k))),
      XBRL_FILE: { label: 'XBRL instance document', type: 'file', required: true },
    },
    byLabel: aoc4.byLabel,
    cross: aoc4.cross.filter(c => !/^(FP_|CATEGORY|HIGHEST)/.test(c.key)),
  };

  root.ValidationRules = Object.assign(root.ValidationRules || {}, { mgt7, mgt7a, dir3, aoc4_xbrl });
  if (typeof module !== 'undefined' && module.exports) module.exports = { mgt7, mgt7a, dir3, aoc4_xbrl };
})(typeof window !== 'undefined' ? window : globalThis);
