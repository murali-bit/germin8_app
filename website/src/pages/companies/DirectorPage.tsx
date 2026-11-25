import React, { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronRight, Building2, ArrowUpRight, Info, BadgeCheck, AlertTriangle, ArrowRight, Briefcase } from 'lucide-react';
import { Container } from '@/components/product/ProductBlocks';
import { Reveal, TiltCard } from '@/components/motion/Motion';
import { CompanySearch } from '@/components/company/CompanySearch';
import { getDirector, formatDate } from '@/data/companies';
import { getSolution } from '@/data/solutions';

export const DirectorPage: React.FC = () => {
  const { din = '' } = useParams();
  const d = getDirector(din);

  useEffect(() => {
    document.title = d ? `${d.name} (DIN ${d.din}) · Directorships · Germin8` : 'Director not found · Germin8';
  }, [d]);

  if (!d) {
    return (
      <div className="bg-white pt-36 pb-24">
        <Container className="max-w-2xl text-center">
          <h1 className="text-[36px] font-extrabold font-display tracking-[-0.03em] text-ink-950">We couldn’t find that director</h1>
          <p className="mt-3 text-lg text-ink-500">Try a name, DIN or company.</p>
          <CompanySearch className="mt-8" />
        </Container>
      </div>
    );
  }

  const initials = d.name.split(' ').map((p) => p[0]).join('').slice(0, 2);
  const roc = getSolution('incorporation-roc')!;
  const office = getSolution('office-management')!;

  return (
    <div className="bg-white">
      <section className="relative overflow-hidden pt-28 lg:pt-32 pb-10">
        <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-ink-50/70 to-white" />
        <Container className="relative">
          <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-[13.5px] text-ink-500">
            <Link to="/" className="hover:text-ink-950">Home</Link>
            <ChevronRight className="w-3.5 h-3.5 text-ink-300" />
            <Link to="/companies" className="hover:text-ink-950">Company database</Link>
            <ChevronRight className="w-3.5 h-3.5 text-ink-300" />
            <span className="text-ink-950 font-medium">{d.name}</span>
          </nav>

          <div className="mt-7 flex flex-col lg:flex-row lg:items-end justify-between gap-6">
            <div className="flex items-center gap-5">
              <span className="w-16 h-16 rounded-full bg-mustard-500 text-ink-950 text-[22px] font-extrabold font-display flex items-center justify-center ring-8 ring-ink-100">
                {initials}
              </span>
              <div>
                <h1 className="text-[30px] sm:text-[40px] font-extrabold font-display tracking-[-0.03em] leading-tight text-ink-950">{d.name}</h1>
                <p className="mt-1 text-[14px] font-mono text-ink-600">DIN {d.din}</p>
              </div>
            </div>
            <CompanySearch size="md" className="w-full lg:w-[380px]" />
          </div>

          <div className="mt-6 flex items-start gap-2.5 rounded-xl bg-white/80 ring-1 ring-ink-200 px-4 py-3 text-[13.5px] text-ink-600">
            <Info className="w-4 h-4 mt-0.5 text-mustard-700 shrink-0" />
            Sample record for the design preview. This person is not real.
          </div>
        </Container>
      </section>

      <Container className="pb-24">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-8 space-y-8">
            {/* Summary tiles */}
            <div className="grid grid-cols-2 gap-4">
              <Reveal>
                <div className="rounded-2xl ring-1 ring-ink-200 p-5">
                  <p className="text-[13px] text-ink-500">Directorships</p>
                  <p className="mt-1 text-[30px] font-extrabold font-display text-ink-950">{d.roles.length}</p>
                </div>
              </Reveal>
              <Reveal delay={0.05}>
                <div className="rounded-2xl ring-1 ring-ink-200 p-5">
                  <p className="text-[13px] text-ink-500">DIR-3 KYC</p>
                  <p className="mt-2">
                    {d.kyc === 'Filed' ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 text-emerald-700 px-3 py-1 text-[14px] font-semibold">
                        <BadgeCheck className="w-4 h-4" /> Filed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-100 text-mustard-800 px-3 py-1 text-[14px] font-semibold">
                        <AlertTriangle className="w-4 h-4" /> Due
                      </span>
                    )}
                  </p>
                </div>
              </Reveal>
            </div>

            {/* Companies */}
            <Reveal>
              <section>
                <h2 className="flex items-center gap-2.5 text-[19px] font-extrabold font-display text-ink-950">
                  <Briefcase className="w-5 h-5 text-mustard-700" strokeWidth={1.75} />
                  Companies
                </h2>
                <ul className="mt-4 space-y-3">
                  {d.roles.map((r) => (
                    <li key={r.company.slug}>
                      <Link
                        to={`/company/${r.company.slug}`}
                        className="group flex items-start gap-4 rounded-2xl ring-1 ring-ink-200 p-5 transition-all hover:-translate-y-0.5 hover:ring-ink-300 hover:shadow-[0_24px_48px_-28px_rgba(23,23,22,0.3)]"
                      >
                        <span className="w-11 h-11 rounded-xl bg-ink-50 ring-1 ring-ink-200 text-mustard-700 flex items-center justify-center shrink-0">
                          <Building2 className="w-5 h-5" strokeWidth={1.75} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[16px] font-bold font-display text-ink-950">{r.company.name}</p>
                          <p className="mt-0.5 text-[13.5px] text-ink-500">
                            {r.designation} since {formatDate(r.appointed)} · {r.company.city}
                          </p>
                        </div>
                        <ArrowUpRight className="w-5 h-5 text-ink-400 group-hover:text-ink-950" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            </Reveal>
          </div>

          <aside className="lg:col-span-4">
            <Reveal>
              <TiltCard max={5} className="lg:sticky lg:top-28">
                <section className="rounded-2xl bg-gradient-to-br from-ink-50 to-white ring-1 ring-ink-200 p-6">
                  <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-mustard-800">Sit on more than one board?</p>
                  <p className="mt-2 text-[19px] font-extrabold font-display leading-snug text-ink-950">
                    Keep every company’s filings on one calendar.
                  </p>
                  <ul className="mt-5 space-y-2">
                    {[office, roc].map((s) => (
                      <li key={s.slug}>
                        <Link
                          to={s.href}
                          className="group flex items-start gap-3 rounded-xl bg-white ring-1 ring-ink-200 p-3.5 transition-all hover:ring-mustard-400 hover:-translate-y-0.5"
                        >
                          <span className="w-9 h-9 rounded-full bg-ink-50 ring-1 ring-ink-200 text-mustard-700 flex items-center justify-center shrink-0">
                            <s.icon className="w-4 h-4" strokeWidth={1.75} />
                          </span>
                          <span className="flex-1">
                            <span className="block text-[14.5px] font-bold font-display text-ink-950">{s.name}</span>
                            <span className="block text-[13px] leading-snug text-ink-500">{s.short}</span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <Link
                    to="/book-a-demo"
                    className="mt-5 flex h-11 items-center justify-center gap-2 rounded-full bg-ink-950 hover:bg-ink-800 text-white text-[14.5px] font-semibold font-display transition-colors"
                  >
                    Book a demo
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </section>
              </TiltCard>
            </Reveal>
          </aside>
        </div>
      </Container>
    </div>
  );
};
