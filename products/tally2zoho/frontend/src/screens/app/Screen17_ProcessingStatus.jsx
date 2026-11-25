import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, ChevronRight, Clock } from 'lucide-react';
import { api, useJob, useProcessStatus, isProcessed, formatDuration, PROCESS_ACTIVE, goTo } from '../../api';
import { Card, EmptyState, StatusChip, btnPrimary, btnSecondary, btnSmall } from '../../components/ui';
import JobHeader from '../../components/JobHeader';
import ProcessingProgress, { ProcessingFailed } from '../../components/ProcessingProgress';
import { readableWhen } from '../../components/OutOfDateBanner';
import CompletenessTable from '../../components/CompletenessTable';

// Where each kind of flagged item is dealt with: [pattern on the kind, short title, screen, anchor, button label].
const PLACES = [
  [/^(name_|ledger_name_|possible_duplicate)/, null, 'screen-19', 'ms-names', 'Open Names'],
  [/gstin|pan_format|gst_|registration|place_|state_|dated_details/, null, 'screen-19', 'ms-fix-contacts', 'Open Fix contacts'],
  [/hsn/, null, 'screen-19', 'ms-hsn', 'Open HSN/SAC corrections'],
  [/^trial_balance/, null, 'screen-18', null, 'Open Data Explorer'],
  [/^voucher|vouchers_/, null, 'screen-37', null, 'Open Voucher Reconciliation'],
  [/missing|blank|not_uploaded/, null, 'screen-24', null, 'Open Validation Center'],
];
const TITLES = {
  name_hidden_characters: 'Names with a line break or hidden character', name_edge_spaces: 'Names with spaces at the start or end', possible_duplicate: 'Possible duplicates',
  value_cleaned: 'Values cleaned of hidden characters', gstin_format: 'GSTIN in the wrong format', pan_format: 'PAN in the wrong format',
  gst_registered_without_gstin: 'Registered under GST, but no GSTIN', gst_registration_unknown: 'GST registration unknown', gstin_conflict: 'Two different GSTINs in Tally',
  ledger_name_hidden_characters: 'Voucher names that differ by a hidden character', ledger_missing: 'Ledgers on vouchers not in the masters', party_missing: 'Parties not in the masters',
  item_missing: 'Stock items not in the masters', unit_missing: 'Units not in the Units file',
};
const titleOf = kind => TITLES[kind] || (kind ? kind.charAt(0).toUpperCase() + kind.slice(1).replace(/_/g, ' ') : 'Other');
const placeOf = kind => PLACES.find(([re]) => kind && re.test(kind)) || [null, null, 'screen-18', null, 'Open Data Explorer'];

// "Items that need attention", one line per kind of problem with its count and one action.
function AttentionGroups({ exceptions, onNavigate }) {
  const groups = [];
  const by = new Map();
  for (const e of exceptions) {
    const k = e.kind || '';
    if (!by.has(k)) { const g = { kind: k, items: [] }; by.set(k, g); groups.push(g); }
    by.get(k).items.push(e);
  }
  groups.sort((a, b) => b.items.length - a.items.length);
  return (
    <Card
      title={`Flagged while reading the data (${exceptions.length.toLocaleString('en-IN')})`}
      subtitle="Stored unchanged and flagged, grouped by problem. Items flagged when the files are created are in the Validation Center."
    >
      {groups.length === 0 ? <div className="p-4 text-[14px] text-muted">No issues found.</div> : (
        <div className="divide-y divide-line">
          {groups.map(g => {
            const [, , screen, anchor, label] = placeOf(g.kind);
            return (
              <details key={g.kind || 'other'} className="group">
                <summary className="cursor-pointer list-none px-4 py-2.5 flex flex-wrap items-center gap-3 text-[14px]">
                  <ChevronRight className="w-4 h-4 shrink-0 text-muted group-open:rotate-90 transition-transform" aria-hidden="true" />
                  <span className="font-medium text-ink flex-1 min-w-0">{titleOf(g.kind)}</span>
                  <StatusChip tone="warning">{g.items.length.toLocaleString()}</StatusChip>
                  <button type="button" className={`${btnSecondary} ${btnSmall}`} onClick={e => { e.preventDefault(); goTo(onNavigate, screen, anchor); }}>{label}</button>
                </summary>
                <div className="px-4 pb-3 pl-11 space-y-1 text-[13px]">
                  {g.items.slice(0, 5).map(e => (
                    <div key={e.id}><span className="text-ink">{e.name}</span> <span className="text-subtle">· {e.slotName}</span><div className="text-muted">{e.message}</div></div>
                  ))}
                  {g.items.length > 5 && <div className="text-muted">and {(g.items.length - 5).toLocaleString()} more.</div>}
                </div>
              </details>
            );
          })}
        </div>
      )}
    </Card>
  );
}

export default function Screen17_ProcessingStatus({ onNavigate, user }) {
  const { job, loading, error, reload } = useJob();
  const [summary, setSummary] = useState(null);
  const [loadError, setLoadError] = useState('');

  // When a run that was being watched ends, the migration and the records are read again.
  const onFinish = useCallback(() => { reload(); }, [reload]);
  const { status, error: statusError } = useProcessStatus(job?.id || null, onFinish);
  const running = !!status && PROCESS_ACTIVE.includes(status.state);

  const processedNow = isProcessed(job);
  useEffect(() => {
    if (!job || !processedNow) { setSummary(null); return; }
    api.get(`/migrations/${job.id}/summary`).then(s => { setSummary(s); setLoadError(''); }).catch(e => setLoadError(e.message));
  }, [job, processedNow]);

  const processed = processedNow && !running && summary && ['processed', 'generated'].includes(summary.status);
  const total = summary?.bySlot.reduce((a, r) => a + r.n, 0) || 0;
  const processExceptions = summary?.exceptions.filter(e => e.stage === 'process') || [];
  const lastDone = status?.state === 'done' ? status : null;
  const showFailed = !running && !processedNow && status?.state === 'failed';

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
      <JobHeader
        title="Processing Status"
        subtitle="Records read from your uploaded files. Source values are stored exactly as they appear in Tally."
        job={job} loading={loading} error={error || loadError || statusError} onNavigate={onNavigate}
        action={
          processed && (
            <button onClick={() => onNavigate('screen-19')} className={btnPrimary}>
              <span>Next: check names, accounts and rates</span>
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </button>
          )
        }
      />

      {job && running && <ProcessingProgress status={status} />}

      {job && showFailed && <ProcessingFailed status={status} onNavigate={onNavigate} canStart={user?.role !== 'viewer'} />}

      {job && status && !running && !processedNow && !showFailed && (
        <div className="border border-line rounded-lg bg-white shadow-xs">
          <EmptyState
            icon={Clock}
            title="Processing has not been run yet"
            text={status.state === 'done'
              ? 'A file was uploaded or removed after the data was last read, so the data has to be read again.'
              : 'Finish the completeness check, then start processing from there.'}
            actionLabel="Open Completeness Check"
            onAction={() => onNavigate('screen-16')}
          />
        </div>
      )}

      {job && processed && (
        <>
          <div className="p-5 rounded-lg border border-line bg-white shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 mb-3">
              <div>
                <div className="text-[13px] text-subtle">Overall progress</div>
                <div className="flex items-center gap-3"><span className="text-[32px] font-semibold text-ink leading-none tabular-nums">100%</span><StatusChip tone="success" dot>Done</StatusChip></div>
              </div>
              <div className="text-[14px] text-muted sm:text-right">
                <div><strong className="text-ink">{total.toLocaleString()}</strong> records stored</div>
                <div>
                  <strong className="text-ink">{processExceptions.length.toLocaleString('en-IN')}</strong> flagged while reading the data
                  {summary.counts && <>; {summary.counts.flagged.toLocaleString('en-IN')} in all, <button type="button" className="underline text-info-ink" onClick={() => onNavigate('screen-24')}>see Validation Center</button></>}
                </div>
              </div>
            </div>
            <div className="w-full bg-soft-2 h-2.5 rounded-full overflow-hidden" role="progressbar" aria-valuenow={100} aria-valuemin={0} aria-valuemax={100} aria-label="Overall progress"><div className="bg-success h-full w-full" /></div>
            <p className="mt-2 text-[13px] text-subtle">Every record in each file was stored. Record counts in equal record counts out.</p>
            {lastDone && (lastDone.startedBy || lastDone.finishedAt) && (
              <p className="mt-1 text-[13px] text-subtle">
                {lastDone.startedBy ? `Started by ${lastDone.startedBy}` : 'Finished'}
                {readableWhen(lastDone.finishedAt) ? `, finished on ${readableWhen(lastDone.finishedAt)}` : ''}
                {lastDone.elapsedSeconds != null ? `, took ${formatDuration(lastDone.elapsedSeconds)}` : ''}.
              </p>
            )}
          </div>

          <Card title="Records by dataset">
            <div className="divide-y divide-line">
              {summary.bySlot.map(r => (
                <div key={`${r.slot}-${r.type}`} className="px-4 py-3 flex items-center justify-between gap-3 text-[14px]">
                  <span className="flex flex-wrap items-center gap-2 text-ink font-medium">
                    <StatusChip tone="success" dot>Read</StatusChip>
                    <span>
                      {r.name}
                      {/* The Chart of Accounts file can hold Tally groups as well as ledgers: say which line is which. */}
                      {r.type === 'Group' && <span className="font-normal text-muted"> · groups (used only to find each ledger's main group, not written to Zoho Books)</span>}
                      {r.type !== 'Group' && summary.bySlot.filter(x => x.slot === r.slot).length > 1 && <span className="font-normal text-muted"> · ledgers</span>}
                    </span>
                  </span>
                  <span className="text-muted tabular-nums shrink-0">{r.n.toLocaleString()} records</span>
                </div>
              ))}
            </div>
          </Card>

          {/* Tally against the Zoho files, per dataset: Tally's side now, the files' side once they are created */}
          <CompletenessTable job={job} onNavigate={onNavigate} />

          <AttentionGroups exceptions={processExceptions} onNavigate={onNavigate} />
        </>
      )}
    </div>
  );
}
