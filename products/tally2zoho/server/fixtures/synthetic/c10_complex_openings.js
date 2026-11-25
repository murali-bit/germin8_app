// Company 10: a textile trader with COMPLICATED OPENING BALANCES (Gujarat), FY 2025-26. Every name, GSTIN and amount is
// MADE UP. The opening balances on 1 April 2025 have every awkward shape:
//  - a customer in CREDIT (an advance received, on account), a customer whose opening bills net a debit (an invoice and
//    an advance bill), a vendor in DEBIT (an advance paid), a customer and a vendor with several opening bills;
//  - a bank overdraft (a ledger under Bank OD A/c, in credit), a secured term loan, an unsecured loan from a director;
//  - share capital, securities premium and general reserve; the Profit & Loss A/c in DEBIT (losses brought forward);
//  - a suspense ledger (an unreconciled bank difference, cleared during the year), and "Opening Difference A/c" holding
//    0.62 left over from the previous system (opening and never touched);
//  - ledgers with an opening and NO transaction all year (a fixed deposit, an electricity deposit, the reserves, the
//    provision for income tax, the director's loan);
//  - amounts in paise (an input IGST credit of 2100.15, cash 18240.50, the overdraft 120450.75), GST and TDS payable
//    brought forward, a Stock-in-Hand ledger (books not integrated with inventory);
//  - invoices with round-off, receipts and payments that set off the advances.
// Deliberate problems (each must be flagged with a plain message, and must not hide a voucher):
//  U1 an unrecognised ledger: journal J/004 credits "Director Remuneration Payable", which is in Tally's trial balance
//     but missing from the All Masters export;
//  U2 an unbalanced voucher: journal J/005 balances in Tally, but its export writes the credit line as 9000.00 instead of
//     90000.00;
//  U3 an optional voucher (sale S/004: has lines, Tally does not post it).
import { company, gstin, cr, dr, P } from './lib.js';

const c = company({ key: 'complex_openings', name: 'Oakhaven Textiles Pvt Ltd', stateCode: '24', pan: 'AACCO4417R', fy: '2025-26' });
const G = { indigo: gstin('24', 'AAFCI2207K'), saffron: gstin('27', 'AAKFS6190L'), kesar: gstin('24', 'ABEPK3315M'), loom: gstin('24', 'AADCL8803N'), sutlej: gstin('24', 'AAGFS4482P') };
const BANK = 'Narmada Bank Current A/c';
const OD = 'Narmada Bank OD A/c';

c.gstLedger('Output CGST', 'CGST', 'output', { cr: 5400 }).gstLedger('Output SGST', 'SGST/UTGST', 'output', { cr: 5400 }).gstLedger('Output IGST', 'IGST', 'output')
  .gstLedger('Input CGST', 'CGST', 'input').gstLedger('Input SGST', 'SGST/UTGST', 'input').gstLedger('Input IGST', 'IGST', 'input', { dr: '2100.15' })
  .tdsLedger('TDS on Contractors', 'Payment to Contractors', { cr: 3000 });

c.ledger('Share Capital', 'Capital Account', { cr: 1000000 })
  .ledger('Securities Premium', 'Reserves & Surplus', { cr: 200000 })
  .ledger('General Reserve', 'Reserves & Surplus', { cr: 150000 })
  // Tally's own Profit & Loss A/c (no group): losses brought forward, a DEBIT
  .ledger('Profit & Loss A/c', null, { dr: 85000, extra: { metadata: { type: 'Ledger', name: 'Profit & Loss A/c', reservedname: 'Profit & Loss A/c' } } })
  .ledger('Term Loan - Narmada Bank', 'Secured Loans', { cr: 600000 })
  .ledger('Loan from Director', 'Unsecured Loans', { cr: 250000 })
  .ledger(OD, 'Bank OD A/c', { cr: '120450.75', extra: { ifscode: 'NRMD0000451', bankaccholdername: 'Oakhaven Textiles Pvt Ltd' } })
  .ledger(BANK, 'Bank Accounts', { dr: '618750.47', extra: { ifscode: 'NRMD0000451', bankaccholdername: 'Oakhaven Textiles Pvt Ltd' } })
  .ledger('Cash', 'Cash-in-Hand', { dr: '18240.50' })
  .ledger('Plant & Machinery', 'Fixed Assets', { dr: 900000 })
  .ledger('Furniture & Fixtures', 'Fixed Assets', { dr: 120000 })
  .ledger('Fixed Deposit - Narmada Bank', 'Investments', { dr: 200000 })
  .ledger('Electricity Deposit', 'Deposits (Asset)', { dr: 25000 })
  .ledger('Staff Advance', 'Loans & Advances (Asset)', { dr: 12000 })
  .ledger('Prepaid Insurance', 'Loans & Advances (Asset)', { dr: 9600 })
  .ledger('Stock-in-Trade', 'Stock-in-Hand', { dr: 340000 })
  .ledger('Provision for Expenses', 'Provisions', { cr: 45000 })
  .ledger('Provision for Income Tax', 'Provisions', { cr: 60000 })
  .ledger('Unreconciled Bank Difference', 'Suspense A/c', { dr: '4560.25' })
  .ledger('Opening Difference A/c', 'Suspense A/c', { cr: '0.62' })
  .ledger('Director Remuneration Payable', 'Current Liabilities', { inMasters: false }) // U1: in Tally, missing from the masters export
  .gstServiceLedger('Sales - Fabric', 'Sales Accounts', { sac: '540752', rate: 5 })
  .ledger('Purchase - Yarn', 'Purchase Accounts').ledger('Purchase - Dyes', 'Purchase Accounts')
  .ledger('Interest on OD', 'Indirect Expenses').ledger('Bank Charges', 'Indirect Expenses').ledger('Insurance', 'Indirect Expenses')
  .ledger('Audit Fees', 'Indirect Expenses').ledger('Director Remuneration', 'Indirect Expenses').ledger('Depreciation', 'Indirect Expenses')
  .ledger('Round Off', 'Indirect Expenses', { extra: { roundingmethod: '\u0004 Normal Rounding', roundinglimit: ' 1' } });

c.party('Indigo Threads Pvt Ltd', 'customer', { stateCode: '24', gstin: G.indigo, city: 'Surat', pincode: '395002',
  openingBills: [{ name: 'OT/2425/301', date: '20250210', amount: 118000 }, { name: 'OT/2425/322', date: '20250305', amount: 118000 }] })
  // a customer in CREDIT: an advance received, on account (no bill)
  .party('Saffron Weaves Retail', 'customer', { stateCode: '27', gstin: G.saffron, city: 'Mumbai', pincode: '400002', extraOpening: P(25000) })
  // a customer whose opening bills net a debit: an invoice of 50000 and an advance of 10000 (a bill on the credit side)
  .party('Kesar Garments', 'customer', { stateCode: '24', gstin: G.kesar, city: 'Ahmedabad', pincode: '380001',
    openingBills: [{ name: 'OT/2425/340', date: '20250320', amount: 50000 }, { name: 'ADV-KG-07', date: '20250325', amount: -10000 }] })
  .party('Loomcraft Yarns Pvt Ltd', 'vendor', { stateCode: '24', gstin: G.loom, city: 'Surat', pincode: '395007',
    openingBills: [{ name: 'LY/889', date: '20250212', amount: 118000 }, { name: 'LY/902', date: '20250318', amount: 59000 }] })
  // a vendor in DEBIT: an advance paid, on account
  .party('Sutlej Dyes & Chemicals', 'vendor', { stateCode: '24', gstin: G.sutlej, city: 'Vapi', pincode: '396191', extraOpening: -P(30000) });

// ---------- invoices and bills ----------
const fabric = amount => [{ ledger: 'Sales - Fabric', amount, rate: 5, hsn: '540752' }];
c.sale({ number: 'S/001', date: '20250418', party: 'Indigo Threads Pvt Ltd', lines: fabric(100000) });
c.sale({ number: 'S/002', date: '20250506', party: 'Saffron Weaves Retail', lines: fabric(40000), narration: 'Advance of 25000 received last year to be set off' });
c.sale({ number: 'S/003', date: '20250612', party: 'Kesar Garments', lines: fabric('23456.70'), roundOff: 'Round Off' });
c.sale({ number: 'S/004', date: '20250715', party: 'Indigo Threads Pvt Ltd', lines: fabric(60000), status: 'optional' }); // U3
c.purchase({ number: 'P/001', date: '20250422', party: 'Loomcraft Yarns Pvt Ltd', reference: 'LY/1015', lines: [{ ledger: 'Purchase - Yarn', amount: 80000, rate: 5, hsn: '520512' }] });
c.purchase({ number: 'P/002', date: '20250515', party: 'Sutlej Dyes & Chemicals', reference: 'SDC/25/118', lines: [{ ledger: 'Purchase - Dyes', amount: 50000, rate: 18, hsn: '320416' }] });

// ---------- money: the advances set off, the overdraft, taxes of March ----------
const doc = n => c.voucherByNumber(n).meta;
const rupeesOf = p => p / 100;
c.receipt({ number: 'R/001', date: '20250430', party: 'Indigo Threads Pvt Ltd', bank: BANK, amount: 236000, bills: [{ name: 'OT/2425/301', amount: 118000 }, { name: 'OT/2425/322', amount: 118000 }] });
// the invoice of 50000 less the advance bill of 10000 (both set off by this receipt)
c.receipt({ number: 'R/002', date: '20250525', party: 'Kesar Garments', bank: BANK, amount: 40000, bills: [{ name: 'OT/2425/340', amount: 50000 }, { name: 'ADV-KG-07', amount: -10000 }] });
// the customer in credit pays the invoice less the advance it had paid
c.receipt({ number: 'R/003', date: '20250528', party: 'Saffron Weaves Retail', bank: BANK, amount: rupeesOf(doc('S/002').partyAmount) - 25000 });
c.payment({ number: 'PY/001', date: '20250502', party: 'Loomcraft Yarns Pvt Ltd', bank: BANK, amount: 177000, bills: [{ name: 'LY/889', amount: 118000 }, { name: 'LY/902', amount: 59000 }] });
// the vendor in debit is paid the bill less the advance it had received
c.payment({ number: 'PY/002', date: '20250601', party: 'Sutlej Dyes & Chemicals', bank: BANK, amount: rupeesOf(doc('P/002').partyAmount) - 30000 });
c.payment({ number: 'PY/003', date: '20250410', ledger: 'TDS on Contractors', bank: BANK, amount: 3000, narration: 'TDS of March deposited' });
c.voucher('Payment', 'PY/004', '20250420', [dr('Output CGST', 5400), dr('Output SGST', 5400), { ledger: BANK, amount: P(10800), bank: { favouring: 'GST Portal', mode: 'e-Fund Transfer' } }],
  { narration: 'GST of March paid', meta: { kind: 'payment', amount: P(10800) } });
c.payment({ number: 'PY/005', date: '20250720', ledger: 'Provision for Expenses', bank: BANK, amount: 45000, narration: 'Audit fee of last year paid' });
c.contra({ number: 'C/001', date: '20250510', from: BANK, to: OD, amount: 100000, narration: 'Overdraft reduced' });

// ---------- journals ----------
c.journal({ number: 'J/001', date: '20250630', lines: [dr('Interest on OD', '3215.40'), cr(OD, '3215.40')], narration: 'Interest on overdraft, April to June' });
c.journal({ number: 'J/002', date: '20250731', lines: [dr('Bank Charges', '4560.25'), cr('Unreconciled Bank Difference', '4560.25')], narration: 'Suspense of last year cleared: bank charges not booked' });
c.journal({ number: 'J/003', date: '20250930', lines: [dr('Insurance', 4800), cr('Prepaid Insurance', 4800)], narration: 'Insurance of April to September' });
c.journal({ number: 'J/004', date: '20251031', lines: [dr('Director Remuneration', 50000), cr('Director Remuneration Payable', 50000)], narration: 'Remuneration of October provided for' }); // U1
c.journal({ number: 'J/005', date: '20251130', lines: [dr('Depreciation', 90000), cr('Plant & Machinery', 90000)], narration: 'Depreciation for the half year',
  exportPatch: r => { r.allledgerentries[1].amount = '9000.00'; } }); // U2: the export garbles one amount

export const profile = { ...c.profile, key: 'complex_openings', n: 10, description: 'Complicated opening balances: customers in credit, vendors in debit, bank overdraft, loans, capital and reserves, suspense, P&L brought forward, opening-only ledgers, paise and round-offs' };
export const masters = () => c.masters();
export const transactions = () => c.transactions();
export const trialBalance = () => c.trialBalance();
export const builder = c;

const money = p => (p / 100).toFixed(2);
const cents = v => Math.round(Number(String(v ?? '0').replace(/,/g, '') || 0) * 100);
const CLEAN_DOCS = ['S/001', 'S/002', 'S/003', 'P/001', 'P/002'];
const openingOf = name => c.ledgers.get(name).opening; // paise, Tally sign (debit negative)
export const expect = {
  vouchers: { total: c.vouchers.length, byType: c.stats().byType },
  files: {
    invoices: { clean: ['S/001', 'S/002', 'S/003'], problem: [] },
    bills: { clean: ['P/001', 'P/002'], problem: [] },
    journals: { clean: ['J/001', 'J/002', 'J/003'], problem: ['J/004'] },
    other_journals: { clean: ['R/001', 'R/002', 'R/003', 'PY/001', 'PY/002', 'PY/003', 'PY/004', 'PY/005', 'C/001'], problem: [] },
  },
  // never written: the optional sale, the unbalanced journal
  notWritten: ['S/004', 'J/005'],
  documents: Object.fromEntries(CLEAN_DOCS.map(n => [n, { file: doc(n).kind === 'sale' ? 'invoices' : 'bills',
    tax: money(doc(n).zohoTax), tallyTax: money(doc(n).tallyTax), partyAmount: money(doc(n).partyAmount), tds: money(doc(n).tds) }])),
  // the opening totals of Tally's report as it shows them: each top-level group netted (a customer in credit or a vendor in
  // debit is netted inside its group)
  openingTotals: (() => { let d = 0, k = 0; for (const l of c.trialBalance().dspaccbody.dspaccline) { const v = Math.round((l.dspaccinfo[0].dspopamt.dspopamta || 0) * 100); if (v < 0) d -= v; else k += v; } return { debit: money(d), credit: money(k) }; })(),
  problems: [
    { id: 'U1', what: 'an unrecognised ledger', find: { kind: /ledger_missing/, name: /Director Remuneration Payable/ } },
    { id: 'U2', what: 'an unbalanced voucher', find: { name: /J\/005/, message: /balanc|debits and credits differ/i } },
    { id: 'U3', what: 'an optional voucher', find: { kind: /voucher_optional|left_out_optional/, name: /S\/004/ } },
  ],
  mayBeRefused: { journals: ['J/004'] },
  movementFlags: [
    { match: /^(Fixed Assets|Plant & Machinery)$/, reason: 'U2: the export of the journal writes 9000.00 where Tally holds 90000.00' },
    { match: /^Current Liabilities$/, reason: 'U1: the ledger under it is missing from the masters' },
  ],
  tbDifferences: [
    { match: /^Director Remuneration Payable$/, reason: 'U1: the ledger is not in the masters, so it is not an account of the files' },
    { match: /^Director Remuneration$/, reason: 'U1: the journal crediting the ledger missing from the masters is refused by Zoho Books (or left out)' },
    { match: /^Depreciation$|^Plant & Machinery$/, reason: 'U2: the unbalanced journal is left out of the files' },
  ],
  // company-specific invariants (run by companies.test.js as "<label>: <name>"; id is the KNOWN_BUGS key "check:<id>")
  checks: [
    { id: 'unusual_openings', name: 'a customer in credit and a vendor in debit keep their opening balance, on the right side, with the contact named', run(r, assert) {
      const wrong = [];
      const ob = r.files.opening_balances_for_zoho_accounts?.rows || [];
      const line = (account, contact) => ob.filter(x => x.Account === account && x['Contact Name'] === contact);
      // the customer in credit: Accounts Receivable credited with the customer named (or its Opening Balance in the Customers file, never both)
      for (const [contact, account, side, file] of [['Saffron Weaves Retail', 'Accounts Receivable', 'Credit', 'customers'], ['Sutlej Dyes & Chemicals', 'Accounts Payable', 'Debit', 'vendors']]) {
        const want = Math.abs(openingOf(contact));
        const inJournal = line(account, contact).reduce((t, x) => t + cents(x[side]) - cents(x[side === 'Credit' ? 'Debit' : 'Credit']), 0);
        const contactRow = (r.files[file]?.rows || []).find(x => x['Display Name'] === contact);
        if (!contactRow) wrong.push(`${contact}: not in the ${file} file`);
        if (contactRow && cents(contactRow['Opening Balance'])) wrong.push(`${contact}: Opening Balance ${contactRow['Opening Balance']} in the ${file} file (the side would be lost)`);
        if (inJournal !== want) wrong.push(`${contact}: ${money(inJournal)} ${side} on ${account} in the opening balance journal; Tally ${money(want)} ${side}`);
      }
      // the customer whose opening bills net a debit: its net balance in the Customers file
      const kesar = (r.files.customers?.rows || []).find(x => x['Display Name'] === 'Kesar Garments');
      if (cents(kesar?.['Opening Balance']) !== Math.abs(openingOf('Kesar Garments'))) wrong.push(`Kesar Garments: Opening Balance ${kesar?.['Opening Balance']}; Tally ${money(Math.abs(openingOf('Kesar Garments')))} debit`);
      assert.deepEqual(wrong, []);
    } },
    { id: 'every_opening', name: 'every opening balance of Tally (overdraft, loans, reserves, provisions, suspense, paise, opening-only ledgers) is in the opening balance journal or a master file, on its side', run(r, assert) {
      const wrong = [];
      const ob = r.files.opening_balances_for_zoho_accounts?.rows || [];
      const acc = r.files.accounts?.rows || [];
      for (const [name, l] of c.ledgers) {
        if (!l.opening || !l.inMasters || l.kind || l.parent === 'Duties & Taxes') continue; // contacts: unusual_openings and the TB; taxes: Zoho's own accounts
        const want = -l.opening; // debit positive
        // Tally's Profit & Loss A/c: Zoho Books keeps the profit or loss of earlier years in its own Retained Earnings
        const account = name === 'Profit & Loss A/c' ? 'Retained Earnings' : name;
        const j = ob.filter(x => x.Account === account).reduce((t, x) => t + cents(x.Debit) - cents(x.Credit), 0);
        const row = acc.find(x => x['Account Name'] === name);
        const a = row && cents(row['Opening Balance']) ? cents(row['Opening Balance']) * (/debit/i.test(row['Debit or Credit']) ? 1 : -1) : 0;
        if (j + a !== want) wrong.push(`${name}: ${money(j + a)} written (journal ${money(j)}, chart of accounts ${money(a)}); Tally ${money(want)} (debit positive)`);
      }
      assert.deepEqual(wrong, [], 'opening balances not carried as Tally has them');
    } },
  ],
};
