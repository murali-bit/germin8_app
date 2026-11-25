import React, { useId, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CircleAlert, CircleCheck, Info, TriangleAlert, Upload, X } from 'lucide-react';

/*
  SHARED UI PIECES (colours come from the tokens in index.css: ink, muted, subtle, line, soft, brand, action,
  success / warning / danger / info with -ink and -soft). Import what you need from '../../components/ui'.

  STRINGS (class names)
    btnPrimary    blue main button.            btnSecondary  white button with grey border.
    btnDanger     red button (delete, discard). btnGhost      text-only button for quiet actions.
    btnSmall      add to any button class for a compact 32px button (table rows, toolbars): `${btnSecondary} ${btnSmall}`.
    inputClass    text input, select, textarea (40px high, blue focus ring).
    friendlyError(message) -> plain sentence for an error message.

  COMPONENTS (all props optional unless marked *)
    PageHeader    { title*, breadcrumb: [{ label, onClick? }], actions (node, right side), help (one short line below
                  the title), children (extra row under the help line, for example a status chip) }.
    SectionTitle  { title*, help (small grey line), right (node) }  a heading inside a page, above a card or a table.
    Card          { title, subtitle, right (node in the header), children, className, padded (adds 16px padding) }.
    Table         { columns*: [{ key, label, align: 'right'?, render(row)?, className? }], rows*, empty, onRowClick,
                  rowKey, compact, sticky (header stays visible, wrap in a card), selection: { keys: Set, onChange(Set) }
                  (adds a checkbox column; rowKey is then required and must return the same value as the keys) }.
    StatusChip    { tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral' (default neutral), dot (small dot before
                  the text), children*, title }.  Use short words: Ready, Needs a decision, Refused, Not checked.
    StatTile      { label*, value*, hint, tone (colours the value: success | warning | danger | info), icon (a lucide
                  component), onClick (makes the tile a button) }.
    Toolbar       { children (left: search, filters), right (node) }  the row above a table.
    BulkBar       { count*, onClear, children (the bulk actions) }  shows "N selected"; renders nothing when count is 0.
    Field         { label*, hint, error, required, htmlFor, children } children is the control, or a function id => control.
                  The label sits above the control; the error is read out by screen readers.
    Stepper       { steps*: [string | { label }], current* (0-based index), onStepClick(index) (only for steps already
                  reached), ariaLabel }  horizontal numbered circles; labels shrink on small screens.
    ActionBar     { onBack, backLabel = 'Back', onNext, nextLabel = 'Continue', nextDisabled, busy, nextType, form,
                  info (centre text), children (extra buttons before the main one), sticky = true }  pinned bottom bar,
                  Back on the left, the main action on the right. Put it last inside a column that is min-h-full.
    EmptyState    { icon (lucide component), title*, text, actionLabel, onAction, children }  one clear action.
    Blocked       { title, text, button, onClick }  a screen that needs an earlier step first.
    Note          { children, tone: 'info' | 'success' | 'warning' | 'danger' (default info), title }  inline message.
    FileButton    { label*, accept, onFile(file)*, className }  opens a file picker.
*/

const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';
const btnBase = `inline-flex items-center justify-center gap-2 rounded-md text-[14px] font-medium transition-colors whitespace-nowrap ${focusRing} disabled:opacity-50 disabled:cursor-not-allowed`;

export const btnPrimary = `min-h-10 px-4 py-2 bg-action hover:bg-action-hover text-white font-semibold shadow-xs ${btnBase}`;
export const btnSecondary = `min-h-10 px-4 py-2 border border-line-strong bg-white hover:bg-soft text-ink ${btnBase}`;
export const btnDanger = `min-h-10 px-4 py-2 bg-danger-ink hover:brightness-90 text-white font-semibold shadow-xs ${btnBase}`;
export const btnGhost = `min-h-10 px-3 py-2 text-info-ink hover:bg-brand-soft ${btnBase}`;
export const btnSmall = '!min-h-8 !px-3 !py-1 !text-[13px]';
export const inputClass = 'w-full min-h-10 bg-white border border-line-strong rounded-md px-3 py-2 text-[14px] text-ink placeholder:text-subtle focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 disabled:bg-soft disabled:text-subtle';

// Turns a technical error message into a plain sentence people can act on.
export const friendlyError = message => {
  const text = String(message || '');
  if (!text) return '';
  if (/cannot reach|npm start|failed to fetch/i.test(text)) return 'We could not reach the service. Check your internet connection and try again.';
  if (/^request failed/i.test(text)) return 'Something went wrong. Please try again.';
  return text;
};

const TONES = {
  success: { chip: 'bg-success-soft text-success-ink border-success-line', dot: 'bg-success', box: 'bg-success-soft border-success-line text-ink', icon: CircleCheck, iconColor: 'text-success-ink', value: 'text-success-ink' },
  warning: { chip: 'bg-warning-soft text-warning-ink border-warning-line', dot: 'bg-warning', box: 'bg-warning-soft border-warning-line text-ink', icon: TriangleAlert, iconColor: 'text-warning-ink', value: 'text-warning-ink' },
  danger: { chip: 'bg-danger-soft text-danger-ink border-danger-line', dot: 'bg-danger', box: 'bg-danger-soft border-danger-line text-ink', icon: CircleAlert, iconColor: 'text-danger-ink', value: 'text-danger-ink' },
  info: { chip: 'bg-info-soft text-info-ink border-info-line', dot: 'bg-info', box: 'bg-info-soft border-info-line text-ink', icon: Info, iconColor: 'text-info-ink', value: 'text-info-ink' },
  neutral: { chip: 'bg-soft text-muted border-line', dot: 'bg-subtle', box: 'bg-soft border-line text-ink', icon: Info, iconColor: 'text-muted', value: 'text-ink' },
};
const tone = name => TONES[name] || TONES.neutral;

export function StatusChip({ tone: t = 'neutral', dot = false, children, title }) {
  const c = tone(t);
  return (
    <span title={title} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-medium leading-5 whitespace-nowrap ${c.chip}`}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} aria-hidden="true" />}
      {children}
    </span>
  );
}

export function PageHeader({ title, breadcrumb, actions, help, children }) {
  return (
    <div className="pb-4 mb-1">
      {breadcrumb?.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-1.5">
          <ol className="flex flex-wrap items-center gap-1 text-[13px] text-muted">
            {breadcrumb.map((b, i) => (
              <li key={i} className="inline-flex items-center gap-1">
                {i > 0 && <span aria-hidden="true">/</span>}
                {b.onClick
                  ? <button type="button" onClick={b.onClick} className={`text-info-ink hover:underline rounded-sm ${focusRing}`}>{b.label}</button>
                  : <span aria-current={i === breadcrumb.length - 1 ? 'page' : undefined}>{b.label}</span>}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 className="text-[22px] leading-tight font-semibold tracking-tight text-ink min-w-0">{title}</h1>
        {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
      </div>
      {help && <p className="text-[14px] text-muted mt-1 max-w-3xl">{help}</p>}
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

export function SectionTitle({ title, help, right }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 mb-3">
      <div className="min-w-0">
        <h2 className="text-[16px] font-semibold tracking-tight text-ink">{title}</h2>
        {help && <p className="text-[13px] text-muted mt-0.5">{help}</p>}
      </div>
      {right && <div className="shrink-0 flex items-center gap-2">{right}</div>}
    </div>
  );
}

export function Card({ title, subtitle, right, children, className = '', padded = false }) {
  return (
    <div className={`border border-line rounded-lg bg-white shadow-xs overflow-hidden ${className}`}>
      {(title || right) && (
        <div className="px-4 py-3 border-b border-line flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            {title && <h3 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h3>}
            {subtitle && <p className="text-[13px] text-muted mt-0.5">{subtitle}</p>}
          </div>
          {right}
        </div>
      )}
      {padded ? <div className="p-4">{children}</div> : children}
    </div>
  );
}

export function EmptyState({ icon: Icon = Info, title, text, actionLabel, onAction, children }) {
  return (
    <div className="px-6 py-10 text-center">
      <span className="mx-auto mb-3 w-12 h-12 rounded-full bg-brand-soft text-info-ink flex items-center justify-center">
        <Icon className="w-5 h-5" strokeWidth={1.75} aria-hidden="true" />
      </span>
      <div className="text-[16px] font-semibold tracking-tight text-ink">{title}</div>
      {text && <p className="text-[14px] text-muted mt-1 max-w-md mx-auto">{text}</p>}
      {actionLabel && <button type="button" onClick={onAction} className={`${btnPrimary} mt-4`}>{actionLabel}</button>}
      {children}
    </div>
  );
}

// Shown when a screen needs a step that has not been done yet.
export function Blocked({ title, text, button, onClick }) {
  return (
    <div className="border border-line rounded-lg bg-white shadow-xs">
      <EmptyState title={title} text={text} actionLabel={button} onAction={onClick} />
    </div>
  );
}

export function Note({ children, tone: t = 'info', title }) {
  const c = tone(t);
  const Icon = c.icon;
  return (
    <div className={`p-3.5 rounded-md border text-[14px] flex items-start gap-3 ${c.box}`}>
      <Icon className={`w-[18px] h-[18px] shrink-0 mt-0.5 ${c.iconColor}`} strokeWidth={1.75} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title && <div className="font-semibold text-ink mb-0.5">{title}</div>}
        {children}
      </div>
    </div>
  );
}

export function StatTile({ label, value, hint, tone: t, icon: Icon, onClick }) {
  const c = t ? tone(t) : null;
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] text-muted">{label}</span>
        {Icon && <Icon className="w-4 h-4 text-subtle shrink-0" strokeWidth={1.75} aria-hidden="true" />}
      </div>
      <div className={`mt-1 text-[24px] leading-tight font-semibold tabular-nums tracking-tight ${c ? c.value : 'text-ink'}`}>{value}</div>
      {hint && <div className="mt-1 text-[13px] text-muted">{hint}</div>}
    </>
  );
  const cls = 'block w-full text-left border border-line rounded-lg bg-white shadow-xs px-4 py-3';
  return onClick
    ? <button type="button" onClick={onClick} className={`${cls} hover:bg-soft transition-colors ${focusRing}`}>{body}</button>
    : <div className={cls}>{body}</div>;
}

export function Toolbar({ children, right }) {
  return (
    <div className="px-4 py-3 border-b border-line bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2 min-w-0">{children}</div>
      {right && <div className="flex flex-wrap items-center gap-2 shrink-0">{right}</div>}
    </div>
  );
}

export function BulkBar({ count, onClear, children }) {
  if (!count) return null;
  return (
    <div role="status" className="px-4 py-2 border-b border-info-line bg-brand-soft flex flex-wrap items-center gap-3 text-[14px]">
      <span className="font-semibold text-info-ink">{count.toLocaleString('en-IN')} selected</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      {onClear && (
        <button type="button" onClick={onClear} className={`ml-auto inline-flex items-center gap-1 text-[13px] text-info-ink hover:underline rounded-sm ${focusRing}`}>
          <X className="w-3.5 h-3.5" aria-hidden="true" /> Clear
        </button>
      )}
    </div>
  );
}

export function Field({ label, hint, error, required, htmlFor, children }) {
  const auto = useId();
  const id = htmlFor || auto;
  const note = `${id}-note`;
  return (
    <div className="block">
      <label htmlFor={id} className="block text-[13px] font-medium text-ink mb-1.5">
        {label}{required && <span className="text-danger-ink" aria-hidden="true"> *</span>}
      </label>
      {typeof children === 'function' ? children(id) : children}
      {hint && !error && <p id={note} className="text-[13px] text-muted mt-1">{hint}</p>}
      {error && <p id={note} role="alert" className="text-[13px] text-danger-ink mt-1">{error}</p>}
    </div>
  );
}

// columns: [{ key, label, align?, render?(row), className? }]
// selection: { keys: Set, onChange(Set) } adds a checkbox column (needs rowKey).
export function Table({ columns, rows, empty = 'Nothing to show.', onRowClick, rowKey, compact = false, sticky = false, selection }) {
  if (!rows.length) return <div className="px-4 py-6 text-[14px] text-muted">{empty}</div>;
  const keyOf = (r, i) => (rowKey ? rowKey(r) : i);
  const pad = compact ? 'py-2 px-3' : 'py-2.5 px-4';
  const all = !!selection && rows.every((r, i) => selection.keys.has(keyOf(r, i)));
  const some = !!selection && !all && rows.some((r, i) => selection.keys.has(keyOf(r, i)));
  const toggleAll = () => selection.onChange(all ? new Set() : new Set(rows.map(keyOf)));
  const toggleOne = k => { const next = new Set(selection.keys); if (next.has(k)) next.delete(k); else next.add(k); selection.onChange(next); };
  return (
    <div className={`overflow-x-auto ${sticky ? 'table-sticky' : ''}`}>
      <table className="w-full text-left text-[13px]">
        <thead className="bg-soft border-b border-line text-[12px] uppercase tracking-wide text-muted">
          <tr>
            {selection && (
              <th scope="col" className={`${pad} w-10`}>
                <input type="checkbox" aria-label="Select all rows" checked={all} ref={el => { if (el) el.indeterminate = some; }} onChange={toggleAll} className="w-4 h-4 align-middle" />
              </th>
            )}
            {columns.map(c => <th key={c.key} scope="col" className={`${pad} font-semibold whitespace-nowrap bg-soft ${c.align === 'right' ? 'text-right' : ''} ${c.className || ''}`}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r, i) => {
            const k = keyOf(r, i);
            const picked = !!selection && selection.keys.has(k);
            return (
              <tr
                key={k}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                onKeyDown={onRowClick ? e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onRowClick(r); } } : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                className={`hover:bg-soft ${picked ? 'bg-brand-soft' : ''} ${onRowClick ? 'cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand' : ''}`}
              >
                {selection && (
                  <td className={`${pad} w-10`}>
                    <input type="checkbox" aria-label="Select this row" checked={picked} onChange={() => toggleOne(k)} onClick={e => e.stopPropagation()} className="w-4 h-4 align-middle" />
                  </td>
                )}
                {columns.map(c => (
                  <td key={c.key} className={`${pad} text-ink ${c.align === 'right' ? 'text-right tabular-nums whitespace-nowrap' : ''} ${c.className || ''}`}>
                    {c.render ? c.render(r) : r[c.key]}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Horizontal numbered steps. Steps before the current one show a tick; only those can be clicked (onStepClick).
export function Stepper({ steps, current, onStepClick, ariaLabel = 'Steps' }) {
  return (
    <nav aria-label={ariaLabel}>
      <ol className="flex items-start w-full">
        {steps.map((s, i) => {
          const label = typeof s === 'string' ? s : s.label;
          const done = i < current;
          const here = i === current;
          const clickable = done && onStepClick;
          const circle = (
            <span className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-[13px] font-semibold border ${
              done ? 'bg-success-ink border-success-ink text-white' : here ? 'bg-action border-action text-white' : 'bg-white border-line-strong text-muted'}`}>
              {done ? <Check className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" /> : i + 1}
            </span>
          );
          const text = <span className={`mt-1.5 text-[12px] leading-tight text-center hidden md:block ${here ? 'font-semibold text-ink' : 'text-muted'}`}>{label}</span>;
          return (
            <li key={i} aria-current={here ? 'step' : undefined} className="flex-1 min-w-0 flex flex-col items-center relative">
              {i > 0 && <span className={`absolute top-3.5 right-1/2 w-full h-0.5 -translate-y-1/2 ${i <= current ? 'bg-success-ink' : 'bg-line'}`} aria-hidden="true" />}
              {clickable
                ? <button type="button" onClick={() => onStepClick(i)} className={`relative flex flex-col items-center px-1 rounded-md ${focusRing}`}>{circle}{text}<span className="sr-only md:hidden">{label}</span><span className="sr-only">, done. Go back to this step</span></button>
                : <span className="relative flex flex-col items-center px-1">{circle}{text}<span className="sr-only md:hidden">{label}</span><span className="sr-only">{done ? ', done' : here ? ', current step' : ', not started'}</span></span>}
            </li>
          );
        })}
      </ol>
      {steps[current] && <p className="mt-2 text-center text-[13px] text-muted md:hidden" aria-hidden="true">Step {current + 1} of {steps.length}: {typeof steps[current] === 'string' ? steps[current] : steps[current].label}</p>}
    </nav>
  );
}

// Pinned bottom bar: Back on the left, the main action on the right.
export function ActionBar({ onBack, backLabel = 'Back', onNext, nextLabel = 'Continue', nextDisabled = false, busy = false, nextType = 'button', form, info, children, sticky = true }) {
  return (
    <nav aria-label="Step navigation" className={`${sticky ? 'sticky bottom-0 z-20' : ''} border-t border-line bg-white/95 backdrop-blur`}>
      <div className="px-4 sm:px-6 py-3 max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-3">
        {onBack
          ? <button type="button" onClick={onBack} className={btnSecondary}><ArrowLeft className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /> <span className="truncate max-w-[14rem]">{backLabel}</span></button>
          : <span />}
        {info && <div className="hidden md:block min-w-0 text-[13px] text-muted text-center">{info}</div>}
        <div className="flex flex-wrap items-center gap-2">
          {children}
          {(onNext || nextType === 'submit') && (
            <button type={nextType} form={form} onClick={nextType === 'submit' ? undefined : onNext} disabled={nextDisabled || busy} className={btnPrimary}>
              <span className="truncate max-w-[16rem]">{busy ? 'Saving…' : nextLabel}</span> <ArrowRight className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}

// A button that opens a file picker and hands the chosen file to onFile (which may throw to show an error).
export function FileButton({ label, accept = '.csv,text/csv', onFile, className = btnSecondary }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pick = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true); setError('');
    try { await onFile(file); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <span className="inline-flex flex-col items-start gap-1.5">
      <input ref={input} type="file" accept={accept} className="hidden" onChange={pick} tabIndex={-1} aria-hidden="true" />
      <button type="button" onClick={() => input.current?.click()} disabled={busy} className={className}>
        <Upload className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /> {busy ? 'Checking file…' : label}
      </button>
      {error && <span role="alert" className="text-[13px] text-danger-ink max-w-md"><strong>File not accepted.</strong> {error}</span>}
    </span>
  );
}
