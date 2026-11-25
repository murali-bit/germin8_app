import React from 'react';
import { Calculator, CheckCircle2, ArrowRight, Zap, RefreshCw, BarChart2, Shield } from 'lucide-react';
import { PageHero } from '@/components/ui/PageHero';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export const AccountingAutomationPage: React.FC = () => {
  return (
    <div>
      <PageHero
        badge="Workflow Automation"
        breadcrumbs={[{ label: 'Products', href: '/products' }, { label: 'Accounting Automation' }]}
        title="Accounting Process & Workflow Automation"
        description="Eliminate hours of manual data entry, sub-ledger reconciliation, and recurring voucher adjustments. Free your qualified accounting professionals for strategic business advisory."
        actions={
          <Button variant="primary" size="lg" href="/book-a-demo" icon={ArrowRight}>
            Request Accounting Automation Demo
          </Button>
        }
      />

      <section className="py-20 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader
            eyebrow="Routine Operations Eliminated"
            title="Automate Repetitive Day-to-Day Accounting Tasks"
            description="Designed for accounting departments and CA practices managing high transaction volumes."
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <Card variant="default" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-blue-light text-blue-primary flex items-center justify-center mb-4">
                <RefreshCw className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                Sub-Ledger & Bank Reconciliation
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                Automatically matches bank feed line items against open accounts receivable and
                payable ledgers using probabilistic reference matching, flagging exceptions for human review.
              </p>
            </Card>

            <Card variant="default" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center mb-4">
                <BarChart2 className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                GST ITC 2B vs Purchase Register
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                Cross-references purchase vouchers in your books with GSTR-2B government returns,
                identifying missing vendor invoices, tax amount mismatches, and ineligible input tax credits.
              </p>
            </Card>

            <Card variant="default" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-purple-50 text-purple-700 flex items-center justify-center mb-4">
                <Zap className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                Recurring Period-End Accruals
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                Automate monthly amortization schedules, depreciation entries under Schedule II of
                the Companies Act, and prepaid expense adjustments without manual journal prep.
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
            See how CA practices and corporate finance departments save over 35 hours per month per
            senior accountant with Germin8 accounting automation.
          </p>
          <Button variant="primary" size="lg" href="/book-a-demo" icon={ArrowRight}>
            Schedule Practice Walkthrough
          </Button>
        </div>
      </section>
    </div>
  );
};
