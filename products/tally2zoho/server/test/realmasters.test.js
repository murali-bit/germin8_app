// Problems found in a real TallyPrime 7.1 master export: hidden characters (line breaks, U+FEFF) in names, GSTINs and
// address lines; GST registration types without a GSTIN or "Unknown"; dated details newer than the financial year;
// differing GSTINs; the company name in an All Masters file; renamed Tally groups.
// Every value used here is MADE UP (see fixtures/allMasters.js); only the structure copies a real export.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-realmasters-'));
const { buildApp } = await import('../src/index.js');
const { GSTIN_FORMAT } = await import('../src/tally.js');
const { contactInfo } = await import('../src/masters.js');
const { parseCsv, resolveAccountType } = await import('../src/zoho.js');
const { doc, utf16le, HIDDEN_RECORDS } = await import('../fixtures/allMasters.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const samples = path.resolve(here, '../../sample-data');
const seed = JSON.parse(fs.readFileSync(path.resolve(here, '../seed-users.json'), 'utf8'));

const app = buildApp();
let cookie = '';
const call = opts => app.inject({ ...opts, headers: { ...(opts.headers || {}), ...(cookie ? { cookie } : {}) } });
const get = async url => { const r = await call({ url }); assert.equal(r.statusCode, 200, `${url}: ${r.body}`); return r.json(); };
const putBody = (id, slot, body, name) => call({ method: 'PUT', url: `/api/migrations/${id}/uploads/${slot}`, headers: { 'content-type': 'application/octet-stream', 'x-filename': name }, payload: body });
const putFile = (id, slot, file) => putBody(id, slot, fs.readFileSync(file), path.basename(file));
const csvRows = async (id, key) => { const r = await call({ url: `/api/migrations/${id}/files/${key}/download?confirmed=1` }); assert.equal(r.statusCode, 200, r.body); return parseCsv(r.body).rows; };
const login = async () => {
  if (cookie) return;
  const u = seed.users.find(x => x.role === 'analyst');
  const lr = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: u.password } });
  cookie = String(lr.headers['set-cookie']).split(';')[0];
};
const newMigration = async () => { await login(); return (await call({ method: 'POST', url: '/api/migrations', payload: { company: 'Sample Masters Co', financialYear: '2024-25' } })).json().id; };
const otherDatasets = async id => {
  const others = { sales: '07_sales_vouchers.json', purchase: '08_purchase_vouchers.json', receipt: '09_receipt_vouchers.json', payment: '10_payment_vouchers.json', journal: '11_journal_vouchers.json', trial_balance: '13_trial_balance.json' };
  for (const [k, f] of Object.entries(others)) assert.equal((await putFile(id, k, path.join(samples, f))).statusCode, 200);
  await call({ method: 'PUT', url: `/api/migrations/${id}/waivers/stock_summary`, payload: { reason: 'Not needed for test' } });
};

test('contact details: hidden characters are removed only from identifiers and reported; GSTIN, registration and dates are checked', () => {
  const by = Object.fromEntries(HIDDEN_RECORDS.map(r => [r.metadata.name, r]));
  const oak = contactInfo(by['Oak Line Traders\r\n'], '20250331');
  assert.equal(oak.name, 'Oak Line Traders\r\n', 'the name is never changed');
  assert.equal(oak.mailingName, 'Oak Line Traders\r\n', 'the mailing name is never changed');
  assert.deepEqual([oak.gstin, oak.pan, oak.address], ['27OAKLN1234Q1Z3', 'OAKLN1234Q', ['7 Grove Road', 'Unit 3']]);
  assert.deepEqual([...oak.cleaned].sort(), ['GSTIN', 'PAN', 'address']);
  assert.ok(GSTIN_FORMAT.test(oak.gstin));
  const ash = contactInfo(by['Ash Distributors'], '20250331');
  assert.equal(ash.gstin, '32ASHDI2222B1Z2', 'the GSTIN of the registration entry used, not the differing party GSTIN');
  assert.deepEqual(ash.gstinConflict, { party: '32ASHDI1111A1Z1', registration: '32ASHDI2222B1Z2' });
  assert.deepEqual(ash.dated, [{ list: 'GST registration details', field: 'ledgstregdetails', newer: '20250901', earliestUsed: false }]);
  assert.equal(contactInfo(by['Ash Distributors'], '20170331').dated[0].earliestUsed, true, 'every entry after the year end: said so');
  assert.equal(contactInfo(by['Elm Corner Shop'], '20250331').registrationUnknown, true);
  const willow = contactInfo(by['Willow Mart '], '20250331');
  assert.deepEqual([willow.registrationType, willow.gstin], ['Regular', '']);

  // a renamed Tally group keeps its standard type and its "no inherit" rule through its reserved name
  const ctx = { groupParents: { 'Trade Receivables': 'Current Assets', 'Local Debtors': 'Trade Receivables', 'Govt Levies': 'Current Liabilities' },
    groupReserved: { 'Trade Receivables': 'Sundry Debtors', 'Govt Levies': 'Duties & Taxes', 'Current Assets': 'Current Assets' } };
  assert.deepEqual(resolveAccountType('Trade Receivables', ctx), { type: '', source: null, inheritedFrom: null });
  assert.deepEqual(resolveAccountType('Local Debtors', ctx), { type: '', source: null, inheritedFrom: null });
  assert.deepEqual(resolveAccountType('Govt Levies', ctx), { type: 'Other Current Liability', source: 'standard', inheritedFrom: null });
});

test('All Masters: hidden characters, likely duplicates, GST problems and newer dated details are flagged; the company name is checked', async () => {
  const id = await newMigration();
  const base = `/api/migrations/${id}`;
  const d = { static_variables: [{ name: 'svCurrentCompany', value: 'Other Sample Co' }], tallymessage: [...doc().tallymessage, ...JSON.parse(JSON.stringify(HIDDEN_RECORDS))] };
  let r = await putBody(id, 'all_masters', utf16le(d), 'Master.json');
  assert.equal(r.statusCode, 200, r.body);
  const companyLine = /^The file says company "Other Sample Co", but this migration is for "Sample Masters Co"/;
  assert.match(r.json().warnings[0], companyLine, 'the company is checked as for a file uploaded on its own');
  assert.equal(r.json().warnings.filter(w => companyLine.test(w)).length, 1, 'said once in the response');
  assert.ok(r.json().messages.some(m => companyLine.test(m)));
  const comp = await get(`${base}/completeness`);
  assert.ok(comp.slots.find(s => s.key === 'customers').upload.warnings.some(w => companyLine.test(w)), 'stored with the dataset');
  assert.ok(comp.allMasters.messages.some(m => companyLine.test(m)), 'stored with the All Masters file');

  await otherDatasets(id);
  r = await call({ method: 'POST', url: `${base}/process?wait=1` });
  assert.equal(r.statusCode, 200, r.body);
  let exc = (await get(`${base}/summary`)).exceptions;
  const proc = (slot, kind) => exc.filter(e => e.stage === 'process' && e.slot === slot && e.kind === kind).map(e => e.name);
  assert.deepEqual(proc('vendors', 'name_hidden_characters'), ['Oak Line Traders\r\n']);
  assert.match(exc.find(e => e.kind === 'name_hidden_characters').message, /contains a line break at its start or end/);
  assert.deepEqual(proc('customers', 'name_edge_spaces'), ['Willow Mart ']);
  assert.deepEqual(proc('vendors', 'possible_duplicate'), ['Oak Line Traders']);
  assert.match(exc.find(e => e.slot === 'vendors' && e.kind === 'possible_duplicate').message, /^Possible duplicate: "Oak Line Traders\r\n" [^]* and the same GSTIN\./);
  // (wizard-check batch) the message says what the files do by default: ONE party, with the way to keep both. It
  // never says "Both records are kept" any more, which the Vendors file did not do
  assert.match(exc.find(e => e.slot === 'vendors' && e.kind === 'possible_duplicate').message, /written as ONE party by default[^]*"keep both" in Mapping Studio/);
  assert.doesNotMatch(exc.find(e => e.slot === 'vendors' && e.kind === 'possible_duplicate').message, /Both records are kept\./);
  assert.deepEqual(proc('accounts', 'possible_duplicate'), ['Oak Line Traders'], 'also in the Chart of Accounts');

  r = await call({ method: 'POST', url: `${base}/generate` });
  assert.equal(r.statusCode, 200, r.body);
  exc = (await get(`${base}/summary`)).exceptions.filter(e => e.stage === 'generate');
  // v2 default 6 (changed on purpose): the two Oak vendors have the same name once the line break is ignored, and the
  // same GSTIN. With no decision they are ONE party: the one with the line break is not written, and that is flagged.
  assert.deepEqual(exc.filter(e => e.kind === 'contact_merged_by_default').map(e => e.name), ['Oak Line Traders\r\n']);
  assert.deepEqual(exc.filter(e => e.kind === 'display_name_collides_after_cleaning'), [], 'only one of the two is written');
  assert.deepEqual((await csvRows(id, 'vendors')).filter(x => /^Oak Line/.test(x['Display Name'])).map(x => x['Display Name']), ['Oak Line Traders']);
  // The accountant says they are two parties ("keep both"): both are written again, as in Tally, and the checks on the
  // vendor with the line break apply as before.
  const oakGroup = (await get(`${base}/names`)).duplicates.find(d => d.section === 'vendor' && d.members.some(m => m.ledger === 'Oak Line Traders\r\n'));
  assert.deepEqual([oakGroup.defaultDecision, oakGroup.defaultKept], ['merge', 'Oak Line Traders']);
  r = await call({ method: 'PUT', url: `${base}/duplicates`, payload: { key: oakGroup.key, decision: 'keep_both' } });
  assert.equal(r.statusCode, 200, r.body);
  r = await call({ method: 'POST', url: `${base}/generate` });
  assert.equal(r.statusCode, 200, r.body);
  exc = (await get(`${base}/summary`)).exceptions.filter(e => e.stage === 'generate');
  const gen = kind => exc.filter(e => e.kind === kind).map(e => e.name).sort();
  assert.deepEqual(gen('value_cleaned'), ['Oak Line Traders\r\n']);
  assert.deepEqual(gen('display_name_hidden_characters'), ['Oak Line Traders\r\n'], 'the Display Name itself is flagged');
  assert.match(exc.find(e => e.kind === 'display_name_hidden_characters').message, /written as Display Name \(and as Company Name\), contains a line break at its start or end/);
  assert.deepEqual(gen('mailing_name_hidden_characters'), [], 'not reported again as a separate mailing name');
  const clash = exc.filter(e => e.kind === 'display_name_collides_after_cleaning');
  assert.equal(clash.length, 1, 'the two vendors that are the same once the line break is removed');
  assert.equal(clash[0].slot, 'vendors');
  assert.match(clash[0].message, /^2 vendor Display Names differ only by /);
  assert.ok(clash[0].message.includes('"Oak Line Traders<CR><LF>"') && clash[0].message.includes('"Oak Line Traders"'), 'both names, the hidden characters made visible');
  assert.deepEqual(gen('gst_registered_without_gstin'), ['Willow Mart ']);
  assert.deepEqual(gen('contact_merged_by_default'), [], 'a decision of a person replaced the default');
  assert.deepEqual(gen('gst_registration_unknown'), ['Elm Corner Shop']);
  assert.deepEqual(gen('gstin_conflict'), ['Ash Distributors']);
  assert.deepEqual(gen('gstin_format'), ['Fir Wholesale']);
  assert.deepEqual(gen('dated_details_newer'), ['Ash Distributors', 'Maple Leaf Traders'], 'a newer entry after the year end is not used, and said so');
  // the Zoho files: identifiers without the line breaks; names exactly as in Tally (flagged above)
  const vend = await csvRows(id, 'vendors');
  const oak = vend.find(x => x['Display Name'] === 'Oak Line Traders\r\n');
  assert.deepEqual([oak['GST Identification Number (GSTIN)'], oak['PAN Number'], oak['Billing Address'], oak['Billing Street2']], ['27OAKLN1234Q1Z3', 'OAKLN1234Q', '7 Grove Road', 'Unit 3']);
  const cust = await csvRows(id, 'customers');
  for (const row of [...vend, ...cust]) {
    const g = row['GST Identification Number (GSTIN)'];
    if (g && g !== 'NOT-A-GSTIN') assert.ok(GSTIN_FORMAT.test(g), `GSTIN cell of ${JSON.stringify(row['Display Name'])}`);
    for (const col of ['GST Identification Number (GSTIN)', 'PAN Number', 'Billing Address', 'Billing Street2', 'Billing State', 'Billing Code']) assert.ok(!/[\r\n﻿]/.test(row[col]), col);
  }
  assert.equal(cust.find(x => x['Display Name'] === 'Ash Distributors')['GST Identification Number (GSTIN)'], '32ASHDI2222B1Z2');
});

test('a renamed Tally group (reserved name) keeps its account-type rules; the financial year is checked against the ledgers', async () => {
  const id = await newMigration();
  const base = `/api/migrations/${id}`;
  const g = (name, parent, reservedname = '') => ({ metadata: { type: 'Group', name, reservedname }, ...(parent ? { parent } : {}) });
  const l = (name, parent, extra = {}) => ({ metadata: { type: 'Ledger', name }, parent, startingfrom: '20200401', ...extra });
  const d = { tallymessage: [
    g('Current Assets', null, 'Current Assets'), g('Current Liabilities', null, 'Current Liabilities'),
    g('Trade Receivables', 'Current Assets', 'Sundry Debtors'), g('Local Debtors', 'Trade Receivables'),
    g('Trade Payables', 'Current Liabilities', 'Sundry Creditors'), g('Govt Levies', 'Current Liabilities', 'Duties & Taxes'),
    l('Teak Retail', 'Local Debtors'), l('Rosewood Supply', 'Trade Payables'), l('Output Levy', 'Govt Levies', { startingfrom: '20250401' }),
  ] };
  let r = await putBody(id, 'all_masters', utf16le(d), 'Master.json');
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(Object.fromEntries(r.json().datasets.map(x => [x.slot, x.mainRecords])), { customers: 1, vendors: 1, accounts: 3, taxes: 1 });
  assert.ok(r.json().warnings.some(w => /^Tax Configuration: 1 ledger\(s\) in this file start in Tally after the end of financial year 2024-25 \(the latest on 2025-04-01\)/.test(w)), r.json().warnings.join(' | '));
  await otherDatasets(id);
  r = await call({ method: 'POST', url: `${base}/process?wait=1` });
  assert.equal(r.statusCode, 200, r.body);
  const at = (await get(`${base}/account-types`)).groups;
  const grp = n => at.find(x => x.group === n);
  // a renamed Sundry Debtors (and its sub-group) is still recognised: its ledgers are customers, so no account type is asked for
  assert.deepEqual([grp('Local Debtors'), grp('Trade Receivables'), grp('Trade Payables')], [undefined, undefined, undefined],
    'customer and vendor groups need no account type: their ledgers are Zoho contacts');
  assert.deepEqual([grp('Govt Levies').zohoType, grp('Govt Levies').source, grp('Govt Levies').standard], ['Other Current Liability', 'standard', 'Other Current Liability']);
  r = await call({ method: 'POST', url: `${base}/generate` });
  assert.equal(r.statusCode, 200, r.body);
  const coa = Object.fromEntries((await csvRows(id, 'accounts')).map(x => [x['Account Name'], x['Account Type']]));
  assert.deepEqual(coa, { 'Output Levy': 'Other Current Liability' }, 'the customer and vendor under renamed groups are left out of the Chart of Accounts');
  const gen = (await get(`${base}/summary`)).exceptions.filter(e => e.stage === 'generate');
  assert.deepEqual(gen.filter(e => /no approved Zoho account type/.test(e.message)), []);
  assert.deepEqual(gen.filter(e => e.kind === 'tax_ledger_in_accounts').map(e => e.name), ['Output Levy'], 'a renamed Duties & Taxes is still recognised');
  assert.deepEqual([(await csvRows(id, 'customers')).map(x => x['Display Name']), (await csvRows(id, 'vendors')).map(x => x['Display Name'])], [['Teak Retail'], ['Rosewood Supply']]);
});
