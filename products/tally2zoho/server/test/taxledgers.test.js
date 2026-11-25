// TDS and reverse charge ledgers against Zoho's own tax accounts (cluster tax-ledgers-rcm of the deep fix, 2026-11-14).
// Zoho Books posts the TDS of a bill to TDS Payable, of an invoice to TDS Receivable, and the reverse charge of a bill to
// Reverse Charge Tax Input but not due and to an Output account. The Tally ledgers that carried those amounts must end
// on the same Zoho accounts, or one balance is split between two accounts. Nothing here names a real company: every
// ledger, party and amount is made up, and the rules read Tally's fields and the batch's own documents, never a name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Decimal from 'decimal.js';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-taxledgers-'));
const { buildApp } = await import('../src/index.js');
const { NameSet } = await import('../src/tally.js');
const { buildVoucherOutput, taxLedgerInfo, taxAlignmentJournalRows, VOUCHER_SETTING_DEFAULTS } = await import('../src/vouchers.js');
const { tdsSuggestion } = await import('../src/defaults.js');
const { taxEvidenceFrom, evidenceAccount, ZOHO_TAX_POSTING_ACCOUNTS: A } = await import('../src/taxposting.js');
const { taxLedgerDefaults } = await import('../src/taxaccounts.js');
const { gstTreatment } = await import('../src/zoho.js');
const { voucher, line, ledger, group, utf16le } = await import('../fixtures/allTransactions.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(fs.readFileSync(path.resolve(here, '../seed-users.json'), 'utf8'));
const dec = x => new Decimal(x);

// ================= the voucher builder: what each bill and invoice posts in Zoho =================
const MASTERS = {
  'Input IGST': { taxtype: 'GST', gstdutyhead: 'IGST' }, 'Input CGST': { taxtype: 'GST', gstdutyhead: 'CGST' }, 'Input SGST': { taxtype: 'GST', gstdutyhead: 'SGST/UTGST' },
  'Import Tax Credit': { taxtype: 'GST', gstdutyhead: 'IGST' }, 'Import Tax Due': { taxtype: 'GST', gstdutyhead: 'IGST' },
  'Deducted Fees': { taxtype: 'TDS', tdsratename: '194J' }, 'Deducted Rent': { taxtype: 'TDS', tdsratename: '194I' }, 'Withheld By Buyers': { taxtype: 'TDS', tdsratename: '194J' },
};
const KINDS = { 'Cloud Hosting': 'expense', 'Legal Fees': 'expense', 'Service Income': 'income' };
const CONTACTS = {
  customers: { 'Buyer Fern': { treatment: 'business_gst', gstin: '29AAAAA0000A1Z2', place: 'KA' } },
  vendors: { 'Vendor Elm': { treatment: 'business_gst', gstin: '29BBBBB0000B1Z5', place: 'KA' }, 'Supplier Faraway': { treatment: 'business_none', gstin: '', place: '' },
    'Supplier Same State': { treatment: 'business_none', gstin: '', place: 'KA' } },
};
const ctxOf = (over = {}) => ({
  customers: new NameSet(Object.keys(CONTACTS.customers)), vendors: new NameSet(Object.keys(CONTACTS.vendors)), taxLedgers: new NameSet(Object.keys(MASTERS)),
  taxMap: {}, taxInfo: n => (MASTERS[n] ? taxLedgerInfo(MASTERS[n]) : null),
  kindOf: n => KINDS[n] ?? (MASTERS[n] ? 'tax' : CONTACTS.customers[n] ? 'customer' : CONTACTS.vendors[n] ? 'vendor' : null),
  tdsMap: {}, tdsDefault: n => tdsSuggestion(taxLedgerInfo(MASTERS[n] || {}), n), contactOf: (section, ledger) => CONTACTS[section][ledger] || null,
  gstRegisteredCodes: new Set(['business_gst']), defaultRouting: true, year: { from: '2025-04-01', to: '2026-03-31' }, ...over,
});
let nextId = 0;
const vch = (number, lines, over = {}) => ({ vouchernumber: number, date: '20250610', cmpgststate: 'Karnataka', allledgerentries: lines.map(([ledgername, amount, more]) => ({ ledgername, amount, ...(more || {}) })), ...over });
const rec = (slot, data) => ({ id: ++nextId, source_id: `g${nextId}`, name: `${slot} ${data.vouchernumber}`, slot, data });
const P = { ispartyledger: true };
const tdsBill = (n, tdsLedger = 'Deducted Fees', over) => rec('purchase', vch(n, [['Legal Fees', '-10000.00'], [tdsLedger, '1000.00'], ['Vendor Elm', '9000.00', P]], over));
const rcmBill = (n, vendor = 'Supplier Faraway', base = '1000.00', tax = '180.00', over) => rec('purchase', vch(n, [['Cloud Hosting', `-${base}`], ['Import Tax Credit', `-${tax}`], ['Import Tax Due', tax], [vendor, base, P]], over));
const invoiceTds = n => rec('sales', vch(n, [['Buyer Fern', '-9000.00', P], ['Withheld By Buyers', '-1000.00'], ['Service Income', '10000.00']]));
const taxRows = built => built.journals.rows.filter(x => x.generated && /^TAX/.test(x.row['Reference Number'])).map(x => [x.row.Account, x.row.Debit, x.row.Credit]);

test('the default for a reverse charge vendor with no GSTIN and no state is an import of services (user decision 4)', () => {
  assert.equal(VOUCHER_SETTING_DEFAULTS.rcmUnknownState, 'overseas');
  const b = rcmBill('RC-1');
  const built = buildVoucherOutput([b], ctxOf());
  const row = built.bills.rows[0].row;
  assert.deepEqual([row['GST Treatment'], row['Source of Supply'], row['Reverse Charge Tax Name'], row['Reverse Charge Tax Rate'], row['Reverse Charge Tax Type'], row['GST Identification Number (GSTIN)']],
    ['overseas', '', 'IGST18', '18', 'ItemAmount', '']);
  assert.match(built.exceptions.find(e => e.kind === 'rcm_state_unknown_assumed').message, /no GSTIN and no state.*outside India.*not confirmed/i);
  // the evidence names the vendor, so the Vendors file writes it as overseas too
  assert.deepEqual(taxEvidenceFrom(built.taxPostings).foreignVendors, ['Supplier Faraway']);
  // a vendor with a state is in India: never an import of services, whatever the setting
  const local = rcmBill('RC-2', 'Supplier Same State');
  const b2 = buildVoucherOutput([local], ctxOf());
  assert.deepEqual([b2.bills.rows[0].row['GST Treatment'], b2.bills.rows[0].row['Reverse Charge Tax Name']], ['business_none', 'GST18']);
  assert.deepEqual(taxEvidenceFrom(b2.taxPostings).foreignVendors, []);
  // a vendor with a GSTIN but no state is in India too (only its state is missing)
  const withGstin = buildVoucherOutput([rcmBill('RC-3')], ctxOf({ contactOf: () => ({ treatment: 'business_gst', gstin: '27CCCCC0000C1Z5', place: '' }) }));
  assert.equal(withGstin.bills.rows[0].row['GST Treatment'], 'business_gst');
  assert.deepEqual(taxEvidenceFrom(withGstin.taxPostings).foreignVendors, []);
});

test('second pass: the vendor is written as overseas, and its bill keeps IGST with no Source of Supply', () => {
  const b = rcmBill('RC-1');
  const overseas = { treatment: 'overseas', gstin: '', place: '' };
  const built = buildVoucherOutput([b], ctxOf({ contactOf: () => overseas, rcmForeignVendors: new Set(['Supplier Faraway']) }));
  const row = built.bills.rows[0].row;
  assert.deepEqual([row['GST Treatment'], row['Source of Supply'], row['Reverse Charge Tax Name'], row['Reverse Charge Tax Type']], ['overseas', '', 'IGST18', 'ItemAmount']);
  assert.ok(built.exceptions.some(e => e.kind === 'rcm_state_unknown_assumed'), 'the assumption is still said');
});

test('the evidence of the batch: which Tally ledger carried the TDS and the reverse charge of the documents written', () => {
  const built = buildVoucherOutput([tdsBill('B-1'), tdsBill('B-2'), tdsBill('B-3', 'Deducted Rent'), invoiceTds('S-1'), rcmBill('RC-1'), rcmBill('RC-2', 'Supplier Faraway', '2000.00', '360.00')], ctxOf());
  const ev = taxEvidenceFrom(built.taxPostings);
  assert.deepEqual(ev.tds, { 'Deducted Fees': { payable: { documents: 2, amount: '2000.00' } }, 'Deducted Rent': { payable: { documents: 1, amount: '1000.00' } }, 'Withheld By Buyers': { receivable: { documents: 1, amount: '1000.00' } } });
  assert.deepEqual(ev.rcmInput, { 'Import Tax Credit': { documents: 2, amount: '540.00' } });
  assert.deepEqual(ev.rcmOutput, { 'Import Tax Due': { documents: 2, amount: '540.00', heads: ['IGST'] } });
  // the Zoho account of each ledger, from the evidence alone (no ledger name is read)
  assert.equal(evidenceAccount('Deducted Fees', ev).account, A.tdsPayable);
  assert.equal(evidenceAccount('Deducted Rent', ev).account, A.tdsPayable);
  assert.equal(evidenceAccount('Withheld By Buyers', ev).account, A.tdsReceivable);
  assert.equal(evidenceAccount('Import Tax Credit', ev).account, A.rcmInput);
  assert.equal(evidenceAccount('Import Tax Due', ev).account, A.output.IGST);
  assert.equal(evidenceAccount('Input IGST', ev), null, 'a ledger no document uses');
  assert.equal(evidenceAccount('Deducted Fees', null), null, 'no evidence yet: nothing is decided');
});

test('the evidence never decides what it cannot: one ledger for two things, or a reverse charge written with two heads', () => {
  // one TDS ledger on a bill AND on an invoice: it cannot be TDS Payable and TDS Receivable at once
  const both = { tds: { 'Mixed TDS': { payable: { documents: 1, amount: '10.00' }, receivable: { documents: 1, amount: '5.00' } } } };
  assert.equal(evidenceAccount('Mixed TDS', both), null);
  // a ledger that is also the ordinary tax of a line stays where the GST rule puts it
  const ordinary = { rcmInput: { 'Input IGST': { documents: 1, amount: '18.00' } }, ordinaryTax: ['Input IGST'] };
  assert.equal(evidenceAccount('Input IGST', ordinary), null);
  // bills written with CGST and SGST: the one Tally output ledger cannot be two Zoho accounts
  const twoHeads = { rcmOutput: { 'Tax Due': { documents: 1, amount: '18.00', heads: ['CGST', 'SGST'] } } };
  assert.equal(evidenceAccount('Tax Due', twoHeads), null);
});

test('taxLedgerDefaults: a ledger the documents use is entered on Zoho\'s account; an unused TDS ledger stays an account of its own', () => {
  const groupCtx = { groupParents: { 'Duties & Taxes': 'Current Liabilities' }, groupReserved: { 'Duties & Taxes': 'Duties & Taxes' } };
  const L = (name, extra) => ({ name, data: { metadata: { type: 'Ledger', name }, parent: 'Duties & Taxes', ...extra } });
  const records = [L('Deducted Fees', { taxtype: 'TDS' }), L('Deducted Salary', { taxtype: 'TDS' }), L('Import Tax Credit', { taxtype: 'GST', gstdutyhead: 'IGST' }), L('Import Tax Due', { taxtype: 'GST', gstdutyhead: 'IGST' })];
  const ev = { tds: { 'Deducted Fees': { payable: { documents: 3, amount: '300.00' } } }, rcmInput: { 'Import Tax Credit': { documents: 1, amount: '18.00' } },
    rcmOutput: { 'Import Tax Due': { documents: 1, amount: '18.00', heads: ['IGST'] } }, ordinaryTax: [], foreignVendors: [] };
  const withEv = taxLedgerDefaults(records, groupCtx, {}, null, ev);
  assert.deepEqual(Object.fromEntries(Object.entries(withEv.decisions).map(([k, d]) => [k, [d.decision, d.zohoName, d.byDefault, d.taxKind]])), {
    'Deducted Fees': ['zoho', 'TDS Payable', true, 'tds'], 'Import Tax Credit': ['zoho', 'Reverse Charge Tax Input but not due', true, 'rcm'], 'Import Tax Due': ['zoho', 'Output IGST', true, 'rcm'] });
  assert.match(withEv.decisions['Deducted Fees'].why, /TDS ledger of 3 bills/);
  assert.equal(withEv.asks['Deducted Salary'], undefined, 'salary TDS, used by no bill: no question, an account of its own');
  // a decision a person stored always wins
  const kept = taxLedgerDefaults(records, groupCtx, { 'Deducted Fees': { decision: 'rename', newName: 'TDS Fees (own)' } }, null, ev);
  assert.equal(kept.decisions['Deducted Fees'], undefined);
  // the organisation's own account list has no such account: never used
  const noAccount = taxLedgerDefaults(records, groupCtx, {}, ['Output IGST', 'Input IGST'], ev);
  assert.equal(noAccount.decisions['Deducted Fees'], undefined);
  assert.equal(noAccount.decisions['Import Tax Due'].zohoName, 'Output IGST');
  // without evidence (no voucher processed yet) nothing changes: the TDS ledgers are asked about, as before
  const none = taxLedgerDefaults(records, groupCtx, {}, null, null);
  assert.deepEqual(Object.keys(none.decisions).sort(), ['Import Tax Credit', 'Import Tax Due'].sort(), 'GST duty head ledgers go by the GST rule');
  assert.deepEqual(Object.keys(none.asks).sort(), ['Deducted Fees', 'Deducted Salary']);
});

test('tax alignment journal: nothing is generated when every ledger is entered on the Zoho account the document posts to', () => {
  const names = { 'Deducted Fees': A.tdsPayable, 'Withheld By Buyers': A.tdsReceivable, 'Import Tax Credit': A.rcmInput, 'Import Tax Due': A.output.IGST };
  const built = buildVoucherOutput([tdsBill('B-1'), invoiceTds('S-1'), rcmBill('RC-1')], ctxOf({ accountName: n => names[n] || n }));
  assert.deepEqual(taxRows(built), []);
  assert.deepEqual(built.taxAlignmentJournals, []);
});

test('tax alignment journal: a TDS ledger kept as an account of its own gets the TDS Zoho put on TDS Payable', () => {
  const built = buildVoucherOutput([tdsBill('B-1'), tdsBill('B-2', 'Deducted Fees', { date: '20250620' }), tdsBill('B-3', 'Deducted Rent', { date: '20250705' }), invoiceTds('S-1')], ctxOf());
  // June: two bills (Dr TDS Payable 2000, Cr the ledger) and one invoice (Dr the ledger, Cr TDS Receivable 1000); July: one bill
  assert.deepEqual(taxRows(built), [
    [A.tdsPayable, '2000.00', ''], ['Deducted Fees', '', '2000.00'], [A.tdsReceivable, '', '1000.00'], ['Withheld By Buyers', '1000.00', ''],
    [A.tdsPayable, '1000.00', ''], ['Deducted Rent', '', '1000.00']]);
  assert.deepEqual(built.taxAlignmentJournals.map(j => [j.number, j.date, j.documents, j.tds, j.reverseCharge]), [['TAX-202506', '2025-06-20', 3, true, false], ['TAX-202507', '2025-07-05', 1, true, false]]);
  // every generated journal balances
  for (const j of built.taxAlignmentJournals) assert.equal(j.accounts.reduce((t, a) => t.plus(a.debit || 0).minus(a.credit || 0), dec(0)).toFixed(2), '0.00');
});

test('tax alignment journal: reverse charge written with another head than Tally\'s, and a paisa of rounding, both end at Tally\'s figures', () => {
  // the vendor is inside the company's state: Tally's IGST is written as the CGST and SGST group. Zoho debits its input
  // account and credits Output CGST and Output SGST; Tally debited and credited its own two ledgers.
  const names = { 'Import Tax Credit': A.rcmInput, 'Import Tax Due': 'Import Tax Due' };
  let built = buildVoucherOutput([rcmBill('RC-1', 'Supplier Same State')], ctxOf({ accountName: n => names[n] || n }));
  assert.deepEqual(taxRows(built), [[A.output.CGST, '90.00', ''], [A.output.SGST, '90.00', ''], ['Import Tax Due', '', '180.00']]);
  // Zoho works 18% of 1000.03 out as 180.01; Tally booked 180.00: the paisa is moved, on Zoho's own accounts
  const all = { 'Import Tax Credit': A.rcmInput, 'Import Tax Due': A.output.IGST };
  built = buildVoucherOutput([rcmBill('RC-2', 'Supplier Faraway', '1000.03', '180.00')], ctxOf({ accountName: n => all[n] || n }));
  assert.deepEqual(taxRows(built), [[A.rcmInput, '', '0.01'], [A.output.IGST, '0.01', '']]);
  assert.equal(built.taxAlignmentJournals[0].reverseCharge, true);
  // the same ledgers kept as accounts of their own: the whole reverse charge is moved back to them
  built = buildVoucherOutput([rcmBill('RC-3')], ctxOf());
  assert.deepEqual(taxRows(built), [[A.rcmInput, '', '180.00'], ['Import Tax Credit', '180.00', ''], [A.output.IGST, '180.00', ''], ['Import Tax Due', '', '180.00']]);
});

test('taxAlignmentJournalRows: an account name is compared as Zoho compares names, and a taken number is never reused', () => {
  const postings = [{ file: 'bills', date: '2025-06-10', number: 'B-1', taxPosting: { tds: { ledger: 'L', amount: dec('50') }, rcm: null } }];
  assert.deepEqual(taxAlignmentJournalRows(postings, { accountName: () => 'tds  payable' }).rows, [], 'the same account, written with other spacing and capitals');
  const r = taxAlignmentJournalRows(postings, { accountName: n => n }, new Set(['TAX-202506']));
  assert.deepEqual([...new Set(r.rows.map(x => x['Reference Number']))], ['TAX2-202506']);
  assert.deepEqual(r.rows.map(x => x.Status), ['published', 'published']);
});

test('gstTreatment: a vendor marked as an import of services is overseas, unless it has a valid GSTIN', () => {
  assert.equal(gstTreatment({ registrationType: 'Unregistered', country: 'India', importOfServices: true }).value, 'overseas');
  assert.equal(gstTreatment({ registrationType: 'Regular', country: 'India', importOfServices: true, treatmentOverride: 'unregistered' }).value, 'overseas');
  assert.equal(gstTreatment({ registrationType: 'Unregistered', country: 'India' }).value, 'business_none');
  assert.equal(gstTreatment({ registrationType: 'Regular', country: 'India', gstin: '29AAAAA0000A1Z5', importOfServices: true }).value, 'business_gst');
});

test('Zoho\'s TDS export: the account each tax posts to is read; a tax linked to another account is said, a missing column is not a mismatch', async () => {
  const { readZohoTdsTaxes } = await import('../src/voucheropts.js');
  const { setupHints } = await import('../src/importwizard.js');
  const csv = ['Tax ID,TDS Name,TDS Percentage,TDS Section Code,Account To Track Sales,Account To Track Purchases,Start Date,End Date,Tax Status',
    '1,Fees Tax,10.000000,194J,TDS Receivable,TDS Payable,2025-04-01,,Active', '2,Rent Tax,10.000000,194I,TDS Receivable,Rent TDS Own Account,2025-04-01,,Active'].join('\r\n');
  const read = readZohoTdsTaxes(Buffer.from(csv));
  assert.deepEqual(read.taxes.map(t => [t.name, t.salesAccount, t.purchaseAccount]), [['Fees Tax', 'TDS Receivable', 'TDS Payable'], ['Rent Tax', 'TDS Receivable', 'Rent TDS Own Account']]);
  const bare = readZohoTdsTaxes(Buffer.from('TDS Name,TDS Percentage,TDS Section Code\r\nFees Tax,10,194J'));
  assert.deepEqual(bare.taxes.map(t => [t.salesAccount, t.purchaseAccount]), [['', '']]);
  const facts = { overseas: { customers: 0, vendors: 0 }, sez: { customers: 0, vendors: 0 }, composition: { customers: 0, vendors: 0 }, reverseChargeBills: 0, reverseChargeNoState: 0 };
  const hints = tds => setupHints({ job: {}, fy: null, facts, tds }).tds.join(' ');
  assert.match(hints({ taxes: [{ name: 'Fees Tax', accountDiffers: [] }], exportGiven: true, toCreate: 0 }), /Leave the accounts of every TDS tax.*"TDS Payable".*"TDS Receivable"/);
  assert.doesNotMatch(hints({ taxes: [{ name: 'Fees Tax', accountDiffers: [] }], exportGiven: true, toCreate: 0 }), /Check before you import/);
  assert.match(hints({ taxes: [{ name: 'Rent Tax', accountDiffers: ['Rent TDS Own Account'] }], exportGiven: true, toCreate: 0 }), /Check before you import.*"Rent Tax" posts to "Rent TDS Own Account"/);
});

// ================= end to end, on a made-up company =================
const MASTER_RECORDS = [
  { metadata: { type: 'Currency', name: 'INR' } },
  group('Current Assets', null), group('Current Liabilities', null), group('Indirect Expenses', null), group('Sales Accounts', null),
  group('Sundry Debtors', 'Current Assets'), group('Sundry Creditors', 'Current Liabilities'), group('Duties & Taxes', 'Current Liabilities'), group('Bank Accounts', 'Current Assets'),
  ledger('Harbour Bank', 'Bank Accounts', { openingbalance: '-750.00' }),
  ledger('Buyer Fern', 'Sundry Debtors', { gstregistrationtype: 'Regular', partygstin: '29AAAAA0000A1ZU', ledstatename: 'Karnataka', countryname: 'India' }),
  // TDS deducted by customers, on a TDS ledger under Duties & Taxes
  ledger('Withheld By Buyers', 'Duties & Taxes', { taxtype: 'TDS', tdsratename: '194J' }),
  ledger('Legal Fees', 'Indirect Expenses'), ledger('Cloud Hosting', 'Indirect Expenses'), ledger('Salaries', 'Indirect Expenses'), ledger('Consulting Income', 'Sales Accounts'),
  // Tally's TDS ledgers, one per section. The first two are on bills; the third only on a journal (salary).
  ledger('Deducted Fees', 'Duties & Taxes', { taxtype: 'TDS', tdsratename: '194J', openingbalance: '500.00' }),
  ledger('Deducted Rent', 'Duties & Taxes', { taxtype: 'TDS', tdsratename: '194I' }),
  ledger('Deducted Salary', 'Duties & Taxes', { taxtype: 'TDS', tdsratename: '192B', openingbalance: '250.00' }),
  // the reverse charge ledgers: nothing in their names says so
  ledger('Import Tax Credit', 'Duties & Taxes', { taxtype: 'GST', gstdutyhead: 'IGST' }),
  ledger('Import Tax Due', 'Duties & Taxes', { taxtype: 'GST', gstdutyhead: 'IGST' }),
  ledger('IGST Paid On Purchases', 'Duties & Taxes', { taxtype: 'GST', gstdutyhead: 'IGST', isinputcredit: true }),
  ledger('Vendor Elm', 'Sundry Creditors', { gstregistrationtype: 'Regular', partygstin: '29BBBBB0000B1ZC', ledstatename: 'Karnataka', countryname: 'India' }),
  // no GSTIN, no state; Tally's mailing details still say India (its default)
  ledger('Supplier Faraway', 'Sundry Creditors', { gstregistrationtype: 'Unregistered', countryname: 'India' }),
  ledger('Vendor Plain', 'Sundry Creditors', { gstregistrationtype: 'Unregistered', ledstatename: 'Karnataka', countryname: 'India' }),
  ...['Sales', 'Purchase', 'Receipt', 'Payment', 'Journal', 'Contra', 'Debit Note', 'Credit Note'].map(t => ({ metadata: { type: 'Voucher Type', name: t, reservedname: t }, parent: t, isactive: true })),
];
const PP = { ispartyledger: true };
const VOUCHERS = [
  // two bills with TDS, on two TDS ledgers
  voucher('Purchase', 'PB-1', '20250410', [line('Legal Fees', '-10000.00'), line('Deducted Fees', '1000.00'), line('Vendor Elm', '9000.00', PP)], { party: 'Vendor Elm' }),
  voucher('Purchase', 'PB-2', '20250512', [line('Legal Fees', '-5000.00'), line('Deducted Rent', '500.00'), line('Vendor Elm', '4500.00', PP)], { party: 'Vendor Elm' }),
  // an import of services: IGST under reverse charge, the supplier has no GSTIN and no state
  voucher('Purchase', 'PB-3', '20250615', [line('Cloud Hosting', '-2000.00'), line('Import Tax Credit', '-360.00'), line('Import Tax Due', '360.00'), line('Supplier Faraway', '2000.00', PP)], { party: 'Supplier Faraway' }),
  // the reverse charge is paid and the credit is taken (Tally: the set-off journals)
  voucher('Journal', 'J-1', '20250630', [line('Import Tax Due', '-360.00'), line('Harbour Bank', '360.00')]),
  voucher('Journal', 'J-2', '20250630', [line('IGST Paid On Purchases', '-360.00'), line('Import Tax Credit', '360.00')]),
  // an invoice on which the customer deducted TDS
  voucher('Sales', 'SI-1', '20250720', [line('Buyer Fern', '-9000.00', PP), line('Withheld By Buyers', '-1000.00'), line('Consulting Income', '10000.00')], { party: 'Buyer Fern', extra: { placeofsupply: 'Karnataka' } }),
  // the TDS is paid to the government; salary TDS is booked and paid by journals only
  voucher('Journal', 'J-3', '20250707', [line('Deducted Fees', '-1500.00'), line('Deducted Rent', '-500.00'), line('Harbour Bank', '2000.00')]),
  voucher('Journal', 'J-4', '20250731', [line('Salaries', '-900.00'), line('Deducted Salary', '90.00'), line('Harbour Bank', '810.00')]),
];

// The Trial Balance report of those masters and vouchers, at ledger level (Tally's sign: a debit is negative).
function trialBalance() {
  const fig = new Map();
  const at = n => { if (!fig.has(n)) fig.set(n, { op: dec(0), dr: dec(0), cr: dec(0) }); return fig.get(n); };
  for (const m of MASTER_RECORDS) if (m.metadata.type === 'Ledger' && m.openingbalance) at(m.metadata.name).op = dec(m.openingbalance);
  for (const v of VOUCHERS) for (const l of v.allledgerentries || v.ledgerentries || []) { const a = dec(l.amount); if (a.isNegative()) at(l.ledgername).dr = at(l.ledgername).dr.plus(a.abs()); else at(l.ledgername).cr = at(l.ledgername).cr.plus(a); }
  const amount = (outer, inner, x) => ({ [outer]: x.isZero() ? {} : { [inner]: x.toNumber() } });
  return { dspaccbody: { dspaccline: [...fig].map(([name, f]) => ({ dspaccname: { dspdispname: name },
    dspaccinfo: [{ ...amount('dspopamt', 'dspopamta', f.op), ...amount('dspdramt', 'dspdramta', f.dr.negated()), ...amount('dspcramt', 'dspcramta', f.cr), ...amount('dspclamt', 'dspclamta', f.op.minus(f.dr).plus(f.cr)) }] })) } };
}

const app = buildApp();
let cookie = '';
const call = opts => app.inject({ ...opts, headers: { ...(opts.headers || {}), ...(cookie ? { cookie } : {}) } });
const get = async url => { const r = await call({ url }); assert.equal(r.statusCode, 200, `${url}: ${r.body}`); return r.json(); };
const send = (method, url, payload) => call({ method, url, ...(payload !== undefined ? { payload } : {}) });
const putFile = (url, buffer, name) => call({ method: 'PUT', url, headers: { 'content-type': 'application/octet-stream', 'x-filename': name }, payload: buffer });
function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) { const c = s[i]; if (q) { if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; } else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; } else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; } else if (c !== '\r') f += c; }
  if (f || row.length) { row.push(f); rows.push(row); }
  const h = rows.shift();
  return rows.filter(r => r.length > 1).map(r => Object.fromEntries(h.map((k, j) => [k.trim(), r[j] ?? ''])));
}

test('end to end: TDS and reverse charge ledgers end on Zoho\'s own accounts, the supplier outside India is overseas, and the wizard asks for SEZ / Overseas Trading', async () => {
  const u = seed.users.find(x => x.role === 'super_admin') || seed.users[0];
  cookie = String((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: u.password } })).headers['set-cookie']).split(';')[0];
  const id = (await send('POST', '/api/migrations', { company: 'Made Up Imports Co', financialYear: '2025-26' })).json().id;
  const base = `/api/migrations/${id}`;
  assert.equal((await putFile(`${base}/uploads/all_masters`, utf16le({ tallymessage: MASTER_RECORDS }), 'Master.json')).statusCode, 200);
  assert.equal((await putFile(`${base}/uploads/all_transactions`, utf16le({ tallymessage: VOUCHERS }), 'Transactions.json')).statusCode, 200);
  await send('PUT', `${base}/waivers/stock_summary`, { reason: 'A services company: no stock' });
  assert.equal((await putFile(`${base}/uploads/trial_balance`, utf16le(trialBalance()), 'TrialBal.json')).statusCode, 200);
  const p = await send('POST', `${base}/process?wait=1`);
  assert.equal(p.statusCode, 200, p.body);
  const g = await send('POST', `${base}/generate`);
  assert.equal(g.statusCode, 200, g.body);
  const files = await get(`${base}/files`);
  const csv = async key => { const f = files.find(x => x.key === key); assert.ok(f, `file ${key}`); const r = await call({ url: `${base}/files/${key}/download?confirmed=1` }); assert.equal(r.statusCode, 200, r.body); return parseCsv(r.body); };

  // 1. the Chart of Accounts: the ledgers the documents use are left out; the unused TDS ledger stays
  const chart = (await csv('accounts')).map(r => r['Account Name']);
  for (const gone of ['Deducted Fees', 'Deducted Rent', 'Import Tax Credit', 'Import Tax Due']) assert.ok(!chart.includes(gone), `${gone} is not an account of its own`);
  assert.ok(chart.includes('Deducted Salary'), 'salary TDS, on no bill, stays an account of its own');

  // 2. the journals name Zoho's accounts for those ledgers
  const journals = await csv('journals');
  const accountsOf = number => journals.filter(r => `${r['Journal Number Prefix']}${r['Journal Number Suffix']}`.endsWith(number) || r['Reference Number'] === number).map(r => [r.Account, r.Debit, r.Credit]);
  const used = new Set(journals.map(r => r.Account));
  for (const gone of ['Deducted Fees', 'Deducted Rent', 'Import Tax Credit', 'Import Tax Due']) assert.ok(!used.has(gone), `no journal line names ${gone}`);
  assert.ok(used.has('TDS Payable') && used.has('Reverse Charge Tax Input but not due') && used.has('Output IGST') && used.has('Deducted Salary'));
  assert.equal(journals.filter(r => /^TAX/.test(r['Reference Number'])).length, 0, 'nothing is left to align');
  assert.ok(accountsOf('J-3').length >= 3);

  // 3. what Zoho ends with on its own accounts equals Tally, account by account
  const bal = {};
  const post = (a, x) => { bal[a] = (bal[a] || dec(0)).plus(x); };
  for (const r of journals) post(r.Account, dec(r.Debit || 0).minus(r.Credit || 0));
  for (const r of await csv('opening_balances_for_zoho_accounts')) post(r.Account, dec(r.Debit || 0).minus(r.Credit || 0));
  const bills = await csv('bills');
  const seen = new Set();
  for (const r of bills) {
    if (r['TDS Amount'] && !seen.has(r['Bill Number'])) { seen.add(r['Bill Number']); post('TDS Payable', dec(r['TDS Amount']).negated()); }
    if (r['Reverse Charge Tax Name']) { const t = dec(r.Rate).times(r.Quantity || 1).times(r['Reverse Charge Tax Rate']).div(100).toDecimalPlaces(2); post('Reverse Charge Tax Input but not due', t); post('Output IGST', t.negated()); }
  }
  // Tally: Deducted Fees opening 500 Cr + 1000 Cr - 1500 Dr = 0; Deducted Rent 500 Cr - 500 Dr = 0 -> TDS Payable 0
  assert.equal(bal['TDS Payable'].toFixed(2), '0.00');
  // Tally: Import Tax Credit 360 Dr - 360 Cr = 0; Import Tax Due 360 Cr - 360 Dr = 0
  assert.equal(bal['Reverse Charge Tax Input but not due'].toFixed(2), '0.00');
  assert.equal(bal['Output IGST'].toFixed(2), '0.00');
  // Tally: Withheld By Buyers 1000 Dr -> TDS Receivable 1000 Dr, from the invoice's TDS columns alone
  const invoices = await csv('invoices');
  assert.deepEqual(invoices.map(r => r['TDS Amount']), ['1000.00']);
  assert.ok(!used.has('Withheld By Buyers') && !chart.includes('Withheld By Buyers'));

  // 4. the supplier outside India: the vendor AND its bill are overseas, IGST under reverse charge, no Source of Supply
  const vendors = await csv('vendors');
  const far = vendors.find(r => r['Display Name'] === 'Supplier Faraway');
  assert.deepEqual([far['GST Treatment'], far['Source Of Supply'], far['GST Identification Number (GSTIN)']], ['overseas', '', '']);
  assert.equal(vendors.find(r => r['Display Name'] === 'Vendor Plain')['GST Treatment'], 'business_none', 'an unregistered vendor with a state and no reverse charge stays as it is');
  const rc = bills.find(r => r['Vendor Name'] === 'Supplier Faraway');
  assert.deepEqual([rc['GST Treatment'], rc['Source of Supply'], rc['Reverse Charge Tax Name'], rc['Reverse Charge Tax Rate'], rc['Reverse Charge Tax Type']], ['overseas', '', 'IGST18', '18', 'ItemAmount']);

  // 5. the Import Wizard: SEZ / Overseas Trading with its Custom Duty Tracking Account is a tick of its own, and the
  //    accounts wait for it like for every set-up tick
  let wz = await get(`${base}/import-wizard`);
  const setup = wz.steps.find(s => s.kind === 'setup');
  const gst = setup.items.find(i => /^gst$/i.test(i.what));
  const tick = gst.ticks.find(t => /overseas$/.test(t.id));
  assert.ok(tick, 'the tick exists');
  assert.match(tick.text, /SEZ \/ Overseas Trading is ticked.*Custom Duty Tracking Account.*1 vendor/);
  assert.equal(tick.done, false);
  for (const i of setup.items) for (const t of i.ticks) if (t.id !== tick.id) await send('PUT', `${base}/import-wizard/ticks`, { step: 'setup', item: t.id, done: true });
  wz = await get(`${base}/import-wizard`);
  assert.equal(wz.steps.find(s => s.kind === 'setup').open, 1, 'only the overseas tick is open');
  const accountsStep = wz.steps.find(s => s.key === 'accounts' || s.fileKey === 'accounts' || s.file?.key === 'accounts');
  if (accountsStep) assert.equal(accountsStep.locked, true, 'the Chart of Accounts waits for the set-up');
  assert.equal(setup.questions.find(q => q.id === 'rcmUnknownState').value, 'overseas');

  // the list of TDS taxes to create names the accounts to leave on each tax; with an export that links one tax of the
  // bills to another account, that tax is pointed out
  let list = await get(`${base}/tds-taxes-to-create`);
  assert.ok(list.taxes.length >= 2);
  assert.ok(list.taxes.every(t => t.payableAccount === 'TDS Payable' && t.receivableAccount === 'TDS Receivable' && t.accountDiffers.length === 0));
  const exportCsv = ['TDS Name,TDS Percentage,TDS Section Code,Account To Track Sales,Account To Track Purchases',
    ...list.taxes.map((t, i) => `${t.name},${t.rate},${t.section},TDS Receivable,${i === 0 && t.onBills ? 'Some Other Liability' : 'TDS Payable'}`)].join('\r\n');
  assert.equal((await putFile(`${base}/zoho-tds-taxes`, Buffer.from(exportCsv), 'tds.csv')).statusCode, 200);
  list = await get(`${base}/tds-taxes-to-create`);
  assert.deepEqual(list.taxes.filter(t => t.accountDiffers.length).map(t => t.accountDiffers), list.taxes[0].onBills ? [['Some Other Liability']] : []);
  assert.equal((await send('DELETE', `${base}/zoho-tds-taxes`)).statusCode, 200);
  assert.equal((await send('POST', `${base}/generate`)).statusCode, 200);

  // 6. each default is in "Assumptions the tool made"
  const kinds = Object.fromEntries((await get(`${base}/assumptions`)).assumptions.map(a => [a.kind, a.count]));
  assert.equal(kinds.tds_ledger_to_zoho_account, 3);
  assert.equal(kinds.rcm_ledger_to_zoho_account, 2);
  assert.equal(kinds.tds_ledger_kept_separate, 1);
  assert.equal(kinds.vendor_overseas_reverse_charge, 1);
  assert.equal(kinds.rcm_state_unknown_assumed, 1);
  assert.equal(kinds.tax_ledger_needs_decision, undefined, 'nothing is left for a person to decide');

  // 7. the other answer to the wizard question: the vendor is in India. Vendor and bill go back to unregistered and GST,
  //    and the alignment journal moves the reverse charge payable from the two heads Zoho credits to the account of Tally's ledger
  assert.equal((await send('PUT', `${base}/voucher-settings`, { rcmUnknownState: 'intra' })).statusCode, 200);
  assert.equal((await send('POST', `${base}/generate`)).statusCode, 200);
  const files2 = await get(`${base}/files`);
  const csv2 = async key => parseCsv((await call({ url: `${base}/files/${key}/download?confirmed=1` })).body);
  assert.ok(files2.length);
  assert.equal((await csv2('vendors')).find(r => r['Display Name'] === 'Supplier Faraway')['GST Treatment'], 'business_none');
  assert.equal((await csv2('bills')).find(r => r['Vendor Name'] === 'Supplier Faraway')['Reverse Charge Tax Name'], 'GST18');
  // (the output ledger has an IGST duty head, so by the GST rule it is on Output IGST; the bills now credit Output CGST and SGST)
  const tax = (await csv2('journals')).filter(r => /^TAX/.test(r['Reference Number'])).map(r => [r.Account, r.Debit, r.Credit]);
  assert.deepEqual(tax, [['Output CGST', '180.00', ''], ['Output SGST', '180.00', ''], ['Output IGST', '', '360.00']]);
  const wz2 = await get(`${base}/import-wizard`);
  assert.equal(wz2.steps.find(s => s.kind === 'setup').items.find(i => /^gst$/i.test(i.what)).ticks.some(t => /overseas$/.test(t.id)), false, 'no party outside India: no such tick');
});
