import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Circle, FileUp, Loader2, AlertTriangle, Info } from 'lucide-react';
import { api, useJob, useProcessStatus, PROCESS_ACTIVE, goTo, formatSize } from '../../api';
import JobHeader from '../../components/JobHeader';
import OutOfDateBanner, { readableWhen } from '../../components/OutOfDateBanner';
import ProcessingProgress, { ProcessingFailed } from '../../components/ProcessingProgress';
import { btnPrimary, btnSecondary, inputClass, StatusChip } from '../../components/ui';
import Assumptions from '../../components/Assumptions';
import CreateFilesBar, { CheckedDownloadButton, DownloadAllButton } from '../../components/CreateFiles';
import PreSteps from '../../components/PreSteps';
import { PREPARE_POLL_MS, prepareShouldPoll } from '../../prepareLogic';
import { reviewWords } from '../../mappingLogic';

// "Prepare migration": one checklist from the three Tally files to the Zoho files to download. Everything shown comes
// from GET /prepare (the server works out every count from the same functions as the screens where things are
// decided); this page only shows it, reads it again when it gets the focus, after an action and, while processing or
// file creation runs, every few seconds; it sends the actions the other screens send.
const plural = (n, one, many = `${one}s`) => `${Number(n).toLocaleString('en-IN')} ${n === 1 ? one : many}`;

function StepShell({ n, step, current, children }) {
  const state = step.done ? 'done' : current ? 'current' : 'later';
  return (
    <li className={`relative rounded-lg border bg-white shadow-xs ${state === 'current' ? 'border-action ring-1 ring-brand/30' : 'border-line'}`} aria-current={state === 'current' ? 'step' : undefined}>
      <div className="p-4 sm:p-5 flex items-start gap-4">
        <span className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-[14px] font-semibold ${state === 'done' ? 'bg-success-ink text-white' : state === 'current' ? 'bg-action text-white' : 'border border-line-strong text-muted bg-white'}`}>
          {state === 'done' ? <Check className="w-4 h-4" aria-label="Done" /> : n}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[16px] font-semibold tracking-tight text-ink">{step.title}</h2>
            <StatusChip tone={state === 'done' ? 'success' : state === 'current' ? 'info' : 'neutral'} dot>{state === 'done' ? 'Done' : state === 'current' ? 'Next to do' : 'Not done yet'}</StatusChip>
          </div>
          <div className="mt-3 space-y-3 text-[14px]">{children}</div>
        </div>
      </div>
    </li>
  );
}

function UploadRow({ f, jobId, canChange, onDone, locked }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [chosen, setChosen] = useState(null);
  const pick = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true); setError(''); setChosen(file);
    try { await api.upload(jobId, f.slot, file); } catch (err) { setError(err.message); } finally { setBusy(false); setChosen(null); await onDone(); }
  };
  return (
    <div className="p-3 rounded-md border border-line bg-white flex flex-col md:flex-row md:items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 font-medium text-ink">
          {f.uploaded ? <Check className="w-4 h-4 text-success-ink" aria-hidden="true" /> : <Circle className="w-4 h-4 text-muted" aria-hidden="true" />} {f.name}
          {f.notApplicable && <span className="text-[13px] font-normal text-muted">(marked not applicable)</span>}
        </div>
        {f.uploaded
          ? <div className="text-[13px] text-muted break-all">{f.fileName}{f.records != null ? `, ${plural(f.records, 'record')}` : ''}{readableWhen(f.uploadedAt) ? `, uploaded ${readableWhen(f.uploadedAt)}` : ''}</div>
          : <div className="text-[13px] text-muted">In Tally: {f.tally}</div>}
        {f.datasets?.length > 0 && <div className="text-[13px] text-muted">Gave: {f.datasets.map(d => `${d.name} (${d.records})`).join(', ')}</div>}
        {/* the Trial Balance notes (for example "not at ledger level": the opening balances file cannot be made) are shown, not folded */}
        {f.warnings?.length > 0 && f.slot === 'trial_balance' && (
          <ul className="text-[13px] text-ink space-y-0.5">{f.warnings.map((w, i) => <li key={i} className="flex items-start gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-warning-ink" aria-hidden="true" />{w}</li>)}</ul>
        )}
        {f.warnings?.length > 0 && f.slot !== 'trial_balance' && (
          <details className="text-[13px] text-muted"><summary className="cursor-pointer text-ink">{plural(f.warnings.length, 'note')} on this file</summary>
            <ul className="list-disc pl-5 mt-1 space-y-0.5">{f.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </details>
        )}
        {busy && <div role="status" className="text-[13px] text-ink flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Uploading and checking {chosen?.name} ({formatSize(chosen?.size || 0)}). Large files take a while.</div>}
        {error && <div role="alert" className="text-[13px] text-danger-ink font-medium">{error}</div>}
      </div>
      {canChange && (
        <>
          <input ref={input} type="file" accept=".json,application/json" className="hidden" onChange={pick} aria-label={`Choose the ${f.name} file`} />
          <button type="button" disabled={busy || locked} onClick={() => input.current?.click()} className={`${f.uploaded ? btnSecondary : btnPrimary} shrink-0`}>
            <FileUp className="w-4 h-4" /> {f.uploaded ? 'Replace the file' : 'Choose the file'}
          </button>
        </>
      )}
    </div>
  );
}

function DatasetRow({ d, jobId, canChange, onDone }) {
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const act = async fn => { setError(''); try { await fn(); setOpen(false); } catch (e) { setError(e.message); } await onDone(); };
  return (
    <div className="p-3 rounded-md border border-line bg-white space-y-2">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <span className="font-medium text-ink">{d.name}</span>{' '}
          <span className="text-[13px] text-muted">{d.requirement === 'required' ? 'required' : 'needed only if the company has it'}</span>
          <div className="text-[13px] text-muted">{d.status === 'not_applicable' ? `Not applicable: ${d.reason}` : d.canMarkNotApplicable ? 'No file. Mark it as not applicable if the company has none.' : 'No file. Upload it in the Upload Center.'}</div>
        </div>
        {canChange && d.status === 'not_applicable' && !d.auto && <button type="button" className={btnSecondary} onClick={() => act(() => api.del(`/migrations/${jobId}/waivers/${d.key}`))}>Undo</button>}
        {canChange && d.status === 'missing' && d.canMarkNotApplicable && !open && (
          d.confirmedEmpty
            ? <button type="button" className={btnSecondary} onClick={() => act(() => api.put(`/migrations/${jobId}/waivers/${d.key}`, {}))}>Mark not applicable (the transactions file has none)</button>
            : <button type="button" className={btnSecondary} onClick={() => setOpen(true)}>Mark not applicable</button>
        )}
      </div>
      {open && (
        <form className="flex flex-col sm:flex-row gap-2" onSubmit={e => { e.preventDefault(); if (reason.trim()) act(() => api.put(`/migrations/${jobId}/waivers/${d.key}`, { reason: reason.trim() })); }}>
          <label className="sr-only" htmlFor={`why-${d.key}`}>Why is {d.name} not applicable?</label>
          <input id={`why-${d.key}`} autoFocus value={reason} onChange={e => setReason(e.target.value)} className={inputClass} placeholder="Why, for example: the company keeps no stock" />
          <button type="submit" disabled={!reason.trim()} className={btnPrimary}>Save</button>
          <button type="button" className={btnSecondary} onClick={() => setOpen(false)}>Cancel</button>
        </form>
      )}
      {error && <div role="alert" className="text-[13px] text-danger-ink font-medium">{error}</div>}
    </div>
  );
}

export default function PrepareMigration({ onNavigate, user }) {
  const { job, loading, error, reload } = useJob();
  const [state, setState] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState('');
  const [actionError, setActionError] = useState('');
  const jobId = job?.id || null;

  const read = useCallback(async () => {
    if (!jobId) return;
    try { setState(await api.get(`/migrations/${jobId}/prepare`)); setLoadError(''); } catch (e) { setLoadError(e.message); }
  }, [jobId]);
  const refresh = useCallback(async () => { await reload(); await read(); }, [reload, read]);
  useEffect(() => { read(); }, [read]);
  // read again when the page gets the focus back (the person was on another screen or window), and after every action
  // taken here (run, refresh)
  useEffect(() => {
    if (!jobId) return undefined;
    const onVisible = () => { if (document.visibilityState === 'visible') read(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => { document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onVisible); };
  }, [jobId, read]);
  // on a timer only while something runs by itself: processing, or the files being created (prepareLogic.js)
  const polling = prepareShouldPoll(state, { creating: busy === 'files' });
  useEffect(() => {
    if (!jobId || !polling) return undefined;
    const t = setInterval(() => { if (document.visibilityState === 'visible') read(); }, PREPARE_POLL_MS);
    return () => clearInterval(t);
  }, [jobId, read, polling]);

  const step = key => state?.steps.find(s => s.key === key);
  const processStep = step('process');
  const watching = !!processStep?.active;
  const onFinish = useCallback(() => { refresh(); }, [refresh]);
  const { status, refresh: refreshStatus } = useProcessStatus(watching ? jobId : null, onFinish);

  const run = async (name, fn) => {
    setBusy(name); setActionError('');
    try { await fn(); } catch (e) { setActionError(e.message); } finally { setBusy(''); await refresh(); }
  };
  const startProcessing = () => run('process', async () => { await api.post(`/migrations/${jobId}/process?wait=0`); refreshStatus(); });
  const createFiles = () => run('files', () => api.post(`/migrations/${jobId}/generate`));

  const canChange = !!state?.canChange;
  const current = state?.current;
  const done = state ? state.steps.filter(s => s.done).length : 0;
  // the number of a checklist item: its place in the server's list (the "not in any file yet" item comes and goes)
  const nOf = key => (state ? state.steps.findIndex(s => s.key === key) + 1 : 0);
  const zc = state?.zohoCheck;
  const heldStep = step('held');
  const dec = step('decisions');
  // decisions: how many items run on the tool's default and how many a person decided (one wording with the screens)
  const onDefault = dec?.items ? dec.items.filter(d => !d.info).reduce((t, d) => t + (d.byDefault || 0), 0) : 0;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
      <JobHeader
        title="Progress checklist"
        subtitle="Every step of the migration on one page, so you can see what is done and what is still open. Each step also has its own page in the menu on the left (the numbered ones). This list updates by itself as you work."
        job={job} loading={loading} error={error || loadError || actionError} onNavigate={onNavigate}
      />
      {!loading && !job && canChangeAny(user) && (
        <div className="text-center"><button type="button" className={btnPrimary} onClick={() => onNavigate('screen-12')}>Start a new migration</button></div>
      )}

      <OutOfDateBanner job={job} user={user} onDone={refresh} onNavigate={onNavigate} />

      {state && (
        <>
          <div className="p-4 rounded-lg border border-line bg-white shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[15px] text-ink"><span className="font-semibold">{done} of {state.steps.length} checklist items done.</span>{' '}
                {current ? <span className="text-muted">Next: {state.steps.find(s => s.key === current)?.title.toLowerCase()}.</span> : <span className="text-success-ink font-medium">Everything is ready to import.</span>}</div>
              <div className="mt-2 h-1.5 rounded-full bg-soft-2 overflow-hidden max-w-md" role="progressbar" aria-label="Checklist progress" aria-valuemin={0} aria-valuemax={state.steps.length} aria-valuenow={done}>
                <div className="h-full bg-success transition-all" style={{ width: `${state.steps.length ? Math.round((done / state.steps.length) * 100) : 0}%` }} />
              </div>
              {heldStep && !heldStep.done && <span className="block text-[14px] mt-2 text-warning-ink">Open item: {heldStep.open.toLocaleString('en-IN')} vouchers are not in any file yet.</span>}
              {zc && (zc.rowsWill > 0 || zc.rowsMay > 0) && <span className="block text-[14px] mt-1 text-ink">Zoho check: <span className="text-danger-ink font-medium">{zc.rowsWill.toLocaleString('en-IN')} rows will be refused</span>, {zc.rowsMay.toLocaleString('en-IN')} may be refused.</span>}
            </div>
            {!canChange && <StatusChip tone="neutral" title="You can follow the progress but not change anything">View only</StatusChip>}
          </div>

          <ol className="space-y-4" aria-label="Steps">
            {/* 1. upload */}
            <StepShell n={nOf('upload')} step={step('upload')} current={current === 'upload'}>
              <p className="text-muted">The three exports from TallyPrime, each as JSON (Data Exchange). The masters and transactions are split into their datasets automatically. Files uploaded one by one in the Upload Center count too.</p>
              {step('upload').files.map(f => <UploadRow key={f.slot} f={f} jobId={jobId} canChange={canChange} onDone={refresh} locked={watching} />)}
              <button type="button" className="text-info-ink hover:underline font-medium" onClick={() => onNavigate('screen-15')}>Open the Upload Center for files uploaded one by one</button>
            </StepShell>

            {/* 2. datasets that do not apply */}
            <StepShell n={nOf('datasets')} step={step('datasets')} current={current === 'datasets'}>
              {step('datasets').datasets.length === 0
                ? <p className="text-muted">Every dataset that is needed has a file.</p>
                : step('datasets').datasets.map(d => <DatasetRow key={d.key} d={d} jobId={jobId} canChange={canChange} onDone={refresh} />)}
              {step('datasets').countMismatches.map(m => (
                <div key={m.slot} className="flex items-start gap-2 text-ink"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-warning-ink" /><span>{m.message} <button type="button" className="text-info-ink hover:underline font-medium" onClick={() => onNavigate('screen-16')}>Open Completeness Check</button></span></div>
              ))}
            </StepShell>

            {/* 3. processing */}
            <StepShell n={nOf('process')} step={processStep} current={current === 'process'}>
              {watching && status && PROCESS_ACTIVE.includes(status.state) && <ProcessingProgress status={status} compact onNavigate={onNavigate} />}
              {!watching && processStep.processing?.state === 'failed' && <ProcessingFailed status={processStep.processing} onNavigate={onNavigate} canStart={canChange} />}
              {!watching && processStep.blockers.length > 0 && (
                <div><div className="font-medium text-ink">Before the files can be read:</div>
                  <ul className="list-disc pl-5 text-muted space-y-0.5">{processStep.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul></div>
              )}
              {!watching && processStep.storedEarlier && <p className="text-ink">A file was uploaded or removed after the data was last read. Read the files again.</p>}
              {!watching && processStep.done && processStep.processing?.finishedAt && <p className="text-muted">Read {readableWhen(processStep.processing.finishedAt)}{processStep.processing.startedBy ? ` by ${processStep.processing.startedBy}` : ''}. Reading again replaces what is stored. Your decisions are kept, also the routing of each journal. The Zoho files are removed and must be created again.</p>}
              {!watching && processStep.done && processStep.processing?.journalDecisions && (processStep.processing.journalDecisions.kept > 0 || processStep.processing.journalDecisions.lost.length > 0) && (
                <div className="text-muted">
                  <p>{plural(processStep.processing.journalDecisions.kept, 'journal routing decision')} kept from before.{processStep.processing.journalDecisions.lost.length > 0 && <span className="text-ink"> {plural(processStep.processing.journalDecisions.lost.length, 'decision')} no longer {processStep.processing.journalDecisions.lost.length === 1 ? 'matches' : 'match'} a journal and {processStep.processing.journalDecisions.lost.length === 1 ? 'was' : 'were'} not kept:</span>}</p>
                  {processStep.processing.journalDecisions.lost.length > 0 && (
                    <ul className="list-disc pl-5 space-y-0.5">
                      {processStep.processing.journalDecisions.lost.map((l, i) => <li key={i}>Journal {l.number || '(no number)'}{l.date ? ` of ${l.date}` : ''}: was {l.decision}. {l.why[0].toUpperCase() + l.why.slice(1)}.</li>)}
                    </ul>
                  )}
                </div>
              )}
              {canChange && !watching && (
                <button type="button" disabled={!processStep.canStart || busy === 'process'} onClick={startProcessing} className={processStep.done ? btnSecondary : btnPrimary}>
                  {busy === 'process' ? 'Starting…' : processStep.done ? 'Read the files again' : 'Read the files'} <ArrowRight className="w-4 h-4" />
                </button>
              )}
            </StepShell>

            {/* 4. decisions */}
            <StepShell n={nOf('decisions')} step={step('decisions')} current={current === 'decisions'}>
              {!step('decisions').items
                ? <p className="text-muted">The decisions are known once the files have been read.</p>
                : (
                  <>
                    <p className="text-ink">
                      You do not have to decide anything here. Where you decide nothing, the tool uses a safe default and lists it below under "Assumptions the tool made".
                      {' '}{onDefault > 0 ? `${plural(onDefault, 'item')} ${onDefault === 1 ? 'uses' : 'use'} the default; you can change any of them.` : 'Nothing runs on a default.'}
                      {' '}{dec.blockingOpen ? `${plural(dec.blockingOpen, 'item')} would be refused by Zoho if left as ${dec.blockingOpen === 1 ? 'it is' : 'they are'}.` : zc?.rowsWill ? '' : 'None is expected to be refused.'}
                      {zc && (zc.rowsWill > 0 || zc.rowsMay > 0) && <> The Zoho check expects {zc.rowsWill.toLocaleString('en-IN')} rows to be refused and {zc.rowsMay.toLocaleString('en-IN')} that may be refused. <button type="button" className="text-info-ink hover:underline font-medium" onClick={() => onNavigate('screen-38')}>Open the Zoho check</button></>}
                      {' '}<span className="text-muted">The files can be created at any time; create them again after a decision.</span>
                    </p>
                    <ul className="divide-y divide-line rounded-md border border-line bg-white">
                      {step('decisions').items.map(d => (
                        <li key={d.key} className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-ink">{d.title}</span>
                              {d.info ? <StatusChip tone="neutral"><Info className="w-3.5 h-3.5" aria-hidden="true" /> For information</StatusChip>
                                : d.open === 0 ? <StatusChip tone="success"><Check className="w-3.5 h-3.5" aria-hidden="true" /> Done</StatusChip>
                                  : d.byDefault > 0 && !d.blocksImport
                                    // v2: on the default is not "open": say how many use the default and how many a person decided
                                    ? <StatusChip tone="info"><span className="tabular-nums">{d.byDefault.toLocaleString('en-IN')} use the default{d.total ? `, ${Math.max(0, d.total - d.open).toLocaleString('en-IN')} decided by you` : ''}</span></StatusChip>
                                    : <StatusChip tone="warning"><span className="tabular-nums">{d.open.toLocaleString('en-IN')} open{d.total ? ` of ${d.total.toLocaleString('en-IN')}` : ''}</span></StatusChip>}
                              {!d.info && d.open > 0 && d.blocksImport && <StatusChip tone="danger">{d.zohoWill ? `Zoho will refuse ${d.zohoWill.toLocaleString('en-IN')} rows` : 'Blocks the import'}</StatusChip>}
                              {d.warnings > 0 && <StatusChip tone="warning"><AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" /> <span className="tabular-nums">{d.warnings.toLocaleString('en-IN')} {d.warnings === 1 ? 'warning' : 'warnings'}, not blocking</span></StatusChip>}
                            </div>
                            <div className="text-[13px] text-muted">{d.words}</div>
                            <div className="text-[13px] text-muted">Decided in {d.place}.</div>
                            {d.reviewed && <div className="text-[13px] text-muted">{reviewWords(d.reviewed)}.</div>}
                          </div>
                          <button type="button" onClick={() => goTo(onNavigate, d.screen, d.anchor)} className={`${d.open > 0 && d.blocksImport ? btnPrimary : btnSecondary} shrink-0`}>
                            {d.open > 0 && canChange ? (d.blocksImport ? 'Decide' : 'Change') : 'Open'} <ArrowRight className="w-4 h-4" />
                          </button>
                        </li>
                      ))}
                    </ul>
                    <Assumptions jobId={job.id} onNavigate={onNavigate} refreshKey={`${step('files').lastCreatedAt || ''}|${step('decisions').open}`} />
                  </>
                )}
            </StepShell>

            {/* 5. create the files */}
            <StepShell n={nOf('files')} step={step('files')} current={current === 'files'}>
              {step('files').created > 0 && step('files').outOfDate.length === 0 && <p className="text-muted">{plural(step('files').created, 'file')} created{readableWhen(step('files').lastCreatedAt) ? ` ${readableWhen(step('files').lastCreatedAt)}` : ''}, all up to date.</p>}
              {step('files').outOfDate.length > 0 && (
                <div className="text-ink"><div className="font-medium">Out of date, because something they are built from changed: {step('files').outOfDate.map(f => f.module).join(', ')}.</div>
                  <div className="text-[13px] text-muted">{[...new Set(step('files').outOfDate.flatMap(f => f.reasons))].slice(0, 5).join(' ')}</div></div>
              )}
              {canChange && (
                <button type="button" disabled={!step('files').canCreate || busy === 'files'} onClick={createFiles} className={step('files').done ? btnSecondary : btnPrimary}>
                  {busy === 'files' ? 'Creating the files…' : step('files').created ? 'Create the files again' : 'Create the files'}
                </button>
              )}
              <button type="button" className="text-info-ink hover:underline font-medium block" onClick={() => onNavigate('screen-25')}>Open the Export Center for the flagged items of each file</button>
              {step('files').created > 0 && (
                <button type="button" className="text-info-ink hover:underline font-medium block" onClick={() => onNavigate('screen-38')}>Check every row against Zoho's import rules (Zoho check)</button>
              )}
              {step('files').created > 0 && (
                <button type="button" className="text-info-ink hover:underline font-medium block" onClick={() => onNavigate('screen-37')}>Check that every Tally voucher is in the files (Voucher Reconciliation)</button>
              )}
            </StepShell>

            {/* vouchers in no file yet: an open item (never done while any is held) */}
            {heldStep && (
              <StepShell n={nOf('held')} step={heldStep} current={current === 'held'}>
                <p className={heldStep.done ? 'text-muted' : 'text-ink'}>{heldStep.words}</p>
                {!heldStep.done && (
                  <button type="button" className={btnSecondary} onClick={() => onNavigate('screen-40', { step: 'held' })}>
                    Open "Not in any file yet" in the Import Wizard <ArrowRight className="w-4 h-4" />
                  </button>
                )}
              </StepShell>
            )}

            {/* download */}
            <StepShell n={nOf('download')} step={step('download')} current={current === 'download'}>
              {step('download').files.length === 0 ? <p className="text-muted">The files appear here once they are created.</p> : (
                <>
                  <p className="text-muted">Import them into Zoho Books in this order. The import wizard takes you through each one.</p>
                  <PreSteps source={zc?.preSteps} onSee={p => onNavigate('screen-38', p.files[0] ? { file: p.files[0] } : {})} />
                  <ol className="divide-y divide-line rounded-md border border-line bg-white">
                    {step('download').files.map(f => (
                      <li key={f.key} className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium text-ink"><span className="tabular-nums">{f.step}.</span> {f.module} <span className="text-[13px] font-normal text-muted">{plural(f.rows, 'row')}</span></div>
                          <div className="text-[13px] text-muted break-all">{f.fileName}</div>
                          <div className="text-[13px] text-muted">
                            {f.outOfDate ? 'Out of date: create the files again first.' : f.downloaded ? `Downloaded (status: ${f.status}).` : 'Not downloaded yet.'}
                            {f.waitingFor.length > 0 && ` Import first: ${f.waitingFor.join(', ')}.`}
                          </div>
                          {f.zohoSetup.length > 0 && <div className="text-[13px] text-muted">Set up in Zoho Books first: {f.zohoSetup.join(' ')}</div>}
                        </div>
                        <CheckedDownloadButton job={job} file={f} viewer={!canChange} onNavigate={onNavigate} onError={e => setActionError(e.message)} onDone={refresh} className={`${btnSecondary} shrink-0`} />
                      </li>
                    ))}
                  </ol>
                  <div className="flex flex-wrap gap-2">
                    <DownloadAllButton job={job} viewer={!canChange} onNavigate={onNavigate} onError={e => setActionError(e.message)} />
                    <button type="button" className={btnSecondary} onClick={() => onNavigate('screen-40')}>Start the import wizard</button>
                  </div>
                  {step('download').reference.length > 0 && (
                    <div className="text-[13px] text-muted">For checking only, not to be imported: {step('download').reference.map(r => r.module).join(', ')} (in the Export Center).</div>
                  )}
                </>
              )}
            </StepShell>
          </ol>

          {/* the main action, also at the bottom: create the files, then start the import wizard */}
          <CreateFilesBar job={job} user={user} canCreate={!!step('files').canCreate} files={step('download').files}
            onDone={refresh} onError={async e => { setActionError(e.message); await refresh(); }} onNavigate={onNavigate} />
        </>
      )}
    </div>
  );
}

const canChangeAny = user => user && user.role !== 'viewer';
