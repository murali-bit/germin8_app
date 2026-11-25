// Reading a table from a file someone downloaded from Zoho Books (an error file or a report), without any library.
// Zoho's real export layouts are not known yet, so the reader is tolerant about the container and leaves the meaning
// of the columns to the caller:
//  - CSV: UTF-8 (with or without a byte order mark) or UTF-16 with a byte order mark; the separator is a comma, a
//    semicolon or a tab, whichever splits the first lines into the same number of cells most often.
//  - XLSX (a zip archive): the first worksheet of the workbook.
//  - XLS (an old-style Excel 97-2003 workbook): the first worksheet, text and number cells.
// Returns { format: 'csv' | 'xlsx' | 'xls', rows: [[cell text]] } with every completely empty row left out, or
// { error } in words when the file cannot be read. Cell text is returned as written (numbers as their shortest
// decimal text); nothing is trimmed or converted here.
import zlib from 'node:zlib';

export const MAX_ROWS = 200000;
// Limits (M7, M8). A file downloaded from Zoho Books is a few megabytes at most; anything far beyond that is refused
// with a plain message instead of being read into memory.
//  MAX_COLUMNS: the highest column a cell may sit in. A cell that claims a row or column beyond the limits is refused
//    (a tiny crafted workbook can name row 1,000,000,000, which would otherwise allocate a huge table).
//  MAX_FILE_BYTES: the size of the uploaded file. MAX_ZIP_ENTRIES: files inside an .xlsx.
//  MAX_ENTRY_BYTES / MAX_UNZIPPED_BYTES: the unpacked size of one file inside an .xlsx, and of all of them read
//    (a "zip bomb" of a few hundred kilobytes can unpack to hundreds of megabytes).
export const MAX_COLUMNS = 2000;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 2000;
export const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
export const MAX_UNZIPPED_BYTES = 128 * 1024 * 1024;
const mb = n => `${Math.round(n / (1024 * 1024))} MB`;
// An error meant for the person who uploaded the file (said as it is, without "could not be read (...)").
class TableLimit extends Error {}

export function readTable(buf) {
  if (!Buffer.isBuffer(buf) || !buf.length) return { error: 'The file is empty.' };
  if (buf.length > MAX_FILE_BYTES) return { error: `The file is larger than ${mb(MAX_FILE_BYTES)}, which is more than a Zoho Books error file or report can be. Upload the file as Zoho Books gave it.` };
  try {
    if (buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50) return { format: 'xlsx', rows: dropEmpty(readXlsx(buf)) };
    if (buf.length > 8 && buf.readUInt32LE(0) === 0xe011cfd0) return { format: 'xls', rows: dropEmpty(readXls(buf)) };
    const text = decodeText(buf);
    if (/^\s*<(!doctype|html|table)/i.test(text)) return { error: 'The file is a web page saved with a spreadsheet name. Open it in Excel and save it as CSV or XLSX, then upload it again.' };
    return { format: 'csv', rows: dropEmpty(parseDelimited(text)) };
  } catch (e) {
    // Every reading error ends here: the request is answered with a message, the server keeps running.
    if (e instanceof TableLimit) return { error: e.message };
    const tooBig = e instanceof RangeError || /buffer|memory|maxOutputLength|string length/i.test(String(e?.message));
    return { error: tooBig
      ? 'The file is too large to read once it is unpacked. Open it in Excel, save only the sheet you need as CSV or XLSX, and upload that.'
      : `The file looks like an Excel workbook but could not be read (${e.message}). Open it in Excel and save it as CSV or XLSX, then upload it again.` };
  }
}

const dropEmpty = rows => rows.filter(r => r.some(c => String(c ?? '').trim() !== '')).slice(0, MAX_ROWS).map(r => Array.from(r, c => (c == null ? '' : String(c))));

export function decodeText(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le', 2);
  if (buf[0] === 0xfe && buf[1] === 0xff) { const b = Buffer.from(buf.subarray(2)); b.swap16(); return b.toString('utf16le'); }
  let t = buf.toString('utf8');
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  return t;
}

// The separator that gives the same number of cells (more than one) on most of the first lines.
function separatorOf(text) {
  const lines = text.split(/\r\n|\r|\n/).filter(l => l.trim()).slice(0, 20);
  let best = ',', bestScore = -1;
  for (const sep of [',', ';', '\t']) {
    const counts = lines.map(l => splitLine(l, sep).length);
    const freq = new Map();
    for (const c of counts) if (c > 1) freq.set(c, (freq.get(c) || 0) + 1);
    const score = Math.max(0, ...freq.values());
    if (score > bestScore) { best = sep; bestScore = score; }
  }
  return best;
}
function splitLine(line, sep) {
  const out = []; let cell = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) { if (c === '"' && line[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c; }
    else if (c === '"') quoted = true;
    else if (c === sep) { out.push(cell); cell = ''; }
    else cell += c;
  }
  out.push(cell);
  return out;
}
export function parseDelimited(text, sep = separatorOf(text)) {
  const table = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = ''; table.push(row); row = [];
    } else cell += c;
  }
  row.push(cell); table.push(row);
  return table;
}

// ---------- .xlsx ----------
function zipEntries(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('no zip directory');
  const count = buf.readUInt16LE(eocd + 10);
  if (count > MAX_ZIP_ENTRIES) throw new TableLimit(`The workbook holds ${count} files inside it, more than the ${MAX_ZIP_ENTRIES} a spreadsheet can reasonably have. Open it in Excel, save it as CSV or XLSX, and upload that.`);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  let unpacked = 0; // bytes unpacked so far, over every file read from the archive
  const tooLarge = () => new TableLimit(`The workbook is too large once it is unpacked (more than ${mb(MAX_ENTRY_BYTES)} for one sheet, or ${mb(MAX_UNZIPPED_BYTES)} in all). Open it in Excel, save only the sheet you need as CSV or XLSX, and upload that.`);
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('damaged zip directory');
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), declared = buf.readUInt32LE(p + 24), nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    out.set(name, () => {
      // the size the archive declares is checked first; the unpacking itself is capped as well, because the
      // declared size can be false (M8: a 400 KB file that unpacks to 400 MB)
      if (declared > MAX_ENTRY_BYTES || unpacked + declared > MAX_UNZIPPED_BYTES) throw tooLarge();
      if (local + 30 > buf.length) throw new Error('damaged zip entry');
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      let raw;
      try { raw = method === 8 ? zlib.inflateRawSync(data, { maxOutputLength: Math.min(MAX_ENTRY_BYTES, MAX_UNZIPPED_BYTES - unpacked) }) : data; }
      catch (e) { if (e instanceof RangeError || e?.code === 'ERR_BUFFER_TOO_LARGE') throw tooLarge(); throw e; }
      unpacked += raw.length;
      if (raw.length > MAX_ENTRY_BYTES || unpacked > MAX_UNZIPPED_BYTES) throw tooLarge();
      return raw.toString('utf8');
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
const xmlText = s => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&');
const runText = xml => xmlText([...xml.replace(/<rPh[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(t => t[1]).join(''));
const colIndex = ref => [...ref].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
function readXlsx(buf) {
  const files = zipEntries(buf);
  const get = name => files.get(name)?.();
  // the first worksheet named in the workbook, else sheet1
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const wb = get('xl/workbook.xml'), rels = get('xl/_rels/workbook.xml.rels');
  const firstId = wb?.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1];
  if (firstId && rels) {
    const target = [...rels.matchAll(/<Relationship\b([^>]*)\/?>/g)].map(m => m[1]).find(a => a.includes(`Id="${firstId}"`))?.match(/Target="([^"]+)"/)?.[1];
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  }
  const xml = get(sheetPath) ?? get([...files.keys()].find(k => /^xl\/worksheets\/[^/]+\.xml$/.test(k)) || '');
  if (!xml) throw new Error('no worksheet');
  const sst = get('xl/sharedStrings.xml');
  const shared = sst ? [...sst.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => runText(m[1])) : [];
  // Rows are collected in file order as a dense list (M7): the row and column a cell CLAIMS are only used to place it
  // inside the limits. A workbook that names a row or column beyond them is refused, never allocated.
  const found = []; // [{ r, cells }]
  let nextRow = 0;
  for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const claimed = rm[1].match(/\br="(\d+)"/)?.[1];
    const r = claimed ? Number(claimed) - 1 : nextRow;
    if (!Number.isSafeInteger(r) || r < 0 || r >= MAX_ROWS) throw new TableLimit(`The sheet has a row numbered ${claimed}, beyond the ${MAX_ROWS.toLocaleString('en-IN')} rows this platform reads. Open it in Excel, keep only the rows of the report, save it as CSV or XLSX, and upload that.`);
    nextRow = r + 1;
    const row = [];
    let next = 0;
    for (const m of (rm[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = m[1].match(/\br="([A-Z]+)\d+"/)?.[1];
      const col = ref ? colIndex(ref) : next;
      if (!Number.isSafeInteger(col) || col < 0 || col >= MAX_COLUMNS) throw new TableLimit(`The sheet has a cell in column ${ref || col + 1}, beyond the ${MAX_COLUMNS.toLocaleString('en-IN')} columns this platform reads. Open it in Excel, keep only the columns of the report, save it as CSV or XLSX, and upload that.`);
      next = col + 1;
      const type = m[1].match(/\bt="([^"]+)"/)?.[1];
      const v = (m[2] || '').match(/<v>([\s\S]*?)<\/v>/)?.[1];
      row[col] = type === 's' ? shared[Number(v)] ?? '' : type === 'inlineStr' ? runText((m[2] || '').match(/<is>([\s\S]*?)<\/is>/)?.[1] || '')
        : type === 'b' ? (v === '1' ? 'TRUE' : 'FALSE') : xmlText(v ?? '');
    }
    found.push({ r, cells: Array.from(row, x => x ?? '') });
    if (found.length > MAX_ROWS) break;
  }
  // in row order; a row number met twice keeps the later cells (as a spreadsheet would show them)
  const byRow = new Map(found.map(f => [f.r, f.cells]));
  return [...byRow.keys()].sort((a, b) => a - b).map(r => byRow.get(r));
}

// ---------- old-style .xls: compound file, then BIFF8 records ----------
const END = 0xfffffffa;
function compoundStream(buf, wanted) {
  const sec = 1 << buf.readUInt16LE(30), mini = 1 << buf.readUInt16LE(32);
  const dirStart = buf.readUInt32LE(48), cutoff = buf.readUInt32LE(56), miniFatStart = buf.readUInt32LE(60);
  const at = s => (s + 1) * sec;
  const fatSectors = [];
  for (let i = 0; i < 109; i++) { const v = buf.readUInt32LE(76 + 4 * i); if (v < END) fatSectors.push(v); }
  for (let d = buf.readUInt32LE(68), n = 0; d < END && n < 10000; d = buf.readUInt32LE(at(d) + sec - 4), n++) {
    for (let j = 0; j < sec / 4 - 1; j++) { const v = buf.readUInt32LE(at(d) + 4 * j); if (v < END) fatSectors.push(v); }
  }
  const fat = [];
  for (const s of fatSectors) for (let j = 0; j < sec / 4 && at(s) + 4 * j + 4 <= buf.length; j++) fat.push(buf.readUInt32LE(at(s) + 4 * j));
  const chain = (start, table) => { const out = []; for (let s = start; s < END && out.length <= table.length; s = table[s]) out.push(s); return out; };
  const read = start => Buffer.concat(chain(start, fat).map(s => buf.subarray(at(s), at(s) + sec)));
  const dir = read(dirStart);
  const entries = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const nameLen = dir.readUInt16LE(o + 64);
    entries.push({ name: dir.toString('utf16le', o, o + Math.max(0, nameLen - 2)), type: dir[o + 66], start: dir.readUInt32LE(o + 116), size: dir.readUInt32LE(o + 120) });
  }
  const e = entries.find(x => x.type === 2 && wanted.includes(x.name));
  if (!e) throw new Error('no workbook stream');
  if (e.size >= cutoff) return read(e.start).subarray(0, e.size);
  const miniStream = read(entries[0].start);
  const miniFatBuf = read(miniFatStart);
  const miniFat = Array.from({ length: miniFatBuf.length / 4 }, (_, i) => miniFatBuf.readUInt32LE(4 * i));
  return Buffer.concat(chain(e.start, miniFat).map(s => miniStream.subarray(s * mini, (s + 1) * mini))).subarray(0, e.size);
}
function biffRecords(wb, from = 0) {
  const out = [];
  for (let p = from; p + 4 <= wb.length;) {
    const type = wb.readUInt16LE(p), len = wb.readUInt16LE(p + 2);
    out.push({ type, data: wb.subarray(p + 4, p + 4 + len) });
    p += 4 + len;
    if (type === 0x000a && from) break;
  }
  return out;
}
function sharedStrings(records) {
  const i = records.findIndex(r => r.type === 0x00fc);
  if (i < 0) return [];
  const segs = [records[i].data];
  for (let k = i + 1; k < records.length && records[k].type === 0x003c; k++) segs.push(records[k].data);
  let si = 0, p = 0;
  const seg = () => segs[si];
  const next = () => { while (p >= seg().length && si < segs.length - 1) { si++; p = 0; } };
  const u8 = () => { next(); return seg()[p++]; };
  const u16 = () => u8() | (u8() << 8);
  const u32 = () => u16() + u16() * 65536;
  u32(); const unique = u32();
  const out = [];
  for (let n = 0; n < unique; n++) {
    const cch = u16(), flags = u8();
    let wide = flags & 1;
    const runs = flags & 8 ? u16() : 0, ext = flags & 4 ? u32() : 0;
    let text = '', left = cch;
    while (left > 0) {
      if (p >= seg().length) { si++; p = 0; wide = seg()[p++] & 1; }
      const avail = wide ? Math.floor((seg().length - p) / 2) : seg().length - p;
      const take = Math.min(avail, left);
      text += wide ? seg().toString('utf16le', p, p + 2 * take) : seg().toString('latin1', p, p + take);
      p += wide ? 2 * take : take; left -= take;
    }
    for (let k = 0; k < runs * 4 + ext; k++) u8();
    out.push(text);
  }
  return out;
}
const numberText = v => (Number.isFinite(v) ? (Number.isInteger(v) ? String(v) : String(v)) : '');
function rkValue(rk) {
  let v;
  if (rk & 2) v = (rk | 0) >> 2;
  else { const b = Buffer.alloc(8); b.writeUInt32LE((rk & 0xfffffffc) >>> 0, 4); v = b.readDoubleLE(0); }
  return rk & 1 ? v / 100 : v;
}
function readXls(buf) {
  const wb = compoundStream(buf, ['Workbook', 'Book']);
  const records = biffRecords(wb);
  const sst = sharedStrings(records);
  const sheet = records.find(r => r.type === 0x0085);
  if (!sheet) throw new Error('no worksheet');
  const rows = [];
  const put = (r, c, v) => { if (c < MAX_COLUMNS) (rows[r] ||= [])[c] = v; };
  let pendingString = null; // a FORMULA whose result is text: the text follows in a STRING record
  for (const r of biffRecords(wb, sheet.data.readUInt32LE(0))) {
    const d = r.data;
    if (r.type === 0x0207 && pendingString) {
      const len = d.readUInt16LE(0), wide = d[2] & 1;
      put(pendingString.r, pendingString.c, wide ? d.toString('utf16le', 3, 3 + 2 * len) : d.toString('latin1', 3, 3 + len));
      pendingString = null; continue;
    }
    if (d.length < 6) continue;
    const row = d.readUInt16LE(0), col = d.readUInt16LE(2);
    if (row > MAX_ROWS) continue;
    if (r.type === 0x00fd) put(row, col, sst[d.readUInt32LE(6)] ?? '');
    else if (r.type === 0x0204) { const len = d.readUInt16LE(6), wide = d[8] & 1; put(row, col, wide ? d.toString('utf16le', 9, 9 + 2 * len) : d.toString('latin1', 9, 9 + len)); }
    else if (r.type === 0x0203) put(row, col, numberText(d.readDoubleLE(6)));
    else if (r.type === 0x027e) put(row, col, numberText(rkValue(d.readUInt32LE(6))));
    else if (r.type === 0x00bd) {
      const last = d.readUInt16LE(d.length - 2);
      for (let c = col, o = 4; c <= last && o + 6 <= d.length - 2; c++, o += 6) put(row, c, numberText(rkValue(d.readUInt32LE(o + 2))));
    } else if (r.type === 0x0006) {
      if (d.readUInt16LE(12) === 0xffff) { if (d[6] === 0) pendingString = { r: row, c: col }; }
      else put(row, col, numberText(d.readDoubleLE(6)));
    }
  }
  return Array.from(rows, x => Array.from(x || [], c => c ?? ''));
}

// ---------- finding columns by their heading ----------
// A heading compared without capital letters, spaces and punctuation ("Invoice Number" = "invoice_number").
export const headingKey = h => String(h ?? '').toLowerCase().replace(/[^a-z0-9%]+/g, '');
