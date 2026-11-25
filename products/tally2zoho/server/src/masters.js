// Reading master records the way real TallyPrime exports write them, and splitting an "All Masters" file.
//
// Two shapes of master record are supported:
//   - the shape of the made-up sample files (and of Tally's help pages): top-level name, mailingname, address,
//     ledstatename, pincode, countryname, partygstin;
//   - the shape of a real TallyPrime 7.1 export: the name only in metadata.name (and languagename), and the contact
//     details in dated lists:
//       ledmailingdetails: [{ applicablefrom: "YYYYMMDD", mailingname, address: [meta, "line", ...], state, pincode, country }]
//       ledgstregdetails:  [{ applicablefrom, gstin, gstregistrationtype, state, placeofsupply }]
//     plus partygstin, incometaxnumber (PAN), contactdetails, openingbalance, and legacy copies oldmailingname,
//     oldaddress, oldledstatename, oldpincode, oldcountryname.
// For a dated list the entry used is the LATEST one whose applicablefrom is on or before the date given (the end of
// the migration's financial year). When every entry is dated after that, the earliest entry is used. An entry
// without a date counts as the earliest. The legacy old* fields are used only when nothing else has a value.

import { listValues, tallyText, recordName, recordParent, entryType, isNotApplicable, cleanIdentifier, cleanLine } from './tally.js';

const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const entries = v => listValues(v).filter(isObj);
const has = v => tallyText(v).trim() !== '';
const first = (...vals) => { for (const v of vals) if (has(v)) return tallyText(v); return ''; };
const lines = v => listValues(v).map(tallyText).filter(s => s.trim() !== '');
const dateOf = e => (/^\d{8}$/.test(String(e?.applicablefrom ?? '')) ? String(e.applicablefrom) : '');

// "2025-03-31" or "20250331" -> "20250331"; anything else -> null (no date limit).
export const asOfKey = d => { const s = String(d ?? '').replace(/-/g, ''); return /^\d{8}$/.test(s) ? s : null; };

// Which entry of a dated Tally list applies on the date asOf ("YYYYMMDD", or null for the latest of all).
// Returns { entry, newer, earliestUsed }:
//   newer: the latest date of an entry dated AFTER asOf ('' when there is none). Such an entry is not used.
//   earliestUsed: true when every entry is dated after asOf, so the earliest one was used.
export function datedEntry(list, asOf) {
  const all = entries(list);
  if (!all.length) return { entry: null, newer: '', earliestUsed: false };
  const within = asOf ? all.filter(e => dateOf(e) <= asOf) : all;
  const pool = within.length ? within : all;
  let best = null;
  for (const e of pool) {
    if (!best) { best = e; continue; }
    const better = within.length ? dateOf(e) >= dateOf(best) : dateOf(e) < dateOf(best); // a later entry of the same date wins
    if (better) best = e;
  }
  const later = asOf ? all.map(dateOf).filter(x => x > asOf).sort() : [];
  return { entry: best, newer: later.length ? later[later.length - 1] : '', earliestUsed: !!asOf && !within.length };
}
export const latestEntry = (list, asOf) => datedEntry(list, asOf).entry;

const DATED_LISTS = { ledmailingdetails: 'mailing details', ledgstregdetails: 'GST registration details' };

// The contact details of a customer or vendor ledger. asOf: "YYYYMMDD" (the end of the financial year) or null.
// Values are text as written in Tally ('' when there is none), with these exceptions, each reported in `cleaned`:
//   - GSTIN, PAN, PIN code, state, place of supply, GST registration type and country lose line breaks, invisible
//     characters and spaces around them (real exports write some GSTINs with a line break at the end);
//   - each address line loses the same around it, and a line break inside it becomes a space.
// The name and the mailing name are NEVER changed (vouchers refer to the name exactly as written); hidden characters in
// them are flagged instead (see the processing checks in index.js and the contact checks in zoho.js).
// legacy lists the old* fields that had to be used.
// dated: for each dated list, { list, newer, earliestUsed } (see datedEntry) when a newer entry was not used or the
// earliest one had to be used. gstinConflict: { party, registration } when partygstin and the GSTIN of the chosen GST
// registration entry are both present and differ; the GSTIN of the chosen entry is then used, so that the GSTIN, the
// GST treatment and the place of supply come from the same registration. registrationUnknown: Tally wrote its
// "Unknown" / "Not Applicable" marker as the GST registration type.
export function contactInfo(d, asOf = null) {
  const mailPick = datedEntry(d?.ledmailingdetails, asOf), gstPick = datedEntry(d?.ledgstregdetails, asOf);
  const mail = mailPick.entry || {}, gst = gstPick.entry || {};
  const legacy = [], cleaned = [];
  const withLegacy = (value, field, old) => { if (value || !has(old)) return value; legacy.push(field); return tallyText(old); };
  const ident = (label, v) => { const c = cleanIdentifier(v); if (c !== v && !cleaned.includes(label)) cleaned.push(label); return c; };
  const cleanLines = list => list.map(l => { const c = cleanLine(l); if (c !== l && !cleaned.includes('address')) cleaned.push('address'); return c; }).filter(Boolean);
  const addressNow = lines(mail.address).length ? lines(mail.address) : lines(d?.address);
  const rawAddress = addressNow.length ? addressNow : lines(d?.oldaddress);
  if (!addressNow.length && rawAddress.length) legacy.push('oldaddress');
  const contacts = entries(d?.contactdetails);
  const party = ident('GSTIN', first(d?.partygstin)), registration = ident('GSTIN', first(gst.gstin));
  const regRaw = gstPick.entry ? gst.gstregistrationtype : d?.gstregistrationtype;
  const dated = [];
  for (const [field, pick] of [['ledmailingdetails', mailPick], ['ledgstregdetails', gstPick]]) {
    if (pick.newer || pick.earliestUsed) dated.push({ list: DATED_LISTS[field], field, newer: pick.newer, earliestUsed: pick.earliestUsed });
  }
  return {
    name: recordName(d),
    mailingName: withLegacy(first(mail.mailingname, d?.mailingname), 'oldmailingname', listValues(d?.oldmailingname).find(has)),
    address: cleanLines(rawAddress),
    state: ident('state', withLegacy(first(mail.state, d?.ledstatename, gst.state), 'oldledstatename', d?.oldledstatename)),
    pincode: ident('PIN code', withLegacy(first(mail.pincode, d?.pincode), 'oldpincode', d?.oldpincode)),
    country: ident('country', withLegacy(first(mail.country, d?.countryname, d?.countryofresidence), 'oldcountryname', d?.oldcountryname)),
    gstin: registration || party,
    registrationType: ident('GST registration type', first(gst.gstregistrationtype, d?.gstregistrationtype)),
    placeOfSupply: ident('place of supply', first(gst.placeofsupply)),
    pan: ident('PAN', first(d?.incometaxnumber)),
    email: first(d?.email, ...contacts.map(c => c.email)),
    // Zoho has a Phone (work) and a MobilePhone column: each is filled from its own Tally field, never from the other.
    phone: first(d?.ledgerphone, ...contacts.map(c => c.phonenumber)),
    mobile: first(d?.ledgermobile, ...contacts.map(c => c.mobilenumber)),
    openingBalance: first(d?.openingbalance),
    // Tally's credit period ("Default credit period" of the ledger, BILLCREDITPERIOD), for example "30 Days". '' when not set.
    creditPeriod: first(d?.billcreditperiod, d?.creditperiod),
    // The ledger's currency. A real TallyPrime export writes the base currency as "₹".
    currency: first(d?.currencyname),
    // Tally's "Is SEZ party" flag of the ledger.
    sez: d?.issezparty === true || /^(yes|true)$/i.test(tallyText(d?.issezparty).trim()),
    legacy, cleaned, dated,
    gstinConflict: party && registration && party !== registration ? { party, registration } : null,
    registrationUnknown: isNotApplicable(regRaw) || (!has(regRaw) && isNotApplicable(d?.gstregistrationtype)),
  };
}

// The Tally fields contactInfo reads. Top level, and inside each dated list (for "fields not transferred").
export const CONTACT_TOP_FIELDS = ['mailingname', 'oldmailingname', 'address', 'oldaddress', 'ledstatename', 'oldledstatename', 'pincode', 'oldpincode',
  'countryname', 'countryofresidence', 'oldcountryname', 'partygstin', 'gstregistrationtype', 'incometaxnumber', 'email', 'ledgerphone', 'ledgermobile',
  'openingbalance', 'ledmailingdetails', 'ledgstregdetails', 'contactdetails', 'billcreditperiod', 'creditperiod', 'currencyname', 'issezparty'];
export const CONTACT_NESTED_FIELDS = {
  ledmailingdetails: ['applicablefrom', 'mailingname', 'address', 'state', 'pincode', 'country'],
  ledgstregdetails: ['applicablefrom', 'gstin', 'gstregistrationtype', 'state', 'placeofsupply'],
  contactdetails: ['email', 'phonenumber', 'mobilenumber'],
};

// A stock item. The HSN code is the top-level hsncode (sample shape) or the latest hsndetails entry's hsncode (real
// shape). hsnSource is Tally's note on where the HSN comes from when the item does not hold it itself, for example
// "As per Company/Stock Group": the code is then on the stock group or the company, which this export may not include.
export function itemInfo(d, asOf = null) {
  const hsn = latestEntry(d?.hsndetails, asOf) || {};
  return {
    name: recordName(d),
    parent: recordParent(d),
    unit: first(d?.baseunits),
    hsn: first(d?.hsncode, hsn.hsncode),
    hsnSource: has(d?.hsncode) || has(hsn.hsncode) ? '' : first(hsn.srcofhsndetails),
    description: first(d?.description),
    openingQuantity: first(d?.openingbalance),
    openingValue: first(d?.openingvalue),
    // Tally's "Type of supply" of the item (GST details): "Goods" or "Services". '' when not set.
    typeOfSupply: first(d?.gsttypeofsupply),
    // Tally's standard selling price and standard cost (latest dated entry), as written, for example "250.00/Nos".
    standardPrice: listRate(d?.standardpricelist, asOf),
    standardCost: listRate(d?.standardcostlist, asOf),
  };
}
// The rate of the latest entry of a Tally standard price or cost list ({ date, rate }) on or before asOf.
function listRate(list, asOf) {
  const all = entries(list).filter(e => has(e.rate));
  const dated = e => (/^\d{8}$/.test(String(e.date ?? '')) ? String(e.date) : '');
  const pool = asOf ? all.filter(e => dated(e) <= asOf) : all;
  let best = null;
  for (const e of pool) if (!best || dated(e) >= dated(best)) best = e;
  return best ? tallyText(best.rate) : '';
}
export const ITEM_NESTED_FIELDS = { hsndetails: ['applicablefrom', 'hsncode', 'srcofhsndetails'], standardpricelist: ['date', 'rate'], standardcostlist: ['date', 'rate'] };

// ---------- the All Masters file ----------
// Where a ledger goes is decided by the group chain above it, walked up to the top: the first of these groups met
// decides. A group renamed in Tally is still recognised by its reserved name (metadata.reservedname).
// TALLY-014: tables keyed by names from the data have no prototype, so a group named "constructor" is an ordinary name.
export const SECTION_GROUPS = Object.assign(Object.create(null), { 'Sundry Debtors': 'customers', 'Sundry Creditors': 'vendors', 'Duties & Taxes': 'taxes' });

// groups: Group records. Returns { parents: { name: parent }, reserved: { name: reservedname }, sectionOf(parentName) }.
export function groupTree(groups) {
  const parents = Object.create(null), reserved = Object.create(null);
  for (const g of groups) {
    const name = recordName(g);
    if (!name || Object.hasOwn(parents, name)) continue;
    parents[name] = recordParent(g);
    const r = tallyText(g?.metadata?.reservedname).trim();
    if (r) reserved[name] = r;
  }
  // 'customers', 'vendors', 'taxes' or null (any other ledger).
  const sectionOf = parent => {
    const seen = new Set();
    for (let g = parent; g && !seen.has(g); g = parents[g]) {
      seen.add(g);
      const s = SECTION_GROUPS[g] || SECTION_GROUPS[reserved[g]];
      if (s) return s;
    }
    return null;
  };
  // true when the group chain above `parent` reaches `group`
  const isUnder = (parent, group) => {
    const seen = new Set();
    for (let g = parent; g && !seen.has(g); g = parents[g]) { seen.add(g); if (g === group || reserved[g] === group) return true; }
    return false;
  };
  return { parents, reserved, sectionOf, isUnder };
}

// The datasets (upload slots) a record of an All Masters file goes to; an empty list when it is not used.
// EVERY ledger goes to the Chart of Accounts, as in a Chart of Accounts file exported on its own from Tally's
// "List of Ledgers (all groups)": that file holds customers, vendors and tax ledgers too, and the Tally groups whose
// Zoho type is an accountant's decision (Sundry Debtors, Sundry Creditors) are asked about in Mapping Studio.
// A ledger under Sundry Debtors, Sundry Creditors or Duties & Taxes (at any depth) ALSO goes to the Customer, Vendor
// or Tax dataset. Every Group record goes to the Chart of Accounts (for the group chain). Stock items and units go to
// their own datasets.
export function routeMaster(m, tree) {
  const type = entryType(m);
  if (type === 'Ledger') { const s = tree.sectionOf(recordParent(m)); return s ? [s, 'accounts'] : ['accounts']; }
  if (type === 'Group') return ['accounts'];
  if (type === 'StockItem') return ['stock_items'];
  if (type === 'Unit') return ['units'];
  return [];
}
export const ALL_MASTERS_SLOTS = ['customers', 'vendors', 'accounts', 'taxes', 'stock_items', 'units'];
// Record types that are vouchers or reports: the platform uses them, but from their own upload slots.
export const NOT_FROM_THIS_FILE = new Set(['Voucher', 'TrialBalanceLine', 'StockSummaryLine']);
