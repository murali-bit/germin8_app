import React from 'react';
import { Building, Fingerprint, History, Layers, Shuffle, ShieldCheck } from 'lucide-react';
import {
  Section,
  SectionTitle,
  ProductHero,
  Stage,
  FeatureRow,
  FeatureCards,
  Steps,
  FeatureList,
  Btn,
  FinalCTA,
  Photo,
  PHOTOS,
} from '@/components/product/ProductBlocks';
import { TrialBalanceScreen, MappingScreen } from '@/components/product/Screens';

export const FinancialMigrationPage: React.FC = () => {
  return (
    <div className="bg-white">
      <ProductHero
        eyebrow="Enterprise migration"
        title="Migrate groups with many companies and many years of data"
        description="For businesses with branches, subsidiaries or long transaction histories. We plan the move with you, test it in a sandbox, then load and reconcile it."
        actions={
          <>
            <Btn to="/book-a-demo" arrow>
              Talk to us
            </Btn>
            <Btn to="/products/tally-to-zoho" variant="secondary">
              Single-company migration
            </Btn>
          </>
        }
        points={['Several entities in one project', 'Past years of transactions', 'Written mapping document']}
        visual={<Photo src={PHOTOS.laptopData} alt="A finance team reviewing figures on a laptop" ratio="aspect-[4/3]" eager />}
      />

      <Section tone="paper">
        <SectionTitle
          eyebrow="Why it's different"
          title="Built for the cases import tools can't handle"
          description="Nested groups, custom voucher numbering and several GST registrations usually break simple CSV imports."
        />
        <FeatureCards
          items={[
            { icon: Building, title: 'Many companies together', body: 'Branch and subsidiary books are migrated in one project, each keeping its own GST registration.' },
            { icon: Fingerprint, title: 'Every balance accounted for', body: 'Each ledger and voucher is fingerprinted before the move and checked after it, so nothing is lost or doubled.' },
            { icon: History, title: 'History kept intact', body: 'Journals, sales and purchase registers and notes keep their original dates and line-level tax.' },
          ]}
        />
      </Section>

      <Section>
        <div className="space-y-20 lg:space-y-28">
          <FeatureRow
            eyebrow="Mapping"
            title="One chart of accounts across the group"
            body={<p>We agree a single structure for the group and map each entity’s ledgers to it. You sign off the mapping document before any data moves.</p>}
            visual={
              <Stage tone="grey">
                <MappingScreen />
              </Stage>
            }
          />
          <FeatureRow
            reverse
            eyebrow="Reconciliation"
            title="Each entity reconciled on its own"
            body={<p>After loading, every entity gets its own trial balance comparison, so your auditors can check them one at a time.</p>}
            visual={
              <Stage tone="grey">
                <TrialBalanceScreen />
              </Stage>
            }
          />
        </div>
      </Section>

      <Section tone="white">
        <SectionTitle eyebrow="Project plan" title="How a project runs" />
        <Steps
          steps={[
            { title: 'Discovery', body: 'We look at your source data, entities and cut-off dates and agree the scope.' },
            { title: 'Mapping document', body: 'A written mapping for accounts, parties, items and taxes, for your sign-off.' },
            { title: 'Trial run', body: 'The full migration runs in a sandbox. We go through the exceptions together.' },
            { title: 'Go-live', body: 'Data is loaded in order, reconciled, and the report is handed over.' },
          ]}
        />
      </Section>

      <Section>
        <SectionTitle eyebrow="Features" title="Everything included" />
        <FeatureList
          groups={[
            {
              title: 'Scope',
              icon: Layers,
              items: ['Several entities in one project', 'Branches and subsidiaries', 'Multi-year transactions', 'Sales and purchase registers', 'Journals, credit and debit notes', 'Separate GST registrations'],
            },
            {
              title: 'Transformation',
              icon: Shuffle,
              items: ['Common chart of accounts', 'Nested groups resolved', 'Custom voucher numbering handled', 'Original voucher dates kept', 'Line-level tax kept', 'Written mapping document'],
            },
            {
              title: 'Assurance',
              icon: ShieldCheck,
              items: ['Fingerprints taken before the move', 'Balances compared after loading', 'Sandbox trial run', 'Exceptions reviewed with your team', 'Loaded in dependency order', 'Report for each entity'],
            },
          ]}
        />
      </Section>

      <FinalCTA
        title="Tell us about your group"
        description="Share how many entities and years you need to move. We’ll come back with a plan and timeline."
        primary={{ to: '/book-a-demo', label: 'Book a call' }}
        secondary={{ to: '/contact', label: 'Contact us' }}
      />
    </div>
  );
};
