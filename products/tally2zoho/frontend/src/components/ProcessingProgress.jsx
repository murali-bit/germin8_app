import React from 'react';
import { ArrowRight, Loader2, TriangleAlert } from 'lucide-react';
import { formatDuration } from '../api';
import { readableWhen } from './OutOfDateBanner';
import { btnSecondary } from './ui';

// Live progress of a processing run. status: the answer of GET process-status.
// compact: a short version for other screens, with a link to Processing Status.
export default function ProcessingProgress({ status, compact = false, onNavigate }) {
  if (!status) return null;
  const queued = status.state === 'queued';
  const percent = Math.max(0, Math.min(100, Number(status.percent) || 0));
  const total = status.recordsTotal;
  const left = status.estimatedSecondsRemaining;

  return (
    <section role="status" aria-live="polite" aria-label="Processing progress" className="rounded-lg border border-line border-l-4 border-l-brand bg-white shadow-xs p-5">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <span className="w-10 h-10 rounded-xl bg-soft flex items-center justify-center shrink-0">
            <Loader2 className="w-5 h-5 text-ink animate-spin" strokeWidth={1.75} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold tracking-tight text-ink">{queued ? 'Getting ready to read your files' : 'Reading your files'}</h2>
            <p className="text-[14px] text-muted mt-0.5">{status.phase || 'Working'}</p>
          </div>
        </div>
        <div className="text-[32px] leading-none font-semibold tabular-nums text-ink sm:text-right">{Math.floor(percent)}%</div>
      </div>

      <div className="mt-4 w-full bg-soft h-3 rounded-full overflow-hidden" aria-hidden="true">
        <div className="bg-action h-full rounded-full transition-all duration-500" style={{ width: `${percent}%` }} />
      </div>

      <dl className={`mt-4 grid gap-x-6 gap-y-3 text-[14px] ${compact ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'}`}>
        <div>
          <dt className="text-[13px] text-subtle">Records stored</dt>
          <dd className="text-ink font-medium tabular-nums">
            {Number(status.recordsDone || 0).toLocaleString('en-IN')}{total != null ? ` of ${Number(total).toLocaleString('en-IN')}` : ''}
          </dd>
        </div>
        <div>
          <dt className="text-[13px] text-subtle">Time taken so far</dt>
          <dd className="text-ink font-medium">{formatDuration(status.elapsedSeconds) || 'Just started'}</dd>
        </div>
        <div>
          <dt className="text-[13px] text-subtle">Time left, roughly</dt>
          <dd className="text-ink font-medium">{left == null ? 'Working it out' : left === 0 ? 'Almost done' : `About ${formatDuration(left)}`}</dd>
        </div>
        {!compact && (
          <div>
            <dt className="text-[13px] text-subtle">Started by</dt>
            <dd className="text-ink font-medium break-all">
              {status.startedBy || 'Unknown'}
              {readableWhen(status.startedAt) && <span className="block text-[13px] font-normal text-subtle">{readableWhen(status.startedAt)}</span>}
            </dd>
          </div>
        )}
      </dl>

      <p className="mt-4 text-[13px] text-subtle">
        You can leave this page; reading continues. Uploading, removing files and creating the Zoho files wait until it has finished.
        Nothing is shown as processed until every record has been stored.
      </p>

      {compact && onNavigate && (
        <button type="button" onClick={() => onNavigate('screen-17')} className={`${btnSecondary} mt-3`}>
          Open Processing Status <ArrowRight className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}
    </section>
  );
}

// Shown when the last processing run stopped with an error.
export function ProcessingFailed({ status, onNavigate, canStart }) {
  if (!status || status.state !== 'failed') return null;
  return (
    <section role="alert" className="rounded-lg border border-danger-line bg-danger-soft p-5 flex flex-col lg:flex-row lg:items-start justify-between gap-4">
      <div className="flex items-start gap-3 min-w-0">
        <span className="w-10 h-10 rounded-xl bg-soft flex items-center justify-center shrink-0">
          <TriangleAlert className="w-5 h-5 text-ink" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold tracking-tight text-ink">Reading the files stopped</h2>
          <p className="text-[14px] text-ink mt-1 break-words">{status.error || 'Processing stopped before it finished.'}</p>
          <p className="text-[14px] text-muted mt-1.5">
            Nothing from this run was kept: everything it stored was removed, and the data is not shown as processed.
            Correct the problem, then start processing again.
          </p>
          {(status.startedBy || readableWhen(status.finishedAt)) && (
            <p className="text-[13px] text-subtle mt-1.5">
              {status.startedBy ? `Started by ${status.startedBy}` : 'Started'}{readableWhen(status.finishedAt) ? `, stopped on ${readableWhen(status.finishedAt)}` : ''}.
            </p>
          )}
        </div>
      </div>
      {onNavigate && (
        <button type="button" onClick={() => onNavigate('screen-16')} className={`${btnSecondary} shrink-0 self-start`}>
          {canStart ? 'Open Completeness Check' : 'View Completeness Check'}
        </button>
      )}
    </section>
  );
}
