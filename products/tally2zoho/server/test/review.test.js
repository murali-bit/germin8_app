// What three reviews of the real-voucher and Trial Balance reading found, each with the test that would have caught it:
// vouchers that a re-sort left in no dataset, a required dataset that stayed blocked, reversals written as bills,
// bulk approval of suggestions that need a look, tax deducted at source asked for a tax mapping, negative rows and
// repeated document numbers without a flag, voucher types without a Zoho file missing from the control total, tax
// ledgers on journals missing from tax mapping, party opening balances in two files, and Trial Balance amounts.
// Every value used here is MADE UP (see fixtures/allTransactions.js); only the structure copies real exports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-review-'));
const { buildApp } = await import('../src/index.js');
const { NameSet } = await import('../src/tally.js');
const { reportBody, flattenTrialBalance, analyseTrialBalance, masterIndex, parseReportText } = await import('../src/trialbalance.js');
const { suggestJournal, buildVoucherOutput, PARTY_SIDE_TAX } = await import('../src/vouchers.js');
const { taxUsageCollector } = await import('../src/taxes.js');
const { parseCsv } = await import('../src/zoho.js');
const { MASTER_RECORDS, mastersDoc, VOUCHERS, transactionsDoc, trialBalanceReport, LEDGER_FIGURES, utf16le, voucher, line, ledger } = await import('../fixtures/allTransactions.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(fs.readFileSync(path.resolve(here, '../seed-users.json'), 'utf8'));
const byNumber = Object.fromEntries(VOUCHERS.map(v => [v.vouchernumber, v]));
const count = (list, f) => list.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
const P = { ispartyledger: true };

// ---------- units ----------
test('Trial Balance amounts are read from the digits in the file; a plain number too large for the paisa is noted', () => {
  const report = amounts => `{"dspaccbody":{"dspaccline":[{"dspaccname":{"dspdispname":"Big"},"dspaccinfo":[{"dspopamt":{"dspopamta":${amounts[0]}},"dspdramt":{"dspdramta":${amounts[1]}},"dspcramt":{"dspcramta":${amounts[2]}},"dspclamt":{"dspclamta":${amounts[3]}}}]}]}}`;
  // between 2^46 and 2^53/100 a binary number moves such figures by a paisa: read from the text they stay as written
  const text = report(['70368744177664.01', '-80000000000000.07', '1e3', '-0.10']);
  const exact = flattenTrialBalance(reportBody(parseReportText(text)));
  assert.deepEqual([exact.lines[0].openingbalance, exact.lines[0].debittotal, exact.lines[0].credittotal, exact.lines[0].closingbalance, exact.lines[0].notes, exact.inexact],
    ['70368744177664.01', '80000000000000.07', '1000', '-0.1', undefined, 0]);
  // the same file read as plain numbers: the figure may have moved, and the line says so
  const plain = flattenTrialBalance(reportBody(JSON.parse(text)));
  assert.equal(plain.inexact, 2);
  assert.match(plain.lines[0].notes[0], /opening balance is too large for the file to hold exactly to two decimals/);
  assert.match(plain.lines[0].notes[1], /debit total is too large/);
  // just under 2^46 a plain number is exact and carries no note
  const under = flattenTrialBalance(reportBody(JSON.parse(report(['70368744177663.99', '-1.5', '2', '0']))));
  assert.deepEqual([under.lines[0].openingbalance, under.lines[0].notes], ['70368744177663.99', undefined]);
  // an amount with three decimals is noted on either path
  assert.match(flattenTrialBalance(reportBody(parseReportText(report(['1.005', '0', '0', '0'])))).lines[0].notes[0], /opening balance has more than two decimals/);
  // text amounts: Dr is a debit (negative), Cr a credit
  const dc = flattenTrialBalance(reportBody({ dspaccbody: { dspaccline: [{ dspaccname: { dspdispname: 'Text' }, dspaccinfo: [{ dspopamt: { dspopamta: '25.50 Cr' }, dspdramt: { dspdramta: '10.00 Dr' }, dspcramt: { dspcramta: '4.00 Cr' }, dspclamt: { dspclamta: '1,019.50 Dr' } }] }] } }));
  assert.deepEqual([dc.lines[0].openingbalance, dc.lines[0].debittotal, dc.lines[0].credittotal, dc.lines[0].closingbalance], ['25.5', '10', '4', '-1019.5']);
});

test('a Trial Balance line that is neither a ledger nor a group is flagged', () => {
  const masters = masterIndex(MASTER_RECORDS.map(r => ({ type: r.metadata.type, data: r })));
  const lines = flattenTrialBalance(reportBody({ dspaccbody: { dspaccline: [{ dspaccname: { dspdispname: 'Nobody Ledger' }, dspaccinfo: [{ dspopamt: {}, dspdramt: {}, dspcramt: {}, dspclamt: {} }] },
    { dspaccname: { dspdispname: 'Cash' }, dspaccinfo: [{ dspopamt: {}, dspdramt: {}, dspcramt: {}, dspclamt: {} }] }] } })).lines;
  const a = analyseTrialBalance({ lines, ...masters });
  assert.deepEqual([a.summary.unmatched, a.summary.ledgers], [1, 1]);
  assert.deepEqual(a.flags.filter(f => f.kind === 'trial_balance_line_unmatched').map(f => f.name), ['Nobody Ledger']);
});

test('invoices and bills: a reversal is left out, a ledger on the party side is a negative row with a flag, repeated numbers are reported', () => {
  const customers = new NameSet(['Maple Leaf Traders']), vendors = new NameSet(['Birch Supplies']), taxLedgers = new NameSet(['Input CGST', 'TDS Payable', 'TDS Receivable', 'Output CGST']);
  const jv = (number, ...lines) => ({ vouchernumber: number, date: '20240601', allledgerentries: lines.map(([ledgername, amount]) => ({ ledgername, amount })) });
  const rec = (id, slot, data, decision) => ({ id, source_id: `g${id}`, name: `${slot} ${data.vouchernumber}`, slot, data, decision });
  const kindOf = name => ({ 'Staff Tea Expenses': 'expense', 'Round Off': 'expense' }[name] ?? null);
  const built = buildVoucherOutput([
    rec(1, 'journal', jv('A-1', ['Birch Supplies', '-100.00'], ['Staff Tea Expenses', '100.00']), 'Bill'),               // the vendor is debited: not a bill
    rec(2, 'sales', jv('A-2', ['Maple Leaf Traders', '40.00'], ['Domestic Sales', '-40.00'])),                           // the customer is credited: not an invoice
    rec(3, 'sales', jv('A-3', ['Maple Leaf Traders', '-108.00'], ['TDS Receivable', '-10.00'], ['Domestic Sales', '100.00'], ['Output CGST', '18.00'])), // tax deducted by the customer
    rec(4, 'journal', jv('A-4', ['Staff Tea Expenses', '-100.00'], ['Input CGST', '-18.00'], ['Birch Supplies', '108.00'], ['TDS Payable', '10.00']), 'Bill'),
    rec(5, 'journal', jv('A-5', ['Staff Tea Expenses', '-100.00'], ['Birch Supplies', '99.50'], ['Round Off', '0.50']), 'Bill'), // an expense ledger credited
    rec(6, 'journal', jv('A-3', ['Maple Leaf Traders', '-5.00'], ['Domestic Sales', '5.00']), 'Invoice'),                // the same number as the Sales voucher A-3
  ], { customers, vendors, taxLedgers, taxMap: { 'Input CGST': 'GST 18' }, kindOf });
  // changed on purpose (S4, TALLY-003): the Sales voucher A-2 with the customer credited cannot be an invoice, so it is a
  // Manual Journal posting what Tally posted (never left out); A-1 stays left out: a person chose "Bill" for it
  assert.deepEqual([built.invoices.vouchers, built.bills.vouchers, built.journals.vouchers], [2, 2, 1]);
  assert.deepEqual(built.exceptions.filter(e => e.kind === 'sales_written_as_journal').map(e => e.rec.id), [2]);
  // B6: other flags about a document (no place of supply, a total that does not tie) are tested in vouchers.test.js
  const exc = built.exceptions.filter(e => ['left_out_party_side', 'negative_row'].includes(e.kind)).map(e => [e.rec.id, e.kind ?? null]);
  // changed on purpose (audit item 2): a tax ledger debited on an INVOICE (not TDS in Tally) is not an income line: it
  // goes to the invoice's Adjustment, never a negative line with a zero-rate tax and a service item on a tax account
  assert.deepEqual(exc, [[1, 'left_out_party_side'], [4, 'negative_row'], [5, 'negative_row']]);
  assert.ok(built.exceptions.some(e => e.rec.id === 3 && e.kind === 'invoice_line_to_adjustment'));
  built.exceptions = built.exceptions.filter(e => ['left_out_party_side', 'negative_row'].includes(e.kind));
  assert.match(built.exceptions[0].message, /^Left out of the file: the vendor "Birch Supplies" is debited on this voucher, so it is not a bill .* would post the opposite of the Tally entry/);
  assert.match(built.exceptions[2].message, /This bill carries 1 row with a negative amount: "Round Off" \(an expense or purchase ledger\) is credited on the voucher, the same side as the vendor.*has not been verified/);
  // B6 (changed on purpose): Zoho's layouts, one row per line, the tax on the line it belongs to, no tax rows
  const rows = file => built[file].rows.map(x => file === 'invoices'
    ? [x.row['Invoice Number'], x.row.Account, x.row['Item Price'], x.row['Item Tax'], x.row['Item Tax %']]
    : [x.row['Bill Number'], x.row.Account, x.row.Rate, x.row['Tax Name'], x.row['Tax Amount']]); // v2: the Bills file has no Item Total column; Rate is the line amount
  assert.deepEqual(rows('invoices'), [['A-3', 'Domestic Sales', '100.00', '', ''], ['A-3', 'Domestic Sales', '5.00', '', '']]);
  assert.deepEqual([built.invoices.rows[0].row.Adjustment, built.invoices.rows[0].row['Adjustment Description']], ['-10.00', 'TDS Receivable']);
  assert.deepEqual(rows('bills'), [['A-4', 'Staff Tea Expenses', '100.00', 'GST 18', '18.00'], ['A-4', 'TDS Payable', '-10.00', '', ''],
    ['A-5', 'Staff Tea Expenses', '100.00', '', ''], ['A-5', 'Round Off', '-0.50', '', '']]);
  assert.equal(PARTY_SIDE_TAX, 'Tax ledger on the party side', 'kept for older imports');
  // a tax ledger on the party side is not asked for a Zoho tax; it is reported per ledger with the voucher count
  assert.deepEqual(built.unmappedTax, ['Output CGST']);
  assert.deepEqual(built.partySideTax, [{ ledger: 'TDS Payable', file: 'bills', vouchers: 1 }]);
  assert.deepEqual(built.repeatedNumbers.map(d => [d.file, d.number, d.recs.map(r => r.slot)]), [['invoices', 'A-3', ['sales', 'journal']]]);

  // suggestions: a negative row is said in the reason and marked, for a tax ledger and for any other ledger
  const s = v => suggestJournal(v, customers, vendors, { kindOf: n => (kindOf(n) ?? (n === 'Domestic Sales' ? 'income' : null)), taxLedgers });
  let r = s(jv('B-1', ['Staff Tea Expenses', '-100.00'], ['Birch Supplies', '99.50'], ['Round Off', '0.50']));
  assert.deepEqual([r.suggested, r.clear, r.needsCheck], ['Bill', true, true]);
  assert.match(r.reason, /1 other ledger is credited as well .* written as a negative row, so the bill total would be the net amount\. Check this before you approve\./);
  r = s(jv('B-2', ['Maple Leaf Traders', '-90.00'], ['TDS Receivable', '-10.00'], ['Domestic Sales', '100.00']));
  assert.deepEqual([r.suggested, r.clear, r.needsCheck], ['Invoice', true, true]);
  assert.match(r.reason, /1 tax ledger is debited as well .* negative row, not as a tax on the invoice, so check this before you approve/);
  assert.equal(s(jv('B-3', ['Maple Leaf Traders', '-100.00'], ['Domestic Sales', '100.00'])).needsCheck, false);
});

test('tax usage counts journals, tells a tax row from a ledger on the party side, and finds a name with a hidden line break', () => {
  const parties = { customers: new NameSet(['Maple Leaf Traders']), vendors: new NameSet(['Birch Supplies']) };
  const jv = (...lines) => ({ allledgerentries: lines.map(([ledgername, amount]) => ({ ledgername, amount })) });
  const c = taxUsageCollector(['Input CGST', 'Input SGST\r\n', 'TDS Payable', 'Output CGST'], parties);
  c.add('journal', jv(['Staff Tea Expenses', '-100.00'], ['Input CGST', '-9.00'], ['Input SGST', '-9.00'], ['Birch Supplies', '108.00'], ['TDS Payable', '10.00']));
  c.add('journal', jv(['Input CGST', '-5.00'], ['Output CGST', '5.00'])); // no party: counted as a use, on neither side
  c.add('sales', jv(['Maple Leaf Traders', '-118.00'], ['Domestic Sales', '100.00'], ['Output CGST', '18.00']));
  c.add('receipt', jv(['Bank of Example', '-1.00'], ['Output CGST', '1.00'])); // not counted
  assert.deepEqual(c.result(), {
    'Input CGST': { vouchers: 0, journals: 2, asTax: 1, partySide: 0, with: { 'Input SGST\r\n': 1, 'TDS Payable': 1, 'Output CGST': 1 } },
    'Input SGST\r\n': { vouchers: 0, journals: 1, asTax: 1, partySide: 0, with: { 'Input CGST': 1, 'TDS Payable': 1 } },
    'TDS Payable': { vouchers: 0, journals: 1, asTax: 0, partySide: 1, with: { 'Input CGST': 1, 'Input SGST\r\n': 1 } },
    'Output CGST': { vouchers: 1, journals: 1, asTax: 1, partySide: 0, with: { 'Input CGST': 1 } },
  });
});

// ---------- end to end ----------
const app = buildApp();
let cookie = '';
const call = opts => app.inject({ ...opts, headers: { ...(opts.headers || {}), ...(cookie ? { cookie } : {}) } });
const get = async url => { const r = await call({ url }); assert.equal(r.statusCode, 200, `${url}: ${r.body}`); return r.json(); };
const put = (id, slot, obj, name) => call({ method: 'PUT', url: `/api/migrations/${id}/uploads/${slot}`, headers: { 'content-type': 'application/octet-stream', 'x-filename': name }, payload: utf16le(obj) });
const send = (method, url, payload) => call({ method, url, ...(payload !== undefined ? { payload } : {}) });
const csvRows = async (id, key) => { const r = await call({ url: `/api/migrations/${id}/files/${key}/download?confirmed=1` }); assert.equal(r.statusCode, 200, r.body); return parseCsv(r.body).rows; };
const newMigration = async () => {
  if (!cookie) {
    const u = seed.users.find(x => x.role === 'analyst');
    const lr = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: u.password } });
    cookie = String(lr.headers['set-cookie']).split(';')[0];
  }
  const id = (await send('POST', '/api/migrations', { company: 'Sample Masters Co', financialYear: '2024-25' })).json().id;
  const base = `/api/migrations/${id}`;
  const comp = async () => { const c = await get(`${base}/completeness`); return { c, slot: k => c.slots.find(s => s.key === k), ds: k => c.allTransactions.datasets.find(d => d.slot === k) }; };
  return { id, base, comp };
};
const journalsOnly = () => transactionsDoc(VOUCHERS.filter(v => v.vouchertypename === 'Journal'));

test('sorting the kept All Transactions file again never drops a voucher silently, and never undoes an upload or a removal', async () => {
  const { id, base, comp } = await newMigration();
  // before the masters: the voucher of the company's own sales type is kept under Other Voucher Types
  let r = await put(id, 'all_transactions', transactionsDoc(), 'Transactions.json');
  assert.equal(r.json().datasets.find(d => d.slot === 'other_vouchers').records, 3);
  // the user replaces Sales with a file of their own, and removes Journal
  assert.equal((await put(id, 'sales', transactionsDoc([byNumber['S-1']]), 'own-sales.json')).statusCode, 200);
  assert.equal((await send('DELETE', `${base}/uploads/journal`)).statusCode, 200);
  // the All Masters file arrives: the kept file is sorted again, and the own-type voucher now belongs to Sales
  r = await put(id, 'all_masters', mastersDoc(), 'Master.json');
  assert.equal(r.statusCode, 200, r.body);
  const said = r.json().messages.join(' | ');
  assert.match(said, /Sales Vouchers: 1 voucher of the All Transactions file belongs to this dataset since the file was sorted again .* the file uploaded on its own for this dataset \("own-sales\.json"\) was kept and not changed\. That voucher is in no dataset now/);
  let { c, slot, ds } = await comp();
  assert.deepEqual([slot('sales').upload.fileName, slot('sales').upload.records, slot('sales').upload.fromAllTransactions], ['own-sales.json', 1, false], 'the file uploaded on its own is still in place');
  assert.deepEqual([ds('sales').records, ds('sales').current, ds('sales').replacedBy, ds('sales').notPlaced], [2, false, 'own-sales.json', 1]);
  assert.deepEqual([slot('journal').status, ds('journal').records, ds('journal').removed, ds('journal').notPlaced], ['missing', 6, true, 0], 'a dataset the user removed is not put back');
  assert.deepEqual([ds('other_vouchers').records, ds('other_vouchers').current], [2, true]);
  assert.deepEqual(c.allTransactions.notPlaced, [{ slot: 'sales', name: 'Sales Vouchers', vouchers: 1, why: 'own_file', fileName: 'own-sales.json' }]);
  // control total: every voucher of the file is accounted for, and the one in no dataset is counted
  assert.deepEqual(c.allTransactions.control, { vouchers: 15, inDatasets: 7, replacedByOwnFile: 2, removed: 6, notPlaced: 1, balanced: true });
  assert.ok((await get(`${base}/audit`)).some(a => a.action === 'all_transactions_sorted_again' && /1 voucher\(s\) are in no dataset/.test(a.detail)));

  // processing flags it, with the count
  assert.equal((await put(id, 'journal', journalsOnly(), 'own-journal.json')).statusCode, 200);
  assert.equal((await put(id, 'trial_balance', trialBalanceReport(), 'TrialBal.json')).statusCode, 200);
  await send('PUT', `${base}/waivers/stock_summary`, { reason: 'Not needed for test' });
  r = await send('POST', `${base}/process?wait=1`);
  assert.equal(r.statusCode, 200, r.body);
  let exc = (await get(`${base}/summary`)).exceptions;
  assert.deepEqual(exc.filter(e => e.kind === 'vouchers_in_no_dataset').map(e => [e.slot, e.name, e.uses]), [['sales', 'Sales Vouchers', 1]]);

  // uploading the All Transactions file again sorts every voucher into its dataset
  r = await put(id, 'all_transactions', transactionsDoc(), 'Transactions.json');
  assert.equal(r.statusCode, 200, r.body);
  ({ c, slot, ds } = await comp());
  assert.deepEqual([c.allTransactions.notPlaced, c.allTransactions.control], [[], { vouchers: 15, inDatasets: 15, replacedByOwnFile: 0, removed: 0, notPlaced: 0, balanced: true }]);

  // ---- a file of its own that was accepted through the Voucher Type records, and those records are removed ----
  r = await put(id, 'sales', transactionsDoc([byNumber['SE-1']]), 'export-only.json');
  assert.equal(r.statusCode, 200, r.body);
  r = await send('DELETE', `${base}/uploads/all_masters`);
  assert.equal(r.statusCode, 200, r.body);
  assert.ok(r.json().messages.some(m => /^Voucher types changed: since the All Masters file "Master\.json" was removed, the file "export-only\.json" no longer fits Sales Vouchers\. .*The file was kept as it is/.test(m)), r.json().messages.join(' | '));
  ({ c, slot, ds } = await comp());
  assert.match(slot('sales').upload.warnings[0], /^Voucher types changed: /, 'the warning is kept with the upload');
  assert.deepEqual([slot('sales').upload.fileName, ds('other_vouchers').records, ds('sales').notPlaced], ['export-only.json', 3, 0], 'the same voucher is now also under Other Voucher Types: said, not hidden');
  // the masters come back: the file fits again and the warning goes
  r = await put(id, 'all_masters', mastersDoc(), 'Master.json');
  ({ c, slot, ds } = await comp());
  assert.ok(!slot('sales').upload.warnings.some(w => /^Voucher types changed/.test(w)));
  assert.ok(slot('sales').upload.warnings.some(w => /1 voucher\(s\) of type "Sales - Export" were read as Sales vouchers/.test(w)));
  assert.equal(c.allTransactions.control.balanced, true);

  // ---- one Tally voucher held in two datasets is flagged when the data is processed ----
  const asPurchase = { ...byNumber['J-1'], metadata: { ...byNumber['J-1'].metadata, vchtype: 'Purchase' }, vouchertypename: 'Purchase' }; // the same guid as journal J-1
  assert.equal((await put(id, 'purchase', transactionsDoc([asPurchase]), 'purchase.json')).statusCode, 200);
  r = await send('POST', `${base}/process?wait=1`);
  assert.equal(r.statusCode, 200, r.body);
  exc = (await get(`${base}/summary`)).exceptions.filter(e => e.kind === 'voucher_in_two_datasets');
  assert.equal(exc.length, 1);
  assert.match(exc[0].message, /This voucher is also in (Journal|Purchase) Vouchers: the same Tally voucher is held in two datasets/);
});

test('a required voucher dataset that the All Transactions file shows to be empty never stays blocked', async () => {
  const { id, base, comp } = await newMigration();
  assert.equal((await put(id, 'all_masters', mastersDoc(), 'Master.json')).statusCode, 200);
  assert.equal((await put(id, 'all_transactions', transactionsDoc(), 'Transactions.json')).statusCode, 200);
  let { c, slot } = await comp();
  assert.deepEqual([slot('purchase').status, slot('purchase').autoNotApplicable, slot('purchase').confirmedEmptyByAllTransactions], ['not_applicable', true, true]);
  assert.deepEqual(c.allTransactions.autoNotApplicable.map(a => a.slot), ['purchase', 'credit_note']);

  // (a) Undo: the dataset is missing and blocks, but it can be marked again, with the reason of the file
  let r = await send('DELETE', `${base}/waivers/purchase`);
  assert.deepEqual(r.json(), { ok: true, canMarkAgain: true });
  ({ c, slot } = await comp());
  assert.deepEqual([slot('purchase').status, slot('purchase').canMarkNotApplicable, c.missingRequired, c.allTransactions.autoNotApplicable.map(a => a.slot)], ['missing', true, ['Purchase Vouchers', 'Trial Balance'], ['credit_note']],
    'the card no longer says Purchase is marked not applicable');
  r = await send('PUT', `${base}/waivers/purchase`, {});
  assert.equal(r.statusCode, 200, r.body);
  ({ c, slot } = await comp());
  assert.deepEqual([slot('purchase').status, slot('purchase').autoNotApplicable, c.missingRequired], ['not_applicable', true, ['Trial Balance']]);
  assert.match(slot('purchase').waiver.reason, /^Set automatically: the All Transactions file "Transactions\.json" has no Purchase vouchers/);
  // a required dataset the file HAS vouchers for still cannot be marked, with or without a file in place
  assert.match((await send('PUT', `${base}/waivers/sales`, { reason: 'x' })).json().error, /Sales Vouchers is required and cannot be marked not applicable/);

  // (b) a Purchase file of its own is uploaded and removed again: the mark comes back
  const purchase = { ...byNumber['J-3'], metadata: { ...byNumber['J-3'].metadata, vchtype: 'Purchase', remoteid: 'made-up-purchase' }, guid: 'made-up-purchase', vouchertypename: 'Purchase' };
  assert.equal((await put(id, 'purchase', transactionsDoc([purchase]), 'purchase.json')).statusCode, 200);
  ({ c, slot } = await comp());
  assert.deepEqual([slot('purchase').status, c.allTransactions.autoNotApplicable.map(a => a.slot), c.allTransactions.datasets.find(d => d.slot === 'purchase').ownFile], ['uploaded', ['credit_note'], 'purchase.json']);
  assert.equal((await send('PUT', `${base}/waivers/purchase`, {})).statusCode, 400, 'not while a file is in place');
  r = await send('DELETE', `${base}/uploads/purchase`);
  assert.equal(r.json().autoNotApplicable, true);
  assert.match(r.json().message, /^Purchase Vouchers was marked not applicable again automatically\. The All Transactions file "Transactions\.json" has no Purchase vouchers/);
  ({ c, slot } = await comp());
  assert.deepEqual([slot('purchase').status, slot('purchase').autoNotApplicable, c.missingRequired, c.allTransactions.autoNotApplicable.map(a => a.slot)], ['not_applicable', true, ['Trial Balance'], ['purchase', 'credit_note']]);

  // without the All Transactions file there is no evidence: its marks go, and Purchase cannot be marked by hand
  assert.equal((await send('DELETE', `${base}/uploads/all_transactions`)).statusCode, 200);
  ({ c, slot } = await comp());
  assert.deepEqual([slot('purchase').status, slot('purchase').canMarkNotApplicable], ['missing', false]);
  assert.match((await send('PUT', `${base}/waivers/purchase`, {})).json().error, /Purchase Vouchers is required and cannot be marked not applicable/);

  // a Trial Balance report uploaded through the API keeps every digit of a very large amount
  const big = JSON.stringify(trialBalanceReport()).replace('"dspopamta":2000.5', '"dspopamta":70368744177664.01');
  assert.ok(big.includes('70368744177664.01'));
  r = await call({ method: 'PUT', url: `${base}/uploads/trial_balance`, headers: { 'content-type': 'application/octet-stream', 'x-filename': 'TrialBal-big.json' }, payload: Buffer.from(big) });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().trialBalance.figuresNotExact, 0);
  const stored = fs.readFileSync(path.join(process.env.DATA_DIR, 'uploads', id, 'trial_balance.json'), 'utf8');
  assert.ok(stored.includes('"openingbalance":"70368744177664.01"'), 'read from the digits in the file, not through a binary number');
});

test('creating the files: every voucher is accounted for, and what needs an accountant is flagged, not decided', async () => {
  const { id, base, comp } = await newMigration();
  const masters = { tallymessage: [...mastersDoc().tallymessage, ledger('Courier Charges\r\n', 'Indirect Expenses'), ledger('Input SGST', 'Duties & Taxes')] };
  const both = voucher('Journal', 'J-9', '20240606', [line('Staff Tea Expenses', '-5.00'), line('Cash', '5.00')]);
  both.ledgerentries = JSON.parse(JSON.stringify(both.allledgerentries)); // the same lines in both lists
  const extra = [
    voucher('Journal', 'J-7', '20240601', [line('Staff Tea Expenses', '-100.00'), line('Input CGST', '-9.00'), line('Input SGST', '-9.00'), line('Birch Supplies', '118.00', P)], { party: 'Birch Supplies' }),
    // a sale entered as a journal that carries the same number as the Sales voucher S-1
    voucher('Journal', 'S-1', '20240602', [line('Maple Leaf Traders', '-50.00', P), line('Domestic Sales', '50.00')], { party: 'Maple Leaf Traders' }),
    // a Sales voucher with a second debit line (a discount, or tax deducted by the customer)
    voucher('Sales', 'S-2', '20240603', [line('Maple Leaf Traders', '-90.00', P), line('Staff Tea Expenses', '-10.00'), line('Domestic Sales', '100.00')], { view: 'invoice', party: 'Maple Leaf Traders' }),
    // a Sales voucher with the customer credited: a reversal
    voucher('Sales', 'S-3', '20240604', [line('Maple Leaf Traders', '40.00', P), line('Domestic Sales', '-40.00')], { view: 'invoice', party: 'Maple Leaf Traders' }),
    // the expense ledger is written without the line break its master has
    voucher('Journal', 'J-8', '20240605', [line('Courier Charges', '-20.00'), line('Birch Supplies', '20.00', P)], { party: 'Birch Supplies' }),
    both,
  ];
  const txns = { tallymessage: [...transactionsDoc([...VOUCHERS, ...extra]).tallymessage, { metadata: { type: 'Ledger', name: 'Stray Ledger' } }] };

  assert.equal((await put(id, 'all_masters', masters, 'Master.json')).statusCode, 200);
  // the numbers Tally shows, entered before the upload: the upload result compares them
  await send('PUT', `${base}/expected-counts/payment`, { expected: 1 });
  await send('PUT', `${base}/expected-counts/receipt`, { expected: 5 });
  let r = await put(id, 'all_transactions', txns, 'Transactions.json');
  assert.equal(r.statusCode, 200, r.body);
  const up = r.json();
  assert.deepEqual([up.records, up.vouchers, up.notUsed], [22, 21, [{ type: 'Ledger', records: 1 }]], 'a record that is not a voucher is counted as not used');
  assert.ok(up.messages.some(m => /1 Ledger record\(s\) in this file are not vouchers and were not used/.test(m)));
  assert.deepEqual(up.datasets.filter(d => ['payment', 'receipt', 'contra'].includes(d.slot)).map(d => [d.slot, d.expectedCount, d.actualCount, d.countMatches]), [['receipt', 5, 2, false], ['payment', 1, 1, true], ['contra', null, 1, null]]);
  await send('PUT', `${base}/expected-counts/receipt`, { expected: null });
  assert.equal((await put(id, 'trial_balance', trialBalanceReport(), 'TrialBal.json')).statusCode, 200);
  const original = path.join(process.env.DATA_DIR, 'uploads', id, 'trial_balance.original');
  assert.ok(fs.existsSync(original), 'the report as uploaded is kept');
  await send('PUT', `${base}/waivers/stock_summary`, { reason: 'Not needed for test' });
  r = await send('POST', `${base}/process?wait=1`);
  assert.equal(r.statusCode, 200, r.body);
  let exc = (await get(`${base}/summary`)).exceptions;
  assert.deepEqual(exc.filter(e => e.kind === 'voucher_lines_in_both_lists').map(e => e.name), ['Journal J-9']);
  assert.match(exc.find(e => e.kind === 'voucher_lines_in_both_lists').message, /only "allledgerentries" was read, because the voucher balances on it/);

  // ---- tax mapping sees the tax ledgers of journals, and tells a tax row from a ledger on the party side ----
  const taxes = Object.fromEntries((await get(`${base}/tax-mappings`)).map(t => [t.ledger, t]));
  const use = t => [t.vouchers, t.salesPurchaseVouchers, t.journalVouchers, t.taxRowVouchers, t.partySideVouchers];
  assert.deepEqual([use(taxes['Input CGST']), use(taxes['Input SGST']), use(taxes['TDS Payable']), use(taxes['Output CGST'])], [[2, 0, 2, 2, 0], [1, 0, 1, 1, 0], [1, 0, 1, 0, 1], [1, 1, 0, 1, 0]],
    'the optional journal and the Debit Note are not counted');
  assert.deepEqual(taxes['Input SGST'].appearsWith.map(a => [a.ledger, a.vouchers]), [['Input CGST', 1]]);
  assert.equal((await send('PUT', `${base}/tax-mappings`, { ledger: 'Input CGST', zohoTax: 'GST 9' })).statusCode, 200);

  // ---- journals: only the clear suggestions are accepted in bulk ----
  const journals = await get(`${base}/journals`);
  const j = n => journals.find(x => x.number === n && x.lines.length);
  assert.deepEqual(journals.map(x => [x.number, x.suggested, x.clear, x.needsCheck, x.notPosted]), [['J-1', 'Bill', true, false, null], ['J-2', 'Bill', true, true, null], ['J-3', 'Manual Journal', true, false, null],
    ['J-4', 'Manual Journal', false, false, null], ['J-5', 'Manual Journal', true, false, 'cancelled'], ['J-6', 'Bill', true, false, 'optional'], ['J-7', 'Bill', true, false, null], ['S-1', 'Invoice', true, false, null],
    ['J-8', 'Bill', true, false, null], ['J-9', 'Manual Journal', true, false, null]]);
  assert.match(j('J-8').reason, /with 1 expense, purchase or asset ledger debited/, 'the kind of a ledger is found although its master name ends in a line break');
  assert.deepEqual((await send('POST', `${base}/journals/accept-suggestions`)).json(), { accepted: 6, group: 'clear', leftForReview: { needsCheck: 1, notClear: 1 } });
  assert.equal((await send('POST', `${base}/journals/accept-suggestions`, { group: 'everything' })).statusCode, 400);
  assert.deepEqual((await get(`${base}/journals`)).filter(x => !x.decision && !x.notPosted).map(x => x.number), ['J-2', 'J-4'], 'the two that need a look wait for the user');

  // ---- files, with two journals that have no decision ----
  // v2 default 8 (changed on purpose): a journal with no decision is NOT left out of the files any more ("awaiting
  // routing" was 2, the Manual Journals file had 2 vouchers). J-2 (its suggestion, a Bill, would carry a negative row)
  // and J-4 (no clear pattern) are written as Manual Journals by default, which post exactly what Tally posted, and
  // each is flagged as an assumption.
  r = await send('POST', `${base}/generate`);
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual((await get(`${base}/summary`)).exceptions.filter(e => e.kind === 'journal_default_manual').map(e => e.name).sort(), ['Journal J-2', 'Journal J-4']);
  assert.deepEqual((await get(`${base}/journals`)).filter(x => !x.decision && !x.notPosted).map(x => [x.number, x.defaultDecision, x.defaultKind]),
    [['J-2', 'Manual Journal', 'journal_default_manual'], ['J-4', 'Manual Journal', 'journal_default_manual']], 'the review screen says what the files do with them');
  // changed on purpose in B8: the contra voucher is a Manual Journal (other_journals); the receipt from a customer, the payment to a
  // vendor and the debit note to a vendor wait for Zoho's samples; the deleted receipt is left out like any other deleted voucher
  // changed on purpose (held-vouchers batch): the receipt from a customer, the payment to a vendor and the debit note to a
  // vendor are Manual Journals too (other_journals 4), so no voucher waits for a Zoho sample
  // changed on purpose (S4): the custom type "Gate Pass" posts to the ledgers, so it is a Manual Journal (TALLY-002), and the
  // Sales voucher with the customer credited is a Manual Journal instead of left out (TALLY-003): journals 4 -> 6
  assert.deepEqual(r.json().vouchers, { stored: 21, written: { invoices: 4, bills: 3, journals: 6, other_journals: 4 }, leftOut: 3, awaitingRouting: 0,
    waitingForZohoSample: {}, keptWithoutZohoFile: { other_vouchers: 1 }, balanced: true, leftOutOutsideYear: 0 },
    'stored = written + left out + awaiting routing + waiting for a Zoho sample + kept without a Zoho file');
  exc = (await get(`${base}/summary`)).exceptions.filter(e => e.stage === 'generate');
  const kinds = () => count(exc.filter(e => e.kind), e => e.kind);
  // voucher types with no Zoho file: one item per dataset, with the count
  // changed on purpose in B8: only other voucher types are kept without a file; the held ones say which Zoho sample is needed
  assert.deepEqual(exc.filter(e => e.kind === 'vouchers_without_zoho_file').map(e => [e.slot, e.uses]), [['other_vouchers', 1]]);
  // changed on purpose (held-vouchers batch): nothing waits for a Zoho sample; each group written as a Manual Journal on
  // Accounts Receivable or Accounts Payable is one assumption, and the credits they leave are listed (credits_to_apply.csv)
  assert.deepEqual(exc.filter(e => e.kind === 'vouchers_waiting_for_zoho_sample'), []);
  assert.deepEqual(exc.filter(e => e.kind === 'payments_written_as_journals').map(e => [e.slot, e.uses]).sort(), [['debit_note', 1], ['payment', 1], ['receipt', 1]]);
  assert.match(exc.find(e => e.kind === 'payments_written_as_journals' && e.slot === 'payment').message, /1 voucher of Payment Vouchers: Money paid to a vendor is written as a Manual Journal: the vendor on Accounts Payable with the Contact Name/);
  assert.equal(exc.filter(e => e.kind === 'journal_credits_to_apply').length, 1);
  // changed on purpose (S4, TALLY-003): a reversal entered as a Sales voucher is a Manual Journal posting what Tally
  // posted (never left out), flagged with the reason
  assert.deepEqual(exc.filter(e => e.kind === 'left_out_party_side').map(e => e.name), []);
  assert.deepEqual(exc.filter(e => e.kind === 'sales_written_as_journal').map(e => e.name), ['Sales S-3']);
  assert.match(exc.find(e => e.kind === 'sales_written_as_journal').message, /cannot be written as an invoice: its party is on the other side .* posts exactly what Tally posted/);
  // a second debit line on a Sales voucher, on an expense ledger: changed on purpose (audit item 2): not a negative
  // invoice line (with a zero-rate tax and a service item on an expense account) but the invoice's Adjustment, flagged
  assert.deepEqual(exc.filter(e => e.kind === 'negative_row').map(e => e.name), []);
  assert.deepEqual(exc.filter(e => e.kind === 'invoice_line_to_adjustment').map(e => e.name), ['Sales S-2']);
  assert.match(exc.find(e => e.kind === 'invoice_line_to_adjustment').message, /"Staff Tea Expenses" is on this invoice .* but is not an income account \(an expense or purchase ledger\)\. .*written in the Adjustment column/);
  // the same Invoice Number from a Sales voucher and from a journal routed to Invoice
  const repeated = exc.filter(e => e.kind === 'document_number_repeated');
  assert.deepEqual(repeated.map(e => [e.name, e.uses]), [['Invoices: Invoice Number "S-1"', 2]]);
  assert.match(repeated[0].message, /carried by 2 different Tally vouchers in the Invoices file \((Sales Vouchers: 1, Journal Vouchers: 1|Journal Vouchers: 1, Sales Vouchers: 1)\)/);
  // a bill built from a journal with one tax ledger mapped and one not
  assert.deepEqual(exc.filter(e => e.kind === 'tax_pair_incomplete').map(e => [e.name, e.uses]), [['Input SGST', 1]]);
  assert.match(exc.find(e => e.kind === 'tax_pair_incomplete').message, /appears together with "Input CGST" \(mapped to "GST 9", 1 voucher\)/);
  // opening balances are in one import file each: the Opening Balances file is a reference report, so no balance is in two import files
  assert.deepEqual(exc.filter(e => e.kind === 'opening_balance_in_two_files'), []);
  const obFile = r.json().files.find(f => f.key === 'opening_balances');
  assert.deepEqual([obFile.referenceOnly, obFile.fileName], [true, 'opening_balances_reference_do_not_import.csv']);
  assert.match(obFile.notes, /^Reference report, do not import\./);
  assert.ok(!(await get(`${base}/imports`)).some(i => i.key === 'opening_balances'), 'the reference report is not in the import order');
  assert.equal(kinds().tax_ledger_party_side, undefined, 'the bill with tax deducted is not routed yet');

  // ---- the bill with a tax ledger credited is accepted by name; the tax ledger is not asked for a Zoho tax ----
  assert.deepEqual((await send('POST', `${base}/journals/accept-suggestions`, { group: 'needs_check' })).json(), { accepted: 1, group: 'needs_check', leftForReview: { needsCheck: 0, notClear: 1 } });
  assert.equal((await get(base)).filesOutOfDate, true);
  r = await send('POST', `${base}/generate`);
  assert.deepEqual([r.json().vouchers.written.bills, r.json().vouchers.written.journals, r.json().vouchers.awaitingRouting, r.json().vouchers.balanced], [4, 5, 0, true], 'J-2 moved from the Manual Journals file to the Bills file (S4: journals 3 -> 5 with Gate Pass and the sales reversal)');
  exc = (await get(`${base}/summary`)).exceptions.filter(e => e.stage === 'generate');
  assert.deepEqual(exc.filter(e => e.kind === 'tax_ledger_party_side').map(e => [e.name, e.uses]), [['TDS Payable', 1]]);
  // B6 (changed on purpose): the made-up "TDS Payable" has no Tally tax type TDS, so it is never put in Zoho's TDS columns by its name
  assert.match(exc.find(e => e.kind === 'tax_ledger_party_side').message, /Tax ledger "TDS Payable" is credited on 1 bill of the Bills file, the same side as the vendor. .* no Zoho tax mapping is asked for it\. Tally does not say its type of duty\/tax is TDS, so it is not put in Zoho's TDS columns \(that is never decided from the name\)\. An accountant must decide how to enter it in Zoho Books: in Zoho's TDS field \(if it is TDS, set its type to TDS in Tally and export the masters again\), as a vendor credit, or as a separate journal/);
  assert.deepEqual(exc.filter(e => /is not mapped to a Zoho tax\. Map it in Mapping Studio/.test(e.message)).map(e => e.name).sort(), ['Input SGST', 'Output CGST'], 'no mapping is asked for the tax deducted');
  assert.deepEqual(exc.filter(e => e.kind === 'negative_row').map(e => e.name).sort(), ['Journal J-2'], 'Sales S-2 has its expense line in Adjustment (audit item 2)');
  const tds = (await csvRows(id, 'bills')).find(x => x.Account === 'TDS Payable');
  // B6: Zoho's bill layout: a line with a negative amount, no tax, and nothing in the TDS columns
  assert.deepEqual([tds['Bill Number'], tds.Quantity, tds.Rate, tds['Tax Name'], tds['TDS Amount']], ['J-2', '1', '-30.00', '', '']);
  assert.deepEqual((await get(`${base}/voucher-control`)).control, { stored: 21, written: { invoices: 4, bills: 4, journals: 5, other_journals: 4 }, leftOut: 3, awaitingRouting: 0,
    waitingForZohoSample: {}, keptWithoutZohoFile: { other_vouchers: 1 }, balanced: true, leftOutOutsideYear: 0 }); // S4: Gate Pass and the sales reversal are Manual Journals // changed on purpose in B8, and in v2 (default 8: J-4 is a Manual Journal by default)
  const rep = await get(`${base}/test-report`);
  assert.equal(rep.voucherControl.balanced, true);
  assert.ok(rep.whatToFixNext.some(f => /1 tax ledger is used only on the party's side of bills or invoices .*"TDS Payable" \(1 voucher\)\. No Zoho tax mapping is needed for it/.test(f.message)));
  assert.ok(!rep.whatToFixNext.some(f => /tax ledgers? used on vouchers .* not mapped to a Zoho tax: .*TDS Payable/.test(f.message)));

  // ---- a Trial Balance report with no opening balance column: no Opening Balances file, and the closing column is not used ----
  const noOpening = Object.fromEntries(Object.entries(LEDGER_FIGURES).map(([k, [, dr, cr]]) => [k, [0, dr, cr]]));
  r = await put(id, 'trial_balance', trialBalanceReport({ figures: noOpening }), 'TrialBal-no-opening.json');
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual([r.json().trialBalance.atLedgerLevel, r.json().trialBalance.hasOpeningBalances], [true, false]);
  assert.equal((await send('POST', `${base}/process?wait=1`)).statusCode, 200);
  await send('POST', `${base}/journals/accept-suggestions`);
  r = await send('POST', `${base}/generate`);
  assert.ok(!r.json().files.some(f => f.key === 'opening_balances'));
  const notCreated = (await get(`${base}/summary`)).exceptions.filter(e => e.kind === 'opening_balances_not_created');
  assert.equal(notCreated.length, 1);
  assert.match(notCreated[0].message, /The Trial Balance report has no opening balance figures\. .* The closing balances were not used in their place/);

  // ---- a file of Trial Balance lines replaces the report: the report kept from the earlier upload is removed ----
  r = await call({ method: 'PUT', url: `${base}/uploads/trial_balance`, headers: { 'content-type': 'application/octet-stream', 'x-filename': 'tb.json' },
    payload: Buffer.from(JSON.stringify({ tallymessage: [{ metadata: { type: 'TrialBalanceLine' }, name: 'Cash', closingbalance: '-10.00' }, { metadata: { type: 'TrialBalanceLine' }, name: 'Owner Capital', closingbalance: '10.00' }] })) });
  assert.equal(r.statusCode, 200, r.body);
  assert.ok(!fs.existsSync(original), 'the earlier report is not left behind');

  // ---- the generated files are out of date after the All Transactions file is uploaded again, and after it is removed ----
  assert.equal((await send('POST', `${base}/process?wait=1`)).statusCode, 200);
  await send('POST', `${base}/journals/accept-suggestions`);
  assert.equal((await send('POST', `${base}/generate`)).statusCode, 200);
  assert.equal((await get(base)).filesOutOfDate, false);
  assert.equal((await put(id, 'all_transactions', txns, 'Transactions.json')).statusCode, 200);
  let m = await get(base);
  assert.equal(m.filesOutOfDate, true);
  assert.ok(m.outOfDateReasons.some(x => /^A new All Transactions file was uploaded \(Sales Vouchers, /.test(x.reason)), JSON.stringify(m.outOfDateReasons));
  r = await call({ url: `${base}/files/invoices/download` });
  assert.deepEqual([r.statusCode, r.json().outOfDate], [409, true]);
  assert.equal((await send('POST', `${base}/process?wait=1`)).statusCode, 200);
  await send('POST', `${base}/journals/accept-suggestions`);
  assert.equal((await send('POST', `${base}/generate`)).statusCode, 200);
  assert.equal((await get(base)).filesOutOfDate, false);
  assert.equal((await send('DELETE', `${base}/uploads/all_transactions`)).statusCode, 200);
  m = await get(base);
  assert.equal(m.filesOutOfDate, true);
  assert.ok(m.outOfDateReasons.some(x => x.reason === 'The All Transactions file "Transactions.json" was removed.'));
  assert.equal((await call({ url: `${base}/files/invoices/download` })).statusCode, 409);
  const { c } = await comp();
  assert.equal(c.allTransactions, null);
});
