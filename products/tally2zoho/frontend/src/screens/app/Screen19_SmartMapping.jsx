import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, AlertTriangle } from 'lucide-react';
import { api, useJob, isProcessed, useScrollTarget } from '../../api';
import JobHeader from '../../components/JobHeader';
import OutOfDateBanner, { readableWhen } from '../../components/OutOfDateBanner';
import { Blocked, Card, StatusChip, btnPrimary, btnSecondary, btnSmall, inputClass } from '../../components/ui';
import AcceptAsTally from '../../components/AcceptAsTally';
import { AccountClashesCard, ItemRatesCard, HsnCorrectionsCard } from './MappingDecisions';
import { NamesCard, FixContactsCard } from './NamesAndContacts';
import { TdsMappingCard, VoucherSettingsCard } from './VoucherDecisions';
import { taxNeedsPerson } from '../../mappingLogic';

const AUTO = [['Customer master', 'Customers'], ['Vendor master', 'Vendors'], ['Chart of Accounts', 'Chart of Accounts'], ['Stock item', 'Items'],
  ['Sales voucher', 'Invoices'], ['Purchase voucher', 'Bills'], ['Receipt voucher', 'Payments Received'], ['Payment voucher', 'Payments Made']];

// A group needs a decision when ledgers sit under it and no type could be found, not even from a group above it.
const needsDecision = g => g.needsDecision ?? (!g.standard && !g.decided);

const plural = (n, one, many = `${one}s`) => `${Number(n).toLocaleString('en-IN')} ${n === 1 ? one : many}`;
const quoteList = names => names.map(n => `"${n}"`).join(', ');
const cell = 'w-full h-8 px-2 rounded-md border border-line-strong text-[13px] text-ink bg-white focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 disabled:bg-soft';

// Zoho's own GST tax names, used when the server does not send them (an older server).
const FALLBACK_CHOICES = { gst: [0, 5, 12, 18, 28].map(rate => ({ name: `GST${rate}`, rate })), igst: [0, 5, 12, 18, 28].map(rate => ({ name: `IGST${rate}`, rate })), savedList: [] };
// A tax ledger is a GST ledger to map unless the server says it is TDS or another duty (posts as an account).
const isGst = t => (t.kind ? t.kind === 'gst' : !t.notGst);

// One GST ledger: the Zoho tax the files write. Empty choice = automatic (Zoho's own tax of the line's rate).
function TaxRow({ row, choices, readOnly, onSave }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async name => { setBusy(true); setError(''); try { await onSave(row.ledger, name); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const explicit = row.source === 'explicit' || (!row.source && !!row.zohoTax) ? row.zohoTax : '';
  const auto = row.autoNames?.length ? row.autoNames.join(', ') : '';
  const listed = choices.savedList?.length ? choices.savedList : null;
  const known = new Set([...(listed || []), ...choices.gst.map(c => c.name), ...choices.igst.map(c => c.name)]);
  const rates = (row.rates || []).map(r => `${r.rate}%${r.vouchers ? ` (${r.vouchers})` : ''}`).join(', ');
  return (
    <tr className="border-b border-soft align-middle text-[13px] hover:bg-soft/60">
      <td className="px-3 py-1.5 text-ink break-words max-w-[16rem]">{row.ledger}</td>
      <td className="px-2 py-1.5 text-muted">{row.head || '—'}</td>
      <td className="px-2 py-1.5 text-muted">{rates || (row.vouchers ? 'No rate' : 'Not used')}{row.rateUnknownVouchers ? `; no rate on ${row.rateUnknownVouchers}` : ''}</td>
      <td className="px-2 py-1.5 min-w-[12rem]">
        {readOnly ? <span className="text-ink">{row.written || explicit || auto || '—'}</span> : (
          <select value={explicit} disabled={busy} onChange={e => save(e.target.value)} aria-label={`Zoho tax for ${row.ledger}`} className={`${cell} ${row.needsPerson && !explicit ? 'border-warning' : ''}`}>
            <option value="">{auto ? `Automatic: ${auto}` : 'Automatic (none found)'}</option>
            {explicit && !known.has(explicit) && <option value={explicit}>{explicit}</option>}
            {listed ? listed.map(n => <option key={n} value={n}>{n}</option>) : (
              <>
                <optgroup label="Within the state (CGST + SGST)">{choices.gst.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}</optgroup>
                <optgroup label="Between states (IGST)">{choices.igst.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}</optgroup>
              </>
            )}
          </select>
        )}
        {error && <div role="alert" className="mt-1 text-danger-ink">{error}</div>}
      </td>
      <td className="px-2 py-1.5">
        {row.needsPerson && !explicit
          ? <StatusChip tone="warning" dot>{row.needsPersonWhy || 'Choose a tax'}</StatusChip>
          : explicit ? <StatusChip tone="success" dot>Chosen</StatusChip>
            : <StatusChip>Automatic</StatusChip>}
      </td>
    </tr>
  );
}

function TaxMappingCard({ jobId, taxes, taxList, readOnly, onSave, onListSaved, onChanged }) {
  const [choices, setChoices] = useState(FALLBACK_CHOICES);
  // read once the saved tax list is known (and again when it changes), not before and after it arrives
  const listCount = taxList ? taxList.count ?? 0 : null;
  useEffect(() => {
    if (listCount == null) return;
    api.get(`/migrations/${jobId}/tax-choices`).then(c => setChoices({ ...FALLBACK_CHOICES, ...c })).catch(() => setChoices(FALLBACK_CHOICES));
  }, [jobId, listCount]);
  const gst = taxes.filter(isGst);
  const needs = gst.filter(taxNeedsPerson);
  const ordered = [...needs, ...gst.filter(t => !needs.includes(t))];
  const other = taxes.filter(t => t.kind === 'other' || (!t.kind && t.notGst));
  const tds = taxes.filter(t => t.kind === 'tds');
  return (
    <Card title="Tax mapping" subtitle="Each GST ledger gets Zoho's own tax of its rate. Change one only if your Zoho uses another name."
      right={<AcceptAsTally jobId={jobId} stepKey="tax_mapping" readOnly={readOnly} onChanged={onChanged} />}>
      <div className={`px-4 py-2 border-b border-soft text-[14px] ${needs.length ? 'bg-warning-soft text-warning-ink font-medium' : 'text-muted'}`}>
        {needs.length ? `${plural(needs.length, 'ledger')} ${needs.length === 1 ? 'needs' : 'need'} you (listed first).` : `All ${plural(gst.length, 'GST ledger')} mapped automatically.`}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-soft border-b border-line text-[12px] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-1.5 font-semibold">Tally ledger</th>
              <th className="px-2 py-1.5 font-semibold">Head</th>
              <th className="px-2 py-1.5 font-semibold">Rates (vouchers)</th>
              <th className="px-2 py-1.5 font-semibold">Zoho tax</th>
              <th className="px-2 py-1.5 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map(t => <TaxRow key={t.ledger} row={t} choices={choices} readOnly={readOnly} onSave={onSave} />)}
            {!gst.length && <tr><td colSpan={5} className="p-4 text-[14px] text-muted">No GST ledgers.</td></tr>}
          </tbody>
        </table>
      </div>
      {(other.length > 0 || tds.length > 0) && (
        <div className="px-4 py-2 border-t border-soft text-[13px] text-muted space-y-0.5">
          {other.length > 0 && <div>Not GST, posted as accounts (nothing to map): {other.map(t => t.ledger).join(', ')}.</div>}
          {tds.length > 0 && <div>TDS ledgers are in TDS mapping: {tds.map(t => t.ledger).join(', ')}.</div>}
        </div>
      )}
      <details className="border-t border-soft">
        <summary className="cursor-pointer px-4 py-2 text-[13px] text-muted hover:text-ink">My Zoho uses other tax names{taxList?.exists ? ` (${plural(taxList.count, 'name')} saved)` : ''}</summary>
        <ZohoTaxList list={taxList} readOnly={readOnly} jobId={jobId} onSaved={onListSaved} />
      </details>
    </Card>
  );
}

// The tax names that exist in the user's Zoho Books, pasted one per line. Only needed when they differ from Zoho's own.
function ZohoTaxList({ list, readOnly, onSaved, jobId }) {
  const saved = (list?.names || []).join('\n');
  const [text, setText] = useState(saved);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // what the last save or clear on this page changed
  useEffect(() => setText(saved), [saved]);
  const lines = text.split(/\r\n|\r|\n/).map(l => l.trim()).filter(Boolean).length;
  const changed = text.trim() !== saved.trim();

  const save = async () => {
    setBusy('save'); setError('');
    try {
      const r = await api.put(`/migrations/${jobId}/zoho-taxes`, { text });
      setResult({ kind: 'save', ...r });
      await onSaved();
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  };
  const clear = async () => {
    if (!window.confirm('Remove your Zoho tax list? The dropdowns go back to Zoho\'s own tax names.')) return;
    setBusy('clear'); setError('');
    try {
      const r = await api.del(`/migrations/${jobId}/zoho-taxes`);
      setResult({ kind: 'clear', ...r });
      await onSaved();
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  };

  return (
    <div className="px-4 pb-4 text-[14px]">
      <p className="text-[13px] text-muted">
        {list?.exists
          ? `${plural(list.count, 'name')} saved${list.savedBy ? ` by ${list.savedBy}` : ''}${readableWhen(list.savedAt) ? `, ${readableWhen(list.savedAt)}` : ''}. The dropdowns offer only these.`
          : 'Paste the tax names of your Zoho Books, one per line, only if they are not Zoho\'s own names.'}
      </p>
      {readOnly ? (
        list?.exists && <ul className="mt-2 flex flex-wrap gap-2">{list.names.map(n => <li key={n} className="rounded-full border border-line bg-white px-3 py-1 text-[13px] text-ink">{n}</li>)}</ul>
      ) : (
        <>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={Math.min(8, Math.max(3, lines + 1))} placeholder={'GST18\nIGST18'} aria-label="Zoho tax names, one per line"
            className={`${inputClass} mt-2 font-mono text-[14px]`} />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={save} disabled={!changed || !lines || !!busy} className={`${btnSecondary} ${btnSmall}`}>{busy === 'save' ? 'Saving…' : 'Save list'}</button>
            {list?.exists && <button type="button" onClick={clear} disabled={!!busy} className={`${btnSecondary} ${btnSmall}`}>{busy === 'clear' ? 'Clearing…' : 'Clear list'}</button>}
          </div>
        </>
      )}
      {error && <p role="alert" className="mt-2 text-danger-ink"><strong>Not saved.</strong> {error}</p>}
      {result && (
        <p role="status" className="mt-2 text-[13px] text-ink">
          {result.kind === 'clear' ? (result.changed ? 'List cleared.' : 'There was no list.')
            : !result.changed ? 'Nothing changed.'
              : [result.added?.length ? `Added: ${quoteList(result.added)}.` : '', result.removed?.length ? `Removed: ${quoteList(result.removed)}.` : ''].filter(Boolean).join(' ') || 'Saved.'}
        </p>
      )}
      {list?.mappingsNotInList?.length > 0 && (
        <p className="mt-2 text-[13px] text-warning-ink">Not in the list: {list.mappingsNotInList.map(m => `${m.ledger} to "${m.zohoTax}"`).join(', ')}.</p>
      )}
    </div>
  );
}

function UnitRow({ row, onSave, readOnly }) {
  const saved = row.zohoUnit || '';
  const [value, setValue] = useState(saved);
  useEffect(() => setValue(saved), [saved]);
  const changed = value.trim() !== saved;
  return (
    <div className="px-4 py-2 flex flex-col sm:flex-row sm:items-center gap-3 text-[14px]">
      <span className="sm:w-56">
        <span className="font-medium text-ink">{row.tallyUnit}</span>
        <span className="text-subtle">{row.fullName ? ` · ${row.fullName}` : ''} · {row.items} item(s)</span>
      </span>
      <ArrowRight className="w-4 h-4 text-subtle hidden sm:block" aria-hidden="true" />
      {readOnly
        ? <span className="sm:w-80 text-ink">{saved || `${row.tallyUnit} (as in Tally)`}</span>
        : (
          <>
            <input value={value} onChange={e => setValue(e.target.value)} placeholder={`As in Tally (${row.tallyUnit})`} aria-label={`Zoho unit for ${row.tallyUnit}`} className={`${inputClass} sm:max-w-xs`} />
            <button type="button" onClick={() => onSave(row.tallyUnit, value)} disabled={!changed} className={`${btnSecondary} ${btnSmall}`}>Save</button>
          </>
        )}
      <span className="text-muted flex flex-col gap-0.5">
        <span className="inline-flex items-center gap-1.5">
          {saved ? <StatusChip tone="info">Written as "{saved}"</StatusChip> : <StatusChip>As in Tally</StatusChip>}
        </span>
        {row.missingFromUnitsFile === true && (
          <StatusChip tone="warning" dot>Not in the Units file</StatusChip>
        )}
      </span>
    </div>
  );
}

// How the account type of a group was reached.
function TypeSource({ g }) {
  if (g.source === 'decided' || (g.source === undefined && g.decided)) return <StatusChip tone="success" dot>Decided by you</StatusChip>;
  if (g.source === 'inherited') return <StatusChip>From {g.inheritedFrom}</StatusChip>;
  if (g.source === 'standard' || (g.source === undefined && g.standard)) return <StatusChip>Standard</StatusChip>;
  if (needsDecision(g)) return <StatusChip tone="warning" dot>Needs you</StatusChip>;
  return <StatusChip>No ledgers of its own</StatusChip>;
}

// Address params (#/mapping-studio?section=ms-fix-contacts&filter=registered_without_gstin): the section to open at, and
// for Fix contacts the problem list to show (one of the ids of GET /contact-fixes problems, or 'filled' / 'corrected').
export default function Screen19_SmartMapping({ onNavigate, user, params = {} }) {
  const readOnly = user?.role === 'viewer';
  const { job, loading, error, reload } = useJob();
  // opened from Prepare migration or the Zoho check at one of the sections below: scrolled to once the page has loaded
  useScrollTarget(params.section);
  const [types, setTypes] = useState({ options: [], groups: [] });
  const [taxes, setTaxes] = useState(null);
  const [taxList, setTaxList] = useState(null);
  const [units, setUnits] = useState({ unitsFileUploaded: false, units: [] });
  const [loaded, setLoaded] = useState(false);
  const [actionError, setActionError] = useState('');
  const processed = isProcessed(job);
  const jobId = job?.id || null;

  // read once per page (and again after a change): the four lists side by side, never twice for one answer
  const load = useCallback(async () => {
    if (!jobId || !processed) return;
    try {
      const [t, x, l, u] = await Promise.all([`account-types`, `tax-mappings`, `zoho-taxes`, `unit-mappings`].map(p => api.get(`/migrations/${jobId}/${p}`)));
      setTypes(t); setTaxes(x); setTaxList(l); setUnits(u);
    } catch (e) { setActionError(e.message); } finally { setLoaded(true); }
  }, [jobId, processed]);
  useEffect(() => { load(); }, [load]);
  const reloadAll = useCallback(async () => { await reload(); await load(); }, [reload, load]);

  // Reloading the migration also reloads the lists on this page, and shows the "files are out of date" notice straight away.
  const act = async fn => { setActionError(''); try { await fn(); await reloadAll(); } catch (e) { setActionError(e.message); } };
  const setType = (group, zohoType) => act(() => api.put(`/migrations/${job.id}/account-types`, { group, zohoType }));
  // A refused tax mapping is shown on its own row, so the error is passed back to the row.
  const saveTax = async (ledger, zohoTax) => { setActionError(''); await api.put(`/migrations/${job.id}/tax-mappings`, { ledger, zohoTax }); await reloadAll(); };
  const saveUnit = (tallyUnit, zohoUnit) => act(() => api.put(`/migrations/${job.id}/unit-mappings`, { tallyUnit, zohoUnit }));

  const taxRows = taxes || [];
  const needDecision = types.groups.filter(needsDecision).length;
  const taxNeeds = taxRows.filter(t => isGst(t) && taxNeedsPerson(t)).length;
  const unitsMissing = units.units.filter(u => u.missingFromUnitsFile === true).length;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
      <JobHeader
        title="Mapping Studio"
        subtitle="The tool has a default for everything. Change only what you need, or accept each card as per Tally."
        job={job} loading={loading} error={error || actionError} onNavigate={onNavigate}
        action={<button type="button" onClick={() => onNavigate('screen-20')} className={`${btnPrimary} self-start`}><span>Voucher Classification</span><ArrowRight className="w-4 h-4" aria-hidden="true" /></button>}
      />

      {job && !processed && <Blocked title="Data has not been processed yet" text="Upload the Tally files and run processing first." button="Open Completeness Check" onClick={() => onNavigate('screen-16')} />}

      <OutOfDateBanner job={job} user={user} onDone={reload} onNavigate={onNavigate} />

      {job && processed && !loaded && <div role="status" aria-busy="true" className="p-4 text-[14px] text-muted">Loading…</div>}
      {job && processed && loaded && (
        <>
          <div className={`p-4 rounded-lg border text-[14px] ${needDecision + taxNeeds ? 'border-warning-line bg-warning-soft' : 'border-success-line bg-success-soft'}`}>
            <span className="font-semibold text-ink">{needDecision + taxNeeds === 0 ? 'Nothing needs you.' : `${needDecision + taxNeeds} item(s) need you.`}</span>{' '}
            <span className="text-muted">{needDecision} account group(s), {taxNeeds} tax ledger(s). Everything else uses the tool's default; a choice you make always wins. Create the files again after any change.</span>
            {readOnly && <div className="mt-1 text-muted">View only: you can see every choice but not change it.</div>}
          </div>

          <div id="ms-account-types" tabIndex={-1} className="scroll-mt-4 focus:outline-none">
          <Card title="Account types" subtitle="Each Tally group becomes a Zoho account type. Sub-groups follow the group above."
            right={<AcceptAsTally jobId={job.id} stepKey="account_types" readOnly={readOnly} onChanged={reload} />}>
            {types.groups.length > 0 && types.hasGroupRecords === false && (
              <div className="px-4 py-2 border-b border-soft text-[13px] text-muted">No Tally group records in the file, so sub-groups cannot follow their main group.</div>
            )}
            <div className="divide-y divide-soft">
              {types.groups.map(g => {
                const value = g.decided || g.zohoType || g.standard || '';
                const need = needsDecision(g);
                return (
                  <div key={g.group} className="px-4 py-1.5 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 text-[13px]">
                    <span className="sm:w-72">
                      <span className="font-medium text-ink">{g.group}</span>{' '}
                      <span className="text-subtle">· {g.ledgers ? `${g.ledgers} ledger(s)` : 'none of its own'}{g.parent ? ` · under ${g.parent}` : ''}</span>
                    </span>
                    {readOnly
                      ? <span className="sm:w-72 text-ink">{value || '—'}</span>
                      : (
                        <select value={value} onChange={e => setType(g.group, e.target.value)} aria-label={`Zoho account type for ${g.group}`} className={`${cell} sm:max-w-xs ${need ? 'border-warning' : ''}`}>
                          {!value && <option value="">Choose a type</option>}
                          {types.options.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      )}
                    <span className="text-muted flex items-center gap-2">
                      <TypeSource g={g} />
                      {g.decided && !readOnly && (
                        <button type="button" onClick={() => setType(g.group, null)} className="text-info-ink hover:underline">Undo</button>
                      )}
                    </span>
                  </div>
                );
              })}
              {types.groups.length === 0 && <div className="p-4 text-[14px] text-muted">No Chart of Accounts was uploaded.</div>}
            </div>
          </Card>
          </div>

          <div id="ms-zoho-accounts" tabIndex={-1} className="scroll-mt-4 focus:outline-none"><AccountClashesCard jobId={job.id} readOnly={readOnly} onChanged={reload} /></div>

          <div id="ms-names" tabIndex={-1} className="scroll-mt-4 focus:outline-none"><NamesCard jobId={job.id} readOnly={readOnly} onChanged={reload} /></div>

          <div id="ms-fix-contacts" tabIndex={-1} className="scroll-mt-4 focus:outline-none"><FixContactsCard jobId={job.id} readOnly={readOnly} onChanged={reload} filterFromAddress={params.section === 'ms-fix-contacts' || !params.section ? params.filter : undefined} /></div>

          <div id="ms-tax-mapping" tabIndex={-1} className="scroll-mt-4 focus:outline-none">
            <TaxMappingCard jobId={job.id} taxes={taxRows} taxList={taxList} readOnly={readOnly} onSave={saveTax} onListSaved={reloadAll} onChanged={reload} />
          </div>

          <div id="ms-tds-mapping" tabIndex={-1} className="scroll-mt-4 focus:outline-none"><TdsMappingCard jobId={job.id} readOnly={readOnly} onChanged={reload} taxes={taxes} /></div>

          <div id="ms-voucher-files" tabIndex={-1} className="scroll-mt-4 focus:outline-none"><VoucherSettingsCard jobId={job.id} readOnly={readOnly} onChanged={reload} /></div>

          <div id="ms-hsn" tabIndex={-1} className="scroll-mt-4 focus:outline-none"><HsnCorrectionsCard jobId={job.id} readOnly={readOnly} onChanged={reload} /></div>

          <div id="ms-units" tabIndex={-1} className="scroll-mt-4 focus:outline-none">
          <Card title="Units" subtitle="Written as in Tally unless you type another unit."
            right={<AcceptAsTally jobId={job.id} stepKey="units" readOnly={readOnly} onChanged={reload} />}>
            {unitsMissing > 0 && (
              <div className="px-4 py-2 border-b border-soft bg-warning-soft text-[13px] text-warning-ink flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{unitsMissing} unit(s) used by items are not in the Units file.</span>
              </div>
            )}
            {units.units.length > 0 && !units.unitsFileUploaded && (
              <div className="px-4 py-2 border-b border-soft text-[13px] text-muted">No Units file: the units come from the stock items.</div>
            )}
            <div className="divide-y divide-soft">
              {units.units.map(u => <UnitRow key={u.tallyUnit} row={u} onSave={saveUnit} readOnly={readOnly} />)}
              {units.units.length === 0 && <div className="p-4 text-[14px] text-muted">No units: {units.unitsFileUploaded ? 'the Units file is empty and ' : ''}no stock item has a unit in Tally, so the Items file is written without one. Nothing to decide.</div>}
            </div>
          </Card>
          </div>

          <div id="ms-item-rates" tabIndex={-1} className="scroll-mt-4 focus:outline-none"><ItemRatesCard jobId={job.id} readOnly={readOnly} onChanged={reload} /></div>

          <details className="rounded-lg border border-line bg-white shadow-xs">
            <summary className="cursor-pointer list-none p-4 flex items-center justify-between text-[14px]">
              <span className="font-medium text-ink">Standard routing (automatic)</span>
              <span className="text-[13px] text-subtle">Show</span>
            </summary>
            <div className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1.5 text-[14px] text-muted">
              {AUTO.map(([a, b]) => <div key={a} className="flex items-center gap-2"><span className="text-ink">{a}</span><ArrowRight className="w-3 h-3 text-subtle" aria-hidden="true" /><span>{b}</span></div>)}
              <div className="sm:col-span-2 lg:col-span-3 pt-2 text-ink">Journals are routed in Voucher Classification.</div>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
