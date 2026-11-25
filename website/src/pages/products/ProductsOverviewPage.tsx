import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, LayoutGrid, PlayCircle, ArrowRight } from 'lucide-react';
import { Section, SectionTitle, Container, Eyebrow, Accent, FinalCTA } from '@/components/product/ProductBlocks';
import { Reveal, TiltCard } from '@/components/motion/Motion';
import { ToolDemo } from '@/components/home/ToolDemo';
import { SOLUTIONS, CUSTOM_SOLUTION } from '@/data/solutions';

export const ProductsOverviewPage: React.FC = () => {
  useEffect(() => {
    document.title = 'Solutions · Germin8';
  }, []);

  return (
    <div className="bg-white">
      <section className="relative overflow-hidden pt-28 lg:pt-36 pb-12">
        <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-ink-50/80 to-white" />
        <Container className="relative">
          <Reveal className="max-w-3xl">
            <Eyebrow icon={LayoutGrid}>Solutions</Eyebrow>
            <h1 className="mt-5 text-[40px] sm:text-[56px] font-extrabold font-display tracking-[-0.03em] leading-[1.05] text-ink-950">
              Tools for each piece of the <Accent>finance function</Accent>
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-ink-500">
              Four standard tools you can start using, and custom automation for the work that is specific to you.
            </p>
          </Reveal>
        </Container>
      </section>

      <Container className="pb-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 [perspective:1400px]">
          {SOLUTIONS.map((s, i) => (
            <Reveal key={s.slug} delay={i * 0.07}>
              <TiltCard max={6} className="h-full">
                <Link
                  to={s.href}
                  className="group block h-full rounded-3xl bg-white ring-1 ring-ink-200 p-8 transition-shadow duration-300 hover:ring-ink-300 hover:shadow-[0_40px_70px_-36px_rgba(23,23,22,0.4)]"
                  style={{ transformStyle: 'preserve-3d' }}
                >
                  <div className="flex items-start justify-between" style={{ transform: 'translateZ(36px)' }}>
                    <span className="w-14 h-14 rounded-2xl bg-ink-950 text-mustard-400 flex items-center justify-center shadow-[0_16px_30px_-14px_rgba(23,23,22,0.7)]">
                      <s.icon className="w-6 h-6" strokeWidth={1.6} />
                    </span>
                    <span className="w-11 h-11 rounded-full bg-ink-50 ring-1 ring-ink-200 text-ink-950 flex items-center justify-center transition-colors group-hover:bg-mustard-500">
                      <ArrowUpRight className="w-5 h-5" />
                    </span>
                  </div>
                  <h2 className="mt-7 text-[26px] font-extrabold font-display tracking-[-0.02em] text-ink-950" style={{ transform: 'translateZ(24px)' }}>
                    {s.name}
                  </h2>
                  <p className="mt-2 text-[16px] leading-relaxed text-ink-500">{s.description}</p>
                  <ul className="mt-6 flex flex-wrap gap-2">
                    {s.automates.slice(0, 3).map((a) => (
                      <li key={a} className="rounded-full bg-paper ring-1 ring-ink-200 px-3 py-1 text-[13px] font-medium text-ink-700">
                        {a}
                      </li>
                    ))}
                  </ul>
                </Link>
              </TiltCard>
            </Reveal>
          ))}
        </div>

        <Reveal>
          <Link
            to={CUSTOM_SOLUTION.href}
            className="group mt-6 flex flex-col sm:flex-row sm:items-center gap-5 rounded-3xl bg-ink-950 px-8 py-7 text-white transition-transform duration-300 hover:-translate-y-1"
          >
            <span className="w-14 h-14 rounded-2xl bg-mustard-500 text-ink-950 flex items-center justify-center shrink-0">
              <CUSTOM_SOLUTION.icon className="w-6 h-6" strokeWidth={1.6} />
            </span>
            <span className="flex-1">
              <span className="block text-[22px] font-extrabold font-display">{CUSTOM_SOLUTION.name}</span>
              <span className="block text-[16px] text-ink-300">{CUSTOM_SOLUTION.short}</span>
            </span>
            <span className="inline-flex items-center gap-2 text-[15px] font-semibold font-display text-mustard-400">
              How it works
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            </span>
          </Link>
        </Reveal>
      </Container>

      <Section tone="paper">
        <SectionTitle eyebrow="See them work" eyebrowIcon={PlayCircle} title="Watch each tool in" accent="action" align="center" />
        <Reveal>
          <ToolDemo className="max-w-5xl mx-auto" />
        </Reveal>
      </Section>

      <FinalCTA
        title="Not sure where to start?"
        description="Tell us how your finance work runs today. We’ll point to the piece worth automating first."
        primary={{ to: '/book-a-demo', label: 'Book a demo' }}
        secondary={{ to: '/contact', label: 'Contact us' }}
      />
    </div>
  );
};
