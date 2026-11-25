// node --test extension/tests/linked-aoc2.test.mjs
// AOC-2 linked form: data building, pageFill jobs, the Excel builder and the upload page function.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { buildAoc2Excel, listZip, readZipEntries, excelSerial, validateAoc2Rows, AOC2_TEMPLATE, AOC2_NATURES } from '../../backend/aoc2-excel.js';

const require = createRequire(import.meta.url);
const F = require('../js/linked/aoc2.js');

const TODAY = new Date(2026, 10, 24);
// Demo Terra Technology Private Limited, FY 2025-26 (real data).
const client = {
  general: { CIN: 'U01100KA2019PTC000001', COMPANY_NAME: 'Demo Terra Technology Private Limited', FY_FROM: '01/04/2025', FY_TO: '31/03/2026',
    BOARD_MEETING_DATE: '30/09/2026', BOARD_REPORT_DATE: '30/09/2026' },
  signatoriesFS: [{ din: '07654321', name: 'Arun Rao', designation: 'Director', date: '30/09/2026' }],
  relatedParty: { ANY_TRANSACTION: 'Yes' },
};
// Neutral s.188 contracts (made-up parties and PANs) for the happy path.
const ROWS_TEXT = [
  'Asha Rao | ABCPR1234K | Wife of director Ravi Rao | Office rent | 01/04/2025 to 31/03/2026 | Office rent Rs 20,000 a month | 2025-04-01 | 0',
  'Rao Consulting LLP | aab-1234 | LLP in which director Ravi Rao is a partner | Availing or rendering of any services | 01/04/2025 to 31/03/2026 | HR consulting Rs 50,000 a quarter | 01/04/2025 | Rs. 0',
].join('\n');
// Demo's real related-party items: director pay and a director loan (neither is a s.188 contract).
const VARSAL_RP = [
  'Arun Rao | 07654321 | Director | Director remuneration | 01/04/2025 to 31/03/2026 | Director salary Rs 1,99,700 for FY 2025-26 | 01/04/2025 | 0',
  'Arun Rao | 07654321 | Director | Loan received | 01/04/2025 to 31/03/2026 | Unsecured loan Rs 75,000 | 01/04/2025 | 0',
].join('\n');
const PLACE_OF_PROFIT = F.NATURES[3];
const LEASE = 'Leasing of property';

test('nature matcher is forgiving but only returns the 7 MCA values', () => {
  assert.deepEqual(F.NATURES, AOC2_NATURES);
  assert.equal(F.matchNature('place of profit'), PLACE_OF_PROFIT);
  assert.equal(F.matchNature('Director salary / remuneration'), PLACE_OF_PROFIT);
  assert.equal(F.matchNature('availing or rendering of any services'), F.NATURES[1]);
  assert.equal(F.matchNature('Consultancy fees'), F.NATURES[1]);
  assert.equal(F.matchNature('Office rent'), 'Leasing of property');
  assert.equal(F.matchNature('Appointment of agent for sales'), F.NATURES[0]);
  assert.equal(F.matchNature('sale or purchase of goods'), 'Sale or purchase of Goods');
  assert.equal(F.matchNature('6'), 'Sale or purchase of property');
  assert.equal(F.matchNature('Underwriting the subscription of any securities or derivatives thereof, of the company.'), F.NATURES[6]);
  assert.equal(F.matchNature('loan received'), null);
  assert.equal(F.matchNature(''), null);
});

test('rows parse from text lines and from JSON', () => {
  const t = F.parseRows(ROWS_TEXT);
  assert.equal(t.length, 2);
  assert.equal(t[0].name, 'Asha Rao');
  assert.equal(t[0].id, 'ABCPR1234K');
  const j = F.parseRows(JSON.stringify([{ id: '09876543', name: 'Kiran Rao' }]));
  assert.equal(j[0].name, 'Kiran Rao');
  assert.equal(F.parseRows('[not json'), null);
  assert.ok(F.parseRows('a | b | c')[0]._bad);
});

test('row validation: ID length, future date, unknown nature, bad line', () => {
  const ok = F.cleanRows(ROWS_TEXT, TODAY);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.rows[0].approvalDate, '01/04/2025');
  assert.equal(ok.rows[0].nature, LEASE);
  assert.equal(ok.rows[1].id, 'AAB-1234');
  assert.equal(ok.rows[1].advance, '0');
  const bad = F.cleanRows([
    { id: 'X'.repeat(51), name: 'A', relationship: 'Director', nature: 'services', duration: '1 year', terms: 'Rs 1', approvalDate: '01/01/2027', advance: '0' },
    { id: 'AAAPA1234A', name: 'B', relationship: 'Relative', nature: 'barter', duration: '1 year', terms: 'Rs 1', approvalDate: '31/02/2026', advance: 'abc' },
  ], TODAY);
  const all = bad.errors.join('\n');
  assert.match(all, /Contract 1: ID is over 50/);
  assert.match(all, /Contract 1: board approval date 01\/01\/2027 is in the future/);
  assert.match(all, /Contract 2: nature "barter" is not one of/);
  assert.match(all, /Contract 2: board approval date "31\/02\/2026" is not a date/);
  assert.match(all, /Contract 2: advance "abc" must be a number/);
  assert.match(F.cleanRows('only | three | parts', TODAY).errors[0], /expected 8 parts/);
});

test('buildData without rows or resolution number asks for them', () => {
  const { values, missing, notes } = F.buildData(client, {}, TODAY);
  const keys = missing.map(m => m.key);
  assert.ok(keys.includes('ROWS'));
  assert.ok(keys.includes('BOARD_RESOLUTION_NO'));
  assert.equal(missing.find(m => m.key === 'ROWS').type, 'textarea');
  assert.equal(values.AT_ARM_COUNT, '');
  assert.equal(values.NOT_AT_ARM_COUNT, '0');
  assert.equal(values.BOARD_RESOLUTION_DATE, '30/09/2026');
  assert.equal(values.DECL_DESIGNATION, 'Director');
  assert.equal(values.DECL_DIN, '07654321');
  assert.ok(notes.some(n => /board meeting date/.test(n)));
  // No count job until the rows are known (so the upload count check cannot mismatch).
  assert.deepEqual(F.jobs(values).map(j => j.id), ['AOC2_NOT_AT_ARM_COUNT', 'AOC2_RES_DATE', 'AOC2_DESIGNATION', 'AOC2_DIN']);
});

test('buildData with 2 contracts for Demo: counts, declaration, job order', () => {
  const answers = { ROWS: ROWS_TEXT, BOARD_RESOLUTION_NO: '05/2026-27', BOARD_RESOLUTION_DATE: '30-09-2026', DECL_DESIGNATION: 'Director', DECL_DIN: '07654321' };
  const { values, missing } = F.buildData(client, answers, TODAY);
  assert.deepEqual(missing, []);
  assert.equal(values.AT_ARM_COUNT, '2');
  assert.equal(values.NOT_AT_ARM_COUNT, '0');
  assert.equal(values.BOARD_RESOLUTION_DATE, '30/09/2026');
  const jobs = F.jobs(values);
  assert.deepEqual(jobs.map(j => j.id), ['AOC2_NOT_AT_ARM_COUNT', 'AOC2_AT_ARM_COUNT', 'AOC2_RES_NO', 'AOC2_RES_DATE', 'AOC2_DESIGNATION', 'AOC2_DIN']);
  assert.equal(jobs[1].selector, 'input[name$="panel_1665650438-panel_526419145-panel-panel-panel_copy_copy-panel_885569515-guidetextbox___jqName"]');
  assert.equal(jobs[0].selector, 'input[name$="panel_1665650438-panel_526419145-panel-panel-panel-guidetextbox___jqName"]');
  assert.equal(jobs[3].kind, 'date');
  assert.equal(jobs[4].kind, 'select');
  assert.equal(jobs[5].typeChars, true);
  // Pre steps: counts first, then the upload with the fetched Excel.
  const [counts, upload] = F.pre;
  assert.deepEqual(counts.args(values)[0].map(j => j.value), ['0', '2']);
  assert.equal(upload.skip(values), false);
  values.__AOC2_EXCEL = { base64: 'QUJD', fileName: 'x.xlsm' };
  assert.deepEqual(upload.args(values), ['QUJD', 'x.xlsm', 'atArm', 2, 90000]);
  assert.equal(upload.skip({ ROWS: [] }), true);
});

test('declaration problems become questions', () => {
  const { missing, values } = F.buildData(client, { ROWS: ROWS_TEXT, BOARD_RESOLUTION_NO: '1', BOARD_RESOLUTION_DATE: '01/12/2026', DECL_DIN: '123' }, TODAY);
  assert.deepEqual(missing.map(m => m.key).sort(), ['BOARD_RESOLUTION_DATE', 'DECL_DIN']);
  assert.equal(values.DECL_DIN, '');
  assert.equal(F.matchDesignation('Company Secretary'), 'Secretary');
  assert.equal(F.matchDesignation('Managing Director'), 'Director');
  assert.equal(F.matchDesignation('Chief Financial Officer'), 'CFO');
});

// ───────────── review fixes ─────────────

const base = { name: 'Asha Rao', id: 'ABCPR1234K', relationship: 'Wife of director', nature: 'rent', duration: '1 year', terms: 'Rent Rs 1', approvalDate: '01/04/2025', advance: '0' };
const errsOf = r => F.cleanRow({ ...base, ...r }, 0, TODAY).errors.join('\n');

test('Demo: DIN as ID and a director loan are rejected; director pay is flagged', () => {
  const all = F.cleanRows(VARSAL_RP, TODAY).errors.join('\n');
  assert.match(all, /Contract 1: 07654321 is a DIN\. MCA asks for the PAN/);
  assert.match(all, /Contract 2: 07654321 is a DIN/);
  assert.match(all, /Contract 2: Loan received is not a s\.188 contract\. Loans and interest are shown in AOC-4/);
  const { missing } = F.buildData(client, { ROWS: VARSAL_RP }, TODAY);
  assert.equal(missing.find(m => m.key === 'ROWS').label, 'Fix the related-party contract list');
  // Same salary row with a PAN passes validation but gets a s.188 Explanation (a) note.
  const { notes, values } = F.buildData(client, { ROWS: VARSAL_RP.split('\n')[0].replace('07654321', 'ABCPS1234K') }, TODAY);
  assert.equal(values.ROWS[0].nature, PLACE_OF_PROFIT);
  assert.ok(notes.some(n => /Contract 1: a director’s pay as director is not a s\.188 contract \(Explanation \(a\)/.test(n)), notes.join('|'));
  // An 8-digit number is fine for a body corporate (e.g. a foreign company number).
  assert.equal(errsOf({ name: 'Acme Holdings Ltd', id: '12345678' }), '');
  assert.match(errsOf({ id: '' }), /PAN of the person \(or CIN\/LLPIN of the company\) is required/);
});

test('ROWS hint is neutral and explains what is not a s.188 contract', () => {
  const hint = F.buildData(client, {}, TODAY).missing.find(m => m.key === 'ROWS').hint;
  assert.doesNotMatch(hint, /Arun|Kiran|07654321|09876543/);
  assert.match(hint, /Asha Rao \| ABCPR1234K/);
  assert.match(hint, /<date the board approved it>/);
  assert.match(hint, /Explanation \(a\) to s\.188\(1\)/);
  assert.match(F.ROW_FORMAT, /PAN \(person\) \/ CIN \(company\)/);
});

test('160-character limits on relationship and duration match the backend', () => {
  assert.match(errsOf({ relationship: 'R'.repeat(161) }), /relationship is over 160 characters/);
  assert.match(errsOf({ duration: 'D'.repeat(161) }), /duration is over 160 characters/);
  assert.equal(errsOf({ relationship: 'R'.repeat(160), duration: 'D'.repeat(160) }), '');
  const { missing } = F.buildData(client, { ROWS: [{ ...base, duration: 'D'.repeat(200) }] }, TODAY);
  assert.ok(missing.some(m => m.key === 'ROWS' && /duration is over 160/.test(m.hint)));
});

test('dates need a 2- or 4-digit year; amounts accept Rs./INR/-/ forms', () => {
  assert.equal(F.toDDMMYYYY('01/04/202'), '');
  assert.equal(F.toDDMMYYYY('1-4-5'), '');
  assert.equal(F.toDDMMYYYY('1-4-25'), '01/04/2025');
  assert.equal(F.toDDMMYYYY('2025-04-01'), '01/04/2025');
  assert.equal(F.toDDMMYYYY('30.09.2026'), '30/09/2026');
  assert.equal(F.cleanRow({ ...base, advance: 'Rs. 1,000.50/-' }, 0, TODAY).row.advance, '1000.50');
  assert.equal(F.cleanRow({ ...base, advance: 'INR 500' }, 0, TODAY).row.advance, '500');
  assert.equal(F.cleanRow({ ...base, advance: '₹ 2,500' }, 0, TODAY).row.advance, '2500');
});

test('declaration ID follows the designation (DIN / membership no. / PAN)', () => {
  const ans = { ROWS: ROWS_TEXT, BOARD_RESOLUTION_NO: '1', BOARD_RESOLUTION_DATE: '30/09/2026' };
  let r = F.buildData(client, { ...ans, DECL_DESIGNATION: 'CEO' }, TODAY);   // signatory DIN must not leak in
  assert.equal(r.values.DECL_DIN, '');
  assert.deepEqual(r.missing.map(m => [m.key, m.label]), [['DECL_DIN', 'Declaration — PAN of the CEO']]);
  r = F.buildData(client, { ...ans, DECL_DESIGNATION: 'CFO', DECL_DIN: 'abcde1234f' }, TODAY);
  assert.deepEqual(r.missing, []);
  assert.equal(r.values.DECL_DIN, 'ABCDE1234F');
  r = F.buildData(client, { ...ans, DECL_DESIGNATION: 'Company Secretary', DECL_DIN: '07654321' }, TODAY);
  assert.equal(r.missing[0].label, 'Declaration — membership no. of the company secretary');
  assert.deepEqual(F.buildData(client, { ...ans, DECL_DESIGNATION: 'Secretary', DECL_DIN: 'A12345' }, TODAY).missing, []);
  assert.equal(F.buildData(client, { ...ans, DECL_DESIGNATION: 'Director' }, TODAY).values.DECL_DIN, '07654321');
});

test('explicit "[]" means none at arm’s length; padded "NO " still warns', () => {
  const ans = { ROWS: '[]', NOT_AT_ARM_ROWS: JSON.stringify([base]), BOARD_RESOLUTION_NO: '1', BOARD_RESOLUTION_DATE: '30/09/2026' };
  const { values, missing, notes } = F.buildData({ ...client, relatedParty: { ANY_TRANSACTION: 'NO ' } }, ans, TODAY);
  assert.deepEqual(missing, []);
  assert.equal(values.AT_ARM_COUNT, '0');
  assert.equal(values.NOT_AT_ARM_COUNT, '1');
  assert.deepEqual(F.countJobs(values).map(j => j.value), ['1', '0']);
  assert.equal(F.pre[1].skip(values), true);
  assert.ok(notes.some(n => /AOC-4 says there were no related-party/.test(n)));
  assert.ok(F.buildData(client, { ...ans, ROWS: [] }, TODAY).values.AT_ARM_COUNT === '0');
  assert.ok(F.buildData(client, { ...ans, NOT_AT_ARM_ROWS: '' }, TODAY).notes.some(n => /No s\.188 contracts entered/.test(n)));
});

test('fetchAoc2Excel: passes the built file through, maps errors and times out', async () => {
  const http = await import('node:http');
  let mode = 'ok';
  const server = http.createServer((req, res) => {
    if (mode === 'hang') return;   // accept, never answer
    res.writeHead(mode === 'ok' ? 200 : 400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(mode === 'ok' ? { ok: true, base64: 'QUJD', fileName: 'f.xlsm' } : { ok: false, errors: ['Row 1: bad'] }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.deepEqual(await F.fetchAoc2Excel([base], url), { base64: 'QUJD', fileName: 'f.xlsm' });
    mode = 'bad';
    await assert.rejects(F.fetchAoc2Excel([base], url), /AOC-2 Excel not built: Row 1: bad/);
    mode = 'hang';
    const t0 = Date.now();
    await assert.rejects(F.fetchAoc2Excel([base], url, 300), /backend did not answer in 0 s|backend did not answer/);
    assert.ok(Date.now() - t0 < 5000);
  } finally { server.closeAllConnections(); server.close(); }
});

// ───────────── Excel ─────────────

const excelRows = () => F.cleanRows(ROWS_TEXT, TODAY).rows;

test('excelSerial and backend validation', () => {
  assert.equal(excelSerial('30/09/2026'), 46295);
  assert.equal(excelSerial('01/01/1900'), 2);
  assert.equal(excelSerial('31/02/2026'), null);
  assert.deepEqual(validateAoc2Rows(excelRows(), TODAY), []);
  assert.match(validateAoc2Rows([{ ...excelRows()[0], nature: 'place of profit' }], TODAY).join(), /nature must be one of/);
  assert.match(validateAoc2Rows([{ ...excelRows()[0], approvalDate: '25/11/2026' }], TODAY).join(), /future/);
  assert.throws(() => buildAoc2Excel([], { today: TODAY }), /No contract rows/);
});

test('Excel for 2 contracts keeps the template intact', () => {
  const tpl = fs.readFileSync(AOC2_TEMPLATE);
  const out = buildAoc2Excel(excelRows(), { today: TODAY });
  const before = listZip(tpl).entries, after = listZip(out).entries;
  assert.deepEqual(after.map(e => e.name), before.map(e => e.name));
  for (const e of after) {
    const b = before.find(x => x.name === e.name);
    if (e.name === 'xl/worksheets/sheet2.xml' || e.name === 'xl/sharedStrings.xml') assert.notDeepEqual(e.raw, b.raw);
    else assert.ok(e.raw.equals(b.raw), `${e.name} must be byte-identical`);
  }
  const files = readZipEntries(out);
  assert.ok(files.get('xl/vbaProject.bin').equals(readZipEntries(tpl).get('xl/vbaProject.bin')));

  const sheet = files.get('xl/worksheets/sheet2.xml').toString('utf8');
  const sst = files.get('xl/sharedStrings.xml').toString('utf8');
  const strings = sst.match(/<si>[\s\S]*?<\/si>/g).map(si => (si.match(/<t[^>]*>([^<]*)<\/t>/g) || []).map(t => t.replace(/<[^>]+>/g, '')).join(''));
  const cell = ref => { const m = new RegExp(`<c r="${ref}" s="(\\d+)"( t="s")?><v>([^<]*)</v></c>`).exec(sheet); return m && { s: +m[1], v: m[2] ? strings[+m[3]] : +m[3] }; };

  const dataRows = [...sheet.matchAll(/<row r="(\d+)"/g)].map(m => +m[1]).filter(r => r > 1);
  assert.deepEqual(dataRows, [2, 3]);
  assert.match(sheet, /<dimension ref="A1:I3"\/>/);
  assert.deepEqual(cell('A2'), { s: 12, v: 1 });
  assert.deepEqual(cell('B2'), { s: 13, v: 'ABCPR1234K' });
  assert.deepEqual(cell('C3'), { s: 13, v: 'Rao Consulting LLP' });
  assert.deepEqual(cell('E2'), { s: 13, v: LEASE });
  assert.deepEqual(cell('E3'), { s: 13, v: F.NATURES[1] });
  assert.deepEqual(cell('G2'), { s: 13, v: 'Office rent Rs 20,000 a month' });
  assert.deepEqual(cell('H3'), { s: 14, v: excelSerial('01/04/2025') });
  assert.deepEqual(cell('I2'), { s: 4, v: '0' });
  // Protection and the Lookup list validation on column E survive.
  assert.match(sheet, /<sheetProtection [^>]*sheet="1"/);
  assert.match(sheet, /<extLst>[\s\S]*<xm:f>Lookup!\$A\$4:\$A\$10<\/xm:f>[\s\S]*<xm:sqref>E2:E1048576<\/xm:sqref>/);
  // Shared-string counters: 7 text cells (B-G, I) per row; reused nature string is not duplicated.
  const [, count, unique] = /<sst count="(\d+)" uniqueCount="(\d+)"/.exec(sst);
  assert.equal(+count, 41 + 14);
  assert.equal(+unique, strings.length);
  assert.equal(strings.filter(s => s === LEASE).length, 1);
  assert.equal(strings.filter(s => s === F.NATURES[1]).length, 1);
});

const py = spawnSync('python', ['-I', '-c', 'import openpyxl'], { encoding: 'utf8' });
test('openpyxl reads the built file (optional, only when python + openpyxl exist)', { skip: py.status !== 0 && 'python/openpyxl not available' }, () => {
  const file = path.join(os.tmpdir(), `aoc2-test-${process.pid}.xlsm`);
  fs.writeFileSync(file, buildAoc2Excel(excelRows(), { today: TODAY }));
  try {
    const r = spawnSync('python', ['-I', '-c', `import openpyxl,sys,json
wb=openpyxl.load_workbook(sys.argv[1],keep_vba=True)
ws=wb['Contracts at arm length']
print(json.dumps([[str(c.value) for c in row] for row in ws.iter_rows(min_row=2, max_row=ws.max_row)]))`, file], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const rows = JSON.parse(r.stdout);
    assert.equal(rows.length, 2);
    assert.equal(rows[0][1], 'ABCPR1234K');
    assert.match(rows[1][7], /^2025-04-01/);
  } finally { fs.rmSync(file, { force: true }); }
});

// ───────────── upload page function (minimal DOM stubs) ─────────────

// inheritedClick: click lives on a parent prototype, as on real pages (HTMLElement.prototype.click).
function stubPage({ label, onClick, data, dialogs = () => [], inheritedClick = false }) {
  const saved = { window: globalThis.window, document: globalThis.document, HTMLInputElement: globalThis.HTMLInputElement,
    DataTransfer: globalThis.DataTransfer, MutationObserver: globalThis.MutationObserver };
  class Base extends EventTarget { click() { this.dispatchEvent(new Event('click')); } }
  class Input extends (inheritedClick ? Base : EventTarget) {
    constructor() { super(); this.type = 'file'; this.files = null; }
  }
  if (!inheritedClick) Input.prototype.click = Base.prototype.click;
  const origClick = Input.prototype.click;
  const button = {
    id: 'guideContainer-rootPanel-panel_1665650438-panel_526419145-panel-panel-panel_copy_copy-panel_885569515-panel_copy-panel-panel_copy-saveguidedraft_919477717___widget',
    innerText: label, disabled: false, clicked: 0,
    getAttribute: () => null, matches: () => true, getClientRects: () => [1], scrollIntoView() {},
    click() { this.clicked++; onClick && onClick(Input); },
  };
  globalThis.window = globalThis;
  globalThis.HTMLInputElement = Input;
  globalThis.DataTransfer = class { constructor() { const f = []; this.files = f; this.items = { add: x => f.push(x) }; } };
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  globalThis.document = {
    documentElement: {},
    querySelectorAll: sel => (sel.includes('saveguidedraft') ? [button] : sel.includes('role="dialog"') ? dialogs() : []),
    querySelector: sel => (sel.includes('atArmSubmitData') ? { value: data() } : null),
  };
  const restore = () => Object.assign(globalThis, saved);
  return { button, Input, Base, origClick, restore };
}
const dialog = msg => ({ innerText: msg, getClientRects: () => [1], querySelectorAll: () => [] });
// MCA's handler: opens the chooser by input.click(); `then` runs when the file arrives.
const opensChooser = then => Input => { const input = new Input(); input.addEventListener('change', () => then && then(input)); input.click(); };

test('upload refuses a button that says Submit and leaves the prototype untouched', async () => {
  const p = stubPage({ label: 'Submit', data: () => '' });
  try {
    const r = await F.pageAoc2Upload('QUJD', 'x.xlsm', 'atArm', 2, 1000);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'refused-submit');
    assert.equal(p.button.clicked, 0);
    assert.equal(p.Input.prototype.click, p.origClick);
  } finally { p.restore(); }
});

test('upload intercepts the file chooser, feeds the Excel and verifies the record count', async () => {
  let got = null, records = '';
  const p = stubPage({
    label: 'Upload',
    data: () => records,
    onClick: Input => {
      const input = new Input();
      input.addEventListener('change', () => { got = input.files[0]; records = JSON.stringify([{}, {}]); });
      input.click();   // MCA's handler opens the chooser this way
    },
  });
  try {
    const r = await F.pageAoc2Upload(Buffer.from('PK-data').toString('base64'), 'AOC-2.xlsm', 'atArm', 2, 5000);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.records, 2);
    assert.equal(r.intercepted, 1);
    assert.equal(got.name, 'AOC-2.xlsm');
    assert.equal(Buffer.from(await got.arrayBuffer()).toString(), 'PK-data');
    assert.equal(p.Input.prototype.click, p.origClick, 'click patch must be restored');
  } finally { p.restore(); }
});

test('re-run: a stale record JSON is not taken as success; MCA’s later error is seen', async () => {
  const t0 = Date.now();
  const p = stubPage({ label: 'Upload', data: () => '[{},{}]', onClick: opensChooser(),
    dialogs: () => (Date.now() - t0 > 1500 ? [dialog('Excel File donot match with the number of records')] : []) });
  try {
    const r = await F.pageAoc2Upload('QUJD', 'x.xlsm', 'atArm', 2, 5000);
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.equal(r.reason, 'mca-error');
  } finally { p.restore(); }
});

test('re-run: an unchanged value counts only with a success dialog, else times out', async () => {
  let p = stubPage({ label: 'Upload', data: () => '[{},{}]', onClick: opensChooser(), dialogs: () => [dialog('File uploaded successfully')] });
  try {
    const r = await F.pageAoc2Upload('QUJD', 'x.xlsm', 'atArm', 2, 5000);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.records, 2);
  } finally { p.restore(); }
  p = stubPage({ label: 'Upload', data: () => '[{},{}]', onClick: opensChooser() });
  try {
    const r = await F.pageAoc2Upload('QUJD', 'x.xlsm', 'atArm', 2, 1200);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'timeout');
    assert.equal(r.unchanged, true);
  } finally { p.restore(); }
});

test('an inherited click is restored by deleting the patch, not shadowing it', async () => {
  let records = '';
  const p = stubPage({ label: 'Upload', inheritedClick: true, data: () => records, onClick: opensChooser(() => { records = '[{}]'; }) });
  try {
    const r = await F.pageAoc2Upload('QUJD', 'x.xlsm', 'atArm', 1, 5000);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(Object.prototype.hasOwnProperty.call(p.Input.prototype, 'click'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(p.Input.prototype, 'showPicker'), false);
    assert.equal(new p.Input().click, p.Base.prototype.click);
  } finally { p.restore(); }
});
