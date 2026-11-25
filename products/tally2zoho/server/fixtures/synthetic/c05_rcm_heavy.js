// Company 5: a services firm with a lot of REVERSE CHARGE (Maharashtra), FY 2025-26. Every name, GSTIN and amount is MADE UP.
//  - consulting fees billed with GST (one customer in the state, one in another state: IGST);
//  - reverse charge (RCM) bills, booked as Tally users usually do: the GST debited on the input ledgers and credited on
//    separate "Payable (RCM)" GST ledgers with the same amount; the vendor is owed the lines only:
//      rent from an UNREGISTERED landlord in the same state (CGST 9 + SGST 9 under reverse charge);
//      software from an OVERSEAS vendor with no GSTIN (import of services: IGST 18 under reverse charge);
//      legal fees from an unregistered firm of advocates in another state (IGST 18 under reverse charge), with TDS;
//      goods transport (GTA) at 5% under reverse charge (CGST 2.5 + SGST 2.5), one bill booked without the tax and the
//      reverse charge raised by a journal afterwards;
//  - the RCM set-off: the reverse charge paid in cash into the electronic cash ledger, a journal clearing the RCM payable
//    against it, and the month's input credit set off against the output tax.
// Deliberate problems (each must be flagged with a plain message, and must not hide a voucher):
//  R1 duplicate party names: the overseas vendor "Stratus SaaS Inc" and "STRATUS SAAS  INC" (capitals, two spaces);
//  R2 a TDS ledger with no Zoho TDS tax: "TDS Payable - Others" (nature of payment "Any", no section) on the legal bill;
//  R3 a registered vendor without GSTIN: the transporter "Speedtrack Carriers" is "Regular" in Tally with no GSTIN;
//  R4 an unbalanced voucher: the RCM set-off journal J/003 balances in Tally, but its export writes the IGST line as
//     14000.00 instead of 14400.00.
import { company, gstin, cr, dr, ANY } from './lib.js';

const c = company({ key: 'rcm_heavy', name: 'Pinecrest Freight Advisors LLP', stateCode: '27', pan: 'AAQFP6614D', fy: '2025-26' });
const G = { konkan: gstin('27', 'AAECK4471H'), deccan: gstin('29', 'AABCD9302M'), swiftline: gstin('27', 'AAPFS2287N') };
const BANK = 'Seaward Bank Current A/c';
const ECL = 'Electronic Cash Ledger (GST)';
const RCM = { CGST: 'CGST Payable (RCM)', SGST: 'SGST Payable (RCM)', IGST: 'IGST Payable (RCM)' };

c.gstLedger('Output CGST', 'CGST', 'output').gstLedger('Output SGST', 'SGST/UTGST', 'output').gstLedger('Output IGST', 'IGST', 'output')
  .gstLedger('Input CGST', 'CGST', 'input').gstLedger('Input SGST', 'SGST/UTGST', 'input').gstLedger('Input IGST', 'IGST', 'input');
c.taxLedgers.rcm = {}; // the reverse charge payable ledgers: GST duty ledgers of their own
c.gstLedger(RCM.CGST, 'CGST', 'rcm').gstLedger(RCM.SGST, 'SGST/UTGST', 'rcm').gstLedger(RCM.IGST, 'IGST', 'rcm');

c.ledger('Partners Capital', 'Capital Account', { cr: 700000 })
  .ledger(BANK, 'Bank Accounts', { dr: 600000, extra: { ifscode: 'SWBK0003301', bankaccholdername: 'Pinecrest Freight Advisors LLP' } })
  .ledger('Cash', 'Cash-in-Hand', { dr: 20000 })
  .ledger(ECL, 'Loans & Advances (Asset)')
  .ledger('Expenses Payable', 'Current Liabilities', { cr: 60000 })
  .tdsLedger('TDS Payable - Others', ANY) // R2: no nature of payment, no section
  .gstServiceLedger('Logistics Consulting Fees', 'Sales Accounts', { sac: '998311', rate: 18 })
  .ledger('Office Rent', 'Indirect Expenses').ledger('Software Subscription', 'Indirect Expenses').ledger('Legal Fees', 'Indirect Expenses')
  .ledger('Freight Charges (GTA)', 'Direct Expenses').ledger('Bank Charges', 'Indirect Expenses');

c.party('Konkan Agro Exports Pvt Ltd', 'customer', { stateCode: '27', gstin: G.konkan, city: 'Ratnagiri', pincode: '415612', openingBills: [{ name: 'PFA/2425/140', date: '20250325', amount: 140000 }] })
  .party('Deccan Polymers Ltd', 'customer', { stateCode: '29', gstin: G.deccan, city: 'Mysuru', pincode: '570016' })
  .party('Shirin Estates', 'vendor', { stateCode: '27', city: 'Mumbai', pincode: '400050' }) // unregistered landlord, same state
  .party('Stratus SaaS Inc', 'vendor', { country: 'United States of America', city: 'Seattle', pincode: '98101' }) // overseas, no GSTIN
  .party('STRATUS SAAS  INC', 'vendor', { country: 'United States of America', city: 'Seattle', pincode: '98101' }) // R1
  .party('Rao & Menon Advocates', 'vendor', { stateCode: '29', city: 'Bengaluru', pincode: '560001' }) // unregistered, another state
  .party('Swiftline Roadways', 'vendor', { stateCode: '27', gstin: G.swiftline, city: 'Bhiwandi', pincode: '421302' }) // GTA, registered
  .party('Speedtrack Carriers', 'vendor', { stateCode: '27', regType: 'Regular', city: 'Nagpur', pincode: '440001' }); // R3: registered, no GSTIN

const fees = amount => [{ ledger: 'Logistics Consulting Fees', amount, rate: 18, hsn: '998311' }];
// ---------- sales ----------
c.sale({ number: 'S/001', date: '20250420', party: 'Konkan Agro Exports Pvt Ltd', lines: fees(150000) });
c.sale({ number: 'S/002', date: '20250525', party: 'Deccan Polymers Ltd', lines: fees(200000) });
c.sale({ number: 'S/003', date: '20250818', party: 'Konkan Agro Exports Pvt Ltd', lines: fees(75000) });

// ---------- reverse charge bills ----------
const rcmBill = (o, ledger, amount, rate, hsn, extra = {}) => c.purchase({ ...o, lines: [{ ledger, amount, rate, hsn }], rcm: RCM, ...extra });
rcmBill({ number: 'P/001', date: '20250405', party: 'Shirin Estates', reference: 'RENT-APR-25' }, 'Office Rent', 50000, 18, '997212');
rcmBill({ number: 'P/002', date: '20250505', party: 'Shirin Estates', reference: 'RENT-MAY-25' }, 'Office Rent', 50000, 18, '997212');
rcmBill({ number: 'P/003', date: '20250430', party: 'Stratus SaaS Inc', reference: 'STR-INV-1042' }, 'Software Subscription', 80000, 18, '997331', { inter: true });
rcmBill({ number: 'P/004', date: '20250731', party: 'STRATUS SAAS  INC', reference: 'STR-INV-1121' }, 'Software Subscription', 82000, 18, '997331', { inter: true }); // R1
rcmBill({ number: 'P/005', date: '20250612', party: 'Rao & Menon Advocates', reference: 'RMA/25/033' }, 'Legal Fees', 60000, 18, '998212',
  { tds: { ledger: 'TDS Payable - Others', amount: 6000 } }); // R2
rcmBill({ number: 'P/006', date: '20250620', party: 'Swiftline Roadways', reference: 'SRW-7781' }, 'Freight Charges (GTA)', 24000, 5, '996511');
rcmBill({ number: 'P/007', date: '20250710', party: 'Speedtrack Carriers', reference: 'STC/112' }, 'Freight Charges (GTA)', 16000, 5, '996511'); // R3
// a GTA bill booked without the tax: the reverse charge is raised by journal J/002
c.purchase({ number: 'P/008', date: '20250808', party: 'Swiftline Roadways', reference: 'SRW-7902', lines: [{ ledger: 'Freight Charges (GTA)', amount: 30000 }] });

// ---------- journals: reverse charge raised, paid and set off ----------
c.journal({ number: 'J/002', date: '20250808', narration: 'Reverse charge on GTA bill SRW-7902 (5%)',
  lines: [dr('Input CGST', 750), dr('Input SGST', 750), cr(RCM.CGST, 750), cr(RCM.SGST, 750)] });
c.journal({ number: 'J/003', date: '20250520', narration: 'Reverse charge of April paid from the electronic cash ledger',
  lines: [dr(RCM.CGST, 4500), dr(RCM.SGST, 4500), dr(RCM.IGST, 14400), cr(ECL, 23400)],
  exportPatch: r => { r.allledgerentries[2].amount = '-14000.00'; } }); // R4: the export garbles one amount
c.journal({ number: 'J/004', date: '20250531', narration: 'Input tax credit of April set off against the output tax',
  lines: [dr('Output CGST', 13500), dr('Output SGST', 9900), cr('Input CGST', 4500), cr('Input SGST', 4500), cr('Input IGST', 14400)] });

// ---------- money ----------
const doc = n => c.voucherByNumber(n).meta;
const rupeesOf = p => p / 100;
c.receipt({ number: 'R/001', date: '20250425', party: 'Konkan Agro Exports Pvt Ltd', bank: BANK, amount: 140000, bills: [{ name: 'PFA/2425/140', amount: 140000 }] });
c.receipt({ number: 'R/002', date: '20250515', party: 'Konkan Agro Exports Pvt Ltd', bank: BANK, amount: rupeesOf(doc('S/001').partyAmount), bills: [{ name: 'S/001', amount: rupeesOf(doc('S/001').partyAmount) }] });
c.receipt({ number: 'R/003', date: '20250705', party: 'Deccan Polymers Ltd', bank: BANK, amount: rupeesOf(doc('S/002').partyAmount), bills: [{ name: 'S/002', amount: rupeesOf(doc('S/002').partyAmount) }] });
// a payment of the whole amount owed on one bill (named by the supplier's invoice number)
const owed = ref => rupeesOf(c.vouchers.find(v => v.meta.reference === ref).meta.partyAmount);
const pay = (number, date, party, ref) => c.payment({ number, date, party, bank: BANK, amount: owed(ref), bills: [{ name: ref, amount: owed(ref) }] });
pay('PY/001', '20250408', 'Shirin Estates', 'RENT-APR-25');
pay('PY/002', '20250508', 'Shirin Estates', 'RENT-MAY-25');
pay('PY/003', '20250512', 'Stratus SaaS Inc', 'STR-INV-1042');
c.payment({ number: 'PY/004', date: '20250520', ledger: ECL, bank: BANK, amount: 23400, narration: 'GST challan: reverse charge of April paid in cash' });
pay('PY/005', '20250630', 'Rao & Menon Advocates', 'RMA/25/033');
c.payment({ number: 'PY/006', date: '20250707', ledger: 'TDS Payable - Others', bank: BANK, amount: 6000, narration: 'TDS of June deposited' });
pay('PY/007', '20250715', 'Swiftline Roadways', 'SRW-7781');

export const profile = { ...c.profile, key: 'rcm_heavy', n: 5, description: 'Services firm with reverse charge: unregistered landlord in the state, overseas software vendor (import of services, IGST RCM), advocates and GTA under RCM, RCM paid in cash and set off by journals' };
export const masters = () => c.masters();
export const transactions = () => c.transactions();
export const trialBalance = () => c.trialBalance();
export const builder = c;

const money = p => (p / 100).toFixed(2);
const cents = v => Math.round(Number(String(v ?? '0').replace(/,/g, '') || 0) * 100);
// rate% of an amount in paise, half up (each part of a tax on its own, as Zoho Books does)
const part = (paise, rate) => { const n = paise * Math.round(rate * 100); const s = Math.sign(n); const a = Math.abs(n); const q = Math.floor(a / 10000); return s * (((a % 10000) * 2 >= 10000) ? q + 1 : q); };
const CLEAN_DOCS = ['S/001', 'S/002', 'S/003', 'P/001', 'P/002', 'P/003', 'P/004', 'P/006', 'P/008'];
// the reverse charge bills: the Reverse Charge columns Zoho needs, for each (the two states decide GST or IGST)
const RCM_BILLS = { 'P/001': 'GST', 'P/002': 'GST', 'P/003': 'IGST', 'P/004': 'IGST', 'P/005': 'IGST', 'P/006': 'GST', 'P/007': 'GST' };
export const expect = {
  vouchers: { total: c.vouchers.length, byType: c.stats().byType },
  files: {
    invoices: { clean: ['S/001', 'S/002', 'S/003'], problem: [] },
    bills: { clean: ['P/001', 'P/002', 'P/003', 'P/004', 'P/006', 'P/008'], problem: ['P/005', 'P/007'] },
    journals: { clean: ['J/002', 'J/004'], problem: [] },
    other_journals: { clean: ['R/001', 'R/002', 'R/003', 'PY/001', 'PY/002', 'PY/003', 'PY/004', 'PY/005', 'PY/006', 'PY/007'], problem: [] },
  },
  // never written: the journal whose export does not balance
  notWritten: ['J/003'],
  documents: Object.fromEntries(CLEAN_DOCS.map(n => [n, { file: doc(n).kind === 'sale' ? 'invoices' : 'bills',
    tax: money(doc(n).zohoTax), tallyTax: money(doc(n).tallyTax), partyAmount: money(doc(n).partyAmount), tds: money(doc(n).tds) }])),
  openingTotals: { debit: money(c.openingTotals().debit), credit: money(c.openingTotals().credit) },
  problems: [
    { id: 'R1', what: 'duplicate party names (an overseas vendor, capitals and spacing)', find: { kind: /possible_duplicate/, name: /stratus saas/i } },
    { id: 'R2', what: 'a TDS ledger with no Zoho TDS tax (on a reverse charge bill)', find: { kind: /tds_not_mapped|tds_name_default/, name: /TDS Payable - Others|P\/005/, message: /TDS/ } },
    { id: 'R3', what: 'a registered vendor without GSTIN (a transporter under reverse charge)', find: { kind: /registered_without_gstin|contact_details_corrected/, name: /Speedtrack Carriers/, message: /GSTIN/ } },
    { id: 'R4', what: 'an unbalanced voucher (the reverse charge set-off journal)', find: { name: /J\/003/, message: /balanc|debits and credits differ/i } },
  ],
  mayBeRefused: { bills: ['P/005', 'P/007'] },
  movementFlags: [{ match: /^(Current Liabilities|Duties & Taxes|IGST Payable \(RCM\)|Current Assets|Loans & Advances \(Asset\)|Electronic Cash Ledger \(GST\))$/,
    reason: 'R4: the export of the set-off journal writes 14000.00 where Tally holds 14400.00' }],
  tbDifferences: [
    { match: /^(CGST|SGST|IGST) Payable \(RCM\)$|^Electronic Cash Ledger \(GST\)$/, reason: 'R4: the unbalanced set-off journal is left out of the files' },
    { match: /^Output (IGST|CGST|SGST)$/, reason: 'R4: the reverse charge payable ledgers are entered on Zoho\'s own Output account of their head (rcm_ledger_to_zoho_account: IGST, and since round 2 CGST and SGST too), and their debits in the unbalanced set-off journal are left out' },
  ],
  checks: [
    { id: 'rcm', name: 'every reverse charge bill carries the Reverse Charge columns (GST within the state, IGST between states or from overseas), Zoho\'s reverse charge equals Tally\'s, and the vendor is owed the lines only', run(r, assert) {
      const by = Object.fromEntries(r.vouchers.map(v => [v.number, v]));
      const wrong = [];
      for (const [n, kind] of Object.entries(RCM_BILLS)) {
        const v = by[n], m = doc(n);
        if (v?.fileKey !== 'bills') { if (!expect.files.bills.problem.includes(n)) wrong.push(`${n}: not in the Bills file (${v?.went})`); continue; }
        const rows = r.files.bills.rows.filter(x => x['Bill Number'] === v.documentNumber && x['Vendor Name'] === r.files.bills.rows.find(y => y['Bill Number'] === v.documentNumber)['Vendor Name']);
        let rc = 0, sub = 0;
        for (const x of rows) {
          const amount = Math.round(Number(x.Quantity || 1) * cents(x.Rate));
          sub += amount;
          if (!x['Reverse Charge Tax Name']) { if (amount > 0) wrong.push(`${n}: a line with no Reverse Charge Tax Name`); continue; }
          const rate = Number(x['Reverse Charge Tax Rate']);
          const group = /tax group/i.test(x['Reverse Charge Tax Type']);
          if ((kind === 'GST') !== group) wrong.push(`${n}: reverse charge written as ${x['Reverse Charge Tax Name']} (${x['Reverse Charge Tax Type']}); expected ${kind}`);
          rc += group ? 2 * part(amount, rate / 2) : part(amount, rate);
          if (x['Tax Name'] || Number(x['Tax Percentage'] || 0)) wrong.push(`${n}: the vendor's tax is also written (${x['Tax Name']} ${x['Tax Percentage']})`);
        }
        if (rc !== m.rcmZohoTax || m.rcmZohoTax !== m.rcmTax) wrong.push(`${n}: reverse charge ${money(rc)} in the file, Zoho ${money(m.rcmZohoTax)}, Tally ${money(m.rcmTax)}`);
        const adj = cents(rows[0].Adjustment), tds = cents(rows[0]['TDS Amount']);
        if (sub + adj - tds !== m.partyAmount) wrong.push(`${n}: the vendor is owed ${money(sub + adj - tds)} in the file; Tally ${money(m.partyAmount)}`);
        if (kind === 'IGST' && /Stratus/i.test(m.party) && (rows[0]['GST Treatment'] !== 'overseas' || rows[0]['Source of Supply'])) wrong.push(`${n}: import of services written with GST Treatment "${rows[0]['GST Treatment']}" and Source of Supply "${rows[0]['Source of Supply']}"`);
      }
      assert.deepEqual(wrong, []);
    } },
    { id: 'rcm_journals', name: 'the journals that raise and set off the reverse charge are written as Manual Journals, line for line as in Tally', run(r, assert) {
      const wrong = [];
      for (const n of ['J/002', 'J/004']) {
        const v = r.vouchers.find(x => x.number === n);
        const rows = (r.files[v?.fileKey]?.rows || []).filter(x => x['Reference Number'] === v.documentNumber || `${x['Journal Number Prefix']}${x['Journal Number Suffix']}` === v.documentNumber);
        const tally = c.voucherByNumber(n).meta.postings;
        const written = rows.map(x => cents(x.Credit) - cents(x.Debit)).sort((a, b) => a - b);
        const expected = tally.map(p => p.amount).sort((a, b) => a - b);
        if (JSON.stringify(written) !== JSON.stringify(expected)) wrong.push(`${n}: lines ${written.map(money)}; Tally ${expected.map(money)}`);
      }
      assert.deepEqual(wrong, []);
    } },
  ],
};
