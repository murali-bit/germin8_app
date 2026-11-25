// WHERE ZOHO BOOKS POSTS THE TDS AND THE REVERSE CHARGE OF A BILL OR INVOICE, and what the batch itself shows about
// the Tally ledgers that carried them.
//
// Zoho Books posts the TDS written in the TDS columns of a bill to its own account "TDS Payable" and of an invoice to
// "TDS Receivable", whatever TDS tax is named (third test import: the TDS of every bill, of three different TDS taxes,
// was on TDS Payable). It posts the tax written in the Reverse Charge columns of a bill as a debit on "Reverse Charge
// Tax Input but not due" and a credit on the Output account of each tax head written (the same import: the reverse
// charge of the bills was on those accounts; the invoice side, TDS Receivable, is assumed: zohorules.json lists.posting_rules,
// invoice_tds, the one record of that evidence). Tally posts the same amounts on its own ledgers. So a Tally ledger that
// carried them must be entered on Zoho's account, or one balance is split between two accounts.
//
// Nothing here knows a company or a ledger name. The evidence is the documents of the batch: which Tally ledger is in
// the TDS columns of the bills or invoices written, and which Tally ledgers a reverse charge bill debits and credits.
// The Zoho account names come from zohorules.json (lists.tax_ledger_zoho_accounts).

import fs from 'node:fs';
import Decimal from 'decimal.js';

const TABLE = (() => { try { return JSON.parse(fs.readFileSync(new URL('./zohorules.json', import.meta.url), 'utf8')).lists?.tax_ledger_zoho_accounts?.entries || []; } catch { return []; } })();
const ZERO = new Decimal(0);

// The Zoho system accounts the documents post to: { tdsPayable, tdsReceivable, rcmInput, output: { CGST, SGST, IGST } }.
export const ZOHO_TAX_POSTING_ACCOUNTS = {
  tdsPayable: TABLE.find(e => e.tds && e.side === 'output')?.account || 'TDS Payable',
  tdsReceivable: TABLE.find(e => e.tds && e.side === 'input')?.account || 'TDS Receivable',
  rcmInput: TABLE.find(e => e.rcm && e.side === 'input')?.account || 'Reverse Charge Tax Input but not due',
  output: Object.fromEntries(['CGST', 'SGST', 'IGST'].map(h => [h, TABLE.find(e => e.head === h && e.side === 'output')?.account || `Output ${h}`])),
};

// What the batch shows. postings: the taxPostings of buildVoucherOutput (vouchers.js), one per bill or invoice written
// with TDS or reverse charge:
//   { file: 'bills' | 'invoices', id, date, number, partyLedger,
//     tds: { ledger, amount } | null,
//     rcm: { input: [{ ledger, amount }], output: [{ ledger, amount }], zoho: { head: amount }, importOfServices } | null,
//     taxLedgers: [ledgers written as the ordinary tax of the lines] }
// Returns
//   { tds: { ledger: { payable: { documents, amount }, receivable: { documents, amount } } },
//     rcmInput: { ledger: { documents, amount } },
//     rcmOutput: { ledger: { documents, amount, heads: [heads Zoho posts for those bills] } },
//     ordinaryTax: [ledgers that are also the ordinary tax of a bill or invoice line],
//     foreignVendors: [vendor ledgers whose reverse charge bills are written as an import of services] }
// Amounts are texts with 2 decimals. Plain data only (it is kept and compared).
export function taxEvidenceFrom(postings) {
  const tds = {}, rcmInput = {}, rcmOutput = {}, ordinary = new Set(), foreign = new Set();
  const add = (map, key, amount) => { const x = (map[key] ||= { documents: 0, amount: ZERO }); x.documents++; x.amount = x.amount.plus(amount); return x; };
  for (const p of postings || []) {
    for (const l of p.taxLedgers || []) ordinary.add(l);
    if (p.tds) add((tds[p.tds.ledger] ||= {}), p.file === 'bills' ? 'payable' : 'receivable', p.tds.amount);
    if (p.rcm) {
      for (const x of p.rcm.input) add(rcmInput, x.ledger, x.amount);
      // the heads a payable ledger carries: its own Tally duty head when Zoho posts that head for the bill (a CGST+SGST
      // bill credits 'CGST' on one ledger and 'SGST' on another); otherwise every head Zoho posts for the bill (unknown)
      const zohoHeads = Object.keys(p.rcm.zoho || {});
      for (const x of p.rcm.output) { const o = add(rcmOutput, x.ledger, x.amount); const own = x.head && zohoHeads.includes(x.head) ? [x.head] : zohoHeads; o.heads = [...new Set([...(o.heads || []), ...own])].sort(); }
      if (p.rcm.importOfServices && p.partyLedger) foreign.add(p.partyLedger);
    }
  }
  const text = map => Object.fromEntries(Object.entries(map).map(([k, v]) => [k, { ...v, amount: v.amount.toFixed(2) }]));
  return {
    tds: Object.fromEntries(Object.entries(tds).map(([k, v]) => [k, text(v)])),
    rcmInput: text(rcmInput), rcmOutput: text(rcmOutput),
    ordinaryTax: [...ordinary].sort(), foreignVendors: [...foreign].sort(),
  };
}

// The Zoho account a Tally ledger belongs on, from the evidence alone: { account, why } or null.
//  - a ledger in the TDS columns of bills only -> TDS Payable; of invoices only -> TDS Receivable; of both -> null
//    (one ledger cannot be two Zoho accounts: it stays an account of its own and the tax alignment journal moves the
//    amounts);
//  - a ledger debited as reverse charge on bills, and never the ordinary tax of a line -> Reverse Charge Tax Input but
//    not due;
//  - a ledger credited as reverse charge on bills, never the ordinary tax of a line, when it carries ONE tax head on
//    every such bill (its own Tally duty head, CGST, SGST or IGST, posted by Zoho for the bill) -> the Output account
//    of that head. A ledger seen with two heads stays an account of its own.
export function evidenceAccount(ledger, evidence, accounts = ZOHO_TAX_POSTING_ACCOUNTS) {
  if (!evidence) return null;
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const t = evidence.tds?.[ledger];
  if (t) {
    if (t.payable && t.receivable) return null;
    return t.payable
      ? { account: accounts.tdsPayable, kind: 'tds', why: `it is the TDS ledger of ${plural(t.payable.documents, 'bill')} in these files (${t.payable.amount} in all), and Zoho Books posts the TDS of a bill to its own account "${accounts.tdsPayable}"` }
      : { account: accounts.tdsReceivable, kind: 'tds', why: `it is the TDS ledger of ${plural(t.receivable.documents, 'invoice')} in these files (${t.receivable.amount} in all), and Zoho Books posts the TDS of an invoice to its own account "${accounts.tdsReceivable}"` };
  }
  if ((evidence.ordinaryTax || []).includes(ledger)) return null;
  const i = evidence.rcmInput?.[ledger], o = evidence.rcmOutput?.[ledger];
  if (i && o) return null;
  if (i) return { account: accounts.rcmInput, kind: 'rcm', why: `${plural(i.documents, 'reverse charge bill')} in these files ${i.documents === 1 ? 'debits' : 'debit'} it (${i.amount} in all), and Zoho Books posts the reverse charge input of a bill to its own account "${accounts.rcmInput}"` };
  if (o && o.heads?.length === 1 && accounts.output[o.heads[0]]) {
    return { account: accounts.output[o.heads[0]], kind: 'rcm', why: `${plural(o.documents, 'reverse charge bill')} in these files ${o.documents === 1 ? 'credits' : 'credit'} it (${o.amount} in all), the bills are written with ${o.heads[0]}, and Zoho Books posts the reverse charge payable of such a bill to its own account "${accounts.output[o.heads[0]]}"` };
  }
  return null;
}
