// Company 8: a small TRADER WITHOUT GST REGISTRATION (Kerala), financial year JANUARY TO DECEMBER 2025 (Tally allows any
// start; the books begin on 1 January 2025). Every name and amount is MADE UP.
//  - no GSTIN, no GST or TDS ledgers, every customer and vendor unregistered, no GST details on any voucher or party;
//    the only Duties & Taxes ledger is Professional Tax (a state levy, Tally type of duty "Others": not GST, not TDS);
//  - plain sales and purchases (accounting invoices: party, sales or purchase ledger, nothing else), one sale entered as
//    a Journal voucher (as many small traders do), receipts and payments against bills, cash and bank, a contra, two
//    journals (rent provided for, depreciation);
//  - the year runs January to December, so a quarter of the vouchers (January to March) is before 1 April, and a
//    voucher of January 2026 belongs to the NEXT year although it is before 31 March.
// Deliberate problems (each must be flagged with a plain message, and must not hide a voucher):
//  N1 a date outside the financial year: sale S/2026/001 is dated 12 January 2026 (the next year; not in the trial
//     balance of 2025). With an April-March year it would look inside the year;
//  N2 an invalid date: sale S/2025/007 is dated 30 June in Tally, but the export writes "20250631" (no such day);
//  N3 an unsupported voucher type: a Memorandum voucher (no Zoho file; it posts nothing to ledgers);
//  N4 a cancelled voucher (purchase P/2025/004: Tally keeps the number, removes the lines).
// The company is NOT registered for GST, so a correct migration writes no GST tax, GST treatment or place of supply.
// variants.no_duty_ledgers: the same company without the Professional Tax ledger, i.e. with NO Duties & Taxes ledger at
// all (common for a small unregistered trader): it must still be possible to migrate it.
import { company, dr, cr, P } from './lib.js';

const BANK = 'Lagoon Co-operative Bank A/c';
// A company without GST: Tally writes no GST registration on the vouchers and no GST details on the parties.
const NO_GST_VOUCHER_FIELDS = ['gstregistration', 'cmpgstin', 'cmpgstregistrationtype', 'cmpgststate', 'gstregistrationtype', 'partygstin', 'placeofsupply'];
const NO_GST_PARTY_FIELDS = ['gstregistrationtype', 'ledgstregdetails', 'partygstin', 'priorstatename'];

function build({ dutyLedger = true } = {}) {
  const c = company({ key: 'no_gst', name: 'Willowmere Handicrafts', stateCode: '32', gstin: '', fy: '2025-26', fyStartMonth: 1 });

  // ---------- masters (no GST anywhere) ----------
  c.ledger('Proprietor Capital', 'Capital Account', { cr: dutyLedger ? 275300 : 276500 })
    .ledger(BANK, 'Bank Accounts', { dr: 145000, extra: { ifscode: 'LCBK0000312', bankaccholdername: 'Willowmere Handicrafts' } })
    .ledger('Cash', 'Cash-in-Hand', { dr: 9500 })
    .ledger('Furniture & Fixtures', 'Fixed Assets', { dr: 80000 })
    .ledger('Stock-in-Trade', 'Stock-in-Hand', { dr: 61500 })
    .ledger('Sales - Handicrafts', 'Sales Accounts').ledger('Purchases - Handicrafts', 'Purchase Accounts')
    .ledger('Carriage Inward', 'Direct Expenses').ledger('Shop Rent', 'Indirect Expenses').ledger('Electricity', 'Indirect Expenses')
    .ledger('Depreciation', 'Indirect Expenses').ledger('Rent Payable', 'Current Liabilities', { cr: 12000 });
  // Professional Tax (a state levy on the employer, paid half-yearly): a Duties & Taxes ledger that is neither GST nor TDS
  if (dutyLedger) c.ledger('Professional Tax Payable', 'Duties & Taxes', { cr: 1200, extra: { taxtype: 'Others' } });

  c.party('Seabreeze Gift Store', 'customer', { stateCode: '32', city: 'Kochi', pincode: '682011', openingBills: [{ name: 'WH/2024/118', date: '20241210', amount: 18500 }] })
    .party('Mango Grove Resorts', 'customer', { stateCode: '32', city: 'Kumarakom', pincode: '686563' })
    .party('Temple Street Emporium', 'customer', { stateCode: '33', city: 'Madurai', pincode: '625001' })
    .party('Coir Craft Collective', 'vendor', { stateCode: '32', city: 'Alappuzha', pincode: '688001', openingBills: [{ name: 'CCC/551', date: '20241222', amount: 26000 }] })
    .party('Rosewood Artisans', 'vendor', { stateCode: '32', city: 'Thrissur', pincode: '680001' });

  // ---------- vouchers ----------
  const sale = (number, date, party, amount, o = {}) => c.voucher('Sales', number, date,
    [{ ledger: party, amount: -P(amount), party: true, bills: [{ name: number, type: 'New Ref', amount: -P(amount) }] }, { ledger: 'Sales - Handicrafts', amount: P(amount) }],
    { view: 'invoice', party, ...o, meta: { kind: 'sale', party, subtotal: P(amount), tallyTax: 0, zohoTax: 0, tds: 0, partyAmount: P(amount), ...(o.meta || {}) } });
  const purchase = (number, date, party, amount, reference, o = {}) => c.voucher('Purchase', number, date,
    [{ ledger: party, amount: P(amount), party: true, bills: [{ name: reference, type: 'New Ref', amount: P(amount) }] }, { ledger: 'Purchases - Handicrafts', amount: -P(amount) }],
    { view: 'invoice', party, reference, ...o, meta: { kind: 'purchase', party, subtotal: P(amount), tallyTax: 0, zohoTax: 0, tds: 0, partyAmount: P(amount), reference, ...(o.meta || {}) } });

  // January to March 2025: inside the company's year, before 1 April
  sale('S/2025/001', '20250114', 'Seabreeze Gift Store', 24500, { narration: 'Coir mats and lamps' });
  purchase('P/2025/001', '20250120', 'Coir Craft Collective', 31000, 'CCC/602');
  sale('S/2025/002', '20250218', 'Mango Grove Resorts', 41200);
  c.receipt({ number: 'R/2025/001', date: '20250228', party: 'Seabreeze Gift Store', bank: BANK, amount: 18500, bills: [{ name: 'WH/2024/118', amount: 18500 }] });
  c.payment({ number: 'PY/2025/001', date: '20250305', party: 'Coir Craft Collective', bank: BANK, amount: 26000, bills: [{ name: 'CCC/551', amount: 26000 }] });
  c.payment({ number: 'PY/2025/002', date: '20250331', ledger: 'Shop Rent', bank: BANK, amount: 12000, narration: 'Shop rent, March' });
  if (dutyLedger) c.payment({ number: 'PY/2025/005', date: '20250210', ledger: 'Professional Tax Payable', bank: BANK, amount: 1200, narration: 'Professional tax, second half-year' });
  // April to December 2025
  purchase('P/2025/002', '20250410', 'Rosewood Artisans', 18750, 'RA-77');
  sale('S/2025/003', '20250502', 'Temple Street Emporium', 15600);
  c.receipt({ number: 'R/2025/002', date: '20250520', party: 'Mango Grove Resorts', bank: BANK, amount: 41200, bills: [{ name: 'S/2025/002', amount: 41200 }] });
  c.contra({ number: 'C/2025/001', date: '20250602', from: BANK, to: 'Cash', amount: 8000 });
  sale('S/2025/004', '20250715', 'Seabreeze Gift Store', 9800);
  purchase('P/2025/003', '20250801', 'Coir Craft Collective', 22400, 'CCC/688');
  c.payment({ number: 'PY/2025/003', date: '20250820', party: 'Rosewood Artisans', bank: BANK, amount: 18750, bills: [{ name: 'RA-77', amount: 18750 }] });
  c.payment({ number: 'PY/2025/004', date: '20250905', ledger: 'Electricity', bank: 'Cash', amount: 3150 });
  purchase('P/2025/004', '20250918', 'Rosewood Artisans', 7200, 'RA-91', { status: 'cancelled' }); // N4
  // a sale entered as a Journal voucher: the customer debited, the sales ledger credited, nothing else
  c.journal({ number: 'J/2025/001', date: '20251004', party: 'Mango Grove Resorts', narration: 'Festival order, entered as a journal',
    lines: [dr('Mango Grove Resorts', 13250, { party: true, bills: [{ name: 'J/2025/001', type: 'New Ref', amount: -P(13250) }] }), cr('Sales - Handicrafts', 13250)] });
  c.journal({ number: 'J/2025/002', date: '20251231', lines: [dr('Shop Rent', 12000), cr('Rent Payable', 12000)], narration: 'Shop rent of December provided for' });
  c.journal({ number: 'J/2025/003', date: '20251231', lines: [dr('Depreciation', 8000), cr('Furniture & Fixtures', 8000)], narration: 'Depreciation for the year' });
  sale('S/2025/005', '20251110', 'Temple Street Emporium', 11300);
  sale('S/2025/006', '20251205', 'Mango Grove Resorts', 6400);
  // N2: Tally holds 30 June; the export writes an impossible day
  sale('S/2025/007', '20250630', 'Seabreeze Gift Store', 5250, { exportPatch: r => { r.date = '20250631'; r.vchstatusdate = '20250631'; r.effectivedate = '20250631'; } });
  // N3: a Memorandum voucher (a note; Tally posts nothing to ledgers)
  c.voucher('Memorandum', 'M/2025/001', '20251020', [dr('Carriage Inward', 1800), cr('Cash', 1800)], { narration: 'Carriage estimate, not yet paid' });
  // N1: the next year's January (after 31 December 2025)
  sale('S/2026/001', '20260112', 'Seabreeze Gift Store', 7700);

  for (const r of c.masterRecords) if (r.metadata?.type === 'Ledger') { for (const f of NO_GST_PARTY_FIELDS) delete r[f]; r.isgstapplicable = false; }
  for (const v of c.vouchers) for (const r of [v.record, v.exported]) { for (const f of NO_GST_VOUCHER_FIELDS) delete r[f]; r.vchgststatusisapplicable = false; r.vchgststatusisincluded = false; }
  return c;
}

const c = build();
const description = 'Small trader without GST registration (no GSTIN, no GST or TDS ledgers, all parties unregistered), plain sales and purchases, a sale entered as a journal, financial year January to December';
export const profile = { ...c.profile, key: 'no_gst', n: 8, fyFrom: c.fyFrom, fyTo: c.fyTo, description };
export const masters = () => c.masters();
export const transactions = () => c.transactions();
export const trialBalance = () => c.trialBalance();
export const builder = c;

// The same company with no Duties & Taxes ledger at all: run on its own by the tests (only that every step succeeds).
const v = build({ dutyLedger: false });
export const variants = {
  no_duty_ledgers: { profile: { ...v.profile, key: 'no_gst_no_duty_ledgers', n: 8, description: `${description}; no Duties & Taxes ledger at all` },
    masters: () => v.masters(), transactions: () => v.transactions(), trialBalance: () => v.trialBalance(), builder: v },
};

const doc = n => c.voucherByNumber(n).meta;
const money = p => (p / 100).toFixed(2);
// The vouchers whose file depends on the company's own year (January to March 2025, and the next January) are checked by the
// check "year" below; the lists here hold the vouchers of April to December, whose file does not depend on it.
const CLEAN_DOCS = ['S/2025/003', 'S/2025/004', 'S/2025/005', 'S/2025/006', 'P/2025/002', 'P/2025/003'];
export const expect = {
  vouchers: { total: c.vouchers.length, byType: c.stats().byType },
  files: {
    invoices: { clean: ['S/2025/003', 'S/2025/004', 'S/2025/005', 'S/2025/006'], problem: ['S/2025/007'] },
    bills: { clean: ['P/2025/002', 'P/2025/003'], problem: [] },
    journals: { clean: ['J/2025/002', 'J/2025/003'], problem: [] },
    other_journals: { clean: ['R/2025/002', 'PY/2025/003', 'PY/2025/004', 'C/2025/001'], problem: [] },
  },
  // the sale entered as a journal may become an invoice or stay a journal naming the customer: both post the same amounts
  anyOf: { 'J/2025/001': ['invoices', 'journals'] },
  // never written: the Memorandum voucher, the cancelled purchase (the voucher of the next year: check "year")
  notWritten: ['M/2025/001', 'P/2025/004'],
  keptWithoutFile: ['M/2025/001'],
  documents: Object.fromEntries(CLEAN_DOCS.map(n => [n, { file: doc(n).kind === 'sale' ? 'invoices' : 'bills',
    tax: money(doc(n).zohoTax), tallyTax: money(doc(n).tallyTax), partyAmount: money(doc(n).partyAmount), tds: money(doc(n).tds) }])),
  // the opening totals of Tally's report as it shows them: each top-level group netted (a customer in credit or a vendor in
  // debit is netted inside its group)
  openingTotals: (() => { let d = 0, k = 0; for (const l of c.trialBalance().dspaccbody.dspaccline) { const v = Math.round((l.dspaccinfo[0].dspopamt.dspopamta || 0) * 100); if (v < 0) d -= v; else k += v; } return { debit: money(d), credit: money(k) }; })(),
  problems: [
    { id: 'N1', what: 'a date outside the financial year (the next January, before 31 March)', find: { kind: /left_out_outside_year|outside/, name: /S\/2026\/001/ } },
    { id: 'N2', what: 'an invalid date (31 June)', find: { name: /S\/2025\/007/, message: /date/i } },
    { id: 'N3', what: 'an unsupported voucher type (Memorandum)', find: { kind: /voucher_type_no_dataset|voucher_type_not_resolved/, name: /Memorandum/ } },
    { id: 'N4', what: 'a cancelled voucher', find: { kind: /voucher_cancelled/, name: /P\/2025\/004/ } },
  ],
  mayBeRefused: { invoices: ['S/2025/007'] },
  movementFlags: [],
  tbDifferences: [
    { match: /^Seabreeze Gift Store$|^Accounts Receivable$|^Sales - Handicrafts$/, reason: 'N2: the invoice with the impossible date may be left out of the files' },
  ],
  // company-specific invariants (run by companies.test.js as "<label>: <name>"; id is the KNOWN_BUGS key "check:<id>")
  checks: [
    { id: 'no_gst', name: 'a company not registered for GST gets no GST tax, no registered GST treatment and no GSTIN in any file', run(r, assert) {
      const wrong = [];
      for (const [k, f] of Object.entries(r.files)) for (const x of f.rows) {
        for (const col of ['Item Tax', 'Tax Name']) if (/gst/i.test(String(x[col] || ''))) wrong.push(`${k}: ${col} "${x[col]}"`);
        if (/^business_(gst|registered|sez)/.test(String(x['GST Treatment'] || ''))) wrong.push(`${k}: GST Treatment "${x['GST Treatment']}"`);
        if (String(x['GST Identification Number (GSTIN)'] || '').trim()) wrong.push(`${k}: a GSTIN`);
      }
      assert.deepEqual([...new Set(wrong)], []);
    } },
    { id: 'year', name: 'the migration follows the company\'s own financial year (1 January to 31 December 2025): every voucher of the year is written, the next year\'s is not, and the opening balances are dated 31 December 2024', run(r, assert) {
      const by = Object.fromEntries(r.vouchers.map(v => [v.number, v]));
      const wrong = [];
      for (const v of c.vouchers) {
        const m = v.meta, inYear = m.date >= c.fyFrom && m.date <= c.fyTo;
        if (m.status || /memorandum/i.test(m.type) || m.number === 'S/2025/007') continue;
        if (inYear && !by[m.number]?.fileKey) wrong.push(`${m.number} (${m.date}): inside the year, went: ${by[m.number]?.went}${by[m.number]?.reason ? ` (${by[m.number].reason})` : ''}`);
        if (!inYear && by[m.number]?.fileKey) wrong.push(`${m.number} (${m.date}): outside the year, written to ${by[m.number].fileKey}`);
      }
      for (const x of r.files.opening_balances_for_zoho_accounts?.rows || []) if (x['Journal Date'] !== '2024-12-31') { wrong.push(`opening balance journal dated ${x['Journal Date']}`); break; }
      assert.deepEqual(wrong, []);
    } },
  ],
};
