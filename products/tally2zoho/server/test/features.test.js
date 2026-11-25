// Key-field warnings (A2), Zoho tax list (A5), test run report (A7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wizardReady } from './wizardready.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-feat-'));
const { buildApp } = await import('../src/index.js');
const { similarity, mostSimilar } = await import('../src/similar.js');
const here = path.dirname(fileURLToPath(import.meta.url));
const samples = path.resolve(here, '../../sample-data');
const app = buildApp();
const seed = JSON.parse(fs.readFileSync(path.resolve(here, '../seed-users.json'), 'utf8'));
let cookie = '';
const call = opts => app.inject({ ...opts, headers: { ...(opts.headers || {}), ...(cookie ? { cookie } : {}) } });
const login = async role => {
  const u = seed.users.find(x => x.role === role);
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: u.password } });
  assert.equal(r.statusCode, 200, `login as ${role}`);
  cookie = String(r.headers['set-cookie']).split(';')[0];
};
const get = async url => (await call({ url })).json();
const send = (method, url, payload) => call({ method, url, payload });
const putFile = (id, slot, file) => call({ method: 'PUT', url: `/api/migrations/${id}/uploads/${slot}`, headers: { 'content-type': 'application/octet-stream', 'x-filename': path.basename(file) }, payload: fs.readFileSync(file) });
const putBuf = (id, slot, obj) => call({ method: 'PUT', url: `/api/migrations/${id}/uploads/${slot}`, headers: { 'content-type': 'application/octet-stream', 'x-filename': 'test.json' }, payload: Buffer.from(JSON.stringify(obj)) });
const FILES = {
  customers: '01_customers.json', vendors: '02_vendors.json', accounts: '03_chart_of_accounts.json', stock_items: '04_stock_items.json',
  units: '05_units.json', taxes: '06_tax_configuration.json', sales: '07_sales_vouchers.json', purchase: '08_purchase_vouchers.json',
  receipt: '09_receipt_vouchers.json', payment: '10_payment_vouchers.json', journal: '11_journal_vouchers.json', trial_balance: '13_trial_balance.json',
};
const newMigration = async () => {
  const r = await send('POST', '/api/migrations', { company: 'Apex Engineering Technologies Pvt. Ltd.', financialYear: '2024-25' });
  assert.equal(r.statusCode, 201);
  return r.json().id;
};
const uploadAll = async (id, skip = []) => {
  for (const [slot, f] of Object.entries(FILES)) if (!skip.includes(slot)) assert.equal((await putFile(id, slot, path.join(samples, f))).statusCode, 200, slot);
  await send('PUT', `/api/migrations/${id}/waivers/stock_summary`, { reason: 'Not needed for test' });
};
const trail = async id => (await get(`/api/migrations/${id}/audit`)).map(a => `${a.action} | ${a.detail}`);

test('similar names are suggestions by shared words and letters', () => {
  assert.equal(similarity('name', 'Name'), 1);
  assert.ok(similarity('partygstin', 'gstin') > 0.6);
  assert.ok(similarity('name', 'closingbalance') < 0.45);
  assert.deepEqual(mostSimilar('name', ['Name', 'ledgername', 'guid', 'creditperiod']), ['Name', 'ledgername']);
  assert.deepEqual(mostSimilar('GST 18', ['GST18', 'IGST 18%', 'Exempt'], { minScore: 0 }).slice(0, 2), ['GST18', 'IGST 18%']);
});

test('A2: key fields the platform needs are checked at upload', async () => {
  await login('analyst');
  const id = await newMigration();
  const base = `/api/migrations/${id}`;
  const field = (res, name, type) => res.keyFields.fields.find(f => f.field === name && (!type || f.recordType === type));

  // the sample file has every required field in every record: nothing to warn about
  let r = await putFile(id, 'customers', path.join(samples, FILES.customers));
  assert.equal(r.statusCode, 200);
  let u = r.json();
  assert.equal(u.mayNotBeReadable, false);
  assert.deepEqual(u.warnings, []);
  assert.deepEqual([field(u, 'name').level, field(u, 'name').present, field(u, 'name').total, field(u, 'name').status, field(u, 'name').severity], ['required', 4, 4, 'present', null]);
  assert.equal(field(u, 'partygstin').level, 'optional');

  // a required field under another name: accepted, with a strong warning that names the field, its use and similar names found
  const custom = { tallymessage: [1, 2, 3].map(i => ({ metadata: { type: 'Ledger' }, LedgerName: `Customer ${i}`, parent: 'Sundry Debtors', gstin: `27AAAAA000${i}A1Z5`, openingbalance: '-10.00' })) };
  r = await putBuf(id, 'customers', custom);
  assert.equal(r.statusCode, 200, 'a missing key field never rejects the file');
  u = r.json();
  const name = field(u, 'name');
  assert.deepEqual([name.level, name.present, name.total, name.status, name.severity], ['required', 0, 3, 'absent', 'warning']);
  assert.deepEqual(name.similar, ['LedgerName']);
  const strong = u.warnings.find(w => /"name"/.test(w));
  assert.match(strong, /none of the 3 Ledger records in this file has a value in the field "name"/);
  assert.match(strong, /The platform uses it for the ledger name/);
  assert.match(strong, /may use a different field name/);
  assert.match(strong, /similar name: "LedgerName"/);
  // an optional field that is in no record is reported, but as information and not as required
  const gst = field(u, 'partygstin');
  assert.deepEqual([gst.level, gst.present, gst.status, gst.severity], ['optional', 0, 'absent', 'info']);
  assert.deepEqual(gst.similar, ['gstin']);
  assert.ok(!u.warnings.some(w => /partygstin/.test(w)), 'an optional field is never a warning');
  assert.ok(u.keyFields.notices.some(n => /"partygstin"/.test(n) && /This can be correct/.test(n)));
  // an optional field present in every record says nothing
  assert.equal(field(u, 'openingbalance').severity, null);
  // the name is the only field a customer ledger cannot do without, so this file may not be readable
  assert.equal(u.mayNotBeReadable, true);

  // a required field in only some records: a count as information, not a warning
  custom.tallymessage[0].name = 'Customer 1';
  u = (await putBuf(id, 'customers', custom)).json();
  assert.deepEqual([field(u, 'name').present, field(u, 'name').status, field(u, 'name').severity], [1, 'partial', 'info']);
  assert.match(field(u, 'name').message, /has a value in 1 of 3 Ledger records/);
  assert.ok(!u.warnings.some(w => /"name"/.test(w)));
  assert.equal(u.mayNotBeReadable, false);

  // every required field missing from every record: accepted, flagged as "may not be readable"
  const odd = { tallymessage: [1, 2].map(i => ({ metadata: { type: 'Voucher', vchtype: 'Sales' }, Date: '20240612', VoucherNo: `S${i}`, entries: [{ ledger: 'X', value: '1.00' }] })) };
  r = await putBuf(id, 'sales', odd);
  assert.equal(r.statusCode, 200, r.body);
  u = r.json();
  assert.equal(u.mayNotBeReadable, true);
  assert.match(u.warnings.find(w => /may not be readable/.test(w)), /Sales Vouchers: this file may not be readable/);
  assert.deepEqual(field(u, 'vouchernumber').similar, ['VoucherNo']);
  assert.equal(field(u, 'metadata.vchtype or vouchertypename').status, 'present');
  assert.deepEqual([field(u, 'ledgername (on the voucher lines)').status, field(u, 'amount (on the voucher lines)').status], ['absent', 'absent']);
  // line fields are looked for on the lines
  const lines = { tallymessage: [{ metadata: { type: 'Voucher', vchtype: 'Sales' }, date: '20240612', vouchernumber: 'S1', allinventoryentries: [{ stockitemname: 'Bolt', accountingallocations: [{ LedgerName: 'Sales', amount: '5.00' }] }] }] };
  u = (await putBuf(id, 'sales', lines)).json();
  assert.equal(u.mayNotBeReadable, false);
  assert.deepEqual([field(u, 'amount (on the voucher lines)').status, field(u, 'ledgername (on the voucher lines)').status, field(u, 'ledgername (on the voucher lines)').similar], ['present', 'absent', ['LedgerName']]);

  // completeness carries the same per dataset, and the list of datasets that may not be readable
  await putBuf(id, 'sales', odd);
  let comp = await get(`${base}/completeness`);
  const sales = comp.slots.find(s => s.key === 'sales');
  assert.equal(sales.mayNotBeReadable, true);
  assert.equal(sales.upload.keyFields.mayNotBeReadable, true);
  assert.equal(sales.upload.keyFields.fields.find(f => f.field === 'date').severity, 'warning');
  assert.deepEqual(comp.mayNotBeReadable, [{ slot: 'sales', name: 'Sales Vouchers' }]);
  assert.equal(comp.slots.find(s => s.key === 'customers').mayNotBeReadable, false);
  assert.equal(comp.slots.find(s => s.key === 'vendors').mayNotBeReadable, false, 'nothing uploaded');
  // the report carries it too
  const ds = (await get(`${base}/report`)).datasets.find(d => d.key === 'sales');
  assert.equal(ds.mayNotBeReadable, true);
  assert.ok(ds.keyFieldsMissing.some(f => f.field === 'date'));
  assert.ok((await trail(id)).some(t => /^upload \| Sales Vouchers: .*the file may not be readable/.test(t)));

  // Group records in the Chart of Accounts are checked as groups
  u = (await putFile(id, 'accounts', path.join(samples, FILES.accounts))).json();
  assert.deepEqual([field(u, 'parent', 'Group').total, field(u, 'parent', 'Ledger').total, field(u, 'parent', 'Ledger').level], [4, 17, 'required']);
  assert.deepEqual(u.warnings, []);
});

test('A5: Zoho tax list, checked mappings and the pair check', async () => {
  await login('analyst');
  const id = await newMigration();
  const base = `/api/migrations/${id}`;
  await uploadAll(id);
  assert.equal((await send('POST', `${base}/process`)).statusCode, 200);
  const generate = async () => { const g = await send('POST', `${base}/generate`); assert.equal(g.statusCode, 200, g.body); };
  const genFlags = async () => (await get(`${base}/summary`)).exceptions.filter(e => e.stage === 'generate' && e.slot === 'taxes');
  const mapTax = (ledger, zohoTax) => send('PUT', `${base}/tax-mappings`, { ledger, zohoTax });
  const taxes = async () => Object.fromEntries((await get(`${base}/tax-mappings`)).map(t => [t.ledger, t]));
  const outOfDate = async () => (await get(base)).outOfDateReasons.map(x => x.reason);

  // no list yet: free text is allowed and marked as not checked
  let list = await get(`${base}/zoho-taxes`);
  assert.deepEqual([list.exists, list.count, list.names], [false, 0, []]);
  let r = await mapTax('Output CGST', 'cgst 9');
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().listStatus, 'not_checked');
  let t = await taxes();
  assert.deepEqual([t['Output CGST'].zohoTax, t['Output CGST'].mapped, t['Output CGST'].checkedAgainstList, t['Output CGST'].inList, t['Output CGST'].listStatus], ['cgst 9', true, false, null, 'not_checked']);
  assert.match(t['Output CGST'].note, /Not checked against your Zoho tax list/);
  assert.deepEqual([t['Output IGST'].listStatus, t['Output IGST'].inList, t['Output IGST'].note], ['unmapped', null, null]);
  // usage: how many vouchers, and which tax ledgers are on the same voucher
  assert.deepEqual([t['Output CGST'].vouchers, t['Output CGST'].appearsWith], [2, [{ ledger: 'Output SGST', vouchers: 2, zohoTax: '', mapped: false }]]);
  assert.ok(t['Output IGST'].vouchers >= 2);
  assert.deepEqual(t['Output IGST'].appearsWith, []);

  // pair check: CGST is mapped, SGST on the same voucher is not: ONE item for the unmapped ledger
  await generate();
  let flags = await genFlags();
  const pair = flags.filter(e => e.kind === 'tax_pair_incomplete');
  assert.equal(pair.length, 1);
  assert.deepEqual([pair[0].name, pair[0].uses], ['Output SGST', 2]); // one sales and one purchase voucher in the sample set
  assert.match(pair[0].message, /Tax ledger "Output SGST" is not mapped to a Zoho tax, but on 2 vouchers it appears together with "Output CGST" \(mapped to "cgst 9", 2 vouchers\)/);
  assert.ok(!flags.some(e => e.kind === 'tax_pair_incomplete' && e.name === 'Output IGST'), 'a ledger that is alone on its vouchers is not a pair');
  assert.ok(!flags.some(e => e.kind === 'tax_not_in_list'), 'no list, nothing to compare');

  // saving the list: trimmed, blanks and duplicates (ignoring capital letters) dropped, first spelling kept
  assert.equal((await send('PUT', `${base}/zoho-taxes`, { text: '  \n \n' })).statusCode, 400);
  assert.equal((await send('PUT', `${base}/zoho-taxes`, { text: 'x'.repeat(101) })).statusCode, 400);
  assert.equal((await send('PUT', `${base}/zoho-taxes`, { names: 'CGST 9' })).statusCode, 400);
  r = await send('PUT', `${base}/zoho-taxes`, { text: '  CGST 9  \r\n\r\nSGST 9\ncgst 9\nIGST 18\n  \nGST Exempt\n' });
  assert.equal(r.statusCode, 200, r.body);
  let saved = r.json();
  assert.deepEqual(saved.names, ['CGST 9', 'SGST 9', 'IGST 18', 'GST Exempt']);
  assert.deepEqual([saved.exists, saved.count, saved.changed, saved.duplicatesDropped, saved.added.length, saved.removed], [true, 4, true, 1, 4, []]);
  // the mapping matched a listed name apart from capital letters: it now has the listed spelling, and that is recorded
  assert.deepEqual(saved.mappingsRespelled, [{ ledger: 'Output CGST', from: 'cgst 9', to: 'CGST 9' }]);
  assert.deepEqual(saved.mappingsNotInList, []);
  t = await taxes();
  assert.deepEqual([t['Output CGST'].zohoTax, t['Output CGST'].checkedAgainstList, t['Output CGST'].inList, t['Output CGST'].listStatus, t['Output CGST'].note], ['CGST 9', true, true, 'in_list', null]);
  let log = await trail(id);
  assert.ok(log.some(x => /^zoho_tax_list_saved \| 4 names in the list \(no list before\)\. Added \(4\): "CGST 9", "SGST 9", "IGST 18", "GST Exempt"\./.test(x)));
  assert.ok(log.includes('tax_mapping_respelled | Tally ledger "Output CGST": Zoho tax "cgst 9" is now written as in the Zoho tax list, "CGST 9"'));
  assert.ok((await outOfDate()).some(x => /A Zoho tax list was saved \(4 names\)/.test(x)), 'saving the list marks the files out of date');
  // (audit item 5: a tax mapping can move journals routed by default between files, and the service items follow)
  assert.deepEqual((await get(base)).outOfDateFiles, ['items', 'invoices', 'bills', 'journals']);
  assert.deepEqual((await get(`${base}/zoho-taxes`)).names, ['CGST 9', 'SGST 9', 'IGST 18', 'GST Exempt']);

  // saving the same list again changes nothing: no audit entry, files not marked again
  await generate();
  const before = (await trail(id)).length;
  r = await send('PUT', `${base}/zoho-taxes`, { names: ['CGST 9', 'SGST 9', 'IGST 18', 'GST Exempt', 'sgst 9'] });
  assert.deepEqual([r.json().changed, r.json().added, r.json().removed], [false, [], []]);
  assert.equal((await trail(id)).length, before);
  assert.equal((await get(base)).filesOutOfDate, false);

  // with a list, a name that is not in it is refused, and the closest listed names are given
  r = await mapTax('Output SGST', 'SGST9%');
  assert.equal(r.statusCode, 400);
  assert.equal(r.json().notInList, true);
  assert.equal(r.json().suggestions[0], 'SGST 9');
  assert.match(r.json().error, /"SGST9%" is not in your Zoho tax list\. The closest names in the list are: "SGST 9"/);
  assert.equal((await taxes())['Output SGST'].zohoTax, '', 'nothing was stored');
  assert.equal((await get(base)).filesOutOfDate, false, 'a refused mapping changes nothing');
  // a listed name is accepted whatever its capital letters and outer spaces, and stored with the listed spelling
  r = await mapTax('Output SGST', '  sgst 9 ');
  assert.equal(r.statusCode, 200);
  assert.deepEqual([r.json().zohoTax, r.json().listStatus], ['SGST 9', 'in_list']);
  assert.ok((await outOfDate()).some(x => /"Output SGST" was mapped to Zoho tax "SGST 9"/.test(x)));
  await generate();
  // mapping to the same name again is not a change
  assert.equal((await mapTax('Output SGST', 'SGST 9')).statusCode, 200);
  assert.equal((await get(base)).filesOutOfDate, false);
  flags = await genFlags();
  assert.ok(!flags.some(e => e.kind === 'tax_pair_incomplete'), 'both ledgers of the pair are mapped now');
  assert.ok(flags.some(e => /"Output IGST" is not mapped/.test(e.message)), 'the plain unmapped item is still raised');

  // removing a name that is in use: the mapping is kept and flagged, never deleted
  r = await send('PUT', `${base}/zoho-taxes`, { text: 'CGST 9\nIGST 18\nGST Exempt' });
  saved = r.json();
  assert.deepEqual([saved.changed, saved.added, saved.removed], [true, [], ['SGST 9']]);
  assert.deepEqual(saved.mappingsNotInList, [{ ledger: 'Output SGST', zohoTax: 'SGST 9' }]);
  t = await taxes();
  assert.deepEqual([t['Output SGST'].zohoTax, t['Output SGST'].mapped, t['Output SGST'].checkedAgainstList, t['Output SGST'].inList, t['Output SGST'].listStatus], ['SGST 9', true, true, false, 'not_in_list']);
  assert.match(t['Output SGST'].note, /"SGST 9" is not in your Zoho tax list\. The mapping was kept/);
  assert.deepEqual(t['Output CGST'].appearsWith, [{ ledger: 'Output SGST', vouchers: 2, zohoTax: 'SGST 9', mapped: true }]);
  log = await trail(id);
  assert.ok(log.some(x => /^zoho_tax_list_saved \| 3 names in the list \(was 4\)\. Removed \(1\): "SGST 9"\. 1 tax mapping use a name that is not in the list \("Output SGST" -> "SGST 9"\); they were kept and are flagged\./.test(x)));
  assert.ok((await outOfDate()).some(x => /The Zoho tax list was changed \(1 removed\)/.test(x)));
  await generate();
  flags = await genFlags();
  const notListed = flags.filter(e => e.kind === 'tax_not_in_list');
  assert.deepEqual(notListed.map(e => e.name), ['Output SGST']);
  assert.match(notListed[0].message, /mapped to Zoho tax "SGST 9", which is not in your Zoho tax list/);
  // B6 (changed on purpose: no separate tax rows any more): CGST and SGST mapped to two different Zoho taxes cannot go
  // on one Zoho line, so that invoice is flagged and its tax cells are left empty
  const lineFlags = (await get(`${base}/summary`)).exceptions.filter(e => e.kind === 'line_tax_names_differ');
  assert.ok(lineFlags.length >= 1 && /mapped to different Zoho taxes \("CGST 9", "SGST 9"\)/.test(lineFlags[0].message), JSON.stringify(lineFlags));
  assert.doesNotMatch((await call({ url: `${base}/files/invoices/download` })).body, /SGST 9/, 'no separate tax row, and no half of a pair on a line');

  // clearing the list: mappings stay, and are no longer checked
  r = await send('DELETE', `${base}/zoho-taxes`);
  assert.deepEqual([r.json().exists, r.json().changed, r.json().removed], [false, true, ['CGST 9', 'IGST 18', 'GST Exempt']]);
  assert.ok((await trail(id)).some(x => /^zoho_tax_list_cleared \| The list of 3 names was removed/.test(x)));
  assert.equal((await taxes())['Output SGST'].listStatus, 'not_checked');
  assert.equal((await get(base)).filesOutOfDate, true);
  await generate();
  assert.equal((await send('DELETE', `${base}/zoho-taxes`)).json().changed, false, 'clearing an empty list is not a change');
  assert.equal((await get(base)).filesOutOfDate, false);
  assert.equal((await mapTax('Output IGST', 'anything typed')).statusCode, 200, 'free text again');
  assert.equal((await mapTax('No Such Ledger', 'x')).statusCode, 404);

  await login('viewer');
  assert.equal((await get(`${base}/zoho-taxes`)).exists, false, 'a viewer can read the list');
  assert.equal((await send('PUT', `${base}/zoho-taxes`, { text: 'A' })).statusCode, 403);
  assert.equal((await send('DELETE', `${base}/zoho-taxes`)).statusCode, 403);
});

test('A7: test run report', async () => {
  await login('analyst');
  const id = await newMigration();
  const base = `/api/migrations/${id}`;
  const upload = (url, text) => call({ method: 'PUT', url, headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from(text) });
  const report = async () => { const r = await call({ url: `${base}/test-report` }); assert.equal(r.statusCode, 200, r.body); return r.json(); };
  const fixes = rep => rep.whatToFixNext.map(f => `${f.stage}|${f.blocking}|${f.message}`);
  // changed on purpose: 'filesHoldingSeveralDatasets' was added (the All Masters and All Transactions files)
  // changed on purpose in B8: 'waitingForZohoSample' was added (modules with no Zoho import sample, and the vouchers held for them)
  // changed on purpose in v2: 'assumptions' was added (every default the tool applied to the files created last)
  const SECTIONS = ['reportCreatedAt', 'migration', 'datasets', 'filesHoldingSeveralDatasets', 'processing', 'decisions', 'files', 'voucherControl', 'assumptions', 'waitingForZohoSample', 'importStatus', 'rejections', 'reconciliation', 'whatToFixNext', 'notes'];

  // ---- nothing uploaded yet ----
  let rep = await report();
  assert.deepEqual(Object.keys(rep), SECTIONS);
  assert.deepEqual([rep.migration.id, rep.migration.company, rep.migration.financialYear, rep.migration.status], [id, 'Apex Engineering Technologies Pvt. Ltd.', '2024-25', 'awaiting_uploads']);
  assert.equal(rep.datasets.length, 17); // changed on purpose: Contra, Debit Notes, Credit Notes and Other Voucher Types were added to the 13
  assert.deepEqual([rep.processing.lastRun, rep.processing.totalRecordsStored, rep.processing.flaggedItems.total, rep.files, rep.rejections, rep.reconciliation], [null, 0, 0, [], [], []]);
  assert.ok(rep.whatToFixNext.every(f => f.stage === 'Upload' && f.blocking === true), 'before any upload only uploads are listed');
  assert.equal(rep.whatToFixNext.length, 13);
  assert.match(rep.whatToFixNext[0].message, /Upload the Customer Master file\. It is required/);
  assert.ok(fixes(rep).some(f => /Upload the Stock Summary file, or mark it as not applicable/.test(f)));
  assert.deepEqual(rep.whatToFixNext.map(f => f.order), rep.whatToFixNext.map((_, i) => i + 1));
  assert.ok(rep.notes.some(n => /official Zoho Books \(India\) sample import files/.test(n)) && rep.notes.some(n => /reference report only: do not import/.test(n)) && rep.notes.some(n => /no score/.test(n)));
  assert.ok(!JSON.stringify(rep).match(/readiness.{0,20}\d+ ?%|"score"/i), 'no invented scores');

  // ---- uploaded: one file may not be readable, one count does not match ----
  await uploadAll(id, ['sales']);
  await putFile(id, 'sales', path.join(samples, 'problem-files/sales_unknown_names.json'));
  await putFile(id, 'journal', path.join(samples, 'problem-files/journal_unbalanced.json'));
  await putBuf(id, 'units', { tallymessage: [{ metadata: { type: 'Unit' }, UnitName: 'nos', extra1: 'x' }] });
  await send('PUT', `${base}/expected-counts/customers`, { expected: 5 });
  rep = await report();
  const ds = Object.fromEntries(rep.datasets.map(d => [d.key, d]));
  assert.deepEqual([ds.customers.fileName, ds.customers.records, ds.customers.expectedCount, ds.customers.actualCount, ds.customers.countMatches], ['01_customers.json', 4, 5, 4, false]);
  assert.match(ds.customers.sha256, /^[a-f0-9]{64}$/);
  // gstregistrationtype is read since the real TallyPrime structure is supported (written as GST Treatment); the credit period gives Payment Terms
  assert.deepEqual([ds.customers.fieldsNotTransferred.count, ds.customers.fieldsNotTransferred.top.map(f => f.name)], [0, []]);
  assert.deepEqual([ds.units.mayNotBeReadable, ds.units.keyFieldFindings.find(f => f.field === 'name').similar], [true, ['UnitName']]);
  assert.deepEqual([ds.stock_summary.status, ds.stock_summary.notApplicableReason, ds.stock_summary.fileName], ['not_applicable', 'Not needed for test', null]);
  let fx = fixes(rep);
  assert.ok(fx.some(f => /^Upload\|true\|Customer Master: Tally shows 5 ledgers, but the uploaded file has 4 ledgers/.test(f)));
  assert.ok(fx.some(f => /^Upload\|false\|Units of Measurement: the file "test\.json" may not be readable/.test(f)));
  assert.ok(!fx.some(f => /^Processing/.test(f)), 'processing is not offered while a count blocks it');
  await send('PUT', `${base}/expected-counts/customers`, { expected: '' });
  await putFile(id, 'units', path.join(samples, FILES.units));
  fx = fixes(await report());
  assert.deepEqual(fx, ['Processing|true|All datasets are in place. Process the uploaded data.']);

  // ---- processed ----
  assert.equal((await send('POST', `${base}/process`)).statusCode, 200);
  rep = await report();
  assert.equal(rep.processing.lastRun.state, 'done');
  assert.equal(typeof rep.processing.lastRun.secondsTaken, 'number');
  assert.equal(rep.processing.lastRun.startedBy, 'analyst@demo.test');
  assert.equal(rep.processing.totalRecordsStored, rep.datasets.reduce((t, d) => t + (d.records || 0), 0));
  assert.deepEqual(rep.processing.recordsStored.find(x => x.slot === 'accounts' && x.type === 'Group'), { slot: 'accounts', name: 'Chart of Accounts', type: 'Group', records: 4 });
  const groups = rep.processing.flaggedItems.groups;
  const missing = groups.find(g => g.stage === 'crosscheck' && g.kind === 'ledger_missing');
  assert.ok(missing.count >= 2 && missing.examples.length >= 1 && missing.examples.length <= 3);
  assert.match(missing.examples[0].message, /is not in the Customer, Vendor, Chart of Accounts or Tax files/);
  assert.ok(groups.some(g => g.stage === 'process' && g.kind === 'unbalanced' && g.count === 1), 'items without a recorded kind are grouped by what they say');
  assert.equal(rep.processing.flaggedItems.total, groups.reduce((t, g) => t + g.count, 0));
  assert.deepEqual([rep.decisions.accountTypes.needingDecision, rep.decisions.accountTypes.groupsNeedingDecision.map(g => g.group)], [1, ['Branch / Divisions']]);
  assert.ok(rep.decisions.accountTypes.standard > 0 && rep.decisions.accountTypes.inherited > 0);
  assert.deepEqual([rep.decisions.accountTypes.decided, rep.decisions.taxMappings.taxLedgers, rep.decisions.taxMappings.mapped, rep.decisions.taxMappings.unmapped, rep.decisions.taxMappings.zohoTaxListExists], [0, 3, 0, 3, false]);
  // v2 default 8 (changed on purpose): 'routedByDefault' was added. A journal with no decision is not left out of the
  // files: it is routed by the tool's default.
  assert.deepEqual(rep.decisions.journalRouting, { total: 4, decided: 0, overridden: 0, undecided: 4, routedByDefault: 4 });
  assert.deepEqual([rep.decisions.unitMappings.units, rep.decisions.unitMappings.mapped, rep.decisions.unitMappings.writtenAsInTally], [3, 0, 3]);
  fx = fixes(rep);
  const stageOrder = ['Upload', 'Processing', 'Decisions', 'Files', 'Import', 'Rejections', 'Reconciliation'];
  const inOrder = list => list.map(f => stageOrder.indexOf(f.split('|')[0])).every((n, i, a) => i === 0 || a[i - 1] <= n);
  assert.ok(inOrder(fx), 'ordered by where in the flow they block');
  assert.ok(fx.some(f => /^Processing\|false\|\d+ flagged items? of kind "ledger_missing"/.test(f)));
  assert.ok(fx.some(f => /^Decisions\|false\|1 Tally group with ledgers has no Zoho account type: "Branch \/ Divisions"/.test(f)));
  // v2 (changed on purpose): the 3 GST ledgers have a rate in Tally, so they are written with Zoho's own tax names
  // automatically and nobody is asked to map them
  assert.deepEqual([rep.decisions.taxMappings.automatic, rep.decisions.taxMappings.needPerson], [3, 0]);
  assert.ok(!fx.some(f => /not mapped to a Zoho tax/.test(f)));
  assert.ok(fx.some(f => /^Decisions\|false\|4 journal vouchers have no routing decision\. They are not left out: each is written by the tool's default/.test(f)));
  assert.ok(fx.includes('Files|true|No files have been created yet. Create the files.'));
  assert.ok(!fx.some(f => /^(Import|Rejections|Reconciliation)/.test(f)));

  // ---- decisions, files, import, rejections, reconciliation ----
  await send('PUT', `${base}/account-types`, { group: 'Branch / Divisions', zohoType: 'Other Current Asset' });
  await send('PUT', `${base}/zoho-taxes`, { text: 'CGST 9\nSGST 9\nIGST 18' });
  for (const [ledger, zohoTax] of [['Output CGST', 'CGST 9'], ['Output IGST', 'IGST 18']]) assert.equal((await send('PUT', `${base}/tax-mappings`, { ledger, zohoTax })).statusCode, 200);
  await send('POST', `${base}/journals/accept-suggestions`);
  assert.equal((await send('POST', `${base}/generate`)).statusCode, 200);
  await send('PUT', `${base}/zoho-taxes`, { text: 'CGST 9\nSGST 9' }); // after the files were created: a name in use is removed
  await call({ url: `${base}/files/accounts/download` });
  await wizardReady(call, base); // set-up and Migration Date first: the older route follows the wizard's locks
  assert.equal((await send('PUT', `${base}/imports/accounts`, { status: 'imported' })).statusCode, 200);
  await wizardReady(call, base);
  assert.equal((await send('PUT', `${base}/imports/customers`, { status: 'partial', note: '1 row rejected' })).statusCode, 200);
  await upload(`${base}/rejections/customers`, 'Display Name,Error Message\r\nKaveri Components,Billing State is mandatory\r\nSomeone Unknown Ltd,Duplicate record\r\n');
  await upload(`${base}/verification/customers`, 'Display Name,Opening Balance\r\nAdani Solar Equipment Ltd.,"1,45,000.00"\r\nKaveri Components,1.00\r\nOld Zoho Customer,5.00\r\n');
  rep = await report();
  assert.deepEqual(Object.keys(rep), SECTIONS);
  assert.deepEqual([rep.decisions.accountTypes.decided, rep.decisions.accountTypes.needingDecision], [1, 0]);
  assert.deepEqual([rep.decisions.taxMappings.mapped, rep.decisions.taxMappings.unmapped, rep.decisions.taxMappings.notInList, rep.decisions.taxMappings.zohoTaxListCount], [2, 1, 1, 2]);
  assert.deepEqual(rep.decisions.taxMappings.ledgersNotInList, [{ ledger: 'Output IGST', zohoTax: 'IGST 18' }]);
  assert.deepEqual(rep.decisions.taxMappings.unmappedLedgers.map(t => [t.ledger, t.appearsWithMapped]), [['Output SGST', ['Output CGST']]]);
  assert.equal(rep.decisions.journalRouting.undecided, 0);
  const file = Object.fromEntries(rep.files.map(f => [f.key, f]));
  // the standard layout of the Customers file is the official Zoho sample's, checked by the platform
  assert.deepEqual([file.customers.fileName, file.customers.rows, file.customers.templateMarkedAsMatchingZohoSample, file.customers.templateStatement?.builtIn, file.customers.templateStatement?.sampleFileName, file.customers.layoutIsCurrent],
    ['contacts_customers.csv', 4, true, true, 'customer_import_sample_data.xls', true]);
  assert.match(file.customers.layoutVersion, /^[a-f0-9]+$/);
  assert.deepEqual([file.invoices.outOfDate, file.accounts.outOfDate], [true, false], 'the tax list changed after the files were created');
  const imp = Object.fromEntries(rep.importStatus.map(i => [i.key, i]));
  assert.deepEqual([imp.accounts.status, imp.customers.status, imp.customers.note, imp.vendors.status], ['imported', 'partial', '1 row rejected', 'generated']);
  assert.deepEqual(rep.rejections, [{ key: 'customers', module: 'Customers', total: 2, open: 1, corrected: 0, retried: 0, unlinked: 1,
    categories: [{ category: 'Duplicate record', count: 1 }, { category: 'Missing mandatory field', count: 1 }] }]);
  const rc = rep.reconciliation.find(x => x.key === 'customers');
  assert.deepEqual([rc.checked, rc.expected, rc.matched, rc.missing, rc.extra, rc.amountsCompared, rc.amountsDiffering, rc.totalExpectedCompared, rc.totalInZoho], [true, 4, 2, 2, 1, 2, 1, '183900.00', '145001.00']);
  assert.equal(rep.reconciliation.find(x => x.key === 'accounts').checked, false);
  fx = fixes(rep);
  assert.ok(inOrder(fx));
  assert.ok(!fx.some(f => /^Upload|Branch \/ Divisions|have no routing decision/.test(f)), 'fixed things are no longer listed');
  assert.ok(fx.some(f => /^Decisions\|false\|Tax ledger "Output SGST" is not mapped, but it is on the same vouchers as "Output CGST", which is mapped/.test(f)));
  assert.ok(fx.some(f => /^Decisions\|false\|Tax ledger "Output IGST" is mapped to "IGST 18", which is not in your Zoho tax list/.test(f)));
  assert.ok(fx.some(f => /^Files\|true\|\d files are out of date and cannot be downloaded or marked as imported: [A-Za-z, ]*Bills, Invoices[A-Za-z, ]*\. The Zoho tax list was changed \(1 removed\)\. Create the files again\./.test(f)));
  assert.ok(fx.some(f => /^Files\|false\|\d+ flagged items? of kind "tax_pair_incomplete" from creating the files/.test(f)));
  // B6 (changed on purpose): the Invoices, Bills and Manual Journals layouts are now the official samples' too
  assert.ok(!fx.some(f => /not been confirmed against an official Zoho sample file/.test(f)), 'every file is checked; the reference report is not imported');
  assert.ok(fx.includes('Import|false|Customers: the import was recorded as partly done (1 row rejected).'));
  assert.ok(fx.some(f => /^Import\|false\|\d+ files are not yet recorded as imported: .*The next one to import is Vendors\./.test(f)));
  assert.ok(fx.includes('Rejections|false|Customers: 1 rejection still to be corrected and 1 rejection that could not be linked to a Tally record.'));
  assert.ok(fx.includes('Reconciliation|false|Chart of Accounts: recorded as imported, but no Zoho report has been uploaded to check it.'));
  assert.ok(fx.includes('Reconciliation|false|Customers: 2 records of 4 were not found in the Zoho report.'));
  assert.ok(fx.includes('Reconciliation|false|Customers: 1 amount of 2 compared differs from the Zoho report.'));

  // ---- a file replaced after processing ----
  await putFile(id, 'customers', path.join(samples, FILES.customers));
  rep = await report();
  assert.equal(rep.processing.storedFromEarlierFiles, true);
  assert.ok(fixes(rep).some(f => /^Processing\|true\|A file was uploaded or removed after the data was last processed/.test(f)));

  // ---- the same report as a file (JSON), also for a viewer ----
  await login('viewer');
  const dl = await call({ url: `${base}/test-report?download=1` });
  assert.equal(dl.statusCode, 200);
  assert.match(dl.headers['content-disposition'], new RegExp(`attachment; filename="test-report-${id}\\.json"`));
  assert.match(dl.headers['content-type'], /application\/json/);
  assert.deepEqual(Object.keys(JSON.parse(dl.body)), SECTIONS);
  assert.equal((await call({ url: '/api/migrations/MIG-0000-999/test-report' })).statusCode, 404);
});
