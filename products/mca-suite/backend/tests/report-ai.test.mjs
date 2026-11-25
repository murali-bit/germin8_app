// node --test backend/tests/report-ai.test.mjs
// No network: the Claude call is replaced with _setExtractor(). Made-up company only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  postProcess, validateValue, cleanContract, buildProposals, saveItems, buildPrompt, FIELD_BY, NATURES, _setExtractor, toDDMMYYYY,
} from '../report-ai.js';
import { handle, NO_ATTACHMENT_MSG } from '../routes/report-ai.js';

const CIN = 'U01100KA2019PTC000001';
const TODAY = new Date(2026, 10, 25);

function memDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE company_answers (cin TEXT NOT NULL, form_type TEXT NOT NULL, field_key TEXT NOT NULL, label TEXT, value TEXT,
             source TEXT DEFAULT 'extension', updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (cin, form_type, field_key));
           CREATE TABLE attachments (id TEXT PRIMARY KEY, cin TEXT NOT NULL, job_id TEXT, form_type TEXT DEFAULT 'aoc4', slot TEXT NOT NULL,
             file_name TEXT, mime TEXT, size INTEGER, sha256 TEXT, path TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);`);
  return db;
}
const put = (db, ft, key, label, value) => db.prepare('INSERT INTO company_answers (cin, form_type, field_key, label, value) VALUES (?,?,?,?,?)').run(CIN, ft, key, label, value);
const get = (db, ft, key) => db.prepare('SELECT label, value, source FROM company_answers WHERE cin=? AND form_type=? AND field_key=?').get(CIN, ft, key);

const q = (value, quote = 'quoted words from the report', page = 3, extra = {}) => ({ value, quote, page, ...extra });

const FAKE = {
  eauditor: {
    OPINION: q('In our opinion the financial statements give a true and fair view', 'give a true and fair view', 2, { type: 'unmodified' }),
    BASIS: q('Some basis text', 'basis', 2),                                  // dropped: opinion is unmodified
    EMPHASIS: q('We draw attention to Note 28 on going concern. Our opinion is not modified.', 'We draw attention to Note 28', 3),
    KAM: q('Not applicable', 'Reporting of key audit matters is not applicable', 3),
    RULE11: q('(i) The company has no pending litigations. (ii) No long-term contracts.', 'does not have any pending litigations', 5),
    OTHER_5B: q('None', ''),                                                  // dropped: no quote
    CARO: q('yes', 'Annexure A referred to in paragraph 1', 6),
    QUAL_COUNT: q('0', 'unmodified opinion', 2),
    QUAL_TYPE_1: q('Qualification', 'x', 2),                                 // dropped: unmodified
    IFC: q({ nested: true }, 'x', 4),                                         // dropped: wrong format
  },
  eboard: {
    BOARD_MEETINGS: q([
      { date: '2025-05-20', total: 2, attended: 2 },
      { date: '15/11/2025', total: '2', attended: '1' },
      { date: '31/02/2025', total: 2, attended: 2 },                          // not a real date
      { date: '01/01/2030', total: 2, attended: 2 },                          // future
      { date: '10/12/2025', total: 2, attended: 3 },                          // attended > total
    ], 'The Board met twice during the year', 7),
    EMP_FEMALE: q('3', 'women employees: 3', 8),
    EMP_MALE: q('two', 'men', 8),                                             // dropped: not an integer
    DIRECTOR_LOAN_DECLARATION: q('Yes', 'declared in writing that the amount is not given out of borrowed funds', 9),
    WEBSITE: null,
  },
  aoc2: {
    ROWS: q([
      { name: 'Test Relative One', id: 'abcpr1234k', relationship: 'Wife of director', nature: 'Leasing of property', duration: '01/04/2025 to 31/03/2026', terms: 'Office rent Rs 20,000 a month', approvalDate: '2025-04-01', advance: 'Rs. 0/-' },
      { name: 'Test Director', id: '07654321', relationship: 'Director', nature: 'remuneration', duration: 'Year', terms: 'Director remuneration Rs 6,00,000', approvalDate: '01/04/2025', advance: '0' },
      { name: 'Test Lender', id: '', relationship: 'Director', nature: 'Loan taken', duration: 'Year', terms: 'Loan', approvalDate: '', advance: '0' },
    ], 'Form AOC-2 … particulars of contracts', 12),
  },
  aoc4: {
    BOARD_RESOLUTION_NO: q('BR/2025/0001-LONG', 'Resolution BR/2025/0001-LONG', 10),   // dropped: > 10 chars
    BOARD_RESOLUTION_DATE: q('05-09-2025', 'Date: 05.09.2025', 10),
  },
};

test('date helper: real dates only, never after today', () => {
  assert.equal(toDDMMYYYY('2025-09-05', TODAY), '05/09/2025');
  assert.equal(toDDMMYYYY('31/02/2025', TODAY), '');
  assert.equal(toDDMMYYYY('01/01/2030', TODAY), '');
});

test('postProcess keeps quoted, well-formed values and drops the rest', () => {
  const { findings, dropped, opinionType } = postProcess(FAKE, { today: TODAY });
  const by = Object.fromEntries(findings.map(f => [`${f.formType}:${f.key}`, f]));
  assert.equal(opinionType, 'unmodified');
  assert.match(by['eauditor:OPINION'].value, /^Unmodified opinion\. /);
  assert.equal(by['eauditor:CARO'].value, 'Yes');
  assert.equal(by['eauditor:QUAL_COUNT'].value, '0');
  assert.equal(by['eauditor:EMPHASIS'].page, 3);
  for (const k of ['eauditor:BASIS', 'eauditor:OTHER_5B', 'eauditor:QUAL_TYPE_1', 'eauditor:IFC', 'eboard:EMP_MALE', 'aoc4:BOARD_RESOLUTION_NO', 'eboard:WEBSITE']) {
    assert.ok(!by[k], `${k} should be dropped`);
  }
  assert.ok(dropped.some(d => d.key === 'OTHER_5B' && /quote/.test(d.reason)));
  assert.deepEqual(by['eboard:BOARD_MEETINGS'].value, [
    { date: '20/05/2025', total: 2, attended: 2 }, { date: '15/11/2025', total: 2, attended: 1 },
  ]);
  assert.equal(by['eboard:EMP_FEMALE'].value, '3');
  assert.equal(by['eboard:DIRECTOR_LOAN_DECLARATION'].value, 'Yes');
  assert.equal(by['aoc4:BOARD_RESOLUTION_DATE'].value, '05/09/2025');
  const rows = by['aoc2:ROWS'].value;
  assert.equal(rows.length, 1, 'director pay and the loan are not s.188 contracts');
  assert.deepEqual(rows[0], { name: 'Test Relative One', id: 'ABCPR1234K', relationship: 'Wife of director', nature: 'Leasing of property',
    duration: '01/04/2025 to 31/03/2026', terms: 'Office rent Rs 20,000 a month', approvalDate: '01/04/2025', advance: '0' });
});

test('qualified opinion keeps basis and remarks up to the stated count', () => {
  const j = { eauditor: {
    OPINION: q('Except for the effects of the matter described…', 'except for', 2, { type: 'qualified' }),
    BASIS: q('Inventory was not physically verified.', 'not physically verified', 2),
    QUAL_COUNT: q(1, 'one matter is qualified', 2),
    QUAL_TYPE_1: q('qualification', 'Basis for Qualified Opinion', 2), QUAL_COMMENT_1: q('Inventory not verified', 'inventory was not verified', 2),
    QUAL_TYPE_2: q('Reservation', 'some reservation text', 2),
  } };
  const { findings } = postProcess(j, { today: TODAY });
  const keys = findings.map(f => f.key);
  assert.ok(keys.includes('BASIS') && keys.includes('QUAL_TYPE_1') && keys.includes('QUAL_COMMENT_1'));
  assert.ok(!keys.includes('QUAL_TYPE_2'));
  assert.equal(findings.find(f => f.key === 'QUAL_TYPE_1').value, 'Qualification');
  assert.match(findings.find(f => f.key === 'OPINION').value, /^Qualified opinion\./);
});

test('text input: a quote that is not in the text is dropped', () => {
  const text = 'Emphasis of Matter. We draw attention to Note 28 regarding going concern.';
  const j = { eauditor: { EMPHASIS: q('Going concern note 28', 'We draw attention to Note 28', 1), KAM: q('Not applicable', 'this sentence is not in the source text', 1) } };
  const { findings, dropped } = postProcess(j, { sourceText: text, today: TODAY });
  assert.deepEqual(findings.map(f => f.key), ['EMPHASIS']);
  assert.ok(dropped.some(d => d.key === 'KAM' && /not found/.test(d.reason)));
});

test('validators: nature list, counts, resolution number', () => {
  assert.equal(validateValue(FIELD_BY['eboard:CM_COUNT'], '-1'), undefined);
  assert.equal(validateValue(FIELD_BY['aoc4:BOARD_RESOLUTION_NO'], 'BR-12'), 'BR-12');
  assert.equal(cleanContract({ name: 'X Pvt Ltd', nature: '2', relationship: 'Common director', terms: 'Services Rs 1,000' }).nature, NATURES[1]);
  assert.equal(cleanContract({ name: 'X', nature: 'interest on loan' }), null);
  assert.deepEqual(validateValue(FIELD_BY['aoc2:ROWS'], []), []);
  assert.match(buildPrompt(), /BOARD_MEETINGS/);
});

test('proposals: fill / replace-test / keep', () => {
  const db = memDb();
  put(db, 'eauditor', 'EMPHASIS', 'TEST DATA — 1(c) Emphasis of matter', 'Nil');
  put(db, 'eauditor', 'KAM', '1(d) Key audit matters', 'Not applicable');      // same value → keep
  put(db, 'eauditor', 'RULE11', '5(a) Rule 11 matters', 'Typed by the CA');    // real answer → keep
  const { findings } = postProcess(FAKE, { today: TODAY });
  const p = Object.fromEntries(buildProposals(db, CIN, findings).map(x => [x.key, x]));
  assert.equal(p.EMPHASIS.action, 'replace-test');
  assert.equal(p.EMPHASIS.current, 'Nil');
  assert.equal(p.KAM.action, 'keep');
  assert.equal(p.RULE11.action, 'keep');
  assert.equal(p.CARO.action, 'fill');
});

test('saveItems: AI label, JSON rows, never overwrites a real answer without force', () => {
  const db = memDb();
  put(db, 'eauditor', 'RULE11', '5(a) Rule 11 matters', 'Typed by the CA');
  put(db, 'eauditor', 'EMPHASIS', 'TEST DATA — 1(c) Emphasis of matter', 'Nil');
  const rows = [{ name: 'Test Relative One', id: 'ABCPR1234K', relationship: 'Wife of director', nature: 'Leasing of property', duration: 'One year', terms: 'Rent Rs 1,000', approvalDate: '01/04/2025', advance: '0' }];
  const r = saveItems(db, CIN, [
    { formType: 'eauditor', key: 'EMPHASIS', value: 'Going concern', quote: 'We draw attention to Note 28', page: 3 },
    { formType: 'eauditor', key: 'RULE11', value: 'AI text', page: 5 },
    { formType: 'aoc2', key: 'ROWS', value: rows, page: 12 },
    { formType: 'eboard', key: 'NOT_A_FIELD', value: 'x' },
    { formType: 'aoc4', key: 'BOARD_RESOLUTION_DATE', value: '2099-01-01' },
  ], { today: TODAY });
  assert.deepEqual(r.saved.map(s => s.key), ['EMPHASIS', 'ROWS']);
  assert.deepEqual(r.skipped.map(s => s.key), ['RULE11', 'NOT_A_FIELD', 'BOARD_RESOLUTION_DATE']);
  assert.equal(get(db, 'eauditor', 'EMPHASIS').label, 'AI from document (p.3): 1(c) Emphasis of matter');
  assert.equal(get(db, 'eauditor', 'EMPHASIS').source, 'report-ai');
  assert.equal(get(db, 'eauditor', 'RULE11').value, 'Typed by the CA');
  assert.deepEqual(JSON.parse(get(db, 'aoc2', 'ROWS').value), rows);
  assert.match(get(db, 'aoc2', 'ROWS').label, /^Entered by CA: /, 'no quote → not labelled as read from the document');
  const f = saveItems(db, CIN, [{ formType: 'eauditor', key: 'RULE11', value: 'AI text', page: 5, force: true }]);
  assert.equal(f.saved.length, 1);
  assert.equal(get(db, 'eauditor', 'RULE11').value, 'AI text');
  assert.match(get(db, 'eauditor', 'RULE11').label, /^Entered by CA: /);
});

test('AOC-2 rows: contracts that are all filtered never become an explicit "None"', () => {
  const quote = 'Loan given to X Pvt Ltd';
  // Every row is an exclusion (loan) or cannot be classified → ROWS is dropped, not [].
  const a = postProcess({ aoc2: { ROWS: { value: [{ name: 'X Pvt Ltd', nature: 'Loan given' }, { name: 'Y', nature: 'something odd' }], quote, page: 40 } } }, { today: TODAY });
  assert.equal(a.findings.length, 0);
  assert.ok(a.dropped.some(d => d.key === 'ROWS' && /could not be classified/.test(d.reason)));
  assert.ok(a.dropped.some(d => d.key === 'ROWS' && /something odd/.test(d.reason)));
  // Unmappable natures (commission, royalty) → dropped with the row named.
  const b = postProcess({ aoc2: { ROWS: { value: [{ name: 'X Ltd', nature: 'Commission' }, { name: 'Z Ltd', nature: 'Royalty' }], quote, page: 40 } } }, { today: TODAY });
  assert.equal(b.findings.length, 0);
  assert.ok(b.dropped.some(d => /X Ltd/.test(d.reason)));
  // Only loans → no s.188 contract, dropped (the CA decides).
  const c = postProcess({ aoc2: { ROWS: { value: [{ name: 'X Pvt Ltd', nature: 'Loan given' }], quote, page: 40 } } }, { today: TODAY });
  assert.equal(c.findings.length, 0);
  assert.ok(c.dropped.some(d => /no row is a s\.188 contract/.test(d.reason)));
  // Some rows excluded → the rest are kept and the exclusion is listed.
  const { dropped } = postProcess(FAKE, { today: TODAY });
  assert.ok(dropped.some(d => d.key === 'ROWS' && /2 row\(s\) were not s\.188 contracts/.test(d.reason)));
  // An empty list from the document stays an explicit "None".
  const e = postProcess({ aoc2: { ROWS: { value: [], quote: 'There were no contracts with related parties', page: 12 } } }, { today: TODAY });
  assert.deepEqual(e.findings[0].value, []);
  assert.equal(validateValue(FIELD_BY['aoc2:ROWS'], [{ name: 'X Pvt Ltd', nature: 'Loan given' }]), undefined);
});

test('opinion type: "unqualified" is not qualified; quote and page are required', () => {
  const r = postProcess({ eauditor: {
    OPINION: q('In our opinion the statements give a true and fair view; unqualified opinion', 'give a true and fair view', 2),
    BASIS: q('Some basis', 'Basis for Opinion paragraph', 2),
    EMPHASIS: q('Nil', 'abc', 3),                                            // quote too short
    KAM: q('Not applicable', 'Reporting of key audit matters is not applicable', 'x'),   // no page
    OTHER_INFO: q('Board report', 'The other information comprises', null),
  } }, { today: TODAY });
  assert.equal(r.opinionType, 'unmodified');
  assert.match(r.findings.find(f => f.key === 'OPINION').value, /^Unmodified opinion\./);
  assert.deepEqual(r.findings.map(f => f.key), ['OPINION']);
  assert.ok(r.dropped.some(d => d.key === 'EMPHASIS' && /too short/.test(d.reason)));
  assert.ok(r.dropped.some(d => d.key === 'KAM' && /no page/.test(d.reason)));
  assert.ok(r.dropped.some(d => d.key === 'OTHER_INFO' && /no page/.test(d.reason)));
  assert.equal(postProcess({ eauditor: { OPINION: q('Except for the matter, true and fair', 'except for the matter', 2) } }).opinionType, 'qualified');
});

// ───────── route handler with a stubbed extractor ─────────

function call(db, pathname, body) {
  return new Promise((resolve, reject) => {
    const res = {};
    const sendJson = (_res, status, data) => resolve({ status, data });
    const ctx = { url: new URL('http://x' + pathname), pathname, method: 'POST', db, sendJson, parseJsonBody: async () => body };
    handle({}, res, ctx).then(h => { if (!h) resolve(null); }, reject);
  });
}

const PDF = Buffer.from('%PDF-1.4\n% fake test pdf\n%%EOF\n');

test('route: no (a) attachment → plain message', async () => {
  const db = memDb();
  _setExtractor(async () => { throw new Error('must not be called'); });
  const r = await call(db, '/api/aoc4/report-ai', { cin: CIN });
  assert.equal(r.status, 404);
  assert.equal(r.data.code, 'NO_ATTACHMENT');
  assert.equal(r.data.message, NO_ATTACHMENT_MSG);
  _setExtractor(null);
});

test('route: reads the (a) attachment, proposes, caches, saves', async () => {
  const db = memDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reportai-'));
  // Part B's store (routes/attachments.js) keeps paths relative to its folder; the fallback reader accepts absolute ones.
  const att = await import('../routes/attachments.js');
  const rel = `${CIN}/att1-FS.pdf`;
  fs.mkdirSync(path.join(dir, CIN), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), PDF);
  if (att.setAttachmentsDir) att.setAttachmentsDir(dir);
  const stored = att.setAttachmentsDir ? rel : path.join(dir, rel);
  db.prepare('INSERT INTO attachments (id, cin, slot, file_name, mime, size, path) VALUES (?,?,?,?,?,?,?)').run('att1', CIN, 'a', 'FS.pdf', 'application/pdf', PDF.length, stored);
  put(db, 'eauditor', 'EMPHASIS', 'TEST DATA — 1(c) Emphasis of matter', 'Nil');
  let calls = 0, seen = null;
  _setExtractor(async (input, opts) => { calls++; seen = { input, opts }; return { json: FAKE, model: 'stub' }; });
  try {
    const r = await call(db, '/api/aoc4/report-ai', { cin: CIN.toLowerCase() });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.ok, true);
    assert.equal(r.data.source.kind, 'attachment');
    assert.equal(Buffer.from(seen.input.pdfBase64, 'base64').toString('latin1').slice(0, 5), '%PDF-');
    assert.match(seen.opts.system, /Never invent/);
    const emph = r.data.proposals.find(p => p.key === 'EMPHASIS');
    assert.equal(emph.action, 'replace-test');
    assert.equal(emph.page, 3);

    const r2 = await call(db, '/api/aoc4/report-ai', { cin: CIN, formTypes: ['aoc2', 'aoc4'] });
    assert.equal(calls, 1, 'second tab uses the cached reading');
    assert.equal(r2.data.cached, true);
    assert.ok(r2.data.proposals.every(p => p.formType === 'aoc2' || p.formType === 'aoc4'));

    const s = await call(db, '/api/aoc4/report-ai/save', { cin: CIN, items: [{ formType: 'eauditor', key: 'EMPHASIS', value: emph.value, quote: emph.quote, page: emph.page }] });
    assert.equal(s.data.saved, 1);
    assert.match(get(db, 'eauditor', 'EMPHASIS').label, /^AI from document \(p\.3\)/);

    const bad = await call(db, '/api/aoc4/report-ai', { cin: 'BAD' });
    assert.equal(bad.status, 400);
    const notPdf = await call(db, '/api/aoc4/report-ai', { cin: CIN, base64: Buffer.from('hello').toString('base64') });
    assert.equal(notPdf.data.code, 'NOT_PDF');
    assert.equal(await call(db, '/api/other', {}), null);
  } finally {
    _setExtractor(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('route: AI failure → readable error, not cached', async () => {
  const db = memDb();
  let n = 0;
  _setExtractor(async () => { n++; throw new Error('no reply from the gateway within 240s'); });
  const r = await call(db, '/api/aoc4/report-ai', { cin: CIN, text: 'Some report text' });
  assert.equal(r.status, 504);
  assert.equal(r.data.code, 'TIMEOUT');
  await call(db, '/api/aoc4/report-ai', { cin: CIN, text: 'Some report text' });
  assert.equal(n, 2);
  _setExtractor(null);
});
