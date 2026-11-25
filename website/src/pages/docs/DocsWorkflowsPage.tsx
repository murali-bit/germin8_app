import React from 'react';
import { DocsLayout, DocHeader, DocSection, DocTable } from '@/components/layout/DocsLayout';

export const DocsWorkflowsPage: React.FC = () => {
  return (
    <DocsLayout
      activeHref="/docs/workflows"
      toc={[
        { id: 'state-machines', title: 'Job stages' },
        { id: 'stages', title: 'Safe to resume' },
        { id: 'recovery', title: 'When a check fails' },
      ]}
      lastUpdated="Draft, review before publishing"
      prevPage={{ title: 'MCA form filling', href: '/docs/mca-automation' }}
      nextPage={{ title: 'Connections: Zoho, Tally, MCA', href: '/docs/integrations' }}
    >
      <DocHeader
        eyebrow="Technical reference"
        title="How a job runs"
        description="Every migration or form job moves through the same fixed stages, with a human review before anything is written to your books or a form."
      />

      <DocSection id="state-machines" title="Job stages">
        <DocTable
          head={['Stage', 'What happens']}
          monoCols={[0]}
          rows={[
            ['CREATED', 'The export or document has been uploaded'],
            ['EXTRACTING', 'Data is read from the XML or PDF'],
            ['MAPPING', 'Chart of accounts and GST rules are applied'],
            ['VALIDATING', 'Debits and credits are checked, along with GSTINs and duplicates'],
            ['AWAITING_REVIEW', 'A CA or CS reviews and approves the data'],
            ['EXECUTING', 'Records are imported or the form is filled'],
            ['RECONCILED', 'The comparison report is ready'],
          ]}
        />
      </DocSection>

      <DocSection id="stages" title="Safe to resume">
        <p>
          Each step can be run again without creating duplicates. If the connection drops while invoices are being
          imported, the job checks which records already exist before carrying on.
        </p>
      </DocSection>

      <DocSection id="recovery" title="When a check fails">
        <p>
          If a check fails, the job stops at that stage and shows an error code with a report of what went wrong. Fix
          the issue at the source, then run the stage again.
        </p>
      </DocSection>
    </DocsLayout>
  );
};
