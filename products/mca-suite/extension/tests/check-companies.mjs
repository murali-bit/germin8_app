// Data-level dry run of the validation engine for every AOC-4 job in the queue:
// each mapped field is treated as if the extension had filled it from the dashboard data, then
// judged by the same engine the Next guard uses. MCA's own "required" markers are not available
// offline, so only the rules config decides "required" here.
//   node extension/tests/check-companies.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { flattenClient, FIELD_MAPPINGS } = require('../js/field-mapper.js');
const Engine = require('../js/validation/engine.js');
const rules = require('../js/validation/rules/aoc4.js');

const { jobs } = await (await fetch('http://localhost:4000/api/extension/jobs?scope=recent')).json();
const active = jobs.filter(j => j.form_type === 'aoc4' && !['cancelled', 'filled'].includes(j.status));
for (const j of active) {
  const { job } = await (await fetch(`http://localhost:4000/api/extension/jobs/${j.id}`)).json();
  const data = flattenClient(job.payload);
  const cin = String(data.CIN || '').toUpperCase();
  const answers = {};
  try {
    const a = await (await fetch(`http://localhost:4000/api/company-answers?cin=${cin}&form=aoc4`)).json();
    for (const r of a.answers || []) answers[r.field_key] = r.value;
  } catch (_) { /* no answers */ }
  const approved = { ...answers, ...data };
  for (const [k, d] of Object.entries(rules.derive || {})) {
    const blank = v => v === undefined || v === null || String(v).trim() === '';
    if (blank(approved[k])) { const v = d.from ? approved[d.from] : d.value; if (!blank(v)) approved[k] = String(v); }
  }
  const seen = new Set();
  const fields = FIELD_MAPPINGS.filter(f => f.key && f.kind !== 'waitFor' && f.kind !== 'addRows' && !seen.has(f.key) && seen.add(f.key))
    .map(f => ({ key: f.key, label: f.label, type: f.kind === 'date' ? 'date' : f.kind === 'number' ? 'number' : f.kind === 'radio' ? 'radio' : f.kind === 'select' ? 'select' : 'text',
      visible: true, mcaRequired: false, value: approved[f.key] ?? '' }));
  const results = Engine.validateFields(fields, { rules, data: approved, pageValues: approved, today: new Date() });
  const blockers = Engine.blockers(results);
  const warnings = results.flatMap(r => r.warnings.map(w => `${r.label}: ${w}`));
  console.log(`\n## ${j.client_name}  (${results.filter(r => r.status === 'FILLED').length} fields filled)`);
  blockers.forEach(b => console.log(`   BLOCK  [${b.status}] ${b.label} — ${b.reason}`));
  warnings.forEach(w => console.log(`   warn   ${w}`));
  if (!blockers.length) console.log('   no blocking problems in the data');
}
