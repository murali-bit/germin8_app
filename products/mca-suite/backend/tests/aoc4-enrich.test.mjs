// node --test backend/tests/aoc4-enrich.test.mjs
// AOC-4 enrich rules and the company-records routes. Made-up companies and numbers only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Readable } from 'node:stream';
import {
  enrichAoc4, balanceBreakups, relatedPartyTotal, districtFromPin, normaliseCompanyName,
} from '../aoc4-enrich.js';
import {
  handle, AUDIT_FIRMS_DDL, resolveCinFromRecords, findAdtSrnInRecords, firmPanFromRecords, makeLookups,
  parseFilesureCandidates,
} from '../routes/scan-enrich.js';
import { postProcessAoc4 } from '../scanner-schemas.js';

const CIN = 'U01100KA2019PTC000001';
const CIN2 = 'U01100KA2019PTC000002';
const NAME = 'Dummy Test Private Limited';
const FRN = '000000S';
const PAN = 'ABCDE1234F';
const SRN = 'F12345678';

function memDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE clients (id TEXT PRIMARY KEY, cin TEXT UNIQUE NOT NULL, name TEXT NOT NULL);
    CREATE TABLE extension_jobs (id TEXT PRIMARY KEY, form_type TEXT NOT NULL, client_id TEXT NOT NULL, client_name TEXT,
      payload TEXT NOT NULL, status TEXT DEFAULT 'ready', result TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE saved_scans (id TEXT PRIMARY KEY, form_type TEXT, company_name TEXT, cin TEXT, data TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE company_answers (cin TEXT NOT NULL, form_type TEXT NOT NULL, field_key TEXT NOT NULL, label TEXT, value TEXT,
      source TEXT, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (cin, form_type, field_key));
    CREATE TABLE adt1_drafts (id TEXT PRIMARY KEY, cin TEXT NOT NULL, form_data TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
  `);
  db.exec(AUDIT_FIRMS_DDL);
  return db;
}

const addJob = (db, id, payload, { formType = 'aoc4', clientName = NAME, result = null } = {}) =>
  db.prepare('INSERT INTO extension_jobs (id, form_type, client_id, client_name, payload, result) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, formType, `${(payload.general?.CIN || CIN).toLowerCase()}_31032026`, clientName, JSON.stringify(payload), result);

// Fake route ctx.
function sendJson(res, status, data) { res.status = status; res.json = data; }
const parseJsonBody = req => new Promise((resolve, reject) => {
  let b = '';
  req.on('data', c => { b += c; });
  req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { reject(new Error('Invalid JSON format')); } });
});
async function call(db, method, pathname, body, extra = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  const res = {};
  const handled = await handle(req, res, { pathname, method, db, sendJson, parseJsonBody, filesureResolve: null, ...extra });
  return { handled, ...res };
}

const pair = (current, previous = 0) => ({ current, previous });
function scan(over = {}) {
  return {
    general: { CIN: '', COMPANY_NAME: 'Dummy-Test Pvt. Ltd.', FY_TO: '31/03/2026' },
    auditor: {
      ADT_SRN: '', AUDITOR_PAN: '', AUDITOR_FIRM_REG: FRN, AUDITOR_NAME: 'Test & Co',
      AUDITOR_ADDR1: '1 Test Building', AUDITOR_ADDR2: 'Sample Road', AUDITOR_AREA: 'Sample  road.',
      AUDITOR_CITY: 'Bangalore', AUDITOR_DISTRICT: '', AUDITOR_PIN: '560001',
    },
    subsidiary: { IS_SUBSIDIARY: 'No', HAS_SUBSIDIARY_OR_JV: '' },
    relatedParty: { ANY_TRANSACTION: '' },
    industry: { CONSOLIDATED_FS: 'No' },
    balanceSheet: {
      current: { LONG_TERM_BORROWINGS: 500000, SHORT_TERM_BORROWINGS: 0, TRADE_RECEIVABLES: 200000, LONG_TERM_LOANS_ADVANCES: 0, NON_CURRENT_INVESTMENTS: 0 },
      previous: { LONG_TERM_BORROWINGS: 400000, SHORT_TERM_BORROWINGS: 0, TRADE_RECEIVABLES: 100000, LONG_TERM_LOANS_ADVANCES: 0, NON_CURRENT_INVESTMENTS: 0 },
    },
    balanceSheetBreakup: {
      BS_UNSEC_LT_RELATED_PARTIES: pair(500000, 400000),
      BS_UNSEC_LT_OTHER_ADVANCES: pair(500000, 400000),
      BS_TRADE_RECEIVABLES_UNSECURED_GOOD: pair(200000, 100000),
    },
    profitLoss: { current: { MANAGERIAL_REMUNERATION: 0 }, previous: { MANAGERIAL_REMUNERATION: 0 } },
    profitLossDetails: { PL_MANAGERIAL_REMUNERATION: pair(0, 0), PL_EMPLOYEE_BENEFITS: pair(900000, 800000) },
    financialParametersBS: { FP_BS_22: 0, FP_BS_17: 0 },
    financialParametersPL: { FP_PL_RELATED_PARTY_GROSS: 0 },
    principalProducts: { CATEGORY_CODE: '', CATEGORY_DESC: '' },
    relatedPartyTransactions: [
      { name: 'Director One', relationship: 'Director', nature: 'Loan received', current: 100000, previous: 400000 },
      { name: 'Director One', relationship: 'Director', nature: 'Salary', current: 240000, previous: 0 },
      { name: 'Director One', relationship: 'Director', nature: 'Loan from director (closing balance)', current: 500000, previous: 400000 },
    ],
    ...over,
  };
}

test('company names compare across Pvt Ltd / Private Limited and punctuation', () => {
  assert.equal(normaliseCompanyName('Dummy-Test Pvt. Ltd.'), normaliseCompanyName('DUMMY TEST PRIVATE LIMITED'));
  assert.notEqual(normaliseCompanyName('Dummy Test Pvt Ltd'), normaliseCompanyName('Dummy Tests Pvt Ltd'));
});

test('duplicate break-up: amount in related parties and other advances, group over by it -> generic line cleared', () => {
  const data = scan();
  const ctx = { tol: 1, derived: [], uncertain: [], notes: [], sticky: [], fresh: [], sources: {} };
  balanceBreakups(data, ctx);
  assert.deepEqual(data.balanceSheetBreakup.BS_UNSEC_LT_OTHER_ADVANCES, { current: 0, previous: 0 });
  assert.deepEqual(data.balanceSheetBreakup.BS_UNSEC_LT_RELATED_PARTIES, { current: 500000, previous: 400000 });
  assert.ok(ctx.derived.includes('balanceSheetBreakup.BS_UNSEC_LT_OTHER_ADVANCES.current'));
  assert.equal(ctx.sources['balanceSheetBreakup.BS_UNSEC_LT_OTHER_ADVANCES.previous'], 'derived');
  assert.deepEqual(ctx.sticky.map(c => c.id).sort(), ['breakup-duplicate:lt-borrowings:current', 'breakup-duplicate:lt-borrowings:previous']);
  assert.equal(ctx.fresh.length, 0);
});

test('break-up that does not add up is a check item, not changed', () => {
  const data = scan();
  data.balanceSheetBreakup.BS_UNSEC_LT_OTHER_ADVANCES = pair(120000, 0);   // not a duplicate
  data.balanceSheetBreakup.BS_TRADE_RECEIVABLES_UNSECURED_GOOD = pair(150000, 100000);
  const ctx = { tol: 1, derived: [], uncertain: [], notes: [], sticky: [], fresh: [], sources: {} };
  balanceBreakups(data, ctx);
  assert.equal(data.balanceSheetBreakup.BS_UNSEC_LT_OTHER_ADVANCES.current, 120000);
  const ids = ctx.fresh.map(c => c.id);
  assert.ok(ids.includes('breakup-mismatch:lt-borrowings:current'));
  assert.ok(ids.includes('breakup-mismatch:trade-receivables:current'));
  assert.equal(ctx.fresh.find(c => c.id === 'breakup-mismatch:trade-receivables:current').level, 'warn');
  assert.equal(ctx.sticky.length, 0);
});

test('AS-18 gross = this year\'s transactions, closing balances not counted; filled only when empty', async () => {
  assert.equal(relatedPartyTotal(scan()), 340000);
  const out = await enrichAoc4(scan(), {}, {});
  assert.equal(out.data.financialParametersBS.FP_BS_22, 340000);
  assert.equal(out.data.financialParametersPL.FP_PL_RELATED_PARTY_GROSS, 340000);
  assert.equal(out.sources['financialParametersPL.FP_PL_RELATED_PARTY_GROSS'], 'derived');
  assert.equal(out.data.relatedParty.ANY_TRANSACTION, 'Yes');
  assert.equal(out.data.relatedPartyTransactions.length, 3, 'rows are kept');

  const kept = await enrichAoc4(scan({ financialParametersBS: { FP_BS_22: 12345 } }), {}, {});
  assert.equal(kept.data.financialParametersBS.FP_BS_22, 12345);
  assert.ok(kept.checks.some(c => c.id === 'as18-differs:FP_BS_22'));
});

test('PIN + city -> district', () => {
  assert.deepEqual(districtFromPin('560001', 'Bangalore'), { district: 'Bengaluru', certain: false });   // a PIN prefix is never certain
  assert.deepEqual(districtFromPin('600002', 'chennai'), { district: 'Chennai', certain: false });
  assert.deepEqual(districtFromPin('500001', 'Hyderabad'), { district: 'Hyderabad', certain: false });   // HQ city, PIN not certain
  assert.equal(districtFromPin('110001', 'New Delhi'), null);                                         // several districts
  assert.equal(districtFromPin('999999', 'Smalltown'), null);
  assert.deepEqual(districtFromPin('560001', 'Mysuru'), { district: 'Mysuru', certain: false });       // PIN and city disagree
});

test('CIN from company records (in-memory DB), ambiguous names give candidates', async () => {
  const db = memDb();
  db.prepare('INSERT INTO clients (id, cin, name) VALUES (?, ?, ?)').run('c1', CIN, NAME);
  assert.equal(resolveCinFromRecords(db, 'Dummy-Test Pvt. Ltd.').cin, CIN);
  const r = await call(db, 'POST', '/api/company/resolve-cin', { name: 'dummy test pvt ltd' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true, cin: CIN, source: 'company records', candidates: [{ name: NAME, cin: CIN }] });

  addJob(db, 'j1', { general: { CIN: CIN2, COMPANY_NAME: 'Dummy Test Private Ltd' } }, { clientName: 'Dummy Test Private Ltd' });
  const amb = await call(db, 'POST', '/api/company/resolve-cin', { name: NAME });
  assert.equal(amb.json.cin, null);
  assert.equal(amb.json.source, null);
  assert.deepEqual(amb.json.candidates.map(c => c.cin).sort(), [CIN, CIN2]);

  const none = await call(db, 'POST', '/api/company/resolve-cin', { name: 'Unknown Co Pvt Ltd' });
  assert.deepEqual(none.json, { ok: true, cin: null, source: null, candidates: [] });
  assert.equal((await call(db, 'POST', '/api/company/resolve-cin', {})).status, 400);
});

test('FileSure name search: only an exact name match is taken', async () => {
  const db = memDb();
  const fs1 = async () => ({ data: { results: [{ company_name: 'DUMMY TEST PRIVATE LIMITED', cin: CIN }, { company_name: 'Dummy Test Two Pvt Ltd', cin: CIN2 }] } });
  const r = await call(db, 'POST', '/api/company/resolve-cin', { name: 'Dummy Test Pvt Ltd' }, { filesureResolve: fs1 });
  assert.equal(r.json.cin, CIN);
  assert.equal(r.json.source, 'filesure');
  const failing = async () => { throw new Error('Gateway not configured'); };
  const r2 = await call(db, 'POST', '/api/company/resolve-cin', { name: 'Dummy Test Pvt Ltd' }, { filesureResolve: failing });
  assert.deepEqual(r2.json, { ok: true, cin: null, source: null, candidates: [] });
  assert.deepEqual(parseFilesureCandidates([{ name: 'X Pvt Ltd', CIN: CIN.toLowerCase() }]), [{ name: 'X Pvt Ltd', cin: CIN }]);
});

test('firm PAN remembered per FRN: PUT once, GET and enrich reuse it for another client', async () => {
  const db = memDb();
  assert.deepEqual((await call(db, 'GET', `/api/audit-firms/${FRN}`)).json, { ok: true, firm: null });
  assert.equal((await call(db, 'PUT', `/api/audit-firms/${FRN}`, { pan: 'BAD123' })).status, 400);
  const put = await call(db, 'PUT', `/api/audit-firms/${FRN.toLowerCase()}`, { pan: PAN.toLowerCase(), name: 'Test & Co' });
  assert.equal(put.status, 200);
  assert.deepEqual(put.json.firm, { frn: FRN, pan: PAN, name: 'Test & Co' });
  assert.deepEqual((await call(db, 'GET', `/api/audit-firms/${FRN}`)).json.firm, { frn: FRN, pan: PAN, name: 'Test & Co' });
  assert.equal(firmPanFromRecords(db, FRN).pan, PAN);

  const out = await enrichAoc4(scan({ general: { CIN: CIN2, COMPANY_NAME: 'Other Dummy Pvt Ltd' } }), {}, makeLookups(db, { filesureResolve: null }));
  assert.equal(out.data.auditor.AUDITOR_PAN, PAN);
  assert.equal(out.sources['auditor.AUDITOR_PAN'], 'records');
  assert.equal((await call(db, 'GET', '/api/audit-firms/%20')).status, 400);
});

test('firm PAN and ADT-1 SRN from an earlier AOC-4 job of the same firm; another firm\'s SRN is not used', () => {
  const db = memDb();
  addJob(db, 'old', { general: { CIN, COMPANY_NAME: NAME }, auditor: { AUDITOR_FIRM_REG: FRN, AUDITOR_PAN: PAN, ADT_SRN: SRN } });
  assert.deepEqual(firmPanFromRecords(db, FRN), { pan: PAN, name: '', from: 'an earlier AOC-4 filing' });
  assert.deepEqual(findAdtSrnInRecords(db, { cin: CIN, frn: FRN }), { srn: SRN, from: 'an earlier AOC-4 filing', uncertain: false });
  assert.equal(findAdtSrnInRecords(db, { cin: CIN, frn: '111111W' }), null);
  assert.equal(findAdtSrnInRecords(db, { cin: CIN2, frn: FRN }), null);
  db.prepare("INSERT INTO company_answers (cin, form_type, field_key, value) VALUES (?, 'aoc4', 'ADT_SRN', ?)").run(CIN2, 'AB1234567');
  assert.deepEqual(findAdtSrnInRecords(db, { cin: CIN2 }), { srn: 'AB1234567', from: 'company answers', uncertain: true });   // firm not compared
});

test('enrich: CIN, SRN, PAN from records; area, district, has-subsidiary, managerial check; idempotent', async () => {
  const db = memDb();
  db.prepare('INSERT INTO clients (id, cin, name) VALUES (?, ?, ?)').run('c1', CIN, NAME);
  addJob(db, 'old', { general: { CIN, COMPANY_NAME: NAME }, auditor: { AUDITOR_FIRM_REG: FRN, AUDITOR_PAN: PAN, ADT_SRN: SRN } });
  const lookups = makeLookups(db, { filesureResolve: null });
  const input = scan();
  const frozen = JSON.stringify(input);
  const out = await enrichAoc4(input, { unitMultiplier: 1, derived: [], uncertain: [], notes: '' }, lookups);
  assert.equal(JSON.stringify(input), frozen, 'input not modified');
  const d = out.data;
  assert.equal(d.general.CIN, CIN);
  assert.equal(d.auditor.ADT_SRN, SRN);
  assert.equal(d.auditor.AUDITOR_PAN, PAN);
  assert.equal(d.auditor.AUDITOR_AREA, '');
  assert.equal(d.auditor.AUDITOR_DISTRICT, 'Bengaluru');
  assert.equal(d.subsidiary.HAS_SUBSIDIARY_OR_JV, 'No');
  assert.ok(out.meta.uncertain.includes('subsidiary.HAS_SUBSIDIARY_OR_JV'));
  assert.equal(d.balanceSheetBreakup.BS_UNSEC_LT_OTHER_ADVANCES.current, 0);
  assert.deepEqual(out.sources, {
    'general.CIN': 'records',
    'balanceSheetBreakup.BS_UNSEC_LT_OTHER_ADVANCES.current': 'derived',
    'balanceSheetBreakup.BS_UNSEC_LT_OTHER_ADVANCES.previous': 'derived',
    'financialParametersBS.FP_BS_22': 'derived',
    'financialParametersPL.FP_PL_RELATED_PARTY_GROSS': 'derived',
    'relatedParty.ANY_TRANSACTION': 'derived',
    'auditor.AUDITOR_AREA': 'derived',
    'auditor.ADT_SRN': 'records',
    'auditor.AUDITOR_PAN': 'records',
    'auditor.AUDITOR_DISTRICT': 'derived',
    'subsidiary.HAS_SUBSIDIARY_OR_JV': 'derived',
  });
  const mgr = out.checks.find(c => c.id === 'managerial:current');
  assert.deepEqual(mgr.action, { type: 'managerial-remuneration', per: 'current', amount: 240000 });
  assert.equal(d.profitLossDetails.PL_MANAGERIAL_REMUNERATION.current, 0, 'never auto-changed');
  assert.ok(!out.checks.some(c => c.id === 'managerial:previous'), 'no salary last year');
  for (const c of out.checks) {
    assert.ok(c.id && ['warn', 'info'].includes(c.level) && typeof c.message === 'string' && Array.isArray(c.paths), c.id);
  }

  const again = await enrichAoc4(out.data, out.meta, lookups);
  assert.deepEqual(again.data, out.data);
  assert.deepEqual(again.meta, out.meta);
  assert.deepEqual(again.sources, out.sources);
  assert.deepEqual(again.checks, out.checks);

  const dismissed = await enrichAoc4(out.data, { ...out.meta, resolvedChecks: ['managerial:current'] }, lookups);
  assert.ok(!dismissed.checks.some(c => c.id === 'managerial:current'));
});

test('enrich without records: nothing invented, everything missing becomes a check', async () => {
  const data = scan({ relatedPartyTransactions: [], balanceSheet: { current: { NON_CURRENT_INVESTMENTS: 50000 } } });
  data.auditor.AUDITOR_PIN = '';
  data.auditor.AUDITOR_CITY = 'Smalltown';
  const out = await enrichAoc4(data, {}, {});
  assert.equal(out.data.general.CIN, '');
  assert.equal(out.data.auditor.ADT_SRN, '');
  assert.equal(out.data.auditor.AUDITOR_PAN, '');
  assert.equal(out.data.auditor.AUDITOR_DISTRICT, '');
  assert.equal(out.data.subsidiary.HAS_SUBSIDIARY_OR_JV, '');
  assert.equal(out.data.financialParametersBS.FP_BS_22, 0);
  const ids = out.checks.map(c => c.id);
  for (const id of ['cin-missing', 'adt-srn-missing', 'auditor-pan-missing', 'district-missing', 'has-subsidiary']) assert.ok(ids.includes(id), id);
});

test('NPCS: a valid category code gets the official description', async () => {
  const out = await enrichAoc4({ principalProducts: { CATEGORY_CODE: '9983', CATEGORY_DESC: 'consulting text from the notes' } }, {}, {});
  assert.equal(out.data.principalProducts.CATEGORY_DESC, 'Other professional, technical and business services');
  assert.equal(out.sources['principalProducts.CATEGORY_DESC'], 'derived');
});

test('scan route: wrong formType 400, AOC-4 enrich answers the contract shape', async () => {
  const db = memDb();
  assert.equal((await call(db, 'POST', '/api/scan/enrich', { formType: 'MGT-7', data: {} })).status, 400);
  assert.equal((await call(db, 'POST', '/api/scan/enrich', { formType: 'AOC-4' })).status, 400);
  const r = await call(db, 'POST', '/api/scan/enrich', { formType: 'AOC-4', data: scan(), meta: { derived: [] } });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  for (const k of ['data', 'meta', 'sources', 'checks']) assert.ok(k in r.json, k);
  assert.equal((await call(db, 'GET', '/api/scan/enrich')).status, 405);
  assert.equal((await call(db, 'GET', '/api/other')).handled, false);
});

test('scan-time: related-party rows are scaled to rupees and the break-up duplicate is removed in reconcile', () => {
  const raw = {
    meta: { unitMultiplier: 100, sourceUnit: 'Rupees Hundred', partsRead: [] },
    balanceSheet: {
      current: { LONG_TERM_BORROWINGS: 5000, TRADE_RECEIVABLES: 0 },
      previous: { LONG_TERM_BORROWINGS: 4000, TRADE_RECEIVABLES: 0 },
    },
    balanceSheetBreakup: { BS_UNSEC_LT_RELATED_PARTIES: pair(5000, 4000), BS_UNSEC_LT_OTHER_ADVANCES: pair(5000, 4000) },
    financialParametersBS: { FP_BS_22: 0 },
    financialParametersPL: { FP_PL_RELATED_PARTY_GROSS: 0 },
    relatedPartyTransactions: [
      { name: 'Director One', relationship: 'Director', nature: 'Salary', current: '1,200.5', previous: 900 },
      { name: '', relationship: '', nature: '', current: 0, previous: 0 },
    ],
  };
  const out = postProcessAoc4(raw);
  assert.deepEqual(out.relatedPartyTransactions, [{ name: 'Director One', relationship: 'Director', nature: 'Salary', current: 120050, previous: 90000 }]);
  assert.equal(out.financialParametersBS.FP_BS_22, 120050);
  assert.equal(out.financialParametersPL.FP_PL_RELATED_PARTY_GROSS, 120050);
  assert.deepEqual(out.balanceSheetBreakup.BS_UNSEC_LT_OTHER_ADVANCES, { current: 0, previous: 0 });
  assert.ok(out.meta.ruleChecks.some(c => c.id === 'breakup-duplicate:lt-borrowings:current'));
  assert.equal(out.meta.enrichSources['financialParametersBS.FP_BS_22'], 'derived');
});

// ─── Fixes after review (made-up data) ──────────────────────────────────────

test('depreciation: note total within one printed unit replaces the rounded P&L figure; totals follow; idempotent', async () => {
  const raw = {
    meta: { unitMultiplier: 100, sourceUnit: 'Rupees Hundred', partsRead: [] },
    profitLoss: {
      current: { DEPRECIATION: 50, TOTAL_EXPENSES: 1000, PROFIT_BEFORE_TAX: -100, PROFIT_AFTER_TAX: -100 },
      previous: { DEPRECIATION: 74, TOTAL_EXPENSES: 900, PROFIT_BEFORE_TAX: -50, PROFIT_AFTER_TAX: -50 },
    },
    profitLossDetails: { PL_DEPRECIATION: pair(50, 74) },
    depreciationNote: { current: 50, previous: 73 },
  };
  const out = postProcessAoc4(raw);
  const p = out.profitLoss.previous;
  assert.equal(p.DEPRECIATION, 7300);
  assert.equal(p.TOTAL_EXPENSES, 89900);
  assert.equal(p.PROFIT_BEFORE_TAX, -4900);
  assert.equal(p.PROFIT_AFTER_TAX, -4900);
  assert.equal(out.profitLossDetails.PL_DEPRECIATION.previous, 7300);
  assert.equal(out.profitLoss.current.DEPRECIATION, 5000, 'equal figures untouched');
  assert.ok(out.meta.derived.includes('profitLoss.previous.DEPRECIATION'));
  assert.ok(out.meta.ruleChecks.some(c => c.id === 'depreciation-note:previous'));
  // enrich again: nothing more changes
  const again = await enrichAoc4(out, out.meta, {});
  assert.equal(again.data.profitLoss.previous.DEPRECIATION, 7300);
  assert.equal(again.data.profitLoss.previous.TOTAL_EXPENSES, 89900);
  // a gap larger than one unit is only a check
  const far = await enrichAoc4({ profitLoss: { current: { DEPRECIATION: 5000, TOTAL_EXPENSES: 9000 } }, depreciationNote: { current: 7000, previous: null } }, { unitMultiplier: 100 }, {});
  assert.equal(far.data.profitLoss.current.DEPRECIATION, 5000);
  assert.ok(far.checks.some(c => c.id === 'depreciation-note:current' && c.level === 'warn'));
});

test('related-party skeleton row is dropped and is no subsidiary evidence', async () => {
  const raw = {
    meta: { unitMultiplier: 1, partsRead: [] },
    relatedPartyTransactions: [{
      name: 'related party', relationship: 'Director | KMP | relative of KMP | holding company | subsidiary | associate | joint venture | other',
      nature: 'e.g. remuneration, loan received', current: 0, previous: 0,
    }],
  };
  const out = postProcessAoc4(raw);
  assert.deepEqual(out.relatedPartyTransactions, []);
  const e = await enrichAoc4({ relatedPartyTransactions: raw.relatedPartyTransactions }, {}, {});
  assert.equal(e.data.subsidiary.HAS_SUBSIDIARY_OR_JV, 'No');
  assert.ok(!e.checks.some(c => c.id === 'has-subsidiary' && c.level === 'warn'));
});

test('AS-18: transactions exist but no rows and gross 0 -> a warn check, nothing filled', async () => {
  const e = await enrichAoc4({
    relatedParty: { ANY_TRANSACTION: 'Yes' },
    financialParametersBS: { FP_BS_22: 0 }, financialParametersPL: { FP_PL_RELATED_PARTY_GROSS: 0 },
  }, {}, {});
  const c = e.checks.find(x => x.id === 'as18-missing');
  assert.ok(c);
  assert.deepEqual(c.paths, ['financialParametersBS.FP_BS_22', 'financialParametersPL.FP_PL_RELATED_PARTY_GROSS']);
  assert.equal(e.data.financialParametersBS.FP_BS_22, 0);
});

test('district from a PIN prefix is always "to check"', async () => {
  const e = await enrichAoc4({ auditor: { AUDITOR_PIN: '560001', AUDITOR_CITY: 'Bengaluru' } }, {}, {});
  assert.equal(e.data.auditor.AUDITOR_DISTRICT, 'Bengaluru');
  assert.ok(e.meta.uncertain.includes('auditor.AUDITOR_DISTRICT'));
  assert.ok(e.checks.some(c => c.id === 'district-guess'));
});

test('managerial check only when employee benefits can hold the amount (same limit as the Yes action)', async () => {
  const base = amt => ({
    relatedPartyTransactions: [{ name: 'Director One', relationship: 'Director', nature: 'Salary', current: 1000, previous: 0 }],
    profitLossDetails: { PL_EMPLOYEE_BENEFITS: pair(amt), PL_MANAGERIAL_REMUNERATION: pair(0) },
  });
  assert.ok(!(await enrichAoc4(base(950), { unitMultiplier: 100 }, {})).checks.some(c => c.id === 'managerial:current'));
  assert.ok((await enrichAoc4(base(1000), { unitMultiplier: 100 }, {})).checks.some(c => c.id === 'managerial:current'));
});

test('break-up duplicate needs the very same amount; printed precision narrows the tolerance', async () => {
  const d = {
    balanceSheet: { current: { LONG_TERM_BORROWINGS: 1000000 } },
    balanceSheetBreakup: { BS_UNSEC_LT_RELATED_PARTIES: pair(1000000), BS_UNSEC_LT_OTHER_ADVANCES: pair(950000) },
  };
  const e = await enrichAoc4(d, { unitMultiplier: 100000 }, {});
  assert.equal(e.data.balanceSheetBreakup.BS_UNSEC_LT_OTHER_ADVANCES.current, 950000, 'close is not the same');
  assert.ok(e.checks.some(c => c.id === 'breakup-mismatch:lt-borrowings:current'));
  const raw = { meta: { unitMultiplier: 100000, partsRead: [] }, balanceSheet: { current: { CASH: '12.34' }, previous: { CASH: 10 } } };
  assert.equal(postProcessAoc4(raw).meta.printedPrecision, 1000);
});

test('PBT rounding change is noted', () => {
  const raw = {
    meta: { unitMultiplier: 100, partsRead: [] },
    profitLoss: { current: { PROFIT_BEFORE_TAX: 11, PROFIT_AFTER_TAX: 11, TOTAL_EXPENSES: 0 }, previous: {} },
    profitLossDetails: { PL_DOMESTIC_SERVICES: pair(10), PL_OTHER_EXPENSES: pair(0) },
  };
  const out = postProcessAoc4(raw);
  assert.equal(out.profitLoss.current.PROFIT_BEFORE_TAX, 1000);
  assert.match(out.meta.notes, /Profit before tax \(current year\) printed as/);
});

test('ADT-1 SRN: drafts are never used, ADT-3 jobs ignored, ADT-1 job of another firm skipped', () => {
  const db = memDb();
  db.prepare('INSERT INTO adt1_drafts (id, cin, form_data) VALUES (?, ?, ?)').run('d1', CIN, JSON.stringify({ auditorName: 'X', inc28Srn: 'R12345678' }));
  assert.equal(findAdtSrnInRecords(db, { cin: CIN, frn: FRN }), null);
  addJob(db, 'a3', { cin: CIN, firmRegistrationNumber: FRN }, { formType: 'ADT-3', result: JSON.stringify({ srn: 'G11111111' }) });
  assert.equal(findAdtSrnInRecords(db, { cin: CIN, frn: FRN }), null);
  addJob(db, 'a1', { cin: CIN, firmRegistrationNumber: '111111W' }, { formType: 'ADT-1', result: JSON.stringify({ srn: 'G22222222' }) });
  assert.equal(findAdtSrnInRecords(db, { cin: CIN, frn: FRN }), null);
  addJob(db, 'a1b', { cin: CIN, firmRegistrationNumber: FRN, vacatedFirmRegNumber: '111111W' }, { formType: 'ADT-1', result: JSON.stringify({ srn: 'G33333333' }) });
  assert.deepEqual(findAdtSrnInRecords(db, { cin: CIN, frn: FRN }), { srn: 'G33333333', from: 'the ADT-1 filing', uncertain: false });
});

test('audit firm PUT: cross-site origin refused, FRN must be in ICAI format', async () => {
  const db = memDb();
  const put = (frn, origin) => {
    const req = Readable.from([Buffer.from(JSON.stringify({ pan: PAN }))]);
    req.headers = origin ? { origin } : {};
    const res = {};
    return handle(req, res, { pathname: `/api/audit-firms/${frn}`, method: 'PUT', db, sendJson, parseJsonBody, filesureResolve: null }).then(() => res);
  };
  assert.equal((await put(FRN, 'https://evil.example')).status, 403);
  assert.equal((await put(FRN, 'http://localhost:5173')).status, 200);
  assert.equal((await put('ABCD', undefined)).status, 400);
  assert.equal(firmPanFromRecords(db, FRN).pan, PAN);
});
