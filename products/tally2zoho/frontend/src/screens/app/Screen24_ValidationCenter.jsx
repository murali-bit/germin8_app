import React, { useEffect, useState } from 'react';
import { ArrowRight, Scale } from 'lucide-react';
import { api, useJob, isProcessed } from '../../api';
import JobHeader from '../../components/JobHeader';
import FlaggedGroups from '../../components/FlaggedGroups';
import { Blocked, Card, StatusChip, btnPrimary } from '../../components/ui';

// Where to go to fix a flagged item, worked out from its stage, kind and message.
const fixFor = e => {
  if (/^trial_balance|^opening_balances_not_created/.test(e.kind || '')) return ['Open Upload Center', 'screen-15'];
  // Cross-check findings are fixed by correcting the name in Tally and uploading the file again.
  if (e.stage === 'crosscheck') return ['Open Upload Center', 'screen-15'];
  if (/Mapping Studio/.test(e.message)) return ['Open Mapping Studio', 'screen-19'];
  if (/Voucher Classification/.test(e.message)) return ['Open Voucher Classification', 'screen-20'];
  return null;
};

// The Trial Balance flags have a group of their own at the top: a report that does not list every ledger changes what
// can be checked and whether the Opening Balances report is made, so it must not be buried among missing names.
const isTrialBalance = e => /^trial_balance|^opening_balances_not_created/.test(e.kind || '');
const KNOWN_STAGES = ['process', 'crosscheck', 'generate'];

const GROUPS = [
  { key: 'tb', title: 'Trial Balance', subtitle: 'Checks of the Tally Trial Balance report. When it does not list every ledger (Alt+F5, detailed), ledger balances cannot be checked one by one and no Opening Balances report is made: export it again in detail and upload it.', pick: e => isTrialBalance(e) },
  { key: 'process', title: 'Found in the Tally data', subtitle: 'Problems in the source records, such as a voucher whose debits and credits differ.', pick: e => !isTrialBalance(e) && e.stage === 'process' },
  { key: 'crosscheck', title: 'Used in vouchers but missing from your master files', subtitle: 'Ledgers, stock items, units and parties named on vouchers or stock items but not in the master file where they belong. One line per missing name. Correct the name in Tally or upload the complete master file, then read the data again.', pick: e => !isTrialBalance(e) && e.stage === 'crosscheck' },
  { key: 'generate', title: 'Found when preparing Zoho files', subtitle: 'Updated each time the files are created in the Export Center.', pick: e => !isTrialBalance(e) && e.stage === 'generate' },
  { key: 'other', title: 'Other', subtitle: 'Flagged items from any other check.', pick: e => !isTrialBalance(e) && !KNOWN_STAGES.includes(e.stage) },
];

export default function Screen24_ValidationCenter({ onNavigate }) {
  const { job, loading, error } = useJob();
  const [summary, setSummary] = useState(null);
  const [loadError, setLoadError] = useState('');
  const processed = isProcessed(job);
  const jobId = job?.id || null;
  useEffect(() => {
    if (!jobId || !processed) return;
    api.get(`/migrations/${jobId}/summary`).then(setSummary).catch(e => setLoadError(e.message));
  }, [jobId, processed]);

  const exceptions = summary?.exceptions || [];
  // one number for "flagged items" everywhere: the server's count (the Dashboard shows the same)
  const flagged = summary?.counts?.flagged ?? exceptions.length;
  const warnings = summary?.counts?.warnings ?? exceptions.filter(e => e.warning).length;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
      <JobHeader
        title="Validation Center"
        subtitle="Everything the platform flagged, grouped by kind. Nothing here was changed automatically."
        job={job} loading={loading} error={error || loadError} onNavigate={onNavigate}
        action={<button type="button" onClick={() => onNavigate('screen-25')} className={`${btnPrimary} self-start`}><span>Export Center</span><ArrowRight className="w-4 h-4" aria-hidden="true" /></button>}
      />
      {job && !processed && <Blocked title="Data has not been processed yet" text="Upload the Tally files and run processing first." button="Open Completeness Check" onClick={() => onNavigate('screen-16')} />}
      {job && processed && summary && (
        <>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-white p-4 shadow-xs text-[14px] text-ink">
            <StatusChip tone={flagged > 0 ? 'warning' : 'success'} dot>{flagged > 0 ? 'Needs a look' : 'Nothing flagged'}</StatusChip>
            <span>
              <strong className="tabular-nums">{flagged.toLocaleString('en-IN')}</strong> flagged {flagged === 1 ? 'item' : 'items'}
              {warnings > 0 && <span className="text-muted"> ({warnings.toLocaleString('en-IN')} {warnings === 1 ? 'warning' : 'warnings'}, not blocking)</span>}.
            </span>
            <span className="basis-full text-[13px] text-muted">Open a kind to see its items. Names written as in Tally (not cleaned) are warnings only.</span>
          </div>
          {GROUPS.map(g => {
            const items = exceptions.filter(g.pick);
            if (!items.length && (g.key === 'tb' || g.key === 'other')) return null;
            return (
              <Card key={g.key} title={<span className="inline-flex items-center gap-2">{g.key === 'tb' && <Scale className="w-4 h-4 text-muted" aria-hidden="true" />}{g.title} ({items.length.toLocaleString('en-IN')})</span>} subtitle={g.subtitle}>
                <FlaggedGroups items={items} fix={fixFor} onNavigate={onNavigate} />
              </Card>
            );
          })}
        </>
      )}
    </div>
  );
}
