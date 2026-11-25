import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Cpu,
  Puzzle,
  CircleCheckBig,
  LayoutGrid,
  PlayCircle,
  Database,
  Users,
  Rocket,
  Briefcase,
  ArrowUpRight,
  ArrowRight,
  HelpCircle,
  Building2,
  Check,
  type LucideIcon,
} from 'lucide-react';
import { HomeHero } from '@/components/home/HomeHero';
import { FinanceMap } from '@/components/home/FinanceMap';
import { ToolDemo } from '@/components/home/ToolDemo';
import { CompanySearch } from '@/components/company/CompanySearch';
import { Reveal, TiltCard, AuroraGlow } from '@/components/motion/Motion';
import { Section, SectionTitle, Container, Eyebrow, Accent, Photo, FinalCTA, PHOTOS } from '@/components/product/ProductBlocks';
import { FAQAccordion } from '@/components/ui/FAQAccordion';
import { GENERAL_FAQS } from '@/data/faqData';
import { COMPANIES } from '@/data/companies';
import { CUSTOM_SOLUTION } from '@/data/solutions';

const PRINCIPLES: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Cpu,
    title: 'Technology first',
    body: 'We are engineers working in finance. We build software, we don’t sell hours.',
  },
  {
    icon: Puzzle,
    title: 'One piece at a time',
    body: 'Finance is split into small jobs. Each one gets its own tool that does that job well.',
  },
  {
    icon: CircleCheckBig,
    title: 'Done once, done for good',
    body: 'When a piece is automated it stays automated. You stop doing that work by hand.',
  },
];

const TEAM_PHOTO =
  'https://images.unsplash.com/photo-1577962917302-cd874c4e31d2?auto=format&fit=crop&w=1200&q=80';

const AUDIENCES: { icon: LucideIcon; title: string; body: string; points: string[]; to: string; photo: string; alt: string }[] = [
  {
    icon: Rocket,
    title: 'Startups',
    body: 'Set up a finance function that runs itself, before you need a large finance team.',
    points: ['Books on Zoho from day one', 'Compliance dates tracked for you', 'Statements ready for investors'],
    to: '/for/startups',
    photo: PHOTOS.teamLaptops,
    alt: 'A startup team working on laptops',
  },
  {
    icon: Briefcase,
    title: 'Practicing consultants',
    body: 'Serve more clients without adding staff. The repeat work is done by the software.',
    points: ['One workspace for every client', 'Filing season without retyping', 'A reviewer on every job'],
    to: '/for/consultants',
    photo: TEAM_PHOTO,
    alt: 'A consulting firm in a client meeting',
  },
];

export const HomePage: React.FC = () => {
  useEffect(() => {
    document.title = 'Germin8 · Technology for the finance function';
  }, []);

  const sample = COMPANIES[0];

  return (
    <div className="bg-white">
      <HomeHero />

      {/* Who we are */}
      <Section>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          <Reveal className="lg:col-span-6">
            <Eyebrow icon={Users}>Who we are</Eyebrow>
            <p className="mt-6 text-[30px] sm:text-[40px] font-extrabold font-display tracking-[-0.03em] leading-[1.14] text-ink-950">
              Finance and technology used to work apart. We put them <Accent>together</Accent>.
            </p>
            <p className="mt-6 text-lg leading-relaxed text-ink-500">
              Germin8 is not another finance consulting firm. We build tools that take over finance work end to
              end, and we build custom automation where a standard tool does not fit.
            </p>
            <Link to="/about" className="group mt-7 inline-flex items-center gap-2 text-[15px] font-semibold font-display text-ink-950">
              More about us
              <ArrowRight className="w-4 h-4 text-mustard-600 transition-transform group-hover:translate-x-1" />
            </Link>
          </Reveal>

          <div className="lg:col-span-6 space-y-4 [perspective:1400px]">
            {PRINCIPLES.map((p, i) => (
              <Reveal key={p.title} delay={i * 0.1}>
                <TiltCard max={5}>
                  <div
                    className="flex items-start gap-5 rounded-2xl bg-white ring-1 ring-ink-200 p-6 transition-shadow duration-300 hover:ring-ink-300 hover:shadow-[0_30px_60px_-30px_rgba(23,23,22,0.35)]"
                    style={{ transformStyle: 'preserve-3d', marginLeft: `${i * 28}px` }}
                  >
                    <span
                      className="w-14 h-14 rounded-2xl bg-ink-950 text-mustard-400 flex items-center justify-center shrink-0 shadow-[0_16px_30px_-14px_rgba(23,23,22,0.7)]"
                      style={{ transform: 'translateZ(40px)' }}
                    >
                      <p.icon className="w-6 h-6" strokeWidth={1.6} />
                    </span>
                    <div style={{ transform: 'translateZ(20px)' }}>
                      <h3 className="text-[19px] font-extrabold font-display text-ink-950">{p.title}</h3>
                      <p className="mt-1.5 text-[15.5px] leading-relaxed text-ink-500">{p.body}</p>
                    </div>
                  </div>
                </TiltCard>
              </Reveal>
            ))}
          </div>
        </div>
      </Section>

      {/* Finance function in pieces */}
      <Section tone="paper" id="solutions">
        <SectionTitle
          eyebrow="Solutions"
          eyebrowIcon={LayoutGrid}
          title="The finance function,"
          accent="piece by piece"
          description="Point at a solution to see the pieces of work it takes off your desk."
          align="center"
        />
        <Reveal>
          <FinanceMap />
        </Reveal>
      </Section>

      {/* Tool demos */}
      <Section id="demos">
        <SectionTitle
          eyebrow="See the tools"
          eyebrowIcon={PlayCircle}
          title="Short walkthroughs of"
          accent="each tool"
          description="Pick a tool and watch what it does, step by step."
          align="center"
        />
        <Reveal>
          <ToolDemo className="max-w-5xl mx-auto" />
        </Reveal>
      </Section>

      {/* Company database */}
      <Section tone="paper">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          <Reveal className="lg:col-span-6">
            <Eyebrow icon={Database}>Company database</Eyebrow>
            <h2 className="mt-5 text-[34px] sm:text-[46px] font-extrabold font-display tracking-[-0.03em] leading-[1.08] text-ink-950">
              Look up any company and its <Accent>directors</Accent>
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-ink-500">
              Registration details, directors and upcoming ROC filing dates on one page. Search by company name,
              CIN or director.
            </p>
            <CompanySearch className="mt-8 max-w-xl" />
            <Link to="/companies" className="group mt-5 inline-flex items-center gap-2 text-[15px] font-semibold font-display text-ink-950">
              Open the company database
              <ArrowRight className="w-4 h-4 text-mustard-600 transition-transform group-hover:translate-x-1" />
            </Link>
          </Reveal>

          <Reveal delay={0.1} className="lg:col-span-6 [perspective:1400px]">
            <TiltCard max={7}>
              <Link
                to={`/company/${sample.slug}`}
                className="block rounded-3xl bg-white ring-1 ring-ink-200 p-7 shadow-[0_40px_80px_-40px_rgba(23,23,22,0.4)]"
                style={{ transformStyle: 'preserve-3d' }}
              >
                <div className="flex items-start gap-4" style={{ transform: 'translateZ(30px)' }}>
                  <span className="w-12 h-12 rounded-2xl bg-ink-950 text-mustard-400 flex items-center justify-center shrink-0">
                    <Building2 className="w-6 h-6" strokeWidth={1.5} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[18px] font-extrabold font-display leading-snug text-ink-950">{sample.name}</p>
                    <p className="mt-0.5 text-[13px] font-mono text-ink-500 truncate">{sample.cin}</p>
                  </div>
                  <span className="ml-auto rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 px-2.5 py-1 text-[12px] font-semibold">
                    {sample.status}
                  </span>
                </div>
                <ul className="mt-6 divide-y divide-ink-100" style={{ transform: 'translateZ(16px)' }}>
                  {sample.directors.map((d) => (
                    <li key={d.din} className="flex items-center gap-3 py-3">
                      <span className="w-9 h-9 rounded-full bg-ink-100 text-ink-950 text-[12px] font-bold font-display flex items-center justify-center">
                        {d.name.split(' ').map((p) => p[0]).join('')}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[14.5px] font-semibold text-ink-950">{d.name}</span>
                        <span className="block text-[12.5px] text-ink-500">{d.designation}</span>
                      </span>
                      <span className="text-[12.5px] font-mono text-ink-500">DIN {d.din}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-[12.5px] text-ink-400">Sample record. Company and people are not real.</p>
              </Link>
            </TiltCard>
          </Reveal>
        </div>
      </Section>

      {/* Who it's for */}
      <Section>
        <SectionTitle eyebrow="Who it’s for" eyebrowIcon={Users} title="Built for two kinds of" accent="teams" align="center" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {AUDIENCES.map((a, i) => (
            <Reveal key={a.title} delay={i * 0.1}>
              <Link
                to={a.to}
                className="group block h-full rounded-3xl bg-white ring-1 ring-ink-200 p-3 transition-all duration-300 hover:-translate-y-1.5 hover:ring-ink-300 hover:shadow-[0_40px_70px_-36px_rgba(23,23,22,0.4)]"
              >
                <div className="relative overflow-hidden rounded-2xl">
                  <Photo src={a.photo} alt={a.alt} ratio="aspect-[16/9]" className="rounded-none transition-transform duration-700 group-hover:scale-[1.05]" />
                  <div className="absolute inset-0 bg-gradient-to-t from-ink-950/55 via-transparent to-transparent" />
                  <span className="absolute left-4 bottom-4 inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-1.5 text-[13px] font-bold font-display text-ink-950">
                    <a.icon className="w-4 h-4 text-mustard-700" strokeWidth={2} />
                    {a.title}
                  </span>
                </div>
                <div className="px-4 pt-6 pb-4">
                  <div className="flex items-start justify-between gap-4">
                    <p className="text-[21px] font-extrabold font-display tracking-[-0.02em] leading-snug text-ink-950">{a.body}</p>
                    <span className="w-11 h-11 rounded-full bg-ink-50 ring-1 ring-ink-200 text-ink-950 flex items-center justify-center shrink-0 transition-colors group-hover:bg-mustard-500">
                      <ArrowUpRight className="w-5 h-5" />
                    </span>
                  </div>
                  <ul className="mt-5 space-y-2.5">
                    {a.points.map((p) => (
                      <li key={p} className="flex items-center gap-3 text-[15px] text-ink-700">
                        <span className="w-5 h-5 rounded-full bg-ink-100 text-mustard-800 flex items-center justify-center shrink-0">
                          <Check className="w-3 h-3" strokeWidth={3} />
                        </span>
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>
              </Link>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* Custom automation */}
      <section className="bg-white pb-4">
        <Container>
          <Reveal>
            <Link
              to={CUSTOM_SOLUTION.href}
              className="group relative block overflow-hidden rounded-3xl bg-ink-950 px-7 py-12 sm:px-14 sm:py-14 transition-transform duration-300 hover:-translate-y-1"
            >
              <AuroraGlow variant="dark" />
              <div className="relative grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
                <div className="lg:col-span-8">
                  <p className="inline-flex items-center gap-2 rounded-full ring-1 ring-white/20 px-3.5 py-1.5 text-[14px] font-semibold font-display text-ink-300">
                    <CUSTOM_SOLUTION.icon className="w-4 h-4" />
                    Custom automation
                  </p>
                  <h2 className="mt-5 text-[32px] sm:text-[42px] font-extrabold font-display tracking-[-0.03em] leading-[1.1] text-white">
                    Have finance work that no tool covers? We’ll build it.
                  </h2>
                  <p className="mt-4 max-w-2xl text-lg text-ink-300">
                    Show us a task your team repeats every month. We design and build the automation around the way
                    you already work.
                  </p>
                </div>
                <div className="lg:col-span-4 lg:text-right">
                  <span className="inline-flex items-center gap-2 h-14 px-7 rounded-full bg-mustard-500 group-hover:bg-mustard-400 text-ink-950 text-[16px] font-bold font-display transition-colors">
                    How custom work runs
                    <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                  </span>
                </div>
              </div>
            </Link>
          </Reveal>
        </Container>
      </section>

      {/* FAQ */}
      <Section>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          <Reveal className="lg:col-span-5">
            <SectionTitle eyebrow="Questions" eyebrowIcon={HelpCircle} title="Common" accent="questions" className="mb-6" />
            <p className="text-lg text-ink-500">
              Still unsure?{' '}
              <Link to="/contact" className="font-semibold text-ink-950 underline underline-offset-4 decoration-mustard-500">
                Talk to our team
              </Link>
              .
            </p>
          </Reveal>
          <Reveal delay={0.1} className="lg:col-span-7">
            <FAQAccordion items={GENERAL_FAQS} />
          </Reveal>
        </div>
      </Section>

      <FinalCTA
        title="See what we can take off your desk"
        description="Book a 30-minute call. Tell us how your finance work runs today and we’ll show you the tools that fit."
        primary={{ to: '/book-a-demo', label: 'Book a demo' }}
        secondary={{ to: '/contact', label: 'Contact us' }}
      />
    </div>
  );
};
