import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';

const LINKS: { label: string; to: string }[] = [
  { label: 'Home', to: '/' },
  { label: 'Solutions', to: '/products' },
  { label: 'Products', to: '/resources/tools' },
  { label: 'Pricing', to: '/pricing' },
  { label: 'Resources', to: '/resources' },
  { label: 'Company', to: '/about' },
  { label: 'Company Database', to: '/companies' },
];

const Logo: React.FC = () => (
  <span className="inline-flex items-center gap-[3px]" aria-label="Germin8">
    <span className="font-display font-extrabold tracking-[-0.03em] leading-none text-[26px] text-[#171717]">Germin</span>
    <svg height="16" viewBox="0 0 40 20" fill="none" aria-hidden>
      <path
        d="M10 3.5C5.9 3.5 3 6.4 3 10s2.9 6.5 7 6.5c3.6 0 6-2.6 10-6.5 4-3.9 6.4-6.5 10-6.5 4.1 0 7 2.9 7 6.5s-2.9 6.5-7 6.5c-3.6 0-6-2.6-10-6.5-4-3.9-6.4-6.5-10-6.5Z"
        stroke="#C9A332"
        strokeWidth="3.4"
        strokeLinejoin="round"
      />
    </svg>
  </span>
);

/** Homepage-only top navigation. The rest of the site keeps the shared Navigation. */
export const HomeNav: React.FC = () => {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-40 transition-all duration-300',
        scrolled || open
          ? 'bg-[#FFFFFF]/85 backdrop-blur-xl border-b border-[#171717]/10'
          : 'bg-transparent border-b border-transparent'
      )}
    >
      <div className="mx-auto max-w-[1360px] h-[72px] px-5 sm:px-8 grid grid-cols-[auto_1fr_auto] items-center gap-6">
        <Link to="/" aria-label="Germin home" className="justify-self-start">
          <Logo />
        </Link>

        <nav aria-label="Primary" className="hidden xl:flex items-center justify-center">
          {LINKS.map((l, i) => {
            const active = l.to === '/' ? pathname === '/' : pathname.startsWith(l.to);
            return (
              <React.Fragment key={l.label}>
                {i > 0 && <span aria-hidden className="h-3 w-px bg-[#171717]/15" />}
                <Link
                  to={l.to}
                  className={cn(
                    'group relative px-4 xl:px-5 py-2 text-[14px] font-medium tracking-[0.01em] whitespace-nowrap transition-colors',
                    active ? 'text-[#171717]' : 'text-[#171717]/65 hover:text-[#171717]'
                  )}
                >
                  {l.label}
                  <span
                    aria-hidden
                    className={cn(
                      'absolute left-4 right-4 xl:left-5 xl:right-5 -bottom-0.5 h-px origin-left bg-[#C9A332] transition-transform duration-300',
                      active ? 'scale-x-100' : 'scale-x-0 group-hover:scale-x-100'
                    )}
                  />
                </Link>
              </React.Fragment>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 justify-self-end">
          <Link
            to="/login"
            className="hidden sm:inline-flex h-10 px-4 items-center whitespace-nowrap text-[14px] font-medium text-[#171717]/70 hover:text-[#171717] transition-colors"
          >
            Sign in
          </Link>
          <Link
            to="/book-a-demo"
            className="group hidden sm:inline-flex whitespace-nowrap h-11 pl-5 pr-4 items-center gap-2 rounded-full bg-[#171717] text-[#FFFFFF] text-[14px] font-semibold font-display ring-1 ring-[#171717] hover:ring-[#C9A332] transition-all"
          >
            Book a demo
            <ArrowRight className="w-4 h-4 text-[#C9A332] transition-transform group-hover:translate-x-0.5" />
          </Link>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="xl:hidden p-2 -mr-2 text-[#171717]"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
          >
            {open ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="xl:hidden border-t border-[#171717]/10 bg-[#FFFFFF]">
          <div className="px-5 py-3 max-h-[calc(100svh-72px)] overflow-y-auto">
            {LINKS.map((l) => (
              <Link
                key={l.label}
                to={l.to}
                onClick={() => setOpen(false)}
                className="block py-3.5 text-[17px] font-semibold text-[#171717] border-b border-[#171717]/10"
              >
                {l.label}
              </Link>
            ))}
            <Link to="/login" onClick={() => setOpen(false)} className="block py-3.5 text-[17px] font-semibold text-[#171717]">
              Sign in
            </Link>
            <Link
              to="/book-a-demo"
              onClick={() => setOpen(false)}
              className="mt-2 mb-3 flex h-12 items-center justify-center gap-2 rounded-full bg-[#171717] text-[#FFFFFF] font-semibold font-display"
            >
              Book a demo
              <ArrowRight className="w-4 h-4 text-[#C9A332]" />
            </Link>
          </div>
        </div>
      )}
    </header>
  );
};
