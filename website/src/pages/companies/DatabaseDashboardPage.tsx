import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  LayoutDashboard,
  Building2,
  Users,
  CalendarClock,
  AlertTriangle,
  MapPin,
  Factory,
  ArrowUpRight,
  Info,
  Search,
  ArrowRight,
} from 'lucide-react';
import { PageIntro, Container } from '@/components/product/ProductBlocks';
import { Reveal } from '@/components/motion/Motion';
import { BarChart } from '@/components/company/BarChart';
import { COMPANIES, allDirectors, countBy, filingDueDates, formatDate } from '@/data/companies';
import { cn } from '@/lib/utils';

const Card: React.FC<{ title: string; icon: typeof MapPin; className?: string; children: React.ReactNode }> = ({
  title,
  icon: Icon,
  className,
  children,
}) => (
  <section className={cn('rounded-2xl bg-white ring-1 ring-ink-200 p-6', className)}>
    <h2 className="flex items-center gap-2.5 text-[16px] font-extrabold font-display text-ink-950">
      <Icon className="w-[18px] h-[18px] text-mustard-700" strokeWidth={1.75} />
      {title}
    </h2>
    <div className="mt-5">{children}</div>
  </section>
);

export const DatabaseDashboardPage: React.FC = () => {
  const [state, setState] = useState('All states');

  useEffect(() => {
    document.title = 'Company database dashboard · Germin8';
  }, []);

  const states = ['All states', ...new Set(COMPANIES.map((c) => c.state))];
  const companies = useMemo(
    () => (state === 'All states' ? COMPANIES : COMPANIES.filter((c) => c.state === state)),
    [state]
  );
  const directors = allDirectors().filter((d) => d.roles.some((r) => companies.includes(r.company)));

  const byState = countBy(companies, (c) => c.state);
  const byIndustry = countBy(companies, (c) => c.industry);
  const byYear = countBy(companies, (c) => c.incorporated.slice(0, 4)).sort((a, b) => a.label.localeCompare(b.label));

  const upcoming = companies
    .flatMap((c) => filingDueDates(c).map((f) => ({ ...f, company: c })))
    .filter((f) => !f.passed)
    .sort((a, b) => a.due.localeCompare(b.due))
    .slice(0, 6);
  const kycDue = directors.filter((d) => d.kyc === 'Due');

  const tiles = [
    { icon: Building2, label: 'Companies', value: companies.length },
    { icon: Users, label: 'Directors', value: directors.length },
    { icon: CalendarClock, label: 'Filings coming up', value: companies.flatMap((c) => filingDueDates(c)).filter((f) => !f.passed).length },
    { icon: AlertTriangle, label: 'Director KYC due', value: kycDue.length },
  ];

  return (
    <div className="bg-white">
      <PageIntro
        eyebrow="Database dashboard"
        eyebrowIcon={LayoutDashboard}
        title="The company database"
        accent="at a glance"
        description="Where companies are registered, what they do, when they were formed and which filings are coming up."
      >
        <div className="flex flex-wrap justify-center gap-3">
          <Link
            to="/companies"
            className="inline-flex items-center gap-2 h-12 px-6 rounded-full bg-ink-950 hover:bg-ink-800 text-white text-[15px] font-semibold font-display transition-colors"
          >
            <Search className="w-4 h-4" />
            Search companies
          </Link>
        </div>
      </PageIntro>

      <Container className="pb-24">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3 rounded-xl bg-ink-50 ring-1 ring-ink-200 px-4 py-3 text-[13.5px] text-ink-700">
            <Info className="w-4 h-4 mt-0.5 text-mustard-700 shrink-0" />
            Built on sample records. Live figures appear once real data is connected.
          </div>
          <label className="flex items-center gap-2 text-[14px] text-ink-600">
            <MapPin className="w-4 h-4 text-ink-400" />
            <span className="sr-only sm:not-sr-only">State</span>
            <select
              value={state}
              onChange={(e) => setState(e.target.value)}
              className="h-11 rounded-full bg-white ring-1 ring-ink-300 px-4 text-[14.5px] font-semibold text-ink-950 focus:outline-none focus:ring-2 focus:ring-mustard-500"
            >
              {states.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        </div>

        {/* KPI tiles */}
        <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-4">
          {tiles.map((t, i) => (
            <Reveal key={t.label} delay={i * 0.05}>
              <div className="rounded-2xl ring-1 ring-ink-200 p-5 transition-all hover:-translate-y-1 hover:ring-ink-300 hover:shadow-[0_24px_48px_-26px_rgba(23,23,22,0.3)]">
                <span className="w-10 h-10 rounded-full bg-ink-50 ring-1 ring-ink-200 text-mustard-700 flex items-center justify-center">
                  <t.icon className="w-[18px] h-[18px]" strokeWidth={1.75} />
                </span>
                <p className="mt-4 text-[32px] font-extrabold font-display tracking-[-0.02em] text-ink-950">{t.value}</p>
                <p className="text-[13.5px] text-ink-500">{t.label}</p>
              </div>
            </Reveal>
          ))}
        </div>

        {/* Charts */}
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Reveal>
            <Card title="Companies by state" icon={MapPin} className="h-full">
              <BarChart data={byState} unit="companies" ariaLabel="Companies by state" />
            </Card>
          </Reveal>
          <Reveal delay={0.05}>
            <Card title="Companies by industry" icon={Factory} className="h-full">
              <BarChart data={byIndustry} unit="companies" ariaLabel="Companies by industry" />
            </Card>
          </Reveal>
          <Reveal delay={0.1}>
            <Card title="Incorporated by year" icon={Building2} className="h-full">
              <BarChart data={byYear} unit="companies" ariaLabel="Companies incorporated by year" />
            </Card>
          </Reveal>
        </div>

        {/* Lists */}
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-4">
          <Reveal className="lg:col-span-7">
            <Card title="Next filing due dates" icon={CalendarClock}>
              <div className="overflow-x-auto -mx-6">
                <table className="w-full min-w-[480px] text-[14px]">
                  <thead>
                    <tr className="text-left text-[12px] uppercase tracking-[0.06em] text-ink-400">
                      <th className="font-semibold px-6 pb-2">Company</th>
                      <th className="font-semibold px-3 pb-2">Form</th>
                      <th className="font-semibold px-6 pb-2 text-right">Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {upcoming.length === 0 && (
                      <tr className="border-t border-ink-100">
                        <td colSpan={3} className="px-6 py-4 text-ink-500">No filings due for this selection.</td>
                      </tr>
                    )}
                    {upcoming.map((u) => (
                      <tr key={u.company.slug + u.form} className="border-t border-ink-100 hover:bg-ink-50/50">
                        <td className="px-6 py-3">
                          <Link to={`/company/${u.company.slug}`} className="font-semibold text-ink-950 hover:text-mustard-700">
                            {u.company.name.replace(/ Private Limited| Limited/, '')}
                          </Link>
                        </td>
                        <td className="px-3 py-3 text-ink-700">{u.form}</td>
                        <td className="px-6 py-3 text-right text-ink-700 whitespace-nowrap">{formatDate(u.due)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </Reveal>

          <Reveal delay={0.05} className="lg:col-span-5">
            <Card title="Director KYC due" icon={AlertTriangle} className="h-full">
              {kycDue.length === 0 ? (
                <p className="text-[14.5px] text-ink-500">No director KYC is due for this selection.</p>
              ) : (
                <ul className="space-y-2">
                  {kycDue.map((d) => (
                    <li key={d.din}>
                      <Link
                        to={`/director/${d.din}`}
                        className="group flex items-center gap-3 rounded-xl ring-1 ring-ink-200 px-3.5 py-3 hover:ring-ink-300 transition-colors"
                      >
                        <span className="w-9 h-9 rounded-full bg-ink-100 text-ink-950 text-[12px] font-bold font-display flex items-center justify-center">
                          {d.name.split(' ').map((p) => p[0]).join('')}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-[14.5px] font-semibold text-ink-950">{d.name}</span>
                          <span className="block text-[12.5px] text-ink-500 truncate">
                            {d.roles.map((r) => r.company.name.replace(/ Private Limited| Limited/, '')).join(', ')}
                          </span>
                        </span>
                        <ArrowUpRight className="w-4 h-4 text-ink-400 group-hover:text-ink-950" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </Reveal>
        </div>

        {/* Quiet product link */}
        <Reveal>
          <Link
            to="/products/office-management"
            className="group mt-6 flex flex-col sm:flex-row sm:items-center gap-4 rounded-2xl bg-paper ring-1 ring-ink-200 px-6 py-5 hover:ring-ink-300 transition-colors"
          >
            <span className="flex-1 text-[15px] text-ink-700">
              <span className="font-semibold text-ink-950">Tracking dates like these for your clients?</span> Office management
              creates the tasks and reminders for you.
            </span>
            <span className="inline-flex items-center gap-1.5 text-[14.5px] font-semibold font-display text-ink-950">
              See office management
              <ArrowRight className="w-4 h-4 text-mustard-600 transition-transform group-hover:translate-x-1" />
            </span>
          </Link>
        </Reveal>
      </Container>
    </div>
  );
};
