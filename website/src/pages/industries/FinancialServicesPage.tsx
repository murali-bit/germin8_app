import React from 'react';
import { TrendingUp, CheckCircle2, ArrowRight, ShieldCheck, Database, Lock } from 'lucide-react';
import { PageHero } from '@/components/ui/PageHero';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export const FinancialServicesPage: React.FC = () => {
  return (
    <div>
      <PageHero
        badge="FinTech & Finance"
        breadcrumbs={[{ label: 'Industries', href: '/industries' }, { label: 'Financial Services' }]}
        title="Automation for Financial Services & FinTech"
        description="High-throughput financial ledger processing, automated bank statement reconciliations, and rigorous audit trails engineered for licensed financial entities."
        actions={
          <Button variant="primary" size="lg" href="/book-a-demo" icon={ArrowRight}>
            Request Financial Services Brief
          </Button>
        }
      />

      <section className="py-20 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader
            eyebrow="Financial Rigor"
            title="Meeting Strict Regulatory Standards"
            description="Designed for NBFCs, investment advisories, and financial institutions handling high transaction volumes."
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <Card variant="default" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-blue-light text-blue-primary flex items-center justify-center mb-4">
                <Database className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                High-Volume Ingestion
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                Capable of processing tens of thousands of monthly vouchers, disbursements, and loan
                repayment entries without system throttling.
              </p>
            </Card>

            <Card variant="default" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center mb-4">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                Automated Bank Reconciliation
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                Matches MT940 / CSV bank feeds with loan management ledgers automatically, tagging
                unidentified inflows for compliance review.
              </p>
            </Card>

            <Card variant="default" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-purple-50 text-purple-700 flex items-center justify-center mb-4">
                <Lock className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                Zero Data Persistence
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                Ephemeral processing architecture guarantees that sensitive banking transactions are
                expunged immediately upon audit report generation.
              </p>
            </Card>
          </div>
        </div>
      </section>

      <section className="py-20 bg-site-bg text-center">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
          <h3 className="text-2xl sm:text-3xl font-bold font-display text-navy">
            Discuss FinTech Ledger Automation
          </h3>
          <p className="text-xs sm:text-sm text-text-secondary max-w-xl mx-auto leading-relaxed">
            Connect with our systems architects to evaluate high-volume migration pipelines and API connectors.
          </p>
          <Button variant="primary" size="lg" href="/book-a-demo" icon={ArrowRight}>
            Schedule Architecture Brief
          </Button>
        </div>
      </section>
    </div>
  );
};
