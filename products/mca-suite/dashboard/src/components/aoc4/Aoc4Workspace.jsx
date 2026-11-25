// AOC-4 full form workspace: Page 1 (company details, 7 phases) · Page 2 (attachments & declaration)
// · AOC-2 · Auditor's report extract · Board's report extract — for one pushed AOC-4 job.
// Page-1 edits are written back into the job payload; everything else is saved in the company master
// (company-answers), which is where the extension reads it from.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { RefreshCw, Save, Rocket, AlertTriangle, CheckCircle2, FileStack, Plus, Building2 } from 'lucide-react';
import {
  getJob, updateJobPayload, updateExtensionJob, getLinkedPreview, pushToExtension,
} from '../../lib/api.js';
import { listAttachments } from '../../lib/attachmentsApi.js';
import { AOC4_PHASES } from '../../data/aoc4Sections.js';
import Page1, { phaseStats } from './Page1.jsx';
import Page2, { page2Stats } from './Page2.jsx';
import Aoc2Rows, { parseAoc2Rows, isAoc2Unreadable, rowProblems } from './Aoc2Rows.jsx';
import LinkedReport, { linkedStats } from './LinkedReport.jsx';
import { Badge } from './FieldRow.jsx';
import CompanyPicker, { StatusBadge } from './CompanyPicker.jsx';
import NewCompanyDialog from './NewCompanyDialog.jsx';
import { listAoc4Filings, describeJob, getLastJobId, setLastJobId } from '../../lib/aoc4CompanyApi.js';
import {
  flatten, isBlank, applyEdits, fetchCompanyAnswers, saveCompanyAnswers, normDate,
} from './aoc4Data.js';

const CIN_RE = /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;
const LINKED = ['aoc2', 'eauditor', 'eboard'];

// Props: initialJobId (open this job), onJobChange(job|null) when the selection changes,
// onStats({ filled, missing, percent, pages } | null) whenever the selected job's counts change
// (filled / missing are Page 1; percent is across every page).
export default function Aoc4Workspace({ initialJobId, onJobChange, onStats } = {}) {
  const [jobs, setJobs] = useState([]);                   // AOC-4 filings, described (see listAoc4Filings)
  const [jobsState, setJobsState] = useState({ loading: true, error: null });
  const [jobId, setJobId] = useState(initialJobId || '');
  const [showNew, setShowNew] = useState(false);
  const onJobChangeRef = useRef(onJobChange);
  const onStatsRef = useRef(onStats);
  useEffect(() => { onJobChangeRef.current = onJobChange; onStatsRef.current = onStats; }, [onJobChange, onStats]);
  const [job, setJob] = useState(null);
  const [jobState, setJobState] = useState({ loading: false, error: null });
  const [answers, setAnswers] = useState({ aoc4: {}, aoc2: {}, eauditor: {}, eboard: {} });
  const [labels, setLabels] = useState({});
  const [answersError, setAnswersError] = useState(null);
  const [preview, setPreview] = useState({});
  const [previewState, setPreviewState] = useState({ loading: false, error: null });

  const [p1Edits, setP1Edits] = useState({});
  const [ansEdits, setAnsEdits] = useState({});          // `${formType}:${key}` → {formType,key,label,value}
  const [aoc2Rows, setAoc2Rows] = useState(null);
  const [aoc2Dirty, setAoc2Dirty] = useState(false);
  const [aoc2Unreadable, setAoc2Unreadable] = useState(false);

  const [attachList, setAttachList] = useState(null);   // dashboard (a)/(g) PDFs of this company; null = unknown

  const [tab, setTab] = useState('page1');
  const [busy, setBusy] = useState(null);                 // 'save' | 'push'
  const [message, setMessage] = useState(null);           // {tone, text}

  // ───────────── loading ─────────────

  const loadJobs = useCallback(async () => {
    setJobsState({ loading: true, error: null });
    try {
      const list = await listAoc4Filings();
      // Keep a selected job that is older than the recent list in the picker.
      setJobs(prev => {
        const extra = prev.filter(p => p.pinned && !list.some(x => x.id === p.id));
        return [...list, ...extra];
      });
      setJobsState({ loading: false, error: null });
      return list;
    } catch (err) {
      setJobsState({ loading: false, error: err.message || 'Could not load jobs' });
      return [];
    }
  }, []);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  // Makes sure a job id that is not in the recent list still shows in the picker. Returns false when it is gone.
  const ensureListed = useCallback(async (id) => {
    try {
      const d = await describeJob(id);
      if (!d || d.formType !== 'aoc4') return false;
      setJobs(prev => (prev.some(x => x.id === id) ? prev : [...prev, { ...d, pinned: true }]));
      return true;
    } catch { return false; }
  }, []);

  // Selection: the job the parent asks for; otherwise the last job opened here, if it still exists; otherwise none
  // (the CA chooses a company or adds a new one — never "whatever was pushed last").
  useEffect(() => {
    if (initialJobId) { setJobId(initialJobId); ensureListed(initialJobId); }
  }, [initialJobId, ensureListed]);

  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || initialJobId || jobsState.loading) return;
    restoredRef.current = true;
    const last = getLastJobId();
    if (!last) return;
    if (jobs.some(j => j.id === last)) { setJobId(prev => prev || last); return; }
    ensureListed(last).then(ok => { if (ok) setJobId(prev => prev || last); else setLastJobId(''); });
  }, [initialJobId, jobsState.loading, jobs, ensureListed]);

  useEffect(() => { if (jobId) setLastJobId(jobId); }, [jobId]);

  const flat = useMemo(() => flatten(job?.payload), [job]);
  const cin = String(flat.CIN || '').trim().toUpperCase();

  // Clears every per-company value first, so another company's answers / contracts never show (or get saved)
  // under this job's company when its CIN is invalid or the company master cannot be reached.
  const clearCompany = useCallback(() => {
    setAnswers({ aoc4: {}, aoc2: {}, eauditor: {}, eboard: {} }); setLabels({});
    setAoc2Rows(null); setAoc2Dirty(false); setAoc2Unreadable(false);
  }, []);

  const loadAnswers = useCallback(async (c) => {
    clearCompany();
    if (!CIN_RE.test(c)) { setAnswersError(null); return; }
    try {
      const { answers: a, labels: l } = await fetchCompanyAnswers(c);
      setAnswers(a); setLabels(l); setAnswersError(null);
      setAoc2Rows(parseAoc2Rows(a.aoc2?.ROWS));
      setAoc2Unreadable(isAoc2Unreadable(a.aoc2?.ROWS));
      setAoc2Dirty(false);
    } catch (err) {
      setAnswersError(`Company master is offline — saved answers could not be loaded (${err.message || 'no response'}).`);
    }
  }, [clearCompany]);

  const loadPreview = useCallback(async (c, id) => {
    if (!CIN_RE.test(c) || !id) { setPreview({}); return; }
    setPreviewState({ loading: true, error: null });
    try {
      const res = await getLinkedPreview(c, id);
      const p = res?.preview || res || {};
      setPreview({ aoc2: p.aoc2, eauditor: p.eauditor, eboard: p.eboard });
      setPreviewState({ loading: false, error: null });
    } catch (err) {
      setPreviewState({ loading: false, error: `Preview unavailable: ${err.message}` });
    }
  }, []);

  const loadJob = useCallback(async (id) => {
    if (!id) { setJob(null); return null; }
    setJobState({ loading: true, error: null });
    try {
      const res = await getJob(id);
      const j = res?.job || res;
      if (j && typeof j.payload === 'string') { try { j.payload = JSON.parse(j.payload); } catch { j.payload = {}; } }
      setJob(j);
      setJobState({ loading: false, error: null });
      return j;
    } catch (err) {
      setJob(null);
      setJobState({ loading: false, error: err.message || 'Could not load the job' });
      return null;
    }
  }, []);

  const reloadAll = useCallback(async (id) => {
    const j = await loadJob(id);
    const c = String(flatten(j?.payload).CIN || '').trim().toUpperCase();
    await Promise.all([loadAnswers(c), loadPreview(c, id)]);
  }, [loadJob, loadAnswers, loadPreview]);

  // After "Save selected" in the AI panel: reload this company's answers and the linked preview only. Unsaved hand
  // edits are kept (answer edits live in ansEdits; the AOC-2 table is not replaced while it has unsaved edits).
  const reloadAfterAi = useCallback(async () => {
    if (!CIN_RE.test(cin) || !job?.id) return;
    try {
      const { answers: a, labels: l } = await fetchCompanyAnswers(cin);
      setAnswers(a); setLabels(l); setAnswersError(null);
      if (aoc2Dirty) {
        setMessage({ tone: 'warn', text: 'Your unsaved AOC-2 table edits were kept. Save them, or press Refresh to see the rows the AI saved.' });
      } else {
        setAoc2Rows(parseAoc2Rows(a.aoc2?.ROWS));
        setAoc2Unreadable(isAoc2Unreadable(a.aoc2?.ROWS));
      }
    } catch (err) {
      setAnswersError(`Company master is offline — saved answers could not be loaded (${err.message || 'no response'}).`);
    }
    await loadPreview(cin, job.id);
  }, [cin, job?.id, aoc2Dirty, loadPreview]);

  useEffect(() => {
    setP1Edits({}); setAnsEdits({}); setMessage(null);
    clearCompany(); setPreview({}); setPreviewState({ loading: false, error: null });
    if (jobId) reloadAll(jobId);
  }, [jobId, reloadAll, clearCompany]);

  // Attachments of the company (Page 2 keeps them current through onAttachmentsChange). Offline → unknown.
  useEffect(() => {
    setAttachList(null);
    if (!CIN_RE.test(cin)) return undefined;
    let live = true;
    listAttachments(cin).then(l => { if (live) setAttachList(l); }).catch(() => {});
    return () => { live = false; };
  }, [cin]);

  // ───────────── values ─────────────

  const p1Value = useCallback(key => {
    if (Object.prototype.hasOwnProperty.call(p1Edits, key)) return p1Edits[key];
    if (!isBlank(flat[key])) return flat[key];
    return answers.aoc4?.[key] ?? '';
  }, [p1Edits, flat, answers]);
  const p1Source = useCallback(key => (
    !Object.prototype.hasOwnProperty.call(p1Edits, key) && isBlank(flat[key]) && !isBlank(answers.aoc4?.[key]) ? 'answers' : 'payload'
  ), [p1Edits, flat, answers]);

  const ansValue = useCallback((formType, key) => {
    const e = ansEdits[`${formType}:${key}`];
    if (e) return e.value;
    return answers[formType]?.[key] ?? '';
  }, [ansEdits, answers]);
  const ansDirty = useCallback((formType, key) => !!ansEdits[`${formType}:${key}`], [ansEdits]);
  const editAnswer = (formType, key, label, value) => setAnsEdits(prev => ({ ...prev, [`${formType}:${key}`]: { formType, key, label, value } }));

  const p2Value = useCallback(key => ansValue('aoc4', key), [ansValue]);
  const p2Edits = useMemo(() => Object.fromEntries(Object.values(ansEdits).filter(e => e.formType === 'aoc4').map(e => [e.key, e.value])), [ansEdits]);

  const p2Suggestions = useMemo(() => {
    const s = {};
    const desig = p2Value('DECL_DESIGNATION') || 'Director';
    if (desig === 'Director' && /^\d{7,8}$/.test(String(flat.FS_SIG_1_DIN || ''))) s.DECL_DIN = { value: String(flat.FS_SIG_1_DIN).padStart(8, '0'), from: 'first signatory of the financial statements' };
    const bm = normDate(flat.BOARD_MEETING_DATE);
    if (bm) s.BOARD_RESOLUTION_DATE = { value: bm, from: 'board meeting date' };
    s.DECL_DESIGNATION = { value: 'Director', from: 'default' };
    return s;
  }, [flat, p2Value]);

  // ───────────── counts ─────────────

  const stats = useMemo(() => {
    const p1 = AOC4_PHASES.map(p => phaseStats(p, p1Value)).reduce((a, s) => ({ filled: a.filled + s.filled, missing: a.missing + s.missing, total: a.total + s.total }), { filled: 0, missing: 0, total: 0 });
    const p2s = page2Stats(p2Value);
    const hasA = attachList ? attachList.some(a => a.slot === 'a') : null;
    const p2 = hasA === null ? p2s : { filled: p2s.filled + (hasA ? 1 : 0), missing: p2s.missing + (hasA ? 0 : 1), total: p2s.total + 1 };
    const rows = aoc2Rows || [];
    const aoc2 = { filled: rows.length, missing: aoc2Rows === null || aoc2Unreadable ? 1 : rows.filter(r => rowProblems(r).length).length };
    return {
      page1: p1, page2: p2, aoc2,
      eauditor: linkedStats(preview.eauditor, ansValue, 'eauditor'),
      eboard: linkedStats(preview.eboard, ansValue, 'eboard'),
    };
  }, [p1Value, p2Value, aoc2Rows, aoc2Unreadable, preview, ansValue, attachList]);

  const dirtyCount = Object.keys(p1Edits).length + Object.keys(ansEdits).length + (aoc2Dirty ? 1 : 0);

  // Tell the parent which job is open and how complete it is.
  const loadedJob = job && job.id === jobId ? job : null;
  // Report only settled selections: never a transient null while the chosen job is still loading.
  useEffect(() => { if (loadedJob || !jobId) onJobChangeRef.current?.(loadedJob); }, [loadedJob?.id, jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  const statsKey = loadedJob ? JSON.stringify(stats) : '';
  useEffect(() => {
    if (!loadedJob) { if (!jobId) onStatsRef.current?.(null); return; }
    const pages = Object.values(stats);
    const filled = pages.reduce((a, s) => a + (s.filled || 0), 0);
    const missing = pages.reduce((a, s) => a + (s.missing || 0), 0);
    const total = filled + missing;
    onStatsRef.current?.({
      filled: stats.page1.filled,
      missing: stats.page1.missing,
      percent: total ? Math.round((filled / total) * 100) : 0,
      pages: stats,
    });
  }, [statsKey, jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ───────────── save / push ─────────────

  // requeue: false when a Push follows (the pushed copy is the new job; the old one must not be imported again).
  const save = async ({ requeue = true } = {}) => {
    if (!job) return null;
    const problems = [];
    let payload = job.payload || {};
    let unmapped = [];
    let requeued = false;
    if (Object.keys(p1Edits).length) {
      ({ payload, unmapped } = applyEdits(job.payload, p1Edits));
      await updateJobPayload(job.id, payload);
      // The extension imports a job's payload only while it is "ready": put an already imported job back in the
      // queue so the new Page-1 values reach it (never while it is filling MCA right now).
      const st = String(job.status || '').toLowerCase();
      if (requeue && st && st !== 'ready' && st !== 'filling') { await updateExtensionJob(job.id, { status: 'ready' }); requeued = true; }
    }
    const nextCin = String(flatten(payload).CIN || '').trim().toUpperCase();
    const byForm = {};
    const add = (formType, key, label, value) => (byForm[formType] = byForm[formType] || []).push({ key, label, value: String(value ?? '') });
    for (const u of unmapped) add('aoc4', u.key, u.label, u.value);
    for (const e of Object.values(ansEdits)) {
      let v = typeof e.value === 'string' ? e.value.trim() : e.value;
      if (/(^|_)DATE$/.test(e.key) && v) {
        const d = normDate(v);
        if (!d) { problems.push(`${e.label}: use DD/MM/YYYY`); continue; }
        v = d;
      }
      add(e.formType, e.key, e.label, v);
    }
    if (aoc2Dirty) {
      const rows = (aoc2Rows || []).map(r => ({ ...r, approvalDate: normDate(r.approvalDate) || r.approvalDate }));
      add('aoc2', 'ROWS', 'Related-party contracts at arm’s length', JSON.stringify(rows));
    }
    if (Object.keys(byForm).length) {
      if (!CIN_RE.test(nextCin)) throw new Error('Enter a valid CIN on Page 1 first — answers are saved per company.');
      for (const [formType, list] of Object.entries(byForm)) await saveCompanyAnswers(nextCin, formType, list);
    }
    setP1Edits({}); setAnsEdits({}); setAoc2Dirty(false);
    const j = await loadJob(job.id);
    await Promise.all([loadAnswers(nextCin), loadPreview(nextCin, job.id)]);
    return { payload: j?.payload || payload, problems, requeued, filling: String(job.status || '').toLowerCase() === 'filling' && Object.keys(p1Edits).length > 0 };
  };

  const onSave = async () => {
    setBusy('save'); setMessage(null);
    try {
      const r = await save();
      setMessage(r?.problems?.length
        ? { tone: 'warn', text: `Saved, except: ${r.problems.join('; ')}` }
        : r?.filling
          ? { tone: 'warn', text: 'Saved. The extension is filling this job on MCA right now — press "Push to extension" afterwards so it picks up the new Page 1 values.' }
          : { tone: 'ok', text: r?.requeued
            ? 'Saved. The job is back in the extension queue with the new Page 1 values — the side panel picks it up within a few seconds.'
            : 'Saved. The extension will use these values the next time it runs this job.' });
    } catch (err) {
      setMessage({ tone: 'error', text: err.message || 'Save failed' });
    } finally { setBusy(null); }
  };

  const onPush = async () => {
    setBusy('push'); setMessage(null);
    try {
      const r = dirtyCount ? await save({ requeue: false }) : { payload: job.payload, problems: [] };
      const res = await pushToExtension({
        formType: 'aoc4',
        clientId: job.client_id || r.payload?.clientId || cin.toLowerCase(),
        clientName: job.client_name || flat.COMPANY_NAME || cin,
        payload: r.payload,
      });
      setMessage({ tone: 'ok', text: `Pushed to the extension as ${res?.jobId || 'a new job'}. Open the Germin8 side panel and run it.` });
      await loadJobs();
      if (res?.jobId) { await ensureListed(res.jobId); setJobId(res.jobId); }
    } catch (err) {
      setMessage({ tone: 'error', text: err.message || 'Push failed' });
    } finally { setBusy(null); }
  };

  const changeJob = id => {
    if (id === jobId) return false;
    if (dirtyCount && !window.confirm('You have unsaved changes. Switch company and discard them?')) return false;
    setJobId(id);
    return true;
  };

  const openFromDialog = async (id, created) => {
    if (id !== jobId && !changeJob(id)) return;
    setShowNew(false);
    await loadJobs();
    await ensureListed(id);
    if (created) setMessage({ tone: 'ok', text: 'Filing created. Fill Page 1 and the other pages, then press Save or Push to extension.' });
  };

  // ───────────── render ─────────────

  const TABS = [
    { id: 'page1', label: 'Page 1 — Company details', s: stats.page1 },
    { id: 'page2', label: 'Page 2 — Attachments & declaration', s: stats.page2 },
    { id: 'aoc2', label: 'AOC-2', s: stats.aoc2, count: `${(aoc2Rows || []).length} rows` },
    { id: 'eauditor', label: "Auditor's report", s: stats.eauditor },
    { id: 'eboard', label: "Board's report", s: stats.eboard },
  ];

  const companyName = flat.COMPANY_NAME || job?.client_name || '';

  return (
    <div className="space-y-4 text-ink">
      {/* Company picker */}
      <section className="bg-surface border border-line rounded-xl shadow-sm p-4 sm:p-5">
        <div className="flex flex-col lg:flex-row lg:items-center gap-4 justify-between">
          <div className="flex items-start gap-3 min-w-0">
            <span className="w-10 h-10 rounded-xl bg-gold-50 border border-gold-200 text-gold-700 flex items-center justify-center shrink-0">
              <FileStack className="w-5 h-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-ink">AOC-4 full form</h2>
              <p className="text-xs text-ink-muted">Page 1 · Page 2 · AOC-2 · Auditor's report · Board's report — everything the extension fills, in MCA order.</p>
              {job && (
                <p className="text-xs text-ink mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 min-w-0">
                  <span className="font-medium truncate">{companyName || 'Unnamed company'}</span>
                  {cin && <span className="text-ink-muted">· {cin}</span>}
                  {flat.FY_TO && <span className="text-ink-muted">· FY ending {flat.FY_TO}</span>}
                  {job.status && <StatusBadge status={String(job.status).toLowerCase()} />}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 w-full lg:w-auto">
            <CompanyPicker filings={jobs} selectedId={jobId} onSelect={changeJob} loading={jobsState.loading}
              className="flex-1 min-w-0 sm:w-80 lg:flex-none" />
            <button type="button" onClick={() => { loadJobs(); if (jobId) reloadAll(jobId); }} title="Refresh" aria-label="Refresh"
              className="p-2 rounded-lg border border-line bg-white text-ink-muted hover:bg-gold-50 hover:text-ink shrink-0">
              <RefreshCw className={clsx('w-4 h-4', (jobsState.loading || jobState.loading) && 'animate-spin')} />
            </button>
            <button type="button" onClick={() => setShowNew(true)}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-gold-300 bg-gold-50 px-3 py-2 text-sm font-semibold text-gold-800 hover:bg-gold-100 whitespace-nowrap w-full sm:w-auto">
              <Plus className="w-4 h-4" /> New company
            </button>
          </div>
        </div>
        {jobsState.error && <p className="text-xs text-rose-700 mt-3">Could not load the AOC-4 filings: {jobsState.error}</p>}
      </section>

      {!jobId && (
        <section className="bg-surface border border-dashed border-gold-300 rounded-xl p-6 sm:p-8 text-center">
          <span className="mx-auto w-12 h-12 rounded-2xl bg-gold-50 border border-gold-200 text-gold-700 flex items-center justify-center">
            <Building2 className="w-6 h-6" />
          </span>
          <h3 className="mt-3 text-base font-semibold text-ink">Choose a company, or add a new one</h3>
          <p className="mt-1 text-xs text-ink-muted max-w-md mx-auto">
            {jobs.length
              ? 'Pick the company and financial year you want to work on. Every AOC-4 field opens for it: Page 1, Page 2, AOC-2 and both report extracts.'
              : 'There are no AOC-4 filings yet. Add the company with its CIN, or scan its financial statements to fill the form for you.'}
          </p>
          <div className="mt-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2 max-w-md mx-auto">
            {jobs.length > 0 && (
              <CompanyPicker filings={jobs} selectedId={jobId} onSelect={changeJob} loading={jobsState.loading} className="flex-1 min-w-0 text-left" />
            )}
            <button type="button" onClick={() => setShowNew(true)}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-gold-700 hover:bg-gold-800 px-4 py-2 text-sm font-semibold text-white shadow-sm whitespace-nowrap">
              <Plus className="w-4 h-4" /> New company
            </button>
          </div>
        </section>
      )}

      <NewCompanyDialog open={showNew} onClose={() => setShowNew(false)} filings={jobs}
        onCreated={id => openFromDialog(id, true)} onOpenExisting={id => openFromDialog(id, false)} />

      {jobState.error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{jobState.error}</div>}

      {job && (
        <>
          {/* Summary bar */}
          <section className="bg-surface border border-line rounded-xl shadow-sm p-4 lg:sticky lg:top-20 z-10">
            <div className="flex flex-col xl:flex-row xl:items-center gap-3 justify-between">
              <div role="tablist" aria-label="AOC-4 pages" className="flex gap-2 overflow-x-auto no-scrollbar sm:grid sm:grid-cols-5 flex-1 min-w-0">
                {TABS.map(t => (
                  <button key={t.id} type="button" onClick={() => setTab(t.id)} role="tab" aria-selected={tab === t.id} title={t.label}
                    className={clsx('shrink-0 min-w-[150px] sm:min-w-0 text-left rounded-lg border px-3 py-2 transition-colors',
                      tab === t.id ? 'border-gold-300 bg-gold-50' : 'border-line bg-white hover:bg-gold-50/50')}>
                    <span className={clsx('block text-[11px] font-semibold truncate', tab === t.id ? 'text-gold-800' : 'text-ink')}>{t.label}</span>
                    <span className="flex items-center gap-1.5 mt-0.5 text-[11px]">
                      <span className="text-ink-muted">{t.count || `${t.s.filled} filled`}</span>
                      {t.s.missing > 0
                        ? <span className="text-rose-700 font-medium">· {t.s.missing} missing</span>
                        : <CheckCircle2 className="w-3 h-3 text-emerald-600" />}
                    </span>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {dirtyCount > 0 && <Badge tone="gold">{dirtyCount} unsaved</Badge>}
                <button type="button" onClick={onSave} disabled={!!busy || !dirtyCount}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink hover:bg-gold-50 disabled:opacity-50 disabled:cursor-not-allowed">
                  <Save className="w-4 h-4" /> {busy === 'save' ? 'Saving…' : 'Save'}
                </button>
                <button type="button" onClick={onPush} disabled={!!busy}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-gold-700 hover:bg-gold-800 px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">
                  <Rocket className="w-4 h-4" /> {busy === 'push' ? 'Pushing…' : 'Push to extension 🚀'}
                </button>
              </div>
            </div>
            {message && (
              <p className={clsx('mt-3 text-xs flex items-center gap-1.5',
                message.tone === 'ok' ? 'text-emerald-700' : message.tone === 'warn' ? 'text-amber-700' : 'text-rose-700')}>
                {message.tone === 'ok' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />} {message.text}
              </p>
            )}
            {(!CIN_RE.test(cin) || answersError) && (
              <p className="mt-2 text-xs text-amber-700 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                {!CIN_RE.test(cin) ? 'This job has no valid CIN yet — enter it in Page 1 so Page 2, AOC-2 and the reports can be saved.' : answersError}
              </p>
            )}
          </section>

          {jobState.loading && !job.payload ? (
            <p className="text-sm text-ink-muted">Loading…</p>
          ) : (
            <>
              {tab === 'page1' && (
                <Page1 valueOf={p1Value} sourceOf={p1Source} edits={p1Edits}
                  onEdit={(k, v) => setP1Edits(prev => ({ ...prev, [k]: v }))}
                  suggestText={flat.BUSINESS_ACTIVITY || companyName} />
              )}
              {tab === 'page2' && (
                <Page2 valueOf={p2Value} sourceOf={() => 'payload'} edits={p2Edits}
                  onEdit={(k, v) => editAnswer('aoc4', k, PAGE2_LABEL[k] || k, v)} suggestions={p2Suggestions}
                  cin={cin} jobId={job.id} onAttachmentsChange={setAttachList} />
              )}
              {tab === 'aoc2' && (
                <Aoc2Rows rows={aoc2Rows} dirty={aoc2Dirty} preview={preview.aoc2} unreadable={aoc2Unreadable && !aoc2Dirty}
                  error={previewState.error} cin={cin} jobId={job.id} onReload={reloadAfterAi}
                  onChange={rows => { setAoc2Rows(rows); setAoc2Dirty(true); }} />
              )}
              {LINKED.slice(1).map(id => tab === id && (
                <LinkedReport key={id} formId={id}
                  title={id === 'eauditor' ? "Extract of the auditor's report (standalone)" : "Extract of the Board's report"}
                  intro={id === 'eauditor'
                    ? "Built from the AOC-4 data and your saved answers. Fill what is still needed; the extension fills the rest on MCA."
                    : "Built from the AOC-4 data, the AOC-2 contracts and your saved answers. Fill what is still needed."}
                  preview={preview[id]} loading={previewState.loading} error={previewState.error}
                  answers={answers} labels={labels} valueOf={ansValue} isDirty={ansDirty} onEdit={editAnswer}
                  cin={cin} jobId={job.id} onReload={reloadAfterAi} />
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}

const PAGE2_LABEL = {
  BOARD_RESOLUTION_NO: 'Declaration — board resolution number',
  BOARD_RESOLUTION_DATE: 'Declaration — board resolution date',
  DECL_DESIGNATION: 'Declaration — designation of the signatory',
  DECL_DIN: 'Declaration — DIN/PAN of the signatory',
  CERT_PROFESSION: 'Certificate: profession',
  CERT_ASSOC_FELLOW: 'Certificate: Associate / Fellow',
  CERT_MEMBERSHIP_NO: 'Certificate: membership number',
  CERT_COP_NO: 'Certificate: certificate of practice number',
};
