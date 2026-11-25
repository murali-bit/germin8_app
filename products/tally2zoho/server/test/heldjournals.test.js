// User decision 1 (held-vouchers batch): receipts from customers, payments to vendors, debit notes to vendors and credit
// notes to customers are written NOW as Manual Journals (the party on Accounts Receivable / Accounts Payable with the
// Contact Name), so no voucher is held and nothing is typed. The credits these journals leave on contacts are listed
// in credits_to_apply.csv (not for import) from Tally's bill-wise allocations, and the Import Wizard has a page for
// them after the journals. The route "module_files" (held for Zoho's Payments files) stays as a choice, and a voucher
// is in exactly one of the two routes.
// Every value here is MADE UP (see fixtures/allTransactions.js); only the structure copies real exports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import Decimal from 'decimal.js';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-heldjournals-'));
const { buildApp } = await import('../src/index.js');
const { NameSet } = await import('../src/tally.js');
const { buildVoucherOutput } = await import('../src/vouchers.js');
const { creditView, creditListRows, creditSummary, CREDIT_LIST_HEADINGS, JOURNAL_CATEGORIES, MODULE_AS_JOURNAL } = await import('../src/payments.js');
const { parseCsv } = await import('../src/zoho.js');
const { checkFiles } = await import('../src/zohocheck.js');
const { mastersDoc, VOUCHERS, transactionsDoc, trialBalanceReport, utf16le, voucher, line, bills } = await import('../fixtures/allTransactions.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(fs.readFileSync(path.resolve(here, '../seed-users.json'), 'utf8'));
const P = { ispartyledger: true };

// ---------- the rules, on made-up vouchers ----------
const KINDS = { 'Main Bank': 'bank', 'Office Rent': 'expense', 'Bank Charges': 'expense', 'Service Income': 'income', 'Input IGST': 'tax',
  'Alder Retail': 'customer', 'Cedar Traders': 'customer', 'Elm Works': 'vendor', 'Fir Logistics': 'vendor' };
const ctx = (extra = {}) => ({ customers: new NameSet(['Alder Retail', 'Cedar Traders']), vendors: new NameSet(['Elm Works', 'Fir Logistics']), taxLedgers: new NameSet(['Input IGST']),
  kindOf: name => KINDS[name] ?? null, taxInfo: () => ({ tds: false, gst: true, head: 'IGST', rate: null }), accountName: x => x, ...extra });
let nextId = 1;
const rec = (slot, data, decision) => ({ id: nextId++, source_id: `src-${nextId}`, name: `${data.vouchertypename} ${data.vouchernumber}`, slot, data, decision });
const SLOT = { Receipt: 'receipt', Payment: 'payment', Contra: 'contra', 'Debit Note': 'debit_note', 'Credit Note': 'credit_note', Sales: 'sales', Journal: 'journal' };
const v = (type, number, date, lines, opts) => rec(SLOT[type], voucher(type, number, date, lines, opts));
const allocs = list => ({ billallocations: list.map(([name, billtype, amount]) => ({ name, billtype, amount })) });
const sum = (rows, col) => rows.reduce((t, r) => t.plus(r[col] || 0), new Decimal(0)).toFixed(2);

const made = () => [
  v('Sales', 'INV-1', '20240401', [line('Alder Retail', '-1000.00', { ...P, ...bills('REF-A', 'New Ref', '-1000.00') }), line('Service Income', '1000.00')], { view: 'invoice', party: 'Alder Retail' }),
  rec('journal', voucher('Journal', 'J-7', '20240402', [line('Office Rent', '-500.00'), line('Elm Works', '500.00', { ...P, ...bills('EB-1', 'New Ref', '500.00') })], { party: 'Elm Works' }), 'Bill'),
  // a receipt: 400 against the invoice, 200 against an invoice from before the migration, 50 an advance
  v('Receipt', '7', '20240410', [line('Main Bank', '-650.00'), line('Alder Retail', '650.00', { ...P, ...allocs([['REF-A', 'Agst Ref', '400.00'], ['OLD-2023', 'Agst Ref', '200.00'], ['ADV-1', 'Advance', '50.00']]) })], { party: 'Alder Retail' }),
  // a payment with a bank charge line: every line stays, as in Tally
  v('Payment', '7', '20240411', [line('Elm Works', '-500.00', { ...P, ...bills('EB-1', 'Agst Ref', '-500.00') }), line('Bank Charges', '-5.00'), line('Main Bank', '505.00')], { party: 'Elm Works' }),
  // a debit note to a vendor with GST
  v('Debit Note', '7', '20240412', [line('Fir Logistics', '-118.00', P), line('Office Rent', '100.00'), line('Input IGST', '18.00')], { party: 'Fir Logistics' }),
  // a credit note to a customer
  v('Credit Note', '7', '20240413', [line('Service Income', '-40.00'), line('Cedar Traders', '40.00', P)], { party: 'Cedar Traders' }),
  // the same Tally number again within one voucher type, with no bill-wise details
  v('Receipt', '7', '20240414', [line('Main Bank', '-25.00'), line('Cedar Traders', '25.00', P)], { party: 'Cedar Traders' }),
];

test('default route: customer and vendor payments and notes are Manual Journals on AR/AP with the contact; nothing is held', () => {
  const out = buildVoucherOutput(made(), ctx());
  assert.deepEqual([out.held.length, out.other_journals.vouchers, out.invoices.vouchers, out.bills.vouchers], [0, 5, 1, 1]);
  assert.ok(!out.recon.some(e => e.outcome === 'held'), 'no voucher is held');
  assert.ok(!out.exceptions.some(e => /^Left out/.test(e.message)));
  const rows = out.other_journals.rows.map(r => r.row);
  const shape = rows.map(r => [r['Reference Number'], r.Account, r['Contact Name'], r.Debit, r.Credit]);
  assert.deepEqual(shape, [
    ['RCT-7', 'Main Bank', '', '650.00', ''], ['RCT-7', 'Accounts Receivable', 'Alder Retail', '', '650.00'],
    ['PMT-7', 'Accounts Payable', 'Elm Works', '500.00', ''], ['PMT-7', 'Bank Charges', '', '5.00', ''], ['PMT-7', 'Main Bank', '', '', '505.00'],
    ['DN-7', 'Accounts Payable', 'Fir Logistics', '118.00', ''], ['DN-7', 'Office Rent', '', '', '100.00'], ['DN-7', 'Input IGST', '', '', '18.00'],
    ['CN-7', 'Service Income', '', '40.00', ''], ['CN-7', 'Accounts Receivable', 'Cedar Traders', '', '40.00'],
    // the second "Receipt 7": Zoho reads rows with one journal number as one journal, so it gets a number of its own
    ['RCT-7-2', 'Main Bank', '', '25.00', ''], ['RCT-7-2', 'Accounts Receivable', 'Cedar Traders', '', '25.00']]);
  // every journal balances, and its number is one prefix + suffix that no other journal has
  const byNumber = Map.groupBy(rows, r => r['Reference Number']);
  for (const [n, list] of byNumber) {
    assert.equal(sum(list, 'Debit'), sum(list, 'Credit'), n);
    assert.ok(list.every(r => `${r['Journal Number Prefix']}${r['Journal Number Suffix']}` === n), n);
  }
  assert.equal(byNumber.size, 5);
  assert.deepEqual(out.repeatedNumbers, []);
  assert.deepEqual(out.exceptions.filter(e => e.kind === 'journal_number_made_unique').map(e => e.rec.data.vouchertypename), ['Receipt']);
  // the summary groups: one per kind, never "not clear"
  assert.deepEqual(out.journalCategories.map(c => [c.slot, c.category, c.vouchers]), [['receipt', 'customer_payment_as_journal', 2], ['payment', 'vendor_payment_as_journal', 1],
    ['debit_note', 'vendor_credit_as_journal', 1], ['credit_note', 'credit_note_as_journal', 1]]);
  for (const k of Object.values(MODULE_AS_JOURNAL)) assert.match(JOURNAL_CATEGORIES[k], /written as (a )?Manual Journals?/);
  assert.ok(!out.exceptions.some(e => e.kind === 'money_voucher_unclear'));
  // the voucher reconciliation: each one written, in the journals file of receipts and payments
  assert.deepEqual(out.recon.filter(e => ['receipt', 'payment', 'debit_note', 'credit_note'].includes(e.slot)).map(e => [e.outcome, e.file, e.number]),
    [['written', 'other_journals', 'RCT-7'], ['written', 'other_journals', 'PMT-7'], ['written', 'other_journals', 'DN-7'], ['written', 'other_journals', 'CN-7'], ['written', 'other_journals', 'RCT-7-2']]);
});

test('one route per voucher: with "module_files" the same vouchers are held and none of them is in the journals file', () => {
  const journals = buildVoucherOutput(made(), ctx());
  const held = buildVoucherOutput(made(), ctx({ settings: { paymentsRoute: 'module_files' } }));
  assert.deepEqual(held.held.map(h => h.file), ['payments_received', 'payments_made', 'vendor_credits', 'credit_notes', 'payments_received']);
  assert.equal(held.other_journals.vouchers, 0);
  assert.equal(held.credits.length, 0, 'a held voucher is never also in the list of credits to apply');
  assert.equal(journals.other_journals.vouchers + journals.held.length, held.other_journals.vouchers + held.held.length, 'the same vouchers, in one place each');
});

test('credits to apply: one row per Tally allocation, every unit of each credit accounted for, never more than what is left of a document', () => {
  const out = buildVoucherOutput(made(), ctx());
  const views = out.credits.map(c => creditView(c, x => x));
  const by = Object.fromEntries(views.map(c => [c.journalNumber, c]));
  assert.deepEqual(Object.keys(by), ['RCT-7', 'PMT-7', 'DN-7', 'CN-7', 'RCT-7-2']);
  // the receipt: 400 to the invoice, 200 against a document from before the migration, 50 an advance
  assert.deepEqual([by['RCT-7'].contact, by['RCT-7'].contactType, by['RCT-7'].account, by['RCT-7'].amount, by['RCT-7'].applied, by['RCT-7'].unapplied], ['Alder Retail', 'customer', 'Accounts Receivable', '650.00', '400.00', '250.00']);
  assert.deepEqual(by['RCT-7'].rows.map(r => [r.what, r.document, r.number, r.amount]), [['apply', 'invoice', 'INV-1', '400.00'], ['opening_balance', 'invoice', '', '200.00'], ['leave', 'invoice', '', '50.00']]);
  assert.match(by['RCT-7'].rows[1].note, /"OLD-2023", an invoice from before this migration: it is part of the opening balance of the contact/);
  assert.match(by['RCT-7'].rows[2].note, /Advance "ADV-1" in Tally: not set against any invoice/);
  // the payment: the bill in full (the bank charge is not a credit of the vendor)
  assert.deepEqual([by['PMT-7'].contactType, by['PMT-7'].account, by['PMT-7'].amount, by['PMT-7'].rows.map(r => [r.what, r.document, r.number, r.amount])], ['vendor', 'Accounts Payable', '500.00', [['apply', 'bill', 'J-7', '500.00']]]);
  // no bill-wise details in Tally: the whole amount stays a credit, with the reason
  assert.deepEqual(by['RCT-7-2'].rows.map(r => [r.what, r.amount]), [['leave', '25.00']]);
  assert.match(by['RCT-7-2'].rows[0].note, /Tally has no bill-wise details for this amount/);
  assert.deepEqual(by['DN-7'].rows.map(r => [r.what, r.amount]), [['leave', '118.00']]);
  // every credit: its rows add up to its amount
  for (const c of views) assert.equal(sum(c.rows, 'amount'), c.amount, c.journalNumber);
  // the list: Zoho's click order (customers, then vendors; rows to apply first), and the counts for the screens
  const list = creditListRows(views, k => `${k}.csv`);
  assert.deepEqual(Object.keys(list[0]).filter(k => k !== '_what'), CREDIT_LIST_HEADINGS);
  assert.deepEqual(list.map(r => [r['Contact Type'], r.Contact, r['Journal Number'], r['What To Do'], r['Invoice or Bill Number'], r.Amount]), [
    ['Customer', 'Alder Retail', 'RCT-7', 'Apply to invoice', 'INV-1', '400.00'],
    ['Customer', 'Alder Retail', 'RCT-7', 'Opening balance (apply if offered, else leave)', '', '200.00'],
    ['Customer', 'Alder Retail', 'RCT-7', 'Leave as credit (same as Tally)', '', '50.00'],
    ['Customer', 'Cedar Traders', 'CN-7', 'Leave as credit (same as Tally)', '', '40.00'],
    ['Customer', 'Cedar Traders', 'RCT-7-2', 'Leave as credit (same as Tally)', '', '25.00'],
    ['Vendor', 'Elm Works', 'PMT-7', 'Apply to bill', 'J-7', '500.00'],
    ['Vendor', 'Fir Logistics', 'DN-7', 'Leave as credit (same as Tally)', '', '118.00']]);
  assert.equal(list[0]['Journal File'], 'other_journals.csv');
  assert.deepEqual(creditSummary(views), { journals: 5, credits: 5, contacts: 4, apply: { rows: 2, amount: '900.00', invoices: 1, bills: 1 },
    openingBalance: { rows: 1, amount: '200.00' }, leave: { rows: 4, amount: '233.00' } });

  // an allocation larger than what is left of the invoice is never applied: it stays a credit and is flagged
  const over = buildVoucherOutput([...made(),
    v('Receipt', '8', '20240420', [line('Main Bank', '-700.00'), line('Alder Retail', '700.00', { ...P, ...allocs([['REF-A', 'Agst Ref', '700.00']]) })], { party: 'Alder Retail' })], ctx());
  const r8 = creditView(over.credits.find(c => c.journal.number === 'RCT-8'), x => x);
  assert.deepEqual(r8.rows.map(r => [r.what, r.amount]), [['leave', '700.00']]);
  assert.match(r8.rows[0].note, /more than what is left of that invoice/);
  assert.deepEqual(over.exceptions.filter(e => e.kind === 'allocation_exceeds_document').map(e => e.rec.data.vouchernumber), ['8']);

  // an allocation on the opposite side of the line is already taken off the line in Tally: it is no part of the credit.
  // The rows still add up to exactly the journal line (300.00), never to more than the credit Zoho Books holds.
  const opp = buildVoucherOutput([...made().slice(0, 2),
    v('Payment', '9', '20240421', [line('Elm Works', '-300.00', { ...P, ...allocs([['EB-1', 'Agst Ref', '-200.00'], ['NEW-9', 'New Ref', '-150.00'], ['EB-X', 'Agst Ref', '50.00']]) }), line('Main Bank', '300.00')], { party: 'Elm Works' })], ctx());
  const p9 = creditView(opp.credits.find(c => c.journal.number === 'PMT-9'), x => x);
  assert.deepEqual(p9.rows.map(r => [r.what, r.number, r.amount]), [['apply', 'J-7', '200.00'], ['leave', '', '100.00'], ['note', '', '0.00']]);
  assert.equal(sum(p9.rows, 'amount'), '300.00');
  assert.match(p9.rows[1].note, /Tally shows 150\.00 here; 100\.00 of it is left as credit after the amount on the opposite side/);
  assert.match(p9.rows[2].note, /"EB-X" is on the opposite side in Tally, so what it settles is not certain\. Tally shows 50\.00 there\. It is already taken off the amount of this journal line/);
  assert.deepEqual(creditListRows([p9]).map(r => r['What To Do']), ['Apply to bill', 'Leave as credit (same as Tally)', 'Note (nothing to do)']);
  assert.deepEqual(creditSummary([p9]).leave, { rows: 1, amount: '100.00' }, 'a note is not counted as an amount left as credit');
});

test('a journal that already was a Manual Journal (a receipt with a fee to a vendor) is in the list too; a contra is not', () => {
  const out = buildVoucherOutput([
    // two parties: not a plain receipt, so it always was a Manual Journal
    v('Receipt', '1', '20240501', [line('Main Bank', '-90.00'), line('Elm Works', '-10.00', P), line('Alder Retail', '100.00', P)], { party: 'Alder Retail' }),
    v('Contra', '1', '20240502', [line('Main Bank', '-50.00'), line('Main Bank', '50.00')]),
  ], ctx({ kindOf: name => (name === 'Main Bank' ? 'bank' : KINDS[name] ?? null) }));
  assert.deepEqual(out.credits.map(c => [c.journal.number, c.file, c.party.ledger]).sort(), [['RCT-1', 'payments_made', 'Elm Works'], ['RCT-1', 'payments_received', 'Alder Retail']]);
});

// ---------- the Zoho check: a counted note, never a refusal ----------
const table = (headers, rows) => ({ headers, rows: rows.map(r => headers.map(h => String(r[h] ?? ''))) });
const ZOHO_ACCOUNTS = ['Main Bank', 'Office Rent', 'Bank Charges', 'Service Income', 'Input IGST', 'Accounts Receivable', 'Accounts Payable'].map(name => ({ name, accountType: 'Expense' }));

test('Zoho check: journals with a customer or vendor on Accounts Receivable / Accounts Payable give a counted note that blocks nothing', () => {
  const out = buildVoucherOutput(made(), ctx());
  const rows = out.other_journals.rows.map(r => r.row);
  const res = checkFiles({ other_journals: table(Object.keys(rows[0]), rows) }, { zohoAccounts: ZOHO_ACCOUNTS });
  const f = res.files.find(x => x.key === 'other_journals');
  // the debit note DN-7 (3 rows) has a line on Zoho's own Input IGST: no import has shown a journal line on a Zoho GST
  // account yet, so that journal "may be refused" (GST-006); nothing is refused and nothing else is said
  assert.deepEqual([f.rowsWill, f.rowsMay, f.rowsWithWarnings], [0, 3, 0], JSON.stringify(f.causes.map(c => [c.id, c.tier, c.rows])));
  assert.deepEqual(f.causes.filter(c => c.tier !== 'warning').map(c => [c.id, c.tier, c.rows, c.documents]), [['JRN-GST-SYSTEM-ACCOUNT-LINE', 'may', 1, 1]]);
  const note = f.notes.find(n => n.rule === 'JRN-RECEIPTS-AS-JOURNALS');
  assert.ok(note, 'the note is there');
  assert.deepEqual([note.journals, note.rows, note.blocking], [5, 5, false]);
  assert.match(note.words, /^5 journals put a receipt from a customer on Accounts Receivable or a payment to a vendor on Accounts Payable\. .*credits_to_apply\.csv/);
  // a vendor CREDITED on Accounts Payable (an amount owed, like a bill) is not a credit to apply: not counted
  const owed = rows.filter(r => r['Reference Number'] === 'PMT-7').map(r => ({ ...r, Debit: r.Credit, Credit: r.Debit }));
  assert.deepEqual(checkFiles({ other_journals: table(Object.keys(rows[0]), owed) }, { zohoAccounts: ZOHO_ACCOUNTS }).files[0].notes, []);
  assert.equal(note.place.params.step, 'credits');
  // the note is outside every count of the check (the 3 "may" rows are the debit note on Input IGST, above)
  assert.deepEqual([res.overall.rowsWill, res.overall.rowsMay, res.overall.warnings, f.percent], [0, 3, 0, 100]);
  // a file with no contact on a journal line: no note
  const plain = rows.filter(r => r['Reference Number'] === 'RCT-7').map(r => ({ ...r, Account: r.Account === 'Accounts Receivable' ? 'Office Rent' : r.Account, 'Contact Name': '' }));
  const res2 = checkFiles({ other_journals: table(Object.keys(rows[0]), plain) }, { zohoAccounts: ZOHO_ACCOUNTS });
  assert.deepEqual(res2.files.find(x => x.key === 'other_journals').notes, []);
});

// The files of the route "module_files" name invoices and bills. The check knows the documents of the Invoices and
// Bills files (a bill by vendor AND number), so a wrong reference is found before Zoho refuses the row.
test('Zoho check: a payment or note that names an invoice or bill is checked against the documents of those files', () => {
  const bills = table(['Bill Number', 'Vendor Name'], [{ 'Bill Number': 'B-1', 'Vendor Name': 'Elm Works' }, { 'Bill Number': 'B-2', 'Vendor Name': 'Fir Logistics' }]);
  const invoices = table(['Invoice Number', 'Customer Name'], [{ 'Invoice Number': 'INV-1', 'Customer Name': 'Alder Retail' }]);
  const pm = rows => table(['Payment Number', 'Vendor Name', 'Bill Number'], rows.map(([v, b], i) => ({ 'Payment Number': `P-${i + 1}`, 'Vendor Name': v, 'Bill Number': b })));
  const pr = rows => table(['Payment Number', 'Customer Name', 'Invoice Number'], rows.map(([c, n], i) => ({ 'Payment Number': `R-${i + 1}`, 'Customer Name': c, 'Invoice Number': n })));
  const causesOf = (res, key, id) => res.files.find(f => f.key === key).causes.filter(c => c.ruleId === id).map(c => [c.variant, c.rows]);
  const res = checkFiles({ invoices, bills,
    payments_made: pm([['Elm Works', 'B-1'], ['elm works ', 'B-1'], ['Elm Works', 'NO-SUCH-BILL'], ['Elm Works', 'B-2'], ['Elm Works', '']]),
    payments_received: pr([['Alder Retail', 'INV-1'], ['Alder Retail', 'NO-SUCH-INVOICE'], ['Cedar Traders', 'INV-1']]) }, {});
  // an unknown number and another vendor's bill are found; an empty number is an unapplied amount. The vendor's own bill
  // is matched (the comparison trims and ignores case); these made-up Bills rows lack columns Zoho needs, so Zoho will
  // refuse the bill itself, and the two payments against it are a cascade from the Bills file, not a fresh error
  assert.deepEqual(causesOf(res, 'payments_made', 'PM-BILL-EXISTS').sort(), [['', 1], ['cascade', 2], ['other_party', 1]]);
  assert.equal(res.files.find(f => f.key === 'payments_made').causes.find(c => c.variant === 'cascade').cascadeFrom, 'bills');
  assert.match(res.files.find(f => f.key === 'payments_made').causes.find(c => c.variant === 'other_party').message, /The number "B-2" is in the Bills file, but for another Vendor Name/);
  assert.deepEqual(causesOf(res, 'payments_received', 'PR-INVOICE-EXISTS').sort(), [['', 1], ['cascade', 1], ['other_party', 1]]);
  // without the Bills file the reference cannot be checked, and the check says so instead of passing quietly
  const alone = checkFiles({ payments_made: pm([['Elm Works', 'B-1']]) }, {});
  assert.deepEqual(causesOf(alone, 'payments_made', 'PM-BILL-EXISTS'), [['unverified', 1]]);
  assert.equal(alone.files[0].causes.find(c => c.ruleId === 'PM-BILL-EXISTS').tier, 'may');
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
// the names of the entries of a zip (central directory), and one entry's bytes
function unzip(buf) {
  const out = {};
  let at = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(at + 10);
  at = buf.readUInt32LE(at + 16);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(at + 10), size = buf.readUInt32LE(at + 20), nameLen = buf.readUInt16LE(at + 28), extraLen = buf.readUInt16LE(at + 30), commentLen = buf.readUInt16LE(at + 32), local = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString('utf8');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    out[name] = method === 8 ? zlib.inflateRawSync(data) : data;
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

test('end to end: 0 held, 0 not in any file, the credits list, the wizard page after the journals, the zip, and the route lock', async () => {
  await login('analyst');
  const id = (await send('POST', '/api/migrations', { company: 'Sample Masters Co', financialYear: '2024-25' })).json().id;
  const base = `/api/migrations/${id}`;
  assert.equal((await put(id, 'all_masters', mastersDoc(), 'Master.json')).statusCode, 200);
  assert.equal((await put(id, 'all_transactions', transactionsDoc(VOUCHERS), 'Transactions.json')).statusCode, 200);
  await send('PUT', `${base}/waivers/stock_summary`, { reason: 'Not needed for test' });
  assert.equal((await put(id, 'trial_balance', trialBalanceReport(), 'TrialBal.json')).statusCode, 200);
  assert.equal((await send('POST', `${base}/process?wait=1`)).statusCode, 200);
  await send('POST', `${base}/journals/accept-suggestions`);
  await send('POST', `${base}/journals/accept-suggestions`, { group: 'needs_check' });
  await send('PUT', `${base}/tax-mappings`, { ledger: 'Input CGST', zohoTax: 'GST18' });
  const g = await send('POST', `${base}/generate`);
  assert.equal(g.statusCode, 200, g.body);
  const vc = g.json().vouchers;
  // the control total: nothing waits for a Zoho sample
  assert.deepEqual([vc.waitingForZohoSample, vc.written.other_journals, vc.awaitingRouting, vc.balanced], [{}, 4, 0, true]);

  // held vouchers: 0 held, 0 in no file, no module, and no empty list to "enter by hand"
  const held = await get(`${base}/held-vouchers`);
  assert.deepEqual([held.held, held.notInAnyFile, held.modules], [0, 0, []]);
  for (const k of ['payments_received', 'payments_made', 'vendor_credits', 'credit_notes']) assert.equal((await call({ url: `${base}/held-vouchers/${k}.csv` })).statusCode, 404, k);
  // voucher reconciliation: every receipt, payment and debit note is written; none held, none in no file
  const rec = await get(`${base}/voucher-reconciliation`);
  assert.deepEqual([rec.notInAnyFile.heldForZohoSample, rec.notInAnyFile.awaitingRouting, rec.held], [0, 0, []]);
  for (const slot of ['receipt', 'payment', 'debit_note', 'contra']) {
    const row = rec.rows.find(x => x.slot === slot);
    assert.ok(!Object.keys(row.destinations).some(k => k.startsWith('held:')), slot);
  }
  assert.equal(rec.allChecksPass, true, JSON.stringify(rec.checks.filter(c => !c.pass)));
  // completeness table: the payment and receipt rows match (count and amount), with no "held" reason
  const table = await get(`${base}/completeness-table`);
  for (const key of ['payment', 'debit_note']) {
    const row = table.rows.find(r => r.key === key);
    assert.deepEqual([row.status, row.difference.count, row.reasons], ['matches', 0, []], key);
  }
  assert.ok(!table.rows.some(r => (r.reasons || []).some(x => String(x.kind).startsWith('held:'))));

  // the journals file: the party on Accounts Receivable / Accounts Payable with the contact, the bank as in Tally
  const rows = parseCsv((await call({ url: `${base}/files/other_journals/download?confirmed=1` })).body).rows;
  const lines = n => rows.filter(x => x['Reference Number'] === n).map(x => [x.Account, x['Contact Name'], x.Debit, x.Credit]);
  assert.deepEqual(lines('PMT-P-1'), [['Accounts Payable', 'Birch Supplies', '1180.00', ''], ['Bank of Example', '', '', '1180.00']]);
  assert.deepEqual(lines('RCT-R-1'), [['Bank of Example', '', '1180.00', ''], ['Accounts Receivable', 'Maple Leaf Traders', '', '1180.00']]);
  assert.equal(lines('DN-DN-1').length, 3);
  assert.deepEqual(lines('DN-DN-1')[0], ['Accounts Payable', 'Birch Supplies', '118.00', '']);

  // the credits to apply: P-1 settles bill B-77 (Tally's bill-wise reference)
  const credits = await get(`${base}/credits-to-apply`);
  assert.equal(credits.available, true);
  const p1 = credits.list.find(x => x['Journal Number'] === 'PMT-P-1');
  assert.deepEqual([p1['Contact Type'], p1.Contact, p1.what, p1['Invoice or Bill Number'], p1.Amount, p1['Journal File']], ['Vendor', 'Birch Supplies', 'apply', 'B-77', '1180.00', 'journals_receipts_payments_contra.csv']);
  assert.ok(credits.list.some(x => x['Journal Number'] === 'DN-DN-1' && x.what === 'leave'));
  assert.equal(credits.summary.apply.bills, 1);
  const csv = await call({ url: `${base}/credits-to-apply.csv` });
  assert.equal(csv.statusCode, 200);
  const list = parseCsv(csv.body.replace(/^﻿/, ''));
  assert.deepEqual(list.headers, CREDIT_LIST_HEADINGS);
  assert.equal(list.rows.length, credits.total);

  // an assumption says it, and no item says a voucher waits for a sample
  const exc = (await get(`${base}/summary`)).exceptions.filter(e => e.stage === 'generate');
  assert.equal(exc.filter(e => e.kind === 'vouchers_waiting_for_zoho_sample').length, 0);
  assert.deepEqual(exc.filter(e => e.kind === 'payments_written_as_journals').map(e => e.slot).sort(), ['debit_note', 'payment', 'receipt']);
  const assumptions = await get(`${base}/assumptions`);
  const kinds = JSON.stringify(assumptions);
  assert.match(kinds, /payments_written_as_journals/);
  assert.match(kinds, /journal_credits_to_apply/);

  // the wizard: "Apply the credits" is one page right after the last journals file; it waits for the journals, and
  // the comparison of the trial balances does not wait for it
  const w = await get(`${base}/import-wizard`);
  const ids = w.steps.map(s => s.id);
  assert.equal(ids.indexOf('credits'), ids.indexOf('other_journals') + 1);
  assert.equal(ids[ids.length - 1], 'finish');
  assert.ok(!ids.includes('held'));
  const step = w.steps.find(s => s.id === 'credits');
  assert.deepEqual([step.kind, step.title, step.optional, step.locked, step.done, step.fileName, step.rows], ['credits', 'Apply the credits', true, true, false, 'credits_to_apply.csv', credits.total]);
  assert.ok(step.blockers.some(b => b.step === 'other_journals'), 'locked until the journals are imported');
  assert.deepEqual(step.counts.map(c => c.id), ['apply', 'opening_balance', 'leave']);
  assert.ok(step.lines.some(l => /The balances of the contacts and the trial balance are already right/.test(l)));
  const finish = w.steps.find(s => s.id === 'finish');
  assert.ok(!finish.stillOpen.some(o => o.step === 'credits' || o.step === 'held'), 'neither the credits nor held vouchers hold the comparison back');

  // the zip: the list under not_for_import, never among the numbered import files
  const z = await call({ url: `${base}/download-all?confirmed=1` });
  assert.equal(z.statusCode, 200, z.body);
  const zip = unzip(z.rawPayload);
  assert.ok(zip['not_for_import/credits_to_apply.csv']);
  assert.ok(!Object.keys(zip).some(n => /^\d\d_.*credit/i.test(n) || /not_in_any_file/.test(n)));
  assert.match(zip['READ_ME_IMPORT_ORDER.txt'].toString('utf8'), /Apply the credits/);
  assert.ok(!/Vouchers that are not in any file/i.test(zip['READ_ME_FIRST.txt'].toString('utf8')), 'nothing is listed as not in any file');

  // the route is locked once the journals file was downloaded: moving the vouchers to the Payments files could post
  // the same money twice, so the change needs the person's word that the journals are not (or no longer) in Zoho
  let r = await send('PUT', `${base}/voucher-settings`, { paymentsRoute: 'module_files' });
  assert.deepEqual([r.statusCode, r.json().routeLocked], [409, true]);
  assert.match(r.json().error, /the same money would be posted twice/);
  assert.equal((await get(`${base}/voucher-settings`)).paymentsRoute, 'journals');
  r = await send('PUT', `${base}/voucher-settings`, { paymentsRoute: 'module_files', journalsDeletedInZoho: true });
  assert.equal(r.statusCode, 200, r.body);
  assert.ok((await get(base)).outOfDateFiles.includes('other_journals'), 'the journals file must be created again');
  const g2 = await send('POST', `${base}/generate`);
  assert.equal(g2.statusCode, 200, g2.body);
  assert.deepEqual([g2.json().vouchers.waitingForZohoSample, g2.json().vouchers.written.other_journals], [{ payments_received: 1, payments_made: 1, vendor_credits: 1 }, 1]);
  // the vouchers are out of the journals file and out of the list of credits: one place each
  const rows2 = parseCsv((await call({ url: `${base}/files/other_journals/download?confirmed=1` })).body).rows;
  assert.ok(!rows2.some(x => ['PMT-P-1', 'RCT-R-1', 'DN-DN-1'].includes(x['Reference Number'])));
  const credits2 = await get(`${base}/credits-to-apply`);
  assert.ok(!credits2.list.some(x => ['PMT-P-1', 'RCT-R-1', 'DN-DN-1'].includes(x['Journal Number'])));
});
