// AOC-2 "Contracts at arm length" Excel builder.
// Fills MCA's own macro workbook (templates/aoc2-contracts-at-arm-length.xlsm) with contract rows.
// Pure node (zlib only): the zip is read and rewritten so that every entry except
// xl/worksheets/sheet2.xml and xl/sharedStrings.xml is copied byte-for-byte (vbaProject.bin,
// sheet protection, the Lookup list validation in sheet2's extLst all stay as MCA shipped them).

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const AOC2_TEMPLATE = path.join(HERE, 'templates', 'aoc2-contracts-at-arm-length.xlsm');
const SHEET = 'xl/worksheets/sheet2.xml';   // "Contracts at arm length"
const SST = 'xl/sharedStrings.xml';

// Lookup!A4:A10 of the template, verbatim (column E must be one of these).
export const AOC2_NATURES = [
  'Appointment of any agent for purchase or sale of goods, materials, services or property',
  'Availing or rendering of any services',
  'Leasing of property',
  'Related party appointment to any office or place of profit in the company, its subsidiary company or associate company',
  'Sale or purchase of Goods',
  'Sale or purchase of property',
  'Underwriting the subscription of any securities or derivatives thereof, of the company',
];

// ───────────────────────── zip ─────────────────────────

// Lists entries with their raw local chunk (header + compressed data + descriptor) and central record.
export function listZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  const cdOff = buf.readUInt32LE(eocd + 16);
  if (cdOff === 0xffffffff) throw new Error('zip64 is not supported');
  const entries = [];
  let p = cdOff;
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory');
    const n = buf.readUInt16LE(p + 28), e = buf.readUInt16LE(p + 30), c = buf.readUInt16LE(p + 32);
    const central = buf.subarray(p, p + 46 + n + e + c);
    const name = buf.toString('utf8', p + 46, p + 46 + n);
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10);
    const comp = buf.readUInt32LE(p + 20), off = buf.readUInt32LE(p + 42);
    if (buf.readUInt32LE(off) !== 0x04034b50) throw new Error('bad local header: ' + name);
    const headLen = 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    let end = off + headLen + comp;
    if (flags & 8) end += buf.readUInt32LE(end) === 0x08074b50 ? 16 : 12;   // data descriptor
    entries.push({ name, flags, method, central, headLen, raw: buf.subarray(off, end), compressed: buf.subarray(off + headLen, off + headLen + comp) });
    p += central.length;
  }
  return { entries, eocd: buf.subarray(eocd) };
}

export function entryData(entry) {
  if (entry.method === 0) return Buffer.from(entry.compressed);
  if (entry.method === 8) return zlib.inflateRawSync(entry.compressed);
  throw new Error(`unsupported compression ${entry.method} for ${entry.name}`);
}

export function readZipEntries(buf) {
  return new Map(listZip(buf).entries.map(e => [e.name, entryData(e)]));
}

// Rewrites the zip; `replace` maps entry name -> new uncompressed Buffer. Others are copied raw.
export function rewriteZip(buf, replace) {
  const { entries, eocd } = listZip(buf);
  const locals = [], centrals = [];
  let offset = 0;
  for (const e of entries) {
    let local, central;
    if (replace.has(e.name)) {
      const data = replace.get(e.name);
      const body = zlib.deflateRawSync(data, { level: 9 });
      const crc = zlib.crc32(data);
      const head = Buffer.from(e.raw.subarray(0, e.headLen));
      head.writeUInt16LE(e.flags & ~8, 6); head.writeUInt16LE(8, 8);
      head.writeUInt32LE(crc, 14); head.writeUInt32LE(body.length, 18); head.writeUInt32LE(data.length, 22);
      local = Buffer.concat([head, body]);
      central = Buffer.from(e.central);
      central.writeUInt16LE(e.flags & ~8, 8); central.writeUInt16LE(8, 10);
      central.writeUInt32LE(crc, 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(data.length, 24);
    } else {
      local = e.raw;
      central = Buffer.from(e.central);
    }
    central.writeUInt32LE(offset, 42);
    locals.push(local); centrals.push(central);
    offset += local.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.from(eocd);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// ───────────────────────── rows ─────────────────────────

const xmlEsc = s => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const xmlUnesc = s => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// "30/09/2026" -> Excel serial (days since 1899-12-30), or null.
export function excelSerial(ddmmyyyy) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(ddmmyyyy || '').trim());
  if (!m) return null;
  const t = Date.UTC(+m[3], +m[2] - 1, +m[1]);
  const d = new Date(t);
  if (d.getUTCDate() !== +m[1] || d.getUTCMonth() !== +m[2] - 1) return null;
  return Math.round((t - Date.UTC(1899, 11, 30)) / 86400000);
}

// Returns a list of problems ([] when every row is acceptable to the template's validations).
export function validateAoc2Rows(rows, today = new Date()) {
  const errs = [];
  if (!Array.isArray(rows) || !rows.length) return ['No contract rows given.'];
  const todaySerial = Math.round((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - Date.UTC(1899, 11, 30)) / 86400000);
  rows.forEach((r, i) => {
    const at = `Row ${i + 1}`;
    const s = k => String(r?.[k] ?? '').trim();
    if (!s('id')) errs.push(`${at}: ID (PAN/passport/CIN/LLPIN) is required.`);
    if (s('id').length > 50) errs.push(`${at}: ID is longer than 50 characters.`);
    if (!s('name') || s('name').length > 160) errs.push(`${at}: name is required (max 160 characters).`);
    if (!s('relationship') || s('relationship').length > 160) errs.push(`${at}: relationship is required (max 160 characters).`);
    if (!AOC2_NATURES.includes(s('nature'))) errs.push(`${at}: nature must be one of the 7 MCA values.`);
    if (!s('duration') || s('duration').length > 160) errs.push(`${at}: duration is required (max 160 characters).`);
    if (!s('terms') || s('terms').length > 500) errs.push(`${at}: salient terms are required (max 500 characters).`);
    const serial = excelSerial(s('approvalDate'));
    if (serial == null) errs.push(`${at}: board approval date must be DD/MM/YYYY.`);
    else if (serial > todaySerial) errs.push(`${at}: board approval date is in the future.`);
    const adv = s('advance') || '0';
    if (!/^\d{1,15}(\.\d{1,2})?$/.test(adv)) errs.push(`${at}: advance must be a number ≥ 0 with up to 2 decimals.`);
  });
  return errs;
}

// Builds the filled .xlsm. Throws an Error with .errors[] when rows are not valid.
export function buildAoc2Excel(rows, { today = new Date(), templatePath = AOC2_TEMPLATE } = {}) {
  const errors = validateAoc2Rows(rows, today);
  if (errors.length) { const e = new Error(errors.join(' ')); e.errors = errors; throw e; }
  const tpl = fs.readFileSync(templatePath);
  const { entries } = listZip(tpl);
  const get = name => { const e = entries.find(x => x.name === name); if (!e) throw new Error('template is missing ' + name); return entryData(e).toString('utf8'); };
  let sst = get(SST), sheet = get(SHEET);

  // Existing plain strings are reused (e.g. the 7 "nature" values); new ones are appended.
  const items = sst.match(/<si>[\s\S]*?<\/si>/g) || [];
  const index = new Map();
  items.forEach((si, i) => { const m = /^<si><t(?: [^>]*)?>([^<]*)<\/t><\/si>$/.exec(si); if (m && !index.has(xmlUnesc(m[1]))) index.set(xmlUnesc(m[1]), i); });
  const added = [];
  let refs = 0;
  const str = v => {
    v = String(v ?? '');
    refs++;
    if (!index.has(v)) { index.set(v, items.length + added.length); added.push(`<si><t xml:space="preserve">${xmlEsc(v)}</t></si>`); }
    return index.get(v);
  };
  const xml = rows.map((r, i) => {
    const n = i + 2, s = k => String(r[k] ?? '').trim();
    const t = (col, style, v) => `<c r="${col}${n}" s="${style}" t="s"><v>${str(v)}</v></c>`;
    return `<row r="${n}" spans="1:9">`
      + `<c r="A${n}" s="12"><v>${i + 1}</v></c>`
      + t('B', 13, s('id').toUpperCase()) + t('C', 13, s('name')) + t('D', 13, s('relationship'))
      + t('E', 13, s('nature')) + t('F', 13, s('duration')) + t('G', 13, s('terms'))
      + `<c r="H${n}" s="14"><v>${excelSerial(s('approvalDate'))}</v></c>`
      + t('I', 4, s('advance') || '0')
      + '</row>';
  }).join('');

  sst = sst.replace(/<\/sst>\s*$/, added.join('') + '</sst>')
    .replace(/(<sst\b[^>]*?\bcount=")(\d+)"/, (_, a, c) => `${a}${+c + refs}"`)
    .replace(/(<sst\b[^>]*?\buniqueCount=")(\d+)"/, (_, a, c) => `${a}${+c + added.length}"`);
  if (!sheet.includes('</sheetData>')) throw new Error('template sheet has no sheetData');
  sheet = sheet.replace('</sheetData>', xml + '</sheetData>')
    .replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:I${rows.length + 1}"/>`);

  return rewriteZip(tpl, new Map([[SST, Buffer.from(sst, 'utf8')], [SHEET, Buffer.from(sheet, 'utf8')]]));
}
