// The Import Wizard, "Download all" and the completeness table.
// Every name, number and amount here is MADE UP (fixtures/allTransactions.js); only the structure copies real exports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-wizard-'));
const { buildApp } = await import('../src/index.js');
const { zipStore } = await import('../src/zipstore.js');
const { RULES, importGuide, stepPlan, readZohoAccounts, BANK_TYPES } = await import('../src/importwizard.js');
const { parseCsv } = await import('../src/zoho.js');
const { mastersDoc, VOUCHERS, transactionsDoc, trialBalanceReport, utf16le } = await import('../fixtures/allTransactions.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(fs.readFileSync(path.resolve(here, '../seed-users.json'), 'utf8'));

// Reads a zip back with no library: the end record, the central directory, then each stored entry with its CRC-32.
function unzip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, 'end of central directory');
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  assert.equal(at + buf.readUInt32LE(end + 12), end, 'the central directory ends where the end record starts');
  const out = {};
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(at), 0x02014b50);
    const crc = buf.readUInt32LE(at + 16), size = buf.readUInt32LE(at + 24), nameLen = buf.readUInt16LE(at + 28), local = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString('utf8');
    assert.equal(buf.readUInt32LE(local), 0x04034b50, `${name}: local header`);
    assert.equal(buf.readUInt16LE(local + 8), 0, `${name}: stored`);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    assert.equal(zlib.crc32(data), crc, `${name}: CRC-32`);
    out[name] = data;
    at += 46 + nameLen + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
  }
  return out;
}

test('the zip writer: stored entries that read back, UTF-8 names, unusable names refused', () => {
  const files = unzip(zipStore([{ name: 'READ_ME.txt', data: 'héllo\r\n' }, { name: 'folder/01_a.csv', data: Buffer.from('a,b\r\n1,2\r\n') }, { name: 'empty.csv', data: '' }]));
  assert.deepEqual(Object.keys(files), ['READ_ME.txt', 'folder/01_a.csv', 'empty.csv']);
  assert.equal(files['READ_ME.txt'].toString('utf8'), 'héllo\r\n');
  assert.equal(files['folder/01_a.csv'].toString(), 'a,b\r\n1,2\r\n');
  assert.equal(files['empty.csv'].length, 0);
  assert.throws(() => zipStore([{ name: '../outside.csv', data: 'x' }]), /not a usable file name/);
  assert.throws(() => zipStore([{ name: 'a.csv', data: 'x' }, { name: 'A.csv', data: 'y' }]), /Two files/);
});

test('the steps follow the rules file: order, what each file needs, click path, options, columns not to map', () => {
  const keys = ['customers', 'vendors', 'accounts', 'opening_balances_for_zoho_accounts', 'items', 'invoices', 'bills', 'journals', 'other_journals', 'opening_balances'];
  const plan = stepPlan(keys);
  assert.deepEqual(plan.map(p => p.id), ['setup', 'accounts', 'bank', 'date', 'customers', 'vendors', 'items', 'opening', 'bills', 'invoices', 'journals', 'other_journals', 'finish']);
  // the order is the rules' own order, not a list kept in the code
  const inRules = RULES.import_order.filter(o => o.kind === 'import' && keys.includes(o.module)).map(o => o.module);
  assert.deepEqual(plan.filter(p => p.kind === 'file').map(p => p.key), inRules);
  const need = id => plan.find(p => p.id === id).needs;
  assert.deepEqual(need('bills'), ['accounts', 'vendors', 'items']);
  assert.deepEqual(need('invoices'), ['accounts', 'customers', 'items']);
  assert.deepEqual(need('journals'), ['accounts', 'customers', 'vendors']);
  assert.equal(plan.find(p => p.id === 'opening').key, 'opening_balances_for_zoho_accounts');
  // the reference report is never a step; a file the rules do not place is not lost
  assert.ok(!plan.some(p => p.key === 'opening_balances'));
  assert.ok(stepPlan(['accounts', 'some_new_file']).some(p => p.key === 'some_new_file'));
  // without items, bills do not wait for them
  assert.deepEqual(stepPlan(['accounts', 'vendors', 'bills']).find(p => p.id === 'bills').needs, ['accounts', 'vendors']);

  const coa = importGuide('accounts');
  assert.deepEqual(coa.clicks.slice(0, 4).map(c => c.text), ['Accountant', 'Chart of Accounts', 'More (three dots, top right)', 'Import Chart of Accounts']);
  assert.deepEqual(coa.clicks.find(c => c.label === 'Duplicate Handling').value, 'Skip Duplicates');
  assert.deepEqual(coa.notes[0].others, ['Overwrite Accounts']);
  assert.deepEqual(coa.defaults, ['File Delimiter: Comma'], 'the path names the encoding, so only the delimiter is added');
  const journals = importGuide('journals');
  assert.ok(journals.clicks.some(c => c.option && /Auto-generate Journal Numbers/.test(c.label) && c.value === 'NOT ticked'));
  assert.match(journals.notes[0].why, /numbers of the file are ignored/);
  assert.equal(journals.notes.length, 1, 'an option named in the click path is not listed twice');
  // columns not to map: only those the file really has
  assert.deepEqual(importGuide('bills', ['Bill Number', 'Total', 'Balance']).doNotMap, ['Total', 'Balance']);
  assert.deepEqual(importGuide('bills', ['Bill Number']).doNotMap, []);
  // changed on purpose (opening balance batch): Cash accounts are kept in Banking too, and their balance goes to the journal
  assert.deepEqual(BANK_TYPES, ['Bank', 'Credit Card', 'Cash']);
  // every Tally group the vouchers treat as a bank or cash ledger gets a Zoho type Zoho keeps in Banking
  const byGroup = Object.fromEntries(RULES.lists.account_type_by_tally_group.groups.map(g => [g.tally_group, g.zoho_type]));
  for (const g of ['Bank Accounts', 'Bank OD A/c', 'Bank OCC A/c', 'Cash-in-Hand']) assert.ok(BANK_TYPES.includes(byGroup[g]), `${g} -> ${byGroup[g]}`);
});

test("Zoho's Chart of Accounts export: the names are found below title rows, once each", () => {
  const csv = 'Chart of Accounts\r\nExample Org\r\n\r\nAccount Name,Account Code,Account Type\r\nPetty Cash,,Cash\r\nSales,,Income\r\nsales,,Income\r\n,,\r\n';
  const read = readZohoAccounts(Buffer.from(csv));
  assert.deepEqual(read.accounts, [{ name: 'Petty Cash', accountType: 'Cash' }, { name: 'Sales', accountType: 'Income' }]);
  assert.match(readZohoAccounts(Buffer.from('Name,Type\r\nx,y\r\n')).error, /no "Account Name" column/);
});

// ---------- end to end ----------
const app = buildApp();
let cookie = '';
const call = opts => app.inject({ ...opts, headers: { ...(opts.headers || {}), ...(cookie ? { cookie } : {}) } });
const get = async url => { const r = await call({ url }); assert.equal(r.statusCode, 200, `${url}: ${r.body}`); return r.json(); };
const send = (method, url, payload) => call({ method, url, ...(payload !== undefined ? { payload } : {}) });
const putFile = (url, buffer, name) => call({ method: 'PUT', url, headers: { 'content-type': 'application/octet-stream', 'x-filename': name }, payload: buffer });
const login = async role => {
  const u = seed.users.find(x => x.role === role);
  cookie = String((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: u.password } })).headers['set-cookie']).split(';')[0];
};
// the made-up masters, with a bank balance (goes to the opening balance journal) and a customer in credit
const masters = () => {
  const doc = mastersDoc();
  const led = name => doc.tallymessage.find(r => r.metadata.type === 'Ledger' && r.metadata.name === name);
  led('Bank of Example').openingbalance = '-5000.00';
  led('Pine Hill Stores').openingbalance = '300.00';
  return doc;
};
const step = (w, id) => w.steps.find(s => s.id === id);

test('end to end: completeness table, locking, results, overrides, bank accounts, download all, viewers read', async () => {
  await login('analyst');
  const viewerCompany = seed.users.find(x => x.role === 'viewer').company || 'Sample Masters Co';
  const id = (await send('POST', '/api/migrations', { company: viewerCompany, financialYear: '2024-25' })).json().id;
  const base = `/api/migrations/${id}`;
  // nothing before processing
  assert.equal((await get(`${base}/completeness-table`)).available, false);
  assert.equal((await get(`${base}/import-wizard`)).available, false);
  assert.equal((await putFile(`${base}/uploads/all_masters`, utf16le(masters()), 'Master.json')).statusCode, 200);
  assert.equal((await putFile(`${base}/uploads/all_transactions`, utf16le(transactionsDoc(VOUCHERS)), 'Transactions.json')).statusCode, 200);
  await send('PUT', `${base}/waivers/stock_summary`, { reason: 'Not needed for test' });
  assert.equal((await putFile(`${base}/uploads/trial_balance`, utf16le(trialBalanceReport()), 'TrialBal.json')).statusCode, 200);
  assert.equal((await send('POST', `${base}/process?wait=1`)).statusCode, 200);

  // ---------- completeness table before the files: Tally's side only ----------
  let table = await get(`${base}/completeness-table`);
  assert.equal(table.available, true);
  assert.equal(table.filesCreated, false);
  assert.ok(table.rows.every(r => r.status === 'no_files' && r.zoho.count === null));
  assert.deepEqual(table.rows.slice(0, 12).map(r => r.key), ['accounts', 'customers', 'vendors', 'items', 'sales', 'purchase', 'payment', 'receipt', 'journal', 'contra', 'debit_note', 'credit_note']);
  assert.equal((await get(`${base}/import-wizard`)).message, 'Create the files first.');
  assert.equal((await send('GET', `${base}/download-all`)).statusCode, 409);

  const g = await send('POST', `${base}/generate`);
  assert.equal(g.statusCode, 200, g.body);
  const made = Object.fromEntries(g.json().files.map(f => [f.key, f]));
  assert.ok(made.opening_balances_for_zoho_accounts, 'the bank balance is in the opening balance journal');

  // ---------- completeness table ----------
  table = await get(`${base}/completeness-table`);
  const row = key => table.rows.find(r => r.key === key);
  const rec = await get(`${base}/voucher-reconciliation`);
  // vouchers: the same numbers as the voucher reconciliation, never worked out a second way
  for (const r of rec.rows) {
    const written = Object.entries(r.destinations).filter(([k]) => k.startsWith('written:')).reduce((t, [, n]) => t + n, 0);
    assert.deepEqual([row(r.slot).tally.count, row(r.slot).zoho.count, row(r.slot).difference.count], [r.in, written, r.in - written], r.slot);
    const a = rec.amounts.rows.find(x => x.slot === r.slot);
    assert.deepEqual([row(r.slot).tally.amount.signed, row(r.slot).zoho.amount.signed], [a.in.debit, a.written.debit], `${r.slot} amounts`);
  }
  // a voucher type with no vouchers is listed, and matches
  assert.deepEqual([row('purchase').tally.count, row('purchase').zoho.count, row('purchase').status], [0, 0, 'matches']);
  assert.equal(row('contra').status, 'matches');
  // changed on purpose (held-vouchers batch): a payment to a vendor is written as a Manual Journal, so nothing is held
  assert.equal(row('payment').status, 'matches');
  assert.deepEqual(row('payment').reasons, []);
  assert.ok(!table.rows.some(x => (x.reasons || []).some(y => String(y.kind).startsWith('held:'))), 'no voucher is held');
  assert.ok(row('journal').reasons.some(x => x.kind === 'left_out:cancelled' && x.count === 1));
  assert.ok(row('other_vouchers').reasons.some(x => x.kind === 'no_file'));
  // every difference is covered by its reasons: counts and amounts
  for (const r of table.rows) {
    assert.notEqual(r.status, 'not_matched', `${r.key}: ${JSON.stringify(r.reasons)}`);
    if (r.status === 'matches') { assert.equal(r.difference.count, 0); assert.ok(!r.difference.amount || Number(r.difference.amount.signed) === 0); }
  }
  // masters. Chart of Accounts: 10 ledgers that are not customers or vendors; Zoho's own accounts and Tally's
  // Profit & Loss A/c explain the difference; the bank balance is counted from the opening balance journal
  const acc = row('accounts');
  assert.equal(acc.tally.count, 10);
  assert.equal(acc.zoho.count, made.accounts.rows);
  assert.equal(acc.difference.count, acc.reasons.reduce((t, x) => t + x.count, 0));
  assert.deepEqual(acc.reasons.map(x => x.kind).sort(), ['profit_and_loss', 'zoho_account']);
  assert.deepEqual([acc.tally.amount.signed, acc.zoho.amount.signed, acc.difference.amount.signed, acc.status], ['-2999.50', '-2999.50', '0.00', 'explained']); // 2000.50 Cr and 5000.00 Dr
  assert.ok(acc.zoho.files.includes('opening_balances_for_zoho_accounts'));
  // Customers: one in credit. Changed on purpose (opening balance batch): its balance is no longer left for a person,
  // it is a line of journal OB-2 in the opening balance journal file, so the amounts agree
  const cust = row('customers');
  assert.deepEqual([cust.tally.count, cust.zoho.count, cust.difference.count], [2, 2, 0]);
  assert.deepEqual([cust.tally.amount.signed, cust.zoho.amount.signed, cust.difference.amount.signed], ['-1200.00', '-1200.00', '0.00']);
  assert.deepEqual(cust.reasons.map(x => [x.kind, x.count, x.explained]), [['unusual_side_in_journal', 1, true]]);
  assert.ok(cust.zoho.files.includes('opening_balances_for_zoho_accounts'));
  assert.equal(cust.status, 'matches');
  // v2 (vouchers.js default 15): the Items file also carries the service items of invoice lines that are not stock items
  assert.deepEqual([row('vendors').status, row('vendors').tally.amount.signed, row('items').status, row('items').tally.amount], ['matches', '2500.00', 'explained', null]);
  assert.deepEqual(row('items').reasons.map(x => [x.kind, x.count, x.explained]), [['service_items', row('items').difference.count, true]]);
  assert.equal(table.summary.notMatched, 0);
  assert.equal(table.summary.allAccountedFor, true);
  // the CSV
  let r = await call({ url: `${base}/completeness-table.csv` });
  assert.equal(r.statusCode, 200);
  const csv = parseCsv(r.body);
  assert.deepEqual(csv.headers, ['Dataset', 'Count in Tally', 'Count in Zoho files', 'Count difference', 'Amount in Tally', 'Amount in Zoho files', 'Amount difference', 'Status', 'Reasons']);
  assert.equal(csv.rows.length, table.rows.length);
  assert.match(csv.rows.find(x => x.Dataset === 'Customers').Reasons, /Customers in credit: balance carried by the opening balance journal \(OB-2\): 1/);

  // ---------- the wizard ----------
  let w = await get(`${base}/import-wizard`);
  // changed on purpose (held-vouchers batch): the page "Apply the credits" comes after the last journals file
  assert.deepEqual(w.steps.map(s => s.id), ['setup', 'accounts', 'bank', 'date', 'customers', 'vendors', 'items', 'opening', 'bills', 'invoices', 'journals', 'other_journals', 'credits', 'finish']);
  assert.deepEqual(w.steps.map(s => s.n), w.steps.map((_, i) => i + 1));
  assert.equal(w.current, 'setup');
  assert.equal(w.remembered, false);
  // set-up: the rules' items, each with its click path and ticks; the snapshot of Zoho's accounts is optional
  const setup = step(w, 'setup');
  assert.deepEqual(setup.items.slice(0, RULES.organisation_setup.length).map(i => i.what), RULES.organisation_setup.map(o => o.what));
  assert.ok(setup.items.find(i => /Preferences/.test(i.what)).ticks.some(t => /Adjustments/.test(t.text)));
  assert.ok(setup.items.find(i => i.upload).ticks.length === 0 && setup.items.find(i => i.upload).optional);
  assert.equal(setup.existingAccounts.source, 'default');
  // everything after the set-up is locked, with the reason in plain words
  assert.equal(step(w, 'accounts').locked, true);
  assert.match(step(w, 'accounts').lockReason, /^Needs the set-up\. \d+ set-up items are not ticked\. Do that first\.$/);
  // changed on purpose (audit item 11): no line of the Bills file names an item, so it does not wait for the Items file
  assert.match(step(w, 'bills').lockReason, /^Needs Chart of Accounts, Vendors and the Migration Date\. Not imported yet: Chart of Accounts and Vendors\. The Migration Date 31\/03\/2024 is not checked in Zoho Books yet \(step "Save the Migration Date"\)\. Do that first\.$/);
  assert.equal(step(w, 'bills').itemsNotNeeded, true);
  r = await send('PUT', `${base}/import-wizard/results/accounts`, { imported: made.accounts.rows, refused: 0 });
  assert.equal(r.statusCode, 409);
  assert.equal(r.json().locked, true);

  // ticks: only items of the step; each one is audited
  assert.equal((await send('PUT', `${base}/import-wizard/ticks`, { step: 'setup', item: 'nonsense', done: true })).statusCode, 400);
  for (const t of setup.items.flatMap(i => i.ticks)) assert.equal((await send('PUT', `${base}/import-wizard/ticks`, { step: 'setup', item: t.id, done: true })).statusCode, 200);
  w = await get(`${base}/import-wizard`);
  assert.equal(step(w, 'setup').done, true);
  assert.equal(step(w, 'accounts').locked, false);
  r = await send('PUT', `${base}/import-wizard/ticks`, { step: 'setup', item: setup.items[0].ticks[0].id, done: false });
  assert.equal(step(r.json(), 'accounts').locked, true, 'unticking locks the first import again');
  await send('PUT', `${base}/import-wizard/ticks`, { step: 'setup', item: setup.items[0].ticks[0].id, done: true });

  // the step is remembered on the server
  assert.equal((await send('PUT', `${base}/import-wizard/current`, { step: 'no-such-step' })).statusCode, 400);
  assert.equal((await send('PUT', `${base}/import-wizard/current`, { step: 'accounts' })).statusCode, 200);
  w = await get(`${base}/import-wizard`);
  assert.deepEqual([w.current, w.remembered], ['accounts', true]);

  // Chart of Accounts: what the tool expects, then what happened: 2 rows refused
  const coa = step(w, 'accounts');
  assert.equal(coa.expects.rows, made.accounts.rows);
  assert.equal(coa.expects.alreadyInZoho.source, 'default');
  assert.equal(coa.fileName, 'chart_of_accounts.csv');
  // documents: the wizard counts them as the Zoho check does (a bill is its number and its vendor)
  const zc = await get(`${base}/zoho-check`);
  for (const k of ['bills', 'invoices', 'journals']) {
    const s = step(w, k), f = zc.files.find(x => x.key === k);
    if (s && f) assert.equal(s.expects.documents, f.documents, `${k}: documents`);
  }
  assert.equal((await send('PUT', `${base}/import-wizard/results/accounts`, { imported: 'many', refused: 0 })).statusCode, 400);
  assert.equal((await send('PUT', `${base}/import-wizard/results/accounts`, { imported: 0, refused: 0 })).statusCode, 400);
  r = await send('PUT', `${base}/import-wizard/results/accounts`, { imported: made.accounts.rows - 2, refused: 2 });
  assert.equal(r.statusCode, 200, r.body);
  w = r.json();
  assert.deepEqual([step(w, 'accounts').importState, step(w, 'accounts').done, step(w, 'accounts').refused], ['refused', false, 2]);
  // the Import Tracker's list follows
  assert.deepEqual((await get(`${base}/imports`)).find(i => i.key === 'accounts').status, 'partial');
  // what depends on it stays locked: "2 rows were refused in Chart of Accounts. Fix those first."
  assert.match(step(w, 'customers').lockReason, /^Needs Chart of Accounts and the Migration Date\. 2 rows were refused in Chart of Accounts\. The Migration Date 31\/03\/2024 is not checked in Zoho Books yet.*Fix those first\.$/);
  assert.match(step(w, 'bills').lockReason, /2 rows were refused in Chart of Accounts\./);
  assert.equal((await send('PUT', `${base}/import-wizard/results/customers`, { imported: 2, refused: 0 })).statusCode, 409);

  // override with a typed reason: audited, shown, and removable. Changed on purpose (opening balance batch): the
  // Migration Date is a HARD lock, so a file that waits for it cannot be opened with a reason; the date step, which
  // waits only for the Chart of Accounts, can
  assert.equal((await send('PUT', `${base}/import-wizard/overrides/date`, { reason: 'ok' })).statusCode, 400);
  assert.equal((await send('PUT', `${base}/import-wizard/overrides/setup`, { reason: 'Nothing is locked here at all' })).statusCode, 409);
  r = await send('PUT', `${base}/import-wizard/overrides/customers`, { reason: 'The two refused accounts are not used by customers' });
  assert.deepEqual([r.statusCode, r.json().hard], [409, true]);
  assert.match(r.json().error, /cannot be opened with a reason/);
  assert.equal(step(w, 'customers').hardLocked, true);
  r = await send('PUT', `${base}/import-wizard/overrides/date`, { reason: 'The two refused accounts are not the one with a balance' });
  assert.equal(r.statusCode, 200);
  assert.deepEqual([step(r.json(), 'date').locked, step(r.json(), 'date').override.reason], [false, 'The two refused accounts are not the one with a balance']);
  assert.equal((await send('DELETE', `${base}/import-wizard/overrides/date`)).statusCode, 200);

  // the refused rows are fixed in Zoho: the result is typed again, and the lock opens
  w = (await send('PUT', `${base}/import-wizard/results/accounts`, { imported: made.accounts.rows, refused: 0 })).json();
  assert.equal(step(w, 'accounts').done, true);
  // the Migration Date (changed on purpose, opening balance batch). EVERY later file waits for it, and it is done only
  // when the date Zoho Books SHOWS is typed and is the Migration Date: no tick, no balance to type, nothing to set back.
  // The step waits only for the Chart of Accounts, whose one balance creates Zoho's opening balance record.
  for (const k of ['customers', 'vendors', 'items', 'opening', 'bills', 'invoices', 'journals', 'other_journals']) assert.deepEqual([step(w, k).locked, step(w, k).hardLocked], [true, true], k);
  assert.match(step(w, 'customers').lockReason, /the Migration Date/);
  const dateStep = step(w, 'date');
  assert.equal(dateStep.locked, false);
  assert.deepEqual([dateStep.date.value, dateStep.date.nice, dateStep.mode], ['2024-03-31', '31/03/2024', 'edit']);
  assert.deepEqual([dateStep.ticks, dateStep.balancesToType], [[], []], 'nothing to tick and no balance to type');
  assert.deepEqual(dateStep.chartBalances, [{ account: 'Owner Capital', side: 'Credit', amount: '2000.50' }], 'the one balance left in the Chart of Accounts file');
  assert.deepEqual(dateStep.dependsOn.map(d => [d.key, d.rows]), [['accounts', 1], ['customers', 1], ['vendors', 1]]);
  assert.ok(dateStep.lines.some(l => /Type no balance/.test(l)) && !dateStep.lines.some(l => /set it back|bank account is the simplest/i.test(l)));
  assert.match(dateStep.consequence, /will not match Tally/);
  assert.equal((await send('PUT', `${base}/import-wizard/ticks`, { step: 'date', item: 'd.confirmed', done: true })).statusCode, 400, 'a tick does not confirm the date');
  assert.equal((await send('PUT', `${base}/import-wizard/zoho-opening-date`, { date: 'yesterday' })).statusCode, 400);
  // Zoho shows another date (the day the organisation was made): kept, shown, and everything stays locked
  r = await send('PUT', `${base}/import-wizard/zoho-opening-date`, { date: '14/11/2026' });
  assert.equal(r.statusCode, 200, r.body);
  w = r.json();
  assert.deepEqual([w.dateDiffers, step(w, 'date').done, step(w, 'date').zohoDate.value, step(w, 'date').zohoDate.matches, step(w, 'customers').locked], [true, false, '2026-11-14', false, true]);
  assert.match(step(w, 'date').zohoDate.words, /Zoho Books shows 14\/11\/2026, but the Migration Date is 31\/03\/2024/);
  assert.match(step(w, 'customers').lockReason, /Zoho Books shows the Opening Balance Date 14\/11\/2026/);
  // the Zoho check: the contacts files are not "ready" (a step to do first), without counting refused rows
  let zcheck = await get(`${base}/zoho-check`);
  assert.deepEqual(zcheck.files.filter(f => ['accounts', 'customers', 'vendors'].includes(f.key)).map(f => [f.key, f.download, f.dateRows ?? 0, f.rowsWill]), [['accounts', 'ok', 0, 0], ['customers', 'confirm_date', 1, 0], ['vendors', 'confirm_date', 1, 0]]);
  assert.deepEqual(zcheck.preSteps.map(p => p.ruleId).sort(), ['CUS-OPENING-BALANCE-DATE', 'VEN-OPENING-BALANCE-DATE']);
  r = await call({ url: `${base}/files/customers/download` });
  assert.equal(r.statusCode, 409);
  assert.match(r.json().error, /must not be imported before the Migration Date is saved and checked/);
  // the right date, as Zoho Books shows it: the step is done and the files open
  r = await send('PUT', `${base}/import-wizard/zoho-opening-date`, { date: '31 Mar 2024', source: 'zoho_api' });
  w = r.json();
  assert.deepEqual([w.dateDiffers, step(w, 'date').done, step(w, 'date').zohoDate.matches, step(w, 'customers').locked], [undefined, true, true, false]);
  zcheck = await get(`${base}/zoho-check`);
  assert.deepEqual(zcheck.files.filter(f => ['customers', 'vendors'].includes(f.key)).map(f => f.download), ['ok', 'ok']);
  assert.equal(zcheck.preSteps.length, 0);
  assert.equal((await call({ url: `${base}/files/customers/download` })).statusCode, 200);
  r = await send('PUT', `${base}/import-wizard/results/customers`, { imported: 2, refused: 0 });
  assert.equal(r.statusCode, 200);
  assert.equal(step(r.json(), 'customers').done, true);
  w = r.json();
  assert.deepEqual([step(w, 'vendors').locked, step(w, 'items').locked, step(w, 'bank').locked], [false, false, false]);

  // bank accounts: listed from the Chart of Accounts file, the balance read from the opening balance journal
  const bank = step(w, 'bank');
  // (changed on purpose, opening balance batch: a Cash account is kept in Banking too, so it is listed here)
  assert.deepEqual(bank.accounts.map(a => [a.account, a.accountType, a.side, a.amount, a.done]), [['Bank of Example', 'Bank', 'Debit', '5000.00', false], ['Cash', 'Cash', '', '', false]]);
  assert.equal(bank.balancesIn, 'opening_balance_file');
  // changed on purpose (wizard-check batch): a missing CASH account is added in the Chart of Accounts, not in Banking,
  // so the step names both places and says how to add each kind
  assert.deepEqual(bank.paths, [['Banking'], ['Accountant', 'Chart of Accounts']]);
  assert.ok(bank.lines.some(l => /cash account/i.test(l) && /Account Type Cash/.test(l)), 'the step says how to add a missing cash account');
  assert.ok(bank.lines.some(l => /Add Bank or Credit Card/.test(l)));
  // journals post to bank accounts: locked until the account is ticked as present in Zoho Books
  for (const k of ['vendors', 'items']) await send('PUT', `${base}/import-wizard/results/${k}`, { imported: made[k].rows, refused: 0 });
  w = await get(`${base}/import-wizard`);
  assert.match(step(w, 'journals').lockReason, /^Needs Chart of Accounts, Customers, Vendors and the bank accounts\. 2 bank, credit card or cash accounts are not ticked as present in Zoho Books\. Do that first\.$/);
  assert.equal(step(w, 'bills').locked, false, 'bills do not wait for the bank accounts');
  for (const a of bank.accounts) w = (await send('PUT', `${base}/import-wizard/ticks`, { step: 'bank', item: a.id, done: true })).json();
  assert.deepEqual([step(w, 'bank').done, step(w, 'journals').locked, step(w, 'opening').locked], [true, false, false]);

  // opening balances: the journal file, and the same balances as a list to type when Zoho refuses the journal
  const opening = step(w, 'opening');
  assert.equal(opening.file.key, 'opening_balances_for_zoho_accounts');
  assert.equal(opening.source, 'opening_balance_file');
  assert.match(opening.sourceWords, /^Read from the opening balance journal file\.$/);
  assert.deepEqual(opening.lines.map(l => [l.account, l.side, l.amount, l.bank, l.typed.done]), [['Bank of Example', 'Debit', '5000.00', true, false]]);
  // changed on purpose (docs-frontend batch): the path of the Opening Balances page as it is today
  assert.deepEqual(opening.typePaths, [['Settings', 'Setup & Configurations', 'Opening Balances']]);
  assert.equal(opening.typeNeeded, false, 'the list to type is a last resort while the journal is the plan');
  r = await send('PUT', `${base}/import-wizard/results/opening_balances_for_zoho_accounts`, { imported: 0, refused: 2 });
  assert.equal(step(r.json(), 'opening').file.importState, 'failed');
  assert.equal(step(r.json(), 'opening').done, false);
  assert.equal(step(r.json(), 'opening').typeNeeded, true, 'Zoho refused the journal: the list to type is shown');
  w = (await send('PUT', `${base}/import-wizard/ticks`, { step: 'opening', item: opening.lines[0].id, done: true })).json();
  assert.deepEqual([step(w, 'opening').typedAll, step(w, 'opening').done, step(w, 'opening').bothWays], [true, true, false]);

  // undo a result
  w = (await send('DELETE', `${base}/import-wizard/results/items`)).json();
  // (changed on purpose, audit item 11: the bills name no item, so it is the invoices, with their service items, that wait)
  assert.deepEqual([step(w, 'items').importState, step(w, 'invoices').locked, step(w, 'bills').locked], ['not_imported', true, false]);
  await send('PUT', `${base}/import-wizard/results/items`, { imported: made.items.rows, refused: 0 });

  // Zoho's own Chart of Accounts export: stored per migration and used for "already in Zoho"
  r = await putFile(`${base}/import-wizard/zoho-accounts`, Buffer.from('Account Name,Account Type\r\nCash,Cash\r\nOwner Capital,Equity\r\nSomething Else,Expense\r\n'), 'zoho_accounts.csv');
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().accounts, 3);
  w = r.json().wizard;
  assert.deepEqual([step(w, 'setup').existingAccounts.source, step(w, 'setup').existingAccounts.count], ['uploaded', 3]);
  assert.deepEqual([step(w, 'accounts').expects.alreadyInZoho.count, step(w, 'accounts').expects.alreadyInZoho.names.sort()], [2, ['Cash', 'Owner Capital']]);
  assert.deepEqual((await get(`${base}/import-wizard/zoho-accounts`)).names, ['Cash', 'Owner Capital', 'Something Else']);
  assert.equal((await putFile(`${base}/import-wizard/zoho-accounts`, Buffer.from('x,y\r\n1,2\r\n'), 'wrong.csv')).statusCode, 422);
  assert.equal((await send('DELETE', `${base}/import-wizard/zoho-accounts`)).statusCode, 200);
  assert.equal((await get(`${base}/import-wizard/zoho-accounts`)).source, 'default');

  // ---------- download all ----------
  // audit item 18: "Download anyway" is enforced by the server too: the Invoices file has a row Zoho is expected to
  // refuse, so the zip needs a confirmation (the screen posts zoho-check/acknowledge first; ?confirmed=1 does the same)
  r = await call({ url: `${base}/download-all` });
  assert.deepEqual([r.statusCode, r.json().needsConfirmation, r.json().files.map(f => f.key)], [409, true, ['invoices']]);
  assert.equal((await send('POST', `${base}/zoho-check/acknowledge`, { key: 'invoices' })).statusCode, 200);
  r = await call({ url: `${base}/download-all` });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.headers['content-type'], 'application/zip');
  const zip = unzip(r.rawPayload);
  assert.deepEqual(Object.keys(zip), ['READ_ME_FIRST.txt', 'READ_ME_IMPORT_ORDER.txt', '01_chart_of_accounts.csv', '02_contacts_customers.csv', '03_contacts_vendors.csv', '04_items.csv', '05_opening_balances_for_zoho_accounts.csv',
    '06_bills.csv', '07_invoices.csv', '08_journals.csv', '09_journals_receipts_payments_contra.csv', 'not_for_import/opening_balances_reference_do_not_import.csv',
    // changed on purpose (held-vouchers batch): the list of credits to apply (never imported)
    'not_for_import/credits_to_apply.csv',
    // changed on purpose (wizard-check batch): the trial balance Zoho Books should show, worked out from the files and
    // compared with Tally (never imported)
    'not_for_import/predicted_trial_balance.csv']);
  assert.match(zip['not_for_import/predicted_trial_balance.csv'].toString('utf8'), /^Part,Account or contact,Tally closing,Tally side,Zoho Books expected,Zoho side,Difference,Difference side,Result,Tally ledgers,Comes from\r\n/);
  assert.match(zip['READ_ME_IMPORT_ORDER.txt'].toString('utf8'), /The trial balance Zoho Books should show after these files[\s\S]*not_for_import\/predicted_trial_balance\.csv/);
  assert.match(zip['READ_ME_FIRST.txt'].toString('utf8'), /The trial balance Zoho Books should show after these files/);
  assert.match(zip['not_for_import/credits_to_apply.csv'].toString('utf8'), /^﻿Contact Type,Contact,Journal Number,Journal Date,Journal File,Account,What To Do,Invoice or Bill Number,Amount,Note\r?\n/);
  // each file is byte for byte the file of the single download
  const single = await call({ url: `${base}/files/accounts/download` });
  assert.ok(zip['01_chart_of_accounts.csv'].equals(single.rawPayload));
  const readme = zip['READ_ME_IMPORT_ORDER.txt'].toString('utf8');
  assert.match(readme, /Step 2\. 01_chart_of_accounts\.csv/);
  assert.match(readme, /Click: Accountant > Chart of Accounts > More \(three dots, top right\) > Import Chart of Accounts/);
  // changed on purpose (held-vouchers batch): step 13 is "Apply the credits", so the comparison is step 14
  assert.match(readme, /Step 13\. Apply the credits/);
  assert.match(readme, /The list: not_for_import\/credits_to_apply\.csv/);
  assert.match(readme, /Step 14\. Compare the trial balances/);
  // docs-frontend batch: both read-me files print "While you import" from the rules (general.while_importing), the
  // journal steps carry their own lessons, counts are said in good English, and READ_ME_FIRST lists the assumptions
  const first = zip['READ_ME_FIRST.txt'].toString('utf8');
  for (const text of [readme, first]) {
    assert.match(text, /\r\nWhile you import\r\n/);
    assert.match(text, /Nothing handled the action gotoImportPreview" on its own page \(not in an error file\), the file is not the problem\. Reload the page/);
    assert.match(text, /Import one file at a time, in the order of the Import Wizard\./);
  }
  assert.match(readme, /Step 12\. 09_journals_receipts_payments_contra\.csv[^\r]*\r\n(?:   [^\r]*\r\n)*   Good to know: A journal refused with "Invalid row"/);
  assert.match(readme, /Good to know: A journal with a customer or vendor on Accounts Receivable or Accounts Payable \(Contact Name filled\) and a bank or cash line/);
  assert.doesNotMatch(readme, /must show 1 journals/);
  assert.doesNotMatch(readme, /Step 2\. 01_chart_of_accounts\.csv[^\r]*\r\n(?:   [^\r]*\r\n)*   Good to know/, 'the chart step has the export check, not the same lesson again');
  assert.match(first, /\r\nAssumptions the tool made\r\n   Where nobody made a decision, the tool used a safe default/);
  const assumed = await get(`${base}/assumptions`);
  for (const a of assumed.assumptions) assert.ok(first.includes(`   - ${a.title} (${a.count}): `), a.title);
  // the wizard: each file step carries the lessons of that file, and the opening step says the journal is the plan
  const wz = await get(`${base}/import-wizard`);
  const tipIds = key => { const s = wz.steps.find(x => x.key === key) || wz.steps.find(x => x.file?.key === key); return (s.file || s).guide.tips.map(t => t.id); };
  assert.deepEqual(tipIds('other_journals').slice(0, 2), ['missing-contact-refuses-the-journal', 'contact-and-bank-journals-are-accepted']);
  assert.ok(tipIds('customers').includes('count-after-the-import'));
  assert.ok(!tipIds('bills').includes('missing-contact-refuses-the-journal'), 'the journal lesson is not said on bills');
  assert.ok(tipIds('bills').includes('nothing-handled-goto-import-preview'), 'a general lesson is on every file');
  const obStep = wz.steps.find(s => s.kind === 'opening');
  assert.match(obStep.journalDate.nice, /^\d{2}\/\d{2}\/\d{4}$/, 'the date of OB-1, said on the page');

  // ---------- a file created again ----------
  // unchanged files keep their result (the Import Tracker's list is put back); a changed file must be imported again
  await send('PUT', `${base}/tax-mappings`, { ledger: 'Input CGST', zohoTax: 'GST18' });
  r = await call({ url: `${base}/download-all` });
  assert.equal(r.statusCode, 200);
  assert.match(unzip(r.rawPayload)['READ_ME_IMPORT_ORDER.txt'].toString('utf8'), /NOT IN THIS ZIP\. The file is out of date/);
  const again = await send('POST', `${base}/generate`);
  assert.equal(again.statusCode, 200);
  const remade = Object.fromEntries(again.json().files.map(f => [f.key, f]));
  w = await get(`${base}/import-wizard`);
  assert.equal(remade.accounts.sha256, made.accounts.sha256);
  assert.deepEqual([step(w, 'accounts').done, step(w, 'customers').done], [true, true], 'the same file was imported: it still counts');
  assert.equal((await get(`${base}/imports`)).find(i => i.key === 'accounts').status, 'imported');

  // ---------- audit, viewers, other firms ----------
  const audit = (await get(`${base}/audit`)).map(a => a.action);
  for (const action of ['import_wizard_ticked', 'import_wizard_unticked', 'import_result_recorded', 'import_result_removed', 'import_lock_overridden', 'import_lock_restored', 'zoho_accounts_uploaded', 'zoho_accounts_removed']) {
    assert.ok(audit.includes(action), `audit has ${action}`);
  }
  assert.ok((await get(`${base}/audit`)).some(a => a.action === 'import_lock_overridden' && /The two refused accounts are not the one with a balance/.test(a.detail)));
  assert.ok((await get(`${base}/audit`)).some(a => a.action === 'download' && /all files in one zip/.test(a.detail)));

  await login('viewer');
  w = await get(`${base}/import-wizard`);
  assert.equal(w.canChange, false);
  assert.equal((await get(`${base}/completeness-table`)).available, true);
  // the Invoices file was created again with other contents: its "Download anyway" must be confirmed again; a viewer
  // confirms in the request (a GET), and the viewer's download writes nothing but the audit log (audit item 18)
  assert.equal((await call({ url: `${base}/download-all` })).statusCode, 409);
  const statusBefore = JSON.stringify((await get(`${base}/imports`)).map(i => [i.key, i.status]));
  assert.equal((await call({ url: `${base}/download-all?confirmed=1` })).statusCode, 200);
  assert.equal(JSON.stringify((await get(`${base}/imports`)).map(i => [i.key, i.status])), statusBefore, 'a viewer\'s download changes no import status');
  // ... and stores no confirmation: only the audit log has it, so the next download asks again
  assert.equal((await call({ url: `${base}/download-all` })).statusCode, 409, 'a viewer\'s "Download anyway" is for that download only');
  const blockedFile = (await call({ url: `${base}/download-all` })).json().files[0].key;
  assert.equal((await call({ url: `${base}/files/${blockedFile}/download` })).statusCode, 409);
  assert.equal((await call({ url: `${base}/files/${blockedFile}/download?confirmed=1` })).statusCode, 200);
  assert.ok((await get(`${base}/audit`)).some(a => a.action === 'zoho_check_download_confirmed' && /view-only user/.test(a.detail)));
  for (const [method, url, payload] of [['PUT', `${base}/import-wizard/ticks`, { step: 'finish', item: 'f.1', done: true }], ['PUT', `${base}/import-wizard/results/bills`, { imported: 1, refused: 0 }],
    ['PUT', `${base}/import-wizard/current`, { step: 'finish' }], ['PUT', `${base}/import-wizard/overrides/bills`, { reason: 'a viewer may not do this' }], ['DELETE', `${base}/import-wizard/zoho-accounts`]]) {
    assert.equal((await send(method, url, payload)).statusCode, 403, `${method} ${url}`);
  }
  assert.equal((await send('GET', '/api/migrations/MIG-NOT-THERE/import-wizard')).statusCode, 404);
  assert.equal((await send('GET', '/api/migrations/MIG-NOT-THERE/completeness-table')).statusCode, 404);
  assert.equal((await send('GET', '/api/migrations/MIG-NOT-THERE/download-all')).statusCode, 404);
});
