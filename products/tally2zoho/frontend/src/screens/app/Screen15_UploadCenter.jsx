import React, { useCallback, useRef, useState } from 'react';
import { Upload, CheckCircle2, RefreshCw, Trash2, ArrowRight, AlertTriangle, Info, FileWarning, Loader2 } from 'lucide-react';
import { api, useJob, formatSize, isProcessing, useProcessStatus, PROCESS_ACTIVE } from '../../api';
import JobHeader from '../../components/JobHeader';
import HelpTip from '../../components/HelpTip';
import { Note, StatusChip, btnPrimary, btnSecondary, btnSmall } from '../../components/ui';
import { ALL_MASTERS_HELP, ALL_MASTERS_STEPS, ALL_TRANSACTIONS_HELP, ALL_TRANSACTIONS_STEPS, COMMON_STEPS, FILE_DETAIL_HELP, TRIAL_BALANCE_STEPS, UPLOAD_HELP, uploadProgress, uploadProgressWords, zohoTargetWords } from './uploadHelp';

const REQUIREMENT_LABEL = { required: 'Required', conditional: 'If applicable', optional: 'Optional' };

// How the records of one dataset are counted, in words ("274 customers").
const COUNT_WORDS = { customers: ['customer', 'customers'], vendors: ['vendor', 'vendors'], accounts: ['ledger', 'ledgers'], taxes: ['tax ledger', 'tax ledgers'],
  stock_items: ['stock item', 'stock items'], units: ['unit', 'units'] };
const countText = (slot, n) => `${n.toLocaleString()} ${(COUNT_WORDS[slot] || ['record', 'records'])[n === 1 ? 0 : 1]}`;

function AllMastersHelp() {
  const Section = ({ title, children }) => (
    <div className="mt-3 first:mt-0">
      <div className="text-[13px] font-semibold text-ink">{title}</div>
      {children}
    </div>
  );
  return (
    <div className="text-[13px] leading-snug text-muted">
      <Section title="What goes in this file"><p className="mt-0.5">{ALL_MASTERS_HELP.contains}</p></Section>
      <Section title="How to export (TallyPrime 7.1)">
        <ol className="mt-0.5 list-decimal pl-4 space-y-0.5">{ALL_MASTERS_STEPS.map(t => <li key={t}>{t}</li>)}</ol>
        <p className="mt-1 text-subtle">Tally saves this file in UTF-16. That is fine: the platform reads it as it is.</p>
      </Section>
      <Section title="Where each record goes">
        <ul className="mt-0.5 list-disc pl-4 space-y-0.5">{ALL_MASTERS_HELP.split.map(t => <li key={t}>{t}</li>)}</ul>
      </Section>
      <Section title="What we check">
        <ul className="mt-0.5 list-disc pl-4 space-y-0.5">{ALL_MASTERS_HELP.checks.map(t => <li key={t}>{t}</li>)}</ul>
      </Section>
      <Section title="If you also upload single files"><p className="mt-0.5">{ALL_MASTERS_HELP.replace}</p></Section>
      <Section title="Tip"><p className="mt-0.5">{ALL_MASTERS_HELP.tip}</p></Section>
    </div>
  );
}

// "All masters in one file": one Tally export that fills the six master datasets.
function AllMastersCard({ info, jobId, onChange, locked, readOnly }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const disabled = busy || locked || readOnly;
  const run = async fn => {
    setBusy(true); setError('');
    try { await fn(); await onChange(); } catch (err) { setError(err.message); if (err.status === 409) await onChange(); } finally { setBusy(false); }
  };
  const pick = e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) run(() => api.upload(jobId, 'all_masters', file));
  };
  const remove = () => {
    if (!window.confirm('Remove the All Masters file? The datasets that came from it are removed too. Datasets you uploaded on their own are kept.')) return;
    run(() => api.del(`/migrations/${jobId}/uploads/all_masters`));
  };
  const inUse = info?.datasets.filter(d => d.current) || [];

  return (
    <section aria-labelledby="all-masters-title" className={`p-4 rounded-lg shadow-xs border bg-white ${error ? 'border-danger-line' : 'border-line'}`}>
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 id="all-masters-title" className="text-[15px] font-semibold text-ink">All masters in one file</h2>
            <HelpTip label="Help for All masters in one file"><AllMastersHelp /></HelpTip>
            <StatusChip>Optional</StatusChip>
          </div>
          <p className="text-[14px] text-muted mt-1 max-w-3xl">
            One export from Tally (Export &gt; Masters &gt; All Masters) fills Customer Master, Vendor Master, Chart of Accounts, Tax Configuration,
            Stock Items and Units for you. You can still upload any of them on its own below; the file uploaded last wins for that dataset.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 text-[14px]">
          <input ref={input} type="file" accept=".json,application/json" className="hidden" onChange={pick} />
          <button onClick={() => input.current?.click()} disabled={disabled}
            className={info ? btnSecondary : btnPrimary}>
            {info ? <RefreshCw className="w-4 h-4" aria-hidden="true" /> : <Upload className="w-4 h-4" aria-hidden="true" />}
            <span>{busy ? 'Reading the file…' : info ? 'Replace' : 'Choose All Masters file'}</span>
          </button>
          {info && (
            <button onClick={remove} disabled={disabled} className={`${btnSecondary} text-danger-ink`}>
              <Trash2 className="w-4 h-4" aria-hidden="true" /><span>Remove</span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div role="alert" className="mt-3">
          <Note tone="danger"><strong>That did not work.</strong> {error}</Note>
        </div>
      )}

      {info && (
        <div className="mt-3 bg-soft border border-line rounded p-3 text-[13px] space-y-2">
          <div className="flex items-center gap-2 text-ink font-medium">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-success" aria-hidden="true" />
            <span className="truncate">{info.fileName}</span>
          </div>
          <div className="text-muted">
            {info.records.toLocaleString()} records · {formatSize(info.size)} · saved by Tally in {info.encodingName}, which the platform reads as it is
          </div>
          <div className="text-subtle font-mono text-[13px]" title={info.sha256}>Checksum {info.sha256.slice(0, 16)}…</div>

          <div>
            <div className="font-medium text-ink">Where the records went</div>
            <p className="text-muted">Compare these numbers with Tally. You can enter Tally's numbers in Completeness Check.</p>
            <ul className="mt-1 border border-line rounded bg-white divide-y divide-line">
              {info.datasets.map(d => (
                <li key={d.slot} className="px-2.5 py-1.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                  <span className="text-ink">{d.name}</span>
                  <span className="text-muted sm:text-right">
                    <span className="tabular-nums text-ink">{countText(d.slot, d.mainRecords)}</span>
                    {d.groups > 0 && <span> and {d.groups.toLocaleString()} groups</span>}
                    {!d.current && <span className="block">{d.replacedBy ? `Replaced by "${d.replacedBy}", uploaded on its own later` : 'Removed later'}</span>}
                  </span>
                </li>
              ))}
            </ul>
            {inUse.length < info.datasets.length && <p className="mt-1 text-muted">Datasets replaced or removed later are not taken from this file.</p>}
          </div>

          {info.autoNotApplicable.length > 0 && (
            <div className="flex items-start gap-2 text-ink">
              <Info className="w-4 h-4 shrink-0 mt-0.5 text-info-ink" strokeWidth={1.75} aria-hidden="true" />
              <span>Marked not applicable for you: {info.autoNotApplicable.map(a => a.name).join(', ')}. The reason is shown in Completeness Check, where you can undo it.</span>
            </div>
          )}
          {info.messages.filter(m => !/marked not applicable automatically/.test(m)).map(m => (
            <div key={m} className="flex items-start gap-2 text-ink">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-warning-ink" aria-hidden="true" />
              <span>{m}</span>
            </div>
          ))}
          {info.notUsed.length > 0 && (
            <div className="text-muted">
              <span className="font-medium text-ink">Kept for reference, not used: </span>
              {info.notUsed.map(x => `${x.records.toLocaleString()} ${x.type}`).join(', ')}.
              {' '}These lists are not needed in Zoho Books. This is not an error.
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function AllTransactionsHelp() {
  const Section = ({ title, children }) => (
    <div className="mt-3 first:mt-0">
      <div className="text-[13px] font-semibold text-ink">{title}</div>
      {children}
    </div>
  );
  return (
    <div className="text-[13px] leading-snug text-muted">
      <Section title="What goes in this file"><p className="mt-0.5">{ALL_TRANSACTIONS_HELP.contains}</p></Section>
      <Section title="How to export (TallyPrime 7.1)">
        <ol className="mt-0.5 list-decimal pl-4 space-y-0.5">{ALL_TRANSACTIONS_STEPS.map(t => <li key={t}>{t}</li>)}</ol>
        <p className="mt-1 text-subtle">Tally saves this file in UTF-16. That is fine: the platform reads it as it is.</p>
      </Section>
      <Section title="Where each voucher goes">
        <ul className="mt-0.5 list-disc pl-4 space-y-0.5">{ALL_TRANSACTIONS_HELP.split.map(t => <li key={t}>{t}</li>)}</ul>
      </Section>
      <Section title="What we check">
        <ul className="mt-0.5 list-disc pl-4 space-y-0.5">{ALL_TRANSACTIONS_HELP.checks.map(t => <li key={t}>{t}</li>)}</ul>
      </Section>
      <Section title="If you also upload single files"><p className="mt-0.5">{ALL_TRANSACTIONS_HELP.replace}</p></Section>
      <Section title="Tip"><p className="mt-0.5">{ALL_TRANSACTIONS_HELP.tip}</p></Section>
    </div>
  );
}

// "All transactions in one file": one Tally export that fills the voucher datasets, sorted by voucher type.
function AllTransactionsCard({ info, jobId, onChange, locked, readOnly }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const disabled = busy || locked || readOnly;
  const run = async fn => {
    setBusy(true); setError('');
    try { await fn(); await onChange(); } catch (err) { setError(err.message); if (err.status === 409) await onChange(); } finally { setBusy(false); }
  };
  const pick = e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) run(() => api.upload(jobId, 'all_transactions', file));
  };
  const remove = () => {
    if (!window.confirm('Remove the All Transactions file? The voucher datasets that came from it are removed too, and voucher types it showed as empty are needed again. Datasets you uploaded on their own are kept.')) return;
    run(() => api.del(`/migrations/${jobId}/uploads/all_transactions`));
  };
  const flagged = info ? Object.entries(info.statuses || {}).filter(([, n]) => n > 0) : [];

  return (
    <section aria-labelledby="all-transactions-title" className={`p-4 rounded-lg shadow-xs border bg-white ${error ? 'border-danger-line' : 'border-line'}`}>
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 id="all-transactions-title" className="text-[15px] font-semibold text-ink">All transactions in one file</h2>
            <HelpTip label="Help for All transactions in one file"><AllTransactionsHelp /></HelpTip>
            <StatusChip>Optional</StatusChip>
          </div>
          <p className="text-[14px] text-muted mt-1 max-w-3xl">
            One export from Tally (Export &gt; Transactions, for the full financial year) holds every voucher. The platform sorts it by voucher type into
            Sales, Purchase, Receipt, Payment, Journal, Contra, Debit Notes and Credit Notes. You can still upload any of them on its own below; the file
            uploaded last wins for that dataset.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 text-[14px]">
          <input ref={input} type="file" accept=".json,application/json" className="hidden" onChange={pick} />
          <button onClick={() => input.current?.click()} disabled={disabled}
            className={info ? btnSecondary : btnPrimary}>
            {info ? <RefreshCw className="w-4 h-4" aria-hidden="true" /> : <Upload className="w-4 h-4" aria-hidden="true" />}
            <span>{busy ? 'Reading the file…' : info ? 'Replace' : 'Choose All Transactions file'}</span>
          </button>
          {info && (
            <button onClick={remove} disabled={disabled} className={`${btnSecondary} text-danger-ink`}>
              <Trash2 className="w-4 h-4" aria-hidden="true" /><span>Remove</span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div role="alert" className="mt-3">
          <Note tone="danger"><strong>That did not work.</strong> {error}</Note>
        </div>
      )}

      {info && (
        <div className="mt-3 bg-soft border border-line rounded p-3 text-[13px] space-y-2">
          <div className="flex items-center gap-2 text-ink font-medium">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-success" aria-hidden="true" />
            <span className="truncate">{info.fileName}</span>
          </div>
          <div className="text-muted">
            {info.vouchers.toLocaleString()} vouchers · {formatSize(info.size)} · saved by Tally in {info.encodingName}, which the platform reads as it is
          </div>
          <div className="text-subtle font-mono text-[13px]" title={info.sha256}>Checksum {info.sha256.slice(0, 16)}…</div>

          <div>
            <div className="font-medium text-ink">Where the vouchers went</div>
            <p className="text-muted">Compare these numbers with the voucher counts in Tally. You can enter Tally's numbers in Completeness Check.</p>
            <ul className="mt-1 border border-line rounded bg-white divide-y divide-line">
              {info.datasets.map(d => {
                const own = d.types.filter(t => t.how === 'master');
                return (
                  <li key={d.slot} className="px-2.5 py-1.5 flex flex-col sm:flex-row sm:items-start justify-between gap-1">
                    <span className="text-ink">
                      {d.name}
                      {d.noZohoFile && d.records > 0 && <span className="block text-muted">Read and kept; no Zoho file is created for these yet.</span>}
                      {own.length > 0 && <span className="block text-muted">Includes your own voucher {own.length === 1 ? 'type' : 'types'}: {own.map(t => `${t.type} (${t.vouchers.toLocaleString()})`).join(', ')}</span>}
                    </span>
                    <span className="text-muted sm:text-right shrink-0">
                      <span className="tabular-nums text-ink">{d.records.toLocaleString()} {d.records === 1 ? 'voucher' : 'vouchers'}</span>
                      {d.records === 0 && <span className="block">{d.ownFile ? `None in this file. Your own file "${d.ownFile}" is used` : 'None in this file'}</span>}
                      {d.records > 0 && !d.current && <span className="block">{d.replacedBy ? `Replaced by "${d.replacedBy}", uploaded on its own later` : 'Removed later'}</span>}
                      {d.notPlaced > 0 && <span className="block text-ink font-medium">{d.notPlaced.toLocaleString()} of these {d.notPlaced === 1 ? 'is' : 'are'} in no dataset</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          {info.notPlaced?.length > 0 && (
            <div className="flex items-start gap-2 text-ink">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-warning-ink" aria-hidden="true" />
              <span>
                <strong>{info.control.notPlaced.toLocaleString()} voucher{info.control.notPlaced === 1 ? '' : 's'} of this file {info.control.notPlaced === 1 ? 'is' : 'are'} in no dataset.</strong>
                {' '}When the file was sorted again after the All Masters file changed, {info.control.notPlaced === 1 ? 'it moved' : 'they moved'} to a dataset that holds a file uploaded on its own, or that was removed later
                {' '}({info.notPlaced.map(n => `${n.name}: ${n.vouchers.toLocaleString()}`).join(', ')}). That file or removal was kept. Upload this All Transactions file again to sort every voucher into its dataset.
              </span>
            </div>
          )}
          {info.autoNotApplicable.length > 0 && (
            <div className="flex items-start gap-2 text-ink">
              <Info className="w-4 h-4 shrink-0 mt-0.5 text-info-ink" strokeWidth={1.75} aria-hidden="true" />
              <span>
                This file has no vouchers of these types, so they were marked not applicable for you: {info.autoNotApplicable.map(a => a.name).join(', ')}.
                {' '}The file holds every voucher of the year, so nothing is missing. The reason is shown in Completeness Check, where you can undo it.
              </span>
            </div>
          )}
          {info.unresolvedTypes.length > 0 && (
            <div className="flex items-start gap-2 text-ink">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-warning-ink" aria-hidden="true" />
              <span>
                {info.unresolvedTypes.length === 1 ? 'One voucher type' : `${info.unresolvedTypes.length} voucher types`} could not be traced to one of Tally's own voucher types:
                {' '}{info.unresolvedTypes.map(t => `${t.type} (${t.vouchers.toLocaleString()})`).join(', ')}. Nothing was guessed: the vouchers are kept under Other Voucher Types.
                {!info.mastersUsed && ' Upload the All Masters file, which lists your voucher types. The vouchers are then sorted again for you.'}
              </span>
            </div>
          )}
          {info.otherTallyTypes.length > 0 && (
            <div className="text-muted">
              <span className="font-medium text-ink">Voucher types with no dataset: </span>
              {info.otherTallyTypes.map(t => `${t.type} (${t.vouchers.toLocaleString()})`).join(', ')}. They are kept under Other Voucher Types; no Zoho file is created for these yet.
            </div>
          )}
          {flagged.length > 0 && (
            <div className="flex items-start gap-2 text-ink">
              <Info className="w-4 h-4 shrink-0 mt-0.5 text-info-ink" strokeWidth={1.75} aria-hidden="true" />
              <span>{flagged.map(([s, n]) => `${n.toLocaleString()} ${s}`).join(', ')} voucher(s) are kept and counted, but they are never written to a Zoho file.</span>
            </div>
          )}
          {info.messages.filter(m => /was replaced by the vouchers from this file|is kept\.$|were removed\.$|says company/.test(m)).map(m => (
            <div key={m} className="flex items-start gap-2 text-ink">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-warning-ink" aria-hidden="true" />
              <span>{m}</span>
            </div>
          ))}
          {info.notUsed.length > 0 && (
            <div className="text-muted">
              <span className="font-medium text-ink">Not vouchers, not used: </span>
              {info.notUsed.map(x => `${x.records.toLocaleString()} ${x.type}`).join(', ')}. This is not an error.
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// Content of the help panel for one dataset (export steps, checks, and where it goes in Zoho Books).
function SlotHelp({ slot }) {
  const h = UPLOAD_HELP[slot.key];
  if (!h) return <p className="text-[14px] text-muted">{slot.desc}</p>;
  const Section = ({ title, children }) => (
    <div className="mt-3 first:mt-0">
      <div className="text-[13px] font-semibold text-ink">{title}</div>
      {children}
    </div>
  );
  return (
    <div className="text-[13px] leading-snug text-muted">
      <Section title="What goes in this file"><p className="mt-0.5">{h.contains}</p></Section>
      <Section title="Tally report to export"><p className="mt-0.5">{slot.report}</p></Section>
      {slot.key === 'trial_balance' ? (
        <Section title="How to export (TallyPrime 7.1)">
          <ol className="mt-0.5 list-decimal pl-4 space-y-0.5">{TRIAL_BALANCE_STEPS.map(t => <li key={t}>{t}</li>)}</ol>
          <p className="mt-1 text-subtle">Tally saves this file in UTF-16. That is fine: the platform reads it as it is.</p>
        </Section>
      ) : (
        <Section title="How to export">
          <ol className="mt-0.5 list-decimal pl-4 space-y-0.5">{COMMON_STEPS.map(t => <li key={t}>{t}</li>)}</ol>
          <p className="mt-1 text-subtle">
            {slot.category === 'Vouchers'
              ? 'You do not need this file if you upload "All transactions in one file" above: that one export holds every voucher type.'
              : 'Menu names can differ between Tally versions. Follow your version\'s Export option.'}
          </p>
        </Section>
      )}
      <Section title="What we check">
        <ul className="mt-0.5 list-disc pl-4 space-y-0.5">{h.checks.map(t => <li key={t}>{t}</li>)}</ul>
      </Section>
      <Section title="Goes to Zoho Books"><p className="mt-0.5">{zohoTargetWords(slot.zoho)}</p></Section>
      <Section title="Tip"><p className="mt-0.5">{h.tip}</p></Section>
      <Section title="After you upload">
        <dl className="mt-0.5 space-y-0.5">
          {FILE_DETAIL_HELP.map(([k, v]) => <div key={k}><dt className="inline font-medium text-ink">{k}: </dt><dd className="inline">{v}</dd></div>)}
        </dl>
      </Section>
    </div>
  );
}

// One missing or patchy field the platform reads, with what it is used for and similar names found in the file.
function KeyFieldLine({ f, strong }) {
  const what = `${f.total.toLocaleString()} ${f.recordType} record${f.total === 1 ? '' : 's'}`;
  return (
    <li className="py-2 first:pt-0 last:pb-0">
      <div className={strong ? 'text-ink' : 'text-muted'}>
        <span className="font-mono text-ink break-all">{f.field}</span>
        {' '}
        {f.status === 'absent' ? `has no value in any of the ${what}.` : `has a value in ${f.present.toLocaleString()} of the ${what}.`}
      </div>
      {f.description && <div className="text-muted">Used for {f.description}.</div>}
      {f.status === 'absent' && !strong && <div className="text-muted">This can be correct if Tally holds no such values.</div>}
      {f.status === 'absent' && (
        f.similar?.length > 0 ? (
          <div className="text-muted">
            Similar names found in your file:{' '}
            {f.similar.map((n, i) => (
              <React.Fragment key={n}>
                {i > 0 && ', '}
                <span className="font-mono text-ink break-all">{n}</span>
              </React.Fragment>
            ))}
          </div>
        ) : strong && <div className="text-muted">No field with a similar name was found in your file.</div>
      )}
    </li>
  );
}

// What the upload check found about the fields the platform needs. Information only: it never blocks anything.
function KeyFields({ kf }) {
  const [notesOpen, setNotesOpen] = useState(false);
  if (!kf) return null;
  const missing = kf.fields.filter(f => f.severity === 'warning');
  const notes = kf.fields.filter(f => f.severity === 'info');
  return (
    <>
      {(kf.mayNotBeReadable || missing.length > 0) && (
        <div role="status" className="mt-2 rounded-md border border-warning-line bg-warning-soft p-3">
          <div className="flex items-start gap-2">
            <FileWarning className="w-4 h-4 shrink-0 mt-0.5 text-warning-ink" strokeWidth={1.75} aria-hidden="true" />
            <div className="min-w-0">
              <div className="font-semibold text-ink">
                {kf.mayNotBeReadable ? 'This file may not be readable' : `${missing.length === 1 ? 'A field' : `${missing.length} fields`} the platform needs ${missing.length === 1 ? 'is' : 'are'} missing`}
              </div>
              <p className="mt-0.5 text-muted">
                {kf.mayNotBeReadable
                  ? 'None of the records has the fields the platform needs. The Tally export probably uses different field names. The file was kept and nothing is blocked, but little or nothing may be taken from it. Check the export before you continue.'
                  : 'No record in this file has a value in the field below. The export may use a different name. The file was kept and nothing was changed or guessed.'}
              </p>
            </div>
          </div>
          {missing.length > 0 && (
            <ul className="mt-2 pt-2 border-t border-line divide-y divide-line">
              {missing.map(f => <KeyFieldLine key={`${f.recordType}-${f.field}`} f={f} strong />)}
            </ul>
          )}
        </div>
      )}
      {notes.length > 0 && (
        <details className="pt-1" onToggle={e => setNotesOpen(e.currentTarget.open)}>
          <summary className="cursor-pointer text-muted flex items-center gap-2">
            <Info className="w-4 h-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
            <span>{notes.length === 1 ? '1 note' : `${notes.length} notes`} about fields that are empty in some or all records</span>
            <span className="text-subtle underline">{notesOpen ? 'Hide' : 'Show'}</span>
          </summary>
          <ul className="mt-2 rounded-lg border border-line bg-white px-2.5 py-2 divide-y divide-line">
            {notes.map(f => <KeyFieldLine key={`${f.recordType}-${f.field}`} f={f} />)}
          </ul>
        </details>
      )}
    </>
  );
}

function Slot({ index, slot, jobId, onChange, locked, readOnly }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [namesOpen, setNamesOpen] = useState(false);
  const up = slot.upload;
  const types = Object.entries(up?.recordTypes || {});
  const notRead = up?.fieldsNotRead || null; // null for files uploaded before this was recorded
  const kf = up?.keyFields || null; // null for files uploaded before key fields were checked
  // The key-field warnings are also in the general warnings; they are shown once, with their details.
  const kfWarnings = new Set(kf?.warnings || []);
  // The description of a Tally Trial Balance report is shown in its own box below, not as a warning.
  const otherWarnings = (up?.warnings || []).filter(w => !kfWarnings.has(w) && w !== up?.trialBalance?.description);
  const disabled = busy || locked || readOnly;

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      await api.upload(jobId, slot.key, file);
      await onChange();
    } catch (err) {
      setError(err.message);
      if (err.status === 409) await onChange(); // processing started meanwhile: show it
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setError('');
    try {
      await api.del(`/migrations/${jobId}/uploads/${slot.key}`);
      await onChange();
    } catch (err) {
      setError(err.message);
      if (err.status === 409) await onChange();
    }
  };

  return (
    <div className={`relative p-4 rounded-lg shadow-xs border bg-white flex flex-col justify-between ${error ? 'border-danger-line' : 'border-line'}`}>
      <div>
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-6 h-6 rounded-full bg-brand-soft text-info-ink text-[12px] font-semibold flex items-center justify-center shrink-0">{index}</span>
            <h3 className="text-[14px] font-semibold text-ink truncate" title={slot.name}>{slot.name}</h3>
            <HelpTip label={`Help for ${slot.name}`}>
              <SlotHelp slot={slot} />
            </HelpTip>
          </div>
          <span className="shrink-0"><StatusChip tone={slot.requirement === 'required' ? 'info' : 'neutral'}>{REQUIREMENT_LABEL[slot.requirement] || 'If applicable'}</StatusChip></span>
        </div>
        <p className="text-[13px] text-muted mb-1">{slot.desc}</p>
        {slot.noZohoFile
          ? <p className="text-[13px] text-ink mb-3">No Zoho file yet. {['taxes', 'units', 'stock_summary'].includes(slot.key) ? 'Read and used for checks.' : 'Read and kept; no Zoho file is created for these yet.'}</p>
          : <p className="text-[13px] text-subtle mb-3">Goes to Zoho: {zohoTargetWords(slot.zoho)}</p>}

        {up ? (
          <div className="bg-soft border border-line rounded p-3 text-[13px] space-y-1 mb-3">
            <div className="flex items-center gap-2 text-ink font-medium">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-success" aria-hidden="true" />
              <span className="truncate">{up.fileName}</span>
            </div>
            {up.fromAllMasters && <div className="text-ink">Taken from the All Masters file above.</div>}
            {up.fromAllTransactions && <div className="text-ink">Taken from the All Transactions file above.</div>}
            {up.trialBalance && (
              <div className="rounded border border-line bg-white p-2.5 text-muted">
                <div className="font-medium text-ink">Tally Trial Balance report</div>
                <ul className="mt-1 space-y-0.5">
                  <li><span className="tabular-nums text-ink">{up.trialBalance.lines.toLocaleString()}</span> lines read, in {up.trialBalance.levels} {up.trialBalance.levels === 1 ? 'level' : 'levels'}</li>
                  {up.trialBalance.mastersAvailable ? (
                    <>
                      <li><span className="tabular-nums text-ink">{up.trialBalance.ledgers.toLocaleString()}</span> are ledgers, <span className="tabular-nums text-ink">{up.trialBalance.groups.toLocaleString()}</span> are groups{up.trialBalance.unmatched > 0 && <>, <span className="tabular-nums text-ink">{up.trialBalance.unmatched.toLocaleString()}</span> could not be matched</>}</li>
                      <li className="text-ink">
                        {up.trialBalance.atLedgerLevel
                          ? 'Every ledger is listed, so the Opening Balances file can be created.'
                          : `Not every ledger is listed: ${up.trialBalance.lowestGroups.toLocaleString()} of the lowest lines are groups. No Opening Balances file can be created from this report. In Tally press Alt+F5 for the detailed view and export it again.`}
                      </li>
                    </>
                  ) : <li>No masters were uploaded yet, so the lines are matched to ledgers and groups when the data is processed.</li>}
                  <li>Opening balances {up.trialBalance.totals.openingBalanced ? 'balance' : 'do not balance'}; closing balances {up.trialBalance.totals.closingBalanced ? 'balance' : 'do not balance'}.</li>
                </ul>
                <p className="mt-1">The debits and credits of each line are compared with your vouchers when the data is processed.</p>
              </div>
            )}
            <div className="text-muted">
              {up.records.toLocaleString()} records
              {types.length > 1 && ` (${types.map(([t, n]) => `${n.toLocaleString()} ${t}`).join(', ')})`} · {formatSize(up.size)}
            </div>
            <div className="text-subtle font-mono text-[13px]" title={up.sha256}>Checksum {up.sha256.slice(0, 16)}…</div>
            {otherWarnings.map((w, i) => (
              <div key={i} className="flex items-start gap-2 text-ink pt-1">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-warning-ink" aria-hidden="true" />
                <span>{w}</span>
              </div>
            ))}
            {slot.countMatches === false && (
              <div className="flex items-start gap-2 text-ink pt-1">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-warning-ink" aria-hidden="true" />
                <span>
                  The count entered from Tally is {slot.expectedCount.toLocaleString()}, but this file has {slot.actualCount.toLocaleString()}.
                  Processing is blocked until they agree. Replace the file, or correct the number in Completeness Check.
                </span>
              </div>
            )}
            {slot.countMatches === true && <div className="text-muted">Record count agrees with the count entered from Tally.</div>}
            <KeyFields kf={kf} />
            {notRead && notRead.count === 0 && (
              <div className="text-muted">
                The platform uses every field found in this file. Some are used only for checks, such as the Tally group, and are not written to Zoho Books.
              </div>
            )}
            {notRead && notRead.note && <div className="text-muted">{notRead.note}</div>}
            {notRead && notRead.count > 0 && (
              <details className="pt-1" onToggle={e => setNamesOpen(e.currentTarget.open)}>
                <summary className="cursor-pointer text-ink font-medium flex items-center gap-2">
                  <Info className="w-4 h-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                  <span>{notRead.count.toLocaleString()} {notRead.count === 1 ? 'field in this file is' : 'fields in this file are'} not transferred</span>
                  <span className="text-subtle font-normal underline">{namesOpen ? 'Hide names' : 'Show names'}</span>
                </summary>
                <div className="mt-2 text-muted">
                  <p>
                    This is for your information only. It is not an error and nothing is blocked. These fields are in the Tally file,
                    but the platform does not use them, so they will not reach Zoho Books. Of the other fields in the file, some are
                    used only for checks and are also not written to Zoho Books.
                  </p>
                  {notRead.groups ? (
                    // voucher files carry many fields: they are shown in groups, each opened on its own
                    <div className="mt-2 border border-line rounded bg-white divide-y divide-line">
                      {notRead.groups.map(g => (
                        <details key={g.name}>
                          <summary className="cursor-pointer px-2.5 py-1.5 flex items-center justify-between gap-3 text-ink">
                            <span>{g.name}</span>
                            <span className="shrink-0 tabular-nums text-muted">{g.fields.length} {g.fields.length === 1 ? 'field' : 'fields'}</span>
                          </summary>
                          <ul className="max-h-40 overflow-y-auto border-t border-line divide-y divide-line">
                            {g.fields.map(f => (
                              <li key={f.name} className="px-2.5 py-1.5 flex items-center justify-between gap-3">
                                <span className="font-mono text-ink break-all min-w-0">{f.name}</span>
                                <span className="shrink-0 tabular-nums">in {f.records.toLocaleString()} record(s)</span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      ))}
                    </div>
                  ) : (
                    <>
                      <ul className="mt-2 max-h-40 overflow-y-auto border border-line rounded bg-white divide-y divide-line">
                        {notRead.fields.map(f => (
                          <li key={f.name} className="px-2.5 py-1.5 flex items-center justify-between gap-3">
                            <span className="min-w-0">
                              <span className="font-mono text-ink break-all">{f.name}</span>
                              {f.likeField && <span className="block">Written with capital letters. The platform reads "{f.likeField}" in small letters only.</span>}
                            </span>
                            <span className="shrink-0 tabular-nums">in {f.records.toLocaleString()} record(s)</span>
                          </li>
                        ))}
                      </ul>
                      {notRead.count > notRead.fields.length && (
                        <p className="mt-1.5">Showing the {notRead.fields.length} most common of {notRead.count.toLocaleString()} fields.</p>
                      )}
                    </>
                  )}
                </div>
              </details>
            )}
          </div>
        ) : (
          <div className="border border-dashed border-line-strong rounded-md bg-soft p-3 text-center mb-3 text-muted text-[13px]">
            {slot.status === 'not_applicable' ? 'Marked not applicable' : slot.requirement === 'optional' ? 'No file uploaded. This dataset is optional and does not block processing.' : 'No file uploaded yet'}
            {slot.autoNotApplicable && slot.waiver && <span className="block mt-1 text-muted text-left">{slot.waiver.reason}</span>}
          </div>
        )}

        {error && (
          <div role="alert" className="mb-3">
            <Note tone="danger"><strong>That did not work.</strong> {error}</Note>
          </div>
        )}
      </div>

      <input ref={input} type="file" accept=".json,application/json" className="hidden" onChange={pick} />
      {locked && !readOnly && <p className="text-[13px] text-muted mb-2">Paused while your files are being read.</p>}
      <div className="flex items-center justify-between gap-2 text-[14px]">
        <button
          onClick={() => input.current?.click()}
          disabled={disabled}
          className={`${up ? btnSecondary : `${btnPrimary} flex-1`} ${btnSmall}`}
        >
          {up ? <RefreshCw className="w-4 h-4" aria-hidden="true" /> : <Upload className="w-4 h-4" aria-hidden="true" />}
          <span>{busy ? 'Checking file…' : up ? 'Replace' : 'Choose JSON file'}</span>
        </button>
        {up && (
          <button onClick={remove} disabled={disabled} className={`${btnSecondary} ${btnSmall} text-danger-ink`}>
            <Trash2 className="w-4 h-4" aria-hidden="true" />
            <span>Remove</span>
          </button>
        )}
      </div>
    </div>
  );
}

export default function Screen15_UploadCenter({ onNavigate, user }) {
  const readOnly = user?.role === 'viewer';
  const { job, loading, error, reload } = useJob();
  const c = job?.completeness;
  // only what is needed counts: not-applicable datasets and optional ones without a file are left out
  const progress = uploadProgress(c);
  const percent = progress.percent;
  // While the files are being read, uploads, replacements and removals wait. The page is read again when it ends.
  const processing = isProcessing(job);
  const onFinish = useCallback(() => { reload(); }, [reload]);
  const { status } = useProcessStatus(processing ? job.id : null, onFinish);

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-7xl mx-auto space-y-5">
      <JobHeader
        title="Upload Center"
        subtitle="Upload all masters in one file and all transactions in one file, or each Tally JSON report into its own slot. Every file is checked as soon as you upload it."
        job={job} loading={loading} error={error} onNavigate={onNavigate}
        action={
          <button onClick={() => onNavigate('screen-16')} className={btnPrimary}>
            <span>Check completeness</span>
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </button>
        }
      />

      {job && processing && (
        <div role="status" className="p-4 rounded-md border border-info-line bg-info-soft flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-[14px]">
          <div className="flex items-start gap-3 min-w-0">
            <Loader2 className="w-5 h-5 shrink-0 mt-px animate-spin text-info-ink" strokeWidth={1.75} aria-hidden="true" />
            <div>
              <div className="font-semibold text-ink">
                Your files are being read{status && PROCESS_ACTIVE.includes(status.state) ? ` (${Math.floor(status.percent || 0)}% done)` : ''}.
              </div>
              <div className="text-muted">Uploading, replacing and removing files is paused until reading has finished, so the files cannot change while they are read.</div>
            </div>
          </div>
          <button type="button" onClick={() => onNavigate('screen-17')} className={`${btnSecondary} ${btnSmall} shrink-0`}>Open Processing Status</button>
        </div>
      )}

      {job && readOnly && (
        <Note>You have view-only access, so files cannot be uploaded, replaced or removed.</Note>
      )}

      {job && (
        <>
          <div className="p-4 rounded-lg border border-line bg-white shadow-xs">
            <div className="flex items-center justify-between text-[14px] mb-2">
              <span className="font-medium text-ink">{uploadProgressWords(progress)}</span>
              <span className="font-semibold text-ink tabular-nums">{percent}%</span>
            </div>
            <div className="w-full bg-soft-2 h-2 rounded-full overflow-hidden" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress">
              <div className={`${percent >= 100 ? 'bg-success' : 'bg-action'} h-full transition-all`} style={{ width: `${percent}%` }} />
            </div>
          </div>

          <AllMastersCard info={c.allMasters} jobId={job.id} onChange={reload} locked={processing} readOnly={readOnly} />
          <AllTransactionsCard info={c.allTransactions} jobId={job.id} onChange={reload} locked={processing} readOnly={readOnly} />

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {c.slots.map((slot, i) => (
              <Slot key={slot.key} index={i + 1} slot={slot} jobId={job.id} onChange={reload} locked={processing} readOnly={readOnly} />
            ))}
          </div>

          <p className="text-[13px] text-subtle">
            The company and financial year you selected are never changed by an uploaded file.
          </p>
        </>
      )}
    </div>
  );
}
