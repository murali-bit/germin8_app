import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Wrench, MessagesSquare, PencilRuler, Rocket, FileSpreadsheet, Mail, Globe, Database } from 'lucide-react';
import { Section, SectionTitle, Container, Eyebrow, Steps, FeatureCards, FinalCTA } from '@/components/product/ProductBlocks';
import { Reveal } from '@/components/motion/Motion';

export const CustomAutomationPage: React.FC = () => {
  useEffect(() => {
    document.title = 'Custom automation · Germin8';
  }, []);

  return (
    <div className="bg-white">
      <section className="relative overflow-hidden pt-28 lg:pt-36 pb-16">
        <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-ink-50/80 to-white" />
        <Container className="relative text-center">
          <Reveal>
            <Eyebrow icon={Wrench}>Custom automation</Eyebrow>
            <h1 className="mt-5 mx-auto max-w-4xl text-[38px] sm:text-[54px] font-extrabold font-display tracking-[-0.03em] leading-[1.06] text-ink-950">
              A finance task you repeat every month? We’ll build the software for it.
            </h1>
            <p className="mt-6 mx-auto max-w-2xl text-lg leading-relaxed text-ink-500">
              Our standard tools cover the common work. For everything specific to your business, we design and
              build an automation around the way you already work.
            </p>
            <div className="mt-9 flex justify-center">
              <Link
                to="/contact"
                className="group inline-flex items-center gap-2 h-14 px-7 rounded-full bg-mustard-500 hover:bg-mustard-400 text-ink-950 text-[16px] font-bold font-display shadow-[0_14px_30px_-12px_rgba(23,23,22,0.23)] transition-all hover:-translate-y-0.5"
              >
                Tell us what you repeat
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </div>
          </Reveal>
        </Container>
      </section>

      <Section tone="paper">
        <SectionTitle
          eyebrow="Good candidates"
          title="Work that is worth"
          accent="automating"
          description="If a task follows the same steps each time, software can usually do it."
        />
        <Reveal>
          <FeatureCards
            cols={4}
            items={[
              { icon: FileSpreadsheet, title: 'Spreadsheet routines', body: 'Reports rebuilt by hand every month from the same exports.' },
              { icon: Mail, title: 'Documents in email', body: 'Invoices and statements that are downloaded, read and keyed in.' },
              { icon: Globe, title: 'Portal work', body: 'The same forms filled on a government or bank portal, again and again.' },
              { icon: Database, title: 'Moving data', body: 'Copying figures between two systems that do not talk to each other.' },
            ]}
          />
        </Reveal>
      </Section>

      <Section>
        <SectionTitle eyebrow="How we work" title="From a conversation to a" accent="working tool" align="center" />
        <Reveal>
          <Steps
            steps={[
              { title: 'Show us the task', body: 'Walk us through it once, the way you do it today.' },
              { title: 'We design it with you', body: 'You see the plan and the screens before anything is built.' },
              { title: 'We build and hand over', body: 'You get a working tool, tested on your own data.' },
            ]}
          />
        </Reveal>
        <div className="mt-10 flex flex-wrap justify-center gap-x-10 gap-y-4 text-[15px] text-ink-600">
          {[
            [MessagesSquare, 'One point of contact'],
            [PencilRuler, 'Built around your process'],
            [Rocket, 'Delivered in stages'],
          ].map(([Icon, label]) => {
            const I = Icon as typeof Rocket;
            return (
              <span key={label as string} className="inline-flex items-center gap-2.5">
                <I className="w-5 h-5 text-mustard-700" strokeWidth={1.75} />
                {label as string}
              </span>
            );
          })}
        </div>
      </Section>

      <FinalCTA
        title="Have a task in mind?"
        description="Describe it in a few lines. We’ll tell you honestly whether it is worth automating."
        primary={{ to: '/contact', label: 'Contact us' }}
        secondary={{ to: '/products', label: 'See standard tools' }}
      />
    </div>
  );
};
