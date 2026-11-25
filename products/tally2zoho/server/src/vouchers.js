// Voucher routing and Zoho voucher output (Invoices, Bills, Manual Journals).
//
// The layouts of the three files are the official Zoho Books (India) import samples (see "Zoho voucher files" below).
// The GST of a voucher is put on the line it belongs to (no separate tax rows), and tax deducted at source on a bill
// goes to Zoho's TDS columns, from the accountant's TDS mapping.

import Decimal from 'decimal.js';
import { money, parseTallyAmount, isoDate, impossibleDateWords, voucherBalance, ledgerEntryList, voucherStatus, tallyText, lineList, entryVchType, hasPostingLines, unverifiedStatusFlags } from './tally.js';
import { OTHER_SLOT, routeVoucherType, isNonPostingBase } from './transactions.js';
import { stateCode, gstinStateCode, accountNameKey } from './zohocodes.js';
import { JOURNAL_SAMPLE_HEADERS } from './zoho.js';
import { MONEY_SLOTS, JOURNAL_CODES, TYPE_WORDS, classifyMoneyVoucher, newRefIndex, documentIndex, allocate, MODULE_AS_JOURNAL, JOURNAL_CATEGORIES, PAYMENTS_ROUTE_OPTIONS, creditLinesOf } from './payments.js';
export { PAYMENTS_ROUTE_OPTIONS };
import { resolveTds, RATE_WORDS, ACT_WORDS, tdsTaxToCreate, cleanTdsRate, tcsNatureOf, tcsTaxName } from './tds.js';
import { ZOHO_TAX_POSTING_ACCOUNTS } from './taxposting.js';
import { applyCorrection } from './vouchercorrections.js';
import { hsnForZoho, resolveHsn, billLineWithoutTax, defaultJournalRoute, isReimbursementJournal, defaultZohoTaxName, zohoTaxToCreate, invoiceLineWithoutTax, ROUND_OFF_DESCRIPTION, serviceItemName, CUSTOMER_TDS_DEFAULT } from './defaults.js';

export const DECISIONS = ['Invoice', 'Bill', 'Manual Journal'];
// v2 default 8: a journal routed BY DEFAULT to a Bill or Invoice that would carry one of these flags is written as a
// Manual Journal instead (a decision made by a person is always written as decided): a row Zoho refuses, GST that
// cannot be put on the lines (or only half of it named), reverse charge that cannot be written in its columns, or an
// invoice line on an account that is not an income account (a Manual Journal posts it to its own ledger).
export const DEFAULT_ROUTE_REFUSED_KINDS = ['forex_document_not_in_contact_currency', 'bill_line_needs_tax_or_exemption', 'tax_not_attributable', 'tax_heads_incomplete', 'reverse_charge_bill', 'invoice_line_to_adjustment', 'invoice_line_not_income', 'tds_details_missing'];

// Why a journal routed by default to a Bill or Invoice is written as a Manual Journal instead (the flag that refused it).
export const FALLBACK_WORDS = {
  bill_line_needs_tax_or_exemption: 'it would have lines Zoho refuses ("Specify either a Tax or Tax Exemption or Reverse Charge.")',
  tax_not_attributable: 'its GST could not be put on its lines',
  tax_heads_incomplete: 'it carries CGST without SGST (or the reverse), for which Zoho has no tax',
  reverse_charge_bill: 'its reverse-charge GST could not be written in the Reverse Charge columns',
  invoice_line_to_adjustment: 'it has lines on accounts that are not income accounts, which an invoice can only carry in its Adjustment (a Manual Journal keeps each ledger)',
  invoice_line_not_income: 'none of its lines is on an income account',
  tds_details_missing: 'the percentage or the section code of its TDS could not be worked out, and Zoho refuses a TDS row without them ("Enter the required TDS details.")',
  forex_document_not_in_contact_currency: 'the party is kept in another currency and the voucher has no foreign amounts, so it could only be written in rupees, which Zoho refuses for such a party',
};

// The options suggestJournal needs to know which credited (debited) tax ledgers a Bill (Invoice) carries in its own
// columns, not as a negative row: one TDS ledger whose Zoho TDS tax is chosen or suggested from its section goes to the
// TDS columns; GST under reverse charge (the same GST debited and credited) goes to the Reverse Charge columns.
// ctx: { kindOf, taxLedgers (NameSet), taxInfo(ledger), tdsMap, tdsDefault(ledger), customerTds(ledger) } (the voucher
// build context). The same options are used for the files and for Voucher Classification, so both say the same.
export function routingOptions(ctx) {
  const canonical = n => ctx.taxLedgers?.canonical?.(n) ?? n;
  const taxInfo = n => (ctx.taxLedgers?.has(n) ? ctx.taxInfo?.(canonical(n)) || null : null);
  return {
    kindOf: ctx.kindOf || null, taxLedgers: ctx.taxLedgers, taxInfo,
    // doc 'Bill': TDS deducted from the vendor; 'Invoice': TDS deducted by the customer (always written in the invoice's
    // TDS columns: with no section in Tally the default TDS tax for a customer is written, flagged)
    tdsColumn: (n, doc) => {
      if (doc === 'Invoice') return !!(ctx.customerTds?.(n) || taxInfo(n)?.tds);
      const ti = taxInfo(n);
      return !!ti?.tds && !!(ctx.tdsMap?.[canonical(n)]?.tdsName || ctx.tdsMap?.[n]?.tdsName || ctx.tdsDefault?.(n));
    },
  };
}

// All accounting lines of a voucher: { ledger, amount (Decimal, Tally sign: debit negative), party, rates, hsn, item, qty, rate }
// The ledger lines come from "allledgerentries" (accounting view) or "ledgerentries" (invoice view): see ledgerEntryList
// in tally.js for what happens when a voucher carries both. rates: the GST rate per duty head Tally keeps on the line
// (ratedetails), or null; hsn: the HSN/SAC code Tally keeps on the line, or ''.
// forex: for a line on a ledger kept in another currency ("-€8500.00 @ ₹91.80/€ = -₹780300.00", tally.js
// parseTallyAmount): { fx (Decimal, Tally's sign), symbol, rate }; amount is then the rupee value. null otherwise.
const forexOf = text => { const a = parseTallyAmount(text); return a?.fx ? { fx: a.fx, symbol: a.currencySymbol, rate: a.rate } : null; };
export function voucherLines(v) {
  const lines = [];
  for (const le of ledgerEntryList(v).entries) {
    lines.push({ ledger: String(le.ledgername || ''), amount: money(le.amount), party: le.ispartyledger === true, rates: lineRates(le.ratedetails), hsn: hsnOf(le.gsthsnname, le.hsncode), forex: forexOf(le.amount),
      typeOfSupply: /^(goods|services)$/i.test(String(le.gstovrdntypeofsupply ?? '').trim()) ? String(le.gstovrdntypeofsupply).trim() : '' });
  }
  for (const inv of lineList(v.allinventoryentries)) { // TALLY-013: a list written as one object, or with null items, is read safely
    for (const al of lineList(inv.accountingallocations)) {
      lines.push({ ledger: String(al.ledgername || ''), amount: money(al.amount), item: String(inv.stockitemname || ''), qty: String(inv.billedqty || inv.actualqty || '').trim(), rate: String(inv.rate || '').trim(),
        rates: lineRates(inv.ratedetails) || lineRates(al.ratedetails), hsn: hsnOf(inv.gsthsnname, inv.hsncode, al.gsthsnname), forex: forexOf(al.amount) });
    }
  }
  return lines;
}

// ---------- what kind of ledger a line names ----------
// Decided from Tally's own group above the ledger (the group chain is walked up; a renamed Tally group is recognised by
// its reserved name). Used only to explain and sharpen the journal suggestions. null when the group is not known.
export const LEDGER_KIND_BY_GROUP = Object.assign(Object.create(null), { // no prototype: a group named "constructor" is a plain name (TALLY-014)
  'Sales Accounts': 'income', 'Direct Incomes': 'income', 'Indirect Incomes': 'income',
  'Purchase Accounts': 'expense', 'Direct Expenses': 'expense', 'Indirect Expenses': 'expense', 'Fixed Assets': 'asset',
  'Duties & Taxes': 'tax', 'Bank Accounts': 'bank', 'Bank OD A/c': 'bank', 'Bank OCC A/c': 'bank', 'Cash-in-Hand': 'bank',
  'Sundry Debtors': 'customer', 'Sundry Creditors': 'vendor',
});

// Suggest where a journal voucher belongs. Returns { suggested, reason, clear, needsCheck }. Never applied without user approval.
// needsCheck is true when the suggestion is a Bill or an Invoice that would carry a negative row (a ledger on the same
// side as the party: tax deducted at source, tax under reverse charge, a discount, a round-off). The reason says so.
// "Accept clear suggestions" never approves a suggestion with clear false or needsCheck true.
// clear is false when the pattern is not a plain sale, purchase or journal: the suggestion is then "Manual Journal"
// only because nothing better can be said, and the reason says what to look at.
// opts.kindOf(ledger): 'income' | 'expense' | 'asset' | 'tax' | 'bank' | 'customer' | 'vendor' | 'other', or null when
// the ledger's group is not known. Without it (or for ledgers of unknown kind) the suggestion rests on the customer
// and vendor lines alone, as before.
//
// The rules, in order (drawn from the structure of real journals, where purchases are entered as journals with exactly
// one vendor ledger credited and expense and tax ledgers debited):
//   1. exactly one vendor line, credited, and no customer line -> Bill, unless every other debited ledger is known and
//      none of them is an expense, purchase or fixed asset ledger, or a bank or cash ledger is on the voucher;
//   2. exactly one customer line, debited, and no vendor line -> Invoice, unless every other credited ledger is known
//      and none of them is a sales or income ledger, or a bank or cash ledger is on the voucher;
//   3. no customer or vendor line -> Manual Journal;
//   4. anything else -> Manual Journal, marked as not clear, with what was seen.
export function suggestJournal(v, customers, vendors, opts = {}) {
  const lines = voucherLines(v);
  const kindOf = name => (opts.kindOf ? opts.kindOf(name) : null);
  const cust = lines.filter(l => customers.has(l.ledger));
  const vend = lines.filter(l => vendors.has(l.ledger));
  const isDebit = l => !!l.amount?.isNegative();
  const isCredit = l => !!l.amount && !l.amount.isNegative() && !l.amount.isZero();
  const unclear = reason => ({ suggested: 'Manual Journal', reason: `${reason} Please review.`, clear: false, needsCheck: false });
  const isTaxKind = k => k.kind === 'tax' || !!opts.taxLedgers?.has(k.l.ledger);
  const isAre = n => (n === 1 ? 'is' : 'are');
  const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  if (vend.length === 1 && cust.length === 0 && isCredit(vend[0])) {
    const rest = lines.filter(l => l !== vend[0]);
    const kinds = rest.map(l => ({ l, kind: kindOf(l.ledger) }));
    if (kinds.some(k => k.kind === 'bank')) return unclear(`Vendor "${vend[0].ledger}" is credited, but a bank or cash ledger is on the voucher too, so it also records money paid or received. The pattern is not a plain purchase.`);
    const debits = kinds.filter(k => isDebit(k.l));
    const bought = debits.filter(k => k.kind === 'expense' || k.kind === 'asset');
    const unknown = debits.filter(k => k.kind === null && !opts.taxLedgers?.has(k.l.ledger));
    if (opts.kindOf && !bought.length && !unknown.length) {
      return unclear(`Vendor "${vend[0].ledger}" is credited, but nothing is debited to an expense, purchase or fixed asset ledger, so this does not look like a purchase (for example a transfer between accounts or an adjustment).`);
    }
    const taxDr = kinds.filter(k => isDebit(k.l) && isTaxKind(k)).length;
    const crTax = kinds.filter(k => isCredit(k.l) && isTaxKind(k));
    // credited tax ledgers the bill carries in its own columns (routingOptions): ONE TDS ledger with a Zoho TDS tax goes
    // to the TDS columns; GST credited with the same amount per duty head as GST debited is reverse charge, written in
    // the Reverse Charge columns. Neither is a negative row.
    const tdsCr = crTax.filter(k => opts.taxInfo?.(k.l.ledger)?.tds);
    const tdsLedgers = new Set(tdsCr.map(k => opts.taxLedgers?.canonical?.(k.l.ledger) ?? k.l.ledger));
    const tdsInColumns = tdsLedgers.size === 1 && tdsCr.every(k => opts.tdsColumn?.(k.l.ledger, 'Bill')) ? tdsCr : [];
    const rcm = reverseChargeShape(kinds.filter(k => isDebit(k.l)).map(k => k.l), crTax.map(k => k.l), opts.taxInfo);
    const taxCr = crTax.filter(k => !tdsInColumns.includes(k) && !rcm.credited.includes(k.l)).length;
    const otherCr = kinds.filter(k => isCredit(k.l) && !isTaxKind(k)).length;
    let reason = `Vendor "${vend[0].ledger}" is credited. This looks like a purchase entered as a journal.`;
    if (bought.length) {
      reason = `Vendor "${vend[0].ledger}" is the only vendor ledger and is credited, with ${count(bought.length, 'expense, purchase or asset ledger')}${taxDr ? ` and ${count(taxDr, 'tax ledger')}` : ''} debited. This looks like a purchase entered as a journal.`;
    }
    if (tdsInColumns.length) reason += ` TDS ledger "${tdsInColumns[0].l.ledger}" is credited as well (tax deducted at source): it goes to the bill's TDS columns with its Zoho TDS tax, so Zoho's TDS reports have it.`;
    if (rcm.credited.length) reason += ` GST is debited and credited with the same amount (${quoteList([...new Set(rcm.credited.map(l => l.ledger))])} credited): tax under reverse charge, written in the bill's Reverse Charge columns.`;
    if (taxCr) reason += ` ${count(taxCr, 'tax ledger')} ${isAre(taxCr)} credited as well (for example tax deducted at source with no Zoho TDS tax, or a duty that is not GST): on a bill ${taxCr === 1 ? 'it' : 'they'} would be written as a negative row, not as a tax on the bill, so check this before you approve. A ledger whose Tally type of duty/tax is TDS goes to the bill's TDS columns once its Zoho TDS tax is chosen in Mapping Studio (TDS mapping).`;
    if (otherCr) reason += ` ${count(otherCr, 'other ledger')} ${isAre(otherCr)} credited as well (for example a discount, a round-off or an expense reversed): on a bill ${otherCr === 1 ? 'it' : 'they'} would be written as a negative row, so the bill total would be the net amount. Check this before you approve.`;
    return { suggested: 'Bill', reason, clear: true, needsCheck: taxCr + otherCr > 0, tdsColumns: tdsInColumns.length > 0, reverseCharge: rcm.credited.length > 0 };
  }
  if (cust.length === 1 && vend.length === 0 && isDebit(cust[0])) {
    const rest = lines.filter(l => l !== cust[0]);
    const kinds = rest.map(l => ({ l, kind: kindOf(l.ledger) }));
    if (kinds.some(k => k.kind === 'bank')) return unclear(`Customer "${cust[0].ledger}" is debited, but a bank or cash ledger is on the voucher too, so it also records money paid or received. The pattern is not a plain sale.`);
    const credits = kinds.filter(k => isCredit(k.l));
    const sold = credits.filter(k => k.kind === 'income');
    const unknown = credits.filter(k => k.kind === null && !opts.taxLedgers?.has(k.l.ledger));
    if (opts.kindOf && !sold.length && !unknown.length) {
      return unclear(`Customer "${cust[0].ledger}" is debited, but nothing is credited to a sales or income ledger, so this does not look like a sale (for example expenses recovered from the customer, or an adjustment).`);
    }
    // TDS deducted by the customer goes to the invoice's TDS columns (a TDS-type ledger, or one named like Zoho's TDS
    // Receivable): not a negative row, when it is ONE ledger
    const tdsDrAll = kinds.filter(k => isDebit(k.l) && opts.tdsColumn?.(k.l.ledger, 'Invoice'));
    const tdsDr = new Set(tdsDrAll.map(k => opts.taxLedgers?.canonical?.(k.l.ledger) ?? k.l.ledger)).size === 1 ? tdsDrAll : [];
    const taxDr = kinds.filter(k => isDebit(k.l) && isTaxKind(k) && !tdsDr.includes(k)).length;
    const otherDr = kinds.filter(k => isDebit(k.l) && !isTaxKind(k) && !tdsDr.includes(k)).length;
    let reason = sold.length
      ? `Customer "${cust[0].ledger}" is the only customer ledger and is debited, with ${count(sold.length, 'sales or income ledger')} credited. This looks like a sale entered as a journal.`
      : `Customer "${cust[0].ledger}" is debited. This looks like a sale entered as a journal.`;
    if (tdsDr.length) reason += ` "${tdsDr[0].l.ledger}" is debited as well (TDS deducted by the customer): it goes to the invoice's TDS columns.`;
    if (taxDr) reason += ` ${count(taxDr, 'tax ledger')} ${isAre(taxDr)} debited as well (for example tax deducted at source by the customer): on an invoice ${taxDr === 1 ? 'it' : 'they'} would be written as a negative row, not as a tax on the invoice, so check this before you approve.`;
    if (otherDr) reason += ` ${count(otherDr, 'other ledger')} ${isAre(otherDr)} debited as well (for example a discount or a round-off): on an invoice ${otherDr === 1 ? 'it' : 'they'} would be written as a negative row, so the invoice total would be the net amount. Check this before you approve.`;
    return { suggested: 'Invoice', clear: true, reason, needsCheck: taxDr + otherDr > 0 };
  }
  if (cust.length + vend.length === 0) return { suggested: 'Manual Journal', reason: 'No customer or vendor ledger is involved. A regular journal entry.', clear: true, needsCheck: false };
  if (opts.kindOf) {
    const seen = [];
    if (vend.some(isDebit)) seen.push(`${count(vend.filter(isDebit).length, 'vendor ledger')} debited`);
    if (vend.some(isCredit)) seen.push(`${count(vend.filter(isCredit).length, 'vendor ledger')} credited`);
    if (cust.some(isDebit)) seen.push(`${count(cust.filter(isDebit).length, 'customer ledger')} debited`);
    if (cust.some(isCredit)) seen.push(`${count(cust.filter(isCredit).length, 'customer ledger')} credited`);
    return unclear(`Customer or vendor ledgers are involved (${seen.join(', ')}), but the pattern is not a clear sale or purchase: it looks like an adjustment, a set-off or a note entered as a journal.`);
  }
  return { suggested: 'Manual Journal', reason: 'Customer or vendor ledgers are involved, but the pattern is not a clear sale or purchase. Please review.', clear: false, needsCheck: false };
}

// Tax under reverse charge on a purchase: GST ledgers credited (on the vendor's side) with the same amount per duty head
// as GST ledgers debited. debited, credited: voucher lines (voucherLines); taxInfo(ledger): taxLedgerInfo or null.
// Returns { debited: [line], credited: [line] } (both empty when the shape is not there).
export function reverseChargeShape(debited, credited, taxInfo) {
  const none = { debited: [], credited: [] };
  if (!taxInfo) return none;
  const gstOf = list => list.filter(l => l.amount && !l.amount.isZero() && taxInfo(l.ledger)?.gst && taxInfo(l.ledger)?.head);
  const dr = gstOf(debited), cr = gstOf(credited);
  if (!dr.length || !cr.length) return none;
  const byHead = list => { const m = new Map(); for (const l of list) { const h = taxInfo(l.ledger).head; m.set(h, (m.get(h) || new Decimal(0)).plus(l.amount.abs())); } return m; };
  // the same ledger debited and credited: a reversal of input credit, not reverse charge (GST-010)
  if (dr.some(l => cr.some(x => x.ledger === l.ledger))) return none;
  const a = byHead(dr), b = byHead(cr);
  return a.size === b.size && [...a].every(([h, x]) => b.has(h) && b.get(h).equals(x)) ? { debited: dr, credited: cr } : none;
}

// =====================================================================================================================
// Zoho voucher files: Invoices, Bills and Manual Journals.
//
// The default layouts are the official Zoho Books (India) import samples, heading for heading and in the same order:
//   sample_invoices.xls (70 headings), sample_bills.csv (63 headings), sample_journals.xls (15 headings). The tests read
//   the sample files when they are present (zoho-samples/) and compare the headings byte for byte.
// Values follow the samples' example rows and their "Field Explanation" sheets: dates yyyy-MM-dd (a format both
// explanations allow, and the one the bill sample uses), amounts with 2 decimals, Zoho's two-letter state codes,
// "false"/"FALSE" for Is Inclusive Tax as each sample writes it, "both" and "published" on journals.
//
// One row per item or account line of the Tally voucher: there are NO separate tax rows. The GST of a voucher (its tax
// ledgers on the other side from the party) is put on the line it belongs to, as the Zoho tax the accountant mapped the
// tax ledgers to (Mapping Studio, Tax mapping), with its rate and type. When the tax cannot be put on the lines with
// certainty it is NOT guessed: the voucher is flagged and the tax cells of its lines are left empty.
// =====================================================================================================================

// ---------- headings (official samples) ----------
export const INVOICE_HEADERS = ['Invoice Number', 'Estimate Number', 'Invoice Date', 'Invoice Status', 'Customer Name', 'GST Treatment', 'TCS Tax Name', 'TCS Percentage',
  'TCS Amount', 'Nature Of Collection', 'TCS Payable Account', 'TCS Receivable Account', 'GST Identification Number (GSTIN)', 'TDS Name', 'TDS Percentage', 'TDS Section Code',
  'TDS Amount', 'Place of Supply', 'PurchaseOrder', 'Expense Reference ID', 'Payment Terms', 'Payment Terms Label', 'Due Date', 'Expected Payment Date', 'Sales person',
  'Shipping Charge Tax Name', 'Shipping Charge Tax Type', 'Shipping Charge Tax %', 'Shipping Charge', 'Shipping Charge Tax Exemption Code', 'Shipping Charge SAC Code',
  'Currency Code', 'Exchange Rate', 'Account', 'Item Name', 'SKU', 'Item Desc', 'Item Type', 'HSN/SAC', 'Quantity', 'Usage unit', 'Item Price', 'Item Tax Exemption Reason',
  'Is Inclusive Tax', 'Item Tax', 'Item Tax Type', 'Item Tax %', 'Reverse Charge Tax Name', 'Reverse Charge Tax Rate', 'Reverse Charge Tax Type', 'Project Name', 'Supply Type',
  'Discount Type', 'Is Discount Before Tax', 'Entity Discount Percent', 'Entity Discount Amount', 'Discount', 'Discount Amount', 'Adjustment', 'Adjustment Description',
  'E-Commerce Operator Name', 'E-Commerce Operator GSTIN', 'PayPal', 'Razorpay', 'Partial Payments', 'Template Name', 'Notes', 'Terms & Conditions', 'Branch Name', 'Warehouse Name'];
// The headings of Zoho's sample_bills.csv, in the sample's order (65).
export const BILL_SAMPLE_HEADERS = ['Bill Date', 'Bill Number', 'PurchaseOrder', 'Bill Status', 'Source of Supply', 'Destination of Supply', 'GST Treatment', 'GST Identification Number (GSTIN)',
  'Is Inclusive Tax', 'TDS Percentage', 'TDS Amount', 'TDS Section Code', 'TDS Name', 'Vendor Name', 'Due Date', 'Currency Code', 'Exchange Rate', 'Attachment ID',
  'Attachment Preview ID', 'Attachment Name', 'Attachment Type', 'Attachment Size', 'Item Name', 'SKU', 'Item Description', 'Account', 'Usage unit', 'Quantity', 'Rate',
  'Adjustment', 'Item Type', 'Tax Name', 'Tax Percentage', 'Tax Amount', 'Tax Type', 'Item Exemption Code', 'Reverse Charge Tax Name', 'Reverse Charge Tax Rate',
  'Reverse Charge Tax Type', 'Item Total', 'SubTotal', 'Total', 'Balance', 'Vendor Notes', 'Terms & Conditions', 'Payment Terms', 'Payment Terms Label', 'Is Billable',
  'Customer Name', 'Project Name', 'Purchase Order Number', 'Is Discount Before Tax', 'Entity Discount Amount', 'Discount Account', 'Is Landed Cost', 'Warehouse Name',
  'Branch Name', 'CF.Transporte_Name', 'TCS Tax Name', 'TCS Percentage', 'Nature Of Collection', 'TCS Amount', 'HSN/SAC', 'Supply Type', 'ITC Eligibility'];
// v2 (docs/ZOHO_IMPORT_RULES.md, rule BIL-TOTAL-COLUMNS-OMIT): the Bills file is a SUBSET of the sample's headings, in
// the sample's order. Left out:
//  - Item Total, SubTotal, Total, Balance: Zoho reads an empty Total as 0 and refuses the bill ("The given total value 0
//    and the system generated total value N are not same"); Zoho's own advice is not to map them, and it works the total
//    out from Quantity, Rate, the tax, TDS and Adjustment. A column that is not in the file cannot be mapped by mistake.
//  - the five Attachment columns and CF.Transporte_Name: export columns and a custom field of Zoho's demo organisation.
export const BILL_COLUMNS_LEFT_OUT = ['Item Total', 'SubTotal', 'Total', 'Balance', 'Attachment ID', 'Attachment Preview ID', 'Attachment Name', 'Attachment Type', 'Attachment Size', 'CF.Transporte_Name'];
export const BILL_HEADERS = BILL_SAMPLE_HEADERS.filter(h => !BILL_COLUMNS_LEFT_OUT.includes(h));
export { JOURNAL_SAMPLE_HEADERS as JOURNAL_HEADERS } from './zoho.js';

// ---------- what each column is written from (Template Mapping shows this) ----------
const filled = (headers, known) => Object.fromEntries(headers.map(h => [h, known[h] || 'Left empty']));
const INVOICE_SOURCES = {
  'Invoice Number': 'Tally voucher number', 'Invoice Date': 'Tally voucher date (yyyy-MM-dd)',
  'Invoice Status': 'Fixed value "open" (the invoice is posted to the accounts; an import sends no email). "draft" when the accountant chose drafts in Mapping Studio (Voucher files)',
  'Customer Name': 'The customer on the voucher, written exactly as in the Customers file (after the decisions in Mapping Studio, Names)',
  'GST Treatment': 'The GST Treatment written for that customer in the Customers file (after Fix contacts)',
  'GST Identification Number (GSTIN)': 'The GSTIN written for that customer in the Customers file (after Fix contacts)',
  'Place of Supply': "Tally's place of supply on the voucher as a Zoho state code; when the voucher has none, the customer's Place Of Contact from the Customers file. Empty for an overseas customer",
  'Currency Code': '"INR". For a party kept in another currency (its contact is written with that Currency Code), the code, when every line carries the foreign amount Tally has, at one rate', 'Exchange Rate': 'Empty for INR; for a document in another currency the rate of exchange Tally has on the voucher',
  'Account': 'The Tally ledger of the line (sales or income ledger), with the name written in the Chart of Accounts file',
  'Item Name': 'The Tally stock item of a stock item line; for any other line, the service item named after the line\'s account (added to the Items file with rate 0.00 and that account). Zoho requires an Item Name on every invoice line',
  'Item Desc': 'For a line without a stock item: the account name of the line',
  'TDS Name': 'Tax deducted by the customer (a Tally TDS ledger debited with the customer): the Zoho TDS tax chosen in Mapping Studio (TDS mapping), else the one suggested from the section in Tally',
  'TDS Percentage': 'The percentage chosen in TDS mapping (or the TDS ledger\'s rate in Tally)', 'TDS Section Code': 'The section chosen in TDS mapping; empty for a suggested TDS tax (it carries its section)',
  'TDS Amount': "Tally's TDS ledger amount on the voucher",
  'Adjustment': 'The round-off of the voucher (Tally ledgers of type Invoice Rounding), plus or minus; the same on every row of the invoice',
  'Adjustment Description': 'Fixed value "Round Off" when there is a round-off',
  'HSN/SAC': 'The HSN or SAC code Tally keeps on the line, after the HSN/SAC corrections of the migration. A value that is not 4, 6 or 8 digits is left empty and flagged',
  'Quantity': 'The billed quantity of a stock item line; 1 for an account line', 'Usage unit': 'The unit of a stock item line, as in Tally',
  'Item Price': 'The rate of a stock item line; the amount of an account line (negative for a line on the same side as the customer)',
  'Is Inclusive Tax': 'Fixed value "false": Tally line amounts do not include the tax, which is on its own tax ledgers',
  'Item Tax': 'The Zoho tax the tax ledgers of the voucher are mapped to (Mapping Studio, Tax mapping), when the tax can be put on this line with certainty',
  'Item Tax Type': '"ItemAmount" for one tax ledger (for example IGST), "Tax Group" for two or more (for example CGST and SGST), as in the sample',
  'Item Tax %': "The GST rate of the line: Tally's rate on the line, else the rate on the tax ledgers, else worked out from the amounts (only for a single line, and only a standard GST rate). A line with no GST in Tally: 0, with Zoho's zero-rate tax GST0 (same state) or IGST0 (other state)",
  'Notes': 'Tally narration',
};
const BILL_SOURCES = {
  'Bill Date': 'Tally voucher date (yyyy-MM-dd)',
  'Bill Number': "The supplier's invoice number (Tally reference) when the voucher has one, else the Tally voucher number. When two bills of one vendor would carry the same number, the later one carries its Tally voucher number (flagged)",
  'Item Exemption Code': 'Only when "exemption" is chosen for bill lines without GST in Mapping Studio (Voucher files): the name of that tax exemption, on a line of a registered vendor that carries no GST',
  'Bill Status': 'Fixed value "open" (the bill is posted to the accounts). "draft" when the accountant chose drafts in Mapping Studio (Voucher files)',
  'Source of Supply': "The vendor's Source Of Supply from the Vendors file (after Fix contacts). Empty for an overseas vendor",
  'Destination of Supply': "Tally's place of supply on the voucher, else the company's GST state on the voucher, as a Zoho state code",
  'GST Treatment': 'The GST Treatment written for that vendor in the Vendors file', 'GST Identification Number (GSTIN)': 'The GSTIN written for that vendor in the Vendors file',
  'Is Inclusive Tax': 'Fixed value "FALSE", as in the sample',
  'TDS Name': 'The Zoho TDS tax the Tally TDS ledger on the vendor side is mapped to (Mapping Studio, TDS mapping)', 'TDS Section Code': 'The section chosen in TDS mapping',
  'TDS Percentage': 'The percentage chosen in TDS mapping', 'TDS Amount': "Tally's TDS ledger amount on the voucher (written so Zoho uses it instead of working it out)",
  'Vendor Name': 'The vendor on the voucher, written exactly as in the Vendors file', 'Currency Code': '"INR". For a party kept in another currency (its contact is written with that Currency Code), the code, when every line carries the foreign amount Tally has, at one rate', 'Exchange Rate': 'Empty for INR; for a document in another currency the rate of exchange Tally has on the voucher',
  'Item Name': 'The Tally stock item, only when the line is a stock item line', 'Item Description': 'For a line without a stock item: the account name of the line',
  'Account': 'The Tally ledger of the line (expense, purchase or asset ledger), with the name written in the Chart of Accounts file',
  'Usage unit': 'The unit of a stock item line, as in Tally', 'Quantity': 'The billed quantity of a stock item line; 1 for an account line',
  'Rate': 'The rate of a stock item line; the amount of an account line (negative for a line on the same side as the vendor)',
  'Tax Name': 'The Zoho tax the tax ledgers of the voucher are mapped to (when none is mapped: Zoho\'s own tax of that rate, GST18 or IGST18 for example), when the tax can be put on this line with certainty. For a line of a registered vendor with no GST in Tally: Zoho\'s zero-rate tax, GST0 within the state or IGST0 between states (the default)', 'Tax Percentage': 'The GST rate of the line',
  'Tax Amount': "The tax of the line: Tally's tax ledger amount when the voucher has one taxable line; otherwise the line amount times the rate",
  'Tax Type': '"ItemAmount" for one tax ledger, "Tax Group" for two or more, as in the sample',
  'Vendor Notes': 'Tally narration',
  'HSN/SAC': 'The HSN or SAC code Tally keeps on the line, after the HSN/SAC corrections of the migration. A value that is not 4, 6 or 8 digits is left empty and flagged',
  'Adjustment': 'The round-off of the voucher (Tally ledgers of type Invoice Rounding), plus or minus; the same on every row of the bill',
};
const JOURNAL_SOURCES = {
  'Journal Date': 'Tally voucher date (yyyy-MM-dd)', 'Reference Number': 'Tally voucher number (identifies the journal)',
  'Journal Number Prefix': 'The Tally voucher number up to its last run of digits (for "JV/24/0012": "JV/24/")', 'Journal Number Suffix': 'The last run of digits of the Tally voucher number ("0012")',
  'Notes': 'Tally narration; when there is none, "Journal <number> from Tally" (Zoho requires Notes)', 'Journal Type': 'Fixed value "both" (accrual and cash), as in the sample',
  'Currency': 'Fixed value "INR"',
  'Account': 'The Tally ledger of the line, with the name written in the Chart of Accounts file; "Accounts Receivable" for a customer line and "Accounts Payable" for a vendor line (customers and vendors are Zoho contacts, not accounts)',
  'Contact Name': 'For a customer or vendor line: the contact, written exactly as in the Customers or Vendors file',
  'Debit': 'Line amount when it is a debit, without sign, 2 decimals', 'Credit': 'Line amount when it is a credit, without sign, 2 decimals',
  'Status': 'Fixed value "published" (the journal posts). "draft" when the accountant chose drafts in Mapping Studio (Voucher files)',
};

export const VOUCHER_FILES = {
  invoices: { module: 'Invoices', file: 'invoices.csv', headers: INVOICE_HEADERS, verified: true, sampleFile: 'sample_invoices.xls', idColumn: 'Invoice Number',
    sources: filled(INVOICE_HEADERS, INVOICE_SOURCES) },
  bills: { module: 'Bills', file: 'bills.csv', headers: BILL_HEADERS, verified: true, sampleFile: 'sample_bills.csv', idColumn: 'Bill Number', sources: filled(BILL_HEADERS, BILL_SOURCES) },
  journals: { module: 'Manual Journals', file: 'journals.csv', headers: JOURNAL_SAMPLE_HEADERS, verified: true, sampleFile: 'sample_journals.xls', idColumn: 'Reference Number',
    sources: filled(JOURNAL_SAMPLE_HEADERS, JOURNAL_SOURCES) },
  // Receipt, Payment, Contra, Debit Note and Credit Note vouchers that are Manual Journals in Zoho (payments.js): the
  // journal sample's layout, with the voucher type's code in the journal number and Reference Number
  other_journals: { module: 'Manual Journals (receipts, payments, contra, notes)', file: 'journals_receipts_payments_contra.csv', headers: JOURNAL_SAMPLE_HEADERS, verified: true,
    sampleFile: 'sample_journals.xls', idColumn: 'Reference Number', sources: filled(JOURNAL_SAMPLE_HEADERS, { ...JOURNAL_SOURCES,
      'Reference Number': 'The code of the Tally voucher type (RCT- Receipt, PMT- Payment, CTR- Contra, DN- Debit Note, CN- Credit Note) followed by the Tally voucher number (identifies the journal: Tally numbers each voucher type on its own)',
      'Journal Number Prefix': 'The voucher type code, then the Tally voucher number up to its last run of digits (for Payment "24/0012": "PMT-24/")',
      'Notes': 'Tally narration; when there is none, "<voucher type> <number> from Tally" (Zoho requires Notes)' }) },
};

// The output settings an accountant can choose for the voucher files (Mapping Studio, Voucher files).
//  billNumber: 'voucher' (default, as before: the Tally voucher number) or 'reference' (the supplier's invoice number
//    from Tally's reference field, when the voucher has one; otherwise the voucher number).
//  documentStatus: 'final' (default: invoices and bills "open", journals "published", so they post to the accounts) or
//    'draft' (all three as drafts, which Zoho Books does not post until they are approved).
// v2: billNumber defaults to 'reference' (default 9: the supplier's invoice number when the Tally voucher has one, else
// the Tally voucher number; the user is never asked).
//  outOfYear: 'exclude' (default: a voucher dated outside the migration's financial year is left out of the files,
//    counted and listed) or 'include'.
//  billNoTaxMode: what is written on a bill line of a registered vendor that carries no GST (billLineWithoutTax in
//    defaults.js): 'zero_tax' (default: GST0 / IGST0), 'exemption' (billExemptionCode: the name of a tax exemption that
//    exists in Zoho Books) or 'reverse_charge' (billReverseChargeName, Rate and Type).
export const VOUCHER_SETTING_DEFAULTS = { billNumber: 'reference', documentStatus: 'final', outOfYear: 'exclude', billNoTaxMode: 'zero_tax', billExemptionCode: '',
  billReverseChargeName: '', billReverseChargeRate: '', billReverseChargeType: '',
  // tdsAct: the form of the TDS Section Code ('auto': by the date of the document, 'old': 194J, 'new': professional_fees);
  // tdsBase: what Zoho works TDS out on ('subtotal' or 'total' including tax); rcmUnknownState: reverse charge IGST on a
  // bill whose vendor has no state and no GSTIN ('overseas', the default: kept as IGST, an import of services, the vendor
  // and the bill written as overseas; 'intra': written as GST);
  // recomputeDiffPolicy: a rounding difference between Tally's tax or TDS and what Zoho works out ('adjustment': written
  // in the Adjustment column, 'flag': only flagged)
  tdsAct: 'auto', tdsBase: 'subtotal', rcmUnknownState: 'overseas', recomputeDiffPolicy: 'adjustment',
  // tcsMode (TDS-015): where tax collected at source (a Tally ledger whose type of duty is TCS) is written: 'adjustment'
  // (the default until Zoho's TCS columns are proven by an import: the Adjustment column, the generated adjustment journal
  // moves it back to the TCS ledger; never a zero-rated GST0 line on a bill) or 'columns' (Zoho's TCS Tax Name, TCS
  // Percentage, TCS Amount and Nature Of Collection columns, with a TCS tax to create in Zoho)
  tcsMode: 'adjustment',
  // tdsPosting (TDS-016): 'merge' (the default: a Tally TDS ledger used in the TDS columns of the bills or invoices is
  // entered on Zoho's own TDS Payable or TDS Receivable, where Zoho posts the TDS) or 'per_ledger' (every Tally TDS ledger
  // stays an account of its own, with its opening balance; the tax alignment journal of each month moves the TDS from
  // Zoho's account to the ledger, so the balance per section stays in Zoho's books as in Tally's)
  tdsPosting: 'merge',
  // zohoTaxRounding: how Zoho Books rounds the tax of a document (Settings > Taxes): 'line' (each part of the tax of
  // each line, Zoho's item level: the default) or 'entity' (each part summed over the document, then rounded)
  zohoTaxRounding: 'line',
  // invoiceAdjustmentAccount, billAdjustmentAccount: the Zoho account that the Adjustment of an invoice (a bill) posts
  // to. Zoho picks it itself (a test import: "Other Charges" for invoices, "Other Expenses" for bills); the generated
  // adjustment journal moves each amount from it to the Tally ledger it belongs to. Empty: no journal is generated.
  invoiceAdjustmentAccount: 'Other Charges', billAdjustmentAccount: 'Other Expenses',
  // hsnEnabled: 'on' | 'off', whether the HSN Code or SAC field is switched on in Zoho Books (it is on in a new India
  // organisation); hsnMinDigits: '6' | '4', the shortest code Zoho takes when it is on; openingDate: the Migration Date
  // (yyyy-MM-dd) written on the opening balance journal and saved in Zoho Books, '' for the default (the day before the
  // financial year starts)
  hsnEnabled: 'on', hsnMinDigits: '6', openingDate: '',
  // paymentsRoute: where customer payments, vendor payments, debit notes to vendors and credit notes to customers go.
  // 'journals' (the default): Manual Journals now, in shapes Zoho Books accepted, so no voucher is held and nothing is
  // typed; 'module_files': held for the Payments Received / Payments Made files built from Zoho's own import sample
  // (payments.js, heldfiles.js). A voucher is in exactly one of the two.
  paymentsRoute: 'journals' };
export const HSN_ENABLED_OPTIONS = ['on', 'off'], HSN_MIN_DIGITS_OPTIONS = ['6', '4'];
// Is the HSN/SAC field on in Zoho Books? An answer given in the Import Wizard always wins. With no answer: a company
// with a GSTIN is on (a new India organisation has the field); a company with no GSTIN (not registered for GST, or GST
// not switched on in Zoho Books) has no HSN/SAC field, so it is off.
export const hsnFieldOn = (answer, gstin) => (HSN_ENABLED_OPTIONS.includes(answer) ? answer === 'on' : !!String(gstin || '').trim());
export const RCM_UNKNOWN_STATE_OPTIONS = ['intra', 'overseas'];
export const RECOMPUTE_POLICY_OPTIONS = ['adjustment', 'flag'];
export const TCS_MODE_OPTIONS = ['adjustment', 'columns'];
export const TDS_POSTING_OPTIONS = ['merge', 'per_ledger'];
export const ZOHO_TAX_ROUNDING_OPTIONS = ['line', 'entity'];
// A difference up to this many rupees per taxed line (and per TDS) between Tally's tax or TDS and what Zoho works out is
// a rounding difference: it is written in the Adjustment column. A larger one is flagged for a person.
export const RECOMPUTE_ADJUST_LIMIT = new Decimal(1);
export const OUT_OF_YEAR_OPTIONS = ['exclude', 'include'];
export const BILL_NUMBER_OPTIONS = ['voucher', 'reference'];
export const DOCUMENT_STATUS_OPTIONS = ['final', 'draft'];

// Kept for older imports: the Line Type of a row whose ledger is a tax ledger on the party's side. The files no longer
// have a Line Type column (no separate tax rows); such a ledger is written as a line with a negative amount.
export const PARTY_SIDE_TAX = 'Tax ledger on the party side';

const KIND_WORDS = { tax: 'a tax ledger', expense: 'an expense or purchase ledger', income: 'a sales or income ledger', asset: 'a fixed asset ledger',
  bank: 'a bank or cash ledger', customer: 'a customer ledger', vendor: 'a vendor ledger', other: 'a ledger of another group' };

// ---------- tax ledgers ----------
// The duty head of a GST tax ledger or of a rate on a Tally line, in one spelling. Tally writes the head as "CGST",
// "SGST/UTGST", "IGST", "Cess", "State Cess" (real exports) or as "Central Tax", "State Tax", "Integrated Tax" (older
// sample files).
const HEADS = { cgst: 'CGST', 'central tax': 'CGST', sgst: 'SGST', utgst: 'SGST', 'sgst/utgst': 'SGST', 'state tax': 'SGST', 'ut tax': 'SGST', 'union territory tax': 'SGST',
  igst: 'IGST', 'integrated tax': 'IGST', cess: 'Cess', 'state cess': 'State Cess' };
export const dutyHead = v => HEADS[String(tallyText(v)).trim().toLowerCase()] || null;
const rateOf = v => { const s = String(tallyText(v)).trim(); if (!/^\d+(\.\d+)?$/.test(s)) return null; const d = new Decimal(s); return d.isZero() ? null : d; };

// What the masters say about a ledger under Duties & Taxes: { tds, gst, head, rate, nature }.
//  tds: Tally's type of duty/tax is "TDS" (never decided from the name);
//  head: the GST duty head (CGST, SGST, IGST, Cess, State Cess) or null;
//  rate: the ledger's own percentage of calculation, when Tally has one;
//  nature: Tally's TDS nature of payment, as written (information for the accountant).
export function taxLedgerInfo(d) {
  const type = String(tallyText(d?.taxtype)).trim();
  const head = dutyHead(d?.gstdutyhead);
  const tds = type.toUpperCase() === 'TDS', gst = type.toUpperCase() === 'GST' || !!head, tcs = type.toUpperCase() === 'TCS';
  // other: Tally names a type of duty/tax that is neither GST nor TDS (for example "Others"): never treated as GST.
  // A ledger with no type and no duty head is not known to be anything, and stays handled as before (as GST).
  // tcs (TDS-015): Tally's type of duty/tax is "TCS"; tcsNature: its nature of goods as written (Tally keeps it in the
  // TCS nature field; the TDS nature field is read too when that one is empty)
  return { tds, gst, ...(tcs ? { tcs } : {}), other: !!type && !tds && !gst, type, head, rate: rateOf(d?.rateoftaxcalculation),
    nature: String(tallyText(d?.tdsratename)).replace(/[\u0000-\u001f]/g, '').trim(),
    ...(tcs ? { tcsNature: String(tallyText(d?.tcsnatureofgoods ?? d?.tcscategory ?? d?.tdsratename)).replace(/[\u0000-\u001f]/g, '').trim() } : {}) };
}

// The GST rates on a Tally line (ratedetails: one entry per duty head), as { head: Decimal }, or null when the line has
// none. Only rates "Based on Value" (or with no valuation type) are used; a rate per quantity cannot be a Zoho rate.
function lineRates(list) {
  const out = {};
  for (const r of [].concat(list || [])) {
    if (!r || typeof r !== 'object') continue;
    const head = dutyHead(r.gstratedutyhead);
    const rate = rateOf(r.gstrate);
    const how = String(tallyText(r.gstratevaluationtype)).trim();
    if (!head || rate === null || (how && !/based on value/i.test(how))) continue;
    out[head] = rate;
  }
  return Object.keys(out).length ? out : null;
}
// The HSN or SAC value Tally keeps on a line, as written: the first value made of digits only, else the first value
// that is not empty. Whether Zoho accepts it (4, 6 or 8 digits) and the corrections of the migration are applied when
// the row is written (hsnForZoho in defaults.js), so a value that is not written is flagged, never dropped silently.
const hsnOf = (...values) => {
  const all = values.map(v => String(tallyText(v) ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim()).filter(Boolean);
  return all.find(s => /^\d+$/.test(s)) || all[0] || '';
};

// ---------- small helpers ----------
const ZERO = new Decimal(0);
// the Zoho account the TCS of a bill written in the TCS columns posts to (zohorules.json lists.default_accounts, TCS Receivable)
const TCS_RECEIVABLE = 'TCS Receivable';
const r2 = d => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const pct = d => d.toString(); // 18, 2.5 (as the samples write rates)
const money2 = d => d.toFixed(Math.max(2, d.decimalPlaces())); // 2 decimals, more only when Tally's rate has more (never rounded)
const sumOf = list => list.reduce((t, x) => t.plus(x), ZERO);
// { debit, credit } (positive Decimals) of amounts in Tally's sign (a debit negative)
export const postingOf = list => ({ debit: sumOf(list.filter(x => x.isNegative())).abs(), credit: sumOf(list.filter(x => x.greaterThan(0))) });
// Tally may round a tax ledger to the rupee: a difference of up to one rupee per tax ledger is rounding.
export const TAX_TOLERANCE = new Decimal(1);
// Standard GST rates (in percent). A rate worked out from amounts is used only when it is one of them.
export const STANDARD_GST_RATES = ['0.1', '0.25', '1', '1.5', '3', '5', '6', '7.5', '12', '18', '28', '40'].map(x => new Decimal(x));
const quoteList = list => list.map(x => `"${x}"`).join(', ');
const cleanLabel = s => String(s ?? '').replace(/[\u0000-\u001f]+/g, ' ').trim();
// Tally's narration as written in a Zoho cell (Notes, Vendor Notes): line breaks and hidden characters become a space,
// runs of spaces become one, spaces at the ends are removed. The Tally value itself is not changed.
export const cleanText = s => String(tallyText(s) ?? '').replace(/[\u0000-\u001f\u007f\u0085\u00a0\u200b\u2028\u2029\ufeff]/g, ' ').replace(/ {2,}/g, ' ').trim();
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
// "2 Nos" -> { qty: Decimal(2), unit: 'Nos' }; "100.00/Nos" -> Decimal(100). null when not readable.
function quantityOf(s) {
  const m = String(s ?? '').trim().replace(/,/g, '').match(/^(-?\d+(?:\.\d+)?)\s*(.*)$/);
  return m ? { qty: new Decimal(m[1]).abs(), unit: m[2].trim() } : null;
}
function rateOfText(s) {
  const m = String(s ?? '').trim().replace(/,/g, '').match(/^(-?\d+(?:\.\d+)?)/);
  return m ? new Decimal(m[1]).abs() : null;
}

// The journal number of a Tally voucher number: prefix = everything up to the last run of digits, suffix = that run.
// Zoho requires the suffix (a number) and allows at most 16 characters in all. null when it cannot be split that way.
export function journalNumberParts(number) {
  const s = String(number ?? '').trim();
  const m = s.match(/^(.*?)(\d+)$/);
  if (!m || s.length > 16) return null;
  return { prefix: m[1], suffix: m[2] };
}

// ---------- putting the GST on the lines ----------
// lines: the item and account lines of the document, each { ledger, total (Decimal, positive = on the document's side),
// rates (from Tally, per head) }. taxes: the GST tax ledgers on the other side from the party, grouped by ledger:
// [{ ledger, amount (Decimal, positive), head, rate }]. Only lines with a positive amount can carry tax.
// Returns { perLine: Map(line -> { ledgers: [ledger], rate: Decimal, amount: Decimal }), problem: { kind, message } | null,
//   notes: [{ kind, message }] }. With a problem nothing is put on any line.
export function attributeTax(lines, taxes) {
  const perLine = new Map(), notes = [];
  if (!taxes.length) return { perLine, problem: null, notes };
  const taxable = lines.filter(l => l.total.greaterThan(0));
  const totalTax = sumOf(taxes.map(t => t.amount));
  const names = quoteList(taxes.map(t => t.ledger));
  if (!taxable.length) return { perLine, notes, problem: { kind: 'tax_not_attributable', message: `The tax on ${names} (${totalTax.toFixed(2)}) cannot be put on a line: the voucher has no line with a positive amount to carry it.` } };
  const rateFor = (line, t) => (t.head && line.rates?.[t.head] ? line.rates[t.head] : t.rate || null);

  if (taxable.length === 1) {
    const line = taxable[0];
    const rates = taxes.map(t => rateFor(line, t));
    let rate, fromAmount = false;
    // the standard GST rates that fit Tally's tax on this line: exactly (to the paisa per tax ledger), or else within the
    // rounding of a rupee per tax ledger. A small line where several rates come within a rupee, and none exactly, is not
    // decided.
    const within = limit => STANDARD_GST_RATES.filter(s => r2(line.total.times(s).div(100)).minus(totalTax).abs().lessThanOrEqualTo(limit.times(taxes.length)));
    if (rates.every(Boolean)) {
      rate = sumOf(rates);
      const computed = r2(line.total.times(rate).div(100));
      if (computed.minus(totalTax).abs().greaterThan(TAX_TOLERANCE.times(taxes.length))) {
        // Tally's rate (on the line or the ledger master) does not fit Tally's own tax amount. Zoho works the tax out from
        // the rate, so writing that rate would change the amount. When exactly one standard rate fits the amount, that
        // rate is written (Tally's amounts decide); otherwise Tally's rate stays and the voucher is flagged.
        const exact = within(new Decimal('0.01'));
        const fits = exact.length === 1 ? exact : within(TAX_TOLERANCE);
        if (fits.length === 1) {
          notes.push({ kind: 'tax_rate_from_amount', message: `The GST rate Tally gives for the line is ${pct(rate)}%, which on ${line.total.toFixed(2)} would be ${computed.toFixed(2)}, but the tax ledgers ${names} carry ${totalTax.toFixed(2)}, which is ${pct(fits[0])}% of the line. Zoho Books works the tax out from the rate, so ${pct(fits[0])}% is written: the tax and the total stay Tally's. Check the rate on the tax ledger in Tally.` });
          rate = fits[0]; fromAmount = true;
        } else {
          notes.push({ kind: 'tax_amount_differs', message: `The GST rate Tally gives for the line is ${pct(rate)}%, which on ${line.total.toFixed(2)} is ${computed.toFixed(2)}, but the tax ledgers ${names} carry ${totalTax.toFixed(2)} (a difference of ${computed.minus(totalTax).abs().toFixed(2)}, more than rounding), and no single standard GST rate fits the amounts. The tax was still put on the only line. Check the voucher in Tally.` });
        }
      }
    } else {
      // No rate in Tally: worked out from the amounts, and used only when exactly one standard GST rate fits.
      const exact = within(new Decimal('0.01'));
      const fits = exact.length === 1 ? exact : within(TAX_TOLERANCE);
      if (fits.length !== 1) {
        return { perLine, notes, problem: { kind: 'tax_rate_unknown', message: `The GST rate of the line cannot be told: Tally has no rate on the line or on the tax ledgers ${names}, and ${fits.length ? `${fits.length} standard rates (${fits.map(pct).join('%, ')}%) fit` : 'no standard GST rate fits'} a tax of ${totalTax.toFixed(2)} on ${line.total.toFixed(2)}. The tax cells are left empty. Enter the rate on the tax ledgers in Tally, or set the tax on this document in Zoho Books after the import.` } };
      }
      rate = fits[0];
    }
    // rates: the rate of each tax ledger (a rate worked out from the amounts is split evenly, as CGST and SGST are)
    perLine.set(line, { ledgers: taxes.map(t => t.ledger), rate, amount: totalTax, rates: rates.every(Boolean) && !fromAmount ? rates : taxes.map(() => rate.div(taxes.length)), fromAmount });
    return { perLine, problem: null, notes };
  }

  // Several lines: each line needs its own rate from Tally (on the line, or on the tax ledger), and the rates must
  // account for every tax ledger's amount. Otherwise which line carries which tax is not certain.
  const missing = taxable.filter(l => taxes.some(t => !rateFor(l, t)));
  const explains = (ls, rf) => taxes.every(t => ls.every(l => rf(l, t)) && sumOf(ls.map(l => r2(l.total.times(rf(l, t)).div(100)))).minus(t.amount).abs().lessThanOrEqualTo(TAX_TOLERANCE));
  // GST-002: one untaxed or rate-less line (exempt, nil rated, a charge with no GST) never drops the GST of the others.
  //  1. The lines with Tally's own rate ON THE LINE account for every tax ledger: the other lines carry no GST (they are
  //     written as untaxed: zero-rate or exemption, as any line with no GST in Tally).
  //  2. Otherwise, when some line has no rate and exactly one standard GST rate on ALL the positive lines accounts for
  //     every tax ledger, and no other choice of standard rates (0 included) does (oneRateForAll; CGST and
  //     SGST half each, IGST the whole), and no line's own rate says otherwise: every line carries that rate (a charge
  //     taxed with the goods, as gstBaseWithOtherDuty does on bills).
  //  3. Otherwise not certain: flagged, nothing put on any line.
  // Both are said on the document (notes), never silent.
  let lines2 = taxable, rateFor2 = rateFor;
  const ownRated = l => taxes.every(t => t.head && l.rates?.[t.head]);
  const rated = taxable.filter(ownRated), unrated = taxable.filter(l => !ownRated(l));
  if (rated.length && unrated.length && explains(rated, (l, t) => l.rates[t.head])) {
    lines2 = rated; rateFor2 = (l, t) => l.rates[t.head];
    notes.push({ kind: 'tax_unrated_line_untaxed', message: `${plural(unrated.length, 'line')} of this voucher (${quoteList([...new Set(unrated.map(l => l.ledger))])}) ${unrated.length === 1 ? 'has' : 'have'} no GST rate in Tally, and the GST rates of the other lines account for the whole tax on ${names}. So ${unrated.length === 1 ? 'that line carries' : 'those lines carry'} no GST and ${unrated.length === 1 ? 'is' : 'are'} written as untaxed (nil rated, exempt or outside GST). Check the line in Tally if it should carry GST.` });
  } else {
    const fits = missing.length ? oneRateForAll(taxable, taxes) : [];
    if (fits.length === 1) {
      rateFor2 = (l, t) => shareOfHead(t.head, fits[0]);
      notes.push({ kind: 'tax_rate_from_amount', message: `Tally gives no GST rate for every line of this voucher, but ${pct(fits[0])}% on all ${taxable.length} lines (${sumOf(taxable.map(l => l.total)).toFixed(2)}) accounts for the tax on ${names} (${totalTax.toFixed(2)}), and no other choice of standard rates does. So every line is written at ${pct(fits[0])}%: the tax and the total stay Tally's. Check the voucher in Tally if a line should carry no GST.` });
    } else if (missing.length) {
      return { perLine, notes, problem: { kind: 'tax_not_attributable', message: `The voucher has ${taxable.length} lines that could carry the tax on ${names} (${totalTax.toFixed(2)}), and Tally gives no GST rate for ${missing.length === taxable.length ? 'them' : `${plural(missing.length, 'line')} of them`} (on the line or on the tax ledger). Which line carries which tax is not certain, so the tax cells of every line are left empty. Enter the tax on this document in Zoho Books after the import, or give the lines their GST rates in Tally.` } };
    } else {
      for (const t of taxes) {
        const expected = sumOf(taxable.map(l => r2(l.total.times(rateFor(l, t)).div(100))));
        if (expected.minus(t.amount).abs().greaterThan(TAX_TOLERANCE)) {
          return { perLine, notes, problem: { kind: 'tax_not_attributable', message: `The GST rates Tally gives for the ${taxable.length} lines come to ${expected.toFixed(2)} on "${t.ledger}", but the ledger carries ${t.amount.toFixed(2)}. Which line carries which tax is not certain (for example one line may be exempt), so the tax cells of every line are left empty. Enter the tax on this document in Zoho Books after the import.` } };
        }
      }
    }
  }
  return spreadTax(lines2, taxes, rateFor2, totalTax, names, perLine, notes);
}
// The one standard GST rate that, on every positive line, accounts for each tax ledger (to the paisa per line, else
// within a rupee per ledger), and only when it is CERTAIN: no other way of giving the lines standard rates (0 included)
// fits the same amounts (for example 1000 + 500 with 180 is 12% on both, or 18% on the first and nothing on the
// second: not certain). Only for CGST + SGST or IGST alone; a line's own Tally rate and a tax ledger's own rate must
// agree. At most 4 lines are tried. Returns [rate] when certain, else [] or several.
const shareOfHead = (head, s) => (head === 'IGST' ? s : s.div(2));
function oneRateForAll(lines, taxes) {
  const heads = [...new Set(taxes.map(t => t.head))];
  if (!taxes.every(t => ['CGST', 'SGST', 'IGST'].includes(t.head)) || !(heads.includes('IGST') ? heads.length === 1 : heads.length === 2)) return [];
  if (lines.length > 4) return [];
  const fitsWith = (rateOfLine, limit) => taxes.every(t => sumOf(lines.map((l, i) => r2(l.total.times(shareOfHead(t.head, rateOfLine(i))).div(100)))).minus(t.amount).abs().lessThanOrEqualTo(limit));
  const agrees = s => !lines.some(l => l.rates && heads.some(h => l.rates[h] && !new Decimal(l.rates[h]).equals(shareOfHead(h, s))))
    && !taxes.some(t => t.rate && !t.rate.equals(shareOfHead(t.head, s)));
  for (const limit of [new Decimal('0.01').times(lines.length), TAX_TOLERANCE]) {
    const fits = STANDARD_GST_RATES.filter(s => !s.isZero() && agrees(s) && fitsWith(() => s, limit));
    if (!fits.length) continue;
    if (fits.length > 1) return fits;
    // certain only when no mixed assignment of standard rates (or none) to the lines fits too
    const choices = [ZERO, ...STANDARD_GST_RATES.filter(s => !s.isZero())];
    let others = 0;
    const idx = new Array(lines.length).fill(0);
    for (;;) {
      const mixed = idx.some(k => !choices[k].equals(fits[0]));
      if (mixed && fitsWith(i => choices[idx[i]], limit)) { others++; break; }
      let p = 0;
      while (p < idx.length && ++idx[p] === choices.length) idx[p++] = 0;
      if (p === idx.length) break;
    }
    return others ? [] : fits;
  }
  return [];
}
// The tax of each line from its rates (attributeTax, several lines), the rounding put on the last line.
function spreadTax(taxable, taxes, rateFor, totalTax, names, perLine, notes) {
  let written = ZERO;
  const taxed = [];
  for (const l of taxable) {
    const ledgers = taxes.filter(t => rateFor(l, t)?.greaterThan(0));
    if (!ledgers.length) continue;
    const amount = sumOf(ledgers.map(t => r2(l.total.times(rateFor(l, t)).div(100))));
    const entry = { ledgers: ledgers.map(t => t.ledger), rate: sumOf(ledgers.map(t => rateFor(l, t))), amount, rates: ledgers.map(t => rateFor(l, t)) };
    perLine.set(l, entry); taxed.push(entry); written = written.plus(amount);
  }
  const diff = totalTax.minus(written);
  if (!diff.isZero() && taxed.length) {
    // a difference of at most one paisa per line and tax ledger is the rounding of each line: it goes on the last line
    if (diff.abs().lessThanOrEqualTo(new Decimal('0.01').times(taxed.length * taxes.length))) taxed[taxed.length - 1].amount = taxed[taxed.length - 1].amount.plus(diff);
    else notes.push({ kind: 'tax_amount_differs', message: `The tax worked out line by line from Tally's rates is ${written.toFixed(2)}, but the tax ledgers ${names} carry ${totalTax.toFixed(2)} (a difference of ${diff.abs().toFixed(2)}, within one rupee per ledger). The tax was put on the lines by their rates.` });
  }
  return { perLine, problem: null, notes };
}

// ---------- the tax Zoho Books works out ----------
// The components of the Zoho tax written on a line: a Tax Group (GST18) is CGST and SGST, each of its own rate (the
// rates of the Tally ledgers when they add up to the rate, else half each); a single tax (IGST18) is one component.
// Returns [{ key, rate }]; key names the component across the lines of a document.
export function taxComponents(t) {
  const rate = new Decimal(t.rate);
  if (t.type === 'Tax Group') {
    const own = (t.rates || []).map(r => new Decimal(r));
    const mine = own.length >= 2 && sumOf(own).equals(rate);
    const rates = mine ? own : [rate.div(2), rate.div(2)];
    const ledgers = mine && t.ledgers?.length === own.length ? t.ledgers : (t.ledgers?.length === 2 ? t.ledgers : []);
    return rates.map((r, i) => ({ key: `group|${i}|${r}`, rate: r, ledger: ledgers[i] || null }));
  }
  return [{ key: `single|0|${rate}`, rate, ledger: t.ledgers?.length === 1 ? t.ledgers[0] : null }];
}
// The tax Zoho Books works out for a document. entries: [{ amount (Decimal), comps: taxComponents }]. Zoho rounds each
// component on its own (a test import: 31355.94 at GST18 gave CGST 2822.03 + SGST 2822.03 = 5644.06, not 18% rounded
// once, 5644.07). mode 'line' (Zoho's "item level" tax rounding, the default): each component of each line rounded to
// the paisa; 'entity' ("transaction level"): each component summed over the document unrounded, then rounded once.
// Returns { total, byLedger: Map(Tally tax ledger -> Zoho's amount) } (a component that names no ledger is under null).
export function zohoTaxModel(entries, mode = 'line') {
  const byLedger = new Map();
  const add = (ledger, x) => byLedger.set(ledger ?? null, (byLedger.get(ledger ?? null) || ZERO).plus(x));
  if (mode === 'entity') {
    const byKey = new Map();
    for (const e of entries) for (const c of e.comps) {
      const k = byKey.get(c.key) || { sum: ZERO, ledger: c.ledger };
      k.sum = k.sum.plus(e.amount.times(c.rate).div(100)); byKey.set(c.key, k);
    }
    for (const k of byKey.values()) add(k.ledger, r2(k.sum));
  } else {
    for (const e of entries) for (const c of e.comps) add(c.ledger, r2(e.amount.times(c.rate).div(100)));
  }
  return { total: sumOf([...byLedger.values()]), byLedger };
}

// The same tax, per tax head Zoho posts (the comps carry head). Returns Map(head -> amount).
export function zohoTaxByHead(entries, mode = 'line') {
  const out = new Map();
  const add = (head, x) => out.set(head, (out.get(head) || ZERO).plus(x));
  if (mode === 'entity') {
    const byKey = new Map();
    for (const e of entries) for (const c of e.comps) { const k = byKey.get(c.key) || { sum: ZERO, head: c.head }; k.sum = k.sum.plus(e.amount.times(c.rate).div(100)); byKey.set(c.key, k); }
    for (const k of byKey.values()) add(k.head, r2(k.sum));
  } else for (const e of entries) for (const c of e.comps) add(c.head, r2(e.amount.times(c.rate).div(100)));
  return out;
}

// GST worked out by Tally on a base that includes duty lines of Tally type "Others" (bills: such a line is otherwise a
// line with no tax). lines: the document lines; those with otherDuty may join the base. taxes: the GST tax groups.
// Returns { rate, shares: { head: Decimal }, lines: [the otherDuty lines to tax] } only when, for every GST head:
//  - no standard GST rate fits the tax on the taxed lines alone (to the paisa per head), and
//  - exactly one standard rate fits it on the taxed lines plus ALL the positive otherDuty lines (to the paisa per head).
// Otherwise null (nothing changes). CGST and SGST each take half the rate, IGST the whole rate; any other head (cess)
// is never decided this way.
export function gstBaseWithOtherDuty(lines, taxes) {
  const extra = lines.filter(l => l.otherDuty && l.noTax && l.total.greaterThan(0));
  if (!extra.length || !taxes.length) return null;
  if (taxes.some(t => !['CGST', 'SGST', 'IGST'].includes(t.head))) return null;
  const amountByHead = new Map();
  for (const t of taxes) amountByHead.set(t.head, (amountByHead.get(t.head) || ZERO).plus(t.amount));
  const heads = [...amountByHead.keys()];
  if (heads.includes('IGST') ? heads.length !== 1 : !(heads.includes('CGST') && heads.includes('SGST'))) return null;
  const shareOf = (head, s) => (head === 'IGST' ? s : s.div(2));
  const base = sumOf(lines.filter(l => !l.noTax && l.total.greaterThan(0)).map(l => l.total));
  const fitsOn = (amount, s) => heads.every(h => r2(amount.times(shareOf(h, s)).div(100)).minus(amountByHead.get(h)).abs().lessThanOrEqualTo('0.01'));
  if (base.greaterThan(0) && STANDARD_GST_RATES.some(s => fitsOn(base, s))) return null;
  const wide = base.plus(sumOf(extra.map(l => l.total)));
  const fits = STANDARD_GST_RATES.filter(s => fitsOn(wide, s));
  if (fits.length !== 1) return null;
  // a taxed line whose own Tally rate is another rate is not decided
  if (lines.some(l => !l.noTax && l.total.greaterThan(0) && l.rates && heads.some(h => l.rates[h] && !new Decimal(l.rates[h]).equals(shareOf(h, fits[0]))))) return null;
  return { rate: fits[0], shares: Object.fromEntries(heads.map(h => [h, shareOf(h, fits[0])])), lines: extra };
}

// ---------- the party line ----------
// The party line of an Invoice or Bill, or why the voucher cannot be written as one. Returns { party, lines } or
// { error, kind? }. The party is the line that names the voucher's partyledgername; when the voucher names no party,
// the line that names a customer (or vendor) from the masters.
// A voucher whose party is on the WRONG side (the customer credited on an invoice, the vendor debited on a bill) is a
// reversal: a credit note, a debit note, a payment or an adjustment. Written as an invoice or bill it would post the
// opposite of the Tally entry, so it is left out with that reason and never written with positive totals.
export function partyDocParty(v, kind, parties) {
  const lines = voucherLines(v);
  const candidates = lines.filter(l => parties.has(l.ledger));
  const named = v.partyledgername ? lines.filter(l => l.ledger === v.partyledgername) : [];
  const partyLines = named.length ? named : candidates;
  const who = kind === 'Invoice' ? 'customer' : 'vendor';
  if (partyLines.length !== 1) return { code: 'no_single_party', error: `Left out of the file: could not identify exactly one ${who} on this voucher.` };
  const party = partyLines[0];
  if (!party.amount) return { code: 'party_amount_unreadable', error: `Left out of the file: the amount of the ${who} line cannot be read.` };
  const wrongSide = kind === 'Invoice' ? !party.amount.isNegative() && !party.amount.isZero() : party.amount.isNegative();
  if (wrongSide) {
    return { kind: 'left_out_party_side', code: 'party_side', error: kind === 'Invoice'
      ? `Left out of the file: the customer "${party.ledger}" is credited on this voucher, so it is not an invoice (it looks like a credit note, money received or an adjustment). Written as an invoice it would post the opposite of the Tally entry. An accountant must decide how to enter it in Zoho Books.`
      : `Left out of the file: the vendor "${party.ledger}" is debited on this voucher, so it is not a bill (it looks like a debit note, a payment or an adjustment). Written as a bill it would post the opposite of the Tally entry. An accountant must decide how to enter it in Zoho Books.` };
  }
  return { party, lines };
}

// What is said about an invoice or bill that carries negative rows.
function negativeRowMessage(kind, negatives, kindOf) {
  const doc = kind === 'Invoice' ? 'invoice' : 'bill';
  const names = [...new Map(negatives.map(n => [n.ledger, n])).values()].map(n => {
    const k = n.isTax ? 'tax' : kindOf ? kindOf(n.ledger) : null;
    return `"${n.ledger}" (${KIND_WORDS[k] || 'a ledger whose group is not known'})`;
  });
  const n = negatives.length;
  return `This ${doc} carries ${n} row${n === 1 ? '' : 's'} with a negative amount: ${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} ${kind === 'Invoice' ? 'debited' : 'credited'} on the voucher, the same side as the ${kind === 'Invoice' ? 'customer' : 'vendor'}. `
    + `The ${doc} total is therefore the net amount ${kind === 'Invoice' ? 'the customer owes' : 'owed to the vendor'}, not the full value of the ${doc}. `
    + `Nothing was changed or left out. Round-off ledgers (Tally type Invoice Rounding) go to the Adjustment column and TDS to the TDS columns; nothing in Tally says with certainty that ${n === 1 ? 'this row is' : 'these rows are'} a discount. An accountant must decide how to enter ${n === 1 ? 'this row' : 'these rows'} in Zoho Books (for example a discount, an adjustment, a credit note or a separate journal). `
    + 'Zoho Books may refuse a negative row on import: this has not been verified.';
}

// ---------- one Invoice or Bill ----------
// ctx: { customers, vendors, taxLedgers (NameSets), taxMap, kindOf, accountName, taxInfo(ledger), tdsMap, contactOf(kind, ledger), settings }
// Returns { rows, warning, negatives, flags: [{ kind, message }], tax: [{ ledger, zohoTax }], partySideTax: [ledger],
//   tdsUnmapped: [ledger], tdsUsed: { ledger, zohoTds } | null, number, zohoTotal, partyAmount } or { error, kind? }.
function partyDocument(v, kind, ctx, unmappedTax) {
  const bal = voucherBalance(v);
  if (!bal.ok) return { code: bal.unreadable ? 'unreadable_amount' : 'not_balanced', ...(bal.unreadable ? { kind: 'unreadable_amount' } : {}), error: `Left out of the file: ${bal.error}.` };
  const bill = kind === 'Bill';
  const parties = bill ? ctx.vendors : ctx.customers;
  const found = partyDocParty(v, kind, parties);
  if (found.error) return found;
  const { party, lines } = found;
  const sign = bill ? -1 : 1; // invoice: the customer is debited, so credits are positive; bill: the reverse
  const flags = [];
  const flag = (k, message) => flags.push({ kind: k, message });
  const canonical = name => ctx.taxLedgers.canonical?.(name) ?? name;
  const info = name => (ctx.taxLedgers.has(name) ? ctx.taxInfo(canonical(name)) || { tds: false, gst: false, head: null, rate: null } : null);

  // sort the lines: item and account lines, GST on the other side, tax on the party's side, TDS, round-off
  const items = [], gst = [], partySideTax = [], tdsLines = [], roundOff = [], tcsLines = [];
  // An invoice line on an account that is not an income account (an expense, an asset, a tax ledger ...): Zoho wants an
  // income account and an item on every invoice line, and such a line would be a service item on that account with a
  // zero-rate GST (a wrong nil-rated line in GSTR-1). It goes to the Adjustment column instead (defaults.js 16).
  const nonIncome = [];
  const notIncome = name => { const k = ctx.kindOf?.(name); return !!k && k !== 'income'; };
  for (const [idx, l] of lines.entries()) {
    if (l === party || !l.amount || l.amount.isZero()) continue;
    const total = l.amount.times(sign);
    const ti = info(l.ledger);
    const line = { ...l, total, idx };
    // v2 default 15: a round-off ledger (Tally type Invoice Rounding) goes to Zoho's Adjustment column, not a line
    if (!ti && !l.item && ctx.isRoundOff?.(l.ledger)) { roundOff.push(line); continue; }
    // TDS deducted by the customer, booked on a ledger named like Zoho's own "TDS Receivable" account (often under
    // Loans & Advances in Tally, not a TDS-type tax ledger): the invoice's TDS columns, like a TDS-type ledger
    const receivable = !ti && !bill && !l.item && total.isNegative() ? ctx.customerTds?.(l.ledger) : null;
    if (receivable) { tdsLines.push({ ...line, ledger: receivable }); continue; }
    if (!ti) { if (!bill && !l.item && notIncome(l.ledger)) nonIncome.push(line); else items.push(line); continue; }
    // TDS on the party's side: deducted from the vendor on a bill, deducted by the customer on an invoice. Both go to
    // the document's TDS columns (invoices since v2; Zoho's invoice sample has the same four TDS columns).
    if (total.isNegative()) {
      // a Duties & Taxes ledger named like TDS Receivable whose Tally type is not GST (a duty head left on an "Others"
      // ledger does not make it GST)
      const recv = !bill && !ti.tds && String(ti.type || '').toUpperCase() !== 'GST' ? ctx.customerTds?.(l.ledger) : null;
      if (ti.tds) tdsLines.push(line); else if (recv) tdsLines.push({ ...line, ledger: recv }); else partySideTax.push(line);
      continue;
    }
    if (ti.tds) {
      flag('tds_on_other_side', `TDS ledger "${l.ledger}" is ${bill ? 'debited' : 'credited'} on this ${bill ? 'bill' : 'invoice'}, the side opposite the ${bill ? 'vendor' : 'customer'}, which is not tax deducted from it. It is written ${bill ? 'as an ordinary line with its account, without tax' : 'in the Adjustment column (it is not an income line)'}. Check the voucher in Tally.`);
      if (bill) items.push({ ...line, noTax: true }); else nonIncome.push(line);
      continue;
    }
    // TDS-015: tax collected at source on the side opposite the party (credited on an invoice, debited on a bill): never
    // a GST line; the Adjustment column (default) or Zoho's TCS columns (setting tcsMode), decided below
    if (ti.tcs) { tcsLines.push(line); continue; }
    if (ti.other) {
      // Tally's type of duty/tax is neither GST nor TDS (for example "Others"): it is not a GST rate, so it is never
      // added to the GST of the lines. It is a line of its own, on its own account, with no tax.
      flag('non_gst_duty_on_document', `Duties & Taxes ledger "${l.ledger}" has the type "${ti.type}" in Tally, which is neither GST nor TDS. It is not counted as GST: it is written ${bill ? `as a line of its own (${total.toFixed(2)}) on its own account, with no tax` : `in the Adjustment column (${total.toFixed(2)}), because it is not an income line`}. `
        + `If it is tax collected at source or another charge that Zoho Books records in its own field, an accountant must decide how to enter it (nothing is decided from the ledger's name).`);
      if (bill) items.push({ ...line, noTax: true, otherDuty: true }); else nonIncome.push(line);
      continue;
    }
    gst.push(line);
  }

  // Tax under reverse charge: on a bill, GST ledgers debited AND GST ledgers credited (on the vendor's side) with the
  // same amount for every duty head. The vendor charged no GST, so it is not written as the vendor's tax on the lines,
  // and the credited side is not written as a negative line. It is written in the bill's Reverse Charge columns (Zoho's
  // sample, docs/ZOHO_IMPORT_RULES.md 3.5), worked out below once the lines are known; when that cannot be done with
  // certainty the bill is flagged for an accountant (reverse_charge_bill).
  let reverseCharge = null;
  const partySideGst = partySideTax.filter(l => info(l.ledger)?.gst);
  if (bill && gst.length && partySideGst.length) {
    const byHead = list => { const m = new Map(); for (const l of list) { const k = info(l.ledger).head || canonical(l.ledger); m.set(k, (m.get(k) || ZERO).plus(l.total.abs())); } return m; };
    const dr = byHead(gst), cr = byHead(partySideGst);
    // the SAME ledger debited and credited is a reversal of input credit (or a correction) on that ledger, not reverse
    // charge (GST-010): the shape is not read then
    const sameLedger = gst.some(l => partySideGst.some(x => canonical(x.ledger) === canonical(l.ledger)));
    if (!sameLedger && dr.size === cr.size && [...dr].every(([k, a]) => cr.has(k) && cr.get(k).equals(a))) {
      reverseCharge = { debited: [...new Set(gst.map(l => canonical(l.ledger)))], credited: [...new Set(partySideGst.map(l => canonical(l.ledger)))], amount: sumOf([...dr.values()]),
        lines: [...gst, ...partySideGst], debitedLines: [...gst] };
      gst.length = 0;
      for (const l of partySideGst) partySideTax.splice(partySideTax.indexOf(l), 1);
    }
  }

  // TDS on the party's side: one TDS ledger goes to Zoho's TDS fields, with the Zoho TDS tax mapped in Mapping Studio,
  // else (v2 default 14) the one suggested from its section in Tally (tds_name_default)
  let tds = null;
  const tdsUnmapped = [];
  const toAdjustEarly = [];
  const docWord = bill ? 'bill' : 'invoice';
  if (tdsLines.length) {
    const byLedger = new Map();
    for (const l of tdsLines) byLedger.set(canonical(l.ledger), (byLedger.get(canonical(l.ledger)) || ZERO).plus(l.total.abs()));
    if (byLedger.size > 1) {
      flag('tds_several_on_bill', `This ${docWord} has tax deducted at source on ${byLedger.size} TDS ledgers (${quoteList([...byLedger.keys()])}), and a Zoho ${docWord} takes one TDS. They are written ${bill ? 'as lines with a negative amount' : 'in the Adjustment column'}, so the total still equals the amount ${bill ? 'owed to the vendor' : 'the customer owes'}. An accountant must decide how to enter them in Zoho Books.`);
      if (bill) items.push(...tdsLines); else nonIncome.push(...tdsLines);
    } else {
      const [ledger, amount] = [...byLedger.entries()][0];
      const m = ctx.tdsMap[ledger];
      // v2 default 14: the TDS tax suggested from the section in Tally; on an invoice (TDS deducted by the customer) a
      // ledger with no section gets the default TDS tax for customers (defaults.js CUSTOMER_TDS_DEFAULT), never a line
      // (ctx.customerTdsDefault: the same said with the names of the organisation's TDS export, when given; null there
      // when the export has no such tax)
      // (the percentage, the section code and the final name are worked out below, once the lines and the tax are known:
      // tds.js resolveTds)
      const suggested = !m?.tdsName ? (ctx.tdsDefault?.(ledger) || (!bill ? { tdsName: '', section: '', percent: '', why: CUSTOMER_TDS_DEFAULT.why } : null)) : null;
      // TDS-001: with a chosen name the section Tally gives stays the fallback (a name that says no section keeps Tally's)
      if (m?.tdsName) tds = { ledger, amount, mapping: m, suggested: ctx.tdsDefault?.(ledger) || null };
      else if (suggested) tds = { ledger, amount, mapping: null, suggested, byDefault: true };
      else {
        tdsUnmapped.push(ledger);
        // round 1 (issue 12): on a bill with other lines, TDS with no Zoho TDS tax goes to the Adjustment column (as TCS
        // does), and the generated adjustment journal moves it to the TDS ledger: no negative line, no GST0 taxable line
        if (bill && items.length) {
          toAdjustEarly.push(...tdsLines.map(l => ({ ...l, tdsAdjust: true })));
          flag('tds_to_adjustment', `Tax deducted at source on "${ledger}" (${amount.toFixed(2)}) has no Zoho TDS tax (none is chosen in Mapping Studio and none can be suggested from its section in Tally), so it is written in the Adjustment column of this bill (${amount.negated().toFixed(2)}), not as a line with a negative amount and a zero-rate GST. ${ctx.settings.billAdjustmentAccount ? 'The adjustment journal generated in the Manual Journals file moves it back to the TDS ledger, so the bill total, the vendor and the trial balance are those of Tally. ' : ''}Zoho's TDS reports stay empty for it: choose the Zoho TDS tax in Mapping Studio (TDS mapping) to write it in Zoho's TDS columns instead.`);
        } else items.push(...tdsLines);
      }
    }
  }
  // tax on the party's side that is not Zoho TDS: on a bill a line with a negative amount, flagged; on an invoice it is
  // not an income line, so it goes to the Adjustment column
  if (bill) items.push(...partySideTax); else nonIncome.push(...partySideTax);
  // invoice lines that are not income: to the Adjustment column, unless the invoice would have no line left (then they
  // stay lines, with no item and no tax, and the invoice is flagged: an accountant decides)
  const toAdjust = [...toAdjustEarly];
  if (!bill && nonIncome.length) {
    if (items.length) toAdjust.push(...nonIncome);
    else {
      items.push(...nonIncome.map(l => ({ ...l, notIncome: true, noTax: true })));
      flag('invoice_line_not_income', `Every line of this invoice is on an account that is not an income account (${quoteList([...new Set(nonIncome.map(l => canonical(l.ledger)))])}). Zoho Books needs an income account and an item on an invoice line, so Zoho is expected to refuse these lines. `
        + 'No service item is made for them. An accountant must decide how to enter this voucher in Zoho Books (a journal voucher can be routed to Manual Journal in Voucher Classification).');
    }
  }
  // TDS-015: TCS. With no other line there is nothing to adjust: it stays a line of its own with no tax (an accountant
  // decides). Else the Adjustment column, the adjustment journal moving it back to the TCS ledger (the default); with the
  // setting tcsMode 'columns' and one TCS ledger, Zoho's TCS columns (worked out below once the tax is known).
  let tcs = null;
  if (tcsLines.length) {
    const tcsLedgers = [...new Set(tcsLines.map(l => canonical(l.ledger)))];
    const tcsAmount = sumOf(tcsLines.map(l => l.total));
    if (!items.length) {
      items.push(...tcsLines.map(l => (bill ? { ...l, noTax: true, otherDuty: true } : { ...l, notIncome: true, noTax: true })));
      flag('non_gst_duty_on_document', `TCS ledger ${quoteList(tcsLedgers)} is the only line of this ${docWord} besides the ${bill ? 'vendor' : 'customer'}, so it is written as a line of its own with no tax. An accountant must decide how to enter it in Zoho Books.`);
    } else if (ctx.settings.tcsMode === 'columns' && tcsLedgers.length === 1 && tcsAmount.greaterThan(0)) {
      tcs = { ledger: tcsLedgers[0], amount: tcsAmount, lines: tcsLines };
    } else {
      toAdjust.push(...tcsLines.map(l => ({ ...l, tcs: true })));
      flag('tcs_to_adjustment', `Tax collected at source on ${quoteList(tcsLedgers)} (${tcsAmount.toFixed(2)}) is written in the Adjustment column of this ${docWord}, not as a line with GST${bill ? ' (never as a zero-rated GST0 purchase)' : ''}. ${(bill ? ctx.settings.billAdjustmentAccount : ctx.settings.invoiceAdjustmentAccount) ? 'The adjustment journal generated in the Manual Journals file moves it back to the TCS ledger, so the trial balance is Tally\'s. ' : ''}${ctx.settings.tcsMode === 'columns' ? (tcsLedgers.length > 1 ? 'Zoho takes one TCS per document and this one has several TCS ledgers. ' : 'The TCS amount is not positive. ') : 'Zoho\'s TCS reports stay empty for it: choose "TCS columns" in Voucher files to write it in Zoho\'s TCS columns instead (TCS taxes must be created in Zoho first). '}`);
    }
  }
  // a document whose only other line is a round-off keeps it as a line (an Adjustment needs a document to adjust)
  if (roundOff.length && !items.length) { items.push(...roundOff); roundOff.length = 0; }
  const docLines = items.sort((a, b) => a.idx - b.idx); // Tally's order
  const negatives = docLines.filter(l => l.total.isNegative()).map(l => ({ ledger: l.ledger, isTax: !!info(l.ledger) }));
  if (!docLines.length) return { code: 'no_lines', error: `Left out of the file: the ${bill ? 'bill' : 'invoice'} has no line other than the ${bill ? 'vendor' : 'customer'}${tds ? ' and the tax deducted at source' : ''} and its tax.` };

  // GST: grouped by ledger, then put on the lines
  const taxGroups = new Map();
  for (const l of gst) {
    const k = canonical(l.ledger);
    const ti = info(l.ledger);
    const g = taxGroups.get(k) || { ledger: k, amount: ZERO, head: ti.head, rate: ti.rate };
    g.amount = g.amount.plus(l.total);
    taxGroups.set(k, g);
  }
  const taxes = [...taxGroups.values()];
  // TDS: the Zoho TDS tax, the percentage and the section code of every row that has a TDS Amount (Zoho refuses a row
  // with TDS but no percentage or section code), from Tally's own amounts, the TDS mapping and the table (tds.js)
  if (tds) {
    const res = resolveTds({ amount: tds.amount, subTotal: sumOf(docLines.map(l => l.total)), taxTotal: sumOf(taxes.map(x => x.amount)), date: isoDate(v.date), settings: ctx.settings,
      mapping: tds.mapping, suggestion: tds.suggested || null, customer: !bill, exported: ctx.tdsExport || null, claims: ctx.tdsClaims || null, businessType: ctx.businessType || '' });
    tds.res = res;
    tds.map = { tdsName: res.tdsName, section: res.section, percent: res.percent };
    // TDS-003 / TDS-018 / TDS-001: a tax of the export not valid on the date, a section nobody knows, a new-act code on an old date
    for (const w of res.warnings || []) flag(w.kind, `TDS on this ${docWord} (ledger "${tds.ledger}"): ${w.text}`);
    if (tds.byDefault) {
      flag('tds_name_default', `No Zoho TDS tax is chosen for TDS ledger "${tds.ledger}", so "${res.tdsName}" is written in the TDS columns of this ${docWord} (${tds.suggested.why}). TDS Amount is Tally's amount. This is the tool's default and is not confirmed until the next test import. Choose another in Mapping Studio (TDS mapping) if your organisation names it differently.`);
    }
    if (res.missing.length) {
      flag('tds_details_missing', `TDS on this ${docWord} (ledger "${tds.ledger}", ${tds.amount.toFixed(2)}) is written without ${res.missing.join(' and ')}: it could not be worked out from Tally's amount, the TDS mapping or the table. Zoho refuses a row with TDS but no percentage or section code ("Enter the required TDS details."). Enter them in Mapping Studio (TDS mapping).`);
    } else if (res.rateFrom !== 'mapping' || res.sectionFrom !== 'mapping') {
      flag('tds_details_filled', `TDS on this ${docWord} is written as "${res.tdsName}", ${res.percent}% (${RATE_WORDS[res.rateFrom]}) and section code ${res.section} (${res.sectionFrom === 'zoho_export' ? "from Zoho's TDS export" : `the ${ACT_WORDS[res.act]} form, by the date of the document`}). Zoho refuses a TDS row without a percentage or a section code. Change them in Mapping Studio (TDS mapping).`);
    }
    if (res.ambiguous && res.entry) {
      flag('tds_section_ambiguous', `TDS on this ${docWord} (ledger "${tds.ledger}") has no section in Tally and ${res.percent}% fits more than one section, so the first, ${res.entry.section} (${res.entry.name}), is written. Choose the right Zoho TDS tax for the ledger in Mapping Studio (TDS mapping).`);
    }
    if (res.madeUnique) {
      flag('tds_tax_name_made_unique', `A TDS tax called "${res.nameFrom === 'unique' && tds.mapping?.tdsName ? tds.mapping.tdsName.trim() : res.entry?.name}" already exists in Zoho (or in the table) with another rate, or this rate is not the usual rate of the section, so this TDS is written as a tax of its own, "${res.tdsName}". Create it in Zoho Books as listed under TDS taxes to create (rate ${res.percent}%, section code ${res.section}).`);
    }
  }
  // GST that Tally worked out on a base that includes a duty line of type "Others" (bills): decided only from Tally's
  // amounts (gstBaseWithOtherDuty). Those lines then carry the same tax as the other lines; amount and account unchanged.
  const widened = bill ? gstBaseWithOtherDuty(docLines, taxes) : null;
  if (widened) {
    for (const l of widened.lines) { l.noTax = false; if (!l.rates) l.rates = widened.shares; }
    for (const l of docLines) if (!l.noTax && l.total.greaterThan(0) && !l.rates) l.rates = widened.shares;
    for (let i = flags.length - 1; i >= 0; i--) if (flags[i].kind === 'non_gst_duty_on_document' && widened.lines.some(l => flags[i].message.includes(`"${l.ledger}"`))) flags.splice(i, 1);
    flag('gst_on_other_duty_line',`Tally's GST on this bill (${taxes.map(t => `"${t.ledger}" ${t.amount.toFixed(2)}`).join(', ')}) is ${pct(widened.rate)}% of the lines together with ${quoteList([...new Set(widened.lines.map(l => canonical(l.ledger)))])} (a Duties & Taxes ledger whose Tally type is neither GST nor TDS), not of the other lines alone. `
      + `Zoho Books works the tax out from each line, so ${widened.lines.length === 1 ? 'that line carries' : 'those lines carry'} the same GST too, with ${widened.lines.length === 1 ? 'its' : 'their'} own account and amount: the bill total and the GST stay Tally's.`);
  }
  const att = attributeTax(docLines.filter(l => !l.noTax), taxes);
  if (att.problem) flag(att.problem.kind, att.problem.message);
  for (const n of att.notes) flag(n.kind, n.message);
  const taxOf = name => ctx.taxMap[name] || ctx.taxMap[canonical(name)] || '';
  const lineTax = new Map(); // line -> { name, rate, type, amount }
  const taxDefaults = new Map(); // Zoho's own tax name written by default -> the Tally tax ledgers it stands for
  for (const [l, a] of att.perLine) {
    let mapped = a.ledgers.map(taxOf);
    // GST-001: a Zoho tax named for its rate (GST18, IGST5) mapped to a ledger Tally uses at several rates is right only
    // for the lines of that rate. A line of another rate gets Zoho's tax of its own rate (when Zoho has it, or the saved
    // list does), never the mapped tax at the wrong rate; with none, its tax cells stay empty (not mapped). Said per line.
    if (!a.fromAmount && mapped.some(Boolean)) {
      const wrong = [...new Set(mapped.filter(m => { const x = /^I?GST(\d+(?:\.\d+)?)$/i.exec(String(m).trim()); return x && !new Decimal(x[1]).equals(a.rate); }))];
      if (wrong.length) {
        const own = defaultZohoTaxName(a.ledgers.map(x => info(x)?.head), a.rate, ctx.zohoTaxNames);
        const listed = own && (!ctx.zohoTaxNames?.length || ctx.zohoTaxNames.some(n => String(n).trim().toLowerCase() === String(own).toLowerCase()));
        mapped = a.ledgers.map(() => (listed ? own : ''));
        flag('tax_mapping_rate_differs', `${quoteList(a.ledgers)} ${a.ledgers.length === 1 ? 'is' : 'are'} mapped to ${quoteList(wrong)} in Mapping Studio (Tax mapping), a Zoho tax of another rate, but this line of the ${docWord} is at ${pct(a.rate)}% in Tally. `
          + (listed ? `Zoho's own tax of the line's rate, "${own}", is written instead, so the tax stays Tally's.` : 'No Zoho tax of the line\'s rate is known, so the tax cells of the line are left empty. Create the tax of that rate in Zoho Books and save the list of Zoho taxes, or leave the ledger unmapped so each line gets the tax of its own rate.'));
      }
    }
    // The rate was worked out from Tally's amounts because the ledger's own rate does not fit them: a Zoho tax mapped to
    // the ledger is a tax of the ledger's rate, so Zoho's own tax of the rate that fits is written instead (when Zoho has
    // it), never the mapped tax at the wrong rate.
    if (a.fromAmount && mapped.some(Boolean)) {
      const own = defaultZohoTaxName(a.ledgers.map(x => info(x)?.head), a.rate, ctx.zohoTaxNames);
      const listed = own && (!ctx.zohoTaxNames?.length || ctx.zohoTaxNames.some(n => String(n).trim().toLowerCase() === String(own).toLowerCase()));
      if (listed) mapped = a.ledgers.map(() => own);
    }
    // v2 default 13: no Zoho tax is chosen for ANY tax ledger of the line: Zoho's own tax of the line's rate (GST18 for
    // CGST and SGST, IGST18 for IGST), when Zoho has one. A mapping made in Mapping Studio always wins.
    // When the accountant saved the list of taxes of the Zoho organisation (ctx.zohoTaxNames), Zoho's own name is used
    // only if it is in that list: an organisation that names its taxes differently is never given a name it does not have.
    if (mapped.every(x => !x)) {
      const heads = a.ledgers.map(x => info(x)?.head);
      const own = defaultZohoTaxName(heads, a.rate, ctx.zohoTaxNames);
      const listed = !ctx.zohoTaxNames?.length || ctx.zohoTaxNames.some(n => String(n).trim().toLowerCase() === String(own).toLowerCase());
      if (own && listed) { mapped = a.ledgers.map(() => own); taxDefaults.set(own, a.ledgers); }
      // GST-011: a standard rate Zoho does not create by itself, and no such tax in the saved list: the line would carry no
      // tax and Zoho refuses it (INV-TAX-OR-EXEMPTION) or understates the total. Blocking, with the tax to create.
      // GST-005: cess on the line. Zoho Books has no tax of its own for GST with cess, so the whole tax of the line (the
      // GST too) would be left out unnoticed: blocking, with the tax group to create (GST and cess in one Zoho tax group)
      if (!own && heads.some(h => h === 'Cess' || h === 'State Cess')) {
        const gstHeads = heads.filter(h => h === 'CGST' || h === 'SGST' || h === 'IGST');
        flag('gst_cess_not_mapped', `A line of this ${docWord} carries GST with cess (${quoteList(a.ledgers)}, ${pct(a.rate)}% in all). Zoho Books has no tax of its own for GST with cess, and no Zoho tax is chosen for these ledgers, so the tax cells of the line are left empty: Zoho Books would leave out the GST and the cess, or refuse the line. `
          + `Create a tax group in Zoho Books with ${gstHeads.length ? `the ${gstHeads.includes('IGST') ? 'IGST' : 'CGST and SGST'} of the line and ` : ''}the cess (Settings > Taxes), then choose it for ${quoteList(a.ledgers)} in Mapping Studio (Tax mapping) and create the files again. Cess charged per quantity cannot be a Zoho rate and must be entered in Zoho Books by hand.`);
      }
      const toCreate = !own ? zohoTaxToCreate(heads, a.rate) : null;
      if (toCreate) {
        flag('gst_rate_without_zoho_tax', `A line of this ${docWord} carries GST at ${pct(a.rate)}% (${quoteList(a.ledgers)}), a rate for which Zoho Books creates no tax by itself, and no Zoho tax is chosen for these ledgers. The tax cells of the line are left empty, so Zoho Books is expected to refuse the line or leave out its GST. `
          + `Create the tax "${toCreate}" in Zoho Books (Settings > Taxes${toCreate.startsWith('GST') ? `: a tax group of CGST ${pct(a.rate.div(2))}% and SGST ${pct(a.rate.div(2))}%` : `: IGST ${pct(a.rate)}%`}), then save the list of Zoho taxes in the Import Wizard (or choose the tax in Mapping Studio, Tax mapping) and create the files again.`);
      }
      // CGST without SGST (or SGST without CGST): half of the GST. Zoho has no tax for it, so none is written: blocking
      const hs = new Set(heads);
      if (!own && hs.size === 1 && (hs.has('CGST') || hs.has('SGST'))) {
        const has = hs.has('CGST') ? 'CGST' : 'SGST', lacks = has === 'CGST' ? 'SGST' : 'CGST';
        flag('tax_heads_incomplete', `A line of this ${docWord} carries ${has} (${quoteList(a.ledgers)}, ${pct(a.rate)}%) but no ${lacks}. Zoho's GST taxes within a state are groups of CGST and SGST, so no Zoho tax can be written for half of the GST, and the tax cells of the line are left empty: `
          + `Zoho Books would work out no GST for it, or refuse the line. Check the voucher in Tally (the ${lacks} ledger may be missing), or map "${a.ledgers[0]}" in Mapping Studio (Tax mapping) to the Zoho tax that is right.`);
      }
    }
    a.ledgers.forEach((ledger, i) => { if (!mapped[i]) unmappedTax.add(ledger); });
    if (mapped.some(x => !x)) continue; // reported per ledger ("not mapped to a Zoho tax")
    const distinct = [...new Set(mapped)];
    if (distinct.length > 1) {
      flag('line_tax_names_differ', `The tax ledgers ${quoteList(a.ledgers)} on this ${bill ? 'bill' : 'invoice'} are mapped to different Zoho taxes (${quoteList(distinct)}), but a Zoho line carries one tax. Map them to the one Zoho tax (or tax group) that covers them all, for example a GST group for CGST and SGST. The tax cells of the line are left empty.`);
      continue;
    }
    lineTax.set(l, { name: distinct[0], rate: a.rate, type: a.ledgers.length === 1 ? 'ItemAmount' : 'Tax Group', amount: a.amount, ledgers: a.ledgers, rates: a.rates || [a.rate] });
  }
  for (const [own, ledgers] of taxDefaults) {
    flag('tax_name_default', `No Zoho tax is chosen for ${quoteList(ledgers)} in Mapping Studio (Tax mapping), so Zoho's own tax "${own}" is written (the tax Zoho Books creates for that rate). This is the tool's default and is not confirmed until the next test import: if your Zoho organisation uses another tax name, choose it in Mapping Studio.`);
  }

  // Reverse charge (defaults.js 17): the GST debited is put on the lines as for a vendor's tax (attributeTax), but in the
  // bill's Reverse Charge Tax Name, Rate and Type, so Zoho posts the input credit and the tax payable itself and the
  // bill total stays the amount owed to the vendor. The name: the Zoho tax mapped to the GST ledgers debited, else
  // Zoho's own tax of the rate (GST18 for CGST and SGST, IGST18 for IGST).
  const rcmLines = new Map(); // line -> { name, rate, type, amount, ledgers }
  let rcmWritten = false, rcmWhy = '';
  if (reverseCharge) {
    const groups = new Map();
    for (const l of reverseCharge.debitedLines) {
      const k = canonical(l.ledger), ti = info(l.ledger);
      const g = groups.get(k) || { ledger: k, amount: ZERO, head: ti.head, rate: ti.rate };
      g.amount = g.amount.plus(l.total);
      groups.set(k, g);
    }
    const r = attributeTax(docLines.filter(l => !l.noTax), [...groups.values()]);
    if (r.problem) rcmWhy = r.problem.message;
    for (const [l, a] of (r.problem ? [] : r.perLine)) {
      let names = a.ledgers.map(taxOf);
      if (names.every(x => !x)) {
        const own = defaultZohoTaxName(a.ledgers.map(x => info(x)?.head), a.rate, ctx.zohoTaxNames);
        const listed = own && (!ctx.zohoTaxNames?.length || ctx.zohoTaxNames.some(n => String(n).trim().toLowerCase() === own.toLowerCase()));
        names = a.ledgers.map(() => (listed ? own : ''));
      }
      const distinct = [...new Set(names)];
      if (distinct.length !== 1 || !distinct[0]) { rcmWhy = `no single Zoho tax can be named for ${quoteList(a.ledgers)} at ${pct(a.rate)}% (map ${a.ledgers.length === 1 ? 'it' : 'them'} in Mapping Studio, Tax mapping)`; rcmLines.clear(); break; }
      rcmLines.set(l, { name: distinct[0], rate: a.rate, type: a.ledgers.length === 1 ? 'ItemAmount' : 'Tax Group', amount: a.amount, ledgers: a.ledgers, heads: a.ledgers.map(x => info(x)?.head).filter(Boolean) });
    }
    rcmWritten = rcmLines.size > 0;
    if (rcmWritten) {
      const t = [...rcmLines.values()];
      flag('reverse_charge_written', `On this bill Tally debits ${quoteList(reverseCharge.debited)} and credits ${quoteList(reverseCharge.credited)} with the same GST amount for each duty head (${reverseCharge.amount.toFixed(2)} in all): tax under reverse charge, where the vendor charges no GST. `
        + `It is written in the Reverse Charge columns (${[...new Set(t.map(x => `${x.name} at ${pct(x.rate)}%`))].join(', ')}), not as the vendor's tax, so the bill total is the amount owed to the vendor and Zoho Books posts the reverse-charge input credit and the tax payable on its own tax accounts. `
        + 'Turn on reverse charge in Zoho Books (Settings > Taxes > GST Settings) before the import. This is the tool\'s default and is not confirmed until the next test import.');
    } else {
      flag('reverse_charge_bill', `On this bill Tally debits ${quoteList(reverseCharge.debited)} and credits ${quoteList(reverseCharge.credited)} with the same GST amount for each duty head (${reverseCharge.amount.toFixed(2)} in all): the shape of tax under reverse charge, where the vendor charges no GST. `
        + `The Reverse Charge columns could not be filled: ${rcmWhy || 'the reverse-charge GST cannot be put on the lines with certainty'}. The bill is written with its lines only, without this GST and without a negative line, so its total equals the amount owed to the vendor. `
        + 'An accountant must enter the reverse-charge tax on this bill in Zoho Books (or confirm it is not reverse charge), otherwise the input credit and the reverse-charge tax payable are missing from Zoho.');
    }
  }

  // the company's GST identity (companygst.js): registered (regular / composition) or not, and its home state. A voucher
  // without Tally's company GST state takes the company's state read from the GSTIN or the other vouchers (GST-013).
  const companyGst = ctx.companyGst || null;
  const companyRegular = !companyGst || companyGst.status === 'regular';
  const companyRegistered = !companyGst || companyGst.status !== 'unregistered';
  const cmpOwn = String(tallyText(v.cmpgststate)).trim();
  const companyState = cmpOwn ? stateCode(cmpOwn) : companyGst?.state || '';
  // GST-004: a company with more than one GST registration. A voucher of a registration other than the Zoho
  // organisation's (the GSTIN of the migration, else the most common one on the vouchers) is written with its own state,
  // but Zoho Books reads it against the organisation's state (or needs a branch, Branch Name, which the tool does not
  // write yet): blocking, so it is never imported unnoticed.
  {
    const own = String(tallyText(v.cmpgstin) ?? '').trim().toUpperCase();
    if (own && companyGst?.gstin && (companyGst.registrations || []).length > 1 && own !== companyGst.gstin) {
      flag('multiple_gst_registrations', `This ${docWord} belongs to the company's GST registration ${own}${gstinStateCode(own) ? ` (state ${gstinStateCode(own)})` : ''}, but the Zoho organisation is taken as registration ${companyGst.gstin}${companyGst.state ? ` (state ${companyGst.state})` : ''}: Tally's vouchers carry ${companyGst.registrations.length} company GSTINs (${companyGst.registrations.map(r => `${r.gstin} on ${plural(r.vouchers, 'voucher')}`).join(', ')}). `
        + 'Zoho Books works out IGST or CGST + SGST from the organisation\'s own state, so this document is expected to be refused or taxed differently. Set up a branch for each registration in Zoho Books and import each registration\'s documents into it, or keep a Zoho organisation per GSTIN (export each registration from Tally on its own). The tool does not write Branch Name yet.');
    }
  }
  // header values
  const contact = ctx.contactOf(bill ? 'vendors' : 'customers', party.ledger);
  const overseas = contact?.treatment === 'overseas';
  // A supply to or from an SEZ is always between states, even with an SEZ in the company's own state (IGST Act
  // s.7(5)(b)); Zoho's check reads it so too (zohocheck intra_inter_state). SYN-6, GST-008.
  const sez = contact?.treatment === 'business_sez';
  // Bill Number (v2 default 9): the supplier's invoice number (Tally's reference) when the voucher has one, else the
  // Tally voucher number. The same number twice for one vendor is put right in buildVoucherOutput.
  const voucherNumber = String(v.vouchernumber ?? '');
  const reference = bill && ctx.settings.billNumber === 'reference' ? cleanText(v.reference) : '';
  const number = reference || voucherNumber;
  const draft = ctx.settings.documentStatus === 'draft';
  const posTally = String(tallyText(v.placeofsupply)).trim();
  let place = '', source = '', destination = '';
  // With GST on a line, Zoho needs the states to tell IGST from CGST + SGST: a missing state then blocks the import.
  const missingKind = lineTax.size ? 'place_of_supply_missing_taxed' : 'place_of_supply_missing';
  if (!bill) {
    place = posTally ? stateCode(posTally) : contact?.place || '';
    if (!place && !overseas) flag(missingKind, posTally ? `Tally's place of supply on this invoice ("${posTally}") is not a state Zoho knows, so Place of Supply is left empty. Correct it in Tally or after the import.` : 'Neither the voucher nor the customer has a place of supply, so Place of Supply is left empty. Give the customer a state in Mapping Studio (Fix contacts).');
  } else {
    source = overseas ? '' : contact?.place || '';
    if (!source && !overseas) flag(missingKind, 'The vendor has no Source Of Supply (state), so Source of Supply is left empty. Give the vendor a state in Mapping Studio (Fix contacts).');
    const cmp = cmpOwn;
    destination = posTally ? stateCode(posTally) : cmp ? stateCode(cmp) : companyGst?.state || '';
    if (!destination) flag(missingKind, `Destination of Supply is left empty: ${posTally || cmp ? `"${posTally || cmp}" is not a state Zoho knows` : "the voucher has neither a place of supply nor the company's GST state"}.`);
  }
  // Reverse charge and the two states. Zoho refuses IGST on a supply inside one state ("IGST cannot be applied as this is an
  // intrastate transaction"; with no Source of Supply on an unregistered vendor it reads the supply as inside the state),
  // and GST between two states. The reverse charge tax is chosen from the states, not from the duty head Tally booked:
  // inside one state a GST tax group, between two states IGST. When the vendor has no state and Tally booked IGST the
  // setting rcmUnknownState decides (GST, or IGST as an import of services). Amounts never change; the tax accounts do.
  let treatmentOut = contact?.treatment || '', gstinOut = contact?.gstin || '';
  let rcmImportOfServices = false;
  // The vendor is already written as overseas because of its reverse charge bills (ctx.rcmForeignVendors: the vendors the
  // first pass over the batch found; decisions.js): the bill keeps Tally's IGST, with no Source of Supply.
  if (bill && rcmLines.size && overseas && ctx.rcmForeignVendors?.has?.(party.ledger)) {
    rcmImportOfServices = true;
    flag('rcm_state_unknown_assumed', `The vendor has no GSTIN and no state, and Tally booked IGST for the reverse charge on this bill. Such a supplier is taken as outside India (an import of services): the vendor and the bill are written with GST Treatment "overseas", the reverse charge stays IGST and Source of Supply is empty. This is the tool's default and Zoho Books has not confirmed it by an import yet. If the vendor is in India, give it a state in Mapping Studio (Fix contacts), or choose GST for this case in Mapping Studio (Voucher files).`);
  }
  if (bill && rcmLines.size && !overseas) {
    const intra = sez ? false : source && destination ? source === destination : null;
    const available = (heads, rate) => { const own = defaultZohoTaxName(heads, rate, ctx.zohoTaxNames); return own && (!ctx.zohoTaxNames?.length || ctx.zohoTaxNames.some(n => String(n).trim().toLowerCase() === own.toLowerCase())) ? own : ''; };
    const changed = [], unresolved = [];
    let importOfServices = false;
    for (const [l, rc] of [...rcmLines]) {
      const heads = rc.heads?.length ? rc.heads : rc.ledgers.map(x => info(x)?.head).filter(Boolean);
      const igst = heads.includes('IGST') && !heads.includes('CGST') && !heads.includes('SGST');
      const split = heads.includes('CGST') || heads.includes('SGST');
      let to = null, reason = '';
      if (intra === true && igst) { to = 'GST'; reason = 'inside_state'; }
      else if (intra === false && split) { to = 'IGST'; reason = 'between_states'; }
      else if (!source && igst) {
        // no state AND no GSTIN: an import of services by default (a vendor with a GSTIN is in India: only its state is missing)
        if (ctx.settings.rcmUnknownState === 'overseas' && !contact?.gstin) { importOfServices = true; continue; }
        to = 'GST'; reason = 'state_unknown';
      }
      if (!to) continue;
      const name = available(to === 'GST' ? ['CGST', 'SGST'] : ['IGST'], rc.rate);
      if (!name) { unresolved.push({ rc, to, reason }); continue; }
      rcmLines.set(l, { ...rc, name, type: to === 'GST' ? 'Tax Group' : 'ItemAmount', heads: to === 'GST' ? ['CGST', 'SGST'] : ['IGST'] });
      changed.push({ rc, to, reason, name });
    }
    if (importOfServices) {
      treatmentOut = 'overseas'; gstinOut = ''; rcmImportOfServices = true;
      flag('rcm_state_unknown_assumed', `The vendor has no GSTIN and no state, and Tally booked IGST for the reverse charge on this bill. Such a supplier is taken as outside India (an import of services): the bill is written with GST Treatment "overseas", the reverse charge stays IGST and Source of Supply is empty. This is the tool's default and Zoho Books has not confirmed it by an import yet. If the vendor is in India, give it a state in Mapping Studio (Fix contacts), or choose GST for this case in Mapping Studio (Voucher files).`);
    }
    if (changed.length) {
      const c = changed[0], was = c.to === 'GST' ? 'IGST' : 'CGST and SGST', now = c.to === 'GST' ? 'CGST and SGST' : 'IGST';
      const where = c.reason === 'state_unknown' ? `the vendor has no state, so the supply is taken as inside the company's state (${destination || 'the company\'s state'}) as the setting for this case says`
        : c.reason === 'inside_state' ? `the supply is inside one state (Source of Supply ${source}, Destination of Supply ${destination})` : sez ? 'the vendor is an SEZ unit, and a supply from an SEZ is between states' : `the supply is between two states (Source of Supply ${source}, Destination of Supply ${destination})`;
      flag(c.reason === 'state_unknown' ? 'rcm_state_unknown_assumed' : 'rcm_tax_type_changed', `Tally booked the reverse charge on this bill as ${was} (${quoteList([...new Set(c.rc.ledgers)])}), but ${where}. `
        + `Zoho refuses ${was} there (${c.to === 'GST' ? '"IGST cannot be applied as this is an intrastate transaction"' : '"IGST must be applied for inter-state transactions"'}), so ${quoteList([...new Set(changed.map(x => x.name))])} (${now}) is written. `
        + `The amounts are unchanged but the tax accounts differ: Zoho posts ${now} where Tally posted ${was}.`);
    }
    for (const u of unresolved) {
      flag('tax_type_state_mismatch', `The reverse charge of this bill is ${u.to === 'GST' ? 'IGST' : 'CGST and SGST'} (${quoteList([...new Set(u.rc.ledgers)])}) but the supply is ${u.reason === 'between_states' ? 'between two states' : 'inside one state or from a vendor with no state'}, and no Zoho tax of ${pct(u.rc.rate)}% (${u.to === 'GST' ? 'GST' : 'IGST'}) is known to write instead. Zoho is expected to refuse it ("IGST cannot be applied as this is an intrastate transaction"). Choose the tax in Mapping Studio (Tax mapping) or correct the vendor's state in Fix contacts.`);
    }
  }
  // IGST is for a supply between two states, CGST + SGST for one within a state: a line whose tax does not fit the two
  // states is flagged (with both states), never changed. Checked only when both states are known.
  {
    const from = bill ? source : companyState;
    const to = bill ? destination : place;
    const headsOf = t => (t.heads?.length ? t.heads : t.ledgers.map(x => info(x)?.head).filter(Boolean));
    if (overseas || sez) {
      // an SEZ or overseas party: a supply between states whatever the two states say, so IGST is right and CGST + SGST
      // is what Zoho refuses ("IGST must be applied"); the cause and the two ways out are said (GST-015)
      for (const t of [...lineTax.values(), ...rcmLines.values()]) {
        const heads = headsOf(t);
        if (!(heads.includes('CGST') || heads.includes('SGST'))) continue;
        const who = bill ? 'vendor' : 'customer';
        flag('tax_type_treatment_mismatch', `The ${bill ? 'bill' : 'invoice'} carries CGST and SGST ("${t.name}"), but the ${who} is written with GST Treatment ${overseas ? 'overseas' : 'SEZ (business_sez)'}, and ${overseas ? 'Zoho Books treats a supply with an overseas party' : 'a supply to or from an SEZ is'} as between states, where only IGST is taken. Nothing was changed. `
          + `Zoho Books is expected to refuse the line ("IGST must be applied for inter-state transactions"). Either ${overseas ? `the supply was inside India: give the ${who} an Indian state and the right registration in Mapping Studio (Fix contacts)` : `the ${who} is not an SEZ unit: correct its registration in Tally or Fix contacts`}, or the tax in Tally should have been IGST: correct the voucher in Tally and export again.`);
        break;
      }
    } else if (from && to) {
      for (const t of [...lineTax.values(), ...rcmLines.values()]) {
        const heads = t.heads?.length ? t.heads : t.ledgers.map(x => info(x)?.head).filter(Boolean);
        const igst = heads.includes('IGST') && !heads.includes('CGST') && !heads.includes('SGST');
        const split = heads.includes('CGST') || heads.includes('SGST');
        if ((igst && from === to) || (split && from !== to)) {
          const gstinState = contact?.gstin ? String(contact.gstin).slice(0, 2) : '';
          flag('tax_type_state_mismatch', `The ${bill ? 'bill' : 'invoice'} carries ${igst ? 'IGST' : 'CGST and SGST'} ("${t.name}"), but ${bill ? `Source of Supply is ${from} and Destination of Supply is ${to}` : `the company's GST state is ${from} and Place of Supply is ${to}`}: `
            + `${igst ? 'IGST is for a supply between two different states' : 'CGST and SGST are for a supply within one state'}.${gstinState ? ` The ${bill ? 'vendor' : 'customer'}'s GSTIN belongs to state ${gstinState}.` : ''} `
            + `Nothing was changed. Correct the ${bill ? 'vendor' : 'customer'}'s state in Mapping Studio (Fix contacts) or the tax mapping, or check the voucher in Tally; otherwise Zoho Books may reject the line or work the tax out differently.`);
          break;
        }
      }
    }
  }
  if (!bill && number.length > 50) flag('document_number_too_long', `The invoice number "${number}" has ${number.length} characters; Zoho allows 50. Shorten it before the import.`);

  const docName = ctx.accountName(party.ledger);
  const narration = cleanText(v.narration);
  let zohoTotal = ZERO;
  // what Zoho Books works out itself, against what Tally says (sums over the lines of the document)
  let lineSum = ZERO, zohoTaxSum = ZERO, tallyTaxSum = ZERO, taxedLines = 0;
  // what the document posts once Zoho Books has it, in Tally's sign (a debit negative): each row and its tax on the
  // side opposite the party, the TDS credited on a bill, the party at the document total (voucher reconciliation)
  const posted = [];
  const hsnNotWritten = new Map(), hsnCorrected = new Map(); // HSN/SAC value as in Tally -> lines
  const hsnSuggested = new Map(), hsnChosen = new Map(), hsnMissing = new Map(), hsnHeading = new Map(); // item or account name -> { n, code }
  // v2 default 12. A vendor written as registered (regular or SEZ code of the chosen set): Zoho asks for a tax, an
  // exemption or reverse charge on every line. A line with NO GST in Tally gets what the migration's setting says
  // (billLineWithoutTax in defaults.js: by default Zoho's zero-rate tax). A line whose GST exists in Tally but could
  // not be written (not attributable, no usable tax name, the shape of reverse charge) is NOT given a zero-rate tax,
  // which would be wrong: its cells stay empty and the bill carries the blocking flag.
  // A company NOT registered for GST asks no tax on any line (a Zoho organisation without GST has no tax fields): never
  // a zero-rate default and never the blocking flag (GST-012, SYN-13).
  const needsTax = bill && companyRegistered && !!contact?.treatment && !!ctx.gstRegisteredCodes?.has(contact.treatment);
  const noTax = billLineWithoutTax(ctx.settings, { source, destination, interState: sez || treatmentOut === 'overseas' });
  const gstNotWritten = !!att.problem || (!!reverseCharge && !rcmWritten);
  const withoutTax = { written: 0, blocked: 0 };
  // v2 default 15: an invoice line with no GST in Tally gets Zoho's zero-rate tax (GST0 in the company's state, IGST0
  // between states); the company's state is Tally's GST state on the voucher, else the company's (companygst.js). Not
  // for an overseas customer. Only for a company registered for GST under the Regular scheme: a company not registered
  // writes no tax at all, and a composition company charges no GST on its sales (a bill of supply), so no output tax.
  const invoiceNoTax = !bill && companyRegular ? invoiceLineWithoutTax({ from: companyState, to: place, overseas, sez }) : null;
  let invoiceNoTaxState = 0; // lines of a Regular company left without a tax because the company's state is unknown
  let invoiceZeroLines = 0;
  // the round-off of the document, and on an invoice the lines that are not income, in the document's sign (positive
  // adds to the total): Zoho's Adjustment column
  if (tcs) {
    // the rate Tally's own amount shows (on the total including GST, as TCS is collected on the whole sale, else on the
    // sub total), else the ledger's rate, else the usual rate of the nature; the nature of collection by the act of the date
    const sub = sumOf(docLines.map(l => l.total)), withTax = sub.plus(sumOf(taxes.map(x => x.amount)));
    const ti = info(tcs.ledger) || {};
    const nature = tcsNatureOf(ti.tcsNature || ti.nature, isoDate(v.date), ctx.settings.tdsAct);
    const rate = cleanTdsRate(tcs.amount, withTax) || cleanTdsRate(tcs.amount, sub) || ti.rate || (nature?.rate ? new Decimal(nature.rate) : null);
    if (!nature || !rate) {
      toAdjust.push(...tcs.lines.map(l => ({ ...l, tcs: true })));
      flag('tcs_details_missing', `Tax collected at source on "${tcs.ledger}" (${tcs.amount.toFixed(2)}) cannot be written in Zoho's TCS columns: ${!nature ? `the nature of collection is not known from Tally's nature of goods ("${ti.tcsNature || ti.nature || 'none'}") for a document dated ${isoDate(v.date)}` : 'no rate fits the amount'}. It is written in the Adjustment column instead, moved back to the TCS ledger by the adjustment journal.`);
      tcs = null;
    } else {
      const pctText = rate.toString();
      tcs.map = { name: tcsTaxName(nature.section, pctText), percent: pctText, nature: nature.value, act: nature.act, section: nature.section };
      tcs.cells = bill
        ? { 'TCS Tax Name': tcs.map.name, 'TCS Percentage': pctText, 'Nature Of Collection': nature.value, 'TCS Amount': tcs.amount.toFixed(2) }
        : { 'TCS Tax Name': tcs.map.name, 'TCS Percentage': pctText, 'TCS Amount': tcs.amount.toFixed(2), 'Nature Of Collection': nature.value, 'TCS Payable Account': ctx.accountName(tcs.ledger) };
      flag('tcs_in_columns', `Tax collected at source on "${tcs.ledger}" is written in Zoho's TCS columns as "${tcs.map.name}", ${pctText}%, nature of collection ${nature.value} (${ACT_WORDS[nature.act]}), amount ${tcs.amount.toFixed(2)} (Tally's). Create this TCS tax in Zoho Books first (TCS taxes to create). ${bill ? 'Zoho posts the TCS of a bill to its own TCS Receivable account; the tax alignment journal moves it to the TCS ledger.' : 'The TCS Payable Account is the TCS ledger, so Zoho posts it there.'} Not proven by an import yet.`);
    }
  }
  const adjusted = [...roundOff, ...toAdjust];
  const adjAccountOf = file => String((file === 'invoices' ? ctx.settings.invoiceAdjustmentAccount : ctx.settings.billAdjustmentAccount) ?? '').trim();
  const adjustment = sumOf(adjusted.map(l => l.total));
  const adjustDescription = toAdjust.length
    ? [roundOff.length ? ROUND_OFF_DESCRIPTION : '', ...new Set(toAdjust.map(l => cleanText(canonical(l.ledger))))].filter(Boolean).join(', ').slice(0, 100) : ROUND_OFF_DESCRIPTION;
  const adjustmentCells = adjusted.length && !adjustment.isZero()
    ? (bill ? { 'Adjustment': adjustment.toFixed(2) } : { 'Adjustment': adjustment.toFixed(2), 'Adjustment Description': adjustDescription }) : {};
  const taxEntries = [], rcEntries = []; // what Zoho works the tax out on: { amount, comps: [{ key, rate }] }
  // ---- a party kept in another currency (its contact is written with that Currency Code) ----
  // Zoho Books takes an invoice or bill of such a contact in the contact's currency only. When every line of the voucher
  // carries Tally's foreign amount at one rate (and the document has no tax, TDS, adjustment or round-off, which Zoho
  // would work out in the currency), the rows are written in the currency: Currency Code, Exchange Rate = Tally's rate,
  // and each line at its foreign amount. Zoho converts the document total at the rate; Tally converts each line and
  // rounds it, so the rupee value can differ by a paisa or so (flagged forex_rounding_difference). Everything the tool
  // works out below (totals, the posting, the checks) stays in Tally's rupees.
  const contactCode = contact?.currency && contact.currency !== 'INR' ? contact.currency : '';
  let forex = null;
  if (contactCode) {
    const pf = party.forex;
    const sameRate = l => !!l.forex && !!pf && l.forex.symbol === pf.symbol && l.forex.rate.equals(pf.rate);
    const why = !pf ? `the ${bill ? 'vendor' : 'customer'} line has no foreign amount in Tally (only rupees)`
      : !docLines.length ? 'it has no line to write'
        : !docLines.every(sameRate) ? 'not every line carries a foreign amount at the rate of the voucher'
          : lineTax.size || rcmLines.size || gst.length || reverseCharge ? 'it carries GST, which Zoho works out in the currency'
            : tds || tdsLines.length ? 'it carries TDS' : adjusted.length || partySideTax.length ? 'it carries a round-off, an adjustment or tax on the side of the party' : '';
    if (why) {
      flag('forex_document_not_in_contact_currency', `"${party.ledger}" is kept in another currency (written with Currency Code ${contactCode}), but this ${docWord} cannot be written in ${contactCode}: ${why}. It is written in rupees at Tally's amounts. Zoho Books takes a ${docWord} of this ${bill ? 'vendor' : 'customer'} in ${contactCode} only, so it is expected to refuse it: enter it in Zoho Books by hand, or correct the voucher in Tally and export again.`);
    } else {
      const fxTotal = sumOf(docLines.map(l => l.forex.fx.times(sign)));
      forex = { code: contactCode, rate: pf.rate, fxTotal, zohoInr: fxTotal.times(pf.rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP) };
      const tallyInr = party.amount.abs();
      flag('forex_document_in_currency', `The ${bill ? 'vendor' : 'customer'} is kept in ${contactCode}, so this ${docWord} is written in ${contactCode} (${fxTotal.toFixed(2)}) at Tally's rate ${pf.rate} (Currency Code and Exchange Rate). Zoho Books converts it to ${forex.zohoInr.toFixed(2)} rupees.`);
      if (!forex.zohoInr.equals(tallyInr)) {
        flag('forex_rounding_difference', `A rounding difference of ${forex.zohoInr.minus(tallyInr).abs().toFixed(2)} between Tally and Zoho Books: Tally converts each line of this ${docWord} at ${pf.rate} and rounds each (${tallyInr.toFixed(2)} rupees), Zoho Books converts the total of ${fxTotal.toFixed(2)} ${contactCode} (${forex.zohoInr.toFixed(2)} rupees). The ${bill ? 'vendor' : 'customer'} and the ${bill ? 'expense' : 'income'} differ from Tally by that amount in Zoho Books. Accept it, or post it to the exchange gain or loss account after the import.`);
      }
    }
  }
  // the foreign amount of a line, and the price and quantity of it in the currency
  const forexCells = (l, qty) => {
    if (!forex) return null;
    const fxAmount = l.forex.fx.times(sign);
    const q = !qty.isZero() && fxAmount.div(qty).decimalPlaces() <= 2 ? qty : new Decimal(1);
    return { qty: q, price: fxAmount.div(q), cells: { 'Currency Code': forex.code, 'Exchange Rate': forex.rate.toString() } };
  };
  const rows = docLines.map(l => {
    const t = lineTax.get(l);
    const hasItem = !!l.item;
    let qty = new Decimal(1), price = l.total, unit = '';
    if (hasItem) {
      const q = quantityOf(l.qty), r = rateOfText(l.rate);
      if (q && !q.qty.isZero() && r && r2(q.qty.times(r)).equals(l.total.abs())) { qty = q.qty; price = r.times(l.total.isNegative() ? -1 : 1); unit = q.unit; }
      else if (q && !q.qty.isZero() && l.total.div(q.qty).decimalPlaces() <= 2) { qty = q.qty; price = l.total.div(q.qty); unit = q.unit;
        flag('item_line_rate_differs', `Stock item "${l.item}": Tally's quantity ${l.qty} times rate ${l.rate || '(none)'} is not the line amount ${l.total.abs().toFixed(2)}. The price written is the amount divided by the quantity.`); }
      else flag('item_line_rate_differs', `Stock item "${l.item}": the quantity and rate in Tally do not give the line amount ${l.total.abs().toFixed(2)}. The line is written as quantity 1 at the line amount.`);
    }
    const lineAmount = r2(qty.times(price));
    // Zoho takes the tax of a line from the line's rate and amount, each component of the tax on its own (CGST and SGST
    // of a tax group), and ignores Tally's Tax Amount (zohoTaxModel, below); Tally's own amount is still written in the
    // Tax Amount column of a bill
    lineSum = lineSum.plus(lineAmount);
    if (t) { taxEntries.push({ amount: lineAmount, comps: taxComponents(t) }); tallyTaxSum = tallyTaxSum.plus(t.amount); taxedLines++; }
    zohoTotal = zohoTotal.plus(lineAmount);
    posted.push(lineAmount.times(sign));
    // reverse charge: Zoho works the tax out from the rate and posts it on both sides (input credit and tax payable);
    // it is not part of the bill total
    const rc = rcmLines.get(l);
    if (rc) rcEntries.push({ amount: lineAmount, comps: taxComponents(rc).map((c, i) => ({ ...c, head: rc.type === 'Tax Group' ? ['CGST', 'SGST'][i] || 'SGST' : rc.heads?.[0] || 'IGST' })) });
    const rcCells = rc ? { 'Reverse Charge Tax Name': rc.name, 'Reverse Charge Tax Rate': pct(rc.rate), 'Reverse Charge Tax Type': rc.type } : {};
    const account = ctx.accountName(l.ledger);
    // HSN/SAC (v2 default 11): the corrections of the migration, then Zoho's rule; a value not written is flagged
    // The HSN/SAC field is on in a new Zoho organisation, which then refuses a line with no code or one shorter than 6
    // digits: Tally's value, else the code chosen for the item or account, else a suggestion from the words (flagged)
    const lineItem = hasItem ? l.item : bill || l.notIncome ? '' : ctx.serviceItemFor ? ctx.serviceItemFor(account) : '';
    // a line on a ledger with no HSN/SAC of its own on the voucher takes the HSN/SAC of the ledger master (Tally's "HSN/SAC
    // details" of a sales or purchase ledger, which Tally itself applies to the voucher): Tally's value, not a suggestion
    const raw = l.hsn || (!hasItem && ctx.ledgerHsn ? ctx.ledgerHsn(l.ledger) : '') || '';
    const h = resolveHsn({ raw, account, item: lineItem }, { enabled: ctx.hsn?.enabled !== false, minDigits: ctx.hsn?.minDigits || 4, corrections: ctx.hsnCorrections, defaults: ctx.hsnDefaults, sacTable: bill || !ctx.hsn ? null : undefined, headingOnly: hasItem });
    const hsn = h.value;
    // the service item of the line's account carries the code its lines are written with (Tally's heading included)
    if (!bill && !hasItem && lineItem && hsn) ctx.serviceItemHsn?.(account, hsn);
    if (!bill && !hasItem && lineItem) ctx.serviceItemSupply?.(account, l.typeOfSupply || (ctx.ledgerTypeOfSupply ? ctx.ledgerTypeOfSupply(l.ledger) : ''));
    if (h.source === 'off') { /* the field is off in Zoho Books: written empty, nothing to say */ }
    else {
      // a heading shorter than Zoho takes, written as a code under it (or a suggestion outside it): said once, below
      if (h.status === 'not_written' && h.source !== 'heading' && !(h.source === 'suggested' && h.outsideHeading)) hsnNotWritten.set(h.from, (hsnNotWritten.get(h.from) || 0) + 1);
      else if (h.status === 'corrected') hsnCorrected.set(h.from, (hsnCorrected.get(h.from) || 0) + 1);
      const key = lineItem || account;
      const bump = (map, extra) => { const e = map.get(key) || { n: 0, ...extra }; e.n++; map.set(key, e); };
      if (h.source === 'heading') bump(hsnHeading, { code: h.value, label: h.suggestion.label, from: h.from, ambiguous: h.suggestion.ambiguous || null });
      else if (h.source === 'suggested') bump(hsnSuggested, { code: h.value, label: h.suggestion.label, from: h.status === 'not_written' ? h.from : '', outside: !!h.outsideHeading, ambiguous: h.suggestion.ambiguous || null });
      else if (h.source === 'chosen_item' || h.source === 'chosen_account') bump(hsnChosen, { code: h.value });
      else if (h.source === 'missing' && !bill && ctx.hsn?.enabled === true && h.status !== 'corrected') bump(hsnMissing, {});
    }
    // a bill line of a registered vendor with no tax written: the setting's cells, or nothing (blocking flag)
    let noTaxCells = {};
    if (bill && !t && !rc && needsTax) {
      const usable = !gstNotWritten && !att.perLine.has(l) && noTax.kind !== 'bill_line_needs_tax_or_exemption';
      if (usable) { noTaxCells = noTax.cells; withoutTax.written++; } else withoutTax.blocked++;
    }
    if (!bill) {
      // Item Name (Zoho: mandatory on every invoice line): the stock item, else the service item of the line's account.
      // No service item is made on an account that is not an income account (such a line is flagged above).
      const itemName = hasItem ? l.item : l.notIncome ? '' : ctx.serviceItemFor ? ctx.serviceItemFor(account) : '';
      // the zero-rate tax only on a positive income line: never on a negative line (it would understate the taxable
      // value as a negative nil-rated supply) and never on a line that is not income
      const zero = !t && invoiceNoTax && !gstNotWritten && !att.perLine.has(l) && l.total.greaterThan(0) && !l.notIncome ? invoiceNoTax : null;
      if (zero) invoiceZeroLines++;
      else if (!t && companyGst?.status === 'regular' && !overseas && !invoiceNoTax && place && !companyState && !gstNotWritten && l.total.greaterThan(0) && !l.notIncome) invoiceNoTaxState++;
      const fxc = forexCells(l, qty);
      return {
        'Invoice Number': number, 'Invoice Date': isoDate(v.date), 'Invoice Status': draft ? 'draft' : 'open', 'Customer Name': docName,
        'GST Treatment': contact?.treatment || '', 'GST Identification Number (GSTIN)': contact?.gstin || '', 'Place of Supply': overseas ? '' : place,
        'TDS Name': tds?.map.tdsName || '', 'TDS Percentage': tds?.map.percent || '', 'TDS Section Code': tds?.map.section || '', 'TDS Amount': tds ? tds.amount.toFixed(2) : '',
        'Currency Code': 'INR', 'Account': account, 'Item Name': itemName, 'Item Desc': hasItem ? '' : account, 'HSN/SAC': hsn,
        'Quantity': qty.toString(), 'Usage unit': unit, 'Item Price': money2(price), 'Is Inclusive Tax': 'false',
        'Item Tax': t ? t.name : '', 'Item Tax Type': t ? t.type : '', 'Item Tax %': t ? pct(t.rate) : '', ...(zero || {}), 'Notes': narration,
        ...adjustmentCells, ...(tcs?.cells || {}),
        ...(fxc ? { ...fxc.cells, 'Quantity': fxc.qty.toString(), 'Item Price': money2(fxc.price) } : {}),
      };
    }
    const fxc = forexCells(l, qty);
    return {
      'Bill Date': isoDate(v.date), 'Bill Number': number, 'Bill Status': draft ? 'draft' : 'open', 'Source of Supply': source, 'Destination of Supply': destination,
      'GST Treatment': treatmentOut, 'GST Identification Number (GSTIN)': gstinOut, 'Is Inclusive Tax': 'FALSE',
      'TDS Percentage': tds?.map.percent || '', 'TDS Amount': tds ? tds.amount.toFixed(2) : '', 'TDS Section Code': tds?.map.section || '', 'TDS Name': tds?.map.tdsName || '',
      'Vendor Name': docName, 'Currency Code': 'INR', 'Item Name': hasItem ? l.item : '', 'Item Description': hasItem ? '' : account, 'Account': account,
      'Usage unit': unit, 'Quantity': qty.toString(), 'Rate': money2(price),
      'Tax Name': t ? t.name : '', 'Tax Percentage': t ? pct(t.rate) : '', 'Tax Amount': t ? t.amount.toFixed(2) : '', 'Tax Type': t ? t.type : '',
      'Vendor Notes': narration, 'HSN/SAC': hsn,
      ...noTaxCells, ...rcCells, ...adjustmentCells, ...(tcs?.cells || {}),
      ...(fxc ? { ...fxc.cells, 'Quantity': fxc.qty.toString(), 'Rate': money2(fxc.price) } : {}),
    };
  });
  if (invoiceNoTaxState) {
    flag('invoice_line_tax_state_unknown', `${plural(invoiceNoTaxState, 'line')} of this invoice ${invoiceNoTaxState === 1 ? 'carries' : 'carry'} no GST in Tally, and the company's own GST state is not known (not on the voucher, no GSTIN on the migration and none on Tally's other vouchers), so GST0 cannot be told from IGST0 and the line is written without a tax. `
      + 'Zoho asks for a tax, an exemption or a non-GST supply type on every invoice line of a GST-registered organisation, so it is expected to refuse the invoice. Enter the company GSTIN on the migration and create the files again.');
  }
  if (invoiceZeroLines) {
    flag('invoice_line_zero_tax', `${plural(invoiceZeroLines, 'line')} of this invoice ${invoiceZeroLines === 1 ? 'carries' : 'carry'} no GST in Tally. Zoho asks for a tax, an exemption or a non-GST supply type on every invoice line, so Zoho's zero-rate tax ${invoiceNoTax['Item Tax']} is written (${overseas ? 'an export: the customer is overseas' : sez ? 'the customer is an SEZ unit, and a supply to an SEZ is between states' : companyState === place ? `the company's state and the place of supply are both ${place}` : `the company's state is ${companyState} and the place of supply ${place}`}). `
      + 'This is the tool\'s default and is not confirmed until the next test import. If the sale is exempt or outside GST, correct it in Zoho Books.');
  }
  // (the service items are said once, for the Items file: index.js, kind service_item_for_account)
  if (roundOff.length) {
    const ro = sumOf(roundOff.map(l => l.total));
    flag('round_off_adjustment', `The round-off on ${quoteList([...new Set(roundOff.map(l => canonical(l.ledger)))])} (${ro.toFixed(2)}) is written in the Adjustment column of this ${docWord}${bill ? '' : ' with the description "Round Off"'}, not as a line. ${adjAccountOf(bill ? 'bills' : 'invoices') ? `Zoho Books posts it to "${adjAccountOf(bill ? 'bills' : 'invoices')}"; the adjustment journal generated in the Manual Journals file moves it back to the round-off ledger. ` : ''}Check that Adjustments is ticked in Zoho Books (Settings > Setup & Configurations > General; it is ticked by default in a new organisation) before the import.`);
  }
  // TCS in the Adjustment column has a flag of its own (tcs_to_adjustment), and on a bill too
  const notIncomeAdjusted = toAdjust.filter(l => !l.tcs && !l.tdsAdjust);
  if (notIncomeAdjusted.length) {
    const amt = sumOf(notIncomeAdjusted.map(l => l.total));
    const names = [...new Set(notIncomeAdjusted.map(l => canonical(l.ledger)))];
    flag('invoice_line_to_adjustment', `${quoteList(names)} ${names.length === 1 ? 'is' : 'are'} on this invoice (${amt.toFixed(2)} in all) but ${names.length === 1 ? 'is not an income account' : 'are not income accounts'} (${[...new Set(names.map(n => KIND_WORDS[info(n) ? 'tax' : ctx.kindOf?.(n)] || 'another account'))].join(', ')}). `
      + 'Zoho Books needs an income account and an item on every invoice line, and such a line would be a service item on that account carrying a zero-rate GST (a wrong nil-rated line in GSTR-1). '
      + `It is written in the Adjustment column instead ("${adjustDescription}"), so the invoice total equals the amount the customer owes in Tally and the taxable value is not changed. Zoho Books posts the Adjustment to its own account, not to ${names.length === 1 ? 'this ledger' : 'these ledgers'}: `
      + (adjAccountOf('invoices') ? `the adjustment journal generated in the Manual Journals file moves it from "${adjAccountOf('invoices')}" to ${names.length === 1 ? 'the ledger' : 'the ledgers'}, so no journal has to be typed. ` : 'no account is set for the Adjustment of invoices in Mapping Studio (Voucher files), so no adjustment journal is generated: set it to have the ledger balances of Tally. ')
      + 'Check that Adjustments is ticked in Zoho Books (Settings > Setup & Configurations > General; it is ticked by default in a new organisation) before the import. This is the tool\'s default.');
  }
  for (const [from, n] of hsnNotWritten) flag('hsn_not_written', `The HSN/SAC value "${from}" on ${plural(n, 'line')} of this ${bill ? 'bill' : 'invoice'} is not a code Zoho Books accepts (${ctx.hsn?.minDigits >= 6 ? 'at least 6 digits, ' : ''}4, 6 or 8 digits), so it is not written as it is. A code chosen or suggested for the line is written instead; with none the cell is empty. Add a correction for this value in Mapping Studio (HSN/SAC) to write the right code.`);
  const minWords = `${ctx.hsn?.minDigits >= 6 ? 6 : 4} digits`;
  const alsoFits = e => (e.ambiguous?.length ? ` The words of the name fit ${e.ambiguous.map(x => `${x.code} (${x.label})`).join(', ')} equally well.` : '');
  for (const [name, e] of hsnHeading) flag('hsn_from_heading', `Tally has the HSN/SAC heading "${e.from}" on ${plural(e.n, 'line')} of this ${bill ? 'bill' : 'invoice'} on "${cleanLabel(name)}". Zoho Books needs at least ${minWords}, so ${e.code} (${e.label}), a code under that heading that fits the words of the name, is written.${alsoFits(e)} Confirm it or choose another code under the heading in Mapping Studio (HSN/SAC).`);
  for (const [name, e] of hsnSuggested) {
    if (e.from) flag('hsn_outside_heading', `Tally has the HSN/SAC value "${e.from}" on ${plural(e.n, 'line')} of this ${bill ? 'bill' : 'invoice'} on "${cleanLabel(name)}", shorter than the ${minWords} Zoho Books needs, and no suggested code lies under it. ${e.code} (${e.label}) is written, suggested from the words of the name although it is under another heading.${alsoFits(e)} Choose the right code under "${e.from}" in Mapping Studio (HSN/SAC).`);
    else flag('hsn_suggested', `${plural(e.n, 'line')} of this ${bill ? 'bill' : 'invoice'} on "${cleanLabel(name)}" ${e.n === 1 ? 'has' : 'have'} no HSN/SAC in Tally. The HSN/SAC field is on in Zoho Books and refuses a line without a code of at least 6 digits, so ${e.code} (${e.label}) is written. It is only a suggestion from the words of the name: confirm it or choose the right code in Mapping Studio (HSN/SAC).${alsoFits(e)}`);
    if (e.ambiguous?.length) flag('hsn_suggestion_ambiguous', `For "${cleanLabel(name)}" the words of the name fit ${[{ code: e.code, label: e.label }, ...e.ambiguous].map(x => `${x.code} (${x.label})`).join(' and ')} equally well; ${e.code} is written. Choose the right code in Mapping Studio (HSN/SAC).`);
  }
  for (const [name, e] of hsnChosen) flag('hsn_default_used', `${plural(e.n, 'line')} of this ${bill ? 'bill' : 'invoice'} on "${cleanLabel(name)}" ${e.n === 1 ? 'has' : 'have'} no HSN/SAC in Tally. The code ${e.code} chosen in Mapping Studio (HSN/SAC) is written.`);
  for (const [name, e] of hsnMissing) flag('hsn_missing_required', `${plural(e.n, 'line')} of this ${bill ? 'bill' : 'invoice'} on "${cleanLabel(name)}" ${e.n === 1 ? 'has' : 'have'} no HSN/SAC, and no code is chosen or suggested. The HSN/SAC field is on in Zoho Books, which refuses such a line ("Please ensure that the length of the HSN code is a minimum of 6 digits and it has only numbers."). Choose a code for it in Mapping Studio (HSN/SAC), or switch the field off in Zoho Books (Settings, Setup and Configurations, Items) and answer "No" in the Import Wizard.`);
  for (const [from, n] of hsnCorrected) flag('hsn_corrected', `The HSN/SAC value "${from}" on ${plural(n, 'line')} of this ${bill ? 'bill' : 'invoice'} is written as corrected in Mapping Studio (HSN/SAC corrections).`);
  if (withoutTax.written) {
    const n = withoutTax.written, are = n === 1 ? 'carries' : 'carry';
    const lead = `${plural(n, 'line')} of this bill ${are} no GST in Tally, and the vendor is written as registered (${contact.treatment}), so Zoho Books asks for a tax, a tax exemption or reverse charge on ${n === 1 ? 'it' : 'them'}. `;
    flag(noTax.kind, lead + (noTax.kind === 'bill_line_zero_tax'
      ? `By default Zoho's zero-rate tax is written: ${noTax.cells['Tax Name']} with Tax Type "${noTax.cells['Tax Type']}" and Tax Percentage 0 (${source === destination ? `the vendor's state and the company's state are both ${source}` : `the vendor's state is ${source} and the company's is ${destination}`}). `
        + 'Not confirmed until the next test import. If these purchases are exempt or under reverse charge, change "bill lines without GST" in Mapping Studio (Voucher files).'
      : noTax.kind === 'bill_line_exemption'
        ? `The tax exemption chosen for this migration ("${noTax.cells['Item Exemption Code']}") is written in Item Exemption Code. It must exist in Zoho Books (Settings > Taxes > Tax Exemptions). Not confirmed until the next test import.`
        : `The reverse charge tax chosen for this migration ("${noTax.cells['Reverse Charge Tax Name']}", ${noTax.cells['Reverse Charge Tax Rate']}%) is written in the Reverse Charge columns. Not confirmed until the next test import.`));
  }
  if (withoutTax.blocked) {
    const n = withoutTax.blocked;
    flag('bill_line_needs_tax_or_exemption', `${plural(n, 'line')} of this bill ${n === 1 ? 'has' : 'have'} no tax written, and the vendor is written as registered (${contact.treatment}). Zoho Books refuses such a line: "Specify either a Tax or Tax Exemption or Reverse Charge." `
      + (reverseCharge ? 'The bill has the shape of tax under reverse charge: enter the reverse charge tax on it (see the other flag on this voucher).'
        : gstNotWritten || docLines.some(l => att.perLine.has(l) && !lineTax.has(l)) ? 'The bill has GST in Tally that could not be put on its lines (see the other flags on this voucher, or "not mapped to a Zoho tax"): map the tax ledgers in Mapping Studio (Tax mapping), or enter the tax on the bill in Zoho Books.'
          : `Nothing could be written by default: ${noTax.why || 'the setting for bill lines without GST is not complete'}. Complete it in Mapping Studio (Voucher files, or Fix contacts for a missing state).`));
  }
  // ---- what Zoho Books works out itself (defaults: recomputeDiffPolicy) ----
  // Zoho takes the tax of each line from the line's rate and amount, each component of a tax group (CGST, SGST) rounded
  // on its own (setting zohoTaxRounding: per line, the default, or per document), and ignores Tally's tax amounts. It
  // takes TDS as written in TDS Amount (Tally's amount): a Zoho test import showed tds_total equal to the file's TDS
  // Amount on every bill, so TDS never makes a difference. The difference to Tally is found here to the paisa. A rounding
  // difference of the tax (up to one rupee per taxed line) is written in the Adjustment column so the total equals
  // Tally's; a larger one is flagged for a person to accept or to correct in Tally.
  const roundMode = ctx.settings.zohoTaxRounding === 'entity' ? 'entity' : 'line';
  const zt = zohoTaxModel(taxEntries, roundMode), zrc = zohoTaxModel(rcEntries, roundMode);
  zohoTaxSum = zt.total;
  zohoTotal = zohoTotal.plus(zohoTaxSum);
  posted.push(zohoTaxSum.times(sign));
  if (!zrc.total.isZero()) posted.push(zrc.total.times(sign), zrc.total.times(-sign));
  const tdsBaseLabel = `${docWord}'s ${ctx.settings.tdsBase === 'total' ? 'total including tax' : 'sub total'}`;
  const tdsBaseZ = ctx.settings.tdsBase === 'total' ? lineSum.plus(zohoTaxSum) : lineSum;
  const zohoTds = tds ? tds.amount : ZERO;
  const partyAmount = party.amount.abs();
  const taxLeftOff = !!att.problem || [...att.perLine.keys()].some(l => !lineTax.has(l));
  zohoTotal = zohoTotal.minus(zohoTds);
  if (tcs) zohoTotal = zohoTotal.plus(tcs.amount); // TCS adds to what the party owes (or is owed)
  if (!adjustment.isZero()) zohoTotal = zohoTotal.plus(adjustment);
  const taxDiff = zohoTaxSum.minus(tallyTaxSum); // Zoho minus Tally
  const totalDiff = zohoTotal.minus(partyAmount);
  const recompute = { zohoTax: zohoTaxSum, tallyTax: tallyTaxSum, zohoTds, tallyTds: tds ? tds.amount : ZERO, difference: totalDiff, adjusted: ZERO, explained: false };
  let adjTotal = adjustment, recomputeFlagged = false;
  const explained = !totalDiff.isZero() && !taxLeftOff && !gstNotWritten && totalDiff.equals(taxDiff);
  const limit = RECOMPUTE_ADJUST_LIMIT.times(Math.max(1, taxedLines));
  const adjustIt = explained && ctx.settings.recomputeDiffPolicy !== 'flag' && totalDiff.abs().lessThanOrEqualTo(limit);
  // the TDS percentage is only a check: Tally's amount is written and Zoho keeps it. More than a rupee away from the
  // percentage of the base means the percentage (or the base) may be wrong in Zoho's TDS reports.
  let tdsDiffers = null; // the percentage's TDS minus Tally's, when more than a rupee apart (the Zoho check, TDS-005)
  if (tds && tds.map.percent) {
    const byPercent = r2(tdsBaseZ.times(tds.map.percent).div(100));
    if (byPercent.minus(tds.amount).abs().greaterThan(1)) {
      tdsDiffers = byPercent.minus(tds.amount).toFixed(2);
      flag('tds_amount_differs', `TDS at ${tds.map.percent}% of the ${tdsBaseLabel} ${tdsBaseZ.toFixed(2)} would be ${byPercent.toFixed(2)}, but Tally deducted ${tds.amount.toFixed(2)} on "${tds.ledger}". Tally's amount is written in TDS Amount and Zoho Books keeps it, so the ${docWord} total is Tally's; only the TDS percentage may be wrong in Zoho's TDS reports. Check the rate in Mapping Studio (TDS mapping).`);
    }
  }
  if (explained) {
    recompute.explained = true;
    const parts = `the tax Zoho works out from the rates (each part of the tax rounded on its own) is ${zohoTaxSum.toFixed(2)}, but Tally's tax is ${tallyTaxSum.toFixed(2)} (${taxDiff.isNegative() ? '' : '+'}${taxDiff.toFixed(2)})`;
    if (adjustIt) {
      recompute.adjusted = totalDiff.negated();
      flag('zoho_recompute_adjusted', `Zoho Books works the tax out from the rate and ignores Tally's tax amounts: ${parts}. The difference of ${totalDiff.abs().toFixed(2)} is written in the Adjustment column (${recompute.adjusted.toFixed(2)}), so the ${docWord} total equals Tally's ${partyAmount.toFixed(2)}. Zoho posts the Adjustment to its own account; the generated adjustment journal moves it to the tax account. This is the tool's default; to leave it as Zoho works it out, change "rounding differences" in Mapping Studio (Voucher files).`);
    } else {
      recomputeFlagged = true;
      flag('zoho_recompute_differs', `Zoho Books works the tax out from the rate and ignores Tally's tax amounts: ${parts}. The ${docWord} will come to ${zohoTotal.toFixed(2)} in Zoho Books, but Tally's ${bill ? 'vendor' : 'customer'} amount is ${partyAmount.toFixed(2)} (a difference of ${totalDiff.toFixed(2)}${ctx.settings.recomputeDiffPolicy === 'flag' ? '' : ', more than rounding'}). `
        + "Two ways out: accept Zoho's figure (the balance in Zoho Books then differs from Tally for this document), or correct the rate or the amount in Tally and export again. Nothing was changed.");
    }
  }
  if (!recompute.adjusted.isZero()) {
    zohoTotal = zohoTotal.plus(recompute.adjusted); adjTotal = adjustment.plus(recompute.adjusted);
    const cells = bill ? { 'Adjustment': adjTotal.toFixed(2) }
      : { 'Adjustment': adjTotal.toFixed(2), 'Adjustment Description': [adjustment.isZero() ? '' : adjustDescription, 'Tax rounding'].filter(Boolean).join(', ').slice(0, 100) };
    for (const row of rows) Object.assign(row, cells);
  }
  // Where each part of the Adjustment belongs in Tally (the generated adjustment journal moves it there from Zoho's own
  // adjustment account): a round-off or a non-income invoice line to its own ledger; a tax rounding part to the tax
  // ledger(s) whose amount Zoho worked out differently. amount: in the document's sign (positive adds to the total).
  const adjustParts = [];
  for (const l of adjusted) if (!l.total.isZero()) adjustParts.push({ ledger: canonical(l.ledger), amount: l.total, why: roundOff.includes(l) ? 'round_off' : l.tcs ? 'tcs' : 'not_income' });
  if (!recompute.adjusted.isZero()) {
    const parts = taxes.map(t => ({ ledger: t.ledger, amount: (zt.byLedger.get(t.ledger) || ZERO).minus(t.amount).negated() })).filter(x => !x.amount.isZero());
    const covered = sumOf(parts.map(x => x.amount));
    if (taxes.length && covered.equals(recompute.adjusted)) for (const x of parts) adjustParts.push({ ...x, why: 'tax_rounding' });
    else if (taxes.length) adjustParts.push({ ledger: taxes[0].ledger, amount: recompute.adjusted, why: 'tax_rounding' });
  }
  // the adjustment is posted on the side opposite the party (like a line), the TDS on the party's side: credited on a
  // bill (TDS payable), debited on an invoice (TDS receivable)
  if (!adjTotal.isZero()) posted.push(adjTotal.times(sign));
  if (tds) posted.push(zohoTds.times(-sign));
  if (tcs) posted.push(tcs.amount.times(sign));
  posted.push(zohoTotal.times(-sign));
  // how each Tally line is represented in the file, in the order of voucherLines (voucher reconciliation)
  const roles = lines.map(() => 'not_written_zero');
  roles[lines.indexOf(party)] = 'party';
  for (const l of docLines) roles[l.idx] = l.total.isNegative() ? 'negative_row' : 'row';
  if (tds) for (const l of tdsLines) roles[l.idx] = 'tds_column';
  if (tcs) for (const l of tcs.lines) roles[l.idx] = 'tcs_column';
  for (const l of adjusted) roles[l.idx] = 'adjustment_column';
  const taxWritten = new Set([...lineTax.values()].flatMap(t => t.ledgers.map(canonical)));
  for (const l of gst) roles[l.idx] = taxWritten.has(canonical(l.ledger)) ? 'tax_column' : 'tax_not_written';
  for (const l of reverseCharge?.lines || []) roles[l.idx] = rcmWritten ? 'reverse_charge_column' : 'reverse_charge_not_written';
  if (!zohoTotal.equals(partyAmount) && !recomputeFlagged) {
    flag('document_total_differs', `The ${bill ? 'bill' : 'invoice'} as written comes to ${zohoTotal.toFixed(2)} in Zoho Books (${bill ? 'lines plus tax amounts' : 'lines plus the tax Zoho works out from each rate'}${tds ? ' less TDS' : ''}), but Tally's ${bill ? 'vendor' : 'customer'} amount is ${partyAmount.toFixed(2)} (a difference of ${zohoTotal.minus(partyAmount).toFixed(2)}). `
      + `The ${bill ? 'vendor' : 'customer'} balance in Zoho Books would not tie to Tally for this document. ${taxLeftOff ? 'Tax that could not be put on its line explains it (see the other flags on this voucher, or "not mapped to a Zoho tax").' : 'The difference comes from the tax Zoho works out line by line (rounding).'}`);
  }
  // Where Zoho Books posts the TDS and the reverse charge of this document, against the Tally ledgers that carried them
  // (taxposting.js): the TDS ledger and amount; the ledgers a reverse charge bill debits and credits with Tally's
  // amounts, and what Zoho works out for each tax head written.
  // head (output side): Tally's duty head of the ledger (CGST, SGST, IGST), so the evidence says which one Zoho head
  // each reverse charge payable ledger carries (a CGST+SGST bill credits one ledger per head)
  const byLedgerSum = (list, withHead) => { const m = new Map(); for (const l of list) m.set(canonical(l.ledger), (m.get(canonical(l.ledger)) || ZERO).plus(l.total.abs())); return [...m].map(([ledger, amount]) => ({ ledger, amount, ...(withHead && info(ledger)?.head ? { head: info(ledger).head } : {}) })); };
  const taxPosting = tds || tcs || rcmWritten || taxes.length ? {
    tds: tds ? { ledger: tds.ledger, amount: tds.amount } : null,
    // TCS in Zoho's columns: an invoice posts it on the TCS Payable Account written (the TCS ledger), a bill on Zoho's
    // TCS Receivable (zohorules.json lists.posting_rules invoice_tcs, assumed)
    ...(tcs ? { tcs: { ledger: tcs.ledger, amount: tcs.amount, zoho: bill ? TCS_RECEIVABLE : ctx.accountName(tcs.ledger) } } : {}),
    rcm: rcmWritten ? { input: byLedgerSum(reverseCharge.debitedLines), output: byLedgerSum(reverseCharge.lines.filter(l => !reverseCharge.debitedLines.includes(l)), true),
      zoho: Object.fromEntries(zohoTaxByHead(rcEntries, roundMode)), importOfServices: rcmImportOfServices } : null,
    taxLedgers: taxes.map(t => t.ledger),
  } : null;
  const warning = parties.has(party.ledger) ? null : `"${party.ledger}" is not in the uploaded ${bill ? 'vendor' : 'customer'} master. Import will fail unless it exists in Zoho.`;
  return { rows, warning, negatives, flags, tdsDiffers, number, voucherNumber, numberFromReference: !!reference, docName, zohoTotal, partyAmount, partyLedger: party.ledger, roles, posting: postingOf(posted), recompute, adjustParts, taxPosting,
    date: isoDate(v.date),
    // tax ledgers on the party's side written as a negative line (bills only: on an invoice they go to Adjustment)
    tax: taxes.map(t => ({ ledger: t.ledger, zohoTax: taxOf(t.ledger) })), partySideTax: bill ? [...new Set(partySideTax.map(l => canonical(l.ledger)))] : [], tdsUnmapped,
    tdsUsed: tds ? { ledger: tds.ledger, zohoTds: tds.map.tdsName, byDefault: !!tds.byDefault, section: tds.map.section, percent: tds.map.percent, act: tds.res?.act, create: !!tds.res?.create } : null,
    tcsUsed: tcs ? { ledger: tcs.ledger, name: tcs.map.name, percent: tcs.map.percent, nature: tcs.map.nature, section: tcs.map.section, act: tcs.map.act } : null };
}

// ---------- the tax alignment journals ----------
// Zoho Books posts the TDS of a bill to TDS Payable, of an invoice to TDS Receivable, and the reverse charge of a bill to
// Reverse Charge Tax Input but not due and to the Output account of each head written (taxposting.js). When the Tally
// ledger that carried the amount is entered on that same Zoho account, nothing is needed. When it is not (the ledger is
// kept as an account of its own, one ledger is used for two things, the reverse charge was written with another head
// than Tally's, or Zoho works the reverse charge out a paisa away from Tally), one generated journal per month moves
// the difference, so every account ends at Tally's figure:
//   bill TDS:       Dr TDS Payable            Cr the Tally TDS ledger
//   invoice TDS:    Dr the Tally TDS ledger   Cr TDS Receivable
//   reverse charge: Dr the Tally input ledger (Tally's amount)  Cr Reverse Charge Tax Input but not due (Zoho's amount)
//                   Dr Output <head> (Zoho's amount)            Cr the Tally output ledger (Tally's amount)
// postings: [{ file, date, number, taxPosting }]. Returns { rows, journals } like adjustmentJournalRows.
export function taxAlignmentJournalRows(postings, ctx, taken = new Set()) {
  const settings = { ...VOUCHER_SETTING_DEFAULTS, ...(ctx.settings || {}) };
  const accountName = ctx.accountName || (x => x);
  const A = ctx.taxPostingAccounts || ZOHO_TAX_POSTING_ACCOUNTS;
  const outputOf = head => A.output[head] || `Output ${head}`;
  const months = new Map();
  for (const p of postings) {
    if (!p.date || !p.taxPosting) continue;
    const m = p.date.slice(0, 7);
    if (!months.has(m)) months.set(m, { date: p.date, net: new Map(), names: new Map(), documents: new Set(), tds: false, rcm: false });
    const g = months.get(m);
    if (p.date > g.date) g.date = p.date;
    // net: account (compared as Zoho compares names) -> amount in Tally's sign (a debit negative)
    const post = (account, amount) => { const k = accountNameKey(account); if (!g.names.has(k)) g.names.set(k, account); g.net.set(k, (g.net.get(k) || ZERO).plus(amount)); };
    const sameAccount = (a, b) => accountNameKey(a) === accountNameKey(b);
    const { tds, rcm, tcs } = p.taxPosting;
    let touched = false;
    if (tcs) {
      // undo what Zoho posted (a debit on a bill, a credit on an invoice) on its account, post it on the Tally TCS ledger
      const s = p.file === 'bills' ? 1 : -1;
      post(tcs.zoho, tcs.amount.times(s)); post(accountName(tcs.ledger), tcs.amount.times(-s));
      if (!sameAccount(tcs.zoho, accountName(tcs.ledger))) { touched = true; g.tcs = true; }
    }
    if (tds) {
      const zoho = p.file === 'bills' ? A.tdsPayable : A.tdsReceivable, s = p.file === 'bills' ? -1 : 1;
      // undo what Zoho posted on its account (a credit on a bill, a debit on an invoice), post it on the Tally ledger
      post(zoho, tds.amount.times(s)); post(accountName(tds.ledger), tds.amount.times(-s));
      if (!sameAccount(zoho, accountName(tds.ledger))) { touched = true; g.tds = true; }
    }
    if (rcm) {
      const heads = Object.keys(rcm.zoho);
      const zohoTotal = sumOf(Object.values(rcm.zoho));
      post(A.rcmInput, zohoTotal);
      for (const x of rcm.input) post(accountName(x.ledger), x.amount.negated());
      for (const h of heads) post(outputOf(h), rcm.zoho[h].negated());
      for (const x of rcm.output) post(accountName(x.ledger), x.amount);
      // aligned: every ledger is on the Zoho account Zoho posts to, with Zoho's amount (per head: a payable ledger of its
      // own Tally duty head, or of the bill's one head)
      const headOf = x => (x.head && heads.includes(x.head) ? x.head : heads.length === 1 ? heads[0] : null);
      const aligned = rcm.input.every(x => sameAccount(accountName(x.ledger), A.rcmInput)) && rcm.output.every(x => headOf(x) && sameAccount(accountName(x.ledger), outputOf(headOf(x))))
        && heads.every(h => rcm.zoho[h].equals(sumOf(rcm.output.filter(x => headOf(x) === h).map(x => x.amount))))
        && zohoTotal.equals(sumOf(rcm.input.map(x => x.amount))) && zohoTotal.equals(sumOf(rcm.output.map(x => x.amount)));
      if (!aligned) { touched = true; g.rcm = true; }
    }
    if (touched) g.documents.add(`${p.file}|${p.number}`);
  }
  const rows = [], journals = [];
  const draft = settings.documentStatus === 'draft';
  for (const [m, g] of [...months].sort(([a], [b]) => a.localeCompare(b))) {
    const lines = [...g.net].filter(([, x]) => !x.isZero()).map(([k, x]) => [g.names.get(k), x]);
    if (!lines.length) continue;
    let number = `TAX-${m.replace('-', '')}`;
    for (let i = 2; taken.has(number); i++) number = `TAX${i}-${m.replace('-', '')}`;
    taken.add(number);
    const parts = journalNumberParts(number);
    const what = [g.tds ? 'tax deducted at source' : '', g.tcs ? 'tax collected at source' : '', g.rcm ? 'reverse charge' : ''].filter(Boolean).join(' and ') || 'tax';
    const notes = `Tax alignment of ${plural(g.documents.size, 'document')} (bills or invoices) dated ${m}: Zoho Books posts their ${what} to its own tax accounts; this journal moves the difference to the accounts Tally used, so every account ends at Tally's figure. Generated by the migration tool.`;
    for (const [account, x] of lines) {
      rows.push({ 'Journal Date': g.date, 'Reference Number': number, 'Journal Number Prefix': parts?.prefix ?? '', 'Journal Number Suffix': parts?.suffix ?? '', 'Notes': notes,
        'Journal Type': 'both', 'Currency': 'INR', 'Account': account, 'Contact Name': '',
        'Debit': x.isNegative() ? x.abs().toFixed(2) : '', 'Credit': x.isNegative() ? '' : x.toFixed(2), 'Status': draft ? 'draft' : 'published' });
    }
    journals.push({ number, date: g.date, documents: g.documents.size, lines: lines.length, amount: sumOf(lines.map(([, x]) => x).filter(x => x.greaterThan(0))).toFixed(2),
      tds: g.tds, reverseCharge: g.rcm, accounts: lines.map(([account, x]) => ({ account, debit: x.isNegative() ? x.abs().toFixed(2) : '', credit: x.isNegative() ? '' : x.toFixed(2) })) });
  }
  return { rows, journals };
}

// ---------- one Manual Journal ----------
const ACCOUNTS_RECEIVABLE = 'Accounts Receivable', ACCOUNTS_PAYABLE = 'Accounts Payable';
// code: for a Receipt, Payment, Contra or Debit/Credit Note written as a journal, the code of its voucher type (RCT-,
// PMT-...), put before the Tally number in Reference Number and the journal number; typeWord: its name for the Notes.
function journalDocument(v, ctx, code = '', typeWord = 'Journal') {
  const bal = voucherBalance(v);
  if (!bal.ok) return { code: bal.unreadable ? 'unreadable_amount' : 'not_balanced', ...(bal.unreadable ? { kind: 'unreadable_amount' } : {}), error: `Left out of the file: ${bal.error}.` };
  const tallyNumber = String(v.vouchernumber ?? '');
  const number = code + tallyNumber;
  // a number Zoho cannot take (blank, not ending in digits, longer than 16 characters) is replaced by a generated one in
  // uniqueJournalNumber (TALLY-009, OB-003); the cells are empty only until then
  const parts = journalNumberParts(number);
  const flags = [];
  const draft = ctx.settings.documentStatus === 'draft';
  const notes = cleanText(v.narration) || `${typeWord} ${tallyNumber} from Tally`;
  const lines = voucherLines(v);
  // a line in another currency, or a party kept in another currency: the journal is written in rupees at Tally's rupee
  // values (Currency INR), which posts exactly what Tally posted (ASSUMED: Zoho Books takes a rupee journal line naming
  // a contact kept in another currency; not confirmed by an import)
  const foreignContacts = [...new Set(lines.filter(l => (ctx.customers.has(l.ledger) || ctx.vendors.has(l.ledger))
    && (ctx.contactOf?.(ctx.customers.has(l.ledger) ? 'customers' : 'vendors', l.ledger)?.currency || 'INR') !== 'INR').map(l => l.ledger))];
  const fxLines = lines.filter(l => l.forex);
  // round 2: a journal naming contacts kept in ONE other currency, every line of which carries (or converts exactly to)
  // a foreign amount at ONE rate of Tally's, is written in that currency (Currency = the contact's code, Exchange Rate =
  // Tally's rate, Debit and Credit in the foreign amounts): Zoho ties a journal's contact lines to the journal currency
  // (JRN-CONTACT-CURRENCY). Each line's foreign amount times the rate gives Tally's rupee amount to the paisa, so every
  // account still gets exactly what Tally posted. A journal with no foreign amount (an exchange difference) stays in
  // rupees, flagged.
  const inCurrency = (() => {
    if (!foreignContacts.length) return null;
    const codes = [...new Set(foreignContacts.map(n => ctx.contactOf(ctx.customers.has(n) ? 'customers' : 'vendors', n)?.currency))];
    if (codes.length !== 1 || !codes[0]) return null;
    const partyLines = lines.filter(l => foreignContacts.includes(l.ledger));
    if (!partyLines.every(l => l.forex)) return null;
    const { symbol, rate } = partyLines[0].forex;
    if (!fxLines.every(l => l.forex.symbol === symbol && l.forex.rate.equals(rate))) return null;
    const fx = [];
    for (const l of lines) {
      const inr = l.amount.abs();
      const amount = l.forex ? l.forex.fx.abs() : inr.div(rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      if (amount.isZero() || !amount.times(rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).equals(inr)) return null;
      fx.push(amount);
    }
    const debit = sumOf(fx.filter((_, i) => lines[i].amount.isNegative())), credit = sumOf(fx.filter((_, i) => !lines[i].amount.isNegative()));
    if (!debit.equals(credit)) return null;
    return { code: codes[0], rate, fx };
  })();
  if (inCurrency) {
    flags.push({ kind: 'forex_journal_in_currency', message: `This voucher names ${quoteList(foreignContacts)}, kept in ${inCurrency.code}, and every line has a foreign amount at Tally's rate ${inCurrency.rate}. It is written as a Manual Journal in ${inCurrency.code} (Currency ${inCurrency.code}, Exchange Rate ${inCurrency.rate}) with the foreign amounts, so Zoho Books keeps the contact's ${inCurrency.code} balance; each line converts to Tally's rupee amount to the paisa. This is the tool's default and is not confirmed by an import yet: if Zoho refuses it, enter the receipt or payment in Zoho Books in ${inCurrency.code} (Payments Received or Payments Made).` });
  } else if (fxLines.length || foreignContacts.length) {
    const what = fxLines.length ? `${plural(fxLines.length, 'line')} in another currency in Tally (${[...new Set(fxLines.map(l => `${l.forex.fx.abs().toFixed(2)} ${l.forex.symbol} at ${l.forex.rate}`))].slice(0, 3).join(', ')}${fxLines.length > 3 ? ' ...' : ''})` : 'no line in another currency';
    flags.push({ kind: 'forex_journal_in_rupees', message: `This voucher has ${what}${foreignContacts.length ? ` and names ${quoteList(foreignContacts)}, kept in another currency` : ''}. It is written as a Manual Journal in rupees (Currency INR) at Tally's rupee amounts, so every account gets exactly what Tally posted. Zoho Books then records no foreign amount for it: a payment in Zoho is not matched to the foreign invoice or bill, and the exchange difference stays as Tally booked it. This is the tool's default and is not confirmed by an import yet.` });
  }
  return {
    flags, number, typeCode: code, roles: lines.map(() => 'row'), currency: inCurrency ? inCurrency.code : 'INR',
    // the Debit and Credit cells as written, in Tally's sign (voucher reconciliation)
    posting: postingOf(lines.map(l => new Decimal(l.amount.abs().toFixed(2)).times(l.amount.isNegative() ? -1 : 1))),
    rows: lines.map((l, i) => {
      const cust = ctx.customers.has(l.ledger), vend = !cust && ctx.vendors.has(l.ledger);
      const cell = inCurrency ? inCurrency.fx[i].toFixed(2) : l.amount.abs().toFixed(2);
      return {
        'Journal Date': isoDate(v.date), 'Reference Number': number, 'Journal Number Prefix': parts?.prefix ?? '', 'Journal Number Suffix': parts?.suffix ?? '',
        'Notes': notes, 'Journal Type': 'both', 'Currency': inCurrency ? inCurrency.code : 'INR', ...(inCurrency ? { 'Exchange Rate': inCurrency.rate.toString() } : {}),
        'Account': cust ? ACCOUNTS_RECEIVABLE : vend ? ACCOUNTS_PAYABLE : ctx.accountName(l.ledger), 'Contact Name': cust || vend ? ctx.accountName(l.ledger) : '',
        'Debit': l.amount.isNegative() ? cell : '', 'Credit': l.amount.isNegative() ? '' : cell, 'Status': draft ? 'draft' : 'published',
      };
    }),
  };
}

// Makes the journal number of a journal about to be written different from every journal number already taken
// (taken: lower-case numbers, over both journals files). The first voucher keeps its Tally number; a later one with the
// same number gets "-2", "-3" ... after it (Reference Number, prefix and suffix), is flagged, and keeps its Tally
// number in the Notes. A number that cannot be made unique within Zoho's 16 characters is left as it is (the repeated
// number is then flagged for a person, as before). res: the result of journalDocument (changed in place).
// TALLY-009 / OB-003: a journal whose number Zoho cannot take (blank, not ending in digits, the type code and the Tally
// number together longer than 16 characters, or repeated with no room left for "-2") gets a GENERATED number: the type
// code (RCT-, PMT- ..., JRN- for any other journal) with the digits the Tally number ends in when that number is free,
// else the code and the next free six-digit number (RCT-000001). It is unique against every journal number already
// taken (the opening balance journals OB-1 and OB-2 included; the generated ADJ- and TAX- journals avoid these
// afterwards). A journal is never written with an empty number and never merged into another; the Tally number is kept
// in the Notes. counters: per code, the last generated number (shared over one run).
export const GENERATED_JOURNAL_CODE = 'JRN-';
export function uniqueJournalNumber(res, v, taken, counters = new Map()) {
  const key = n => String(n ?? '').trim().toLowerCase();
  const tallyNumber = String(v.vouchernumber ?? '').trim();
  const setNumber = (next, parts) => {
    res.number = next;
    for (const row of res.rows) {
      row['Reference Number'] = next; row['Journal Number Prefix'] = parts.prefix; row['Journal Number Suffix'] = parts.suffix;
      if (tallyNumber && !String(row.Notes || '').includes(tallyNumber)) row.Notes = `${row.Notes} (Tally voucher number ${tallyNumber})`;
    }
  };
  const was = String(res.number ?? '');
  if (journalNumberParts(was)) {
    if (!taken.has(key(was))) { taken.add(key(was)); return res; }
    for (let i = 2; i < 1000; i++) {
      const next = `${was}-${i}`;
      const parts = journalNumberParts(next);
      if (!parts) break; // longer than Zoho takes: a generated number below
      if (taken.has(key(next))) continue;
      taken.add(key(next));
      setNumber(next, parts);
      res.flags.push({ kind: 'journal_number_made_unique', message: `Another voucher written as a Manual Journal already carries the number "${was}" (Tally numbers each voucher type on its own). Zoho Books reads rows with one journal number as one journal, so this journal is numbered "${next}". Nothing else is changed; the Tally voucher number is in the Notes.` });
      return res;
    }
  }
  const code = res.typeCode || GENERATED_JOURNAL_CODE;
  let next = null;
  const digits = /(\d+)$/.exec(tallyNumber)?.[1];
  if (digits && journalNumberParts(code + digits) && !taken.has(key(code + digits))) next = code + digits;
  for (let n = counters.get(code) || 0; !next;) {
    n++;
    const candidate = `${code}${String(n).padStart(6, '0')}`;
    if (!taken.has(key(candidate))) { next = candidate; counters.set(code, n); }
  }
  taken.add(key(next));
  setNumber(next, journalNumberParts(next));
  const why = !tallyNumber ? 'has no voucher number in Tally'
    : !journalNumberParts(was) ? (was.trim().length > 16 ? `has the number "${was}", longer than the 16 characters Zoho takes for a journal number` : `has the number "${was}", which does not end in digits (Zoho needs a number after the prefix)`)
      : `has the number "${was}", which another journal already carries, and there is no room for "-2" within Zoho's 16 characters`;
  res.flags.push({ kind: 'journal_number_generated', message: `This voucher ${why}. Zoho Books requires a journal number and reads rows with one number as one journal, so the journal is numbered "${next}" (generated by the tool, unique in the files).${tallyNumber ? ` The Tally voucher number "${tallyNumber}" is kept in the Notes.` : ''} Nothing else is changed.` });
  return res;
}

// ---------- the generated adjustment journals ----------
// Zoho Books posts the Adjustment of an invoice or bill to an account of its own (settings invoiceAdjustmentAccount,
// billAdjustmentAccount), not to the Tally ledger the amount came from. One Manual Journal per month moves each amount
// back: to the round-off ledger, to the ledger of a non-income invoice line, or to the tax ledger whose tax Zoho worked
// out differently. It names no customer, vendor or bank, and is dated on the last document of the month it corrects.
// docs: [{ file: 'invoices' | 'bills', date, number, parts: [{ ledger, amount (document sign), why }] }].
// taken: the journal numbers already in the Manual Journals file. Returns { rows, journals: [{ number, date, documents,
// lines, amount }] }. Nothing is generated for a file whose adjustment account is empty.
export function adjustmentJournalRows(docs, ctx, taken = new Set()) {
  const settings = { ...VOUCHER_SETTING_DEFAULTS, ...(ctx.settings || {}) };
  const accountName = ctx.accountName || (x => x);
  const adjAccount = file => String((file === 'invoices' ? settings.invoiceAdjustmentAccount : settings.billAdjustmentAccount) ?? '').trim();
  const months = new Map();
  for (const d of docs) {
    const acc = adjAccount(d.file);
    if (!acc || !d.date) continue;
    const sign = d.file === 'bills' ? -1 : 1;
    const m = d.date.slice(0, 7);
    if (!months.has(m)) months.set(m, { date: d.date, net: new Map(), documents: new Set() });
    const g = months.get(m);
    if (d.date > g.date) g.date = d.date;
    for (const p of d.parts) {
      const amt = p.amount.times(sign); // Tally's sign of what the Tally ledger carried (a debit negative)
      // the counter ledger gets what Zoho put on its adjustment account; the adjustment account the opposite
      g.net.set(accountName(p.ledger), (g.net.get(accountName(p.ledger)) || ZERO).plus(amt));
      g.net.set(acc, (g.net.get(acc) || ZERO).minus(amt));
      g.documents.add(`${d.file}|${d.number}`);
    }
  }
  const rows = [], journals = [];
  const draft = settings.documentStatus === 'draft';
  for (const [m, g] of [...months].sort(([a], [b]) => a.localeCompare(b))) {
    const lines = [...g.net].filter(([, x]) => !x.isZero());
    if (!lines.length) continue;
    let number = `ADJ-${m.replace('-', '')}`;
    for (let i = 2; taken.has(number); i++) number = `ADJ${i}-${m.replace('-', '')}`;
    taken.add(number);
    const parts = journalNumberParts(number);
    const notes = `Adjustment of ${plural(g.documents.size, 'document')} (invoices or bills) dated ${m}: moves the amounts Zoho Books posted to its own adjustment account to the Tally ledgers they belong to (round-off, lines that are not income, tax rounding). Generated by the migration tool.`;
    for (const [account, x] of lines) {
      rows.push({ 'Journal Date': g.date, 'Reference Number': number, 'Journal Number Prefix': parts?.prefix ?? '', 'Journal Number Suffix': parts?.suffix ?? '', 'Notes': notes,
        'Journal Type': 'both', 'Currency': 'INR', 'Account': account, 'Contact Name': '',
        'Debit': x.isNegative() ? x.abs().toFixed(2) : '', 'Credit': x.isNegative() ? '' : x.toFixed(2), 'Status': draft ? 'draft' : 'published' });
    }
    journals.push({ number, date: g.date, documents: g.documents.size, lines: lines.length, amount: sumOf(lines.map(([, x]) => x).filter(x => x.greaterThan(0))).toFixed(2) });
  }
  return { rows, journals };
}

// Why a voucher is never written to a Zoho file, whatever its type or routing. null when it may be written.
export const LEFT_OUT_STATUS = {
  cancelled: 'Left out of the file: the voucher is cancelled in Tally.',
  optional: 'Left out of the file: the voucher is marked optional in Tally (it is not posted to the books).',
  deleted: 'Left out of the file: the voucher is marked deleted in Tally.',
  void: 'Left out of the file: the voucher is marked void in Tally (isvoid).',
};
// TALLY-003: why an invoice or bill could not be written that makes the voucher a Manual Journal instead (posting exactly
// what Tally posted), not a voucher left out.
const PARTY_DOC_FALLBACK = { no_single_party: 'it does not have exactly one customer or vendor line', party_side: 'its party is on the other side (a return or an adjustment entered in this voucher type)',
  no_lines: 'it has no line besides the party and its tax', not_a_party: 'the party it names is a ledger of the masters that is not a customer (for a bill: a vendor)' };

// THE date rule of a voucher against the migration's financial year (year: { from, to }, tally.js jobYear), shared by
// the files (buildVoucherOutput) and the Trial Balance movement check (index.js), so the two can never differ:
//  'invalid_date'  the date is not a real calendar day ("20250931") or cannot be read: never guessed, never written;
//  'outside_year'  a real date before year.from or after year.to;
//  null            a real date inside the year (or no year known).
export function voucherYearOutcome(v, year) {
  const dated = isoDate(v?.date);
  if (!dated) return 'invalid_date';
  if (year && (dated < year.from || dated > year.to)) return 'outside_year';
  return null;
}

// vouchers: [{ id, source_id, name, slot, data, decision }]
// Returns { invoices|bills|journals: { rows: [{ row, rec }], vouchers }, exceptions: [{ rec, message, kind? }], undecided, excluded,
//   unmappedTax: [ledger], partySideTax: [{ ledger, file, vouchers }], repeatedNumbers: [{ file, number, recs }],
//   taxOnVouchers: [{ file, rec, taxes: [{ ledger, zohoTax }] }], tdsUnmapped: [{ ledger, vouchers }], tdsUsed: [{ ledger, zohoTds, vouchers }],
//   taxNameRates: [{ zohoTax, rates: [rate], vouchers }] (a Zoho tax name written with more than one rate) }
// A cancelled, optional or deleted voucher is left out first, before any routing: it needs no decision.
// Receipt, Payment, Contra, Debit Note and Credit Note vouchers (payments.js): those that belong in a Zoho module with
// no import sample yet (Payments Received, Payments Made, Vendor Credits, Credit Notes) are returned in held (with
// their bill-wise allocations worked out against the invoices and bills written); the rest are Manual Journals in
// other_journals. journalCategories: [{ slot, category, vouchers }] written as journals as a matter of course.
// exceptions with a kind are flagged items about one voucher (negative_row, tax_not_attributable, tax_rate_unknown,
//   tax_amount_differs, line_tax_names_differ, document_total_differs, tds_several_on_bill, tds_amount_differs,
//   tds_on_other_side, place_of_supply_missing, document_number_too_long, item_line_rate_differs,
//   journal_number_not_usable); the voucher is still written.
// opts:
//   customers, vendors, taxLedgers: NameSets of the masters (they also find a name that differs only by hidden characters)
//   taxMap: { tax ledger: Zoho tax name } (Mapping Studio, Tax mapping)
//   kindOf(ledger): the kind of a ledger from its Tally group, used to describe a negative row (optional)
//   accountName(ledger): THE name resolver (namefix.js makeNameResolver): the name written in the party, Account and
//     Contact Name columns after the accountant's decisions. The name on the voucher is used when it is not given.
//   taxInfo(ledger): what the masters say about a tax ledger (taxLedgerInfo), or null
//   tdsMap: { TDS ledger: { tdsName, section, percent } } (Mapping Studio, TDS mapping)
//   contactOf('customers' | 'vendors', ledger): { treatment, gstin, place } as written in the contact file, or null
//   settings: { billNumber, documentStatus } (VOUCHER_SETTING_DEFAULTS)
export function buildVoucherOutput(vouchers, opts) {
  const ctx = { taxMap: {}, kindOf: null, accountName: x => x, taxInfo: () => null, tdsMap: {}, contactOf: () => null, ...opts,
    settings: { ...VOUCHER_SETTING_DEFAULTS, ...(opts.settings || {}) } };
  // v2 default 15: the service item of each account used on an invoice line without a stock item (Item Name is
  // mandatory on invoices). One name per account written; a name already taken by a stock item (opts.stockItemNames)
  // or by the service item of another account gets " (service)" and, if still taken, a number.
  const serviceItems = new Map(); // account as written -> { name, lines, vouchers: Set }
  const takenItemNames = new Set((opts.stockItemNames || []).map(n => String(n).trim().toLowerCase()));
  ctx.serviceItemFor = account => {
    if (!serviceItems.has(account)) {
      let name = serviceItemName(account, takenItemNames);
      for (let i = 2; takenItemNames.has(name.toLowerCase()); i++) name = `${serviceItemName(account).slice(0, 90).trim()} (service ${i})`;
      takenItemNames.add(name.toLowerCase());
      serviceItems.set(account, { name, account });
    }
    return serviceItems.get(account).name;
  };
  ctx.serviceItemHsn = (account, code) => { const s = serviceItems.get(account); if (s && !s.hsn) s.hsn = code; };
  // round 1 (issue 10): Tally's type of supply of the item's lines (the line's override, else the ledger's)
  ctx.serviceItemSupply = (account, type) => { const s = serviceItems.get(account); if (s && type && !s.typeOfSupply) s.typeOfSupply = type; };
  const routing = routingOptions(ctx); // what suggestJournal knows (the same for Voucher Classification)
  // the routing the default gave each journal with no decision: id -> { decision, kind, fallback, suggested, clear,
  // needsCheck } (decision: what the files write, after the fallback to Manual Journal)
  const routes = new Map();
  const unmappedTax = new Set();
  const partySide = new Map(); // file|ledger -> { ledger, file, ids: Set }
  const tdsUnmapped = new Map(), tdsUsed = new Map(), nameRates = new Map();
  ctx.tdsClaims = new Map(); // TDS tax names this run creates: a name used for another rate or section is made unique (tds.js)
  const tcsToCreate = new Map(); // TDS-015: the TCS taxes the TCS columns name (setting tcsMode 'columns'), to create in Zoho
  const tdsToCreate = new Map(), recomputeDocs = [], tdsDiffersDocs = []; // TDS taxes the files name that Zoho does not have yet; documents Zoho works out differently
  const numbers = { invoices: new Map(), bills: new Map(), journals: new Map(), other_journals: new Map() }; // document number -> [rec]
  const out = { invoices: { rows: [], vouchers: 0 }, bills: { rows: [], vouchers: 0 }, journals: { rows: [], vouchers: 0 }, other_journals: { rows: [], vouchers: 0 } };
  const exceptions = [], taxOnVouchers = [];
  // Receipt, Payment, Contra, Debit and Credit Note vouchers (payments.js): held for a file with no Zoho sample yet, or
  // written to other_journals. written: the invoices and bills written, for their bill-wise references.
  const held = [], written = [], outcome = new Map(), journalCategories = new Map();
  const credits = []; // the contact lines of the journals written that are a credit in Zoho Books (creditLinesOf)
  const journalNumbersTaken = new Set(['ob-1', 'ob-2']); // journal numbers in use, over both journals files and the opening balance journal
  const adjustmentsWritten = []; // the Adjustment parts of the invoices and bills written (adjustmentJournals)
  const taxPostings = []; // the TDS and reverse charge of the invoices and bills written (taxposting.js, taxAlignmentJournals)
  // where each voucher went, one entry per voucher (voucherrecon.js): { id, slot, outcome: written | held |
  // awaiting_routing | left_out | not_handled, file, number (the document number written), reason (why left out),
  // roles (how each Tally line is written, for a written voucher), posting ({ debit, credit } as written), flags (kinds) }
  const recon = [];
  const note = (rec, entry) => recon.push({ id: rec.id, slot: rec.slot, file: null, number: String(rec.data.vouchernumber ?? ''), reason: null, roles: null, posting: null, flags: [], ...entry });
  let undecided = 0, excluded = 0, billsFromReference = 0;
  const billKeys = new Map(); // vendor as written + bill number -> the first voucher written with it
  const billNumberVendors = new Map(); // bill number -> the vendors (as written) that use it
  const outsideYear = [];
  const journalCounters = new Map(); // generated journal numbers per type code (uniqueJournalNumber)
  // TALLY-009: the numbers of every voucher (and the supplier's references), so a generated invoice or bill number never
  // takes one a Tally voucher uses
  const docTaken = new Set();
  for (const r of vouchers) for (const n of [r.data?.vouchernumber, cleanText(r.data?.reference)]) if (String(n ?? '').trim()) docTaken.add(String(n).trim().toLowerCase());
  const docCounters = new Map();
  // TALLY-001: ONE outcome per Tally voucher identity (its guid). A second copy of the same voucher (the same file twice,
  // or the voucher in two datasets) is left out as a duplicate of the first. ctx.duplicateOf (index.js) names the first
  // copy over every dataset; without it, the copies are found here in the order given.
  const firstOf = new Map(), duplicateIds = new Set();
  for (const given of vouchers) {
    // round 2 (SYN-5): a correction the accountant entered for this voucher (vouchercorrections.js): the voucher is
    // processed with the corrected date or line amount, and the correction is flagged (Assumptions the tool made)
    let rec = given, corrected = null;
    if (given.correction) {
      const a = applyCorrection(given.data, given.correction);
      if (a.error) exceptions.push({ rec: given, kind: 'voucher_correction_not_applied', message: `The correction entered for this voucher was not applied: ${a.error}. The voucher is handled as exported. Enter the correction again in Voucher Classification.` });
      else { rec = { ...given, data: a.data }; corrected = a.flag; }
    }
    const v = rec.data;
    const sid = rec.source_id == null ? null : String(rec.source_id);
    const dupOf = ctx.duplicateOf ? ctx.duplicateOf.get(rec.id) || null : sid != null && firstOf.has(sid) ? firstOf.get(sid) : null;
    if (sid != null && !firstOf.has(sid)) firstOf.set(sid, { id: rec.id, slot: rec.slot, name: rec.name });
    if (dupOf && dupOf.id !== rec.id) {
      duplicateIds.add(rec.id);
      note(rec, { outcome: 'left_out', reason: 'duplicate' });
      outcome.set(rec.id, 'a second copy of another voucher, so in no file');
      exceptions.push({ rec, kind: 'left_out_duplicate', message: `Left out of the file: this is a second copy of the Tally voucher "${dupOf.name}"${dupOf.slot && dupOf.slot !== rec.slot ? ` (stored in another dataset, ${dupOf.slot.replace(/_/g, ' ')})` : ''}: both carry the same Tally identifier. A Tally voucher reaches Zoho Books once, so only the first copy is written. Remove the copy from the uploaded files (or upload the All Transactions file alone) to clear this.` });
      continue;
    }
    // TALLY-002: a voucher of a type with no dataset (Other Voucher Types) has no Zoho file only when Tally does not post
    // it: a type Tally never posts (Memorandum, Reversing Journal, orders), or a voucher with no ledger amount. Any other
    // (Payroll, a note with accounting entries, a type that cannot be traced) is written as a Manual Journal below.
    let otherType = null;
    if (rec.slot === OTHER_SLOT) {
      otherType = { name: entryVchType(v), ...routeVoucherType(entryVchType(v), ctx.voucherTypes || null) };
      if (isNonPostingBase(otherType.base) || !hasPostingLines(v)) {
        note(rec, { outcome: 'no_file', reason: isNonPostingBase(otherType.base) ? 'type_not_posted' : 'no_ledger_amount' });
        outcome.set(rec.id, 'a voucher Tally does not post to the ledgers, so in no file');
        continue;
      }
    }
    const status = voucherStatus(v);
    if (status) { excluded++; note(rec, { outcome: 'left_out', reason: status }); outcome.set(rec.id, `${status} in Tally, so in no file`); exceptions.push({ rec, message: LEFT_OUT_STATUS[status], kind: `left_out_${status}` }); continue; }
    // The date rule (voucherYearOutcome, shared with the Trial Balance movement check). A date that is not a real
    // calendar day ("20250931", "20260229") or cannot be read is never guessed into another date and never written
    // (Zoho Books refuses it): the voucher is left out with the reason invalid_date until the date is corrected in Tally.
    const dated = isoDate(v.date);
    const yearOutcome = voucherYearOutcome(v, ctx.year);
    if (yearOutcome === 'invalid_date') {
      note(rec, { outcome: 'left_out', reason: 'invalid_date' });
      outcome.set(rec.id, 'its date is not a real calendar day, so in no file');
      const words = impossibleDateWords(v.date);
      exceptions.push({ rec, kind: 'left_out_invalid_date', message: `Left out of the file: the voucher date in the Tally export is "${v.date ?? ''}"${words ? `, which is ${words}: there is no such day` : ', which is not a date'}. Zoho Books refuses a date that does not exist, and the tool never guesses another date. Correct the date in Tally, export again and process again; or enter the correct date for this voucher in Voucher Classification (correct the date), and create the files again.` });
      continue;
    }
    // A voucher dated outside the migration's financial year (v2, M6): left out of the files by default, counted and
    // listed; written like any other when the switch is set to include.
    if (yearOutcome === 'outside_year') {
      outsideYear.push(rec);
      if (ctx.settings.outOfYear !== 'include') {
        note(rec, { outcome: 'left_out', reason: 'outside_year' });
        outcome.set(rec.id, 'dated outside the financial year, so in no file');
        exceptions.push({ rec, kind: 'left_out_outside_year', message: `Left out of the file: the voucher is dated ${dated}, outside the financial year of the migration (${ctx.year.from} to ${ctx.year.to}). This is the tool's default. To write such vouchers, set "vouchers outside the financial year" to include in Mapping Studio (Voucher files); or check the period of the Tally export.` });
        continue;
      }
      exceptions.push({ rec, kind: 'voucher_outside_year_included', message: `The voucher is dated ${dated}, outside the financial year of the migration (${ctx.year.from} to ${ctx.year.to}). It is written to the files because "vouchers outside the financial year" is set to include.` });
    }
    const money = MONEY_SLOTS.includes(rec.slot);
    // Journal routing (v2 default 8): the decision made in Voucher Classification, else (with ctx.defaultRouting) the
    // default: the clear suggestion, a Manual Journal when there is none or for a reimbursement. Never left out.
    let routedByDefault = null;
    if (rec.slot === 'journal' && !rec.decision && ctx.defaultRouting) {
      const suggestion = suggestJournal(v, ctx.customers, ctx.vendors, routing);
      const lines = voucherLines(v).map(l => ({ ledger: l.ledger, debit: !!l.amount?.isNegative(), kind: ctx.taxLedgers?.has(l.ledger) ? 'tax' : ctx.kindOf ? ctx.kindOf(l.ledger) : null }));
      routedByDefault = { suggestion, ...defaultJournalRoute(suggestion, {
        reimbursement: isReimbursementJournal(lines, v.narration),
        // a Bill or Invoice only when it can be written as one, to a party that is in the masters
        usable: d => { if (d === 'Manual Journal') return true; const set = d === 'Bill' ? ctx.vendors : ctx.customers; const p = partyDocParty(v, d, set); return !p.error && set.has(p.party.ledger); },
      }) };
    }
    const decision = rec.decision || routedByDefault?.decision;
    const target = rec.slot === 'sales' ? 'Invoice' : rec.slot === 'purchase' ? 'Bill' : rec.slot === 'journal' ? decision : money || otherType ? 'Manual Journal' : null;
    if (rec.slot === 'journal' && !target) {
      undecided++;
      note(rec, { outcome: 'awaiting_routing' });
      outcome.set(rec.id, 'a journal not routed yet');
      exceptions.push({ rec, message: 'Journal voucher has not been routed yet. Choose Invoice, Bill or Manual Journal in Voucher Classification.' });
      continue;
    }
    if (!target) { note(rec, { outcome: 'not_handled' }); continue; }
    let route = null;
    if (money) {
      const bal = voucherBalance(v);
      if (!bal.ok) { note(rec, { outcome: 'left_out', reason: bal.unreadable ? 'unreadable_amount' : 'not_balanced' }); outcome.set(rec.id, 'left out of the files'); exceptions.push({ rec, message: `Left out of the file: ${bal.error}.`, ...(bal.unreadable ? { kind: 'unreadable_amount' } : {}) }); continue; }
      route = classifyMoneyVoucher(v, rec.slot, ctx);
      if (route.file !== 'other_journals') {
        if (ctx.settings.paymentsRoute === 'module_files') {
          held.push({ rec, ...route });
          note(rec, { outcome: 'held', file: route.file });
          outcome.set(rec.id, `held for ${route.file.replace(/_/g, ' ')}, which has no Zoho sample yet`);
          continue;
        }
        // the default route: a Manual Journal now (the party on Accounts Receivable / Accounts Payable with the contact,
        // the bank and every other line as in Tally). The module it belongs in is kept for the list of credits to apply.
        route = { file: 'other_journals', category: MODULE_AS_JOURNAL[route.file], module: route.file, reason: JOURNAL_CATEGORIES[MODULE_AS_JOURNAL[route.file]] };
      }
    }
    let res = target === 'Manual Journal' ? journalDocument(v, ctx, money ? JOURNAL_CODES[rec.slot] : '', money ? TYPE_WORDS[rec.slot] : otherType ? (otherType.name || 'Voucher') : 'Journal') : partyDocument(v, target, ctx, unmappedTax);
    let written_as = target;
    if (otherType && !res.error) {
      res.flags.push({ kind: 'other_type_written_as_journal', message: `This voucher is of type "${otherType.name || '(no voucher type)'}"${otherType.base && otherType.base !== otherType.name ? `, a kind of ${otherType.base}` : otherType.how === 'unresolved' ? ", which could not be traced to one of Tally's own voucher types" : ''}. Zoho Books has no document for it, and in Tally it posts amounts to the ledgers, so it is written as a Manual Journal that posts exactly what Tally posted (every ledger line as in Tally; customers and vendors on Accounts Receivable or Accounts Payable with the contact). This is the tool's default.` });
    }
    // TALLY-003: a Sales or Purchase voucher that cannot be a valid invoice or bill (not exactly one customer or vendor,
    // the party on the other side, no line besides the party, or a party that is not a customer or vendor in the masters)
    // is a Manual Journal posting exactly what Tally posted, never left out (only a cancelled, optional, deleted or void
    // voucher, one outside the year, an impossible date, an unbalanced voucher or an unreadable amount is left out).
    if ((rec.slot === 'sales' || rec.slot === 'purchase') && (target === 'Invoice' || target === 'Bill')) {
      // "not a party": the ledger the voucher names as its party is a ledger of the masters under a group that is not
      // Sundry Debtors (Sundry Creditors for a bill), for example Cash on a counter sale. A party that is missing from the masters
      // export altogether stays an invoice or bill (flagged: export the masters again), never an account it is not.
      const parties = target === 'Bill' ? ctx.vendors : ctx.customers;
      const kind = res.error || res.partyLedger == null || parties?.has(res.partyLedger) ? null : ctx.kindOf?.(res.partyLedger);
      const why = res.error ? (PARTY_DOC_FALLBACK[res.code] ? res.code : null)
        : kind && kind !== (target === 'Bill' ? 'vendor' : 'customer') ? 'not_a_party' : null; // a vendor named on a Sales voucher too
      if (why) {
        const j = journalDocument(v, ctx, '', target === 'Bill' ? 'Purchase' : 'Sales');
        if (!j.error) {
          j.flags.push({ kind: rec.slot === 'sales' ? 'sales_written_as_journal' : 'purchase_written_as_journal', message: `This ${rec.slot === 'sales' ? 'Sales' : 'Purchase'} voucher cannot be written as ${target === 'Bill' ? 'a bill' : 'an invoice'}: ${why === 'not_a_party' ? `the party it names ("${res.partyLedger}") is a ledger of the masters that is not a ${target === 'Bill' ? 'vendor' : 'customer'}` : PARTY_DOC_FALLBACK[why]}. It is written as a Manual Journal that posts exactly what Tally posted, so the trial balance stays Tally's. It is not ${target === 'Bill' ? 'a bill' : 'an invoice'} in Zoho Books (no GST document). This is the tool's default: an accountant may enter it another way.` });
          res = j; written_as = 'Manual Journal';
        }
      }
    }
    // a journal routed by default to a Bill or Invoice that cannot be written as one is a Manual Journal instead
    // So is one that WOULD be written but that Zoho is expected to refuse or that would lose its GST: a bill line of a
    // registered vendor with no tax that could be written (bill_line_needs_tax_or_exemption), or GST that cannot be
    // put on the lines (tax_not_attributable). A default never produces a row known to be refused.
    const refusedAsDocument = r => !r.error && (r.flags || []).some(f => DEFAULT_ROUTE_REFUSED_KINDS.includes(f.kind));
    if ((res.error || refusedAsDocument(res)) && routedByDefault && target !== 'Manual Journal') {
      const j = journalDocument(v, ctx, '', 'Journal');
      if (!j.error) {
        routedByDefault.fallback = res.error ? 'not_writable' : (res.flags || []).find(f => DEFAULT_ROUTE_REFUSED_KINDS.includes(f.kind)).kind;
        res = j; written_as = 'Manual Journal'; routedByDefault.kind = 'journal_default_manual'; routedByDefault.decision = 'Manual Journal';
      }
    }
    if (routedByDefault) {
      const s = routedByDefault.suggestion;
      routes.set(rec.id, { decision: routedByDefault.decision, kind: routedByDefault.kind, fallback: routedByDefault.fallback || null, suggested: s.suggested, clear: s.clear !== false, needsCheck: !!s.needsCheck });
    }
    if (res.error) { note(rec, { outcome: 'left_out', reason: res.code || 'other' }); outcome.set(rec.id, 'left out of the files'); exceptions.push({ rec, message: res.error, ...(res.kind ? { kind: res.kind } : {}) }); continue; }
    // Zoho Books reads the rows of one journal number (prefix + suffix) as ONE journal, in whichever journals file they
    // are. Tally numbers each voucher type on its own, so two vouchers can carry the same number: the second gets
    // "-2" (then "-3" ...) after its number, so no voucher is merged into another or refused. The Tally number stays
    // in the Notes.
    if (written_as === 'Manual Journal') uniqueJournalNumber(res, v, journalNumbersTaken, journalCounters);
    if (corrected) res.flags.push(corrected);
    if (res.warning) exceptions.push({ rec, message: res.warning });
    const file = written_as === 'Invoice' ? 'invoices' : written_as === 'Bill' ? 'bills' : money ? 'other_journals' : 'journals';
    // TALLY-009: an invoice or bill with no number (or an invoice number longer than Zoho's 50 characters) gets a generated
    // one (INV-000001, BILL-000001) that no Tally voucher uses; the Tally number, if any, is kept in the notes
    if ((file === 'invoices' || file === 'bills') && (!String(res.number ?? '').trim() || (file === 'invoices' && String(res.number).length > 50))) {
      const code = file === 'invoices' ? 'INV-' : 'BILL-', col = file === 'invoices' ? 'Invoice Number' : 'Bill Number', notesCol = file === 'invoices' ? 'Notes' : 'Vendor Notes';
      const was = String(res.number ?? '');
      let n = docCounters.get(code) || 0, next;
      do { n++; next = `${code}${String(n).padStart(6, '0')}`; } while (docTaken.has(next.toLowerCase()));
      docCounters.set(code, n); docTaken.add(next.toLowerCase());
      res.number = next; res.voucherNumber = res.voucherNumber || next;
      for (const row of res.rows) { row[col] = next; if (was.trim()) row[notesCol] = [row[notesCol], `Tally voucher number ${was}`].filter(Boolean).join(' '); }
      res.flags = (res.flags || []).filter(f => f.kind !== 'document_number_too_long');
      res.flags.push({ kind: 'document_number_generated', message: `This voucher ${was.trim() ? `has the number "${was}", longer than the 50 characters Zoho takes` : 'has no voucher number in Tally'}. Zoho Books requires ${file === 'invoices' ? 'an Invoice Number' : 'a Bill Number'} and reads rows with one number as one document, so it is numbered "${next}" (generated by the tool, used by no other voucher).${was.trim() ? ' The Tally number is kept in the notes.' : ''} Nothing else is changed.` });
    }
    // TALLY-007: a Tally status whose effect is not confirmed (on hold, post-dated, an opening balance entered as a voucher)
    const unverified = unverifiedStatusFlags(v);
    if (unverified.length) (res.flags = res.flags || []).push({ kind: 'voucher_status_unverified', message: `Tally marks this voucher ${unverified.join(', ')} = true. What that means for the books has not been confirmed with a real Tally export, so the voucher is written as Tally holds it and counted in the trial balance. Check it in Tally: if it is not posted in the books of this period (for example an opening balance already in the opening balances, or a post-dated entry of a later period), take it out of the Zoho file before the import.` });
    if (routedByDefault) {
      const s = routedByDefault.suggestion;
      exceptions.push({ rec, kind: routedByDefault.kind, message: (routedByDefault.kind === 'journal_default_suggestion'
        ? `No routing was chosen for this journal, so it is written as the tool suggests: ${routedByDefault.decision}. ${s.reason}`
        : routedByDefault.kind === 'journal_default_reimbursement'
          ? `No routing was chosen for this journal. It reads as an expense reimbursed to a party (for example travel), so it is written as a Manual Journal, not as ${s.suggested === 'Invoice' ? 'an invoice' : 'a bill'}.`
          : `No routing was chosen for this journal, and ${FALLBACK_WORDS[routedByDefault.fallback] ? `as ${s.suggested === 'Invoice' ? 'an invoice' : 'a bill'} ${FALLBACK_WORDS[routedByDefault.fallback]}` : s.clear && s.needsCheck ? `the suggestion (${s.suggested}) would carry a row with a negative amount` : s.clear ? `it cannot be written as ${s.suggested === 'Invoice' ? 'an invoice' : 'a bill'}` : 'the tool has no clear suggestion'}, so it is written as a Manual Journal, which posts exactly what Tally posted. ${s.clear ? '' : s.reason}`.trim())
        + ' This is the tool\'s default: change it in Voucher Classification.' });
    }
    if (file === 'bills') {
      // Bill numbers are unique per vendor in Zoho Books: when the supplier's invoice number is already the number of
      // another bill of the same vendor, this bill carries its Tally voucher number instead (flagged).
      let key = `${res.docName}\u0001${res.number}`;
      if (billKeys.has(key) && res.numberFromReference && res.voucherNumber && res.voucherNumber !== res.number) {
        const was = res.number;
        res.number = res.voucherNumber; res.numberFromReference = false;
        for (const row of res.rows) row['Bill Number'] = res.number;
        res.flags.push({ kind: 'bill_number_collision', message: `The supplier's invoice number "${was}" is already the Bill Number of another bill of the same vendor (Tally voucher ${String(billKeys.get(key).data.vouchernumber ?? '')}). Zoho Books keeps one bill per number and vendor, so this bill carries its Tally voucher number "${res.number}" instead. Check whether the two vouchers are the same supplier invoice entered twice.` });
        key = `${res.docName}\u0001${res.number}`;
      }
      if (!billKeys.has(key)) billKeys.set(key, rec);
      if (res.numberFromReference) billsFromReference++;
      if (!billNumberVendors.has(res.number)) billNumberVendors.set(res.number, new Set());
      billNumberVendors.get(res.number).add(res.docName);
    }
    note(rec, { outcome: 'written', file, number: res.number ?? String(v.vouchernumber ?? ''), roles: res.roles,
      posting: { debit: res.posting.debit.toFixed(2), credit: res.posting.credit.toFixed(2) }, flags: [...new Set((res.flags || []).map(f => f.kind))] });
    outcome.set(rec.id, `written to the ${file === 'invoices' ? 'Invoices' : file === 'bills' ? 'Bills' : 'Manual Journals'} file`);
    if (file === 'invoices' || file === 'bills') written.push({ rec, file, number: res.number, total: res.zohoTotal, partyLedger: res.partyLedger, currency: String(res.rows?.[0]?.['Currency Code'] || '').trim() || 'INR' });
    if ((file === 'invoices' || file === 'bills') && res.adjustParts?.length) adjustmentsWritten.push({ file, date: res.date, number: res.number, parts: res.adjustParts });
    if ((file === 'invoices' || file === 'bills') && res.taxPosting) taxPostings.push({ file, id: rec.id, date: res.date, number: res.number, partyLedger: res.partyLedger, taxPosting: res.taxPosting, ...res.taxPosting });
    if (route?.kind) exceptions.push({ rec, kind: route.kind, message: route.reason });
    // a customer credited or a vendor debited on a journal is a credit of that contact in Zoho Books: kept for the
    // list of credits to apply (payments.js), with Tally's bill-wise allocations
    if (written_as === 'Manual Journal') credits.push(...creditLinesOf(rec, ctx, { number: res.number, file, currency: res.currency || 'INR' }));
    if (route?.category) {
      const k = `${rec.slot}|${route.category}`;
      if (!journalCategories.has(k)) journalCategories.set(k, { slot: rec.slot, category: route.category, vouchers: 0 });
      journalCategories.get(k).vouchers++;
    }
    if (res.negatives?.length) {
      exceptions.push({ rec, kind: 'negative_row', message: negativeRowMessage(written_as, res.negatives, ctx.kindOf) });
    }
    for (const ledger of res.partySideTax || []) {
      const key = `${file}|${ledger}`;
      if (!partySide.has(key)) partySide.set(key, { ledger, file, ids: new Set() });
      partySide.get(key).ids.add(rec.id);
    }
    for (const ledger of res.tdsUnmapped || []) { const k = `${file}|${ledger}`; if (!tdsUnmapped.has(k)) tdsUnmapped.set(k, { ledger, file, ids: new Set() }); tdsUnmapped.get(k).ids.add(rec.id); }
    if (res.tcsUsed) {
      const k = [res.tcsUsed.name, res.tcsUsed.percent, res.tcsUsed.nature].join('|');
      if (!tcsToCreate.has(k)) tcsToCreate.set(k, { ...res.tcsUsed, first: res.date, rows: 0, ids: new Set(), onBills: false, onInvoices: false });
      const x = tcsToCreate.get(k); x.ids.add(rec.id); x.rows += res.rows.length; x[file === 'bills' ? 'onBills' : 'onInvoices'] = true; if (res.date && (!x.first || res.date < x.first)) x.first = res.date;
    }
    if (res.tdsUsed?.create && res.tdsUsed.zohoTds && res.tdsUsed.percent && res.tdsUsed.section) {
      const k = [res.tdsUsed.zohoTds, res.tdsUsed.percent, res.tdsUsed.section].join('|');
      if (!tdsToCreate.has(k)) tdsToCreate.set(k, { tdsName: res.tdsUsed.zohoTds, percent: res.tdsUsed.percent, section: res.tdsUsed.section, act: res.tdsUsed.act, first: res.date, rows: 0, ids: new Set() });
      const x = tdsToCreate.get(k); x.ids.add(rec.id); x.rows += res.rows.length; if (res.date && (!x.first || res.date < x.first)) x.first = res.date;
    }
    if (res.recompute && !res.recompute.difference.isZero() && res.recompute.explained) {
      recomputeDocs.push({ id: rec.id, file, number: res.number, party: res.docName, difference: res.recompute.difference.toFixed(2), adjusted: !res.recompute.adjusted.isZero(),
        tax: { zoho: res.recompute.zohoTax.toFixed(2), tally: res.recompute.tallyTax.toFixed(2) }, tds: { zoho: res.recompute.zohoTds.toFixed(2), tally: res.recompute.tallyTds.toFixed(2) } });
    }
    // a document whose TDS Amount (Tally's) is not its TDS Percentage of the base: "may be refused" in the Zoho check (TDS-005)
    if (res.tdsDiffers != null) tdsDiffersDocs.push({ id: rec.id, file, number: res.number, party: res.docName, difference: res.tdsDiffers });
    if (res.tdsUsed) { const k = `${file}|${res.tdsUsed.ledger}|${res.tdsUsed.zohoTds}`; if (!tdsUsed.has(k)) tdsUsed.set(k, { ...res.tdsUsed, file, ids: new Set() }); tdsUsed.get(k).ids.add(rec.id); }
    for (const f of res.flags || []) exceptions.push({ rec, kind: f.kind, message: f.message });
    if (res.tax?.length) taxOnVouchers.push({ file, rec, taxes: res.tax });
    const bucket = out[file];
    bucket.vouchers++;
    for (const row of res.rows) {
      bucket.rows.push({ row, rec });
      const name = row['Item Tax'] || row['Tax Name'], rate = row['Item Tax %'] || row['Tax Percentage'];
      if (name) { if (!nameRates.has(name)) nameRates.set(name, new Map()); const m = nameRates.get(name); if (!m.has(rate)) m.set(rate, new Set()); m.get(rate).add(rec.id); }
    }
    const number = res.number ?? String(v.vouchernumber ?? '');
    // one document per number in a file; for bills, per number and vendor (Zoho keeps bill numbers per vendor)
    const numberKey = file === 'bills' ? `${res.docName}\u0001${number}` : number;
    if (!numbers[file].has(numberKey)) numbers[file].set(numberKey, { number, recs: [] });
    numbers[file].get(numberKey).recs.push(rec);
  }
  // the bill-wise allocations of the held payments and notes: which invoice or bill written each amount would settle
  // (the same for the credits the journals leave on contacts: one pass in date order, so an invoice or bill is never
  // applied twice or past its total)
  if (held.length || credits.length) {
    const posted = vouchers.filter(r => !voucherStatus(r.data) && !duplicateIds.has(r.id)); // a second copy of a voucher is not counted twice
    allocate([...held, ...credits], documentIndex(written, ctx), newRefIndex(posted, ctx), ctx, r => outcome.get(r.id) || 'in no file');
    for (const h of held) for (const f of h.flags) exceptions.push({ rec: h.rec, kind: f.kind, message: f.message });
    // a credit that Tally set against a document but that cannot be applied as Tally did needs a look; an advance, money
    // on account or a bill from before the migration is only listed (credits_to_apply.csv)
    for (const h of credits) for (const f of h.flags) if (['allocation_exceeds_document', 'allocation_sign_unclear', 'allocation_across_currencies'].includes(f.kind)) exceptions.push({ rec: h.rec, kind: f.kind, message: f.message });
  }
  // the generated adjustment journals (one per month), in the Manual Journals file after Tally's own journals
  const adjustmentJournals = adjustmentJournalRows(adjustmentsWritten, ctx, new Set([...numbers.journals.keys(), ...numbers.other_journals.keys()]));
  for (const row of adjustmentJournals.rows) out.journals.rows.push({ row, rec: { id: null, source_id: null, slot: 'journal', name: row['Reference Number'], data: {} }, generated: true });
  // the generated tax alignment journals (one per month, only where Zoho's posting and Tally's differ), after those
  const taxAlignment = taxAlignmentJournalRows(taxPostings, ctx, new Set([...numbers.journals.keys(), ...numbers.other_journals.keys(), ...adjustmentJournals.journals.map(j => j.number)]));
  for (const row of taxAlignment.rows) out.journals.rows.push({ row, rec: { id: null, source_id: null, slot: 'journal', name: row['Reference Number'], data: {} }, generated: true });
  const repeatedNumbers = Object.entries(numbers).flatMap(([file, map]) => [...map.values()].filter(x => x.recs.length > 1).map(x => ({ file, number: x.number, recs: x.recs })));
  // the service items the written invoices use (a journal first built as an invoice and then written as a Manual
  // Journal uses none): [{ name, account, lines, vouchers }], for the Items file
  const used = new Map();
  for (const { row, rec } of out.invoices.rows) {
    const s = [...serviceItems.values()].find(x => x.name === row['Item Name'] && x.account === row.Account);
    if (!s) continue;
    if (!used.has(s.name)) used.set(s.name, { name: s.name, account: s.account, lines: 0, ids: new Set() });
    const u = used.get(s.name); u.lines++; u.ids.add(rec.id);
  }
  const serviceItemList = [...used.values()].map(u => ({ name: u.name, account: u.account, lines: u.lines, vouchers: u.ids.size, hsn: [...serviceItems.values()].find(x => x.name === u.name)?.hsn || '', typeOfSupply: [...serviceItems.values()].find(x => x.name === u.name)?.typeOfSupply || '' }));
  return { ...out, exceptions, undecided, excluded, unmappedTax: [...unmappedTax], repeatedNumbers, taxOnVouchers, held, credits, journalCategories: [...journalCategories.values()], recon, routes,
    serviceItems: serviceItemList, adjustmentJournals: adjustmentJournals.journals, taxAlignmentJournals: taxAlignment.journals, taxPostings,
    // bills numbered with the supplier's invoice number; bill numbers used by more than one vendor; vouchers dated
    // outside the financial year (left out unless the switch says include)
    billNumbers: { fromReference: billsFromReference, sharedByVendors: [...billNumberVendors.values()].filter(s => s.size > 1).length },
    outsideYear: { vouchers: outsideYear.length, included: ctx.settings.outOfYear === 'include' },
    partySideTax: [...partySide.values()].map(p => ({ ledger: p.ledger, file: p.file, vouchers: p.ids.size })),
    tdsUnmapped: [...tdsUnmapped.values()].map(t => ({ ledger: t.ledger, file: t.file, vouchers: t.ids.size })),
    // "TDS taxes to create in Zoho" (set-up guide): name, rate, section code, tax act, start date, and how many rows use it
    tdsTaxes: [...tdsToCreate.values()].map(x => ({ ...tdsTaxToCreate({ tdsName: x.tdsName, percent: x.percent, section: x.section, act: x.act }, [x.first, ctx.year?.from].filter(Boolean).sort()[0]), vouchers: x.ids.size, rows: x.rows }))
      .sort((a, b) => a.name.localeCompare(b.name) || Number(a.rate) - Number(b.rate)),
    // "TCS taxes to create in Zoho" (TDS-015): name, rate, nature of collection, act, first date, rows
    tcsTaxes: [...tcsToCreate.values()].map(x => ({ name: x.name, rate: x.percent, natureOfCollection: x.nature, section: x.section, act: x.act, actWords: ACT_WORDS[x.act], firstDate: x.first, onBills: x.onBills, onInvoices: x.onInvoices, vouchers: x.ids.size, rows: x.rows }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    // documents whose tax or TDS Zoho works out differently from Tally (a rounding difference written in Adjustment, or a larger one flagged)
    recomputeDocs,
    // documents whose TDS Amount is not the TDS Percentage of the base by more than a rupee (kept for the Zoho check)
    tdsDiffersDocs,
    tdsUsed: [...tdsUsed.values()].map(t => ({ ledger: t.ledger, zohoTds: t.zohoTds, file: t.file, byDefault: t.byDefault, vouchers: t.ids.size })),
    taxNameRates: [...nameRates.entries()].filter(([, m]) => m.size > 1).map(([zohoTax, m]) => ({ zohoTax, rates: [...m.keys()], vouchers: new Set([...m.values()].flatMap(s => [...s])).size })) };
}
