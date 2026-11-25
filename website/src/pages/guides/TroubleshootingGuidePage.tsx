import React from 'react';
import { DocsLayout, DocHeader, DocSection, DocItems } from '@/components/layout/DocsLayout';

export const TroubleshootingGuidePage: React.FC = () => {
  return (
    <DocsLayout
      activeHref="/guides/troubleshooting"
      toc={[
        { id: 'tally-errors', title: '1. Tally export errors' },
        { id: 'zoho-api-errors', title: '2. Zoho Books rate limits' },
        { id: 'mca-session-errors', title: '3. MCA form not ready' },
      ]}
      lastUpdated="Draft, review before publishing"
      prevPage={{ title: 'Checks and mismatches', href: '/guides/data-validation' }}
      nextPage={{ title: 'Documentation home', href: '/docs' }}
    >
      <DocHeader
        eyebrow="Help"
        title="Common problems"
        description="Fixes for the problems people run into most often: bad characters in an export, Zoho rate limits, and the extension starting too early."
      />

      <DocSection id="tally-errors" title="1. Tally export errors">
        <DocItems
          items={[
            {
              label: <>Error: &ldquo;Invalid XML character entity (0x1B)&rdquo;</>,
              body: (
                <>
                  <p>
                    <strong>Cause:</strong> older Tally company files sometimes have control characters in party
                    addresses or item descriptions.
                  </p>
                  <p className="mt-2">
                    <strong>Fix:</strong> these characters are removed on upload. If the upload still fails, export
                    again with <strong>UTF-8 encoding</strong> selected in TallyPrime.
                  </p>
                </>
              ),
            },
          ]}
        />
      </DocSection>

      <DocSection id="zoho-api-errors" title="2. Zoho Books rate limits">
        <DocItems
          items={[
            {
              label: <>Error: &ldquo;Too many requests (HTTP 429)&rdquo;</>,
              body: (
                <>
                  <p>
                    <strong>Cause:</strong> Zoho Books limits how many API calls can be made per minute, depending on
                    your plan.
                  </p>
                  <p className="mt-2">
                    <strong>Fix:</strong> nothing to do. The job pauses, queues the remaining records and continues
                    from where it stopped.
                  </p>
                </>
              ),
            },
          ]}
        />
      </DocSection>

      <DocSection id="mca-session-errors" title="3. MCA form not ready">
        <DocItems
          items={[
            {
              label: <>Error: &ldquo;Target input not found in active tab&rdquo;</>,
              body: (
                <>
                  <p>
                    <strong>Cause:</strong> the extension was started before the MCA V3 form had finished loading.
                  </p>
                  <p className="mt-2">
                    <strong>Fix:</strong> wait until the form has loaded fully and the CIN details have appeared, then
                    run the extension again.
                  </p>
                </>
              ),
            },
          ]}
        />
      </DocSection>
    </DocsLayout>
  );
};
