// Voucher reconciliation: whatever came out of Tally in JSON must be in the Zoho files, or be accounted for.
//
// When the files are created, buildVoucherOutput (vouchers.js) records for every voucher where it went (written to a
// file and under which document number, held for a Zoho module with no import sample, waiting for a routing decision,
// left out with a reason) and, for a written voucher, how each of its Tally lines is represented in the file and what
// the document posts once it is in Zoho Books. Vouchers of a type with no Zoho file are recorded as such. That record
// is stored (voucher_recon) with the files and removed with them.
//
// The reconciliation is worked out on every request from the vouchers stored NOW (counts, lines and amounts in) and
// the record of the files created last (where they went). So it always reflects the current files: when the data is
// processed again the files and the record are removed together, and when something the files are built from changes,
// the files are out of date and so is this reconciliation (it says so). It is checked against the files themselves
// (generated_rows, held_vouchers) and against the voucher control total of the Export Center (voucherControl), so the
// same numbers are never worked out two different ways without being compared.
//
// Amounts use decimal.js. Tally's sign: a debit is negative.

import Decimal from 'decimal.js';
import { voucherLines, VOUCHER_FILES, TAX_TOLERANCE } from './vouchers.js';
import { SAMPLE_NEEDED } from './payments.js';
import { isoDate, entryVchType } from './tally.js';
import { toCsv } from './zoho.js';

const ZERO = new Decimal(0);
const FILE_KEYS = Object.keys(VOUCHER_FILES); // invoices, bills, journals, other_journals
const HELD_KEYS = Object.keys(SAMPLE_NEEDED); // payments_received, payments_made, vendor_credits, credit_notes

// Where a voucher can go. key is also the drill-down's bucket.
export const DESTINATIONS = [
  ...FILE_KEYS.map(k => ({ key: `written:${k}`, outcome: 'written', file: k, label: `Written to ${VOUCHER_FILES[k].module}` })),
  ...HELD_KEYS.map(k => ({ key: `held:${k}`, outcome: 'held', file: k, label: `Held: waiting for the Zoho ${SAMPLE_NEEDED[k].module} sample` })),
  { key: 'awaiting_routing', outcome: 'awaiting_routing', file: null, label: 'Waiting for a routing decision' },
  { key: 'left_out', outcome: 'left_out', file: null, label: 'Left out with a reason' },
  { key: 'no_file', outcome: 'no_file', file: null, label: 'Kept: no Zoho file for this voucher type' },
  { key: 'not_handled', outcome: 'not_handled', file: null, label: 'Not handled by the file builder' },
];
const destKey = e => (e.outcome === 'written' || e.outcome === 'held' ? `${e.outcome}:${e.file}` : e.outcome);
const destLabel = Object.fromEntries(DESTINATIONS.map(d => [d.key, d.label]));

export const LEFT_OUT_REASONS = {
  cancelled: 'Cancelled in Tally',
  optional: 'Optional in Tally (not posted)',
  deleted: 'Deleted in Tally',
  void: 'Void in Tally (not posted)',
  // TALLY-001: a second copy of a voucher already stored (the same Tally identifier): written once, from the first copy
  duplicate: 'A second copy of a voucher (same Tally identifier)',
  not_balanced: 'Debits and credits differ',
  // an amount Tally wrote in a form the tool cannot read (tally.js parseTallyAmount): never counted as zero
  unreadable_amount: 'An amount cannot be read',
  party_side: 'Customer credited or vendor debited (a reversal)',
  no_single_party: 'Not exactly one customer or vendor',
  party_amount_unreadable: 'Amount of the party line cannot be read',
  no_lines: 'No line besides the party and its tax',
  // v2 (M6): the default; "vouchers outside the financial year: include" in the voucher file settings writes them
  outside_year: 'Dated outside the financial year (left out by default)',
  // a date that is not a real calendar day or cannot be read: never guessed, never written
  invalid_date: 'Date is not a real calendar day (left out)',
  other: 'Other reason (see the flagged item)',
};

// How one Tally ledger line is represented. The whole-voucher outcomes apply to every line of such a voucher.
export const LINE_ROLES = {
  row: 'An item or account row',
  negative_row: 'A row with a negative amount',
  party: 'The party (document header and total)',
  tax_column: 'The tax columns of a row',
  tds_column: 'The TDS columns of the bill or invoice',
  tcs_column: 'The TCS columns of the bill or invoice',
  adjustment_column: 'The Adjustment column (round-off, or an invoice line that is not income)',
  reverse_charge_column: 'The Reverse Charge columns of a row (GST under reverse charge)',
  tax_not_written: 'Tax not put on a row',
  reverse_charge_not_written: 'Reverse-charge GST, not written',
  not_written_zero: 'Zero or unreadable amount, not written',
  held: 'Held with its voucher (no Zoho sample)',
  awaiting_routing: 'Waiting with its voucher (routing)',
  left_out: 'Left out with its voucher',
  no_file: 'Kept with its voucher (no Zoho file)',
  not_handled: 'Not handled',
};
const WHOLE_VOUCHER_ROLE = { held: 'held', awaiting_routing: 'awaiting_routing', left_out: 'left_out', no_file: 'no_file', not_handled: 'not_handled' };

// Why the amounts a written voucher posts in Zoho Books differ from Tally's, in the order they are looked for.
export const DIFFERENCE_REASONS = {
  reverse_charge: 'Reverse-charge GST on a bill is not written (it is debited and credited by the same amount in Tally); the bill is flagged for an accountant',
  tax_not_written: 'Tax could not be put on a row (not attributable to one line, rate unknown, not mapped, or mapped to different Zoho taxes), so it is missing from the document',
  zoho_recomputes: "Zoho Books works the tax out from the rate (each part of the tax rounded on its own) and ignores Tally's tax amounts; the difference is written in the Adjustment column or flagged on the voucher",
  tax_amount_differs: 'The tax worked out from Tally\'s rates differs from the tax ledgers by more than rounding',
  item_rate: 'Quantity times rate of a stock item does not give Tally\'s line amount',
  corrected_by_accountant: 'The exported debits and credits differ; one line is written with the amount the accountant entered (Voucher Classification, correct the amount)',
  rounding: 'Rounding: Zoho works out the tax of each invoice row from its rate, and amounts are written with 2 decimals',
  not_explained: 'Not explained: look at this voucher',
};
// The flagged items written when the files were created that explain a difference (shown with the voucher).
const EXPLAINING_FLAGS = ['zoho_recompute_adjusted', 'zoho_recompute_differs', 'tds_amount_differs', 'rcm_tax_type_changed', 'document_total_differs', 'reverse_charge_bill', 'tax_not_attributable', 'tax_rate_unknown', 'line_tax_names_differ', 'tax_amount_differs', 'item_line_rate_differs'];

export function setupVoucherRecon(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS voucher_recon (
    job_id TEXT NOT NULL, source_record_id INTEGER NOT NULL, slot TEXT, outcome TEXT NOT NULL, file TEXT, data TEXT, created_at TEXT);
    CREATE INDEX IF NOT EXISTS idx_voucher_recon ON voucher_recon (job_id);
    CREATE INDEX IF NOT EXISTS idx_generated_rows_source ON generated_rows (job_id, source_record_id);
    CREATE INDEX IF NOT EXISTS idx_exceptions_source ON exceptions (job_id, stage, source_id);
    CREATE INDEX IF NOT EXISTS idx_held_vouchers ON held_vouchers (job_id, source_record_id);
    CREATE INDEX IF NOT EXISTS idx_generated_rows_key ON generated_rows (job_id, key);`);
}

// What a written voucher's difference from Tally can be accounted for by: the Tally amounts of the lines that were not
// written (reverse-charge GST: debited and credited in Tally, both left out; other tax not put on a row: the tax line and
// the same amount on the party total), and the rounding allowed. Rounding: invoices and bills with at least one tax
// column (Zoho works the tax of a row out from its rate) get one rupee per tax line written; any other document only the
// rounding of its amounts to 2 decimals (half a paisa per line).
const HALF_PAISA = new Decimal('0.005');
export function explainDifference(difference, roles, amounts, file, flags) {
  const of = role => amounts.filter((_, i) => roles[i] === role);
  const rc = dc(of('reverse_charge_not_written'));
  const tnwNet = of('tax_not_written').reduce((t, x) => t.plus(x), ZERO).abs();
  const expected = { debit: rc.debit.plus(tnwNet), credit: rc.credit.plus(tnwNet) };
  const taxCols = roles.filter(x => x === 'tax_column' || x === 'reverse_charge_column').length;
  const tolerance = (file === 'invoices' || file === 'bills') && taxCols > 0 ? TAX_TOLERANCE.times(taxCols) : HALF_PAISA.times(Math.max(1, roles.length));
  const within = (d, e) => d.minus(e).abs().lessThanOrEqualTo(tolerance);
  const fits = within(difference.debit, expected.debit) && within(difference.credit, expected.credit);
  if (roles.includes('reverse_charge_not_written') || roles.includes('tax_not_written')) {
    if (fits) return roles.includes('reverse_charge_not_written') ? 'reverse_charge' : 'tax_not_written';
    return 'not_explained';
  }
  if (flags.includes('voucher_amount_corrected')) return 'corrected_by_accountant';
  // the flags below name the size of the difference in their message (shown with the voucher); the amount is not stored
  if (flags.includes('zoho_recompute_differs') || flags.includes('zoho_recompute_adjusted')) return 'zoho_recomputes';
  if (flags.includes('tax_amount_differs')) return 'tax_amount_differs';
  if (flags.includes('item_line_rate_differs')) return 'item_rate';
  return fits ? 'rounding' : 'not_explained';
}

// Called when the files are created, inside the same transaction. entries: buildVoucherOutput's recon, plus one entry
// { id, slot, outcome: 'no_file' } per voucher of a type with no Zoho file.
export function saveRecon(db, jobId, entries, at) {
  db.prepare('DELETE FROM voucher_recon WHERE job_id = ?').run(jobId);
  const ins = db.prepare('INSERT INTO voucher_recon (job_id, source_record_id, slot, outcome, file, data, created_at) VALUES (?,?,?,?,?,?,?)');
  for (const e of entries) {
    ins.run(jobId, e.id, e.slot, e.outcome, e.file ?? null, JSON.stringify({ number: e.number ?? null, reason: e.reason ?? null, roles: e.roles ?? null, posting: e.posting ?? null, flags: e.flags ?? [] }), at);
  }
}

const dc = list => ({ debit: list.filter(x => x.isNegative()).reduce((t, x) => t.plus(x), ZERO).abs(), credit: list.filter(x => x.greaterThan(0)).reduce((t, x) => t.plus(x), ZERO) });
const fmt = p => (p ? { debit: p.debit.toFixed(2), credit: p.credit.toFixed(2) } : null);
const addTo = (a, b) => ({ debit: a.debit.plus(b.debit), credit: a.credit.plus(b.credit) });
const NIL = () => ({ debit: ZERO, credit: ZERO });

// One fact per stored voucher (and per entry that names no stored voucher): what came in, where it went, and how.
function voucherFacts(db, jobId) {
  const entries = db.prepare('SELECT source_record_id id, slot, outcome, file, data FROM voucher_recon WHERE job_id = ? ORDER BY rowid').all(jobId)
    .map(r => ({ ...r, ...JSON.parse(r.data) }));
  const byId = new Map();
  for (const e of entries) { if (!byId.has(e.id)) byId.set(e.id, []); byId.get(e.id).push(e); }
  const facts = [];
  for (const r of db.prepare("SELECT id, slot, source_id, data FROM source_records WHERE job_id = ? AND object_type = 'Voucher' ORDER BY id").all(jobId)) {
    const v = JSON.parse(r.data);
    const lines = voucherLines(v);
    // a line whose amount cannot be read is counted as unreadable (never as zero in "Tally in" without saying so)
    const unreadable = lines.filter(l => l.amount == null).length;
    const amounts = lines.map(l => l.amount || ZERO);
    const tally = dc(amounts);
    const found = byId.get(r.id) || [];
    byId.delete(r.id);
    const e = found[0] || null;
    let roles, problem = null;
    if (!e) { roles = lines.map(() => 'missing'); problem = 'No record of where this voucher went: it was stored after the files were created.'; }
    else if (e.outcome === 'written') {
      roles = Array.isArray(e.roles) ? e.roles : [];
      if (roles.length !== lines.length) { problem = `The voucher has ${lines.length} lines now, but ${roles.length} were recorded when the files were created.`; roles = lines.map(() => 'missing'); }
    } else roles = lines.map(() => WHOLE_VOUCHER_ROLE[e.outcome] || 'not_handled');
    if (found.length > 1) problem = `Recorded ${found.length} times, in: ${found.map(x => destLabel[destKey(x)] || x.outcome).join(', ')}.`;
    if (e?.outcome === 'written' && !e.posting) problem = 'Recorded as written to a file, but what it posts was not recorded.';
    const written = e?.outcome === 'written' && e.posting ? { debit: new Decimal(e.posting.debit), credit: new Decimal(e.posting.credit) } : null;
    const difference = written ? { debit: tally.debit.minus(written.debit), credit: tally.credit.minus(written.credit) } : null;
    let differenceReason = null;
    if (difference && !(difference.debit.isZero() && difference.credit.isZero())) {
      differenceReason = explainDifference(difference, roles, amounts, e.file, e.flags || []);
    }
    facts.push({ id: r.id, slot: r.slot, sourceId: r.source_id, number: String(v.vouchernumber ?? ''), date: isoDate(v.date) || '', type: entryVchType(v),
      lines: lines.length, amounts, roles, tally, entries: found, entry: e, written, difference, differenceReason, problem, unreadable });
  }
  // entries that name no stored voucher (the data changed after the files were created)
  for (const [id, list] of byId) {
    facts.push({ id, slot: list[0].slot, sourceId: null, number: list[0].number ?? '', date: '', type: '', lines: 0, amounts: [], roles: [], tally: NIL(), entries: list, entry: list[0],
      written: null, difference: null, differenceReason: null, orphan: true, problem: 'Recorded when the files were created, but the voucher is no longer stored.' });
  }
  return facts;
}

// The reconciliation of the files created last. ctx: { slots: [slot], slotName(slot), staleInfo(jobId), generatedKeys(jobId),
// voucherControl(jobId) }. Returns { available: false, why, message } when there is nothing to reconcile.
// Whether there is a reconciliation, and whether it is out of date, without working it out (cheap: used by the drill-down).
export function reconStatus(db, jobId, ctx) {
  const keys = ctx.generatedKeys(jobId);
  if (!keys.length) return { available: false, why: 'no_files', message: 'No files have been created yet. Create the files in the Export Center first.' };
  let createdAt = db.prepare('SELECT MAX(created_at) at FROM voucher_recon WHERE job_id = ?').get(jobId).at;
  if (!createdAt) {
    // no record: either there were no vouchers when the files were created (nothing to reconcile, zero totals), or the
    // files were created before this check existed
    const vouchers = db.prepare("SELECT COUNT(*) n FROM source_records WHERE job_id = ? AND object_type = 'Voucher'").get(jobId).n;
    if (vouchers) return { available: false, why: 'created_before', message: 'The files were created before this check existed. Create the files again to see where every voucher went.' };
    createdAt = db.prepare('SELECT MAX(generated_at) at FROM generated_files WHERE job_id = ?').get(jobId).at;
  }
  const stale = ctx.staleInfo(jobId);
  const outOfDateFiles = stale.outOfDateFiles.filter(k => FILE_KEYS.includes(k));
  const outOfDateReasons = [...new Set(stale.outOfDateReasons.filter(r => r.files.some(k => FILE_KEYS.includes(k))).map(r => r.reason))];
  return { available: true, createdAt, outOfDate: outOfDateFiles.length > 0, outOfDateFiles, outOfDateReasons };
}

export function buildReconciliation(db, jobId, ctx, facts = null) {
  const status = reconStatus(db, jobId, ctx);
  if (!status.available) return status;
  const { createdAt } = status;
  facts = facts || voucherFacts(db, jobId);

  const rows = [];
  const grand = { in: 0, out: 0, destinations: {}, leftOutReasons: {}, linesIn: 0, linesOut: 0, roles: {} };
  const amountRows = [];
  const lineRows = [];
  const explanations = {};
  const gIn = NIL(), gWrittenTally = NIL(), gWritten = NIL(), gNotWritten = NIL();
  for (const slot of [...ctx.slots, ...new Set(facts.map(f => f.slot).filter(s => !ctx.slots.includes(s)))]) {
    const list = facts.filter(f => f.slot === slot);
    const inCount = list.filter(f => !f.orphan).length;
    if (!list.length) continue;
    const destinations = {}, leftOutReasons = {};
    let out = 0;
    for (const f of list) for (const e of f.entries) {
      out++;
      const k = destKey(e);
      destinations[k] = (destinations[k] || 0) + 1;
      if (e.outcome === 'left_out') leftOutReasons[e.reason || 'other'] = (leftOutReasons[e.reason || 'other'] || 0) + 1;
    }
    const problems = list.filter(f => f.problem).length;
    const unreadableLines = list.reduce((t, f) => t + (f.unreadable || 0), 0);
    rows.push({ slot, name: ctx.slotName(slot), in: inCount, destinations, leftOutReasons, out, problems, unreadableLines, matches: inCount === out && problems === 0 && unreadableLines === 0 });
    grand.in += inCount; grand.out += out;
    for (const [k, n] of Object.entries(destinations)) grand.destinations[k] = (grand.destinations[k] || 0) + n;
    for (const [k, n] of Object.entries(leftOutReasons)) grand.leftOutReasons[k] = (grand.leftOutReasons[k] || 0) + n;

    // lines: every Tally line in, and how it is represented; with Tally's amounts per representation
    const roles = {}, roleAmounts = {};
    let linesIn = 0, linesOut = 0;
    for (const f of list) {
      if (!f.orphan) linesIn += f.lines;
      f.roles.forEach((role, i) => {
        if (role !== 'missing') linesOut++;
        roles[role] = (roles[role] || 0) + 1;
        roleAmounts[role] = addTo(roleAmounts[role] || NIL(), dc([f.amounts[i] || ZERO]));
      });
    }
    lineRows.push({ slot, name: ctx.slotName(slot), linesIn, roles, roleAmounts: Object.fromEntries(Object.entries(roleAmounts).map(([k, p]) => [k, fmt(p)])), linesOut, matches: linesIn === linesOut && !roles.missing });
    grand.linesIn += linesIn; grand.linesOut += linesOut;
    for (const [k, n] of Object.entries(roles)) grand.roles[k] = (grand.roles[k] || 0) + n;

    // amounts: Tally's debits and credits in; those of the vouchers written and what the files post for them; the rest
    let aIn = NIL(), writtenTally = NIL(), written = NIL(), notWritten = NIL();
    const reasons = {};
    for (const f of list) {
      if (f.orphan) continue;
      aIn = addTo(aIn, f.tally);
      if (f.written) {
        writtenTally = addTo(writtenTally, f.tally); written = addTo(written, f.written);
        if (f.differenceReason) {
          const r = reasons[f.differenceReason] || (reasons[f.differenceReason] = { vouchers: 0, ...NIL() });
          r.vouchers++; r.debit = r.debit.plus(f.difference.debit); r.credit = r.credit.plus(f.difference.credit);
        }
      } else notWritten = addTo(notWritten, f.tally);
    }
    const diff = { debit: writtenTally.debit.minus(written.debit), credit: writtenTally.credit.minus(written.credit) };
    amountRows.push({ slot, name: ctx.slotName(slot), in: fmt(aIn), notWritten: fmt(notWritten), writtenTally: fmt(writtenTally), written: fmt(written), difference: fmt(diff),
      inMatches: aIn.debit.equals(writtenTally.debit.plus(notWritten.debit)) && aIn.credit.equals(writtenTally.credit.plus(notWritten.credit)),
      differences: Object.entries(reasons).map(([reason, r]) => ({ reason, label: DIFFERENCE_REASONS[reason], vouchers: r.vouchers, debit: r.debit.toFixed(2), credit: r.credit.toFixed(2) })) });
    for (const [k, r] of Object.entries(reasons)) {
      const x = explanations[k] || (explanations[k] = { vouchers: 0, ...NIL() });
      x.vouchers += r.vouchers; x.debit = x.debit.plus(r.debit); x.credit = x.credit.plus(r.credit);
    }
    Object.assign(gIn, addTo(gIn, aIn)); Object.assign(gWrittenTally, addTo(gWrittenTally, writtenTally));
    Object.assign(gWritten, addTo(gWritten, written)); Object.assign(gNotWritten, addTo(gNotWritten, notWritten));
  }
  const gDiff = { debit: gWrittenTally.debit.minus(gWritten.debit), credit: gWrittenTally.credit.minus(gWritten.credit) };
  const amountTotal = { in: fmt(gIn), notWritten: fmt(gNotWritten), writtenTally: fmt(gWrittenTally), written: fmt(gWritten), difference: fmt(gDiff),
    differences: Object.entries(explanations).map(([reason, r]) => ({ reason, label: DIFFERENCE_REASONS[reason], vouchers: r.vouchers, debit: r.debit.toFixed(2), credit: r.credit.toFixed(2) })) };

  // ---------- checks against the files themselves and the voucher control total ----------
  const checks = [];
  const check = (key, ok, text) => checks.push({ key, ok: !!ok, text });
  check('rows_match', rows.every(r => r.matches) && grand.in === grand.out, `Every voucher type adds up: ${grand.in} vouchers in, ${grand.out} accounted for.`);
  // an amount Tally wrote in a form the tool cannot read is not in "Tally in" (it is not taken as zero): said here
  const unreadableLines = facts.reduce((t, f) => t + (f.unreadable || 0), 0), unreadableVouchers = facts.filter(f => f.unreadable).length;
  check('no_unreadable_amounts', unreadableLines === 0, unreadableLines === 0 ? 'Every amount of every voucher could be read.'
    : `${unreadableLines} voucher line(s) in ${unreadableVouchers} voucher(s) have an amount the tool cannot read. They are not counted in "Tally in" (never as zero), and the vouchers are left out of the files (see the flagged items "unreadable amount").`);
  // M2: a journal waiting for a routing decision is in NO file. With the v2 defaults none waits (a journal with no
  // decision is routed by default), so any here means the files were created by an earlier version: create them again.
  const waiting = grand.destinations.awaiting_routing || 0;
  check('none_awaiting_routing', waiting === 0, waiting === 0 ? 'No voucher is waiting for a routing decision: every journal is in a file (by a decision or by the default) or left out with a reason.'
    : `${waiting} journal voucher(s) are waiting for a routing decision and are in NO file. Create the files again: journals with no decision are then routed by default.`);
  const marks = FILE_KEYS.map(() => '?').join(',');
  const inTwo = db.prepare(`SELECT COUNT(*) n FROM (SELECT source_record_id FROM generated_rows WHERE job_id = ? AND key IN (${marks}) GROUP BY source_record_id HAVING COUNT(DISTINCT key) > 1)`).get(jobId, ...FILE_KEYS).n;
  // EXISTS on the (job_id, source_record_id) index of generated_rows: a join of two scans took seconds at 20 times the data
  const heldAndWritten = db.prepare(`SELECT COUNT(DISTINCT h.source_record_id) n FROM held_vouchers h
    WHERE h.job_id = ? AND EXISTS (SELECT 1 FROM generated_rows g WHERE g.job_id = h.job_id AND g.source_record_id = h.source_record_id AND g.key IN (${marks}))`).get(jobId, ...FILE_KEYS).n;
  const twice = facts.filter(f => f.entries.length > 1).length;
  // TALLY-001: counted by the Tally identifier (source_id), not by the stored record: two stored copies of one Tally
  // voucher that both reach a file (or one in a file and one held) are one voucher written twice. And one stored voucher
  // whose rows carry two document numbers is two documents.
  const tallyTwice = db.prepare(`SELECT COUNT(*) n FROM (SELECT sid FROM (
      SELECT source_id sid, source_record_id rid FROM generated_rows WHERE job_id = ? AND source_record_id IS NOT NULL AND source_id IS NOT NULL AND key IN (${marks})
      UNION SELECT s.source_id, h.source_record_id FROM held_vouchers h JOIN source_records s ON s.id = h.source_record_id WHERE h.job_id = ? AND s.source_id IS NOT NULL)
    GROUP BY sid HAVING COUNT(DISTINCT rid) > 1)`).get(jobId, ...FILE_KEYS, jobId).n;
  const twoDocuments = db.prepare(`SELECT COUNT(*) n FROM (SELECT source_record_id FROM generated_rows WHERE job_id = ? AND source_record_id IS NOT NULL AND key IN (${marks})
    GROUP BY source_record_id HAVING COUNT(DISTINCT key || char(1) || COALESCE(ident, '')) > 1)`).get(jobId, ...FILE_KEYS).n;
  check('no_voucher_twice', inTwo === 0 && heldAndWritten === 0 && twice === 0 && tallyTwice === 0,
    inTwo + heldAndWritten + twice + tallyTwice === 0 ? 'No voucher is in two files, or both in a file and held.' : `${inTwo} voucher(s) are in two files, ${heldAndWritten} both in a file and held, ${twice} recorded twice, ${tallyTwice} Tally voucher(s) written from two stored copies.`);
  check('one_document_per_tally_voucher', tallyTwice === 0 && twoDocuments === 0, tallyTwice + twoDocuments === 0
    ? 'Every Tally voucher (by its Tally identifier) is at most one document in the files.'
    : `${tallyTwice} Tally voucher(s) reach the files from two stored copies, and ${twoDocuments} stored voucher(s) are split over two documents: Zoho Books would post them twice.`);
  const fileRows = Object.fromEntries(db.prepare(`SELECT key, rows FROM generated_files WHERE job_id = ? AND key IN (${marks})`).all(jobId, ...FILE_KEYS).map(r => [r.key, r.rows]));
  // rows the tool generates that come from no Tally voucher (the adjustment journals in the Manual Journals file): set
  // apart from the voucher counts below, and said on their own
  const generatedRows = Object.fromEntries(db.prepare(`SELECT key, COUNT(*) n, COUNT(DISTINCT ident) docs FROM generated_rows WHERE job_id = ? AND source_record_id IS NULL AND key IN (${marks}) GROUP BY key`).all(jobId, ...FILE_KEYS).map(r => [r.key, r]));
  for (const k of FILE_KEYS) {
    const inFile = db.prepare('SELECT COUNT(DISTINCT source_record_id) n FROM generated_rows WHERE job_id = ? AND key = ?').get(jobId, k).n;
    const recorded = grand.destinations[`written:${k}`] || 0;
    const rowRoles = facts.filter(f => f.entry?.outcome === 'written' && f.entry.file === k).reduce((t, f) => t + f.roles.filter(x => x === 'row' || x === 'negative_row').length, 0);
    if (!inFile && !recorded) continue;
    const gen = generatedRows[k] || { n: 0, docs: 0 };
    // TALLY-008: the rows stored for the file now, not only the row count written when it was created, so a row that is
    // missing is seen
    const rowsStored = db.prepare('SELECT COUNT(*) n FROM generated_rows WHERE job_id = ? AND key = ? AND source_record_id IS NOT NULL').get(jobId, k).n;
    check(`file_${k}`, inFile === recorded && ((fileRows[k] ?? 0) - gen.n) === rowRoles && rowsStored === rowRoles,
      `${VOUCHER_FILES[k].module}: ${inFile} vouchers in ${(fileRows[k] ?? 0) - gen.n} rows of the file; ${recorded} vouchers and ${rowRoles} row lines recorded.${gen.n ? ` The file also holds ${gen.docs} adjustment journal(s) in ${gen.n} rows generated by the tool (from no Tally voucher).` : ''}`);
    // Zoho groups the rows of a file by the document number: two vouchers under one number become one document
    // (bills: by Bill Number and vendor, because Zoho keeps bill numbers per vendor and two suppliers can use one number)
    const documents = k === 'bills'
      ? db.prepare("SELECT COUNT(DISTINCT ident || char(1) || COALESCE(json_extract(row_data, '$.vendor_name'), '')) n FROM generated_rows WHERE job_id = ? AND key = ?").get(jobId, k).n
      : db.prepare('SELECT COUNT(DISTINCT ident) n FROM generated_rows WHERE job_id = ? AND key = ? AND source_record_id IS NOT NULL').get(jobId, k).n;
    const idWords = k === 'bills' ? `${VOUCHER_FILES[k].idColumn} and vendor` : VOUCHER_FILES[k].idColumn;
    check(`documents_${k}`, documents === recorded,
      documents === recorded ? `${VOUCHER_FILES[k].module}: ${documents} separate documents (${idWords}) for ${recorded} vouchers written.`
        : `${VOUCHER_FILES[k].module}: ${documents} separate documents (${idWords}) for ${recorded} vouchers written. Zoho Books would read vouchers that share a number as one document (see the flagged items).`);
    // journals: the Debit and Credit cells of the file itself = what the vouchers written to it post
    if (k === 'journals' || k === 'other_journals') {
      const cells = { debit: ZERO, credit: ZERO };
      let readable = true;
      for (const r of db.prepare('SELECT row_data FROM generated_rows WHERE job_id = ? AND key = ? AND source_record_id IS NOT NULL').all(jobId, k)) {
        let v; try { v = JSON.parse(r.row_data || '{}'); } catch { v = {}; }
        if (!('debit' in v) || !('credit' in v)) { readable = false; break; }
        // a journal written in another currency (round 2): its cells are converted at the row's Exchange Rate, as Zoho does
        const code = String(v.currency ?? '').trim().toUpperCase();
        let xr = null;
        if (code && code !== 'INR') { try { xr = new Decimal(String(v.exchange_rate ?? '').trim()); } catch { readable = false; } }
        for (const side of ['debit', 'credit']) { const s = String(v[side] ?? '').trim(); if (s) { try { const x = new Decimal(s); cells[side] = cells[side].plus(xr ? x.times(xr).toDecimalPlaces(2, Decimal.ROUND_HALF_UP) : x); } catch { readable = false; } } }
      }
      if (!readable) continue;
      const posted = facts.filter(f => f.entry?.outcome === 'written' && f.entry.file === k && f.written).reduce((t, f) => addTo(t, f.written), NIL());
      check(`totals_${k}`, cells.debit.equals(posted.debit) && cells.credit.equals(posted.credit),
        `${VOUCHER_FILES[k].module} file: Debit ${cells.debit.toFixed(2)} and Credit ${cells.credit.toFixed(2)} in the file; ${posted.debit.toFixed(2)} and ${posted.credit.toFixed(2)} recorded for the vouchers written.`);
    }
  }
  for (const k of HELD_KEYS) {
    const heldN = db.prepare('SELECT COUNT(*) n FROM held_vouchers WHERE job_id = ? AND file_key = ?').get(jobId, k).n;
    const recorded = grand.destinations[`held:${k}`] || 0;
    if (!heldN && !recorded) continue;
    check(`held_${k}`, heldN === recorded, `${SAMPLE_NEEDED[k].module}: ${heldN} vouchers held in the Export Center list; ${recorded} recorded here.`);
  }
  const vc = ctx.voucherControl(jobId);
  if (vc) {
    const sum = o => Object.values(o || {}).reduce((t, n) => t + n, 0);
    const d = grand.destinations;
    const same = vc.stored === grand.in && FILE_KEYS.every(k => (vc.written[k] || 0) === (d[`written:${k}`] || 0)) && vc.leftOut === (d.left_out || 0)
      && vc.awaitingRouting === (d.awaiting_routing || 0) && sum(vc.waitingForZohoSample) === HELD_KEYS.reduce((t, k) => t + (d[`held:${k}`] || 0), 0)
      && sum(vc.keptWithoutZohoFile) === (d.no_file || 0);
    check('control_total', same && vc.balanced, same ? 'Agrees with the voucher control total of the Export Center.' : 'Does not agree with the voucher control total of the Export Center.');
  }
  const bundle = (() => { try { return db.prepare('SELECT vouchers, not_placed FROM transaction_bundles WHERE job_id = ?').get(jobId); } catch { return null; } })();
  if (bundle) {
    check('all_transactions_file', bundle.vouchers === grand.in, bundle.vouchers === grand.in
      ? `The All Transactions file holds ${bundle.vouchers} vouchers, all of them stored.`
      : `The All Transactions file holds ${bundle.vouchers} vouchers; ${grand.in} are stored (datasets replaced by a file uploaded on its own, or removed, explain a difference: see Completeness Check).`);
  }
  check('amounts_in', amountRows.every(r => r.inMatches), 'Tally\'s debits and credits in = those of the vouchers written + those of the vouchers not written.');
  check('amounts_explained', !explanations.not_explained, explanations.not_explained ? `${explanations.not_explained.vouchers} written voucher(s) post amounts that differ from Tally for no known reason.` : 'Every difference between Tally and the files is explained.');

  // ---------- held: which Zoho sample releases them ----------
  const held = HELD_KEYS.map(k => {
    const list = facts.filter(f => !f.orphan && f.entry?.outcome === 'held' && f.entry.file === k);
    if (!list.length) return null;
    const t = list.reduce((s, f) => addTo(s, f.tally), NIL());
    const after = SAMPLE_NEEDED[k].importAfter;
    return { key: k, module: SAMPLE_NEEDED[k].module, vouchers: list.length, debit: t.debit.toFixed(2), credit: t.credit.toFixed(2),
      sample: SAMPLE_NEEDED[k].sample, importAfter: after, importAfterModule: VOUCHER_FILES[after]?.module ?? after };
  }).filter(Boolean);

  return {
    available: true, createdAt, outOfDate: status.outOfDate, outOfDateFiles: status.outOfDateFiles, outOfDateReasons: status.outOfDateReasons,
    held,
    rows, total: { in: grand.in, out: grand.out, destinations: grand.destinations, leftOutReasons: grand.leftOutReasons, matches: rows.every(r => r.matches) && grand.in === grand.out },
    lines: { rows: lineRows, total: { linesIn: grand.linesIn, linesOut: grand.linesOut, roles: grand.roles, matches: lineRows.every(r => r.matches) && grand.linesIn === grand.linesOut } },
    amounts: { rows: amountRows, total: amountTotal },
    checks, allChecksPass: checks.every(c => c.ok),
    // M2: the vouchers that are in none of the files, by why (each is accounted for above; this says it in one place)
    notInAnyFile: (() => {
      const d = grand.destinations;
      const held = HELD_KEYS.reduce((t, k) => t + (d[`held:${k}`] || 0), 0);
      const o = { awaitingRouting: d.awaiting_routing || 0, leftOut: d.left_out || 0, leftOutOutsideYear: grand.leftOutReasons.outside_year || 0, heldForZohoSample: held, noZohoFile: d.no_file || 0, notHandled: d.not_handled || 0 };
      return { ...o, total: o.awaitingRouting + o.leftOut + o.heldForZohoSample + o.noZohoFile + o.notHandled };
    })(),
    destinations: DESTINATIONS.map(({ key, label }) => ({ key, label })), leftOutReasonLabels: LEFT_OUT_REASONS, roleLabels: LINE_ROLES, differenceLabels: DIFFERENCE_REASONS,
  };
}

// The drill-down: the vouchers behind one cell. query: { slot ('all' or a voucher type), bucket, page, pageSize }.
// bucket: all | written:<file> | held:<module> | awaiting_routing | left_out | left_out:<reason> | no_file | not_handled
//   | difference (written vouchers whose amounts differ from Tally) | problem (vouchers that do not add up) | role:<line role>
// Returns { error } for a wrong query.
export function reconVouchers(db, jobId, query, ctx, { unlimited = false, facts: allFacts = null } = {}) {
  const slot = String(query.slot || 'all');
  const bucket = String(query.bucket || 'all');
  const pageSize = unlimited ? Number.MAX_SAFE_INTEGER : Math.min(200, Math.max(1, Number(query.pageSize) || 25));
  const page = Math.max(1, Math.floor(Number(query.page) || 1));
  const [b, sub] = bucket.split(':');
  const okBucket = bucket === 'all' || bucket === 'difference' || bucket === 'problem' || destLabel[bucket] || (b === 'difference' && DIFFERENCE_REASONS[sub])
    || (b === 'left_out' && LEFT_OUT_REASONS[sub]) || (b === 'role' && (LINE_ROLES[sub] || sub === 'missing'));
  if (!okBucket) return { error: `bucket "${bucket}" is not known. Use all, difference, difference:<reason>, problem, ${DESTINATIONS.map(d => d.key).join(', ')}, left_out:<reason> or role:<line role>.` };
  allFacts = allFacts || voucherFacts(db, jobId);
  // any slot the reconciliation shows a row for can be opened (a voucher type no longer uploaded included)
  if (slot !== 'all' && !ctx.slots.includes(slot) && !allFacts.some(f => f.slot === slot)) return { error: `slot must be "all" or one of: ${ctx.slots.join(', ')}.` };
  const facts = allFacts.filter(f => slot === 'all' || f.slot === slot).filter(f => {
    if (bucket === 'all') return true;
    if (bucket === 'difference') return !!f.differenceReason;
    if (b === 'difference') return f.differenceReason === sub;
    if (bucket === 'problem') return !!f.problem;
    if (b === 'role') return f.roles.includes(sub);
    if (b === 'left_out' && sub) return f.entries.some(e => e.outcome === 'left_out' && (e.reason || 'other') === sub);
    return f.entries.some(e => destKey(e) === bucket);
  });
  facts.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0) || x.number.localeCompare(y.number, undefined, { numeric: true }) || x.id - y.id);
  const total = facts.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const list = facts.slice((page - 1) * pageSize, page * pageSize);
  let flagsFor;
  if (list.length > 50) {
    // many vouchers (the CSV report): read the flagged items of the job once
    const by = new Map();
    for (const x of db.prepare("SELECT kind, message, slot, source_id FROM exceptions WHERE job_id = ? AND stage = 'generate' AND source_id IS NOT NULL ORDER BY id").all(jobId)) {
      const k = `${x.slot}|${x.source_id}`;
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(x);
    }
    flagsFor = f => by.get(`${f.slot}|${f.sourceId}`) || [];
  } else {
    const flagsOf = db.prepare("SELECT kind, message FROM exceptions WHERE job_id = ? AND stage = 'generate' AND source_id = ? AND slot = ? ORDER BY id");
    flagsFor = f => flagsOf.all(jobId, f.sourceId, f.slot);
  }
  return { slot, bucket, total, page, pageSize, pages, vouchers: list.map(f => voucherView(f, ctx, f.sourceId ? flagsFor(f) : [])) };
}

// Text cells of the CSV report that Excel would run as a formula (they start with = + - @ or a tab or carriage return)
// get a leading apostrophe. Only this report: the Zoho import files are written as they are.
export const safeText = v => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
const safeRow = (row, textCols) => { const o = { ...row }; for (const c of textCols) o[c] = safeText(o[c]); return o; };

function voucherView(f, ctx, flags) {
  const e = f.entry;
  const roles = {};
  for (const r of f.roles) roles[r] = (roles[r] || 0) + 1;
  return {
    id: f.id, number: f.number, date: f.date, type: f.type, slot: f.slot, slotName: ctx.slotName(f.slot),
    went: f.entries.length ? f.entries.map(x => destLabel[destKey(x)] || x.outcome).join('; ') : 'Not recorded',
    file: e?.outcome === 'written' ? VOUCHER_FILES[e.file]?.module ?? e.file : e?.outcome === 'held' ? `${SAMPLE_NEEDED[e.file]?.module ?? e.file} (not built)` : '',
    documentNumber: e?.outcome === 'written' || e?.outcome === 'held' ? e.number ?? '' : '',
    reason: e?.outcome === 'left_out' ? LEFT_OUT_REASONS[e.reason] || LEFT_OUT_REASONS.other : '',
    lines: f.lines, roles, tally: fmt(f.tally), written: fmt(f.written), difference: fmt(f.difference),
    differenceReason: f.differenceReason, differenceText: f.differenceReason ? DIFFERENCE_REASONS[f.differenceReason] : '',
    problem: f.problem,
    // the flagged items written for this voucher when the files were created (left out, explaining a difference, others)
    flags: flags.map(x => ({ kind: x.kind || null, message: x.message, explains: EXPLAINING_FLAGS.includes(x.kind) })),
  };
}

// The downloadable report: the summary tables and every voucher, as CSV (sections separated by an empty line).
// Starts with a byte order mark, so Excel reads names that are not plain ASCII correctly.
export function reconCsv(db, jobId, rec, ctx, facts = null) {
  const parts = [];
  const destCols = DESTINATIONS.filter(d => rec.total.destinations[d.key]);
  const s1 = ['Voucher type', 'In the Tally JSON', ...destCols.map(d => d.label), 'Total accounted for', 'Status'];
  parts.push(toCsv(['Voucher reconciliation'], [{ 'Voucher reconciliation': safeText(`Files created ${rec.createdAt}${rec.outOfDate ? '. OUT OF DATE: ' + rec.outOfDateReasons.join(' ') : ''}`) }]));
  if (rec.held?.length) {
    parts.push(toCsv(['Held, waiting for a Zoho sample', 'Vouchers', 'Debit in', 'Credit in', 'Sample needed', 'Import after'],
      rec.held.map(h => ({ 'Held, waiting for a Zoho sample': h.module, Vouchers: h.vouchers, 'Debit in': h.debit, 'Credit in': h.credit, 'Sample needed': h.sample, 'Import after': h.importAfterModule }))));
  }
  parts.push(toCsv(s1, [...rec.rows.map(r => ({ 'Voucher type': r.name, 'In the Tally JSON': r.in, ...Object.fromEntries(destCols.map(d => [d.label, r.destinations[d.key] || 0])), 'Total accounted for': r.out, Status: r.matches ? 'Matches' : 'Does not match' })),
    { 'Voucher type': 'Total', 'In the Tally JSON': rec.total.in, ...Object.fromEntries(destCols.map(d => [d.label, rec.total.destinations[d.key] || 0])), 'Total accounted for': rec.total.out, Status: rec.total.matches ? 'Matches' : 'Does not match' }]));
  const reasons = Object.keys(rec.total.leftOutReasons);
  if (reasons.length) parts.push(toCsv(['Left out: reason', 'Vouchers'], reasons.map(k => ({ 'Left out: reason': LEFT_OUT_REASONS[k] || k, Vouchers: rec.total.leftOutReasons[k] }))));
  const roleCols = Object.keys(LINE_ROLES).filter(k => rec.lines.total.roles[k]).concat(rec.lines.total.roles.missing ? ['missing'] : []);
  const roleLabel = k => LINE_ROLES[k] || 'Not recorded';
  const s2 = ['Voucher type', 'Tally lines in', ...roleCols.map(roleLabel), 'Lines accounted for', 'Status'];
  parts.push(toCsv(s2, [...rec.lines.rows.map(r => ({ 'Voucher type': r.name, 'Tally lines in': r.linesIn, ...Object.fromEntries(roleCols.map(k => [roleLabel(k), r.roles[k] || 0])), 'Lines accounted for': r.linesOut, Status: r.matches ? 'Matches' : 'Does not match' })),
    { 'Voucher type': 'Total', 'Tally lines in': rec.lines.total.linesIn, ...Object.fromEntries(roleCols.map(k => [roleLabel(k), rec.lines.total.roles[k] || 0])), 'Lines accounted for': rec.lines.total.linesOut, Status: rec.lines.total.matches ? 'Matches' : 'Does not match' }]));
  const s3 = ['Voucher type', 'Debit in', 'Credit in', 'Debit not written', 'Credit not written', 'Debit of vouchers written (Tally)', 'Credit of vouchers written (Tally)', 'Debit as written', 'Credit as written', 'Debit difference', 'Credit difference'];
  const amountRow = (name, a) => ({ 'Voucher type': name, 'Debit in': a.in.debit, 'Credit in': a.in.credit, 'Debit not written': a.notWritten.debit, 'Credit not written': a.notWritten.credit,
    'Debit of vouchers written (Tally)': a.writtenTally.debit, 'Credit of vouchers written (Tally)': a.writtenTally.credit, 'Debit as written': a.written.debit, 'Credit as written': a.written.credit,
    'Debit difference': a.difference.debit, 'Credit difference': a.difference.credit });
  parts.push(toCsv(s3, [...rec.amounts.rows.map(r => amountRow(r.name, r)), amountRow('Total', rec.amounts.total)]));
  if (rec.amounts.total.differences.length) {
    parts.push(toCsv(['Difference explained by', 'Vouchers', 'Debit', 'Credit'], rec.amounts.total.differences.map(d => ({ 'Difference explained by': d.label, Vouchers: d.vouchers, Debit: d.debit, Credit: d.credit }))));
  }
  parts.push(toCsv(['Check', 'Result'], rec.checks.map(c => ({ Check: c.text, Result: c.ok ? 'OK' : 'Not OK' }))));
  const views = reconVouchers(db, jobId, { slot: 'all', bucket: 'all' }, ctx, { unlimited: true, facts }).vouchers;
  const s4 = ['Voucher type', 'Tally voucher type', 'Voucher number', 'Date', 'Where it went', 'Zoho file', 'Document number written', 'Reason left out', 'Tally lines', 'Debit in', 'Credit in', 'Debit as written', 'Credit as written', 'Difference explained by', 'Problem'];
  const textCols = ['Voucher type', 'Tally voucher type', 'Voucher number', 'Document number written', 'Problem'];
  parts.push(toCsv(s4, views.map(v => safeRow({ 'Voucher type': v.slotName, 'Tally voucher type': v.type, 'Voucher number': v.number, Date: v.date, 'Where it went': v.went, 'Zoho file': v.file, 'Document number written': v.documentNumber,
    'Reason left out': v.reason, 'Tally lines': v.lines, 'Debit in': v.tally?.debit, 'Credit in': v.tally?.credit, 'Debit as written': v.written?.debit ?? '', 'Credit as written': v.written?.credit ?? '',
    'Difference explained by': v.differenceText, Problem: v.problem || '' }, textCols))));
  return '﻿' + parts.join('\r\n');
}

// GET /api/migrations/:id/voucher-reconciliation, .../voucher-reconciliation/vouchers, .../voucher-reconciliation/report.csv
// Read only: viewers can read all three.
export function registerVoucherRecon(app, deps) {
  const { need, db, audit } = deps;
  app.get('/api/migrations/:id/voucher-reconciliation', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    return buildReconciliation(db, job.id, deps);
  });
  app.get('/api/migrations/:id/voucher-reconciliation/vouchers', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const status = reconStatus(db, job.id, deps); // cheap: the vouchers are worked out once, below
    if (!status.available) return reply.code(409).send({ error: status.message });
    const out = reconVouchers(db, job.id, req.query || {}, deps);
    if (out.error) return reply.code(400).send({ error: out.error });
    return { ...out, outOfDate: status.outOfDate };
  });
  app.get('/api/migrations/:id/voucher-reconciliation/report.csv', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const status = reconStatus(db, job.id, deps);
    if (!status.available) return reply.code(409).send({ error: status.message });
    const facts = voucherFacts(db, job.id);
    const rec = buildReconciliation(db, job.id, deps, facts);
    if (!rec.available) return reply.code(409).send({ error: rec.message });
    const csv = reconCsv(db, job.id, rec, deps, facts);
    audit(job.id, 'download', `voucher reconciliation report${rec.outOfDate ? ' (files out of date)' : ''}`);
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="voucher_reconciliation_${job.id}.csv"`).send(csv);
  });
}
