import React from 'react';
import { DocsLayout, DocHeader, DocSection, DocItems, DocSteps, DocTable, DocNote } from '@/components/layout/DocsLayout';
import { CodeBlock } from '@/components/ui/CodeBlock';

export const TallyMigrationGuidePage: React.FC = () => {
  return (
    <DocsLayout
      activeHref="/guides/tally-to-zoho-migration"
      toc={[
        { id: 'prerequisites', title: '1. Before you start' },
        { id: 'export-tally', title: '2. Export from Tally' },
        { id: 'upload-mapping', title: '3. Upload and check the mapping' },
        { id: 'validation-gate', title: '4. Checks before import' },
        { id: 'execution', title: '5. Import order' },
        { id: 'audit-parity', title: '6. Compare the trial balances' },
      ]}
      lastUpdated="Draft, review before publishing"
      prevPage={{ title: 'All guides', href: '/guides' }}
      nextPage={{ title: 'Prepare AOC-4 and other MCA forms', href: '/guides/mca-automation' }}
    >
      <DocHeader
        eyebrow="User guide"
        title="Move from Tally to Zoho Books"
        description="How to move your chart of accounts, customers, vendors, items and opening balances from TallyPrime or Tally.ERP 9 to Zoho Books, step by step."
      />

      <DocSection id="prerequisites" title="1. Before you start">
        <p>Check that the company file is ready:</p>
        <DocItems
          items={[
            { label: 'Tally version', body: 'TallyPrime (any release) or Tally.ERP 9 (Release 5.0 or later).' },
            {
              label: 'Zoho Books organisation',
              body: 'An Indian edition organisation with the same financial year start as Tally (usually 1 April).',
            },
            { label: 'Backup', body: 'Take a full backup in Tally before you export anything.' },
          ]}
        />
      </DocSection>

      <DocSection id="export-tally" title="2. Export from Tally">
        <p>
          In TallyPrime, go to <strong>Gateway of Tally → Display More Reports → List of Accounts</strong>.
        </p>
        <DocSteps
          steps={[
            <>
              Press <code>Ctrl + E</code> (Export) and choose <strong>Format: XML (Data Interchange)</strong>.
            </>,
            <>
              Set <strong>Include dependent masters</strong> and <strong>Export opening balances</strong> to{' '}
              <strong>Yes</strong>.
            </>,
            <>
              Save the file as <code>Master_Export.xml</code>.
            </>,
          ]}
        />
        <p>A ledger in the export looks like this (sample data):</p>
        <CodeBlock
          fileName="sample_ledger.xml"
          language="xml"
          code={`<TALLYMESSAGE xmlns:UDF="TallyUDF">
  <LEDGER NAME="Sample Traders Pvt Ltd" RESERVEDNAME="">
    <PARENT>Sundry Debtors</PARENT>
    <OPENINGBALANCE>-125000.00</OPENINGBALANCE>
    <ISBILLWISEON>Yes</ISBILLWISEON>
    <PARTYGSTIN>27AAAAA0000A1Z5</PARTYGSTIN>
    <GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>
    <COUNTRYNAME>India</COUNTRYNAME>
    <STATENAME>Maharashtra</STATENAME>
  </LEDGER>
</TALLYMESSAGE>`}
        />
      </DocSection>

      <DocSection id="upload-mapping" title="3. Upload and check the mapping">
        <p>
          Sign in to Germin8, choose <strong>New migration job</strong> and upload <code>Master_Export.xml</code>.
          Tally groups are matched to Zoho Books account types like this:
        </p>
        <DocTable
          head={['Tally group', 'Zoho Books account type', 'Where it goes']}
          monoCols={[0]}
          rows={[
            ['Sundry Debtors', 'Accounts Receivable', 'Customers'],
            ['Sundry Creditors', 'Accounts Payable', 'Vendors'],
            ['Bank Accounts', 'Bank', 'Banking'],
            ['Duties & Taxes', 'Other Current Liability', 'Taxes'],
            ['Stock-in-Hand', 'Stock', 'Items'],
          ]}
        />
        <p>Ledgers under your own sub-groups are placed using their parent group. You confirm any that are unclear.</p>
      </DocSection>

      <DocSection id="validation-gate" title="4. Checks before import">
        <p>Nothing is sent to Zoho Books until these checks pass:</p>
        <DocItems
          items={[
            { label: 'GSTIN format and state code', body: 'Each GSTIN is checked and matched to its state.', status: 'Passed' },
            { label: 'Debits equal credits', body: 'The totals in the export are compared.', status: 'Passed' },
            {
              label: 'Duplicate parties',
              body: 'Parties that are both a customer and a vendor are linked, not duplicated.',
              status: 'Passed',
            },
          ]}
        />
        <p>If a check fails, you see the ledgers involved and what to fix.</p>
      </DocSection>

      <DocSection id="execution" title="5. Import order">
        <p>Records go into Zoho Books in this order, so each one finds what it depends on:</p>
        <DocSteps
          steps={[
            <>
              <strong>Chart of accounts:</strong> asset, liability, equity, income and expense heads.
            </>,
            <>
              <strong>Items:</strong> with HSN/SAC codes and their inventory accounts.
            </>,
            <>
              <strong>Customers and vendors:</strong> with opening receivables and payables attached to each one.
            </>,
            <>
              <strong>Bank accounts:</strong> linked to their opening balances.
            </>,
            <>
              <strong>Opening trial balance:</strong> the remaining opening figures.
            </>,
          ]}
        />
      </DocSection>

      <DocSection id="audit-parity" title="6. Compare the trial balances">
        <p>
          The last step compares the Tally and Zoho Books trial balances ledger by ledger. Total debits should equal
          total credits, and Zoho&rsquo;s <strong>Opening Balance Adjustments</strong> account should be nil.
        </p>
        <DocNote tone="success" title="Comparison report">
          Download the ledger-by-ledger comparison and keep it with your working papers.
        </DocNote>
      </DocSection>
    </DocsLayout>
  );
};
