import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, CheckCircle2, Eye, Plus, RotateCcw, Save, Search, Trash2, TriangleAlert, Undo2, X } from 'lucide-react';
import { api, useJob, isProcessed } from '../../api';
import { Card, Note, PageHeader, Table, btnDanger, btnPrimary, btnSecondary, friendlyError, inputClass } from '../../components/ui';
import OutOfDateBanner, { readableWhen } from '../../components/OutOfDateBanner';

const TEMPLATE_TO_OPEN = 'templateMappingFile'; // set by the Template Library when a file is opened from there
const iconBtn = 'w-10 h-10 shrink-0 rounded-md border border-line-strong bg-white hover:bg-soft text-ink inline-flex items-center justify-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white';
const chip = 'inline-flex items-center gap-1 rounded-full border border-line bg-soft px-2.5 py-0.5 text-[13px] text-ink';
const smallLabel = 'block text-[13px] font-medium text-muted mb-1';

let nextUid = 1;
const newUid = () => `row${nextUid++}`;
const norm = v => String(v ?? '').trim().toLowerCase();
const capital = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// The draft the screen edits: one entry per column, in order.
const toDraft = t => (t?.columns || []).map(c => ({ uid: newUid(), id: c.id ?? null, heading: c.heading ?? c.name ?? '', source: c.source ?? { type: 'blank' } }));
const cleanSource = s => (s?.type === 'builtin' ? { type: 'builtin', builtin: s.builtin }
  : s?.type === 'field' ? { type: 'field', path: String(s.path ?? '').trim() }
  : s?.type === 'fixed' ? { type: 'fixed', value: String(s.value ?? '') }
  : { type: 'blank' });
const toPayload = draft => draft.map(c => ({ ...(c.id ? { id: c.id } : {}), heading: c.heading.trim(), source: cleanSource(c.source) }));
const signature = columns => JSON.stringify(columns.map(c => [c.id ?? null, String(c.heading ?? '').trim(), cleanSource(c.source)]));

// Where a column's value comes from, in words.
const describeSource = (source, builtins) => {
  if (source?.type === 'builtin') return builtins.find(b => b.id === source.builtin)?.from || 'Built from the voucher lines';
  if (source?.type === 'field') return source.path ? `The Tally field "${source.path}"` : 'A field from your Tally file (not chosen yet)';
  if (source?.type === 'fixed') return `The text "${source.value ?? ''}" on every row`;
  return 'Left empty';
};

// Links each message from the server to the column it is about, where the message names one.
function assignProblems(problems, draft) {
  const byUid = {}; const general = [];
  for (const p of problems || []) {
    const number = /number (\d+)\b/.exec(p);
    const hits = draft.filter((c, i) => (number && Number(number[1]) === i + 1) || (c.heading.trim() && p.includes(`"${c.heading.trim()}"`)));
    if (hits.length) for (const c of hits) (byUid[c.uid] ||= []).push(p);
    else general.push(p);
  }
  return { byUid, general };
}
const NO_PROBLEMS = { byUid: {}, general: [] };

// A text box that also lists the fields found in the selected migration's data.
function FieldPicker({ value, onChange, fields, records, truncated, hint, label }) {
  const [open, setOpen] = useState(false);
  const q = norm(value);
  const chosen = fields?.find(f => norm(f.path) === q);
  const matches = useMemo(() => {
    if (!fields) return [];
    return q && !chosen ? fields.filter(f => norm(f.path).includes(q) || norm(f.example).includes(q)) : fields;
  }, [fields, q, chosen]);

  return (
    <div className="mt-2">
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-subtle" strokeWidth={1.75} aria-hidden="true" />
        <input
          value={value}
          onChange={e => { onChange(e.target.value); if (fields) setOpen(true); }}
          onFocus={() => { if (fields) setOpen(true); }}
          onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}
          placeholder={fields ? 'Search the fields in your Tally file, or type a field name' : 'Type the Tally field name'}
          aria-label={label}
          className={`${inputClass} pl-10`}
        />
      </div>
      {hint && <p className="mt-1.5 text-[13px] text-muted">{hint}</p>}
      {fields && chosen && !open && (
        <p className="mt-1.5 text-[13px] text-muted">
          Found in {chosen.records.toLocaleString('en-IN')} of {records.toLocaleString('en-IN')} records.
          {chosen.example ? <> Example: <span className="text-ink">{chosen.example}</span></> : ' No record has a value for it.'}
          {chosen.kind === 'list' && ' A list is written with its items separated by commas.'}
        </p>
      )}
      {fields && q && !chosen && !open && (
        <p className="mt-1.5 text-[13px] text-ink">This field was not found in the data of the selected migration, so the column would be empty for it.</p>
      )}
      {fields && !open && (
        <button type="button" onClick={() => setOpen(true)} className="mt-1.5 text-[13px] font-medium text-info-ink hover:underline">Show the fields found in your Tally file</button>
      )}
      {fields && open && (
        <div className="mt-2 rounded-lg border border-line-strong bg-white overflow-hidden">
          <div className="px-3 py-2 border-b border-line bg-soft flex items-center justify-between gap-2 text-[13px] text-muted">
            <span>{matches.length.toLocaleString('en-IN')} {matches.length === 1 ? 'field' : 'fields'}{q && !chosen ? ' match' : ' found'} in {records.toLocaleString('en-IN')} records</span>
            <button type="button" onClick={() => setOpen(false)} className="inline-flex items-center gap-1 font-medium text-info-ink hover:underline">
              <X className="w-3.5 h-3.5" strokeWidth={2} aria-hidden="true" /> Close list
            </button>
          </div>
          <ul className="max-h-64 overflow-y-auto divide-y divide-line">
            {matches.map(f => (
              <li key={f.path}>
                <button
                  type="button"
                  onClick={() => { onChange(f.path); setOpen(false); }}
                  aria-pressed={chosen?.path === f.path}
                  className={`w-full text-left px-3 py-2.5 hover:bg-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand ${chosen?.path === f.path ? 'bg-line' : ''}`}
                >
                  <span className="block text-[14px] font-medium text-ink break-all">{f.path}</span>
                  <span className="block text-[13px] text-muted">
                    In {f.records.toLocaleString('en-IN')} of {records.toLocaleString('en-IN')} records
                    {f.example ? <> · Example: <span className="text-ink">{f.example}</span></> : ' · No value in any record'}
                    {f.kind === 'list' ? ' · A list' : ''}
                  </span>
                </button>
              </li>
            ))}
            {matches.length === 0 && <li className="px-3 py-3 text-[13px] text-muted">No field matches what you typed. You can still use the name you typed.</li>}
          </ul>
          {truncated && <div className="px-3 py-2 border-t border-line text-[13px] text-muted">Only the most common fields are listed. You can type the name of any other field.</div>}
        </div>
      )}
    </div>
  );
}

// The choice of where a column's value comes from.
function SourceEditor({ source, onChange, builtins, ownId, identifying, fieldInfo, label }) {
  const value = source?.type === 'builtin' ? `builtin:${source.builtin}` : source?.type || 'blank';
  const choose = v => {
    if (v.startsWith('builtin:')) onChange({ type: 'builtin', builtin: v.slice(8) });
    else if (v === 'field') onChange({ type: 'field', path: '' });
    else if (v === 'fixed') onChange({ type: 'fixed', value: '' });
    else onChange({ type: 'blank' });
  };
  const own = builtins.find(b => b.id === ownId);
  const others = builtins.filter(b => b.id !== ownId);
  const words = b => b.from || `Standard value of "${b.heading}"`;
  return (
    <div>
      <select value={value} onChange={e => choose(e.target.value)} aria-label={label} className={inputClass}>
        {own && <option value={`builtin:${own.id}`}>{words(own)} (standard)</option>}
        <option value="field">A field from your Tally file</option>
        <option value="fixed" disabled={identifying}>The same text on every row</option>
        <option value="blank" disabled={identifying}>Leave empty</option>
        {others.length > 0 && (
          <optgroup label="The standard value of another column">
            {others.map(b => <option key={b.id} value={`builtin:${b.id}`} disabled={identifying}>{words(b)} (standard for "{b.heading}")</option>)}
          </optgroup>
        )}
      </select>
      {source?.type === 'field' && (
        <FieldPicker
          value={source.path ?? ''}
          onChange={path => onChange({ type: 'field', path })}
          fields={fieldInfo.fields} records={fieldInfo.records} truncated={fieldInfo.truncated} hint={fieldInfo.hint}
          label={`Tally field for ${label}`}
        />
      )}
      {source?.type === 'fixed' && (
        <input
          value={source.value ?? ''}
          onChange={e => onChange({ type: 'fixed', value: e.target.value })}
          placeholder="Text to write on every row"
          aria-label={`Text on every row for ${label}`}
          className={`${inputClass} mt-2`}
        />
      )}
    </div>
  );
}

// Long lists show their first 20 entries until the person asks for all of them.
const FIRST_COLUMNS = 20;
function ShowAll({ total, all, onToggle, what }) {
  if (total <= FIRST_COLUMNS) return null;
  return (
    <div className="px-4 py-3 border-t border-line text-[14px] text-muted flex flex-wrap items-center justify-between gap-2">
      <span>{all ? `All ${total} ${what} shown.` : `The first ${FIRST_COLUMNS} of ${total} ${what} are shown.`}</span>
      <button type="button" onClick={onToggle} className={btnSecondary}>{all ? `Show the first ${FIRST_COLUMNS}` : `Show all ${total}`}</button>
    </div>
  );
}

function ProblemList({ problems }) {
  if (!problems.length) return null;
  return (
    <ul role="alert" className="mt-2 space-y-1 text-[13px] text-ink">
      {problems.map((p, i) => (
        <li key={i} className="flex items-start gap-1.5">
          <TriangleAlert className="w-4 h-4 shrink-0 mt-px" strokeWidth={1.75} aria-hidden="true" /> <span>{p}</span>
        </li>
      ))}
    </ul>
  );
}

export default function Screen23_TemplateMapping({ onNavigate, user }) {
  const role = user?.role;
  const admin = ['super_admin', 'admin'].includes(role);
  const viewer = role === 'viewer';
  const { job, reload } = useJob();
  const processed = isProcessed(job);

  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(null);
  const [draft, setDraft] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [problems, setProblems] = useState(NO_PROBLEMS);
  const [notice, setNotice] = useState(null);
  const [preview, setPreview] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [sample, setSample] = useState('');
  const [verifyNote, setVerifyNote] = useState('');
  const [verifyError, setVerifyError] = useState('');
  const [addHeading, setAddHeading] = useState('');
  const [addSource, setAddSource] = useState({ type: 'blank' });
  const [fieldState, setFieldState] = useState({ status: 'none', data: null, message: '' });
  const [announce, setAnnounce] = useState('');
  // long layouts (up to 70 columns): the first 20 are shown until the person asks for all
  const [showAll, setShowAll] = useState(false);
  const [allPreview, setAllPreview] = useState(false);

  const t = templates.find(x => x.key === active) || null;
  const builtins = useMemo(() => t?.builtins || [], [t]);
  const supported = !!t && Array.isArray(t.builtins) && !!t.editable; // false when the service does not offer editing yet
  const can = t?.editable || {};
  const canEdit = admin && supported;
  const voucher = t?.kind === 'voucher';

  const showTemplate = useCallback(tpl => {
    setActive(tpl?.key ?? null);
    setDraft(toDraft(tpl));
    setProblems(NO_PROBLEMS); setPreview(null); setConfirmReset(false);
    setVerifyOpen(false); setSample(''); setVerifyNote(''); setVerifyError('');
    setAddHeading(''); setAddSource({ type: 'blank' });
  }, []);

  useEffect(() => {
    api.get('/templates').then(list => {
      setTemplates(list);
      let wanted = null;
      try { wanted = sessionStorage.getItem(TEMPLATE_TO_OPEN); } catch { /* ignore */ }
      showTemplate(list.find(x => x.key === wanted) || list[0]);
    }).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [showTemplate]);

  const dirty = !!t && canEdit && signature(draft) !== signature(t.columns);

  // Leaving the page (refresh or closing the tab) with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = e => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // The fields found in the selected migration's data, for the file being edited.
  const jobId = job?.id;
  const fileKey = t?.key;
  useEffect(() => {
    if (!jobId || !processed || !fileKey || !canEdit || voucher) { setFieldState({ status: 'none', data: null, message: '' }); return undefined; }
    let cancelled = false;
    setFieldState({ status: 'loading', data: null, message: '' });
    api.get(`/migrations/${jobId}/templates/${fileKey}/fields`)
      .then(data => { if (!cancelled) setFieldState({ status: 'ready', data, message: '' }); })
      .catch(e => { if (!cancelled) setFieldState({ status: 'error', data: null, message: e.message }); });
    return () => { cancelled = true; };
  }, [jobId, processed, fileKey, canEdit, voucher]);

  const fieldInfo = useMemo(() => {
    const d = fieldState.data;
    if (fieldState.status === 'ready' && d?.available && d.fields?.length) {
      return { fields: d.fields, records: d.records || 0, truncated: !!d.truncated, hint: `These are the fields found in the ${d.datasetName || 'Tally'} file of ${job?.company || 'the selected migration'}.` };
    }
    const hint = !jobId ? 'No migration is selected, so the fields in your Tally file cannot be listed. Type the field name exactly as it appears in the Tally file. To pick from a list, select a migration on the Dashboard.'
      : !processed ? 'The data of the selected migration has not been read yet, so its fields cannot be listed. Type the field name exactly as it appears in the Tally file.'
      : fieldState.status === 'loading' ? 'Looking for the fields in your Tally file…'
      : fieldState.status === 'error' ? `The fields in your Tally file could not be listed. ${friendlyError(fieldState.message)} You can type the field name instead.`
      : `${d?.note || 'No fields were found in the data of the selected migration.'} You can type the field name instead.`;
    return { fields: null, records: 0, truncated: false, hint };
  }, [fieldState, jobId, processed, job]);

  // How each column of the draft differs from the standard layout.
  const diff = useMemo(() => {
    const defById = Object.fromEntries(builtins.map(b => [b.id, b]));
    const order = draft.filter(c => c.id && defById[c.id]).map(c => c.id);
    const defOrder = builtins.filter(b => order.includes(b.id)).map(b => b.id);
    return Object.fromEntries(draft.map(c => {
      const d = c.id ? defById[c.id] : null;
      return [c.uid, {
        added: !d,
        heading: !!d && d.heading !== c.heading.trim(),
        source: !!d && !(c.source?.type === 'builtin' && c.source.builtin === c.id),
        position: !!d && order.indexOf(c.id) !== defOrder.indexOf(c.id),
        defaultHeading: d?.heading ?? null,
      }];
    }));
  }, [draft, builtins]);

  // Problems that can be seen before anything is sent.
  const local = useMemo(() => {
    const counts = {};
    for (const c of draft) if (norm(c.heading)) counts[norm(c.heading)] = (counts[norm(c.heading)] || 0) + 1;
    return Object.fromEntries(draft.map(c => {
      const list = [];
      if (!c.heading.trim()) list.push('Every column needs a heading.');
      else if (counts[norm(c.heading)] > 1) list.push('Another column has the same heading. Each heading in a file must be different.');
      if (c.source?.type === 'field' && !String(c.source.path ?? '').trim()) list.push('Choose the Tally field this column should read.');
      return [c.uid, list];
    }));
  }, [draft]);
  const hasLocalProblems = Object.values(local).some(l => l.length);
  const removed = builtins.filter(b => !draft.some(c => c.id === b.id));

  // ----- editing the draft -----
  const touch = uid => setProblems(p => (p.byUid[uid] ? { ...p, byUid: { ...p.byUid, [uid]: undefined } } : p));
  const change = (uid, patch) => { setDraft(d => d.map(c => (c.uid === uid ? { ...c, ...patch } : c))); touch(uid); setNotice(null); };
  const move = (i, by) => {
    const j = i + by;
    if (j < 0 || j >= draft.length) return;
    const next = [...draft];
    [next[i], next[j]] = [next[j], next[i]];
    setDraft(next); setNotice(null);
    if (j >= FIRST_COLUMNS) setShowAll(true); // the moved column stays in sight
    setAnnounce(`${draft[i].heading || 'Column'} moved to position ${j + 1} of ${draft.length}.`);
  };
  const remove = uid => { setDraft(d => d.filter(c => c.uid !== uid)); setNotice(null); };
  const putBack = b => {
    const at = builtins.findIndex(x => x.id === b.id);
    setDraft(d => {
      // after the nearest standard column that comes before it and is still in the file
      let index = 0;
      for (let k = at - 1; k >= 0; k--) {
        const found = d.findIndex(c => c.id === builtins[k].id);
        if (found >= 0) { index = found + 1; break; }
      }
      const next = [...d];
      next.splice(index, 0, { uid: newUid(), id: b.id, heading: b.heading, source: { type: 'builtin', builtin: b.id } });
      return next;
    });
    setShowAll(true);
    setNotice(null);
    setAnnounce(`${b.heading} put back.`);
  };
  const addColumn = () => {
    if (!addHeading.trim()) return;
    setDraft(d => [...d, { uid: newUid(), id: null, heading: addHeading.trim(), source: addSource }]);
    setShowAll(true); // the new last column is shown
    setAnnounce(`${addHeading.trim()} added as the last column.`);
    setAddHeading(''); setAddSource({ type: 'blank' }); setNotice(null);
  };

  const pickFile = tpl => {
    if (tpl.key === active) return;
    if (dirty && !window.confirm(`You have unsaved changes to the ${t.module} file. Leave without saving them?`)) return;
    setNotice(null); setError('');
    try { sessionStorage.setItem(TEMPLATE_TO_OPEN, tpl.key); } catch { /* ignore */ } // coming back to this page opens the same file
    showTemplate(tpl);
  };

  // ----- saving -----
  const applySaved = tpl => {
    setTemplates(list => list.map(x => (x.key === tpl.key ? tpl : x)));
    setDraft(toDraft(tpl));
    setProblems(NO_PROBLEMS); setPreview(null); setConfirmReset(false); setVerifyOpen(false);
  };
  const store = async (kind, send) => {
    setBusy(kind); setError(''); setProblems(NO_PROBLEMS); setNotice(null);
    const wasVerified = !!t.verified;
    try {
      const { changed, changes, ...tpl } = await send();
      applySaved(tpl);
      setNotice({ kind, module: tpl.module, changed: !!changed, changes: changes || [], wasVerified: wasVerified && !tpl.verified });
      reload(); // the selected migration's files may be out of date now
    } catch (e) {
      if (e.data?.problems?.length) setProblems(assignProblems(e.data.problems, draft));
      else setError(e.message);
    } finally {
      setBusy('');
    }
  };
  const save = () => store('saved', () => api.put(`/templates/${t.key}/columns`, { columns: toPayload(draft) }));
  const reset = () => store('reset', () => api.del(`/templates/${t.key}/columns`));
  const discard = () => { setDraft(toDraft(t)); setProblems(NO_PROBLEMS); setPreview(null); setNotice(null); setError(''); };

  const setVerified = async body => {
    setBusy('verify'); setVerifyError('');
    try {
      const tpl = await api.put(`/templates/${t.key}/verified`, body);
      setTemplates(list => list.map(x => (x.key === tpl.key ? tpl : x)));
      setVerifyOpen(false); setSample(''); setVerifyNote('');
    } catch (e) {
      setVerifyError(e.message);
    } finally {
      setBusy('');
    }
  };

  const runPreview = async () => {
    setBusy('preview'); setError('');
    try {
      const r = await api.post(`/migrations/${job.id}/templates/${t.key}/preview`, { columns: toPayload(draft) });
      setPreview({ data: r, error: '' });
      if (canEdit) setProblems(assignProblems(r.problems, draft));
    } catch (e) {
      setPreview({ data: null, error: e.message });
    } finally {
      setBusy('');
    }
  };
  const previewBlocked = !job ? 'Select a migration on the Dashboard to preview the file with its data.'
    : !processed ? 'The data of the selected migration has not been read yet, so there is nothing to preview.' : '';

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
      <PageHeader
        title="Template Mapping"
        breadcrumb={[{ label: 'Template Library', onClick: () => onNavigate('screen-22') }, { label: 'Template Mapping' }]}
        help={`The columns of each file created for Zoho Books, and where each column's value comes from.${admin ? ' Change them so that each file matches the official Zoho sample file.' : ''}`}
        actions={<button type="button" onClick={() => onNavigate('screen-22')} className={btnSecondary}>Template Library</button>}
      />

      {error && <div role="alert"><Note tone="danger">{friendlyError(error)}</Note></div>}
      {loading && <p role="status" className="text-[14px] text-muted">Loading the files…</p>}

      {templates.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Choose a file">
          {templates.map(x => (
            <button key={x.key} type="button" onClick={() => pickFile(x)} aria-pressed={active === x.key}
              className={`min-h-9 px-3.5 py-1.5 rounded-md text-[13px] font-medium border inline-flex items-center gap-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${active === x.key ? 'bg-action text-white border-action' : 'bg-white text-ink border-line-strong hover:bg-soft'}`}>
              {x.verified && <CheckCircle2 className="w-4 h-4" strokeWidth={1.75} aria-label="Marked as matching the official Zoho sample" />}
              {x.module}
            </button>
          ))}
        </div>
      )}

      {t && (
        <>
          {/* Status */}
          <Card title={`${t.module}: ${t.fileName}`} subtitle={`Filled from: ${t.source}`}>
            <div className="px-4 py-4 space-y-3 text-[14px] text-ink">
              <div className="flex items-start gap-2">
                {t.verified
                  ? <CheckCircle2 className="w-5 h-5 shrink-0 text-success" strokeWidth={1.75} aria-hidden="true" />
                  : <TriangleAlert className="w-5 h-5 shrink-0 text-warning" strokeWidth={1.75} aria-hidden="true" />}
                <div className="min-w-0">
                  {t.verifiedInCode ? (
                    <>
                      <strong>Headings match Zoho's sample file "{t.officialSampleFile}" (checked). Not yet confirmed by a real import into Zoho Books.</strong>{' '}
                      <span className="text-muted">The standard layout has every heading of the official Zoho Books (India) sample import file, in the same order, including the optional columns that stay empty. The platform checks this; whether Zoho Books accepts every value is known only after a real import. Any change to the columns makes the layout differ from the sample.</span>
                    </>
                  ) : t.verified && t.verification ? (
                    <>
                      <strong>Marked as matching Zoho's sample file "{t.verification.sampleFileName}". Not yet confirmed by a real import into Zoho Books.</strong>{' '}
                      <span className="text-muted">
                        By {t.verification.by}{readableWhen(t.verification.at) ? ` on ${readableWhen(t.verification.at)}` : ''}.
                        {t.verification.note ? ` Note: ${t.verification.note}` : ''} This is that person's own confirmation. The platform has not checked it.
                      </span>
                    </>
                  ) : (
                    <>
                      <strong>Not confirmed against the official Zoho sample.</strong>{' '}
                      <span className="text-muted">{t.officialSampleFile
                        ? `This layout was changed from the standard one, which matches the official Zoho sample "${t.officialSampleFile}". Reset it to the standard layout, or compare it with the sample and mark it as matching.`
                        : 'An admin can compare the column headings with the official sample file and mark the file as matching.'}</span>
                    </>
                  )}
                </div>
              </div>
              <div className="text-muted">
                <strong className="text-ink">{t.customised ? 'Changed from the standard layout.' : 'Standard layout.'}</strong>{' '}
                {t.customised
                  ? `Last changed${t.updatedBy ? ` by ${t.updatedBy}` : ''}${readableWhen(t.updatedAt) ? ` on ${readableWhen(t.updatedAt)}` : ''}.`
                  : 'Nothing has been changed for your firm.'}
                {' '}Identifying column: <span className="text-ink font-medium">{t.idColumn}</span>.
              </div>

              {canEdit && (
                <div className="pt-1">
                  {t.verifiedInCode ? null : t.verified ? (
                    <button type="button" onClick={() => setVerified({ verified: false })} disabled={busy === 'verify'} className={btnSecondary}>
                      {busy === 'verify' ? 'Removing…' : 'Remove the mark'}
                    </button>
                  ) : !verifyOpen ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <button type="button" onClick={() => { setVerifyOpen(true); setVerifyError(''); }} disabled={dirty} className={btnSecondary}>
                        <CheckCircle2 className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /> Mark as matching the official Zoho sample
                      </button>
                      {dirty && <span className="text-[13px] text-muted">Save or discard your changes first. The mark applies to the saved layout.</span>}
                    </div>
                  ) : (
                    <form onSubmit={e => { e.preventDefault(); setVerified({ verified: true, sampleFileName: sample.trim(), note: verifyNote.trim() }); }}
                      className="p-4 rounded-lg border border-line bg-soft space-y-3 max-w-2xl">
                      <div className="font-semibold">Mark as matching the official Zoho sample</div>
                      <p className="text-muted">
                        This is your own confirmation that you compared this layout, column by column, with the sample file from the Import page of {t.module} in Zoho Books.
                        It is recorded with your name and the time. The platform does not check it. Any later change to the columns removes the mark.
                      </p>
                      <label className="block">
                        <span className={smallLabel}>Name of the sample file you compared with (required)</span>
                        <input value={sample} onChange={e => setSample(e.target.value)} maxLength={200} placeholder="For example: Contacts_sample.csv" className={inputClass} />
                      </label>
                      <label className="block">
                        <span className={smallLabel}>Note (optional)</span>
                        <input value={verifyNote} onChange={e => setVerifyNote(e.target.value)} maxLength={1000} placeholder="For example: compared on 12 November, all headings identical" className={inputClass} />
                      </label>
                      {verifyError && <div role="alert" className="text-[13px] text-ink">{friendlyError(verifyError)}</div>}
                      <div className="flex flex-wrap gap-2">
                        <button type="submit" disabled={!sample.trim() || busy === 'verify' || dirty} className={btnPrimary}>{busy === 'verify' ? 'Saving…' : 'Confirm and mark'}</button>
                        <button type="button" onClick={() => setVerifyOpen(false)} className={btnSecondary}>Cancel</button>
                      </div>
                    </form>
                  )}
                  {verifyError && !verifyOpen && <div role="alert" className="mt-2 text-[13px] text-ink">{friendlyError(verifyError)}</div>}
                </div>
              )}
            </div>
          </Card>

          {!admin && (
            <Note>
              <strong>You can view this layout but not change it.</strong> Only an admin of your firm can change the columns, reset them, or mark a file as matching the official Zoho sample.
              {!viewer && ' You can preview the file with the selected migration below.'}
            </Note>
          )}
          {admin && !supported && <Note>Changing the columns is not available right now. The columns are shown as they are.</Note>}
          {canEdit && t.editNote && <Note>{t.editNote}</Note>}

          {notice && (
            <div role="status" className="p-4 rounded-lg border border-success-line bg-success-soft text-[14px] text-ink space-y-2">
              {notice.changed ? (
                <>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="w-5 h-5 shrink-0 text-success-ink" strokeWidth={1.75} aria-hidden="true" />
                    <strong>{notice.kind === 'reset' ? `The ${notice.module} file is back to the standard layout.` : `Saved. The ${notice.module} file now uses this layout.`}</strong>
                  </div>
                  {notice.changes.length > 0 && (
                    <ul className="pl-7 space-y-0.5 text-muted list-disc list-outside ml-4">
                      {notice.changes.map((c, i) => <li key={i}>{capital(c)}</li>)}
                    </ul>
                  )}
                  <p className="pl-7">
                    <strong>Files already created are now out of date.</strong> Any {notice.module} file created for a migration with the earlier layout must be created again
                    before it can be downloaded or imported. Open each migration and create its files again.
                  </p>
                  {notice.wasVerified && <p className="pl-7">The mark "matching the official Zoho sample" was removed because the layout changed. Compare with the sample again, then mark the file again.</p>}
                  <div className="pl-7">
                    <button type="button" onClick={() => onNavigate('screen-25')} className={btnSecondary}>Open Export Center <ArrowRight className="w-4 h-4" aria-hidden="true" /></button>
                  </div>
                </>
              ) : (
                <div>{notice.kind === 'reset' ? 'The file already uses the standard layout, so nothing was changed.' : 'Nothing was different from the saved layout, so nothing was changed.'}</div>
              )}
            </div>
          )}

          <OutOfDateBanner job={job} user={user} onDone={reload} onNavigate={onNavigate} />

          {/* Columns */}
          {!canEdit ? (
            <Card title="Columns" subtitle={`${t.columns.length} columns, in the order they are written in the file.`}>
              <Table
                rows={showAll ? t.columns : t.columns.slice(0, FIRST_COLUMNS)}
                rowKey={c => c.id ?? c.heading ?? c.name}
                columns={[
                  { key: 'position', label: 'No.', render: c => c.position ?? t.columns.indexOf(c) + 1 },
                  { key: 'heading', label: 'Heading in the file', render: c => (
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{c.heading ?? c.name}</span>
                      {(c.identifying ?? (c.heading ?? c.name) === t.idColumn) && <span className={chip}>Identifies each record</span>}
                    </span>
                  ) },
                  { key: 'from', label: 'Filled from', render: c => c.from || (c.source ? describeSource(c.source, builtins) : 'Built from the voucher lines') },
                  { key: 'differs', label: 'Compared with standard', render: c => {
                    const ch = c.changed || {};
                    const parts = [ch.added && 'Added', ch.heading && `Renamed (standard: "${c.defaultHeading}")`, ch.source && 'Filled differently', ch.position && 'Moved'].filter(Boolean);
                    return parts.length ? parts.join(', ') : <span className="text-subtle">Standard</span>;
                  } },
                ]}
              />
              <ShowAll total={t.columns.length} all={showAll} onToggle={() => setShowAll(v => !v)} what="columns" />
              {t.removedColumns?.length > 0 && (
                <div className="px-4 py-3 border-t border-line text-[14px] text-muted">
                  Standard columns that were removed from this file: <span className="text-ink">{t.removedColumns.map(c => c.heading).join(', ')}</span>.
                </div>
              )}
            </Card>
          ) : (
            <Card title="Columns" subtitle="In the order they are written in the file. Nothing is saved until you press Save changes.">
              <p aria-live="polite" className="sr-only">{announce}</p>
              {problems.general.length > 0 && <div className="px-4 pt-3"><ProblemList problems={problems.general} /></div>}
              <ol className="divide-y divide-line">
                {draft.map((c, i) => {
                  if (!showAll && i >= FIRST_COLUMNS && !(local[c.uid]?.length || problems.byUid[c.uid]?.length)) return null;
                  const d = diff[c.uid] || {};
                  const identifying = c.id === t.idColumnId;
                  const rowProblems = [...(local[c.uid] || []), ...(problems.byUid[c.uid] || [])];
                  const name = c.heading.trim() || `column ${i + 1}`;
                  return (
                    <li key={c.uid} className="px-4 py-4">
                      <div className="flex flex-col lg:flex-row lg:items-start gap-3">
                        <div className="flex items-center gap-1.5 shrink-0 lg:pt-6">
                          <span className="w-7 text-[14px] font-semibold tabular-nums text-muted">{i + 1}</span>
                          <button type="button" onClick={() => move(i, -1)} disabled={!can.reorder || i === 0} aria-label={`Move ${name} up`} title="Move up" className={iconBtn}>
                            <ArrowUp className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />
                          </button>
                          <button type="button" onClick={() => move(i, 1)} disabled={!can.reorder || i === draft.length - 1} aria-label={`Move ${name} down`} title="Move down" className={iconBtn}>
                            <ArrowDown className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />
                          </button>
                        </div>
                        <label className="block lg:w-64 shrink-0">
                          <span className={smallLabel}>Heading</span>
                          <input value={c.heading} onChange={e => change(c.uid, { heading: e.target.value })} disabled={!can.rename} maxLength={200}
                            aria-invalid={rowProblems.length > 0} className={`${inputClass} ${rowProblems.length ? 'border-danger' : ''}`} />
                        </label>
                        <div className="min-w-0 flex-1">
                          <span className={smallLabel}>Filled from</span>
                          {can.changeSource
                            ? <SourceEditor source={c.source} onChange={source => change(c.uid, { source })} builtins={builtins} ownId={c.id} identifying={identifying} fieldInfo={fieldInfo} label={`where ${name} is filled from`} />
                            : <p className="min-h-11 flex items-center text-[14px] text-ink">{describeSource(c.source, builtins)}</p>}
                        </div>
                        {can.remove && (
                          <div className="shrink-0 lg:pt-6">
                            <button type="button" onClick={() => remove(c.uid)} disabled={identifying} aria-label={identifying ? `${name} identifies each record and cannot be removed` : `Remove ${name}`}
                              title={identifying ? 'This column identifies each record and cannot be removed' : 'Remove this column'} className={iconBtn}>
                              <Trash2 className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />
                            </button>
                          </div>
                        )}
                      </div>
                      {(identifying || d.added || d.heading || d.source || d.position) && (
                        <div className="mt-2.5 flex flex-wrap items-center gap-2">
                          {identifying && <span className={chip}>Identifies each record</span>}
                          {d.added && <span className={chip}>Added column</span>}
                          {d.heading && <span className={chip}>Renamed. Standard heading: "{d.defaultHeading}"</span>}
                          {d.source && <span className={chip}>Filled differently from standard</span>}
                          {d.position && <span className={chip}>Moved from its standard position</span>}
                        </div>
                      )}
                      {identifying && (
                        <p className="mt-1.5 text-[13px] text-muted">
                          This column tells which record each row belongs to. It can be renamed{can.changeSource ? ' or read from a Tally field' : ''}, but it cannot be removed, left empty or set to the same text on every row.
                          Error files and reports from Zoho Books must use this heading.
                        </p>
                      )}
                      <ProblemList problems={rowProblems} />
                    </li>
                  );
                })}
              </ol>
              <ShowAll total={draft.length} all={showAll} onToggle={() => setShowAll(v => !v)} what="columns" />

              {can.remove && removed.length > 0 && (
                <div className="px-4 py-4 border-t border-line">
                  <div className="text-[14px] font-semibold text-ink">Standard columns that are not in the file</div>
                  <p className="text-[13px] text-muted mt-0.5">Put a column back with its standard heading and value.</p>
                  <ul className="mt-2.5 flex flex-wrap gap-2">
                    {removed.map(b => (
                      <li key={b.id}>
                        <button type="button" onClick={() => putBack(b)} className={btnSecondary} title={b.from || undefined}>
                          <Undo2 className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /> Put back "{b.heading}"
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {can.add && (
                <div className="px-4 py-4 border-t border-line">
                  <div className="text-[14px] font-semibold text-ink">Add a column</div>
                  <p className="text-[13px] text-muted mt-0.5">The new column is added at the end. Use the arrows to move it.</p>
                  <div className="mt-2.5 flex flex-col lg:flex-row lg:items-start gap-3">
                    <label className="block lg:w-64 shrink-0">
                      <span className={smallLabel}>Heading</span>
                      <input value={addHeading} onChange={e => setAddHeading(e.target.value)} maxLength={200} placeholder="Heading as in the Zoho sample"
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addColumn(); } }} className={inputClass} />
                    </label>
                    <div className="min-w-0 flex-1">
                      <span className={smallLabel}>Filled from</span>
                      <SourceEditor source={addSource} onChange={setAddSource} builtins={builtins} ownId={null} identifying={false} fieldInfo={fieldInfo} label="where the new column is filled from" />
                    </div>
                    <div className="shrink-0 lg:pt-6">
                      <button type="button" onClick={addColumn} disabled={!addHeading.trim()} className={btnSecondary}>
                        <Plus className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /> Add column
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="px-4 py-4 border-t border-line bg-soft space-y-3">
                <div className="text-[14px] text-ink" role="status">
                  {dirty
                    ? <><strong>You have unsaved changes.</strong> <span className="text-muted">Preview them, then save or discard them.</span></>
                    : <span className="text-muted">No unsaved changes.</span>}
                  {dirty && hasLocalProblems && <span className="block mt-0.5">Fix the columns marked above before saving.</span>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={runPreview} disabled={!!previewBlocked || busy === 'preview'} className={btnSecondary}>
                    <Eye className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /> {busy === 'preview' ? 'Preparing the preview…' : 'Preview the first five rows'}
                  </button>
                  <button type="button" onClick={save} disabled={!dirty || hasLocalProblems || !!busy} className={btnPrimary}>
                    <Save className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /> {busy === 'saved' ? 'Saving…' : 'Save changes'}
                  </button>
                  <button type="button" onClick={discard} disabled={!dirty || !!busy} className={btnSecondary}>Discard changes</button>
                  <button type="button" onClick={() => setConfirmReset(true)} disabled={!t.customised || !!busy} className={`${btnSecondary} sm:ml-auto`}>
                    <RotateCcw className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /> Reset to standard
                  </button>
                </div>
                {previewBlocked && <p className="text-[13px] text-muted">{previewBlocked}</p>}
                {!t.customised && <p className="text-[13px] text-muted">This file already uses the standard layout, so there is nothing to reset.</p>}
                {confirmReset && (
                  <div role="alertdialog" aria-label="Reset to standard" className="p-4 rounded-lg border border-warning-line bg-warning-soft text-[14px] text-ink space-y-3">
                    <div>
                      <strong>Reset the {t.module} file to the standard layout?</strong> Every renamed heading, added column, removed column and changed order is undone{dirty ? ', and your unsaved changes are lost' : ''}.
                      {t.verified ? ' The mark "matching the official Zoho sample" is removed.' : ''} Files already created with the current layout become out of date.
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={reset} disabled={!!busy} className={btnDanger}>{busy === 'reset' ? 'Resetting…' : 'Yes, reset to standard'}</button>
                      <button type="button" onClick={() => setConfirmReset(false)} className={btnSecondary}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* Preview for people who cannot edit */}
          {!canEdit && !viewer && (
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={runPreview} disabled={!!previewBlocked || busy === 'preview'} className={btnSecondary}>
                <Eye className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /> {busy === 'preview' ? 'Preparing the preview…' : 'Preview the first five rows'}
              </button>
              {previewBlocked && <span className="text-[13px] text-muted">{previewBlocked}</span>}
            </div>
          )}

          {preview && (
            <Card
              title="Preview"
              subtitle={preview.data
                ? `The first ${preview.data.rows.length} of ${Number(preview.data.totalRows || 0).toLocaleString('en-IN')} rows for ${job?.company || 'the selected migration'}. Nothing has been saved.`
                : 'The preview could not be prepared.'}
              right={<button type="button" onClick={() => setPreview(null)} className={btnSecondary}>Close preview</button>}
            >
              {preview.error && <div role="alert" className="px-4 py-4 text-[14px] text-ink">{friendlyError(preview.error)}</div>}
              {preview.data && (
                <>
                  <div className="px-4 py-3 text-[14px] text-muted space-y-2">
                    {preview.data.differsFromSaved
                      ? <div><strong className="text-ink">This preview includes changes that are not saved yet.</strong> If the columns are changed again, run the preview again.</div>
                      : <div>This is the saved layout.</div>}
                    {preview.data.problems?.length > 0 && (
                      <div className="text-ink">
                        <strong>{preview.data.problems.length === 1 ? 'One problem has' : `${preview.data.problems.length} problems have`} to be fixed before this layout can be saved.</strong>
                        <ProblemList problems={preview.data.problems} />
                      </div>
                    )}
                    {preview.data.valid && preview.data.rows.length === 0 && <div>There are no rows for this file in the selected migration.</div>}
                  </div>
                  {preview.data.headings?.length > 0 && preview.data.rows.length > 0 && (
                    <div className="overflow-x-auto border-t border-line">
                      <table className="w-full text-left text-[14px]">
                        <thead className="bg-soft border-b border-line text-[13px] text-muted">
                          <tr>{preview.data.headings.map((h, i) => <th key={i} scope="col" className="py-2.5 px-4 font-semibold whitespace-nowrap">{h}</th>)}</tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {(allPreview ? preview.data.rows : preview.data.rows.slice(0, FIRST_COLUMNS)).map((r, i) => (
                            <tr key={i}>
                              {r.map((v, k) => <td key={k} className="py-2.5 px-4 text-ink whitespace-nowrap max-w-xs truncate" title={v}>{v === '' ? <span className="text-subtle">(empty)</span> : v}</td>)}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <ShowAll total={preview.data.rows.length} all={allPreview} onToggle={() => setAllPreview(v => !v)} what="preview rows" />
                    </div>
                  )}
                </>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
