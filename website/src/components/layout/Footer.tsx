import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Mail } from 'lucide-react';
import { Germin8Logo } from '@/components/ui/Germin8Logo';

const YEAR = new Date().getFullYear();

const COLUMNS = [
  {
    title: 'Solutions',
    links: [
      { label: 'Tally to Zoho migration', href: '/products/tally-to-zoho' },
      { label: 'Office management', href: '/products/office-management' },
      { label: 'Incorporation and ROC', href: '/products/incorporation-roc' },
      { label: 'Financial statements', href: '/products/financial-statements' },
      { label: 'Custom automation', href: '/products/custom-automation' },
      { label: 'Company database', href: '/companies' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { label: 'Tools library', href: '/resources/tools' },
      { label: 'User guides', href: '/guides' },
      { label: 'Documentation', href: '/docs' },
      { label: 'Blog', href: '/blog' },
      { label: 'FAQ', href: '/faq' },
      { label: 'Support', href: '/support' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About', href: '/about' },
      { label: 'Careers', href: '/careers' },
      { label: 'For startups', href: '/for/startups' },
      { label: 'For consultants', href: '/for/consultants' },
      { label: 'Security', href: '/security' },
      { label: 'Contact', href: '/contact' },
    ],
  },
];

export const Footer: React.FC = () => {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);

  return (
    <footer className="bg-charcoal text-ink-300">
      <div className="max-w-7xl mx-auto px-5 sm:px-6 lg:px-8 pt-16 pb-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          <div className="lg:col-span-4">
            <Germin8Logo size="md" variant="light" />
            <p className="mt-5 max-w-xs text-[15px] leading-relaxed text-ink-400">
              A technology company working in finance. We automate the finance function, piece by piece.
            </p>
            <form
              className="mt-8 max-w-sm"
              onSubmit={(e) => {
                e.preventDefault();
                if (email.trim()) {
                  setDone(true);
                  setEmail('');
                }
              }}
            >
              <label htmlFor="footer-email" className="text-sm font-semibold text-white font-display">
                Product updates
              </label>
              {done ? (
                <p className="mt-3 text-[15px] text-mustard-400">Thanks. We'll email you when something ships.</p>
              ) : (
                <div className="mt-3 flex gap-2">
                  <input
                    id="footer-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="flex-1 min-w-0 h-11 rounded-xl bg-white/5 px-3.5 text-[15px] text-white placeholder:text-ink-500 ring-1 ring-white/10 focus:outline-none focus:ring-mustard-500"
                  />
                  <button
                    type="submit"
                    aria-label="Subscribe"
                    className="h-11 w-11 rounded-xl bg-mustard-500 text-ink-950 flex items-center justify-center hover:bg-mustard-400"
                  >
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </form>
          </div>

          <div className="lg:col-span-7 lg:col-start-6 grid grid-cols-2 sm:grid-cols-3 gap-10">
            {COLUMNS.map((c) => (
              <div key={c.title}>
                <p className="text-sm font-semibold text-white font-display">{c.title}</p>
                <ul className="mt-4 space-y-3">
                  {c.links.map((l) => (
                    <li key={l.href}>
                      <Link to={l.href} className="text-[15px] text-ink-400 hover:text-white transition-colors">
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-14 pt-8 border-t border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-sm text-ink-500">
          <span>© {YEAR} Germin8</span>
          <div className="flex flex-wrap items-center gap-6">
            <Link to="/privacy-policy" className="hover:text-white">Privacy</Link>
            <Link to="/terms-and-conditions" className="hover:text-white">Terms</Link>
            <Link to="/cookie-policy" className="hover:text-white">Cookies</Link>
            <Link to="/sitemap" className="hover:text-white">Sitemap</Link>
            <Link to="/contact" className="inline-flex items-center gap-1.5 hover:text-white">
              <Mail className="w-4 h-4" />
              Contact
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
};
