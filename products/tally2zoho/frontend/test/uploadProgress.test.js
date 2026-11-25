import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uploadProgress, uploadProgressWords, zohoTargetWords, notApplicableReason, reasonProblem } from '../src/screens/app/uploadHelp.js';

test('upload progress counts only the datasets that are needed', () => {
  const slots = [
    ...Array.from({ length: 12 }, (_, i) => ({ key: `u${i}`, status: 'uploaded', requirement: 'required' })),
    ...Array.from({ length: 5 }, (_, i) => ({ key: `n${i}`, status: 'not_applicable', requirement: 'conditional' })),
  ];
  const p = uploadProgress({ slots });
  assert.deepEqual(p, { uploaded: 12, needed: 12, notApplicable: 5, optionalMissing: 0, percent: 100 });
  assert.equal(uploadProgressWords(p), '12 of 12 needed are uploaded (5 not applicable)');
  const q = uploadProgress({ slots: [...slots.slice(0, 11), { key: 'r', status: 'missing', requirement: 'required' }, { key: 'o', status: 'missing', requirement: 'optional' }] });
  assert.equal(q.needed, 12);
  assert.equal(q.percent, 92);
  assert.equal(uploadProgressWords(q), '11 of 12 needed are uploaded (1 optional not uploaded)');
  assert.equal(uploadProgress(null).percent, 0);
});

test('plain words for a Zoho module without a file, and full-sentence reasons', () => {
  assert.equal(zohoTargetWords('Payments Received (sample needed); other receipts: Manual Journals'),
    "Payments Received (no file yet: waiting for Zoho's import sample); other receipts: Manual Journals");
  assert.match(notApplicableReason('stock_summary'), /no stock/);
  assert.ok(reasonProblem('not apply'));
  assert.equal(reasonProblem('The company keeps no stock.'), '');
});
