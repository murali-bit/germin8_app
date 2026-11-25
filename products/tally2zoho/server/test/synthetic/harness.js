// Runs one synthetic test company (server/fixtures/synthetic/cNN_*.js) through the REAL app, in-process, the way a user
// would: a temporary data folder, a seed user logged in, a migration with the company's financial year and GSTIN, the
// three Tally files uploaded as TallyPrime 7.1 saves them (UTF-16 LE with a byte order mark), processing, the tool's
// default contact fix and voucher settings (as scripts/real-run.mjs does), file generation, the set-up ticks of the
// Import Wizard, generation again, and then everything the tool reports is read back.
//
// Nothing here knows a company: it reads what the company module exports. Nothing in server/data is touched.
// Usage: const run = await runCompany(companyModule); run.files.invoices.rows, run.zohoCheck, run.recon ...
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// the data folder must be set before the app module is loaded (it opens its database when it is imported)
if (!process.env.DATA_DIR || !process.env.DATA_DIR.includes('mig-synthetic-')) process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-synthetic-'));
const { buildApp } = await import('../../src/index.js');
const { parseCsvTable } = await import('../../src/zohocheck.js');
const { utf16le } = await import('../../fixtures/synthetic/lib.js');
const { CATALOGUE } = await import('../../src/catalogue.js');
const { DESTINATIONS } = await import('../../src/voucherrecon.js');
const DEST_BY_LABEL = Object.fromEntries(DESTINATIONS.map(d => [d.label, d]));

// The seed users: the real file when it is there (it is kept out of git), else the example file.
const seedPath = [path.resolve(here, '../../seed-users.json'), path.resolve(here, '../../seed-users.example.json')].find(p => fs.existsSync(p));
const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

let app = null;
let cookie = '';
async function ready() {
  if (app) return;
  app = buildApp();
  await app.ready();
  const u = seed.users.find(x => x.role === 'analyst') || seed.users.find(x => x.role === 'admin') || seed.users[0];
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: u.password } });
  if (r.statusCode !== 200) throw new Error(`login as the seed ${u.role} failed: ${r.statusCode}`);
  cookie = String(r.headers['set-cookie']).split(';')[0];
}
export async function closeApp() { if (app) { await app.close(); app = null; } }

const call = o => app.inject({ ...o, headers: { ...(o.headers || {}), cookie } });
const json = r => { try { return r.json(); } catch { return r.body; } };

// CSV text -> { headers, rows: [{ heading: value }] } (cells exactly as written)
export function readCsv(text) {
  const t = parseCsvTable(String(text));
  const headers = t[0] || [];
  return { headers, rows: t.slice(1).map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? '']))) };
}

// company: a module of server/fixtures/synthetic (profile, masters(), transactions(), trialBalance(), expect).
// Returns every step's status and everything the tool reported.
// choices: { businessType: 'goods' | 'services' } decisions an accountant would make in Mapping Studio; none by default.
export async function runCompany(company, { keepFiles = false, choices = {} } = {}) {
  await ready();
  const p = company.profile;
  const steps = [];
  const step = (name, r, ok = [200, 201]) => { steps.push({ name, status: r.statusCode, ...(ok.includes(r.statusCode) ? {} : { body: String(r.body).slice(0, 600) }) }); return r; };

  const created = step('create migration', await call({ method: 'POST', url: '/api/migrations', payload: { company: p.name, financialYear: p.fy, gstin: p.gstin } }));
  if (created.statusCode !== 201) return { steps, failed: 'create migration' };
  const id = created.json().id;
  const base = `/api/migrations/${id}`;
  const upload = (slot, obj, file) => call({ method: 'PUT', url: `${base}/uploads/${slot}`, headers: { 'content-type': 'application/octet-stream', 'x-filename': file }, payload: utf16le(obj) });
  const uploads = {};
  for (const [slot, obj, file] of [['all_masters', company.masters(), 'Master.json'], ['all_transactions', company.transactions(), 'Transactions.json'], ['trial_balance', company.trialBalance(), 'TrialBal.json']]) {
    const r = step(`upload ${file}`, await upload(slot, obj, file));
    uploads[slot] = json(r);
  }
  // a conditional dataset the files did not fill (for example the Stock Summary) is confirmed as not needed, with a reason
  const before = json(await call({ url: `${base}/completeness` }));
  const waived = [];
  for (const s of before?.awaitingConfirmation || []) {
    const label = typeof s === 'string' ? s : s.key || s.slot || s.name;
    const key = CATALOGUE.find(c => c.key === label || c.name === label)?.key || label;
    step(`waiver ${key}`, await call({ method: 'PUT', url: `${base}/waivers/${key}`, payload: { reason: 'Synthetic test company: this dataset is not exported (test harness default)' } }));
    waived.push(key);
  }
  const processed = step('process', await call({ method: 'POST', url: `${base}/process?wait=1` }));
  if (processed.statusCode !== 200) return { id, steps, uploads, failed: 'process', completeness: before };
  // the tool's default contact fix: "registered in Tally without a GSTIN" treated as unregistered (two-step confirmation)
  let r = await call({ method: 'POST', url: `${base}/contact-fixes/unregistered-without-gstin`, payload: { confirmCount: 0 } });
  if (r.statusCode === 409 && json(r)?.count != null) r = await call({ method: 'POST', url: `${base}/contact-fixes/unregistered-without-gstin`, payload: { confirmCount: json(r).count } });
  step('contact fix: registered without GSTIN = unregistered', r);
  // the HSN/SAC field: on for a company registered for GST (as a new India organisation has it); off for a company with no
  // GSTIN, which is what the tool itself assumes for it (vouchers.js hsnFieldOn) and what an accountant answers
  step('voucher settings', await call({ method: 'PUT', url: `${base}/voucher-settings`, payload: { hsnEnabled: p.gstin ? 'on' : 'off', hsnMinDigits: '6' } }));
  // choices an accountant makes on top of the defaults (only when the caller asks for them): the business type
  if (choices.businessType) step(`business type ${choices.businessType}`, await call({ method: 'PUT', url: `${base}/business-type`, payload: { businessType: choices.businessType } }));
  // corrections the accountant enters in Voucher Classification (round 2): [{ number, date } | { number, ledger, exported, amount }]
  if (choices.corrections?.length) {
    const list = json(await call({ url: `${base}/voucher-corrections` })).vouchers;
    for (const c of choices.corrections) {
      const v = list.find(x => x.number === c.number);
      if (!v) { steps.push({ name: `correction ${c.number}`, status: 404, body: 'not in the list of correctable vouchers' }); continue; }
      step(`correction ${c.number}`, await call({ method: 'PUT', url: `${base}/voucher-corrections/${v.id}`, payload: c.date ? { kind: 'date', date: c.date } : { kind: 'amount', ledger: c.ledger, exported: c.exported, amount: c.amount } }));
    }
  }
  step('generate', await call({ method: 'POST', url: `${base}/generate` }));
  // the set-up ticks of the Import Wizard (what must exist in Zoho Books first), as real-run.mjs does
  const wz = json(await call({ url: `${base}/import-wizard` }));
  let ticked = 0;
  for (const i of (wz?.steps || []).find(s => s.kind === 'setup')?.items || []) {
    for (const t of i.ticks || []) { await call({ method: 'PUT', url: `${base}/import-wizard/ticks`, payload: { step: 'setup', item: t.id, done: true } }); ticked++; }
  }
  const generated = step('generate again', await call({ method: 'POST', url: `${base}/generate` }));
  const gen = json(generated);

  const get = async (p2, name = p2) => { const x = await call({ url: `${base}/${p2}` }); step(`read ${name}`, x); return json(x); };
  const summary = await get('summary');
  const fileList = await get('files');
  const files = {};
  for (const f of Array.isArray(fileList) ? fileList : []) {
    const x = await call({ url: `${base}/files/${f.key}/download?confirmed=1` });
    step(`download ${f.key}`, x);
    const text = x.statusCode === 200 ? x.body : '';
    files[f.key] = { fileName: f.fileName, rowsListed: f.rows, text: keepFiles ? text : undefined, ...readCsv(text) };
  }
  const zohoCheck = await get('zoho-check');
  const findingsText = (await call({ url: `${base}/zoho-check/findings.csv` })).body;
  const findings = readCsv(findingsText).rows;
  const control = (await get('voucher-control'))?.control;
  const recon = await get('voucher-reconciliation');
  // every voucher, where it went (paged)
  const vouchers = [];
  for (let page = 1; ; page++) {
    const v = json(await call({ url: `${base}/voucher-reconciliation/vouchers?slot=all&bucket=all&pageSize=200&page=${page}` }));
    if (!v?.vouchers) break;
    // dest: the destination key (written:invoices, left_out, no_file ...) and file: the Zoho file key it was written to
    vouchers.push(...v.vouchers.map(x => { const d = DEST_BY_LABEL[x.went]; return { ...x, dest: d?.key || x.went, fileKey: d?.outcome === 'written' ? d.file : null }; }));
    if (page >= v.pages) break;
  }
  const predicted = await get('predicted-trial-balance');
  const trialBalance = await get('trial-balance');
  const assumptions = await get('assumptions');
  const exceptions = summary?.exceptions || [];
  return { id, steps, uploads, waived, ticked, processResult: json(processed), generate: gen, summary, exceptions, fileList, files, zohoCheck, findings, control, recon, vouchers,
    predicted, trialBalance, assumptions,
    failedSteps: steps.filter(s => s.body) };
}

// ---------- readers over a run, for the tests ----------
// The flagged items that mention a name (or a voucher number) in their name or message.
export const flagsAbout = (run, re) => run.exceptions.filter(e => re.test(String(e.name || '')) || re.test(String(e.message || '')));
// The Zoho check findings that say Zoho will refuse the row.
export const refusedFindings = run => run.findings.filter(f => /^refuse the row$/.test(f['Zoho is expected to'] || ''));
// The number written in a Zoho file per voucher: { voucher number -> [file module] }
export function whereWritten(run) {
  const m = new Map();
  for (const v of run.vouchers) { if (!m.has(v.number)) m.set(v.number, []); m.get(v.number).push(v); }
  return m;
}
// Each journal of a journals file balances (debits = credits, per Journal Number).
export function journalBalances(file) {
  const by = new Map();
  for (const r of file?.rows || []) {
    const k = r['Journal Number Suffix'] != null ? `${r['Journal Number Prefix'] || ''}${r['Journal Number Suffix']}` : r['Journal Number'] || r['Reference Number'];
    const d = Number(String(r.Debit || '0').replace(/,/g, '')) || 0, c = Number(String(r.Credit || '0').replace(/,/g, '')) || 0;
    if (!by.has(k)) by.set(k, { journal: k, debit: 0, credit: 0, rows: 0 });
    const x = by.get(k); x.debit += Math.round(d * 100); x.credit += Math.round(c * 100); x.rows++;
  }
  return [...by.values()];
}

// A request to the app as the logged-in seed user (S4: for the negative invariant tests and uploads of odd files).
export async function request(o) { await ready(); return call(o); }
// The path of the app's database in the temporary data folder (S4: the negative tests change a stored row on purpose).
export const databasePath = () => path.join(process.env.DATA_DIR, 'migration.db');
