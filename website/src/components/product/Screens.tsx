/**
 * Product screen illustrations. Built in code (not images) so they stay
 * sharp, on-brand and easy to update. All names and figures are sample data.
 */
import React from 'react';
import {
  Check,
  AlertTriangle,
  X,
  Loader2,
  Search,
  FileText,
  LayoutDashboard,
  ArrowRightLeft,
  FileCheck2,
  Settings,
  Users,
  Building2,
  ChevronRight,
  Lock,
  Puzzle,
  Download,
  MoreHorizontal,
  Scale,
  BookOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/* ---------- Shared chrome ---------- */

export const AppWindow: React.FC<{
  url: string;
  children: React.ReactNode;
  className?: string;
  sidebar?: 'migration' | 'mca' | false;
}> = ({ url, children, className, sidebar = false }) => (
  <div
    className={cn(
      'rounded-2xl bg-white shadow-[0_30px_70px_-28px_rgba(23,23,22,0.3)] ring-1 ring-ink-200/80 overflow-hidden text-left font-sans',
      className
    )}
  >
    <div className="flex items-center gap-3 px-4 h-11 bg-white border-b border-ink-100">
      <div className="flex gap-1.5">
        <span className="w-3 h-3 rounded-full bg-[#FF5F57]" />
        <span className="w-3 h-3 rounded-full bg-[#FEBC2E]" />
        <span className="w-3 h-3 rounded-full bg-[#28C840]" />
      </div>
      <div className="flex-1 min-w-0 flex justify-center">
        <div className="flex items-center gap-1.5 h-7 px-3.5 rounded-full bg-ink-50 text-[11.5px] text-ink-600 max-w-[340px] w-full min-w-0">
          <Lock className="w-3 h-3 text-ink-950" aria-hidden />
          <span className="truncate">{url}</span>
        </div>
      </div>
      <MoreHorizontal className="hidden sm:block w-5 h-5 text-ink-500" aria-hidden />
    </div>
    <div className="flex">
      {sidebar && <Sidebar active={sidebar} />}
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  </div>
);

const Sidebar: React.FC<{ active: 'migration' | 'mca' }> = ({ active }) => {
  const items = [
    { icon: LayoutDashboard, label: 'Overview', key: 'o' },
    { icon: ArrowRightLeft, label: 'Migrations', key: 'migration' },
    { icon: FileCheck2, label: 'MCA filings', key: 'mca' },
    { icon: Users, label: 'Clients', key: 'c' },
    { icon: Settings, label: 'Settings', key: 's' },
  ];
  return (
    <div className="hidden sm:flex w-40 shrink-0 flex-col gap-0.5 border-r border-ink-200 bg-ink-50/60 p-2.5">
      {items.map((it) => (
        <div
          key={it.key}
          className={cn(
            'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px]',
            it.key === active ? 'bg-white text-ink-950 font-semibold ring-1 ring-ink-200' : 'text-ink-500'
          )}
        >
          <it.icon className="w-3.5 h-3.5" aria-hidden />
          {it.label}
        </div>
      ))}
    </div>
  );
};

type Tone = 'ok' | 'warn' | 'fail' | 'run' | 'wait' | 'info';

export const Pill: React.FC<{ tone: Tone; children: React.ReactNode }> = ({ tone, children }) => (
  <span
    className={cn(
      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold whitespace-nowrap',
      tone === 'ok' && 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
      tone === 'warn' && 'bg-ink-50 text-mustard-800 ring-1 ring-ink-200',
      tone === 'fail' && 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
      tone === 'run' && 'bg-ink-950 text-white',
      tone === 'wait' && 'bg-ink-100 text-ink-500',
      tone === 'info' && 'bg-ink-100 text-ink-700'
    )}
  >
    {children}
  </span>
);

const StatusIcon: React.FC<{ tone: Tone }> = ({ tone }) => {
  if (tone === 'ok')
    return (
      <span className="w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0">
        <Check className="w-3 h-3" strokeWidth={3} />
      </span>
    );
  if (tone === 'warn')
    return (
      <span className="w-5 h-5 rounded-full bg-ink-100 text-mustard-800 flex items-center justify-center shrink-0">
        <AlertTriangle className="w-3 h-3" strokeWidth={2.5} />
      </span>
    );
  if (tone === 'fail')
    return (
      <span className="w-5 h-5 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
        <X className="w-3 h-3" strokeWidth={3} />
      </span>
    );
  if (tone === 'run')
    return (
      <span className="w-5 h-5 rounded-full bg-ink-950 text-white flex items-center justify-center shrink-0">
        <Loader2 className="w-3 h-3 animate-spin" strokeWidth={2.5} />
      </span>
    );
  return <span className="w-5 h-5 rounded-full ring-2 ring-ink-200 shrink-0" />;
};

const ScreenHeader: React.FC<{ crumb: string; title: string; right?: React.ReactNode }> = ({
  crumb,
  title,
  right,
}) => (
  <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-ink-100">
    <div className="min-w-0">
      <div className="flex items-center gap-1 text-[11px] text-ink-400">
        {crumb}
        <ChevronRight className="w-3 h-3" />
      </div>
      <div className="mt-0.5 text-[14px] font-semibold text-ink-950 truncate font-display">{title}</div>
    </div>
    {right}
  </div>
);

/* ---------- 1. Migration run ---------- */

export const MigrationRunScreen: React.FC = () => {
  const stages: { label: string; note: string; tone: Tone }[] = [
    { label: 'Extract from Tally', note: 'Master_Export.xml · 2,184 records', tone: 'ok' },
    { label: 'Map to Zoho Books', note: '28 groups · 412 ledgers', tone: 'ok' },
    { label: 'Validate', note: '6 checks passed, 1 warning', tone: 'ok' },
    { label: 'Import', note: 'Contacts 212 of 286', tone: 'run' },
    { label: 'Compare trial balance', note: 'Waiting', tone: 'wait' },
    { label: 'Migration report', note: 'Waiting', tone: 'wait' },
  ];
  return (
    <AppWindow url="app.germin8.in/migrations/sharma-traders" sidebar="migration">
      <ScreenHeader
        crumb="Migrations"
        title="Sharma Traders Pvt Ltd · Tally to Zoho Books"
        right={<Pill tone="run">Importing</Pill>}
      />
      <div className="p-5 space-y-4">
        <div>
          <div className="flex justify-between text-[11px] text-ink-500">
            <span>Overall progress</span>
            <span className="font-semibold text-ink-950">68%</span>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-ink-100 overflow-hidden">
            <div className="h-full w-[68%] rounded-full bg-mustard-500" />
          </div>
        </div>
        <ul className="divide-y divide-ink-100 rounded-lg ring-1 ring-ink-200">
          {stages.map((s) => (
            <li key={s.label} className="flex items-center gap-3 px-3.5 py-2.5">
              <StatusIcon tone={s.tone} />
              <div className="min-w-0 flex-1">
                <div className={cn('text-[12.5px] font-medium', s.tone === 'wait' ? 'text-ink-400' : 'text-ink-950')}>
                  {s.label}
                </div>
                <div className="text-[11px] text-ink-500 truncate">{s.note}</div>
              </div>
            </li>
          ))}
        </ul>
        <div className="grid grid-cols-4 gap-2">
          {[
            ['Ledgers', '412'],
            ['Contacts', '286'],
            ['Items', '1,148'],
            ['Open bills', '73'],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg bg-ink-50 px-2.5 py-2">
              <div className="text-[10.5px] text-ink-500">{k}</div>
              <div className="text-[14px] font-semibold text-ink-950 font-display">{v}</div>
            </div>
          ))}
        </div>
      </div>
    </AppWindow>
  );
};

/* ---------- 2. Ledger mapping ---------- */

export const MappingScreen: React.FC = () => {
  const rows: [string, string, string, Tone, string][] = [
    ['Sundry Debtors', 'Accounts Receivable', '186', 'ok', 'Mapped'],
    ['Sundry Creditors', 'Accounts Payable', '100', 'ok', 'Mapped'],
    ['Bank Accounts', 'Bank', '6', 'ok', 'Mapped'],
    ['Duties & Taxes', 'Tax groups (GST)', '24', 'ok', 'Mapped'],
    ['Stock-in-Hand', 'Stock', '1', 'ok', 'Mapped'],
    ['Branch Expenses (custom)', 'Expense', '18', 'warn', 'Confirm'],
  ];
  return (
    <AppWindow url="app.germin8.in/migrations/sharma-traders/mapping">
      <ScreenHeader crumb="Sharma Traders" title="Ledger mapping" right={<Pill tone="warn">1 to confirm</Pill>} />
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-[10.5px] uppercase tracking-wide text-ink-400 bg-ink-50">
              <th className="text-left font-medium px-4 py-2">Tally group</th>
              <th className="text-left font-medium px-2 py-2" />
              <th className="text-left font-medium px-2 py-2">Zoho Books type</th>
              <th className="text-right font-medium px-2 py-2">Ledgers</th>
              <th className="text-right font-medium px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {rows.map(([a, b, n, tone, label]) => (
              <tr key={a} className={tone === 'warn' ? 'bg-ink-50/60' : ''}>
                <td className="px-4 py-2.5 text-ink-950 font-medium whitespace-nowrap">{a}</td>
                <td className="px-2 py-2.5 text-ink-300">
                  <ArrowRightLeft className="w-3.5 h-3.5" />
                </td>
                <td className="px-2 py-2.5 text-ink-700 whitespace-nowrap">{b}</td>
                <td className="px-2 py-2.5 text-right tabular-nums text-ink-700">{n}</td>
                <td className="px-4 py-2.5 text-right">
                  <Pill tone={tone}>{label}</Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppWindow>
  );
};

/* ---------- 3. Validation checks ---------- */

export const ValidationScreen: React.FC = () => {
  const checks: { title: string; detail: string; tone: Tone }[] = [
    { title: 'Debits equal credits', detail: '₹ 1,33,43,340.00 on both sides', tone: 'ok' },
    { title: 'GSTIN format and checksum', detail: '284 of 286 valid · 2 need correction', tone: 'fail' },
    { title: 'Duplicate parties', detail: '3 debtor/creditor pairs merged', tone: 'ok' },
    { title: 'Place of supply', detail: 'State codes taken from GSTIN', tone: 'ok' },
    { title: 'HSN / SAC codes', detail: '12 items have no code', tone: 'warn' },
  ];
  return (
    <AppWindow url="app.germin8.in/migrations/sharma-traders/checks">
      <ScreenHeader crumb="Sharma Traders" title="Pre-import checks" right={<Pill tone="fail">Fix 2 to continue</Pill>} />
      <ul className="p-4 space-y-2">
        {checks.map((c) => (
          <li
            key={c.title}
            className={cn(
              'flex items-start gap-3 rounded-lg px-3.5 py-3 ring-1',
              c.tone === 'fail' ? 'ring-rose-200 bg-rose-50/50' : c.tone === 'warn' ? 'ring-ink-200 bg-ink-50/50' : 'ring-ink-200'
            )}
          >
            <StatusIcon tone={c.tone} />
            <div className="min-w-0">
              <div className="text-[12.5px] font-medium text-ink-950">{c.title}</div>
              <div className="text-[11.5px] text-ink-500">{c.detail}</div>
              {c.tone === 'fail' && (
                <div className="mt-2 rounded-md bg-white ring-1 ring-rose-200 px-2.5 py-1.5 font-mono text-[11px] text-rose-700">
                  27AAACA9012K1Z<span className="underline">8</span> · Apex Infotech
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </AppWindow>
  );
};

/* ---------- 4. Trial balance comparison ---------- */

export const TrialBalanceScreen: React.FC = () => {
  const rows = [
    ['HDFC Current A/c', '42,18,920.00', '42,18,920.00'],
    ['Apex Infotech Pvt Ltd', '18,45,000.00', '18,45,000.00'],
    ['Input CGST @ 9%', '3,74,210.00', '3,74,210.00'],
    ['Opening Stock', '65,30,000.00', '65,30,000.00'],
  ];
  return (
    <AppWindow url="app.germin8.in/migrations/sharma-traders/report">
      <ScreenHeader
        crumb="Sharma Traders"
        title="Trial balance comparison"
        right={
          <span className="inline-flex items-center gap-1.5 rounded-full bg-mustard-500 text-ink-950 px-3.5 py-1.5 text-[12px] font-semibold font-display shadow-[0_8px_18px_-8px_rgba(23,23,22,0.23)]">
            <Download className="w-3.5 h-3.5" /> Report
          </span>
        }
      />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 p-4 pb-0">
        {[
          { k: 'Tally total', v: '₹ 1,33,43,340', icon: Scale },
          { k: 'Zoho Books total', v: '₹ 1,33,43,340', icon: BookOpen },
          { k: 'Difference', v: '₹ 0.00', icon: Check },
        ].map(({ k, v, icon: Icon }, i) => (
          <div
            key={k}
            className={cn(
              'flex items-center gap-2.5 rounded-xl px-3 py-2.5',
              i === 2 ? 'bg-emerald-50 ring-1 ring-emerald-200' : 'bg-white ring-1 ring-ink-200'
            )}
          >
            <span
              className={cn(
                'w-8 h-8 rounded-full flex items-center justify-center shrink-0',
                i === 2 ? 'bg-emerald-500 text-white' : 'bg-ink-50 text-ink-700'
              )}
            >
              <Icon className="w-4 h-4" strokeWidth={i === 2 ? 3 : 1.75} />
            </span>
            <div className="min-w-0">
              <div className={cn('text-[10.5px]', i === 2 ? 'text-emerald-700' : 'text-ink-500')}>{k}</div>
              <div className={cn('text-[13px] font-bold font-display whitespace-nowrap', i === 2 ? 'text-emerald-700' : 'text-ink-950')}>
                {v}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto p-4">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-[10.5px] uppercase tracking-wide text-ink-400">
              <th className="text-left font-medium pb-2">Ledger</th>
              <th className="text-right font-medium pb-2">Tally</th>
              <th className="text-right font-medium pb-2">Zoho Books</th>
              <th className="text-right font-medium pb-2">Diff.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {rows.map(([a, b, c]) => (
              <tr key={a}>
                <td className="py-2 text-ink-950 whitespace-nowrap pr-3">{a}</td>
                <td className="py-2 text-right tabular-nums text-ink-700 whitespace-nowrap pl-3">{b}</td>
                <td className="py-2 text-right tabular-nums text-ink-700 whitespace-nowrap pl-3">{c}</td>
                <td className="py-2 text-right tabular-nums text-emerald-700 font-medium pl-3">0.00</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppWindow>
  );
};

/* ---------- 5. CIN lookup ---------- */

export const CinLookupScreen: React.FC = () => {
  const directors: [string, string, Tone, string][] = [
    ['Rohit Mehta', '08451279', 'ok', 'KYC filed'],
    ['Anita Rao', '07719384', 'ok', 'KYC filed'],
    ['Vikram Shah', '09102466', 'warn', 'KYC due'],
  ];
  return (
    <AppWindow url="app.germin8.in/mca/new" sidebar="mca">
      <ScreenHeader crumb="MCA filings" title="New filing · Company lookup" />
      <div className="p-5 space-y-4">
        <div className="flex items-center gap-2 rounded-lg ring-1 ring-ink-300 px-3 h-9">
          <Search className="w-3.5 h-3.5 text-ink-400" />
          <span className="font-mono text-[12px] text-ink-950">U72200MH2019PTC328811</span>
        </div>
        <div className="rounded-lg ring-1 ring-ink-200 p-3.5">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-ink-500" />
            <span className="text-[13px] font-semibold text-ink-950 font-display">Northwind Analytics Pvt Ltd</span>
            <Pill tone="ok">Active</Pill>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
            {[
              ['Paid-up capital', '₹ 1,00,00,000'],
              ['RoC', 'Mumbai'],
              ['Last AGM', '28 Sep 2026'],
            ].map(([k, v]) => (
              <div key={k}>
                <div className="text-ink-400">{k}</div>
                <div className="text-ink-950 font-medium">{v}</div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[11px] font-medium text-ink-500 mb-1.5">Directors</div>
          <ul className="divide-y divide-ink-100 rounded-lg ring-1 ring-ink-200">
            {directors.map(([n, din, tone, label]) => (
              <li key={din} className="flex items-center justify-between px-3.5 py-2.5">
                <div>
                  <div className="text-[12.5px] text-ink-950">{n}</div>
                  <div className="text-[11px] text-ink-400 font-mono">DIN {din}</div>
                </div>
                <Pill tone={tone}>{label}</Pill>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </AppWindow>
  );
};

/* ---------- 6. Side-by-side review ---------- */

export const ReviewScreen: React.FC = () => {
  const fields: [string, string][] = [
    ['Share capital', '1,00,00,000'],
    ['Reserves and surplus', '23,62,890'],
    ['Trade payables', '9,80,450'],
    ['Inventories', '65,30,000'],
    ['Cash and cash equivalents', '42,18,920'],
  ];
  return (
    <AppWindow url="app.germin8.in/mca/northwind/aoc-4/review">
      <ScreenHeader
        crumb="Northwind Analytics · AOC-4"
        title="Review extracted figures"
        right={
          <span className="inline-flex items-center gap-1 rounded-md bg-mustard-500 text-ink-950 px-2.5 py-1 text-[11px] font-semibold">
            <Check className="w-3 h-3" strokeWidth={3} /> Approve
          </span>
        }
      />
      <div className="grid grid-cols-1 sm:grid-cols-2">
        {/* Source PDF */}
        <div className="bg-ink-100 p-4 border-b sm:border-b-0 sm:border-r border-ink-200">
          <div className="flex items-center gap-1.5 text-[11px] text-ink-500 mb-2">
            <FileText className="w-3.5 h-3.5" /> Audited_FS_2025-26.pdf · page 3
          </div>
          <div className="rounded bg-white shadow-sm p-3.5 font-serif text-[10.5px] text-ink-700 space-y-1.5">
            <div className="text-center font-semibold text-[11px] text-ink-950">Balance Sheet as at 31 March 2026</div>
            <div className="h-px bg-ink-200 my-1" />
            {fields.map(([k, v], i) => (
              <div
                key={k}
                className={cn('flex justify-between px-1 rounded-sm', i === 1 && 'bg-ink-200/70')}
              >
                <span>{k}</span>
                <span className="tabular-nums">{v}</span>
              </div>
            ))}
            <div className="h-1.5 bg-ink-100 rounded w-3/4" />
            <div className="h-1.5 bg-ink-100 rounded w-2/3" />
          </div>
        </div>
        {/* Extracted fields */}
        <div className="p-4 space-y-2">
          <div className="text-[11px] text-ink-500 mb-1">Form AOC-4 · Part I</div>
          {fields.map(([k, v], i) => (
            <div
              key={k}
              className={cn(
                'flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 ring-1',
                i === 1 ? 'ring-mustard-400 bg-ink-50' : 'ring-ink-200'
              )}
            >
              <span className="text-[11.5px] text-ink-500 truncate">{k}</span>
              <span className="flex items-center gap-1.5 text-[12px] font-medium text-ink-950 tabular-nums">
                {v}
                <Check className="w-3 h-3 text-emerald-600" strokeWidth={3} />
              </span>
            </div>
          ))}
          <div className="pt-1 text-[11px] text-ink-500">5 of 5 fields match the source</div>
        </div>
      </div>
    </AppWindow>
  );
};

/* ---------- 7. Browser extension over the portal ---------- */

export const ExtensionScreen: React.FC = () => (
  <div className="relative">
    <AppWindow url="mca.gov.in · Form AOC-4">
      <div className="p-5">
        <div className="text-[13px] font-semibold text-ink-950 font-display">Form AOC-4 · Balance sheet</div>
        <div className="mt-1 text-[11px] text-ink-400">Ministry of Corporate Affairs · V3 portal (illustration)</div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          {['Share capital', 'Reserves and surplus', 'Long-term borrowings', 'Trade payables', 'Inventories', 'Trade receivables'].map(
            (f, i) => (
              <div key={f}>
                <div className="text-[10.5px] text-ink-500 mb-1">{f}</div>
                <div
                  className={cn(
                    'h-7 rounded ring-1 px-2 flex items-center text-[11.5px] tabular-nums',
                    i < 4 ? 'ring-emerald-300 bg-emerald-50/40 text-ink-950' : 'ring-ink-200 text-ink-300'
                  )}
                >
                  {i < 4 ? ['1,00,00,000', '23,62,890', '0', '9,80,450'][i] : ''}
                </div>
              </div>
            )
          )}
        </div>
      </div>
    </AppWindow>
    <div className="absolute right-3 -top-4 sm:-right-4 sm:top-8 w-56 rounded-xl bg-white ring-1 ring-ink-200 shadow-[0_20px_40px_-12px_rgba(16,22,35,0.35)] p-3.5 font-sans">
      <div className="flex items-center gap-2">
        <span className="w-6 h-6 rounded-md bg-ink-950 text-mustard-500 flex items-center justify-center">
          <Puzzle className="w-3.5 h-3.5" />
        </span>
        <span className="text-[12px] font-semibold text-ink-950 font-display">Germin8 Form Assistant</span>
      </div>
      <div className="mt-3 rounded-lg bg-ink-50 px-2.5 py-2 text-[11px]">
        <div className="text-ink-400">Approved job</div>
        <div className="text-ink-950 font-medium">Northwind · AOC-4 FY 2025-26</div>
      </div>
      <div className="mt-3 flex justify-between text-[11px] text-ink-500">
        <span>Filling fields</span>
        <span className="font-semibold text-ink-950">31 / 46</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-ink-100 overflow-hidden">
        <div className="h-full w-[67%] bg-mustard-500 rounded-full" />
      </div>
      <div className="mt-3 text-[10.5px] text-ink-400">Signing and submission stay with you.</div>
    </div>
  </div>
);

/* ---------- 8. Filing tracker ---------- */

export const FilingTrackerScreen: React.FC = () => {
  const rows: [string, string, string, Tone, string][] = [
    ['Northwind Analytics', 'AOC-4', '28 Oct', 'run', 'In review'],
    ['Kaveri Foods', 'MGT-7', '27 Nov', 'warn', 'KYC due'],
    ['Blue Lotus Exports', 'ADT-1', '13 Oct', 'ok', 'Filed'],
    ['Sharma Traders', 'AOC-4', '30 Oct', 'info', 'Preparing'],
    ['Indus Steelworks', 'MGT-7A', '29 Nov', 'wait', 'Not started'],
  ];
  return (
    <AppWindow url="app.germin8.in/mca" sidebar="mca">
      <ScreenHeader crumb="MCA filings" title="Filing season · FY 2025-26" right={<Pill tone="info">24 companies</Pill>} />
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-[10.5px] uppercase tracking-wide text-ink-400 bg-ink-50">
              <th className="text-left font-medium px-4 py-2">Company</th>
              <th className="text-left font-medium px-2 py-2">Form</th>
              <th className="text-left font-medium px-2 py-2">Due</th>
              <th className="text-right font-medium px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {rows.map(([c, f, d, tone, s]) => (
              <tr key={c}>
                <td className="px-4 py-2.5 text-ink-950 font-medium whitespace-nowrap">{c}</td>
                <td className="px-2 py-2.5 text-ink-700">{f}</td>
                <td className="px-2 py-2.5 text-ink-700 whitespace-nowrap">{d}</td>
                <td className="px-4 py-2.5 text-right">
                  <Pill tone={tone}>{s}</Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppWindow>
  );
};
