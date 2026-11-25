import React from 'react';
import { FolderOpen } from 'lucide-react';
import { EmptyState, Note, PageHeader, friendlyError } from './ui';

// Page title plus the active migration, or a prompt to create one. Built on PageHeader (see ui.jsx), so every
// screen that uses it has the same title, help line and right-aligned action.
export default function JobHeader({ title, subtitle, job, loading, error, onNavigate, action, breadcrumb }) {
  return (
    <>
      <PageHeader title={title} help={subtitle} breadcrumb={breadcrumb} actions={job && action ? action : null}>
        {job && (
          <p className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-line bg-white px-3 py-1 text-[13px] text-muted">
            <span className="font-semibold text-ink">{job.company}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-[12px] text-ink">{job.id}</span>
            <span aria-hidden="true">·</span>
            <span>Financial year {job.financial_year}</span>
          </p>
        )}
      </PageHeader>

      {error && <div role="alert"><Note tone="danger">{friendlyError(error)}</Note></div>}

      {!loading && !job && !error && (
        <div className="rounded-lg border border-line bg-white shadow-xs">
          <EmptyState
            icon={FolderOpen}
            title="No migration selected"
            text="Choose a migration from the list at the top of the page or on the Dashboard."
            actionLabel="Go to Dashboard"
            onAction={() => onNavigate('screen-11')}
          />
        </div>
      )}
    </>
  );
}
