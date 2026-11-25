import { ArrowRightLeft, ListChecks, Landmark, FileSpreadsheet, Wrench, type LucideIcon } from 'lucide-react';

export type DemoKey = 'migration' | 'office' | 'roc' | 'statements';

export interface Solution {
  slug: string;
  name: string;
  /** One line for cards and menus. */
  short: string;
  /** Page headline. */
  headline: string;
  description: string;
  href: string;
  icon: LucideIcon;
  /** The problem it solves, in plain words. */
  problem: string;
  how: { title: string; body: string }[];
  automates: string[];
  /** Pieces of the finance function this covers (used on the home page map). */
  pieces: { name: string; note: string }[];
  demo?: DemoKey;
  /** How easy it is to use: shown in the tools library. */
  ease: { title: string; body: string }[];
  /** What you need before you start. */
  before: string[];
  /** Who usually uses it. */
  usedBy: string;
}

/**
 * The standard solutions. Edit the copy here and every page that lists
 * solutions (home, menu, footer, solution pages) updates with it.
 */
export const SOLUTIONS: Solution[] = [
  {
    slug: 'tally-to-zoho',
    name: 'Tally to Zoho migration',
    short: 'Move your books to Zoho Books, with balances that match.',
    headline: 'Move your books to Zoho Books without re-entering a ledger',
    description:
      'Upload a Tally export. Ledgers, parties, items and GST setup are mapped, checked and imported, then the two trial balances are compared ledger by ledger.',
    href: '/products/tally-to-zoho',
    icon: ArrowRightLeft,
    problem:
      'Moving off Tally usually means weeks of re-entry and a balance sheet that no longer ties. Most of that work is copying and checking, which software does better.',
    how: [
      { title: 'Upload', body: 'Export from TallyPrime or Tally.ERP 9 and upload the file.' },
      { title: 'Map and check', body: 'Groups, taxes and parties are mapped. Errors are listed before import.' },
      { title: 'Import and compare', body: 'Data goes into Zoho Books and the trial balances are compared.' },
    ],
    automates: ['Chart of accounts mapping', 'Customer and vendor setup', 'GST ledger conversion', 'Opening balances', 'Trial balance comparison'],
    pieces: [
      { name: 'Ledger migration', note: 'Masters and openings moved to Zoho Books' },
      { name: 'GST setup', note: 'Tally tax ledgers turned into Zoho tax groups' },
      { name: 'Balance check', note: 'Trial balance compared ledger by ledger' },
    ],
    demo: 'migration',
    usedBy: 'Startups and CA firms moving off desktop Tally',
    ease: [
      { title: 'No install', body: 'Export one file from Tally and upload it in the browser.' },
      { title: 'Plain-language errors', body: 'Each problem names the ledger or party and says how to fix it.' },
      { title: 'Nothing goes in unchecked', body: 'You see the checks and confirm before anything reaches Zoho Books.' },
    ],
    before: ['A Tally export (XML) from TallyPrime or Tally.ERP 9', 'A Zoho Books organisation with the same financial year', 'A backup of your Tally data'],
  },
  {
    slug: 'office-management',
    name: 'Office management',
    short: 'Tasks and compliance dates for a CA firm or a startup finance team.',
    headline: 'Every task and compliance date, generated and tracked for you',
    description:
      'For CA firms and startup finance teams. Recurring work is created automatically for each client or entity, assigned to the right person and tracked to completion.',
    href: '/products/office-management',
    icon: ListChecks,
    problem:
      'Compliance work is the same list every month, kept alive in spreadsheets and memory. A missed date becomes a late fee and an awkward client call.',
    how: [
      { title: 'Add clients or entities', body: 'Tell the system what each one is registered for.' },
      { title: 'Tasks appear on their own', body: 'Returns, filings and reviews are created with their due dates.' },
      { title: 'Track to done', body: 'Assign, review and close work, with a clear view of what is overdue.' },
    ],
    automates: ['Recurring task creation', 'Due date calendar', 'Assignment and review', 'Overdue alerts', 'Client-wise status'],
    pieces: [
      { name: 'Task generation', note: 'Recurring work created for each client' },
      { name: 'Compliance calendar', note: 'Every due date in one place' },
      { name: 'Team tracking', note: 'Who is doing what, and what is late' },
    ],
    demo: 'office',
    usedBy: 'CA and CS firms, and startup finance teams',
    ease: [
      { title: 'Set up once', body: 'Tell it what each client is registered for. Tasks appear from then on.' },
      { title: 'One screen for the team', body: 'Everyone sees what is due, who has it and what is late.' },
      { title: 'Works how you do', body: 'Add your own recurring tasks next to the statutory ones.' },
    ],
    before: ['A list of your clients or entities', 'Their registrations (GST, TDS, company type)', 'Who in your team handles what'],
  },
  {
    slug: 'incorporation-roc',
    name: 'Incorporation and ROC',
    short: 'Company incorporation and ROC filings, prepared with less typing.',
    headline: 'Incorporation and ROC filings without retyping the paperwork',
    description:
      'Company and director details are checked up front, figures are read from your documents, and forms are prepared for your professional to review, sign and submit.',
    href: '/products/incorporation-roc',
    icon: Landmark,
    problem:
      'ROC work is long forms, strict deadlines and details that must match exactly. Most errors are typing errors, and they are found after the form is filled.',
    how: [
      { title: 'Look up the company', body: 'Start with the CIN. Directors and their KYC status are checked first.' },
      { title: 'Review the figures', body: 'Data is read from your documents and shown next to the source.' },
      { title: 'Fill and file', body: 'Approved data is entered into the form. You sign and submit.' },
    ],
    automates: ['Company and director checks', 'Form data preparation', 'AOC-4, ADT-1 and MGT-7', 'Due date tracking', 'Filing history'],
    pieces: [
      { name: 'Incorporation', note: 'Company setup paperwork prepared' },
      { name: 'Annual ROC filings', note: 'AOC-4, ADT-1 and MGT-7' },
      { name: 'Director checks', note: 'DIN and KYC status verified early' },
    ],
    demo: 'roc',
    usedBy: 'Company secretaries, CA firms and startup founders',
    ease: [
      { title: 'Start with a CIN', body: 'Company and director details load on their own.' },
      { title: 'Side-by-side review', body: 'Every figure sits next to the page it came from.' },
      { title: 'Fills the portal for you', body: 'The browser extension types approved data into the form.' },
    ],
    before: ['The company CIN', 'Signed financial statements (for AOC-4)', 'Director and auditor details'],
  },
  {
    slug: 'financial-statements',
    name: 'Financial statement preparation',
    short: 'From trial balance to formatted financial statements.',
    headline: 'From trial balance to financial statements, without the formatting marathon',
    description:
      'Upload a trial balance. Ledgers are grouped into the right heads, and the balance sheet, profit and loss and notes are drafted for your review.',
    href: '/products/financial-statements',
    icon: FileSpreadsheet,
    problem:
      'Year-end statements are built by hand in spreadsheets: regrouping ledgers, linking notes and fixing totals that stop adding up after every change.',
    how: [
      { title: 'Upload the trial balance', body: 'From Tally, Zoho Books or a spreadsheet.' },
      { title: 'Confirm the grouping', body: 'Each ledger is placed under a statement head. You confirm the unusual ones.' },
      { title: 'Review the draft', body: 'Statements and notes are generated and stay linked to the ledgers.' },
    ],
    automates: ['Ledger grouping', 'Balance sheet and P&L drafts', 'Notes and schedules', 'Prior-year comparison', 'Totals that always tie'],
    pieces: [
      { name: 'Ledger grouping', note: 'Each ledger placed under the right head' },
      { name: 'Statements', note: 'Balance sheet and P&L drafted' },
      { name: 'Notes', note: 'Schedules linked to the ledgers' },
    ],
    demo: 'statements',
    usedBy: 'Startups preparing year-end accounts, and the firms that audit them',
    ease: [
      { title: 'Upload a trial balance', body: 'From Tally, Zoho Books or a spreadsheet.' },
      { title: 'Confirm only the odd ones', body: 'Common ledgers are grouped for you. You decide the rest.' },
      { title: 'Change once, updates everywhere', body: 'Statements and notes stay linked to the ledgers.' },
    ],
    before: ['Year-end trial balance', 'Last year’s financial statements (for comparison)', 'Any adjustments your auditor has asked for'],
  },
];

export const CUSTOM_SOLUTION = {
  slug: 'custom-automation',
  name: 'Custom automation',
  short: 'A finance task you repeat every month? We build the automation for it.',
  href: '/products/custom-automation',
  icon: Wrench,
};

export const getSolution = (slug: string) => SOLUTIONS.find((s) => s.slug === slug);
