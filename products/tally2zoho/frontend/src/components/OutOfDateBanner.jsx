import React, { useState } from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { api, isProcessed } from '../api';
import { btnPrimary, btnSecondary, friendlyError } from './ui';
import { uniqueReasons } from '../mappingLogic';

export const readableWhen = value => {
  const d = new Date(value);
  if (!value || Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
};

// Shown when the files created for a migration no longer match what they are built from. The server says nothing is out
// of date when a change was undone (the net change is zero), so the banner is then not shown.
// job: the migration as returned by the server. onDone: called after the files were created again (reload the page data there).
export default function OutOfDateBanner({ job, user, onDone, onNavigate }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);
  const reasons = uniqueReasons(job?.outOfDateReasons);
  if (!job?.filesOutOfDate || (Array.isArray(job.outOfDateReasons) && reasons.length === 0)) return null;

  const viewer = user?.role === 'viewer';
  const shown = showAll ? reasons : reasons.slice(0, 4);
  const canCreate = isProcessed(job);
  const count = (job.outOfDateFiles || []).length;

  const create = async () => {
    setBusy(true); setError('');
    try {
      await api.post(`/migrations/${job.id}/generate`);
      if (onDone) await onDone();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section role="status" aria-label="Files are out of date" className="rounded-lg border border-warning-line bg-warning-soft p-5 flex flex-col lg:flex-row lg:items-start justify-between gap-4">
      <div className="flex items-start gap-3 min-w-0">
        <span className="w-10 h-10 rounded-xl bg-soft flex items-center justify-center shrink-0">
          <TriangleAlert className="w-5 h-5 text-ink" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold tracking-tight text-ink">
            {count > 0 ? `${count} ${count === 1 ? 'file is' : 'files are'} out of date` : 'The files are out of date'}
          </h2>
          <p className="text-[14px] text-muted mt-0.5">
            Something the files are built from changed after they were created. Out-of-date files cannot be downloaded or marked as imported until they are created again.
          </p>
          {reasons.length > 0 && (
            <ul className="mt-2.5 space-y-1.5 text-[14px] text-ink">
              {shown.map((r, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-2 w-1.5 h-1.5 rounded-full bg-warning shrink-0" aria-hidden="true" />
                  <span>
                    {r.reason}{r.times > 1 ? ` (${r.times} times)` : ''}
                    {(r.by || r.at) && (
                      <span className="text-subtle"> {r.by ? `Changed by ${r.by}` : 'Changed'}{readableWhen(r.at) ? ` on ${readableWhen(r.at)}` : ''}.</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {reasons.length > 4 && (
            <button type="button" onClick={() => setShowAll(v => !v)} className="mt-2 text-[14px] font-medium text-ink underline">
              {showAll ? 'Show fewer changes' : `Show all ${reasons.length} changes`}
            </button>
          )}
          {viewer && <p className="mt-2.5 text-[14px] text-muted">You have view-only access. Someone on your team needs to create the files again.</p>}
          {!viewer && !canCreate && <p className="mt-2.5 text-[14px] text-muted">The data has to be read again before the files can be created again.</p>}
          {error && <p role="alert" className="mt-2.5 text-[14px] text-ink"><strong>The files could not be created.</strong> {friendlyError(error)}</p>}
        </div>
      </div>
      {!viewer && canCreate && (
        <button type="button" onClick={create} disabled={busy} className={`${btnPrimary} shrink-0 self-start`}>
          <RefreshCw className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /> {busy ? 'Creating the files…' : 'Create the files again'}
        </button>
      )}
      {!viewer && !canCreate && onNavigate && (
        <button type="button" onClick={() => onNavigate('screen-16')} className={`${btnSecondary} shrink-0 self-start`}>Open Completeness Check</button>
      )}
    </section>
  );
}
