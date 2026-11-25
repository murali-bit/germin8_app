import React from 'react';
import { DocsLayout, DocHeader, DocSection } from '@/components/layout/DocsLayout';

export const DocsIntegrationsPage: React.FC = () => {
  return (
    <DocsLayout
      activeHref="/docs/integrations"
      toc={[
        { id: 'zoho-api', title: 'Zoho Books' },
        { id: 'tally-connector', title: 'Tally' },
        { id: 'mca-integration', title: 'MCA V3 portal' },
      ]}
      lastUpdated="Draft, review before publishing"
      prevPage={{ title: 'How a job runs', href: '/docs/workflows' }}
      nextPage={{ title: 'Error codes and logs', href: '/docs/troubleshooting' }}
    >
      <DocHeader
        eyebrow="Technical reference"
        title="Connections: Zoho, Tally, MCA"
        description="How Germin8 connects to Zoho Books, reads data from Tally and works with the MCA portal."
      />

      <DocSection id="zoho-api" title="Zoho Books">
        <p>
          Germin8 uses the official Zoho Books REST API (v3). You connect your organisation by signing in to Zoho and
          approving access (OAuth 2.0). The scope requested is <code>ZohoBooks.fullaccess.all</code>.
        </p>
      </DocSection>

      <DocSection id="tally-connector" title="Tally">
        <p>
          Germin8 reads the standard XML export from Tally. You do not need to install a TDL file or any plugin inside
          Tally.
        </p>
      </DocSection>

      <DocSection id="mca-integration" title="MCA V3 portal">
        <p>
          The browser extension uses content scripts that talk to the Germin8 page through the browser&rsquo;s
          standard message passing. It fills the reviewed values into the MCA V3 form you have open. It does not log
          in for you.
        </p>
      </DocSection>
    </DocsLayout>
  );
};
