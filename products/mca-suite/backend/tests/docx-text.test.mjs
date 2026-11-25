// node --test backend/tests/docx-text.test.mjs
// Builds small .docx files in memory (stored zip entries). Made-up text only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { docxToText, DocxError, isZip } from '../docx-text.js';
import { makeZip, makeDocx, p, r, cell, row } from './docx-fixture.mjs';

test('paragraphs become lines; runs join; tab and break; entities; tab stops are not text', () => {
  const buf = makeDocx([
    p(r('BOARD'), r('&#8217;S REPORT')),
    p(r('Item'), '<w:r><w:tab/></w:r>', r('one'), '<w:r><w:br/></w:r>', r('second line &amp; more')),
    '<w:p/>',
    p(r('Deleted '), '<w:r><w:delText>gone</w:delText></w:r>', r('kept')),
  ].join(''));
  const t = docxToText(buf).text;
  assert.equal(t, 'BOARD’S REPORT\nItem\tone\nsecond line & more\n\nDeleted kept');
});

test('tables become "cell | cell" rows; paragraphs inside a cell join with a space', () => {
  const buf = makeDocx([
    p(r('NUMBER OF BOARD MEETINGS HELD:')),
    '<w:tbl><w:tblPr><w:tblW w:w="0"/></w:tblPr><w:tblGrid><w:gridCol/></w:tblGrid>',
    row(cell(p(r('Date of meeting'))), cell(p(r('ASHA DEMO'))), cell(p(r('RAVI'), r(' DEMO')))),
    row(cell(p(r('10-05-25'))), cell(p(r('Present'))), cell(p(r('Absent')))),
    row(cell(p(r('Note')), p(r('two paras'))), cell('<w:p/>'), cell('<w:p/>')),
    '</w:tbl>',
    p(r('After the table.')),
  ].join(''), { deflate: true });
  const out = docxToText(buf);
  assert.equal(out.tables, 1);
  assert.equal(out.text, 'NUMBER OF BOARD MEETINGS HELD:\nDate of meeting | ASHA DEMO | RAVI DEMO\n10-05-25 | Present | Absent\nNote two paras\nAfter the table.');
});

test('automatic numbering is counted (its numbers are not in the text)', () => {
  const buf = makeDocx(`<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${r('CONSERVATION OF ENERGY')}</w:p>`);
  const out = docxToText(buf);
  assert.equal(out.numbered, 1);
  assert.equal(out.text, 'CONSERVATION OF ENERGY');
});

test('errors: empty, old .doc, not a zip, zip without document.xml; text cap', () => {
  assert.throws(() => docxToText(Buffer.alloc(0)), DocxError);
  const ole = Buffer.alloc(16); ole.writeUInt32LE(0xe011cfd0, 0); ole.writeUInt32LE(0xe11ab1a1, 4);
  assert.throws(() => docxToText(ole), /old \.doc/);
  assert.throws(() => docxToText(Buffer.from('hello world, not a zip')), /not a valid \.docx/);
  assert.throws(() => docxToText(makeZip({ 'a.txt': 'x' })), /word\/document\.xml missing/);
  assert.ok(isZip(makeZip({ 'a.txt': 'x' })));
  const big = makeDocx(Array.from({ length: 200 }, (_, i) => p(r(`Line ${i} with some words`))).join(''));
  const out = docxToText(big, { cap: 500 });
  assert.equal(out.truncated, true);
  assert.match(out.text, /truncated/);
});

test('a text box inside a paragraph: the outer paragraph keeps all its words, the box text follows it', () => {
  const box = '<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wps:txbx><w:txbxContent>'
    + p(r('BOX TEXT')) + p(r('second box line'))
    + '</w:txbxContent></wps:txbx></w:drawing></mc:Choice><mc:Fallback><w:pict><w:txbxContent>'
    + p(r('BOX TEXT')) + '</w:txbxContent></w:pict></mc:Fallback></mc:AlternateContent></w:r>';
  const buf = makeDocx([p(r('Before box. '), box, r('After box words.')), p(r('Next paragraph.'))].join(''));
  assert.equal(docxToText(buf).text, 'Before box. After box words.\nBOX TEXT\nsecond box line\nNext paragraph.');
  // inside a table cell too
  const t = makeDocx(['<w:tbl>', row(cell(p(r('Cell start '), box, r('cell end'))), cell(p(r('B')))), '</w:tbl>'].join(''));
  assert.equal(docxToText(t).text, 'Cell start cell end BOX TEXT second box line | B');
});
