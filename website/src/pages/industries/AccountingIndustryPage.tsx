import React from 'react';
import { BookOpen, CheckCircle2, ArrowRight, ShieldCheck, Users, Clock } from 'lucide-react';
import { PageHero } from '@/components/ui/PageHero';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export const AccountingIndustryPage: React.FC = () => {
  return (
    <div>
      <PageHero
        badge="Accounting Industry"
        breadcrumbs={[{ label: 'Industries', href: '/industries' }, { label: 'Accounting & Bookkeeping' }]}
        title="Automation for Accounting & Bookkeeping Practices"
        description="Help your clients migrate seamlessly from desktop Tally to modern cloud Zoho Books. Expand your firm’s advisory billings by automating routine data entry and reconciliation."
        actions={
          <Button variant="primary" size="lg" href="/book-a-demo" icon={ArrowRight}>
            Request Practice Demo
          </Button>
        }
      />

      <section className="py-20 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader
            eyebrow="Practice Impact"
            title="Accelerate Multi-Client Accounting Modernization"
            description="Built to help accounting professionals scale their firm’s operational throughput."
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <Card variant="default" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-blue-light text-blue-primary flex items-center justify-center mb-4">
                <Clock className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                4-Hour Client Migration
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                Replace 3 weeks of manual CSV formatting with an automated extraction and mapping
                pipeline that completes in hours.
              </p>
            </Card>

            <Card variant="default" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center mb-4">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                Trial Balance Parity
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                Provide client audit committees with certified balance reconciliation reports proving
                zero variance in imported debits and credits.
              </p>
            </Card>

            <Card variant="default" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-purple-50 text-purple-700 flex items-center justify-center mb-4">
                <Users className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                Higher Advisory Margins
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                Free your senior accountants from copy-pasting so they can deliver higher-margin tax
                planning and CFO advisory services.
              </p>
            </Card>
          </div>
        </div>
      </section>

      <section className="py-20 bg-site-bg text-center">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
          <h3 className="text-2xl sm:text-3xl font-bold font-display text-navy">
            Modernize Your Accounting Client Operations
          </h3>
          <p className="text-xs sm:text-sm text-text-secondary max-w-xl mx-auto leading-relaxed">
            Schedule a session to see how top accounting practices manage client migrations using
            Germin8 automation.
          </p>
          <Button variant="primary" size="lg" href="/book-a-demo" icon={ArrowRight}>
            Schedule Practice Walkthrough
          </Button>
        </div>
      </section>
    </div>
  );
};
