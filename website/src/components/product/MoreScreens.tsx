/**
 * Product screens for Office management and Financial statements.
 * Built in code; all names and figures are sample data.
 */
import React from 'react';
import { Check, Clock, CalendarDays, ChevronRight, Sparkles, Link2 } from 'lucide-react';
import { AppWindow, Pill } from '@/components/product/Screens';
import { cn } from '@/lib/utils';

const Header: React.FC<{ crumb: string; title: string; right?: React.ReactNode }> = ({ crumb, title, right }) => (
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

/* ---------- Office management: task board ---------- */

export const TaskBoardScreen: React.FC = () => {
  const cols: { title: string; tone: 'wait' | 'run' | 'ok'; tasks: [string, string, string][] }[] = [
    {
      title: 'To do',
      tone: 'wait',
      tasks: [
        ['GSTR-3B · October', 'Northwind Analytics', '20 Nov'],
        ['TDS payment', 'Quillstone Fintech', '7 Nov'],
      ],
    },
    {
      title: 'In review',
      tone: 'run',
      tasks: [
        ['AOC-4 filing', 'Bluekettle Exports', '18 Oct'],
        ['Bank reconciliation', 'Tamarind Loop Foods', '5 Nov'],
      ],
    },
    {
      title: 'Done',
      tone: 'ok',
      tasks: [['GSTR-1 · October', 'Northwind Analytics', '11 Nov']],
    },
  ];
  return (
    <AppWindow url="app.germin8.in/office/tasks">
      <Header
        crumb="Office"
        title="Tasks · November"
        right={
          <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-50 ring-1 ring-ink-200 px-2.5 py-1 text-[11px] font-semibold text-ink-950">
            <Sparkles className="w-3 h-3 text-mustard-600" /> 14 created automatically
          </span>
        }
      />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 bg-ink-50/60">
        {cols.map((c) => (
          <div key={c.title}>
            <div className="flex items-center justify-between px-1 mb-2">
              <span className="text-[11.5px] font-semibold text-ink-700">{c.title}</span>
              <Pill tone={c.tone}>{c.tasks.length}</Pill>
            </div>
            <div className="space-y-2">
              {c.tasks.map(([t, client, due]) => (
                <div key={t} className="rounded-lg bg-white ring-1 ring-ink-200 p-2.5">
                  <div className={cn('text-[12px] font-medium text-ink-950', c.tone === 'ok' && 'line-through text-ink-400')}>{t}</div>
                  <div className="text-[11px] text-ink-500">{client}</div>
                  <div className="mt-1.5 flex items-center gap-1 text-[10.5px] text-ink-500">
                    {c.tone === 'ok' ? <Check className="w-3 h-3 text-emerald-600" strokeWidth={3} /> : <Clock className="w-3 h-3" />}
                    {due}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </AppWindow>
  );
};

/* ---------- Office management: compliance calendar ---------- */

export const ComplianceCalendarScreen: React.FC = () => {
  const marks: Record<number, 'ok' | 'warn' | 'due'> = { 7: 'ok', 11: 'ok', 13: 'warn', 20: 'due', 25: 'due', 30: 'due' };
  const list: [string, string, 'ok' | 'warn' | 'wait'][] = [
    ['7 Nov', 'TDS payment · 6 clients', 'ok'],
    ['13 Nov', 'GSTR-1 (IFF) · 2 pending', 'warn'],
    ['20 Nov', 'GSTR-3B · 9 clients', 'wait'],
    ['30 Nov', 'MGT-7 · 3 companies', 'wait'],
  ];
  return (
    <AppWindow url="app.germin8.in/office/calendar">
      <Header crumb="Office" title="Compliance calendar" right={<Pill tone="info">November</Pill>} />
      <div className="grid grid-cols-1 sm:grid-cols-2">
        <div className="p-4 border-b sm:border-b-0 sm:border-r border-ink-100">
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-ink-400 mb-1">
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
              <span key={i}>{d}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: 30 }, (_, i) => i + 1).map((d) => {
              const m = marks[d];
              return (
                <span
                  key={d}
                  className={cn(
                    'aspect-square rounded-md flex items-center justify-center text-[11px]',
                    !m && 'text-ink-600',
                    m === 'ok' && 'bg-emerald-50 text-emerald-700 font-semibold',
                    m === 'warn' && 'bg-rose-50 text-rose-700 font-semibold ring-1 ring-rose-200',
                    m === 'due' && 'bg-ink-100 text-ink-950 font-semibold'
                  )}
                >
                  {d}
                </span>
              );
            })}
          </div>
        </div>
        <ul className="p-4 space-y-2">
          {list.map(([date, what, tone]) => (
            <li key={date} className="flex items-center gap-2.5 rounded-lg ring-1 ring-ink-200 px-3 py-2">
              <CalendarDays className="w-3.5 h-3.5 text-ink-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-medium text-ink-950 truncate">{what}</div>
                <div className="text-[10.5px] text-ink-500">{date}</div>
              </div>
              <Pill tone={tone}>{tone === 'ok' ? 'Done' : tone === 'warn' ? 'Late' : 'Upcoming'}</Pill>
            </li>
          ))}
        </ul>
      </div>
    </AppWindow>
  );
};

/* ---------- Financial statements: ledger grouping ---------- */

export const FsMappingScreen: React.FC = () => {
  const rows: [string, string, string, 'ok' | 'warn'][] = [
    ['HDFC Current A/c', 'Cash and cash equivalents', '42,18,920', 'ok'],
    ['Sundry Debtors', 'Trade receivables', '18,45,000', 'ok'],
    ['Stock-in-Hand', 'Inventories', '65,30,000', 'ok'],
    ['Loan from Director', 'Confirm: borrowings', '12,00,000', 'warn'],
    ['Salary Payable', 'Other current liabilities', '4,12,500', 'ok'],
  ];
  return (
    <AppWindow url="app.germin8.in/statements/northwind/grouping">
      <Header crumb="Northwind Analytics · FY 2025-26" title="Ledger grouping" right={<Pill tone="warn">1 to confirm</Pill>} />
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-[10.5px] uppercase tracking-wide text-ink-400 bg-ink-50">
              <th className="text-left font-medium px-4 py-2">Ledger</th>
              <th className="text-left font-medium px-2 py-2">Statement head</th>
              <th className="text-right font-medium px-4 py-2">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {rows.map(([a, b, amt, tone]) => (
              <tr key={a} className={tone === 'warn' ? 'bg-ink-50/60' : ''}>
                <td className="px-4 py-2.5 text-ink-950 font-medium whitespace-nowrap">{a}</td>
                <td className="px-2 py-2.5 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5 text-ink-700">
                    <Link2 className="w-3 h-3 text-ink-400" />
                    {b}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-ink-700">{amt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppWindow>
  );
};

/* ---------- Financial statements: draft preview ---------- */

export const FsPreviewScreen: React.FC = () => {
  const lines: [string, string, string][] = [
    ['Share capital', '1,00,00,000', '1,00,00,000'],
    ['Reserves and surplus', '23,62,890', '14,10,220'],
    ['Trade payables', '9,80,450', '7,45,300'],
    ['Inventories', '65,30,000', '58,90,000'],
    ['Trade receivables', '18,45,000', '15,20,000'],
  ];
  return (
    <AppWindow url="app.germin8.in/statements/northwind/draft">
      <Header
        crumb="Northwind Analytics · FY 2025-26"
        title="Draft financial statements"
        right={
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 ring-1 ring-emerald-200 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
            <Check className="w-3 h-3" strokeWidth={3} /> Totals tie
          </span>
        }
      />
      <div className="bg-ink-100 p-4">
        <div className="mx-auto max-w-md rounded bg-white shadow-sm px-5 py-4 font-serif text-[11px] text-ink-700">
          <div className="text-center text-[12px] font-semibold text-ink-950">Balance Sheet as at 31 March 2026</div>
          <div className="mt-2 grid grid-cols-[1fr_auto_auto] gap-x-5 border-b border-ink-200 pb-1 text-[10px] text-ink-500">
            <span>Particulars</span>
            <span className="text-right">2026</span>
            <span className="text-right">2025</span>
          </div>
          {lines.map(([k, a, b]) => (
            <div key={k} className="grid grid-cols-[1fr_auto_auto] gap-x-5 py-1 border-b border-ink-100">
              <span>{k}</span>
              <span className="text-right tabular-nums">{a}</span>
              <span className="text-right tabular-nums text-ink-500">{b}</span>
            </div>
          ))}
          <div className="mt-2 flex gap-1.5">
            {['Note 3', 'Note 4', 'Note 7'].map((n) => (
              <span key={n} className="rounded bg-ink-50 px-1.5 py-0.5 font-sans text-[9.5px] font-semibold text-mustard-800">
                {n}
              </span>
            ))}
          </div>
        </div>
      </div>
    </AppWindow>
  );
};
