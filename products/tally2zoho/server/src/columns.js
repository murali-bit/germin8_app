// Editable column layout of the output files (one layout per firm per file).
//
// Every column has a stable id that never changes when its heading is renamed. The ids of the original
// columns are made from their original headings (for example "Display Name" -> "display_name"); columns
// added by a user get an id starting with "c_". Everything else in the server refers to columns by id.
//
// A column's value comes from one of:
//   { type: 'builtin', builtin: <id of an original column> }  the value the platform has always computed for that column
//   { type: 'field',   path: 'address' | 'a.b.c' }            a raw Tally field read from the source record
//   { type: 'fixed',   value: 'text' }                        the same text on every row
//   { type: 'blank' }                                         an empty cell
//
// With no saved layout the output is exactly what the original fixed code produced.
//
// The default headings of the four master files (Customers, Vendors, Chart of Accounts, Items) are the headings of
// the official Zoho Books sample import files, byte for byte and in the same order (TEMPLATES in zoho.js: verified
// and sampleFile). That holds only while a firm uses the default layout: a changed layout is no longer the sample's.
// For every other file, and for a changed layout, an admin can record that a layout matches the official sample:
// that is the admin's own statement, stored with their name and the time, and it is cleared by any later change to
// the layout.
//
// A saved layout made before a template's headings changed can refer to a column id that no longer exists (for
// example "place_of_supply", which became "place_of_contact"). Nothing breaks: such a column keeps its heading and
// position, its cell is written EMPTY, the screen lists it as "no longer available", and the layout cannot be saved
// again until that column is given another value or removed. The new standard columns are offered as "removed
// columns" that can be added back, or the layout can be reset to the standard (official) one.

import { createHash, randomBytes } from 'node:crypto';
import { TEMPLATES, toCsv, HEADING_RENAMES, CONTACT_ALWAYS_KEPT } from './zoho.js';
import { VOUCHER_FILES } from './vouchers.js';

export const ALL_FILES = { ...TEMPLATES, ...VOUCHER_FILES };
export const isVoucherFile = key => key in VOUCHER_FILES;

const MAX_COLUMNS = 200, MAX_HEADING = 200, MAX_TEXT = 1000;
// "%" is spelled out, so "Item Tax" and "Item Tax %" (both in Zoho's invoice sample) get different ids.
const slug = h => String(h).replace(/%/g, ' percent').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const norm = v => String(v ?? '').trim().toLowerCase();

// The original columns of a file, in their original order. Returns fresh objects on every call.
export const defaultColumns = key => ALL_FILES[key].headers.map(h => ({ id: slug(h), heading: h, source: { type: 'builtin', builtin: slug(h) } }));
export const idColumnId = key => slug(ALL_FILES[key].idColumn);
for (const key of Object.keys(ALL_FILES)) { // the ids must be different within a file
  const ids = defaultColumns(key).map(c => c.id);
  if (new Set(ids).size !== ids.length || ids.some(id => !id)) throw new Error(`Column ids are not unique for ${key}`);
}

// The version of a layout: a checksum of its column ids, headings and sources, in order.
export const hashOf = (key, columns) => createHash('sha256')
  .update(JSON.stringify({ key, columns: columns.map(c => ({ id: c.id, heading: c.heading, source: c.source })) })).digest('hex');

export function setupColumns(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS column_mappings (
    firm_id INTEGER NOT NULL, key TEXT NOT NULL, columns TEXT, updated_by TEXT, updated_at TEXT,
    verified_sample TEXT, verified_note TEXT, verified_by TEXT, verified_at TEXT, PRIMARY KEY (firm_id, key));`);
}

// A layout saved before Zoho's Map Fields spelling was used (zohorules.json lists.map_field_labels, for example
// "Place of Contact" -> "Place Of Contact"): the column that read the old standard value reads the new one, and a column
// still carrying the old heading takes the new heading. A heading the admin chose themselves is left alone.
export function migrateRenamedHeadings(key, columns) {
  const renames = HEADING_RENAMES[key];
  if (!renames?.length) return columns;
  return columns.map(c => {
    for (const r of renames) {
      const oldId = slug(r.from), newId = slug(r.to);
      const reads = c.source?.type === 'builtin' && c.source.builtin === oldId;
      if (c.id === oldId && reads) return { ...c, id: newId, heading: c.heading === r.from ? r.to : c.heading, source: { ...c.source, builtin: newId } };
      if (reads && c.id !== oldId) return { ...c, heading: c.heading === r.from ? r.to : c.heading, source: { ...c.source, builtin: newId } };
      if (c.id === oldId && oldId === newId && c.heading === r.from) return { ...c, heading: r.to };
    }
    return c;
  });
}

// The columns of a Customers or Vendors file that are WRITTEN: with the default layout, a column that is empty on every
// row and is not in lists.contact_columns.always_kept is left out, so Zoho's Map Fields page does not list columns that
// can only stay unmapped. A file with no rows, a layout an admin changed and every other file are written as they are.
export function columnsToWrite(key, layout, rows) {
  if (!['customers', 'vendors'].includes(key) || layout.customised || !rows.length) return layout.columns;
  const heading = Object.fromEntries(defaultColumns(key).map(c => [c.id, c.heading]));
  return layout.columns.filter(c => {
    const std = heading[c.source?.builtin];
    if (c.source?.type !== 'builtin' || !std || CONTACT_ALWAYS_KEPT.has(std) || c.id === idColumnId(key)) return true;
    return rows.some(r => String(r[c.id] ?? '') !== '');
  });
}

// The layout a firm uses for a file. columns is NULL in the table when the firm uses the default layout.
export function getMapping(db, firmId, key) {
  const row = db.prepare('SELECT * FROM column_mappings WHERE firm_id = ? AND key = ?').get(firmId ?? 1, key);
  const columns = row?.columns ? migrateRenamedHeadings(key, JSON.parse(row.columns)) : defaultColumns(key);
  const t = ALL_FILES[key];
  return {
    key, columns, customised: !!row?.columns, hash: hashOf(key, columns),
    // the official Zoho sample file the layout matches, checked in code: only for the default layout of a verified template
    officialSample: t.verified && t.sampleFile && !row?.columns ? t.sampleFile : null,
    updatedBy: row?.columns ? row.updated_by : null, updatedAt: row?.columns ? row.updated_at : null,
    verified: row?.verified_at ? { sampleFileName: row.verified_sample, note: row.verified_note || '', by: row.verified_by, at: row.verified_at } : null,
  };
}

// ---------- reading a raw Tally field ----------
const isMeta = x => !!x && typeof x === 'object' && !Array.isArray(x) && x.metadata === true;
const notApplicable = v => typeof v === 'string' && v.includes('\u0004') && /not applicable/i.test(v); // Tally's "no value" marker
function collectValues(v, parts, out) {
  if (v == null) return;
  if (Array.isArray(v)) { for (const x of v) if (!isMeta(x)) collectValues(x, parts, out); return; } // a Tally list, or a list of lines
  if (!parts.length) { if (typeof v !== 'object' && !notApplicable(v)) out.push(String(v)); return; }
  if (typeof v === 'object') collectValues(v[parts[0]], parts.slice(1), out);
}
// The text written for a field path. A list is written as its items joined with ", ". A missing field gives ''.
// The value is written as it is in Tally: nothing is trimmed, reformatted or re-signed.
export function fieldText(record, path) {
  const out = [];
  collectValues(record, String(path).split('.'), out);
  return out.join(', ');
}

// The fields present in a set of source records: [{ path, kind: 'text' | 'list', records, example }].
// records is how many records carry a value for the field; example is the first such value as it would be written.
export function listFields(records, cap = 300) {
  const found = new Map(); // path -> { kind, records, example }
  for (const rec of records) {
    const seen = new Map(); // path -> kind, for this record
    const walk = (obj, prefix) => {
      for (const [k, v] of Object.entries(obj)) {
        if (k === 'metadata') continue;
        const p = prefix ? `${prefix}.${k}` : k;
        if (Array.isArray(v)) {
          const items = v.filter(x => !isMeta(x));
          const objects = items.filter(x => x && typeof x === 'object' && !Array.isArray(x));
          for (const o of objects) walk(o, p);
          if (objects.length < items.length || !items.length) seen.set(p, 'list');
        } else if (v && typeof v === 'object') walk(v, p);
        else seen.set(p, seen.get(p) || 'text');
      }
    };
    if (rec && typeof rec === 'object') walk(rec, '');
    for (const [p, kind] of seen) {
      const f = found.get(p) || { kind, records: 0, example: '' };
      const text = fieldText(rec, p);
      if (text.trim() !== '') { f.records++; if (!f.example) f.example = text.length > 120 ? `${text.slice(0, 120)}...` : text; }
      found.set(p, f);
    }
  }
  const fields = [...found.entries()].map(([path, f]) => ({ path, kind: f.kind, records: f.records, example: f.example }))
    .sort((a, b) => b.records - a.records || a.path.localeCompare(b.path));
  return { fields: fields.slice(0, cap), truncated: fields.length > cap };
}

// ---------- validation ----------
const newId = () => `c_${randomBytes(5).toString('hex')}`;
const VOUCHER_LIMIT = module => `For ${module}, only renaming and reordering columns is available for now. Adding or removing columns, and changing where a column's value comes from, will come later.`;

// Checks a draft layout. Returns { columns, problems }: columns is the cleaned layout (null when the draft is not a
// list of columns at all) and problems is a list of plain-language messages (empty when the draft can be saved).
export function checkColumns(key, input) {
  const t = ALL_FILES[key];
  const defs = defaultColumns(key);
  const defById = Object.fromEntries(defs.map(c => [c.id, c]));
  const problems = [];
  if (!Array.isArray(input) || !input.length) return { columns: null, problems: ['The file needs at least one column.'] };
  if (input.length > MAX_COLUMNS) return { columns: null, problems: [`A file can have at most ${MAX_COLUMNS} columns.`] };

  const used = new Set();
  const columns = input.map((raw, i) => {
    const c = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    let heading = String(c.heading ?? c.name ?? '').trim();
    // A standard heading that ends with a space in the official sample (Chart of Accounts "Account # ") keeps it.
    if (defById[c.id] && heading === defById[c.id].heading.trim()) heading = defById[c.id].heading;
    const label = heading ? `"${heading}"` : `number ${i + 1}`;
    let id = typeof c.id === 'string' && (defById[c.id] || /^c_[a-z0-9]{4,32}$/.test(c.id)) ? c.id : null;
    if (id && used.has(id)) { problems.push(`Column ${label} is listed twice.`); id = null; }
    if (!id) id = newId();
    used.add(id);
    if (!heading) problems.push(`Column number ${i + 1} has no heading. Every column needs a heading.`);
    else if (heading.length > MAX_HEADING) problems.push(`The heading of column number ${i + 1} is too long. Use ${MAX_HEADING} characters or fewer.`);

    const s = c.source && typeof c.source === 'object' ? c.source : (c.source == null && defById[id] ? { type: 'builtin', builtin: id } : {});
    let source = { type: 'blank' };
    if (s.type === 'builtin') {
      const b = s.builtin == null && defById[id] ? id : s.builtin;
      if (defById[b]) source = { type: 'builtin', builtin: b };
      else problems.push(`Column ${label}: the standard value chosen for it does not exist in this file.`);
    } else if (s.type === 'field') {
      const p = String(s.path ?? '').trim();
      if (!p || p.length > MAX_HEADING || p.split('.').some(part => !part.trim())) problems.push(`Column ${label}: choose the Tally field it should read.`);
      else source = { type: 'field', path: p };
    } else if (s.type === 'fixed') {
      const v = String(s.value ?? '');
      if (v.length > MAX_TEXT) problems.push(`Column ${label}: the fixed text is too long. Use ${MAX_TEXT} characters or fewer.`);
      else source = { type: 'fixed', value: v };
    } else if (s.type !== 'blank') problems.push(`Column ${label}: choose where its value comes from (the standard value, a Tally field, a fixed text, or blank).`);
    return { id, heading, source };
  });

  const seenHeadings = new Set(), reported = new Set();
  for (const c of columns) {
    const h = norm(c.heading);
    if (!h) continue;
    if (seenHeadings.has(h) && !reported.has(h)) { reported.add(h); problems.push(`The heading "${c.heading}" is used more than once. Each heading in a file must be different.`); }
    seenHeadings.add(h);
  }

  const idId = idColumnId(key);
  const idCol = columns.find(c => c.id === idId);
  if (!idCol) problems.push(`The "${t.idColumn}" column identifies each record and cannot be removed. It can be renamed.`);
  else if (idCol.source.type === 'blank' || idCol.source.type === 'fixed') problems.push(`The "${idCol.heading || t.idColumn}" column identifies each record, so it cannot be left blank or set to a fixed text.`);
  else if (idCol.source.type === 'builtin' && idCol.source.builtin !== idId) problems.push(`The "${idCol.heading || t.idColumn}" column identifies each record. It must keep its standard value or read a Tally field.`);

  if (isVoucherFile(key)) {
    const sameSet = columns.length === defs.length && defs.every(d => columns.some(c => c.id === d.id));
    const ownValues = columns.every(c => c.source.type === 'builtin' && c.source.builtin === c.id);
    if (!sameSet || !ownValues) return { columns, problems: [VOUCHER_LIMIT(t.module), ...problems.filter(p => /heading/i.test(p))] };
  }
  return { columns, problems };
}

// How a saved layout falls short of the file's current standard columns: missing = standard headings not in the layout
// (voucher files must keep them all), gone = headings of columns that read a standard value the file no longer has.
// Both empty for a layout that only renames and reorders the standard columns (or adds others, for master files).
export function layoutGaps(key, columns) {
  const defs = defaultColumns(key);
  const ids = new Set(defs.map(d => d.id));
  return {
    missing: isVoucherFile(key) ? defs.filter(d => !columns.some(c => c.id === d.id)).map(d => d.heading) : [],
    gone: columns.filter(c => c.source?.type === 'builtin' && !ids.has(c.source.builtin)).map(c => c.heading),
  };
}

// ---------- building rows ----------
// builtinRow: the row the original code builds, keyed by the ORIGINAL heading. record: the Tally source record.
// Returns the row's values keyed by column id.
export function rowValues(key, columns, builtinRow, record) {
  const headingOf = Object.fromEntries(defaultColumns(key).map(c => [c.id, c.heading]));
  const out = {};
  for (const c of columns) {
    const s = c.source;
    out[c.id] = s.type === 'builtin' ? builtinRow[headingOf[s.builtin]] ?? ''
      : s.type === 'field' ? fieldText(record, s.path)
      : s.type === 'fixed' ? s.value : '';
  }
  return out;
}
// rows: values keyed by column id. The first line of the CSV is the column headings.
export const csvFor = (columns, rows) => {
  const ids = columns.map(c => c.id);
  const body = toCsv(ids, rows);
  return toCsv(columns.map(c => c.heading), []) + body.slice(body.indexOf('\r\n') + 2);
};

// ---------- describing a layout ----------
const NO_LONGER = 'No longer available: the standard column it read was removed from the template. Its cells are written empty. Choose another value for it, or remove it.';
// The statement recorded for a file built with the default layout of a template checked against the official sample.
export const builtInStatement = t => ({ sampleFileName: t.sampleFile, note: 'Default layout: every heading of the official Zoho sample file, in the same order (checked by the platform).', by: 'the platform (built-in check)', at: null, builtIn: true });
// What a generated file records about its layout: { verified, statement } (statement null when not verified).
export const layoutStatement = (key, m) => (m.verified ? { verified: true, statement: m.verified } : m.officialSample ? { verified: true, statement: builtInStatement(ALL_FILES[key]) } : { verified: false, statement: null });
const sourceText = (key, s) => {
  const def = defaultColumns(key).find(c => c.id === s.builtin);
  return s.type === 'builtin' ? `the standard value for "${def?.heading ?? s.builtin}"`
    : s.type === 'field' ? `Tally field "${s.path}"`
    : s.type === 'fixed' ? `fixed text "${s.value}"` : 'left blank';
};
const sameSource = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// What changed between two layouts, as plain sentences that carry the old and the new value.
export function describeChanges(key, before, after) {
  const out = [];
  const b = Object.fromEntries(before.map(c => [c.id, c])), a = Object.fromEntries(after.map(c => [c.id, c]));
  for (const c of before) if (!a[c.id]) out.push(`column "${c.heading}" removed (it was ${sourceText(key, c.source)})`);
  for (const c of after) {
    const old = b[c.id];
    if (!old) { out.push(`column "${c.heading}" added (${sourceText(key, c.source)})`); continue; }
    if (old.heading !== c.heading) out.push(`heading "${old.heading}" changed to "${c.heading}"`);
    if (!sameSource(old.source, c.source)) out.push(`column "${c.heading}" changed from ${sourceText(key, old.source)} to ${sourceText(key, c.source)}`);
  }
  const common = list => list.filter(c => a[c.id] && b[c.id]).map(c => c.id);
  if (common(before).join('|') !== common(after).join('|')) {
    out.push(`column order changed from [${before.map(c => c.heading).join(', ')}] to [${after.map(c => c.heading).join(', ')}]`);
  }
  return out;
}

// One file's layout as sent to the screen.
export function describeTemplate(db, firmId, key, slotByKey) {
  const t = ALL_FILES[key];
  const m = getMapping(db, firmId, key);
  const defs = defaultColumns(key);
  const defById = Object.fromEntries(defs.map(c => [c.id, c]));
  const from = c => (c.source.type === 'builtin' ? (defById[c.source.builtin] ? t.sources?.[defById[c.source.builtin].heading] || '' : NO_LONGER)
    : c.source.type === 'field' ? `Tally field "${c.source.path}"`
    : c.source.type === 'fixed' ? `Fixed text "${c.source.value}"` : 'Left blank');
  const idId = idColumnId(key);
  const voucher = isVoucherFile(key);
  const order = m.columns.filter(c => defById[c.id]).map(c => c.id);
  const defOrder = defs.filter(d => order.includes(d.id)).map(d => d.id);
  return {
    key, module: t.module, fileName: t.file, format: 'CSV', kind: voucher ? 'voucher' : 'master',
    source: t.slot ? slotByKey[t.slot]?.name : 'Vouchers (after routing)',
    // What may be changed for this file in this version.
    editable: { rename: true, reorder: true, changeSource: !voucher, add: !voucher, remove: !voucher },
    editNote: voucher ? VOUCHER_LIMIT(t.module) : null,
    idColumnId: idId, idColumn: m.columns.find(c => c.id === idId)?.heading ?? t.idColumn,
    // verified: the layout matches the official Zoho sample file, either because it is the default layout of a template
    // checked against the sample in code (verifiedInCode), or because an admin stated so (verification.by is that admin).
    verified: !!m.officialSample || !!m.verified,
    verifiedInCode: !!m.officialSample, officialSampleFile: t.sampleFile || null,
    verification: m.verified || (m.officialSample ? builtInStatement(t) : null),
    verificationNote: m.officialSample
      ? `The standard layout has every heading of the official Zoho Books sample file "${m.officialSample}", in the same order. The platform checks this.`
      : m.verified
        ? `${m.verified.by} stated that this layout matches the official Zoho sample file "${m.verified.sampleFileName}". This is that person's statement; the platform has not checked it.`
        : t.verified
          ? `Not verified: this layout was changed from the standard one, which matches the official Zoho sample file "${t.sampleFile}". An admin can compare it with the sample and mark it as matching, or reset it to the standard layout.`
          : 'Not verified. The column headings of this file have not been compared with an official Zoho sample file. An admin can compare them and mark the file as matching.',
    customised: m.customised, hash: m.hash, defaultHash: hashOf(key, defs), updatedBy: m.updatedBy, updatedAt: m.updatedAt,
    columns: m.columns.map((c, i) => {
      const d = defById[c.id];
      const changed = {
        added: !d,
        heading: !!d && d.heading !== c.heading,
        source: !!d && !sameSource(d.source, c.source),
        position: !!d && order.indexOf(c.id) !== defOrder.indexOf(c.id),
      };
      return {
        id: c.id, name: c.heading, heading: c.heading, position: i + 1, source: c.source, from: from(c),
        identifying: c.id === idId, defaultHeading: d?.heading ?? null,
        // the column reads a standard value that this file no longer has: its cells are written empty
        noLongerAvailable: c.source.type === 'builtin' && !defById[c.source.builtin],
        changed, differsFromDefault: changed.added || changed.heading || changed.source || changed.position,
      };
    }),
    // Original columns that are not in the layout now. They can be added back.
    removedColumns: defs.filter(d => !m.columns.some(c => c.id === d.id)).map(d => ({ id: d.id, heading: d.heading, from: t.sources?.[d.heading] || '' })),
    // The standard values a column of this file can use.
    builtins: defs.map(d => ({ id: d.id, heading: d.heading, from: t.sources?.[d.heading] || '' })),
  };
}

// ---------- routes ----------
// previewRows(job, key, limit) -> { total, rows: [{ builtin, record }] } is supplied by index.js, which knows how rows are built.
// markStale(jobId, reason, fileKeys, kind) records that a migration's files are out of date.
export function registerColumns(app, { db, need, audit, now, tx, slotByKey, previewRows, markStale, clearStale }) {
  const firmOf = req => (req.user.role === 'super_admin' && /^\d+$/.test(String(req.query?.firmId ?? '')) ? Number(req.query.firmId) : req.user.firm_id);
  const canEdit = (req, reply) => {
    if (['super_admin', 'admin'].includes(req.user.role)) return true;
    reply.code(403).send({ error: 'Only an admin can change the column layout of the output files.' });
    return false;
  };
  const known = (req, reply) => {
    if (Object.hasOwn(ALL_FILES, req.params.key)) return ALL_FILES[req.params.key];
    reply.code(404).send({ error: 'Unknown file.' });
    return null;
  };

  // The layout of every file for the signed-in user's firm.
  app.get('/api/templates', req => Object.keys(ALL_FILES).map(key => describeTemplate(db, firmOf(req), key, slotByKey)));

  // Stores a new layout (columns null = back to the default). Returns the changes made, [] when nothing changed.
  const store = (req, key, columns, action) => {
    const t = ALL_FILES[key], firmId = firmOf(req);
    const before = getMapping(db, firmId, key);
    const defaults = defaultColumns(key);
    const next = columns || defaults;
    const hash = hashOf(key, next);
    if (hash === before.hash) return [];
    const changes = describeChanges(key, before.columns, next);
    const isDefault = hash === hashOf(key, defaults);
    const jobs = db.prepare('SELECT m.id, g.mapping_hash FROM migrations m JOIN generated_files g ON g.job_id = m.id AND g.key = ? WHERE COALESCE(m.firm_id, 1) = ?').all(key, firmId);
    tx(() => {
      db.prepare(`INSERT INTO column_mappings (firm_id, key, columns, updated_by, updated_at) VALUES (?,?,?,?,?)
        ON CONFLICT (firm_id, key) DO UPDATE SET columns = excluded.columns, updated_by = excluded.updated_by, updated_at = excluded.updated_at,
          verified_sample = NULL, verified_note = NULL, verified_by = NULL, verified_at = NULL`)
        .run(firmId, key, isDefault ? null : JSON.stringify(next), req.user.email, now());
      const versions = `Layout version ${before.hash.slice(0, 12)} -> ${hash.slice(0, 12)}`;
      audit(null, action, `Firm ${firmId}, ${t.module} file: ${changes.join('; ')}. ${versions}.`);
      if (before.verified) {
        audit(null, 'template_verified_cleared', `Firm ${firmId}, ${t.module} file: the statement by ${before.verified.by} that the layout matches the official Zoho sample "${before.verified.sampleFileName}" was removed because the layout changed.`);
      }
      // Files already created for this firm's migrations were built with another layout.
      for (const j of jobs) {
        clearStale(j.id, `columns:${key}`);
        if ((j.mapping_hash || hashOf(key, defaults)) === hash) continue; // the file was built with exactly this layout
        markStale(j.id, `The column layout of the ${t.module} file was changed.`, [key], `columns:${key}`);
        audit(j.id, 'column_layout_changed', `${t.module} file: ${changes.join('; ')}. ${versions}. The file created earlier is out of date.`);
      }
    });
    return changes;
  };

  app.put('/api/templates/:key/columns', (req, reply) => {
    const t = known(req, reply); if (!t) return;
    if (!canEdit(req, reply)) return;
    const { columns, problems } = checkColumns(req.params.key, req.body?.columns);
    if (problems.length) return reply.code(400).send({ error: problems[0], problems });
    const changes = store(req, req.params.key, columns, 'column_mapping_changed');
    return { ...describeTemplate(db, firmOf(req), req.params.key, slotByKey), changed: changes.length > 0, changes };
  });

  // Back to the original layout.
  app.delete('/api/templates/:key/columns', (req, reply) => {
    const t = known(req, reply); if (!t) return;
    if (!canEdit(req, reply)) return;
    const changes = store(req, req.params.key, null, 'column_mapping_reset');
    return { ...describeTemplate(db, firmOf(req), req.params.key, slotByKey), changed: changes.length > 0, changes };
  });

  // An admin's statement that the layout matches the official Zoho sample file. { verified: false } removes it.
  app.put('/api/templates/:key/verified', (req, reply) => {
    const t = known(req, reply); if (!t) return;
    if (!canEdit(req, reply)) return;
    const key = req.params.key, firmId = firmOf(req);
    const before = getMapping(db, firmId, key);
    if (req.body?.verified === false) {
      if (before.verified) {
        db.prepare('UPDATE column_mappings SET verified_sample = NULL, verified_note = NULL, verified_by = NULL, verified_at = NULL WHERE firm_id = ? AND key = ?').run(firmId, key);
        audit(null, 'template_verified_removed', `Firm ${firmId}, ${t.module} file: the statement by ${before.verified.by} that the layout matches the official Zoho sample "${before.verified.sampleFileName}" was removed.`);
      }
      return describeTemplate(db, firmId, key, slotByKey);
    }
    if (req.body?.verified !== true) return reply.code(400).send({ error: 'Say whether the layout matches the official Zoho sample file.' });
    const sample = String(req.body.sampleFileName ?? '').trim(), note = String(req.body.note ?? '').trim();
    if (!sample) return reply.code(400).send({ error: 'Enter the name of the official Zoho sample file you compared this layout with.' });
    if (sample.length > MAX_HEADING || note.length > MAX_TEXT) return reply.code(400).send({ error: 'The sample file name or the note is too long.' });
    db.prepare(`INSERT INTO column_mappings (firm_id, key, verified_sample, verified_note, verified_by, verified_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT (firm_id, key) DO UPDATE SET verified_sample = excluded.verified_sample, verified_note = excluded.verified_note, verified_by = excluded.verified_by, verified_at = excluded.verified_at`)
      .run(firmId, key, sample, note, req.user.email, now());
    audit(null, 'template_marked_verified', `Firm ${firmId}, ${t.module} file: ${req.user.email} stated that layout version ${before.hash.slice(0, 12)} matches the official Zoho sample "${sample}"${note ? `. Note: ${note}` : ''}`
      + (before.verified ? ` (replaces the statement by ${before.verified.by} about "${before.verified.sampleFileName}")` : ''));
    return describeTemplate(db, firmId, key, slotByKey);
  });

  // The Tally fields present in this migration's stored records for the file's dataset.
  app.get('/api/migrations/:id/templates/:key/fields', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const t = known(req, reply); if (!t) return;
    if (isVoucherFile(req.params.key)) {
      return { key: req.params.key, module: t.module, available: false, dataset: null, datasetName: null, recordType: null, records: 0, fields: [], truncated: false,
        note: VOUCHER_LIMIT(t.module) };
    }
    const recs = db.prepare('SELECT data FROM source_records WHERE job_id = ? AND slot = ? AND object_type = ? ORDER BY id').all(job.id, t.slot, t.objectType).map(r => JSON.parse(r.data));
    const { fields, truncated } = listFields(recs);
    return { key: req.params.key, module: t.module, available: true, dataset: t.slot, datasetName: slotByKey[t.slot]?.name ?? t.slot, recordType: t.objectType, records: recs.length, fields, truncated,
      note: recs.length ? null : `No ${slotByKey[t.slot]?.name ?? t.slot} records are stored for this migration yet. Upload the file and process the data to see its fields.` };
  });

  // What a draft layout would produce for this migration. Nothing is saved and nothing is written to the audit log.
  // Without a draft, the firm's saved layout is shown.
  app.post('/api/migrations/:id/templates/:key/preview', (req, reply) => {
    const job = need(req, reply); if (!job) return;
    const t = known(req, reply); if (!t) return;
    const key = req.params.key;
    const saved = getMapping(db, job.firm_id ?? 1, key);
    const draft = req.body?.columns;
    const { columns, problems } = draft === undefined || draft === null ? { columns: saved.columns, problems: [] } : checkColumns(key, draft);
    if (!columns) return { key, module: t.module, valid: false, problems, headings: [], columns: [], rows: [], totalRows: 0, differsFromSaved: true, hash: null };
    const built = previewRows(job, key, 5);
    const rows = built.rows.map(r => { const v = rowValues(key, columns, r.builtin, r.record); return columns.map(c => String(v[c.id] ?? '')); });
    const hash = hashOf(key, columns);
    return { key, module: t.module, valid: problems.length === 0, problems, headings: columns.map(c => c.heading), columns, rows, totalRows: built.total,
      differsFromSaved: hash !== saved.hash, hash: problems.length ? null : hash };
  });
}
