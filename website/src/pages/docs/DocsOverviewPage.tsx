import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRightLeft, Landmark, Puzzle, Download, Workflow, Plug, Wrench, BookOpen, ArrowRight } from 'lucide-react';
import { DocsLayout, DocHeader, DocSection, DocCards } from '@/components/layout/DocsLayout';

const START = [
  {
    title: 'Before you install',
    body: 'What you need on your computer: operating system, browser and Tally version.',
    href: '/docs/installation',
    icon: Download,
  },
  {
    title: 'Browser extension',
    body: 'How the extension fills MCA forms, what it can access and what it cannot.',
    href: '/docs/browser-extension',
    icon: Puzzle,
  },
];

const REFERENCE = [
  {
    title: 'Tally to Zoho field mapping',
    body: 'How Tally ledgers, groups and GST ledgers turn into Zoho Books accounts and tax groups.',
    href: '/docs/tally-migration',
    icon: ArrowRightLeft,
  },
  {
    title: 'MCA form filling',
    body: 'The data behind AOC-4, ADT-1 and MGT-7, and the checks that run before a form is filled.',
    href: '/docs/mca-automation',
    icon: Landmark,
  },
  {
    title: 'How a job runs',
    body: 'Each stage a job goes through, from upload to review to import, and what happens on failure.',
    href: '/docs/workflows',
    icon: Workflow,
  },
  {
    title: 'Connections',
    body: 'How Germin8 connects to Zoho Books, reads Tally exports and works with the MCA portal.',
    href: '/docs/integrations',
    icon: Plug,
  },
];

export const DocsOverviewPage: React.FC = () => {
  return (
    <DocsLayout
      activeHref="/docs"
      toc={[
        { id: 'start', title: 'Start here' },
        { id: 'reference', title: 'Technical reference' },
        { id: 'help', title: 'When something goes wrong' },
      ]}
      lastUpdated="Draft, review before publishing"
      nextPage={{ title: 'Before you install', href: '/docs/installation' }}
    >
      <DocHeader
        eyebrow="Documentation"
        title="How Germin8 works, in detail"
        description="Reference pages for the people who set up and run Germin8: requirements, field mappings, job stages and error codes. For step-by-step walkthroughs, see the user guides."
      />

      <div className="mt-6">
        <Link
          to="/guides"
          className="group inline-flex items-center gap-2 rounded-xl bg-paper ring-1 ring-ink-200 px-4 py-2.5 text-[14px] font-semibold font-display text-ink-950 hover:ring-ink-300"
        >
          <BookOpen className="w-4 h-4 text-mustard-700" aria-hidden />
          Looking for step-by-step guides?
          <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
        </Link>
      </div>

      <DocSection id="start" title="Start here">
        <DocCards items={START} />
      </DocSection>

      <DocSection id="reference" title="Technical reference">
        <DocCards items={REFERENCE} />
      </DocSection>

      <DocSection id="help" title="When something goes wrong">
        <DocCards
          items={[
            {
              title: 'Error codes and logs',
              body: 'What each error code means and how to download the log for a job.',
              href: '/docs/troubleshooting',
              icon: Wrench,
            },
            {
              title: 'Common problems',
              body: 'Fixes for the problems people run into most: bad exports, rate limits, form not loading.',
              href: '/guides/troubleshooting',
              icon: BookOpen,
            },
          ]}
        />
      </DocSection>
    </DocsLayout>
  );
};
