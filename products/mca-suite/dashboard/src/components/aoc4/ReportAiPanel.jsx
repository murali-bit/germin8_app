// "Read from documents (AI)" for the AOC-2, Auditor's report and Board's report tabs. These answers differ for every
// company (emphasis of matter, Rule 11 matters, board meetings, related-party contracts…), so they are read from the
// company's own (a) attachment PDF — never a template. Every proposal shows the sentence it came from and its page;
// the CA ticks what to keep and saves it to the company master.
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Sparkles, Loader2, RefreshCw, Save, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { readReportFields, saveReportFields } from '../../lib/reportAiApi.js';
import { Badge } from './FieldRow.jsx';

const CIN_RE = /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;
const ACTION = {
  fill: { tone: 'ok', text: 'Fill (blank now)' },
  'replace-test': { tone: 'warn', text: 'Replace test value' },
  keep: { tone: 'neutral', text: 'Keep current' },
};

function parseMaybeJson(v) {
  if (typeof v !== 'string') return v;
  const s = v.trim();
  if (s[0] !== '[' && s[0] !== '{') return v;
  try { return JSON.parse(s); } catch { return v; }
}

// Readable text for any proposed / saved value (board meetings and contract lists are arrays).
export function showAiValue(v) {
  const x = parseMaybeJson(v);
  if (x == null || x === '') return '—';
  if (Array.isArray(x)) {
    if (!x.length) return 'None';
    return x.map((r, i) => {
      if (r && r.date) return `${r.date} · ${r.attended} of ${r.total} directors`;
      if (r && r.name) return `${i + 1}. ${r.name}${r.relationship ? ` (${r.relationship})` : ''} — ${r.nature || '?'} — ${r.terms || ''}${r.approvalDate ? ` · approved ${r.approvalDate}` : ''}`;
      return JSON.stringify(r);
    }).join('\n');
  }
  if (typeof x === 'object') return JSON.stringify(x);
  return String(x);
}

const keyOf = p => `${p.formType}:${p.key}`;
const tickable = p => p.action !== 'keep' && !p.saved;
const defaultPicks = proposals => Object.fromEntries(proposals.map(p => [keyOf(p), tickable(p)]));

// Readings live for the browser session, outside the component: switching tabs unmounts the panel, but a read that is
// running keeps running and its proposals (and ticks) are shown again when the CA comes back to the tab.
const sessions = new Map();     // `${cin}|${jobId}|${formTypes}` → {promise, startedAt, data?, picked?}

export default function ReportAiPanel({ cin: cinProp, jobId, formTypes, docLabel = 'the audit report', onSaved }) {
  const [cinInput, setCinInput] = useState('');
  const cin = String(cinProp || cinInput || '').trim().toUpperCase();
  const [state, setState] = useState({ phase: 'idle' });      // idle | reading | ready | error
  const [picked, setPicked] = useState({});
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);                  // {tone, text}
  const [elapsed, setElapsed] = useState(0);
  const sessionKey = `${cin}|${jobId || ''}|${(formTypes || []).join(',')}`;
  const keyRef = useRef(sessionKey);
  keyRef.current = sessionKey;

  // Shows a reading (running or done) for the current company/job/tab; ignores it once the CA moved elsewhere.
  const follow = (key, entry) => {
    setState({ phase: 'reading', startedAt: entry.startedAt });
    entry.promise.then(r => {
      entry.data = r;
      entry.picked = entry.picked || defaultPicks(r.proposals || []);
      if (keyRef.current !== key) return;
      setPicked(entry.picked);
      setState({ phase: 'ready', data: r });
    }, err => {
      if (sessions.get(key) === entry) sessions.delete(key);
      if (keyRef.current !== key) return;
      setState({ phase: 'error', code: err.code, message: err.code === 'NO_ATTACHMENT'
        ? 'Upload the (a) PDF on Page 2 first — financial statements, auditor\'s report and Board\'s report in one PDF. The AI reads it from there.'
        : err.message });
    });
  };

  // A new company, job or tab (or coming back to this tab): show what is already known for it.
  useEffect(() => {
    setResult(null);
    const e = sessions.get(sessionKey);
    if (e?.data) { setPicked(e.picked || defaultPicks(e.data.proposals || [])); setState({ phase: 'ready', data: e.data }); }
    else if (e?.promise) { setPicked({}); follow(sessionKey, e); }
    else { setPicked({}); setState({ phase: 'idle' }); }
  }, [sessionKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the remembered reading in step with ticks and saves.
  useEffect(() => {
    const e = sessions.get(sessionKey);
    if (e && e.data && state.phase === 'ready') { e.data = state.data; e.picked = picked; }
  }, [state, picked, sessionKey]);

  useEffect(() => {
    if (state.phase !== 'reading') return undefined;
    const tick = () => setElapsed(Math.round((Date.now() - (state.startedAt || Date.now())) / 1000));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [state.phase, state.startedAt]);

  // The request is not cancelled when the tab is left: the reading is shown again on return (see `sessions`).
  const read = (refresh = false) => {
    if (!CIN_RE.test(cin)) { setState({ phase: 'error', message: 'Enter a valid CIN on Page 1 first — the AI reads the documents uploaded for that company.' }); return; }
    setResult(null);
    const entry = { startedAt: Date.now(), promise: readReportFields({ cin, jobId, formTypes, refresh }) };
    sessions.set(sessionKey, entry);
    follow(sessionKey, entry);
  };

  const proposals = state.data?.proposals || [];
  const chosen = proposals.filter(p => picked[keyOf(p)]);

  const save = async () => {
    if (!chosen.length) return;
    const replacing = chosen.filter(p => p.action === 'keep' && !p.saved);
    if (replacing.length && !window.confirm(`These answers already entered will be replaced by the AI values:\n\n${replacing.map(p => `• ${p.label}`).join('\n')}\n\nReplace them?`)) return;
    setSaving(true); setResult(null);
    try {
      // A ticked "keep" row replaces a value the CA typed: that needs force, and the CA ticked it on purpose.
      const items = chosen.map(p => ({ formType: p.formType, key: p.key, value: p.value, quote: p.quote, page: p.page, force: p.action === 'keep' }));
      const r = await saveReportFields(cin, items);
      const skipped = r.skipped || [];
      setResult({ tone: skipped.length ? 'warn' : 'ok',
        text: `Saved ${r.saved} value${r.saved === 1 ? '' : 's'} to the company master${skipped.length ? `. Not saved: ${skipped.map(s => `${s.key} (${s.reason})`).join('; ')}` : ''}.`
          + (onSaved ? '' : ' Press Refresh at the top to see them in this tab.') });
      const savedKeys = new Set((r.savedItems || []).map(keyOf));
      setState(s => ({ ...s, data: { ...s.data, proposals: s.data.proposals.map(p => (savedKeys.has(keyOf(p))
        ? { ...p, current: typeof p.value === 'string' ? p.value : JSON.stringify(p.value), currentLabel: `AI from document (p.${p.page || '?'})`, action: 'keep', saved: true } : p)) } }));
      setPicked(prev => Object.fromEntries(Object.keys(prev).map(k => [k, savedKeys.has(k) ? false : prev[k]])));
      if (onSaved) await onSaved();
    } catch (err) {
      setResult({ tone: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const reading = state.phase === 'reading';
  // "Tick all" covers the blank and test-data rows only: a real answer is replaced only when its own box is ticked.
  const bulk = proposals.filter(tickable);
  const allTicked = bulk.length > 0 && bulk.every(p => picked[keyOf(p)]);

  return (
    <section className="bg-surface border border-line rounded-xl shadow-sm p-5">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-gold-700" /> Read from documents (AI)</h3>
          <p className="text-xs text-ink-muted mt-0.5">
            These answers are different for every company, so they are read from its own signed documents — the (a) PDF uploaded on Page 2.
            Each value shows the sentence it was taken from. Nothing is saved until you tick it and press Save.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!cinProp && (
            <input value={cinInput} onChange={e => setCinInput(e.target.value)} placeholder="Company CIN" aria-label="Company CIN"
              className="w-48 rounded-lg border border-line-input bg-white px-2.5 py-1.5 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-gold-500" />
          )}
          <button type="button" onClick={() => read(state.phase === 'ready')} disabled={reading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gold-700 hover:bg-gold-800 disabled:opacity-60 px-3 py-1.5 text-xs font-semibold text-white">
            {reading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : state.phase === 'ready' ? <RefreshCw className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
            {state.phase === 'ready' ? 'Read again' : 'Read from documents (AI)'}
          </button>
        </div>
      </div>

      {reading && (
        <p className="mt-3 text-xs text-ink-muted flex items-center gap-1.5" role="status">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-gold-700" /> Reading {docLabel}… ~30-60 s ({elapsed} s)
        </p>
      )}
      {state.phase === 'error' && (
        <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {state.message}
        </p>
      )}

      {state.phase === 'ready' && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-muted mb-2">
            {state.data.source?.fileName && <span>From <span className="text-ink">{state.data.source.fileName}</span></span>}
            {state.data.opinionType && <Badge tone={state.data.opinionType === 'unmodified' ? 'ok' : 'warn'}>Opinion: {state.data.opinionType}</Badge>}
            {state.data.cached && <Badge tone="neutral" title="The document was already read a moment ago; Read again asks the AI afresh">Already read</Badge>}
            {state.data.dropped?.length > 0 && (
              <span title={state.data.dropped.map(d => `${d.key}: ${d.reason}`).join('\n')}>
                {state.data.dropped.length} value{state.data.dropped.length === 1 ? '' : 's'} left out (no supporting sentence or wrong format)
              </span>
            )}
          </div>

          {proposals.length === 0 ? (
            <p className="text-xs text-ink-muted">The AI found nothing for this tab in the document. Fill these answers by hand below.</p>
          ) : (
            <div className="overflow-x-auto -mx-5 px-5">
              <table className="w-full text-xs border-separate border-spacing-0">
                <thead>
                  <tr className="text-left text-ink-muted">
                    <th className="pb-2 pr-2 w-8">
                      <input type="checkbox" aria-label="Tick all blank and test-data values" checked={allTicked} disabled={!bulk.length}
                        title="Ticks the blank and test-data rows; a row marked Keep current is ticked on its own"
                        onChange={e => { const on = e.target.checked; setPicked(prev => ({ ...prev, ...Object.fromEntries(bulk.map(p => [keyOf(p), on])) })); }} className="accent-gold-700" />
                    </th>
                    <th className="pb-2 pr-3 font-semibold min-w-[150px]">Field</th>
                    <th className="pb-2 pr-3 font-semibold min-w-[220px]">Proposed value</th>
                    <th className="pb-2 pr-3 font-semibold min-w-[200px]">From the document</th>
                    <th className="pb-2 pr-3 font-semibold min-w-[160px]">Current value</th>
                    <th className="pb-2 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {proposals.map(p => {
                    const k = keyOf(p);
                    const test = /^\s*TEST DATA/i.test(p.currentLabel || '');
                    return (
                      <tr key={k} className={clsx('align-top', picked[k] && 'bg-gold-50/40')}>
                        <td className="py-2 pr-2 border-t border-line">
                          <input type="checkbox" checked={!!picked[k]} aria-label={`Save ${p.label}`}
                            onChange={e => setPicked(prev => ({ ...prev, [k]: e.target.checked }))} className="accent-gold-700" />
                        </td>
                        <td className="py-2 pr-3 border-t border-line text-ink font-medium break-words">{p.label}</td>
                        <td className="py-2 pr-3 border-t border-line text-ink">
                          <div className="whitespace-pre-wrap break-words max-h-40 overflow-y-auto">{showAiValue(p.value)}</div>
                        </td>
                        <td className="py-2 pr-3 border-t border-line text-ink-muted">
                          <q className="italic break-words">{p.quote}</q>
                          <span className="ml-1 not-italic text-ink-subtle whitespace-nowrap">(p.{p.page || '?'})</span>
                        </td>
                        <td className="py-2 pr-3 border-t border-line">
                          <div className={clsx('whitespace-pre-wrap break-words max-h-32 overflow-y-auto', p.current == null || p.current === '' ? 'text-ink-subtle' : 'text-ink')}>
                            {p.current == null || p.current === '' ? 'blank' : showAiValue(p.current)}
                          </div>
                          {test && <Badge tone="warn">Test data</Badge>}
                        </td>
                        <td className="py-2 border-t border-line">
                          {p.saved ? <Badge tone="ok"><CheckCircle2 className="w-3 h-3" /> Saved</Badge>
                            : <Badge tone={ACTION[p.action]?.tone || 'neutral'} title={p.action === 'keep' ? 'The company already has this answer; tick it only to replace it' : undefined}>{ACTION[p.action]?.text || p.action}</Badge>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {proposals.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 mt-3">
              <button type="button" onClick={save} disabled={saving || !chosen.length}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gold-700 hover:bg-gold-800 disabled:opacity-50 px-3 py-1.5 text-xs font-semibold text-white">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save selected ({chosen.length})
              </button>
              <span className="text-[11px] text-ink-subtle">Check each value against the signed document before filing. Saved values are labelled “AI from document” in the company master.</span>
            </div>
          )}
        </div>
      )}

      {result && (
        <p role="status" className={clsx('mt-3 text-xs', result.tone === 'ok' ? 'text-emerald-700' : result.tone === 'warn' ? 'text-amber-700' : 'text-rose-700')}>{result.text}</p>
      )}
    </section>
  );
}
