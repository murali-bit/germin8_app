import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Rocket, Briefcase, ArrowUpRight, ArrowRight, Check, Workflow, type LucideIcon } from 'lucide-react';
import { PageIntro, Section, SectionTitle, Steps, FinalCTA, Photo, PHOTOS } from '@/components/product/ProductBlocks';
import { Reveal, TiltCard } from '@/components/motion/Motion';
import { getSolution, CUSTOM_SOLUTION } from '@/data/solutions';

interface Audience {
  key: 'startups' | 'consultants';
  eyebrow: string;
  icon: LucideIcon;
  title: string;
  accent: string;
  description: string;
  photo: string;
  photoAlt: string;
  pains: { title: string; body: string }[];
  /** Solution slug and why it matters to this audience. */
  fit: { slug: string; why: string }[];
  steps: { title: string; body: string }[];
  points: string[];
}

const TEAM_PHOTO =
  'https://images.unsplash.com/photo-1577962917302-cd874c4e31d2?auto=format&fit=crop&w=1400&q=80';

const AUDIENCES: Record<Audience['key'], Audience> = {
  startups: {
    key: 'startups',
    eyebrow: 'For startups',
    icon: Rocket,
    title: 'A finance function that runs without',
    accent: 'a large finance team',
    description:
      'Get your books, compliance and statements in order early, and keep them that way with software instead of headcount.',
    photo: PHOTOS.teamLaptops,
    photoAlt: 'A startup team working on laptops',
    pains: [
      { title: 'Finance is everyone’s side job', body: 'Founders and early hires end up chasing invoices, dates and documents.' },
      { title: 'Desktop books don’t scale', body: 'A Tally file on one laptop can’t serve a growing team or an investor review.' },
      { title: 'Year-end is a scramble', body: 'Statements and ROC forms are put together by hand under deadline pressure.' },
    ],
    fit: [
      { slug: 'tally-to-zoho', why: 'Move to cloud books your whole team can use.' },
      { slug: 'office-management', why: 'Every compliance date tracked, with reminders.' },
      { slug: 'incorporation-roc', why: 'Annual ROC filings prepared from your documents.' },
      { slug: 'financial-statements', why: 'Statements drafted from the trial balance.' },
    ],
    steps: [
      { title: 'Start with one piece', body: 'Pick the work that hurts most today, usually books or compliance dates.' },
      { title: 'Add the next', body: 'Each tool works on its own, so you add them as you grow.' },
      { title: 'Keep your advisers', body: 'Your CA reviews and signs. The software does the preparation.' },
    ],
    points: ['Books on Zoho from day one', 'Compliance dates tracked for you', 'Statements ready for investors'],
  },
  consultants: {
    key: 'consultants',
    eyebrow: 'For practicing consultants',
    icon: Briefcase,
    title: 'Serve more clients without',
    accent: 'adding staff',
    description:
      'For CA and CS firms. The repeat work across clients is done by software, so your team spends its time on review and advice.',
    photo: TEAM_PHOTO,
    photoAlt: 'A consulting firm in a client meeting',
    pains: [
      { title: 'The same work, every client', body: 'Monthly returns and annual filings are near-identical across your client list.' },
      { title: 'Season peaks', body: 'AOC-4 and MGT-7 deadlines arrive for every company at once.' },
      { title: 'Tracking lives in spreadsheets', body: 'Who is doing what, and what is late, depends on memory.' },
    ],
    fit: [
      { slug: 'office-management', why: 'Tasks created for every client, assigned and tracked.' },
      { slug: 'incorporation-roc', why: 'ROC forms prepared and pre-filled after review.' },
      { slug: 'financial-statements', why: 'Statements drafted for each client from the trial balance.' },
      { slug: 'tally-to-zoho', why: 'Move clients to Zoho Books with balances that match.' },
    ],
    steps: [
      { title: 'Load your clients', body: 'Add each client and what they are registered for.' },
      { title: 'Let tasks appear', body: 'Recurring work and due dates are created across the whole list.' },
      { title: 'Review and sign', body: 'Your team checks the prepared work and signs off as usual.' },
    ],
    points: ['One workspace for every client', 'Filing season without retyping', 'A reviewer on every job'],
  },
};

export const AudiencePage: React.FC<{ audience: Audience['key'] }> = ({ audience }) => {
  const a = AUDIENCES[audience];

  useEffect(() => {
    document.title = `${a.eyebrow} · Germin8`;
  }, [a]);

  return (
    <div className="bg-white">
      <PageIntro eyebrow={a.eyebrow} eyebrowIcon={a.icon} title={a.title} accent={a.accent} description={a.description}>
        <div className="flex flex-wrap justify-center gap-3">
          <Link
            to="/book-a-demo"
            className="group inline-flex items-center gap-2 h-14 px-7 rounded-full bg-mustard-500 hover:bg-mustard-400 text-ink-950 text-[16px] font-bold font-display shadow-[0_14px_30px_-12px_rgba(23,23,22,0.23)] transition-all hover:-translate-y-0.5"
          >
            Book a demo
            <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <Link
            to="/resources/tools"
            className="inline-flex items-center gap-2 h-14 px-6 rounded-full bg-white ring-1 ring-ink-300 hover:ring-ink-950 text-ink-950 text-[16px] font-semibold font-display transition-all hover:-translate-y-0.5"
          >
            See the tools
          </Link>
        </div>
      </PageIntro>

      {/* Photo + points */}
      <section className="pb-20">
        <div className="max-w-7xl mx-auto px-5 sm:px-6 lg:px-8">
          <Reveal>
            <div className="relative">
              <Photo src={a.photo} alt={a.photoAlt} ratio="aspect-[16/9] sm:aspect-[21/9]" className="rounded-3xl" eager />
              <div className="sm:absolute sm:right-6 sm:bottom-6 mt-4 sm:mt-0 rounded-2xl bg-white ring-1 ring-ink-200 p-5 shadow-[0_30px_60px_-30px_rgba(23,23,22,0.45)] sm:max-w-sm">
                <ul className="space-y-2.5">
                  {a.points.map((p) => (
                    <li key={p} className="flex items-center gap-3 text-[15px] font-medium text-ink-950">
                      <span className="w-6 h-6 rounded-full bg-mustard-500 text-ink-950 flex items-center justify-center shrink-0">
                        <Check className="w-3.5 h-3.5" strokeWidth={3} />
                      </span>
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Pains */}
      <Section tone="paper">
        <SectionTitle eyebrow="Sound familiar?" title="Where the time" accent="goes today" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 [perspective:1400px]">
          {a.pains.map((p, i) => (
            <Reveal key={p.title} delay={i * 0.07}>
              <TiltCard max={6} className="h-full">
                <div className="h-full rounded-2xl bg-white ring-1 ring-ink-200 p-7 hover:ring-ink-300 transition-shadow hover:shadow-[0_30px_60px_-34px_rgba(23,23,22,0.35)]">
                  <span className="text-[44px] leading-none font-extrabold font-display text-ink-300">0{i + 1}</span>
                  <h3 className="mt-4 text-[19px] font-extrabold font-display text-ink-950">{p.title}</h3>
                  <p className="mt-2 text-[15.5px] leading-relaxed text-ink-500">{p.body}</p>
                </div>
              </TiltCard>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* Fit */}
      <Section>
        <SectionTitle eyebrow="The tools that fit" title="What Germin8" accent="takes over" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {a.fit.map((f, i) => {
            const s = getSolution(f.slug)!;
            return (
              <Reveal key={f.slug} delay={i * 0.06}>
                <Link
                  to={s.href}
                  className="group flex h-full items-start gap-5 rounded-2xl bg-white ring-1 ring-ink-200 p-6 transition-all duration-300 hover:-translate-y-1 hover:ring-ink-300 hover:shadow-[0_30px_60px_-34px_rgba(23,23,22,0.35)]"
                >
                  <span className="w-14 h-14 rounded-2xl bg-ink-950 text-mustard-400 flex items-center justify-center shrink-0 transition-transform group-hover:-rotate-6">
                    <s.icon className="w-6 h-6" strokeWidth={1.6} />
                  </span>
                  <span className="flex-1">
                    <span className="flex items-center justify-between gap-3 text-[19px] font-extrabold font-display text-ink-950">
                      {s.name}
                      <ArrowUpRight className="w-5 h-5 text-ink-400 group-hover:text-ink-950" />
                    </span>
                    <span className="block mt-1.5 text-[15.5px] leading-relaxed text-ink-500">{f.why}</span>
                  </span>
                </Link>
              </Reveal>
            );
          })}
        </div>
        <Reveal>
          <Link
            to={CUSTOM_SOLUTION.href}
            className="group mt-5 flex items-center justify-between gap-4 rounded-2xl border-2 border-dashed border-ink-300 px-6 py-5 hover:border-mustard-500 transition-colors"
          >
            <span className="text-[15.5px] text-ink-700">
              <span className="font-semibold text-ink-950">Something specific to you?</span> {CUSTOM_SOLUTION.short}
            </span>
            <ArrowRight className="w-5 h-5 text-ink-700 shrink-0 transition-transform group-hover:translate-x-1" />
          </Link>
        </Reveal>
      </Section>

      {/* Steps */}
      <Section tone="paper">
        <SectionTitle eyebrow="Getting started" eyebrowIcon={Workflow} title="How teams like yours" accent="begin" align="center" />
        <Reveal>
          <Steps steps={a.steps} />
        </Reveal>
      </Section>

      <FinalCTA
        title="See what fits your team"
        description="A 30-minute call. Tell us how your finance work runs today and we’ll show you where to start."
        primary={{ to: '/book-a-demo', label: 'Book a demo' }}
        secondary={{ to: '/contact', label: 'Contact us' }}
      />
    </div>
  );
};

export const StartupsPage: React.FC = () => <AudiencePage audience="startups" />;
export const ConsultantsPage: React.FC = () => <AudiencePage audience="consultants" />;
