import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Search } from 'lucide-react';
import { api, useStickyState } from '../../api';
import { readableWhen } from '../../components/OutOfDateBanner';
import { Card, btnSecondary, btnPrimary, btnSmall, inputClass } from '../../components/ui';
import AcceptAsTally from '../../components/AcceptAsTally';
import { OptionCard, Loading } from './MappingDecisions';
import { gstTreatmentWords, contactRowsShown } from '../../mappingLogic';

const plural = (n, one, many = `${one}s`) => `${Number(n).toLocaleString('en-IN')} ${n === 1 ? one : many}`;
const PAGE = 20;

function Message({ error, done }) {
  if (error) return <p role="alert" className="text-[14px] text-danger-ink"><strong>Not saved.</strong> {error}</p>;
  if (done) return <p role="status" className="text-[14px] text-success-ink">{done}</p>;
  return null;
}
const Status = ({ ok, children }) => (
  <span className={`inline-flex items-center gap-1.5 ${ok ? 'text-muted' : 'font-medium text-warning-ink'}`}>
    {ok ? <CheckCircle2 className="w-4 h-4 shrink-0 text-success-ink" /> : <AlertTriangle className="w-4 h-4 shrink-0" />} {children}
  </span>
);
const balance = b => (b ? `${b.amount} ${b.side}` : 'none');

// ---------------------------------------------------------------------------------------------------------------
// Names (Mapping Studio): names with hidden characters, and possible duplicates.
function NameRow({ n, readOnly, onClean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async clean => { setBusy(true); setError(''); try { await onClean(n.ledger, clean); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  return (
    <div className="px-4 py-2 text-[14px]">
      <div className="flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-4">
        <div className="min-w-0 lg:flex-1">
          <div className="font-mono text-[13px] text-ink break-words">{n.before}</div>
          <div className="text-[13px] text-muted">Cleaned: <span className="font-mono text-ink">{n.after || '(nothing left)'}</span> · {n.sections.join(', ')} · {plural(n.vouchers, 'voucher')}</div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {n.partOfDuplicate
            ? <Status ok>See duplicates (written "{n.written}")</Status>
            : n.decision ? <Status ok>Cleaned by {n.decidedBy || 'you'}</Status>
              : n.byDefault === 'clean' ? <Status ok>Cleaned by default</Status> : <Status ok>Written as in Tally</Status>}
          {!readOnly && !n.partOfDuplicate && (n.decision
            ? <button type="button" className="text-[13px] text-info-ink hover:underline" disabled={busy} onClick={() => run(false)}>Undo</button>
            : <button type="button" className={btnSecondary} disabled={busy || !n.after} onClick={() => run(true)}>{busy ? 'Saving…' : 'Clean'}</button>)}
        </div>
      </div>
      {error && <div className="mt-2"><Message error={error} /></div>}
    </div>
  );
}

// The state of a group of possible duplicates in words (the server's status: decided, needs_decision, accepted, default).
const groupStatus = g => {
  if (g.decision) return { ok: true, text: `${g.decision === 'merge' ? 'Treated as one' : 'Kept apart'}: your choice${g.decidedBy ? ` (${g.decidedBy}${readableWhen(g.decidedAt) ? `, ${readableWhen(g.decidedAt)}` : ''})` : ''}` };
  if (g.status === 'needs_decision' || (!g.status && g.sameWrittenName)) return { ok: false, text: 'Needs a decision: same name in Zoho' };
  if (g.status === 'accepted') return { ok: true, text: `Accepted as per Tally. ${g.defaultWords || ''}`.trim() };
  return { ok: true, text: g.defaultWords || (g.defaultDecision === 'merge' ? 'Default: treated as one' : 'Default: kept apart') };
};

function DuplicateGroup({ g, readOnly, onSave }) {
  // the option the files use is always selected: the person's decision, else the default
  const initial = () => g.decision || g.defaultDecision || '';
  const [choice, setChoice] = useState(initial);
  const [keep, setKeep] = useState(g.kept || g.defaultKept || g.members[0].ledger);
  const [names, setNames] = useState(() => Object.fromEntries(g.members.map(m => [m.ledger, m.newName || ''])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setChoice(initial()); setKeep(g.kept || g.defaultKept || g.members[0].ledger); setNames(Object.fromEntries(g.members.map(m => [m.ledger, m.newName || '']))); }, [g]); // eslint-disable-line react-hooks/exhaustive-deps
  const why = [g.sameName ? 'the same name' : '', g.sameGstin ? 'the same GSTIN' : ''].filter(Boolean).join(' and ');
  const save = async decision => {
    setBusy(true); setError('');
    try {
      await onSave(decision === null ? { key: g.key, decision: null }
        : decision === 'merge' ? { key: g.key, decision, keep } : { key: g.key, decision, names });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const opt = (id, label, text) => (
    <OptionCard name={`dup-${g.key}`} checked={choice === id} isDefault={g.defaultDecision === id} byPerson={!!g.decision || choice !== (g.defaultDecision || '')}
      disabled={readOnly} onChange={() => setChoice(id)} label={label} text={text} />
  );
  const st = groupStatus(g);
  return (
    <div className="px-4 py-3 text-[14px]">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
        <span className="text-ink"><span className="font-medium">{plural(g.members.length, g.section)}</span> with {why}.</span>
        <Status ok={st.ok}>{st.text}</Status>
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-muted border-b border-line">
              <th className="py-1.5 pr-4 font-medium">Name in Tally</th>
              <th className="py-1.5 pr-4 font-medium">Group</th>
              {g.section !== 'account' && <th className="py-1.5 pr-4 font-medium">GSTIN</th>}
              <th className="py-1.5 pr-4 font-medium">Opening</th>
              <th className="py-1.5 pr-4 font-medium">Vouchers</th>
              <th className="py-1.5 pr-4 font-medium">Written as</th>
            </tr>
          </thead>
          <tbody>
            {g.members.map(m => (
              <tr key={m.ledger} className="border-b border-line align-top">
                <td className="py-1.5 pr-4 font-mono text-ink break-words">{m.visible}</td>
                <td className="py-1.5 pr-4">{m.group || '—'}</td>
                {g.section !== 'account' && <td className="py-1.5 pr-4 font-mono">{m.gstin || '—'}</td>}
                <td className="py-1.5 pr-4">{balance(m.openingBalance)}</td>
                <td className="py-1.5 pr-4">{m.vouchers}</td>
                <td className="py-1.5 pr-4 font-mono break-words">{m.written}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1 text-[13px] text-muted">Opening balances together: {balance(g.combinedBalance)}.{g.addition ? ` ${g.addition}.` : ''}</p>
      </div>
      <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
        {opt('keep_both', 'Keep both', (g.sameWrittenName ?? g.sameName) ? 'Two parties. Give one a different name.' : 'Two parties. No new name needed.')}
        {opt('merge', g.section === 'account' ? 'Treat as one account' : 'Treat as one party', 'Only the one you choose is written; balances are added.')}
      </div>
      {choice === 'keep_both' && (
        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
          {g.members.map(m => (
            <label key={m.ledger} className="block"><span className="block text-[13px] text-muted">New name for <span className="font-mono">{m.visible}</span> (empty: keep)</span>
              <input value={names[m.ledger] || ''} onChange={e => setNames(x => ({ ...x, [m.ledger]: e.target.value }))} disabled={readOnly} className={inputClass} /></label>
          ))}
        </div>
      )}
      {choice === 'merge' && (
        <label className="block mt-2 sm:max-w-md"><span className="block text-[13px] text-muted">Which one is written</span>
          <select value={keep} onChange={e => setKeep(e.target.value)} disabled={readOnly} className={inputClass}>
            {g.members.map(m => <option key={m.ledger} value={m.ledger}>{m.visible}</option>)}
          </select></label>
      )}
      {!readOnly && (
        <div className="mt-2 flex flex-wrap gap-2 items-center">
          <button type="button" className={btnSecondary} disabled={!choice || busy} onClick={() => save(choice)}>{busy ? 'Saving…' : 'Save as my decision'}</button>
          {g.decision && <button type="button" className="text-[13px] text-info-ink hover:underline" disabled={busy} onClick={() => save(null)}>Clear my decision (back to the default)</button>}
        </div>
      )}
      {error && <div className="mt-2"><Message error={error} /></div>}
    </div>
  );
}

export function NamesCard({ jobId, readOnly, onChanged }) {
  const [view, setView] = useState(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);
  const [onlyOpen, setOnlyOpen] = useStickyState(`names:${jobId}:only-open`, false);
  const load = useCallback(async () => { try { setView(await api.get(`/migrations/${jobId}/names`)); } catch (e) { setError(e.message); } }, [jobId]);
  useEffect(() => { load(); }, [load]);
  const after = r => { setView(r); onChanged?.(); };
  const clean = async (ledger, c) => { setDone(''); after(await api.put(`/migrations/${jobId}/names`, { ledger, clean: c })); };
  const cleanAll = async () => {
    setBusy(true); setError(''); setDone('');
    try { const r = await api.post(`/migrations/${jobId}/names/clean-all`); after(r); setDone(`${plural(r.changed, 'name')} cleaned.`); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const saveGroup = async body => { setDone(''); after(await api.put(`/migrations/${jobId}/duplicates`, body)); };

  if (!view) return <Loading title="Names" error={error} />;
  const c = view.counts;
  const asInTally = c.asInTally ?? c.notCleaned;
  const toClean = view.names.filter(n => !n.decision && n.after).length;
  const rows = onlyOpen ? view.names.filter(n => !n.decision && n.byDefault !== 'clean') : view.names;
  const onDefault = c.duplicatesOnDefault ?? Math.max(0, c.duplicates - c.duplicatesDecided - c.duplicatesUndecided);
  return (
    <Card title="Names"
      subtitle="Names are written as in Tally unless they are cleaned: by you here, or by default when the name breaks a Zoho rule. Clean a name only if Zoho rejects it."
      right={<AcceptAsTally jobId={jobId} stepKey="names" readOnly={readOnly} onChanged={onChanged} />}>
      <div className={`px-4 py-2 border-b border-line text-[14px] ${c.duplicatesUndecided ? 'text-warning-ink font-medium' : 'text-muted'}`}>
        {plural(c.names, 'name')} with hidden characters: {asInTally.toLocaleString('en-IN')} written as in Tally, {c.cleaned.toLocaleString('en-IN')} cleaned by you{c.cleanedByDefault ? `, ${c.cleanedByDefault.toLocaleString('en-IN')} cleaned by default` : ''}.
        {' '}{plural(c.duplicates, 'possible duplicate')}: {c.duplicatesDecided} decided by you, {onDefault} on the default{c.duplicatesUndecided ? `, ${c.duplicatesUndecided} need${c.duplicatesUndecided === 1 ? 's' : ''} a decision (the same name in Zoho)` : ''}.
      </div>
      {(view.names.length > 0 || error || done) && (
        <div className="px-4 py-2 border-b border-line flex flex-wrap items-center gap-3 text-[14px]">
          {!readOnly && toClean > 0 && <button type="button" className={btnSecondary} disabled={busy} onClick={cleanAll}>{busy ? 'Cleaning…' : `Clean all ${toClean}`}</button>}
          {view.names.length > 0 && <label className="inline-flex items-center gap-2"><input type="checkbox" checked={onlyOpen} onChange={e => setOnlyOpen(e.target.checked)} /> Only names written as in Tally</label>}
          <Message error={error} done={done} />
        </div>
      )}
      <div className="divide-y divide-line max-h-[28rem] overflow-y-auto">
        {rows.map(n => <NameRow key={n.ledger} n={n} readOnly={readOnly} onClean={clean} />)}
        {!view.names.length && <div className="p-4 text-[14px] text-muted">No name has hidden characters.</div>}
      </div>

      <div className="px-4 pt-3 pb-1 border-t border-line flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <h4 className="text-[15px] font-semibold text-ink">Possible duplicates</h4>
        <AcceptAsTally jobId={jobId} stepKey="duplicates" readOnly={readOnly} onChanged={() => { load(); onChanged?.(); }} />
      </div>
      <div className="divide-y divide-line">
        {view.duplicates.map(g => <DuplicateGroup key={g.key} g={g} readOnly={readOnly} onSave={saveGroup} />)}
        {!view.duplicates.length && <div className="p-4 text-[14px] text-muted">No possible duplicates.</div>}
      </div>
      {view.orphanedDuplicateDecisions.length > 0 && (
        <div className="px-4 py-3 border-t border-line text-[14px]">
          <p className="text-ink">Decisions for duplicates no longer in the data (not used).</p>
          {view.orphanedDuplicateDecisions.map(o => (
            <div key={o.key} className="mt-1 flex flex-wrap items-center gap-2 text-muted">
              <span className="font-mono text-[13px]">{o.members.join(', ')}</span>
              {!readOnly && <button type="button" className="text-[13px] text-info-ink hover:underline" onClick={() => saveGroup({ key: o.key, decision: null }).catch(e => setError(e.message))}>Remove</button>}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Fix contacts (Mapping Studio): a compact sheet of the customers and vendors with a problem or a value filled in by
// the tool. One row per contact: GSTIN, PAN, state and GST treatment can be edited in place; a click on the name
// opens the details. Values the tool filled in (state from the GSTIN, registered because of a GSTIN, PAN from the
// GSTIN) are shown filled and tinted, so they are checked. Unsaved edits are held by the card (not the row), so a save
// or a reload never loses an edit typed on another row, and only the fields changed are sent.
const FIX_FIELDS = ['gstin', 'pan', 'state', 'treatment'];
// What a row shows when nothing is typed: the correction, else what the files write now.
const shownFields = row => ({
  gstin: row.fix?.gstin || row.written?.gstin || '',
  pan: row.fix?.pan || row.pan?.written || '',
  state: row.fix?.state || row.written?.state || row.written?.place || '',
  treatment: row.fix?.treatment || '',
  reason: '',
});
const TREATMENT_SHORT = { unregistered: 'Unregistered', regular: 'Registered (regular)', composition: 'Registered (composition)' };
const writtenTreatment = row => row.written?.gstTreatmentLabel || gstTreatmentWords(row.written?.gstTreatment);
const PROBLEM_SHORT = {
  registered_without_gstin: 'No GSTIN', gstin_format: 'GSTIN format', state_missing: 'No state', place_differs: 'State differs from GSTIN',
  registration_unknown: 'Registration unknown', treatment_other: 'Treatment empty', same_gstin: 'Same GSTIN as another',
};
const cell = 'w-full h-8 px-2 rounded-md border text-[13px] text-ink bg-white focus:outline-none focus:border-brand disabled:bg-soft disabled:text-subtle';
// filled: a value the tool filled in (check it); edited: changed on the screen, not saved
const tone = (filled, edited) => (edited ? 'border-action bg-brand-soft' : filled ? 'bg-warning-soft border-warning-line' : 'border-line-strong');

function ContactRow({ row, view, readOnly, edits, error, busy, open, selected, onSelect, onToggle, onEdit, onSave, onDiscard, onUndoSaved }) {
  const base = shownFields(row);
  const draft = { ...base, ...Object.fromEntries(Object.entries(edits).filter(([k]) => k !== 'panTyped')) };
  const isEdited = k => k in edits && edits[k] !== base[k];
  const changed = FIX_FIELDS.some(isEdited);
  const words = id => view.problems.find(p => p.id === id)?.words || id;
  const filled = {
    state: row.assumptions?.includes('state_from_gstin') && !row.fix?.state,
    treatment: row.assumptions?.includes('gst_registered_from_gstin') && !row.fix?.treatment,
    pan: row.pan?.source === 'gstin' && !row.fix?.pan,
  };
  const unregistered = draft.treatment === 'unregistered';
  const cols = readOnly ? 6 : 8;
  return (
    <>
      <tr className={`border-b border-line align-middle hover:bg-soft ${selected ? 'bg-brand-soft' : ''}`}>
        {!readOnly && (
          <td className="pl-3 pr-1 py-1 w-8"><input type="checkbox" checked={selected} onChange={e => onSelect(e.target.checked)} aria-label={`Select ${row.visible}`} /></td>
        )}
        <td className="px-2 py-1 min-w-[12rem] max-w-[18rem]">
          <button type="button" onClick={onToggle} aria-expanded={open} className="flex items-start gap-1 text-left text-[13px] text-ink hover:underline">
            {open ? <ChevronDown className="w-4 h-4 shrink-0 mt-px" /> : <ChevronRight className="w-4 h-4 shrink-0 mt-px" />}
            <span className="break-words">{row.visible}</span>
          </button>
          <span className="block pl-5 text-[12px] text-subtle">{row.section === 'customer' ? 'Customer' : 'Vendor'}</span>
        </td>
        <td className="px-1 py-1 min-w-[11rem]">
          {readOnly ? <span className="font-mono text-[13px]">{draft.gstin || '—'}</span>
            : <input value={unregistered ? '' : draft.gstin} onChange={e => onEdit('gstin', e.target.value.toUpperCase())} disabled={unregistered} placeholder="none" aria-label={`GSTIN of ${row.visible}`}
              className={`${cell} font-mono ${tone(false, isEdited('gstin'))} ${row.problems.includes('same_gstin') || row.problems.includes('gstin_format') ? '!border-danger bg-danger-soft' : ''}`} />}
        </td>
        <td className="px-1 py-1 min-w-[8rem]">
          {readOnly ? <span className="font-mono text-[13px]">{draft.pan || '—'}</span>
            : <input value={draft.pan} onChange={e => onEdit('pan', e.target.value.toUpperCase())} placeholder="none" aria-label={`PAN of ${row.visible}`}
              className={`${cell} font-mono ${tone(filled.pan, isEdited('pan'))}`} />}
        </td>
        <td className="px-1 py-1 min-w-[9rem]">
          {readOnly ? <span className="text-[13px]">{draft.state || '—'}</span>
            : (
              <select value={draft.state} onChange={e => onEdit('state', e.target.value)} aria-label={`State of ${row.visible}`} className={`${cell} ${tone(filled.state, isEdited('state'))}`}>
                <option value="">None</option>
                {view.states.map(s => <option key={s.code} value={s.code}>{s.code} {s.name}</option>)}
              </select>
            )}
        </td>
        <td className="px-1 py-1 min-w-[9rem]">
          {readOnly ? <span className="text-[13px]">{TREATMENT_SHORT[draft.treatment] || writtenTreatment(row) || '—'}</span>
            : (
              <select value={draft.treatment} onChange={e => onEdit('treatment', e.target.value)} aria-label={`GST treatment of ${row.visible}`} title={row.written.gstTreatment ? `Code in the file: ${row.written.gstTreatment}` : undefined}
                className={`${cell} ${tone(filled.treatment, isEdited('treatment'))}`}>
                <option value="">{writtenTreatment(row) ? `${writtenTreatment(row)} (as written)` : 'Empty'}</option>
                {view.treatments.map(t => <option key={t.id} value={t.id}>{t.label || TREATMENT_SHORT[t.id] || t.id}</option>)}
              </select>
            )}
        </td>
        <td className="px-2 py-1 text-[13px]">
          {row.problems.length
            ? <span className="inline-flex items-center gap-1 text-warning-ink"><AlertTriangle className="w-3.5 h-3.5 shrink-0" />{row.problems.map(p => PROBLEM_SHORT[p] || words(p)).join(', ')}</span>
            : row.fix ? <span className="inline-flex items-center gap-1 text-success-ink"><CheckCircle2 className="w-3.5 h-3.5 shrink-0" />Corrected</span>
              : <span className="text-muted">Check filled values</span>}
        </td>
        {!readOnly && (
          <td className="px-2 py-1 whitespace-nowrap text-[13px]">
            {changed ? (
              <span className="inline-flex items-center gap-2">
                <button type="button" className={`${btnPrimary} ${btnSmall}`} disabled={busy} onClick={() => onSave(null)}>{busy ? 'Saving…' : 'Save'}</button>
                <button type="button" className="text-info-ink hover:underline" disabled={busy} onClick={onDiscard}>Undo</button>
              </span>
            ) : onUndoSaved ? (
              <span className="inline-flex items-center gap-2">
                <span className="inline-flex items-center gap-1 text-success-ink"><CheckCircle2 className="w-3.5 h-3.5" />Saved</span>
                <button type="button" className="text-info-ink hover:underline" disabled={busy} onClick={onUndoSaved}>{busy ? 'Undoing…' : 'Undo'}</button>
              </span>
            ) : null}
          </td>
        )}
      </tr>
      {error && (
        <tr className="border-b border-line"><td colSpan={cols} className="px-4 py-1.5"><Message error={error} /></td></tr>
      )}
      {open && (
        <tr className="border-b border-line bg-soft">
          <td colSpan={cols} className="px-4 py-2 text-[13px] text-muted">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
              <div>In Tally: {row.tally.registrationType || 'no registration type'}; GSTIN {row.tally.gstin || 'none'}; PAN {row.pan?.tally || 'none'}; state {row.tally.state || 'none'}{row.tally.placeOfSupply ? `; place of supply ${row.tally.placeOfSupply}` : ''}.</div>
              <div>Written: {writtenTreatment(row) ? `${writtenTreatment(row)} (code ${row.written.gstTreatment})` : 'no GST treatment'}; GSTIN {row.written.gstin || 'none'}; PAN {row.pan?.written || 'none'}; state {row.written.state || row.written.place || 'none'}.</div>
              {row.problems.length > 0 && <div className="text-warning-ink">{row.problems.map(words).join('. ')}.</div>}
              {row.sameGstin?.length > 0 && <div className="text-warning-ink">Same GSTIN as: {row.sameGstin.join(', ')}. One GSTIN is wrong: correct it above.</div>}
              {row.assumptions?.length > 0 && <div>Filled by the tool: {row.assumptions.map(a => view.assumptions?.find(x => x.id === a)?.words || a).join('; ')}.</div>}
              {row.pan?.fromGstin && <div>PAN in the GSTIN: <span className="font-mono">{row.pan.fromGstin}</span></div>}
              {row.fix && <div>Corrected{row.fix.by ? ` by ${row.fix.by}` : ''}{readableWhen(row.fix.at) ? `, ${readableWhen(row.fix.at)}` : ''}. Reason: {row.fix.reason}</div>}
            </div>
            {!readOnly && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input value={draft.reason} onChange={e => onEdit('reason', e.target.value)} placeholder="Reason (optional)" aria-label={`Reason for ${row.visible}`} className={`${cell} max-w-sm border-line-strong`} />
                {row.fix && <button type="button" className="text-info-ink hover:underline" disabled={busy} onClick={() => onSave({ gstin: '', pan: '', state: '', treatment: '', reason: draft.reason })}>Remove correction</button>}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// The actions offered for the selected rows. fields(row) -> the fields to send, or null when it does not apply.
const BULK = [
  { id: 'confirm', label: 'Confirm filled values', fields: r => {
    const f = {};
    if (r.assumptions?.includes('state_from_gstin') && r.gstinState && !r.fix?.state) f.state = r.gstinState;
    if (r.assumptions?.includes('gst_registered_from_gstin') && !r.fix?.treatment) f.treatment = 'regular';
    if (r.pan?.source === 'gstin' && r.pan.fromGstin && !r.fix?.pan) f.pan = r.pan.fromGstin;
    return Object.keys(f).length ? f : null;
  } },
  { id: 'state', label: "Use the GSTIN's state", fields: r => (r.gstinState ? { state: r.gstinState } : null) },
  { id: 'unregistered', label: 'Treat as unregistered', fields: () => ({ treatment: 'unregistered', gstin: '' }) },
  { id: 'regular', label: 'Treat as registered', fields: r => (r.written?.gstin || r.fix?.gstin ? { treatment: 'regular' } : null) },
  { id: 'pan', label: 'PAN from the GSTIN', fields: r => (r.pan?.fromGstin ? { pan: r.pan.fromGstin } : null) },
  { id: 'setState', label: 'Set the state to…', fields: (r, state) => (state ? { state } : null) },
];

// The correction stored for a row, as the fields to send to put it back (Undo after a save): '' clears a field.
const fixFields = row => ({ gstin: row.fix?.gstin || '', pan: row.fix?.pan || '', state: row.fix?.state || '', treatment: row.fix?.treatment || '' });
export function FixContactsCard({ jobId, readOnly, onChanged, filterFromAddress }) {
  const [view, setView] = useState(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  // the list shown, its page and the rows opened are kept when the page is saved, reloaded or opened again
  const [filter, setFilter] = useStickyState(`fix-contacts:${jobId}:filter`, '');
  const [search, setSearch] = useState('');
  // rows saved since the filter or search changed: kept on screen with an Undo (key -> the fields to put back)
  const [savedRows, setSavedRows] = useState(() => new Map());
  const [page, setPage] = useStickyState(`fix-contacts:${jobId}:page`, 0);
  // opened from a link (Zoho check, Prepare migration) with a problem list: that list replaces the one kept from before
  useEffect(() => {
    if (filterFromAddress == null) return;
    setFilter(filterFromAddress); setPage(0); setSearch(''); setSavedRows(new Map());
  }, [filterFromAddress]); // eslint-disable-line react-hooks/exhaustive-deps
  const [openRows, setOpenRows] = useStickyState(`fix-contacts:${jobId}:open`, []);
  const [allOpen, setAllOpen] = useStickyState(`fix-contacts:${jobId}:all-open`, false);
  // unsaved edits, per row: { 'section|ledger': { gstin?, pan?, state?, treatment?, reason? } }; errors per row
  const [edits, setEdits] = useState({});
  const [rowErrors, setRowErrors] = useState({});
  const [savingRows, setSavingRows] = useState(() => new Set());
  const [selected, setSelected] = useState(() => new Set());
  const [bulkId, setBulkId] = useState('confirm');
  const [bulkState, setBulkState] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const load = useCallback(async () => { try { setView(await api.get(`/migrations/${jobId}/contact-fixes`)); } catch (e) { setError(e.message); } }, [jobId]);
  useEffect(() => { load(); }, [load]);
  const after = r => { setView(r); onChanged?.(); };
  const keyOf = r => `${r.section}|${r.ledger}`;
  const editRow = (r, k, v) => setEdits(all => {
    const cur = { ...(all[keyOf(r)] || {}), [k]: v };
    if (k === 'treatment' && v === 'unregistered') cur.gstin = ''; // no GSTIN is written for an unregistered party
    // the PAN follows the GSTIN typed, until a PAN is typed by hand
    if (k === 'pan') cur.panTyped = true;
    if (k === 'gstin' && !cur.panTyped && /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]/.test(v)) cur.pan = v.slice(2, 12);
    return { ...all, [keyOf(r)]: cur };
  });
  const discardRow = r => setEdits(all => { const n = { ...all }; delete n[keyOf(r)]; return n; });
  // only the fields changed are sent, so a field of this row or of another row is never overwritten by a stale value
  const changesOf = r => {
    const e = edits[keyOf(r)] || {}, base = shownFields(r);
    const out = Object.fromEntries(FIX_FIELDS.filter(k => k in e && e[k] !== base[k]).map(k => [k, e[k]]));
    if (Object.keys(out).length && e.reason) out.reason = e.reason;
    return out;
  };
  const pending = view ? view.rows.filter(r => Object.keys(changesOf(r)).length) : [];
  // remember: true keeps each row on screen with an Undo that puts back what it had before this save
  const saveRows = async (list, override, { remember = true } = {}) => {
    const keys = list.map(keyOf);
    setDone(''); setError('');
    setSavingRows(s => new Set([...s, ...keys]));
    try {
      const byLedger = new Map();
      for (const r of list) byLedger.set(r.ledger, { ledger: r.ledger, ...(byLedger.get(r.ledger) || {}), ...(override || changesOf(r)) });
      const r = await api.patch(`/migrations/${jobId}/contact-fixes`, { fixes: [...byLedger.values()] });
      after(r);
      setSavedRows(m => {
        const n = new Map(m);
        for (const row of list) { if (remember) { if (!n.has(keyOf(row))) n.set(keyOf(row), fixFields(row)); } else n.delete(keyOf(row)); }
        return n;
      });
      setEdits(all => { const n = { ...all }; keys.forEach(k => delete n[k]); return n; });
      setRowErrors(all => { const n = { ...all }; keys.forEach(k => delete n[k]); return n; });
      if (list.length > 1) setDone(`${plural(byLedger.size, 'contact')} saved.`);
    } catch (e) {
      // nothing was stored; every edit stays on the screen, and each refused row says why
      const byLedger = Object.fromEntries((e.data?.errors || []).map(x => [x.ledger, x.error]));
      setRowErrors(all => ({ ...all, ...Object.fromEntries(list.map(r => [keyOf(r), byLedger[r.ledger] || (list.length === 1 ? e.message : '')]).filter(([, m]) => m)) }));
      if (list.length > 1) setError(e.message);
    } finally { setSavingRows(s => { const n = new Set(s); keys.forEach(k => n.delete(k)); return n; }); }
  };
  const pinned = useMemo(() => new Set(savedRows.keys()), [savedRows]);
  const rows = useMemo(() => (view ? contactRowsShown(view.rows, filter, search, pinned, keyOf) : []), [view, filter, search, pinned]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const at = Math.min(page, pages - 1);
  const visible = rows.slice(at * PAGE, at * PAGE + PAGE);
  const chooseFilter = f => { setFilter(f); setPage(0); setSelected(new Set()); setSavedRows(new Map()); };
  const undoSaved = r => saveRows([r], { ...savedRows.get(keyOf(r)), reason: 'Undo in Fix contacts' }, { remember: false });
  const isOpen = r => allOpen || openRows.includes(keyOf(r));
  const toggle = r => setOpenRows(list => (list.includes(keyOf(r)) ? list.filter(k => k !== keyOf(r)) : [...list, keyOf(r)]));
  const selectedRows = rows.filter(r => selected.has(keyOf(r)));
  const action = BULK.find(b => b.id === bulkId) || BULK[0];
  const applicable = selectedRows.filter(r => action.fields(r, bulkState));
  // contacts registered in Tally with no GSTIN: written as registered (as in Tally), which Zoho may refuse; one click treats
  // them all as unregistered (the server confirms the count)
  const noGstinLedgers = [...new Set((view?.rows || []).filter(r => r.problems.includes('registered_without_gstin')).map(r => r.ledger))];
  const treatAllUnregistered = async () => {
    setBulkBusy(true); setError(''); setDone('');
    try {
      const r = await api.post(`/migrations/${jobId}/contact-fixes/unregistered-without-gstin`, { confirmCount: noGstinLedgers.length });
      after(r); setDone(`${plural(noGstinLedgers.length, 'contact')} with no GSTIN are now treated as unregistered. Each one can be changed back in the list.`);
    } catch (e) { setError(e.message); } finally { setBulkBusy(false); }
  };
  const applyBulk = async () => {
    setBulkBusy(true); setError(''); setDone('');
    const byLedger = new Map();
    for (const r of applicable) if (!byLedger.has(r.ledger)) byLedger.set(r.ledger, { ledger: r.ledger, ...action.fields(r, bulkState), reason: `${action.label} (selected rows)` });
    try {
      const r = await api.patch(`/migrations/${jobId}/contact-fixes`, { fixes: [...byLedger.values()] });
      after(r); setDone(`${action.label}: ${plural(byLedger.size, 'contact')} saved. Each one stays in the list with an Undo until you change the list.`); setSelected(new Set());
      setSavedRows(m => { const n = new Map(m); for (const row of applicable) if (!n.has(keyOf(row))) n.set(keyOf(row), fixFields(row)); return n; });
    } catch (e) {
      const errs = e.data?.errors || [];
      setError(errs.length > 1 ? `${e.message} ${errs.slice(1, 4).map(x => x.error).join(' ')}` : e.message);
    } finally { setBulkBusy(false); }
  };

  if (!view) return <Loading title="Fix contacts" error={error} />;
  const filledCount = view.rows.filter(r => r.assumptions?.length || r.pan?.source === 'gstin').length;
  const chip = (id, label, n) => (
    <button key={id || 'all'} type="button" onClick={() => chooseFilter(id)} aria-pressed={filter === id}
      className={`h-8 px-3 rounded-full border text-[13px] ${filter === id ? 'border-action bg-brand-soft text-info-ink font-medium' : 'border-line-strong bg-white text-ink hover:bg-soft'}`}>
      {label} <span className="tabular-nums">{n}</span>
    </button>
  );
  const allOnFilter = rows.length > 0 && rows.every(r => selected.has(keyOf(r)));
  const cols = readOnly ? 6 : 8;
  return (
    <Card title="Fix contacts"
      subtitle={`${view.counts.withProblems.toLocaleString('en-IN')} of ${plural(view.counts.contacts, 'contact')} still have a problem; ${view.counts.corrected.toLocaleString('en-IN')} corrected by you; ${filledCount.toLocaleString('en-IN')} filled by the tool (tinted: check them). Tally is not changed.`}
      right={<AcceptAsTally jobId={jobId} stepKey="contact_fixes" readOnly={readOnly} onChanged={onChanged} />}>
      <div className="px-4 py-2 border-b border-line flex flex-wrap items-center gap-2">
        {chip('', 'All listed', view.rows.length)}
        {view.problems.filter(p => p.remaining).map(p => chip(p.id, p.words, p.remaining))}
        {filledCount > 0 && chip('filled', 'Filled by the tool', filledCount)}
        {view.counts.corrected > 0 && chip('corrected', 'Corrected by you', view.counts.corrected)}
        <span className="text-[12px] text-subtle">A contact with two problems is in both lists.</span>
      </div>
      {!readOnly && noGstinLedgers.length > 0 && (
        <div className="px-4 py-3 border-b border-line bg-warning-soft flex flex-wrap items-center gap-3 text-[14px] text-warning-ink">
          <p className="flex-1 min-w-[16rem]">{plural(noGstinLedgers.length, 'contact')} {noGstinLedgers.length === 1 ? 'is' : 'are'} registered under GST in Tally but {noGstinLedgers.length === 1 ? 'has' : 'have'} no GSTIN. They are written as registered, as in Tally, and Zoho Books may refuse them. If these parties are not registered, treat them all as unregistered in one click.</p>
          <button type="button" className={`${btnSecondary} ${btnSmall}`} disabled={bulkBusy} onClick={treatAllUnregistered}>Treat all {noGstinLedgers.length} as unregistered</button>
        </div>
      )}
      <div className="px-4 py-2 border-b border-line">
        <label className="relative block sm:max-w-sm">
          <span className="sr-only">Search contacts by name or GSTIN</span>
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-subtle" aria-hidden="true" />
          <input type="search" value={search} onChange={e => { setSearch(e.target.value); setPage(0); setSavedRows(new Map()); }} placeholder="Search by name or GSTIN"
            className={`${inputClass} !min-h-9 pl-9 text-[14px]`} />
        </label>
      </div>
      {!readOnly && (
        <div className="px-4 py-2 border-b border-line bg-soft flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-ink">{selectedRows.length ? `${selectedRows.length} selected` : 'Select rows, then'}</span>
          <select value={bulkId} onChange={e => setBulkId(e.target.value)} aria-label="Action for the selected rows" className={`${cell} w-auto border-line-strong`}>
            {BULK.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
          {bulkId === 'setState' && (
            <select value={bulkState} onChange={e => setBulkState(e.target.value)} aria-label="State for the selected rows" className={`${cell} w-auto border-line-strong`}>
              <option value="">Choose a state</option>
              {view.states.map(s => <option key={s.code} value={s.code}>{s.code} {s.name}</option>)}
            </select>
          )}
          <button type="button" className={`${btnPrimary} ${btnSmall}`} disabled={bulkBusy || !applicable.length} onClick={applyBulk}>
            {bulkBusy ? 'Applying…' : `Apply to ${applicable.length}`}
          </button>
          {selectedRows.length > applicable.length && <span className="text-muted">{selectedRows.length - applicable.length} not applicable</span>}
          <span className="ml-auto flex items-center gap-3">
            <button type="button" className="text-info-ink hover:underline" onClick={() => { setAllOpen(o => !o); if (allOpen) setOpenRows([]); }}>{allOpen ? 'Collapse all' : 'Expand all'}</button>
          </span>
        </div>
      )}
      {readOnly && (
        <div className="px-4 py-2 border-b border-line text-[13px]">
          <button type="button" className="text-info-ink hover:underline" onClick={() => { setAllOpen(o => !o); if (allOpen) setOpenRows([]); }}>{allOpen ? 'Collapse all' : 'Expand all'}</button>
        </div>
      )}
      {(error || done) && <div className="px-4 py-2"><Message error={error} done={done} /></div>}
      {!readOnly && pending.length > 0 && (
        <div className="sticky top-0 z-10 px-4 py-2 border-b border-line bg-white flex flex-wrap items-center gap-3 text-[14px]">
          <span className="text-ink">{plural(pending.length, 'row')} not saved.</span>
          <button type="button" className={btnPrimary} disabled={savingRows.size > 0} onClick={() => saveRows(pending)}>{savingRows.size > 0 ? 'Saving…' : 'Save all'}</button>
          <button type="button" className="text-[13px] text-info-ink hover:underline" disabled={savingRows.size > 0} onClick={() => { setEdits({}); setRowErrors({}); }}>Undo all</button>
        </div>
      )}
      <div className="overflow-x-auto max-h-[70vh] table-sticky">
        <table className="w-full text-left">
          <thead className="bg-soft border-b border-line text-[12px] text-muted">
            <tr>
              {!readOnly && (
                <th className="pl-3 pr-1 py-1.5 w-8">
                  <input type="checkbox" checked={allOnFilter} onChange={e => setSelected(e.target.checked ? new Set(rows.map(keyOf)) : new Set())} aria-label={`Select all ${rows.length}`} title={`Select all ${rows.length}`} />
                </th>
              )}
              <th className="px-2 py-1.5 font-semibold">Contact</th>
              <th className="px-2 py-1.5 font-semibold">GSTIN</th>
              <th className="px-2 py-1.5 font-semibold">PAN</th>
              <th className="px-2 py-1.5 font-semibold">State</th>
              <th className="px-2 py-1.5 font-semibold">GST treatment</th>
              <th className="px-2 py-1.5 font-semibold">Problem</th>
              {!readOnly && <th className="px-2 py-1.5"><span className="sr-only">Save</span></th>}
            </tr>
          </thead>
          <tbody>
            {visible.map(r => (
              <ContactRow key={keyOf(r)} row={r} view={view} readOnly={readOnly} edits={edits[keyOf(r)] || {}} error={rowErrors[keyOf(r)] || ''} busy={savingRows.has(keyOf(r))}
                open={isOpen(r)} selected={selected.has(keyOf(r))} onToggle={() => toggle(r)}
                onSelect={on => setSelected(s => { const n = new Set(s); if (on) n.add(keyOf(r)); else n.delete(keyOf(r)); return n; })}
                onEdit={(k, v) => editRow(r, k, v)} onDiscard={() => discardRow(r)} onSave={override => saveRows([r], override)}
                onUndoSaved={!readOnly && savedRows.has(keyOf(r)) ? () => undoSaved(r) : null} />
            ))}
            {!rows.length && <tr><td colSpan={cols} className="p-4 text-[14px] text-muted">{search.trim() ? `No contact matches "${search.trim()}" in this list.` : 'No contact in this list.'}</td></tr>}
          </tbody>
        </table>
      </div>
      {rows.length > PAGE && (
        <div className="px-4 py-2 border-t border-line flex flex-wrap items-center gap-3 text-[13px]">
          <button type="button" className={btnSecondary} disabled={at === 0} onClick={() => setPage(at - 1)}>Previous</button>
          <span className="text-muted">Rows {at * PAGE + 1} to {Math.min(rows.length, at * PAGE + PAGE)} of {rows.length}</span>
          <button type="button" className={btnSecondary} disabled={at >= pages - 1} onClick={() => setPage(at + 1)}>Next</button>
        </div>
      )}
    </Card>
  );
}
