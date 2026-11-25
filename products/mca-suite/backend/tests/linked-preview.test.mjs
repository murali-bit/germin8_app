// node --test backend/tests/linked-preview.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { buildLinkedPreview, mergedAnswers, answersFor, LINKED_IDS } from '../linked-preview.js';

const CIN = 'U01100KA2019PTC000001';

function memDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE company_answers (cin TEXT NOT NULL, form_type TEXT NOT NULL, field_key TEXT NOT NULL, label TEXT,
    value TEXT, source TEXT DEFAULT 'extension', updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (cin, form_type, field_key))`);
  const ins = db.prepare('INSERT INTO company_answers (cin, form_type, field_key, value) VALUES (?, ?, ?, ?)');
  ins.run(CIN, 'aoc4', 'BOARD_RESOLUTION_NO', '12');
  ins.run(CIN, 'aoc4', 'DECL_DIN', '07654321');
  ins.run(CIN, 'aoc2', 'ROWS', 'Asha Rao | ABCPR1234K | Wife of director | Leasing of property | 1 year | Rent at market rate | 01/04/2025 | 0');
  ins.run(CIN, 'aoc2', 'DECL_DIN', '00000001'); // own form wins over aoc4
  ins.run(CIN, 'eboard', 'WEBSITE', 'https://example.test');
  return db;
}

const client = {
  general: { CIN, COMPANY_NAME: 'Example Services Private Limited', FY_FROM: '01/04/2024', FY_TO: '31/03/2025' },
  principalProducts: { CATEGORY_DESC: 'Human resources management consulting services' },
};

test('answers merge: aoc4 <- extraAnswers <- own', () => {
  const db = memDb();
  assert.deepEqual(answersFor(db, CIN, 'aoc4'), { BOARD_RESOLUTION_NO: '12', DECL_DIN: '07654321' });
  const aoc2 = mergedAnswers(db, CIN, { answersForm: 'aoc2' });
  assert.equal(aoc2.DECL_DIN, '00000001');
  assert.equal(aoc2.BOARD_RESOLUTION_NO, '12');
  const eboard = mergedAnswers(db, CIN, { answersForm: 'eboard', extraAnswers: ['aoc2'] });
  assert.ok(eboard.ROWS, 'eboard sees AOC-2 rows');
  assert.equal(eboard.WEBSITE, 'https://example.test');
  assert.equal(eboard.DECL_DIN, '00000001', 'extraAnswers override aoc4');
});

test('preview builds every linked form and is JSON-safe', () => {
  const db = memDb();
  const p = buildLinkedPreview(db, CIN.toLowerCase(), client);
  assert.deepEqual(Object.keys(p).sort(), [...LINKED_IDS].sort());
  for (const id of LINKED_IDS) {
    assert.ok(!p[id].error, `${id}: ${p[id].error}`);
    assert.equal(typeof p[id].values, 'object');
    assert.ok(Array.isArray(p[id].missing));
    assert.ok(Array.isArray(p[id].notes));
    assert.deepEqual(JSON.parse(JSON.stringify(p[id])), p[id], `${id} round-trips through JSON`);
    for (const m of p[id].missing) assert.ok(!('parse' in m) || typeof m.parse !== 'function');
  }
  assert.ok(Array.isArray(p.aoc2.values.ROWS) && p.aoc2.values.ROWS.length === 1, 'AOC-2 rows parsed from the saved answer');
  assert.ok(!p.aoc2.missing.some(m => m.key === 'ROWS'), 'rows are not asked again');
});

test('preview without answers or client still answers', () => {
  const db = memDb();
  const p = buildLinkedPreview(db, '', null);
  for (const id of LINKED_IDS) assert.ok(p[id].missing.length > 0 || p[id].error === undefined);
});

test('verbatim report text saved by report-verbatim.js reaches the eauditor / eboard values', async () => {
  const { saveVerbatim, splitReport } = await import('../report-verbatim.js');
  const db = memDb();
  const text = ['BOARD’S REPORT', 'DIRECTOR’S RESPONSIBILITY STATEMENT:', 'The Board confirms that- (a) standards were followed.',
    'RISK MANAGEMENT', 'The Board reviews risks every quarter.', '',
    'INDEPENDENT AUDITOR’S REPORT', 'Opinion', 'In our opinion the statements of the made-up company are fair.'].join('\n');
  const r = splitReport(text, 'auto');
  saveVerbatim(db, CIN, r.sections);
  const p = buildLinkedPreview(db, CIN, client);
  assert.equal(p.eboard.values.DRS, 'The Board confirms that- (a) standards were followed.');
  assert.equal(p.eboard.values.RISK, 'The Board reviews risks every quarter.');
  assert.equal(p.eauditor.values.OPINION, 'In our opinion the statements of the made-up company are fair.');
});
