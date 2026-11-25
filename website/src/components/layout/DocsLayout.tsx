import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Search,
  ChevronDown,
  Menu,
  X,
  Clock,
  ArrowLeft,
  ArrowRight,
  Info,
  CheckCircle2,
  AlertTriangle,
  LifeBuoy,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DocSidebarItem {
  title: string;
  href: string;
  badge?: string;
}

export interface DocSidebarSection {
  title: string;
  items: DocSidebarItem[];
}

export const DOCS_SECTIONS: DocSidebarSection[] = [
  {
    title: 'Start here',
    items: [
      { title: 'Documentation home', href: '/docs' },
      { title: 'Before you install', href: '/docs/installation' },
      { title: 'Browser extension', href: '/docs/browser-extension' },
    ],
  },
  {
    title: 'Technical reference',
    items: [
      { title: 'Tally to Zoho field mapping', href: '/docs/tally-migration' },
      { title: 'MCA form filling', href: '/docs/mca-automation' },
      { title: 'How a job runs', href: '/docs/workflows' },
      { title: 'Connections: Zoho, Tally, MCA', href: '/docs/integrations' },
    ],
  },
  {
    title: 'User guides',
    items: [
      { title: 'All guides', href: '/guides' },
      { title: 'Move from Tally to Zoho Books', href: '/guides/tally-to-zoho-migration' },
      { title: 'Prepare AOC-4 and other MCA forms', href: '/guides/mca-automation' },
      { title: 'Set up your account', href: '/guides/account-setup' },
      { title: 'First migration checklist', href: '/guides/getting-started' },
      { title: 'Checks and mismatches', href: '/guides/data-validation' },
    ],
  },
  {
    title: 'Help',
    items: [
      { title: 'Error codes and logs', href: '/docs/troubleshooting' },
      { title: 'Common problems', href: '/guides/troubleshooting' },
      { title: 'FAQ', href: '/faq' },
    ],
  },
];

export interface DocsLayoutProps {
  children: React.ReactNode;
  activeHref?: string;
  toc?: { id: string; title: string }[];
  lastUpdated?: string;
  prevPage?: { title: string; href: string };
  nextPage?: { title: string; href: string };
}

const SidebarNav: React.FC<{ currentPath: string; onNavigate?: () => void }> = ({ currentPath, onNavigate }) => {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const sections = DOCS_SECTIONS.map((sec) => ({
    ...sec,
    items: sec.items.filter(
      (item) => !q || item.title.toLowerCase().includes(q) || sec.title.toLowerCase().includes(q)
    ),
  })).filter((sec) => sec.items.length > 0);

  return (
    <nav aria-label="Documentation">
      <label className="relative block mb-6">
        <span className="sr-only">Filter pages</span>
        <Search className="w-4 h-4 text-ink-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter pages"
          className="w-full h-10 pl-9 pr-3 text-sm rounded-xl bg-white ring-1 ring-ink-200 placeholder:text-ink-400 text-ink-950 focus:outline-none focus:ring-2 focus:ring-mustard-400"
        />
      </label>

      <div className="space-y-7">
        {sections.map((sec) => (
          <div key={sec.title}>
            <h4 className="px-3 mb-2 text-[12px] font-bold uppercase tracking-[0.08em] text-ink-400 font-display">
              {sec.title}
            </h4>
            <ul className="space-y-0.5">
              {sec.items.map((item) => {
                const isActive = currentPath === item.href;
                return (
                  <li key={item.href}>
                    <Link
                      to={item.href}
                      onClick={onNavigate}
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(
                        'relative flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-[14px] transition-colors',
                        isActive
                          ? 'bg-ink-50 text-ink-950 font-semibold ring-1 ring-ink-200'
                          : 'text-ink-600 hover:text-ink-950 hover:bg-ink-50'
                      )}
                    >
                      {isActive && (
                        <span aria-hidden className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-mustard-500" />
                      )}
                      <span>{item.title}</span>
                      {item.badge && (
                        <span className="shrink-0 rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-semibold text-ink-700">
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {sections.length === 0 && <p className="px-3 text-sm text-ink-500">No pages match that.</p>}
      </div>
    </nav>
  );
};

export const DocsLayout: React.FC<DocsLayoutProps> = ({
  children,
  activeHref,
  toc = [],
  lastUpdated = 'Draft, review before publishing',
  prevPage,
  nextPage,
}) => {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const location = useLocation();
  const currentPath = activeHref || location.pathname;
  const pageTitle = DOCS_SECTIONS.flatMap((s) => s.items).find((i) => i.href === currentPath)?.title;
  const currentTitle = pageTitle ?? 'Browse pages';

  useEffect(() => {
    document.title = `${pageTitle ?? 'Documentation'} · Germin8`;
  }, [pageTitle]);

  const tocKey = toc.map((t) => t.id).join('|');

  useEffect(() => {
    if (!tocKey || typeof IntersectionObserver === 'undefined') return;
    const ids = tocKey.split('|');
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: '-120px 0px -60% 0px' }
    );
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [tocKey]);

  return (
    <div className="min-h-screen bg-white pt-28 lg:pt-32 pb-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Mobile nav toggle */}
        <div className="lg:hidden mb-8">
          <button
            type="button"
            onClick={() => setMobileNavOpen((o) => !o)}
            aria-expanded={mobileNavOpen}
            className="w-full flex items-center justify-between gap-3 rounded-xl bg-white ring-1 ring-ink-200 px-4 h-12 text-left"
          >
            <span className="flex items-center gap-2.5 min-w-0">
              {mobileNavOpen ? (
                <X className="w-4 h-4 text-ink-700 shrink-0" aria-hidden />
              ) : (
                <Menu className="w-4 h-4 text-ink-700 shrink-0" aria-hidden />
              )}
              <span className="text-[14px] font-semibold font-display text-ink-950 truncate">{currentTitle}</span>
            </span>
            <ChevronDown
              className={cn('w-4 h-4 text-ink-500 shrink-0 transition-transform', mobileNavOpen && 'rotate-180')}
              aria-hidden
            />
          </button>
          {mobileNavOpen && (
            <div className="mt-3 rounded-2xl bg-paper ring-1 ring-ink-200 p-4">
              <SidebarNav currentPath={currentPath} onNavigate={() => setMobileNavOpen(false)} />
            </div>
          )}
        </div>

        <div className="lg:grid lg:grid-cols-[250px_minmax(0,1fr)] xl:grid-cols-[250px_minmax(0,1fr)_210px] lg:gap-12">
          {/* Left sidebar */}
          <aside className="hidden lg:block">
            <div className="sticky top-28 max-h-[calc(100vh-8rem)] overflow-y-auto pr-2 pb-8">
              <SidebarNav currentPath={currentPath} />
            </div>
          </aside>

          {/* Main column */}
          <article className="min-w-0 max-w-3xl">
            {children}

            <div className="mt-16 pt-8 border-t border-ink-200">
              <p className="flex items-center gap-2 text-[13px] text-ink-500">
                <Clock className="w-3.5 h-3.5 text-ink-400" aria-hidden />
                Last updated: {lastUpdated}
              </p>

              {(prevPage || nextPage) && (
                <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {prevPage ? (
                    <Link
                      to={prevPage.href}
                      className="group rounded-2xl bg-white ring-1 ring-ink-200 p-5 transition-all duration-300 hover:ring-ink-300 hover:-translate-y-0.5 hover:shadow-[0_20px_40px_-24px_rgba(23,23,22,0.3)]"
                    >
                      <span className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-400">
                        <ArrowLeft className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5" aria-hidden />
                        Previous
                      </span>
                      <span className="mt-1.5 block text-[15px] font-bold font-display text-ink-950">{prevPage.title}</span>
                    </Link>
                  ) : (
                    <span className="hidden sm:block" />
                  )}
                  {nextPage && (
                    <Link
                      to={nextPage.href}
                      className="group rounded-2xl bg-white ring-1 ring-ink-200 p-5 sm:text-right transition-all duration-300 hover:ring-ink-300 hover:-translate-y-0.5 hover:shadow-[0_20px_40px_-24px_rgba(23,23,22,0.3)]"
                    >
                      <span className="flex items-center sm:justify-end gap-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-400">
                        Next
                        <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
                      </span>
                      <span className="mt-1.5 block text-[15px] font-bold font-display text-ink-950">{nextPage.title}</span>
                    </Link>
                  )}
                </div>
              )}
            </div>
          </article>

          {/* Right table of contents */}
          {toc.length > 0 ? (
            <aside className="hidden xl:block">
              <div className="sticky top-28 max-h-[calc(100vh-8rem)] overflow-y-auto pb-8">
                <h5 className="text-[12px] font-bold uppercase tracking-[0.08em] text-ink-400 font-display">
                  On this page
                </h5>
                <ul className="mt-3 border-l border-ink-200">
                  {toc.map((item) => (
                    <li key={item.id}>
                      <a
                        href={`#${item.id}`}
                        className={cn(
                          '-ml-px block border-l-2 pl-3 py-1.5 text-[13.5px] leading-snug transition-colors',
                          activeId === item.id
                            ? 'border-mustard-500 text-ink-950 font-semibold'
                            : 'border-transparent text-ink-500 hover:text-ink-950'
                        )}
                      >
                        {item.title}
                      </a>
                    </li>
                  ))}
                </ul>

                <div className="mt-8 rounded-2xl bg-paper ring-1 ring-ink-200 p-4">
                  <LifeBuoy className="w-4 h-4 text-mustard-700" aria-hidden />
                  <p className="mt-2 text-[13px] font-semibold font-display text-ink-950">Stuck on something?</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink-500">Tell us what you are trying to do.</p>
                  <Link to="/contact" className="mt-2 inline-flex items-center gap-1 text-[13px] font-semibold text-mustard-700 hover:text-ink-950">
                    Contact us <ArrowRight className="w-3.5 h-3.5" aria-hidden />
                  </Link>
                </div>
              </div>
            </aside>
          ) : (
            <span className="hidden xl:block" />
          )}
        </div>
      </div>
    </div>
  );
};

/* ---------- Building blocks for docs and guides pages ---------- */

/** Title block at the top of a docs or guides page. */
export const DocHeader: React.FC<{ eyebrow: string; title: string; description?: React.ReactNode }> = ({
  eyebrow,
  title,
  description,
}) => (
  <header>
    <p className="text-[13px] font-semibold font-display uppercase tracking-[0.08em] text-mustard-700">{eyebrow}</p>
    <h1 className="mt-2 text-[32px] sm:text-[40px] font-extrabold font-display tracking-[-0.025em] leading-[1.1] text-ink-950">
      {title}
    </h1>
    {description && <p className="mt-4 text-[17px] leading-relaxed text-ink-500">{description}</p>}
  </header>
);

/** A titled section of a docs page. Its id feeds the "On this page" list. */
export const DocSection: React.FC<{ id: string; title: string; children: React.ReactNode }> = ({ id, title, children }) => (
  <section id={id} className="scroll-mt-32 pt-10 mt-10 border-t border-ink-200">
    <h2 className="text-[22px] sm:text-[24px] font-bold font-display tracking-[-0.015em] text-ink-950">{title}</h2>
    <div className="mt-4 space-y-4 text-[15.5px] leading-relaxed text-ink-600 [&_strong]:text-ink-950 [&_strong]:font-semibold [&_:not(pre)>code]:rounded-md [&_:not(pre)>code]:bg-ink-100 [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[13px] [&_:not(pre)>code]:text-ink-900 [&_:not(pre)>code]:break-words">
      {children}
    </div>
  </section>
);

const NOTE_TONES: Record<'info' | 'success' | 'warning', { icon: LucideIcon; box: string; icon_: string }> = {
  info: { icon: Info, box: 'bg-ink-50 ring-ink-200', icon_: 'text-mustard-700' },
  success: { icon: CheckCircle2, box: 'bg-emerald-50 ring-emerald-200', icon_: 'text-emerald-600' },
  warning: { icon: AlertTriangle, box: 'bg-ink-50 ring-ink-300', icon_: 'text-mustard-700' },
};

/** Highlighted note inside a docs page. */
export const DocNote: React.FC<{ tone?: 'info' | 'success' | 'warning'; title?: string; children: React.ReactNode }> = ({
  tone = 'info',
  title,
  children,
}) => {
  const t = NOTE_TONES[tone];
  return (
    <div className={cn('flex gap-3 rounded-2xl ring-1 p-4 sm:p-5', t.box)}>
      <t.icon className={cn('w-5 h-5 shrink-0 mt-0.5', t.icon_)} aria-hidden />
      <div className="text-[15px] leading-relaxed text-ink-700">
        {title && <p className="font-semibold font-display text-ink-950">{title}</p>}
        <div className={cn(title && 'mt-1')}>{children}</div>
      </div>
    </div>
  );
};

/** A list of labelled items, each in its own card. */
export const DocItems: React.FC<{ items: { label: React.ReactNode; body: React.ReactNode; status?: string }[] }> = ({ items }) => (
  <ul className="space-y-3">
    {items.map((it, i) => (
      <li key={i} className="rounded-xl bg-white ring-1 ring-ink-200 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="font-semibold font-display text-ink-950 break-words min-w-0">{it.label}</p>
          {it.status && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 ring-1 ring-emerald-200 px-2.5 py-0.5 text-[12px] font-semibold text-emerald-700">
              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden />
              {it.status}
            </span>
          )}
        </div>
        <div className="mt-1 text-[15px] leading-relaxed text-ink-600">{it.body}</div>
      </li>
    ))}
  </ul>
);

/** Numbered steps inside a docs page. */
export const DocSteps: React.FC<{ steps: React.ReactNode[] }> = ({ steps }) => (
  <ol className="space-y-3">
    {steps.map((s, i) => (
      <li key={i} className="flex gap-3">
        <span className="mt-0.5 inline-flex w-7 h-7 shrink-0 items-center justify-center rounded-full bg-mustard-500 text-ink-950 text-[13px] font-bold font-display">
          {i + 1}
        </span>
        <div className="min-w-0 pt-0.5">{s}</div>
      </li>
    ))}
  </ol>
);

/** Simple table that scrolls sideways on small screens. */
export const DocTable: React.FC<{ head: string[]; rows: React.ReactNode[][]; monoCols?: number[] }> = ({
  head,
  rows,
  monoCols = [],
}) => (
  <div className="overflow-x-auto rounded-xl ring-1 ring-ink-200">
    <table className="w-full min-w-[520px] text-left text-[14px]">
      <thead className="bg-paper">
        <tr>
          {head.map((h) => (
            <th key={h} className="px-4 py-3 font-semibold font-display text-ink-950 border-b border-ink-200">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-ink-100">
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td key={j} className={cn('px-4 py-3 align-top text-ink-700', monoCols.includes(j) && 'font-mono text-[13px] text-ink-900')}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

/** Bulleted list with mustard dots. */
export const DocList: React.FC<{ items: React.ReactNode[] }> = ({ items }) => (
  <ul className="space-y-2">
    {items.map((it, i) => (
      <li key={i} className="flex gap-3">
        <span aria-hidden className="mt-[0.6em] w-1.5 h-1.5 shrink-0 rounded-full bg-mustard-500" />
        <span className="min-w-0">{it}</span>
      </li>
    ))}
  </ul>
);

/** Card grid used on the docs and guides index pages. */
export const DocCards: React.FC<{
  items: { title: string; body: string; href: string; icon: LucideIcon; meta?: string }[];
}> = ({ items }) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
    {items.map((it) => (
      <Link
        key={it.href}
        to={it.href}
        className="group flex flex-col rounded-2xl bg-white ring-1 ring-ink-200 p-6 transition-all duration-300 hover:ring-ink-300 hover:-translate-y-1 hover:shadow-[0_24px_48px_-24px_rgba(23,23,22,0.25)]"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="w-11 h-11 rounded-full bg-ink-50 ring-1 ring-ink-200 text-mustard-700 flex items-center justify-center">
            <it.icon className="w-5 h-5" strokeWidth={1.75} aria-hidden />
          </span>
          {it.meta && <span className="text-[12px] font-medium text-ink-400">{it.meta}</span>}
        </div>
        <h3 className="mt-4 text-[17px] font-bold font-display text-ink-950">{it.title}</h3>
        <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-500 flex-1">{it.body}</p>
        <span className="mt-4 inline-flex items-center gap-1.5 text-[14px] font-semibold font-display text-mustard-700 group-hover:text-ink-950">
          Read
          <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
        </span>
      </Link>
    ))}
  </div>
);
