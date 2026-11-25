// Reading the headings (first row of the first sheet) of the official Zoho Books sample import files in zoho-samples/
// (public Zoho material). Zoho names every workbook ".xls"; some are .xlsx workbooks (a zip archive) and some are
// old-style Excel 97-2003 workbooks (a compound file holding a BIFF8 "Workbook" stream). Both are read here without any
// library, only as far as the first row needs.
import fs from 'node:fs';
import zlib from 'node:zlib';

// The first line of a CSV file, split into cells exactly as written (quotes removed, nothing trimmed).
export function csvHeadings(file) {
  let text = fs.readFileSync(file, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const out = []; let cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c; }
    else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cell); cell = ''; }
    else if (c === '\r' || c === '\n') break;
    else cell += c;
  }
  out.push(cell);
  return out;
}

// ---------- old-style .xls: compound file, then BIFF8 records ----------
const END = 0xfffffffa; // sector ids at or above this mark the end of a chain (or free sectors)
function compoundStream(buf, wanted) {
  if (buf.readUInt32LE(0) !== 0xe011cfd0) throw new Error('not a compound file');
  const sec = 1 << buf.readUInt16LE(30), mini = 1 << buf.readUInt16LE(32);
  const dirStart = buf.readUInt32LE(48), cutoff = buf.readUInt32LE(56), miniFatStart = buf.readUInt32LE(60);
  const at = s => (s + 1) * sec;
  const fatSectors = [];
  for (let i = 0; i < 109; i++) { const v = buf.readUInt32LE(76 + 4 * i); if (v < END) fatSectors.push(v); }
  for (let d = buf.readUInt32LE(68); d < END; d = buf.readUInt32LE(at(d) + sec - 4)) {
    for (let j = 0; j < sec / 4 - 1; j++) { const v = buf.readUInt32LE(at(d) + 4 * j); if (v < END) fatSectors.push(v); }
  }
  const fat = [];
  for (const s of fatSectors) for (let j = 0; j < sec / 4; j++) fat.push(buf.readUInt32LE(at(s) + 4 * j));
  const chain = (start, table) => { const out = []; for (let s = start; s < END && out.length <= table.length; s = table[s]) out.push(s); return out; };
  const read = start => Buffer.concat(chain(start, fat).map(s => buf.subarray(at(s), at(s) + sec)));
  const dir = read(dirStart);
  const entries = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const nameLen = dir.readUInt16LE(o + 64);
    entries.push({ name: dir.toString('utf16le', o, o + Math.max(0, nameLen - 2)), type: dir[o + 66], start: dir.readUInt32LE(o + 116), size: dir.readUInt32LE(o + 120) });
  }
  const e = entries.find(x => x.type === 2 && wanted.includes(x.name));
  if (!e) throw new Error(`no ${wanted.join(' or ')} stream`);
  if (e.size >= cutoff) return read(e.start).subarray(0, e.size);
  const root = entries[0];
  const miniStream = read(root.start);
  const miniFatBuf = read(miniFatStart);
  const miniFat = Array.from({ length: miniFatBuf.length / 4 }, (_, i) => miniFatBuf.readUInt32LE(4 * i));
  return Buffer.concat(chain(e.start, miniFat).map(s => miniStream.subarray(s * mini, (s + 1) * mini))).subarray(0, e.size);
}
function biffRecords(wb, from = 0) {
  const out = [];
  for (let p = from; p + 4 <= wb.length;) {
    const type = wb.readUInt16LE(p), len = wb.readUInt16LE(p + 2);
    out.push({ type, offset: p, data: wb.subarray(p + 4, p + 4 + len) });
    p += 4 + len;
    if (type === 0x000a && from) break; // EOF of the sheet
  }
  return out;
}
// The shared string table (SST record and its CONTINUE records). A string's characters may run on into the next
// CONTINUE record, which then starts with its own one-byte "16-bit characters" flag.
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
export function xlsHeadings(file) {
  const wb = compoundStream(fs.readFileSync(file), ['Workbook', 'Book']);
  const records = biffRecords(wb);
  const sst = sharedStrings(records);
  const sheet = records.find(r => r.type === 0x0085); // the first BOUNDSHEET: where the first sheet starts
  const row = [];
  for (const r of biffRecords(wb, sheet.data.readUInt32LE(0))) {
    if (r.data.length < 6 || r.data.readUInt16LE(0) !== 0) continue; // only row 1
    const col = r.data.readUInt16LE(2);
    if (r.type === 0x00fd) row[col] = sst[r.data.readUInt32LE(6)];
    else if (r.type === 0x0204) { const len = r.data.readUInt16LE(6), wide = r.data[8] & 1; row[col] = wide ? r.data.toString('utf16le', 9, 9 + 2 * len) : r.data.toString('latin1', 9, 9 + len); }
  }
  while (row.length && (row[row.length - 1] == null || row[row.length - 1] === '')) row.pop();
  return Array.from(row, x => x ?? '');
}

// ---------- .xlsx (zip) ----------
function unzip(file, name) {
  const buf = fs.readFileSync(file);
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    if (buf.toString('utf8', p + 46, p + 46 + nameLen) === name) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      return (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`${name} not found in ${file}`);
}
const xmlText = s => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
export function xlsxHeadings(file) {
  const shared = [...unzip(file, 'xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => xmlText([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')));
  const row = unzip(file, 'xl/worksheets/sheet1.xml').match(/<row [^>]*r="1"[^>]*>([\s\S]*?)<\/row>/)[1];
  const out = [];
  for (const m of row.matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const ref = m[1].match(/r="([A-Z]+)1"/)[1];
    const col = [...ref].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    const type = (m[1].match(/t="([^"]+)"/) || [])[1];
    const v = (m[2] || '').match(/<v>([\s\S]*?)<\/v>/)?.[1];
    out[col] = type === 's' ? shared[Number(v)] : type === 'inlineStr' ? xmlText((m[2] || '').match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] || '') : xmlText(v ?? '');
  }
  while (out.length && (out[out.length - 1] == null || out[out.length - 1] === '')) out.pop();
  return out;
}
// Any sample: an .xls may be either kind.
export const sampleHeadings = file => (/\.csv$/i.test(file) ? csvHeadings(file)
  : fs.readFileSync(file).readUInt32LE(0) === 0x04034b50 ? xlsxHeadings(file) : xlsHeadings(file));

// The "Field Explanation" sheet of an .xlsx sample (customers and vendors): one entry per field, as Zoho's Map Fields page
// names it. Returns [{ name, mandatory }] or null when the workbook has no such sheet (old-style .xls and CSV samples).
export function fieldExplanation(file) {
  if (/\.csv$/i.test(file) || fs.readFileSync(file).readUInt32LE(0) !== 0x04034b50) return null;
  const shared = [...unzip(file, 'xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => xmlText([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')));
  let sheet;
  try { sheet = unzip(file, 'xl/worksheets/sheet2.xml'); } catch { return null; }
  const rows = [...sheet.matchAll(/<row [^>]*>([\s\S]*?)<\/row>/g)].map(r => {
    const cells = [];
    for (const c of r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const col = [...c[1].match(/r="([A-Z]+)\d+"/)[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const v = (c[2] || '').match(/<v>([\s\S]*?)<\/v>/)?.[1];
      cells[col] = /t="s"/.test(c[1]) ? shared[Number(v)] : xmlText(v ?? '');
    }
    return cells;
  });
  const head = rows[0] || [];
  const mandatoryCol = head.findIndex(h => /mandatory/i.test(h || ''));
  return rows.slice(1).filter(r => r[0] && r[mandatoryCol] != null && /^(yes|no)$/i.test(String(r[mandatoryCol]).trim()))
    .map(r => ({ name: r[0], mandatory: /^yes$/i.test(String(r[mandatoryCol]).trim()) }));
}
