// Company 2: a TRADING company with stock (Maharashtra), FY 2025-26. Every name, GSTIN and amount is MADE UP.
//  - stock items with units, HSN codes and GST of 5%, 12% and 18%; opening stock on the items and a Stock-in-Hand ledger
//    carrying the same value (accounts not integrated with inventory, as many traders keep Tally);
//  - purchase and sales invoices with item lines (invoice view: "ledgerentries" + "allinventoryentries"), one supplier
//    and one customer in another state (IGST), one consumer sale, round-off on some invoices;
//  - receipts and payments against bills (bill-wise), a contra and a journal.
// Deliberate problems (each must be flagged with a plain message, and must not hide a voucher):
//  Q1 a registered vendor without GSTIN: "Saffron Hill Distributors" is "Regular" in Tally but has no GSTIN anywhere;
//  Q2 a GST rate that does not match the amount: sale S/005 has an 18% item but Tally charged 6% + 6% (the tax lines were
//     overridden);
//  Q3 a paisa rounding difference: sale S/004 has two 5% lines of 1010.10. Tally rounds the tax of the voucher once
//     (50.505 -> 50.51 per head), Zoho Books rounds each line (25.25 + 25.25 = 50.50 per head): 0.02 apart;
//  Q4 an optional voucher (sale S/006: has lines, Tally does not post it);
//  Q5 an invalid date: sale S/007 is dated 30 September in Tally, but the export writes "20250931" (no such day).
import { company, gstin, dr, cr, P } from './lib.js';

const c = company({ key: 'trading_stock', name: 'Coral Ridge Trading Co', stateCode: '27', pan: 'AAKFC6210H', fy: '2025-26' });
const G = {
  lotus: gstin('27', 'AAFCL4410B'), amber: gstin('24', 'AAGFA7781D'), quartz: gstin('27', 'AADCQ5512G'),
  granary: gstin('27', 'AACFG2290J'), bright: gstin('24', 'AAJCB6634K'),
};
const BANK = 'Harbor Co-operative Bank A/c';

c.gstLedger('Output CGST', 'CGST', 'output').gstLedger('Output SGST', 'SGST/UTGST', 'output').gstLedger('Output IGST', 'IGST', 'output')
  .gstLedger('Input CGST', 'CGST', 'input').gstLedger('Input SGST', 'SGST/UTGST', 'input').gstLedger('Input IGST', 'IGST', 'input');

c.unit('Nos', { full: 'Numbers', uqc: 'NOS-NUMBERS' }).unit('Box', { full: 'Boxes', uqc: 'BOX-BOX' }).unit('Kg', { full: 'Kilograms', uqc: 'KGS-KILOGRAMS', decimals: 3 });
c.stockGroup('Groceries').stockGroup('Housewares');
c.godown('Main Location');
c.item('Basmati Rice 25kg Bag', { unit: 'Nos', hsn: '10063020', rate: 5, group: 'Groceries', openingQty: 40, openingRate: 1800 })
  .item('Toor Dal 30kg Bag', { unit: 'Nos', hsn: '07136000', rate: 5, group: 'Groceries', openingQty: 20, openingRate: 3300 })
  .item('Steel Tumbler Set', { unit: 'Box', hsn: '73239390', rate: 12, group: 'Housewares', openingQty: 50, openingRate: 420 })
  .item('Ceramic Mug Pack', { unit: 'Box', hsn: '69120040', rate: 12, group: 'Housewares', openingQty: 30, openingRate: 350 })
  .item('LED Desk Lamp', { unit: 'Nos', hsn: '94052090', rate: 18, group: 'Housewares', openingQty: 25, openingRate: 900 });
const stockValue = [...c.items.values()].reduce((t, i) => t - i.openingValue, 0); // paise, positive

c.ledger('Partners Capital Account', 'Capital Account', { openingPaise: P(489900) })
  .ledger(BANK, 'Bank Accounts', { dr: 300000, extra: { ifscode: 'HCBK0000777', bankaccholdername: 'Coral Ridge Trading Co' } })
  .ledger('Cash', 'Cash-in-Hand', { dr: 15000 })
  .ledger('Stock-in-Trade', 'Stock-in-Hand', { openingPaise: -stockValue })
  .ledger('Sales Account', 'Sales Accounts').ledger('Purchase Account', 'Purchase Accounts')
  .ledger('Freight Inward', 'Direct Expenses').ledger('Shop Rent', 'Indirect Expenses')
  .ledger('Round Off', 'Indirect Expenses', { extra: { roundingmethod: '\u0004 Normal Rounding', roundinglimit: ' 1' } })
  .ledger('Freight Payable', 'Current Liabilities');

c.party('Lotus Bay Retail', 'customer', { stateCode: '27', gstin: G.lotus, city: 'Pune', pincode: '411001' })
  .party('Amberfield Stores', 'customer', { stateCode: '24', gstin: G.amber, city: 'Surat', pincode: '395003' })
  .party('Nimbus Mart', 'customer', { stateCode: '27', city: 'Nashik', pincode: '422001' }) // a consumer: unregistered
  .party('Quartzline Kitchens', 'customer', { stateCode: '27', gstin: G.quartz, openingBills: [{ name: 'OB-QK-311', date: '20250310', amount: 35400 }] })
  .party('Granary Fields Agro', 'vendor', { stateCode: '27', gstin: G.granary, openingBills: [{ name: 'GFA/0988', date: '20250322', amount: 52500 }] })
  .party('Brightforge Housewares', 'vendor', { stateCode: '24', gstin: G.bright, city: 'Rajkot', pincode: '360001' })
  .party('Saffron Hill Distributors', 'vendor', { stateCode: '27', regType: 'Regular' }); // Q1: registered, no GSTIN

const it = (item, qty, price, extra = {}) => ({ item, qty, price, ...extra });
const sale = (o, lines) => c.sale({ ...o, lines: lines.map(l => ({ ledger: 'Sales Account', ...l })) });
const purchase = (o, lines) => c.purchase({ ...o, lines: lines.map(l => ({ ledger: 'Purchase Account', ...l })) });

// ---------- purchases ----------
purchase({ number: 'P/001', date: '20250410', party: 'Granary Fields Agro', reference: 'GFA/1021' }, [it('Basmati Rice 25kg Bag', 50, 1750), it('Toor Dal 30kg Bag', 30, 3200)]);
purchase({ number: 'P/002', date: '20250418', party: 'Brightforge Housewares', reference: 'BFH/2025/044' },
  [it('Steel Tumbler Set', 100, 400), it('Ceramic Mug Pack', 60, 330), it('LED Desk Lamp', 40, 850)]);
purchase({ number: 'P/003', date: '20250605', party: 'Saffron Hill Distributors', reference: 'SHD-778' }, [it('Toor Dal 30kg Bag', 10, 3250)]); // Q1

// ---------- sales ----------
sale({ number: 'S/001', date: '20250502', party: 'Lotus Bay Retail', roundOff: 'Round Off' }, [it('Basmati Rice 25kg Bag', 30, 2100), it('Steel Tumbler Set', 40, 527.35)]);
sale({ number: 'S/002', date: '20250515', party: 'Amberfield Stores' }, [it('LED Desk Lamp', 20, 1150), it('Ceramic Mug Pack', 30, 450)]);
sale({ number: 'S/003', date: '20250620', party: 'Nimbus Mart', roundOff: 'Round Off' }, [it('Toor Dal 30kg Bag', 5, 3911)]);
sale({ number: 'S/004', date: '20250712', party: 'Quartzline Kitchens' }, [it('Basmati Rice 25kg Bag', 1, 1010.10), it('Toor Dal 30kg Bag', 1, 1010.10)]); // Q3
sale({ number: 'S/005', date: '20250805', party: 'Lotus Bay Retail', tax: { CGST: 720, SGST: 720 } }, [it('LED Desk Lamp', 10, 1200)]); // Q2: 18% item, 12% charged
sale({ number: 'S/006', date: '20250910', party: 'Quartzline Kitchens', status: 'optional' }, [it('Steel Tumbler Set', 10, 520)]); // Q4
sale({ number: 'S/007', date: '20250930', party: 'Lotus Bay Retail', exportPatch: r => { r.date = '20250931'; r.vchstatusdate = '20250931'; r.effectivedate = '20250931'; } },
  [it('Ceramic Mug Pack', 20, 450)]); // Q5
sale({ number: 'S/008', date: '20251015', party: 'Amberfield Stores' }, [it('Basmati Rice 25kg Bag', 20, 2050)]);

// ---------- receipts, payments, contra, journal ----------
const doc = n => c.voucherByNumber(n).meta;
const rupeesOf = p => p / 100;
c.receipt({ number: 'R/001', date: '20250520', party: 'Lotus Bay Retail', bank: BANK, amount: rupeesOf(doc('S/001').partyAmount), bills: [{ name: 'S/001', amount: rupeesOf(doc('S/001').partyAmount) }] });
c.receipt({ number: 'R/002', date: '20250610', party: 'Quartzline Kitchens', bank: BANK, amount: 35400, bills: [{ name: 'OB-QK-311', amount: 35400 }] });
c.receipt({ number: 'R/003', date: '20250701', party: 'Amberfield Stores', bank: BANK, amount: 30000, bills: [{ name: 'S/002', amount: 25000 }] }); // 5,000 on account
c.payment({ number: 'PY/001', date: '20250425', party: 'Granary Fields Agro', bank: BANK, amount: 52500, bills: [{ name: 'GFA/0988', amount: 52500 }] });
c.payment({ number: 'PY/002', date: '20250505', party: 'Brightforge Housewares', bank: BANK, amount: rupeesOf(doc('P/002').partyAmount), bills: [{ name: 'BFH/2025/044', amount: rupeesOf(doc('P/002').partyAmount) }] });
c.payment({ number: 'PY/003', date: '20250430', ledger: 'Shop Rent', bank: BANK, amount: 25000 });
c.contra({ number: 'C/001', date: '20250601', from: 'Cash', to: BANK, amount: 10000 });
c.journal({ number: 'J/001', date: '20250630', lines: [dr('Freight Inward', 2400), cr('Freight Payable', 2400)], narration: 'Freight on April purchases provided for' });

export const profile = { ...c.profile, key: 'trading_stock', n: 2, description: 'Trading company with stock items, units, stock-in-hand opening balance, purchase and sales invoices with items and HSN, GST 5/12/18' };
export const masters = () => c.masters();
export const transactions = () => c.transactions();
export const trialBalance = () => c.trialBalance();
export const builder = c;

const money = p => (p / 100).toFixed(2);
const CLEAN_DOCS = ['S/001', 'S/002', 'S/003', 'S/008', 'P/001', 'P/002'];
export const expect = {
  vouchers: { total: c.vouchers.length, byType: c.stats().byType },
  files: {
    invoices: { clean: ['S/001', 'S/002', 'S/003', 'S/008'], problem: ['S/004', 'S/005', 'S/007'] },
    bills: { clean: ['P/001', 'P/002'], problem: ['P/003'] },
    journals: { clean: ['J/001'], problem: [] },
    other_journals: { clean: ['R/001', 'R/002', 'R/003', 'PY/001', 'PY/002', 'PY/003', 'C/001'], problem: [] },
  },
  notWritten: ['S/006'],
  // an impossible date must never reach a Zoho file as a date
  noInvalidDates: true,
  documents: Object.fromEntries(CLEAN_DOCS.map(n => [n, { file: doc(n).kind === 'sale' ? 'invoices' : 'bills',
    tax: money(doc(n).zohoTax), tallyTax: money(doc(n).tallyTax), partyAmount: money(doc(n).partyAmount), tds: money(doc(n).tds) }])),
  // Zoho's tax of the rounding document: the tool must know it differs from Tally's by 0.02 and say so
  rounding: { number: 'S/004', zohoTax: money(doc('S/004').zohoTax), tallyTax: money(doc('S/004').tallyTax) },
  openingTotals: { debit: money(c.openingTotals().debit), credit: money(c.openingTotals().credit) },
  items: { count: c.items.size, units: ['Nos', 'Box', 'Kg'] },
  // what an accountant chooses in Mapping Studio for this company (a second run checks the files with it)
  accountantChoices: { businessType: 'goods' },
  problems: [
    { id: 'Q1', what: 'a registered vendor without GSTIN', find: { kind: /registered_without_gstin|contact_details_corrected/, name: /Saffron Hill/, message: /GSTIN/ } },
    { id: 'Q2', what: 'a GST rate that does not match the amount', find: { name: /S\/005/, kind: /tax_rate_from_amount|tax_amount_differs/, message: /18%/ } },
    { id: 'Q3', what: 'a paisa rounding difference between Tally and Zoho Books', find: { name: /S\/004/, kind: /zoho_recompute|tax_amount_differs/, message: /0\.02/ } },
    { id: 'Q4', what: 'an optional voucher', find: { kind: /voucher_optional|left_out_optional/, name: /S\/006/ } },
    { id: 'Q5', what: 'an invalid date (31 September)', find: { name: /S\/007/, message: /date/i } },
  ],
  movementFlags: [],
  mayBeRefused: { invoices: ['S/005', 'S/007'], bills: ['P/003'] },
  tbDifferences: [
    { match: /^(Output CGST|Output SGST)$/, reason: 'Q2: Zoho Books works the tax out at the item\'s 18%, Tally charged 12%' },
    { match: /^Accounts Receivable$|^Lotus Bay Retail$/, reason: 'Q2/Q5: the invoice with the wrong tax, or the invoice with the impossible date, is not posted as in Tally' },
    { match: /^Sales Account$/, reason: 'Q5: the income of the invoice with the impossible date, if it is left out' },
  ],
};
