// CORRECTIONS THE ACCOUNTANT ENTERS FOR A VOUCHER THE EXPORT CANNOT GIVE AS IT IS (round 2 of the re-check, SYN-5).
//
// A voucher whose exported date is not a real day ("20250631"), or whose exported debits and credits differ, has only
// one outcome without a person: left out with its reason (the tool never guesses a date or an amount: pick and drop).
// Here the accountant can give the correct value for that one voucher, and the voucher is then written with it:
//  - kind 'date':   the correct date (YYYY-MM-DD, a real day); only for a voucher whose exported date is not a real day;
//  - kind 'amount': the correct amount of ONE ledger line (the ledger and the exported amount name the line); only for
//                   a voucher whose exported debits and credits differ, and the corrected voucher must balance.
// Nothing is ever applied without the accountant: the tool only SUGGESTS an amount, and only when exactly one line's
// change both balances the voucher and makes that ledger's movement equal Tally's own Trial Balance.
// Every correction is listed under "Assumptions the tool made" with the exported value (vouchers.js flags
// voucher_date_corrected / voucher_amount_corrected) and in the audit log.
//
// A correction is kept by the voucher's Tally identifier (its GUID), else by dataset + voucher number + exported date,
// so it survives processing the same files again (the stored record ids change then).
import Decimal from 'decimal.js';
import { isoDate, voucherBalance, ledgerEntryList, money } from './tally.js';

export function ensureCorrectionsTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS voucher_corrections (job_id TEXT NOT NULL, voucher_key TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL,
    decided_by TEXT, at TEXT, PRIMARY KEY (job_id, voucher_key))`);
}

// The key a correction is kept by: the Tally identifier, else dataset|number|exported date.
export function voucherKey(rec, v = rec.data) {
  const sid = rec.source_id == null ? '' : String(rec.source_id).trim();
  return sid ? `guid:${sid}` : `vch:${rec.slot}|${String(v?.vouchernumber ?? '').trim()}|${String(v?.date ?? '').trim()}`;
}

export function correctionsOf(db, jobId) {
  ensureCorrectionsTable(db);
  return new Map(db.prepare('SELECT voucher_key, kind, data, decided_by, at FROM voucher_corrections WHERE job_id = ?').all(jobId)
    .map(r => [r.voucher_key, { kind: r.kind, ...JSON.parse(r.data), decidedBy: r.decided_by, at: r.at }]));
}

// Why a voucher can take a correction of this kind ('' when it can).
export function correctionProblem(v, kind) {
  if (kind === 'date') return isoDate(v?.date) ? 'the exported date is a real day: nothing to correct' : '';
  if (kind === 'amount') { const b = voucherBalance(v); return b.ok ? 'the exported debits and credits are equal: nothing to correct' : b.unreadable ? 'an amount cannot be read' : ''; }
  return 'unknown kind of correction';
}

const sameAmount = (a, b) => a != null && b != null && new Decimal(a).abs().equals(new Decimal(b).abs());
// the entries of the voucher that a correction of { ledger, exported } names
const entriesNamed = (v, c) => ledgerEntryList(v).entries.filter(le => String(le.ledgername ?? '') === c.ledger && sameAmount(money(le.amount), c.exported));

// Checks a correction before it is saved: { ok, error, correction (normalised) }.
export function validateCorrection(v, body) {
  const kind = body?.kind;
  const problem = correctionProblem(v, kind);
  if (problem) return { ok: false, error: `This voucher cannot take a ${kind} correction: ${problem}.` };
  if (kind === 'date') {
    const d = String(body.date ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || isoDate(d.replace(/-/g, '')) !== d) return { ok: false, error: 'Give the correct date as YYYY-MM-DD (a real calendar day).' };
    return { ok: true, correction: { kind, date: d, exported: String(v.date ?? '') } };
  }
  const ledger = String(body.ledger ?? '');
  let amount, exported;
  try { amount = new Decimal(String(body.amount ?? '').replace(/,/g, '')).abs(); exported = new Decimal(String(body.exported ?? '').replace(/,/g, '')).abs(); } catch { return { ok: false, error: 'Give the ledger, the exported amount of the line and the correct amount.' }; }
  if (amount.isZero() || amount.decimalPlaces() > 2) return { ok: false, error: 'The correct amount must be above zero, with at most 2 decimals.' };
  const named = entriesNamed(v, { ledger, exported });
  if (named.length !== 1) return { ok: false, error: named.length ? 'Two lines of the voucher have this ledger and amount: the line cannot be named.' : 'No line of the voucher has this ledger and exported amount.' };
  const correction = { kind, ledger, exported: exported.toFixed(2), amount: amount.toFixed(2) };
  const applied = applyCorrection(v, correction);
  if (applied.error) return { ok: false, error: applied.error };
  return { ok: true, correction };
}

// The voucher with the correction applied: { data, flag: { kind, message } } or { error }. The voucher given is not changed.
export function applyCorrection(v, c) {
  const data = JSON.parse(JSON.stringify(v));
  if (c.kind === 'date') {
    if (isoDate(v.date)) return { error: 'the exported date is a real day' };
    data.date = c.date.replace(/-/g, '');
    return { data, flag: { kind: 'voucher_date_corrected', message: `The exported date of this voucher is "${c.exported}", which is not a real calendar day. It is written with the date the accountant entered, ${c.date} (Voucher Classification, correct the date). Correct the date in Tally as well.` } };
  }
  if (c.kind === 'amount') {
    const named = entriesNamed(data, c);
    if (named.length !== 1) return { error: 'the line the correction names is not in the voucher' };
    const le = named[0];
    const was = money(le.amount);
    le.amount = (was.isNegative() ? '-' : '') + new Decimal(c.amount).toFixed(2);
    const b = voucherBalance(data);
    if (!b.ok) return { error: `with ${c.amount} on "${c.ledger}" the debits and credits still differ (${b.error})` };
    return { data, flag: { kind: 'voucher_amount_corrected', message: `The exported debits and credits of this voucher differ. The line on "${c.ledger}" is written with the amount the accountant entered, ${c.amount} (the export has ${c.exported}; Voucher Classification, correct the amount), so the voucher balances. Correct the voucher in Tally as well.` } };
  }
  return { error: 'unknown kind of correction' };
}

// The amount the tool suggests for an unbalanced voucher, or null. tbLines: the Trial Balance lines of the job (data of
// trial_balance_lines: matchType, matchName, debit, credit, movementDebit, movementCredit, where the movement is that of
// the vouchers stored, this one included as exported). A line qualifies when changing it alone balances the voucher, it
// keeps its side, and the ledger's movement then equals Tally's Trial Balance (debits and credits). Exactly one line
// must qualify.
export function suggestAmount(v, tbLines) {
  const b = voucherBalance(v);
  if (b.ok || b.unreadable || !b.total) return null;
  const tb = new Map();
  for (const l of tbLines || []) if (l.matchType === 'ledger' && l.matchName && !l.hasChildren && l.movementDebit != null) tb.set(l.matchName, l);
  const D = x => new Decimal(String(x ?? '0').replace(/,/g, '') || '0').abs();
  const fits = [];
  for (const le of ledgerEntryList(v).entries) {
    const a = money(le.amount);
    if (a == null || a.isZero()) continue;
    const next = a.minus(b.total);
    if (next.isZero() || next.isNegative() !== a.isNegative()) continue;
    const t = tb.get(String(le.ledgername ?? ''));
    if (!t) continue;
    const change = next.abs().minus(a.abs());
    const dDebit = D(t.debit).minus(D(t.movementDebit)), dCredit = D(t.credit).minus(D(t.movementCredit));
    const ok = a.isNegative() ? dDebit.equals(change) && dCredit.isZero() : dCredit.equals(change) && dDebit.isZero();
    if (ok) fits.push({ ledger: String(le.ledgername), exported: a.abs().toFixed(2), amount: next.abs().toFixed(2),
      why: `Changing this line alone from ${a.abs().toFixed(2)} to ${next.abs().toFixed(2)} balances the voucher, and the ledger's movement then equals Tally's Trial Balance (debits ${D(t.debit).toFixed(2)}, credits ${D(t.credit).toFixed(2)}).` });
  }
  return fits.length === 1 ? fits[0] : null;
}
