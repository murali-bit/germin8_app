// A small, MADE-UP set of masters, vouchers and Trial Balance reports that copies the STRUCTURE of real TallyPrime 7.1
// exports (Gateway > E: Export > Transactions, and Display More Reports > Trial Balance > Export):
//  - every voucher of the year in one "tallymessage" list, voucher types mixed, saved as UTF-16 LE with a byte order mark;
//  - metadata { type: "Voucher", remoteid, vchkey, vchtype, action, objview }, dates as "YYYYMMDD" text, amounts as text
//    with Tally's sign (a debit is negative);
//  - lines in "allledgerentries" (accounting view) or in "ledgerentries" (invoice view), never both, with bill and bank
//    allocations, GST rate details and a user-defined field;
//  - the status flags iscancelled, isoptional and isdeleted, and a long row of GST status flags;
//  - "Voucher Type" masters: Tally's own types name themselves as parent and carry a reserved name; a company's own
//    type ("Sales - Export") names the Tally type above it;
//  - a ledger whose name ends in a line break (CR LF) in the masters, used on a voucher without it;
//  - the Trial Balance as a REPORT: dspaccbody > dspaccline > dspaccname / dspaccinfo / grpexplosion, amounts as JSON
//    numbers in Tally's sign, empty amount objects ({}) where a column has no figure, nested to any depth.
// Every name, number and amount here is invented.

import { RECORDS as BASE, NA, utf16le } from './allMasters.js';
export { utf16le };

const L = (...v) => [{ metadata: true, type: 'String' }, ...v];
let n = 0;
const guid = () => `00000000-beef-4000-8000-${String(++n).padStart(12, '0')}`;
const group = (name, parent, reserved = name) => ({ metadata: { type: 'Group', name, reservedname: reserved }, guid: guid(), languagename: [{ name: L(name), languageid: ' 1033' }], ...(parent ? { parent } : {}) });
const ledger = (name, parent, extra = {}) => ({ metadata: { type: 'Ledger', name, reservedname: '' }, guid: guid(), startingfrom: '20200401', currencyname: 'INR',
  languagename: [{ name: L(name), languageid: ' 1033' }], parent, ...extra });
// A Voucher Type master. Tally's own types name themselves as their parent; a company's own type names the type above it.
const voucherType = (name, parent = name, reserved = parent === name ? name : '') => ({ metadata: { type: 'Voucher Type', name, reservedname: reserved }, guid: guid(), parent,
  mailingname: name, numberingmethod: 'Automatic', isdeemedpositive: false, affectsstock: false, isactive: true, languagename: [{ name: L(name), languageid: ' 1033' }] });

export const QUARTZ_MASTER = 'Quartz Freight Lines\r\n'; // as the masters write it: with a line break at its end
export const QUARTZ = 'Quartz Freight Lines';            // as vouchers and the Trial Balance write it

// The masters: the base All Masters fixture (without its two bare Voucher Type records) plus what the vouchers need.
export const MASTER_RECORDS = [
  ...JSON.parse(JSON.stringify(BASE)).filter(r => r.metadata.type !== 'Voucher Type'),
  group('Sales Accounts', null), group('Cash-in-Hand', 'Current Assets'), group('Capital Account', null),
  ledger('Domestic Sales', 'Sales Accounts'), ledger('Export Sales', 'Sales Accounts'),
  ledger('Cash', 'Cash-in-Hand'), ledger('Owner Capital', 'Capital Account', { openingbalance: '2000.50' }),
  ledger('Input CGST', 'Duties & Taxes'), ledger('TDS Payable', 'Duties & Taxes'),
  ledger(QUARTZ_MASTER, 'Sundry Creditors'),
  ...['Sales', 'Purchase', 'Receipt', 'Payment', 'Journal', 'Contra', 'Debit Note', 'Credit Note', 'Memorandum', 'Stock Journal'].map(t => voucherType(t)),
  voucherType('Sales - Export', 'Sales'),
];
export const mastersDoc = () => ({ tallymessage: JSON.parse(JSON.stringify(MASTER_RECORDS)) });

// ---------- vouchers ----------
const STATUS_FLAGS = { isdeleted: false, isoptional: false, iscancelled: false, isonhold: false, isvoid: false, ispostdated: false, isgstoverridden: false,
  iseligibleforitc: true, isvatdutypaid: true, hascashflow: false, vchgststatusisincluded: false, vchgststatusisuncertain: false, vchgststatusisapplicable: false,
  vchstatusisoptional: false, vchstatusiscancelled: false, vchstatusisdeleted: false, vchstatusisopeningbalance: false };
const line = (ledgername, amount, extra = {}) => ({ oldauditentryids: L(' -1'), ledgername, gstclass: NA, isdeemedpositive: Number(amount) < 0, ledgerfromitem: false,
  removezeroentries: false, ispartyledger: false, gstoverridden: false, islastdeemedpositive: Number(amount) < 0, amount, ...extra });
const bills = (name, billtype, amount) => ({ billallocations: [{ name, billtype, tdsdeducteeisspecialrate: false, amount }] });
const bank = (date, amount, party) => ({ bankallocations: [{ date, instrumentdate: date, name: `made-up-${amount}`, transactiontype: 'Cheque', paymentfavouring: party, uniquereferencenumber: 'X1',
  status: 'No', paymentmode: 'Transacted', bankpartyname: party, isconnectedpayment: false, issplit: false, amount }] });
// view 'accounting': the lines go in "allledgerentries"; view 'invoice': in "ledgerentries" (with isinvoice and the invoice view names)
const voucher = (type, number, date, lines, { view = 'accounting', party, narration, extra = {} } = {}) => {
  const id = guid();
  const viewName = view === 'invoice' ? 'Invoice Voucher View' : 'Accounting Voucher View';
  return {
    metadata: { type: 'Voucher', remoteid: id, vchkey: `${id}-00000001:00000008`, vchtype: type, action: 'Create', objview: viewName },
    oldauditentryids: L(' -1'), date, vchstatusdate: date, guid: id, vouchertypename: type, gstregistration: { taxtype: 'GST', taxregistration: '' },
    cmpgstin: '29SAMPL0000A1Z5', cmpgstregistrationtype: 'Regular', cmpgststate: 'Karnataka',
    ...(party ? { partyledgername: party } : {}), vouchernumber: number, numberingstyle: 'Auto Retain', persistedview: viewName,
    vchstatustaxadjustment: 'Default', vchstatusvouchertype: type, vchgstclass: NA, effectivedate: date, ...STATUS_FLAGS, isinvoice: view === 'invoice',
    alterid: ' 41', masterid: ' 17', voucherkey: '1970324836974600', vouchernumberseries: 'Default',
    ...(narration ? { narration } : {}), ...extra,
    [view === 'invoice' ? 'ledgerentries' : 'allledgerentries']: lines,
  };
};
const P = { ispartyledger: true };
const RATES = { ratedetails: [{ gstratedutyhead: 'CGST', gstratevaluationtype: 'Based on Value', gstrate: ' 9' }, { gstratedutyhead: 'IGST' }] };
const UDF = { 'udf:userdescription': [{ metadata: true, desc: 'UserDescription', is_list: true, type: 'String', index: 1 }, 'made-up description'] };

export const VOUCHERS = [
  // sales entered in the invoice view: lines in "ledgerentries"
  voucher('Sales', 'S-1', '20240410', [line('Maple Leaf Traders', '-1180.00', { ...P, ...bills('S-1', 'New Ref', '-1180.00') }), line('Domestic Sales', '1000.00', { ...RATES, ...UDF }), line('Output CGST', '180.00')],
    { view: 'invoice', party: 'Maple Leaf Traders', narration: 'Made-up sale', extra: { partygstin: '29ABCDE1234F1Z5', placeofsupply: 'Karnataka', statename: 'Karnataka', partymailingname: 'Maple Leaf Traders Pvt Ltd', basicbuyername: 'Maple Leaf Traders' } }),
  // the company's own voucher type, placed under Sales by its Voucher Type master
  voucher('Sales - Export', 'SE-1', '20240412', [line('Pine Hill Stores', '-500.00', P), line('Export Sales', '500.00')], { view: 'invoice', party: 'Pine Hill Stores' }),
  // purchases entered as journals: exactly one vendor credited, expense and tax ledgers debited
  voucher('Journal', 'J-1', '20240415', [line('Staff Tea Expenses', '-1000.00'), line('Input CGST', '-180.00'), line('Birch Supplies', '1180.00', { ...P, ...bills('B-77', 'New Ref', '1180.00') })],
    { party: 'Birch Supplies', narration: 'Made-up purchase', extra: { reference: 'B-77', referencedate: '20240414', gst: [{ purposetype: 'GST', stat: 'made-up' }] } }),
  // the vendor's name is written without the line break the master has; a tax ledger is credited (tax deducted)
  voucher('Journal', 'J-2', '20240420', [line('Staff Tea Expenses', '-300.07'), line(QUARTZ, '270.07', P), line('TDS Payable', '30.00')], { party: QUARTZ }),
  voucher('Journal', 'J-3', '20240422', [line('Staff Tea Expenses', '-50.00'), line('Cash', '50.00')]),
  // a vendor debited: not a purchase
  voucher('Journal', 'J-4', '20240425', [line('Birch Supplies', '-100.00', P), line('Staff Tea Expenses', '100.00')], { party: 'Birch Supplies' }),
  // cancelled: Tally keeps the number and removes the lines
  voucher('Journal', 'J-5', '20240426', [], { extra: { iscancelled: true, vchstatusiscancelled: true } }),
  // optional: has lines, but is not posted to the books
  voucher('Journal', 'J-6', '20240427', [line('Staff Tea Expenses', '-999.00'), line('Birch Supplies', '999.00', P)], { party: 'Birch Supplies', extra: { isoptional: true } }),
  voucher('Payment', 'P-1', '20240502', [line('Birch Supplies', '-1180.00', { ...P, ...bills('B-77', 'Agst Ref', '-1180.00') }), line('Bank of Example', '1180.00', { ...P, ...bank('20240502', '1180.00', 'Birch Supplies') })], { party: 'Birch Supplies' }),
  voucher('Receipt', 'R-1', '20240505', [line('Bank of Example', '-1180.00', P), line('Maple Leaf Traders', '1180.00', { ...P, ...bills('S-1', 'Agst Ref', '1180.00') })], { party: 'Maple Leaf Traders' }),
  // deleted: kept by Tally as a trace only
  voucher('Receipt', 'R-2', '20240506', [line('Bank of Example', '-77.00'), line('Maple Leaf Traders', '77.00')], { party: 'Maple Leaf Traders', extra: { isdeleted: true } }),
  voucher('Contra', 'C-1', '20240510', [line('Cash', '-200.00'), line('Bank of Example', '200.00', bank('20240510', '200.00', 'Self'))], { party: 'Cash' }),
  voucher('Debit Note', 'DN-1', '20240515', [line('Birch Supplies', '-118.00', P), line('Staff Tea Expenses', '100.00'), line('Input CGST', '18.00')], { view: 'invoice', party: 'Birch Supplies' }),
  // a Tally voucher type the platform has no dataset for
  voucher('Memorandum', 'M-1', '20240520', [line('Staff Tea Expenses', '-10.00'), line('Cash', '10.00')]),
  // a voucher type that is in no Voucher Type master: it cannot be traced, and nothing is guessed from its name
  voucher('Gate Pass', 'GP-1', '20240521', [line('Staff Tea Expenses', '-5.00'), line('Cash', '5.00')]),
];
// The builders, for tests that need more vouchers or ledgers of the same structure (made-up values only).
export { voucher, line, ledger, group, bills, bank };
export const transactionsDoc = (vouchers = VOUCHERS) => ({ tallymessage: JSON.parse(JSON.stringify(vouchers)) });

// ---------- the Trial Balance report ----------
// Figures in paise per ledger: [opening (Tally sign: debit negative), debits, credits]. They agree with the posted
// vouchers above (the cancelled, optional and deleted ones and the Memorandum voucher are not posted; S4, TALLY-002: the
// custom type "Gate Pass" carries ledger amounts, so it posts like any voucher: Cash credited and Staff Tea debited 5.00).
export const LEDGER_FIGURES = {
  'Owner Capital': [200050, 0, 0],
  'Maple Leaf Traders': [-150050, 118000, 118000],
  'Pine Hill Stores': [0, 50000, 0],
  'Bank of Example': [-300000, 118000, 138000],
  Cash: [0, 20000, 5500],
  'Birch Supplies': [250000, 139800, 118000],
  [QUARTZ]: [0, 0, 27007],
  'Output CGST': [0, 0, 18000], 'Input CGST': [0, 18000, 1800], 'TDS Payable': [0, 0, 3000],
  'Domestic Sales': [0, 0, 100000], 'Export Sales': [0, 0, 50000],
  'Staff Tea Expenses': [0, 135507, 20000],
};
// The groups as Tally shows them, to three levels below the top: [name, [children]]; a leaf is a ledger name.
const TREE = [
  ['Capital Account', ['Owner Capital']],
  ['Current Assets', [['Sundry Debtors', ['Maple Leaf Traders', ['Hill Region Debtors', ['Pine Hill Stores']]]], ['Bank Accounts', ['Bank of Example']], ['Cash-in-Hand', ['Cash']]]],
  ['Current Liabilities', [['Sundry Creditors', ['Birch Supplies', QUARTZ]], ['Duties & Taxes', ['Output CGST', 'Input CGST', 'TDS Payable']]]],
  ['Sales Accounts', ['Domestic Sales', 'Export Sales']],
  ['Indirect Expenses', [['Staff Welfare Costs', ['Staff Tea Expenses']]]],
];
// The report. opts.depth: how many levels are opened (Infinity: every ledger is listed; 1: groups with one level opened);
// opts.change(figures): alter the ledger figures before the report is built (to make a figure deliberately wrong).
export function trialBalanceReport({ depth = Infinity, figures = LEDGER_FIGURES } = {}) {
  const amount = (outer, inner, paise) => ({ [outer]: paise === 0 ? {} : { [inner]: paise / 100 } }); // a JSON number; {} when there is no figure
  const build = (node, level) => {
    const isLedger = typeof node === 'string';
    const name = isLedger ? node : node[0];
    const kids = isLedger ? [] : node[1].map(k => build(k, level + 1));
    const [op, dr, cr] = isLedger ? figures[name] : kids.reduce((t, k) => [t[0] + k.fig[0], t[1] + k.fig[1], t[2] + k.fig[2]], [0, 0, 0]);
    const lineOut = { dspaccname: { dspdispname: name },
      dspaccinfo: [{ ...amount('dspopamt', 'dspopamta', op), ...amount('dspdramt', 'dspdramta', -dr), ...amount('dspcramt', 'dspcramta', cr), ...amount('dspclamt', 'dspclamta', op - dr + cr) }] };
    if (kids.length && level < depth) lineOut.grpexplosion = { dspaccline: kids.map(k => k.line) };
    return { line: lineOut, fig: [op, dr, cr] };
  };
  return { dspaccbody: { dspaccline: TREE.map(t => build(t, 0).line) } };
}
