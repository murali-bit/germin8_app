import { BlogPost } from '@/types';

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: 'tally-to-zoho-books-complete-migration-guide',
    title: 'Moving from Tally to Zoho Books: accounts, GST and opening balances',
    summary:
      'How Tally groups, GST ledgers, HSN/SAC codes and opening balances map to Zoho Books, and the order to import them in so the opening balance adjustment stays at nil.',
    category: 'Data Migration',
    readTime: '9 min read',
    publishedDate: '12 November 2024',
    author: {
      name: 'Germin8 team',
      role: 'Product',
    },
    keyTakeaways: [
      'Tally groups have to be mapped to Zoho Books account types, and party ledgers to customers and vendors.',
      'Import the chart of accounts before contacts, because contacts need their receivable and payable accounts to exist.',
      'Check that debits equal credits on the cut-off date before importing, so nothing lands in Opening Balance Adjustments.',
      'A party that is both a customer and a vendor needs care so its GSTIN is kept on both records.',
    ],
    content: [
      'Many Indian businesses and CA firms have kept their books in Tally.ERP 9 or TallyPrime for years. Teams move to Zoho Books for cloud access, bank feeds and working from more than one location. The move itself is where most of the pain is.',
      'Exporting from Tally and importing into Zoho Books by hand often leaves a trial balance that does not match, parties without the right GST treatment, and a balance sitting in the opening balance adjustment account. Germin8 replaces the spreadsheet lookups with a fixed set of steps: read the export, map it, check it, then import it.',
      'The structural gap: in Tally, the chart of accounts is a tree of groups under the predefined primary groups, and you can nest your own groups under them. Zoho Books has fixed account types (asset, liability, equity, income, expense), and Sundry Debtors and Sundry Creditors must become customer and vendor records rather than plain ledgers.',
      'The import order that works: 1. chart of accounts, 2. items with HSN/SAC codes and units, 3. customers and vendors with valid GSTINs and place of supply, 4. bank and cash accounts, 5. opening trial balance as of the cut-off date, 6. unpaid invoices and bills.',
    ],
  },
  {
    slug: 'mca-v3-annual-filing-aoc4-mgt7-automation-playbook',
    title: 'Preparing AOC-4, ADT-1 and MGT-7 on the MCA V3 portal',
    summary:
      'Where the time goes in annual ROC filings on the MCA V3 portal, and how reading figures from the audited statements cuts down on retyping and typing errors.',
    category: 'MCA Compliance',
    readTime: '8 min read',
    publishedDate: '4 November 2024',
    author: {
      name: 'Germin8 team',
      role: 'Product',
    },
    keyTakeaways: [
      'Due dates run from the AGM: ADT-1 within 15 days, AOC-4 within 30 days and MGT-7 within 60 days.',
      'Late filing attracts an additional fee for each day of delay, so catching errors early matters.',
      'Looking up the company by CIN first shows inactive DINs and overdue director KYC before you start.',
      'The CA or CS still reviews every figure and signs with their DSC. Software prepares, people approve.',
    ],
    content: [
      'The MCA V3 portal moved annual filings to web forms that check data as you go. For professionals it also brought session timeouts, strict field rules and a lot of retyping: audited statements have to be entered line by line.',
      'What is at stake: Section 137 of the Companies Act, 2013 requires AOC-4 to be filed within 30 days of the AGM. Late filing attracts an additional fee for each day of delay, which adds up quickly for a firm handling many companies.',
      'How Germin8 helps: you upload the audited balance sheet, profit and loss and notes as a PDF. The figures are read and matched to the Schedule III heads the form expects. Company details such as CIN, authorised capital and director DINs are looked up first, so problems show up before you open the portal.',
      'Where the line is: Germin8 prepares the data and fills the form fields. The CA or CS reviews the data, signs with their DSC and submits the form. Acceptance is decided by the Registrar.',
    ],
  },
  {
    slug: 'data-reconciliation-strategies-for-ca-firms',
    title: 'Checking a migration: comparing trial balances across two systems',
    summary:
      'How to compare the Tally and Zoho Books trial balances ledger by ledger, and the usual causes of small differences.',
    category: 'Accounting Tech',
    readTime: '6 min read',
    publishedDate: '28 October 2024',
    author: {
      name: 'Germin8 team',
      role: 'Product',
    },
    keyTakeaways: [
      'Compare debits and credits ledger by ledger between the Tally export and the Zoho Books trial balance.',
      'Rounding differences and exchange rate differences are the usual small mismatches. Find them before sign-off.',
      'Keep the comparison report as evidence for your auditors.',
    ],
    content: [
      'The test of a migration is not how fast it ran but whether the numbers match. When books move from Tally to Zoho Books, the opening trial balance should match to the paisa. One misplaced ledger or rounding difference will show up again in GST returns and at year end.',
      'Germin8 compares every ledger balance across assets, liabilities, equity, income and expenses in both systems, and lists any difference before the books are handed back.',
    ],
  },
  {
    slug: 'demystifying-gst-mapping-tally-to-zoho-books',
    title: 'GST mapping from Tally to Zoho Books: CGST, SGST, IGST and RCM',
    summary:
      'How separate GST ledgers in Tally (CGST 9%, SGST 9%, IGST 18%, RCM) become tax rates and tax groups in Zoho Books.',
    category: 'Data Migration',
    readTime: '7 min read',
    publishedDate: '15 October 2024',
    author: {
      name: 'Germin8 team',
      role: 'Product',
    },
    keyTakeaways: [
      'Separate Tally tax ledgers are combined into Zoho Books tax rates and tax groups.',
      'Place of supply and state codes come from the GSTIN, so they need to be right in the party master.',
      'Reverse charge (RCM) entries need their own mapping so input credit is tracked correctly.',
    ],
    content: [
      'In Tally, accountants often create a separate ledger for every tax: "Input CGST @ 9%", "Output SGST @ 9%", "IGST on capital goods" and so on. In Zoho Books, tax is applied to each line item as a tax rate, chosen from the place of supply.',
      'Germin8 maps these ledgers to Zoho Books tax rates and groups, so your GSTR-1, GSTR-3B and annual return figures carry on from where Tally left off.',
    ],
  },
];
