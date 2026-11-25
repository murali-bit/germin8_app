// The start date typed on New Migration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTypedDate, showDate, fyBounds, fyLabel, fyStartYear, fyOfDate } from '../src/dates.js';

test('typed dates are read in the usual forms', () => {
  const fy = '2024–25';
  assert.deepEqual(readTypedDate('01/04/2024', fy), { date: '2024-04-01' });
  assert.deepEqual(readTypedDate('1/4/2024', fy), { date: '2024-04-01' });
  assert.deepEqual(readTypedDate('15-01-2025', fy), { date: '2025-01-15' });
  assert.deepEqual(readTypedDate('31.03.2025', fy), { date: '2025-03-31' });
  assert.deepEqual(readTypedDate('2024-10-02', fy), { date: '2024-10-02' });
  assert.deepEqual(readTypedDate(' 01/04/2024 ', fy), { date: '2024-04-01' });
});

test('day and month with no year take the year from the financial year', () => {
  assert.deepEqual(readTypedDate('01/04', '2024-25'), { date: '2024-04-01' });
  assert.deepEqual(readTypedDate('15/02', '2024-25'), { date: '2025-02-15' });
  assert.deepEqual(readTypedDate('01/04', '2025–26'), { date: '2025-04-01' });
});

test('wrong or partial dates, and dates outside the year, are explained', () => {
  const fy = '2024-25';
  assert.match(readTypedDate('', fy).error, /Enter the start date/);
  assert.match(readTypedDate('2025', fy).error, /not a full date/);
  assert.match(readTypedDate('31/02/2025', fy).error, /not a date in the calendar/);
  assert.match(readTypedDate('13/13/2024', fy).error, /not a date in the calendar/);
  assert.match(readTypedDate('01/04/2025', fy).error, /outside financial year 2024–25 \(01\/04\/2024 to 31\/03\/2025\)/);
  assert.match(readTypedDate('31/03/2024', fy).error, /outside financial year/);
});

test('helpers', () => {
  assert.equal(showDate('2024-04-01'), '01/04/2024');
  assert.equal(showDate('bad'), '');
  assert.deepEqual(fyBounds('2024–25'), { from: '2024-04-01', to: '2025-03-31' });
  assert.equal(fyLabel(2099), '2099–00');
  assert.equal(fyStartYear('2025-26'), 2025);
  assert.equal(fyOfDate('2026-11-13'), 2026);
  assert.equal(fyOfDate('2027-03-31'), 2026);
});
