// Dates and the financial year (fix set S1): impossible dates are never written or guessed, the year can start in any
// month (from the Tally data or typed on New Migration), the Trial Balance movement check and the files use one date
// rule, the Zoho check refuses a date that is not a real day, and the Migration Date cannot be after the year starts.
// Every name, number and amount here is MADE UP.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-datesfy-'));
const { buildApp } = await import('../src/index.js');
const { isoDate, realDate, impossibleDateWords, fyRange, jobYear, yearStartFromData, NameSet } = await import('../src/tally.js');
const { buildVoucherOutput, voucherYearOutcome } = await import('../src/vouchers.js');
const { checkFiles } = await import('../src/zohocheck.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const seedPath = [path.resolve(here, '../seed-users.json'), path.resolve(here, '../seed-users.example.json')].find(p => fs.existsSync(p));
const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

test('isoDate: a day that does not exist is null, never another date', () => {
  for (const d of ['20250931', '20260229', '20250631', '20241399', '20240000', '2025093', '', null, undefined]) assert.equal(isoDate(d), null, String(d));
  assert.equal(isoDate('20240229'), '2024-02-29'); // a leap year
  assert.equal(isoDate('20250930'), '2025-09-30');
  assert.equal(realDate('2025-02-29'), null);
  assert.equal(realDate('2028-02-29'), '2028-02-29');
  assert.equal(impossibleDateWords('20250931'), '31 September 2025');
  assert.equal(impossibleDateWords('20260229'), '29 February 2026');
  assert.equal(impossibleDateWords('20241399'), 'month 13 of 2024');
  assert.equal(impossibleDateWords('20250930'), '');
});

test('fyRange: April to March by default, any start month when the year start is given', () => {
  assert.deepEqual(fyRange('2025-26'), { from: '2025-04-01', to: '2026-03-31' });
  assert.deepEqual(fyRange('2025-26', '2025-01-01'), { from: '2025-01-01', to: '2025-12-31' });
  assert.deepEqual(fyRange('2023-24', '2023-03-01'), { from: '2023-03-01', to: '2024-02-29' }); // the next February is a leap one
  assert.deepEqual(fyRange('2025-26', '2025-07-01'), { from: '2025-07-01', to: '2026-06-30' });
  assert.deepEqual(fyRange('2025-26', '2025-02-30'), { from: '2025-04-01', to: '2026-03-31' }); // not a date: the default
  assert.deepEqual(jobYear({ financial_year: '2025-26', year_start: null }), { from: '2025-04-01', to: '2026-03-31' });
  assert.deepEqual(jobYear({ financial_year: '2025-26', year_start: '2025-01-01' }), { from: '2025-01-01', to: '2025-12-31' });
});

test('yearStartFromData: a January to December company is found; a company that began its books mid-year keeps April', () => {
  // books begin 1 January, and the vouchers run January to December (one of the next January)
  const jan = { 20250114: 3, 20250218: 2, 20250331: 1, 20250502: 4, 20251205: 2, 20260112: 1 };
  assert.deepEqual(yearStartFromData('2025-26', '20250101', jan), { yearStart: '2025-01-01', booksFrom: '2025-01-01', inYear: 12, inApril: 7 });
  // books began on 1 October 2020 (the company was formed then), the vouchers run April to March: April stays
  assert.equal(yearStartFromData('2025-26', '20201001', { 20250405: 4, 20250901: 3, 20251115: 2, 20260310: 3 }), null);
  // books begin on 1 April, or on a day that is not the first of a month: April stays
  assert.equal(yearStartFromData('2025-26', '20250401', jan), null);
  assert.equal(yearStartFromData('2025-26', '20250115', jan), null);
  // a tie keeps April (the Indian financial year is the default)
  assert.equal(yearStartFromData('2025-26', '20250101', { 20250601: 2 }), null);
  // no books date at all
  assert.equal(yearStartFromData('2025-26', undefined, jan), null);
});

test('voucherYearOutcome: one rule for the files and the Trial Balance movement check', () => {
  const year = fyRange('2025-26', '2025-01-01');
  assert.equal(voucherYearOutcome({ date: '20250114' }, year), null);
  assert.equal(voucherYearOutcome({ date: '20260112' }, year), 'outside_year');
  assert.equal(voucherYearOutcome({ date: '20241231' }, year), 'outside_year');
  assert.equal(voucherYearOutcome({ date: '20250631' }, year), 'invalid_date');
  assert.equal(voucherYearOutcome({ date: '' }, year), 'invalid_date');
  assert.equal(voucherYearOutcome({ date: '20260112' }, null), null);
});

const vch = (number, date, lines) => ({ vouchernumber: number, date, allledgerentries: lines.map(([ledgername, amount]) => ({ ledgername, amount })) });
let nextId = 0;
const rec = (slot, data) => ({ id: ++nextId, source_id: `d${nextId}`, name: `${slot} ${data.vouchernumber}`, slot, data });
const build = (recs, year) => buildVoucherOutput(recs, { customers: new NameSet([]), vendors: new NameSet([]), taxLedgers: new NameSet([]), year,
  kindOf: () => null, contactOf: () => null });

test('the files: an impossible date is left out (invalid_date), the year of the company decides what is outside it', () => {
  const year = fyRange('2025-26', '2025-01-01');
  const lines = [['Rent', '-500.00'], ['Cash', '500.00']];
  const inJan = rec('contra', vch('C/1', '20250210', lines)), nextJan = rec('contra', vch('C/2', '20260105', lines)), bad = rec('contra', vch('C/3', '20250931', lines));
  const b = build([inJan, nextJan, bad], year);
  const where = Object.fromEntries(b.recon.map(r => [r.number, `${r.outcome}${r.reason ? `:${r.reason}` : ''}`]));
  assert.equal(b.recon.find(r => r.id === inJan.id).outcome, 'written', 'the voucher of February, inside a January to December year');
  assert.equal(where['C/2'], 'left_out:outside_year');
  assert.equal(where['C/3'], 'left_out:invalid_date');
  const f = b.exceptions.find(e => e.rec === bad);
  assert.equal(f.kind, 'left_out_invalid_date');
  assert.match(f.message, /31 September 2025/);
  // no date written anywhere is an impossible one
  for (const r of b.other_journals.rows) assert.ok(realDate(r.row['Journal Date']), r.row['Journal Date']);
});

test('the Zoho check: a yyyy-mm-dd date that is not a real day is refused (GEN-DATE-FORMAT)', () => {
  const H = ['Journal Date', 'Journal Number Prefix', 'Journal Number Suffix', 'Reference Number', 'Journal Type', 'Currency', 'Account', 'Debit', 'Credit'];
  const row = (date, n, account, d, c) => [date, 'J-', n, `R${n}`, 'both', 'INR', account, d, c];
  const file = { headers: H, rows: [row('2025-09-31', '1', 'Rent', '100.00', ''), row('2025-09-31', '1', 'Cash', '', '100.00'), row('2025-09-30', '2', 'Rent', '50.00', ''), row('2025-09-30', '2', 'Cash', '', '50.00')], bytes: 500 };
  const r = checkFiles({ journals: file }, { homeState: 'KA' });
  const f = r.files.find(x => x.key === 'journals');
  const cause = f.causes.find(c => c.ruleId === 'GEN-DATE-FORMAT');
  assert.ok(cause, JSON.stringify(f.causes.map(c => c.ruleId)));
  assert.equal(cause.tier, 'will');
  assert.equal(cause.rows, 2, 'only the rows of the impossible date');
  // the rule reaches every column whose heading ends in "Date" (the class pattern of zohorules.json is read as a regex)
  const other = { headers: H, rows: [row('31/03/2025', '3', 'Rent', '10.00', ''), row('31/03/2025', '3', 'Cash', '', '10.00')], bytes: 200 };
  const c2 = checkFiles({ journals: other }, { homeState: 'KA' }).files[0].causes.find(c => c.ruleId === 'GEN-DATE-FORMAT');
  assert.equal(c2?.rows, 2, 'a date not written yyyy-MM-dd is caught too');
});

// ---------- through the app ----------
let app = null, cookie = '';
after(async () => { if (app) await app.close(); });
async function call(o) {
  if (!app) {
    app = buildApp(); await app.ready();
    const u = seed.users.find(x => x.role === 'analyst') || seed.users.find(x => x.role === 'admin') || seed.users[0];
    const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: u.password } });
    cookie = String(r.headers['set-cookie']).split(';')[0];
  }
  return app.inject({ ...o, headers: { ...(o.headers || {}), cookie } });
}

test('New Migration: a year start can be typed; the year then runs twelve months from it', async () => {
  const r = await call({ method: 'POST', url: '/api/migrations', payload: { company: 'Made Up Traders', financialYear: '2025-26', yearStart: '2025-01-01' } });
  assert.equal(r.statusCode, 201, r.body);
  const job = r.json();
  assert.deepEqual(job.year, { from: '2025-01-01', to: '2025-12-31' });
  assert.equal(job.year_source, 'user');
  assert.equal(job.start_date, '2025-01-01');
  const bad = await call({ method: 'POST', url: '/api/migrations', payload: { company: 'Made Up Traders', financialYear: '2025-26', yearStart: '2025-02-30' } });
  assert.equal(bad.statusCode, 400);
  // cleared: back to 1 April (or the year found in the data at processing)
  const cleared = await call({ method: 'PUT', url: `/api/migrations/${job.id}`, payload: { yearStart: '' } });
  assert.equal(cleared.statusCode, 200, cleared.body);
  assert.deepEqual(cleared.json().year, { from: '2025-04-01', to: '2026-03-31' });
});

test('Voucher files: the Migration Date cannot be after the day before the financial year starts (OB-010)', async () => {
  const r = await call({ method: 'POST', url: '/api/migrations', payload: { company: 'Made Up Crafts', financialYear: '2024-25' } });
  const base = `/api/migrations/${r.json().id}`;
  for (const late of ['2024-09-30', '2026-01-15', '2024-04-01']) {
    const x = await call({ method: 'PUT', url: `${base}/voucher-settings`, payload: { openingDate: late } });
    assert.equal(x.statusCode, 400, `${late}: ${x.body}`);
    assert.match(x.json().error, /2024-03-31/);
  }
  for (const ok of ['2024-03-31', '2023-12-31', '']) {
    const x = await call({ method: 'PUT', url: `${base}/voucher-settings`, payload: { openingDate: ok } });
    assert.equal(x.statusCode, 200, `${ok}: ${x.body}`);
  }
});
