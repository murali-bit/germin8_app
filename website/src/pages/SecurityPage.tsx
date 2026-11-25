import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  ShieldCheck,
  Lock,
  Trash2,
  FolderLock,
  UsersRound,
  History,
  MousePointerClick,
  KeyRound,
  ShieldAlert,
  ArrowRight,
  type LucideIcon,
} from 'lucide-react';
import { PageIntro, Section, SectionTitle, IconBox, FinalCTA } from '@/components/product/ProductBlocks';
import { Reveal, TiltCard } from '@/components/motion/Motion';

const PRACTICES: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Lock,
    title: 'Encrypted in transit and at rest',
    body: 'Files and data are encrypted when they travel between your browser and our servers, and again while they are stored.',
  },
  {
    icon: Trash2,
    title: 'Source files used for the job, then deleted',
    body: 'A Tally export or trial balance you upload is used only to do the job you asked for. Once the job is finished, the source file is deleted.',
  },
  {
    icon: FolderLock,
    title: 'Each client in its own workspace',
    body: 'Every client or entity sits in a separate workspace. Data from one client is never mixed with, or visible from, another.',
  },
  {
    icon: UsersRound,
    title: 'Role-based access',
    body: 'You decide who in your team can prepare, who can review and who can approve. People see only the clients they are assigned to.',
  },
  {
    icon: History,
    title: 'Audit history',
    body: 'Uploads, changes, reviews and approvals are recorded with who did them and when, so you can always see how a figure got there.',
  },
];

export const SecurityPage: React.FC = () => {
  useEffect(() => {
    document.title = 'Security · Germin8';
  }, []);

  return (
    <div className="bg-white">
      <PageIntro
        eyebrow="Security"
        eyebrowIcon={ShieldCheck}
        title="How we look after"
        accent="your data"
        description="You trust us with ledgers, client details and company records. This page explains, in plain terms, what we do with that data and what we don’t."
      />

      <Section>
        <SectionTitle
          eyebrow="Our practices"
          title="What happens to your data"
          description="These are the things we do on every job, for every client."
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 [perspective:1400px]">
          {PRACTICES.map((p, i) => (
            <Reveal key={p.title} delay={i * 0.06}>
              <TiltCard max={5} className="h-full">
                <div
                  className="h-full rounded-2xl bg-white ring-1 ring-ink-200 p-7 transition-shadow duration-300 hover:ring-ink-300 hover:shadow-[0_30px_60px_-30px_rgba(23,23,22,0.35)]"
                  style={{ transformStyle: 'preserve-3d' }}
                >
                  <div style={{ transform: 'translateZ(28px)' }}>
                    <IconBox icon={p.icon} />
                  </div>
                  <h3 className="mt-5 text-lg font-bold font-display text-ink-950">{p.title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-ink-500">{p.body}</p>
                </div>
              </TiltCard>
            </Reveal>
          ))}
        </div>
      </Section>

      <Section tone="paper">
        <SectionTitle
          eyebrow="Browser extension"
          eyebrowIcon={MousePointerClick}
          title="The extension does nothing until you"
          accent="click it"
          description="Some of our tools fill forms on government portals through a browser extension. Here is exactly what it does."
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {[
            {
              icon: MousePointerClick,
              title: 'It acts only when you click',
              body: 'The extension stays idle in the background. It fills a form only when you open it and press the button to do so, and only on the page you are looking at.',
            },
            {
              icon: KeyRound,
              title: 'It never reads your portal password',
              body: 'You sign in to the portal yourself. The extension does not read, store or send your portal password, and it does not sign in for you.',
            },
          ].map((p, i) => (
            <Reveal key={p.title} delay={i * 0.08}>
              <div className="h-full flex flex-col sm:flex-row gap-5 rounded-2xl bg-white ring-1 ring-ink-200 p-7 transition-all duration-300 hover:-translate-y-1 hover:ring-ink-300 hover:shadow-[0_24px_48px_-24px_rgba(23,23,22,0.25)]">
                <span className="w-12 h-12 rounded-2xl bg-ink-950 text-mustard-400 flex items-center justify-center shrink-0">
                  <p.icon className="w-5 h-5" strokeWidth={1.6} aria-hidden />
                </span>
                <div>
                  <h3 className="text-lg font-bold font-display text-ink-950">{p.title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-ink-500">{p.body}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal>
          <p className="mt-8 max-w-3xl text-[15.5px] leading-relaxed text-ink-600">
            Filing is always done by a person. The software prepares the data; your accountant or company secretary
            checks it, signs with their own digital signature and submits.
          </p>
        </Reveal>
      </Section>

      <Section>
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl bg-ink-950 px-6 py-10 sm:px-12 sm:py-12 text-white">
            <div aria-hidden className="absolute -right-24 -top-24 w-72 h-72 rounded-full bg-mustard-500/10" />
            <div className="relative flex flex-col lg:flex-row lg:items-center gap-8">
              <span className="w-14 h-14 rounded-2xl bg-mustard-500 text-ink-950 flex items-center justify-center shrink-0">
                <ShieldAlert className="w-6 h-6" strokeWidth={1.6} aria-hidden />
              </span>
              <div className="flex-1">
                <h2 className="text-[26px] sm:text-[30px] font-extrabold font-display tracking-[-0.02em]">
                  Report a security issue
                </h2>
                <p className="mt-2 max-w-2xl text-[16px] leading-relaxed text-ink-300">
                  If you think you have found a weakness in our website, tools or extension, please tell us before
                  sharing it anywhere else. Describe what you found and how to reproduce it, and we will look into it.
                </p>
              </div>
              <Link
                to="/contact"
                className="group inline-flex items-center justify-center gap-2 h-12 px-6 rounded-full bg-mustard-500 hover:bg-mustard-400 text-ink-950 text-[15px] font-bold font-display transition-colors shrink-0"
              >
                Report it
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            </div>
          </div>
        </Reveal>
      </Section>

      <FinalCTA
        title="Have a question about how we handle data?"
        description="Ask us before you upload anything. We’ll explain what happens at each step of the tool you plan to use."
        primary={{ to: '/contact', label: 'Contact us' }}
        secondary={{ to: '/privacy-policy', label: 'Privacy policy' }}
      />
    </div>
  );
};
