// Editable column layout, "files are out of date", and rejections that follow the generated files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wizardReady } from './wizardready.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-layout-'));
const { buildApp } = await import('../src/index.js');
const { TEMPLATES, toCsv, parseCsv, CONTACT_ALWAYS_KEPT } = await import('../src/zoho.js');
const { fieldText, listFields, checkColumns, defaultColumns, rowValues, csvFor } = await import('../src/columns.js');
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
const upload = (url, text) => call({ method: 'PUT', url, headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from(text) });
const putFile = (id, slot, file) => call({ method: 'PUT', url: `/api/migrations/${id}/uploads/${slot}`, headers: { 'content-type': 'application/octet-stream', 'x-filename': path.basename(file) }, payload: fs.readFileSync(file) });
const putBuf = (id, slot, obj) => call({ method: 'PUT', url: `/api/migrations/${id}/uploads/${slot}`, headers: { 'content-type': 'application/octet-stream', 'x-filename': 'test.json' }, payload: Buffer.from(JSON.stringify(obj)) });
// Firm-level audit entries (no migration id) are read straight from the database.
const firmAudit = () => {
  const d = new DatabaseSync(path.join(process.env.DATA_DIR, 'migration.db'));
  const rows = d.prepare('SELECT action, actor, detail FROM audit_logs WHERE job_id IS NULL ORDER BY id').all();
  d.close();
  return rows;
};

const FILES = {
  vendors: '02_vendors.json', accounts: '03_chart_of_accounts.json', stock_items: '04_stock_items.json',
  units: '05_units.json', taxes: '06_tax_configuration.json', sales: '07_sales_vouchers.json', purchase: '08_purchase_vouchers.json',
  receipt: '09_receipt_vouchers.json', payment: '10_payment_vouchers.json', journal: '11_journal_vouchers.json', trial_balance: '13_trial_balance.json',
};
// The sample customers, with a nested value and a list of lines added to the first one.
const customersDoc = JSON.parse(fs.readFileSync(path.join(samples, '01_customers.json'), 'utf8'));
customersDoc.tallymessage[0].contactdetails = { person: 'Asha Rao' };
customersDoc.tallymessage[0].banks = [{ ifsc: 'HDFC0001' }, { ifsc: 'ICIC0002' }];

test('reading raw Tally fields and checking a draft layout', () => {
  const rec = { name: 'A', address: [{ metadata: true, type: 'String' }, 'Line 1', 'Pune'], contact: { person: 'Asha' }, lines: [{ ledgername: 'X', amount: '-5' }, { ledgername: 'Y' }],
    level: '\u0004 Not Applicable', n: 0, flag: false };
  assert.equal(fieldText(rec, 'name'), 'A');
  assert.equal(fieldText(rec, 'address'), 'Line 1, Pune', 'a Tally list is written as its text items');
  assert.equal(fieldText(rec, 'contact.person'), 'Asha');
  assert.equal(fieldText(rec, 'lines.ledgername'), 'X, Y');
  assert.equal(fieldText(rec, 'lines.amount'), '-5', 'the value is written as it is in Tally');
  assert.deepEqual([fieldText(rec, 'missing'), fieldText(rec, 'contact.missing'), fieldText(rec, 'name.deeper'), fieldText(rec, 'contact'), fieldText(rec, 'level')], ['', '', '', '', '']);
  assert.deepEqual([fieldText(rec, 'n'), fieldText(rec, 'flag')], ['0', 'false']);
  const f = Object.fromEntries(listFields([rec, { name: 'B' }]).fields.map(x => [x.path, x]));
  assert.deepEqual(f.name, { path: 'name', kind: 'text', records: 2, example: 'A' });
  assert.deepEqual(f.address, { path: 'address', kind: 'list', records: 1, example: 'Line 1, Pune' });
  assert.deepEqual(f['lines.ledgername'], { path: 'lines.ledgername', kind: 'text', records: 1, example: 'X, Y' });
  assert.equal(f.level.records, 0, 'a field that only holds "not applicable" is listed with no records');
  assert.ok(!('metadata' in f) && !('contact' in f));

  // the default layout reproduces the original builder exactly
  const d = customersDoc.tallymessage[0];
  const cols = defaultColumns('customers');
  assert.equal(csvFor(cols, [rowValues('customers', cols, TEMPLATES.customers.row(d), d)]), toCsv(TEMPLATES.customers.headers, [TEMPLATES.customers.row(d)]));
  // column ids are stable and come from the original headings
  assert.deepEqual(defaultColumns('items').map(c => c.id), ['item_name', 'sku', 'hsn_sac', 'description', 'rate', 'product_type', 'account', 'usage_unit', 'purchase_description',
    'purchase_rate', 'item_type', 'purchase_account', 'inventory_account', 'reorder_point', 'vendor', 'initial_stock', 'initial_stock_rate', 'stock_on_hand', 'status',
    'taxability_type', 'exemption_reason', 'inter_state_tax_name', 'inter_state_tax_type', 'inter_state_tax_rate', 'intra_state_tax_name', 'intra_state_tax_type',
    'intra_state_tax_rate', 'warehouse_name']); // v2 (changed on purpose): 'cf_custom_field', a custom field of Zoho's demo organisation, is no longer in the Items file
  // "Account # " keeps the space at its end (as in the official sample); its id is "account"
  assert.deepEqual(defaultColumns('accounts').map(c => c.id), ['account_name', 'account_code', 'description', 'account_type', 'parent_account', 'account', 'currency', 'opening_balance', 'debit_or_credit']);
  const accCols = defaultColumns('accounts');
  const checked = checkColumns('accounts', accCols.map(c => ({ ...c, heading: c.heading.trim() })));
  assert.deepEqual([checked.problems, checked.columns.find(c => c.id === 'account').heading], [[], 'Account # '], 'a standard heading that ends with a space keeps it');
  assert.deepEqual(checkColumns('customers', cols).problems, []);
  assert.match(checkColumns('customers', []).problems[0], /at least one column/);
  assert.match(checkColumns('customers', [...cols, { heading: 'X', source: { type: 'field', path: 'a..b' } }]).problems[0], /choose the Tally field/);
  assert.match(checkColumns('customers', [...cols, { heading: 'X', source: { type: 'formula' } }]).problems[0], /choose where its value comes from/);
  assert.match(checkColumns('customers', [...cols, { heading: 'X', source: { type: 'builtin', builtin: 'item_total' } }]).problems[0], /does not exist in this file/);
});

test('column layout, out-of-date files and rejections', async () => {
  await login('analyst');
  let r = await send('POST', '/api/migrations', { company: 'Apex Engineering Technologies Pvt. Ltd.', financialYear: '2024-25' });
  assert.equal(r.statusCode, 201);
  const id = r.json().id;
  const base = `/api/migrations/${id}`;
  const generate = async () => { const g = await send('POST', `${base}/generate`); assert.equal(g.statusCode, 200, g.body); return Object.fromEntries(g.json().files.map(f => [f.key, f])); };
  // (?confirmed=1: "Download anyway" for files with rows the Zoho check expects Zoho to refuse; audit item 18)
  const download = key => call({ url: `${base}/files/${key}/download?confirmed=1` });
  const migration = () => get(base);
  const tpl = async key => (await get('/api/templates')).find(t => t.key === key);
  const saveColumns = (key, columns) => send('PUT', `/api/templates/${key}/columns`, { columns });
  const trail = async () => (await get(`${base}/audit`)).map(a => `${a.action} | ${a.detail}`);

  assert.equal((await putBuf(id, 'customers', customersDoc)).statusCode, 200);
  for (const [slot, f] of Object.entries(FILES)) assert.equal((await putFile(id, slot, path.join(samples, f))).statusCode, 200, slot);
  await send('PUT', `${base}/waivers/stock_summary`, { reason: 'Not needed for test' });
  assert.equal((await send('POST', `${base}/process`)).statusCode, 200);
  await send('POST', `${base}/journals/accept-suggestions`);
  await send('PUT', `${base}/tax-mappings`, { ledger: 'Output CGST', zohoTax: 'CGST9' });
  const files0 = await generate();
  assert.equal((await migration()).filesOutOfDate, false, 'decisions made before the files were created do not count');

  // ===== A1: the default layout =====
  let t = await tpl('customers');
  // the standard layout is the official Zoho sample's, checked by the platform
  assert.deepEqual([t.customised, t.verified, t.verifiedInCode, t.verification.sampleFileName, t.verification.builtIn, t.kind, t.idColumn, t.idColumnId],
    [false, true, true, 'customer_import_sample_data.xls', true, 'master', 'Display Name', 'display_name']);
  assert.equal(t.hash, t.defaultHash);
  assert.match(t.verificationNote, /every heading of the official Zoho Books sample file "customer_import_sample_data\.xls"/);
  // changed on purpose in B6: the voucher files now use the official Zoho sample layouts too
  assert.deepEqual([(await tpl('invoices')).verified, (await tpl('invoices')).verifiedInCode, (await tpl('invoices')).officialSampleFile], [true, true, 'sample_invoices.xls']);
  assert.deepEqual(t.columns[0], { id: 'display_name', name: 'Display Name', heading: 'Display Name', position: 1, source: { type: 'builtin', builtin: 'display_name' }, from: 'Ledger name',
    identifying: true, defaultHeading: 'Display Name', noLongerAvailable: false, changed: { added: false, heading: false, source: false, position: false }, differsFromDefault: false });
  assert.deepEqual(t.editable, { rename: true, reorder: true, changeSource: true, add: true, remove: true });
  assert.deepEqual((await tpl('invoices')).editable, { rename: true, reorder: true, changeSource: false, add: false, remove: false });
  // with no customisation the file is byte-for-byte what the original builder writes
  const custRecords = (await get(`${base}/records?slot=customers`)).records.map(x => x.data);
  // v2 (changed on purpose): a column that is empty on every row, and is not one Zoho's import needs, is left out of the Customers file
  const custBuilt = custRecords.map(d => TEMPLATES.customers.row(d));
  const custWritten = TEMPLATES.customers.headers.filter(h => CONTACT_ALWAYS_KEPT.has(h) || custBuilt.some(r => String(r[h] ?? '') !== ''));
  assert.ok(custWritten.length < TEMPLATES.customers.headers.length && custWritten.includes('Place Of Contact'));
  assert.equal((await download('customers')).body, toCsv(custWritten, custBuilt));
  let listed = Object.fromEntries((await get(`${base}/files`)).map(f => [f.key, f]));
  assert.equal(listed.customers.mappingHash, t.hash, 'the file records the layout version it was built with');
  assert.deepEqual(listed.customers.headings, custWritten);
  assert.deepEqual([listed.customers.currentLayout, listed.customers.outOfDate, listed.customers.templateVerified, listed.customers.templateAttestation.builtIn], [true, false, 1, true]);
  assert.deepEqual([listed.opening_balances.referenceOnly, listed.accounts.referenceOnly], [true, false]);
  assert.match(listed.opening_balances.referenceNote, /do not import/);
  assert.equal(files0.customers.mappingHash, t.hash);

  // ----- the Tally fields present in this migration -----
  let fl = await get(`${base}/templates/customers/fields`);
  assert.deepEqual([fl.available, fl.dataset, fl.datasetName, fl.recordType, fl.records], [true, 'customers', 'Customer Master', 'Ledger', 4]);
  const fields = Object.fromEntries(fl.fields.map(f => [f.path, f]));
  assert.deepEqual(fields.address, { path: 'address', kind: 'list', records: 4, example: 'Plot 12, Industrial Area, Gujarat' });
  assert.deepEqual(fields.creditperiod, { path: 'creditperiod', kind: 'text', records: 4, example: '30 Days' });
  assert.deepEqual(fields['contactdetails.person'], { path: 'contactdetails.person', kind: 'text', records: 1, example: 'Asha Rao' });
  assert.deepEqual(fields['banks.ifsc'], { path: 'banks.ifsc', kind: 'text', records: 1, example: 'HDFC0001, ICIC0002' });
  assert.equal(fields.pricelevel.records, 0);
  fl = await get(`${base}/templates/invoices/fields`);
  assert.deepEqual([fl.available, fl.fields], [false, []]);
  assert.match(fl.note, /will come later/);
  assert.equal((await call({ url: `${base}/templates/nonsense/fields` })).statusCode, 404);

  // ----- a draft is previewed without being saved -----
  // a smaller layout: some of the standard columns, in the standard order, and columns of the firm's own
  const KEEP = ['place_of_contact', 'emailid', 'gst_treatment', 'gst_identification_number_gstin', 'pan_number', 'billing_address', 'billing_state', 'billing_country', 'billing_code', 'opening_balance'];
  const draft = [
    { id: 'phone', heading: 'Phone' },
    { id: 'display_name', heading: 'Contact Name' },
    ...t.columns.filter(c => KEEP.includes(c.id)).map(c => ({ id: c.id, heading: c.id === 'opening_balance' ? 'Op Bal' : c.heading, source: c.source })),
    { heading: 'Full Address', source: { type: 'field', path: 'address' } },
    { heading: 'Contact Person', source: { type: 'field', path: 'contactdetails.person' } },
    { heading: 'Bank Codes', source: { type: 'field', path: 'banks.ifsc' } },
    { heading: 'Source System', source: { type: 'fixed', value: 'Tally' } },
    { heading: 'Remarks', source: { type: 'blank' } },
    { heading: 'Not In Tally', source: { type: 'field', path: 'nosuchfield' } },
  ];
  const HEADINGS = ['Phone', 'Contact Name', 'Place Of Contact', 'EmailID', 'GST Treatment', 'GST Identification Number (GSTIN)', 'PAN Number', 'Billing Address', 'Billing State', 'Billing Country', 'Billing Code', 'Op Bal',
    'Full Address', 'Contact Person', 'Bank Codes', 'Source System', 'Remarks', 'Not In Tally'];
  const auditBefore = firmAudit().length, jobAuditBefore = (await trail()).length;
  r = await send('POST', `${base}/templates/customers/preview`, { columns: draft });
  assert.equal(r.statusCode, 200, r.body);
  let pv = r.json();
  assert.deepEqual([pv.valid, pv.problems, pv.totalRows, pv.rows.length, pv.differsFromSaved], [true, [], 4, 4, true]);
  assert.deepEqual(pv.headings, HEADINGS);
  assert.deepEqual(pv.rows[0], ['', 'Adani Solar Equipment Ltd.', 'GJ', 'accounts1@example.com', 'business_gst', '24AAACA1234F1Z5', 'AAACA1234F', 'Plot 12, Industrial Area', 'Gujarat', 'India', '380001', '145000.00',
    'Plot 12, Industrial Area, Gujarat', 'Asha Rao', 'HDFC0001, ICIC0002', 'Tally', '', '']);
  assert.deepEqual(pv.rows[1].slice(13, 15), ['', ''], 'a record without the field gets an empty cell');
  // a draft with problems is reported, still not saved
  pv = (await send('POST', `${base}/templates/customers/preview`, { columns: [{ id: 'display_name', heading: 'Name' }, { heading: 'name', source: { type: 'blank' } }] })).json();
  assert.equal(pv.valid, false);
  assert.match(pv.problems[0], /used more than once/);
  assert.deepEqual(pv.headings, ['Name', 'name']);
  pv = (await send('POST', `${base}/templates/customers/preview`, { columns: 'nonsense' })).json();
  assert.deepEqual([pv.valid, pv.rows], [false, []]);
  // no draft: the saved layout is shown
  pv = (await send('POST', `${base}/templates/invoices/preview`, {})).json();
  assert.deepEqual([pv.valid, pv.differsFromSaved, pv.rows.length, pv.headings[0]], [true, false, 5, 'Invoice Number']); // B6: Zoho's layout, Invoice Number first
  assert.equal((await tpl('customers')).customised, false, 'a preview saves nothing');
  assert.equal(firmAudit().length, auditBefore, 'a preview writes nothing to the audit log');
  assert.equal((await trail()).length, jobAuditBefore);
  assert.equal((await migration()).filesOutOfDate, false);

  // ----- who may change a layout -----
  r = await saveColumns('customers', draft);
  assert.equal(r.statusCode, 403, 'an analyst cannot change a layout'); assert.match(r.json().error, /Only an admin/);
  assert.equal((await send('DELETE', '/api/templates/customers/columns')).statusCode, 403);
  assert.equal((await send('PUT', '/api/templates/customers/verified', { verified: true, sampleFileName: 'x.csv' })).statusCode, 403);
  await login('viewer');
  assert.equal((await saveColumns('customers', draft)).statusCode, 403);
  assert.equal((await call({ url: '/api/templates' })).statusCode, 200, 'a viewer can read the layouts');
  await login('admin');

  // ----- validation -----
  const def = (await tpl('customers')).columns.map(c => ({ id: c.id, heading: c.heading, source: c.source }));
  const bad = async (key, columns, re) => { const x = await saveColumns(key, columns); assert.equal(x.statusCode, 400, x.body); assert.match(x.json().error, re); assert.ok(x.json().problems.length >= 1); };
  await bad('customers', def.map(c => (c.id === 'phone' ? { ...c, heading: 'emailid' } : c)), /"emailid" is used more than once/);
  await bad('customers', def.map(c => (c.id === 'phone' ? { ...c, heading: '   ' } : c)), /has no heading/);
  await bad('customers', def.filter(c => c.id !== 'display_name'), /"Display Name" column identifies each record and cannot be removed/);
  await bad('customers', def.map(c => (c.id === 'display_name' ? { ...c, source: { type: 'blank' } } : c)), /cannot be left blank or set to a fixed text/);
  await bad('customers', def.map(c => (c.id === 'display_name' ? { ...c, source: { type: 'fixed', value: 'x' } } : c)), /cannot be left blank or set to a fixed text/);
  await bad('customers', [], /at least one column/);
  assert.equal((await saveColumns('nonsense', def)).statusCode, 404);
  const invDef = (await tpl('invoices')).columns.map(c => ({ id: c.id, heading: c.heading, source: c.source }));
  await bad('invoices', [...invDef, { heading: 'Extra', source: { type: 'blank' } }], /only renaming and reordering columns is available for now.*will come later/);
  await bad('invoices', invDef.filter(c => c.id !== 'notes'), /will come later/);
  await bad('invoices', invDef.map(c => (c.id === 'notes' ? { ...c, source: { type: 'fixed', value: 'x' } } : c)), /will come later/);
  assert.equal((await tpl('customers')).customised, false, 'a refused layout is not saved');
  assert.equal(firmAudit().filter(a => /^column_mapping/.test(a.action)).length, 0);

  // ----- saving a layout -----
  r = await saveColumns('customers', draft);
  assert.equal(r.statusCode, 200, r.body);
  t = r.json();
  assert.equal(t.changed, true);
  assert.deepEqual(t.columns.map(c => c.heading), HEADINGS);
  assert.deepEqual([t.customised, t.idColumn, t.idColumnId, t.updatedBy], [true, 'Contact Name', 'display_name', 'admin@demo.test']);
  assert.notEqual(t.hash, t.defaultHash);
  const byHeading = Object.fromEntries(t.columns.map(c => [c.heading, c]));
  assert.deepEqual(byHeading['Contact Name'].changed, { added: false, heading: true, source: false, position: true });
  assert.deepEqual(byHeading['Op Bal'].changed, { added: false, heading: true, source: false, position: false });
  assert.deepEqual([byHeading.Phone.changed.position, byHeading.Phone.differsFromDefault, byHeading['Billing Address'].differsFromDefault], [true, true, false]);
  assert.match(byHeading['Full Address'].id, /^c_[a-z0-9]+$/, 'an added column gets its own stable id');
  assert.deepEqual([byHeading['Full Address'].changed.added, byHeading['Full Address'].from, byHeading['Source System'].from, byHeading.Remarks.from], [true, 'Tally field "address"', 'Fixed text "Tally"', 'Left blank']);
  assert.ok(t.removedColumns.some(c => c.id === 'company_name'));
  assert.equal(t.removedColumns.length, 62 - 12, 'every standard column left out can be added back');
  assert.match(t.verificationNote, /changed from the standard one, which matches the official Zoho sample file "customer_import_sample_data\.xls"/);
  assert.deepEqual([t.verified, t.verifiedInCode], [false, false], 'a changed layout is no longer the sample\'s');
  for (const piece of ['column "Company Name" removed', 'heading "Display Name" changed to "Contact Name"', 'heading "Opening Balance" changed to "Op Bal"', 'column "Full Address" added (Tally field "address")',
    'column "Source System" added (fixed text "Tally")', 'column order changed from [Display Name, ']) {
    assert.ok(t.changes.some(c => c.includes(piece)), `the changes list says: ${piece}`);
  }
  let fa = firmAudit().filter(a => a.action === 'column_mapping_changed');
  assert.equal(fa.length, 1);
  assert.equal(fa[0].actor, 'admin@demo.test');
  assert.match(fa[0].detail, /Customers file: .*heading "Display Name" changed to "Contact Name".*Layout version [0-9a-f]{12} -> [0-9a-f]{12}\./);
  // the same layout again is not a change
  const savedCols = t.columns.map(c => ({ id: c.id, heading: c.heading, source: c.source }));
  r = await saveColumns('customers', savedCols);
  assert.deepEqual([r.statusCode, r.json().changed, r.json().changes], [200, false, []]);
  assert.equal(firmAudit().filter(a => a.action === 'column_mapping_changed').length, 1);

  // ===== A3: the files created earlier are now out of date =====
  let m = await migration();
  assert.equal(m.filesOutOfDate, true);
  assert.deepEqual(m.outOfDateFiles, ['customers']);
  assert.deepEqual(m.outOfDateReasons.map(x => [x.reason, x.files, x.by]), [['The column layout of the Customers file was changed.', ['customers'], 'admin@demo.test']]);
  assert.ok(m.outOfDateSince);
  assert.equal((await get('/api/migrations')).find(x => x.id === id).filesOutOfDate, true, 'the list shows it too');
  r = await download('customers');
  assert.equal(r.statusCode, 409);
  assert.match(r.json().error, /The Customers file is out of date.*The column layout of the Customers file was changed\. Create the files again first\./);
  assert.equal(r.json().outOfDate, true);
  assert.equal((await download('vendors')).statusCode, 200, 'a file the change does not touch can still be downloaded');
  listed = Object.fromEntries((await get(`${base}/files`)).map(f => [f.key, f]));
  assert.deepEqual([listed.customers.outOfDate, listed.customers.currentLayout, listed.vendors.outOfDate], [true, false, false]);
  assert.deepEqual(listed.customers.outOfDateReasons, ['The column layout of the Customers file was changed.']);
  let imports = Object.fromEntries((await get(`${base}/imports`)).map(f => [f.key, f]));
  assert.deepEqual([imports.customers.outOfDate, imports.accounts.outOfDate], [true, false]);
  await wizardReady(call, base); // set-up and Migration Date first: the older route follows the wizard's locks
  assert.equal((await send('PUT', `${base}/imports/accounts`, { status: 'imported' })).statusCode, 200);
  await wizardReady(call, base);
  r = await send('PUT', `${base}/imports/customers`, { status: 'imported' });
  assert.equal(r.statusCode, 409); assert.match(r.json().error, /out of date/);
  r = await send('PUT', `${base}/imports/customers`, { status: 'partial', note: 'x' });
  assert.equal(r.statusCode, 409);
  assert.ok((await trail()).some(x => /^column_layout_changed \| Customers file: .*The file created earlier is out of date/.test(x)), 'the migration audit log records the layout change');
  assert.equal((await get(`${base}/report`)).filesOutOfDate, true);

  // creating the files again clears the flag, and the new layout reaches the CSV
  let files = await generate();
  m = await migration();
  assert.deepEqual([m.filesOutOfDate, m.outOfDateReasons, m.outOfDateFiles, m.outOfDateSince], [false, [], [], null]);
  assert.deepEqual([files.customers.mappingHash, files.customers.customLayout], [t.hash, true]);
  assert.deepEqual(files.customers.headings, HEADINGS);
  assert.equal(files.vendors.sha256, files0.vendors.sha256, 'other files are untouched');
  r = await download('customers');
  assert.equal(r.statusCode, 200);
  let lines = r.body.trim().split('\r\n');
  assert.equal(lines[0], HEADINGS.join(','));
  assert.equal(lines[1], ',Adani Solar Equipment Ltd.,GJ,accounts1@example.com,business_gst,24AAACA1234F1Z5,AAACA1234F,"Plot 12, Industrial Area",Gujarat,India,380001,145000.00,"Plot 12, Industrial Area, Gujarat",Asha Rao,"HDFC0001, ICIC0002",Tally,,');
  assert.equal(lines.length, 5);
  assert.equal((await get(`${base}/records?slot=customers`)).records[0].data.name, 'Adani Solar Equipment Ltd.', 'the source record is untouched');
  const manifest = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, 'output', id, 'migration_manifest.json'), 'utf8'));
  assert.equal(manifest.files.find(f => f.key === 'customers').mappingHash, t.hash, 'the manifest records the layout version');

  // ----- the rename flows through rejections, corrections and the retry file -----
  r = await upload(`${base}/rejections/customers`, 'Display Name,Error Message\r\nKaveri Components,Billing State is mandatory\r\n');
  assert.equal(r.statusCode, 422, 'the old heading is no longer in the file');
  assert.match(r.json().error, /no "Contact Name" column/);
  r = await upload(`${base}/rejections/customers`, 'Contact Name,Error Message\r\nKaveri Components,Billing State is mandatory\r\nSomeone Unknown Ltd,Duplicate record\r\n');
  assert.deepEqual(r.json(), { rejected: 2, linked: 1, unlinked: 1 });
  let rej = await get(`${base}/rejections`);
  let kaveri = rej.find(x => x.ident === 'Kaveri Components');
  assert.deepEqual(kaveri.columns, HEADINGS);
  assert.equal(kaveri.idColumn, 'Contact Name');
  assert.deepEqual([kaveri.rows[0].values['Contact Name'], kaveri.rows[0].values['Op Bal'], kaveri.rows[0].valuesById.display_name, kaveri.rows[0].valuesById.opening_balance], ['Kaveri Components', '38900.00', 'Kaveri Components', '38900.00']);
  const defOf = h => kaveri.columnDefs.find(c => c.heading === h);
  assert.deepEqual([defOf('Op Bal').id, defOf('Op Bal').needsConfirmation, defOf('Billing State').needsConfirmation, defOf('Contact Name').identifying], ['opening_balance', true, false, true]);
  const correct = payload => send('POST', `${base}/rejections/${kaveri.id}/corrections`, payload);
  const rowNo = kaveri.rows[0].rowNo;
  assert.equal((await correct({ rowNo, column: 'Opening Balance', newValue: '0.00', reason: 'x' })).statusCode, 400, 'the old heading is unknown');
  r = await correct({ rowNo, column: 'Op Bal', newValue: '0.00', reason: 'x' });
  assert.equal(r.statusCode, 409, 'a renamed amount column still needs explicit confirmation');
  assert.equal(r.json().needsConfirmation, true);
  assert.equal((await correct({ rowNo, columnId: 'billing_state', newValue: 'KA', reason: 'Zoho needs the state code' })).statusCode, 200);
  assert.equal((await correct({ rowNo, column: 'Remarks', newValue: 'checked', reason: 'note for Zoho' })).statusCode, 200);
  kaveri = (await get(`${base}/rejections`)).find(x => x.ident === 'Kaveri Components');
  assert.deepEqual(kaveri.rows[0].corrections.map(c => [c.column, c.columnId, c.original, c.newValue]), [['Billing State', 'billing_state', 'Karnataka', 'KA'], ['Remarks', defOf('Remarks').id, '', 'checked']]);
  r = await send('POST', `${base}/rejections/customers/retry`);
  assert.deepEqual([r.json().records, r.json().rows, r.json().corrections], [1, 1, 2]);
  const retryCsv = (await call({ url: `${base}/rejections/customers/retry/download` })).body;
  lines = retryCsv.trim().split('\r\n');
  assert.equal(lines[0], HEADINGS.join(','), 'the retry file has the same headings as the file');
  assert.match(lines[1], /^,Kaveri Components,KA,.*,KA,India,560001,38900\.00,.*,Tally,checked,$/);

  // ----- and through verification and the amount comparison -----
  r = await upload(`${base}/verification/customers`, 'Display Name,Opening Balance\r\nKaveri Components,38900.00\r\n');
  assert.equal(r.statusCode, 422); assert.match(r.json().error, /needs a "Contact Name" column/);
  r = await upload(`${base}/verification/customers`, 'Contact Name,Contact ID,Opening Balance\r\nAdani Solar Equipment Ltd.,9001,"1,45,000.00"\r\nKaveri Components,9002,38000.00\r\n');
  let v = r.json();
  assert.deepEqual([v.expected, v.matched, v.missing, v.amountColumn, v.amountsCompared, v.amountsDiffering], [4, 2, 2, 'Opening Balance', 2, 1]);
  let ver = Object.fromEntries((await get(`${base}/verification`)).map(x => [x.key, x]));
  assert.deepEqual([ver.customers.idColumn, ver.customers.idColumnId, ver.customers.amountsComparable, ver.customers.matched], ['Contact Name', 'display_name', true, 2]);
  const cw = (await get(`${base}/crosswalk?q=adani`)).rows.find(x => x.module === 'Customers');
  assert.deepEqual([cw.ident, cw.zohoId, cw.status, cw.sourceId], ['Adani Solar Equipment Ltd.', '9001', 'Verified in Zoho', 'a1b2c3d4-0000-4000-8000-c00000001']);

  // ----- a later rename does not break what was stored for the existing file -----
  r = await saveColumns('customers', savedCols.map(c => (c.id === 'display_name' ? { ...c, heading: 'Customer' } : c)));
  assert.equal(r.statusCode, 200);
  kaveri = (await get(`${base}/rejections`)).find(x => x.ident === 'Kaveri Components');
  assert.deepEqual([kaveri.idColumn, kaveri.rows[0].values['Contact Name'], kaveri.rows[0].corrections.length], ['Contact Name', 'Kaveri Components', 2], 'stored rows keep the headings of the file they belong to');
  assert.equal((await get(`${base}/verification`)).find(x => x.key === 'customers').idColumn, 'Contact Name');
  assert.equal((await migration()).filesOutOfDate, true);
  // going back to the layout the file was built with means the file is not out of date after all
  assert.equal((await saveColumns('customers', savedCols)).statusCode, 200);
  assert.deepEqual([(await migration()).filesOutOfDate, (await tpl('customers')).hash], [false, t.hash]);
  assert.equal((await download('customers')).statusCode, 200);

  // ----- voucher files: rename and reorder only -----
  // changed on purpose in B6: the Invoices layout is Zoho's sample (70 columns); "Item Price" is renamed instead of "Item Total"
  const invCols = [invDef.find(c => c.id === 'invoice_date'), ...invDef.filter(c => c.id !== 'invoice_date')]
    .map(c => ({ ...c, heading: c.id === 'invoice_number' ? 'Invoice No' : c.id === 'item_price' ? 'Unit Price' : c.heading }));
  r = await saveColumns('invoices', invCols);
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual([r.json().idColumn, r.json().kind], ['Invoice No', 'voucher']);
  assert.deepEqual((await migration()).outOfDateFiles, ['invoices']);
  files = await generate();
  const invCsv = (await download('invoices')).body;
  assert.deepEqual(invCsv.split('\r\n')[0].split(',').slice(0, 3), ['Invoice Date', 'Invoice No', 'Estimate Number']);
  const invRow = parseCsv(invCsv).rows.find(x => x['Invoice No'] === 'SA/24-25/0004');
  assert.deepEqual([invRow['Item Name'], invRow.Quantity, invRow['Unit Price']], ['Bearing 6204 ZZ', '100', '213.00']);
  r = await upload(`${base}/rejections/invoices`, 'Invoice No,Reason\r\nSA/24-25/0003,Customer not found\r\n');
  assert.equal(r.json().linked, 1);
  assert.equal((await get(`${base}/rejections`)).find(x => x.key === 'invoices').rows.length, 1, 'one rejection covers every row of the document');
  r = await upload(`${base}/verification/invoices`, 'Invoice No,Invoice ID,Total\r\nSA/24-25/0001,1,"11,800.00"\r\nSA/24-25/0003,3,1.00\r\n');
  v = r.json();
  // v2 default 13 (changed on purpose: the report said 10,000.00). The IGST of SA/24-25/0001 is not mapped in this test,
  // so Zoho's own tax of that rate (IGST18) is written by default and Zoho's total for it is the line plus 18% (11800)
  assert.deepEqual([v.matched, v.amountColumn, v.amountsCompared, v.amountsDiffering], [2, 'Total', 2, 1], 'the renamed "Item Price" column is still used for the expected amount');
  ver = Object.fromEntries((await get(`${base}/verification`)).map(x => [x.key, x]));
  assert.match(ver.invoices.amountBasis, /^For each invoice: "Quantity" times "Unit Price" on every row/);
  assert.equal(ver.invoices.idColumn, 'Invoice No');

  // ----- opening balances: renamed amount columns still compare; a removed one means "not compared", not a crash -----
  const obDef = (await tpl('opening_balances')).columns.map(c => ({ id: c.id, heading: c.heading, source: c.source }));
  assert.equal((await saveColumns('opening_balances', obDef.map(c => ({ ...c, heading: c.id === 'debit' ? 'Dr Amount' : c.id === 'credit' ? 'Cr Amount' : c.heading })))).statusCode, 200);
  await generate();
  assert.match((await download('opening_balances')).body, /^Account,Dr Amount,Cr Amount\r\n/);
  r = await upload(`${base}/verification/opening_balances`, 'Account,Debit,Credit\r\nAdani Solar Equipment Ltd.,145000.00,\r\nBharat Steel Traders,,"1,18,000.00"\r\n');
  v = r.json();
  assert.deepEqual([v.matched, v.amountColumn, v.amountsCompared, v.amountsDiffering], [2, 'Debit minus Credit', 2, 0]);
  assert.equal((await get(`${base}/verification`)).find(x => x.key === 'opening_balances').amountBasis, '"Dr Amount" minus "Cr Amount" (a credit balance is negative)');
  assert.equal((await saveColumns('opening_balances', obDef.filter(c => c.id !== 'debit'))).statusCode, 200, 'an amount column may be removed');
  await generate();
  assert.match((await download('opening_balances')).body, /^Account,Credit\r\n/);
  r = await upload(`${base}/verification/opening_balances`, 'Account,Debit,Credit\r\nAdani Solar Equipment Ltd.,145000.00,\r\n');
  assert.equal(r.statusCode, 200, r.body);
  v = r.json();
  assert.deepEqual([v.matched, v.amountColumn, v.amountsCompared, v.totalExpected, v.totalInZoho], [1, null, 0, null, null]);
  assert.match(v.note, /Amounts are not compared for this file: the column "Debit" was removed .* Records were matched by "Account" only/);
  let ob = (await get(`${base}/verification`)).find(x => x.key === 'opening_balances');
  assert.deepEqual([ob.amountsComparable, ob.amountBasis, ob.amountColumn, ob.matched], [false, null, null, 1]);
  assert.match(ob.amountsNotComparableReason, /"Debit"/);
  assert.equal((await call({ url: `${base}/report` })).statusCode, 200);
  // a column that no longer carries its standard value is treated the same way
  assert.equal((await saveColumns('opening_balances', obDef.map(c => (c.id === 'credit' ? { ...c, source: { type: 'field', path: 'closingbalance' } } : c)))).statusCode, 200);
  await generate();
  assert.match((await download('opening_balances')).body, /^Adani Solar Equipment Ltd\.,145000\.00,-145000\.00\r\n/m, 'the raw Tally value is written with its sign, unchanged');
  v = (await upload(`${base}/verification/opening_balances`, 'Account,Debit,Credit\r\nAdani Solar Equipment Ltd.,145000.00,\r\n')).json();
  assert.equal(v.amountColumn, null);
  assert.match(v.note, /"Credit"/);

  // ----- the "matches the official Zoho sample" statement -----
  r = await send('PUT', '/api/templates/invoices/verified', { verified: true, sampleFileName: '  ' });
  assert.equal(r.statusCode, 400); assert.match(r.json().error, /name of the official Zoho sample file/);
  assert.equal((await send('PUT', '/api/templates/invoices/verified', {})).statusCode, 400);
  r = await send('PUT', '/api/templates/invoices/verified', { verified: true, sampleFileName: 'Invoice_sample.csv', note: 'Compared column by column on 12 Nov' });
  assert.equal(r.statusCode, 200, r.body);
  t = r.json();
  assert.equal(t.verified, true);
  assert.deepEqual([t.verification.sampleFileName, t.verification.note, t.verification.by], ['Invoice_sample.csv', 'Compared column by column on 12 Nov', 'admin@demo.test']);
  assert.ok(t.verification.at);
  assert.match(t.verificationNote, /admin@demo\.test stated that this layout matches .*"Invoice_sample\.csv".*the platform has not checked it/);
  assert.deepEqual([(await tpl('bills')).verified, (await tpl('bills')).verification.builtIn], [true, true], 'other files keep the built-in check of their standard layout (B6)');
  assert.equal((await migration()).filesOutOfDate, false, 'the statement does not change any file');
  files = await generate();
  assert.equal(files.invoices.templateVerified, true);
  listed = Object.fromEntries((await get(`${base}/files`)).map(f => [f.key, f]));
  assert.deepEqual([listed.invoices.templateVerified, listed.invoices.templateAttestation.sampleFileName, listed.bills.templateVerified], [1, 'Invoice_sample.csv', 1]);
  // any later change to the columns clears it
  assert.equal((await saveColumns('invoices', invCols.map(c => (c.id === 'notes' ? { ...c, heading: 'Remarks' } : c)))).statusCode, 200);
  t = await tpl('invoices');
  assert.deepEqual([t.verified, t.verification], [false, null]);
  fa = firmAudit();
  assert.ok(fa.some(a => a.action === 'template_marked_verified' && /Invoices file: admin@demo\.test stated that layout version [0-9a-f]{12} matches the official Zoho sample "Invoice_sample\.csv"/.test(a.detail)));
  assert.ok(fa.some(a => a.action === 'template_verified_cleared' && /removed because the layout changed/.test(a.detail)));
  // marking and unmarking by hand
  await send('PUT', '/api/templates/bills/verified', { verified: true, sampleFileName: 'Bill_sample.csv' });
  t = (await send('PUT', '/api/templates/bills/verified', { verified: false })).json();
  assert.deepEqual([t.verified, t.verification.builtIn], [true, true], 'B6: the admin\'s statement is removed; the standard layout keeps the built-in check');
  assert.ok(firmAudit().some(a => a.action === 'template_verified_removed' && /Bills file/.test(a.detail)));
  // a statement made on the default layout is cleared by the first change, too
  await send('PUT', '/api/templates/items/verified', { verified: true, sampleFileName: 'Item_sample.csv' });
  const itemDef = (await tpl('items')).columns.map(c => ({ id: c.id, heading: c.heading, source: c.source }));
  await saveColumns('items', itemDef.map(c => (c.id === 'hsn_sac' ? { ...c, heading: 'HSN' } : c)));
  assert.equal((await tpl('items')).verified, false);

  // ----- reset restores the exact default output -----
  for (const key of ['customers', 'invoices', 'opening_balances', 'items']) {
    r = await send('DELETE', `/api/templates/${key}/columns`);
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual([r.json().customised, r.json().hash === r.json().defaultHash, r.json().removedColumns], [false, true, []]);
  }
  assert.equal((await send('DELETE', '/api/templates/vendors/columns')).json().changed, false, 'resetting a default layout changes nothing');
  assert.equal(firmAudit().filter(a => a.action === 'column_mapping_reset').length, 4);
  files = await generate();
  for (const key of Object.keys(files0)) assert.equal(files[key].sha256, files0[key].sha256, `${key} is exactly as it was before any customisation`);
  assert.equal((await download('customers')).body, toCsv(custWritten, custBuilt));
  await login('analyst');

  // ===== A3: every kind of change marks the files out of date; a no-op does not =====
  const stale = async () => { const x = await migration(); return [x.filesOutOfDate, x.outOfDateFiles]; };
  // tax mapping
  await send('PUT', `${base}/tax-mappings`, { ledger: 'Output CGST', zohoTax: 'CGST9' });
  assert.deepEqual(await stale(), [false, []], 'the same tax mapping again is not a change');
  await send('PUT', `${base}/tax-mappings`, { ledger: 'Output SGST', zohoTax: '' });
  assert.deepEqual(await stale(), [false, []], 'removing a mapping that does not exist is not a change');
  await send('PUT', `${base}/tax-mappings`, { ledger: 'Output SGST', zohoTax: 'SGST9' });
  assert.deepEqual(await stale(), [true, ['items', 'invoices', 'bills']]); // (audit item 5: the service items follow the invoices)
  assert.match((await migration()).outOfDateReasons[0].reason, /Tally ledger "Output SGST" was mapped to Zoho tax "SGST9"/);
  assert.equal((await download('invoices')).statusCode, 409);
  assert.equal((await download('customers')).statusCode, 200);
  await generate();
  assert.deepEqual(await stale(), [false, []]);
  assert.equal((await download('invoices')).statusCode, 200);
  // account type decision
  await send('PUT', `${base}/account-types`, { group: 'Branch / Divisions', zohoType: 'Other Current Asset' });
  assert.deepEqual(await stale(), [true, ['accounts']]);
  assert.equal((await download('accounts')).statusCode, 409);
  await generate();
  await send('PUT', `${base}/account-types`, { group: 'Branch / Divisions', zohoType: 'Other Current Asset' });
  assert.deepEqual(await stale(), [false, []], 'the same decision again is not a change');
  await send('PUT', `${base}/account-types`, { group: 'Some Other Group', zohoType: null });
  assert.deepEqual(await stale(), [false, []]);
  await send('PUT', `${base}/account-types`, { group: 'Branch / Divisions', zohoType: null });
  assert.deepEqual(await stale(), [true, ['accounts']], 'removing a decision is a change');
  await generate();
  // unit mapping
  await send('PUT', `${base}/unit-mappings`, { tallyUnit: 'nos', zohoUnit: 'pcs' });
  assert.deepEqual(await stale(), [true, ['items']]);
  assert.equal((await download('items')).statusCode, 409);
  await generate();
  await send('PUT', `${base}/unit-mappings`, { tallyUnit: 'nos', zohoUnit: 'pcs' });
  assert.deepEqual(await stale(), [false, []]);
  // journal routing
  const journals = await get(`${base}/journals`);
  const j = journals.find(x => x.decision === 'Invoice') || journals[0];
  await send('PUT', `${base}/journals/${j.id}`, { decision: j.decision });
  assert.deepEqual(await stale(), [false, []], 'routing a journal to where it already goes is not a change');
  const other = j.decision === 'Manual Journal' ? 'Invoice' : 'Manual Journal';
  await send('PUT', `${base}/journals/${j.id}`, { decision: other });
  m = await migration();
  assert.equal(m.filesOutOfDate, true);
  assert.match(m.outOfDateReasons[0].reason, new RegExp(`was routed to ${other} \\(it was ${j.decision}\\)`));
  assert.ok(m.outOfDateFiles.includes('journals') || m.outOfDateFiles.includes('invoices'));
  assert.equal((await download('customers')).statusCode, 200);
  await send('PUT', `${base}/journals/${j.id}`, { decision: j.decision });
  await generate();
  assert.deepEqual(await stale(), [false, []]);

  // ===== A4: rejections follow the generated file =====
  r = await upload(`${base}/rejections/customers`, 'Display Name,Error Message\r\nKaveri Components,Billing State is mandatory\r\n');
  assert.equal(r.json().linked, 1);
  kaveri = (await get(`${base}/rejections`)).find(x => x.key === 'customers');
  assert.equal((await send('POST', `${base}/rejections/${kaveri.id}/corrections`, { rowNo: kaveri.rows[0].rowNo, column: 'Billing State', newValue: 'KA', reason: 'state code' })).statusCode, 200);
  assert.equal((await send('POST', `${base}/rejections/customers/retry`)).statusCode, 200);
  r = await upload(`${base}/rejections/invoices`, 'Invoice Number,Reason\r\nSA/24-25/0003,Customer not found\r\nSA/24-25/0001,Tax not found\r\n');
  assert.equal(r.json().linked, 2);
  const inv3 = (await get(`${base}/rejections`)).find(x => x.key === 'invoices' && x.ident === 'SA/24-25/0003');
  assert.equal((await send('POST', `${base}/rejections/${inv3.id}/corrections`, { rowNo: inv3.rows[0].rowNo, column: 'Notes', newValue: 'retry', reason: 'note' })).statusCode, 200);
  assert.equal((await send('POST', `${base}/rejections/invoices/retry`)).statusCode, 200);
  let rep = await get(`${base}/report`);
  assert.deepEqual(rep.rejections.map(x => [x.key, x.total, x.retried, x.corrections]), [['customers', 1, 1, 1], ['invoices', 2, 2, 1]]);
  // creating the files again with nothing changed keeps everything
  const clearedBefore = (await trail()).filter(x => /^rejections_cleared/.test(x));
  assert.ok(clearedBefore.some(x => /^rejections_cleared \| Customers: 2 rejection\(s\), 2 correction\(s\)/.test(x)), 'the rejections of the customised Customers file went when its layout was reset');
  await generate();
  assert.equal((await get(`${base}/rejections`)).length, 3);
  assert.equal((await call({ url: `${base}/rejections/invoices/retry/download` })).statusCode, 200, 'the retry file of an unchanged file is kept');
  assert.equal((await trail()).filter(x => /^rejections_cleared/.test(x)).length, clearedBefore.length, 'nothing was removed');
  // a change that alters only the Invoices file removes only its rejections
  // B6: IGST (alone on its invoice, so its tax goes on the line) instead of CGST, whose pair SGST is not mapped here
  await send('PUT', `${base}/tax-mappings`, { ledger: 'Output IGST', zohoTax: 'IGST 18' });
  await generate();
  rej = await get(`${base}/rejections`);
  assert.deepEqual(rej.map(x => [x.key, x.ident, x.status, x.rows[0].corrections.length]), [['customers', 'Kaveri Components', 'retried', 1]], 'the unchanged file keeps its rejection and correction');
  assert.equal((await call({ url: `${base}/rejections/invoices/retry/download` })).statusCode, 404, 'the retry file of the changed file is removed');
  assert.equal((await call({ url: `${base}/rejections/customers/retry/download` })).statusCode, 200);
  assert.ok((await trail()).includes('rejections_cleared | Invoices: 2 rejection(s), 1 correction(s) and the retry file were removed because the file was created again with different contents. If Zoho rejects rows of the new file, upload that rejection file.'));
  assert.equal((await send('POST', `${base}/rejections/invoices/retry`)).statusCode, 409, 'nothing is left to retry for the changed file');
  rep = await get(`${base}/report`);
  assert.deepEqual(rep.rejections.map(x => [x.key, x.total]), [['customers', 1]], 'the report does not show removed rejections');
  assert.equal((await get(`${base}/crosswalk?q=SA/24-25/0003`)).rows.find(x => x.module === 'Invoices').status, 'Pending');

  // ===== uploads, removals and processing again =====
  assert.equal((await send('DELETE', `${base}/uploads/units`)).statusCode, 200);
  m = await migration();
  assert.equal(m.filesOutOfDate, true);
  assert.equal(m.outOfDateReasons[0].reason, 'The uploaded file for Units of Measurement was removed.');
  // M6 (changed on purpose: 8 files). The one Manual Journal of this data is dated outside the financial year and is left
  // out by default, so there is no Manual Journals file any more: 7 files.
  // changed on purpose (held-vouchers batch): customer and vendor payments are Manual Journals now, so there is a
  // journals file of receipts and payments (other_journals): 8 files.
  assert.deepEqual([...m.outOfDateFiles].sort(), ['accounts', 'bills', 'customers', 'invoices', 'items', 'opening_balances', 'other_journals', 'vendors'], 'an upload change affects every file');
  assert.equal((await putFile(id, 'units', path.join(samples, FILES.units))).statusCode, 200);
  m = await migration();
  assert.deepEqual(m.outOfDateReasons.map(x => x.reason), ['The uploaded file for Units of Measurement was removed.', 'A new file was uploaded for Units of Measurement.']);
  r = await download('customers');
  assert.equal(r.statusCode, 409);
  assert.match(r.json().error, /Process the data and create the files again first\./);
  assert.equal((await send('PUT', `${base}/imports/accounts`, { status: 'imported' })).statusCode, 409);
  // processing again removes the files, and with them every rejection, correction and retry file
  assert.equal((await send('POST', `${base}/process`)).statusCode, 200);
  m = await migration();
  assert.deepEqual([m.filesOutOfDate, m.outOfDateReasons], [false, []], 'there are no files left to be out of date');
  assert.deepEqual(await get(`${base}/files`), []);
  assert.equal((await download('customers')).statusCode, 404);
  assert.deepEqual(await get(`${base}/rejections`), []);
  assert.equal((await call({ url: `${base}/rejections/customers/retry/download` })).statusCode, 404);
  assert.deepEqual((await get(`${base}/report`)).rejections, []);
  assert.ok((await trail()).some(x => /^rejections_cleared \| Customers: 1 rejection\(s\), 1 correction\(s\) and the retry file were removed because the data was processed again/.test(x)));
  // a decision made while there are no files is not "out of date"; the next files are simply built with it
  await send('PUT', `${base}/unit-mappings`, { tallyUnit: 'nos', zohoUnit: '' });
  assert.equal((await migration()).filesOutOfDate, false);
  await send('POST', `${base}/journals/accept-suggestions`);
  files = await generate();
  assert.equal(files.customers.sha256, files0.customers.sha256);
  assert.equal((await download('customers')).statusCode, 200);
  // M1 (changed on purpose). Processing the data again used to DELETE every journal routing decision, so "accept the
  // suggestions" had journals to accept again here and marked the voucher files out of date. The decisions now survive:
  // each is attached again to the same Tally voucher, and the run says how many were kept and which no longer match.
  const decidedBefore = (await get(`${base}/journals`)).filter(j => j.decision).map(j => [j.sourceId, j.decision]);
  assert.ok(decidedBefore.length > 0);
  const again = await send('POST', `${base}/process`);
  assert.equal(again.statusCode, 200, again.body);
  assert.deepEqual(again.json().journalDecisions, { kept: decidedBefore.length, lost: [] });
  assert.deepEqual((await get(`${base}/journals`)).filter(j => j.decision).map(j => [j.sourceId, j.decision]), decidedBefore, 'the same decision on the same voucher, although every record has a new id');
  assert.ok((await trail()).some(x => new RegExp(`^journal_decisions_kept \\| ${decidedBefore.length} journal routing decision\\(s\\) were kept`).test(x)));
  await generate();
  assert.equal((await send('POST', `${base}/journals/accept-suggestions`)).json().accepted, 0, 'nothing is left to accept');
  assert.equal((await migration()).filesOutOfDate, false);
  // a routing decision that differs from what the files were built with marks the voucher files it changes
  const routed = (await get(`${base}/journals`)).find(j => j.decision && j.decision !== 'Manual Journal');
  assert.equal((await send('PUT', `${base}/journals/${routed.id}`, { decision: 'Manual Journal' })).statusCode, 200);
  m = await migration();
  assert.equal(m.filesOutOfDate, true);
  assert.match(m.outOfDateReasons[0].reason, /^Journal voucher .* was routed to Manual Journal \(it was (Bill|Invoice)\)\.$/);
  await generate();

  // ===== a database made before these features =====
  const old = new DatabaseSync(path.join(process.env.DATA_DIR, 'migration.db'));
  const toHeadings = (key, data) => { const v = JSON.parse(data); return JSON.stringify(Object.fromEntries(defaultColumns(key).map(c => [c.heading, v[c.id]]))); };
  for (const g of old.prepare("SELECT rowid, key, row_data FROM generated_rows WHERE job_id = ? AND key IN ('customers','invoices')").all(id)) {
    old.prepare('UPDATE generated_rows SET row_data = ? WHERE rowid = ?').run(toHeadings(g.key, g.row_data), g.rowid);
  }
  old.prepare('UPDATE generated_files SET mapping_hash = NULL, columns = NULL, attestation = NULL WHERE job_id = ?').run(id);
  old.close();
  listed = Object.fromEntries((await get(`${base}/files`)).map(f => [f.key, f]));
  assert.deepEqual([listed.customers.mappingHash, listed.customers.headings, listed.customers.currentLayout, listed.customers.outOfDate], [null, null, null, false]);
  r = await upload(`${base}/rejections/customers`, 'Display Name,Error Message\r\nKaveri Components,Billing State is mandatory\r\n');
  assert.equal(r.json().linked, 1);
  kaveri = (await get(`${base}/rejections`)).find(x => x.key === 'customers');
  assert.deepEqual([kaveri.rows[0].values['Display Name'], kaveri.rows[0].values['Opening Balance'], kaveri.rows[0].valuesById.billing_state], ['Kaveri Components', '38900.00', 'Karnataka']);
  assert.equal((await send('POST', `${base}/rejections/${kaveri.id}/corrections`, { rowNo: kaveri.rows[0].rowNo, column: 'Billing State', newValue: 'KA', reason: 'state code' })).statusCode, 200);
  await send('POST', `${base}/rejections/customers/retry`);
  const retryRow = parseCsv((await call({ url: `${base}/rejections/customers/retry/download` })).body).rows[0];
  assert.deepEqual(['Display Name', 'Billing State', 'Billing Code', 'Opening Balance', 'GST Treatment'].map(h => retryRow[h]), ['Kaveri Components', 'KA', '560001', '38900.00', 'business_gst']);
  v = (await upload(`${base}/verification/invoices`, 'Invoice Number,Total\r\nSA/24-25/0001,"11,800.00"\r\n')).json();
  assert.deepEqual([v.matched, v.amountsCompared, v.amountsDiffering], [1, 1, 0], 'rows stored under the original headings are still read');
});
