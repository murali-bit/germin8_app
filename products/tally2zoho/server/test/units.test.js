// Direct checks of the small rule functions (no server needed for most of them).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = process.env.DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'mig-unit-'));
const { resolveAccountType, TEMPLATES } = await import('../src/zoho.js');
const { parseReportAmount } = await import('../src/extras.js');
const { fieldsNotRead } = await import('../src/fields.js');
const { crossCheck } = await import('../src/crosscheck.js');

test('reserved Tally groups never take their parent group type', () => {
  const ctx = { accountTypes: {}, groupParents: { 'Sundry Debtors': 'Current Assets', 'Sundry Creditors': 'Current Liabilities', 'Bank OCC A/c': 'Loans (Liability)',
    'North Debtors': 'Sundry Debtors', 'Site Stores': 'Current Assets' } };
  for (const g of ['Sundry Debtors', 'North Debtors', 'Sundry Creditors']) {
    assert.deepEqual(resolveAccountType(g, ctx), { type: '', source: null, inheritedFrom: null }, g);
  }
  // changed on purpose (opening balance batch): Bank OCC A/c has a standard type of its own now. The vouchers treat it as
  // a bank ledger, so it is a Bank account in Zoho Books (never the type of the group above it, Loans (Liability))
  assert.deepEqual(resolveAccountType('Bank OCC A/c', ctx), { type: 'Bank', source: 'standard', inheritedFrom: null });
  assert.equal(resolveAccountType('Bank OD A/c', ctx).type, 'Bank');
  // an ordinary sub-group still inherits
  assert.deepEqual(resolveAccountType('Site Stores', ctx), { type: 'Other Current Asset', source: 'inherited', inheritedFrom: 'Current Assets' });
  // the ledger is flagged and written with a blank type
  assert.match([].concat(TEMPLATES.accounts.check({ name: 'Acme', parent: 'Sundry Debtors' }, ctx))[0], /has no approved Zoho account type/);
  assert.equal(TEMPLATES.accounts.row({ name: 'Acme', parent: 'Sundry Debtors' }, ctx)['Account Type'], '');
  // a decision on the parent of a reserved group does not reach through it; a decision on the reserved group does
  const decidedAbove = { ...ctx, accountTypes: { 'Current Assets': 'Other Asset' } };
  assert.equal(resolveAccountType('North Debtors', decidedAbove).type, '');
  const decided = { ...ctx, accountTypes: { 'Sundry Debtors': 'Other Current Asset' } };
  assert.deepEqual(resolveAccountType('Sundry Debtors', decided), { type: 'Other Current Asset', source: 'decided', inheritedFrom: null });
  assert.deepEqual(resolveAccountType('North Debtors', decided), { type: 'Other Current Asset', source: 'inherited', inheritedFrom: 'Sundry Debtors' });
});

test('amounts in a Zoho report are read exactly or not at all', () => {
  const read = v => { const d = parseReportAmount(v); return d === null ? null : d.toFixed(); };
  // clear inputs
  assert.equal(read('1,45,000.00'), '145000');
  assert.equal(read('1,234,567.50'), '1234567.5');
  assert.equal(read('(500.00)'), '-500');
  assert.equal(read('500.00-'), '-500');
  assert.equal(read('-500'), '-500');
  assert.equal(read('₹ 500'), '500');
  assert.equal(read('₹-500'), '-500');
  assert.equal(read('Rs. 1,200.50'), '1200.5');
  assert.equal(read('+12'), '12');
  assert.equal(read('100.004'), '100.004', 'not rounded');
  // unclear inputs are not guessed
  for (const bad of ['', '   ', '(-500)', '--500', '-500-', '(500)-', '500,00', '1.234,56', '12,5', '1,2345.00', '1 234.50', '500 Cr', '₹ (500.00)', 'abc', '-+5']) {
    assert.equal(read(bad), null, `"${bad}" must be not available`);
  }
});

test('fields not read depend on the dataset and on the exact field name', () => {
  const names = (records, slot) => fieldsNotRead(records, slot).fields.map(f => f.name);
  const taxLedger = { metadata: { type: 'Ledger' }, name: 'CGST', parent: 'Duties & Taxes', openingbalance: '5000.00', partygstin: '27AAA', address: ['x'], description: 'desc', taxtype: 'GST', gstdutyhead: 'CGST', rateofduty: 9 };
  assert.deepEqual(names([taxLedger], 'taxes'), ['address', 'description', 'openingbalance', 'partygstin', 'rateofduty']); // changed on purpose in B6-B7: taxtype and gstdutyhead are read
  assert.match(fieldsNotRead([taxLedger], 'taxes').note, /No Zoho file is created/);
  // the same ledger in the Customer file: the contact fields are written, the description is not
  assert.deepEqual(names([taxLedger], 'customers'), ['description', 'gstdutyhead', 'rateofduty', 'taxtype']);
  // Chart of Accounts: name, group, description and the opening balance are written
  assert.deepEqual(names([taxLedger], 'accounts'), ['address', 'gstdutyhead', 'partygstin', 'rateofduty', 'taxtype']);
  // ledgername and stockitemname are only a fallback for a missing name
  assert.deepEqual(names([{ metadata: { type: 'Ledger' }, name: 'A', ledgername: 'alias', stockitemname: 'weird' }], 'customers'), ['ledgername', 'stockitemname']);
  assert.deepEqual(names([{ metadata: { type: 'Ledger' }, ledgername: 'alias', stockitemname: 'weird' }], 'customers'), ['stockitemname']);
  // Stock Summary: closing figures are only shown on screen, not transferred
  assert.deepEqual(names([{ metadata: { type: 'StockSummaryLine' }, name: 'Bolt', closingquantity: ' 5 nos', closingvalue: '-10.00' }], 'stock_summary'), ['closingquantity', 'closingvalue']);
  // a field written with capital letters is not read by the platform, and the likely field is named
  assert.deepEqual(fieldsNotRead([{ metadata: { type: 'Ledger' }, Name: 'Upper', PartyGSTIN: '27X' }], 'customers').fields,
    [{ name: 'Name', records: 1, likeField: 'name' }, { name: 'PartyGSTIN', records: 1, likeField: 'partygstin' }]);
  // voucher lines are unchanged
  const v = { metadata: { type: 'Voucher' }, date: '20240401', reference: 'R1', ledgerentries: [{ ledgername: 'A', amount: '1', isdeemedpositive: true, billallocations: [{ name: 'x' }] }] };
  assert.deepEqual(names([v], 'sales'), ['ledgerentries.isdeemedpositive']); // changed on purpose in B6: the supplier reference is read (Bill Number setting); in B8: the bill-wise details are read
});

test('party check when the voucher names no party, and cash parties', () => {
  const masters = { customers: ['Cust'], vendors: ['Vend'], accounts: ['Sales', 'Cash', 'Purchases'], taxes: [] };
  const run = vouchers => crossCheck({ masters, items: null, units: null, vouchers, trialBalance: [] });
  const sale = (id, data) => ({ id, slot: 'sales', name: `Sales S${id}`, data });
  // no party named, but the line marked as the party line names a vendor
  let out = run([sale(1, { ledgerentries: [{ ledgername: 'Vend', amount: '-100', ispartyledger: true }, { ledgername: 'Sales', amount: '100' }] })]);
  assert.deepEqual(out.map(o => [o.kind, o.name]), [['party_missing', 'Vend']]);
  assert.match(out[0].message, /It is in the Vendor file instead/);
  // no party named and no marked line, but a line names a customer: generation can find the party, nothing to flag
  out = run([sale(2, { ledgerentries: [{ ledgername: 'Cust', amount: '-100' }, { ledgername: 'Sales', amount: '100' }] })]);
  assert.deepEqual(out, []);
  // no party at all: one item for all such vouchers
  const noParty = { ledgerentries: [{ ledgername: 'Cash', amount: '-100' }, { ledgername: 'Sales', amount: '100' }] };
  out = run([sale(3, noParty), sale(4, noParty)]);
  assert.deepEqual(out.map(o => [o.kind, o.slot, o.uses]), [['party_blank', 'sales', 2]]);
  assert.match(out[0].message, /2 sales vouchers \(the first is Sales S3\) have no party named/);
  // cash sale: flagged, but the advice is not to add Cash to the Customer file
  out = run([sale(5, { partyledgername: 'Cash', ledgerentries: [{ ledgername: 'Cash', amount: '-100', ispartyledger: true }, { ledgername: 'Sales', amount: '100' }] })]);
  assert.deepEqual(out.map(o => o.kind), ['party_missing']);
  assert.match(out[0].message, /looks like a cash or bank sale\. Zoho Books needs a customer on every invoice\. An accountant must decide/);
  assert.doesNotMatch(out[0].message, /add it to the Customer file/);
  // a journal with no party is not a party problem
  out = run([{ id: 6, slot: 'journal', name: 'Journal J6', data: { ledgerentries: [{ ledgername: 'Cash', amount: '-1' }, { ledgername: 'Sales', amount: '1' }] } }]);
  assert.deepEqual(out, []);
});
