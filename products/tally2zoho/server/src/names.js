// Mapping Studio decisions on names and contacts. Stored apart from the Tally data (which is never changed), applied
// only to the Zoho files, audited with who, the old and the new value, and each change marks the files it affects
// out of date.
//
//  4. Names: pick and drop. Every name is written exactly as in Tally by default (names will be filled in from the GST
//     portal later), and a name with hidden characters is a warning, not a blocker. Every customer, vendor and Chart
//     of Accounts ledger whose name has hidden characters (line breaks, invisible characters, tabs, spaces at the start
//     or end) CAN be cleaned, one by one or all at once, for example when Zoho rejects it (opt-in). Possible
//     duplicates (names that are the same once cleaned and capital letters are ignored, or two contacts with the same
//     GSTIN) are listed with their facts, and decided: "keep both" (with a different name where the names would be the
//     same in Zoho) or "treat as one" (one contact or account is written, with the other's opening balance added, and
//     the vouchers of both name it). Every Zoho file writes names through ONE resolver (makeNameResolver in
//     namefix.js, ctx.outputName), so the same ledger has the same name everywhere.
//  5. Fix contacts: per customer or vendor, a GSTIN, a state, or a GST treatment ("treat as unregistered"; "registered"
//     when Tally's type is unknown) for the Customers and Vendors files only; bulk actions for the common cases.

import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { tallyText, money, nameKey, GSTIN_FORMAT } from './tally.js';
import { contactInfo } from './masters.js';
import { voucherLines } from './vouchers.js';
import { contactChecks, gstTreatment, placeOfContact, panOf, panFromGstin } from './zoho.js';
import { STATE_CODES, gstinStateCode, builtinAccount, gstCodeSet, gstTreatmentLabel } from './zohocodes.js';
import { cleanName, needsCleaning, hiddenParts, visibleName, applyContactFixes } from './namefix.js';

const MAX_NAME = 100;
const MAX_REASON = 200;
const SECTIONS = ['customers', 'vendors', 'accounts'];
const SECTION_WORDS = { customers: 'customer', vendors: 'vendor', accounts: 'account' };
// The files a name decision changes, per section: the master file and every voucher file that can name the ledger.
const NAME_FILES = {
  customers: ['customers', 'invoices', 'journals', 'other_journals'],
  vendors: ['vendors', 'bills', 'journals', 'other_journals'],
  accounts: ['accounts', 'opening_balances_for_zoho_accounts', 'invoices', 'bills', 'journals', 'other_journals'],
};
const filesFor = sections => [...new Set(sections.flatMap(s => NAME_FILES[s] || []))];
const sideOf = a => (a.isNegative() ? 'Debit' : 'Credit');
const balanceOf = a => (a && !a.isZero() ? { amount: a.abs().toFixed(2), side: sideOf(a) } : null);
const balanceWords = a => (a && !a.isZero() ? `${a.abs().toFixed(2)} ${sideOf(a)}` : '0.00');

// Fix contacts: the problems a row can be filtered by, in the order shown.
export const CONTACT_PROBLEMS = [
  { id: 'registered_without_gstin', words: 'Registered under GST, but no GSTIN', kinds: ['gst_registered_without_gstin'] },
  { id: 'gstin_format', words: 'GSTIN does not have the right format', kinds: ['gstin_format'] },
  { id: 'gstin_check_digit', words: 'GSTIN check character is wrong (not a real GSTIN)', kinds: ['gstin_check_digit_invalid'] },
  { id: 'state_missing', words: 'No state, place of contact or source of supply', kinds: ['place_of_contact_missing', 'state_not_mapped'] },
  { id: 'place_differs', words: 'Place differs from the state of the GSTIN', kinds: ['place_differs_from_gstin'] },
  { id: 'registration_unknown', words: 'GST registration unknown or not set', kinds: ['gst_registration_unknown', 'gst_treatment_not_set'] },
  { id: 'treatment_other', words: 'Other GST treatment left empty', kinds: ['gst_treatment_ambiguous', 'gst_treatment_not_mapped', 'gst_unregistered_with_gstin'] },
];
export const TREATMENTS = ['unregistered', 'regular', 'composition'];
// v2: the defaults the tool applies to a contact with no correction (flag kinds of contactChecks in zoho.js).
export const CONTACT_ASSUMPTIONS = [
  { id: 'gst_registered_from_gstin', words: 'Written as registered because it has a valid GSTIN (Tally says otherwise)' },
  { id: 'state_from_gstin', words: 'State taken from the GSTIN (Tally has none)' },
  { id: 'pan_from_gstin', words: 'PAN taken from the GSTIN (Tally has none)' },
];
// v2: two contacts of the same kind written with the same GSTIN: one of the GSTINs is usually wrong (Fix contacts)
export const SAME_GSTIN_PROBLEM = { id: 'same_gstin', words: 'Same GSTIN as another contact' };
const PAN_FORMAT_FIX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

// Every ledger that has a name decision or belongs to a decided group of possible duplicates (for the test report,
// which no longer lists the processing flags about those names as still to do).
export function decidedLedgerNames(db, jobId) {
  const out = new Set(db.prepare('SELECT ledger FROM name_decisions WHERE job_id = ?').all(jobId).map(r => r.ledger));
  for (const r of db.prepare('SELECT members FROM duplicate_decisions WHERE job_id = ?').all(jobId)) {
    try { for (const m of JSON.parse(r.members || '[]')) out.add(m); } catch { /* none */ }
  }
  return out;
}

export function registerNames(app, { db, need, audit, now, tx, markStale, chartLedgers, context }) {
  const actor = req => req.user?.email || 'system';

  // Customers, vendors and Chart of Accounts ledgers (the ones the Chart of Accounts file would write), each with its
  // Tally record. A ledger can be in more than one section (a party uploaded as both customer and vendor).
  const records = jobId => {
    const out = [];
    for (const s of ['customers', 'vendors']) {
      for (const r of db.prepare("SELECT name, source_id, data FROM source_records WHERE job_id = ? AND slot = ? AND object_type = 'Ledger' ORDER BY id").all(jobId, s)) {
        if (r.name) out.push({ section: s, name: r.name, d: JSON.parse(r.data) });
      }
    }
    for (const r of chartLedgers(jobId)) if (r.name) out.push({ section: 'accounts', name: r.name, d: JSON.parse(r.data) });
    return out;
  };

  // How many vouchers name each ledger (on a line or as the party), matched as the files match them.
  const voucherUse = (jobId, ctx) => {
    const counts = new Map();
    for (const r of db.prepare("SELECT data FROM source_records WHERE job_id = ? AND object_type = 'Voucher'").all(jobId)) {
      let v; try { v = JSON.parse(r.data); } catch { continue; }
      const seen = new Set();
      for (const l of voucherLines(v)) { const m = ctx.outputName.masterOf(l.ledger); if (m) seen.add(m); }
      if (v.partyledgername) { const m = ctx.outputName.masterOf(tallyText(v.partyledgername)); if (m) seen.add(m); }
      for (const m of seen) counts.set(m, (counts.get(m) || 0) + 1);
    }
    return counts;
  };

  // The GSTIN of a contact as written (after Fix contacts), when it has the format of a GSTIN.
  const writtenGstin = (name, d, ctx) => {
    const c = applyContactFixes(contactInfo(d, ctx.asOf), ctx.contactFixes?.[name]);
    return c.gstin && GSTIN_FORMAT.test(c.gstin) ? c.gstin : '';
  };

  // ---------- possible duplicates ----------
  const groupKey = (section, names) => `${section}:${createHash('sha1').update([...names].sort().join('\u0001')).digest('hex').slice(0, 16)}`;
  const duplicateGroups = (jobId, ctx, recs) => {
    const groups = [];
    for (const section of SECTIONS) {
      const list = recs.filter(r => r.section === section);
      const parent = list.map((_, i) => i);
      const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
      const join = (a, b) => { parent[find(a)] = find(b); };
      const byName = new Map(), byGstin = new Map();
      const why = list.map(() => new Set());
      list.forEach((r, i) => {
        const k = nameKey(r.name);
        if (byName.has(k)) { join(i, byName.get(k)); why[i].add('name'); why[byName.get(k)].add('name'); } else byName.set(k, i);
        if (section === 'accounts') return;
        const g = writtenGstin(r.name, r.d, ctx);
        if (!g) return;
        if (byGstin.has(g)) { join(i, byGstin.get(g)); why[i].add('gstin'); why[byGstin.get(g)].add('gstin'); } else byGstin.set(g, i);
      });
      const sets = new Map();
      list.forEach((r, i) => { const root = find(i); if (!sets.has(root)) sets.set(root, []); sets.get(root).push(i); });
      for (const idx of sets.values()) {
        if (idx.length < 2) continue;
        const members = idx.map(i => list[i]);
        const reasons = new Set(idx.flatMap(i => [...why[i]]));
        groups.push({ key: groupKey(section, members.map(m => m.name)), section, members, sameName: reasons.has('name'), sameGstin: reasons.has('gstin') });
      }
    }
    return groups;
  };

  const namesView = jobId => {
    const ctx = context(jobId);
    const recs = records(jobId);
    const use = voucherUse(jobId, ctx);
    // dec: what a person decided (shown as decided). eff: what the files are built with, which also holds the tool's
    // defaults (byDefault: a contact with the same name as another treated as one party; a name cleaned for Zoho).
    const dec = ctx.explicit?.nameDecisions || ctx.nameDecisions;
    const eff = ctx.nameDecisions || {};
    // names with hidden characters, one row per ledger
    const byLedger = new Map();
    for (const r of recs) {
      if (!needsCleaning(r.name)) continue;
      if (!byLedger.has(r.name)) byLedger.set(r.name, { ledger: r.name, sections: [] });
      byLedger.get(r.name).sections.push(r.section);
    }
    const names = [...byLedger.values()].map(x => {
      const d = dec[x.ledger];
      return {
        ledger: x.ledger, sections: x.sections.map(s => SECTION_WORDS[s]), before: visibleName(x.ledger), after: cleanName(x.ledger), hidden: hiddenParts(x.ledger),
        decision: d?.action || null, decidedBy: d?.by || null, decidedAt: d?.at || null, written: visibleName(ctx.outputName(x.ledger)),
        // the tool's default for this name when no decision is made: 'clean' (the name breaks a Zoho rule), 'merge'
        // (the same name as another contact: one party), or null (written as in Tally)
        byDefault: !d && eff[x.ledger]?.byDefault ? eff[x.ledger].action : null,
        // decided as part of a group of possible duplicates: changed there, not here
        partOfDuplicate: d?.action === 'merge' || d?.action === 'rename',
        vouchers: use.get(x.ledger) || 0,
        // written under its own name in some file: not when it is treated as one party with another (merged: the kept
        // contact's name is written) or entered on one of Zoho's own accounts (audit item 8: only written names count)
        writtenOnItsOwn: eff[x.ledger]?.action !== 'merge' && ctx.clashDecisions?.[x.ledger]?.decision !== 'zoho',
      };
    });
    const writtenNames = names.filter(n => n.writtenOnItsOwn);
    const groupRows = db.prepare('SELECT * FROM duplicate_decisions WHERE job_id = ?').all(jobId);
    // "Accept as per Tally" on Possible duplicates: the defaults stand and the groups count as decided
    const accepted = (() => { try { return !!db.prepare("SELECT 1 FROM step_reviews WHERE job_id = ? AND step = 'duplicates'").get(jobId); } catch { return false; } })();
    const stored = Object.fromEntries(groupRows.map(r => [r.group_key, r]));
    const groups = duplicateGroups(jobId, ctx, recs).map(g => {
      const s = stored[g.key];
      const members = g.members.map(m => {
        const ob = money(m.d?.openingbalance);
        return {
          ledger: m.name, visible: visibleName(m.name), group: tallyText(m.d?.parent) || null,
          gstin: g.section === 'accounts' ? null : contactInfo(m.d, ctx.asOf).gstin || null,
          openingBalance: balanceOf(ob), vouchers: use.get(m.name) || 0,
          written: visibleName(ctx.outputName(m.name)), decision: dec[m.name]?.action || null, newName: dec[m.name]?.action === 'rename' ? dec[m.name].newName : '',
          mergedByDefault: eff[m.name]?.byDefault && eff[m.name].action === 'merge' ? eff[m.name].mergeInto : null,
          hasHiddenCharacters: needsCleaning(m.name), clashDecision: ctx.clashDecisions?.[m.name]?.decision || null,
        };
      });
      // v2 default 6: with no decision, contacts of this group with the same name are written as one party
      const defaultKept = !s ? [...new Set(members.map(m => m.mergedByDefault).filter(Boolean))] : [];
      const total = g.members.reduce((t, m) => t.plus(money(m.d?.openingbalance) || 0), new Decimal(0));
      let addition = null;
      if (s?.decision === 'merge') {
        const kept = g.members.find(m => m.name === s.kept);
        const others = g.members.filter(m => m.name !== s.kept);
        addition = `"${visibleName(s.kept)}" ${balanceWords(money(kept?.d?.openingbalance))}${others.map(o => ` + "${visibleName(o.name)}" ${balanceWords(money(o.d?.openingbalance))}`).join('')} = ${balanceWords(total)}`;
      }
      // Pick and drop: the names are compared as WRITTEN (as in Tally unless the accountant cleaned or renamed one).
      // sameWrittenName: two members would reach Zoho with the same name (capital letters ignored), which Zoho does not
      // accept: blocking. Otherwise a group that is the same only once cleaned is a warning, with nothing to decide
      // unless the contacts also share a GSTIN.
      // (a member treated as one party with another is not written on its own, so it cannot collide)
      const written = g.members.filter(m => eff[m.name]?.action !== 'merge').map(m => String(ctx.outputName(m.name) ?? '').toLowerCase());
      const sameWrittenName = new Set(written).size < written.length;
      // v2: one state per group, the same words everywhere. decided: a person decided; needs_decision: no decision and
      // the names would reach Zoho the same (Zoho refuses the second row: the default cannot help); accepted: the step
      // was accepted as per Tally; default: the tool's default applies (one party, or kept apart)
      const defaultDecision = s ? null : defaultKept.length ? 'merge' : 'keep_both';
      const status = s ? 'decided' : sameWrittenName ? 'needs_decision' : accepted ? 'accepted' : 'default';
      const defaultWords = defaultDecision === 'merge' ? `Default: treated as one ${SECTION_WORDS[g.section] === 'account' ? 'account' : 'party'}, "${visibleName(defaultKept[0])}" written`
        : defaultDecision === 'keep_both' ? 'Default: kept apart, written as in Tally' : null;
      return {
        status, defaultWords,
        key: g.key, section: SECTION_WORDS[g.section], sameName: g.sameName, sameGstin: g.sameGstin, sameWrittenName,
        // defaultDecision: what the files do while the group is not decided: 'merge' (same name: one party, keeping
        // defaultKept) or 'keep_both' (the same GSTIN under different names: kept apart)
        defaultDecision, defaultKept: defaultKept[0] || null,
        needsDecision: sameWrittenName || g.sameGstin, members,
        combinedBalance: balanceOf(total), decision: s?.decision || null, kept: s?.kept || null, decidedBy: s?.decided_by || null, decidedAt: s?.at || null, addition,
      };
    });
    // decisions stored for a group that is no longer in the data (the files were uploaded again with other names)
    const current = new Set(groups.map(g => g.key));
    const orphaned = groupRows.filter(r => !current.has(r.group_key)).map(r => ({ key: r.group_key, section: SECTION_WORDS[r.section] || r.section, decision: r.decision,
      members: (() => { try { return JSON.parse(r.members || '[]').map(visibleName); } catch { return []; } })() }));
    return {
      names, duplicates: groups, orphanedDuplicateDecisions: orphaned,
      counts: {
        // cleaned: by a person; cleanedByDefault: by the tool (the name breaks a Zoho rule); notCleaned (= asInTally):
        // written exactly as in Tally (a warning, not a blocker); cleaning is optional
        // counted over the names WRITTEN to a file (a contact merged into another, or a ledger on Zoho's own account, is
        // not written under its own name: notWritten)
        names: writtenNames.length, cleaned: writtenNames.filter(n => n.decision).length, cleanedByDefault: writtenNames.filter(n => !n.decision && n.byDefault === 'clean').length,
        notCleaned: writtenNames.filter(n => !n.decision && n.byDefault !== 'clean').length, asInTally: writtenNames.filter(n => !n.decision && n.byDefault !== 'clean').length,
        notWritten: names.length - writtenNames.length,
        duplicates: groups.length, duplicatesDecided: groups.filter(g => g.decision).length,
        // v2: open = still to decide = no decision and the default cannot help (the names would reach Zoho the same).
        // A group on the tool's default (one party, or kept apart) or accepted as per Tally counts as decided.
        duplicatesUndecided: groups.filter(g => g.status === 'needs_decision').length,
        duplicatesOnDefault: groups.filter(g => g.status === 'default' || g.status === 'accepted').length,
        duplicatesAccepted: groups.filter(g => g.status === 'accepted').length,
        duplicatesBlocking: groups.filter(g => !g.decision && g.sameWrittenName).length,
        // undecided groups whose names are the same only once cleaned: a warning, nothing to decide
        duplicatesOnlyOnceCleaned: groups.filter(g => !g.decision && !g.needsDecision).length,
        // undecided groups written as one party by the tool's default (v2)
        duplicatesMergedByDefault: groups.filter(g => g.defaultDecision === 'merge').length,
      },
    };
  };

  const sectionsOf = (jobId, ledger) => [...new Set(records(jobId).filter(r => r.name === ledger).map(r => r.section))];

  // ---------- 4a. cleaning names ----------
  app.get('/api/migrations/:id/names', (req, reply) => { const job = need(req, reply); if (!job) return; return namesView(job.id); });
  // { ledger, clean: true | false }
  app.put('/api/migrations/:id/names', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const ledger = String(req.body?.ledger ?? '');
    const clean = req.body?.clean === true;
    const view = namesView(job.id);
    const row = view.names.find(n => n.ledger === ledger);
    if (!row) return reply.code(404).send({ error: 'That name is not in the list of names with hidden characters.' });
    if (row.partOfDuplicate) return reply.code(409).send({ error: 'This name was decided as part of a possible duplicate. Change it there.' });
    if (clean && !row.after) return reply.code(400).send({ error: 'This name is made only of hidden characters, so nothing is left once it is cleaned. Correct it in Tally.' });
    if (clean === (row.decision === 'clean')) return { ...view, changed: 0 };
    const sections = sectionsOf(job.id, ledger);
    tx(() => {
      if (clean) {
        db.prepare('INSERT OR REPLACE INTO name_decisions (job_id, ledger, action, new_name, merge_into, group_key, section, decided_by, at) VALUES (?,?,?,?,?,?,?,?,?)')
          .run(job.id, ledger, 'clean', row.after, null, null, sections[0] || null, actor(req), now());
      } else db.prepare('DELETE FROM name_decisions WHERE job_id = ? AND ledger = ?').run(job.id, ledger);
      audit(job.id, 'name_cleaned', clean
        ? `Name "${row.before}" (${row.sections.join(', ')}) is written as "${row.after}" in the Zoho files.`
        : `Name "${row.before}" (${row.sections.join(', ')}): cleaning removed, written as in Tally again (it was "${row.after}").`);
      markStale(job.id, clean ? `The name "${row.before}" was cleaned for the Zoho files.` : `Cleaning of the name "${row.before}" was removed.`, filesFor(sections));
    });
    return { ...namesView(job.id), changed: 1 };
  });
  // Cleans every listed name that has no decision yet.
  app.post('/api/migrations/:id/names/clean-all', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const view = namesView(job.id);
    const todo = view.names.filter(n => !n.decision && n.after);
    if (!todo.length) return { ...view, changed: 0 };
    const recs = records(job.id);
    const sections = new Set();
    tx(() => {
      for (const n of todo) {
        const s = [...new Set(recs.filter(r => r.name === n.ledger).map(r => r.section))];
        s.forEach(x => sections.add(x));
        db.prepare('INSERT OR REPLACE INTO name_decisions (job_id, ledger, action, new_name, merge_into, group_key, section, decided_by, at) VALUES (?,?,?,?,?,?,?,?,?)')
          .run(job.id, n.ledger, 'clean', n.after, null, null, s[0] || null, actor(req), now());
        audit(job.id, 'name_cleaned', `Name "${n.before}" (${n.sections.join(', ')}) is written as "${n.after}" in the Zoho files (clean all).`);
      }
      markStale(job.id, `${todo.length} name(s) with hidden characters were cleaned for the Zoho files (clean all).`, filesFor([...sections]));
    });
    return { ...namesView(job.id), changed: todo.length };
  });

  // ---------- 4b. possible duplicates ----------
  const checkNewName = (n, section) => {
    const v = String(n ?? '').trim();
    if (!v) return { error: 'Type the new name.' };
    if (v.length > MAX_NAME || needsCleaning(v) || /[\u0000-\u001f\u007f​﻿]/.test(v)) return { error: `The new name "${visibleName(v)}" is too long or has hidden characters. Use ${MAX_NAME} characters or fewer.` };
    if (section === 'accounts' && builtinAccount(v)) return { error: `"${v}" is the name of an account Zoho Books creates itself. Choose another name.` };
    return { value: v };
  };
  // { key, decision: 'keep_both' | 'merge' | null, keep (merge: the ledger written), names: { ledger: new name } (keep_both) }
  app.put('/api/migrations/:id/duplicates', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const key = String(req.body?.key ?? '');
    const decision = req.body?.decision ?? null;
    const ctx = context(job.id);
    const recs = records(job.id);
    const group = duplicateGroups(job.id, ctx, recs).find(g => g.key === key);
    const storedRow = db.prepare('SELECT * FROM duplicate_decisions WHERE job_id = ? AND group_key = ?').get(job.id, key);
    if (!group && !(storedRow && decision === null)) return reply.code(404).send({ error: 'That group of possible duplicates is not in the data any more. Open the list again.' });
    if (decision !== null && !['keep_both', 'merge'].includes(decision)) return reply.code(400).send({ error: 'Choose "keep both" or "treat as one".' });
    const section = group?.section || storedRow.section;
    const memberNames = group ? group.members.map(m => m.name) : JSON.parse(storedRow.members || '[]');
    const label = memberNames.map(n => `"${visibleName(n)}"`).join(' and ');
    const inserts = [];
    let words = '';
    if (decision === 'merge') {
      const keep = String(req.body?.keep ?? '');
      if (!memberNames.includes(keep)) return reply.code(400).send({ error: 'Choose which of the ledgers is written (the one the others are added to).' });
      const others = memberNames.filter(n => n !== keep);
      if (section === 'accounts') {
        const clash = others.find(n => ctx.clashDecisions?.[n]?.decision);
        if (clash) return reply.code(409).send({ error: `"${visibleName(clash)}" has a decision under Zoho's own accounts. Remove that decision first, or keep this ledger as the one written.` });
      }
      for (const o of others) inserts.push({ ledger: o, action: 'merge', mergeInto: keep, newName: null });
      const total = group.members.reduce((t, m) => t.plus(money(m.d?.openingbalance) || 0), new Decimal(0));
      words = `treat as one ${SECTION_WORDS[section]}: "${visibleName(keep)}" is written, ${others.map(o => `"${visibleName(o)}"`).join(' and ')} added to it (opening balances: ${group.members.map(m => `"${visibleName(m.name)}" ${balanceWords(money(m.d?.openingbalance))}`).join(' + ')} = ${balanceWords(total)})`;
    } else if (decision === 'keep_both') {
      const typed = req.body?.names && typeof req.body.names === 'object' ? req.body.names : {};
      const written = {};
      for (const m of memberNames) {
        const t = typed[m];
        if (t != null && String(t).trim() !== '') {
          const c = checkNewName(t, section); if (c.error) return reply.code(400).send({ error: c.error });
          written[m] = c.value;
          inserts.push({ ledger: m, action: 'rename', newName: c.value, mergeInto: null });
        } else {
          // without a new name: the name as written without this group's decision (a cleaned name, or as in Tally).
          // Only what a person decided counts here: the default (same name: one party) stops applying once the
          // group is decided.
          const d = (ctx.explicit?.nameDecisions || ctx.nameDecisions)?.[m];
          written[m] = d?.action === 'clean' ? d.newName : m;
        }
      }
      // Pick and drop: names are compared as written. Names that differ only by a line break or spaces are written
      // differently (as in Tally), so they can be kept apart without a new name; two written the same cannot.
      const keys = memberNames.map(m => String(written[m]).toLowerCase());
      if (new Set(keys).size !== keys.length) {
        return reply.code(400).send({ error: `${label} would still be written with the same name in Zoho (capital letters ignored). Type a different name for ${memberNames.length === 2 ? 'one of them' : 'all but one of them'}.` });
      }
      // a new name must not be the name of another ledger of the same kind
      const others = recs.filter(r => r.section === section && !memberNames.includes(r.name)).map(r => nameKey(ctx.outputName(r.name)));
      for (const [m, n] of Object.entries(written)) {
        if (typed[m] && others.includes(nameKey(n))) return reply.code(400).send({ error: `Another ${SECTION_WORDS[section]} is already written as "${n}". Choose another name.` });
      }
      words = `keep both: ${memberNames.map(m => `"${visibleName(m)}" written as "${visibleName(written[m])}"`).join(', ')}`;
    }
    const before = storedRow ? `${storedRow.decision === 'merge' ? `treat as one, "${visibleName(storedRow.kept)}" written` : 'keep both'}` : 'not decided';
    const after = decision ? words : 'not decided';
    tx(() => {
      db.prepare('DELETE FROM name_decisions WHERE job_id = ? AND group_key = ?').run(job.id, key);
      db.prepare('DELETE FROM duplicate_decisions WHERE job_id = ? AND group_key = ?').run(job.id, key);
      if (decision) {
        for (const i of inserts) {
          db.prepare('INSERT OR REPLACE INTO name_decisions (job_id, ledger, action, new_name, merge_into, group_key, section, decided_by, at) VALUES (?,?,?,?,?,?,?,?,?)')
            .run(job.id, i.ledger, i.action, i.newName, i.mergeInto, key, section, actor(req), now());
        }
        db.prepare('INSERT INTO duplicate_decisions (job_id, group_key, section, decision, kept, members, decided_by, at) VALUES (?,?,?,?,?,?,?,?)')
          .run(job.id, key, section, decision, decision === 'merge' ? String(req.body.keep) : null, JSON.stringify(memberNames), actor(req), now());
      }
      audit(job.id, 'duplicate_decided', `Possible duplicate ${SECTION_WORDS[section]}s ${label}: ${before} -> ${after}`);
      markStale(job.id, `The decision on the possible duplicate ${SECTION_WORDS[section]}s ${label} was changed.`, filesFor([section]));
    });
    return { ...namesView(job.id), changed: true };
  });

  // ================= 5. Fix contacts =================
  const contactRows = jobId => {
    const ctx = context(jobId);
    const recs = records(jobId).filter(r => r.section !== 'accounts' && !(ctx.nameDecisions?.[r.name]?.action === 'merge'));
    const set = gstCodeSet(ctx.gstCodes);
    const rows = recs.map(r => {
      const who = r.section === 'customers' ? 'customer' : 'vendor';
      const tally = contactInfo(r.d, ctx.asOf);
      const fix = ctx.contactFixes?.[r.name] || null;
      const c = applyContactFixes(tally, fix);
      const treatment = gstTreatment(c, ctx.gstCodes, ctx.gstUnregisteredConsumerAs);
      const place = placeOfContact(c, treatment.value);
      const kinds = new Set(contactChecks(r.d, ctx, who).map(x => x.kind));
      const problems = CONTACT_PROBLEMS.filter(p => p.kinds.some(k => kinds.has(k))).map(p => p.id);
      const validGstin = c.gstin && GSTIN_FORMAT.test(c.gstin) ? c.gstin : '';
      // v2: the tool's defaults applied to this contact (no correction stored): written as registered because it has a
      // valid GSTIN; the state taken from the GSTIN. They are not problems: the row is listed so they can be changed.
      const assumptions = CONTACT_ASSUMPTIONS.filter(a => kinds.has(a.id)).map(a => a.id);
      const pan = panOf(c);
      return {
        ledger: r.name, visible: visibleName(r.name), section: who, problems, assumptions,
        tally: { gstin: tally.gstin, registrationType: tally.registrationType, state: tally.state, placeOfSupply: tally.placeOfSupply, country: tally.country, pan: tally.pan || '' },
        fix: fix ? { gstin: fix.gstin, state: fix.state, treatment: fix.treatment, pan: fix.pan || '', reason: fix.reason, by: fix.by, at: fix.at } : null,
        written: { gstTreatment: treatment.value, gstTreatmentLabel: gstTreatmentLabel(treatment.value), gstin: c.gstin, place: place.value, state: place.value, billingState: c.state || (place.assumed?.kind === 'state_from_gstin' ? STATE_CODES[place.value] || '' : '') },
        gstinState: validGstin ? gstinStateCode(validGstin) || null : null,
        pan: { tally: tally.pan || '', written: pan.value, fromGstin: panFromGstin(c.gstin), source: pan.source },
      };
    });
    // the same GSTIN written for two contacts of one kind (merged contacts are already left out)
    const byGstin = new Map();
    for (const row of rows) {
      if (!row.written.gstin) continue;
      const k = `${row.section}|${row.written.gstin.toUpperCase()}`;
      if (!byGstin.has(k)) byGstin.set(k, []);
      byGstin.get(k).push(row);
    }
    for (const list of byGstin.values()) {
      if (new Set(list.map(x => x.ledger)).size < 2) continue;
      for (const row of list) { row.sameGstin = list.filter(x => x !== row).map(x => x.visible); row.problems.push(SAME_GSTIN_PROBLEM.id); }
    }
    for (const row of rows) row.sameGstin ||= [];
    return rows;
  };
  const contactView = jobId => {
    const ctx = context(jobId);
    const all = contactRows(jobId);
    const rows = all.filter(r => r.problems.length || r.fix || r.assumptions.length);
    const set = gstCodeSet(ctx.gstCodes);
    return {
      rows,
      problems: [...CONTACT_PROBLEMS, SAME_GSTIN_PROBLEM].map(p => ({ id: p.id, words: p.words, remaining: all.filter(r => r.problems.includes(p.id)).length })),
      // the defaults applied (v2): how many contacts each applies to
      assumptions: CONTACT_ASSUMPTIONS.map(a => ({ id: a.id, words: a.words, count: all.filter(r => r.assumptions.includes(a.id)).length })),
      counts: { contacts: all.length, withProblems: all.filter(r => r.problems.length).length, corrected: all.filter(r => r.fix).length,
        withAssumptions: all.filter(r => r.assumptions.length).length,
        // counted per ledger, as the bulk actions apply them (a ledger can be both a customer and a vendor).
        // The state of the GSTIN is already written by default for these; the bulk action stores it as a correction.
        stateFromGstinPossible: new Set(all.filter(r => r.assumptions.includes('state_from_gstin') && r.gstinState && !r.fix?.state).map(r => r.ledger)).size,
        registeredWithoutGstin: new Set(all.filter(r => r.problems.includes('registered_without_gstin')).map(r => r.ledger)).size },
      states: Object.entries(STATE_CODES).map(([code, name]) => ({ code, name })),
      treatments: [
        { id: 'unregistered', label: 'Unregistered', code: set.codes.unregistered, words: 'Treat as unregistered (no GSTIN written)' },
        { id: 'regular', label: 'Registered (regular)', code: set.codes.regular, words: 'Treat as registered, regular scheme (needs a GSTIN)' },
        { id: 'composition', label: 'Registered (composition)', code: set.codes.composition, words: 'Treat as registered, composition scheme (needs a GSTIN)' },
      ],
      codeSet: set.label,
    };
  };

  const fixWords = f => [f.gstin ? `GSTIN ${f.gstin}` : '', f.state ? `state ${f.state}` : '', f.treatment ? `treated as ${f.treatment}` : '', f.pan ? `PAN ${f.pan}` : ''].filter(Boolean).join(', ') || 'no correction';
  // Checks a change for one contact. Returns { next } or { error }.
  const checkFix = (ledger, tally, current, patch) => {
    const next = { gstin: current?.gstin || '', state: current?.state || '', treatment: current?.treatment || '', pan: current?.pan || '' };
    if ('pan' in patch) {
      const p = String(patch.pan ?? '').replace(/\s+/g, '').toUpperCase();
      if (p && !PAN_FORMAT_FIX.test(p)) return { error: `"${p}" does not have the format of a PAN: 10 characters, 5 letters, 4 digits, 1 letter (for example ABCDE1234F).` };
      next.pan = p;
    }
    if ('treatment' in patch) {
      const t = String(patch.treatment ?? '').trim();
      if (t && !TREATMENTS.includes(t)) return { error: 'Choose a GST treatment from the list.' };
      next.treatment = t;
    }
    if ('gstin' in patch) {
      const g = String(patch.gstin ?? '').replace(/\s+/g, '').toUpperCase();
      if (g) {
        if (!GSTIN_FORMAT.test(g)) return { error: `"${g}" does not have the format of a GSTIN: 15 characters, 2 digits of the state, the PAN, then 3 more characters (for example 27ABCDE1234F1Z5).` };
        if (!gstinStateCode(g)) return { error: `The first two digits of "${g}" are not the code of a state in Zoho's list.` };
      }
      next.gstin = g;
    }
    if ('state' in patch) {
      const s = String(patch.state ?? '').trim().toUpperCase();
      if (s && !STATE_CODES[s]) return { error: 'Choose a state from the list.' };
      next.state = s;
    }
    if (next.treatment === 'unregistered' && next.gstin) return { error: `"${visibleName(ledger)}" is set to be treated as unregistered, so no GSTIN is written. Remove that choice first, or leave the GSTIN empty.` };
    const effective = next.treatment === 'unregistered' ? '' : next.gstin || (tally.gstin && GSTIN_FORMAT.test(tally.gstin) ? tally.gstin : '');
    if ((next.treatment === 'regular' || next.treatment === 'composition') && !effective) return { error: 'A registered party needs a GSTIN. Type the GSTIN first.' };
    if (next.state && effective && gstinStateCode(effective) && gstinStateCode(effective) !== next.state) {
      return { error: `The GSTIN ${effective} is registered in ${STATE_CODES[gstinStateCode(effective)]} (${gstinStateCode(effective)}), not in ${STATE_CODES[next.state]} (${next.state}). Choose ${gstinStateCode(effective)}, or correct the GSTIN first.` };
    }
    // the PAN is characters 3 to 12 of the GSTIN: a PAN that is not the one in the GSTIN written is refused
    if (next.pan && effective && panFromGstin(effective) && panFromGstin(effective) !== next.pan) {
      return { error: `The PAN in the GSTIN ${effective} is ${panFromGstin(effective)}, not ${next.pan}. Correct the GSTIN or the PAN so they agree.` };
    }
    return { next };
  };
  // Stores corrections for several contacts in one transaction. entries: [{ ledger, next, reason }]. how: words for the audit.
  const storeFixes = (req, job, entries, how) => {
    const ctx = context(job.id);
    const changed = entries.filter(e => fixWords(e.next) !== fixWords(ctx.contactFixes?.[e.ledger] || {}));
    if (!changed.length) return 0;
    const recs = records(job.id);
    const sections = new Set();
    tx(() => {
      for (const e of changed) {
        recs.filter(r => r.name === e.ledger && r.section !== 'accounts').forEach(r => sections.add(r.section));
        const before = fixWords(ctx.contactFixes?.[e.ledger] || {});
        if (!e.next.gstin && !e.next.state && !e.next.treatment && !e.next.pan) db.prepare('DELETE FROM contact_fixes WHERE job_id = ? AND ledger = ?').run(job.id, e.ledger);
        else {
          db.prepare('INSERT OR REPLACE INTO contact_fixes (job_id, ledger, gstin, state, treatment, pan, reason, decided_by, at) VALUES (?,?,?,?,?,?,?,?,?)')
            .run(job.id, e.ledger, e.next.gstin || null, e.next.state || null, e.next.treatment || null, e.next.pan || null, e.reason, actor(req), now());
        }
        audit(job.id, 'contact_fixed', `Contact "${visibleName(e.ledger)}" (${how}): ${before} -> ${fixWords(e.next)}. Reason: ${e.reason}`);
      }
      // The Invoices and Bills files write the contact's GST Treatment, GSTIN and place of supply as corrected, so they
      // are out of date too: customers -> Customers and Invoices, vendors -> Vendors and Bills.
      // One out-of-date reason per contact, and none when the net change is zero: the reason remembers (in its kind)
      // the correction the files were built with, so a change undone leaves the files up to date.
      const of = { customers: ['customers', 'invoices'], vendors: ['vendors', 'bills'] };
      const still = [];
      for (const e of changed) {
        const prefix = `contact|${e.ledger}|`;
        const old = db.prepare('SELECT kind FROM stale_reasons WHERE job_id = ? AND substr(kind, 1, ?) = ?').get(job.id, prefix.length, prefix);
        const built = old ? old.kind.slice(prefix.length) : fixWords(ctx.contactFixes?.[e.ledger] || {});
        db.prepare('DELETE FROM stale_reasons WHERE job_id = ? AND substr(kind, 1, ?) = ?').run(job.id, prefix.length, prefix);
        if (fixWords(e.next) !== built) still.push({ ...e, kind: `${prefix}${built}` });
      }
      const filesOf = ledger => {
        const s = [...new Set(recs.filter(r => r.name === ledger && r.section !== 'accounts').map(r => r.section))];
        return (s.length ? s : ['customers', 'vendors']).flatMap(x => of[x] || [x]);
      };
      for (const e of still) markStale(job.id, `The details of contact "${visibleName(e.ledger)}" were corrected (${how}).`, filesOf(e.ledger), e.kind);
    });
    return changed.length;
  };
  const reasonOf = (req, fallback) => {
    const r = String(req.body?.reason ?? '').trim();
    if (r.length > MAX_REASON || /[\u0000-\u001f\u007f]/.test(r)) return { error: `The reason is too long or has hidden characters. Use ${MAX_REASON} characters or fewer.` };
    return { value: r || fallback };
  };

  app.get('/api/migrations/:id/contact-fixes', (req, reply) => { const job = need(req, reply); if (!job) return; return contactView(job.id); });
  // One contact: { ledger, gstin?, state?, treatment?, reason? }. A field left out is not changed; '' clears it.
  app.put('/api/migrations/:id/contact-fixes', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const ledger = String(req.body?.ledger ?? '');
    const rec = records(job.id).find(r => r.name === ledger && r.section !== 'accounts');
    if (!rec) return reply.code(404).send({ error: 'That customer or vendor is not in the uploaded data.' });
    const ctx = context(job.id);
    const patch = Object.fromEntries(['gstin', 'state', 'treatment', 'pan'].filter(f => req.body && f in req.body).map(f => [f, req.body[f]]));
    const c = checkFix(ledger, contactInfo(rec.d, ctx.asOf), ctx.contactFixes?.[ledger], patch);
    if (c.error) return reply.code(400).send({ error: c.error });
    const words = [patch.gstin ? 'GSTIN entered' : '', patch.state ? 'state chosen' : '', patch.treatment ? `treated as ${patch.treatment}` : '', patch.pan ? 'PAN entered' : ''].filter(Boolean).join(', ') || 'correction removed';
    const reason = reasonOf(req, `${words} in Fix contacts`);
    if (reason.error) return reply.code(400).send({ error: reason.error });
    const changed = storeFixes(req, job, [{ ledger, next: c.next, reason: reason.value }], 'Fix contacts');
    return { ...contactView(job.id), changed };
  });
  // Several contacts in one request (the screen saves each field as it is changed, and can save every open change at
  // once): { fixes: [{ ledger, gstin?, state?, treatment?, reason? }] }. For each contact only the fields sent are
  // changed ('' clears one); the other fields, and every other contact, keep what is stored. Nothing is stored unless
  // every entry is accepted: a refused entry is returned in errors with its ledger and the reason.
  app.patch('/api/migrations/:id/contact-fixes', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const list = Array.isArray(req.body?.fixes) ? req.body.fixes : null;
    if (!list || !list.length) return reply.code(400).send({ error: 'Send the changes as a list of { ledger, gstin, state, treatment }.' });
    if (list.length > 2000) return reply.code(400).send({ error: 'Too many changes in one request. Send 2000 or fewer.' });
    const ctx = context(job.id);
    const recs = records(job.id).filter(r => r.section !== 'accounts');
    const entries = [], errors = [], seen = new Set();
    for (const item of list) {
      const ledger = String(item?.ledger ?? '');
      const rec = recs.find(r => r.name === ledger);
      if (!rec) { errors.push({ ledger, error: 'That customer or vendor is not in the uploaded data.' }); continue; }
      if (seen.has(ledger)) { errors.push({ ledger, error: 'The same contact is in the list twice.' }); continue; }
      seen.add(ledger);
      const patch = Object.fromEntries(['gstin', 'state', 'treatment', 'pan'].filter(f => item && f in item).map(f => [f, item[f]]));
      const c = checkFix(ledger, contactInfo(rec.d, ctx.asOf), ctx.contactFixes?.[ledger], patch);
      if (c.error) { errors.push({ ledger, error: c.error }); continue; }
      const words = [patch.gstin ? 'GSTIN entered' : '', patch.state ? 'state chosen' : '', patch.treatment ? `treated as ${patch.treatment}` : '', patch.pan ? 'PAN entered' : ''].filter(Boolean).join(', ') || 'correction changed';
      const r = String(item?.reason ?? '').trim();
      if (r.length > MAX_REASON || /[\u0000-\u001f\u007f]/.test(r)) { errors.push({ ledger, error: `The reason is too long or has hidden characters. Use ${MAX_REASON} characters or fewer.` }); continue; }
      entries.push({ ledger, next: c.next, reason: r || ctx.contactFixes?.[ledger]?.reason || `${words} in Fix contacts` });
    }
    if (errors.length) return reply.code(400).send({ error: errors.length === 1 ? errors[0].error : `${errors.length} changes cannot be saved. Nothing was changed. The first: ${errors[0].error}`, errors });
    const changed = storeFixes(req, job, entries, 'Fix contacts');
    return { ...contactView(job.id), changed };
  });
  // Every contact with no state in Tally (and none chosen) gets the state of its GSTIN.
  app.post('/api/migrations/:id/contact-fixes/state-from-gstin', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const ctx = context(job.id);
    const rows = contactRows(job.id).filter(r => r.assumptions.includes('state_from_gstin') && r.gstinState && !r.fix?.state);
    const reason = reasonOf(req, 'No state in Tally: the state of the GSTIN is used (bulk action)');
    if (reason.error) return reply.code(400).send({ error: reason.error });
    const entries = [...new Map(rows.map(r => [r.ledger, r])).values()].map(r => ({ ledger: r.ledger, next: { ...(ctx.contactFixes?.[r.ledger] || {}), gstin: ctx.contactFixes?.[r.ledger]?.gstin || '', treatment: ctx.contactFixes?.[r.ledger]?.treatment || '', state: r.gstinState }, reason: reason.value }));
    const changed = storeFixes(req, job, entries, "use the GSTIN's state where the state is missing");
    return { ...contactView(job.id), changed };
  });
  // Every contact registered in Tally without a GSTIN is treated as unregistered. { confirmCount }: the number the
  // user confirmed; refused when the list has changed since.
  app.post('/api/migrations/:id/contact-fixes/unregistered-without-gstin', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const ctx = context(job.id);
    const rows = [...new Map(contactRows(job.id).filter(r => r.problems.includes('registered_without_gstin')).map(r => [r.ledger, r])).values()];
    if (Number(req.body?.confirmCount) !== rows.length) {
      return reply.code(409).send({ error: `There are ${rows.length} contact(s) registered without a GSTIN now${req.body?.confirmCount != null ? `, not ${req.body.confirmCount}` : ''}. Check the list and confirm again.`, count: rows.length });
    }
    const reason = reasonOf(req, 'Registered in Tally but no GSTIN: treated as unregistered (bulk action)');
    if (reason.error) return reply.code(400).send({ error: reason.error });
    const entries = rows.map(r => ({ ledger: r.ledger, next: { gstin: '', state: ctx.contactFixes?.[r.ledger]?.state || '', treatment: 'unregistered', pan: ctx.contactFixes?.[r.ledger]?.pan || '' }, reason: reason.value }));
    const changed = storeFixes(req, job, entries, 'treat all registered without GSTIN as unregistered');
    return { ...contactView(job.id), changed };
  });

  return { namesView, contactView };
}
