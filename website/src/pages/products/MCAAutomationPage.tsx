import React from 'react';
import {
  CalendarClock,
  Keyboard,
  ShieldAlert,
  Building2,
  FileSearch,
  MousePointerClick,
  Gavel,
  FileText,
} from 'lucide-react';
import {
  Section,
  SectionTitle,
  ProductHero,
  Stage,
  FeatureRow,
  FeatureCards,
  Steps,
  FeatureList,
  Callout,
  Btn,
  FinalCTA,
  IconBox,
} from '@/components/product/ProductBlocks';
import {
  FilingTrackerScreen,
  CinLookupScreen,
  ReviewScreen,
  ExtensionScreen,
} from '@/components/product/Screens';
import { FAQAccordion } from '@/components/ui/FAQAccordion';
import { MCA_FAQS } from '@/data/faqData';

const FORMS = [
  {
    code: 'AOC-4',
    name: 'Financial statements',
    law: 'Section 137',
    due: '30 days from AGM',
    body: 'Balance sheet, profit and loss and notes, taken from the audited PDF.',
  },
  {
    code: 'ADT-1',
    name: 'Auditor appointment',
    law: 'Section 139',
    due: '15 days from AGM',
    body: 'Auditor details, with firm registration number, membership number and PAN checked.',
  },
  {
    code: 'MGT-7 / 7A',
    name: 'Annual return',
    law: 'Section 92',
    due: '60 days from AGM',
    body: 'Shareholding, capital, director attendance and borrowings from your registers.',
  },
];

export const MCAAutomationPage: React.FC = () => {
  return (
    <div className="bg-white">
      <ProductHero
        eyebrow="MCA filing"
        title="Prepare AOC-4, ADT-1 and MGT-7 without retyping the accounts"
        description="Upload the audited statements. Germin8 extracts the figures, checks the company and directors, and fills in the MCA V3 form after your professional approves it."
        actions={
          <>
            <Btn to="/book-a-demo" arrow>
              Book a demo
            </Btn>
            <Btn to="/guides/mca-automation" variant="secondary">
              Read the AOC-4 guide
            </Btn>
          </>
        }
        points={['Every figure reviewed before it is used', 'Works inside the MCA V3 portal', 'You sign and submit']}
        visual={
          <Stage>
            <FilingTrackerScreen />
          </Stage>
        }
      />

      {/* Forms */}
      <Section tone="paper">
        <SectionTitle eyebrow="Supported forms" title="The three annual filings" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {FORMS.map((f) => (
            <div key={f.code} className="rounded-2xl bg-white ring-1 ring-ink-200 p-6">
              <div className="flex items-center justify-between">
                <IconBox icon={FileText} />
                <span className="text-sm text-ink-500">{f.law}</span>
              </div>
              <h3 className="mt-5 text-2xl font-bold font-display text-ink-950">{f.code}</h3>
              <p className="text-[15px] font-semibold text-mustard-700">{f.name}</p>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-500">{f.body}</p>
              <div className="mt-5 pt-4 border-t border-ink-100 flex items-center gap-2 text-sm text-ink-700">
                <CalendarClock className="w-4 h-4 text-ink-400" />
                Due {f.due}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Problem */}
      <Section>
        <SectionTitle
          eyebrow="The problem"
          title="Why filing season takes so long"
          description="Most of the time goes on typing and on errors found too late."
        />
        <FeatureCards
          items={[
            { icon: CalendarClock, title: 'Late fees add up', body: 'Missing a due date means additional fees for each day, for each form, for each client.' },
            { icon: Keyboard, title: 'Everything is typed by hand', body: 'The V3 form has many tabs and hundreds of fields. A session timeout can lose what you have entered.' },
            { icon: ShieldAlert, title: 'Errors appear at the end', body: 'An inactive DIN or overdue KYC is often found only after the form is filled in.' },
          ]}
        />
      </Section>

      {/* Walk-through */}
      <Section tone="paper">
        <SectionTitle eyebrow="How it works" title="Each step, on screen" />
        <div className="space-y-20 lg:space-y-28">
          <FeatureRow
            eyebrow="Step 1 · Look up the company"
            title="Start with the CIN"
            body={
              <p>
                Enter the CIN and Germin8 fetches the company details and its directors. Anything
                that would stop the filing, like an overdue DIR-3 KYC, is flagged straight away.
              </p>
            }
            bullets={['Authorised and paid-up capital', 'Registered office and RoC', 'Director DIN and KYC status', 'Strike-off check']}
            visual={
              <Stage tone="grey">
                <CinLookupScreen />
              </Stage>
            }
          />
          <FeatureRow
            reverse
            eyebrow="Step 2 · Review the figures"
            title="Every number sits next to its source"
            body={
              <p>
                Figures are taken from the audited PDF and shown beside the page they came from.
                Your CA or CS checks them and approves the job. Nothing is filled in before that.
              </p>
            }
            bullets={['Schedule III balance sheet and P&L', 'Totals that don’t add up are highlighted', 'Approval recorded with name and time']}
            visual={
              <Stage tone="grey">
                <ReviewScreen />
              </Stage>
            }
          />
          <FeatureRow
            eyebrow="Step 3 · Fill the form"
            title="The extension types it into the portal"
            body={
              <p>
                Log in to the MCA V3 portal as usual and open the form. Choose the approved job in
                the Germin8 extension and it fills in the fields across every tab.
              </p>
            }
            bullets={['Chrome and Edge', 'Runs only when you click', 'Never sees your portal password']}
            visual={
              <Stage tone="grey" className="pt-10 sm:pt-8">
                <ExtensionScreen />
              </Stage>
            }
          />
        </div>
      </Section>

      {/* Steps */}
      <Section tone="white">
        <SectionTitle eyebrow="Start to finish" title="Seven steps to a filed form" />
        <Steps
          steps={[
            { title: 'Look up the company', body: 'Enter the CIN to load capital, office and directors.' },
            { title: 'Upload statements', body: 'Add the signed, audited financial statements as PDF.' },
            { title: 'Map to the form', body: 'Figures are matched to form fields; mismatches are flagged.' },
            { title: 'Professional review', body: 'Your CA or CS checks each figure and approves.' },
            { title: 'Fill the form', body: 'The extension enters the approved data in the portal.' },
            { title: 'Pre-scrutiny', body: 'Run the portal’s own pre-scrutiny check.' },
            { title: 'Sign and submit', body: 'Directors and the professional sign with DSC. The SRN is saved to the job.' },
          ]}
        />
      </Section>

      {/* Full feature list */}
      <Section>
        <SectionTitle eyebrow="Features" title="Everything included" />
        <FeatureList
          groups={[
            {
              title: 'Company checks',
              icon: Building2,
              items: [
                'Lookup by CIN',
                'Authorised and paid-up capital',
                'Registered office and RoC',
                'Director DINs',
                'DIR-3 KYC status',
                'Strike-off check',
                'Previous SRNs',
                'AGM date checked against Section 96',
              ],
            },
            {
              title: 'Reading the statements',
              icon: FileSearch,
              items: [
                'Balance sheet (Schedule III Part I)',
                'Profit and loss (Schedule III Part II)',
                'Revenue, employee costs, depreciation, tax',
                'Auditor FRN, peer review and UDIN',
                'CSR applicability under Section 135',
                'Totals checked for arithmetic errors',
              ],
            },
            {
              title: 'Review and filing',
              icon: MousePointerClick,
              items: [
                'Side-by-side review with the PDF',
                'Named reviewer approves each job',
                'Browser extension for Chrome and Edge',
                'Fills every tab of the V3 form',
                'Due dates worked out from the AGM',
                'Tracker for all clients in the season',
                'Preparer and reviewer roles',
                'SRN and history saved per filing',
              ],
            },
          ]}
        />
      </Section>

      <Section tone="paper" className="py-12 lg:py-14">
        <Callout icon={Gavel} title="What Germin8 does not do">
          Germin8 does not submit forms or sign them. Your professional reviews the data, the
          directors and professional sign with their DSCs, and you submit on the portal. No
          software can guarantee that the RoC will approve a filing.
        </Callout>
      </Section>

      {/* FAQ */}
      <Section>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          <div className="lg:col-span-4">
            <SectionTitle eyebrow="FAQ" title="Questions about MCA filing" className="mb-0" />
          </div>
          <div className="lg:col-span-8">
            <FAQAccordion items={MCA_FAQS} />
          </div>
        </div>
      </Section>

      <FinalCTA
        title="Get ready for filing season"
        description="We’ll take one of your audited balance sheets through review and form filling for AOC-4, live."
        primary={{ to: '/book-a-demo', label: 'Book a demo' }}
        secondary={{ to: '/contact', label: 'Contact us' }}
      />
    </div>
  );
};
