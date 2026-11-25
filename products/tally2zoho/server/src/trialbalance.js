// The Trial Balance as TallyPrime exports it (Display More Reports > Trial Balance > Export > Current, JSON (Data Exchange)).
//
// Confirmed on a real TallyPrime 7.1 export (UTF-16 LE with a byte order mark). It is a REPORT export and has a
// different shape from the data exports (no "tallymessage" list):
//   { "dspaccbody": { "dspaccline": [
//       { "dspaccname": { "dspdispname": "<name>" },
//         "dspaccinfo": [ { "dspopamt": { "dspopamta": <number> }, "dspdramt": { "dspdramta": <number> },
//                           "dspcramt": { "dspcramta": <number> }, "dspclamt": { "dspclamta": <number> } } ],
//         "grpexplosion": { "dspaccline": [ ...lines of the same shape, to any depth... ] } } ] } }
// An amount object is empty ({}) when the column has no figure for the line.
//
// SIGN CONVENTION (worked out from the real export, see README): every amount carries Tally's sign, the same as
// voucher lines and the masters' opening balances: a DEBIT is NEGATIVE, a credit is positive. So
//   - opening and closing balance: negative = debit balance, positive = credit balance;
//   - the debit column is a negative number, the credit column a positive number;
//   - closing = opening + debit column + credit column, on every line;
//   - over the top-level lines, the opening balances add up to zero, and so do the closing balances.
//
// The amounts are JSON numbers. An uploaded report is parsed with parseReportText, which keeps the digits written in
// the file for every amount, so each figure becomes a decimal exactly as Tally wrote it, whatever its size. A report
// handed over as an already parsed document (plain numbers) is read through each number's shortest decimal text; a
// plain number of 2^46 or more cannot hold every paisa and is noted on its line. A figure with more than two
// decimals is noted too.
//
// The report is flattened into ordinary records (type TrialBalanceLine) that the rest of the platform stores and
// shows like any other dataset:
//   { metadata: { type: 'TrialBalanceLine', name, source: 'tally_report' }, lineno, depth, haschildren, parentline,
//     openingbalance, debittotal, credittotal, closingbalance, notes? }
// openingbalance and closingbalance keep Tally's sign ('' when the report has no figure); debittotal and credittotal
// are written without sign.

import Decimal from 'decimal.js';
import { matchKey, hasHiddenCharacters, recordName, recordParent, tallyText } from './tally.js';

export const REPORT_SOURCE = 'tally_report';
export const isReportLine = d => d?.metadata?.source === REPORT_SOURCE;

const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const asList = v => (Array.isArray(v) ? v.filter(isObj) : isObj(v) ? [v] : []);
const lower = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]));
// The body of a Trial Balance report, or null when the document is not one.
export const reportBody = doc => { const b = isObj(doc) ? lower(doc).dspaccbody : null; return isObj(b) ? lower(b) : null; };

// From 2^46 (about 70 lakh crore) on, a JSON number read as a binary number can no longer tell two figures apart that
// differ by 0.01 (the gap between neighbouring binary numbers is then larger than one paisa), so the figure may have
// changed by a paisa on the way. Below it, every figure with two decimals comes back exactly.
const EXACT_LIMIT = 2 ** 46;
// The amount keys of the report. parseReportText keeps the digits Tally wrote for these, so no limit applies to them.
const AMOUNT_KEY = /^dsp(op|dr|cr|cl)amta$/i;
const EXACT = '$exact';
// Parses the text of a report file so that every amount keeps the exact digits written in the file: each number under
// an amount key becomes { $exact: "<the digits as written>" } (the JSON.parse reviver is given the source text of a
// number). readAmount turns that text straight into a decimal, so the figure never passes through a binary number.
export function parseReportText(text) {
  const t = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return JSON.parse(t, (key, value, context) => (typeof value === 'number' && AMOUNT_KEY.test(key) && typeof context?.source === 'string' ? { [EXACT]: context.source } : value));
}
// One amount of the report as { value: Decimal | null, note }. An amount kept as its digits (parseReportText) is read
// from them exactly. A plain number is read through its decimal text. A text amount is accepted too ("1,234.50",
// "1234.50 Dr", "1234.50 Cr"): Dr makes it negative, Cr positive.
function readAmount(v) {
  if (v == null || v === '') return { value: null };
  if (isObj(v) && typeof v[EXACT] === 'string') {
    let d;
    try { d = new Decimal(v[EXACT]); } catch { return { value: null, note: 'could not be read' }; }
    if (!d.isFinite()) return { value: null, note: 'is not a number' };
    return { value: d, note: d.equals(d.toDecimalPlaces(2)) ? undefined : 'has more than two decimals in the file' };
  }
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return { value: null, note: 'is not a number' };
    const d = new Decimal(String(v));
    const notes = [];
    if (!d.equals(d.toDecimalPlaces(2))) notes.push('has more than two decimals in the file');
    if (Math.abs(v) >= EXACT_LIMIT) notes.push('is too large for the file to hold exactly to two decimals');
    return { value: d, note: notes.join(' and ') || undefined };
  }
  const m = /^\s*(-?[\d,]*\.?\d+)\s*(dr|cr)?\.?\s*$/i.exec(String(v));
  if (!m) return { value: null, note: 'could not be read' };
  let d;
  try { d = new Decimal(m[1].replace(/,/g, '')); } catch { return { value: null, note: 'could not be read' }; }
  if (m[2]) d = /dr/i.test(m[2]) ? d.abs().neg() : d.abs();
  return { value: d, note: d.equals(d.toDecimalPlaces(2)) ? undefined : 'has more than two decimals in the file' };
}
const text = d => (d === null ? '' : d.toFixed());

const COLUMNS = [['dspopamt', 'dspopamta', 'opening balance'], ['dspdramt', 'dspdramta', 'debit total'], ['dspcramt', 'dspcramta', 'credit total'], ['dspclamt', 'dspclamta', 'closing balance']];
const KNOWN_LINE = new Set(['dspaccname', 'dspaccinfo', 'grpexplosion']);

// body: reportBody(doc). Returns { lines: [record], unread: { fieldPath: lines }, maxDepth, inexact }.
export function flattenTrialBalance(body) {
  const lines = [], unread = {};
  const miss = path => { unread[path] = (unread[path] || 0) + 1; };
  let maxDepth = 0, inexact = 0;
  const walk = (list, depth, parent) => {
    for (const raw of list) {
      const l = lower(raw);
      for (const k of Object.keys(l)) if (!KNOWN_LINE.has(k)) miss(`dspaccline.${k}`);
      const nameObj = isObj(l.dspaccname) ? lower(l.dspaccname) : {};
      for (const k of Object.keys(nameObj)) if (k !== 'dspdispname') miss(`dspaccname.${k}`);
      const info = lower(asList(l.dspaccinfo)[0] || {});
      for (const k of Object.keys(info)) if (!COLUMNS.some(c => c[0] === k)) miss(`dspaccinfo.${k}`);
      const notes = [];
      const amounts = COLUMNS.map(([outer, inner, label]) => {
        const o = isObj(info[outer]) ? lower(info[outer]) : {};
        for (const k of Object.keys(o)) if (k !== inner) miss(`dspaccinfo.${outer}.${k}`);
        const a = readAmount(o[inner]);
        if (a.note) { notes.push(`The ${label} ${a.note}.`); inexact++; }
        return a.value;
      });
      const kids = asList(l.grpexplosion).flatMap(e => asList(lower(e).dspaccline));
      const name = tallyText(nameObj.dspdispname);
      const rec = {
        // remoteid: the identity of the line (two lines may carry the same name: a group and a ledger)
        metadata: { type: 'TrialBalanceLine', name, source: REPORT_SOURCE, remoteid: `trial-balance-line-${lines.length + 1}` },
        lineno: lines.length + 1, depth, haschildren: kids.length > 0, parentline: parent,
        openingbalance: text(amounts[0]),
        debittotal: amounts[1] === null ? '' : amounts[1].abs().toFixed(),
        credittotal: amounts[2] === null ? '' : amounts[2].abs().toFixed(),
        closingbalance: text(amounts[3]),
        ...(notes.length ? { notes } : {}),
      };
      lines.push(rec);
      if (depth > maxDepth) maxDepth = depth;
      if (kids.length) walk(kids, depth + 1, rec.lineno);
    }
  };
  walk(asList(body.dspaccline), 0, null);
  return { lines, unread, maxDepth, inexact };
}

// ---------- the movement of each ledger, from the stored vouchers ----------
// add(lines) for every voucher that Tally posts to the books (lines from voucherLines: amount in Tally's sign).
// The key of a ledger is matchKey(name), so a name with a hidden line break and the same name without it are one ledger.
// A line whose amount cannot be read (l.amount null) is never counted as zero: it is counted as unreadable, on its ledger
// and in all (unreadable), so the movement check says so instead of blaming the export period.
export function movementCollector() {
  const map = new Map(); // key -> { debit, credit } (both without sign)
  const unreadableOf = new Map(); // key -> number of lines whose amount cannot be read
  let vouchers = 0, unreadable = 0;
  return {
    add(lines) {
      vouchers++;
      for (const l of lines) {
        const k = matchKey(l.ledger);
        if (k && l.amount == null) { unreadable++; unreadableOf.set(k, (unreadableOf.get(k) || 0) + 1); continue; }
        if (!k || !l.amount) continue;
        let m = map.get(k);
        if (!m) map.set(k, m = { debit: new Decimal(0), credit: new Decimal(0) });
        if (l.amount.isNegative()) m.debit = m.debit.plus(l.amount.abs()); else m.credit = m.credit.plus(l.amount);
      }
    },
    get: key => map.get(key) || null,
    unreadableOf: key => unreadableOf.get(key) || 0,
    get unreadable() { return unreadable; },
    get vouchers() { return vouchers; },
  };
}

const D = s => (s === '' || s == null ? new Decimal(0) : new Decimal(s));
const fmt = d => d.toFixed(2);
const side = d => (d.isZero() ? '0.00' : `${d.abs().toFixed(2)} ${d.isNegative() ? 'Dr' : 'Cr'}`);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Matches every line of a flattened report to a Ledger or a Group of the masters and runs the checks.
//   lines:    the stored TrialBalanceLine records (report shape), in order
//   ledgers:  [{ name, parent }] every ledger of the masters;  groups: [{ name, parent, reserved }] every group
//   movement: a movementCollector fed with the stored vouchers, or null to skip the movement check (at upload)
//   context:  { vouchersStored, excluded, otherVouchers } counts used in the messages
// Names are compared with matchKey: exactly, or the same once hidden characters and spaces around the name are
// ignored. Neither value is changed. A name that is both a ledger and a group is decided by the line itself: a line
// with lines under it is the group; otherwise the master whose own group is the line above it is taken.
// Returns { lines: [{ lineNo, name, depth, hasChildren, parentLine, opening, debit, credit, closing, matchType,
//   matchName, matchHow, ledgers, movementDebit, movementCredit, movementOk, closingOk, notes }], summary, flags }.
export function analyseTrialBalance({ lines, ledgers, groups, movement = null, context = {} }) {
  const ledgerIdx = new Map(), groupIdx = new Map();
  const index = (idx, m) => { const k = matchKey(m.name); if (!k) return; if (!idx.has(k)) idx.set(k, []); idx.get(k).push(m); };
  for (const l of ledgers) index(ledgerIdx, l);
  for (const g of groups) index(groupIdx, g);
  const mastersAvailable = ledgers.length + groups.length > 0;

  // every ledger under each group, at any depth (group names as the masters write them)
  const parentOf = new Map(groups.map(g => [g.name, g.parent]));
  const reservedOf = new Map(groups.filter(g => g.reserved).map(g => [g.name, g.reserved]));
  const under = new Map(); // group name -> [ledger key]
  for (const l of ledgers) {
    const seen = new Set();
    for (let g = l.parent; g && !seen.has(g); g = parentOf.get(g)) {
      seen.add(g);
      if (!under.has(g)) under.set(g, []);
      under.get(g).push(matchKey(l.name));
    }
  }

  const byNo = new Map(lines.map(d => [d.lineno, d]));
  const out = [], flags = [];
  const pick = (list, raw) => list.find(m => m.name === raw) || list[0];
  for (const d of lines) {
    const name = recordName(d);
    const key = matchKey(name);
    const lc = ledgerIdx.get(key) || [], gc = groupIdx.get(key) || [];
    const parentName = d.parentline ? recordName(byNo.get(d.parentline)) : '';
    const opening = D(d.openingbalance), debit = D(d.debittotal), credit = D(d.credittotal), closing = D(d.closingbalance);
    const closingOk = opening.minus(debit).plus(credit).equals(closing);
    const notes = [...(d.notes || [])];
    // the ledgers a line stands for, and their movement in the stored vouchers
    const keysOf = t => (t === 'ledger' ? [matchKey(pick(lc, name).name)] : [...new Set(gc.flatMap(g => under.get(g.name) || []))]);
    const movementOf = keys => {
      let dr = new Decimal(0), cr = new Decimal(0), unread = 0;
      for (const k of keys) { const m = movement.get(k); if (m) { dr = dr.plus(m.debit); cr = cr.plus(m.credit); } unread += movement.unreadableOf?.(k) || 0; }
      return { dr, cr, unread, ok: dr.equals(debit) && cr.equals(credit) && !unread };
    };

    let type = null, master = null;
    if (lc.length && gc.length) {
      // The name is both a ledger and a group. Decided, in this order, by: the line having lines under it (a group);
      // which of the two sits directly under the line above (the masters' own group of each); which of the two the
      // vouchers agree with. When nothing decides, the line is read as the ledger and that is said on the line.
      const fits = m => !!parentName && (matchKey(m.parent) === matchKey(parentName) || matchKey(reservedOf.get(m.parent)) === matchKey(parentName));
      const lf = lc.some(fits), gf = gc.some(fits);
      let why = null;
      if (d.haschildren) type = 'group';
      else if (lf !== gf) type = gf ? 'group' : 'ledger';
      else if (movement) {
        const asLedger = movementOf(keysOf('ledger')).ok, asGroup = movementOf(keysOf('group')).ok;
        if (asLedger !== asGroup) { type = asGroup ? 'group' : 'ledger'; why = `The line was read as the ${type}, because the vouchers agree with the figures of the ${type} and not with those of the ${asGroup ? 'ledger' : 'group'}.`; }
      }
      if (!type) { type = 'ledger'; why = 'Nothing in the report or the vouchers decides which one the line is, so it was read as the ledger.'; }
      if (why) notes.push(`"${name}" is the name of both a ledger and a group in the masters. ${why}`);
    } else if (lc.length) type = 'ledger';
    else if (gc.length) type = 'group';
    if (type) master = pick(type === 'ledger' ? lc : gc, name);
    const how = !master ? null : master.name === name ? 'exact' : 'hidden';
    if (how === 'hidden') notes.push(`Matched to the ${type} "${master.name.replace(/[\r\n]+/g, ' (line break) ')}", whose name in the masters differs only by ${hasHiddenCharacters(master.name) || hasHiddenCharacters(name) ? 'hidden characters (for example a line break)' : 'spaces around it'}.`);

    let keys = null, mvDebit = null, mvCredit = null, movementOk = null, mvUnread = 0;
    if (type) keys = keysOf(type);
    if (movement && keys) { const m = movementOf(keys); mvDebit = m.dr; mvCredit = m.cr; movementOk = m.ok; mvUnread = m.unread; }
    out.push({ lineNo: d.lineno, name, depth: d.depth, hasChildren: !!d.haschildren, parentLine: d.parentline ?? null,
      opening: d.openingbalance, debit: d.debittotal, credit: d.credittotal, closing: d.closingbalance,
      matchType: type, matchName: master?.name ?? null, matchHow: how, ledgers: type === 'group' ? keys.length : type === 'ledger' ? 1 : null,
      movementDebit: mvDebit === null ? null : fmt(mvDebit), movementCredit: mvCredit === null ? null : fmt(mvCredit), movementOk, closingOk, notes,
      ...(mvUnread ? { movementUnreadable: mvUnread } : {}) });

    const what = type === 'group' ? `the group "${name}" (${plural(keys.length, 'ledger')} under it in the masters)` : `the ledger "${name}"`;
    if (!type && mastersAvailable) {
      flags.push({ kind: 'trial_balance_line_unmatched', name, uses: 1,
        message: `Trial Balance line "${name}" is neither a ledger nor a group in the Customer, Vendor, Chart of Accounts or Tax files, even when hidden characters and spaces around the name are ignored. `
          + 'It cannot be checked against the vouchers, and it is left out of the Opening Balances file. Check that the masters and the Trial Balance were exported from the same company.' });
    }
    if (how === 'hidden' && (hasHiddenCharacters(master.name) || hasHiddenCharacters(name))) {
      flags.push({ kind: 'trial_balance_name_hidden_characters', name, uses: 1,
        message: `Trial Balance line "${name}" was matched to ${type === 'group' ? 'a group' : 'a ledger'} whose name in the masters is the same except for hidden characters (for example a line break at its end). `
          + 'Both values are kept as they are. The Zoho files carry the name as the masters write it.' });
    }
    if (!closingOk) {
      flags.push({ kind: 'trial_balance_closing_differs', name, uses: 1,
        message: `Trial Balance line "${name}": opening balance ${side(opening)}, debits ${fmt(debit)} and credits ${fmt(credit)} give ${side(opening.minus(debit).plus(credit))}, but the report shows a closing balance of ${side(closing)}. `
          + 'The figures of the report itself do not agree. Export the Trial Balance again with Show Opening Balance, Show Transactions and Show Closing Balance all turned on.' });
    }
    if (movementOk === false) {
      flags.push({ kind: 'trial_balance_movement_differs', name, uses: 1,
        message: `Trial Balance line for ${what}: the report shows debits ${fmt(debit)} and credits ${fmt(credit)} for the period, but the vouchers stored add up to debits ${fmt(mvDebit)} and credits ${fmt(mvCredit)} `
          + `(difference: debits ${fmt(debit.minus(mvDebit))}, credits ${fmt(credit.minus(mvCredit))}). `
          + (mvUnread ? `${plural(mvUnread, 'voucher line')} of ${type === 'group' ? 'these ledgers' : 'this ledger'} ${mvUnread === 1 ? 'has an amount' : 'have amounts'} the tool cannot read, so ${mvUnread === 1 ? 'it is' : 'they are'} not counted (never as zero): see the flagged items "unreadable amount". `
            : 'Likely causes: the Transactions export covers a shorter period than the Trial Balance, a voucher type was not uploaded, or vouchers were changed in Tally between the two exports. ')
          + 'Nothing was changed.' });
    }
  }

  // ---- totals over the top-level lines: debits must equal credits, for the opening and for the closing balances ----
  const top = out.filter(l => l.depth === 0);
  const total = (field, wantDebit) => top.reduce((t, l) => { const v = D(l[field]); return v.isNegative() === wantDebit && !v.isZero() ? t.plus(v.abs()) : t; }, new Decimal(0));
  const totals = {
    openingDebit: fmt(total('opening', true)), openingCredit: fmt(total('opening', false)),
    closingDebit: fmt(total('closing', true)), closingCredit: fmt(total('closing', false)),
    debit: fmt(top.reduce((t, l) => t.plus(D(l.debit)), new Decimal(0))), credit: fmt(top.reduce((t, l) => t.plus(D(l.credit)), new Decimal(0))),
  };
  totals.openingBalanced = totals.openingDebit === totals.openingCredit;
  totals.closingBalanced = totals.closingDebit === totals.closingCredit;
  totals.movementBalanced = totals.debit === totals.credit;
  for (const [label, ok, dr, cr] of [['opening', totals.openingBalanced, totals.openingDebit, totals.openingCredit], ['closing', totals.closingBalanced, totals.closingDebit, totals.closingCredit]]) {
    if (!ok) {
      flags.push({ kind: 'trial_balance_totals', name: `Trial Balance (${label} balances)`, uses: top.length,
        message: `The ${label} balances of the Trial Balance do not balance: over its ${plural(top.length, 'top-level line')} the debit balances total ${dr} and the credit balances total ${cr}. `
          + 'A Trial Balance must balance, so the export is probably incomplete (for example a group was left out, or the report was filtered). Export it again.' });
    }
  }

  // ---- is the report at ledger level? ----
  const leaves = out.filter(l => !l.hasChildren);
  const leafLedgers = leaves.filter(l => l.matchType === 'ledger').length, leafGroups = leaves.filter(l => l.matchType === 'group' && l.ledgers > 0).length; // a group with no ledger under it hides nothing
  const atLedgerLevel = mastersAvailable && leaves.length > 0 && leafGroups === 0;
  const hasOpening = out.some(l => l.opening !== '');
  if (mastersAvailable && !atLedgerLevel && leaves.length) {
    flags.push({ kind: 'trial_balance_not_ledger_level', name: 'Trial Balance', uses: leafGroups,
      message: `The Trial Balance is not at ledger level: ${leafGroups} of its ${plural(leaves.length, 'lowest line')} ${leafGroups === 1 ? 'is a group' : 'are groups'}, not ledgers. `
        + 'The Opening Balances file needs one line per ledger, so it is not created from this report. '
        + 'In Tally open the Trial Balance, press Alt+F5 for the detailed view so that every ledger is listed, export it again and upload it here. The checks on the lines that were read are still run.' });
  }

  const matched = out.filter(l => l.matchType);
  const checked = out.filter(l => l.movementOk !== null);
  const summary = {
    shape: 'report', lines: out.length, topLevelLines: top.length, levels: out.reduce((m, l) => Math.max(m, l.depth), 0) + 1,
    mastersAvailable,
    ledgers: matched.filter(l => l.matchType === 'ledger').length, groups: matched.filter(l => l.matchType === 'group').length,
    unmatched: out.length - matched.length, matchedExactly: matched.filter(l => l.matchHow === 'exact').length, matchedIgnoringHidden: matched.filter(l => l.matchHow === 'hidden').length,
    lowestLines: leaves.length, lowestLedgers: leafLedgers, lowestGroups: leafGroups, lowestUnmatched: leaves.length - leafLedgers - leafGroups,
    atLedgerLevel, hasOpeningBalances: hasOpening,
    figuresNotExact: lines.filter(d => d.notes?.length).length,
    totals,
    closingArithmetic: { agree: out.filter(l => l.closingOk).length, differ: out.filter(l => !l.closingOk).length },
    movement: movement ? { checked: checked.length, agree: checked.filter(l => l.movementOk).length, differ: checked.filter(l => l.movementOk === false).length,
      notChecked: out.length - checked.length, vouchers: movement.vouchers, excludedVouchers: context.excluded ?? 0, otherVouchers: context.otherVouchers ?? 0,
      unreadableLines: movement.unreadable ?? 0 } : null,
  };
  return { lines: out, summary, flags };
}

// In one sentence, for the upload result and the screens.
export function describeTrialBalance(s) {
  const parts = [`${plural(s.lines, 'line')} read from the Tally Trial Balance report (${plural(s.topLevelLines, 'top-level line')}, ${plural(s.levels, 'level')}).`];
  if (!s.mastersAvailable) parts.push('No masters have been uploaded yet, so the lines could not be matched to ledgers and groups. They are matched when the data is processed.');
  else {
    parts.push(`${s.ledgers} ${s.ledgers === 1 ? 'is a ledger' : 'are ledgers'}, ${s.groups} ${s.groups === 1 ? 'is a group' : 'are groups'}${s.unmatched ? `, and ${s.unmatched} could not be matched to a ledger or a group` : ''}.`);
    parts.push(s.atLedgerLevel
      ? 'The report is at ledger level: every lowest line is a ledger.'
      : `The report is NOT at ledger level: ${s.lowestGroups} of its ${plural(s.lowestLines, 'lowest line')} ${s.lowestGroups === 1 ? 'is a group' : 'are groups'}. A detailed Trial Balance (press Alt+F5 in Tally so every ledger is listed) is needed before the Opening Balances file can be created.`);
  }
  if (!s.hasOpeningBalances) parts.push('The report has no opening balance figures. Turn on Show Opening Balance in Tally and export it again: the Opening Balances file is taken from that column.');
  if (s.figuresNotExact) parts.push(`${plural(s.figuresNotExact, 'line')} ${s.figuresNotExact === 1 ? 'has a figure' : 'have figures'} that the file does not hold exactly to two decimals; this is noted on the line.`);
  return parts.join(' ');
}

// The masters as analyseTrialBalance wants them, from Tally master records: { ledgers, groups }.
export function masterIndex(records) {
  const ledgers = [], groups = [], seenL = new Set(), seenG = new Set();
  for (const r of records) {
    const name = recordName(r.data ?? r), type = r.type;
    if (!name) continue;
    if (type === 'Ledger' && !seenL.has(name)) { seenL.add(name); ledgers.push({ name, parent: recordParent(r.data ?? r) }); }
    if (type === 'Group' && !seenG.has(name)) { seenG.add(name); groups.push({ name, parent: recordParent(r.data ?? r), reserved: tallyText((r.data ?? r)?.metadata?.reservedname).trim() }); }
  }
  return { ledgers, groups };
}
