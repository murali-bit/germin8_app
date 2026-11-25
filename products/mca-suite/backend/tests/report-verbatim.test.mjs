// node --test backend/tests/report-verbatim.test.mjs
// Rule-based splitting of made-up reports (no real company text), cleaning, save rules, transcription with a fake
// Claude call (_setExtractor), and the routes. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  cleanVerbatim, splitAuditorReport, splitBoardReport, splitReport, splitLegal, parseMeetingTable, meetingDate, measure,
  saveVerbatim, plannedActions, transcribePdf, pageRanges, countPdfPages, REPORT_TEXTS_DDL, _setExtractor, detectKinds,
  TRANSCRIBE_SYSTEM, answerSource,
} from '../report-verbatim.js';
import { buildProposals } from '../report-ai.js';
import { handle } from '../routes/report-verbatim.js';
import { makeDocx } from './docx-fixture.mjs';

const CIN = 'U01100KA2019PTC000001';

// ───────────── made-up reports ─────────────

const UNMODIFIED = `=== Page 1 ===
INDEPENDENT AUDITOR’S REPORT
To the Members of Demo Widgets Private Limited
Report on the Audit of the Financial Statements
Opinion
We have audited the attached financial statements of Demo Widgets Private Limited (“the Company”), made up of the Balance Sheet as at 31 March 2026 and the Statement of Profit and Loss for the year then ended.
In our opinion these statements give a true and fair view of the Company’s state of affairs as at 31 March 2026 and of its loss for the year.
Basis for Opinion
We conducted our audit in accordance with the Standards on Auditing specified under section 143(10) of the Act. We believe the evidence we obtained is enough for our opinion.
Information Other than the Financial Statements and Auditor’s Report Thereon
The Board of Directors is responsible for the other information. We have nothing to report in this regard.
=== Page 2 ===
Responsibility of Management for the Financial Statements
The Company’s Board of Directors is responsible for preparing these statements.
Those Board of Directors also oversee the Company’s financial reporting process.
Auditor’s Responsibilities for the Audit of the Financial Statements
Our aim is to obtain reasonable assurance about whether the statements are free from material misstatement.
We also:
• Identify and assess the risks of material misstatement.
• Evaluate the accounting policies used.
We communicate with those charged with governance about the audit.
=== Page 3 ===
Report on Other Legal and Regulatory Requirements
1. As required by section 143(3) of the Act, we report that:
(a) We obtained all the information we needed;
(b) Proper books of account have been kept;
(f) This report does not include a report on the internal financial controls under clause (i) of sub-section 3 of section 143, as the Company is exempt under G.S.R. 583(E);
(g) Section 197 does not apply to the Company;
(h) With respect to the other matters to be included in the Auditor’s Report in accordance with Rule 11 of the Companies (Audit and Auditors) Rules, 2014, in our opinion:
i. The Company has no pending litigations;
ii. The Company had no long-term contracts with foreseeable losses; and
iii. No amount had to be transferred to the Investor Education and Protection Fund.
=== Page 4 ===
For Demo Audit & Co
Chartered Accountants
Firm Registration No.: 000000S
Place: Demo City
Date: 30/09/2026
UDIN: 26000000DEMO0000`;

const QUALIFIED = `INDEPENDENT AUDITORS' REPORT
Qualified Opinion
We have audited the financial statements of Demo Traders Private Limited.
In our opinion, except for the effects of the matters described below, the statements give a true and fair view.
Basis for Qualified Opinion
The Company has not provided for gratuity, which is not in line with AS 15.
Trade receivables of Rs. 5,00,000 could not be confirmed.
We conducted our audit in accordance with the Standards on Auditing.
Emphasis of Matter
We draw attention to Note 30 about the going concern assumption. Our opinion is not modified in this respect.
Key Audit Matters
We have nothing to report on key audit matters.
Other Matter
The figures for the previous year were audited by another auditor.
Management's and Board of Directors' Responsibilities for the Financial Statements
The Board is responsible for these statements.
Auditor's Responsibility
Our objectives are to obtain reasonable assurance.
Report on Other Legal and Regulatory Requirements
1. As required by the Companies (Auditor's Report) Order, 2020 ("the Order"), we give in Annexure A a statement on the matters in paragraphs 3 and 4 of the Order.
2. As required by section 143(3) of the Act, we report that:
(a) We obtained all the information we needed;
(f) With respect to the internal financial controls, refer to our separate report in Annexure B;
(g) The remuneration paid is within section 197;
(h) With respect to the other matters to be included in the Auditor's Report in accordance with Rule 11 of the Companies (Audit and Auditors) Rules, 2014:
(i) The Company has no pending litigations;
(ii) There were no long-term contracts with foreseeable losses;
(iii) No amount was due to the Investor Education and Protection Fund;
(iv) The management has given the representations on funds advanced;
(v) No dividend was declared during the year;
(vi) The accounting software has an audit trail (edit log) facility.
(i) With respect to the matter to be included in the Auditor's Report under section 197(16): the remuneration is within limits.
For Demo Assurance LLP
Chartered Accountants
Annexure A to the Independent Auditor's Report
(i) The Company has maintained proper records of its property, plant and equipment.
Annexure B to the Independent Auditor's Report
Report on the Internal Financial Controls with reference to Financial Statements under Clause (i) of Sub-section 3 of Section 143 of the Companies Act, 2013
Opinion
In our opinion, the Company has, in all material respects, adequate internal financial controls with reference to financial statements.
Management's Responsibility for Internal Financial Controls
The Board is responsible for internal financial controls.
For Demo Assurance LLP`;

const BOARD = `=== Page 1 ===
BOARD’S REPORT
To the Members of Demo Widgets Private Limited
EXTRACT OF ANNUAL RETURN:
The annual return is placed on the website at https://demo-widgets.example.test/annual-return.
NUMBER OF BOARD MEETINGS HELD:
Four meetings of the Board were held during the year.
Date of Board meeting | ASHA DEMO | RAVI DEMO | MEERA DEMO
10-05-25 | Present | Present | Absent
12-08-25 | Present | Present | Present
DIRECTOR’S RESPONSIBILITY STATEMENT:
Pursuant to section 134(5) the Board confirms that-
(a) the applicable accounting standards were followed;
(b) the accounts were prepared on a going concern basis.
REPORTING OF FRAUDS BY AUDITORS
The auditors did not report any fraud under section 143(12).
COST RECORDS
Cost records under section 148(1) are not applicable to the Company.
STATE OF COMPANY’S AFFAIRS AND FUTURE OUTLOOK
The Company sold demo widgets worth ₹ 12,00,000 during the year.
DIVIDEND
The Directors do not recommend any dividend.
CONSERVATION OF ENERGY, TECHNOLOGY ABSORPTION AND FOREIGN EXCHANGE EARNINGS AND OUTGO
CONSERVATION OF ENERGY
The Company uses energy carefully.
TECHNOLOGY ABSORPTION
No technology was absorbed.
FOREIGN EXCHANGE EARNINGS AND OUTGO:
Particulars | Amount (Rs.)
Earnings | Nil
Outgo | Nil
=== Page 2 ===
RISK MANAGEMENT
The Board reviews risks every quarter.
FINANCIAL HIGHLIGHTS
Particulars | 31 March 2026 | 31 March 2025
Total Revenue | 1,200 | 900
TRANSFER TO RESERVES
No amount was transferred to reserves.
CHANGE IN NATURE OF BUSINESS, IF ANY
There was no change in the nature of business.
MATERIAL CHANGES OCCURRED AFTER THE CLOSE OF THE FINANCIAL YEAR
No material changes occurred after the year end.
DIRECTORS AND KMP
Sl. No | Name | DIN | Date of appointment
1 | ASHA DEMO | 00000001 | 01/04/2019
MEERA DEMO was appointed on 12/08/2025.
DEPOSITS
The Company has not accepted any deposits.
SHARES
The Company has not issued any shares during the year.
THE DETAILS OF APPLICATION MADE OR ANY PROCEEDING PENDING UNDER THE INSOLVENCY AND BANKRUPTCY CODE, 2016
No application was made under the Insolvency and Bankruptcy Code, 2016.
STATEMENT IN RESPECT OF ADEQUACY OF INTERNAL FINANCIAL CONTROL WITH REFERENCE TO THE FINANCIAL STATEMENTS
The Company has adequate internal financial controls.
ACKNOWLEDGEMENTS
The Board thanks everyone.
For and on behalf of the Board
ASHA DEMO`;

// ───────────── cleaning ─────────────

test('cleanVerbatim: quotes/apostrophes to ASCII, bullets removed, ₹ to Rs., whitespace collapsed — words identical', () => {
  const raw = 'The Company’s “other” information:\n• one two – three…\n\n₹ 1,000  and\t₹5';
  const out = cleanVerbatim(raw);
  assert.equal(out, 'The Company\'s "other" information: one two - three... Rs. 1,000 and Rs. 5');
  const words = s => s.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').filter(w => w !== 'Rs');
  assert.deepEqual(words(out), words(raw.replace(/₹/g, '')));
  assert.equal(cleanVerbatim(' Identify the risks'), 'Identify the risks');   // Wingdings bullet from Word
});

// ───────────── auditor's report ─────────────

test('unmodified (Jain-style) report: every section between its headings, Rule 11 split out of 6(a)', () => {
  const { sections: s, opinionType, missingHeadings, notes } = splitAuditorReport(UNMODIFIED);
  assert.equal(opinionType, 'unmodified');
  assert.equal(s.OPINION.value, 'We have audited the attached financial statements of Demo Widgets Private Limited ("the Company"), made up of the Balance Sheet as at 31 March 2026 and the Statement of Profit and Loss for the year then ended. In our opinion these statements give a true and fair view of the Company\'s state of affairs as at 31 March 2026 and of its loss for the year.');
  assert.equal(s.OPINION.page, 1);
  assert.equal(s.OPINION.heading, 'Opinion');
  assert.match(s.BASIS.value, /^We conducted our audit .* enough for our opinion\.$/);
  assert.equal(s.OTHER_INFO.value, 'The Board of Directors is responsible for the other information. We have nothing to report in this regard.');
  assert.equal(s.MGMT_RESP.page, 2);
  assert.match(s.MGMT_RESP.value, /^The Company's Board of Directors .* financial reporting process\.$/);
  assert.equal(s.AUDITOR_RESP.value, 'Our aim is to obtain reasonable assurance about whether the statements are free from material misstatement. We also: Identify and assess the risks of material misstatement. Evaluate the accounting policies used. We communicate with those charged with governance about the audit.');
  assert.equal(s.LEGAL_6A.page, 3);
  assert.match(s.LEGAL_6A.value, /^1\. As required by section 143\(3\) of the Act, we report that: \(a\) .* \(g\) Section 197 does not apply to the Company;$/);
  assert.doesNotMatch(s.LEGAL_6A.value, /Rule 11|For Demo Audit|Chartered/);
  assert.equal(s.RULE11.value, '(h) With respect to the other matters to be included in the Auditor\'s Report in accordance with Rule 11 of the Companies (Audit and Auditors) Rules, 2014, in our opinion: i. The Company has no pending litigations; ii. The Company had no long-term contracts with foreseeable losses; and iii. No amount had to be transferred to the Investor Education and Protection Fund.');
  assert.equal(s.CARO, undefined, 'no CARO paragraph: CARO is not set to No from absence');
  assert.match(s.IFC.value, /^\(f\) This report does not include .*G\.S\.R\. 583\(E\);$/);
  assert.deepEqual(missingHeadings.sort(), ['CARO', 'EMPHASIS', 'KAM', 'OTHER_5B']);
  for (const k of missingHeadings) assert.equal(s[k], undefined, `${k} is not invented`);
  assert.equal(s.QUAL_COUNT, undefined);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /CARO .* not set/);
});

test('qualified opinion with EoM, KAM, Other Matter, CARO paragraph, Rule 11 (i)-(vi) then (i) s.197, IFC annexure', () => {
  const { sections: s, opinionType, missingHeadings, notes } = splitAuditorReport(QUALIFIED);
  assert.equal(opinionType, 'qualified');
  assert.equal(s.OPINION.heading, 'Qualified Opinion');
  assert.equal(s.QUAL_COUNT.value, '2');
  assert.equal(s.QUAL_TYPE_1.value, 'Qualification');
  assert.equal(s.QUAL_COMMENT_1.value, 'The Company has not provided for gratuity, which is not in line with AS 15.');
  assert.match(s.BASIS.value, /^The Company has not provided .* Standards on Auditing\.$/);
  assert.match(s.EMPHASIS.value, /^We draw attention to Note 30/);
  assert.equal(s.KAM.value, 'We have nothing to report on key audit matters.');
  assert.equal(s.OTHER_5B.value, 'The figures for the previous year were audited by another auditor.');
  assert.equal(s.MGMT_RESP.value, 'The Board is responsible for these statements.');
  assert.equal(s.AUDITOR_RESP.value, 'Our objectives are to obtain reasonable assurance.');
  assert.equal(s.CARO.value, 'Yes');
  assert.match(s.RULE11.value, /^\(h\) With respect to the other matters .* \(vi\) The accounting software has an audit trail \(edit log\) facility\.$/);
  assert.doesNotMatch(s.RULE11.value, /197\(16\)/);
  assert.match(s.LEGAL_6A.value, /^1\. As required by the Companies \(Auditor's Report\) Order, 2020 \("the Order"\)/);
  assert.match(s.LEGAL_6A.value, /\(g\) The remuneration paid is within section 197; \(i\) With respect to the matter .* within limits\.$/);
  assert.doesNotMatch(s.LEGAL_6A.value, /Rule 11|Annexure A to|Demo Assurance/);
  assert.equal(s.IFC.value, 'In our opinion, the Company has, in all material respects, adequate internal financial controls with reference to financial statements.');
  assert.deepEqual(missingHeadings, ['OTHER_INFO']);
  assert.ok(notes.some(n => /CARO applies/.test(n)));
  assert.ok(notes.some(n => /2 remark paragraphs/.test(n)));
});

test('splitLegal: no Rule 11 clause leaves the body whole', () => {
  assert.deepEqual(splitLegal('1. As required by section 143(3):\n(a) one;\n(b) two.'), { legal: '1. As required by section 143(3):\n(a) one;\n(b) two.', rule11: null });
});

test('missing headings: only what is in the text is returned, nothing is defaulted', () => {
  const { sections, missingHeadings, opinionType } = splitAuditorReport('Opinion\nIn our opinion the statements are fair.');
  assert.deepEqual(Object.keys(sections), ['OPINION']);
  assert.equal(opinionType, 'unmodified');
  assert.equal(missingHeadings.length, 11);
  const b = splitBoardReport('BOARD’S REPORT\nDIVIDEND\nNo dividend is recommended.');
  assert.deepEqual(Object.keys(b.sections), ['DIVIDEND_DESC']);
  assert.ok(b.missingHeadings.includes('DRS') && b.missingHeadings.includes('BOARD_MEETINGS'));
  // A short sentence that mentions a heading word is not a heading.
  const c = splitBoardReport('BOARD’S REPORT\nRISK MANAGEMENT\nThe Company has adequate internal financial controls.\nIt reviews risks.');
  assert.equal(c.sections.IFC, undefined);
  assert.equal(c.sections.RISK.value, 'The Company has adequate internal financial controls. It reviews risks.');
});

// ───────────── Board's report ─────────────

test('board report: every heading to the next, tables kept as text, meetings parsed, website found', () => {
  const { sections: s, missingHeadings, notes } = splitBoardReport(BOARD);
  assert.equal(s.WEBSITE.value, 'https://demo-widgets.example.test/annual-return');
  assert.deepEqual(JSON.parse(s.BOARD_MEETINGS.value), [{ date: '10/05/2025', total: 3, attended: 2 }, { date: '12/08/2025', total: 3, attended: 3 }]);
  assert.equal(s.DRS.value, 'Pursuant to section 134(5) the Board confirms that- (a) the applicable accounting standards were followed; (b) the accounts were prepared on a going concern basis.');
  assert.equal(s.DRS.heading, "DIRECTOR'S RESPONSIBILITY STATEMENT:");
  assert.equal(s.FRAUDS.value, 'The auditors did not report any fraud under section 143(12).');
  assert.equal(s.COST_RECORDS.value, 'Cost records under section 148(1) are not applicable to the Company.');
  assert.equal(s.STATE_OF_AFFAIRS.value, 'The Company sold demo widgets worth Rs. 12,00,000 during the year.');
  assert.equal(s.DIVIDEND_DESC.value, 'The Directors do not recommend any dividend.');
  assert.equal(s.ENERGY.value, 'The Company uses energy carefully.');
  assert.equal(s.TECH.value, 'No technology was absorbed.');
  assert.equal(s.FOREX.value, 'Particulars | Amount (Rs.) Earnings | Nil Outgo | Nil');
  assert.equal(s.RISK.value, 'The Board reviews risks every quarter.');
  assert.equal(s.RISK.page, 2);
  assert.equal(s.FIN_SUMMARY.value, 'Particulars | 31 March 2026 | 31 March 2025 Total Revenue | 1,200 | 900');
  assert.equal(s.RESERVES_DESC.value, 'No amount was transferred to reserves.');
  assert.equal(s.NATURE_CHANGE.value, 'There was no change in the nature of business.');
  assert.equal(s.MATERIAL_CHANGES.value, 'No material changes occurred after the year end.');
  assert.match(s.DIRECTOR_CHANGES.value, /^Sl\. No \| Name .* MEERA DEMO was appointed on 12\/08\/2025\.$/);
  assert.equal(s.DEPOSITS.value, 'The Company has not accepted any deposits.');
  assert.equal(s.DEPOSITS.reference, true);
  assert.equal(s.IBC.value, 'No application was made under the Insolvency and Bankruptcy Code, 2016.');
  assert.equal(s.IFC.value, 'The Company has adequate internal financial controls.');
  assert.deepEqual(missingHeadings, ['ORDERS']);
  assert.deepEqual(notes, []);
});

test('meetings table: matrix, summary layout, dates in words, bad rows reported', () => {
  assert.equal(meetingDate('18-03-25'), '18/03/2025');
  assert.equal(meetingDate('5th June, 2025'), '05/06/2025');
  assert.equal(meetingDate('June 5, 2025'), '05/06/2025');
  assert.equal(meetingDate('31-02-2025'), '');
  const sum = parseMeetingTable(['S. No | Date of meeting | Board strength | Directors present', '1 | 15.07.2025 | 2 | 2', '2 | 20.01.2026 | 2 | 1']);
  assert.deepEqual(sum.meetings, [{ date: '15/07/2025', total: 2, attended: 2 }, { date: '20/01/2026', total: 2, attended: 1 }]);
  const bad = parseMeetingTable(['Date | A | B', '01-04-25 | Present | 7']);
  assert.equal(bad.meetings.length, 0);
  assert.equal(bad.errors.length, 1);
  assert.deepEqual(parseMeetingTable(['no table here']).meetings, []);
});

test('auto kind, lengths and warnings (never cut)', () => {
  assert.deepEqual(detectKinds(BOARD), { auditor: false, board: true });
  assert.deepEqual(detectKinds(UNMODIFIED), { auditor: true, board: false });
  const both = splitReport(UNMODIFIED + '\n' + BOARD, 'auto');
  assert.deepEqual(both.kinds, ['auditor', 'board']);
  assert.equal(both.sections.eauditor.CARO, undefined);
  assert.equal(both.sections.eboard.RISK.value, 'The Board reviews risks every quarter.');
  assert.equal(both.sections.eboard.IFC.value, 'The Company has adequate internal financial controls.');
  assert.equal(both.lengths.eauditor.OPINION, both.sections.eauditor.OPINION.value.length);
  const long = 'x'.repeat(1200);
  const m = measure({ eboard: { DRS: { value: long } }, eauditor: { RULE11: { value: 'y '.repeat(2000) + '[illegible] é' } } });
  assert.equal(m.lengths.eboard.DRS, 1200);
  assert.ok(m.warnings.some(w => w.key === 'DRS' && /1200 characters .* about 1000\. The text is NOT cut/.test(w.text)));
  assert.ok(m.warnings.some(w => w.key === 'RULE11' && /longer than any text/.test(w.text)));
  assert.ok(m.warnings.some(w => w.key === 'RULE11' && /illegible/.test(w.text)));
  assert.ok(m.warnings.some(w => w.key === 'RULE11' && /may not keep/.test(w.text)));
});

// ───────────── saving ─────────────

function memDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE company_answers (cin TEXT NOT NULL, form_type TEXT NOT NULL, field_key TEXT NOT NULL, label TEXT, value TEXT,
             source TEXT DEFAULT 'extension', updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (cin, form_type, field_key));`);
  db.exec(REPORT_TEXTS_DDL);
  return db;
}
const put = (db, ft, key, label, value) => db.prepare('INSERT INTO company_answers (cin, form_type, field_key, label, value) VALUES (?,?,?,?,?)').run(CIN, ft, key, label, value);
const get = (db, ft, key) => db.prepare('SELECT label, value, source FROM company_answers WHERE cin=? AND form_type=? AND field_key=?').get(CIN, ft, key);

test('saveVerbatim: replaces blank / TEST DATA / AI / older verbatim / PLACEHOLDER, keeps the CA\'s own unless force', () => {
  const db = memDb();
  put(db, 'eauditor', 'OPINION', 'TEST DATA: opinion', 'test');
  put(db, 'eauditor', 'BASIS', 'Entered by CA: basis', 'My own basis text');
  put(db, 'eauditor', 'KAM', 'AI from document (p.2): KAM', 'Not applicable');
  put(db, 'eauditor', 'EMPHASIS', 'Verbatim from document (p.1): old', 'old');
  put(db, 'eboard', 'RISK', 'PLACEHOLDER risk', 'x');
  put(db, 'eboard', 'TECH', 'Entered by CA', '');
  const byForm = {
    eauditor: { OPINION: { value: 'Op text', page: 1 }, BASIS: { value: 'Basis text', page: 1 }, KAM: { value: 'Kam text', page: 2 },
      EMPHASIS: { value: 'New emphasis', page: 2 }, CARO: { value: 'Maybe' } },
    eboard: { RISK: { value: 'Risk text', page: 2 }, TECH: { value: 'Tech text', page: null }, DEPOSITS: { value: 'Nothing', reference: true },
      BOARD_MEETINGS: { value: JSON.stringify([{ date: '10/05/2025', total: 3, attended: 2 }]), page: 1 } },
  };
  assert.deepEqual(plannedActions(db, CIN, byForm).eauditor, { OPINION: 'replace', BASIS: 'keep', KAM: 'replace', EMPHASIS: 'replace', CARO: 'fill' });
  const r = saveVerbatim(db, CIN, byForm);
  const savedKeys = r.saved.map(x => `${x.formType}:${x.key}`).sort();
  assert.deepEqual(savedKeys, ['eauditor:EMPHASIS', 'eauditor:KAM', 'eauditor:OPINION', 'eboard:BOARD_MEETINGS', 'eboard:RISK', 'eboard:TECH']);
  assert.deepEqual(r.skipped.map(x => x.key).sort(), ['BASIS', 'CARO', 'DEPOSITS']);
  assert.deepEqual({ ...get(db, 'eauditor', 'OPINION') }, { label: 'Verbatim from document (p.1): 1(a) Opinion', value: 'Op text', source: 'report-verbatim' });
  assert.equal(get(db, 'eboard', 'TECH').label, 'Verbatim from document: 23(a) Technology absorption');
  assert.equal(get(db, 'eauditor', 'BASIS').value, 'My own basis text');
  // force replaces the CA's own answer
  saveVerbatim(db, CIN, { eauditor: { BASIS: { value: 'Basis text', page: 1 } } }, { force: true });
  assert.equal(get(db, 'eauditor', 'BASIS').value, 'Basis text');
  // report-ai may replace verbatim text (labels are replaceable for both steps)
  const p = buildProposals(db, CIN, [{ formType: 'eauditor', key: 'KAM', label: 'KAM', value: 'Different', quote: 'q', page: 1 }]);
  assert.equal(p[0].action, 'replace-test');
});

// ───────────── transcription ─────────────

const fakePdf = n => Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Pages /Count ${n} >> endobj\n${Array.from({ length: n }, (_, i) => `${i + 2} 0 obj << /Type /Page /Parent 1 0 R >> endobj`).join('\n')}\n%%EOF\n`);

test('page count and page ranges', () => {
  assert.equal(countPdfPages(fakePdf(5)), 5);
  assert.equal(countPdfPages(Buffer.from('%PDF-1.7 compressed')), null);
  assert.deepEqual(pageRanges(5), [[1, 3], [4, 5]]);
  assert.deepEqual(pageRanges(10, [2, 4]), [[2, 4]]);
  assert.deepEqual(pageRanges(4, '1-6'), [[1, 3], [4, 4]]);
  assert.deepEqual(pageRanges(null), [[null, null]]);
  assert.throws(() => pageRanges(3, [5, 6]), /only 3 page/);
});

test('transcribePdf: page-range calls in parallel, strict prompt, cached by sha256 in report_texts', async () => {
  const db = memDb();
  const calls = [];
  _setExtractor(async (input, opts) => {
    calls.push(opts);
    assert.ok(input.pdfBase64);
    assert.match(opts.system, /TRANSCRIBE EXACTLY/);
    assert.ok(opts.maxTokens >= 16000);
    const [, a, b] = /pages? (\d+)(?: to (\d+))?/.exec(opts.prompt);
    const pages = [];
    for (let n = Number(a); n <= Number(b || a); n++) pages.push({ page: n, text: `Text of page ${n}` });
    return { json: { pages }, model: 'fake-model' };
  });
  try {
    const b64 = fakePdf(5).toString('base64');
    const r = await transcribePdf(b64, { db, cin: CIN });
    assert.equal(calls.length, 2);
    assert.equal(r.cached, false);
    assert.equal(r.pageCount, 5);
    assert.deepEqual(r.pages.map(p => p.page), [1, 2, 3, 4, 5]);
    assert.match(r.text, /^=== Page 1 ===\nText of page 1\n=== Page 2 ===/);
    const again = await transcribePdf(b64, { db });
    assert.equal(again.cached, true);
    assert.equal(calls.length, 2, 'no second paid call');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM report_texts').get().n, 1);
    await transcribePdf(b64, { db, refresh: true });
    assert.equal(calls.length, 4);
  } finally { _setExtractor(null); }
});

test('transcribePdf: a failed range is reported, nothing cached; all failing throws', async () => {
  const db = memDb();
  _setExtractor(async (input, opts) => {
    if (/pages 4 to 5/.test(opts.prompt)) throw new Error('no reply from the gateway within 240s');
    return { json: { pages: [{ page: 1, text: 'one' }, { page: 2, text: 'two' }, { page: 9, text: 'out of range' }] }, model: 'm' };
  });
  try {
    const r = await transcribePdf(fakePdf(5).toString('base64'), { db });
    assert.deepEqual(r.pages.map(p => p.page), [1, 2]);
    assert.ok(r.warnings.some(w => /Page 3 was not returned/.test(w)));
    assert.ok(r.warnings.some(w => /Pages 4-5 could not be transcribed/.test(w)));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM report_texts').get().n, 0);
    _setExtractor(async () => { throw new Error('boom'); });
    await assert.rejects(transcribePdf(fakePdf(2).toString('base64'), { db }), /boom/);
  } finally { _setExtractor(null); }
});

// ───────────── routes ─────────────

function call(db, pathname, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const sendJson = (_res, status, data) => resolve({ status, data });
    const ctx = { url: new URL('http://x' + pathname), pathname, method: 'POST', db, sendJson, parseJsonBody: async () => body };
    handle({ headers }, {}, ctx).then(h => { if (!h) resolve(null); }, reject);
  });
}

test('route: transcribe a .docx (no AI) then split and save', async () => {
  const db = memDb();
  _setExtractor(async () => { throw new Error('must not be called for a docx'); });
  try {
    const para = t => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
    const docx = makeDocx(['BOARD&#8217;S REPORT', 'RISK MANAGEMENT', 'The Board reviews risks every quarter.', 'DIVIDEND', 'No dividend.'].map(para).join(''));
    const t = await call(db, '/api/report-text/transcribe', { cin: CIN, docxBase64: docx.toString('base64'), fileName: 'board.docx' });
    assert.equal(t.status, 200);
    assert.equal(t.data.kind, 'docx');
    assert.equal(t.data.text, 'BOARD’S REPORT\nRISK MANAGEMENT\nThe Board reviews risks every quarter.\nDIVIDEND\nNo dividend.');
    const s = await call(db, '/api/report-text/split', { cin: CIN, text: t.data.text, kind: 'auto' });
    assert.equal(s.status, 200);
    assert.deepEqual(s.data.kinds, ['board']);
    assert.equal(s.data.sections.eboard.RISK.value, 'The Board reviews risks every quarter.');
    assert.equal(s.data.actions.eboard.RISK, 'fill');
    assert.equal(s.data.saved, undefined);
    const sv = await call(db, '/api/report-text/split', { cin: CIN, text: t.data.text, kind: 'board', save: true });
    assert.deepEqual(sv.data.saved.map(x => x.key).sort(), ['DIVIDEND_DESC', 'RISK']);
    assert.equal(get(db, 'eboard', 'RISK').source, 'report-verbatim');
    assert.equal(sv.data.actions.eboard.RISK, 'same');
  } finally { _setExtractor(null); }
});

test('route: guards and errors', async () => {
  const db = memDb();
  assert.equal(await call(db, '/api/other', {}), null);
  const o = await call(db, '/api/report-text/split', { text: 'x' }, { origin: 'https://evil.example' });
  assert.equal(o.status, 403);
  assert.equal((await call(db, '/api/report-text/split', { cin: 'BAD', text: 'Opinion\nx', save: true })).status, 400);
  assert.equal((await call(db, '/api/report-text/split', { cin: CIN, text: '' })).status, 400);
  assert.equal((await call(db, '/api/report-text/transcribe', { base64: Buffer.from('plain bytes').toString('base64') })).data.code, 'NOT_SUPPORTED');
  const txt = await call(db, '/api/report-text/transcribe', { text: 'Opinion\nFair.' });
  assert.equal(txt.data.kind, 'text');
  _setExtractor(async (input, opts) => ({ json: { pages: [{ page: 1, text: 'Opinion\nIn our opinion the statements are fair.' }] }, model: 'm' }));
  try {
    const pdf = await call(db, '/api/report-text/transcribe', { cin: CIN, base64: fakePdf(1).toString('base64'), fileName: 'audit.pdf' });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.data.kind, 'pdf');
    const sp = await call(db, '/api/report-text/split', { cin: CIN, text: pdf.data.text, kind: 'auditor' });
    assert.equal(sp.data.sections.eauditor.OPINION.page, 1);
    const bad = await call(db, '/api/report-text/transcribe', { base64: fakePdf(1).toString('base64'), pages: [3, 4] });
    assert.equal(bad.status, 400);
  } finally { _setExtractor(null); }
});

// ───────────── review fixes ─────────────

test('page break mid-section: running headers are page furniture, the section continues', () => {
  const aud = `=== Page 1 ===
INDEPENDENT AUDITOR'S REPORT
To the Members of Demo Widgets Private Limited
Opinion
In our opinion the statements are fair.
Responsibility of Management for the Financial Statements
The Board is responsible for the preparation of these statements and for the
=== Page 2 ===
Independent Auditor's Report (continued)
To the Members of Demo Widgets Private Limited
design of internal controls relevant to their preparation.
Auditor's Responsibilities for the Audit of the Financial Statements
Our aim is reasonable assurance.`;
  const { sections: s } = splitAuditorReport(aud);
  assert.equal(s.MGMT_RESP.value, 'The Board is responsible for the preparation of these statements and for the design of internal controls relevant to their preparation.');
  assert.equal(s.AUDITOR_RESP.value, 'Our aim is reasonable assurance.');
  const board = `=== Page 1 ===
DEMO WIDGETS PRIVATE LIMITED
BOARD'S REPORT
RISK MANAGEMENT
The Board reviews the risks of the business every quarter and
=== Page 2 ===
DEMO WIDGETS PRIVATE LIMITED
BOARD'S REPORT (Contd.)
reports them to the members.
DIVIDEND
No dividend is recommended.`;
  const b = splitBoardReport(board).sections;
  assert.equal(b.RISK.value, 'The Board reviews the risks of the business every quarter and reports them to the members.');
  assert.equal(b.DIVIDEND_DESC.value, 'No dividend is recommended.');
  assert.match(TRANSCRIBE_SYSTEM, /running headers \/ footers/);
});

test('Rule 11 ends at a new numbered paragraph and at "For <firm>" above "Chartered Accountants"', () => {
  const t = `INDEPENDENT AUDITOR'S REPORT
Report on Other Legal and Regulatory Requirements
1. As required by section 143(3) of the Act, we report that:
(a) We obtained all the information we needed;
(b) With respect to the other matters to be included in the Auditor's Report in accordance with Rule 11 of the Companies (Audit and Auditors) Rules, 2014:
i. The Company has no pending litigations;
ii. No dividend was declared.
2. With respect to the matter to be included under section 197(16), no remuneration was paid.
For Demo Rao Associates
Chartered Accountants
Partner`;
  const { sections: s } = splitAuditorReport(t);
  assert.equal(s.RULE11.value, "(b) With respect to the other matters to be included in the Auditor's Report in accordance with Rule 11 of the Companies (Audit and Auditors) Rules, 2014: i. The Company has no pending litigations; ii. No dividend was declared.");
  assert.equal(s.LEGAL_6A.value, '1. As required by section 143(3) of the Act, we report that: (a) We obtained all the information we needed; 2. With respect to the matter to be included under section 197(16), no remuneration was paid.');
  assert.doesNotMatch(s.LEGAL_6A.value + s.RULE11.value, /Demo Rao|Chartered/);
  // "For <firm>" ends Rule 11 even when it is the last clause
  const r = splitLegal("(h) With respect to the other matters to be included in the Auditor's Report in accordance with Rule 11:\ni. one;\nii. two.\nFor Demo Rao Associates\nChartered Accountants");
  assert.equal(r.rule11, "(h) With respect to the other matters to be included in the Auditor's Report in accordance with Rule 11:\ni. one;\nii. two.");
});

test('board: a DRS clause on internal financial controls is not a heading; Title Case and inline headings end sections', () => {
  const t = `Board's Report
Directors' Responsibility Statement
Pursuant to section 134(5) the Board confirms that:
(d) the directors had prepared the annual accounts on a going concern basis;
(e) the directors had laid down internal financial controls to be followed by the Company and that such internal financial controls are adequate and were operating effectively; and
(f) the directors had devised proper systems to ensure compliance with the provisions of all applicable laws.
Deposits
The Company has not accepted any deposits.
Particulars of Loans, Guarantees or Investments
The Company has not given any loan.
Statutory Auditors
Demo Audit & Co were appointed as auditors.
Risk Management
The Board reviews risks.
Conservation of energy: The Company uses energy carefully.
Technology absorption: No technology was absorbed.
Foreign exchange earnings and outgo: Nil.
Internal Financial Controls
The Company has adequate internal financial controls with reference to the financial statements.`;
  const { sections: s } = splitBoardReport(t);
  assert.match(s.DRS.value, /^Pursuant to .* \(e\) the directors had laid down internal financial controls .* effectively; and \(f\) .* applicable laws\.$/);
  assert.equal(s.IFC.value, 'The Company has adequate internal financial controls with reference to the financial statements.');
  assert.equal(s.DEPOSITS.value, 'The Company has not accepted any deposits.');
  assert.equal(s.RISK.value, 'The Board reviews risks.');
  assert.equal(s.ENERGY.value, 'The Company uses energy carefully.');
  assert.equal(s.TECH.value, 'No technology was absorbed.');
  assert.equal(s.FOREX.value, 'Nil.');
  assert.equal(s.IBC, undefined);
});

test('auditor: headings written with a period and inline "Heading: text" are found', () => {
  const t = `Independent Auditor's Report
Opinion.
In our opinion the statements are fair.
Basis for Opinion.
We conducted our audit in accordance with the Standards on Auditing.
Emphasis of Matter
We draw attention to Note 9.
Key Audit Matters: We have determined that there are no key audit matters.`;
  const { sections: s } = splitAuditorReport(t);
  assert.equal(s.OPINION.value, 'In our opinion the statements are fair.');
  assert.equal(s.BASIS.value, 'We conducted our audit in accordance with the Standards on Auditing.');
  assert.equal(s.EMPHASIS.value, 'We draw attention to Note 9.');
  assert.equal(s.KAM.value, 'We have determined that there are no key audit matters.');
  // a sentence that only starts with a heading word is still not a heading
  const b = splitBoardReport("BOARD'S REPORT\nRISK MANAGEMENT\nThe Board reviews risks.\nDividend was not declared.");
  assert.equal(b.sections.RISK.value, 'The Board reviews risks. Dividend was not declared.');
});

test('CARO only from positive evidence: absent is left out, an explicit sentence gives No, 143(11) gives Yes', () => {
  const legal = body => `INDEPENDENT AUDITOR'S REPORT\nReport on Other Legal and Regulatory Requirements\n${body}`;
  const a = splitAuditorReport(legal('1. As required by section 143(3) of the Act, we report that:\n(a) We obtained all the information we needed.'));
  assert.equal(a.sections.CARO, undefined);
  assert.ok(a.missingHeadings.includes('CARO'));
  const n = splitAuditorReport(legal("1. The Companies (Auditor's Report) Order, 2020 is not applicable to the Company."));
  assert.equal(n.sections.CARO.value, 'No');
  const y = splitAuditorReport(legal('1. As required by the Order issued under section 143(11) of the Act, we give in Annexure A a statement.'));
  assert.equal(y.sections.CARO.value, 'Yes');
});

test('qualified opinion from wrapped (text-layer) lines: one remark stays one paragraph', () => {
  const t = `INDEPENDENT AUDITOR'S REPORT
Qualified Opinion
In our opinion, except for the matter below, the statements are fair.
Basis for Qualified Opinion
The Company has not provided for doubtful debts of Rs. 4,00,000 as
required by the accounting standards, and the loss is understated by that amount.
We conducted our audit in accordance with the Standards on Auditing.`;
  const { sections: s } = splitAuditorReport(t);
  assert.equal(s.QUAL_COUNT.value, '1');
  assert.equal(s.QUAL_COMMENT_1.value, 'The Company has not provided for doubtful debts of Rs. 4,00,000 as required by the accounting standards, and the loss is understated by that amount.');
});

test('an answer the CA edited by hand (stored label unchanged, source ca) is kept by both readers', () => {
  const db = memDb();
  const ins = db.prepare('INSERT INTO company_answers (cin, form_type, field_key, label, value, source) VALUES (?,?,?,?,?,?)');
  ins.run(CIN, 'eboard', 'RISK', 'Verbatim from document (p.2): 15 Risk management policy', 'CA corrected risk text', 'ca');
  ins.run(CIN, 'eboard', 'TECH', 'Verbatim from document (p.2): 23(a) Technology absorption', 'old tech', 'report-verbatim');
  const byForm = { eboard: { RISK: { value: 'Risk text from scan', page: 2 }, TECH: { value: 'New tech', page: 2 } } };
  assert.deepEqual(plannedActions(db, CIN, byForm).eboard, { RISK: 'keep', TECH: 'replace' });
  const r = saveVerbatim(db, CIN, byForm);
  assert.deepEqual(r.saved.map(x => x.key), ['TECH']);
  assert.equal(get(db, 'eboard', 'RISK').value, 'CA corrected risk text');
  const p = buildProposals(db, CIN, [{ formType: 'eboard', key: 'RISK', label: 'Risk', value: 'AI risk', quote: 'q', page: 2 }]);
  assert.equal(p[0].action, 'keep');
  // the server's POST rule: unchanged → same owner; changed → 'ca'; a new machine-labelled row stays machine-owned
  assert.equal(answerSource({ value: 'x', source: 'report-verbatim' }, 'Verbatim from document: R', 'x'), 'report-verbatim');
  assert.equal(answerSource({ value: 'x', source: 'report-verbatim' }, 'Verbatim from document: R', 'y'), 'ca');
  assert.equal(answerSource(undefined, 'TEST DATA', 'z'), 'extension');
  assert.equal(answerSource(undefined, 'Risk', 'z'), 'ca');
});
