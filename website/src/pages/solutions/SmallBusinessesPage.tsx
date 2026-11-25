import React from 'react';
import { Store, CheckCircle2, ArrowRight, Clock, ShieldCheck, HeartHandshake } from 'lucide-react';
import { PageHero } from '@/components/ui/PageHero';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export const SmallBusinessesPage: React.FC = () => {
  return (
    <div>
      <PageHero
        badge="SME Growth"
        breadcrumbs={[{ label: 'Solutions', href: '/solutions' }, { label: 'Small Businesses' }]}
        title="Germin8 for Growing Small & Mid-Sized Businesses"
        description="Upgrade your business to modern cloud accounting without the risk of lost ledgers or budget-breaking consulting fees. Simple, guided, and accurate."
        actions={
          <Button variant="primary" size="lg" href="/book-a-demo" icon={ArrowRight}>
            Request SMB Migration Demo
          </Button>
        }
      />

      <section className="py-20 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader
            eyebrow="Simplified Cloud Transition"
            title="Why Small Businesses Trust Germin8"
            description="Moving off desktop software should not require months of consulting retainers. We make data migration accessible and foolproof."
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <Card variant="default" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-blue-light text-blue-primary flex items-center justify-center mb-4">
                <Clock className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                Rapid Weekend Cut-Off
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                Export your Tally data on Friday evening. Our engine processes and validates records
                over the weekend, allowing your staff to start issuing Zoho Books invoices on Monday morning.
              </p>
            </Card>

            <Card variant="default" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center mb-4">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                100% Data Accuracy Guarantee
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                We verify that every rupee in customer receivables and vendor payables matches your
                certified opening balance down to zero paisa difference.
              </p>
            </Card>

            <Card variant="default" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-purple-50 text-purple-700 flex items-center justify-center mb-4">
                <HeartHandshake className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                Guided Migration Support
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                You are never left alone with error codes. Our migration engineers verify your trial
                balance with your accountant before final cut-over sign-off.
              </p>
            </Card>
          </div>
        </div>
      </section>

      <section className="py-20 bg-site-bg text-center">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
          <h3 className="text-2xl sm:text-3xl font-bold font-display text-navy">
            Make the Switch to Cloud Accounting
          </h3>
          <p className="text-xs sm:text-sm text-text-secondary max-w-xl mx-auto leading-relaxed">
            Eliminate server maintenance and desktop hardware crashes. Upgrade to Zoho Books with
            complete confidence.
          </p>
          <Button variant="primary" size="lg" href="/book-a-demo" icon={ArrowRight}>
            Schedule SMB Migration Demo
          </Button>
        </div>
      </section>
    </div>
  );
};
