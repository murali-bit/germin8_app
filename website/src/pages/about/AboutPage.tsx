import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Info,
  ArrowUpRight,
  ArrowRight,
  Puzzle,
  Repeat,
  Layers,
  Code2,
  UserRoundCheck,
  Rocket,
  Briefcase,
  Database,
  Target,
} from 'lucide-react';
import {
  PageIntro,
  Section,
  SectionTitle,
  Eyebrow,
  Accent,
  Photo,
  PHOTOS,
  FeatureCards,
  FinalCTA,
  TextLink,
} from '@/components/product/ProductBlocks';
import { Reveal, TiltCard } from '@/components/motion/Motion';
import { SOLUTIONS, CUSTOM_SOLUTION } from '@/data/solutions';

const AUDIENCES = [
  {
    icon: Rocket,
    title: 'Startups',
    to: '/for/startups',
    body:
      'Founders and small finance teams who need their books, filings and statements in order without hiring a large team for work that repeats every month.',
  },
  {
    icon: Briefcase,
    title: 'Practicing consultants',
    to: '/for/consultants',
    body:
      'CA and CS firms that handle the same compliance work for many clients. The software does the preparation; your team does the review and signs off.',
  },
];

export const AboutPage: React.FC = () => {
  useEffect(() => {
    document.title = 'About · Germin8';
  }, []);

  return (
    <div className="bg-white">
      <PageIntro
        eyebrow="About Germin8"
        eyebrowIcon={Info}
        title="A technology company that works on"
        accent="finance"
        description="We are not a finance consulting firm. We build software that takes over finance work, one piece at a time, for startups and for the CA and CS firms that look after them."
      />

      {/* Objective */}
      <Section>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          <Reveal className="lg:col-span-6">
            <Eyebrow icon={Target}>Why we started</Eyebrow>
            <h2 className="mt-5 text-[32px] sm:text-[44px] font-extrabold font-display tracking-[-0.03em] leading-[1.08] text-ink-950">
              Finance and technology used to work apart. We put them <Accent>together</Accent>.
            </h2>
            <div className="mt-6 space-y-4 text-[17px] leading-relaxed text-ink-500">
              <p>
                Finance people know exactly what needs to be done, but they rarely get software built for their
                work. Software people can build almost anything, but they seldom understand a trial balance or a
                filing deadline. So most finance work is still done by hand, in spreadsheets, by skilled people
                who should be spending their time on judgement.
              </p>
              <p>
                Germin8 sits between the two. We understand the work the way an accountant does, and we build the
                software that does it.
              </p>
            </div>
          </Reveal>
          <Reveal delay={0.1} className="lg:col-span-6">
            <Photo
              src={PHOTOS.reviewPair}
              alt="Two people reviewing financial documents at a desk"
              ratio="aspect-[4/3]"
              className="shadow-[0_40px_80px_-40px_rgba(23,23,22,0.45)]"
            />
          </Reveal>
        </div>
      </Section>

      {/* Aim */}
      <Section tone="paper">
        <SectionTitle
          eyebrow="What we aim to do"
          eyebrowIcon={Puzzle}
          title="Automate the finance function,"
          accent="piece by piece"
          description="The whole finance function is too big to automate in one go. Broken into small pieces, each one becomes something software can do well."
        />
        <Reveal>
          <FeatureCards
            items={[
              {
                icon: Layers,
                title: 'Break the work down',
                body: 'We take one job, such as a migration or an annual filing, and split it into the steps a person actually performs.',
              },
              {
                icon: Code2,
                title: 'Build each piece properly',
                body: 'Each step gets software that does it the same way every time, with checks built in where mistakes usually happen.',
              },
              {
                icon: Repeat,
                title: 'Done once, done for good',
                body: 'Once a piece is automated, it stays automated. Next month, and for the next client, nobody has to do it by hand again.',
              },
            ]}
          />
        </Reveal>
      </Section>

      {/* What we are building */}
      <Section>
        <SectionTitle
          eyebrow="What we are building"
          title="Standard tools, and custom work where they"
          accent="don’t fit"
          description="Four standard solutions cover the work most firms and startups share. For anything else, we build the automation for you."
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 [perspective:1400px]">
          {SOLUTIONS.map((s, i) => (
            <Reveal key={s.slug} delay={i * 0.06}>
              <TiltCard max={5} className="h-full">
                <Link
                  to={s.href}
                  className="group flex h-full items-start gap-5 rounded-2xl bg-white ring-1 ring-ink-200 p-6 transition-shadow duration-300 hover:ring-ink-300 hover:shadow-[0_30px_60px_-30px_rgba(23,23,22,0.35)]"
                  style={{ transformStyle: 'preserve-3d' }}
                >
                  <span
                    className="w-12 h-12 rounded-2xl bg-ink-950 text-mustard-400 flex items-center justify-center shrink-0"
                    style={{ transform: 'translateZ(30px)' }}
                  >
                    <s.icon className="w-5 h-5" strokeWidth={1.6} aria-hidden />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[18px] font-extrabold font-display text-ink-950">{s.name}</span>
                    <span className="mt-1 block text-[15px] leading-relaxed text-ink-500">{s.short}</span>
                  </span>
                  <ArrowUpRight
                    className="w-5 h-5 shrink-0 text-ink-400 transition-colors group-hover:text-mustard-700"
                    aria-hidden
                  />
                </Link>
              </TiltCard>
            </Reveal>
          ))}
        </div>
        <Reveal>
          <Link
            to={CUSTOM_SOLUTION.href}
            className="group mt-5 flex flex-col sm:flex-row sm:items-center gap-5 rounded-2xl bg-ink-950 px-6 sm:px-8 py-6 text-white transition-transform duration-300 hover:-translate-y-1"
          >
            <span className="w-12 h-12 rounded-2xl bg-mustard-500 text-ink-950 flex items-center justify-center shrink-0">
              <CUSTOM_SOLUTION.icon className="w-5 h-5" strokeWidth={1.6} aria-hidden />
            </span>
            <span className="flex-1">
              <span className="block text-[19px] font-extrabold font-display">{CUSTOM_SOLUTION.name}</span>
              <span className="block text-[15px] text-ink-300">{CUSTOM_SOLUTION.short}</span>
            </span>
            <span className="inline-flex items-center gap-2 text-[15px] font-semibold font-display text-mustard-400">
              How it works
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" aria-hidden />
            </span>
          </Link>
        </Reveal>
        <Reveal>
          <div className="mt-5 flex flex-col sm:flex-row sm:items-center gap-4 rounded-2xl bg-ink-50 ring-1 ring-ink-200 p-6">
            <span className="w-12 h-12 rounded-full bg-white ring-1 ring-ink-200 text-mustard-700 flex items-center justify-center shrink-0">
              <Database className="w-5 h-5" strokeWidth={1.75} aria-hidden />
            </span>
            <p className="flex-1 text-[15.5px] leading-relaxed text-ink-700">
              We also run a free company and director database. Look up registration details, directors and ROC
              filing dates for any company.
            </p>
            <TextLink to="/companies">Search companies</TextLink>
          </div>
        </Reveal>
      </Section>

      {/* How we work */}
      <Section tone="paper">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          <Reveal className="lg:col-span-5">
            <Eyebrow icon={Code2}>How we work</Eyebrow>
            <h2 className="mt-5 text-[32px] sm:text-[44px] font-extrabold font-display tracking-[-0.03em] leading-[1.08] text-ink-950">
              Software does the work. Your people make the <Accent>calls</Accent>.
            </h2>
          </Reveal>
          <div className="lg:col-span-7 space-y-4 [perspective:1400px]">
            {[
              {
                icon: Code2,
                title: 'Software first',
                body: 'We do not send people to do your work for you. We write software that does it, so the result is the same every time and does not depend on who is on leave.',
              },
              {
                icon: UserRoundCheck,
                title: 'Your professionals keep the judgement',
                body: 'Every tool stops for review where a decision is needed. Your accountant or company secretary checks the output, signs and submits. The software never files anything on its own.',
              },
              {
                icon: Puzzle,
                title: 'Start with one piece',
                body: 'You do not have to change everything at once. Pick the task that costs you the most time, automate it, and add the next one when you are ready.',
              },
            ].map((p, i) => (
              <Reveal key={p.title} delay={i * 0.08}>
                <TiltCard max={4}>
                  <div
                    className="flex flex-col sm:flex-row items-start gap-5 rounded-2xl bg-white ring-1 ring-ink-200 p-6 transition-shadow duration-300 hover:ring-ink-300 hover:shadow-[0_30px_60px_-30px_rgba(23,23,22,0.35)]"
                    style={{ transformStyle: 'preserve-3d' }}
                  >
                    <span
                      className="w-12 h-12 rounded-2xl bg-ink-950 text-mustard-400 flex items-center justify-center shrink-0"
                      style={{ transform: 'translateZ(30px)' }}
                    >
                      <p.icon className="w-5 h-5" strokeWidth={1.6} aria-hidden />
                    </span>
                    <div>
                      <h3 className="text-[18px] font-extrabold font-display text-ink-950">{p.title}</h3>
                      <p className="mt-1.5 text-[15.5px] leading-relaxed text-ink-500">{p.body}</p>
                    </div>
                  </div>
                </TiltCard>
              </Reveal>
            ))}
          </div>
        </div>
      </Section>

      {/* Who it is for */}
      <Section>
        <SectionTitle eyebrow="Who it’s for" title="Built for two kinds of" accent="teams" align="center" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 [perspective:1400px]">
          {AUDIENCES.map((a, i) => (
            <Reveal key={a.title} delay={i * 0.08}>
              <TiltCard max={5} className="h-full">
                <Link
                  to={a.to}
                  className="group block h-full rounded-3xl bg-white ring-1 ring-ink-200 p-8 transition-shadow duration-300 hover:ring-ink-300 hover:shadow-[0_40px_70px_-36px_rgba(23,23,22,0.4)]"
                  style={{ transformStyle: 'preserve-3d' }}
                >
                  <span
                    className="w-14 h-14 rounded-2xl bg-mustard-500 text-ink-950 flex items-center justify-center"
                    style={{ transform: 'translateZ(36px)' }}
                  >
                    <a.icon className="w-6 h-6" strokeWidth={1.6} aria-hidden />
                  </span>
                  <h3 className="mt-6 text-[24px] font-extrabold font-display tracking-[-0.02em] text-ink-950">{a.title}</h3>
                  <p className="mt-2 text-[16px] leading-relaxed text-ink-500">{a.body}</p>
                  <span className="mt-5 inline-flex items-center gap-1.5 text-[15px] font-semibold font-display text-ink-950">
                    Learn more
                    <ArrowRight className="w-4 h-4 text-mustard-600 transition-transform group-hover:translate-x-1" aria-hidden />
                  </span>
                </Link>
              </TiltCard>
            </Reveal>
          ))}
        </div>
      </Section>

      <FinalCTA
        title="Tell us which piece costs you the most time"
        description="We will show you the tool for it, or tell you plainly if it is something we would need to build."
        primary={{ to: '/book-a-demo', label: 'Book a demo' }}
        secondary={{ to: '/contact', label: 'Contact us' }}
      />
    </div>
  );
};
