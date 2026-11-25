import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gstTreatmentWords, optionWords, journalRoute, contactRowsShown, contactKey, uniqueReasons, tdsOnDocuments } from '../src/mappingLogic.js';

test('GST treatment codes are shown in words; an unknown code stays as it is', () => {
  assert.equal(gstTreatmentWords('business_gst'), 'Registered (regular)');
  assert.equal(gstTreatmentWords('business_registered_composition'), 'Registered (composition)');
  assert.equal(gstTreatmentWords('business_none'), 'Unregistered');
  assert.equal(gstTreatmentWords('overseas'), 'Overseas');
  assert.equal(gstTreatmentWords('something_new'), 'something_new');
  assert.equal(gstTreatmentWords(''), '');
});

test('option words lose "(the default)": the tag says it once', () => {
  assert.equal(optionWords('left out of the files (the default)'), 'Left out of the files');
  assert.equal(optionWords('written to the files'), 'Written to the files');
});

test('a journal is on its default until a person decides', () => {
  assert.deepEqual(journalRoute({ decision: null, defaultDecision: 'Bill' }), { to: 'Bill', how: 'default' });
  assert.deepEqual(journalRoute({ decision: null, defaultDecision: null }), { to: 'Manual Journal', how: 'default' });
  assert.deepEqual(journalRoute({ decision: 'Invoice', defaultDecision: null }), { to: 'Invoice', how: 'person' });
});

test('Fix contacts: filter, search by name or GSTIN, and a saved row stays visible', () => {
  const rows = [
    { section: 'customer', ledger: 'Alpha Traders', visible: 'Alpha Traders', problems: ['registered_without_gstin'], written: { gstin: '' } },
    { section: 'customer', ledger: 'Beta Stores', visible: 'Beta Stores', problems: [], fix: { state: 'KA' }, written: { gstin: '29ABCDE1234F1Z5' } },
    { section: 'vendor', ledger: 'Gamma Supply', visible: 'Gamma Supply', problems: ['state_missing'], assumptions: ['state_from_gstin'], written: { gstin: '' } },
  ];
  const names = list => list.map(r => r.ledger);
  assert.deepEqual(names(contactRowsShown(rows, '', '')), ['Alpha Traders', 'Beta Stores', 'Gamma Supply']);
  assert.deepEqual(names(contactRowsShown(rows, 'registered_without_gstin', '')), ['Alpha Traders']);
  assert.deepEqual(names(contactRowsShown(rows, 'corrected', '')), ['Beta Stores']);
  assert.deepEqual(names(contactRowsShown(rows, 'filled', '')), ['Gamma Supply']);
  assert.deepEqual(names(contactRowsShown(rows, '', 'gam')), ['Gamma Supply']);
  assert.deepEqual(names(contactRowsShown(rows, '', '29abcde')), ['Beta Stores'], 'search by GSTIN, capitals ignored');
  // Alpha was saved and no longer has the problem: still shown (with its Undo) until the list or search changes
  const saved = [{ ...rows[0], problems: [], fix: { treatment: 'unregistered' } }, rows[1], rows[2]];
  assert.deepEqual(names(contactRowsShown(saved, 'registered_without_gstin', '', new Set([contactKey(rows[0])]))), ['Alpha Traders']);
  assert.deepEqual(names(contactRowsShown(saved, 'registered_without_gstin', '')), []);
});

test('out-of-date reasons are said once, with the latest time and how many times', () => {
  const u = uniqueReasons([
    { reason: 'A changed.', by: 'a@x', at: '2026-01-01T10:00:00Z' },
    { reason: 'B changed.', by: 'b@x', at: '2026-01-01T11:00:00Z' },
    { reason: 'A changed.', by: 'c@x', at: '2026-01-02T10:00:00Z' },
  ]);
  assert.deepEqual(u.map(r => [r.reason, r.times, r.by]), [['A changed.', 2, 'c@x'], ['B changed.', 1, 'b@x']]);
  assert.deepEqual(uniqueReasons(null), []);
});

test('TDS with no Zoho tax: refused only where bills or invoices carry it (the Prepare rule)', () => {
  const taxes = [{ ledger: 'TDS on rent', salesPurchaseVouchers: 3 }, { ledger: 'TDS on fees', salesPurchaseVouchers: 0 }];
  assert.equal(tdsOnDocuments(taxes, 'TDS on rent'), true);
  assert.equal(tdsOnDocuments(taxes, 'TDS on fees'), false, 'only journals: Manual Journals by default');
  assert.equal(tdsOnDocuments(taxes, 'Not listed'), false);
  assert.equal(tdsOnDocuments(null, 'TDS on fees'), true, 'not loaded yet: the careful answer');
});
