// The four master files follow the official Zoho Books (India) sample import files, and their values are written in
// the formats Zoho accepts. The headings are compared with the official sample files themselves when they are present
// in zoho-samples/ (they are public Zoho material); every other value used here is MADE UP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-zohotpl-'));
const { buildApp } = await import('../src/index.js');
const { TEMPLATES, CUSTOMER_HEADERS, VENDOR_HEADERS, ACCOUNT_HEADERS, ITEM_HEADERS, ZOHO_ACCOUNT_TYPES, gstTreatment, placeOfContact, paymentTerms, parseCsv } = await import('../src/zoho.js');
const { stateCode, gstinStateCode, GST_TREATMENTS, STATE_CODES } = await import('../src/zohocodes.js');
const { defaultColumns, checkColumns } = await import('../src/columns.js');
const { utf16le } = await import('../fixtures/allMasters.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const ZOHO_SAMPLES = path.resolve(here, '../../zoho-samples');
const samples = path.resolve(here, '../../sample-data');
const RULES_LISTS = JSON.parse(fs.readFileSync(path.resolve(here, '../src/zohorules.json'), 'utf8')).lists;
const seed = JSON.parse(fs.readFileSync(path.resolve(here, '../seed-users.json'), 'utf8'));

// ---------- reading the official sample files ----------
// The first line of a CSV file, split into cells exactly as written (quotes removed, nothing trimmed).
function csvHeadings(file) {
  let text = fs.readFileSync(file, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const out = []; let cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c; }
    else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cell); cell = ''; }
    else if (c === '\r' || c === '\n') break;
    else cell += c;
  }
  out.push(cell);
  return out;
}
// A file from a zip archive (an .xlsx workbook, which Zoho names .xls).
function unzip(file, name) {
  const buf = fs.readFileSync(file);
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const entry = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (entry === name) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      return (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`${name} not found in ${file}`);
}
const xmlText = s => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
// The headings (first row) of the first sheet ("Sample Data") of an .xlsx workbook.
function xlsxHeadings(file) {
  const shared = [...unzip(file, 'xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => xmlText([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')));
  const sheet = unzip(file, 'xl/worksheets/sheet1.xml');
  const row = sheet.match(/<row [^>]*r="1"[^>]*>([\s\S]*?)<\/row>/)[1];
  const out = [];
  for (const m of row.matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const ref = m[1].match(/r="([A-Z]+)1"/)[1];
    const col = [...ref].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    const type = (m[1].match(/t="([^"]+)"/) || [])[1];
    const v = (m[2] || '').match(/<v>([\s\S]*?)<\/v>/)?.[1];
    out[col] = type === 's' ? shared[Number(v)] : type === 'inlineStr' ? xmlText((m[2] || '').match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] || '') : xmlText(v ?? '');
  }
  while (out.length && (out[out.length - 1] == null || out[out.length - 1] === '')) out.pop();
  return out;
}

const OFFICIAL = { customers: ['customer_import_sample_data.xls', xlsxHeadings], vendors: ['vendor_import_sample_data.xls', xlsxHeadings], accounts: ['sample_accounts.csv', csvHeadings], items: ['sample_items2.csv', csvHeadings] };

// v2 (changed on purpose, docs/ZOHO_IMPORT_RULES.md): a file's headings no longer have to be ALL of the sample's. They
// must be a subset of the sample's headings, in the sample's order, byte for byte. Customers, Vendors and Chart of
// Accounts still carry every heading; Items leaves out "CF.custom_field" (a custom field of Zoho's demo organisation).
const subsetInOrder = (ours, official) => { let i = 0; for (const h of official) if (h === ours[i]) i++; return i === ours.length; };
test('the default headings of the four master files are the official Zoho sample headings, byte for byte and in order', t => {
  assert.deepEqual([CUSTOMER_HEADERS.length, VENDOR_HEADERS.length, ACCOUNT_HEADERS.length, ITEM_HEADERS.length], [62, 64, 9, 28]);
  assert.ok(!ITEM_HEADERS.includes('CF.custom_field'), "the custom field of Zoho's demo organisation is left out of the Items file");
  assert.ok(ACCOUNT_HEADERS.includes('Account # '), 'the Chart of Accounts heading keeps its trailing space');
  assert.ok(VENDOR_HEADERS.includes('Department') && VENDOR_HEADERS.includes('CustomField Value1'), "Zoho's own spellings in the vendor sample are kept");
  for (const [key, [file]] of Object.entries(OFFICIAL)) {
    assert.deepEqual([TEMPLATES[key].verified, TEMPLATES[key].sampleFile], [true, file], `${key} is marked as checked against ${file}`);
    assert.deepEqual(defaultColumns(key).map(c => c.heading), TEMPLATES[key].headers);
  }
  assert.equal(TEMPLATES.opening_balances.referenceOnly, true);
  const present = Object.values(OFFICIAL).every(([file]) => fs.existsSync(path.join(ZOHO_SAMPLES, file)));
  if (!present) { t.skip(`the official sample files are not in ${ZOHO_SAMPLES}`); return; }
  for (const [key, [file, read]] of Object.entries(OFFICIAL)) {
    const official = read(path.join(ZOHO_SAMPLES, file));
    const leftOut = key === 'items' ? ['CF.custom_field'] : [];
    // Zoho's Map Fields spelling (lists.map_field_labels) replaces the sample's first-row heading where the two differ
    const label = h => (RULES_LISTS.map_field_labels.labels.find(l => l.module === key && l.sample_heading === h)?.zoho_label) ?? h;
    assert.deepEqual(TEMPLATES[key].headers, official.filter(h => !leftOut.includes(h)).map(label), `${key}: the headings of ${file}${leftOut.length ? `, without ${leftOut.join(', ')}` : ''}`);
    assert.ok(subsetInOrder(TEMPLATES[key].headers.map(h => Buffer.from(h).toString('hex')), official.map(label).map(h => Buffer.from(h).toString('hex'))), `${key}: a subset of the sample's headings, in its order, byte for byte`);
  }
  assert.equal(subsetInOrder(['b', 'a'], ['a', 'b']), false, 'the check refuses another order');
  assert.equal(subsetInOrder(['a', 'x'], ['a', 'b']), false, 'and a heading that is not in the sample');
});

test('GST Treatment: Tally registration types become Zoho codes; a registered party without a valid GSTIN is left empty and flagged', () => {
  const c = (registrationType, gstin = '', extra = {}) => ({ registrationType, gstin, country: 'India', registrationUnknown: false, sez: false, ...extra });
  const g = (...a) => gstTreatment(c(...a));
  assert.deepEqual(g('Regular', '29ABCDE1234F1ZW'), { value: 'business_gst', problem: null });
  assert.deepEqual(g('Regular', '29ABCDE1234F1ZW', { sez: true }), { value: 'business_sez', problem: null });
  assert.deepEqual(g('Composition', '29ABCDE1234F1ZW'), { value: 'business_registered_composition', problem: null });
  for (const t of ['Unregistered', 'Consumer', 'Unregistered/Consumer']) assert.deepEqual(g(t), { value: 'business_none', problem: null }, t);
  assert.deepEqual(g('Unregistered/Consumer', '', { country: 'United States of America' }), { value: 'overseas', problem: null });
  assert.deepEqual(g('', '', { country: 'Oman', registrationUnknown: true }), { value: 'overseas', problem: null }, 'no registration and a foreign country: overseas');
  // v2 default 4 (changed on purpose): registered in Tally with no GSTIN is written AS IN TALLY and flagged; it is not
  // left empty and never turned into unregistered by default
  assert.deepEqual([g('Regular').value, g('Regular').problem.kind], ['business_gst', 'gst_registered_without_gstin']);
  assert.match(g('Composition').problem.message, /written as in Tally \(GST Treatment business_registered_composition, no GSTIN\)\. Zoho Books may reject a registered party without a GSTIN/);
  assert.deepEqual(g('Regular', '29ABCDE'), { value: '', problem: null }, 'an invalid GSTIN: empty (the gstin_format flag says why)');
  // v2 default 4 (changed on purpose): a valid GSTIN means registered, whatever Tally says; flagged when it differs from Tally
  for (const [type, extra] of [['Unregistered', {}], ['Consumer', {}], ['Embassy', {}], ['', {}], ['', { registrationUnknown: true }]]) {
    const u = g(type, '29ABCDE1234F1ZW', extra);
    assert.deepEqual([u.value, u.problem, u.assumed.kind], ['business_gst', null, 'gst_registered_from_gstin'], `"${type}" with a valid GSTIN`);
  }
  assert.match(g('Unregistered', '29ABCDE1234F1ZW').assumed.message, /Tally says the GST registration type is "Unregistered", but the party has a valid GSTIN, so it is written as registered/);
  assert.equal(g('Unregistered', '29ABCDE1234F1ZW', { sez: true }).value, 'business_sez');
  assert.equal(gstTreatment({ ...c('Unregistered', '29ABCDE1234F1ZW'), treatmentOverride: 'unregistered' }).value, 'business_none', 'a decision in Fix contacts wins over the default');
  assert.equal(gstTreatment(c('Consumer', '29ABCDE1234F1ZW'), 'help').value, 'business_registered_regular', 'the registered-regular code of the chosen set');
  assert.deepEqual([g('Unregistered', '29ABCDE').value, g('Unregistered', '29ABCDE').problem.kind], ['', 'gst_unregistered_with_gstin'], 'a GSTIN that is not valid proves nothing');
  assert.deepEqual([g('', '', { registrationUnknown: true }).value, g('', '', { registrationUnknown: true }).problem.kind], ['', 'gst_registration_unknown']);
  assert.deepEqual([g('').value, g('').problem.kind], ['', 'gst_treatment_not_set']);
  assert.deepEqual([g('Embassy').value, g('Embassy').problem.kind], ['', 'gst_treatment_not_mapped']);
  // every code written is one of the values allowed by the official samples
  for (const v of ['business_gst', 'business_sez', 'business_registered_composition', 'business_none', 'overseas']) assert.ok(GST_TREATMENTS.includes(v));
});

test('Place Of Contact / Source Of Supply: two-letter Zoho state codes; a state with no code is left empty and flagged', () => {
  // changed on purpose (docs/ZOHO_IMPORT_RULES.md 10.2): Zoho's help page adds LA (Ladakh) and OT (Other Territory) to
  // the 36 codes of the sample files, and gives DN for the merged Dadra and Nagar Haveli and Daman and Diu
  assert.equal(Object.keys(STATE_CODES).length, 38);
  assert.deepEqual(['Karnataka', 'West Bengal', 'Jammu & Kashmir', 'Andaman & Nicobar Islands', 'Orissa', 'Pondicherry', 'Telangana', 'Uttarakhand', 'Uttaranchal', 'Delhi', 'Odisha', 'Chhattisgarh', 'ka', 'TN'].map(stateCode),
    ['KA', 'WB', 'JK', 'AN', 'OD', 'PY', 'TS', 'UK', 'UK', 'DL', 'OD', 'CG', 'KA', 'TN']);
  assert.deepEqual(['Ladakh', 'Dadra & Nagar Haveli and Daman & Diu', 'Other Territory', 'Daman & Diu'].map(stateCode), ['LA', 'DN', 'OT', 'DD']);
  assert.deepEqual(['Atlantis', ''].map(stateCode), ['', ''], 'nothing is guessed');
  assert.deepEqual([gstinStateCode('29ABCDE1234F1ZW'), gstinStateCode('27ABCDE1234F1Z0'), gstinStateCode('38ABCDE1234F1ZX'), gstinStateCode('97ABCDE1234F1ZT'), gstinStateCode('99ABCDE1234F1ZP')], ['KA', 'MH', 'LA', 'OT', '']);
  const base = { placeOfSupply: '', state: '', gstin: '' };
  assert.deepEqual(placeOfContact({ ...base, placeOfSupply: 'Karnataka', state: 'Goa' }, 'business_gst'), { value: 'KA', problem: null }, 'the place of supply first');
  assert.deepEqual(placeOfContact({ ...base, state: 'Goa' }, 'business_none'), { value: 'GA', problem: null });
  // v2 default 5 (changed on purpose): the state of the GSTIN is still written when Tally has no state, and is now
  // listed as an assumption
  const fromGstin = placeOfContact({ ...base, gstin: '27ABCDE1234F1Z0' }, 'business_gst');
  assert.deepEqual([fromGstin.value, fromGstin.problem, fromGstin.assumed.kind], ['MH', null, 'state_from_gstin'], 'the state of the GSTIN when Tally has no state');
  assert.match(fromGstin.assumed.message, /Tally has no state and no place of supply for this party, so the state of the GSTIN \(code MH, Maharashtra\) is written/);
  assert.deepEqual(placeOfContact({ ...base, state: 'Ohio' }, 'overseas'), { value: '', problem: null }, 'no place of contact for an overseas party');
  assert.equal(placeOfContact(base, 'business_none').problem.kind, 'place_of_contact_missing');
  assert.equal(placeOfContact({ ...base, state: 'Atlantis' }, 'business_none').problem.kind, 'state_not_mapped');
  const unmappedWithGstin = placeOfContact({ ...base, state: 'Atlantis', gstin: '27ABCDE1234F1Z0' }, 'business_gst');
  assert.deepEqual([unmappedWithGstin.value, unmappedWithGstin.assumed.kind], ['MH', 'state_from_gstin'], 'a state with no Zoho code: the state of the GSTIN');
  // v2 default 5 (changed on purpose): when Tally's state is not the GSTIN's, the GSTIN's state is written and flagged
  const differs = placeOfContact({ ...base, placeOfSupply: 'Goa', gstin: '29ABCDE1234F1ZW' }, 'business_gst');
  assert.deepEqual([differs.value, differs.problem.kind], ['KA', 'place_differs_from_gstin'], "the GSTIN's state is written, and flagged for checking");
  assert.match(differs.problem.message, /KA is written, the state of the GSTIN/);
  const chosen = placeOfContact({ ...base, placeOfSupply: 'Goa', placeFixed: 'GA', gstin: '29ABCDE1234F1ZW' }, 'business_gst');
  assert.deepEqual([chosen.value, chosen.problem.kind], ['GA', 'place_differs_from_gstin'], 'a state chosen in Fix contacts wins');
  // payment terms from Tally's credit period
  assert.deepEqual(paymentTerms('30 Days'), { terms: '30', label: 'Net 30', problem: null });
  assert.deepEqual(paymentTerms('0 Days'), { terms: '0', label: 'Due on Receipt', problem: null });
  assert.deepEqual(paymentTerms(''), { terms: '', label: '', problem: null });
  assert.deepEqual([paymentTerms('15-Apr-2025').terms, paymentTerms('15-Apr-2025').problem.kind], ['', 'payment_terms_not_read']);
});

test('row values: Chart of Accounts, customers, vendors and items are written in the formats of the official samples', () => {
  const ctx = { accountTypes: {}, groupParents: { 'Staff Costs': 'Indirect Expenses', 'Local Debtors': 'Sundry Debtors' }, asOf: '20250331' };
  // Chart of Accounts: amount without sign, 2 decimals, no thousands separator; the side in "Debit" / "Credit"
  const acc = d => TEMPLATES.accounts.row(d, ctx);
  // changed on purpose (opening balance batch): NO account carries its opening balance in the Chart of Accounts file; it is
  // in the dated opening balance journal. Only the one date anchor of a migration keeps it here (round 2: a Stock
  // account no longer does; its balance is in OB-3).
  assert.deepEqual(acc({ name: 'Main Cash', parent: 'Cash-in-Hand', openingbalance: '-123456.5' }),
    { 'Account Name': 'Main Cash', 'Description': 'Tally group: Cash-in-Hand', 'Account Type': 'Cash', 'Opening Balance': '', 'Debit or Credit': '' });
  assert.deepEqual(acc({ name: 'Goods Held', parent: 'Stock-in-Hand', openingbalance: '-123456.5' }),
    { 'Account Name': 'Goods Held', 'Description': 'Tally group: Stock-in-Hand', 'Account Type': 'Stock', 'Opening Balance': '', 'Debit or Credit': '' });
  assert.deepEqual(TEMPLATES.accounts.row({ name: 'Main Cash', parent: 'Cash-in-Hand', openingbalance: '-123456.5' }, { ...ctx, openingAnchor: { name: 'Main Cash', mode: 'chart' } }),
    { 'Account Name': 'Main Cash', 'Description': 'Tally group: Cash-in-Hand', 'Account Type': 'Cash', 'Opening Balance': '123456.50', 'Debit or Credit': 'Debit' }, 'the date anchor keeps its balance in the file');
  // v2 default 2 (changed on purpose): a Bank account is written WITHOUT its opening balance (Zoho: "Opening Balance
  // cannot be associated with the given account"); the balance goes to the opening balance journal, and it is flagged
  assert.deepEqual(acc({ name: 'Main Bank', parent: 'Bank Accounts', openingbalance: '-123456.5' }),
    { 'Account Name': 'Main Bank', 'Description': 'Tally group: Bank Accounts', 'Account Type': 'Bank', 'Opening Balance': '', 'Debit or Credit': '' });
  const bankFlags = [].concat(TEMPLATES.accounts.check({ name: 'Main Bank', parent: 'Bank Accounts', openingbalance: '-123456.5' }, ctx));
  assert.deepEqual(bankFlags.map(f => f.kind), ['opening_balance_in_journal']);
  assert.match(bankFlags[0].message, /opening balance of 123456\.50 Debit is written once, in the opening balance journal/);
  assert.match(bankFlags[0].message, /does not depend on the Opening Balance Date of Zoho Books/);
  assert.deepEqual([].concat(TEMPLATES.accounts.check({ name: 'Second Bank', parent: 'Bank Accounts', openingbalance: '0' }, ctx)), [], 'a bank account with no balance needs nothing');
  assert.deepEqual(acc({ name: 'Owners Capital', parent: 'Capital Account', openingbalance: '1,00,000.00', description: 'Capital' }),
    { 'Account Name': 'Owners Capital', 'Description': 'Capital', 'Account Type': 'Equity', 'Opening Balance': '', 'Debit or Credit': '' });
  assert.deepEqual(TEMPLATES.accounts.row({ name: 'Owners Capital', parent: 'Capital Account', openingbalance: '1,00,000.00', description: 'Capital' }, { ...ctx, openingAnchor: { name: 'Owners Capital', mode: 'chart' } }),
    { 'Account Name': 'Owners Capital', 'Description': 'Capital', 'Account Type': 'Equity', 'Opening Balance': '100000.00', 'Debit or Credit': 'Credit' });
  assert.deepEqual(acc({ name: 'Tea', parent: 'Staff Costs', openingbalance: '0' }),
    { 'Account Name': 'Tea', 'Description': 'Tally group: Staff Costs', 'Account Type': 'Expense', 'Opening Balance': '', 'Debit or Credit': '' }, 'no opening balance: both empty');
  // the three account types in the rows of sample_accounts.csv are in the list, spelled the same way
  for (const t of ['Bank', 'Other Current Asset', 'Other Current Liability']) assert.ok(ZOHO_ACCOUNT_TYPES.includes(t), t);
  const flags = [].concat(TEMPLATES.accounts.check({ name: 'Output IGST', parent: 'Duties & Taxes', taxtype: 'GST', gstdutyhead: 'IGST', openingbalance: '500' }, ctx));
  // (changed on purpose, opening balance batch: its balance is in the opening balance journal, like every other ledger's)
  assert.deepEqual(flags.map(f => f.kind), ['zoho_builtin_account_name', 'opening_balance_in_journal', 'tax_ledger_in_accounts'], 'Output IGST is also the name of an account Zoho creates');
  assert.match(flags[2].message, /Zoho Books creates its own GST tax accounts/);

  // customers: Zoho codes, address lines split, no city invented, Status Active
  const customer = { metadata: { type: 'Ledger', name: 'Rowan Traders' }, parent: 'Local Debtors', openingbalance: '-2500', currencyname: '₹', billcreditperiod: '45 Days',
    ledmailingdetails: [{ applicablefrom: '20200401', mailingname: 'Rowan Traders Pvt Ltd', address: [{ metadata: true }, '4 Elm Lane', 'Near Park', 'Block C'], state: 'Kerala', pincode: '682001', country: 'India' }],
    ledgstregdetails: [{ applicablefrom: '20200401', gstregistrationtype: 'Regular', gstin: '32ABCDE1234F1Z9', placeofsupply: 'Kerala' }], incometaxnumber: 'ABCDE1234F',
    contactdetails: [{ phonenumber: '0484-200000', mobilenumber: '+91-9000000001', email: 'rowan@example.com' }] };
  const row = TEMPLATES.customers.row(customer, ctx);
  assert.deepEqual(Object.keys(row).filter(k => !CUSTOMER_HEADERS.includes(k)), [], 'only official headings');
  assert.deepEqual(['Display Name', 'Company Name', 'Place Of Contact', 'Currency Code', 'GST Treatment', 'GST Identification Number (GSTIN)', 'PAN Number', 'EmailID', 'Phone', 'MobilePhone',
    'Billing Address', 'Billing Street2', 'Billing City', 'Billing State', 'Billing Country', 'Billing Code', 'Opening Balance', 'Payment Terms', 'Payment Terms Label', 'Status'].map(h => row[h] ?? ''),
  ['Rowan Traders', 'Rowan Traders Pvt Ltd', 'KL', 'INR', 'business_gst', '32ABCDE1234F1Z9', 'ABCDE1234F', 'rowan@example.com', '0484-200000', '+91-9000000001',
    '4 Elm Lane', 'Near Park, Block C', '', 'Kerala', 'India', '682001', '2500.00', '45', 'Net 45', 'Active']);
  // a customer in credit: Opening Balance empty, flagged
  const inCredit = { ...customer, openingbalance: '700' };
  assert.equal(TEMPLATES.customers.row(inCredit, ctx)['Opening Balance'], '');
  const cf = TEMPLATES.customers.check(inCredit, ctx);
  assert.deepEqual(cf.filter(f => f.kind === 'balance_unusual_side').length, 1);
  assert.match(cf.find(f => f.kind === 'balance_unusual_side').message, /Opening balance 700\.00 is a credit in Tally .* the cell is left empty/);
  // changed on purpose (opening balance batch): the balance is carried by a file (journal OB-2), not left for a person
  assert.match(cf.find(f => f.kind === 'balance_unusual_side').message, /written as a line of journal OB-2 .* Accounts Receivable, Credit, with this party as Contact Name/);
  assert.doesNotMatch(cf.find(f => f.kind === 'balance_unusual_side').message, /An accountant must decide/);

  // vendors: Source Of Supply carries the state code, Place Of Contact (customers only) stays empty
  const vendor = { ...customer, metadata: { type: 'Ledger', name: 'Alder Supplies' }, parent: 'Sundry Creditors', openingbalance: '3000' };
  const vrow = TEMPLATES.vendors.row(vendor, ctx);
  assert.deepEqual(Object.keys(vrow).filter(k => !VENDOR_HEADERS.includes(k)), []);
  assert.deepEqual([vrow['Source Of Supply'], vrow['Place Of Contact'] ?? '', vrow['Opening Balance'], vrow['GST Treatment']], ['KL', '', '3000.00', 'business_gst']);
  const vInDebit = { ...vendor, openingbalance: '-10' };
  assert.equal(TEMPLATES.vendors.row(vInDebit, ctx)['Opening Balance'], '');
  assert.ok(TEMPLATES.vendors.check(vInDebit, ctx).some(f => f.kind === 'balance_unusual_side' && /is a debit in Tally/.test(f.message)));
  // registered without a GSTIN: v2 default 4 (changed on purpose): written as in Tally (registered), and flagged
  const noGstin = { ...customer, ledgstregdetails: [{ applicablefrom: '20200401', gstregistrationtype: 'Regular', placeofsupply: 'Kerala' }] };
  assert.equal(TEMPLATES.customers.row(noGstin, ctx)['GST Treatment'], 'business_gst');
  assert.ok(TEMPLATES.customers.check(noGstin, ctx).some(f => f.kind === 'gst_registered_without_gstin'));
  // a foreign currency is not written as INR: a three-letter code Tally gives is written (SYN-14), flagged; a currency
  // nothing gives a code for is left empty and flagged
  const usd = { ...customer, currencyname: 'USD' };
  assert.equal(TEMPLATES.customers.row(usd, ctx)['Currency Code'], 'USD');
  assert.ok(TEMPLATES.customers.check(usd, ctx).some(f => f.kind === 'currency_code_from_tally'));
  const yen = { ...customer, currencyname: '¥' };
  assert.equal(TEMPLATES.customers.row(yen, ctx)['Currency Code'], '');
  assert.ok(TEMPLATES.customers.check(yen, ctx).some(f => f.kind === 'currency_not_rupee'));

  // items: goods / service from Tally's type of supply, "Sales and Purchases", rates with 2 decimals, no stock
  const item = d => TEMPLATES.items.row({ metadata: { type: 'Stock Item', name: 'Widget' }, baseunits: 'nos', ...d }, ctx);
  assert.deepEqual(Object.keys(item({})).filter(k => !ITEM_HEADERS.includes(k)), []);
  // v2 default 3 (changed on purpose): an item with no rate is written with 0.00 (Zoho: "Enter the selling price of the item.")
  assert.deepEqual(['Product Type', 'Item Type', 'Status', 'Usage unit', 'Rate', 'Purchase Rate', 'Initial Stock', 'Taxability Type'].map(h => item({})[h] ?? ''), ['goods', 'Sales and Purchases', 'Active', 'nos', '0.00', '0.00', '', '']);
  assert.equal(item({ gsttypeofsupply: 'Services' })['Product Type'], 'service');
  assert.equal(item({ gsttypeofsupply: 'Capital Goods' })['Product Type'], '', 'not guessed');
  assert.deepEqual([item({ standardpricelist: [{ date: '20240401', rate: '250/nos' }] }).Rate, item({ standardcostlist: [{ date: '20240401', rate: '1,200.5/nos' }] })['Purchase Rate']], ['250.00', '1200.50']);
  const stockFlags = TEMPLATES.items.check({ metadata: { type: 'Stock Item', name: 'Widget' }, baseunits: 'nos', openingbalance: '5 nos', openingvalue: '-500' }, ctx);
  assert.ok(stockFlags.some(f => f.kind === 'item_opening_stock_not_written'), 'an opening stock that is not written is flagged');
  // changed on purpose (v2 default 3): no "item_rate_missing" blocker any more; the item itself is flagged as an assumption
  assert.deepEqual(TEMPLATES.items.fileFlags([item({})], ctx).map(f => f.kind), ['item_account_default', 'item_tax_preference_not_set']);
  const widget = { metadata: { type: 'Stock Item', name: 'Widget' }, baseunits: 'nos' };
  assert.deepEqual(TEMPLATES.items.check(widget, ctx).map(f => f.kind), ['item_rate_zero', 'item_purchase_rate_zero']);
  // v2 (docs/ZOHO_IMPORT_RULES.md 8.3): Zoho requires a Purchase Account for an item that can be bought.
  //  - a goods business: "Sales and Purchases" on Zoho's own accounts when none is chosen
  assert.deepEqual(['Item Type', 'Account', 'Purchase Account', 'Purchase Rate'].map(h => item({})[h]), ['Sales and Purchases', 'Sales', 'Cost of Goods Sold', '0.00']);
  //  - a services business with no purchase account and rate known: "Sales", the purchase cells empty
  const services = { ...ctx, businessType: 'services', itemAccounts: { sales: 'Consulting Income', purchase: '' } };
  const srow = TEMPLATES.items.row(widget, services);
  assert.deepEqual(['Item Type', 'Product Type', 'Account', 'Purchase Account', 'Purchase Rate', 'Rate'].map(h => srow[h]), ['Sales', 'service', 'Consulting Income', '', '', '0.00']);
  assert.deepEqual(TEMPLATES.items.check(widget, services).map(f => f.kind), ['item_sales_only', 'item_rate_zero']);
  assert.deepEqual(TEMPLATES.items.fileFlags([srow], services).map(f => f.kind), ['item_tax_preference_not_set'], 'the chosen sales account is not a default');
  //  - "Sales and Purchases" as soon as a purchase account is chosen and a purchase rate is known
  const both = { ...services, itemAccounts: { sales: 'Consulting Income', purchase: 'Subcontract Costs' }, itemSettings: { Widget: { purchaseRate: '40.00' } } };
  assert.deepEqual(['Item Type', 'Purchase Account', 'Purchase Rate'].map(h => TEMPLATES.items.row(widget, both)[h]), ['Sales and Purchases', 'Subcontract Costs', '40.00']);
  assert.equal(TEMPLATES.items.row(widget, { ...both, itemSettings: {} })['Item Type'], 'Sales', 'a purchase account alone is not enough: the rate is not known');
});

// ---------- end to end: one All Masters file ----------
const app = buildApp();
let cookie = '';
const call = opts => app.inject({ ...opts, headers: { ...(opts.headers || {}), ...(cookie ? { cookie } : {}) } });
const get = async url => { const r = await call({ url }); assert.equal(r.statusCode, 200, `${url}: ${r.body}`); return r.json(); };
const send = (method, url, payload) => call({ method, url, payload });
const login = async role => {
  const u = seed.users.find(x => x.role === role);
  const lr = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: u.password } });
  cookie = String(lr.headers['set-cookie']).split(';')[0];
};
const csvRows = async (id, key) => { const r = await call({ url: `/api/migrations/${id}/files/${key}/download?confirmed=1` }); assert.equal(r.statusCode, 200, r.body); return parseCsv(r.body).rows; };
const g = (name, parent, reservedname = name) => ({ metadata: { type: 'Group', name, reservedname }, parent: parent || '\u0004 Primary' });
const l = (name, parent, openingbalance, extra = {}) => ({ metadata: { type: 'Ledger', name }, parent, openingbalance, startingfrom: '20200401', ...extra });
const reg = (type, gstin, place) => [{ applicablefrom: '20200401', gstregistrationtype: type, ...(gstin ? { gstin } : {}), placeofsupply: place }];
const mail = (state, country = 'India') => [{ applicablefrom: '20200401', mailingname: 'M', address: [{ metadata: true }, 'Line 1'], state, country }];
// Tally sign: a debit is negative. The balances add up to zero, as in a Trial Balance.
const MASTERS = { tallymessage: [
  g('Current Assets'), g('Current Liabilities'), g('Capital Account'), g('Indirect Expenses'),
  g('Sundry Debtors', 'Current Assets'), g('Sundry Creditors', 'Current Liabilities'), g('Duties & Taxes', 'Current Liabilities'), g('Bank Accounts', 'Current Assets'), g('Cash-in-Hand', 'Current Assets'),
  g('North Debtors', 'Sundry Debtors', ''),
  l('Birch Retail', 'North Debtors', '-1200.00', { ledgstregdetails: reg('Regular', '29BIRCH1234B1Z8', 'Karnataka'), ledmailingdetails: mail('Karnataka') }),
  l('Cedar Stores', 'Sundry Debtors', '300.00', { ledgstregdetails: reg('Unregistered/Consumer', '', 'Goa'), ledmailingdetails: mail('Goa') }),     // a customer in credit
  l('Dune Exports', 'Sundry Debtors', '-400.00', { ledgstregdetails: reg('', '', ''), ledmailingdetails: mail('', 'United Arab Emirates') }),
  l('Elm Supplies', 'Sundry Creditors', '900.00', { ledgstregdetails: reg('Regular', '', 'Kerala'), ledmailingdetails: mail('Kerala') }),          // registered, no GSTIN
  l('Fir Traders', 'Sundry Creditors', '-50.00', { ledgstregdetails: reg('Composition', '27FIRTR1234F1ZR', 'Maharashtra'), ledmailingdetails: mail('Maharashtra') }), // a vendor in debit
  l('Output IGST', 'Duties & Taxes', '250.00', { taxtype: 'GST', gstdutyhead: 'IGST' }),
  l('Main Bank', 'Bank Accounts', '-5000.00'),
  l('Petty Cash', 'Cash-in-Hand', '-150.00'),
  l('Owners Capital', 'Capital Account', '5500.00'),
  l('Office Tea', 'Indirect Expenses', '-150.00'),
  l('Unused Ledger', 'Indirect Expenses', ''),
] };

test('Chart of Accounts leaves customers and vendors out; every opening balance is in exactly one import file; the totals tie out', async () => {
  await login('analyst');
  const id = (await send('POST', '/api/migrations', { company: 'Sample Masters Co', financialYear: '2024-25' })).json().id;
  const base = `/api/migrations/${id}`;
  let r = await call({ method: 'PUT', url: `${base}/uploads/all_masters`, headers: { 'content-type': 'application/octet-stream', 'x-filename': 'Master.json' }, payload: utf16le(MASTERS) });
  assert.equal(r.statusCode, 200, r.body);
  const others = { stock_items: '04_stock_items.json', units: '05_units.json', sales: '07_sales_vouchers.json', purchase: '08_purchase_vouchers.json', receipt: '09_receipt_vouchers.json', payment: '10_payment_vouchers.json', journal: '11_journal_vouchers.json', trial_balance: '13_trial_balance.json' };
  for (const [k, f] of Object.entries(others)) {
    r = await call({ method: 'PUT', url: `${base}/uploads/${k}`, headers: { 'content-type': 'application/octet-stream', 'x-filename': f }, payload: fs.readFileSync(path.join(samples, f)) });
    assert.equal(r.statusCode, 200, `${k}: ${r.body}`);
  }
  await send('PUT', `${base}/waivers/stock_summary`, { reason: 'Not needed for test' });
  assert.equal((await send('POST', `${base}/process?wait=1`)).statusCode, 200);
  // Mapping Studio asks nothing about customer and vendor groups
  const groups = (await get(`${base}/account-types`)).groups.map(x => x.group);
  assert.ok(!groups.some(x => ['Sundry Debtors', 'Sundry Creditors', 'North Debtors'].includes(x)), groups.join(', '));
  r = await send('POST', `${base}/generate`);
  assert.equal(r.statusCode, 200, r.body);
  const files = Object.fromEntries(r.json().files.map(f => [f.key, f]));
  for (const key of ['accounts', 'items']) assert.deepEqual(files[key].headings, TEMPLATES[key].headers, `${key}: the official headings`);
  // Customers and Vendors: the official headings in the official order, less the optional columns that are empty on every row
  for (const key of ['customers', 'vendors']) {
    const h = files[key].headings;
    assert.ok(subsetInOrder(h, TEMPLATES[key].headers) && h.length < TEMPLATES[key].headers.length && h.includes('Display Name') && h.includes('Opening Balance'), `${key}: ${h.join(', ')}`);
  }
  // changed on purpose in B6: the Invoices file now has the official sample's layout too
  assert.deepEqual([files.accounts.templateVerified, files.items.templateVerified, files.invoices?.templateVerified ?? false], [true, true, true]);

  // v2, the zero-decision path (changed on purpose). No decision is made in this test, so the defaults apply:
  //  - "Output IGST" and "Petty Cash" are names of accounts Zoho creates itself: Zoho's own account is used, the ledger
  //    is not written here (Zoho: "Row already exists") and its opening balance is in the opening balance journal;
  //  - "Main Bank" is a Bank account: written WITHOUT its opening balance (Zoho: "Opening Balance cannot be associated
  //    with the given account"), which is in the opening balance journal too.
  const coa = await csvRows(id, 'accounts');
  assert.deepEqual(coa.map(x => x['Account Name']), ['Main Bank', 'Owners Capital', 'Office Tea', 'Unused Ledger'], 'customers and vendors are not accounts');
  // changed on purpose (opening balance batch): the balances are in the dated journal. ONE balance stays here (the date
  // anchor, an Equity account), because customers and vendors carry opening balances that Zoho dates with its setting
  assert.deepEqual(coa.map(x => [x['Account Type'], x['Opening Balance'], x['Debit or Credit']]),
    [['Bank', '', ''], ['Equity', '5500.00', 'Credit'], ['Expense', '', ''], ['Expense', '', '']]);
  const obj = await csvRows(id, 'opening_balances_for_zoho_accounts');
  assert.deepEqual(obj.map(x => [x.Account, x.Debit, x.Credit]),
    // OB-007: journal OB-1 with the kind of line Zoho took in our imports (a bank account), OB-3 with the others (the two
    // lines on Opening Balance Adjustments together are the 5050.00 one journal had)
    [['Main Bank', '5000.00', ''], ['Opening Balance Adjustments', '', '5000.00'],
      ['Output IGST', '', '250.00'], ['Petty Cash', '150.00', ''], ['Office Tea', '150.00', ''], ['Opening Balance Adjustments', '', '50.00'],
      // journal OB-2: the customer in credit and the vendor in debit, each with its Contact Name, and its own balancing line
      ['Accounts Receivable', '', '300.00'], ['Accounts Payable', '50.00', ''], ['Opening Balance Adjustments', '250.00', '']], 'three balanced journals: each balance once, then the balancing line');
  assert.deepEqual(obj.map(x => [x['Journal Number Suffix'], x['Contact Name']]), [['1', ''], ['1', ''], ['3', ''], ['3', ''], ['3', ''], ['3', ''], ['2', 'Cedar Stores'], ['2', 'Fir Traders'], ['2', '']]);
  assert.ok(obj.every(x => x['Journal Date'] === '2024-03-31' && x['Journal Number Prefix'] === 'OB-'));
  for (const j of ['1', '2', '3']) assert.equal(obj.filter(x => x['Journal Number Suffix'] === j).reduce((t, x) => t + Math.round(Number(x.Debit || 0) * 100) - Math.round(Number(x.Credit || 0) * 100), 0), 0, `OB-${j} balances`);
  // the bank balances as a plain list, for Settings > Opening Balances in Zoho Books if the journal is refused
  const bank = await get(`${base}/bank-opening-balances`);
  assert.deepEqual(bank.accounts.map(a => [a.account, a.accountType, a.side, a.amount]), [['Main Bank', 'Bank', 'Debit', '5000.00']]);
  assert.deepEqual([bank.totalDebit, bank.totalCredit], ['5000.00', '0.00']);
  assert.match(bank.note, /Settings > Setup & Configurations > Opening Balances/);
  assert.ok(coa.every(x => x['Parent Account'] === '' && x['Account Code'] === '' && x['Account #'] === '')); // parseCsv trims headings: "Account # " is read as "Account #"
  const raw = (await call({ url: `${base}/files/accounts/download?confirmed=1` })).body;
  assert.ok(raw.startsWith('Account Name,Account Code,Description,Account Type,Parent Account,Account # ,Currency,Opening Balance,Debit or Credit\r\n'), 'the heading keeps its trailing space in the file');
  const cust = Object.fromEntries((await csvRows(id, 'customers')).map(x => [x['Display Name'], x]));
  const vend = Object.fromEntries((await csvRows(id, 'vendors')).map(x => [x['Display Name'], x]));
  assert.deepEqual(Object.values(cust).map(x => [x['GST Treatment'], x['Place Of Contact'], x['Opening Balance']]),
    [['business_gst', 'KA', '1200.00'], ['business_none', 'GA', ''], ['overseas', '', '400.00']]);
  // v2 default 4 (changed on purpose): Elm Supplies is registered in Tally with no GSTIN: written as in Tally, and flagged
  assert.deepEqual(Object.values(vend).map(x => [x['GST Treatment'], x['Source Of Supply'], x['Opening Balance']]),
    [['business_gst', 'KL', '900.00'], ['business_registered_composition', 'MH', '']]);

  // no double counting: the reference report is not imported and the old two-files flag does not fire
  const gen = (await get(`${base}/summary`)).exceptions.filter(e => e.stage === 'generate');
  assert.deepEqual(gen.filter(e => e.kind === 'opening_balance_in_two_files'), []);
  assert.ok(!(await get(`${base}/imports`)).some(i => i.key === 'opening_balances'));
  // the flagged cases
  const kinds = k => gen.filter(e => e.kind === k).map(e => e.name).sort();
  assert.deepEqual(kinds('balance_unusual_side'), ['Cedar Stores', 'Fir Traders']);
  assert.deepEqual(kinds('gst_registered_without_gstin'), ['Elm Supplies']);
  assert.deepEqual(kinds('tax_ledger_in_accounts'), [], 'Output IGST is not written as an account any more: Zoho has its own');
  assert.deepEqual(kinds('gst_registration_unknown'), [], 'the overseas customer has a treatment');
  // every default applied is a flagged item of its own kind, and the same list is given as "Assumptions the tool made"
  assert.deepEqual(kinds('default_zoho_own_account'), ['Output IGST', 'Petty Cash']);
  assert.deepEqual(kinds('opening_balance_in_journal'), ['Main Bank', 'Office Tea']);
  assert.deepEqual(kinds('opening_date_anchor'), ['Owners Capital']);
  assert.deepEqual(kinds('zoho_builtin_account_name'), [], 'nothing is written with the name of one of Zoho\'s own accounts');
  const assumed = await get(`${base}/assumptions`);
  const count = k => assumed.assumptions.find(a => a.kind === k)?.count ?? 0;
  assert.deepEqual([assumed.available, count('default_zoho_own_account'), count('opening_balance_in_journal'), count('gst_registered_without_gstin')], [true, 2, 2, 1]);
  assert.deepEqual([count('opening_date_anchor'), count('balance_unusual_side')], [1, 2], 'the anchor and the advances carried by OB-2 are listed as assumptions');
  assert.deepEqual(assumed.assumptions.find(a => a.kind === 'default_zoho_own_account').where, { screen: 'screen-19', anchor: 'ms-zoho-accounts' });
  assert.ok(assumed.assumptions.every(a => a.examples.every(e => !('name' in e))), 'examples are given by Tally identifier, not by name');
  assert.equal(assumed.sameAsFiles, true, 'the list is what the files created last were built with');

  // tie-out: the balances written (debit positive) plus the ones left out on the unusual side equal the Tally total, which
  // is zero. The opening balance journal counts too (without its balancing line on Opening Balance Adjustments).
  const amt = v => Math.round(Number(v || 0) * 100);
  const written = coa.reduce((t, x) => t + (x['Debit or Credit'] === 'Debit' ? amt(x['Opening Balance']) : -amt(x['Opening Balance'])), 0)
    + obj.filter(x => x.Account !== 'Opening Balance Adjustments').reduce((t, x) => t + amt(x.Debit) - amt(x.Credit), 0) // OB-1 and OB-2
    + Object.values(cust).reduce((t, x) => t + amt(x['Opening Balance']), 0) - Object.values(vend).reduce((t, x) => t + amt(x['Opening Balance']), 0);
  // each ledger's balance is written exactly once: no account is both in the Chart of Accounts with a balance and in the journal
  const withBalanceInCoa = coa.filter(x => x['Opening Balance']).map(x => x['Account Name']);
  assert.deepEqual(obj.map(x => x.Account).filter(a => withBalanceInCoa.includes(a)), []);
  const tally = MASTERS.tallymessage.filter(m => m.metadata.type === 'Ledger').reduce((t, m) => t - amt(m.openingbalance), 0);
  // changed on purpose (opening balance batch): nothing is left out any more. Cedar Stores (credit 300) and Fir Traders
  // (debit 50) are lines of journal OB-2
  assert.equal(tally, 0, 'the made-up masters balance');
  assert.equal(written, tally, 'every opening balance is written exactly once, in a file');
});

test('a layout saved before the headings changed keeps working: a column whose standard value no longer exists is written empty', async () => {
  await login('admin');
  const firm = seed.users.find(x => x.role === 'admin').firmId ?? 1;
  const db = new DatabaseSync(path.join(process.env.DATA_DIR, 'migration.db'));
  const old = [
    { id: 'display_name', heading: 'Display Name', source: { type: 'builtin', builtin: 'display_name' } },
    { id: 'place_of_supply', heading: 'Place of Supply', source: { type: 'builtin', builtin: 'place_of_supply' } }, // the old placeholder column
    { id: 'gst_treatment', heading: 'GST Treatment', source: { type: 'builtin', builtin: 'gst_treatment' } },
  ];
  db.prepare("INSERT INTO column_mappings (firm_id, key, columns, updated_by, updated_at) VALUES (?, 'customers', ?, 'old@demo.test', '2025-01-01T00:00:00.000Z') ON CONFLICT (firm_id, key) DO UPDATE SET columns = excluded.columns")
    .run(firm, JSON.stringify(old));
  db.close();
  const t = (await get('/api/templates')).find(x => x.key === 'customers');
  assert.deepEqual([t.customised, t.verified, t.verifiedInCode], [true, false, false]);
  const col = t.columns.find(c => c.heading === 'Place of Supply');
  assert.deepEqual([col.noLongerAvailable, col.changed.added], [true, true]);
  assert.match(col.from, /No longer available/);
  assert.ok(t.removedColumns.some(c => c.id === 'place_of_contact'), 'the new standard column can be added');
  // the files are still created; the obsolete column is empty
  await login('analyst');
  const id = (await get('/api/migrations')).find(x => x.company === 'Sample Masters Co').id;
  const r = await send('POST', `/api/migrations/${id}/generate`);
  assert.equal(r.statusCode, 200, r.body);
  const rows = await csvRows(id, 'customers');
  assert.deepEqual(Object.keys(rows[0]), ['Display Name', 'Place of Supply', 'GST Treatment']);
  assert.ok(rows.every(x => x['Place of Supply'] === ''));
  // saving that layout again asks for a value for the column; resetting gives the official layout back
  await login('admin');
  const save = await send('PUT', '/api/templates/customers/columns', { columns: old });
  assert.equal(save.statusCode, 400);
  assert.match(save.json().error, /the standard value chosen for it does not exist in this file/);
  const reset = (await send('DELETE', '/api/templates/customers/columns')).json();
  assert.deepEqual([reset.customised, reset.verified, reset.verifiedInCode], [false, true, true]);
  assert.deepEqual(checkColumns('customers', defaultColumns('customers')).problems, []);
});

// ---------- verifier findings (round 2): every value below is MADE UP ----------
test('import blockers: Display Names with hidden characters or that collide once cleaned, items without rates', () => {
  const ctx = { accountTypes: {}, groupParents: {}, asOf: '20250331' };
  const vendor = name => ({ metadata: { type: 'Ledger', name }, parent: 'Sundry Creditors', currencyname: '₹',
    ledmailingdetails: [{ applicablefrom: '20200401', mailingname: name, state: 'Kerala', country: 'India' }] });
  // the Display Name (the ledger name) is flagged itself, and written exactly as in Tally
  const broken = vendor('Teak Supplies\r\n');
  assert.equal(TEMPLATES.vendors.row(broken, ctx)['Display Name'], 'Teak Supplies\r\n', 'never changed');
  const f = TEMPLATES.vendors.check(broken, ctx).find(x => x.kind === 'display_name_hidden_characters');
  assert.ok(f, 'flagged');
  assert.match(f.message, /Display Name \(and as Company Name\), contains a line break at its start or end/);
  assert.ok(!TEMPLATES.vendors.check(broken, ctx).some(x => x.kind === 'mailing_name_hidden_characters'), 'not counted twice when the mailing name is the name');
  assert.ok(!TEMPLATES.vendors.check(vendor('Teak Supplies'), ctx).some(x => /hidden_characters/.test(x.kind)));
  // a separate mailing name with a hidden character keeps its own flag
  const mail = { ...vendor('Ebony Works'), ledmailingdetails: [{ applicablefrom: '20200401', mailingname: 'Ebony\tWorks Pvt Ltd', country: 'India' }] };
  assert.deepEqual(TEMPLATES.vendors.check(mail, ctx).filter(x => /hidden_characters/.test(x.kind)).map(x => x.kind), ['mailing_name_hidden_characters']);
  // names that are the same once cleaned: one whole-file flag naming all of them; distinct names give none
  const rows = ['Teak Supplies\r\n', 'Teak Supplies', 'teak  supplies', 'Rosewood Ltd'].map(n => TEMPLATES.vendors.row(vendor(n), ctx));
  const clash = TEMPLATES.vendors.fileFlags(rows);
  assert.deepEqual(clash.map(x => [x.kind, x.uses]), [['display_name_collides_after_cleaning', 3]]);
  assert.match(clash[0].message, /^3 vendor Display Names differ only by/);
  assert.ok(clash[0].message.includes('"Teak Supplies<CR><LF>"'), 'the hidden characters are made visible');
  assert.deepEqual(TEMPLATES.customers.fileFlags([TEMPLATES.customers.row({ ...vendor('Rosewood Ltd'), parent: 'Sundry Debtors' }, ctx)]), []);

  // items. Changed on purpose (v2 default 3): an item with no rate was an expected rejection that blocked the file
  // ("item_rate_missing"). It is now written with Rate 0.00 and flagged itself as an assumption; nothing blocks.
  const stock = d => ({ metadata: { type: 'Stock Item', name: 'Widget' }, baseunits: 'nos', ...d });
  const item = d => TEMPLATES.items.row(stock(d), ctx);
  const priced = { standardpricelist: [{ date: '20240401', rate: '10/nos' }] };
  assert.ok(!TEMPLATES.items.fileFlags([item({}), item(priced)], ctx).some(x => x.kind === 'item_rate_missing'), 'the blocker is gone');
  assert.deepEqual([item({}).Rate, item(priced).Rate], ['0.00', '10.00']);
  const zero = TEMPLATES.items.check(stock({}), ctx).find(x => x.kind === 'item_rate_zero');
  assert.match(zero.message, /Zoho Books requires a selling price, so Rate 0\.00 is written\. This is the tool's default/);
  assert.ok(!TEMPLATES.items.check(stock(priced), ctx).some(x => x.kind === 'item_rate_zero'));
});

test('Chart of Accounts: names of accounts Zoho creates itself are flagged with their balance; a ledger with no group is flagged, not sent to Mapping Studio', async () => {
  const { builtinAccount } = await import('../src/zohocodes.js');
  const { isProfitAndLossLedger } = await import('../src/zoho.js');
  assert.equal(builtinAccount('tds  receivable'), 'TDS Receivable', 'capital letters and spaces ignored');
  assert.equal(builtinAccount('Bank Fees & Charges'), 'Bank Fees and Charges', '"&" for "and"');
  assert.equal(builtinAccount('Advance Tax\r\n'), 'Advance Tax');
  assert.equal(builtinAccount('Advance Tax FY 2024-25'), null, 'only the exact name');
  const ctx = { accountTypes: {}, groupParents: {}, asOf: '20250331' };
  const check = d => [].concat(TEMPLATES.accounts.check(d, ctx));
  const adv = check({ name: 'Advance Tax', parent: 'Loans & Advances (Asset)', openingbalance: '-1234.5' }).find(x => x.kind === 'zoho_builtin_account_name');
  assert.ok(adv, 'flagged although it is not under Duties & Taxes');
  assert.match(adv.message, /matches "Advance Tax"[^]*opening balance of 1234\.50 Debit[^]*will not tie/);
  const tds = check({ name: 'TDS Payable', parent: 'Duties & Taxes' }).find(x => x.kind === 'zoho_builtin_account_name');
  assert.ok(tds && !/opening balance of/.test(tds.message), 'no balance: no balance sentence');
  assert.deepEqual(check({ name: 'Office Rent Paid', parent: 'Indirect Expenses' }), []);
  // the row itself is written unchanged
  // (changed on purpose, opening balance batch: no chart row carries a balance; the balance is in the opening balance journal)
  assert.equal(TEMPLATES.accounts.row({ name: 'Advance Tax', parent: 'Loans & Advances (Asset)', openingbalance: '-1234.5' }, ctx)['Opening Balance'], '');
  // a ledger with no group: its own kind, and the message does not ask for a Mapping Studio decision that cannot apply
  const none = check({ name: 'Loose Ledger' });
  assert.deepEqual(none.map(x => x.kind), ['account_without_group']);
  assert.doesNotMatch(none[0].message, /\(none\)/);
  // Tally's own Profit & Loss A/c: by its reserved name, or by its name with no group
  assert.ok(isProfitAndLossLedger({ metadata: { type: 'Ledger', name: 'P and L', reservedname: 'Profit & Loss A/c' } }), 'renamed');
  assert.ok(isProfitAndLossLedger({ name: 'Profit & Loss A/c' }));
  assert.ok(!isProfitAndLossLedger({ name: 'Profit & Loss A/c', parent: 'Indirect Expenses' }), 'a user ledger of that name under a group');
  assert.ok(!isProfitAndLossLedger({ metadata: { type: 'Ledger', name: 'Cash', reservedname: 'Cash' }, parent: 'Cash-in-Hand' }));
});
