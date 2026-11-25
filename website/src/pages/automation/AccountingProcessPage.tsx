import React from 'react';
import { BookOpen, CheckCircle2, ArrowRight, RefreshCw, Layers, Calculator } from 'lucide-react';
import { PageHero } from '@/components/ui/PageHero';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export const AccountingProcessPage: React.FC = () => {
  return (
    <div>
      <PageHero
        badge="Process Optimization"
        breadcrumbs={[{ label: 'Automation', href: '/automation' }, { label: 'Accounting Automation' }]}
        title="Accounting Process & Operational Automation"
        description="Replace repetitive data entry with automated voucher ingestion, intelligent chart of accounts mapping, and automated vendor bill reconciliation."
        actions={
          <Button variant="primary" size="lg" href="/book-a-demo" icon={ArrowRight}>
            Explore Accounting Process Demo
          </Button>
        }
      />

      <section className="py-20 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader
            eyebrow="Routine Operations"
            title="Eliminate High-Volume Manual Bookkeeping Tasks"
            description="Designed to enhance accounting accuracy while maintaining strict segregation of duties."
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <Card variant="default" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-blue-light text-blue-primary flex items-center justify-center mb-4">
                <Calculator className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                Automated Journal Classification
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                Rules-based engines analyze description strings and counterparty entities to assign
                appropriate debit/credit ledger heads according to your defined accounting policies.
              </p>
            </Card>

            <Card variant="default" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center mb-4">
                <RefreshCw className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                GST Rate Slabs Validation
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                Validates applied GST rates against HSN/SAC master dictionaries, catching misapplied
                18% vs 12% rates before vouchers are posted to the general ledger.
              </p>
            </Card>

            <Card variant="default" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-purple-50 text-purple-700 flex items-center justify-center mb-4">
                <Layers className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                Voucher Sequential Renumbering
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                Maintains clean, chronological, and non-repeating voucher sequences compliant with
                Indian e-Way Bill and e-Invoicing statutory audit requirements.
              </p>
            </Card>
          </div>
        </div>
      </section>

      <section className="py-20 bg-site-bg text-center">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
          <h3 className="text-2xl sm:text-3xl font-bold font-display text-navy">
            Modernize Your Practice Workflow
          </h3>
          <p className="text-xs sm:text-sm text-text-secondary max-w-xl mx-auto leading-relaxed">
            Discover how Germin8 saves CA practices hundreds of hours during routine monthly closures.
          </p>
          <Button variant="primary" size="lg" href="/book-a-demo" icon={ArrowRight}>
            Schedule Practice Walkthrough
          </Button>
        </div>
      </section>
    </div>
  );
};
