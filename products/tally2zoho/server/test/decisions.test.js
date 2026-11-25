// Stage A1-A3: the GST treatment code set (per firm), item rates and accounts, and clashes with Zoho's own accounts.
// Every name, GSTIN and amount here is MADE UP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Decimal from 'decimal.js';
import { DatabaseSync } from 'node:sqlite';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-decisions-'));
const { buildApp } = await import('../src/index.js');
const { gstTreatment, parseCsv, JOURNAL_SAMPLE_HEADERS, openingJournalDate, TEMPLATES } = await import('../src/zoho.js');
const { GST_CODE_SETS, describeGstCodeSets, builtinAccount, ZOHO_BUILTIN_ACCOUNTS } = await import('../src/zohocodes.js');
const { parseUserRate, accountNameMapper } = await import('../src/decisions.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const samples = path.resolve(here, '../../sample-data');
const ZOHO_SAMPLES = path.resolve(here, '../../zoho-samples');
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
const readSample = f => JSON.parse(fs.readFileSync(path.join(samples, f), 'utf8').replace(/^﻿/, ''));
const putDoc = (id, slot, obj) => call({ method: 'PUT', url: `/api/migrations/${id}/uploads/${slot}`, headers: { 'content-type': 'application/octet-stream', 'x-filename': `${slot}.json` }, payload: Buffer.from(JSON.stringify(obj)) });
const FILES = {
  vendors: '02_vendors.json', stock_items: '04_stock_items.json', units: '05_units.json', taxes: '06_tax_configuration.json',
  sales: '07_sales_vouchers.json', purchase: '08_purchase_vouchers.json', receipt: '09_receipt_vouchers.json', payment: '10_payment_vouchers.json', trial_balance: '13_trial_balance.json',
};
const ledger = (name, parent, openingbalance, extra = {}) => ({ metadata: { type: 'Ledger', name }, name, parent, ...(openingbalance != null ? { openingbalance } : {}), ...extra });

// Made-up masters: the sample Chart of Accounts plus ledgers named like accounts Zoho Books creates itself.
function accountsDoc() {
  const doc = readSample('03_chart_of_accounts.json');
  doc.tallymessage.push(
    ledger('Advance tax', 'Loans & Advances (Asset)', '-1000.00'),   // debit 1000 (Zoho spells it "Advance Tax")
    ledger('TDS Receivable', 'Loans & Advances (Asset)', '-250.00'), // debit 250
    ledger('TDS Payable', 'Duties & Taxes', '1250.00'),              // credit 1250
    ledger('GST Payable', 'Duties & Taxes', '0'),
    ledger('Office Rent Payable', 'Current Liabilities', '400.00'));  // credit 400, no clash
  return doc;
}
function customersDoc() {
  const doc = readSample('01_customers.json');
  doc.tallymessage.push(
    ledger('Walk-in Buyer One', 'Sundry Debtors', '0', { gstregistrationtype: 'Unregistered/Consumer' }),
    ledger('Walk-in Buyer Two', 'Sundry Debtors', '0', { gstregistrationtype: 'Consumer' }),
    ledger('Small Shop Three', 'Sundry Debtors', '0', { gstregistrationtype: 'Unregistered' }));
  return doc;
}
function journalDoc() {
  const doc = readSample('11_journal_vouchers.json');
  doc.tallymessage.push({ metadata: { type: 'Voucher', vchtype: 'Journal' }, guid: 'made-up-guid-ob-1', date: '20240710', vouchertypename: 'Journal', vouchernumber: 'JO/MADEUP/1',
    narration: 'Made-up set-off', ledgerentries: [
      { ledgername: 'Advance tax', isdeemedpositive: true, amount: '-500.00' },
      { ledgername: 'TDS Payable', isdeemedpositive: false, amount: '500.00' }] });
  return doc;
}

async function setUp() {
  const r = await send('POST', '/api/migrations', { company: 'Apex Engineering Technologies Pvt. Ltd.', financialYear: '2024-25' });
  assert.equal(r.statusCode, 201);
  const id = r.json().id;
  for (const [slot, f] of Object.entries(FILES)) {
    const u = await call({ method: 'PUT', url: `/api/migrations/${id}/uploads/${slot}`, headers: { 'content-type': 'application/octet-stream', 'x-filename': f }, payload: fs.readFileSync(path.join(samples, f)) });
    assert.equal(u.statusCode, 200, slot);
  }
  for (const [slot, doc] of [['accounts', accountsDoc()], ['customers', customersDoc()], ['journal', journalDoc()]]) assert.equal((await putDoc(id, slot, doc)).statusCode, 200, slot);
  await send('PUT', `/api/migrations/${id}/waivers/stock_summary`, { reason: 'Not needed for test' });
  assert.equal((await send('POST', `/api/migrations/${id}/process`)).statusCode, 200);
  // the made-up journal has no customer or vendor: a clear Manual Journal suggestion
  assert.equal((await send('POST', `/api/migrations/${id}/journals/accept-suggestions`, {})).statusCode, 200);
  return id;
}
const generate = async base => { const g = await send('POST', `${base}/generate`); assert.equal(g.statusCode, 200, g.body); return Object.fromEntries(g.json().files.map(f => [f.key, f])); };
const csv = async (base, key) => { const r = await call({ url: `${base}/files/${key}/download?confirmed=1` }); assert.equal(r.statusCode, 200, `${key}: ${r.body}`); return parseCsv(r.body); };
const flags = async (base, kind) => (await get(`${base}/summary`)).exceptions.filter(e => e.stage === 'generate' && e.kind === kind);
const g2 = (type, set, as) => gstTreatment({ gstin: '', country: 'India', registrationType: type }, set, as).value;
const trail = async id => (await get(`/api/migrations/${id}/audit`)).map(a => `${a.actor} | ${a.action} | ${a.detail}`);

// ================= 1. GST treatment codes =================
test('A1: both GST code sets map every kind of party, and the help page set never guesses "Unregistered/Consumer"', () => {
  const base = { gstin: '', country: 'India' };
  const g = (type, set, extra = {}) => gstTreatment({ ...base, registrationType: type, ...extra }, set);
  const regular = { gstin: '29ABCDE1234F1Z5' };
  assert.equal(g('Regular', 'sample', regular).value, 'business_gst');
  assert.equal(g('Regular', 'help', regular).value, 'business_registered_regular');
  assert.equal(g('Regular', undefined, regular).value, 'business_gst', 'the sample set is the default');
  assert.equal(g('Regular', 'help', { ...regular, sez: true }).value, 'business_sez');
  assert.equal(g('Composition', 'help', regular).value, 'business_registered_composition');
  assert.equal(g('Unregistered', 'sample').value, 'business_none');
  assert.equal(g('Unregistered', 'help').value, 'business_unregistered');
  assert.equal(g('Consumer', 'sample').value, 'business_none');
  assert.equal(g('Consumer', 'help').value, 'consumer');
  assert.equal(g('Unregistered/Consumer', 'sample').value, 'business_none');
  const amb = g('Unregistered/Consumer', 'help');
  assert.equal(amb.value, '');
  assert.equal(amb.problem.kind, 'gst_treatment_ambiguous');
  assert.match(amb.problem.message, /business_unregistered.*consumer/);
  assert.equal(g('Unregistered', 'help', { country: 'Germany' }).value, 'overseas');
  assert.equal(g('', 'help', { country: 'Germany' }).value, 'overseas');
  assert.match(g('', 'help').problem.message, /business_registered_regular/, 'the message names the codes of the chosen set');
  assert.equal(g('Regular', 'help').problem.kind, 'gst_registered_without_gstin', 'a registered party without a GSTIN is still flagged');
  // every kind is explained, in both sets
  const d = describeGstCodeSets();
  assert.deepEqual(d.map(x => x.id), ['sample', 'help']);
  for (const s of d) for (const r of s.rows) assert.ok(r.meaning.length > 10 && (r.code === null || /^[a-z_]+$/.test(r.code)));
  assert.deepEqual(Object.keys(GST_CODE_SETS.sample.codes), Object.keys(GST_CODE_SETS.help.codes));
});

test('A1: the GST code setting is per firm, admin only, used for Customers and Vendors, and marks those files out of date only when they differ', async () => {
  await login('admin');
  const id = await setUp();
  const base = `/api/migrations/${id}`;
  await generate(base);
  let s = await get('/api/settings/gst-codes');
  assert.deepEqual([s.codeSet, s.default, s.canChange], ['sample', 'sample', true]);
  let cust = Object.fromEntries((await csv(base, 'customers')).rows.map(r => [r['Display Name'], r['GST Treatment']]));
  assert.deepEqual([cust['Adani Solar Equipment Ltd.'], cust['Walk-in Buyer One'], cust['Walk-in Buyer Two'], cust['Small Shop Three']], ['business_gst', 'business_none', 'business_none', 'business_none']);

  // an analyst and a viewer can read the setting but not change it
  await login('analyst');
  assert.equal((await get('/api/settings/gst-codes')).canChange, false);
  assert.equal((await send('PUT', '/api/settings/gst-codes', { codeSet: 'help' })).statusCode, 403);
  await login('viewer');
  assert.equal((await send('PUT', '/api/settings/gst-codes', { codeSet: 'help' })).statusCode, 403);

  await login('admin');
  assert.equal((await send('PUT', '/api/settings/gst-codes', { codeSet: 'nonsense' })).statusCode, 400);
  let r = await send('PUT', '/api/settings/gst-codes', { codeSet: 'help' });
  assert.equal(r.statusCode, 200);
  assert.deepEqual([r.json().codeSet, r.json().changed], ['help', true]);
  let m = await get(base);
  // changed on purpose: Invoices and Bills write the contact's GST Treatment too; and (audit item 5) whatever changes
  // invoices or bills can move a journal routed by default to the Manual Journals file, and the service items follow
  assert.deepEqual(m.outOfDateFiles.sort(), ['bills', 'customers', 'invoices', 'items', 'journals', 'vendors']);
  assert.ok((await trail(id)).some(x => /gst_code_set_changed \| GST treatment codes "As in Zoho's import sample files \(default\)" -> "As on Zoho's help page"/.test(x)));
  assert.equal((await call({ url: `${base}/files/customers/download` })).statusCode, 409, 'an out-of-date file cannot be downloaded');
  // changing back to the codes the files were built with: no longer out of date
  await send('PUT', '/api/settings/gst-codes', { codeSet: 'sample' });
  assert.deepEqual((await get(base)).outOfDateFiles, []);
  await send('PUT', '/api/settings/gst-codes', { codeSet: 'help' });
  assert.equal((await send('PUT', '/api/settings/gst-codes', { codeSet: 'help' })).json().changed, false);

  await generate(base);
  cust = Object.fromEntries((await csv(base, 'customers')).rows.map(r => [r['Display Name'], r['GST Treatment']]));
  assert.deepEqual([cust['Adani Solar Equipment Ltd.'], cust['Walk-in Buyer One'], cust['Walk-in Buyer Two'], cust['Small Shop Three']], ['business_registered_regular', '', 'consumer', 'business_unregistered']);
  const amb = await flags(base, 'gst_treatment_ambiguous');
  assert.deepEqual(amb.map(f => f.name), ['Walk-in Buyer One']);
  // the admin's standing decision for "Unregistered/Consumer" (only used with the help page codes)
  assert.equal((await send('PUT', '/api/settings/gst-codes', { unregisteredConsumerAs: 'maybe' })).statusCode, 400);
  r = await send('PUT', '/api/settings/gst-codes', { unregisteredConsumerAs: 'consumer' });
  assert.deepEqual([r.json().codeSet, r.json().unregisteredConsumerAs, r.json().changed], ['help', 'consumer', true]);
  assert.deepEqual((await get(base)).outOfDateFiles.sort(), ['bills', 'customers', 'invoices', 'items', 'journals', 'vendors']);
  await generate(base);
  cust = Object.fromEntries((await csv(base, 'customers')).rows.map(r => [r['Display Name'], r['GST Treatment']]));
  assert.equal(cust['Walk-in Buyer One'], 'consumer');
  assert.deepEqual(await flags(base, 'gst_treatment_ambiguous'), []);
  assert.ok((await trail(id)).some(x => x.includes('"Unregistered/Consumer" left empty and flagged (decide party by party) -> "As on Zoho\'s help page", "Unregistered/Consumer" written as consumer')));
  assert.equal(g2('Unregistered/Consumer', 'sample', 'consumer'), 'business_none', 'the sample codes have one code for both');
  const vend = (await csv(base, 'vendors')).rows;
  assert.ok(vend.every(v => !['business_gst', 'business_none'].includes(v['GST Treatment'])), 'vendors use the same set');
  // the Tally record is never changed
  const rec = (await get(`${base}/records?slot=customers`));
  assert.ok(JSON.stringify(rec).includes('Unregistered/Consumer'));
  await send('PUT', '/api/settings/gst-codes', { codeSet: 'sample', unregisteredConsumerAs: '' }); // leave the firm on the defaults for the other tests
});

// ================= 2. Item rates and accounts =================
test('A2: user rates are checked and never rounded', () => {
  assert.deepEqual(parseUserRate('1,250.5'), { value: '1250.50' });
  assert.deepEqual(parseUserRate(' 0 '), { value: '0.00' });
  assert.deepEqual(parseUserRate(''), { value: '' });
  for (const bad of ['12.345', '-5', 'abc', '1.2.3', '10%']) assert.ok(parseUserRate(bad).error, bad);
});

test('A2: rates per item, pasted, or one default; accounts and tax preference; item_rate_missing clears when every item has a rate', async () => {
  await login('analyst');
  const id = await setUp();
  const base = `/api/migrations/${id}`;
  await generate(base);
  let v = await get(`${base}/item-rates`);
  assert.equal(v.counts.items, 5);
  assert.equal(v.counts.withoutSellingRate, 5);
  // v2 default 3 (changed on purpose): an item with no selling rate no longer blocks the file ("item_rate_missing").
  // It is written with Rate 0.00 and flagged itself as an assumption ("item_rate_zero"), one flagged item per item.
  assert.deepEqual(await flags(base, 'item_rate_missing'), []);
  assert.equal((await flags(base, 'item_rate_zero')).length, 5);
  assert.ok((await csv(base, 'items')).rows.every(x => x.Rate === '0.00'), 'Zoho requires a selling price: 0.00 by default');
  const [a, b, c, d, e] = v.items.map(x => x.item);

  // one item
  let r = await send('PUT', `${base}/item-rates`, { item: a, rate: '1,250.50', purchaseRate: '900' });
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(r.json().items.find(x => x.item === a).sellingRateUsed, '1250.50');
  assert.equal((await send('PUT', `${base}/item-rates`, { item: a, rate: '12.345' })).statusCode, 400);
  assert.equal((await send('PUT', `${base}/item-rates`, { item: 'No such item', rate: '1' })).statusCode, 404);
  assert.deepEqual((await get(base)).outOfDateFiles, ['items']);
  assert.ok((await trail(id)).some(x => x.includes(`item_setting_changed | Item "${a}" (entered in Mapping Studio): selling rate "" -> "1250.50", purchase rate "" -> "900.00"`)));

  // pasted lines: name<TAB>rate[<TAB>purchase rate]; names are matched ignoring capital letters and spaces around them
  r = await send('POST', `${base}/item-rates/paste`, { text: `${b}\t75\n  ${c.toUpperCase()} \t80\t60\nUnknown thing\t5\n${d}\tabc\nno tab here\n${b}\t99\n` });
  assert.equal(r.statusCode, 200, r.body);
  const p = r.json();
  assert.deepEqual([p.read, p.changed, p.notFound.length, p.unreadable.length, p.repeated.length], [2, 2, 1, 2, 1]);
  assert.equal(p.items.find(x => x.item === c).purchaseRateUsed, '60.00');
  assert.equal(p.items.find(x => x.item === b).sellingRateUsed, '75.00', 'a repeated line is not used');

  // one default for every item without a rate
  assert.equal((await send('POST', `${base}/item-rates/default`, {})).statusCode, 400);
  r = await send('POST', `${base}/item-rates/default`, { rate: '10', purchaseRate: '8' });
  assert.equal(r.statusCode, 200);
  v = r.json();
  assert.equal(v.counts.withoutSellingRate, 0);
  assert.deepEqual(v.items.map(x => x.sellingRateUsed), ['1250.50', '75.00', '80.00', '10.00', '10.00']);
  assert.deepEqual([v.items.find(x => x.item === c).purchaseRateUsed, v.items.find(x => x.item === e).purchaseRateUsed], ['60.00', '8.00'], 'an item that has a purchase rate keeps it');

  // accounts: free text or a Chart of Accounts name
  assert.ok(v.accountOptions.fromChartOfAccounts.includes('Sales - Spares'));
  assert.ok(v.accountOptions.zohoOwn.includes('Cost of Goods Sold'));
  assert.equal((await send('PUT', `${base}/item-accounts`, { salesAccount: 'Sales - Spares', purchaseAccount: 'Cost of Goods Sold' })).statusCode, 200);
  assert.equal((await send('PUT', `${base}/item-accounts`, { salesAccount: 'x'.repeat(101) })).statusCode, 400);

  // tax preference: a taxable item needs both taxes; with a saved Zoho tax list the names must be in it
  assert.equal((await send('PUT', `${base}/item-rates`, { item: a, taxability: 'Taxable', intraTax: 'GST18' })).statusCode, 400);
  assert.equal((await send('PUT', `${base}/item-rates`, { item: b, taxability: 'Non-Taxable' })).statusCode, 400);
  assert.equal((await send('PUT', `${base}/item-rates`, { item: b, taxability: 'Something' })).statusCode, 400);
  assert.equal((await send('PUT', `${base}/zoho-taxes`, { text: 'GST18\nIGST18' })).statusCode, 200);
  r = await send('PUT', `${base}/item-rates`, { item: a, taxability: 'Taxable', intraTax: 'GST 18', interTax: 'IGST18', taxRate: '18' });
  assert.equal(r.statusCode, 400, 'not in the Zoho tax list');
  assert.match(r.json().error, /not in your Zoho tax list/);
  assert.equal((await send('PUT', `${base}/item-rates`, { item: a, taxability: 'Taxable', intraTax: 'gst18', interTax: 'IGST18', taxRate: '18' })).statusCode, 200);
  assert.equal((await send('PUT', `${base}/item-rates`, { item: b, taxability: 'Non-Taxable', exemptionReason: 'Made-up exemption' })).statusCode, 200);

  // a viewer reads only
  await login('viewer');
  assert.equal((await send('PUT', `${base}/item-rates`, { item: a, rate: '1' })).statusCode, 403);
  assert.equal((await send('POST', `${base}/item-rates/default`, { rate: '1' })).statusCode, 403);
  await login('analyst');

  await generate(base);
  assert.deepEqual(await flags(base, 'item_rate_zero'), [], 'every item has a rate');
  assert.equal((await flags(base, 'item_tax_preference_not_set'))[0].uses, 3);
  const items = Object.fromEntries((await csv(base, 'items')).rows.map(x => [x['Item Name'], x]));
  const pick = (x, cols) => cols.map(col => x[col]);
  assert.deepEqual(pick(items[a], ['Rate', 'Purchase Rate', 'Account', 'Purchase Account', 'Taxability Type', 'Intra State Tax Name', 'Intra State Tax Type', 'Intra State Tax Rate', 'Inter State Tax Name', 'Inter State Tax Type', 'Inter State Tax Rate']),
    ['1250.50', '900.00', 'Sales - Spares', 'Cost of Goods Sold', 'Taxable', 'GST18', 'Group', '18', 'IGST18', 'Simple', '18']);
  assert.deepEqual(pick(items[b], ['Rate', 'Taxability Type', 'Exemption Reason', 'Intra State Tax Name']), ['75.00', 'Non-Taxable', 'Made-up exemption', '']);
  assert.deepEqual(pick(items[e], ['Rate', 'Purchase Rate', 'Taxability Type']), ['10.00', '8.00', '']);
  // the Tally record is not changed
  assert.ok(!JSON.stringify(await get(`${base}/records?slot=stock_items`)).includes('1250.50'));

  // clearing a rate brings the flag back
  await send('PUT', `${base}/item-rates`, { item: e, rate: '' });
  await generate(base);
  assert.deepEqual((await flags(base, 'item_rate_zero')).map(f => f.name), [e], 'the default is back for that item, and it says so');
  assert.equal((await csv(base, 'items')).rows.find(x => x['Item Name'] === e).Rate, '0.00');
});

// ================= 3. Zoho's own accounts =================
test('A3: the list of Zoho\'s own accounts holds the required names, compared ignoring case and hidden characters', () => {
  // changed on purpose: "TCS Receivable" was in this list. The first real import created that account without error, so
  // Zoho did not have it: it is no longer treated as one of Zoho's own accounts (ZOHO_ACCOUNTS_NOT_ALWAYS_PRESENT).
  assert.ok(!ZOHO_BUILTIN_ACCOUNTS.includes('TCS Receivable') && builtinAccount('TCS Receivable') === null);
  // changed on purpose (audit item 10): ONE list, zohorules.json lists.default_accounts marked "yes". "TCS Payable" is
  // marked "unknown" there (TCS was not turned on in the test organisation, which had no TCS Receivable either), so it
  // is no longer treated as one of Zoho's own accounts; the 12 names only the rules had are in now
  assert.ok(!ZOHO_BUILTIN_ACCOUNTS.includes('TCS Payable'));
  for (const n of ['Input Tax Credits', 'Dividends Paid', 'Merchandise']) assert.ok(ZOHO_BUILTIN_ACCOUNTS.includes(n), n);
  for (const n of ['Advance Tax', 'TDS Receivable', 'TDS Payable', 'GST Payable', 'Input CGST', 'Input SGST', 'Input IGST',
    'Output CGST', 'Output SGST', 'Output IGST', 'Accounts Receivable', 'Accounts Payable', 'Opening Balance Adjustments', 'Retained Earnings', 'Undeposited Funds', 'Petty Cash']) {
    assert.ok(ZOHO_BUILTIN_ACCOUNTS.includes(n), n);
  }
  assert.equal(builtinAccount('advance  TAX\r\n'), 'Advance Tax');
  assert.equal(builtinAccount('﻿TDS Payable'), 'TDS Payable');
  assert.equal(builtinAccount('TDS Payable (Tally)'), null);
  const map = accountNameMapper({ 'Advance tax\r\n': { decision: 'zoho' }, 'TDS Payable': { decision: 'rename', newName: 'TDS Payable (Tally)' }, 'GST Payable': { decision: 'keep' } });
  assert.deepEqual(['Advance tax', 'TDS Payable', 'GST Payable', 'Cash'].map(map), ['Advance Tax', 'TDS Payable (Tally)', 'GST Payable', 'Cash']);
  assert.equal(openingJournalDate('2024-04-01'), '2024-03-31');
  assert.equal(openingJournalDate('2025-04-01'), '2025-03-31');
});

test('A3: the opening balance journal uses the headings of Zoho\'s journal import sample', t => {
  assert.equal(JOURNAL_SAMPLE_HEADERS.length, 15);
  assert.deepEqual(TEMPLATES.opening_balances_for_zoho_accounts.headers, JOURNAL_SAMPLE_HEADERS);
  const file = path.join(ZOHO_SAMPLES, 'sample_journals.xls');
  if (!fs.existsSync(file)) { t.skip('sample_journals.xls is not present'); return; }
  // An old-style .xls workbook: each heading is stored as text in the file (8-bit or UTF-16). Their order was read
  // from the sample with a spreadsheet reader when this template was written.
  const buf = fs.readFileSync(file);
  for (const h of JOURNAL_SAMPLE_HEADERS) assert.ok(buf.includes(Buffer.from(h, 'latin1')) || buf.includes(Buffer.from(h, 'utf16le')), h);
});

// v2 (changed on purpose; this test replaces "each clash is renamed, put on Zoho's own account, or left; undecided ones
// stay flagged"). The zero-decision path: a ledger named like one of Zoho's own accounts is entered on Zoho's own account
// BY DEFAULT (Zoho: "Row already exists" for a second account of that name). "Leave as it is" is no longer a choice.
// A decision made by a person (rename, or Zoho's own account) always wins, and there is one action for all of them.
test('A3: a clash uses Zoho\'s own account by default (its balance goes to a balanced journal); it can be renamed, one by one or all at once; "leave as it is" is gone', async () => {
  await login('analyst');
  const id = await setUp();
  const base = `/api/migrations/${id}`;
  await generate(base);
  let v = await get(`${base}/account-clashes`);
  assert.deepEqual(v.clashes.map(c => [c.ledger, c.zohoAccount, c.openingBalance && `${c.openingBalance.amount} ${c.openingBalance.side}`, c.decision, c.effective, c.byDefault]),
    [['Advance tax', 'Advance Tax', '1000.00 Debit', null, 'zoho', true], ['TDS Receivable', 'TDS Receivable', '250.00 Debit', null, 'zoho', true],
      ['TDS Payable', 'TDS Payable', '1250.00 Credit', null, 'zoho', true], ['GST Payable', 'GST Payable', null, null, 'zoho', true]]);
  assert.deepEqual([v.undecided, v.onDefault, v.defaultDecision, v.options], [4, 4, 'zoho', ['rename', 'zoho']]);
  assert.equal(v.clashes[2].suggestedName, 'TDS Payable (Tally)');
  assert.equal(v.openingJournalDate, '2024-03-31');
  // with no decision at all: nothing is written with a clashing name, every default is a flagged item, nothing blocks
  assert.deepEqual(await flags(base, 'zoho_builtin_account_name'), []);
  assert.deepEqual((await flags(base, 'default_zoho_own_account')).map(f => f.name).sort(), ['Advance tax', 'GST Payable', 'TDS Payable', 'TDS Receivable']);
  let rep = await get(`${base}/test-report`);
  assert.ok(!rep.whatToFixNext.some(x => x.blocking && x.message.includes('zoho_builtin_account')), 'a clash with no decision no longer blocks the import');
  assert.equal(rep.assumptions.find(a => a.kind === 'default_zoho_own_account').count, 4);
  let acc = (await csv(base, 'accounts')).rows;
  assert.deepEqual(acc.map(x => x['Account Name']).filter(n => /advance tax|tds|gst payable/i.test(n)), [], 'none of the four is in the Chart of Accounts');
  let ob = await csv(base, 'opening_balances_for_zoho_accounts');
  // OB-007: Advance Tax and TDS Receivable lines were taken by Zoho in our imports (OB-1); a TDS Payable line was not
  // proven, so it is in OB-3; each journal balances on Opening Balance Adjustments, which nets to zero over the file
  assert.deepEqual(ob.rows.map(x => [x['Journal Number Suffix'], x.Account, x.Debit, x.Credit]), [['1', 'Advance Tax', '1000.00', ''], ['1', 'TDS Receivable', '250.00', ''], ['1', 'Opening Balance Adjustments', '', '1250.00'],
    ['3', 'TDS Payable', '', '1250.00'], ['3', 'Opening Balance Adjustments', '1250.00', '']],
    'the three balances, on Zoho\'s own accounts, each once; Opening Balance Adjustments nets to zero');
  assert.ok((await trail(id)).some(x => / \| default_applied \| Accounts with the name of one of Zoho's own accounts: 4\./.test(x)), 'the default is in the audit log');

  // refused decisions
  const put = body => send('PUT', `${base}/account-clashes`, body);
  assert.equal((await put({ ledger: 'Cash', decision: 'rename', newName: 'Cash 2' })).statusCode, 404, 'not a clash');
  assert.equal((await put({ ledger: 'TDS Payable', decision: 'delete' })).statusCode, 400);
  const keep = await put({ ledger: 'GST Payable', decision: 'keep' });
  assert.equal(keep.statusCode, 400, '"leave as it is" is no longer a choice');
  assert.match(keep.json().error, /Leaving the account as it is is no longer a choice/);
  assert.equal((await put({ ledger: 'TDS Payable', decision: 'rename', newName: '' })).statusCode, 400);
  // (changed on purpose: TCS Payable is not on the one list of Zoho's own accounts any more; GST Payable is)
  assert.match((await put({ ledger: 'TDS Payable', decision: 'rename', newName: 'gst payable' })).json().error, /also the name of an account Zoho Books creates/);
  assert.match((await put({ ledger: 'TDS Payable', decision: 'rename', newName: 'CASH' })).json().error, /already called/);
  await login('viewer');
  assert.equal((await put({ ledger: 'TDS Payable', decision: 'zoho' })).statusCode, 403);
  assert.equal((await send('POST', `${base}/account-clashes/bulk`, { decision: 'zoho' })).statusCode, 403);
  await login('analyst');

  // a decision always wins over the default. Choosing the default explicitly changes no file; a rename does.
  let r = await put({ ledger: 'Advance tax', decision: 'zoho' });
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual((await get(base)).outOfDateFiles, [], 'the files already use Zoho\'s own account for it');
  r = await put({ ledger: 'TDS Payable', decision: 'rename', newName: 'TDS Payable (Tally)' });
  assert.equal(r.statusCode, 200, r.body);
  v = await get(`${base}/account-clashes`);
  assert.deepEqual([v.undecided, v.onDefault], [2, 2]);
  const m = await get(base);
  assert.ok(m.outOfDateFiles.includes('accounts') && m.outOfDateFiles.includes('journals'));
  assert.ok((await trail(id)).some(x => /account_clash_decided \| Ledger "Advance tax" \(name of Zoho's own account "Advance Tax"\): not decided \(the default: use Zoho's own "Advance Tax"\) -> use Zoho's own "Advance Tax"\. Its opening balance 1000\.00 Debit goes to the opening balance journal/.test(x)));
  assert.ok((await trail(id)).some(x => x.includes('account_clash_decided | Ledger "TDS Payable" (name of Zoho\'s own account "TDS Payable"): not decided (the default: use Zoho\'s own "TDS Payable") -> rename to "TDS Payable (Tally)"')));

  const files = await generate(base);
  assert.ok(files.opening_balances_for_zoho_accounts, 'the journal file is created');
  assert.deepEqual(await flags(base, 'zoho_builtin_account_name'), []);
  assert.deepEqual((await flags(base, 'zoho_builtin_account_used')).map(f => f.name), ['Advance tax'], 'decided by a person');
  assert.deepEqual((await flags(base, 'default_zoho_own_account')).map(f => f.name).sort(), ['GST Payable', 'TDS Receivable'], 'still on the default');

  acc = (await csv(base, 'accounts')).rows;
  const names = acc.map(x => x['Account Name']);
  assert.ok(!names.includes('Advance tax') && !names.includes('TDS Receivable') && !names.includes('GST Payable'), 'left out of the Chart of Accounts');
  assert.ok(names.includes('TDS Payable (Tally)') && !names.includes('TDS Payable'));
  ob = await csv(base, 'opening_balances_for_zoho_accounts');
  assert.deepEqual(ob.headers, JOURNAL_SAMPLE_HEADERS);
  assert.deepEqual(ob.rows.map(x => [x['Journal Date'], x['Journal Number Prefix'], x['Journal Number Suffix'], x.Account, x.Debit, x.Credit, x.Status, x.Currency]), [
    ['2024-03-31', 'OB-', '1', 'Advance Tax', '1000.00', '', 'published', 'INR'],
    ['2024-03-31', 'OB-', '1', 'TDS Receivable', '250.00', '', 'published', 'INR'],
    // changed on purpose (opening balance batch): the renamed ledger's own balance is in the journal too (no balance stays in
    // the Chart of Accounts file). OB-007: its account is an Other Current Liability of its own, a kind of line no import
    // has taken yet, so it is in OB-3, balanced on its own; Opening Balance Adjustments nets to zero over the file
    ['2024-03-31', 'OB-', '1', 'Opening Balance Adjustments', '', '1250.00', 'published', 'INR'],
    ['2024-03-31', 'OB-', '3', 'TDS Payable (Tally)', '', '1250.00', 'published', 'INR'],
    ['2024-03-31', 'OB-', '3', 'Opening Balance Adjustments', '1250.00', '', 'published', 'INR']]);
  assert.match(ob.rows[0].Description, /Tally ledger "Advance tax"/);
  assert.equal((await flags(base, 'opening_balance_journal_for_zoho_accounts'))[0].uses, 3);
  // the journal file comes after the Chart of Accounts in the import order; changed on purpose (audit item 9): ONE
  // order, the Import Wizard's (Zoho's: opening balances after the accounts, contacts and items)
  const order = (await get(`${base}/imports`)).map(i => i.key);
  assert.ok(order.indexOf('opening_balances_for_zoho_accounts') > order.indexOf('accounts'));
  assert.deepEqual(order.slice(0, 5), ['accounts', 'customers', 'vendors', 'items', 'opening_balances_for_zoho_accounts'].filter(k => order.includes(k)));

  // tie-out: every Chart of Accounts ledger's opening balance is written once, in the Chart of Accounts or in the journal
  const signed = (dr, cr) => new Decimal(dr || 0).minus(cr || 0); // debit positive
  const written = new Map();
  for (const x of acc) if (x['Opening Balance']) written.set(x['Account Name'], x['Debit or Credit'] === 'Debit' ? new Decimal(x['Opening Balance']) : new Decimal(x['Opening Balance']).negated());
  for (const x of ob.rows.filter(x => x.Account !== 'Opening Balance Adjustments')) written.set(x.Description.match(/"(.*)"/)[1], signed(x.Debit, x.Credit));
  assert.deepEqual(Object.fromEntries([...written].map(([k, a]) => [k, a.toFixed(2)])),
    // (changed on purpose, opening balance batch: the renamed ledger's balance is a journal line too, described by its Tally name)
    { 'Advance tax': '1000.00', 'TDS Receivable': '250.00', 'TDS Payable': '-1250.00', 'Office Rent Payable': '-400.00' });
  const journalTotal = ob.rows.reduce((t, x) => t.plus(signed(x.Debit, x.Credit)), new Decimal(0));
  assert.ok(journalTotal.isZero(), 'the journal balances');

  // the voucher files name the account as written in the Chart of Accounts, or Zoho's own account
  const j = (await csv(base, 'journals')).rows.filter(x => x['Reference Number'] === 'JO/MADEUP/1'); // B6: the journal file follows Zoho's sample
  assert.deepEqual(j.map(x => x.Account), ['Advance Tax', 'TDS Payable (Tally)']);

  // ---- one action for all of them ----
  const bulk = body => send('POST', `${base}/account-clashes/bulk`, body);
  assert.equal((await bulk({ decision: 'keep' })).statusCode, 400);
  // all: rename. A ledger with no name given gets "<name> (Tally)"; nothing is stored unless every name is accepted.
  r = await bulk({ decision: 'rename', names: { 'GST Payable': 'tds payable' } });
  assert.equal(r.statusCode, 400);
  assert.deepEqual(r.json().errors.map(e => e.ledger), ['GST Payable']);
  assert.deepEqual((await get(`${base}/account-clashes`)).clashes.map(c => c.decision), ['zoho', null, 'rename', null], 'nothing was changed');
  r = await bulk({ decision: 'rename', names: { 'GST Payable': 'GST Payable (old books)' } });
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(r.json().clashes.map(c => [c.decision, c.newName]), [['rename', 'Advance tax (Tally)'], ['rename', 'TDS Receivable (Tally)'], ['rename', 'TDS Payable (Tally)'], ['rename', 'GST Payable (old books)']]);
  assert.equal(r.json().changed, 3, 'TDS Payable already had that name');
  assert.ok((await trail(id)).some(x => x.includes('account_clash_decided | Ledger "GST Payable" (name of Zoho\'s own account "GST Payable") (all: rename): not decided (the default: use Zoho\'s own "GST Payable") -> rename to "GST Payable (old books)"')));
  let again = await generate(base);
  // changed on purpose (opening balance batch): a renamed account is written in the Chart of Accounts WITHOUT its opening
  // balance, like every account; the balance is a line of the opening balance journal on the renamed account
  assert.ok(again.opening_balances_for_zoho_accounts, 'the journal file carries the balances of the renamed accounts');
  acc = (await csv(base, 'accounts')).rows;
  assert.deepEqual(['Advance tax (Tally)', 'TDS Receivable (Tally)', 'TDS Payable (Tally)', 'GST Payable (old books)'].map(n => acc.find(x => x['Account Name'] === n)?.['Opening Balance']), ['', '', '', ''],
    'no account carries an opening balance in the Chart of Accounts');
  const renamedJournal = (await csv(base, 'opening_balances_for_zoho_accounts')).rows;
  assert.deepEqual(['Advance tax (Tally)', 'TDS Receivable (Tally)', 'TDS Payable (Tally)'].map(n => { const x = renamedJournal.find(l => l.Account === n); return [x?.Debit, x?.Credit]; }), [['1000.00', ''], ['250.00', ''], ['', '1250.00']]);
  assert.deepEqual([await flags(base, 'default_zoho_own_account'), await flags(base, 'zoho_builtin_account_name')], [[], []]);
  // all: use Zoho's own account
  r = await bulk({ decision: 'zoho' });
  assert.deepEqual([r.statusCode, r.json().changed, r.json().undecided], [200, 4, 0]);
  again = await generate(base);
  assert.deepEqual((await flags(base, 'zoho_builtin_account_used')).map(f => f.name).sort(), ['Advance tax', 'GST Payable', 'TDS Payable', 'TDS Receivable']);
  // all: no decision. The default applies again, and it gives the same files as choosing Zoho's own account.
  r = await bulk({ decision: null });
  assert.deepEqual([r.statusCode, r.json().undecided, r.json().onDefault], [200, 4, 4]);
  assert.deepEqual((await get(base)).outOfDateFiles, [], 'nothing the files are built with changed');
  // a stored "leave as it is" from an earlier version is read as no decision
  const db = new DatabaseSync(path.join(process.env.DATA_DIR, 'migration.db'));
  db.prepare("INSERT OR REPLACE INTO account_clash_decisions (job_id, ledger, decision, new_name, decided_by, at) VALUES (?, 'GST Payable', 'keep', NULL, 'old@demo.test', '2025-01-01T00:00:00.000Z')").run(id);
  db.close();
  v = await get(`${base}/account-clashes`);
  assert.deepEqual(v.clashes.find(c => c.ledger === 'GST Payable'), { ...v.clashes.find(c => c.ledger === 'GST Payable'), decision: null, effective: 'zoho', byDefault: true });
});
