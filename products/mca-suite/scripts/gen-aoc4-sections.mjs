// Generates dashboard/src/data/aoc4Sections.js from the extension's AOC-4 field map, so the
// dashboard's "AOC-4 full form" workspace shows exactly the fields (and phases) the extension fills.
//
//   node scripts/gen-aoc4-sections.mjs
//
// Output:
//   AOC4_PHASES       [{phase, title, fields:[{key, label, kind, options?, required?, requiredIf?, hint?}]}]
//   AOC4_PAGE2        Page 2 declaration + certificate fields (with limits)
//   AOC4_PAYLOAD_PATHS {flatKey: 'section.key' | 'balanceSheet.current.KEY' | 'signatoriesFS.0.din' …}
//   AOC4_UNMAPPED     flat keys with no payload path (edits are saved as company answers, formType 'aoc4')
//   AOC4_SECTION_PRECEDENCE  scalar sections, highest precedence first (flattenClient: later Object.assign wins)
//   AOC2_NATURES, AOC2_DESIGNATIONS
//   flattenClient     copied verbatim from extension/js/field-mapper.js (source of truth for reading values)

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { FIELD_MAPPINGS, PHASES, flattenClient } = require(path.join(ROOT, 'extension/js/field-mapper.js'));
const AOC2 = require(path.join(ROOT, 'extension/js/linked/aoc2.js'));
const OUT = path.join(ROOT, 'dashboard/src/data/aoc4Sections.js');

// ───────────────────────── labels & kinds ─────────────────────────

const BS_LABELS = {
  asOf: 'Balance sheet date',
  SHARE_CAPITAL: 'Share capital', RESERVES_SURPLUS: 'Reserves and surplus',
  MONEY_AGAINST_WARRANTS: 'Money received against share warrants', SHARE_APP_PENDING: 'Share application money pending allotment',
  LONG_TERM_BORROWINGS: 'Long-term borrowings', DEFERRED_TAX_LIAB: 'Deferred tax liabilities (net)',
  OTHER_LONG_TERM_LIAB: 'Other long-term liabilities', LONG_TERM_PROVISIONS: 'Long-term provisions',
  SHORT_TERM_BORROWINGS: 'Short-term borrowings', TRADE_PAYABLES_MSME: 'Trade payables — micro and small enterprises',
  TRADE_PAYABLES_OTHER: 'Trade payables — others', OTHER_CURRENT_LIAB: 'Other current liabilities',
  SHORT_TERM_PROVISIONS: 'Short-term provisions',
  PPE: 'Property, plant and equipment', INTANGIBLE_ASSETS: 'Intangible assets', CWIP: 'Capital work-in-progress',
  INTANGIBLE_UNDER_DEV: 'Intangible assets under development', NON_CURRENT_INVESTMENTS: 'Non-current investments',
  DEFERRED_TAX_ASSETS: 'Deferred tax assets (net)', LONG_TERM_LOANS_ADVANCES: 'Long-term loans and advances',
  OTHER_NON_CURRENT_ASSETS: 'Other non-current assets', CURRENT_INVESTMENTS: 'Current investments',
  INVENTORIES: 'Inventories', TRADE_RECEIVABLES: 'Trade receivables', CASH_EQUIVALENTS: 'Cash and cash equivalents',
  SHORT_TERM_LOANS_ADVANCES: 'Short-term loans and advances', OTHER_CURRENT_ASSETS: 'Other current assets',
};

// Main Statement of Profit and Loss lines (profitLoss.current/previous).
const PL_MAIN = new Set(['REVENUE_OPERATIONS', 'OTHER_INCOME', 'EMPLOYEE_EXPENSES', 'FINANCE_COSTS', 'DEPRECIATION',
  'OTHER_EXPENSES', 'CURRENT_TAX', 'MANAGERIAL_REMUNERATION', 'DEFERRED_TAX', 'EPS_BASIC', 'EPS_DILUTED']);

const YES_NO = ['Yes', 'No'];
const OPTIONS = {
  NATURE_FS: [
    { value: 'adopted', label: 'Adopted financial statements' },
    { value: 'provisional', label: 'Provisional (un-adopted) financial statements' },
    { value: 'revised130', label: 'Revised under section 130' },
    { value: 'revised131', label: 'Revised under section 131' },
  ],
  AUDITOR_CATEGORY: ["Auditor's firm", 'Individual'],
  CAG_COMMENTED: ['Yes', 'No', 'Not applicable'],
  TYPE_OF_INDUSTRY: ['Commercial & Industrial', 'Banking', 'Insurance', 'Power', 'NBFC', 'Housing Finance'],
  CSR_APPLICABILITY: ['Applicable', 'Not applicable'],
};

// Plain-English labels where the extension's label is a terse log label.
const LABEL_OVERRIDE = {
  CIN: '1(a) Corporate identity number (CIN)',
  asOf_CUR: 'Balance sheet date (current year)', asOf_PREV: 'Balance sheet date (previous year)',
  FY_FROM: '3 Financial year — from', FY_TO: '3 Financial year — to',
  BOARD_MEETING_DATE: '4(a) Date of board meeting that approved the financial statements',
  NATURE_FS: '4(b)(i) Nature of financial statements',
  PROVISIONAL_FILED_EARLIER: '4(b)(iii) Provisional financial statements filed earlier?',
  ADOPTED_IN_ADJOURNED_AGM: '4(b)(iv) Adopted in an adjourned AGM?',
  BOARD_REPORT_DATE: "5(a) Date of board meeting that approved the Board's report",
  AUDITOR_SIGN_DATE: "6 Date the auditor signed the reports",
  AGM_HELD: '7(a) Was the AGM held?', AGM_DATE: '7(b) Date of AGM', AGM_DUE_DATE: '7(c) Due date of AGM',
  AGM_EXTENSION: '7(d) Was an extension for the AGM granted?', GNL1_SRN: '7(e) SRN of GNL-1',
  AGM_EXT_DUE_DATE: '7(f) Due date of AGM after the extension',
  IS_SUBSIDIARY: '8(a) Is the company a subsidiary?', HOLDING_CIN: '8(b) CIN of the holding company',
  HOLDING_NAME: '8(c) Name of the holding company', PROVISION_SECTION: '8(d) Section under which it is a subsidiary',
  HAS_SUBSIDIARY_OR_JV: '8(e) Does the company have subsidiaries / joint ventures?',
  ADT_SRN: '9 SRN of Form ADT-1', NUM_AUDITORS: '9 Number of auditors',
  TYPE_OF_INDUSTRY: '10(a) Type of industry', SCHEDULE_III: '10(b) Is Schedule III applicable?',
  CONSOLIDATED_FS: '11 Are consolidated financial statements required?',
  MAINTAIN_ELECTRONIC_BOOKS: '12(a) Books of account kept in electronic form?',
  TOTAL_CATEGORIES: 'IV Total number of product / service categories',
  CATEGORY_CODE: 'IV Product / service category code (NPCS, 4 digits)',
  CATEGORY_DESC: 'IV Description of the product / service category',
  CATEGORY_TURNOVER: 'IV Turnover of the product / service category',
  HIGHEST_CODE: 'IV Highest turnover product / service code (NPCS, 8 digits)',
  HIGHEST_DESC: 'IV Description of the highest turnover product / service',
  HIGHEST_TURNOVER: 'IV Turnover of the highest contributing product / service',
  ANY_TRANSACTION: 'Segment III: Any related party transactions?',
  CAG_COMMENTED: 'Segment IV: Has the CAG commented on / supplemented the audit report?',
  CSR_APPLICABILITY: 'Segment V: CSR applicability',
  SECRETARIAL_AUDIT_APPLICABLE: 'Segment VI: Is secretarial audit applicable?',
  MAINTENANCE_MANDATED: 'VI(1) Are cost records mandated?', AUDIT_MANDATED: 'VI(2) Is cost audit mandated?',
};

const REQUIRED = new Set([
  'CIN', 'FY_FROM', 'FY_TO', 'BOARD_MEETING_DATE', 'NATURE_FS', 'FS_SIG_1_DIN', 'FS_SIG_1_DATE',
  'BOARD_REPORT_DATE', 'BR_SIG_1_DIN', 'BR_SIG_1_DATE', 'AUDITOR_SIGN_DATE', 'AGM_HELD',
  'IS_SUBSIDIARY', 'HAS_SUBSIDIARY_OR_JV', 'ADT_SRN', 'TYPE_OF_INDUSTRY', 'SCHEDULE_III', 'CONSOLIDATED_FS',
  'MAINTAIN_ELECTRONIC_BOOKS',
  'asOf_CUR', 'SHARE_CAPITAL_CUR', 'RESERVES_SURPLUS_CUR',
  'NET_WORTH', 'MAINTENANCE_MANDATED',
  'REVENUE_OPERATIONS_CUR',
  'TOTAL_CATEGORIES', 'CATEGORY_CODE', 'CATEGORY_DESC', 'HIGHEST_CODE', 'HIGHEST_DESC',
  'ANY_TRANSACTION', 'CSR_APPLICABILITY', 'SECRETARIAL_AUDIT_APPLICABLE',
]);

// Required only when another answer says so.
const REQUIRED_IF = {
  PROVISIONAL_FILED_EARLIER: { key: 'NATURE_FS', equals: 'adopted' },
  ADOPTED_IN_ADJOURNED_AGM: { key: 'NATURE_FS', equals: 'adopted' },
  AGM_DATE: { key: 'AGM_HELD', equals: 'Yes' },
  AGM_DUE_DATE: { key: 'AGM_HELD', equals: 'No' },
  GNL1_SRN: { key: 'AGM_EXTENSION', equals: 'Yes' },
  AGM_EXT_DUE_DATE: { key: 'AGM_EXTENSION', equals: 'Yes' },
  HOLDING_CIN: { key: 'IS_SUBSIDIARY', equals: 'Yes' },
  HOLDING_NAME: { key: 'IS_SUBSIDIARY', equals: 'Yes' },
  SERVER_ADDR1: { key: 'MAINTAIN_ELECTRONIC_BOOKS', equals: 'Yes' },
  SERVER_PIN: { key: 'MAINTAIN_ELECTRONIC_BOOKS', equals: 'Yes' },
  MAINTAINED_ON_CLOUD: { key: 'MAINTAIN_ELECTRONIC_BOOKS', equals: 'Yes' },
  SERVICE_PROVIDER_NAME: { key: 'MAINTAINED_ON_CLOUD', equals: 'Yes' },
  AUDIT_MANDATED: { key: 'MAINTENANCE_MANDATED', equals: 'Yes' },
  OPERATING_LEASE_DETAILS: { key: 'OPERATING_LEASE_CONVERTED', equals: 'Yes' },
};

const HINTS = {
  CATEGORY_CODE: 'Pick it with the NPCS search below',
  HIGHEST_CODE: 'Pick it with the NPCS search below',
  ADT_SRN: 'MCA fetches the auditor details from this SRN',
  CIN: 'MCA fetches the company name and address from the CIN',
};

const humanize = k => k.toLowerCase().replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

function labelFor(f) {
  if (LABEL_OVERRIDE[f.key]) return LABEL_OVERRIDE[f.key];
  const m = /^(.*)_(CUR|PREV)$/.exec(f.key);
  if (!f.label && m) {
    const base = BS_LABELS[m[1]] || humanize(m[1]);
    return `${base} (${m[2] === 'CUR' ? 'current year' : 'previous year'})`;
  }
  if (f.label) {
    return f.label
      .replace(/ \(Current\)$/, ' (current year)').replace(/ \(Previous\)$/, ' (previous year)')
      .replace(/\(Current reporting period\)/, '(current year)').replace(/\(Previous reporting period\)/, '(previous year)')
      .replace(/^P&L /, '');
  }
  return humanize(f.key);
}

// Sub-heading inside a phase, so repeated row labels ("From banks", "Basic") read correctly.
const GROUP_RENAME = {
  'Break-up of figures in Balance sheet': 'Break-up of figures in the balance sheet',
  'INFORMATION AND PARTICULARS IN RESPECT OF PROFIT AND LOSS ACCOUNT': 'Details of the profit and loss account',
  'A Details of earning in foreign exchange': 'Earnings in foreign exchange',
  'Details of expenditure in foreign exchange': 'Expenditure in foreign exchange',
  "AUDITOR'S REPORT": "Auditor's report",
  'DISCLOSURE ABOUT RELATED PARTY TRANSACTIONS': 'Related party transactions',
  'REPORTING OF CORPORATE SOCIAL RESPONSIBILITY': 'Corporate social responsibility',
  'SEGMENT-VI MISCELLANEOUS': 'Miscellaneous',
  'Statement of Profit and Loss': 'Statement of profit and loss',
  'Financial parameters - Balance sheet items': 'Financial parameters — balance sheet items',
  'Financial parameters - Profit and loss account items': 'Financial parameters — profit and loss items',
  'Details related to cost records and cost audit': 'Cost records and cost audit',
};
function groupFor(f) {
  if (/^bs_(?!tr_)/.test(f.id) && !f.sectionHeading) return 'Balance sheet — equity and liabilities';
  if (/^as_/.test(f.id)) return 'Balance sheet — assets';
  if (/^(FS|BR)_SIG_/.test(f.key)) return f.key.startsWith('FS') ? 'Signatories of the financial statements' : "Signatories of the Board's report";
  if (f.key !== 'AUDITOR_SIGN_DATE' && /^AUDITOR_|^MEMBER_|^ADT_SRN$|^NUM_AUDITORS$/.test(f.key)) return 'Auditor (MCA fills these from the ADT-1 SRN)';
  if (/^SERVER_/.test(f.key)) return 'Where the accounting server is kept';
  if (/^SERVICE_PROVIDER_|^MAINTAINED_ON_CLOUD$/.test(f.key)) return 'Service provider (if any)';
  if (/^(CATEGORY|HIGHEST)_|^TOTAL_CATEGORIES$/.test(f.key)) return 'Principal products / services';
  if (f.sectionHeading) return GROUP_RENAME[f.sectionHeading] || f.sectionHeading;
  if (f.phase === 6) return 'Statement of profit and loss';
  return undefined;
}

function kindFor(f) {
  if (OPTIONS[f.key]) return 'select';
  if (f.kind === 'radio') return 'radio';
  if (f.kind === 'date') return 'date';
  if (f.kind === 'number') return 'number';
  if (f.kind === 'pinCode') return 'pin';
  return 'text'; // text, and selects whose options only MCA knows (country, area, designation …)
}

function optionsFor(f, kind) {
  if (OPTIONS[f.key]) return OPTIONS[f.key];
  if (kind === 'radio') return YES_NO;
  return undefined;
}

// ───────────────────────── payload paths ─────────────────────────

// Where the scanner puts each scalar key (mirrors backend/scanner-schemas.js TEXT_SECTIONS).
const SECTION_OF = {
  general: ['CIN', 'COMPANY_NAME', 'FY_FROM', 'FY_TO', 'BOARD_MEETING_DATE', 'NATURE_FS', 'PROVISIONAL_FILED_EARLIER',
    'ADOPTED_IN_ADJOURNED_AGM', 'BOARD_REPORT_DATE', 'AUDITOR_SIGN_DATE', 'AGM_HELD', 'AGM_DATE', 'AGM_DUE_DATE',
    'AGM_EXTENSION', 'GNL1_SRN', 'AGM_EXT_DUE_DATE'],
  auditor: ['ADT_SRN', 'NUM_AUDITORS', 'AUDITOR_PAN', 'AUDITOR_CATEGORY', 'AUDITOR_FIRM_REG', 'AUDITOR_NAME', 'UDIN',
    'AUDITOR_ADDR1', 'AUDITOR_ADDR2', 'AUDITOR_AREA', 'AUDITOR_CITY', 'AUDITOR_DISTRICT', 'AUDITOR_STATE', 'AUDITOR_PIN',
    'AUDITOR_COUNTRY', 'MEMBER_NAME', 'MEMBER_NUMBER'],
  industry: ['TYPE_OF_INDUSTRY', 'SCHEDULE_III', 'CONSOLIDATED_FS', 'MAINTAIN_ELECTRONIC_BOOKS', 'SERVER_ADDR1',
    'SERVER_ADDR2', 'SERVER_AREA', 'SERVER_CITY', 'SERVER_DISTRICT', 'SERVER_STATE', 'SERVER_PIN', 'SERVER_COUNTRY',
    'MAINTAINED_ON_CLOUD', 'SERVICE_PROVIDER_NAME', 'SERVICE_PROVIDER_IP', 'SERVICE_PROVIDER_LOCATION',
    'SERVICE_PROVIDER_ADDRESS'],
  subsidiary: ['IS_SUBSIDIARY', 'HAS_SUBSIDIARY_OR_JV', 'HOLDING_CIN', 'HOLDING_NAME', 'PROVISION_SECTION'],
  financialParametersBS: ['NET_WORTH', 'GROSS_PPE_INTANGIBLE', 'DEPRECIATION_AMORTIZATION_BS',
    'OPERATING_LEASE_CONVERTED', 'OPERATING_LEASE_DETAILS'],
  principalProducts: ['TOTAL_CATEGORIES', 'CATEGORY_CODE', 'CATEGORY_DESC', 'CATEGORY_TURNOVER', 'HIGHEST_CODE',
    'HIGHEST_DESC', 'HIGHEST_TURNOVER', 'BUSINESS_ACTIVITY'],
  relatedParty: ['ANY_TRANSACTION'],
  auditorReport: ['QUALIFIED_OPINION', 'CAG_COMMENTED'],
  csr: ['CSR_APPLICABILITY'],
  secretarialAudit: ['SECRETARIAL_AUDIT_APPLICABLE'],
  costRecords: ['MAINTENANCE_MANDATED', 'AUDIT_MANDATED'],
};
const SECTION_BY_KEY = {};
for (const [s, keys] of Object.entries(SECTION_OF)) for (const k of keys) SECTION_BY_KEY[k] = s;

// flattenClient's Object.assign order, reversed: the first section listed here wins a clash.
const SECTION_PRECEDENCE = ['general', 'auditor', 'subsidiary', 'industry', 'disclosures', 'relatedParty',
  'auditorReport', 'csr', 'secretarialAudit', 'shareCapitalRaised', 'shareCapital', 'financialParametersPL',
  'financialParametersBS', 'costRecords', 'principalProducts'];

const BS_BASES = new Set(FIELD_MAPPINGS.filter(f => /^(bs|as)_/.test(f.id) && !/^(bs_tr_|bslt_|bsst_|bslg_|bsld_)/.test(f.id) && f.key)
  .map(f => f.key.replace(/_(CUR|PREV)$/, '')));

function candidatePath(key) {
  let m = /^(FS|BR)_SIG_(\d+)_(DIN|NAME|DESIG|DATE)$/.exec(key);
  if (m) {
    const prop = { DIN: 'din', NAME: 'name', DESIG: 'designation', DATE: 'date' }[m[3]];
    return `signatories${m[1]}.${Number(m[2]) - 1}.${prop}`;
  }
  m = /^(.*)_(CUR|PREV)$/.exec(key);
  if (m) {
    const [, base, p] = m;
    const period = p === 'CUR' ? 'current' : 'previous';
    if (BS_BASES.has(base)) return `balanceSheet.${period}.${base}`;
    if (PL_MAIN.has(base)) return `profitLoss.${period}.${base}`;
    if (base.startsWith('BS_')) return `balanceSheetBreakup.${base}.${period}`;
    if (base.startsWith('FX_')) return `foreignExchange.${base}.${period}`;
    if (base.startsWith('PL_')) return `profitLossDetails.${base}.${period}`;
    return null;
  }
  if (SECTION_BY_KEY[key]) return `${SECTION_BY_KEY[key]}.${key}`;
  if (key.startsWith('FP_BS_')) return `financialParametersBS.${key}`;
  if (key.startsWith('FP_PL_')) return `financialParametersPL.${key}`;
  if (key.startsWith('SC_')) return `shareCapitalRaised.${key}`;
  return null;
}

function setPath(obj, p, v) {
  const parts = p.split('.');
  let o = obj;
  parts.forEach((seg, i) => {
    const last = i === parts.length - 1;
    const nextIsIndex = !last && /^\d+$/.test(parts[i + 1]);
    if (last) { o[seg] = v; return; }
    if (o[seg] == null) o[seg] = nextIsIndex ? [] : {};
    o = o[seg];
  });
  return obj;
}

// A path counts only if flattenClient reads the value back under the same flat key.
function verified(key, p) {
  if (!p) return false;
  const probe = {};
  const sentinel = `__probe_${key}__`;
  setPath(probe, p, sentinel);
  // Fill earlier signatories so array indexes are dense (flattenClient iterates with forEach).
  for (const list of ['signatoriesFS', 'signatoriesBR']) {
    if (Array.isArray(probe[list])) for (let i = 0; i < probe[list].length; i++) probe[list][i] = probe[list][i] || {};
  }
  try { return flattenClient(probe)[key] === sentinel; } catch { return false; }
}

// ───────────────────────── build ─────────────────────────

const seen = new Set();
const phaseFields = new Map(PHASES.map(p => [p.id, []]));
const paths = {};
const unmapped = [];

for (const f of FIELD_MAPPINGS) {
  if (!f.key || f.kind === 'waitFor' || f.kind === 'addRows') continue;
  if (seen.has(f.key)) continue;
  seen.add(f.key);
  const kind = kindFor(f);
  const field = { key: f.key, label: labelFor(f), kind };
  const group = groupFor(f);
  if (group) field.group = group;
  const options = optionsFor(f, kind);
  if (options) field.options = options;
  if (REQUIRED.has(f.key)) field.required = true;
  if (REQUIRED_IF[f.key]) field.requiredIf = REQUIRED_IF[f.key];
  if (HINTS[f.key]) field.hint = HINTS[f.key];
  if (f.onlyIfEmpty || f.mcaOwned) field.mcaFills = true;
  if (!phaseFields.has(f.phase)) phaseFields.set(f.phase, []);
  phaseFields.get(f.phase).push(field);

  const p = candidatePath(f.key);
  if (verified(f.key, p)) paths[f.key] = p;
  else unmapped.push(f.key);
}

// Extra scanner key used for the NPCS suggestion.
paths.BUSINESS_ACTIVITY = 'principalProducts.BUSINESS_ACTIVITY';
paths.COMPANY_NAME = 'general.COMPANY_NAME';

const stripPhase = label => label.replace(/^Phase \d+\s*[—-]\s*/, '');
const phases = PHASES.map(p => ({ phase: p.id, title: stripPhase(p.label), fields: phaseFields.get(p.id) || [] }));

const page2 = [
  { key: 'BOARD_RESOLUTION_NO', label: 'Board resolution number (authorising the signatory)', kind: 'text', required: true, maxLength: 10,
    hint: 'Up to 10 characters' },
  { key: 'BOARD_RESOLUTION_DATE', label: 'Date of the board resolution', kind: 'date', required: true, hint: 'DD/MM/YYYY, not after today' },
  { key: 'DECL_DESIGNATION', label: 'Designation of the person signing', kind: 'select', required: true,
    options: ['Director', 'Manager', 'CEO', 'CFO', 'Secretary'] },
  { key: 'DECL_DIN', label: 'DIN of the director signing', kind: 'text', required: true, pattern: '^\\d{8}$', hint: '8 digits' },
  { key: 'CERT_PROFESSION', label: 'Certified by (profession)', kind: 'select', required: true,
    options: ['Chartered Accountant', 'Cost Accountant', 'Company Secretary'] },
  { key: 'CERT_ASSOC_FELLOW', label: 'Associate or Fellow', kind: 'select', required: true, options: ['Associate', 'Fellow'] },
  { key: 'CERT_MEMBERSHIP_NO', label: 'Membership number of the professional', kind: 'text', required: true },
  { key: 'CERT_COP_NO', label: 'Certificate of practice number', kind: 'text',
    requiredIf: { key: 'CERT_PROFESSION', in: ['Cost Accountant', 'Company Secretary'] },
    hint: 'Only for a Company Secretary or Cost Accountant in practice' },
];

const banner = `// GENERATED by scripts/gen-aoc4-sections.mjs from extension/js/field-mapper.js — do not edit by hand.
// Re-run: node scripts/gen-aoc4-sections.mjs
/* eslint-disable */
`;
const j = v => JSON.stringify(v, null, 2);
const src = `${banner}
export const AOC4_PHASES = ${j(phases)};

export const AOC4_PAGE2 = ${j(page2)};

export const AOC4_PAYLOAD_PATHS = ${j(paths)};

export const AOC4_UNMAPPED = ${j(unmapped)};

export const AOC4_SECTION_PRECEDENCE = ${j(SECTION_PRECEDENCE)};

export const AOC2_NATURES = ${j(AOC2.NATURES)};

export const AOC2_DESIGNATIONS = ${j(AOC2.DESIGNATIONS)};

// Copied from extension/js/field-mapper.js: how the extension reads the nested job payload.
export ${flattenClient.toString()}
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, src);
const total = phases.reduce((n, p) => n + p.fields.length, 0);
console.log(`aoc4Sections.js: ${phases.length} phases, ${total} page-1 fields, ${page2.length} page-2 fields, `
  + `${Object.keys(paths).length} payload paths, ${unmapped.length} unmapped${unmapped.length ? ' (' + unmapped.join(', ') + ')' : ''}`);
