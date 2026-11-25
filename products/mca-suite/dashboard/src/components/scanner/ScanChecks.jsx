// Scanner review helpers (spec v6, Step 4): where each value came from, and the "Check these" list the
// backend's enrich step returns (POST /api/scan/enrich → checks).
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import clsx from 'clsx';

// Where a value came from. `document` is the default and is not tagged on every field.
export const SOURCE_KIND = {
  document: { label: 'Document', cls: 'bg-page text-ink-subtle border-line' },
  excel: { label: 'Excel', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  records: { label: 'Company records', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  derived: { label: 'Worked out', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  answer: { label: 'Your answer', cls: 'bg-gold-100 text-gold-800 border-gold-200' },
};

/** Small source tag next to a value; `file` (when known) is shown on hover. */
export function SourceKindTag({ kind, file }) {
  const k = SOURCE_KIND[kind];
  if (!k) return null;
  const title = file ? `${k.label} — ${file}` : k.label;
  return (
    <span title={title} className={clsx('text-[9px] font-semibold px-1 py-px rounded border shrink-0 cursor-help whitespace-nowrap', k.cls)}>
      {k.label}<span className="sr-only">{file ? ` — from ${file}` : ''}</span>
    </span>
  );
}

/** "a.b[2].c" → ['a', 'b', 2, 'c'] */
export function parsePath(dotted) {
  const out = [];
  for (const part of String(dotted || '').split('.')) {
    const m = part.match(/^([^[]*)((?:\[\d+\])*)$/);
    if (!m) { out.push(part); continue; }
    if (m[1]) out.push(m[1]);
    for (const n of m[2].matchAll(/\[(\d+)\]/g)) out.push(Number(n[1]));
  }
  return out;
}

const inr = n => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

/**
 * The enrich checks still open. `onAnswer(check, yes)` answers a managerial-remuneration question;
 * `onDismiss(check)` marks any other item as checked.
 */
export default function ScanChecks({ checks, labelOf, onAnswer, onDismiss }) {
  if (!checks?.length) return null;
  return (
    <div className="bg-surface border border-amber-200 rounded-xl shadow-sm p-4">
      <p className="text-sm font-semibold text-ink flex items-center gap-1.5 flex-wrap">
        <AlertTriangle className="w-4 h-4 text-amber-600" /> Check these
        <span className="text-xs font-semibold text-amber-700">· {checks.length} item{checks.length === 1 ? '' : 's'}</span>
      </p>
      <p className="text-[11px] text-ink-muted mt-0.5">
        Results of the rules run on the merged scan (break-ups, duplicates, company records…). Nothing here was changed without telling you.
      </p>
      <ul className="mt-2 divide-y divide-line">
        {checks.map(c => {
          const managerial = c.action?.type === 'managerial-remuneration';
          return (
            <li key={c.id} className="py-2 flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-3">
              <div className="flex items-start gap-2 flex-1 min-w-0">
                {c.level === 'info'
                  ? <Info className="w-3.5 h-3.5 text-sky-600 shrink-0 mt-0.5" />
                  : <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />}
                <div className="min-w-0">
                  <p className="text-xs text-ink break-words">{c.message}</p>
                  {managerial && (
                    <p className="text-[11px] text-ink-muted mt-0.5">
                      Yes moves {inr(c.action.amount)} ({c.action.per === 'previous' ? 'previous' : 'current'} year) from employee benefits to managerial remuneration — the expense total stays the same.
                    </p>
                  )}
                  {c.paths?.length > 0 && (
                    <p className="text-[10px] text-ink-subtle mt-0.5 break-words">{c.paths.map(p => labelOf(parsePath(p))).join(' · ')}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {managerial ? (
                  <>
                    <button type="button" onClick={() => onAnswer(c, true)}
                      className="px-3 py-1 rounded-lg bg-gold-700 hover:bg-gold-800 text-white text-[11px] font-semibold cursor-pointer">
                      Yes
                    </button>
                    <button type="button" onClick={() => onAnswer(c, false)}
                      className="px-3 py-1 rounded-lg border border-line-strong text-ink text-[11px] font-semibold hover:bg-gold-50 cursor-pointer">
                      No
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={() => onDismiss(c)} title="Mark as checked"
                    className="px-2.5 py-1 rounded-lg border border-line-strong text-ink text-[11px] font-semibold hover:bg-gold-50 cursor-pointer flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Checked
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
