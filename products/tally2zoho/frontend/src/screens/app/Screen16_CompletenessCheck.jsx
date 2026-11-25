import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, AlertTriangle, FileWarning, RotateCw } from 'lucide-react';
import { api, useJob, isProcessed, isProcessing, useProcessStatus, PROCESS_ACTIVE } from '../../api';
import JobHeader from '../../components/JobHeader';
import ProcessingProgress from '../../components/ProcessingProgress';
import { Note, StatusChip, btnPrimary, btnSecondary, btnSmall, inputClass } from '../../components/ui';
import { notApplicableReason, reasonProblem } from './uploadHelp';

const STATUS = {
  uploaded: { label: 'Uploaded', tone: 'success' },
  missing: { label: 'Missing', tone: 'danger' },
  not_uploaded: { label: 'Not uploaded (optional)', tone: 'neutral' },
  not_applicable: { label: 'Not applicable', tone: 'neutral' },
};

// The optional number of records Tally shows for one dataset. An empty box clears it.
function TallyCount({ slot, readOnly, onSave }) {
  const saved = slot.expectedCount == null ? '' : String(slot.expectedCount);
  const [value, setValue] = useState(saved);
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(saved), [saved]);
  if (readOnly) return <span className="tabular-nums text-ink">{saved ? Number(saved).toLocaleString() : <span className="text-subtle">Not entered</span>}</span>;
  const text = value.trim();
  const valid = text === '' || /^\d{1,9}$/.test(text);
  const changed = text !== saved;
  const save = async () => {
    if (!changed || !valid || busy) return;
    setBusy(true);
    await onSave(slot, text === '' ? null : Number(text));
    setBusy(false);
  };
  // inputClass sets the width to 100%, so the box gets a fixed width inline where it cannot be overridden or squeezed.
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={value} onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); }}
          inputMode="numeric" maxLength={9} placeholder="Optional" aria-label={`Count in Tally for ${slot.name}`}
          style={{ width: '7rem', minWidth: '7rem', flex: 'none' }}
          className={`${inputClass} text-right tabular-nums ${slot.countMatches === false || !valid ? 'border-danger' : ''}`}
        />
        {changed && <button type="button" onClick={save} disabled={!valid || busy} className={`${btnSecondary} ${btnSmall}`}>{busy ? 'Saving…' : text === '' ? 'Clear' : 'Save'}</button>}
      </div>
      {!valid && <div role="alert" className="mt-1 text-[13px] text-danger-ink">Enter a whole number of up to 9 digits, or leave it empty.</div>}
    </div>
  );
}

export default function Screen16_CompletenessCheck({ onNavigate, user }) {
  const readOnly = user?.role === 'viewer';
  const { job, loading, error, reload } = useJob();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const c = job?.completeness;
  const mismatches = c?.countMismatches || [];

  // Runs a change, shows the server's message if it is refused, then reloads the page data.
  const act = async fn => {
    setActionError('');
    try { await fn(); } catch (e) { setActionError(e.message); }
    await reload();
  };

  // Not applicable: the reason is asked for in the row, in a full sentence (a sentence for the dataset is offered).
  const [marking, setMarking] = useState(null); // { key, reason }
  const markNotApplicable = slot => setMarking({ key: slot.key, reason: notApplicableReason(slot.key) });
  const saveNotApplicable = async slot => {
    if (reasonProblem(marking?.reason)) return;
    await act(() => api.put(`/migrations/${job.id}/waivers/${slot.key}`, { reason: marking.reason.trim() }));
    setMarking(null);
  };
  const undo = slot => act(() => api.del(`/migrations/${job.id}/waivers/${slot.key}`));
  // A required voucher dataset that the All Transactions file shows to be empty: the reason is the file's, so none is asked.
  const markConfirmedEmpty = slot => act(() => api.put(`/migrations/${job.id}/waivers/${slot.key}`, {}));
  const saveCount = (slot, expected) => act(() => api.put(`/migrations/${job.id}/expected-counts/${slot.key}`, { expected }));

  // Processing runs in the background: the server answers at once, and Processing Status shows the progress.
  // Once the data was read, reading it again is asked first: it removes the Zoho files created from the last reading.
  const [confirmAgain, setConfirmAgain] = useState(false);
  const start = async () => {
    setConfirmAgain(false);
    setBusy(true);
    setActionError('');
    try {
      await api.post(`/migrations/${job.id}/process?wait=0`);
      onNavigate('screen-17');
    } catch (e) {
      setActionError(e.message);
      reload();
    } finally {
      setBusy(false);
    }
  };

  // While a run is under way the progress is shown here too; the page is read again when it ends.
  const processing = isProcessing(job);
  const onFinish = useCallback(() => { reload(); }, [reload]);
  const { status } = useProcessStatus(processing ? job.id : null, onFinish);
  const unreadable = c?.mayNotBeReadable || [];
  const readAlready = isProcessed(job) && !processing;
  const filesMade = job?.status === 'generated';

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
      <JobHeader
        title="Completeness Check"
        subtitle="Processing starts only when every required dataset is uploaded, every conditional one is confirmed, and any record count you entered from Tally agrees with the file. Optional datasets never block."
        job={job} loading={loading} error={error || actionError} onNavigate={onNavigate}
        action={!readOnly && (readAlready ? (
          <div className="flex flex-wrap gap-2 self-start">
            <button type="button" onClick={() => onNavigate('screen-17')} className={btnPrimary}>
              <span>Open Processing Status</span><ArrowRight className="w-4 h-4" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => setConfirmAgain(true)} disabled={!c?.ready || busy} aria-expanded={confirmAgain} className={btnSecondary}>
              <RotateCw className="w-4 h-4" aria-hidden="true" /> {busy ? 'Starting…' : 'Read the files again'}
            </button>
          </div>
        ) : (
          <button
            onClick={start}
            disabled={!c?.ready || busy || processing}
            title={processing ? 'Processing is already under way.' : undefined}
            className={`${btnPrimary} self-start`}
          >
            <span>{busy ? 'Starting…' : processing ? 'Processing under way' : 'Start processing'}</span>
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </button>
        ))}
      />

      {confirmAgain && readAlready && !readOnly && (
        <div role="alertdialog" aria-label="Read the files again?" className="p-4 rounded-lg border border-warning-line bg-warning-soft text-[14px] text-ink space-y-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-px text-warning-ink" aria-hidden="true" />
            <div>
              <div className="font-semibold">The data was already read. Read the files again?</div>
              <p className="text-muted mt-1">
                {filesMade ? 'This removes the Zoho files created so far, the import progress recorded for them, the Zoho error files and the reconciliation. Create the files again afterwards. ' : ''}
                Journal routing decisions are kept where the voucher is still there. Do this only after replacing or adding a Tally file.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={start} disabled={busy} className={btnPrimary}>{busy ? 'Starting…' : 'Read the files again'}</button>
            <button type="button" onClick={() => setConfirmAgain(false)} className={btnSecondary}>Cancel</button>
          </div>
        </div>
      )}

      {job && processing && status && PROCESS_ACTIVE.includes(status.state) && <ProcessingProgress status={status} compact onNavigate={onNavigate} />}

      {job && (
        <>
          <div className={`p-4 rounded-lg border shadow-xs ${c.ready ? 'border-success-line bg-success-soft' : 'border-danger-line bg-danger-soft'}`}>
            <div className="text-[16px] font-semibold text-ink">
              {processing ? 'Your files are being read now.' : c.ready ? (readAlready ? 'All datasets are accounted for, and the data has been read.' : 'All datasets are accounted for. You can start processing.') : 'Processing is blocked'}
            </div>
            {!c.ready && (
              <ul className="mt-2 text-[14px] text-muted space-y-1">
                {c.missingRequired.length > 0 && <li><strong className="text-ink">Missing required:</strong> {c.missingRequired.join(', ')}</li>}
                {c.awaitingConfirmation.length > 0 && <li><strong className="text-ink">Awaiting confirmation:</strong> {c.awaitingConfirmation.join(', ')}. Upload the file or mark it not applicable.</li>}
                {mismatches.map(m => (
                  <li key={m.slot}><strong className="text-ink">Record count does not match:</strong> {m.message}</li>
                ))}
              </ul>
            )}
          </div>

          {unreadable.length > 0 && (
            <div role="status" className="p-4 rounded-lg border border-warning-line bg-warning-soft flex items-start gap-3 text-[14px]">
              <FileWarning className="w-5 h-5 shrink-0 mt-px text-warning-ink" strokeWidth={1.75} aria-hidden="true" />
              <div className="min-w-0">
                <div className="font-semibold text-ink">
                  {unreadable.length === 1 ? 'One file may not be readable' : `${unreadable.length} files may not be readable`}: {unreadable.map(u => u.name).join(', ')}
                </div>
                <p className="mt-1 text-muted">
                  None of the records in {unreadable.length === 1 ? 'this file' : 'these files'} has the fields the platform needs, so the Tally export probably uses
                  different field names. You can still start processing, but little or nothing may be read from {unreadable.length === 1 ? 'it' : 'them'}, so the results
                  for {unreadable.length === 1 ? 'that dataset' : 'those datasets'} may be empty. The Upload Center shows which fields are missing and similar names found in the file.
                </p>
                <button type="button" onClick={() => onNavigate('screen-15')} className="mt-2 font-medium text-info-ink hover:underline">Open Upload Center</button>
              </div>
            </div>
          )}

          {c.allMasters && (
            <div className="p-4 rounded-lg border border-line bg-white shadow-xs text-[14px]">
              <div className="font-semibold text-ink">All masters in one file: {c.allMasters.fileName}</div>
              <p className="mt-1 text-muted">
                {c.allMasters.records.toLocaleString()} records were read. They went to these datasets; compare the numbers with Tally and enter Tally's numbers below if you want them checked:
              </p>
              <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                {c.allMasters.datasets.map(d => (
                  <li key={d.slot} className="flex justify-between gap-3 border-b border-soft py-1">
                    <span className="text-ink">{d.name}</span>
                    <span className="text-right text-muted">
                      <span className="tabular-nums text-ink">{d.mainRecords.toLocaleString()}</span>
                      {d.groups > 0 && ` + ${d.groups.toLocaleString()} groups`}
                      {!d.current && (d.replacedBy ? `, replaced by "${d.replacedBy}"` : ', removed later')}
                    </span>
                  </li>
                ))}
              </ul>
              {c.allMasters.notUsed.length > 0 && (
                <p className="mt-2 text-muted">
                  Kept for reference, not used: {c.allMasters.notUsed.map(x => `${x.records.toLocaleString()} ${x.type}`).join(', ')}. This is not an error.
                </p>
              )}
            </div>
          )}

          {c.allTransactions && (
            <div className="p-4 rounded-lg border border-line bg-white shadow-xs text-[14px]">
              <div className="font-semibold text-ink">All transactions in one file: {c.allTransactions.fileName}</div>
              <p className="mt-1 text-muted">
                {c.allTransactions.vouchers.toLocaleString()} vouchers were read and sorted by voucher type. Compare the numbers with Tally and enter Tally's numbers below if you want them checked:
              </p>
              <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                {c.allTransactions.datasets.map(d => (
                  <li key={d.slot} className="flex justify-between gap-3 border-b border-soft py-1">
                    <span className="text-ink">
                      {d.name}
                      {d.noZohoFile && d.records > 0 && <span className="block text-[13px] text-muted">Read and kept; no Zoho file is created for these yet.</span>}
                    </span>
                    <span className="text-right text-muted shrink-0">
                      <span className="tabular-nums text-ink">{d.records.toLocaleString()}</span>
                      {d.records === 0 && (d.ownFile ? `, your own file "${d.ownFile}" is used` : ', none in the file')}
                      {d.records > 0 && !d.current && (d.replacedBy ? `, replaced by "${d.replacedBy}"` : ', removed later')}
                      {d.notPlaced > 0 && <span className="block text-ink font-medium">{d.notPlaced.toLocaleString()} of these {d.notPlaced === 1 ? 'is' : 'are'} in no dataset</span>}
                    </span>
                  </li>
                ))}
              </ul>
              {c.allTransactions.notPlaced?.length > 0 && (
                <p className="mt-2 text-ink font-medium">
                  {c.allTransactions.control.notPlaced.toLocaleString()} voucher{c.allTransactions.control.notPlaced === 1 ? '' : 's'} of this file {c.allTransactions.control.notPlaced === 1 ? 'is' : 'are'} in no dataset.
                  When the file was sorted again, {c.allTransactions.control.notPlaced === 1 ? 'it moved' : 'they moved'} to a dataset that holds a file uploaded on its own, or that was removed
                  ({c.allTransactions.notPlaced.map(n => `${n.name}: ${n.vouchers.toLocaleString()}`).join(', ')}). Upload the All Transactions file again to sort every voucher into its dataset.
                </p>
              )}
              {c.allTransactions.control && (
                <p className="mt-2 text-muted">
                  Control total: {c.allTransactions.control.vouchers.toLocaleString()} vouchers in the file = {c.allTransactions.control.inDatasets.toLocaleString()} in datasets that come from it
                  {' '}+ {c.allTransactions.control.replacedByOwnFile.toLocaleString()} in datasets replaced by a file of their own + {c.allTransactions.control.removed.toLocaleString()} in datasets removed later.
                </p>
              )}
              {c.allTransactions.autoNotApplicable.length > 0 && (
                <p className="mt-2 text-muted">
                  Marked not applicable for you, because the file has no vouchers of these types: {c.allTransactions.autoNotApplicable.map(a => a.name).join(', ')}.
                  The file holds every voucher of the year, so they do not block processing. You can undo this in the table below.
                </p>
              )}
              {c.allTransactions.unresolvedTypes.length > 0 && (
                <p className="mt-2 text-ink">
                  Could not be traced to one of Tally's own voucher types, so kept under Other Voucher Types and not guessed: {c.allTransactions.unresolvedTypes.map(t => `${t.type} (${t.vouchers.toLocaleString()})`).join(', ')}.
                  {!c.allTransactions.mastersUsed && ' Upload the All Masters file, which lists your voucher types.'}
                </p>
              )}
              {Object.values(c.allTransactions.statuses || {}).some(n => n > 0) && (
                <p className="mt-2 text-muted">
                  {Object.entries(c.allTransactions.statuses).filter(([, n]) => n > 0).map(([s, n]) => `${n.toLocaleString()} ${s}`).join(', ')} voucher(s) are kept and counted, but they are never written to a Zoho file.
                </p>
              )}
              <p className="mt-2 text-muted">
                Once the files are created, Voucher Reconciliation shows where each voucher of this file went.{' '}
                <button type="button" onClick={() => onNavigate('screen-37')} className="font-medium text-info-ink hover:underline">Open Voucher Reconciliation</button>
              </p>
            </div>
          )}

          <Note>
            <strong>Count in Tally (optional).</strong> For any dataset you can enter how many records Tally shows, for example the number of customer ledgers.
            The platform compares it with the number of records in the uploaded file. If the two differ, processing is blocked until you upload the complete file,
            correct the number, or clear it. Leave the box empty if you do not want this check.
          </Note>

          <div className="border border-line rounded-lg bg-white shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="sticky top-0 bg-soft border-b border-line text-[12px] uppercase tracking-wide text-muted">
                  <tr>
                    <th className="py-3 px-4 font-semibold">Dataset</th>
                    <th className="py-3 px-4 font-semibold">Tally report to export</th>
                    <th className="py-3 px-4 font-semibold">Needed</th>
                    <th className="py-3 px-4 font-semibold">Status</th>
                    <th className="py-3 px-4 font-semibold">Count in Tally</th>
                    <th className="py-3 px-4 font-semibold text-right">Count in the file</th>
                    <th className="py-3 px-4 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {c.slots.map(s => {
                    const optionalGap = s.status === 'missing' && s.requirement === 'optional'; // never blocks
                    const { label, tone } = STATUS[optionalGap ? 'not_uploaded' : s.status];
                    const actual = s.actualCount ?? (s.upload ? s.upload.records : null);
                    const others = s.upload && actual != null ? s.upload.records - actual : 0;
                    return (
                      <tr key={s.key} className="align-top hover:bg-soft/60">
                        <td className="py-3 px-4 font-medium text-ink">{s.name}</td>
                        <td className="py-3 px-4 text-muted">{s.report}</td>
                        <td className="py-3 px-4 text-muted">{s.requirement === 'required' ? 'Required' : s.requirement === 'optional' ? 'Optional' : 'If applicable'}</td>
                        <td className="py-3 px-4">
                          <StatusChip tone={tone} dot>{label}</StatusChip>
                          {s.waiver && <div className="text-[13px] text-subtle">Reason: {s.waiver.reason}</div>}
                          {s.upload?.fromAllMasters && <div className="text-[13px] text-muted">From the All Masters file</div>}
                          {s.upload?.fromAllTransactions && <div className="text-[13px] text-muted">From the All Transactions file</div>}
                          {s.noZohoFile && s.upload && !['taxes', 'units', 'stock_summary'].includes(s.key) && <div className="text-[13px] text-muted">Read and kept; no Zoho file is created for these yet.</div>}
                          {s.upload?.trialBalance && (
                            <div className="text-[13px] text-ink">
                              Tally report: {s.upload.trialBalance.lines.toLocaleString()} lines
                              {s.upload.trialBalance.mastersAvailable && `, ${s.upload.trialBalance.ledgers.toLocaleString()} ledgers, ${s.upload.trialBalance.groups.toLocaleString()} groups`}.
                              {s.upload.trialBalance.mastersAvailable && (s.upload.trialBalance.atLedgerLevel
                                ? ' Every ledger is listed.'
                                : ' Not every ledger is listed, so no Opening Balances file can be created. Press Alt+F5 in Tally for the detailed view and export again.')}
                            </div>
                          )}
                          {s.mayNotBeReadable && (
                            <div className="mt-1 inline-flex items-center gap-1.5 text-[13px] font-semibold text-warning-ink">
                              <FileWarning className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /> May not be readable
                            </div>
                          )}
                          {s.upload?.warnings.length > 0 && <div className="text-[13px] text-subtle">{s.upload.warnings.length} warning(s)</div>}
                        </td>
                        <td className="py-3 px-4"><TallyCount slot={s} readOnly={readOnly} onSave={saveCount} /></td>
                        <td className="py-3 px-4 text-right text-ink">
                          <div className="tabular-nums">{actual != null ? actual.toLocaleString() : ''}</div>
                          {others > 0 && <div className="text-[13px] text-subtle">plus {others.toLocaleString()} group record(s), not counted</div>}
                          {s.key === 'accounts' && s.upload?.fromAllMasters && <div className="text-[13px] text-subtle">every ledger, including customers, vendors and tax ledgers</div>}
                          {s.countMatches === false && (
                            <div className="mt-1 inline-flex items-center gap-1.5 text-[13px] font-semibold text-danger-ink">
                              <AlertTriangle className="w-4 h-4" aria-hidden="true" /> Differs from Tally ({s.expectedCount.toLocaleString()})
                            </div>
                          )}
                          {s.countMatches === true && (
                            <div className="mt-1 inline-flex items-center gap-1.5 text-[13px] text-success-ink">
                              <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Agrees with Tally
                            </div>
                          )}
                          {s.expectedCount != null && s.countMatches == null && <div className="mt-1 text-[13px] text-subtle">No file to compare yet</div>}
                        </td>
                        <td className="py-3 px-4">
                          {marking?.key === s.key && s.status === 'missing' && !readOnly && (
                            <form className="space-y-2 min-w-[16rem]" onSubmit={e => { e.preventDefault(); saveNotApplicable(s); }}>
                              <label className="block text-[13px] text-muted" htmlFor={`na-${s.key}`}>Why does it not apply to this company?</label>
                              <input id={`na-${s.key}`} autoFocus value={marking.reason} onChange={e => setMarking({ key: s.key, reason: e.target.value })} className={inputClass} />
                              {reasonProblem(marking.reason) && <div role="alert" className="text-[13px] text-danger-ink">{reasonProblem(marking.reason)}</div>}
                              <div className="flex gap-2">
                                <button type="submit" disabled={!!reasonProblem(marking.reason)} className={btnSecondary}>Mark not applicable</button>
                                <button type="button" onClick={() => setMarking(null)} className="text-muted hover:underline">Cancel</button>
                              </div>
                            </form>
                          )}
                          {s.status === 'missing' && marking?.key !== s.key && (
                            <div className="flex items-center gap-3">
                              <button onClick={() => onNavigate('screen-15')} className="font-medium text-info-ink hover:underline">Upload</button>
                              {s.requirement === 'conditional' && !readOnly && <button onClick={() => markNotApplicable(s)} className="text-muted hover:underline">Not applicable</button>}
                              {s.requirement === 'required' && s.canMarkNotApplicable && !readOnly && (
                                <button onClick={() => markConfirmedEmpty(s)} className="text-muted hover:underline text-left" title="The All Transactions file in place has no vouchers of this type, and it holds every voucher of the year.">
                                  Not applicable (the All Transactions file has none)
                                </button>
                              )}
                            </div>
                          )}
                          {s.status === 'not_applicable' && !readOnly && <button onClick={() => undo(s)} className="text-muted hover:underline">Undo</button>}
                          {s.countMatches === false && <button onClick={() => onNavigate('screen-15')} className="font-medium text-info-ink hover:underline">Replace file</button>}
                          {s.mayNotBeReadable && s.countMatches !== false && <button onClick={() => onNavigate('screen-15')} className="font-medium text-info-ink hover:underline">Check in Upload Center</button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
