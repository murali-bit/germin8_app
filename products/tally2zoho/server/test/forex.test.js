// Foreign currency (fix set S3: SYN-5, SYN-14, TALLY-006, OB-001). Every name and amount is MADE UP.
//  - Tally's amount forms are read: plain figures, a Dr / Cr suffix and the foreign-currency form
//    "-€8500.00 @ ₹91.80/€ = -₹780300.00" (the rupee value, plus the foreign amount and rate); NaN, Infinity and
//    anything else are unreadable, never zero;
//  - the three-letter code of a Tally currency comes from its Currency master, else an unambiguous symbol (assumed);
//  - a customer or vendor kept in another currency is written with its Currency Code and its opening balance in that
//    currency at Tally's rate; an opening with no foreign amount is flagged (in no file);
//  - the expected Zoho Books trial balance converts foreign documents and openings at the rate written;
//  - an unreadable voucher line is counted as unreadable in the movement check, never as zero.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Decimal from 'decimal.js';
import { parseTallyAmount, money, voucherBalance } from '../src/tally.js';
import { currencyCode } from '../src/zohocodes.js';
import { TEMPLATES } from '../src/zoho.js';
import { predictZohoTb } from '../src/predictedtb.js';
import { movementCollector, analyseTrialBalance } from '../src/trialbalance.js';
import { voucherLines } from '../src/vouchers.js';
import { ASSUMPTIONS } from '../src/defaults.js';

const fx = s => { const a = parseTallyAmount(s); return a && { inr: a.inr.toFixed(2), fx: a.fx ? a.fx.toFixed(2) : null, symbol: a.currencySymbol, rate: a.rate ? a.rate.toString() : null }; };

test('Tally amounts: plain figures, a Dr / Cr suffix and the foreign-currency form are read; anything else is unreadable', () => {
  assert.deepEqual(fx('-€8500.00 @ ₹91.80/€ = -₹780300.00'), { inr: '-780300.00', fx: '-8500.00', symbol: '€', rate: '91.8' });
  assert.deepEqual(fx('$4500.00 @ ₹85.40/$ = ₹384300.00'), { inr: '384300.00', fx: '4500.00', symbol: '$', rate: '85.4' });
  // spaces after the symbols, no rupee sign
  assert.deepEqual(fx('-$ 1000.00 @ 80.00/$ = -80000.00'), { inr: '-80000.00', fx: '-1000.00', symbol: '$', rate: '80' });
  assert.deepEqual(fx('-$ 100.00 @ ₹ 83.00/$ = -₹ 8300.00'), { inr: '-8300.00', fx: '-100.00', symbol: '$', rate: '83' });
  assert.equal(money('-€8500.00 @ ₹91.80/€ = -₹780300.00').toFixed(2), '-780300.00');
  // Dr is a debit (Tally's sign: negative), Cr a credit
  assert.equal(money('-100.00 Dr').toFixed(2), '-100.00');
  assert.equal(money('100.00 Dr').toFixed(2), '-100.00');
  assert.equal(money('250.50 Cr').toFixed(2), '250.50');
  assert.equal(money('1,180.50').toFixed(2), '1180.50');
  assert.equal(money('').toFixed(2), '0.00');
  for (const bad of ['NaN', 'Infinity', '-Infinity', ' ', '$100.00', 'abc', '€100 @ ₹90/€']) assert.equal(money(bad), null, `"${bad}" is unreadable`);
});

test('a voucher with an unreadable amount is flagged as unreadable (not as debits and credits that differ)', () => {
  const v = { allledgerentries: [{ ledgername: 'Rent', amount: '-€100 @ ₹90/€' }, { ledgername: 'Bank', amount: '9000.00' }] };
  const b = voucherBalance(v);
  assert.equal(b.ok, false);
  assert.equal(b.unreadable, true);
  assert.match(b.error, /Unreadable amount/);
  const ok = voucherBalance({ allledgerentries: [{ ledgername: 'Export Sales', amount: '€100.00 @ ₹90.00/€ = ₹9000.00' }, { ledgername: 'Kiel Optik GmbH', amount: '-€100.00 @ ₹90.00/€ = -₹9000.00', ispartyledger: true }] });
  assert.equal(ok.ok, true);
  // the lines keep the foreign amount and the rate
  const lines = voucherLines({ allledgerentries: [{ ledgername: 'Kiel Optik GmbH', amount: '-€100.00 @ ₹90.00/€ = -₹9000.00' }] });
  assert.equal(lines[0].amount.toFixed(2), '-9000.00');
  assert.deepEqual([lines[0].forex.fx.toFixed(2), lines[0].forex.symbol, lines[0].forex.rate.toString()], ['-100.00', '€', '90']);
});

test('the code of a Tally currency: from its Currency master, else an unambiguous symbol (assumed), else none', () => {
  const masters = [{ name: '€', expandedsymbol: 'EUR', mailingname: 'Euro' }, { name: 'Fr', mailingname: 'CHF' }, { name: '₹', expandedsymbol: 'INR', mailingname: 'INR' }];
  assert.deepEqual(currencyCode('€', masters), { code: 'EUR', source: 'master', field: 'expandedsymbol' });
  assert.equal(currencyCode('Fr', masters).code, 'CHF');
  assert.deepEqual(currencyCode('₹', masters), { code: 'INR', source: 'rupee' });
  assert.deepEqual(currencyCode('', masters), { code: 'INR', source: 'rupee' });
  assert.deepEqual(currencyCode('$', []), { code: 'USD', source: 'symbol_table' });
  assert.deepEqual(currencyCode('GBP', []), { code: 'GBP', source: 'name' });
  assert.deepEqual(currencyCode('¥', []), { code: '', source: 'unknown' }, 'the yen and the yuan share the symbol: not guessed');
  for (const k of ['currency_code_from_tally', 'currency_code_assumed', 'forex_document_in_currency', 'forex_rounding_difference', 'forex_journal_in_rupees', 'foreign_account_in_rupees', 'foreign_opening_not_written', 'unreadable_amount', 'opening_balance_unreadable']) {
    assert.ok(ASSUMPTIONS[k]?.title, `"${k}" is listed under "Assumptions the tool made"`);
  }
  assert.equal(ASSUMPTIONS.foreign_opening_not_written.blocking, true);
  assert.equal(ASSUMPTIONS.unreadable_amount.blocking, true);
});

test('a customer or vendor kept in another currency: Currency Code, and the opening balance in that currency at Tally\'s rate', () => {
  const ctx = { asOf: '20260331', currencies: [{ name: '€', expandedsymbol: 'EUR' }, { name: '$', expandedsymbol: 'USD' }] };
  const party = (name, parent, openingbalance, currencyname) => ({ metadata: { type: 'Ledger', name }, parent, openingbalance, currencyname,
    ledmailingdetails: [{ applicablefrom: '20200401', mailingname: name, address: [{ metadata: true }, 'Hafenstrasse 4'], state: '', pincode: '20095', country: 'Germany' }] });
  const kiel = party('Kiel Optik GmbH', 'Sundry Debtors', '-€6000.00 @ ₹92.40/€ = -₹554400.00', '€');
  const row = TEMPLATES.customers.row(kiel, ctx);
  assert.deepEqual([row['Currency Code'], row['Opening Balance'], row['Opening Balance Exchange Rate']], ['EUR', '6000.00', '92.4']);
  const flags = TEMPLATES.customers.check(kiel, ctx);
  assert.ok(flags.some(f => f.kind === 'currency_code_from_tally' && /Settings > Currencies/.test(f.message)));
  assert.ok(!flags.some(f => f.kind === 'currency_not_rupee'));
  // a vendor in dollars
  const tern = party('Tern Valves LLC', 'Sundry Creditors', '$3200.00 @ ₹85.40/$ = ₹273280.00', '$');
  const vrow = TEMPLATES.vendors.row(tern, ctx);
  assert.deepEqual([vrow['Currency Code'], vrow['Opening Balance'], vrow['Opening Balance Exchange Rate']], ['USD', '3200.00', '85.4']);
  // Tally converted each opening bill and rounded each: Zoho converts the total, a paisa away -> flagged
  const bills = party('Kiel Optik GmbH', 'Sundry Debtors', '-€2020.20 @ ₹92.15/€ = -₹186161.44', '€');
  assert.ok(TEMPLATES.customers.check(bills, ctx).some(f => f.kind === 'forex_rounding_difference' && /0\.01/.test(f.message)));
  // an opening of a foreign party with only a rupee figure cannot be written in the currency: in no file, flagged
  const rupeeOnly = party('Kiel Optik GmbH', 'Sundry Debtors', '-5000.00', '€');
  assert.deepEqual([TEMPLATES.customers.row(rupeeOnly, ctx)['Currency Code'], TEMPLATES.customers.row(rupeeOnly, ctx)['Opening Balance']], ['EUR', '']);
  assert.ok(TEMPLATES.customers.check(rupeeOnly, ctx).some(f => f.kind === 'foreign_opening_not_written' && /5000\.00/.test(f.message)));
  // a rupee party is unchanged
  const local = party('Indus Traders', 'Sundry Debtors', '-2500.00', '₹');
  const lrow = TEMPLATES.customers.row(local, ctx);
  assert.deepEqual([lrow['Currency Code'], lrow['Opening Balance'], lrow['Opening Balance Exchange Rate']], ['INR', '2500.00', '']);
});

test('the expected Zoho Books trial balance converts foreign documents and openings at the rate written', () => {
  const p = predictZohoTb({
    customers: [{ display_name: 'Kiel Optik GmbH', currency_code: 'EUR', opening_balance: '6000.00', opening_balance_exchange_rate: '92.40' }],
    invoices: [
      { invoice_number: 'EX/3', customer_name: 'Kiel Optik GmbH', currency_code: 'EUR', exchange_rate: '92.15', account: 'Export Sales', quantity: '1', item_price: '1010.10' },
      { invoice_number: 'EX/3', customer_name: 'Kiel Optik GmbH', currency_code: 'EUR', exchange_rate: '92.15', account: 'Export Sales', quantity: '1', item_price: '1010.10' },
    ],
    bills: [{ bill_number: 'B-1', vendor_name: 'Tern Valves LLC', currency_code: 'USD', exchange_rate: '85.60', account: 'Purchases', quantity: '1', rate: '5000.00' }],
  });
  const acc = n => [...p.accounts.values()].find(a => a.name === n)?.amount.toFixed(2);
  // 6000 x 92.40 + 2020.20 x 92.15 (Zoho converts the invoice total: 186161.43, not Tally's 186161.44)
  assert.equal(acc('Accounts Receivable'), new Decimal(-554400).minus('186161.43').toFixed(2));
  assert.equal(acc('Export Sales'), '186161.43');
  assert.equal(acc('Accounts Payable'), '428000.00');
  assert.equal(acc('Purchases'), '-428000.00');
});

test('an unreadable voucher line is counted as unreadable in the movement check, never as zero', () => {
  const m = movementCollector();
  m.add([{ ledger: 'Rent', amount: null }, { ledger: 'Cauvery Bank', amount: new Decimal('8300') }]);
  assert.equal(m.unreadable, 1);
  assert.equal(m.unreadableOf('Rent'), 1);
  const line = (name, d, c) => ({ name, depth: 0, haschildren: false, openingbalance: '', debittotal: d, credittotal: c, closingbalance: (Number(c) - Number(d)).toFixed(2) });
  const a = analyseTrialBalance({ lines: [line('Rent', '8300.00', '0.00'), line('Cauvery Bank', '0.00', '8300.00')], ledgers: [{ name: 'Rent', parent: 'Indirect Expenses' }, { name: 'Cauvery Bank', parent: 'Bank Accounts' }], groups: [], movement: m });
  assert.equal(a.summary.movement.unreadableLines, 1);
  const flag = a.flags.find(f => f.kind === 'trial_balance_movement_differs' && f.name === 'Rent');
  assert.ok(flag, 'the line with the unreadable amount does not agree');
  assert.match(flag.message, /cannot read/);
  assert.doesNotMatch(flag.message, /shorter period/);
});
