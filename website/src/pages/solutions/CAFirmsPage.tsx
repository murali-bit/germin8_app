import React from 'react';
import { Users, CheckCircle2, ArrowRight, ShieldCheck, Clock, FileSpreadsheet, Layers } from 'lucide-react';
import { PageHero } from '@/components/ui/PageHero';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export const CAFirmsPage: React.FC = () => {
  return (
    <div>
      <PageHero
        badge="Specialized for Practitioners"
        breadcrumbs={[{ label: 'Solutions', href: '/solutions' }, { label: 'CA Firms' }]}
        title="Germin8 for Chartered Accountant Firms"
        description="Scale your practice without scaling manual data entry overhead. Manage multi-client Tally to Zoho Books migrations and automate seasonal MCA filings from a unified partner dashboard."
        actions={
          <Button variant="primary" size="lg" href="/book-a-demo" icon={ArrowRight}>
            Request CA Partner Demonstration
          </Button>
        }
      />

      <section className="py-20 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader
            eyebrow="Practice Scalability"
            title="Solving the CA Firm Operational Squeeze"
            description="During peak audit and MCA filing seasons, CA firms lose thousands of billable hours to manual data re-entry. Here is how Germin8 modernizes your operations."
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <Card variant="default" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-blue-light text-blue-primary flex items-center justify-center mb-4">
                <Layers className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                Multi-Client Console
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                Assign client migration jobs to junior articles while senior partners retain review
                checkpoints. Monitor batch progress across 50+ client entities simultaneously.
              </p>
            </Card>

            <Card variant="default" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center mb-4">
                <Clock className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                72% Faster MCA Filings
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                Extract audited Schedule III financial statements from client PDFs directly into Form
                AOC-4 web payloads. Eliminate seasonal overtime between September and November.
              </p>
            </Card>

            <Card variant="default" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-purple-50 text-purple-700 flex items-center justify-center mb-4">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                Audit Trail Certification
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                Deliver cryptographically signed trial balance reconciliation reports to clients,
                proving that opening balances matched to the exact paisa without suspense adjustments.
              </p>
            </Card>
          </div>
        </div>
      </section>

      <section className="py-20 bg-site-bg text-center">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
          <h3 className="text-2xl sm:text-3xl font-bold font-display text-navy">
            Join the Germin8 CA Partner Network
          </h3>
          <p className="text-xs sm:text-sm text-text-secondary max-w-xl mx-auto leading-relaxed">
            Gain access to multi-entity migration credits, priority engineering support, and our
            browser extension suite for your practice staff.
          </p>
          <Button variant="primary" size="lg" href="/book-a-demo" icon={ArrowRight}>
            Schedule CA Practice Walkthrough
          </Button>
        </div>
      </section>
    </div>
  );
};
