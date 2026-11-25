// S8 (opening balances and chart of accounts): small MADE-UP companies built with fixtures/synthetic/lib.js, each run
// through the REAL app (harness.js), one per finding: OB-002, OB-004, OB-005, OB-006, OB-007, OB-009, OB-011, OB-014, OB-016.
// Every name, GSTIN and amount is made up.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { runCompany, closeApp, request, journalBalances } from './harness.js';
import { company, dr, cr, P, fmt } from '../../fixtures/synthetic/lib.js';
import * as trading from '../../fixtures/synthetic/c02_trading_stock.js';
import * as complex from '../../fixtures/synthetic/c10_complex_openings.js';

after(() => closeApp());
const cents = v => Math.round(Number(String(v ?? '0').replace(/,/g, '') || 0) * 100);
const kinds = (r, kind) => r.exceptions.filter(e => e.kind === kind);
let serial = 0;
// a company module from a builder; patch(masters) may change the masters export (the Trial Balance stays Tally's)
const moduleOf = (c, patch = null) => ({
  profile: { ...c.profile, key: `s8_${++serial}`, n: 90 + serial },
  masters: () => { const m = c.masters(); if (patch) patch(m); return m; },
  transactions: () => c.transactions(), trialBalance: () => c.trialBalance(), builder: c,
});
const setOpening = (m, name, paise) => { const rec = m.tallymessage.find(x => x.metadata?.type === 'Ledger' && x.metadata.name === name); rec.openingbalance = fmt(paise); };
const plain = (key, opts = {}) => {
  const c = company({ key, name: `Maplewood ${key} Pvt Ltd`, stateCode: '29', pan: 'AAACM' + String(1000 + serial).slice(-4) + 'Q', fy: '2025-26' });
  if (opts.booksFrom) c.booksFrom = opts.booksFrom; // Tally's books-beginning date, on every ledger
  // a customer and a vendor with no balance: the Customer and Vendor Master datasets are required
  if (!opts.noParties) c.party('Birchfield Traders', 'customer', { stateCode: '29' }).party('Cedar Lane Supplies', 'vendor', { stateCode: '29' });
  return c;
};

test('OB-004: a ledger named like a Zoho account of another kind (or the adjustment account) keeps an account of its own; a same-kind one uses Zoho\'s', async () => {
  const c = plain('clash');
  c.group('Contract Work', 'Current Assets');
  c.ledger('Capital', 'Capital Account', { cr: 8000 })
    .ledger('Investments', 'Investments', { dr: 5000 })
    .ledger('Contract Assets', 'Current Assets', { dr: 2000 })
    .ledger('Cash', 'Cash-in-Hand', { dr: 1000 })
    .ledger('Bank Fees and Charges', 'Indirect Expenses')
    .ledger('Other Charges', 'Indirect Incomes');
  c.journal({ number: 'J/1', date: '20250510', lines: [dr('Bank Fees and Charges', 100), cr('Cash', 100)] });
  c.journal({ number: 'J/2', date: '20250511', lines: [dr('Cash', 40), cr('Other Charges', 40)] });
  const r = await runCompany(moduleOf(c));
  const coa = Object.fromEntries(r.files.accounts.rows.map(x => [x['Account Name'], x]));
  assert.equal(coa['Investments (Tally)']?.['Account Type'], 'Other Asset', 'an asset is not put on Zoho\'s Equity "Investments"');
  assert.equal(coa['Contract Assets (Tally)']?.['Account Type'], 'Other Current Asset', 'an asset is not put on Zoho\'s Expense "Contract Assets"');
  assert.equal(coa['Other Charges (Tally)']?.['Account Type'], 'Other Income', 'the invoice adjustment account is never taken over');
  assert.equal(coa['Bank Fees and Charges'], undefined, 'an expense named like Zoho\'s expense account uses Zoho\'s');
  const ob = r.files.opening_balances_for_zoho_accounts.rows;
  const on = a => ob.filter(x => x.Account === a).reduce((t, x) => t + cents(x.Debit) - cents(x.Credit), 0);
  assert.deepEqual([on('Investments (Tally)'), on('Contract Assets (Tally)'), on('Investments'), on('Contract Assets')], [500000, 200000, 0, 0]);
  assert.deepEqual(kinds(r, 'zoho_own_account_name_renamed').map(e => e.name).sort(), ['Contract Assets', 'Investments', 'Other Charges']);
  assert.ok(r.assumptions.assumptions.some(a => a.kind === 'zoho_own_account_name_renamed'), 'listed under Assumptions the tool made');
  const j = r.files.journals.rows.find(x => /J\/2/.test(x['Reference Number'] || '') && cents(x.Credit));
  assert.equal(j?.Account, 'Other Charges (Tally)', 'vouchers use the renamed account');
  assert.equal(r.predicted.comparison.agrees, true, JSON.stringify(r.predicted.comparison.counts));
});

test('OB-011: ledger masters that do not add up to zero are flagged and block the import (not pushed into Opening Balance Adjustments silently)', async () => {
  const c = plain('unbalanced');
  c.ledger('Capital', 'Capital Account', { cr: 1000 }).ledger('Cash', 'Cash-in-Hand', { dr: 1000 }).ledger('Office Expenses', 'Indirect Expenses');
  c.journal({ number: 'J/1', date: '20250510', lines: [dr('Office Expenses', 10), cr('Cash', 10)] });
  const r = await runCompany(moduleOf(c, m => setOpening(m, 'Cash', -P(1500))));
  const f = kinds(r, 'opening_balances_differ_in_tally');
  assert.equal(f.length, 1);
  assert.match(f[0].name, /difference 500\.00 Debit/);
  const rep = (await request({ url: `/api/migrations/${r.id}/test-report` })).json();
  assert.ok(rep.whatToFixNext.some(x => x.blocking && /opening_balances_differ_in_tally/.test(x.message)), 'it blocks the import');
  // the master differs from the Trial Balance report too: named per ledger
  assert.match(kinds(r, 'opening_balance_differs_from_trial_balance')[0]?.message || '', /"Cash" master 1500\.00 Debit, Trial Balance 1000\.00 Debit/);
});

test('OB-002: books beginning inside the year date the opening balance journal and the Migration Date the day before they begin', async () => {
  const c = plain('midyear', { booksFrom: '20251001' });
  c.ledger('Capital', 'Capital Account', { cr: 1000 }).ledger('Cash', 'Cash-in-Hand', { dr: 1000 }).ledger('Office Expenses', 'Indirect Expenses');
  c.journal({ number: 'J/1', date: '20251115', lines: [dr('Office Expenses', 10), cr('Cash', 10)] });
  const r = await runCompany(moduleOf(c));
  const ob = r.files.opening_balances_for_zoho_accounts.rows;
  assert.ok(ob.length && ob.every(x => x['Journal Date'] === '2025-09-30'), JSON.stringify(ob.map(x => x['Journal Date'])));
  assert.equal(kinds(r, 'migration_date_books_begin').length, 1);
  const w = (await request({ url: `/api/migrations/${r.id}/import-wizard` })).json();
  const date = w.steps.find(s => s.kind === 'date');
  if (date) assert.equal(date.date.value, '2025-09-30');
  assert.equal(r.zohoCheck.overall.rowsWill, 0);
});

test('OB-002: books beginning before the year: masters that are not the Trial Balance opening block; masters that are pass', async () => {
  const build = () => {
    const c = plain('multiyear', { booksFrom: '20200401' });
    c.ledger('Capital', 'Capital Account', { cr: 1000 }).ledger('Cash', 'Cash-in-Hand', { dr: 1000 }).ledger('Office Expenses', 'Indirect Expenses');
    c.journal({ number: 'J/1', date: '20250510', lines: [dr('Office Expenses', 10), cr('Cash', 10)] });
    return c;
  };
  // the masters hold the 2020 balances (made up), the report the balances of 1 April 2025
  const bad = await runCompany(moduleOf(build(), m => { setOpening(m, 'Cash', -P(1500)); setOpening(m, 'Capital', P(1500)); }));
  const f = kinds(bad, 'opening_balance_differs_from_trial_balance');
  assert.equal(f.length, 1);
  assert.match(f[0].message, /books begin on 2020-04-01, before the year \(2025-04-01\)/);
  assert.match(f[0].message, /"Capital" master 1500\.00 Credit, Trial Balance 1000\.00 Credit/);
  assert.equal(kinds(bad, 'opening_balances_differ_in_tally').length, 0, 'the masters still add up to zero');
  const good = await runCompany(moduleOf(build()));
  assert.deepEqual([kinds(good, 'opening_balance_differs_from_trial_balance').length, kinds(good, 'opening_balances_books_begin_earlier').length], [0, 0]);
});

test('OB-009: contacts with balances and no chart ledger balance: exactly one balance to type (Retained Earnings), left out of the journal', async () => {
  const c = plain('anchor');
  c.ledger('Profit & Loss A/c', null, { cr: 300, extra: { metadata: { type: 'Ledger', name: 'Profit & Loss A/c', reservedname: 'Profit & Loss A/c' } } })
    .ledger('Cash', 'Cash-in-Hand').ledger('Office Expenses', 'Indirect Expenses');
  c.party('Rowan Retail', 'customer', { stateCode: '29', extraOpening: -P(1000) })
    .party('Alder Supplies', 'vendor', { stateCode: '29', extraOpening: P(700) });
  c.journal({ number: 'J/1', date: '20250510', lines: [dr('Office Expenses', 50), cr('Cash', 50)] });
  const r = await runCompany(moduleOf(c));
  const w = (await request({ url: `/api/migrations/${r.id}/import-wizard` })).json();
  const date = w.steps.find(s => s.kind === 'date');
  assert.equal(date?.mode, 'type');
  assert.deepEqual(date.balancesToType, [{ account: 'Retained Earnings', side: 'Credit', amount: '300.00' }]);
  assert.equal((r.files.opening_balances_for_zoho_accounts?.rows || []).filter(x => x.Account === 'Retained Earnings').length, 0, 'not counted twice');
  assert.equal(kinds(r, 'opening_date_balance_to_type').length, 1);
  assert.equal(r.predicted.comparison.agrees, true, 'the typed balance is in the expected Zoho figures: ' + JSON.stringify(r.predicted.comparison.counts));
});

test('OB-014: a credit card under a group of its own stays Other Current Liability and is listed as an assumption', async () => {
  const c = plain('card');
  c.group('Credit Cards', 'Current Liabilities');
  c.ledger('Capital', 'Capital Account', { cr: 600 }).ledger('Cash', 'Cash-in-Hand', { dr: 1000 }).ledger('Corporate Credit Card', 'Credit Cards', { cr: 400 }).ledger('Office Expenses', 'Indirect Expenses');
  c.journal({ number: 'J/1', date: '20250510', lines: [dr('Office Expenses', 25), cr('Corporate Credit Card', 25)] });
  const r = await runCompany(moduleOf(c));
  assert.equal(r.files.accounts.rows.find(x => x['Account Name'] === 'Corporate Credit Card')?.['Account Type'], 'Other Current Liability');
  assert.deepEqual(kinds(r, 'card_ledger_as_liability').map(e => e.name), ['Corporate Credit Card']);
  assert.ok(r.assumptions.assumptions.some(a => a.kind === 'card_ledger_as_liability'));
});

test('OB-007 / OB-016: OB-1 holds only kinds of line Zoho took in our imports, OB-3 the rest; each balances and the totals per account are kept', async () => {
  const r = await runCompany(complex);
  const ob = r.files.opening_balances_for_zoho_accounts.rows;
  const types = Object.fromEntries(r.files.accounts.rows.map(x => [x['Account Name'], x['Account Type']]));
  const proven = new Set(['GST Payable', 'Advance Tax', 'TDS Receivable', 'Opening Balance Adjustments']);
  const bad = ob.filter(x => x['Journal Number Suffix'] === '1' && !proven.has(x.Account) && types[x.Account] !== 'Bank').map(x => x.Account);
  assert.deepEqual(bad, [], 'OB-1 carries no unproven kind of line');
  assert.ok(ob.some(x => x['Journal Number Suffix'] === '3'), 'the unproven lines are in OB-3');
  for (const j of journalBalances({ rows: ob })) assert.equal(j.debit, j.credit, `${j.journal} balances`);
  // every Tally opening is still carried once (company 10's own check), and the Opening Balance Adjustments lines net to
  // what one journal had: the opposite of everything else in the file
  const other = ob.filter(x => x.Account !== 'Opening Balance Adjustments').reduce((t, x) => t + cents(x.Debit) - cents(x.Credit), 0);
  const oba = ob.filter(x => x.Account === 'Opening Balance Adjustments').reduce((t, x) => t + cents(x.Debit) - cents(x.Credit), 0);
  assert.equal(oba, -other);
  assert.equal(kinds(r, 'opening_journal_split').length, 1);
  assert.equal(kinds(r, 'opening_journal_on_migration_date').length, 1, 'OB-016: the journal on the Migration Date is an open assumption');
  assert.equal(r.predicted.comparison.counts.mustBeZeroOpen, 0);
});

// (changed on purpose, round 2: the Stock balance is in OB-3, never in the chart, so it cannot lock the date; its journal
// line is what no import has shown yet)
test('OB-005 / OB-006: a company with stock: the Stock balance is in OB-3, its line may be refused, and the closing stock not carried is a decision', async () => {
  const r = await runCompany(trading);
  assert.equal(r.findings.filter(x => x.Rule === 'COA-STOCK-OB-LOCKS-DATE').length, 0, 'no Stock balance in the chart');
  const f = r.findings.filter(x => x.Rule === 'JRN-STOCK-ACCOUNT-LINE');
  assert.ok(f.length >= 1, 'the Stock line of OB-3 is listed by the Zoho check');
  assert.ok(f.every(x => /not confirmed/i.test(x['Zoho is expected to'] || '')), JSON.stringify(f.map(x => x['Zoho is expected to'])));
  const s = kinds(r, 'closing_stock_not_carried');
  assert.equal(s.length, 1);
  assert.match(s[0].message, /opening value of 192000\.00 Debit/);
  assert.ok(r.assumptions.assumptions.some(a => a.kind === 'closing_stock_not_carried' ));
});
