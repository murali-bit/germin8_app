import { FAQItem } from '@/components/ui/FAQAccordion';

export const GENERAL_FAQS: FAQItem[] = [
  {
    question: 'What does Germin8 do?',
    answer:
      'Germin8 is a technology company working in finance. We break the finance function into small pieces and build software for each one: moving books from Tally to Zoho, managing tasks and compliance dates, incorporation and ROC filings, and preparing financial statements.',
  },
  {
    question: 'Is Germin8 a CA firm or a consulting firm?',
    answer:
      'No. We build software. Your own accountants, company secretaries and consultants stay in charge of the judgement and the sign-off. Our tools take over the copying, checking and form filling.',
  },
  {
    question: 'Who is it for?',
    answer:
      'Startups that want a finance function that runs without a large team, and practicing consultants such as CA and CS firms who want to serve more clients without adding staff.',
  },
  {
    question: 'What if I need something your tools do not cover?',
    answer:
      'That is what custom automation is for. Show us a task you repeat every month and we will design and build the automation around the way you already work.',
  },
  {
    question: 'Is our client data safe?',
    answer:
      'Data is encrypted in transit and at rest. Files are used only for the job you run and are deleted once you have the result. Each client sits in its own workspace, and you decide who in your team can see it.',
  },
];

export const TALLY_ZOHO_FAQS: FAQItem[] = [
  {
    question: 'Which versions of Tally do you support?',
    answer:
      'TallyPrime (all releases) and Tally.ERP 9 (Release 5.0 and later). You export a standard XML file from Tally. No TDL or plugin is needed.',
  },
  {
    question: 'What gets moved to Zoho Books?',
    answer:
      'Your chart of accounts, customers and vendors (with GSTIN, PAN and addresses), items with HSN/SAC codes, bank and cash accounts, opening balances on your cut-off date, and unpaid invoices and bills. Older transactions can be moved too if you need them.',
  },
  {
    question: 'Why do other migrations leave a balance in "Opening Balance Adjustments"?',
    answer:
      'Zoho Books puts any difference between imported debits and credits into that account. We check that your debits and credits are equal before anything is imported, so the account stays at zero.',
  },
  {
    question: 'Can you move past years of transactions?',
    answer:
      'Yes, but most firms choose a cut-off migration: masters, opening balances and open invoices as of one date (usually 1 April). It is faster and easier to audit. Full history is available when you need it.',
  },
  {
    question: 'How are GST ledgers handled?',
    answer:
      'Tally often has separate ledgers for each rate, such as Input CGST 9% and Output SGST 6%. Zoho Books uses tax rates and tax groups instead. We map your Tally ledgers to the right Zoho tax setup and use the GSTIN to set the place of supply.',
  },
];

export const MCA_FAQS: FAQItem[] = [
  {
    question: 'Which MCA forms are supported?',
    answer:
      'AOC-4 (financial statements), ADT-1 (auditor appointment) and MGT-7 / MGT-7A (annual return). More forms are on the roadmap.',
  },
  {
    question: 'Does Germin8 file the form for us?',
    answer:
      'No. Germin8 prepares the data and fills in the portal form after your professional has approved it. Your CA, CS or CMA checks the form, the directors and the professional sign with their DSCs, and you submit it yourself.',
  },
  {
    question: 'How does the browser extension work?',
    answer:
      'You log in to the MCA V3 portal as usual and open the form. In the extension you choose the approved job, and it types the reviewed figures into the form fields across every tab. It only runs when you click, only works on the MCA site, and never sees your portal password.',
  },
  {
    question: 'Can you guarantee the RoC will accept the filing?',
    answer:
      'No software can. Acceptance depends on the Registrar. What Germin8 does is catch the common reasons for rejection early, such as typing errors, totals that do not add up, inactive DINs and overdue director KYC.',
  },
  {
    question: 'What if a director’s DIN is inactive or KYC is overdue?',
    answer:
      'When you look up the company by CIN, each director’s DIN and DIR-3 KYC status is shown. Anything that needs fixing is flagged before you start preparing the form.',
  },
];
