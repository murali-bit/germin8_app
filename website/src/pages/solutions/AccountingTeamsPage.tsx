import React from 'react';
import { Calculator, CheckCircle2, ArrowRight, ShieldCheck, Database, Zap } from 'lucide-react';
import { PageHero } from '@/components/ui/PageHero';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export const AccountingTeamsPage: React.FC = () => {
  return (
    <div>
      <PageHero
        badge="In-House Finance"
        breadcrumbs={[{ label: 'Solutions', href: '/solutions' }, { label: 'Accounting Teams' }]}
        title="Germin8 for Corporate Accounting Teams"
        description="Transition off desktop accounting software with zero disruption to active billing, inventory tracking, or monthly GST returns. Built for finance controllers and senior accountants."
        actions={
          <Button variant="primary" size="lg" href="/book-a-demo" icon={ArrowRight}>
            Request In-House Finance Walkthrough
          </Button>
        }
      />

      <section className="py-20 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader
            eyebrow="Business Continuity"
            title="Migration Without Operational Downtime"
            description="Your billing clerks cannot stop dispatching invoices for weeks while developers test data imports. Germin8 guarantees weekend cut-off execution."
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <Card variant="default" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-blue-light text-blue-primary flex items-center justify-center mb-4">
                <Database className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                Preserve Customer Histories
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                Maintain unpaid bills, open advances, and customer credit terms without losing the
                connection between payments and original sales invoices.
              </p>
            </Card>

            <Card variant="default" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center mb-4">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                Uninterrupted GST Returns
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                Our engine ensures that historical tax rates, state codes, and HSN summaries align
                seamlessly, allowing continuous GSTR-1 and GSTR-3B filings without revision headaches.
              </p>
            </Card>

            <Card variant="default" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-purple-50 text-purple-700 flex items-center justify-center mb-4">
                <Zap className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                No Developer Coding Required
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                Operate through a simple web dashboard. No need to write Python scripts, configure
                ODBC drivers, or hire expensive external software consultants.
              </p>
            </Card>
          </div>
        </div>
      </section>

      <section className="py-20 bg-site-bg text-center">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
          <h3 className="text-2xl sm:text-3xl font-bold font-display text-navy">
            Evaluate Your Accounting Migration
          </h3>
          <p className="text-xs sm:text-sm text-text-secondary max-w-xl mx-auto leading-relaxed">
            Our finance automation specialists can review your current Tally chart of accounts and
            demonstrate a live dry-run conversion.
          </p>
          <Button variant="primary" size="lg" href="/book-a-demo" icon={ArrowRight}>
            Schedule Corporate Demo
          </Button>
        </div>
      </section>
    </div>
  );
};
