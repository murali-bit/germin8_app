// "+ New company": CIN + financial year → fetch company details (FileSure, optional) → create an AOC-4 filing.
// Guards duplicates: an open filing for the same CIN and FY end is offered instead of a second one.
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { X, Search, Plus, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import {
  normCin, cinProblem, fyProblem, defaultFy, toDdMmYyyy, lookupCompany, createAoc4Filing, findDuplicate,
} from '../../lib/aoc4CompanyApi.js';
import { StatusBadge, fmtWhen } from './CompanyPicker.jsx';

const INPUT = 'w-full rounded-lg border border-line-input bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-subtle '
  + 'focus:outline-none focus:ring-2 focus:ring-gold-500 focus:border-gold-600 disabled:bg-page disabled:text-ink-muted';

function Field({ label, hint, error, children, id }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-ink mb-1">{label}</label>
      {children}
      {error ? <p className="mt-1 text-[11px] text-rose-700">{error}</p> : hint ? <p className="mt-1 text-[11px] text-ink-muted">{hint}</p> : null}
    </div>
  );
}

const EMPTY_DETAILS = { companyName: '', registeredAddress: '', email: '', companyClass: '', companyCategory: '' };

export default function NewCompanyDialog({ open, onClose, filings = [], onCreated, onOpenExisting }) {
  const [cin, setCin] = useState('');
  const [fyFrom, setFyFrom] = useState('');
  const [fyTo, setFyTo] = useState('');
  const [details, setDetails] = useState(EMPTY_DETAILS);
  const [lookup, setLookup] = useState({ state: 'idle', message: '' });   // idle | loading | ok | failed
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const firstRef = useRef(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  // Reset only when the dialog opens (not on every parent render).
  useEffect(() => {
    if (!open) return undefined;
    const fy = defaultFy();
    setCin(''); setFyFrom(fy.from); setFyTo(fy.to); setDetails(EMPTY_DETAILS);
    setLookup({ state: 'idle', message: '' }); setTouched(false); setBusy(false); setError('');
    const t = setTimeout(() => firstRef.current?.focus(), 0);
    const onKey = e => { if (e.key === 'Escape') closeRef.current?.(); };
    document.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (!open) return null;

  const cinErr = cinProblem(cin);
  const fyErr = fyProblem(fyFrom, fyTo);
  const nameErr = details.companyName.trim() ? null : 'Enter the company name (or fetch it from the CIN).';
  const duplicate = !cinErr && !fyErr ? findDuplicate(filings, cin, fyTo) : null;

  const setD = (k, v) => setDetails(d => ({ ...d, [k]: v }));

  const onFetch = async () => {
    setTouched(true);
    if (cinErr) return;
    setLookup({ state: 'loading', message: '' });
    const r = await lookupCompany(cin);
    if (r.ok) {
      setDetails(d => ({
        companyName: r.details.companyName || d.companyName,
        registeredAddress: r.details.registeredAddress || d.registeredAddress,
        email: r.details.email || d.email,
        companyClass: r.details.companyClass || d.companyClass,
        companyCategory: r.details.companyCategory || d.companyCategory,
      }));
      setLookup({ state: 'ok', message: `Found ${r.details.companyName}${r.details.status ? ` (${r.details.status})` : ''}. Check the details below.` });
    } else {
      setLookup({ state: 'failed', message: `Could not fetch the company details (${r.error}). Type the company name below.` });
    }
  };

  const onCreate = async () => {
    setTouched(true); setError('');
    if (cinErr || fyErr || nameErr || duplicate) return;
    setBusy(true);
    try {
      const jobId = await createAoc4Filing({
        cin, fyFrom, fyTo,
        details: Object.fromEntries(Object.entries(details).map(([k, v]) => [k, String(v || '').trim()])),
      });
      onCreated?.(jobId);
    } catch (err) {
      setError(err?.message || 'The filing could not be created.');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="aoc4-new-company-title"
        className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-line bg-surface shadow-xl text-ink">
        <div className="flex items-start justify-between gap-3 p-4 sm:p-5 border-b border-line">
          <div>
            <h3 id="aoc4-new-company-title" className="text-base font-semibold">New company</h3>
            <p className="text-xs text-ink-muted mt-0.5">Start an AOC-4 filing for a company that is not in the list yet.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-ink-muted hover:bg-gold-50 hover:text-ink">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          <Field id="aoc4-new-cin" label="CIN" error={touched || cin.length >= 21 ? cinErr : null}
            hint="21 characters, for example U12345MH2020PTC000001.">
            <div className="flex flex-col sm:flex-row gap-2">
              <input id="aoc4-new-cin" ref={firstRef} value={cin} maxLength={25} autoComplete="off" spellCheck={false}
                onChange={e => { setCin(normCin(e.target.value)); setLookup({ state: 'idle', message: '' }); }}
                placeholder="U12345MH2020PTC000001" className={clsx(INPUT, 'font-mono uppercase')} />
              <button type="button" onClick={onFetch} disabled={lookup.state === 'loading'}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-gold-300 bg-gold-50 px-3 py-2 text-sm font-semibold text-gold-800 hover:bg-gold-100 disabled:opacity-60 whitespace-nowrap">
                {lookup.state === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Fetch company details
              </button>
            </div>
          </Field>

          {lookup.message && (
            <p className={clsx('text-xs flex items-start gap-1.5', lookup.state === 'ok' ? 'text-emerald-700' : 'text-amber-700')}>
              {lookup.state === 'ok' ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
              <span>{lookup.message}</span>
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field id="aoc4-new-fy-from" label="Financial year from" error={touched && !toDdMmYyyy(fyFrom) ? 'Use DD/MM/YYYY.' : null}>
              <input id="aoc4-new-fy-from" value={fyFrom} onChange={e => setFyFrom(e.target.value)} placeholder="DD/MM/YYYY" inputMode="numeric" className={INPUT} />
            </Field>
            <Field id="aoc4-new-fy-to" label="Financial year to" error={touched && fyErr && toDdMmYyyy(fyFrom) ? fyErr : null}>
              <input id="aoc4-new-fy-to" value={fyTo} onChange={e => setFyTo(e.target.value)} placeholder="DD/MM/YYYY" inputMode="numeric" className={INPUT} />
            </Field>
          </div>

          <Field id="aoc4-new-name" label="Company name" error={touched ? nameErr : null}>
            <input id="aoc4-new-name" value={details.companyName} onChange={e => setD('companyName', e.target.value)} placeholder="As registered with MCA" className={INPUT} />
          </Field>
          <Field id="aoc4-new-addr" label="Registered address" hint="Optional — MCA fills it from the CIN.">
            <textarea id="aoc4-new-addr" rows={2} value={details.registeredAddress} onChange={e => setD('registeredAddress', e.target.value)} className={INPUT} />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field id="aoc4-new-email" label="Email (optional)">
              <input id="aoc4-new-email" type="email" value={details.email} onChange={e => setD('email', e.target.value)} className={INPUT} />
            </Field>
            <Field id="aoc4-new-class" label="Class (optional)">
              <input id="aoc4-new-class" value={details.companyClass} onChange={e => setD('companyClass', e.target.value)} placeholder="Private" className={INPUT} />
            </Field>
            <Field id="aoc4-new-cat" label="Category (optional)">
              <input id="aoc4-new-cat" value={details.companyCategory} onChange={e => setD('companyCategory', e.target.value)} placeholder="Limited by shares" className={INPUT} />
            </Field>
          </div>

          {duplicate && (
            <div className="rounded-lg border border-gold-200 bg-gold-50/70 p-3 text-xs text-ink space-y-2">
              <p className="flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-gold-700 shrink-0" />
                <span>There is already an AOC-4 filing for <span className="font-medium">{duplicate.companyName || duplicate.cin}</span> for the year ending {duplicate.fyTo} ({fmtWhen(duplicate.createdAt)}).</span>
              </p>
              <div className="flex items-center gap-2">
                <StatusBadge status={duplicate.status} />
                <button type="button" onClick={() => onOpenExisting?.(duplicate.id)}
                  className="rounded-lg bg-gold-700 hover:bg-gold-800 px-3 py-1.5 text-xs font-semibold text-white">Open that filing</button>
              </div>
            </div>
          )}

          {error && <p className="text-xs text-rose-700 flex items-start gap-1.5"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />{error}</p>}
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 p-4 sm:p-5 border-t border-line">
          <button type="button" onClick={onClose} className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink hover:bg-gold-50">Cancel</button>
          <button type="button" onClick={onCreate} disabled={busy || !!duplicate}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-gold-700 hover:bg-gold-800 px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} {busy ? 'Creating…' : 'Create filing'}
          </button>
        </div>
      </div>
    </div>
  );
}
