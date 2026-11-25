import React from 'react';
import { Link } from 'react-router-dom';
import { DocsLayout, DocHeader, DocSection } from '@/components/layout/DocsLayout';
import { CodeBlock } from '@/components/ui/CodeBlock';

export const DocsTroubleshootingPage: React.FC = () => {
  return (
    <DocsLayout
      activeHref="/docs/troubleshooting"
      toc={[
        { id: 'diagnostics', title: 'Download a job log' },
        { id: 'rate-limiting', title: 'Zoho rate limits' },
        { id: 'contact-support', title: 'Getting help' },
      ]}
      lastUpdated="Draft, review before publishing"
      prevPage={{ title: 'Connections: Zoho, Tally, MCA', href: '/docs/integrations' }}
      nextPage={{ title: 'Common problems', href: '/guides/troubleshooting' }}
    >
      <DocHeader
        eyebrow="Help"
        title="Error codes and logs"
        description="How to get the log for a job, what the common messages mean, and what to send us when you need help."
      />

      <DocSection id="diagnostics" title="Download a job log">
        <p>
          Open the job and choose <strong>Job details → Export audit log</strong>. You get a time-stamped record of
          each step. A short sample:
        </p>
        <CodeBlock
          fileName="job_log_sample.log"
          language="text"
          code={`[2024-11-17 12:45:01 UTC] INFO  [Ingest]    Reading XML export (12.4 MB)
[2024-11-17 12:45:03 UTC] INFO  [Parser]    1,482 ledgers, 648 contacts found
[2024-11-17 12:45:05 UTC] WARN  [Validator] Party 'XYZ Traders' has no GSTIN, marked as unregistered
[2024-11-17 12:45:08 UTC] INFO  [Compare]   Debit total: 148290412.50 | Credit total: 148290412.50
[2024-11-17 12:45:08 UTC] INFO  [Compare]   Debits equal credits. Opening adjustment: 0.00`}
        />
      </DocSection>

      <DocSection id="rate-limiting" title="Zoho rate limits">
        <p>
          If Zoho Books replies with <code>429 Too Many Requests</code>, the job waits and tries again with growing
          gaps (1 second, 2 seconds, 4 seconds and so on). It continues from where it stopped.
        </p>
      </DocSection>

      <DocSection id="contact-support" title="Getting help">
        <p>
          If a job keeps failing, contact us through the{' '}
          <Link to="/support" className="font-semibold text-mustard-700 hover:text-ink-950">
            support page
          </Link>{' '}
          and include the job ID and the exported log.
        </p>
      </DocSection>
    </DocsLayout>
  );
};
