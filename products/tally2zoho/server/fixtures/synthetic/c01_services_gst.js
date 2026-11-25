// Company 1: a SERVICES company with GST in one state (Karnataka), FY 2025-26. Every name, GSTIN and amount is MADE UP.
//  - professional fees billed to customers (SAC on the income ledger), one customer in another state (IGST);
//  - bills for professional charges with TDS under section 194J, receipts and payments with bill-wise allocations,
//    one bank and one cash account, a contra, two journals.
// Deliberate problems (each must be flagged with a plain message, and must not hide a voucher):
//  P1 duplicate party names: "Marigold Foods Pvt Ltd" and "MARIGOLD FOODS  PVT LTD" (capitals, two spaces), same GSTIN;
//  P2 a sale to a party that is not in the masters export ("Zephyr Analytics": in Tally's trial balance, missing from
//     All Masters);
//  P3 a TDS ledger with no Zoho TDS tax: "TDS Deducted - Others" has Tally's nature of payment "Any" and no section;
//  P4 a cancelled voucher (sale S/25-26/006: Tally keeps the number, removes the lines).
import { company, gstin, cr, dr, ANY } from './lib.js';

const c = company({ key: 'services_gst', name: 'Bluefin Consulting LLP', stateCode: '29', pan: 'AAKFB4821K', fy: '2025-26' });
const G = {
  aster: gstin('29', 'AADFA5307M'), harbor: gstin('27', 'AABCH6120Q'), marigold: gstin('29', 'AAGCM7741P'), zephyr: gstin('29', 'AAOFZ2210R'),
  tide: gstin('29', 'AAEFT3391L'), pebble: gstin('29', 'ABJPP4418D'), quillon: gstin('29', 'AACCQ9004E'),
};
const BANK = 'Northwind Bank Current A/c';

// the output ledgers carry the GST payable of March as opening balance (credit)
c.gstLedger('Output CGST', 'CGST', 'output', { cr: 4500 }).gstLedger('Output SGST', 'SGST/UTGST', 'output', { cr: 4500 }).gstLedger('Output IGST', 'IGST', 'output')
  .gstLedger('Input CGST', 'CGST', 'input').gstLedger('Input SGST', 'SGST/UTGST', 'input').gstLedger('Input IGST', 'IGST', 'input');

c.ledger('Partners Capital Account', 'Capital Account', { cr: 474800 })
  .ledger('Profit & Loss A/c', null, { cr: 150000, extra: { metadata: { type: 'Ledger', name: 'Profit & Loss A/c', reservedname: 'Profit & Loss A/c' } } })
  .ledger(BANK, 'Bank Accounts', { dr: 420000, extra: { ifscode: 'NWBK0001234', bankaccholdername: 'Bluefin Consulting LLP' } })
  .ledger('Cash', 'Cash-in-Hand', { dr: 12000 })
  .ledger('Security Deposit - Office', 'Deposits (Asset)', { dr: 100000 })
  .ledger('Expenses Payable', 'Current Liabilities', { cr: 25000 })
  .tdsLedger('TDS on Professional Fees', '194J', { cr: 3000 })
  .tdsLedger('TDS Deducted - Others', ANY) // P3: no nature of payment, no section anywhere
  .gstServiceLedger('Consultancy Fees', 'Sales Accounts', { sac: '998311', rate: 18 })
  .ledger('Professional Charges', 'Indirect Expenses').ledger('Office Rent', 'Indirect Expenses').ledger('Printing & Stationery', 'Indirect Expenses')
  .ledger('Software Subscription', 'Indirect Expenses').ledger('Bank Charges', 'Indirect Expenses').ledger('Salaries', 'Indirect Expenses');

c.party('Aster Lane Traders', 'customer', { stateCode: '29', gstin: G.aster, openingBills: [{ name: 'OB-2425-091', date: '20250305', amount: 118000 }] })
  .party('Harborline Exports Pvt Ltd', 'customer', { stateCode: '27', gstin: G.harbor, city: 'Pune', pincode: '411014' })
  .party('Marigold Foods Pvt Ltd', 'customer', { stateCode: '29', gstin: G.marigold, openingBills: [{ name: 'OB-2425-104', date: '20250320', amount: 23600 }] })
  .party('MARIGOLD FOODS  PVT LTD', 'customer', { stateCode: '29', gstin: G.marigold }) // P1
  .party('Zephyr Analytics', 'customer', { stateCode: '29', gstin: G.zephyr, inMasters: false }) // P2
  .party('Tidewater Legal Associates', 'vendor', { stateCode: '29', gstin: G.tide })
  .party('Pebble Print Works', 'vendor', { stateCode: '29', gstin: G.pebble, openingBills: [{ name: 'PPW/88', date: '20250328', amount: 11800 }] })
  .party('Quillon IT Services', 'vendor', { stateCode: '29', gstin: G.quillon });

// ---------- sales ----------
const fees = (amount) => [{ ledger: 'Consultancy Fees', amount, rate: 18, hsn: '998311' }];
c.sale({ number: 'S/25-26/001', date: '20250412', party: 'Aster Lane Traders', lines: fees(100000), narration: 'Advisory retainer, April' });
c.sale({ number: 'S/25-26/002', date: '20250508', party: 'Harborline Exports Pvt Ltd', lines: fees(50000) });
c.sale({ number: 'S/25-26/003', date: '20250615', party: 'Marigold Foods Pvt Ltd', lines: fees(20000) });
c.sale({ number: 'S/25-26/004', date: '20250703', party: 'MARIGOLD FOODS  PVT LTD', lines: fees(10000) });
c.sale({ number: 'S/25-26/005', date: '20250720', party: 'Zephyr Analytics', lines: fees(15000) });
c.sale({ number: 'S/25-26/006', date: '20250801', party: 'Aster Lane Traders', lines: fees(40000), status: 'cancelled' });

// ---------- purchases ----------
c.purchase({ number: 'P/001', date: '20250425', party: 'Tidewater Legal Associates', reference: 'TLA/2025/117', lines: [{ ledger: 'Professional Charges', amount: 50000, rate: 18, hsn: '998212' }],
  tds: { ledger: 'TDS on Professional Fees', amount: 5000 } });
c.purchase({ number: 'P/002', date: '20250514', party: 'Pebble Print Works', reference: 'PPW/112', lines: [{ ledger: 'Printing & Stationery', amount: 10000, rate: 18 }] });
c.purchase({ number: 'P/003', date: '20250630', party: 'Quillon IT Services', reference: 'QIT-5531', lines: [{ ledger: 'Software Subscription', amount: 20000, rate: 18 }],
  tds: { ledger: 'TDS Deducted - Others', amount: 400 } }); // P3

// ---------- receipts, payments, contra ----------
c.receipt({ number: 'R/001', date: '20250430', party: 'Aster Lane Traders', bank: BANK, amount: 118000, bills: [{ name: 'S/25-26/001', amount: 118000 }] });
c.receipt({ number: 'R/002', date: '20250520', party: 'Aster Lane Traders', bank: BANK, amount: 50000, bills: [{ name: 'OB-2425-091', amount: 50000 }] });
c.receipt({ number: 'R/003', date: '20250610', party: 'Harborline Exports Pvt Ltd', bank: BANK, amount: 59000, bills: [{ name: 'S/25-26/002', amount: 59000 }] });
c.receipt({ number: 'R/004', date: '20250725', party: 'Marigold Foods Pvt Ltd', bank: BANK, amount: 23600, bills: [{ name: 'OB-2425-104', amount: 23600 }] });
c.payment({ number: 'PY/001', date: '20250505', party: 'Tidewater Legal Associates', bank: BANK, amount: 54000, bills: [{ name: 'TLA/2025/117', amount: 54000 }] });
c.payment({ number: 'PY/002', date: '20250531', ledger: 'Office Rent', bank: BANK, amount: 30000 });
c.payment({ number: 'PY/003', date: '20250605', party: 'Pebble Print Works', bank: BANK, amount: 11800, bills: [{ name: 'PPW/88', amount: 11800 }] });
c.payment({ number: 'PY/004', date: '20250407', ledger: 'TDS on Professional Fees', bank: BANK, amount: 3000, narration: 'TDS of March deposited' });
c.payment({ number: 'PY/005', date: '20250612', ledger: 'Salaries', bank: BANK, amount: 80000 });
c.contra({ number: 'C/001', date: '20250601', from: BANK, to: 'Cash', amount: 10000 });

// ---------- journals ----------
c.journal({ number: 'J/001', date: '20250930', lines: [dr('Professional Charges', 8000), cr('Expenses Payable', 8000)], narration: 'Audit fee provided for' });
c.journal({ number: 'J/002', date: '20251031', lines: [dr('Bank Charges', 590), cr(BANK, 590)] });

export const profile = { ...c.profile, key: 'services_gst', n: 1, description: 'Service company with GST (one state), professional fees with TDS 194J on bills, receipts with bill-wise allocations, a bank and a cash account' };
export const masters = () => c.masters();
export const transactions = () => c.transactions();
export const trialBalance = () => c.trialBalance();
export const builder = c;

const doc = n => c.voucherByNumber(n).meta;
const money = p => (p / 100).toFixed(2);
// What a correct migration must produce.
export const expect = {
  vouchers: { total: c.vouchers.length, byType: c.stats().byType },
  // written to each Zoho file: the clean vouchers exactly, plus at most the problem vouchers listed (written but marked
  // "will be refused", or kept out of the file with a reason)
  files: {
    invoices: { clean: ['S/25-26/001', 'S/25-26/002', 'S/25-26/003', 'S/25-26/004'], problem: ['S/25-26/005'] },
    bills: { clean: ['P/001', 'P/002'], problem: ['P/003'] },
    journals: { clean: ['J/001', 'J/002'], problem: [] },
    other_journals: { clean: ['R/001', 'R/002', 'R/003', 'R/004', 'PY/001', 'PY/002', 'PY/003', 'PY/004', 'PY/005', 'C/001'], problem: [] },
  },
  // never written to any file
  notWritten: ['S/25-26/006'],
  // Zoho's tax (each part of each line rounded, as Zoho works it out) and what the party owes, per document
  documents: Object.fromEntries(['S/25-26/001', 'S/25-26/002', 'S/25-26/003', 'S/25-26/004', 'P/001', 'P/002'].map(n => [n, { file: doc(n).kind === 'sale' ? 'invoices' : 'bills',
    tax: money(doc(n).zohoTax), tallyTax: money(doc(n).tallyTax), partyAmount: money(doc(n).partyAmount), tds: money(doc(n).tds) }])),
  openingTotals: { debit: money(c.openingTotals().debit), credit: money(c.openingTotals().credit) },
  problems: [
    { id: 'P1', what: 'duplicate party names (capitals, spacing)', find: { kind: /possible_duplicate/, name: /marigold/i } },
    { id: 'P2', what: 'a sale names a party that is not in the masters', find: { kind: /party_missing|ledger_missing/, name: /Zephyr Analytics/ } },
    { id: 'P3', what: 'a TDS ledger with no Zoho TDS tax', find: { kind: /tds_not_mapped/, name: /TDS Deducted - Others/, message: /TDS/ } },
    { id: 'P4', what: 'a cancelled voucher', find: { kind: /voucher_cancelled/, name: /S\/25-26\/006/ } },
  ],
  // rows Zoho may refuse because of a problem record (file -> record identifiers); every other row must be accepted
  mayBeRefused: { invoices: ['S/25-26/005'], bills: ['P/003'] },
  // Trial Balance lines the movement check (Tally's report against the vouchers) may flag, each with the reason
  movementFlags: [{ match: /^(Current Assets|Sundry Debtors)$/, reason: 'P2: the customer missing from the masters is in the group in Tally, not in the masters' }],
  // accounts or contacts allowed to differ between the predicted Zoho trial balance and Tally, each with the reason
  tbDifferences: [
    { match: /Zephyr Analytics/i, reason: 'P2: the customer is not in the masters, so its invoice cannot reach Zoho Books' },
    { match: /^Accounts Receivable$/, reason: 'P2: the invoice of the customer missing from the masters' },
    { match: /^Consultancy Fees$/, reason: 'P2: the income of the invoice of the customer missing from the masters' },
    { match: /^Output (CGST|SGST)$/, reason: 'P2: the GST of the invoice of the customer missing from the masters' },
  ],
};
