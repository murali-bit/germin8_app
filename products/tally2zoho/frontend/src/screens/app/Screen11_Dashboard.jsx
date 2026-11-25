import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, Check, CircleAlert, CircleDashed, ClipboardCheck, Database, FileDown, FileText, FolderOpen,
  Plus, RotateCw, Search, Table2, Upload,
} from 'lucide-react';
import { api, chooseMigration, useJob, isProcessed, isProcessing, useProcessStatus, MIGRATIONS_CHANGED } from '../../api';
import { btnPrimary, btnSecondary, btnSmall, Card, EmptyState, friendlyError, inputClass, Note, PageHeader, StatTile, StatusChip, Table } from '../../components/ui';
import OutOfDateBanner from '../../components/OutOfDateBanner';
import { flowProgress } from '../../navigation';
import { heldWords } from '../../importWizard';

// The status of a migration in the list, in words. A migration still waiting for uploads that has some files says so.
const statusWords = m => (m.status === 'awaiting_uploads'
  ? (m.uploads > 0 ? 'Uploading Tally files' : 'Waiting for uploads')
  : { processing: 'Reading your files', processed: 'Data read, ready to prepare files', generated: 'Files ready to import' }[m.status] || 'In progress');

const statusTone = m => ({ generated: 'success', processed: 'info', processing: 'warning' }[m.status] || 'neutral');

const QUICK_LINKS = [
  { Icon: Upload, title: 'Upload Center', text: 'Add or replace your Tally files', target: 'screen-15' },
  { Icon: Table2, title: 'Data Explorer', text: 'Look through the records that were read', target: 'screen-18' },
  { Icon: FileDown, title: 'Export Center', text: 'Create and download files for Zoho Books', target: 'screen-25' },
  { Icon: FileText, title: 'Reports and Audit', text: 'See the transfer report and activity history', target: 'screen-31' },
];

const readableDate = value => {
  const d = new Date(value);
  if (!value || Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
};

const listNames = (names, max = 4) => {
  if (!names.length) return '';
  const shown = names.slice(0, max).join(', ');
  return names.length > max ? `${shown} and ${names.length - max} more` : shown;
};

const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`;

// Where the selected migration stands. Every number comes from the server: the Progress checklist
// (GET prepare: decisions, files, vouchers in no file yet, the Zoho check), the flagged items (GET summary counts),
// the import list and the Zoho reports. Nothing is counted a second way here.
function readState(job, details) {
  const c = job?.completeness;
  const processed = isProcessed(job);
  const d = details || {};
  const prep = d.prepare || null;
  const stepOf = key => prep?.steps?.find(s => s.key === key) || null;
  const imports = d.imports || [];
  const verification = d.verification || [];
  const flagged = d.summary?.counts?.flagged ?? (d.summary?.exceptions || []).length;
  const warnings = d.summary?.counts?.warnings ?? 0;
  const generated = job?.status === 'generated';
  const imported = imports.filter(i => i.status === 'imported').length;
  const allImported = imports.length > 0 && imported === imports.length;
  const nextImport = imports.find(i => i.status !== 'imported' && i.ready) || imports.find(i => i.status !== 'imported');
  // A module is not confirmed while a record is missing in Zoho or a compared amount differs.
  const unverified = verification.filter(v => !v.checked || v.missing > 0 || v.amountsDiffering > 0);
  const filesMissing = [...(c?.missingRequired || []), ...(c?.awaitingConfirmation || [])];
  const countMismatches = c?.countMismatches || [];
  const verified = verification.length > 0 && unverified.length === 0;
  const records = d.summary ? (d.summary.bySlot || []).reduce((sum, s) => sum + (s.n || 0), 0) : null;
  const decisions = stepOf('decisions');
  const blockingOpen = decisions?.blockingOpen || 0;
  const filesStep = stepOf('files');
  const filesReady = !!filesStep?.done;
  const held = prep?.held || null; // { written, notInAnyFile, words, modules }
  const zohoCheck = prep?.zohoCheck || null; // { rowsWill, rowsMay, ... }
  const stale = !!job?.filesOutOfDate;
  const staleReasons = job?.outOfDateReasons || [];
  const processing = isProcessing(job);
  return { processing, stale, staleReasons, c, filesMissing, countMismatches, processed, flagged, warnings, decisions, blockingOpen,
    filesReady, held, zohoCheck, generated, imports, imported, allImported, nextImport, unverified, verified, records, stepOf };
}

function nextStep({ job, migrations, viewer, s }) {
  if (!job) {
    if (!migrations.length) {
      return viewer
        ? { title: 'No migrations yet', text: 'Your firm has not started a migration. Once one is created it will appear here.' }
        : { title: 'Start your first migration', text: 'Tell us the company and financial year, then we will guide you through each step.', button: 'New Migration', target: 'screen-12' };
    }
    return { title: 'Choose a migration to work on', text: 'Pick one from the list below and press Open. Everything on this page will then show that migration.', button: 'See your migrations', scroll: true };
  }
  const c = s.c;
  if (s.processing) {
    return {
      title: 'Your files are being read',
      text: 'Processing is under way. You can follow its progress on Processing Status. Uploading or removing files and creating the Zoho Books files wait until it has finished.',
      button: 'View Processing Status', target: 'screen-17',
    };
  }
  if (c && !c.ready && !s.filesMissing.length && s.countMismatches.length) {
    const m = s.countMismatches[0];
    const more = s.countMismatches.length - 1;
    return {
      title: viewer ? 'A record count does not match Tally' : 'Fix the record count that does not match Tally',
      text: `${m.name}: Tally shows ${Number(m.expected).toLocaleString('en-IN')}, but the uploaded file has ${Number(m.actual).toLocaleString('en-IN')}.${more > 0 ? ` ${plural(more, 'other dataset')} also ${more === 1 ? 'differs' : 'differ'}.` : ''} ${s.processed
        ? 'The data was already read from this file. It cannot be read again, and files for Zoho Books cannot be created, until the file is replaced, or the number is corrected or cleared.'
        : 'The data cannot be read until the file is replaced, or the number is corrected or cleared.'}`,
      button: viewer ? 'View Completeness Check' : 'Go to Completeness Check', target: 'screen-16',
    };
  }
  if (c && !c.ready) {
    const missing = s.filesMissing;
    return {
      title: viewer ? 'Uploads are in progress' : 'Upload your Tally files',
      text: `${c.uploaded} of ${c.total} Tally files are uploaded.${missing.length ? ` Still needed: ${listNames(missing)}.` : ''}`,
      button: viewer ? 'View Upload Center' : 'Go to Upload Center', target: 'screen-15',
    };
  }
  if (!s.processed) {
    return {
      title: viewer ? 'Uploads are complete, waiting to be checked' : 'Check your uploads and read the data',
      text: 'Everything needed has been uploaded. The next step is a final check, after which the data is read in.',
      button: viewer ? 'View Completeness Check' : 'Go to Completeness Check', target: 'screen-16',
    };
  }
  // v2: every decision has a default; only what Zoho would refuse as it is needs a person
  if (s.blockingOpen > 0) {
    const items = (s.decisions?.items || []).filter(d => d.blocksImport && d.open > 0);
    return {
      title: viewer ? 'Some items would be refused by Zoho' : 'Decide what Zoho would refuse as it is',
      text: `${plural(s.blockingOpen, 'item')} would be refused by Zoho if left on the default: ${items.map(d => `${d.title.toLowerCase()} (${d.open})`).join(', ')}. Everything else uses a safe default.`,
      button: viewer ? 'View Mapping Studio' : 'Go to Mapping Studio', target: 'screen-19',
    };
  }
  if (s.stale) {
    const first = s.staleReasons[0]?.reason || '';
    const more = s.staleReasons.length - 1;
    return {
      title: viewer ? 'The files need to be created again' : 'Create your Zoho Books files again',
      text: `The files are out of date, because something they are built from changed after they were created.${first ? ` ${first}` : ''}${more > 0 ? ` ${plural(more, 'other change')} ${more === 1 ? 'was' : 'were'} also made.` : ''} Out-of-date files cannot be downloaded or imported.`,
      button: viewer ? 'View Export Center' : 'Go to Export Center', target: 'screen-25',
    };
  }
  if (!s.generated || !s.imports.length) {
    return {
      title: viewer ? 'Files have not been created yet' : 'Create your Zoho Books files',
      text: 'Your data has been read. Every open decision uses a safe default, so the files can be created now. You can change any decision later and create them again.',
      button: viewer ? 'View Export Center' : 'Go to Export Center', target: 'screen-25',
    };
  }
  if (!s.allImported) {
    return {
      title: viewer ? 'Files are being imported into Zoho Books' : 'Import your files into Zoho Books',
      text: `${s.imported} of ${s.imports.length} files are marked as imported.${s.nextImport ? ` Next file: ${s.nextImport.module}.` : ''}${s.held?.notInAnyFile ? ` Still open: ${s.held.words}.` : ''}`,
      button: viewer ? 'View Import Wizard' : 'Go to Import Wizard', target: 'screen-40',
    };
  }
  if (s.held?.notInAnyFile > 0) {
    return {
      title: viewer ? 'Some vouchers are not in any file yet' : 'Bring the vouchers that are in no file into Zoho Books',
      text: `${s.held.words}. ${heldWords(s.held)}`.trim(),
      button: viewer ? 'View the list' : 'Open "Not in any file yet"', target: 'screen-40', params: { step: 'held' },
    };
  }
  if (!s.verified) {
    const reasons = s.unverified.map(v => {
      if (!v.checked) return `${v.module}: no Zoho report uploaded yet`;
      const parts = [];
      if (v.missing > 0) parts.push(`${plural(v.missing, 'record')} not found in Zoho`);
      if (v.amountsDiffering > 0) parts.push(`${plural(v.amountsDiffering, 'amount')} ${v.amountsDiffering === 1 ? 'differs' : 'differ'} from Zoho`);
      return `${v.module}: ${parts.join(' and ')}`;
    });
    const shown = reasons.slice(0, 3).join('. ');
    const more = reasons.length - 3;
    const reportsMissing = s.unverified.some(v => !v.checked);
    const amountsDiffer = s.unverified.some(v => v.checked && v.amountsDiffering > 0);
    return {
      title: reportsMissing
        ? (viewer ? 'Waiting for the final check against Zoho Books' : 'Confirm everything arrived in Zoho Books')
        : (viewer ? 'Differences were found in Zoho Books' : 'Review the differences found in Zoho Books'),
      text: `All files are imported.${reasons.length ? ` ${shown}.${more > 0 ? ` ${plural(more, 'other module')} also ${more === 1 ? 'needs' : 'need'} attention.` : ''}` : ''}${amountsDiffer ? ' Open Reconciliation to see both figures. Uploading the same report again will not change this.' : ''}`,
      button: viewer ? 'View Reconciliation' : 'Go to Reconciliation', target: 'screen-30',
    };
  }
  return {
    title: 'This migration is complete',
    text: 'Every file is imported and confirmed. You can view or save the final report.',
    button: 'View Reports and Audit', target: 'screen-31',
  };
}

// The progress strip: the steps of the guided flow (FLOW in navigation.js), so the Dashboard, the flow header and
// Help count the same steps. Each is done from the server's own state.
function buildSteps(job, s) {
  const step = key => s.stepOf(key);
  return flowProgress({
    'screen-12': !!job,
    'screen-15': !!s.c && s.filesMissing.length === 0,
    'screen-16': s.processed && s.countMismatches.length === 0,
    'screen-17': s.processed,
    'screen-19': s.processed && s.blockingOpen === 0,
    'screen-20': s.processed, // journals with no decision use the default (v2): nothing waits here
    'screen-25': s.filesReady && !s.stale,
    'screen-40': s.allImported && !(s.held?.notInAnyFile > 0),
  });
}

const STATE_WORDS = { done: 'Done', current: 'Next', todo: 'Not yet' };

function IconTile({ Icon, size = 'w-12 h-12' }) {
  return (
    <span className={`${size} rounded-md bg-brand-soft flex items-center justify-center shrink-0`}>
      <Icon className="w-5 h-5 text-info-ink" strokeWidth={1.75} aria-hidden="true" />
    </span>
  );
}

export default function Screen11_Dashboard({ onNavigate, user }) {
  const viewer = user?.role === 'viewer';
  const firstName = String(user?.name || '').trim().split(/\s+/)[0];
  const { job, loading: jobLoading, error: jobError, reload } = useJob();

  const [migrations, setMigrations] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [details, setDetails] = useState(null);
  const [detailsError, setDetailsError] = useState('');
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState('');
  const listRef = useRef(null);

  const loadList = useCallback(async () => {
    try {
      setMigrations(await api.get('/migrations'));
      setListError('');
    } catch (e) {
      setListError(e.message);
    } finally {
      setListLoading(false);
    }
  }, []);
  useEffect(() => { loadList(); }, [loadList]);
  // a migration created or changed elsewhere (New Migration, the header) shows up here at once
  useEffect(() => {
    window.addEventListener(MIGRATIONS_CHANGED, loadList);
    return () => window.removeEventListener(MIGRATIONS_CHANGED, loadList);
  }, [loadList]);

  const jobId = job?.id;
  const processed = isProcessed(job);
  useEffect(() => {
    if (!jobId) { setDetails(null); setDetailsError(''); return undefined; }
    let cancelled = false;
    setDetailsError('');
    const base = `/migrations/${jobId}`;
    Promise.all([
      api.get(`${base}/summary`),
      api.get(`${base}/prepare`).catch(() => null),
      api.get(`${base}/imports`),
      api.get(`${base}/verification`),
    ]).then(([summary, prepare, imports, verification]) => {
      if (cancelled) return;
      setDetails({ summary, prepare, imports, verification });
      setDetailsError('');
    }).catch(e => {
      if (cancelled) return;
      setDetails(null);
      setDetailsError(e.message);
    });
    return () => { cancelled = true; };
  }, [jobId, processed, retry]);

  // While the files are being read, the page is brought up to date once reading ends.
  const onProcessFinish = useCallback(() => { reload(); loadList(); setRetry(n => n + 1); }, [reload, loadList]);
  useProcessStatus(isProcessing(job) ? jobId : null, onProcessFinish);

  const s = useMemo(() => readState(job, details), [job, details]);
  const detailsReady = !!job && !!details;
  // Until the details arrive the next step is unknown, so it counts as loading rather than guessing.
  const loading = jobLoading || listLoading || (!!job && !details && !detailsError);
  const error = friendlyError(jobError || listError);

  const step = nextStep({ job, migrations, viewer, s });
  const steps = buildSteps(job, s);

  // Another migration: the page stays and shows it (no reload); the header follows.
  const open = id => chooseMigration(id);
  const runStep = () => {
    if (step.scroll) listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else if (step.target) onNavigate(step.target, step.params || {});
  };

  const q = search.trim().toLowerCase();
  const rows = migrations.filter(m => !q
    || String(m.company || '').toLowerCase().includes(q)
    || String(m.id || '').toLowerCase().includes(q)
    || String(m.financial_year || '').toLowerCase().includes(q)
    || statusWords(m).toLowerCase().includes(q));

  const selectedId = jobId || null;

  const tiles = [
    { Icon: FolderOpen, label: 'Tally files uploaded', value: job && s.c ? `${s.c.uploaded} of ${s.c.total}` : '—', hint: !job ? 'No migration selected' : s.filesMissing.length ? 'Some are still needed' : s.countMismatches.length ? 'A record count does not match Tally' : 'Everything needed is in' },
    { Icon: Database, label: 'Records read', value: !job ? '—' : !s.processed ? 'Not yet' : s.records == null ? '—' : s.records.toLocaleString('en-IN'), hint: !job ? 'No migration selected' : s.processed ? 'Read from your Tally files' : 'Shown after the data is read' },
    // the same number as the Validation Center (GET summary counts.flagged)
    { Icon: CircleAlert, label: 'Flagged items', value: !job ? '—' : !s.processed ? 'Not yet' : !detailsReady ? '—' : s.flagged.toLocaleString('en-IN'), hint: !job ? 'No migration selected' : !s.processed ? 'Shown after the data is read' : s.flagged ? `${s.warnings.toLocaleString('en-IN')} of them warnings. Open the Validation Center` : 'Nothing flagged', target: job && s.processed && s.flagged ? 'screen-24' : null, tone: job && s.processed && detailsReady ? (s.flagged ? 'warning' : 'success') : undefined },
    { Icon: ClipboardCheck, label: 'Files imported', value: !job ? '—' : !detailsReady ? '—' : s.imports.length ? `${s.imported} of ${s.imports.length}` : 'Not yet', hint: !job ? 'No migration selected' : s.imports.length ? 'Marked as imported into Zoho Books' : 'Shown after files are created' },
  ];

  const columns = [
    { key: 'company', label: 'Company', render: m => (
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-ink">{m.company}</span>
        {m.id === selectedId && (
          <StatusChip tone="info"><Check className="w-3 h-3" strokeWidth={2.5} aria-hidden="true" /> Selected</StatusChip>
        )}
      </span>
    ) },
    { key: 'id', label: 'Migration', render: m => <span className="whitespace-nowrap tabular-nums text-muted">{m.id}</span> },
    { key: 'financial_year', label: 'Financial year', render: m => <span className="whitespace-nowrap">{m.financial_year}</span> },
    { key: 'status', label: 'Status', render: m => <StatusChip tone={statusTone(m)} dot>{statusWords(m)}</StatusChip> },
    { key: 'uploads', label: 'Tally files uploaded', align: 'right', render: m => Number(m.uploads || 0).toLocaleString('en-IN') },
    { key: 'records', label: 'Records', align: 'right', render: m => (m.records ? Number(m.records).toLocaleString('en-IN') : '—') },
    { key: 'updated_at', label: 'Last updated', render: m => <span className="whitespace-nowrap text-muted">{readableDate(m.updated_at)}</span> },
    { key: 'open', label: '', align: 'right', render: m => (
      m.id === selectedId
        ? <span className="text-[13px] text-subtle">Open now</span>
        : <button type="button" onClick={() => open(m.id)} className={`${btnSecondary} ${btnSmall}`} aria-label={`Open ${m.company}, ${m.financial_year}, ${m.id}`}>Open</button>
    ) },
  ];

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-7xl mx-auto space-y-5 text-ink">
      <PageHeader
        title={`Welcome back${firstName ? `, ${firstName}` : ''}`}
        help={<>
          {user?.firm ? `${user.firm}. ` : ''}
          {job ? <>You are working on <span className="font-medium text-ink">{job.company}</span> ({job.id}), financial year {job.financial_year}.</> : 'No migration is selected yet.'}
        </>}
        actions={!viewer && (
          <button type="button" onClick={() => onNavigate('screen-12')} className={btnSecondary}>
            <Plus className="w-4 h-4" aria-hidden="true" /> New Migration
          </button>
        )}
      />

      {error && (
        <div role="alert">
          <Note tone="danger">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <span>{error}</span>
              <button type="button" onClick={() => { setListLoading(true); loadList(); reload(); setRetry(n => n + 1); }} className={`${btnSecondary} ${btnSmall} shrink-0`}>
                <RotateCw className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /> Try again
              </button>
            </div>
          </Note>
        </div>
      )}

      {!error && (
        <OutOfDateBanner job={job} user={user} onNavigate={onNavigate} onDone={async () => { await reload(); setRetry(n => n + 1); loadList(); }} />
      )}

      {/* Next step: the text first, the buttons below it, wrapping on narrow screens */}
      <section aria-labelledby="next-step" className="rounded-lg border border-line border-l-4 border-l-brand bg-white shadow-xs p-5 sm:p-6">
        <div id="next-step" className="text-[13px] font-semibold uppercase tracking-wide text-info-ink">{viewer ? 'Where things stand' : 'Your next step'}</div>
        {loading ? (
          <p role="status" className="mt-2 text-[14px] text-muted">Loading your migrations…</p>
        ) : error ? (
          <p className="mt-2 text-[14px] text-muted">We could not load your migrations, so the next step cannot be shown right now.</p>
        ) : detailsError ? (
          <div role="alert" className="mt-2 space-y-4">
            <div className="min-w-0">
              <h2 className="text-[20px] leading-snug font-semibold tracking-tight">We could not load the details of this migration</h2>
              <p className="mt-1.5 text-[14px] text-muted max-w-2xl">{friendlyError(detailsError)}</p>
            </div>
            <button type="button" onClick={() => setRetry(n => n + 1)} className={btnSecondary}>
              <RotateCw className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /> Try again
            </button>
          </div>
        ) : (
          <div className="mt-2 space-y-5">
            <div className="min-w-0">
              <h2 className="text-[20px] leading-snug font-semibold tracking-tight">{step.title}</h2>
              <p className="mt-1.5 text-[14px] text-muted max-w-3xl">{step.text}</p>
            </div>
            {job && s.held?.notInAnyFile > 0 && step.params?.step !== 'held' && (
              <p className="flex items-start gap-2 text-[14px] text-ink">
                <CircleDashed className="w-4 h-4 shrink-0 mt-0.5 text-warning-ink" aria-hidden="true" />
                <span>Open item: {s.held.words}. <button type="button" className="underline font-medium text-info-ink" onClick={() => onNavigate('screen-40', { step: 'held' })}>What to do</button></span>
              </p>
            )}
            {job && s.zohoCheck && s.zohoCheck.rowsWill > 0 && (
              <p className="flex items-start gap-2 text-[14px] text-ink">
                <CircleAlert className="w-4 h-4 shrink-0 mt-0.5 text-danger-ink" aria-hidden="true" />
                <span>The Zoho check expects {s.zohoCheck.rowsWill.toLocaleString('en-IN')} rows to be refused{s.zohoCheck.rowsMay ? ` and ${s.zohoCheck.rowsMay.toLocaleString('en-IN')} that may be refused` : ''}. <button type="button" className="underline font-medium text-info-ink" onClick={() => onNavigate('screen-38')}>Open the Zoho check</button></span>
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {step.button && (
                <button type="button" onClick={runStep} className={btnPrimary}>
                  {step.button} <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </button>
              )}
              {job && (
                <button type="button" onClick={() => onNavigate('screen-36')} className={btnSecondary}>
                  Progress checklist
                </button>
              )}
              {job?.status === 'generated' && (
                <button type="button" onClick={() => onNavigate('screen-38')} className={btnSecondary}>
                  Zoho check
                </button>
              )}
              {job?.status === 'generated' && (
                <button type="button" onClick={() => onNavigate('screen-37')} className={btnSecondary}>
                  Voucher Reconciliation
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Progress: the steps of the guided flow */}
      {job && (
        <section aria-labelledby="progress" className="rounded-lg border border-line bg-white shadow-xs p-5 sm:p-6">
          <h2 id="progress" className="text-[16px] font-semibold tracking-tight">Progress</h2>
          <p className="mt-0.5 text-[13px] text-muted">{job.company}, financial year {job.financial_year}. The {steps.length} steps of the guided flow. Select any step to open it.</p>
          <ol className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-9 gap-3">
            {steps.map((st, i) => {
              // Steps after Upload depend on the details, so they stay neutral until those have loaded.
              const known = detailsReady || i < 3;
              const shown = known ? st.state : 'todo';
              const cls = `block w-full h-full text-left rounded-md border px-3 py-3 ${shown === 'current' ? 'border-brand bg-brand-soft' : shown === 'done' ? 'border-success-line bg-white' : 'border-line bg-white'}`;
              const target = st.id === 'screen-12' ? (viewer ? null : 'screen-12') : st.id;
              const params = st.id === 'screen-12' ? { edit: '1' } : {};
              const body = (
                <>
                  <span className={`w-8 h-8 rounded-full flex items-center justify-center text-[14px] font-semibold ${
                    shown === 'done' ? 'bg-success-ink text-white' : shown === 'current' ? 'bg-action text-white' : 'bg-soft-2 text-subtle'
                  }`}>
                    {shown === 'done' ? <Check className="w-4 h-4" strokeWidth={2} aria-hidden="true" /> : st.n}
                  </span>
                  <span className={`block mt-2.5 text-[14px] font-semibold leading-snug ${shown === 'todo' ? 'text-subtle' : 'text-ink'}`}>{st.title}</span>
                  <span className={`block text-[13px] ${shown === 'done' ? 'text-success-ink font-medium' : shown === 'current' ? 'text-info-ink font-medium' : 'text-subtle'}`}>{known ? STATE_WORDS[shown] : '—'}</span>
                </>
              );
              return (
                <li key={st.id}>
                  {target ? (
                    <button
                      type="button"
                      onClick={() => onNavigate(target, params)}
                      aria-current={shown === 'current' ? 'step' : undefined}
                      className={`${cls} hover:bg-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand`}
                    >
                      {body}
                    </button>
                  ) : (
                    <div aria-current={shown === 'current' ? 'step' : undefined} className={cls}>{body}</div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {/* Summary tiles */}
      <section aria-label="Summary of the selected migration" className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-4">
        {tiles.map(({ Icon, label, value, hint, target, tone }) => (
          <StatTile key={label} icon={Icon} label={label} value={loading ? '—' : value} hint={hint} tone={tone} onClick={target ? () => onNavigate(target) : undefined} />
        ))}
      </section>

      {/* Migrations */}
      <div ref={listRef} className="scroll-mt-6">
        <Card
          title="Your migrations"
          subtitle="Open a migration to work on it. Each has its own migration number."
          right={migrations.length > 0 && (
            <label className="relative block sm:w-72">
              <span className="sr-only">Search migrations</span>
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-subtle" strokeWidth={1.75} aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by company, number or year"
                className={`${inputClass} pl-9`}
              />
            </label>
          )}
        >
          {listLoading ? (
            <p role="status" className="p-6 text-[15px] text-muted">Loading your migrations…</p>
          ) : listError ? (
            <p className="p-6 text-[15px] text-muted">Your migrations could not be loaded.</p>
          ) : migrations.length === 0 ? (
            <EmptyState
              icon={FolderOpen}
              title="No migrations yet"
              text={viewer ? 'When your firm starts a migration, it will be listed here.' : 'Start one to move a company from TallyPrime to Zoho Books. It only takes a minute to set up.'}
              actionLabel={viewer ? undefined : 'New Migration'}
              onAction={() => onNavigate('screen-12')}
            />
          ) : (
            <Table columns={columns} rows={rows} rowKey={m => m.id} empty={`No migrations match "${search}".`} />
          )}
        </Card>
      </div>

      {/* Quick links */}
      <section aria-labelledby="quick-links">
        <h2 id="quick-links" className="text-[16px] font-semibold tracking-tight mb-3">Quick links</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-4">
          {QUICK_LINKS.map(({ Icon, title, text, target }) => (
            <button
              key={title}
              type="button"
              onClick={() => onNavigate(target)}
              className="group rounded-lg border border-line bg-white shadow-xs p-4 text-left flex items-center gap-4 hover:bg-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <IconTile Icon={Icon} size="w-10 h-10" />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold">{title}</span>
                <span className="block text-[13px] text-muted">{text}</span>
              </span>
              <ArrowRight className="w-4 h-4 text-subtle group-hover:text-ink shrink-0" strokeWidth={1.75} aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
