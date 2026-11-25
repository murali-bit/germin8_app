// Voucher reconciliation: every voucher of the Tally JSON is accounted for in the Zoho files (written, held, waiting
// for routing, left out with a reason, or kept with no Zoho file), every Tally line is represented, and the amounts
// written are compared with Tally's, with each difference explained.
// Every value here is MADE UP (see fixtures/allTransactions.js); only the structure copies real exports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-recon-'));
const { buildApp } = await import('../src/index.js');
const { NameSet } = await import('../src/tally.js');
const { buildVoucherOutput } = await import('../src/vouchers.js');
const { parseCsv } = await import('../src/zoho.js');
const { mastersDoc, VOUCHERS, transactionsDoc, trialBalanceReport, utf16le, voucher, line } = await import('../fixtures/allTransactions.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(fs.readFileSync(path.resolve(here, '../seed-users.json'), 'utf8'));
const P = { ispartyledger: true };

// ---------- the rules, on made-up vouchers ----------
const GST = { 'Input IGST': { gst: true, tds: false, head: 'IGST', rate: null }, 'Output IGST': { gst: true, tds: false, head: 'IGST', rate: null } };
const ctx = (extra = {}) => ({ customers: new NameSet(['Alder Retail']), vendors: new NameSet(['Elm Works']), taxLedgers: new NameSet(['Input IGST', 'Output IGST']),
  taxInfo: name => GST[name] || null, taxMap: { 'Input IGST': 'IGST18', 'Output IGST': 'IGST18' }, ...extra });
let nextId = 1;
const rec = (slot, data, decision) => ({ id: nextId++, source_id: `src-${nextId}`, name: `${data.vouchertypename} ${data.vouchernumber}`, slot, data, decision });

test('each Tally line of a written document is represented once, and what the document posts is recorded', () => {
  const sale = rec('sales', voucher('Sales', 'S-1', '20240501', [line('Alder Retail', '-1180.00', P), line('Service Income', '1000.00'), line('Output IGST', '180.00'), line('Round Off', '0')], { party: 'Alder Retail' }));
  const bill = rec('purchase', voucher('Purchase', 'B-1', '20240502', [line('Elm Works', '1000.00', P), line('Office Rent', '-1000.00'), line('Input IGST', '-180.00'), line('Output IGST', '180.00')], { party: 'Elm Works' }));
  // two lines and no GST rate anywhere: the tax cannot be put on a line
  // changed on purpose (S6, GST-002): 1000 + 1000 with 360 can only be 18% on both (now written); 1000 + 500 with 180 is
  // 12% on both or 18% on the first only: still not certain
  const unclear = rec('sales', voucher('Sales', 'S-2', '20240503', [line('Alder Retail', '-1680.00', P), line('Service Income', '1000.00'), line('Other Income', '500.00'), line('Output IGST', '180.00')], { party: 'Alder Retail' }));
  const cancelled = rec('sales', voucher('Sales', 'S-3', '20240504', [line('Alder Retail', '-10.00', P), line('Service Income', '10.00')], { party: 'Alder Retail', extra: { iscancelled: true } }));
  const journal = rec('journal', voucher('Journal', 'J-1', '20240505', [line('Office Rent', '-50.00'), line('Elm Works', '50.00')]), 'Manual Journal');
  const unrouted = rec('journal', voucher('Journal', 'J-2', '20240506', [line('Office Rent', '-5.00'), line('Elm Works', '5.00')]));
  const out = buildVoucherOutput([sale, bill, unclear, cancelled, journal, unrouted], ctx());
  const by = Object.fromEntries(out.recon.map(e => [e.number, e]));
  assert.equal(out.recon.length, 6, 'one entry per voucher');
  assert.deepEqual([by['S-1'].outcome, by['S-1'].file, by['S-1'].roles, by['S-1'].posting], ['written', 'invoices', ['party', 'row', 'tax_column', 'not_written_zero'], { debit: '1180.00', credit: '1180.00' }]);
  // reverse charge (changed on purpose, audit item 1): written in the bill's Reverse Charge columns, so Zoho posts the
  // input credit and the tax payable: the bill posts 1180 each side, as Tally
  assert.deepEqual([by['B-1'].roles, by['B-1'].posting], [['party', 'row', 'reverse_charge_column', 'reverse_charge_column'], { debit: '1180.00', credit: '1180.00' }]);
  assert.ok(by['B-1'].flags.includes('reverse_charge_written'));
  assert.deepEqual([by['S-2'].roles, by['S-2'].posting], [['party', 'row', 'row', 'tax_not_written'], { debit: '1500.00', credit: '1500.00' }]);
  assert.deepEqual([by['S-3'].outcome, by['S-3'].reason], ['left_out', 'cancelled']);
  assert.deepEqual([by['J-1'].outcome, by['J-1'].file, by['J-1'].roles, by['J-1'].posting], ['written', 'journals', ['row', 'row'], { debit: '50.00', credit: '50.00' }]);
  assert.equal(by['J-2'].outcome, 'awaiting_routing');
  // changed on purpose (S4, TALLY-003): a reversal entered as a Sales voucher is a Manual Journal posting what Tally posted
  const rev = buildVoucherOutput([rec('sales', voucher('Sales', 'S-9', '20240507', [line('Alder Retail', '100.00', P), line('Service Income', '-100.00')], { party: 'Alder Retail' }))], ctx());
  assert.deepEqual([rev.recon[0].outcome, rev.recon[0].file, rev.recon[0].posting, rev.recon[0].flags.includes('sales_written_as_journal')], ['written', 'journals', { debit: '100.00', credit: '100.00' }, true]);
});

test('a difference is explained only when its size fits the reason', async () => {
  const { explainDifference, safeText } = await import('../src/voucherrecon.js');
  const { default: Decimal } = await import('decimal.js');
  const D = x => new Decimal(x);
  const diff = (d, c) => ({ debit: D(d), credit: D(c) });
  // invoice: party, row, unmapped tax of 180
  const roles = ['party', 'row', 'tax_not_written'], amounts = [D('-1180'), D('1000'), D('180')];
  assert.equal(explainDifference(diff('180', '180'), roles, amounts, 'invoices', []), 'tax_not_written');
  // the same voucher with 5,000 more missing: the tax does not explain it
  assert.equal(explainDifference(diff('5180', '5180'), roles, amounts, 'invoices', []), 'not_explained');
  // reverse charge: both GST lines left out
  assert.equal(explainDifference(diff('180', '180'), ['party', 'row', 'reverse_charge_not_written', 'reverse_charge_not_written'], [D('1000'), D('-1000'), D('-180'), D('180')], 'bills', []), 'reverse_charge');
  // rounding: an invoice with a tax column gets one rupee per tax line written
  assert.equal(explainDifference(diff('0.40', '0.40'), ['party', 'row', 'tax_column'], amounts, 'invoices', []), 'rounding');
  assert.equal(explainDifference(diff('1.40', '1.40'), ['party', 'row', 'tax_column'], amounts, 'invoices', []), 'not_explained');
  // a journal has no tax: only the rounding of its amounts to 2 decimals
  assert.equal(explainDifference(diff('0.50', '0.50'), ['row', 'row'], [D('-50.5'), D('50.5')], 'journals', []), 'not_explained');
  assert.equal(explainDifference(diff('0.004', '0.004'), ['row', 'row'], [D('-50.004'), D('50.004')], 'journals', []), 'rounding');
  // CSV cells Excel would run as a formula
  assert.deepEqual(['=1+1', '+91', '-5', '@x', 'INV-1', 12].map(safeText), ["'=1+1", "'+91", "'-5", "'@x", 'INV-1', 12]);
});

// ---------- end to end ----------
const app = buildApp();
let cookie = '';
const call = opts => app.inject({ ...opts, headers: { ...(opts.headers || {}), ...(cookie ? { cookie } : {}) } });
const get = async url => { const r = await call({ url }); assert.equal(r.statusCode, 200, `${url}: ${r.body}`); return r.json(); };
const put = (id, slot, obj, name) => call({ method: 'PUT', url: `/api/migrations/${id}/uploads/${slot}`, headers: { 'content-type': 'application/octet-stream', 'x-filename': name }, payload: utf16le(obj) });
const send = (method, url, payload) => call({ method, url, ...(payload !== undefined ? { payload } : {}) });
const login = async role => {
  const u = seed.users.find(x => x.role === role);
  cookie = String((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: u.password } })).headers['set-cookie']).split(';')[0];
};

test('end to end: every voucher and line accounted for, drill-down, CSV report, out of date, viewers read', async () => {
  await login('analyst');
  const viewerCompany = seed.users.find(x => x.role === 'viewer').company || 'Sample Masters Co';
  const id = (await send('POST', '/api/migrations', { company: viewerCompany, financialYear: '2024-25' })).json().id;
  const base = `/api/migrations/${id}`;
  assert.equal((await put(id, 'all_masters', mastersDoc(), 'Master.json')).statusCode, 200);
  assert.equal((await put(id, 'all_transactions', transactionsDoc(VOUCHERS), 'Transactions.json')).statusCode, 200);
  await send('PUT', `${base}/waivers/stock_summary`, { reason: 'Not needed for test' });
  assert.equal((await put(id, 'trial_balance', trialBalanceReport(), 'TrialBal.json')).statusCode, 200);
  assert.equal((await send('POST', `${base}/process?wait=1`)).statusCode, 200);

  // before any file: nothing to reconcile
  let rec = await get(`${base}/voucher-reconciliation`);
  assert.deepEqual([rec.available, rec.why], [false, 'no_files']);
  assert.equal((await send('GET', `${base}/voucher-reconciliation/vouchers`)).statusCode, 409);

  await send('POST', `${base}/journals/accept-suggestions`);
  await send('PUT', `${base}/tax-mappings`, { ledger: 'Input CGST', zohoTax: 'GST18' });
  const g = await send('POST', `${base}/generate`);
  assert.equal(g.statusCode, 200, g.body);
  const vc = g.json().vouchers;

  rec = await get(`${base}/voucher-reconciliation`);
  assert.equal(rec.available, true);
  assert.equal(rec.outOfDate, false);
  // every row adds up, and the total agrees with the control total of the Export Center
  assert.equal(rec.total.in, vc.stored);
  assert.equal(rec.total.out, vc.stored);
  assert.ok(rec.rows.every(r => r.matches && r.in === r.out), JSON.stringify(rec.rows));
  for (const r of rec.rows) assert.equal(Object.values(r.destinations).reduce((t, n) => t + n, 0), r.in, r.slot);
  const d = rec.total.destinations;
  assert.deepEqual([d['written:invoices'] || 0, d['written:bills'] || 0, d['written:journals'] || 0, d['written:other_journals'] || 0], [vc.written.invoices, vc.written.bills, vc.written.journals, vc.written.other_journals]);
  assert.equal(d.left_out || 0, vc.leftOut);
  assert.equal(d.awaiting_routing || 0, vc.awaitingRouting);
  assert.equal(d.no_file || 0, Object.values(vc.keptWithoutZohoFile).reduce((t, n) => t + n, 0));
  assert.equal((d['held:payments_received'] || 0) + (d['held:payments_made'] || 0) + (d['held:vendor_credits'] || 0) + (d['held:credit_notes'] || 0), Object.values(vc.waitingForZohoSample).reduce((t, n) => t + n, 0));
  assert.equal(Object.values(rec.total.leftOutReasons).reduce((t, n) => t + n, 0), vc.leftOut);
  // lines: every Tally line is represented
  assert.equal(rec.lines.total.matches, true, JSON.stringify(rec.lines));
  assert.equal(rec.lines.total.linesIn, rec.lines.total.linesOut);
  assert.ok(rec.lines.total.roles.party > 0 && rec.lines.total.roles.row > 0);
  // the checks against the files: no voucher in two files, file rows, held list, control total
  const failed = rec.checks.filter(c => !c.ok);
  assert.deepEqual(failed, []);
  assert.ok(['rows_match', 'no_voucher_twice', 'control_total', 'file_invoices', 'all_transactions_file', 'amounts_in'].every(k => rec.checks.some(c => c.key === k)));
  // amounts: in = written (Tally) + not written, and written (Tally) - as written = the explained differences
  const D = x => Number(x);
  for (const a of [...rec.amounts.rows, rec.amounts.total]) {
    assert.equal((D(a.writtenTally.debit) + D(a.notWritten.debit)).toFixed(2), a.in.debit);
    assert.equal((D(a.writtenTally.credit) + D(a.notWritten.credit)).toFixed(2), a.in.credit);
    assert.equal(a.differences.reduce((t, x) => t + D(x.debit), 0).toFixed(2), (D(a.writtenTally.debit) - D(a.written.debit)).toFixed(2));
  }

  // drill-down: the vouchers behind a cell, with paging
  const salesRow = rec.rows.find(r => r.slot === 'sales');
  const page1 = await get(`${base}/voucher-reconciliation/vouchers?slot=sales&bucket=all&pageSize=1`);
  assert.deepEqual([page1.total, page1.pages, page1.vouchers.length], [salesRow.in, salesRow.in, 1]);
  const written = await get(`${base}/voucher-reconciliation/vouchers?slot=all&bucket=written:invoices&pageSize=200`);
  assert.equal(written.total, vc.written.invoices);
  assert.ok(written.vouchers.every(v => v.file === 'Invoices' && v.documentNumber && v.date && v.tally && v.written));
  const leftOut = await get(`${base}/voucher-reconciliation/vouchers?bucket=left_out&pageSize=200`);
  assert.equal(leftOut.total, vc.leftOut);
  assert.ok(leftOut.vouchers.every(v => v.reason && v.flags.some(f => /^Left out/.test(f.message))), 'the reason and the flagged item of each voucher left out');
  // the made-up data has one invoice whose tax is not mapped: its 180.00 of tax is the only difference, and it is explained
  assert.deepEqual(rec.amounts.total.differences.map(x => [x.reason, x.vouchers, x.debit, x.credit]), [['tax_not_written', 1, '180.00', '180.00']]);
  assert.equal(rec.allChecksPass, true);
  const diffs = await get(`${base}/voucher-reconciliation/vouchers?bucket=difference&pageSize=200`);
  assert.equal(diffs.total, rec.amounts.total.differences.reduce((t, x) => t + x.vouchers, 0));
  assert.ok(diffs.vouchers.every(v => v.differenceText));
  assert.equal((await send('GET', `${base}/voucher-reconciliation/vouchers?bucket=everything`)).statusCode, 400);
  assert.equal((await send('GET', `${base}/voucher-reconciliation/vouchers?slot=nowhere`)).statusCode, 400);

  // the CSV report: the summary and every voucher
  const csv = await call({ url: `${base}/voucher-reconciliation/report.csv` });
  assert.equal(csv.statusCode, 200);
  assert.match(csv.headers['content-disposition'], /voucher_reconciliation_/);
  assert.match(csv.body, /Voucher type,In the Tally JSON,/);
  assert.match(csv.body, /\r\nTotal,\d+,/);
  const vouchersPart = csv.body.slice(csv.body.indexOf('Voucher type,Tally voucher type,'));
  assert.equal(parseCsv(vouchersPart).rows.length, vc.stored);
  assert.equal(csv.body.charCodeAt(0), 0xfeff, 'starts with a byte order mark for Excel');
  // held vouchers name the Zoho sample that releases them, in the API and the CSV
  const heldTotal = Object.values(vc.waitingForZohoSample).reduce((t, n) => t + n, 0);
  assert.equal((rec.held || []).reduce((t, h) => t + h.vouchers, 0), heldTotal);
  assert.ok(rec.held.every(h => h.sample && h.importAfterModule));
  if (heldTotal) assert.match(csv.body, /"Held, waiting for a Zoho sample",Vouchers,/);
  // the checks against the files: separate documents per file, and the journal files' own Debit and Credit totals
  assert.ok(rec.checks.some(c => c.key === 'documents_invoices'));
  assert.ok(rec.checks.some(c => c.key.startsWith('totals_')), JSON.stringify(rec.checks.map(c => c.key)));
  // the vouchers behind one reason
  const byReason = await get(`${base}/voucher-reconciliation/vouchers?bucket=difference:tax_not_written&pageSize=200`);
  assert.equal(byReason.total, 1);
  assert.equal((await send('GET', `${base}/voucher-reconciliation/vouchers?bucket=difference:nothing`)).statusCode, 400);

  // viewers read it
  await login('viewer');
  assert.equal((await get(`${base}/voucher-reconciliation`)).available, true);
  assert.equal((await call({ url: `${base}/voucher-reconciliation/vouchers?bucket=all` })).statusCode, 200);
  await login('analyst');

  // a change to what the voucher files are built from marks the reconciliation out of date
  await send('PUT', `${base}/voucher-settings`, { documentStatus: 'draft' });
  rec = await get(`${base}/voucher-reconciliation`);
  assert.equal(rec.outOfDate, true);
  assert.ok(rec.outOfDateReasons.length > 0);
  // creating the files again brings it up to date
  assert.equal((await send('POST', `${base}/generate`)).statusCode, 200);
  assert.equal((await get(`${base}/voucher-reconciliation`)).outOfDate, false);
  // processing again removes the files, and with them the reconciliation
  assert.equal((await send('POST', `${base}/process?wait=1`)).statusCode, 200);
  assert.equal((await get(`${base}/voucher-reconciliation`)).why, 'no_files');
});
