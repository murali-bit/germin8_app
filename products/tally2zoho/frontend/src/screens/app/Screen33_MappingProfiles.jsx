import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Download, TriangleAlert, Trash2, Pencil, Eye } from 'lucide-react';
import { api, useJob, isProcessed, downloadFile } from '../../api';
import JobHeader from '../../components/JobHeader';
import { Card, EmptyState, FileButton, Note, StatusChip, btnDanger, btnPrimary, btnSecondary, btnSmall, inputClass } from '../../components/ui';

const STATUS = {
  apply: 'Will be applied',
  same: 'Already the same',
  conflict: 'Decided differently here',
  no_match: 'Matches nothing here',
  info: 'Reference only',
};
const FILTERS = [['all', 'All'], ['apply', 'Will be applied'], ['conflict', 'Decided differently'], ['no_match', 'Matches nothing'], ['same', 'Already the same'], ['info', 'Reference only']];
const STATUS_TONE = { apply: 'info', same: 'success', conflict: 'warning', no_match: 'neutral', info: 'neutral' };
const when = at => (at ? new Date(at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

function countsWords(counts, sections) {
  const parts = Object.entries(counts || {}).filter(([, n]) => n).map(([k, n]) => `${sections.find(s => s.key === k)?.title || k}: ${n}`);
  return parts.length ? parts.join(' · ') : 'No decisions';
}

function SaveCard({ job, profiles, onSaved }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [client, setClient] = useState(false);
  const [replaceId, setReplaceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(null);
  const save = async () => {
    setBusy(true); setError(''); setSaved(null);
    try {
      const r = await api.post(`/migrations/${job.id}/profiles`, { name, description, includeClientSpecific: client, ...(replaceId ? { replaceProfileId: Number(replaceId) } : {}) });
      setSaved(r); setName(''); setDescription(''); setReplaceId('');
      await onSaved();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <Card title="Save the decisions of this migration" subtitle={`${job.company}, ${job.financial_year}. The profile is kept for your firm and can be applied to any other migration.`}>
      <div className="p-4 space-y-3 text-[14px]">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-[13px] font-medium text-ink">Profile name</span>
            <input value={name} onChange={e => setName(e.target.value)} placeholder={replaceId ? 'Keep the name of the profile replaced' : 'For example: Trading companies'} className={inputClass} maxLength={100} />
          </label>
          <label className="space-y-1">
            <span className="text-[13px] font-medium text-ink">Replace an existing profile (optional)</span>
            <select value={replaceId} onChange={e => setReplaceId(e.target.value)} className={inputClass}>
              <option value="">No, save a new profile</option>
              {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        </div>
        <label className="space-y-1 block">
          <span className="text-[13px] font-medium text-ink">Description (optional)</span>
          <input value={description} onChange={e => setDescription(e.target.value)} className={inputClass} maxLength={500} />
        </label>
        <label className="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" checked={client} onChange={e => setClient(e.target.checked)} className="mt-1 w-4 h-4 accent-action" />
          <span>
            <span className="font-medium text-ink">Include client-specific corrections</span>
            <span className="block text-muted">Names cleaned, decisions on possible duplicates, and contact corrections (GSTIN, state, GST treatment). Leave this off for a profile meant for other clients: these belong to this client's ledgers.</span>
          </span>
        </label>
        {error && <Note tone="danger"><div role="alert"><strong>Not saved.</strong> {error}</div></Note>}
        {saved && (
          <div role="status" className="p-3 rounded-lg border border-success-line bg-success-soft">
            <div className="flex items-center gap-2 font-medium text-success-ink"><CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Saved as "{saved.name}".</div>
            {saved.skipped?.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-muted">{saved.skipped.map(s => <li key={s}>{s}</li>)}</ul>
            )}
          </div>
        )}
        <button type="button" onClick={save} disabled={busy || (!name.trim() && !replaceId)} className={btnPrimary}>{busy ? 'Saving…' : replaceId ? 'Replace the profile' : 'Save profile'}</button>
      </div>
    </Card>
  );
}

function Preview({ job, profile, sections, readOnly, onApplied }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [replace, setReplace] = useState(() => new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const load = useCallback(async () => {
    setError('');
    try { setData(await api.get(`/migrations/${job.id}/profiles/${profile.id}/preview`)); } catch (e) { setError(e.message); }
  }, [job.id, profile.id]);
  useEffect(() => { setReplace(new Set()); setResult(null); setConfirming(false); load(); }, [load]);

  if (error) return <div role="alert" className="p-4"><Note tone="danger">{error}</Note></div>;
  if (!data) return <div role="status" className="p-4 text-[14px] text-muted">Comparing the profile with this migration…</div>;
  const toApply = data.entries.filter(e => e.status === 'apply' || (e.status === 'conflict' && replace.has(e.id)));
  const shown = data.entries.filter(e => filter === 'all' || e.status === filter);
  const bySection = sections.map(s => ({ ...s, rows: shown.filter(e => e.section === s.key) })).filter(s => s.rows.length);
  const conflicts = data.entries.filter(e => e.status === 'conflict');
  const toggle = (id, on) => setReplace(prev => { const n = new Set(prev); if (on) n.add(id); else n.delete(id); return n; });

  const apply = async () => {
    setBusy(true); setError('');
    try {
      const r = await api.post(`/migrations/${job.id}/profiles/${profile.id}/apply`, { replace: [...replace], confirmCount: toApply.length });
      setResult(r); setConfirming(false); setReplace(new Set());
      await load(); await onApplied();
    } catch (e) {
      setError(e.message);
      if (e.status === 409) await load();
    } finally { setBusy(false); }
  };

  return (
    <div className="text-[14px]">
      <div className="px-4 py-3 border-b border-line grid grid-cols-2 md:grid-cols-5 gap-3">
        {[['Will be applied', data.counts.apply], ['Decided differently here', data.counts.conflict], ['Matches nothing here', data.counts.noMatch], ['Already the same', data.counts.same], ['Reference only', data.counts.info]].map(([l, n]) => (
          <div key={l}><div className="text-[13px] text-subtle">{l}</div><div className="text-[20px] font-semibold tabular-nums text-ink">{n}</div></div>
        ))}
      </div>
      <div className="px-4 py-3 border-b border-line flex flex-wrap items-center gap-2">
        {FILTERS.map(([k, l]) => (
          <button key={k} type="button" onClick={() => setFilter(k)} aria-pressed={filter === k}
            className={`min-h-9 px-3 rounded-md border text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${filter === k ? 'bg-action text-white border-action' : 'bg-white text-ink border-line-strong hover:bg-soft'}`}>{l}</button>
        ))}
        {!readOnly && conflicts.length > 0 && (
          <span className="ml-auto flex flex-wrap gap-2">
            <button type="button" className={`${btnSecondary} ${btnSmall}`} onClick={() => setReplace(new Set(conflicts.map(c => c.id)))}>Replace all {conflicts.length} differences</button>
            <button type="button" className={`${btnSecondary} ${btnSmall}`} onClick={() => setReplace(new Set())}>Keep all as decided here</button>
          </span>
        )}
      </div>
      {bySection.length === 0 && <div className="px-4 py-6 text-muted">Nothing to show for this filter.</div>}
      {bySection.map(s => (
        <div key={s.key} className="border-b border-line">
          <div className="px-4 pt-3 pb-1 font-semibold text-ink">{s.title} <span className="font-normal text-subtle">· {s.place}{s.client ? ' · client-specific' : ''}</span></div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[14px]">
              <thead className="bg-soft text-[12px] uppercase tracking-wide text-muted">
                <tr>
                  <th scope="col" className="py-2 px-4 font-semibold">In the profile</th>
                  <th scope="col" className="py-2 px-4 font-semibold">Profile decision</th>
                  <th scope="col" className="py-2 px-4 font-semibold">Here now</th>
                  <th scope="col" className="py-2 px-4 font-semibold">What happens</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {s.rows.map(e => (
                  <tr key={e.id} className="align-top hover:bg-soft/60">
                    <td className="py-2.5 px-4 text-ink">
                      <div className="font-medium break-words">{e.what}</div>
                      {e.target && e.how && e.how !== 'same name' && <div className="text-[13px] text-muted">Matched to "{e.target}": {e.how}.</div>}
                    </td>
                    <td className="py-2.5 px-4 text-ink">{e.value}</td>
                    <td className="py-2.5 px-4 text-muted">{e.current ?? '—'}</td>
                    <td className="py-2.5 px-4">
                      {e.status === 'conflict' && !readOnly ? (
                        <select value={replace.has(e.id) ? 'replace' : 'keep'} onChange={ev => toggle(e.id, ev.target.value === 'replace')} className={`${inputClass} min-h-9 py-1 text-[14px]`} aria-label={`Keep or replace: ${e.what}`}>
                          <option value="keep">Keep what is decided here</option>
                          <option value="replace">Replace with the profile</option>
                        </select>
                      ) : <StatusChip tone={STATUS_TONE[e.status]} dot>{STATUS[e.status]}</StatusChip>}
                      {e.note && <div className="text-[13px] text-muted mt-1">{e.note}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {result && (
        <div role="status" className={`px-4 py-3 border-b ${result.refused ? 'border-warning-line bg-warning-soft' : 'border-success-line bg-success-soft'}`}>
          <div className="flex items-start gap-2 font-medium text-ink">{result.refused ? <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0 text-warning-ink" aria-hidden="true" /> : <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-success-ink" aria-hidden="true" />} {result.words}</div>
          {result.results.some(r => !r.ok || r.words) && (
            <ul className="mt-2 space-y-1">
              {result.results.filter(r => !r.ok || r.words).map(r => (
                <li key={r.id} className="text-ink"><span className="font-medium">{r.what}:</span> {r.ok ? r.words : `refused. ${r.error}`}</li>
              ))}
            </ul>
          )}
          <div className="mt-2 text-muted">Every change is in the audit log with who made it, the old and the new value. Files created earlier are marked out of date where a change affects them.</div>
        </div>
      )}
      {!readOnly && (
        <div className="px-4 py-3 flex flex-wrap items-center gap-3">
          {!confirming ? (
            <button type="button" className={btnPrimary} disabled={!toApply.length} onClick={() => setConfirming(true)}>Apply {toApply.length} {toApply.length === 1 ? 'entry' : 'entries'}</button>
          ) : (
            <div role="alertdialog" aria-label="Apply the profile?" className="p-3 rounded-lg border border-action bg-brand-soft space-y-2 w-full">
              <div className="text-ink">
                <strong>Apply {toApply.length} {toApply.length === 1 ? 'entry' : 'entries'} of "{profile.name}" to {job.company}?</strong>{' '}
                {replace.size > 0 ? `${replace.size} decision(s) made here will be replaced. ` : ''}
                {conflicts.length - replace.size > 0 ? `${conflicts.length - replace.size} decision(s) made here are kept. ` : ''}
                Each entry is checked as on its own screen; anything refused is listed afterwards. Tally data is not changed.
              </div>
              <div className="flex gap-2">
                <button type="button" className={btnPrimary} disabled={busy} onClick={apply}>{busy ? 'Applying…' : 'Yes, apply'}</button>
                <button type="button" className={btnSecondary} disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
              </div>
            </div>
          )}
          {error && <span role="alert" className="text-danger-ink">{error}</span>}
        </div>
      )}
    </div>
  );
}

export default function Screen33_MappingProfiles({ onNavigate, user }) {
  const readOnly = user?.role === 'viewer';
  const { job, loading, error } = useJob();
  const [list, setList] = useState({ profiles: [], sections: [] });
  const [loadError, setLoadError] = useState('');
  const [open, setOpen] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [newName, setNewName] = useState('');
  const [actionError, setActionError] = useState('');
  const [deleting, setDeleting] = useState(null);

  const load = useCallback(async () => {
    try { setList(await api.get('/profiles')); setLoadError(''); } catch (e) { setLoadError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const sections = list.sections || [];
  const openProfile = useMemo(() => list.profiles.find(p => p.id === open) || null, [list, open]);
  const canEdit = p => !readOnly && (['admin', 'super_admin'].includes(user?.role) || p.createdBy === user?.email);

  const importFile = async file => {
    const text = await file.text();
    await api.post('/profiles/import', { profile: text });
    await load();
  };
  const rename = async p => {
    setActionError('');
    try { await api.put(`/profiles/${p.id}`, { name: newName }); setRenaming(null); await load(); } catch (e) { setActionError(e.message); }
  };
  const remove = async p => {
    setActionError('');
    try { await api.del(`/profiles/${p.id}`); setDeleting(null); if (open === p.id) setOpen(null); await load(); } catch (e) { setActionError(e.message); }
  };
  const download = async p => {
    setActionError('');
    try { await downloadFile(`/api/profiles/${p.id}/export`, 'mapping-profile.json'); } catch (e) { setActionError(e.message); }
  };

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
      <JobHeader
        title="Mapping Profiles"
        subtitle="Save the decisions of one migration and reuse them for the next client: account types, tax and TDS mappings, units, rates, Zoho's own accounts, voucher settings and journal routing by pattern."
        job={job} loading={loading} error={error || loadError} onNavigate={onNavigate}
      />
      <Note>
        <strong className="text-ink">How a profile is applied.</strong> First you see a preview: what will be applied, what is already the same, what matches nothing in this migration,
        and what was already decided differently here. A decision made here is kept unless you choose to replace it. Each entry is then checked and saved exactly as if it were entered
        on its own screen, recorded in the audit log, and the files it affects are marked out of date. Tally data is never changed.
        <div className="mt-2">
          Journal routing is saved by pattern (the Tally groups debited and credited), never journal by journal. The GST treatment codes and the column layouts are firm settings:
          the profile shows whether they are the same, but does not change them.
        </div>
      </Note>

      {job && isProcessed(job) && !readOnly && <SaveCard job={job} profiles={list.profiles.filter(canEdit)} onSaved={load} />}

      <Card title="Saved profiles" subtitle={`${list.profiles.length} profile(s) for your firm.`}
        right={!readOnly && <FileButton label="Read a profile from a file" accept=".json,application/json" onFile={importFile} />}>
        {actionError && <div role="alert" className="px-4 py-3 border-b border-danger-line bg-danger-soft text-[14px] text-danger-ink">{actionError}</div>}
        {list.profiles.length === 0 && <EmptyState title="No profile saved yet" text="Process a migration, make its decisions in Mapping Studio, then save them here." actionLabel="Open Mapping Studio" onAction={() => onNavigate('screen-19')} />}
        <div className="divide-y divide-line">
          {list.profiles.map(p => (
            <div key={p.id}>
              <div className="p-4 text-[14px] flex flex-col lg:flex-row lg:items-start justify-between gap-3">
                <div className="min-w-0">
                  {renaming === p.id ? (
                    <span className="flex flex-wrap gap-2 items-center">
                      <input value={newName} onChange={e => setNewName(e.target.value)} className={`${inputClass} max-w-xs`} aria-label="New name" maxLength={100} />
                      <button type="button" className={`${btnSecondary} ${btnSmall}`} onClick={() => rename(p)}>Save name</button>
                      <button type="button" className={`${btnSecondary} ${btnSmall}`} onClick={() => setRenaming(null)}>Cancel</button>
                    </span>
                  ) : <div className="text-[16px] font-semibold text-ink">{p.name}</div>}
                  {p.description && <div className="text-muted">{p.description}</div>}
                  <div className="text-ink mt-1">{countsWords(p.counts, sections)}</div>
                  <div className="text-[13px] text-subtle mt-1">
                    Saved by {p.updatedBy || p.createdBy} on {when(p.updatedAt || p.createdAt)}{p.sourceCompany ? ` from ${p.sourceCompany}` : ''}{p.sourceMigration ? ` (${p.sourceMigration})` : ''}.
                    {p.includesClientSpecific ? ' Includes client-specific corrections.' : ''}
                    {p.lastApplied ? ` Last applied to ${p.lastApplied.company || p.lastApplied.migration} by ${p.lastApplied.by} on ${when(p.lastApplied.at)}.` : ''}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  {job && isProcessed(job) && (
                    <button type="button" className={`${open === p.id ? btnPrimary : btnSecondary} ${btnSmall}`} onClick={() => setOpen(open === p.id ? null : p.id)}>
                      <Eye className="w-4 h-4" aria-hidden="true" /> {open === p.id ? 'Close preview' : `Preview for ${job.company}`}
                    </button>
                  )}
                  <button type="button" className={`${btnSecondary} ${btnSmall}`} onClick={() => download(p)}><Download className="w-4 h-4" aria-hidden="true" /> Download</button>
                  {canEdit(p) && <button type="button" className={`${btnSecondary} ${btnSmall}`} onClick={() => { setRenaming(p.id); setNewName(p.name); }}><Pencil className="w-4 h-4" aria-hidden="true" /> Rename</button>}
                  {canEdit(p) && (deleting === p.id ? (
                    <span className="flex flex-wrap gap-2 items-center">
                      <span className="text-ink">Delete "{p.name}"? Decisions already applied stay.</span>
                      <button type="button" className={`${btnDanger} ${btnSmall}`} onClick={() => remove(p)}>Yes, delete</button>
                      <button type="button" className={`${btnSecondary} ${btnSmall}`} onClick={() => setDeleting(null)}>Cancel</button>
                    </span>
                  ) : <button type="button" className={`${btnSecondary} ${btnSmall}`} onClick={() => setDeleting(p.id)}><Trash2 className="w-4 h-4" aria-hidden="true" /> Delete</button>)}
                </div>
              </div>
              {open === p.id && openProfile && job && (
                <div className="border-t border-line bg-white">
                  <Preview job={job} profile={openProfile} sections={sections} readOnly={readOnly} onApplied={load} />
                </div>
              )}
            </div>
          ))}
        </div>
        {job && !isProcessed(job) && list.profiles.length > 0 && (
          <div className="px-4 py-3 border-t border-line text-[14px] text-muted">Process the data of {job.company} first to preview or apply a profile to it.</div>
        )}
      </Card>
    </div>
  );
}
