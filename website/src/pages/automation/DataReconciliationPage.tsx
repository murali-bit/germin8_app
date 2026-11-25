import React from 'react';
import { GitMerge, CheckCircle2, ArrowRight, ShieldCheck, Database, RefreshCw } from 'lucide-react';
import { PageHero } from '@/components/ui/PageHero';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export const DataReconciliationPage: React.FC = () => {
  return (
    <div>
      <PageHero
        badge="Zero-Discrepancy"
        breadcrumbs={[{ label: 'Automation', href: '/automation' }, { label: 'Data Reconciliation' }]}
        title="Automated Financial Data Reconciliation"
        description="Deterministic comparison engines that cross-verify balances between legacy source ledgers and modern cloud accounting systems down to the exact paisa."
        actions={
          <Button variant="primary" size="lg" href="/book-a-demo" icon={ArrowRight}>
            Request Reconciliation Walkthrough
          </Button>
        }
      />

      <section className="py-20 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader
            eyebrow="Mathematical Rigor"
            title="The Three Pillars of Automated Reconciliation"
            description="How Germin8 guarantees mathematical fidelity before and after data migration."
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <Card variant="default" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-blue-light text-blue-primary flex items-center justify-center mb-4">
                <Database className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                Line-by-Line Debit & Credit Audit
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                Matches every ledger head between the Tally trial balance and Zoho Books generated
                trial balance, highlighting any variance exceeding ₹0.00.
              </p>
            </Card>

            <Card variant="default" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center mb-4">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                Zero Opening Suspense Guarantee
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                Eliminates the dangerous Opening Balance Adjustments suspense account by mathematically
                equating debits and credits prior to committing the migration.
              </p>
            </Card>

            <Card variant="default" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-purple-50 text-purple-700 flex items-center justify-center mb-4">
                <RefreshCw className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                Signed Reconciliation Certificate
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                Generates a timestamped, cryptographically hashed reconciliation report that serves as
                irrefutable proof of data integrity for statutory tax auditors.
              </p>
            </Card>
          </div>
        </div>
      </section>

      <section className="py-20 bg-site-bg text-center">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
          <h3 className="text-2xl sm:text-3xl font-bold font-display text-navy">
            Verify Your Trial Balance with Germin8
          </h3>
          <p className="text-xs sm:text-sm text-text-secondary max-w-xl mx-auto leading-relaxed">
            See how our reconciliation engine catches subtle ledger misclassifications before they
            cascade into tax return errors.
          </p>
          <Button variant="primary" size="lg" href="/book-a-demo" icon={ArrowRight}>
            Schedule Reconciliation Demo
          </Button>
        </div>
      </section>
    </div>
  );
};
