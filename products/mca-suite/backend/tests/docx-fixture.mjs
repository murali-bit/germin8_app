// Test helper: builds small .docx / zip files in memory (made-up text only).
import zlib from 'node:zlib';

// Minimal zip writer: method 0 (stored) or 8 (deflate).
export function makeZip(files, { deflate = false } = {}) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, 'utf8');
    const body = deflate ? zlib.deflateRawSync(data) : data;
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = zlib.crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(deflate ? 8 : 0, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8); ch.writeUInt16LE(deflate ? 8 : 0, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameBuf, body);
    centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  const n = Object.keys(files).length;
  eocd.writeUInt16LE(n, 8); eocd.writeUInt16LE(n, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
export const p = (...runs) => `<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs><w:rPr><w:b/></w:rPr></w:pPr>${runs.join('')}</w:p>`;
export const r = t => `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${t}</w:t></w:r>`;
export const cell = (...paras) => `<w:tc><w:tcPr><w:tcW w:w="2000"/></w:tcPr>${paras.join('')}</w:tc>`;
export const row = (...cells) => `<w:tr><w:trPr/>${cells.join('')}</w:tr>`;
export function makeDocx(bodyXml, opts) {
  return makeZip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types/>',
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${bodyXml}<w:sectPr><w:pgSz w:w="11906"/></w:sectPr></w:body></w:document>`,
  }, opts);
}

