// THE TRIAL BALANCE ZOHO BOOKS SHOULD SHOW, WORKED OUT FROM THE FILES BEFORE ANYTHING IS IMPORTED.
//
// Why: in three test imports every difference between Zoho Books and Tally was found only after a real import and a
// trial balance compared by hand. The files already say everything Zoho Books will post, so the tool posts them itself,
// the way Zoho Books does, and compares the result with Tally's closing trial balance, account by account and contact
// by contact. A difference is then seen BEFORE the download, with the file it comes from.
//
// How the files are posted (each rule is listed with its evidence in POSTING_RULES, and shown with the result):
//  - Chart of Accounts: the Opening Balance of a row on its side, the other side on Opening Balance Adjustments;
//  - Customers / Vendors: the Opening Balance on Accounts Receivable / Accounts Payable for that contact, the other
//    side on Opening Balance Adjustments;
//  - the journal files: every line as written (a line on Accounts Receivable or Payable is kept per contact);
//  - Invoices: each line on its Account, the tax of each line worked out from its rate the way Zoho does (each part
//    of a tax group rounded on its own) on Output CGST / SGST / IGST, the TDS Amount on TDS Receivable, the Adjustment
//    on the invoice adjustment account, the total on Accounts Receivable for the customer;
//  - Bills: each line on its Account, the tax on Input CGST / SGST / IGST, reverse charge as a debit on Reverse Charge
//    Tax Input but not due and a credit on the Output account, the TDS Amount on TDS Payable, the Adjustment on the
//    bill adjustment account, the total on Accounts Payable for the vendor.
// A draft document or journal is not posted by Zoho Books; it is counted and left out.
//
// It is a REPORT: it never blocks a download. What blocks is the Zoho check (rows Zoho would refuse).
// Nothing here knows a company: the account names come from zohorules.json and the voucher settings.
import fs from 'node:fs';
import Decimal from 'decimal.js';
import { accountNameKey, contactNameKey, builtinAccount, ZOHO_OPENING_BALANCE_ACCOUNT } from './zohocodes.js';
import { ZOHO_TAX_POSTING_ACCOUNTS } from './taxposting.js';

const RULES = JSON.parse(fs.readFileSync(new URL('./zohorules.json', import.meta.url), 'utf8'));
const TAX_TABLE = RULES.lists?.tax_ledger_zoho_accounts?.entries || [];
const ZERO = new Decimal(0);
const RECEIVABLE = 'Accounts Receivable', PAYABLE = 'Accounts Payable';
const HEADS = ['CGST', 'SGST', 'IGST'];
const inputOf = head => TAX_TABLE.find(e => e.head === head && e.side === 'input' && !e.rcm && !e.tds)?.account || `Input ${head}`;
const outputOf = head => ZOHO_TAX_POSTING_ACCOUNTS.output[head] || `Output ${head}`;
const dec = v => { const s = String(v ?? '').replace(/,/g, '').trim(); if (!s) return ZERO; try { const d = new Decimal(s); return d.isFinite() ? d : ZERO; } catch { return ZERO; } };
const r2 = d => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const text = v => String(v ?? '').trim();
const isDraft = v => /^draft$/i.test(text(v));
const yes = v => /^(true|yes|1)$/i.test(text(v));
// A paisa or two of tax rounding is not a wrong account: a difference up to this is marked "rounding" (the same limit
// the voucher reconciliation uses for one tax line).
export const ROUNDING_LIMIT = new Decimal(1);

// The posting rules. TDS-019: the evidence of each (and its note) is read from ONE record, zohorules.json
// lists.posting_rules, which every module reads; the text here only says the rule with the account names.
// evidence: 'confirmed' (seen in a test import: the balances were read after it), 'documentation', 'assumed' (not seen yet).
const POSTING_EVIDENCE = new Map((RULES.lists?.posting_rules?.rules || []).map(r => [r.id, r]));
const RULE_TEXT = [
  ['chart_opening', 'The Opening Balance of a Chart of Accounts row is posted on that account; the other side on Opening Balance Adjustments.'],
  ['contact_opening', 'The Opening Balance of a customer is posted on Accounts Receivable and of a vendor on Accounts Payable; the other side on Opening Balance Adjustments.'],
  ['journal_lines', 'A Manual Journal is posted line by line as written.'],
  ['invoice_lines', 'An invoice line is posted on the account of its Account column; the total on Accounts Receivable.'],
  ['bill_lines', 'A bill line is posted on the account of its Account column; the total on Accounts Payable.'],
  ['tax_parts', 'Zoho Books works the tax out from the rate: each part of a tax group (CGST and SGST) is rounded on its own. Sales tax is posted on Output CGST, Output SGST or Output IGST, purchase tax on Input CGST, Input SGST or Input IGST.'],
  ['bill_tds', `The TDS Amount of a bill is posted on "${ZOHO_TAX_POSTING_ACCOUNTS.tdsPayable}".`],
  ['invoice_tds', `The TDS Amount of an invoice is posted on "${ZOHO_TAX_POSTING_ACCOUNTS.tdsReceivable}".`],
  ['invoice_tcs', 'The TCS Amount of an invoice is posted on its TCS Payable Account (TCS Payable when none is written) and added to what the customer owes; the TCS of a bill on TCS Receivable, added to what the vendor is owed.'],
  ['reverse_charge', `Reverse charge of a bill is posted as a debit on "${ZOHO_TAX_POSTING_ACCOUNTS.rcmInput}" and a credit on the Output account of the tax written. It does not change what the vendor is owed.`],
  ['adjustment', 'The Adjustment of an invoice or bill is posted on the adjustment account named in Voucher files; the generated ADJ journals move it back to the Tally ledgers, so that account ends at zero.'],
];
export const POSTING_RULES = RULE_TEXT.map(([id, what]) => {
  const e = POSTING_EVIDENCE.get(id);
  return { id, what, evidence: e?.evidence || 'assumed', ...(e?.note ? { note: e.note } : {}) };
});

// ---------- the posting ----------
// files: { accounts, customers, vendors, items, opening_balances_for_zoho_accounts, invoices, bills, journals,
//          other_journals }: each a list of rows keyed by column id (columns.js: "Opening Balance" -> opening_balance).
// opts: { invoiceAdjustmentAccount, billAdjustmentAccount, taxRounding: 'line' | 'entity', journalFiles?: [key] }
// Returns { accounts: Map(key -> { name, amount, sources: { <file>: Decimal } }), receivable / payable: Map(contact key
//   -> { name, amount }), drafts: { <file>: documents }, notModelled: [text], documents: { <file>: n } }.
// Amounts carry Tally's sign: a debit is negative, a credit positive.
export function predictZohoTb(files, opts = {}) {
  const accounts = new Map(), receivable = new Map(), payable = new Map();
  const drafts = {}, documents = {}, notModelled = new Set();
  const mode = opts.taxRounding === 'entity' ? 'entity' : 'line';
  const adjAccount = { invoices: text(opts.invoiceAdjustmentAccount ?? 'Other Charges'), bills: text(opts.billAdjustmentAccount ?? 'Other Expenses') };
  // amount: Tally's sign (debit negative)
  const post = (file, account, amount, contact = '') => {
    const name = text(account);
    if (!name || amount.isZero()) return;
    const k = accountNameKey(name);
    if (!accounts.has(k)) accounts.set(k, { name, amount: ZERO, sources: {} });
    const a = accounts.get(k);
    a.amount = a.amount.plus(amount);
    a.sources[file] = (a.sources[file] || ZERO).plus(amount);
    const side = k === accountNameKey(RECEIVABLE) ? receivable : k === accountNameKey(PAYABLE) ? payable : null;
    if (side) {
      const ck = contactNameKey(contact);
      if (!side.has(ck)) side.set(ck, { name: text(contact), amount: ZERO });
      side.get(ck).amount = side.get(ck).amount.plus(amount);
    }
  };
  const debit = (file, account, amount, contact) => post(file, account, amount.negated(), contact);
  const credit = (file, account, amount, contact) => post(file, account, amount, contact);

  // ----- the balance typed in Zoho Books (the date anchor in 'typed' mode, in no file) -----
  for (const x of opts.typedOpenings || []) {
    const a = dec(x.amount);
    if (a.isZero()) continue;
    post('typed', x.account, a);
    post('typed', ZOHO_OPENING_BALANCE_ACCOUNT, a.negated());
  }
  // ----- opening balances of the master files -----
  for (const r of files.accounts || []) {
    const a = dec(r.opening_balance);
    if (a.isZero()) continue;
    const isDebit = /^debit$/i.test(text(r.debit_or_credit));
    post('accounts', r.account_name, isDebit ? a.negated() : a);
    post('accounts', ZOHO_OPENING_BALANCE_ACCOUNT, isDebit ? a : a.negated());
  }
  // a contact kept in another currency: Zoho converts the foreign opening at its Opening Balance Exchange Rate
  const fxOf = (code, rate) => { const c = text(code).toUpperCase(); return c && c !== 'INR' ? dec(rate) : null; };
  const inBase = (amount, xr) => (xr ? r2(amount.times(xr)) : amount);
  for (const r of files.customers || []) {
    const a = inBase(dec(r.opening_balance), fxOf(r.currency_code, r.opening_balance_exchange_rate));
    if (a.isZero()) continue;
    debit('customers', RECEIVABLE, a, r.display_name);
    credit('customers', ZOHO_OPENING_BALANCE_ACCOUNT, a);
  }
  for (const r of files.vendors || []) {
    const a = inBase(dec(r.opening_balance), fxOf(r.currency_code, r.opening_balance_exchange_rate));
    if (a.isZero()) continue;
    credit('vendors', PAYABLE, a, r.display_name);
    debit('vendors', ZOHO_OPENING_BALANCE_ACCOUNT, a);
  }
  // opening stock of an item: Zoho posts quantity x rate on the item's inventory account
  const itemAccounts = new Map();
  for (const r of files.items || []) {
    itemAccounts.set(text(r.item_name).toLowerCase(), { sales: text(r.account), purchase: text(r.purchase_account) });
    const stock = dec(r.initial_stock).times(dec(r.initial_stock_rate));
    if (stock.isZero()) continue;
    debit('items', text(r.inventory_account) || 'Inventory Asset', r2(stock));
    credit('items', ZOHO_OPENING_BALANCE_ACCOUNT, r2(stock));
  }

  // ----- journals: as written -----
  for (const key of opts.journalFiles || ['opening_balances_for_zoho_accounts', 'journals', 'other_journals']) {
    const seen = new Set(), draftDocs = new Set();
    for (const r of files[key] || []) {
      const number = `${text(r.journal_number_prefix)}${text(r.journal_number_suffix)}` || text(r.reference_number);
      if (isDraft(r.status)) { draftDocs.add(number); continue; }
      seen.add(number);
      // a journal in another currency: Zoho converts each line at its Exchange Rate (round 2)
      const jx = fxOf(r.currency, r.exchange_rate);
      const d = inBase(dec(r.debit), jx), c = inBase(dec(r.credit), jx);
      if (!d.isZero()) debit(key, r.account, d, r.contact_name);
      if (!c.isZero()) credit(key, r.account, c, r.contact_name);
    }
    if (seen.size) documents[key] = seen.size;
    if (draftDocs.size) drafts[key] = draftDocs.size;
  }

  // ----- invoices and bills -----
  // the parts of the tax written on a line: a Tax Group is CGST and SGST, half the rate each; a single tax is one part
  // whose head is read from its name (IGST18, CGST9...), IGST when the name does not say
  const partsOf = (name, type, rate) => {
    const n = text(name);
    if (!n) return [];
    const pct = dec(rate);
    if (/group/i.test(text(type))) return [{ head: 'CGST', rate: pct.div(2) }, { head: 'SGST', rate: pct.div(2) }];
    const head = HEADS.find(h => new RegExp(`^${h}`, 'i').test(n)) || (/^UTGST/i.test(n) ? 'SGST' : 'IGST');
    if (!HEADS.some(h => new RegExp(`^${h}`, 'i').test(n)) && !/^UTGST/i.test(n) && !pct.isZero()) notModelled.add(`The tax "${n}" does not say which GST it is: it is taken as IGST.`);
    return [{ head, rate: pct }];
  };
  // entries: [{ base, parts }] -> Map(head -> amount), rounded as Zoho does
  const taxOf = entries => {
    const out = new Map();
    const add = (h, x) => out.set(h, (out.get(h) || ZERO).plus(x));
    if (mode === 'entity') {
      const sums = new Map();
      for (const e of entries) for (const p of e.parts) { const k = `${p.head}|${p.rate}`; sums.set(k, { head: p.head, sum: (sums.get(k)?.sum || ZERO).plus(e.base.times(p.rate).div(100)) }); }
      for (const s of sums.values()) add(s.head, r2(s.sum));
    } else for (const e of entries) for (const p of e.parts) add(p.head, r2(e.base.times(p.rate).div(100)));
    return out;
  };
  const groupDocs = (rows, keyOf) => { const m = new Map(); for (const r of rows || []) { const k = keyOf(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; };
  const sum = list => list.reduce((t, x) => t.plus(x), ZERO);
  const lineBase = (r, price, inclusive, rate) => {
    let amount = r2(dec(r.quantity || 1).times(price));
    const disc = dec(r.discount_amount);
    if (!disc.isZero()) amount = amount.minus(disc);
    if (inclusive && !rate.isZero()) amount = r2(amount.div(new Decimal(1).plus(rate.div(100))));
    return amount;
  };

  // the lines of a document in another currency, in rupees: Zoho Books converts the document total at the rate (fx x rate,
  // rounded to the paisa); each line is converted and rounded, and the last line takes the paisa the rounding leaves, so
  // the lines add up to the converted total (ASSUMED: how Zoho spreads the rounding over the accounts of the lines is not
  // known; the total on Accounts Receivable / Payable is). Tax on such a document is not modelled.
  const forexLines = (fxBases, xr) => {
    if (!xr) return fxBases;
    const total = r2(sum(fxBases).times(xr));
    const out = fxBases.map(b => r2(b.times(xr)));
    if (out.length) out[out.length - 1] = out[out.length - 1].plus(total.minus(sum(out)));
    return out;
  };
  const invoiceDocs = groupDocs(files.invoices, r => text(r.invoice_number));
  let nInv = 0, dInv = 0;
  for (const rows of invoiceDocs.values()) {
    const h = rows[0];
    if (isDraft(h.invoice_status)) { dInv++; continue; }
    nInv++;
    const taxEntries = [];
    let lines = ZERO;
    // an invoice in another currency: Zoho converts its total at the Exchange Rate (forexLines)
    const xr = fxOf(h.currency_code, h.exchange_rate);
    const bases = forexLines(rows.map(r => lineBase(r, dec(r.item_price), yes(r.is_inclusive_tax), dec(r.item_tax_percent))), xr);
    for (const [i, r] of rows.entries()) {
      const parts = partsOf(r.item_tax, r.item_tax_type, r.item_tax_percent);
      const base = bases[i];
      const account = text(r.account) || itemAccounts.get(text(r.item_name).toLowerCase())?.sales || 'Sales';
      credit('invoices', account, base);
      lines = lines.plus(base);
      if (parts.length) taxEntries.push({ base, parts });
      if (xr && parts.length) notModelled.add('An invoice in another currency carries tax: Zoho works the tax out in that currency; it is taken here from the rupee value of the line.');
      if (text(r.reverse_charge_tax_name)) notModelled.add('An invoice carries reverse charge: its tax is not charged to the customer and is not posted here.');
    }
    const tax = taxOf(taxEntries);
    for (const [head, x] of tax) credit('invoices', outputOf(head), x);
    const ship = dec(h.shipping_charge);
    if (!ship.isZero()) { credit('invoices', 'Shipping Charge', ship); if (text(h.shipping_charge_tax_name)) notModelled.add('A shipping charge carries tax: that tax is not posted here.'); }
    const entityDiscount = dec(h.entity_discount_amount);
    if (!entityDiscount.isZero() || !dec(h.entity_discount_percent).isZero()) notModelled.add('An invoice carries a discount on the whole invoice: it is not posted here.');
    const adj = dec(h.adjustment);
    if (!adj.isZero()) { if (adjAccount.invoices) credit('invoices', adjAccount.invoices, adj); else notModelled.add('An invoice has an Adjustment and no invoice adjustment account is set in Voucher files.'); }
    const tds = dec(h.tds_amount);
    if (!tds.isZero()) debit('invoices', ZOHO_TAX_POSTING_ACCOUNTS.tdsReceivable, tds);
    const tcs = dec(h.tcs_amount);
    if (!tcs.isZero()) { credit('invoices', text(h.tcs_payable_account) || 'TCS Payable', tcs); }
    const total = lines.plus(sum([...tax.values()])).plus(ship).plus(adjAccount.invoices ? adj : ZERO).minus(tds).plus(tcs);
    debit('invoices', RECEIVABLE, total, h.customer_name);
  }
  if (nInv) documents.invoices = nInv;
  if (dInv) drafts.invoices = dInv;

  const billDocs = groupDocs(files.bills, r => `${text(r.bill_number)}\u0001${contactNameKey(r.vendor_name)}`);
  let nBill = 0, dBill = 0;
  for (const rows of billDocs.values()) {
    const h = rows[0];
    if (isDraft(h.bill_status)) { dBill++; continue; }
    nBill++;
    const taxEntries = [], rcEntries = [];
    let lines = ZERO, addedToLines = ZERO;
    const xr = fxOf(h.currency_code, h.exchange_rate);
    const bases = forexLines(rows.map(r => lineBase(r, dec(r.rate), yes(r.is_inclusive_tax), dec(r.tax_percentage))), xr);
    for (const [i, r] of rows.entries()) {
      const parts = partsOf(r.tax_name, r.tax_type, r.tax_percentage);
      const base = bases[i];
      const account = text(r.account) || itemAccounts.get(text(r.item_name).toLowerCase())?.purchase || 'Cost of Goods Sold';
      debit('bills', account, base);
      lines = lines.plus(base);
      if (xr && parts.length) notModelled.add('A bill in another currency carries tax: Zoho works the tax out in that currency; it is taken here from the rupee value of the line.');
      if (parts.length) {
        // tax with no input credit is a cost of the line, not an input tax
        if (/ineligible|not eligible/i.test(text(r.itc_eligibility))) { const x = sum([...taxOf([{ base, parts }]).values()]); debit('bills', account, x); addedToLines = addedToLines.plus(x); }
        else taxEntries.push({ base, parts });
      }
      const rc = partsOf(r.reverse_charge_tax_name, r.reverse_charge_tax_type, r.reverse_charge_tax_rate);
      if (rc.length) rcEntries.push({ base, parts: rc });
    }
    const tax = taxOf(taxEntries);
    for (const [head, x] of tax) debit('bills', inputOf(head), x);
    // reverse charge: a debit and a credit of the same amount, nothing for the vendor
    for (const [head, x] of taxOf(rcEntries)) { debit('bills', ZOHO_TAX_POSTING_ACCOUNTS.rcmInput, x); credit('bills', outputOf(head), x); }
    if (!dec(h.entity_discount_amount).isZero()) notModelled.add('A bill carries a discount on the whole bill: it is not posted here.');
    const adj = dec(h.adjustment);
    if (!adj.isZero()) { if (adjAccount.bills) debit('bills', adjAccount.bills, adj); else notModelled.add('A bill has an Adjustment and no bill adjustment account is set in Voucher files.'); }
    const tds = dec(h.tds_amount);
    if (!tds.isZero()) credit('bills', ZOHO_TAX_POSTING_ACCOUNTS.tdsPayable, tds);
    const tcs = dec(h.tcs_amount);
    if (!tcs.isZero()) debit('bills', 'TCS Receivable', tcs);
    const total = lines.plus(addedToLines).plus(sum([...tax.values()])).plus(adjAccount.bills ? adj : ZERO).minus(tds).plus(tcs);
    credit('bills', PAYABLE, total, h.vendor_name);
  }
  if (nBill) documents.bills = nBill;
  if (dBill) drafts.bills = dBill;

  return { accounts, receivable, payable, drafts, documents, notModelled: [...notModelled] };
}

// ---------- the comparison with Tally ----------
const sideWords = d => (d.isZero() ? '' : d.isNegative() ? 'Debit' : 'Credit');
const fig = d => ({ amount: d.abs().toFixed(2), side: sideWords(d), signed: d.toFixed(2) });
const FILE_WORDS = { typed: 'The one opening balance typed in Zoho Books (Save the Migration Date)', accounts: 'Chart of Accounts (opening balances)', customers: 'Customers (opening balances)', vendors: 'Vendors (opening balances)', items: 'Items (opening stock)',
  opening_balances_for_zoho_accounts: 'Opening balance journal', invoices: 'Invoices', bills: 'Bills', journals: 'Manual Journals', other_journals: 'Journals of receipts, payments and contra' };
const sourcesOf = a => Object.entries(a?.sources || {}).filter(([, x]) => !x.isZero()).map(([file, x]) => ({ file, label: FILE_WORDS[file] || file, ...fig(x) }));

// predicted: predictZohoTb(). tally: [{ ledger, amount (Decimal, Tally's sign), zohoName, how, contact?: 'customers' |
// 'vendors', contactName? }] (the ledger lines of Tally's trial balance under the names the files give them).
// zeroAccounts: [{ account, role }] the accounts that must end at zero when no Tally ledger is entered on them.
// Returns { agrees, counts, accounts: { matched, differing, onlyTally, onlyZoho }, contacts: { customers, vendors },
//   mustBeZero, totals }.
export function compareWithTally(predicted, tally, { zeroAccounts = [] } = {}) {
  const t = new Map();
  for (const e of tally) {
    const k = accountNameKey(e.zohoName);
    if (!t.has(k)) t.set(k, { name: e.zohoName, amount: ZERO, ledgers: [] });
    const x = t.get(k); x.amount = x.amount.plus(e.amount); x.ledgers.push(e.ledger);
  }
  const matched = [], differing = [], onlyTally = [], onlyZoho = [];
  for (const [k, x] of t) {
    const p = predicted.accounts.get(k);
    const row = { account: x.name, tallyLedgers: x.ledgers.slice(0, 20), ledgerCount: x.ledgers.length, tally: fig(x.amount) };
    if (!p) { if (x.amount.isZero()) matched.push({ ...row, zoho: fig(ZERO) }); else onlyTally.push({ ...row, zoho: fig(ZERO), difference: fig(x.amount.negated()), rounding: x.amount.abs().lte(ROUNDING_LIMIT) }); continue; }
    const z = { ...row, zohoAccount: p.name, zoho: fig(p.amount), sources: sourcesOf(p) };
    if (p.amount.equals(x.amount)) matched.push(z);
    else { const d = p.amount.minus(x.amount); differing.push({ ...z, difference: fig(d), rounding: d.abs().lte(ROUNDING_LIMIT) }); }
  }
  for (const [k, p] of predicted.accounts) {
    if (t.has(k) || p.amount.isZero()) continue;
    onlyZoho.push({ account: p.name, zoho: fig(p.amount), sources: sourcesOf(p), zohoOwn: !!builtinAccount(p.name), rounding: p.amount.abs().lte(ROUNDING_LIMIT) });
  }
  // ----- contact by contact -----
  const contacts = {};
  for (const [side, map, label] of [['customers', predicted.receivable, RECEIVABLE], ['vendors', predicted.payable, PAYABLE]]) {
    const want = new Map();
    for (const e of tally) {
      if (e.contact !== side) continue;
      const k = contactNameKey(e.contactName ?? e.ledger);
      if (!want.has(k)) want.set(k, { name: text(e.contactName ?? e.ledger), amount: ZERO });
      want.get(k).amount = want.get(k).amount.plus(e.amount);
    }
    const diff = [];
    let same = 0;
    for (const [k, w] of want) {
      const p = map.get(k)?.amount || ZERO;
      if (p.equals(w.amount)) same++;
      else diff.push({ contact: w.name, tally: fig(w.amount), zoho: fig(p), difference: fig(p.minus(w.amount)), rounding: p.minus(w.amount).abs().lte(ROUNDING_LIMIT) });
    }
    for (const [k, p] of map) if (!want.has(k) && !p.amount.isZero()) diff.push({ contact: p.name || '(no contact named)', tally: fig(ZERO), zoho: fig(p.amount), difference: fig(p.amount), notInTally: true, rounding: p.amount.abs().lte(ROUNDING_LIMIT) });
    diff.sort((a, b) => new Decimal(b.difference.amount).comparedTo(a.difference.amount) || a.contact.localeCompare(b.contact));
    contacts[side] = { account: label, compared: want.size, same, differing: diff.length, rows: diff };
  }
  // ----- the accounts that must end at zero (unless a Tally ledger is entered on them: then Tally's figure) -----
  const mustBeZero = [];
  const seenZero = new Set();
  for (const z of zeroAccounts) {
    const k = accountNameKey(z.account);
    if (!text(z.account) || seenZero.has(k)) continue;
    seenZero.add(k);
    const p = predicted.accounts.get(k)?.amount || ZERO, w = t.get(k)?.amount || ZERO;
    mustBeZero.push({ account: z.account, role: z.role, words: z.words || '', predicted: fig(p), expected: fig(w), ok: p.equals(w), sources: sourcesOf(predicted.accounts.get(k)) });
  }
  const byAmount = (a, b) => new Decimal(b.difference?.amount ?? b.zoho?.amount ?? 0).comparedTo(a.difference?.amount ?? a.zoho?.amount ?? 0) || a.account.localeCompare(b.account);
  const total = list => list.reduce((s, x) => s.plus(x), ZERO);
  const pAll = [...predicted.accounts.values()].map(a => a.amount);
  const tAll = [...t.values()].map(a => a.amount);
  const sides = list => ({ debit: total(list.filter(x => x.isNegative())).abs().toFixed(2), credit: total(list.filter(x => !x.isNegative())).toFixed(2) });
  const counts = { matched: matched.length, differing: differing.length, onlyTally: onlyTally.length, onlyZoho: onlyZoho.length,
    rounding: [...differing, ...onlyTally, ...onlyZoho].filter(r => r.rounding).length,
    contactsDiffering: contacts.customers.differing + contacts.vendors.differing, mustBeZeroOpen: mustBeZero.filter(z => !z.ok).length };
  return { agrees: !counts.differing && !counts.onlyTally && !counts.onlyZoho && !counts.contactsDiffering && !counts.mustBeZeroOpen, counts,
    accounts: { matched: matched.sort((a, b) => a.account.localeCompare(b.account)), differing: differing.sort(byAmount), onlyTally: onlyTally.sort(byAmount), onlyZoho: onlyZoho.sort(byAmount) },
    contacts, mustBeZero,
    totals: { zoho: { ...sides(pAll), balanced: total(pAll).isZero() }, tally: { ...sides(tAll), balanced: total(tAll).isZero() } } };
}

// The comparison as a CSV for the folder not_for_import of the zip (never imported).
const csvCell = v => { const s = String(v ?? ''); const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; };
export const PREDICTED_FILE = 'predicted_trial_balance.csv';
export function predictedCsv(result) {
  const lines = [['Part', 'Account or contact', 'Tally closing', 'Tally side', 'Zoho Books expected', 'Zoho side', 'Difference', 'Difference side', 'Result', 'Tally ledgers', 'Comes from'].map(csvCell).join(',')];
  const c = result.comparison;
  const row = (part, name, r, outcome) => lines.push([part, name, r.tally?.amount ?? '0.00', r.tally?.side ?? '', r.zoho?.amount ?? '0.00', r.zoho?.side ?? '', r.difference?.amount ?? '0.00', r.difference?.side ?? '', outcome,
    (r.tallyLedgers || []).join('; '), (r.sources || []).map(s => `${s.label} ${s.amount} ${s.side}`).join('; ')].map(csvCell).join(','));
  // a difference a refused document causes says so in the Result cell (SYN-4)
  const why = r => (r.reasons?.length ? `: ${r.reasons.join('; ')}` : '');
  const words = r => `${r.rounding ? 'Differs (rounding)' : 'Differs'}${why(r)}`;
  for (const r of c.accounts.differing) row('Account', r.account, r, words(r));
  for (const r of c.accounts.onlyTally) row('Account', r.account, r, `In Tally only${why(r)}`);
  for (const r of c.accounts.onlyZoho) row('Account', r.account, { ...r, difference: r.zoho }, `In Zoho Books only${why(r)}`);
  for (const side of ['customers', 'vendors']) for (const r of c.contacts[side].rows) row(side === 'customers' ? 'Customer' : 'Vendor', r.contact, r, r.notInTally ? `In Zoho Books only${why(r)}` : words(r));
  for (const r of c.accounts.matched) row('Account', r.account, r, r.merged ? `Same (${r.ledgerCount > 1 ? `${r.ledgerCount} Tally ledgers` : 'a Tally ledger of another name'} entered on this Zoho account)` : 'Same');
  return `${lines.join('\r\n')}\r\n`;
}

// ---------- for one migration ----------
// deps: { db, fileLayout(db, jobId, key), settings(jobId) -> voucher settings, tallySide(jobId) -> { entries, notCompared,
//         problem } (zohotb.js: the ledger lines of Tally's trial balance under their Zoho names), contactName(jobId)
//         -> (Tally ledger) => the name the files write for it | null, held(jobId) -> { notInAnyFile } | null }
const FILE_KEYS = ['accounts', 'customers', 'vendors', 'items', 'opening_balances_for_zoho_accounts', 'invoices', 'bills', 'journals', 'other_journals'];
export function predictedTrialBalance(db, jobId, deps) {
  const have = new Set(db.prepare('SELECT key FROM generated_files WHERE job_id = ?').all(jobId).map(f => f.key));
  if (!FILE_KEYS.some(k => have.has(k))) return { available: false, message: 'Create the files first: the expected trial balance is worked out from them.' };
  const files = {};
  for (const key of FILE_KEYS) {
    if (!have.has(key)) continue;
    const layout = deps.fileLayout(db, jobId, key);
    files[key] = db.prepare('SELECT row_no, row_data FROM generated_rows WHERE job_id = ? AND key = ? ORDER BY row_no').all(jobId, key).map(g => layout.values(g));
  }
  // the documents and rows the Zoho check expects Zoho Books to refuse are not posted (SYN-4): a refused invoice, bill or
  // journal is not in Zoho Books after the import, so it is left out here and said under leftOut
  const refusedLeftOut = [];
  // deps.checked: ONE run of the Zoho check on the files as they are (zohocheckapi.js checkedRows): the rows Zoho will
  // refuse and the rows it may refuse, each with its rules. deps.refused (older callers): the refused rows only.
  let checked = null;
  try { checked = deps.checked ? deps.checked(jobId) : null; } catch { checked = null; }
  if (!checked) { let r = {}; try { r = deps.refused ? deps.refused(jobId) || {} : {}; } catch { r = {}; } checked = { refused: r, may: {}, rules: { refused: {}, may: {} } }; }
  const refused = checked.refused || {};
  const DOC_KEY = {
    invoices: [r => text(r.invoice_number), r => text(r['Invoice Number'])],
    bills: [r => `${text(r.bill_number)}${contactNameKey(r.vendor_name)}`, r => `${text(r['Bill Number'])}${contactNameKey(r['Vendor Name'])}`],
    journals: [r => `${text(r.journal_number_prefix)}${text(r.journal_number_suffix)}` || text(r.reference_number), r => `${text(r['Journal Number Prefix'])}${text(r['Journal Number Suffix'])}` || text(r['Reference Number'])],
    customers: [r => contactNameKey(r.display_name), r => contactNameKey(r['Display Name'])],
    vendors: [r => contactNameKey(r.display_name), r => contactNameKey(r['Display Name'])],
    accounts: [r => accountNameKey(text(r.account_name)), r => accountNameKey(text(r['Account Name']))],
  };
  DOC_KEY.other_journals = DOC_KEY.journals; DOC_KEY.opening_balances_for_zoho_accounts = DOC_KEY.journals;
  // the words for one document (its number as the file writes it; a bill with its vendor; a master record by its name)
  const LABEL = {
    invoices: r => text(r['Invoice Number']), bills: r => `${text(r['Bill Number'])} (${text(r['Vendor Name'])})`,
    journals: r => `${text(r['Journal Number Prefix'])}${text(r['Journal Number Suffix'])}` || text(r['Reference Number']),
    customers: r => text(r['Display Name']), vendors: r => text(r['Display Name']), accounts: r => text(r['Account Name']),
  };
  LABEL.other_journals = LABEL.journals; LABEL.opening_balances_for_zoho_accounts = LABEL.journals;
  // per file: document key -> { label, rules } of the documents of one tier
  const docsOf = side => {
    const out = {};
    for (const [key, rows] of Object.entries(checked[side] || {})) {
      const k = DOC_KEY[key];
      if (!k || !rows?.length) continue;
      const m = new Map();
      rows.forEach((r, i) => {
        const id = k[1](r);
        if (!m.has(id)) m.set(id, { label: (LABEL[key] || k[1])(r) || id, rules: new Set() });
        for (const rule of checked.rules?.[side]?.[key]?.[i] || []) m.get(id).rules.add(rule);
      });
      out[key] = m;
    }
    return out;
  };
  const refusedDocs = docsOf('refused'), mayDocs = docsOf('may');
  const settingsEarly = deps.settings ? deps.settings(jobId) || {} : {};
  const predictOpts = { invoiceAdjustmentAccount: settingsEarly.invoiceAdjustmentAccount, billAdjustmentAccount: settingsEarly.billAdjustmentAccount, taxRounding: settingsEarly.zohoTaxRounding };
  // what each refused document would have posted: the accounts and contacts it touches get its reason (SYN-4), so a
  // difference it causes is never unexplained. reasons: { accounts: Map key -> [words], customers / vendors: Map key -> [words] }
  const reasons = { accounts: new Map(), customers: new Map(), vendors: new Map() };
  const addReason = (map, k, words) => { if (!map.has(k)) map.set(k, []); if (!map.get(k).includes(words)) map.get(k).push(words); };
  const refusedList = [];
  for (const [key, rows] of Object.entries(refused)) {
    const k = DOC_KEY[key];
    if (!k || !files[key] || !rows?.length) continue;
    const gone = new Set(rows.map(k[1]));
    const before = files[key].length;
    const docs = new Set(files[key].filter(r => gone.has(k[0](r))).map(k[0]));
    // the rows of each refused document, as the posting model reads them
    const byDoc = new Map();
    for (const r of files[key]) { const id = k[0](r); if (gone.has(id)) { if (!byDoc.has(id)) byDoc.set(id, []); byDoc.get(id).push(r); } }
    files[key] = files[key].filter(r => !gone.has(k[0](r)));
    for (const [id, docRows] of byDoc) {
      const info = refusedDocs[key]?.get(id) || { label: id, rules: new Set() };
      const rules = [...info.rules].sort();
      const words = `${FILE_WORDS[key] || key} ${info.label} will be refused by Zoho Books${rules.length ? ` (${rules.join(', ')})` : ''}, so it is not in these figures`;
      refusedList.push({ file: key, label: FILE_WORDS[key] || key, document: info.label, rules });
      let p = null;
      try { p = predictZohoTb({ [key]: docRows }, predictOpts); } catch { p = null; }
      if (!p) continue;
      for (const [ak, a] of p.accounts) if (!a.amount.isZero()) addReason(reasons.accounts, ak, words);
      for (const [ck, c] of p.receivable) if (!c.amount.isZero()) addReason(reasons.customers, ck, words);
      for (const [ck, c] of p.payable) if (!c.amount.isZero()) addReason(reasons.vendors, ck, words);
      // a refused master record (an account, a customer, a vendor) carries its own opening balance
      if (['customers', 'vendors', 'accounts'].includes(key)) addReason(reasons[key], key === 'accounts' ? accountNameKey(info.label) : contactNameKey(info.label), words);
    }
    if (files[key].length < before) {
      const names = [...byDoc.keys()].map(id => refusedDocs[key]?.get(id)?.label || id);
      refusedLeftOut.push(`${docs.size} ${docs.size === 1 ? 'record' : 'records'} of ${FILE_WORDS[key] || key} that the Zoho check expects Zoho Books to refuse (${names.slice(0, 20).join(', ')}${names.length > 20 ? ', and more' : ''}): ${docs.size === 1 ? 'it is' : 'they are'} not in these figures, so the accounts ${docs.size === 1 ? 'it uses' : 'they use'} will differ from Tally until ${docs.size === 1 ? 'it is' : 'they are'} corrected and imported.`);
    }
  }
  // the documents the check says Zoho MAY refuse: posted (Zoho may well take them), but listed with their rules, so a
  // figure that rests on them is never read as certain
  const mayBeRefused = Object.entries(mayDocs).flatMap(([key, m]) => (files[key] ? [...m.values()].map(d => ({ file: key, label: FILE_WORDS[key] || key, document: d.label, rules: [...d.rules].sort() })) : []));
  const settings = settingsEarly;
  let typed = null;
  try { typed = deps.typedOpening ? deps.typedOpening(jobId) : null; } catch { typed = null; }
  const predicted = predictZohoTb(files, { ...predictOpts, typedOpenings: typed ? [typed] : [] });
  const t = deps.tallySide ? deps.tallySide(jobId) : { problem: 'The Tally Trial Balance report has not been read yet.' };
  const base = { available: true, basis: 'closing', files: FILE_KEYS.filter(k => have.has(k)).map(k => ({ key: k, label: FILE_WORDS[k], documents: predicted.documents[k] ?? null })),
    drafts: predicted.drafts, notModelled: predicted.notModelled, postingRules: POSTING_RULES,
    zohoAccounts: [...predicted.accounts.values()].filter(a => !a.amount.isZero()).length,
    // the documents left out because Zoho will refuse them, and those posted although Zoho may refuse them (the Zoho check)
    refusedDocuments: refusedList, mayBeRefused };
  let held = null;
  try { held = deps.held ? deps.held(jobId) : null; } catch { held = null; }
  // Round 1 (issue 2): vouchers Tally posted in the year that are left out of the files with a reason
  let leftOutPosted = [];
  try { leftOutPosted = deps.leftOutPosted ? deps.leftOutPosted(jobId) || [] : []; } catch { leftOutPosted = []; }
  const leftOutWords = v => `${v.type} ${v.number} is left out of the files (${v.why}), so it is not in these figures`;
  const leftOut = [
    ...refusedLeftOut,
    ...leftOutPosted.map(v => `${leftOutWords(v)}: the accounts it uses (${[...new Set(v.lines.map(l => l.ledger))].slice(0, 6).join(', ')}) will differ from Tally until it is corrected in Tally and imported.`),
    ...Object.entries(predicted.drafts).map(([k, n]) => `${n} draft ${n === 1 ? 'document' : 'documents'} in ${FILE_WORDS[k] || k}: Zoho Books posts a draft only when it is published, so ${n === 1 ? 'it is' : 'they are'} not in these figures.`),
    ...(held?.notInAnyFile ? [`${held.notInAnyFile} ${held.notInAnyFile === 1 ? 'voucher is' : 'vouchers are'} in no file, so ${held.notInAnyFile === 1 ? 'it is' : 'they are'} not in these figures: the accounts ${held.notInAnyFile === 1 ? 'it uses' : 'they use'} will differ from Tally until ${held.notInAnyFile === 1 ? 'it is' : 'they are'} entered.`] : []),
  ];
  base.leftOutVouchers = leftOutPosted.map(v => ({ type: v.type, number: v.number, why: v.why, ledgers: [...new Set(v.lines.map(l => l.ledger))] }));
  if (t.problem) return { ...base, comparison: null, problem: t.problem, leftOut, words: `${t.problem} The expected Zoho Books balances are worked out, but there is nothing to compare them with.` };
  const nameOf = (() => { try { return deps.contactName ? deps.contactName(jobId) : null; } catch { return null; } })();
  // each line of a left-out voucher gives its reason to the Zoho account (and the contact) its Tally ledger is compared on
  if (leftOutPosted.length) {
    const entryOf = new Map(t.entries.map(e => [String(e.ledger).trim(), e]));
    for (const v of leftOutPosted) {
      const words = leftOutWords(v);
      for (const l of v.lines) {
        const e = entryOf.get(String(l.ledger).trim());
        if (!e) { addReason(reasons.accounts, accountNameKey(l.ledger), words); continue; }
        if (e.zohoName) addReason(reasons.accounts, accountNameKey(e.zohoName), words);
        if (e.how === 'customer' || e.how === 'vendor') addReason(reasons[e.how === 'customer' ? 'customers' : 'vendors'], contactNameKey((nameOf ? nameOf(e.ledger) : null) ?? e.ledger), words);
      }
    }
  }
  const tally = t.entries.map(e => {
    const contact = e.how === 'customer' ? 'customers' : e.how === 'vendor' ? 'vendors' : null;
    return { ledger: e.ledger, amount: e.amount, zohoName: e.zohoName, how: e.how, contact, contactName: contact ? (nameOf ? nameOf(e.ledger) : null) ?? e.ledger : undefined };
  });
  const zeroAccounts = [
    { account: ZOHO_OPENING_BALANCE_ACCOUNT, role: 'opening_balance_adjustments', words: 'Zoho Books puts the other side of every opening balance here. With every opening balance in the files it ends at zero.' },
    { account: text(settings.invoiceAdjustmentAccount ?? 'Other Charges'), role: 'invoice_adjustment', words: 'Zoho Books posts the Adjustment of an invoice here. The generated ADJ journals move it back to the Tally ledgers.' },
    { account: text(settings.billAdjustmentAccount ?? 'Other Expenses'), role: 'bill_adjustment', words: 'Zoho Books posts the Adjustment of a bill here. The generated ADJ journals move it back to the Tally ledgers.' },
  ];
  const comparison = compareWithTally(predicted, tally, { zeroAccounts });
  // every account and contact a refused document touches says so (SYN-4): the difference has its reason
  const reasonOf = (map, k) => map.get(k) || null;
  for (const r of [...comparison.accounts.differing, ...comparison.accounts.onlyTally, ...comparison.accounts.onlyZoho]) {
    const why = reasonOf(reasons.accounts, accountNameKey(r.account)) || (r.zohoAccount ? reasonOf(reasons.accounts, accountNameKey(r.zohoAccount)) : null);
    if (why) r.reasons = why;
  }
  for (const side of ['customers', 'vendors']) for (const r of comparison.contacts[side].rows) { const why = reasonOf(reasons[side], contactNameKey(r.contact)); if (why) r.reasons = why; }
  // Tally's Profit & Loss A/c is not an account in Zoho Books: its balance is entered on Zoho's own equity account.
  // When exactly that amount is the only thing on a Zoho account Tally does not have, the two are the same figure.
  const notCompared = (t.notCompared || []).map(n => ({ ...n }));
  for (const n of notCompared) {
    if (!n.amount) continue;
    const i = comparison.accounts.onlyZoho.findIndex(z => z.zoho.signed === n.amount.signed);
    if (i < 0) continue;
    const z = comparison.accounts.onlyZoho.splice(i, 1)[0];
    comparison.accounts.matched.push({ account: z.account, tallyLedgers: [n.ledger], ledgerCount: 1, tally: n.amount, zohoAccount: z.account, zoho: z.zoho, sources: z.sources, note: `Tally's "${n.ledger}" is entered on this account of Zoho Books.` });
    n.pairedWith = z.account;
    comparison.counts.onlyZoho--; comparison.counts.matched++;
    if (z.rounding) comparison.counts.rounding--;
  }
  // TDS-016: the Zoho accounts that carry Tally ledgers of other names (several TDS ledgers on TDS Payable, a GST ledger
  // on Output CGST ...): the comparison is made through these merges, so they are listed, never hidden in "same"
  // (Accounts Receivable and Accounts Payable carry the customers and vendors, which are compared one by one: not a merge)
  const isMerge = r => ![RECEIVABLE, PAYABLE].some(x => accountNameKey(x) === accountNameKey(r.account)) && ((r.ledgerCount || 0) > 1 || ((r.tallyLedgers || []).length === 1 && accountNameKey(r.tallyLedgers[0]) !== accountNameKey(r.account)));
  for (const r of [...comparison.accounts.matched, ...comparison.accounts.differing]) if (isMerge(r)) r.merged = true;
  const merged = [...comparison.accounts.matched, ...comparison.accounts.differing].filter(r => r.merged)
    .map(r => ({ account: r.account, tallyLedgers: r.tallyLedgers, ledgerCount: r.ledgerCount ?? (r.tallyLedgers || []).length, same: comparison.accounts.matched.includes(r) }));
  // round 1 (issue 1): a Tally line no file creates, with a balance that no Zoho account carries, is a difference too
  const notComparedOpen = notCompared.filter(n => n.amount && !new Decimal(n.amount.signed).isZero() && !n.pairedWith);
  comparison.counts.notComparedWithBalance = notComparedOpen.length;
  comparison.agrees = !notComparedOpen.length && !comparison.counts.differing && !comparison.counts.onlyTally && !comparison.counts.onlyZoho && !comparison.counts.contactsDiffering && !comparison.counts.mustBeZeroOpen;
  const c = comparison.counts;
  const real = c.differing + c.onlyTally + c.onlyZoho - c.rounding;
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const words = comparison.agrees
    ? `Worked out from the files: Zoho Books should show the same closing balance as Tally on every account (${plural(c.matched, 'account')}) and for every customer and vendor.${leftOut.length ? ' But see what is left out below.' : ''}`
    : `Worked out from the files: Zoho Books would differ from Tally on ${plural(c.differing + c.onlyTally + c.onlyZoho, 'account')}${c.rounding ? ` (${c.rounding} of them by a rupee or less: rounding)` : ''}${c.contactsDiffering ? ` and for ${plural(c.contactsDiffering, 'customer or vendor', 'customers and vendors')}` : ''}. ${real > 0 || c.contactsDiffering ? 'Look at each one before you import: the list says which file it comes from.' : 'Only rounding differences are left.'}`;
  const notComparedWords = notComparedOpen.length ? ` ${plural(notComparedOpen.length, 'Tally line')} that no file creates ${notComparedOpen.length === 1 ? 'carries' : 'carry'} a balance Zoho Books will not have: ${notComparedOpen.slice(0, 5).map(n => `${n.ledger} ${n.amount.amount} ${n.amount.side}`).join('; ')} (see notCompared).` : '';
  // documents posted although the Zoho check says Zoho Books may refuse them: the figures rest on them
  const mayWords = mayBeRefused.length ? ` ${plural(mayBeRefused.length, 'document')} the Zoho check says Zoho Books may refuse (not proven either way) ${mayBeRefused.length === 1 ? 'is' : 'are'} counted in these figures; if Zoho refuses ${mayBeRefused.length === 1 ? 'it' : 'one'}, the accounts it uses will differ (see mayBeRefused).` : '';
  const mergedWords = merged.length ? ` ${plural(merged.length, 'Zoho account')} ${merged.length === 1 ? 'carries' : 'carry'} Tally ledgers of another name (for example ${merged.slice(0, 3).map(m => `${m.account}: ${m.tallyLedgers.slice(0, 3).join(', ')}${m.ledgerCount > 3 ? ', ...' : ''}`).join('; ')}); the comparison is made through these merges (see merged), so a balance Tally keeps per ledger is one balance in Zoho Books.` : '';
  return { ...base, comparison, merged, notCompared, groupLinesNotCompared: t.groupLines || [], tallyAtLedgerLevel: t.atLedgerLevel ?? null, leftOut, words: `${words}${notComparedWords}${mayWords}${mergedWords}` };
}

// ---------- routes ----------
export function registerPredictedTb(app, deps) {
  const { db, need } = deps;
  const view = jobId => predictedTrialBalance(db, jobId, deps);
  app.get('/api/migrations/:id/predicted-trial-balance', (req, reply) => { const job = need(req, reply); if (!job) return; return view(job.id); });
  app.get('/api/migrations/:id/predicted-trial-balance.csv', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const r = view(job.id);
    if (!r.available || !r.comparison) return reply.code(409).send({ error: r.message || r.problem || 'The expected trial balance cannot be worked out yet.' });
    if (deps.audit) deps.audit(job.id, 'download', `the expected Zoho Books trial balance compared with Tally (${PREDICTED_FILE})`);
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${PREDICTED_FILE}"`).send(predictedCsv(r));
  });
  return { predictedTbView: view };
}
