// Decisions an accountant makes for the Zoho output, kept apart from the Tally data (which is never changed):
//  1. GST treatment code set (per firm, admin only): which of Zoho's two published sets of GST Treatment codes the
//     Customers and Vendors files use (GST_CODE_SETS in zohocodes.js).
//  2. Item rates and accounts (per migration, Mapping Studio "Rates"): selling and purchase rate per stock item, one
//     default rate for every item without one, the Zoho sales and purchase account of the Items file, and an optional
//     tax preference per item; the business type (services, or goods: trading or manufacturing), which sets the
//     Product Type of the items, with an optional Product Type per item.
//  3. Clashes with Zoho's own accounts (per migration, Mapping Studio "Zoho's own accounts"): a Chart of Accounts
//     ledger whose name is the name of an account Zoho Books creates itself is renamed, entered on Zoho's own account
//     (its opening balance then goes to opening_balances_for_zoho_accounts.csv), or left as it is.
// Every change is audited with who, the old and the new value, and marks the files it affects out of date.

import Decimal from 'decimal.js';
import { recordName, tallyText, money, jobYear, matchKey, nameKey } from './tally.js';
import { itemInfo, contactInfo } from './masters.js';
import { groupSection, isPrimaryMarker, ledgerAccountType, accountTypeCategory, canonicalAccountType } from './zoho.js';
import { taxLedgerDefaults, classifyTaxLedger } from './taxaccounts.js';
import { TAXABILITY_TYPES, itemRateOf, migrationDateOf, PRODUCT_TYPES, BUSINESS_TYPES, itemProductType, tallyProductType } from './zoho.js';
import { GST_CODE_SET_IDS, DEFAULT_GST_CODE_SET, GST_CODE_SETS, describeGstCodeSets, builtinAccount, accountNameKey, ZOHO_BUILTIN_ACCOUNTS,
  ZOHO_OPENING_BALANCE_ACCOUNT } from './zohocodes.js';
import { zohoTaxList } from './taxes.js';
import { makeNameResolver, applyContactFixes, cleanName } from './namefix.js';
import { defaultClashDecisions, defaultMerges, nameFailsZohoRule, suggestedRename, hsnForZoho, hsnAccepted, sacSuggestion } from './defaults.js';
import { voucherLines, hsnFieldOn } from './vouchers.js';
import { GSTIN_FORMAT } from './tally.js';
import { companyGstinForHsn } from './companygst.js';

const MAX_NAME = 100;     // longest account or tax name accepted
const MAX_REASON = 200;   // longest exemption reason accepted
const HIDDEN = /[\u0000-\u001f\u007f​﻿]/;
const ITEM_FIELDS = ['rate', 'purchaseRate', 'taxability', 'exemptionReason', 'intraTax', 'interTax', 'taxRate', 'productType'];
const ITEM_COLUMNS = { rate: 'selling_rate', purchaseRate: 'purchase_rate', taxability: 'taxability', exemptionReason: 'exemption_reason', intraTax: 'intra_tax', interTax: 'inter_tax', taxRate: 'tax_rate', productType: 'product_type' };
const FIELD_WORDS = { rate: 'selling rate', purchaseRate: 'purchase rate', taxability: 'taxability type', exemptionReason: 'exemption reason', intraTax: 'intra-state tax', interTax: 'inter-state tax', taxRate: 'GST rate', productType: 'product type' };
// v2: "leave as it is" is no longer a choice. Without a decision Zoho's own account is used (defaults.js).
export const CLASH_DECISIONS = ['rename', 'zoho'];
// The files a clash decision changes: the Chart of Accounts (row renamed or left out), the opening balance journal,
// and the voucher files whose Account column names the ledger.
const CLASH_FILES = ['accounts', 'opening_balances_for_zoho_accounts', 'invoices', 'bills', 'journals', 'other_journals'];

export function setupDecisions(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS firm_settings (firm_id INTEGER NOT NULL, key TEXT NOT NULL, value TEXT, updated_by TEXT, updated_at TEXT, PRIMARY KEY (firm_id, key));
    CREATE TABLE IF NOT EXISTS item_settings (job_id TEXT NOT NULL, item TEXT NOT NULL, selling_rate TEXT, purchase_rate TEXT, taxability TEXT, exemption_reason TEXT,
      intra_tax TEXT, inter_tax TEXT, tax_rate TEXT, decided_by TEXT, at TEXT, PRIMARY KEY (job_id, item));
    CREATE TABLE IF NOT EXISTS item_accounts (job_id TEXT PRIMARY KEY, sales_account TEXT, purchase_account TEXT, decided_by TEXT, at TEXT);
    CREATE TABLE IF NOT EXISTS account_clash_decisions (job_id TEXT NOT NULL, ledger TEXT NOT NULL, decision TEXT NOT NULL, new_name TEXT, decided_by TEXT, at TEXT, PRIMARY KEY (job_id, ledger));
    -- Names (names.js): per ledger, 'clean' (new_name = the cleaned name), 'rename' (a new name typed to keep two
    -- duplicates apart) or 'merge' (treated as the same party or account as merge_into). group_key: the duplicate group
    -- the decision was made for (NULL for 'clean').
    CREATE TABLE IF NOT EXISTS name_decisions (job_id TEXT NOT NULL, ledger TEXT NOT NULL, action TEXT NOT NULL, new_name TEXT, merge_into TEXT, group_key TEXT,
      section TEXT, decided_by TEXT, at TEXT, PRIMARY KEY (job_id, ledger));
    CREATE TABLE IF NOT EXISTS duplicate_decisions (job_id TEXT NOT NULL, group_key TEXT NOT NULL, section TEXT NOT NULL, decision TEXT NOT NULL, kept TEXT, members TEXT,
      decided_by TEXT, at TEXT, PRIMARY KEY (job_id, group_key));
    -- Fix contacts (names.js): corrections for the Customers and Vendors files only. treatment: 'unregistered',
    -- 'regular' or 'composition'; state: a Zoho state code.
    CREATE TABLE IF NOT EXISTS contact_fixes (job_id TEXT NOT NULL, ledger TEXT NOT NULL, gstin TEXT, state TEXT, treatment TEXT, reason TEXT, decided_by TEXT, at TEXT,
      PRIMARY KEY (job_id, ledger));
  `);
  // The settings a generated file was built with (JSON, for example { gstCodes: 'sample' }); NULL for files created
  // before this existed, which were built with the defaults.
  try { db.exec('ALTER TABLE generated_files ADD COLUMN build_settings TEXT'); } catch { /* column already exists */ }
  // Product Type chosen for one item ('goods' | 'service'; NULL: from the business type, else from Tally).
  try { db.exec('ALTER TABLE item_settings ADD COLUMN product_type TEXT'); } catch { /* column already exists */ }
  // Business type per migration ('services' | 'goods'). No row: the default worked out from the stock data.
  db.exec('CREATE TABLE IF NOT EXISTS business_settings (job_id TEXT PRIMARY KEY, business_type TEXT NOT NULL, decided_by TEXT, at TEXT)');
  // HSN/SAC corrections per migration (v2): a value as Tally writes it -> the value written in the Zoho files
  // ('' : written empty on purpose). Applied to the Items file and to the lines of Invoices and Bills.
  // HSN/SAC code chosen for an account (the income or expense ledger of the lines) or an item: kind 'account' | 'item'
  db.exec('CREATE TABLE IF NOT EXISTS hsn_defaults (job_id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, code TEXT NOT NULL, decided_by TEXT, at TEXT, PRIMARY KEY (job_id, kind, name))');
  db.exec('CREATE TABLE IF NOT EXISTS hsn_corrections (job_id TEXT NOT NULL, old_value TEXT NOT NULL, new_value TEXT, decided_by TEXT, at TEXT, PRIMARY KEY (job_id, old_value))');
  // v2: a PAN corrected in Fix contacts (written in the PAN Number column of Customers and Vendors)
  try { db.exec('ALTER TABLE contact_fixes ADD COLUMN pan TEXT'); } catch { /* column already exists */ }
  // v2: "Accept as per Tally" on a decision step: who reviewed it and when (the defaults and Tally values stand)
  db.exec('CREATE TABLE IF NOT EXISTS step_reviews (job_id TEXT NOT NULL, step TEXT NOT NULL, reviewed_by TEXT, at TEXT, PRIMARY KEY (job_id, step))');
}

// ---------- business type (services, or goods: trading or manufacturing) ----------
// Stock items exist only in a company that trades or makes goods. In a service company the Tally "items" are only
// descriptions on sales bills, so the Items file writes them with Product Type "service".
// The default is read from the data: goods when any voucher moves stock (an inventory line) or a Stock Summary file is
// uploaded; services otherwise. Marking the Stock Summary not applicable does NOT make a company that moves stock a
// services company (SYN-1): the Stock Summary is often simply not exported, and items written as sales-only services
// would make every bill with a stock item refused (BIL-ITEM-PURCHASE-INFO). derived: true when the Stock Summary is
// marked not applicable but the vouchers show goods (said under "Assumptions the tool made", kind business_type_derived).
// Stock items in the masters without any inventory line are not enough: in a service company they are only descriptions.
export function defaultBusinessType(db, jobId) {
  const waived = db.prepare("SELECT 1 FROM waivers WHERE job_id = ? AND slot = 'stock_summary'").get(jobId);
  const summary = db.prepare("SELECT 1 FROM uploads WHERE job_id = ? AND slot = 'stock_summary'").get(jobId);
  const inventory = db.prepare(`SELECT COUNT(*) n FROM source_records WHERE job_id = ? AND object_type = 'Voucher'
    AND (COALESCE(json_array_length(json_extract(data, '$.allinventoryentries')), 0) > 0 OR COALESCE(json_array_length(json_extract(data, '$.inventoryentries')), 0) > 0
      OR json_type(data, '$.allinventoryentries') = 'object')`).get(jobId).n; // TALLY-013: a list written as one object
  if (waived && !summary) {
    if (!inventory) return { value: 'services', reason: 'The Stock Summary is marked not applicable in the Completeness Check and no voucher has an inventory line.' };
    return { value: 'goods', derived: true, inventory,
      reason: `The Stock Summary is marked not applicable in the Completeness Check, but ${inventory} voucher(s) have inventory lines, so the company trades or makes goods.` };
  }
  if (!summary && !inventory) return { value: 'services', reason: 'There is no stock data: no Stock Summary file and no inventory line on any voucher.' };
  return { value: 'goods', reason: summary ? 'A Stock Summary file is uploaded.' : `${inventory} voucher(s) have inventory lines.` };
}
export function businessTypeOf(db, jobId) {
  const row = db.prepare('SELECT * FROM business_settings WHERE job_id = ?').get(jobId);
  const d = defaultBusinessType(db, jobId);
  const decided = BUSINESS_TYPES.includes(row?.business_type) ? row.business_type : null;
  // derived: the default is goods although the Stock Summary is marked not applicable (the vouchers move stock)
  return { value: decided || d.value, source: decided ? 'decided' : 'default', defaultValue: d.value, defaultReason: d.reason, derived: !decided && !!d.derived,
    decidedBy: decided ? row.decided_by : null, at: decided ? row.at : null };
}
export const BUSINESS_TYPE_WORDS = { services: 'services (items written as Product Type "service")', goods: 'goods, trading or manufacturing (Product Type from Tally\'s type of supply)' };

// ---------- reading the decisions (used when the files are built) ----------
const firmOfJob = (db, jobId) => db.prepare('SELECT COALESCE(firm_id, 1) firm FROM migrations WHERE id = ?').get(jobId)?.firm ?? 1;
export function gstCodesForFirm(db, firmId) {
  const v = db.prepare("SELECT value FROM firm_settings WHERE firm_id = ? AND key = 'gst_codes'").get(firmId ?? 1)?.value;
  return GST_CODE_SET_IDS.includes(v) ? v : DEFAULT_GST_CODE_SET;
}
// How a Tally party of type "Unregistered/Consumer" is written when the help page codes are used (they tell the two
// apart and Tally does not). '' : not decided, the cell is left empty and flagged.
export const UNREGISTERED_CONSUMER_OPTIONS = [
  { id: '', words: 'left empty and flagged (decide party by party)' },
  { id: 'unregistered', words: 'written as business_unregistered (an unregistered business)' },
  { id: 'consumer', words: 'written as consumer (an individual)' },
];
export function gstUnregisteredConsumerForFirm(db, firmId) {
  const v = db.prepare("SELECT value FROM firm_settings WHERE firm_id = ? AND key = 'gst_unregistered_consumer'").get(firmId ?? 1)?.value;
  return ['unregistered', 'consumer'].includes(v) ? v : '';
}
// The account names of Zoho's own Chart of Accounts export of the organisation (Import Wizard, set-up), or null when
// none was given. The table belongs to the Import Wizard (importwizard.js); it may not exist yet.
export function zohoAccountExport(db, jobId) {
  try {
    if (!db.prepare('SELECT 1 FROM zoho_existing_accounts_meta WHERE job_id = ?').get(jobId)) return null;
    return db.prepare('SELECT name FROM zoho_existing_accounts WHERE job_id = ? ORDER BY rowid').all(jobId).map(r => r.name);
  } catch { return null; }
}
// What the documents of the batch show about its TDS and reverse charge ledgers (taxposting.js). It needs a first pass
// over the vouchers, which only index.js can run, so it registers a provider here: (db, jobId) -> evidence | null.
let taxEvidenceProvider = null;
export const setTaxEvidenceProvider = fn => { taxEvidenceProvider = fn; };
// opts.noTaxEvidence: the decisions without that evidence (what the first pass itself is built with).
// OB-002: the first day the opening balances of the masters are the balances of. A ledger master's opening balance is the
// balance on the day its books begin (Tally's "starting from"). When the books begin INSIDE the migrated year (a company
// that started mid-year), the masters' balances are those of that day, so the Migration Date defaults to the day before
// it (and the opening balance journal is dated so). Otherwise it is the first day of the year. Books beginning before the
// year are checked against the Trial Balance report instead (index.js openingSourceChecks). Returns yyyy-mm-dd or null.
export function openingBalancesFrom(db, jobId, range = jobYear(db.prepare('SELECT * FROM migrations WHERE id = ?').get(jobId))) {
  if (!range) return null;
  let earliest = null;
  try {
    const r = db.prepare("SELECT MIN(json_extract(data, '$.startingfrom')) d FROM source_records WHERE job_id = ? AND object_type = 'Ledger' AND length(json_extract(data, '$.startingfrom')) = 8").get(jobId);
    const s = String(r?.d ?? '');
    earliest = /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null;
  } catch { earliest = null; }
  return earliest && earliest > range.from && earliest <= range.to ? earliest : range.from;
}

export function loadDecisions(db, jobId, opts = {}) {
  let taxEvidence = null;
  if (!opts.noTaxEvidence && taxEvidenceProvider) { try { taxEvidence = taxEvidenceProvider(db, jobId) || null; } catch { taxEvidence = null; } }
  const itemSettings = {};
  for (const r of db.prepare('SELECT * FROM item_settings WHERE job_id = ?').all(jobId)) {
    itemSettings[r.item] = Object.fromEntries(ITEM_FIELDS.map(f => [f, r[ITEM_COLUMNS[f]] || '']));
  }
  const acc = db.prepare('SELECT * FROM item_accounts WHERE job_id = ?').get(jobId);
  // The decisions a person stored (explicit). "leave as it is" (stored by an earlier version) is read as no decision.
  const explicitClash = Object.fromEntries(db.prepare('SELECT * FROM account_clash_decisions WHERE job_id = ?').all(jobId)
    .filter(r => CLASH_DECISIONS.includes(r.decision))
    .map(r => [r.ledger, { decision: r.decision, newName: r.new_name || '', by: r.decided_by, at: r.at }]));
  const range = jobYear(db.prepare('SELECT * FROM migrations WHERE id = ?').get(jobId));
  const asOf = range ? range.to.replace(/-/g, '') : null;
  // Names (Mapping Studio, Names). A 'rename' or 'merge' made for a group of possible duplicates applies only while
  // that group's decision is stored.
  const groupRows = db.prepare('SELECT group_key, members FROM duplicate_decisions WHERE job_id = ?').all(jobId);
  const groups = new Set(groupRows.map(r => r.group_key));
  const explicitNames = Object.fromEntries(db.prepare('SELECT * FROM name_decisions WHERE job_id = ?').all(jobId)
    .filter(r => r.action === 'clean' || groups.has(r.group_key))
    .map(r => [r.ledger, { action: r.action, newName: r.new_name || '', mergeInto: r.merge_into || '', groupKey: r.group_key || null, section: r.section || null, by: r.decided_by, at: r.at }]));
  const contactFixes = Object.fromEntries(db.prepare('SELECT * FROM contact_fixes WHERE job_id = ?').all(jobId)
    .map(r => [r.ledger, { gstin: r.gstin || '', state: r.state || '', treatment: r.treatment || '', pan: r.pan || '', reason: r.reason || '', by: r.decided_by, at: r.at }]));
  const ledgerRows = db.prepare("SELECT id, slot, name FROM source_records WHERE job_id = ? AND object_type = 'Ledger' AND slot IN ('customers','vendors','accounts') ORDER BY id").all(jobId);
  const masterNames = [...new Set([...ledgerRows.map(r => r.name), ...db.prepare("SELECT DISTINCT name FROM source_records WHERE job_id = ? AND object_type = 'Ledger'").all(jobId).map(r => r.name)])];

  // ----- the defaults (defaults.js): used only where no decision is stored; each carries byDefault: true -----
  // 1. a Chart of Accounts ledger (not a customer or vendor) named like one of Zoho's own accounts -> Zoho's own account
  const partyKeys = new Set(ledgerRows.filter(r => r.slot !== 'accounts').map(r => matchKey(r.name)));
  const chartNames = [...new Set(ledgerRows.filter(r => r.slot === 'accounts' && !partyKeys.has(matchKey(r.name))).map(r => r.name))];
  // the Zoho accounts the organisation has: its own Chart of Accounts export when given (Import Wizard), else the
  // researched list (zohocodes.js); zohoName: the Zoho account a ledger put on Zoho's own account is written with
  const exported = zohoAccountExport(db, jobId);
  // OB-004: the Zoho type each chart ledger is written with (the same rules as the Chart of Accounts file), so that a
  // ledger goes on Zoho's own account by default only when the two types are of the same kind
  let clashExtra = {};
  try { clashExtra = JSON.parse(db.prepare('SELECT extra FROM voucher_settings WHERE job_id = ?').get(jobId)?.extra || '{}') || {}; } catch { clashExtra = {}; }
  const typeCtx = { groupParents: {}, groupReserved: {}, groupNature: {},
    accountTypes: Object.fromEntries(db.prepare('SELECT tally_group, zoho_type FROM account_type_overrides WHERE job_id = ?').all(jobId).filter(r => canonicalAccountType(r.zoho_type)).map(r => [r.tally_group, canonicalAccountType(r.zoho_type)])) };
  const yesNo = v => (v === 1 || v === true || /^(yes|true)$/i.test(String(v ?? '').trim()) ? true : v === 0 || v === false || /^(no|false)$/i.test(String(v ?? '').trim()) ? false : null);
  for (const g of db.prepare("SELECT name, json_extract(data, '$.parent') parent, json_extract(data, '$.metadata.reservedname') reserved, json_extract(data, '$.isrevenue') revenue, json_extract(data, '$.isdeemedpositive') positive FROM source_records WHERE job_id = ? AND slot = 'accounts' AND object_type = 'Group' ORDER BY id").all(jobId)) {
    if (g.name && !(g.name in typeCtx.groupParents) && !isPrimaryMarker(g.parent)) typeCtx.groupParents[g.name] = String(g.parent);
    if (g.name && typeof g.reserved === 'string' && g.reserved.trim() && !(g.name in typeCtx.groupReserved)) typeCtx.groupReserved[g.name] = g.reserved.trim();
    if (g.name && !(g.name in typeCtx.groupNature)) typeCtx.groupNature[g.name] = { revenue: yesNo(g.revenue), positive: yesNo(g.positive) };
  }
  const chartData = new Map();
  for (const r of db.prepare("SELECT name, data FROM source_records WHERE job_id = ? AND slot = 'accounts' AND object_type = 'Ledger' ORDER BY id").all(jobId)) if (!chartData.has(r.name)) chartData.set(r.name, r.data);
  const typeOf = name => { try { return chartData.has(name) ? ledgerAccountType(JSON.parse(chartData.get(name)), typeCtx) : ''; } catch { return ''; } };
  const clashDecisions = defaultClashDecisions(chartNames, explicitClash, exported, { typeOf, categoryOf: accountTypeCategory,
    never: [clashExtra.invoiceAdjustmentAccount || 'Other Charges', clashExtra.billAdjustmentAccount || 'Other Expenses'] });
  // Tally GST ledgers (told from the duty head and side, never from the name) go on Zoho's own system tax accounts by
  // default (taxaccounts.js); the ones that may belong there but are not certain are listed in taxLedgerAsks
  const groupParents = {}, groupReserved = {};
  for (const g of db.prepare("SELECT name, json_extract(data, '$.parent') parent, json_extract(data, '$.metadata.reservedname') reserved FROM source_records WHERE job_id = ? AND slot = 'accounts' AND object_type = 'Group' ORDER BY id").all(jobId)) {
    if (g.name && !(g.name in groupParents) && !isPrimaryMarker(g.parent)) groupParents[g.name] = String(g.parent);
    if (g.name && typeof g.reserved === 'string' && g.reserved.trim() && !(g.name in groupReserved)) groupReserved[g.name] = g.reserved.trim();
  }
  const taxRecs = [];
  for (const r of db.prepare("SELECT name, data FROM source_records WHERE job_id = ? AND slot = 'accounts' AND object_type = 'Ledger' ORDER BY id").all(jobId)) {
    if (partyKeys.has(matchKey(r.name))) continue;
    try { taxRecs.push({ name: r.name, data: JSON.parse(r.data) }); } catch { /* unreadable record */ }
  }
  let tdsPosting = 'merge';
  try { tdsPosting = JSON.parse(db.prepare('SELECT extra FROM voucher_settings WHERE job_id = ?').get(jobId)?.extra || '{}')?.tdsPosting === 'per_ledger' ? 'per_ledger' : 'merge'; } catch { tdsPosting = 'merge'; }
  const taxDefaults = taxLedgerDefaults(taxRecs, { groupParents, groupReserved, tdsPosting }, explicitClash, exported, taxEvidence);
  for (const [ledger, d] of Object.entries(taxDefaults.decisions)) if (!clashDecisions[ledger]) clashDecisions[ledger] = d;
  for (const [ledger, d] of Object.entries(clashDecisions)) {
    if (d.decision === 'zoho' && !d.zohoName) {
      const rec = taxRecs.find(x => x.name === ledger);
      const c = rec ? classifyTaxLedger(rec.data, { groupParents, groupReserved }, exported) : null;
      d.zohoName = builtinAccount(ledger, exported) || builtinAccount(ledger) || c?.account || '';
    }
  }
  const taxLedgerAsks = taxDefaults.asks;
  const nameDecisions = { ...explicitNames };
  // 7. a name that breaks a Zoho rule is cleaned (every other name stays as in Tally)
  for (const name of new Set(ledgerRows.map(r => r.name))) {
    if (nameDecisions[name]) continue;
    const why = nameFailsZohoRule(name);
    if (why && cleanName(name)) nameDecisions[name] = { action: 'clean', newName: cleanName(name), mergeInto: '', groupKey: null, section: null, by: null, at: null, byDefault: true, why };
  }
  // 6. two customers (or two vendors) written with the same name -> one party
  const decidedMembers = new Set(Object.entries(explicitNames).filter(([, d]) => d.action !== 'clean').map(([l]) => l));
  for (const r of groupRows) { try { for (const m of JSON.parse(r.members || '[]')) decidedMembers.add(m); } catch { /* none */ } }
  const writtenBefore = n => ((nameDecisions[n]?.action === 'clean' || nameDecisions[n]?.action === 'rename') && nameDecisions[n].newName) || n;
  const contactRows = ledgerRows.filter(r => r.slot !== 'accounts');
  const keyCount = new Map();
  for (const r of contactRows) { const k = `${r.slot}|${nameKey(writtenBefore(r.name))}`; keyCount.set(k, (keyCount.get(k) || new Set()).add(r.name)); }
  const candidates = contactRows.filter(r => keyCount.get(`${r.slot}|${nameKey(writtenBefore(r.name))}`).size > 1);
  if (candidates.length) {
    const dataOf = db.prepare('SELECT data FROM source_records WHERE id = ?');
    const withGstin = candidates.map(r => {
      let gstin = '';
      try { const c = applyContactFixes(contactInfo(JSON.parse(dataOf.get(r.id).data), asOf), contactFixes[r.name]); gstin = c.gstin && GSTIN_FORMAT.test(c.gstin) ? c.gstin : ''; } catch { /* unreadable record: no GSTIN */ }
      return { section: r.slot, name: r.name, gstin };
    });
    for (const m of defaultMerges(withGstin, writtenBefore, decidedMembers)) {
      // (a member a person only CLEANED is still joined: cleaning is not a decision about the duplicate, and it is
      // what makes the two rows carry the same Display Name)
      for (const ledger of m.merged) nameDecisions[ledger] = { action: 'merge', newName: '', mergeInto: m.kept, groupKey: null, section: m.section, by: null, at: null, byDefault: true };
    }
  }
  // 11. HSN/SAC corrections (old value -> new value), per migration
  const hsnCorrections = Object.fromEntries(db.prepare('SELECT old_value, new_value FROM hsn_corrections WHERE job_id = ?').all(jobId).map(r => [r.old_value, r.new_value || '']));
  // HSN/SAC codes chosen for an income (or expense) ledger or a service item, and the organisation's answers about the
  // HSN/SAC field and the Migration Date (voucher settings: voucheropts.js)
  const hsnDefaults = { account: {}, item: {} };
  for (const r of db.prepare('SELECT kind, name, code FROM hsn_defaults WHERE job_id = ?').all(jobId)) if (hsnDefaults[r.kind]) hsnDefaults[r.kind][r.name] = r.code;
  let orgExtra = {};
  try { orgExtra = JSON.parse(db.prepare('SELECT extra FROM voucher_settings WHERE job_id = ?').get(jobId)?.extra || '{}') || {}; } catch { orgExtra = {}; }
  const hsn = { enabled: hsnFieldOn(orgExtra.hsnEnabled, companyGstinForHsn(db, jobId)), minDigits: orgExtra.hsnMinDigits === '4' ? 4 : 6 };
  const booksFrom = openingBalancesFrom(db, jobId, range);
  const migration = migrationDateOf(orgExtra.openingDate, booksFrom || range?.from); // the ONE Migration Date (zoho.js)
  // The opening balance of every ledger merged into another, added to the kept ledger's (namefix.js openingWithMerged).
  const mergedBalances = {};
  for (const [ledger, d] of Object.entries(nameDecisions)) {
    if (d.action !== 'merge') continue;
    const slot = ['customers', 'vendors', 'accounts'].includes(d.section) ? d.section : 'accounts';
    const rec = db.prepare("SELECT data FROM source_records WHERE job_id = ? AND slot = ? AND object_type = 'Ledger' AND name = ? ORDER BY id LIMIT 1").get(jobId, slot, ledger);
    const ob = rec ? JSON.parse(rec.data)?.openingbalance : null;
    (mergedBalances[d.mergeInto] ||= []).push({ ledger, amount: ob == null || typeof ob === 'object' ? '0' : String(ob) });
  }
  return {
    gstCodes: gstCodesForFirm(db, firmOfJob(db, jobId)), gstUnregisteredConsumerAs: gstUnregisteredConsumerForFirm(db, firmOfJob(db, jobId)),
    itemSettings, itemAccounts: { sales: acc?.sales_account || '', purchase: acc?.purchase_account || '' },
    // clashDecisions and nameDecisions are what the files are built with: the stored decisions, and the defaults
    // (byDefault: true) where there is none. explicit: only what a person decided (what the screens show as decided).
    clashDecisions, taxLedgerAsks, hsnDefaults, hsn,
    // what the documents show about the TDS and reverse charge ledgers, and the vendors whose reverse charge bills are an
    // import of services (written as overseas, zoho.js contactValues); null / empty before any voucher is processed
    taxEvidence, rcmForeignVendors: new Set(taxEvidence?.foreignVendors || []),
    // the Migration Date: chosen in Voucher files (Import Wizard), else the day before the financial year starts
    openingJournalDate: migration.date, openingDateChosen: migration.chosen,
    // the books begin inside the year (OB-002): the day they begin, else null
    booksBeginInYear: range && booksFrom && booksFrom !== range.from ? booksFrom : null,
    nameDecisions, mergedBalances, contactFixes, hsnCorrections,
    explicit: { clashDecisions: explicitClash, nameDecisions: explicitNames },
    businessType: businessTypeOf(db, jobId).value,
    // the business type above is the default "goods" read from the vouchers while the Stock Summary is marked not applicable
    businessTypeDerived: businessTypeOf(db, jobId).derived ? businessTypeOf(db, jobId).defaultReason : null,
    // THE name every Zoho file writes for a ledger (namefix.js makeNameResolver)
    outputName: makeNameResolver({ clashDecisions, nameDecisions }, masterNames),
  };
}
// The ledgers that are not written on their own because they were treated as the same party or account as another.
export const mergedAway = (ctx, name) => ctx?.nameDecisions?.[name]?.action === 'merge';

// The name a ledger is written with in the voucher files' Account column, after the accountant's clash decisions:
// renamed, or Zoho's own account. Names are compared ignoring hidden characters (a voucher can name a ledger without
// the line break the master's name ends with). Returns a function name -> name.
export function accountNameMapper(clashDecisions) {
  const map = new Map();
  for (const [ledger, d] of Object.entries(clashDecisions || {})) {
    const to = d.decision === 'rename' ? d.newName : d.decision === 'zoho' ? d.zohoName || builtinAccount(ledger) : null;
    if (to) map.set(matchKey(ledger), to);
  }
  return name => map.get(matchKey(name)) ?? name;
}

// A rate typed by the user: digits with at most 2 decimals, commas allowed as thousands separators. Never rounded.
// Returns { value } ('' to clear) or { error }.
export function parseUserRate(v, what = 'rate') {
  const s = String(v ?? '').trim().replace(/,/g, '');
  if (s === '') return { value: '' };
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return { error: `"${String(v).trim()}" is not a ${what}. Type a number with at most 2 decimals, for example 1250 or 1250.50.` };
  return { value: new Decimal(s).toFixed(2) };
}

// ---------- "Accept as per Tally" (v2) ----------
// A decision step can be marked as reviewed: the person looked at it and the defaults and Tally values stand. Nothing
// in the files changes (they are already built with those values); it is recorded, audited and shown on the screen and
// on Prepare migration. The keys are the decision items of Prepare migration (prepare.js) and the Mapping Studio cards.
export const REVIEW_STEPS = {
  account_types: 'Account types', builtin_accounts: "Zoho's own accounts", names: 'Names', duplicates: 'Possible duplicates',
  contact_fixes: 'Fix contacts', tax_mapping: 'Tax mapping', tds_mapping: 'TDS mapping', item_rates: 'Item rates', units: 'Units',
  voucher_files: 'Voucher files', hsn: 'HSN/SAC corrections', journal_routing: 'Journal routing',
};
// A review is kept when the Tally files are read again (audit item 18: decided to keep it), but it is marked
// beforeReprocess: true when it was made before the data was last read, so the screen can say "reviewed before the
// files were read again" and the person can look once more.
export function stepReviews(db, jobId) {
  let lastRead = null;
  try { lastRead = db.prepare("SELECT finished_at FROM process_runs WHERE job_id = ? AND state = 'done'").get(jobId)?.finished_at || null; } catch { lastRead = null; }
  return Object.fromEntries(db.prepare('SELECT step, reviewed_by, at FROM step_reviews WHERE job_id = ?').all(jobId)
    .filter(r => REVIEW_STEPS[r.step]).map(r => [r.step, { by: r.reviewed_by, at: r.at, beforeReprocess: !!(lastRead && r.at && r.at < lastRead), lastReadAt: lastRead }]));
}

export function registerDecisions(app, { db, need, audit, now, tx, markStale, clearStale, chartLedgers, kindOf }) {
  const actor = req => req.user?.email || 'system';
  const isAdmin = req => ['super_admin', 'admin'].includes(req.user?.role);
  const firmOf = req => (req.user.role === 'super_admin' && /^\d+$/.test(String(req.query?.firmId ?? '')) ? Number(req.query.firmId) : req.user.firm_id);

  // ================= 0. Accept as per Tally =================
  const reviewsView = jobId => ({ steps: stepReviews(db, jobId), keys: Object.keys(REVIEW_STEPS), labels: REVIEW_STEPS });
  app.get('/api/migrations/:id/reviews', (req, reply) => { const job = need(req, reply); if (!job) return; return reviewsView(job.id); });
  // { accepted: true | false }. Viewers cannot (refused before this runs, as every change).
  app.put('/api/migrations/:id/reviews/:step', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const step = String(req.params.step || '');
    if (!REVIEW_STEPS[step]) return reply.code(404).send({ error: `There is no decision step "${step}".` });
    if (typeof req.body?.accepted !== 'boolean') return reply.code(400).send({ error: 'Send { accepted: true } to accept the step as per Tally, or false to undo.' });
    const had = !!db.prepare('SELECT 1 FROM step_reviews WHERE job_id = ? AND step = ?').get(job.id, step);
    if (req.body.accepted === had) return { ...reviewsView(job.id), changed: false };
    if (req.body.accepted) {
      db.prepare('INSERT OR REPLACE INTO step_reviews (job_id, step, reviewed_by, at) VALUES (?,?,?,?)').run(job.id, step, actor(req), now());
      audit(job.id, 'step_accepted_as_tally', `${REVIEW_STEPS[step]}: reviewed and accepted as per Tally (the tool's defaults and the Tally values stand).`);
    } else {
      db.prepare('DELETE FROM step_reviews WHERE job_id = ? AND step = ?').run(job.id, step);
      audit(job.id, 'step_acceptance_undone', `${REVIEW_STEPS[step]}: "accepted as per Tally" was undone.`);
    }
    return { ...reviewsView(job.id), changed: true };
  });

  // ================= 1. GST treatment code set (per firm) =================
  const settingRow = (firmId, key) => db.prepare('SELECT value, updated_by, updated_at FROM firm_settings WHERE firm_id = ? AND key = ?').get(firmId, key);
  const gstView = (req, firmId) => {
    const rows = [settingRow(firmId, 'gst_codes'), settingRow(firmId, 'gst_unregistered_consumer')].filter(Boolean).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    return { codeSet: gstCodesForFirm(db, firmId), unregisteredConsumerAs: gstUnregisteredConsumerForFirm(db, firmId), default: DEFAULT_GST_CODE_SET, options: describeGstCodeSets(),
      unregisteredConsumerOptions: UNREGISTERED_CONSUMER_OPTIONS,
      updatedBy: rows[0]?.updated_by || null, updatedAt: rows[0]?.updated_at || null, canChange: isAdmin(req),
      appliesTo: ['Customers', 'Vendors', 'Invoices', 'Bills'] };
  };
  // What the codes written depend on, in words, for the audit and the out-of-date reason.
  const gstWords = (set, as) => `"${GST_CODE_SETS[set].label}"${set === 'help' ? `, "Unregistered/Consumer" ${UNREGISTERED_CONSUMER_OPTIONS.find(o => o.id === as)?.words}` : ''}`;
  app.get('/api/settings/gst-codes', req => gstView(req, firmOf(req)));
  // { codeSet?: 'sample' | 'help', unregisteredConsumerAs?: '' | 'unregistered' | 'consumer' }
  app.put('/api/settings/gst-codes', (req, reply) => {
    if (!isAdmin(req)) return reply.code(403).send({ error: 'Only an admin can change the GST treatment codes.' });
    const firmId = firmOf(req);
    const before = { set: gstCodesForFirm(db, firmId), as: gstUnregisteredConsumerForFirm(db, firmId) };
    const next = { ...before };
    if (req.body && 'codeSet' in req.body) {
      next.set = String(req.body.codeSet ?? '');
      if (!GST_CODE_SET_IDS.includes(next.set)) return reply.code(400).send({ error: 'Choose one of the two sets of GST treatment codes.' });
    }
    if (req.body && 'unregisteredConsumerAs' in req.body) {
      next.as = String(req.body.unregisteredConsumerAs ?? '');
      if (!UNREGISTERED_CONSUMER_OPTIONS.some(o => o.id === next.as)) return reply.code(400).send({ error: 'Choose how a party marked "Unregistered/Consumer" in Tally is written.' });
    }
    if (before.set === next.set && before.as === next.as) return { ...gstView(req, firmId), changed: false };
    const jobs = db.prepare(`SELECT m.id, g.key, g.build_settings FROM migrations m JOIN generated_files g ON g.job_id = m.id AND g.key IN ('customers','vendors','invoices','bills')
      WHERE COALESCE(m.firm_id, 1) = ?`).all(firmId);
    const byJob = new Map();
    for (const j of jobs) { if (!byJob.has(j.id)) byJob.set(j.id, []); byJob.get(j.id).push(j); }
    const put = (key, value) => db.prepare(`INSERT INTO firm_settings (firm_id, key, value, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (firm_id, key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`).run(firmId, key, value, actor(req), now());
    const was = gstWords(before.set, before.as), is = gstWords(next.set, next.as);
    tx(() => {
      if (before.set !== next.set) put('gst_codes', next.set);
      if (before.as !== next.as) put('gst_unregistered_consumer', next.as);
      audit(null, 'gst_code_set_changed', `Firm ${firmId}: GST treatment codes ${was} -> ${is}`);
      // Files already created for this firm's migrations that were built differently (files created before the
      // setting existed were built with the defaults) are out of date.
      const sig = s => `${s.set}|${s.set === 'help' ? s.as : ''}`;
      for (const [jobId, files] of byJob) {
        clearStale(jobId, 'setting:gst_codes');
        const stale = files.filter(f => {
          let b = null; try { b = JSON.parse(f.build_settings || 'null'); } catch { /* none */ }
          return sig({ set: b?.gstCodes || DEFAULT_GST_CODE_SET, as: b?.gstUnregisteredConsumerAs || '' }) !== sig(next);
        }).map(f => f.key);
        if (!stale.length) continue;
        markStale(jobId, `The GST treatment codes were changed to ${is} (they were ${was}).`, stale, 'setting:gst_codes', actor(req));
        audit(jobId, 'gst_code_set_changed', `GST treatment codes ${was} -> ${is}. The ${stale.join(' and ')} file(s) created earlier are out of date.`, actor(req));
      }
    });
    return { ...gstView(req, firmId), changed: true };
  });

  // ================= 2. Item rates, accounts and tax preference =================
  const items = jobId => db.prepare("SELECT name, data FROM source_records WHERE job_id = ? AND slot = 'stock_items' AND object_type = 'StockItem' ORDER BY id").all(jobId)
    .map(r => { const d = JSON.parse(r.data); return { name: recordName(d), d }; }) // the name itemRow (zoho.js) looks the settings up by
    .filter(x => x.name);
  const taxNames = jobId => zohoTaxList(db, jobId).map(r => r.name);
  const accountOptions = jobId => {
    const dec = loadDecisions(db, jobId).clashDecisions;
    const fromTally = chartLedgers(jobId).filter(r => dec[r.name]?.decision !== 'zoho').map(r => (dec[r.name]?.decision === 'rename' && dec[r.name].newName) || r.name);
    return { fromChartOfAccounts: [...new Set(fromTally)], zohoOwn: ZOHO_BUILTIN_ACCOUNTS };
  };
  const itemView = jobId => {
    const dec = loadDecisions(db, jobId);
    const asOf = (() => { const r = jobYear(db.prepare('SELECT * FROM migrations WHERE id = ?').get(jobId)); return r ? r.to.replace(/-/g, '') : null; })();
    const list = items(jobId).map(({ name, d }) => {
      const i = itemInfo(d, asOf);
      const s = dec.itemSettings[name] || {};
      const tallyRate = itemRateOf(i.standardPrice), tallyPurchaseRate = itemRateOf(i.standardCost);
      return { item: name, tallyRate, tallyPurchaseRate, rate: s.rate || '', purchaseRate: s.purchaseRate || '',
        sellingRateUsed: s.rate || tallyRate, purchaseRateUsed: s.purchaseRate || tallyPurchaseRate,
        taxability: s.taxability || '', exemptionReason: s.exemptionReason || '', intraTax: s.intraTax || '', interTax: s.interTax || '', taxRate: s.taxRate || '',
        // Product Type: the choice for this item ('' none), Tally's own, and the one written with where it comes from
        productType: s.productType || '', tallyProductType: tallyProductType(i), tallyTypeOfSupply: String(i.typeOfSupply ?? ''), ...(pt => ({ productTypeUsed: pt.value, productTypeSource: pt.source }))(itemProductType(i, s, dec)) };
    });
    return {
      items: list, business: { ...businessTypeOf(db, jobId), options: BUSINESS_TYPES.map(id => ({ id, words: BUSINESS_TYPE_WORDS[id] })) }, productTypes: PRODUCT_TYPES, accounts: dec.itemAccounts, accountOptions: accountOptions(jobId), taxNames: taxNames(jobId), taxabilityOptions: TAXABILITY_TYPES,
      counts: { items: list.length, withoutSellingRate: list.filter(x => !x.sellingRateUsed).length, withoutPurchaseRate: list.filter(x => !x.purchaseRateUsed).length,
        withoutTaxPreference: list.filter(x => !x.taxability).length,
        services: list.filter(x => x.productTypeUsed === 'service').length, goods: list.filter(x => x.productTypeUsed === 'goods').length },
    };
  };

  // Checks a change to one item and returns { next, changes: [{ field, from, to }] } or { error }.
  const checkItemPatch = (jobId, name, patch, current) => {
    const next = { ...Object.fromEntries(ITEM_FIELDS.map(f => [f, current?.[f] || ''])) };
    const list = taxNames(jobId);
    for (const f of ITEM_FIELDS) {
      if (!(f in patch)) continue;
      let v = String(patch[f] ?? '').trim();
      if (f === 'rate' || f === 'purchaseRate') { const r = parseUserRate(v, FIELD_WORDS[f]); if (r.error) return { error: r.error }; v = r.value; }
      if (f === 'taxRate' && v !== '') {
        const r = parseUserRate(v, 'GST rate'); if (r.error) return { error: r.error };
        if (new Decimal(r.value).greaterThan(100)) return { error: 'A GST rate cannot be more than 100.' };
        v = new Decimal(r.value).toString();
      }
      if (f === 'taxability' && v !== '' && !TAXABILITY_TYPES.includes(v)) return { error: `Choose a taxability type from the list: ${TAXABILITY_TYPES.join(', ')}.` };
      if ((f === 'intraTax' || f === 'interTax') && v !== '') {
        if (v.length > MAX_NAME || HIDDEN.test(v)) return { error: `The tax name is too long or has hidden characters. Use ${MAX_NAME} characters or fewer.` };
        if (list.length) {
          const hit = list.find(n => n.toLowerCase() === v.toLowerCase());
          if (!hit) return { error: `"${v}" is not in your Zoho tax list. Choose a tax from the list, or add it to the list in Tax mapping first.` };
          v = hit;
        }
      }
      if (f === 'productType' && v !== '' && !PRODUCT_TYPES.includes(v)) return { error: 'Choose the product type goods or service, or leave it to the business type.' };
      if (f === 'exemptionReason' && (v.length > MAX_REASON || HIDDEN.test(v))) return { error: `The exemption reason is too long or has hidden characters. Use ${MAX_REASON} characters or fewer.` };
      next[f] = v;
    }
    if (next.taxability === 'Taxable' && (!next.intraTax || !next.interTax)) return { error: `For a taxable item, choose both the Zoho tax used within the state (intra-state) and the one used between states (inter-state) for "${name}".` };
    if (next.taxability === 'Non-Taxable' && !next.exemptionReason) return { error: `For a non-taxable item, type the exemption reason for "${name}".` };
    if (next.taxability !== 'Taxable') { next.intraTax = ''; next.interTax = ''; next.taxRate = ''; }
    if (next.taxability !== 'Non-Taxable') next.exemptionReason = '';
    const changes = ITEM_FIELDS.filter(f => (current?.[f] || '') !== next[f]).map(f => ({ field: f, from: current?.[f] || '', to: next[f] }));
    return { next, changes };
  };
  const storeItem = (jobId, name, next, by) => {
    if (ITEM_FIELDS.every(f => !next[f])) { db.prepare('DELETE FROM item_settings WHERE job_id = ? AND item = ?').run(jobId, name); return; }
    db.prepare(`INSERT OR REPLACE INTO item_settings (job_id, item, selling_rate, purchase_rate, taxability, exemption_reason, intra_tax, inter_tax, tax_rate, product_type, decided_by, at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(jobId, name, next.rate, next.purchaseRate, next.taxability, next.exemptionReason, next.intraTax, next.interTax, next.taxRate, next.productType || null, by, now());
  };
  const describe = changes => changes.map(c => `${FIELD_WORDS[c.field]} "${c.from}" -> "${c.to}"`).join(', ');
  // Applies changes to several items in one transaction. entries: [{ name, patch }]. how: words for the audit.
  const applyItems = (req, job, entries, how) => {
    const current = loadDecisions(db, job.id).itemSettings;
    const checked = [];
    for (const e of entries) {
      const c = checkItemPatch(job.id, e.name, e.patch, current[e.name]);
      if (c.error) return { error: c.error };
      if (c.changes.length) checked.push({ name: e.name, ...c });
    }
    if (checked.length) {
      tx(() => {
        for (const c of checked) {
          storeItem(job.id, c.name, c.next, actor(req));
          audit(job.id, 'item_setting_changed', `Item "${c.name}" (${how}): ${describe(c.changes)}`);
        }
        markStale(job.id, checked.length === 1 ? `The rates, tax preference or product type of item "${checked[0].name}" were changed (${how}).` : `The rates, tax preference or product type of ${checked.length} items were changed (${how}).`, ['items']);
      });
    }
    return { changed: checked.length };
  };
  const findItem = (jobId, name) => {
    const all = items(jobId).map(x => x.name);
    if (all.includes(name)) return name;
    const byMatch = all.filter(n => matchKey(n) === matchKey(name));
    if (byMatch.length === 1) return byMatch[0];
    const byKey = all.filter(n => nameKey(n) === nameKey(name));
    return byKey.length === 1 ? byKey[0] : byKey.length > 1 ? { ambiguous: byKey.length } : null;
  };

  app.get('/api/migrations/:id/item-rates', (req, reply) => { const job = need(req, reply); if (!job) return; return itemView(job.id); });
  // One item: { item, rate?, purchaseRate?, taxability?, exemptionReason?, intraTax?, interTax?, taxRate?, productType? }.
  // A field left out is not changed; an empty value clears it (productType '': from the business type again).
  app.put('/api/migrations/:id/item-rates', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const name = String(req.body?.item ?? '');
    if (!items(job.id).some(x => x.name === name)) return reply.code(404).send({ error: 'That stock item is not in the uploaded data.' });
    const patch = Object.fromEntries(ITEM_FIELDS.filter(f => req.body && f in req.body).map(f => [f, req.body[f]]));
    const r = applyItems(req, job, [{ name, patch }], 'entered in Mapping Studio');
    if (r.error) return reply.code(400).send({ error: r.error });
    return { ...itemView(job.id), changed: r.changed };
  });
  // Pasted lines: item name<TAB>selling rate, optionally <TAB>purchase rate (as copied from a spreadsheet).
  app.post('/api/migrations/:id/item-rates/paste', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const lines = String(req.body?.text ?? '').split(/\r\n|\r|\n/);
    const entries = [], notFound = [], unreadable = [], repeated = [];
    const seen = new Set();
    lines.forEach((line, i) => {
      if (!line.trim()) return;
      const parts = line.split('\t');
      const lineNo = i + 1;
      if (parts.length < 2) { unreadable.push({ line: lineNo, reason: 'No tab between the item name and the rate.' }); return; }
      const name = parts[0].trim();
      const rate = parseUserRate(parts[1], 'selling rate');
      const purchase = parts.length > 2 && parts[2].trim() !== '' ? parseUserRate(parts[2], 'purchase rate') : null;
      if (rate.error || purchase?.error) { unreadable.push({ line: lineNo, reason: (rate.error || purchase.error) }); return; }
      const found = findItem(job.id, name);
      if (!found || found.ambiguous) { notFound.push({ line: lineNo, name, reason: found?.ambiguous ? `${found.ambiguous} items have this name once capital letters and spaces are ignored. Type it exactly.` : 'No stock item has this name.' }); return; }
      if (seen.has(found)) { repeated.push({ line: lineNo, name }); return; }
      seen.add(found);
      const patch = {};
      if (rate.value !== '') patch.rate = rate.value;
      if (purchase && purchase.value !== '') patch.purchaseRate = purchase.value;
      if (Object.keys(patch).length) entries.push({ name: found, patch });
    });
    const r = applyItems(req, job, entries, 'pasted in Mapping Studio');
    if (r.error) return reply.code(400).send({ error: r.error });
    return { ...itemView(job.id), read: entries.length, changed: r.changed, notFound, unreadable, repeated };
  });
  // One default rate for every item that has no selling rate (none in Tally and none entered), and likewise a default
  // purchase rate. Each item gets its own entry, so it can be changed later one by one.
  app.post('/api/migrations/:id/item-rates/default', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const rate = parseUserRate(req.body?.rate, 'selling rate'), purchase = parseUserRate(req.body?.purchaseRate, 'purchase rate');
    if (rate.error || purchase.error) return reply.code(400).send({ error: rate.error || purchase.error });
    if (!rate.value && !purchase.value) return reply.code(400).send({ error: 'Type a default selling rate, a default purchase rate, or both.' });
    const view = itemView(job.id);
    const entries = view.items.map(x => {
      const patch = {};
      if (rate.value && !x.sellingRateUsed) patch.rate = rate.value;
      if (purchase.value && !x.purchaseRateUsed) patch.purchaseRate = purchase.value;
      return { name: x.item, patch };
    }).filter(e => Object.keys(e.patch).length);
    const r = applyItems(req, job, entries, 'default rate for items without one');
    if (r.error) return reply.code(400).send({ error: r.error });
    return { ...itemView(job.id), changed: r.changed };
  });
  // Business type of the migration: { businessType: 'services' | 'goods' | '' } ('' goes back to the default worked out
  // from the stock data). Audited; when the type the Items file is built with changes, the Items file is out of date
  // (no other file writes the Product Type).
  app.put('/api/migrations/:id/business-type', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const v = String(req.body?.businessType ?? '').trim();
    if (v && !BUSINESS_TYPES.includes(v)) return reply.code(400).send({ error: 'Choose services, or goods (trading or manufacturing).' });
    const before = businessTypeOf(db, job.id);
    if ((before.source === 'decided' ? before.value : '') === v) return { ...itemView(job.id), changed: false };
    tx(() => {
      if (v) db.prepare('INSERT OR REPLACE INTO business_settings (job_id, business_type, decided_by, at) VALUES (?,?,?,?)').run(job.id, v, actor(req), now());
      else db.prepare('DELETE FROM business_settings WHERE job_id = ?').run(job.id);
      const after = businessTypeOf(db, job.id);
      const words = b => `${BUSINESS_TYPE_WORDS[b.value]}${b.source === 'default' ? ', the default' : ', chosen'}`;
      audit(job.id, 'business_type_changed', `Business type: ${words(before)} -> ${words(after)}.${after.source === 'default' ? ` ${after.defaultReason}` : ''}`);
      if (after.value !== before.value) markStale(job.id, `The business type was changed from ${before.value} to ${after.value}, so the Product Type of the items changes.`, ['items']);
    });
    return { ...itemView(job.id), changed: true };
  });
  // The Zoho sales account (Account column) and purchase account (Purchase Account column) of the Items file.
  app.put('/api/migrations/:id/item-accounts', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const cur = loadDecisions(db, job.id).itemAccounts;
    const next = { ...cur };
    for (const [k, f] of [['sales', 'salesAccount'], ['purchase', 'purchaseAccount']]) {
      if (!req.body || !(f in req.body)) continue;
      const v = String(req.body[f] ?? '').trim();
      if (v.length > MAX_NAME || HIDDEN.test(v)) return reply.code(400).send({ error: `The account name is too long or has hidden characters. Use ${MAX_NAME} characters or fewer.` });
      next[k] = v;
    }
    const changes = ['sales', 'purchase'].filter(k => cur[k] !== next[k]);
    if (changes.length) {
      tx(() => {
        if (!next.sales && !next.purchase) db.prepare('DELETE FROM item_accounts WHERE job_id = ?').run(job.id);
        else db.prepare('INSERT OR REPLACE INTO item_accounts (job_id, sales_account, purchase_account, decided_by, at) VALUES (?,?,?,?,?)').run(job.id, next.sales, next.purchase, actor(req), now());
        audit(job.id, 'item_accounts_changed', changes.map(k => `${k} account "${cur[k]}" -> "${next[k]}"`).join(', '));
        markStale(job.id, `The ${changes.map(k => k).join(' and ')} account of the Items file was changed.`, ['items']);
      });
    }
    return { ...itemView(job.id), changed: changes.length > 0 };
  });

  // ================= 3. Clashes with Zoho's own accounts =================
  // v2: with no decision Zoho's own account is used (the default). A person can choose it explicitly, or rename the
  // ledger; "leave as it is" is no longer a choice. decision: what a person decided (null: none); effective: what the
  // files are built with ('zoho' or 'rename'); byDefault: true when it is the tool's default.
  const clashView = jobId => {
    const all = loadDecisions(db, jobId);
    const dec = all.explicit.clashDecisions;
    const ledgers = chartLedgers(jobId);
    const exported = zohoAccountExport(db, jobId);
    // ledgers named like a Zoho account, and Tally GST ledgers that belong on a Zoho system tax account (taxaccounts.js):
    // a certain one is entered on Zoho's account by default, a doubtful one is only suggested (needsDecision)
    const taxDefault = n => (all.clashDecisions[n]?.taxLedger ? all.clashDecisions[n].zohoName : '');
    const clashes = ledgers.map(r => ({ r, builtin: builtinAccount(r.name, exported) || taxDefault(r.name) || all.taxLedgerAsks?.[r.name]?.account || '' })).filter(x => x.builtin).map(({ r, builtin }) => {
      const d = JSON.parse(r.data);
      const ob = money(d.openingbalance);
      const decided = dec[r.name];
      return {
        ledger: r.name, zohoAccount: builtin, group: tallyText(d.parent) || null,
        openingBalance: ob && !ob.isZero() ? { amount: ob.abs().toFixed(2), side: ob.isNegative() ? 'Debit' : 'Credit' } : null,
        decision: decided?.decision || null, newName: decided?.newName || '', decidedBy: decided?.by || null, decidedAt: decided?.at || null,
        effective: decided?.decision || (all.taxLedgerAsks?.[r.name] ? 'own' : 'zoho'), byDefault: !decided,
        taxLedger: !!all.clashDecisions[r.name]?.taxLedger || !!all.taxLedgerAsks?.[r.name], needsDecision: !!all.taxLedgerAsks?.[r.name] && !decided,
        why: all.clashDecisions[r.name]?.why || all.taxLedgerAsks?.[r.name]?.why || null,
        suggestedName: suggestedRename(r.name),
      };
    });
    return {
      clashes, undecided: clashes.filter(c => !c.decision).length,
      // undecided clashes are not open work any more: Zoho's own account is used for them by default
      defaultDecision: 'zoho', onDefault: clashes.filter(c => c.byDefault).length, options: CLASH_DECISIONS,
      note: "Without a decision Zoho's own account is used. The list of Zoho's own account names is checked against one real import only.",
      openingBalanceAccount: ZOHO_OPENING_BALANCE_ACCOUNT,
      openingJournalDate: all.openingJournalDate,
    };
  };
  // A new name for a ledger named like one of Zoho's own accounts. others: the names the other accounts of the file are
  // written with. Returns { value } or { error }.
  const checkClashRename = (ledger, typed, others) => {
    const newName = String(typed ?? '').trim();
    if (!newName) return { error: 'Type the new name.' };
    if (newName.length > MAX_NAME || HIDDEN.test(newName)) return { error: `The new name is too long or has hidden characters. Use ${MAX_NAME} characters or fewer.` };
    if (builtinAccount(newName)) return { error: `"${newName}" is also the name of an account Zoho Books creates itself. Choose another name.` };
    if (others.some(n => accountNameKey(n) === accountNameKey(newName))) return { error: `Another account in the Chart of Accounts file is already called "${newName}". Choose another name.` };
    return { value: newName };
  };
  // The names the other Chart of Accounts ledgers are written with (after renames; ledgers on Zoho's own account are not in the file).
  const otherAccountNames = (jobId, except, pending = {}) => {
    const dec = loadDecisions(db, jobId).clashDecisions;
    return chartLedgers(jobId).filter(r => !except.includes(r.name) && dec[r.name]?.decision !== 'zoho')
      .map(r => (dec[r.name]?.decision === 'rename' && dec[r.name].newName) || r.name).concat(Object.values(pending));
  };
  const clashWords = (c, d, name) => (d === 'rename' ? `rename to "${name}"` : d === 'zoho' ? `use Zoho's own "${c.zohoAccount}"` : c.needsDecision || c.effective === 'own' ? 'not decided (the default: an account of its own)' : `not decided (the default: use Zoho's own "${c.zohoAccount}")`);
  // Stores decisions for several ledgers in one transaction. entries: [{ clash, decision, newName }]. Returns how many changed.
  const storeClashes = (req, job, entries, how = '') => {
    const changed = entries.filter(e => clashWords(e.clash, e.clash.decision, e.clash.newName) !== clashWords(e.clash, e.decision, e.newName));
    if (!changed.length) return 0;
    tx(() => {
      for (const e of changed) {
        if (e.decision === null) db.prepare('DELETE FROM account_clash_decisions WHERE job_id = ? AND ledger = ?').run(job.id, e.clash.ledger);
        else db.prepare('INSERT OR REPLACE INTO account_clash_decisions (job_id, ledger, decision, new_name, decided_by, at) VALUES (?,?,?,?,?,?)').run(job.id, e.clash.ledger, e.decision, e.newName || null, actor(req), now());
        audit(job.id, 'account_clash_decided', `Ledger "${e.clash.ledger}" (name of Zoho's own account "${e.clash.zohoAccount}")${how ? ` (${how})` : ''}: ${clashWords(e.clash, e.clash.decision, e.clash.newName)} -> ${clashWords(e.clash, e.decision, e.newName)}`
          + (e.decision !== 'rename' && e.clash.openingBalance ? `. Its opening balance ${e.clash.openingBalance.amount} ${e.clash.openingBalance.side} goes to the opening balance journal.` : ''));
      }
      // the files change only when what they are built with changes (choosing the default explicitly changes nothing)
      const ownDefault = e => !!(e.clash.needsDecision || e.clash.effective === 'own');
      const differs = changed.filter(e => (e.clash.effective === 'rename' ? `rename:${e.clash.newName}` : e.clash.effective === 'own' ? 'own' : 'zoho') !== (e.decision === 'rename' ? `rename:${e.newName}` : e.decision === 'zoho' ? 'zoho' : ownDefault(e) ? 'own' : 'zoho'));
      if (differs.length) {
        markStale(job.id, differs.length === 1
          ? `The decision for ledger "${differs[0].clash.ledger}", whose name is the name of Zoho's own account "${differs[0].clash.zohoAccount}", was changed (${clashWords(differs[0].clash, differs[0].clash.decision, differs[0].clash.newName)} -> ${clashWords(differs[0].clash, differs[0].decision, differs[0].newName)}).`
          : `The decisions for ${differs.length} ledgers named like Zoho's own accounts were changed${how ? ` (${how})` : ''}.`, CLASH_FILES);
      }
    });
    return changed.length;
  };
  app.get('/api/migrations/:id/account-clashes', (req, reply) => { const job = need(req, reply); if (!job) return; return clashView(job.id); });
  // { ledger, decision: 'rename' | 'zoho' | null (no decision: the default, Zoho's own account), newName (for rename) }
  app.put('/api/migrations/:id/account-clashes', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const ledger = String(req.body?.ledger ?? '');
    const decision = req.body?.decision ?? null;
    const view = clashView(job.id);
    const clash = view.clashes.find(c => c.ledger === ledger);
    if (!clash) return reply.code(404).send({ error: "That ledger is not in the Chart of Accounts file, or its name is not one of Zoho's own account names." });
    if (decision !== null && !CLASH_DECISIONS.includes(decision)) return reply.code(400).send({ error: "Choose rename, or use Zoho's own account. Leaving the account as it is is no longer a choice: Zoho rejects a second account with the same name." });
    let newName = '';
    if (decision === 'rename') {
      const c = checkClashRename(ledger, req.body?.newName, otherAccountNames(job.id, [ledger]));
      if (c.error) return reply.code(400).send({ error: c.error });
      newName = c.value;
    }
    const changed = storeClashes(req, job, [{ clash, decision, newName }]);
    return { ...clashView(job.id), changed: changed > 0 };
  });
  // One decision for every ledger named like one of Zoho's own accounts:
  //   { decision: 'zoho' }                       all: use Zoho's own account
  //   { decision: 'rename', names?: { ledger: new name } }   all: rename; a ledger with no name given gets "<name> (Tally)"
  //   { decision: null }                         all: back to no decision (the default)
  // Nothing is stored unless every new name is accepted.
  app.post('/api/migrations/:id/account-clashes/bulk', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const decision = req.body?.decision ?? null;
    if (decision !== null && !CLASH_DECISIONS.includes(decision)) return reply.code(400).send({ error: "Choose rename, or use Zoho's own account." });
    const view = clashView(job.id);
    const entries = [], errors = [];
    if (decision === 'rename') {
      const typed = req.body?.names && typeof req.body.names === 'object' ? req.body.names : {};
      const pending = {};
      const others = otherAccountNames(job.id, view.clashes.map(c => c.ledger));
      for (const clash of view.clashes) {
        const c = checkClashRename(clash.ledger, typed[clash.ledger] ?? clash.suggestedName, [...others, ...Object.values(pending)]);
        if (c.error) { errors.push({ ledger: clash.ledger, error: c.error }); continue; }
        pending[clash.ledger] = c.value;
        entries.push({ clash, decision, newName: c.value });
      }
    } else for (const clash of view.clashes) entries.push({ clash, decision, newName: '' });
    if (errors.length) return reply.code(400).send({ error: `${errors.length} new name(s) cannot be used. Nothing was changed. ${errors[0].error}`, errors });
    const changed = storeClashes(req, job, entries, decision === 'rename' ? 'all: rename' : decision === 'zoho' ? "all: use Zoho's own account" : 'all: no decision');
    return { ...clashView(job.id), changed };
  });

  // ================= 4. HSN/SAC corrections (v2 default 11) =================
  // Every HSN/SAC value in the data (stock items, and the lines of sales, purchase and journal vouchers), with how
  // many items and lines carry it, whether Zoho accepts it as it is, the correction stored and the value written.
  const hsnView = jobId => {
    const dec = loadDecisions(db, jobId);
    const asOf = jobYear(db.prepare('SELECT * FROM migrations WHERE id = ?').get(jobId))?.to.replace(/-/g, '') || null;
    const found = new Map();
    const note = (value, field) => { const v = String(value ?? '').trim(); if (!v) return; if (!found.has(v)) found.set(v, { value: v, items: 0, lines: 0 }); found.get(v)[field]++; };
    for (const { d } of items(jobId)) note(itemInfo(d, asOf).hsn, 'items');
    for (const r of db.prepare("SELECT data FROM source_records WHERE job_id = ? AND object_type = 'Voucher' AND slot IN ('sales','purchase','journal')").all(jobId)) {
      let v; try { v = JSON.parse(r.data); } catch { continue; }
      for (const l of voucherLines(v)) note(l.hsn, 'lines');
    }
    const stored = Object.fromEntries(db.prepare('SELECT * FROM hsn_corrections WHERE job_id = ?').all(jobId).map(r => [r.old_value, r]));
    const values = [...found.values()].sort((a, b) => a.value.localeCompare(b.value)).map(x => {
      const w = hsnForZoho(x.value, dec.hsnCorrections, dec.hsn.enabled ? dec.hsn.minDigits : 4);
      return { ...x, accepted: hsnAccepted(x.value, dec.hsn.enabled ? dec.hsn.minDigits : 4), correction: stored[x.value] ? stored[x.value].new_value || '' : null, corrected: !!stored[x.value],
        written: w.value, status: w.status, decidedBy: stored[x.value]?.decided_by || null, decidedAt: stored[x.value]?.at || null };
    });
    const current = new Set(values.map(v => v.value));
    // Lines with no HSN/SAC in Tally, by the item or income ledger they are on: the code chosen for each, and the suggestion
    // from the words of its name (zohorules.json lists.sac_suggestions). Only income and expense ledgers are listed.
    const kindFor = kindOf ? kindOf(jobId) : () => null;
    const noCode = new Map();
    for (const r of db.prepare("SELECT slot, data FROM source_records WHERE job_id = ? AND object_type = 'Voucher' AND slot IN ('sales','purchase')").all(jobId)) {
      let v; try { v = JSON.parse(r.data); } catch { continue; }
      for (const l of voucherLines(v)) {
        if (l.party || hsnForZoho(l.hsn, dec.hsnCorrections, dec.hsn.minDigits).value) continue;
        const kind = kindFor(l.ledger);
        if (!l.item && !['income', 'expense', null].includes(kind)) continue;
        const k = l.item ? `item|${l.item}` : `account|${dec.outputName ? dec.outputName(l.ledger) : l.ledger}`;
        if (!noCode.has(k)) noCode.set(k, { kind: l.item ? 'item' : 'account', name: l.item || (dec.outputName ? dec.outputName(l.ledger) : l.ledger), lines: 0, onInvoices: false });
        const e = noCode.get(k); e.lines++; if (r.slot === 'sales') e.onInvoices = true;
      }
    }
    const storedDefaults = dec.hsnDefaults;
    const missing = [...noCode.values()].sort((a, b) => b.lines - a.lines || a.name.localeCompare(b.name)).map(e => {
      const chosen = storedDefaults[e.kind]?.[e.name] || '';
      const s = e.onInvoices ? sacSuggestion(e.name) : null;
      return { ...e, chosen, suggestion: s, written: dec.hsn.enabled ? chosen || s?.code || '' : '', source: !dec.hsn.enabled ? 'off' : chosen ? 'chosen' : s ? 'suggested' : 'missing' };
    });
    return { values, enabled: dec.hsn.enabled, minDigits: dec.hsn.minDigits, noCode: missing, defaultsChosen: Object.values(storedDefaults).reduce((n, m) => n + Object.keys(m).length, 0), rule: 'Zoho Books accepts an HSN/SAC code of 4, 6 or 8 digits. Any other value is written empty unless a correction is stored for it.',
      notInData: Object.values(stored).filter(r => !current.has(r.old_value)).map(r => ({ value: r.old_value, correction: r.new_value || '' })),
      counts: { values: values.length, notWritten: values.filter(v => v.status === 'not_written').length, corrected: values.filter(v => v.corrected).length } };
  };
  app.get('/api/migrations/:id/hsn-corrections', (req, reply) => { const job = need(req, reply); if (!job) return; return hsnView(job.id); });
  // Bulk: { corrections: [{ from, to }] }. to: the code written instead (4, 6 or 8 digits), '' to write the cell empty
  // on purpose, or null to remove the correction. Nothing is stored unless every entry is accepted.
  app.put('/api/migrations/:id/hsn-corrections', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const list = Array.isArray(req.body?.corrections) ? req.body.corrections : null;
    if (!list || !list.length) return reply.code(400).send({ error: 'Send the corrections as a list of { from, to }.' });
    if (list.length > 2000) return reply.code(400).send({ error: 'Too many corrections in one request. Send 2000 or fewer.' });
    const stored = Object.fromEntries(db.prepare('SELECT * FROM hsn_corrections WHERE job_id = ?').all(job.id).map(r => [r.old_value, r.new_value || '']));
    const todo = new Map();
    for (const c of list) {
      const from = String(c?.from ?? '').trim();
      if (!from || from.length > 50 || HIDDEN.test(from)) return reply.code(400).send({ error: 'Each correction needs the old value as Tally writes it.' });
      if (c.to === null || c.to === undefined) { todo.set(from, null); continue; }
      const to = String(c.to).trim();
      if (to !== '' && !hsnAccepted(to)) return reply.code(400).send({ error: `"${to}" is not an HSN/SAC code Zoho Books accepts: it must be 4, 6 or 8 digits. Nothing was changed.` });
      todo.set(from, to);
    }
    const changes = [...todo].filter(([from, to]) => (to === null ? from in stored : stored[from] !== to));
    if (changes.length) {
      tx(() => {
        for (const [from, to] of changes) {
          if (to === null) db.prepare('DELETE FROM hsn_corrections WHERE job_id = ? AND old_value = ?').run(job.id, from);
          else db.prepare('INSERT OR REPLACE INTO hsn_corrections (job_id, old_value, new_value, decided_by, at) VALUES (?,?,?,?,?)').run(job.id, from, to, actor(req), now());
          const words = v => (v === undefined || v === null ? 'no correction' : v === '' ? 'written empty' : `"${v}"`);
          audit(job.id, 'hsn_corrected', `HSN/SAC value "${from}": ${words(stored[from])} -> ${words(to)}`);
        }
        markStale(job.id, changes.length === 1 ? `The HSN/SAC correction for "${changes[0][0]}" was changed.` : `${changes.length} HSN/SAC corrections were changed.`, ['items', 'invoices', 'bills']);
      });
    }
    return { ...hsnView(job.id), changed: changes.length };
  });

  // The HSN/SAC code chosen for an item or an income (or expense) ledger, written on every line of it that has no code in
  // Tally. Body: { defaults: [{ kind: 'item' | 'account', name, code }] }; code null removes the choice. A code is 4, 6
  // or 8 digits, and at least as long as the organisation's Zoho Books takes (voucher setting hsnMinDigits).
  app.put('/api/migrations/:id/hsn-defaults', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const list = Array.isArray(req.body?.defaults) ? req.body.defaults : null;
    if (!list || !list.length) return reply.code(400).send({ error: 'Send the codes as a list of { kind, name, code }.' });
    if (list.length > 2000) return reply.code(400).send({ error: 'Too many codes in one request. Send 2000 or fewer.' });
    const min = loadDecisions(db, job.id).hsn.minDigits;
    const stored = loadDecisions(db, job.id).hsnDefaults;
    const todo = [];
    for (const c of list) {
      const kind = c?.kind, name = String(c?.name ?? '').trim();
      if (!['item', 'account'].includes(kind) || !name || name.length > 200) return reply.code(400).send({ error: 'Each entry needs a kind (item or account) and a name.' });
      if (c.code === null || c.code === undefined || String(c.code).trim() === '') { todo.push({ kind, name, code: null }); continue; }
      const code = String(c.code).trim();
      if (!hsnAccepted(code, min)) return reply.code(400).send({ error: `"${code}" is not an HSN/SAC code this Zoho Books takes: it must be 4, 6 or 8 digits${min >= 6 ? ' and at least 6 digits (change the length in Voucher files if your Zoho Books uses 4)' : ''}. Nothing was changed.` });
      todo.push({ kind, name, code });
    }
    const changes = todo.filter(x => (x.code === null ? stored[x.kind]?.[x.name] !== undefined : stored[x.kind]?.[x.name] !== x.code));
    if (changes.length) {
      tx(() => {
        for (const x of changes) {
          if (x.code === null) db.prepare('DELETE FROM hsn_defaults WHERE job_id = ? AND kind = ? AND name = ?').run(job.id, x.kind, x.name);
          else db.prepare('INSERT OR REPLACE INTO hsn_defaults (job_id, kind, name, code, decided_by, at) VALUES (?,?,?,?,?,?)').run(job.id, x.kind, x.name, x.code, actor(req), now());
          audit(job.id, 'hsn_default_chosen', `HSN/SAC for ${x.kind} "${x.name}": ${stored[x.kind]?.[x.name] ? `"${stored[x.kind][x.name]}"` : 'none'} -> ${x.code ? `"${x.code}"` : 'none'}`);
        }
        markStale(job.id, changes.length === 1 ? `The HSN/SAC code for "${changes[0].name}" was changed.` : `${changes.length} HSN/SAC codes were changed.`, ['items', 'invoices', 'bills']);
      });
    }
    return { ...hsnView(job.id), changed: changes.length };
  });

  return { itemView, clashView, hsnView };
}
