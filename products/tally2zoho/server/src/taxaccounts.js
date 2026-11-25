// Tally GST (and TDS) ledgers and Zoho Books' own system tax accounts.
//
// Zoho Books creates its own tax accounts (Input CGST, Output IGST, Reverse Charge Tax Input but not due, TDS Payable ...)
// and posts every invoice and bill to them. A Tally ledger such as "Output CGST@9%" written as an ordinary account would
// be filled by journals while invoices and bills fill Zoho's own account, so the trial balance would never match.
// This module tells, from the Tally ledger master and not from any name, which Zoho system account a duty ledger belongs
// on. The table is zohorules.json lists.tax_ledger_zoho_accounts (with its evidence).
//
//   what Tally says                                   used for
//   group chain reaches Duties & Taxes                the ledger is a duty or tax ledger at all (groupSection)
//   type of duty/tax GST + duty head (CGST, SGST/UTGST, IGST, Cess)   which Zoho account
//   type of duty/tax TDS                              TDS Payable or TDS Receivable
//   "is input credit" (else the words of the name and the side of the opening balance; if they disagree the side is only asked)  side
//   the words reverse charge / RCM in the name        reverse charge ledger (Tally has no field for it)
//
// 'sure' entries are applied by default; 'ask' entries are only suggested and go to the Assumptions list.
//
// TDS and reverse charge ledgers are 'ask' in the table: from the ledger master alone it is not certain. The batch
// itself makes it certain (taxposting.js, the evidence of a first pass over the vouchers):
//   a ledger in the TDS columns of the bills written -> TDS Payable; of the invoices -> TDS Receivable;
//   a ledger the reverse charge bills debit -> Reverse Charge Tax Input but not due; the one they credit -> the Output
//   account of the tax head the bills are written with.
// A TDS ledger no bill or invoice uses (for example salary TDS booked by journals only) stays an account of its own.

import fs from 'node:fs';
import { groupSection, taxLedgerSideSignals } from './zoho.js';
import { taxLedgerInfo } from './vouchers.js';
import { builtinAccount } from './zohocodes.js';
import { recordParent, recordName } from './tally.js';
import { evidenceAccount } from './taxposting.js';

const RULES = JSON.parse(fs.readFileSync(new URL('./zohorules.json', import.meta.url), 'utf8'));
export const TAX_LEDGER_TABLE = RULES.lists?.tax_ledger_zoho_accounts?.entries || [];
const RCM_WORDS = /\b(rcm|reverse\s*charge)\b/i;

// What a ledger is, as far as Zoho's system accounts are concerned: null when it is not a duty or tax ledger (or has
// no GST duty head and is not TDS), else { kind: 'gst' | 'rcm' | 'tds', head, side: 'input' | 'output', account,
// certainty: 'sure' | 'ask', why }. account may be '' (nothing to suggest). known: the account names of the
// organisation's own Chart of Accounts export, when given; an account that is not in it is never 'sure'.
export function classifyTaxLedger(d, ctx = {}, known = null, table = TAX_LEDGER_TABLE) {
  if (!d || groupSection(recordParent(d), ctx) !== 'taxes') return null;
  const info = taxLedgerInfo(d);
  // The side: Tally's own field first. Without it the words of the name and the side of the opening balance are used, and
  // when they disagree the side is only a suggestion (certainty 'ask'), never moved by default.
  const sig = taxLedgerSideSignals(d);
  const inSig = sig.nameInput || sig.balance === 'input', outSig = sig.nameOutput || sig.balance === 'output';
  const sideConflict = !sig.field && inSig && outSig;
  const side = sig.field ? 'input' : sideConflict ? (sig.balance || (sig.nameInput ? 'input' : 'output')) : inSig ? 'input' : 'output';
  let kind, entry;
  if (info.tds) { kind = 'tds'; entry = table.find(e => e.tds && e.side === side); }
  else if (info.head) {
    kind = RCM_WORDS.test(String(recordName(d) ?? '')) ? 'rcm' : 'gst';
    entry = kind === 'rcm' ? table.find(e => e.rcm && e.side === side) : table.find(e => e.head === info.head && e.side === side);
  } else return null;
  if (!entry) return { kind, head: info.head || null, side, account: '', certainty: 'ask', why: 'No Zoho system account is known for this kind of ledger.' };
  let account = entry.account || '', certainty = sideConflict ? 'ask' : entry.certainty || 'ask';
  let why = `Tally: ${kind === 'tds' ? 'type of duty TDS' : `GST, duty head ${info.head}`}, ${side} side${kind === 'rcm' ? ', reverse charge' : ''}.`;
  if (sideConflict) why += ' The words of the ledger name and the side of its opening balance point to different sides, so the side is only a suggestion: confirm it in Mapping Studio.';
  if (account && known) {
    const inOrg = builtinAccount(account, known);
    if (inOrg) account = inOrg;
    else { certainty = 'ask'; why += ` The organisation's own account list has no "${account}".`; }
  }
  if (!account) certainty = 'ask';
  return { kind, head: info.head || null, side, account, certainty, why };
}

// The decisions made by default for the duty ledgers of a migration. records: [{ name, data }] (data is the parsed Tally
// ledger). Returns { decisions: { ledger: { decision: 'zoho', zohoName, byDefault: true, taxLedger: true, why } },
// asks: { ledger: { account, kind, why } } }. A ledger with a decision stored by a person (explicit) is left alone.
// evidence: what the documents of the batch show (taxposting.js taxEvidenceFrom), or null when there is none yet. With
// it, a ledger the documents use is entered on the Zoho account they post to (certain, by default), and a TDS ledger no
// document uses is no longer asked about: it stays an account of its own.
export function taxLedgerDefaults(records, ctx, explicit = {}, known = null, evidence = null) {
  const decisions = {}, asks = {};
  for (const r of records) {
    const ev = evidenceAccount(r.name, evidence);
    // TDS-016: the posting choice per_ledger keeps every TDS ledger an account of its own (the tax alignment journals move
    // the TDS from Zoho's account to it); merge (the default) enters it on Zoho's account
    if (ev?.kind === 'tds' && ctx.tdsPosting === 'per_ledger') continue;
    if (ev && !explicit[r.name]) {
      // the account as the organisation's own export spells it; an account the export does not have is never used
      const account = known ? builtinAccount(ev.account, known) : ev.account;
      if (account) {
        decisions[r.name] = { decision: 'zoho', newName: '', by: null, at: null, byDefault: true, zohoName: account, taxLedger: true, taxKind: ev.kind, fromDocuments: true, why: ev.why };
        continue;
      }
    }
    const c = classifyTaxLedger(r.data, ctx, known);
    if (!c) continue;
    // a TDS ledger that no bill or invoice of the batch uses: an account of its own, nothing to decide
    if (evidence && c.kind === 'tds' && !evidence.tds?.[r.name]) continue;
    if (c.certainty === 'sure' && !explicit[r.name]) decisions[r.name] = { decision: 'zoho', newName: '', by: null, at: null, byDefault: true, zohoName: c.account, taxLedger: true, why: c.why };
    else if (c.certainty !== 'sure' && !explicit[r.name]) asks[r.name] = { account: c.account, kind: c.kind, why: c.why };
  }
  return { decisions, asks };
}
