import React from 'react';
import { DocsLayout, DocHeader, DocSection, DocItems, DocSteps, DocNote } from '@/components/layout/DocsLayout';

export const DocsInstallPage: React.FC = () => {
  return (
    <DocsLayout
      activeHref="/docs/installation"
      toc={[
        { id: 'system-requirements', title: 'System requirements' },
        { id: 'browser-extension', title: 'Install the browser extension' },
        { id: 'verify-install', title: 'Check it is working' },
      ]}
      lastUpdated="Draft, review before publishing"
      prevPage={{ title: 'Documentation home', href: '/docs' }}
      nextPage={{ title: 'Browser extension', href: '/docs/browser-extension' }}
    >
      <DocHeader
        eyebrow="Start here"
        title="Before you install"
        description="What you need on your computer to run Germin8, and how to set up the browser extension used for MCA forms."
      />

      <DocSection id="system-requirements" title="System requirements">
        <DocItems
          items={[
            { label: 'Operating system', body: 'Windows 10 or 11, macOS 12 or later, or a current Linux distribution.' },
            { label: 'Browser', body: 'Google Chrome or Microsoft Edge (version 110 or later), Brave, or another Chromium-based browser.' },
            {
              label: 'Accounting software',
              body: 'TallyPrime or Tally.ERP 9 (Release 5.0 or later) on Windows, to create the export file.',
            },
          ]}
        />
      </DocSection>

      <DocSection id="browser-extension" title="Install the browser extension">
        <p>
          The extension fills reviewed figures into MCA V3 forms in your own browser. It never sees your MCA portal
          password.
        </p>
        <DocSteps
          steps={[
            <>
              Open Chrome and go to <code>chrome://extensions</code>.
            </>,
            <>
              Turn on <strong>Developer mode</strong> in the top right corner.
            </>,
            <>
              Click <strong>Load unpacked</strong> and choose the extension folder from the package we send you.
            </>,
            <>Pin the Germin8 icon to your browser toolbar.</>,
          ]}
        />
      </DocSection>

      <DocSection id="verify-install" title="Check it is working">
        <p>
          Click the extension icon in your toolbar. It should show <strong>Connected</strong> and the name of your
          organisation.
        </p>
        <DocNote title="Not connected?">
          Sign in to your Germin8 account in the same browser, then open the extension again.
        </DocNote>
      </DocSection>
    </DocsLayout>
  );
};
