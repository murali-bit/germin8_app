// Which migration is selected, and how often it is read. Plain JavaScript with no React, so the rules can be tested
// with node (frontend/test/migrationSelection.test.js).

// The stored migration id is kept only when it is in the list of migrations the signed-in user can see (GET
// /migrations). Anything else (a migration of another firm, one that was removed, the last migration of the previous
// user of this browser) is dropped, so no screen asks for a migration that answers "not found".
// Returns the id to keep, or null.
export function keepStoredId(storedId, migrations) {
  if (!storedId || !Array.isArray(migrations)) return null;
  return migrations.some(m => m && m.id === storedId) ? storedId : null;
}

// One request per key at a time, and its answer reused for a short while, so several parts of one page that need the
// same migration send one request instead of four. now: a clock (Date.now), passed in for the tests.
// get(key, load): the promise of load(), shared while it is under way and for maxAgeMs after it ended well.
// A failed request is not kept. clear(key?) forgets one key or all.
export function createOnceCache(maxAgeMs = 2000, now = () => Date.now()) {
  const entries = new Map();
  return {
    get(key, load) {
      const hit = entries.get(key);
      if (hit && (hit.pending || now() - hit.at <= maxAgeMs)) return hit.promise;
      const entry = { pending: true, at: 0, promise: null };
      entry.promise = Promise.resolve().then(load).then(
        value => { entry.pending = false; entry.at = now(); return value; },
        err => { if (entries.get(key) === entry) entries.delete(key); throw err; },
      );
      entries.set(key, entry);
      return entry.promise;
    },
    clear(key) { if (key == null) entries.clear(); else entries.delete(key); },
    has: key => entries.has(key),
  };
}

// A short list of migrations for a choice: the MIG id first, so two migrations of the same company and year can be
// told apart. "MIG-2025-011 · Company · 2025-26"
export const migrationLabel = m => (m ? [m.id, m.company, m.financial_year].filter(Boolean).join(' · ') : '');

// The migrations with the same company (spaces and capital letters ignored) and the same financial year.
const nameKey = s => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
const yearKey = s => String(s || '').trim().slice(0, 4);
export function sameCompanyAndYear(migrations, company, financialYear) {
  if (!Array.isArray(migrations) || !nameKey(company)) return [];
  return migrations.filter(m => m && nameKey(m.company) === nameKey(company) && yearKey(m.financial_year) === yearKey(financialYear));
}
