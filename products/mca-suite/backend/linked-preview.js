// AOC-4 linked forms preview for the dashboard: runs each extension linked-form module's buildData()
// (extension/js/linked/<id>.js) on the job payload + the company's saved answers, read straight from the DB.
// Answers merge like extension/js/linked/runner.js lfFetchAnswers: aoc4 (shared declaration) <- extraAnswers <- own.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const LINKED_IDS = ['aoc2', 'eauditor', 'eboard'];

let FORMS = null;
function forms() {
  if (!FORMS) FORMS = Object.fromEntries(LINKED_IDS.map(id => [id, require(`../extension/js/linked/${id}.js`)]));
  return FORMS;
}

export function answersFor(db, cin, formType) {
  const rows = db.prepare('SELECT field_key, value FROM company_answers WHERE cin = ? AND form_type = ?').all(cin, formType);
  return Object.fromEntries(rows.map(r => [r.field_key, r.value]));
}

export function mergedAnswers(db, cin, form) {
  const own = form.answersForm && form.answersForm !== 'aoc4' ? answersFor(db, cin, form.answersForm) : {};
  const extra = (form.extraAnswers || []).filter(f => f && f !== 'aoc4' && f !== form.answersForm).map(f => answersFor(db, cin, f));
  return Object.assign({}, answersFor(db, cin, 'aoc4'), ...extra, own);
}

// Functions (parse hooks), RegExps and undefined do not survive JSON; strip them so the reply is plain data.
const jsonSafe = v => JSON.parse(JSON.stringify(v ?? null, (k, x) => (x instanceof RegExp ? undefined : x)));

/**
 * @param db      node:sqlite DatabaseSync with company_answers
 * @param cin     company CIN (upper-cased here)
 * @param client  AOC-4 job payload ({general:{CIN,…}, …}) or null
 * @returns {aoc2:{values, missing, notes, label}, eauditor:{…}, eboard:{…}}; a form whose build throws has {error}.
 */
export function buildLinkedPreview(db, cin, client) {
  const c = String(cin || client?.general?.CIN || '').trim().toUpperCase();
  const out = {};
  for (const [id, form] of Object.entries(forms())) {
    try {
      const answers = c ? mergedAnswers(db, c, form) : {};
      const b = form.buildData(client || {}, answers) || {};
      out[id] = jsonSafe({ label: form.label, answersForm: form.answersForm, values: b.values || {}, missing: b.missing || [], notes: b.notes || [] });
    } catch (err) {
      out[id] = { label: form.label, answersForm: form.answersForm, values: {}, missing: [], notes: [], error: err.message };
    }
  }
  return out;
}
