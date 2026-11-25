import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wizardReady } from './wizardready.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-test-'));
const { buildApp } = await import('../src/index.js');
const { parseCsv } = await import('../src/zoho.js');
const samples = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../sample-data');
const app = buildApp();
const seed = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../seed-users.json'), 'utf8'));
let cookie = '';
const call = opts => app.inject({ ...opts, headers: { ...(opts.headers || {}), ...(cookie ? { cookie } : {}) } });
const login = async role => {
  const u = seed.users.find(x => x.role === role);
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: u.password } });
  assert.equal(r.statusCode, 200, `login as ${role}`);
  cookie = String(r.headers['set-cookie']).split(';')[0];
};

const FILES = {
  customers: '01_customers.json', vendors: '02_vendors.json', accounts: '03_chart_of_accounts.json', stock_items: '04_stock_items.json',
  units: '05_units.json', taxes: '06_tax_configuration.json', sales: '07_sales_vouchers.json', purchase: '08_purchase_vouchers.json',
  receipt: '09_receipt_vouchers.json', payment: '10_payment_vouchers.json', journal: '11_journal_vouchers.json', trial_balance: '13_trial_balance.json',
};
const put = (id, slot, file) => call({ method: 'PUT', url: `/api/migrations/${id}/uploads/${slot}`, headers: { 'content-type': 'application/octet-stream', 'x-filename': path.basename(file) }, payload: fs.readFileSync(file) });

test('full first-slice flow', async () => {
  // nothing works without signing in
  let r0 = await app.inject({ url: '/api/migrations' });
  assert.equal(r0.statusCode, 401);
  r0 = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: seed.users[0].email, password: 'wrong-password' } });
  assert.equal(r0.statusCode, 401);
  await login('analyst');

  let r = await call({ method: 'POST', url: '/api/migrations', payload: { company: '', financialYear: '2024-25' } });
  assert.equal(r.statusCode, 400);

  r = await call({ method: 'POST', url: '/api/migrations', payload: { company: 'Apex Engineering Technologies Pvt. Ltd.', financialYear: '2024-25', method: 'Full Migration' } });
  assert.equal(r.statusCode, 201);
  const id = r.json().id;

  // bad files are rejected with a clear reason
  r = await put(id, 'customers', path.join(samples, 'problem-files/broken_file.json'));
  assert.equal(r.statusCode, 422); assert.match(r.json().error, /not a valid JSON/);
  r = await put(id, 'customers', path.join(samples, '02_vendors.json'));
  assert.equal(r.statusCode, 200, 'vendor ledgers are still Ledger records'); // group is not enforced yet
  r = await put(id, 'customers', path.join(samples, '07_sales_vouchers.json'));
  assert.equal(r.statusCode, 422); assert.match(r.json().error, /Wrong file/);
  r = await put(id, 'sales', path.join(samples, 'problem-files/mixed_voucher_types.json'));
  assert.equal(r.statusCode, 422); assert.match(r.json().error, /only Sales/);

  // processing is blocked while datasets are missing
  r = await call({ method: 'POST', url: `/api/migrations/${id}/process` });
  assert.equal(r.statusCode, 409);

  for (const [slot, f] of Object.entries(FILES)) {
    r = await put(id, slot, path.join(samples, f));
    assert.equal(r.statusCode, 200, `${slot}: ${r.body}`);
  }
  // journal file has one voucher dated outside the year: warning, not rejection
  r = await put(id, 'journal', path.join(samples, 'problem-files/journal_unbalanced.json'));
  assert.equal(r.statusCode, 200);
  assert.ok(r.json().warnings.some(w => /outside financial year/.test(w)));

  // stock summary still unconfirmed -> blocked; required slot cannot be waived
  r = await call({ method: 'POST', url: `/api/migrations/${id}/process` });
  assert.equal(r.statusCode, 409);
  r = await call({ method: 'PUT', url: `/api/migrations/${id}/waivers/sales`, payload: { reason: 'x' } });
  assert.equal(r.statusCode, 400);
  r = await call({ method: 'PUT', url: `/api/migrations/${id}/waivers/stock_summary`, payload: { reason: 'Not needed for test' } });
  assert.equal(r.statusCode, 200);

  r = await call({ method: 'POST', url: `/api/migrations/${id}/process` });
  assert.equal(r.statusCode, 200, r.body);
  const summary = r.json().summary;
  for (const s of summary) assert.equal(s.inFile, s.stored, `control total ${s.slot}`);

  r = await call({ url: `/api/migrations/${id}/summary` });
  const exc = r.json().exceptions;
  assert.ok(exc.some(e => /differ by 1000\.00/.test(e.message)), 'unbalanced journal flagged');
  assert.equal(exc.filter(e => e.stage === 'crosscheck').length, 0, 'the sample set has no names missing from the masters');

  r = await call({ method: 'POST', url: `/api/migrations/${id}/generate` });
  assert.equal(r.statusCode, 200, r.body);
  const files = r.json().files;
  // v2, the zero-decision path (changed on purpose). No journal is routed yet, and before v2 that meant "no journal
  // file; they are reported instead" (invoices 4, bills 2). Now a journal with no decision is written by default: the
  // clear suggestions as suggested (one Invoice). The Bill suggestion is NOT taken by default (changed on purpose, v2
  // default 8): as a bill it would carry a line Zoho refuses ("Specify either a Tax or Tax Exemption or Reverse
  // Charge."), so it is written as a Manual Journal. The other two journals are left out, each with its reason:
  // one does not balance, and one is dated outside the financial year (M6: left out by default, counted and listed).
  // changed on purpose (held-vouchers batch): receipts from customers and payments to vendors are written as Manual
  // Journals now (file other_journals), not held for a Zoho sample
  assert.deepEqual(files.map(f => f.key).sort(), ['accounts', 'bills', 'customers', 'invoices', 'items', 'journals', 'opening_balances', 'other_journals', 'vendors']);
  assert.equal(files.find(f => f.key === 'customers').rows, 4);
  assert.equal(files.find(f => f.key === 'invoices').vouchers, 5);
  assert.equal(files.find(f => f.key === 'bills').vouchers, 2);
  assert.equal(files.find(f => f.key === 'journals').vouchers, 1);
  assert.deepEqual([r.json().vouchers.awaitingRouting, r.json().vouchers.leftOutOutsideYear], [0, 1], 'no voucher is left out for want of a decision');
  assert.ok(r.json().assumptions.some(a => a.kind === 'left_out_outside_year' && a.count === 1 && a.check));
  assert.ok(r.json().assumptions.some(a => a.kind === 'journal_default_suggestion' && a.count === 1), 'and every default is listed as an assumption');
  assert.ok(r.json().assumptions.some(a => a.kind === 'journal_default_manual' && a.count === 1));

  // item invoice (changed on purpose in B6: Zoho's invoice layout, no separate tax row): one row for the stock item line,
  // quantity and price apart; the IGST (3834 on 21300, 18%) goes on that line once Output IGST is mapped
  r = await call({ url: `/api/migrations/${id}/files/invoices/download?confirmed=1` });
  const inv = parseCsv(r.body).rows.filter(x => x['Invoice Number'] === 'SA/24-25/0004');
  assert.deepEqual(inv.map(x => [x['Item Name'], x.Quantity, x['Usage unit'], x['Item Price'], x.Account, x['Item Tax']]), [['Bearing 6204 ZZ', '100', 'nos', '213.00', 'Sales - Spares', 'IGST18']],
    'v2 default 13 (changed on purpose: the cell was empty): no Zoho tax is chosen for Output IGST, so the tax Zoho creates for that rate is written');

  // journal routing: suggestions, a manual choice, then accept the rest
  r = await call({ url: `/api/migrations/${id}/journals` });
  const journals = r.json();
  assert.equal(journals.length, 4);
  assert.deepEqual(journals.map(j => j.suggested), ['Invoice', 'Bill', 'Manual Journal', 'Manual Journal']);
  assert.ok(journals.every(j => j.decision === null));
  r = await call({ method: 'PUT', url: `/api/migrations/${id}/journals/${journals[0].id}`, payload: { decision: 'Credit Note' } });
  assert.equal(r.statusCode, 400);
  r = await call({ method: 'PUT', url: `/api/migrations/${id}/journals/${journals[0].id}`, payload: { decision: 'Manual Journal' } });
  assert.equal(r.statusCode, 200);
  r = await call({ method: 'POST', url: `/api/migrations/${id}/journals/accept-suggestions` });
  assert.equal(r.json().accepted, 3);

  r = await call({ method: 'POST', url: `/api/migrations/${id}/generate` });
  const files2 = r.json().files;
  assert.equal(files2.find(f => f.key === 'bills').vouchers, 3, 'freight journal routed to Bills');
  assert.equal(files2.find(f => f.key === 'invoices').vouchers, 4, 'user overrode the Invoice suggestion');
  // M6 (changed on purpose: this was 2): the journal dated outside the financial year is left out by default, like the unbalanced one
  assert.equal(files2.find(f => f.key === 'journals').vouchers, 1, 'the unbalanced journal and the one dated outside the financial year are left out');
  r = await call({ url: `/api/migrations/${id}/files/journals/download?confirmed=1` });
  // changed on purpose in B6: Zoho's journal layout; a customer line is on Accounts Receivable with the contact
  assert.match(r.body, /,Accounts Receivable,,Adani Solar Equipment Ltd\.,145000\.00,,published,,\r\n/);
  assert.match(r.body, /,Consultancy and Design Revenue,,,,145000\.00,published,,\r\n/);
  // import tracking: order and prerequisites are enforced
  r = await call({ url: `/api/migrations/${id}/imports` });
  let imports = r.json();
  // the Opening Balances file is a reference report: it is created, but it is not in the import order
  // changed on purpose (audit item 9): ONE import order, the Import Wizard's (zohorules.json): bills before invoices
  // changed on purpose (held-vouchers batch): the journals of receipts and payments are a file now, after the other journals
  assert.deepEqual(imports.map(i => i.key), ['accounts', 'customers', 'vendors', 'items', 'bills', 'invoices', 'journals', 'other_journals']);
  assert.equal(imports[0].ready, true);
  assert.equal(imports.find(i => i.key === 'invoices').ready, false);
  assert.equal(imports.find(i => i.key === 'journals').status, 'downloaded', 'download is recorded');
  assert.equal(imports.find(i => i.key === 'customers').status, 'generated', 'regenerating reset the earlier download');
  const setImport = (key, payload) => call({ method: 'PUT', url: `/api/migrations/${id}/imports/${key}`, payload });
  r = await setImport('invoices', { status: 'imported' });
  assert.equal(r.statusCode, 409); assert.match(r.json().error, /Chart of Accounts/);
  r = await setImport('accounts', { status: 'failed' });
  assert.equal(r.statusCode, 400, 'failed needs a note');
  // the Import Wizard's set-up and Migration Date come first (the older route follows the wizard's locks)
  for (const k of ['accounts', 'customers', 'items']) { await wizardReady(call, `/api/migrations/${id}`); assert.equal((await setImport(k, { status: 'imported' })).statusCode, 200); }
  await wizardReady(call, `/api/migrations/${id}`);
  r = await setImport('invoices', { status: 'partial', note: '2 rows rejected by Zoho' });
  assert.equal(r.statusCode, 200);
  imports = (await call({ url: `/api/migrations/${id}/imports` })).json();
  assert.equal(imports.find(i => i.key === 'bills').ready, false, 'vendors not imported yet');

  r = await call({ url: `/api/migrations/${id}/report` });
  const report = r.json();
  assert.equal(report.journals.total, 4); assert.equal(report.journals.decided, 4); assert.equal(report.journals.overridden, 1);
  assert.ok(report.audit.some(a => a.action === 'import_status' && /Invoices: partial/.test(a.detail)));
  r = await call({ url: `/api/migrations/${id}/records?slot=customers` });
  assert.equal(r.json().total, 4);

  r = await call({ url: `/api/migrations/${id}/summary` });
  assert.ok(r.json().exceptions.some(e => e.stage === 'generate' && /^Left out of the file: Debits and credits differ by 1000\.00/.test(e.message)));

  r = await call({ url: `/api/migrations/${id}/files/customers/download?confirmed=1` });
  assert.equal(r.statusCode, 200);
  const lines = r.body.trim().split('\r\n');
  assert.equal(lines.length, 5);
  assert.match(lines[1], /^Adani Solar Equipment Ltd\.,/);
  const adaniRow = parseCsv(r.body).rows[0];
  // Zoho codes: GST Treatment from "Regular" with a GSTIN, Place Of Contact from the state, Payment Terms from "30 Days"
  assert.deepEqual(['Opening Balance', 'GST Treatment', 'Place Of Contact', 'Currency Code', 'Payment Terms', 'Payment Terms Label', 'Billing Address', 'Billing Street2', 'Status'].map(h => adaniRow[h]),
    ['145000.00', 'business_gst', 'GJ', 'INR', '30', 'Net 30', 'Plot 12, Industrial Area', 'Gujarat', 'Active']);

  // account with an unmapped Tally group is flagged, not guessed
  r = await call({ url: `/api/migrations/${id}/summary` });
  assert.ok(r.json().exceptions.some(e => e.stage === 'generate' && /Branch \/ Divisions/.test(e.message)));

  // every generated row traces to a source record
  r = await call({ url: `/api/migrations/${id}/trace` });
  assert.ok(r.json().every(t => t.sourceId && t.rowKey));

  // ---- mapping decisions ----
  r = await call({ url: `/api/migrations/${id}/account-types` });
  // changed on purpose: a sub-group with no standard type of its own can now inherit one from its main group,
  // so "needs a decision" is read from needsDecision instead of (!standard && !decided)
  const undecided = r.json().groups.filter(g => g.needsDecision);
  assert.deepEqual(undecided.map(g => g.group), ['Branch / Divisions']);
  r = await call({ method: 'PUT', url: `/api/migrations/${id}/account-types`, payload: { group: 'Branch / Divisions', zohoType: 'Made Up Type' } });
  assert.equal(r.statusCode, 400);
  r = await call({ method: 'PUT', url: `/api/migrations/${id}/account-types`, payload: { group: 'Branch / Divisions', zohoType: 'Other Current Asset' } });
  assert.equal(r.statusCode, 200);
  r = await call({ url: `/api/migrations/${id}/tax-mappings` });
  assert.deepEqual(r.json().map(t => t.ledger), ['Output CGST', 'Output SGST', 'Output IGST']);
  // changed on purpose in B6: CGST and SGST go on one Zoho line as one tax group, so both are mapped to the group
  for (const [ledger, zohoTax] of [['Output CGST', 'GST18'], ['Output SGST', 'GST18']]) {
    assert.equal((await call({ method: 'PUT', url: `/api/migrations/${id}/tax-mappings`, payload: { ledger, zohoTax } })).statusCode, 200);
  }
  r = await call({ method: 'POST', url: `/api/migrations/${id}/generate` });
  assert.equal(r.statusCode, 200, r.body);
  const exc2 = (await call({ url: `/api/migrations/${id}/summary` })).json().exceptions.filter(e => e.stage === "generate");
  assert.ok(!exc2.some(e => /Branch \/ Divisions/.test(e.message)), 'account type decision removed the flag');
  // v2 default 13 (changed on purpose: "Output IGST is not mapped" was flagged here and the tax left off the invoice).
  // No Zoho tax is chosen for Output IGST and no Zoho tax list is saved, so Zoho's own tax of that rate (IGST18) is
  // written, and that is flagged as an assumption on the invoice.
  assert.ok(!exc2.some(e => /"Output IGST" is not mapped/.test(e.message)));
  assert.ok(exc2.some(e => e.kind === 'tax_name_default' && /"Output IGST".*Zoho's own tax "IGST18" is written/.test(e.message)), 'the default tax name is flagged');
  assert.ok(!exc2.some(e => /"Output CGST" is not mapped/.test(e.message)));
  assert.ok(exc2.some(e => /Opening balances do not balance/.test(e.message)), 'incomplete trial balance is flagged');
  r = await call({ url: `/api/migrations/${id}/files/invoices/download?confirmed=1` });
  assert.match(r.body, /,false,GST18,Tax Group,18,/, 'the GST group, its type and rate are on the line');
  r = await call({ url: `/api/migrations/${id}/files/accounts/download?confirmed=1` });
  assert.equal(parseCsv(r.body).rows.find(x => x['Account Name'] === 'Factory Imprest')['Account Type'], 'Other Current Asset');
  // the reference report can still be downloaded (it is not imported)
  r = await call({ url: `/api/migrations/${id}/files/opening_balances/download?confirmed=1` });
  assert.match(r.body, /Adani Solar Equipment Ltd\.,145000\.00,\r\n/);
  assert.match(r.body, /Bharat Steel Traders,,118000\.00\r\n/);

  // ---- rejections, corrections and the retry file ----
  const upload = (url, text) => call({ method: 'PUT', url, headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from(text) });
  r = await upload(`/api/migrations/${id}/rejections/customers`, 'Display Name,Company Name\r\nKaveri Components,x\r\n');
  assert.equal(r.statusCode, 422); assert.match(r.json().error, /No error column/);
  r = await upload(`/api/migrations/${id}/rejections/customers`,
    'Display Name,Error Message\r\nKaveri Components,Billing State is mandatory\r\nSomeone Unknown Ltd,Duplicate record\r\n');
  assert.deepEqual(r.json(), { rejected: 2, linked: 1, unlinked: 1 });
  let rej = (await call({ url: `/api/migrations/${id}/rejections` })).json();
  const kaveri = rej.find(x => x.ident === 'Kaveri Components');
  assert.equal(kaveri.category, 'Missing mandatory field');
  assert.equal(kaveri.sourceId, 'a1b2c3d4-0000-4000-8000-c00000002', 'linked back to the Tally record');
  assert.equal(rej.find(x => x.ident === 'Someone Unknown Ltd').status, 'unlinked');
  const correct = payload => call({ method: 'POST', url: `/api/migrations/${id}/rejections/${kaveri.id}/corrections`, payload });
  const rowNo = kaveri.rows[0].rowNo;
  r = await correct({ rowNo, column: 'Billing State', newValue: 'KA' });
  assert.equal(r.statusCode, 400, 'reason is required');
  r = await correct({ rowNo, column: 'Opening Balance', newValue: '0.00', reason: 'test' });
  assert.equal(r.statusCode, 409, 'accounting value needs explicit confirmation');
  r = await correct({ rowNo, column: 'Billing State', newValue: 'KA', reason: 'Zoho needs the state code' });
  assert.equal(r.statusCode, 200);
  r = await call({ method: 'POST', url: `/api/migrations/${id}/rejections/customers/retry` });
  assert.deepEqual([r.json().records, r.json().rows, r.json().corrections], [1, 1, 1]);
  r = await call({ url: `/api/migrations/${id}/rejections/customers/retry/download` });
  const retry = r.body.trim().split('\r\n');
  assert.equal(retry.length, 2, 'only the rejected record is in the retry file');
  const kaveriRetry = parseCsv(r.body).rows[0];
  assert.deepEqual(['Display Name', 'Billing State', 'Opening Balance', 'GST Treatment', 'Place Of Contact'].map(h => kaveriRetry[h]), ['Kaveri Components', 'KA', '38900.00', 'business_gst', 'KA']);
  // multi-line document: one rejection covers all its rows
  r = await upload(`/api/migrations/${id}/rejections/invoices`, 'Invoice Number,Reason\r\nSA/24-25/0003,Customer not found\r\n');
  assert.equal(r.json().linked, 1);
  rej = (await call({ url: `/api/migrations/${id}/rejections` })).json();
  const inv3 = rej.find(x => x.key === 'invoices');
  assert.equal(inv3.rows.length, 1); assert.equal(inv3.category, 'Missing customer, vendor, account or item'); // B6: one row per line, no tax rows

  // ---- verification against a Zoho report ----
  r = await upload(`/api/migrations/${id}/verification/customers`, 'Name,Contact ID\r\nx,1\r\n');
  assert.equal(r.statusCode, 422);
  r = await upload(`/api/migrations/${id}/verification/customers`,
    'Display Name,Contact ID\r\nAdani Solar Equipment Ltd.,9001\r\nzenith agro exports llp,9003\r\nBlueOcean Logistics India,9004\r\nOld Zoho Customer,8000\r\n');
  // changed on purpose: the response now also carries the amount comparison, so the counts are checked field by field
  const v1 = r.json();
  assert.deepEqual([v1.expected, v1.matched, v1.missing, v1.extra, v1.hasZohoIds], [4, 3, 1, 1, true]);
  assert.equal(v1.amountColumn, null, 'this report has no amount column');
  assert.equal(v1.amountsCompared, 0);
  assert.match(v1.note, /Amounts were not compared/);
  const ver = (await call({ url: `/api/migrations/${id}/verification` })).json().find(v => v.key === 'customers');
  assert.deepEqual([ver.matched, ver.missing, ver.extra], [3, 1, 1]);
  r = await call({ url: `/api/migrations/${id}/crosswalk?q=adani` });
  const adani = r.json().rows.find(x => x.module === 'Customers');
  assert.deepEqual([adani.sourceId, adani.zohoId, adani.status], ['a1b2c3d4-0000-4000-8000-c00000001', '9001', 'Verified in Zoho']);
  r = await call({ url: `/api/migrations/${id}/crosswalk?q=kaveri` });
  assert.equal(r.json().rows.find(x => x.module === 'Customers').status, 'Not found in Zoho');

  // ---- roles ----
  r = await call({ url: '/api/users' });
  assert.equal(r.statusCode, 403, 'analyst cannot manage users');
  r = await call({ url: `/api/migrations/${id}/report` });
  assert.ok(r.json().audit.every(a => a.actor === 'analyst@demo.test'), 'actions are recorded under the signed-in user');
  await login('viewer');
  r = await call({ url: `/api/migrations/${id}` });
  assert.equal(r.statusCode, 200, 'viewer can read their own company');
  r = await call({ method: 'POST', url: `/api/migrations/${id}/generate` });
  assert.equal(r.statusCode, 403, 'viewer cannot change anything');
  await login('admin');
  r = await call({ method: 'POST', url: '/api/users', payload: { name: 'New Person', email: 'new@demo.test', password: 'short', role: 'analyst' } });
  assert.equal(r.statusCode, 400);
  r = await call({ method: 'POST', url: '/api/users', payload: { name: 'Boss', email: 'boss@demo.test', password: 'long-enough-pass', role: 'super_admin' } });
  assert.equal(r.statusCode, 403, 'admin cannot create a super admin');
  r = await call({ method: 'POST', url: '/api/users', payload: { name: 'New Person', email: 'new@demo.test', password: 'long-enough-pass', role: 'analyst' } });
  assert.equal(r.statusCode, 201);
  const users = (await call({ url: '/api/users' })).json();
  assert.ok(users.every(u => !('password' in u)));
  r = await call({ method: 'PUT', url: `/api/users/${users.find(u => u.email === 'new@demo.test').id}`, payload: { active: false } });
  assert.equal(r.statusCode, 200);
  r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'new@demo.test', password: 'long-enough-pass' } });
  assert.equal(r.statusCode, 401, 'disabled user cannot sign in');
});

// Sub-group account types, cross-checks, expected counts, unit mapping, fields not read, amount comparison.
test('masters cross-checks, counts, units, sub-groups and amounts', async () => {
  await login('analyst');
  const get = async url => (await call({ url })).json();
  const send = (method, url, payload) => call({ method, url, payload });
  const putBuf = (id, slot, obj) => call({ method: 'PUT', url: `/api/migrations/${id}/uploads/${slot}`, headers: { 'content-type': 'application/octet-stream', 'x-filename': 'test.json' }, payload: Buffer.from(JSON.stringify(obj)) });
  const upload = (url, text) => call({ method: 'PUT', url, headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from(text) });

  let r = await send('POST', '/api/migrations', { company: 'Apex Engineering Technologies Pvt. Ltd.', financialYear: '2024-25' });
  assert.equal(r.statusCode, 201);
  const id = r.json().id;
  const base = `/api/migrations/${id}`;
  // no GSTIN here, so the HSN/SAC field is taken as off unless answered: this flow is about the field being on
  assert.equal((await send('PUT', `${base}/voucher-settings`, { hsnEnabled: 'on' })).statusCode, 200);

  // ---- F1: Group records are accepted only in the Chart of Accounts slot ----
  r = await put(id, 'customers', path.join(samples, '03_chart_of_accounts.json'));
  assert.equal(r.statusCode, 422, 'other slots stay strict'); assert.match(r.json().error, /mixes record types/);
  r = await putBuf(id, 'accounts', { tallymessage: [{ metadata: { type: 'Group', name: 'Only Groups' }, name: 'Only Groups', parent: 'Direct Expenses' }] });
  assert.equal(r.statusCode, 422, 'a file with groups and no ledgers is the wrong file'); assert.match(r.json().error, /Wrong file/);

  const uploads = { ...FILES, sales: 'problem-files/sales_unknown_names.json', purchase: 'problem-files/purchase_party_not_vendor.json', receipt: 'problem-files/receipt_unknown_ledger.json', stock_items: 'problem-files/stock_items_unknown_unit.json', trial_balance: 'problem-files/trial_balance_unknown_ledger.json' };
  const results = {};
  for (const [slot, f] of Object.entries(uploads)) {
    r = await put(id, slot, path.join(samples, f));
    assert.equal(r.statusCode, 200, `${slot}: ${r.body}`);
    results[slot] = r.json();
  }
  assert.deepEqual(results.accounts.recordTypes, { Group: 4, Ledger: 17 });
  assert.equal(results.accounts.records, 21);
  assert.equal(results.accounts.actualCount, 17, 'groups are not counted as ledgers');

  // ---- F5: fields the platform does not read ----
  // gstregistrationtype is read since the real TallyPrime structure is supported (written as GST Treatment)
  // the credit period is read too (Payment Terms)
  assert.equal(results.customers.fieldsNotRead.count, 0);
  assert.deepEqual(results.customers.fieldsNotRead.fields, []);
  assert.ok(!results.customers.fieldsNotRead.fields.some(f => f.name === 'pricelevel'), 'Tally "not applicable" values are ignored');
  assert.deepEqual(results.sales.fieldsNotRead.fields, [{ name: 'ledgerentries.isdeemedpositive', records: 4 }, { name: 'allinventoryentries.amount', records: 1 }], 'nested voucher line fields count; false values do not');
  // changed on purpose: a field that is only shown in the Data Explorer (issimpleunit) is no longer counted as read
  assert.deepEqual(results.units.fieldsNotRead.fields, [{ name: 'issimpleunit', records: 3 }]);
  assert.match(results.units.fieldsNotRead.note, /No Zoho file is created from this dataset/);
  // what is read depends on the dataset (changed on purpose in B6-B7: a tax ledger's type and duty head are read now, to put the tax on lines and find TDS)
  assert.deepEqual(results.taxes.fieldsNotRead.fields.map(f => f.name), []);
  assert.equal(results.customers.fieldsNotRead.note, undefined);
  r = await putBuf(id, 'units', { tallymessage: Array.from({ length: 3 }, (_, i) => ({ metadata: { type: 'Unit', name: `u${i}` }, name: `u${i}`, ...Object.fromEntries(Array.from({ length: 60 }, (_, k) => [`extra${k}`, 'x'])) })) });
  assert.equal(r.statusCode, 200, 'unread fields never reject a file');
  assert.deepEqual([r.json().fieldsNotRead.count, r.json().fieldsNotRead.fields.length, r.json().fieldsNotRead.truncated], [60, 50, true], 'the list is capped, the count is not');
  await put(id, 'units', path.join(samples, FILES.units));
  await send('PUT', `${base}/waivers/stock_summary`, { reason: 'Not needed for test' });
  let comp = await get(`${base}/completeness`);
  assert.equal(comp.slots.find(s => s.key === 'customers').upload.fieldsNotRead.count, 0); // gstregistrationtype and the credit period are read now
  assert.equal(comp.ready, true);

  // ---- F3: expected record counts ----
  const setCount = (slot, expected) => send('PUT', `${base}/expected-counts/${slot}`, { expected });
  assert.equal((await setCount('customers', -1)).statusCode, 400);
  assert.equal((await setCount('customers', 'many')).statusCode, 400);
  assert.equal((await setCount('nonsense', 3)).statusCode, 404);
  r = await setCount('customers', 5);
  assert.deepEqual(r.json(), { slot: 'customers', expectedCount: 5, actualCount: 4, countMatches: false });
  r = await setCount('accounts', 17);
  assert.equal(r.json().countMatches, true, 'ledgers are counted, groups are not');
  comp = await get(`${base}/completeness`);
  const cust = comp.slots.find(s => s.key === 'customers');
  assert.deepEqual([cust.expectedCount, cust.actualCount, cust.countMatches], [5, 4, false]);
  assert.equal(comp.slots.find(s => s.key === 'vendors').countMatches, null, 'no number entered');
  assert.equal(comp.ready, false);
  assert.deepEqual(comp.countMismatches.map(m => [m.slot, m.expected, m.actual]), [['customers', 5, 4]]);
  r = await send('POST', `${base}/process`);
  assert.equal(r.statusCode, 409, 'a count mismatch blocks processing');
  assert.match(r.json().error, /Customer Master: Tally shows 5 ledgers, but the uploaded file has 4 ledgers/);
  assert.equal(r.json().countMismatches.length, 1);
  r = await setCount('customers', 4);
  assert.equal(r.json().countMatches, true);
  r = await setCount('vendors', 9);
  r = await setCount('vendors', null);
  assert.deepEqual(r.json(), { slot: 'vendors', expectedCount: null, actualCount: 3, countMatches: null }, 'clearing removes the block');

  r = await send('POST', `${base}/process`);
  assert.equal(r.statusCode, 200, r.body);
  // changed on purpose: the purchase and receipt problem files add 4 items to the 7 raised before
  assert.equal(r.json().crossChecks, 11);

  // ---- F2: cross-checks between vouchers and masters ----
  let checks = (await get(`${base}/summary`)).exceptions.filter(e => e.stage === 'crosscheck');
  const one = (kind, name) => { const hit = checks.filter(e => e.kind === kind && e.name === name); assert.equal(hit.length, 1, `exactly one ${kind} item for ${name}`); return hit[0]; };
  assert.equal(checks.length, 11);
  const exportLedger = one('ledger_missing', 'Sales - Export');
  assert.equal(exportLedger.uses, 2, 'one item for the name, not one per voucher');
  assert.match(exportLedger.message, /used on 2 vouchers \(the first is Sales SA\/24-25\/0001\) but it is not in the Customer, Vendor, Chart of Accounts or Tax files/);
  assert.match(one('ledger_missing', 'sales - spares').message, /have "Sales - Spares", which differs only by capital letters or spaces/);
  assert.doesNotMatch(exportLedger.message, /capital letters/);
  one('ledger_missing', 'Walk-in Customer');
  assert.match(one('party_missing', 'Walk-in Customer').message, /party on 1 sales voucher .* not in the Customer file/);
  assert.match(one('item_missing', 'Unknown Widget').message, /not in the Stock Items file/);
  assert.match(one('unit_missing', 'box').message, /used by 1 stock item \(the first is Packing Carton\) but it is not in the Units file/);
  assert.match(one('trial_balance_ledger_missing', 'Suspense Account').message, /in the Trial Balance/);
  // purchase, receipt (and so payment and journal) vouchers are checked too, not only sales
  const purchaseParty = one('party_missing', 'Kaveri Components');
  assert.equal(purchaseParty.slot, 'purchase');
  assert.match(purchaseParty.message, /party on 1 purchase voucher \(the first is Purchase PU\/24-25\/0003\) but it is not in the Vendor file\. It is in the Customer file instead/);
  const cashParty = one('party_missing', 'Cash');
  assert.match(cashParty.message, /looks like a cash or bank purchase\. Zoho Books needs a vendor on every bill\. An accountant must decide/);
  assert.doesNotMatch(cashParty.message, /add it to the Vendor file/, 'a cash ledger must not be added to the Vendor file');
  const receiptLedger = one('ledger_missing', 'Petty Cash Counter');
  assert.deepEqual([receiptLedger.slot, receiptLedger.uses], ['receipt', 1]);
  const blank = one('ledger_blank', '(no ledger name)');
  assert.deepEqual([blank.slot, blank.uses], ['receipt', 1]);
  assert.match(blank.message, /1 voucher \(the first is Receipt RE\/24-25\/0003\) has a line with no ledger name/);

  // ---- F3: a count entered after processing cannot be bypassed: files are not created while it disagrees ----
  await setCount('vendors', 9);
  r = await send('POST', `${base}/generate`);
  assert.equal(r.statusCode, 409, 'generate is refused while a count does not match');
  assert.match(r.json().error, /Files cannot be created .* Vendor Master: Tally shows 9 ledgers, but the uploaded file has 3 ledgers/);
  await setCount('vendors', null);
  // over-long numbers are refused instead of being stored inexactly
  assert.equal((await setCount('vendors', '99999999999999999999999')).statusCode, 400);
  assert.equal((await setCount('vendors', 12345678901234567890)).statusCode, 400);
  assert.equal((await get(`${base}/completeness`)).slots.find(s => s.key === 'vendors').expectedCount, null);
  assert.equal((await get(`${base}/records?slot=accounts&type=Group`)).total, 4);
  assert.equal((await get(`${base}/records?slot=accounts&type=Ledger`)).total, 17);

  // ---- F1: a sub-group inherits its type from its main group ----
  const groupsNow = async () => Object.fromEntries((await get(`${base}/account-types`)).groups.map(g => [g.group, g]));
  let g = await groupsNow();
  assert.deepEqual([g['Factory Expenses'].source, g['Factory Expenses'].inheritedFrom, g['Factory Expenses'].zohoType, g['Factory Expenses'].needsDecision], ['inherited', 'Direct Expenses', 'Cost Of Goods Sold', false]);
  assert.deepEqual([g['Travel Expenses'].source, g['Travel Expenses'].inheritedFrom, g['Travel Expenses'].zohoType, g['Travel Expenses'].parent], ['inherited', 'Indirect Expenses', 'Expense', 'Admin Expenses'], 'two levels up');
  assert.deepEqual([g['Indirect Expenses'].source, g['Indirect Expenses'].inheritedFrom], ['standard', null]);
  assert.deepEqual([g['Branch / Divisions'].source, g['Branch / Divisions'].zohoType, g['Branch / Divisions'].needsDecision], [null, null, true]);
  assert.deepEqual(Object.values(g).filter(x => x.needsDecision).map(x => x.group), ['Branch / Divisions']);
  // a decision on a parent applies to children without their own decision
  assert.equal((await send('PUT', `${base}/account-types`, { group: 'Admin Expenses', zohoType: 'Other Expense' })).statusCode, 200);
  g = await groupsNow();
  assert.deepEqual([g['Admin Expenses'].source, g['Admin Expenses'].zohoType], ['decided', 'Other Expense']);
  assert.deepEqual([g['Travel Expenses'].source, g['Travel Expenses'].inheritedFrom, g['Travel Expenses'].zohoType], ['inherited', 'Admin Expenses', 'Other Expense']);
  // a decision on the sub-group overrides inheritance for that sub-group only
  await send('PUT', `${base}/account-types`, { group: 'Travel Expenses', zohoType: 'Expense' });
  g = await groupsNow();
  assert.deepEqual([g['Travel Expenses'].source, g['Travel Expenses'].inheritedFrom, g['Travel Expenses'].zohoType], ['decided', null, 'Expense']);
  assert.equal(g['Admin Expenses'].zohoType, 'Other Expense');

  // ---- F4: unit mapping ----
  let um = await get(`${base}/unit-mappings`);
  assert.equal(um.unitsFileUploaded, true);
  assert.deepEqual(um.units.find(u => u.tallyUnit === 'nos'), { tallyUnit: 'nos', fullName: 'Numbers', items: 2, zohoUnit: null, missingFromUnitsFile: false });
  assert.deepEqual(um.units.find(u => u.tallyUnit === 'box'), { tallyUnit: 'box', fullName: null, items: 1, zohoUnit: null, missingFromUnitsFile: true });
  assert.equal((await send('PUT', `${base}/unit-mappings`, { tallyUnit: 'litre', zohoUnit: 'ltr' })).statusCode, 404);
  assert.equal((await send('PUT', `${base}/unit-mappings`, { tallyUnit: 'nos', zohoUnit: 'x'.repeat(101) })).statusCode, 400, 'an over-long Zoho unit is refused');
  assert.equal((await send('PUT', `${base}/unit-mappings`, { tallyUnit: 'nos', zohoUnit: 'pieces' })).statusCode, 200);
  assert.equal((await send('PUT', `${base}/unit-mappings`, { tallyUnit: 'nos', zohoUnit: 'pcs' })).statusCode, 200);
  assert.equal((await get(`${base}/unit-mappings`)).units.find(u => u.tallyUnit === 'nos').zohoUnit, 'pcs');
  // the audit entries say what was replaced
  let trail = (await get(`${base}/audit`)).map(a => `${a.action} | ${a.detail}`);
  assert.ok(trail.includes('unit_mapped | Tally unit "nos" -> Zoho unit "pieces" (was written as in Tally)'));
  assert.ok(trail.includes('unit_mapped | Tally unit "nos" -> Zoho unit "pcs" (was "pieces")'));
  assert.ok(trail.includes('account_type_decided | Tally group "Admin Expenses" -> Other Expense (was inherited from "Indirect Expenses": Expense)'));
  assert.ok(trail.includes('account_type_decided | Tally group "Travel Expenses" -> Expense (was inherited from "Admin Expenses": Other Expense)'));

  // B6 (added on purpose): the GST now sits on the invoice lines, so the taxes are mapped for the invoice totals to tie to Tally
  for (const [ledger, zohoTax] of [['Output CGST', 'GST18'], ['Output SGST', 'GST18'], ['Output IGST', 'IGST18']]) assert.equal((await send('PUT', `${base}/tax-mappings`, { ledger, zohoTax })).statusCode, 200);
  r = await send('POST', `${base}/generate`);
  assert.equal(r.statusCode, 200, r.body);
  let csv = (await call({ url: `${base}/files/items/download?confirmed=1` })).body;
  const itemRows = Object.fromEntries(parseCsv(csv).rows.map(x => [x['Item Name'], x]));
  assert.deepEqual([itemRows['Bearing 6204 ZZ']['Usage unit'], itemRows['Bearing 6204 ZZ']['HSN/SAC']], ['pcs', '84821011'], 'the mapped unit reaches the Items file');
  assert.equal(itemRows['MS Plate 10mm']['Usage unit'], 'kgs', 'an unmapped unit is written as in Tally');
  assert.equal((await get(`${base}/records?slot=stock_items`)).records.find(x => x.name === 'Bearing 6204 ZZ').data.baseunits, 'nos', 'the source record is untouched');
  csv = (await call({ url: `${base}/files/accounts/download?confirmed=1` })).body;
  const typeOf = Object.fromEntries(parseCsv(csv).rows.map(x => [x['Account Name'], x['Account Type']]));
  assert.deepEqual(['Power and Fuel', 'Office Stationery', 'Staff Travel'].map(n => typeOf[n]), ['Cost Of Goods Sold', 'Other Expense', 'Expense']);
  assert.equal(typeOf['Factory Imprest'], '', 'no type is guessed for a group with no answer');
  assert.doesNotMatch(csv, /^(Factory|Admin|Travel|Indirect) Expenses,/m, 'groups are never written to the output');
  assert.equal(csv.trim().split('\r\n').length, 18);
  let gen = (await get(`${base}/summary`)).exceptions.filter(e => e.stage === 'generate');
  assert.ok(gen.some(e => /Branch \/ Divisions/.test(e.message)));
  assert.ok(!gen.some(e => /Factory Expenses|Travel Expenses|Admin Expenses/.test(e.message)), 'inherited types are not flagged');
  assert.equal((await get(`${base}/summary`)).exceptions.filter(e => e.stage === 'crosscheck').length, 11, 'generating keeps the cross-check items');
  // clearing a unit mapping and a decision
  await send('PUT', `${base}/unit-mappings`, { tallyUnit: 'nos', zohoUnit: '' });
  await send('PUT', `${base}/account-types`, { group: 'Travel Expenses', zohoType: null });
  assert.deepEqual([(await groupsNow())['Travel Expenses'].source, (await get(`${base}/unit-mappings`)).units.find(u => u.tallyUnit === 'nos').zohoUnit], ['inherited', null]);

  // ---- F6: amount comparison in Reconciliation ----
  // customers: two headings look like amounts; the exact "Opening Balance" is preferred
  r = await upload(`${base}/verification/customers`, [
    'Display Name,Contact ID,Outstanding Amount,Opening Balance',
    'Adani Solar Equipment Ltd.,9001,1.00,"₹1,45,000.00"',
    'Kaveri Components,9002,1.00,"(38,900.00)"',
    'Zenith Agro Exports LLP,9003,1.00,',
    'BlueOcean Logistics India,9004,1.00,21300',
    'Old Zoho Customer,8000,1.00,5.00', ''].join('\r\n'));
  assert.equal(r.statusCode, 200, r.body);
  let v = r.json();
  assert.deepEqual([v.expected, v.matched, v.missing, v.extra], [4, 4, 0, 1]);
  assert.deepEqual([v.amountColumn, v.amountsCompared, v.amountsDiffering, v.amountsNotAvailable], ['Opening Balance', 3, 1, 1]);
  assert.deepEqual([v.totalExpected, v.totalExpectedCompared, v.totalInZoho], ['205200.00', '205200.00', '127400.00']);
  assert.match(v.note, /assumed report format/);
  let ver = Object.fromEntries((await get(`${base}/verification`)).map(x => [x.key, x]));
  assert.deepEqual([ver.customers.amountColumn, ver.customers.matched, ver.customers.missing, ver.customers.extra, ver.customers.amountsCompared, ver.customers.amountsDiffering], ['Opening Balance', 4, 0, 1, 3, 1]);
  assert.deepEqual([ver.customers.totalExpected, ver.customers.totalInZoho], ['205200.00', '127400.00']);
  const kav = ver.customers.problems.find(p => p.ident === 'Kaveri Components');
  assert.deepEqual([kav.status, kav.expectedAmount, kav.zohoAmount, kav.amountStatus], ['matched', '38900.00', '-38900.00', 'differs']);
  let cw = (await get(`${base}/crosswalk?q=kaveri`)).rows.find(x => x.module === 'Customers');
  assert.deepEqual([cw.status, cw.expectedAmount, cw.zohoAmount], ['Amount differs in Zoho', '38900.00', '-38900.00']);
  assert.equal((await get(`${base}/crosswalk?q=adani`)).rows.find(x => x.module === 'Customers').status, 'Verified in Zoho');
  assert.equal((await get(`${base}/crosswalk?q=zenith`)).rows.find(x => x.module === 'Customers').status, 'Verified in Zoho', 'a blank Zoho amount is not a difference');

  // invoices: sum of Item Total per invoice; thousands separator, trailing minus, currency text
  r = await upload(`${base}/verification/invoices`, 'Invoice Number,Invoice ID,Total\r\nSA/24-25/0001,1,"11,800.00"\r\nSA/24-25/0002,2,23600.00-\r\nSA/24-25/0003,3,Rs. 5900\r\n');
  v = r.json();
  // v2 default 8 (changed on purpose: 4 invoices expected, 1 missing, total 42480.00): the sale entered as a journal has no
  // routing decision in this test and is written as an Invoice by default (its clear suggestion), so there is one more invoice
  assert.deepEqual([v.expected, v.matched, v.missing, v.amountColumn, v.amountsCompared, v.amountsDiffering], [5, 3, 2, 'Total', 3, 1]);
  assert.deepEqual([v.totalExpected, v.totalInZoho], ['187480.00', '-5900.00']);
  cw = (await get(`${base}/crosswalk?q=SA/24-25/0002`)).rows.find(x => x.module === 'Invoices');
  assert.deepEqual([cw.status, cw.expectedAmount, cw.zohoAmount], ['Amount differs in Zoho', '23600.00', '-23600.00']);

  // a report with no amount column: matched by identifier only, and it says so
  r = await upload(`${base}/verification/vendors`, 'Display Name,Contact ID\r\nShree Logistics,1\r\nBharat Steel Traders,2\r\n');
  v = r.json();
  assert.deepEqual([v.matched, v.missing, v.amountColumn, v.amountsCompared, v.totalInZoho], [2, 1, null, 0, null]);
  assert.match(v.note, /Amounts were not compared/);
  assert.equal((await get(`${base}/crosswalk?q=Shree`)).rows.find(x => x.module === 'Vendors').status, 'Verified in Zoho');
  // Chart of Accounts has no amount, even if the report has a balance column
  r = await upload(`${base}/verification/accounts`, 'Account Name,Balance\r\nCash,100.00\r\n');
  assert.deepEqual([r.json().amountColumn, r.json().amountsCompared], [null, 0]);
  assert.match(r.json().note, /no amount to compare/);
  // opening balances: Debit minus Credit, signed
  r = await upload(`${base}/verification/opening_balances`, 'Account,Debit,Credit\r\nAdani Solar Equipment Ltd.,145000.00,\r\nBharat Steel Traders,,"1,18,000.00"\r\nZenith Agro Exports LLP,,\r\nSuspense Account,400.00,\r\n');
  v = r.json();
  assert.deepEqual([v.amountColumn, v.matched, v.amountsCompared, v.amountsDiffering, v.amountsNotAvailable], ['Debit minus Credit', 4, 3, 1, 1]);
  ver = Object.fromEntries((await get(`${base}/verification`)).map(x => [x.key, x]));
  const bharat = (await get(`${base}/crosswalk?q=Bharat Steel`)).rows.find(x => x.module === 'Opening Balances');
  assert.deepEqual([bharat.expectedAmount, bharat.zohoAmount, bharat.status], ['-118000.00', '-118000.00', 'Verified in Zoho']);
  assert.deepEqual(ver.opening_balances.problems.filter(p => p.amountStatus === 'differs').map(p => [p.ident, p.expectedAmount, p.zohoAmount]), [['Suspense Account', '500.00', '400.00']]);

  // ---- report: counts and reconciliation totals ----
  const report = await get(`${base}/report`);
  const ds = Object.fromEntries(report.datasets.map(d => [d.key, d]));
  assert.deepEqual([ds.customers.expectedCount, ds.customers.actualCount, ds.customers.countMatches], [4, 4, true]);
  assert.deepEqual([ds.vendors.expectedCount, ds.vendors.actualCount, ds.vendors.countMatches], [null, 3, null]);
  const rc = Object.fromEntries(report.reconciliation.map(x => [x.key, x]));
  assert.deepEqual([rc.customers.matched, rc.customers.amountsCompared, rc.customers.amountsDiffering, rc.customers.totalExpected, rc.customers.totalInZoho], [4, 3, 1, '205200.00', '127400.00']);
  assert.equal(rc.vendors.amountColumn, null);
  assert.match(report.reconciliationNote, /assumed Zoho report format/);
  assert.ok(report.exceptions.some(e => e.stage === 'crosscheck' && e.kind === 'ledger_missing' && e.uses === 2));
  for (const action of ['expected_count_set', 'expected_count_cleared', 'unit_mapped', 'unit_mapping_removed', 'account_type_decided', 'account_type_decision_removed']) {
    assert.ok(report.audit.some(a => a.action === action), `${action} is in the audit log`);
  }

  assert.equal(report.staleSinceUpload, false);

  // ---- reconciliation results follow the generated files ----
  const verNow = async () => Object.fromEntries((await get(`${base}/verification`)).map(x => [x.key, x]));
  // The Travel Expenses decision was removed after the files were last created, so creating them again changes
  // the Chart of Accounts file (and nothing in Customers or Invoices). Only the changed file loses its check.
  ver = await verNow();
  assert.equal(ver.accounts.checked, true);
  assert.equal((await send('POST', `${base}/generate`)).statusCode, 200);
  ver = await verNow();
  assert.deepEqual([ver.accounts.checked, ver.accounts.matched, ver.accounts.note], [false, 0, null], 'the changed file is no longer shown as checked');
  assert.deepEqual([ver.customers.checked, ver.customers.matched, ver.customers.amountsCompared, ver.invoices.checked], [true, 4, 3, true], 'unchanged files keep their check');
  trail = (await get(`${base}/audit`)).map(a => `${a.action} | ${a.detail}`);
  assert.ok(trail.some(t => /^reconciliation_cleared \| .*Chart of Accounts.*: the earlier Zoho report check was removed because the file was created again with different contents/.test(t)));
  // creating the files once more with nothing changed keeps every remaining check
  assert.equal((await send('POST', `${base}/generate`)).statusCode, 200);
  assert.equal((await verNow()).customers.checked, true);

  // ---- reprocess: groups that point at each other, and stock items marked not applicable ----
  r = await put(id, 'accounts', path.join(samples, 'problem-files/chart_of_accounts_group_loop.json'));
  assert.equal(r.statusCode, 200);
  // a file was replaced after processing: the report says its flagged items are from the earlier run
  assert.equal((await get(`${base}/report`)).staleSinceUpload, true);
  assert.equal(r.json().countMatches, false, 'the new file has 19 ledgers but 17 were entered');
  assert.equal((await send('POST', `${base}/process`)).statusCode, 409);
  await setCount('accounts', '');
  assert.equal((await send('DELETE', `${base}/uploads/stock_items`)).statusCode, 200);
  await send('PUT', `${base}/waivers/stock_items`, { reason: 'Items already exist in Zoho' });
  r = await send('POST', `${base}/process`);
  assert.equal(r.statusCode, 200, r.body);
  checks = (await get(`${base}/summary`)).exceptions.filter(e => e.stage === 'crosscheck');
  assert.match(one('items_not_uploaded', 'Stock Items').message, /1 voucher .* uses stock items, but the Stock Items file was not uploaded/);
  assert.ok(!checks.some(e => e.kind === 'item_missing' || e.kind === 'unit_missing'));
  // processing again removes every earlier Zoho report check: it is never shown against the new data
  assert.deepEqual(await get(`${base}/verification`), []);
  assert.equal((await get(`${base}/crosswalk?q=kaveri`)).total, 0);
  assert.ok((await get(`${base}/audit`)).some(a => a.action === 'reconciliation_cleared' && /Customers/.test(a.detail) && /processed again/.test(a.detail)));
  assert.equal((await get(`${base}/report`)).staleSinceUpload, false);
  g = await groupsNow();
  assert.deepEqual([g['Loop A'].source, g['Loop A'].zohoType, g['Loop A'].needsDecision], [null, null, true]);
  assert.equal(g['Factory Expenses'].zohoType, 'Cost Of Goods Sold');
  // A ledger under a sub-group of Sundry Debtors is a customer (a Zoho contact), not an account: its group needs no
  // account type, so neither the group nor Sundry Debtors is listed in Mapping Studio
  assert.deepEqual([g['North Debtors'], g['Sundry Debtors']], [undefined, undefined]);
  r = await send('POST', `${base}/generate`);
  assert.equal(r.statusCode, 200, r.body);
  gen = (await get(`${base}/summary`)).exceptions.filter(e => e.stage === 'generate');
  assert.ok(gen.some(e => /Tally group "Loop A" has no approved Zoho account type/.test(e.message)));
  assert.ok(!gen.some(e => /Tally group "North Debtors" has no approved Zoho account type/.test(e.message)));
  // it is left out of the Chart of Accounts; it is not in the Customer dataset either, so that is flagged (never dropped silently)
  assert.doesNotMatch((await call({ url: `${base}/files/accounts/download?confirmed=1` })).body, /Staff Advance Recoverable/);
  const notInContacts = gen.filter(e => e.kind === 'party_ledger_not_in_contacts');
  assert.deepEqual(notInContacts.map(e => e.name), ['Staff Advance Recoverable']);
  assert.match(notInContacts[0].message, /under Sundry Debtors .* not in the Customer Master dataset, so it is in no file/);
  ver = await verNow();
  assert.ok(Object.values(ver).every(x => x.checked === false && x.amountsCompared === 0 && x.totalInZoho === null), 'new files start unchecked');

  // without Group records the behaviour is as before: a sub-group needs a decision
  const ledgersOnly = JSON.parse(fs.readFileSync(path.join(samples, '03_chart_of_accounts.json'), 'utf8'));
  ledgersOnly.tallymessage = ledgersOnly.tallymessage.filter(m => m.metadata.type === 'Ledger');
  assert.equal((await putBuf(id, 'accounts', ledgersOnly)).statusCode, 200);
  assert.equal((await send('POST', `${base}/process`)).statusCode, 200);
  const at = await get(`${base}/account-types`);
  assert.equal(at.hasGroupRecords, false);
  assert.deepEqual(at.groups.filter(x => x.needsDecision).map(x => x.group), ['Branch / Divisions', 'Factory Expenses', 'Travel Expenses']);
  assert.equal(at.groups.find(x => x.group === 'Admin Expenses').source, 'decided', 'the earlier decision still applies to that group itself');

  // ---- a file whose only Group record is top-level still counts as having group records ----
  ledgersOnly.tallymessage.push({ metadata: { type: 'Group', name: 'Branch / Divisions' }, name: 'Branch / Divisions', parent: '\u0004 Primary' });
  assert.equal((await putBuf(id, 'accounts', ledgersOnly)).statusCode, 200);
  // ---- F6: balances on the unusual side, and figures that must not be rounded into agreement ----
  // Kaveri Components becomes a customer in credit (an advance received): Tally +38900.00
  const custDoc = JSON.parse(fs.readFileSync(path.join(samples, '01_customers.json'), 'utf8'));
  custDoc.tallymessage.find(m => m.name === 'Kaveri Components').openingbalance = '38900.00';
  assert.equal((await putBuf(id, 'customers', custDoc)).statusCode, 200);
  assert.equal((await send('POST', `${base}/process`)).statusCode, 200);
  assert.equal((await get(`${base}/account-types`)).hasGroupRecords, true);
  assert.equal((await send('POST', `${base}/generate`)).statusCode, 200);
  gen = (await get(`${base}/summary`)).exceptions.filter(e => e.stage === 'generate');
  assert.ok(gen.some(e => e.name === 'Kaveri Components' && /Opening balance 38900\.00 is a credit in Tally/.test(e.message)), 'a customer in credit is flagged when the file is created');
  // the Opening Balance column has no sign, so a balance on the unusual side is left empty (and flagged above)
  const kaveriNow = parseCsv((await call({ url: `${base}/files/customers/download?confirmed=1` })).body).rows.find(x => x['Display Name'] === 'Kaveri Components');
  assert.deepEqual([kaveriNow['Opening Balance'], kaveriNow['GST Treatment']], ['', 'business_gst']);
  assert.match(gen.find(e => e.name === 'Kaveri Components' && e.kind === 'balance_unusual_side').message, /the cell is left empty/);
  r = await upload(`${base}/verification/customers`, [
    'Display Name,Opening Balance',
    'Adani Solar Equipment Ltd.,"1,45,000.004"',  // more than two decimal places: differs, not rounded to agree
    'Kaveri Components,38900.00',                 // same figure, but the Tally balance is a credit: must not "agree"
    'Zenith Agro Exports LLP,"0,00"',             // comma as decimal mark: not readable, not guessed
    'BlueOcean Logistics India,(-21300.00)', ''].join('\r\n')); // two negative markers: unclear, not guessed
  assert.equal(r.statusCode, 200, r.body);
  v = r.json();
  assert.deepEqual([v.matched, v.amountsCompared, v.amountsDiffering, v.amountsNotAvailable], [4, 1, 1, 3]);
  assert.match(v.note, /1 record\(s\) have a balance on the unusual side in Tally/);
  const cwOf = async q => (await get(`${base}/crosswalk?q=${q}`)).rows.find(x => x.module === 'Customers');
  cw = await cwOf('kaveri');
  assert.deepEqual([cw.expectedAmount, cw.zohoAmount, cw.amountStatus], ['-38900.00', '38900.00', 'not_available'], 'a customer in credit is never reported as agreeing');
  cw = await cwOf('adani');
  assert.deepEqual([cw.expectedAmount, cw.zohoAmount, cw.amountStatus, cw.status], ['145000.00', '145000.004', 'differs', 'Amount differs in Zoho']);
  assert.deepEqual([(await cwOf('zenith')).zohoAmount, (await cwOf('blueocean')).zohoAmount], [null, null]);
  ver = await verNow();
  assert.match(ver.customers.amountBasis, /with its sign/);

  // ---- a database made before these features: new columns are empty, old verification rows have no amounts ----
  const { DatabaseSync } = await import('node:sqlite');
  const old = new DatabaseSync(path.join(process.env.DATA_DIR, 'migration.db'));
  old.prepare('UPDATE uploads SET main_records = NULL, record_types = NULL, unread_fields = NULL WHERE job_id = ?').run(id);
  old.prepare('DELETE FROM verification_runs WHERE job_id = ?').run(id);
  old.prepare('DELETE FROM verification WHERE job_id = ?').run(id);
  old.prepare("INSERT INTO verification (job_id, key, ident, status, zoho_id, at) VALUES (?, 'customers', 'Adani Solar Equipment Ltd.', 'matched', '9001', '2025-01-01T00:00:00.000Z')").run(id);
  old.close();
  r = await call({ url: `${base}/completeness` });
  assert.equal(r.statusCode, 200);
  const oldCust = r.json().slots.find(s => s.key === 'customers');
  assert.deepEqual([oldCust.actualCount, oldCust.upload.recordTypes, oldCust.upload.fieldsNotRead, oldCust.countMatches], [4, null, null, true], 'the count falls back to the record count');
  r = await call({ url: `${base}/verification` });
  assert.equal(r.statusCode, 200);
  const oldVer = r.json().find(x => x.key === 'customers');
  assert.deepEqual([oldVer.checked, oldVer.matched, oldVer.amountColumn, oldVer.amountsCompared, oldVer.totalExpected, oldVer.totalInZoho, oldVer.note], [true, 1, null, 0, null, null, null]);
  r = await call({ url: `${base}/report` });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().datasets.find(d => d.key === 'customers').fieldsNotRead, null);
  cw = await cwOf('adani');
  assert.deepEqual([cw.status, cw.zohoId, cw.amountStatus], ['Verified in Zoho', '9001', null]);

  await login('viewer');
  assert.equal((await setCount('customers', 3)).statusCode, 403, 'viewer cannot change counts');
  assert.equal((await send('PUT', `${base}/unit-mappings`, { tallyUnit: 'nos', zohoUnit: 'pcs' })).statusCode, 403);
});
