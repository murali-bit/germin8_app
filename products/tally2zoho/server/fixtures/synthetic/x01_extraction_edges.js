// Edge-case company X1 (S4, extraction and completeness): a small trader WITHOUT GST registration (Kerala), FY 2025-26,
// whose Tally export carries the shapes that must never lose or double a voucher. Every name and amount is MADE UP.
// It is not one of the ten companies (its file name is not cNN_*): companies.test.js runs it in its own section, because
// two of its vouchers deliberately share an identity or a number.
//  E1  the same voucher twice in the All Transactions file (the same Tally guid): written once, the copy left out;
//  E2  a Payroll voucher (salary debited, cash credited) and a voucher of a custom type that the masters do not list
//      ("Site Expense Voucher"): both post in Tally, so both are Manual Journals; a Memorandum voucher has no file;
//  E3  a counter sale whose party is the Cash ledger, and a sales return entered as a Sales voucher (customer credited):
//      neither can be an invoice, both are Manual Journals posting what Tally posted;
//  E4  two journals with no voucher number, and receipts numbered "RV/2025-26/000001" (with RCT- over 16 characters),
//      one number used twice: every journal gets a unique, non-empty number of at most 16 characters;
//  E5  an item list written as a single object, and one with an empty (null) item: read safely, flagged;
//  E6  a cancelled, an optional, a void and an on-hold voucher.
import { company, dr, cr, P } from './lib.js';

const BANK = 'Backwater Co-operative Bank A/c';
const NO_GST_VOUCHER_FIELDS = ['gstregistration', 'cmpgstin', 'cmpgstregistrationtype', 'cmpgststate', 'gstregistrationtype', 'partygstin', 'placeofsupply', 'gst'];
const NO_GST_PARTY_FIELDS = ['gstregistrationtype', 'ledgstregdetails', 'partygstin', 'priorstatename'];
const clone = o => JSON.parse(JSON.stringify(o));

const c = company({ key: 'extraction_edges', name: 'Palmgrove Crafts and Supplies', stateCode: '32', gstin: '', fy: '2025-26' });
c.voucherType('Payroll'); // Tally's own Payroll type (the masters list it); "Site Expense Voucher" is in no Voucher Type record
c.unit('Nos', { full: 'Numbers' });
c.item('Coir Doormat', { unit: 'Nos', hsn: '57021000', rate: 0, openingQty: 0, openingRate: 0 });

c.ledger('Proprietor Capital', 'Capital Account', { cr: 200000 })
  .ledger(BANK, 'Bank Accounts', { dr: 150000 })
  .ledger('Cash', 'Cash-in-Hand', { dr: 50000 })
  .ledger('Sales - Crafts', 'Sales Accounts').ledger('Purchases - Crafts', 'Purchase Accounts')
  .ledger('Salaries', 'Indirect Expenses').ledger('Site Expenses', 'Indirect Expenses').ledger('Shop Rent', 'Indirect Expenses')
  .ledger('Loan from Director', 'Loans (Liability)');
c.party('Lagoon View Resorts', 'customer', { stateCode: '32', city: 'Alappuzha', pincode: '688001' })
  .party('Spice Route Stores', 'customer', { stateCode: '32', city: 'Kochi', pincode: '682001' })
  .party('Coastal Fibre Works', 'vendor', { stateCode: '32', city: 'Kollam', pincode: '691001' });

const sale = (number, date, party, amount, o = {}) => c.voucher('Sales', number, date,
  [{ ledger: party, amount: -P(amount), party: true, bills: [{ name: number, type: 'New Ref', amount: -P(amount) }] }, { ledger: 'Sales - Crafts', amount: P(amount) }],
  { view: 'invoice', party, ...o, meta: { kind: 'sale', party, ...(o.meta || {}) } });
// an item sale: the item line's accounting allocation carries the sales ledger
const itemSale = (number, date, party, qty, price, o = {}) => {
  const amount = Math.round(qty * P(price));
  return c.voucher('Sales', number, date, [{ ledger: party, amount: -amount, party: true, bills: [{ name: number, type: 'New Ref', amount: -amount }] }],
    { view: 'invoice', party, inventory: [{ item: 'Coir Doormat', qty, price, amount, ledger: 'Sales - Crafts' }], ...o, meta: { kind: 'sale', party } });
};

// ---------- clean vouchers ----------
const s1 = sale('S/001', '20250410', 'Lagoon View Resorts', 12000);
c.voucher('Purchase', 'P/001', '20250412', [{ ledger: 'Coastal Fibre Works', amount: P(8000), party: true, bills: [{ name: 'CFW-77', type: 'New Ref', amount: P(8000) }] }, { ledger: 'Purchases - Crafts', amount: -P(8000) }],
  { view: 'invoice', party: 'Coastal Fibre Works', reference: 'CFW-77', meta: { kind: 'purchase' } });
// E5: the item list as a single object; an item list with an empty item
itemSale('S/002', '20250415', 'Spice Route Stores', 10, 450, { exportPatch: r => { r.allinventoryentries = r.allinventoryentries[0]; } });
itemSale('S/003', '20250418', 'Lagoon View Resorts', 4, 450, { exportPatch: r => { r.allinventoryentries = [null, ...r.allinventoryentries]; } });
// E3: a counter sale with the Cash ledger as its party; a sales return entered as a Sales voucher
c.voucher('Sales', 'S/004', '20250420', [{ ledger: 'Cash', amount: -P(2500) }, { ledger: 'Sales - Crafts', amount: P(2500) }], { view: 'invoice', party: 'Cash', meta: { kind: 'counter_sale' } });
c.voucher('Sales', 'S/005', '20250425', [{ ledger: 'Spice Route Stores', amount: P(900), party: true, bills: [{ name: 'S/002', type: 'Agst Ref', amount: P(900) }] }, { ledger: 'Sales - Crafts', amount: -P(900) }],
  { view: 'invoice', party: 'Spice Route Stores', narration: 'Goods returned against S/002', meta: { kind: 'sales_return' } });
// E6: cancelled and optional sales
sale('S/006', '20250428', 'Lagoon View Resorts', 3000, { status: 'cancelled' });
sale('S/007', '20250429', 'Spice Route Stores', 3100, { status: 'optional' });
// E4: two journals with no number; receipts with long numbers, one number used twice
c.journal({ number: '', date: '20250430', lines: [dr('Shop Rent', 6000), cr(BANK, 6000)], narration: 'Shop rent, April (no number in Tally)' });
c.journal({ number: '', date: '20250531', lines: [dr('Shop Rent', 6000), cr(BANK, 6000)], narration: 'Shop rent, May (no number in Tally)' });
c.receipt({ number: 'RV/2025-26/000001', date: '20250502', party: 'Lagoon View Resorts', bank: BANK, amount: 12000, bills: [{ name: 'S/001', amount: 12000 }] });
c.receipt({ number: 'RV/2025-26/000002', date: '20250505', party: 'Spice Route Stores', bank: BANK, amount: 3600, bills: [{ name: 'S/002', amount: 3600 }] });
c.receipt({ number: 'RV/2025-26/000001', date: '20250506', party: 'Lagoon View Resorts', bank: BANK, amount: 1800, bills: [{ name: 'S/003', amount: 1800 }] });
c.payment({ number: 'PV/2025-26/000001', date: '20250510', party: 'Coastal Fibre Works', bank: BANK, amount: 8000, bills: [{ name: 'CFW-77', amount: 8000 }] });
// E2: Payroll (a type of Tally's own with no Zoho dataset), a custom type the masters do not list, a Memorandum voucher
c.voucher('Payroll', 'PR/001', '20250531', [{ ledger: 'Salaries', amount: -P(15000) }, { ledger: 'Cash', amount: P(15000) }], { narration: 'Salaries, May', meta: { kind: 'payroll' } });
c.voucher('Site Expense Voucher', 'SE/001', '20250603', [{ ledger: 'Site Expenses', amount: -P(1250) }, { ledger: 'Cash', amount: P(1250) }], { meta: { kind: 'custom_type' } });
c.voucher('Memorandum', 'M/001', '20250605', [{ ledger: 'Site Expenses', amount: -P(400) }, { ledger: 'Cash', amount: P(400) }], { narration: 'Estimate only' });
// E6: a void journal (Tally does not post it) and a journal on hold (its effect is not confirmed: written and flagged)
const vd = c.journal({ number: 'J/VOID', date: '20250610', lines: [dr('Shop Rent', 700), cr('Cash', 700)] });
vd.record.isvoid = true; vd.exported.isvoid = true; vd.meta.posts = false; vd.meta.status = 'void';
const oh = c.journal({ number: 'J/HOLD', date: '20250612', lines: [dr('Cash', 5000), cr('Loan from Director', 5000)], narration: 'Loan received in cash' });
oh.record.isonhold = true; oh.exported.isonhold = true;

for (const r of c.masterRecords) if (r.metadata?.type === 'Ledger') { for (const f of NO_GST_PARTY_FIELDS) delete r[f]; r.isgstapplicable = false; }
for (const v of c.vouchers) for (const r of [v.record, v.exported]) { for (const f of NO_GST_VOUCHER_FIELDS) delete r[f]; r.vchgststatusisapplicable = false; r.vchgststatusisincluded = false; }
// E1: the first sale exported twice (same guid). Tally holds it once, so the copy posts nothing.
c.vouchers.push({ record: clone(s1.record), exported: clone(s1.exported), meta: { ...s1.meta, posts: false, duplicateOf: 'S/001' } });

export const profile = { ...c.profile, key: 'extraction_edges', n: 'X1', description: 'Edge cases of the Tally extraction: a voucher exported twice, Payroll and an untraceable custom type, sales that cannot be invoices, vouchers without a usable number, odd item lists, cancelled / optional / void / on-hold vouchers' };
export const masters = () => c.masters();
export const transactions = () => c.transactions();
export const trialBalance = () => c.trialBalance();
export const builder = c;
export const expect = {
  vouchers: { total: c.vouchers.length },
  invoices: ['S/001', 'S/002', 'S/003'],
  bills: ['P/001'],
  // by Tally voucher number; '' is the number of the two journals without one
  journals: { 'S/004': 'sales_written_as_journal', 'S/005': 'sales_written_as_journal', 'PR/001': 'other_type_written_as_journal', 'SE/001': 'other_type_written_as_journal', 'J/HOLD': 'voucher_status_unverified' },
  leftOut: { 'S/006': 'cancelled', 'S/007': 'optional', 'J/VOID': 'void' },
  noFile: ['M/001'],
};
