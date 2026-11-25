import React, { useEffect } from 'react';
import { Map, FileStack, FileCode2, Inbox, Scale, Lightbulb, MessageSquarePlus } from 'lucide-react';
import { PageIntro, Section, SectionTitle, Callout, Btn, FinalCTA, IconBox } from '@/components/product/ProductBlocks';
import { Reveal } from '@/components/motion/Motion';

const PLANS = [
  {
    icon: FileStack,
    title: 'More ROC forms',
    stage: 'Planned',
    body: 'Today we cover AOC-4, ADT-1 and MGT-7. Next we want to cover the event-based forms firms file often, such as director changes and changes in share capital.',
  },
  {
    icon: FileCode2,
    title: 'XBRL financial statements',
    stage: 'Exploring',
    body: 'Companies above the XBRL thresholds file AOC-4 in XBRL. We want to tag the statements from the same data the financial statement tool already prepares.',
  },
  {
    icon: Inbox,
    title: 'Notices tracking',
    stage: 'Exploring',
    body: 'One place to log notices from the tax and ROC departments, with the reply due date, the person handling it and the documents sent.',
  },
  {
    icon: Scale,
    title: 'GST reconciliation',
    stage: 'Planned',
    body: 'Match purchase records against GSTR-2B and list what is missing, what differs and what to follow up with vendors.',
  },
];

export const FutureProductsPage: React.FC = () => {
  useEffect(() => {
    document.title = 'Roadmap · Germin8';
  }, []);

  return (
    <div className="bg-white">
      <PageIntro
        eyebrow="Roadmap"
        eyebrowIcon={Map}
        title="What we are"
        accent="building next"
        description="We automate the finance function one small piece at a time. These are the pieces we plan to work on next. They are plans, not promises, and the order can change based on what people ask for."
      >
        <Btn to="/products/custom-automation" arrow>
          Suggest a tool
        </Btn>
      </PageIntro>

      <Section tone="white" className="pt-6 lg:pt-8">
        <SectionTitle
          title="On the list"
          description="Each of these came from work our users already do by hand every month."
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {PLANS.map((p, i) => (
            <Reveal key={p.title} delay={i * 0.06}>
              <div className="h-full rounded-2xl bg-white ring-1 ring-ink-200 p-7 transition-all duration-300 hover:ring-ink-300 hover:-translate-y-1 hover:shadow-[0_24px_48px_-24px_rgba(23,23,22,0.25)]">
                <div className="flex items-start justify-between gap-4">
                  <IconBox icon={p.icon} />
                  <span className="rounded-full bg-paper ring-1 ring-ink-200 px-3 py-1 text-[13px] font-semibold text-ink-700">
                    {p.stage}
                  </span>
                </div>
                <h3 className="mt-5 text-xl font-bold font-display text-ink-950">{p.title}</h3>
                <p className="mt-2 text-[15.5px] leading-relaxed text-ink-500">{p.body}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal className="mt-10">
          <Callout icon={Lightbulb} title="How we decide what comes next">
            We pick work that is repeated often, follows clear rules and costs firms real hours. If a task fits that
            description for you, tell us about it.
          </Callout>
        </Reveal>
      </Section>

      <Section tone="paper">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-8">
            <SectionTitle
              eyebrow="Your idea"
              eyebrowIcon={MessageSquarePlus}
              title="Missing a tool you need?"
              description="Describe a finance task you repeat every month. If it is specific to you, we can build it as custom automation. If many people need it, it may join this list."
              className="mb-0"
            />
          </div>
          <div className="lg:col-span-4 flex lg:justify-end">
            <Btn to="/products/custom-automation" arrow>
              Suggest a tool
            </Btn>
          </div>
        </div>
      </Section>

      <FinalCTA
        title="Start with what is ready today"
        description="Tally to Zoho migration, office management, incorporation and ROC, and financial statements."
        primary={{ to: '/products', label: 'See the solutions' }}
        secondary={{ to: '/book-a-demo', label: 'Book a demo' }}
      />
    </div>
  );
};
