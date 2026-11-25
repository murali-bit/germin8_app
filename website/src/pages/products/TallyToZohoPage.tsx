import React from 'react';
import {
  Cloud,
  Landmark,
  KeyRound,
  FileInput,
  ListTree,
  ShieldCheck,
  Scale,
  Info,
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
} from '@/components/product/ProductBlocks';
import {
  MigrationRunScreen,
  MappingScreen,
  ValidationScreen,
  TrialBalanceScreen,
} from '@/components/product/Screens';
import { FAQAccordion } from '@/components/ui/FAQAccordion';
import { TALLY_ZOHO_FAQS } from '@/data/faqData';

export const TallyToZohoPage: React.FC = () => {
  return (
    <div className="bg-white">
      <ProductHero
        eyebrow="Tally to Zoho Books"
        title="Move your books to Zoho Books without re-entering a ledger"
        description="Upload a Tally export. Germin8 maps it to Zoho Books, checks it, imports it and then proves the trial balance matches."
        actions={
          <>
            <Btn to="/book-a-demo" arrow>
              Book a demo
            </Btn>
            <Btn to="/guides/tally-to-zoho-migration" variant="secondary">
              Read the guide
            </Btn>
          </>
        }
        points={['TallyPrime and Tally.ERP 9', 'No TDL or plugins', 'Report your auditor can keep']}
        visual={
          <Stage>
            <MigrationRunScreen />
          </Stage>
        }
      />

      {/* Why */}
      <Section tone="paper">
        <SectionTitle
          eyebrow="Why teams move"
          title="What you get on Zoho Books"
          description="Tally works well on one computer. Zoho Books is built for teams that work from different places."
        />
        <FeatureCards
          items={[
            { icon: Cloud, title: 'Everyone on the same books', body: 'Branches, your CA and management log in to one set of books. No more sending backup files around.' },
            { icon: Landmark, title: 'Bank feeds and GST in one place', body: 'Connect your bank, raise e-invoices and prepare GST returns where your ledgers already are.' },
            { icon: KeyRound, title: 'Access by role', body: 'Give each person only the parts they need, with a log of who changed what.' },
          ]}
        />
      </Section>

      {/* Feature walk-through */}
      <Section>
        <SectionTitle eyebrow="How it works" title="Each step, on screen" />
        <div className="space-y-20 lg:space-y-28">
          <FeatureRow
            eyebrow="Step 1 · Map"
            title="Tally groups mapped to Zoho Books account types"
            body={
              <p>
                Standard groups such as Sundry Debtors and Duties &amp; Taxes are mapped for you.
                Custom groups are flagged for you to confirm, so nothing is guessed.
              </p>
            }
            bullets={['Customers and vendors set up from party ledgers', 'GST ledgers turned into Zoho tax groups', 'Godowns mapped to Zoho locations']}
            visual={
              <Stage tone="grey">
                <MappingScreen />
              </Stage>
            }
          />
          <FeatureRow
            reverse
            eyebrow="Step 2 · Check"
            title="Errors listed before anything is imported"
            body={
              <p>
                Each check tells you what failed and which record caused it. Fix it in Tally,
                export again, and the check re-runs.
              </p>
            }
            bullets={['GSTIN checksum and state code', 'Debits equal credits', 'Duplicate parties merged', 'Missing HSN / SAC codes']}
            visual={
              <Stage tone="grey">
                <ValidationScreen />
              </Stage>
            }
          />
          <FeatureRow
            eyebrow="Step 3 · Prove"
            title="Trial balance compared, ledger by ledger"
            body={
              <p>
                After the import we read the trial balance back from Zoho Books and compare every
                ledger with Tally. You download the comparison as a report.
              </p>
            }
            bullets={['Difference shown per ledger', 'Opening Balance Adjustments at ₹ 0.00', 'Record counts and mapping tables included']}
            visual={
              <Stage tone="grey">
                <TrialBalanceScreen />
              </Stage>
            }
          />
        </div>
      </Section>

      {/* Order of import */}
      <Section tone="white">
        <SectionTitle
          eyebrow="Import order"
          title="Data goes in the order Zoho Books needs it"
          description="Importing in the wrong order is the most common cause of failed migrations. This is the order we use."
        />
        <Steps
          steps={[
            { title: 'Chart of accounts', body: 'Asset, liability, equity, income and expense accounts.' },
            { title: 'Items', body: 'Stock items with units, HSN/SAC codes and inventory accounts.' },
            { title: 'Customers and vendors', body: 'With GSTIN, PAN, addresses and opening receivables or payables.' },
            { title: 'Bank and cash', body: 'Current, savings and overdraft accounts with their openings.' },
            { title: 'Opening balances', body: 'The remaining trial balance as on your cut-off date.' },
            { title: 'Open invoices and bills', body: 'Unpaid documents with reference numbers, due dates and part payments.' },
          ]}
        />
      </Section>

      {/* Full feature list */}
      <Section>
        <SectionTitle eyebrow="Features" title="Everything included" description="The full list, in one place." />
        <FeatureList
          groups={[
            {
              title: 'What moves',
              icon: FileInput,
              items: [
                'Chart of accounts, standard and custom groups',
                'Customers and vendors with GSTIN and PAN',
                'Billing and shipping addresses, contact persons',
                'Stock items, units and rates',
                'HSN and SAC codes',
                'Opening stock value',
                'Bank, cash and overdraft accounts',
                'Opening trial balance on cut-off date',
                'Unpaid invoices, bills and part payments',
                'Past transactions, if you need them',
              ],
            },
            {
              title: 'How it is mapped',
              icon: ListTree,
              items: [
                'Tally groups to Zoho account types',
                'Rate-wise GST ledgers to Zoho tax groups',
                'Intra-state, inter-state and reverse charge',
                'Place of supply from GSTIN',
                'Same party in Debtors and Creditors merged',
                'Godowns to Zoho locations',
                'Ledger aliases and parents resolved',
                'Tally debit/credit signs converted correctly',
              ],
            },
            {
              title: 'How it is checked',
              icon: ShieldCheck,
              items: [
                'GSTIN checksum',
                'Duplicate party and PAN conflicts',
                'Debits equal credits before import',
                'Import in dependency order',
                'Trial balance read back from Zoho Books',
                'Ledger-by-ledger comparison with Tally',
                'Opening Balance Adjustments kept at zero',
                'Report with counts and mapping tables',
                'Clear error code for every failed check',
              ],
            },
          ]}
        />
      </Section>

      {/* Before you start */}
      <Section tone="paper">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Callout icon={Info} title="Before you start">
            You need a Zoho Books organisation (India edition) with the same financial year as
            Tally, and a full Tally backup taken before you export.
          </Callout>
          <Callout icon={Scale} title="Cut-off or full history?">
            Most firms move masters, opening balances and open invoices as of 1 April. It is quicker
            and easier to audit. Full history is available if you need it.
          </Callout>
        </div>
      </Section>

      {/* FAQ */}
      <Section>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          <div className="lg:col-span-4">
            <SectionTitle eyebrow="FAQ" title="Questions about migration" className="mb-0" />
          </div>
          <div className="lg:col-span-8">
            <FAQAccordion items={TALLY_ZOHO_FAQS} />
          </div>
        </div>
      </Section>

      <FinalCTA
        title="Plan your move to Zoho Books"
        description="In a 30-minute call we’ll look at a sample of your chart of accounts and show you the comparison report."
        primary={{ to: '/book-a-demo', label: 'Book a demo' }}
        secondary={{ to: '/contact', label: 'Contact us' }}
      />
    </div>
  );
};
