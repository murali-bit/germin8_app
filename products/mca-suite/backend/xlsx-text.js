// .xlsx / .xlsm -> readable text (one block per sheet, rows as tab-separated cells).
// Pure node: reuses the zip reader from aoc2-excel.js. No new packages.
// Legacy .xls (BIFF / OLE2 compound file) is not supported.

import zlib from 'node:zlib';
import { listZip } from './aoc2-excel.js';

export const XLSX_TEXT_CAP = 400 * 1024;   // bytes of text returned at most
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;  // one inflated part (a zip bomb cannot exhaust memory)
const MAX_TOTAL_BYTES = 256 * 1024 * 1024; // all parts read from one workbook
const MAX_COL = 16383;                     // XFD, Excel's last column
const TOO_LARGE = 'This workbook is too large to read. Save only the sheets you need as a new .xlsx and upload again.';

const xmlUnesc = s => String(s)
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

const attr = (tag, name) => {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(tag);
  return m ? xmlUnesc(m[2] ?? m[3]) : null;
};

// Text of all <t> runs inside an <si> or <is> element (rich text runs joined; phonetic <rPh> skipped).
function runText(xml) {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  for (const m of clean.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)) out += m[1] ? xmlUnesc(m[1]) : '';
  return out;
}

// "AB12" -> 27 (0-based column index)
function colIndex(ref) {
  const m = /^([A-Z]+)/.exec(ref || '');
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const cellClean = v => String(v).replace(/[\t\r\n]+/g, ' ').trim();

function isOle2(buf) {
  return buf.length >= 8 && buf.readUInt32LE(0) === 0xe011cfd0 && buf.readUInt32LE(4) === 0xe11ab1a1;
}

export class XlsxError extends Error {}

/**
 * @param {Buffer} buf  bytes of an .xlsx/.xlsm file
 * @param {{cap?: number}} [opts]
 * @returns {{text: string, sheets: {name: string, rows: number}[], truncated: boolean}}
 */
export function xlsxToText(buf, { cap = XLSX_TEXT_CAP } = {}) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) throw new XlsxError('The file is empty.');
  if (isOle2(buf)) throw new XlsxError('This is an old .xls file, which is not supported. Save it as .xlsx and upload again.');
  let entries;
  try { entries = listZip(buf).entries; } catch { throw new XlsxError('This is not a valid .xlsx file. Save it as .xlsx and upload again.'); }
  const byName = new Map(entries.map(e => [e.name.replace(/^\/+/, ''), e]));
  let inflated = 0;
  const read = name => {
    const e = byName.get(name);
    if (!e) return null;
    let data;
    if (e.method === 0) data = e.compressed;
    else if (e.method === 8) {
      try { data = zlib.inflateRawSync(e.compressed, { maxOutputLength: MAX_ENTRY_BYTES }); } catch (err) {
        if (err?.code === 'ERR_BUFFER_TOO_LARGE' || /maxOutputLength|too large|Cannot create a Buffer/i.test(String(err?.message))) throw new XlsxError(TOO_LARGE);
        throw new XlsxError('This .xlsx file is damaged. Save it as .xlsx again and upload.');
      }
    } else throw new XlsxError('This .xlsx file uses a compression that is not supported. Save it as .xlsx again and upload.');
    inflated += data.length;
    if (inflated > MAX_TOTAL_BYTES) throw new XlsxError(TOO_LARGE);
    return data.toString('utf8');
  };

  const wb = read('xl/workbook.xml');
  if (!wb) throw new XlsxError('This is not an Excel workbook (xl/workbook.xml missing). Save it as .xlsx and upload again.');

  // relationship id -> target path
  const rels = new Map();
  for (const m of (read('xl/_rels/workbook.xml.rels') || '').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id'), target = attr(m[0], 'Target');
    if (!id || !target) continue;
    const t = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    rels.set(id, t);
  }

  // shared strings
  const sst = [];
  const sstXml = read('xl/sharedStrings.xml');
  if (sstXml) for (const m of sstXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)) sst.push(m[1] ? runText(m[1]) : '');

  // sheets in workbook order
  const sheetList = [];
  let idx = 0;
  for (const m of wb.matchAll(/<sheet\b[^>]*\/?>/g)) {
    idx++;
    const name = attr(m[0], 'name') || `Sheet${idx}`;
    const rid = attr(m[0], 'r:id') ?? (/\bid\s*=\s*"([^"]+)"/.exec(m[0].replace(/\bsheetId\s*=\s*"[^"]*"/, '')) || [])[1];
    const target = (rid && rels.get(rid)) || `xl/worksheets/sheet${idx}.xml`;
    sheetList.push({ name, target });
  }

  // Pieces are collected and joined once, with a running byte count: linear in the workbook size.
  const parts = [];
  let bytes = 0;
  let truncated = false;
  const sheets = [];
  const append = s => {
    if (truncated) return false;
    const n = Buffer.byteLength(s, 'utf8');
    if (bytes + n > cap) {
      // keep as much as fits (a partial UTF-8 character at the end is removed)
      const room = cap - bytes;
      if (room > 0) parts.push(Buffer.from(s, 'utf8').subarray(0, room).toString('utf8').replace(/\uFFFD$/, ''));
      truncated = true;
      return false;
    }
    parts.push(s);
    bytes += n;
    return true;
  };

  for (const { name, target } of sheetList) {
    const xml = read(target);
    if (xml == null) continue;   // chart sheets etc.
    let rowsOut = 0;
    if (!append(`${bytes ? '\n' : ''}=== Sheet: ${name} ===\n`)) { sheets.push({ name, rows: 0 }); break; }
    const sheetData = /<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/.exec(xml)?.[1] || '';
    for (const rm of sheetData.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const a = cm[1], body = cm[2] || '';
        const ref = attr(a, 'r'), type = attr(a, 't');
        let val = '';
        if (type === 'inlineStr') {
          const is = /<is\b[^>]*>([\s\S]*?)<\/is>/.exec(body);
          val = is ? runText(is[1]) : '';
        } else {
          const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body);
          const raw = v ? xmlUnesc(v[1]) : '';
          if (type === 's') val = raw === '' ? '' : (sst[Number(raw)] ?? '');
          else if (type === 'b') val = raw === '1' ? 'TRUE' : raw === '0' ? 'FALSE' : raw;
          else val = raw;   // n, str (formula string), e (error), d -> as written; formulas use cached <v>
        }
        val = cellClean(val);
        const ci = ref ? colIndex(ref) : cells.length;
        if (ci < 0 || ci > MAX_COL) continue;
        while (cells.length < ci) cells.push('');
        cells[ci] = val;
      }
      while (cells.length && cells[cells.length - 1] === '') cells.pop();
      if (!cells.length) continue;
      if (!append(cells.join('\t') + '\n')) break;
      rowsOut++;
    }
    sheets.push({ name, rows: rowsOut });
    if (truncated) break;
  }
  let text = parts.join('');
  if (truncated) text += '\n[... truncated: workbook text is larger than 400 KB ...]\n';
  return { text, sheets, truncated };
}
