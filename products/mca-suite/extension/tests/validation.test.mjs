// node --test extension/tests/validation.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Engine = require('../js/validation/engine.js');
const V = require('../js/validation/validators.js');
const rules = require('../js/validation/rules/aoc4.js');

const data = { CIN: 'U01100KA2019PTC000001', COMPANY_NAME: 'Demo Terra Technology Private Limited', FY_FROM: '01/04/2025', FY_TO: '31/03/2026',
  BOARD_MEETING_DATE: '30/09/2026', AGM_HELD: 'Yes', AGM_DATE: '30/09/2026', IS_SUBSIDIARY: 'No', MAINTAIN_ELECTRONIC_BOOKS: 'No' };
const ctx = (extra = {}) => ({ rules, data, pageValues: { FY_FROM: '01/04/2025', FY_TO: '31/03/2026', BOARD_MEETING_DATE: '30/09/2026', ...extra }, today: new Date(2026, 10, 24) });
const one = (field, c = ctx()) => Engine.validateFields([{ visible: true, ...field }], c)[0];

test('signatory date 30/09/2026 after FY end is FILLED, even if MCA had a stale invalid flag', () => {
  const r = one({ key: 'FS_SIG_1_DATE', label: 'Date of signing', type: 'date', value: '30/09/2026', mcaRequired: true });
  assert.equal(r.status, 'FILLED');
});

test('signatory date before FY end is a CROSS_FIELD_ERROR', () => {
  const r = one({ key: 'FS_SIG_1_DATE', type: 'date', value: '30/09/2025', mcaRequired: true }, ctx({ FS_SIG_1_DATE: '30/09/2025' }));
  assert.equal(r.status, 'CROSS_FIELD_ERROR');
  assert.match(r.reason, /after the financial year end/);
});

test('ADT-1 SRN with no MCA message is FILLED (hidden model flag is never used)', () => {
  assert.equal(one({ key: 'ADT_SRN', value: 'AC6797408', mcaRequired: true }).status, 'FILLED');
});

test('MCA error text wins over everything', () => {
  const r = one({ key: 'ADT_SRN', value: 'AC6797408', mcaRequired: true, mcaError: 'SRN is not approved' });
  assert.equal(r.status, 'MCA_ERROR'); assert.equal(r.reason, 'SRN is not approved'); assert.ok(r.blocking);
});

test('empty optional field is OPTIONAL_EMPTY and not blocking', () => {
  const r = one({ label: '(c) Name of the holding company', value: '', mcaRequired: false });
  assert.equal(r.status, 'OPTIONAL_EMPTY'); assert.equal(r.blocking, false);
});

test('empty required field is MISSING_REQUIRED', () => {
  const r = one({ key: 'AGM_DATE', type: 'date', value: '', mcaRequired: true }, { ...ctx(), data: { ...data, AGM_DATE: '' } });
  assert.equal(r.status, 'MISSING_REQUIRED');
});

test('conditional field is NOT_APPLICABLE when its condition is not met (not a subsidiary)', () => {
  const r = one({ key: 'HOLDING_CIN', value: '', mcaRequired: true });
  assert.equal(r.status, 'NOT_APPLICABLE');
});

test('hidden field is NOT_VISIBLE', () => {
  assert.equal(one({ key: 'ADT_SRN', value: '', visible: false, mcaRequired: true }).status, 'NOT_VISIBLE');
});

test('read-only MCA-filled value is FILLED without format checks', () => {
  assert.equal(one({ key: 'AUDITOR_PAN', value: 'whatever', readOnly: true, mcaRequired: true }).status, 'FILLED');
});

test('formats: CIN, e-mail, number, date, dropdown option', () => {
  assert.equal(one({ key: 'CIN', value: 'U123', mcaRequired: true }).status, 'INVALID_FORMAT');
  assert.equal(one({ label: 'Email ID of the company', value: 'abc@', mcaRequired: true }).status, 'INVALID_FORMAT');
  assert.equal(one({ label: 'Share capital', type: 'number', value: '12a', mcaRequired: true }).status, 'INVALID_FORMAT');
  assert.equal(one({ label: 'Some date', type: 'date', value: '31/02/2026', mcaRequired: true }).status, 'INVALID_FORMAT');
  assert.equal(one({ label: 'Nature', type: 'select', value: 'X', options: [{ value: 'A', label: 'Adopted' }], mcaRequired: true }).status, 'INVALID_FORMAT');
  assert.equal(one({ label: 'Share capital', type: 'number', value: '100000', mcaRequired: true }).status, 'FILLED');
});

test('FY rules: 1 April start is only a warning; to-before-from is an error', () => {
  const r = one({ key: 'FY_FROM', type: 'date', value: '15/04/2025', mcaRequired: true }, ctx({ FY_FROM: '15/04/2025' }));
  assert.equal(r.status, 'FILLED'); assert.equal(r.warnings.length, 1);
  const r2 = one({ key: 'FY_TO', type: 'date', value: '31/03/2025', mcaRequired: true }, ctx({ FY_FROM: '01/04/2025', FY_TO: '31/03/2025' }));
  assert.equal(r2.status, 'CROSS_FIELD_ERROR');
});

test('financial year on MCA must match the year being filed', () => {
  const r = one({ key: 'FY_TO', type: 'date', value: '31/03/2025', mcaRequired: true }, { ...ctx({ FY_FROM: '01/04/2024', FY_TO: '31/03/2025' }) });
  assert.equal(r.status, 'CROSS_FIELD_ERROR'); assert.match(r.reason, /differs from the year/);
});

test('AGM: before board meeting or in the future is an error', () => {
  assert.equal(one({ key: 'AGM_DATE', type: 'date', value: '29/09/2026', mcaRequired: true }, ctx({ AGM_DATE: '29/09/2026' })).status, 'CROSS_FIELD_ERROR');
  assert.equal(one({ key: 'AGM_DATE', type: 'date', value: '30/12/2026', mcaRequired: true }, ctx({ AGM_DATE: '30/12/2026' })).status, 'CROSS_FIELD_ERROR');
  assert.equal(one({ key: 'AGM_DATE', type: 'date', value: '30/09/2026', mcaRequired: true }, ctx({ AGM_DATE: '30/09/2026' })).status, 'FILLED');
});

test('auditor appointment period must cover the financial year (when known)', () => {
  const c = { ...ctx(), data: { ...data, AUDITOR_APPOINTED_FROM: '01/04/2026', AUDITOR_APPOINTED_TO: '31/03/2031' } };
  assert.equal(one({ key: 'ADT_SRN', value: 'AC6797408', mcaRequired: true }, c).status, 'CROSS_FIELD_ERROR');
  assert.equal(one({ key: 'ADT_SRN', value: 'AC6797408', mcaRequired: true }).status, 'FILLED');
});

test('company name mismatch is a warning, not a block', () => {
  const r = one({ label: '2 (a) *Name of the company', value: 'OTHER CO PRIVATE LIMITED', readOnly: false, mcaRequired: true }, ctx({ COMPANY_NAME: 'OTHER CO PRIVATE LIMITED' }));
  assert.equal(r.status, 'FILLED'); assert.equal(r.warnings.length, 1);
});

test('checkValue: approved value is checked before it is filled', () => {
  assert.equal(Engine.checkValue({ key: 'AGM_DATE', type: 'date' }, '2026-09-30', ctx()).ok, true);
  assert.equal(Engine.checkValue({ key: 'AGM_DATE', type: 'date' }, '30/09/2025', ctx()).ok, false);
  assert.equal(Engine.checkValue({ key: 'ADT_SRN' }, 'bad', ctx()).ok, false);
});

test('validators: dates and numbers', () => {
  assert.equal(V.toMcaDate('2026-09-30'), '30/09/2026');
  assert.equal(V.toMcaDate('1-4-2025'), '01/04/2025');
  assert.equal(V.parseDate('29/02/2025'), null);
  assert.ok(Number.isFinite(V.toNumber('1,00,000')));
});

test('other forms: MGT-7 e-mail and AGM rules, DIR-3 KYC DIN/PAN, XBRL file', () => {
  const other = require('../js/validation/rules/other-forms.js');
  const c = rules => ({ rules, data: { finYearTo: '31/03/2026', agmHeld: 'Yes' }, pageValues: { finYearTo: '31/03/2026', agmHeld: 'Yes' }, today: new Date(2026, 10, 24) });
  const run = (rules, f) => Engine.validateFields([{ visible: true, ...f }], c(rules))[0];
  assert.equal(run(other.mgt7, { key: 'companyEmail', value: 'info@x', mcaRequired: true }).status, 'INVALID_FORMAT');
  assert.equal(run(other.mgt7, { key: 'companyEmail', value: '', mcaRequired: false }).status, 'MISSING_REQUIRED');
  assert.equal(run(other.mgt7, { key: 'agmDate', type: 'date', value: '30/03/2026' }).status, 'CROSS_FIELD_ERROR');
  assert.equal(run(other.mgt7, { key: 'gnl1Srn', value: '' }).status, 'NOT_APPLICABLE');
  assert.equal(run(other.dir3, { key: 'din', value: '1234567' }).status, 'INVALID_FORMAT');
  assert.equal(run(other.dir3, { key: 'pan', value: 'ABCDE1234F' }).status, 'FILLED');
  assert.equal(run(other.aoc4_xbrl, { key: 'XBRL_FILE', type: 'file', value: '' }).status, 'MISSING_REQUIRED');
});
