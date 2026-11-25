// A small, MADE-UP "All Masters" export that copies the STRUCTURE of a real TallyPrime 7.1 export:
//  - every master type mixed in one "tallymessage" list, including types the platform does not use;
//  - no top-level "name": the name is in metadata.name and in languagename[0].name (a Tally list);
//  - "Stock Item" written with a space; items whose unit is Tally's "not applicable" marker; no Unit records;
//  - contact details in dated lists (ledmailingdetails, ledgstregdetails) and legacy old* fields;
//  - custom sub-groups under Sundry Debtors, Sundry Creditors and Indirect Expenses.
// Every name, number and address here is invented. Saved by the tests as UTF-16 LE with a byte order mark.

export const NA = '\u0004 Not Applicable';
const L = (...v) => [{ metadata: true, type: 'String' }, ...v];
const lang = name => [{ name: L(name), languageid: ' 1033' }];
let n = 0;
const guid = () => `00000000-feed-4000-8000-${String(++n).padStart(12, '0')}`;
const meta = (type, name, reserved = '') => ({ type, name, reservedname: reserved });

const group = (name, parent, reserved = '') => ({
  metadata: meta('Group', name, reserved), guid: guid(), isbillwiseon: false, isaddable: false, sortposition: ' 100', alterid: ' 7',
  languagename: lang(name), ...(parent ? { parent } : {}),
});
const ledger = (name, parent, extra = {}) => ({
  metadata: meta('Ledger', name), oldauditentryids: L(' -1'), startingfrom: '20200401', guid: guid(), currencyname: 'INR',
  taxtype: 'Others', gsttype: '', isbillwiseon: true, iscostcentreson: false, sortposition: ' 1000', alterid: ' 12',
  languagename: lang(name), ...(parent ? { parent } : {}), ...extra,
});

export const RECORDS = [
  // types the platform does not use
  { metadata: meta('Currency', 'INR'), guid: guid(), mailingname: 'INR', expandedsymbol: 'INR', decimalsymbol: '.' },
  { metadata: meta('TDS Rate', 'Sample TDS Rate'), guid: guid() },
  { metadata: meta('Cost Category', 'Primary Cost Category'), guid: guid() },
  { metadata: meta('IncomeTaxClassification', 'Sample Classification A'), guid: guid() },
  { metadata: meta('IncomeTaxClassification', 'Sample Classification B'), guid: guid() },
  { metadata: meta('IncomeTaxSlab', 'Sample Slab'), guid: guid() },
  { metadata: { ...meta('TaxUnit', 'Default Tax Unit'), taxtype: 'GST', taxregistration: '' }, guid: guid() },
  // groups: Tally's own groups (reserved names) and custom sub-groups
  group('Current Assets', null, 'Current Assets'),
  group('Current Liabilities', null, 'Current Liabilities'),
  group('Indirect Expenses', null, 'Indirect Expenses'),
  group('Sundry Debtors', 'Current Assets', 'Sundry Debtors'),
  group('Sundry Creditors', 'Current Liabilities', 'Sundry Creditors'),
  group('Duties & Taxes', 'Current Liabilities', 'Duties & Taxes'),
  group('Bank Accounts', 'Current Assets', 'Bank Accounts'),
  group('Hill Region Debtors', 'Sundry Debtors'),
  group('Job Work Creditors', 'Sundry Creditors'),
  group('Staff Welfare Costs', 'Indirect Expenses'),
  // a customer with three dated mailing entries: the latest on or before 31 March 2025 must be used
  ledger('Maple Leaf Traders', 'Sundry Debtors', {
    partygstin: '29ABCDE1234F1Z5', incometaxnumber: 'ABCDE1234F', gstregistrationtype: 'Regular', priorstatename: 'Karnataka', countryofresidence: 'India',
    oldmailingname: L('Maple Leaf Old Name'), oldledstatename: 'Kerala', oldcountryname: 'India', openingbalance: '-1500.00',
    ledgstregdetails: [
      { applicablefrom: '20200401', gstregistrationtype: 'Regular', state: 'Karnataka', placeofsupply: 'Karnataka', gstin: '29ABCDE1234F1Z5', istransporter: false, iscommonparty: true },
    ],
    ledmailingdetails: [
      { applicablefrom: '20200401', mailingname: 'Maple Leaf Traders (old)', address: L('1 Old Road', 'Old Town'), state: 'Kerala', country: 'India', pincode: '680001' },
      { applicablefrom: '20240601', mailingname: 'Maple Leaf Traders Pvt Ltd', address: L('22 New Street', 'Block B', 'Sample City'), state: 'Karnataka', country: 'India', pincode: '560099' },
      { applicablefrom: '20260101', mailingname: 'Maple Leaf Future Name', address: L('99 Later Lane'), state: 'Goa', country: 'India', pincode: '403001' },
    ],
    contactdetails: [{ name: 'Ravi Sample', phonenumber: '9800000001', countryisdcode: '+91', isdefaultwhatsappnum: true }],
    billallocations: [{ billdate: '20240301', name: 'INV-1', isadvance: false, openingbalance: '-1500.00' }],
  }),
  // a customer under a custom sub-group of Sundry Debtors; only legacy state; GSTIN only in ledgstregdetails
  ledger('Pine Hill Stores', 'Hill Region Debtors', {
    oldledstatename: 'Goa', priorstatename: NA,
    ledgstregdetails: [{ applicablefrom: '20230401', gstregistrationtype: 'Regular', gstin: '30PQRSX9876K1Z2' }],
    ledmailingdetails: [{ applicablefrom: '20230401', mailingname: 'Pine Hill Stores', country: 'India' }],
  }),
  ledger('Birch Supplies', 'Sundry Creditors', {
    incometaxnumber: 'BIRCH1234B', openingbalance: '2500.00',
    ledmailingdetails: [{ applicablefrom: '20200401', mailingname: 'Birch Supplies', state: 'Maharashtra', country: 'India' }],
  }),
  ledger('Cedar Job Works', 'Job Work Creditors', {
    ledmailingdetails: [{ applicablefrom: '20200401', mailingname: 'Cedar Job Works', state: 'Tamil Nadu', country: 'India' }],
  }),
  ledger('Output CGST', 'Duties & Taxes', { taxtype: 'GST', gstdutyhead: 'Central Tax' }),
  ledger('Staff Tea Expenses', 'Staff Welfare Costs', { gstapplicable: NA }),
  ledger('Bank of Example', 'Bank Accounts', { ifscode: 'EXMP0000001' }),
  { ...ledger('Profit & Loss A/c', null), metadata: meta('Ledger', 'Profit & Loss A/c', 'Profit & Loss A/c') },
  // stock items: one with no unit and its HSN on the stock group, one with a unit and its own HSN
  { metadata: meta('Stock Item', 'Brass Valve 15mm'), guid: guid(), category: NA, baseunits: NA, additionalunits: NA, languagename: lang('Brass Valve 15mm'),
    gstdetails: [{ applicablefrom: '20220401', srcofgstdetails: 'As per Company/Stock Group' }],
    hsndetails: [{ applicablefrom: '20220401', srcofhsndetails: 'As per Company/Stock Group' }] },
  { metadata: meta('Stock Item', 'Copper Pipe 1m'), guid: guid(), category: NA, baseunits: 'nos', additionalunits: NA, languagename: lang('Copper Pipe 1m'),
    hsndetails: [{ applicablefrom: '20220401', srcofhsndetails: 'Specify Details Here', hsncode: '74111000' }] },
  { metadata: meta('Godown', 'Main Location'), guid: guid() },
  { metadata: meta('Voucher Type', 'Sales'), guid: guid() },
  { metadata: meta('Voucher Type', 'Purchase'), guid: guid() },
];

export const doc = () => ({ tallymessage: JSON.parse(JSON.stringify(RECORDS)) });

// Ledgers with the problems found in real exports, all MADE UP:
//  - a name, a mailing name and a partygstin (with the GSTIN of its registration entry) ending in a line break (CR LF);
//  - a second ledger whose name is the same without the line break, with the same GSTIN (a likely duplicate);
//  - address lines that start with CR LF or hold the invisible character U+FEFF; a PAN with a space after it;
//  - a name with a plain space at its end;
//  - GST registration type "Regular" with no GSTIN anywhere, and Tally's "Unknown" marker as registration type;
//  - a partygstin that differs from the GSTIN of the registration entry used;
//  - a GSTIN that does not have the format of a GSTIN.
export const UNKNOWN = '\u0004 Unknown';
export const HIDDEN_RECORDS = [
  ledger('Oak Line Traders\r\n', 'Sundry Creditors', {
    partygstin: '27OAKLN1234Q1Z3\r\n', incometaxnumber: 'OAKLN1234Q ',
    ledgstregdetails: [{ applicablefrom: '20200401', gstregistrationtype: 'Regular', state: 'Maharashtra', placeofsupply: 'Maharashtra', gstin: '27OAKLN1234Q1Z3\r\n' }],
    ledmailingdetails: [{ applicablefrom: '20200401', mailingname: 'Oak Line Traders\r\n', address: L('\r\n7 Grove Road', 'Unit﻿ 3'), state: 'Maharashtra', country: 'India', pincode: '411001' }],
  }),
  ledger('Oak Line Traders', 'Sundry Creditors', {
    partygstin: '27OAKLN1234Q1Z3',
    ledgstregdetails: [{ applicablefrom: '20200401', gstregistrationtype: 'Regular', state: 'Maharashtra', placeofsupply: 'Maharashtra', gstin: '27OAKLN1234Q1Z3' }],
  }),
  ledger('Willow Mart ', 'Sundry Debtors', {
    ledgstregdetails: [{ applicablefrom: '20180401', gstregistrationtype: 'Regular', state: 'Kerala', placeofsupply: 'Kerala' }],
    ledmailingdetails: [{ applicablefrom: '20180401', mailingname: 'Willow Mart', state: 'Kerala', country: 'India' }],
  }),
  ledger('Elm Corner Shop', 'Sundry Debtors', {
    ledgstregdetails: [{ applicablefrom: '20180401', gstregistrationtype: UNKNOWN, state: 'Kerala', placeofsupply: 'Kerala' }],
  }),
  ledger('Ash Distributors', 'Sundry Debtors', {
    partygstin: '32ASHDI1111A1Z1',
    ledgstregdetails: [
      { applicablefrom: '20180401', gstregistrationtype: 'Unregistered/Consumer', state: 'Kerala', placeofsupply: 'Kerala' },
      { applicablefrom: '20240401', gstregistrationtype: 'Regular', state: 'Kerala', placeofsupply: 'Kerala', gstin: '32ASHDI2222B1Z2' },
      { applicablefrom: '20250901', gstregistrationtype: 'Regular', state: 'Kerala', placeofsupply: 'Kerala', gstin: '32ASHDI3333C1Z3' },
    ],
  }),
  ledger('Fir Wholesale', 'Sundry Debtors', { partygstin: 'NOT-A-GSTIN', gstregistrationtype: 'Regular' }),
];

// The JSON text as UTF-16 LE with a byte order mark, as TallyPrime 7.1 saves it.
export const utf16le = obj => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(JSON.stringify(obj, null, 2), 'utf16le')]);
