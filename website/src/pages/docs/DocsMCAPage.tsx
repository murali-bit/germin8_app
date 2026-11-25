import React from 'react';
import { DocsLayout, DocHeader, DocSection, DocItems, DocNote } from '@/components/layout/DocsLayout';
import { CodeBlock } from '@/components/ui/CodeBlock';

export const DocsMCAPage: React.FC = () => {
  return (
    <DocsLayout
      activeHref="/docs/mca-automation"
      toc={[
        { id: 'v3-payload', title: 'The AOC-4 data file' },
        { id: 'schedule-iii-map', title: 'Schedule III mapping' },
        { id: 'validation-hooks', title: 'Checks before filling' },
      ]}
      lastUpdated="Draft, review before publishing"
      prevPage={{ title: 'Tally to Zoho field mapping', href: '/docs/tally-migration' }}
      nextPage={{ title: 'How a job runs', href: '/docs/workflows' }}
    >
      <DocHeader
        eyebrow="Technical reference"
        title="MCA form filling"
        description="The data model behind AOC-4, ADT-1 and MGT-7 on the MCA V3 portal: what is read from your documents, how it maps to the form, and what is checked first."
      />

      <DocSection id="v3-payload" title="The AOC-4 data file">
        <p>
          After your professional approves the figures, they are saved in a structure like the one below. The browser
          extension reads it and fills the form. All values here are sample values.
        </p>
        <CodeBlock
          fileName="aoc4_sample.json"
          language="json"
          code={`{
  "form_type": "AOC_4",
  "portal_version": "V3",
  "company_details": {
    "cin": "U00000XX0000PTC000000",
    "company_name": "Sample Company Private Limited",
    "financial_year_start": "01/04/2023",
    "financial_year_end": "31/03/2024",
    "agm_date": "DD/MM/YYYY"
  },
  "balance_sheet": {
    "equity_share_capital": 0.00,
    "reserves_and_surplus": 0.00,
    "long_term_borrowings": 0.00,
    "trade_payables": 0.00,
    "other_current_liabilities": 0.00,
    "property_plant_equipment": 0.00,
    "inventories": 0.00,
    "trade_receivables": 0.00,
    "cash_and_cash_equivalents": 0.00
  },
  "verification": {
    "auditor_frn": "000000X",
    "auditor_membership_no": "000000",
    "udin": "XXXXXXXXXXXXXXXXXX"
  }
}`}
        />
      </DocSection>

      <DocSection id="schedule-iii-map" title="Schedule III mapping">
        <p>Line items from the audited financial statements are matched to these parts of the form:</p>
        <DocItems
          items={[
            { label: 'Part I: Balance sheet', body: 'Equity and liabilities, and assets.' },
            { label: 'Part II: Statement of profit and loss', body: 'Income and expenses.' },
            { label: 'Corporate social responsibility', body: 'Whether the Section 135 thresholds apply.' },
          ]}
        />
        <DocNote>Each figure is shown next to the line it came from, so the reviewer can check it against the source.</DocNote>
      </DocSection>

      <DocSection id="validation-hooks" title="Checks before filling">
        <p>
          Before any field is filled, the extension checks that each director&rsquo;s DIN is active and DIR-3 KYC is
          up to date, that the job has been approved, and that the AGM date and financial year are filled in. Anything
          that fails is listed so it can be fixed first.
        </p>
      </DocSection>
    </DocsLayout>
  );
};
