import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  LifeBuoy,
  BookOpen,
  FileText,
  HelpCircle,
  MessageSquare,
  Wrench,
  ArrowUpRight,
  Check,
  type LucideIcon,
} from 'lucide-react';
import { PageIntro, Section, SectionTitle, FinalCTA } from '@/components/product/ProductBlocks';
import { Reveal, TiltCard } from '@/components/motion/Motion';

const HUB: { icon: LucideIcon; title: string; body: string; to: string; label: string }[] = [
  {
    icon: BookOpen,
    title: 'Guides',
    body: 'Step-by-step walkthroughs for common jobs, such as preparing a Tally export or running a migration.',
    to: '/guides',
    label: 'Read the guides',
  },
  {
    icon: FileText,
    title: 'Documentation',
    body: 'Reference pages for each tool: what it accepts, what it checks and what it produces.',
    to: '/docs',
    label: 'Open the docs',
  },
  {
    icon: HelpCircle,
    title: 'FAQ',
    body: 'Short answers to the questions people ask us most often.',
    to: '/faq',
    label: 'Read the FAQ',
  },
  {
    icon: Wrench,
    title: 'Free tools',
    body: 'Small tools for everyday finance and compliance work that you can use straight away.',
    to: '/resources/tools',
    label: 'See the tools',
  },
  {
    icon: MessageSquare,
    title: 'Contact us',
    body: 'Can’t find the answer? Send us a message and we’ll reply by email.',
    to: '/contact',
    label: 'Send a message',
  },
];

const CHECKLIST = [
  'Search the guides and FAQ for the error message or step you are stuck on.',
  'Note which tool you were using and which client or company it was for.',
  'Copy the exact error message, or take a screenshot of the screen.',
  'Say what you expected to happen and what happened instead.',
  'For a migration, mention the Tally version the export came from.',
  'Do not send passwords or portal logins. We will never ask for them.',
];

export const SupportPage: React.FC = () => {
  useEffect(() => {
    document.title = 'Support · Germin8';
  }, []);

  return (
    <div className="bg-white">
      <PageIntro
        eyebrow="Support"
        eyebrowIcon={LifeBuoy}
        title="Help with"
        accent="Germin8"
        description="Most answers are already written down. Start with the guides and docs, and write to us if you are still stuck."
      />

      <Section className="pt-6 lg:pt-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 [perspective:1400px]">
          {HUB.map((h, i) => (
            <Reveal key={h.to} delay={i * 0.06}>
              <TiltCard max={5} className="h-full">
                <Link
                  to={h.to}
                  className="group flex h-full flex-col rounded-2xl bg-white ring-1 ring-ink-200 p-7 transition-shadow duration-300 hover:ring-ink-300 hover:shadow-[0_30px_60px_-30px_rgba(23,23,22,0.35)]"
                  style={{ transformStyle: 'preserve-3d' }}
                >
                  <div className="flex items-start justify-between" style={{ transform: 'translateZ(30px)' }}>
                    <span className="w-12 h-12 rounded-2xl bg-ink-950 text-mustard-400 flex items-center justify-center">
                      <h.icon className="w-5 h-5" strokeWidth={1.6} aria-hidden />
                    </span>
                    <span className="w-10 h-10 rounded-full bg-ink-50 ring-1 ring-ink-200 text-ink-950 flex items-center justify-center transition-colors group-hover:bg-mustard-500">
                      <ArrowUpRight className="w-4 h-4" aria-hidden />
                    </span>
                  </div>
                  <h2 className="mt-6 text-[20px] font-extrabold font-display text-ink-950">{h.title}</h2>
                  <p className="mt-1.5 flex-1 text-[15px] leading-relaxed text-ink-500">{h.body}</p>
                  <span className="mt-5 text-[14.5px] font-semibold font-display text-mustard-700 group-hover:text-ink-950">
                    {h.label}
                  </span>
                </Link>
              </TiltCard>
            </Reveal>
          ))}
        </div>
      </Section>

      <Section tone="paper">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14">
          <div className="lg:col-span-5">
            <SectionTitle
              eyebrow="Before you contact us"
              title="A few details that get you an answer"
              accent="sooner"
              description="With these in your message, we can usually reply with a fix instead of a list of questions."
              className="mb-0"
            />
          </div>
          <Reveal className="lg:col-span-7">
            <ul className="rounded-3xl bg-white ring-1 ring-ink-200 divide-y divide-ink-100">
              {CHECKLIST.map((c) => (
                <li key={c} className="flex items-start gap-4 px-5 sm:px-7 py-4">
                  <span className="mt-0.5 w-6 h-6 rounded-full bg-emerald-50 ring-1 ring-emerald-200 text-emerald-600 flex items-center justify-center shrink-0">
                    <Check className="w-3.5 h-3.5" strokeWidth={3} aria-hidden />
                  </span>
                  <span className="text-[15.5px] leading-relaxed text-ink-700">{c}</span>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </Section>

      <FinalCTA
        title="Still stuck?"
        description="Send us the details above and we’ll reply by email."
        primary={{ to: '/contact', label: 'Contact us' }}
        secondary={{ to: '/guides', label: 'Browse guides' }}
      />
    </div>
  );
};
