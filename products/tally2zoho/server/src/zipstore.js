// A zip file with every entry stored (not compressed), written with no library: local headers, the central
// directory and the end record, CRC-32 from node:zlib. Enough for "Download all": a handful of CSV files that any
// zip reader opens (Windows Explorer, PowerShell Expand-Archive, Python's zipfile).
// Limits of the plain zip format (no zip64): at most 65,535 entries, and 4 GB in all. Both are refused, not truncated.
import zlib from 'node:zlib';

const MAX_ENTRIES = 0xffff;
const MAX_BYTES = 0xffffffff;

// entries: [{ name: 'folder/file.csv', data: Buffer | string }]. date: the modification time written for every entry.
// Names are written as UTF-8 (general purpose bit 11), with forward slashes and no leading slash or "..".
export function zipStore(entries, date = new Date()) {
  if (!Array.isArray(entries) || entries.length > MAX_ENTRIES) throw new Error('Too many files for one zip.');
  const seen = new Set();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const locals = [], centrals = [];
  let offset = 0;
  for (const e of entries) {
    const clean = String(e.name ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!clean || clean.split('/').some(p => p === '..' || p === '')) throw new Error(`"${e.name}" is not a usable file name inside a zip.`);
    if (seen.has(clean.toLowerCase())) throw new Error(`Two files in the zip would have the name "${clean}".`);
    seen.add(clean.toLowerCase());
    const name = Buffer.from(clean, 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data ?? ''), 'utf8');
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);   // local file header
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt16LE(0x0800, 6);       // flags: UTF-8 file name
    local.writeUInt16LE(0, 8);            // method: stored
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); // compressed size
    local.writeUInt32LE(data.length, 22); // size
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory header
    central.writeUInt16LE(20, 4);         // version made by
    central.writeUInt16LE(20, 6);         // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);    // where the local header starts
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += 30 + name.length + data.length;
    if (offset > MAX_BYTES) throw new Error('The files are too large for one zip.');
  }
  const directory = Buffer.concat(centrals);
  if (offset + directory.length > MAX_BYTES) throw new Error('The files are too large for one zip.');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);       // end of central directory
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
