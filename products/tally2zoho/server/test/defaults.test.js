// v2, THE ZERO-DECISION PATH: every open decision has an automatic, Zoho-safe default, a decision made by a person always
// wins, and every default applied is flagged, audited and listed as "Assumptions the tool made". These tests cover each
// default (defaults.js) and the bugs fixed with it (M1, M2, M6, M7, M8, Fix contacts, the import tracker).
// Every name, number, GSTIN and amount here is MADE UP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wizardReady } from './wizardready.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import Decimal from 'decimal.js';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-defaults-'));
const { buildApp } = await import('../src/index.js');
const D = await import('../src/defaults.js');
const { NameSet } = await import('../src/tally.js');
const { buildVoucherOutput, taxLedgerInfo, BILL_HEADERS } = await import('../src/vouchers.js');
const { parseCsv, defaultAccountType, accountType, TEMPLATES } = await import('../src/zoho.js');
const { makeNameResolver } = await import('../src/namefix.js');
const { readTable, MAX_ROWS, MAX_COLUMNS, MAX_ENTRY_BYTES } = await import('../src/sheet.js');
const { mastersDoc, VOUCHERS, transactionsDoc, trialBalanceReport, utf16le, voucher, line, ledger, group } = await import('../fixtures/allTransactions.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(fs.readFileSync(path.resolve(here, '../seed-users.json'), 'utf8'));

// ===================================================================================================================
// the rules, one small function each
// ===================================================================================================================
test('default 1: a ledger named like one of Zoho\'s own accounts uses Zoho\'s account; a stored decision wins; "leave as it is" is read as no decision', () => {
  const d = D.defaultClashDecisions(['Advance Tax', 'tds payable\r\n', 'Office Rent', 'GST Payable', 'Petty Cash'], {
    'tds payable\r\n': { decision: 'rename', newName: 'TDS Payable (Tally)', by: 'a@demo.test' },
    'GST Payable': { decision: 'keep', by: 'old@demo.test' },
  });
  assert.deepEqual(Object.fromEntries(Object.entries(d).map(([k, v]) => [k, [v.decision, !!v.byDefault]])),
    { 'tds payable\r\n': ['rename', false], 'Advance Tax': ['zoho', true], 'GST Payable': ['zoho', true], 'Petty Cash': ['zoho', true] });
  assert.equal(d['Office Rent'], undefined, 'an ordinary name needs nothing');
  assert.equal(D.suggestedRename('TDS  Payable\r\n'), 'TDS Payable (Tally)');
  // the resolver writes the Zoho account's own spelling in every voucher file
  const r = makeNameResolver({ clashDecisions: d }, ['Advance Tax', 'tds payable\r\n', 'gst payable']);
  assert.deepEqual([r('Advance Tax'), r('tds payable'), r('Office Rent')], ['Advance Tax', 'TDS Payable (Tally)', 'Office Rent']);
});

// changed on purpose (opening balance batch): EVERY account type takes its opening balance through the dated journal, so no
// chart balance depends on Zoho's Opening Balance Date. Only Stock (and the contact account types) stay in the chart.
// (changed on purpose, round 2: a Stock balance goes through the journal too, OB-3, so it cannot lock the Opening Balance Date)
test('default 2: every account takes its opening balance through the journal, Stock included; one date anchor is chosen', () => {
  assert.deepEqual(['Bank', 'Credit Card', 'Cash', 'Other Current Asset', 'Equity', 'Fixed Asset', 'Expense', 'Stock', 'Accounts Receivable', 'Accounts Payable', '', undefined].map(D.openingBalanceViaJournal),
    [true, true, true, true, true, true, true, true, false, false, false, false]);
  const c = (name, type, balance) => ({ id: name, name, type, balance: new Decimal(balance) });
  // the first type of the preference list that has a balance, then the smallest balance, then the name
  const pick = list => { const a = D.chooseDateAnchor(list); return a ? [a.name, a.mode] : null; };
  assert.deepEqual(pick([c('Bank A', 'Bank', '-900'), c('Van', 'Fixed Asset', '-5000'), c('Capital B', 'Equity', '700'), c('Capital A', 'Equity', '700'), c('Reserve', 'Equity', '9000')]), ['Capital A', 'chart']);
  assert.deepEqual(pick([c('Bank A', 'Bank', '-900'), c('Van', 'Fixed Asset', '-5000'), c('Rent due', 'Other Current Liability', '10')]), ['Van', 'chart']);
  assert.deepEqual(pick([c('Sales', 'Income', '50'), c('Bank A', 'Bank', '-900')]), ['Sales', 'chart'], 'a type outside the list is still better than typing');
  // never a bank, card or cash account, never Stock, never a zero balance
  assert.deepEqual(pick([c('Bank A', 'Bank', '-900'), c('Till', 'Cash', '-20'), c('Goods', 'Stock', '-300'), c('Capital', 'Equity', '0')]), ['Till', 'typed'], 'only bank-like balances: the smallest is typed');
  assert.equal(pick([c('Capital', 'Equity', '0'), c('No type', '', '5')]), null);
  assert.equal(pick([]), null);
});

test('default 6: contacts of one file with the same name are one party; different GSTINs, another file or a decided group are left alone', () => {
  const recs = [
    { section: 'vendors', name: 'Teak Timber\r\n', gstin: '27TEAKT1234F1ZJ' }, { section: 'vendors', name: 'Teak Timber', gstin: '27TEAKT1234F1ZJ' }, { section: 'vendors', name: 'teak  timber ', gstin: '' },
    { section: 'vendors', name: 'Sal Wood', gstin: '29SALWD1234F1Z5' }, { section: 'vendors', name: 'Sal Wood\r\n', gstin: '27SALWD1234F1Z9' }, // two registrations: not joined
    { section: 'customers', name: 'Teak Timber', gstin: '' },                                                                                  // another file: nothing to join with
    { section: 'customers', name: 'Neem Stores\r\n', gstin: '' }, { section: 'customers', name: 'Neem Stores ', gstin: '' },
  ];
  assert.deepEqual(D.defaultMerges(recs), [
    { section: 'customers', kept: 'Neem Stores\r\n', merged: ['Neem Stores '] },                          // none is clean: the first in the file is kept
    { section: 'vendors', kept: 'Teak Timber', merged: ['Teak Timber\r\n', 'teak  timber '] },            // the one that needs no cleaning is kept
  ]);
  assert.deepEqual(D.defaultMerges(recs, n => n, new Set(['Teak Timber\r\n'])).map(m => m.section), ['customers'], 'a group a person decided is not touched');
  // names that become the same only because one was cleaned (the written name) are joined too
  assert.deepEqual(D.defaultMerges([{ section: 'vendors', name: 'A\tB', gstin: '' }, { section: 'vendors', name: 'A B', gstin: '' }], n => (n === 'A\tB' ? 'A B' : n)), [{ section: 'vendors', kept: 'A B', merged: ['A\tB'] }]);
  // a voucher that names the party without the line break is the contact kept
  const r = makeNameResolver({ nameDecisions: { 'Teak Timber\r\n': { action: 'merge', mergeInto: 'Teak Timber', byDefault: true } } }, ['Teak Timber\r\n', 'Teak Timber']);
  assert.deepEqual([r('Teak Timber\r\n'), r('Teak Timber')], ['Teak Timber', 'Teak Timber']);
  // two masters that differ only by a hidden character and are one party: a third spelling resolves to the one kept
  const two = makeNameResolver({ nameDecisions: { 'Neem Stores\r\n': { action: 'merge', mergeInto: 'Neem Stores\n', byDefault: true } } }, ['Neem Stores\r\n', 'Neem Stores\n']);
  assert.equal(two('Neem Stores'), 'Neem Stores\n');
});

test('default 7: a name stays as in Tally unless it breaks a Zoho rule; line breaks and spaces alone do not', () => {
  assert.deepEqual(['Oak Traders\r\n', ' Oak Traders ', 'Oak\tTraders', 'Oak Traders'].map(D.nameFailsZohoRule), [null, null, null, null]);
  assert.match(D.nameFailsZohoRule('Oak\u0001Traders'), /control character/);
});

test('default 8: journal routing: the clear suggestion, else Manual Journal; a reimbursement is a Manual Journal', () => {
  const route = (s, o) => { const r = D.defaultJournalRoute(s, o); return [r.decision, r.kind]; };
  assert.deepEqual(route({ suggested: 'Bill', clear: true, needsCheck: false }), ['Bill', 'journal_default_suggestion']);
  assert.deepEqual(route({ suggested: 'Manual Journal', clear: true, needsCheck: false }), ['Manual Journal', 'journal_default_suggestion']);
  assert.deepEqual(route({ suggested: 'Bill', clear: true, needsCheck: true }), ['Manual Journal', 'journal_default_manual'], 'a Bill that would carry a negative row is not written by default');
  assert.deepEqual(route({ suggested: 'Manual Journal', clear: false, needsCheck: false }), ['Manual Journal', 'journal_default_manual']);
  assert.deepEqual(route({ suggested: 'Bill', clear: true, needsCheck: false }, { reimbursement: true }), ['Manual Journal', 'journal_default_reimbursement']);
  assert.deepEqual(route({ suggested: 'Invoice', clear: true, needsCheck: false }, { usable: () => false }), ['Manual Journal', 'journal_default_manual'], 'a document that cannot be written is a Manual Journal');
  const l = (ledger, kind, debit) => ({ ledger, kind, debit });
  assert.equal(D.isReimbursementJournal([l('Office Supplies', 'expense', true), l('Ravi Kumar', 'vendor', false)], 'Reimbursement of stationery bought by Ravi'), true, 'the narration says so');
  assert.equal(D.isReimbursementJournal([l('Staff Reimbursements', 'expense', true), l('Ravi Kumar', 'vendor', false)]), true, 'a ledger name says so');
  assert.equal(D.isReimbursementJournal([l('Travelling Expenses', 'expense', true), l('Conveyance', 'expense', true), l('Ravi Kumar', 'vendor', false)]), true, 'only travel and conveyance, no tax');
  assert.equal(D.isReimbursementJournal([l('Travelling Expenses', 'expense', true), l('Input IGST', 'tax', true), l('Sky Travels', 'vendor', false)]), false, 'a travel bill with GST is a purchase');
  assert.equal(D.isReimbursementJournal([l('Repairs', 'expense', true), l('Fix It Co', 'vendor', false)], 'Repairs to the roof'), false);
});

test('default 11: an HSN/SAC value that is not 4, 6 or 8 digits is written empty; a correction is used first', () => {
  assert.deepEqual(['9983', '998311', '99831100', '99831', '998', '9983110', '99A3', '', ' 9983 '].map(v => D.hsnForZoho(v)).map(x => [x.value, x.status]),
    [['9983', 'ok'], ['998311', 'ok'], ['99831100', 'ok'], ['', 'not_written'], ['', 'not_written'], ['', 'not_written'], ['', 'not_written'], ['', 'empty'], ['9983', 'ok']]);
  const fix = { 99831: '998311', 998: '', 9984: '99842' };
  assert.deepEqual(D.hsnForZoho('99831', fix), { value: '998311', status: 'corrected', from: '99831' });
  assert.deepEqual(D.hsnForZoho('998', fix), { value: '', status: 'corrected', from: '998' }, 'written empty on purpose');
  assert.equal(D.hsnForZoho('9984', fix).status, 'not_written', 'a correction that is itself not a code is not written');
});

test('default 12: a bill line of a registered vendor with no GST: GST0 within the state, IGST0 between states; an exemption or reverse charge when chosen', () => {
  assert.deepEqual(D.billLineWithoutTax({}, { source: 'KA', destination: 'KA' }), { cells: { 'Tax Name': 'GST0', 'Tax Percentage': '0', 'Tax Amount': '0.00', 'Tax Type': 'Tax Group' }, kind: 'bill_line_zero_tax' });
  assert.deepEqual(D.billLineWithoutTax({}, { source: 'TN', destination: 'KA' }).cells, { 'Tax Name': 'IGST0', 'Tax Percentage': '0', 'Tax Amount': '0.00', 'Tax Type': 'ItemAmount' });
  assert.equal(D.billLineWithoutTax({}, { source: '', destination: 'KA' }).kind, 'bill_line_needs_tax_or_exemption', 'without both states GST0 cannot be told from IGST0');
  assert.deepEqual(D.billLineWithoutTax({ billNoTaxMode: 'exemption', billExemptionCode: 'EXEMPT SERVICES' }, {}), { cells: { 'Item Exemption Code': 'EXEMPT SERVICES' }, kind: 'bill_line_exemption' });
  assert.equal(D.billLineWithoutTax({ billNoTaxMode: 'exemption' }, { source: 'KA', destination: 'KA' }).kind, 'bill_line_needs_tax_or_exemption', 'an exemption is never invented');
  assert.deepEqual(D.billLineWithoutTax({ billNoTaxMode: 'reverse_charge', billReverseChargeName: 'GST18', billReverseChargeRate: '18', billReverseChargeType: 'Tax Group' }, {}).cells,
    { 'Reverse Charge Tax Name': 'GST18', 'Reverse Charge Tax Rate': '18', 'Reverse Charge Tax Type': 'Tax Group' });
});

test('default 13: tax ledgers with no Zoho tax chosen take Zoho\'s own tax of the same rate', () => {
  const n = (heads, rate) => D.defaultZohoTaxName(heads, new Decimal(rate));
  assert.deepEqual([n(['IGST'], 18), n(['CGST', 'SGST'], 18), n(['SGST', 'CGST'], 5), n(['IGST'], 0), n(['CGST', 'SGST'], '28')], ['IGST18', 'GST18', 'GST5', 'IGST0', 'GST28']);
  assert.deepEqual([n(['IGST'], 3), n(['CGST'], 9), n(['IGST', 'Cess'], 18), n([null], 18), n(['CGST', 'SGST', 'IGST'], 18)], [null, null, null, null, null], 'another rate, half a pair, a cess: nothing is guessed');
});

test('default 14: a group with no decided or standard type takes its type from the nature Tally records on the group', () => {
  const ctx = { groupParents: { 'Staff Loans': 'Suspense A/c', Deep: 'Staff Loans' }, groupReserved: {}, accountTypes: {},
    groupNature: { 'Suspense A/c': { revenue: false, positive: false }, 'Misc. Expenses (ASSET)': { revenue: false, positive: true }, 'Own Income': { revenue: true, positive: false }, 'Own Costs': { revenue: true, positive: true }, 'Staff Loans': { revenue: null, positive: null } } };
  assert.deepEqual(['Suspense A/c', 'Misc. Expenses (ASSET)', 'Own Income', 'Own Costs', 'Deep', 'Nowhere'].map(g => defaultAccountType(g, ctx)),
    ['Other Current Liability', 'Other Current Asset', 'Income', 'Expense', 'Other Current Liability', '']);
  assert.equal(accountType('Suspense A/c', ctx), 'Other Current Liability');
  assert.equal(accountType('Suspense A/c', { ...ctx, accountTypes: { 'Suspense A/c': 'Other Liability' } }), 'Other Liability', 'a decision wins');
  assert.equal(accountType('Bank Accounts', ctx), 'Bank', 'a standard type wins');
  assert.equal(accountType('Suspense A/c', {}), '', 'when Tally says nothing the row is flagged as before');
  const flags = [].concat(TEMPLATES.accounts.check({ name: 'Unposted Items', parent: 'Suspense A/c', openingbalance: '0' }, ctx)).map(f => f.kind);
  assert.deepEqual(flags, ['account_type_default']);
  // changed on purpose (test 2): Zoho Books India has no "Long Term Liability"; a long term loan is written "Non Current Liability",
  // a type Zoho lists but no import has used yet, so it is flagged as unconfirmed
  const ltl = [].concat(TEMPLATES.accounts.check({ name: 'Directors Loan', parent: 'Loans (Liability)', openingbalance: '0' }, ctx));
  assert.deepEqual([TEMPLATES.accounts.row({ name: 'Directors Loan', parent: 'Loans (Liability)' }, ctx)['Account Type'], ltl.map(f => f.kind)], ['Non Current Liability', ['account_type_unconfirmed']]);
});

test('every kind of assumption says what was done and where to change it; the summary counts per kind and gives identifiers, not names', () => {
  for (const [kind, a] of Object.entries(D.ASSUMPTIONS)) { assert.ok(a.title && a.words, kind); assert.ok(a.where === null || (a.where.screen && a.where.anchor), `${kind}: where`); }
  const flags = [
    { kind: 'item_rate_zero', slot: 'stock_items', sourceId: 'g1', name: 'Widget', uses: null }, { kind: 'item_rate_zero', slot: 'stock_items', sourceId: 'g2', name: 'Gadget', uses: null },
    { kind: 'bill_number_from_reference', slot: null, sourceId: null, name: 'Bills (whole file)', uses: 46 },
    { kind: 'negative_row', slot: 'journal', sourceId: 'g3', name: 'x', uses: null }, { kind: null, slot: 'sales', sourceId: 'g4', name: 'y', uses: null },
    { kind: 'bill_line_needs_tax_or_exemption', slot: 'purchase', sourceId: 'g5', name: 'z', uses: null },
  ];
  const s = D.summariseAssumptions(flags);
  assert.deepEqual(s.map(a => [a.kind, a.count, a.blocking, a.unconfirmed]), [['item_rate_zero', 2, false, true], ['bill_number_from_reference', 46, false, false], ['bill_line_needs_tax_or_exemption', 1, true, false]]);
  assert.deepEqual(s[0].examples, [{ dataset: 'stock_items', id: 'g1' }, { dataset: 'stock_items', id: 'g2' }]);
  assert.ok(!JSON.stringify(s).includes('Widget'), 'no name');
});

// ===================================================================================================================
// the voucher files
// ===================================================================================================================
const MASTERS = { 'In CGST': { taxtype: 'GST', gstdutyhead: 'CGST' }, 'In SGST': { taxtype: 'GST', gstdutyhead: 'SGST/UTGST' }, 'In IGST': { taxtype: 'GST', gstdutyhead: 'IGST' }, 'Out IGST': { taxtype: 'GST', gstdutyhead: 'IGST' },
  'TDS Fees': { taxtype: 'TDS' }, 'Swachh Cess': { taxtype: 'GST', gstdutyhead: 'Cess' } };
const CONTACTS = { customers: { 'Cust Alpha': { treatment: 'business_gst', gstin: '29AAAAA0000A1ZY', place: 'KA' } },
  vendors: { 'Vend Reg': { treatment: 'business_gst', gstin: '29BBBBB0000B1ZP', place: 'KA' }, 'Vend Far': { treatment: 'business_gst', gstin: '33CCCCC0000C1ZR', place: 'TN' },
    'Vend Small': { treatment: 'business_none', gstin: '', place: 'KA' }, 'Vend Nowhere': { treatment: 'business_gst', gstin: '', place: '' }, 'Ravi Kumar': { treatment: 'business_none', gstin: '', place: 'KA' } } };
const KINDS = { Repairs: 'expense', Freight: 'expense', 'Travelling Expenses': 'expense', 'Sales Goods': 'income', Cash: 'bank', 'Round Off': 'expense' };
const opts = (over = {}) => ({ customers: new NameSet(Object.keys(CONTACTS.customers)), vendors: new NameSet(Object.keys(CONTACTS.vendors)), taxLedgers: new NameSet(Object.keys(MASTERS)),
  taxMap: {}, taxInfo: n => (MASTERS[n] ? taxLedgerInfo(MASTERS[n]) : null), kindOf: n => KINDS[n] ?? null, contactOf: (s, l) => CONTACTS[s][l] || null,
  gstRegisteredCodes: new Set(['business_gst', 'business_sez']), ...over });
const vch = (number, lines, extra = {}) => ({ vouchernumber: number, date: '20240601', cmpgststate: 'Karnataka', ...extra, allledgerentries: lines.map(([ledgername, amount, more]) => ({ ledgername, amount, ...(more || {}) })) });
let nextId = 0;
const rec = (slot, data, decision) => ({ id: ++nextId, source_id: `g${nextId}`, name: `${slot} ${data.vouchernumber}`, slot, data, decision });
const build = (recs, over) => buildVoucherOutput(recs, opts(over));
const flagsOf = (b, r) => b.exceptions.filter(e => e.rec === r && e.kind).map(e => e.kind);
const rowsOf = (b, file, r) => b[file].rows.filter(x => x.rec === r).map(x => x.row);

test('default 8 in the files: a journal with no decision is written by default and never left out; a decision wins', () => {
  const clear = rec('journal', vch('J-1', [['Repairs', '-100.00'], ['Vend Small', '100.00']]));                                   // a clear Bill
  const negative = rec('journal', vch('J-2', [['Repairs', '-100.00'], ['Vend Small', '90.00'], ['TDS Fees', '10.00']]));          // a Bill that would carry a negative row
  const notClear = rec('journal', vch('J-3', [['Vend Small', '-50.00'], ['Repairs', '50.00']]));                                  // the vendor debited
  const plain = rec('journal', vch('J-4', [['Repairs', '-20.00'], ['Cash', '20.00']]));                                           // no party
  const travel = rec('journal', vch('J-5', [['Travelling Expenses', '-75.00'], ['Ravi Kumar', '75.00']]));                        // a reimbursement
  const sale = rec('journal', vch('J-6', [['Cust Alpha', '-200.00'], ['Sales Goods', '200.00']]));                                // a clear Invoice
  const decided = rec('journal', vch('J-7', [['Repairs', '-100.00'], ['Vend Small', '100.00']]), 'Manual Journal');               // a person decided otherwise
  const all = [clear, negative, notClear, plain, travel, sale, decided];
  // without the defaults (the pure builder, as before): every undecided journal waits and is in no file
  const before = build(all);
  assert.deepEqual([before.undecided, before.journals.vouchers, before.bills.vouchers], [6, 1, 0]);
  // with them: nothing waits
  const b = build(all, { defaultRouting: true });
  assert.deepEqual([b.undecided, b.bills.vouchers, b.invoices.vouchers, b.journals.vouchers], [0, 1, 1, 5]);
  assert.deepEqual(all.map(r => b.recon.find(x => x.id === r.id).file), ['bills', 'journals', 'journals', 'journals', 'journals', 'invoices', 'journals']);
  assert.deepEqual(all.map(r => flagsOf(b, r).filter(k => /^journal_default/.test(k))),
    [['journal_default_suggestion'], ['journal_default_manual'], ['journal_default_manual'], ['journal_default_suggestion'], ['journal_default_reimbursement'], ['journal_default_suggestion'], []]);
  assert.match(b.exceptions.find(e => e.rec === negative && e.kind === 'journal_default_manual').message, /the suggestion \(Bill\) would carry a row with a negative amount, so it is written as a Manual Journal/);
  assert.match(b.exceptions.find(e => e.rec === travel).message, /reads as an expense reimbursed to a party .* written as a Manual Journal, not as a bill/);
  assert.ok(!b.exceptions.some(e => /has not been routed yet/.test(e.message)));
  // a Manual Journal posts exactly what Tally posted
  assert.deepEqual(rowsOf(b, 'journals', negative).map(x => [x.Account, x['Contact Name'], x.Debit, x.Credit]),
    [['Repairs', '', '100.00', ''], ['Accounts Payable', 'Vend Small', '', '90.00'], ['TDS Fees', '', '', '10.00']]);
});

test('default 8: a journal routed by default never becomes a bill Zoho refuses; a person\'s "Bill" is written as decided and flagged', () => {
  const noState = rec('journal', vch('J-40', [['Repairs', '-100.00'], ['Vend Nowhere', '100.00']]));                     // registered, no state: GST0 or IGST0 cannot be told
  // changed on purpose (S6, GST-002): 500 + 500 with 90 + 90 can only be 18% on both (now written); 1000 + 500 with 90 + 90
  // is 12% on both or 18% on the first only, so which line carries the GST is still not certain
  const unplaced = rec('journal', vch('J-41', [['Repairs', '-1000.00'], ['Freight', '-500.00'], ['In CGST', '-90.00'], ['In SGST', '-90.00'], ['Vend Reg', '1680.00']])); // GST not placeable
  const fine = rec('journal', vch('J-42', [['Repairs', '-100.00'], ['Vend Reg', '100.00']]));                            // registered, same state: GST0
  const decided = rec('journal', vch('J-43', [['Repairs', '-100.00'], ['Vend Nowhere', '100.00']]), 'Bill');
  const b = build([noState, unplaced, fine, decided], { defaultRouting: true });
  assert.deepEqual([noState, unplaced, fine, decided].map(r => b.recon.find(x => x.id === r.id).file), ['journals', 'journals', 'bills', 'bills']);
  assert.deepEqual([noState, unplaced].map(r => flagsOf(b, r).filter(k => k === 'journal_default_manual' || k === 'bill_line_needs_tax_or_exemption')), [['journal_default_manual'], ['journal_default_manual']]);
  assert.match(b.exceptions.find(e => e.rec === noState && e.kind === 'journal_default_manual').message, /as a bill it would have lines Zoho refuses/);
  assert.match(b.exceptions.find(e => e.rec === unplaced && e.kind === 'journal_default_manual').message, /as a bill its GST could not be put on its lines/);
  assert.deepEqual([flagsOf(b, fine).includes('bill_line_zero_tax'), flagsOf(b, decided).includes('bill_line_needs_tax_or_exemption')], [true, true], 'a decision is written as decided, and flagged');
  assert.equal(b.undecided, 0);
});

test('default 9: the Bill Number is the supplier\'s invoice number when Tally has one; the same number twice for one vendor is put right and flagged', () => {
  const a = rec('purchase', vch('P-1', [['Vend Small', '100.00'], ['Repairs', '-100.00']], { reference: ' INV/9 \r\n' }));
  const b = rec('purchase', vch('P-2', [['Vend Small', '50.00'], ['Repairs', '-50.00']], { reference: 'INV/9' }));  // the same supplier number again, the same vendor
  const c = rec('purchase', vch('P-3', [['Ravi Kumar', '70.00'], ['Repairs', '-70.00']], { reference: 'INV/9' })); // the same number, another vendor
  const d = rec('purchase', vch('P-4', [['Vend Small', '10.00'], ['Repairs', '-10.00']]));                           // no supplier number
  const built = build([a, b, c, d]);
  assert.deepEqual([a, b, c, d].map(r => rowsOf(built, 'bills', r)[0]['Bill Number']), ['INV/9', 'P-2', 'INV/9', 'P-4']);
  assert.deepEqual([a, b, c, d].map(r => flagsOf(built, r)), [[], ['bill_number_collision'], [], []]);
  assert.match(built.exceptions.find(e => e.kind === 'bill_number_collision').message, /"INV\/9" is already the Bill Number of another bill of the same vendor \(Tally voucher P-1\).*carries its Tally voucher number "P-2" instead/);
  assert.deepEqual(built.billNumbers, { fromReference: 2, sharedByVendors: 1 });
  assert.deepEqual(built.repeatedNumbers, [], 'a number is kept per vendor, so two vendors with one number are two bills');
  assert.deepEqual(built.recon.map(x => x.number), ['INV/9', 'P-2', 'INV/9', 'P-4'], 'the reconciliation records the number written');
  // when the voucher number is chosen instead, the same voucher number twice for one vendor is still reported
  const e = rec('journal', vch('P-1', [['Repairs', '-5.00'], ['Vend Small', '5.00']]), 'Bill');
  assert.deepEqual(build([a, e], { settings: { billNumber: 'voucher' } }).repeatedNumbers.map(x => [x.file, x.number, x.recs.length]), [['bills', 'P-1', 2]]);
});

test('default 10: the Bills file has no Total, SubTotal, Balance or Item Total column, and no row carries one', () => {
  const a = rec('purchase', vch('P-9', [['Vend Reg', '1180.00'], ['Repairs', '-1000.00'], ['In CGST', '-90.00'], ['In SGST', '-90.00']]));
  const [row] = rowsOf(build([a]), 'bills', a);
  assert.deepEqual(Object.keys(row).filter(h => !BILL_HEADERS.includes(h)), []);
  assert.deepEqual(BILL_HEADERS.filter(h => /^(Item Total|SubTotal|Total|Balance)$/.test(h) || /^(Attachment|CF\.)/.test(h)), []);
  assert.deepEqual([row.Quantity, row.Rate, row['Tax Amount']], ['1', '1000.00', '180.00'], 'Zoho works the total out from these');
});

test('defaults 12 and 13: Zoho\'s own tax names, and the zero-rate tax on a line of a registered vendor with no GST', () => {
  // 13: no Zoho tax is chosen for the tax ledgers: Zoho's own tax of the rate
  const intra = rec('purchase', vch('P-10', [['Vend Reg', '1180.00'], ['Repairs', '-1000.00'], ['In CGST', '-90.00'], ['In SGST', '-90.00']]));
  const inter = rec('purchase', vch('P-11', [['Vend Far', '1180.00'], ['Repairs', '-1000.00'], ['In IGST', '-180.00']]));
  const sale = rec('sales', vch('S-10', [['Cust Alpha', '-590.00'], ['Sales Goods', '500.00'], ['Out IGST', '90.00']], { placeofsupply: 'Maharashtra' }));
  let b = build([intra, inter, sale]);
  assert.deepEqual([rowsOf(b, 'bills', intra)[0], rowsOf(b, 'bills', inter)[0]].map(x => [x['Tax Name'], x['Tax Type'], x['Tax Percentage'], x['Tax Amount']]), [['GST18', 'Tax Group', '18', '180.00'], ['IGST18', 'ItemAmount', '18', '180.00']]);
  assert.deepEqual(['Item Tax', 'Item Tax Type', 'Item Tax %'].map(h => rowsOf(b, 'invoices', sale)[0][h]), ['IGST18', 'ItemAmount', '18']);
  assert.deepEqual([flagsOf(b, intra), flagsOf(b, inter), flagsOf(b, sale), b.unmappedTax], [['tax_name_default'], ['tax_name_default'], ['tax_name_default'], []]);
  // a mapping made in Mapping Studio wins; with a saved Zoho tax list a name that is not in it is never written
  b = build([intra], { taxMap: { 'In CGST': 'My GST 18', 'In SGST': 'My GST 18' } });
  assert.deepEqual([rowsOf(b, 'bills', intra)[0]['Tax Name'], flagsOf(b, intra)], ['My GST 18', []]);
  b = build([intra], { zohoTaxNames: ['My GST 18', 'My IGST 18'] });
  assert.deepEqual([rowsOf(b, 'bills', intra)[0]['Tax Name'], b.unmappedTax], ['', ['In CGST', 'In SGST']], 'the organisation names its taxes differently: not guessed, reported as not mapped');
  assert.equal(rowsOf(build([intra], { zohoTaxNames: ['gst18'] }), 'bills', intra)[0]['Tax Name'], 'GST18');

  // 12: a registered vendor's line with NO GST in Tally: GST0 within the state, IGST0 between states
  const noTaxSame = rec('purchase', vch('P-12', [['Vend Reg', '500.00'], ['Repairs', '-500.00']]));
  const noTaxOther = rec('purchase', vch('P-13', [['Vend Far', '500.00'], ['Repairs', '-400.00'], ['Freight', '-100.00']]));
  const unregistered = rec('purchase', vch('P-14', [['Vend Small', '500.00'], ['Repairs', '-500.00']]));
  b = build([noTaxSame, noTaxOther, unregistered]);
  assert.deepEqual(rowsOf(b, 'bills', noTaxSame).map(x => [x['Tax Name'], x['Tax Percentage'], x['Tax Type'], x['Item Exemption Code'] ?? '']), [['GST0', '0', 'Tax Group', '']]);
  assert.deepEqual(rowsOf(b, 'bills', noTaxOther).map(x => [x['Tax Name'], x['Tax Type']]), [['IGST0', 'ItemAmount'], ['IGST0', 'ItemAmount']]);
  assert.deepEqual(rowsOf(b, 'bills', unregistered).map(x => [x['Tax Name'], x['Item Exemption Code'] ?? '']), [['', '']], 'a vendor that is not registered needs nothing, and never gets an exemption');
  assert.deepEqual([flagsOf(b, noTaxSame), flagsOf(b, noTaxOther), flagsOf(b, unregistered)], [['bill_line_zero_tax'], ['bill_line_zero_tax'], []]);
  assert.match(b.exceptions.find(e => e.rec === noTaxOther && e.kind === 'bill_line_zero_tax').message, /2 lines of this bill carry no GST in Tally.*IGST0 with Tax Type "ItemAmount" and Tax Percentage 0 \(the vendor's state is TN and the company's is KA\)\. Not confirmed until the next test import/);
  // the accountant chose an exemption, or reverse charge, for such lines
  b = build([noTaxSame, unregistered], { settings: { billNoTaxMode: 'exemption', billExemptionCode: 'EXEMPT SERVICES' } });
  assert.deepEqual([rowsOf(b, 'bills', noTaxSame)[0]['Item Exemption Code'], rowsOf(b, 'bills', noTaxSame)[0]['Tax Name'], rowsOf(b, 'bills', unregistered)[0]['Item Exemption Code'] ?? '', flagsOf(b, noTaxSame)],
    ['EXEMPT SERVICES', '', '', ['bill_line_exemption']]);
  b = build([noTaxSame], { settings: { billNoTaxMode: 'reverse_charge', billReverseChargeName: 'GST18', billReverseChargeRate: '18', billReverseChargeType: 'Tax Group' } });
  assert.deepEqual([rowsOf(b, 'bills', noTaxSame)[0]['Reverse Charge Tax Name'], flagsOf(b, noTaxSame)], ['GST18', ['bill_line_reverse_charge']]);

  // NEVER a zero-rate tax where the bill HAS GST in Tally that could not be written, or where a state is missing:
  // the cells stay empty and the bill carries the blocking flag, so such rows are never exported unnoticed
  const cess = rec('purchase', vch('P-16', [['Vend Reg', '1010.00'], ['Repairs', '-1000.00'], ['Swachh Cess', '-10.00']]));            // no Zoho tax of its own for a cess
  // changed on purpose (S6, GST-002): amounts where 12% on both lines and 18% on the first only both fit
  const twoLines = rec('purchase', vch('P-17', [['Vend Reg', '1680.00'], ['Repairs', '-1000.00'], ['Freight', '-500.00'], ['In CGST', '-90.00'], ['In SGST', '-90.00']])); // which line carries the tax is not known
  const noState = rec('purchase', vch('P-18', [['Vend Nowhere', '500.00'], ['Repairs', '-500.00']]));
  const reverse = rec('purchase', vch('P-19', [['Vend Reg', '1000.00'], ['Freight', '-1000.00'], ['In IGST', '-180.00'], ['Out IGST', '180.00']]));
  b = build([cess, twoLines, noState, reverse]);
  for (const r of [cess, twoLines, noState]) {
    assert.ok(rowsOf(b, 'bills', r).every(x => !x['Tax Name'] && !x['Item Exemption Code']), r.name);
    assert.ok(flagsOf(b, r).includes('bill_line_needs_tax_or_exemption') && !flagsOf(b, r).includes('bill_line_zero_tax'), r.name);
  }
  assert.match(b.exceptions.find(e => e.rec === twoLines && e.kind === 'bill_line_needs_tax_or_exemption').message, /2 lines of this bill have no tax written.*Specify either a Tax or Tax Exemption or Reverse Charge.*GST in Tally that could not be put on its lines/);
  assert.match(b.exceptions.find(e => e.rec === noState && e.kind === 'bill_line_needs_tax_or_exemption').message, /the vendor's state \(Source of Supply\) is not known/);
  // changed on purpose (audit item 1): the same GST debited and credited is reverse charge, written in the bill's
  // Reverse Charge columns (Zoho's own tax of the rate), never with a zero-rate tax and never refused for "no tax"
  assert.deepEqual(rowsOf(b, 'bills', reverse).map(x => [x['Tax Name'], x['Reverse Charge Tax Name'], x['Reverse Charge Tax Rate'], x['Reverse Charge Tax Type']]), [['', 'GST18', '18', 'Tax Group']]);
  // changed on purpose (S2): the made-up vendor is in the company's state, so Tally's IGST would be refused by Zoho
  // ("IGST cannot be applied as this is an intrastate transaction"): the GST group is written and the voucher says so
  assert.deepEqual(flagsOf(b, reverse), ['reverse_charge_written', 'rcm_tax_type_changed']);
});

test('default 11 in the files: the HSN/SAC of a line is corrected or left empty, and the voucher says so', () => {
  const a = rec('sales', vch('S-20', [['Cust Alpha', '-300.00'], ['Sales Goods', '100.00', { gsthsnname: '99831' }], ['Sales Goods', '100.00', { gsthsnname: '998311' }], ['Sales Goods', '100.00', { gsthsnname: ' 9983 ' }]]));
  let b = build([a]);
  assert.deepEqual([rowsOf(b, 'invoices', a).map(x => x['HSN/SAC']), flagsOf(b, a).filter(k => /^hsn/.test(k))], [['', '998311', '9983'], ['hsn_not_written']]);
  assert.match(b.exceptions.find(e => e.kind === 'hsn_not_written').message, /The HSN\/SAC value "99831" on 1 line of this invoice is not a code Zoho Books accepts/);
  b = build([a], { hsnCorrections: { 99831: '998314' } });
  assert.deepEqual([rowsOf(b, 'invoices', a).map(x => x['HSN/SAC']), flagsOf(b, a).filter(k => /^hsn/.test(k))], [['998314', '998311', '9983'], ['hsn_corrected']]);
});

test('M6: a voucher dated outside the financial year is left out by default, counted and listed; the switch includes it', () => {
  const year = { from: '2024-04-01', to: '2025-03-31' };
  const inside = rec('purchase', vch('P-30', [['Vend Small', '10.00'], ['Repairs', '-10.00']], { date: '20240401' }));
  const lastDay = rec('purchase', vch('P-31', [['Vend Small', '10.00'], ['Repairs', '-10.00']], { date: '20250331' }));
  const before = rec('journal', vch('J-30', [['Repairs', '-10.00'], ['Cash', '10.00']], { date: '20240331' }), 'Manual Journal');
  const after = rec('sales', vch('S-30', [['Cust Alpha', '-10.00'], ['Sales Goods', '10.00']], { date: '20250401' }));
  const unreadable = rec('purchase', vch('P-32', [['Vend Small', '10.00'], ['Repairs', '-10.00']], { date: 'soon' }));
  let b = build([inside, lastDay, before, after, unreadable], { year });
  // the voucher whose date cannot be read is not judged against the year: it is left out as an invalid date (fix set S1:
  // a date is never guessed, and Zoho Books refuses a row with no date), not written with an empty date
  assert.deepEqual([b.bills.vouchers, b.journals.vouchers, b.invoices.vouchers, b.outsideYear], [2, 0, 0, { vouchers: 2, included: false }]);
  assert.deepEqual([flagsOf(b, unreadable), b.recon.find(x => x.id === unreadable.id).outcome, b.recon.find(x => x.id === unreadable.id).reason], [['left_out_invalid_date'], 'left_out', 'invalid_date']);
  assert.deepEqual([before, after].map(r => [flagsOf(b, r), b.recon.find(x => x.id === r.id).outcome, b.recon.find(x => x.id === r.id).reason]),
    [[['left_out_outside_year'], 'left_out', 'outside_year'], [['left_out_outside_year'], 'left_out', 'outside_year']]);
  assert.match(b.exceptions.find(e => e.rec === before).message, /^Left out of the file: the voucher is dated 2024-03-31, outside the financial year of the migration \(2024-04-01 to 2025-03-31\)/);
  b = build([inside, before, after], { year, settings: { outOfYear: 'include' } });
  assert.deepEqual([b.bills.vouchers, b.journals.vouchers, b.invoices.vouchers, b.outsideYear], [1, 1, 1, { vouchers: 2, included: true }]);
  assert.deepEqual(flagsOf(b, before), ['voucher_outside_year_included']);
  assert.deepEqual(build([before], {}).journals.vouchers, 1, 'without a financial year nothing is judged');
});

// ===================================================================================================================
// M7 and M8: files uploaded on the Zoho-side screens (error files, reports, the Zoho Trial Balance)
// ===================================================================================================================
// A minimal .xlsx: a zip archive with the given entries (stored or deflated).
function zip(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const [name, content, { store = false, declared = null } = {}] of entries) {
    const raw = Buffer.from(content), data = store ? raw : zlib.deflateRawSync(raw), nameBuf = Buffer.from(name);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(store ? 0 : 8, 8); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(declared ?? raw.length, 22); h.writeUInt16LE(nameBuf.length, 26);
    local.push(h, nameBuf, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(store ? 0 : 8, 10); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(declared ?? raw.length, 24); c.writeUInt16LE(nameBuf.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const dir = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, dir, end]);
}
const sheet = rows => `<worksheet><sheetData>${rows}</sheetData></worksheet>`;
const cell = (ref, text) => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
const xlsx = rows => zip([['xl/worksheets/sheet1.xml', sheet(rows)]]);

test('M7: a workbook that names a huge row or column is refused with a message; nothing is allocated for it', () => {
  const good = readTable(xlsx(`<row r="1">${cell('A1', 'Display Name')}${cell('B1', 'Error Message')}</row><row r="3">${cell('A3', 'Oak Traders')}${cell('C3', 'x')}</row>`));
  assert.deepEqual([good.format, good.rows], ['xlsx', [['Display Name', 'Error Message'], ['Oak Traders', '', 'x']]]);
  const started = process.memoryUsage().heapUsed;
  const hugeRow = readTable(xlsx(`<row r="1">${cell('A1', 'a')}</row><row r="999999999">${cell('A999999999', 'b')}</row>`));
  assert.match(hugeRow.error, new RegExp(`row numbered 999999999, beyond the ${MAX_ROWS.toLocaleString('en-IN')} rows`));
  const hugeColumn = readTable(xlsx(`<row r="1">${cell('ZZZZZZ1', 'a')}</row>`));
  assert.match(hugeColumn.error, new RegExp(`cell in column ZZZZZZ, beyond the ${MAX_COLUMNS.toLocaleString('en-IN')} columns`));
  assert.ok(process.memoryUsage().heapUsed - started < 50 * 1024 * 1024, 'no large table was built');
  // a file that only looks like a workbook, and a damaged one: an error in words, never a throw
  for (const bad of [Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(40)]), xlsx('<row r="1">').subarray(0, 60), zip([['xl/other.xml', 'x']])]) {
    assert.match(readTable(bad).error, /could not be read|too large/);
  }
  assert.equal(readTable(Buffer.alloc(0)).error, 'The file is empty.');
});

test('M8: a zip bomb is refused before and while it is unpacked', () => {
  // 80 MB of zeros deflates to about 80 KB
  const bomb = zip([['xl/worksheets/sheet1.xml', Buffer.alloc(80 * 1024 * 1024)]]);
  assert.ok(bomb.length < 200 * 1024, `a small file (${bomb.length} bytes)`);
  const before = process.memoryUsage().rss;
  assert.match(readTable(bomb).error, /too large once it is unpacked/);
  // the same archive lying about its size: the unpacking itself is capped
  const lying = zip([['xl/worksheets/sheet1.xml', Buffer.alloc(80 * 1024 * 1024), { declared: 1000 }]]);
  assert.match(readTable(lying).error, /too large/);
  assert.ok(process.memoryUsage().rss - before < MAX_ENTRY_BYTES * 2.5, 'memory stays bounded');
  // too many files inside
  const many = zip(Array.from({ length: 2001 }, (_, i) => [`f${i}.xml`, 'x', { store: true }]));
  assert.match(readTable(many).error, /holds 2001 files inside it/);
});

// ===================================================================================================================
// end to end: nothing is decided, and the files are still ones Zoho accepts
// ===================================================================================================================
const app = buildApp();
let cookie = '';
const call = o => app.inject({ ...o, headers: { ...(o.headers || {}), ...(cookie ? { cookie } : {}) } });
const get = async url => { const r = await call({ url }); assert.equal(r.statusCode, 200, `${url}: ${r.body}`); return r.json(); };
const send = (method, url, payload) => call({ method, url, ...(payload !== undefined ? { payload } : {}) });
const login = async role => { const u = seed.users.find(x => x.role === role); cookie = String((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: u.password } })).headers['set-cookie']).split(';')[0]; };
const putDoc = (id, slot, obj, name) => call({ method: 'PUT', url: `/api/migrations/${id}/uploads/${slot}`, headers: { 'content-type': 'application/octet-stream', 'x-filename': name }, payload: utf16le(obj) });
const upload = (url, buf) => call({ method: 'PUT', url, headers: { 'content-type': 'application/octet-stream', 'x-filename': 'file.xlsx' }, payload: buf });
const csv = async (base, key) => { const r = await call({ url: `${base}/files/${key}/download?confirmed=1` }); assert.equal(r.statusCode, 200, `${key}: ${r.body}`); return parseCsv(r.body); };
const reg = (type, gstin, place) => ({ ledgstregdetails: [{ applicablefrom: '20200401', gstregistrationtype: type, ...(gstin ? { gstin } : {}), ...(place ? { placeofsupply: place } : {}) }] });
const mail = state => ({ ledmailingdetails: [{ applicablefrom: '20200401', mailingname: 'M', address: [{ metadata: true }, 'Line 1'], ...(state ? { state } : {}), country: 'India' }] });
const P = { ispartyledger: true };

// The made-up company. Nothing in it is decided by anyone in the first test below.
const EXTRA_MASTERS = [
  group('Suspense A/c', null), group('Loans (Liability)', null), group('Purchase Accounts', null),
  ledger('Advance Tax', 'Current Assets', { openingbalance: '-400.00' }),                                    // the name of one of Zoho's own accounts
  ledger('City Bank Current', 'Bank Accounts', { openingbalance: '-1250.75' }),                               // a bank account with an opening balance
  ledger('Unposted Items', 'Suspense A/c'), ledger('Directors Loan', 'Loans (Liability)'),
  ledger('Repairs', 'Indirect Expenses'), ledger('Travelling Expenses', 'Indirect Expenses'),
  ledger('Central GST Paid', 'Duties & Taxes', { taxtype: 'GST', gstdutyhead: 'CGST' }), ledger('State GST Paid', 'Duties & Taxes', { taxtype: 'GST', gstdutyhead: 'SGST/UTGST' }),
  ledger('Teak Timber\r\n', 'Sundry Creditors', { openingbalance: '100.10', ...reg('Regular', '29TEAKT1234F1ZF', 'Karnataka'), ...mail('Karnataka') }), // the same vendor twice
  ledger('Teak Timber', 'Sundry Creditors', { openingbalance: '200.20', ...reg('Regular', '29TEAKT1234F1ZF', 'Karnataka'), ...mail('Karnataka') }),
  ledger('Sal Stores', 'Sundry Debtors', { ...reg('Unregistered', '33SALST1234F1Z8'), ...mail('') }),          // a valid GSTIN, Tally says unregistered, no state
  ledger('Neem Agencies', 'Sundry Creditors', { ...reg('Regular', '', ''), ...mail('Kerala') }),                // registered in Tally, no GSTIN
  ledger('Banyan Works', 'Sundry Creditors', { ...reg('Regular', '27BANYN1234F1ZA', 'Goa'), ...mail('Goa') }),  // Tally's state is not the GSTIN's
  ledger('Ravi Kumar', 'Sundry Creditors', { ...reg('Unregistered', '', 'Karnataka'), ...mail('Karnataka') }),
];
for (const g of EXTRA_MASTERS.filter(m => m.metadata.type === 'Group')) Object.assign(g, { isrevenue: g.metadata.name === 'Purchase Accounts', isdeemedpositive: g.metadata.name === 'Purchase Accounts' });
const EXTRA_VOUCHERS = [
  // a registered vendor's purchase with no GST at all, numbered with the supplier's invoice number
  voucher('Purchase', 'PU-1', '20240610', [line('Teak Timber', '500.00', P), line('Repairs', '-500.00')], { party: 'Teak Timber', extra: { reference: 'TT/41' } }),
  // the other spelling of the same vendor, the same supplier number
  voucher('Purchase', 'PU-2', '20240611', [line('Teak Timber', '250.00', P), line('Repairs', '-250.00')], { party: 'Teak Timber', extra: { reference: 'TT/41' } }),
  // a purchase with CGST and SGST and nothing mapped
  voucher('Purchase', 'PU-3', '20240612', [line('Teak Timber', '1180.00', P), line('Repairs', '-1000.00'), line('Central GST Paid', '-90.00'), line('State GST Paid', '-90.00')], { party: 'Teak Timber' }),
  // a sale whose line carries a 5-digit HSN/SAC
  voucher('Sales', 'S-9', '20240613', [line('Sal Stores', '-300.00', P), line('Domestic Sales', '300.00', { gsthsnname: '99831' })], { view: 'invoice', party: 'Sal Stores' }),
  // journals nobody routes: a reimbursement, one dated before the year, one on the watched account type
  voucher('Journal', 'J-20', '20240614', [line('Travelling Expenses', '-75.00'), line('Ravi Kumar', '75.00', P)], { party: 'Ravi Kumar', narration: 'Travel reimbursement' }),
  voucher('Journal', 'J-21', '20240331', [line('Repairs', '-10.00'), line('Cash', '10.00')]),
  voucher('Journal', 'J-22', '20240615', [line('City Bank Current', '-900.00'), line('Directors Loan', '900.00')]),
];
// the made-up company the seeded viewer may read (seed-users.json), so that a viewer's rights can be tested too
const company = () => seed.users.find(u => u.role === 'viewer').company;
async function newMigration({ masters = [], vouchers = [] } = {}) {
  await login('analyst');
  const id = (await send('POST', '/api/migrations', { company: company(), financialYear: '2024-25' })).json().id, base = `/api/migrations/${id}`;
  assert.equal((await send('PUT', `${base}/voucher-settings`, { hsnEnabled: 'on' })).statusCode, 200); // no GSTIN: say the HSN/SAC field is on
  assert.equal((await putDoc(id, 'all_masters', { tallymessage: [...mastersDoc().tallymessage, ...JSON.parse(JSON.stringify(masters))] }, 'Master.json')).statusCode, 200);
  assert.equal((await putDoc(id, 'all_transactions', transactionsDoc([...VOUCHERS, ...vouchers]), 'Transactions.json')).statusCode, 200);
  assert.equal((await putDoc(id, 'trial_balance', trialBalanceReport(), 'TrialBal.json')).statusCode, 200);
  await send('PUT', `${base}/waivers/stock_summary`, { reason: 'Not needed for test' });
  const p = await send('POST', `${base}/process?wait=1`);
  assert.equal(p.statusCode, 200, p.body);
  return { id, base };
}
const generate = async base => { const r = await send('POST', `${base}/generate`); assert.equal(r.statusCode, 200, r.body); return r.json(); };
const flags = async (base, kind) => (await get(`${base}/summary`)).exceptions.filter(e => e.stage === 'generate' && e.kind === kind);
const trail = async id => (await get(`/api/migrations/${id}/audit`)).map(a => `${a.action} | ${a.detail}`);

test('THE ZERO-DECISION PATH: upload, process, create the files. Nothing is decided, nothing is silent, and no row hits a rule Zoho refused in the first import', async () => {
  const { id, base } = await newMigration({ masters: EXTRA_MASTERS, vouchers: EXTRA_VOUCHERS });
  // before the files exist the assumptions are already known (a dry run that writes nothing)
  const dry = await get(`${base}/assumptions`);
  assert.deepEqual([dry.available, dry.inFiles, (await get(`${base}/files`)).length], [true, null, 0]);
  const g = await generate(base);
  const F = {};
  for (const k of ['accounts', 'opening_balances_for_zoho_accounts', 'customers', 'vendors', 'items', 'invoices', 'bills', 'journals']) F[k] = await csv(base, k);
  const names = (k, col) => F[k].rows.map(r => r[col]);

  // ---- 1 and 2: Chart of Accounts ("Row already exists", "Opening Balance cannot be associated with the given account") ----
  const coa = Object.fromEntries(F.accounts.rows.map(r => [r['Account Name'], r]));
  for (const own of ['Advance Tax', 'Output CGST', 'Input CGST', 'TDS Payable']) assert.equal(coa[own], undefined, `${own}: Zoho's own account is used`);
  assert.deepEqual([coa['City Bank Current']['Account Type'], coa['City Bank Current']['Opening Balance'], coa['City Bank Current']['Debit or Credit']], ['Bank', '', ''], 'a bank account carries no opening balance here');
  assert.ok(F.accounts.rows.every(r => r['Account Type']), 'no row without an Account Type');
  assert.deepEqual([coa['Unposted Items']['Account Type'], coa['Directors Loan']['Account Type']], ['Other Current Liability', 'Non Current Liability']);
  // every balance once: in the journal, balanced on Opening Balance Adjustments, dated the day before the year
  const ob = F.opening_balances_for_zoho_accounts.rows;
  assert.deepEqual(ob.filter(r => r.Account !== 'Opening Balance Adjustments' && ['Advance Tax', 'City Bank Current'].includes(r.Account)).map(r => [r.Account, r.Debit, r.Credit, r['Journal Date']]),
    [['Advance Tax', '400.00', '', '2024-03-31'], ['City Bank Current', '1250.75', '', '2024-03-31']]);
  assert.ok(ob.reduce((t, r) => t.plus(r.Debit || 0).minus(r.Credit || 0), new Decimal(0)).isZero(), 'the opening balance journal balances');
  assert.deepEqual(F.accounts.rows.filter(r => r['Opening Balance'] && ob.some(j => j.Account === r['Account Name'])), [], 'no balance is in both files');
  const bank = await get(`${base}/bank-opening-balances`);
  assert.ok(bank.accounts.some(a => a.account === 'City Bank Current' && a.side === 'Debit' && a.amount === '1250.75' && !('name' in a)));

  // ---- 3: Items ("Enter the selling price of the item.") ----
  assert.ok(F.items.rows.length > 0 && F.items.rows.every(r => r.Rate !== '' && r.Account !== ''), 'every item has a Rate and a sales account');
  assert.ok(F.items.rows.every(r => r['Item Type'] === 'Sales' ? r['Purchase Account'] === '' : r['Purchase Account'] !== ''), 'a Purchase Account wherever the item can be bought');
  assert.ok(!F.items.headers.includes('CF.custom_field'));

  // ---- 4, 5 and 6: contacts ("Duplicate row found in your CSV/TSV file") ----
  assert.equal(new Set(names('vendors', 'Display Name')).size, F.vendors.rows.length, 'no Display Name twice');
  const vend = Object.fromEntries(F.vendors.rows.map(r => [r['Display Name'], r])), cust = Object.fromEntries(F.customers.rows.map(r => [r['Display Name'], r]));
  assert.equal(vend['Teak Timber']['Opening Balance'], '300.30', 'the two rows are one party: 100.10 + 200.20, added exactly');
  assert.equal(vend['Teak Timber\r\n'], undefined);
  assert.deepEqual([cust['Sal Stores']['GST Treatment'], cust['Sal Stores']['Place Of Contact'], cust['Sal Stores']['Billing State']], ['business_gst', 'TN', 'Tamil Nadu'], 'a valid GSTIN: registered, and the state of the GSTIN');
  assert.deepEqual([vend['Neem Agencies']['GST Treatment'], vend['Neem Agencies']['GST Identification Number (GSTIN)']], ['business_gst', ''], 'registered in Tally with no GSTIN: as in Tally, flagged, never turned into unregistered');
  assert.deepEqual([vend['Banyan Works']['Source Of Supply'], vend['Banyan Works']['Billing State']], ['MH', 'Goa'], "the GSTIN's state as source of supply; the address stays as in Tally");

  // ---- 8: journals. None is left out for want of a decision ----
  assert.deepEqual([g.vouchers.awaitingRouting, g.vouchers.balanced, g.vouchers.leftOutOutsideYear], [0, true, 1]);
  assert.ok(F.journals.rows.some(r => r['Reference Number'] === 'J-20' && r.Account === 'Accounts Payable' && r['Contact Name'] === 'Ravi Kumar'), 'the reimbursement is a Manual Journal');
  assert.ok(!F.journals.rows.some(r => r['Reference Number'] === 'J-21'), 'the journal dated before the year is left out');
  assert.ok(!F.bills.rows.some(r => r['Vendor Name'] === 'Ravi Kumar'));

  // ---- 9 and 10: bills ("The given total value 0 and the system generated total value N are not same") ----
  assert.deepEqual(F.bills.headers.filter(h => /^(Total|SubTotal|Balance|Item Total)$/.test(h)), [], 'no total column to be mapped');
  const bill = n => F.bills.rows.filter(r => r['Bill Number'] === n);
  assert.deepEqual([bill('TT/41').length, bill('PU-2').length, bill('PU-1').length], [1, 1, 0], "the supplier's number; the second bill of the same vendor with that number carries its voucher number");
  assert.deepEqual([bill('TT/41')[0]['Vendor Name'], bill('PU-2')[0]['Vendor Name']], ['Teak Timber', 'Teak Timber'], 'both bills name the contact kept');
  assert.equal(new Set(F.bills.rows.map(r => `${r['Vendor Name']}|${r['Bill Number']}`)).size, new Set(F.bills.rows.map(r => `${r['Vendor Name']}|${r['Bill Number']}|${r['Bill Date']}`)).size, 'one bill per vendor and number');
  // ---- 12 and 13: "Specify either a Tax or Tax Exemption or Reverse Charge." ----
  assert.deepEqual(['Tax Name', 'Tax Percentage', 'Tax Type'].map(h => bill('TT/41')[0][h]), ['GST0', '0', 'Tax Group'], 'a registered vendor, no GST in Tally, both states KA');
  assert.deepEqual(['Tax Name', 'Tax Percentage', 'Tax Type', 'Tax Amount'].map(h => bill('PU-3')[0][h]), ['GST18', '18', 'Tax Group', '180.00'], "nothing mapped: Zoho's own tax of the rate");
  const registered = F.bills.rows.filter(r => ['business_gst', 'business_sez'].includes(r['GST Treatment']));
  const refusedLines = registered.filter(r => !r['Tax Name'] && !r['Item Exemption Code'] && !r['Reverse Charge Tax Name']);
  assert.deepEqual(refusedLines.map(r => r['Bill Number']).sort(), (await flags(base, 'bill_line_needs_tax_or_exemption')).map(f => f.name.replace(/^\S+ /, '')).sort(), 'every line Zoho would refuse is flagged as blocking, none passes unnoticed');
  // ---- 11: HSN/SAC ----
  assert.deepEqual(F.invoices.rows.filter(r => r['Invoice Number'] === 'S-9').map(r => r['HSN/SAC']), [''], 'the 5-digit value is not written');
  assert.ok([...F.invoices.rows, ...F.bills.rows, ...F.items.rows].every(r => !r['HSN/SAC'] || D.hsnAccepted(r['HSN/SAC'])));

  // ---- no journal, bill or invoice row names an account Zoho will not have ----
  const zohoHas = new Set([...names('accounts', 'Account Name'), 'Accounts Receivable', 'Accounts Payable', 'Opening Balance Adjustments', 'Advance Tax', 'Output CGST', 'Input CGST', 'TDS Payable']);
  for (const k of ['journals', 'bills', 'invoices', 'opening_balances_for_zoho_accounts']) assert.deepEqual(F[k].rows.map(r => r.Account).filter(a => !zohoHas.has(a)), [], `${k}: every account exists`);
  const other = await call({ url: `${base}/files/other_journals/download` });
  if (other.statusCode === 200) assert.deepEqual(parseCsv(other.body).rows.map(r => r.Account).filter(a => !zohoHas.has(a)), []);

  // ---- nothing is silent: every default is a flagged item, an audit entry and a line of "Assumptions the tool made" ----
  const assumed = await get(`${base}/assumptions`);
  const count = k => assumed.assumptions.find(a => a.kind === k)?.count ?? 0;
  assert.deepEqual(['default_zoho_own_account', 'opening_balance_in_journal', 'gst_registered_from_gstin', 'gst_registered_without_gstin', 'state_from_gstin', 'place_differs_from_gstin', 'contact_merged_by_default',
    'journal_default_reimbursement', 'left_out_outside_year', 'bill_number_collision', 'account_type_default', 'account_type_unconfirmed'].map(k => [k, count(k) > 0]).filter(x => !x[1]), [], 'each default applied is listed');
  assert.deepEqual([count('contact_merged_by_default'), count('bill_number_collision'), count('left_out_outside_year'), count('journal_default_reimbursement'), count('account_type_default'), count('account_type_unconfirmed')], [1, 1, 1, 1, 1, 1]);
  assert.ok(count('bill_line_zero_tax') >= 1 && count('tax_name_default') >= 1 && count('hsn_not_written') >= 1 && count('item_rate_zero') === F.items.rows.filter(r => r.Rate === '0.00').length - count('service_item_for_account'));
  assert.deepEqual([assumed.sameAsFiles, assumed.total > 0, assumed.inFiles.assumptions.length], [true, true, assumed.assumptions.length]);
  assert.ok(assumed.assumptions.every(a => a.title && a.words && a.examples.every(e => Object.keys(e).join() === 'dataset,id')), 'examples by identifier');
  assert.deepEqual(g.assumptions.map(a => [a.kind, a.count]), assumed.assumptions.map(a => [a.kind, a.count]), 'creating the files answers with the same list');
  const audit = await trail(id);
  for (const a of assumed.assumptions) assert.ok(audit.some(x => x.startsWith(`default_applied | ${a.title}: ${a.count}.`)), `audited: ${a.kind}`);
  const rep = await get(`${base}/test-report`);
  assert.deepEqual(rep.assumptions.map(a => a.kind), assumed.assumptions.map(a => a.kind));
  // (audit item 13: the made-up Sales S-1 carries CGST and no SGST: no Zoho tax exists for half the GST, a person decides)
  // (OB-011 / OB-002: the made-up extra ledgers above carry opening balances that are not in the Trial Balance report and
  // do not add up to zero with the rest of the masters: that truly needs a person, and the tool must say so)
  assert.deepEqual(rep.whatToFixNext.filter(x => x.blocking).map(x => (x.message.match(/of kind "([a-z_]+)"/) || [])[1]).filter(k => !['bill_line_needs_tax_or_exemption', 'tds_not_mapped', 'tax_heads_incomplete', 'opening_balances_differ_in_tally', 'opening_balance_differs_from_trial_balance'].includes(k)), [], 'nothing blocks but what truly needs a person');
  const obDiff = (await flags(base, 'opening_balance_differs_from_trial_balance'))[0];
  assert.ok(obDiff && /"Advance Tax" master 400\.00 Debit, Trial Balance 0\.00/.test(obDiff.message) && /"City Bank Current" master 1250\.75 Debit/.test(obDiff.message), 'the extra openings are named against the Trial Balance');
  assert.equal((await flags(base, 'opening_balances_differ_in_tally')).length, 1, 'the masters do not add up to zero: said once');
  // a viewer reads the list
  await login('viewer');
  assert.equal((await call({ url: `${base}/assumptions` })).statusCode, 200);
  await login('analyst');

  // ---- C: the reconciliation still balances, and the control total agrees ----
  const recon = await get(`${base}/voucher-reconciliation`);
  assert.deepEqual([recon.total.matches, recon.lines.total.matches, recon.allChecksPass, recon.total.in === recon.total.out], [true, true, true, true], JSON.stringify(recon.checks.filter(c => !c.ok)));
  assert.deepEqual([recon.notInAnyFile.awaitingRouting, recon.notInAnyFile.leftOutOutsideYear, recon.total.leftOutReasons.outside_year], [0, 1, 1]);
  assert.ok(recon.checks.some(c => c.key === 'none_awaiting_routing' && c.ok));
  assert.deepEqual((await get(`${base}/voucher-control`)).control.leftOutOutsideYear, 1);

  // ---- a decision always wins over a default, and marks only the files it changes out of date ----
  assert.equal((await send('PUT', `${base}/voucher-settings`, { outOfYear: 'include' })).statusCode, 200);
  // (audit item 5: the service items of the Items file follow the invoices written)
  assert.deepEqual((await get(base)).outOfDateFiles.sort(), ['bills', 'invoices', 'items', 'journals', 'other_journals'].filter(k => g.files.some(f => f.key === k)).sort());
  const dupes = (await get(`${base}/names`)).duplicates.find(d => d.members.some(m => m.ledger === 'Teak Timber'));
  assert.deepEqual([dupes.defaultDecision, dupes.defaultKept, dupes.decision], ['merge', 'Teak Timber', null]);
  assert.equal((await send('PUT', `${base}/duplicates`, { key: dupes.key, decision: 'keep_both', names: { 'Teak Timber\r\n': 'Teak Timber (Depot)' } })).statusCode, 200);
  assert.equal((await send('PUT', `${base}/hsn-corrections`, { corrections: [{ from: '99831', to: '998311' }] })).statusCode, 200);
  const g2 = await generate(base);
  assert.deepEqual([g2.vouchers.leftOutOutsideYear, g2.assumptions.some(a => a.kind === 'contact_merged_by_default'), g2.assumptions.some(a => a.kind === 'voucher_outside_year_included')], [0, false, true]);
  assert.ok((await csv(base, 'journals')).rows.some(r => r['Reference Number'] === 'J-21'));
  assert.deepEqual((await csv(base, 'vendors')).rows.filter(r => /^Teak/.test(r['Display Name'])).map(r => [r['Display Name'], r['Opening Balance']]), [['Teak Timber (Depot)', '100.10'], ['Teak Timber', '200.20']]);
  assert.deepEqual((await csv(base, 'invoices')).rows.filter(r => r['Invoice Number'] === 'S-9').map(r => r['HSN/SAC']), ['998311']);
  assert.deepEqual((await flags(base, 'hsn_corrected')).length, 1);
});

test('default 11: the HSN/SAC corrections store lists every value in the data, takes corrections in bulk and refuses a code Zoho would refuse', async () => {
  const { id, base } = await newMigration({ vouchers: [EXTRA_VOUCHERS[3]], masters: [EXTRA_MASTERS.find(m => m.metadata.name === 'Sal Stores')] });
  let v = await get(`${base}/hsn-corrections`);
  const row = x => v.values.find(r => r.value === x);
  assert.deepEqual([row('99831').accepted, row('99831').lines, row('99831').written, row('99831').status, row('74111000').accepted, row('74111000').items], [false, 1, '', 'not_written', true, 1]);
  assert.deepEqual([v.counts.notWritten, v.counts.corrected], [1, 0]);
  const put = body => send('PUT', `${base}/hsn-corrections`, body);
  assert.equal((await put({})).statusCode, 400);
  let r = await put({ corrections: [{ from: '99831', to: '99831' }, { from: '74111000', to: '7411' }] });
  assert.equal(r.statusCode, 400, 'one bad entry: nothing is stored');
  assert.match(r.json().error, /"99831" is not an HSN\/SAC code Zoho Books accepts: it must be 4, 6 or 8 digits\. Nothing was changed/);
  assert.equal((await get(`${base}/hsn-corrections`)).counts.corrected, 0);
  await generate(base);
  r = await put({ corrections: [{ from: '99831', to: ' 998311 ' }, { from: '74111000', to: '' }, { from: '1234567', to: '12345678' }] });
  assert.equal(r.statusCode, 200, r.body);
  v = r.json();
  assert.deepEqual([v.changed, row('99831').written, row('99831').status, row('74111000').written, v.notInData], [3, '998311', 'corrected', '', [{ value: '1234567', correction: '12345678' }]]);
  assert.deepEqual((await get(base)).outOfDateFiles.sort(), ['bills', 'invoices', 'items'], 'the three files that write an HSN/SAC');
  assert.ok((await trail(id)).includes('hsn_corrected | HSN/SAC value "99831": no correction -> "998311"'));
  assert.equal((await put({ corrections: [{ from: '99831', to: '998311' }] })).json().changed, 0, 'the same correction again is not a change');
  await generate(base);
  assert.equal((await csv(base, 'items')).rows.find(x => x['Item Name'] === 'Copper Pipe 1m')['HSN/SAC'], '', 'written empty on purpose');
  r = await put({ corrections: [{ from: '74111000', to: null }] });
  assert.deepEqual([r.json().changed, r.json().values.find(x => x.value === '74111000').written], [1, '74111000'], 'a correction removed: the Tally value again');
  await login('viewer');
  assert.equal((await put({ corrections: [{ from: '99831', to: '9983' }] })).statusCode, 403);
  assert.equal((await call({ url: `${base}/hsn-corrections` })).statusCode, 200);
});

test('M1: reading the files again keeps the journal routing decisions (by Tally voucher), and lists the ones that no longer match', async () => {
  const { id, base } = await newMigration();
  const before = await get(`${base}/journals`);
  const j = n => before.find(x => x.number === n);
  // two decisions that differ from the defaults, so that losing them would show
  assert.equal((await send('PUT', `${base}/journals/${j('J-1').id}`, { decision: 'Manual Journal' })).statusCode, 200);
  assert.equal((await send('PUT', `${base}/journals/${j('J-3').id}`, { decision: 'Manual Journal' })).statusCode, 200);
  assert.equal((await send('PUT', `${base}/journals/${j('J-2').id}`, { decision: 'Bill' })).statusCode, 200);
  await generate(base);
  // process again: the same files
  let p = await send('POST', `${base}/process?wait=1`);
  assert.equal(p.statusCode, 200, p.body);
  assert.deepEqual(p.json().journalDecisions, { kept: 3, lost: [] });
  let after = await get(`${base}/journals`);
  assert.deepEqual(after.filter(x => x.decision).map(x => [x.number, x.decision, x.decidedBy]).sort(), [['J-1', 'Manual Journal', j('J-1').decidedBy ?? after.find(x => x.number === 'J-1').decidedBy], ['J-2', 'Bill', after.find(x => x.number === 'J-2').decidedBy], ['J-3', 'Manual Journal', after.find(x => x.number === 'J-3').decidedBy]].sort());
  assert.ok(after.find(x => x.number === 'J-1').id !== j('J-1').id, 'the stored records are new, with new ids');
  assert.ok(after.filter(x => x.decision).every(x => /@/.test(x.decidedBy) && x.decidedAt), 'who decided and when are kept');
  assert.deepEqual(await get(`${base}/files`), [], 'the files are removed, as before: they were built from the earlier reading');
  assert.ok((await trail(id)).some(x => /^journal_decisions_kept \| 3 journal routing decision\(s\) were kept/.test(x)));
  // a new transactions file in which J-1 is gone and J-2 has the vendor DEBITED now (it can no longer be a bill)
  const changed = VOUCHERS.filter(v => v.vouchernumber !== 'J-1').map(v => (v.vouchernumber !== 'J-2' ? v
    : { ...v, allledgerentries: v.allledgerentries.map(l => ({ ...l, amount: String(-Number(l.amount)), isdeemedpositive: !l.isdeemedpositive })) }));
  assert.equal((await putDoc(id, 'all_transactions', transactionsDoc(changed), 'Transactions-2.json')).statusCode, 200);
  p = await send('POST', `${base}/process?wait=1`);
  assert.equal(p.statusCode, 200, p.body);
  const kept = p.json().journalDecisions;
  assert.equal(kept.kept, 1);
  assert.deepEqual(kept.lost.map(l => [l.number, l.date, l.decision, l.why]).sort(), [['J-1', '2024-04-15', 'Manual Journal', 'the voucher is no longer a journal voucher in the files'], ['J-2', '2024-04-20', 'Bill', 'the voucher changed and can no longer be a bill']]);
  after = await get(`${base}/journals`);
  assert.deepEqual(after.filter(x => x.decision).map(x => [x.number, x.decision]), [['J-3', 'Manual Journal']]);
  // the screens read the same answer later, from the finished run (Prepare migration lists the ones not kept)
  const status = await get(`${base}/process-status`);
  assert.deepEqual([status.journalDecisions.kept, status.journalDecisions.lost.map(l => l.number).sort()], [1, ['J-1', 'J-2']]);
  assert.deepEqual((await get(`${base}/prepare`)).steps.find(s => s.key === 'process').processing.journalDecisions.kept, 1);
  assert.ok((await trail(id)).some(x => /^journal_decisions_kept \| 1 journal routing decision\(s\) were kept.* 2 decision\(s\) no longer match a journal voucher and were dropped: /.test(x)));
  // a run that fails loses nothing: the decisions are still there after the next good run
  const db = new DatabaseSync(path.join(process.env.DATA_DIR, 'migration.db'));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM journal_decisions_kept WHERE job_id = ?').get(id).n, 0, 'nothing is left waiting after a finished run');
  db.close();
});

test('M2: a voucher that is in no file never passes unnoticed: the test report blocks and the reconciliation fails its check', async () => {
  const { id, base } = await newMigration();
  await generate(base);
  let rep = await get(`${base}/test-report`);
  assert.equal(rep.voucherControl.awaitingRouting, 0);
  assert.ok(!rep.whatToFixNext.some(x => /in none of the files created last/.test(x.message)));
  assert.ok(rep.whatToFixNext.some(x => !x.blocking && /journal vouchers? ha(s|ve) no routing decision\. (It is|They are) not left out/.test(x.message)), 'the default is said as an assumption, not as a blocker');
  // files created by an earlier version: a journal recorded as waiting for routing
  const db = new DatabaseSync(path.join(process.env.DATA_DIR, 'migration.db'));
  const rec1 = db.prepare("SELECT r.source_record_id id, s.source_id sid, s.name FROM generated_rows r JOIN source_records s ON s.id = r.source_record_id WHERE r.job_id = ? AND r.key = 'journals' LIMIT 1").get(id);
  db.prepare("DELETE FROM generated_rows WHERE job_id = ? AND key = 'journals' AND source_record_id = ?").run(id, rec1.id);
  db.prepare("INSERT INTO exceptions (job_id, stage, slot, source_id, name, message) VALUES (?, 'generate', 'journal', ?, ?, 'Journal voucher has not been routed yet. Choose Invoice, Bill or Manual Journal in Voucher Classification.')").run(id, rec1.sid, rec1.name);
  db.prepare("UPDATE voucher_recon SET data = json_set(data, '$.outcome', 'awaiting_routing', '$.file', NULL) WHERE job_id = ? AND source_record_id = ?").run(id, rec1.id);
  db.close();
  rep = await get(`${base}/test-report`);
  assert.equal(rep.voucherControl.awaitingRouting, 1);
  assert.ok(rep.whatToFixNext.some(x => x.blocking && x.stage === 'Files' && /^1 journal voucher is in none of the files created last, because it was waiting for a routing decision\. Create the files again/.test(x.message)));
  const recon = await get(`${base}/voucher-reconciliation`);
  const check = recon.checks.find(c => c.key === 'none_awaiting_routing');
  assert.deepEqual([check.ok, recon.allChecksPass, recon.notInAnyFile.awaitingRouting], [false, false, 1]);
  assert.match(check.text, /1 journal voucher\(s\) are waiting for a routing decision and are in NO file/);
  // creating the files again puts it right
  await generate(base);
  assert.equal((await get(`${base}/voucher-reconciliation`)).allChecksPass, true);
});

test('Fix contacts: several rows saved in one request; each keeps its own values; one refused entry stores nothing', async () => {
  const { id, base } = await newMigration({ masters: EXTRA_MASTERS });
  await generate(base);
  const patch = body => send('PATCH', `${base}/contact-fixes`, body);
  assert.equal((await patch({})).statusCode, 400);
  assert.equal((await patch({ fixes: [] })).statusCode, 400);
  // three rows at once, each with only the field that was changed on the screen
  let r = await patch({ fixes: [{ ledger: 'Neem Agencies', gstin: '32NEEMA1234F1Z9', reason: 'From the vendor letterhead' }, { ledger: 'Ravi Kumar', state: 'TN' }, { ledger: 'Sal Stores', treatment: 'unregistered' }] });
  assert.equal(r.statusCode, 200, r.body);
  let v = r.json();
  const row = l => v.rows.find(x => x.ledger === l);
  assert.equal(v.changed, 3);
  assert.deepEqual([row('Neem Agencies').fix, row('Ravi Kumar').fix, row('Sal Stores').fix].map(f => [f.gstin, f.state, f.treatment]), [['32NEEMA1234F1Z9', '', ''], ['', 'TN', ''], ['', '', 'unregistered']]);
  assert.deepEqual([row('Neem Agencies').written.gstTreatment, row('Neem Agencies').written.place, row('Ravi Kumar').written.place, row('Sal Stores').written.gstTreatment], ['business_gst', 'KL', 'TN', 'business_none']);
  // (audit item 5: a contact's GST details decide what its bills and invoices carry, so journals routed by default and
  // the service items may change too)
  assert.deepEqual((await get(base)).outOfDateFiles.sort(), ['bills', 'customers', 'invoices', 'items', 'journals', 'vendors']);
  // a later change to ONE field of one row leaves its other fields, and every other row, as they are
  r = await patch({ fixes: [{ ledger: 'Ravi Kumar', gstin: '33RAVIK1234F1ZS' }] });
  assert.equal(r.statusCode, 200, r.body);
  v = r.json();
  assert.deepEqual([row('Ravi Kumar').fix.gstin, row('Ravi Kumar').fix.state, row('Neem Agencies').fix.gstin, row('Neem Agencies').fix.state, row('Sal Stores').fix.treatment], ['33RAVIK1234F1ZS', 'TN', '32NEEMA1234F1Z9', '', 'unregistered'],
    "one row's state is never changed by saving another row");
  // one refused entry: an error naming the row, and NOTHING stored, also not the good entries beside it
  r = await patch({ fixes: [{ ledger: 'Banyan Works', state: 'GA' }, { ledger: 'Neem Agencies', state: 'TN' }, { ledger: 'Nobody', gstin: '29ABCDE1234F1ZW' }] });
  assert.equal(r.statusCode, 400);
  assert.deepEqual(r.json().errors.map(e => e.ledger), ['Banyan Works', 'Neem Agencies', 'Nobody']);
  assert.match(r.json().errors[1].error, /registered in Kerala \(KL\), not in Tamil Nadu \(TN\)/);
  v = await get(`${base}/contact-fixes`);
  assert.deepEqual([row('Banyan Works').fix, row('Neem Agencies').fix.state], [null, '']);
  assert.equal((await patch({ fixes: [{ ledger: 'Ravi Kumar', state: 'KA' }, { ledger: 'Ravi Kumar', state: 'TN' }] })).statusCode, 400, 'the same contact twice in one request');
  // clearing a field
  v = (await patch({ fixes: [{ ledger: 'Ravi Kumar', state: '' }] })).json();
  assert.deepEqual([row('Ravi Kumar').fix.gstin, row('Ravi Kumar').fix.state], ['33RAVIK1234F1ZS', '']);
  const audit = await trail(id);
  assert.ok(audit.some(x => x === 'contact_fixed | Contact "Neem Agencies" (Fix contacts): no correction -> GSTIN 32NEEMA1234F1Z9. Reason: From the vendor letterhead'));
  assert.ok(audit.some(x => /^contact_fixed \| Contact "Ravi Kumar" \(Fix contacts\): state TN -> GSTIN 33RAVIK1234F1ZS, state TN\./.test(x)));
  await login('viewer');
  assert.equal((await patch({ fixes: [{ ledger: 'Ravi Kumar', state: 'KA' }] })).statusCode, 403);
});

test('M7 and M8 through the API: a crafted workbook on the Zoho-side screens gets an answer in words, and the server goes on', async () => {
  const { base } = await newMigration();
  await generate(base);
  const hugeRow = xlsx(`<row r="1">${cell('A1', 'Display Name')}${cell('B1', 'Error Message')}</row><row r="4000000000">${cell('A4000000000', 'x')}</row>`);
  const bomb = zip([['xl/worksheets/sheet1.xml', Buffer.alloc(80 * 1024 * 1024)]]);
  for (const url of [`${base}/rejections/customers`, `${base}/zoho-trial-balance?basis=closing`]) {
    let r = await upload(url, hugeRow);
    assert.equal(r.statusCode, 422, `${url}: ${r.body}`);
    assert.match(r.json().error, /row numbered 4000000000, beyond the/);
    r = await upload(url, bomb);
    assert.equal(r.statusCode, 422, `${url}: ${r.body}`);
    assert.match(r.json().error, /too large once it is unpacked/);
  }
  // a good workbook still works, on the same server
  const ok = await upload(`${base}/rejections/customers`, xlsx(`<row r="1">${cell('A1', 'Display Name')}${cell('B1', 'Error Message')}</row><row r="2">${cell('A2', 'Maple Leaf Traders')}${cell('B2', 'Duplicate row found in your CSV/TSV file')}</row>`));
  assert.deepEqual([ok.statusCode, ok.json().rejected, ok.json().linked], [200, 1, 1]);
  assert.equal((await call({ url: '/api/health' })).statusCode, 200);
});

test('the import order: a file is not ready while a file it depends on has rows Zoho refused', async () => {
  const { base } = await newMigration();
  await generate(base);
  const imports = async () => Object.fromEntries((await get(`${base}/imports`)).map(i => [i.key, i]));
  // the Import Wizard's set-up and Migration Date first: the older route follows the wizard's locks
  const mark = async (key, status) => { await wizardReady(call, base); return send('PUT', `${base}/imports/${key}`, { status }); };
  await call({ url: `${base}/files/accounts/download` });
  assert.equal((await mark('accounts', 'imported')).statusCode, 200);
  assert.deepEqual([(await imports()).customers.ready, (await imports()).customers.waitingFor], [true, []]);
  // Zoho's error file for the Chart of Accounts: one row was refused
  const account = (await csv(base, 'accounts')).rows[0]['Account Name'];
  const r = await call({ method: 'PUT', url: `${base}/rejections/accounts`, headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from(`Account Name,ERRORMESSAGE\r\n${account},Invalid row\r\n`) });
  assert.equal(r.statusCode, 200, r.body);
  const now = await imports();
  assert.deepEqual([now.accounts.refusedRows, now.customers.ready, now.customers.waitingFor, now.customers.waitingForRefused], [1, false, ['Chart of Accounts'], [{ key: 'accounts', module: 'Chart of Accounts', rows: 1 }]]);
  assert.equal(now.journals.ready, false, 'every file that needs the accounts waits');
  await call({ url: `${base}/files/customers/download` });
  const refused = await mark('customers', 'imported');
  assert.equal(refused.statusCode, 409, 'and cannot be recorded as imported');
  assert.match(refused.json().error, /Chart of Accounts/);
});
