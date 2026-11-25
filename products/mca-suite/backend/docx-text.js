// .docx -> plain text, for the verbatim Board's / auditor's report step (report-verbatim.js).
// Pure node: reuses the zip reader from aoc2-excel.js. No new packages. Legacy .doc (OLE2) is not supported.
//
// Output rules (the words are kept exactly as typed; only the layout is flattened):
//   - every paragraph <w:p> is one line (its <w:t> runs joined as they are, no space added between runs);
//   - <w:tab/> -> "\t", <w:br/> / <w:cr/> -> "\n", <w:noBreakHyphen/> -> "-";
//   - a table row is one line, its cells joined by " | " (paragraphs inside a cell joined by a space);
//   - deleted tracked text, field codes and the Fallback copy of text boxes are left out.
// Automatic list numbering (w:numPr) is not part of document.xml text, so "(a)" typed by hand is kept but
// numbers Word draws itself are not: `numbered` counts those paragraphs so the caller can warn.

import zlib from 'node:zlib';
import { listZip } from './aoc2-excel.js';

export const DOCX_TEXT_CAP = 400 * 1024;   // bytes of text returned at most
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;  // inflated document.xml at most (a zip bomb cannot exhaust memory)
const TOO_LARGE = 'This Word file is too large to read. Save only the report as a new .docx and upload again.';

export class DocxError extends Error {}

const xmlUnesc = s => String(s)
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

function isOle2(buf) {
  return buf.length >= 8 && buf.readUInt32LE(0) === 0xe011cfd0 && buf.readUInt32LE(4) === 0xe11ab1a1;
}

/** True when the bytes look like a zip (docx/xlsx) file. */
export const isZip = buf => Buffer.isBuffer(buf) && buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50;

function readEntry(entries, name) {
  const e = entries.find(x => x.name.replace(/^\/+/, '') === name);
  if (!e) return null;
  let data;
  if (e.method === 0) data = e.compressed;
  else if (e.method === 8) {
    try { data = zlib.inflateRawSync(e.compressed, { maxOutputLength: MAX_ENTRY_BYTES }); } catch (err) {
      if (err?.code === 'ERR_BUFFER_TOO_LARGE' || /maxOutputLength|too large|Cannot create a Buffer/i.test(String(err?.message))) throw new DocxError(TOO_LARGE);
      throw new DocxError('This .docx file is damaged. Save it as .docx again and upload.');
    }
  } else throw new DocxError('This .docx file uses a compression that is not supported. Save it as .docx again and upload.');
  if (data.length > MAX_ENTRY_BYTES) throw new DocxError(TOO_LARGE);
  return data.toString('utf8');
}

// Property blocks hold tab stops (<w:tabs><w:tab …/>) and other markup that is not text.
const stripProps = xml => xml
  .replace(/<mc:Fallback\b[\s\S]*?<\/mc:Fallback>/g, '')
  .replace(/<w:(pPr|rPr|tblPr|trPr|tcPr|sectPr|tblGrid|tblPrEx)\b[^>]*\/>/g, '')
  .replace(/<w:(pPr|rPr|tblPr|trPr|tcPr|sectPr|tblGrid|tblPrEx)\b[^>]*>[\s\S]*?<\/w:\1>/g, '')
  .replace(/<w:delText\b[^>]*>[\s\S]*?<\/w:delText>/g, '')
  .replace(/<w:instrText\b[^>]*>[\s\S]*?<\/w:instrText>/g, '');

const TOKEN = /<w:tbl\b[^>]*>|<\/w:tbl>|<w:tr\b[^>]*>|<\/w:tr>|<w:tc\b[^>]*>|<\/w:tc>|<w:p\b[^>]*\/>|<w:p\b[^>]*>|<\/w:p>|<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:(?:br|cr)\b[^>]*\/>|<w:noBreakHyphen\b[^>]*\/>/g;

/**
 * @param {Buffer} buf  bytes of a .docx file
 * @param {{cap?: number}} [opts]
 * @returns {{text: string, lines: number, tables: number, numbered: number, truncated: boolean}}
 */
export function docxToText(buf, { cap = DOCX_TEXT_CAP } = {}) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) throw new DocxError('The file is empty.');
  if (isOle2(buf)) throw new DocxError('This is an old .doc file, which is not supported. Save it as .docx and upload again.');
  let entries;
  try { entries = listZip(buf).entries; } catch { throw new DocxError('This is not a valid .docx file. Save it as .docx and upload again.'); }
  const raw = readEntry(entries, 'word/document.xml');
  if (raw == null) throw new DocxError('This is not a Word document (word/document.xml missing). Save it as .docx and upload again.');
  const numbered = (raw.match(/<w:numPr\b/g) || []).length;
  const body = /<w:body\b[^>]*>([\s\S]*)<\/w:body>/.exec(raw)?.[1] ?? raw;
  const xml = stripProps(body);

  const out = [];
  let bytes = 0, truncated = false, tables = 0;
  const emit = line => {
    if (truncated) return;
    const n = Buffer.byteLength(line, 'utf8') + 1;
    if (bytes + n > cap) { truncated = true; return; }
    out.push(line); bytes += n;
  };

  let depth = 0;           // table nesting
  let para = null;         // text of the open paragraph, or null
  let cell = null;         // paragraphs of the open top-level cell
  let row = null;          // cells of the open top-level row
  const inCell = () => depth > 0 && cell !== null;
  // A text box (w:txbxContent) holds its own <w:p> INSIDE the open paragraph: the outer paragraph is parked on
  // `stack` and resumed after the inner one ends; the box's lines are emitted right after the outer paragraph,
  // so no word of either is lost.
  const stack = [];        // [{para, after}]
  let after = [];          // text-box lines that go after the open paragraph
  const flush = (text, extra) => {
    if (inCell()) { for (const t of [text, ...extra]) if (t.trim()) cell.push(t.replace(/[\t\n]+/g, ' ').trim()); }
    else { emit(text); for (const t of extra) emit(t); }
  };
  const endPara = () => {
    if (para === null) return;
    if (stack.length) {    // end of a paragraph inside a text box: back to the outer paragraph
      const outer = stack.pop();
      outer.after.push(...after, para);
      para = outer.para; after = outer.after;
      return;
    }
    flush(para, after);
    para = null; after = [];
  };
  const endAll = () => { while (stack.length) endPara(); endPara(); };

  for (const m of xml.matchAll(TOKEN)) {
    const tok = m[0];
    if (tok.startsWith('<w:tbl')) { endAll(); if (depth === 0) tables++; depth++; }
    else if (tok === '</w:tbl>') { endAll(); depth = Math.max(0, depth - 1); }
    else if (tok.startsWith('<w:tr')) { if (depth === 1) row = []; }
    else if (tok === '</w:tr>') {
      if (depth === 1 && row) {
        while (row.length && row[row.length - 1] === '') row.pop();
        if (row.length) emit(row.join(' | '));
        row = null;
      }
    } else if (tok.startsWith('<w:tc')) { if (depth === 1) cell = []; }
    else if (tok === '</w:tc>') {
      endAll();
      if (depth === 1 && cell) { if (row) row.push(cell.join(' ')); cell = null; }
    } else if (tok.startsWith('<w:p')) {
      if (para !== null) {   // a paragraph inside the open one (text box): park the outer paragraph
        if (!tok.endsWith('/>')) { stack.push({ para, after }); para = ''; after = []; }
      } else if (tok.endsWith('/>')) { if (!inCell()) emit(''); } else para = '';
    } else if (tok === '</w:p>') endPara();
    else if (tok.startsWith('<w:tab')) { if (para !== null) para += '\t'; }
    else if (tok.startsWith('<w:br') || tok.startsWith('<w:cr')) { if (para !== null) para += '\n'; }
    else if (tok.startsWith('<w:noBreakHyphen')) { if (para !== null) para += '-'; }
    else if (para !== null) para += xmlUnesc(m[1] || '');
    if (truncated) break;
  }
  endAll();
  let text = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (truncated) text += '\n[... truncated: document text is larger than 400 KB ...]';
  return { text, lines: out.length, tables, numbered, truncated };
}
