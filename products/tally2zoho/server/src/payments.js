// Receipt, Payment, Contra, Debit Note and Credit Note vouchers: where each goes in Zoho Books (item 8).
//
// The rule for every Zoho module: a file is built only from Zoho's own import sample. The samples in zoho-samples/
// cover Customers, Vendors, Chart of Accounts, Items, Invoices, Bills and Manual Journals. There is NO sample for
// Payments Received (customer payments), Payments Made (vendor payments), Vendor Credits or Credit Notes, so no column
// of those files is invented: they are not built. The vouchers that belong in them are held, counted in the voucher
// control total as "waiting for a Zoho sample", listed with the sample that is needed, and their bill-wise allocations
// are worked out now (which invoice or bill each amount would be applied to), so the file can be built as soon as the
// sample is added.
//
// What does have a sample (sample_journals.xls) is used:
//   - Contra vouchers (bank and cash transfers) are Manual Journals;
//   - a Payment that is not to a vendor (expenses, salaries, taxes, transfers) and a Receipt that is not from a customer
//     (loans, income, refunds) cannot be a vendor or customer payment: they are Manual Journals;
//   - a Debit Note whose party is not a vendor, and a Credit Note whose party is not a customer, are Manual Journals;
//   - anything whose pattern is not clear (two parties, no bank or cash ledger, a party on the unexpected side) is a
//     Manual Journal too, flagged with what was seen, because a journal posts exactly what Tally posted.
// These journals go to their own file (journals_receipts_payments_contra.csv, the journal sample's layout), with the
// Tally voucher type in the journal number (RCT-, PMT-, CTR-, DN-, CN-), because Tally numbers each voucher type on its
// own: "Payment 12" and "Contra 12" would otherwise be read by Zoho Books as one journal.
//
// THE ROUTE OF CUSTOMER AND VENDOR PAYMENTS AND NOTES (setting paymentsRoute, vouchers.js):
//   'journals' (the default): every voucher that belongs in one of the four modules without a sample is written NOW as
//     a Manual Journal in journals_receipts_payments_contra.csv: the party on Accounts Receivable or Accounts Payable
//     with the Contact Name, the bank and every other line exactly as Tally posted them. Zoho Books accepted these
//     shapes in test imports. Nothing is held, so the trial balance can match Tally. Zoho keeps the party line as a
//     credit of the contact; which invoice or bill it settles (Tally's bill-wise allocations) is listed in
//     credits_to_apply.csv (not for import), and the Import Wizard has a page for applying them.
//   'module_files': the vouchers are held for the Payments Received / Payments Made files built from Zoho's own sample
//     (heldfiles.js), as described above. A voucher is in exactly ONE of the two routes, never both.
//
// Nothing here changes a Tally value. Money is decimal.js; Tally debits are negative.

import Decimal from 'decimal.js';
import { money, ledgerEntryList, tallyText, matchKey, isoDate } from './tally.js';

export const MONEY_SLOTS = ['receipt', 'payment', 'contra', 'debit_note', 'credit_note'];

// The Zoho files these vouchers belong in for which Zoho's import sample is NOT in zoho-samples. Never built until the
// sample is added and the layout written from it. importAfter: the file it must follow in the import order.
export const SAMPLE_NEEDED = {
  payments_received: { module: 'Payments Received', slot: 'receipt', importAfter: 'invoices', what: 'money received from customers',
    sample: "Zoho Books' import sample for Payments Received (customer payments): in Zoho Books open Payments Received, choose Import in the menu at the top right, and download the sample file offered there" },
  payments_made: { module: 'Payments Made', slot: 'payment', importAfter: 'bills', what: 'payments made to vendors',
    sample: "Zoho Books' import sample for Payments Made (vendor payments): in Zoho Books open Payments Made, choose Import in the menu at the top right, and download the sample file offered there" },
  vendor_credits: { module: 'Vendor Credits', slot: 'debit_note', importAfter: 'bills', what: 'debit notes to vendors (for example purchase returns)',
    sample: "Zoho Books' import sample for Vendor Credits: in Zoho Books open Vendor Credits, choose Import in the menu at the top right, and download the sample file offered there" },
  credit_notes: { module: 'Credit Notes', slot: 'credit_note', importAfter: 'invoices', what: 'credit notes to customers (for example sales returns)',
    sample: "Zoho Books' import sample for Credit Notes: in Zoho Books open Credit Notes, choose Import in the menu at the top right, and download the sample file offered there" },
};
// What a held voucher would be applied to: Payments Received and Credit Notes to invoices, the other two to bills.
const APPLIES_TO = { payments_received: 'invoices', credit_notes: 'invoices', payments_made: 'bills', vendor_credits: 'bills' };

// The journal number code of each voucher type in the journals file of these vouchers.
export const JOURNAL_CODES = { receipt: 'RCT-', payment: 'PMT-', contra: 'CTR-', debit_note: 'DN-', credit_note: 'CN-' };
export const TYPE_WORDS = { receipt: 'Receipt', payment: 'Payment', contra: 'Contra', debit_note: 'Debit Note', credit_note: 'Credit Note' };

// Words for the summary flag of each group of vouchers written as Manual Journals as a matter of course.
export const JOURNAL_CATEGORIES = {
  contra: 'Contra vouchers are transfers between bank and cash accounts. Zoho Books has no import sample for transfers here, so they are written as Manual Journals (debit and credit as in Tally).',
  receipt_not_from_customer: 'Receipts with no customer on them (for example a loan received, interest or other income, a refund) cannot be customer payments. They are written as Manual Journals.',
  payment_not_to_vendor: 'Payments with no vendor on them (for example expenses, salaries, taxes, transfers) cannot be vendor payments. They are written as Manual Journals.',
  note_without_party: 'Debit and credit notes with no customer or vendor on them are written as Manual Journals.',
  customer_payment_as_journal: "Money received from a customer is written as a Manual Journal: the customer on Accounts Receivable with the Contact Name, the bank or cash account and every other line as in Tally. Zoho Books has no import sample for Payments Received here, and it accepted this journal in test imports. The balances are right at once; the invoice stays open in Zoho Books until the journal credit is applied to it (the list credits_to_apply.csv and the Import Wizard page \"Apply the credits\").",
  vendor_payment_as_journal: "Money paid to a vendor is written as a Manual Journal: the vendor on Accounts Payable with the Contact Name, the bank or cash account and every other line as in Tally. Zoho Books has no import sample for Payments Made here, and it accepted this journal in test imports. The balances are right at once; the bill stays open in Zoho Books until the journal credit is applied to it (the list credits_to_apply.csv and the Import Wizard page \"Apply the credits\").",
  vendor_credit_as_journal: "Debit notes to vendors are written as Manual Journals: the vendor on Accounts Payable with the Contact Name, the expense and tax ledgers as in Tally. Zoho Books has no import sample for Vendor Credits here. The balances are right at once, but Zoho Books has no Vendor Credit document for them, so they are not in its GST reports as vendor credits.",
  credit_note_as_journal: "Credit notes to customers are written as Manual Journals: the customer on Accounts Receivable with the Contact Name, the income and tax ledgers as in Tally. Zoho Books has no import sample for Credit Notes here. The balances are right at once, but Zoho Books has no Credit Note document for them, so they are not in its GST reports as credit notes.",
};
// The journal group of a voucher that belongs in a module without a sample, when the route is 'journals'.
export const MODULE_AS_JOURNAL = { payments_received: 'customer_payment_as_journal', payments_made: 'vendor_payment_as_journal', vendor_credits: 'vendor_credit_as_journal', credit_notes: 'credit_note_as_journal' };
export const PAYMENTS_ROUTE_OPTIONS = ['journals', 'module_files'];

const KIND_WORDS = { tax: 'tax', expense: 'expense or purchase', income: 'sales or income', asset: 'fixed asset', bank: 'bank or cash', customer: 'customer', vendor: 'vendor', other: 'other' };
const ZERO = new Decimal(0);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// The ledger lines of a voucher with their bill-wise allocations: [{ ledger, amount (Decimal, debit negative), bills }].
// bills: [{ ref (the reference name, hidden characters removed), type ('Agst Ref', 'New Ref', 'Advance', 'On Account'
// or as Tally writes it), amount (Decimal or null) }].
export function moneyLines(v) {
  return ledgerEntryList(v).entries.map(le => ({
    ledger: String(le.ledgername || ''), amount: money(le.amount),
    bills: [].concat(le.billallocations || []).filter(b => b && typeof b === 'object')
      .map(b => ({ ref: matchKey(tallyText(b.name)), type: String(tallyText(b.billtype)).replace(/[\u0000-\u001f]/g, '').trim(), amount: money(b.amount) })),
  }));
}

const isDebit = l => !!l.amount && l.amount.isNegative();
const isCredit = l => !!l.amount && !l.amount.isNegative() && !l.amount.isZero();

// Where one posted, balanced voucher of a money slot goes.
// ctx: { customers, vendors (NameSets), kindOf(ledger) }.
// Returns { file, category?, kind?, reason, party?, bank?, others? }:
//   file: 'payments_received' | 'payments_made' | 'vendor_credits' | 'credit_notes' (held: no sample) or 'other_journals';
//   category: for a journal written as a matter of course (JOURNAL_CATEGORIES), one summary flag per group;
//   kind: for a journal that needs a look, flagged on the voucher ('money_voucher_unclear', 'note_written_as_journal');
//   party: the customer or vendor line; bank: the bank or cash line (payments); others: the other lines of a held voucher.
export function classifyMoneyVoucher(v, slot, ctx) {
  const lines = moneyLines(v).filter(l => l.amount && !l.amount.isZero());
  const kindOf = name => (ctx.kindOf ? ctx.kindOf(name) : null);
  const isCust = l => ctx.customers.has(l.ledger);
  const isVend = l => !isCust(l) && ctx.vendors.has(l.ledger);
  const cust = lines.filter(isCust), vend = lines.filter(isVend);
  const journal = (category, reason) => ({ file: 'other_journals', category, reason });
  const unclear = reason => ({ file: 'other_journals', kind: 'money_voucher_unclear', reason: `${reason} It is written as a Manual Journal, which posts exactly what Tally posted; it is not linked to any invoice or bill. Check it before the import.` });
  const seen = () => {
    const parts = [];
    for (const [list, who] of [[cust, 'customer'], [vend, 'vendor']]) {
      if (list.some(isDebit)) parts.push(`${plural(list.filter(isDebit).length, `${who} ledger`)} debited`);
      if (list.some(isCredit)) parts.push(`${plural(list.filter(isCredit).length, `${who} ledger`)} credited`);
    }
    return parts.join(', ');
  };
  const sideWords = list => {
    const kinds = [...new Set(list.map(l => KIND_WORDS[kindOf(l.ledger)] || 'unknown group'))];
    return kinds.join(', ');
  };

  if (slot === 'contra') return journal('contra', JOURNAL_CATEGORIES.contra);

  if (slot === 'receipt' || slot === 'payment') {
    const receipt = slot === 'receipt';
    const parties = receipt ? cust : vend;
    const who = receipt ? 'customer' : 'vendor';
    if (!cust.length && !vend.length) {
      return journal(receipt ? 'receipt_not_from_customer' : 'payment_not_to_vendor',
        `${receipt ? `No customer is credited on this receipt; the credit side is ${sideWords(lines.filter(isCredit))} ledgers` : `No vendor is debited on this payment; the debit side is ${sideWords(lines.filter(isDebit))} ledgers`}. ${receipt ? JOURNAL_CATEGORIES.receipt_not_from_customer : JOURNAL_CATEGORIES.payment_not_to_vendor}`);
    }
    const party = parties.length === 1 && (receipt ? !vend.length : !cust.length) ? parties[0] : null;
    if (!party || (receipt ? !isCredit(party) : !isDebit(party))) {
      return unclear(`This ${receipt ? 'receipt' : 'payment'} is not a plain ${receipt ? 'payment from one customer' : 'payment to one vendor'} (${seen()}). A Zoho ${receipt ? 'customer' : 'vendor'} payment is for exactly one ${who}, ${receipt ? 'credited' : 'debited'}.`);
    }
    const banks = lines.filter(l => l !== party && kindOf(l.ledger) === 'bank' && (receipt ? isDebit(l) : isCredit(l)));
    if (banks.length !== 1) {
      return unclear(banks.length
        ? `The ${who} "${party.ledger}" is ${receipt ? 'credited' : 'debited'}, but ${banks.length} bank or cash ledgers are ${receipt ? 'debited' : 'credited'}, and a Zoho payment has one ${receipt ? '"Deposit To"' : '"Paid Through"'} account.`
        : `The ${who} "${party.ledger}" is ${receipt ? 'credited' : 'debited'}, but no bank or cash ledger is ${receipt ? 'debited' : 'credited'} (the other side is ${sideWords(lines.filter(l => l !== party)) || 'empty'}), so this is a set-off or adjustment, not money ${receipt ? 'received' : 'paid'}.`);
    }
    const file = receipt ? 'payments_received' : 'payments_made';
    const others = lines.filter(l => l !== party && l !== banks[0]);
    return { file, party, bank: banks[0], others,
      reason: `Money ${receipt ? 'received from the customer' : 'paid to the vendor'} "${party.ledger}" ${receipt ? 'into' : 'from'} "${banks[0].ledger}". It belongs in Zoho's ${SAMPLE_NEEDED[file].module}, whose import sample is not available yet, so it is held.` };
  }

  // debit and credit notes
  const debitNote = slot === 'debit_note';
  const named = v.partyledgername ? lines.filter(l => matchKey(l.ledger) === matchKey(tallyText(v.partyledgername))) : [];
  const party = named.length === 1 && (isCust(named[0]) || isVend(named[0])) ? named[0] : cust.length + vend.length === 1 ? (cust[0] || vend[0]) : null;
  if (!cust.length && !vend.length) return journal('note_without_party', `No customer or vendor is on this ${debitNote ? 'debit' : 'credit'} note. ${JOURNAL_CATEGORIES.note_without_party}`);
  if (!party) return unclear(`This ${debitNote ? 'debit' : 'credit'} note names more than one customer or vendor (${seen()}).`);
  const want = debitNote ? isVend(party) && isDebit(party) : isCust(party) && isCredit(party);
  if (want) {
    const file = debitNote ? 'vendor_credits' : 'credit_notes';
    return { file, party, bank: null, others: lines.filter(l => l !== party),
      reason: `A ${debitNote ? 'debit note to the vendor' : 'credit note to the customer'} "${party.ledger}". It belongs in Zoho's ${SAMPLE_NEEDED[file].module}, whose import sample is not available yet, so it is held.` };
  }
  const wrongKind = debitNote ? isCust(party) : isVend(party);
  if (wrongKind) {
    return { file: 'other_journals', kind: 'note_written_as_journal',
      reason: `This ${debitNote ? 'debit' : 'credit'} note is made out to the ${debitNote ? 'customer' : 'vendor'} "${party.ledger}", not to a ${debitNote ? 'vendor' : 'customer'}, so it cannot be a Zoho ${debitNote ? 'vendor credit' : 'credit note'}. It is written as a Manual Journal on ${debitNote ? 'Accounts Receivable' : 'Accounts Payable'} with the contact, which posts what Tally posted but is not linked to any ${debitNote ? 'invoice' : 'bill'}. An accountant should decide whether it should be entered as ${debitNote ? 'an invoice' : 'a bill'} in Zoho Books instead.` };
  }
  return unclear(`On this ${debitNote ? 'debit' : 'credit'} note the ${isVend(party) ? 'vendor' : 'customer'} "${party.ledger}" is ${isDebit(party) ? 'debited' : 'credited'}, the opposite of a ${debitNote ? 'debit note to a vendor' : 'credit note to a customer'}.`);
}

// ---------- bill-wise allocations ----------
// The bill-wise allocations of the party line of a voucher are Tally's own record of which invoice or bill an amount
// settles. "Agst Ref" names a reference created earlier ("New Ref") on the same party; "New Ref", "Advance" and "On
// Account" on a payment are money not set against any document.
const partyKey = (ctx, ledger) => matchKey(ctx.customers.has(ledger) ? ctx.customers.canonical?.(ledger) ?? ledger
  : ctx.vendors.has(ledger) ? ctx.vendors.canonical?.(ledger) ?? ledger : ledger);

// Every "New Ref" of the migration's posted vouchers, by party and reference: key -> [{ rec, ledger }].
export function newRefIndex(vouchers, ctx) {
  const index = new Map();
  for (const rec of vouchers) {
    for (const l of moneyLines(rec.data)) {
      if (!ctx.customers.has(l.ledger) && !ctx.vendors.has(l.ledger)) continue;
      for (const b of l.bills) {
        if (!b.ref || !/^new ref$/i.test(b.type)) continue;
        const k = `${partyKey(ctx, l.ledger)}|${b.ref}`;
        if (!index.has(k)) index.set(k, []);
        index.get(k).push({ rec, ledger: l.ledger });
      }
    }
  }
  return index;
}

// The documents written to the Invoices and Bills files, found by the "New Ref" names on their party line:
// key `${file}|${party}|${ref}` -> doc { file, number, rec, total (Zoho total), remaining }. One doc object is shared by
// all references of the same document, so what is applied is counted once against its total.
export function documentIndex(written, ctx) {
  const index = new Map();
  for (const w of written) {
    const doc = { file: w.file, number: w.number, rec: w.rec, total: w.total, remaining: w.total, currency: w.currency || 'INR' };
    for (const l of moneyLines(w.rec.data)) {
      if (matchKey(l.ledger) !== matchKey(w.partyLedger)) continue;
      for (const b of l.bills) {
        if (b.ref && /^new ref$/i.test(b.type)) { const k = `${w.file}|${partyKey(ctx, l.ledger)}|${b.ref}`; if (!index.has(k)) index.set(k, doc); }
      }
    }
  }
  return index;
}

// Works out the allocations of the held vouchers, in date order (then file order), each amount applied at most up to
// what is left of the document. Nothing uncertain is applied: an allocation whose sign is not the party line's, that
// names a document not written as an invoice or bill, or that is more than is left of the document, stays unapplied
// and is flagged. held: [{ rec, file, party }]. outcomeOf(rec): where a voucher of the migration went, in words.
// Adds to each held entry: amount, applied [{ file, number, ref, amount }], unapplied, notes [{ ref, type, amount, words }],
// flags [{ kind, message }].
export function allocate(held, docs, refs, ctx, outcomeOf) {
  const order = [...held].sort((a, b) => String(a.rec.data.date ?? '').localeCompare(String(b.rec.data.date ?? '')) || a.rec.id - b.rec.id);
  for (const h of order) {
    const party = h.party;
    const amount = party.amount.abs();
    const target = APPLIES_TO[h.file];
    const docWord = target === 'invoices' ? 'invoice' : 'bill';
    h.amount = amount; h.applied = []; h.notes = []; h.flags = [];
    let applied = ZERO;
    for (const b of party.bills) {
      const amt = b.amount ? b.amount.abs() : null;
      const label = `"${b.ref || '(no name)'}"`;
      if (!/^agst ref$/i.test(b.type)) {
        h.notes.push({ ref: b.ref, type: b.type || '(none)', amount: amt?.toFixed(2) ?? null, words: `${b.type || 'An allocation with no type'} ${label}: not set against any ${docWord}, so it stays unapplied (an advance or money on account).` });
        continue;
      }
      if (!amt || amt.isZero() || b.amount.isNegative() !== party.amount.isNegative()) {
        h.flags.push({ kind: 'allocation_sign_unclear', ref: b.ref, amount: amt ? amt.toFixed(2) : null, message: `The allocation against ${docWord} reference ${label} ${amt ? `(${amt.toFixed(2)})` : ''} is on the opposite side from the ${target === 'invoices' ? 'customer' : 'vendor'} line, or has no amount, so what it settles is not certain. It is not applied.` });
        continue;
      }
      const doc = docs.get(`${target}|${partyKey(ctx, party.ledger)}|${b.ref}`);
      if (!doc) {
        const made = refs.get(`${partyKey(ctx, party.ledger)}|${b.ref}`);
        if (made?.length) {
          const where = [...new Set(made.map(m => outcomeOf(m.rec)))].join('; ');
          h.flags.push({ kind: 'allocation_document_not_written', ref: b.ref, amount: amt.toFixed(2), message: `${amt.toFixed(2)} is set against reference ${label}, which was created by a voucher of this migration that is not written as ${docWord === 'invoice' ? 'an invoice' : 'a bill'} (${where}). Zoho Books can apply a payment only to ${docWord === 'invoice' ? 'an invoice' : 'a bill'}, so this amount stays unapplied.` });
        } else {
          h.flags.push({ kind: 'allocation_bill_not_in_migration', ref: b.ref, amount: amt.toFixed(2), message: `${amt.toFixed(2)} is set against reference ${label}, which no voucher of this migration created: it is ${docWord === 'invoice' ? 'an invoice' : 'a bill'} from before the period, part of the opening balance of "${party.ledger}". The amount stays unapplied; in Zoho Books it can be applied to the contact's opening balance by hand.` });
        }
        continue;
      }
      // round 1 (issues 4, 6): a Manual Journal is written in rupees; Zoho Books applies a credit only to a document in
      // the same currency, so a rupee journal credit is never listed as applied to an invoice or bill in another currency
      if (h.journal && doc.currency && doc.currency !== (h.journal.currency || 'INR')) {
        h.flags.push({ kind: 'allocation_across_currencies', ref: b.ref, amount: amt.toFixed(2), message: `${amt.toFixed(2)} is set against ${docWord} ${doc.number} (reference ${label}), which is written in ${doc.currency}, but this voucher is written as a Manual Journal in rupees. Zoho Books cannot apply a credit in one currency to ${docWord === 'invoice' ? 'an invoice' : 'a bill'} in another, so it stays a credit of the contact and the ${docWord} stays open in Zoho Books. Record the ${target === 'invoices' ? 'receipt' : 'payment'} against the ${docWord} in ${doc.currency} in Zoho Books by hand if it must show as paid.` });
        continue;
      }
      if (amt.greaterThan(doc.remaining)) {
        h.flags.push({ kind: 'allocation_exceeds_document', ref: b.ref, amount: amt.toFixed(2), message: `${amt.toFixed(2)} is set against ${docWord} ${doc.number} (reference ${label}), but only ${doc.remaining.toFixed(2)} of its Zoho total of ${doc.total.toFixed(2)} is left after the amounts applied before it. Applying it would overpay the ${docWord}, so it stays unapplied. Check the ${docWord}'s total and the earlier ${target === 'invoices' ? 'receipts' : 'payments'}.` });
        continue;
      }
      doc.remaining = doc.remaining.minus(amt);
      applied = applied.plus(amt);
      h.applied.push({ file: target, number: doc.number, ref: b.ref, amount: amt.toFixed(2) });
    }
    if (applied.greaterThan(amount)) {
      h.flags.push({ kind: 'allocation_exceeds_document', message: `The allocations applied (${applied.toFixed(2)}) come to more than the amount of the voucher (${amount.toFixed(2)}). Nothing is applied; check the bill-wise details in Tally.` });
      for (const a of h.applied) { const d = docs.get(`${target}|${partyKey(ctx, party.ledger)}|${a.ref}`); if (d) d.remaining = d.remaining.plus(a.amount); }
      h.applied = []; applied = ZERO;
    }
    h.unapplied = amount.minus(applied);
    // a payment's lines besides the party and the bank (a note's other lines are its own item and tax lines)
    if (h.bank && h.others?.length && SAMPLE_NEEDED[h.file]) {
      const list = h.others.map(o => `"${o.ledger}" ${o.amount.abs().toFixed(2)} ${o.amount.isNegative() ? 'debit' : 'credit'}`).join(', ');
      h.flags.push({ kind: 'money_voucher_other_lines', message: `Besides the ${target === 'invoices' ? 'customer' : 'vendor'} and the bank or cash ledger, this voucher has ${plural(h.others.length, 'other line')}: ${list}. Whether the ${SAMPLE_NEEDED[h.file].module} file can carry ${h.others.length === 1 ? 'it' : 'them'} (for example as bank charges or tax deducted) will be known only from Zoho's sample; otherwise ${h.others.length === 1 ? 'it needs' : 'they need'} a separate journal.` });
    }
  }
  return held;
}

// The view of one held voucher for the screens and the API (names as written through the name resolver).
export function heldView(h, accountName) {
  const v = h.rec.data;
  return {
    id: h.rec.id, slot: h.rec.slot, number: String(v.vouchernumber ?? ''), date: isoDate(v.date), file: h.file, module: SAMPLE_NEEDED[h.file].module,
    party: accountName(h.party.ledger), bank: h.bank ? accountName(h.bank.ledger) : null, amount: h.amount.toFixed(2),
    applied: h.applied, unapplied: h.unapplied.toFixed(2), notes: h.notes, flags: h.flags, reason: h.reason,
  };
}

// Counts per held file: { file: { module, vouchers, amount, applied, unapplied, allocations, flagged, sample, importAfter, what } }.
export function heldSummary(held) {
  const out = {};
  for (const [file, s] of Object.entries(SAMPLE_NEEDED)) {
    const list = held.filter(h => h.file === file);
    if (!list.length) continue;
    const sum = f => list.reduce((t, h) => t.plus(f(h)), ZERO);
    out[file] = { module: s.module, slot: s.slot, vouchers: list.length, amount: sum(h => h.amount).toFixed(2),
      applied: sum(h => h.applied.reduce((t, a) => t.plus(a.amount), ZERO)).toFixed(2), unapplied: sum(h => h.unapplied).toFixed(2),
      allocationsApplied: list.reduce((t, h) => t + h.applied.length, 0), flagged: list.filter(h => h.flags.length).length,
      sample: s.sample, importAfter: s.importAfter, what: s.what };
  }
  return out;
}

// ---------- credits to apply (the 'journals' route) ----------
// A Manual Journal with a customer credited or a vendor debited on Accounts Receivable / Accounts Payable leaves a
// credit on that contact in Zoho Books (seen in test imports: Zoho lists it under the journal's credits). It does not
// settle any invoice or bill by itself. Tally's bill-wise allocations of that line say what it settles; allocate()
// works them out against the invoices and bills written, exactly as for a payments file. This is the list a person
// applies in Zoho Books after the journals are imported (not an import file). Driven only by Tally's own data.

// The party lines of a voucher written as a Manual Journal that become a credit of a contact: a customer credited
// (applies to invoices) or a vendor debited (applies to bills). Returns entries for allocate():
// [{ rec, file ('payments_received' | 'payments_made': what it applies to), party, bank: null, others: [], journal }].
export function creditLinesOf(rec, ctx, journal) {
  const out = [];
  for (const l of moneyLines(rec.data)) {
    if (!l.amount || l.amount.isZero()) continue;
    const cust = ctx.customers.has(l.ledger), vend = !cust && ctx.vendors.has(l.ledger);
    if (cust && isCredit(l)) out.push({ rec, file: 'payments_received', party: l, bank: null, others: [], journal });
    else if (vend && isDebit(l)) out.push({ rec, file: 'payments_made', party: l, bank: null, others: [], journal });
  }
  return out;
}

const LEAVE_WORDS = {
  allocation_bill_not_in_migration: (doc, ref) => `Tally set this against "${ref}", ${doc === 'invoice' ? 'an invoice' : 'a bill'} from before this migration: it is part of the opening balance of the contact. Apply it to the contact's opening balance if Zoho Books offers that; if not, leave it as a credit. The balance of the contact is right either way.`,
  allocation_document_not_written: (doc, ref) => `Tally set this against "${ref}", which is not ${doc === 'invoice' ? 'an invoice' : 'a bill'} in Zoho Books (it was written as a journal). Leave it as a credit of the contact, as in Tally.`,
  allocation_exceeds_document: (doc, ref) => `Tally set this against "${ref}", but it is more than what is left of that ${doc} in Zoho Books. Leave it as a credit and check the ${doc}.`,
  allocation_across_currencies: (doc, ref) => `Tally set this against "${ref}", but that ${doc} is in another currency in Zoho Books and this journal is in rupees: Zoho Books cannot apply it across currencies. Leave it as a credit of the contact; the ${doc} stays open in Zoho Books.`,
  allocation_sign_unclear: (doc, ref) => `The allocation against "${ref}" is on the opposite side in Tally, so what it settles is not certain.`,
};

// The view of one credit for the list (names as written through the name resolver). Rows: one per thing to do.
//  what: 'apply' (to the invoice or bill named), 'opening_balance' (a document from before the migration), 'leave'
//  (stays a credit of the contact, as in Tally: an advance, money on account, a reference that is not a document) or
//  'note' (amount 0.00: an allocation on the opposite side of the line, which is no part of the credit).
//  The amounts of the rows of one credit add up to exactly the amount of its journal line.
export function creditView(h, accountName) {
  const v = h.rec.data;
  const customer = h.file === 'payments_received' || h.file === 'credit_notes';
  const doc = customer ? 'invoice' : 'bill';
  const base = { id: h.rec.id, slot: h.rec.slot, journalNumber: h.journal.number, journalFile: h.journal.file, date: isoDate(v.date), contact: accountName(h.party.ledger),
    contactType: customer ? 'customer' : 'vendor', account: customer ? 'Accounts Receivable' : 'Accounts Payable' };
  const rows = [];
  for (const a of h.applied) rows.push({ what: 'apply', document: doc, number: a.number, amount: a.amount, note: '' });
  // The rows never add up to more than the credit Zoho Books holds (the amount of the journal line). room: what is
  // left of it after the rows to apply. Each further row takes at most what is left.
  let room = h.unapplied;
  const take = amount => { const a = Decimal.min(new Decimal(amount), room); room = room.minus(a); return a; };
  const opposite = [];
  for (const f of h.flags) {
    if (!LEAVE_WORDS[f.kind] || !f.amount) continue;
    // an allocation on the other side of the line is already taken off the line's amount in Tally: it is no part of
    // the credit, so it gets a note with no amount, never a row to apply or to leave
    if (f.kind === 'allocation_sign_unclear') { opposite.push(f); continue; }
    const a = take(f.amount);
    if (a.isZero()) continue;
    rows.push({ what: f.kind === 'allocation_bill_not_in_migration' ? 'opening_balance' : 'leave', document: doc, number: '', amount: a.toFixed(2), note: LEAVE_WORDS[f.kind](doc, f.ref || '(no name)') });
  }
  for (const n of h.notes) {
    if (!n.amount) continue;
    const a = take(n.amount);
    if (a.isZero()) continue;
    rows.push({ what: 'leave', document: doc, number: '', amount: a.toFixed(2), note: `${n.type} "${n.ref || '(no name)'}" in Tally: not set against any ${doc} (an advance or money on account). It stays a credit of the contact, as in Tally.${a.lessThan(n.amount) ? ` Tally shows ${n.amount} here; ${a.toFixed(2)} of it is left as credit after the amount on the opposite side.` : ''}` });
  }
  // what the lines above do not explain (no bill-wise details in Tally, or allocations that were set aside together)
  if (room.greaterThan(0)) rows.push({ what: 'leave', document: doc, number: '', amount: room.toFixed(2), note: `Tally has no bill-wise details for this amount, so it is not set against any ${doc}. It stays a credit of the contact.` });
  for (const f of opposite) rows.push({ what: 'note', document: doc, number: '', amount: '0.00', note: `${LEAVE_WORDS[f.kind](doc, f.ref || '(no name)')} Tally shows ${f.amount} there. It is already taken off the amount of this journal line, so it is no part of the credit: nothing to apply for it.` });
  return { ...base, amount: h.amount.toFixed(2), applied: h.applied.reduce((t, a) => t.plus(a.amount), ZERO).toFixed(2), unapplied: h.unapplied.toFixed(2), rows };
}

export const CREDIT_LIST_HEADINGS = ['Contact Type', 'Contact', 'Journal Number', 'Journal Date', 'Journal File', 'Account', 'What To Do', 'Invoice or Bill Number', 'Amount', 'Note'];
const WHAT_WORDS = { apply: d => `Apply to ${d}`, opening_balance: () => 'Opening balance (apply if offered, else leave)', leave: () => 'Leave as credit (same as Tally)', note: () => 'Note (nothing to do)' };
// The rows of credits_to_apply.csv from the stored views, in the order a person works: customers then vendors, by
// contact, then by date. fileName(key): the name of the journals file the journal is in.
export function creditListRows(views, fileName = k => k) {
  const rows = [];
  for (const c of views) for (const r of c.rows) {
    rows.push({ 'Contact Type': c.contactType === 'customer' ? 'Customer' : 'Vendor', 'Contact': c.contact, 'Journal Number': c.journalNumber, 'Journal Date': c.date, 'Journal File': fileName(c.journalFile),
      'Account': c.account, 'What To Do': WHAT_WORDS[r.what](r.document), 'Invoice or Bill Number': r.number, 'Amount': r.amount, 'Note': r.note, _what: r.what });
  }
  const rank = { apply: 0, opening_balance: 1, leave: 2, note: 3 };
  return rows.sort((a, b) => a['Contact Type'].localeCompare(b['Contact Type']) || a.Contact.localeCompare(b.Contact) || rank[a._what] - rank[b._what]
    || String(a['Journal Date']).localeCompare(String(b['Journal Date'])) || String(a['Journal Number']).localeCompare(String(b['Journal Number']), undefined, { numeric: true }));
}

// Counts for the screens: { journals, credits, contacts, apply: { rows, amount, invoices, bills }, openingBalance: { rows, amount }, leave: { rows, amount } }.
export function creditSummary(views) {
  const all = views.flatMap(c => c.rows);
  const sum = what => all.filter(r => r.what === what).reduce((t, r) => t.plus(r.amount), ZERO).toFixed(2);
  const n = what => all.filter(r => r.what === what).length;
  const docs = d => new Set(views.flatMap(c => c.rows.filter(r => r.what === 'apply' && r.document === d).map(r => `${c.contact}\u0001${r.number}`))).size;
  return { journals: new Set(views.map(c => `${c.journalFile}|${c.journalNumber}`)).size, credits: views.length, contacts: new Set(views.map(c => `${c.contactType}|${c.contact}`)).size,
    apply: { rows: n('apply'), amount: sum('apply'), invoices: docs('invoice'), bills: docs('bill') },
    openingBalance: { rows: n('opening_balance'), amount: sum('opening_balance') }, leave: { rows: n('leave'), amount: sum('leave') } };
}
