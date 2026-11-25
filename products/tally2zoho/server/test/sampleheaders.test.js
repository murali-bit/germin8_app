// Headings of every Zoho file the tool writes are compared with Zoho's own import samples (zoho-samples/), and the
// account types with zohorules.json lists.account_types. Everything here is checked against the files themselves when they
// are present (public Zoho material) and against MADE UP companies of different shapes; no real company data is used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const zoho = await import('../src/zoho.js');
const { TEMPLATES, ZOHO_ACCOUNT_TYPES, ACCOUNT_TYPE_BY_GROUP, HEADING_RENAMES, CONTACT_ALWAYS_KEPT, canonicalAccountType, accountTypeStatus, accountType, resolveAccountType } = zoho;
const { VOUCHER_FILES, BILL_COLUMNS_LEFT_OUT } = await import('../src/vouchers.js');
const { ITEM_COLUMNS_LEFT_OUT } = zoho;
const { columnsToWrite, migrateRenamedHeadings, defaultColumns } = await import('../src/columns.js');
const { ASSUMPTIONS } = await import('../src/defaults.js');
const { checkFiles } = await import('../src/zohocheck.js');
const { sampleHeadings, fieldExplanation } = await import('../fixtures/zohoSamples.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES = path.resolve(here, '../../zoho-samples');
const LISTS = JSON.parse(fs.readFileSync(path.resolve(here, '../src/zohorules.json'), 'utf8')).lists;
const hex = h => Buffer.from(h).toString('hex');

// Every file the tool writes as a Zoho import file, with the official sample it follows and the sample headings it leaves
// out on purpose (documented where they are declared).
const FILES = {
  customers: ['customer_import_sample_data.xls', []],
  vendors: ['vendor_import_sample_data.xls', []],
  accounts: ['sample_accounts.csv', []],
  items: ['sample_items2.csv', ITEM_COLUMNS_LEFT_OUT],
  invoices: ['sample_invoices.xls', []],
  bills: ['sample_bills.csv', BILL_COLUMNS_LEFT_OUT],
  journals: ['sample_journals.xls', []],
  other_journals: ['sample_journals.xls', []],
  opening_balances_for_zoho_accounts: ['sample_journals.xls', []],
};
const ALL = { ...TEMPLATES, ...VOUCHER_FILES };
// Zoho's Map Fields spelling (lists.map_field_labels) replaces the sample's first-row heading where the two differ.
const label = (key, h) => LISTS.map_field_labels.labels.find(l => l.module === key && l.sample_heading === h)?.zoho_label ?? h;

test('every generated header list is the matching Zoho sample, byte for byte and in order, less documented left-out columns, with Map Fields labels', t => {
  for (const [key, [file, leftOut]] of Object.entries(FILES)) {
    assert.ok(ALL[key], `${key} is a file the tool writes`);
    assert.equal(ALL[key].sampleFile, file, `${key} names its sample`);
    assert.deepEqual(defaultColumns(key).map(c => c.heading), ALL[key].headers, `${key}: the default layout is the template`);
  }
  assert.equal(new Set(Object.keys(ALL).filter(k => ALL[k].verified && !ALL[k].referenceOnly)).size, Object.keys(FILES).length, 'no verified Zoho file is missing from this test');
  if (!Object.values(FILES).every(([f]) => fs.existsSync(path.join(SAMPLES, f)))) { t.skip(`the official sample files are not in ${SAMPLES}`); return; }
  for (const [key, [file, leftOut]] of Object.entries(FILES)) {
    const official = sampleHeadings(path.join(SAMPLES, file)).filter(h => !leftOut.includes(h)).map(h => label(key, h));
    assert.deepEqual(ALL[key].headers.map(hex), official.map(hex), `${key}: headings of ${file}`);
  }
});

test('customers and vendors: every field of the sample\'s Field Explanation sheet is a heading of our file, spelled as Zoho spells it', t => {
  const files = { customers: 'customer_import_sample_data.xls', vendors: 'vendor_import_sample_data.xls' };
  if (!Object.values(files).every(f => fs.existsSync(path.join(SAMPLES, f)))) { t.skip('the official sample files are not present'); return; }
  for (const [key, file] of Object.entries(files)) {
    const fields = fieldExplanation(path.join(SAMPLES, file));
    assert.ok(fields && fields.length > 30, `${key}: the Field Explanation sheet is read`);
    const ours = new Set(TEMPLATES[key].headers);
    assert.deepEqual(fields.filter(f => !ours.has(f.name)).map(f => f.name), [], `${key}: a field Zoho names that our file spells differently`);
    // the only mandatory field is the one the rules say, and it always stays in the file
    const mandatory = fields.filter(f => f.mandatory).map(f => f.name);
    assert.deepEqual(mandatory, LISTS.contact_columns.mandatory_in_sample, `${key}: mandatory fields`);
    assert.ok(mandatory.every(m => CONTACT_ALWAYS_KEPT.has(m)));
  }
  // every label of lists.map_field_labels is real: the sample's first row has the old heading, the explanation has the new one
  for (const l of LISTS.map_field_labels.labels) {
    const file = path.join(SAMPLES, files[l.module]);
    assert.ok(sampleHeadings(file).includes(l.sample_heading), `${l.module}: the sample's first row has "${l.sample_heading}"`);
    assert.ok(fieldExplanation(file).some(f => f.name === l.zoho_label), `${l.module}: the Field Explanation sheet has "${l.zoho_label}"`);
    assert.ok(TEMPLATES[l.module].headers.includes(l.zoho_label) && !TEMPLATES[l.module].headers.includes(l.sample_heading));
  }
});

test('the customer heading is Zoho\'s "Place Of Contact" everywhere, and a layout saved with the old heading is moved to it', () => {
  assert.ok(zoho.CUSTOMER_HEADERS.includes('Place Of Contact') && !zoho.CUSTOMER_HEADERS.includes('Place of Contact'));
  assert.deepEqual(HEADING_RENAMES.customers, [{ from: 'Place of Contact', to: 'Place Of Contact' }]);
  const old = [{ id: 'display_name', heading: 'Display Name', source: { type: 'builtin', builtin: 'display_name' } },
    { id: 'place_of_contact', heading: 'Place of Contact', source: { type: 'builtin', builtin: 'place_of_contact' } },
    { id: 'c_x', heading: 'Place of Contact', source: { type: 'fixed', value: 'KA' } }];
  const moved = migrateRenamedHeadings('customers', old);
  assert.deepEqual([moved[1].id, moved[1].heading, moved[1].source.builtin], ['place_of_contact', 'Place Of Contact', 'place_of_contact']);
  assert.equal(moved[2].heading, 'Place of Contact', 'a column the admin made keeps the admin\'s heading');
  // vendors: the explanation sheet\'s "Department" has another id than the sample row\'s "Depatment": a saved layout is moved too
  const v = migrateRenamedHeadings('vendors', [{ id: 'depatment', heading: 'Depatment', source: { type: 'builtin', builtin: 'depatment' } }, { id: 'depatment', heading: 'Dept', source: { type: 'builtin', builtin: 'depatment' } }]);
  assert.deepEqual(v.map(c => [c.id, c.heading, c.source.builtin]), [['department', 'Department', 'department'], ['department', 'Dept', 'department']]);
  // no rule or message of the check names the old spelling any more
  const rules = JSON.parse(fs.readFileSync(path.resolve(here, '../src/zohorules.json'), 'utf8'));
  delete rules.lists.map_field_labels; // the one place that records the old spelling
  assert.ok(!JSON.stringify(rules).includes('Place of Contact'));
});

test('Customers and Vendors files leave out optional columns that are empty on every row; nothing else changes', () => {
  const layout = key => ({ key, customised: false, columns: defaultColumns(key) });
  const row = (key, extra) => Object.fromEntries(defaultColumns(key).map(c => [c.id, extra[c.id] ?? '']));
  const rows = [row('customers', { display_name: 'A Co', place_of_contact: 'KA', gst_treatment: 'business_gst', phone: '9800000000', status: 'Active' }), row('customers', { display_name: 'B Co', status: 'Active' })];
  const heads = columnsToWrite('customers', layout('customers'), rows).map(c => c.heading);
  assert.ok(heads.length < 20, heads.join(', '));
  // kept: the always-kept ones even when empty (Opening Balance, Place Of Contact on a file of one overseas customer), and any column with a value
  for (const h of ['Display Name', 'Place Of Contact', 'GST Treatment', 'Opening Balance', 'Status', 'Phone']) assert.ok(heads.includes(h), h);
  for (const h of ['Customer Number', 'Portal Status', 'TDS Name', 'CustomField Value 1', 'Billing Fax']) assert.ok(!heads.includes(h), `${h} is left out`);
  // the order of the columns that stay is the sample's order
  assert.deepEqual(heads, TEMPLATES.customers.headers.filter(h => heads.includes(h)));
  // a value in any row keeps the column (TDS written on a customer, a company that uses custom fields)
  const withTds = [...rows, row('customers', { display_name: 'C Co', tds_name: 'Some TDS', tds_section_code: '194C', tds_percentage: '1' })];
  const heads2 = columnsToWrite('customers', layout('customers'), withTds).map(c => c.heading);
  assert.ok(['TDS Name', 'TDS Section Code', 'TDS Percentage'].every(h => heads2.includes(h)));
  // vendors: Source Of Supply stays (it is the vendor's place of supply), and an empty file keeps every column
  const vheads = columnsToWrite('vendors', layout('vendors'), [row('vendors', { display_name: 'V', status: 'Active' })]).map(c => c.heading);
  assert.ok(vheads.includes('Source Of Supply') && vheads.includes('Opening Balance') && !vheads.includes('Bank Name'));
  assert.equal(columnsToWrite('customers', layout('customers'), []).length, TEMPLATES.customers.headers.length, 'no rows: the whole heading row');
  // a layout an admin changed, and every other file, are written exactly as saved
  assert.equal(columnsToWrite('customers', { ...layout('customers'), customised: true }, rows).length, TEMPLATES.customers.headers.length);
  assert.equal(columnsToWrite('items', layout('items'), [row('items', { item_name: 'x' })]).length, TEMPLATES.items.headers.length);
  assert.equal(columnsToWrite('accounts', layout('accounts'), [row('accounts', { account_name: 'x' })]).length, TEMPLATES.accounts.headers.length);
});

// ---------- account types ----------
test('account types come from one table in zohorules.json; "Long Term Liability" is never written and a stored one is read as Non Current Liability', () => {
  const rows = LISTS.account_types;
  assert.ok(!ZOHO_ACCOUNT_TYPES.includes('Long Term Liability') && ZOHO_ACCOUNT_TYPES.includes('Non Current Liability'));
  assert.equal(accountTypeStatus('Long Term Liability'), 'not_valid_in_india');
  assert.ok(ZOHO_ACCOUNT_TYPES.every(t => ['confirmed', 'documented'].includes(accountTypeStatus(t))), 'every type offered in Mapping Studio is valid in India');
  assert.ok(Object.values(ACCOUNT_TYPE_BY_GROUP).every(t => ZOHO_ACCOUNT_TYPES.includes(t)), 'every type of a Tally group is an offered type');
  assert.equal(new Set(rows.map(r => r.name)).size, rows.length, 'a type is listed once');
  assert.ok(rows.every(r => r.status in LISTS.account_type_status_words), 'every status is explained');
  assert.deepEqual(['Loans (Liability)', 'Secured Loans', 'Unsecured Loans'].map(g => ACCOUNT_TYPE_BY_GROUP[g]), ['Non Current Liability', 'Non Current Liability', 'Non Current Liability']);
  assert.equal(canonicalAccountType('Long Term Liability'), 'Non Current Liability');
  assert.equal(canonicalAccountType('long term liability '), 'Non Current Liability');
  assert.equal(canonicalAccountType('cost of goods sold'), 'Cost Of Goods Sold');
  assert.equal(canonicalAccountType('Made Up Type'), null);
  assert.equal(canonicalAccountType('Deferred Tax Liability'), null, 'a type that India does not have is not offered');
  // the types Zoho India lists for liabilities (test 2): all valid or kept out of imports; Long Term Liability and Deferred Tax Liability are not valid
  const liabilities = rows.filter(r => r.category === 'Liability').map(r => `${r.name}:${r.status}`);
  assert.ok(liabilities.includes('Other Current Liability:confirmed') && liabilities.includes('Non Current Liability:documented') && liabilities.includes('Long Term Liability:not_valid_in_india'));
});

test('companies of different shapes: long term groups get Zoho India types, anything unconfirmed is flagged, an invalid type is flagged and blocks', () => {
  const check = (name, parent, ctx) => [].concat(TEMPLATES.accounts.check({ name, parent, openingbalance: '0' }, ctx)).map(f => f.kind || 'text').filter(k => k.startsWith('account_type'));
  const type = (parent, ctx) => TEMPLATES.accounts.row({ name: 'X', parent }, ctx)['Account Type'];
  // a trader with stock and a bank loan, a services company with a director loan under its own sub-group, a company with a custom long term group
  const ctx = { groupParents: { 'Term Loans from Banks': 'Secured Loans', 'Directors Loans': 'Unsecured Loans', 'Godown Stock': 'Stock-in-Hand', 'Gratuity Provision': 'Provisions' },
    groupReserved: {}, accountTypes: {}, groupNature: {} };
  assert.deepEqual(['Secured Loans', 'Term Loans from Banks', 'Directors Loans', 'Unsecured Loans', 'Loans (Liability)'].map(g => type(g, ctx)), Array(5).fill('Non Current Liability'));
  assert.equal(type('Godown Stock', ctx), 'Stock');
  assert.equal(type('Gratuity Provision', ctx), 'Other Current Liability', 'a provision stays current unless someone decides otherwise');
  assert.equal(type('Capital Account', ctx), 'Equity');
  // flags: confirmed types raise nothing; listed-but-unused types are an unconfirmed assumption
  assert.deepEqual(check('Cash Box', 'Cash-in-Hand', ctx), []);
  assert.deepEqual(check('Rent', 'Indirect Expenses', ctx), []);
  assert.deepEqual(check('Bank Loan', 'Term Loans from Banks', ctx), ['account_type_unconfirmed']);
  assert.deepEqual(check('Closing Stock', 'Godown Stock', ctx), ['account_type_unconfirmed']);
  assert.deepEqual(check('Shares', 'Investments', ctx), ['account_type_unconfirmed']);
  // a decision for a group wins; a stored type with the old name is read as the new name (extras.js migrateAccountTypes)
  const decided = { ...ctx, accountTypes: { 'Gratuity Provision': canonicalAccountType('Long Term Liability') } };
  assert.equal(type('Gratuity Provision', decided), 'Non Current Liability');
  assert.equal(resolveAccountType('Gratuity Provision', decided).source, 'decided');
  // a type that India does not have (a decision typed before this change and not migrated) is flagged as one Zoho will refuse
  const bad = { ...ctx, accountTypes: { 'Gratuity Provision': 'Long Term Liability' } };
  assert.deepEqual(check('Gratuity', 'Gratuity Provision', bad), ['account_type_not_valid_in_india']);
  assert.equal(accountType('Gratuity Provision', bad), 'Long Term Liability');
  // both kinds are in the Assumptions list: the unconfirmed one as unconfirmed, the invalid one as blocking
  assert.deepEqual([ASSUMPTIONS.account_type_unconfirmed.unconfirmed, !!ASSUMPTIONS.account_type_unconfirmed.blocking, ASSUMPTIONS.account_type_not_valid_in_india.blocking], [true, false, true]);
  assert.ok(!('account_type_refused_before' in ASSUMPTIONS));
});

test('the Zoho check flags any account type that is not a valid Zoho India type, whatever the company', () => {
  const run = types => {
    const file = { headers: ['Account Name', 'Account Type'], rows: types.map((t, i) => [`Account ${i}`, t]) };
    const f = checkFiles({ accounts: file }, {}).files[0];
    return f.causes.find(c => c.ruleId === 'COA-TYPE-ALLOWED');
  };
  assert.equal(run(['Bank', 'Cash', 'Non Current Liability', 'Other Current Liability', 'Equity', 'Stock', 'Other Asset', 'Fixed Asset']), undefined);
  assert.equal(run(['Bank', 'Long Term Liability']).rows, 1);
  assert.equal(run(['Deferred Tax Liability', 'Intangible Asset', 'Loans And Borrowing']).rows, 3, 'types of other Zoho products are refused too');
  assert.equal(run(['Long Term Liability']).tier, 'will');
  // the rule that asked for an account created by hand, and its pre-step machinery, are gone
  const rules = JSON.parse(fs.readFileSync(path.resolve(here, '../src/zohorules.json'), 'utf8'));
  assert.ok(!rules.modules.accounts.rules.some(r => r.params?.preStep || r.params?.watchList));
  assert.ok(rules.lists.error_messages.every(m => !(m.rule_ids || []).includes('COA-TYPE-LONG-TERM-LIABILITY')));
});
