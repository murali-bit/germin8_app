import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, BookOpen, FileCode, Newspaper, HelpCircle, Building2, Library, Wrench } from 'lucide-react';
import { PageIntro, Container, FinalCTA } from '@/components/product/ProductBlocks';
import { Reveal, TiltCard } from '@/components/motion/Motion';
import { SOLUTIONS, CUSTOM_SOLUTION } from '@/data/solutions';

const CARDS = [
  {
    title: 'User guides',
    body: 'Step-by-step walkthroughs: moving from Tally to Zoho Books, preparing MCA forms, setting up your team.',
    href: '/guides',
    icon: BookOpen,
  },
  {
    title: 'Documentation',
    body: 'Requirements, field mappings, job stages and error codes, for the people who set things up.',
    href: '/docs',
    icon: FileCode,
  },
  {
    title: 'Blog',
    body: 'Notes on migration, ROC filings and the finance work we are automating.',
    href: '/blog',
    icon: Newspaper,
  },
  {
    title: 'FAQ',
    body: 'Short answers about what Germin8 does, the Tally to Zoho move and MCA forms.',
    href: '/faq',
    icon: HelpCircle,
  },
  {
    title: 'Company database',
    body: 'Search by company name, CIN or director. See registration details, directors and upcoming ROC dates.',
    href: '/companies',
    icon: Building2,
  },
];

export const ResourcesOverviewPage: React.FC = () => {
  useEffect(() => {
    document.title = 'Resources · Germin8';
  }, []);

  return (
    <div className="bg-white">
      <PageIntro
        eyebrow="Resources"
        eyebrowIcon={Library}
        title="Everything you need to"
        accent="use the tools"
        description="Find the right tool, learn how it works, and get answers when you are stuck."
      />

      <Container className="pb-8">
        <Reveal>
          <Link
            to="/resources/tools"
            className="group relative block overflow-hidden rounded-3xl bg-ink-950 p-7 sm:p-10 text-white transition-transform duration-300 hover:-translate-y-1"
          >
            <div aria-hidden className="absolute -right-24 -top-24 w-80 h-80 rounded-full bg-mustard-500/15" />
            <div className="relative grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
              <div className="lg:col-span-7">
                <span className="inline-flex items-center gap-2 rounded-full ring-1 ring-white/20 px-3.5 py-1 text-[13px] font-semibold font-display text-ink-300">
                  <Wrench className="w-4 h-4" aria-hidden />
                  Tools library
                </span>
                <h2 className="mt-5 text-[30px] sm:text-[40px] font-extrabold font-display tracking-[-0.025em] leading-[1.1]">
                  Every tool, explained
                </h2>
                <p className="mt-4 text-[17px] leading-relaxed text-ink-300 max-w-xl">
                  What each tool does, the problem it solves and how easy it is to use. Start here if you are deciding
                  where to begin.
                </p>
                <span className="mt-7 inline-flex items-center gap-2 h-12 px-6 rounded-xl bg-mustard-500 text-ink-950 text-[15px] font-semibold font-display transition-colors group-hover:bg-mustard-400">
                  Open the tools library
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </span>
              </div>
              <ul className="lg:col-span-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[...SOLUTIONS, CUSTOM_SOLUTION].map((s) => (
                  <li key={s.slug} className="flex items-center gap-3 rounded-2xl bg-white/5 ring-1 ring-white/10 px-4 py-3">
                    <s.icon className="w-5 h-5 shrink-0 text-mustard-400" strokeWidth={1.75} aria-hidden />
                    <span className="text-[14px] font-medium text-white">{s.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Link>
        </Reveal>

        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 [perspective:1400px]">
          {CARDS.map((c, i) => (
            <Reveal key={c.href} delay={i * 0.05}>
              <TiltCard max={5} className="h-full">
                <Link
                  to={c.href}
                  className="group flex h-full flex-col rounded-2xl bg-white ring-1 ring-ink-200 p-7 transition-shadow duration-300 hover:ring-ink-300 hover:shadow-[0_32px_60px_-32px_rgba(23,23,22,0.35)]"
                >
                  <div className="flex items-start justify-between">
                    <span className="w-12 h-12 rounded-full bg-ink-50 ring-1 ring-ink-200 text-mustard-700 flex items-center justify-center">
                      <c.icon className="w-5 h-5" strokeWidth={1.75} aria-hidden />
                    </span>
                    <ArrowUpRight
                      className="w-5 h-5 text-ink-400 transition-colors group-hover:text-ink-950"
                      aria-hidden
                    />
                  </div>
                  <h3 className="mt-5 text-lg font-bold font-display text-ink-950">{c.title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-ink-500">{c.body}</p>
                </Link>
              </TiltCard>
            </Reveal>
          ))}
        </div>
      </Container>

      <FinalCTA
        title="Can't find what you need?"
        description="Ask us. If the answer is useful to others, we will add it here."
        primary={{ to: '/contact', label: 'Contact us' }}
        secondary={{ to: '/book-a-demo', label: 'Book a demo' }}
      />
    </div>
  );
};
