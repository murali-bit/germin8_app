// "Report text (verbatim)": after an AOC-4 scan with a valid CIN, the uploaded auditor's report PDF (scanned pages are
// transcribed word for word) and the Board's report .docx are split by their headings into the answers of the linked
// forms "Extract of Auditor's report" and "Extract of Board's report". Same words as the signed reports; only quotes,
// bullets and line breaks are simplified (MCA does not keep them). Nothing is saved until the CA clicks Save.
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { FileText, Loader2, RefreshCw, Save, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { fileToBase64, transcribeReport, splitReportText } from '../../lib/reportTextApi.js';
import { Badge } from '../aoc4/FieldRow.jsx';

const ACTION = {
  fill: { tone: 'ok', text: 'Fill (blank now)' },
  replace: { tone: 'warn', text: 'Replace test / AI value' },
  same: { tone: 'neutral', text: 'Already saved' },
  keep: { tone: 'neutral', text: "Keep CA's answer" },
};
const FORM_LABEL = { eauditor: "Auditor's report", eboard: "Board's report" };
const DEFAULT_PAGES = '1-6';

// Readings live outside the component (the scanner re-renders often): one transcription per file, CIN and page range.
const sessions = new Map();   // key → {promise}

function runOne({ cin, file, pages, refresh }) {
  const key = `${cin}|${file.id}|${file.kind === 'pdf' ? pages : ''}`;
  if (!refresh && sessions.has(key)) return sessions.get(key).promise;
  const promise = (async () => {
    const base64 = await fileToBase64(file.file);
    const t = await transcribeReport(file.kind === 'pdf'
      ? { cin, base64, fileName: file.name, pages, refresh }
      : { cin, docxBase64: base64, fileName: file.name });
    const s = await splitReportText({ cin, text: t.text, kind: 'auto' });
    return { transcript: t, split: s };
  })();
  sessions.set(key, { promise });
  promise.catch(() => sessions.delete(key));
  return promise;
}

function preview(v, key) {
  if (key === 'BOARD_MEETINGS') {
    try { return JSON.parse(v).map(m => `${m.date} · ${m.attended} of ${m.total} directors`).join('\n'); } catch { return v; }
  }
  return v;
}

function FileBlock({ cin, file }) {
  const [pages, setPages] = useState(DEFAULT_PAGES);
  const [state, setState] = useState({ phase: 'reading' });
  const [force, setForce] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [applied, setApplied] = useState(DEFAULT_PAGES);   // the page range of the last reading
  const [tick, setTick] = useState(0);
  const refreshRef = useRef(false);                        // 'Read again' on the same pages: a fresh paid reading

  useEffect(() => {
    let live = true;
    setState({ phase: 'reading' }); setResult(null);
    const refresh = refreshRef.current;
    refreshRef.current = false;
    runOne({ cin, file, pages: applied, refresh })
      .then(r => { if (live) setState({ phase: 'ready', ...r }); })
      .catch(err => { if (live) setState({ phase: 'error', message: err.message }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cin, file.id, applied, tick]);

  const readAgain = () => {
    if (file.kind === 'pdf' && pages !== applied) { setApplied(pages); return; }
    refreshRef.current = true;
    setTick(t => t + 1);
  };

  const save = async () => {
    if (state.phase !== 'ready') return;
    setSaving(true); setResult(null);
    try {
      const r = await splitReportText({ cin, text: state.transcript.text, kind: 'auto', save: true, force });
      setState(s => ({ ...s, split: { ...s.split, actions: r.actions } }));
      setResult({ tone: r.skipped?.some(x => /CA's own/.test(x.reason)) ? 'warn' : 'ok',
        text: `Saved ${r.saved.length} answer(s).${r.skipped?.length ? ` Not saved: ${r.skipped.map(x => `${x.key} (${x.reason})`).join('; ')}.` : ''}` });
    } catch (err) {
      setResult({ tone: 'error', text: err.message });
    } finally { setSaving(false); }
  };

  const split = state.split;
  const rows = split ? ['eauditor', 'eboard'].flatMap(form => Object.entries(split.sections[form] || {}).map(([key, s]) => ({ form, key, ...s }))) : [];
  const warnBy = k => (split?.warnings || []).filter(w => `${w.form}:${w.key}` === k);

  return (
    <div className="border-t border-line pt-3 mt-3 first:border-t-0 first:pt-0 first:mt-0">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-ink break-all">{file.name}</span>
        <span className="text-ink-subtle">{file.kind === 'pdf' ? 'PDF — transcribed word for word' : 'Word file — read directly'}</span>
        {file.kind === 'pdf' && (
          <span className="flex items-center gap-1 ml-auto">
            <label className="text-[11px] text-ink-muted" htmlFor={`pages-${file.id}`}>Pages</label>
            <input id={`pages-${file.id}`} value={pages} onChange={e => setPages(e.target.value.replace(/[^\d-]/g, '').slice(0, 9))}
              className="w-16 rounded-lg border border-line-input bg-white px-2 py-1 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-gold-500" />
          </span>
        )}
        <button type="button" onClick={readAgain} disabled={state.phase === 'reading'}
          className={clsx('inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11px] font-semibold text-ink hover:bg-page disabled:opacity-50', file.kind !== 'pdf' && 'ml-auto')}>
          <RefreshCw className="w-3 h-3" /> {file.kind === 'pdf' && pages !== applied ? 'Read these pages' : 'Read again'}
        </button>
      </div>

      {state.phase === 'reading' && (
        <p className="mt-2 text-xs text-ink-muted flex items-center gap-1.5" role="status">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-gold-700" /> {file.kind === 'pdf' ? 'Transcribing the report pages… ~1 min' : 'Reading the Word file…'}
        </p>
      )}
      {state.phase === 'error' && (
        <p role="alert" className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {state.message}
        </p>
      )}
      {state.phase === 'ready' && (
        <div className="mt-2">
          {(state.transcript.warnings || []).map(w => <p key={w} className="text-[11px] text-amber-800">{w}</p>)}
          {rows.length === 0 ? (
            <p className="text-xs text-ink-muted">No report heading was found in this file (Opinion, Basis for Opinion, Directors' Responsibility Statement…). Check the page range.</p>
          ) : (
            <ul className="divide-y divide-line border border-line rounded-lg">
              {rows.map(r => {
                const k = `${r.form}:${r.key}`;
                const act = split.actions?.[r.form]?.[r.key];
                return (
                  <li key={k} className="px-3 py-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink">{r.label || r.key}</span>
                      <span className="text-ink-subtle">{FORM_LABEL[r.form]}{r.page ? ` · p.${r.page}` : ''} · {split.lengths?.[r.form]?.[r.key] ?? String(r.value).length} chars</span>
                      {r.reference && <Badge tone="neutral">Reference only</Badge>}
                      {act && !r.reference && <Badge tone={ACTION[act]?.tone || 'neutral'}>{ACTION[act]?.text || act}</Badge>}
                    </div>
                    <details className="mt-1">
                      <summary className="cursor-pointer text-ink-muted break-words">{String(preview(r.value, r.key)).slice(0, 160)}{String(r.value).length > 160 ? '…' : ''}</summary>
                      <div className="mt-1 whitespace-pre-wrap break-words text-ink max-h-60 overflow-y-auto">{preview(r.value, r.key)}</div>
                      {r.heading && <p className="mt-1 text-[11px] text-ink-subtle">Under the heading “{r.heading}”</p>}
                    </details>
                    {warnBy(k).map(w => <p key={w.text} className="mt-1 text-[11px] text-amber-800 flex items-start gap-1"><AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />{w.text}</p>)}
                  </li>
                );
              })}
            </ul>
          )}
          {(split.notes || []).map(n => <p key={n} className="mt-1 text-[11px] text-amber-800">{n}</p>)}
          {split.missingHeadings?.length > 0 && rows.length > 0 && (
            <details className="mt-2 text-[11px] text-ink-muted">
              <summary className="cursor-pointer">Not in this file ({split.missingHeadings.length}) — left empty, nothing invented</summary>
              <ul className="mt-1 list-disc pl-5">
                {split.missingHeadings.map(m => <li key={`${m.form}:${m.key}`}>{m.label} — heading “{m.expected}”</li>)}
              </ul>
            </details>
          )}
          {rows.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 mt-3">
              <button type="button" onClick={save} disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gold-700 hover:bg-gold-800 disabled:opacity-50 px-3 py-1.5 text-xs font-semibold text-white">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save to the company
              </button>
              <label className="flex items-center gap-1.5 text-[11px] text-ink-muted">
                <input type="checkbox" checked={force} onChange={e => setForce(e.target.checked)} className="accent-gold-700" /> Also replace answers the CA typed
              </label>
            </div>
          )}
          {result && (
            <p role="status" className={clsx('mt-2 text-xs flex items-start gap-1', result.tone === 'ok' ? 'text-emerald-700' : result.tone === 'warn' ? 'text-amber-700' : 'text-rose-700')}>
              {result.tone === 'ok' && <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />}{result.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** files: [{id, name, kind:'pdf'|'report', file: File}] — the PDFs and .docx files of this scan. */
export default function ReportVerbatimPanel({ cin, files }) {
  if (!cin || !files?.length) return null;
  return (
    <section className="bg-surface border border-line rounded-xl shadow-sm p-5">
      <h3 className="text-sm font-semibold text-ink flex items-center gap-1.5"><FileText className="w-4 h-4 text-gold-700" /> Report text (verbatim)</h3>
      <p className="text-xs text-ink-muted mt-0.5 mb-3">
        The auditor's report and Board's report, split by their headings with the same words, for the Extract of Auditor's report and
        Extract of Board's report forms. Quotes, bullets and line breaks are simplified because MCA does not keep them. Nothing is cut:
        long texts are flagged. Check against the signed report before saving.
      </p>
      {files.map(f => <FileBlock key={`${cin}|${f.id}`} cin={cin} file={f} />)}
    </section>
  );
}
