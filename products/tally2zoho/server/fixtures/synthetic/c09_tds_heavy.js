// Company 9: a TDS-HEAVY infrastructure contractor (Telangana), FY 2025-26. Every name, GSTIN and amount is MADE UP.
//  - TDS deducted from vendors on their bills, one TDS ledger per nature of payment, Tally's nature written in words (as
//    Tally names its natures of payment; the section is not in the text): 194C contractors (2% and 1% for an individual),
//    194I rent (10%), 194J professional fees (10%), 194H commission (2%), 194Q purchase of goods (0.1%), 194A interest
//    on an unsecured loan (10%, on a journal);
//  - a LOWER DEDUCTION vendor: an architect holding a certificate under section 197 for 1% instead of 10%;
//  - TDS deducted BY CUSTOMERS on our invoices (Tally debits "TDS Receivable" on the invoice): 194C 2% and 194J 10%;
//  - TDS paid to the government: one challan as a Payment voucher (several TDS ledgers debited), one as a Journal
//    voucher; TDS payable and TDS receivable brought forward from last year.
//  - S7 (TDS/TCS): a TDS ledger whose section is only in its name, written with a separator ("194-I"), for hire of
//    machinery at 2% (194I, rent on plant and machinery); a bill of an overseas designer with TDS under section 195 (20%);
//    a sale of scrap with TCS (a Tally ledger of type TCS, nature of goods "Scrap", 1% of the total).
// Deliberate problems (each must be flagged with a plain message, and must not hide a voucher):
//  T1 a TDS ledger with no Zoho TDS tax: "TDS Payable" has Tally's nature of payment "Any" (no section) and is credited on
//     housekeeping bill P/008;
//  T2 a registered vendor without GSTIN: "Banyan Labour Services" is "Regular" in Tally but has no GSTIN (bill P/002);
//  T3 a GST rate that does not match the amount: commission bill P/006 has an 18% line but Tally charged 6% + 6%.
import { company, gstin, cr, dr, P, ANY } from './lib.js';

const c = company({ key: 'tds_heavy', name: 'Larkspur Infra Projects Pvt Ltd', stateCode: '36', pan: 'AAFCL7730K', fy: '2025-26' });
const G = {
  aurora: gstin('36', 'AAJCA4410M'), pinnacle: gstin('29', 'AAHCP2281Q'), hilltop: gstin('36', 'AAAAH6620B'), ironwood: gstin('36', 'AADFI5530C'),
  meridian: gstin('36', 'AAOFM7714D'), kavya: gstin('36', 'AAKFK3302E'), corvid: gstin('29', 'AAPFC8846F'), swift: gstin('36', 'AAMFS2209G'),
  granite: gstin('36', 'AACCG1175H'), quickfix: gstin('36', 'AAQFQ6631J'), ironclad: gstin('36', 'AAICI4421K'),
};
const BANK = 'Deccan Bank Current A/c';
const T = { contract: 'TDS on Contractors', rent: 'TDS on Rent', prof: 'TDS on Professional Fees', comm: 'TDS on Commission', goods: 'TDS on Purchase of Goods', interest: 'TDS on Interest', any: 'TDS Payable',
  machinery: 'TDS u/s 194-I Machinery', nonres: 'TDS on Non-Resident Payments' };
const TCS = 'TCS on Scrap Sales';

c.gstLedger('Output CGST', 'CGST', 'output', { cr: 12000 }).gstLedger('Output SGST', 'SGST/UTGST', 'output', { cr: 12000 }).gstLedger('Output IGST', 'IGST', 'output')
  .gstLedger('Input CGST', 'CGST', 'input').gstLedger('Input SGST', 'SGST/UTGST', 'input').gstLedger('Input IGST', 'IGST', 'input');
// TDS ledgers: Tally's nature of payment in words, as Tally names its natures (the section is a field of the nature, not
// of the ledger, and is not in the export)
c.tdsLedger(T.contract, 'Payment to Contractors', { cr: 4200 })
  .tdsLedger(T.rent, 'Rent of Land, Building or Furniture')
  .tdsLedger(T.prof, 'Fees for Professional or Technical Services', { cr: 7500 })
  .tdsLedger(T.comm, 'Commission or Brokerage')
  .tdsLedger(T.goods, 'Purchase of Goods')
  .tdsLedger(T.interest, 'Interest other than Interest on Securities')
  .tdsLedger(T.any, ANY) // T1: no nature of payment, no section anywhere
  .tdsLedger(T.machinery, ANY) // S7 (TDS-007): the section only in the ledger's name, with a separator
  .tdsLedger(T.nonres, 'Payment to Non-Resident') // S7 (TDS-008): section 195
  .ledger(TCS, 'Duties & Taxes', { extra: { taxtype: 'TCS', tcsnatureofgoods: 'Scrap' } }); // S7 (TDS-015): tax collected at source

c.ledger('Share Capital', 'Capital Account', { cr: 2000000 })
  .ledger('Sterling Finvest Pvt Ltd - Loan', 'Unsecured Loans', { cr: 800000 })
  .ledger(BANK, 'Bank Accounts', { dr: 1757700, extra: { ifscode: 'DCBK0006021', bankaccholdername: 'Larkspur Infra Projects Pvt Ltd' } })
  .ledger('Cash', 'Cash-in-Hand', { dr: 25000 })
  .ledger('Construction Machinery', 'Fixed Assets', { dr: 900000 })
  // TDS deducted by customers last year, not yet set off: Zoho's own account name "TDS Receivable"
  .ledger('TDS Receivable', 'Loans & Advances (Asset)', { dr: 35000 })
  .gstServiceLedger('Contract Works Income', 'Sales Accounts', { sac: '995421', rate: 18 })
  .gstServiceLedger('Project Consultancy Income', 'Sales Accounts', { sac: '998331', rate: 18 })
  .ledger('Sub-contract Charges', 'Direct Expenses').ledger('Labour Charges', 'Direct Expenses').ledger('Purchase - Construction Material', 'Purchase Accounts')
  .ledger('Office Rent', 'Indirect Expenses').ledger('Professional Fees', 'Indirect Expenses').ledger('Commission on Sales', 'Indirect Expenses')
  .ledger('Housekeeping Charges', 'Indirect Expenses').ledger('Interest on Unsecured Loan', 'Indirect Expenses')
  .ledger('Machinery Hire Charges', 'Direct Expenses').ledger('Design Fees - Overseas', 'Indirect Expenses').ledger('Scrap Sales', 'Sales Accounts');

c.party('Aurora Metro Rail Corp Ltd', 'customer', { stateCode: '36', gstin: G.aurora, city: 'Hyderabad', pincode: '500003', openingBills: [{ name: 'LIP/2425/210', date: '20250320', amount: 236000 }] })
  .party('Pinnacle Tech Parks Pvt Ltd', 'customer', { stateCode: '29', gstin: G.pinnacle, city: 'Bengaluru', pincode: '560103' })
  .party('Hilltop Housing Society', 'customer', { stateCode: '36', gstin: G.hilltop, city: 'Warangal', pincode: '506002' })
  .party('Ironwood Civil Contractors', 'vendor', { stateCode: '36', gstin: G.ironwood, city: 'Hyderabad', pincode: '500032', openingBills: [{ name: 'ICC/24-25/412', date: '20250325', amount: 118000 }] })
  .party('Banyan Labour Services', 'vendor', { stateCode: '36', regType: 'Regular', city: 'Secunderabad', pincode: '500003' }) // T2: registered, no GSTIN
  .party('Meridian Estates LLP', 'vendor', { stateCode: '36', gstin: G.meridian, city: 'Hyderabad', pincode: '500081' })
  .party('Kavya Associates', 'vendor', { stateCode: '36', gstin: G.kavya, city: 'Hyderabad', pincode: '500004' })
  .party('Corvid Design Studio', 'vendor', { stateCode: '29', gstin: G.corvid, city: 'Mysuru', pincode: '570001' }) // lower deduction (section 197): 1%
  .party('Swiftline Commission Agents', 'vendor', { stateCode: '36', gstin: G.swift, city: 'Karimnagar', pincode: '505001' })
  .party('Granite Peak Cement Ltd', 'vendor', { stateCode: '36', gstin: G.granite, city: 'Nalgonda', pincode: '508001' })
  .party('Quickfix Housekeeping', 'vendor', { stateCode: '36', gstin: G.quickfix, city: 'Hyderabad', pincode: '500016' })
  .party('Ironclad Equipment Hire', 'vendor', { stateCode: '36', gstin: G.ironclad, city: 'Hyderabad', pincode: '500018' })
  .party('Helios Design Studio GmbH', 'vendor', { country: 'Germany', city: 'Berlin', pincode: '10115' });

// ---------- invoices: TDS deducted by the customer, on the invoice ----------
c.sale({ number: 'LIP/S/001', date: '20250425', party: 'Aurora Metro Rail Corp Ltd', lines: [{ ledger: 'Contract Works Income', amount: 500000, rate: 18, hsn: '995421' }],
  tds: { ledger: 'TDS Receivable', amount: 10000 }, narration: 'Viaduct works, running bill 1', meta: { tdsSection: '194C', tdsPercent: '2' } });
c.sale({ number: 'LIP/S/002', date: '20250530', party: 'Pinnacle Tech Parks Pvt Ltd', lines: [{ ledger: 'Project Consultancy Income', amount: 200000, rate: 18, hsn: '998331' }],
  tds: { ledger: 'TDS Receivable', amount: 20000 }, meta: { tdsSection: '194J', tdsPercent: '10' } });
c.sale({ number: 'LIP/S/003', date: '20250715', party: 'Hilltop Housing Society', lines: [{ ledger: 'Contract Works Income', amount: 150000, rate: 18, hsn: '995421' }] });
// S7 (TDS-015): scrap sold with TCS at 1% of the total including GST (Tally credits a ledger of type TCS)
c.sale({ number: 'LIP/S/005', date: '20250820', party: 'Hilltop Housing Society', lines: [{ ledger: 'Scrap Sales', amount: 100000, rate: 18, hsn: '720449' }],
  tds: { ledger: TCS, amount: -1180 }, narration: 'Sale of steel scrap, TCS 206C(1)', meta: { tcs: 118000 } });
c.sale({ number: 'LIP/S/004', date: '20250910', party: 'Aurora Metro Rail Corp Ltd', lines: [{ ledger: 'Contract Works Income', amount: 325000, rate: 18, hsn: '995421' }],
  tds: { ledger: 'TDS Receivable', amount: 6500 }, narration: 'Viaduct works, running bill 2', meta: { tdsSection: '194C', tdsPercent: '2' } });

// ---------- bills: TDS deducted from the vendor ----------
const bill = (number, date, party, reference, ledger, amount, rate, tds, o = {}) => c.purchase({ number, date, party, reference, lines: [{ ledger, amount, rate, ...(o.hsn ? { hsn: o.hsn } : {}) }],
  ...(tds ? { tds: { ledger: tds.ledger, amount: tds.amount } } : {}), ...(o.tax ? { tax: o.tax } : {}), meta: tds ? { tdsSection: tds.section, tdsPercent: tds.percent } : {} });
bill('LIP/P/001', '20250412', 'Ironwood Civil Contractors', 'ICC/25-26/031', 'Sub-contract Charges', 400000, 18, { ledger: T.contract, amount: 8000, section: '194C', percent: '2' });
bill('LIP/P/002', '20250505', 'Banyan Labour Services', 'BLS-114', 'Labour Charges', 80000, 18, { ledger: T.contract, amount: 800, section: '194C', percent: '1' }); // T2
bill('LIP/P/003', '20250430', 'Meridian Estates LLP', 'MEL/R/0425', 'Office Rent', 120000, 18, { ledger: T.rent, amount: 12000, section: '194I', percent: '10' });
bill('LIP/P/004', '20250618', 'Kavya Associates', 'KA/2025/88', 'Professional Fees', 60000, 18, { ledger: T.prof, amount: 6000, section: '194J', percent: '10' });
// lower deduction certificate (section 197): 1% instead of 10%
bill('LIP/P/005', '20250708', 'Corvid Design Studio', 'CDS-0711', 'Professional Fees', 150000, 18, { ledger: T.prof, amount: 1500, section: '194J', percent: '1' });
// T3: an 18% line, but Tally charged 6% + 6%
bill('LIP/P/006', '20250814', 'Swiftline Commission Agents', 'SCA/77', 'Commission on Sales', 50000, 18, { ledger: T.comm, amount: 1000, section: '194H', percent: '2' }, { tax: { CGST: 3000, SGST: 3000 } });
bill('LIP/P/007', '20250620', 'Granite Peak Cement Ltd', 'GPC/INV/5531', 'Purchase - Construction Material', 600000, 28, { ledger: T.goods, amount: 600, section: '194Q', percent: '0.1' }, { hsn: '252329' });
// S7 (TDS-007): hire of machinery, TDS 194I at 2%, the section only in the ledger name ("194-I")
bill('LIP/P/009', '20250905', 'Ironclad Equipment Hire', 'IEH/0905', 'Machinery Hire Charges', 50000, 18, { ledger: T.machinery, amount: 1000, section: '194I', percent: '2' });
// S7 (TDS-008): an overseas designer, TDS under section 195 at 20%, no GST on the bill
bill('LIP/P/010', '20250912', 'Helios Design Studio GmbH', 'HDS-2025-031', 'Design Fees - Overseas', 100000, undefined, { ledger: T.nonres, amount: 20000, section: '195', percent: '20' });
// T1: TDS credited on a ledger with no nature of payment
bill('LIP/P/008', '20250922', 'Quickfix Housekeeping', 'QH/0922', 'Housekeeping Charges', 40000, 18, { ledger: T.any, amount: 800, section: '194C', percent: '2' });
// the lower deduction certificate is on the vendor's bill-wise line: Tally marks the deductee as at a special rate
for (const v of [c.voucherByNumber('LIP/P/005')]) for (const r of [v.record, v.exported]) for (const l of r.ledgerentries) for (const b of l.billallocations || []) b.tdsdeducteeisspecialrate = true;

// ---------- money: receipts, vendor payments, TDS challans ----------
const doc = n => c.voucherByNumber(n).meta;
const rupeesOf = p => p / 100;
c.receipt({ number: 'R/001', date: '20250515', party: 'Aurora Metro Rail Corp Ltd', bank: BANK, amount: 236000, bills: [{ name: 'LIP/2425/210', amount: 236000 }] });
c.receipt({ number: 'R/002', date: '20250520', party: 'Aurora Metro Rail Corp Ltd', bank: BANK, amount: rupeesOf(doc('LIP/S/001').partyAmount), bills: [{ name: 'LIP/S/001', amount: rupeesOf(doc('LIP/S/001').partyAmount) }] });
c.receipt({ number: 'R/003', date: '20250625', party: 'Pinnacle Tech Parks Pvt Ltd', bank: BANK, amount: rupeesOf(doc('LIP/S/002').partyAmount), bills: [{ name: 'LIP/S/002', amount: rupeesOf(doc('LIP/S/002').partyAmount) }] });
// TDS challan of March, paid on 7 April: a Payment voucher debiting two TDS ledgers
c.voucher('Payment', 'PY/001', '20250407', [dr(T.contract, 4200), dr(T.prof, 7500), { ledger: BANK, amount: P(11700), bank: { favouring: 'Income Tax Department', mode: 'e-Fund Transfer' } }],
  { narration: 'TDS challan 281, March 2025', meta: { kind: 'payment', amount: P(11700) } });
c.payment({ number: 'PY/002', date: '20250420', party: 'Ironwood Civil Contractors', bank: BANK, amount: 118000, bills: [{ name: 'ICC/24-25/412', amount: 118000 }] });
c.voucher('Payment', 'PY/003', '20250507', [dr(T.contract, 8000), dr(T.rent, 12000), { ledger: BANK, amount: P(20000), bank: { favouring: 'Income Tax Department', mode: 'e-Fund Transfer' } }],
  { narration: 'TDS challan 281, April 2025', meta: { kind: 'payment', amount: P(20000) } });
c.payment({ number: 'PY/004', date: '20250510', party: 'Ironwood Civil Contractors', bank: BANK, amount: rupeesOf(doc('LIP/P/001').partyAmount), bills: [{ name: 'ICC/25-26/031', amount: rupeesOf(doc('LIP/P/001').partyAmount) }] });
c.payment({ number: 'PY/005', date: '20250605', party: 'Meridian Estates LLP', bank: BANK, amount: rupeesOf(doc('LIP/P/003').partyAmount), bills: [{ name: 'MEL/R/0425', amount: rupeesOf(doc('LIP/P/003').partyAmount) }] });
c.payment({ number: 'PY/006', date: '20250731', ledger: 'Sterling Finvest Pvt Ltd - Loan', bank: BANK, amount: 54000, narration: 'Interest for the quarter, net of TDS' });
c.contra({ number: 'C/001', date: '20250602', from: BANK, to: 'Cash', amount: 20000 });
// interest on the unsecured loan, TDS 194A at 10%
c.journal({ number: 'J/001', date: '20250630', lines: [dr('Interest on Unsecured Loan', 60000), cr('Sterling Finvest Pvt Ltd - Loan', 54000), cr(T.interest, 6000)], narration: 'Interest for April to June, TDS 194A' });
// TDS challan of June, entered as a Journal voucher (as many accountants do): TDS ledgers debited, the bank credited
c.journal({ number: 'J/002', date: '20250707', lines: [dr(T.prof, 7500), dr(T.contract, 800), dr(T.goods, 600), dr(T.interest, 6000), cr(BANK, 14900)], narration: 'TDS challan 281, June 2025' });

export const profile = { ...c.profile, key: 'tds_heavy', n: 9, description: 'TDS-heavy contractor: 194C, 194I, 194J, 194H, 194Q on bills, 194A on a journal, a lower deduction vendor, TDS deducted by customers on invoices, TDS challans as payment and journal' };
export const masters = () => c.masters();
export const transactions = () => c.transactions();
export const trialBalance = () => c.trialBalance();
export const builder = c;

const money = p => (p / 100).toFixed(2);
const CLEAN_DOCS = ['LIP/S/001', 'LIP/S/002', 'LIP/S/003', 'LIP/S/004', 'LIP/P/001', 'LIP/P/003', 'LIP/P/004', 'LIP/P/005', 'LIP/P/007', 'LIP/P/009', 'LIP/P/010'];
const TDS_DOCS = ['LIP/S/001', 'LIP/S/002', 'LIP/S/004', 'LIP/P/001', 'LIP/P/003', 'LIP/P/004', 'LIP/P/005', 'LIP/P/007', 'LIP/P/009', 'LIP/P/010'];
const num = v => Number(String(v ?? '').replace(/,/g, '').replace('%', '') || 0);
const byNumber = r => Object.fromEntries(r.vouchers.map(v => [v.number, v]));
const docRows = (r, v) => (r.files[v.fileKey]?.rows || []).filter(x => (v.fileKey === 'invoices' ? x['Invoice Number'] : x['Bill Number']) === v.documentNumber);
export const expect = {
  vouchers: { total: c.vouchers.length, byType: c.stats().byType },
  files: {
    invoices: { clean: ['LIP/S/001', 'LIP/S/002', 'LIP/S/003', 'LIP/S/004', 'LIP/S/005'], problem: [] },
    bills: { clean: ['LIP/P/001', 'LIP/P/003', 'LIP/P/004', 'LIP/P/005', 'LIP/P/007', 'LIP/P/009', 'LIP/P/010'], problem: ['LIP/P/002', 'LIP/P/006', 'LIP/P/008'] },
    journals: { clean: ['J/001', 'J/002'], problem: [] },
    other_journals: { clean: ['R/001', 'R/002', 'R/003', 'PY/001', 'PY/002', 'PY/003', 'PY/004', 'PY/005', 'PY/006', 'C/001'], problem: [] },
  },
  notWritten: [],
  documents: Object.fromEntries(CLEAN_DOCS.map(n => [n, { file: doc(n).kind === 'sale' ? 'invoices' : 'bills',
    tax: money(doc(n).zohoTax), tallyTax: money(doc(n).tallyTax), partyAmount: money(doc(n).partyAmount), tds: money(doc(n).tds) }])),
  // the opening totals of Tally's report as it shows them: each top-level group netted (a customer in credit or a vendor in
  // debit is netted inside its group)
  openingTotals: (() => { let d = 0, k = 0; for (const l of c.trialBalance().dspaccbody.dspaccline) { const v = Math.round((l.dspaccinfo[0].dspopamt.dspopamta || 0) * 100); if (v < 0) d -= v; else k += v; } return { debit: money(d), credit: money(k) }; })(),
  problems: [
    { id: 'T1', what: 'a TDS ledger with no Zoho TDS tax', find: { kind: /tds_not_mapped/, name: /^TDS Payable$/, message: /TDS/ } },
    { id: 'T2', what: 'a registered vendor without GSTIN', find: { kind: /registered_without_gstin|contact_details_corrected/, name: /Banyan Labour Services/, message: /GSTIN/ } },
    { id: 'T3', what: 'a GST rate that does not match the amount (on a bill)', find: { name: /LIP\/P\/006|SCA\/77/, kind: /tax_rate_from_amount|tax_amount_differs/, message: /18%|12%/ } },
  ],
  mayBeRefused: { bills: ['LIP/P/002', 'LIP/P/006', 'LIP/P/008'] },
  movementFlags: [],
  tbDifferences: [
    { match: /^(Input CGST|Input SGST)$/, reason: 'T3: Zoho Books works the tax of the commission bill out at the line\'s 18%, Tally charged 12%; T2: the bill of the vendor without GSTIN may be refused' },
    { match: /^Accounts Payable$|^Swiftline Commission Agents$|^Banyan Labour Services$|^Quickfix Housekeeping$/, reason: 'T1/T2/T3: a bill with a problem may be refused or posted differently' },
    { match: /^Commission on Sales$|^Labour Charges$|^Housekeeping Charges$/, reason: 'T1/T2/T3: the expense of a bill with a problem' },
    { match: /^TDS Payable$|^TDS on Contractors$|^TDS on Commission$/, reason: 'T1/T2/T3: the TDS of a bill with a problem (Zoho posts TDS to the account its TDS tax is linked to)' },
  ],
  // company-specific invariants (run by companies.test.js as "<label>: <name>"; id is the KNOWN_BUGS key "check:<id>")
  checks: [
    { id: 'tds_columns', name: 'every bill and invoice with TDS carries Tally\'s TDS amount, the rate Tally deducted (also the lower deduction rate) and the section of the nature of payment', run(r, assert) {
      const by = byNumber(r), wrong = [];
      for (const n of TDS_DOCS) {
        const v = by[n], m = doc(n);
        if (!v?.fileKey) { wrong.push(`${n}: not written (${v?.went})`); continue; }
        const rows = docRows(r, v);
        if (!rows.length) { wrong.push(`${n}: no rows in ${v.fileKey}`); continue; }
        const x = rows[0];
        if (money(Math.round(num(x['TDS Amount']) * 100)) !== money(m.tds)) wrong.push(`${n}: TDS Amount ${x['TDS Amount']}, Tally ${money(m.tds)}`);
        if (num(x['TDS Percentage']) !== Number(m.tdsPercent)) wrong.push(`${n}: TDS Percentage ${x['TDS Percentage']}, Tally deducted ${m.tdsPercent}%`);
        if (String(x['TDS Section Code'] || '').toUpperCase() !== m.tdsSection) wrong.push(`${n}: TDS Section Code "${x['TDS Section Code']}", the nature of payment is section ${m.tdsSection}`);
        if (!String(x['TDS Name'] || '').trim()) wrong.push(`${n}: no TDS Name`);
      }
      assert.deepEqual(wrong, [], 'TDS written differently from Tally');
    } },
    { id: 'tds_one_rate_per_name', name: 'a Zoho TDS tax name is written with one rate and one section only (a Zoho TDS tax has one rate)', run(r, assert) {
      const seen = new Map();
      for (const k of ['invoices', 'bills']) for (const x of r.files[k]?.rows || []) {
        const name = String(x['TDS Name'] || '').trim();
        if (!name) continue;
        if (!seen.has(name)) seen.set(name, new Set());
        seen.get(name).add(`${num(x['TDS Percentage'])}% ${x['TDS Section Code']}`);
      }
      assert.deepEqual([...seen].filter(([, s]) => s.size > 1).map(([n, s]) => `${n}: ${[...s].join(', ')}`), []);
    } },
    { id: 'tcs_never_gst', name: 'tax collected at source (a Tally ledger of type TCS) is never a GST line: by default it is in the Adjustment column and the total is Tally\'s', run(r, assert) {
      const v = byNumber(r)['LIP/S/005'];
      assert.ok(v?.fileKey === 'invoices', `LIP/S/005 written to ${v?.went}`);
      const rows = docRows(r, v);
      assert.ok(rows.length > 0);
      assert.ok(!rows.some(x => x.Account === TCS || x['Item Name'] === TCS), 'no line on the TCS ledger');
      assert.equal(num(rows[0].Adjustment), 1180, 'the TCS in the Adjustment column');
    } },
    { id: 'tds_section_separator_and_195', name: 'a section written with a separator in the ledger name is that section (194I, not dividend), and section 195 is written for a non-resident', run(r, assert) {
      const by = byNumber(r);
      const one = n => docRows(r, by[n])[0] || {};
      assert.deepEqual([one('LIP/P/009')['TDS Section Code'], one('LIP/P/009')['TDS Name']], ['194I', 'Rent on plant and machinery']);
      assert.equal(one('LIP/P/010')['TDS Section Code'], '195');
    } },
    { id: 'tds_merges_listed', name: 'the predicted trial balance lists the Tally TDS ledgers entered on the Zoho account TDS Payable (the comparison is made through that merge, TDS-016)', run(r, assert) {
      const m = (r.predicted?.merged || []).find(x => x.account === 'TDS Payable');
      assert.ok(m, 'TDS Payable is listed as a merge');
      assert.ok(m.tallyLedgers.length >= 2, m.tallyLedgers.join(', '));
      assert.ok(!(r.predicted?.merged || []).some(x => /^Accounts (Receivable|Payable)$/.test(x.account)), 'contacts are not merges');
    } },
    { id: 'tds_challans', name: 'the TDS challans (a Payment voucher and a Journal voucher) debit the TDS accounts in the journal files, never a vendor', run(r, assert) {
      const by = byNumber(r), wrong = [];
      for (const n of ['PY/001', 'PY/003', 'J/002']) {
        const v = by[n];
        if (!v?.fileKey) { wrong.push(`${n}: not written (${v?.went})`); continue; }
        const rows = (r.files[v.fileKey]?.rows || []).filter(x => x['Reference Number'] === v.documentNumber || `${x['Journal Number Prefix'] || ''}${x['Journal Number Suffix'] || ''}` === v.documentNumber);
        const debited = rows.filter(x => num(x.Debit) > 0).map(x => x.Account);
        if (!debited.length) wrong.push(`${n}: no debit line found in ${v.fileKey}`);
        for (const a of debited) if (!/^TDS /.test(a)) wrong.push(`${n}: debits "${a}"`);
        for (const x of rows) if (String(x['Contact Name'] || '').trim()) wrong.push(`${n}: names contact "${x['Contact Name']}"`);
      }
      assert.deepEqual(wrong, []);
    } },
  ],
};
