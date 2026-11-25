import React, { useEffect, useState } from 'react';
import { ChevronLeft, FileX2, ChevronRight, Printer } from 'lucide-react';
import { api, useJob, formatAmount } from '../../api';
import JobHeader from '../../components/JobHeader';
import TestRunReport from './TestRunReport';
import FlaggedGroups from '../../components/FlaggedGroups';
import { EmptyState, Note, StatTile, StatusChip, btnSecondary, btnSmall } from '../../components/ui';

const AUDIT_PAGE = 50;

const DATASET = { uploaded: 'Uploaded', missing: 'Missing', not_applicable: 'Not applicable' };
const IMPORT = { generated: 'Generated', downloaded: 'Downloaded', imported: 'Imported', partial: 'Partly imported', failed: 'Failed' };
const IMPORT_TONE = { generated: 'neutral', downloaded: 'info', imported: 'success', partial: 'warning', failed: 'danger' };
const ACTION = {
  create_migration: 'Migration created', upload: 'File uploaded', upload_rejected: 'File rejected', upload_removed: 'File removed',
  marked_not_applicable: 'Marked not applicable', process: 'Data processed', journal_routed: 'Journal routed', generate: 'Files generated',
  download: 'File downloaded', import_status: 'Import status set',
  expected_count_set: 'Count in Tally entered', expected_count_cleared: 'Count in Tally cleared',
  unit_mapped: 'Unit mapped', unit_mapping_removed: 'Unit mapping removed',
  account_type_decided: 'Account type decided', account_type_decision_removed: 'Account type decision removed',
  tax_mapped: 'Tax mapped', tax_mapping_removed: 'Tax mapping removed', tax_mapping_respelled: 'Tax mapping spelling matched to list',
  zoho_tax_list_saved: 'Zoho tax list saved', zoho_tax_list_cleared: 'Zoho tax list cleared',
  process_failed: 'Processing stopped', test_report_downloaded: 'Test report downloaded',
  zoho_report_uploaded: 'Zoho report checked', reconciliation_cleared: 'Zoho report check removed',
  rejection_file_uploaded: 'Rejection file uploaded', correction_approved: 'Correction approved', retry_file_generated: 'Retry file created',
};
// An action with no label yet is shown in plain words rather than as a code name (underscores become spaces).
const actionLabel = a => ACTION[a] || String(a || '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

// formatAmount drops the sign; here a negative figure must stay visible.
const money = v => (v == null || v === '' ? '' : `${Number(v) < 0 ? '-' : ''}${formatAmount(v)}`);
const STAGE = { process: 'Found in the Tally data', crosscheck: 'Found when checking vouchers and the Trial Balance against the masters', generate: 'Found when preparing Zoho files' };

function Section({ title, children }) {
  return (
    <div className="border border-line rounded-lg bg-white shadow-xs overflow-hidden">
      <div className="px-4 py-3 border-b border-line"><h3 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h3></div>
      {children}
    </div>
  );
}

// Pages of the audit trail, 50 actions a page.
function AuditPager({ page, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / AUDIT_PAGE));
  if (pages <= 1) return null;
  const p = Math.min(page, pages);
  return (
    <div className="px-4 py-2.5 border-t border-line flex flex-wrap items-center justify-between gap-2 text-[14px] text-muted print:hidden">
      <span>Actions {((p - 1) * AUDIT_PAGE + 1).toLocaleString('en-IN')} to {Math.min(total, p * AUDIT_PAGE).toLocaleString('en-IN')} of {total.toLocaleString('en-IN')}</span>
      <span className="flex gap-2">
        <button type="button" className={`${btnSecondary} ${btnSmall}`} disabled={p <= 1} onClick={() => onPage(p - 1)}><ChevronLeft className="w-4 h-4" aria-hidden="true" /> Earlier page</button>
        <button type="button" className={`${btnSecondary} ${btnSmall}`} disabled={p >= pages} onClick={() => onPage(p + 1)}>Next page <ChevronRight className="w-4 h-4" aria-hidden="true" /></button>
      </span>
    </div>
  );
}

export default function Screen31_MigrationReports({ onNavigate }) {
  const { job, loading, error } = useJob();
  const [report, setReport] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [auditPage, setAuditPage] = useState(1);

  useEffect(() => {
    if (!job) return;
    api.get(`/migrations/${job.id}/report`).then(setReport).catch(e => setLoadError(e.message));
  }, [job]);

  const r = report;
  const importedFiles = r?.files.filter(f => f.status === 'imported').length || 0;

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
      <JobHeader
        title="Reports and Audit"
        subtitle="What was uploaded, what was generated, what was imported, and every action taken."
        job={job} loading={loading} error={error || loadError} onNavigate={onNavigate}
        action={
          <button onClick={() => window.print()} className={`${btnSecondary} self-start`}>
            <Printer className="w-4 h-4" />
            <span>Print report</span>
          </button>
        }
      />

      {job && <TestRunReport job={job} />}

      {job && r && (
        <>
          {r.staleSinceUpload && (
            <div role="status">
              <Note tone="warning" title="Files changed since the data was last processed.">
                The source datasets below show the files as they are now.
                The records stored, the flagged items and the reconciliation figures are from the earlier run and may no longer apply.
                Process the data again to bring this report up to date.
                <div className="mt-2">
                  <button type="button" onClick={() => onNavigate('screen-16')} className="underline font-medium text-info-ink">Open Completeness Check</button>
                </div>
              </Note>
            </div>
          )}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              ['Records stored', r.recordsStored.toLocaleString()],
              ['Journals routed', `${r.journals.decided} of ${r.journals.total}`],
              ['Files imported', `${importedFiles} of ${r.files.length}`],
              ['Flagged items', r.exceptions.length.toLocaleString('en-IN')],
            ].map(([label, value]) => (
              <StatTile key={label} label={label} value={value} />
            ))}
          </div>

          <Section title="Source datasets">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[14px]">
                <thead className="bg-soft border-b border-line text-[12px] uppercase tracking-wide text-muted">
                  <tr><th className="py-2.5 px-4 font-semibold">Dataset</th><th className="py-2.5 px-4 font-semibold">Status</th><th className="py-2.5 px-4 font-semibold">File</th><th className="py-2.5 px-4 font-semibold text-right">Records in file</th><th className="py-2.5 px-4 font-semibold text-right">Count in Tally</th><th className="py-2.5 px-4 font-semibold text-right">Fields not transferred</th><th className="py-2.5 px-4 font-semibold">Checksum</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {r.datasets.map(d => (
                    <tr key={d.name}>
                      <td className="py-2.5 px-4 text-ink font-medium">{d.name}</td>
                      <td className="py-2.5 px-4 text-muted">{d.status === 'missing' && d.requirement === 'optional' ? 'Not uploaded (optional)' : DATASET[d.status]}{d.noZohoFile && d.status === 'uploaded' && !['taxes', 'units', 'stock_summary'].includes(d.key) ? '. Read and kept; no Zoho file is created for these yet' : ''}{d.reason ? `: ${d.reason}` : ''}</td>
                      <td className="py-2.5 px-4 text-muted">{d.fileName || ''}</td>
                      <td className="py-2.5 px-4 text-right tabular-nums text-ink">{d.actualCount ?? d.records ?? ''}</td>
                      <td className="py-2.5 px-4 text-right tabular-nums text-ink whitespace-nowrap">
                        {d.expectedCount == null ? <span className="text-subtle">Not entered</span>
                          : d.countMatches === false ? <span className="font-semibold">{d.expectedCount} · does not agree</span>
                            : d.countMatches === true ? <>{d.expectedCount} · agrees</> : d.expectedCount}
                      </td>
                      <td className="py-2.5 px-4 text-right tabular-nums text-ink">{d.fieldsNotRead ?? ''}</td>
                      <td className="py-2.5 px-4 font-mono text-[13px] text-subtle">{d.sha256 ? `${d.sha256.slice(0, 16)}…` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2.5 border-t border-line text-[13px] text-subtle">
              "Records in file" counts the dataset's own records (Tally group records in the Chart of Accounts are not counted). "Fields not transferred" is the number of
              fields found in the file that the platform does not use; their names are shown in the Upload Center. Some of the fields that are used
              serve only for checks and are also not written to Zoho Books.
            </div>
          </Section>

          <Section title="Generated files and import status">
            {r.files.length === 0 ? <EmptyState icon={FileX2} title="No files generated yet" text="Create the files in the Export Center and they will be listed here." actionLabel="Open Export Center" onAction={() => onNavigate('screen-25')} /> : (
              <div className="divide-y divide-line">
                {r.files.map(f => (
                  <div key={f.key} className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-[14px]">
                    <span className="text-ink font-medium w-48">{f.step}. {f.module}</span>
                    <span className="text-muted flex-1">{f.fileName} · {f.rows} rows</span>
                    <span className="text-ink flex flex-wrap items-center gap-2"><StatusChip tone={IMPORT_TONE[f.status] || 'neutral'} dot>{IMPORT[f.status]}</StatusChip>{f.note ? <span className="text-muted">{f.note}</span> : null}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="px-4 py-2.5 border-t border-line text-[13px] text-subtle">
              Journal routing: {r.journals.decided} decided, of which {r.journals.overridden} differed from the suggestion.
            </div>
          </Section>

          {Array.isArray(r.reconciliation) && r.reconciliation.length > 0 && (
            <Section title="Reconciliation with Zoho Books">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[14px]">
                  <thead className="bg-soft border-b border-line text-[12px] uppercase tracking-wide text-muted">
                    <tr>
                      <th className="py-2.5 px-4 font-semibold">Module</th>
                      <th className="py-2.5 px-4 font-semibold text-right">Matched</th>
                      <th className="py-2.5 px-4 font-semibold text-right">Missing</th>
                      <th className="py-2.5 px-4 font-semibold text-right">Extra</th>
                      <th className="py-2.5 px-4 font-semibold text-right">Amounts compared</th>
                      <th className="py-2.5 px-4 font-semibold text-right">Amounts differing</th>
                      <th className="py-2.5 px-4 font-semibold text-right">Total expected</th>
                      <th className="py-2.5 px-4 font-semibold text-right">Total in Zoho</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {r.reconciliation.map(m => (
                      <tr key={m.key}>
                        <td className="py-2.5 px-4 text-ink font-medium">
                          {m.module}
                          <div className="text-[13px] font-normal text-subtle">
                            {!m.checked ? 'No Zoho report uploaded yet' : m.amountColumn ? `Amount column used: ${m.amountColumn}` : 'Amounts not compared'}
                          </div>
                        </td>
                        {m.checked ? (
                          <>
                            <td className="py-2.5 px-4 text-right tabular-nums text-ink">{m.matched} of {m.expected}</td>
                            <td className="py-2.5 px-4 text-right tabular-nums text-ink">{m.missing}</td>
                            <td className="py-2.5 px-4 text-right tabular-nums text-ink">{m.extra}</td>
                            <td className="py-2.5 px-4 text-right tabular-nums text-ink">{m.amountColumn ? m.amountsCompared : ''}</td>
                            <td className={`py-2.5 px-4 text-right tabular-nums text-ink ${m.amountsDiffering ? 'font-semibold' : ''}`}>{m.amountColumn ? m.amountsDiffering : ''}</td>
                            <td className="py-2.5 px-4 text-right tabular-nums whitespace-nowrap text-ink">{money(m.totalExpectedCompared)}</td>
                            <td className="py-2.5 px-4 text-right tabular-nums whitespace-nowrap text-ink">{money(m.totalInZoho)}</td>
                          </>
                        ) : <td colSpan={7} className="py-2.5 px-4 text-right text-subtle">{m.expected} record(s) expected</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-2.5 border-t border-line text-[13px] text-subtle">
                Both totals cover only the records whose amount was compared. {r.reconciliationNote}
              </div>
            </Section>
          )}

          <Section title={`Flagged items (${r.exceptions.length.toLocaleString('en-IN')})`}>
            <div className="px-4 py-2.5 border-b border-line text-[13px] text-subtle">Grouped by kind. The same items, with where to fix them, are in the Validation Center.</div>
            <FlaggedGroups items={r.exceptions.map(e => ({ ...e, slotName: [e.slotName, STAGE[e.stage]].filter(Boolean).join(' · ') }))} />
          </Section>

          <Section title={`Audit trail (${r.audit.length.toLocaleString('en-IN')} actions)`}>
            <div className="divide-y divide-line">
              {r.audit.slice((Math.min(auditPage, Math.max(1, Math.ceil(r.audit.length / AUDIT_PAGE))) - 1) * AUDIT_PAGE, Math.min(auditPage, Math.max(1, Math.ceil(r.audit.length / AUDIT_PAGE))) * AUDIT_PAGE).map((a, i) => (
                <div key={i} className="px-4 py-2.5 flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 text-[14px]">
                  <span className="text-subtle tabular-nums shrink-0 sm:w-44">{new Date(a.at).toLocaleString()}</span>
                  <span className="text-ink font-medium shrink-0 sm:w-44">{actionLabel(a.action)}</span>
                  <span className="text-muted break-words min-w-0 flex-1">{a.detail}</span>
                  <span className="text-subtle break-all shrink-0 sm:w-48 sm:text-right">{a.actor}</span>
                </div>
              ))}
            </div>
            <AuditPager page={auditPage} total={r.audit.length} onPage={setAuditPage} />
            <div className="px-4 py-2.5 border-t border-line text-[13px] text-subtle">
              Each action is recorded with the time and the person who was signed in.
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
