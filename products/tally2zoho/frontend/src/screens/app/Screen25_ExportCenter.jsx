import React, { useCallback, useEffect, useState } from 'react';
import { FileDown, ArrowRight, AlertTriangle, FileX2, Loader } from 'lucide-react';
import { api, downloadFile, useJob, isProcessing, useProcessStatus, useScrollTarget } from '../../api';
import JobHeader from '../../components/JobHeader';
import OutOfDateBanner from '../../components/OutOfDateBanner';
import WaitingForSample from '../../components/WaitingForSample';
import Assumptions, { BankOpeningBalances } from '../../components/Assumptions';
import CreateFilesBar, { CreateFilesButton, DownloadAllButton } from '../../components/CreateFiles';
import CompletenessTable from '../../components/CompletenessTable';
import ExpectedTrialBalance from '../../components/ExpectedTrialBalance';
import FlaggedGroups from '../../components/FlaggedGroups';
import HeldNotice from '../../components/HeldNotice';
import { StatusChip, EmptyState, btnPrimary, btnSecondary, btnSmall } from '../../components/ui';
import { sortByImportOrder, downloadAddress } from '../../importWizard';

const MODULE_OF = { payments_received: 'Payments Received', payments_made: 'Payments Made', vendor_credits: 'Vendor Credits', credit_notes: 'Credit Notes' };

export default function Screen25_ExportCenter({ onNavigate, user }) {
  const viewer = user?.role === 'viewer';
  const { job, loading, error, reload } = useJob();
  useScrollTarget(); // opened at the bank opening balances from "Assumptions the tool made"
  const [files, setFiles] = useState([]);
  const [exceptions, setExceptions] = useState([]);
  const [control, setControl] = useState(null); // where every stored voucher went when the files were created
  const [actionError, setActionError] = useState('');
  const [downloading, setDownloading] = useState('');
  const [zohoCheck, setZohoCheck] = useState(null); // the Zoho check of the files (ZohoCheck.jsx): rows expected to import, per file
  const [confirming, setConfirming] = useState(''); // the file whose download waits for "Download anyway"
  const checkOf = key => (zohoCheck?.available ? zohoCheck.files.find(x => x.key === key) : null);

  // Downloads through the page, so a refusal (for example, the file went out of date) shows a message here.
  // A file with rows Zoho will refuse is downloaded only after a confirmation, which is written to the audit log.
  const download = async (f, confirmed = false) => {
    const zc = checkOf(f.key);
    // 'confirm_date': nothing is refused, but the opening balances of the file wait for the Migration Date
    const ask = !!zc?.blocking || zc?.download === 'confirm_date';
    if (ask && !confirmed) { setConfirming(f.key); return; }
    setConfirming('');
    if (ask && !viewer) await api.post(`/migrations/${job.id}/zoho-check/acknowledge`, { key: f.key }).catch(() => {});
    setActionError(''); setDownloading(f.key);
    try {
      // a viewer cannot acknowledge: the download itself says "Download anyway" (?confirmed=1)
      await downloadFile(downloadAddress(api.downloadUrl(job.id, f.key), { viewer, confirmed: ask }), f.fileName);
    } catch (e) {
      setActionError(e.message);
      if (e.data?.outOfDate) await reload(); // show the notice and mark the file
    } finally {
      setDownloading('');
    }
  };

  const load = useCallback(async () => {
    if (!job) return;
    try {
      // one import order everywhere: the server's import list (the Import Wizard's order); reports for checking last
      const [list, order] = await Promise.all([api.get(`/migrations/${job.id}/files`), api.get(`/migrations/${job.id}/imports`).catch(() => [])]);
      setFiles(sortByImportOrder(list, order));
      setExceptions((await api.get(`/migrations/${job.id}/summary`)).exceptions.filter(e => e.stage === 'generate'));
      setControl(await api.get(`/migrations/${job.id}/voucher-control`));
      setZohoCheck(await api.get(`/migrations/${job.id}/zoho-check`).catch(() => null));
    } catch (e) {
      setActionError(e.message);
    }
  }, [job]);
  useEffect(() => { load(); }, [load]);

  const processing = isProcessing(job);
  const canGenerate = job && ['processed', 'generated'].includes(job.status) && !processing;
  // While the files are being read, creating files waits; the page is read again when reading ends.
  const onFinish = useCallback(() => { reload(); }, [reload]);
  useProcessStatus(processing ? job.id : null, onFinish);
  // "Create files" (components/CreateFiles.jsx): the same button at the top and at the bottom of the page
  const created = async () => { setActionError(''); await reload(); await load(); };
  const notCreated = async e => {
    setActionError(e.message);
    if (e.status === 409) await reload(); // for example, processing started meanwhile: show it
  };

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
      <JobHeader
        title="Export Center"
        subtitle="Generate one file per Zoho Books module, then download and import each file into Zoho Books by hand."
        job={job} loading={loading} error={error || actionError} onNavigate={onNavigate}
        action={<CreateFilesButton job={job} canCreate={canGenerate} hasFiles={files.length > 0} viewer={viewer} onDone={created} onError={notCreated} quiet={files.length > 0} />}
      />

      <OutOfDateBanner job={job} user={user} onDone={reload} onNavigate={onNavigate} />

      {files.length > 0 && <HeldNotice job={job} onNavigate={onNavigate} />}

      {job && processing && (
        <div role="status" className="border border-warning-line rounded-lg bg-warning-soft">
          <EmptyState icon={Loader} title="Your files are being read" text="Files for Zoho Books cannot be created while processing is under way. This page updates by itself when it has finished." actionLabel="View Processing Status" onAction={() => onNavigate('screen-17')} />
        </div>
      )}

      {job && !canGenerate && !processing && (
        <div className="border border-line rounded-lg bg-white shadow-xs">
          <EmptyState icon={FileX2} title="Data has not been processed yet" text="Upload the Tally files and run processing before generating Zoho files." actionLabel="Open Completeness Check" onAction={() => onNavigate('screen-16')} />
        </div>
      )}

      {job && canGenerate && (
        <>
          <div className="p-4 rounded-md border border-warning-line bg-warning-soft flex items-start gap-3 text-[14px]">
            <AlertTriangle className="w-5 h-5 text-warning-ink shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-muted">
              <strong className="text-ink">Import into a Zoho Books test organisation first.</strong> The Customers, Vendors, Chart of Accounts and Items files have every column of the official Zoho Books (India) sample files, in the same order.
              The Invoices, Bills and Manual Journals files (and the journals of receipts, payments and contra) follow the official samples too. Headings match Zoho's sample file (checked). Not yet confirmed by a real import into Zoho Books.
              Opening balances are in the Chart of Accounts (every ledger except customers, vendors, bank accounts and ledgers named like one of Zoho's own accounts; those two kinds are in the opening balance journal) and in the Opening Balance column of the Customers and Vendors files. The Opening Balances file is a reference report only: do not import it.
            </div>
          </div>

          <div className="border border-line rounded-lg bg-white overflow-hidden">
            <div className="p-4 border-b border-line flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-[16px] font-semibold text-ink">Generated files, in import order</h3>
                <p className="text-[13px] text-muted">The same order as the Import Wizard. Reports for checking only come last.</p>
              </div>
              {files.some(f => !f.referenceOnly) && <DownloadAllButton job={job} viewer={viewer} onNavigate={onNavigate} onError={e => setActionError(e.message)} />}
            </div>
            {control?.control && (() => {
              const v = control.control;
              const kept = Object.entries(v.keptWithoutZohoFile);
              const keptTotal = kept.reduce((t, [, n]) => t + n, 0);
              const waiting = Object.entries(v.waitingForZohoSample || {});
              const waitingTotal = waiting.reduce((t, [, n]) => t + n, 0);
              const writtenTotal = Object.values(v.written).reduce((t, n) => t + n, 0);
              return (
                <div className="p-4 border-b border-line text-[14px] text-muted">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="font-medium text-ink">Where the {v.stored.toLocaleString()} vouchers went</div>
                    <button type="button" onClick={() => onNavigate('screen-37')} className="inline-flex items-center gap-1.5 text-[14px] font-medium text-ink underline">
                      Voucher Reconciliation: every voucher and line, with amounts <ArrowRight className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>
                  <div>
                    Written to a file: {writtenTotal.toLocaleString()} (Invoices {v.written.invoices.toLocaleString()}, Bills {v.written.bills.toLocaleString()}, Manual Journals {v.written.journals.toLocaleString()}
                    {v.written.other_journals !== undefined ? `, journals of receipts, payments and contra ${v.written.other_journals.toLocaleString()}` : ''})
                    {' '}· left out with a reason: {v.leftOut.toLocaleString()} · waiting for routing: {v.awaitingRouting.toLocaleString()}
                    {' '}· waiting for a Zoho sample: {waitingTotal.toLocaleString()} · kept without a Zoho file: {keptTotal.toLocaleString()}
                  </div>
                  {waitingTotal > 0 && (
                    <div className="mt-1 text-ink">
                      <strong>{waitingTotal.toLocaleString()} vouchers wait for a Zoho import sample</strong>: {waiting.map(([k, n]) => `${MODULE_OF[k] || k} ${n.toLocaleString()}`).join(', ')}. They wait because Payments files were chosen in Voucher files; see "Payments files from Zoho's import sample" below.
                    </div>
                  )}
                  {keptTotal > 0 && (
                    <div className="mt-1 text-ink">
                      <strong>{keptTotal.toLocaleString()} of {v.stored.toLocaleString()} vouchers are in none of these files</strong>, because no Zoho file is created for their type yet:
                      {' '}{kept.map(([slot, n]) => `${control.names[slot] || slot} ${n.toLocaleString()}`).join(', ')}. They have to be entered in Zoho Books another way.
                    </div>
                  )}
                </div>
              );
            })()}
            {files.length === 0 ? (
              <EmptyState icon={FileX2} title="No files yet" text="Use Create files at the top of the page to make one file for each Zoho Books module." />
            ) : (
              <div className="divide-y divide-line">
                {files.map((f, i) => (
                  <div key={f.key} className="px-4 py-3 flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-2 text-[14px]">
                    <div>
                      <div className="text-ink font-medium">
                        {!f.referenceOnly && <span className="tabular-nums text-muted font-normal">{i + 1}. </span>}{f.module}
                        {f.referenceOnly && <span className="ml-2 align-middle"><StatusChip tone="warning">Reference only · do not import</StatusChip></span>}
                        {!f.referenceOnly && f.templateVerified ? <span className="ml-2 text-[13px] font-normal text-muted">Headings match Zoho's sample file{f.templateAttestation?.sampleFileName ? ` "${f.templateAttestation.sampleFileName}"` : ''} (checked)</span> : null}
                      </div>
                      <div className="text-muted">{f.fileName} · {f.rows.toLocaleString()} rows</div>
                      {checkOf(f.key) && (() => {
                        const zc = checkOf(f.key);
                        return (
                          <div className="text-ink">
                            <span className={zc.rowsWill ? 'font-semibold' : ''}>{(zc.rows - zc.rowsWill).toLocaleString('en-IN')} of {zc.rows.toLocaleString('en-IN')} rows expected to import</span>
                            {zc.rowsWill > 0 && ` · ${zc.rowsWill.toLocaleString('en-IN')} will be refused`}
                            {zc.rowsMay > 0 && ` · ${zc.rowsMay.toLocaleString('en-IN')} may be refused`}
                            {' '}<button type="button" onClick={() => onNavigate('screen-38', { file: f.key })} className="underline text-info-ink">Zoho check</button>
                          </div>
                        );
                      })()}
                      {f.notes && <div className="text-muted">{f.notes}</div>}
                      <div className="text-subtle font-mono text-[13px]" title={f.sha256}>Checksum {f.sha256.slice(0, 16)}…</div>
                      {f.outOfDate && (
                        <div className="mt-1.5 flex items-start gap-2 text-ink">
                          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-danger-ink" aria-hidden="true" />
                          <span>
                            <strong>Out of date.</strong> {[...new Set(f.outOfDateReasons || [])].join(' ')} Create the files again before downloading this file.
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-start sm:items-end gap-1 self-start sm:self-auto shrink-0">
                      <button
                        type="button"
                        onClick={() => download(f)}
                        disabled={f.outOfDate || downloading === f.key}
                        aria-label={`Download the ${f.module} file`}
                        className={`${btnSecondary} ${btnSmall}`}
                      >
                        <FileDown className="w-4 h-4" aria-hidden="true" />
                        <span>{downloading === f.key ? 'Downloading…' : 'Download CSV'}</span>
                      </button>
                      {f.outOfDate && <span className="text-[13px] text-muted">Not available: the file is out of date</span>}
                    </div>
                    {confirming === f.key && checkOf(f.key) && (
                      <div role="alertdialog" aria-label={`Download the ${f.module} file anyway`} className="sm:basis-full w-full p-3 rounded-lg border border-warning-line bg-warning-soft flex flex-col md:flex-row md:items-center justify-between gap-2">
                        <span className="flex items-start gap-2">
                          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                          <span>{checkOf(f.key).rowsWill > 0
                            ? <>Zoho Books is expected to refuse {checkOf(f.key).rowsWill.toLocaleString('en-IN')} of {checkOf(f.key).rows.toLocaleString('en-IN')} rows of this file. Fix them first, or download it anyway.</>
                            : <>{(checkOf(f.key).dateRows || 0).toLocaleString('en-IN')} opening {checkOf(f.key).dateRows === 1 ? 'balance' : 'balances'} of this file wait for the Migration Date. Do not import the file before the date is saved and checked in Zoho Books (Import Wizard, step "Save the Migration Date"). You may download it now.</>}</span>
                        </span>
                        <span className="flex flex-wrap gap-2 shrink-0">
                          {checkOf(f.key).rowsWill > 0
                            ? <button type="button" onClick={() => onNavigate('screen-38', { file: f.key })} className={`${btnPrimary} ${btnSmall}`}>See the problems</button>
                            : <button type="button" onClick={() => onNavigate('screen-40', { step: 'date' })} className={`${btnPrimary} ${btnSmall}`}>Go to the Migration Date step</button>}
                          <button type="button" onClick={() => download(f, true)} className={`${btnSecondary} ${btnSmall}`}>Download anyway</button>
                          <button type="button" onClick={() => setConfirming('')} className="px-3 py-1.5 rounded-md underline text-info-ink">Cancel</button>
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {exceptions.length > 0 && (
            <div className="border border-line rounded-lg bg-white overflow-hidden">
              <div className="p-4 border-b border-line">
                <h3 className="text-[16px] font-semibold text-ink">Rows that need review before import ({exceptions.length.toLocaleString('en-IN')})</h3>
                <p className="text-[14px] text-muted">Grouped by kind. Each item says whether the record is in the file or was left out, and why.</p>
              </div>
              {/* grouped by kind, the first 20 of each with "Show all": the page stays short */}
              <div className="divide-y divide-line">
                <FlaggedGroups items={exceptions} onNavigate={onNavigate} />
              </div>
            </div>
          )}

          <Assumptions jobId={job.id} onNavigate={onNavigate} refreshKey={files.map(f => f.sha256).join('|')} />

          <BankOpeningBalances jobId={job.id} refreshKey={files.map(f => f.sha256).join('|')} />

          <WaitingForSample job={job} mode="full" />

          <CompletenessTable job={job} onNavigate={onNavigate} refreshKey={files.map(f => f.sha256).join('|')} defaultOpen />

          {/* the trial balance Zoho Books should show after these files, against Tally: seen before the download */}
          <ExpectedTrialBalance job={job} refreshKey={files.map(f => f.sha256).join('|')} />

          <CreateFilesBar job={job} user={user} canCreate={canGenerate} files={files.filter(f => !f.referenceOnly)} onDone={created} onError={notCreated} onNavigate={onNavigate} />
        </>
      )}
    </div>
  );
}
