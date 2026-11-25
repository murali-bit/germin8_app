// The company's own GST identity (GST-012, GST-013, SYN-13): is it registered for GST (Regular or Composition) or not
// registered at all, its GSTIN and its home state. ONE answer, used by the voucher files (the zero-rate defaults of
// invoice and bill lines, the company's state when a voucher lacks it), the HSN/SAC default and the Zoho check (the
// organisation's state, the rules that only apply to a GST-registered organisation).
//
// Where it comes from, in this order:
//  - the migration's GSTIN typed at set-up (the override): the GSTIN and the state;
//  - Tally's own company fields on the vouchers (cmpgstin, cmpgststate, cmpgstregistrationtype): the most common value
//    of each (a few vouchers may lack them, for example contra vouchers);
//  - the registration type: Tally's cmpgstregistrationtype when the vouchers carry it; else "regular" when there is a
//    GSTIN (typed or Tally's) or any sign of GST in the masters (a Duties & Taxes ledger of type GST or with a GST duty
//    head, or one whose type Tally does not give: such a ledger is treated as GST everywhere else too); else "unregistered".
// So a company is taken as not registered only when nothing at all says GST: no GSTIN typed, no company GST field on any
// voucher and no ledger that is or may be GST. Nothing is changed in Tally; the result is said under "Assumptions the
// tool made" whenever it was read from the vouchers or the masters rather than typed (index.js generation).
import { tallyText } from './tally.js';
import { taxLedgerInfo } from './vouchers.js';
import { stateCode, gstinStateCode } from './zohocodes.js';

export const COMPANY_GST_STATUSES = ['regular', 'composition', 'unregistered'];
export const COMPANY_GST_WORDS = { regular: 'registered for GST (Regular)', composition: 'registered for GST under the Composition scheme', unregistered: 'not registered for GST' };
const GSTIN_SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

// Tally's registration type words -> one of the statuses ('' : not told)
export function registrationStatus(text) {
  const t = String(text ?? '').trim().toLowerCase();
  if (!t) return '';
  if (t.includes('composition')) return 'composition';
  if (t.includes('unregistered') || t.includes('not registered') || t === 'consumer') return 'unregistered';
  if (t.includes('regular') || t.includes('registered')) return 'regular';
  return '';
}

// The most common non-empty value of a list of [value, count]
function mostCommon(counts) {
  let best = '', n = 0, total = 0;
  for (const [v, c] of counts) { if (!v) continue; total += c; if (c > n) { best = v; n = c; } }
  return { value: best, count: n, total, distinct: counts.filter(([v]) => v).length };
}

// The company GST identity of a migration.
// Returns { status, gstin, state, source: { status, gstin, state }, typedGstin, tallyGstin, mismatch, derived, words }
//  - derived: true when the status was not given by a typed GSTIN (read from the vouchers or the masters)
//  - mismatch: a sentence when the typed GSTIN differs from the one on Tally's vouchers, else null
export function companyGstOf(db, jobId) {
  const typed = String(db.prepare('SELECT gstin FROM migrations WHERE id = ?').get(jobId)?.gstin || '').trim().toUpperCase();
  const counts = { gstin: new Map(), state: new Map(), type: new Map() };
  const rows = db.prepare(`SELECT json_extract(data, '$.cmpgstin') g, json_extract(data, '$.cmpgststate') s, json_extract(data, '$.cmpgstregistrationtype') t, COUNT(*) n
    FROM source_records WHERE job_id = ? AND object_type = 'Voucher' GROUP BY 1, 2, 3`).all(jobId);
  const bump = (m, v, n) => { if (v) m.set(v, (m.get(v) || 0) + n); };
  for (const r of rows) {
    const text = v => (typeof v === 'string' && !/^[[{]/.test(v.trim()) ? tallyText(v).trim() : '');
    bump(counts.gstin, text(r.g).toUpperCase(), r.n);
    bump(counts.state, stateCode(text(r.s)), r.n);
    bump(counts.type, registrationStatus(text(r.t)), r.n);
  }
  const tallyGstin = mostCommon([...counts.gstin]);
  const tallyState = mostCommon([...counts.state]);
  const tallyType = mostCommon([...counts.type]);
  const typedOk = GSTIN_SHAPE.test(typed);
  const gstin = typedOk ? typed : GSTIN_SHAPE.test(tallyGstin.value) ? tallyGstin.value : '';
  const state = (typedOk && gstinStateCode(typed)) || tallyState.value || (gstin && gstinStateCode(gstin)) || '';
  // any ledger under Duties & Taxes that is, or may be, GST
  let gstLedger = false;
  for (const r of db.prepare("SELECT data FROM source_records WHERE job_id = ? AND slot = 'taxes' AND object_type = 'Ledger'").iterate(jobId)) {
    let d; try { d = JSON.parse(r.data); } catch { continue; }
    const i = taxLedgerInfo(d);
    if (i.gst || (!i.tds && !i.other)) { gstLedger = true; break; }
  }
  let status, statusSource;
  if (tallyType.value) { status = tallyType.value; statusSource = `Tally's registration type on ${tallyType.count} of the vouchers`; }
  else if (gstin) { status = 'regular'; statusSource = typedOk ? 'the GSTIN of the migration' : "the company's GSTIN on Tally's vouchers"; }
  else if (gstLedger) { status = 'regular'; statusSource = 'a GST ledger under Duties & Taxes in the masters'; }
  else { status = 'unregistered'; statusSource = 'no GSTIN on the migration, no company GST field on any voucher and no GST ledger in the masters'; }
  const mismatch = typedOk && tallyGstin.value && tallyGstin.value !== typed
    ? `The GSTIN of the migration (${typed}) is not the company GSTIN on Tally's vouchers (${tallyGstin.value}, on ${tallyGstin.count} voucher(s)). The GSTIN of the migration is used.`
    : null;
  // GST-004: every company GSTIN Tally's vouchers carry, with its count (more than one: a company with several GST
  // registrations, which one Zoho organisation without branches cannot hold as it is)
  const registrations = [...counts.gstin].filter(([g]) => GSTIN_SHAPE.test(g)).sort((x, y) => y[1] - x[1]).map(([g, n]) => ({ gstin: g, state: gstinStateCode(g) || '', vouchers: n }));
  return {
    status, gstin, state, typedGstin: typedOk ? typed : '', tallyGstin: tallyGstin.value, mismatch, registrations,
    derived: !typedOk,
    source: { status: statusSource, gstin: typedOk ? 'migration' : gstin ? 'vouchers' : '', state: typedOk && gstinStateCode(typed) ? 'migration' : tallyState.value ? 'vouchers' : state ? 'gstin' : '' },
    words: COMPANY_GST_WORDS[status],
  };
}
export const isGstRegistered = cg => !cg || cg.status !== 'unregistered';

// The GSTIN that decides the default of the HSN/SAC field (vouchers.js hsnFieldOn): the GSTIN typed on the migration as it
// is (as before), else the company GSTIN on Tally's vouchers (GST-013: a GST company whose GSTIN was not typed has the
// field on by default, as a new GST organisation in Zoho Books has it).
export function companyGstinForHsn(db, jobId) {
  const typed = String(db.prepare('SELECT gstin FROM migrations WHERE id = ?').get(jobId)?.gstin || '').trim();
  return typed || companyGstOf(db, jobId).gstin;
}
