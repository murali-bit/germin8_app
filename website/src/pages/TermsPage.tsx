import React, { useEffect } from 'react';
import { FileText, AlertTriangle } from 'lucide-react';
import { PageIntro, Container } from '@/components/product/ProductBlocks';

export const TermsPage: React.FC = () => {
  useEffect(() => {
    document.title = 'Terms and conditions · Germin8';
  }, []);

  return (
    <div className="bg-white">
      <PageIntro
        eyebrow="Legal"
        eyebrowIcon={FileText}
        title="Terms and conditions"
        description="The terms for using Germin8 software, its connections to other services and the browser extension."
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
            <h2>1. Accepting these terms</h2>
            <p>
              By using software provided by Germin8 (&ldquo;Germin8&rdquo;), you agree to these terms. If you accept
              them on behalf of a CA practice or a company, you confirm that you have the authority to bind it.
            </p>

            <h2>2. What Germin8 is, and what it is not</h2>
            <p>
              Germin8 is software that helps with reading data, mapping fields, comparing balances and filling forms.
              Germin8 is not an audit firm, a law practice or a chartered accountancy firm, and does not give legal, tax
              or audit opinions.
            </p>
            <p>
              <strong>Professional review is required.</strong> The chartered accountant (CA) or company secretary (CS)
              remains responsible for checking all financial data, signing with their Digital Signature Certificate
              (DSC), and submitting returns to the Ministry of Corporate Affairs (MCA) or the GST Network (GSTN).
            </p>

            <h2>3. No promise of government acceptance</h2>
            <p>
              Germin8 does not promise that any form will be approved or accepted by the Registrar of Companies, the
              Ministry of Corporate Affairs or any tax authority. That decision rests with the regulator.
            </p>

            <h2>4. Licence and ownership</h2>
            <p>
              The software, its interfaces and the browser extension belong to Germin8. You receive a non-exclusive,
              non-transferable licence to use them while your subscription is active.
            </p>

            <h2>5. Governing law</h2>
            <p>
              These terms are governed by the laws of India. The courts of [city to be confirmed] have jurisdiction.
            </p>
          </div>
        </article>
      </Container>
    </div>
  );
};
