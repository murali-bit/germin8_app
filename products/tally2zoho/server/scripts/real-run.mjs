// Runs the whole tool in-process on a set of Tally files and writes everything it produces to an output folder.
// Usage: node scripts/real-run.mjs <tally-folder> <output-folder>
//   <tally-folder> must hold Master.json, Transactions.json and TrialBal_ledgers.json (or TrialBal.json).
// The run uses a temporary data folder, so nothing in server/data is touched, and nothing in <tally-folder> is changed.
// It follows "variant B": the tool's defaults + "registered without GSTIN = unregistered" + the default wizard answers
// (reverse charge from a vendor with no GSTIN and no state: the tool's default, an import of services).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error('usage: node scripts/real-run.mjs <tally-folder> <output-folder>'); process.exit(2); }
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-run-'));
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const { buildApp } = await import(pathToFileURL(path.join(here, '..', 'src', 'index.js')).href);
const seed = JSON.parse(fs.readFileSync(path.join(here, '..', 'seed-users.json'), 'utf8'));

const app = buildApp();
await app.ready();
let cookie = '';
const call = o => app.inject({ ...o, headers: { ...(o.headers || {}), ...(cookie ? { cookie } : {}) } });
const u = seed.users.find(x => x.role === 'super_admin') || seed.users[0];
cookie = String((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: u.password } })).headers['set-cookie']).split(';')[0];
const created = (await call({ method: 'POST', url: '/api/migrations', payload: { company: 'Test company', financialYear: '2025-26' } })).json();
const id = created.id;
const base = `/api/migrations/${id}`;
const log = [];
const step = (name, r) => { log.push(`${name} ${r.statusCode}`); if (r.statusCode >= 400) log.push('   ' + String(r.body).slice(0, 300)); return r; };

const tb = fs.existsSync(path.join(src, 'TrialBal_ledgers.json')) ? 'TrialBal_ledgers.json' : 'TrialBal.json';
for (const [slot, file] of [['all_masters', 'Master.json'], ['all_transactions', 'Transactions.json'], ['trial_balance', tb]]) {
  if (!fs.existsSync(path.join(src, file))) continue;
  step('upload ' + file, await call({ method: 'PUT', url: `${base}/uploads/${slot}`, headers: { 'content-type': 'application/octet-stream', 'x-filename': file }, payload: fs.readFileSync(path.join(src, file)) }));
}
step('waiver', await call({ method: 'PUT', url: `${base}/waivers/stock_summary`, payload: { reason: 'Services business: no stock summary (default for this data)' } }));
step('process', await call({ method: 'POST', url: `${base}/process?wait=1` }));
let r = await call({ method: 'POST', url: `${base}/contact-fixes/unregistered-without-gstin`, payload: { confirmCount: 0 } });
if (r.statusCode === 409 && r.json().count != null) r = await call({ method: 'POST', url: `${base}/contact-fixes/unregistered-without-gstin`, payload: { confirmCount: r.json().count } });
step('unregistered-without-gstin', r);
step('voucher-settings', await call({ method: 'PUT', url: `${base}/voucher-settings`, payload: { hsnEnabled: 'on', hsnMinDigits: '6' } }));
step('generate', await call({ method: 'POST', url: `${base}/generate` }));
const wz = (await call({ url: `${base}/import-wizard` })).json();
const setup = (wz.steps || []).find(s => s.kind === 'setup');
let ticked = 0;
for (const i of setup?.items || []) for (const t of i.ticks || []) { await call({ method: 'PUT', url: `${base}/import-wizard/ticks`, payload: { step: 'setup', item: t.id, done: true } }); ticked++; }
log.push('setup ticks ' + ticked);

fs.mkdirSync(path.join(out, 'csv_files'), { recursive: true });
const W = (n, d) => fs.writeFileSync(path.join(out, n), typeof d === 'string' || Buffer.isBuffer(d) ? d : JSON.stringify(d, null, 1));
const J = async (name, p) => { const x = await call({ url: `${base}/${p}` }); log.push(`${name} ${x.statusCode}`); let j; try { j = x.json(); } catch { j = x.body; } W(name, x.statusCode === 200 ? j : { status: x.statusCode, body: j }); return j; };
const T = async (name, p) => { const x = await call({ url: `${base}/${p}` }); log.push(`${name} ${x.statusCode}`); W(name, x.rawPayload); return x; };
W('_generate.json', (await call({ method: 'POST', url: `${base}/generate` })).json());
const files = await J('_files.json', 'files');
for (const f of Array.isArray(files) ? files : []) { const x = await call({ url: `${base}/files/${f.key}/download?confirmed=1` }); fs.writeFileSync(path.join(out, 'csv_files', f.fileName), x.rawPayload); }
await T('zoho-import.zip', 'download-all?confirmed=1');
await J('_zoho_check.json', 'zoho-check');
await T('_zoho_check_findings.csv', 'zoho-check/findings.csv');
await J('_assumptions.json', 'assumptions');
await J('_completeness_table.json', 'completeness-table');
await J('_voucher_reconciliation.json', 'voucher-reconciliation');
await J('_tds_taxes_to_create.json', 'tds-taxes-to-create');
await J('_held_vouchers.json', 'held-vouchers');
for (const k of ['payments_received', 'payments_made', 'vendor_credits', 'credit_notes']) { const x = await call({ url: `${base}/held-vouchers/${k}.csv` }); if (x.statusCode === 200) fs.writeFileSync(path.join(out, 'csv_files', `not_in_any_file_${k}.csv`), x.rawPayload); }
await J('_credits_to_apply.json', 'credits-to-apply?limit=5000');
{ const x = await call({ url: `${base}/credits-to-apply.csv` }); if (x.statusCode === 200) fs.writeFileSync(path.join(out, 'csv_files', 'credits_to_apply.csv'), x.rawPayload); }
await J('_import_wizard.json', 'import-wizard');
await J('_summary.json', 'summary');
await J('_trial_balance.json', 'trial-balance');
await J('_predicted_trial_balance.json', 'predicted-trial-balance');
{ const x = await call({ url: `${base}/predicted-trial-balance.csv` }); if (x.statusCode === 200) fs.writeFileSync(path.join(out, 'csv_files', 'predicted_trial_balance.csv'), x.rawPayload); }
await J('_bank_opening_balances.json', 'bank-opening-balances');
await J('_report.json', 'report');
W('_run_log.txt', log.join('\n'));
console.log(log.join('\n'));
await app.close();
