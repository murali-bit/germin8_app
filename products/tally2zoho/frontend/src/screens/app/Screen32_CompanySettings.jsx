import React, { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { api, useJob, chooseMigration, useScrollTarget } from '../../api';
import JobHeader from '../../components/JobHeader';
import { Card, Table, btnSecondary } from '../../components/ui';
import { GstCodesCard } from './MappingDecisions';

const STATUS = { awaiting_uploads: 'Awaiting uploads', processing: 'Reading your files', processed: 'Processed', generated: 'Files generated' };

export default function Screen32_CompanySettings({ onNavigate }) {
  const { job, loading, error, reload } = useJob();
  useScrollTarget();
  const [jobs, setJobs] = useState([]);
  useEffect(() => { api.get('/migrations').then(setJobs).catch(() => {}); }, []);

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
      <JobHeader title="Company Settings" subtitle="The company and financial year of the selected migration, your firm's GST treatment codes, and every migration you can see."
        job={job} loading={loading} error={error} onNavigate={onNavigate} />

      {job && (
        <Card title="Selected migration" subtitle="These were chosen when the migration was created and are never changed by an uploaded file.">
          <dl className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 text-[14px]">
            {[['Company', job.company], ['GSTIN', job.gstin || 'Not entered'], ['Financial year', job.financial_year], ['Migration method', job.method], ['Source', job.source], ['Destination', job.destination]].map(([l, v]) => (
              <div key={l}><dt className="text-[13px] text-subtle">{l}</dt><dd className="text-ink font-medium">{v}</dd></div>
            ))}
          </dl>
          <div className="px-4 py-3 border-t border-line text-[14px] text-muted flex items-center gap-2">
            <Lock className="w-4 h-4" /> Locked. To use a different company or year, create a new migration.
          </div>
        </Card>
      )}

      <div id="gst-codes" tabIndex={-1} className="scroll-mt-4 focus:outline-none"><GstCodesCard onChanged={reload} /></div>

      <Card title="All migrations" subtitle="One migration covers one company and one financial year.">
        <Table
          empty="No migrations yet."
          rows={jobs}
          rowKey={j => j.id}
          columns={[
            { key: 'id', label: 'Migration', render: j => <span className="font-mono">{j.id}</span> },
            { key: 'company', label: 'Company', render: j => <span className="font-medium">{j.company}</span> },
            { key: 'financial_year', label: 'Financial year' },
            { key: 'status', label: 'Status', render: j => STATUS[j.status] || j.status },
            { key: 'records', label: 'Records', align: 'right', render: j => j.records.toLocaleString() },
            { key: 'open', label: '', render: j => (j.id === job?.id ? <span className="text-subtle">Selected</span>
              : <button className={btnSecondary} onClick={() => chooseMigration(j.id)}>Select</button>) },
          ]}
        />
      </Card>
    </div>
  );
}
