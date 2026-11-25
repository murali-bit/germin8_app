import React, { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { api, useJob, formatAmount } from '../../api';
import JobHeader from '../../components/JobHeader';
import { Card, Table, inputClass } from '../../components/ui';

// formatAmount drops the sign; here a negative figure must stay visible.
const money = v => (v == null || v === '' ? '—' : `${Number(v) < 0 ? '-' : ''}${formatAmount(v)}`);

export default function Screen29_IdentifierTracker({ onNavigate }) {
  const { job, loading, error } = useJob();
  const [q, setQ] = useState('');
  const [data, setData] = useState({ total: 0, rows: [] });
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (!job) return;
    const t = setTimeout(() => api.get(`/migrations/${job.id}/crosswalk?q=${encodeURIComponent(q)}`).then(setData).catch(e => setLoadError(e.message)), 250);
    return () => clearTimeout(t);
  }, [job, q]);

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      <JobHeader
        title="Identifier Tracker"
        subtitle="Trace any record from Tally, through the generated file, to Zoho Books."
        job={job} loading={loading} error={error || loadError} onNavigate={onNavigate}
      />
      {job && (
        <Card
          title={`${data.total.toLocaleString()} record(s)`}
          subtitle="Zoho IDs and the amount check appear after you upload a Zoho report in Reconciliation."
          right={
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 text-subtle absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, Tally ID, row key or Zoho ID" className={`${inputClass} pl-9`} />
            </div>
          }
        >
          <Table
            empty="No generated records match. Generate files in the Export Center first."
            rows={data.rows}
            rowKey={r => r.rowKey}
            columns={[
              { key: 'ident', label: 'Record', render: r => <span className="font-medium">{r.ident}</span> },
              { key: 'module', label: 'Zoho module' },
              { key: 'dataset', label: 'From Tally dataset' },
              { key: 'sourceId', label: 'Tally record ID', render: r => <span className="font-mono text-[13px]">{r.sourceId}</span> },
              { key: 'rowKey', label: 'Migration row key', render: r => <span className="font-mono text-[13px]">{r.rowKey}</span> },
              { key: 'zohoId', label: 'Zoho ID', render: r => (r.zohoId ? <span className="font-mono text-[13px]">{r.zohoId}</span> : '') },
              { key: 'status', label: 'Status', render: r => <span className={`whitespace-nowrap ${r.status === 'Pending' ? 'text-muted' : 'font-medium'}`}>{r.status}</span> },
              { key: 'amount', label: 'Amount check', render: r => (
                r.amountStatus === 'differs'
                  ? <span className="whitespace-nowrap font-medium tabular-nums">Expected {money(r.expectedAmount)}, Zoho shows {money(r.zohoAmount)}</span>
                  : r.amountStatus === 'agrees'
                    ? <span className="whitespace-nowrap tabular-nums text-muted">Agrees: {money(r.expectedAmount)}</span>
                    : r.amountStatus === 'not_available'
                      ? <span className="whitespace-nowrap text-muted">No amount in the Zoho report</span>
                      : ''
              ) },
            ]}
          />
        </Card>
      )}
    </div>
  );
}
