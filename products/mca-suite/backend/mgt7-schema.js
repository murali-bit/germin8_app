// MGT-7 scanner schema. Output is the flat { dataKey: value } object the extension's MGT-7
// filler reads (extension/js/field-maps/mgt7.js), grouped by MCA section for review.

import { MGT7_CATEGORIES, MGT7_FIELDS } from './mgt7-catalogue.js';

// Each part covers a few MCA sections so its reply fits the gateway's 4096-token cap.
export const MGT7_PARTS = [
  {
    name: 'company & registration',
    categories: ['registration', 'particulars', 'listing', 'agm', 'businessActivities', 'turnoverNetWorth', 'compliancePenalties', 'pcsCertificate', 'declaration'],
    focus: 'company identity, registered office, listing, AGM, principal business activities, turnover and net worth, compliance and certification',
  },
  {
    name: 'share capital',
    categories: ['shareCapital', 'breakupEquity', 'breakupPreference', 'splitAndTransfers'],
    focus: 'the share capital note: authorised, issued, subscribed and paid-up capital, and movements during the year',
  },
  {
    name: 'debentures & securities',
    categories: ['debentures', 'otherSecurities'],
    focus: 'debentures and any other securities',
  },
  {
    name: 'shareholding',
    categories: ['shareholdingPromoters', 'shareholdingPublic', 'shareholderBreakup'],
    focus: 'the shareholding pattern: promoters and public shareholders, and the shareholder count',
  },
  {
    name: 'directors & meetings',
    categories: ['membersAndDirectors', 'meetings', 'remuneration'],
    focus: 'members, directors and key managerial personnel, board and general meetings with attendance, and remuneration',
  },
];

const CATEGORY_LABEL = Object.fromEntries(MGT7_CATEGORIES);
const FIELD_BY_KEY = Object.fromEntries(MGT7_FIELDS.map(([cat, key, label, type, required]) => [key, { cat, key, label, type, required: !!required }]));

// Amounts are scaled from the document's unit; counts and per-share values never are.
const AMOUNT = /amount|\(rs\)|rupees|salary|commission|premium|turnover|net worth|sitting fee|remuneration/i;
const NOT_AMOUNT = /number of|count|percent|%|meetings|per share|per unit|of each unit/i;
const isAmountKey = key => {
  const f = FIELD_BY_KEY[key];
  return !!f && f.type === 'text' && AMOUNT.test(f.label) && !NOT_AMOUNT.test(f.label);
};

export const MGT7_FIELD_LABELS = Object.fromEntries(MGT7_FIELDS.map(([, key, label]) => [key, label]));
export const MGT7_FIELD_GROUPS = MGT7_CATEGORIES.map(([id, title]) => ({
  title,
  keys: MGT7_FIELDS.filter(f => f[0] === id).map(f => f[1]),
}));

export function buildMgt7PartPrompt(part) {
  const lines = MGT7_FIELDS
    .filter(([cat]) => part.categories.includes(cat))
    .map(([cat, key, label, type]) => `${key}: ${label}${type === 'date' ? ' [DD/MM/YYYY]' : type === 'select' || type === 'radio' ? ' [choice, write the wording shown on MCA]' : ''}`);
  const sections = [...new Set(part.categories.map(c => CATEGORY_LABEL[c]))].join('; ');
  return `You are a Company Secretary preparing MCA Form MGT-7 (annual return) from the company's documents (financial statements, annual return draft, registers, board report). Read every page, including scanned and handwritten text. For this request focus on ${part.focus}.

MGT-7 sections in this request: ${sections}

Field catalogue (key: label):
${lines.join('\n')}

Report ONLY the fields whose value appears in the document; leave everything else out. Never invent or estimate values.

Return ONLY minified JSON on a single line (no markdown):
{"meta":{"sourceUnit":"unit printed on any financial figures","unitMultiplier":"1, 100, 1000, 100000 or 10000000","uncertain":[],"notes":""},"values":{"cin":"U01100KA2019PTC123170","equityPaidUpShares":10000}}

Rules:
- Amounts exactly as printed, in the document's own unit; do not convert. Share and member counts as plain numbers.
- Dates DD/MM/YYYY. Yes/No questions as "Yes" or "No".
- Use only keys from the catalogue. If unsure of a value, still report it and add its key to meta.uncertain.
- Work like a fast data-entry operator: transcribe and answer immediately.`;
}

function toNumber(v) {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').trim();
  if (!/^[(-]?[\d,]+(\.\d+)?\)?$/.test(s)) return null;
  const n = Number(s.replace(/[(),]/g, ''));
  return /^\(|^-/.test(s) ? -n : n;
}

// Merges part replies into the flat MGT-7 object. Required fields always get a slot so
// the review shows them as missing when the document did not have them.
export function mergeMgt7Parts(parts) {
  const values = {};
  const meta = { uncertain: [], notes: [], failedParts: [], partsRead: [] };
  for (const p of parts) {
    if (!p.json) { meta.failedParts.push(`${p.name}: ${p.error}`); continue; }
    meta.partsRead.push(p.name);
    const m = p.json.meta || {};
    for (const [k, v] of Object.entries(p.json.values || {})) {
      if (FIELD_BY_KEY[k] && v !== null && v !== undefined && v !== '') values[k] = v;
    }
    if (Array.isArray(m.uncertain)) meta.uncertain.push(...m.uncertain.filter(k => FIELD_BY_KEY[k]));
    if (m.notes) meta.notes.push(String(m.notes));
    if (meta.unitMultiplier === undefined && Number(m.unitMultiplier) > 0) {
      meta.unitMultiplier = Number(m.unitMultiplier);
      if (m.sourceUnit) meta.sourceUnit = m.sourceUnit;
    }
  }
  const mult = meta.unitMultiplier || 1;
  for (const [k, v] of Object.entries(values)) {
    if (!isAmountKey(k)) continue;
    const n = toNumber(v);
    if (n !== null) values[k] = mult === 1 ? n : Math.round(n * mult * 100) / 100;
  }
  // Section 96: AGM due within six months of the year end (31/03 -> 30/09).
  const fyTo = String(values.finYearTo || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!values.agmDueDate && fyTo) {
    let m = +fyTo[2] + 6, y = +fyTo[3];
    if (m > 12) { m -= 12; y += 1; }
    const last = (mm, yy) => new Date(yy, mm, 0).getDate();
    const d = +fyTo[1] === last(+fyTo[2], +fyTo[3]) ? last(m, y) : Math.min(+fyTo[1], last(m, y));
    values.agmDueDate = `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
    meta.derived = ['agmDueDate'];
  }
  for (const [, key, , , required] of MGT7_FIELDS) if (required && !(key in values)) values[key] = '';
  meta.notes = [...new Set(meta.notes)].join(' ');
  meta.uncertain = [...new Set(meta.uncertain)];
  meta.convertedTo = 'Rupees';
  return { meta, ...values };
}
