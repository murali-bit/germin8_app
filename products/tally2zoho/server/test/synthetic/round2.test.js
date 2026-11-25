// Round 2 of the re-check (made-up companies only): reverse charge payable ledgers of CGST and SGST go on Zoho's Output
// account of their head; corrections the accountant enters for a voucher the export cannot give (a date that is not a
// real day, an unbalanced voucher, with the amount the Trial Balance pins down suggested); a Stock opening balance in the
// dated journal OB-3, never in the chart; unproven journal lines (adjustment accounts, Retained Earnings, a Stock
// account) shown as "may be refused"; receipts and payments of a foreign-currency party written in its currency.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runCompany, closeApp, refusedFindings, request } from './harness.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const load = async n => import(pathToFileURL(path.resolve(here, '../../fixtures/synthetic', `${n}.js`)).href);
after(() => closeApp());
const runs = new Map();
const run = async (n, choices = {}) => { const k = `${n}|${JSON.stringify(choices)}`; if (!runs.has(k)) runs.set(k, await runCompany(await load(n), { choices })); return runs.get(k); };
const rowsOf = (r, k) => r.files[k]?.rows || [];
const cents = v => Math.round(Number(String(v ?? '0').replace(/,/g, '') || 0) * 100);
const findingsOf = (r, rule) => r.findings.filter(f => f.Rule === rule);
const assumption = (r, kind) => r.assumptions.assumptions.find(a => a.kind === kind);

test('c05: CGST and SGST reverse charge payable ledgers are entered on Output CGST / Output SGST, so no TAX journal moves Zoho\'s output credit', async () => {
  const r = await run('c05_rcm_heavy');
  const accounts = rowsOf(r, 'accounts').map(x => x['Account Name']);
  for (const l of ['CGST Payable (RCM)', 'SGST Payable (RCM)', 'IGST Payable (RCM)']) assert.ok(!accounts.includes(l), `${l} is not an account of its own`);
  const tax = rowsOf(r, 'journals').filter(x => /^TAX/.test(x['Reference Number']));
  assert.ok(tax.length > 0, 'the input side still has its alignment journals');
  assert.deepEqual(tax.filter(x => /^Output |Payable \(RCM\)/.test(x.Account)).map(x => `${x['Reference Number']} ${x.Account}`), [], 'no Output or RCM payable line in a TAX journal');
  const mapped = r.exceptions.filter(e => e.kind === 'rcm_ledger_to_zoho_account').map(e => e.name).sort();
  assert.deepEqual(mapped, ['CGST Payable (RCM)', 'IGST Payable (RCM)', 'SGST Payable (RCM)']);
});

test('the evidence gives a reverse charge payable ledger its own Tally duty head when a bill posts two heads', async () => {
  const { taxEvidenceFrom, evidenceAccount, ZOHO_TAX_POSTING_ACCOUNTS: A } = await import('../../src/taxposting.js');
  const Decimal = (await import('decimal.js')).default;
  const d = x => new Decimal(x);
  const ev = taxEvidenceFrom([{ file: 'bills', partyLedger: 'Landlord', taxLedgers: [], tds: null,
    rcm: { input: [{ ledger: 'Input C', amount: d(90) }, { ledger: 'Input S', amount: d(90) }], output: [{ ledger: 'Payable C', amount: d(90), head: 'CGST' }, { ledger: 'Payable S', amount: d(90), head: 'SGST' }],
      zoho: { CGST: d(90), SGST: d(90) }, importOfServices: false } }]);
  assert.equal(evidenceAccount('Payable C', ev).account, A.output.CGST);
  assert.equal(evidenceAccount('Payable S', ev).account, A.output.SGST);
  // a ledger without a known head on a two-head bill stays an account of its own (nothing is guessed)
  const unknown = taxEvidenceFrom([{ file: 'bills', taxLedgers: [], rcm: { input: [], output: [{ ledger: 'Tax Due', amount: d(180) }], zoho: { CGST: d(90), SGST: d(90) } } }]);
  assert.equal(evidenceAccount('Tax Due', unknown), null);
});

test('c05: the unbalanced set-off journal gets the one amount the Trial Balance pins down as a suggestion; once the accountant confirms it, the trial balance is Tally\'s', async () => {
  const plain = await run('c05_rcm_heavy');
  const list = (await request({ url: `/api/migrations/${plain.id}/voucher-corrections` })).json().vouchers;
  const j3 = list.find(v => v.number === 'J/003');
  assert.equal(j3.kind, 'amount');
  assert.deepEqual([j3.suggestion.ledger, j3.suggestion.exported, j3.suggestion.amount], ['IGST Payable (RCM)', '14000.00', '14400.00']);
  assert.equal(plain.vouchers.find(v => v.number === 'J/003').went, 'Left out with a reason', 'never applied by itself');
  // a correction that does not balance the voucher is refused
  const bad = await request({ method: 'PUT', url: `/api/migrations/${plain.id}/voucher-corrections/${j3.id}`, payload: { kind: 'amount', ledger: 'IGST Payable (RCM)', exported: '14000.00', amount: '14500.00' } });
  assert.equal(bad.statusCode, 400);
  const r = await run('c05_rcm_heavy', { corrections: [{ number: 'J/003', ledger: 'IGST Payable (RCM)', exported: '14000.00', amount: '14400.00' }] });
  assert.deepEqual(r.failedSteps, []);
  assert.equal(r.control.leftOut, 0);
  assert.equal(r.predicted.comparison.agrees, true);
  assert.ok(assumption(r, 'voucher_amount_corrected'), 'listed under Assumptions the tool made');
  assert.match(r.exceptions.find(e => e.kind === 'voucher_amount_corrected').message, /14000\.00/, 'the exported figure is named');
  assert.equal(r.recon?.checks?.every?.(c => c.ok) ?? true, true);
});

test('c08: a voucher whose exported date is not a real day is written with the date the accountant enters, and the trial balance is Tally\'s', async () => {
  const plain = await run('c08_no_gst');
  const list = (await request({ url: `/api/migrations/${plain.id}/voucher-corrections` })).json().vouchers;
  const s7 = list.find(v => v.number === 'S/2025/007');
  assert.equal(s7.kind, 'date');
  for (const date of ['2025-06-31', '30/06/2025']) {
    const bad = await request({ method: 'PUT', url: `/api/migrations/${plain.id}/voucher-corrections/${s7.id}`, payload: { kind: 'date', date } });
    assert.equal(bad.statusCode, 400, date);
  }
  const r = await run('c08_no_gst', { corrections: [{ number: 'S/2025/007', date: '2025-06-30' }] });
  assert.deepEqual(r.failedSteps, []);
  const inv = rowsOf(r, 'invoices').filter(x => x['Invoice Number'] === 'S/2025/007');
  assert.ok(inv.length > 0 && inv.every(x => x['Invoice Date'] === '2025-06-30'));
  assert.equal(r.predicted.comparison.agrees, true);
  assert.match(r.exceptions.find(e => e.kind === 'voucher_date_corrected').message, /20250631/, 'the exported text is named');
});

test('c08: the Stock account carries no opening balance in the chart; it is in OB-3 and its line is "may be refused"', async () => {
  const r = await run('c08_no_gst');
  const stock = rowsOf(r, 'accounts').find(x => x['Account Type'] === 'Stock');
  assert.ok(stock);
  assert.equal(stock['Opening Balance'] || '', '');
  const line = rowsOf(r, 'opening_balances_for_zoho_accounts').find(x => x.Account === stock['Account Name']);
  assert.equal(line['Journal Number Suffix'], '3');
  assert.equal(cents(line.Debit), 6150000);
  assert.ok(findingsOf(r, 'JRN-STOCK-ACCOUNT-LINE').length === 1);
  assert.equal(findingsOf(r, 'COA-STOCK-OB-LOCKS-DATE').length, 0);
  assert.match(r.exceptions.find(e => e.kind === 'opening_journal_split').message, /COA-STOCK-OB-LOCKS-DATE/);
  assert.equal(r.predicted.comparison.accounts.differing.some(x => x.account === stock['Account Name']), false);
});

test('c09, c10: the lines of the adjustment journals on Other Charges / Other Expenses, and a line on Retained Earnings, are "may be refused"', async () => {
  const c09 = await run('c09_tds_heavy');
  const adj9 = rowsOf(c09, 'journals').filter(x => /^ADJ/.test(x['Reference Number']) && /^Other (Charges|Expenses)$/.test(x.Account));
  assert.ok(adj9.length >= 2);
  assert.ok(findingsOf(c09, 'JRN-ADJUSTMENT-ACCOUNT-LINE').length >= adj9.length);
  const c10 = await run('c10_complex_openings');
  assert.ok(findingsOf(c10, 'JRN-ADJUSTMENT-ACCOUNT-LINE').length >= 1);
  assert.ok(findingsOf(c10, 'JRN-RETAINED-EARNINGS-LINE').length >= 1);
  assert.deepEqual(refusedFindings(c10).map(f => f.Rule).filter(x => /ADJUSTMENT|RETAINED/.test(x)), [], 'may be refused, never "will be refused"');
});

test('c10: the corrupt depreciation journal gets the amount its Trial Balance pins down as a suggestion only', async () => {
  const r = await run('c10_complex_openings');
  const list = (await request({ url: `/api/migrations/${r.id}/voucher-corrections` })).json().vouchers;
  const j5 = list.find(v => v.number === 'J/005');
  assert.equal(j5.suggestion?.amount, '90000.00');
  assert.equal(r.vouchers.find(v => v.number === 'J/005').went, 'Left out with a reason');
});

test('c07: receipts and payments of a euro or dollar party are written in its currency at Tally\'s rate, and each line converts to Tally\'s rupees', async () => {
  const r = await run('c07_forex');
  const want = { 'RCT-R/001': ['EUR', '92.7', 600000], 'RCT-R/002': ['USD', '86.1', 450000], 'PMT-PY/001': ['USD', '85.8', 320000], 'PMT-PY/002': ['EUR', '92.3', 240000] };
  for (const [n, [code, rate, fx]] of Object.entries(want)) {
    const rows = rowsOf(r, 'other_journals').filter(x => x['Reference Number'] === n);
    assert.equal(rows.length, 2, n);
    for (const x of rows) assert.deepEqual([x.Currency, x['Exchange Rate'], cents(x.Debit) + cents(x.Credit)], [code, rate, fx], n);
  }
  assert.deepEqual(findingsOf(r, 'JRN-CONTACT-CURRENCY').map(f => f.Record).filter(x => /R\/00|PY\/00/.test(x)), []);
  assert.ok(assumption(r, 'forex_journal_in_currency'));
  assert.equal(rowsOf(r, 'other_journals').filter(x => x['Reference Number'] === 'RCT-R/003').every(x => x.Currency === 'INR'), true, 'a rupee party stays in rupees');
});

test('c04 (SYN-5): with the date the accountant enters for PY/004, the payment reaches Zoho Books and the trial balance is Tally\'s', async () => {
  const r = await run('c04_exporter', { corrections: [{ number: 'PY/004', date: '2026-02-28' }] });
  assert.deepEqual(r.failedSteps, []);
  assert.notEqual(r.vouchers.find(v => v.number === 'PY/004').went, 'Left out with a reason');
  assert.equal(r.predicted.comparison.agrees, true);
  assert.ok(assumption(r, 'voucher_date_corrected'));
});
