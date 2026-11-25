import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, AlertCircle, Workflow, ListChecks, PlayCircle, ArrowUpRight } from 'lucide-react';
import {
  Section,
  SectionTitle,
  Container,
  Eyebrow,
  Steps,
  FinalCTA,
} from '@/components/product/ProductBlocks';
import { Reveal, TiltCard, AuroraGlow } from '@/components/motion/Motion';
import { ToolDemo } from '@/components/home/ToolDemo';
import { SOLUTIONS, getSolution } from '@/data/solutions';
import { NotFoundPage } from '@/pages/NotFoundPage';

/** One page template for every standard solution. Content lives in data/solutions.ts. */
export const SolutionDetailPage: React.FC<{ slug: string }> = ({ slug }) => {
  const s = getSolution(slug);

  useEffect(() => {
    if (s) document.title = `${s.name} · Germin8`;
  }, [s]);

  if (!s) return <NotFoundPage />;
  const others = SOLUTIONS.filter((o) => o.slug !== s.slug);

  return (
    <div className="bg-white">
      {/* Hero */}
      <section className="relative overflow-hidden pt-28 lg:pt-36 pb-14">
        <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-ink-50/80 to-white" />
        <AuroraGlow />
        <Container className="relative text-center">
          <Reveal>
            <Eyebrow icon={s.icon}>{s.name}</Eyebrow>
            <h1 className="mt-5 mx-auto max-w-4xl text-[38px] sm:text-[54px] font-extrabold font-display tracking-[-0.03em] leading-[1.06] text-ink-950">
              {s.headline}
            </h1>
            <p className="mt-6 mx-auto max-w-2xl text-lg leading-relaxed text-ink-500">{s.description}</p>
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              <Link
                to="/book-a-demo"
                className="group inline-flex items-center gap-2 h-14 px-7 rounded-full bg-mustard-500 hover:bg-mustard-400 text-ink-950 text-[16px] font-bold font-display shadow-[0_14px_30px_-12px_rgba(23,23,22,0.23)] transition-all hover:-translate-y-0.5"
              >
                Book a demo
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <a
                href="#demo"
                className="inline-flex items-center gap-2.5 h-14 px-6 rounded-full bg-white ring-1 ring-ink-300 hover:ring-ink-950 text-ink-950 text-[16px] font-semibold font-display transition-all hover:-translate-y-0.5"
              >
                <PlayCircle className="w-5 h-5 text-mustard-600" strokeWidth={1.75} />
                Watch how it works
              </a>
            </div>
          </Reveal>
        </Container>
      </section>

      {/* Demo */}
      {s.demo && (
        <section id="demo" className="pb-20 lg:pb-28 scroll-mt-28">
          <Container>
            <Reveal>
              <ToolDemo only={s.demo} className="max-w-5xl mx-auto" />
            </Reveal>
          </Container>
        </section>
      )}

      {/* Problem */}
      <Section tone="paper">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          <Reveal className="lg:col-span-6">
            <Eyebrow icon={AlertCircle}>The problem</Eyebrow>
            <p className="mt-6 text-[26px] sm:text-[32px] font-extrabold font-display tracking-[-0.025em] leading-[1.2] text-ink-950">
              {s.problem}
            </p>
          </Reveal>
          <Reveal delay={0.1} className="lg:col-span-5 lg:col-start-8">
            <TiltCard>
              <div className="rounded-3xl bg-white ring-1 ring-ink-200 p-7 shadow-[0_30px_60px_-30px_rgba(23,23,22,0.3)]">
                <p className="flex items-center gap-2.5 text-[15px] font-bold font-display text-ink-950">
                  <ListChecks className="w-5 h-5 text-mustard-700" strokeWidth={1.75} />
                  What the software takes over
                </p>
                <ul className="mt-5 space-y-3">
                  {s.automates.map((a) => (
                    <li key={a} className="flex items-center gap-3 text-[15.5px] text-ink-700">
                      <span className="w-2 h-2 rounded-full bg-mustard-500 shrink-0" />
                      {a}
                    </li>
                  ))}
                </ul>
              </div>
            </TiltCard>
          </Reveal>
        </div>
      </Section>

      {/* How it works */}
      <Section>
        <SectionTitle eyebrow="How it works" eyebrowIcon={Workflow} title="Three steps, start to" accent="finish" align="center" />
        <Reveal>
          <Steps steps={s.how} />
        </Reveal>
      </Section>

      {/* Other solutions */}
      <Section tone="paper">
        <SectionTitle eyebrow="More from Germin8" title="The other pieces of the" accent="finance function" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {others.map((o, i) => (
            <Reveal key={o.slug} delay={i * 0.07}>
              <Link
                to={o.href}
                className="group block h-full rounded-2xl bg-white ring-1 ring-ink-200 p-6 transition-all duration-300 hover:-translate-y-1 hover:ring-ink-300 hover:shadow-[0_24px_48px_-24px_rgba(23,23,22,0.25)]"
              >
                <span className="w-12 h-12 rounded-full bg-ink-50 ring-1 ring-ink-200 text-mustard-700 flex items-center justify-center">
                  <o.icon className="w-5 h-5" strokeWidth={1.75} />
                </span>
                <h3 className="mt-5 flex items-center justify-between gap-3 text-[18px] font-extrabold font-display text-ink-950">
                  {o.name}
                  <ArrowUpRight className="w-4 h-4 text-ink-400 group-hover:text-ink-950" />
                </h3>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-500">{o.short}</p>
              </Link>
            </Reveal>
          ))}
        </div>
      </Section>

      <FinalCTA
        title={`See ${s.name.toLowerCase()} on your own data`}
        description="Book a 30-minute demo. Bring a real example and we’ll walk through it together."
        primary={{ to: '/book-a-demo', label: 'Book a demo' }}
        secondary={{ to: '/contact', label: 'Contact us' }}
      />
    </div>
  );
};

export const OfficeManagementPage: React.FC = () => <SolutionDetailPage slug="office-management" />;
export const IncorporationRocPage: React.FC = () => <SolutionDetailPage slug="incorporation-roc" />;
export const FinancialStatementsPage: React.FC = () => <SolutionDetailPage slug="financial-statements" />;
