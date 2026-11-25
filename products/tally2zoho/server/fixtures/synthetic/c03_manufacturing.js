// Company 3: a MANUFACTURING company (Tamil Nadu), FY 2025-26. Every name, GSTIN and amount is MADE UP.
//  - raw materials (steel sheet in kilograms, primer) and finished goods (racks, cabinets), three godowns (the Zoho files
//    ignore godowns: no warehouse is written), opening stock on the items and a Stock-in-Hand ledger with the same value;
//  - purchases of raw material (one supplier in another state: IGST), sales of finished goods (one customer in another
//    state), receipts and payments against bills, wages provided for and paid, interest, a year-end depreciation journal;
//  - stock journals that consume raw material and produce finished goods (Tally posts nothing to ledgers for them).
// Deliberate problems (each must be flagged with a plain message, and must not hide a voucher):
//  M1 an unsupported voucher type: two Stock Journals (no Zoho file; they post nothing to ledgers);
//  M2 a date outside the financial year: sale S/004 is dated 5 April 2026 (after the year; not in Tally's trial balance of
//     the year);
//  M3 an unbalanced voucher: journal J/004 balances in Tally, but its export writes the credit line as 18050.00
//     instead of 18500.00;
//  M4 an unrecognised ledger: journal J/003 credits "Factory Overheads Suspense", which is in Tally's trial balance but
//     missing from the All Masters export.
import { company, gstin, dr, cr } from './lib.js';

const c = company({ key: 'manufacturing', name: 'Kestrel Fabrication Works Pvt Ltd', stateCode: '33', pan: 'AAHCK3307N', fy: '2025-26' });
const G = { peregrine: gstin('33', 'AAECP8821F'), silver: gstin('29', 'AAKFS1904C'), orchid: gstin('33', 'AABTO6650R'), ironbark: gstin('33', 'AADCI4471M'), cobalt: gstin('27', 'AAJFC2958P') };
const BANK = 'Tidepool Bank Current A/c';

c.gstLedger('Output CGST', 'CGST', 'output').gstLedger('Output SGST', 'SGST/UTGST', 'output').gstLedger('Output IGST', 'IGST', 'output')
  .gstLedger('Input CGST', 'CGST', 'input').gstLedger('Input SGST', 'SGST/UTGST', 'input').gstLedger('Input IGST', 'IGST', 'input');

c.unit('Kg', { full: 'Kilograms', uqc: 'KGS-KILOGRAMS', decimals: 3 }).unit('Nos', { full: 'Numbers', uqc: 'NOS-NUMBERS' });
c.stockGroup('Raw Materials').stockGroup('Finished Goods');
c.godown('Main Location').godown('Factory Floor').godown('Finished Goods Store');
c.item('MS Sheet 2mm', { unit: 'Kg', hsn: '72085110', rate: 18, group: 'Raw Materials', openingQty: 2000, openingRate: 68 })
  .item('Paint Primer 20L', { unit: 'Nos', hsn: '32091090', rate: 18, group: 'Raw Materials', openingQty: 12, openingRate: 2400 })
  .item('Steel Storage Rack', { unit: 'Nos', hsn: '94032090', rate: 18, group: 'Finished Goods', openingQty: 15, openingRate: 5200 })
  .item('Tool Cabinet', { unit: 'Nos', hsn: '94032010', rate: 18, group: 'Finished Goods', openingQty: 6, openingRate: 7800 });
const stockValue = [...c.items.values()].reduce((t, i) => t - i.openingValue, 0); // paise, positive

c.ledger('Share Capital', 'Capital Account', { cr: 500000 })
  .ledger('General Reserve', 'Reserves & Surplus', { cr: 39400 })
  .ledger('Term Loan - Northwind Bank', 'Secured Loans', { cr: 400000 })
  .ledger('Plant & Machinery', 'Fixed Assets', { dr: 450000 })
  .ledger(BANK, 'Bank Accounts', { dr: 180000, extra: { ifscode: 'TDPL0004410', bankaccholdername: 'Kestrel Fabrication Works Pvt Ltd' } })
  .ledger('Cash', 'Cash-in-Hand', { dr: 8000 })
  .ledger('Inventory - Raw & Finished', 'Stock-in-Hand', { openingPaise: -stockValue })
  .ledger('Sales - Finished Goods', 'Sales Accounts').ledger('Purchase - Raw Material', 'Purchase Accounts')
  .ledger('Factory Wages', 'Direct Expenses').ledger('Power & Fuel', 'Direct Expenses')
  .ledger('Depreciation', 'Indirect Expenses').ledger('Interest on Term Loan', 'Indirect Expenses')
  .ledger('Wages Payable', 'Current Liabilities')
  .ledger('Factory Overheads Suspense', 'Suspense A/c', { inMasters: false }); // M4: in Tally, missing from the masters export

c.party('Peregrine Warehousing Pvt Ltd', 'customer', { stateCode: '33', gstin: G.peregrine, city: 'Coimbatore', pincode: '641018' })
  .party('Silverline Logistics', 'customer', { stateCode: '29', gstin: G.silver, city: 'Bengaluru', pincode: '560058', openingBills: [{ name: 'KFW/2425/118', date: '20250315', amount: 94400 }] })
  .party('Orchid Valley Hospitals', 'customer', { stateCode: '33', gstin: G.orchid, city: 'Madurai', pincode: '625001' })
  .party('Ironbark Steels Pvt Ltd', 'vendor', { stateCode: '33', gstin: G.ironbark, city: 'Chennai', pincode: '600032', openingBills: [{ name: 'IB/2425/310', date: '20250328', amount: 82600 }] })
  .party('Cobalt Coatings', 'vendor', { stateCode: '27', gstin: G.cobalt, city: 'Thane', pincode: '400601' });

const it = (item, qty, price, godown, extra = {}) => ({ item, qty, price, godown, ...extra });
const sale = (o, lines) => c.sale({ ...o, lines: lines.map(l => ({ ledger: 'Sales - Finished Goods', ...l })) });
const purchase = (o, lines) => c.purchase({ ...o, lines: lines.map(l => ({ ledger: 'Purchase - Raw Material', ...l })) });

// ---------- purchases of raw material ----------
purchase({ number: 'P/001', date: '20250408', party: 'Ironbark Steels Pvt Ltd', reference: 'IB/2526/014' }, [it('MS Sheet 2mm', 3000, 66, 'Factory Floor')]);
purchase({ number: 'P/002', date: '20250422', party: 'Cobalt Coatings', reference: 'CC-25-0371' }, [it('Paint Primer 20L', 20, 2350, 'Factory Floor')]);

// ---------- production: stock journals (M1) ----------
c.stockJournal({ number: 'SJ/001', date: '20250425', narration: 'Racks made in April',
  consume: [{ item: 'MS Sheet 2mm', qty: 1200, price: 68, godown: 'Factory Floor' }, { item: 'Paint Primer 20L', qty: 6, price: 2400, godown: 'Factory Floor' }],
  produce: [{ item: 'Steel Storage Rack', qty: 20, price: 4800, godown: 'Finished Goods Store' }] });
c.stockJournal({ number: 'SJ/002', date: '20250610', narration: 'Cabinets made in June',
  consume: [{ item: 'MS Sheet 2mm', qty: 800, price: 66, godown: 'Factory Floor' }, { item: 'Paint Primer 20L', qty: 4, price: 2350, godown: 'Factory Floor' }],
  produce: [{ item: 'Tool Cabinet', qty: 8, price: 7775, godown: 'Finished Goods Store' }] });

// ---------- sales of finished goods ----------
sale({ number: 'S/001', date: '20250505', party: 'Peregrine Warehousing Pvt Ltd' }, [it('Steel Storage Rack', 12, 7500, 'Finished Goods Store')]);
sale({ number: 'S/002', date: '20250520', party: 'Silverline Logistics' }, [it('Tool Cabinet', 5, 11000, 'Finished Goods Store')]);
sale({ number: 'S/003', date: '20250715', party: 'Orchid Valley Hospitals' }, [it('Steel Storage Rack', 6, 7400, 'Finished Goods Store'), it('Tool Cabinet', 2, 10800, 'Main Location')]);
sale({ number: 'S/004', date: '20260405', party: 'Peregrine Warehousing Pvt Ltd' }, [it('Steel Storage Rack', 4, 7500, 'Finished Goods Store')]); // M2: after the year

// ---------- money ----------
const doc = n => c.voucherByNumber(n).meta;
const rupeesOf = p => p / 100;
c.receipt({ number: 'R/001', date: '20250605', party: 'Peregrine Warehousing Pvt Ltd', bank: BANK, amount: rupeesOf(doc('S/001').partyAmount), bills: [{ name: 'S/001', amount: rupeesOf(doc('S/001').partyAmount) }] });
c.receipt({ number: 'R/002', date: '20250620', party: 'Silverline Logistics', bank: BANK, amount: 94400, bills: [{ name: 'KFW/2425/118', amount: 94400 }] });
c.payment({ number: 'PY/001', date: '20250430', party: 'Ironbark Steels Pvt Ltd', bank: BANK, amount: 82600, bills: [{ name: 'IB/2425/310', amount: 82600 }] });
c.payment({ number: 'PY/002', date: '20250707', ledger: 'Wages Payable', bank: BANK, amount: 60000, narration: 'Wages of June paid' });
c.payment({ number: 'PY/003', date: '20250715', ledger: 'Power & Fuel', bank: BANK, amount: 9440 });
c.contra({ number: 'C/001', date: '20250502', from: BANK, to: 'Cash', amount: 15000 });

// ---------- journals ----------
c.journal({ number: 'J/001', date: '20250630', lines: [dr('Factory Wages', 60000), cr('Wages Payable', 60000)], narration: 'Wages of June provided for' });
c.journal({ number: 'J/002', date: '20260331', lines: [dr('Depreciation', 45000), cr('Plant & Machinery', 45000)], narration: 'Depreciation for the year on Plant & Machinery' });
c.journal({ number: 'J/003', date: '20250930', lines: [dr('Power & Fuel', 12000), cr('Factory Overheads Suspense', 12000)], narration: 'Power cost cleared from suspense' }); // M4
c.journal({ number: 'J/004', date: '20251130', lines: [dr('Interest on Term Loan', 18500), cr('Term Loan - Northwind Bank', 18500)], narration: 'Interest charged by the bank',
  exportPatch: r => { r.allledgerentries[1].amount = '18050.00'; } }); // M3: the export garbles one amount

export const profile = { ...c.profile, key: 'manufacturing', n: 3, description: 'Manufacturing company with raw material and finished goods items, multiple godowns ignored, stock journals (unsupported type), purchase/sales, depreciation journal' };
export const masters = () => c.masters();
export const transactions = () => c.transactions();
export const trialBalance = () => c.trialBalance();
export const builder = c;

const money = p => (p / 100).toFixed(2);
const CLEAN_DOCS = ['S/001', 'S/002', 'S/003', 'P/001', 'P/002'];
export const expect = {
  vouchers: { total: c.vouchers.length, byType: c.stats().byType },
  files: {
    invoices: { clean: ['S/001', 'S/002', 'S/003'], problem: [] },
    bills: { clean: ['P/001', 'P/002'], problem: [] },
    journals: { clean: ['J/001', 'J/002'], problem: ['J/003'] },
    other_journals: { clean: ['R/001', 'R/002', 'PY/001', 'PY/002', 'PY/003', 'C/001'], problem: [] },
  },
  // never written to any file: the stock journals (no Zoho file), the sale after the year, the unbalanced journal
  notWritten: ['SJ/001', 'SJ/002', 'S/004', 'J/004'],
  // kept with no Zoho file (counted, not lost)
  keptWithoutFile: ['SJ/001', 'SJ/002'],
  documents: Object.fromEntries(CLEAN_DOCS.map(n => [n, { file: doc(n).kind === 'sale' ? 'invoices' : 'bills',
    tax: money(doc(n).zohoTax), tallyTax: money(doc(n).tallyTax), partyAmount: money(doc(n).partyAmount), tds: money(doc(n).tds) }])),
  openingTotals: { debit: money(c.openingTotals().debit), credit: money(c.openingTotals().credit) },
  items: { count: c.items.size, units: ['Kg', 'Nos'], noWarehouse: true },
  // what an accountant chooses in Mapping Studio for this company (a second run checks the files with it)
  accountantChoices: { businessType: 'goods' },
  problems: [
    { id: 'M1', what: 'an unsupported voucher type (Stock Journal)', find: { kind: /voucher_type_no_dataset|voucher_type_not_resolved/, name: /Stock Journal/ } },
    { id: 'M2', what: 'a date outside the financial year', find: { kind: /left_out_outside_year/, name: /S\/004/ } },
    { id: 'M3', what: 'an unbalanced voucher', find: { name: /J\/004/, message: /balanc|debits and credits differ/i } },
    { id: 'M4', what: 'an unrecognised ledger', find: { kind: /ledger_missing/, name: /Factory Overheads Suspense/ } },
  ],
  movementFlags: [
    { match: /^(Loans \(Liability\)|Secured Loans|Term Loan - Northwind Bank)$/, reason: 'M3: the export of the journal writes 18050.00 where Tally holds 18500.00' },
    { match: /^Suspense A\/c$/, reason: 'M4: the ledger under it is missing from the masters' },
  ],
  mayBeRefused: { journals: ['J/003'] },
  tbDifferences: [
    { match: /^Factory Overheads Suspense$/, reason: 'M4: the ledger is not in the masters, so it is not an account of the files' },
    { match: /^Power & Fuel$/, reason: 'M4: the journal crediting the ledger missing from the masters is refused by Zoho Books (or left out)' },
    { match: /^Interest on Term Loan$|^Term Loan - Northwind Bank$/, reason: 'M3: the unbalanced journal is left out of the files' },
  ],
};
