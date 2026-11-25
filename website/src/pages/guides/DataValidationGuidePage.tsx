import React from 'react';
import { DocsLayout, DocHeader, DocSection, DocItems } from '@/components/layout/DocsLayout';

export const DataValidationGuidePage: React.FC = () => {
  return (
    <DocsLayout
      activeHref="/guides/data-validation"
      toc={[
        { id: 'validation-rules', title: '1. The checks' },
        { id: 'discrepancy-resolution', title: '2. Fixing a difference' },
        { id: 'gstin-rules', title: '3. GSTIN and state code' },
      ]}
      lastUpdated="Draft, review before publishing"
      prevPage={{ title: 'First migration checklist', href: '/guides/getting-started' }}
      nextPage={{ title: 'Common problems', href: '/guides/troubleshooting' }}
    >
      <DocHeader
        eyebrow="User guide"
        title="Checks and mismatches"
        description="The checks that run before your data goes into Zoho Books or a government form, and what to do when one fails."
      />

      <DocSection id="validation-rules" title="1. The checks">
        <DocItems
          items={[
            {
              label: 'V-101: Debits equal credits',
              body: 'Total debits must equal total credits. If the Tally export has an unposted voucher or an unbalanced closing stock entry, the job stops here.',
            },
            {
              label: 'V-102: GSTIN check digit',
              body: 'Each 15-character GSTIN is tested with the official check-digit method. A wrong character or state prefix is flagged for you to correct.',
            },
            {
              label: 'V-103: One record per party',
              body: 'Parties entered under slightly different names (for example "Sample Traders Ltd" and "Sample Traders Private Limited") are listed so you can merge them.',
            },
          ]}
        />
      </DocSection>

      <DocSection id="discrepancy-resolution" title="2. Fixing a difference">
        <p>
          If the Tally data does not balance, do not force the import. Germin8 produces an exception report that points
          to the voucher or ledger causing the difference, so your accountant can correct it in Tally and export again.
        </p>
      </DocSection>

      <DocSection id="gstin-rules" title="3. GSTIN and state code">
        <p>
          Zoho Books sets the place of supply from the customer&rsquo;s state. Germin8 takes the state code from the
          first two digits of the GSTIN, so invoices raised later carry the right tax.
        </p>
      </DocSection>
    </DocsLayout>
  );
};
