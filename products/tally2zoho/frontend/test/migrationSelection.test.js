import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepStoredId, createOnceCache, migrationLabel, sameCompanyAndYear } from '../src/migrationSelection.js';

test('the stored migration id is kept only when the user can see that migration', () => {
  const list = [{ id: 'MIG-2025-001' }, { id: 'MIG-2025-002' }];
  assert.equal(keepStoredId('MIG-2025-002', list), 'MIG-2025-002');
  assert.equal(keepStoredId('MIG-2025-009', list), null); // another firm's, or removed
  assert.equal(keepStoredId(null, list), null);
  assert.equal(keepStoredId('MIG-2025-001', []), null);
  assert.equal(keepStoredId('MIG-2025-001', null), null); // the list could not be read: nothing is assumed
});

test('one request per migration while it is under way and for a short while after', async () => {
  let clock = 0;
  const cache = createOnceCache(2000, () => clock);
  let calls = 0;
  const load = () => { calls++; return Promise.resolve({ n: calls }); };
  const [a, b] = await Promise.all([cache.get('MIG-1', load), cache.get('MIG-1', load)]);
  assert.equal(calls, 1);
  assert.equal(a, b);
  clock = 1500;
  await cache.get('MIG-1', load);
  assert.equal(calls, 1, 'reused within the max age');
  clock = 4000;
  await cache.get('MIG-1', load);
  assert.equal(calls, 2, 'read again once older than the max age');
  cache.clear('MIG-1');
  await cache.get('MIG-1', load);
  assert.equal(calls, 3, 'read again after clear');
  await cache.get('MIG-2', load);
  assert.equal(calls, 4, 'another migration is its own request');
});

test('a failed request is not kept', async () => {
  const cache = createOnceCache(2000, () => 0);
  let calls = 0;
  const fail = () => { calls++; return Promise.reject(new Error('down')); };
  await assert.rejects(cache.get('MIG-1', fail));
  await assert.rejects(cache.get('MIG-1', fail));
  assert.equal(calls, 2);
  assert.equal(cache.has('MIG-1'), false);
});

test('migrations of the same company and year are found, with the MIG id first in their label', () => {
  const list = [
    { id: 'MIG-2025-001', company: 'Example Traders', financial_year: '2025-26' },
    { id: 'MIG-2025-004', company: ' example  traders ', financial_year: '2025-26' },
    { id: 'MIG-2024-002', company: 'Example Traders', financial_year: '2024-25' },
  ];
  assert.deepEqual(sameCompanyAndYear(list, 'EXAMPLE TRADERS', '2025-26').map(m => m.id), ['MIG-2025-001', 'MIG-2025-004']);
  assert.deepEqual(sameCompanyAndYear(list, '', '2025-26'), []);
  assert.equal(migrationLabel(list[0]), 'MIG-2025-001 · Example Traders · 2025-26');
});
