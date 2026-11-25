// Company 4: an EXPORTER of software services (Gujarat), FY 2025-26. Every name, GSTIN and amount is MADE UP.
//  - exports of services under LUT (zero-rated, no GST charged): to an overseas customer kept in US dollars (a ledger
//    in "$", invoices in dollars at the rate of the day: foreign-currency invoices) and to an overseas customer kept in
//    rupees; one domestic customer in the same state (CGST + SGST);
//  - bank realisation of the dollar invoices at another rate (receipts), and the forex gain / loss journals that clear
//    the rupee difference left on the invoice;
//  - bills for cloud hosting and rent (CGST + SGST), payments against them, salaries, a contra.
// Deliberate problems (each must be flagged with a plain message, and must not hide a voucher):
//  X1 a voucher naming a party that is not in the masters: export invoice E/004 to "Tamarind Labs LLC" (in Tally's trial
//     balance, missing from All Masters);
//  X2 an optional voucher: proforma invoice E/005 in dollars, kept optional in Tally (not posted);
//  X3 an unsupported voucher type: a Memorandum voucher (M/001, a travel advance noted but not posted);
//  X4 an invalid date: payment PY/004 is dated 28 February 2026 in Tally, but the export writes "20260229" (2026 is not
//     a leap year).
// ASSUMED SHAPE (see lib.js forexText): a line on a ledger kept in dollars carries Tally's foreign-currency amount text,
// "-$5000.00 @ ₹85.40/$ = -₹427000.00". The real exports in the project have no foreign-currency ledger to confirm it.
import { company, gstin, cr, dr, P, fxToPaise } from './lib.js';

const c = company({ key: 'exporter', name: 'Saltmarsh Software Exports Pvt Ltd', stateCode: '24', pan: 'AAICS5512Q', fy: '2025-26' });
const G = { northgate: gstin('24', 'AAGCN3318K'), cirrus: gstin('24', 'AAFCC7204L'), lattice: gstin('24', 'AAMFL9921B') };
const BANK = 'Eastgate Bank Current A/c';
const EXPORT = 'Export of Software Services';
const DOMESTIC = 'Domestic Software Services';
const FX = 'Foreign Exchange Gain/Loss';
const BW = 'Bluewater Analytics Inc'; // overseas, kept in dollars

c.gstLedger('Output CGST', 'CGST', 'output').gstLedger('Output SGST', 'SGST/UTGST', 'output').gstLedger('Output IGST', 'IGST', 'output')
  .gstLedger('Input CGST', 'CGST', 'input').gstLedger('Input SGST', 'SGST/UTGST', 'input').gstLedger('Input IGST', 'IGST', 'input');
c.currency('$', { code: 'USD', name: 'US Dollar' });

c.ledger('Share Capital', 'Capital Account', { cr: 1000000 })
  .ledger(BANK, 'Bank Accounts', { dr: 750000, extra: { ifscode: 'EGBK0002210', bankaccholdername: 'Saltmarsh Software Exports Pvt Ltd' } })
  .ledger('Cash', 'Cash-in-Hand', { dr: 30000 })
  .ledger('Computers', 'Fixed Assets', { dr: 202000 })
  .ledger('Expenses Payable', 'Current Liabilities', { cr: 100000 })
  .ledger('Staff Advance', 'Loans & Advances (Asset)')
  .gstServiceLedger(EXPORT, 'Sales Accounts', { sac: '998314' }) // exported under LUT: no GST rate on the ledger
  .gstServiceLedger(DOMESTIC, 'Sales Accounts', { sac: '998314', rate: 18 })
  .ledger(FX, 'Indirect Expenses')
  .ledger('Cloud Hosting Charges', 'Indirect Expenses').ledger('Office Rent', 'Indirect Expenses').ledger('Salaries', 'Indirect Expenses').ledger('Bank Charges', 'Indirect Expenses');

c.party(BW, 'customer', { country: 'United States of America', currency: '$', city: 'Austin', pincode: '73301' })
  .party('Kestrel Systems FZE', 'customer', { country: 'United Arab Emirates', city: 'Dubai', pincode: '00000' }) // overseas, kept in rupees
  .party('Tamarind Labs LLC', 'customer', { country: 'United States of America', city: 'Denver', pincode: '80202', inMasters: false }) // X1
  .party('Northgate Retail Pvt Ltd', 'customer', { stateCode: '24', gstin: G.northgate, city: 'Ahmedabad', pincode: '380009', openingBills: [{ name: 'SSE/2425/077', date: '20250318', amount: 118000 }] })
  .party('Cirrus Cloud Hosting Pvt Ltd', 'vendor', { stateCode: '24', gstin: G.cirrus, city: 'Vadodara', pincode: '390007' })
  .party('Lattice Workspace LLP', 'vendor', { stateCode: '24', gstin: G.lattice, city: 'Ahmedabad', pincode: '380015' });

// ---------- exports in dollars (LUT, no GST): every line of the voucher in dollars at the rate of the day ----------
const fxOf = (fx, rate) => ({ symbol: '$', amount: fx, rate });
function dollarSale({ number, date, fx, rate, status, narration }) {
  const inr = fxToPaise(fx, rate), f = fxOf(fx, rate);
  return c.voucher('Sales', number, date, [
    { ledger: BW, amount: -inr, party: true, forex: f, bills: [{ name: number, type: 'New Ref', amount: -inr, forex: f }] },
    { ledger: EXPORT, amount: inr, forex: f },
  ], { view: 'invoice', party: BW, rated: true, status, narration,
    meta: { kind: 'sale', party: BW, inter: false, subtotal: inr, tallyTax: 0, zohoTax: 0, tds: 0, partyAmount: inr, gross: inr, reference: number, forex: { fx, rate, inr } } });
}
// money from the dollar customer, realised in rupees at the bank's rate, against one invoice
function dollarReceipt({ number, date, fx, rate, bill }) {
  const inr = fxToPaise(fx, rate), f = fxOf(fx, rate);
  return c.voucher('Receipt', number, date, [
    { ledger: BANK, amount: -inr, bank: { favouring: BW, mode: 'Others' } },
    { ledger: BW, amount: inr, party: true, forex: f, bills: [{ name: bill, type: 'Agst Ref', amount: inr, forex: f }] },
  ], { party: BW, narration: `Export proceeds realised, USD ${fx} at ${rate}`, meta: { kind: 'receipt', party: BW, amount: inr, forex: { fx, rate, inr } } });
}

dollarSale({ number: 'E/001', date: '20250415', fx: 5000, rate: 85.40, narration: 'Software development, April milestone (under LUT)' });
dollarSale({ number: 'E/002', date: '20250520', fx: 3250.50, rate: 85.95, narration: 'Support retainer, May (under LUT)' });
c.sale({ number: 'E/003', date: '20250610', party: 'Kestrel Systems FZE', lines: [{ ledger: EXPORT, amount: 180000, hsn: '998314' }], narration: 'Implementation services (under LUT)' });
c.sale({ number: 'E/004', date: '20250705', party: 'Tamarind Labs LLC', lines: [{ ledger: EXPORT, amount: 90000, hsn: '998314' }] }); // X1
dollarSale({ number: 'E/005', date: '20250801', fx: 2000, rate: 86.10, status: 'optional', narration: 'Proforma invoice for the next milestone' }); // X2
c.sale({ number: 'D/001', date: '20250625', party: 'Northgate Retail Pvt Ltd', lines: [{ ledger: DOMESTIC, amount: 50000, rate: 18, hsn: '998314' }] });

// ---------- bills ----------
c.purchase({ number: 'P/001', date: '20250430', party: 'Cirrus Cloud Hosting Pvt Ltd', reference: 'CCH/25/0412', lines: [{ ledger: 'Cloud Hosting Charges', amount: 40000, rate: 18, hsn: '998315' }] });
c.purchase({ number: 'P/002', date: '20250531', party: 'Lattice Workspace LLP', reference: 'LW-2025-05', lines: [{ ledger: 'Office Rent', amount: 60000, rate: 18, hsn: '997212' }] });

// ---------- bank realisation and the forex difference ----------
// E/001: 5,000.00 USD booked at 85.40 (4,27,000.00), realised at 84.90 (4,24,500.00): a loss of 2,500.00
dollarReceipt({ number: 'R/001', date: '20250528', fx: 5000, rate: 84.90, bill: 'E/001' });
c.journal({ number: 'J/001', date: '20250528', narration: 'Exchange loss on realisation of E/001',
  lines: [dr(FX, 2500), cr(BW, 2500, { party: true, bills: [{ name: 'E/001', type: 'Agst Ref', amount: P(2500) }] })] });
// E/002: 3,250.50 USD booked at 85.95 (2,79,380.48), realised at 86.20 (2,80,193.10): a gain of 812.62
dollarReceipt({ number: 'R/005', date: '20250630', fx: 3250.50, rate: 86.20, bill: 'E/002' });
const gain = fxToPaise(3250.50, 86.20) - fxToPaise(3250.50, 85.95);
c.journal({ number: 'J/002', date: '20250630', narration: 'Exchange gain on realisation of E/002',
  lines: [{ ledger: BW, amount: -gain, party: true, bills: [{ name: 'E/002', type: 'Agst Ref', amount: -gain }] }, { ledger: FX, amount: gain }] });

// ---------- other money ----------
const doc = n => c.voucherByNumber(n).meta;
const rupeesOf = p => p / 100;
c.receipt({ number: 'R/002', date: '20250715', party: 'Kestrel Systems FZE', bank: BANK, amount: 180000, bills: [{ name: 'E/003', amount: 180000 }] });
c.receipt({ number: 'R/003', date: '20250505', party: 'Northgate Retail Pvt Ltd', bank: BANK, amount: 118000, bills: [{ name: 'SSE/2425/077', amount: 118000 }] });
c.receipt({ number: 'R/004', date: '20250720', party: 'Northgate Retail Pvt Ltd', bank: BANK, amount: rupeesOf(doc('D/001').partyAmount), bills: [{ name: 'D/001', amount: rupeesOf(doc('D/001').partyAmount) }] });
c.payment({ number: 'PY/001', date: '20250510', party: 'Cirrus Cloud Hosting Pvt Ltd', bank: BANK, amount: rupeesOf(doc('P/001').partyAmount), bills: [{ name: 'CCH/25/0412', amount: rupeesOf(doc('P/001').partyAmount) }] });
c.payment({ number: 'PY/002', date: '20250605', party: 'Lattice Workspace LLP', bank: BANK, amount: rupeesOf(doc('P/002').partyAmount), bills: [{ name: 'LW-2025-05', amount: rupeesOf(doc('P/002').partyAmount) }] });
c.payment({ number: 'PY/003', date: '20250430', ledger: 'Salaries', bank: BANK, amount: 150000 });
c.payment({ number: 'PY/004', date: '20260228', ledger: 'Bank Charges', bank: BANK, amount: 1180, narration: 'Charges on export remittances',
  exportPatch: r => { r.date = '20260229'; r.vchstatusdate = '20260229'; r.effectivedate = '20260229'; for (const l of r.allledgerentries) for (const b of l.bankallocations || []) { b.date = '20260229'; b.instrumentdate = '20260229'; } } }); // X4
c.contra({ number: 'C/001', date: '20250602', from: BANK, to: 'Cash', amount: 20000 });
// X3: noted in Tally as a Memorandum voucher, never posted
c.journal({ type: 'Memorandum', number: 'M/001', date: '20250915', lines: [dr('Staff Advance', 25000), cr('Cash', 25000)], narration: 'Travel advance for an overseas trade fair, noted only' });

export const profile = { ...c.profile, key: 'exporter', n: 4, description: 'Exporter of software services under LUT: an overseas customer in US dollars (foreign-currency invoices), one in rupees, bank realisation at another rate, forex gain / loss journals' };
export const masters = () => c.masters();
export const transactions = () => c.transactions();
export const trialBalance = () => c.trialBalance();
export const builder = c;

const money = p => (p / 100).toFixed(2);
const cents = v => Math.round(Number(String(v ?? '0').replace(/,/g, '') || 0) * 100);
const CLEAN_DOCS = ['E/003', 'D/001', 'P/001', 'P/002'];
// the documents and receipts kept in dollars in Tally (checked on their own: see checks below)
const DOLLAR_DOCS = { 'E/001': 'invoices', 'E/002': 'invoices', 'R/001': 'other_journals', 'R/005': 'other_journals' };
export const expect = {
  vouchers: { total: c.vouchers.length, byType: c.stats().byType },
  files: {
    invoices: { clean: ['E/003', 'D/001'], problem: ['E/004'] },
    bills: { clean: ['P/001', 'P/002'], problem: [] },
    journals: { clean: ['J/001', 'J/002'], problem: [] },
    other_journals: { clean: ['R/002', 'R/003', 'R/004', 'PY/001', 'PY/002', 'PY/003', 'C/001'], problem: ['PY/004'] },
  },
  // never written to any file: the optional proforma, the memorandum (no Zoho file; it posts nothing)
  notWritten: ['E/005', 'M/001'],
  // kept with no Zoho file (counted, not lost)
  keptWithoutFile: ['M/001'],
  documents: Object.fromEntries(CLEAN_DOCS.map(n => [n, { file: doc(n).kind === 'sale' ? 'invoices' : 'bills',
    tax: money(doc(n).zohoTax), tallyTax: money(doc(n).tallyTax), partyAmount: money(doc(n).partyAmount), tds: money(doc(n).tds) }])),
  openingTotals: { debit: money(c.openingTotals().debit), credit: money(c.openingTotals().credit) },
  problems: [
    { id: 'X1', what: 'an export invoice names a party that is not in the masters', find: { kind: /party_missing|ledger_missing/, name: /Tamarind Labs LLC/ } },
    { id: 'X2', what: 'an optional voucher (proforma invoice in dollars)', find: { kind: /voucher_optional|left_out_optional/, name: /E\/005/ } },
    { id: 'X3', what: 'an unsupported voucher type (Memorandum)', find: { kind: /voucher_type_no_dataset|voucher_type_not_resolved/, name: /Memorandum/ } },
    { id: 'X4', what: 'an invalid date (29 February 2026)', find: { name: /PY\/004/, message: /date/i } },
  ],
  mayBeRefused: { invoices: ['E/004'], other_journals: ['PY/004'] },
  movementFlags: [{ match: /^(Current Assets|Sundry Debtors)$/, reason: 'X1: the customer missing from the masters is in the group in Tally, not in the masters' }],
  tbDifferences: [
    { match: /^Tamarind Labs LLC$/, reason: 'X1: the customer is not in the masters, so its invoice cannot reach Zoho Books' },
    { match: /^Accounts Receivable$/, reason: 'X1: the invoice of the customer missing from the masters' },
    { match: /^Export of Software Services$/, reason: 'X1: the income of the invoice of the customer missing from the masters' },
  ],
  // company-specific invariants (run by companies.test.js as "<label>: <name>"; id is the KNOWN_BUGS key "check:<id>")
  checks: [
    { id: 'forex', name: 'every dollar invoice and dollar receipt reaches its Zoho file at Tally\'s rupee value (or in USD at Tally\'s rate)', run(r, assert) {
      const by = Object.fromEntries(r.vouchers.map(v => [v.number, v]));
      const wrong = [];
      for (const [n, file] of Object.entries(DOLLAR_DOCS)) {
        const v = by[n], m = doc(n);
        if (v?.fileKey !== file) { wrong.push(`${n}: must be written to ${file}, went: ${v?.went}${v?.reason ? ` (${v.reason})` : ''}`); continue; }
        const rows = r.files[file].rows.filter(x => (file === 'invoices' ? x['Invoice Number'] === v.documentNumber : x['Reference Number'] === v.documentNumber || `${x['Journal Number Prefix']}${x['Journal Number Suffix']}` === v.documentNumber));
        if (!rows.length) { wrong.push(`${n}: no row in ${file}`); continue; }
        if (file === 'invoices') {
          const code = rows[0]['Currency Code'] || 'INR', xr = Number(rows[0]['Exchange Rate'] || 1);
          const value = rows.reduce((t, x) => t + Math.round(Number(x.Quantity || 1) * cents(x['Item Price'])), 0);
          const inr = code === 'INR' ? value : Math.round(value * xr);
          if (code !== 'INR' && (code !== 'USD' || xr !== m.forex.rate)) wrong.push(`${n}: written in ${code} at ${xr}; Tally has USD at ${m.forex.rate}`);
          if (inr !== m.forex.inr) wrong.push(`${n}: rupee value ${money(inr)}; Tally ${money(m.forex.inr)}`);
        } else {
          // a journal written in USD: Zoho converts each line at its Exchange Rate (the rupee value is what is checked)
          const code = rows[0].Currency || 'INR', xr = Number(rows[0]['Exchange Rate'] || 1);
          if (code !== 'INR' && (code !== 'USD' || xr !== m.forex.rate)) wrong.push(`${n}: written in ${code} at ${xr}; Tally has USD at ${m.forex.rate}`);
          const debit = rows.reduce((t, x) => t + (code === 'INR' ? cents(x.Debit) : Math.round(cents(x.Debit) * xr)), 0);
          if (debit !== m.forex.inr) wrong.push(`${n}: ${money(debit)} debited; Tally ${money(m.forex.inr)}`);
        }
      }
      assert.deepEqual(wrong, [], 'foreign-currency vouchers not written as Tally holds them');
    } },
    { id: 'export_lut', name: 'export invoices under LUT are written for an overseas customer: GST Treatment overseas, no place of supply, a zero-rate tax and no GST', run(r, assert) {
      const by = Object.fromEntries(r.vouchers.map(v => [v.number, v]));
      const wrong = [];
      for (const n of ['E/003', ...['E/001', 'E/002'].filter(x => by[x]?.fileKey === 'invoices')]) {
        const rows = r.files.invoices.rows.filter(x => x['Invoice Number'] === by[n]?.documentNumber);
        if (!rows.length) { wrong.push(`${n}: not in the Invoices file`); continue; }
        for (const x of rows) {
          if (x['GST Treatment'] !== 'overseas') wrong.push(`${n}: GST Treatment "${x['GST Treatment']}"`);
          if (x['Place of Supply']) wrong.push(`${n}: Place of Supply "${x['Place of Supply']}"`);
          if (Number(x['Item Tax %'] || 0) !== 0) wrong.push(`${n}: Item Tax % ${x['Item Tax %']}`);
          if (!x['Item Tax'] && !x['Item Tax Exemption Reason']) wrong.push(`${n}: no tax and no exemption on a line (Zoho asks for one)`);
        }
      }
      // the overseas customers are written as overseas, with no place of contact
      for (const name of ['Kestrel Systems FZE', BW]) {
        const row = (r.files.customers?.rows || []).find(x => x['Display Name'] === name);
        if (!row) { wrong.push(`customer ${name} is not in the Customers file`); continue; }
        if (row['GST Treatment'] !== 'overseas') wrong.push(`customer ${name}: GST Treatment "${row['GST Treatment']}"`);
        if (row['Place Of Contact']) wrong.push(`customer ${name}: Place Of Contact "${row['Place Of Contact']}"`);
      }
      assert.deepEqual(wrong, []);
    } },
  ],
};
