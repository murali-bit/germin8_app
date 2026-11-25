// Real TallyPrime 7.1 master exports: file encodings, names in metadata.name, and one "All Masters" file split into
// the datasets. Every value used here is MADE UP (see fixtures/allMasters.js); only the structure copies a real export.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-allmasters-'));
const { buildApp } = await import('../src/index.js');
const { readTallyFile } = await import('../src/tallystream.js');
const { parseJsonFile, recordName, recordParent, detectEncoding } = await import('../src/tally.js');
const { latestEntry, contactInfo, groupTree, routeMaster } = await import('../src/masters.js');
const { fieldsNotRead } = await import('../src/fields.js');
const { parseCsv, CUSTOMER_HEADERS, CONTACT_ALWAYS_KEPT } = await import('../src/zoho.js');
const { doc, utf16le, RECORDS, NA } = await import('../fixtures/allMasters.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const samples = path.resolve(here, '../../sample-data');
const seed = JSON.parse(fs.readFileSync(path.resolve(here, '../seed-users.json'), 'utf8'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-enc-'));

// ---------- encodings ----------
// A record whose name has a character outside the Basic Multilingual Plane (a UTF-16 surrogate pair) and other
// non-ASCII text, so that a chunk boundary can fall inside a UTF-16 code unit, inside a surrogate pair, and inside
// a multi-byte UTF-8 character.
const tricky = { tallymessage: [
  { metadata: { type: 'Ledger', name: 'Gothic \u{10348} Traders' }, parent: 'Sundry Debtors', note: 'café "quoted" {braces} [brackets] \\ backslash' },
  { metadata: { type: 'Ledger', name: 'Rupee ₹ Mart' }, parent: 'Sundry Creditors' },
  { metadata: { type: 'Group', name: 'Plain Group' } },
] };
const encodings = {
  'UTF-8': t => Buffer.from(t, 'utf8'),
  'UTF-8 with BOM': t => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(t, 'utf8')]),
  'UTF-16 LE with BOM': t => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(t, 'utf16le')]),
  'UTF-16 LE without BOM': t => Buffer.from(t, 'utf16le'),
  'UTF-16 BE with BOM': t => { const b = Buffer.from(t, 'utf16le'); b.swap16(); return Buffer.concat([Buffer.from([0xfe, 0xff]), b]); },
  'UTF-16 BE without BOM': t => { const b = Buffer.from(t, 'utf16le'); b.swap16(); return b; },
};

test('Tally files are read in UTF-8, UTF-16 LE and UTF-16 BE, with or without a byte order mark, in any chunk size', () => {
  const text = JSON.stringify(tricky, null, 1);
  const expectEnc = { 'UTF-8': 'utf8', 'UTF-8 with BOM': 'utf8', 'UTF-16 LE with BOM': 'utf16le', 'UTF-16 LE without BOM': 'utf16le', 'UTF-16 BE with BOM': 'utf16be', 'UTF-16 BE without BOM': 'utf16be' };
  for (const [label, make] of Object.entries(encodings)) {
    const buf = make(text);
    assert.equal(detectEncoding(buf.subarray(0, 4)).encoding, expectEnc[label], label);
    assert.deepEqual(parseJsonFile(buf), tricky, `whole-file reader, ${label}`);
    const file = path.join(tmp, `${label.replace(/\W+/g, '_')}.json`);
    fs.writeFileSync(file, buf);
    // chunks of 1 and 3 bytes split every UTF-16 code unit; 5 and 7 split surrogate pairs and UTF-8 sequences at many places
    for (const chunkSize of [1, 2, 3, 5, 7, 64, 1024 * 1024]) {
      const records = [];
      let end = null;
      for (const ev of readTallyFile(file, { chunkSize })) { if (ev.type === 'record') records.push(ev.value); else if (ev.type === 'end') end = ev; }
      assert.deepEqual(records, tricky.tallymessage, `${label}, chunks of ${chunkSize}`);
      assert.equal(end.encoding, expectEnc[label]);
    }
  }
  // the boundary falls exactly between the two halves of the surrogate pair: chunk size = the byte offset of the low half
  const le = encodings['UTF-16 LE with BOM'](text);
  const at = le.indexOf(Buffer.from('\u{10348}', 'utf16le').subarray(2)) - 2; // bytes after the BOM up to the low surrogate
  const file = path.join(tmp, 'split_pair.json');
  fs.writeFileSync(file, le);
  for (const chunkSize of [at, at - 1, at + 1]) {
    const names = [...readTallyFile(file, { chunkSize })].filter(e => e.type === 'record').map(e => e.value.metadata.name);
    assert.equal(names[0], 'Gothic \u{10348} Traders', `chunk ${chunkSize}`);
  }
  // a larger UTF-16 file is streamed: written and read piece by piece, never as one string
  const big = path.join(tmp, 'big16.json');
  const fd = fs.openSync(big, 'w');
  fs.writeSync(fd, Buffer.from([0xff, 0xfe]));
  fs.writeSync(fd, Buffer.from('{"tallymessage":[', 'utf16le'));
  const N = 30000;
  for (let i = 0; i < N; i++) fs.writeSync(fd, Buffer.from(`${i ? ',' : ''}{"metadata":{"type":"Ledger","name":"Ledger \u{10348} ${i}"},"parent":"Sundry Debtors"}`, 'utf16le'));
  fs.writeSync(fd, Buffer.from(']}', 'utf16le'));
  fs.closeSync(fd);
  let count = 0, last = null;
  for (const ev of readTallyFile(big, { chunkSize: 65537 })) if (ev.type === 'record') { count++; last = ev.value; }
  assert.equal(count, N);
  assert.equal(recordName(last), `Ledger \u{10348} ${N - 1}`);

  // broken UTF-16 JSON is still reported as broken
  const broken = path.join(tmp, 'broken16.json');
  fs.writeFileSync(broken, encodings['UTF-16 LE with BOM']('{"tallymessage":[{"a":1},'));
  assert.throws(() => [...readTallyFile(broken, { chunkSize: 3 })], /ends in the middle of the "tallymessage" list/);
});

test('names, dated details and routing helpers', () => {
  const byName = Object.fromEntries(RECORDS.map(r => [recordName(r), r]));
  assert.equal(recordName({ name: 'Top', metadata: { name: 'Meta' } }), 'Top', 'a top-level name wins');
  assert.equal(recordName({ name: '', metadata: { name: 'Meta' } }), 'Meta');
  assert.equal(recordName({ metadata: { type: 'Ledger' }, languagename: [{ name: [{ metadata: true }, 'From List', 'Alias'] }] }), 'From List');
  assert.equal(recordName({ metadata: { name: NA } }), '', 'the "not applicable" marker is no name');
  assert.equal(recordParent(byName['Pine Hill Stores']), 'Hill Region Debtors');

  // the latest entry on or before the date; the earliest when all are later; an undated entry counts as the earliest
  const list = [{ applicablefrom: '20200401', v: 'a' }, { applicablefrom: '20240601', v: 'b' }, { applicablefrom: '20260101', v: 'c' }];
  assert.equal(latestEntry(list, '20250331').v, 'b');
  assert.equal(latestEntry(list, null).v, 'c');
  assert.equal(latestEntry(list, '20190101').v, 'a');
  assert.equal(latestEntry([{ v: 'undated' }, { applicablefrom: '20240101', v: 'dated' }], '20250331').v, 'dated');

  const c = contactInfo(byName['Maple Leaf Traders'], '20250331');
  assert.deepEqual([c.mailingName, c.address, c.state, c.pincode, c.country, c.gstin, c.registrationType, c.placeOfSupply, c.pan, c.phone, c.openingBalance, c.legacy],
    ['Maple Leaf Traders Pvt Ltd', ['22 New Street', 'Block B', 'Sample City'], 'Karnataka', '560099', 'India', '29ABCDE1234F1Z5', 'Regular', 'Karnataka', 'ABCDE1234F', '9800000001', '-1500.00', []]);
  const p = contactInfo(byName['Pine Hill Stores'], '20250331');
  assert.deepEqual([p.state, p.gstin, p.legacy], ['Goa', '30PQRSX9876K1Z2', ['oldledstatename']], 'legacy fields only as a fallback, and said so');
  // the sample-file shape still works
  assert.deepEqual(contactInfo({ name: 'S', mailingname: 'S Ltd', address: [{ metadata: true }, 'L1'], ledstatename: 'Gujarat', pincode: '380001', countryname: 'India' }, '20250331'),
    { name: 'S', mailingName: 'S Ltd', address: ['L1'], state: 'Gujarat', pincode: '380001', country: 'India', gstin: '', registrationType: '', placeOfSupply: '', pan: '', email: '', phone: '', mobile: '', openingBalance: '',
      creditPeriod: '', currency: '', sez: false, legacy: [], cleaned: [], dated: [], gstinConflict: null, registrationUnknown: false });

  const tree = groupTree(RECORDS.filter(r => r.metadata.type === 'Group'));
  const route = name => routeMaster(byName[name], tree);
  assert.deepEqual(['Maple Leaf Traders', 'Pine Hill Stores', 'Birch Supplies', 'Cedar Job Works', 'Output CGST', 'Staff Tea Expenses', 'Profit & Loss A/c', 'Hill Region Debtors', 'Brass Valve 15mm', 'Main Location'].map(route),
    [['customers', 'accounts'], ['customers', 'accounts'], ['vendors', 'accounts'], ['vendors', 'accounts'], ['taxes', 'accounts'], ['accounts'], ['accounts'], ['accounts'], ['stock_items'], []]);
  // a renamed Tally group is still recognised by its reserved name
  const renamed = groupTree([{ metadata: { type: 'Group', name: 'Trade Receivables', reservedname: 'Sundry Debtors' }, parent: 'Current Assets' }]);
  assert.equal(renamed.sectionOf('Trade Receivables'), 'customers');

  // fields inside the dated lists count as read when they are used; others are reported with their path
  const unread = fieldsNotRead([byName['Maple Leaf Traders']], 'customers').fields.map(f => f.name);
  assert.ok(!unread.some(f => /^(ledmailingdetails|ledgstregdetails)\.(state|gstin|pincode|address|mailingname|placeofsupply|applicablefrom)$/.test(f)), unread.join(', '));
  assert.ok(unread.includes('ledgstregdetails.iscommonparty') && unread.includes('billallocations') && unread.includes('contactdetails.name'), unread.join(', '));
  assert.ok(!unread.includes('languagename') && !unread.includes('metadata'), 'the name in metadata.name is read; languagename then only holds the same name');
});

// ---------- the All Masters upload, end to end ----------
const app = buildApp();
let cookie = '';
const call = opts => app.inject({ ...opts, headers: { ...(opts.headers || {}), ...(cookie ? { cookie } : {}) } });
const get = async url => { const r = await call({ url }); assert.equal(r.statusCode, 200, `${url}: ${r.body}`); return r.json(); };
const putBody = (id, slot, body, name) => call({ method: 'PUT', url: `/api/migrations/${id}/uploads/${slot}`, headers: { 'content-type': 'application/octet-stream', 'x-filename': name }, payload: body });
const putFile = (id, slot, file) => putBody(id, slot, fs.readFileSync(file), path.basename(file));
const csvRows = async (id, key) => { const r = await call({ url: `/api/migrations/${id}/files/${key}/download?confirmed=1` }); assert.equal(r.statusCode, 200, r.body); return parseCsv(r.body).rows; };

test('one All Masters file (UTF-16, real TallyPrime structure) is split into the datasets and reaches the Zoho files', async () => {
  const u = seed.users.find(x => x.role === 'analyst');
  const lr = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: u.password } });
  cookie = String(lr.headers['set-cookie']).split(';')[0];
  const id = (await call({ method: 'POST', url: '/api/migrations', payload: { company: 'Sample Masters Co', financialYear: '2024-25' } })).json().id;
  const base = `/api/migrations/${id}`;
  // a company with a GSTIN has the HSN/SAC field on in Zoho by default; this migration has none, so say it is on
  assert.equal((await call({ method: 'PUT', url: `${base}/voucher-settings`, payload: { hsnEnabled: 'on' } })).statusCode, 200);

  // a voucher file is not an All Masters file
  let r = await putFile(id, 'all_masters', path.join(samples, '07_sales_vouchers.json'));
  assert.equal(r.statusCode, 422);
  assert.match(r.json().error, /does not look like an All Masters export/);

  const body = utf16le(doc());
  r = await putBody(id, 'all_masters', body, 'Master.json');
  assert.equal(r.statusCode, 200, r.body);
  const up = r.json();
  assert.equal(up.encoding, 'utf16le');
  assert.equal(up.records, RECORDS.length);
  const ds = Object.fromEntries(up.datasets.map(d => [d.slot, d]));
  assert.deepEqual(Object.fromEntries(Object.entries(ds).map(([k, d]) => [k, d.mainRecords])), { customers: 2, vendors: 2, accounts: 8, taxes: 1, stock_items: 2 }); // every ledger is also in the Chart of Accounts
  assert.equal(ds.accounts.groups, 10, 'every Group record goes to the Chart of Accounts');
  // record types the platform does not use are listed, never an error
  assert.deepEqual(Object.fromEntries(up.notUsed.map(x => [x.type, x.records])),
    { Currency: 1, 'TDS Rate': 1, 'Cost Category': 1, IncomeTaxClassification: 2, IncomeTaxSlab: 1, TaxUnit: 1, Godown: 1 });
  // changed on purpose: Voucher Type records are no longer "not used". They are kept to sort vouchers of the company's own voucher types.
  assert.equal(up.voucherTypes, 2);
  // no Unit records: Units is marked not applicable automatically, with the reason
  assert.deepEqual(up.autoNotApplicable.map(x => x.slot), ['units']);
  assert.ok(up.messages.some(m => /Units of Measurement: marked not applicable automatically/.test(m)));
  // a customer under a custom sub-group of Sundry Debtors is not reported as "not directly under"
  assert.ok(!up.warnings.some(w => /not directly under/.test(w)), up.warnings.join(' | '));
  // the real field names are recognised: no key-field warning about the name
  assert.ok(!up.warnings.some(w => /"name"/.test(w)), up.warnings.join(' | '));
  assert.ok(up.warnings.some(w => /Stock Items: in all 2 StockItem records the field "baseunits" is "Not Applicable" in Tally/.test(w)) === false, 'one item has a unit');

  let comp = await get(`${base}/completeness`);
  const slot = k => comp.slots.find(s => s.key === k);
  assert.deepEqual(['customers', 'vendors', 'accounts', 'taxes', 'stock_items'].map(k => [slot(k).status, slot(k).upload.fromAllMasters]), Array(5).fill(['uploaded', true]));
  assert.deepEqual([slot('units').status, slot('units').autoNotApplicable], ['not_applicable', true]);
  assert.match(slot('units').waiver.reason, /^Set automatically: the All Masters file "Master.json" has no Unit records\. Its stock items name 1 unit/);
  assert.equal(comp.allMasters.fileName, 'Master.json');
  assert.equal(comp.allMasters.sha256, up.sha256);
  assert.equal(comp.allMasters.encodingName, 'UTF-16 (little endian)');
  assert.deepEqual(comp.allMasters.datasets.map(d => [d.slot, d.mainRecords, d.current]), [['customers', 2, true], ['vendors', 2, true], ['accounts', 8, true], ['taxes', 1, true], ['stock_items', 2, true]]);
  assert.equal(slot('customers').upload.sha256, up.sha256, 'each dataset carries the checksum of the file it came from');
  // the counts compare with what Tally shows
  r = await call({ method: 'PUT', url: `${base}/expected-counts/customers`, payload: { expected: 2 } });
  assert.equal(r.json().countMatches, true);

  // the rest of the datasets from the made-up sample files, then process and create the files
  const others = { sales: '07_sales_vouchers.json', purchase: '08_purchase_vouchers.json', receipt: '09_receipt_vouchers.json', payment: '10_payment_vouchers.json', journal: '11_journal_vouchers.json', trial_balance: '13_trial_balance.json' };
  for (const [k, f] of Object.entries(others)) assert.equal((await putFile(id, k, path.join(samples, f))).statusCode, 200);
  await call({ method: 'PUT', url: `${base}/waivers/stock_summary`, payload: { reason: 'Not needed for test' } });
  r = await call({ method: 'POST', url: `${base}/process?wait=1` });
  assert.equal(r.statusCode, 200, r.body);
  const sum = Object.fromEntries(r.json().summary.map(s => [s.slot, s]));
  assert.deepEqual([sum.customers.stored, sum.vendors.stored, sum.accounts.stored, sum.taxes.stored, sum.stock_items.stored], [2, 2, 18, 1, 2]);
  const noName = (await get(`${base}/summary`)).exceptions.filter(e => /has no name/.test(e.message));
  assert.equal(noName.length, 0, 'every master has a name (from metadata.name)');

  // Data Explorer: the name and contact details as the platform reads them
  const recs = (await get(`${base}/records?slot=customers`)).records;
  assert.deepEqual(recs.map(x => x.name), ['Maple Leaf Traders', 'Pine Hill Stores']);
  assert.deepEqual([recs[0].view.state, recs[0].view.gstin, recs[1].view.parent], ['Karnataka', '29ABCDE1234F1Z5', 'Hill Region Debtors']);

  // the sub-group decides the account type; the reserved P&L ledger has no group and needs a decision
  const at = await get(`${base}/account-types`);
  assert.equal(at.groups.find(g => g.group === 'Staff Welfare Costs').zohoType, 'Expense');
  assert.ok(!at.groups.some(g => g.group === '(none)' || !g.group), 'a ledger with no group (Profit & Loss A/c) asks for no decision that cannot apply');

  r = await call({ method: 'POST', url: `${base}/generate` });
  assert.equal(r.statusCode, 200, r.body);
  const cust = Object.fromEntries((await csvRows(id, 'customers')).map(x => [x['Display Name'], x]));
  // v2 (changed on purpose): a column Tally has no value for is left out of the file when it is empty on every row, unless Zoho's import needs it
  assert.ok(!('Customer Number' in cust['Maple Leaf Traders']) && 'Place Of Contact' in cust['Maple Leaf Traders'] && 'Opening Balance' in cust['Maple Leaf Traders']);
  assert.deepEqual({ ...Object.fromEntries(CUSTOMER_HEADERS.map(h => [h, ''])), ...cust['Maple Leaf Traders'] }, {
    ...Object.fromEntries(CUSTOMER_HEADERS.map(h => [h, ''])),
    'Display Name': 'Maple Leaf Traders', 'Company Name': 'Maple Leaf Traders Pvt Ltd', 'GST Identification Number (GSTIN)': '29ABCDE1234F1Z5', 'PAN Number': 'ABCDE1234F',
    'Currency Code': 'INR', Phone: '9800000001', 'Billing Address': '22 New Street', 'Billing Street2': 'Block B, Sample City', 'Billing State': 'Karnataka', 'Billing Code': '560099',
    'Billing Country': 'India', 'Opening Balance': '1500.00', 'GST Treatment': 'business_gst', 'Place Of Contact': 'KA', Status: 'Active',
  }, 'the latest mailing details on or before 31 March 2025 (not the later one), GSTIN, PAN and the rest');
  assert.deepEqual([cust['Pine Hill Stores']['Billing State'], cust['Pine Hill Stores']['GST Identification Number (GSTIN)']], ['Goa', '30PQRSX9876K1Z2']);
  const vend = (await csvRows(id, 'vendors')).map(x => x['Display Name']);
  assert.deepEqual(vend, ['Birch Supplies', 'Cedar Job Works']);
  const coa = Object.fromEntries((await csvRows(id, 'accounts')).map(x => [x['Account Name'], x]));
  // customers and vendors (also under custom sub-groups) are Zoho contacts, not accounts: they are left out
  // v2 default 1 (changed on purpose: 'Output CGST' was in this list). "Output CGST" is the name of an account Zoho
  // creates itself, so with no decision Zoho's own account is used and the ledger is not written here.
  assert.deepEqual(Object.keys(coa), ['Staff Tea Expenses', 'Bank of Example'],
    'every ledger except customers, vendors, the reserved Profit & Loss A/c and the one named like one of Zoho\'s own accounts is in the Chart of Accounts');
  assert.deepEqual((await get(`${base}/summary`)).exceptions.filter(e => e.kind === 'default_zoho_own_account').map(e => e.name), ['Output CGST']);
  const pl = (await get(`${base}/summary`)).exceptions.filter(e => e.stage === 'generate' && /^profit_and_loss/.test(e.kind || ''));
  assert.deepEqual(pl.map(e => [e.kind, e.name]), [['profit_and_loss_ledger_left_out', 'Profit & Loss A/c']], 'left out and said so; no balance, so nothing to enter');
  assert.match((await get(`${base}/files`)).find(f => f.key === 'accounts').notes, /Profit & Loss A\/c ledger is not in this file/);
  assert.match((await get(`${base}/files`)).find(f => f.key === 'accounts').notes, /2 customer ledger\(s\) \(Sundry Debtors\) and 2 vendor ledger\(s\) \(Sundry Creditors\) are Zoho contacts/);
  // tax ledgers take the standard type and are flagged; sub-groups inherit
  assert.deepEqual([coa['Staff Tea Expenses']['Account Type'], coa['Bank of Example']['Account Type']], ['Expense', 'Bank']);
  assert.equal(coa['Staff Tea Expenses'].Description, 'Tally group: Staff Welfare Costs', 'the Tally group is kept in Description when Tally has none');
  assert.deepEqual([coa['Staff Tea Expenses']['Parent Account'], coa['Staff Tea Expenses']['Opening Balance'], coa['Staff Tea Expenses']['Debit or Credit']], ['', '', '']);
  const items = Object.fromEntries((await csvRows(id, 'items')).map(x => [x['Item Name'], x]));
  assert.deepEqual([items['Copper Pipe 1m']['Usage unit'], items['Copper Pipe 1m']['HSN/SAC'], items['Brass Valve 15mm']['Usage unit'], items['Brass Valve 15mm']['HSN/SAC']], ['nos', '74111000', '', '']);
  const gen = (await get(`${base}/summary`)).exceptions.filter(e => e.stage === 'generate');
  assert.ok(gen.some(e => e.name === 'Brass Valve 15mm' && /Stock item has no unit\. The HSN code is not on the item: Tally says "As per Company\/Stock Group"/.test(e.message)));

  // a file uploaded on its own later replaces that one dataset only, and says so
  r = await putFile(id, 'customers', path.join(samples, '01_customers.json'));
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().replacedAllMasters, 'Master.json');
  assert.match(r.json().warnings[0], /This file replaces the Customer Master records that came from the All Masters file "Master\.json"/);
  comp = await get(`${base}/completeness`);
  assert.equal(slot('customers').upload.fromAllMasters, false);
  assert.equal(slot('vendors').upload.fromAllMasters, true);
  assert.deepEqual(comp.allMasters.datasets.find(d => d.slot === 'customers'), { slot: 'customers', name: 'Customer Master', records: 2, mainRecords: 2, groups: 0, current: false, replacedBy: '01_customers.json', removed: false });

  // and the All Masters file uploaded again replaces it again, with a clear message
  r = await putBody(id, 'all_masters', body, 'Master.json');
  assert.ok(r.json().messages.some(m => /Customer Master: the file uploaded on its own earlier \("01_customers\.json"\) was replaced/.test(m)));
  comp = await get(`${base}/completeness`);
  assert.equal(slot('customers').upload.fromAllMasters, true);

  // removing the All Masters file removes the datasets that came from it and its automatic "not applicable"
  r = await call({ method: 'DELETE', url: `${base}/uploads/all_masters` });
  assert.equal(r.statusCode, 200);
  comp = await get(`${base}/completeness`);
  assert.deepEqual(['customers', 'vendors', 'accounts', 'taxes', 'stock_items', 'units'].map(k => slot(k).status), ['missing', 'missing', 'missing', 'missing', 'missing', 'missing']);
  assert.equal(slot('sales').status, 'uploaded', 'voucher files are untouched');
  assert.equal(comp.allMasters, null);
  const trail = (await get(`${base}/audit`)).map(a => `${a.action} | ${a.detail}`);
  assert.ok(trail.some(t => /^upload_all_masters \| Master\.json, \d+ records \(UTF-16 \(little endian\)\), sha256 [a-f0-9]{12}: Customer Master 2 customers, Vendor Master 2 vendors/.test(t)), trail.join('\n'));
});

test('separate dataset files in the real TallyPrime shape (UTF-16, metadata.name only) also work', async () => {
  const id = (await call({ method: 'POST', url: '/api/migrations', payload: { company: 'Sample Masters Co', financialYear: '2024-25' } })).json().id;
  const groups = RECORDS.filter(m => m.metadata.type === 'Group' || m.metadata.type === 'Ledger' && ['Staff Tea Expenses', 'Bank of Example'].includes(m.metadata.name));
  const r = await putBody(id, 'accounts', utf16le({ tallymessage: groups }), 'accounts.json');
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual([r.json().recordTypes, r.json().actualCount], [{ Group: 10, Ledger: 2 }, 2]);
  assert.ok(!r.json().warnings.length, r.json().warnings.join(' | '));
  const items = await putBody(id, 'stock_items', utf16le({ tallymessage: RECORDS.filter(m => m.metadata.type === 'Stock Item') }), 'items.json');
  assert.equal(items.statusCode, 200, items.body);
  assert.deepEqual(items.json().recordTypes, { StockItem: 2 }, '"Stock Item" is read as a stock item');
});
