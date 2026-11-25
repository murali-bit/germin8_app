// Stage C13: the "Prepare migration" checklist. It restates what the rest of the platform holds, so every count is
// compared here with the answer of the screen where it is decided. Uses the made-up three-file samples (15, 16, 17).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-prepare-'));
const { buildApp } = await import('../src/index.js');
const { decisionItems, THREE_FILES } = await import('../src/prepare.js');

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
};
const get = async url => { const r = await call({ url }); assert.equal(r.statusCode, 200, `${url}: ${r.body}`); return r.json(); };
const send = (method, url, payload) => call({ method, url, payload });
const ok = async (method, url, payload) => { const r = await send(method, url, payload); assert.equal(r.statusCode, 200, `${method} ${url}: ${r.body}`); return r.json(); };
const upload = (id, slot, f) => call({ method: 'PUT', url: `/api/migrations/${id}/uploads/${slot}`, headers: { 'content-type': 'application/octet-stream', 'x-filename': f }, payload: fs.readFileSync(path.join(samples, f)) });
const company = () => {
  const doc = JSON.parse(fs.readFileSync(path.join(samples, '15_all_masters_for_transactions_utf16.json')).toString('utf16le').replace(/^﻿/, ''));
  return (doc.static_variables || []).find(v => v.name === 'svCurrentCompany')?.value || 'Made-up Company';
};
const step = (s, key) => s.steps.find(x => x.key === key);
const item = (s, key) => step(s, 'decisions').items.find(x => x.key === key);

test('C13: the open decisions are grouped by screen, and a setting with nothing to decide is shown, not counted', () => {
  const views = {
    accountTypes: () => ({ groups: [{ group: 'A', ledgers: 2, needsDecision: true }, { group: 'B', ledgers: 0, needsDecision: false }, { group: 'C', ledgers: 1, needsDecision: false }] }),
    taxes: () => [{ ledger: 'T1', mapped: false, taxRowVouchers: 3, vouchers: 3 }, { ledger: 'TDS', mapped: false, taxRowVouchers: 0, partySideVouchers: 4, vouchers: 4 }, { ledger: 'T2', mapped: true, listStatus: 'not_in_list' }],
    tds: () => ({ ledgers: [{}, {}], unmapped: 1 }),
    units: () => ({ units: [{ zohoUnit: 'pcs' }, { zohoUnit: null }] }),
    items: () => ({ counts: { items: 4, withoutSellingRate: 2, withoutPurchaseRate: 3, withoutTaxPreference: 4 } }),
    clashes: () => ({ clashes: [{}, {}], undecided: 1 }),
    names: () => ({ counts: { names: 5, cleaned: 3, notCleaned: 2, duplicates: 4, duplicatesUndecided: 2, duplicatesOnlyOnceCleaned: 1 },
      duplicates: [{ decision: null, sameName: true, sameWrittenName: true }, { decision: null, sameName: false, sameGstin: true }, { decision: null, sameName: true, sameWrittenName: false }, { decision: 'merge', sameName: true, sameWrittenName: true }] }),
    contacts: () => ({ counts: { contacts: 10, withProblems: 4 }, problems: [{ words: 'No state', remaining: 4 }, { words: 'Other', remaining: 0 }] }),
    journals: () => [{ decision: null, clear: true }, { decision: 'Bill' }, { decision: null, clear: false }, { decision: null, notPosted: 'cancelled' }],
    gst: () => ({ codeSet: 'help', label: "As on Zoho's help page", unregisteredConsumerAs: '' }),
  };
  const items = decisionItems(views);
  const by = Object.fromEntries(items.map(i => [i.key, i]));
  // (audit item 15: HSN/SAC codes Zoho does not accept are an item of their own)
  assert.deepEqual(items.map(i => i.key), ['account_types', 'tax_mapping', 'tds_mapping', 'units', 'item_rates', 'builtin_accounts', 'names', 'duplicates', 'contact_fixes', 'hsn', 'journal_routing', 'gst_codes']);
  assert.equal(by.account_types.open, 1); assert.equal(by.account_types.total, 2, 'only groups with ledgers');
  assert.equal(by.tax_mapping.open, 2, 'the unmapped tax used on a line, and the name not in the list; a ledger only on the party side needs none');
  assert.equal(by.tds_mapping.open, 1);
  assert.equal(by.units.open, 0); assert.equal(by.units.info, true);
  // v2 (changed on purpose: both blocked the import). An item with no selling rate is written with Rate 0.00 and an
  // account named like one of Zoho's own uses Zoho's account, both by default: they stay listed, and no longer block.
  assert.deepEqual([by.item_rates.open, by.item_rates.blocksImport, by.item_rates.byDefault], [2, false, 2]);
  assert.match(by.item_rates.words, /Rate 0\.00 is written by default/);
  assert.deepEqual([by.builtin_accounts.open, by.builtin_accounts.blocksImport, by.builtin_accounts.byDefault], [1, false, 1]);
  assert.match(by.builtin_accounts.words, /Zoho's own account is used by default/);
  // changed on purpose (pick and drop): names with hidden characters are a warning, not an open decision
  assert.deepEqual([by.names.open, by.names.info, by.names.blocksImport, by.names.warnings], [0, true, false, 2]);
  assert.equal(by.duplicates.open, 2); assert.equal(by.duplicates.blocksImport, true, 'an undecided group written with the same name blocks');
  assert.equal(by.duplicates.warnings, 1); assert.match(by.duplicates.words, /1 group is the same only once cleaned: a warning/);
  const onlyCleaned = decisionItems({ ...views, names: () => ({ counts: { names: 1, notCleaned: 1, duplicates: 1, duplicatesUndecided: 0, duplicatesOnlyOnceCleaned: 1 }, duplicates: [{ decision: null, sameName: true, sameWrittenName: false }] }) });
  assert.equal(onlyCleaned.find(i => i.key === 'duplicates').blocksImport, false, 'names the same only once cleaned do not block');
  assert.equal(by.contact_fixes.open, 4); assert.match(by.contact_fixes.words, /no state \(4\)/);
  assert.equal(by.journal_routing.open, 2); assert.equal(by.journal_routing.total, 3, 'a cancelled journal needs no routing');
  // v2 default 8 (changed on purpose: unrouted journals blocked the import, because they were left out of the files)
  assert.deepEqual([by.journal_routing.blocksImport, by.journal_routing.byDefault], [false, 2]);
  assert.match(by.journal_routing.words, /2 journal vouchers have no routing decision and are written by default.*None is left out\./);
  assert.deepEqual(items.filter(i => i.blocksImport).map(i => i.key), ['tds_mapping', 'duplicates'], 'what still blocks: a TDS ledger with no Zoho TDS tax, and two rows written with the same name');
  assert.equal(by.gst_codes.info, true); assert.match(by.gst_codes.words, /Unregistered\/Consumer/);
  for (const i of items) { assert.ok(i.screen && i.anchor && i.place, `${i.key} says where to decide it`); assert.ok(i.words, i.key); }
  assert.deepEqual(THREE_FILES.map(f => f.slot), ['all_masters', 'all_transactions', 'trial_balance']);
});

test('C13 end to end: from an empty migration to the files in import order, every count read from the screens', async () => {
  await login('analyst');
  const r = await send('POST', '/api/migrations', { company: company(), financialYear: '2024-25' });
  assert.equal(r.statusCode, 201);
  const id = r.json().id;
  const base = `/api/migrations/${id}`;

  // ----- nothing uploaded -----
  let s = await get(`${base}/prepare`);
  assert.equal(s.current, 'upload');
  assert.deepEqual(step(s, 'upload').files.map(f => f.uploaded), [false, false, false]);
  assert.equal(step(s, 'process').canStart, false);
  assert.ok(step(s, 'process').blockers.length > 0, 'what blocks processing is said');
  assert.equal(step(s, 'decisions').items, null, 'nothing can be decided before processing');
  assert.equal(s.canChange, true);

  // ----- the three files -----
  assert.equal((await upload(id, 'all_masters', '15_all_masters_for_transactions_utf16.json')).statusCode, 200);
  assert.equal((await upload(id, 'all_transactions', '16_all_transactions_utf16.json')).statusCode, 200);
  s = await get(`${base}/prepare`);
  assert.deepEqual(step(s, 'upload').files.map(f => f.uploaded), [true, true, false]);
  assert.ok(step(s, 'upload').files[0].datasets.length > 0, 'what the All masters file was split into');
  assert.equal(step(s, 'upload').done, false);
  assert.equal((await upload(id, 'trial_balance', '17_trial_balance_report_utf16.json')).statusCode, 200);
  s = await get(`${base}/prepare`);
  assert.equal(step(s, 'upload').done, true);
  assert.equal(s.current, 'datasets');

  // ----- datasets with no file: the same as Completeness Check -----
  const comp = await get(`${base}/completeness`);
  const missing = comp.slots.filter(x => x.requirement !== 'optional' && x.status === 'missing');
  assert.deepEqual(step(s, 'datasets').datasets.filter(d => d.status === 'missing').map(d => d.key).sort(), missing.map(x => x.key).sort());
  for (const d of step(s, 'datasets').datasets.filter(x => x.status === 'missing')) {
    assert.equal(d.canMarkNotApplicable, comp.slots.find(x => x.key === d.key).canMarkNotApplicable);
    await ok('PUT', `${base}/waivers/${d.key}`, { reason: 'Made-up company keeps no inventory' });
  }
  s = await get(`${base}/prepare`);
  assert.equal(step(s, 'datasets').done, true);
  assert.equal(step(s, 'process').ready, true); assert.equal(step(s, 'process').canStart, true);
  assert.equal(s.current, 'process');

  // ----- processing -----
  assert.equal((await send('POST', `${base}/process?wait=1`)).statusCode, 200);
  s = await get(`${base}/prepare`);
  assert.equal(step(s, 'process').done, true);
  assert.equal(step(s, 'process').processing.state, 'done');

  // ----- the decisions: each count is the count of the screen where it is decided -----
  const d = step(s, 'decisions');
  const journals = (await get(`${base}/journals`)).filter(j => !j.notPosted);
  const names = await get(`${base}/names`), contacts = await get(`${base}/contact-fixes`), items = await get(`${base}/item-rates`), clashes = await get(`${base}/account-clashes`);
  const tds = await get(`${base}/tds-mappings`), types = await get(`${base}/account-types`);
  const by = Object.fromEntries(d.items.map(i => [i.key, i]));
  assert.equal(by.journal_routing.open, journals.filter(j => !j.decision).length);
  assert.equal(by.journal_routing.open, (await get(`${base}/journals/review`)).counts.undecided, 'the same count as the journal review');
  // changed on purpose (pick and drop): names not cleaned are warnings, counted as such and not as open decisions
  assert.equal(by.names.warnings, names.counts.notCleaned);
  assert.equal(by.names.open, 0);
  assert.equal(by.duplicates.open, names.counts.duplicatesUndecided);
  assert.equal(by.contact_fixes.open, contacts.counts.withProblems);
  assert.equal(by.item_rates.open, items.counts.withoutSellingRate);
  assert.equal(by.builtin_accounts.open, clashes.undecided);
  assert.equal(by.tds_mapping.open, tds.unmapped);
  assert.equal(by.account_types.open, types.groups.filter(g => g.ledgers > 0 && g.needsDecision).length);
  assert.equal(d.open, d.items.filter(i => !i.info).reduce((t, i) => t + i.open, 0));
  assert.ok(by.journal_routing.open > 0, 'the made-up file has journals to route');

  // live: routing the journals lowers the count at once
  const open = journals.filter(j => !j.decision);
  await ok('POST', `${base}/journals/bulk`, { ids: open.map(j => j.id), decision: 'Manual Journal', confirmCount: open.length });
  s = await get(`${base}/prepare`);
  assert.equal(item(s, 'journal_routing').open, 0);

  // ----- the files, and the downloads in import order -----
  assert.equal(step(s, 'files').created, 0); assert.equal(step(s, 'files').canCreate, true);
  assert.equal((await send('POST', `${base}/generate`)).statusCode, 200);
  s = await get(`${base}/prepare`);
  assert.equal(step(s, 'files').done, true);
  const imports = await get(`${base}/imports`);
  assert.deepEqual(step(s, 'download').files.map(f => f.key), imports.map(i => i.key), 'the import order of the Import Tracker');
  assert.ok(step(s, 'download').files.every(f => !f.downloaded));
  assert.ok(step(s, 'download').reference.every(f => !imports.some(i => i.key === f.key)), 'reference reports are listed apart');
  const first = step(s, 'download').files[0];
  assert.equal((await call({ url: `${base}/files/${first.key}/download` })).statusCode, 200);
  s = await get(`${base}/prepare`);
  assert.equal(step(s, 'download').files[0].downloaded, true);

  // a decision changed after the files: the files step says which file is out of date
  const movable = journals.find(j => !j.refused?.Bill);
  assert.ok(movable, 'a made-up journal that may be routed to Bill');
  await ok('PUT', `${base}/journals/${movable.id}`, { decision: 'Bill' });
  s = await get(`${base}/prepare`);
  assert.ok(step(s, 'files').outOfDate.some(f => f.key === 'journals'), 'the Manual Journals file is out of date');
  assert.equal(step(s, 'files').done, false);
  assert.ok(step(s, 'download').files.some(f => f.key === 'journals' && f.outOfDate));

  // ----- a viewer reads the same checklist but cannot start anything -----
  await login('viewer');
  const v = await call({ url: `${base}/prepare` });
  if (v.statusCode === 200) { // the viewer of the seed users sees only the company named in seed-users.json
    assert.equal(v.json().canChange, false);
    assert.equal(step(v.json(), 'process').canStart, false);
    assert.equal(step(v.json(), 'files').canCreate, false);
  } else assert.equal(v.statusCode, 404);
});

test('Prepare migration: tax ledgers left as own accounts are counted and the trial balance difference is said', () => {
  const views = { accountTypes: () => ({ groups: [] }), taxes: () => [], tds: () => ({ ledgers: [], unmapped: 0 }), units: () => ({ units: [], counts: {} }), items: () => ({ counts: {}, items: [] }),
    names: () => ({ counts: {}, duplicates: [] }), contacts: () => ({ counts: {}, problems: [] }), journals: () => [], gst: () => ({}),
    clashes: () => ({ clashes: [{ needsDecision: true }, { needsDecision: true }, { needsDecision: false }], undecided: 0, onDefault: 0 }) };
  const item = decisionItems(views).find(i => i.key === 'builtin_accounts');
  assert.equal(item.warnings, 2);
  assert.match(item.words, /2 tax ledgers \(reverse charge, cess or TDS\) stay as accounts of their own/);
  assert.match(item.words, /trial balance will differ/);
  views.clashes = () => ({ clashes: [{ needsDecision: false }], undecided: 0, onDefault: 0 });
  assert.equal(decisionItems(views).find(i => i.key === 'builtin_accounts').warnings, 0);
});
