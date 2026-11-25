import React from 'react';
import { DocsLayout, DocHeader, DocSection, DocList, DocSteps, DocNote } from '@/components/layout/DocsLayout';

const FORMS = [
  { form: 'ADT-1', what: 'Auditor appointment', due: '15 days from the AGM' },
  { form: 'AOC-4', what: 'Financial statements', due: '30 days from the AGM' },
  { form: 'MGT-7 / 7A', what: 'Annual return', due: '60 days from the AGM' },
];

export const MCAGuidePage: React.FC = () => {
  return (
    <DocsLayout
      activeHref="/guides/mca-automation"
      toc={[
        { id: 'statutory-deadlines', title: '1. Forms and due dates' },
        { id: 'cin-lookup', title: '2. Look up the company' },
        { id: 'pdf-extraction', title: '3. Read the financial statements' },
        { id: 'human-review', title: '4. Professional review' },
        { id: 'browser-extension', title: '5. Fill the MCA form' },
        { id: 'dsc-submission', title: '6. Sign and submit' },
      ]}
      lastUpdated="Draft, review before publishing"
      prevPage={{ title: 'Move from Tally to Zoho Books', href: '/guides/tally-to-zoho-migration' }}
      nextPage={{ title: 'Set up your account', href: '/guides/account-setup' }}
    >
      <DocHeader
        eyebrow="User guide"
        title="Prepare AOC-4 and other MCA forms"
        description="For company secretaries and chartered accountants preparing AOC-4 (financial statements), ADT-1 (auditor appointment) and MGT-7 (annual return)."
      />

      <div className="mt-8">
        <DocNote tone="warning" title="Who does what">
          Germin8 reads your documents and fills the form fields. Your CA or CS reviews every figure, signs with their
          DSC and submits the form. Acceptance is decided by the Registrar.
        </DocNote>
      </div>

      <DocSection id="statutory-deadlines" title="1. Forms and due dates">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {FORMS.map((f) => (
            <div key={f.form} className="rounded-xl bg-white ring-1 ring-ink-200 p-4">
              <p className="text-[17px] font-bold font-display text-ink-950">{f.form}</p>
              <p className="text-[14px] text-ink-500">{f.what}</p>
              <p className="mt-2 text-[14px] font-semibold text-mustard-700">{f.due}</p>
            </div>
          ))}
        </div>
        <p className="text-[14px] text-ink-500">
          Late filing attracts an additional fee for each day of delay. Check the current fee rules on the MCA website.
        </p>
      </DocSection>

      <DocSection id="cin-lookup" title="2. Look up the company">
        <p>Enter the 21-character Corporate Identity Number (CIN). Germin8 fetches:</p>
        <DocList
          items={[
            'Authorised and paid-up capital from RoC records',
            'Registered office email and the RoC the company falls under',
            'Each director’s DIN and DIR-3 KYC status',
          ]}
        />
      </DocSection>

      <DocSection id="pdf-extraction" title="3. Read the financial statements">
        <p>Upload the signed, audited financial statements as a PDF. Germin8 reads:</p>
        <DocList
          items={[
            'Balance sheet: equity, non-current liabilities, current liabilities and assets',
            'Profit and loss: revenue from operations, employee costs, depreciation and tax',
            'Auditor details: firm registration number (FRN), peer review certificate and UDIN',
          ]}
        />
      </DocSection>

      <DocSection id="human-review" title="4. Professional review">
        <p>
          Every figure is shown next to the line in the PDF it came from. The CA or CS checks each one and approves the
          job before anything is filled into the form.
        </p>
      </DocSection>

      <DocSection id="browser-extension" title="5. Fill the MCA form">
        <p>Sign in to the MCA V3 portal in Chrome or Edge and open the AOC-4 form.</p>
        <DocSteps
          steps={[
            'Click the Germin8 extension icon in your toolbar.',
            'Choose the approved job from the list.',
            <>
              Click <strong>Fill form</strong>. The balance sheet and P&amp;L fields are filled across every tab.
            </>,
          ]}
        />
      </DocSection>

      <DocSection id="dsc-submission" title="6. Sign and submit">
        <p>
          Run the portal&rsquo;s own <strong>Pre-scrutiny</strong> check. When it passes, attach the director and CA or
          CS digital signatures (DSC) with the MCA emSigner utility and submit the form to get your SRN.
        </p>
      </DocSection>
    </DocsLayout>
  );
};
