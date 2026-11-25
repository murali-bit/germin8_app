// What the accountant chooses for the voucher files (Invoices, Bills, Manual Journals), kept apart from the Tally data:
//  1. Voucher file settings (per migration): the Bill Number (Tally voucher number, or the supplier's invoice number
//     from Tally's reference field when the voucher has one) and the status of the documents (posted, or drafts).
//  2. TDS mapping (per migration): for each Tally TDS ledger (Tally's type of duty/tax is "TDS"), the Zoho TDS tax
//     (name, section and percentage) written in the bill's TDS columns when the ledger is on the vendor's side.
// Every change is audited with who, the old and the new value, and marks the files it affects out of date.

import { NameSet, matchKey } from './tally.js';
import { taxLedgerInfo, VOUCHER_SETTING_DEFAULTS, BILL_NUMBER_OPTIONS, DOCUMENT_STATUS_OPTIONS, OUT_OF_YEAR_OPTIONS, RCM_UNKNOWN_STATE_OPTIONS, RECOMPUTE_POLICY_OPTIONS, ZOHO_TAX_ROUNDING_OPTIONS, HSN_ENABLED_OPTIONS, HSN_MIN_DIGITS_OPTIONS, hsnFieldOn, PAYMENTS_ROUTE_OPTIONS, TCS_MODE_OPTIONS, TDS_POSTING_OPTIONS } from './vouchers.js';
import { taxUsage } from './taxes.js';
import { resolveTds, storedTdsSection, TDS_ACT_OPTIONS, TDS_BASE_OPTIONS, TDS_ACT_CUTOVER, RATE_WORDS, ACT_WORDS } from './tds.js';
import { BILL_NO_TAX_MODES, TAX_TYPES, tdsSuggestion, tdsSuggestion as suggestOne, TDS_CHOICES, isRoundOffLedger, CUSTOMER_TDS_DEFAULT, tdsSectionOf } from './defaults.js';
import { readTable, headingKey } from './sheet.js';
import { jobYear } from './tally.js';
import { companyGstinForHsn } from './companygst.js';
import { builtinAccount } from './zohocodes.js';

const MAX_NAME = 100, MAX_SECTION = 64; // the longest code of Zoho's new-act list is 46 characters
const HIDDEN = /[\u0000-\u001f\u007f​﻿]/;
const SETTING_WORDS = {
  billNumber: { voucher: 'the Tally voucher number', reference: "the supplier's invoice number (Tally reference) when the voucher has one" },
  documentStatus: { final: 'posted (invoices and bills "open", journals "published")', draft: 'drafts (Zoho Books does not post them until they are approved)' },
  outOfYear: { exclude: 'left out of the files (the default)', include: 'written to the files' },
  tdsAct: { auto: 'by the date of each document (the Income Tax Act 1961 section number before 01/04/2026, the Income Tax Act 2025 code from then on)', old: 'always the section number of the Income Tax Act 1961 (for example 194J)', new: 'always the code of the Income Tax Act 2025 (for example professional_fees)' },
  tdsBase: { subtotal: 'the sub total of the document, before tax (the default)', total: 'the total including tax' },
  rcmUnknownState: { intra: "GST (CGST and SGST): the supply is taken as inside the company's state", overseas: 'IGST, written as an import of services: the vendor and the bill are written as overseas (the default, when the vendor has no GSTIN either)' },
  recomputeDiffPolicy: { adjustment: "write a rounding difference in the Adjustment column so the total equals Tally's (the default)", flag: 'leave it as Zoho works it out and only flag the document' },
  zohoTaxRounding: { line: "each part of the tax (CGST, SGST, IGST) of each line rounded to the paisa: Zoho's item-level tax rounding (the default)", entity: "each part of the tax added up over the document, then rounded: Zoho's transaction-level tax rounding" },
  hsnEnabled: { on: 'on: the HSN Code or SAC field is switched on in Zoho Books (the default of a new India organisation), so every invoice line needs a code of at least the length below', off: 'off: the field is switched off in Zoho Books (Settings, Setup and Configurations, Items): the HSN/SAC cell is left empty' },
  hsnMinDigits: { 6: '6 digits (the default)', 4: '4 digits (Zoho Books set to 4-digit codes)' },
  paymentsRoute: { journals: 'Manual Journals now, on Accounts Receivable or Accounts Payable with the contact (the default: nothing is held and nothing is typed; the list credits_to_apply.csv says which invoice or bill each one settles)',
    module_files: "held for Zoho's Payments Received and Payments Made import files, which the tool builds only from Zoho's own import sample (debit notes to vendors and credit notes to customers then stay held)" },
  tdsPosting: { merge: "merged: each Tally TDS ledger used on bills or invoices is entered on Zoho's own TDS Payable or TDS Receivable, where Zoho posts the TDS (the default)", per_ledger: 'each Tally TDS ledger kept as an account of its own with its balance; a monthly tax alignment journal moves the TDS from Zoho\'s TDS Payable or TDS Receivable to it' },
  tcsMode: { adjustment: 'the Adjustment column of the invoice or bill, moved back to the TCS ledger by the adjustment journal (the default until Zoho\'s TCS columns are proven by an import)', columns: "Zoho's TCS columns (TCS Tax Name, Percentage, Amount, Nature Of Collection): the TCS taxes must be created in Zoho Books first (not proven by an import yet)" },
  billNoTaxMode: { zero_tax: "Zoho's zero-rate tax, GST0 within the state or IGST0 between states (the default)", exemption: 'a tax exemption that exists in Zoho Books', reverse_charge: 'a reverse charge tax' },
};

// yyyy-MM-dd that is a real calendar date
export const validDate = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? '')); if (!m) return false; const d = new Date(`${s}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; };

export function setupVoucherOptions(db) {
  // Zoho's export can hold two TDS taxes of one name (an old-act and a new-act tax): one row per tax. An older database
  // had one row per name; its rows are kept.
  const oldTds = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'zoho_tds_taxes'").get() && !db.prepare("SELECT 1 FROM pragma_table_info('zoho_tds_taxes') WHERE name = 'seq'").get();
  if (oldTds) db.exec('ALTER TABLE zoho_tds_taxes RENAME TO zoho_tds_taxes_old');
  db.exec(`
    CREATE TABLE IF NOT EXISTS zoho_tds_taxes (job_id TEXT NOT NULL, seq INTEGER NOT NULL, name TEXT NOT NULL, rate TEXT, section TEXT, start_date TEXT, end_date TEXT, status TEXT, PRIMARY KEY (job_id, seq));
  `);
  if (oldTds) db.exec('INSERT INTO zoho_tds_taxes (job_id, seq, name, rate, section) SELECT job_id, rowid, name, rate, section FROM zoho_tds_taxes_old; DROP TABLE zoho_tds_taxes_old');
  // the accounts each TDS tax posts to in Zoho ("Account To Track Sales" / "Account To Track Purchases" of the export)
  for (const col of ['sales_account', 'purchase_account']) {
    if (!db.prepare("SELECT 1 FROM pragma_table_info('zoho_tds_taxes') WHERE name = ?").get(col)) db.exec(`ALTER TABLE zoho_tds_taxes ADD COLUMN ${col} TEXT`);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS voucher_settings (job_id TEXT PRIMARY KEY, bill_number TEXT, document_status TEXT, decided_by TEXT, at TEXT);
    CREATE TABLE IF NOT EXISTS tds_mappings (job_id TEXT NOT NULL, ledger TEXT NOT NULL, tds_name TEXT NOT NULL, section TEXT, percent TEXT, decided_by TEXT, at TEXT,
      PRIMARY KEY (job_id, ledger));
    -- Zoho's own TDS taxes of the organisation (Settings > Direct Taxes > Income TDS Rates > More > Export TDS Taxes), when
    -- the accountant gave the export to the tool (Import Wizard, set-up): the TDS pick list, and the names suggested
    CREATE TABLE IF NOT EXISTS zoho_tds_taxes_meta (job_id TEXT PRIMARY KEY, file_name TEXT, taxes INTEGER, uploaded_by TEXT, at TEXT);
  `);
  // v2: out_of_year ('exclude' | 'include'); extra: JSON with the settings for bill lines without GST
  // ({ billNoTaxMode, billExemptionCode, billReverseChargeName, billReverseChargeRate, billReverseChargeType })
  for (const col of ['out_of_year TEXT', 'extra TEXT']) { try { db.exec(`ALTER TABLE voucher_settings ADD COLUMN ${col}`); } catch { /* column already exists */ } }
}

const EXTRA_KEYS = ['billNoTaxMode', 'billExemptionCode', 'billReverseChargeName', 'billReverseChargeRate', 'billReverseChargeType', 'tdsAct', 'tdsBase', 'rcmUnknownState', 'recomputeDiffPolicy', 'zohoTaxRounding', 'hsnEnabled', 'hsnMinDigits', 'openingDate', 'invoiceAdjustmentAccount', 'billAdjustmentAccount', 'paymentsRoute', 'tcsMode', 'tdsPosting'];
// The settings the voucher files are built with: what was chosen, else the default (VOUCHER_SETTING_DEFAULTS).
export function voucherSettings(db, jobId) {
  const r = db.prepare('SELECT * FROM voucher_settings WHERE job_id = ?').get(jobId);
  const pick = (value, options, key) => (options.includes(value) ? value : VOUCHER_SETTING_DEFAULTS[key]);
  let extra = {};
  try { extra = JSON.parse(r?.extra || '{}') || {}; } catch { extra = {}; }
  const text = k => (typeof extra[k] === 'string' ? extra[k] : VOUCHER_SETTING_DEFAULTS[k]);
  return {
    billNumber: pick(r?.bill_number, BILL_NUMBER_OPTIONS, 'billNumber'),
    documentStatus: pick(r?.document_status, DOCUMENT_STATUS_OPTIONS, 'documentStatus'),
    outOfYear: pick(r?.out_of_year, OUT_OF_YEAR_OPTIONS, 'outOfYear'),
    billNoTaxMode: pick(extra.billNoTaxMode, BILL_NO_TAX_MODES, 'billNoTaxMode'),
    tdsAct: pick(extra.tdsAct, TDS_ACT_OPTIONS, 'tdsAct'), tdsBase: pick(extra.tdsBase, TDS_BASE_OPTIONS, 'tdsBase'),
    rcmUnknownState: pick(extra.rcmUnknownState, RCM_UNKNOWN_STATE_OPTIONS, 'rcmUnknownState'), recomputeDiffPolicy: pick(extra.recomputeDiffPolicy, RECOMPUTE_POLICY_OPTIONS, 'recomputeDiffPolicy'),
    zohoTaxRounding: pick(extra.zohoTaxRounding, ZOHO_TAX_ROUNDING_OPTIONS, 'zohoTaxRounding'),
    invoiceAdjustmentAccount: text('invoiceAdjustmentAccount'), billAdjustmentAccount: text('billAdjustmentAccount'),
    hsnEnabled: hsnFieldOn(extra.hsnEnabled, companyGstinForHsn(db, jobId)) ? 'on' : 'off', hsnMinDigits: pick(extra.hsnMinDigits, HSN_MIN_DIGITS_OPTIONS, 'hsnMinDigits'),
    openingDate: validDate(extra.openingDate) ? extra.openingDate : '',
    paymentsRoute: pick(extra.paymentsRoute, PAYMENTS_ROUTE_OPTIONS, 'paymentsRoute'),
    tcsMode: pick(extra.tcsMode, TCS_MODE_OPTIONS, 'tcsMode'), tdsPosting: pick(extra.tdsPosting, TDS_POSTING_OPTIONS, 'tdsPosting'),
    billExemptionCode: text('billExemptionCode'), billReverseChargeName: text('billReverseChargeName'), billReverseChargeRate: text('billReverseChargeRate'), billReverseChargeType: text('billReverseChargeType'),
    decidedBy: r?.decided_by || null, at: r?.at || null,
  };
}
export const tdsMappings = (db, jobId) => Object.fromEntries(db.prepare('SELECT * FROM tds_mappings WHERE job_id = ?').all(jobId)
  .map(r => [r.ledger, { tdsName: r.tds_name, section: r.section || '', percent: r.percent || '', by: r.decided_by, at: r.at }]));

// What the masters say about every ledger under Duties & Taxes: a function ledger name -> taxLedgerInfo (or null).
// Names are compared ignoring hidden characters, as everywhere else.
export function taxLedgerInfos(db, jobId) {
  const byKey = new Map();
  for (const r of db.prepare("SELECT name, data FROM source_records WHERE job_id = ? AND slot = 'taxes' ORDER BY id").all(jobId)) {
    const k = matchKey(r.name);
    if (!byKey.has(k)) byKey.set(k, taxLedgerInfo(JSON.parse(r.data)));
  }
  return name => byKey.get(matchKey(name)) || null;
}

// Ledgers that hold TDS deducted by customers without being TDS-type tax ledgers in Tally: a Chart of Accounts ledger
// (not GST) whose name is the name of Zoho's own "TDS Receivable" account. On an invoice, on the customer's side, it
// goes to the TDS columns (vouchers.js). Returns the names as the masters write them.
export function receivableTdsLedgers(db, jobId) {
  return db.prepare("SELECT name, data FROM source_records WHERE job_id = ? AND object_type = 'Ledger' AND slot = 'accounts' ORDER BY id").all(jobId)
    .filter(r => { if (builtinAccount(r.name) !== 'TDS Receivable') return false; try { return String(taxLedgerInfo(JSON.parse(r.data)).type).toUpperCase() !== 'GST'; } catch { return true; } })
    .map(r => r.name);
}

// Zoho's TDS taxes of the organisation, from its export (null when none was given): [{ name, rate, section }].
export function zohoTdsTaxes(db, jobId) {
  if (!db.prepare('SELECT 1 FROM zoho_tds_taxes_meta WHERE job_id = ?').get(jobId)) return null;
  return db.prepare('SELECT name, rate, section, start_date start, end_date end, status FROM zoho_tds_taxes WHERE job_id = ? ORDER BY seq').all(jobId)
    .map(t => ({ ...t, start: t.start || '', end: t.end || '', status: t.status || '' }));
}
// A date cell of Zoho's export (2026-04-01, 01/04/2026, a date, or an Excel day number) as YYYY-MM-DD, or ''.
function dateCell(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = String(v ?? '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (/^\d{5}$/.test(s)) return new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000).toISOString().slice(0, 10);
  return '';
}
// Reads Zoho's "Export TDS Taxes" file (CSV, XLSX or XLS): the heading row is the first of the first 20 rows with a tax
// name column. Returns { taxes: [{ name, rate, section }] } or { error }.
export function readZohoTdsTaxes(buf) {
  const table = readTable(buf);
  if (table.error) return { error: table.error };
  const NAMES = ['taxname', 'tdsname', 'name', 'tdstaxname'], RATES = ['rate', 'taxrate', 'rate%', 'tdsrate', 'percentage', 'tdspercentage'], SECTIONS = ['section', 'sectioncode', 'tdssection', 'tdssectioncode', 'natureofpayment'];
  const STARTS = ['startdate', 'effectivefrom'], ENDS = ['enddate', 'effectiveto'], STATUSES = ['taxstatus', 'status'];
  const SALES_ACCOUNTS = ['accounttotracksales', 'tdsreceivableaccount', 'receivableaccount'], PURCHASE_ACCOUNTS = ['accounttotrackpurchases', 'tdspayableaccount', 'payableaccount'];
  const headerRow = table.rows.slice(0, 20).findIndex(r => r.some(c => NAMES.includes(headingKey(c))));
  if (headerRow < 0) return { error: 'The file has no "Tax Name" column. Export it from Zoho Books: Settings > Taxes & Compliance > Direct Taxes > Income TDS Rates > More > Export TDS Taxes.' };
  const h = table.rows[headerRow].map(headingKey);
  const at = list => h.findIndex(x => list.includes(x));
  const ni = at(NAMES), ri = at(RATES), si = at(SECTIONS), sti = at(STARTS), eni = at(ENDS), sta = at(STATUSES), sai = at(SALES_ACCOUNTS), pai = at(PURCHASE_ACCOUNTS);
  // TDS-025: a TDS export has a name, a percentage AND a section column (Zoho's: TDS Name, TDS Percentage, TDS Section
  // Code). Another export (for example the GST tax list: Tax Name, Tax Percentage, Tax Type) is refused, so its names never
  // become TDS taxes the check calls known.
  if (ri < 0 || si < 0) return { error: `The file has a tax name column but no ${ri < 0 && si < 0 ? 'percentage and no section' : ri < 0 ? 'percentage' : 'section'} column, so it is not Zoho's TDS export (it needs TDS Name, TDS Percentage and TDS Section Code; the GST tax list is another file). Export it from Zoho Books: Settings > Taxes & Compliance > Direct Taxes > Income TDS Rates > More > Export TDS Taxes.` };
  // one entry per tax: the same name may be a tax of the old act and another of the new act (different rate or section)
  const seen = new Set(), taxes = [];
  for (const r of table.rows.slice(headerRow + 1)) {
    const name = String(r[ni] ?? '').trim();
    if (!name) continue;
    const rate = String(r[ri] ?? '').replace(/%/g, '').trim(), section = String(r[si] ?? '').trim();
    const k = [name.toLowerCase(), rate, section.toLowerCase()].join('|');
    if (seen.has(k)) continue;
    seen.add(k);
    taxes.push({ name, rate, section, start: sti >= 0 ? dateCell(r[sti]) : '', end: eni >= 0 ? dateCell(r[eni]) : '', status: sta >= 0 ? String(r[sta] ?? '').trim() : '',
      // the accounts the tax posts to; '' when the export has no such column (then it is not known, never a mismatch)
      salesAccount: sai >= 0 ? String(r[sai] ?? '').trim() : '', purchaseAccount: pai >= 0 ? String(r[pai] ?? '').trim() : '' });
  }
  if (!taxes.length) return { error: 'The file has a tax name column but no TDS tax in it.' };
  return { taxes };
}
// A suggestion (tdsSuggestion) said with the names of the organisation's export when there is one: the export's tax of
// the same section (its section column, or a section number in its name), else the export's tax of the same name. When
// the export has none, nothing is suggested (a name the organisation does not have is never written).
// (resolveTds in tds.js does the matching with the export: same section, same rate, valid on the date of the document.
// A suggestion therefore stays the one Tally and the table give; a tax the export lacks is listed as one to create.)
function suggestFromExport(s) { return s; }

// The suggested Zoho TDS tax of each TDS ledger (defaults.js tdsSuggestion): a function ledger name -> suggestion | null.
export function tdsSuggestions(db, jobId) {
  const exported = zohoTdsTaxes(db, jobId);
  const byKey = new Map();
  for (const r of db.prepare("SELECT name, data FROM source_records WHERE job_id = ? AND slot = 'taxes' ORDER BY id").all(jobId)) {
    const info = taxLedgerInfo(JSON.parse(r.data));
    if (info.tds && !byKey.has(matchKey(r.name))) byKey.set(matchKey(r.name), suggestFromExport(tdsSuggestion(info, r.name), exported));
  }
  return name => byKey.get(matchKey(name)) || null;
}

// What the voucher files need from the masters for the v2 defaults (defaults.js 14 and 15): the suggested TDS tax of a
// TDS ledger, whether a ledger is a round-off ledger (Tally type Invoice Rounding), and the names of the stock items
// (a service item never takes the name of one).
export function voucherDefaults(db, jobId) {
  const roundOff = new Set();
  for (const r of db.prepare("SELECT name, data FROM source_records WHERE job_id = ? AND object_type = 'Ledger' AND slot = 'accounts'").all(jobId)) {
    try { if (isRoundOffLedger(JSON.parse(r.data))) roundOff.add(matchKey(r.name)); } catch { /* not readable: not a round-off ledger */ }
  }
  const receivable = new Map(receivableTdsLedgers(db, jobId).map(n => [matchKey(n), n]));
  const tdsDefault = tdsSuggestions(db, jobId);
  const exported = zohoTdsTaxes(db, jobId);
  return {
    tdsDefault: name => tdsDefault(name) || (receivable.has(matchKey(name)) ? suggestFromExport(tdsSuggestion({}, name), exported) : null),
    customerTdsDefault: CUSTOMER_TDS_DEFAULT, tdsExport: exported,
    customerTds: name => receivable.get(matchKey(name)) || null,
    isRoundOff: name => roundOff.has(matchKey(name)),
    stockItemNames: db.prepare("SELECT name FROM source_records WHERE job_id = ? AND slot = 'stock_items' AND object_type = 'StockItem'").all(jobId).map(r => r.name),
  };
}

// The TDS ledgers of a migration, for the TDS mapping card. Each ledger: the mapping chosen (explicit), the suggestion
// from its section (written when nothing is chosen), and what the files write.
export function tdsView(db, jobId) {
  const usage = taxUsage(db, jobId);
  const map = tdsMappings(db, jobId);
  const exported = zohoTdsTaxes(db, jobId);
  const customerDefault = CUSTOMER_TDS_DEFAULT;
  const tdsSuggestion = (info, name) => suggestFromExport(suggestOne(info, name), exported);
  // what the files write for a ledger with no amounts yet: the tax, the percentage and the section code the table and
  // the export give (the percentage of a real document comes from its own amount: tds.js)
  const settings = voucherSettings(db, jobId);
  const fy = jobYear(db.prepare('SELECT * FROM migrations WHERE id = ?').get(jobId));
  const written = (m, suggestion, customer) => {
    const r = resolveTds({ date: fy?.from || '', settings, mapping: m?.tdsName ? m : null, suggestion, customer, exported });
    return { tdsName: r.tdsName, section: r.section, percent: r.percent, act: r.act, actWords: ACT_WORDS[r.act], rateFrom: r.rateFrom, rateWords: RATE_WORDS[r.rateFrom] || '', create: r.create && !m?.tdsName, madeUnique: r.madeUnique };
  };
  const ledgers = db.prepare("SELECT name, data FROM source_records WHERE job_id = ? AND slot = 'taxes' ORDER BY id").all(jobId)
    .map(r => ({ name: r.name, info: taxLedgerInfo(JSON.parse(r.data)), parent: JSON.parse(r.data).parent }))
    .filter(x => x.info.tds)
    .map(x => {
      const m = map[x.name];
      const suggestion = tdsSuggestion(x.info, x.name);
      const u = usage[x.name];
      // TDS deducted by customers only (on invoices), with no section: the default TDS tax for customers is written
      const invoicesOnly = (u?.partySide || 0) > 0 && (u?.partySideInvoices || 0) === (u?.partySide || 0);
      const source = m?.tdsName ? 'explicit' : suggestion ? 'auto' : invoicesOnly && customerDefault ? 'customer_default' : 'none';
      return { ledger: x.name, nature: x.info.nature || '', group: typeof x.parent === 'string' ? x.parent : '',
        // vouchers (sales, purchase and journals with a bill or invoice pattern) where the ledger is on the party's side;
        // of those, on invoices (TDS deducted by customers) and on bills (deducted from vendors)
        partySideVouchers: u?.partySide ?? 0, partySideInvoices: u?.partySideInvoices ?? 0, partySideBills: (u?.partySide ?? 0) - (u?.partySideInvoices ?? 0), otherSideVouchers: u?.asTax ?? 0,
        tdsName: m?.tdsName || '', section: m?.section || '', percent: m?.percent || '', decidedBy: m?.by || null, decidedAt: m?.at || null,
        suggestion, source,
        written: source === 'explicit' ? written(m, null, false) : source === 'auto' ? written(null, suggestion, false)
          : source === 'customer_default' ? written(null, null, true) : { tdsName: '', section: '', percent: '' } };
    });
  // ledgers named like Zoho's TDS Receivable: TDS deducted by customers (invoices only); with no choice the default TDS
  // tax for customers is written (defaults.js CUSTOMER_TDS_DEFAULT), never a negative line
  for (const name of receivableTdsLedgers(db, jobId)) {
    if (ledgers.some(l => matchKey(l.ledger) === matchKey(name))) continue;
    const m = map[name];
    const used = (usage[name]?.partySide ?? 0) > 0;
    const source = m?.tdsName ? 'explicit' : used && customerDefault ? 'customer_default' : 'none';
    ledgers.push({ ledger: name, nature: '', group: '', receivable: true, partySideVouchers: usage[name]?.partySide ?? 0, partySideInvoices: usage[name]?.partySideInvoices ?? usage[name]?.partySide ?? 0, partySideBills: 0, otherSideVouchers: usage[name]?.asTax ?? 0,
      tdsName: m?.tdsName || '', section: m?.section || '', percent: m?.percent || '', decidedBy: m?.by || null, decidedAt: m?.at || null,
      suggestion: null, source,
      written: m?.tdsName ? written(m, null, true) : source === 'customer_default' ? written(null, null, true) : { tdsName: '', section: '', percent: '' } });
  }
  // tax ledgers that are on the party's side but are not TDS in Tally: they stay flagged and are never put in the TDS columns
  const tds = new NameSet(ledgers.map(l => l.ledger));
  const otherPartySide = Object.entries(usage).filter(([name, u]) => (u.partySide || 0) > 0 && !tds.has(name)).map(([ledger, u]) => ({ ledger, partySideVouchers: u.partySide }));
  // the pick list: the organisation's own TDS taxes when its export was given, else the names known from Zoho's
  // samples and documentation
  // an Inactive tax of the export is never offered (it exists, so its name is still taken: tds.js knownTdsTaxes)
  const choices = exported ? exported.filter(t => !/inactive/i.test(String(t.status || ''))).map(t => ({ name: t.name, code: null, sections: tdsSectionOf(t.section || t.name) ? [tdsSectionOf(t.section || t.name)] : [], rate: t.rate || '' })) : TDS_CHOICES;
  return { ledgers, unmapped: ledgers.filter(l => l.source === 'none' && l.partySideVouchers > 0).length, otherPartySide, choices, choicesFrom: exported ? 'zoho_export' : 'known_names', customerDefault: customerDefault?.tdsName || null,
    note: 'A ledger is listed here only when Tally says its type of duty/tax is TDS. Where it is on the party\'s side (deducted from the vendor on a bill, or by the customer on an invoice), the document is written with this Zoho TDS tax and Tally\'s TDS amount, so its total in Zoho Books is the amount owed. '
      + "With no choice, the tax suggested from the section in Tally is written, with a percentage (worked out from Tally's TDS amount on each document) and a section code (Zoho refuses a TDS row without them). The TDS posts to the account its Zoho TDS tax is linked to (TDS Payable or TDS Receivable). The TDS taxes must exist in Zoho Books with exactly these names: the Import Wizard lists the ones to create." };
}

export function registerVoucherOptions(app, { db, need, audit, now, tx, markStale }) {
  const actor = req => req.user?.email || 'system';
  const settingsView = jobId => {
    const s = voucherSettings(db, jobId);
    const withReference = db.prepare("SELECT COUNT(*) n FROM source_records WHERE job_id = ? AND slot IN ('purchase','journal') AND TRIM(COALESCE(json_extract(data, '$.reference'), '')) <> ''").get(jobId).n;
    return { ...s, defaults: VOUCHER_SETTING_DEFAULTS, options: { billNumber: BILL_NUMBER_OPTIONS.map(id => ({ id, words: SETTING_WORDS.billNumber[id] })),
      documentStatus: DOCUMENT_STATUS_OPTIONS.map(id => ({ id, words: SETTING_WORDS.documentStatus[id] })),
      outOfYear: OUT_OF_YEAR_OPTIONS.map(id => ({ id, words: SETTING_WORDS.outOfYear[id] })),
      billNoTaxMode: BILL_NO_TAX_MODES.map(id => ({ id, words: SETTING_WORDS.billNoTaxMode[id] })), taxTypes: TAX_TYPES,
      tdsAct: TDS_ACT_OPTIONS.map(id => ({ id, words: SETTING_WORDS.tdsAct[id] })), tdsBase: TDS_BASE_OPTIONS.map(id => ({ id, words: SETTING_WORDS.tdsBase[id] })),
      rcmUnknownState: RCM_UNKNOWN_STATE_OPTIONS.map(id => ({ id, words: SETTING_WORDS.rcmUnknownState[id] })), recomputeDiffPolicy: RECOMPUTE_POLICY_OPTIONS.map(id => ({ id, words: SETTING_WORDS.recomputeDiffPolicy[id] })),
      zohoTaxRounding: ZOHO_TAX_ROUNDING_OPTIONS.map(id => ({ id, words: SETTING_WORDS.zohoTaxRounding[id] })),
      paymentsRoute: PAYMENTS_ROUTE_OPTIONS.map(id => ({ id, words: SETTING_WORDS.paymentsRoute[id] })),
      tcsMode: TCS_MODE_OPTIONS.map(id => ({ id, words: SETTING_WORDS.tcsMode[id] })), tdsPosting: TDS_POSTING_OPTIONS.map(id => ({ id, words: SETTING_WORDS.tdsPosting[id] })),
      hsnEnabled: HSN_ENABLED_OPTIONS.map(id => ({ id, words: SETTING_WORDS.hsnEnabled[id] })), hsnMinDigits: HSN_MIN_DIGITS_OPTIONS.map(id => ({ id, words: SETTING_WORDS.hsnMinDigits[id] })) },
      tdsActCutover: TDS_ACT_CUTOVER,
      vouchersWithSupplierReference: withReference,
      billNoTaxNote: 'Zoho Books asks for a tax, a tax exemption or reverse charge on every bill line of a registered vendor. This says what is written on such a line when it carries no GST in Tally. None of the three has been confirmed by a test import yet. It is never applied to a vendor that is not registered.' };
  };
  app.get('/api/migrations/:id/voucher-settings', (req, reply) => { const job = need(req, reply); if (!job) return; return settingsView(job.id); });
  // { billNumber?: 'voucher' | 'reference', documentStatus?: 'final' | 'draft', outOfYear?: 'exclude' | 'include',
  //   billNoTaxMode?: 'zero_tax' | 'exemption' | 'reverse_charge', billExemptionCode?, billReverseChargeName?, billReverseChargeRate?, billReverseChargeType? }
  app.put('/api/migrations/:id/voucher-settings', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const KEYS = ['billNumber', 'documentStatus', 'outOfYear', ...EXTRA_KEYS];
    const before = voucherSettings(db, job.id), next = Object.fromEntries(KEYS.map(k => [k, before[k]]));
    const body = req.body || {};
    const choice = (key, options, error) => { if (!(key in body)) return null; if (!options.includes(body[key])) return error; next[key] = body[key]; return null; };
    const bad = choice('billNumber', BILL_NUMBER_OPTIONS, 'Choose the Tally voucher number or the supplier\'s invoice number.')
      || choice('documentStatus', DOCUMENT_STATUS_OPTIONS, 'Choose posted documents or drafts.')
      || choice('outOfYear', OUT_OF_YEAR_OPTIONS, 'Choose whether vouchers dated outside the financial year are left out or included.')
      || choice('billNoTaxMode', BILL_NO_TAX_MODES, 'Choose what is written on a bill line without GST: the zero-rate tax, an exemption, or reverse charge.')
      || choice('tdsAct', TDS_ACT_OPTIONS, 'Choose the tax act of the TDS section codes: by date, the 1961 act or the 2025 act.')
      || choice('tdsBase', TDS_BASE_OPTIONS, 'Choose whether the TDS percentage is checked on the sub total or on the total including tax.')
      || choice('rcmUnknownState', RCM_UNKNOWN_STATE_OPTIONS, 'Choose what a reverse charge bill of a vendor with no state is written as: GST or an import of services (IGST).')
      || choice('recomputeDiffPolicy', RECOMPUTE_POLICY_OPTIONS, 'Choose whether a rounding difference is written in the Adjustment column or only flagged.')
      || choice('zohoTaxRounding', ZOHO_TAX_ROUNDING_OPTIONS, 'Choose how Zoho Books rounds the tax: each line, or the whole document.')
      || choice('hsnEnabled', HSN_ENABLED_OPTIONS, 'Say whether the HSN Code or SAC field is switched on in Zoho Books: on or off.')
      || choice('hsnMinDigits', HSN_MIN_DIGITS_OPTIONS, 'Choose 6 digits or 4 digits for the HSN/SAC code.')
      || choice('tdsPosting', TDS_POSTING_OPTIONS, 'Choose how the Tally TDS ledgers are kept in Zoho Books: merged on TDS Payable and TDS Receivable, or each as an account of its own.')
      || choice('tcsMode', TCS_MODE_OPTIONS, 'Choose where tax collected at source is written: the Adjustment column or the TCS columns.')
      || choice('paymentsRoute', PAYMENTS_ROUTE_OPTIONS, "Choose where customer and vendor payments go: Manual Journals now, or Zoho's Payments files built from its import sample.");
    // One route per voucher, never both. Once the journals file of receipts and payments was downloaded or imported,
    // moving these vouchers to another file would post the same money twice unless the journals are deleted in Zoho
    // Books first: the change is made only when the person says so (journalsDeletedInZoho: true).
    if (!bad && next.paymentsRoute !== before.paymentsRoute) {
      const st = db.prepare("SELECT status FROM import_status WHERE job_id = ? AND key = 'other_journals'").get(job.id)?.status;
      if (st && body.journalsDeletedInZoho !== true) {
        return reply.code(409).send({ routeLocked: true, error: `The journals file of receipts and payments was already ${st === 'downloaded' ? 'downloaded' : 'imported'}. Changing this moves customer and vendor payments ${next.paymentsRoute === 'module_files' ? 'out of that file into the Payments files' : 'into that file'}. If the file is already in Zoho Books, the same money would be posted twice. First delete the journals of that file in Zoho Books (or make sure it was never imported), then confirm the change.` });
      }
    }
    if (!bad && 'openingDate' in body) {
      const v = String(body.openingDate ?? '').trim();
      if (v && !validDate(v)) return reply.code(400).send({ error: `"${v}" is not a date. Type it as year-month-day, for example 2025-03-31, or leave it empty for the day before the financial year starts.` });
      // The opening balances are those of the start of the financial year, and the vouchers of the whole year are written:
      // a Migration Date later than the day before the year starts would put the opening balances after vouchers that
      // already moved them. (An earlier date is allowed: nothing is written between it and the year start.)
      const year = jobYear(job);
      if (v && year) {
        const d = new Date(`${year.from}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1);
        const latest = d.toISOString().slice(0, 10);
        if (v > latest) return reply.code(400).send({ error: `The Migration Date ${v} is after ${latest}, the day before the financial year starts (${year.from} to ${year.to}). The opening balances are those of ${year.from} and every voucher of the year is written, so the Migration Date must be ${latest} or earlier. Leave it empty to use ${latest}.` });
      }
      next.openingDate = v;
    }
    if (bad) return reply.code(400).send({ error: bad });
    for (const k of ['billExemptionCode', 'billReverseChargeName', 'billReverseChargeRate', 'billReverseChargeType', 'invoiceAdjustmentAccount', 'billAdjustmentAccount']) {
      if (!(k in body)) continue;
      const v = String(body[k] ?? '').trim();
      if (v.length > MAX_NAME || HIDDEN.test(v)) return reply.code(400).send({ error: `The value is too long or has hidden characters. Use ${MAX_NAME} characters or fewer.` });
      next[k] = v;
    }
    if (next.billReverseChargeRate && (!/^\d+(\.\d{1,2})?$/.test(next.billReverseChargeRate) || Number(next.billReverseChargeRate) > 100)) return reply.code(400).send({ error: `"${next.billReverseChargeRate}" is not a tax rate. Type a number from 0 to 100, for example 18.` });
    if (next.billReverseChargeType && !TAX_TYPES.includes(next.billReverseChargeType)) return reply.code(400).send({ error: `The reverse charge tax type is "${TAX_TYPES.join('" or "')}".` });
    if (next.billNoTaxMode === 'exemption' && !next.billExemptionCode) return reply.code(400).send({ error: 'Type the name of the tax exemption as it is in Zoho Books (Settings > Taxes > Tax Exemptions). Zoho refuses a name it does not have.' });
    if (next.billNoTaxMode === 'reverse_charge' && !(next.billReverseChargeName && next.billReverseChargeRate && next.billReverseChargeType)) return reply.code(400).send({ error: 'Reverse charge needs the tax name as it is in Zoho Books, its rate and its type.' });
    const changed = KEYS.filter(k => before[k] !== next[k]);
    if (!changed.length) return { ...settingsView(job.id), changed: false };
    const label = { billNumber: 'Bill Number', documentStatus: 'documents', outOfYear: 'vouchers outside the financial year', billNoTaxMode: 'bill lines without GST', billExemptionCode: 'exemption name',
      billReverseChargeName: 'reverse charge tax', billReverseChargeRate: 'reverse charge rate', billReverseChargeType: 'reverse charge tax type',
      tdsAct: 'tax act of the TDS section codes', tdsBase: 'TDS base', rcmUnknownState: 'reverse charge, vendor with no state', recomputeDiffPolicy: 'rounding differences', zohoTaxRounding: 'tax rounding in Zoho Books', invoiceAdjustmentAccount: "Zoho's account for the Adjustment of invoices", billAdjustmentAccount: "Zoho's account for the Adjustment of bills",
      paymentsRoute: 'customer and vendor payments, debit and credit notes', hsnEnabled: 'HSN/SAC field switched on in Zoho Books', hsnMinDigits: 'shortest HSN/SAC code', openingDate: 'Migration Date (opening balance date)', tcsMode: 'tax collected at source (TCS)', tdsPosting: 'Tally TDS ledgers in Zoho Books' };
    const say = (k, v) => (SETTING_WORDS[k] ? SETTING_WORDS[k][v] : v ? `"${v}"` : 'none');
    const words = k => `${label[k]}: ${say(k, before[k])} -> ${say(k, next[k])}`;
    tx(() => {
      db.prepare('INSERT OR REPLACE INTO voucher_settings (job_id, bill_number, document_status, out_of_year, extra, decided_by, at) VALUES (?,?,?,?,?,?,?)')
        .run(job.id, next.billNumber, next.documentStatus, next.outOfYear, JSON.stringify(Object.fromEntries(EXTRA_KEYS.map(k => [k, next[k]]))), actor(req), now());
      audit(job.id, 'voucher_settings_changed', changed.map(words).join('; '));
      const all = ['invoices', 'bills', 'journals', 'other_journals'];
      // the Bill Number alone changes the Bills file only; what is written on a bill line without GST can move a journal
      // routed by default between the Bills and the Manual Journals files (index.js withDependentFiles)
      markStale(job.id, `The voucher file settings were changed (${changed.map(words).join('; ')}).`, changed.includes('documentStatus') || changed.includes('outOfYear') ? all : changed.includes('tdsPosting') ? ['accounts', 'opening_balances_for_zoho_accounts', ...all] : changed.includes('paymentsRoute') ? ['other_journals'] : changed.some(k => ['hsnEnabled', 'hsnMinDigits'].includes(k)) ? ['items', 'invoices', 'bills'] : changed.includes('openingDate') ? ['opening_balances_for_zoho_accounts'] : changed.some(k => ['tdsAct', 'tdsBase', 'recomputeDiffPolicy', 'zohoTaxRounding', 'tcsMode'].includes(k)) ? ['invoices', 'bills', 'journals'] : changed.some(k => ['invoiceAdjustmentAccount', 'billAdjustmentAccount'].includes(k)) ? ['journals'] : ['bills'],
        changed.every(k => k === 'billNumber' || k === 'documentStatus') ? 'exact:setting:numbers_status' : null);
    });
    return { ...settingsView(job.id), changed: true };
  });

  app.get('/api/migrations/:id/tds-mappings', (req, reply) => { const job = need(req, reply); if (!job) return; return tdsView(db, job.id); });

  // Zoho's own TDS taxes (Import Wizard, set-up "TDS taxes": Export TDS Taxes and give the file to the tool). The names
  // are then the TDS pick list and the names written by default (audit item 11). PUT: the file as the body
  // (x-filename header); GET: what was given; DELETE: back to the names known from Zoho's samples.
  app.get('/api/migrations/:id/zoho-tds-taxes', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const meta = db.prepare('SELECT * FROM zoho_tds_taxes_meta WHERE job_id = ?').get(job.id);
    return { source: meta ? 'uploaded' : 'known_names', taxes: zohoTdsTaxes(db, job.id) || TDS_CHOICES.map(c => ({ name: c.name, rate: '', section: c.sections[0] || '' })),
      fileName: meta?.file_name || null, uploadedAt: meta?.at || null, uploadedBy: meta?.uploaded_by || null };
  });
  app.put('/api/migrations/:id/zoho-tds-taxes', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    if (!Buffer.isBuffer(req.body) || !req.body.length) return reply.code(400).send({ error: 'No file received.' });
    const read = readZohoTdsTaxes(req.body);
    if (read.error) return reply.code(422).send({ error: read.error });
    const fileName = (() => { try { return decodeURIComponent(String(req.headers['x-filename'] || '')); } catch { return String(req.headers['x-filename'] || ''); } })();
    tx(() => {
      db.prepare('DELETE FROM zoho_tds_taxes WHERE job_id = ?').run(job.id);
      const ins = db.prepare('INSERT INTO zoho_tds_taxes (job_id, seq, name, rate, section, start_date, end_date, status, sales_account, purchase_account) VALUES (?,?,?,?,?,?,?,?,?,?)');
      read.taxes.forEach((t, i) => ins.run(job.id, i + 1, t.name, t.rate, t.section, t.start || null, t.end || null, t.status || null, t.salesAccount || null, t.purchaseAccount || null));
      db.prepare('INSERT OR REPLACE INTO zoho_tds_taxes_meta VALUES (?,?,?,?,?)').run(job.id, fileName || null, read.taxes.length, actor(req), now());
      audit(job.id, 'zoho_tds_taxes_uploaded', `${read.taxes.length} TDS tax names read from Zoho's TDS export${fileName ? ` "${fileName}"` : ''}`);
      markStale(job.id, `Zoho's TDS export was given (${read.taxes.length} TDS taxes): the TDS names written by default follow it.`, ['bills', 'invoices']);
    });
    return { ok: true, taxes: read.taxes.length, tds: tdsView(db, job.id) };
  });
  app.delete('/api/migrations/:id/zoho-tds-taxes', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const had = db.prepare('SELECT 1 FROM zoho_tds_taxes_meta WHERE job_id = ?').get(job.id);
    if (!had) return reply.code(404).send({ error: 'No TDS export was given.' });
    tx(() => {
      db.prepare('DELETE FROM zoho_tds_taxes WHERE job_id = ?').run(job.id);
      db.prepare('DELETE FROM zoho_tds_taxes_meta WHERE job_id = ?').run(job.id);
      audit(job.id, 'zoho_tds_taxes_removed', "Zoho's TDS export removed: the names known from Zoho's samples are used again");
      markStale(job.id, "Zoho's TDS export was removed: the TDS names known from Zoho's samples are used again.", ['bills', 'invoices']);
    });
    return { ok: true, tds: tdsView(db, job.id) };
  });
  // { ledger, tdsName ('' removes the mapping), section?, percent? }
  app.put('/api/migrations/:id/tds-mappings', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const ledger = String(req.body?.ledger ?? '');
    const view = tdsView(db, job.id);
    if (!view.ledgers.some(l => l.ledger === ledger)) return reply.code(404).send({ error: 'That ledger is not a TDS ledger in the uploaded masters (Tally\'s type of duty/tax must be TDS).' });
    const tdsName = String(req.body?.tdsName ?? '').trim(), typedSection = String(req.body?.section ?? '').trim(), percent = String(req.body?.percent ?? '').trim();
    if (tdsName.length > MAX_NAME || HIDDEN.test(tdsName)) return reply.code(400).send({ error: `The Zoho TDS name is too long or has hidden characters. Use ${MAX_NAME} characters or fewer.` });
    if (typedSection.length > MAX_SECTION || HIDDEN.test(typedSection)) return reply.code(400).send({ error: `The section is too long or has hidden characters. Use ${MAX_SECTION} characters or fewer, for example 194J.` });
    // TDS-018: a section is stored in one form (194-J and 194 J are 194J; a code of Zoho's list as given); a text that is
    // neither an old section nor a code of Zoho's list is refused. The files write the form of each document's act (tds.js).
    const section = storedTdsSection(typedSection);
    if (section === null) return reply.code(400).send({ error: `"${typedSection}" is not a TDS section: type a section of the Income Tax Act, 1961 (for example 194J or 194-C) or a code of Zoho's list (for example professional_fees).` });
    if (percent && (!/^\d+(\.\d{1,4})?$/.test(percent) || Number(percent) > 100)) return reply.code(400).send({ error: `"${percent}" is not a percentage. Type a number from 0 to 100, for example 10 or 7.5.` });
    if (!tdsName && (section || percent)) return reply.code(400).send({ error: 'Type the name of the TDS tax in Zoho Books. The section and percentage alone are not enough.' });
    const cur = view.ledgers.find(l => l.ledger === ledger);
    const show = m => (m.tdsName ? `"${m.tdsName}"${m.section ? `, section ${m.section}` : ''}${m.percent ? `, ${m.percent}%` : ''}` : 'not mapped');
    const was = show(cur), is = show({ tdsName, section, percent });
    if (was === is) return { ...tdsView(db, job.id), changed: false };
    tx(() => {
      if (!tdsName) db.prepare('DELETE FROM tds_mappings WHERE job_id = ? AND ledger = ?').run(job.id, ledger);
      else db.prepare('INSERT OR REPLACE INTO tds_mappings (job_id, ledger, tds_name, section, percent, decided_by, at) VALUES (?,?,?,?,?,?,?)').run(job.id, ledger, tdsName, section || null, percent || null, actor(req), now());
      audit(job.id, 'tds_mapped', `TDS ledger "${ledger}": ${was} -> ${is}`);
      markStale(job.id, `The TDS mapping of Tally ledger "${ledger}" was changed (${was} -> ${is}).`, ['bills', 'invoices']);
    });
    return { ...tdsView(db, job.id), changed: true };
  });
}
