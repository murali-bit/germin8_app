// B8: Receipt, Payment, Contra, Debit Note and Credit Note vouchers. Zoho's import samples for Payments Received,
// Payments Made, Vendor Credits and Credit Notes are not in zoho-samples, so those files are never built (no column is
// invented): the vouchers are held, counted and listed with their bill-wise allocations. What is a Manual Journal in
// Zoho (contra, payments not to a vendor, receipts not from a customer, notes to the other kind of party, anything not
// clear) is written to its own journals file in the layout of sample_journals.xls.
// Every value here is MADE UP (see fixtures/allTransactions.js); only the structure copies real exports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-payments-'));
const { buildApp } = await import('../src/index.js');
const { NameSet } = await import('../src/tally.js');
const { buildVoucherOutput, VOUCHER_FILES } = await import('../src/vouchers.js');
const { SAMPLE_NEEDED, classifyMoneyVoucher } = await import('../src/payments.js');
const { JOURNAL_SAMPLE_HEADERS, parseCsv } = await import('../src/zoho.js');
const { mastersDoc, VOUCHERS, transactionsDoc, trialBalanceReport, utf16le, voucher, line, bills } =await import('../fixtures/allTransactions.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(fs.readFileSync(path.resolve(here, '../seed-users.json'), 'utf8'));
const P = { ispartyledger: true };

// ---------- the rules, on made-up vouchers ----------
const KINDS = { 'Main Bank': 'bank', 'Petty Cash': 'bank', 'Second Bank': 'bank', 'Office Rent': 'expense', 'Bank Charges': 'expense', 'Term Loan': 'other', 'Service Income': 'income',
  'Input IGST': 'tax', 'TDS on Rent': 'tax', 'Alder Retail': 'customer', 'Cedar Traders': 'customer', 'Elm Works': 'vendor', 'Fir Logistics': 'vendor' };
const ctx = () => ({ customers: new NameSet(['Alder Retail', 'Cedar Traders']), vendors: new NameSet(['Elm Works', 'Fir Logistics']), taxLedgers: new NameSet(['Input IGST', 'TDS on Rent']),
  kindOf: name => KINDS[name] ?? null, taxInfo: () => ({ tds: false, gst: true, head: 'IGST', rate: null }) });
let nextId = 1;
const rec = (slot, data, decision) => ({ id: nextId++, source_id: `src-${nextId}`, name: `${data.vouchertypename} ${data.vouchernumber}`, slot, data, decision });
const SLOT = { Receipt: 'receipt', Payment: 'payment', Contra: 'contra', 'Debit Note': 'debit_note', 'Credit Note': 'credit_note', Sales: 'sales', Journal: 'journal' };
const v = (type, number, date, lines, opts) => rec(SLOT[type], voucher(type, number, date, lines, opts));
const route = (type, lines, party) => classifyMoneyVoucher(voucher(type, '1', '20240501', lines, { party }), SLOT[type], ctx());

test('each kind of money voucher goes to its Zoho module, or to a Manual Journal with the reason', () => {
  // a receipt from one customer into one bank: Payments Received (held, no sample)
  let r = route('Receipt', [line('Main Bank', '-500.00'), line('Alder Retail', '500.00', P)], 'Alder Retail');
  assert.deepEqual([r.file, r.party.ledger, r.bank.ledger, r.others.length], ['payments_received', 'Alder Retail', 'Main Bank', 0]);
  // a payment to one vendor from one bank: Payments Made (held)
  r = route('Payment', [line('Elm Works', '-300.00', P), line('Main Bank', '300.00')], 'Elm Works');
  assert.deepEqual([r.file, r.party.ledger, r.bank.ledger], ['payments_made', 'Elm Works', 'Main Bank']);
  // a payment that is not to a vendor (rent): a Manual Journal, in its summary group
  r = route('Payment', [line('Office Rent', '-1000.00'), line('Main Bank', '1000.00')], 'Main Bank');
  assert.deepEqual([r.file, r.category, r.kind], ['other_journals', 'payment_not_to_vendor', undefined]);
  assert.match(r.reason, /No vendor is debited on this payment; the debit side is expense or purchase ledgers\. Payments with no vendor on them .* cannot be vendor payments\. They are written as Manual Journals/);
  // a receipt that is not from a customer (a loan): a Manual Journal
  r = route('Receipt', [line('Main Bank', '-9000.00'), line('Term Loan', '9000.00')], 'Main Bank');
  assert.deepEqual([r.file, r.category], ['other_journals', 'receipt_not_from_customer']);
  // contra: always a Manual Journal
  assert.deepEqual([route('Contra', [line('Petty Cash', '-50.00'), line('Main Bank', '50.00')], 'Petty Cash').category], ['contra']);
  // a debit note to a vendor: Vendor Credits (held); to a customer: a Manual Journal, flagged on the voucher
  r = route('Debit Note', [line('Fir Logistics', '-118.00', P), line('Office Rent', '100.00'), line('Input IGST', '18.00')], 'Fir Logistics');
  assert.deepEqual([r.file, r.party.ledger, r.bank, r.others.length], ['vendor_credits', 'Fir Logistics', null, 2]);
  r = route('Debit Note', [line('Cedar Traders', '-40.00', P), line('Service Income', '40.00')], 'Cedar Traders');
  assert.deepEqual([r.file, r.kind], ['other_journals', 'note_written_as_journal']);
  assert.match(r.reason, /made out to the customer "Cedar Traders", not to a vendor, so it cannot be a Zoho vendor credit\. It is written as a Manual Journal on Accounts Receivable/);
  // a credit note to a customer: Credit Notes (held); to a vendor: a Manual Journal, flagged
  assert.equal(route('Credit Note', [line('Service Income', '-40.00'), line('Alder Retail', '40.00', P)], 'Alder Retail').file, 'credit_notes');
  assert.equal(route('Credit Note', [line('Office Rent', '-40.00'), line('Elm Works', '40.00', P)], 'Elm Works').kind, 'note_written_as_journal');
  // not clear: never guessed, a Manual Journal flagged with what was seen
  const unclear = [
    route('Receipt', [line('Main Bank', '-200.00'), line('Second Bank', '-100.00'), line('Alder Retail', '300.00', P)], 'Alder Retail'),  // two banks
    route('Receipt', [line('Office Rent', '-200.00'), line('Alder Retail', '200.00', P)], 'Alder Retail'),                                 // no bank: a set-off
    route('Payment', [line('Alder Retail', '-70.00', P), line('Main Bank', '70.00')], 'Alder Retail'),                                     // a refund to a customer
    route('Receipt', [line('Main Bank', '-80.00'), line('Alder Retail', '50.00', P), line('Cedar Traders', '30.00', P)], 'Alder Retail'),  // two customers
    route('Payment', [line('Main Bank', '-10.00'), line('Elm Works', '10.00', P)], 'Elm Works'),                                           // the vendor credited on a payment
  ];
  assert.deepEqual(unclear.map(x => [x.file, x.kind]), Array(5).fill(['other_journals', 'money_voucher_unclear']));
  assert.match(unclear[0].reason, /2 bank or cash ledgers are debited, and a Zoho payment has one "Deposit To" account/);
  assert.match(unclear[1].reason, /no bank or cash ledger is debited .*so this is a set-off or adjustment, not money received\. It is written as a Manual Journal, which posts exactly what Tally posted/);
  assert.match(unclear[3].reason, /not a plain payment from one customer \(2 customer ledgers credited\)/);
});

test('the journals of these vouchers carry the voucher type in their number, so Payment 5 and Contra 5 stay two journals', () => {
  const vouchers = [
    v('Payment', '5', '20240501', [line('Office Rent', '-1000.00'), line('Main Bank', '1000.00')], { party: 'Main Bank' }),
    v('Contra', '5', '20240502', [line('Petty Cash', '-50.00'), line('Main Bank', '50.00')], { party: 'Petty Cash', narration: 'Cash withdrawn' }),
    v('Debit Note', '5', '20240503', [line('Cedar Traders', '-40.00', P), line('Service Income', '40.00')], { party: 'Cedar Traders' }),
    v('Payment', '5', '20240504', [line('Bank Charges', '-2.00'), line('Main Bank', '2.00')], { party: 'Main Bank' }), // the same Tally number twice
    v('Receipt', 'NO-DIGITS', '20240505', [line('Main Bank', '-9.00'), line('Term Loan', '9.00')], { party: 'Main Bank' }),
  ];
  const out = buildVoucherOutput(vouchers, { ...ctx(), accountName: x => x });
  const rows = out.other_journals.rows.map(r => r.row);
  assert.equal(out.other_journals.vouchers, 5);
  assert.deepEqual(Object.keys(rows[0]).filter(k => !JOURNAL_SAMPLE_HEADERS.includes(k)), [], 'only the journal sample\'s headings are written');
  assert.deepEqual(rows.map(r => [r['Reference Number'], r['Journal Number Prefix'], r['Journal Number Suffix'], r.Account, r['Contact Name'], r.Debit, r.Credit]), [
    ['PMT-5', 'PMT-', '5', 'Office Rent', '', '1000.00', ''], ['PMT-5', 'PMT-', '5', 'Main Bank', '', '', '1000.00'],
    ['CTR-5', 'CTR-', '5', 'Petty Cash', '', '50.00', ''], ['CTR-5', 'CTR-', '5', 'Main Bank', '', '', '50.00'],
    ['DN-5', 'DN-', '5', 'Accounts Receivable', 'Cedar Traders', '40.00', ''], ['DN-5', 'DN-', '5', 'Service Income', '', '', '40.00'],
    // changed on purpose (held-vouchers batch): Zoho reads rows of one journal number as ONE journal, so the second "5" gets "-2"
    ['PMT-5-2', 'PMT-5-', '2', 'Bank Charges', '', '2.00', ''], ['PMT-5-2', 'PMT-5-', '2', 'Main Bank', '', '', '2.00'],
    // changed on purpose (S4, TALLY-009): a Tally number that does not end in digits gets a generated journal number (never empty)
    ['RCT-000001', 'RCT-', '000001', 'Main Bank', '', '9.00', ''], ['RCT-000001', 'RCT-', '000001', 'Term Loan', '', '', '9.00']]);
  assert.deepEqual([rows[0].Notes, rows[2].Notes, rows[0]['Journal Date'], rows[0]['Journal Type'], rows[0].Currency, rows[0].Status], ['Payment 5 from Tally', 'Cash withdrawn', '2024-05-01', 'both', 'INR', 'published']);
  // a Tally number used twice within one voucher type: the second journal is renumbered and flagged, so no number repeats in the file
  assert.deepEqual(out.repeatedNumbers.map(d => [d.file, d.number, d.recs.length]), []);
  assert.deepEqual(out.exceptions.filter(e => e.kind === 'journal_number_made_unique').map(e => e.rec.data.vouchernumber), ['5']);
  assert.match(rows[6].Notes, /5/, 'the Tally number stays in the Notes');
  assert.deepEqual(out.exceptions.filter(e => e.kind === 'journal_number_generated').map(e => e.rec.data.vouchernumber), ['NO-DIGITS']);
  assert.match(rows[8].Notes, /NO-DIGITS/, 'the Tally number stays in the Notes');
  assert.deepEqual(out.exceptions.filter(e => e.kind === 'note_written_as_journal').map(e => e.rec.data.vouchernumber), ['5']);
  assert.deepEqual(out.journalCategories, [{ slot: 'payment', category: 'payment_not_to_vendor', vouchers: 2 }, { slot: 'contra', category: 'contra', vouchers: 1 }, { slot: 'receipt', category: 'receipt_not_from_customer', vouchers: 1 }]);
  // drafts, when chosen, apply to these journals too
  assert.ok(buildVoucherOutput(vouchers, { ...ctx(), settings: { documentStatus: 'draft' } }).other_journals.rows.every(r => r.row.Status === 'draft'));
});

test('bill-wise allocations: applied to the invoice or bill written, in date order, never beyond what is left; everything else stays unapplied and is flagged', () => {
  const sale = (number, ref, amount, date) => v('Sales', number, date, [line('Alder Retail', `-${amount}`, { ...P, ...bills(ref, 'New Ref', `-${amount}`) }), line('Service Income', amount)], { view: 'invoice', party: 'Alder Retail' });
  const receipt = (number, date, amount, allocs, party = 'Alder Retail') => v('Receipt', number, date, [line('Main Bank', `-${amount}`),
    line(party, amount, { ...P, billallocations: allocs.map(([name, billtype, a]) => ({ name, billtype, amount: a })) })], { party });
  const vouchers = [
    sale('INV-1', 'REF-A', '1000.00', '20240401'),  // the bill-wise name differs from the invoice number
    sale('INV-2', 'REF-B', '300.00', '20240402'),
    // a journal routed to Manual Journal that created a reference: not an invoice, so a receipt cannot be applied to it
    rec('journal', voucher('Journal', 'J-1', '20240403', [line('Alder Retail', '-70.00', { ...P, ...bills('REF-J', 'New Ref', '-70.00') }), line('Service Income', '70.00')], { party: 'Alder Retail' }), 'Manual Journal'),
    // file order is not date order: the later receipt is listed first, the earlier one is applied first
    receipt('R-2', '20240420', '700.00', [['REF-A', 'Agst Ref', '700.00']]),
    receipt('R-1', '20240410', '650.00', [['REF-A', 'Agst Ref', '400.00'], ['REF-B', 'Agst Ref', '200.00'], ['ADV-1', 'Advance', '50.00']]),
    receipt('R-3', '20240425', '90.00', [['OLD-2023', 'Agst Ref', '60.00'], ['REF-J', 'Agst Ref', '30.00']]),
    receipt('R-4', '20240426', '10.00', [['REF-B', 'Agst Ref', '-10.00']]),
    receipt('R-5', '20240427', '25.00', [['REF-B', 'Agst Ref', '25.00']], 'Cedar Traders'), // another customer's reference of the same name is not this one
  ];
  const out = buildVoucherOutput(vouchers, { ...ctx(), accountName: x => x, settings: { paymentsRoute: 'module_files' } });
  assert.equal(out.invoices.vouchers, 2);
  const h = Object.fromEntries(out.held.map(x => [x.rec.data.vouchernumber, x]));
  assert.deepEqual(out.held.map(x => x.file), Array(5).fill('payments_received'));
  // R-1 (10 April) first: 400 of INV-1, 200 of INV-2; the advance stays unapplied
  assert.deepEqual([h['R-1'].applied, h['R-1'].unapplied.toFixed(2), h['R-1'].flags], [[{ file: 'invoices', number: 'INV-1', ref: 'REF-A', amount: '400.00' }, { file: 'invoices', number: 'INV-2', ref: 'REF-B', amount: '200.00' }], '50.00', []]);
  assert.match(h['R-1'].notes[0].words, /^Advance "ADV-1": not set against any invoice, so it stays unapplied/);
  // R-2 (20 April): 700 against INV-1, of which only 600 is left: not applied, flagged with the figures
  assert.deepEqual([h['R-2'].applied, h['R-2'].unapplied.toFixed(2), h['R-2'].flags.map(f => f.kind)], [[], '700.00', ['allocation_exceeds_document']]);
  assert.match(h['R-2'].flags[0].message, /700\.00 is set against invoice INV-1 \(reference "REF-A"\), but only 600\.00 of its Zoho total of 1000\.00 is left/);
  // R-3: a reference from before the period (opening balance), and one created by a journal written as a Manual Journal
  assert.deepEqual(h['R-3'].flags.map(f => f.kind), ['allocation_bill_not_in_migration', 'allocation_document_not_written']);
  assert.match(h['R-3'].flags[0].message, /reference "OLD-2023", which no voucher of this migration created: it is an invoice from before the period, part of the opening balance of "Alder Retail"/);
  assert.match(h['R-3'].flags[1].message, /reference "REF-J", which was created by a voucher of this migration that is not written as an invoice \(written to the Manual Journals file\)/);
  // R-4: the allocation is on the other side from the customer line
  assert.deepEqual(h['R-4'].flags.map(f => f.kind), ['allocation_sign_unclear']);
  // R-5: "REF-B" of another customer is not Alder Retail's
  assert.deepEqual(h['R-5'].flags.map(f => f.kind), ['allocation_bill_not_in_migration']);
  // the flags reach the exceptions, on the voucher, without "Left out" (the vouchers are held, not left out)
  assert.equal(out.exceptions.filter(e => /^allocation_/.test(e.kind)).length, 5);
  assert.ok(!out.exceptions.some(e => /^allocation_/.test(e.kind) && /^Left out/.test(e.message)));
});

test('payments are applied to bills under the number written (the supplier reference when chosen), after TDS; other lines are flagged', () => {
  const tdsInfo = name => (name === 'TDS on Rent' ? { tds: true, gst: false, head: null, rate: null } : { tds: false, gst: true, head: 'IGST', rate: null });
  const bill = rec('journal', voucher('Journal', 'J-7', '20240401', [line('Office Rent', '-1000.00'), line('TDS on Rent', '100.00'), line('Elm Works', '900.00', { ...P, ...bills('SUP-77', 'New Ref', '900.00') })],
    { party: 'Elm Works', extra: { reference: 'SUP-77' } }), 'Bill');
  const pay = v('Payment', 'P-1', '20240410', [line('Elm Works', '-900.00', { ...P, ...bills('SUP-77', 'Agst Ref', '-900.00') }), line('Bank Charges', '-5.00'), line('Main Bank', '905.00')], { party: 'Elm Works' });
  const opts = { ...ctx(), taxInfo: tdsInfo, tdsMap: { 'TDS on Rent': { tdsName: 'TDS Rent 10', section: '194I', percent: '10' } }, settings: { billNumber: 'reference', paymentsRoute: 'module_files' } };
  const out = buildVoucherOutput([bill, pay], opts);
  const h = out.held[0];
  assert.deepEqual([h.file, h.amount.toFixed(2), h.applied, h.unapplied.toFixed(2)], ['payments_made', '900.00', [{ file: 'bills', number: 'SUP-77', ref: 'SUP-77', amount: '900.00' }], '0.00'],
    'the bill comes to 900.00 in Zoho (1000.00 less 100.00 TDS), so the payment settles it in full');
  assert.deepEqual(h.flags.map(f => f.kind), ['money_voucher_other_lines']);
  assert.match(h.flags[0].message, /this voucher has 1 other line: "Bank Charges" 5\.00 debit\. Whether the Payments Made file can carry it .* will be known only from Zoho's sample/);
});

test('every money voucher is accounted for exactly once: written, held for a sample, or left out with its reason', () => {
  const vouchers = [
    v('Receipt', 'R-1', '20240401', [line('Main Bank', '-5.00'), line('Alder Retail', '5.00', P)], { party: 'Alder Retail' }),
    v('Payment', 'P-1', '20240401', [line('Elm Works', '-5.00', P), line('Main Bank', '5.00')], { party: 'Elm Works' }),
    v('Payment', 'P-2', '20240401', [line('Office Rent', '-5.00'), line('Main Bank', '5.00')]),
    v('Contra', 'C-1', '20240401', [line('Petty Cash', '-5.00'), line('Main Bank', '5.00')]),
    v('Debit Note', 'D-1', '20240401', [line('Elm Works', '-5.00', P), line('Office Rent', '5.00')], { party: 'Elm Works' }),
    v('Credit Note', 'K-1', '20240401', [line('Service Income', '-5.00'), line('Alder Retail', '5.00', P)], { party: 'Alder Retail' }),
    v('Payment', 'P-3', '20240401', [line('Elm Works', '-5.00', P), line('Main Bank', '5.00')], { party: 'Elm Works', extra: { iscancelled: true } }),
    v('Receipt', 'R-9', '20240401', [line('Main Bank', '-5.00'), line('Alder Retail', '4.00', P)], { party: 'Alder Retail' }), // does not balance
  ];
  const out = buildVoucherOutput(vouchers, { ...ctx(), settings: { paymentsRoute: 'module_files' } });
  const leftOut = out.exceptions.filter(e => /^Left out/.test(e.message));
  assert.deepEqual([out.other_journals.vouchers, out.held.length, leftOut.length, out.undecided], [2, 4, 2, 0]);
  assert.equal(out.other_journals.vouchers + out.held.length + leftOut.length, vouchers.length);
  assert.deepEqual(out.held.map(h => h.file), ['payments_received', 'payments_made', 'vendor_credits', 'credit_notes']);
  assert.deepEqual(leftOut.map(e => [e.rec.data.vouchernumber, e.kind ?? null]), [['P-3', 'left_out_cancelled'], ['R-9', null]]);
  assert.match(leftOut[1].message, /^Left out of the file: Debits and credits differ by 1\.00/);
  // no sample is in the platform for the four held modules, and none of them is a file the platform builds
  assert.deepEqual(Object.keys(SAMPLE_NEEDED), ['payments_received', 'payments_made', 'vendor_credits', 'credit_notes']);
  for (const k of Object.keys(SAMPLE_NEEDED)) assert.ok(!(k in VOUCHER_FILES), k);
  const samples = fs.existsSync(path.resolve(here, '../../zoho-samples')) ? fs.readdirSync(path.resolve(here, '../../zoho-samples')) : [];
  for (const name of samples) assert.ok(!/payment|credit|receipt/i.test(name), `a sample "${name}" exists: build its file from it`);
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

test('end to end: the journals file, the held vouchers, the control total, the import order, the crosswalk, reconciliation and the test report', async () => {
  await login('analyst');
  const id = (await send('POST', '/api/migrations', { company: 'Sample Masters Co', financialYear: '2024-25' })).json().id;
  const base = `/api/migrations/${id}`;
  const extra = [
    // a payment of rent: not to a vendor
    voucher('Payment', 'P-2', '20240503', [line('Staff Tea Expenses', '-40.00'), line('Bank of Example', '40.00')], { party: 'Bank of Example' }),
  ];
  assert.equal((await put(id, 'all_masters', mastersDoc(), 'Master.json')).statusCode, 200);
  assert.equal((await put(id, 'all_transactions', transactionsDoc([...VOUCHERS, ...extra]), 'Transactions.json')).statusCode, 200);
  await send('PUT', `${base}/waivers/stock_summary`, { reason: 'Not needed for test' });
  assert.equal((await put(id, 'trial_balance', trialBalanceReport(), 'TrialBal.json')).statusCode, 200);
  assert.equal((await send('POST', `${base}/process?wait=1`)).statusCode, 200);
  // this test is about the route "module_files" (vouchers held for Zoho's Payments files). The default route writes them
  // as Manual Journals (heldjournals.test.js); the held route is kept for when Zoho's samples are uploaded.
  assert.equal((await send('PUT', `${base}/voucher-settings`, { paymentsRoute: 'module_files' })).statusCode, 200);
  // before any file: the plan is worked out from the data
  let pay = await get(`${base}/payments`);
  assert.deepEqual(pay.samplesNeeded.map(s => [s.key, s.module, s.importAfter]), [['payments_received', 'Payments Received', 'invoices'], ['payments_made', 'Payments Made', 'bills'], ['vendor_credits', 'Vendor Credits', 'bills'], ['credit_notes', 'Credit Notes', 'invoices']]);
  assert.equal(pay.files, null);
  assert.deepEqual(Object.fromEntries(Object.entries(pay.now.summary).map(([k, s]) => [k, s.vouchers])), { payments_received: 1, payments_made: 1, vendor_credits: 1 });
  assert.deepEqual([pay.now.journals, pay.now.journalGroups.map(g => [g.slot, g.category, g.vouchers])], [2, [['contra', 'contra', 1], ['payment', 'payment_not_to_vendor', 1]]]);
  assert.equal((await send('GET', `${base}/payments?file=bank_transfers`)).statusCode, 400);

  // the bill J-1 (supplier reference B-77) is routed, and its tax mapped, so P-1's allocation against B-77 can be applied
  await send('POST', `${base}/journals/accept-suggestions`);
  await send('POST', `${base}/journals/accept-suggestions`, { group: 'needs_check' });
  await send('PUT', `${base}/tax-mappings`, { ledger: 'Input CGST', zohoTax: 'GST18' });
  const r = await send('POST', `${base}/generate`);
  assert.equal(r.statusCode, 200, r.body);
  const vc = r.json().vouchers;
  // changed on purpose (S4, TALLY-002): the custom type "Gate Pass" posts to the ledgers, so it is a Manual Journal; only
  // the Memorandum voucher (Tally never posts it) is kept without a Zoho file
  assert.deepEqual([vc.written.other_journals, vc.waitingForZohoSample, vc.keptWithoutZohoFile, vc.balanced], [2, { payments_received: 1, payments_made: 1, vendor_credits: 1 }, { other_vouchers: 1 }, true]);
  assert.deepEqual((await get(`${base}/voucher-control`)).control, vc, 'the control total read back from what is stored is the same');

  // the journals file: the official journal sample's headings, in order
  const f = r.json().files.find(x => x.key === 'other_journals');
  assert.deepEqual([f.fileName, f.headings, f.templateVerified, f.vouchers], ['journals_receipts_payments_contra.csv', JOURNAL_SAMPLE_HEADERS, true, 2]);
  const dl = await call({ url: `${base}/files/other_journals/download` });
  const rows = parseCsv(dl.body).rows;
  assert.deepEqual(rows.map(x => [x['Reference Number'], x.Account, x.Debit, x.Credit]), [['CTR-C-1', 'Cash', '200.00', ''], ['CTR-C-1', 'Bank of Example', '', '200.00'], ['PMT-P-2', 'Staff Tea Expenses', '40.00', ''], ['PMT-P-2', 'Bank of Example', '', '40.00']]);

  // the import order: the journals of these vouchers after the other journals; the held modules are not files
  const imports = await get(`${base}/imports`);
  assert.deepEqual(imports.map(i => i.key).slice(-2), ['journals', 'other_journals']);
  assert.ok(!imports.some(i => i.key in SAMPLE_NEEDED));

  // held: P-1 settles the bill written from journal J-1, found by its bill-wise reference B-77.
  // v2 default 9 (changed on purpose: the number was J-1): that bill carries the supplier's invoice number B-77 by default
  pay = await get(`${base}/payments`);
  assert.deepEqual(Object.fromEntries(Object.entries(pay.files.held).map(([k, s]) => [k, [s.vouchers, s.amount, s.applied, s.unapplied, s.allocationsApplied]])),
    { payments_received: [1, '1180.00', '0.00', '1180.00', 0], payments_made: [1, '1180.00', '1180.00', '0.00', 1], vendor_credits: [1, '118.00', '0.00', '118.00', 0] });
  const p1 = pay.now.vouchers.find(x => x.number === 'P-1');
  assert.deepEqual([p1.party, p1.bank, p1.applied], ['Birch Supplies', 'Bank of Example', [{ file: 'bills', number: 'B-77', ref: 'B-77', amount: '1180.00' }]]);
  // R-1 is set against S-1, whose Zoho total is not 1180.00 (the CGST rate on the line is 9%): not applied, flagged
  const r1 = pay.now.vouchers.find(x => x.number === 'R-1');
  assert.deepEqual([r1.applied, r1.flags.map(x => x.kind)], [[], ['allocation_exceeds_document']]);
  // DN-1: a vendor credit's expense and tax lines are its own lines, not "other lines"; it has no allocation, so it stays unapplied
  const dn = pay.now.vouchers.find(x => x.number === 'DN-1');
  assert.deepEqual([dn.module, dn.bank, dn.flags, dn.applied, dn.unapplied], ['Vendor Credits', null, [], [], '118.00']);

  // flagged items: one per held module saying which sample is needed, one per journal group
  const exc = (await get(`${base}/summary`)).exceptions.filter(e => e.stage === 'generate');
  assert.deepEqual(exc.filter(e => e.kind === 'vouchers_waiting_for_zoho_sample').map(e => [e.slot, e.uses]), [['receipt', 1], ['payment', 1], ['debit_note', 1]]);
  assert.match(exc.find(e => e.kind === 'vouchers_waiting_for_zoho_sample' && e.slot === 'receipt').message, /Needed: Zoho Books' import sample for Payments Received .*after the Invoices file/);
  assert.deepEqual(exc.filter(e => e.kind === 'vouchers_written_as_journals').map(e => [e.slot, e.uses]), [['contra', 1], ['payment', 1]]);

  // the crosswalk finds the held vouchers, with their status
  const cw = await get(`${base}/crosswalk?q=R-1`);
  assert.ok(cw.rows.some(x => x.module === 'Payments Received' && x.ident === 'R-1' && x.status === 'Waiting for a Zoho sample (no file built)'));

  // reconciliation: a Zoho report for the journals of these vouchers is matched and its amounts compared
  const rec = await call({ method: 'PUT', url: `${base}/verification/other_journals`, headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('Reference Number,Total\r\nPMT-P-2,40.00\r\nCTR-C-1,200.00\r\n') });
  assert.equal(rec.statusCode, 200, rec.body);
  assert.deepEqual([rec.json().matched, rec.json().missing, rec.json().amountsCompared, rec.json().amountsDiffering], [2, 0, 2, 0]);

  // the test report names the samples needed
  const rep = await get(`${base}/test-report`);
  assert.deepEqual(rep.waitingForZohoSample.map(w => [w.key, w.vouchers, w.built]), [['payments_received', 1, false], ['payments_made', 1, false], ['vendor_credits', 1, false], ['credit_notes', 0, false]]);
  assert.ok(rep.whatToFixNext.some(x => /^1 voucher belong in Zoho's Payments Made, which is not built: its import sample is not in the platform\. Needed: /.test(x.message) && x.blocking === false));
  assert.equal(rep.voucherControl.balanced, true);

  // a change that touches these journals marks their file out of date
  await send('PUT', `${base}/voucher-settings`, { documentStatus: 'draft' });
  assert.ok((await get(base)).outOfDateFiles.includes('other_journals'));
});
