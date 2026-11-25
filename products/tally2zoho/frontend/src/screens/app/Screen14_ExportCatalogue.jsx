import React, { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { api, useJob } from '../../api';
import JobHeader from '../../components/JobHeader';
import { Card, Note, Table, btnPrimary } from '../../components/ui';

const STATUS = { uploaded: 'Uploaded', missing: 'Not uploaded yet', not_applicable: 'Not applicable' };

export default function Screen14_ExportCatalogue({ onNavigate }) {
  const { job, loading, error } = useJob();
  const [catalogue, setCatalogue] = useState([]);
  useEffect(() => { api.get('/catalogue').then(setCatalogue).catch(() => {}); }, []);

  const status = Object.fromEntries((job?.completeness.slots || []).map(s => [s.key, s.status]));
  const columns = [
    { key: 'name', label: 'Dataset', render: r => <span className="font-medium">{r.name}</span> },
    { key: 'category', label: 'Category' },
    { key: 'report', label: 'Tally report to export' },
    { key: 'requirement', label: 'Needed', render: r => (r.requirement === 'required' ? 'Required' : r.requirement === 'optional' ? 'Optional' : 'If applicable') },
    { key: 'zoho', label: 'Goes to Zoho' },
    ...(job ? [{ key: 'status', label: 'This migration', render: r => STATUS[status[r.key]] || '' }] : []),
  ];

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      <JobHeader
        title="Export Catalogue"
        subtitle="The Tally reports this platform needs, and where each one goes in Zoho Books."
        job={job} loading={loading} error={error} onNavigate={onNavigate}
        action={<button onClick={() => onNavigate('screen-15')} className={`${btnPrimary} self-start`}><span>Upload Center</span><ArrowRight className="w-4 h-4" /></button>}
      />
      <Note><strong className="text-ink">Working list.</strong> This catalogue has not yet been signed off by an accountant or tested against real Tally companies.</Note>
      <Card title={`${catalogue.length} datasets`} subtitle="Required datasets block processing until uploaded. Conditional ones can be marked not applicable.">
        <Table columns={columns} rows={catalogue} rowKey={r => r.key} />
      </Card>
    </div>
  );
}
