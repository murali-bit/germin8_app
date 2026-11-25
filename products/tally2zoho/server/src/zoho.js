// Zoho Books output templates and row builders.
//
// The four MASTER files (Customers, Vendors, Chart of Accounts, Items) follow the official Zoho Books (India edition)
// sample import files, heading for heading and in the same order, including the optional columns that stay empty:
//   Customers          customer_import_sample_data.xls  (62 columns)
//   Vendors            vendor_import_sample_data.xls    (64 columns; Zoho's own spelling "CustomField Value1")
// Headings follow the field names of the "Field Explanation" sheet of each sample (the names of Zoho's Map Fields page)
// where they differ from the sample's first row: zohorules.json lists.map_field_labels.
//   Chart of Accounts  sample_accounts.csv              (9 columns; the heading "Account # " ends with a space, as in the sample)
//   Items              sample_items2.csv                (29 columns)
// Values are written in the formats the sample rows and the "Field Explanation" sheets show (see zohocodes.js). A Tally
// value that cannot be translated to an accepted Zoho value with certainty is left empty and flagged; nothing is guessed.
// The Opening Balances file is NOT a Zoho import file: it is a reference report (see opening_balances below).
//
// These headings are the DEFAULT layout only: an admin can rename, reorder, add and remove columns per firm without a
// code change (columns.js). Column ids are made from the headings below (for example "Display Name" -> "display_name").

import Decimal from 'decimal.js';
import fs from 'node:fs';
import { money, parseTallyAmount, recordName, recordParent, tallyText, hasHiddenCharacters, nameKey, GSTIN_FORMAT, PAN_FORMAT, gstinCheckDigitOk } from './tally.js';
import { contactInfo, itemInfo, SECTION_GROUPS } from './masters.js';
import { stateCode, gstinStateCode, isIndia, isRupee, currencyCode, builtinAccount, STATE_CODES, DEBIT, CREDIT, ACTIVE, DEFAULT_GST_CODE_SET, gstCodeSet, gstCodesOf,
  ZOHO_OPENING_BALANCE_ACCOUNT } from './zohocodes.js';
import { applyContactFixes, openingWithMerged, visibleName } from './namefix.js';
import { openingBalanceViaJournal, DEFAULT_ITEM_RATE, hsnForZoho, resolveHsn, ZOHO_DEFAULT_SALES_ACCOUNT, ZOHO_DEFAULT_PURCHASE_ACCOUNT } from './defaults.js';
export { contactChecks };

const csvCell = v => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (headers, rows) =>
  [headers, ...rows.map(r => headers.map(h => r[h]))].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

// Small CSV reader (quoted fields, commas and line breaks inside quotes). Returns { headers, rows: [{header: value}] }.
export function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const table = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(x => x !== '')) table.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some(x => x !== '')) table.push(row);
  if (!table.length) return { headers: [], rows: [] };
  const headers = table[0].map(h => h.trim());
  return { headers, rows: table.slice(1).map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? '']))) };
}

// ---------- the official headings ----------
const customFields = first => [first, ...Array.from({ length: 9 }, (_, i) => `CustomField Value ${i + 2}`)];
export const CUSTOMER_HEADERS = ['Display Name', 'Customer Number', 'Customer Sub Type', 'Place Of Contact', 'Currency Code', 'Company Name',
  'Salutation', 'First Name', 'Last Name', 'EmailID', 'Phone', 'MobilePhone', 'Facebook', 'Twitter', 'Department', 'Designation', 'Credit Limit',
  'Payment Terms', 'Payment Terms Label', 'Notes', 'Website', 'GST Treatment', 'GST Identification Number (GSTIN)', 'PAN Number',
  'Billing Attention', 'Billing Address', 'Billing Street2', 'Billing City', 'Billing State', 'Billing Country', 'Billing Code', 'Billing Fax', 'Billing Phone',
  'Shipping Attention', 'Shipping Address', 'Shipping Street2', 'Shipping City', 'Shipping State', 'Shipping Country', 'Shipping Code', 'Shipping Fax', 'Shipping Phone',
  'Portal Status', 'Skype Identity', 'Owner Name', 'Opening Balance', 'Opening Balance Exchange Rate', 'Status', 'Bank Account Payment',
  'TDS Name', 'TDS Section Code', 'TDS Percentage', ...customFields('CustomField Value 1')];
export const VENDOR_HEADERS = ['Display Name', 'Vendor Number', 'Place Of Contact', 'Source Of Supply', 'Currency Code', 'Company Name',
  'Salutation', 'First Name', 'Last Name', 'EmailID', 'Phone', 'MobilePhone', 'Facebook', 'Twitter', 'Department', 'Designation',
  'Payment Terms', 'Payment Terms Label', 'Notes', 'Website', 'Exemption Reason', 'GST Treatment', 'GST Identification Number (GSTIN)', 'PAN Number',
  'Billing Attention', 'Billing Address', 'Billing Street2', 'Billing City', 'Billing State', 'Billing Country', 'Billing Code', 'Billing Fax', 'Billing Phone',
  'Shipping Attention', 'Shipping Address', 'Shipping Street2', 'Shipping City', 'Shipping State', 'Shipping Country', 'Shipping Code', 'Shipping Fax', 'Shipping Phone',
  'Skype Identity', 'Owner Name', 'Opening Balance', 'Opening Balance Exchange Rate', 'Status',
  'TDS Name', 'TDS Section Code', 'TDS Percentage', 'Bank Name', 'Bank Account Number', 'Beneficiary', 'Routing Number', ...customFields('CustomField Value1')];
export const ACCOUNT_HEADERS = ['Account Name', 'Account Code', 'Description', 'Account Type', 'Parent Account', 'Account # ', 'Currency', 'Opening Balance', 'Debit or Credit'];
// The headings of Zoho's sample_items2.csv, in the sample's order (29).
export const ITEM_SAMPLE_HEADERS = ['Item Name', 'SKU', 'HSN/SAC', 'Description', 'Rate', 'Product Type', 'Account', 'Usage unit', 'Purchase Description',
  'Purchase Rate', 'Item Type', 'Purchase Account', 'Inventory Account', 'Reorder Point', 'Vendor', 'Initial Stock', 'Initial Stock Rate', 'Stock On Hand',
  'Status', 'Taxability Type', 'Exemption Reason', 'Inter State Tax Name', 'Inter State Tax Type', 'Inter State Tax Rate', 'Intra State Tax Name',
  'Intra State Tax Type', 'Intra State Tax Rate', 'Warehouse Name', 'CF.custom_field'];
// v2 (docs/ZOHO_IMPORT_RULES.md): the Items file is a SUBSET of the sample's headings, in the sample's order.
// "CF.custom_field" is a custom field of Zoho's demo organisation and is left out.
export const ITEM_COLUMNS_LEFT_OUT = ['CF.custom_field'];
export const ITEM_HEADERS = ITEM_SAMPLE_HEADERS.filter(h => !ITEM_COLUMNS_LEFT_OUT.includes(h));

// Every heading not named in a sources list is written empty: Tally has nothing that fills it with certainty.
const EMPTY = 'Left empty: Tally has no value for it that can be written with certainty';
const withEmpty = (headers, sources) => Object.fromEntries(headers.map(h => [h, sources[h] || EMPTY]));
const amount2 = d => d.abs().toFixed(2); // 2 decimals, no thousands separator, no sign

// ---------- customers and vendors ----------
const PLACE_SOURCE = 'Two-letter Zoho state code of the place of supply in the GST registration details used, else of the state (mailing details, then GST registration details), else of the state in the GSTIN. Empty for an overseas contact. A state with no Zoho code is left empty and flagged';
const contactSources = who => ({
  'Display Name': 'Ledger name', // as cleaned or renamed in Mapping Studio (Names) when the accountant decided so (see outName)
  'Company Name': 'Mailing name (latest mailing details), else the ledger name',
  ...(who === 'customer' ? { 'Place Of Contact': PLACE_SOURCE } : { 'Source Of Supply': PLACE_SOURCE }),
  'Currency Code': '"INR" when the ledger is in rupees (Tally writes ₹); for a ledger kept in another currency the three-letter code of its Tally Currency master (else of an unambiguous symbol, flagged as assumed); left empty and flagged when neither gives one',
  'Opening Balance Exchange Rate': 'For a ledger kept in another currency: the rate of exchange Tally has for of the opening balance ("€6000.00 @ ₹92.40/€" gives 92.40); the Opening Balance is then the foreign amount. Empty for a rupee ledger',
  'EmailID': 'Email', 'Phone': 'Phone number (ledger phone, or the phone number of the contact details)', 'MobilePhone': 'Mobile number (ledger mobile, or the mobile number of the contact details)',
  'Payment Terms': 'Number of days of Tally\'s default credit period (for example "30 Days" gives 30). Empty when Tally has none',
  'Payment Terms Label': '"Net <days>" (or "Due on Receipt" for 0 days), with Payment Terms. Empty when Tally has no credit period',
  'GST Treatment': 'Zoho code from Tally\'s GST registration type, in the set of codes chosen in Company Settings. With the import sample codes (the default): Regular -> business_gst (business_sez for an SEZ party), Composition -> business_registered_composition, Unregistered or Consumer -> business_none, no registration with a country other than India -> overseas. With the help page codes: Regular -> business_registered_regular, Unregistered -> business_unregistered, Consumer -> consumer ("Unregistered/Consumer" is left empty and flagged). Left empty and flagged when the GSTIN is missing or not valid for a registered party, or the type is unknown',
  'GST Identification Number (GSTIN)': 'GSTIN of the GST registration details used (the latest on or before the end of the financial year), else Party GSTIN. Line breaks and spaces around it are removed and flagged',
  'PAN Number': 'Income tax number (PAN)',
  'Billing Address': 'Address line 1 (latest mailing details)', 'Billing Street2': 'Address lines 2 and after, joined with ", " (latest mailing details)',
  'Billing City': 'Left empty: Tally keeps no city field (the city is usually inside an address line)',
  'Billing State': 'State (latest mailing details), as written in Tally', 'Billing Country': 'Country (latest mailing details)', 'Billing Code': 'PIN code (latest mailing details)',
  'Opening Balance': who === 'customer'
    ? 'Opening balance when it is a debit (the customer owes money), without sign, 2 decimals. A customer in credit is left empty: that balance is a line of journal OB-2 in the opening balance journal file'
    : 'Opening balance when it is a credit (money owed to the vendor), without sign, 2 decimals. A vendor in debit is left empty: that balance is a line of journal OB-2 in the opening balance journal file',
  'Status': 'Fixed value "Active"',
});

// GST Treatment from Tally's registration type. Returns { value, problem: { kind, message } | null }.
// value '' means: not written, because it cannot be told with certainty (the problem says what is needed).
// codeSet: 'sample' (default, the codes of Zoho's import samples) or 'help' (the codes of Zoho's help page), chosen
// per firm in Company Settings (see GST_CODE_SETS in zohocodes.js).
// unregisteredConsumerAs: '' (default: flag it), 'unregistered' or 'consumer': the admin's standing decision (Company
// Settings) on how a Tally party of type "Unregistered/Consumer" is written when the chosen set tells the two apart.
export function gstTreatment(c, codeSet = DEFAULT_GST_CODE_SET, unregisteredConsumerAs = '') {
  const set = gstCodeSet(codeSet);
  const code = kind => set.codes[kind];
  const t = String(c.registrationType ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  // importOfServices: a vendor whose reverse charge bills Tally booked with IGST although it has no GSTIN and no state
  // (contactValues): a supplier outside India, whatever country Tally's mailing details show by default
  const foreign = !isIndia(c.country) || !!c.importOfServices;
  // A decision made in Fix contacts (applyContactFixes in namefix.js) comes before Tally's registration type.
  if (c.importOfServices && !(c.gstin && GSTIN_FORMAT.test(c.gstin))) return { value: code('overseas'), problem: null };
  if (c.treatmentOverride === 'unregistered') return { value: code('unregistered'), problem: null };
  if ((c.treatmentOverride === 'regular' || c.treatmentOverride === 'composition') && c.gstin && GSTIN_FORMAT.test(c.gstin)) {
    return { value: code(c.treatmentOverride === 'composition' ? 'composition' : c.sez ? 'sez' : 'regular'), problem: null };
  }
  // v2 default 4: a contact with a valid GSTIN is always written as registered, whatever Tally says. Composition and
  // SEZ are kinds of registration and stay as Tally has them; anything else (unregistered, consumer, unknown, not set,
  // another type) is written with the registered-regular code of the chosen set, and flagged because it differs from
  // Tally (assumed). "Treat as unregistered" in Fix contacts (above) is the way to say otherwise.
  if (c.gstin && GSTIN_FORMAT.test(c.gstin)) {
    if (t === 'composition' && !c.registrationUnknown) return { value: code('composition'), problem: null };
    const value = code(c.sez ? 'sez' : 'regular');
    if (t === 'regular' && !c.registrationUnknown) return { value, problem: null };
    return { value, problem: null, assumed: { kind: 'gst_registered_from_gstin',
      message: `Tally ${c.registrationUnknown ? 'says the GST registration type is "Unknown"' : t ? `says the GST registration type is "${c.registrationType}"` : 'has no GST registration type for this party'}, but the party has a valid GSTIN, so it is written as registered (GST Treatment ${value}). `
        + 'This is the tool\'s default. If the party is not registered, choose "treat as unregistered" in Mapping Studio (Fix contacts).' } };
  }
  if (!t || c.registrationUnknown) {
    if (foreign && !c.gstin) return { value: code('overseas'), problem: null };
    return { value: '', problem: c.registrationUnknown
      ? { kind: 'gst_registration_unknown', message: 'The GST registration type is "Unknown" (not set) in Tally, so the GST Treatment cell is empty. An accountant must decide the GST treatment for Zoho Books.' }
      : { kind: 'gst_treatment_not_set', message: `Tally has no GST registration type for this party, so the GST Treatment cell is empty. Zoho Books needs one of ${gstCodesOf(codeSet).join(', ')}. An accountant must decide it.` } };
  }
  if (t === 'regular' || t === 'composition') {
    if (!c.gstin) {
      // v2 default 4: registered in Tally with no GSTIN is written AS IN TALLY (registered) and flagged. It is NOT
      // turned into an unregistered party by default: that stays an explicit choice in Fix contacts.
      // NOTE: Zoho Books is expected to ask for a GSTIN with a registered treatment (not confirmed by an import); to
      // leave the cell empty instead, return value '' here.
      return { value: registeredWithoutGstinCode(code, t, c), problem: { kind: 'gst_registered_without_gstin', message: `The GST registration type in Tally is "${c.registrationType}", but there is no GSTIN. It is written as in Tally (GST Treatment ${registeredWithoutGstinCode(code, t, c)}, no GSTIN). Zoho Books may reject a registered party without a GSTIN: add the GSTIN in Mapping Studio (Fix contacts) or in Tally, or choose "treat as unregistered" there if the party is not registered.` } };
    }
    if (!GSTIN_FORMAT.test(c.gstin)) return { value: '', problem: null }; // the gstin_format flag says so (contactChecks)
    if (t === 'composition') return { value: code('composition'), problem: null };
    return { value: code(c.sez ? 'sez' : 'regular'), problem: null };
  }
  if (t === 'unregistered' || t === 'consumer' || t === 'unregistered/consumer') {
    if (c.gstin) {
      return { value: '', problem: { kind: 'gst_unregistered_with_gstin', message: `The GST registration type in Tally is "${c.registrationType}", but the party has GSTIN "${c.gstin}". The GST Treatment cell is left empty. An accountant must decide whether the party is registered.` } };
    }
    if (foreign) return { value: code('overseas'), problem: null };
    let kind = t === 'unregistered' ? 'unregistered' : t === 'consumer' ? 'consumer' : 'unregistered_or_consumer';
    if (kind === 'unregistered_or_consumer' && !code(kind) && ['unregistered', 'consumer'].includes(unregisteredConsumerAs)) kind = unregisteredConsumerAs;
    if (!code(kind)) {
      return { value: '', problem: { kind: 'gst_treatment_ambiguous', message: `The GST registration type in Tally is "${c.registrationType}". The GST treatment codes chosen in Company Settings (${set.label}) have one code for an unregistered business (${code('unregistered')}) and another for a consumer (${code('consumer')}), and Tally does not say which this party is. The GST Treatment cell is left empty. An admin can decide in Company Settings how every such party is written, or an accountant can decide party by party.` } };
    }
    return { value: code(kind), problem: null };
  }
  return { value: '', problem: { kind: 'gst_treatment_not_mapped', message: `Tally's GST registration type "${c.registrationType}" has no matching Zoho GST Treatment, so the cell is left empty. An accountant must decide it.` } };
}
// The code written for a party that Tally says is registered (t: 'regular' | 'composition') but that has no GSTIN:
// the code of that registration, as in Tally. Kept in one place so the rule can be changed.
const registeredWithoutGstinCode = (code, t, c) => code(t === 'composition' ? 'composition' : c.sez ? 'sez' : 'regular');

// Place Of Contact (customers) / Source Of Supply (vendors). Returns { value, problem }.
// GST treatments with which the GSTIN cell is written (a registered contact)
const GSTIN_WRITTEN_TREATMENTS = new Set(['business_gst', 'business_sez', 'deemed_export', 'tax_deductor', 'sez_developer']);
export function placeOfContact(c, treatment) {
  if (treatment === 'overseas') return { value: '', problem: null };
  const fromGstin = c.gstin && GSTIN_FORMAT.test(c.gstin) ? gstinStateCode(c.gstin) : '';
  const src = c.placeOfSupply || c.state;
  // v2 default 5: with a valid GSTIN the state comes from the GSTIN when Tally has no state (or one Zoho has no code
  // for), and the GSTIN's state is written when Tally's state is another one. Both are flagged (assumed / problem).
  const fromGstinAssumed = why => ({ value: fromGstin, problem: null, assumed: { kind: 'state_from_gstin',
    message: `${why}, so the state of the GSTIN (code ${fromGstin}, ${STATE_CODES[fromGstin]}) is written as the place of contact / source of supply${String(c.state ?? '').trim() ? '' : ' and as Billing State'}. This is the tool's default: choose another state in Mapping Studio (Fix contacts) if it is wrong.` } });
  if (!src) {
    if (fromGstin) return fromGstinAssumed('Tally has no state and no place of supply for this party');
    return { value: '', problem: { kind: 'place_of_contact_missing', message: 'Tally has no place of supply and no state for this party, so the place of contact (state code) is left empty. Zoho Books uses it to choose between IGST and CGST + SGST. Add the state in Tally, or enter it in Zoho Books.' } };
  }
  const code = stateCode(src);
  if (!code) {
    if (fromGstin) return fromGstinAssumed(`The state "${src}" in Tally has no code in Zoho's list of state codes`);
    return { value: '', problem: { kind: 'state_not_mapped', message: `The state "${src}" has no code in Zoho's list of state codes (${Object.keys(STATE_CODES).length} codes, for example KA or TN), so the place of contact is left empty. An accountant must decide the state code.` } };
  }
  if (fromGstin && fromGstin !== code) {
    // round 1 (issue 9): a GSTIN whose check character is wrong is not a real GSTIN, so its state never overrides Tally's
    // round 2 (real data): for a contact written as registered (its GSTIN is in the file), Zoho has accepted only a place
    // that is the GSTIN's state (third test import), so the GSTIN's state is written even when the check character fails;
    // the failed check character stays flagged (gstin_check_digit_invalid) so the GSTIN is corrected
    if (!gstinCheckDigitOk(c.gstin) && GSTIN_WRITTEN_TREATMENTS.has(treatment)) return { value: fromGstin, problem: { kind: 'place_differs_from_gstin', message: `The place of supply in Tally ("${src}", code ${code}) is not the state of the GSTIN (code ${fromGstin}), and the GSTIN fails its check character. The contact is written as registered with this GSTIN, and Zoho Books has only been seen to accept a place of contact that is the GSTIN's state, so ${fromGstin} is written (Tally's state ${code} is not; the Billing State stays as in Tally). Correct the GSTIN, or the state, in Mapping Studio (Fix contacts) or in Tally.` } };
    if (!gstinCheckDigitOk(c.gstin)) return { value: code, problem: { kind: 'place_differs_from_gstin', message: `The place of supply in Tally ("${src}", code ${code}) is not the state of the GSTIN (code ${fromGstin}), and the GSTIN fails its check character (it is not a real GSTIN), so ${code}, the state in Tally, is written. Correct the GSTIN in Mapping Studio (Fix contacts) or in Tally.` } };
    if (c.placeFixed) return { value: code, problem: { kind: 'place_differs_from_gstin', message: `The state chosen in Fix contacts (code ${code}) is not the state of the GSTIN (code ${fromGstin}). ${code} is written. Check which is right.` } };
    return { value: fromGstin, problem: { kind: 'place_differs_from_gstin', message: `The place of supply in Tally ("${src}", code ${code}) is not the state of the GSTIN (code ${fromGstin}). ${fromGstin} is written, the state of the GSTIN (the tool's default; the Billing State stays as in Tally). Check which is right: correct the GSTIN in Mapping Studio (Fix contacts) if the Tally state is the right one.` } };
  }
  return { value: code, problem: null };
}

// Tally's credit period "30 Days" -> { terms: '30', label: 'Net 30' }.
export function paymentTerms(creditPeriod) {
  const s = String(creditPeriod ?? '').trim();
  if (!s) return { terms: '', label: '', problem: null };
  const m = s.match(/^(\d{1,4})\s*(days?)?$/i);
  if (!m) return { terms: '', label: '', problem: { kind: 'payment_terms_not_read', message: `Tally's credit period "${s}" is not a number of days, so Payment Terms is left empty. Enter the terms in Zoho Books.` } };
  const n = Number(m[1]);
  return { terms: String(n), label: n === 0 ? 'Due on Receipt' : `Net ${n}`, problem: null };
}

// The name a ledger is written with in every Zoho file: ctx.outputName is the one resolver built from the accountant's
// decisions (makeNameResolver in namefix.js: clashes with Zoho's own accounts, duplicates, cleaned names). Without it
// (a check run on its own), only a clash rename applies.
const outName = (name, ctx) => (ctx?.outputName ? ctx.outputName(name) : accountOutputName(name, ctx));

// Everything a contact row needs, worked out once for the row and its checks. The corrections made in Fix contacts
// (ctx.contactFixes) are applied to the details read from Tally; the opening balances of ledgers treated as the same
// party (ctx.mergedBalances) are added to this one's.
function contactValues(d, ctx, who) {
  const tally = contactInfo(d, ctx?.asOf ?? null);
  let c = applyContactFixes(tally, ctx?.contactFixes?.[tally.name]);
  // A vendor with no GSTIN and no state whose bills carry IGST under reverse charge is a supplier outside India (an
  // import of services): written as overseas, like its bills (ctx.rcmForeignVendors, found from the batch's own bills).
  // A GSTIN, a state or a treatment given in Tally or in Fix contacts says otherwise, and wins.
  const fix = ctx?.contactFixes?.[tally.name];
  const importOfServices = who === 'vendor' && !!ctx?.rcmForeignVendors?.has?.(tally.name) && !c.gstin && !String(c.state ?? '').trim() && !String(c.placeOfSupply ?? '').trim() && fix?.treatment !== 'regular' && fix?.treatment !== 'composition' && !fix?.state;
  if (importOfServices) c = { ...c, importOfServices: true }; // the country stays as Tally has it (Zoho asks for one)
  const treatment = gstTreatment(c, ctx?.gstCodes, ctx?.gstUnregisteredConsumerAs);
  const place = placeOfContact(c, treatment.value);
  const terms = paymentTerms(c.creditPeriod);
  const rupee = isRupee(c.currency);
  const currency = currencyCode(c.currency, ctx?.currencies);
  const usualDebit = who === 'customer';
  const merged = openingWithMerged(c.name, c.openingBalance, ctx);
  const ob = c.openingBalance || merged.added.length ? merged.total : null;
  const unusual = merged.added.length ? !!ob && !ob.isZero() && (usualDebit ? !ob.isNegative() : ob.isNegative()) : unusualSide(c.openingBalance, usualDebit);
  // Billing State: as in Tally; when Tally has none and the state was taken from the GSTIN (default 5), that state
  const billingState = c.state || (place.assumed?.kind === 'state_from_gstin' && !String(c.state ?? '').trim() ? STATE_CODES[place.value] || '' : '');
  // PAN (v2): a correction made in Fix contacts, else Tally's, else characters 3 to 12 of a valid GSTIN (the PAN is
  // part of the GSTIN by law), flagged pan_from_gstin
  const pan = panOf(c);
  const fxOpening = rupee ? null : foreignOpening(c, merged, ctx);
  return { c, tally, treatment, place, terms, rupee, currency, fxOpening, unusual, ob, merged, billingState, pan };
}
// The opening balance of a contact kept in another currency, as Zoho's contact file takes it: the foreign amount and
// Tally's rate (Opening Balance and Opening Balance Exchange Rate). Tally writes it "-€6000.00 @ ₹92.40/€ = -₹554400.00".
// A balance merged from another ledger (two contacts treated as one) is added when it is in the same currency at the same
// rate. Returns { fx: Decimal (Tally's sign), rate, inr: Decimal (Tally's rupee amount), zohoInr: what Zoho Books makes
// of it (fx x rate rounded to the paisa) } or { problem } or null when there is no balance.
function foreignOpening(c, merged, ctx) {
  const parts = [{ ledger: c.name, text: c.openingBalance }, ...merged.added.map(x => ({ ledger: x.ledger, text: x.text }))];
  let fx = new Decimal(0), inr = new Decimal(0), rate = null, symbol = null, problem = null;
  for (const p of parts) {
    const a = parseTallyAmount(p.text ?? '');
    if (!a) { problem = 'unreadable'; break; }
    if (a.inr.isZero()) continue;
    if (!a.fx) { problem = 'rupee_only'; break; }
    if (rate && (!rate.equals(a.rate) || symbol !== a.currencySymbol)) { problem = 'mixed'; break; }
    rate = a.rate; symbol = a.currencySymbol; fx = fx.plus(a.fx); inr = inr.plus(a.inr);
  }
  if (problem) return { problem };
  if (!rate || fx.isZero()) return null;
  return { fx, rate, inr, zohoInr: fx.times(rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP) };
}
export const panFromGstin = gstin => (gstin && GSTIN_FORMAT.test(gstin) ? gstin.slice(2, 12) : '');
export function panOf(c) {
  if (c.pan) return { value: c.pan, source: c.panFixed ? 'fix' : 'tally' };
  const derived = panFromGstin(c.gstin);
  return derived ? { value: derived, source: 'gstin' } : { value: '', source: '' };
}

function contactRow(d, ctx, who) {
  const v = contactValues(d, ctx, who), c = v.c;
  const lines = c.address;
  const name = outName(c.name, ctx);
  const row = {
    'Display Name': name,
    'Company Name': c.mailingName && c.mailingName !== c.name ? c.mailingName : name,
    'Currency Code': v.currency.code,
    'EmailID': c.email,
    'Phone': c.phone,
    'MobilePhone': c.mobile,
    'Payment Terms': v.terms.terms,
    'Payment Terms Label': v.terms.label,
    'GST Treatment': v.treatment.value,
    'GST Identification Number (GSTIN)': c.gstin,
    'PAN Number': v.pan.value,
    'Billing Address': lines[0] ?? '',
    'Billing Street2': lines.slice(1).join(', '),
    'Billing State': v.billingState,
    'Billing Country': c.country,
    'Billing Code': c.pincode,
    // Tally stores debit balances as negative. The usual side is written without sign; the unusual side is left empty.
    'Opening Balance': v.ob && !v.ob.isZero() && !v.unusual && (v.rupee || (v.currency.code && v.fxOpening?.fx)) ? amount2(v.rupee ? v.ob : v.fxOpening.fx) : '',
    // another currency: the foreign amount above at Tally's rate, so Zoho Books holds the balance in that currency
    'Opening Balance Exchange Rate': !v.rupee && v.currency.code && v.fxOpening?.fx && !v.unusual ? v.fxOpening.rate.toString() : '',
    'Status': ACTIVE,
  };
  if (who === 'customer') row['Place Of Contact'] = v.place.value;
  else row['Source Of Supply'] = v.place.value;
  return row;
}

const isoOf = d => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
// What every warning about a name with hidden characters says (pick and drop: names are passed as in Tally).
export const NAME_AS_IN_TALLY = 'It is written exactly as in Tally, the same value in every file (the voucher files included), so the files still match each other. '
  + 'This is a warning, not a blocker: names are passed as Tally has them, and will be filled in from the GST portal later. '
  + 'If Zoho Books rejects the name because of the line break, clean it in Mapping Studio (Names): the same cleaned name is then written in every file.';
const EDGE = /^[\s\u200b\ufeff]|[\s\u200b\ufeff]$/;
const hiddenWhat = s => (/[\r\n]/.test(s) ? 'a line break' : 'a hidden character (for example an invisible character or a tab)');

// The checks of a customer or vendor row. Every one flags only: nothing is decided or guessed for the accountant.
// Returns a list of { kind, message } (empty when there is nothing to say). The name itself is checked when the data
// is processed (index.js), for every master dataset.
// who: 'customer' or 'vendor'.
function contactChecks(d, ctx, who) {
  const out = [];
  const add = (kind, message) => out.push({ kind, message });
  const v = contactValues(d, ctx, who), c = v.c;
  const mergedWords = v.merged.added.length
    ? ` (its own ${v.merged.own.abs().toFixed(2)} ${v.merged.own.isNegative() ? DEBIT : CREDIT}${v.merged.added.map(x => ` plus ${x.amount.abs().toFixed(2)} ${x.amount.isNegative() ? DEBIT : CREDIT} of "${visibleName(x.ledger)}"`).join('')}, treated as the same party)` : '';
  if (v.unusual) {
    // carried by a file (journal OB-2 of the opening balance journal file, see contactCreditOpeningRow); a contact in
    // another currency is not, because the journal is written in rupees
    const carried = v.rupee
      ? `It is written as a line of journal OB-2 in the opening balance journal file (opening_balances_for_zoho_accounts.csv): ${who === 'customer' ? 'Accounts Receivable, Credit' : 'Accounts Payable, Debit'}, with this party as Contact Name, against Opening Balance Adjustments. In Zoho Books it becomes a credit that can be applied to ${who === 'customer' ? 'invoices' : 'bills'}. Zoho has not imported such a line yet: check the first import.`
      : 'The party is in another currency than the rupee, so the balance is NOT in the opening balance journal either. An accountant must decide how to enter it in Zoho Books.';
    add(v.rupee ? 'balance_unusual_side' : 'balance_unusual_side_not_carried', who === 'customer'
      ? `Opening balance ${v.ob.abs().toFixed(2)}${mergedWords} is a credit in Tally (the customer is in credit, for example an advance received). Zoho's Opening Balance column carries a balance without its sign, so the cell is left empty. ${carried}`
      : `Opening balance ${v.ob.abs().toFixed(2)}${mergedWords} is a debit in Tally (the vendor owes money, for example an advance paid). Zoho's Opening Balance column carries a balance without its sign, so the cell is left empty. ${carried}`);
  }
  if (c.openingBalance && !money(c.openingBalance)) add('opening_balance_unreadable', `The opening balance "${c.openingBalance}" cannot be read as an amount, so the Opening Balance cell is empty. Check it in Tally.`);
  if (v.merged.added.length) {
    // by default (v2 default 6: the same Display Name twice in one file), or decided in Mapping Studio (Names)
    const byDefault = v.merged.added.every(x => ctx?.nameDecisions?.[x.ledger]?.byDefault);
    add('contacts_treated_as_one', `${v.merged.added.map(x => `"${visibleName(x.ledger)}"`).join(' and ')} ${byDefault
      ? `${v.merged.added.length === 1 ? 'has' : 'have'} the same name as this ${who}, and Zoho Books rejects two rows with one Display Name, so by default ${v.merged.added.length === 1 ? 'it is' : 'they are'} treated as the same party and`
      : `${v.merged.added.length === 1 ? 'was' : 'were'} decided in Mapping Studio (Names) to be the same party as this one, so ${v.merged.added.length === 1 ? 'it is' : 'they are'}`} not written separately. `
      + `The opening balance written is the total: ${v.ob ? `${v.ob.abs().toFixed(2)} ${v.ob.isNegative() ? DEBIT : CREDIT}` : '0.00'}${mergedWords}. Vouchers of ${v.merged.added.length === 1 ? 'both ledgers' : 'every one of these ledgers'} name this contact.`
      + (byDefault ? ' If they are two parties, choose "keep both" in Mapping Studio (Names) and give one a different name.' : ''));
  }
  // v2 default 7: a name that breaks a Zoho rule is cleaned by default (the decision carries byDefault)
  if (ctx?.nameDecisions?.[c.name]?.byDefault && ctx.nameDecisions[c.name].action === 'clean') {
    add('name_cleaned_for_zoho', `The ledger name is written as "${outName(c.name, ctx)}": ${ctx.nameDecisions[c.name].why || 'Zoho Books does not accept it as written in Tally'}. The same cleaned name is written in every file.`);
  }
  if (c.fixedFields?.length) {
    add('contact_details_corrected', `Corrected in Mapping Studio (Fix contacts), for the Zoho file only: ${c.fixedFields.join(', ')}. `
      + `Tally has${v.tally.gstin ? ` GSTIN "${v.tally.gstin}"` : ' no GSTIN'}, registration type "${v.tally.registrationType || 'none'}"${v.tally.state ? `, state "${v.tally.state}"` : ', no state'}. The Tally data is not changed: correct it in Tally as well.`);
  }
  // The ledger name is the Display Name, the field Zoho Books requires and uses to match the contact (also on the
  // invoices and bills that name it). Pick and drop: it is written exactly as in Tally, the same raw value in every
  // file, unless the accountant chose to clean or rename it in Mapping Studio (Names). A WARNING only, not a blocker.
  const written = outName(c.name, ctx);
  if (hasHiddenCharacters(written)) {
    const alsoCompany = !c.mailingName || c.mailingName === c.name;
    add('display_name_hidden_characters', `The ledger name, written as Display Name${alsoCompany ? ' (and as Company Name)' : ''}, contains ${hiddenWhat(written)}${EDGE.test(written) ? ' at its start or end' : ''}. ${NAME_AS_IN_TALLY}`);
  }
  if (c.mailingName && c.mailingName !== c.name && hasHiddenCharacters(c.mailingName)) {
    add('mailing_name_hidden_characters', `The mailing name (written as Company Name) contains ${hiddenWhat(c.mailingName)}. It is written to the file exactly as in Tally. An accountant must decide whether to correct it in Tally before the import.`);
  }
  if (c.cleaned.length) {
    add('value_cleaned', `In Tally the ${c.cleaned.join(', ')} of this ${who} ${c.cleaned.length === 1 ? 'has' : 'have'} line breaks, invisible characters or spaces around ${c.cleaned.length === 1 ? 'it' : 'them'}${c.cleaned.includes('address') ? ' (or a line break inside an address line)' : ''}. `
      + 'The file carries the value without them; nothing else was changed. Correct the value in Tally as well.');
  }
  if (c.gstin && !GSTIN_FORMAT.test(c.gstin)) add('gstin_format', `GSTIN "${c.gstin}" does not have the format of a GSTIN (15 characters, for example 27ABCDE1234F1Z5). It is written as it is, and the GST Treatment cell is left empty because Zoho Books would reject a registered treatment with it. Check it in Tally before the import.`);
  if (c.gstin && GSTIN_FORMAT.test(c.gstin) && !gstinCheckDigitOk(c.gstin)) add('gstin_check_digit_invalid', `GSTIN "${c.gstin}" has the format of a GSTIN, but its last character (the check character) is not the one the GST portal works out from the first 14, so it is not a real GSTIN (a mistyped character, for example the letter I or O for the digit 1 or 0). It is written as Tally has it. When Tally's state is another one, the place of contact of a registered contact is still the GSTIN's state (the only kind of row Zoho Books has been seen to accept), and of any other contact Tally's state. The GST portal (GSTR-1, e-invoice) rejects an invalid GSTIN: correct it in Mapping Studio (Fix contacts) or in Tally before the import.`);
  if (c.pan && !PAN_FORMAT.test(c.pan)) add('pan_format', `PAN "${c.pan}" does not have the format of a PAN (10 characters, for example ABCDE1234F). It is written as it is. Check it in Tally before the import.`);
  if (v.pan.source === 'gstin') add('pan_from_gstin', `Tally has no PAN for this ${who}, so the PAN in its GSTIN (characters 3 to 12) is written: ${v.pan.value}. Change it in Mapping Studio (Fix contacts) if it is wrong.`);
  if (c.importOfServices && v.treatment.value) add('vendor_overseas_reverse_charge', `This vendor has no GSTIN and no state in Tally, and Tally booked IGST under reverse charge on its bills: the pattern of a supplier outside India (an import of services). It is written with GST Treatment ${v.treatment.value} and no Source Of Supply, and its reverse charge bills keep IGST.${isIndia(v.tally.country) ? ` The Billing Country is written as Tally has it (${String(v.tally.country ?? '').trim() ? `"${v.tally.country}"` : 'empty'}): Tally does not say which country the supplier is in, so correct the country in Tally or in Zoho Books.` : ''} Zoho Books needs SEZ / Overseas Trading ticked in GST Settings for such a vendor. This is the tool's default and is not confirmed by an import yet. If the vendor is in India, give it a state in Mapping Studio (Fix contacts).`);
  if (v.treatment.problem) add(v.treatment.problem.kind, v.treatment.problem.message);
  if (v.treatment.assumed) add(v.treatment.assumed.kind, v.treatment.assumed.message);
  if (v.place.problem) add(v.place.problem.kind, v.place.problem.message);
  if (v.place.assumed) add(v.place.assumed.kind, v.place.assumed.message);
  if (v.terms.problem) add(v.terms.problem.kind, v.terms.problem.message);
  if (!v.rupee && !v.currency.code) add('currency_not_rupee', `The ledger's currency in Tally is "${c.currency}", not the rupee, and neither its Currency master nor the symbol gives a three-letter code, so Currency Code is left empty. Zoho Books needs the three-letter code (for example USD) and an exchange rate for the opening balance. An accountant must decide them.`);
  if (!v.rupee && v.currency.code) {
    add(v.currency.source === 'symbol_table' ? 'currency_code_assumed' : 'currency_code_from_tally', `The ledger is kept in "${c.currency}" in Tally, so it is written with Currency Code ${v.currency.code}${v.currency.source === 'symbol_table' ? ' (the Currency master in Tally gives no three-letter code: the code is the usual one for the symbol, an assumption to check)' : ' (from the Currency master in Tally)'}. Zoho Books takes invoices, bills and payments of this ${who} in ${v.currency.code} only, at a rate of exchange. Add ${v.currency.code} in Zoho Books (Settings > Currencies) before importing the ${who}s.`);
    const fo = v.fxOpening;
    if (fo?.problem && v.ob && !v.ob.isZero() && !v.unusual) {
      add('foreign_opening_not_written', `The opening balance ${v.ob.abs().toFixed(2)} (rupees) of this ${who} kept in ${v.currency.code} ${fo.problem === 'rupee_only' ? 'has no foreign amount in Tally (only a rupee figure)' : fo.problem === 'mixed' ? 'is made of balances at different rates or currencies (two ledgers treated as one)' : 'cannot be read'}, so it cannot be written in ${v.currency.code} at Tally's rate, and the Opening Balance cell is empty. The balance is in no file: enter it in Zoho Books by hand (or correct it in Tally and export again).`);
    } else if (fo?.fx && !v.unusual && !fo.zohoInr.abs().equals(fo.inr.abs())) {
      add('forex_rounding_difference', `The opening balance is written as ${fo.fx.abs().toFixed(2)} ${v.currency.code} at ${fo.rate} (Tally's rate). Zoho Books converts the total: ${fo.zohoInr.abs().toFixed(2)} rupees, but Tally's rupee balance is ${fo.inr.abs().toFixed(2)} (Tally converts each bill and rounds each), a rounding difference of ${fo.zohoInr.abs().minus(fo.inr.abs()).abs().toFixed(2)}. Accept it, or post it to the exchange gain or loss account after the import.`);
    }
  }
  if (c.gstinConflict) {
    add('gstin_conflict', `Two different GSTINs in Tally: party GSTIN "${c.gstinConflict.party}" and "${c.gstinConflict.registration}" in the GST registration details used. The file carries "${c.gstinConflict.registration}", so that the GSTIN, GST Treatment and place of contact come from the same registration. Check which is right.`);
  }
  for (const x of c.dated) {
    const end = ctx?.asOf ? isoOf(ctx.asOf) : null;
    if (x.earliestUsed) add('dated_details_after_year', `Every entry of the ${x.list} in Tally is dated after the end of the financial year (${end}). The earliest entry was used. Check the financial year of the migration, or which ${x.list} Zoho Books should get.`);
    else if (x.newer) add('dated_details_newer', `The ${x.list} in Tally have a newer entry dated ${isoOf(x.newer)}, after the end of the financial year (${end}). It was not used: the file carries the entry that applies on ${end}. Zoho Books will use these details from now on, so check which entry it should get.`);
  }
  return out;
}

// One flagged item per group of Display Names (or Account Names) in a file that are the same once line breaks, hidden
// characters, spaces and capital letters are ignored. Nothing is changed or dropped.
const visible = n => n.replace(/\r/g, '<CR>').replace(/\n/g, '<LF>').replace(/\t/g, '<TAB>');
// Rows are counted, not distinct names: two rows written with exactly the same name (for example once one of them is
// cleaned) collide as well.
//
// Pick and drop: two kinds, by how the names are WRITTEN (after any decision in Mapping Studio, Names):
//  - *_duplicate (blocking): two or more rows written with the same name (capital letters ignored). Two different
//    Tally records with one name, or names that became the same because the accountant chose to clean them. Zoho would
//    reject one or merge them, so this must be decided before the import.
//  - *_collides_after_cleaning (a warning): names written differently that are the same only once line breaks, hidden
//    characters and spaces are ignored. They are passed as in Tally, so they only matter if Zoho cleans them on import,
//    or if the accountant chooses to clean them (then they become a *_duplicate).
const writtenKey = n => n.toLowerCase();
function nameCollisionFlags(rows, column, kinds, words) {
  const groups = new Map();
  for (const r of rows) {
    const n = r[column] ?? '';
    if (!n) continue;
    const k = nameKey(n);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(n);
  }
  const out = [];
  for (const names of groups.values()) {
    if (names.length < 2) continue;
    const same = new Set(names.map(writtenKey)).size < names.length; // at least two written the same (capital letters ignored)
    const exact = new Set(names).size === 1;
    const list = names.map(n => `"${visible(n)}"`).join(', ');
    out.push(same
      ? { kind: kinds.same, uses: names.length,
        message: `${names.length} ${words.plural} ${exact ? 'are exactly the same' : 'are written with the same name (capital letters ignored)'}: ${list}. ${words.sameWhy} `
          + `This must be resolved before the import: decide in Mapping Studio (Names, possible duplicates) whether they are ${words.oneOrTwo}.` }
      : { kind: kinds.cleaned, uses: names.length,
        message: `${names.length} ${words.plural} differ only by line breaks, hidden characters, spaces or capital letters: ${list}. `
          + 'They are written exactly as in Tally, so they are different names in the file. This is a warning, not a blocker: it matters only if Zoho Books removes the hidden characters on import, '
          + `or if you choose to clean these names (they would then be the same). If Zoho rejects or merges one, decide in Mapping Studio (Names, possible duplicates) whether they are ${words.oneOrTwo}.` });
  }
  return out;
}
function contactFileFlags(rows, who) {
  return nameCollisionFlags(rows, 'Display Name', { same: 'display_name_duplicate', cleaned: 'display_name_collides_after_cleaning' }, {
    plural: `${who} Display Names`,
    sameWhy: 'Zoho Books matches contacts by Display Name, so the import would reject one as a duplicate or merge them.',
    oneOrTwo: 'the same party ("treat as one party") or two parties with distinct names ("keep both")',
  });
}
// The same check for the Chart of Accounts (Account Name).
function accountFileFlags(rows) {
  return nameCollisionFlags(rows, 'Account Name', { same: 'account_name_duplicate', cleaned: 'account_name_collides_after_cleaning' }, {
    plural: 'Account Names',
    sameWhy: 'Zoho Books does not accept two accounts with the same name, so the import would reject one of them (and its opening balance).',
    oneOrTwo: 'one account ("treat as one") or two accounts with distinct names ("keep both")',
  });
}

// True when a Tally balance is on the unusual side. Tally sign: debit is negative.
// debitIsUsual: true for customers and stock (normally a debit), false for vendors (normally a credit).
export function unusualSide(value, debitIsUsual) {
  const a = money(value);
  if (!a || a.isZero()) return false;
  return debitIsUsual ? !a.isNegative() : a.isNegative();
}

// ---------- Chart of Accounts ----------
// Zoho Books account types, spelled as Zoho Books India shows them. ONE table: zohorules.json lists.account_types
// (each type with a status: confirmed by an import, documented only, do_not_import, not_valid_in_india) and
// lists.account_type_by_tally_group (the type of each standard Tally group). Nothing about types is spelled out in code,
// so a type Zoho renames or refuses is changed in that file only. Zoho creates Accounts Receivable, Accounts Payable and
// the GST tax accounts itself, so they are not offered here ("choosable" is not set on them).
const TYPE_LISTS = (() => { try { return JSON.parse(fs.readFileSync(new URL('./zohorules.json', import.meta.url), 'utf8')).lists; } catch { return {}; } })();
const TYPE_ROWS = TYPE_LISTS.account_types || [];
export const ZOHO_ACCOUNT_TYPES = TYPE_ROWS.filter(t => t.choosable).map(t => t.name);
// 'confirmed' | 'documented' | 'do_not_import' | 'not_valid_in_india' | null (not a type of the list)
export const accountTypeStatus = type => TYPE_ROWS.find(t => t.name === type)?.status || null;
// The type is valid in Zoho Books India (so a row of it is not refused), and whether an import of ours has accepted it.
export const accountTypeIsValid = type => ['confirmed', 'documented'].includes(accountTypeStatus(type));
export const accountTypeIsConfirmed = type => accountTypeStatus(type) === 'confirmed';
// The kind of an account type: 'Asset' | 'Liability' | 'Equity' | 'Income' | 'Expense' (lists.account_types category), or null.
export const accountTypeCategory = type => TYPE_ROWS.find(t => t.name === type)?.category || null;
// Types Zoho renamed or never had in India, with the name to write instead (lists.account_type_renamed).
export const ACCOUNT_TYPE_RENAMED = Object.fromEntries((TYPE_LISTS.account_type_renamed || []).map(r => [String(r.from).toLowerCase(), r.to]));
// Headings where Zoho's Map Fields spelling differs from the first row of its sample (lists.map_field_labels), per file:
// [{ from: heading of the sample's first row, to: Zoho's Map Fields label }]. A layout saved with the old heading is moved
// to the new one (columns.js getMapping).
export const HEADING_RENAMES = (() => {
  const out = {};
  for (const l of TYPE_LISTS.map_field_labels?.labels || []) (out[l.module] ||= []).push({ from: l.sample_heading, to: l.zoho_label });
  return out;
})();
// Customers and Vendors: the columns that stay in the file when empty (lists.contact_columns.always_kept); every other
// column is left out when it is empty on every row. Why this is safe: see the note in that list.
export const CONTACT_ALWAYS_KEPT = new Set(TYPE_LISTS.contact_columns?.always_kept || []);
// Older spellings that may be stored as decisions: the same type, written as Zoho spells it (see migrateAccountTypes in
// extras.js). A stored "Long Term Liability" becomes "Non Current Liability".
export const canonicalAccountType = t => {
  const s = String(t ?? '').trim().toLowerCase();
  const named = ZOHO_ACCOUNT_TYPES.find(x => x.toLowerCase() === s);
  if (named) return named;
  const renamed = ACCOUNT_TYPE_RENAMED[s];
  return renamed && ZOHO_ACCOUNT_TYPES.includes(renamed) ? renamed : null;
};

// Default Tally primary group -> Zoho account type (lists.account_type_by_tally_group). A group not listed here is NOT
// guessed: it needs a decision in Mapping Studio, and until then the row has a blank type and is flagged.
export const ACCOUNT_TYPE_BY_GROUP = Object.fromEntries((TYPE_LISTS.account_type_by_tally_group?.groups || []).map(g => [g.tally_group, g.zoho_type]));

// Tally's own (reserved) groups that were left out of the list above on purpose, because their Zoho type is an
// accountant's decision. They sit under standard groups in Tally (for example Sundry Debtors under Current Assets),
// so the walk up the group chain must stop here: neither they nor their sub-groups take the parent's type.
// The user's decision on the group itself (Mapping Studio) is the only way they get a type. (Ledgers under Sundry
// Debtors and Sundry Creditors are Zoho contacts and are not written to the Chart of Accounts at all.)
export const NO_INHERIT_GROUPS = new Set(['Sundry Debtors', 'Sundry Creditors', 'Bank OCC A/c', 'Branch / Divisions', 'Suspense A/c', 'Misc. Expenses (ASSET)']);

// Tally marks a top-level group's parent as empty, "Primary" or control character 4 followed by " Primary".
export const isPrimaryMarker = parent => { const p = String(parent ?? '').trim(); return !p || p.includes('\u0004') || p.toLowerCase() === 'primary'; };

// How a Tally group gets its Zoho account type. Walks up the group chain from the uploaded Group records:
// the user's decision for the group, else the standard type for the group, else the same for its parent, and so on.
// Returns { type, source: 'decided' | 'standard' | 'inherited' | null, inheritedFrom: group name or null }.
// A group with no answer anywhere in its chain returns type '' and is flagged, never guessed.
// The walk stops at a reserved group listed in NO_INHERIT_GROUPS unless the user decided that group.
// Without Group records (ctx.groupParents empty) only the group itself is looked at, exactly as before.
// A Tally group renamed by the user keeps its reserved name (metadata.reservedname, ctx.groupReserved): the standard
// type and the "no inherit" rule follow the reserved name, so a renamed Sundry Debtors still needs a decision and a
// renamed Duties & Taxes still has its standard type.
const reservedOf = (g, ctx) => ctx?.groupReserved?.[g] || g;
export const standardAccountType = (g, ctx) => ACCOUNT_TYPE_BY_GROUP[reservedOf(g, ctx)] || ACCOUNT_TYPE_BY_GROUP[g] || null;
export function resolveAccountType(group, ctx) {
  const parents = ctx?.groupParents || {};
  const seen = new Set(); // guards against groups that point at each other
  let g = group;
  while (g && !seen.has(g)) {
    seen.add(g);
    const type = ctx?.accountTypes?.[g] || standardAccountType(g, ctx);
    if (type) {
      if (g !== group) return { type, source: 'inherited', inheritedFrom: g };
      return { type, source: ctx?.accountTypes?.[g] ? 'decided' : 'standard', inheritedFrom: null };
    }
    if (NO_INHERIT_GROUPS.has(g) || NO_INHERIT_GROUPS.has(reservedOf(g, ctx))) break; // a reserved group with no decision: the type is not taken from its parent
    g = parents[g]; // undefined when the parent is unknown: the walk stops
  }
  return { type: '', source: null, inheritedFrom: null };
}
// v2 (the zero-decision path): a group with no answer anywhere in its chain still needs an Account Type, because Zoho
// refuses a row without one. When nothing is decided in Mapping Studio, the type is taken from the NATURE Tally itself
// records on the group (or on the nearest group above it): "isrevenue" (a profit and loss group) and
// "isdeemedpositive" (normally a debit balance), ctx.groupNature: { group: { revenue, positive } }.
//   profit and loss, debit  -> Expense            profit and loss, credit -> Income
//   balance sheet, debit    -> Other Current Asset   balance sheet, credit -> Other Current Liability
// For example Tally's own "Suspense A/c" is a balance sheet group with a credit nature: Other Current Liability.
// Returns '' when Tally says nothing (no Group records, or neither field): the row is then flagged as before.
export function defaultAccountType(group, ctx) {
  const seen = new Set();
  for (let g = group; g && !seen.has(g); g = ctx?.groupParents?.[g]) {
    seen.add(g);
    const n = ctx?.groupNature?.[g];
    if (n && typeof n.revenue === 'boolean' && typeof n.positive === 'boolean') {
      return n.revenue ? (n.positive ? 'Expense' : 'Income') : (n.positive ? 'Other Current Asset' : 'Other Current Liability');
    }
  }
  return '';
}
// The Account Type a ledger of the group is written with: decided, standard or inherited (resolveAccountType), else
// the default from the group's nature. The Mapping Studio list still shows such a group as open (resolveAccountType).
export const accountType = (group, ctx) => resolveAccountType(group, ctx).type || defaultAccountType(group, ctx);

// Which section a Tally group belongs to: 'customers' (Sundry Debtors), 'vendors' (Sundry Creditors), 'taxes'
// (Duties & Taxes) or null, walking up the group chain (ctx.groupParents, renamed groups by ctx.groupReserved).
export function groupSection(group, ctx) {
  const seen = new Set();
  for (let g = group; g && !seen.has(g); g = ctx?.groupParents?.[g]) {
    seen.add(g);
    const s = SECTION_GROUPS[g] || SECTION_GROUPS[reservedOf(g, ctx)];
    if (s) return s;
  }
  return null;
}

const accountSources = {
  'Account Name': 'Ledger name, as renamed for a clash with Zoho\'s own accounts, or cleaned or renamed in Mapping Studio (Names), when the accountant decided so',
  'Description': 'Ledger description; when Tally has none, "Tally group: <the ledger\'s group>" so the group stays visible (Parent Account is left empty)',
  'Account Type': 'Decided from the Tally group (standard type, inherited from the group above, or the decision in Mapping Studio)',
  'Parent Account': 'Left empty: Tally groups are not accounts, so no sub-account is created',
  'Account Code': 'Left empty: Tally ledgers have no account code',
  'Account # ': 'Left empty: the bank account number is not taken from Tally',
  'Opening Balance': 'Left empty: the opening balance of the ledger is in the opening balance journal, which carries its own date. Filled (without sign, 2 decimals) only for the ONE account that stays here so that Zoho Books can save the Migration Date',
  'Debit or Credit': '"Debit" or "Credit": the side of the opening balance (Tally writes a debit as negative). Empty when Opening Balance is empty',
};
// The name a Chart of Accounts ledger is written with: renamed when the accountant chose to rename a clash with one of
// Zoho's own accounts (Mapping Studio), otherwise as in Tally. The Tally record is not changed.
export const accountOutputName = (name, ctx) => (ctx?.clashDecisions?.[name]?.decision === 'rename' && ctx.clashDecisions[name].newName) || name;
// A ledger under Duties & Taxes that holds tax PAID or to be recovered (input GST credit, reverse-charge input, TDS or
// tax receivable, advance tax) is an asset, not a liability: written as "Other Current Liability" (the type of Duties &
// Taxes) it would show as a negative liability. Told from Tally's "is input credit" field or the ledger's name (input,
// ITC, receivable, recoverable, advance tax). Only when the type comes from the group's standard type: a type the
// accountant decided for the ledger's own group in Mapping Studio is always used.
const INPUT_SIDE_NAME = /\b(input|itc|receivable|recoverable|advance\s+tax)\b/i;
// What says which side (input or output) a duty ledger is on, other than Tally's own "is input credit" field: the words of the
// name and the side of its opening balance (a debit balance is input credit, a credit balance is tax payable). Used together,
// so that a name that disagrees with the balance is noticed (for example "Output ... ITC reversal" with a credit balance).
const OUTPUT_SIDE_NAME = /\boutput\b/i;
export function taxLedgerSideSignals(d) {
  const field = /^(yes|true)$/i.test(tallyText(d?.isinputcredit).trim());
  const name = String(recordName(d) ?? '').replace(/[\u0000-\u001f]/g, ' ');
  const raw = tallyText(d?.openingbalance).trim();
  const n = Number(raw.replace(/,/g, '').replace(/\s*(dr|cr)\.?$/i, ''));
  const bal = !raw || !Number.isFinite(n) || n === 0 ? null : /dr\.?$/i.test(raw) ? 'input' : /cr\.?$/i.test(raw) ? 'output' : n < 0 ? 'input' : 'output';
  return { field, nameInput: INPUT_SIDE_NAME.test(name), nameOutput: OUTPUT_SIDE_NAME.test(name), balance: bal };
}
export const isInputSideTaxLedger = d => /^(yes|true)$/i.test(tallyText(d?.isinputcredit).trim()) || INPUT_SIDE_NAME.test(String(recordName(d) ?? '').replace(/[\u0000-\u001f]/g, ' '));
export const INPUT_SIDE_TYPE = 'Other Current Asset';
export function ledgerAccountType(d, ctx) {
  const group = recordParent(d);
  const type = accountType(group, ctx);
  if (type === 'Other Current Liability' && groupSection(group, ctx) === 'taxes' && !ctx?.accountTypes?.[group] && isInputSideTaxLedger(d)) return INPUT_SIDE_TYPE;
  if (isCreditCardLedger(d, ctx)) return CREDIT_CARD_TYPE;
  return type;
}
// A credit card kept under Bank Accounts. Tally has no group for credit cards, so the ledger sits with the banks and
// would be written as a Bank account with a credit balance (a negative bank asset in Zoho's balance sheet). It is
// taken as a card only on TWO signs together: the name says "credit card", and the opening balance is a credit (Tally
// sign: a credit is positive). The name alone, or a credit balance alone (an overdrawn or cash credit account), is not
// enough. Only when the type comes from the group's standard type: a type decided in Mapping Studio is always used.
export const CREDIT_CARD_TYPE = 'Credit Card';
const CREDIT_CARD_NAME = /\bcredit\s*cards?\b/i;
export function isCreditCardLedger(d, ctx) {
  const group = recordParent(d);
  if (ctx?.accountTypes?.[group] || accountType(group, ctx) !== 'Bank') return false;
  if (!CREDIT_CARD_NAME.test(String(recordName(d) ?? '').replace(/[\u0000-\u001f]/g, ' '))) return false;
  const ob = money(d?.openingbalance);
  return !!ob && !ob.isZero() && !ob.isNegative();
}
// The ONE chart ledger whose balance is not in the opening balance journal (ctx.openingAnchor, set per migration by
// index.js with defaults.js chooseDateAnchor): mode 'chart' = its balance stays on its Chart of Accounts row, so the
// chart import creates Zoho's opening balance record; mode 'typed' = the one balance a person types. null: none.
const anchorModeOf = (d, ctx) => (ctx?.openingAnchor && ctx.openingAnchor.name === recordName(d) ? ctx.openingAnchor.mode : null);
function accountRow(d, ctx) {
  const group = recordParent(d);
  const ob = openingWithMerged(recordName(d), d?.openingbalance, ctx).total; // with the ledgers treated as the same account
  const type = ledgerAccountType(d, ctx);
  // v2 default 2: an account is written WITHOUT its opening balance; the balance is written once, in the dated opening
  // balance journal (defaults.js openingBalanceViaJournal). It stays here only for a type a journal should not post to
  // (Stock), and for the one date anchor of the migration.
  const has = ob && !ob.isZero() && (!openingBalanceViaJournal(type) || anchorModeOf(d, ctx) === 'chart');
  return {
    'Account Name': outName(recordName(d), ctx),
    'Description': tallyText(d?.description).trim() || (group ? `Tally group: ${group}` : ''),
    'Account Type': type,
    'Opening Balance': has ? amount2(ob) : '',
    'Debit or Credit': has ? (ob.isNegative() ? DEBIT : CREDIT) : '',
  };
}
// True when the ledger's opening balance is written in the opening balance journal instead of the Chart of Accounts
// (every account type but the ones that stay in the chart, and never the date anchor). Returns the balance (Decimal,
// Tally sign) or null.
export function openingBalanceForJournal(d, ctx) {
  if (!openingBalanceViaJournal(ledgerAccountType(d, ctx)) || anchorModeOf(d, ctx)) return null;
  const ob = openingWithMerged(recordName(d), d?.openingbalance, ctx).total;
  return ob && !ob.isZero() ? ob : null;
}
// Tally's own Profit & Loss A/c ledger: reserved name "Profit & Loss A/c" (or, without that, the same name and no group
// above it). It is not written to the Chart of Accounts: Zoho Books keeps the accumulated profit in its own Retained
// Earnings (see accountRecords in index.js).
export function isProfitAndLossLedger(d) {
  const reserved = tallyText(d?.metadata?.reservedname).trim().toLowerCase();
  if (reserved) return reserved === 'profit & loss a/c';
  return !recordParent(d) && /^profit\s*&\s*loss\s*a\/c$/i.test(recordName(d).trim());
}
function accountChecks(d, ctx) {
  const out = [];
  const group = recordParent(d);
  if (!group) {
    out.push({ kind: 'account_without_group', message: 'This ledger has no Tally group, so no Zoho account type can be decided for it in Mapping Studio and the Account Type cell is empty. Zoho Books rejects a row without an account type. An accountant must decide the account type (or leave the ledger out) before the import.' });
  } else if (!accountType(group, ctx)) out.push(`Tally group "${group}" has no approved Zoho account type. Decide it in Mapping Studio.`);
  else if (!resolveAccountType(group, ctx).type) {
    out.push({ kind: 'account_type_default', message: `Tally group "${group}" has no Zoho account type decided in Mapping Studio and no standard one, so the type is taken from the nature Tally records on the group: "${accountType(group, ctx)}". `
      + 'This is the tool\'s default, so that the row is not refused for a missing type. Choose the right type in Mapping Studio (Account types) if it is another.' });
  }
  const builtin = builtinAccount(recordName(d));
  const decided = ctx?.clashDecisions?.[recordName(d)];
  // With the decisions of a migration (decisions.js) every such ledger is entered on Zoho's own account by default
  // (and is then not written here at all) or renamed; this flag is raised only for a row written with the clashing name.
  if (builtin && decided?.decision !== 'rename') {
    const ob = money(d?.openingbalance);
    const bal = ob && !ob.isZero() ? ` It carries an opening balance of ${ob.abs().toFixed(2)} ${ob.isNegative() ? DEBIT : CREDIT}: if the row is rejected, that balance is not entered and Zoho's opening Trial Balance will not tie to Tally's.` : '';
    out.push({ kind: 'zoho_builtin_account_name', message: `The name matches "${builtin}", an account Zoho Books (India) creates itself (in a new organisation, or when GST or TDS is turned on). Zoho does not accept a second account with the same name, so this row may be rejected as a duplicate.${bal} `
      + `Decide in Mapping Studio (Zoho's own accounts): use Zoho's own "${builtin}" account (the default: its opening balance then goes to the opening balance journal), or rename this account.` });
  }
  const journalOb = openingBalanceForJournal(d, ctx);
  if (journalOb) {
    out.push({ kind: 'opening_balance_in_journal', message: `The row is written without an opening balance. Its opening balance of ${journalOb.abs().toFixed(2)} ${journalOb.isNegative() ? DEBIT : CREDIT} is written once, in the opening balance journal (opening_balances_for_zoho_accounts.csv, journal OB-1), which is imported after the Chart of Accounts. `
      + 'A journal carries its own date, so this balance does not depend on the Opening Balance Date of Zoho Books (a balance in the Chart of Accounts file is dated by that setting, and Zoho refuses one on a bank account). '
      + 'If Zoho Books refuses the journal line, the Import Wizard lists this balance to enter under Settings > Setup & Configurations > Opening Balances.' });
  }
  const anchorMode = anchorModeOf(d, ctx);
  const anchorOb = anchorMode ? openingWithMerged(recordName(d), d?.openingbalance, ctx).total : null;
  if (anchorMode === 'chart' && anchorOb && !anchorOb.isZero()) {
    out.push({ kind: 'opening_date_anchor', message: `This is the one account whose opening balance (${anchorOb.abs().toFixed(2)} ${anchorOb.isNegative() ? DEBIT : CREDIT}) stays in the Chart of Accounts file; every other opening balance is in the opening balance journal. `
      + 'Customers or vendors have opening balances, which Zoho Books dates with its Opening Balance Date, and Zoho does not save that date while every balance is 0. The import of this row creates the opening balance record; the date is then edited in the Import Wizard (step "Save the Migration Date"). Nothing is typed. '
      + 'If this row is not imported (for example the account already exists in Zoho Books), check on Settings > Setup & Configurations > Opening Balances that this balance is there.' });
  } else if (anchorMode === 'typed' && anchorOb && !anchorOb.isZero()) {
    out.push({ kind: 'opening_date_balance_to_type', message: `The opening balance of this account (${anchorOb.abs().toFixed(2)} ${anchorOb.isNegative() ? DEBIT : CREDIT}) is in no file: it is the one balance to type in Zoho Books in the Import Wizard step "Save the Migration Date". `
      + 'Customers or vendors have opening balances, Zoho does not save the Opening Balance Date while every balance is 0, and no other ledger with a balance can stay in the Chart of Accounts file. It is left out of the opening balance journal, so it is not counted twice.' });
  }
  if (isCreditCardLedger(d, ctx)) {
    out.push({ kind: 'bank_ledger_as_credit_card', message: `This ledger is under "${group}" in Tally, its name says credit card and its opening balance is a credit, so it is written with Account Type "${CREDIT_CARD_TYPE}" (a liability), not "${accountType(group, ctx)}". `
      + 'Tally has no group for credit cards. No import has used this type yet: if Zoho Books refuses the row, add the card under Banking > Add Bank or Credit Card before the journals are imported. If it is not a card, choose the type of the group in Mapping Studio (Account types).' });
  } else if (ledgerAccountType(d, ctx) === 'Other Current Liability' && CREDIT_CARD_NAME.test(String(recordName(d) ?? '').replace(/[ -]/g, ' ')) && !ctx?.accountTypes?.[group]) {
    // OB-014: a card kept under a group of its own (Current Liabilities, for example): the type Credit Card has not been
    // imported through the Chart of Accounts file by any test yet, so the confirmed Other Current Liability is kept, and said
    out.push({ kind: 'card_ledger_as_liability', message: `The name says credit card and the ledger is under "${group}", so it is written with Account Type "Other Current Liability" (a liability, which an import has confirmed), not "${CREDIT_CARD_TYPE}". `
      + 'No import has used the type Credit Card through the Chart of Accounts file yet. To keep the card in Banking in Zoho Books, add it there (Banking > Add Bank or Credit Card) with the same name before the journals, and choose the type for the group in Mapping Studio (Account types).' });
  } else if (accountType(group, ctx) === 'Bank' && !ctx?.accountTypes?.[group]) {
    const own = money(d?.openingbalance);
    if (own && !own.isZero() && !own.isNegative()) {
      out.push({ kind: 'bank_ledger_credit_balance', message: `This bank ledger has a credit opening balance (${own.toFixed(2)} Credit). It is written as a Bank account, as its Tally group says, so the balance shows as a negative bank balance in Zoho Books. `
        + 'That is right for an overdrawn or cash credit account. If the ledger is a credit card, Zoho Books has its own account type for it (Credit Card, a liability): the tool does not guess that from the name alone.' });
    }
  }
  // The type written is checked against zohorules.json lists.account_types: a type Zoho Books India does not have is
  // refused ("Invalid row"); a type that is listed but that no import of ours has used yet is an unconfirmed assumption.
  if (group) {
    const type = accountType(group, ctx);
    if (type && !accountTypeIsValid(type)) {
      out.push({ kind: 'account_type_not_valid_in_india', message: `This account is written with Account Type "${type}", which Zoho Books India does not have, so Zoho will refuse the row ("Invalid row"). `
        + 'Choose a type from the list of Zoho Books India in Mapping Studio (Account types).' });
    } else if (type && !accountTypeIsConfirmed(type)) {
      out.push({ kind: 'account_type_unconfirmed', message: `This account is written with Account Type "${type}". Zoho lists this type, but no import of ours has used it yet, so it is not confirmed. `
        + 'If Zoho refuses the row ("Invalid row"), choose another type for the Tally group in Mapping Studio (Account types).' });
    }
  }
  if (ctx?.nameDecisions?.[recordName(d)]?.byDefault && ctx.nameDecisions[recordName(d)].action === 'clean') {
    out.push({ kind: 'name_cleaned_for_zoho', message: `The ledger name is written as "${outName(recordName(d), ctx)}": ${ctx.nameDecisions[recordName(d)].why || 'Zoho Books does not accept it as written in Tally'}. The same cleaned name is written in every file.` });
  }
  const written = outName(recordName(d), ctx);
  if (hasHiddenCharacters(written)) {
    out.push({ kind: 'account_name_hidden_characters', message: `The ledger name, written as Account Name, contains ${hiddenWhat(written)}${EDGE.test(written) ? ' at its start or end' : ''}. ${NAME_AS_IN_TALLY}` });
  }
  const merged = openingWithMerged(recordName(d), d?.openingbalance, ctx);
  if (merged.added.length) {
    const side = a => `${a.abs().toFixed(2)} ${a.isNegative() ? DEBIT : CREDIT}`;
    out.push({ kind: 'accounts_treated_as_one', message: `${merged.added.map(x => `"${visibleName(x.ledger)}"`).join(' and ')} ${merged.added.length === 1 ? 'was' : 'were'} decided in Mapping Studio (Names) to be the same account as this one, so ${merged.added.length === 1 ? 'it is' : 'they are'} not written separately. `
      + `The opening balance written is the total: own ${side(merged.own)}${merged.added.map(x => ` plus ${side(x.amount)}`).join('')} = ${side(merged.total)}. Vouchers that name ${merged.added.length === 1 ? 'either ledger' : 'any of these ledgers'} use this account.` });
  }
  if (money(d?.openingbalance) === null) out.push({ kind: 'opening_balance_unreadable', message: `The opening balance "${tallyText(d.openingbalance)}" cannot be read as an amount, so the Opening Balance cell is empty. Check it in Tally.` });
  // a ledger kept in another currency (an EEFC bank account in dollars): written as a rupee account at Tally's rupee values
  if (!isRupee(tallyText(d?.currencyname))) {
    const a = parseTallyAmount(d?.openingbalance ?? '');
    const code = currencyCode(tallyText(d.currencyname), ctx?.currencies).code;
    out.push({ kind: 'foreign_account_in_rupees', message: `The ledger is kept in "${tallyText(d.currencyname)}"${code ? ` (${code})` : ''} in Tally. It is written as a rupee account (Currency left empty: the base currency)${a && !a.inr.isZero() ? `, with its opening balance at Tally's rupee value ${a.inr.abs().toFixed(2)} ${a.inr.isNegative() ? DEBIT : CREDIT}${a.fx ? ` (${a.fx.abs().toFixed(2)} at ${a.rate})` : ''} in the opening balance journal` : ''}, and its receipts and payments are written in rupees. So its balance in Zoho Books is Tally's rupee balance, but Zoho Books holds no ${code || 'foreign'} balance for it. To keep one, create the account in ${code || 'that currency'} in Zoho Books and enter the balance there. This is the tool's default and is not confirmed by an import yet.` });
  }
  if (groupSection(group, ctx) === 'taxes') {
    const gst = /^gst$/i.test(tallyText(d?.taxtype).trim());
    const t = ledgerAccountType(d, ctx);
    const inputSide = t === INPUT_SIDE_TYPE && t !== accountType(group, ctx)
      ? ` It holds tax paid or to be recovered (input credit or a receivable), so it is written as ${INPUT_SIDE_TYPE}, not ${accountType(group, ctx)}: as a liability its debit balance would show as a negative liability. Choose another type for the group in Mapping Studio (Account types) if needed.` : '';
    const ask = ctx?.taxLedgerAsks?.[recordName(d)];
    const tdsOwn = !ask && !gst && /^tds$/i.test(tallyText(d?.taxtype).trim()) && ctx?.taxEvidence;
    if (tdsOwn) out.push({ kind: 'tds_ledger_kept_separate', message: `TDS ledger under Duties & Taxes. No bill or invoice in these files carries its TDS in the TDS columns (it is posted by journals or payments only, for example TDS on salary), so Zoho Books posts nothing for it on its own account TDS Payable. It is written as an account of its own of type ${t || '(none)'}, with its balance as in Tally.${inputSide}` });
    else if (ask) out.push({ kind: 'tax_ledger_needs_decision', message: `This ${ask.kind === 'tds' ? 'TDS' : ask.kind === 'rcm' ? 'reverse charge' : 'GST'} ledger under Duties & Taxes may belong on ${ask.account ? `Zoho's own account "${ask.account}"` : 'one of its own system accounts'}, but that is not certain (${ask.why}), so it is written as an account of its own. Decide in Mapping Studio (Zoho's own accounts).` });
    else out.push({ kind: 'tax_ledger_in_accounts', message: (gst
      ? `GST ledger under Duties & Taxes${tallyText(d?.gstdutyhead).trim() ? ` (${tallyText(d.gstdutyhead).trim()})` : ''}. It is written as an account of type ${t || '(none)'}${money(d?.openingbalance)?.isZero() === false ? ', with its opening balance' : ''}. Zoho Books creates its own GST tax accounts (input and output CGST, SGST and IGST) when GST is set up. An accountant must decide whether to keep this account, or to remove it from the file and enter its opening balance against Zoho's own tax account.`
      : `Ledger under Duties & Taxes (for example TDS payable or another duty). It is written as an account of type ${t || '(none)'}. If Zoho Books creates its own account for this duty (for example when TDS is set up), an accountant must decide whether to keep this one.`) + inputSide });
  }
  return out;
}

// ---------- Items ----------
export const itemRateOf = s => { const m = String(s ?? '').trim().replace(/,/g, '').match(/^(\d+(?:\.\d+)?)(?:\s*\/.*)?$/); return m ? new Decimal(m[1]).toFixed(2) : ''; };
const productType = t => { const s = String(t ?? '').trim().toLowerCase(); return !s || s === 'goods' ? 'goods' : s === 'services' || s === 'service' ? 'service' : ''; };
// Product Type values as written in sample_items2.csv ("goods", "service").
export const PRODUCT_TYPES = ['goods', 'service'];
// Business type of the migration (Mapping Studio, Rates): 'services' (a service company: Tally's "items" are only
// descriptions on sales bills, with no stock) or 'goods' (trading or manufacturing, with stock).
export const BUSINESS_TYPES = ['services', 'goods'];
// The Product Type an item is written with, and where it comes from: the accountant's choice for the item ('item'),
// "service" for every item of a services business ('business'), else Tally's type of supply ('tally'; "goods" when
// not set, '' when Tally has another value). s: the item's settings (Mapping Studio, Rates).
export function itemProductType(i, s, ctx) {
  if (PRODUCT_TYPES.includes(s?.productType)) return { value: s.productType, source: 'item' };
  if (ctx?.businessType === 'services') return { value: 'service', source: 'business' };
  return { value: productType(i.typeOfSupply), source: 'tally' };
}
export const tallyProductType = i => productType(i.typeOfSupply);
// "Sales and Purchases": the item can be used on invoices AND bills (both files use it) without inventory tracking,
// which would need an Inventory Account and the opening stock. Written as in sample_items2.csv.
const ITEM_TYPE = 'Sales and Purchases';
// "Sales": the item can be used on invoices only. Written for a services business when no purchase account and rate are
// known, because Zoho requires a Purchase Account for an item that can be bought (see itemRates).
const ITEM_TYPE_SALES = 'Sales';
const itemSources = {
  'Item Name': 'Stock item name', 'HSN/SAC': 'HSN code (of the item, or its latest HSN details), after the HSN/SAC corrections of the migration. A value that is not 4, 6 or 8 digits is left empty and flagged', 'Description': 'Description',
  'Rate': 'The selling rate entered in Mapping Studio (Rates), else the standard selling price in Tally (latest), 2 decimals. 0.00 when neither has one (Zoho requires a selling price; flagged as an assumption)',
  'Account': 'The Zoho sales account chosen in Mapping Studio (Rates); when none was chosen, Zoho\'s own "Sales" account',
  'Product Type': 'The type chosen for the item in Mapping Studio (Rates); else "service" when the business type is services (a service company: the default when the Stock Summary is not applicable or there is no stock data); else from Tally\'s type of supply: Goods -> "goods", Services -> "service", "goods" when not set',
  'Usage unit': 'Base unit as written in Tally, or the Zoho unit chosen in unit mapping',
  'Purchase Rate': 'The purchase rate entered in Mapping Studio (Rates), else the standard cost in Tally (latest), 2 decimals. 0.00 when neither has one (flagged as an assumption)',
  'Purchase Account': 'The Zoho purchase account chosen in Mapping Studio (Rates). When none was chosen: empty for an item written as "Sales"; Zoho\'s own "Cost of Goods Sold" account for a goods business',
  'Item Type': '"Sales and Purchases" (usable on invoices and bills, no inventory tracking) when a purchase account is chosen and a purchase rate is known, and for a goods business; "Sales" for a services business when they are not known, because Zoho requires a Purchase Account for an item that can be bought',
  'Initial Stock': 'Left empty: inventory tracking is not set up by this file (the opening stock is flagged instead)',
  'Initial Stock Rate': 'Left empty: inventory tracking is not set up by this file (the opening stock is flagged instead)',
  'Status': 'Fixed value "Active"',
  'Taxability Type': 'The tax preference chosen in Mapping Studio (Rates): Taxable, Non-Taxable, Out Of Scope or Non-GST Supply. Empty when none was chosen (flagged)',
  'Exemption Reason': 'The exemption reason entered in Mapping Studio for a Non-Taxable item',
  'Intra State Tax Name': 'The Zoho tax (usually a tax group of CGST and SGST) chosen in Mapping Studio for a taxable item',
  'Intra State Tax Type': '"Group", as in Zoho\'s sample, when an intra-state tax and a GST rate were entered',
  'Intra State Tax Rate': 'The GST rate entered in Mapping Studio, when an intra-state tax was chosen',
  'Inter State Tax Name': 'The Zoho tax (usually IGST) chosen in Mapping Studio for a taxable item',
  'Inter State Tax Type': '"Simple", as in Zoho\'s sample, when an inter-state tax and a GST rate were entered',
  'Inter State Tax Rate': 'The GST rate entered in Mapping Studio, when an inter-state tax was chosen',
};
// Taxability Type values as written in sample_items2.csv ("Out Of Scope", "Non-GST Supply") and Zoho's help ("Taxable", "Non-Taxable").
export const TAXABILITY_TYPES = ['Taxable', 'Non-Taxable', 'Out Of Scope', 'Non-GST Supply'];
// The row of an item. ctx.itemSettings[item name] holds what the accountant entered in Mapping Studio (rates, tax
// preference); ctx.itemAccounts the Zoho sales and purchase account names. The Tally record is never changed.
function itemRow(d, ctx) {
  const i = itemInfo(d, ctx?.asOf ?? null);
  const s = ctx?.itemSettings?.[i.name] || {};
  const taxable = s.taxability === 'Taxable';
  const rate = taxable && s.taxRate ? s.taxRate : '';
  const r = itemRates(i, s, ctx);
  return {
    'Item Name': i.name, 'HSN/SAC': itemHsn(i, ctx).value, 'Description': i.description, 'Rate': r.rate,
    'Account': r.account,
    'Product Type': itemProductType(i, s, ctx).value, 'Usage unit': ctx?.unitMap?.[i.unit.trim()] || i.unit,
    'Purchase Rate': r.purchaseRate, 'Item Type': r.itemType, 'Status': ACTIVE,
    'Purchase Account': r.purchaseAccount,
    'Taxability Type': s.taxability || '',
    'Exemption Reason': s.taxability === 'Non-Taxable' ? s.exemptionReason || '' : '',
    'Intra State Tax Name': taxable ? s.intraTax || '' : '', 'Intra State Tax Type': taxable && s.intraTax && rate ? 'Group' : '', 'Intra State Tax Rate': taxable && s.intraTax ? rate : '',
    'Inter State Tax Name': taxable ? s.interTax || '' : '', 'Inter State Tax Type': taxable && s.interTax && rate ? 'Simple' : '', 'Inter State Tax Rate': taxable && s.interTax ? rate : '',
  };
}
// v2 default 15: the service item of an account used on invoice lines that are not stock items (vouchers.js names it;
// s: { name, account }). Item Type "Sales" (invoices only: Zoho requires purchase information for an item that can be
// bought), Product Type "service", Rate 0.00 (the price is on each invoice line), the account the lines post to.
// round 1 (issue 10): the Product Type of a service item (an invoice line that is a ledger amount): Tally's type of
// supply of the ledger (or of the voucher line) when it gives one, Goods -> goods, Services -> service; else the
// HSN/SAC (a code starting with 99 is a service, any other code is goods; no code: service). Returns
// { value, source: 'tally' | 'hsn' | 'none', tally, disagrees }.
export function serviceItemProductType({ hsn, typeOfSupply }) {
  const t = String(typeOfSupply ?? '').trim();
  const code = String(hsn ?? '').replace(/\s+/g, '');
  const fromHsn = code ? (/^99/.test(code) ? 'service' : 'goods') : null;
  if (/^goods$/i.test(t) || /^services?$/i.test(t)) {
    const value = /^goods$/i.test(t) ? 'goods' : 'service';
    return { value, source: 'tally', tally: t, disagrees: !!fromHsn && fromHsn !== value };
  }
  return fromHsn ? { value: fromHsn, source: 'hsn', tally: '', disagrees: false } : { value: 'service', source: 'none', tally: '', disagrees: false };
}
export const serviceItemRow = s => ({
  'Item Name': s.name, 'HSN/SAC': s.hsn || '', 'Rate': DEFAULT_ITEM_RATE, 'Account': s.account, 'Product Type': serviceItemProductType(s).value, 'Item Type': ITEM_TYPE_SALES, 'Status': ACTIVE,
});
// How an item is written: its Item Type, rates and accounts (v2 default 3, and docs/ZOHO_IMPORT_RULES.md 8.3).
//  - Rate: Zoho requires a selling price ("Enter the selling price of the item."). The rate entered in Mapping Studio,
//    else Tally's, else 0.00 (rateDefaulted; whether Zoho accepts 0 is not confirmed until the next test import).
//  - Account: the sales account chosen in Mapping Studio (Rates), else Zoho's own "Sales" account (accountDefaulted).
//  - Item Type: Zoho requires a Purchase Account for an item that can be bought (rule ITM-PURCHASE-ACCOUNT-REQUIRED).
//    "Sales and Purchases" is written when a purchase account is chosen AND a purchase rate is known. Otherwise:
//      a services business (the Tally items are only descriptions on sales bills): "Sales", with the Purchase Rate
//        and Purchase Account empty (salesOnly);
//      a goods business (the items can be on bills): "Sales and Purchases" still, with Zoho's own "Cost of Goods Sold"
//        account and Purchase Rate 0.00 where they are not known (purchaseAccountDefaulted, purchaseRateDefaulted).
// ctx: { itemAccounts: { sales, purchase }, businessType }.
export function itemRates(i, s = {}, ctx = null) {
  const rate = s?.rate || itemRateOf(i.standardPrice), knownCost = s?.purchaseRate || itemRateOf(i.standardCost);
  const sales = ctx?.itemAccounts?.sales || '', purchase = ctx?.itemAccounts?.purchase || '';
  const out = { rate: rate || DEFAULT_ITEM_RATE, rateDefaulted: !rate, account: sales || ZOHO_DEFAULT_SALES_ACCOUNT, accountDefaulted: !sales };
  if (purchase && knownCost) return { ...out, itemType: ITEM_TYPE, purchaseRate: knownCost, purchaseAccount: purchase, purchaseRateDefaulted: false, purchaseAccountDefaulted: false, salesOnly: false };
  if (ctx?.businessType === 'services') return { ...out, itemType: ITEM_TYPE_SALES, purchaseRate: '', purchaseAccount: '', purchaseRateDefaulted: false, purchaseAccountDefaulted: false, salesOnly: true };
  return { ...out, itemType: ITEM_TYPE, purchaseRate: knownCost || DEFAULT_ITEM_RATE, purchaseAccount: purchase || ZOHO_DEFAULT_PURCHASE_ACCOUNT, purchaseRateDefaulted: !knownCost, purchaseAccountDefaulted: !purchase, salesOnly: false };
}
// The HSN/SAC of a stock item: Tally's value, a correction, the code chosen for the item, or, when Tally has a heading
// shorter than Zoho takes (a 5-digit SAC group), a code under that heading that fits the words of the item name. Never a
// code suggested from the words alone.
const itemHsn = (i, ctx) => resolveHsn({ raw: i.hsn, item: i.name }, { enabled: ctx?.hsn?.enabled !== false, minDigits: ctx?.hsn?.minDigits || 4, corrections: ctx?.hsnCorrections, defaults: ctx?.hsnDefaults, headingOnly: true });
function itemChecks(d, ctx) {
  const i = itemInfo(d, ctx?.asOf ?? null);
  const plain = [];
  if (!i.unit.trim()) plain.push('Stock item has no unit.');
  if (!i.hsn && i.hsnSource) plain.push(`The HSN code is not on the item: Tally says "${i.hsnSource}", and the export does not hold it there. The HSN/SAC cell is left empty.`);
  const out = plain.length ? [plain.join(' ')] : [];
  const r = itemRates(i, ctx?.itemSettings?.[i.name], ctx);
  if (r.salesOnly) out.push({ kind: 'item_sales_only', message: 'The business type is services and no purchase account and purchase rate are known for this item, so it is written with Item Type "Sales" (Purchase Rate and Purchase Account empty): Zoho Books requires a Purchase Account for an item that can be bought. This is the tool\'s default. To write "Sales and Purchases", choose the purchase account and enter a purchase rate in Mapping Studio (Rates).' });
  if (r.rateDefaulted) out.push({ kind: 'item_rate_zero', message: `The item has no selling rate (none in Tally and none entered in Mapping Studio). Zoho Books requires a selling price, so Rate ${DEFAULT_ITEM_RATE} is written. This is the tool's default: enter the real rate in Mapping Studio (Rates), or correct it in Zoho Books after the import.` });
  if (r.purchaseRateDefaulted) out.push({ kind: 'item_purchase_rate_zero', message: `The item has no purchase rate (none in Tally and none entered in Mapping Studio), so Purchase Rate ${DEFAULT_ITEM_RATE} is written. This is the tool's default: enter the real rate in Mapping Studio (Rates), or correct it in Zoho Books after the import.` });
  const hsn = ctx?.hsn?.enabled === false ? { status: 'off', from: '', value: '' } : itemHsn(i, ctx);
  // one message per item, and it says what is really in the cell (the same words as on the invoice lines)
  if (hsn.source === 'heading') out.push({ kind: 'hsn_from_heading', message: `Tally has the HSN/SAC heading "${hsn.from}" on this item. Zoho Books needs at least ${(ctx?.hsn?.minDigits || 4) >= 6 ? 6 : 4} digits, so ${hsn.value} (${hsn.suggestion.label}), a code under that heading that fits the words of the name, is written.${hsn.suggestion.ambiguous?.length ? ` The words of the name fit ${hsn.suggestion.ambiguous.map(x => `${x.code} (${x.label})`).join(', ')} equally well.` : ''} Confirm it or choose another code under the heading in Mapping Studio (HSN/SAC).` });
  else if (hsn.status === 'not_written' && hsn.value) out.push({ kind: 'hsn_default_used', message: `The HSN/SAC value "${hsn.from}" in Tally is not a code Zoho Books accepts, so the code chosen for this item in Mapping Studio (HSN/SAC), ${hsn.value}, is written.` });
  else if (hsn.status === 'not_written') out.push({ kind: 'hsn_not_written', message: `The HSN/SAC value "${hsn.from}" in Tally is not a code of 4, 6 or 8 digits, which Zoho Books rejects, so the HSN/SAC cell is left empty. Add a correction for this value in Mapping Studio (HSN/SAC corrections) to write the right code.` });
  else if (hsn.status === 'corrected') out.push({ kind: 'hsn_corrected', message: `The HSN/SAC value "${hsn.from}" in Tally is written as "${hsn.value}" (HSN/SAC corrections in Mapping Studio).` });
  if (!itemProductType(i, ctx?.itemSettings?.[i.name], ctx).value) out.push({ kind: 'product_type_not_mapped', message: `Tally's type of supply "${i.typeOfSupply}" is neither Goods nor Services, so Product Type is left empty. An accountant must decide it.` });
  for (const [label, v] of [['standard selling price', i.standardPrice], ['standard cost', i.standardCost]]) {
    if (v && !itemRateOf(v)) out.push({ kind: 'item_rate_not_read', message: `The ${label} "${v}" cannot be read as a rate, so the cell is left empty.` });
  }
  const q = money(i.openingQuantity), val = money(i.openingValue);
  if ((q && !q.isZero()) || (val && !val.isZero())) {
    out.push({ kind: 'item_opening_stock_not_written', message: `The item has an opening stock in Tally (quantity ${i.openingQuantity || '0'}, value ${i.openingValue || '0'}). The file does not set up inventory tracking, so Initial Stock and Initial Stock Rate are left empty and the stock is not entered in Zoho Books by this file. An accountant must decide whether to track inventory in Zoho Books (Item Type "Inventory", with an Inventory Account) and enter the opening stock.` });
  }
  return out;
}
// One flagged item for the whole Items file. rows: the standard rows; records: the Tally stock items, in the same order.
function itemFileFlags(rows, ctx, records = []) {
  const out = [];
  // the default business type is goods, read from the vouchers, although the Stock Summary is marked not applicable (SYN-1)
  if (ctx?.businessType === 'goods' && ctx?.businessTypeDerived && records.length) {
    out.push({ kind: 'business_type_derived', uses: records.length,
      message: `${ctx.businessTypeDerived} The business type is therefore goods (trading or manufacturing): the ${records.length} stock item(s) are written with Product Type from Tally's type of supply and, where a purchase account is known, Item Type "Sales and Purchases", so the bills that name them can be imported. `
        + "This is the tool's default. If the company only sells services, choose the business type 'services' in Mapping Studio (Rates)." });
  }
  if (ctx?.businessType === 'services' && records.length) {
    const byBusiness = records.map(d => itemInfo(d, ctx?.asOf ?? null)).filter(i => itemProductType(i, ctx?.itemSettings?.[i.name], ctx).source === 'business');
    if (byBusiness.length) {
      const goods = byBusiness.filter(i => String(i.typeOfSupply ?? '').trim().toLowerCase() === 'goods').length;
      const unset = byBusiness.filter(i => !String(i.typeOfSupply ?? '').trim()).length;
      out.push({ kind: 'items_written_as_services', uses: byBusiness.length,
        message: `The business type is services (Mapping Studio, Rates), so ${byBusiness.length} of ${rows.length} item(s) are written with Product Type "service"`
          + `${goods || unset ? ` (Tally's type of supply says Goods for ${goods}${unset ? ` and is empty for ${unset}` : ''})` : ''}. `
          + 'In a service company the Tally stock items are only descriptions on sales bills, with no stock. Tally is not changed, and HSN/SAC is written only when Tally has it. '
          + 'If the company trades or manufactures goods, change the business type (or one item) in Mapping Studio (Rates).' });
    }
  }
  // v2: no "item_rate_missing" blocker any more (an item with no rate is written with 0.00 and flagged itself). When no
  // sales or purchase account is chosen in Mapping Studio, Zoho's own default accounts are written: said once.
  const onDefault = rows.filter(r => r.Account === ZOHO_DEFAULT_SALES_ACCOUNT && !ctx?.itemAccounts?.sales).length;
  const purchaseOnDefault = rows.filter(r => r['Purchase Account'] === ZOHO_DEFAULT_PURCHASE_ACCOUNT && !ctx?.itemAccounts?.purchase).length;
  if (onDefault || purchaseOnDefault) out.push({ kind: 'item_account_default', uses: Math.max(onDefault, purchaseOnDefault),
    message: `No ${onDefault ? 'sales account' : ''}${onDefault && purchaseOnDefault ? ' and no ' : ''}${purchaseOnDefault ? 'purchase account' : ''} is chosen for the Items file in Mapping Studio (Rates), so Zoho's own ${onDefault ? `"${ZOHO_DEFAULT_SALES_ACCOUNT}" account is written in Account for ${onDefault} item(s)` : ''}${onDefault && purchaseOnDefault ? ' and ' : ''}${purchaseOnDefault ? `"${ZOHO_DEFAULT_PURCHASE_ACCOUNT}" account in Purchase Account for ${purchaseOnDefault} item(s)` : ''}. `
      + 'This is the tool\'s default. Choose the accounts in Mapping Studio (Rates) if the items should post elsewhere.' });
  const noTax = rows.filter(r => !r['Taxability Type']).length;
  if (noTax) out.push({ kind: 'item_tax_preference_not_set', uses: noTax, message: `The tax preference of ${noTax} of ${rows.length} item(s) (Taxability Type and the Inter State / Intra State tax name, type and rate) is left empty: Zoho Books needs its own tax names there, and Tally keeps the GST rate on the item, its stock group or the company. Choose it in Mapping Studio (Rates), or set it for each item in Zoho Books after the import.` });
  return out;
}

// ---------- Opening balances for Zoho's own accounts ----------
// When the accountant decides, in Mapping Studio, that a Chart of Accounts ledger whose name clashes with an account
// Zoho Books creates itself is to be entered on Zoho's own account, the ledger is left out of the Chart of Accounts
// file. Its opening balance must still reach Zoho Books, so it is written to this file: ONE manual journal in the
// layout of Zoho's official journal import sample (sample_journals.xls, 15 headings in the same order), with one line
// per such ledger on Zoho's account, and one line on Zoho's "Opening Balance Adjustments" account that balances it.
//
// Date: the day BEFORE the first day of the financial year (for 2025-26: 2025-03-31). Zoho Books records the opening
// balances entered with the Chart of Accounts as at the day before the opening balance (migration) date, against
// Opening Balance Adjustments; dating this journal the same day keeps these balances with the others, so they are
// opening balances of the year and not a movement inside it, and Zoho's Trial Balance for the year shows them as opening.
// The other side goes to Opening Balance Adjustments, where Zoho put the other side of every other opening balance:
// the Chart of Accounts import leaves that account carrying exactly the opposite of these balances (they were left out
// of it), so this journal brings it back to zero.
export const JOURNAL_SAMPLE_HEADERS = ['Journal Date', 'Reference Number', 'Journal Number Prefix', 'Journal Number Suffix', 'Notes', 'Journal Type', 'Currency',
  'Account', 'Description', 'Contact Name', 'Debit', 'Credit', 'Status', 'Exchange Rate', 'Branch Name'];
// v2: the same journal also carries the opening balances of Bank and Credit Card accounts, which Zoho's Chart of
// Accounts import does not take ("Opening Balance cannot be associated with the given account"): each line is on the
// account as written in the Chart of Accounts file.
const OB_NOTES = 'Opening balances from Tally of every account that is not a customer or vendor';
const OB2_NOTES = 'Opening balances from Tally of customers in credit and vendors in debit (advances)';
// THE Migration Date of a migration, in ONE place (decisions.js and importwizard.js both call it): the date typed in
// Voucher files when it is a date, else the day before the financial year starts. It is the Opening Balance Date to
// save in Zoho Books AND the date written on the opening balance journals, so a date typed by a person moves both.
// (Zoho advises against transactions ON the Opening Balance Date; this journal was accepted on it in two imports, and
// the wizard's last step presses Sync. It is not moved a day earlier without a Zoho test that shows a wrong balance.)
export function migrationDateOf(chosen, fyFrom) {
  const def = fyFrom ? openingJournalDate(fyFrom) : '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(chosen || ''))) return { date: String(chosen), chosen: true, default: def };
  return { date: def, chosen: false, default: def };
}
// The day before the first day of the financial year, as yyyy-MM-dd (a date format the sample's Field Explanation allows).
export function openingJournalDate(fyFrom) {
  const d = new Date(`${fyFrom}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
const obJournalRow = (date, account, description, amount, journal = '1', contact = '') => ({
  'Journal Date': date, 'Journal Number Prefix': 'OB-', 'Journal Number Suffix': journal, 'Notes': journal === '2' ? OB2_NOTES : OB_NOTES, 'Journal Type': 'both', 'Currency': 'INR',
  'Account': account, 'Description': description, ...(contact ? { 'Contact Name': contact } : {}),
  // Tally sign: a debit is negative
  'Debit': amount.isNegative() ? amount.abs().toFixed(2) : '', 'Credit': amount.isNegative() ? '' : amount.toFixed(2), 'Status': 'published',
});
// Journal OB-2: the opening balance of a customer in credit or a vendor in debit, which Zoho's Opening Balance column
// cannot carry. One line per contact on Accounts Receivable (customer) or Accounts Payable (vendor) with the Contact
// Name as written in the contacts file, on the side Tally has it; the other side is one line on Opening Balance
// Adjustments (contactCreditBalancingRow). No bank, cash or card line, so Zoho can make the line a credit of the
// contact. d: the contact's Tally record; who: 'customer' | 'vendor'. Returns { row, amount } or null when the contact
// has no such balance or is not in rupees (the journal is in rupees; that contact stays flagged for an accountant).
export function contactCreditOpeningRow(d, ctx, who) {
  const v = contactValues(d, ctx, who);
  if (!v.unusual || !v.ob || v.ob.isZero() || !v.rupee) return null;
  const text = String(v.c.name ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return { amount: v.ob, row: obJournalRow(ctx?.openingJournalDate || '', who === 'customer' ? 'Accounts Receivable' : 'Accounts Payable',
    `Opening balance of ${who} "${text}" (in ${who === 'customer' ? 'credit' : 'debit'} in Tally)`, v.ob, '2', outName(v.c.name, ctx)) };
}
// Tally's own Profit & Loss A/c ledger is not an account in Zoho Books: its opening balance (the accumulated profit or
// loss of earlier years) is a line of OB-1 on Zoho's own Retained Earnings account (rule OB-PREVIOUS-PROFIT).
export const ZOHO_RETAINED_EARNINGS = 'Retained Earnings';
export const profitAndLossOpeningRow = (d, ctx) => obJournalRow(ctx?.openingJournalDate || '', ZOHO_RETAINED_EARNINGS,
  'Opening balance of Tally\'s own "Profit & Loss A/c" ledger (the profit or loss of earlier years)', money(d?.openingbalance) || new Decimal(0));
// amounts: the Tally-sign balances of the OB-2 contact lines. Returns the balancing line, or null when they net to zero.
export function contactCreditBalancingRow(amounts, ctx) {
  const net = amounts.reduce((t, a) => t.plus(a), new Decimal(0));
  if (net.isZero()) return null;
  return obJournalRow(ctx?.openingJournalDate || '', ZOHO_OPENING_BALANCE_ACCOUNT, 'The other side of the customer and vendor advances above', net.negated(), '2');
}
// The line of one ledger: on Zoho's own account, with the ledger's opening balance on its own side.
// The balance includes the ledgers the accountant treated as the same account (Mapping Studio, Names).
// The account of the line: Zoho's own account for a ledger entered on it; otherwise (a bank account) the name written
// in the Chart of Accounts file, through the one name resolver.
const openingJournalAccount = (d, ctx) => {
  const name = recordName(d);
  if (ctx?.outputName) return ctx.outputName(name);
  return (ctx?.clashDecisions?.[name]?.decision === 'rename' && ctx.clashDecisions[name].newName) || builtinAccount(name) || name;
};
const zohoAccountOpeningRow = (d, ctx) => obJournalRow(ctx?.openingJournalDate || '', openingJournalAccount(d, ctx),
  `Opening balance of Tally ledger "${cleanForText(recordName(d))}"${ctx?.mergedBalances?.[recordName(d)]?.length ? ` with ${ctx.mergedBalances[recordName(d)].map(x => `"${cleanForText(x.ledger)}"`).join(', ')}` : ''}`,
  openingWithMerged(recordName(d), d?.openingbalance, ctx).total || new Decimal(0));
const cleanForText = s => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
// The line that balances the journal: the opposite of the sum of the ledger lines, on Opening Balance Adjustments.
// Returns null when the ledger lines already balance (nothing to put there).
export function openingBalancingRow(records, ctx) {
  const net = records.reduce((t, d) => t.plus(openingWithMerged(recordName(d), d?.openingbalance, ctx).total || 0), new Decimal(0));
  if (net.isZero()) return null;
  return obJournalRow(ctx?.openingJournalDate || '', ZOHO_OPENING_BALANCE_ACCOUNT, 'The other side of the opening balances above (where Zoho Books puts the other side of opening balances)', net.negated());
}
const obJournalSources = {
  'Journal Date': 'The Migration Date: the day before the first day of the financial year (yyyy-MM-dd), or the date typed in Voucher files. The journal carries its own date, so these balances do not depend on the Opening Balance Date saved in Zoho Books',
  'Journal Number Prefix': 'Fixed value "OB-"', 'Journal Number Suffix': '"1": the journal of the accounts (OB-1). "3": the accounts of a kind of line Zoho has not taken in a test import yet (OB-3), when OB-1 also has lines. "2": the journal of customers in credit and vendors in debit (OB-2), when there are any',
  'Notes': `"${OB_NOTES}" (OB-1) or "${OB2_NOTES}" (OB-2)`, 'Journal Type': 'Fixed value "both" (accrual and cash), as in the sample', 'Currency': 'Fixed value "INR"',
  'Account': `The account of the ledger as written in the Chart of Accounts file, or Zoho's own account for a ledger entered on it (the default, or chosen in Mapping Studio, Zoho's own accounts); in OB-2 "Accounts Receivable" (customer) or "Accounts Payable" (vendor); on the last line of each journal "${ZOHO_OPENING_BALANCE_ACCOUNT}"`,
  'Contact Name': 'Only in OB-2: the customer or vendor, as written in Display Name of the contacts file',
  'Description': 'The Tally ledger the opening balance comes from',
  'Debit': 'Opening balance of the ledger when it is a debit, without sign, 2 decimals', 'Credit': 'Opening balance of the ledger when it is a credit, without sign, 2 decimals',
  'Status': 'Fixed value "published", so the journal posts the balances',
};

// ctx holds the user's approved decisions for this migration:
//   { accountTypes: { tallyGroup: zohoType }, groupParents: { tallyGroup: parentGroup }, taxMap: { ledger: zohoTax }, unitMap: { tallyUnit: zohoUnit } }
// verified + sampleFile: the default headings were compared with this official Zoho sample file (see the tests, which read
// the sample files when they are present). It applies only while a firm uses the default layout (columns.js).
export const TEMPLATES = {
  customers: { module: 'Customers', file: 'contacts_customers.csv', slot: 'customers', objectType: 'Ledger', idColumn: 'Display Name',
    verified: true, sampleFile: 'customer_import_sample_data.xls',
    headers: CUSTOMER_HEADERS, sources: withEmpty(CUSTOMER_HEADERS, contactSources('customer')), row: (d, ctx) => contactRow(d, ctx, 'customer'),
    // A check returns a message, a list of messages or of { kind, message }, or null.
    check: (d, ctx) => contactChecks(d, ctx, 'customer'), fileFlags: rows => contactFileFlags(rows, 'customer') },
  vendors: { module: 'Vendors', file: 'contacts_vendors.csv', slot: 'vendors', objectType: 'Ledger', idColumn: 'Display Name',
    verified: true, sampleFile: 'vendor_import_sample_data.xls',
    headers: VENDOR_HEADERS, sources: withEmpty(VENDOR_HEADERS, contactSources('vendor')), row: (d, ctx) => contactRow(d, ctx, 'vendor'),
    check: (d, ctx) => contactChecks(d, ctx, 'vendor'), fileFlags: rows => contactFileFlags(rows, 'vendor') },
  // Ledgers under Sundry Debtors and Sundry Creditors are Zoho contacts: they are NOT written here (index.js leaves them
  // out, see partyLedger), and Zoho Books keeps their balances in its own Accounts Receivable and Accounts Payable.
  accounts: { module: 'Chart of Accounts', file: 'chart_of_accounts.csv', slot: 'accounts', objectType: 'Ledger', idColumn: 'Account Name',
    verified: true, sampleFile: 'sample_accounts.csv',
    headers: ACCOUNT_HEADERS, sources: withEmpty(ACCOUNT_HEADERS, accountSources), row: accountRow, check: accountChecks, fileFlags: accountFileFlags },
  // Built from the Chart of Accounts ledgers the accountant chose to enter on Zoho's own account (index.js picks them,
  // see zohoAccountLedgers); the last line balances the journal (openingBalancingRow).
  opening_balances_for_zoho_accounts: { module: 'Opening balance journal (import)', file: 'opening_balances_for_zoho_accounts.csv', slot: 'accounts', objectType: 'Ledger', idColumn: 'Account',
    verified: true, sampleFile: 'sample_journals.xls',
    headers: JOURNAL_SAMPLE_HEADERS, sources: withEmpty(JOURNAL_SAMPLE_HEADERS, obJournalSources), row: zohoAccountOpeningRow,
    // each journal of the file (OB-1, OB-2) must balance on its own: Zoho refuses a journal that does not
    fileCheck: rows => {
      const bad = [];
      for (const j of [...new Set(rows.map(r => String(r['Journal Number Suffix'] ?? '')))]) {
        const sum = col => rows.filter(r => String(r['Journal Number Suffix'] ?? '') === j).reduce((t, r) => t.plus(r[col] || 0), new Decimal(0));
        const dr = sum('Debit'), cr = sum('Credit');
        if (!dr.equals(cr)) bad.push(`The opening balance journal${j && j !== '1' ? ` OB-${j}` : ''} does not balance: total debit ${dr.toFixed(2)}, total credit ${cr.toFixed(2)}.`);
      }
      return bad.length ? bad.join(' ') : null;
    } },
  items: { module: 'Items', file: 'items.csv', slot: 'stock_items', objectType: 'StockItem', idColumn: 'Item Name',
    verified: true, sampleFile: 'sample_items2.csv',
    headers: ITEM_HEADERS, sources: withEmpty(ITEM_HEADERS, itemSources),
    // The unit is written as in Tally unless the user mapped it to a Zoho unit. The source record is not changed.
    // Real TallyPrime exports write "not applicable" (control character 4) for an item without a unit: that is no unit.
    row: itemRow, check: itemChecks, fileFlags: itemFileFlags },
  // NOT a Zoho import file. Opening balances reach Zoho Books through the opening balance journal (every ledger that is
  // not a customer or vendor) and the Opening Balance column of the Customers and Vendors files. This report lists the
  // Trial Balance opening figures for checking only; importing it as well would enter the balances twice.
  opening_balances: { module: 'Opening Balances', file: 'opening_balances_reference_do_not_import.csv', slot: 'trial_balance', objectType: 'TrialBalanceLine', verified: false, idColumn: 'Account',
    referenceOnly: true,
    referenceNote: 'Reference report, do not import. The opening balances are already in the opening balance journal file (every account that is not a customer or vendor) and in the Opening Balance column of the Customers and Vendors files. This list of Trial Balance figures is for checking only: importing it as well would enter the balances twice.',
    headers: ['Account', 'Debit', 'Credit'],
    sources: { 'Account': 'Trial Balance ledger name (from a Tally Trial Balance report: the name of the ledger the line was matched to, as the masters write it)',
      'Debit': 'The balance when it is a debit: the Opening Balance column of a Tally Trial Balance report (ledger lines only), or the closing balance of a file of Trial Balance lines',
      'Credit': 'The balance when it is a credit: the Opening Balance column of a Tally Trial Balance report (ledger lines only), or the closing balance of a file of Trial Balance lines' },
    // Two shapes of record (see trialbalance.js):
    //  - a file of Trial Balance lines: name and closingbalance, written as before;
    //  - a line of a Tally Trial Balance report: the OPENING balance column is written (the balance at the start of the
    //    period, because the vouchers of the period are transferred as well). index.js passes only the lowest lines
    //    that were matched to a ledger, and only when the report is at ledger level; ctx.trialBalanceNames gives the
    //    ledger's name as the masters write it, so the account is the one in the Chart of Accounts file.
    row: (d, ctx) => {
      const report = d?.metadata?.source === 'tally_report';
      const a = money(report ? d.openingbalance : d.closingbalance) || new Decimal(0); // Tally sign: debit is negative
      const name = report ? ctx?.trialBalanceNames?.[d.lineno] ?? recordName(d) : recordName(d);
      return { 'Account': name, 'Debit': a.isNegative() ? a.abs().toFixed(2) : '', 'Credit': a.isNegative() || a.isZero() ? '' : a.toFixed(2) };
    },
    fileCheck: rows => {
      const sum = col => rows.reduce((t, r) => t.plus(r[col] || 0), new Decimal(0));
      const dr = sum('Debit'), cr = sum('Credit');
      return dr.equals(cr) ? null : `Opening balances do not balance: total debit ${dr.toFixed(2)}, total credit ${cr.toFixed(2)}. Check that the Trial Balance export is complete.`;
    } },
};
