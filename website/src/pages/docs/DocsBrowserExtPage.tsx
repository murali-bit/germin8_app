import React from 'react';
import { Link } from 'react-router-dom';
import { DocsLayout, DocHeader, DocSection, DocList } from '@/components/layout/DocsLayout';
import { CodeBlock } from '@/components/ui/CodeBlock';

export const DocsBrowserExtPage: React.FC = () => {
  return (
    <DocsLayout
      activeHref="/docs/browser-extension"
      toc={[
        { id: 'security-model', title: 'What it can and cannot do' },
        { id: 'dom-injection', title: 'How fields are filled' },
        { id: 'supported-portals', title: 'Supported portals' },
      ]}
      lastUpdated="Draft, review before publishing"
      prevPage={{ title: 'Before you install', href: '/docs/installation' }}
      nextPage={{ title: 'Tally to Zoho field mapping', href: '/docs/tally-migration' }}
    >
      <DocHeader
        eyebrow="Start here"
        title="Browser extension"
        description="How the Germin8 extension fills MCA forms from data your professional has already approved, and the limits it works within."
      />

      <DocSection id="security-model" title="What it can and cannot do">
        <p>The extension is a bridge between your approved job and the form open in your browser.</p>
        <DocList
          items={[
            'It runs only when you click it.',
            'It works only on the MCA website.',
            'It does not read your keystrokes or store your portal password.',
            'It fills fields. You check the form, sign it and submit it yourself.',
          ]}
        />
      </DocSection>

      <DocSection id="dom-injection" title="How fields are filled">
        <p>
          The MCA V3 forms are built as web components that track their own state. The extension sets each value and
          then fires the same change events a person typing would, so the portal&rsquo;s own validation sees the
          values.
        </p>
        <p>The permissions it asks for are limited to the active tab and the MCA domain:</p>
        <CodeBlock
          fileName="manifest.json (excerpt)"
          language="json"
          code={`{
  "manifest_version": 3,
  "permissions": ["activeTab", "storage"],
  "host_permissions": ["https://www.mca.gov.in/*"],
  "action": {
    "default_popup": "popup.html"
  }
}`}
        />
      </DocSection>

      <DocSection id="supported-portals" title="Supported portals">
        <p>
          Today the extension works with MCA V3 forms AOC-4, ADT-1 and MGT-7. Other portals may follow; see the{' '}
          <Link to="/products/future-products" className="font-semibold text-mustard-700 hover:text-ink-950">
            roadmap
          </Link>{' '}
          for what we are working on.
        </p>
      </DocSection>
    </DocsLayout>
  );
};
