// Values written in the format Zoho Books (India edition) accepts on import.
//
// Every list here was taken from the official Zoho Books sample import files (zoho-samples/ in the project):
//  - customer_import_sample_data.xls and vendor_import_sample_data.xls, sheet "Field Explanation" (allowed values) and
//    sheet "Sample Data" (example rows);
//  - sample_accounts.csv and sample_items2.csv (example rows).
// A Tally value that cannot be translated to one of these values with certainty is NOT guessed: the cell is left
// empty and the caller raises a flagged item that says what is needed.

import fs from 'node:fs';

// GST Treatment, "Allowed values" in both contact samples. ("consumer" is not in that list, so it is never written.)
export const GST_TREATMENTS = ['business_gst', 'business_none', 'business_registered_composition', 'business_sez', 'overseas'];

// ---------- the two sets of GST Treatment codes ----------
// Zoho publishes two different sets of codes for the same thing and it is not known which one its import accepts:
//  - 'sample': the "Allowed values" of the official import sample files (customer_import_sample_data.xls and
//    vendor_import_sample_data.xls, sheet "Field Explanation"), and the codes in their example rows. The default.
//  - 'help': the codes on Zoho Books' help page for GST treatments (business_registered_regular, business_unregistered,
//    consumer, ...).
// A firm admin chooses the set (Company Settings). After the first test import, if Zoho rejects the codes, switching
// the set and creating the Customers and Vendors files again is one click.
// Each set maps the platform's own kinds of GST treatment (worked out from Tally's registration type, see
// gstTreatment in zoho.js) to a code. null means the set has no single code for that kind: the cell is left empty
// and flagged, never guessed.
export const GST_CODE_SET_IDS = ['sample', 'help'];
export const DEFAULT_GST_CODE_SET = 'sample';
export const GST_KINDS = {
  regular: 'Registered under GST (regular scheme)',
  composition: 'Registered under the composition scheme',
  sez: 'A unit in a Special Economic Zone (SEZ)',
  unregistered: 'A business not registered under GST',
  consumer: 'A consumer (an individual buying for personal use)',
  unregistered_or_consumer: 'Tally says "Unregistered/Consumer" (Tally does not say which of the two)',
  overseas: 'A party outside India',
};
export const GST_CODE_SETS = {
  sample: {
    label: "As in Zoho's import sample files (default)",
    explanation: "The codes written in Zoho's own sample import files for customers and vendors. Zoho's sample has no separate code for an unregistered business and a consumer: both are business_none.",
    codes: { regular: 'business_gst', composition: 'business_registered_composition', sez: 'business_sez', unregistered: 'business_none', consumer: 'business_none', unregistered_or_consumer: 'business_none', overseas: 'overseas' },
    // codes in this set that the platform never writes, because no Tally registration type means them
    notWritten: {},
  },
  help: {
    label: "As on Zoho's help page",
    explanation: "The codes listed on Zoho Books' help page for GST treatments. They tell an unregistered business apart from a consumer, so a Tally party marked \"Unregistered/Consumer\" is left empty and flagged: an accountant must say which it is.",
    codes: { regular: 'business_registered_regular', composition: 'business_registered_composition', sez: 'business_sez', unregistered: 'business_unregistered', consumer: 'consumer', unregistered_or_consumer: null, overseas: 'overseas' },
    notWritten: { deemed_export: 'Deemed export', tax_deductor: 'A government body that deducts tax (tax deductor)', sez_developer: 'A developer of a Special Economic Zone' },
  },
};
export const gstCodeSet = id => GST_CODE_SETS[id] || GST_CODE_SETS[DEFAULT_GST_CODE_SET];
// The words shown for a GST Treatment code on the screens (the files keep the code).
export const GST_TREATMENT_LABELS = {
  business_gst: 'Registered (regular)', business_registered_regular: 'Registered (regular)', business_registered_composition: 'Registered (composition)',
  business_sez: 'SEZ', business_none: 'Unregistered', business_unregistered: 'Unregistered', consumer: 'Consumer', overseas: 'Overseas',
  deemed_export: 'Deemed export', tax_deductor: 'Tax deductor', sez_developer: 'SEZ developer',
};
export const gstTreatmentLabel = code => (code ? GST_TREATMENT_LABELS[code] || code : '');
// Every code of a set, for checks and for the screen.
export const gstCodesOf = id => [...new Set(Object.values(gstCodeSet(id).codes).filter(Boolean))];
// The settings screen: each code with what it means, in plain words.
export function describeGstCodeSets() {
  return GST_CODE_SET_IDS.map(id => {
    const s = GST_CODE_SETS[id];
    return {
      id, label: s.label, explanation: s.explanation,
      rows: Object.entries(GST_KINDS).map(([kind, meaning]) => ({ kind, meaning, code: s.codes[kind] })),
      notWritten: Object.entries(s.notWritten).map(([code, meaning]) => ({ code, meaning })),
    };
  });
}

// Place of Contact / Source Of Supply: "two letter StateCode": the 36 codes listed in both contact samples, and the two
// codes Zoho's help page adds, LA (Ladakh) and OT (Other Territory), which are not in the samples and have not been tried
// in an import yet (docs/ZOHO_IMPORT_RULES.md 10.2; STATE_CODES_NOT_TRIED).
export const STATE_CODES = {
  AN: 'Andaman and Nicobar Islands', AD: 'Andhra Pradesh', AR: 'Arunachal Pradesh', AS: 'Assam', BR: 'Bihar', CH: 'Chandigarh',
  CG: 'Chhattisgarh', DN: 'Dadra and Nagar Haveli', DD: 'Daman and Diu', DL: 'Delhi', GA: 'Goa', GJ: 'Gujarat',
  HR: 'Haryana', HP: 'Himachal Pradesh', JK: 'Jammu and Kashmir', JH: 'Jharkhand', KA: 'Karnataka', KL: 'Kerala',
  LD: 'Lakshadweep', MP: 'Madhya Pradesh', MH: 'Maharashtra', MN: 'Manipur', ML: 'Meghalaya', MZ: 'Mizoram',
  NL: 'Nagaland', OD: 'Odisha', PY: 'Puducherry', PB: 'Punjab', RJ: 'Rajasthan', SK: 'Sikkim',
  TN: 'Tamil Nadu', TS: 'Telangana', TR: 'Tripura', UP: 'Uttar Pradesh', UK: 'Uttarakhand', WB: 'West Bengal',
  LA: 'Ladakh', OT: 'Other Territory',
};
export const STATE_CODES_NOT_TRIED = ['LA', 'OT'];
// Other spellings Tally (or users) write for the same states. "Dadra & Nagar Haveli and Daman & Diu" (one Union
// Territory since 2020) is DN: Zoho's help page gives DN for the merged territory (DD is the old code of Daman and Diu).
const STATE_ALIASES = {
  'andaman and nicobar': 'AN', 'andaman nicobar islands': 'AN', orissa: 'OD', pondicherry: 'PY', uttaranchal: 'UK',
  'new delhi': 'DL', 'nct of delhi': 'DL', 'delhi nct': 'DL', 'jammu kashmir': 'JK', 'daman diu': 'DD', 'dadra nagar haveli': 'DN',
  'dadra nagar haveli daman diu': 'DN', 'dadra and nagar haveli and daman and diu': 'DN', 'the dadra and nagar haveli and daman and diu': 'DN', 'other territories': 'OT',
};
const stateKey = s => String(s ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z]+/g, ' ').replace(/\band\b/g, ' ').replace(/\s+/g, ' ').trim();
const BY_NAME = new Map([
  ...Object.entries(STATE_CODES).map(([code, name]) => [stateKey(name), code]),
  ...Object.entries(STATE_ALIASES).map(([name, code]) => [stateKey(name), code]),
]);
// The Zoho state code of a state name as written in Tally, or '' when it cannot be told with certainty.
// A two-letter code that is already one of Zoho's codes is accepted as it is.
export function stateCode(name) {
  const raw = String(name ?? '').trim();
  if (!raw) return '';
  if (/^[A-Za-z]{2}$/.test(raw) && STATE_CODES[raw.toUpperCase()]) return raw.toUpperCase();
  return BY_NAME.get(stateKey(raw)) || '';
}

// The state of a GSTIN, from its first two digits (the GST state code). 26 is the merged Dadra and Nagar Haveli and
// Daman and Diu (DN); 25 the old Daman and Diu (DD); 38 Ladakh (LA) and 97 Other Territory (OT), from Zoho's help page.
// A code with no Zoho code (Centre Jurisdiction 99) gives ''.
const GSTIN_STATE = {
  '01': 'JK', '02': 'HP', '03': 'PB', '04': 'CH', '05': 'UK', '06': 'HR', '07': 'DL', '08': 'RJ', '09': 'UP', 10: 'BR', 11: 'SK', 12: 'AR',
  13: 'NL', 14: 'MN', 15: 'MZ', 16: 'TR', 17: 'ML', 18: 'AS', 19: 'WB', 20: 'JH', 21: 'OD', 22: 'CG', 23: 'MP', 24: 'GJ', 25: 'DD', 26: 'DN',
  27: 'MH', 28: 'AD', 29: 'KA', 30: 'GA', 31: 'LD', 32: 'KL', 33: 'TN', 34: 'PY', 35: 'AN', 36: 'TS', 37: 'AD', 38: 'LA', 97: 'OT',
};
export const gstinStateCode = gstin => GSTIN_STATE[String(gstin ?? '').slice(0, 2)] || '';

// Why a GSTIN cannot be right, or null: the format (2 digits of the state, the PAN, the entity number, "Z", the check
// character), a state code that exists, and the check character (the GSTN's mod-36 check of the first 14 characters).
const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export function gstinProblem(value) {
  const g = String(value ?? '').trim().toUpperCase();
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return `"${String(value ?? '').trim()}" does not have the format of a GSTIN: 15 characters, 2 digits of the state, the PAN (5 letters, 4 digits, 1 letter), the entity number, "Z" and a check character (for example 27ABCDE1234F1Z5).`;
  if (!GSTIN_STATE[g.slice(0, 2)] && g.slice(0, 2) !== '99') return `"${g}" starts with ${g.slice(0, 2)}, which is not a GST state code.`;
  let sum = 0;
  for (let i = 0; i < 14; i++) { const p = GSTIN_CHARS.indexOf(g[i]) * (i % 2 ? 2 : 1); sum += Math.floor(p / 36) + (p % 36); }
  const check = GSTIN_CHARS[(36 - (sum % 36)) % 36];
  return check === g[14] ? null : `"${g}" is not a valid GSTIN: its last character (the check character) should be ${check}. Check for a mistyped character.`;
}

// True for a country name that is India, or empty (Tally's default is the company's country).
export const isIndia = c => { const s = String(c ?? '').trim().toLowerCase(); return s === '' || s === 'india' || s === 'bharat'; };

// Tally's currency of a ledger: the base currency (rupee) is written as "₹" in real exports.
export const isRupee = c => { const s = String(c ?? '').trim().toLowerCase(); return s === '' || ['₹', 'inr', 'rs', 'rs.', 'rupees', 'indian rupees'].includes(s); };

// ---------- the three-letter code of a Tally currency ----------
// Tally names a currency by its symbol ("$", "€"); its Currency master keeps the formal name and, in TallyPrime, the
// ISO code (expandedsymbol in the JSON export; mailingname is the formal name, "US Dollar" or "USD"). Zoho Books wants
// the three-letter code. The code is read from the Currency master of that symbol: the first field that is a three-letter
// code. When the master has none (or no Currency master was uploaded), a small table of unambiguous symbols is used and
// the code is marked assumed (listed under "Assumptions the tool made"). A symbol in neither stays without a code.
// currencies: [{ name, originalname, expandedsymbol, mailingname, formalname, isocurrencycode }] (the Currency masters).
// Returns { code, source: 'rupee' | 'master' | 'name' | 'symbol_table' } or { code: '', source: 'unknown' }.
const CODE_FIELDS = ['isocurrencycode', 'expandedsymbol', 'formalname', 'mailingname', 'name', 'originalname'];
const ISO_LIKE = /^[A-Z]{3}$/;
// unambiguous symbols only ("¥" is the yen and the yuan, "kr" several crowns: not guessed)
export const CURRENCY_SYMBOL_CODES = { '$': 'USD', 'US$': 'USD', 'USD': 'USD', '€': 'EUR', '£': 'GBP', 'A$': 'AUD', 'C$': 'CAD', 'S$': 'SGD', 'HK$': 'HKD', 'NZ$': 'NZD', 'CHF': 'CHF', 'AED': 'AED' };
const plainText = v => (v == null || typeof v === 'object' ? '' : String(v).replace(/[\u0000-\u001f]/g, '').trim());
export function currencyCode(symbol, currencies = []) {
  const s = plainText(symbol);
  if (isRupee(s)) return { code: 'INR', source: 'rupee' };
  const rec = (currencies || []).find(c => plainText(c?.name) === s || plainText(c?.originalname) === s);
  if (rec) {
    for (const f of CODE_FIELDS) { const v = plainText(rec[f]).toUpperCase(); if (ISO_LIKE.test(v) && v !== 'INR') return { code: v, source: 'master', field: f }; }
    for (const f of CODE_FIELDS) { const v = plainText(rec[f]).toUpperCase(); if (v === 'INR') return { code: 'INR', source: 'rupee' }; }
  }
  if (ISO_LIKE.test(s.toUpperCase()) && /^[A-Za-z]{3}$/.test(s)) return { code: s.toUpperCase(), source: 'name' };
  const t = CURRENCY_SYMBOL_CODES[s] || CURRENCY_SYMBOL_CODES[s.toUpperCase()];
  return t ? { code: t, source: 'symbol_table' } : { code: '', source: 'unknown' };
}

// Debit or Credit, as written in sample_accounts.csv.
export const DEBIT = 'Debit', CREDIT = 'Credit';

// Status, "Allowed values: Active / InActive" in both contact samples; "Active" in sample_items2.csv.
export const ACTIVE = 'Active';

// Items, as written in sample_items2.csv.
export const PRODUCT_TYPES = ['goods', 'service'];
export const ITEM_TYPES = ['Sales', 'Purchases', 'Sales and Purchases', 'Inventory'];

// Account names Zoho Books (India edition) creates in a new organisation, or when GST or TDS is turned on. A Chart of
// Accounts row with one of these names would be a second account of the same name, which Zoho's import does not
// accept, so such a row (and its opening balance) may be rejected. This list is NOT in the official sample files. It
// was first written from Zoho's help pages and is now CHECKED AGAINST TWO LIVE NEW INDIA ORGANISATIONS (read only, with
// Zoho's own list of accounts): the 75 accounts both were created with are "yes"; 8 names the help pages gave and
// neither organisation has are "no_in_live_org" and are written to the Chart of Accounts like any other ledger. Two
// organisations are not every organisation, so the Chart of Accounts export of the organisation itself wins when it is
// given, and the Import Wizard checks what arrived after the Chart of Accounts import. The list is kept in
// zohorules.json, and only there, so that it can be corrected in one place.
// A match is flagged and the accountant decides in Mapping Studio (decisions.js): rename the row, use Zoho's own
// account (the row is left out and its opening balance goes to opening_balances_for_zoho_accounts.csv), or leave it.
// v2: a ledger with one of these names is entered on Zoho's own account BY DEFAULT (defaults.js); the accountant can
// rename it instead. "Leave as it is" is no longer a choice.
// What the first real import showed (Zoho's error file for the Chart of Accounts): Advance Tax, TDS Receivable,
// GST Payable and TDS Payable were rejected with "Row already exists", so Zoho has them. "TCS Receivable" was imported
// without error, so Zoho did NOT have it: it is listed in ZOHO_ACCOUNTS_NOT_ALWAYS_PRESENT and is no longer treated as
// one of Zoho's own accounts (it is written to the Chart of Accounts like any other ledger).
export const ZOHO_ACCOUNTS_NOT_ALWAYS_PRESENT = ['TCS Receivable'];
export const ZOHO_OPENING_BALANCE_ACCOUNT = 'Opening Balance Adjustments'; // where Zoho Books puts the other side of opening balances
// ONE list (item 10 of the audit): the researched list of docs/ZOHO_IMPORT_RULES.md 9.1, zohorules.json
// lists.default_accounts, the entries marked exists_by_default "yes". The same list drives the clash defaults
// (defaults.js), the Zoho check and the Import Wizard; an entry marked "unknown" or "no" is not one of Zoho's own
// accounts here. When the accountant gives the tool Zoho's own Chart of Accounts export (Import Wizard, set-up), that
// export is used instead (importwizard.js zohoExistingAccounts, decisions.js, zohocheckapi.js).
export const ZOHO_DEFAULT_ACCOUNT_LIST = (() => {
  try {
    const rules = JSON.parse(fs.readFileSync(new URL('./zohorules.json', import.meta.url), 'utf8'));
    return (rules.lists?.default_accounts || []).filter(a => a.exists_by_default === 'yes' && !ZOHO_ACCOUNTS_NOT_ALWAYS_PRESENT.includes(a.name)).map(a => ({ name: a.name, accountType: a.account_type || null }));
  } catch { return []; }
})();
export const ZOHO_BUILTIN_ACCOUNTS = ZOHO_DEFAULT_ACCOUNT_LIST.map(a => a.name);
const accountKey = s => String(s ?? '').replace(/[\u0000-\u001f\u007f​﻿]/g, ' ').replace(/&/g, ' and ').replace(/\s+/g, ' ').trim().toLowerCase();
const BUILTIN_BY_KEY = new Map(ZOHO_BUILTIN_ACCOUNTS.map(n => [accountKey(n), n]));
// The Zoho built-in account a ledger name matches (ignoring capital letters, spaces, line breaks and "&" for "and"), or
// null. known: the account names of Zoho's own Chart of Accounts export of the organisation, when the accountant gave
// it to the tool (then that list is used instead of the researched one, spelled as in the export).
export const builtinAccount = (name, known = null) => {
  if (known) { const k = accountKey(name); return known.find(n => accountKey(n) === k) || null; }
  return BUILTIN_BY_KEY.get(accountKey(name)) || null;
};
// The account type of one of Zoho's own accounts (the researched list, zohorules.json lists.default_accounts), or null
// when the list does not say (an account of the organisation's own export that the list does not have).
const BUILTIN_TYPE_BY_KEY = new Map(ZOHO_DEFAULT_ACCOUNT_LIST.filter(a => a.accountType && a.accountType !== 'unknown').map(a => [accountKey(a.name), a.accountType]));
export const builtinAccountType = name => BUILTIN_TYPE_BY_KEY.get(accountKey(name)) || null;
// The same comparison, for checking that two account names would be the same account in Zoho Books.
export const accountNameKey = accountKey;
// A customer, vendor or item name as it is COMPARED with a name of a Zoho Books export or error file: without spaces
// around it, with every run of spaces, tabs and line breaks as one space, and without capital letters. Zoho Books
// keeps a contact name exactly as imported (read back after a test import: a name ending in a line break kept it),
// but an export opened and saved in a spreadsheet, or a name typed by hand, may lose those characters; so a name
// with a line break at its end and the same name without it are one contact here. Only for comparing: the files keep
// every name exactly as Tally writes it.
export const contactNameKey = s => String(s ?? '').replace(/[\u0000-\u001f\u007f ​﻿]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
