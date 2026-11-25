// Searchable dropdown of AOC-4 filings grouped by company (name · CIN · FY end · status), newest first.
// Cancelled filings are hidden unless "Show cancelled" is ticked.
import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { ChevronDown, Search, Building2, Check } from 'lucide-react';
import { groupByCompany } from '../../lib/aoc4CompanyApi.js';
import { Badge } from './FieldRow.jsx';

const STATUS_TONE = { ready: 'gold', started: 'info', filling: 'info', filled: 'ok', completed: 'ok', done: 'ok', error: 'missing', needs_attention: 'missing', cancelled: 'neutral' };
const STATUS_LABEL = { ready: 'Queued', started: 'Loaded in extension', filling: 'Filling', needs_attention: 'Needs attention', filled: 'Filled', completed: 'Filled', done: 'Filled', error: 'Error', cancelled: 'Cancelled', unknown: 'Unknown' };

export const fmtWhen = s => {
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T') + (/[zZ+]/.test(String(s)) ? '' : 'Z'));
  return isNaN(d) ? String(s) : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

export function StatusBadge({ status }) {
  const s = status || 'unknown';
  return <Badge tone={STATUS_TONE[s] || 'neutral'}>{STATUS_LABEL[s] || s.replace(/_/g, ' ')}</Badge>;
}

export default function CompanyPicker({ filings, selectedId, onSelect, loading, className }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [showCancelled, setShowCancelled] = useState(false);
  const boxRef = useRef(null);
  const searchRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = e => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    const t = setTimeout(() => searchRef.current?.focus(), 0);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); clearTimeout(t); };
  }, [open]);

  const selected = filings.find(f => f.id === selectedId) || null;
  const cancelledCount = filings.filter(f => f.status === 'cancelled').length;

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const visible = filings.filter(f => (showCancelled || f.status !== 'cancelled')
      && (!needle || [f.companyName, f.cin, f.fyTo, f.status].some(x => String(x || '').toLowerCase().includes(needle))));
    return groupByCompany(visible);
  }, [filings, q, showCancelled]);

  const choose = id => { setOpen(false); setQ(''); onSelect(id); };

  return (
    <div ref={boxRef} className={clsx('relative', className)}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-haspopup="listbox" aria-expanded={open}
        className="w-full flex items-center gap-2 rounded-lg border border-line-input bg-white px-3 py-2 text-left text-sm text-ink hover:bg-gold-50/40 focus:outline-none focus:ring-2 focus:ring-gold-500 focus:border-gold-600">
        <Building2 className="w-4 h-4 text-gold-700 shrink-0" />
        <span className="flex-1 min-w-0 truncate">
          {selected
            ? <><span className="font-medium">{selected.companyName || 'Unnamed company'}</span><span className="text-ink-muted">{selected.fyTo ? ` · FY ending ${selected.fyTo}` : ''}</span></>
            : <span className="text-ink-muted">{loading ? 'Loading companies…' : 'Choose a company'}</span>}
        </span>
        <ChevronDown className={clsx('w-4 h-4 text-ink-muted shrink-0 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute right-0 left-0 sm:left-auto sm:w-[26rem] mt-1 z-30 rounded-xl border border-line bg-surface shadow-lg">
          <div className="p-2 border-b border-line">
            <label className="flex items-center gap-2 rounded-lg border border-line-input bg-white px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-gold-500">
              <Search className="w-4 h-4 text-ink-muted shrink-0" />
              <input ref={searchRef} value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name, CIN or year"
                aria-label="Search companies" className="flex-1 min-w-0 bg-transparent text-sm text-ink placeholder:text-ink-subtle focus:outline-none" />
            </label>
            {cancelledCount > 0 && (
              <label className="mt-2 flex items-center gap-2 text-xs text-ink-muted cursor-pointer select-none">
                <input type="checkbox" checked={showCancelled} onChange={e => setShowCancelled(e.target.checked)} className="accent-gold-700" />
                Show cancelled ({cancelledCount})
              </label>
            )}
          </div>
          <div role="listbox" aria-label="AOC-4 filings" className="max-h-80 overflow-y-auto p-1">
            {!groups.length && (
              <p className="px-3 py-4 text-xs text-ink-muted text-center">
                {loading ? 'Loading…' : filings.length ? 'Nothing matches your search.' : 'No AOC-4 filings yet. Add a new company.'}
              </p>
            )}
            {groups.map(g => (
              <div key={g.key} className="py-1">
                <p className="px-2.5 pt-1 pb-0.5 text-[11px] font-semibold text-ink truncate">
                  {g.companyName || 'Unnamed company'}{g.cin && <span className="font-normal text-ink-muted"> · {g.cin}</span>}
                </p>
                {g.filings.map(f => (
                  <button key={f.id} type="button" role="option" aria-selected={f.id === selectedId} onClick={() => choose(f.id)}
                    className={clsx('w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs',
                      f.id === selectedId ? 'bg-gold-50 text-gold-800' : 'text-ink hover:bg-gold-50/60')}>
                    <span className="w-3.5 shrink-0">{f.id === selectedId && <Check className="w-3.5 h-3.5" />}</span>
                    <span className="flex-1 min-w-0 truncate">
                      {f.fyTo ? `FY ending ${f.fyTo}` : 'FY not set'}
                      <span className="text-ink-muted"> · {fmtWhen(f.createdAt)}</span>
                    </span>
                    <StatusBadge status={f.status} />
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
