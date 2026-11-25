import clsx from 'clsx';
import { fieldProblem } from './aoc4Data.js';

const INPUT = 'w-full rounded-lg border border-line-input bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-subtle '
  + 'focus:outline-none focus:ring-2 focus:ring-gold-500 focus:border-gold-600 disabled:bg-page disabled:text-ink-muted';

export function Badge({ tone = 'neutral', children, title }) {
  const tones = {
    neutral: 'bg-page text-ink-muted border-line',
    gold: 'bg-gold-50 text-gold-800 border-gold-200',
    missing: 'bg-rose-50 text-rose-700 border-rose-200',
    ok: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    info: 'bg-sky-50 text-sky-700 border-sky-200',
    warn: 'bg-amber-50 text-amber-700 border-amber-200',
  };
  return (
    <span title={title} className={clsx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', tones[tone])}>
      {children}
    </span>
  );
}

const optValue = o => (typeof o === 'object' ? String(o.value) : String(o));
const optLabel = o => (typeof o === 'object' ? o.label || o.value : String(o));

// The input for one field by kind: text | date | number | pin | radio | select | textarea.
export function FieldInput({ field, value, onChange, id, disabled, invalid, describedBy }) {
  const v = value == null ? '' : String(value);
  const a11y = { 'aria-invalid': invalid || undefined, 'aria-describedby': describedBy };
  if ((field.kind === 'radio' || field.kind === 'select') && Array.isArray(field.options)) {
    const known = field.options.some(o => optValue(o) === v);
    return (
      <select id={id} {...a11y} className={INPUT} value={v} disabled={disabled} onChange={e => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {!known && v && <option value={v}>{v} (current)</option>}
        {field.options.map(o => <option key={optValue(o)} value={optValue(o)}>{optLabel(o)}</option>)}
      </select>
    );
  }
  if (field.kind === 'textarea') {
    return (
      <textarea id={id} {...a11y} className={clsx(INPUT, 'min-h-[84px]')} value={v} disabled={disabled}
        placeholder={field.default ? `Default: ${field.default}` : ''} onChange={e => onChange(e.target.value)} />
    );
  }
  return (
    <input
      id={id}
      {...a11y}
      className={clsx(INPUT, field.kind === 'number' && 'text-right tabular-nums')}
      value={v}
      disabled={disabled}
      maxLength={field.maxLength}
      inputMode={field.kind === 'number' ? 'decimal' : field.kind === 'pin' ? 'numeric' : undefined}
      placeholder={field.kind === 'date' ? 'DD/MM/YYYY' : field.default ? `Default: ${field.default}` : ''}
      onChange={e => onChange(e.target.value)}
    />
  );
}

// Label + input + badges + hint/problem line.
export default function FieldRow({ field, value, onChange, required, source, dirty, suggestion, onUseSuggestion }) {
  const empty = value == null || String(value).trim() === '';
  const problem = fieldProblem(field, value);
  const id = `f_${field.key}`;
  return (
    <div className={clsx('rounded-lg border p-3 transition-colors',
      dirty ? 'border-gold-300 bg-gold-50/40' : required && empty ? 'border-rose-200 bg-rose-50/30' : 'border-line bg-white')}>
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <label htmlFor={id} className="text-xs font-medium text-ink leading-snug">{field.label}</label>
        <div className="flex flex-wrap justify-end gap-1 shrink-0">
          {required && empty && <Badge tone="missing">Missing</Badge>}
          {required && !empty && <Badge tone="ok">Required</Badge>}
          {field.mcaFills && empty && <Badge tone="info" title="MCA usually fills this itself; fill it only if MCA leaves it empty">MCA fills</Badge>}
          {source === 'answers' && <Badge tone="gold" title="Saved earlier in the company master">Company master</Badge>}
          {dirty && <Badge tone="gold">Edited</Badge>}
        </div>
      </div>
      <FieldInput field={field} value={value} onChange={onChange} id={id} invalid={!!problem} describedBy={problem ? `${id}_err` : undefined} />
      {problem ? (
        <p id={`${id}_err`} className="mt-1 text-[11px] text-rose-700">{problem}</p>
      ) : suggestion && empty ? (
        <p className="mt-1 text-[11px] text-ink-muted">
          Suggested: <span className="font-medium text-ink">{suggestion.value}</span>
          {suggestion.from && <> (from {suggestion.from})</>}{' '}
          <button type="button" onClick={onUseSuggestion} className="text-gold-700 font-semibold hover:underline">Use</button>
        </p>
      ) : field.hint ? (
        <p className="mt-1 text-[11px] text-ink-subtle">{field.hint}</p>
      ) : null}
    </div>
  );
}
