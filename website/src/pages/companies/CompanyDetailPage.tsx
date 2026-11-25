import React, { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Building2,
  ChevronRight,
  CalendarClock,
  Users,
  ArrowUpRight,
  Info,
  BadgeCheck,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react';
import { Container } from '@/components/product/ProductBlocks';
import { Reveal, TiltCard } from '@/components/motion/Motion';
import { CompanySearch } from '@/components/company/CompanySearch';
import { COMPANIES, getCompany, formatDate, formatRupees, filingDueDates } from '@/data/companies';
import { getSolution } from '@/data/solutions';

const Fact: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="py-3.5 border-b border-ink-100">
    <dt className="text-[13px] text-ink-500">{label}</dt>
    <dd className="mt-0.5 text-[15px] font-semibold text-ink-950">{value}</dd>
  </div>
);

export const CompanyDetailPage: React.FC = () => {
  const { slug = '' } = useParams();
  const company = getCompany(slug);

  useEffect(() => {
    document.title = company ? `${company.name} · Directors and company details · Germin8` : 'Company not found · Germin8';
  }, [company]);

  if (!company) {
    return (
      <div className="bg-white pt-36 pb-24">
        <Container className="max-w-2xl text-center">
          <h1 className="text-[36px] font-extrabold font-display tracking-[-0.03em] text-ink-950">We couldn’t find that company</h1>
          <p className="mt-3 text-lg text-ink-500">Try searching by name, CIN or a director’s name.</p>
          <CompanySearch className="mt-8" />
        </Container>
      </div>
    );
  }

  const dues = filingDueDates(company);
  const kycDue = company.directors.filter((d) => d.kyc === 'Due').length;
  const others = COMPANIES.filter((c) => c.slug !== company.slug).slice(0, 3);
  const roc = getSolution('incorporation-roc')!;
  const office = getSolution('office-management')!;
  const statements = getSolution('financial-statements')!;

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
            <span className="text-ink-950 font-medium truncate">{company.name}</span>
          </nav>

          <div className="mt-7 flex flex-col lg:flex-row lg:items-end justify-between gap-6">
            <div className="flex items-start gap-4">
              <span className="w-14 h-14 rounded-2xl bg-ink-950 text-mustard-400 flex items-center justify-center shrink-0">
                <Building2 className="w-7 h-7" strokeWidth={1.5} />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="text-[28px] sm:text-[36px] font-extrabold font-display tracking-[-0.03em] leading-tight text-ink-950">
                    {company.name}
                  </h1>
                  <span className="rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 px-2.5 py-1 text-[12px] font-semibold">
                    {company.status}
                  </span>
                </div>
                <p className="mt-1.5 text-[14px] font-mono text-ink-600">CIN {company.cin}</p>
                <p className="mt-1 text-[15px] text-ink-500">
                  {company.industry} · {company.city}, {company.state}
                </p>
              </div>
            </div>
            <CompanySearch size="md" className="w-full lg:w-[380px]" />
          </div>

          <div className="mt-6 flex items-start gap-2.5 rounded-xl bg-white/80 ring-1 ring-ink-200 px-4 py-3 text-[13.5px] text-ink-600">
            <Info className="w-4 h-4 mt-0.5 text-mustard-700 shrink-0" />
            Sample record for the design preview. This company and its directors are not real.
          </div>
        </Container>
      </section>

      <Container className="pb-24">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Main column */}
          <div className="lg:col-span-8 space-y-8">
            {/* Directors */}
            <Reveal>
              <section className="rounded-2xl bg-white ring-1 ring-ink-200 overflow-hidden">
                <header className="flex items-center justify-between gap-3 px-6 py-5 border-b border-ink-100">
                  <h2 className="flex items-center gap-2.5 text-[19px] font-extrabold font-display text-ink-950">
                    <Users className="w-5 h-5 text-mustard-700" strokeWidth={1.75} />
                    Directors and signatories
                  </h2>
                  <span className="text-[13px] text-ink-500">{company.directors.length} people</span>
                </header>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-[14.5px]">
                    <thead>
                      <tr className="text-left text-[12px] uppercase tracking-[0.06em] text-ink-400">
                        <th className="font-semibold px-6 py-3">Name</th>
                        <th className="font-semibold px-3 py-3">DIN</th>
                        <th className="font-semibold px-3 py-3">Designation</th>
                        <th className="font-semibold px-3 py-3">Appointed</th>
                        <th className="font-semibold px-6 py-3 text-right">KYC</th>
                      </tr>
                    </thead>
                    <tbody>
                      {company.directors.map((d) => (
                        <tr key={d.din} className="border-t border-ink-100 hover:bg-ink-50/50 transition-colors">
                          <td className="px-6 py-4">
                            <span className="flex items-center gap-3">
                              <span className="w-9 h-9 rounded-full bg-ink-100 text-ink-950 text-[12px] font-bold font-display flex items-center justify-center">
                                {d.name.split(' ').map((p) => p[0]).join('').slice(0, 2)}
                              </span>
                              <Link
                                to={`/director/${d.din}`}
                                className="font-semibold text-ink-950 underline-offset-4 decoration-mustard-500 hover:underline"
                              >
                                {d.name}
                              </Link>
                            </span>
                          </td>
                          <td className="px-3 py-4 font-mono text-[13.5px] text-ink-600">{d.din}</td>
                          <td className="px-3 py-4 text-ink-700">{d.designation}</td>
                          <td className="px-3 py-4 text-ink-700 whitespace-nowrap">{formatDate(d.appointed)}</td>
                          <td className="px-6 py-4 text-right">
                            {d.kyc === 'Filed' ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-1 text-[12px] font-semibold">
                                <BadgeCheck className="w-3.5 h-3.5" /> Filed
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full bg-ink-100 text-mustard-800 px-2.5 py-1 text-[12px] font-semibold">
                                <AlertTriangle className="w-3.5 h-3.5" /> Due
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </Reveal>

            {/* Filing dates, with a quiet pointer to the ROC tool */}
            <Reveal>
              <section className="rounded-2xl bg-white ring-1 ring-ink-200 p-6">
                <h2 className="flex items-center gap-2.5 text-[19px] font-extrabold font-display text-ink-950">
                  <CalendarClock className="w-5 h-5 text-mustard-700" strokeWidth={1.75} />
                  Annual filing dates
                </h2>
                <p className="mt-1.5 text-[14.5px] text-ink-500">
                  Counted from the last AGM on {formatDate(company.lastAgm)}.
                  {kycDue > 0 && ` ${kycDue} director KYC ${kycDue === 1 ? 'is' : 'are'} due first.`}
                </p>
                <ol className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {dues.map((d) => (
                    <li key={d.form} className="rounded-xl bg-paper ring-1 ring-ink-200 p-4">
                      <p className="text-[20px] font-extrabold font-display text-ink-950">{d.form}</p>
                      <p className="text-[13.5px] text-ink-500">{d.name}</p>
                      <p className="mt-3 text-[13px] text-ink-500">Due by</p>
                      <p className="text-[15px] font-semibold text-ink-950">{formatDate(d.due)}</p>
                      <span
                        className={
                          d.passed
                            ? 'mt-2 inline-block rounded-full bg-ink-100 px-2 py-0.5 text-[11.5px] font-semibold text-ink-600'
                            : 'mt-2 inline-block rounded-full bg-ink-100 px-2 py-0.5 text-[11.5px] font-semibold text-mustard-800'
                        }
                      >
                        {d.passed ? 'Date passed' : 'Upcoming'}
                      </span>
                    </li>
                  ))}
                </ol>
                <Link
                  to={roc.href}
                  className="group mt-5 flex items-center justify-between gap-4 rounded-xl bg-ink-50 ring-1 ring-ink-200 px-4 py-3.5 hover:bg-ink-100 transition-colors"
                >
                  <span className="flex items-center gap-3">
                    <span className="w-9 h-9 rounded-full bg-white ring-1 ring-ink-200 text-mustard-700 flex items-center justify-center shrink-0">
                      <roc.icon className="w-4 h-4" strokeWidth={1.75} />
                    </span>
                    <span className="text-[14.5px] text-ink-700">
                      <span className="font-semibold text-ink-950">Filing these forms?</span> Germin8 prepares them from
                      your documents.
                    </span>
                  </span>
                  <ArrowRight className="w-4 h-4 text-ink-700 shrink-0 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </section>
            </Reveal>

            {/* More companies */}
            <Reveal>
              <section>
                <h2 className="text-[19px] font-extrabold font-display text-ink-950">More companies</h2>
                <ul className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {others.map((c) => (
                    <li key={c.slug}>
                      <Link
                        to={`/company/${c.slug}`}
                        className="group block h-full rounded-xl ring-1 ring-ink-200 p-4 transition-all hover:-translate-y-0.5 hover:ring-ink-300"
                      >
                        <p className="text-[14.5px] font-bold font-display leading-snug text-ink-950">{c.name}</p>
                        <p className="mt-1 text-[12.5px] text-ink-500">
                          {c.city} · {c.directors.length} directors
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            </Reveal>
          </div>

          {/* Side column */}
          <aside className="lg:col-span-4 space-y-6">
            <Reveal>
              <section className="rounded-2xl bg-white ring-1 ring-ink-200 px-6 py-3">
                <dl>
                  <Fact label="Incorporated" value={formatDate(company.incorporated)} />
                  <Fact label="Registrar" value={company.roc} />
                  <Fact label="Class" value={`${company.companyClass} · ${company.category}`} />
                  <Fact label="Authorised capital" value={formatRupees(company.authorisedCapital)} />
                  <Fact label="Paid-up capital" value={formatRupees(company.paidUpCapital)} />
                  <Fact label="Last balance sheet" value={formatDate(company.lastBalanceSheet)} />
                  <div className="py-3.5">
                    <dt className="text-[13px] text-ink-500">Last AGM</dt>
                    <dd className="mt-0.5 text-[15px] font-semibold text-ink-950">{formatDate(company.lastAgm)}</dd>
                  </div>
                </dl>
              </section>
            </Reveal>

            {/* Subtle product showcase */}
            <Reveal delay={0.05}>
              <TiltCard max={5} className="lg:sticky lg:top-28">
                <section className="rounded-2xl bg-gradient-to-br from-ink-50 to-white ring-1 ring-ink-200 p-6">
                  <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-mustard-800">
                    Run finance for a company like this?
                  </p>
                  <p className="mt-2 text-[19px] font-extrabold font-display leading-snug text-ink-950">
                    Germin8 automates the work, piece by piece.
                  </p>
                  <ul className="mt-5 space-y-2">
                    {[office, statements, roc].map((s) => (
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
                          <ArrowUpRight className="w-4 h-4 mt-0.5 text-ink-400 group-hover:text-ink-950" />
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
