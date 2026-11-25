import React from 'react';
import { ArrowRightLeft, Landmark, Settings, ListChecks, ShieldCheck, Wrench } from 'lucide-react';
import { DocsLayout, DocHeader, DocSection, DocCards } from '@/components/layout/DocsLayout';

export const GuidesOverviewPage: React.FC = () => {
  return (
    <DocsLayout
      activeHref="/guides"
      toc={[
        { id: 'product-guides', title: 'Step-by-step guides' },
        { id: 'setup-guides', title: 'Setting up' },
        { id: 'checks-guides', title: 'Checks and fixes' },
      ]}
      lastUpdated="Draft, review before publishing"
      nextPage={{ title: 'Move from Tally to Zoho Books', href: '/guides/tally-to-zoho-migration' }}
    >
      <DocHeader
        eyebrow="User guides"
        title="Guides for getting the work done"
        description="Step-by-step walkthroughs for accountants, CA and CS firms, and startup finance teams. Each one follows a real task from start to finish."
      />

      <DocSection id="product-guides" title="Step-by-step guides">
        <DocCards
          items={[
            {
              title: 'Move from Tally to Zoho Books',
              body: 'Export from Tally, check the mapping, import into Zoho Books and compare the trial balances.',
              href: '/guides/tally-to-zoho-migration',
              icon: ArrowRightLeft,
              meta: '12 min read',
            },
            {
              title: 'Prepare AOC-4 and other MCA forms',
              body: 'Look up the company, read figures from the audited statements, review them and fill the form.',
              href: '/guides/mca-automation',
              icon: Landmark,
              meta: '10 min read',
            },
          ]}
        />
      </DocSection>

      <DocSection id="setup-guides" title="Setting up">
        <DocCards
          items={[
            {
              title: 'Set up your account',
              body: 'Add your firm, invite your team, choose who can approve work and connect Zoho Books.',
              href: '/guides/account-setup',
              icon: Settings,
            },
            {
              title: 'First migration checklist',
              body: 'What to finish in Tally before you start: cut-off date, bank reconciliation, GSTIN cleanup.',
              href: '/guides/getting-started',
              icon: ListChecks,
            },
          ]}
        />
      </DocSection>

      <DocSection id="checks-guides" title="Checks and fixes">
        <DocCards
          items={[
            {
              title: 'Checks and mismatches',
              body: 'The checks that run before import, and how to fix a difference in your Tally data.',
              href: '/guides/data-validation',
              icon: ShieldCheck,
            },
            {
              title: 'Common problems',
              body: 'Bad characters in an export, Zoho rate limits, and the MCA form not being ready.',
              href: '/guides/troubleshooting',
              icon: Wrench,
            },
          ]}
        />
      </DocSection>
    </DocsLayout>
  );
};
