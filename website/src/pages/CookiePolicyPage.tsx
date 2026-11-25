import React, { useEffect } from 'react';
import { Cookie, AlertTriangle } from 'lucide-react';
import { PageIntro, Container } from '@/components/product/ProductBlocks';

export const CookiePolicyPage: React.FC = () => {
  useEffect(() => {
    document.title = 'Cookie policy · Germin8';
  }, []);

  return (
    <div className="bg-white">
      <PageIntro
        eyebrow="Legal"
        eyebrowIcon={Cookie}
        title="Cookie policy"
        description="The cookies and browser storage we use, and why."
        align="left"
      />

      <Container className="pb-24">
        <article className="max-w-3xl">
          <div className="flex items-start gap-3 rounded-2xl bg-ink-50 ring-1 ring-ink-300 p-4 text-[15px] text-ink-950">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-mustard-700" aria-hidden />
            <p className="font-semibold">Draft text. Have this reviewed before publishing.</p>
          </div>
          <p className="mt-6 text-[14px] text-ink-500">Last updated: draft, not yet in effect</p>

          <div className="mt-8 space-y-5 text-[16.5px] leading-[1.75] text-ink-700 [&_h2]:pt-6 [&_h2]:text-[22px] [&_h2]:font-bold [&_h2]:font-display [&_h2]:tracking-[-0.01em] [&_h2]:text-ink-950">
            <h2>1. Only the cookies we need</h2>
            <p>
              We do not use third-party advertising cookies. We use first-party cookies that keep you signed in,
              remember security settings and let the browser extension talk to your account.
            </p>

            <h2>2. Browser storage</h2>
            <p>
              The Germin8 browser extension uses your browser&rsquo;s local storage to hold the values it is filling
              while you review an MCA V3 form. This data is cleared when the session ends.
            </p>

            <h2>3. Turning cookies off</h2>
            <p>
              You can turn cookies off in your browser settings. If you turn off the cookies we need, you will not be
              able to sign in to your account or use the browser extension.
            </p>
          </div>
        </article>
      </Container>
    </div>
  );
};
