// Cross-checks between vouchers and masters. Run at the end of processing.
//
// These checks only FLAG. They never block, change or correct anything.
// One flagged item is raised per missing name, not one per voucher.
// Names are compared exactly once hidden characters (a line break at the end of a master's name, an invisible
// character) and spaces around the name are ignored: real TallyPrime masters can carry such characters while the
// vouchers name the same ledger without them. Neither value is changed. A voucher name that matches a master only
// after ignoring hidden characters is treated as that master and reported once (kind ledger_name_hidden_characters),
// because the Zoho files carry each name as it is written in its own Tally record.
// A name that differs by capital letters or by spaces inside it is NOT treated as a match; the message says it is
// the likely cause.

import { voucherLines } from './vouchers.js';
import { matchKey, hasHiddenCharacters, lineList } from './tally.js';

const trim = matchKey; // hidden characters removed, then spaces around the name removed
const loose = v => trim(v).toLowerCase().replace(/\s+/g, ' ');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Collects uses of a name: how many different records use it, and the first one.
function tracker() {
  const map = new Map();
  return {
    add(name, rec) {
      let t = map.get(name);
      if (!t) map.set(name, t = { ids: new Set(), first: rec });
      t.ids.add(rec.id);
    },
    entries: () => [...map.entries()].map(([name, t]) => ({ name, uses: t.ids.size, first: t.first })),
  };
}

function nearMatch(name, exactSet, looseIndex) {
  const hit = looseIndex.get(loose(name));
  return hit && !exactSet.has(trim(name)) ? hit : null;
}
const looseIndexOf = names => { const m = new Map(); for (const n of names) if (!m.has(loose(n))) m.set(loose(n), n); return m; };

// input:
//   masters: { customers: [name], vendors: [name], accounts: [name], taxes: [name] }  (Ledger records only)
//   items: [{ id, name, unit }] or null when the Stock Items file was not uploaded
//   units: [name] or null when the Units file was not uploaded
//   vouchers: [{ id, slot, name, data }]  (sales, purchase, receipt, payment, journal)
//   trialBalance: [{ id, name }]
// returns [{ kind, slot, name, uses, message }]
export function crossCheck({ masters, items, units, vouchers, trialBalance }) {
  const c = createCrossCheck({ masters, items, units });
  for (const v of vouchers) c.add(v);
  return c.finish(trialBalance);
}

// The same checks, fed one voucher at a time, so a year of vouchers never has to be held in memory:
//   const c = createCrossCheck({ masters, items, units }); c.add(voucher) for each voucher; c.finish(trialBalance) returns the items.
export function createCrossCheck({ masters, items, units }) {
  const out = [];
  const customers = new Set(masters.customers.map(trim));
  const vendors = new Set(masters.vendors.map(trim));
  const masterNames = [...masters.customers, ...masters.vendors, ...masters.accounts, ...masters.taxes];
  const allLedgers = new Set(masterNames.map(trim));
  const rawLedgers = new Set(masterNames); // the names exactly as the masters write them
  const hiddenMaster = new Set(masterNames.filter(hasHiddenCharacters).map(trim));
  // how each different ledger name written on voucher lines compares with the masters: 'exact', 'hidden' or 'none'
  const nameMatch = new Map(), hiddenUse = tracker();
  const ledgerIndex = looseIndexOf(allLedgers);
  const caseHint = (name, set, index, fileText) => {
    const near = nearMatch(name, set, index);
    return near
      ? ` ${fileText} "${near}", which differs only by capital letters or spaces. This is the likely cause. Correct the name in Tally so both are written exactly the same, then export and upload again.`
      : null;
  };

  // 1. every ledger used on a voucher line must exist in the masters
  const ledgerUse = tracker(), itemUse = tracker(), blankLedger = tracker();
  const salesParty = tracker(), purchaseParty = tracker();
  const noParty = { sales: tracker(), purchase: tracker() };
  let vouchersWithItems = 0;
  const add = v => {
    const lines = voucherLines(v.data);
    for (const l of lines) {
      const name = trim(l.ledger);
      if (!name) { blankLedger.add('', v); continue; }
      if (!allLedgers.has(name)) { ledgerUse.add(name, v); nameMatch.set(l.ledger, 'none'); continue; }
      if (rawLedgers.has(l.ledger)) { nameMatch.set(l.ledger, 'exact'); continue; }
      // the same name except for hidden characters (or spaces around it)
      nameMatch.set(l.ledger, 'hidden');
      if (hiddenMaster.has(name) || hasHiddenCharacters(l.ledger)) hiddenUse.add(name, v);
    }
    let usesItems = false;
    for (const inv of lineList(v.data.allinventoryentries)) { // TALLY-013: a single object or an empty item is read safely
      const item = trim(inv.stockitemname);
      if (item) { itemUse.add(item, v); usesItems = true; }
    }
    if (usesItems) vouchersWithItems++;
    if (v.slot !== 'sales' && v.slot !== 'purchase') return;
    const set = v.slot === 'sales' ? customers : vendors;
    const use = v.slot === 'sales' ? salesParty : purchaseParty;
    const party = trim(v.data.partyledgername);
    if (party) { if (!set.has(party)) use.add(party, v); return; }
    // No party named on the voucher. File generation then looks at the lines, so the check does the same:
    // first the line(s) Tally marks as the party line, then any line that names a customer (or vendor).
    const lineNames = lines.map(l => trim(l.ledger)).filter(Boolean);
    const marked = lines.filter(l => l.party).map(l => trim(l.ledger)).filter(Boolean);
    if (marked.length) { for (const name of new Set(marked)) if (!set.has(name)) use.add(name, v); }
    else if (!lineNames.some(name => set.has(name))) noParty[v.slot].add('', v);
  };

  const finish = trialBalance => {
  for (const u of ledgerUse.entries()) {
    out.push({ kind: 'ledger_missing', slot: u.first.slot, name: u.name, uses: u.uses,
      message: `Ledger "${u.name}" is used on ${plural(u.uses, 'voucher')} (the first is ${u.first.name}) but it is not in the Customer, Vendor, Chart of Accounts or Tax files.`
        + (caseHint(u.name, allLedgers, ledgerIndex, 'Those files have')
          || ' Export the ledger from Tally in the right file and upload it again, or correct the name on the vouchers in Tally.') });
  }
  for (const u of hiddenUse.entries()) {
    out.push({ kind: 'ledger_name_hidden_characters', slot: u.first.slot, name: u.name, uses: u.uses,
      message: `Ledger "${u.name}" is used on ${plural(u.uses, 'voucher')} (the first is ${u.first.name}). The same name in the masters differs only by hidden characters (for example a line break at its end). `
        + 'It was treated as the same ledger and nothing was changed. The master files carry the name as the master writes it and the voucher files as the vouchers write it, so Zoho Books may not see them as the same account. '
        + 'An accountant must decide whether to correct the name in Tally or to clean it for Zoho Books.' });
  }
  for (const u of blankLedger.entries()) {
    out.push({ kind: 'ledger_blank', slot: u.first.slot, name: '(no ledger name)', uses: u.uses,
      message: `${plural(u.uses, 'voucher')} (the first is ${u.first.name}) ${u.uses === 1 ? 'has' : 'have'} a line with no ledger name. Check the voucher in Tally and export again.` });
  }

  // 2. every stock item used on a voucher must exist in the Stock Items file
  const used = itemUse.entries();
  if (items === null) {
    if (used.length) {
      const total = vouchersWithItems;
      out.push({ kind: 'items_not_uploaded', slot: 'stock_items', name: 'Stock Items', uses: total,
        message: `${plural(total, 'voucher')} (the first is ${used[0].first.name}) ${total === 1 ? 'uses' : 'use'} stock items, but the Stock Items file was not uploaded. Upload the Stock Items file in the Upload Center. If these items already exist in Zoho Books you can ignore this notice; nothing is blocked.` });
    }
  } else {
    const itemNames = new Set(items.map(i => trim(i.name)));
    const itemIndex = looseIndexOf(itemNames);
    for (const u of used) {
      if (itemNames.has(u.name)) continue;
      out.push({ kind: 'item_missing', slot: u.first.slot, name: u.name, uses: u.uses,
        message: `Stock item "${u.name}" is used on ${plural(u.uses, 'voucher')} (the first is ${u.first.name}) but it is not in the Stock Items file.`
          + (caseHint(u.name, itemNames, itemIndex, 'The Stock Items file has')
            || ' Export the item from Tally and upload the Stock Items file again, or correct the item name on the vouchers in Tally.') });
    }
  }

  // 3. every stock item's unit must exist in the Units file
  if (items !== null && units !== null) {
    const unitNames = new Set(units.map(trim));
    const unitIndex = looseIndexOf(unitNames);
    const unitUse = tracker();
    for (const i of items) { const unit = trim(i.unit); if (unit && !unitNames.has(unit)) unitUse.add(unit, i); }
    for (const u of unitUse.entries()) {
      out.push({ kind: 'unit_missing', slot: 'stock_items', name: u.name, uses: u.uses,
        message: `Unit "${u.name}" is used by ${plural(u.uses, 'stock item')} (the first is ${u.first.name}) but it is not in the Units file.`
          + (caseHint(u.name, unitNames, unitIndex, 'The Units file has')
            || ' Export the unit from Tally and upload the Units file again, or correct the unit on the stock item in Tally.') });
    }
  }

  // 4. every Trial Balance ledger must exist in the masters
  const tbUse = tracker();
  for (const t of trialBalance) { const name = trim(t.name); if (name && !allLedgers.has(name)) tbUse.add(name, t); }
  for (const u of tbUse.entries()) {
    out.push({ kind: 'trial_balance_ledger_missing', slot: 'trial_balance', name: u.name, uses: u.uses,
      message: `Ledger "${u.name}" is in the Trial Balance but it is not in the Customer, Vendor, Chart of Accounts or Tax files.`
        + (caseHint(u.name, allLedgers, ledgerIndex, 'Those files have')
          || ' Export the ledger from Tally in the right file and upload it again. Its opening balance cannot be imported into Zoho without the account.') });
  }

  // 5. the party on a sales voucher must be a customer, and on a purchase voucher a vendor
  const partyCheck = (use, kindWord, fileName, set, otherSet, otherFile) => {
    const index = looseIndexOf(set);
    const doc = kindWord === 'sales' ? 'invoice' : 'bill';
    const person = kindWord === 'sales' ? 'customer' : 'vendor';
    for (const u of use.entries()) {
      const start = `"${u.name}" is the party on ${plural(u.uses, `${kindWord} voucher`)} (the first is ${u.first.name}) but it is not in the ${fileName} file.`;
      const hint = caseHint(u.name, set, index, `The ${fileName} file has`);
      let rest;
      if (hint) rest = hint;
      else if (otherSet.has(u.name)) rest = ` It is in the ${otherFile} file instead. Check the party in Tally, or add it to the ${fileName} file and upload it again.`;
      // A ledger from the Chart of Accounts or Tax file as the party is normally a cash or bank sale or purchase.
      // It must not be added to the Customer or Vendor file; how to treat it is the accountant's decision.
      else if (allLedgers.has(u.name)) rest = ` It is in the Chart of Accounts or Tax file, so this looks like a cash or bank ${kindWord === 'sales' ? 'sale' : 'purchase'}. Zoho Books needs a ${person} on every ${doc}. An accountant must decide how to treat ${u.uses === 1 ? 'this voucher' : 'these vouchers'} before the import. Nothing was changed.`;
      else rest = ` Check the party in Tally, or add it to the ${fileName} file and upload it again.`;
      out.push({ kind: 'party_missing', slot: u.first.slot, name: u.name, uses: u.uses, message: start + rest });
    }
  };
  partyCheck(salesParty, 'sales', 'Customer', customers, vendors, 'Vendor');
  partyCheck(purchaseParty, 'purchase', 'Vendor', vendors, customers, 'Customer');
  for (const [slot, person, fileName] of [['sales', 'customer', 'Customer'], ['purchase', 'vendor', 'Vendor']]) {
    for (const u of noParty[slot].entries()) {
      out.push({ kind: 'party_blank', slot, name: '(no party named)', uses: u.uses,
        message: `${plural(u.uses, `${slot} voucher`)} (the first is ${u.first.name}) ${u.uses === 1 ? 'has' : 'have'} no party named, and no line names a ${person} from the ${fileName} file. Zoho Books needs a ${person} on every ${slot === 'sales' ? 'invoice' : 'bill'}. Check the voucher in Tally and export again.` });
    }
  }

  return out;
  };
  // How the different ledger names written on voucher lines compare with the masters (counts of names, not of lines).
  const stats = () => {
    const n = { names: nameMatch.size, exact: 0, ignoringHidden: 0, notFound: 0 };
    for (const how of nameMatch.values()) n[how === 'exact' ? 'exact' : how === 'hidden' ? 'ignoringHidden' : 'notFound']++;
    return n;
  };
  return { add, finish, stats };
}
