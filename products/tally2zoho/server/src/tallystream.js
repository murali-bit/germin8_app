// Reads a Tally JSON export from disk one record at a time, so a file of several hundred MB is never held in
// memory as a whole (neither its text nor the parsed document).
//
// The file is { ...envelope keys..., "tallymessage": [ record, record, ... ], ...envelope keys... }.
// The reader walks the bytes of the file, finds where each value starts and ends (it tracks strings, escapes and
// nesting, so brackets and quotes inside strings are not mistaken for structure), and hands each record of the
// "tallymessage" list to JSON.parse on its own. Everything outside that list is small and is parsed as it is met.
//
// It is a plain (synchronous) generator: the caller decides when to pause and let other requests run.
//   for (const ev of readTallyFile(path)) ...
//     { type: 'record', value, index }          one entry of the "tallymessage" list
//     { type: 'envelope', key, value }          any other top-level key (for example static_variables); may come after the records
//     { type: 'end', records, hasList, bytes }  hasList is false when there was no "tallymessage" list
// Like the earlier whole-file reader: a byte order mark is skipped, and the "tallymessage" key is found
// whatever its capital letters. Broken JSON throws an Error with a plain message.
//
// ENCODING. The file may be UTF-8, UTF-16 LE (what TallyPrime 7.1 writes) or UTF-16 BE, with or without a byte order
// mark (see detectEncoding in tally.js). A UTF-16 file is turned into UTF-8 piece by piece as it is read, so the
// scanner below always sees UTF-8 and the file is still never held in memory as a whole. A UTF-16 character, or the
// two halves of a surrogate pair, may be split between two pieces: the decoder keeps the unfinished part until the
// next piece arrives. For a UTF-16 file, positions in error messages count the UTF-8 text, not the bytes on disk.

import fs from 'node:fs';
import { detectEncoding, swapBytePairs } from './tally.js';

const CHUNK = 1024 * 1024;
const MAX_VALUE = 64 * 1024 * 1024; // one record (or one envelope value) larger than this is refused
const WS = c => c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09;
const fail = msg => { throw new Error(msg); };
// TALLY-005: a file read as UTF-8 must BE UTF-8. Buffer.toString would silently put U+FFFD in place of a byte that is
// not UTF-8 (a file saved as ANSI / Windows-1252 by another tool), changing names and possibly making two different
// parties look the same. Each value is decoded with a fatal decoder instead, so such a file is refused with where it is.
const strictUtf8 = new TextDecoder('utf-8', { fatal: true });
export const NOT_UTF8_ADVICE = 'The file is not in UTF-8 or UTF-16, the text encodings Tally writes (it may have been saved as ANSI / Windows-1252 by another program). Names would be read wrongly, so the file is refused. Export it again from Tally (JSON, UTF-8 or UTF-16) and upload that file unchanged.';

// Reads the file as UTF-8 bytes: read(target, offset, max) copies at most max bytes and returns how many (0 at the end).
function utf8Source(fd, chunkSize) {
  const head = Buffer.alloc(4);
  const got = fs.readSync(fd, head, 0, 4, 0);
  const { encoding, bomLength } = detectEncoding(head.subarray(0, got));
  let rawPos = bomLength;
  if (encoding === 'utf8') {
    return { encoding, read: (target, offset, max) => { const n = fs.readSync(fd, target, offset, max, rawPos); rawPos += n; return n; } };
  }
  // UTF-16: raw bytes -> text -> UTF-8 bytes. Only whole characters are decoded: an odd last byte (half a code unit)
  // and a last high surrogate (the first half of a pair) are carried over to the next piece.
  const big = encoding === 'utf16be';
  const raw = Buffer.allocUnsafe(Math.max(2, chunkSize));
  let carry = Buffer.alloc(0), pending = Buffer.alloc(0), ended = false;
  const unitAt = (b, i) => (big ? (b[i] << 8) | b[i + 1] : b[i] | (b[i + 1] << 8));
  const decode = bytes => (big ? swapBytePairs(bytes) : bytes).toString('utf16le');
  const refill = () => {
    while (!pending.length && !ended) {
      const n = fs.readSync(fd, raw, 0, raw.length, rawPos);
      rawPos += n;
      let text;
      if (n === 0) {
        ended = true; // what is left cannot be completed: a lone surrogate becomes U+FFFD, a lone byte is dropped
        text = decode(carry.subarray(0, carry.length - (carry.length % 2)));
      } else {
        const bytes = carry.length ? Buffer.concat([carry, raw.subarray(0, n)]) : raw.subarray(0, n);
        let cut = bytes.length - (bytes.length % 2);
        if (cut >= 2) { const u = unitAt(bytes, cut - 2); if (u >= 0xd800 && u <= 0xdbff) cut -= 2; }
        carry = Buffer.from(bytes.subarray(cut));
        text = decode(bytes.subarray(0, cut));
      }
      if (text) pending = Buffer.from(text, 'utf8');
    }
  };
  return {
    encoding,
    read(target, offset, max) {
      refill();
      const n = Math.min(max, pending.length);
      pending.copy(target, offset, 0, n);
      pending = pending.subarray(n);
      return n;
    },
  };
}

export function* readTallyFile(filePath, { chunkSize = CHUNK } = {}) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const source = utf8Source(fd, chunkSize);
    // One buffer is reused for the whole file: buf[0..len) is the part of the file being looked at.
    let buf = Buffer.allocUnsafe(Math.max(chunkSize * 2, 64)), len = 0, pos = 0, base = 0, eof = false;
    // Drops the bytes before `keep`, then appends the next chunk of the file. Returns false at the end of the file.
    // The buffer is always shifted by `keep` (so the caller adjusts its own positions by `keep` either way).
    const fill = keep => {
      const remain = Math.max(0, len - keep);
      if (remain + chunkSize > buf.length) { // a value longer than the buffer: grow it
        const bigger = Buffer.allocUnsafe(Math.max(buf.length * 2, remain + chunkSize));
        buf.copy(bigger, 0, keep, keep + remain);
        buf = bigger;
      } else if (remain > 0 && keep > 0) buf.copyWithin(0, keep, keep + remain);
      const n = eof ? 0 : source.read(buf, remain, chunkSize);
      len = remain + n;
      base += keep; pos -= keep;
      if (n === 0) { eof = true; return false; }
      return true;
    };
    const where = () => `at position ${base + pos} in the file`;
    const more = () => pos < len || fill(Math.min(pos, len));
    // Moves to the next byte that is not white space. Returns that byte, or -1 at the end of the file.
    const next = () => {
      for (;;) {
        if (!more()) return -1;
        if (!WS(buf[pos])) return buf[pos];
        pos++;
      }
    };
    // Reads one JSON value starting at pos and returns it parsed. The value may span many chunks.
    const value = what => {
      let i = pos, depth = 0, inString = false;
      const need = () => { // makes buf[i] available, keeping the bytes of the value read so far
        while (i >= len) {
          if (len - pos > MAX_VALUE) fail(`${what} is larger than ${MAX_VALUE / 1024 / 1024} MB, which is more than this reader accepts`);
          const keep = pos;
          if (!fill(keep)) fail(`the file ends in the middle of ${what}`);
          i -= keep;
        }
      };
      need();
      const first = buf[i];
      if (first === 0x22 || first === 0x7b || first === 0x5b) {
        for (;;) {
          need();
          const c = buf[i];
          if (inString) {
            if (c === 0x5c) { i += 2; continue; }             // an escape: the next byte is part of the string
            if (c === 0x22) { inString = false; if (depth === 0) { i++; break; } }
          } else if (c === 0x22) inString = true;
          else if (c === 0x7b || c === 0x5b) depth++;
          else if (c === 0x7d || c === 0x5d) { depth--; if (depth === 0) { i++; break; } }
          i++;
        }
      } else {
        // a number, true, false or null: it ends at white space, a comma, a closing bracket or the end of the file
        for (;;) {
          if (i >= len) { const keep = pos; const got = fill(keep); i -= keep; if (!got) break; continue; }
          const c = buf[i];
          if (WS(c) || c === 0x2c || c === 0x7d || c === 0x5d) break;
          i++;
        }
        if (i === pos) fail(`a value is missing ${where()}`);
      }
      let text;
      if (source.encoding === 'utf8') {
        try { text = strictUtf8.decode(buf.subarray(pos, i)); } catch { fail(`${what} ${where()} has bytes that are not UTF-8 text. ${NOT_UTF8_ADVICE}`); }
      } else text = buf.toString('utf8', pos, i); // made from UTF-16 by this reader: always UTF-8
      pos = i;
      try { return JSON.parse(text); } catch (e) { return fail(`${what} is not valid JSON (${e.message})`); }
    };

    // ---- the document ----
    if (!more()) fail('the file is empty');
    while (len - pos < 3 && fill(pos)) { /* enough bytes to recognise a byte order mark */ }
    if (len - pos >= 3 && buf[pos] === 0xef && buf[pos + 1] === 0xbb && buf[pos + 2] === 0xbf) pos += 3; // byte order mark
    let c = next();
    if (c === -1) fail('the file is empty');
    if (c !== 0x7b) {
      // Not an object at the top: it cannot be a Tally export. Read the value so broken JSON is still reported as broken.
      value('the file');
      if (next() !== -1) fail(`unexpected text after the end of the data ${where()}`);
      yield { type: 'end', records: 0, hasList: false, bytes: base + pos };
      return;
    }
    pos++;
    let records = 0, hasList = false, firstKey = true;
    for (;;) {
      c = next();
      if (c === -1) fail('the file ends before the data is complete');
      if (c === 0x7d && firstKey) { pos++; break; }
      if (c !== 0x22) fail(`a field name in double quotes was expected ${where()}`);
      const key = value('a field name');
      if (next() !== 0x3a) fail(`a colon was expected after "${key}" ${where()}`);
      pos++;
      c = next();
      if (c === -1) fail('the file ends before the data is complete');
      if (String(key).toLowerCase() === 'tallymessage' && c === 0x5b) {
        if (hasList) fail('the file has more than one "tallymessage" list');
        hasList = true;
        pos++;
        let firstItem = true;
        for (;;) {
          c = next();
          if (c === -1) fail('the file ends in the middle of the "tallymessage" list');
          if (c === 0x5d && firstItem) { pos++; break; }
          yield { type: 'record', value: value(`record ${records + 1}`), index: records };
          records++;
          firstItem = false;
          c = next();
          if (c === 0x2c) { pos++; continue; }
          if (c === 0x5d) { pos++; break; }
          fail(c === -1 ? 'the file ends in the middle of the "tallymessage" list' : `a comma or the end of the list was expected after record ${records} ${where()}`);
        }
      } else {
        yield { type: 'envelope', key, value: value(`the value of "${key}"`) };
      }
      firstKey = false;
      c = next();
      if (c === 0x2c) { pos++; firstKey = false; continue; }
      if (c === 0x7d) { pos++; break; }
      fail(c === -1 ? 'the file ends before the data is complete' : `a comma or a closing bracket was expected ${where()}`);
    }
    if (next() !== -1) fail(`unexpected text after the end of the data ${where()}`);
    yield { type: 'end', records, hasList, bytes: base + pos, encoding: source.encoding };
  } finally {
    fs.closeSync(fd);
  }
}

// Lets other requests run. Call it between batches of records.
export const pause = () => new Promise(resolve => setImmediate(resolve));
