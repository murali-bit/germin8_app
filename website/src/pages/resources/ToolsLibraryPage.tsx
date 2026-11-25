import React, { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Library,
  ArrowUpRight,
  AlertCircle,
  Sparkles,
  ClipboardList,
  Users,
  PlayCircle,
  Check,
  ArrowRight,
  ChevronRight,
} from 'lucide-react';
import { PageIntro, Section, SectionTitle, Container, FinalCTA } from '@/components/product/ProductBlocks';
import { Reveal, TiltCard } from '@/components/motion/Motion';
import { ToolDemo } from '@/components/home/ToolDemo';
import { SOLUTIONS, CUSTOM_SOLUTION, getSolution } from '@/data/solutions';
import { NotFoundPage } from '@/pages/NotFoundPage';

/* ---------------------------------------------------------------------------
   Library: every tool with a brief description, the problem, and ease of use.
   --------------------------------------------------------------------------- */

export const ToolsLibraryPage: React.FC = () => {
  useEffect(() => {
    document.title = 'Tools library · Germin8';
  }, []);

  return (
    <div className="bg-white">
      <PageIntro
        eyebrow="Tools library"
        eyebrowIcon={Library}
        title="Every tool, explained"
        accent="in plain words"
        description="What each tool does, the problem it solves, how easy it is to use and what you need to get started."
      />

      <Container className="pb-20 lg:pb-28">
        <div className="space-y-6">
          {SOLUTIONS.map((s, i) => (
            <Reveal key={s.slug} delay={i * 0.05}>
              <article className="group rounded-3xl bg-white ring-1 ring-ink-200 p-6 sm:p-8 transition-all duration-300 hover:ring-ink-300 hover:shadow-[0_40px_70px_-40px_rgba(23,23,22,0.35)]">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                  {/* Name and summary */}
                  <div className="lg:col-span-4">
                    <span className="w-14 h-14 rounded-2xl bg-ink-950 text-mustard-400 flex items-center justify-center shadow-[0_16px_30px_-14px_rgba(23,23,22,0.7)]">
                      <s.icon className="w-6 h-6" strokeWidth={1.6} />
                    </span>
                    <h2 className="mt-5 text-[26px] font-extrabold font-display tracking-[-0.02em] text-ink-950">{s.name}</h2>
                    <p className="mt-2 text-[15.5px] leading-relaxed text-ink-500">{s.short}</p>
                    <p className="mt-4 inline-flex items-center gap-2 text-[13.5px] text-ink-600">
                      <Users className="w-4 h-4 text-mustard-700" strokeWidth={1.75} />
                      {s.usedBy}
                    </p>
                  </div>

                  {/* Problem */}
                  <div className="lg:col-span-4 rounded-2xl bg-paper ring-1 ring-ink-100 p-5">
                    <p className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-500">
                      <AlertCircle className="w-4 h-4 text-mustard-700" /> The problem
                    </p>
                    <p className="mt-3 text-[15px] leading-relaxed text-ink-800">{s.problem}</p>
                  </div>

                  {/* Ease */}
                  <div className="lg:col-span-4">
                    <p className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-500">
                      <Sparkles className="w-4 h-4 text-mustard-700" /> How easy it is
                    </p>
                    <ul className="mt-3 space-y-3">
                      {s.ease.map((e) => (
                        <li key={e.title} className="flex items-start gap-3">
                          <span className="mt-0.5 w-5 h-5 rounded-full bg-ink-100 text-mustard-800 flex items-center justify-center shrink-0">
                            <Check className="w-3 h-3" strokeWidth={3} />
                          </span>
                          <span className="text-[14.5px] leading-snug text-ink-700">
                            <span className="font-semibold text-ink-950">{e.title}.</span> {e.body}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="mt-7 pt-6 border-t border-ink-100 flex flex-wrap items-center gap-3">
                  <Link
                    to={`/resources/tools/${s.slug}`}
                    className="group/b inline-flex items-center gap-2 h-11 px-5 rounded-full bg-ink-950 hover:bg-ink-800 text-white text-[14.5px] font-semibold font-display transition-colors"
                  >
                    Read the full guide
                    <ArrowRight className="w-4 h-4 transition-transform group-hover/b:translate-x-0.5" />
                  </Link>
                  <Link
                    to={s.href}
                    className="inline-flex items-center gap-2 h-11 px-5 rounded-full ring-1 ring-ink-300 hover:ring-ink-950 text-ink-950 text-[14.5px] font-semibold font-display transition-colors"
                  >
                    Product page
                    <ArrowUpRight className="w-4 h-4" />
                  </Link>
                </div>
              </article>
            </Reveal>
          ))}

          <Reveal>
            <Link
              to={CUSTOM_SOLUTION.href}
              className="group flex flex-col sm:flex-row sm:items-center gap-5 rounded-3xl border-2 border-dashed border-ink-300 bg-ink-50/40 px-7 py-6 hover:border-mustard-500 transition-colors"
            >
              <span className="w-12 h-12 rounded-2xl bg-mustard-500 text-ink-950 flex items-center justify-center shrink-0">
                <CUSTOM_SOLUTION.icon className="w-5 h-5" />
              </span>
              <span className="flex-1">
                <span className="block text-[19px] font-extrabold font-display text-ink-950">Need a tool that is not here?</span>
                <span className="block text-[15px] text-ink-500">{CUSTOM_SOLUTION.short}</span>
              </span>
              <ArrowUpRight className="w-5 h-5 text-ink-700 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </Link>
          </Reveal>
        </div>
      </Container>
    </div>
  );
};

/* ---------------------------------------------------------------------------
   One tool's resource page.
   --------------------------------------------------------------------------- */

export const ToolGuidePage: React.FC = () => {
  const { slug = '' } = useParams();
  const s = getSolution(slug);

  useEffect(() => {
    if (s) document.title = `${s.name}: how it works · Germin8`;
  }, [s]);

  if (!s) return <NotFoundPage />;
  const idx = SOLUTIONS.indexOf(s);
  const next = SOLUTIONS[(idx + 1) % SOLUTIONS.length];

  return (
    <div className="bg-white">
      <section className="relative overflow-hidden pt-28 lg:pt-32 pb-12">
        <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-ink-50/80 to-white" />
        <Container className="relative">
          <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-[13.5px] text-ink-500">
            <Link to="/resources" className="hover:text-ink-950">Resources</Link>
            <ChevronRight className="w-3.5 h-3.5 text-ink-300" />
            <Link to="/resources/tools" className="hover:text-ink-950">Tools library</Link>
            <ChevronRight className="w-3.5 h-3.5 text-ink-300" />
            <span className="text-ink-950 font-medium">{s.name}</span>
          </nav>
          <div className="mt-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-end">
            <div className="lg:col-span-8">
              <span className="w-16 h-16 rounded-2xl bg-ink-950 text-mustard-400 flex items-center justify-center shadow-[0_20px_36px_-16px_rgba(23,23,22,0.7)]">
                <s.icon className="w-7 h-7" strokeWidth={1.5} />
              </span>
              <h1 className="mt-6 text-[38px] sm:text-[52px] font-extrabold font-display tracking-[-0.03em] leading-[1.06] text-ink-950">
                {s.name}
              </h1>
              <p className="mt-4 max-w-2xl text-lg leading-relaxed text-ink-500">{s.description}</p>
            </div>
            <div className="lg:col-span-4 lg:text-right">
              <Link
                to="/book-a-demo"
                className="group inline-flex items-center gap-2 h-12 px-6 rounded-full bg-mustard-500 hover:bg-mustard-400 text-ink-950 text-[15px] font-bold font-display shadow-[0_14px_30px_-12px_rgba(23,23,22,0.23)] transition-colors"
              >
                Book a demo
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </div>
          </div>
        </Container>
      </section>

      <Container className="pb-16">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 [perspective:1400px]">
          {[
            { icon: AlertCircle, title: 'The problem it solves', body: <p className="text-[15.5px] leading-relaxed text-ink-700">{s.problem}</p> },
            {
              icon: Sparkles,
              title: 'How easy it is',
              body: (
                <ul className="space-y-3">
                  {s.ease.map((e) => (
                    <li key={e.title} className="text-[15px] leading-snug text-ink-700">
                      <span className="font-semibold text-ink-950">{e.title}.</span> {e.body}
                    </li>
                  ))}
                </ul>
              ),
            },
            {
              icon: ClipboardList,
              title: 'What you need to start',
              body: (
                <ul className="space-y-2.5">
                  {s.before.map((b) => (
                    <li key={b} className="flex items-start gap-2.5 text-[15px] text-ink-700">
                      <Check className="w-4 h-4 mt-0.5 text-emerald-600 shrink-0" strokeWidth={2.5} />
                      {b}
                    </li>
                  ))}
                </ul>
              ),
            },
          ].map((c, i) => (
            <Reveal key={c.title} delay={i * 0.06}>
              <TiltCard max={5} className="h-full">
                <div className="h-full rounded-2xl bg-white ring-1 ring-ink-200 p-6 hover:ring-ink-300 transition-shadow hover:shadow-[0_30px_60px_-34px_rgba(23,23,22,0.35)]">
                  <span className="w-11 h-11 rounded-full bg-ink-50 ring-1 ring-ink-200 text-mustard-700 flex items-center justify-center">
                    <c.icon className="w-5 h-5" strokeWidth={1.75} />
                  </span>
                  <h2 className="mt-4 mb-3 text-[18px] font-extrabold font-display text-ink-950">{c.title}</h2>
                  {c.body}
                </div>
              </TiltCard>
            </Reveal>
          ))}
        </div>
      </Container>

      {s.demo && (
        <Section tone="paper">
          <SectionTitle eyebrow="Walkthrough" eyebrowIcon={PlayCircle} title="Watch it" accent="step by step" align="center" />
          <Reveal>
            <ToolDemo only={s.demo} className="max-w-5xl mx-auto" />
          </Reveal>
        </Section>
      )}

      <Section>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          <div className="lg:col-span-5">
            <SectionTitle eyebrow="How it works" title="Three steps," accent="start to finish" className="mb-0" />
          </div>
          <ol className="lg:col-span-7 space-y-4">
            {s.how.map((h, i) => (
              <Reveal key={h.title} delay={i * 0.06}>
                <li className="flex gap-5 rounded-2xl ring-1 ring-ink-200 p-5">
                  <span className="w-11 h-11 rounded-full bg-mustard-500 text-ink-950 text-[16px] font-extrabold font-display flex items-center justify-center shrink-0">
                    {i + 1}
                  </span>
                  <span>
                    <span className="block text-[17px] font-bold font-display text-ink-950">{h.title}</span>
                    <span className="block mt-1 text-[15px] text-ink-500">{h.body}</span>
                  </span>
                </li>
              </Reveal>
            ))}
          </ol>
        </div>

        <Link
          to={`/resources/tools/${next.slug}`}
          className="group mt-14 flex items-center justify-between gap-4 rounded-2xl bg-paper ring-1 ring-ink-200 px-6 py-5 hover:ring-ink-300 transition-colors"
        >
          <span>
            <span className="block text-[13px] text-ink-500">Next tool</span>
            <span className="block text-[18px] font-extrabold font-display text-ink-950">{next.name}</span>
          </span>
          <ArrowRight className="w-5 h-5 text-ink-700 transition-transform group-hover:translate-x-1" />
        </Link>
      </Section>

      <FinalCTA
        title={`Try ${s.name.toLowerCase()} on your own data`}
        description="Book a 30-minute demo and bring a real example."
        primary={{ to: '/book-a-demo', label: 'Book a demo' }}
        secondary={{ to: s.href, label: 'Product page' }}
      />
    </div>
  );
};
