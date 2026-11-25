// Stages C11 and C12: reading what Zoho Books gives back. Zoho's real error file and Trial Balance export have not
// been seen yet, so both readers are tolerant (CSV, XLSX, XLS; columns found by heading; a column picker when that
// fails) and say which columns they used. C11 groups rejections by cause with one suggested action each; C12 compares
// Zoho's Trial Balance with Tally's, account by account. Uses made-up rows and the made-up three-file samples.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import Decimal from 'decimal.js';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-zohochecks-'));
const { buildApp } = await import('../src/index.js');
const { readTable, parseDelimited } = await import('../src/sheet.js');
const { detectRejectionColumns, rejectionRecords, causeOf, suggestAction, groupRejections } = await import('../src/zohoerrors.js');
const { detectTbColumns, readZohoTb, parseDrCr, compareTb, zohoAccountOf } = await import('../src/zohotb.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const samples = path.resolve(here, '../../sample-data');
const zohoSamples = path.resolve(here, '../../zoho-samples');
const seed = JSON.parse(fs.readFileSync(path.resolve(here, '../seed-users.json'), 'utf8'));

// A minimal .xlsx (one sheet, inline strings), written with no library: a stored (uncompressed) zip.
function xlsx(rows) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const col = i => String.fromCharCode(65 + i);
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((r, i) => `<row r="${i + 1}">${r.map((c, j) => (c === '' ? '' : typeof c === 'number'
    ? `<c r="${col(j)}${i + 1}"><v>${c}</v></c>` : `<c r="${col(j)}${i + 1}" t="inlineStr"><is><t>${esc(c)}</t></is></c>`)).join('')}</row>`).join('')}</sheetData></worksheet>`;
  const files = [['[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'], ['xl/worksheets/sheet1.xml', sheet]];
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of files) {
    const data = Buffer.from(text, 'utf8'), n = Buffer.from(name, 'utf8'), crc = zlib.crc32(data);
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt32LE(crc, 14); l.writeUInt32LE(data.length, 18); l.writeUInt32LE(data.length, 22); l.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    locals.push(l, n, data); centrals.push(c, n); offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

test('sheet reader: CSV with a semicolon or tab, UTF-16, XLSX, and the official Zoho samples (old .xls and .xlsx)', () => {
  assert.deepEqual(readTable(Buffer.from('a;b\r\n1;"2;3"\r\n\r\n')).rows, [['a', 'b'], ['1', '2;3']]);
  assert.deepEqual(readTable(Buffer.from('a\tb\n1\t2\n')).rows, [['a', 'b'], ['1', '2']]);
  assert.deepEqual(readTable(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('x,y\r\n1,2', 'utf16le')])).rows, [['x', 'y'], ['1', '2']]);
  const t = readTable(xlsx([['Title'], [], ['Account', 'Net Debit'], ['Cash', 12.5]]));
  assert.equal(t.format, 'xlsx'); assert.deepEqual(t.rows, [['Title'], ['Account', 'Net Debit'], ['Cash', '12.5']]);
  assert.match(readTable(Buffer.from('<html><table>')).error, /web page/);
  assert.deepEqual(parseDelimited('"a ""q""",b', ','), [['a "q"', 'b']]);
  if (fs.existsSync(zohoSamples)) {
    const xls = readTable(fs.readFileSync(path.join(zohoSamples, 'sample_journals.xls')));
    assert.equal(xls.format, 'xls'); assert.ok(xls.rows.length > 1); assert.ok(xls.rows[0].includes('Journal Date'));
    const x = readTable(fs.readFileSync(path.join(zohoSamples, 'customer_import_sample_data.xls')));
    assert.equal(x.format, 'xlsx'); assert.equal(x.rows[0][0], 'Display Name');
  }
});

test('C11 rules: the heading row and the columns are found by heading or picked; one rejection per record with every message', () => {
  const rows = [['Import errors'], ['Invoice Number', 'Customer Name', 'Error Message', 'Reason code'], ['INV-1', 'Alpha Ltd', 'Customer "Alpha Ltd" does not exist'], ['INV-1', 'Alpha Ltd', 'Tax "GST 18" not found'], ['INV-2', 'Beta Ltd', 'Customer "Beta Ltd" does not exist'], ['', '', 'stray']];
  const c = detectRejectionColumns(rows, { idHeading: 'Invoice Number' });
  assert.deepEqual([c.headerRow, c.idColumn, c.errorColumn], [1, 'Invoice Number', 'Error Message'], 'an "error" heading is preferred to "reason"');
  assert.deepEqual(c.otherErrorColumns, ['Reason code']);
  assert.equal(detectRejectionColumns(rows, { idHeading: 'invoice_number' }).idColumn, 'Invoice Number', 'capitals, spaces and punctuation are ignored');
  const picked = detectRejectionColumns(rows, { idHeading: 'Invoice Number', errorColumn: 'Reason code' });
  assert.equal(picked.errorColumn, 'Reason code'); assert.equal(picked.how.error, 'chosen by you');
  const none = detectRejectionColumns(rows, { idHeading: 'Bill Number' });
  assert.equal(none.needsColumns, true); assert.match(none.error, /no "Bill Number" column/);
  assert.ok(none.headers.includes('Customer Name'), 'the headings are offered to pick from');
  assert.equal(detectRejectionColumns(rows, { idHeading: 'Bill Number', idColumn: 'Customer Name' }).idColumn, 'Customer Name');
  assert.match(detectRejectionColumns([['Invoice Number', 'Total']], { idHeading: 'Invoice Number' }).error, /No error column found/);
  const { records, blankIdent } = rejectionRecords(rows, c);
  assert.deepEqual(records.map(r => [r.ident, r.messages.length]), [['INV-1', 2], ['INV-2', 1]]);
  assert.equal(blankIdent, 1);
});

test('C11 rules: the cause leaves out what belongs to one record, and each cause gets one action with its place', () => {
  assert.equal(causeOf('Customer "Alpha Ltd" does not exist.'), causeOf("Customer 'Beta Ltd' does not exist"));
  assert.equal(causeOf('The customer Alpha Ltd does not exist', ['Alpha Ltd']), causeOf('The customer Beta Traders does not exist', ['Beta Traders']));
  assert.equal(causeOf('GSTIN 27ABCDE1234F1Z5 is invalid for row 12'), 'gstin <gstin> is invalid for row #');
  assert.notEqual(causeOf('Customer does not exist'), causeOf('Item does not exist'));
  assert.equal(causeOf(''), '(no message)');
  const code = (m, k) => suggestAction(causeOf(m), k).code;
  assert.equal(code('Invalid GSTIN', 'customers'), 'contact_fixes');
  assert.equal(code('Place of supply is mandatory', 'invoices'), 'contact_fixes');
  assert.equal(code('GST Treatment "business_gst" is not valid', 'customers'), 'gst_codes');
  assert.equal(code('Account with this name already exists', 'accounts'), 'builtin_accounts');
  assert.equal(code('Contact name already exists', 'vendors'), 'names');
  assert.equal(code('Customer "X" does not exist', 'invoices'), 'import_order');
  assert.equal(code('Tax "GST18" not found', 'bills'), 'tax_mapping');
  assert.equal(code('Intra state tax is invalid', 'items'), 'item_rates');
  assert.equal(code('Rate is required', 'items'), 'item_rates');
  assert.equal(code('TDS tax not found', 'bills'), 'tds_mapping');
  assert.equal(code('Debit and credit totals must be equal', 'journals'), 'journal_routing');
  assert.equal(code('Name contains a line break', 'customers'), 'names');
  assert.equal(code('Something odd happened', 'customers'), 'by_hand');
  for (const k of ['contact_fixes', 'names', 'tax_mapping']) assert.ok(suggestAction(k === 'names' ? 'duplicate' : k === 'tax_mapping' ? 'tax missing' : 'gstin', k === 'names' ? 'customers' : 'bills').screen);
  const groups = groupRejections([
    { id: 1, key: 'invoices', module: 'Invoices', ident: 'INV-1', status: 'open', messages: ['a', 'b'], causes: ['customer "…" does not exist', 'tax "…" not found'] },
    { id: 2, key: 'invoices', module: 'Invoices', ident: 'INV-2', status: 'corrected', messages: ['c'], causes: ['customer "…" does not exist'] },
  ]);
  assert.deepEqual(groups.map(g => [g.cause, g.records, g.open]), [['customer "…" does not exist', 2, 1], ['tax "…" not found', 1, 1]]);
  assert.equal(groups[0].action.code, 'import_order');
});

test('C12 rules: Zoho Trial Balance columns, Dr/Cr figures, headings and totals, and the comparison', () => {
  const rows = [['My Org'], ['Trial Balance'], ['As of 31/03/2025'], ['Account', 'Account Code', 'Net Debit', 'Net Credit'], ['Assets', '', '', ''],
    ['Cash', '', '1,000.00', ''], ['Sales', '', '', '1,500.00'], ['Accounts Receivable', '', '500.00', ''], ['Total', '', '1,500.00', '1,500.00']];
  const c = detectTbColumns(rows);
  assert.deepEqual([c.headerRow, c.account, c.debit, c.credit, c.balance], [3, 'Account', 'Net Debit', 'Net Credit', null], 'a code column is never the name');
  const r = readZohoTb(rows, c);
  assert.deepEqual(r.accounts.map(a => [a.name, a.amount.toFixed(2)]), [['Cash', '-1000.00'], ['Sales', '1500.00'], ['Accounts Receivable', '-500.00']], 'Tally sign: a debit is negative');
  assert.deepEqual(r.headings, ['Assets']); assert.equal(r.totals.length, 1);
  // two debit columns: ask
  const two = detectTbColumns([['Account', 'Opening Debit', 'Opening Credit', 'Closing Debit', 'Closing Credit']]);
  assert.deepEqual([two.debit, two.credit], ['Closing Debit', 'Closing Credit'], '"closing" is preferred');
  const amb = detectTbColumns([['Account', 'Debit A', 'Debit B', 'Credit A', 'Credit B']]);
  assert.equal(amb.needsColumns, true); assert.match(amb.error, /More than one debit column/);
  const picked = detectTbColumns([['Account', 'Debit A', 'Debit B', 'Credit A', 'Credit B']], { debitColumn: 'Debit B', creditColumn: 'Credit B' });
  assert.deepEqual([picked.debit, picked.credit, picked.how.figures], ['Debit B', 'Credit B', 'chosen by you']);
  assert.match(detectTbColumns([['Account', 'Debit']], { debitColumn: 'Debit' }).error, /both the debit column and the credit column/);
  // one balance column
  assert.deepEqual([parseDrCr('1,234.50 Dr').side, parseDrCr('1,234.50 Dr').value.toFixed(2)], ['dr', '1234.50']);
  assert.equal(parseDrCr('Cr 50').side, 'cr'); assert.equal(parseDrCr('100.00 (Cr)').side, 'cr'); assert.equal(parseDrCr('').blank, true);
  const bal = [['Account Name', 'Balance'], ['Cash', '100.00 Dr'], ['Capital', '100.00 Cr'], ['Odd', 'abc']];
  const bc = detectTbColumns(bal);
  const br = readZohoTb(bal, bc);
  assert.deepEqual(br.accounts.map(a => a.amount.toFixed(2)), ['-100.00', '100.00']); assert.deepEqual(br.unreadable.map(u => u.name), ['Odd']);
  const plain = [['Account Name', 'Balance'], ['Cash', '100.00'], ['Zero', '0']];
  assert.deepEqual(readZohoTb(plain, detectTbColumns(plain)).needsSign, ['Cash'], 'a balance without Dr/Cr is never guessed');
  assert.equal(readZohoTb(plain, detectTbColumns(plain), { balanceSign: 'debit_positive' }).accounts[0].amount.toFixed(2), '-100.00');

  // the Tally side under Zoho's names
  const ctx = { groupParents: { 'Local Debtors': 'Sundry Debtors' }, clashDecisions: { 'Advance Tax': { decision: 'zoho' }, 'TDS Receivable': { decision: 'rename', newName: 'TDS Receivable (Tally)' } }, nameDecisions: {},
    outputName: n => ({ 'Advance Tax': 'Advance Tax', 'TDS Receivable': 'TDS Receivable (Tally)' }[n] || n) };
  assert.equal(zohoAccountOf('A Ltd', { parent: 'Local Debtors' }, ctx).zohoName, 'Accounts Receivable');
  assert.equal(zohoAccountOf('V Ltd', { parent: 'X', vendor: true }, ctx).zohoName, 'Accounts Payable');
  assert.ok(zohoAccountOf('Profit & Loss A/c', { parent: '' }, ctx).notCompared);
  assert.equal(zohoAccountOf('Advance Tax', { parent: 'Current Assets' }, ctx).how, 'zoho_account');
  assert.equal(zohoAccountOf('TDS Receivable', { parent: 'Current Assets' }, ctx).zohoName, 'TDS Receivable (Tally)');

  const D = s => new Decimal(s);
  const cmp = compareTb([
    { ledger: 'Cash', zohoName: 'Cash', amount: D('-1000'), how: 'ledger' },
    { ledger: 'A Ltd', zohoName: 'Accounts Receivable', amount: D('-300'), how: 'customer' }, { ledger: 'B Ltd', zohoName: 'Accounts Receivable', amount: D('-200'), how: 'customer' },
    { ledger: 'Sales', zohoName: 'Sales', amount: D('1400'), how: 'ledger' },
    { ledger: 'Rent', zohoName: 'Rent', amount: D('-50'), how: 'ledger' },
    { ledger: 'Old', zohoName: 'Old', amount: D('0'), how: 'ledger' },
  ], [...r.accounts, { name: 'Opening Balance Adjustments', amount: D('5') }, { name: 'Unused', amount: D('0') }]);
  assert.deepEqual(cmp.counts, { matched: 3, differing: 1, onlyTally: 1, onlyZoho: 1 });
  assert.equal(cmp.matched.find(m => m.account === 'Accounts Receivable').note.startsWith('2 customer ledger(s)'), true);
  assert.deepEqual([cmp.differing[0].account, cmp.differing[0].tally.signed, cmp.differing[0].zoho.signed, cmp.differing[0].difference.signed], ['Sales', '1400.00', '1500.00', '100.00']);
  assert.equal(cmp.onlyTally[0].account, 'Rent');
  assert.match(cmp.onlyZoho[0].note, /other side of every opening balance/);
  assert.deepEqual([cmp.totals.tally.debit, cmp.totals.tally.credit, cmp.totals.zoho.debit, cmp.totals.zoho.credit], ['1550.00', '1400.00', '1500.00', '1505.00']);
  assert.equal(cmp.totals.agree, false);
});

test('C11 and C12 end to end: an XLSX error file grouped by cause, and the Zoho Trial Balance compared with Tally', async () => {
  const app = buildApp();
  let cookie = '';
  const call = opts => app.inject({ ...opts, headers: { ...(opts.headers || {}), ...(cookie ? { cookie } : {}) } });
  const login = async role => { const u = seed.users.find(x => x.role === role); const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: u.email, password: u.password } }); cookie = String(r.headers['set-cookie']).split(';')[0]; };
  const get = async url => { const r = await call({ url }); assert.equal(r.statusCode, 200, `${url}: ${r.body}`); return r.json(); };
  const ok = async (method, url, payload) => { const r = await call({ method, url, payload }); assert.equal(r.statusCode, 200, `${method} ${url}: ${r.body}`); return r.json(); };
  const sendFile = (url, buf, name = 'file.csv') => call({ method: 'PUT', url, headers: { 'content-type': 'application/octet-stream', 'x-filename': name }, payload: buf });
  await login('analyst');
  const doc = JSON.parse(fs.readFileSync(path.join(samples, '15_all_masters_for_transactions_utf16.json')).toString('utf16le').replace(/^﻿/, ''));
  const company = (doc.static_variables || []).find(v => v.name === 'svCurrentCompany')?.value || 'Made-up Company';
  const id = (await call({ method: 'POST', url: '/api/migrations', payload: { company, financialYear: '2024-25' } })).json().id;
  const base = `/api/migrations/${id}`;
  for (const [slot, f] of [['all_masters', '15_all_masters_for_transactions_utf16.json'], ['all_transactions', '16_all_transactions_utf16.json'], ['trial_balance', '17_trial_balance_report_utf16.json']]) {
    assert.equal((await sendFile(`${base}/uploads/${slot}`, fs.readFileSync(path.join(samples, f)), f)).statusCode, 200);
  }
  for (const s of (await get(`${base}/completeness`)).slots.filter(x => x.requirement !== 'optional' && x.status === 'missing')) await ok('PUT', `${base}/waivers/${s.key}`, { reason: 'none' });
  assert.equal((await call({ method: 'POST', url: `${base}/process?wait=1` })).statusCode, 200);
  assert.equal((await call({ method: 'POST', url: `${base}/generate` })).statusCode, 200);

  // ----- C11: an XLSX error file with a title row, two lines for one document -----
  const files = await get(`${base}/files`);
  const cust = files.find(f => f.key === 'customers');
  assert.ok(cust, 'a Customers file');
  const { parseCsv } = await import('../src/zoho.js');
  // (confirmed=1: the Customers file carries opening balances and the Migration Date is not checked yet, so the plain download asks first)
  const idents = parseCsv((await call({ url: `${base}/files/customers/download?confirmed=1` })).body).rows.map(x => x['Display Name']).slice(0, 2);
  assert.equal(idents.length, 2, 'customers to reject');
  const err = xlsx([['Zoho import log'], ['Display Name', 'Error Message'],
    [idents[0], `Invalid GSTIN for "${idents[0]}"`], [idents[0], 'Place of contact is mandatory'], [idents[1], `Invalid GSTIN for "${idents[1]}"`], ['Nobody Ltd', 'Contact already exists']]);
  let r = await sendFile(`${base}/rejections/customers`, err, 'errors.xlsx');
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(r.json(), { rejected: 3, linked: 2, unlinked: 1 }, 'the answer keeps its shape');
  let gr = await get(`${base}/rejections/groups`);
  // changed on purpose (wizard-check batch): the layout of Zoho's error file is confirmed (ROWNUMBER and ERRORMESSAGE in
  // front), and a file in another layout, like this one, is still read with the columns shown
  assert.match(gr.note, /ROWNUMBER and ERRORMESSAGE/);
  assert.match(gr.note, /another layout is read too/);
  assert.deepEqual([gr.runs[0].format, gr.runs[0].headerRow, gr.runs[0].idColumn, gr.runs[0].errorColumn, gr.runs[0].fileName], ['xlsx', 2, 'Display Name', 'Error Message', 'errors.xlsx']);
  const gstin = gr.groups.find(g => g.cause === 'invalid gstin for "…"');
  assert.ok(gstin, JSON.stringify(gr.groups.map(g => g.cause)));
  assert.deepEqual([gstin.records, gstin.action.code, gstin.action.screen, gstin.action.anchor], [2, 'contact_fixes', 'screen-19', 'ms-fix-contacts']);
  assert.equal(gr.groups.find(g => /already exists/.test(g.cause)).action.code, 'names');
  assert.equal(gr.groups.find(g => /place of contact/.test(g.cause)).records, 1, 'a record with two messages is in both groups');
  assert.ok((await get(`${base}/rejections`)).find(x => x.ident === idents[0]).error.includes(' | '), 'every message is kept');
  // the column picker: an unknown heading, then picked
  r = await sendFile(`${base}/rejections/customers`, Buffer.from('Contact,Problem\r\nX,Y\r\n'));
  assert.equal(r.statusCode, 422); assert.equal(r.json().needsColumns, true); assert.deepEqual(r.json().headers, ['Contact', 'Problem']);
  r = await sendFile(`${base}/rejections/customers?idColumn=Contact&errorColumn=Problem`, Buffer.from(`Contact,Problem\r\n"${idents[0]}",Odd thing\r\n`));
  assert.equal(r.statusCode, 200, r.body);
  gr = await get(`${base}/rejections/groups`);
  assert.deepEqual([gr.runs[0].idColumn, gr.runs[0].how.id, gr.groups[0].action.code], ['Contact', 'chosen by you', 'by_hand']);
  assert.ok((await get(`${base}/audit`)).some(a => a.action === 'rejection_file_uploaded' && /chosen by you/.test(a.detail)));

  // ----- C12: the Zoho Trial Balance -----
  let v = await get(`${base}/zoho-trial-balance`);
  assert.equal(v.check, null); assert.match(v.note, /checked against one real Zoho Books export/);
  r = await sendFile(`${base}/zoho-trial-balance`, Buffer.from('Name,Something\r\nCash,1\r\n'));
  assert.equal(r.statusCode, 422); assert.equal(r.json().needsColumns, true);
  // a first report with one account gives the Tally side of every account
  r = await sendFile(`${base}/zoho-trial-balance`, Buffer.from('Account,Net Debit,Net Credit\r\nNot in Tally,1.00,\r\n'), 'tb.csv');
  assert.equal(r.statusCode, 200, r.body);
  v = r.json();
  assert.equal(v.check.columns.debit, 'Net Debit');
  const tallySide = [...v.comparison.onlyTally, ...v.comparison.differing, ...v.comparison.matched.filter(m => m.tally && m.tally.signed !== '0.00')];
  assert.ok(tallySide.length > 2, 'the made-up Trial Balance has ledgers');
  assert.equal(v.comparison.onlyZoho[0].account, 'Not in Tally');
  // a report with exactly Tally's figures agrees line by line (XLSX, title rows, Dr/Cr balance column)
  const rows = [['Made-up Org'], ['Trial Balance'], ['Account Name', 'Account Code', 'Balance'], ['Assets', '', ''],
    ...tallySide.map(t => [t.account, '', `${t.tally.amount} ${t.tally.side === 'Debit' ? 'Dr' : 'Cr'}`]), ['Total', '', '']];
  r = await sendFile(`${base}/zoho-trial-balance`, xlsx(rows), 'tb.xlsx');
  assert.equal(r.statusCode, 200, r.body);
  v = r.json();
  assert.deepEqual([v.check.format, v.check.columns.balance, v.comparison.counts.differing, v.comparison.counts.onlyTally, v.comparison.counts.onlyZoho], ['xlsx', 'Balance', 0, 0, 0]);
  assert.equal(v.comparison.totals.agree, true);
  assert.ok(v.check.headingsLeftOut.includes('Assets'));
  // one figure different: listed with both figures
  const changed = rows.map((x, i) => (i === 4 ? [x[0], '', `${new Decimal(tallySide[0].tally.amount).plus(10).toFixed(2)} ${tallySide[0].tally.side === 'Debit' ? 'Dr' : 'Cr'}`] : x));
  v = (await sendFile(`${base}/zoho-trial-balance`, xlsx(changed), 'tb.xlsx')).json();
  assert.equal(v.comparison.counts.differing, 1);
  assert.equal(v.comparison.differing[0].account, tallySide[0].account);
  assert.equal(new Decimal(v.comparison.differing[0].difference.amount).toFixed(2), '10.00');
  // the opening balances instead
  v = await ok('PUT', `${base}/zoho-trial-balance/basis`, { basis: 'opening' });
  assert.equal(v.check.basis, 'opening'); assert.match(v.comparison.basisWords, /opening/);
  assert.ok((await get(`${base}/audit`)).some(a => a.action === 'zoho_trial_balance_uploaded' && /heading row\(s\) and \d+ total row\(s\) left out/.test(a.detail)));
  // a balance column without Dr/Cr needs the sign
  r = await sendFile(`${base}/zoho-trial-balance`, Buffer.from('Account Name,Balance\r\nCash,100.00\r\n'));
  assert.equal(r.statusCode, 422); assert.equal(r.json().needsSign, true);
  r = await sendFile(`${base}/zoho-trial-balance?balanceSign=debit_positive`, Buffer.from('Account Name,Balance\r\nCash,100.00\r\n'));
  assert.equal(r.statusCode, 200);
  assert.equal((await ok('DELETE', `${base}/zoho-trial-balance`)).check, null);
  // viewers read only
  await login('viewer');
  assert.equal((await sendFile(`${base}/zoho-trial-balance`, Buffer.from('a'))).statusCode, 403);
});
