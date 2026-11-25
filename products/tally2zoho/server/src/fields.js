// The ONE central list of Tally fields the platform reads, per upload slot and record type.
//
// A field counts as "read" only when the server uses it: to write a Zoho file, or for a check, a
// mapping or the record's identity. What is read depends on the dataset (slot), not only on the record
// type: a ledger in the Customer file is written with its address and GSTIN, while a ledger in the
// Tax Configuration file is used only by name.
//
// Derived from what the code actually uses:
//   tally.js    - guid, remoteid, date, vouchertypename, ledger entry and inventory amounts
//   zoho.js     - the master fields written to the Zoho files (contactRow, accounts, items, opening balances)
//   vouchers.js - voucher header and line fields
//   index.js    - name (record name), parent (group check on upload), baseunits (unit cross-check)
//   extras.js   - parent of Group records (main group lookup), originalname of units (unit mapping)
//
// Fields that are only SHOWN in the Data Explorer screen (for example taxtype, gstdutyhead, issimpleunit,
// closingquantity, closingvalue) are NOT in this list: showing a value on screen does not transfer it.
//
// Field names are compared exactly as the readers access them (lower case). A field written with
// capital letters in the file, for example "Name", is not read by the platform and is reported.
//
// Anything in an uploaded record that is NOT listed here is reported to the user as
// "not read by the platform", so nothing is lost without the user knowing.
// When code starts reading a new field, add it here.

// Real TallyPrime exports: the record name is read from metadata.name (metadata is never reported), or from the
// languagename list when there is no other name; only the aliases in languagename are reported (languagename.alias). Contact details are read from the dated lists ledmailingdetails and
// ledgstregdetails: the fields used inside those lists are listed in NESTED_FIELDS, and any other field inside them
// is reported with its path, for example "ledgstregdetails.istransporter".

import { mostSimilar } from './similar.js';
import { entryType, recordName, lineList } from './tally.js';
import { contactInfo, itemInfo, CONTACT_TOP_FIELDS, CONTACT_NESTED_FIELDS, ITEM_NESTED_FIELDS } from './masters.js';

const ID = ['guid', 'remoteid'];
const CONTACT = [...new Set([...ID, 'name', 'parent', 'mailingname', 'partygstin', 'incometaxnumber', 'email', 'ledgerphone', 'ledgermobile', 'address',
  'ledstatename', 'pincode', 'countryname', 'openingbalance', ...CONTACT_TOP_FIELDS])];
// Confirmed on a real TallyPrime 7.1 Transactions export. The voucher type is read from metadata.vchtype (metadata is
// never reported) or vouchertypename; the identity from guid (metadata.remoteid holds the same value). The three status
// flags decide whether a voucher may reach a Zoho file at all (voucherStatus in tally.js). Everything else a real
// voucher carries (bank details, reference date, party GSTIN and address, GST overrides and the many GST status flags)
// is NOT read and is listed as not transferred. For the Invoices and Bills files (B6) the supplier's reference number,
// the place of supply, the company's GST state, and on each line the GST rates per duty head (ratedetails) and the
// HSN/SAC code are read too. For payments and notes (B8) the bill-wise details of each line (billallocations: name,
// bill type and amount) are read, to find the invoice or bill each amount settles.
const VOUCHER = [...ID, 'date', 'vouchertypename', 'vouchernumber', 'partyledgername', 'narration', 'reference', 'placeofsupply', 'cmpgststate', 'cmpgstin', 'cmpgstregistrationtype',
  'ledgerentries', 'allledgerentries', 'allinventoryentries',
  'iscancelled', 'isoptional', 'isdeleted', 'vchstatusiscancelled', 'vchstatusisoptional', 'vchstatusisdeleted'];

export const FIELDS_READ = {
  customers: { Ledger: CONTACT },
  vendors: { Ledger: CONTACT },
  accounts: { Ledger: [...ID, 'name', 'parent', 'description', 'openingbalance'], Group: [...ID, 'name', 'parent'] },
  // the ledger name (tax mapping), and what Tally says the ledger is: GST duty head and rate, or TDS and its nature of payment
  taxes: { Ledger: [...ID, 'name', 'parent', 'taxtype', 'gstdutyhead', 'rateoftaxcalculation', 'tdsratename'] },
  stock_items: { StockItem: [...ID, 'name', 'description', 'baseunits', 'hsncode', 'hsndetails', 'openingbalance', 'openingvalue', 'gsttypeofsupply', 'standardpricelist', 'standardcostlist'] },
  units: { Unit: [...ID, 'name', 'originalname'] },
  sales: { Voucher: VOUCHER },
  purchase: { Voucher: VOUCHER },
  receipt: { Voucher: VOUCHER },
  payment: { Voucher: VOUCHER },
  journal: { Voucher: VOUCHER },
  contra: { Voucher: VOUCHER },
  debit_note: { Voucher: VOUCHER },
  credit_note: { Voucher: VOUCHER },
  other_vouchers: { Voucher: VOUCHER },
  // name and closingbalance: a file of Trial Balance lines. The rest: the lines of a Tally Trial Balance report, as
  // trialbalance.js writes them (every figure of the report is read; a field of the report that is not is listed).
  trial_balance: { TrialBalanceLine: [...ID, 'name', 'closingbalance', 'lineno', 'depth', 'haschildren', 'parentline', 'openingbalance', 'debittotal', 'credittotal', 'notes'] },
  stock_summary: { StockSummaryLine: [...ID, 'name'] },
};

// Datasets that are read and checked, but from which no Zoho file is created yet.
// The fields listed as read for them are used for checks only.
export const NOT_TRANSFERRED_YET = {
  taxes: 'No Zoho file is created from this dataset. The ledger names are used for tax and TDS mapping, and the duty head, rate and TDS type to put the tax on invoice and bill lines.',
  units: 'No Zoho file is created from this dataset. The unit names are used for unit mapping and checks only.',
  stock_summary: 'No Zoho file is created from this dataset yet. Only the item names are read.',
  other_vouchers: 'Read and kept. A voucher of these types that posts to the ledgers (Payroll, a custom type) is written as a Manual Journal and is in the Trial Balance check; Memorandum, Reversing Journal, order vouchers and vouchers with no ledger amount post nothing in Tally and get no Zoho file.',
};

// ---------- grouping a long list of fields not transferred ----------
// A real voucher carries well over a hundred fields the platform does not read, most of them GST and other statutory
// status flags. For voucher datasets the list is also given in groups, so it can be read. The first group that fits wins.
const FIELD_GROUPS = [
  ['Bill-wise and bank details', /(^|\.)(billallocations|bankallocations)(\.|$)/],
  ['Party, address and place of supply', /party|consignee|buyer|address|statename|placeofsupply|countryofresidence|pincode|mailing/],
  ['Reference numbers and dates', /^(reference|referencedate|effectivedate|vchstatusdate)$/],
  ['Tally internal (identifiers, numbering, screen view)', /^(masterid|alterid|voucherkey|voucherretainkey|vouchernumberseries|numberingstyle|persistedview|vchentrymode|oldauditentryids|vchstatusvouchertype|vchstatusisvchnumused|isinvoice|hascashflow)$|\.oldauditentryids$/],
  ['GST, tax and other statutory details', /gst|irn|eway|einv|tds|tcs|vat|excise|cst|servicetax|hsn|itc|rcm|tax|boe|customs|fbt|ratedetails|rateof/],
  ['Other details on the voucher lines', /^(allledgerentries|ledgerentries|allinventoryentries)\./],
];
export const fieldGroup = name => (FIELD_GROUPS.find(([, re]) => re.test(name)) || ['Other voucher details'])[0];
const VOUCHER_SLOT_KEYS = new Set(['sales', 'purchase', 'receipt', 'payment', 'journal', 'contra', 'debit_note', 'credit_note', 'other_vouchers']);

// Fields read inside voucher line lists. The key is the path of the list inside the voucher.
export const VOUCHER_LINE_FIELDS = {
  'ledgerentries': ['ledgername', 'amount', 'ispartyledger', 'ratedetails', 'gsthsnname', 'hsncode', 'billallocations'],
  'allledgerentries': ['ledgername', 'amount', 'ispartyledger', 'ratedetails', 'gsthsnname', 'hsncode', 'billallocations'],
  // bill-wise details: which invoice or bill a payment, receipt or note settles (payments.js)
  'ledgerentries.billallocations': ['name', 'billtype', 'amount'],
  'allledgerentries.billallocations': ['name', 'billtype', 'amount'],
  'ledgerentries.ratedetails': ['gstratedutyhead', 'gstrate', 'gstratevaluationtype'],
  'allledgerentries.ratedetails': ['gstratedutyhead', 'gstrate', 'gstratevaluationtype'],
  'allinventoryentries': ['stockitemname', 'billedqty', 'actualqty', 'rate', 'accountingallocations', 'ratedetails', 'gsthsnname', 'hsncode'],
  'allinventoryentries.ratedetails': ['gstratedutyhead', 'gstrate', 'gstratevaluationtype'],
  'allinventoryentries.accountingallocations': ['ledgername', 'amount'],
};
// Fields read inside the dated lists of master records (only where the list itself is read for the dataset).
const NESTED_FIELDS = { ...VOUCHER_LINE_FIELDS, ...CONTACT_NESTED_FIELDS, ...ITEM_NESTED_FIELDS };

const STORED_LIST_CAP = 50; // names kept with the upload; the true count is always stored

const isNotApplicableMarker = v => typeof v === 'string' && v.includes('\u0004') && /not applicable/i.test(v);
// Empty, false, or Tally's "not applicable" marker (control character 4 followed by " Not Applicable").
function isEmpty(v) {
  if (v == null || v === false) return true;
  if (typeof v === 'string') return v.trim() === '' || (v.includes('\u0004') && /not applicable/i.test(v));
  if (Array.isArray(v)) return v.every(x => (x && typeof x === 'object' && !Array.isArray(x) && x.metadata === true) || isEmpty(x));
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
}

// found: Map of field path -> the read field it resembles (differs only by capital letters), or null.
function collect(obj, read, prefix, found) {
  for (const [key, v] of Object.entries(obj)) {
    if (key === 'metadata' || isEmpty(v)) continue;
    const pathName = prefix ? `${prefix}.${key}` : key;
    if (!read.includes(key)) { // exact comparison, as the readers do
      const lower = key.toLowerCase();
      found.set(pathName, lower !== key && (read.includes(lower) || lower === 'metadata') ? lower : null);
      continue;
    }
    const lineFields = NESTED_FIELDS[pathName];
    if (lineFields && Array.isArray(v)) {
      for (const line of v) if (line && typeof line === 'object' && !Array.isArray(line)) collect(line, lineFields, pathName, found);
    }
  }
}

// records: the "tallymessage" list of an uploaded file. slotKey: the upload slot the file was put in.
// Returns { count, fields: [{ name, records, likeField? }], truncated, note? } where count is the true number of
// different fields not read, and fields is the list (most common first), capped.
// likeField is set when the name differs from a field the platform reads only by capital letters.
// note is set for datasets from which no Zoho file is created yet.
export function fieldsNotRead(records, slotKey) {
  const c = fieldsNotReadCollector(slotKey);
  for (const m of records) c.add(m);
  return c.result();
}

// The same, one record at a time, so a large file never has to be held in memory: add(record) for each record, then result().
export function fieldsNotReadCollector(slotKey) {
  const lists = FIELDS_READ[slotKey] || {};
  const tally = new Map(), like = new Map();
  return {
    add(m) {
      if (!m || typeof m !== 'object') return;
      const type = entryType(m);
      let read = lists[type] || [];
      // languagename holds the record's name (read, or the same as metadata.name) and its aliases, which are not
      // transferred: only the aliases are reported, as "languagename.alias".
      if (type !== 'Voucher' && m.languagename !== undefined) {
        const names = [];
        for (const l of Array.isArray(m.languagename) ? m.languagename : []) {
          if (l && typeof l === 'object' && !Array.isArray(l) && l.metadata !== true) {
            for (const x of Array.isArray(l.name) ? l.name : [l.name]) if (typeof x === 'string' && x.trim()) names.push(x);
          }
        }
        const aliases = names.slice(1);
        m = { ...m };
        delete m.languagename;
        if (aliases.length) m['languagename.alias'] = aliases;
      }
      // index.js falls back to ledgername, then stockitemname, only when a master record has no name.
      if (type !== 'Voucher' && !recordName(m)) read = [...read, 'ledgername', ...(m.ledgername == null ? ['stockitemname'] : [])];
      const found = new Map();
      collect(m, read, '', found);
      for (const [name, likeField] of found) {
        tally.set(name, (tally.get(name) || 0) + 1);
        if (likeField) like.set(name, likeField);
      }
    },
    result() {
      const fields = [...tally.entries()].map(([name, n]) => ({ name, records: n, ...(like.has(name) ? { likeField: like.get(name) } : {}) }))
        .sort((a, b) => b.records - a.records || a.name.localeCompare(b.name));
      const note = NOT_TRANSFERRED_YET[slotKey];
      // voucher datasets: every field, in groups (the plain list above stays capped, most common first)
      let groups = null;
      if (VOUCHER_SLOT_KEYS.has(slotKey) && fields.length) {
        groups = [];
        for (const f of fields) {
          const name = fieldGroup(f.name);
          let g = groups.find(x => x.name === name);
          if (!g) groups.push(g = { name, fields: [] });
          g.fields.push({ name: f.name, records: f.records });
        }
        groups.sort((a, b) => b.fields.length - a.fields.length || a.name.localeCompare(b.name));
      }
      return { count: fields.length, fields: fields.slice(0, STORED_LIST_CAP), truncated: fields.length > STORED_LIST_CAP, ...(note ? { note } : {}), ...(groups ? { groups } : {}) };
    },
  };
}

// ---------- key fields: the fields the platform depends on ----------
// IMPORTANT: these field names come from the sample payloads in Tally's help pages. They have NOT been confirmed on
// real exports. When a real file uses other names, the upload must say so loudly instead of quietly reading nothing.
//
// level 'required': the platform cannot work with the record without it.
// level 'optional': important, but it may legitimately be empty (for example a customer with no GSTIN).
// any:  several field names, any one of which satisfies the entry.
// line: the field is looked for on the voucher's lines (ledger entries and the accounting allocations of inventory entries).
// typeMarker: how the upload itself recognises the record. A file cannot be accepted without it, so it is left out
//             of the "may not be readable" rule.
// get: a function that reads the value the way the platform does (for example the name from name, metadata.name or
//      languagename; the state from the latest ledmailingdetails entry or ledstatename). similarTo: the names used to
//      look for similar field names when the value is in no record.
const K = (field, level, description, extra = {}) => ({ field, level, description, ...extra });
const NAME = { get: m => recordName(m), similarTo: ['name'] };
const NAME_LEDGER = K('name', 'required', 'the ledger name, which every Zoho file, check and mapping is keyed on (the top-level name, or metadata.name in real TallyPrime exports)', NAME);
// o: { asOf } - the end of the migration's financial year, so the upload reads the dated details exactly as the Zoho files do
const contact = (m, o) => contactInfo(m, o?.asOf ?? null);
const CONTACT_KEYS = who => [
  NAME_LEDGER,
  K('parent', 'optional', `the Tally group, used to check that the file holds ${who} ledgers`),
  K('partygstin', 'optional', `the GSTIN written in the ${who} file (partygstin, or the gstin in ledgstregdetails)`, { get: (m, o) => contact(m, o).gstin, similarTo: ['partygstin'] }),
  K('ledstatename or ledmailingdetails.state', 'optional', `the billing state written in the ${who} file`, { get: (m, o) => contact(m, o).state, similarTo: ['ledstatename', 'state'] }),
  K('address or ledmailingdetails.address', 'optional', `the billing address written in the ${who} file`, { get: (m, o) => contact(m, o).address, similarTo: ['address'] }),
  K('openingbalance', 'optional', `the opening balance written in the ${who} file`),
];
const VOUCHER_KEYS = partyDoc => [
  K('date', 'required', 'the voucher date'),
  K('vouchernumber', 'required', 'the voucher number, which identifies the document in the Zoho file and in every check'),
  K('metadata.vchtype or vouchertypename', 'required', 'the voucher type, used to check that the file holds the right kind of voucher', { any: ['metadata.vchtype', 'vouchertypename'], typeMarker: true }),
  K('ledgerentries, allledgerentries or allinventoryentries', 'required', 'the lines of the voucher (ledgers and amounts)', { any: ['ledgerentries', 'allledgerentries', 'allinventoryentries'] }),
  K('ledgername (on the voucher lines)', 'required', 'the ledger of each voucher line', { any: ['ledgername'], line: true }),
  K('amount (on the voucher lines)', 'required', 'the amount of each voucher line', { any: ['amount'], line: true }),
  ...(partyDoc ? [K('partyledgername', 'optional', `the ${partyDoc} on the voucher; when it is empty the platform looks for the ${partyDoc} on the lines`)] : []),
];
export const KEY_FIELDS = {
  customers: { Ledger: CONTACT_KEYS('customer') },
  vendors: { Ledger: CONTACT_KEYS('vendor') },
  accounts: {
    Ledger: [NAME_LEDGER, K('parent', 'required', 'the Tally group, from which the Zoho account type is decided')],
    Group: [K('name', 'required', 'the group name', NAME), K('parent', 'required', 'the group above this one, used to find the main group of a ledger (Tally\'s top-level groups have none)')],
  },
  taxes: { Ledger: [K('name', 'required', 'the tax ledger name, used for tax mapping and to recognise tax lines on vouchers', NAME), K('parent', 'optional', 'the Tally group, used to check that the file holds tax ledgers')] },
  stock_items: { StockItem: [
    K('name', 'required', 'the stock item name', NAME),
    K('baseunits', 'required', 'the unit of the item, written in the Items file and checked against the Units file'),
    K('openingbalance', 'optional', 'the opening quantity written in the Items file'),
    K('openingvalue', 'optional', 'the opening stock value written in the Items file'),
    K('hsncode', 'optional', 'the HSN code written in the Items file (hsncode, or the hsncode in hsndetails)', { get: (m, o) => itemInfo(m, o?.asOf ?? null).hsn, similarTo: ['hsncode'] }),
  ] },
  units: { Unit: [K('name', 'required', 'the unit name, used for unit mapping and checks', NAME), K('originalname', 'optional', 'the full name of the unit, shown in unit mapping')] },
  sales: { Voucher: VOUCHER_KEYS('customer') },
  purchase: { Voucher: VOUCHER_KEYS('vendor') },
  receipt: { Voucher: VOUCHER_KEYS(null) },
  payment: { Voucher: VOUCHER_KEYS(null) },
  journal: { Voucher: VOUCHER_KEYS(null) },
  contra: { Voucher: VOUCHER_KEYS(null) },
  debit_note: { Voucher: VOUCHER_KEYS(null) },
  credit_note: { Voucher: VOUCHER_KEYS(null) },
  other_vouchers: { Voucher: VOUCHER_KEYS(null) },
  trial_balance: { TrialBalanceLine: [K('name', 'required', 'the ledger name of the Trial Balance line', NAME), K('closingbalance', 'required', 'the balance of the ledger, written in the Opening Balances file (from a Tally Trial Balance report the opening balance column is written instead, and the closing balance is used for the checks)')] },
  stock_summary: { StockSummaryLine: [
    K('name', 'required', 'the stock item name', NAME),
    K('closingquantity', 'optional', 'the stock quantity; it is shown on screen only, nothing is transferred from it yet'),
    K('closingvalue', 'optional', 'the stock value; it is shown on screen only, nothing is transferred from it yet'),
  ] },
};

const at = (obj, dotted) => dotted.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
function* voucherLineObjects(m) {
  // TALLY-013: every list read through lineList (a single object is a one-item list, empty items are skipped)
  for (const list of [m.ledgerentries, m.allledgerentries]) for (const l of lineList(list)) yield l;
  for (const inv of lineList(m.allinventoryentries)) {
    yield { __inventory: inv };
    for (const l of lineList(inv.accountingallocations)) yield l;
  }
}

// Counts, record by record, in how many records each key field is present (present = it has a value).
// slot: the catalogue entry. add(record) for each record, then result(), which returns
//   { mayNotBeReadable, fields: [{ field, recordType, description, level, present, total, status, similar, severity, message }], warnings, notices }
// status: 'present' (every record), 'partial' (some), 'absent' (none). similar: names found in the file that look like the field.
// severity: 'warning' (a required field is in no record), 'info', or null (nothing to say).
// It never rejects anything.
// opts.asOf: the end of the migration's financial year ("YYYYMMDD"), as used by the Zoho file builders; null for the latest details.
export function keyFieldCollector(slot, opts = {}) {
  const specs = KEY_FIELDS[slot.key] || {};
  const state = {}; // record type -> { total, present: [n per spec], names: Set, lineNames: Set }
  return {
    add(m) {
      if (!m || typeof m !== 'object') return;
      const type = entryType(m);
      const list = specs[type];
      if (!list) return;
      const s = (state[type] ||= { total: 0, present: list.map(() => 0), notApplicable: list.map(() => 0), names: new Set(), lineNames: new Set() });
      s.total++;
      for (const k of Object.keys(m)) if (k !== 'metadata') s.names.add(k);
      const lines = type === 'Voucher' ? [...voucherLineObjects(m)] : [];
      for (const l of lines) for (const k of Object.keys(l.__inventory || l)) if (k !== 'metadata') s.lineNames.add(k);
      list.forEach((spec, i) => {
        const names = spec.any || [spec.field];
        const here = spec.get ? !isEmpty(spec.get(m, opts))
          : spec.line
            ? lines.some(l => !l.__inventory && names.some(n => !isEmpty(l[n])))
            : names.some(n => !isEmpty(at(m, n)));
        if (here) s.present[i]++;
        // the field is there, but Tally wrote its "not applicable" marker: Tally holds no value for it
        else if (!spec.get && !spec.line && names.some(n => isNotApplicableMarker(at(m, n)))) s.notApplicable[i]++;
      });
    },
    result() {
      const fields = [], warnings = [], notices = [];
      let mayNotBeReadable = false;
      for (const [type, list] of Object.entries(specs)) {
        const s = state[type];
        if (!s) continue;
        const what = `${s.total} ${type} record${s.total === 1 ? '' : 's'}`;
        list.forEach((spec, i) => {
          const present = s.present[i];
          const status = present === s.total ? 'present' : present === 0 ? 'absent' : 'partial';
          const wanted = spec.similarTo || spec.any || [spec.field];
          const pool = [...(spec.line ? s.lineNames : s.names)].filter(n => !wanted.includes(n));
          const allNotApplicable = status === 'absent' && s.notApplicable[i] === s.total;
          const similar = status === 'absent' && !allNotApplicable ? [...new Set(wanted.flatMap(w => mostSimilar(w.split('.').pop(), pool)))].slice(0, 5) : [];
          let severity = null, message = null;
          if (allNotApplicable) {
            // The field name is right; Tally itself holds no value. Said plainly, without suggesting another field name.
            severity = spec.level === 'required' ? 'warning' : 'info';
            message = `${slot.name}: in all ${what} the field "${spec.field}" is "Not Applicable" in Tally, so Tally holds no value for it. The platform uses it for ${spec.description}. `
              + 'The field name is right; the value is empty in Tally itself. Nothing was changed or guessed.';
            (severity === 'warning' ? warnings : notices).push(message);
          } else if (status === 'absent' && spec.level === 'required') {
            severity = 'warning';
            message = `${slot.name}: none of the ${what} in this file has a value in the field "${spec.field}". The platform uses it for ${spec.description}. `
              + 'The Tally export may use a different field name, so this file may not be read correctly. '
              + (similar.length ? `Fields found in the file with a similar name: ${similar.map(n => `"${n}"`).join(', ')}.` : 'No field with a similar name was found in the file.')
              + ' Nothing was changed or guessed. Check the export before you continue.';
            warnings.push(message);
          } else if (status === 'partial' && spec.level === 'required') {
            severity = 'info';
            message = `${slot.name}: the field "${spec.field}" has a value in ${present} of ${what}. The platform uses it for ${spec.description}.`;
            notices.push(message);
          } else if (status === 'absent') {
            severity = 'info';
            message = `${slot.name}: none of the ${what} has a value in the field "${spec.field}" (${spec.description}). This can be correct. If Tally does hold these values, the export may use a different field name.`
              + (similar.length ? ` Fields found with a similar name: ${similar.map(n => `"${n}"`).join(', ')}.` : '');
            notices.push(message);
          }
          fields.push({ field: spec.field, recordType: type, description: spec.description, level: spec.level, present, total: s.total, status, similar, severity, message });
        });
        if (type === slot.expects) {
          const needed = list.map((spec, i) => ({ spec, i })).filter(x => x.spec.level === 'required' && !x.spec.typeMarker);
          mayNotBeReadable = s.total > 0 && needed.length > 0 && needed.every(x => s.present[x.i] === 0);
        }
      }
      if (mayNotBeReadable) {
        warnings.unshift(`${slot.name}: this file may not be readable. Every field the platform needs is missing from every record, so the export probably uses different field names than the platform expects. The file was accepted, but nothing useful can be taken from it as it is.`);
      }
      return { mayNotBeReadable, fields, warnings, notices };
    },
  };
}
