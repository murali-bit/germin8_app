// node --test extension/tests/linked-eboard.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const FORM = require('../js/linked/eboard.js');
const { lfCollectMissing } = require('../js/linked/runner.js');
const { parseMeetings, fmtINR } = FORM.helpers;

// Demo Terra Technology Private Limited, FY 2025-26 (real figures, rupees).
const sampleCo = {
  general: { CIN: 'U01100KA2019PTC000001', COMPANY_NAME: 'Demo Terra Technology Private Limited', FY_FROM: '01/04/2025', FY_TO: '31/03/2026',
    BOARD_MEETING_DATE: '30/09/2026', BOARD_REPORT_DATE: '30/09/2026', AUDITOR_SIGN_DATE: '30/09/2026', AGM_HELD: 'Yes' },
  subsidiary: { IS_SUBSIDIARY: 'No', HAS_SUBSIDIARY_OR_JV: 'No' },
  signatoriesFS: [{ din: '07654321', name: 'Arun Rao', designation: 'Director', date: '30/09/2026' },
    { din: '09876543', name: 'Kiran Rao', designation: 'Director', date: '30/09/2026' }],
  costRecords: { MAINTENANCE_MANDATED: 'No', AUDIT_MANDATED: 'No' },
  principalProducts: { HIGHEST_DESC: 'Human resources management consulting services' },
  balanceSheet: {
    current: { SHARE_CAPITAL: 100000, RESERVES_SURPLUS: -1462000, LONG_TERM_BORROWINGS: 1406500, SHORT_TERM_BORROWINGS: 0,
      SHORT_TERM_PROVISIONS: 30000, OTHER_CURRENT_LIAB: 781500, NON_CURRENT_INVESTMENTS: 0, CURRENT_INVESTMENTS: 0,
      LONG_TERM_LOANS_ADVANCES: 0, SHORT_TERM_LOANS_ADVANCES: 120000, TOTAL_ASSETS: 856000 },
    previous: { SHARE_CAPITAL: 100000, RESERVES_SURPLUS: -987700 },
  },
  balanceSheetBreakup: { BS_UNSEC_LT_RELATED_PARTIES: { current: 1406500, previous: 1331500 }, BS_UNSEC_LT_BANK_LOANS: { current: 0, previous: 0 },
    BS_LT_LOANS_GOOD_RELATED_PARTIES: { current: 0, previous: 0 } },
  profitLoss: {
    current: { REVENUE_OPERATIONS: 1537800, OTHER_INCOME: 10300, TOTAL_INCOME: 1548100, EMPLOYEE_EXPENSES: 1392500, DEPRECIATION: 26300,
      OTHER_EXPENSES: 603500, PROFIT_BEFORE_TAX: -474200, PROFIT_AFTER_TAX: -474200, EPS_BASIC: -47.42 },
    previous: { REVENUE_OPERATIONS: 2315800, PROFIT_AFTER_TAX: -177462 },
  },
};

test('Demo with no answers: small company Yes, s.186 No/No, defaults filled', () => {
  const { values, missing, notes } = FORM.buildData(sampleCo, {});
  assert.equal(values.SMALL_CO, 'Yes');
  assert.equal(values.S186_GIVEN, 'No');
  assert.equal(values.S186_REPORTABLE, 'No');
  assert.match(values.S186_DETAILS, /not given any loan or guarantee/); // 9(d): MCA requires why it is not reportable
  assert.equal(values.WEBSITE, '');
  assert.equal(values.DIRECTOR_CHANGES, 'None');
  assert.equal(values.CM_COUNT, '0');
  assert.equal(values.EMP_TRANSGENDER, '0');
  assert.equal(values.DECL_RES_DATE, '30/09/2026');
  assert.equal(values.DECL_ROLE, 'Director');
  assert.equal(values.DECL_DIN, '07654321');
  assert.equal(values.ID_DECL, 'Not applicable');
  assert.equal(values.S178, 'Not applicable');
  assert.equal(values.FRAUDS, 'Nil');
  assert.match(values.COST_RECORDS, /^Not applicable/);
  assert.match(values.FOREX, /earnings: Nil.*outgo: Nil/);
  const keys = missing.map(m => m.key);
  for (const k of ['BOARD_MEETINGS', 'EMP_FEMALE', 'EMP_MALE', 'BOARD_RESOLUTION_NO', 'RPT_COUNT', 'DIRECTOR_LOAN_DECLARATION', 'MATERIAL_CHANGES']) assert.ok(keys.includes(k), k + ' asked');
  assert.equal(missing.find(m => m.key === 'BOARD_MEETINGS').type, 'textarea');
  assert.match(missing.find(m => m.key === 'BOARD_MEETINGS').hint, /DD\/MM\/YYYY \| total directors \| directors attended/);
  assert.ok(notes.some(n => /Rule 2\(1\)\(c\)\(viii\)/.test(n) && /14,06,500/.test(n)));
  assert.equal(values.DEPOSIT_1, undefined);                         // no deposit claim before the declaration is confirmed
  assert.equal(values.MATERIAL_CHANGES, 'None');
  assert.equal(missing.find(m => m.key === 'POSH_STATEMENT').optional, true);   // never blocks, even with unknown counts
  assert.equal(values.MATERNITY, undefined);                         // no claim while the employee counts are unknown
  assert.equal(values.RPT_COUNT, undefined);
  assert.ok(!missing.find(m => m.key === 'RPT_COUNT').optional);
  assert.match(values.RISK, /negative net worth of Rs\. 13,62,000/);
  assert.doesNotMatch(values.RISK, /No risk/);
});

test('state of affairs names revenue 15,37,800 and loss 4,74,200 in plain words', () => {
  const { values } = FORM.buildData(sampleCo, {});
  assert.match(values.STATE_OF_AFFAIRS, /15,37,800/);
  assert.match(values.STATE_OF_AFFAIRS, /23,15,800/);
  assert.match(values.STATE_OF_AFFAIRS, /a loss of Rs\. 4,74,200/);
  assert.match(values.STATE_OF_AFFAIRS, /human resources management consulting/);
  assert.ok(values.STATE_OF_AFFAIRS.length < 400);
  assert.match(values.FIN_SUMMARY, /loss per share Rs\. 47\.42/);
  assert.doesNotMatch(values.FIN_SUMMARY, /-/);
  assert.match(values.DRS, /loss for the year/);
  assert.doesNotMatch(values.DRS, /internal financial controls/);   // IFC point only for listed companies
});

test('deposits, reserves, dividend, POSH counts are all Nil/0 once the director declaration is confirmed', () => {
  const { values, notes } = FORM.buildData(sampleCo, { DIRECTOR_LOAN_DECLARATION: 'Yes', RPT_COUNT: '2' });
  for (let i = 1; i <= 9; i++) assert.equal(values['DEPOSIT_' + i], '0');
  assert.equal(values.RESERVES_AMT, '0'); assert.equal(values.DIVIDEND_AMT, '0');
  assert.equal(values.POSH_RECEIVED, '0'); assert.equal(values.POSH_DISPOSED, '0'); assert.equal(values.POSH_PENDING90, '0');
  assert.equal(values.OTHER_MATTERS, '0'); assert.equal(values.RPT_COUNT, '2');
  // Proviso to Rule 2(1)(c)(viii): money from directors is disclosed in the Board's report.
  assert.match(values.STATE_OF_AFFAIRS, /loans from directors stood at Rs\. 14,06,500 \(previous year Rs\. 13,31,500\)/);
  assert.match(values.STATE_OF_AFFAIRS, /not a deposit/);
  assert.ok(notes.some(n => /declaration given/.test(n)));
  const no = FORM.buildData(sampleCo, { DIRECTOR_LOAN_DECLARATION: 'No' });
  assert.equal(no.values.DEPOSIT_1, undefined);
  assert.doesNotMatch(no.values.STATE_OF_AFFAIRS, /deposit/);
  assert.ok(no.notes.some(n => /may be a deposit/.test(n)));
  assert.ok(!no.missing.some(m => m.key === 'DIRECTOR_LOAN_DECLARATION'));
  // No breakup → total long-term borrowings are NOT assumed to be from directors.
  const nb = structuredClone(sampleCo); delete nb.balanceSheetBreakup.BS_UNSEC_LT_RELATED_PARTIES;
  const r = FORM.buildData(nb, {});
  assert.equal(r.values.DEPOSIT_1, '0');
  assert.ok(!r.missing.some(m => m.key === 'DIRECTOR_LOAN_DECLARATION'));
  assert.ok(!r.notes.some(n => /from directors/.test(n)));
});

test('answered: meetings, employees, POSH default by count; nothing required left', () => {
  const answers = { BOARD_RESOLUTION_NO: 'BR/03/2026', DECL_DESIGNATION: 'Director', DECL_DIN: '07654321',
    BOARD_MEETINGS: '15/12/2025 | 3 | 3\n30/06/2025 | 3 | 2', EMP_FEMALE: '2', EMP_MALE: '3', WEBSITE: '', DIRECTOR_CHANGES: 'None', RPT_COUNT: '2', DIRECTOR_LOAN_DECLARATION: 'Yes' };
  const { values, missing } = FORM.buildData(sampleCo, answers);
  assert.equal(values.BM_COUNT, '2');
  assert.deepEqual(values.MEETINGS.map(m => m.date), ['30/06/2025', '15/12/2025']);   // sorted by date
  assert.equal(values.MEETINGS[0].pct, '67');
  assert.equal(values.MEETINGS[1].pct, '100');
  assert.match(values.POSH_STATEMENT, /fewer than 10 employees/);
  assert.match(values.MATERNITY, /fewer than 10 employees/);   // the Act applies from 10 employees
  assert.equal(values.DECL_RES_NO, 'BR/03/2026');
  assert.deepEqual(missing.filter(m => !m.optional).map(m => m.key), []);
  const big = FORM.buildData(sampleCo, { ...answers, EMP_FEMALE: 4, EMP_MALE: 8 }).values;
  assert.match(big.POSH_STATEMENT, /Internal Complaints Committee under the POSH Act/);
  assert.doesNotMatch(big.POSH_STATEMENT, /not required/);
  assert.match(big.MATERNITY, /complied with the Maternity Benefit Act/);
  assert.match(FORM.buildData(sampleCo, { ...answers, EMP_FEMALE: 0, EMP_MALE: 12 }).values.MATERNITY, /no women employees/);
});

test('parseMeetings: JSON array, % rounding, bad lines reported', () => {
  const j = parseMeetings(JSON.stringify([{ date: '2025-08-10', total: 3, attended: 2 }]));
  assert.deepEqual(j.rows, [{ date: '10/08/2025', total: 3, attended: 2, pct: '67' }]);
  assert.equal(parseMeetings([{ date: '01/01/2026', total: 7, attended: 5 }]).rows[0].pct, '71');
  const bad = parseMeetings('31/02/2026 | 3 | 3\n01/03/2026 | 3 | 4\n01/03/2026 | 3 | 3');
  assert.equal(bad.rows.length, 1);
  assert.equal(bad.errors.length, 2);
  const { missing } = FORM.buildData(sampleCo, { BOARD_MEETINGS: '01/03/2026 | 3 | 4' });
  assert.ok(missing.find(m => m.key === 'BOARD_MEETINGS').errors.length);
});

test('small company / s.186 flip with the facts', () => {
  // s.2(85)(ii): the preceding year's turnover decides, not this year's.
  const big = structuredClone(sampleCo); big.profitLoss.previous.REVENUE_OPERATIONS = 101e7;   // above the Rs. 100 crore limit (G.S.R. 880(E), FY ending on or after 01-12-2025)
  assert.equal(FORM.buildData(big, {}).values.SMALL_CO, 'No');
  const grew = structuredClone(sampleCo); grew.profitLoss.current.REVENUE_OPERATIONS = 101e7;
  const gy = FORM.buildData(grew, {});
  assert.equal(gy.values.SMALL_CO, 'Yes');
  assert.ok(gy.notes.some(n => /previous-year turnover Rs\. 23,15,800/.test(n)));
  const noPrev = structuredClone(sampleCo); delete noPrev.profitLoss.previous.REVENUE_OPERATIONS;
  assert.ok(FORM.buildData(noPrev, {}).notes.some(n => /previous-year figure missing, current used, check/.test(n)));
  const sub = structuredClone(sampleCo); sub.subsidiary.IS_SUBSIDIARY = 'Yes';
  assert.equal(FORM.buildData(sub, {}).values.SMALL_CO, 'No');
  const inv = structuredClone(sampleCo); inv.balanceSheet.current.NON_CURRENT_INVESTMENTS = 50000;
  const r = FORM.buildData(inv, {});
  assert.equal(r.values.S186_GIVEN, 'Yes'); assert.equal(r.values.S186_REPORTABLE, 'Yes');
  assert.ok(r.missing.some(m => m.key === 'S186_DETAILS'));
  // 9(b) is asked when 9(a) is Yes, filled as a radio once answered, and never emitted for No.
  assert.deepEqual(r.missing.find(m => m.key === 'S186_B').options, ['Yes', 'No']);
  const r2 = FORM.buildData(inv, { S186_B: 'No', S186_DETAILS: 'Investment in X Ltd Rs. 50,000' });
  assert.equal(r2.values.S186_B, 'No');
  const j = FORM.jobs(r2.values);
  const b = j.find(x => x.id === 'EB_S186_B');
  assert.equal(b.kind, 'radio'); assert.equal(b.selector, FORM.SEL.S186_B);
  assert.ok(j.findIndex(x => x.id === 'EB_S186_GIVEN') < j.indexOf(b) && j.indexOf(b) < j.findIndex(x => x.id === 'EB_S186_REPORTABLE'));
  assert.equal(FORM.buildData(sampleCo, { S186_B: 'Yes' }).values.S186_B, undefined);
});

test('jobs: meeting rows by index with %, radios first, declaration last, no Submit target', () => {
  const { values } = FORM.buildData(sampleCo, { BOARD_RESOLUTION_NO: 'BR/03/2026', EMP_FEMALE: 2, EMP_MALE: 3,
    BOARD_MEETINGS: [{ date: '30/06/2025', total: 3, attended: 2 }, { date: '15/12/2025', total: 3, attended: 3 }] });
  const js = FORM.jobs(values);
  const by = id => js.find(j => j.id === id);
  assert.equal(by('EB_WEBSITE'), undefined);                          // empty website → no job
  assert.equal(by('EB_SMALL_CO').kind, 'radio'); assert.equal(by('EB_SMALL_CO').value, 'Yes');
  assert.equal(by('EB_BM_COUNT').value, '2');
  assert.equal(by('EB_BM_DATE_1').index, 0); assert.equal(by('EB_BM_DATE_1').kind, 'date');
  assert.equal(by('EB_BM_DATE_2').index, 1); assert.equal(by('EB_BM_DATE_2').value, '15/12/2025');
  assert.equal(by('EB_BM_PCT_1').value, '67'); assert.equal(by('EB_BM_PCT_2').value, '100');
  assert.equal(by('EB_BM_PCT_1').selector, by('EB_BM_PCT_2').selector);
  assert.equal(by('EB_CM_COUNT').value, '0');
  assert.equal(by('EB_S186_GIVEN').value, 'No'); assert.equal(by('EB_S186_REPORTABLE').value, 'No');
  assert.equal(by('EB_S186_B'), undefined);
  assert.equal(by('EB_DECL_ROLE').kind, 'select'); assert.equal(by('EB_DECL_ROLE').value, 'Director');
  assert.equal(js[js.length - 1].id, 'EB_DECL_DIN');
  assert.ok(js.findIndex(j => j.id === 'EB_BM_COUNT') < js.findIndex(j => j.id === 'EB_BM_DATE_1'));
  for (const j of js) {
    assert.ok(j.selector && /___jqName"\]$/.test(j.selector), j.id + ' has a field selector');
    assert.doesNotMatch(j.selector + ' ' + j.value, /submit/i);
    assert.ok(['text', 'number', 'date', 'radio', 'select'].includes(j.kind));
    assert.equal(typeof j.index, 'number');
  }
  assert.equal(new Set(js.map(j => j.id)).size, js.length, 'job ids unique');
  assert.ok(js.every(j => !/button/i.test(j.selector) || j.kind === 'radio'));
});

test('state-of-affairs and DRS selectors do not overlap', () => {
  const S = FORM.SEL;
  const name = tail => 'guideContainer-rootPanel-' + tail + '___jqName';
  const ends = (sel, n) => n.endsWith(sel.match(/\$="([^"]+)"/)[1]);
  const soa = name('panel_1665650438-panel_526419145-panel-panel-panel-guidetextbox');
  const drs = name('panel_1665650438-panel_526419145-panel-panel-panel-panel-guidetextbox');
  assert.ok(ends(S.STATE_OF_AFFAIRS, soa) && !ends(S.STATE_OF_AFFAIRS, drs));
  assert.ok(ends(S.DRS, drs) && !ends(S.DRS, soa));
  const committee = 'guideContainer-rootPanel-x-table_47856561_copy__197747959-Row1642490503674-tableItem1642490503676___jqName';
  assert.ok(!committee.includes('table_47856561_copy_-Row1642490503674'));
});

test('form contract: never moves past Save; pre step clicks nothing', () => {
  assert.equal(FORM.id, 'eboard'); assert.equal(FORM.answersForm, 'eboard');
  assert.equal(FORM.nextButton, null);
  assert.ok(FORM.urlRe.test('https://www.mca.gov.in/content/mca/global/en/mca/e-filing/annual-filings/form-extract-of-boards-report.html'));
  assert.equal(FORM.pre.length, 1);
  assert.deepEqual(FORM.pre[0].args({ MEETINGS: [{}, {}, {}] }), [3]);
  const src = FORM.pre[0].func.toString();
  assert.doesNotMatch(src, /\.click\(|submit/i);
  assert.equal(fmtINR(1537800), '15,37,800'); assert.equal(fmtINR(-474200), '-4,74,200'); assert.equal(fmtINR(999), '999');
  assert.equal(fmtINR(14062000), '1,40,62,000');
});

// Simulates the side panel: lfCollectMissing on what the boxes show (defaults prefilled), then rebuild.
function round(answers, typed) {
  const { missing } = FORM.buildData(sampleCo, answers);
  const raw = Object.fromEntries(missing.map(m => [m.key, m.key in typed ? typed[m.key] : (m.default ?? '')]));
  const got = lfCollectMissing(missing, raw, 'eboard');
  const next = { ...answers, ...got.answers };
  return { got, next, built: FORM.buildData(sampleCo, next) };
}
const firstRun = { BOARD_MEETINGS: '15/05/2025 | 2 | 2\n10/08/2025 | 2 | 2', EMP_FEMALE: '1', EMP_MALE: '4', BOARD_RESOLUTION_NO: 'BR/03/2026',
  RPT_COUNT: '2', DIRECTOR_LOAN_DECLARATION: 'Yes' };

test('round trip: POSH left empty on first run uses the default and is not asked again', () => {
  const r1 = round({}, firstRun);
  assert.deepEqual(r1.got.errors, []);
  assert.match(r1.built.values.POSH_STATEMENT, /fewer than 10 employees/);
  assert.deepEqual(r1.built.missing.filter(m => !m.optional).map(m => m.key), []);
  assert.ok(!r1.built.missing.some(m => m.key === 'POSH_STATEMENT'));
  // Second Run: nothing comes back.
  const r2 = round(r1.next, {});
  assert.deepEqual(r2.got.errors, []);
  assert.deepEqual(r2.built.missing.map(m => m.key), []);
});

test('round trip: a cleared EMP_TRANSGENDER box falls back to 0 and stops being asked', () => {
  const r1 = round({}, { ...firstRun, EMP_TRANSGENDER: '' });
  assert.equal(r1.next.EMP_TRANSGENDER, '');
  assert.equal(r1.built.values.EMP_TRANSGENDER, '0');
  assert.ok(!r1.built.missing.some(m => m.key === 'EMP_TRANSGENDER'));
  assert.match(r1.built.values.POSH_STATEMENT, /fewer than 10/);
  const bad = FORM.buildData(sampleCo, { EMP_TRANSGENDER: 'x' });
  assert.ok(bad.missing.some(m => m.key === 'EMP_TRANSGENDER'));
});

test('round trip: board meetings saved as a JSON array of {date,total,attended}; bad lines rejected at collection', () => {
  const r1 = round({}, firstRun);
  assert.deepEqual(JSON.parse(r1.next.BOARD_MEETINGS), [{ date: '15/05/2025', total: 2, attended: 2 }, { date: '10/08/2025', total: 2, attended: 2 }]);
  assert.equal(r1.built.values.BM_COUNT, '2');
  const bad = round({}, { ...firstRun, BOARD_MEETINGS: '15/05/2025 | 2 | 3' });
  assert.ok(bad.got.errors.some(e => /Board meetings held during the year: Meeting 1/.test(e)));
});

test('s.173 gap checks: small company under 90 days, other company over 120 days', () => {
  const close = FORM.buildData(sampleCo, { BOARD_MEETINGS: '15/05/2025 | 2 | 2\n10/06/2025 | 2 | 2' });
  assert.ok(close.notes.some(n => /173\(5\).*90 days/.test(n)));
  const fine = FORM.buildData(sampleCo, { BOARD_MEETINGS: '15/05/2025 | 2 | 2\n10/12/2025 | 2 | 2' });
  assert.ok(!fine.notes.some(n => /90 days between/.test(n)));
  const pub = structuredClone(sampleCo); pub.general.CIN = 'U01100KA2019PLC000001';
  const far = FORM.buildData(pub, { BOARD_MEETINGS: '15/04/2025|3|3\n15/06/2025|3|3\n15/11/2025|3|3\n15/01/2026|3|3' });
  assert.ok(far.notes.some(n => /173\(1\).*120 days/.test(n)));
});

test('RPT_COUNT: AOC-2 rows or "no RPT" give an optional default; blank answer keeps the default', () => {
  const two = FORM.buildData(sampleCo, { ROWS: JSON.stringify([{}, {}]) });
  assert.equal(two.values.RPT_COUNT, '2');
  assert.equal(two.missing.find(m => m.key === 'RPT_COUNT').optional, true);
  const none = structuredClone(sampleCo); none.relatedParty = { ANY_TRANSACTION: 'No' };
  const n = FORM.buildData(none, { RPT_COUNT: '' });
  assert.equal(n.values.RPT_COUNT, '0');
  assert.ok(!n.missing.some(m => m.key === 'RPT_COUNT'));
  assert.equal(FORM.buildData(sampleCo, { RPT_COUNT: '' }).missing.find(m => m.key === 'RPT_COUNT').optional, undefined);
});

test('material changes: answer used, blank means None, positive net worth keeps the plain risk line', () => {
  assert.equal(FORM.buildData(sampleCo, { MATERIAL_CHANGES: '  ' }).values.MATERIAL_CHANGES, 'None');
  assert.equal(FORM.buildData(sampleCo, { MATERIAL_CHANGES: 'New office leased' }).values.MATERIAL_CHANGES, 'New office leased');
  assert.ok(!FORM.buildData(sampleCo, { MATERIAL_CHANGES: '' }).missing.some(m => m.key === 'MATERIAL_CHANGES'));
  const ok = structuredClone(sampleCo); ok.balanceSheet.current.RESERVES_SURPLUS = 50000;
  assert.match(FORM.buildData(ok, {}).values.RISK, /No risk is seen/);
});

test('review fixes: DIN padding, s.188 hint, confirmable defaults, RISK wording', () => {
  const r = FORM.buildData(sampleCo, { DECL_DIN: '7654321' });
  assert.equal(r.values.DECL_DIN, '07654321');
  const hint = (r.missing.find(m => m.key === 'RPT_COUNT') || {}).hint || '';
  assert.ok(!/Count director salary/.test(hint));
  for (const k of ['FRAUDS', 'IBC', 'NATURE_CHANGE', 'ORDERS']) assert.ok(r.missing.some(m => m.key === k && m.optional), k);
  const noLoan = structuredClone(sampleCo); delete noLoan.balanceSheetBreakup.BS_UNSEC_LT_RELATED_PARTIES;
  assert.ok(!/funding from its directors/.test(FORM.buildData(noLoan, {}).values.RISK || ''));
  assert.deepEqual(FORM.extraAnswers, ['aoc2']);
  assert.equal(FORM.buildData(sampleCo, { ROWS: '[{"a":1},{"a":2}]' }).values.RPT_COUNT, '2');
});

test('reserves / dividend: amount is filled before its description (MCA clears the description when the amount changes)', () => {
  const ids = FORM.jobs(FORM.buildData(sampleCo, {}).values).map(j => j.id);
  assert.ok(ids.indexOf('EB_RESERVES_AMT') < ids.indexOf('EB_RESERVES_DESC'));
  assert.ok(ids.indexOf('EB_DIVIDEND_AMT') < ids.indexOf('EB_DIVIDEND_DESC'));
});

test('saved answers win for the Board\'s-report text boxes (verbatim report text), numbers stay calculated', () => {
  const verbatim = {
    DRS: 'Pursuant to section 134(5) the Board confirms that- (a) standards were followed; (b) going concern.',
    STATE_OF_AFFAIRS: 'The Company sold demo widgets during the year.', RISK: 'The Board reviews risks every quarter.',
    TECH: 'No technology was absorbed.', ENERGY: 'The Company uses energy carefully.', FOREX: 'Particulars | Amount (Rs.) Earnings | Nil Outgo | Nil',
    IFC: 'The Company has adequate internal financial controls.', COST_RECORDS: 'Cost records are not applicable.',
    IBC: 'No application was made under the Code.', NATURE_CHANGE: 'There was no change in the nature of business.',
    MATERIAL_CHANGES: 'No material changes occurred.', FRAUDS: 'No fraud was reported.', RESERVES_DESC: 'No amount was transferred to reserves.',
    DIVIDEND_DESC: 'No dividend is recommended.', FIN_SUMMARY: 'Particulars | 2026 | 2025 Total Revenue | 1,200 | 900',
    DIRECTOR_CHANGES: 'MEERA DEMO was appointed on 12/08/2025.', ORDERS: 'No orders were passed.',
    RESERVES_AMT: '999', DEPOSIT_1: '5', POSH_RECEIVED: '3',
  };
  const { values, missing } = FORM.buildData(sampleCo, verbatim);
  for (const k of Object.keys(verbatim).filter(k => !/_AMT$|^DEPOSIT_|^POSH_RECEIVED$/.test(k))) assert.equal(values[k], verbatim[k], k);
  assert.equal(values.RESERVES_AMT, '0');
  assert.equal(values.POSH_RECEIVED, '0');
  for (const k of ['MATERIAL_CHANGES', 'FRAUDS', 'IBC', 'NATURE_CHANGE', 'ORDERS', 'DIRECTOR_CHANGES', 'STATE_OF_AFFAIRS']) assert.ok(!missing.some(m => m.key === k), k);
  // A blank saved answer keeps the built text.
  assert.match(FORM.buildData(sampleCo, { RISK: '  ' }).values.RISK, /negative net worth/);
  const jobs = FORM.jobs(values);
  assert.equal(jobs.find(j => j.id === 'EB_DRS').value, verbatim.DRS);
  assert.equal(jobs.find(j => j.id === 'EB_TECH').value, verbatim.TECH);
});
