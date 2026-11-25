import React from 'react';
import { DocsLayout, DocHeader, DocSection, DocTable, DocItems } from '@/components/layout/DocsLayout';
import { CodeBlock } from '@/components/ui/CodeBlock';

export const DocsTallyPage: React.FC = () => {
  return (
    <DocsLayout
      activeHref="/docs/tally-migration"
      toc={[
        { id: 'schema-mapping', title: 'Field mapping' },
        { id: 'gst-taxonomy', title: 'GST ledgers to tax groups' },
        { id: 'error-codes', title: 'Error codes' },
      ]}
      lastUpdated="Draft, review before publishing"
      prevPage={{ title: 'Browser extension', href: '/docs/browser-extension' }}
      nextPage={{ title: 'MCA form filling', href: '/docs/mca-automation' }}
    >
      <DocHeader
        eyebrow="Technical reference"
        title="Tally to Zoho field mapping"
        description="How fields in a Tally XML export are turned into Zoho Books records, and the error codes you may see along the way."
      />

      <DocSection id="schema-mapping" title="Field mapping">
        <p>These are the main translation rules applied to each ledger in the export:</p>
        <DocTable
          head={['Tally XML field', 'Zoho Books field', 'What happens']}
          monoCols={[0, 1]}
          rows={[
            ['LEDGER.NAME', 'account_name', 'Trimmed, XML entities decoded, duplicates flagged'],
            ['LEDGER.PARENT', 'account_type', 'Matched against Tally’s predefined groups'],
            ['LEDGER.OPENINGBALANCE', 'opening_balance', 'Sign converted (a negative amount is a debit in Tally)'],
            ['LEDGER.PARTYGSTIN', 'gst_treatment, gstin', 'Checksum verified, state code taken from the first two digits'],
          ]}
        />
      </DocSection>

      <DocSection id="gst-taxonomy" title="GST ledgers to tax groups">
        <p>
          Tally usually has one ledger per rate, such as <code>Input CGST 9%</code>. Zoho Books uses tax rates and tax
          groups instead. Matching ledgers are combined into a group like this:
        </p>
        <CodeBlock
          fileName="zoho_tax_group_example.json"
          language="json"
          code={`{
  "tax_name": "GST 18%",
  "tax_percentage": 18.0,
  "tax_type": "tax_group",
  "sub_taxes": [
    { "tax_name": "CGST 9%", "tax_percentage": 9.0, "account_id": "acc_cgst_output_9" },
    { "tax_name": "SGST 9%", "tax_percentage": 9.0, "account_id": "acc_sgst_output_9" }
  ]
}`}
        />
      </DocSection>

      <DocSection id="error-codes" title="Error codes">
        <DocItems
          items={[
            {
              label: <code>ERR_TB_VARIANCE_NONZERO</code>,
              body: 'Total debits do not equal total credits. Check the sign of opening balances.',
            },
            {
              label: <code>ERR_GSTIN_INVALID_CHECKSUM</code>,
              body: 'A GSTIN failed the check-digit test. It is usually a typing error in the party master.',
            },
            {
              label: <code>ERR_DUPLICATE_PARTY_MASTER</code>,
              body: 'Two or more ledgers map to the same customer or vendor but have different PANs.',
            },
          ]}
        />
      </DocSection>
    </DocsLayout>
  );
};
