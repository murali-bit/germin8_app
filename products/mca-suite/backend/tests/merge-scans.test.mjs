// node --test backend/tests/merge-scans.test.mjs
// The dashboard's pure scan merge (dashboard/src/lib/scanMerge.js). Made-up data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeScans, managerialMoves, isScaledAmount, unitOfFields, sameValue } from '../../dashboard/src/lib/scanMerge.js';

const pdf = (fields, unit = 100) => ({
  id: 'f1', name: 'dummy-fs.pdf', kind: 'pdf',
  json: { ok: true, schema: 'aoc4-client', extractedFields: { ...fields, meta: { unitMultiplier: unit, ...(fields.meta || {}) } } },
});
const xlsx = (fields, unit = 1) => ({
  id: 'f2', name: 'dummy-tb.xlsx', kind: 'xlsx',
  json: { ok: true, schema: 'aoc4-client', extractedFields: { ...fields, meta: { unitMultiplier: unit } } },
});

test('rounded PDF amount gives way to the exact Excel figure within one printed unit', () => {
  const m = mergeScans([
    pdf({ general: { COMPANY_NAME: 'Dummy Test Pvt Ltd' }, profitLoss: { current: { DEPRECIATION: 12400, EPS_BASIC: 1.5 } } }),
    xlsx({ general: { COMPANY_NAME: 'DUMMY TEST PRIVATE LIMITED' }, profitLoss: { current: { DEPRECIATION: 12345, EPS_BASIC: 1.47 } } }),
  ]);
  assert.equal(m.data.profitLoss.current.DEPRECIATION, 12345);
  assert.equal(m.sources['profitLoss.current.DEPRECIATION'], 'excel');
  // Text keeps the PDF; EPS is not a scaled amount, so the PDF value stays.
  assert.equal(m.data.general.COMPANY_NAME, 'Dummy Test Pvt Ltd');
  assert.equal(m.sources['general.COMPANY_NAME'], 'document');
  assert.equal(m.data.profitLoss.current.EPS_BASIC, 1.5);
  assert.equal(m.data.meta.roundingChoices.length, 1);
  assert.deepEqual(m.data.meta.roundingChoices[0].path, ['profitLoss', 'current', 'DEPRECIATION']);
  assert.equal(m.data.meta.roundingChoices[0].document, 12400);
  assert.equal(m.data.meta.roundingChoices[0].excel, 12345);
  assert.match(m.data.meta.notes, /1 amount\(s\) taken from dummy-tb\.xlsx/);
  // The replaced rounded figure is not reported as a conflict.
  assert.ok(!m.data.meta.conflicts.some(c => c.key === 'profitLoss.current.DEPRECIATION'));
});

test('Excel read in the same printed unit still wins within one unit', () => {
  const m = mergeScans([
    pdf({ profitLoss: { previous: { DEPRECIATION: 5600 } } }),
    xlsx({ profitLoss: { previous: { DEPRECIATION: 5500 } } }, 100),
  ]);
  assert.equal(m.data.profitLoss.previous.DEPRECIATION, 5500);
  assert.equal(m.sources['profitLoss.previous.DEPRECIATION'], 'excel');
});

test('Excel figure further than one unit away is a conflict, PDF stays', () => {
  const m = mergeScans([
    pdf({ balanceSheet: { current: { INVENTORIES: 50000 } } }),
    xlsx({ balanceSheet: { current: { INVENTORIES: 70000 } } }),
  ]);
  assert.equal(m.data.balanceSheet.current.INVENTORIES, 50000);
  assert.equal(m.sources['balanceSheet.current.INVENTORIES'], 'document');
  const c = m.data.meta.conflicts.find(x => x.key === 'balanceSheet.current.INVENTORIES');
  assert.ok(c);
  assert.deepEqual(c.values.map(v => v.value), [50000, 70000]);
  assert.ok(m.data.meta.uncertain.includes('balanceSheet.current.INVENTORIES'));
});

test('PDF in rupees (no unit) keeps its own figure', () => {
  const m = mergeScans([
    pdf({ profitLoss: { current: { OTHER_EXPENSES: 1000 } } }, 1),
    xlsx({ profitLoss: { current: { OTHER_EXPENSES: 1000.4 } } }),
  ]);
  assert.equal(m.data.profitLoss.current.OTHER_EXPENSES, 1000);
  assert.equal(m.data.meta.roundingChoices.length, 0);
});

test('blank PDF value is filled from Excel and tagged excel', () => {
  const m = mergeScans([
    pdf({ auditor: { AUDITOR_FIRM_REG: '' } }),
    xlsx({ auditor: { AUDITOR_FIRM_REG: '000000S' } }),
  ]);
  assert.equal(m.data.auditor.AUDITOR_FIRM_REG, '000000S');
  assert.equal(m.sources['auditor.AUDITOR_FIRM_REG'], 'excel');
});

test('unit from the scale note when meta has none; scaled-amount paths', () => {
  assert.equal(unitOfFields({ balanceSheet: { scaleNote: 'Converted from Rupees Thousand to Rupees (x1000).' } }), 1000);
  assert.equal(unitOfFields({ meta: { unitMultiplier: 1 } }), 1);
  assert.ok(isScaledAmount(['balanceSheet', 'current', 'TRADE_RECEIVABLES']));
  assert.ok(!isScaledAmount(['profitLoss', 'current', 'EPS_DILUTED']));
  assert.ok(!isScaledAmount(['general', 'CIN']));
  assert.ok(!isScaledAmount(['shareCapital', 'FACE_VALUE']));
  assert.ok(sameValue('1,000', 1000));
  assert.ok(sameValue(' Dummy  Test ', 'dummy test'));
});

test('managerial remuneration Yes moves the amount and keeps the expense total', () => {
  const data = {
    profitLoss: { current: { EMPLOYEE_EXPENSES: 900000, MANAGERIAL_REMUNERATION: 0, TOTAL_EXPENSES: 1500000 } },
    profitLossDetails: { PL_EMPLOYEE_BENEFITS: { current: 900000, previous: 800000 }, PL_MANAGERIAL_REMUNERATION: { current: 0, previous: 0 }, PL_OTHER_EXPENSES: { current: 600000 } },
  };
  const w = managerialMoves(data, 'current', 240000);
  const get = p => w.find(x => x.path.join('.') === p)?.value;
  assert.equal(get('profitLossDetails.PL_EMPLOYEE_BENEFITS.current'), 660000);
  assert.equal(get('profitLossDetails.PL_MANAGERIAL_REMUNERATION.current'), 240000);
  assert.equal(get('profitLoss.current.MANAGERIAL_REMUNERATION'), 240000);
  // Face P&L employee expenses already include it and the total is untouched.
  assert.equal(w.some(x => x.path.join('.') === 'profitLoss.current.EMPLOYEE_EXPENSES'), false);
  assert.equal(w.some(x => x.path.join('.') === 'profitLoss.current.TOTAL_EXPENSES'), false);
  assert.equal(get('profitLossDetails.PL_EMPLOYEE_BENEFITS.current') + get('profitLossDetails.PL_MANAGERIAL_REMUNERATION.current'), 900000);
  assert.deepEqual(managerialMoves(data, 'current', 2000000), []);   // more than employee benefits: nothing to move
  assert.deepEqual(managerialMoves(data, 'later', 1), []);
});

test('worked-out PDF values (meta.derived) are not swapped for an Excel figure (AS-18 total, note depreciation)', () => {
  const m = mergeScans([
    pdf({ financialParametersBS: { FP_BS_22: 1234500 }, meta: { derived: ['financialParametersBS.FP_BS_22'] } }),
    xlsx({ financialParametersBS: { FP_BS_22: 1234465 } }, 100),
  ]);
  assert.equal(m.data.financialParametersBS.FP_BS_22, 1234500);
  assert.equal(m.data.meta.roundingChoices.length, 0);
});

test('a balance-sheet line the PDF scan adjusted for rounding gives way to the exact Excel figure', () => {
  const m = mergeScans([
    pdf({ balanceSheet: { previous: { TRADE_RECEIVABLES: 41300, TOTAL_ASSETS: 90000 } }, meta: { derived: ['balanceSheet.previous.TRADE_RECEIVABLES'] } }),
    xlsx({ balanceSheet: { previous: { TRADE_RECEIVABLES: 41200, TOTAL_ASSETS: 90000 } } }, 100),
  ]);
  assert.equal(m.data.balanceSheet.previous.TRADE_RECEIVABLES, 41200);
  assert.equal(m.sources['balanceSheet.previous.TRADE_RECEIVABLES'], 'excel');
});

test('other worked-out values (e.g. an AS-18 total) are never swapped for the Excel figure', () => {
  const m = mergeScans([
    pdf({ financialParametersBS: { FP_BS_22: 50000 }, meta: { derived: ['financialParametersBS.FP_BS_22'] } }),
    xlsx({ financialParametersBS: { FP_BS_22: 49980 } }, 100),
  ]);
  assert.equal(m.data.financialParametersBS.FP_BS_22, 50000);
});
