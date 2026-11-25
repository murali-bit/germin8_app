// Large-file check. NOT part of "npm test". Run with:  npm run test:large -- --vouchers 200000
//
// Writes a large, realistic sales voucher file (and the small files the other datasets need) into a temporary
// folder, starts an instance of the app on a free local port with its own temporary DATA_DIR (the live database and
// the running servers are not touched), uploads everything over HTTP, processes it, and prints:
//   time taken, peak memory (process.memoryUsage().rss, sampled every 100 ms in the process that runs the app; the
//   large file is sent from a separate process, so the figure is the server's), and whether the server answered
//   /api/health while it was checking the upload and while it was processing.
// Options: --vouchers N (default 200000), --keep (do not delete the temporary folder afterwards).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

// The large file is sent by a separate process (this same script, started with --send), so that the memory figure
// below is the server's and not that of the program doing the sending.
if (process.argv.includes('--send')) {
  const [origin, cookie, id, slot, file] = process.argv.slice(process.argv.indexOf('--send') + 1);
  const r = await fetch(`${origin}/api/migrations/${id}/uploads/${slot}`, { method: 'PUT', duplex: 'half', body: fs.createReadStream(file),
    headers: { cookie, 'content-type': 'application/octet-stream', 'x-filename': path.basename(file) } });
  process.stdout.write(JSON.stringify({ status: r.status, json: await r.json() }));
  process.exit(0);
}

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const VOUCHERS = Math.max(1, Number(arg('vouchers', 200000)) || 200000);
const KEEP = process.argv.includes('--keep');
const here = path.dirname(fileURLToPath(import.meta.url));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-largefile-'));
process.env.DATA_DIR = path.join(work, 'data');
const filesDir = path.join(work, 'files');
fs.mkdirSync(filesDir);
const mb = n => `${(n / 1024 / 1024).toFixed(0)} MB`;
const secs = ms => `${(ms / 1000).toFixed(1)} s`;

// ---------- the test files ----------
const COMPANY = 'Large File Test Traders Pvt. Ltd.';
const envelope = [{ name: 'svExportFormat', value: 'jsonex' }, { name: 'svCurrentCompany', value: COMPANY }];
const guid = (p, i) => `9f8e7d6c-0000-4000-8000-${p}${String(i).padStart(10, '0')}`;
const ledger = (p, i, name, parent, extra = {}) => ({ metadata: { type: 'Ledger', name }, guid: guid(p, i), name, parent, ...extra });
const CUSTOMERS = Array.from({ length: 800 }, (_, i) => `Customer ${String(i + 1).padStart(4, '0')} Enterprises`);
const SALES_LEDGERS = ['Sales - Spares', 'Sales - Machines', 'Sales - Services', 'Freight Outward Recovered'];
const write = (name, records) => { const p = path.join(filesDir, name); fs.writeFileSync(p, JSON.stringify({ static_variables: envelope, tallymessage: records })); return p; };
const voucher = (type, i, party, entries) => ({ metadata: { type: 'Voucher', vchtype: type, action: 'Create' }, guid: guid(type[0].toLowerCase(), i), date: '20240615', vouchertypename: type,
  vouchernumber: `${type.slice(0, 2).toUpperCase()}/24-25/${i}`, partyledgername: party, narration: `${type} test voucher`, ledgerentries: entries });
const line = (ledgername, amount, party = false) => ({ ledgername, isdeemedpositive: Number(amount) < 0, ispartyledger: party, amount });

const small = {
  customers: write('customers.json', CUSTOMERS.map((n, i) => ledger('c', i, n, 'Sundry Debtors', { mailingname: n, partygstin: `27AAAAA${String(i).padStart(4, '0')}A1Z5`, ledstatename: 'Maharashtra', pincode: '400001', countryname: 'India',
    address: [{ metadata: true, type: 'String' }, `Plot ${i + 1}, Industrial Area`, 'Mumbai'], openingbalance: '-1000.00' }))),
  vendors: write('vendors.json', [ledger('v', 1, 'Vendor One Supplies', 'Sundry Creditors', { openingbalance: '500.00' })]),
  accounts: write('accounts.json', [...SALES_LEDGERS.map((n, i) => ledger('a', i, n, 'Sales Accounts')), ledger('a', 90, 'Purchase - Goods', 'Purchase Accounts'), ledger('a', 91, 'State Bank of India', 'Bank Accounts'), ledger('a', 92, 'Office Rent', 'Indirect Expenses')]),
  taxes: write('taxes.json', ['Output CGST', 'Output SGST', 'Output IGST'].map((n, i) => ledger('t', i, n, 'Duties & Taxes', { taxtype: 'GST' }))),
  purchase: write('purchase.json', [voucher('Purchase', 1, 'Vendor One Supplies', [line('Vendor One Supplies', '1000.00', true), line('Purchase - Goods', '-1000.00')])]),
  receipt: write('receipt.json', [voucher('Receipt', 1, CUSTOMERS[0], [line(CUSTOMERS[0], '500.00', true), line('State Bank of India', '-500.00')])]),
  payment: write('payment.json', [voucher('Payment', 1, 'Vendor One Supplies', [line('Vendor One Supplies', '-500.00', true), line('State Bank of India', '500.00')])]),
  journal: write('journal.json', [voucher('Journal', 1, '', [line('Office Rent', '-100.00'), line('State Bank of India', '100.00')])]),
  trial_balance: write('trial_balance.json', [{ metadata: { type: 'TrialBalanceLine' }, name: 'State Bank of India', closingbalance: '-100.00' }, { metadata: { type: 'TrialBalanceLine' }, name: 'Sales - Spares', closingbalance: '100.00' }]),
};

// The large file is written a piece at a time, so this script does not hold it in memory either.
async function writeSales(file, count) {
  const out = fs.createWriteStream(file);
  out.write(`{"static_variables":${JSON.stringify(envelope)},"tallymessage":[`);
  let rnd = 12345;
  const next = () => (rnd = (rnd * 1103515245 + 12345) % 2147483648);
  for (let i = 1; i <= count; i++) {
    const party = CUSTOMERS[next() % CUSTOMERS.length];
    const lines = 1 + (next() % 4);
    const entries = [];
    let base = 0;
    for (let k = 0; k < lines; k++) { const paise = 10000 + (next() % 5000000); base += paise; entries.push(line(SALES_LEDGERS[next() % SALES_LEDGERS.length], (paise / 100).toFixed(2))); }
    const interState = next() % 4 === 0;
    const half = Math.round(base * 0.09);
    if (interState) entries.push(line('Output IGST', ((half * 2) / 100).toFixed(2)));
    else entries.push(line('Output CGST', (half / 100).toFixed(2)), line('Output SGST', (half / 100).toFixed(2)));
    const v = voucher('Sales', i, party, [line(party, (-(base + half * 2) / 100).toFixed(2), true), ...entries]);
    v.date = `2024${String(4 + (i % 9)).padStart(2, '0')}${String(1 + (i % 28)).padStart(2, '0')}`;
    v.narration = `Being goods sold to ${party} against order ${next() % 100000}, delivery challan ${next() % 100000}. Terms: 30 days.`;
    // fields a real export carries that the platform does not read
    Object.assign(v, { reference: `PO-${next() % 1000000}`, effectivedate: v.date, persistedview: 'Accounting Voucher View', vchentrymode: 'As Voucher', isinvoice: true, basicbuyername: party, placeofsupply: interState ? 'Gujarat' : 'Maharashtra',
      consigneestatename: interState ? 'Gujarat' : 'Maharashtra', enteredby: 'accounts', alterid: i, masterid: i, voucherkey: 190000000000 + i });
    if (!out.write(`${i > 1 ? ',' : ''}\n${JSON.stringify(v)}`)) await once(out, 'drain');
  }
  out.end('\n]}\n');
  await once(out, 'close');
  return fs.statSync(file).size;
}

// ---------- measuring ----------
let peak = 0, phasePeak = 0;
const sample = () => { const rss = process.memoryUsage().rss; if (rss > peak) peak = rss; if (rss > phasePeak) phasePeak = rss; };
const sampler = setInterval(sample, 100);
const startPhase = () => { phasePeak = 0; sample(); return Date.now(); };

console.log(`Writing ${VOUCHERS.toLocaleString('en-IN')} sales vouchers to ${filesDir} ...`);
let t = Date.now();
const salesFile = path.join(filesDir, 'sales.json');
const salesBytes = await writeSales(salesFile, VOUCHERS);
console.log(`  sales.json: ${mb(salesBytes)}, written in ${secs(Date.now() - t)}`);

const { buildApp } = await import('../src/index.js');
const app = buildApp();
await app.listen({ port: 0, host: '127.0.0.1' });
const origin = `http://127.0.0.1:${app.server.address().port}`;
const seed = JSON.parse(fs.readFileSync(path.resolve(here, '../seed-users.json'), 'utf8'));
const user = seed.users.find(u => u.role === 'analyst');
let res = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: user.email, password: user.password }) });
if (!res.ok) throw new Error(`login failed: ${res.status}`);
const cookie = res.headers.get('set-cookie').split(';')[0];
const api = async (method, url, body) => {
  const r = await fetch(`${origin}${url}`, { method, headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json() };
};
const upload = async (id, slot, file) => {
  const r = await fetch(`${origin}/api/migrations/${id}/uploads/${slot}`, { method: 'PUT', duplex: 'half', body: fs.createReadStream(file),
    headers: { cookie, 'content-type': 'application/octet-stream', 'x-filename': path.basename(file) } });
  const json = await r.json();
  if (!r.ok) throw new Error(`upload of ${slot} failed: ${r.status} ${JSON.stringify(json)}`);
  return json;
};
// Asks /api/health every 200 ms and records how long each answer took.
const healthWatch = () => {
  const times = []; let failed = 0, stop = false;
  const loop = (async () => { while (!stop) { const s = Date.now(); try { const r = await fetch(`${origin}/api/health`); if (r.ok) times.push(Date.now() - s); else failed++; } catch { failed++; } await new Promise(r => setTimeout(r, 200)); } })();
  return async () => { stop = true; await loop; return { asked: times.length + failed, answered: times.length, failed, slowestMs: times.length ? Math.max(...times) : null, typicalMs: times.length ? times.slice().sort((a, b) => a - b)[Math.floor(times.length / 2)] : null }; };
};

const created = await api('POST', '/api/migrations', { company: COMPANY, financialYear: '2024-25' });
const id = created.json.id;
for (const [slot, file] of Object.entries(small)) await upload(id, slot, file);
for (const slot of ['stock_items', 'units', 'stock_summary']) await api('PUT', `/api/migrations/${id}/waivers/${slot}`, { reason: 'Not part of the large-file check' });
const rssBefore = process.memoryUsage().rss;

console.log('Uploading and checking the large file ...');
t = startPhase();
let stopHealth = healthWatch();
const up = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--send', origin, cookie, id, 'sales', salesFile], { stdio: ['ignore', 'pipe', 'inherit'] });
  let text = '';
  child.stdout.on('data', d => { text += d; });
  child.on('error', reject);
  child.on('close', () => { try { const r = JSON.parse(text); if (r.status === 200) resolve(r.json); else reject(new Error(`upload failed: ${text}`)); } catch { reject(new Error(`upload failed: ${text}`)); } });
});
const uploadMs = Date.now() - t, uploadPeak = phasePeak, uploadHealth = await stopHealth();
console.log(`  ${up.records.toLocaleString('en-IN')} records accepted, ${up.fieldsNotRead.count} field(s) not read, ${up.warnings.length} warning(s), in ${secs(uploadMs)}`);

console.log('Processing ...');
t = startPhase();
stopHealth = healthWatch();
const started = await api('POST', `/api/migrations/${id}/process?wait=0`);
if (started.status !== 202) throw new Error(`process did not start: ${started.status} ${JSON.stringify(started.json)}`);
let status, lastPrint = 0;
for (;;) {
  await new Promise(r => setTimeout(r, 500));
  status = (await api('GET', `/api/migrations/${id}/process-status`)).json;
  if (Date.now() - lastPrint > 5000 || !['queued', 'running'].includes(status.state)) {
    lastPrint = Date.now();
    console.log(`  ${status.state}: ${status.phase}, ${status.recordsDone.toLocaleString('en-IN')} of ${status.recordsTotal.toLocaleString('en-IN')} records, ${status.percent}%, ${status.elapsedSeconds} s elapsed, about ${status.estimatedSecondsRemaining ?? '?'} s left`);
  }
  if (!['queued', 'running'].includes(status.state)) break;
}
const processMs = Date.now() - t, processPeak = phasePeak, processHealth = await stopHealth();
const summary = (await api('GET', `/api/migrations/${id}/summary`)).json;
const stored = summary.bySlot.reduce((n, s) => n + s.n, 0);
clearInterval(sampler);
await app.close();

const health = h => `${h.answered} of ${h.asked} health requests answered${h.failed ? ` (${h.failed} FAILED)` : ''}; typical ${h.typicalMs} ms, slowest ${h.slowestMs} ms`;
console.log('\n===== Large-file result =====');
console.log(`Vouchers:            ${VOUCHERS.toLocaleString('en-IN')} in a ${mb(salesBytes)} file`);
console.log(`Upload and check:    ${secs(uploadMs)}; peak memory ${mb(uploadPeak)}; ${health(uploadHealth)}`);
console.log(`Processing:          ${secs(processMs)}, ended "${status.state}"${status.error ? ` (${status.error})` : ''}; peak memory ${mb(processPeak)}; ${health(processHealth)}`);
console.log(`Records stored:      ${stored.toLocaleString('en-IN')} (expected ${status.recordsTotal.toLocaleString('en-IN')}); flagged items ${summary.exceptions.length}; migration status "${summary.status}"`);
console.log(`Memory:              ${mb(rssBefore)} before the large file, ${mb(peak)} at the highest point of the whole run`);
console.log(`Node ${process.version} on ${os.platform()} ${os.arch()}, ${os.cpus().length} CPU threads`);
if (KEEP) console.log(`Kept: ${work}`);
else {
  // The large files first; the database file is still open in this process, so on Windows it may have to be left behind.
  for (const p of [filesDir, path.join(process.env.DATA_DIR, 'uploads'), path.join(process.env.DATA_DIR, 'tmp'), work]) {
    try { fs.rmSync(p, { recursive: true, force: true }); } catch { console.log(`Could not remove ${p} while the database is open. It is a temporary folder and can be deleted by hand.`); }
  }
}
if (status.state !== 'done' || stored !== status.recordsTotal) process.exitCode = 1;
