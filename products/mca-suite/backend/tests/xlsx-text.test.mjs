// node --test backend/tests/xlsx-text.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import fs from 'node:fs';
import { xlsxToText, XlsxError } from '../xlsx-text.js';
import { AOC2_TEMPLATE } from '../aoc2-excel.js';
import { handle } from '../routes/scan-files.js';

// Minimal zip writer (deflate) for test fixtures.
function makeZip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, 'utf8');
    const body = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    const local = Buffer.concat([lh, nameBuf, body]);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([ch, nameBuf]));
    locals.push(local);
    offset += local.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(centrals.length, 8); eocd.writeUInt16LE(centrals.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const WB = `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Balance Sheet" sheetId="1" r:id="rId1"/><sheet name="P&amp;L" sheetId="2" r:id="rId2"/></sheets></workbook>`;
const RELS = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="x/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="x/worksheet" Target="/xl/worksheets/sheet2.xml"/>
<Relationship Id="rId3" Type="x/sharedStrings" Target="sharedStrings.xml"/></Relationships>`;
const SST = `<?xml version="1.0"?><sst xmlns="x" count="4" uniqueCount="4">
<si><t>CIN</t></si><si><t>U01100KA2019PTC000001</t></si>
<si><r><t>Share </t></r><r><rPr><b/></rPr><t xml:space="preserve">capital</t></r></si><si><t>Revenue &amp; other income</t></si></sst>`;
const S1 = `<?xml version="1.0"?><worksheet xmlns="x"><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
<row r="2"><c r="A2"/><c r="B2"/></row>
<row r="3"><c r="A3" t="s"><v>2</v></c><c r="C3"><v>100000</v></c></row>
<row r="4"><c r="A4" t="inlineStr"><is><t>As at</t></is></c><c r="B4" s="3"><v>46112</v></c></row>
<row r="5"><c r="A5" t="str"><f>A1&amp;"x"</f><v>CINx</v></c><c r="B5"><f>C3*2</f><v>200000</v></c><c r="C5" t="b"><v>1</v></c></row>
</sheetData></worksheet>`;
const S2 = `<?xml version="1.0"?><worksheet xmlns="x"><sheetData>
<row r="2"><c r="B2" t="s"><v>3</v></c><c r="D2"><v>1234.5</v></c></row>
</sheetData></worksheet>`;

const tiny = () => makeZip({
  '[Content_Types].xml': '<Types/>',
  'xl/workbook.xml': WB, 'xl/_rels/workbook.xml.rels': RELS, 'xl/sharedStrings.xml': SST,
  'xl/worksheets/sheet1.xml': S1, 'xl/worksheets/sheet2.xml': S2,
});

test('tiny workbook: sheets, shared/inline strings, numbers, formulas, empty rows skipped', () => {
  const { text, sheets, truncated } = xlsxToText(tiny());
  assert.equal(truncated, false);
  assert.deepEqual(sheets, [{ name: 'Balance Sheet', rows: 4 }, { name: 'P&L', rows: 1 }]);
  assert.equal(text,
    '=== Sheet: Balance Sheet ===\n' +
    'CIN\tU01100KA2019PTC000001\n' +
    'Share capital\t\t100000\n' +
    'As at\t46112\n' +
    'CINx\t200000\tTRUE\n' +
    '\n=== Sheet: P&L ===\n' +
    '\tRevenue & other income\t\t1234.5\n');
});

test('cap truncates the text', () => {
  const rows = Array.from({ length: 2000 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}" t="inlineStr"><is><t>row number ${i} with some padding text</t></is></c></row>`).join('');
  const buf = makeZip({
    'xl/workbook.xml': '<workbook><sheets><sheet name="Big" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${rows}</sheetData></worksheet>`,
  });
  const r = xlsxToText(buf, { cap: 2000 });
  assert.equal(r.truncated, true);
  assert.ok(Buffer.byteLength(r.text) < 2200);
  assert.match(r.text, /truncated/);
});

test('legacy .xls and non-zip give a clear error', () => {
  const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
  assert.throws(() => xlsxToText(ole), e => e instanceof XlsxError && /Save it as \.xlsx/.test(e.message));
  assert.throws(() => xlsxToText(Buffer.from('hello world, not a zip')), e => e instanceof XlsxError && /Save it as \.xlsx/.test(e.message));
  assert.throws(() => xlsxToText(makeZip({ 'a.txt': 'x' })), XlsxError);
});

test('real MCA template (.xlsm) reads', () => {
  if (!fs.existsSync(AOC2_TEMPLATE)) return;
  const { text, sheets } = xlsxToText(fs.readFileSync(AOC2_TEMPLATE));
  assert.ok(sheets.length >= 2);
  assert.match(text, /=== Sheet: /);
  assert.match(text, /Sale or purchase of Goods/);
});

// ── route ──
function fakeCall(body, { method = 'POST', pathname = '/api/scan/xlsx-text' } = {}) {
  const out = {};
  const ctx = {
    pathname, method,
    sendJson: (res, status, data) => { out.status = status; out.data = data; },
    parseJsonBody: async () => body,
  };
  return handle({}, {}, ctx).then(handled => ({ handled, ...out }));
}

test('route: other paths are not handled', async () => {
  const r = await fakeCall({}, { pathname: '/api/health' });
  assert.equal(r.handled, false);
});

test('route: converts base64 xlsx', async () => {
  const r = await fakeCall({ fileName: 'tb.xlsx', base64: tiny().toString('base64') });
  assert.equal(r.handled, true);
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
  assert.equal(r.data.sheets.length, 2);
  assert.match(r.data.text, /U01100KA2019PTC000001/);
});

test('route: errors are plain and 4xx', async () => {
  let r = await fakeCall({ fileName: 'old.xls', base64: 'AAAA' });
  assert.equal(r.status, 400); assert.match(r.data.message, /Save it as \.xlsx/);
  r = await fakeCall({ fileName: 'x.xlsx' });
  assert.equal(r.status, 400);
  r = await fakeCall({ fileName: 'x.xlsx', base64: Buffer.from('nope').toString('base64') });
  assert.equal(r.status, 400); assert.equal(r.data.ok, false);
  r = await fakeCall({}, { method: 'GET' });
  assert.equal(r.status, 405);
});

// ── untrusted input: size and speed ──
const oneSheet = sheetXml => makeZip({
  'xl/workbook.xml': '<workbook><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
  'xl/worksheets/sheet1.xml': sheetXml,
});

test('a cell beyond column XFD is ignored (no huge row allocation)', () => {
  const r = xlsxToText(oneSheet('<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c><c r="ZZZZZZZ1"><v>2</v></c><c r="ZZZZ1"><v>3</v></c></row></sheetData></worksheet>'));
  assert.equal(r.text, '=== Sheet: S ===\n1\n');
});

test('a zip bomb part is refused with a plain message', () => {
  const big = '<worksheet><sheetData>' + ' '.repeat(70 * 1024 * 1024) + '</sheetData></worksheet>';
  assert.throws(() => xlsxToText(oneSheet(big)), e => e instanceof XlsxError && /too large to read/.test(e.message));
});

test('30,000 rows convert in linear time', () => {
  const rows = Array.from({ length: 30000 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>${i}</v></c><c r="B${i + 1}"><v>${i * 2}</v></c></row>`).join('');
  const t0 = Date.now();
  const r = xlsxToText(oneSheet(`<worksheet><sheetData>${rows}</sheetData></worksheet>`));
  assert.equal(r.sheets[0].rows, 30000);
  assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0} ms`);
});
