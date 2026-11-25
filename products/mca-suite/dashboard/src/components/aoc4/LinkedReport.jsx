import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import FieldRow, { Badge } from './FieldRow.jsx';
import { SHARED_AOC4_KEYS, showValue, isBlank } from './aoc4Data.js';
import ReportAiPanel from './ReportAiPanel.jsx';

const humanize = k => String(k).toLowerCase().replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

// A value the CA corrects is the CA's own: the machine prefix ("Verbatim from document (p.2): ", "AI from document …")
// is dropped from its label so a later scan does not take it for its own reading (the server also marks it 'ca').
export const caLabel = l => String(l || '').replace(/^\s*(Verbatim from document|AI from document|TEST DATA|PLACEHOLDER)\b(\s*\(p\.[^)]*\))?\s*:?\s*/i, '') || String(l || '');

// Which company-answers formType a missing item is saved under (same rule as the extension's runner).
export const missingFormType = (m, formId) => m.formType || (SHARED_AOC4_KEYS.includes(m.key) ? 'aoc4' : formId);

export function linkedStats(preview, valueOf, formId) {
  const missing = (preview?.missing || []).filter(m => !m.optional && isBlank(valueOf(missingFormType(m, formId), m.key))).length;
  const filled = Object.values(preview?.values || {}).filter(v => !isBlank(v)).length;
  return { filled, missing };
}

const asField = (m, formId) => ({
  key: m.key,
  label: m.label || humanize(m.key),
  kind: m.type === 'select' && Array.isArray(m.options) ? 'select' : ['textarea', 'date', 'number'].includes(m.type) ? m.type : 'text',
  options: m.options,
  default: m.default,
  hint: m.hint,
  formType: missingFormType(m, formId),
});

// cin / jobId / onReload are optional: they power the "Read from documents (AI)" panel and its refresh after saving.
export default function LinkedReport({ formId, title, intro, preview, loading, error, answers, labels, valueOf, isDirty, onEdit, cin, jobId, onReload }) {
  const [showAll, setShowAll] = useState(false);
  const values = Object.entries(preview?.values || {}).filter(([k]) => !k.startsWith('__'));
  const missing = (preview?.missing || []).map(m => ({ m, f: asField(m, formId) }));
  const missingKeys = new Set(missing.map(x => `${x.f.formType}:${x.f.key}`));
  const saved = Object.entries(answers?.[formId] || {}).filter(([k]) => !missingKeys.has(`${formId}:${k}`));
  const shown = showAll ? values : values.slice(0, 40);

  return (
    <div className="space-y-4">
      <section className="bg-surface border border-line rounded-xl shadow-sm p-5">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <p className="text-xs text-ink-muted mt-0.5">{intro}</p>
        {loading && <p className="text-xs text-ink-muted mt-3">Building the preview…</p>}
        {error && <p className="text-xs text-rose-700 mt-3">{error}</p>}
      </section>

      <ReportAiPanel cin={cin} jobId={jobId} formTypes={[formId]} onSaved={onReload}
        docLabel={formId === 'eboard' ? "the Board's report" : 'the audit report'} />

      {missing.length > 0 && (
        <section className="bg-surface border border-line rounded-xl shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-ink">Answers needed</h3>
            <Badge tone="missing">{missing.filter(x => !x.m.optional).length} needed · {missing.filter(x => x.m.optional).length} optional</Badge>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {missing.map(({ m, f }) => (
              <FieldRow key={`${f.formType}:${f.key}`} field={{ ...f, label: f.label + (m.optional ? ' (optional)' : '') }}
                value={valueOf(f.formType, f.key)} required={!m.optional}
                dirty={isDirty(f.formType, f.key)}
                onChange={v => onEdit(f.formType, f.key, f.label, v)} />
            ))}
          </div>
          <p className="text-[11px] text-ink-subtle mt-3">Saved to the company master, so the extension does not ask again.</p>
        </section>
      )}

      {saved.length > 0 && (
        <section className="bg-surface border border-line rounded-xl shadow-sm p-5">
          <h3 className="text-sm font-semibold text-ink mb-3">Saved answers</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {saved.map(([k, v]) => {
              const label = labels[`${formId}:${k}`] || humanize(k);
              const long = String(v ?? '').length > 60 || String(v ?? '').includes('\n');
              return (
                <FieldRow key={k} field={{ key: k, label, kind: long ? 'textarea' : 'text' }}
                  value={valueOf(formId, k)} dirty={isDirty(formId, k)}
                  onChange={nv => onEdit(formId, k, caLabel(label), nv)} />
              );
            })}
          </div>
        </section>
      )}

      <section className="bg-surface border border-line rounded-xl shadow-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-ink">Values the extension will fill</h3>
          <span className="text-xs text-ink-muted">{values.length} values · read only</span>
        </div>
        {values.length === 0 ? (
          error && !loading
            ? <p className="text-xs text-rose-700">{error}</p>
            : <p className="text-xs text-ink-muted">{loading ? '…' : 'No preview yet. Save the job and answers, then refresh.'}</p>
        ) : (
          <div className="divide-y divide-line border border-line rounded-lg">
            {shown.map(([k, v]) => (
              <div key={k} className="flex gap-3 px-3 py-2 text-xs">
                <span className="w-2/5 text-ink-muted break-words">{humanize(k)}</span>
                <span className={clsx('flex-1 break-words', isBlank(v) ? 'text-ink-subtle' : 'text-ink')}>{showValue(v)}</span>
              </div>
            ))}
          </div>
        )}
        {values.length > 40 && (
          <button type="button" onClick={() => setShowAll(s => !s)} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-gold-700 hover:underline">
            {showAll ? 'Show fewer' : `Show all ${values.length}`} <ChevronDown className={clsx('w-3.5 h-3.5', showAll && 'rotate-180')} />
          </button>
        )}
        {preview?.notes?.length > 0 && (
          <ul className="mt-3 text-xs text-ink-muted space-y-1 list-disc pl-5">{preview.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        )}
      </section>
    </div>
  );
}
