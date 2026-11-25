import React from 'react';
import { DocsLayout, DocHeader, DocSection, DocItems } from '@/components/layout/DocsLayout';

export const AccountSetupGuidePage: React.FC = () => {
  return (
    <DocsLayout
      activeHref="/guides/account-setup"
      toc={[
        { id: 'provisioning', title: '1. Add your organisation' },
        { id: 'role-management', title: '2. Roles and permissions' },
        { id: 'zoho-connection', title: '3. Connect Zoho Books' },
        { id: 'security-keys', title: '4. Sign-in security' },
      ]}
      lastUpdated="Draft, review before publishing"
      prevPage={{ title: 'Prepare AOC-4 and other MCA forms', href: '/guides/mca-automation' }}
      nextPage={{ title: 'First migration checklist', href: '/guides/getting-started' }}
    >
      <DocHeader
        eyebrow="User guide"
        title="Set up your account"
        description="Set up your firm or company workspace, invite your team with the right permissions and connect Zoho Books."
      />

      <DocSection id="provisioning" title="1. Add your organisation">
        <p>When you first sign in, enter your firm or company name, GSTIN and the main admin email address.</p>
      </DocSection>

      <DocSection id="role-management" title="2. Roles and permissions">
        <DocItems
          items={[
            {
              label: 'Partner or compliance head',
              body: 'Approves comparison reports and MCA data, and manages billing.',
            },
            {
              label: 'Senior accountant or CS associate',
              body: 'Maps ledgers, reviews figures read from documents and runs trial checks.',
            },
            {
              label: 'Article assistant or data operator',
              body: 'Uploads Tally exports and audited PDFs. Cannot approve or export.',
            },
          ]}
        />
      </DocSection>

      <DocSection id="zoho-connection" title="3. Connect Zoho Books">
        <p>
          Go to <strong>Integrations → Zoho Books</strong> and sign in with a Zoho Books admin account to give Germin8
          permission to import.
        </p>
      </DocSection>

      <DocSection id="security-keys" title="4. Sign-in security">
        <p>
          You can require two-factor sign-in (authenticator app) for everyone in your team, and limit access to your
          office IP addresses.
        </p>
      </DocSection>
    </DocsLayout>
  );
};
