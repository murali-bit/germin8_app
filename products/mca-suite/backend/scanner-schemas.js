// AOC-4 scanner schema. Output mirrors extension/clients/*_aoc4.json so the
// extension's flattenClient() can consume a scan result without conversion.

import {
  FP_BS_FIELDS, SHARE_CAPITAL_RAISED_FIELDS, FOREIGN_EXCHANGE_FIELDS,
  BS_BREAKUP_EXTRA_FIELDS, PL_DETAIL_EXTRA_FIELDS,
} from './aoc4-longtail.js';
import { applyDocumentRules, isPlaceholderRow, printedTolerance } from './aoc4-enrich.js';

const BS_KEYS = [
  'SHARE_CAPITAL', 'RESERVES_SURPLUS', 'MONEY_AGAINST_WARRANTS', 'SHARE_APP_PENDING',
  'LONG_TERM_BORROWINGS', 'DEFERRED_TAX_LIAB', 'OTHER_LONG_TERM_LIAB', 'LONG_TERM_PROVISIONS',
  'SHORT_TERM_BORROWINGS', 'TRADE_PAYABLES_MSME', 'TRADE_PAYABLES_OTHER', 'OTHER_CURRENT_LIAB',
  'SHORT_TERM_PROVISIONS', 'TOTAL_EQUITY_LIABILITIES',
  'PPE', 'INTANGIBLE_ASSETS', 'CWIP', 'INTANGIBLE_UNDER_DEV', 'NON_CURRENT_INVESTMENTS',
  'DEFERRED_TAX_ASSETS', 'LONG_TERM_LOANS_ADVANCES', 'OTHER_NON_CURRENT_ASSETS',
  'CURRENT_INVESTMENTS', 'INVENTORIES', 'TRADE_RECEIVABLES', 'CASH_EQUIVALENTS',
  'SHORT_TERM_LOANS_ADVANCES', 'OTHER_CURRENT_ASSETS', 'TOTAL_ASSETS',
];

const PL_KEYS = [
  'REVENUE_OPERATIONS', 'OTHER_INCOME', 'TOTAL_INCOME', 'EMPLOYEE_EXPENSES',
  'MANAGERIAL_REMUNERATION', 'FINANCE_COSTS', 'DEPRECIATION', 'OTHER_EXPENSES', 'TOTAL_EXPENSES',
  'PROFIT_BEFORE_TAX', 'CURRENT_TAX', 'DEFERRED_TAX', 'TOTAL_TAX', 'PROFIT_AFTER_TAX',
  'EPS_BASIC', 'EPS_DILUTED',
];

const BS_BREAKUP_KEYS = [
  'BS_UNSEC_LT_BANK_LOANS', 'BS_UNSEC_LT_RELATED_PARTIES', 'BS_UNSEC_LT_OTHER_TERM_LOANS',
  'BS_UNSEC_LT_DEPOSITS', 'BS_UNSEC_ST_BANK_DEMAND', 'BS_UNSEC_ST_RELATED_PARTIES',
  'BS_TRADE_RECEIVABLES_SECURED_GOOD', 'BS_TRADE_RECEIVABLES_UNSECURED_GOOD',
  'BS_TRADE_RECEIVABLES_DOUBTFUL', 'BS_TRADE_RECEIVABLES_PROVISION',
];

const PL_DETAIL_KEYS = [
  'PL_DOMESTIC_MANUFACTURED', 'PL_DOMESTIC_TRADED', 'PL_DOMESTIC_SERVICES',
  'PL_EXPORT_MANUFACTURED', 'PL_EXPORT_TRADED', 'PL_EXPORT_SERVICES',
  'PL_DIVIDEND_INCOME', 'PL_INTEREST_INCOME', 'PL_OTHER_NONOPERATING_INCOME',
  'PL_MATERIALS_CONSUMED', 'PL_STOCK_PURCHASES', 'PL_EMPLOYEE_BENEFITS',
  'PL_AUDITOR_PAYMENT', 'PL_INSURANCE', 'PL_POWER_FUEL', 'PL_FINANCE_COSTS',
  'PL_DEPRECIATION', 'PL_OTHER_EXPENSES',
];

const TEXT_SECTIONS = {
  general: {
    CIN: '', COMPANY_NAME: '', FY_FROM: 'DD/MM/YYYY', FY_TO: 'DD/MM/YYYY',
    BOARD_MEETING_DATE: 'DD/MM/YYYY', NATURE_FS: 'adopted | provisional',
    PROVISIONAL_FILED_EARLIER: 'Yes | No', ADOPTED_IN_ADJOURNED_AGM: 'Yes | No',
    BOARD_REPORT_DATE: 'DD/MM/YYYY', AUDITOR_SIGN_DATE: 'DD/MM/YYYY',
    AGM_HELD: 'Yes | No', AGM_DATE: 'DD/MM/YYYY', AGM_DUE_DATE: 'DD/MM/YYYY', AGM_EXTENSION: 'Yes | No',
    GNL1_SRN: 'SRN of GNL-1 if an AGM extension was sought', AGM_EXT_DUE_DATE: 'DD/MM/YYYY due date after extension',
  },
  auditor: {
    ADT_SRN: '', NUM_AUDITORS: '1', AUDITOR_PAN: 'firm or individual PAN', AUDITOR_CATEGORY: "Auditor's firm | Individual",
    AUDITOR_FIRM_REG: 'ICAI firm registration no, e.g. 000000S', AUDITOR_NAME: 'firm name', UDIN: '',
    AUDITOR_ADDR1: '', AUDITOR_ADDR2: '', AUDITOR_AREA: 'locality', AUDITOR_CITY: '', AUDITOR_DISTRICT: '', AUDITOR_STATE: '',
    AUDITOR_PIN: '', AUDITOR_COUNTRY: 'India', MEMBER_NAME: 'signing partner', MEMBER_NUMBER: 'membership no',
  },
  industry: {
    TYPE_OF_INDUSTRY: 'Commercial & Industrial | Banking | Insurance | Power | NBFC | Housing Finance',
    SCHEDULE_III: 'Yes | No', CONSOLIDATED_FS: 'Yes | No', MAINTAIN_ELECTRONIC_BOOKS: 'Yes | No',
    SERVER_ADDR1: 'address of the server where books of account are kept', SERVER_ADDR2: '', SERVER_AREA: '',
    SERVER_CITY: '', SERVER_DISTRICT: '', SERVER_STATE: '', SERVER_PIN: '', SERVER_COUNTRY: '',
    MAINTAINED_ON_CLOUD: 'Yes | No', SERVICE_PROVIDER_NAME: '', SERVICE_PROVIDER_IP: '',
    SERVICE_PROVIDER_LOCATION: '', SERVICE_PROVIDER_ADDRESS: '',
  },
  subsidiary: {
    IS_SUBSIDIARY: 'Yes | No', HAS_SUBSIDIARY_OR_JV: 'Yes | No',
    HOLDING_CIN: "holding company's CIN", HOLDING_NAME: '', PROVISION_SECTION: 'section 2(87) clause under which it is a subsidiary',
  },
  shareCapital: {
    FACE_VALUE: 'number per share', AUTH_SHARES: 'count', ISSUED_SHARES: 'count', PAID_UP_SHARES: 'count',
    AUTH_NOMINAL: 'amount', ISSUED_NOMINAL: 'amount', PAID_UP_NOMINAL: 'amount',
  },
  financialParametersBS: {
    NET_WORTH: 'amount', GROSS_PPE_INTANGIBLE: 'amount', DEPRECIATION_AMORTIZATION_BS: 'accumulated, amount',
    OPERATING_LEASE_CONVERTED: 'Yes | No', OPERATING_LEASE_DETAILS: '',
  },
  financialParametersPL: {
    FP_PL_PROPOSED_DIVIDEND: 'amount', FP_PL_PROPOSED_DIVIDEND_PERCENT: 'percent', FP_PL_RENT_PAID: 'amount',
    FP_PL_RELATED_PARTY_GROSS: 'amount', FP_PL_RELATED_PARTY_BAD_DEBTS: 'amount',
    FP_PL_FOREIGN_INCOME: 'amount', FP_PL_FOREIGN_EXPENDITURE: 'amount', FP_PL_GOVERNMENT_GRANTS: 'amount',
    FP_PL_STORES_SPARES: 'amount', FP_PL_SECTION_182: 'political contributions u/s 182(3), amount',
  },
  principalProducts: {
    TOTAL_CATEGORIES: 'count of product/service categories',
    CATEGORY_CODE: 'ITC/NPCS 4-digit', CATEGORY_DESC: '', CATEGORY_TURNOVER: 'amount',
    HIGHEST_CODE: '', HIGHEST_DESC: '', HIGHEST_TURNOVER: 'amount',
    BUSINESS_ACTIVITY: 'one or two plain sentences on what the company does, from the corporate information note, revenue note or directors\' report',
    REVENUE_LINES: 'names of the revenue streams in the revenue from operations note, separated by "; "',
  },
  relatedParty: { ANY_TRANSACTION: 'Yes | No' },
  auditorReport: { QUALIFIED_OPINION: 'Yes | No', CAG_COMMENTED: 'Yes | No | Not applicable' },
  csr: { CSR_APPLICABILITY: 'Applicable | Not applicable' },
  secretarialAudit: { SECRETARIAL_AUDIT_APPLICABLE: 'Yes | No' },
  costRecords: { MAINTENANCE_MANDATED: 'Yes | No', AUDIT_MANDATED: 'Yes | No' },
};

// Keys that are counts, ratios or per-share figures, never multiplied by the document's unit.
const AMOUNT_EXCLUDE = /^(EPS_|FACE_VALUE$|asOf$|period$|TOTAL_CATEGORIES$|FP_BS_(08|42)$)|_SHARES$|_EPS_|PERCENT/;

// Long-tail catalogue for the sparse "notes & disclosures" part. Labels get their group
// so ambiguous MCA labels ("From others") read correctly.
const GROUP_PREFIX = [
  [/^BS_UNSEC_LT_/, 'Unsecured long-term borrowings'],
  [/^BS_UNSEC_ST_/, 'Unsecured short-term borrowings'],
  [/^BS_LT_LOANS_GOOD_/, 'Long-term loans & advances, considered good'],
  [/^BS_LT_LOANS_DOUBTFUL_/, 'Long-term loans & advances, doubtful'],
  [/^BS_TRADE_RECEIVABLES_/, 'Trade receivables'],
  [/^FX_IN_/, 'Foreign exchange earnings'],
  [/^FX_OUT_/, 'Foreign exchange outgo'],
  [/^FP_BS_/, 'Financial parameter'],
];
const withGroup = ([key, label]) => {
  const g = GROUP_PREFIX.find(([re]) => re.test(key));
  return [key, g ? `${g[1]}: ${label}` : label];
};
const SINGLE_LONGTAIL = [...FP_BS_FIELDS, ...SHARE_CAPITAL_RAISED_FIELDS].map(withGroup);
const PAIR_LONGTAIL = [...BS_BREAKUP_EXTRA_FIELDS, ...PL_DETAIL_EXTRA_FIELDS, ...FOREIGN_EXCHANGE_FIELDS].map(withGroup);

export const AOC4_FIELD_LABELS = Object.fromEntries([...SINGLE_LONGTAIL, ...PAIR_LONGTAIL]);

function zeroMap(keys) {
  return Object.fromEntries(keys.map(k => [k, 0]));
}
function pairMap(keys) {
  return Object.fromEntries(keys.map(k => [k, { current: 0, previous: 0 }]));
}

const META_SKELETON = {
  sourceUnit: 'exact unit printed on the statements, e.g. "Indian Rupees Hundred"',
  unitMultiplier: 'number: 1 Rupees, 100 Hundreds, 1000 Thousands, 100000 Lakhs, 10000000 Crores',
  uncertain: ['dotted paths of values that were hard to read'],
  derived: ['dotted paths of values you computed rather than read'],
  notes: 'one short sentence, e.g. which statement is missing',
};

// One row per party and nature of transaction from the related party note (AS-18 / Ind AS 24).
const RELATED_PARTY_ROW = {
  name: 'related party', relationship: 'Director | KMP | relative of KMP | holding company | subsidiary | associate | joint venture | other',
  nature: 'e.g. remuneration, loan received, loan repaid, purchase, sale, rent', current: 0, previous: 0,
};

// The G8 gateway caps each reply at 4096 tokens, so AOC-4 is extracted in
// parallel parts that each fit, then merged by mergeAoc4Parts().
export const AOC4_PARTS = [
  {
    name: 'company & auditor',
    focus: 'the auditor\'s report, the signature blocks, and company details',
    skeleton: {
      general: TEXT_SECTIONS.general,
      signatoriesFS: [{ din: '8 digits', name: '', designation: 'Director | Managing Director | CFO | Company Secretary', date: 'DD/MM/YYYY' }],
      signatoriesBR: [{ din: '', name: '', designation: '', date: '' }],
      auditor: TEXT_SECTIONS.auditor,
      industry: TEXT_SECTIONS.industry,
      subsidiary: TEXT_SECTIONS.subsidiary,
      relatedParty: TEXT_SECTIONS.relatedParty,
      auditorReport: TEXT_SECTIONS.auditorReport,
      csr: TEXT_SECTIONS.csr,
      secretarialAudit: TEXT_SECTIONS.secretarialAudit,
      costRecords: TEXT_SECTIONS.costRecords,
    },
  },
  {
    name: 'balance sheet',
    focus: 'the Balance Sheet and its notes (borrowings, trade receivables)',
    skeleton: {
      balanceSheet: {
        current: { asOf: 'DD/MM/YYYY', ...zeroMap(BS_KEYS) },
        previous: { asOf: 'DD/MM/YYYY', ...zeroMap(BS_KEYS) },
      },
      balanceSheetBreakup: pairMap(BS_BREAKUP_KEYS),
    },
  },
  {
    name: 'profit & loss',
    focus: 'the Statement of Profit and Loss and its notes (revenue, other income, employee benefits, finance costs, depreciation from the fixed assets / PPE note, other expenses, tax, EPS). In profitLossDetails also split revenue from operations into domestic/export manufactured, traded or services goods, and keep interest/dividend income out of revenue',
    skeleton: {
      profitLoss: { current: zeroMap(PL_KEYS), previous: zeroMap(PL_KEYS) },
      profitLossDetails: pairMap(PL_DETAIL_KEYS),
      depreciationNote: { current: null, previous: null },
    },
  },
  {
    name: 'share capital & parameters',
    focus: 'the share capital note, fixed assets note, and disclosures; for principalProducts also read the corporate information note (nature of business), the revenue from operations note and the directors\' report (state of affairs) and describe in BUSINESS_ACTIVITY what the company actually does. Copy an ITC/NPCS code only when the document prints one; and the related party disclosure note (AS-18) for relatedPartyTransactions',
    skeleton: {
      shareCapital: TEXT_SECTIONS.shareCapital,
      shareholders: [{ name: '', shares: 0, percent: 0 }],
      financialParametersBS: TEXT_SECTIONS.financialParametersBS,
      financialParametersPL: TEXT_SECTIONS.financialParametersPL,
      principalProducts: TEXT_SECTIONS.principalProducts,
      relatedPartyTransactions: [RELATED_PARTY_ROW],
    },
  },
  {
    name: 'notes & disclosures',
    sparse: true,
    focus: 'the notes to accounts and disclosures: share capital movements, borrowings and loans break-ups, foreign exchange, deposits, investments, warrants, defaults and other financial parameters',
  },
];

function buildSparsePrompt(part) {
  const single = SINGLE_LONGTAIL.map(([k, l]) => `${k}: ${l}`).join('\n');
  const pairs = PAIR_LONGTAIL.map(([k, l]) => `${k}: ${l}`).join('\n');
  return `You are a Chartered Accountant preparing MCA Form AOC-4 from a company's audited financial statements. Read every page, including scanned and handwritten text. For this request focus on ${part.focus}.

Below is a catalogue of AOC-4 fields that are zero for most companies. Report ONLY the fields that have a non-zero value in this document; anything you leave out is recorded as 0.

Single-value fields (current financial year):
${single}

Two-period fields — report as KEY_CUR (current year) and KEY_PREV (previous year):
${pairs}

Return ONLY minified JSON on a single line (no markdown):
{"meta":{"sourceUnit":"unit printed on the statements","unitMultiplier":"1, 100, 1000, 100000 or 10000000","uncertain":[],"notes":""},"nonZero":{"FP_BS_19":12345,"FX_OUT_ROYALTY_CUR":500}}

Rules:
- Amounts exactly as printed, in the document's own unit; do not convert. Bracketed figures are negative.
- Share counts (keys ending _SHARES, FP_BS_08) and FP_BS_42 are plain counts.
- Share capital raised: list opening balances and every issue, buy-back or forfeiture during the year shown in the share capital note.
- Use only keys from the catalogue. Never invent values; if unsure of a value, still report it and add its key to meta.uncertain.
- Work like a fast data-entry operator: transcribe and answer immediately.`;
}

export function buildAoc4PartPrompt(part) {
  if (part.sparse) return buildSparsePrompt(part);
  return `You are a Chartered Accountant preparing MCA Form AOC-4 from a company's audited financial statements. Read every page, including scanned and handwritten text. For this request focus on ${part.focus}.

Return ONLY minified JSON on a single line (no markdown, no indentation) with exactly this structure; placeholder strings describe the expected value:
${JSON.stringify({ meta: META_SKELETON, ...part.skeleton })}

Work like a fast data-entry operator: transcribe values directly from the pages and answer immediately. Do not add up, verify or reconcile figures — software computes and checks totals afterwards.

Rules:
- Amounts: plain numbers exactly as printed, in the document's own unit. Do NOT convert units; report the unit in meta.sourceUnit and meta.unitMultiplier. Bracketed figures and deficits are negative.
- "current" = the financial year being reported; "previous" = the comparative column.
- Not printed in the document: "" for text, null for numbers. Never invent values; leave unprinted totals null.
- If the Statement of Profit and Loss page is missing, take each line from its note total and add "profitLoss" to meta.derived.
- signatoriesFS: who signed the financial statements (name, DIN, date). With no separate Board's report, copy them to signatoriesBR and add "signatoriesBR" to meta.derived.
- auditor: firm, FRN, signing partner, membership no., UDIN and address from the audit report signature block.
- shareholders: from the share capital note (holders above 5%).${part.skeleton.depreciationNote ? `
- depreciationNote: the total "charge for the year" (depreciation + amortisation, tangible + intangible) printed in the fixed assets / PPE note, per year, as printed; null when the note does not print it.` : ''}${part.skeleton.relatedPartyTransactions ? `
- relatedPartyTransactions: every transaction during the year listed in the related party note, one row per party and nature, amounts as printed. Do NOT list closing / outstanding balances as rows. No related party note: [].` : ''}
- Dates DD/MM/YYYY. meta.uncertain and meta.derived: at most 8 short paths each.`;
}

// Merges part replies into one client object. Part order matters only for meta.
export function mergeAoc4Parts(parts) {
  const merged = {};
  const meta = { uncertain: [], derived: [], notes: [], failedParts: [], partsRead: [] };
  for (const p of parts) {
    if (!p.json) {
      meta.failedParts.push(`${p.name}: ${p.error}`);
      continue;
    }
    meta.partsRead.push(p.name);
    const { meta: m = {}, ...sections } = p.json;
    Object.assign(merged, sections);
    meta.uncertain.push(...(Array.isArray(m.uncertain) ? m.uncertain : []));
    meta.derived.push(...(Array.isArray(m.derived) ? m.derived : []));
    if (m.notes) meta.notes.push(String(m.notes));
    // The balance-sheet part is the most reliable reader of the unit line.
    if (meta.unitMultiplier === undefined || p.name === 'balance sheet') {
      if (m.unitMultiplier !== undefined && m.unitMultiplier !== '') meta.unitMultiplier = m.unitMultiplier;
      if (m.sourceUnit) meta.sourceUnit = m.sourceUnit;
    }
  }
  const sentences = meta.notes.flatMap(n => n.split(/(?<=[.;])\s+/)).map(s => s.trim()).filter(Boolean);
  const seen = new Set();
  meta.notes = sentences.filter(s => {
    const key = s.toLowerCase().replace(/\(.*?\)|[^a-z ]/g, '').slice(0, 40);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(' ');
  meta.uncertain = [...new Set(meta.uncertain)];
  meta.derived = [...new Set(meta.derived)];
  merged.meta = meta;
  return merged;
}

function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  const neg = /^\(.*\)$/.test(s) || s.startsWith('-');
  const n = Number(s.replace(/[(),\s₹]/g, '').replace(/^-/, ''));
  if (Number.isNaN(n)) return null;
  return neg ? -n : n;
}

function scale(v, mult, key) {
  if (typeof v === 'string' && /^\s*(nil|-|—)\s*$/i.test(v)) return 0;
  const n = toNumber(v);
  // Text that shares a section with amounts (e.g. OPERATING_LEASE_CONVERTED: "No") is kept as is.
  if (n === null) return typeof v === 'string' && v.trim() !== '' ? v : null;
  if (mult === 1 || AMOUNT_EXCLUDE.test(key)) return n;
  return Math.round(n * mult * 100) / 100;
}

function scaleAmount(v, mult) {
  const n = toNumber(v);
  return n === null ? null : Math.round(n * mult * 100) / 100;
}

function scaleFlat(obj, mult, onlyKeys) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = { ...obj };
  for (const k of Object.keys(out)) {
    if (k === 'asOf' || k === 'period') continue;
    if (onlyKeys && !onlyKeys.test(k)) continue;
    out[k] = scale(out[k], mult, k);
  }
  return out;
}

function scalePairs(obj, mult) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = { current: scale(v?.current, mult, k), previous: scale(v?.previous, mult, k) };
  }
  return out;
}

const round2 = n => Math.round(n * 100) / 100;
const isNum = v => typeof v === 'number' && Number.isFinite(v);

// Fills totals the document didn't print (or the model left null) from their
// components, so arithmetic never depends on the model. Each fill is marked derived.
function deriveTotals(data, derived) {
  for (const per of ['current', 'previous']) {
    const b = data.balanceSheet?.[per];
    if (b) {
      const liab = BS_KEYS.slice(0, BS_KEYS.indexOf('TOTAL_EQUITY_LIABILITIES'));
      const assets = BS_KEYS.slice(BS_KEYS.indexOf('TOTAL_EQUITY_LIABILITIES') + 1, BS_KEYS.indexOf('TOTAL_ASSETS'));
      if (!isNum(b.TOTAL_EQUITY_LIABILITIES) && liab.some(k => isNum(b[k]))) {
        b.TOTAL_EQUITY_LIABILITIES = round2(liab.reduce((s, k) => s + (b[k] || 0), 0));
        derived.push(`balanceSheet.${per}.TOTAL_EQUITY_LIABILITIES`);
      }
      if (!isNum(b.TOTAL_ASSETS) && assets.some(k => isNum(b[k]))) {
        b.TOTAL_ASSETS = round2(assets.reduce((s, k) => s + (b[k] || 0), 0));
        derived.push(`balanceSheet.${per}.TOTAL_ASSETS`);
      }
    }

    const p = data.profitLoss?.[per];
    if (!p) continue;
    const set = (k, v) => { p[k] = round2(v); derived.push(`profitLoss.${per}.${k}`); };
    if (!isNum(p.TOTAL_INCOME) && (isNum(p.REVENUE_OPERATIONS) || isNum(p.OTHER_INCOME))) {
      set('TOTAL_INCOME', (p.REVENUE_OPERATIONS || 0) + (p.OTHER_INCOME || 0));
    }
    // Managerial remuneration is already inside employee expenses, so it is not added again.
    const expLines = ['EMPLOYEE_EXPENSES', 'FINANCE_COSTS', 'DEPRECIATION', 'OTHER_EXPENSES'];
    const costLines = ['PL_MATERIALS_CONSUMED', 'PL_STOCK_PURCHASES'].map(k => data.profitLossDetails?.[k]?.[per]);
    if (!isNum(p.TOTAL_EXPENSES) && expLines.some(k => isNum(p[k]))) {
      set('TOTAL_EXPENSES', expLines.reduce((s, k) => s + (p[k] || 0), 0) + costLines.reduce((s, v) => s + (isNum(v) ? v : 0), 0));
    }
    if (!isNum(p.TOTAL_TAX) && (isNum(p.CURRENT_TAX) || isNum(p.DEFERRED_TAX))) {
      set('TOTAL_TAX', (p.CURRENT_TAX || 0) + (p.DEFERRED_TAX || 0));
    }
    if (!isNum(p.PROFIT_BEFORE_TAX) && isNum(p.TOTAL_INCOME) && isNum(p.TOTAL_EXPENSES)) {
      set('PROFIT_BEFORE_TAX', p.TOTAL_INCOME - p.TOTAL_EXPENSES);
    }
    if (!isNum(p.PROFIT_AFTER_TAX) && isNum(p.PROFIT_BEFORE_TAX)) {
      set('PROFIT_AFTER_TAX', p.PROFIT_BEFORE_TAX - (p.TOTAL_TAX || 0));
    }
    const shares = data.shareCapital?.PAID_UP_SHARES;
    if (!isNum(p.EPS_BASIC) && isNum(p.PROFIT_AFTER_TAX) && isNum(shares) && shares > 0) {
      set('EPS_BASIC', p.PROFIT_AFTER_TAX / shares);
    }
    if (!isNum(p.EPS_DILUTED) && isNum(p.EPS_BASIC)) set('EPS_DILUTED', p.EPS_BASIC);

    // AOC-4's detailed "other expenses" excludes lines itemised separately in the same schedule.
    const det = data.profitLossDetails;
    const other = det?.PL_OTHER_EXPENSES;
    if (other && isNum(other[per]) && isNum(p.OTHER_EXPENSES) && Math.abs(other[per] - p.OTHER_EXPENSES) < 1) {
      const itemised = ['PL_AUDITOR_PAYMENT', 'PL_INSURANCE', 'PL_POWER_FUEL']
        .reduce((s, k) => s + (isNum(det[k]?.[per]) ? det[k][per] : 0), 0);
      if (itemised > 0) {
        other[per] = round2(p.OTHER_EXPENSES - itemised);
        derived.push(`profitLossDetails.PL_OTHER_EXPENSES.${per}`);
      }
    }
  }

  const bc = data.balanceSheet?.current;
  const fp = data.financialParametersBS;
  if (fp && !isNum(fp.NET_WORTH) && bc && isNum(bc.SHARE_CAPITAL) && isNum(bc.RESERVES_SURPLUS)) {
    fp.NET_WORTH = round2(bc.SHARE_CAPITAL + bc.RESERVES_SURPLUS + (bc.MONEY_AGAINST_WARRANTS || 0));
    derived.push('financialParametersBS.NET_WORTH');
  }
}

const SINGLE_KEYS = SINGLE_LONGTAIL.map(([k]) => k);
const PAIR_KEYS = PAIR_LONGTAIL.map(([k]) => k);
const singleSection = k => (k.startsWith('SC_') ? 'shareCapitalRaised' : 'financialParametersBS');
const pairSection = k => (k.startsWith('FX_') ? 'foreignExchange' : k.startsWith('BS_') ? 'balanceSheetBreakup' : 'profitLossDetails');

// Moves the sparse part's nonZero map into the extension's sections. When that part was
// read, every catalogue key gets a slot (null = not reported, nil-filled later).
function routeLongTail(data, longtailRead) {
  const nz = data.nonZero && typeof data.nonZero === 'object' ? data.nonZero : {};
  delete data.nonZero;
  if (!longtailRead) return;
  for (const k of SINGLE_KEYS) {
    const sec = singleSection(k);
    data[sec] = data[sec] || {};
    if (data[sec][k] === undefined || data[sec][k] === null) data[sec][k] = nz[k] ?? null;
  }
  for (const k of PAIR_KEYS) {
    const sec = pairSection(k);
    data[sec] = data[sec] || {};
    if (!data[sec][k]) data[sec][k] = { current: nz[`${k}_CUR`] ?? null, previous: nz[`${k}_PREV`] ?? null };
  }
}

function parseDmy(s) {
  const m = String(s || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? { d: +m[1], m: +m[2], y: +m[3] } : null;
}
const daysIn = (m, y) => new Date(y, m, 0).getDate();
const fmtDmy = ({ d, m, y }) => `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;

// Section 96: the AGM is due within six months of the financial year end.
function sixMonthsAfter(fyTo) {
  const p = parseDmy(fyTo);
  if (!p) return '';
  let m = p.m + 6, y = p.y;
  if (m > 12) { m -= 12; y += 1; }
  const d = p.d === daysIn(p.m, p.y) ? daysIn(m, y) : Math.min(p.d, daysIn(m, y));
  return fmtDmy({ d, m, y });
}

// Part A answers that financial statements rarely print but that follow from what they do
// print or from the Act. Every fill is marked derived; the AGM date itself is never guessed.
export function deriveGeneral(data, derived) {
  const g = data.general;
  if (!g) return;
  const blank = v => v === undefined || v === null || String(v).trim() === '';
  const set = (key, value) => { if (blank(g[key]) && !blank(value)) { g[key] = value; derived.push(`general.${key}`); } };
  const fsSigned = (data.signatoriesFS || []).map(s => s.date).find(d => parseDmy(d));
  set('BOARD_MEETING_DATE', fsSigned);
  set('BOARD_REPORT_DATE', g.BOARD_MEETING_DATE);
  set('NATURE_FS', 'adopted');
  set('PROVISIONAL_FILED_EARLIER', 'No');
  set('ADOPTED_IN_ADJOURNED_AGM', 'No');
  if (/^adopted$/i.test(String(g.NATURE_FS))) set('AGM_HELD', 'Yes');
  set('AGM_DUE_DATE', sixMonthsAfter(g.FY_TO));
  if (blank(g.GNL1_SRN)) set('AGM_EXTENSION', 'No');
  for (const s of data.signatoriesBR || []) {
    if (blank(s.date) && parseDmy(g.BOARD_REPORT_DATE)) { s.date = g.BOARD_REPORT_DATE; derived.push('signatoriesBR'); }
  }
}

// Mirrors the arithmetic the extension checks before filling (extension/js/aoc4-checks.js) and
// resolves the patterns that real statements trip over. Every change is derived and noted.
const SALES_KEYS = ['PL_DOMESTIC_MANUFACTURED', 'PL_DOMESTIC_TRADED', 'PL_DOMESTIC_SERVICES', 'PL_EXPORT_MANUFACTURED', 'PL_EXPORT_TRADED', 'PL_EXPORT_SERVICES'];
const OTHER_INCOME_KEYS = ['PL_DIVIDEND_INCOME', 'PL_INTEREST_INCOME', 'PL_INVESTMENT_GAIN_LOSS', 'PL_OTHER_NONOPERATING_INCOME'];
const EXPENSE_KEYS = ['PL_MATERIALS_CONSUMED', 'PL_STOCK_PURCHASES', 'PL_INVENTORY_FINISHED', 'PL_INVENTORY_WIP', 'PL_INVENTORY_STOCK',
  'PL_EMPLOYEE_BENEFITS', 'PL_MANAGERIAL_REMUNERATION', 'PL_AUDITOR_PAYMENT', 'PL_INSURANCE', 'PL_POWER_FUEL', 'PL_FINANCE_COSTS',
  'PL_DEPRECIATION', 'PL_OTHER_EXPENSES'];
const inrText = n => '₹' + Math.round(n).toLocaleString('en-IN');

export function reconcileForMca(data, meta) {
  const derived = meta.derived;
  const uncertain = meta.uncertain || (meta.uncertain = []);
  const notes = [];
  const n = v => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const tol = printedTolerance(meta);   // one printed unit (smallest step the statements print), in rupees
  const det = data.profitLossDetails || (data.profitLossDetails = {});
  const line = (key, per) => n(det[key]?.[per]);
  const setLine = (key, per, value) => {
    det[key] = det[key] || { current: 0, previous: 0 };
    det[key][per] = round2(value);
    derived.push(`profitLossDetails.${key}.${per}`);
  };
  const pp = data.principalProducts || {};

  for (const per of ['current', 'previous']) {
    const p = data.profitLoss?.[per];
    if (!p) continue;
    const label = per === 'current' ? 'current year' : 'previous year';

    // 1. Other income printed inside revenue from operations (Schedule III keeps them apart).
    const oi = OTHER_INCOME_KEYS.reduce((s, k) => s + line(k, per), 0);
    if (oi > 0 && !n(p.OTHER_INCOME) && Math.abs(n(p.REVENUE_OPERATIONS) - n(p.TOTAL_INCOME)) <= tol && n(p.REVENUE_OPERATIONS) > oi) {
      p.REVENUE_OPERATIONS = round2(p.REVENUE_OPERATIONS - oi);
      p.OTHER_INCOME = round2(oi);
      derived.push(`profitLoss.${per}.REVENUE_OPERATIONS`, `profitLoss.${per}.OTHER_INCOME`);
      notes.push(`Other income ${inrText(oi)} (${label}) was printed inside revenue from operations; moved to other income.`);
    }

    // 2. Revenue not classified into manufactured / traded / services.
    if (SALES_KEYS.every(k => !line(k, per)) && n(p.REVENUE_OPERATIONS) > 0) {
      const desc = `${pp.CATEGORY_DESC || ''} ${pp.HIGHEST_DESC || ''}`;
      // Goods first: "products and related services" is still a goods business.
      const target = line('PL_MATERIALS_CONSUMED', per) > 0 ? 'PL_DOMESTIC_MANUFACTURED'
        : /product|goods|trading|sale of/i.test(desc) ? 'PL_DOMESTIC_TRADED'
          : /servic/i.test(desc) ? 'PL_DOMESTIC_SERVICES' : 'PL_DOMESTIC_TRADED';
      setLine(target, per, p.REVENUE_OPERATIONS);
      uncertain.push(`profitLossDetails.${target}.${per}`);
      if (per === 'current') notes.push(`Revenue was not split by type; all of it is put under ${target.replace('PL_', '').replace(/_/g, ' ').toLowerCase()} — confirm.`);
    }

    // 3. Directors' remuneration shown inside employee benefits and again as managerial remuneration.
    const exp = () => EXPENSE_KEYS.reduce((s, k) => s + line(k, per), 0);
    const mr = line('PL_MANAGERIAL_REMUNERATION', per);
    if (mr > 0 && Math.abs(exp() - n(p.TOTAL_EXPENSES)) > tol && Math.abs(exp() - mr - n(p.TOTAL_EXPENSES)) <= tol) {
      setLine('PL_MANAGERIAL_REMUNERATION', per, 0);
      if (n(p.MANAGERIAL_REMUNERATION)) { p.MANAGERIAL_REMUNERATION = 0; derived.push(`profitLoss.${per}.MANAGERIAL_REMUNERATION`); }
      notes.push(`Directors' remuneration ${inrText(mr)} (${label}) is already inside employee benefits, so managerial remuneration is set to 0 (or split it out and reduce employee benefits by the same amount).`);
    }

    // 4. One-unit rounding between printed profits and the lines.
    const sales = SALES_KEYS.reduce((s, k) => s + line(k, per), 0);
    const pbt = sales + OTHER_INCOME_KEYS.reduce((s, k) => s + line(k, per), 0) - exp()
      - line('PL_EXCEPTIONAL_ITEMS', per) - line('PL_EXTRAORDINARY_ITEMS', per);
    const diffPbt = Math.abs(pbt - n(p.PROFIT_BEFORE_TAX));
    if (diffPbt > 1 && diffPbt <= tol) {
      notes.push(`Profit before tax (${label}) printed as ${inrText(p.PROFIT_BEFORE_TAX)} but the lines give ${inrText(pbt)} (rounding in the statement); the computed figure is used.`);
      p.PROFIT_BEFORE_TAX = round2(pbt);
      derived.push(`profitLoss.${per}.PROFIT_BEFORE_TAX`);
    }
    const after = n(p.PROFIT_BEFORE_TAX) - n(p.CURRENT_TAX) - n(p.DEFERRED_TAX) + line('PL_DISCONTINUED_OPERATIONS', per) - line('PL_DISCONTINUED_TAX', per);
    const diffPat = Math.abs(after - n(p.PROFIT_AFTER_TAX));
    if (diffPat > 1 && diffPat <= tol) {
      notes.push(`Profit after tax (${label}) printed as ${inrText(p.PROFIT_AFTER_TAX)} but the lines give ${inrText(after)} (rounding in the statement); the computed figure is used.`);
      p.PROFIT_AFTER_TAX = round2(after);
      derived.push(`profitLoss.${per}.PROFIT_AFTER_TAX`);
    }
  }

  // 5. One-unit rounding between balance-sheet lines and totals.
  const LIAB = BS_KEYS.slice(0, BS_KEYS.indexOf('TOTAL_EQUITY_LIABILITIES'));
  const ASSET = BS_KEYS.slice(BS_KEYS.indexOf('TOTAL_EQUITY_LIABILITIES') + 1, BS_KEYS.indexOf('TOTAL_ASSETS'));
  for (const per of ['current', 'previous']) {
    const b = data.balanceSheet?.[per];
    if (!b) continue;
    for (const [keys, totalKey] of [[LIAB, 'TOTAL_EQUITY_LIABILITIES'], [ASSET, 'TOTAL_ASSETS']]) {
      const diff = round2(n(b[totalKey]) - keys.reduce((s, k) => s + n(b[k]), 0));
      if (Math.abs(diff) <= 1 || Math.abs(diff) > tol) continue;
      // Prefer the line the scanner was unsure about (this year, then same item last year), else the largest.
      const flagged = k => uncertain.includes(`balanceSheet.${per}.${k}`);
      const flaggedOther = k => uncertain.some(u => u.endsWith(`.${k}`) && u.startsWith('balanceSheet.'));
      const target = keys.find(flagged) || keys.find(flaggedOther)
        || keys.slice().sort((a, c) => Math.abs(n(b[c])) - Math.abs(n(b[a])))[0];
      notes.push(`${per === 'current' ? 'Current' : 'Previous'}-year ${totalKey === 'TOTAL_ASSETS' ? 'assets' : 'liabilities'} were ${inrText(Math.abs(diff))} off the printed total (rounding in the statement); adjusted ${target.replace(/_/g, ' ').toLowerCase()}.`);
      b[target] = round2(n(b[target]) + diff);
      derived.push(`balanceSheet.${per}.${target}`);
      uncertain.push(`balanceSheet.${per}.${target}`);
    }
  }

  // 6. Trade receivables break-up left empty.
  const br = data.balanceSheetBreakup || (data.balanceSheetBreakup = {});
  for (const per of ['current', 'previous']) {
    const tr = n(data.balanceSheet?.[per]?.TRADE_RECEIVABLES);
    const parts = ['BS_TRADE_RECEIVABLES_SECURED_GOOD', 'BS_TRADE_RECEIVABLES_UNSECURED_GOOD', 'BS_TRADE_RECEIVABLES_DOUBTFUL'];
    if (tr > 0 && parts.every(k => !n(br[k]?.[per]))) {
      br.BS_TRADE_RECEIVABLES_UNSECURED_GOOD = br.BS_TRADE_RECEIVABLES_UNSECURED_GOOD || { current: 0, previous: 0 };
      br.BS_TRADE_RECEIVABLES_UNSECURED_GOOD[per] = tr;
      derived.push(`balanceSheetBreakup.BS_TRADE_RECEIVABLES_UNSECURED_GOOD.${per}`);
      if (per === 'current') notes.push('Trade receivables are not classified in the notes; shown as unsecured, considered good — confirm.');
    }
  }

  // 7. Break-ups that must add up to their balance-sheet line (duplicate related-party / "other" amounts),
  //    AS-18 gross related-party transactions, auditor area repeating an address line (aoc4-enrich.js).
  const rules = applyDocumentRules(data, meta, { tol });
  derived.push(...rules.derived);
  uncertain.push(...rules.uncertain);
  notes.push(...rules.notes);
  meta.enrichSources = { ...(meta.enrichSources || {}), ...rules.sources };
  meta.ruleChecks = [...(Array.isArray(meta.ruleChecks) ? meta.ruleChecks : []), ...rules.sticky]
    .filter((c, i, all) => all.findIndex(x => x.id === c.id) === i);

  if (notes.length) meta.notes = [meta.notes, ...notes].filter(Boolean).join(' ');
  meta.uncertain = [...new Set(uncertain)];
}

// Long-tail values that follow from figures already read.
function deriveLongTail(data, derived) {
  const set = (sec, key, value, per) => {
    if (per) { data[sec][key][per] = value; derived.push(`${sec}.${key}.${per}`); }
    else { data[sec][key] = value; derived.push(`${sec}.${key}`); }
  };
  const sc = data.shareCapitalRaised;
  const prevCapital = data.balanceSheet?.previous?.SHARE_CAPITAL;
  const face = data.shareCapital?.FACE_VALUE;
  if (sc && isNum(prevCapital)) {
    // Opening equity = last year's paid-up capital (Schedule III comparative).
    if (sc.SC_EQ_BEGIN_NOMINAL === null) set('shareCapitalRaised', 'SC_EQ_BEGIN_NOMINAL', prevCapital);
    if (sc.SC_EQ_BEGIN_PAID === null) set('shareCapitalRaised', 'SC_EQ_BEGIN_PAID', prevCapital);
    if (sc.SC_EQ_BEGIN_SHARES === null && isNum(face) && face > 0) set('shareCapitalRaised', 'SC_EQ_BEGIN_SHARES', Math.round(prevCapital / face));
  }

  const fpl = data.financialParametersPL;
  const plc = data.profitLoss?.current;
  if (fpl && plc) {
    if (!isNum(fpl.FP_PL_EPS_BASIC) && isNum(plc.EPS_BASIC)) set('financialParametersPL', 'FP_PL_EPS_BASIC', plc.EPS_BASIC);
    if (!isNum(fpl.FP_PL_EPS_DILUTED) && isNum(plc.EPS_DILUTED)) set('financialParametersPL', 'FP_PL_EPS_DILUTED', plc.EPS_DILUTED);
  }

  const det = data.profitLossDetails;
  for (const per of ['current', 'previous']) {
    const p = data.profitLoss?.[per];
    if (!det || !p) continue;
    if (det.PL_MANAGERIAL_REMUNERATION && det.PL_MANAGERIAL_REMUNERATION[per] === null && isNum(p.MANAGERIAL_REMUNERATION)) {
      set('profitLossDetails', 'PL_MANAGERIAL_REMUNERATION', p.MANAGERIAL_REMUNERATION, per);
    }
    // With no extraordinary items, EPS after them equals EPS.
    const extra = det.PL_EXTRAORDINARY_ITEMS?.[per];
    if (!extra) {
      for (const [key, src] of [['PL_EPS_BASIC_AFTER_EXTRAORDINARY', 'EPS_BASIC'], ['PL_EPS_DILUTED_AFTER_EXTRAORDINARY', 'EPS_DILUTED']]) {
        if (det[key] && det[key][per] === null && isNum(p[src])) set('profitLossDetails', key, p[src], per);
      }
    }
  }

  const pp = data.principalProducts;
  if (pp && !isNum(pp.TOTAL_CATEGORIES) && (pp.CATEGORY_DESC || pp.CATEGORY_CODE)) set('principalProducts', 'TOTAL_CATEGORIES', 1);
}

// A statement that was read but has no line for an item means nil; MCA expects 0
// there. Totals, profits and EPS are never nil-filled — blank means unknown.
const NEVER_NIL = /^(TOTAL_|PROFIT_|EPS_)|_EPS_/;
function fillNil(data, longtailRead, paramsRead) {
  const nil = [];
  const fpl = data.financialParametersPL;
  if (paramsRead && fpl) {
    for (const k of Object.keys(fpl)) {
      if (fpl[k] === null && !NEVER_NIL.test(k)) { fpl[k] = 0; nil.push(`financialParametersPL.${k}`); }
    }
  }
  if (longtailRead) {
    for (const k of SINGLE_KEYS) {
      const sec = data[singleSection(k)];
      if (sec && sec[k] === null && !NEVER_NIL.test(k)) { sec[k] = 0; nil.push(`${singleSection(k)}.${k}`); }
    }
    for (const k of PAIR_KEYS) {
      const v = data[pairSection(k)]?.[k];
      for (const per of ['current', 'previous']) {
        if (v && v[per] === null && !NEVER_NIL.test(k)) { v[per] = 0; nil.push(`${pairSection(k)}.${k}.${per}`); }
      }
    }
  }
  const fill = (obj, prefix) => {
    if (!obj || !Object.values(obj).some(isNum)) return;
    for (const k of Object.keys(obj)) {
      if (obj[k] === null && !NEVER_NIL.test(k)) { obj[k] = 0; nil.push(`${prefix}.${k}`); }
    }
  };
  for (const per of ['current', 'previous']) {
    fill(data.balanceSheet?.[per], `balanceSheet.${per}`);
    fill(data.profitLoss?.[per], `profitLoss.${per}`);
  }
  for (const sec of ['balanceSheetBreakup', 'profitLossDetails']) {
    const s = data[sec];
    if (!s || !Object.values(s).some(v => isNum(v?.current) || isNum(v?.previous))) continue;
    for (const [k, v] of Object.entries(s)) {
      for (const per of ['current', 'previous']) {
        if (v && v[per] === null && !NEVER_NIL.test(k)) { v[per] = 0; nil.push(`${sec}.${k}.${per}`); }
      }
    }
  }
  return [...new Set(nil)];
}

// Converts printed amounts to absolute rupees and stamps the client identity
// fields the extension's importClient handler keys on.
export function postProcessAoc4(raw) {
  const data = { ...raw };
  const meta = { uncertain: [], derived: [], ...(data.meta || {}) };
  let mult = Number(meta.unitMultiplier);
  if (!Number.isFinite(mult) || mult <= 0) mult = 1;
  meta.unitMultiplier = mult;
  meta.convertedTo = 'Rupees';
  // Smallest step the face statements print (e.g. 0.01 lakh = ₹1,000), measured from the figures' decimals.
  {
    let decimals = 0;
    const look = o => Object.entries(o || {}).forEach(([k, v]) => {
      if (/EPS|asOf|PERCENT|SHARES|FACE_VALUE/i.test(k)) return;   // not amounts
      const m = String(v ?? '').replace(/[,\s₹()]/g, '').match(/^-?\d+\.(\d+)$/);
      if (m) decimals = Math.max(decimals, Math.min(2, m[1].replace(/0+$/, '').length));
    });
    for (const sec of [raw.balanceSheet, raw.profitLoss]) { look(sec?.current); look(sec?.previous); }
    meta.printedPrecision = Math.max(1, mult / 10 ** decimals);
  }
  const longtailRead = (meta.partsRead || []).includes('notes & disclosures');
  const paramsRead = (meta.partsRead || []).includes('share capital & parameters');
  routeLongTail(data, longtailRead);

  if (data.balanceSheet) {
    data.balanceSheet = {
      scaleNote: mult === 1 ? 'Values in Rupees as printed.' : `Converted from ${meta.sourceUnit || 'source unit'} to Rupees (x${mult}).`,
      current: scaleFlat(data.balanceSheet.current, mult),
      previous: scaleFlat(data.balanceSheet.previous, mult),
    };
  }
  if (data.profitLoss) {
    data.profitLoss = {
      current: scaleFlat(data.profitLoss.current, mult),
      previous: scaleFlat(data.profitLoss.previous, mult),
    };
  }
  data.balanceSheetBreakup = scalePairs(data.balanceSheetBreakup, mult);
  if (data.depreciationNote && typeof data.depreciationNote === 'object') {
    data.depreciationNote = { current: scaleAmount(data.depreciationNote.current, mult), previous: scaleAmount(data.depreciationNote.previous, mult) };
  }
  data.profitLossDetails = scalePairs(data.profitLossDetails, mult);
  data.shareCapital = scaleFlat(data.shareCapital, mult);
  data.financialParametersBS = scaleFlat(data.financialParametersBS, mult);
  data.financialParametersPL = scaleFlat(data.financialParametersPL, mult);
  data.principalProducts = scaleFlat(data.principalProducts, mult, /TURNOVER$|^TOTAL_CATEGORIES$/);
  if (data.shareCapitalRaised) data.shareCapitalRaised = scaleFlat(data.shareCapitalRaised, mult);
  if (data.foreignExchange) data.foreignExchange = scalePairs(data.foreignExchange, mult);
  if (Array.isArray(data.shareholders)) {
    data.shareholders = data.shareholders.map(s => ({ ...s, shares: toNumber(s.shares), percent: toNumber(s.percent) }));
  }
  if (Array.isArray(data.relatedPartyTransactions)) {
    // Rows copied from the skeleton placeholder ("a | b | c" hint text) or without any amount are dropped.
    data.relatedPartyTransactions = data.relatedPartyTransactions
      .filter(r => r && typeof r === 'object')
      .map(r => ({
        name: String(r.name || '').trim(), relationship: String(r.relationship || '').trim(), nature: String(r.nature || '').trim(),
        current: scaleAmount(r.current, mult), previous: scaleAmount(r.previous, mult),
      }))
      .filter(r => !isPlaceholderRow(r));
  }
  meta.derived = [...meta.derived];
  deriveGeneral(data, meta.derived);
  deriveTotals(data, meta.derived);
  deriveLongTail(data, meta.derived);
  meta.nil = fillNil(data, longtailRead, paramsRead);
  deriveTotals(data, meta.derived);
  deriveLongTail(data, meta.derived);
  reconcileForMca(data, meta);
  meta.derived = [...new Set(meta.derived)];

  const cin = String(data.general?.CIN || '').trim().toUpperCase();
  if (data.general) data.general.CIN = cin;
  const fyTo = String(data.general?.FY_TO || '').replace(/\D/g, '');
  data.clientId = (cin ? `${cin}_${fyTo}` : `scan_${Date.now()}`).toLowerCase();
  data.displayName = `${data.general?.COMPANY_NAME || cin || 'Scanned company'} — AOC-4`;
  data.source = 'germin8-ai-scanner';
  data.meta = meta;
  return data;
}
