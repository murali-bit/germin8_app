// Ledgers that are in Tally's Trial Balance report but missing from the masters export (round 1, issues 3, 7, 8, 11).
//
// A voucher can name a party or a ledger that the All Masters export does not hold, while Tally's own Trial Balance
// report lists it under its group (Sundry Debtors, Sundry Creditors, Suspense A/c, Current Liabilities ...). Without a
// record the Customers, Vendors or Chart of Accounts file would not create it, and Zoho Books would refuse every
// document naming it. The tool therefore makes the record from what Tally itself gives, and changes nothing else:
//   - the name exactly as the Trial Balance line writes it (pick and drop: no cleaning);
//   - the parent group: the group line directly above it in the report (a group of the masters);
//   - the opening balance: the line's Opening figure, in Tally's sign (a debit is negative);
//   - for a customer or vendor, the party details the vouchers naming it carry: GSTIN (partygstin), GST registration
//     type, state (statename; on a sale, placeofsupply when no state is written), country (countryofresidence), and
//     the currency of a foreign amount on the party's line ("$1800.00 @ ₹85.70/$ = ₹154260.00").
// A line whose group is unknown (no group line above it, or one the masters do not hold) or that sits under Duties &
// Taxes (a tax ledger needs the tax mapping) gets no record: it stays flagged as missing.
// Every record made carries __fromTrialBalance, and the files list it under "Assumptions the tool made"
// (ledger_added_from_trial_balance).
import { groupTree } from './masters.js';
import { tallyText, matchKey, parseTallyAmount, lineList } from './tally.js';

const text = v => tallyText(v).trim();

// The ledger lines of a voucher (allledgerentries / ledgerentries, and the accounting lines of inventory entries).
function voucherLedgerLines(v) {
  const out = [];
  for (const k of ['allledgerentries', 'ledgerentries']) for (const l of lineList(v?.[k])) out.push(l);
  for (const k of ['allinventoryentries', 'inventoryentries']) for (const i of lineList(v?.[k])) for (const a of lineList(i?.accountingallocations)) out.push(a);
  return out;
}

// analysed: the lines of analyseTrialBalance (trialbalance.js). groupRecords: the Group records of the masters (data).
// vouchersNaming(name) -> [voucher data] the stored vouchers that name the ledger (party or line), oldest first.
// Returns { added: [{ name, slots, record, lineNo, group }], skipped: [{ name, why }] }.
export function ledgersFromTrialBalance({ analysed, groupRecords, vouchersNaming = () => [] }) {
  const tree = groupTree(groupRecords);
  const byNo = new Map(analysed.map(l => [l.lineNo, l]));
  const added = [], skipped = [], seen = new Set();
  for (const l of analysed) {
    if (l.hasChildren || l.matchType) continue;
    const name = l.name;
    if (!name || seen.has(matchKey(name))) continue;
    seen.add(matchKey(name));
    const parent = l.parentLine != null ? byNo.get(l.parentLine) : null;
    if (!parent || parent.matchType !== 'group' || !parent.matchName) { skipped.push({ name, why: 'no group of the masters above it in the Trial Balance' }); continue; }
    const group = parent.matchName;
    const section = tree.sectionOf(group);
    if (section === 'taxes') { skipped.push({ name, why: 'it is under Duties & Taxes, and a tax ledger needs the tax mapping' }); continue; }
    const record = { metadata: { type: 'Ledger', name, reservedname: '' }, parent: group };
    const opening = l.opening == null ? '' : String(l.opening).trim();
    if (opening && !/^-?0+(\.0+)?$/.test(opening)) record.openingbalance = opening;
    const from = { lineNo: l.lineNo, group, details: [] };
    if (section === 'customers' || section === 'vendors') {
      record.isbillwiseon = false;
      const vouchers = vouchersNaming(name);
      const key = matchKey(name);
      const v = vouchers.find(x => matchKey(text(x?.partyledgername)) === key) || null;
      let gstin = '', reg = '', state = '', country = '', currency = '';
      if (v) {
        gstin = text(v.partygstin);
        reg = text(v.gstregistrationtype);
        state = text(v.statename) || (section === 'customers' ? text(v.placeofsupply) : '');
        country = text(v.countryofresidence);
      }
      for (const x of vouchers) {
        for (const line of voucherLedgerLines(x)) {
          if (matchKey(text(line?.ledgername)) !== key) continue;
          const a = parseTallyAmount(line?.amount);
          if (a?.currencySymbol) { currency = a.currencySymbol; break; }
        }
        if (currency) break;
      }
      if (gstin) { record.partygstin = gstin; from.details.push(`GSTIN ${gstin}`); }
      if (reg) { record.gstregistrationtype = reg; from.details.push(`registration type ${reg}`); }
      if (country) { record.countryofresidence = country; from.details.push(`country ${country}`); }
      if (state) from.details.push(`state ${state}`);
      if (currency) { record.currencyname = currency; from.details.push(`currency ${currency}`); }
      if (gstin || reg || state) record.ledgstregdetails = [{ ...(reg ? { gstregistrationtype: reg } : {}), ...(state ? { state, placeofsupply: state } : {}), ...(gstin ? { gstin } : {}) }];
      record.ledmailingdetails = [{ mailingname: name, ...(state ? { state } : {}), ...(country ? { country } : {}) }];
      if (v) from.voucher = text(v.vouchernumber) || null;
    }
    record.__fromTrialBalance = from;
    added.push({ name, slots: section ? [section, 'accounts'] : ['accounts'], record, lineNo: l.lineNo, group });
  }
  return { added, skipped };
}

// The words of the flagged item (and assumption) for one record made from the Trial Balance.
export function addedLedgerWords(name, from, slots) {
  const kind = slots.includes('customers') ? 'customer' : slots.includes('vendors') ? 'vendor' : 'account';
  return `"${name}" is not in the masters export, but Tally's Trial Balance report lists it under the group "${from.group}" (line ${from.lineNo}). `
    + `So the files create it as a ${kind} with the name exactly as Tally writes it, the group's type${from.details?.length ? `, and the details the vouchers naming it carry (${from.details.join(', ')})` : ''}`
    + ', and its opening balance is the Opening figure of that line. Nothing else was taken or guessed. Check it in Tally, or export the masters again with this ledger and process again.';
}
