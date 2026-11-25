import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { api } from '../../api';
import { readableWhen } from '../../components/OutOfDateBanner';
import { Card, StatusChip, btnSecondary, inputClass } from '../../components/ui';
import AcceptAsTally from '../../components/AcceptAsTally';
import { OptionCard, Loading } from './MappingDecisions';
import { optionWords, tdsOnDocuments } from '../../mappingLogic';

const plural = (n, one, many = `${one}s`) => `${Number(n).toLocaleString('en-IN')} ${n === 1 ? one : many}`;

// One setting with a default: the option in use is always selected; the default is marked "Default", a different choice
// "Your choice".
function SettingChoice({ name, legend, options, value, defaultValue, disabled, onChange }) {
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-[14px] font-medium text-ink mb-1">{legend}</legend>
      {options.map(o => (
        <OptionCard key={o.id} name={name} checked={value === o.id} isDefault={o.id === defaultValue} byPerson={value !== defaultValue}
          disabled={disabled} onChange={() => onChange(o.id)} label={optionWords(o.words)} />
      ))}
    </fieldset>
  );
}

function Message({ error, done }) {
  if (error) return <p role="alert" className="text-[14px] text-danger-ink"><strong>Not saved.</strong> {error}</p>;
  if (done) return <p role="status" className="text-[14px] text-success-ink">{done}</p>;
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// TDS mapping: for each Tally TDS ledger, the Zoho TDS tax written in the TDS columns of the bill (deducted from the
// vendor) or the invoice (deducted by the customer). The tool suggests one from Tally's section; a pick-list, never
// free typing. Choosing "Suggested" removes the explicit choice.
const cell = 'w-full h-8 px-2 rounded-md border border-line-strong text-[13px] text-ink bg-white focus:outline-none focus:border-brand disabled:bg-soft';
const tint = 'bg-brand-soft border-info-line';

function TdsRow({ row, choices, readOnly, onSave, onDocuments }) {
  const explicit = row.source === 'explicit' || (!row.source && row.tdsName) ? row.tdsName : '';
  const usedPercent = explicit ? row.percent : row.written?.percent ?? row.suggestion?.percent ?? '';
  const [percent, setPercent] = useState(usedPercent || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setPercent(usedPercent || ''), [usedPercent]);
  const save = async body => {
    setBusy(true); setError('');
    try { await onSave(body); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const suggested = row.suggestion?.tdsName || '';
  const names = choices.map(c => c.name);
  const written = row.written?.tdsName || explicit || suggested;
  const section = (!explicit && row.written?.section) || choices.find(c => c.name === written)?.sections?.[0] || row.suggestion?.section || row.section || '';
  const vouchers = [row.billVouchers != null ? `${row.billVouchers} bill(s)` : '', row.invoiceVouchers != null ? `${row.invoiceVouchers} invoice(s)` : ''].filter(Boolean).join(', ')
    || (row.partySideVouchers ? plural(row.partySideVouchers, 'voucher') : 'not deducted');
  const choose = name => save(name ? { ledger: row.ledger, tdsName: name, section: '', percent } : { ledger: row.ledger, tdsName: '' });
  return (
    <tr className="border-b border-line align-middle text-[13px] hover:bg-soft">
      <td className="px-3 py-1.5 text-ink break-words max-w-[16rem]">{row.ledger}<span className="block text-[12px] text-subtle">{row.nature || 'No nature in Tally'}</span></td>
      <td className="px-2 py-1.5 text-muted">{vouchers}</td>
      <td className="px-2 py-1.5 min-w-[14rem]">
        {readOnly ? <span className="text-ink">{written || 'None'}</span> : (
          <select value={explicit} disabled={busy} onChange={e => choose(e.target.value)} aria-label={`Zoho TDS tax for ${row.ledger}`}
            className={`${cell} ${!explicit && suggested ? tint : ''} ${!explicit && !suggested && row.partySideVouchers ? '!border-danger bg-danger-soft' : ''}`}>
            <option value="">{suggested ? `Default: ${suggested}` : onDocuments ? 'None (negative line)' : 'None (journals stay Manual Journals)'}</option>
            {explicit && !names.includes(explicit) && <option value={explicit}>{explicit}</option>}
            {choices.map(c => <option key={c.name} value={c.name}>{c.name}{c.sections?.length ? ` (${c.sections.join(', ')})` : ''}</option>)}
          </select>
        )}
        {!explicit && row.suggestion?.why && <span className="block mt-0.5 text-[12px] text-subtle">{row.suggestion.why}</span>}
        {error && <div role="alert" className="mt-1 text-danger-ink">{error}</div>}
      </td>
      <td className="px-2 py-1.5 text-muted whitespace-nowrap">{section || '—'}</td>
      <td className="px-2 py-1.5 w-28">
        {readOnly || !explicit ? <span className="text-muted">{usedPercent ? `${usedPercent}%` : '—'}</span> : (
          <span className="inline-flex items-center gap-1">
            <input value={percent} onChange={e => setPercent(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" aria-label={`TDS percentage for ${row.ledger}`} className={`${cell} w-16`} />
            {percent !== (row.percent || '') && <button type="button" className="text-info-ink hover:underline font-medium" disabled={busy} onClick={() => save({ ledger: row.ledger, tdsName: explicit, section: row.section || '', percent })}>Save</button>}
          </span>
        )}
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap">
        {explicit ? <span className="text-info-ink font-medium">Your choice{row.decidedBy ? ` (${row.decidedBy})` : ''}</span>
          : suggested ? <span className="text-muted">Default</span>
            : row.partySideVouchers && onDocuments ? <StatusChip tone="danger"><AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />Choose one</StatusChip>
              : row.partySideVouchers ? <span className="text-muted">Not needed</span>
                : <span className="text-muted">Not used</span>}
      </td>
    </tr>
  );
}

// What happens to a TDS ledger with no Zoho TDS tax, in one wording (the same rule as Prepare migration): see
// tdsOnDocuments in mappingLogic.js.
export function TdsMappingCard({ jobId, readOnly, onChanged, taxes = null }) {
  const [view, setView] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api.get(`/migrations/${jobId}/tds-mappings`).then(setView).catch(e => setError(e.message)), [jobId]);
  useEffect(() => { load(); }, [load]);
  const save = async body => { const r = await api.put(`/migrations/${jobId}/tds-mappings`, body); setView(r); onChanged?.(); };
  if (!view) return <Loading title="TDS mapping" error={error} />;
  const choices = view.choices || [];
  const open = view.ledgers.filter(l => (l.source ? l.source === 'none' : !l.tdsName) && l.partySideVouchers > 0);
  const onDocs = open.filter(l => tdsOnDocuments(taxes, l.ledger));
  const onJournals = open.length - onDocs.length;
  return (
    <Card title="TDS mapping" subtitle="TDS on bills and invoices goes into Zoho's TDS columns. By default the Zoho TDS tax of Tally's section is used; the name must exist in your Zoho."
      right={<AcceptAsTally jobId={jobId} stepKey="tds_mapping" readOnly={readOnly} onChanged={onChanged} />}>
      {onDocs.length > 0 && (
        <div className="px-4 py-2 border-b border-warning-line bg-warning-soft text-[14px] text-ink flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-warning-ink" />
          <span>{plural(onDocs.length, 'TDS ledger')} with no Zoho TDS tax {onDocs.length === 1 ? 'is' : 'are'} deducted on purchase or sales vouchers: those bills and invoices carry a negative line, which Zoho may refuse. Choose the Zoho TDS tax.</span>
        </div>
      )}
      {onJournals > 0 && (
        <div className="px-4 py-2 border-b border-line text-[14px] text-muted">
          {plural(onJournals, 'TDS ledger')} with no Zoho TDS tax {onJournals === 1 ? 'is' : 'are'} deducted only on journals. Those journals are written as Manual Journals by default, which post the TDS as Tally did, so nothing is refused. Choose a Zoho TDS tax only if you route those journals to Bill.
        </div>
      )}
      {view.ledgers.length > 0 ? (
        <div className="overflow-x-auto table-sticky">
          <table className="w-full text-left">
            <thead className="bg-soft border-b border-line text-[12px] text-muted">
              <tr>
                <th className="px-3 py-1.5 font-semibold">Tally ledger</th>
                <th className="px-2 py-1.5 font-semibold">Deducted on</th>
                <th className="px-2 py-1.5 font-semibold">Zoho TDS tax</th>
                <th className="px-2 py-1.5 font-semibold">Section</th>
                <th className="px-2 py-1.5 font-semibold">%</th>
                <th className="px-2 py-1.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>{view.ledgers.map(r => <TdsRow key={r.ledger} row={r} choices={choices} readOnly={readOnly} onSave={save} onDocuments={tdsOnDocuments(taxes, r.ledger)} />)}</tbody>
          </table>
        </div>
      ) : <div className="p-4 text-[14px] text-muted">No ledger has the Tally tax type TDS.</div>}
      {view.otherPartySide.length > 0 && (
        <div className="px-4 py-2 border-t border-line text-[13px] text-muted">
          Not TDS in Tally, so not in the TDS columns: {view.otherPartySide.map(o => `${o.ledger} (${plural(o.partySideVouchers, 'voucher')})`).join(', ')}.
        </div>
      )}
      {view.note && (
        <details className="border-t border-line">
          <summary className="cursor-pointer px-4 py-2 text-[13px] text-muted hover:text-ink">How TDS is written</summary>
          <p className="px-4 pb-3 text-[13px] text-muted">{view.note}</p>
        </details>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// What is written on a bill line of a registered vendor that has no GST in Tally (v2 default 12). The zero-rate tax
// is saved at once; an exemption or reverse charge needs its Zoho name first, so it is saved with a button.
function BillNoTaxSetting({ view, readOnly, onSave }) {
  const [mode, setMode] = useState(view.billNoTaxMode);
  const [code, setCode] = useState(view.billExemptionCode || '');
  const [rcName, setRcName] = useState(view.billReverseChargeName || '');
  const [rcRate, setRcRate] = useState(view.billReverseChargeRate || '');
  const [rcType, setRcType] = useState(view.billReverseChargeType || view.options.taxTypes?.[0] || '');
  useEffect(() => {
    setMode(view.billNoTaxMode); setCode(view.billExemptionCode || ''); setRcName(view.billReverseChargeName || '');
    setRcRate(view.billReverseChargeRate || ''); setRcType(view.billReverseChargeType || view.options.taxTypes?.[0] || '');
  }, [view]);
  const pick = id => { setMode(id); if (id === 'zero_tax' && view.billNoTaxMode !== 'zero_tax') onSave({ billNoTaxMode: 'zero_tax' }); };
  const changed = mode !== view.billNoTaxMode || (mode === 'exemption' && code !== (view.billExemptionCode || ''))
    || (mode === 'reverse_charge' && (rcName !== (view.billReverseChargeName || '') || rcRate !== (view.billReverseChargeRate || '') || rcType !== (view.billReverseChargeType || '')));
  const def = view.defaults?.billNoTaxMode || 'zero_tax';
  return (
    <fieldset className="space-y-2 md:col-span-2" disabled={readOnly}>
      <legend className="text-[14px] font-medium text-ink mb-1">Bill lines of a registered vendor with no GST in Tally</legend>
      {view.options.billNoTaxMode.map(o => (
        <OptionCard key={o.id} name="bill-no-tax" checked={mode === o.id} isDefault={o.id === def} byPerson={o.id !== def}
          disabled={readOnly} onChange={() => pick(o.id)} label={optionWords(o.words)} />
      ))}
      {mode === 'exemption' && (
        <label className="block"><span className="block text-[13px] text-muted mb-1">Exemption name, exactly as in Zoho Books (Settings &gt; Taxes &gt; Tax Exemptions)</span>
          <input className={inputClass} value={code} onChange={e => setCode(e.target.value)} /></label>
      )}
      {mode === 'reverse_charge' && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <label className="block"><span className="block text-[13px] text-muted mb-1">Tax name in Zoho Books</span>
            <input className={inputClass} value={rcName} onChange={e => setRcName(e.target.value)} placeholder="GST18" /></label>
          <label className="block"><span className="block text-[13px] text-muted mb-1">Rate</span>
            <input className={inputClass} value={rcRate} onChange={e => setRcRate(e.target.value)} inputMode="decimal" placeholder="18" /></label>
          <label className="block"><span className="block text-[13px] text-muted mb-1">Tax type</span>
            <select className={inputClass} value={rcType} onChange={e => setRcType(e.target.value)}>
              {(view.options.taxTypes || []).map(t => <option key={t} value={t}>{t}</option>)}
            </select></label>
        </div>
      )}
      {mode !== 'zero_tax' && (
        <button type="button" className={btnSecondary} disabled={readOnly || !changed}
          onClick={() => onSave(mode === 'exemption' ? { billNoTaxMode: mode, billExemptionCode: code } : { billNoTaxMode: mode, billReverseChargeName: rcName, billReverseChargeRate: rcRate, billReverseChargeType: rcType })}>Save</button>
      )}
      <p className="text-[13px] text-muted">{view.billNoTaxNote}</p>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The accounts Zoho Books posts the Adjustment of an invoice and of a bill to. The tool writes a journal that moves
// each Adjustment amount from these accounts back to the Tally ledger. Empty: no such journal is written.
function AdjustmentAccountsSetting({ view, readOnly, onSave }) {
  const [inv, setInv] = useState(view.invoiceAdjustmentAccount || '');
  const [bill, setBill] = useState(view.billAdjustmentAccount || '');
  useEffect(() => { setInv(view.invoiceAdjustmentAccount || ''); setBill(view.billAdjustmentAccount || ''); }, [view]);
  const changed = inv !== (view.invoiceAdjustmentAccount || '') || bill !== (view.billAdjustmentAccount || '');
  return (
    <fieldset className="space-y-2 md:col-span-2" disabled={readOnly}>
      <legend className="text-[14px] font-medium text-ink mb-1">Accounts Zoho Books uses for the Adjustment</legend>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="block"><span className="block text-[13px] text-muted mb-1">On an invoice</span>
          <input className={inputClass} value={inv} onChange={e => setInv(e.target.value)} placeholder={view.defaults?.invoiceAdjustmentAccount || ''} /></label>
        <label className="block"><span className="block text-[13px] text-muted mb-1">On a bill</span>
          <input className={inputClass} value={bill} onChange={e => setBill(e.target.value)} placeholder={view.defaults?.billAdjustmentAccount || ''} /></label>
      </div>
      <button type="button" className={btnSecondary} disabled={readOnly || !changed} onClick={() => onSave({ invoiceAdjustmentAccount: inv, billAdjustmentAccount: bill })}>Save</button>
      <p className="text-[13px] text-muted">Round-off and tax rounding go in the Adjustment column. Zoho posts that column to these accounts, which Tally does not have. The tool adds a journal to the Manual Journals file that moves each amount back to the Tally ledger, so nothing has to be typed. Change a name only if your Zoho organisation uses another account. Leave a name empty to write no journal for it.</p>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Voucher file settings: the Bill Number, and whether the documents are posted or drafts.
export function VoucherSettingsCard({ jobId, readOnly, onChanged }) {
  const [view, setView] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  useEffect(() => { api.get(`/migrations/${jobId}/voucher-settings`).then(setView).catch(e => setError(e.message)); }, [jobId]);
  // routeLock: the change of "customer and vendor payments" the server refused because the journals file of receipts
  // and payments was already downloaded or imported: { body, words }. It is made only when the person confirms.
  const [routeLock, setRouteLock] = useState(null);
  const save = async body => {
    setBusy(true); setError(''); setDone(''); setRouteLock(null);
    try {
      const r = await api.put(`/migrations/${jobId}/voucher-settings`, body);
      setView(r);
      setDone(r.changed ? 'Saved. Create the files again in the Export Center.' : 'Nothing changed.');
      onChanged?.();
    } catch (e) {
      if (e.status === 409 && e.data?.routeLocked) setRouteLock({ body, words: e.message });
      else setError(e.message);
    } finally { setBusy(false); }
  };
  if (!view) return <Loading title="Voucher files" error={error} />;
  const choice = (name, field, legend) => (
    <SettingChoice name={name} legend={legend} options={view.options[field]} value={view[field] ?? view.defaults?.[field]} defaultValue={view.defaults?.[field]}
      disabled={readOnly || busy} onChange={id => save({ [field]: id })} />
  );
  return (
    <Card title="Voucher files" subtitle="How the Invoices, Bills and Manual Journals files are written. Each setting has a default; change one only if you need to."
      right={<AcceptAsTally jobId={jobId} stepKey="voucher_files" readOnly={readOnly} onChanged={onChanged} />}>
      {readOnly && <div className="px-4 pt-3 text-[13px] text-muted">View only: you can see the settings but not change them.</div>}
      <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          {choice('bill-number', 'billNumber', 'Bill Number')}
          <p className="text-[13px] text-muted">{plural(view.vouchersWithSupplierReference, 'purchase or journal voucher')} in Tally {view.vouchersWithSupplierReference === 1 ? 'has' : 'have'} a supplier's invoice number. A voucher without one keeps its Tally number.</p>
        </div>
        <div className="space-y-2">
          {choice('doc-status', 'documentStatus', 'Status of the documents')}
          <p className="text-[13px] text-muted">An import never emails anyone. Drafts are not posted to the accounts, so the balances in Zoho Books would not match Tally until they are approved.</p>
        </div>
        {view.options.outOfYear && (
          <div className="space-y-2">
            {choice('out-of-year', 'outOfYear', 'Vouchers dated outside the financial year')}
            <p className="text-[13px] text-muted">Left out vouchers are counted and listed in Voucher Reconciliation.</p>
          </div>
        )}
        {view.options.billNoTaxMode && <BillNoTaxSetting view={view} readOnly={readOnly || busy} onSave={save} />}
        {view.options.tdsAct && (
          <div className="space-y-2">
            {choice('tds-act', 'tdsAct', 'Form of the TDS section code')}
            <p className="text-[13px] text-muted">Zoho refuses a TDS row without a section code. The tax act changes on {view.tdsActCutover || '2026-04-01'}. If your Zoho TDS export is given in the Import Wizard, its own codes are used as they are.</p>
          </div>
        )}
        {view.options.tdsBase && (
          <div className="space-y-2">
            {choice('tds-base', 'tdsBase', 'What the TDS percentage is checked on')}
            <p className="text-[13px] text-muted">Tally's TDS amount is written in the file and Zoho keeps it. The percentage is only checked against this base, and a document where it does not fit is flagged.</p>
          </div>
        )}
        {view.options.rcmUnknownState && (
          <div className="space-y-2">
            {choice('rcm-unknown', 'rcmUnknownState', 'Reverse charge on a vendor with no state')}
            <p className="text-[13px] text-muted">Zoho refuses IGST on a supply inside one state. Where the states are known the tool picks GST or IGST from them. This decides only the case where the vendor has no state and Tally booked IGST.</p>
          </div>
        )}
        {view.options.recomputeDiffPolicy && (
          <div className="space-y-2">
            {choice('recompute-diff', 'recomputeDiffPolicy', 'Rounding differences in tax')}
            <p className="text-[13px] text-muted">Zoho works the tax out itself from the rate. A difference of up to one rupee per tax line is written in the Adjustment column so the document total equals Tally's. A bigger difference is always only flagged.</p>
          </div>
        )}
        {view.options.zohoTaxRounding && (
          <div className="space-y-2">
            {choice('zoho-tax-rounding', 'zohoTaxRounding', 'How Zoho Books rounds the tax')}
            <p className="text-[13px] text-muted">Look in Zoho Books under Settings &gt; Taxes. The rounding differences are worked out the same way Zoho does it.</p>
          </div>
        )}
        {'invoiceAdjustmentAccount' in view && <AdjustmentAccountsSetting view={view} readOnly={readOnly || busy} onSave={save} />}
        {view.options.paymentsRoute && (
          <div className="space-y-2 md:col-span-2" id="payments-route">
            {choice('payments-route', 'paymentsRoute', 'Receipts from customers, payments to vendors, debit and credit notes')}
            <p className="text-[13px] text-muted">As Manual Journals every voucher is in a file now, and the balances match Tally at once. The list credits_to_apply.csv says which invoice or bill each one pays. Choose Zoho's Payments files only when you have Zoho's import sample for them: until the file is built from it, those vouchers are in no file. A voucher is never in both.</p>
            {routeLock && (
              <div role="alert" className="p-3 rounded-md border border-warning-line bg-warning-soft text-[14px] space-y-2">
                <p>{routeLock.words}</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={btnSecondary} disabled={readOnly || busy} onClick={() => save({ ...routeLock.body, journalsDeletedInZoho: true })}>The journals are not in Zoho Books: change it</button>
                  <button type="button" className={btnSecondary} disabled={busy} onClick={() => setRouteLock(null)}>Keep it as it is</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="px-4 pb-4 space-y-1">
        {view.decidedBy && <p className="text-[13px] text-muted">Last changed by {view.decidedBy}{view.at ? `, ${readableWhen(view.at)}` : ''}.</p>}
        <Message error={error} done={done} />
      </div>
    </Card>
  );
}
