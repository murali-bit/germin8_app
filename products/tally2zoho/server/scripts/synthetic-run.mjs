// Runs one synthetic test company through the tool in-process and prints what it produced (counts, flagged kinds,
// Zoho check, voucher control, predicted trial balance). Nothing in server/data is touched (a temporary data folder).
// Usage: node scripts/synthetic-run.mjs c01_services_gst [--json out.json] [--goods]
//   --goods: also choose the business type "goods" (what an accountant does for a trading or manufacturing company)
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const [name] = args;
const out = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const choices = args.includes('--goods') ? { businessType: 'goods' } : {};
if (!name) { console.error('usage: node scripts/synthetic-run.mjs <company module, e.g. c01_services_gst> [--json out.json]'); process.exit(2); }
const company = await import(pathToFileURL(path.join(here, '..', 'fixtures', 'synthetic', name.endsWith('.js') ? name : `${name}.js`)).href);
const { runCompany, closeApp, refusedFindings, journalBalances } = await import(pathToFileURL(path.join(here, '..', 'test', 'synthetic', 'harness.js')).href);
const run = await runCompany(company, { choices });
const kinds = {};
for (const e of run.exceptions) kinds[`${e.stage}:${e.kind || '(no kind)'}`] = (kinds[`${e.stage}:${e.kind || '(no kind)'}`] || 0) + 1;
console.log('steps not ok:', JSON.stringify(run.failedSteps, null, 1));
console.log('waived:', run.waived, 'ticked:', run.ticked);
console.log('control:', JSON.stringify(run.control));
console.log('files:', Object.fromEntries(Object.entries(run.files).map(([k, f]) => [k, f.rows.length])));
console.log('flagged kinds:', JSON.stringify(kinds, null, 1));
console.log('zoho check overall:', JSON.stringify(run.zohoCheck?.overall));
console.log('refused findings:', refusedFindings(run).map(f => `${f.File} | ${f.Record} | ${f.Rule} | ${f['What is wrong']}`.slice(0, 260)));
for (const k of ['journals', 'other_journals']) console.log(k, 'unbalanced:', journalBalances(run.files[k]).filter(j => j.debit !== j.credit));
const c = run.predicted?.comparison;
console.log('predicted agrees:', c?.agrees, JSON.stringify(c?.counts));
if (c) {
  for (const r of [...c.accounts.differing, ...c.accounts.onlyTally, ...c.accounts.onlyZoho]) console.log('  TB diff:', r.account, 'tally', JSON.stringify(r.tally), 'zoho', JSON.stringify(r.zoho), 'diff', JSON.stringify(r.difference), (r.sources || []).map(s => s.label).join(';').slice(0, 200));
  for (const side of ['customers', 'vendors']) for (const r of c.contacts[side].rows.filter(x => !x.ok && (x.difference || x.notInTally))) console.log('  contact diff:', side, r.contact, JSON.stringify(r.tally), JSON.stringify(r.zoho), JSON.stringify(r.difference));
  for (const z of c.mustBeZero.filter(z => !z.ok)) console.log('  must be zero:', z.account, JSON.stringify(z.predicted));
}
console.log('predicted problem:', run.predicted?.problem, 'leftOut:', run.predicted?.leftOut);
console.log('vouchers:', run.vouchers.map(v => `${v.type} ${v.number}: ${v.went}${v.reason ? ' (' + v.reason + ')' : ''}`).join('\n  '));
if (out) fs.writeFileSync(out, JSON.stringify(run, null, 1));
await closeApp();
