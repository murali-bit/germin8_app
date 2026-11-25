// Stage B9: the journal review (filters, search, sort, pages, patterns, decisions for many journals at once).
// Every name, number and amount here is MADE UP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-review-'));
const { buildApp } = await import('../src/index.js');
const { journalPattern, patternWords, parseReviewQuery, matchesQuery, sortJournals, reviewPage, reviewCounts, planDecision, planWords, reviewGroup, NO_GROUP, MAX_PAGE_SIZE } = await import('../src/journalreview.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const samples = path.resolve(here, '../../sample-data');
const seed = JSON.parse(fs.readFileSync(path.resolve(here, '../seed-users.json'), 'utf8'));
const app = buildApp();
let cookie = '';
const call = opts => app.inject({ ...opts, headers: { ...(opts.headers || {}), ...(cookie ? { cookie } : {}) } });
const login = async role => {
  const u = seed.users.find(x => x.role === role);
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: u.password } });
  assert.equal(r.statusCode, 200, `login as ${role}`);
  cookie = String(r.headers['set-cookie']).split(';')[0];
  return u.email;
};
const get = async url => { const r = await call({ url }); assert.equal(r.statusCode, 200, `${url}: ${r.body}`); return r.json(); };
const send = (method, url, payload) => call({ method, url, payload });
const ok = async (method, url, payload) => { const r = await send(method, url, payload); assert.equal(r.statusCode, 200, `${method} ${url}: ${r.body}`); return r.json(); };
const readSample = f => JSON.parse(fs.readFileSync(path.join(samples, f), 'utf8').replace(/^﻿/, ''));
const putDoc = (id, slot, obj) => call({ method: 'PUT', url: `/api/migrations/${id}/uploads/${slot}`, headers: { 'content-type': 'application/octet-stream', 'x-filename': `${slot}.json` }, payload: Buffer.from(JSON.stringify(obj)) });
const FILES = { customers: '01_customers.json', vendors: '02_vendors.json', accounts: '03_chart_of_accounts.json', stock_items: '04_stock_items.json', units: '05_units.json',
  taxes: '06_tax_configuration.json', sales: '07_sales_vouchers.json', purchase: '08_purchase_vouchers.json', receipt: '09_receipt_vouchers.json', payment: '10_payment_vouchers.json', trial_balance: '13_trial_balance.json' };
const line = (ledgername, amount) => ({ ledgername, amount, isdeemedpositive: amount.startsWith('-'), ispartyledger: false });
const jv = (number, date, lines, extra = {}) => ({ metadata: { type: 'Voucher', vchtype: 'Journal' }, guid: `made-up-${number}`, date, vouchertypename: 'Journal', vouchernumber: number, narration: `Made-up ${number}`, ledgerentries: lines, ...extra });

// Ten made-up journals: three with the same pattern (expense debited, vendor credited), one bill with a tax credited
// (needs a check), one vendor debited (no clear pattern; cannot be a bill), one sale, two plain journals, one with a
// ledger name ending in a line break, one with a ledger not in the masters, and one cancelled.
function journalDoc() {
  const doc = readSample('11_journal_vouchers.json');
  doc.tallymessage = [
    jv('JR/1', '20240705', [line('Freight Inward', '-100.00'), line('Shree Logistics', '100.00')]),
    jv('JR/2', '20240810', [line('Freight Inward', '-250.50'), line('Bharat Steel Traders', '250.50')]),
    jv('JR/3', '20240901', [line('Freight Inward', '-75.00'), line('Precision Tools Co.', '75.00')]),
    jv('JR/4', '20240902', [line('Office Rent', '-1000.00'), line('Shree Logistics', '900.00'), line('Output IGST', '100.00')]),
    jv('JR/5', '20240903', [line('Shree Logistics', '-500.00'), line('Office Rent', '500.00')]),
    jv('JR/6', '20240904', [line('Adani Solar Equipment Ltd.', '-2000.00'), line('Consultancy and Design Revenue', '2000.00')]),
    jv('JR/7', '20240905', [line('Depreciation', '-300.00'), line('Accumulated Depreciation', '300.00')]),
    jv('JR/8', '20240906', [line('Freight Inward', '-100.00'), line('Shree Logistics', '100.00')], { iscancelled: 'Yes' }),
    jv('JR/9', '20240907', [line('Office Rent\r\n', '-40.00'), line('Cash', '40.00')]),
    jv('JR/10', '20240908', [line('Made-up Unknown Ledger', '-10.00'), line('Cash', '10.00')]),
  ];
  return doc;
}

async function setUp() {
  const email = await login('analyst');
  const r = await send('POST', '/api/migrations', { company: 'Apex Engineering Technologies Pvt. Ltd.', financialYear: '2024-25' });
  assert.equal(r.statusCode, 201);
  const id = r.json().id;
  for (const [slot, f] of Object.entries(FILES)) {
    const u = await call({ method: 'PUT', url: `/api/migrations/${id}/uploads/${slot}`, headers: { 'content-type': 'application/octet-stream', 'x-filename': f }, payload: fs.readFileSync(path.join(samples, f)) });
    assert.equal(u.statusCode, 200, slot);
  }
  assert.equal((await putDoc(id, 'journal', journalDoc())).statusCode, 200);
  await send('PUT', `/api/migrations/${id}/waivers/stock_summary`, { reason: 'Not needed for test' });
  assert.equal((await send('POST', `/api/migrations/${id}/process?wait=1`)).statusCode, 200);
  return { id, email };
}
const qs = o => new URLSearchParams(o).toString();
const numbers = list => list.map(j => j.number).sort();
const trail = async id => (await get(`/api/migrations/${id}/audit`)).map(a => `${a.actor} | ${a.action} | ${a.detail}`);

// ================= the pure rules =================
const L = (debit, credit, group) => ({ debit, credit, group, ledger: group, written: group });
test('B9: a pattern is the set of Tally groups debited and the set credited, whatever the amounts, lines or order', () => {
  const a = journalPattern([L('10.00', '', 'Direct Expenses'), L('', '10.00', 'Sundry Creditors')]);
  const b = journalPattern([L('', '7.00', 'Sundry Creditors'), L('3.00', '', 'Direct Expenses'), L('4.00', '', 'Direct Expenses')]);
  assert.equal(a.key, b.key, 'the same groups on each side are the same pattern');
  assert.deepEqual(a.debit, ['Direct Expenses']);
  const c = journalPattern([L('', '10.00', 'Direct Expenses'), L('10.00', '', 'Sundry Creditors')]);
  assert.notEqual(a.key, c.key, 'the sides matter');
  const d = journalPattern([L('10.00', '', null), L('', '10.00', 'Cash-in-Hand\r\n')]);
  assert.deepEqual(d.debit, [NO_GROUP], 'a ledger not in the masters has no group and is said so');
  assert.deepEqual(d.credit, ['Cash-in-Hand'], 'group names are written without hidden characters');
  assert.equal(patternWords(a), 'Debit: Direct Expenses. Credit: Sundry Creditors.');
});

test('B9: the review query is checked and explained in words', () => {
  assert.ok(parseReviewQuery({}).query, 'no filter at all is fine');
  assert.equal(parseReviewQuery({}).query.pageSize, 50);
  assert.match(parseReviewQuery({ min: '12.345' }).error, /not an amount/);
  assert.match(parseReviewQuery({ min: '500', max: '100' }).error, /smallest amount is more/);
  assert.match(parseReviewQuery({ from: '01-04-2024' }).error, /yyyy-mm-dd/);
  assert.match(parseReviewQuery({ from: '2024-05-01', to: '2024-04-01' }).error, /first date is after/);
  assert.match(parseReviewQuery({ pageSize: String(MAX_PAGE_SIZE + 1) }).error, /page size/);
  assert.match(parseReviewQuery({ sort: 'ledger' }).error, /Sort by/);
  assert.match(parseReviewQuery({ suggestion: 'Payment' }).error, /suggestion filter/);
  assert.equal(parseReviewQuery({ min: '1,000.50' }).query.min.toFixed(2), '1000.50', 'thousands separators are allowed');
});

const J = (id, o) => ({ id, number: `N/${id}`, date: '2024-07-01', narration: '', lines: [], total: '0.00', party: 'none', pattern: { key: 'p' }, suggested: 'Manual Journal', clear: true, needsCheck: false, decision: null, notPosted: null, refused: {}, leftOut: {}, ...o });
test('B9: filters, sorting with stable ties, and pages that never lose a journal', () => {
  const list = [
    J(1, { total: '100.50', date: '2024-07-02' }), J(2, { total: '99.99', date: '2024-07-01' }), J(3, { total: '100.50', date: '2024-07-01', decision: 'Bill' }),
    J(4, { notPosted: 'cancelled', total: '5.00' }), J(5, { suggested: 'Bill', clear: true, needsCheck: true, party: 'vendor', lines: [{ ledger: 'Oak\r\n', written: 'Oak' }] }),
  ];
  const q = o => parseReviewQuery(o).query;
  assert.deepEqual(list.filter(j => matchesQuery(j, q({ state: 'undecided' }))).map(j => j.id), [1, 2, 5]);
  assert.deepEqual(list.filter(j => matchesQuery(j, q({ state: 'decided' }))).map(j => j.id), [3]);
  assert.deepEqual(list.filter(j => matchesQuery(j, q({ state: 'not_posted' }))).map(j => j.id), [4]);
  assert.deepEqual(list.filter(j => matchesQuery(j, q({ review: 'needs_check' }))).map(j => j.id), [5]);
  assert.deepEqual(list.filter(j => matchesQuery(j, q({ ledger: 'oak' }))).map(j => j.id), [5], 'the ledger filter ignores hidden characters and capitals');
  assert.deepEqual(list.filter(j => matchesQuery(j, q({ min: '99.99', max: '100' }))).map(j => j.id), [2], 'amounts compared as decimals');
  assert.deepEqual(sortJournals(list, 'amount', 'desc').map(j => j.id), [3, 1, 2, 4, 5], 'equal amounts: the earlier date first');
  assert.deepEqual(sortJournals(list, 'amount', 'asc').map(j => j.id), [5, 4, 2, 3, 1]);
  const all = [];
  for (let page = 1; page <= 3; page++) all.push(...reviewPage(list, q({ pageSize: '2', page: String(page), sort: 'number' })).items.map(j => j.id));
  assert.deepEqual(all.sort(), [1, 2, 3, 4, 5], 'every journal is on exactly one page');
  const last = reviewPage(list, q({ pageSize: '2', page: '99' }));
  assert.equal(last.page, 3, 'a page beyond the end shows the last page');
  assert.deepEqual(last.matchingIds.sort(), [1, 2, 3, 5], 'a cancelled journal is never selectable');
  const c = reviewCounts(list);
  assert.equal(c.toDecide, 4); assert.equal(c.undecided, 3); assert.equal(c.notPosted, 1); assert.equal(c.needsCheck, 1);
  assert.equal(reviewGroup(list[3]), null);
});

test('B9: what a decision for many journals would do is worked out before it is made', () => {
  const list = [J(1), J(2, { decision: 'Manual Journal' }), J(3, { decision: 'Bill' }), J(4, { notPosted: 'cancelled' }),
    J(5, { refused: { Bill: 'the vendor is debited' } }), J(6, { clear: false, leftOut: { Bill: 'could not identify exactly one vendor on this voucher.' } })];
  const p = planDecision(list, 'Bill', { includeDecided: true });
  assert.deepEqual(p.change.map(j => j.id), [1, 2, 6]);
  assert.equal(p.counts.alreadyThis, 1); assert.equal(p.counts.notPosted, 1); assert.equal(p.counts.refused, 1);
  assert.equal(p.counts.changingADecision, 1); assert.equal(p.counts.notClear, 1); assert.equal(p.counts.leftOutAnyway, 1);
  assert.equal(p.counts.differsFromSuggestion, 3);
  const keep = planDecision(list, 'Bill', { includeDecided: false });
  assert.deepEqual(keep.change.map(j => j.id), [1, 6], 'a journal with another decision is left as it is');
  assert.equal(keep.counts.keptOtherDecision, 1);
  assert.match(planWords(p), /^3 journal vouchers will be routed to Bill\. 1 of them already has another decision/);
  assert.match(planWords(p), /1 voucher cannot go to Bill/);
});

test('B9: a journal that would be made out to a ledger of the wrong kind is said so before the decision', () => {
  const list = [J(1, { notParty: { Invoice: 'The invoice would be made out to "Made-up Vendor", which is not a customer in the masters, so the import is expected to fail for it.' } }), J(2)];
  const p = planDecision(list, 'Invoice');
  assert.equal(p.counts.change, 2, 'it is not refused: the accountant may still choose it');
  assert.equal(p.counts.notParty, 1);
  assert.equal(p.notParty[0].id, 1);
  assert.match(planWords(p), /1 voucher would be made out to a ledger that is not a customer/);
  assert.equal(planDecision(list, 'Bill').counts.notParty, 0, 'only for the destination it was found for');
});

// ================= end to end =================
test('B9 end to end: the review list, its filters, bulk decisions with a confirmed count, the pattern action, the audit and the out-of-date files', async () => {
  const { id, email } = await setUp();
  const base = `/api/migrations/${id}`;
  const review = async o => get(`${base}/journals/review?${qs({ pageSize: '200', ...o })}`);

  const r = await review({});
  assert.equal(r.total, 10);
  assert.equal(r.counts.toDecide, 9); assert.equal(r.counts.notPosted, 1); assert.equal(r.counts.undecided, 9);
  const byNo = Object.fromEntries(r.items.map(j => [j.number, j]));
  // the lines: the name shown without hidden characters, the Tally name kept, the group, debit and credit
  const l9 = byNo['JR/9'].lines[0];
  assert.equal(l9.ledger, 'Office Rent\r\n'); assert.equal(l9.name, 'Office Rent'); assert.equal(l9.group, 'Indirect Expenses'); assert.equal(l9.debit, '40.00');
  assert.deepEqual(byNo['JR/10'].pattern.debit, [NO_GROUP]);
  assert.equal(byNo['JR/1'].pattern.key, byNo['JR/2'].pattern.key);
  assert.equal(byNo['JR/1'].pattern.key, byNo['JR/3'].pattern.key, 'the same groups on both sides');
  assert.equal(byNo['JR/2'].total, '250.50');
  assert.equal(byNo['JR/4'].needsCheck, true);
  assert.equal(byNo['JR/5'].clear, false); assert.ok(byNo['JR/5'].refused.Bill, 'a vendor debited cannot be a bill');
  assert.equal(byNo['JR/6'].party, 'customer'); assert.equal(byNo['JR/7'].party, 'none');
  assert.ok(byNo['JR/5'].reason && byNo['JR/1'].reason, 'every journal carries its reason');
  const pattern = r.patterns.find(p => p.key === byNo['JR/1'].pattern.key);
  assert.equal(pattern.journals, 3); assert.equal(pattern.words, 'Debit: Direct Expenses. Credit: Sundry Creditors.');
  assert.ok(r.ledgers.some(l => l.name === 'Office Rent' && l.journals === 3), 'the ledger list counts a ledger once, hidden characters ignored');

  // filters
  assert.deepEqual(numbers((await review({ suggestion: 'Bill' })).items), ['JR/1', 'JR/2', 'JR/3', 'JR/4']);
  assert.deepEqual(numbers((await review({ review: 'needs_check' })).items), ['JR/4']);
  assert.deepEqual(numbers((await review({ review: 'not_clear' })).items), ['JR/5']);
  assert.deepEqual(numbers((await review({ party: 'vendor', state: 'undecided' })).items), ['JR/1', 'JR/2', 'JR/3', 'JR/4', 'JR/5']);
  assert.deepEqual(numbers((await review({ party: 'customer' })).items), ['JR/6']);
  assert.deepEqual(numbers((await review({ state: 'not_posted' })).items), ['JR/8']);
  assert.deepEqual(numbers((await review({ ledger: 'Shree Logistics', state: 'undecided' })).items), ['JR/1', 'JR/4', 'JR/5']);
  assert.deepEqual(numbers((await review({ ledger: 'Office Rent' })).items), ['JR/4', 'JR/5', 'JR/9']);
  assert.deepEqual(numbers((await review({ min: '100', max: '300', state: 'undecided' })).items), ['JR/1', 'JR/2', 'JR/7']);
  assert.deepEqual(numbers((await review({ from: '2024-08-01', to: '2024-08-31' })).items), ['JR/2']);
  assert.deepEqual(numbers((await review({ q: 'freight', state: 'undecided' })).items), ['JR/1', 'JR/2', 'JR/3']);
  assert.deepEqual(numbers((await review({ q: 'JR/10' })).items), ['JR/10']);
  assert.deepEqual(numbers((await review({ pattern: byNo['JR/1'].pattern.key })).items), ['JR/1', 'JR/2', 'JR/3', 'JR/8']);
  const p1 = await review({ sort: 'amount', dir: 'desc', pageSize: '2', page: '1' });
  assert.deepEqual(p1.items.map(j => j.number), ['JR/6', 'JR/4']); assert.equal(p1.pages, 5);
  assert.deepEqual((await review({ sort: 'amount', dir: 'desc', pageSize: '2', page: '2' })).items.map(j => j.number), ['JR/5', 'JR/7']);
  assert.equal((await review({ state: 'undecided' })).matchingIds.length, 9);
  assert.equal((await call({ url: `${base}/journals/review?min=abc` })).statusCode, 400);
  assert.equal((await call({ url: `${base}/journals/review?from=2024-09-01&to=2024-08-01` })).statusCode, 400);

  // files exist, so every decision below marks the files it changes out of date
  assert.equal((await send('POST', `${base}/generate`)).statusCode, 200);

  // ----- a decision for selected journals: preview, a refused count, then the decision -----
  const ids = ['JR/1', 'JR/2', 'JR/5', 'JR/8'].map(n => byNo[n].id);
  const pre = await ok('POST', `${base}/journals/bulk`, { ids, decision: 'Bill', preview: true });
  assert.equal(pre.applied, false);
  assert.equal(pre.counts.change, 2); assert.equal(pre.counts.refused, 1); assert.equal(pre.counts.notPosted, 1);
  assert.equal(pre.refused[0].number, 'JR/5');
  assert.match(pre.words, /^2 journal vouchers will be routed to Bill\./);
  const wrong = await send('POST', `${base}/journals/bulk`, { ids, decision: 'Bill', confirmCount: 3 });
  assert.equal(wrong.statusCode, 409, 'a count that differs from the preview is refused');
  assert.equal((await review({ state: 'decided' })).total, 0, 'nothing was decided');
  const done = await ok('POST', `${base}/journals/bulk`, { ids, decision: 'Bill', confirmCount: 2 });
  assert.equal(done.applied, true); assert.equal(done.changed, 2);
  assert.deepEqual(numbers((await review({ decision: 'Bill' })).items), ['JR/1', 'JR/2']);
  // changed on purpose (audit item 6): JR/1 and JR/2 had no decision. Their suggestion is a Bill, but as bills their
  // lines of a registered vendor would carry no tax Zoho accepts, so the files wrote them as Manual Journals (the
  // default's fallback). The review now says what the files did, so deciding Bill moves them: Bills and Journals are
  // out of date.
  assert.deepEqual([byNo['JR/1'].defaultDecision, byNo['JR/1'].defaultFallback], ['Manual Journal', 'bill_line_needs_tax_or_exemption']);
  const job = await get(base);
  assert.deepEqual(job.outOfDateFiles.sort(), ['bills', 'journals'], 'the files wrote these two journals as Manual Journals by default');
  let t = await trail(id);
  assert.ok(t.some(x => x === `${email} | journal_routed | JR/1 -> Bill, selected in the journal review`), 'each journal is audited with who decided');
  assert.ok(t.some(x => x.startsWith(`${email} | journals_bulk_routed | 2 journal voucher(s) routed to Bill, selected in the journal review.`)));
  assert.ok(!t.some(x => x.includes('JR/5 -> Bill')), 'the refused journal is not routed');
  // changing a decision says what it was
  await ok('POST', `${base}/journals/bulk`, { ids: [byNo['JR/1'].id], decision: 'Manual Journal', confirmCount: 1 });
  t = await trail(id);
  assert.ok(t.some(x => x.includes('JR/1 -> Manual Journal (was Bill) (suggestion was Bill), selected in the journal review')));
  assert.deepEqual((await get(base)).outOfDateFiles.sort(), ['bills', 'journals'], 'a decision that differs from what the files were built with marks both files out of date');

  // ----- the same decision for every journal of the same pattern -----
  const pp = await ok('POST', `${base}/journals/pattern`, { recordId: byNo['JR/3'].id, decision: 'Bill' });
  assert.equal(pp.pattern.journals, 4, 'the pattern covers JR/1, JR/2, JR/3 and the cancelled JR/8');
  assert.equal(pp.counts.change, 1, 'only the journal without a decision (JR/3)');
  assert.equal(pp.counts.alreadyThis, 1); assert.equal(pp.counts.keptOtherDecision, 1); assert.equal(pp.counts.notPosted, 1);
  const ppAll = await ok('POST', `${base}/journals/pattern`, { recordId: byNo['JR/3'].id, decision: 'Bill', includeDecided: true });
  assert.equal(ppAll.counts.change, 2, 'with "also change decided ones": JR/1 too');
  assert.equal((await send('POST', `${base}/journals/pattern`, { recordId: byNo['JR/3'].id, decision: 'Bill', confirmCount: 2 })).statusCode, 409);
  const ppDone = await ok('POST', `${base}/journals/pattern`, { recordId: byNo['JR/3'].id, decision: 'Bill', confirmCount: 1 });
  assert.equal(ppDone.changed, 1);
  assert.deepEqual(numbers((await review({ decision: 'Bill' })).items), ['JR/2', 'JR/3']);
  t = await trail(id);
  assert.ok(t.some(x => x.includes('JR/3 -> Bill, same pattern as JR/3 (Debit: Direct Expenses. Credit: Sundry Creditors.)')));
  assert.equal(t.filter(x => x.includes('| journals_bulk_routed |')).length, 3);

  // the single-journal route keeps its rule
  assert.equal((await send('PUT', `${base}/journals/${byNo['JR/5'].id}`, { decision: 'Bill' })).statusCode, 409);
  // bad input
  assert.equal((await send('POST', `${base}/journals/bulk`, { ids: [], decision: 'Bill' })).statusCode, 400);
  assert.equal((await send('POST', `${base}/journals/bulk`, { ids: [999999], decision: 'Bill' })).statusCode, 404);
  assert.equal((await send('POST', `${base}/journals/bulk`, { ids, decision: 'Payment' })).statusCode, 400);
  assert.equal((await send('POST', `${base}/journals/pattern`, { recordId: 999999, decision: 'Bill' })).statusCode, 404);

  // a viewer reads the review but cannot decide, not even a preview
  await login('viewer');
  const v = await review({});
  assert.equal(v.canChange, false); assert.equal(v.total, 10);
  assert.equal((await send('POST', `${base}/journals/bulk`, { ids, decision: 'Bill', preview: true })).statusCode, 403);
  assert.equal((await send('POST', `${base}/journals/pattern`, { recordId: byNo['JR/3'].id, decision: 'Bill', confirmCount: 0 })).statusCode, 403);
});
