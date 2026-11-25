// Journal review (Voucher Classification): the rules behind the review screen of journal vouchers, kept apart from the
// routes so they can be tested on their own. Nothing here changes Tally data or decides anything: it filters, sorts and
// pages the journals listed by listJournals (index.js), describes their pattern, and works out what a bulk decision
// would do before the user confirms it.
//
// The PATTERN of a journal is the set of Tally groups of the ledgers it debits and the set of Tally groups of the
// ledgers it credits (each ledger's own group, as the masters give it, written without hidden characters). Two journals
// have the same pattern when both sets are the same, whatever the amounts, the number of lines or the ledgers
// themselves. A ledger that is not in the masters has no group: it is counted as "not in the masters", so such a
// journal only matches others with an unknown ledger on the same side.

import Decimal from 'decimal.js';
import { cleanName } from './namefix.js';

export const NO_GROUP = '(not in the masters)';
export const JOURNAL_DECISIONS = ['Invoice', 'Bill', 'Manual Journal'];
export const REVIEW_GROUPS = ['clear', 'needs_check', 'not_clear'];
export const STATES = ['all', 'undecided', 'decided', 'not_posted'];
export const PARTIES = ['customer', 'vendor', 'both', 'none'];
export const SORTS = ['date', 'number', 'amount', 'suggestion', 'decision'];
export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 50;

const groupName = g => cleanName(g) || NO_GROUP;
const sortedUnique = list => [...new Set(list)].sort((a, b) => a.localeCompare(b));

// lines: [{ debit: '12.00' | '', credit: '' | '12.00', group }]. Returns { key, debit: [groups], credit: [groups] }.
export function journalPattern(lines) {
  const debit = sortedUnique(lines.filter(l => l.debit).map(l => groupName(l.group)));
  const credit = sortedUnique(lines.filter(l => l.credit).map(l => groupName(l.group)));
  return { key: `D:${debit.join('|')}>C:${credit.join('|')}`, debit, credit };
}
export const patternWords = p => `Debit: ${p.debit.length ? p.debit.join(', ') : 'nothing'}. Credit: ${p.credit.length ? p.credit.join(', ') : 'nothing'}.`;

// Which review group a journal is in: 'clear' (a plain suggestion with no warning), 'needs_check' (a Bill or Invoice that
// would carry a negative row), 'not_clear' (no clear pattern: the suggestion is Manual Journal only because nothing
// better can be said). Cancelled, optional and deleted journals are in none.
export const reviewGroup = j => (j.notPosted ? null : j.clear === false ? 'not_clear' : j.needsCheck ? 'needs_check' : 'clear');

const lc = s => cleanName(s).toLowerCase();

// Reads and checks the query of the review list. Returns { query } or { error } (in words, for the user).
export function parseReviewQuery(q = {}) {
  const s = k => (q[k] == null ? '' : String(q[k]).trim());
  const out = { suggestion: s('suggestion'), review: s('review'), state: s('state') || 'all', decision: s('decision'), party: s('party'),
    ledger: s('ledger'), pattern: s('pattern'), q: s('q'), from: s('from'), to: s('to'), sort: s('sort') || 'date', dir: s('dir') || 'asc' };
  if (out.suggestion && !JOURNAL_DECISIONS.includes(out.suggestion)) return { error: `The suggestion filter must be one of: ${JOURNAL_DECISIONS.join(', ')}.` };
  if (out.decision && !JOURNAL_DECISIONS.includes(out.decision)) return { error: `The decision filter must be one of: ${JOURNAL_DECISIONS.join(', ')}.` };
  if (out.review && !REVIEW_GROUPS.includes(out.review)) return { error: 'The review filter must be clear, needs_check or not_clear.' };
  if (!STATES.includes(out.state)) return { error: 'The state filter must be all, undecided, decided or not_posted.' };
  if (out.party && !PARTIES.includes(out.party)) return { error: 'The party filter must be customer, vendor, both or none.' };
  if (!SORTS.includes(out.sort)) return { error: `Sort by one of: ${SORTS.join(', ')}.` };
  if (!['asc', 'desc'].includes(out.dir)) return { error: 'The sort direction must be asc or desc.' };
  for (const k of ['from', 'to']) if (out[k] && !/^\d{4}-\d{2}-\d{2}$/.test(out[k])) return { error: `The ${k === 'from' ? 'first' : 'last'} date must be written as yyyy-mm-dd, for example 2024-04-01.` };
  if (out.from && out.to && out.from > out.to) return { error: 'The first date is after the last date.' };
  for (const k of ['min', 'max']) {
    const v = s(k).replace(/,/g, '');
    if (!v) { out[k] = null; continue; }
    if (!/^\d+(\.\d{1,2})?$/.test(v)) return { error: `"${s(k)}" is not an amount. Type a number with at most 2 decimals, for example 5000 or 5000.50.` };
    out[k] = new Decimal(v);
  }
  if (out.min && out.max && out.min.greaterThan(out.max)) return { error: 'The smallest amount is more than the largest amount.' };
  const page = s('page') || '1', size = s('pageSize') || String(DEFAULT_PAGE_SIZE);
  if (!/^\d+$/.test(page) || Number(page) < 1) return { error: 'The page must be a whole number from 1.' };
  if (!/^\d+$/.test(size) || Number(size) < 1 || Number(size) > MAX_PAGE_SIZE) return { error: `The page size must be a whole number from 1 to ${MAX_PAGE_SIZE}.` };
  out.page = Number(page); out.pageSize = Number(size);
  return { query: out };
}

// Does journal j pass every filter of the query? j: an entry of listJournals.
export function matchesQuery(j, query) {
  if (query.state === 'undecided' && (j.notPosted || j.decision)) return false;
  if (query.state === 'decided' && (j.notPosted || !j.decision)) return false;
  if (query.state === 'not_posted' && !j.notPosted) return false;
  if (query.suggestion && (j.notPosted || j.suggested !== query.suggestion)) return false;
  if (query.decision && j.decision !== query.decision) return false;
  if (query.review && reviewGroup(j) !== query.review) return false;
  if (query.party && j.party !== query.party) return false;
  if (query.pattern && j.pattern.key !== query.pattern) return false;
  if (query.ledger && !j.lines.some(l => lc(l.ledger) === lc(query.ledger))) return false;
  if (query.from && (!j.date || j.date < query.from)) return false;
  if (query.to && (!j.date || j.date > query.to)) return false;
  if (query.min && new Decimal(j.total || 0).lessThan(query.min)) return false;
  if (query.max && new Decimal(j.total || 0).greaterThan(query.max)) return false;
  if (query.q) {
    const words = query.q.toLowerCase().split(/\s+/).filter(Boolean);
    const text = [j.number, j.narration, ...j.lines.flatMap(l => [l.ledger, l.written])].map(lc).join('\n');
    if (!words.every(w => text.includes(w))) return false;
  }
  return true;
}

const DECISION_ORDER = { Invoice: 1, Bill: 2, 'Manual Journal': 3 };
// Sorts a copy of the list. Ties are broken by date, then voucher number, then the order of the file, so a page
// never changes between two reads of the same data.
export function sortJournals(list, sort = 'date', dir = 'asc') {
  const sign = dir === 'desc' ? -1 : 1;
  const byText = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true });
  const key = {
    date: (a, b) => byText(a.date, b.date),
    number: (a, b) => byText(a.number, b.number),
    amount: (a, b) => new Decimal(a.total || 0).comparedTo(new Decimal(b.total || 0)),
    suggestion: (a, b) => (DECISION_ORDER[a.suggested] || 9) - (DECISION_ORDER[b.suggested] || 9),
    decision: (a, b) => (DECISION_ORDER[a.decision] || 9) - (DECISION_ORDER[b.decision] || 9),
  }[sort] || (() => 0);
  return [...list].sort((a, b) => sign * key(a, b) || byText(a.date, b.date) || byText(a.number, b.number) || a.id - b.id);
}

// Counts over the whole list (not the filtered one), for the filter buttons.
export function reviewCounts(list) {
  const toDecide = list.filter(j => !j.notPosted);
  const count = (arr, f) => arr.filter(f).length;
  return {
    all: list.length, toDecide: toDecide.length, notPosted: list.length - toDecide.length,
    decided: count(toDecide, j => j.decision), undecided: count(toDecide, j => !j.decision),
    // v2: a journal with no decision is written by the tool's default; a decision made by a person always wins
    byPerson: count(toDecide, j => j.decision), onDefault: count(toDecide, j => !j.decision),
    onDefaultAs: Object.fromEntries(JOURNAL_DECISIONS.map(d => [d, count(toDecide, j => !j.decision && (j.defaultDecision || 'Manual Journal') === d)])),
    clear: count(toDecide, j => reviewGroup(j) === 'clear'), needsCheck: count(toDecide, j => reviewGroup(j) === 'needs_check'), notClear: count(toDecide, j => reviewGroup(j) === 'not_clear'),
    undecidedByReview: { clear: count(toDecide, j => !j.decision && reviewGroup(j) === 'clear'), needsCheck: count(toDecide, j => !j.decision && reviewGroup(j) === 'needs_check'), notClear: count(toDecide, j => !j.decision && reviewGroup(j) === 'not_clear') },
    bySuggestion: Object.fromEntries(JOURNAL_DECISIONS.map(d => [d, count(toDecide, j => j.suggested === d)])),
    byDecision: Object.fromEntries(JOURNAL_DECISIONS.map(d => [d, count(toDecide, j => j.decision === d)])),
    byParty: Object.fromEntries(PARTIES.map(p => [p, count(toDecide, j => j.party === p)])),
  };
}

// The ledgers named on the journals (for the "ledger used" filter): Tally name, the name shown, journals.
export function ledgerFacet(list) {
  const map = new Map();
  for (const j of list) {
    for (const name of new Set(j.lines.map(l => l.ledger))) {
      const k = lc(name);
      if (!map.has(k)) map.set(k, { ledger: name, name: cleanName(name), journals: 0 });
      map.get(k).journals++;
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// The patterns of the journals still to decide, the most common first.
export function patternFacet(list) {
  const map = new Map();
  for (const j of list.filter(x => !x.notPosted)) {
    if (!map.has(j.pattern.key)) map.set(j.pattern.key, { key: j.pattern.key, words: patternWords(j.pattern), journals: 0, undecided: 0, suggestions: {} });
    const p = map.get(j.pattern.key);
    p.journals++; if (!j.decision) p.undecided++;
    p.suggestions[j.suggested] = (p.suggestions[j.suggested] || 0) + 1;
  }
  return [...map.values()].sort((a, b) => b.undecided - a.undecided || b.journals - a.journals || a.words.localeCompare(b.words));
}

// Filters, sorts and pages. Returns { items, total, page, pages, pageSize, matchingIds }: matchingIds are the ids of
// every filtered journal that can be decided (so "select all that match" works across pages).
export function reviewPage(list, query) {
  const filtered = sortJournals(list.filter(j => matchesQuery(j, query)), query.sort, query.dir);
  const pages = Math.max(1, Math.ceil(filtered.length / query.pageSize));
  const page = Math.min(query.page, pages);
  return { items: filtered.slice((page - 1) * query.pageSize, page * query.pageSize), total: filtered.length, page, pages, pageSize: query.pageSize,
    matchingIds: filtered.filter(j => !j.notPosted).map(j => j.id) };
}

// What a decision for several journals would do, before it is made.
//   targets: journals (entries of listJournals); decision: Invoice | Bill | Manual Journal;
//   opts.includeDecided: false leaves journals that already have another decision as they are (the pattern action's
//   default); true changes them too (a selection the user made by hand).
// A journal is refused for a destination when it is refused on its own (j.refused[decision]: a vendor debited is not a
// bill, a customer credited is not an invoice). Returns { decision, change: [journal], counts, refused: [{ id, number,
// reason }], leftOutAnyway: [{ id, number, reason }], notParty: [...] } where leftOutAnyway are journals that would be
// routed but are still left out of the file when it is created (not balanced, or no single customer or vendor on
// them), and notParty those that would be written with a party that is not a customer (vendor) in the masters.
export function planDecision(targets, decision, { includeDecided = true } = {}) {
  const change = [], refused = [], leftOutAnyway = [], notParty = [];
  const counts = { selected: targets.length, change: 0, alreadyThis: 0, keptOtherDecision: 0, notPosted: 0, refused: 0, changingADecision: 0, notClear: 0, needsCheck: 0, differsFromSuggestion: 0, leftOutAnyway: 0, notParty: 0 };
  for (const j of targets) {
    if (j.notPosted) { counts.notPosted++; continue; }
    if (j.decision === decision) { counts.alreadyThis++; continue; }
    if (j.decision && !includeDecided) { counts.keptOtherDecision++; continue; }
    const why = j.refused?.[decision];
    if (why) { counts.refused++; refused.push({ id: j.id, number: j.number, reason: why }); continue; }
    change.push(j);
    if (j.decision) counts.changingADecision++;
    if (reviewGroup(j) === 'not_clear') counts.notClear++;
    if (reviewGroup(j) === 'needs_check') counts.needsCheck++;
    if (j.suggested !== decision) counts.differsFromSuggestion++;
    const out = j.leftOut?.[decision];
    if (out) leftOutAnyway.push({ id: j.id, number: j.number, reason: out });
    else if (j.notParty?.[decision]) notParty.push({ id: j.id, number: j.number, reason: j.notParty[decision] });
  }
  counts.change = change.length; counts.leftOutAnyway = leftOutAnyway.length; counts.notParty = notParty.length;
  return { decision, change, counts, refused, leftOutAnyway, notParty };
}

// The plan in words, for the confirmation and the audit.
export function planWords(plan) {
  const c = plan.counts;
  const n = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
  const parts = [`${n(c.change, 'journal voucher')} will be routed to ${plan.decision}.`];
  if (c.changingADecision) parts.push(`${c.changingADecision} of them already ${c.changingADecision === 1 ? 'has' : 'have'} another decision, which will be replaced.`);
  if (c.differsFromSuggestion) parts.push(`${c.differsFromSuggestion} of them ${c.differsFromSuggestion === 1 ? 'was' : 'were'} suggested as something else.`);
  if (c.notClear) parts.push(`${c.notClear} of them ${c.notClear === 1 ? 'has' : 'have'} no clear pattern.`);
  if (c.needsCheck) parts.push(`${c.needsCheck} of them would carry a negative row.`);
  if (c.leftOutAnyway) parts.push(`${n(c.leftOutAnyway, 'voucher')} will still be left out of the file when it is created (see the reasons).`);
  if (c.notParty) parts.push(`${n(c.notParty, 'voucher')} would be made out to a ledger that is not a ${plan.decision === 'Invoice' ? 'customer' : 'vendor'} (see the reasons).`);
  if (c.alreadyThis) parts.push(`${n(c.alreadyThis, 'voucher')} already ${c.alreadyThis === 1 ? 'goes' : 'go'} to ${plan.decision}.`);
  if (c.keptOtherDecision) parts.push(`${n(c.keptOtherDecision, 'voucher')} with another decision ${c.keptOtherDecision === 1 ? 'is' : 'are'} left as ${c.keptOtherDecision === 1 ? 'it is' : 'they are'}.`);
  if (c.refused) parts.push(`${n(c.refused, 'voucher')} cannot go to ${plan.decision} and ${c.refused === 1 ? 'is' : 'are'} left as ${c.refused === 1 ? 'it is' : 'they are'}.`);
  if (c.notPosted) parts.push(`${n(c.notPosted, 'voucher')} ${c.notPosted === 1 ? 'is' : 'are'} cancelled, optional or deleted in Tally and need${c.notPosted === 1 ? 's' : ''} no decision.`);
  return parts.join(' ');
}
