// S4 (extraction and completeness): the rules that make every Tally voucher reach exactly one outcome, unit by unit.
// TALLY-001 duplicates by guid, TALLY-002 posting vouchers of other types, TALLY-003 sales and purchases that cannot be
// documents, TALLY-009 / OB-003 numbers Zoho cannot take, TALLY-013 odd list shapes, TALLY-014 prototype keys,
// TALLY-005 files that are not UTF-8, TALLY-007 status flags, TALLY-015 one set of invisible characters.
// Every value here is MADE UP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NameSet, voucherBalance, lineList, oddListShape, hasPostingLines, voucherStatus, unverifiedStatusFlags, hasHiddenCharacters, matchKey, nameKey, cleanIdentifier } from '../src/tally.js';
import { routeVoucherType, voucherTypeMap, isNonPostingBase } from '../src/transactions.js';
import { groupTree } from '../src/masters.js';
import { buildVoucherOutput, uniqueJournalNumber, voucherLines } from '../src/vouchers.js';
import { readTallyFile } from '../src/tallystream.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const P = { ispartyledger: true };
const line = (ledgername, amount, extra = {}) => ({ ledgername, amount, ...extra });
const voucher = (type, number, date, lines, extra = {}) => ({ metadata: { type: 'Voucher', vchtype: type }, vouchertypename: type, vouchernumber: number, date, allledgerentries: lines, ...extra });
let nextId = 1;
const rec = (slot, data, { sourceId, decision } = {}) => { const id = nextId++; return { id, source_id: sourceId ?? `guid-${id}`, name: `${data.vouchertypename} ${data.vouchernumber}`, slot, data, decision }; };
const ctx = (extra = {}) => ({ customers: new NameSet(['Alder Retail', 'Birch Retail']), vendors: new NameSet(['Elm Works', 'Fir Works']), taxLedgers: new NameSet([]),
  kindOf: name => ({ Cash: 'bank', 'Main Bank': 'bank', 'Service Income': 'income', Salaries: 'expense', 'Office Rent': 'expense', 'Alder Retail': 'customer', 'Birch Retail': 'customer', 'Elm Works': 'vendor', 'Fir Works': 'vendor' }[name] ?? null),
  ...extra });

test('TALLY-013: a list of lines written as one object, or with an empty item, is read; nothing throws', () => {
  const asObject = { allledgerentries: [line('Alder Retail', '-10.00')], allinventoryentries: { stockitemname: 'Mat', accountingallocations: [line('Service Income', '10.00')] } };
  const withNull = { allledgerentries: [line('Alder Retail', '-10.00')], allinventoryentries: [null, { stockitemname: 'Mat', accountingallocations: { ledgername: 'Service Income', amount: '10.00' } }] };
  for (const v of [asObject, withNull]) {
    assert.equal(voucherBalance(v).ok, true);
    assert.equal(voucherLines(v).length, 2);
    assert.equal(oddListShape(v), true);
  }
  assert.deepEqual([lineList(null), lineList({ a: 1 }), lineList([null, 3, { b: 2 }])], [[], [{ a: 1 }], [{ b: 2 }]]);
  assert.equal(oddListShape({ allledgerentries: [line('A', '-1'), line('B', '1')] }), false);
});

test('TALLY-014: names like "Constructor" or "toString" are ordinary names in every lookup table', () => {
  assert.deepEqual(routeVoucherType('Constructor', { Constructor: { parent: 'Sales', reserved: '' } }), { slot: 'sales', base: 'Sales', how: 'master' });
  assert.deepEqual(routeVoucherType('constructor'), { slot: 'other_vouchers', base: null, how: 'unresolved' });
  assert.deepEqual(routeVoucherType('__proto__'), { slot: 'other_vouchers', base: null, how: 'unresolved' });
  const map = voucherTypeMap([{ metadata: { type: 'Voucher Type', name: 'toString' }, parent: 'Receipt' }]);
  assert.equal(routeVoucherType('toString', map).slot, 'receipt');
  const tree = groupTree([{ metadata: { type: 'Group', name: 'constructor' }, parent: 'Sundry Debtors' }, { metadata: { type: 'Group', name: 'Sundry Debtors', reservedname: 'Sundry Debtors' } }]);
  assert.equal(tree.sectionOf('constructor'), 'customers');
  assert.equal(tree.sectionOf('hasOwnProperty'), null);
});

test('TALLY-015: one set of invisible characters, written as escapes; names are compared, never changed', () => {
  const src = fs.readFileSync(path.resolve(here, '../src/tally.js'), 'latin1');
  assert.ok(!/[\x00-\x03\x05-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(src), 'tally.js holds no raw control character (tools read it as text)');
  for (const ch of ['‍', '‌', '⁠', '­', '‎', '‮', ' ', '﻿', '​', '\r']) assert.equal(hasHiddenCharacters(`A${ch}B`), true, ch.codePointAt(0).toString(16));
  assert.equal(hasHiddenCharacters('Plain Name & Co.'), false);
  assert.equal(matchKey('A B'), matchKey('A B'), 'a no-break space matches a space');
  assert.equal(matchKey('Ledger\r\n'), 'Ledger');
  assert.equal(nameKey(' Two​  Words '), 'two words');
  assert.equal(cleanIdentifier('29ABCDE1234F1Z5‍\r\n'), '29ABCDE1234F1Z5');
});

test('TALLY-005: a file that is not UTF-8 is refused with where it fails; a UTF-8 file with the same name is read exactly', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-enc-'));
  const text = JSON.stringify({ tallymessage: [{ metadata: { type: 'Ledger', name: 'Café Supplies' } }] });
  const bad = path.join(dir, 'ansi.json'), good = path.join(dir, 'utf8.json');
  fs.writeFileSync(bad, Buffer.from(text, 'latin1'));
  fs.writeFileSync(good, Buffer.from(text, 'utf8'));
  assert.throws(() => [...readTallyFile(bad)], /record 1 at position \d+ in the file has bytes that are not UTF-8 text.*not in UTF-8 or UTF-16/);
  const rec1 = [...readTallyFile(good)].find(e => e.type === 'record');
  assert.equal(rec1.value.metadata.name, 'Café Supplies');
});

test('TALLY-007: void and deleted-retained vouchers are not posted; on hold, post-dated and opening-balance vouchers are flagged', () => {
  assert.deepEqual([voucherStatus({ isvoid: true }), voucherStatus({ isdeletedretained: true }), voucherStatus({ isdeletedvchretained: 'Yes' }), voucherStatus({ isonhold: true })], ['void', 'deleted', 'deleted', null]);
  assert.deepEqual(unverifiedStatusFlags({ isonhold: true, ispostdated: false, vchstatusisopeningbalance: true }), ['isonhold', 'vchstatusisopeningbalance']);
  const v = voucher('Journal', 'J-1', '20250501', [line('Office Rent', '-5.00'), line('Cash', '5.00')], { isvoid: true });
  const out = buildVoucherOutput([rec('journal', v, { decision: 'Manual Journal' }), rec('journal', voucher('Journal', 'J-2', '20250501', [line('Office Rent', '-5.00'), line('Cash', '5.00')], { ispostdated: true }), { decision: 'Manual Journal' })], ctx());
  assert.deepEqual(out.recon.map(e => [e.number, e.outcome, e.reason]), [['J-1', 'left_out', 'void'], ['J-2', 'written', null]]);
  assert.ok(out.recon[1].flags.includes('voucher_status_unverified'));
});

test('TALLY-001: a second copy of a voucher (same guid) is left out as a duplicate; vouchers without a number never collide', () => {
  const s = voucher('Sales', 'S-1', '20250501', [line('Alder Retail', '-100.00', P), line('Service Income', '100.00')], { partyledgername: 'Alder Retail' });
  const out = buildVoucherOutput([rec('sales', s, { sourceId: 'g-1' }), rec('journal', { ...s, vouchertypename: 'Journal' }, { sourceId: 'g-1', decision: 'Invoice' }), rec('sales', s, { sourceId: 'g-2' })], ctx());
  assert.deepEqual(out.recon.map(e => [e.outcome, e.reason]), [['written', null], ['left_out', 'duplicate'], ['written', null]]);
  assert.equal(out.invoices.vouchers, 2);
  assert.match(out.exceptions.find(e => e.kind === 'left_out_duplicate').message, /second copy of the Tally voucher "Sales S-1" \(stored in another dataset, sales\)/);
  // the first copy named by the caller (over every dataset) wins over the order given
  const first = rec('sales', s, { sourceId: 'g-9' }), copy = rec('purchase', s, { sourceId: 'g-9' });
  const out2 = buildVoucherOutput([copy, first], ctx({ duplicateOf: new Map([[copy.id, { id: first.id, slot: 'sales', name: first.name }]]) }));
  assert.deepEqual(out2.recon.map(e => [e.id === first.id ? 'first' : 'copy', e.outcome]), [['copy', 'left_out'], ['first', 'written']]);
});

test('TALLY-002: a voucher of another type is a Manual Journal when it posts; never for a type Tally does not post or a voucher with no amount', () => {
  const types = { Payroll: { parent: 'Payroll', reserved: 'Payroll' }, Memorandum: { parent: 'Memorandum', reserved: 'Memorandum' }, 'Stock Journal': { parent: 'Stock Journal', reserved: 'Stock Journal' } };
  const vs = [
    rec('other_vouchers', voucher('Payroll', 'PR-1', '20250531', [line('Salaries', '-900.00'), line('Cash', '900.00')])),
    rec('other_vouchers', voucher('Site Slip', 'SS-1', '20250601', [line('Office Rent', '-10.00'), line('Cash', '10.00')])), // not in the masters
    rec('other_vouchers', voucher('Memorandum', 'M-1', '20250602', [line('Office Rent', '-10.00'), line('Cash', '10.00')])),
    rec('other_vouchers', voucher('Stock Journal', 'SJ-1', '20250603', [], { inventoryentriesin: [{ stockitemname: 'Mat', amount: '-50.00' }] })),
  ];
  const out = buildVoucherOutput(vs, ctx({ voucherTypes: types }));
  assert.deepEqual(out.recon.map(e => [e.number, e.outcome, e.file ?? e.reason]), [['PR-1', 'written', 'journals'], ['SS-1', 'written', 'journals'], ['M-1', 'no_file', 'type_not_posted'], ['SJ-1', 'no_file', 'no_ledger_amount']]);
  assert.match(out.exceptions.find(e => e.kind === 'other_type_written_as_journal' && e.rec.data.vouchernumber === 'SS-1').message, /could not be traced to one of Tally's own voucher types/);
  assert.deepEqual([isNonPostingBase('Reversing Journal'), isNonPostingBase('Payroll'), isNonPostingBase(null), hasPostingLines(vs[3].data), hasPostingLines({ allledgerentries: [line('X', 'garbled')] })], [true, false, false, false, true]);
});

test('TALLY-003: sales and purchases that cannot be documents are Manual Journals posting what Tally posted; a party missing from the masters stays a document', () => {
  const out = buildVoucherOutput([
    rec('sales', voucher('Sales', 'CS-1', '20250501', [line('Cash', '-250.00'), line('Service Income', '250.00')], { partyledgername: 'Cash' })),                                     // a counter sale
    rec('purchase', voucher('Purchase', 'PB-2', '20250502', [line('Elm Works', '60.00', P), line('Fir Works', '40.00', P), line('Office Rent', '-100.00')])),                      // two vendors
    rec('sales', voucher('Sales', 'SR-3', '20250503', [line('Alder Retail', '70.00', P), line('Service Income', '-70.00')], { partyledgername: 'Alder Retail' })),                // a return in a sales voucher
    rec('sales', voucher('Sales', 'MS-4', '20250504', [line('Gone Away Traders', '-30.00', P), line('Service Income', '30.00')], { partyledgername: 'Gone Away Traders' })),      // not in the masters at all
    rec('sales', voucher('Sales', 'UB-5', '20250505', [line('Alder Retail', '-30.00', P), line('Service Income', '20.00')], { partyledgername: 'Alder Retail' })),                // unbalanced
  ], ctx());
  assert.deepEqual(out.recon.map(e => [e.number, e.outcome, e.file ?? e.reason]), [['CS-1', 'written', 'journals'], ['PB-2', 'written', 'journals'], ['SR-3', 'written', 'journals'], ['MS-4', 'written', 'invoices'], ['UB-5', 'left_out', 'not_balanced']]);
  assert.deepEqual(out.recon.slice(0, 3).map(e => e.posting), [{ debit: '250.00', credit: '250.00' }, { debit: '100.00', credit: '100.00' }, { debit: '70.00', credit: '70.00' }]);
  assert.deepEqual(out.exceptions.filter(e => /_written_as_journal$/.test(e.kind)).map(e => [e.rec.data.vouchernumber, e.kind]), [['CS-1', 'sales_written_as_journal'], ['PB-2', 'purchase_written_as_journal'], ['SR-3', 'sales_written_as_journal']]);
  assert.match(out.exceptions.find(e => e.rec.data.vouchernumber === 'CS-1' && e.kind === 'sales_written_as_journal').message, /the party it names \("Cash"\) is a ledger of the masters that is not a customer/);
});

test('TALLY-009 / OB-003: every journal and document gets a usable, unique number; the Tally number is kept', () => {
  const j = (type, number, slot = 'journal', extra = {}) => rec(slot, voucher(type, number, '20250510', [line('Office Rent', '-1.00'), line('Main Bank', '1.00')], extra), { decision: 'Manual Journal' });
  const out = buildVoucherOutput([
    j('Receipt', 'RV/2025-26/0001', 'receipt'), j('Receipt', 'RV/2024-25/0001', 'receipt'), j('Payment', 'PV/2025-26/0001', 'payment'),
    j('Journal', ''), j('Journal', ''), j('Journal', 'JV/001/A'), j('Journal', 'OB-1'), j('Journal', '123456789012345'), j('Journal', '123456789012345'),
  ], ctx());
  const numbers = [...out.journals.rows, ...out.other_journals.rows].map(r => `${r.row['Journal Number Prefix']}${r.row['Journal Number Suffix']}`);
  assert.ok(numbers.every(n => /\d$/.test(n) && n.length <= 16), numbers.join(', '));
  const docs = out.recon.map(e => e.number);
  // RV/2024-25/0001 ends in the digits RCT-0001 already has: the next free generated number; OB-1 is the opening balance
  // journal's number: "-2"; the second 15-digit number has no room for "-2" and its digits do not fit after JRN-
  assert.deepEqual(docs, ['RCT-0001', 'RCT-000001', 'PMT-0001', 'JRN-000001', 'JRN-000002', 'JRN-000003', 'OB-1-2', '123456789012345', 'JRN-000004']);
  assert.equal(new Set(docs.map(d => d.toLowerCase())).size, docs.length, 'no two journals share a number (OB-1 is the opening balance journal)');
  assert.ok(out.other_journals.rows[0].row.Notes.includes('RV/2025-26/0001'), 'the Tally number is kept in the Notes');
  // a taken set with the opening balance journals: never reused
  const res = { number: 'OB-2', typeCode: '', flags: [], rows: [{ Notes: 'x' }] };
  uniqueJournalNumber(res, { vouchernumber: 'OB-2' }, new Set(['ob-1', 'ob-2']));
  assert.equal(res.number, 'OB-2-2');
  // invoices and bills with no number: INV-000001 onwards, never a number a Tally voucher uses
  const inv = buildVoucherOutput([
    rec('sales', voucher('Sales', '', '20250511', [line('Alder Retail', '-5.00', P), line('Service Income', '5.00')], { partyledgername: 'Alder Retail' })),
    rec('sales', voucher('Sales', 'INV-000001', '20250512', [line('Birch Retail', '-6.00', P), line('Service Income', '6.00')], { partyledgername: 'Birch Retail' })),
    rec('sales', voucher('Sales', 'X'.repeat(60), '20250513', [line('Birch Retail', '-7.00', P), line('Service Income', '7.00')], { partyledgername: 'Birch Retail' })),
  ], ctx());
  assert.deepEqual(inv.recon.map(e => e.number), ['INV-000002', 'INV-000001', 'INV-000003']);
  assert.ok(inv.invoices.rows.find(r => r.row['Invoice Number'] === 'INV-000003').row.Notes.includes('X'.repeat(60)));
  assert.deepEqual(inv.exceptions.filter(e => e.kind === 'document_number_generated').length, 2);
  assert.deepEqual(inv.exceptions.filter(e => e.kind === 'document_number_too_long'), []);
});

test('TALLY-003: a Sales voucher whose party is a vendor of the masters is a Manual Journal (the vendor on Accounts Payable), not an invoice to a non-customer', () => {
  const out = buildVoucherOutput([rec('sales', voucher('Sales', 'VS-1', '20250506', [line('Elm Works', '-40.00', P), line('Service Income', '40.00')], { partyledgername: 'Elm Works' }))], ctx());
  assert.deepEqual([out.recon[0].outcome, out.recon[0].file], ['written', 'journals']);
  assert.deepEqual(out.journals.rows.map(r => [r.row.Account, r.row['Contact Name'], r.row.Debit, r.row.Credit]), [['Accounts Payable', 'Elm Works', '40.00', ''], ['Service Income', '', '', '40.00']]);
});
