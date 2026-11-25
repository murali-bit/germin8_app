import React from 'react';
import { BarChart2, CheckCircle2, ArrowRight, ShieldCheck, Database, RefreshCw } from 'lucide-react';
import { PageHero } from '@/components/ui/PageHero';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export const FinancialAutomationPage: React.FC = () => {
  return (
    <div>
      <PageHero
        badge="Enterprise Finance"
        breadcrumbs={[{ label: 'Automation', href: '/automation' }, { label: 'Financial Workflows' }]}
        title="Financial Workflow & Ledger Automation"
        description="End-to-end automation of financial schedules, multi-entity opening balance consolidation, and trial balance verification for high-growth enterprises."
        actions={
          <Button variant="primary" size="lg" href="/book-a-demo" icon={ArrowRight}>
            Request Financial Workflow Demo
          </Button>
        }
      />

      <section className="py-20 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader
            eyebrow="Core Workflows"
            title="Accelerating the Financial Close Cycle"
            description="Replace fragmented Excel workbooks with verified data pipelines that enforce audit integrity."
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <Card variant="default" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-blue-light text-blue-primary flex items-center justify-center mb-4">
                <Database className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                Multi-Branch Consolidation
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                Aggregates trial balances across regional branches, standardizes inter-branch accounts,
                and eliminates contra entries without manual spreadsheet consolidation.
              </p>
            </Card>

            <Card variant="default" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center mb-4">
                <RefreshCw className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                Sub-Ledger Tie-Outs
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                Verifies that individual customer and vendor subsidiary ledgers tie out precisely to the
                General Ledger control accounts, flagging unallocated balances.
              </p>
            </Card>

            <Card variant="default" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-purple-50 text-purple-700 flex items-center justify-center mb-4">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                Audit Trail Reconstruction
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                Maintains a tamper-evident event log for every ledger reclassification and balance
                transfer, satisfying statutory auditor scrutiny under Companies Act CARO requirements.
              </p>
            </Card>
          </div>
        </div>
      </section>

      <section className="py-20 bg-site-bg text-center">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
          <h3 className="text-2xl sm:text-3xl font-bold font-display text-navy">
            Streamline Your Month-End Close
          </h3>
          <p className="text-xs sm:text-sm text-text-secondary max-w-xl mx-auto leading-relaxed">
            See how finance controllers reduce close cycles from 12 days to under 48 hours using
            Germin8 financial workflow automation.
          </p>
          <Button variant="primary" size="lg" href="/book-a-demo" icon={ArrowRight}>
            Schedule Practice Walkthrough
          </Button>
        </div>
      </section>
    </div>
  );
};
