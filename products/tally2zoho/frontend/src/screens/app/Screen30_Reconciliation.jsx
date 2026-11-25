import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, AlertTriangle } from 'lucide-react';
import { api, useJob, formatAmount, isProcessed, useScrollTarget } from '../../api';
import { sortByImportOrder } from '../../importWizard';
import ZohoTrialBalance from './ZohoTrialBalance';
import JobHeader from '../../components/JobHeader';
import { Blocked, Card, FileButton, Note, StatTile, StatusChip, Table, btnPrimary } from '../../components/ui';

const PROBLEM = { missing: 'In the generated file but not found in Zoho', extra: 'In Zoho but not in the generated file' };

// formatAmount drops the sign, and here the sign matters (a balance shown negative in Zoho is a difference).
const money = v => (v == null || v === '' ? '—' : `${Number(v) < 0 ? '-' : ''}${formatAmount(v)}`);

function Figure({ label, value }) {
  return (
    <div>
      <dt className="text-[13px] text-subtle">{label}</dt>
      <dd className="text-[15px] font-semibold text-ink tabular-nums">{value}</dd>
    </div>
  );
}

function Amounts({ m }) {
  // The file's layout no longer has the column the amount is taken from, so amounts cannot be compared.
  if (m.amountsComparable === false && m.amountsNotComparableReason) {
    return (
      <div className="mt-3 pt-3 border-t border-line flex items-start gap-2 text-ink">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-warning-ink" aria-hidden="true" />
        <span>
          <strong>Amounts are not compared for {m.module}.</strong> {m.amountsNotComparableReason} Records are still matched.
          To compare amounts again, put the column back in Template Mapping and create the files again.
        </span>
      </div>
    );
  }
  if (!m.checked) return null;
  if (!m.amountColumn) {
    return <div className="mt-2 text-muted">{m.note || 'Amounts were not compared for this module.'}</div>;
  }
  const totalsAgree = m.totalExpectedCompared != null && m.totalExpectedCompared === m.totalInZoho;
  return (
    <div className="mt-3 pt-3 border-t border-line">
      <div className="text-subtle">
        Amount column used from the Zoho report: <span className="text-ink font-medium">{m.amountColumn}</span>
        {m.amountBasis && <div className="mt-0.5">Expected amount: {m.amountBasis}.</div>}
        {m.note && <div className="mt-0.5">{m.note}</div>}
      </div>
      <dl className="mt-2 grid grid-cols-2 lg:grid-cols-5 gap-x-6 gap-y-3">
        <Figure label="Amounts compared" value={m.amountsCompared} />
        <Figure label="Amounts that differ" value={m.amountsDiffering} />
        <Figure label="Amounts not compared" value={m.amountsNotAvailable} />
        <Figure label="Total expected" value={money(m.totalExpectedCompared)} />
        <Figure label="Total in Zoho" value={money(m.totalInZoho)} />
      </dl>
      <div className="mt-2 text-[13px] text-subtle">
        Both totals cover only the {m.amountsCompared} record(s) whose amount was compared, so they are like for like.
        {m.totalExpected != null && m.totalExpected !== m.totalExpectedCompared && <> The generated file as a whole totals {money(m.totalExpected)}.</>}
      </div>
      {m.amountsCompared > 0 && m.amountsDiffering === 0 && (
        <div className="mt-2 inline-flex items-center gap-2 text-success-ink font-medium"><CheckCircle2 className="w-4 h-4" /> Every amount that was compared agrees.</div>
      )}
      {m.amountsDiffering > 0 && (
        <div className="mt-2 flex items-start gap-2 text-danger-ink font-medium">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{m.amountsDiffering} amount(s) differ{totalsAgree ? ', although the totals are equal' : ''}. They are listed below.</span>
        </div>
      )}
    </div>
  );
}

export default function Screen30_Reconciliation({ onNavigate, user }) {
  const readOnly = user?.role === 'viewer';
  const { job, loading, error } = useJob();
  const [modules, setModules] = useState([]);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    if (!job) return;
    // one import order everywhere: the server's import list (the order of the Import Wizard)
    try {
      const [list, order] = await Promise.all([api.get(`/migrations/${job.id}/verification`), api.get(`/migrations/${job.id}/imports`).catch(() => [])]);
      setModules(sortByImportOrder(list, order));
    } catch (e) { setLoadError(e.message); }
  }, [job]);
  useEffect(() => { load(); }, [load]);
  useScrollTarget(); // the Import Wizard's last step opens this page at the trial balance comparison

  const checked = modules.filter(m => m.checked);
  const sum = f => checked.reduce((t, m) => t + (f(m) || 0), 0);
  const expected = sum(m => m.expected);
  const matched = sum(m => m.matched);
  const compared = sum(m => m.amountsCompared);

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
      <JobHeader
        title="Reconciliation"
        subtitle="First the trial balance comparison (Zoho Books against Tally), then a report per module: every record arrived and, where the report has an amount, the amount agrees."
        job={job} loading={loading} error={error || loadError} onNavigate={onNavigate}
        action={<button type="button" onClick={() => onNavigate('screen-29')} className={btnPrimary}><span>Identifier Tracker</span><ArrowRight className="w-4 h-4" /></button>}
      />
      {job && isProcessed(job) && <section id="trial-balance" tabIndex={-1} className="scroll-mt-6 focus:outline-none"><ZohoTrialBalance job={job} readOnly={readOnly} /></section>}

      <h2 className="text-[16px] font-semibold tracking-tight text-ink">Records per module</h2>
      <Note title="What this checks">
        <details>
          <summary className="cursor-pointer text-info-ink font-medium">Show how the comparison works</summary>
          <div className="mt-2">
        Records are matched by name or document number. Amounts are then compared for the records that were matched,
        exactly to two decimal places, including the sign. The amount is taken from a report column whose heading contains total, amount, balance or value; each card names the column that was used.
        If the report has no such column, only the records are matched and the card says amounts were not compared. A blank amount in the report counts as not available, not as a difference.
        Chart of Accounts has no amount to compare.
        <div className="mt-2">
          The Zoho report must be a CSV containing the module's identifying column, shown on each card. If that column was renamed in Template Mapping,
          the report must use the heading written in the file that was created. A column ending in "ID" is stored as the Zoho ID.
          If a column that carries the amount was removed from a file's layout, amounts are not compared for that file and the card says so.
          This comparison follows an assumed report format that has not been confirmed against real Zoho Books reports.
        </div>
          </div>
        </details>
      </Note>

      {job && modules.length === 0 && <Blocked title="No files generated yet" text="Verification compares Zoho against the generated files." button="Open Export Center" onClick={() => onNavigate('screen-25')} />}

      {job && modules.length > 0 && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatTile label="Modules checked" value={`${checked.length} of ${modules.length}`} />
            <StatTile label="Records matched" value={`${matched} of ${expected}`} tone={checked.length && matched === expected ? 'success' : undefined} />
            <StatTile label="Records missing or extra" value={sum(m => m.missing + m.extra)} tone={sum(m => m.missing + m.extra) > 0 ? 'danger' : checked.length ? 'success' : undefined} />
            <StatTile label="Amounts that differ" value={compared ? `${sum(m => m.amountsDiffering)} of ${compared}` : 'Not compared'} tone={compared ? (sum(m => m.amountsDiffering) > 0 ? 'danger' : 'success') : undefined} />
          </div>

          {modules.map(m => {
            const absent = m.problems.filter(p => p.status !== 'matched');
            const differing = m.problems.filter(p => p.status === 'matched' && p.amountStatus === 'differs');
            return (
              <Card key={m.key} title={m.module}
                subtitle={m.checked ? `${m.matched} of ${m.expected} found in Zoho · ${m.missing} missing · ${m.extra} extra in Zoho` : `${m.expected} record(s) expected. No Zoho report uploaded yet.`}
                right={(
                  <span className="flex flex-wrap items-center gap-2">
                    {!m.checked ? <StatusChip tone="neutral">No report yet</StatusChip> : m.missing + m.extra > 0 || m.amountsDiffering > 0 ? <StatusChip tone="danger">Needs a look</StatusChip> : <StatusChip tone="success">Matches</StatusChip>}
                    {!readOnly && <FileButton label={m.checked ? 'Upload a newer report' : 'Upload Zoho report'} onFile={async file => { await api.sendFile(`/migrations/${job.id}/verification/${m.key}`, file); await load(); }} />}
                  </span>
                )}>
                <div className="px-4 py-3 text-[14px]">
                  <div className="text-muted">
                    The report must contain a column headed exactly <span className="text-ink font-medium">"{m.idColumn}"</span>.
                    This is the heading of the identifying column as written in the file created for this migration.
                  </div>
                  {m.checked && absent.length === 0 && <div className="mt-2 inline-flex items-center gap-2 text-success-ink font-medium"><CheckCircle2 className="w-4 h-4" /> Every record was found in Zoho Books.</div>}
                  {absent.length > 0 && (
                    <ul className="mt-2 space-y-1.5">
                      {absent.map(p => (
                        <li key={p.status + p.ident} className="flex items-start gap-2">
                          <AlertTriangle className="w-4 h-4 text-danger-ink shrink-0 mt-0.5" />
                          <span><span className="font-medium text-ink">{p.ident}</span> <span className="text-muted">· {PROBLEM[p.status]}</span></span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <Amounts m={m} />
                </div>
                {differing.length > 0 && (
                  <div className="border-t border-line">
                    <h3 className="px-4 pt-3 pb-2 text-[14px] font-semibold text-ink">Records whose amount differs</h3>
                    <Table compact sticky rowKey={p => p.ident} rows={differing}
                      columns={[
                        { key: 'ident', label: 'Record', render: p => <span className="font-medium">{p.ident}</span> },
                        { key: 'expectedAmount', label: 'Expected (generated file)', align: 'right', render: p => money(p.expectedAmount) },
                        { key: 'zohoAmount', label: 'In Zoho report', align: 'right', render: p => money(p.zohoAmount) },
                      ]} />
                  </div>
                )}
              </Card>
            );
          })}
        </>
      )}
    </div>
  );
}
