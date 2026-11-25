// node --test extension/tests/linked-eauditor.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const FORM = require('../js/linked/eauditor.js');

// Section 2 of the linked-forms spec (Auditor's report extract), copied verbatim. When the spec file is
// available (SPEC_PATH or the scratchpad copy) the test also checks this copy still matches it.
const SPEC2 = `## 2. Auditor's report extract (url .../extract-of-auditor-standalone.html)  prefix Q = \`panel_1665650438-panel_526419145-\`
- opinion (a) textarea   \`Q panel_1480276982_cop-panel_1860351946_cop_160345464-panel_copy_copy_copy-panel-guidetextbox\`
- basis (b) textarea     \`... -panel_copy_copy_copy-panel-guidetextbox_2122660506\`
- emphasis (c) textarea  \`... -panel_copy_copy_copy-panel-guidetextbox_1787558811\`
- KAM (d) input          \`... -panel_copy_copy_copy-panel-panel-guidetextbox_9895278\`
- other info (e) input   \`... -panel_copy_copy_copy-panel-panel_539753119-guidetextbox_8465383\`
- 2 number of qualifications \`Q panel-panel-panel-panel-panel_copy_copy_copy-panel-panel_1950235866_cop-guidetextbox_copy_co\`
  remarks table row1: \`...panel_1950235866_cop-table_copy_copy_copy_1546127571-Row1-tableItem1\` (select Qualification/Reservation/Adverse remarks/Disclaimer),
  \`...-Row1-headerItem1623401255929\` (comment). Only when count > 0.
- 3 management resp. textarea \`Q panel-panel-panel-panel_1480276982_cop-panel-guidetextbox\`
- 4 auditor resp. textarea    \`Q panel-panel-panel-panel_1480276982_cop_214140827-panel-guidetextbox\`
- prefix O = \`Q panel-panel-panel-panel_1480276982_cop_1904032734-panel-\`
- 5(a) Rule 11 matters textarea \`O guidetextbox_copy\` ; 5(b) any other \`O guidetextbox\` ; 6(a) other legal & reg \`O guidetextbox_1829933\`
- 6(b) CARO applicable radio group \`O guideradiobutton\` (options aria-label "Yes"/"No")
- 6(c) CARO table (enabled only when 6(b)=Yes): rows in order, each = [select tail, textarea tail] under \`O table-\`:
  1 PPE & intangibles: Row1-tableItem1 / Row1-headerItem1659942540127
  2 Inventories: Row2-tableItem1 / Row2-headerItem1659942541636
  3 Loans given: Row1659943254965-tableItem1659943254967 / -tableItem1659943254968
  4 Loan to directors & investment: Row1659943422043-tableItem1659943422045 / ...046
  5 Public deposits: Row1659943437633-tableItem1659943437635 / ...636
  6 Cost records: Row1659943452020-tableItem1659943452023 / ...024
  7 Statutory dues: Row1659943458764-tableItem1659943458766 / ...767
  8 Term loans: Row1659943465264-tableItem1659943465266 / ...267
  9 Utilisation of funds: Row1659943472058-tableItem1659943472060 / ...061
  10 Fraud: Row1659943479150-tableItem1659943479152 / ...153
  11 Unrecorded income: Row1659943486694-tableItem1659943486696 / ...697
  12 Nidhi: Row1659943756869-tableItem1659943756871 / ...872
  13 Related party: Row1659943763944-tableItem1659943763946 / ...947
  14 Private placement: Row1659943770573-tableItem1659943770575 / ...576
  15 Non-cash: Row1659943777908-tableItem1659943777910 / ...911
  16 RBI registration: Row1659943787641-tableItem1659943787643 / ...644
  17 Internal audit: Row1719821181132-tableItem1719821181134 / ...135
  18 Cash losses: Row1719821172680-tableItem1719821172682 / ...683
  19 Auditor resignation: Row1719821166274-tableItem1719821166276 / ...277
  20 Material uncertainty: Row1719821126612-tableItem1719821126614 / ...615
  21 Unspent CSR: Row1719817952613-tableItem1719817952615 / ...616
  select options: Favourable Remark | Unfavourable remark | Disclaimer remark | Clause not applicable
- 6(d) IFC textarea \`O guidetextbox_1998545194\`
- attachment widget \`Q panel-panel-panel-panel_1480276982_cop_669852452-panel-panel_copy_copy_copy-panel_copy-mca_custom_file_uplo\` (skip)
- declaration prefix S = \`Q panel-panel-panel-panel_1480276982_cop_1955144168-panel-panel_copy-panel_268085455_copy-\`:
  Name \`S guidetextbox\` (READ-ONLY, auto from DIN), designation select \`S guidedropdownlist_66\` (Select/Director/IRP...), DIN \`S guidetextbox_copy\`.`;

const SPEC_FILE = process.env.SPEC_PATH
  || 'C:/Users/sumit/AppData/Local/Temp/claude/8769bfa91350c851/a5dd205d-4b81-4b38-8d07-b37c2bc748b7/scratchpad/linked-spec.md';

// Demo Terra Technology Private Limited, FY 2025-26 (real figures, rupees).
const sampleCo = () => ({
  general: { CIN: 'U01100KA2019PTC000001', COMPANY_NAME: 'Demo Terra Technology Private Limited', FY_FROM: '01/04/2025', FY_TO: '31/03/2026',
    BOARD_MEETING_DATE: '30/09/2026', BOARD_REPORT_DATE: '30/09/2026', AUDITOR_SIGN_DATE: '30/09/2026', AGM_HELD: 'Yes', AGM_DATE: '30/09/2026' },
  signatoriesFS: [
    { din: '07654321', name: 'Arun Rao', designation: 'Director', date: '30/09/2026' },
    { din: '09876543', name: 'Kiran Rao', designation: 'Director', date: '30/09/2026' },
  ],
  auditor: { AUDITOR_NAME: 'Demo Audit & Co', AUDITOR_FIRM_REG: '000000S', MEMBER_NAME: 'Demo Member', MEMBER_NUMBER: '700001', UDIN: '26123456ABCDEF1234' },
  auditorReport: { QUALIFIED_OPINION: 'No', CAG_COMMENTED: 'Not applicable' },
  relatedParty: { ANY_TRANSACTION: 'Yes' }, csr: { CSR_APPLICABILITY: 'No' },
  costRecords: { MAINTENANCE_MANDATED: 'No', AUDIT_MANDATED: 'No' },
  subsidiary: { IS_SUBSIDIARY: 'No', HAS_SUBSIDIARY_OR_JV: 'No' },
  balanceSheet: {
    current: { SHARE_CAPITAL: 100000, RESERVES_SURPLUS: -1462000, LONG_TERM_BORROWINGS: 1406500, SHORT_TERM_BORROWINGS: 0,
      SHORT_TERM_PROVISIONS: 30000, OTHER_CURRENT_LIAB: 781500, NON_CURRENT_INVESTMENTS: 0, CURRENT_INVESTMENTS: 0, INVENTORIES: 0, TOTAL_ASSETS: 856000 },
    previous: { SHARE_CAPITAL: 100000, RESERVES_SURPLUS: -987700 },
  },
  balanceSheetBreakup: { BS_UNSEC_LT_BANK_LOANS: { current: 0, previous: 0 }, BS_UNSEC_LT_RELATED_PARTIES: { current: 1406500, previous: 1331500 } },
  profitLoss: {
    current: { REVENUE_OPERATIONS: 1537800, OTHER_INCOME: 10300, TOTAL_INCOME: 1548100, EMPLOYEE_EXPENSES: 1392500, DEPRECIATION: 26300,
      OTHER_EXPENSES: 603500, PROFIT_AFTER_TAX: -474200, EPS_BASIC: -47.42 },
    previous: { REVENUE_OPERATIONS: 2315800, PROFIT_AFTER_TAX: -177462 },
  },
  principalProducts: { CATEGORY_DESC: 'Human resources management consulting services' },
});

const nameTail = j => (j.selector.match(/\[name\$="([^"]+)___jqName"\]/) || [])[1];

test('spec copy in this test matches the spec file (when present)', t => {
  if (!existsSync(SPEC_FILE)) return t.skip('spec file not available');
  assert.ok(readFileSync(SPEC_FILE, 'utf8').replace(/\r\n/g, '\n').includes(SPEC2));
});

// What the CA copies from Demo's signed report (Rule 11 (i)-(iii) per the report; the rest confirmed).
const sampleCoReport = () => ({
  RULE11: '(i) No pending litigation. (ii) No long-term contracts with material foreseeable losses. (iii) No IEPF transfer due.',
  EMPHASIS: 'Nil', OTHER_INFO: "The other information is the Board's report. We have read it and have nothing to report.", OTHER_5B: 'None',
});

test('Demo: CARO not applicable (small company), unmodified opinion values', () => {
  const { values, missing, notes } = FORM.buildData(sampleCo(), sampleCoReport());
  assert.equal(values.CARO, 'No');
  assert.equal(values.QUAL_COUNT, '0');
  assert.equal(values.EMPHASIS, 'Nil');
  assert.equal(values.KAM, 'Not applicable');
  assert.match(values.OPINION, /Demo Terra Technology Private Limited/);
  assert.match(values.OPINION, /\bloss\b/);
  assert.match(values.OPINION, /31\/03\/2026/);
  assert.doesNotMatch(values.OPINION, /\bprofit\b/);
  assert.match(values.RULE11, /litigation/i);
  assert.match(values.IFC, /G\.S\.R\. 583\(E\)/);
  assert.match(values.IFC, /exempt/i);
  assert.match(values.LEGAL_6A, /164\(2\)/);
  assert.match(values.LEGAL_6A, /197/);
  assert.equal(values.DECL_DESIGNATION, 'Director');
  assert.equal(values.DECL_DIN, '07654321');
  assert.deepEqual(missing, [], 'nothing more to ask once the report facts are saved');
  const n = notes.join(' ');
  assert.match(n, /CARO 2020 not applicable \(para 1\(2\)\(iv\)\): small company/);
  assert.match(n, /₹23,15,800/);                      // previous-year turnover is the test figure
  assert.match(n, /6\(a\) is the standard s\.143\(3\) wording/);
  for (const [k, v] of Object.entries(values)) assert.ok(String(v).length <= 600, `${k} is ${String(v).length} chars`);
});

test('Demo with no saved answers: report-only facts are asked, never assumed', () => {
  const { values, missing } = FORM.buildData(sampleCo(), {});
  for (const k of ['RULE11', 'EMPHASIS', 'OTHER_INFO', 'OTHER_5B']) assert.equal(values[k], undefined, `${k} was made up`);
  const m = Object.fromEntries(missing.map(x => [x.key, x]));
  assert.deepEqual(Object.keys(m).sort(), ['EMPHASIS', 'OTHER_5B', 'OTHER_INFO', 'RULE11']);
  assert.ok(!m.RULE11.optional && m.RULE11.default === undefined, 'Rule 11 must be typed by the CA');
  assert.match(m.RULE11.hint, /Rule 11\(e\)/); assert.match(m.RULE11.hint, /section 123/); assert.match(m.RULE11.hint, /Rule 11\(g\)/);
  // Net worth 1,00,000 - 14,62,000 < 0: no "Nil" pre-filled, going-concern warning shown.
  assert.equal(m.EMPHASIS.default, undefined);
  assert.match(m.EMPHASIS.hint, /Net worth is negative \(-₹13,62,000\).*going-concern/);
  assert.equal(m.OTHER_5B.default, 'None');
  // Positive net worth: "Nil" is offered as the editable default.
  const p = sampleCo(); p.balanceSheet.current.RESERVES_SURPLUS = 50000;
  assert.equal(FORM.buildData(p, {}).missing.find(x => x.key === 'EMPHASIS').default, 'Nil');
});

test('qualified opinion: 6(a) is asked with the standard wording as a hint, not filled', () => {
  const c = sampleCo(); c.auditorReport.QUALIFIED_OPINION = 'Yes';
  const { values, missing } = FORM.buildData(c, sampleCoReport());
  assert.equal(values.LEGAL_6A, undefined);
  const q = missing.find(m => m.key === 'LEGAL_6A');
  assert.ok(q && q.type === 'textarea');
  assert.match(q.hint, /164\(2\)/);
  assert.equal(FORM.buildData(c, { ...sampleCoReport(), LEGAL_6A: 'as per report' }).values.LEGAL_6A, 'as per report');
});

test('Demo jobs: no CARO rows, no Name field, radio = No, Proceed is the next button', () => {
  const js = FORM.jobs(FORM.buildData(sampleCo(), sampleCoReport()).values);
  const T = FORM._internal.T;
  // Process status shows readable labels, never raw ids.
  assert.ok(js.every(j => j.label && j.label !== j.id), 'a job has no readable label');
  assert.equal(js.find(j => j.id === 'OTHER_5B').label, '5(b) Any other matter');
  assert.equal(js.find(j => j.id === 'CARO').waitForSelector, undefined, 'CARO=No must not wait for the table');
  assert.equal(FORM.nextButton, 'Proceed');
  assert.ok(js.every(j => nameTail(j) !== T.NAME), 'a job targets the read-only Name');
  assert.ok(!js.some(j => /^CARO_/.test(j.id)));
  assert.deepEqual(js.filter(j => j.kind === 'radio').map(j => [j.id, j.value]), [['CARO', 'No']]);
  assert.ok(js.findIndex(j => j.id === 'DECL_DESIGNATION') < js.findIndex(j => j.id === 'DECL_DIN'));
  assert.ok(js.find(j => j.id === 'DECL_DIN').typeChars);
  assert.ok(js.every(j => /^(text|radio|select)$/.test(j.kind) && j.index === 0 && j.value !== ''));
});

// Expand the spec's prefix letters so each backticked path can be checked as one string.
function expandedSpec() {
  const Q = 'panel_1665650438-panel_526419145-';
  const O = Q + 'panel-panel-panel-panel_1480276982_cop_1904032734-panel-';
  const S = Q + 'panel-panel-panel-panel_1480276982_cop_1955144168-panel-panel_copy-panel_268085455_copy-';
  // "`... -panel_copy_copy_copy-…" lines continue the opinion (a) path.
  const A = Q + 'panel_1480276982_cop-panel_1860351946_cop_160345464-';
  return SPEC2.replace(/`\.\.\. -/g, '`' + A).replace(/`Q /g, '`' + Q).replace(/`O /g, '`' + O).replace(/`S /g, '`' + S);
}

test('every job selector (Demo and a CARO=Yes, qualified case) is a path from the spec', () => {
  const spec = expandedSpec();
  const a = FORM.buildData(sampleCo(), sampleCoReport()).values;
  const caroYes = sampleCo();
  caroYes.auditorReport.QUALIFIED_OPINION = 'Yes';
  const b = FORM.buildData(caroYes, { ...sampleCoReport(), LEGAL_6A: 'x', CARO: 'Yes', QUAL_COUNT: '1', QUAL_TYPE_1: 'Qualification', QUAL_COMMENT_1: 'x', BASIS: 'x',
    ...Object.fromEntries(FORM._internal.CARO_ROWS.flatMap((_, i) => [[`CARO_${i + 1}`, 'Clause not applicable'], [`CARO_${i + 1}_DETAIL`, 'x']])) }).values;
  const all = [...FORM.jobs(a), ...FORM.jobs(b)];
  assert.equal(all.filter(j => /^CARO_\d+$/.test(j.id)).length, 21);
  for (const k of ['RULE11', 'EMPHASIS', 'OTHER_INFO', 'OTHER_5B', 'LEGAL_6A']) assert.ok(all.some(j => j.id === k), `${k} job missing`);
  // CARO=Yes: the radio waits for the 6(c) table (row 1 select) before the rows are filled.
  const radio = FORM.jobs(b).find(j => j.id === 'CARO');
  assert.equal(radio.waitForSelector, FORM.jobs(b).find(j => j.id === 'CARO_1').selector);
  for (const j of all) {
    const tail = nameTail(j);
    assert.ok(tail, `${j.id} has no [name$=...___jqName] selector`);
    const segs = tail.split('-');
    for (const s of segs) {
      const abbr = s.match(/^(tableItem|headerItem)(\d+)(\d{3})$/);
      assert.ok(spec.includes(s) || (abbr && spec.includes('...' + abbr[3])), `${j.id}: segment "${s}" not in spec`);
    }
    // The field's own last two segments must be written together in the spec (abbreviated detail cells excepted).
    const last2 = segs.slice(-2).join('-');
    const detail = /^CARO_\d+_DETAIL$/.test(j.id);
    assert.ok(spec.includes(last2) || detail, `${j.id}: "${last2}" not in spec`);
    if (!/^CARO_|^QUAL_/.test(j.id)) assert.ok(spec.includes(tail), `${j.id}: "${tail}" not a spec path`);
  }
});

test('CARO applies when a test fails, and every row is asked with the 4 options', () => {
  const c = sampleCo();
  c.balanceSheet.current.SHARE_CAPITAL = 150000000;  // ₹15 crore: not small (> ₹10 crore), capital + reserves > ₹1 crore
  c.csr.CSR_APPLICABILITY = 'Applicable';            // schema value: row 21 must not say "CSR not applicable"
  const { values, missing, notes } = FORM.buildData(c, {});
  assert.equal(missing.find(m => m.key === 'CARO_21').hint, undefined);
  assert.match(missing.find(m => m.key === 'CARO_2').hint, /No inventories/);
  assert.equal(values.CARO, 'Yes');
  assert.match(notes.join(' '), /CARO 2020 applies/);
  const rows = missing.filter(m => /^CARO_\d+$/.test(m.key));
  assert.equal(rows.length, 21);
  assert.ok(rows.every(m => m.type === 'select' && m.options.join('|') === 'Favourable Remark|Unfavourable remark|Disclaimer remark|Clause not applicable'));
  assert.equal(missing.filter(m => /_DETAIL$/.test(m.key) && m.optional).length, 21);
  // Rows with no answer produce no table jobs.
  assert.ok(!FORM.jobs(values).some(j => /^CARO_\d/.test(j.id)));
});

test('missing holding/subsidiary data or a public CIN makes CARO applicable; saved answer overrides', () => {
  const c = sampleCo(); delete c.subsidiary;
  assert.equal(FORM.buildData(c, {}).values.CARO, 'Yes');
  assert.equal(FORM.buildData(c, { CARO: 'No' }).values.CARO, 'No');
  const p = sampleCo(); p.general.CIN = 'U01100KA2019PLC000001';
  const r = FORM.buildData(p, {});
  assert.equal(r.values.CARO, 'Yes');
  assert.ok(r.missing.some(m => m.key === 'IFC'), 'public company is not IFC-exempt');
});

// A subsidiary of a private company: not a small company (para 1(2)(iv)), but can pass para 1(2)(v).
const privateSub = () => {
  const c = sampleCo();
  c.subsidiary = { IS_SUBSIDIARY: 'Yes', HOLDING_CIN: 'U72900KA2015PTC080000', HAS_SUBSIDIARY_OR_JV: 'No' };
  return c;
};

test('director loans over ₹1 crore are not bank borrowings', () => {
  const c = privateSub();
  assert.match(FORM.buildData(c, {}).notes.join(' '), /para 1\(2\)\(v\)\): private company; subsidiary of a private company/);
  c.balanceSheet.current.LONG_TERM_BORROWINGS = 30000000;
  c.balanceSheetBreakup.BS_UNSEC_LT_RELATED_PARTIES = { current: 30000000 };
  assert.equal(FORM.buildData(c, {}).values.CARO, 'No');
  c.balanceSheetBreakup.BS_UNSEC_LT_RELATED_PARTIES = { current: 10000000 };
  assert.equal(FORM.buildData(c, {}).values.CARO, 'Yes');
});

test('profit year says profit; saved eauditor answers override built text', () => {
  const c = sampleCo(); c.profitLoss.current.PROFIT_AFTER_TAX = 50000;
  const { values } = FORM.buildData(c, { EMPHASIS: 'Going concern note 2', DECL_DESIGNATION: 'Director', DECL_DIN: '09876543' });
  assert.match(values.OPINION, /of its profit/);
  assert.equal(values.EMPHASIS, 'Going concern note 2');
  assert.equal(values.DECL_DIN, '09876543');
});

test('a non-director AOC-4 signatory falls back to a director DIN; amounts parse Indian formats', () => {
  const { values } = FORM.buildData(sampleCo(), { DECL_DESIGNATION: 'Secretary', DECL_DIN: 'A12345' });
  assert.deepEqual([values.DECL_DESIGNATION, values.DECL_DIN], ['Director', '07654321']);
  const { num } = FORM._internal;
  assert.equal(num('14,06,500'), 1406500);
  assert.equal(num('(4,74,200)'), -474200);
  assert.equal(num('₹ -1,00,000'), -100000);
  assert.equal(num(''), null);
});

test('no borrowing data at all is "missing", so CARO applies (para 1(2)(v))', () => {
  const c = privateSub();
  delete c.balanceSheet.current.LONG_TERM_BORROWINGS; delete c.balanceSheet.current.SHORT_TERM_BORROWINGS; delete c.balanceSheetBreakup;
  const r = FORM.buildData(c, {});
  assert.equal(r.values.CARO, 'Yes');
  assert.match(r.notes.join(' '), /borrowings missing/);
});

test('small company limits: ₹10 cr / ₹100 cr for a year ending on/after 01-12-2025, else ₹4 cr / ₹40 cr', () => {
  const { caroTest } = FORM._internal;
  const c = sampleCo(); c.balanceSheet.current.SHARE_CAPITAL = 30000000;   // ₹3 crore: para (v) capital test fails
  assert.deepEqual([caroTest(c, {}).applies, caroTest(c, {}).para], [false, '1(2)(iv)']);
  c.balanceSheet.current.SHARE_CAPITAL = 50000000;                      // ₹5 crore
  assert.equal(caroTest(c, {}).applies, false, 'FY 2025-26: within ₹10 crore');
  c.general.FY_TO = '31/03/2025';
  assert.deepEqual([caroTest(c, {}).applies, caroTest(c, {}).para], [true, '1(2)(v)'], 'FY 2024-25: over ₹4 crore');
  const t = sampleCo(); t.profitLoss.previous.REVENUE_OPERATIONS = 1200000000;   // previous-year turnover ₹120 crore
  t.balanceSheet.current.SHARE_CAPITAL = 30000000;
  assert.equal(caroTest(t, {}).applies, true);
  const u = sampleCo(); delete u.profitLoss.previous;                    // turnover unknown → falls to para (v), still passes
  assert.deepEqual([caroTest(u, {}).applies, caroTest(u, {}).para], [false, '1(2)(v)']);
});

test('declaration DIN: a DECL_DIN answer is used when no director is in signatoriesFS (no endless ask)', () => {
  const c = { general: { CIN: 'U01100KA2019PTC000001' }, signatoriesFS: [{ din: '', designation: 'CFO' }] };
  const before = FORM.buildData(c, {});
  assert.ok(before.missing.some(m => m.key === 'DECL_DIN'));
  for (const answers of [{ DECL_DIN: '12345678' }, { DECL_DIN: '12345678', DECL_DESIGNATION: 'CFO' }]) {
    const { values, missing } = FORM.buildData(c, answers);
    assert.equal(values.DECL_DIN, '12345678');
    assert.ok(!missing.some(m => m.key === 'DECL_DIN'), `still asked with ${JSON.stringify(answers)}`);
  }
  // A saved DIN with no designation, or "Managing Director", is kept over the first signatoriesFS director.
  assert.equal(FORM.buildData(sampleCo(), { DECL_DIN: '09876543' }).values.DECL_DIN, '09876543');
  assert.equal(FORM.buildData(sampleCo(), { DECL_DESIGNATION: 'Managing Director', DECL_DIN: '09876543' }).values.DECL_DIN, '09876543');
});

test('a DIN that lost its leading zero is padded back', () => {
  const c = sampleCo(); c.signatoriesFS[0].din = 7654321;
  assert.equal(FORM.buildData(c, {}).values.DECL_DIN, '07654321');
  assert.equal(FORM.buildData(sampleCo(), { DECL_DIN: '7654321' }).values.DECL_DIN, '07654321');
  assert.equal(FORM._internal.dinOf(' 9876543 '), '09876543');
});
