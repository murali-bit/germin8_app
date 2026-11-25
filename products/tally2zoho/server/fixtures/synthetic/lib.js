// A small builder for MADE-UP Tally companies, in the STRUCTURE of real TallyPrime 7.1 JSON exports.
//
// Every company built here is fictional: names, GSTINs (right format, real state codes, invented PAN parts, a correct
// check character), addresses and amounts are invented. The shapes copy what a real TallyPrime 7.1 export writes (see
// server/fixtures/allMasters.js, server/fixtures/allTransactions.js and sample-data/README.txt):
//  - All Masters: one "tallymessage" list, every master type mixed; names in metadata.name and languagename; Tally's
//    own groups carry their reserved name and the top-level ones have no parent; ledgers carry dated lists
//    (ledmailingdetails, ledgstregdetails), opening balances as text in Tally's sign (a DEBIT is NEGATIVE) and the
//    opening bills of a bill-wise party (billallocations); GST duty ledgers name their head ("CGST", "SGST/UTGST",
//    "IGST"); TDS duty ledgers carry taxtype "TDS" and their nature of payment (tdsratename); stock items carry
//    baseunits, opening quantity / value / rate and dated gstdetails / hsndetails; Unit, Godown, Stock Group and
//    Voucher Type records are mixed in.
//  - All Transactions: every voucher of the year in one "tallymessage" list; metadata { type: "Voucher", vchtype, ... };
//    dates "YYYYMMDD"; lines in "allledgerentries" (accounting view) or "ledgerentries" + "allinventoryentries"
//    (invoice view); every GST line lists the rate of every duty head (ratedetails), as real exports do; bill-wise and
//    bank allocations; the status flags iscancelled / isoptional / isdeleted.
//  - Trial Balance: the Tally REPORT (dspaccbody > dspaccline > dspaccname / dspaccinfo / grpexplosion), figures as JSON
//    numbers in Tally's sign (debit negative, the debit column negative), {} for a column with no figure.
//
// THE TRIAL BALANCE IS COMPUTED, never typed: opening balances of the masters + every voucher Tally posts (not
// cancelled, optional or deleted, of a voucher type that posts to ledgers, dated inside the financial year), so it
// always ties to the vouchers. A problem can be put into the EXPORTED record only (exportPatch): the trial balance then
// still follows what Tally holds, exactly as when a real export loses or garbles something.
//
// Money is kept in paise (integers): no floating point.

export const NA = '\u0004 Not Applicable';
export const ANY = '\u0004 Any';
const L = (...v) => [{ metadata: true, type: 'String' }, ...v];
const lang = name => [{ name: L(name), languageid: ' 1033' }];
const clone = o => JSON.parse(JSON.stringify(o));

// ---------- money ----------
// P('1180.50') -> 118050 paise; P(1180.5) -> 118050.
export function P(x) {
  if (typeof x === 'number') return Math.round(x * 100);
  const s = String(x).replace(/,/g, '').trim();
  const neg = s.startsWith('-');
  const [a, b = ''] = s.replace(/^[-+]/, '').split('.');
  return (neg ? -1 : 1) * (Number(a || 0) * 100 + Number((b + '00').slice(0, 2)));
}
// 118050 -> "1180.50"; -118050 -> "-1180.50" (Tally's text form)
export function fmt(p) {
  const a = Math.abs(p);
  return `${p < 0 ? '-' : ''}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}
export const rupees = p => p / 100;
// ---------- foreign currency (added for company 4; additive: nothing else uses it) ----------
// An amount in a foreign currency at a rate of exchange, in rupee paise, rounded half up to the paisa, in integers:
// fxToPaise(3250.50, 85.95) -> 27938048 (Rs 279380.48). The rate may have up to four decimals.
export function fxToPaise(fxAmount, rate) {
  const n = P(fxAmount) * Math.round(rate * 10000); // foreign cents x rate x 10000
  const sign = n < 0 ? -1 : 1, a = Math.abs(n);
  const q = Math.floor(a / 10000), r = a % 10000;
  return sign * (r * 2 >= 10000 ? q + 1 : q);
}
// The text Tally writes for an amount on a ledger kept in a foreign currency: the foreign amount, the rate of exchange
// and the rupee value, in Tally's sign (a debit negative): "-$5000.00 @ ₹85.40/$ = -₹427000.00".
// ASSUMED SHAPE: this is the form of Tally's XML export of a foreign-currency amount; the real TallyPrime 7.1 JSON
// exports in the project have no foreign-currency ledger, so the JSON form is not confirmed.
// fx: { symbol: '$', amount (foreign units, positive), rate (rupees per unit) }; paise: the rupee value in Tally's sign.
export function forexText(paise, fx) {
  const neg = paise < 0 ? '-' : '';
  return `${neg}${fx.symbol}${fmt(P(Math.abs(fx.amount)))} @ ₹${Number(fx.rate).toFixed(2)}/${fx.symbol} = ${neg}₹${fmt(Math.abs(paise))}`;
}
// paise x rate% rounded half up to the paisa, in integers (rate may have two decimals: 2.5, 0.25)
export function pct(paise, rate) {
  const n = paise * Math.round(rate * 100); // paise x rate x 100
  const sign = n < 0 ? -1 : 1, a = Math.abs(n);
  const q = Math.floor(a / 10000), r = a % 10000;
  return sign * (r * 2 >= 10000 ? q + 1 : q);
}

// ---------- GSTIN ----------
const CH = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export function gstinCheck(first14) {
  let sum = 0;
  for (let i = 0; i < 14; i++) { const p = CH.indexOf(first14[i]) * (i % 2 ? 2 : 1); sum += Math.floor(p / 36) + (p % 36); }
  return CH[(36 - (sum % 36)) % 36];
}
// gstin('29', 'BLUFN4821K') -> a 15-character GSTIN with a correct check character. The PAN part is made up.
export const gstin = (stateCode, pan, entity = '1') => { const b = `${stateCode}${pan}${entity}Z`; return b + gstinCheck(b); };
export const STATES = { '07': 'Delhi', 24: 'Gujarat', 27: 'Maharashtra', 29: 'Karnataka', 32: 'Kerala', 33: 'Tamil Nadu', 36: 'Telangana' };
// ---------- Tally's own groups and voucher types ----------
const STANDARD_GROUPS = [
  ['Capital Account', null], ['Reserves & Surplus', 'Capital Account'], ['Loans (Liability)', null], ['Bank OD A/c', 'Loans (Liability)'],
  ['Secured Loans', 'Loans (Liability)'], ['Unsecured Loans', 'Loans (Liability)'], ['Current Liabilities', null], ['Duties & Taxes', 'Current Liabilities'],
  ['Provisions', 'Current Liabilities'], ['Sundry Creditors', 'Current Liabilities'], ['Fixed Assets', null], ['Investments', null], ['Current Assets', null],
  ['Stock-in-Hand', 'Current Assets'], ['Deposits (Asset)', 'Current Assets'], ['Loans & Advances (Asset)', 'Current Assets'], ['Sundry Debtors', 'Current Assets'],
  ['Cash-in-Hand', 'Current Assets'], ['Bank Accounts', 'Current Assets'], ['Branch / Divisions', null], ['Misc. Expenses (ASSET)', null], ['Suspense A/c', null],
  ['Sales Accounts', null], ['Purchase Accounts', null], ['Direct Incomes', null], ['Direct Expenses', null], ['Indirect Incomes', null], ['Indirect Expenses', null],
];
const TB_ORDER = ['Capital Account', 'Loans (Liability)', 'Current Liabilities', 'Fixed Assets', 'Investments', 'Current Assets', 'Branch / Divisions', 'Misc. Expenses (ASSET)',
  'Suspense A/c', 'Sales Accounts', 'Purchase Accounts', 'Direct Incomes', 'Direct Expenses', 'Indirect Incomes', 'Indirect Expenses'];
const OWN_VOUCHER_TYPES = ['Sales', 'Purchase', 'Receipt', 'Payment', 'Journal', 'Contra', 'Debit Note', 'Credit Note', 'Memorandum', 'Stock Journal', 'Reversing Journal',
  'Delivery Note', 'Receipt Note', 'Physical Stock'];
// Tally types that never post to ledgers: their vouchers are not in the trial balance.
export const NON_POSTING_TYPES = new Set(['memorandum', 'stock journal', 'reversing journal', 'delivery note', 'receipt note', 'physical stock', 'sales order', 'purchase order']);

const STATUS_FLAGS = { isdeleted: false, isoptional: false, iscancelled: false, isonhold: false, isvoid: false, ispostdated: false, isgstoverridden: false, iseligibleforitc: true,
  isvatdutypaid: true, hascashflow: false, isinvoice: false, vchgststatusisincluded: true, vchgststatusisuncertain: false, vchgststatusisapplicable: true,
  vchstatusisoptional: false, vchstatusiscancelled: false, vchstatusisdeleted: false, vchstatusisopeningbalance: false };

// The GST rate details of a line, as a real export writes them: every duty head with its rate (CGST and SGST half
// the rate, IGST the whole rate), Cess not applicable, State Cess with no rate.
export function rateDetails(rate) {
  const half = String(rate / 2).replace(/\.0$/, '');
  return [
    { gstratedutyhead: 'CGST', gstratevaluationtype: 'Based on Value', gstrate: ` ${half}` },
    { gstratedutyhead: 'SGST/UTGST', gstratevaluationtype: 'Based on Value', gstrate: ` ${half}` },
    { gstratedutyhead: 'IGST', gstratevaluationtype: 'Based on Value', gstrate: ` ${rate}` },
    { gstratedutyhead: 'Cess', gstratevaluationtype: NA },
    { gstratedutyhead: 'State Cess', gstratevaluationtype: 'Based on Value' },
  ];
}

// line helpers for journal-style vouchers: amounts in rupees; dr() is negative (Tally's sign)
export const dr = (ledger, amount, extra = {}) => ({ ledger, amount: -Math.abs(P(amount)), ...extra });
export const cr = (ledger, amount, extra = {}) => ({ ledger, amount: Math.abs(P(amount)), ...extra });

let companyNo = 0;

export function company(profile) { return new Company(profile); }

export class Company {
  // profile: { key, name, stateCode, pan, fy ('2025-26'), gstin? (made from stateCode + pan when not given) }
  constructor(profile) {
    const fy = profile.fy || '2025-26';
    const y = Number(fy.slice(0, 4));
    const gstinValue = profile.gstin ?? (profile.pan ? gstin(profile.stateCode, profile.pan) : '');
    this.profile = { ...profile, fy, gstin: gstinValue, state: STATES[profile.stateCode] || profile.state || '' };
    this.fyFrom = `${y}0401`; this.fyTo = `${y + 1}0331`; this.booksFrom = this.fyFrom;
    // a year that does not start on 1 April (profile.fyStartMonth 1..12, for example 1 for January to December): Tally
    // allows any start; the year is the twelve months from the first day of that month
    if (profile.fyStartMonth && Number(profile.fyStartMonth) !== 4) {
      const sm = Number(profile.fyStartMonth), endY = sm === 1 ? y : y + 1, endM = sm === 1 ? 12 : sm - 1;
      this.fyFrom = `${y}${String(sm).padStart(2, '0')}01`;
      this.fyTo = `${endY}${String(endM).padStart(2, '0')}${new Date(Date.UTC(endY, endM, 0)).getUTCDate()}`;
      this.booksFrom = this.fyFrom;
    }
    this.tag = (++companyNo).toString(16).padStart(4, '0');
    this.n = 0;
    this.masterRecords = [];   // in export order
    this.groups = new Map();   // name -> { parent, reserved }
    this.ledgers = new Map();  // name -> { parent, opening (paise, Tally sign), inMasters, kind }
    this.items = new Map();    // name -> { unit, hsn, rate, openingQty, openingValue }
    this.vouchers = [];        // { record (as Tally holds it), exported (as the export writes it), meta }
    this.taxLedgers = { output: {}, input: {} };
    for (const [g, parent] of STANDARD_GROUPS) this.group(g, parent, { reserved: g });
    for (const t of OWN_VOUCHER_TYPES) this.voucherType(t);
  }

  guid() { return `5f1c0de0-${this.tag}-4a11-9e55-${String(++this.n).padStart(12, '0')}`; }

  // ---------- masters ----------
  group(name, parent = null, { reserved = '' } = {}) {
    this.groups.set(name, { parent, reserved });
    this.masterRecords.push({ metadata: { type: 'Group', name, reservedname: reserved }, guid: this.guid(), isbillwiseon: false, iscostcentreson: false, isaddable: false,
      isdeleted: false, isrevenue: false, affectsgrossprofit: false, isdeemedpositive: false, sortposition: ' 100', alterid: ' 7', languagename: lang(name), ...(parent ? { parent } : {}) });
    return this;
  }

  // opening: rupees, as { dr } or { cr }, or a signed paise amount via openingPaise. inMasters false: the ledger is in
  // Tally (and its trial balance) but missing from the All Masters export.
  // currency: the symbol of a currency() for a ledger kept in another currency; openingText: the opening balance as
  // Tally writes it when it is not a plain rupee amount (a foreign amount, forexText); a bill may carry text likewise.
  ledger(name, parent, { dr: d, cr: c, openingPaise, inMasters = true, extra = {}, bills, billwise = false, currency, openingText } = {}) {
    const opening = openingPaise ?? (d ? -P(d) : c ? P(c) : 0);
    this.ledgers.set(name, { parent, opening, inMasters, ...(currency ? { currency } : {}) });
    if (!inMasters) return this;
    const rec = { metadata: { type: 'Ledger', name, reservedname: '' }, oldauditentryids: L(' -1'), startingfrom: this.booksFrom, guid: this.guid(),
      currencyname: currency || '₹', taxtype: 'Others', taxclassificationname: NA, gsttype: '', appropriatefor: NA, isbillwiseon: !!(bills || billwise), iscostcentreson: false,
      isdeleted: false, affectsstock: false, isgstapplicable: false, istdsapplicable: false, sortposition: ' 1000', alterid: ' 12', languagename: lang(name),
      ...(parent ? { parent } : {}), ...(opening ? { openingbalance: openingText || fmt(opening) } : {}), ...extra };
    if (bills?.length) {
      const total = bills.reduce((t, b) => t + b.amount, 0);
      if (total !== opening) throw new Error(`${name}: the opening bills (${fmt(total)}) do not add up to the opening balance (${fmt(opening)})`);
      rec.billallocations = bills.map(b => ({ billdate: b.date, name: b.name, billcreditperiod: '30 Days', isadvance: false, openingbalance: b.text || fmt(b.amount) }));
    }
    this.masterRecords.push(rec);
    return this;
  }

  // A customer or vendor. kind 'customer' | 'vendor'; regType 'Regular' | 'Unregistered/Consumer' | 'Composition';
  // stateCode: the party's state; gstin: '' for none. openingBills: [{ name, date, amount (rupees, positive) }] (the
  // opening balance is their total: a customer's on the debit side, a vendor's on the credit side).
  // Added for companies 4-6 (additive, the defaults write what they wrote before): country (a party outside India: no
  // state is written), currency (Tally's symbol of the ledger's currency, for example '$'; the rupee '₹' by default) and
  // sez (Tally's "Is SEZ party" flag, issezparty).
  party(name, kind, { stateCode, gstin: g = '', regType = g ? 'Regular' : 'Unregistered/Consumer', pan = '', city = 'Sample City', pincode = '560001',
    openingBills = [], extraOpening = 0, inMasters = true, parent, country = 'India', currency, sez = false } = {}) {
    const state = STATES[stateCode] || '';
    const sign = kind === 'customer' ? -1 : 1;
    const bills = openingBills.map(b => ({ name: b.name, date: b.date, amount: sign * P(b.amount) }));
    const opening = bills.reduce((t, b) => t + b.amount, 0) + extraOpening;
    const st = state ? { state } : {};
    const extra = {
      gstregistrationtype: regType, countryofresidence: country, ...(state ? { priorstatename: state } : {}), isgstapplicable: true,
      ...(g ? { partygstin: g } : {}), ...(pan ? { incometaxnumber: pan } : {}), ...(currency ? { currencyname: currency } : {}), ...(sez ? { issezparty: true } : {}),
      ledgstregdetails: [{ applicablefrom: this.booksFrom, gstregistrationtype: regType, ...st, ...(state ? { placeofsupply: state } : {}), ...(g ? { gstin: g } : {}), istransporter: false, iscommonparty: false }],
      ledmailingdetails: [{ applicablefrom: this.booksFrom, mailingname: name, address: L(`${10 + this.n} Example Road`, city), ...st, country, pincode }],
    };
    this.ledger(name, parent || (kind === 'customer' ? 'Sundry Debtors' : 'Sundry Creditors'),
      { openingPaise: opening, inMasters, extra, billwise: true, bills: bills.length ? bills.map(b => ({ ...b })) : undefined });
    const l = this.ledgers.get(name);
    l.kind = kind; l.stateCode = stateCode; l.gstin = g; l.regType = regType; l.country = country; l.currency = currency || null; l.sez = !!sez;
    if (inMasters && bills.length && extraOpening) throw new Error(`${name}: give the opening as bills or as an amount, not both`);
    return this;
  }

  // A GST duty ledger. head 'CGST' | 'SGST/UTGST' | 'IGST'; side 'output' | 'input'.
  // opts: an opening balance as for ledger() ({ cr: 4500 } for GST payable brought forward).
  gstLedger(name, head, side, opts = {}) {
    const key = head.startsWith('SGST') ? 'SGST' : head;
    this.taxLedgers[side][key] = name;
    return this.ledger(name, 'Duties & Taxes', { ...opts, extra: { taxtype: 'GST', gstdutyhead: head, roundingmethod: '\u0004 Normal Rounding', ...(opts.extra || {}) } });
  }
  // A TDS duty ledger. nature: Tally's nature of payment as written ("194J", "Commission", or ANY for none).
  tdsLedger(name, nature, opts = {}) {
    return this.ledger(name, 'Duties & Taxes', { ...opts, extra: { taxtype: 'TDS', tdsratename: nature, ...(opts.extra || {}) } });
  }
  // An income or expense ledger with GST details (services: the SAC on the ledger, as Tally keeps it).
  gstServiceLedger(name, parent, { sac, rate } = {}) {
    return this.ledger(name, parent, { extra: { isgstapplicable: true, gsttypeofsupply: 'Services',
      ...(sac ? { hsndetails: [{ applicablefrom: this.booksFrom, srcofhsndetails: 'Specify Details Here', hsncode: sac }] } : {}),
      ...(rate ? { gstdetails: [{ applicablefrom: this.booksFrom, srcofgstdetails: 'Specify Details Here', taxability: 'Taxable', statewisedetails: [{ statename: ANY, ratedetails: rateDetails(rate) }] }] } : {}) } });
  }

  unit(name, { full = name, uqc = 'NOS-NUMBERS', decimals = 0 } = {}) {
    this.masterRecords.push({ metadata: { type: 'Unit', name, reservedname: '' }, guid: this.guid(), issimpleunit: true, isgstexcluded: false, decimalplaces: ` ${decimals}`,
      originalname: full, gstrepuom: uqc, alterid: ' 9' });
    return this;
  }
  godown(name) { this.masterRecords.push({ metadata: { type: 'Godown', name, reservedname: '' }, guid: this.guid(), hasnospace: false, hasnostock: false, isexternal: false, isinternal: false, languagename: lang(name) }); return this; }
  stockGroup(name) { this.masterRecords.push({ metadata: { type: 'Stock Group', name, reservedname: '' }, guid: this.guid(), isaddable: true, languagename: lang(name) }); return this; }

  // A stock item. openingQty and openingRate (rupees): the opening value is their product, on the debit side.
  item(name, { unit, hsn, rate, group, openingQty = 0, openingRate = 0 } = {}) {
    const openingValue = -Math.round(openingQty * P(openingRate));
    this.items.set(name, { unit, hsn, rate, openingQty, openingValue });
    this.masterRecords.push({ metadata: { type: 'Stock Item', name, reservedname: '' }, oldauditentryids: L(' -1'), guid: this.guid(), ...(group ? { parent: group } : {}),
      category: NA, gstapplicable: '\u0004 Applicable', taxclassificationname: NA, gsttypeofsupply: 'Goods', baseunits: unit, additionalunits: NA,
      isbatchwiseon: false, ignoregodowns: false, alterid: ' 21', denominator: ' 1',
      ...(openingQty ? { openingbalance: ` ${openingQty} ${unit}`, openingvalue: fmt(openingValue), openingrate: `${fmt(P(openingRate))}/${unit}` } : {}),
      gstdetails: [{ applicablefrom: this.booksFrom, srcofgstdetails: 'Specify Details Here', taxability: 'Taxable', isreversechargeapplicable: false, isnongstgoods: false,
        statewisedetails: [{ statename: ANY, ratedetails: rateDetails(rate) }] }],
      hsndetails: [{ applicablefrom: this.booksFrom, srcofhsndetails: 'Specify Details Here', hsncode: hsn }],
      languagename: lang(name) });
    return this;
  }

  voucherType(name, parent = name) {
    const own = parent === name;
    this.masterRecords.push({ metadata: { type: 'Voucher Type', name, reservedname: own ? name : '' }, guid: this.guid(), parent, mailingname: name, numberingmethod: 'Automatic',
      isdeemedpositive: false, affectsstock: false, isactive: true, isoptional: false, languagename: lang(name) });
    return this;
  }

  // A Currency master (added for company 4): symbol is the name Tally gives it ('$'), code its formal name ('USD').
  currency(symbol, { code, name = code, decimals = 2 } = {}) {
    this.masterRecords.push({ metadata: { type: 'Currency', name: symbol, reservedname: '' }, guid: this.guid(), mailingname: name, expandedsymbol: code, decimalsymbol: 'cent',
      originalname: symbol, issuffix: false, hasspacebetweenamountandsymbol: false, decimalplaces: ` ${decimals}`, inmillions: true, alterid: ' 30' });
    return this;
  }

  // ---------- vouchers ----------
  // lines: [{ ledger, amount (paise, Tally sign), party, bills: [{ name, type, amount (paise) }], bank, rate, hsn, typeOfSupply, extra }]
  // opts: { view 'accounting' | 'invoice', party, narration, reference, referenceDate, status 'cancelled' | 'optional' |
  //   'deleted', inventory: [{ item, qty, price (rupees), amount (paise, Tally sign), ledger, godown, rate, hsn }],
  //   inventoryIn / inventoryOut (stock journal), exportPatch(record) -> changes the EXPORTED copy only, meta: {...} }
  voucher(type, number, date, lines = [], opts = {}) {
    const id = this.guid();
    const view = opts.view || 'accounting';
    const viewName = view === 'invoice' ? 'Invoice Voucher View' : 'Accounting Voucher View';
    const toLine = l => {
      const neg = l.amount < 0;
      const out = { oldauditentryids: L(' -1'), appropriatefor: NA, ledgername: l.ledger, gstclass: NA, isdeemedpositive: neg, ledgerfromitem: false, removezeroentries: false,
        ispartyledger: !!l.party, gstoverridden: false, islastdeemedpositive: neg, amount: l.forex ? forexText(l.amount, l.forex) : fmt(l.amount) };
      if (l.rate != null) {
        Object.assign(out, { gstovrdntypeofsupply: l.typeOfSupply || 'Services', gstrateinferapplicability: 'As per Masters/Company', gsthsninferapplicability: 'As per Masters/Company',
          ...(l.hsn ? { hsnsourcetype: 'Ledger', gsthsnname: l.hsn } : {}), ratedetails: rateDetails(l.rate) });
      }
      if (l.bills) out.billallocations = l.bills.map(b => ({ name: b.name, billtype: b.type, tdsdeducteeisspecialrate: false, amount: b.forex ? forexText(b.amount, b.forex) : fmt(b.amount) }));
      if (l.bank) {
        out.bankallocations = [{ date, instrumentdate: date, name: l.bank.instrument || `CHQ-${number}`, transactiontype: l.bank.mode || 'Cheque', paymentfavouring: l.bank.favouring || '',
          uniquereferencenumber: `UTR${String(this.n).padStart(8, '0')}`, status: false, paymentmode: 'Transacted', bankpartyname: l.bank.favouring || '', isconnectedpayment: false,
          issplit: false, amount: fmt(l.amount) }];
      }
      return { ...out, ...(l.extra || {}) };
    };
    const inv = (opts.inventory || []).map(i => {
      const neg = i.amount < 0;
      const unit = this.items.get(i.item)?.unit || 'nos';
      const qty = ` ${i.qty} ${unit}`;
      return { stockitemname: i.item, isdeemedpositive: neg, islastdeemedpositive: neg, isautonegate: false, rate: `${fmt(P(i.price))}/${unit}`, amount: fmt(i.amount), actualqty: qty, billedqty: qty,
        ...(i.hsn ? { gsthsnname: i.hsn } : {}), ...(i.rate != null ? { ratedetails: rateDetails(i.rate) } : {}),
        batchallocations: [{ godownname: i.godown || 'Main Location', batchname: 'Primary Batch', destinationgodownname: i.godown || 'Main Location', amount: fmt(i.amount), actualqty: qty, billedqty: qty }],
        accountingallocations: [{ oldauditentryids: L(' -1'), ledgername: i.ledger, gstclass: NA, isdeemedpositive: neg, ledgerfromitem: false, removezeroentries: false, ispartyledger: false, amount: fmt(i.amount) }] };
    });
    const stockLines = (list, inward) => (list || []).map(i => {
      const unit = this.items.get(i.item)?.unit || 'nos';
      const amount = Math.round(i.qty * P(i.price)) * (inward ? -1 : 1);
      const qty = ` ${i.qty} ${unit}`;
      return { stockitemname: i.item, isdeemedpositive: inward, rate: `${fmt(P(i.price))}/${unit}`, amount: fmt(amount), actualqty: qty, billedqty: qty,
        batchallocations: [{ godownname: i.godown || 'Main Location', batchname: 'Primary Batch', amount: fmt(amount), actualqty: qty, billedqty: qty }] };
    });
    const status = opts.status || null;
    const p = this.profile;
    const partyLedger = opts.party ? this.ledgers.get(opts.party) : null;
    const record = {
      metadata: { type: 'Voucher', remoteid: id, vchkey: `${id}-00000001:00000008`, vchtype: type, action: 'Create', objview: viewName },
      oldauditentryids: L(' -1'), date, vchstatusdate: date, guid: id, vouchertypename: type,
      gstregistration: { value: `${p.state} Registration`, taxtype: 'GST', taxregistration: p.gstin },
      cmpgstin: p.gstin, cmpgstregistrationtype: 'Regular', cmpgststate: p.state,
      ...(opts.party ? { partyledgername: opts.party, partyname: opts.party, basicbuyername: opts.party, partymailingname: opts.party } : {}),
      ...(partyLedger?.gstin ? { partygstin: partyLedger.gstin } : {}),
      // the party's state; the place of supply: the customer's state on a sale, the company's own state on a purchase (where
      // the goods or services are received), as Tally fills it in by default
      ...(partyLedger?.stateCode ? { statename: STATES[partyLedger.stateCode], placeofsupply: opts.placeOfSupply || STATES[partyLedger.stateCode], countryofresidence: 'India' } : {}),
      // a party outside India (party({ country })): its country, and the place of supply only when one is given (added for companies 4-6)
      ...(partyLedger && !partyLedger.stateCode && partyLedger.country && partyLedger.country !== 'India'
        ? { countryofresidence: partyLedger.country, ...(opts.placeOfSupply ? { placeofsupply: opts.placeOfSupply } : {}) } : {}),
      ...(opts.party ? { gstregistrationtype: partyLedger?.regType || (partyLedger?.gstin ? 'Regular' : 'Unregistered/Consumer') } : {}),
      vouchernumber: number, numberingstyle: 'Auto Retain', persistedview: viewName, vchstatustaxadjustment: 'Default', vchstatusvouchertype: type, vchgstclass: NA,
      vchentrymode: view === 'invoice' ? (inv.length ? 'Item Invoice' : 'Accounting Invoice') : 'As Voucher', effectivedate: date,
      ...STATUS_FLAGS, isinvoice: view === 'invoice',
      ...(status === 'cancelled' ? { iscancelled: true, vchstatusiscancelled: true } : {}),
      ...(status === 'optional' ? { isoptional: true, vchstatusisoptional: true } : {}),
      ...(status === 'deleted' ? { isdeleted: true, vchstatusisdeleted: true } : {}),
      alterid: ` ${100 + this.n}`, masterid: ` ${50 + this.n}`, voucherkey: String(190000000000000 + this.n * 8), vouchernumberseries: 'Default',
      ...(opts.reference ? { reference: opts.reference, referencedate: opts.referenceDate || date } : {}),
      ...(opts.narration ? { narration: opts.narration } : {}),
      ...((opts.rated || inv.length) ? { gst: [{ purposetype: 'GST', stat: [{ purposetype: 'GST', statkey: '\u0004 Auto Stat Number', isfetchedonly: false, isdeleted: false, tallycontentuser: [] }] }] } : {}),
    };
    // a cancelled voucher: Tally keeps the number and removes the lines
    const lineRecords = status === 'cancelled' ? [] : lines.map(toLine);
    if (lineRecords.length) record[view === 'invoice' ? 'ledgerentries' : 'allledgerentries'] = lineRecords;
    if (status !== 'cancelled' && inv.length) record.allinventoryentries = inv;
    if (opts.inventoryIn) record.inventoryentriesin = stockLines(opts.inventoryIn, true);
    if (opts.inventoryOut) record.inventoryentriesout = stockLines(opts.inventoryOut, false);
    const exported = clone(record);
    if (opts.exportPatch) opts.exportPatch(exported);
    // what Tally posts: every ledger line and every accounting allocation of an item line (the record as Tally holds it)
    const postings = status === 'cancelled' ? [] : [...lines.map(l => ({ ledger: l.ledger, amount: l.amount })), ...(opts.inventory || []).map(i => ({ ledger: i.ledger, amount: i.amount }))];
    const sum = postings.reduce((t, x) => t + x.amount, 0);
    if (sum !== 0 && !opts.allowUnbalanced) throw new Error(`${type} ${number}: the lines do not balance (${fmt(sum)})`);
    const posts = !status && !NON_POSTING_TYPES.has(type.toLowerCase()) && date >= this.fyFrom && date <= this.fyTo;
    const v = { record, exported, meta: { type, number, date, posts, status, postings, ...(opts.meta || {}) } };
    this.vouchers.push(v);
    return v;
  }

  // The GST of some taxable lines, as Tally works it out: per duty head, the exact tax of every line added up and
  // rounded once for the voucher. Also what Zoho Books works out from the same lines: each part of each line rounded.
  gstOf(lines, inter) {
    const heads = inter ? [['IGST', 1]] : [['CGST', 0.5], ['SGST', 0.5]];
    const tally = {}, zoho = {};
    for (const [head, share] of heads) {
      // exact tax in 1/10000 paise, summed, then rounded once
      const exact = lines.reduce((t, l) => t + l.taxable * Math.round(l.rate * share * 100), 0);
      tally[head] = Math.sign(exact) * Math.round(Math.abs(exact) / 10000);
      zoho[head] = lines.reduce((t, l) => t + pct(l.taxable, l.rate * share), 0);
    }
    return { tally, zoho };
  }

  isInterState(partyName) {
    const l = this.ledgers.get(partyName);
    return !!l?.stateCode && l.stateCode !== this.profile.stateCode;
  }

  // A sale (invoice view). lines: [{ ledger (income), amount (rupees taxable), rate (GST %), hsn, item, qty, price, godown }]
  // opts: { number, date, party, narration, tax: override per head (rupees) for a deliberately wrong tax, roundOff: ledger, status, exportPatch }
  sale({ number, date, party, lines, roundOff, tax, ...opts }) {
    return this.trade('sale', { number, date, party, lines, roundOff, tax, ...opts });
  }
  // A purchase (invoice view). lines as for sale (ledger = expense or purchase ledger). tds: { ledger, amount (rupees) }.
  // reference: the supplier's invoice number.
  purchase({ number, date, party, lines, roundOff, tax, tds, ...opts }) {
    return this.trade('purchase', { number, date, party, lines, roundOff, tax, tds, ...opts });
  }
  // Added for companies 5-6 (additive; without these options nothing changes):
  //  inter: true / false says whether the supply is between states (an SEZ customer in the company's own state: true;
  //    an import of services from a vendor outside India: true); by default a sale with a placeOfSupply follows that
  //    state, otherwise the party's state;
  //  rcm: { CGST, SGST, IGST: ledger } (purchase only): tax under reverse charge. The GST is debited on the input ledgers
  //    as usual and credited on these ledgers (on the vendor's side) with the same amount; the vendor is owed the lines
  //    only. meta.rcmTax / rcmHeads / rcmZohoTax carry it; meta.tallyTax and zohoTax (the vendor's tax) are then 0.
  trade(kind, { number, date, party, lines, roundOff, tax, tds, gstOn = true, inter: interGiven, rcm, ...opts }) {
    const sale = kind === 'sale';
    const sgn = sale ? 1 : -1; // income credited (+), expense debited (-)
    const inter = interGiven ?? (sale && opts.placeOfSupply ? opts.placeOfSupply !== this.profile.state : this.isInterState(party));
    if (rcm && sale) throw new Error(`${number}: reverse charge is for a purchase`);
    // an item line takes its GST rate and HSN from the stock item master unless the line says otherwise
    const taxable = lines.map(l => { const it = l.item ? this.items.get(l.item) : null;
      return { ...l, rate: l.rate ?? it?.rate, lineHsn: l.lineHsn ?? it?.hsn, taxable: l.item ? Math.round(l.qty * P(l.price)) : P(l.amount) }; });
    const gst = gstOn ? this.gstOf(taxable.filter(l => l.rate), inter) : { tally: {}, zoho: {} };
    const heads = tax ? Object.fromEntries(Object.entries(tax).map(([h, v]) => [h, P(v)])) : gst.tally;
    const side = sale ? 'output' : 'input';
    const ledgerLines = [], inventory = [];
    for (const l of taxable) {
      if (l.item) inventory.push({ item: l.item, qty: l.qty, price: l.price, amount: sgn * l.taxable, ledger: l.ledger, godown: l.godown, rate: l.rate, hsn: l.lineHsn });
      else ledgerLines.push({ ledger: l.ledger, amount: sgn * l.taxable, rate: l.rate, hsn: l.hsn, typeOfSupply: 'Services' });
    }
    const taxLines = Object.entries(heads).filter(([, v]) => v).map(([h, v]) => ({ ledger: this.taxLedgers[side][h], amount: sgn * v }));
    // reverse charge: the same GST credited on the reverse charge ledgers (the vendor's side)
    if (rcm) for (const [h, v] of Object.entries(heads).filter(([, x]) => x)) { if (!rcm[h]) throw new Error(`${number}: no reverse charge ledger for ${h}`); taxLines.push({ ledger: rcm[h], amount: -sgn * v }); }
    const subtotal = taxable.reduce((t, l) => t + l.taxable, 0);
    const taxTotal = Object.values(heads).reduce((t, v) => t + v, 0);
    let gross = subtotal + (rcm ? 0 : taxTotal);
    const extraLines = [];
    if (roundOff) {
      const rounded = Math.round(gross / 100) * 100;
      const diff = rounded - gross; // paise added to the party
      if (diff) extraLines.push({ ledger: roundOff, amount: sgn * diff, extra: { roundtype: 'Normal Rounding' } });
      gross = rounded;
    }
    const tdsAmount = tds ? P(tds.amount) : 0;
    if (tds) extraLines.push({ ledger: tds.ledger, amount: sgn * -tdsAmount });
    const partyAmount = gross - tdsAmount;
    const ref = opts.reference || number;
    const partyLine = { ledger: party, amount: -sgn * partyAmount, party: true, bills: [{ name: ref, type: 'New Ref', amount: -sgn * partyAmount }] };
    const all = [partyLine, ...ledgerLines, ...taxLines, ...extraLines];
    const zohoTax = Object.values(gst.zoho).reduce((t, v) => t + v, 0);
    const taxMeta = rcm ? { tallyTax: 0, tallyHeads: {}, zohoTax: 0, zohoHeads: {}, rcmTax: taxTotal, rcmHeads: heads, rcmZohoTax: zohoTax, rcmZohoHeads: gst.zoho }
      : { tallyTax: taxTotal, tallyHeads: heads, zohoTax, zohoHeads: gst.zoho };
    return this.voucher(sale ? (opts.type || 'Sales') : (opts.type || 'Purchase'), number, date, all, {
      view: 'invoice', party, inventory, rated: true, ...(sale ? {} : { placeOfSupply: this.profile.state }), ...opts,
      meta: { kind, party, inter, subtotal, ...taxMeta, tds: tdsAmount, partyAmount, gross, reference: ref, ...(opts.meta || {}) },
    });
  }

  // Money in from a party. bills: [{ name, amount (rupees) }] against which it is received ('Agst Ref'); the rest 'On Account'.
  receipt({ number, date, party, bank, amount, bills = [], ...opts }) {
    const a = P(amount);
    const alloc = bills.map(b => ({ name: b.name, type: 'Agst Ref', amount: P(b.amount) }));
    const rest = a - alloc.reduce((t, b) => t + b.amount, 0);
    if (rest) alloc.push({ name: '', type: 'On Account', amount: rest });
    return this.voucher('Receipt', number, date, [{ ledger: bank, amount: -a, party: false, bank: { favouring: party, mode: 'Others' } }, { ledger: party, amount: a, party: true, bills: alloc }],
      { party, ...opts, meta: { kind: 'receipt', party, amount: a, ...(opts.meta || {}) } });
  }
  // Money out to a party (bills: against which it is paid), or to an expense ledger (no party).
  payment({ number, date, party, ledger, bank, amount, bills = [], ...opts }) {
    const a = P(amount);
    const to = party || ledger;
    const alloc = party ? bills.map(b => ({ name: b.name, type: 'Agst Ref', amount: -P(b.amount) })) : null;
    if (party) { const rest = -a - alloc.reduce((t, b) => t + b.amount, 0); if (rest) alloc.push({ name: '', type: 'On Account', amount: rest }); }
    return this.voucher('Payment', number, date, [{ ledger: to, amount: -a, party: !!party, ...(alloc ? { bills: alloc } : {}) }, { ledger: bank, amount: a, bank: { favouring: to } }],
      { party: party || undefined, ...opts, meta: { kind: 'payment', party, amount: a, ...(opts.meta || {}) } });
  }
  contra({ number, date, from, to, amount, ...opts }) {
    const a = P(amount);
    return this.voucher('Contra', number, date, [{ ledger: to, amount: -a }, { ledger: from, amount: a, bank: { favouring: 'Self' } }], { ...opts, meta: { kind: 'contra', amount: a } });
  }
  // A journal: lines made with dr() / cr().
  journal({ number, date, lines, party, ...opts }) {
    return this.voucher(opts.type || 'Journal', number, date, lines, { party, ...opts, meta: { kind: 'journal', ...(opts.meta || {}) } });
  }
  // A stock journal: items consumed (out) and produced (in). It posts nothing to ledgers.
  stockJournal({ number, date, consume, produce, ...opts }) {
    return this.voucher('Stock Journal', number, date, [], { inventoryIn: produce, inventoryOut: consume, ...opts, meta: { kind: 'stock_journal' } });
  }

  // ---------- the three files ----------
  masters() { return { tallymessage: clone(this.masterRecords) }; }
  transactions() { return { tallymessage: this.vouchers.map(v => clone(v.exported)) }; }

  // Per ledger, in paise: { opening (Tally sign), debit (positive), credit (positive), closing (Tally sign) }.
  ledgerFigures() {
    const f = new Map();
    for (const [name, l] of this.ledgers) f.set(name, { opening: l.opening, debit: 0, credit: 0 });
    for (const v of this.vouchers) {
      if (!v.meta.posts) continue;
      for (const p of v.meta.postings) {
        if (!f.has(p.ledger)) throw new Error(`${v.meta.type} ${v.meta.number}: ledger "${p.ledger}" is not a ledger of the company`);
        const x = f.get(p.ledger);
        if (p.amount < 0) x.debit += -p.amount; else x.credit += p.amount;
      }
    }
    for (const x of f.values()) x.closing = x.opening - x.debit + x.credit;
    return f;
  }
  openingTotals() {
    let debit = 0, credit = 0;
    for (const l of this.ledgers.values()) { if (l.opening < 0) debit += -l.opening; else credit += l.opening; }
    return { debit, credit };
  }

  // The Tally Trial Balance report (Display More Reports > Trial Balance, detailed, every ledger listed).
  trialBalance() {
    const figures = this.ledgerFigures();
    const { debit, credit } = this.openingTotals();
    if (debit !== credit) throw new Error(`${this.profile.name}: the opening balances do not tie (debit ${fmt(debit)}, credit ${fmt(credit)})`);
    const children = new Map();
    const add = (parent, node) => { if (!children.has(parent)) children.set(parent, []); children.get(parent).push(node); };
    for (const [g, x] of this.groups) if (x.parent) add(x.parent, { group: g });
    for (const [name, l] of this.ledgers) add(l.parent || null, { ledger: name });
    const amount = (outer, inner, paise) => ({ [outer]: paise === 0 ? {} : { [inner]: paise / 100 } });
    const build = node => {
      let fig, kids = [];
      if (node.ledger) { const x = figures.get(node.ledger); fig = [x.opening, x.debit, x.credit]; }
      else {
        kids = (children.get(node.group) || []).map(build).filter(Boolean);
        fig = kids.reduce((t, k) => [t[0] + k.fig[0], t[1] + k.fig[1], t[2] + k.fig[2]], [0, 0, 0]);
        if (!kids.length) return null;
      }
      if (!fig[0] && !fig[1] && !fig[2]) return null;
      const name = node.ledger || node.group;
      const line = { dspaccname: { dspdispname: name },
        dspaccinfo: [{ ...amount('dspopamt', 'dspopamta', fig[0]), ...amount('dspdramt', 'dspdramta', -fig[1]), ...amount('dspcramt', 'dspcramta', fig[2]), ...amount('dspclamt', 'dspclamta', fig[0] - fig[1] + fig[2]) }] };
      if (kids.length) line.grpexplosion = { dspaccline: kids.map(k => k.line) };
      return { line, fig };
    };
    const tops = [...TB_ORDER, ...[...this.groups.keys()].filter(g => !this.groups.get(g).parent && !TB_ORDER.includes(g))];
    const lines = tops.map(g => build({ group: g })).filter(Boolean).map(x => x.line);
    for (const node of children.get(null) || []) { const x = build(node); if (x) lines.push(x.line); } // ledgers with no group: Profit & Loss A/c
    return { dspaccbody: { dspaccline: lines } };
  }

  // Counts for the expectations.
  stats() {
    const byType = {};
    for (const v of this.vouchers) byType[v.meta.type] = (byType[v.meta.type] || 0) + 1;
    return { vouchers: this.vouchers.length, byType, ledgers: [...this.ledgers.values()].filter(l => l.inMasters).length, items: this.items.size };
  }
  voucherByNumber(number) { return this.vouchers.find(v => v.meta.number === number); }
}

// The three files as TallyPrime 7.1 saves them: UTF-16 LE with a byte order mark.
export const utf16le = obj => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(JSON.stringify(obj, null, 2), 'utf16le')]);
