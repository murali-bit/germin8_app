// Mapping Profiles: the decisions of one migration saved under a name for the firm, and applied to another migration.
//
// What a profile holds (PROFILE_SECTIONS): account types by Tally group, tax mappings, TDS mappings, unit mappings, item
// rates and the Items accounts, the decisions on Zoho's own accounts, the voucher file settings, and journal routing by
// PATTERN (the Tally groups debited and credited; never single journals: a pattern is saved only when every decided
// journal of it went the same way). For reference only: the firm's GST treatment code set and column layouts (both are
// firm settings, changed only in Company Settings and Template Mapping). Client-specific corrections (name clean-ups,
// possible-duplicate decisions, contact fixes) are saved only when the user ticks "include client-specific corrections".
//
// Applying a profile is done in two steps. The preview lists, entry by entry, what will be applied, what is already the
// same, what matches nothing in this migration, and what conflicts with a decision already made here (kept unless the
// user chooses to replace it). Applying then sends every chosen entry through the SAME route a person would use on the
// screen (same checks, same audit entry with who, the old and the new value, and the same files marked out of date), so a
// profile can never do what the screen would refuse. One more audit entry records the profile application as a whole.
import { matchKey, nameKey } from './tally.js';

export const PROFILE_FORMAT = 'tally-zoho-mapping-profile';
export const PROFILE_VERSION = 1;
const MAX_TEXT = 300, MAX_ENTRIES = 20000, MAX_NAME = 100, MAX_DESCRIPTION = 500;

export const PROFILE_SECTIONS = [
  { key: 'accountTypes', title: 'Account types', place: 'Mapping Studio, Account types' },
  { key: 'clashDecisions', title: "Zoho's own accounts", place: "Mapping Studio, Zoho's own accounts" },
  { key: 'names', title: 'Names with hidden characters', place: 'Mapping Studio, Names', client: true },
  { key: 'duplicates', title: 'Possible duplicates', place: 'Mapping Studio, Names', client: true },
  { key: 'contactFixes', title: 'Contact details', place: 'Mapping Studio, Fix contacts', client: true },
  { key: 'taxMappings', title: 'Tax mapping', place: 'Mapping Studio, Tax mapping' },
  { key: 'tdsMappings', title: 'TDS mapping', place: 'Mapping Studio, TDS mapping' },
  { key: 'unitMappings', title: 'Units', place: 'Mapping Studio, Units' },
  { key: 'itemAccounts', title: 'Items accounts', place: 'Mapping Studio, Rates' },
  { key: 'itemRates', title: 'Item rates and tax preference', place: 'Mapping Studio, Rates' },
  { key: 'voucherSettings', title: 'Voucher file settings', place: 'Mapping Studio, Voucher files' },
  { key: 'journalPatterns', title: 'Journal routing by pattern', place: 'Voucher Classification' },
  { key: 'gstCodes', title: 'GST treatment codes (reference)', place: 'Company Settings', info: true },
  { key: 'columnLayouts', title: 'Column layouts (reference)', place: 'Template Mapping', info: true },
];
const ITEM_FIELDS = ['rate', 'purchaseRate', 'taxability', 'exemptionReason', 'intraTax', 'interTax', 'taxRate'];
const ITEM_WORDS = { rate: 'rate', purchaseRate: 'purchase rate', taxability: 'taxability', exemptionReason: 'exemption reason', intraTax: 'intra-state tax', interTax: 'inter-state tax', taxRate: 'GST rate' };
const show = v => (v ? `"${v}"` : 'nothing');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---------- building a profile from a migration ----------
// v: the views of the migration (index.js), firm: { gst, layouts }. Returns { data, skipped: [words] }.
export function buildProfileData(v, firm, { includeClientSpecific = false, name = '', description = '', source = null } = {}) {
  const skipped = [];
  const items = v.items();
  const journals = v.journals().filter(j => !j.notPosted && j.decision);
  const byPattern = new Map();
  for (const j of journals) {
    if (!byPattern.has(j.pattern.key)) byPattern.set(j.pattern.key, { pattern: j.pattern, decisions: new Map() });
    const p = byPattern.get(j.pattern.key);
    p.decisions.set(j.decision, (p.decisions.get(j.decision) || 0) + 1);
  }
  const journalPatterns = [];
  for (const { pattern, decisions } of byPattern.values()) {
    if (decisions.size === 1) {
      const [decision, n] = [...decisions.entries()][0];
      journalPatterns.push({ key: pattern.key, debit: pattern.debit, credit: pattern.credit, decision, journals: n });
    } else skipped.push(`Journal pattern "Debit: ${pattern.debit.join(', ') || 'nothing'}. Credit: ${pattern.credit.join(', ') || 'nothing'}." was not saved: its journals were routed differently (${[...decisions.entries()].map(([d, n]) => `${n} ${d}`).join(', ')}).`);
  }
  const vs = v.voucherSettings();
  const data = {
    format: PROFILE_FORMAT, version: PROFILE_VERSION, name, description, source,
    accountTypes: v.accountTypes().groups.filter(g => g.source === 'decided' && g.decided).map(g => ({ group: g.group, zohoType: g.decided })),
    taxMappings: v.taxes().filter(t => t.mapped).map(t => ({ ledger: t.ledger, zohoTax: t.zohoTax })),
    tdsMappings: v.tds().ledgers.filter(l => l.tdsName).map(l => ({ ledger: l.ledger, tdsName: l.tdsName, section: l.section || '', percent: l.percent || '' })),
    unitMappings: v.units().units.filter(u => u.zohoUnit).map(u => ({ tallyUnit: u.tallyUnit, zohoUnit: u.zohoUnit })),
    itemRates: items.items.filter(i => ITEM_FIELDS.some(f => i[f])).map(i => ({ item: i.item, ...Object.fromEntries(ITEM_FIELDS.map(f => [f, i[f] || ''])) })),
    itemAccounts: items.accounts?.sales || items.accounts?.purchase ? { sales: items.accounts.sales || '', purchase: items.accounts.purchase || '' } : null,
    clashDecisions: v.clashes().clashes.filter(c => c.decision).map(c => ({ ledger: c.ledger, decision: c.decision, newName: c.newName || '' })),
    voucherSettings: vs.decidedBy ? { billNumber: vs.billNumber, documentStatus: vs.documentStatus } : null,
    journalPatterns,
    gstCodes: firm.gst,
    columnLayouts: firm.layouts,
    clientSpecific: null,
  };
  if (includeClientSpecific) {
    const names = v.names();
    const fixes = v.decisions().contactFixes || {};
    data.clientSpecific = {
      names: names.names.filter(n => n.decision === 'clean').map(n => ({ ledger: n.ledger })),
      duplicates: names.duplicates.filter(d => d.decision).map(d => ({ key: d.key, section: d.section, decision: d.decision, keep: d.kept || '',
        members: d.members.map(m => m.ledger), names: Object.fromEntries(d.members.filter(m => m.newName).map(m => [m.ledger, m.newName])) })),
      contactFixes: Object.entries(fixes).map(([ledger, f]) => ({ ledger, gstin: f.gstin || '', state: f.state || '', treatment: f.treatment || '', reason: f.reason || '' })),
    };
  }
  return { data, skipped };
}

// How many entries each section of a profile holds.
export function profileCounts(d) {
  const c = d?.clientSpecific;
  return {
    accountTypes: d.accountTypes?.length || 0, taxMappings: d.taxMappings?.length || 0, tdsMappings: d.tdsMappings?.length || 0, unitMappings: d.unitMappings?.length || 0,
    itemRates: d.itemRates?.length || 0, itemAccounts: d.itemAccounts ? 1 : 0, clashDecisions: d.clashDecisions?.length || 0, voucherSettings: d.voucherSettings ? 1 : 0,
    journalPatterns: d.journalPatterns?.length || 0, names: c?.names?.length || 0, duplicates: c?.duplicates?.length || 0, contactFixes: c?.contactFixes?.length || 0,
  };
}

// ---------- checking a profile read from a file ----------
// Keeps only the known fields, as text of a limited length. Returns { data } or { error } in words.
export function validateProfileData(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'The file is not a mapping profile: it does not hold a JSON object.' };
  if (raw.format !== PROFILE_FORMAT) return { error: `The file is not a mapping profile of this platform (its "format" is ${show(raw.format)}, expected "${PROFILE_FORMAT}").` };
  if (raw.version !== PROFILE_VERSION) return { error: `The profile was saved in version ${String(raw.version ?? 'unknown')} of the format; this platform reads version ${PROFILE_VERSION}.` };
  let entries = 0, problem = null;
  const text = (v, what) => {
    if (v == null) return '';
    if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') { problem ||= `${what} must be text.`; return ''; }
    const s = String(v);
    if (s.length > MAX_TEXT) { problem ||= `${what} is longer than ${MAX_TEXT} characters.`; return ''; }
    return s;
  };
  const list = (v, what, map) => {
    if (v == null) return [];
    if (!Array.isArray(v)) { problem ||= `"${what}" must be a list.`; return []; }
    entries += v.length;
    return v.filter(x => x && typeof x === 'object').map(x => map(x));
  };
  const strings = (v, what) => (Array.isArray(v) ? v.map(x => text(x, what)) : []);
  const d = {
    format: PROFILE_FORMAT, version: PROFILE_VERSION, name: text(raw.name, 'The name').slice(0, MAX_NAME), description: text(raw.description, 'The description').slice(0, MAX_DESCRIPTION),
    source: raw.source && typeof raw.source === 'object' ? { company: text(raw.source.company, 'The company'), financialYear: text(raw.source.financialYear, 'The financial year'), migration: text(raw.source.migration, 'The migration') } : null,
    accountTypes: list(raw.accountTypes, 'accountTypes', x => ({ group: text(x.group, 'A Tally group'), zohoType: text(x.zohoType, 'A Zoho account type') })),
    taxMappings: list(raw.taxMappings, 'taxMappings', x => ({ ledger: text(x.ledger, 'A tax ledger'), zohoTax: text(x.zohoTax, 'A Zoho tax') })),
    tdsMappings: list(raw.tdsMappings, 'tdsMappings', x => ({ ledger: text(x.ledger, 'A TDS ledger'), tdsName: text(x.tdsName, 'A Zoho TDS name'), section: text(x.section, 'A TDS section'), percent: text(x.percent, 'A TDS percentage') })),
    unitMappings: list(raw.unitMappings, 'unitMappings', x => ({ tallyUnit: text(x.tallyUnit, 'A Tally unit'), zohoUnit: text(x.zohoUnit, 'A Zoho unit') })),
    itemRates: list(raw.itemRates, 'itemRates', x => ({ item: text(x.item, 'An item'), ...Object.fromEntries(ITEM_FIELDS.map(f => [f, text(x[f], `An item's ${ITEM_WORDS[f]}`)])) })),
    itemAccounts: raw.itemAccounts && typeof raw.itemAccounts === 'object' ? { sales: text(raw.itemAccounts.sales, 'The sales account'), purchase: text(raw.itemAccounts.purchase, 'The purchase account') } : null,
    clashDecisions: list(raw.clashDecisions, 'clashDecisions', x => ({ ledger: text(x.ledger, 'A ledger'), decision: text(x.decision, 'A decision'), newName: text(x.newName, 'A new name') })),
    voucherSettings: raw.voucherSettings && typeof raw.voucherSettings === 'object' ? { billNumber: text(raw.voucherSettings.billNumber, 'The bill number setting'), documentStatus: text(raw.voucherSettings.documentStatus, 'The document status') } : null,
    journalPatterns: list(raw.journalPatterns, 'journalPatterns', x => ({ key: text(x.key, 'A pattern'), debit: strings(x.debit, 'A group'), credit: strings(x.credit, 'A group'), decision: text(x.decision, 'A decision'), journals: Number(x.journals) || 0 })),
    gstCodes: raw.gstCodes && typeof raw.gstCodes === 'object' ? { codeSet: text(raw.gstCodes.codeSet, 'The GST code set'), unregisteredConsumerAs: text(raw.gstCodes.unregisteredConsumerAs, 'The GST setting') } : null,
    columnLayouts: list(raw.columnLayouts, 'columnLayouts', x => ({ key: text(x.key, 'A file'), module: text(x.module, 'A file'), hash: text(x.hash, 'A layout'), isDefault: x.isDefault === true })),
    clientSpecific: null,
  };
  const c = raw.clientSpecific;
  if (c && typeof c === 'object') {
    d.clientSpecific = {
      names: list(c.names, 'names', x => ({ ledger: text(x.ledger, 'A name') })),
      duplicates: list(c.duplicates, 'duplicates', x => ({ key: text(x.key, 'A group'), section: text(x.section, 'A kind'), decision: text(x.decision, 'A decision'), keep: text(x.keep, 'A ledger'),
        members: strings(x.members, 'A ledger'), names: Object.fromEntries(Object.entries(x.names && typeof x.names === 'object' ? x.names : {}).map(([k, n]) => [text(k, 'A ledger'), text(n, 'A new name')])) })),
      contactFixes: list(c.contactFixes, 'contactFixes', x => ({ ledger: text(x.ledger, 'A contact'), gstin: text(x.gstin, 'A GSTIN'), state: text(x.state, 'A state'), treatment: text(x.treatment, 'A GST treatment'), reason: text(x.reason, 'A reason') })),
    };
  }
  if (problem) return { error: `The profile cannot be read: ${problem}` };
  if (entries > MAX_ENTRIES) return { error: `The profile has ${entries} entries; at most ${MAX_ENTRIES} can be read.` };
  return { data: d };
}

// ---------- matching a profile's names to this migration ----------
// Exactly, else ignoring hidden characters, else ignoring capital letters and spaces; the last two only when exactly one
// name of this migration fits. Returns (name) => { target, how } | null.
export function nameMatcher(names) {
  const exact = new Set(names);
  const group = key => { const m = new Map(); for (const n of names) { const k = key(n); if (!m.has(k)) m.set(k, []); m.get(k).push(n); } return m; };
  const byMatch = group(matchKey), byName = group(nameKey);
  return n => {
    if (exact.has(n)) return { target: n, how: 'same name' };
    const a = byMatch.get(matchKey(n)); if (a?.length === 1) return { target: a[0], how: 'same name once hidden characters are ignored' };
    const b = byName.get(nameKey(n)); if (b?.length === 1) return { target: b[0], how: 'same name once capital letters and spaces are ignored' };
    return null;
  };
}

// ---------- the preview ----------
// v: the views of the target migration; firm: its firm settings. Returns [entry]: { id, section, what, target, how, status:
// 'apply' | 'same' | 'conflict' | 'no_match' | 'info', current, value, note, request (internal: the route that applies it) }.
export function planProfile(profile, v, firm, jobBase) {
  const out = [];
  const add = e => out.push({ how: null, target: null, current: null, note: null, request: null, ...e });
  const base = jobBase;
  // generic: one entry per profile row matched by name to a list of this migration's rows
  const byName = (section, rows, list, nameOf, targetName, describe, currentOf, request) => {
    const match = nameMatcher(list.map(targetName));
    for (const r of rows) {
      const name = nameOf(r);
      const m = match(name);
      if (!m) { add({ id: `${section}:${name}`, section, what: name, status: 'no_match', value: describe(r), note: 'Nothing in this migration has this name.' }); continue; }
      const t = list.find(x => targetName(x) === m.target);
      const cur = currentOf(t, r);
      add({ id: `${section}:${name}`, section, what: name, target: m.target, how: m.how, value: describe(r), current: cur.words, status: cur.status, note: cur.note || null, request: request(m.target, r) });
    }
  };

  // account types by Tally group
  const at = v.accountTypes();
  byName('accountTypes', profile.accountTypes || [], at.groups, r => r.group, g => g.group, r => r.zohoType,
    (g, r) => (g.decided ? { status: g.decided === r.zohoType ? 'same' : 'conflict', words: `${g.decided} (decided)` }
      : { status: g.zohoType === r.zohoType ? 'same' : 'apply', words: g.zohoType ? `${g.zohoType} (${g.source === 'inherited' ? `from "${g.inheritedFrom}"` : 'standard type'})` : 'no type' }),
    (target, r) => ({ method: 'PUT', url: `${base}/account-types`, payload: { group: target, zohoType: r.zohoType } }));
  // Zoho's own accounts
  const clashWords = c => (c.decision === 'rename' ? `rename to "${c.newName}"` : c.decision === 'zoho' ? "use Zoho's own account" : c.decision === 'keep' ? 'leave as it is' : 'not decided');
  byName('clashDecisions', profile.clashDecisions || [], v.clashes().clashes, r => r.ledger, c => c.ledger, clashWords,
    (c, r) => (!c.decision ? { status: 'apply', words: 'not decided' } : { status: c.decision === r.decision && (c.newName || '') === (r.newName || '') ? 'same' : 'conflict', words: clashWords(c) }),
    (target, r) => ({ method: 'PUT', url: `${base}/account-clashes`, payload: { ledger: target, decision: r.decision, newName: r.newName } }));
  // client-specific corrections
  const cs = profile.clientSpecific;
  if (cs) {
    const names = v.names();
    byName('names', cs.names || [], names.names, r => r.ledger, n => n.ledger, () => 'clean the name',
      n => (n.decision === 'clean' ? { status: 'same', words: 'cleaned' } : n.partOfDuplicate ? { status: 'conflict', words: 'decided as a possible duplicate', note: 'This name was decided under possible duplicates; replacing is refused there.' } : { status: 'apply', words: 'not cleaned' }),
      target => ({ method: 'PUT', url: `${base}/names`, payload: { ledger: target, clean: true } }));
    const dupWords = d => (d.decision === 'merge' ? `treat as one, "${d.keep ?? d.kept}" written` : d.decision === 'keep_both' ? 'keep both' : 'not decided');
    for (const d of cs.duplicates || []) {
      const g = names.duplicates.find(x => x.key === d.key);
      const id = `duplicates:${d.key}`;
      const what = d.members.join(' / ');
      if (!g) { add({ id, section: 'duplicates', what, status: 'no_match', value: dupWords(d), note: 'This migration has no group of possible duplicates with exactly these ledgers.' }); continue; }
      const curNames = Object.fromEntries(g.members.filter(m => m.newName).map(m => [m.ledger, m.newName]));
      const same = g.decision === d.decision && (d.decision !== 'merge' || g.kept === d.keep) && JSON.stringify(curNames) === JSON.stringify(d.names || {});
      add({ id, section: 'duplicates', what, target: what, how: 'same ledgers', value: dupWords(d), current: g.decision ? dupWords({ decision: g.decision, kept: g.kept }) : 'not decided',
        status: !g.decision ? 'apply' : same ? 'same' : 'conflict', request: { method: 'PUT', url: `${base}/duplicates`, payload: { key: d.key, decision: d.decision, keep: d.keep, names: d.names || {} } } });
    }
    const fixes = v.decisions().contactFixes || {};
    const fixWords = f => [f.gstin ? `GSTIN ${f.gstin}` : '', f.state ? `state ${f.state}` : '', f.treatment ? `treated as ${f.treatment}` : ''].filter(Boolean).join(', ') || 'no correction';
    byName('contactFixes', cs.contactFixes || [], v.contacts().map(n => ({ ledger: n })), r => r.ledger, c => c.ledger, fixWords,
      (c, r) => { const f = fixes[c.ledger]; return !f ? { status: 'apply', words: 'no correction' } : { status: fixWords(f) === fixWords(r) ? 'same' : 'conflict', words: fixWords(f) }; },
      (target, r) => ({ method: 'PUT', url: `${base}/contact-fixes`, payload: { ledger: target, gstin: r.gstin, state: r.state, treatment: r.treatment,
        reason: `From mapping profile "${profile.name}"${r.reason ? `: ${r.reason}` : ''}`.slice(0, 200) } }));
  }
  // tax, TDS, units
  byName('taxMappings', profile.taxMappings || [], v.taxes(), r => r.ledger, t => t.ledger, r => r.zohoTax,
    (t, r) => (!t.zohoTax ? { status: 'apply', words: 'not mapped' } : { status: t.zohoTax === r.zohoTax ? 'same' : 'conflict', words: t.zohoTax }),
    (target, r) => ({ method: 'PUT', url: `${base}/tax-mappings`, payload: { ledger: target, zohoTax: r.zohoTax } }));
  const tdsWords = m => (m.tdsName ? `"${m.tdsName}"${m.section ? `, section ${m.section}` : ''}${m.percent ? `, ${m.percent}%` : ''}` : 'not mapped');
  byName('tdsMappings', profile.tdsMappings || [], v.tds().ledgers, r => r.ledger, l => l.ledger, tdsWords,
    (l, r) => (!l.tdsName ? { status: 'apply', words: 'not mapped' } : { status: tdsWords(l) === tdsWords(r) ? 'same' : 'conflict', words: tdsWords(l) }),
    (target, r) => ({ method: 'PUT', url: `${base}/tds-mappings`, payload: { ledger: target, tdsName: r.tdsName, section: r.section, percent: r.percent } }));
  byName('unitMappings', profile.unitMappings || [], v.units().units, r => r.tallyUnit, u => u.tallyUnit, r => r.zohoUnit,
    (u, r) => (!u.zohoUnit ? { status: 'apply', words: 'as in Tally' } : { status: u.zohoUnit === r.zohoUnit ? 'same' : 'conflict', words: u.zohoUnit }),
    (target, r) => ({ method: 'PUT', url: `${base}/unit-mappings`, payload: { tallyUnit: target, zohoUnit: r.zohoUnit } }));
  // items
  const items = v.items();
  if (profile.itemAccounts) {
    const cur = items.accounts || {};
    const w = a => `sales ${show(a.sales)}, purchase ${show(a.purchase)}`;
    add({ id: 'itemAccounts', section: 'itemAccounts', what: 'Account and Purchase Account of the Items file', target: 'Items file', how: 'one setting per migration', value: w(profile.itemAccounts), current: w(cur),
      status: !cur.sales && !cur.purchase ? 'apply' : cur.sales === profile.itemAccounts.sales && cur.purchase === profile.itemAccounts.purchase ? 'same' : 'conflict',
      request: { method: 'PUT', url: `${base}/item-accounts`, payload: { salesAccount: profile.itemAccounts.sales, purchaseAccount: profile.itemAccounts.purchase } } });
  }
  const itemWords = i => ITEM_FIELDS.filter(f => i[f]).map(f => `${ITEM_WORDS[f]} ${i[f]}`).join(', ') || 'nothing entered';
  byName('itemRates', profile.itemRates || [], items.items, r => r.item, i => i.item, itemWords,
    (i, r) => { const has = ITEM_FIELDS.some(f => i[f]); return !has ? { status: 'apply', words: 'nothing entered' } : { status: ITEM_FIELDS.every(f => (i[f] || '') === (r[f] || '')) ? 'same' : 'conflict', words: itemWords(i) }; },
    (target, r) => ({ method: 'PUT', url: `${base}/item-rates`, payload: { item: target, ...Object.fromEntries(ITEM_FIELDS.map(f => [f, r[f] || ''])) } }));
  // voucher file settings
  if (profile.voucherSettings) {
    const cur = v.voucherSettings();
    const w = s => `Bill Number from the ${s.billNumber === 'reference' ? "supplier's invoice number" : 'Tally voucher number'}, documents ${s.documentStatus === 'draft' ? 'as drafts' : 'posted'}`;
    const same = cur.billNumber === profile.voucherSettings.billNumber && cur.documentStatus === profile.voucherSettings.documentStatus;
    add({ id: 'voucherSettings', section: 'voucherSettings', what: 'Bill Number and document status', target: 'Voucher files', how: 'one setting per migration', value: w(profile.voucherSettings),
      current: `${w(cur)}${cur.decidedBy ? '' : ' (the defaults)'}`, status: same ? 'same' : cur.decidedBy ? 'conflict' : 'apply',
      request: { method: 'PUT', url: `${base}/voucher-settings`, payload: { ...profile.voucherSettings } } });
  }
  // journal routing by pattern: the journals of this migration with the same pattern
  const journals = v.journals().filter(j => !j.notPosted);
  for (const p of profile.journalPatterns || []) {
    const same = journals.filter(j => j.pattern.key === p.key);
    const what = `Debit: ${p.debit.join(', ') || 'nothing'}. Credit: ${p.credit.join(', ') || 'nothing'}.`;
    if (!same.length) { add({ id: `journalPatterns:${p.key}`, section: 'journalPatterns', what, status: 'no_match', value: p.decision, note: 'No journal voucher of this migration has this pattern.' }); continue; }
    const undecided = same.filter(j => !j.decision), other = same.filter(j => j.decision && j.decision !== p.decision);
    const refused = same.filter(j => j.refused?.[p.decision] && (!j.decision || j.decision !== p.decision)).length;
    const req = includeDecided => ({ method: 'POST', url: `${base}/journals/pattern`, payload: { recordId: same[0].id, decision: p.decision, includeDecided }, journal: true });
    const refusedNote = refused ? `${plural(refused, 'journal')} of this pattern cannot be routed to ${p.decision} (the same rule as on the screen) and will be left as they are.` : null;
    if (undecided.length || !other.length) {
      add({ id: `journalPatterns:${p.key}`, section: 'journalPatterns', what, target: plural(same.length, 'journal voucher'), how: 'same Tally groups debited and credited', value: `route to ${p.decision}`,
        current: `${undecided.length} without a decision, ${same.length - undecided.length - other.length} already ${p.decision}`, status: undecided.length ? 'apply' : 'same', note: refusedNote, request: req(false) });
    }
    if (other.length) {
      add({ id: `journalPatterns:${p.key}:decided`, section: 'journalPatterns', what, target: plural(other.length, 'journal voucher'), how: 'same Tally groups debited and credited', value: `route to ${p.decision}`,
        current: `${plural(other.length, 'journal')} routed otherwise (${[...new Set(other.map(j => j.decision))].join(', ')})`, status: 'conflict', note: refusedNote, request: req(true) });
    }
  }
  // reference only: firm settings
  if (profile.gstCodes) {
    const same = profile.gstCodes.codeSet === firm.gst.codeSet && (profile.gstCodes.codeSet !== 'help' || (profile.gstCodes.unregisteredConsumerAs || '') === (firm.gst.unregisteredConsumerAs || ''));
    add({ id: 'gstCodes', section: 'gstCodes', what: 'GST treatment codes', target: 'This firm', value: profile.gstCodes.codeSet === 'help' ? "as on Zoho's help page" : "as in Zoho's import sample",
      current: firm.gst.codeSet === 'help' ? "as on Zoho's help page" : "as in Zoho's import sample", status: same ? 'same' : 'info',
      note: same ? null : 'This is a setting of the whole firm. It is not changed by a profile: an admin changes it in Company Settings.' });
  }
  for (const l of profile.columnLayouts || []) {
    const cur = firm.layouts.find(x => x.key === l.key);
    if (!cur) continue;
    add({ id: `columnLayouts:${l.key}`, section: 'columnLayouts', what: l.module || l.key, target: 'This firm', value: l.isDefault ? "Zoho's sample layout" : `layout version ${l.hash.slice(0, 12)}`,
      current: cur.isDefault ? "Zoho's sample layout" : `layout version ${cur.hash.slice(0, 12)}`, status: cur.hash === l.hash ? 'same' : 'info',
      note: cur.hash === l.hash ? null : 'Column layouts are kept per firm. A profile does not change them: change them in Template Mapping.' });
  }
  return out;
}

export const publicEntry = ({ request, ...e }) => e;
export function planSummary(entries) {
  const count = s => entries.filter(e => e.status === s).length;
  return { apply: count('apply'), same: count('same'), conflict: count('conflict'), noMatch: count('no_match'), info: count('info') };
}

// ---------- routes ----------
// deps: views(jobId) -> the views of a migration; firmSettings(firmId) -> { gst, layouts }.
export function registerProfiles(app, { db, need, audit, now, tx, views, firmSettings }) {
  db.exec(`CREATE TABLE IF NOT EXISTS mapping_profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, firm_id INTEGER NOT NULL, name TEXT NOT NULL, description TEXT, data TEXT NOT NULL,
    include_client INTEGER, source_job TEXT, source_company TEXT, created_by TEXT, created_at TEXT, updated_by TEXT, updated_at TEXT, last_applied TEXT)`);
  const actor = req => req.user?.email || 'system';
  const isAdmin = req => ['super_admin', 'admin'].includes(req.user?.role);
  const firmOf = req => req.user?.firm_id ?? 1;
  // A viewer limited to one client company sees only the profiles saved from that company's migrations: every profile
  // holds names of its source client (ledgers, items, tax ledgers; with client-specific corrections also GSTINs).
  const sameCompany = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
  const scoped = req => req.user?.role === 'viewer' && !!req.user?.company;
  const visible = (req, p) => p && (req.user?.role === 'super_admin' || (p.firm_id === firmOf(req) && (!scoped(req) || sameCompany(p.source_company, req.user.company))));
  const getProfile = (req, reply) => {
    const p = db.prepare('SELECT * FROM mapping_profiles WHERE id = ?').get(Number(req.params.pid));
    if (!visible(req, p)) { reply.code(404).send({ error: 'Mapping profile not found.' }); return null; }
    return p;
  };
  const summary = p => {
    const data = JSON.parse(p.data);
    return { id: p.id, name: p.name, description: p.description || '', includesClientSpecific: !!p.include_client, sourceMigration: p.source_job, sourceCompany: p.source_company,
      createdBy: p.created_by, createdAt: p.created_at, updatedBy: p.updated_by, updatedAt: p.updated_at, lastApplied: p.last_applied ? JSON.parse(p.last_applied) : null, counts: profileCounts(data) };
  };
  const checkName = (req, name, exceptId = null) => {
    const n = String(name ?? '').trim();
    if (!n) return { error: 'Give the profile a name.' };
    if (n.length > MAX_NAME || /[\u0000-\u001f\u007f]/.test(n)) return { error: `The name is too long or has hidden characters. Use ${MAX_NAME} characters or fewer.` };
    const clash = db.prepare('SELECT id FROM mapping_profiles WHERE firm_id = ? AND lower(name) = lower(?)').all(firmOf(req), n).find(r => r.id !== exceptId);
    if (clash) return { error: `A profile called "${n}" already exists. Choose another name, or update that profile.`, existingId: clash.id };
    return { value: n };
  };
  const checkDescription = d => { const s = String(d ?? '').trim(); return s.length > MAX_DESCRIPTION ? { error: `The description is too long. Use ${MAX_DESCRIPTION} characters or fewer.` } : { value: s }; };
  const countWords = c => Object.entries(c).filter(([, n]) => n).map(([k, n]) => `${PROFILE_SECTIONS.find(s => s.key === k)?.title || k} ${n}`).join(', ') || 'nothing';

  app.get('/api/profiles', req => ({
    sections: PROFILE_SECTIONS, canChange: req.user?.role !== 'viewer',
    profiles: (req.user?.role === 'super_admin' ? db.prepare('SELECT * FROM mapping_profiles ORDER BY lower(name)').all() : db.prepare('SELECT * FROM mapping_profiles WHERE firm_id = ? ORDER BY lower(name)').all(firmOf(req))).filter(p => visible(req, p)).map(summary),
  }));
  app.get('/api/profiles/:pid', (req, reply) => { const p = getProfile(req, reply); if (!p) return; return { ...summary(p), data: JSON.parse(p.data), sections: PROFILE_SECTIONS }; });

  // Save the decisions of a migration. { name, description?, includeClientSpecific?, replaceProfileId? (update that profile instead) }
  app.post('/api/migrations/:id/profiles', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    if (!['processed', 'generated'].includes(job.status)) return reply.code(409).send({ error: 'Process the data of this migration first: a profile is made from its decisions.' });
    const replaceId = req.body?.replaceProfileId != null ? Number(req.body.replaceProfileId) : null;
    let existing = null;
    if (replaceId != null) {
      existing = db.prepare('SELECT * FROM mapping_profiles WHERE id = ?').get(replaceId);
      if (!visible(req, existing)) return reply.code(404).send({ error: 'Mapping profile not found.' });
      if (!isAdmin(req) && existing.created_by !== actor(req)) return reply.code(403).send({ error: 'Only an admin or the person who saved the profile can replace it.' });
    }
    const name = checkName(req, req.body?.name ?? existing?.name, replaceId);
    if (name.error) return reply.code(409).send({ error: name.error, existingId: name.existingId ?? null });
    const desc = checkDescription(req.body?.description ?? existing?.description);
    if (desc.error) return reply.code(400).send({ error: desc.error });
    const include = req.body?.includeClientSpecific === true;
    const { data, skipped } = buildProfileData(views(job.id), firmSettings(job.firm_id ?? 1), { includeClientSpecific: include, name: name.value, description: desc.value,
      source: { company: job.company, financialYear: job.financial_year, migration: job.id } });
    const counts = profileCounts(data);
    let id = replaceId;
    tx(() => {
      if (existing) {
        db.prepare('UPDATE mapping_profiles SET name = ?, description = ?, data = ?, include_client = ?, source_job = ?, source_company = ?, updated_by = ?, updated_at = ? WHERE id = ?')
          .run(name.value, desc.value, JSON.stringify(data), include ? 1 : 0, job.id, job.company, actor(req), now(), replaceId);
      } else {
        id = Number(db.prepare('INSERT INTO mapping_profiles (firm_id, name, description, data, include_client, source_job, source_company, created_by, created_at, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
          .run(job.firm_id ?? firmOf(req), name.value, desc.value, JSON.stringify(data), include ? 1 : 0, job.id, job.company, actor(req), now(), actor(req), now()).lastInsertRowid);
      }
      const words = `Mapping profile "${name.value}" ${existing ? 'replaced' : 'saved'} from migration ${job.id} (${countWords(counts)}). Client-specific corrections ${include ? 'included' : 'not included'}.${skipped.length ? ` Not saved: ${skipped.join(' ')}` : ''}`;
      audit(job.id, existing ? 'profile_replaced' : 'profile_saved', words);
      audit(null, existing ? 'profile_replaced' : 'profile_saved', `Firm ${job.firm_id ?? firmOf(req)}: ${words}`);
    });
    return { ...summary(db.prepare('SELECT * FROM mapping_profiles WHERE id = ?').get(id)), skipped };
  });

  // { name?, description? }
  app.put('/api/profiles/:pid', (req, reply) => {
    const p = getProfile(req, reply); if (!p) return;
    if (!isAdmin(req) && p.created_by !== actor(req)) return reply.code(403).send({ error: 'Only an admin or the person who saved the profile can change it.' });
    const name = checkName(req, req.body?.name ?? p.name, p.id);
    if (name.error) return reply.code(409).send({ error: name.error });
    const desc = checkDescription(req.body?.description ?? p.description);
    if (desc.error) return reply.code(400).send({ error: desc.error });
    if (name.value === p.name && desc.value === (p.description || '')) return summary(p);
    db.prepare('UPDATE mapping_profiles SET name = ?, description = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(name.value, desc.value, actor(req), now(), p.id);
    audit(null, 'profile_renamed', `Firm ${p.firm_id}: mapping profile "${p.name}"${name.value !== p.name ? ` renamed to "${name.value}"` : ''}${desc.value !== (p.description || '') ? ', description changed' : ''}.`);
    return summary(db.prepare('SELECT * FROM mapping_profiles WHERE id = ?').get(p.id));
  });

  app.delete('/api/profiles/:pid', (req, reply) => {
    const p = getProfile(req, reply); if (!p) return;
    if (!isAdmin(req) && p.created_by !== actor(req)) return reply.code(403).send({ error: 'Only an admin or the person who saved the profile can delete it.' });
    db.prepare('DELETE FROM mapping_profiles WHERE id = ?').run(p.id);
    audit(null, 'profile_deleted', `Firm ${p.firm_id}: mapping profile "${p.name}" deleted (${countWords(profileCounts(JSON.parse(p.data)))}). Decisions already applied to migrations are kept.`);
    return { ok: true };
  });

  // The profile as a JSON file.
  app.get('/api/profiles/:pid/export', (req, reply) => {
    const p = getProfile(req, reply); if (!p) return;
    const data = { ...JSON.parse(p.data), name: p.name, description: p.description || '' };
    audit(null, 'profile_exported', `Firm ${p.firm_id}: mapping profile "${p.name}" downloaded as a file.`);
    const file = `mapping-profile-${p.name.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || p.id}.json`;
    return reply.header('content-type', 'application/json; charset=utf-8').header('content-disposition', `attachment; filename="${file}"`).send(JSON.stringify(data, null, 2));
  });

  // { profile: the JSON of an exported profile, name? }. Saved as a new profile of the firm.
  app.post('/api/profiles/import', (req, reply) => {
    let raw = req.body?.profile;
    if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { return reply.code(400).send({ error: 'The file is not valid JSON.' }); } }
    const v = validateProfileData(raw);
    if (v.error) return reply.code(400).send({ error: v.error });
    const name = checkName(req, req.body?.name || v.data.name || 'Imported profile');
    if (name.error) return reply.code(409).send({ error: name.error, existingId: name.existingId ?? null });
    const data = { ...v.data, name: name.value };
    const counts = profileCounts(data);
    const id = Number(db.prepare('INSERT INTO mapping_profiles (firm_id, name, description, data, include_client, source_job, source_company, created_by, created_at, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(firmOf(req), name.value, data.description || '', JSON.stringify(data), data.clientSpecific ? 1 : 0, data.source?.migration || null, data.source?.company || null, actor(req), now(), actor(req), now()).lastInsertRowid);
    audit(null, 'profile_imported', `Firm ${firmOf(req)}: mapping profile "${name.value}" read from a file (${countWords(counts)}).`);
    return summary(db.prepare('SELECT * FROM mapping_profiles WHERE id = ?').get(id));
  });

  const preview = (req, job, p) => {
    const data = JSON.parse(p.data);
    const entries = planProfile({ ...data, name: p.name }, views(job.id), firmSettings(job.firm_id ?? 1), `/api/migrations/${job.id}`);
    return { data, entries };
  };
  const needsProcessed = (job, reply) => {
    if (['processed', 'generated'].includes(job.status)) return true;
    reply.code(409).send({ error: 'Process the data of this migration first: a profile is applied to its ledgers, groups and journals.' });
    return false;
  };
  // What applying would do. { } -> { entries, counts, sections }
  // It changes nothing, so it is also a GET: a viewer can read what a profile would do.
  const previewRoute = (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const p = getProfile(req, reply); if (!p) return;
    if (!needsProcessed(job, reply)) return;
    const { entries } = preview(req, job, p);
    return { profile: summary(p), sections: PROFILE_SECTIONS, entries: entries.map(publicEntry), counts: planSummary(entries) };
  };
  app.post('/api/migrations/:id/profiles/:pid/preview', previewRoute);
  app.get('/api/migrations/:id/profiles/:pid/preview', previewRoute);

  // { replace: [entry id] (conflicts to replace; every other conflict is kept), confirmCount (the number of entries that
  // would be applied, from the preview) }. Each entry goes through the route a person would use on the screen.
  const ORDER = PROFILE_SECTIONS.map(s => s.key);
  const applying = new Set(); // migrations a profile is being applied to (one at a time)
  app.post('/api/migrations/:id/profiles/:pid/apply', async (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const p = getProfile(req, reply); if (!p) return;
    if (!needsProcessed(job, reply)) return;
    const replace = new Set(Array.isArray(req.body?.replace) ? req.body.replace.map(String) : []);
    const { entries } = preview(req, job, p);
    const chosen = entries.filter(e => e.request && (e.status === 'apply' || (e.status === 'conflict' && replace.has(e.id))))
      .sort((a, b) => ORDER.indexOf(a.section) - ORDER.indexOf(b.section));
    // a journal pattern with both parts chosen is applied once, with the decided journals included
    const jp = new Map();
    for (const e of chosen.filter(x => x.section === 'journalPatterns')) {
      const k = e.id.replace(/:decided$/, '');
      jp.set(k, (jp.get(k) || false) || e.request.payload.includeDecided);
    }
    if (applying.has(job.id)) return reply.code(409).send({ error: 'A profile is being applied to this migration right now. Wait until it has finished, then look at the preview again.' });
    if (Number(req.body?.confirmCount) !== chosen.length) {
      return reply.code(409).send({ error: `${plural(chosen.length, 'entry', 'entries')} would be applied now, not ${req.body?.confirmCount ?? 'the number confirmed'}. Something changed since the preview. Check the new preview and confirm again.`,
        entries: entries.map(publicEntry), counts: planSummary(entries) });
    }
    const headers = { cookie: req.headers.cookie || '' };
    const send = async (method, url, payload) => {
      const r = await app.inject({ method, url, payload, headers });
      let body = null; try { body = r.json(); } catch { /* not JSON */ }
      return { status: r.statusCode, body };
    };
    const results = [];
    const doneJp = new Set();
    applying.add(job.id);
    try {
    for (const e of chosen) {
      let r;
      if (e.section === 'journalPatterns') {
        const k = e.id.replace(/:decided$/, '');
        if (doneJp.has(k)) { results.push({ id: e.id, section: e.section, what: e.what, ok: true, words: 'Applied together with the other part of this pattern.' }); continue; }
        doneJp.add(k);
        const payload = { ...e.request.payload, includeDecided: jp.get(k) };
        const pre = await send('POST', e.request.url, { ...payload, preview: true });
        if (pre.status !== 200) { results.push({ id: e.id, section: e.section, what: e.what, ok: false, error: pre.body?.error || `Refused (${pre.status}).` }); continue; }
        r = await send('POST', e.request.url, { ...payload, confirmCount: pre.body.counts.change });
        results.push({ id: e.id, section: e.section, what: e.what, ok: r.status === 200, error: r.status === 200 ? null : r.body?.error || `Refused (${r.status}).`,
          words: r.status === 200 ? `${plural(r.body.changed ?? 0, 'journal')} routed to ${payload.decision}${pre.body.counts.refused ? `; ${pre.body.counts.refused} refused (${payload.decision} is not allowed for them)` : ''}.` : null });
        continue;
      }
      r = await send(e.request.method, e.request.url, e.request.payload);
      results.push({ id: e.id, section: e.section, what: e.what, ok: r.status === 200, error: r.status === 200 ? null : r.body?.error || `Refused (${r.status}).` });
    }
    } finally { applying.delete(job.id); }
    const applied = results.filter(r => r.ok).length, refused = results.filter(r => !r.ok).length;
    const counts = planSummary(entries);
    const kept = entries.filter(e => e.status === 'conflict' && !replace.has(e.id)).length;
    const words = `Mapping profile "${p.name}" applied: ${applied} applied, ${refused} refused by the checks of the screen, ${kept} kept as decided here, ${counts.same} already the same, ${counts.noMatch} matched nothing in this migration.`
      + (refused ? ` Refused: ${results.filter(r => !r.ok).slice(0, 10).map(r => `${r.what} (${r.error})`).join('; ')}.` : '');
    audit(job.id, 'profile_applied', words, actor(req)); // named explicitly: other requests may have run while this one waited
    db.prepare('UPDATE mapping_profiles SET last_applied = ? WHERE id = ?').run(JSON.stringify({ migration: job.id, company: job.company, by: actor(req), at: now(), applied, refused }), p.id);
    return { applied, refused, kept, results, words, counts };
  });
}
