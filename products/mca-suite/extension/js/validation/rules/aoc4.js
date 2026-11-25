// AOC-4 validation rules — the one place to add or change how a field is judged.
//
// fields: keyed by the extension's data key (the `key` in FIELD_MAPPINGS / flattenClient output).
//   label     shown to the user (falls back to MCA's own label on the page)
//   type      text | number | date | email | select | radio | checkbox | file   (default: read from the page)
//   required  true | false | 'mca'  — 'mca' (default) follows MCA's own mandatory marker on the page
//   format    a Validators.FORMATS name: cin, pan, din, din_or_pan, srn, email, phone, pin, frn,
//             membership, itc_category, itc_product, percent, non_negative, integer
//   when      { key, is: [...] } or { key, not: [...] } — the field only applies when that other
//             field (page value, else approved data) matches; otherwise it is NOT_APPLICABLE
//   message   extra text shown with a failure
//
// byLabel: rules for page fields that have no data key, matched on MCA's label text. `key` gives
//   the field a key so cross-field rules and remembered answers can use it.
//
// cross: business rules across fields. fn names are implemented in engine.js:
//   dayMonth(key, day, month) · before(a, b) · onOrAfter(key, ref) · after(key, ref) ·
//   notFuture(key) · sameAsData(key) · sameText(key, ref) · periodCovers(from, to, start, end)
//   severity 'error' blocks Save/Next; 'warning' is shown but does not block.
(function (root) {
  'use strict';

  const sigDates = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}_SIG_${i + 1}_DATE`);
  const sigDins = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}_SIG_${i + 1}_DIN`);

  const fields = {
    CIN: { label: '1(a) CIN', required: true, format: 'cin' },
    COMPANY_NAME: { label: '2(a) Name of the company', type: 'text' },
    FY_FROM: { label: '3 Financial year from', type: 'date', required: true },
    FY_TO: { label: '3 Financial year to', type: 'date', required: true },
    BOARD_MEETING_DATE: { label: '4(a) Board meeting approving the financial statements', type: 'date' },
    BOARD_REPORT_DATE: { label: "5(a) Board meeting approving the Board's report", type: 'date' },
    AUDITOR_SIGN_DATE: { label: "6 Date of signing of the auditor's report", type: 'date' },
    AGM_DATE: { label: '7(b) Date of AGM', type: 'date', required: true, when: { key: 'AGM_HELD', is: ['Yes', 'Y', 'true'] } },
    AGM_DUE_DATE: { label: '7(c) Due date of AGM', type: 'date' },
    GNL1_SRN: { label: '7(e) SRN of GNL-1', format: 'srn', when: { key: 'AGM_EXTENSION', is: ['Yes', 'Y', 'true'] } },
    AGM_EXT_DUE_DATE: { label: '7(f) Due date after extension', type: 'date', when: { key: 'AGM_EXTENSION', is: ['Yes', 'Y', 'true'] } },

    HOLDING_CIN: { label: '8(b) CIN of the holding company', when: { key: 'IS_SUBSIDIARY', is: ['Yes', 'Y', 'true'] } },
    HOLDING_NAME: { label: '8(c) Name of the holding company', when: { key: 'IS_SUBSIDIARY', is: ['Yes', 'Y', 'true'] } },
    PROVISION_SECTION: { label: '8(d) Provision under which it became a subsidiary', when: { key: 'IS_SUBSIDIARY', is: ['Yes', 'Y', 'true'] } },
    ADT_SRN: { label: '9 SRN of Form ADT-1', required: true, format: 'srn' },
    MAINTAIN_ELECTRONIC_BOOKS: { label: '12(a) Books of account kept in electronic form?', type: 'radio', required: true,
      options: [{ value: 'Yes', label: 'Yes' }, { value: 'No', label: 'No' }] },
    AGM_HELD: { label: '7(a) Whether AGM held', type: 'radio', required: true, options: [{ value: 'Yes', label: 'Yes' }, { value: 'No', label: 'No' }] },
    AUDITOR_PAN: { label: '9(a) PAN of the auditor / firm', format: 'pan' },
    AUDITOR_FIRM_REG: { label: '9(c) Membership / firm registration number' },
    AUDITOR_PIN: { label: '9(e) Auditor PIN code', format: 'pin' },
    MEMBER_NUMBER: { label: '9(f) Membership number of the signing member', format: 'membership' },
    SERVER_PIN: { label: '12(b) Server PIN code', format: 'pin', when: { key: 'MAINTAIN_ELECTRONIC_BOOKS', is: ['Yes', 'Y', 'true'] } },
    SERVER_ADDR1: { label: '12(b) Server address', when: { key: 'MAINTAIN_ELECTRONIC_BOOKS', is: ['Yes', 'Y', 'true'] } },

    TOTAL_CATEGORIES: { label: 'IV Total number of product/service categories', type: 'number', required: true, format: 'integer' },
    CATEGORY_CODE: { label: 'IV Product/service category code (ITC/NPCS, 4 digits)', required: true, format: 'itc_category' },
    CATEGORY_DESC: { label: 'IV Description of the product/service category', required: true },
    CATEGORY_TURNOVER: { label: 'IV Turnover of the category (₹)', type: 'number', required: true, format: 'non_negative' },
    HIGHEST_CODE: { label: 'IV Highest-turnover product/service code (ITC/NPCS, 8 digits)', required: true, format: 'itc_product' },
    HIGHEST_DESC: { label: 'IV Description of the highest-turnover product/service', required: true },
    HIGHEST_TURNOVER: { label: 'IV Turnover of the highest product/service (₹)', type: 'number', required: true, format: 'non_negative' },
    FP_BS_06_PERCENT: { label: 'Paid-up capital held by foreign companies (%)', type: 'number', format: 'percent' },
    FP_BS_07_PERCENT: { label: 'Paid-up capital held by foreign institutional investors (%)', type: 'number', format: 'percent' },
    FP_PL_PROPOSED_DIVIDEND_PERCENT: { label: 'Proposed dividend (%)', type: 'number', format: 'percent' },
  };
  // Signatory rows: DIN or PAN, and a date of signing.
  for (const k of [...sigDins('FS', 5), ...sigDins('BR', 3)]) fields[k] = { label: k.replace(/_/g, ' '), format: 'din_or_pan' };
  for (const k of [...sigDates('FS', 5), ...sigDates('BR', 3)]) fields[k] = { label: k.replace(/_/g, ' '), type: 'date' };

  const byLabel = [
    { match: /name of the company/i, key: 'COMPANY_NAME' },
    { match: /e-?mail/i, format: 'email', type: 'email' },
    { match: /\bpin ?code\b/i, format: 'pin' },
    { match: /income-?tax pan|\bPAN\b of/i, format: 'pan' },
    { match: /\bSRN\b/i, format: 'srn' },
  ];

  const after = (key, ref, message, severity = 'error') => ({ id: `${key}_after_${ref}`, fn: 'after', key, ref, severity, message });
  const cross = [
    { id: 'fy_start_april', fn: 'dayMonth', key: 'FY_FROM', day: 1, month: 4, severity: 'warning',
      message: 'The financial year normally starts on 1 April. Check it is correct (first year or a changed year).' },
    { id: 'fy_end_march', fn: 'dayMonth', key: 'FY_TO', day: 31, month: 3, severity: 'warning',
      message: 'The financial year normally ends on 31 March.' },
    { id: 'fy_order', fn: 'before', a: 'FY_FROM', b: 'FY_TO', key: 'FY_TO', severity: 'error',
      message: 'Financial year "to" must be after "from".' },
    { id: 'fy_matches_filing', fn: 'sameAsData', key: 'FY_TO', severity: 'error',
      message: 'The financial year on MCA differs from the year of the financial statements being filed.' },
    after('BOARD_MEETING_DATE', 'FY_TO', 'The board can only approve the accounts after the financial year ends.'),
    after('BOARD_REPORT_DATE', 'FY_TO', "The Board's report can only be approved after the financial year ends."),
    after('AUDITOR_SIGN_DATE', 'FY_TO', "The auditor can only sign after the financial year ends."),
    after('AGM_DATE', 'FY_TO', 'The AGM adopting these accounts must be after the financial year end.'),
    ...sigDates('FS', 5).map(k => after(k, 'FY_TO', 'Signing date must be after the financial year end.')),
    ...sigDates('BR', 3).map(k => after(k, 'FY_TO', 'Signing date must be after the financial year end.')),
    ...sigDates('FS', 5).map(k => ({ id: `${k}_vs_board`, fn: 'onOrAfter', key: k, ref: 'BOARD_MEETING_DATE', severity: 'warning',
      message: 'Directors normally sign on or after the board meeting that approved the accounts (4a).' })),
    { id: 'agm_after_board', fn: 'onOrAfter', key: 'AGM_DATE', ref: 'BOARD_MEETING_DATE', severity: 'error',
      message: 'The AGM cannot be before the board meeting that approved the accounts.' },
    { id: 'agm_not_future', fn: 'notFuture', key: 'AGM_DATE', severity: 'error', message: 'AGM date cannot be in the future.' },
    { id: 'auditor_period', fn: 'periodCovers', from: 'AUDITOR_APPOINTED_FROM', to: 'AUDITOR_APPOINTED_TO', start: 'FY_FROM', end: 'FY_TO',
      key: 'ADT_SRN', severity: 'error', message: "The financial year must fall within the auditor's appointment period (ADT-1)." },
    { id: 'name_matches_master', fn: 'sameText', key: 'COMPANY_NAME', severity: 'warning',
      message: 'The company name MCA shows differs from the name in the dashboard data — check the CIN.' },
  ];

  // derive: values worked out from other data when the documents give none (applied before the
  // user is asked). from = copy another key; value = a fixed default.
  const derive = {
    TOTAL_CATEGORIES: { value: '1' },
    CATEGORY_TURNOVER: { from: 'REVENUE_OPERATIONS_CUR' },
    HIGHEST_TURNOVER: { from: 'REVENUE_OPERATIONS_CUR' },
  };
  cross.push({ id: 'highest_within_category', fn: 'notMore', key: 'HIGHEST_TURNOVER', ref: 'CATEGORY_TURNOVER', severity: 'error',
    message: 'Turnover of the highest product cannot be more than the turnover of its category.' });
  cross.push({ id: 'highest_code_in_category', fn: 'startsWith', key: 'HIGHEST_CODE', ref: 'CATEGORY_CODE', severity: 'warning',
    message: 'The 8-digit product code normally starts with its 4-digit category code.' });

  const rules = { form: 'aoc4', label: 'AOC-4', fields, byLabel, cross, derive };
  root.ValidationRules = Object.assign(root.ValidationRules || {}, { aoc4: rules });
  if (typeof module !== 'undefined' && module.exports) module.exports = rules;
})(typeof window !== 'undefined' ? window : globalThis);
