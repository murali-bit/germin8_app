// The synthetic test-company library, run through the REAL app (test/synthetic/harness.js): for every company in
// server/fixtures/synthetic (cNN_*.js) the invariants a correct migration must keep:
//  1. every source voucher is accounted for exactly once (written + left out + held + waiting + kept = total), each in
//     the Zoho file it belongs in, and the vouchers that must never reach a file are in none;
//  2. each deliberate problem of the company is flagged, with a plain message;
//  3. the Zoho check expects Zoho Books to refuse no row of a clean record (only rows of the problem records may be);
//  4. every generated journal balances, and no file carries a date that is not a real calendar date;
//  5. Zoho's tax and the amount owed per clean document are what Zoho Books will work out, and equal Tally's;
//  6. the predicted Zoho Books trial balance equals Tally's closing balances, or every difference is listed with a reason;
//     the Tally report is read with Tally's own totals, and the opening balances tie in Zoho Books;
//  7. the Trial Balance movement check flags only lines a problem record explains;
//  8. the invariants of the company itself (expect.checks), for example foreign currency, reverse charge or SEZ;
//  9. a variant of a company (company.variants, for example without any Duties & Taxes ledger) runs through every step.
// A check that fails because the TOOL is wrong is never weakened: it is marked { todo: 'BUG <id>: ...' } in KNOWN_BUGS
// and reported. Every company and every value is MADE UP (see fixtures/synthetic/lib.js).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runCompany, closeApp, refusedFindings, journalBalances } from './harness.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, '../../fixtures/synthetic');
const companies = [];
for (const f of fs.readdirSync(dir).filter(n => /^c\d{2}_.+\.js$/.test(n)).sort()) companies.push(await import(pathToFileURL(path.join(dir, f)).href));
after(() => closeApp());

// Known defects of the TOOL found by this library: company key + check -> the todo text. The check keeps its full
// strength; when the tool is fixed, the todo passes and the line is removed.
const KNOWN_BUGS = {
  // companies 4-6
  'exporter:tb': 'BUG SYN-5: payment PY/004 (Tally date 20260229, a day that does not exist) is left out of the files, so the bank and Bank Charges differ from Tally by 1180.00. The predicted trial balance names the voucher as the reason, and without a person the tool never guesses a date. Round 2 added the outcome "correct the date" (Voucher Classification): with the date the accountant enters the trial balance equals Tally (test/synthetic/round2.test.js); this default run, with no one to enter it, still differs',
  // companies 7-10 (SYN-11 onwards, so the numbers of companies 4-6 stay free)
  'forex:check:forex_contacts': 'BUG SYN-14: a customer or vendor kept in euros or dollars is written with an empty Currency Code (zoho.js contactRow: "INR" or ""), so Zoho Books makes it a rupee contact and cannot hold its foreign balance (no realised or unrealised exchange difference after the migration); the tool only flags currency_not_rupee',
};
const opts = (key, check) => (KNOWN_BUGS[`${key}:${check}`] ? { todo: KNOWN_BUGS[`${key}:${check}`] } : {});

const cents = v => Math.round(Number(String(v ?? '0').replace(/,/g, '') || 0) * 100);
const money = p => (p / 100).toFixed(2);
// rate% of an amount in paise, rounded half up to the paisa (each part of a tax on its own, as Zoho Books does)
const part = (paise, rate) => { const n = paise * Math.round(rate * 100); const s = Math.sign(n); const a = Math.abs(n); const q = Math.floor(a / 10000); return s * (((a % 10000) * 2 >= 10000) ? q + 1 : q); };
const zohoTaxOfRow = (amount, rate, type) => (/tax group/i.test(type) ? 2 * part(amount, rate / 2) : part(amount, rate));
// A plain message: real words, long enough to say what is wrong, no code leaking into it.
const plain = m => typeof m === 'string' && m.trim().length >= 30 && !/\bundefined\b|\bNaN\b|\[object |\bnull\b|at .+\.js:\d+/.test(m);
const realDate = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); if (!m) return false; const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]; };
const DATE_COLUMNS = ['Invoice Date', 'Bill Date', 'Journal Date', 'Due Date', 'Date'];
// the file key of each module name the Zoho check findings use (they name a file as the Zoho check does)
const moduleKeys = r => Object.fromEntries([...(r.fileList || []), ...(r.zohoCheck?.files || [])].map(f => [f.module, f.key]));

for (const company of companies) {
  const { profile, expect: E } = company;
  const key = profile.key;
  let run = null;
  const ready = async () => { if (!run) run = await runCompany(company); return run; };
  const label = `company ${profile.n} (${key})`;

  test(`${label}: every step of the run succeeds`, opts(key, 'steps'), async () => {
    const r = await ready();
    assert.deepEqual(r.failedSteps, [], JSON.stringify(r.failedSteps));
    assert.ok(r.control, 'the voucher control total is there after generation');
  });

  test(`${label}: every source voucher is accounted for exactly once`, opts(key, 'accounted'), async () => {
    const r = await ready();
    const c = r.control;
    assert.equal(c.stored, E.vouchers.total, 'every voucher of the Tally file is stored');
    const written = Object.values(c.written).reduce((t, n) => t + n, 0);
    const waiting = Object.values(c.waitingForZohoSample).reduce((t, n) => t + n, 0);
    const kept = Object.values(c.keptWithoutZohoFile).reduce((t, n) => t + n, 0);
    assert.equal(written + c.leftOut + c.awaitingRouting + waiting + kept, E.vouchers.total, JSON.stringify(c));
    assert.equal(c.balanced, true);
    assert.equal(r.recon.total.in, E.vouchers.total);
    assert.equal(r.recon.total.matches, true);
    assert.deepEqual(r.recon.checks.filter(x => !x.ok).map(x => x.key), [], 'every check of the voucher reconciliation is OK');
    // one entry per voucher, and each voucher number once (the numbers of these companies are unique)
    assert.equal(r.vouchers.length, E.vouchers.total);
    const numbers = r.vouchers.map(v => v.number);
    assert.equal(new Set(numbers).size, numbers.length, `a voucher is listed twice: ${numbers.filter((n, i) => numbers.indexOf(n) !== i)}`);
    const by = Object.fromEntries(r.vouchers.map(v => [v.number, v]));
    for (const [file, { clean, problem }] of Object.entries(E.files)) {
      for (const n of clean) assert.equal(by[n]?.fileKey, file, `${n} must be written to ${file}, went: ${by[n]?.went}`);
      for (const n of problem) assert.ok(!by[n]?.fileKey || by[n].fileKey === file, `${n} may only be written to ${file} or left out of the files, went: ${by[n]?.went}`);
    }
    for (const n of E.notWritten) assert.equal(by[n]?.fileKey ?? null, null, `${n} must not be written to any file, went: ${by[n]?.went}`);
    for (const n of E.keptWithoutFile || []) assert.equal(by[n]?.dest, 'no_file', `${n} is kept with no Zoho file`);
    // a voucher that may correctly go to one of several files (for example a sale entered as a journal: an invoice, or a
    // journal naming the customer; both post the same amounts)
    for (const [n, files] of Object.entries(E.anyOf || {})) assert.ok(files.includes(by[n]?.fileKey), `${n} must be written to one of ${files.join(', ')}, went: ${by[n]?.went}`);
    // every voucher not in a file has a reason (left out, kept for a type with no file, waiting): none simply dropped
    for (const v of r.vouchers) assert.ok(v.fileKey || ['left_out', 'no_file', 'awaiting_routing'].includes(v.dest) || /^held:/.test(v.dest), `${v.number}: ${v.went}`);
  });

  for (const p of E.problems) {
    test(`${label}: problem ${p.id} is flagged with a plain message (${p.what})`, opts(key, `problem:${p.id}`), async () => {
      const r = await ready();
      // p.noFlagNeededIf(run): the files as written cannot have the problem at all (for example a foreign-currency rounding
      // difference when the document is written in rupees at Tally's value): nothing to flag
      if (p.noFlagNeededIf?.(r)) return;
      const hits = r.exceptions.filter(e => (!p.find.kind || p.find.kind.test(String(e.kind || '')))
        && (!p.find.name || p.find.name.test(String(e.name || '')) || p.find.name.test(String(e.message || '')))
        && (!p.find.message || p.find.message.test(String(e.message || ''))));
      assert.ok(hits.length > 0, `no flagged item for ${p.id}; flagged kinds: ${[...new Set(r.exceptions.map(e => e.kind))].join(', ')}`);
      for (const h of hits) assert.ok(plain(h.message), `not a plain message: ${h.message}`);
    });
  }

  test(`${label}: the Zoho check expects Zoho Books to refuse no row of a clean record`, opts(key, 'refused'), async () => {
    const r = await ready();
    assert.equal(r.zohoCheck.available, true);
    const moduleKey = moduleKeys(r);
    const docOf = new Map(); // file key + document number written -> voucher number
    for (const v of r.vouchers) if (v.fileKey) docOf.set(`${v.fileKey}|${v.documentNumber}`, v.number);
    const wrong = [];
    for (const f of refusedFindings(r)) {
      const file = moduleKey[f.File] || f.File;
      const voucher = docOf.get(`${file}|${f.Record}`) || f.Record;
      if (!(E.mayBeRefused[file] || []).includes(voucher)) wrong.push(`${f.File} | ${voucher} | ${f.Rule}`);
    }
    assert.deepEqual([...new Set(wrong)], [], 'rows of clean records that Zoho Books is expected to refuse');
  });

  test(`${label}: every generated journal balances, and every date written is a real calendar date`, opts(key, 'dates'), async () => {
    const r = await ready();
    for (const k of ['journals', 'other_journals', 'opening_balances_for_zoho_accounts']) {
      if (!r.files[k]) continue;
      const off = journalBalances(r.files[k]).filter(j => j.debit !== j.credit);
      assert.deepEqual(off, [], `${k}: journals that do not balance`);
    }
    const bad = [];
    for (const [k, f] of Object.entries(r.files)) for (const row of f.rows) for (const col of DATE_COLUMNS) if (row[col] && !realDate(row[col])) bad.push(`${k}: ${col} "${row[col]}"`);
    assert.deepEqual(bad, [], 'dates that are not real calendar dates');
  });

  test(`${label}: Zoho's tax and the amount owed per clean document equal Tally's`, opts(key, 'documents'), async () => {
    const r = await ready();
    for (const [n, d] of Object.entries(E.documents)) {
      const v = r.vouchers.find(x => x.number === n);
      const inv = d.file === 'invoices';
      const rows = r.files[d.file].rows.filter(x => (inv ? x['Invoice Number'] : x['Bill Number']) === v.documentNumber);
      assert.ok(rows.length, `${n} has rows in ${d.file}`);
      let sub = 0, tax = 0;
      for (const x of rows) {
        const amount = Math.round(Number(x.Quantity || 1) * cents(inv ? x['Item Price'] : x.Rate));
        sub += amount;
        const rate = Number(inv ? x['Item Tax %'] : x['Tax Percentage']) || 0;
        tax += zohoTaxOfRow(amount, rate, inv ? x['Item Tax Type'] : x['Tax Type']);
      }
      const adjustment = cents(rows[0].Adjustment), tds = cents(rows[0]['TDS Amount']);
      assert.equal(money(tax), d.tax, `${n}: the tax Zoho Books works out`);
      assert.equal(d.tax, d.tallyTax, `${n}: a clean document has the same tax in Zoho Books and Tally`);
      assert.equal(money(sub + tax + adjustment - tds), d.partyAmount, `${n}: what the ${inv ? 'customer' : 'vendor'} owes`);
      assert.equal(money(tds), d.tds, `${n}: TDS`);
    }
    if (E.rounding) {
      const f = r.exceptions.find(e => e.name?.includes(E.rounding.number) && e.message.includes(E.rounding.zohoTax) && e.message.includes(E.rounding.tallyTax));
      assert.ok(f, `the rounding document ${E.rounding.number} is flagged with Zoho's tax ${E.rounding.zohoTax} and Tally's ${E.rounding.tallyTax}`);
    }
    if (E.items) {
      const items = r.files.items?.rows || [];
      assert.equal(items.length, E.items.count, 'one Items row per stock item');
      for (const it of items) assert.ok(E.items.units.includes(it['Usage unit']), `${it['Item Name']}: unit ${it['Usage unit']}`);
      if (E.items.noWarehouse) for (const k of ['invoices', 'bills', 'items']) for (const x of r.files[k]?.rows || []) assert.equal(x['Warehouse Name'] || '', '', `${k}: godowns are not written`);
    }
  });

  test(`${label}: the predicted Zoho Books trial balance equals Tally's, or each difference is listed with a reason`, opts(key, 'tb'), async () => {
    const r = await ready();
    // the fixture itself: Tally's closing balances (openings + every posted voucher) tie
    const tb = company.builder.ledgerFigures();
    assert.equal([...tb.values()].reduce((s, x) => s + x.closing, 0), 0, 'the closing balances of the fixture tie');
    // the report as the tool read it: the totals of the top-level lines (each group netted, as Tally shows them)
    const sides = col => { let d = 0, c = 0; for (const l of company.trialBalance().dspaccbody.dspaccline) { const v = Math.round((l.dspaccinfo[0][col][`${col}a`] || 0) * 100); if (v < 0) d -= v; else c += v; } return [money(d), money(c)]; };
    const t = r.trialBalance.summary.totals;
    assert.deepEqual([t.openingDebit, t.openingCredit], [E.openingTotals.debit, E.openingTotals.credit], 'the opening totals of the Tally report as read');
    assert.deepEqual([t.openingDebit, t.openingCredit], sides('dspopamt'), 'the opening totals of the top-level lines');
    assert.deepEqual([t.closingDebit, t.closingCredit], sides('dspclamt'), 'the closing totals of the Tally report as read');
    assert.equal(r.trialBalance.summary.totals.closingBalanced, true);
    const p = r.predicted;
    assert.equal(p.available, true);
    assert.ok(p.comparison, p.problem || 'there is a comparison');
    for (const z of p.comparison.mustBeZero) assert.equal(z.ok, true, `${z.account} must end at zero in Zoho Books: ${JSON.stringify(z.predicted)}`);
    const c = p.comparison;
    const unexplained = [];
    for (const a of [...c.accounts.differing, ...c.accounts.onlyTally, ...c.accounts.onlyZoho]) {
      if (!E.tbDifferences.some(d => d.match.test(a.account))) unexplained.push(`account ${a.account}: Tally ${a.tally?.signed ?? 0}, Zoho ${a.zoho?.signed ?? 0}`);
    }
    for (const side of ['customers', 'vendors']) for (const x of c.contacts[side].rows.filter(y => y.difference && cents(y.difference.amount) !== 0)) {
      if (!E.tbDifferences.some(d => d.match.test(x.contact))) unexplained.push(`${side} ${x.contact}: Tally ${x.tally?.signed}, Zoho ${x.zoho?.signed}`);
    }
    assert.deepEqual(unexplained, [], 'differences with no reason');
  });

  test(`${label}: the predicted trial balance does not post documents the Zoho check expects Zoho Books to refuse`, opts(key, 'predicted_refused'), async () => {
    const r = await ready();
    const moduleKey = moduleKeys(r);
    const docKey = { invoices: x => x['Invoice Number'], bills: x => `${x['Vendor Name']}|${x['Bill Number']}`, journals: x => `${x['Journal Number Prefix']}${x['Journal Number Suffix']}`, other_journals: x => `${x['Journal Number Prefix']}${x['Journal Number Suffix']}` };
    const identOf = { invoices: x => x['Invoice Number'], bills: x => x['Bill Number'], journals: x => x['Reference Number'], other_journals: x => x['Reference Number'] };
    const wrong = [];
    for (const f of r.predicted.files.filter(x => docKey[x.key] && x.documents != null)) {
      const rows = r.files[f.key]?.rows || [];
      const refusedIdents = new Set(refusedFindings(r).filter(x => (moduleKey[x.File] || x.File) === f.key).map(x => x.Record));
      const docs = new Set(rows.map(docKey[f.key]));
      const refusedDocs = new Set(rows.filter(x => refusedIdents.has(identOf[f.key](x))).map(docKey[f.key]));
      if (f.documents !== docs.size - refusedDocs.size) wrong.push(`${f.key}: ${f.documents} documents posted, ${docs.size} in the file of which ${refusedDocs.size} will be refused`);
    }
    assert.deepEqual(wrong, [], 'the expected Zoho Books balances count documents Zoho Books will refuse');
  });

  test(`${label}: the Trial Balance movement check flags only lines a problem record explains`, opts(key, 'movement'), async () => {
    const r = await ready();
    const flagged = r.exceptions.filter(e => e.kind === 'trial_balance_movement_differs');
    const unexplained = flagged.filter(e => !(E.movementFlags || []).some(m => m.match.test(e.name))).map(e => e.name);
    assert.deepEqual(unexplained, [], 'movement differences no problem record explains');
  });

  // 8. the company's own invariants (expect.checks: [{ id, name, run(run, assert) }]); a known bug is "<key>:check:<id>"
  for (const x of E.checks || []) {
    test(`${label}: ${x.name}`, opts(key, `check:${x.id}`), async () => { await x.run(await ready(), assert); });
  }

  // a variant of the company (company.variants: { name: { profile, masters, transactions, trialBalance } }), for example
  // the same company without any Duties & Taxes ledger: it must run through every step too. A known bug is
  // "<variant profile key>:steps".
  for (const [name, v] of Object.entries(company.variants || {})) {
    test(`${label}, variant ${name}: every step of the run succeeds`, opts(v.profile.key, 'steps'), async () => {
      const r = await runCompany(v);
      assert.deepEqual(r.failedSteps || [], [], JSON.stringify(r.failedSteps || r.steps.filter(s => s.body)));
      assert.ok(!r.failed, `the run stopped at "${r.failed}": ${JSON.stringify(r.steps.filter(s => s.body))}`);
      assert.ok(r.control, 'the voucher control total is there after generation');
    });
  }

  if (E.accountantChoices) {
    test(`${label}: with the choices an accountant makes (${JSON.stringify(E.accountantChoices)}), no row of a clean record is refused`, async () => {
      const r2 = await runCompany(company, { choices: E.accountantChoices });
      assert.deepEqual(r2.failedSteps, []);
      const moduleKey = moduleKeys(r2);
      const docOf = new Map();
      for (const v of r2.vouchers) if (v.fileKey) docOf.set(`${v.fileKey}|${v.documentNumber}`, v.number);
      const wrong = refusedFindings(r2).map(f => { const file = moduleKey[f.File] || f.File; const voucher = docOf.get(`${file}|${f.Record}`) || f.Record; return (E.mayBeRefused[file] || []).includes(voucher) ? null : `${f.File} | ${voucher} | ${f.Rule}`; }).filter(Boolean);
      assert.deepEqual([...new Set(wrong)], []);
      assert.equal(r2.predicted.comparison?.mustBeZero.every(z => z.ok), true);
    });
  }
}

test('the library covers every deliberate problem at least once', () => {
  const all = companies.flatMap(c => c.expect.problems.map(p => p.what.toLowerCase()));
  const needed = [/duplicate party/, /not in the masters/, /invalid date/, /outside the financial year/, /unbalanced/, /unrecognised ledger/, /registered vendor without gstin/,
    /gst rate that does not match/, /tds ledger with no zoho tds tax/, /paisa rounding/, /unsupported voucher type/, /cancelled/, /optional/];
  for (const re of needed) assert.ok(all.some(w => re.test(w)), `no company has the problem ${re}`);
});

// ---------- S4: extraction and completeness (edge-case company X1, fixtures/synthetic/x01_extraction_edges.js) ----------
// Not in the loop above: two of its vouchers deliberately share an identity (E1) or a number (E4). Every voucher of the
// Tally file must have exactly ONE outcome, a Tally voucher (by its guid) must reach Zoho Books at most once, every
// posting voucher must be written, and every journal must carry a usable, unique number.
{
  const X = await import(pathToFileURL(path.join(dir, 'x01_extraction_edges.js')).href);
  const { request, databasePath } = await import('./harness.js');
  const { DatabaseSync } = await import('node:sqlite');
  const body = r => { try { return r.json(); } catch { return r.body; } };
  let xr = null;
  const xready = async () => { if (!xr) xr = await runCompany(X); return xr; };
  const byNumber = r => { const m = new Map(); for (const v of r.vouchers) { if (!m.has(v.number)) m.set(v.number, []); m.get(v.number).push(v); } return m; };

  test('X1 (extraction edges): every step succeeds, every voucher has exactly one outcome, and every reconciliation check passes', async () => {
    const r = await xready();
    assert.deepEqual(r.failedSteps, [], JSON.stringify(r.failedSteps));
    assert.equal(r.control.stored, X.expect.vouchers.total);
    assert.equal(r.control.balanced, true);
    assert.equal(r.vouchers.length, X.expect.vouchers.total, 'one entry per stored voucher (the copy of E1 included)');
    assert.deepEqual(r.recon.checks.filter(x => !x.ok).map(x => x.key), []);
    assert.ok(r.recon.checks.some(x => x.key === 'one_document_per_tally_voucher' && x.ok));
    for (const v of r.vouchers) assert.ok(v.fileKey || ['left_out', 'no_file'].includes(v.dest), `${v.number}: ${v.went}`);
  });

  test('X1 E1: a voucher exported twice (same Tally guid) is written once; the copy is left out as a duplicate and flagged', async () => {
    const r = await xready();
    const copies = byNumber(r).get('S/001');
    assert.deepEqual(copies.map(v => v.dest).sort(), ['left_out', 'written:invoices']);
    assert.equal(copies.find(v => v.dest === 'left_out').reason, 'A second copy of a voucher (same Tally identifier)');
    assert.equal(r.files.invoices.rows.filter(x => x['Invoice Number'] === 'S/001').length, 1, 'one invoice line, not two');
    assert.ok(r.exceptions.some(e => e.kind === 'voucher_duplicate' && /in this file twice/.test(e.message)));
    assert.ok(r.exceptions.some(e => e.kind === 'left_out_duplicate' && plain(e.message)));
  });

  test('X1 E2/E3: Payroll, a custom type and sales that cannot be invoices are Manual Journals; Memorandum has no file; nothing is left out for its shape', async () => {
    const r = await xready();
    const m = byNumber(r);
    for (const [n, kind] of Object.entries(X.expect.journals)) {
      assert.equal(m.get(n)?.[0]?.fileKey, 'journals', `${n} must be a Manual Journal, went: ${m.get(n)?.[0]?.went}`);
      assert.ok(r.exceptions.some(e => e.kind === kind && String(e.name).endsWith(n)), `${n}: flagged ${kind}`);
    }
    for (const n of X.expect.invoices) assert.equal(m.get(n).find(v => v.fileKey)?.fileKey, 'invoices', n);
    for (const n of X.expect.bills) assert.equal(m.get(n)[0].fileKey, 'bills', n);
    for (const n of X.expect.noFile) assert.equal(m.get(n)[0].dest, 'no_file', n);
    for (const [n, reason] of Object.entries(X.expect.leftOut)) assert.equal(m.get(n)[0].dest, 'left_out', `${n}: ${reason}`);
    // the journals post exactly what Tally posted: the counter sale debits Cash, the return credits the customer on Accounts Receivable
    const rows = n => r.files.journals.rows.filter(x => x['Reference Number'] === m.get(n)[0].documentNumber);
    assert.deepEqual(rows('S/004').map(x => [x.Account, x.Debit, x.Credit]), [['Cash', '2500.00', ''], ['Sales - Crafts', '', '2500.00']]);
    assert.deepEqual(rows('S/005').map(x => [x.Account, x['Contact Name'], x.Debit, x.Credit]), [['Accounts Receivable', 'Spice Route Stores', '', '900.00'], ['Sales - Crafts', '', '900.00', '']]);
    // the completeness table explains every voucher type (no left-out reason that hides a voucher)
    const table = body(await request({ url: `/api/migrations/${r.id}/completeness-table` }));
    for (const row of table.rows.filter(x => x.group === 'vouchers')) for (const reason of row.reasons) assert.notEqual(reason.explained, false, `${row.key}: ${reason.kind}`);
  });

  test('X1 E4: every journal has a non-empty, unique number of at most 16 characters ending in digits; generated numbers are assumptions', async () => {
    const r = await xready();
    const seen = new Map();
    for (const k of ['journals', 'other_journals', 'opening_balances_for_zoho_accounts']) {
      for (const x of r.files[k]?.rows || []) {
        const num = `${x['Journal Number Prefix']}${x['Journal Number Suffix']}`;
        assert.ok(/\d$/.test(num) && num.length <= 16 && x['Journal Number Suffix'], `${k}: journal number "${num}"`);
        const doc = `${k}|${x['Reference Number']}`;
        if (!seen.has(num)) seen.set(num, doc);
        assert.equal(seen.get(num), doc, `journal number ${num} is carried by two documents`);
      }
    }
    const docs = r.vouchers.filter(v => v.fileKey === 'journals' || v.fileKey === 'other_journals').map(v => v.documentNumber);
    assert.equal(new Set(docs).size, docs.length, 'one journal number per written voucher');
    assert.ok(r.assumptions.assumptions.some(a => a.kind === 'journal_number_generated' && a.count >= 4));
    assert.deepEqual(refusedFindings(r).map(f => `${f.File} | ${f.Record} | ${f.Rule}`), [], 'the Zoho check expects no row to be refused');
  });

  test('X1 E5/E6: odd item lists are read and flagged; void is left out; on hold is written and flagged; Zoho\'s trial balance equals Tally\'s', async () => {
    const r = await xready();
    assert.equal(r.exceptions.filter(e => e.kind === 'voucher_list_shape').length, 2);
    const m = byNumber(r);
    assert.equal(m.get('J/VOID')[0].reason, 'Void in Tally (not posted)');
    assert.ok(r.exceptions.some(e => e.kind === 'voucher_status_unverified' && String(e.name).endsWith('J/HOLD') && /isonhold/.test(e.message)));
    const c = r.predicted.comparison;
    assert.deepEqual([...c.accounts.differing, ...c.accounts.onlyTally, ...c.accounts.onlyZoho].map(a => a.account), []);
    for (const side of ['customers', 'vendors']) assert.deepEqual(c.contacts[side].rows.filter(y => y.difference && cents(y.difference.amount) !== 0).map(y => y.contact), []);
    assert.deepEqual(r.exceptions.filter(e => e.kind === 'trial_balance_movement_differs').map(e => e.name), [], 'Payroll and the custom type are in the movement check');
  });

  // TALLY-008: the invariant must FAIL when it is broken, and must not depend on the wording of a message
  test('X1 negative: the reconciliation fails when a written row is removed, an outcome is forced to not handled, or a copy is written too; the control total does not read message wording', async () => {
    const r = await xready();
    const base = `/api/migrations/${r.id}`;
    const db = new DatabaseSync(databasePath());
    try {
      // a left-out message reworded: the control total is counted from the outcomes, so it does not move
      db.prepare("UPDATE exceptions SET message = 'Reworded: ' || message WHERE job_id = ? AND stage = 'generate' AND kind LIKE 'left_out_%'").run(r.id);
      const vc = body(await request({ url: `${base}/voucher-control` })).control;
      assert.deepEqual([vc.leftOut, vc.balanced], [r.control.leftOut, true]);
      // one row of a written journal removed: the file no longer holds what was recorded
      const row = db.prepare("SELECT rowid FROM generated_rows WHERE job_id = ? AND key = 'journals' AND source_record_id IS NOT NULL LIMIT 1").get(r.id);
      db.prepare('DELETE FROM generated_rows WHERE rowid = ?').run(row.rowid);
      let rec = body(await request({ url: `${base}/voucher-reconciliation` }));
      assert.equal(rec.allChecksPass, false);
      assert.equal(rec.checks.find(x => x.key === 'file_journals').ok, false);
      // an outcome forced to "not handled": the reconciliation does not add up
      db.prepare("UPDATE voucher_recon SET outcome = 'not_handled', data = json_set(data, '$.outcome', 'not_handled') WHERE job_id = ? AND source_record_id = (SELECT source_record_id FROM voucher_recon WHERE job_id = ? AND outcome = 'written' LIMIT 1)").run(r.id, r.id);
      rec = body(await request({ url: `${base}/voucher-reconciliation` }));
      assert.equal(rec.allChecksPass, false);
      assert.ok(rec.notInAnyFile.notHandled >= 1);
      // the copy of E1 written as well: the checks by Tally identifier fail
      const dup = db.prepare("SELECT s.id, s.source_id FROM voucher_recon v JOIN source_records s ON s.id = v.source_record_id WHERE v.job_id = ? AND json_extract(v.data, '$.reason') = 'duplicate'").get(r.id);
      const first = db.prepare('SELECT key, row_no, row_key, row_data, ident FROM generated_rows WHERE job_id = ? AND source_id = ? AND source_record_id <> ? LIMIT 1').get(r.id, dup.source_id, dup.id);
      db.prepare('INSERT INTO generated_rows (job_id, key, row_no, row_key, source_record_id, source_id, row_data, ident) VALUES (?,?,?,?,?,?,?,?)').run(r.id, first.key, first.row_no + 1000, first.row_key, dup.id, dup.source_id, first.row_data, `${first.ident}-copy`);
      rec = body(await request({ url: `${base}/voucher-reconciliation` }));
      assert.equal(rec.checks.find(x => x.key === 'one_document_per_tally_voucher').ok, false);
      assert.equal(rec.checks.find(x => x.key === 'no_voucher_twice').ok, false);
    } finally { db.close(); }
    // creating the files again puts everything right
    assert.equal((await request({ method: 'POST', url: `${base}/generate` })).statusCode, 200);
    assert.equal(body(await request({ url: `${base}/voucher-reconciliation` })).allChecksPass, true);
  });

  // TALLY-005: a file that is not UTF-8 or UTF-16 is refused at upload with where and why; never read with U+FFFD
  test('a masters file saved as Windows-1252 (not UTF-8) is refused at upload, and the same file in UTF-8 is accepted', async () => {
    await xready();
    const created = await request({ method: 'POST', url: '/api/migrations', payload: { company: 'Encoding Check Traders', financialYear: '2025-26' } });
    const base = `/api/migrations/${created.json().id}`;
    const text = JSON.stringify({ tallymessage: [{ metadata: { type: 'Ledger', name: 'Café Supplies' }, parent: 'Sundry Creditors' }] });
    const put = payload => request({ method: 'PUT', url: `${base}/uploads/all_masters`, headers: { 'content-type': 'application/octet-stream', 'x-filename': 'Master.json' }, payload });
    const bad = await put(Buffer.from(text, 'latin1'));
    assert.ok(bad.statusCode >= 400 && bad.statusCode < 500, `${bad.statusCode} ${bad.body}`);
    assert.match(String(body(bad).error || bad.body), /not in UTF-8 or UTF-16.*Export it again from Tally/);
    const good = await put(Buffer.from(text, 'utf8'));
    assert.equal(good.statusCode, 200, good.body);
  });
}
