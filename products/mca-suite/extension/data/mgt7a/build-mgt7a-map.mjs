// Builds js/field-maps/mgt7a.js from a live scan of MCA's MGT-7A page (data/mgt7a/mgt7a-scan-raw.json).
//
// MGT-7A is built from the same AEM components as MGT-7: the field names differ only in the outer
// panels (MGT-7 nests Section I one panel deeper, and its later steps sit in an iframe), while the
// inner panel / table / row / cell ids are the same. So each MGT-7A field is matched to its MGT-7
// twin by the longest shared tail of its name, and inherits that field's data key and label — the
// same client data then fills both forms.
//
// A match is accepted only when the shared tail includes an identifying id (a numbered panel, or a
// numbered widget) and points to exactly one MGT-7 data key. Fields without a twin are listed in
// data/mgt7a/unmatched.tsv for review; fields MGT-7A has but MGT-7 lacks are added by hand below.
//
//   node extension/data/mgt7a/build-mgt7a-map.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ext = path.resolve(here, '..', '..');
const require = createRequire(import.meta.url);
require(path.join(ext, 'js/field-maps/mgt7.js'));
const MGT7 = globalThis.MGT7_FIELDS;
const MGT7_CATS = globalThis.MGT7_CATEGORIES;

// Input: the extension's Field Extractor export of the MGT-7A page (mgt7a-extract.json). Radios are
// one entry per option there; they are folded into one field per name. Extra rows MCA adds to a
// repeating table carry a "GUID…__" prefix and are skipped (only the first row is mapped).
function loadScan() {
  const j = JSON.parse(fs.readFileSync(path.join(here, 'mgt7a-extract.json'), 'utf8'));
  const byName = new Map();
  for (const f of j.fields) {
    if (f.source !== 'dom' || !/^guideContainer-/.test(f.name || '')) continue;
    const prev = byName.get(f.name);
    if (prev) { if (f.type === 'radio' || f.type === 'checkbox') prev.options.push(f.ariaLabel || f.optionValue); continue; }
    byName.set(f.name, {
      tag: f.tag, type: f.type, name: f.name,
      label: (f.type === 'radio' || f.type === 'checkbox') ? '' : (f.label || ''),
      colHeader: f.cell ? String(f.cell.header || '').replace(/#searchbox.*$/, '').trim() : '',
      rowHeader: '', visible: !!f.visible, locked: !!(f.readOnly || f.disabled),
      options: (f.type === 'radio' || f.type === 'checkbox') ? [f.ariaLabel || f.optionValue] : (f.options || []),
    });
  }
  return { scannedAt: j.extractedAt, fields: [...byName.values()] };
}
const scan = loadScan();
const strip = n => n.replace(/^guideContainer-rootPanel-/, '').replace(/___jqName$/, '');
const nameOf = sel => (sel.match(/name="([^"]+)"/) || [])[1] || '';

const twins = MGT7.map(f => ({ f, segs: strip(nameOf(f.selector)).split('-') })).filter(t => t.segs.length > 1);
const identifying = s => /^(panel_?\d{6,}|panel_\d+_cop.*|table_\d+.*|Row\d{6,}|tableItem\d{6,}|tableitem\d{6,}|headerItem\d{6,}|guide[a-z]+_\d{4,}.*|panel\d{6,}.*|modal_container.*|mca_custom_file.*)$/.test(s);
const tailLen = (a, b) => { let n = 0; while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++; return n; };

// Fields MCA fills itself or that only drive its own logic: never filled.
const SYSTEM = /^(EL|savedCinVal|companyType|Server Date|Saved To Date|Company Search Box|datepicker_to_date|table2ExcelData|Form language)$/;

const out = [], unmatched = [], used = new Map();
for (const r of scan.fields) {
  if (r.type === 'hidden' || r.type === 'file' || SYSTEM.test(r.label)) continue;
  const segs = strip(r.name).split('-');
  let best = [], bestN = 0;
  for (const t of twins) {
    if (t.f.type === 'radio' && r.type !== 'radio') continue;
    const n = tailLen(segs, t.segs);
    if (n > bestN) { bestN = n; best = [t]; } else if (n === bestN && n > 0) best.push(t);
  }
  const shared = segs.slice(segs.length - bestN);
  const keys = [...new Set(best.map(t => t.f.dataKey))];
  // The shared tail must hold an id that is not reused elsewhere in the form, and (for table
  // cells, whose row/cell ids repeat across copies of a table) the table's own panel id too.
  const isCell = /^(Row|row)/.test(segs[segs.length - 2] || '');
  const ok = bestN >= 1 && keys.length === 1 && shared.some(identifying) && (!isCell || bestN >= 4);
  if (!ok) { unmatched.push(r); continue; }
  const f = best[0].f;
  if (used.has(f.dataKey)) { unmatched.push(Object.assign({ dup: used.get(f.dataKey) }, r)); continue; }
  used.set(f.dataKey, r.name);
  out.push({ category: f.category, key: f.key, label: f.label, dataKey: f.dataKey, type: f.type, required: !!f.required,
    selector: `${r.tag}[name="${r.name}"]`, locked: r.locked });
}

// ── Corrections checked against the MGT-7A page (labels / column headings in the export) ──
const tailOf = n => strip(n);
const sel = r => `${r.tag}[name="${r.name}"]`;
const scanByTail = new Map(scan.fields.map(r => [tailOf(r.name), r]));
const P1 = 'panel_1665650438-panel_526419145-panel-panel-panel_copy_copy-panel1641304338946-';
const MDT = 'panel_1665650438-panel_1006668027_cop-panel-panel-panel_1978902971-panel-panel_656552656-panel1641551715887-panel1641558444779-table_copy-Row1642496647341-';
const SHB = 'panel_1665650438-panel_1006668027_cop-panel-panel-panel_1978902971-panel-panel-panel1641454283114-panel1641545919571-panel-table_copy_copy-';
// [tail, category, dataKey, label, type]
const HAND = [
  [P1 + 'guideradiobutton_763248325', 'registration', 'filedFor', 'vi Whether the form is filed for (OPC / Small Company)', 'radio'],
  [P1 + 'panel-guideradiobutton_109901427', 'agm', 'agmHeld', 'viii (a) Whether AGM held (not applicable for OPC)', 'radio'],
  [P1 + 'panel-panel-guidetextdraw_134467', 'agm', 'agmDate', '(b) If yes, date of AGM', 'date'],
  [P1 + 'panel-panel-guidetextbox', 'agm', 'agmDueDate', '(c) Due date of AGM', 'date'],
  [P1 + 'panel-panel-guideradiobutton', 'agm', 'agmExtensionGranted', '(d) Whether any extension for AGM granted', 'radio'],
  [P1 + 'panel-guidetextbox_1261202206', 'agm', 'gnl1Srn', '(e) SRN of the GNL-1 filed for extension', 'text'],
  [P1 + 'panel-guidetextbox_491984941', 'agm', 'agmExtendedDueDate', '(f) Extended due date of AGM after grant of extension', 'date'],
  [P1 + 'panel-guidetextbox_1733075746', 'agm', 'agmNotHeldReason', '(g) Reason for not holding the AGM', 'text'],
  [SHB + 'Row2-headerItem1715179434635', 'shareholdingPublic', 'shareholdersFemale', 'Break-up of total shareholders — Individual (female)', 'text'],
  [SHB + 'Row1641295240128-headerItem1715179434897', 'shareholdingPublic', 'shareholdersMale', 'Break-up of total shareholders — Individual (male)', 'text'],
  [SHB + 'Row1641295218987-headerItem1715179435200', 'shareholdingPublic', 'shareholdersTransgender', 'Break-up of total shareholders — Individual (transgender)', 'text'],
  [SHB + 'Row1641295226814-headerItem1715179435483', 'shareholdingPublic', 'shareholdersOtherThanIndividuals', 'Break-up of total shareholders — other than individuals', 'text'],
  [MDT + 'headerItem1661927512023', 'meetings', 'attendance1Din', 'Attendance, director 1 — DIN', 'text'],
  [MDT + 'tableItem1642496647343', 'meetings', 'attendance1Name', 'Attendance, director 1 — name of the director', 'text'],
  [MDT + 'tableItem1642496647344', 'meetings', 'attendance1BoardEntitled', 'Attendance, director 1 — board meetings entitled to attend', 'text'],
  [MDT + 'tableItem1642496647346', 'meetings', 'attendance1BoardAttended', 'Attendance, director 1 — board meetings attended', 'text'],
  [MDT + 'tableItem1642496647349', 'meetings', 'attendance1BoardPercent', 'Attendance, director 1 — % of attendance', 'text'],
  [MDT + 'tableItem1642496647350', 'meetings', 'attendance1AttendedAgm', 'Attendance, director 1 — whether attended AGM', 'select'],
];
const handTails = new Set(HAND.map(h => h[0]));
const handKeys = new Set(HAND.map(h => h[2]));
for (let i = out.length - 1; i >= 0; i--) {
  const t = tailOf((out[i].selector.match(/name="([^"]+)"/) || [])[1] || '');
  if (handTails.has(t) || handKeys.has(out[i].dataKey)) out.splice(i, 1);
}
for (const [tail, category, dataKey, label, type] of HAND) {
  const r = scanByTail.get(tail);
  if (!r) { console.warn('hand-mapped field not on the page:', tail); continue; }
  out.push({ category, key: dataKey, label, dataKey, type, required: false, selector: sel(r), locked: r.locked });
}

// Share-capital break-up tables: MGT-7 has Physical / DEMAT / Total share columns where MGT-7A has
// one "Number of shares" column, so the same cell id means different things. Each row keeps the
// MGT-7 row name (from any matched cell); the column comes from MGT-7A's own heading.
const COL = { 'number of shares': 'Total', 'total nominal amount': 'NominalAmount', 'total paid-up amount': 'PaidUpAmount', 'total premium': 'Premium', 'particulars': 'Specify' };
const COLLABEL = { Total: 'number of shares', NominalAmount: 'total nominal amount', PaidUpAmount: 'total paid-up amount', Premium: 'total premium', Specify: 'others — specify' };
const rowKey = n => (strip(n).match(/^(.*-table_2043315125-Row\d+)-/) || [])[1];
const rowBase = new Map();
for (const o of out) {
  if (!/^breakup(Equity|Preference)$/.test(o.category)) continue;
  const rk = rowKey((o.selector.match(/name="([^"]+)"/) || [])[1]);
  if (rk && !rowBase.has(rk)) rowBase.set(rk, { category: o.category,
    base: o.dataKey.replace(/(Physical|Demat|Total|NominalAmount|PaidUpAmount|Premium|Specify)$/, ''),
    rowLabel: o.label.replace(/:.*$/, '') });
}
for (let i = out.length - 1; i >= 0; i--) if (/^breakup(Equity|Preference)$/.test(out[i].category)) out.splice(i, 1);
for (const r of scan.fields) {
  const rk = rowKey(r.name); const b = rk && rowBase.get(rk);
  const suf = COL[String(r.colHeader || '').toLowerCase()];
  if (!b || !suf) continue;
  out.push({ category: b.category, key: b.base + suf, label: `${b.rowLabel}: ${COLLABEL[suf]}`, dataKey: b.base + suf,
    type: 'text', required: false, selector: sel(r), locked: r.locked });
}
// IX B is "other directors" on MGT-7A (MGT-7: CEO / CFO / CS) — own keys so MGT-7 KMP data never lands there.
for (const o of out) if (/^kmp/i.test(o.dataKey) && o.category === 'remuneration') {
  o.dataKey = o.key = o.dataKey.replace(/^kmp/i, 'otherDirector');
  o.label = o.label.replace(/CEO \/ CFO \/ Company secretary|CEO, CFO and Company secretary/i, 'other directors');
}
const dup = out.map(o => o.dataKey).filter((k, i, a) => a.indexOf(k) !== i);
if (dup.length) throw new Error('duplicate data keys: ' + [...new Set(dup)].join(', '));

// Order like MGT-7's categories, so the map reads in the form's order.
const catOrder = MGT7_CATS.map(c => c.id);
const cats = MGT7_CATS.map(c => ({ id: c.id, label: c.label, icon: c.icon, fields: out.filter(o => o.category === c.id) })).filter(c => c.fields.length);
const esc = s => JSON.stringify(s);
const body = cats.map(c => `    {\n      id: ${esc(c.id)},\n      label: ${esc(c.label)},\n      icon: ${esc(c.icon || 'file')},\n      fields: [\n` +
  c.fields.map(f => `        { key: ${esc(f.key)}, label: ${esc(f.label)}, dataKey: ${esc(f.dataKey)}, type: ${esc(f.type)}, required: ${f.required},\n          selector: ${esc(f.selector)} },`).join('\n') +
  `\n      ],\n    },`).join('\n');

const js = `// MGT-7A (Abridged Annual Return for OPCs and small companies) — field map. GENERATED by
// data/mgt7a/build-mgt7a-map.mjs from a live scan of the MCA page (data/mgt7a/mgt7a-scan-raw.json,
// ${scan.scannedAt ? scan.scannedAt.slice(0, 10) : 'unknown date'}). Do not edit by hand: change the generator and re-run it.
//
// MGT-7A is built from the same AEM components as MGT-7, so every field here is the MGT-7A twin
// of an MGT-7 field (same inner panel/table/row/cell ids) and keeps MGT-7's data key and label —
// one set of client data fills either form. All fields sit in the top frame (MGT-7's are in an
// iframe). Fields MCA locks (prefilled, totals, opened only later) are left alone by the filler.
// Not mapped: attachments, MCA system fields, and fields with no MGT-7 twin (see unmatched.tsv).

(function (root) {
  "use strict";

  const MGT7A_CATEGORIES = [
${body}
  ];

  const MGT7A_FIELDS = MGT7A_CATEGORIES.flatMap(function (c) {
    return c.fields.map(function (f) {
      return Object.assign({ category: c.id, categoryLabel: c.label }, f);
    });
  });

  root.MGT7A_CATEGORIES = MGT7A_CATEGORIES;
  root.MGT7A_FIELDS = MGT7A_FIELDS;
  root.MGT7A_EXPECTED_FIELDS = MGT7A_FIELDS.length;
})(typeof window !== "undefined" ? window : globalThis);
`;
fs.writeFileSync(path.join(ext, 'js/field-maps/mgt7a.js'), js);
fs.writeFileSync(path.join(here, 'unmatched.tsv'), ['type\tlocked\tlabel\trowHeader\tcolHeader\tname'].concat(
  unmatched.map(r => [r.type, r.locked ? 'L' : '', r.label, r.rowHeader, r.colHeader, strip(r.name)].join('\t'))).join('\n') + '\n');
console.log(`mapped ${out.length} fields in ${cats.length} categories; ${unmatched.length} without an MGT-7 twin (unmatched.tsv)`);
console.log('categories:', cats.map(c => `${c.id}(${c.fields.length})`).join(' '));
