// Names and contact details as written to the Zoho files, after the accountant's decisions (Mapping Studio: Names and
// Fix contacts). Pure functions only: the decisions are stored and audited in names.js, the Tally data is never changed.
//
//  - cleanName / visibleName: a name without line breaks, invisible characters and spaces around it; and the name with
//    every hidden character made visible, for the screens.
//  - makeNameResolver: THE one function that gives the name a ledger is written with in every Zoho file (Display Name
//    of Customers and Vendors, Account Name of the Chart of Accounts, and the party and Account columns of Invoices,
//    Bills and Journals, and any voucher file built later). It applies, in order: the decision on a clash with one of
//    Zoho's own accounts (rename, or Zoho's own account), a duplicate treated as one party (the kept ledger's name), a
//    new name given to keep two duplicates apart, and a cleaned name.
//  - applyContactFixes: the corrections typed in Fix contacts (GSTIN, state, GST treatment), applied to the contact
//    details read from Tally (contactInfo in masters.js) just before the row is written.

import Decimal from 'decimal.js';
import { matchKey, money } from './tally.js';
import { builtinAccount, STATE_CODES } from './zohocodes.js';

// Hidden characters: control characters (line breaks, tabs; not Tally's own marker, character 4) and the invisible
// characters U+200B and U+FEFF.
const CONTROL = /[\u0000-\u0003\u0005-\u001f\u007f]/;
const INVISIBLE = /[​﻿]/;

// A name as written to Zoho after "clean": every line break, tab or other control character becomes a space,
// invisible characters are removed, runs of spaces become one, and spaces around the name are removed.
export const cleanName = s => String(s ?? '').replace(/[​﻿]/g, '').replace(/[\u0000-\u0003\u0005-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

// True when the name has something "Clean" would remove: a hidden character, or spaces at its start or end.
export const needsCleaning = s => typeof s === 'string' && s !== '' && (CONTROL.test(s) || INVISIBLE.test(s) || s !== s.trim());

// What is hidden in a name, in words (for the screens and messages).
export function hiddenParts(s) {
  const out = [];
  const t = String(s ?? '');
  if (/[\r\n]/.test(t)) out.push('line break');
  if (/\t/.test(t)) out.push('tab');
  if (INVISIBLE.test(t)) out.push('invisible character');
  if (/[\u0000-\u0003\u0005-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(t)) out.push('other hidden character');
  if (/^[ ]|[ ]$/.test(t.replace(/[\r\n\t​﻿]/g, ''))) out.push('space at the start or end');
  return out;
}

// The name with every hidden character shown in words, for example "Oak Traders[line break]".
export const visibleName = s => String(s ?? '')
  .replace(/\r\n|\r|\n/g, '[line break]').replace(/\t/g, '[tab]').replace(/[​﻿]/g, '[invisible character]')
  .replace(/[\u0000-\u0003\u0005-\u001f\u007f]/g, '[hidden character]')
  .replace(/^ +| +$/g, m => '[space]'.repeat(m.length));

// The resolver. decisions: { clashDecisions: { ledger: { decision, newName } }, nameDecisions: { ledger: { action:
// 'clean' | 'rename' | 'merge', newName, mergeInto } } }; masterNames: every ledger name of the masters, as written.
// A name given (for example from a voucher line) is matched to a master exactly, else ignoring hidden characters and
// the spaces around it when exactly one master matches that way. Pick and drop: a master without a decision is written
// with its name EXACTLY as the masters have it (line breaks and spaces included), also when a voucher names it without
// them, so the Customers, Vendors and Chart of Accounts files and every voucher file carry the same raw value and the
// cross-references match. A name that matches no master is returned exactly as given.
export function makeNameResolver({ clashDecisions = {}, nameDecisions = {} } = {}, masterNames = []) {
  const exact = new Set(masterNames);
  const byKey = new Map(); // matchKey -> the one master with that key, or null when more than one has it
  const sameKey = new Map(); // matchKey -> every master with that key
  for (const n of exact) {
    const k = matchKey(n);
    if (!k) continue;
    byKey.set(k, byKey.has(k) ? null : n);
    if (!sameKey.has(k)) sameKey.set(k, []);
    sameKey.get(k).push(n);
  }
  // Several masters differ only by hidden characters: when they are all treated as ONE party or account (merged into
  // the same ledger, by a decision or by default), a voucher name that matches them only that way is that ledger.
  const keptOf = n => { const seen = new Set(); let m = n; while (nameDecisions[m]?.action === 'merge' && nameDecisions[m].mergeInto && !seen.has(m)) { seen.add(m); m = nameDecisions[m].mergeInto; } return m; };
  const masterOf = name => {
    if (exact.has(name)) return name;
    const k = matchKey(name);
    const one = byKey.get(k);
    if (one) return one;
    const all = sameKey.get(k);
    if (!all || all.length < 2) return null;
    const kept = new Set(all.map(keptOf));
    return kept.size === 1 ? [...kept][0] : null;
  };
  const resolve = (name, seen = new Set()) => {
    if (name == null || name === '') return name;
    const m = masterOf(name);
    if (!m || seen.has(m)) return name;
    seen.add(m);
    const c = clashDecisions[m];
    if (c?.decision === 'rename' && c.newName) return c.newName;
    if (c?.decision === 'zoho') { const b = c.zohoName || builtinAccount(m); if (b) return b; }
    const n = nameDecisions[m];
    if (n?.action === 'merge' && n.mergeInto) return resolve(n.mergeInto, seen);
    if ((n?.action === 'clean' || n?.action === 'rename') && n.newName) return n.newName;
    return m;
  };
  resolve.masterOf = masterOf;
  return resolve;
}

// The ledgers merged into another one ("treat as one party"): { kept ledger: [merged ledger] }.
export function mergedInto(nameDecisions = {}) {
  const out = {};
  for (const [ledger, d] of Object.entries(nameDecisions)) {
    if (d.action !== 'merge' || !d.mergeInto) continue;
    (out[d.mergeInto] ||= []).push(ledger);
  }
  return out;
}

// The opening balance a ledger is written with: its own (Tally sign: a debit is negative) plus the opening balances of
// the ledgers merged into it (ctx.mergedBalances: { kept: [{ ledger, amount }] }). Returns { total, own, added: [...] }
// with Decimals; total null when the own balance cannot be read.
export function openingWithMerged(name, ownValue, ctx) {
  const own = money(ownValue);
  const added = (ctx?.mergedBalances?.[name] || []).map(x => ({ ledger: x.ledger, amount: money(x.amount) || new Decimal(0), text: x.amount }));
  if (!added.length) return { total: own, own, added };
  const base = own || new Decimal(0);
  return { total: added.reduce((t, x) => t.plus(x.amount), base), own: base, added };
}

// The corrections typed in Fix contacts, applied to the contact details read from Tally. fix: { gstin, state,
// treatment } ('' when not corrected). Returns a new object; c is not changed.
//  - treatment 'unregistered': the GST Treatment is the code for an unregistered business in the chosen set, and no
//    GSTIN is written (Zoho rejects an unregistered treatment with a GSTIN).
//  - treatment 'regular' / 'composition': the party is registered (used when Tally's registration type is unknown or
//    missing); a valid GSTIN is still needed.
//  - gstin: written instead of Tally's GSTIN.
//  - state: a Zoho state code; it becomes the place of contact / source of supply, and the Billing State when Tally has
//    none.
export function applyContactFixes(c, fix) {
  if (!fix || (!fix.gstin && !fix.state && !fix.treatment && !fix.pan)) return c;
  const out = { ...c, fixedFields: [] };
  if (fix.pan) { out.pan = fix.pan; out.panFixed = true; out.fixedFields.push('PAN'); }
  if (fix.treatment === 'unregistered') {
    out.treatmentOverride = 'unregistered';
    out.gstin = '';
    out.gstinConflict = null;
    out.fixedFields.push('GST treatment');
  } else {
    if (fix.gstin) { out.gstin = fix.gstin; out.gstinConflict = null; out.fixedFields.push('GSTIN'); }
    if (fix.treatment === 'regular' || fix.treatment === 'composition') { out.treatmentOverride = fix.treatment; out.fixedFields.push('GST treatment'); }
  }
  if (fix.state && STATE_CODES[fix.state]) {
    out.placeOfSupply = STATE_CODES[fix.state];
    out.placeFixed = fix.state;
    if (!String(c.state ?? '').trim()) out.state = STATE_CODES[fix.state];
    out.fixedFields.push('state');
  }
  return out;
}
