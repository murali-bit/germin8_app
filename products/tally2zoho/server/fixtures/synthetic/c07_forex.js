// Company 7: an importer and exporter of IoT devices kept in FOREIGN CURRENCIES (Karnataka), FY 2025-26. Every name,
// GSTIN and amount is MADE UP. Company 4 (exporter) covers dollar invoices to one customer; this company covers the rest:
//  - customers AND vendors kept in euros (€) and US dollars ($), with foreign-currency OPENING balances (opening bills in
//    the currency, at the rate of 31 March 2025), and a dollar EEFC bank account with a dollar opening balance;
//  - export invoices in euros and dollars (under LUT: zero-rated, no GST), import bills in dollars and euros (no GST on
//    the supplier's invoice: the IGST of an import is paid at customs), one domestic invoice and one domestic bill in rupees;
//  - receipts in foreign currency (euros into the rupee account; dollars into the dollar EEFC account), payments in
//    foreign currency (dollars from the EEFC account, euros from the rupee account), a dollar-to-rupee conversion
//    (contra), and the exchange gain / loss journals that clear the rupee difference left on each party.
// ASSUMED SHAPE (lib.js forexText): a line, bill or opening balance of a ledger kept in another currency carries Tally's
// text "-€6000.00 @ ₹92.40/€ = -₹554400.00" (the XML form; no real JSON export with a foreign-currency ledger has been
// seen). The exchange gain / loss line on a party is a plain rupee amount (Tally's forex adjustment has no foreign amount).
// Deliberate problems (each must be flagged with a plain message, and must not hide a voucher):
//  F1 duplicate party names: "Nordlicht Systeme GmbH" and "NORDLICHT SYSTEME  GMBH" (capitals, two spaces), both in euros;
//  F2 a voucher naming a party that is not in the masters: import bill IM/003 from "Pacific Tern Components LLC" (a
//     dollar vendor in Tally's trial balance, missing from All Masters);
//  F3 a paisa rounding difference: export invoice EX/003 has two lines of €1010.10 at ₹92.15. Tally converts each line
//     (93080.715 -> 93080.72, twice: 186161.44); Zoho Books converts the invoice total (€2020.20 x 92.15 = 186161.43):
//     0.01 apart when the invoice is written in euros.
import { company, gstin, cr, dr, P, fxToPaise, forexText } from './lib.js';

const c = company({ key: 'forex', name: 'Ardent Lynx Technologies Pvt Ltd', stateCode: '29', pan: 'AAICA5528D', fy: '2025-26' });
const G = { kaveri: gstin('29', 'AAFCK7720P'), malnad: gstin('29', 'AAGCM3391Q') };
const BANK = 'Cauvery Bank Current A/c';
const EEFC = 'EEFC USD A/c - Cauvery Bank';
const FX = 'Forex Gain/Loss';
const NL = 'Nordlicht Systeme GmbH', NL2 = 'NORDLICHT SYSTEME  GMBH', BW = 'Brightwater Instruments Inc';
const SZ = 'Shenzhen Brightpath Electronics Co', AK = 'Alpenglow Komponenten AG', PT = 'Pacific Tern Components LLC';
const MARCH_RATE = { '$': 85.40, '€': 92.40 }; // the rates of 31 March 2025, at which the opening balances stand

c.gstLedger('Output CGST', 'CGST', 'output').gstLedger('Output SGST', 'SGST/UTGST', 'output').gstLedger('Output IGST', 'IGST', 'output')
  .gstLedger('Input CGST', 'CGST', 'input').gstLedger('Input SGST', 'SGST/UTGST', 'input').gstLedger('Input IGST', 'IGST', 'input');
c.currency('$', { code: 'USD', name: 'US Dollar' }).currency('€', { code: 'EUR', name: 'Euro' });

// a dollar EEFC account with a dollar opening balance: $8000 at 85.40
const eefcOpening = fxToPaise(8000, MARCH_RATE.$);
c.ledger('Share Capital', 'Capital Account', { cr: 2000000 })
  .ledger(BANK, 'Bank Accounts', { dr: 0, extra: { ifscode: 'CAUV0001207', bankaccholdername: 'Ardent Lynx Technologies Pvt Ltd' } })
  .ledger(EEFC, 'Bank Accounts', { openingPaise: -eefcOpening, currency: '$', openingText: forexText(-eefcOpening, { symbol: '$', amount: 8000, rate: MARCH_RATE.$ }),
    extra: { ifscode: 'CAUV0001207', bankaccholdername: 'Ardent Lynx Technologies Pvt Ltd' } })
  .ledger('Testing Equipment', 'Fixed Assets', { dr: 350000 })
  .gstServiceLedger('Export Sales', 'Sales Accounts', { sac: '851762' }) // exported under LUT: no GST rate on the ledger
  .gstServiceLedger('Domestic Sales', 'Sales Accounts', { sac: '851762', rate: 18 })
  .ledger('Purchase - Imported Components', 'Purchase Accounts').ledger('Freight & Clearing', 'Direct Expenses')
  .ledger(FX, 'Indirect Expenses').ledger('Bank Charges', 'Indirect Expenses');

// A party kept in another currency, with opening bills in that currency at the March rate. party() takes the opening
// bills in rupees; the master's opening balance and opening bills are then written as Tally writes a foreign amount.
function forexParty(name, kind, symbol, { country, city, pincode, bills = [], inMasters = true }) {
  const rate = MARCH_RATE[symbol];
  c.party(name, kind, { country, currency: symbol, city, pincode, inMasters, openingBills: bills.map(b => ({ name: b.name, date: b.date, amount: fxToPaise(b.fx, rate) / 100 })) });
  if (!inMasters || !bills.length) return;
  const rec = c.masterRecords[c.masterRecords.length - 1];
  const sign = kind === 'customer' ? -1 : 1;
  const total = bills.reduce((t, b) => t + b.fx, 0);
  rec.openingbalance = forexText(c.ledgers.get(name).opening, { symbol, amount: total, rate });
  rec.billallocations.forEach((a, i) => { a.openingbalance = forexText(sign * fxToPaise(bills[i].fx, rate), { symbol, amount: bills[i].fx, rate }); });
}
forexParty(NL, 'customer', '€', { country: 'Germany', city: 'Hamburg', pincode: '20095', bills: [{ name: 'AL/2425/041', date: '20250228', fx: 6000 }] });
forexParty(NL2, 'customer', '€', { country: 'Germany', city: 'Hamburg', pincode: '20095' }); // F1
forexParty(BW, 'customer', '$', { country: 'United States of America', city: 'Boston', pincode: '02110', bills: [{ name: 'AL/2425/017', date: '20250315', fx: 4500 }] });
forexParty(SZ, 'vendor', '$', { country: 'China', city: 'Shenzhen', pincode: '518000', bills: [{ name: 'SBE-8812', date: '20250320', fx: 3200 }] });
forexParty(AK, 'vendor', '€', { country: 'Switzerland', city: 'Basel', pincode: '4051' });
forexParty(PT, 'vendor', '$', { country: 'United States of America', city: 'Portland', pincode: '97201', inMasters: false }); // F2
c.party('Kaveri Retail Pvt Ltd', 'customer', { stateCode: '29', gstin: G.kaveri, city: 'Bengaluru', pincode: '560034' })
  .party('Malnad Logistics Pvt Ltd', 'vendor', { stateCode: '29', gstin: G.malnad, city: 'Bengaluru', pincode: '560058' });
// the rupee account's opening: whatever ties the opening balances (a plain rupee figure)
{
  let t = 0; for (const l of c.ledgers.values()) t += l.opening;
  const bank = c.ledgers.get(BANK); bank.opening = -t;
  const rec = c.masterRecords.find(r => r.metadata?.type === 'Ledger' && r.metadata.name === BANK); rec.openingbalance = `-${(t / 100).toFixed(2)}`;
}

// ---------- foreign-currency documents: every line of the voucher in the party's currency at the rate of the day ----------
const fxOf = (symbol, amount, rate) => ({ symbol, amount, rate });
// lines: [{ ledger, fx }]; Tally converts each line; the party line takes the total of the lines (the voucher balances in rupees)
function forexDoc(kind, { number, date, party, symbol, rate, lines, reference, narration }) {
  const sale = kind === 'sale', sgn = sale ? 1 : -1;
  const conv = lines.map(l => ({ ...l, inr: fxToPaise(l.fx, rate) }));
  const fxTotal = Math.round(conv.reduce((t, l) => t + P(l.fx), 0)) / 100, inr = conv.reduce((t, l) => t + l.inr, 0);
  const ref = reference || number, f = fxOf(symbol, fxTotal, rate);
  return c.voucher(sale ? 'Sales' : 'Purchase', number, date, [
    { ledger: party, amount: -sgn * inr, party: true, forex: f, bills: [{ name: ref, type: 'New Ref', amount: -sgn * inr, forex: f }] },
    ...conv.map(l => ({ ledger: l.ledger, amount: sgn * l.inr, forex: fxOf(symbol, l.fx, rate) })),
  ], { view: 'invoice', party, rated: true, narration, ...(reference ? { reference } : {}),
    meta: { kind, party, subtotal: inr, tallyTax: 0, zohoTax: 0, tds: 0, partyAmount: inr, gross: inr, reference: ref,
      forex: { symbol, code: symbol === '$' ? 'USD' : 'EUR', fx: fxTotal, rate, inr, zohoInr: fxToPaise(fxTotal, rate) } } });
}
forexDoc('sale', { number: 'EX/001', date: '20250512', party: NL, symbol: '€', rate: 91.80, lines: [{ ledger: 'Export Sales', fx: 8500 }], narration: 'Gateways, batch 7' });
forexDoc('sale', { number: 'EX/002', date: '20250620', party: NL2, symbol: '€', rate: 92.00, lines: [{ ledger: 'Export Sales', fx: 3000 }] }); // F1
forexDoc('sale', { number: 'EX/003', date: '20250624', party: NL, symbol: '€', rate: 92.15, lines: [{ ledger: 'Export Sales', fx: 1010.10 }, { ledger: 'Export Sales', fx: 1010.10 }] }); // F3
forexDoc('sale', { number: 'EX/004', date: '20250708', party: BW, symbol: '$', rate: 85.95, lines: [{ ledger: 'Export Sales', fx: 6200 }] });
forexDoc('purchase', { number: 'IM/001', date: '20250425', party: SZ, symbol: '$', rate: 85.60, lines: [{ ledger: 'Purchase - Imported Components', fx: 5000 }], reference: 'SBE-9031' });
forexDoc('purchase', { number: 'IM/002', date: '20250610', party: AK, symbol: '€', rate: 91.95, lines: [{ ledger: 'Purchase - Imported Components', fx: 2400 }], reference: 'AK-2025-118' });
forexDoc('purchase', { number: 'IM/003', date: '20250702', party: PT, symbol: '$', rate: 85.70, lines: [{ ledger: 'Purchase - Imported Components', fx: 1800 }], reference: 'PTC-551' }); // F2
// rupee documents
c.sale({ number: 'D/001', date: '20250602', party: 'Kaveri Retail Pvt Ltd', lines: [{ ledger: 'Domestic Sales', amount: 150000, rate: 18, hsn: '851762' }] });
c.purchase({ number: 'P/001', date: '20250428', party: 'Malnad Logistics Pvt Ltd', reference: 'ML/0428', lines: [{ ledger: 'Freight & Clearing', amount: 20000, rate: 18, hsn: '996511' }] });

// ---------- money in foreign currency, and the exchange differences ----------
// a party line and a bank line in the party's currency at the rate of the day; the bank line in rupees for the rupee account
function forexMoney(type, { number, date, party, symbol, fx, rate, bank, bill, narration }) {
  const inr = fxToPaise(fx, rate), f = fxOf(symbol, fx, rate);
  const into = type === 'Receipt';
  const bankForex = bank === EEFC ? f : undefined;
  return c.voucher(type, number, date, [
    { ledger: bank, amount: into ? -inr : inr, forex: bankForex, bank: { favouring: party, mode: 'Others' } },
    { ledger: party, amount: into ? inr : -inr, party: true, forex: f, bills: [{ name: bill, type: 'Agst Ref', amount: into ? inr : -inr, forex: f }] },
  ], { party, narration, meta: { kind: into ? 'receipt' : 'payment', party, amount: inr, forex: { symbol, fx, rate, inr } } });
}
// the rupee difference left on a party once its foreign balance is settled: a journal against Forex Gain/Loss
const fxJournal = (number, date, party, paise, narration) => c.journal({ number, date, narration,
  lines: paise > 0 ? [{ ledger: party, amount: -paise, party: true }, { ledger: FX, amount: paise }] : [{ ledger: FX, amount: paise }, { ledger: party, amount: -paise, party: true }] });
forexMoney('Receipt', { number: 'R/001', date: '20250530', party: NL, symbol: '€', fx: 6000, rate: 92.70, bank: BANK, bill: 'AL/2425/041' });
fxJournal('FX/001', '20250530', NL, fxToPaise(6000, 92.70) - fxToPaise(6000, MARCH_RATE['€']), 'Exchange gain on AL/2425/041');
forexMoney('Receipt', { number: 'R/002', date: '20250805', party: BW, symbol: '$', fx: 4500, rate: 86.10, bank: EEFC, bill: 'AL/2425/017' });
fxJournal('FX/002', '20250805', BW, fxToPaise(4500, 86.10) - fxToPaise(4500, MARCH_RATE.$), 'Exchange gain on AL/2425/017');
forexMoney('Payment', { number: 'PY/001', date: '20250520', party: SZ, symbol: '$', fx: 3200, rate: 85.80, bank: EEFC, bill: 'SBE-8812' });
fxJournal('FX/003', '20250520', SZ, -(fxToPaise(3200, 85.80) - fxToPaise(3200, MARCH_RATE.$)), 'Exchange loss on SBE-8812');
forexMoney('Payment', { number: 'PY/002', date: '20250625', party: AK, symbol: '€', fx: 2400, rate: 92.30, bank: BANK, bill: 'AK-2025-118' });
fxJournal('FX/004', '20250625', AK, -(fxToPaise(2400, 92.30) - fxToPaise(2400, 91.95)), 'Exchange loss on AK-2025-118');
c.receipt({ number: 'R/003', date: '20250715', party: 'Kaveri Retail Pvt Ltd', bank: BANK, amount: 177000, bills: [{ name: 'D/001', amount: 177000 }] });
c.payment({ number: 'PY/003', date: '20250505', party: 'Malnad Logistics Pvt Ltd', bank: BANK, amount: 23600, bills: [{ name: 'ML/0428', amount: 23600 }] });
// dollars sold from the EEFC account into the rupee account
{
  const inr = fxToPaise(2000, 86.00);
  c.voucher('Contra', 'C/001', '20250901', [{ ledger: BANK, amount: -inr }, { ledger: EEFC, amount: inr, forex: fxOf('$', 2000, 86.00), bank: { favouring: 'Self' } }],
    { narration: 'USD 2000 converted at 86.00', meta: { kind: 'contra', amount: inr, forex: { symbol: '$', fx: 2000, rate: 86.00, inr } } });
}

export const profile = { ...c.profile, key: 'forex', n: 7, description: 'Importer and exporter kept in euros and dollars: foreign-currency customers and vendors with foreign opening bills, a dollar EEFC account, receipts and payments in foreign currency, exchange gain / loss journals' };
export const masters = () => c.masters();
export const transactions = () => c.transactions();
export const trialBalance = () => c.trialBalance();
export const builder = c;

const doc = n => c.voucherByNumber(n).meta;
const money = p => (p / 100).toFixed(2);
const cents = v => Math.round(Number(String(v ?? '0').replace(/,/g, '') || 0) * 100);
const byNumber = r => Object.fromEntries(r.vouchers.map(v => [v.number, v]));
const CLEAN_DOCS = ['D/001', 'P/001'];
const FOREX_DOCS = ['EX/001', 'EX/003', 'EX/004', 'IM/001', 'IM/002'];
const FOREX_MONEY = ['R/001', 'R/002', 'PY/001', 'PY/002', 'C/001'];
const FOREX_PARTIES = [[NL, 'customers', '€'], [BW, 'customers', '$'], [SZ, 'vendors', '$']];
const journalRows = (r, v) => (r.files[v.fileKey]?.rows || []).filter(x => x['Reference Number'] === v.documentNumber || `${x['Journal Number Prefix'] || ''}${x['Journal Number Suffix'] || ''}` === v.documentNumber);
// the rupee value of a foreign document as written: in rupees, or in the currency at the rate written
function writtenValue(r, n) {
  const v = byNumber(r)[n], inv = v.fileKey === 'invoices';
  const rows = (r.files[v.fileKey]?.rows || []).filter(x => (inv ? x['Invoice Number'] : x['Bill Number']) === v.documentNumber);
  if (!rows.length) return null;
  const code = rows[0]['Currency Code'] || 'INR', xr = Number(rows[0]['Exchange Rate'] || 1);
  const value = rows.reduce((t, x) => t + Math.round(Number(x.Quantity || 1) * cents(inv ? x['Item Price'] : x.Rate)), 0);
  return { code, xr, value, inr: code === 'INR' ? value : Math.round(value * xr) };
}
export const expect = {
  vouchers: { total: c.vouchers.length, byType: c.stats().byType },
  files: {
    invoices: { clean: ['EX/001', 'EX/003', 'EX/004', 'D/001'], problem: ['EX/002'] },
    bills: { clean: ['IM/001', 'IM/002', 'P/001'], problem: ['IM/003'] },
    journals: { clean: ['FX/001', 'FX/002'], problem: [] },
    other_journals: { clean: ['R/001', 'R/002', 'R/003', 'PY/001', 'PY/002', 'PY/003', 'C/001'], problem: [] },
  },
  // the exchange loss on a vendor (the vendor credited, Forex Gain/Loss debited) may be written as a journal naming the vendor,
  // or as a bill of the vendor for that amount: both post the same amounts
  anyOf: { 'FX/003': ['journals', 'bills'], 'FX/004': ['journals', 'bills'] },
  notWritten: [],
  documents: Object.fromEntries(CLEAN_DOCS.map(n => [n, { file: doc(n).kind === 'sale' ? 'invoices' : 'bills',
    tax: money(doc(n).zohoTax), tallyTax: money(doc(n).tallyTax), partyAmount: money(doc(n).partyAmount), tds: money(doc(n).tds) }])),
  // the opening totals of Tally's report as it shows them: each top-level group netted (a customer in credit or a vendor in
  // debit is netted inside its group)
  openingTotals: (() => { let d = 0, k = 0; for (const l of c.trialBalance().dspaccbody.dspaccline) { const v = Math.round((l.dspaccinfo[0].dspopamt.dspopamta || 0) * 100); if (v < 0) d -= v; else k += v; } return { debit: money(d), credit: money(k) }; })(),
  problems: [
    { id: 'F1', what: 'duplicate party names (capitals, spacing), in euros', find: { kind: /possible_duplicate/, name: /nordlicht/i } },
    { id: 'F2', what: 'an import bill names a party that is not in the masters', find: { kind: /party_missing|ledger_missing/, name: /Pacific Tern Components LLC/ } },
    { id: 'F3', what: 'a paisa rounding difference between Tally and Zoho Books (Tally converts each line, Zoho the total)', find: { name: /EX\/003/, message: /0\.01|round/i },
      // written in rupees at Tally's value, the invoice has no difference to flag
      noFlagNeededIf: r => { const w = byNumber(r)['EX/003']?.fileKey === 'invoices' ? writtenValue(r, 'EX/003') : null; return !!w && w.code === 'INR' && w.inr === doc('EX/003').forex.inr; } },
  ],
  mayBeRefused: { invoices: ['EX/002'], bills: ['IM/003'] },
  movementFlags: [{ match: /^(Current Liabilities|Sundry Creditors)$/, reason: 'F2: the vendor missing from the masters is in the group in Tally, not in the masters' }],
  tbDifferences: [
    { match: /^Pacific Tern Components LLC$/, reason: 'F2: the vendor is not in the masters, so its bill cannot reach Zoho Books' },
    { match: /^Accounts Payable$|^Purchase - Imported Components$/, reason: 'F2: the bill of the vendor missing from the masters' },
    { match: /^Accounts Receivable$|^Nordlicht Systeme GmbH$|^Export Sales$/, reason: 'F3: Zoho Books converts the euro invoice total, Tally each line (0.01), when the invoice is written in euros' },
  ],
  // company-specific invariants (run by companies.test.js as "<label>: <name>"; id is the KNOWN_BUGS key "check:<id>")
  checks: [
    { id: 'forex_documents', name: 'every euro and dollar invoice and bill reaches its Zoho file at Tally\'s rupee value (or in its currency at Tally\'s rate)', run(r, assert) {
      const by = byNumber(r), wrong = [];
      for (const n of FOREX_DOCS) {
        const v = by[n], m = doc(n).forex, file = doc(n).kind === 'sale' ? 'invoices' : 'bills';
        if (v?.fileKey !== file) { wrong.push(`${n}: must be written to ${file}, went: ${v?.went}${v?.reason ? ` (${v.reason})` : ''}`); continue; }
        const w = writtenValue(r, n);
        if (!w) { wrong.push(`${n}: no rows in ${file}`); continue; }
        if (w.code !== 'INR' && (w.code !== m.code || w.xr !== m.rate)) wrong.push(`${n}: written in ${w.code} at ${w.xr}; Tally has ${m.code} at ${m.rate}`);
        const want = w.code === 'INR' ? m.inr : m.zohoInr; // in the currency, Zoho converts the total (F3)
        if (w.inr !== want) wrong.push(`${n}: rupee value ${money(w.inr)}; Tally ${money(m.inr)}`);
      }
      assert.deepEqual(wrong, [], 'foreign-currency documents not written as Tally holds them');
    } },
    { id: 'forex_money', name: 'every receipt, payment and conversion in foreign currency reaches the journal files at Tally\'s rupee value', run(r, assert) {
      const by = byNumber(r), wrong = [];
      for (const n of FOREX_MONEY) {
        const v = by[n], m = doc(n).forex;
        if (v?.fileKey !== 'other_journals') { wrong.push(`${n}: must be written to other_journals, went: ${v?.went}${v?.reason ? ` (${v.reason})` : ''}`); continue; }
        const rows = journalRows(r, v);
        // a journal written in the currency: Zoho converts each line at its Exchange Rate (the rupee value is what is checked)
        const inr = (x, k) => ((x.Currency || 'INR') === 'INR' ? cents(x[k]) : Math.round(cents(x[k]) * Number(x['Exchange Rate'])));
        const debit = rows.reduce((t, x) => t + inr(x, 'Debit'), 0), credit = rows.reduce((t, x) => t + inr(x, 'Credit'), 0);
        if (debit !== m.inr || credit !== m.inr) wrong.push(`${n}: debits ${money(debit)} credits ${money(credit)}; Tally ${money(m.inr)}`);
      }
      assert.deepEqual(wrong, []);
    } },
    { id: 'forex_openings', name: 'every foreign-currency opening balance (euro and dollar customers and vendors, the dollar EEFC account) reaches Zoho Books at Tally\'s rupee value (or in its currency at Tally\'s rate)', run(r, assert) {
      const wrong = [];
      for (const [name, file, symbol] of FOREX_PARTIES) {
        const want = Math.abs(c.ledgers.get(name).opening);
        const row = (r.files[file]?.rows || []).find(x => x['Display Name'] === name);
        if (!row) { wrong.push(`${name}: not in the ${file} file`); continue; }
        const code = row['Currency Code'] || 'INR', xr = Number(row['Opening Balance Exchange Rate'] || 1);
        const written = code === 'INR' ? cents(row['Opening Balance']) : Math.round(cents(row['Opening Balance']) * xr);
        if (code !== 'INR' && (code !== (symbol === '$' ? 'USD' : 'EUR') || xr !== MARCH_RATE[symbol])) wrong.push(`${name}: opening written in ${code} at ${xr}`);
        if (written !== want) wrong.push(`${name}: opening ${money(written)} written (${code} "${row['Opening Balance']}"); Tally ${money(want)}`);
      }
      const ob = r.files.opening_balances_for_zoho_accounts?.rows || [];
      const eefc = ob.filter(x => x.Account === EEFC).reduce((t, x) => t + cents(x.Debit) - cents(x.Credit), 0)
        + cents((r.files.accounts?.rows || []).find(x => x['Account Name'] === EEFC)?.['Opening Balance']);
      if (eefc !== eefcOpening) wrong.push(`${EEFC}: opening ${money(eefc)} written; Tally ${money(eefcOpening)}`);
      assert.deepEqual(wrong, [], 'foreign-currency opening balances not carried as Tally holds them');
    } },
    { id: 'forex_contacts', name: 'a party kept in euros or dollars is written with its currency code (Zoho Books needs it to take invoices, bills and payments in that currency)', run(r, assert) {
      const wrong = [];
      for (const [name, file, symbol] of [...FOREX_PARTIES, [NL2, 'customers', '€'], [AK, 'vendors', '€']]) {
        const row = (r.files[file]?.rows || []).find(x => x['Display Name'] === name);
        const want = symbol === '$' ? 'USD' : 'EUR';
        if (!row) wrong.push(`${name}: not in the ${file} file`);
        else if (row['Currency Code'] !== want) wrong.push(`${name}: Currency Code "${row['Currency Code']}", Tally keeps it in ${want}`);
      }
      assert.deepEqual(wrong, []);
    } },
  ],
};
