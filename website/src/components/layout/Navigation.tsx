import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X, ChevronDown, ArrowRight } from 'lucide-react';
import { Germin8Logo } from '@/components/ui/Germin8Logo';
import { cn } from '@/lib/utils';

type PageLink = { label: string; href: string; note?: string };
type Column = { title: string; links: PageLink[] };
type MenuGroup = {
  key: string;
  label: string;
  href: string;
  match: string[];
  columns: Column[];
  intro: { title: string; body: string; cta: PageLink };
};

/** Every page on the site, grouped the way visitors look for them. */
const MENUS: MenuGroup[] = [
  {
    key: 'solutions',
    label: 'Solutions',
    href: '/products',
    match: ['/products', '/for/'],
    intro: {
      title: 'The finance function, piece by piece',
      body: 'Standard tools for the common work, and custom automation for the rest.',
      cta: { label: 'See all solutions', href: '/products' },
    },
    columns: [
      {
        title: 'Standard solutions',
        links: [
          { label: 'Tally to Zoho migration', href: '/products/tally-to-zoho', note: 'Books moved, balances matched' },
          { label: 'Office management', href: '/products/office-management', note: 'Tasks and compliance dates' },
          { label: 'Incorporation and ROC', href: '/products/incorporation-roc', note: 'Forms prepared and tracked' },
          { label: 'Financial statements', href: '/products/financial-statements', note: 'From trial balance to statements' },
        ],
      },
      {
        title: 'More',
        links: [
          { label: 'Custom automation', href: '/products/custom-automation', note: 'Built around your process' },
          { label: 'MCA annual filing', href: '/products/mca-automation' },
          { label: 'Enterprise migration', href: '/products/financial-data-migration' },
          { label: 'Roadmap', href: '/products/future-products' },
        ],
      },
      {
        title: 'Who it is for',
        links: [
          { label: 'Startups', href: '/for/startups', note: 'A finance function without a big team' },
          { label: 'Practicing consultants', href: '/for/consultants', note: 'More clients, same team' },
        ],
      },
    ],
  },
  {
    key: 'resources',
    label: 'Resources',
    href: '/resources',
    match: ['/resources', '/blog', '/faq', '/guides', '/docs'],
    intro: {
      title: 'Learn how each tool works',
      body: 'What every tool does, the problem it solves and how easy it is to use. Plus guides and documentation.',
      cta: { label: 'Tools library', href: '/resources/tools' },
    },
    columns: [
      {
        title: 'Learn',
        links: [
          { label: 'Tools library', href: '/resources/tools', note: 'Every tool, explained' },
          { label: 'Resource centre', href: '/resources' },
          { label: 'Blog', href: '/blog' },
          { label: 'FAQ', href: '/faq' },
        ],
      },
      {
        title: 'User guides',
        links: [
          { label: 'All guides', href: '/guides' },
          { label: 'Getting started', href: '/guides/getting-started' },
          { label: 'Account setup', href: '/guides/account-setup' },
          { label: 'Tally to Zoho migration', href: '/guides/tally-to-zoho-migration' },
          { label: 'MCA filing', href: '/guides/mca-automation' },
          { label: 'Data validation', href: '/guides/data-validation' },
          { label: 'Troubleshooting', href: '/guides/troubleshooting' },
        ],
      },
      {
        title: 'Documentation',
        links: [
          { label: 'Overview', href: '/docs' },
          { label: 'Installation', href: '/docs/installation' },
          { label: 'Tally migration spec', href: '/docs/tally-migration' },
          { label: 'MCA form spec', href: '/docs/mca-automation' },
          { label: 'Browser extension', href: '/docs/browser-extension' },
          { label: 'Workflows', href: '/docs/workflows' },
          { label: 'Integrations', href: '/docs/integrations' },
          { label: 'Troubleshooting', href: '/docs/troubleshooting' },
        ],
      },
    ],
  },
  {
    key: 'company',
    label: 'Company',
    href: '/about',
    match: ['/about', '/careers', '/security', '/support', '/book-a-demo'],
    intro: {
      title: 'About Germin8',
      body: 'A technology company working in finance. We build software that runs the finance function.',
      cta: { label: 'About us', href: '/about' },
    },
    columns: [
      {
        title: 'Company',
        links: [
          { label: 'About us', href: '/about', note: 'Who we are and what we are building' },
          { label: 'Careers', href: '/careers', note: 'Work with us' },
          { label: 'Security', href: '/security', note: 'How we look after data' },
        ],
      },
      {
        title: 'Get in touch',
        links: [
          { label: 'Contact', href: '/contact' },
          { label: 'Book a demo', href: '/book-a-demo' },
          { label: 'Support', href: '/support' },
          { label: 'Sitemap', href: '/sitemap' },
        ],
      },
    ],
  },
];

export const Navigation: React.FC = () => {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileGroup, setMobileGroup] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const location = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
    setOpen(null);
  }, [location.pathname]);

  const isActive = (m: MenuGroup) => m.match.some((p) => location.pathname.startsWith(p));
  const current = MENUS.find((m) => m.key === open);

  const pill = (on: boolean) =>
    cn(
      'inline-flex items-center gap-1 whitespace-nowrap px-3 xl:px-3.5 py-2 rounded-full text-[14px] xl:text-[15px] font-medium transition-colors',
      on ? 'text-ink-950 bg-ink-100' : 'text-ink-600 hover:text-ink-950'
    );

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-40 px-3 sm:px-5 pt-3" onMouseLeave={() => setOpen(null)}>
        <div
          className={cn(
            'relative max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3 xl:gap-6 rounded-2xl bg-white/90 backdrop-blur-md ring-1 ring-ink-200/70 transition-shadow',
            scrolled || open
              ? 'shadow-[0_12px_32px_-16px_rgba(23,23,22,0.25)]'
              : 'shadow-[0_8px_24px_-18px_rgba(23,23,22,0.2)]'
          )}
        >
          <Link to="/" aria-label="Germin8 home" className="shrink-0" onMouseEnter={() => setOpen(null)}>
            <Germin8Logo size="md" />
          </Link>

          <nav className="hidden lg:flex items-center gap-1" aria-label="Primary">
            <Link to="/" onMouseEnter={() => setOpen(null)} className={pill(location.pathname === '/')}>
              Home
            </Link>
            {MENUS.map((m) => (
              <Link
                key={m.key}
                to={m.href}
                onMouseEnter={() => setOpen(m.key)}
                onFocus={() => setOpen(m.key)}
                aria-expanded={open === m.key}
                className={pill(isActive(m) || open === m.key)}
              >
                {m.label}
                <ChevronDown className={cn('w-4 h-4 transition-transform', open === m.key && 'rotate-180')} />
              </Link>
            ))}
            <Link to="/pricing" onMouseEnter={() => setOpen(null)} className={pill(location.pathname === '/pricing')}>
              Pricing
            </Link>
            <Link
              to="/companies"
              onMouseEnter={() => setOpen(null)}
              className={pill(location.pathname.startsWith('/compan'))}
            >
              Company database
            </Link>
            <Link
              to="/contact"
              onMouseEnter={() => setOpen(null)}
              className={cn(pill(location.pathname.startsWith('/contact')), 'hidden xl:inline-flex')}
            >
              Contact
            </Link>
          </nav>

          <div className="flex items-center gap-2" onMouseEnter={() => setOpen(null)}>
            <Link
              to="/login"
              className="hidden sm:inline-flex h-10 px-3 xl:px-4 items-center whitespace-nowrap rounded-xl text-[14px] xl:text-[15px] font-medium text-ink-700 hover:text-ink-950"
            >
              Sign in
            </Link>
            <Link
              to="/book-a-demo"
              className="group hidden sm:inline-flex h-11 pl-5 pr-4 items-center gap-2 whitespace-nowrap rounded-full bg-ink-950 hover:bg-ink-800 text-white text-[15px] font-semibold font-display transition-colors"
            >
              Book a demo
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <button
              type="button"
              onClick={() => setMobileOpen((v) => !v)}
              className="lg:hidden p-2 -mr-2 text-ink-950"
              aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileOpen}
            >
              {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>

        {/* Desktop menu: every page in the group, as text */}
        {current && (
          <div className="hidden lg:block max-w-7xl mx-auto pt-2">
            <div className="rounded-2xl bg-white ring-1 ring-ink-200 shadow-[0_32px_64px_-24px_rgba(23,23,22,0.3)] overflow-hidden">
              <div className="grid grid-cols-12">
                <div className="col-span-3 bg-gradient-to-br from-ink-50 to-white border-r border-ink-100 p-7 flex flex-col">
                  <p className="text-[18px] font-bold font-display text-ink-950">{current.intro.title}</p>
                  <p className="mt-2 text-[14px] leading-relaxed text-ink-600 flex-1">{current.intro.body}</p>
                  <Link
                    to={current.intro.cta.href}
                    className="group mt-6 inline-flex items-center gap-1.5 text-[14px] font-semibold font-display text-ink-950"
                  >
                    {current.intro.cta.label}
                    <ArrowRight className="w-4 h-4 text-mustard-600 transition-transform group-hover:translate-x-0.5" />
                  </Link>
                </div>
                <div
                  className={cn(
                    'col-span-9 grid gap-8 p-7',
                    current.columns.length === 3 ? 'grid-cols-3' : 'grid-cols-2'
                  )}
                >
                  {current.columns.map((c) => (
                    <div key={c.title}>
                      <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-400">{c.title}</p>
                      <ul className="mt-3 space-y-0.5">
                        {c.links.map((l) => (
                          <li key={l.href}>
                            <Link
                              to={l.href}
                              className={cn(
                                'group block rounded-lg px-2.5 py-2 -mx-2.5 hover:bg-ink-50 transition-colors',
                                location.pathname === l.href && 'bg-ink-50'
                              )}
                            >
                              <span className="block text-[14.5px] font-medium text-ink-950 group-hover:text-mustard-800">
                                {l.label}
                              </span>
                              {l.note && <span className="block text-[13px] text-ink-500">{l.note}</span>}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Mobile menu */}
        {mobileOpen && (
          <div className="lg:hidden mt-2 max-w-7xl mx-auto rounded-2xl ring-1 ring-ink-200 bg-white shadow-xl max-h-[calc(100vh-96px)] overflow-y-auto">
            <div className="px-5 py-4">
              <Link to="/" className="block py-3 text-[17px] font-semibold text-ink-950 border-b border-ink-100">
                Home
              </Link>
              {MENUS.map((m) => (
                <div key={m.key} className="border-b border-ink-100">
                  <button
                    type="button"
                    onClick={() => setMobileGroup((g) => (g === m.key ? null : m.key))}
                    className="w-full flex items-center justify-between py-3 text-[17px] font-semibold text-ink-950"
                    aria-expanded={mobileGroup === m.key}
                  >
                    {m.label}
                    <ChevronDown className={cn('w-5 h-5 transition-transform', mobileGroup === m.key && 'rotate-180')} />
                  </button>
                  {mobileGroup === m.key && (
                    <div className="pb-4 space-y-4">
                      {m.columns.map((c) => (
                        <div key={c.title}>
                          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-400">{c.title}</p>
                          <ul className="mt-1.5">
                            {c.links.map((l) => (
                              <li key={l.href}>
                                <Link to={l.href} className="block py-1.5 text-[15px] text-ink-700">
                                  {l.label}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              <Link to="/companies" className="block py-3 text-[17px] font-semibold text-ink-950 border-b border-ink-100">
                Company database
              </Link>
              <Link to="/contact" className="block py-3 text-[17px] font-semibold text-ink-950 border-b border-ink-100">
                Contact
              </Link>
              <Link to="/login" className="block py-3 text-[17px] font-semibold text-ink-950 border-b border-ink-100">
                Sign in
              </Link>
              <Link to="/signup" className="block py-3 text-[17px] font-semibold text-ink-950">
                Create an account
              </Link>
              <Link
                to="/book-a-demo"
                className="mt-3 flex h-12 items-center justify-center gap-2 rounded-full bg-ink-950 text-white font-semibold font-display"
              >
                Book a demo
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        )}
      </header>
    </>
  );
};
