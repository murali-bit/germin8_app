// Voucher types, and splitting an "All transactions" file (Tally: Gateway > E: Export > Transactions).
//
// Confirmed on a real TallyPrime 7.1 export (JSON (Data Exchange), UTF-16 LE with a byte order mark):
//   - one "tallymessage" list holds every voucher of the period, all voucher types mixed;
//   - each record has metadata.type "Voucher" and the voucher type in metadata.vchtype and in vouchertypename;
//   - the lines are in "allledgerentries" (accounting view) or "ledgerentries" (invoice view), never both.
//
// ROUTING BY VOUCHER TYPE. Tally has a fixed set of voucher types of its own, and lets a company create more (for
// example "Sales - Export"), each under one of Tally's own types. The masters file has one "Voucher Type" record per
// type: its name is in metadata.name, the type above it in "parent", and Tally's own name of the type in
// metadata.reservedname (kept when the user renames the type). In the real export each of Tally's own types names
// ITSELF as its parent.
// A voucher is routed by walking its type up that chain until one of Tally's own types is met:
//   Sales, Purchase, Receipt, Payment, Journal, Contra, Debit Note, Credit Note -> the dataset of that name;
//   any other Tally type (orders, delivery notes, stock journals, payroll, memorandum ...) -> "Other Voucher Types";
//   a type that cannot be traced to one of Tally's own types (no Voucher Type records were uploaded, or the chain
//   breaks) -> "Other Voucher Types", flagged as not resolved. Nothing is guessed from the name of the type.

import { entryType, recordName, tallyText } from './tally.js';

// Tally's own voucher types that have a dataset: name (lower case) -> upload slot. TALLY-014: every table keyed by text
// from the data has no prototype (a voucher type named "Constructor" or "toString" is an ordinary name), and is read
// with Object.hasOwn only.
export const TYPE_SLOTS = Object.assign(Object.create(null), { sales: 'sales', purchase: 'purchase', receipt: 'receipt', payment: 'payment', journal: 'journal',
  contra: 'contra', 'debit note': 'debit_note', 'credit note': 'credit_note' });
const slotOfType = key => (Object.hasOwn(TYPE_SLOTS, key) ? TYPE_SLOTS[key] : null);
// Tally's other own voucher types. The platform has no dataset for them: they go to "Other Voucher Types".
const OTHER_TALLY_TYPES = new Set(['delivery note', 'receipt note', 'rejections in', 'rejections out', 'sales order', 'purchase order', 'stock journal',
  'physical stock', 'memorandum', 'reversing journal', 'payroll', 'attendance', 'job work in order', 'job work out order', 'material in', 'material out']);
export const OTHER_SLOT = 'other_vouchers';
// TALLY-002: Tally's own types whose vouchers never post to the ledgers (they are not in the trial balance), whatever
// lines they carry. A voucher of any other type in Other Voucher Types (Payroll, a note with accounting entries, a type
// that cannot be traced) that carries a ledger amount is written as a Manual Journal; one with no amount has no file.
export const NON_POSTING_TALLY_TYPES = new Set(['memorandum', 'reversing journal', 'sales order', 'purchase order', 'job work in order', 'job work out order', 'attendance']);
export const isNonPostingBase = base => NON_POSTING_TALLY_TYPES.has(norm(base));
// The datasets an All Transactions file is split into, in the order they are shown.
export const ALL_TRANSACTIONS_SLOTS = ['sales', 'purchase', 'receipt', 'payment', 'journal', 'contra', 'debit_note', 'credit_note', OTHER_SLOT];

const norm = s => String(s ?? '').trim().toLowerCase();

// records: the "Voucher Type" records of a masters file. Returns { name: { parent, reserved } } (plain data, stored as JSON).
export function voucherTypeMap(records) {
  const map = Object.create(null);
  for (const r of records || []) {
    if (entryType(r) !== 'Voucher Type') continue;
    const name = recordName(r);
    if (!name || Object.hasOwn(map, name)) continue;
    map[name] = { parent: tallyText(r.parent), reserved: tallyText(r?.metadata?.reservedname).trim() };
  }
  return map;
}

// Where a voucher of this type goes. types: the map from voucherTypeMap, or null when no masters file is available.
// Returns { slot, base, how }:
//   base: Tally's own type the voucher type belongs to, as Tally writes it, or null when it could not be traced;
//   how: 'own' (the type is one of Tally's own), 'master' (traced through the Voucher Type records),
//        'no_dataset' (traced to a Tally type the platform has no dataset for), 'unresolved' (could not be traced).
export function routeVoucherType(typeName, types = null) {
  const byKey = new Map();
  for (const [name, t] of Object.entries(types || {})) if (!byKey.has(norm(name))) byKey.set(norm(name), { name, ...t });
  const seen = new Set();
  let name = String(typeName ?? '').trim(), steps = 0;
  while (name && !seen.has(norm(name))) {
    seen.add(norm(name));
    const master = byKey.get(norm(name));
    // Tally's own name of the type: the reserved name when the masters give one, else the name itself
    for (const own of [name, master?.reserved]) {
      if (!own) continue;
      if (slotOfType(norm(own))) return { slot: slotOfType(norm(own)), base: own.trim(), how: steps === 0 && own === name ? 'own' : 'master' };
      if (OTHER_TALLY_TYPES.has(norm(own))) return { slot: OTHER_SLOT, base: own.trim(), how: 'no_dataset' };
    }
    if (!master) break; // not one of Tally's own types and not in the masters: the chain cannot be followed
    name = String(master.parent ?? '').trim();
    steps++;
  }
  return { slot: OTHER_SLOT, base: null, how: 'unresolved' };
}

// A router that remembers each type it has seen: route(typeName) as above; summary() describes every type met.
export function voucherRouter(types = null) {
  const cache = new Map();
  return {
    route(typeName) {
      const key = String(typeName ?? '');
      let r = cache.get(key);
      if (!r) cache.set(key, r = { ...routeVoucherType(key, types), vouchers: 0 });
      return r;
    },
    // [{ type, slot, base, how, vouchers }]
    summary: () => [...cache.entries()].map(([type, r]) => ({ type: type || '(no voucher type)', ...r })),
  };
}

// What is said about a voucher type that went to "Other Voucher Types".
export function otherTypeMessage(t, mastersAvailable) {
  const n = `${t.vouchers} voucher${t.vouchers === 1 ? '' : 's'}`;
  if (t.how === 'no_dataset') {
    return `${n} of type "${t.type}"${t.base && norm(t.base) !== norm(t.type) ? ` (a kind of ${t.base})` : ''}: the platform has no dataset for this Tally voucher type. `
      + (isNonPostingBase(t.base) ? 'Tally does not post this type to the ledgers, so the vouchers are kept under Other Voucher Types with no Zoho file and are not part of the Trial Balance movement check.'
        : 'The vouchers are kept under Other Voucher Types. Each one that carries a ledger amount is written as a Manual Journal posting exactly what Tally posted (and is in the Trial Balance movement check); one with no ledger amount has no Zoho file.');
  }
  return `${n} of type "${t.type}": this is not one of Tally's own voucher types, and it could not be traced to one`
    + (mastersAvailable ? ' through the Voucher Type records of the All Masters file.' : ', because no All Masters file with Voucher Type records has been uploaded. Upload the All Masters file: the vouchers are then sorted again.')
    + ' Nothing was guessed from the name. The vouchers are kept under Other Voucher Types. Each one that carries a ledger amount is written as a Manual Journal posting exactly what Tally posted (and is in the Trial Balance movement check); one with no ledger amount has no Zoho file.';
}
