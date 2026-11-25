import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Building2, Users, MapPin, ArrowUpRight, Info, Database } from 'lucide-react';
import { Container, Eyebrow, Accent } from '@/components/product/ProductBlocks';
import { Reveal, AuroraGlow } from '@/components/motion/Motion';
import { CompanySearch } from '@/components/company/CompanySearch';
import { COMPANIES, searchCompanies, formatDate } from '@/data/companies';
import { SOLUTIONS } from '@/data/solutions';
import { cn } from '@/lib/utils';

const STATUSES = ['All', 'Active', 'Strike off', 'Under liquidation'];

export const CompaniesPage: React.FC = () => {
  const [params] = useSearchParams();
  const q = params.get('q') ?? '';
  const [status, setStatus] = useState('All');
  const results = searchCompanies(q, status);

  useEffect(() => {
    document.title = q ? `${q} · Company search · Germin8` : 'Company database · Germin8';
  }, [q]);

  const stats = [
    { icon: Building2, label: 'Companies', value: COMPANIES.length },
    { icon: Users, label: 'Directors', value: COMPANIES.reduce((n, c) => n + c.directors.length, 0) },
    { icon: MapPin, label: 'States', value: new Set(COMPANIES.map((c) => c.state)).size },
  ];

  return (
    <div className="bg-white">
      {/* Search header */}
      <section className="relative overflow-hidden pt-28 lg:pt-36 pb-12">
        <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-ink-50/80 to-white" />
        <AuroraGlow />
        <Container className="relative text-center">
          <Eyebrow icon={Database}>Company database</Eyebrow>
          <h1 className="mt-5 text-[38px] sm:text-[52px] font-extrabold font-display tracking-[-0.03em] leading-[1.06] text-ink-950">
            Look up any company and its <Accent>directors</Accent>
          </h1>
          <p className="mt-5 max-w-2xl mx-auto text-lg text-ink-500">
            Search by company name, CIN or director. See registration details, directors and upcoming ROC filing
            dates on one page.
          </p>
          <CompanySearch key={q} initial={q} className="mt-9 max-w-2xl mx-auto" />
        </Container>
      </section>

      <Container className="pb-24">
        {/* Sample data notice */}
        <div className="flex items-start gap-3 rounded-2xl bg-ink-50 ring-1 ring-ink-200 px-5 py-4 text-[14px] text-ink-700">
          <Info className="w-[18px] h-[18px] mt-0.5 text-mustard-700 shrink-0" />
          <p>
            <span className="font-semibold text-ink-950">Preview with sample records.</span> These companies and
            directors are made up to show how the database works. Live company data will appear here once it is
            connected.
          </p>
        </div>

        {/* Dashboard tiles */}
        <div className="mt-6 grid grid-cols-3 gap-3 sm:gap-5">
          {stats.map((s, i) => (
            <Reveal key={s.label} delay={i * 0.06}>
              <div className="rounded-2xl bg-white ring-1 ring-ink-200 p-4 sm:p-6 transition-all hover:-translate-y-1 hover:ring-ink-300 hover:shadow-[0_24px_48px_-24px_rgba(23,23,22,0.25)]">
                <span className="w-10 h-10 rounded-full bg-ink-50 ring-1 ring-ink-200 text-mustard-700 flex items-center justify-center">
                  <s.icon className="w-[18px] h-[18px]" strokeWidth={1.75} />
                </span>
                <p className="mt-4 text-[28px] sm:text-[34px] font-extrabold font-display tracking-[-0.02em] text-ink-950">{s.value}</p>
                <p className="text-[13.5px] text-ink-500">{s.label} in this preview</p>
              </div>
            </Reveal>
          ))}
        </div>

        <div className="mt-4 flex justify-end">
          <Link
            to="/companies/dashboard"
            className="group inline-flex items-center gap-2 text-[14.5px] font-semibold font-display text-ink-950"
          >
            Open the dashboard
            <ArrowUpRight className="w-4 h-4 text-mustard-600 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </Link>
        </div>

        <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Results */}
          <div className="lg:col-span-8">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h2 className="text-[20px] font-extrabold font-display text-ink-950">
                {q ? `${results.length} result${results.length === 1 ? '' : 's'} for “${q}”` : 'All companies'}
              </h2>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
                {STATUSES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatus(s)}
                    aria-pressed={status === s}
                    className={cn(
                      'rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors',
                      status === s ? 'bg-ink-950 text-white' : 'bg-white text-ink-600 ring-1 ring-ink-200 hover:ring-ink-400'
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {results.length === 0 ? (
              <div className="rounded-2xl ring-1 ring-ink-200 p-10 text-center">
                <p className="text-[17px] font-bold font-display text-ink-950">No company matches that search</p>
                <p className="mt-1.5 text-[15px] text-ink-500">Check the spelling, or try the CIN or a director’s name.</p>
              </div>
            ) : (
              <ul className="space-y-3">
                {results.map((c) => (
                  <li key={c.slug}>
                    <Link
                      to={`/company/${c.slug}`}
                      className="group flex items-start gap-4 rounded-2xl bg-white ring-1 ring-ink-200 p-5 transition-all hover:-translate-y-0.5 hover:ring-ink-300 hover:shadow-[0_24px_48px_-28px_rgba(23,23,22,0.3)]"
                    >
                      <span className="w-11 h-11 rounded-xl bg-ink-50 ring-1 ring-ink-200 text-mustard-700 flex items-center justify-center shrink-0">
                        <Building2 className="w-5 h-5" strokeWidth={1.75} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-[16.5px] font-bold font-display text-ink-950">{c.name}</h3>
                          <span className="rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 px-2 py-0.5 text-[11px] font-semibold">
                            {c.status}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[13px] font-mono text-ink-500">{c.cin}</p>
                        <p className="mt-2 text-[13.5px] text-ink-600">
                          {c.industry} · {c.city}, {c.state} · Incorporated {formatDate(c.incorporated)} ·{' '}
                          {c.directors.length} directors
                        </p>
                      </div>
                      <ArrowUpRight className="w-5 h-5 text-ink-400 transition-all group-hover:text-ink-950 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Quiet product rail */}
          <aside className="lg:col-span-4">
            <div className="lg:sticky lg:top-28 rounded-2xl bg-paper ring-1 ring-ink-200 p-6">
              <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-400">From Germin8</p>
              <p className="mt-2 text-[18px] font-extrabold font-display leading-snug text-ink-950">
                Software that does the finance work behind these records
              </p>
              <ul className="mt-5 space-y-1">
                {SOLUTIONS.map((s) => (
                  <li key={s.slug}>
                    <Link to={s.href} className="group flex items-center gap-3 rounded-xl px-2.5 py-2.5 -mx-2.5 hover:bg-white transition-colors">
                      <span className="w-9 h-9 rounded-full bg-white ring-1 ring-ink-200 text-mustard-700 flex items-center justify-center shrink-0">
                        <s.icon className="w-4 h-4" strokeWidth={1.75} />
                      </span>
                      <span className="flex-1 text-[14.5px] font-semibold text-ink-950">{s.name}</span>
                      <ArrowUpRight className="w-4 h-4 text-ink-400 group-hover:text-ink-950" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </Container>
    </div>
  );
};
