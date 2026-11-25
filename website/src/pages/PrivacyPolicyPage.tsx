import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, AlertTriangle } from 'lucide-react';
import { PageIntro, Container } from '@/components/product/ProductBlocks';

export const PrivacyPolicyPage: React.FC = () => {
  useEffect(() => {
    document.title = 'Privacy policy · Germin8';
  }, []);

  return (
    <div className="bg-white">
      <PageIntro
        eyebrow="Legal"
        eyebrowIcon={ShieldCheck}
        title="Privacy policy"
        description="How Germin8 collects, uses and protects the information you and your clients share with us."
        align="left"
      />

      <Container className="pb-24">
        <article className="max-w-3xl">
          <div className="flex items-start gap-3 rounded-2xl bg-ink-50 ring-1 ring-ink-300 p-4 text-[15px] text-ink-950">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-mustard-700" aria-hidden />
            <p className="font-semibold">Draft text. Have this reviewed before publishing.</p>
          </div>
          <p className="mt-6 text-[14px] text-ink-500">Last updated: draft, not yet in effect</p>

          <div className="mt-8 space-y-5 text-[16.5px] leading-[1.75] text-ink-700 [&_h2]:pt-6 [&_h2]:text-[22px] [&_h2]:font-bold [&_h2]:font-display [&_h2]:tracking-[-0.01em] [&_h2]:text-ink-950 [&_strong]:text-ink-950">
            <h2>1. What we collect</h2>
            <p>
              Germin8 (&ldquo;Germin8&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) builds software for accounting data
              migration and compliance preparation. We collect only what we need to provide it. When you use our
              services, we process:
            </p>
            <ul className="list-disc pl-6 space-y-2 marker:text-mustard-600">
              <li>
                <strong>Account details:</strong> name, work email, phone number, firm name and billing details.
              </li>
              <li>
                <strong>Migration data:</strong> ledgers, contact lists, GSTINs and vouchers you upload for a migration
                job.
              </li>
              <li>
                <strong>Compliance form data:</strong> CINs, director DINs and financial figures read from documents you
                upload for MCA forms.
              </li>
            </ul>

            <h2>2. How long we keep files</h2>
            <p>
              Files you upload, such as Tally exports and audited financial statements, are used only for the job you
              run. They are deleted once you have the result.
            </p>

            <h2>3. We do not sell your data</h2>
            <p>
              We do not sell, rent or license your clients&rsquo; financial figures or returns, and we do not use them
              for marketing or analytics by third parties. We treat them as confidential.
            </p>

            <h2>4. Security</h2>
            <p>Data is encrypted in transit and at rest. Each client sits in its own workspace, and you decide who in your team can see it.</p>

            <h2>5. Contact</h2>
            <p>
              For questions about privacy, or to ask us to delete your account, write to us through the{' '}
              <Link to="/contact" className="font-semibold text-mustard-700 hover:text-ink-950">
                contact page
              </Link>
              .
            </p>
          </div>
        </article>
      </Container>
    </div>
  );
};
