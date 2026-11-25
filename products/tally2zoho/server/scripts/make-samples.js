// Creates made-up Tally JSON test files in ../sample-data.
// Shape follows the JSONEx sample payloads in Tally's help pages. The data is fictional.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../sample-data');
const bad = path.join(out, 'problem-files');
fs.mkdirSync(bad, { recursive: true });
const company = 'Apex Engineering Technologies Pvt. Ltd.';
const wrap = msgs => ({ static_variables: [{ name: 'svExportFormat', value: 'jsonex' }, { name: 'svCurrentCompany', value: company }], tallymessage: msgs });
const write = (dir, name, msgs) => fs.writeFileSync(path.join(dir, name), JSON.stringify(wrap(msgs), null, 2));
const list = (...v) => [{ metadata: true, type: 'String' }, ...v];
const guid = (p, i) => `a1b2c3d4-0000-4000-8000-${p}${String(i).padStart(8, '0')}`;

const ledger = (i, p, name, parent, extra = {}) => ({ metadata: { type: 'Ledger', name }, guid: guid(p, i), name, parent, ...extra });
const customers = [
  ['Adani Solar Equipment Ltd.', '24AAACA1234F1Z5', 'Gujarat', '380001', '-145000.00'],
  ['Kaveri Components', '29AABCK5678G1Z2', 'Karnataka', '560001', '-38900.00'],
  ['Zenith Agro Exports LLP', '27AAAFZ9012H1Z8', 'Maharashtra', '400001', '0.00'],
  ['BlueOcean Logistics India', '33AADCB3456J1Z1', 'Tamil Nadu', '600001', '-21300.00'],
].map(([n, g, st, pin, ob], i) => ledger(i + 1, 'c', n, 'Sundry Debtors', { mailingname: n, partygstin: g, incometaxnumber: g.slice(2, 12), ledstatename: st, pincode: pin, countryname: 'India', address: list('Plot 12, Industrial Area', st), email: `accounts${i + 1}@example.com`, openingbalance: ob,
  // Fields the platform does not read: they show up under "fields not read". The last one is Tally's "not applicable" marker and is ignored.
  creditperiod: '30 Days', gstregistrationtype: 'Regular', pricelevel: '\u0004 Not Applicable' }));
const vendors = [
  ['Shree Logistics', '27AAGFS1111K1Z3', 'Maharashtra', '411001', '62300.00'],
  ['Bharat Steel Traders', '27AAACB2222L1Z4', 'Maharashtra', '400070', '118000.00'],
  ['Precision Tools Co.', '29AAACP3333M1Z6', 'Karnataka', '560058', '0.00'],
].map(([n, g, st, pin, ob], i) => ledger(i + 1, 'v', n, 'Sundry Creditors', { mailingname: n, partygstin: g, incometaxnumber: g.slice(2, 12), ledstatename: st, pincode: pin, countryname: 'India', address: list('Unit 4, MIDC', st), openingbalance: ob }));
const accounts = [
  ['State Bank of India', 'Bank Accounts'], ['Cash', 'Cash-in-Hand'], ['Sales - Spares', 'Sales Accounts'], ['Consultancy and Design Revenue', 'Sales Accounts'],
  ['Purchase - Raw Material', 'Purchase Accounts'], ['Freight Inward', 'Direct Expenses'], ['Office Rent', 'Indirect Expenses'], ['Depreciation', 'Indirect Expenses'],
  ['Accumulated Depreciation', 'Fixed Assets'], ['Plant and Machinery', 'Fixed Assets'], ['Share Capital', 'Capital Account'],
  ['Audit Fees Payable', 'Provisions'], ['Provision for Audit Fees', 'Indirect Expenses'], ['Factory Imprest', 'Branch / Divisions'],
  // Ledgers under custom sub-groups. Their main group is standard, so the type is found by walking up the Group records below.
  ['Power and Fuel', 'Factory Expenses'], ['Office Stationery', 'Admin Expenses'], ['Staff Travel', 'Travel Expenses'],
].map(([n, p], i) => ledger(i + 1, 'a', n, p));
// Group records, mixed into the Chart of Accounts file. "Branch / Divisions" has no Group record on purpose: it must still need a decision.
const group = (i, name, parent) => ({ metadata: { type: 'Group', name }, guid: guid('g', i), name, parent });
const groups = [group(1, 'Factory Expenses', 'Direct Expenses'), group(2, 'Admin Expenses', 'Indirect Expenses'), group(3, 'Travel Expenses', 'Admin Expenses'),
  group(4, 'Indirect Expenses', '\u0004 Primary')];
const taxes = ['CGST', 'SGST', 'IGST'].map((n, i) => ledger(i + 1, 't', `Output ${n}`, 'Duties & Taxes', { taxtype: 'GST', gstdutyhead: n }));
const units = [['nos', 'Numbers'], ['kgs', 'Kilograms'], ['mtr', 'Metres']].map(([n, f], i) => ({ metadata: { type: 'Unit', name: n }, guid: guid('u', i + 1), name: n, originalname: f, issimpleunit: true }));
const items = [
  ['Stainless Steel Hex Bolt M12x50', 'nos', '73181500', ' 5000 nos', '-60000.00'],
  ['MS Plate 10mm', 'kgs', '72085110', ' 1200 kgs', '-78000.00'],
  ['Copper Wire 2.5 sqmm', 'mtr', '85444999', ' 800 mtr', '-36000.00'],
  ['Bearing 6204 ZZ', 'nos', '84821011', ' 300 nos', '-27000.00'],
  ['Sample Item Without Unit', '', '84879000', '', '0.00'],
].map(([n, u, h, ob, ov], i) => ({ metadata: { type: 'StockItem', name: n }, guid: guid('i', i + 1), name: n, parent: 'Finished Goods', baseunits: u, hsncode: h, openingbalance: ob, openingvalue: ov }));

const le = (ledgername, amount, party = false) => ({ ledgername, isdeemedpositive: Number(amount) < 0, ispartyledger: party, amount });
const vch = (i, p, type, date, party, entries, narration = '') => ({
  metadata: { type: 'Voucher', vchtype: type, action: 'Create' }, guid: guid(p, i), date, vouchertypename: type,
  vouchernumber: `${type.slice(0, 2).toUpperCase()}/24-25/${String(i).padStart(4, '0')}`, partyledgername: party, narration, ledgerentries: entries,
});
const sales = [
  vch(1, 's', 'Sales', '20240612', 'Adani Solar Equipment Ltd.', [le('Adani Solar Equipment Ltd.', '-11800.00', true), le('Sales - Spares', '10000.00'), le('Output IGST', '1800.00')]),
  vch(2, 's', 'Sales', '20240705', 'Kaveri Components', [le('Kaveri Components', '-23600.00', true), le('Sales - Spares', '20000.00'), le('Output IGST', '3600.00')]),
  vch(3, 's', 'Sales', '20240819', 'Zenith Agro Exports LLP', [le('Zenith Agro Exports LLP', '-59000.00', true), le('Sales - Spares', '50000.00'), le('Output CGST', '4500.00'), le('Output SGST', '4500.00')]),
  { ...vch(4, 's', 'Sales', '20240902', 'BlueOcean Logistics India', [le('BlueOcean Logistics India', '-25134.00', true), le('Output IGST', '3834.00')]),
    allinventoryentries: [{ stockitemname: 'Bearing 6204 ZZ', rate: '213.00/nos', amount: '21300.00', actualqty: ' 100 nos', billedqty: ' 100 nos',
      accountingallocations: [{ ledgername: 'Sales - Spares', isdeemedpositive: false, amount: '21300.00' }] }] },
];
const purchase = [
  vch(1, 'p', 'Purchase', '20240510', 'Bharat Steel Traders', [le('Bharat Steel Traders', '118000.00', true), le('Purchase - Raw Material', '-100000.00'), le('Output CGST', '-9000.00'), le('Output SGST', '-9000.00')]),
  vch(2, 'p', 'Purchase', '20240722', 'Precision Tools Co.', [le('Precision Tools Co.', '47200.00', true), le('Purchase - Raw Material', '-40000.00'), le('Output IGST', '-7200.00')]),
];
const receipt = [vch(1, 'r', 'Receipt', '20240630', 'Adani Solar Equipment Ltd.', [le('Adani Solar Equipment Ltd.', '11800.00', true), le('State Bank of India', '-11800.00')])];
const payment = [vch(1, 'y', 'Payment', '20240615', 'Bharat Steel Traders', [le('Bharat Steel Traders', '-118000.00', true), le('State Bank of India', '118000.00')])];
const journal = [
  vch(1, 'j', 'Journal', '20240628', '', [le('Adani Solar Equipment Ltd.', '-145000.00'), le('Consultancy and Design Revenue', '145000.00')], 'Design consultancy fee'),
  vch(2, 'j', 'Journal', '20240703', '', [le('Freight Inward', '-62300.00'), le('Shree Logistics', '62300.00')], 'Freight bill for June'),
  vch(3, 'j', 'Journal', '20240331', '', [le('Depreciation', '-210000.00'), le('Accumulated Depreciation', '210000.00')], 'Depreciation (dated outside the financial year on purpose)'),
];
const tb = [...customers, ...vendors].map(l => ({ metadata: { type: 'TrialBalanceLine' }, name: l.name, parent: l.parent, closingbalance: l.openingbalance }));
const ss = items.filter(i => i.baseunits).map(i => ({ metadata: { type: 'StockSummaryLine' }, name: i.name, closingquantity: i.openingbalance, closingvalue: i.openingvalue }));

write(out, '01_customers.json', customers);
write(out, '02_vendors.json', vendors);
write(out, '03_chart_of_accounts.json', [...groups, ...accounts]);
write(out, '04_stock_items.json', items);
write(out, '05_units.json', units);
write(out, '06_tax_configuration.json', taxes);
write(out, '07_sales_vouchers.json', sales);
write(out, '08_purchase_vouchers.json', purchase);
write(out, '09_receipt_vouchers.json', receipt);
write(out, '10_payment_vouchers.json', payment);
write(out, '11_journal_vouchers.json', journal);
write(out, '12_stock_summary.json', ss);
write(out, '13_trial_balance.json', tb);

// Files that should be rejected or flagged
write(bad, 'journal_unbalanced.json', [...journal, vch(9, 'j', 'Journal', '20240901', '', [le('Office Rent', '-25000.00'), le('State Bank of India', '24000.00')])]);
write(bad, 'mixed_voucher_types.json', [...sales, ...purchase]);

// Files that upload fine but raise cross-check items (names on vouchers that are not in the masters)
write(bad, 'sales_unknown_names.json', [
  // "Sales - Export" is not in any master file (used on two vouchers: one flagged item, not two)
  vch(1, 's', 'Sales', '20240612', 'Adani Solar Equipment Ltd.', [le('Adani Solar Equipment Ltd.', '-11800.00', true), le('Sales - Export', '10000.00'), le('Output IGST', '1800.00')]),
  // "Walk-in Customer" is not in the Customer file
  vch(2, 's', 'Sales', '20240705', 'Walk-in Customer', [le('Walk-in Customer', '-23600.00', true), le('Sales - Export', '20000.00'), le('Output IGST', '3600.00')]),
  // "sales - spares" differs from "Sales - Spares" only by capital letters
  vch(3, 's', 'Sales', '20240819', 'Kaveri Components', [le('Kaveri Components', '-5900.00', true), le('sales - spares', '5000.00'), le('Output IGST', '900.00')]),
  // "Unknown Widget" is not in the Stock Items file
  { ...vch(4, 's', 'Sales', '20240902', 'BlueOcean Logistics India', [le('BlueOcean Logistics India', '-1180.00', true), le('Output IGST', '180.00')]),
    allinventoryentries: [{ stockitemname: 'Unknown Widget', rate: '100.00/nos', amount: '1000.00', actualqty: ' 10 nos', billedqty: ' 10 nos',
      accountingallocations: [{ ledgername: 'Sales - Spares', isdeemedpositive: false, amount: '1000.00' }] }] },
]);
// one item uses the unit "box", which is not in the Units file
write(bad, 'stock_items_unknown_unit.json', [...items, { metadata: { type: 'StockItem', name: 'Packing Carton' }, guid: guid('i', 9), name: 'Packing Carton', parent: 'Packing Material', baseunits: 'box', hsncode: '48191010', openingbalance: ' 40 box', openingvalue: '-2000.00' }]);
// "Suspense Account" is in the Trial Balance but in no master file
write(bad, 'trial_balance_unknown_ledger.json', [...tb, { metadata: { type: 'TrialBalanceLine' }, name: 'Suspense Account', parent: 'Suspense A/c', closingbalance: '-500.00' }]);
// a purchase whose party is a customer, not a vendor, and a cash purchase (the party is the Cash ledger)
write(bad, 'purchase_party_not_vendor.json', [...purchase,
  vch(3, 'p', 'Purchase', '20240805', 'Kaveri Components', [le('Kaveri Components', '5900.00', true), le('Purchase - Raw Material', '-5000.00'), le('Output IGST', '-900.00')]),
  vch(4, 'p', 'Purchase', '20240806', 'Cash', [le('Cash', '1180.00', true), le('Purchase - Raw Material', '-1000.00'), le('Output IGST', '-180.00')]),
]);
// a receipt that uses a ledger found in no master file, and a receipt with a line that has no ledger name
write(bad, 'receipt_unknown_ledger.json', [...receipt,
  vch(2, 'r', 'Receipt', '20240710', 'Kaveri Components', [le('Kaveri Components', '5000.00', true), le('Petty Cash Counter', '-5000.00')]),
  vch(3, 'r', 'Receipt', '20240712', 'Kaveri Components', [le('Kaveri Components', '100.00', true), le('', '-100.00')]),
]);
// two groups that point at each other: the ledger under them must need a decision, and nothing may hang.
// Also Tally's own group "Sundry Debtors" (under Current Assets) with a sub-group: ledgers under them must
// need a decision too, and must not take "Other Current Asset" from Current Assets.
write(bad, 'chart_of_accounts_group_loop.json', [...groups, group(8, 'Loop A', 'Loop B'), group(9, 'Loop B', 'Loop A'),
  group(10, 'Sundry Debtors', 'Current Assets'), group(11, 'North Debtors', 'Sundry Debtors'),
  ...accounts, ledger(30, 'a', 'Loop Ledger', 'Loop A'), ledger(31, 'a', 'Staff Advance Recoverable', 'North Debtors')]);
fs.writeFileSync(path.join(bad, 'broken_file.json'), '{ "tallymessage": [ { "name": "cut off');
fs.writeFileSync(path.join(out, 'README.txt'), [
  'Made-up TallyPrime JSON test files for Apex Engineering Technologies Pvt. Ltd., FY 2024-25.',
  'Upload files 01 to 13 into the matching slots. Files in problem-files are meant to be rejected or flagged.',
  'File 03 also holds a few Tally Group records, so ledgers under custom sub-groups can find their main group.',
  'In problem-files: sales_unknown_names, purchase_party_not_vendor, receipt_unknown_ledger, stock_items_unknown_unit and',
  'trial_balance_unknown_ledger upload fine but raise cross-check items;',
  'chart_of_accounts_group_loop has two groups that point at each other, and a sub-group of Sundry Debtors that must need a decision.',
  'The structure follows sample payloads from Tally help pages. These are not real Tally exports.',
  '',
].join('\r\n'));
console.log('Sample files written to', out);
