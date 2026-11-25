import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Map } from 'lucide-react';
import { PageIntro, Container } from '@/components/product/ProductBlocks';
import { Reveal } from '@/components/motion/Motion';

const GROUPS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: 'Solutions',
    links: [
      { label: 'All solutions', href: '/products' },
      { label: 'Tally to Zoho migration', href: '/products/tally-to-zoho' },
      { label: 'Office management', href: '/products/office-management' },
      { label: 'Incorporation and ROC', href: '/products/incorporation-roc' },
      { label: 'Financial statement preparation', href: '/products/financial-statements' },
      { label: 'Custom automation', href: '/products/custom-automation' },
      { label: 'MCA form automation', href: '/products/mca-automation' },
      { label: 'Financial data migration', href: '/products/financial-data-migration' },
      { label: 'Roadmap', href: '/products/future-products' },
    ],
  },
  {
    title: 'Who it’s for',
    links: [
      { label: 'Startups', href: '/for/startups' },
      { label: 'CA and CS firms', href: '/for/consultants' },
    ],
  },
  {
    title: 'Company database',
    links: [
      { label: 'Search companies', href: '/companies' },
      { label: 'Dashboard', href: '/companies/dashboard' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { label: 'Resources home', href: '/resources' },
      { label: 'Tools library', href: '/resources/tools' },
      { label: 'User guides', href: '/guides' },
      { label: 'Documentation', href: '/docs' },
      { label: 'Blog', href: '/blog' },
      { label: 'FAQ', href: '/faq' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About', href: '/about' },
      { label: 'Careers', href: '/careers' },
      { label: 'Security', href: '/security' },
      { label: 'Support', href: '/support' },
      { label: 'Contact', href: '/contact' },
      { label: 'Book a demo', href: '/book-a-demo' },
    ],
  },
  {
    title: 'Account',
    links: [
      { label: 'Log in', href: '/login' },
      { label: 'Sign up', href: '/signup' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Privacy policy', href: '/privacy-policy' },
      { label: 'Terms and conditions', href: '/terms-and-conditions' },
      { label: 'Cookie policy', href: '/cookie-policy' },
    ],
  },
];

export const SitemapPage: React.FC = () => {
  useEffect(() => {
    document.title = 'Sitemap · Germin8';
  }, []);

  return (
    <div className="bg-white">
      <PageIntro
        eyebrow="Sitemap"
        eyebrowIcon={Map}
        title="Every page,"
        accent="in one place"
        description="Find any page on the site, grouped by what it is for."
      />

      <Container className="pb-24">
        <div className="columns-1 sm:columns-2 lg:columns-3 gap-5">
          {GROUPS.map((g, i) => (
            <Reveal key={g.title} delay={(i % 3) * 0.05} className="mb-5 break-inside-avoid">
              <section className="rounded-2xl bg-white ring-1 ring-ink-200 p-6">
                <h2 className="text-lg font-bold font-display text-ink-950">{g.title}</h2>
                <ul className="mt-4 -mx-2">
                  {g.links.map((l) => (
                    <li key={l.href}>
                      <Link
                        to={l.href}
                        className="group flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-[15px] text-ink-700 hover:bg-ink-50 hover:text-ink-950"
                      >
                        <span>{l.label}</span>
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="hidden sm:inline truncate font-mono text-[12px] text-ink-400">{l.href}</span>
                          <ArrowRight
                            className="w-4 h-4 shrink-0 text-ink-300 transition-all group-hover:text-mustard-700 group-hover:translate-x-0.5"
                            aria-hidden
                          />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            </Reveal>
          ))}
        </div>
      </Container>
    </div>
  );
};
