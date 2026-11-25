// The completeness table: "this was in Tally, this is what goes into Zoho, the difference should be zero".
// One row per dataset: Chart of Accounts, Customers, Vendors, Items and each voucher type. For each: the count in the
// Tally files, the count in the Zoho files, the difference; the amount in Tally, the amount in the Zoho files, the
// difference; and a status: "Matches", the reasons that explain the difference (with counts), or "Not matched".
//
// Nothing is worked out a second way here:
//  - voucher rows come from the voucher reconciliation (voucherrecon.js buildReconciliation): where every voucher
//    went and what the files post for it;
//  - master rows count the stored Tally records and the rows of the files created last (generated_files,
//    generated_rows); the reasons come from the same functions the file builder uses (accountRecords for the Chart of
//    Accounts, mergedAway for contacts treated as one) and from the flagged items written with the files.
// Amounts use decimal.js, in Tally's sign (a debit is negative). Masters show the net opening balance.

import Decimal from 'decimal.js';
import { buildReconciliation, LEFT_OUT_REASONS, safeText } from './voucherrecon.js';
import { SAMPLE_NEEDED } from './payments.js';
import { VOUCHER_FILES, voucherLines } from './vouchers.js';
import { TEMPLATES, toCsv } from './zoho.js';
import { makeContext, fileLayout } from './extras.js';
import { mergedAway } from './decisions.js';
import { openingWithMerged } from './namefix.js';
import { money } from './tally.js';

const ZERO = new Decimal(0);
const OPENING_JOURNAL = 'opening_balances_for_zoho_accounts';
// The eight voucher types always listed (also with nothing in them); any other voucher dataset only when it has vouchers.
const ALWAYS = ['sales', 'purchase', 'payment', 'receipt', 'journal', 'contra', 'debit_note', 'credit_note'];
const SHORT_NAME = { sales: 'Sales', purchase: 'Purchase', payment: 'Payment', receipt: 'Receipt', journal: 'Journal', contra: 'Contra', debit_note: 'Debit Note', credit_note: 'Credit Note', other_vouchers: 'Other voucher types' };
const LEFT_OUT_SHORT = { outside_year: 'Outside the financial year', invalid_date: 'Date not a real day', cancelled: 'Cancelled in Tally', optional: 'Optional in Tally (not posted)', deleted: 'Deleted in Tally', void: 'Void in Tally (not posted)', duplicate: 'A second copy of a voucher' };
// left-out reasons that are a gap in the files (TALLY-003): shown as not explained
const NOT_EXPLAINED_LEFT_OUT = ['no_single_party', 'party_side', 'no_lines', 'party_amount_unreadable', 'other'];
const DIFFERENCE_SHORT = {
  reverse_charge: 'Reverse-charge GST is not written on bills',
  tax_not_written: 'Tax that could not be put on a row',
  zoho_recomputes: 'Zoho works the tax out itself (rounding or a larger difference)',
  tax_amount_differs: 'Tax worked out from the rates differs from Tally',
  item_rate: 'Quantity times rate differs from the line amount',
  corrected_by_accountant: 'Amount corrected by the accountant',
  rounding: 'Rounding',
};

// signed: Tally's sign (a debit is negative); amount and side for showing ("1,200.00 Dr").
const fig = d => (d == null ? null : { signed: d.toFixed(2), amount: d.abs().toFixed(2), side: d.isZero() ? '' : d.isNegative() ? 'Dr' : 'Cr' });
const plain = d => (d == null ? null : { signed: d.toFixed(2), amount: d.toFixed(2), side: '' });
const dec = v => { const s = String(v ?? '').replace(/,/g, '').trim(); if (!s) return ZERO; try { return new Decimal(s); } catch { return null; } };
const sum = list => list.reduce((t, x) => t.plus(x || 0), ZERO);

// Works out the differences, says plainly whatever the reasons do not cover, and sets the status.
// A reason: { kind, label, count, amountValue (Decimal, Tally's sign), explained, countsTowards }.
//  - countsTowards false: the records are in the file (or counted by another reason); only the amount differs.
//  - explained false: a real gap; the row is "Not matched".
function finish(row, format = fig) {
  const tallyAmount = row.tally.amountValue ?? null, zohoAmount = row.zoho.amountValue ?? null;
  const compared = row.zoho.count != null;
  const countDiff = compared ? row.tally.count - row.zoho.count : null;
  const amountDiff = compared && tallyAmount != null && zohoAmount != null ? tallyAmount.minus(zohoAmount) : null;
  if (compared) {
    const covered = row.reasons.reduce((t, r) => t + (r.countsTowards === false ? 0 : r.count || 0), 0);
    if (countDiff !== covered) row.reasons.push({ kind: 'count_not_explained', label: 'Not explained', count: countDiff - covered, explained: false, countsTowards: false });
    if (amountDiff) {
      const left = amountDiff.minus(sum(row.reasons.map(r => r.amountValue)));
      if (!left.isZero()) row.reasons.push({ kind: 'amount_not_explained', label: 'Amount not explained', count: null, amountValue: left, explained: false, countsTowards: false });
    }
  }
  const status = !compared ? 'no_files'
    : row.reasons.some(r => r.explained === false) ? 'not_matched'
      : countDiff === 0 && (!amountDiff || amountDiff.isZero()) ? 'matches' : 'explained';
  return {
    key: row.key, name: row.name, group: row.group, amountKind: row.amountKind,
    tally: { count: row.tally.count, amount: format(tallyAmount) },
    zoho: { count: row.zoho.count, amount: compared ? format(zohoAmount) : null, files: row.zoho.files || [] },
    difference: { count: countDiff, amount: format(amountDiff) },
    status, statusWords: { matches: 'Matches', explained: 'Explained', not_matched: 'Not matched', no_files: 'Files not created yet' }[status],
    reasons: row.reasons.map(({ amountValue, countsTowards, ...r }) => ({ ...r, amount: amountValue ? format(amountValue) : null })),
    note: row.note || null, detail: row.detail,
  };
}

// ---------- masters ----------
function masterRows(db, job, deps, files, gctx) {
  const recsOf = t => db.prepare('SELECT id, source_id, name, data FROM source_records WHERE job_id = ? AND slot = ? AND object_type = ? ORDER BY id').all(job.id, t.slot, t.objectType);
  const ob = r => { try { return money(JSON.parse(r.data).openingbalance); } catch { return null; } };
  const genRows = key => db.prepare('SELECT row_no, source_record_id, source_id, row_data FROM generated_rows WHERE job_id = ? AND key = ? ORDER BY row_no').all(job.id, key);
  const flagged = (slot, kinds) => db.prepare(`SELECT source_id FROM exceptions WHERE job_id = ? AND stage = 'generate' AND slot = ? AND kind IN (${kinds.map(() => '?').join(',')})`).all(job.id, slot, ...kinds).map(r => r.source_id);
  // The Opening Balance cells of a file, in Tally's sign. side(values) -> 'Debit' | 'Credit' | '' for one row.
  // null when the layout of the file has no such column any more (a firm can change the layout).
  const fileBalance = (key, side) => {
    const layout = fileLayout(db, job.id, key);
    if (!layout.columns.some(c => c.id === 'opening_balance')) return null;
    let total = ZERO;
    for (const g of genRows(key)) {
      const v = layout.values(g);
      let a = dec(v.opening_balance);
      if (a == null) return null;
      // a contact kept in another currency: the foreign amount at its Opening Balance Exchange Rate, as Zoho converts it
      const code = String(v.currency_code ?? '').trim().toUpperCase();
      if (code && code !== 'INR' && !a.isZero()) { const xr = dec(v.opening_balance_exchange_rate); if (xr == null || xr.isZero()) return null; a = a.times(xr).toDecimalPlaces(2, Decimal.ROUND_HALF_UP); }
      const s = side(v);
      total = total.plus(s === 'Debit' ? a.negated() : s === 'Credit' ? a : ZERO);
    }
    return total;
  };
  // made: files were created. A dataset with no records gets no file: that is 0 rows, not "no files yet".
  const made = Object.keys(files).length > 0;
  const rowsOf = key => (files[key] ? files[key].rows : made ? 0 : null);
  const rows = [];

  // Chart of Accounts: the ledgers that are not customers or vendors (those are their own rows)
  {
    const t = TEMPLATES.accounts;
    const all = recsOf(t);
    const a = deps.accountRecords(job.id, deps.chartRecords(job.id), gctx);
    const strays = a.notInContacts.map(x => x.rec);
    const side = [...a.recs, ...a.merged, ...a.toZoho, ...a.profitAndLoss, ...strays];
    const inContacts = all.length - side.length; // customer and vendor ledgers, counted in the Customers and Vendors rows
    const row = { key: 'accounts', name: 'Chart of Accounts', group: 'masters', amountKind: 'opening_balance', detail: { screen: 'screen-24' }, reasons: [],
      tally: { count: side.length, amountValue: sum(side.map(ob)) }, zoho: { count: rowsOf('accounts'), files: ['accounts'] },
      note: inContacts > 0 ? `${inContacts} customer and vendor ledgers are in their own rows.` : null };
    if (made) {
      let amount = fileBalance('accounts', v => String(v.debit_or_credit ?? '').trim());
      // the opening balance journal carries every balance that is not written in the Chart of Accounts (all but a Stock
      // account and the date anchor); the lines on Opening Balance Adjustments name no ledger, and the lines of journal
      // OB-2 (with a Contact Name) belong to the Customers and Vendors rows below
      if (amount != null && files[OPENING_JOURNAL]) {
        const layout = fileLayout(db, job.id, OPENING_JOURNAL);
        let journal = ZERO;
        for (const g of genRows(OPENING_JOURNAL)) {
          if (g.source_record_id == null) continue;
          const v = layout.values(g);
          if (String(v.contact_name ?? '').trim() !== '') continue;
          const d = dec(v.debit), c = dec(v.credit);
          if (d == null || c == null) { journal = null; break; }
          journal = journal.plus(c).minus(d);
        }
        if (journal == null) amount = null;
        else { amount = amount.plus(journal); row.zoho.files.push(OPENING_JOURNAL); if (!journal.isZero()) row.note = [row.note, `Of the Zoho amount, ${fig(journal).amount} ${fig(journal).side} is in the opening balance journal.`].filter(Boolean).join(' '); }
      }
      row.zoho.amountValue = amount;
      if (amount == null) row.note = [row.note, 'The amount in the Zoho files cannot be read: the file has no readable Opening Balance column.'].filter(Boolean).join(' ');
      if (a.merged.length) row.reasons.push({ kind: 'merged', label: 'Merged duplicates', count: a.merged.length, explained: true });
      if (a.toZoho.length) row.reasons.push({ kind: 'zoho_account', label: 'Accounts Zoho already has', count: a.toZoho.length, explained: true });
      if (a.profitAndLoss.length) {
        const bal = sum(a.profitAndLoss.map(ob));
        row.reasons.push({ kind: 'profit_and_loss', label: bal.isZero() ? 'Tally\'s Profit & Loss A/c (Zoho uses Retained Earnings)' : 'Tally\'s Profit & Loss A/c: its balance is in the opening balance journal, on Retained Earnings', count: a.profitAndLoss.length, explained: true });
      }
      // the one balance a person types to save the Migration Date (only when no chart row can carry one): in no file
      if (a.anchor?.mode === 'typed') {
        const rec = a.recs.find(r => r.id === a.anchor.recId);
        const bal = rec ? (() => { try { return openingWithMerged(rec.name, JSON.parse(rec.data).openingbalance, gctx).total; } catch { return null; } })() : null;
        if (bal && !bal.isZero()) row.reasons.push({ kind: 'typed_for_migration_date', label: 'One balance typed in Zoho Books to save the Migration Date (Import Wizard)', count: 1, amountValue: bal, explained: true, countsTowards: false });
      }
      if (strays.length) row.reasons.push({ kind: 'party_not_in_contacts', label: 'Customer or vendor ledgers that are in no file', count: strays.length, amountValue: sum(strays.map(ob)), explained: false });
    }
    rows.push(finish(row));
  }

  // Customers and Vendors
  for (const [key, usual] of [['customers', 'Debit'], ['vendors', 'Credit']]) {
    const t = TEMPLATES[key];
    const recs = recsOf(t);
    const row = { key, name: t.module, group: 'masters', amountKind: 'opening_balance', detail: { screen: 'screen-24' }, reasons: [],
      tally: { count: recs.length, amountValue: sum(recs.map(ob)) }, zoho: { count: rowsOf(key), files: [key] } };
    if (made) {
      row.zoho.amountValue = fileBalance(key, v => (String(v.opening_balance ?? '').trim() ? usual : ''));
      if (row.zoho.amountValue == null) row.note = 'The amount in the Zoho files cannot be read: the file has no readable Opening Balance column.';
      // a customer in credit or a vendor in debit: the balance is a line of journal OB-2 in the opening balance journal
      // file (Accounts Receivable / Accounts Payable with the Contact Name), not in the Opening Balance column
      let credits = 0;
      if (row.zoho.amountValue != null && files[OPENING_JOURNAL]) {
        const layout = fileLayout(db, job.id, OPENING_JOURNAL);
        const account = key === 'customers' ? 'Accounts Receivable' : 'Accounts Payable';
        let journal = ZERO;
        for (const g of genRows(OPENING_JOURNAL)) {
          const v = layout.values(g);
          if (String(v.contact_name ?? '').trim() === '' || String(v.account ?? '').trim() !== account) continue;
          const d = dec(v.debit), c = dec(v.credit);
          if (d == null || c == null) { journal = null; break; }
          journal = journal.plus(c).minus(d); credits++;
        }
        if (journal == null) row.zoho.amountValue = null;
        else if (credits) { row.zoho.amountValue = row.zoho.amountValue.plus(journal); row.zoho.files.push(OPENING_JOURNAL); row.note = `Of the Zoho amount, ${fig(journal).amount} ${fig(journal).side} is in the opening balance journal (journal OB-2: ${credits} ${key === 'customers' ? 'customer' : 'vendor'}${credits === 1 ? '' : 's'} with an advance).`; }
      }
      const merged = recs.filter(r => mergedAway(gctx, r.name)).length;
      if (merged) row.reasons.push({ kind: 'merged', label: 'Merged duplicates', count: merged, explained: true });
      // a balance on the unusual side is carried by journal OB-2 (counted above); only a contact in another currency
      // is left out of it (flag balance_unusual_side_not_carried): the amount is the one the row would have carried
      if (credits) row.reasons.push({ kind: 'unusual_side_in_journal', label: key === 'customers' ? 'Customers in credit: balance carried by the opening balance journal (OB-2)' : 'Vendors in debit: balance carried by the opening balance journal (OB-2)', count: credits, explained: true, countsTowards: false });
      const ids = new Set(flagged(t.slot, ['balance_unusual_side_not_carried']));
      const unusual = recs.filter(r => ids.has(r.source_id));
      if (unusual.length) {
        const amount = sum(unusual.map(r => { try { return openingWithMerged(r.name, JSON.parse(r.data).openingbalance, gctx).total; } catch { return null; } }));
        row.reasons.push({ kind: 'unusual_side', label: key === 'customers' ? 'Customers in credit in another currency: balance in no file' : 'Vendors in debit in another currency: balance in no file', count: unusual.length, amountValue: amount, explained: false, countsTowards: false });
      }
      // a contact kept in another currency whose opening has no foreign amount (or two at different rates): in no file
      const fxIds = new Set(flagged(t.slot, ['foreign_opening_not_written']));
      const fxLeft = recs.filter(r => fxIds.has(r.source_id));
      if (fxLeft.length) {
        const amount = sum(fxLeft.map(r => { try { return openingWithMerged(r.name, JSON.parse(r.data).openingbalance, gctx).total; } catch { return null; } }));
        row.reasons.push({ kind: 'foreign_opening_not_written', label: key === 'customers' ? 'Customers in another currency whose opening balance has no foreign amount: balance in no file' : 'Vendors in another currency whose opening balance has no foreign amount: balance in no file', count: fxLeft.length, amountValue: amount, explained: false });
      }
      const unreadable = flagged(t.slot, ['opening_balance_unreadable']).length;
      if (unreadable) row.reasons.push({ kind: 'unreadable', label: 'Opening balance cannot be read', count: unreadable, explained: false, countsTowards: false });
    }
    rows.push(finish(row));
  }

  // Items: a count only (the files carry no opening stock)
  {
    const t = TEMPLATES.items;
    const n = db.prepare('SELECT COUNT(*) n FROM source_records WHERE job_id = ? AND slot = ? AND object_type = ?').get(job.id, t.slot, t.objectType).n;
    // v2 (vouchers.js default 15): service items the tool adds for invoice lines that are not stock items (no Tally record)
    const added = db.prepare("SELECT COUNT(*) n FROM generated_rows WHERE job_id = ? AND key = 'items' AND source_record_id IS NULL").get(job.id).n;
    rows.push(finish({ key: 'items', name: t.module, group: 'masters', amountKind: null, detail: { screen: 'screen-24' },
      reasons: added ? [{ kind: 'service_items', label: 'Service items added for invoice lines', count: -added, explained: true }] : [],
      tally: { count: n }, zoho: { count: rowsOf('items'), files: ['items'] } }));
  }
  return rows;
}

// ---------- vouchers ----------
function voucherRows(db, job, deps, rec) {
  const slots = [...ALWAYS, ...deps.slots.filter(s => !ALWAYS.includes(s))];
  const name = s => SHORT_NAME[s] || deps.slotName(s);
  const rows = [];
  if (!rec?.available) {
    // no files yet (or files from before the reconciliation existed): what is in Tally, nothing to compare with
    const stored = {};
    for (const r of db.prepare("SELECT slot, data FROM source_records WHERE job_id = ? AND object_type = 'Voucher'").all(job.id)) {
      const s = stored[r.slot] || (stored[r.slot] = { count: 0, debit: ZERO });
      s.count++;
      for (const l of voucherLines(JSON.parse(r.data))) if (l.amount?.isNegative()) s.debit = s.debit.plus(l.amount.abs());
    }
    for (const slot of slots) {
      const s = stored[slot];
      if (!s && !ALWAYS.includes(slot)) continue;
      rows.push(finish({ key: slot, name: name(slot), group: 'vouchers', amountKind: 'voucher_total', detail: { screen: 'screen-37' }, reasons: [],
        tally: { count: s?.count || 0, amountValue: s?.debit || ZERO }, zoho: { count: null } }, plain));
    }
    return rows;
  }
  const countRow = Object.fromEntries(rec.rows.map(r => [r.slot, r]));
  const amountRow = Object.fromEntries(rec.amounts.rows.map(r => [r.slot, r]));
  for (const slot of slots) {
    const r = countRow[slot], a = amountRow[slot];
    if (!r && !ALWAYS.includes(slot)) continue;
    const row = { key: slot, name: name(slot), group: 'vouchers', amountKind: 'voucher_total', detail: { screen: 'screen-37' }, reasons: [],
      tally: { count: r?.in || 0, amountValue: new Decimal(a?.in.debit || 0) }, zoho: { count: 0, amountValue: new Decimal(a?.written.debit || 0), files: [] } };
    if (r) {
      const d = r.destinations;
      for (const k of Object.keys(VOUCHER_FILES)) if (d[`written:${k}`]) { row.zoho.count += d[`written:${k}`]; row.zoho.files.push(k); }
      for (const k of Object.keys(SAMPLE_NEEDED)) if (d[`held:${k}`]) row.reasons.push({ kind: `held:${k}`, label: `Held: no Zoho sample for ${SAMPLE_NEEDED[k].module}`, count: d[`held:${k}`], explained: true });
      // TALLY-003: a voucher left out because the tool could not shape it (not exactly one party, the party on the other
      // side, no line, or no known reason) is a gap in the files, not an explanation; the others are reasons Tally gives
      // (cancelled, optional, deleted, void, a second copy, outside the year) or a fault to correct in Tally (flagged)
      for (const [reason, n] of Object.entries(r.leftOutReasons)) row.reasons.push({ kind: `left_out:${reason}`, label: LEFT_OUT_SHORT[reason] || `Left out: ${LEFT_OUT_REASONS[reason] || reason}`, count: n, explained: !NOT_EXPLAINED_LEFT_OUT.includes(reason) });
      if (d.awaiting_routing) row.reasons.push({ kind: 'awaiting_routing', label: 'Waiting for a routing decision', count: d.awaiting_routing, explained: true });
      // TALLY-002: only a voucher Tally does not post (its type, or no ledger amount) has no file; one that posts is written
      if (d.no_file) row.reasons.push({ kind: 'no_file', label: 'Not posted by Tally (no Zoho file needed)', count: d.no_file, explained: true });
      if (d.not_handled) row.reasons.push({ kind: 'not_handled', label: 'Not handled', count: d.not_handled, explained: false });
      if (r.problems) row.reasons.push({ kind: 'problem', label: 'Vouchers that do not add up', count: r.problems, explained: false, countsTowards: false });
      // amounts: what the vouchers above carry in Tally, and why a written voucher posts a different amount
      const notWritten = new Decimal(a.notWritten.debit);
      if (!notWritten.isZero()) {
        const first = row.reasons.find(x => x.explained !== false && x.countsTowards !== false);
        if (first && row.reasons.filter(x => x.countsTowards !== false).length === 1) first.amountValue = notWritten;
        else row.reasons.push({ kind: 'not_in_a_file', label: 'Amount of the vouchers not in a file', count: null, amountValue: notWritten, explained: true, countsTowards: false });
      }
      for (const x of a.differences) {
        row.reasons.push({ kind: `difference:${x.reason}`, label: x.reason === 'not_explained' ? 'Amount differs for no known reason' : DIFFERENCE_SHORT[x.reason] || x.label, count: x.vouchers,
          amountValue: new Decimal(x.debit), explained: x.reason !== 'not_explained', countsTowards: false });
      }
      // the credit side must agree as well; it is not shown, so a difference there alone is said
      const creditLeft = new Decimal(a.in.credit).minus(a.written.credit).minus(a.notWritten.credit).minus(sum(a.differences.map(x => new Decimal(x.credit))));
      if (!creditLeft.isZero()) row.reasons.push({ kind: 'credit_side', label: 'Credit side differs', count: null, amountValue: null, explained: false, countsTowards: false });
    }
    rows.push(finish(row, plain));
  }
  return rows;
}

// deps: { slots, slotName(slot), staleInfo(jobId), generatedKeys(jobId), voucherControl(jobId), accountRecords, chartRecords }.
// Returns { available: false, message } before the data is processed.
export function buildCompletenessTable(db, job, deps) {
  if (!['processed', 'generated'].includes(job.status)) {
    return { available: false, message: 'The table is shown once the Tally files have been read (processing).' };
  }
  const files = Object.fromEntries(db.prepare('SELECT key, rows, generated_at FROM generated_files WHERE job_id = ?').all(job.id).map(f => [f.key, f]));
  const gctx = makeContext(db, job.id);
  const rec = Object.keys(files).length ? buildReconciliation(db, job.id, deps) : null;
  const rows = [...masterRows(db, job, deps, files, gctx), ...voucherRows(db, job, deps, rec)];
  const stale = deps.staleInfo(job.id);
  const compared = rows.filter(r => r.status !== 'no_files');
  return {
    available: true,
    filesCreated: Object.keys(files).length > 0,
    createdAt: Object.values(files).map(f => f.generated_at).sort().pop() || null,
    outOfDate: stale.filesOutOfDate,
    rows,
    summary: { rows: rows.length, matches: compared.filter(r => r.status === 'matches').length, explained: compared.filter(r => r.status === 'explained').length,
      notMatched: compared.filter(r => r.status === 'not_matched').length, noFiles: rows.length - compared.length,
      allAccountedFor: compared.length === rows.length && compared.every(r => r.status !== 'not_matched') },
    notes: [
      'Count: masters are ledgers and stock items; vouchers are vouchers (one voucher can be several rows of a file).',
      'Amount: masters show the net opening balance; vouchers show the total of their debits.',
      ...(rec && !rec.available && rec.message ? [rec.message] : []),
    ],
  };
}

const figText = f => (f ? `${f.amount}${f.side ? ` ${f.side}` : ''}` : '');
export function completenessCsv(table) {
  const head = ['Dataset', 'Count in Tally', 'Count in Zoho files', 'Count difference', 'Amount in Tally', 'Amount in Zoho files', 'Amount difference', 'Status', 'Reasons'];
  const rows = table.rows.map(r => ({
    Dataset: safeText(r.name), 'Count in Tally': r.tally.count, 'Count in Zoho files': r.zoho.count ?? '', 'Count difference': r.difference.count ?? '',
    'Amount in Tally': figText(r.tally.amount), 'Amount in Zoho files': figText(r.zoho.amount), 'Amount difference': figText(r.difference.amount),
    Status: r.statusWords, Reasons: safeText(r.reasons.map(x => `${x.label}${x.count != null ? `: ${x.count}` : ''}${x.amount ? ` (${figText(x.amount)})` : ''}`).join('; ')),
  }));
  return '﻿' + toCsv(head, rows);
}

// GET /api/migrations/:id/completeness-table and .../completeness-table.csv. Read only: viewers can read both.
export function registerCompletenessTable(app, deps) {
  const { need, db, audit } = deps;
  app.get('/api/migrations/:id/completeness-table', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    return buildCompletenessTable(db, job, deps);
  });
  app.get('/api/migrations/:id/completeness-table.csv', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const table = buildCompletenessTable(db, job, deps);
    if (!table.available) return reply.code(409).send({ error: table.message });
    audit(job.id, 'download', `completeness table${table.outOfDate ? ' (files out of date)' : ''}`);
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="completeness_${job.id}.csv"`).send(completenessCsv(table));
  });
}
