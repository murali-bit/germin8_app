import { CaseStudy } from '@/types';

export const CASE_STUDIES: CaseStudy[] = [
  {
    slug: 'multi-entity-ca-practice-tally-to-zoho-migration',
    title: 'Mid-Sized CA Practice Migrates 42 Client Entities to Zoho Books with Zero Balance Discrepancy',
    clientType: 'Chartered Accountancy Practice (4 Partners, 35 Staff)',
    industry: 'Accounting & Auditing Services',
    challenge:
      'The firm was managing 42 SME client accounts on desktop Tally installations. Preparing quarterly GST returns and managing client reconciliations required manual data transfers, physical backups, and endless Excel cleaning. Manual migration was estimated at 3 weeks per entity.',
    solution:
      'The firm adopted Germin8 Tally to Zoho Books migration engine. With standardized Chart of Accounts mapping and automated trial balance reconciliation, entities were migrated in automated batch runs, complete with 3 years of opening figures, contact GSTINs, and item catalogs.',
    metrics: [
      {
        label: 'Migration Turnaround',
        value: '4 Hours',
        description: 'Average time per client entity down from 3 weeks of manual data entry',
      },
      {
        label: 'Trial Balance Parity',
        value: '100.00%',
        description: 'Zero balance discrepancy across ₹148 Crore in cumulative debits and credits',
      },
      {
        label: 'Opening Balance Adj.',
        value: '₹0.00',
        description: 'Perfect zero balance in Zoho Books adjustment suspense accounts',
      },
      {
        label: 'Staff Hours Saved',
        value: '1,200+ Hrs',
        description: 'Billable time redirected from copy-pasting to advisory and statutory tax planning',
      },
    ],
    summary:
      'Automating ledger extraction and GST tax mapping allowed this 4-partner CA firm to modernize its entire client portfolio without hiring temporary data entry clerks.',
    content: [
      'Managing client accounting across fragmented desktop Tally installations created operational bottlenecks during quarterly tax audits. Backup files were frequently misplaced, ledger heads had been customized inconsistently over a decade, and reconciliations were conducted entirely on Excel spreadsheets.',
      'By deploying the Germin8 migration automation pipeline, the firm standardized account mappings across all 42 client entities. The engine flagged 84 invalid GSTINs and 12 misclassified opening balances before import into Zoho Books, enabling a clean audit transition.',
    ],
  },
  {
    slug: 'corporate-compliance-mca-v3-aoc4-automation',
    title: 'Corporate Secretarial Team Accelerates 65 Annual AOC-4 and MGT-7 Filings by 72%',
    clientType: 'Corporate Secretarial Advisory Firm',
    industry: 'Corporate Legal & Statutory Compliance',
    challenge:
      'Managing annual filings across 65 corporate subsidiaries during peak MCA season created extreme deadline stress. Manual re-typing of Schedule III balance sheets into the MCA V3 web portal led to validation errors and portal session timeouts, risking ₹100/day per-form statutory late fees.',
    solution:
      'The team implemented Germin8 MCA Automation Suite with Browser Extension integration. Financial statement PDFs were automatically parsed into Schedule III schemas, CIN data was pre-populated, and forms were verified against MCA validation criteria prior to portal entry.',
    metrics: [
      {
        label: 'Filing Prep Time',
        value: '-72%',
        description: 'Preparation time reduced from 5.5 hours to 1.5 hours per entity',
      },
      {
        label: 'Portal Rejections',
        value: '0',
        description: 'Zero validation errors or SRN aborts on the MCA V3 portal',
      },
      {
        label: 'Penalty Exposure Avoided',
        value: '₹0',
        description: 'Every corporate subsidiary filed comfortably ahead of the statutory 30-day AGM window',
      },
      {
        label: 'Filing Accuracy',
        value: '100%',
        description: 'All figures verified line-by-line with human review checkpoint before DSC signing',
      },
    ],
    summary:
      'By replacing manual form data re-entry with intelligent document processing and pre-submission validation, the compliance team eliminated seasonal overtime and avoided statutory late fees.',
    content: [
      'The annual compliance window between September and November is notoriously stressful for Indian compliance departments. Re-typing audited financial statements into MCA V3 web forms is error-prone, and a single mismatched figure causes the government validation engine to reject the submission.',
      'Germin8 intelligent document parser extracted balance sheet line items directly from signed auditor PDFs, structured them into the MCA V3 JSON payload, and populated the browser portal seamlessly while leaving final DSC authorization in the hands of the certified professional.',
    ],
  },
];
