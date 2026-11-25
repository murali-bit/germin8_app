// Company 6: a MULTI-STATE GST company (facility services, Karnataka), FY 2025-26. Every name, GSTIN and amount is MADE UP.
//  - customers in five states: Karnataka (CGST + SGST), Maharashtra, Tamil Nadu, Delhi, Telangana (IGST);
//  - an SEZ customer in the company's own state: a supply to an SEZ is a supply between states, so Tally charges IGST
//    although both are in Karnataka;
//  - the place of supply differs from the billing state: services on immovable property are supplied where the property
//    is. A Telangana customer's Karnataka site (place of supply Karnataka: CGST + SGST), and a Karnataka customer's
//    Kerala site (place of supply Kerala: IGST);
//  - vendors in Gujarat and Kerala (IGST) and Karnataka (CGST + SGST); receipts, payments, journals.
// Deliberate problems (each must be flagged with a plain message, and must not hide a voucher):
//  N1 a GST rate that does not match the amount: S/003 is an 18% service, Tally charged IGST of 12% (the tax overridden);
//  N2 a date outside the financial year: sale S/009 is dated 28 March 2025, the year before (its bill is already in the
//     customer's opening balance, so writing it again would count it twice);
//  N3 an unrecognised ledger: journal J/001 credits "Branch Suspense - Chennai", in Tally's trial balance but missing
//     from the All Masters export;
//  N4 a cancelled voucher: sale S/008 (Tally keeps the number, removes the lines);
//  N5 a paisa rounding difference: S/004 has four 18% lines whose IGST each ends in half a paisa. Tally rounds the tax of
//     the voucher once (5445.36), Zoho Books rounds each line (5445.38): 0.02 apart.
import { company, gstin, cr, dr } from './lib.js';

const c = company({ key: 'multi_state', name: 'Meridian Facility Services Pvt Ltd', stateCode: '29', pan: 'AAHCM2205G', fy: '2025-26' });
const G = {
  brightwater: gstin('29', 'AAJFB5520C'), coastline: gstin('27', 'AADCC8813E'), sundaram: gstin('33', 'AACCS4402F'), capital: gstin('07', 'AAFCC6617H'),
  silicon: gstin('29', 'AAKCS3390J'), godavari: gstin('36', 'AABCG7724K'), nandi: gstin('29', 'AAGCN1185L'),
  ashoka: gstin('24', 'ABMPA2204N'), malabar: gstin('32', 'AAHFM6630P'), garden: gstin('29', 'AAEFG9917Q'),
};
const BANK = 'Lakeside Bank Current A/c';
const FMS = 'Facility Management Services', SEC = 'Security Services';

c.gstLedger('Output CGST', 'CGST', 'output').gstLedger('Output SGST', 'SGST/UTGST', 'output').gstLedger('Output IGST', 'IGST', 'output')
  .gstLedger('Input CGST', 'CGST', 'input').gstLedger('Input SGST', 'SGST/UTGST', 'input').gstLedger('Input IGST', 'IGST', 'input');

c.ledger('Share Capital', 'Capital Account', { cr: 935400 })
  .ledger(BANK, 'Bank Accounts', { dr: 650000, extra: { ifscode: 'LKSB0005120', bankaccholdername: 'Meridian Facility Services Pvt Ltd' } })
  .ledger('Cash', 'Cash-in-Hand', { dr: 25000 })
  .ledger('Office Equipment', 'Fixed Assets', { dr: 180000 })
  .gstServiceLedger(FMS, 'Sales Accounts', { sac: '998533', rate: 18 })
  .gstServiceLedger(SEC, 'Sales Accounts', { sac: '998525', rate: 18 })
  .ledger('Uniforms & Supplies', 'Direct Expenses').ledger('Subcontract Charges', 'Direct Expenses')
  .ledger('Travel Expenses', 'Indirect Expenses').ledger('Bank Charges', 'Indirect Expenses')
  .ledger('Branch Suspense - Chennai', 'Suspense A/c', { inMasters: false }); // N3

c.party('Brightwater Tech Park LLP', 'customer', { stateCode: '29', gstin: G.brightwater, city: 'Bengaluru', pincode: '560103', openingBills: [{ name: 'S/009', date: '20250328', amount: 35400 }] })
  .party('Coastline Hotels Pvt Ltd', 'customer', { stateCode: '27', gstin: G.coastline, city: 'Mumbai', pincode: '400021', openingBills: [{ name: 'MFS/2425/210', date: '20250312', amount: 59000 }] })
  .party('Sundaram Textiles Ltd', 'customer', { stateCode: '33', gstin: G.sundaram, city: 'Tiruppur', pincode: '641601' })
  .party('Capital Square Offices Pvt Ltd', 'customer', { stateCode: '07', gstin: G.capital, city: 'New Delhi', pincode: '110001' })
  .party('Silicon Bay SEZ Developers Ltd', 'customer', { stateCode: '29', gstin: G.silicon, city: 'Bengaluru', pincode: '560066', sez: true })
  .party('Godavari Pharma Ltd', 'customer', { stateCode: '36', gstin: G.godavari, city: 'Hyderabad', pincode: '500032' })
  .party('Nandi Realty Pvt Ltd', 'customer', { stateCode: '29', gstin: G.nandi, city: 'Mysuru', pincode: '570001' })
  .party('Ashoka Uniforms', 'vendor', { stateCode: '24', gstin: G.ashoka, city: 'Surat', pincode: '395002', openingBills: [{ name: 'AU/2425/88', date: '20250326', amount: 14000 }] })
  .party('Malabar Cleaning Co', 'vendor', { stateCode: '32', gstin: G.malabar, city: 'Kochi', pincode: '682011' })
  .party('Garden City Supplies', 'vendor', { stateCode: '29', gstin: G.garden, city: 'Bengaluru', pincode: '560002' });

const line = (ledger, amount) => ({ ledger, amount, rate: 18, hsn: ledger === FMS ? '998533' : '998525' });
// ---------- sales ----------
c.sale({ number: 'S/001', date: '20250410', party: 'Brightwater Tech Park LLP', lines: [line(FMS, 120000)] });
c.sale({ number: 'S/002', date: '20250422', party: 'Coastline Hotels Pvt Ltd', lines: [line(FMS, 80000)] });
c.sale({ number: 'S/003', date: '20250515', party: 'Sundaram Textiles Ltd', lines: [line(SEC, 60000)], tax: { IGST: 7200 } }); // N1: 18% service, 12% charged
c.sale({ number: 'S/004', date: '20250605', party: 'Capital Square Offices Pvt Ltd', lines: [line(FMS, 12500.25), line(SEC, 8400.75), line(FMS, 6250.25), line(SEC, 3100.75)] }); // N5
c.sale({ number: 'S/005', date: '20250618', party: 'Silicon Bay SEZ Developers Ltd', lines: [line(FMS, 150000)], inter: true, narration: 'Supply to an SEZ unit, with payment of IGST' });
c.sale({ number: 'S/006', date: '20250708', party: 'Godavari Pharma Ltd', lines: [line(FMS, 90000)], placeOfSupply: 'Karnataka', narration: 'Facility services at the Bengaluru plant' });
c.sale({ number: 'S/007', date: '20250725', party: 'Nandi Realty Pvt Ltd', lines: [line(FMS, 70000)], placeOfSupply: 'Kerala', narration: 'Facility services at the Kochi property' });
c.sale({ number: 'S/008', date: '20250812', party: 'Coastline Hotels Pvt Ltd', lines: [line(SEC, 40000)], status: 'cancelled' }); // N4
c.sale({ number: 'S/009', date: '20250328', party: 'Brightwater Tech Park LLP', lines: [line(FMS, 30000)] }); // N2: the year before

// ---------- bills ----------
c.purchase({ number: 'P/001', date: '20250418', party: 'Ashoka Uniforms', reference: 'AU/2526/015', lines: [{ ledger: 'Uniforms & Supplies', amount: 20000, rate: 12, hsn: '620342' }] });
c.purchase({ number: 'P/002', date: '20250530', party: 'Malabar Cleaning Co', reference: 'MCC-0451', lines: [{ ledger: 'Subcontract Charges', amount: 45000, rate: 18, hsn: '998533' }] });
c.purchase({ number: 'P/003', date: '20250625', party: 'Garden City Supplies', reference: 'GCS/778', lines: [{ ledger: 'Uniforms & Supplies', amount: 15000, rate: 18, hsn: '340220' }] });

// ---------- journals ----------
c.journal({ number: 'J/001', date: '20250930', lines: [dr('Travel Expenses', 18500), cr('Branch Suspense - Chennai', 18500)], narration: 'Chennai site expenses cleared from branch suspense' }); // N3
c.journal({ number: 'J/002', date: '20251031', lines: [dr('Bank Charges', 354), cr(BANK, 354)] });

// ---------- money ----------
const doc = n => c.voucherByNumber(n).meta;
const rupeesOf = p => p / 100;
const owed = n => rupeesOf(doc(n).partyAmount);
c.receipt({ number: 'R/001', date: '20250510', party: 'Brightwater Tech Park LLP', bank: BANK, amount: owed('S/001'), bills: [{ name: 'S/001', amount: owed('S/001') }] });
c.receipt({ number: 'R/002', date: '20250415', party: 'Coastline Hotels Pvt Ltd', bank: BANK, amount: 59000, bills: [{ name: 'MFS/2425/210', amount: 59000 }] });
c.receipt({ number: 'R/003', date: '20250601', party: 'Coastline Hotels Pvt Ltd', bank: BANK, amount: owed('S/002'), bills: [{ name: 'S/002', amount: owed('S/002') }] });
c.receipt({ number: 'R/004', date: '20250715', party: 'Silicon Bay SEZ Developers Ltd', bank: BANK, amount: owed('S/005'), bills: [{ name: 'S/005', amount: owed('S/005') }] });
c.receipt({ number: 'R/005', date: '20250420', party: 'Brightwater Tech Park LLP', bank: BANK, amount: 35400, bills: [{ name: 'S/009', amount: 35400 }] });
c.payment({ number: 'PY/001', date: '20250425', party: 'Ashoka Uniforms', bank: BANK, amount: 14000, bills: [{ name: 'AU/2425/88', amount: 14000 }] });
c.payment({ number: 'PY/002', date: '20250610', party: 'Malabar Cleaning Co', bank: BANK, amount: owed('P/002'), bills: [{ name: 'MCC-0451', amount: owed('P/002') }] });
c.payment({ number: 'PY/003', date: '20250705', party: 'Garden City Supplies', bank: BANK, amount: owed('P/003'), bills: [{ name: 'GCS/778', amount: owed('P/003') }] });

export const profile = { ...c.profile, key: 'multi_state', n: 6, description: 'Multi-state GST company: customers and vendors in several states (IGST and CGST + SGST), an SEZ customer in the same state (IGST), place of supply different from the billing state' };
export const masters = () => c.masters();
export const transactions = () => c.transactions();
export const trialBalance = () => c.trialBalance();
export const builder = c;

const money = p => (p / 100).toFixed(2);
const CLEAN_DOCS = ['S/001', 'S/002', 'S/005', 'S/006', 'S/007', 'P/001', 'P/002', 'P/003'];
// the states of every clean document: Zoho's Place of Supply (invoices) or Destination of Supply (bills), and the kind
// of tax the two states call for
const STATES_OF = { 'S/001': ['KA', 'GST'], 'S/002': ['MH', 'IGST'], 'S/005': ['KA', 'IGST'], 'S/006': ['KA', 'GST'], 'S/007': ['KL', 'IGST'],
  'P/001': ['KA', 'IGST'], 'P/002': ['KA', 'IGST'], 'P/003': ['KA', 'GST'] };
export const expect = {
  vouchers: { total: c.vouchers.length, byType: c.stats().byType },
  files: {
    invoices: { clean: ['S/001', 'S/002', 'S/005', 'S/006', 'S/007'], problem: ['S/003', 'S/004'] },
    bills: { clean: ['P/001', 'P/002', 'P/003'], problem: [] },
    journals: { clean: ['J/002'], problem: ['J/001'] },
    other_journals: { clean: ['R/001', 'R/002', 'R/003', 'R/004', 'R/005', 'PY/001', 'PY/002', 'PY/003'], problem: [] },
  },
  // never written: the cancelled sale, the sale of the year before (already in the opening balance)
  notWritten: ['S/008', 'S/009'],
  documents: Object.fromEntries(CLEAN_DOCS.map(n => [n, { file: doc(n).kind === 'sale' ? 'invoices' : 'bills',
    tax: money(doc(n).zohoTax), tallyTax: money(doc(n).tallyTax), partyAmount: money(doc(n).partyAmount), tds: money(doc(n).tds) }])),
  rounding: { number: 'S/004', zohoTax: money(doc('S/004').zohoTax), tallyTax: money(doc('S/004').tallyTax) },
  openingTotals: { debit: money(c.openingTotals().debit), credit: money(c.openingTotals().credit) },
  problems: [
    { id: 'N1', what: 'a GST rate that does not match the amount (IGST)', find: { name: /S\/003/, kind: /tax_rate_from_amount|tax_amount_differs/, message: /18%/ } },
    { id: 'N2', what: 'a date outside the financial year (the year before)', find: { kind: /left_out_outside_year/, name: /S\/009/ } },
    { id: 'N3', what: 'an unrecognised ledger', find: { kind: /ledger_missing/, name: /Branch Suspense - Chennai/ } },
    { id: 'N4', what: 'a cancelled voucher', find: { kind: /voucher_cancelled/, name: /S\/008/ } },
    { id: 'N5', what: 'a paisa rounding difference between Tally and Zoho Books (IGST, four lines)', find: { name: /S\/004/, kind: /zoho_recompute|tax_amount_differs/, message: /0\.02/ } },
  ],
  mayBeRefused: { invoices: ['S/003'], journals: ['J/001'] },
  movementFlags: [{ match: /^Suspense A\/c$/, reason: 'N3: the ledger under it is missing from the masters' }],
  tbDifferences: [
    { match: /^Branch Suspense - Chennai$/, reason: 'N3: the ledger is not in the masters, so it is not an account of the files' },
    { match: /^Travel Expenses$/, reason: 'N3: the journal crediting the ledger missing from the masters is refused by Zoho Books (or left out)' },
    { match: /^Output IGST$/, reason: 'N1: Zoho Books works the tax out at the service\'s 18%, Tally charged 12%' },
    { match: /^Accounts Receivable$|^Sundaram Textiles Ltd$/, reason: 'N1: the invoice with the wrong tax is not posted as in Tally' },
  ],
  checks: [
    { id: 'states', name: 'every clean document carries the place of supply Tally gives and the tax its two states call for (CGST + SGST within the state, IGST between states or to an SEZ)', run(r, assert) {
      const by = Object.fromEntries(r.vouchers.map(v => [v.number, v]));
      const wrong = [];
      for (const [n, [place, kind]] of Object.entries(STATES_OF)) {
        const v = by[n];
        const inv = v?.fileKey === 'invoices';
        const rows = (r.files[v?.fileKey]?.rows || []).filter(x => (inv ? x['Invoice Number'] : x['Bill Number']) === v.documentNumber);
        if (!rows.length) { wrong.push(`${n}: no rows`); continue; }
        for (const x of rows) {
          const at = inv ? x['Place of Supply'] : x['Destination of Supply'];
          if (at !== place) wrong.push(`${n}: ${inv ? 'Place of Supply' : 'Destination of Supply'} "${at}", Tally: ${place}`);
          const type = inv ? x['Item Tax Type'] : x['Tax Type'], name = inv ? x['Item Tax'] : x['Tax Name'];
          if ((kind === 'GST') !== /tax group/i.test(type)) wrong.push(`${n}: tax ${name} (${type}); the states call for ${kind}`);
        }
      }
      // no clean document other than the SEZ one (checked on its own below) is flagged as carrying the wrong kind of tax
      const flagged = r.exceptions.filter(e => e.kind === 'tax_type_state_mismatch' && Object.keys(STATES_OF).filter(n => n !== 'S/005').some(n => String(e.name || '').endsWith(` ${n}`)));
      for (const e of flagged) wrong.push(`${e.name}: flagged tax_type_state_mismatch: ${String(e.message).slice(0, 160)}`);
      assert.deepEqual(wrong, []);
    } },
    { id: 'sez', name: 'the SEZ customer and its invoice are written as SEZ (business_sez) with IGST, not flagged as the wrong tax for the states, and not expected to be refused', run(r, assert) {
      const wrong = [];
      const cust = (r.files.customers?.rows || []).find(x => x['Display Name'] === 'Silicon Bay SEZ Developers Ltd');
      if (cust?.['GST Treatment'] !== 'business_sez') wrong.push(`customer: GST Treatment "${cust?.['GST Treatment']}"`);
      const v = r.vouchers.find(x => x.number === 'S/005');
      const rows = r.files.invoices.rows.filter(x => x['Invoice Number'] === v?.documentNumber);
      for (const x of rows) {
        if (x['GST Treatment'] !== 'business_sez') wrong.push(`S/005: GST Treatment "${x['GST Treatment']}"`);
        if (!/^IGST/.test(x['Item Tax'])) wrong.push(`S/005: tax "${x['Item Tax']}"`);
      }
      const refused = r.findings.filter(f => f.File === 'Invoices' && f.Record === v?.documentNumber && f['Zoho is expected to'] !== 'accept the row');
      for (const f of refused) wrong.push(`S/005: Zoho check ${f.Rule}: ${f['Zoho is expected to']}`);
      // IGST is the right tax for a supply to an SEZ in the company's own state: it must not be flagged as a mismatch
      // (the flag tells the accountant to correct the customer's state, which would make the invoice wrong)
      for (const e of r.exceptions.filter(x => x.kind === 'tax_type_state_mismatch' && String(x.name || '').endsWith(' S/005'))) wrong.push(`S/005: flagged tax_type_state_mismatch: ${String(e.message).slice(0, 200)}`);
      assert.deepEqual(wrong, []);
    } },
  ],
};
