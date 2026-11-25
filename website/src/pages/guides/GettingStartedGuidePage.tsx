import React from 'react';
import { DocsLayout, DocHeader, DocSection, DocItems } from '@/components/layout/DocsLayout';

export const GettingStartedGuidePage: React.FC = () => {
  return (
    <DocsLayout
      activeHref="/guides/getting-started"
      toc={[
        { id: 'checklist', title: '1. Before you migrate' },
        { id: 'first-job', title: '2. Run a test job first' },
        { id: 'next-steps', title: '3. Run it for real' },
      ]}
      lastUpdated="Draft, review before publishing"
      prevPage={{ title: 'Set up your account', href: '/guides/account-setup' }}
      nextPage={{ title: 'Checks and mismatches', href: '/guides/data-validation' }}
    >
      <DocHeader
        eyebrow="User guide"
        title="First migration checklist"
        description="A short list of things to finish so your data is clean, backed up and ready to move."
      />

      <DocSection id="checklist" title="1. Before you migrate">
        <DocItems
          items={[
            {
              label: 'Pick a cut-off date',
              body: 'Choose a cut-off (for example 31 March) and stop entering vouchers in Tally after that date until the move is done.',
            },
            {
              label: 'Reconcile the banks',
              body: 'Reconcile every bank ledger up to the cut-off so opening balances match the bank statements.',
            },
            {
              label: 'Clean up GSTINs',
              body: 'Fix party masters that are missing a state or have a PAN where the GSTIN should be.',
            },
          ]}
        />
      </DocSection>

      <DocSection id="first-job" title="2. Run a test job first">
        <p>
          Choose <strong>Staging mode</strong> in Germin8 and upload your export. You get the full comparison report
          without anything being written to your live Zoho Books organisation.
        </p>
      </DocSection>

      <DocSection id="next-steps" title="3. Run it for real">
        <p>
          When the partner has approved the staging report, switch to <strong>Production mode</strong> and run the
          import.
        </p>
      </DocSection>
    </DocsLayout>
  );
};
