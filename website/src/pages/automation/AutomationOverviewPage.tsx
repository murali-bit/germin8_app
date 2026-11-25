import React from 'react';
import { Link } from 'react-router-dom';
import {
  Zap,
  Cpu,
  BarChart2,
  BookOpen,
  ScanLine,
  GitMerge,
  Globe,
  ArrowRight,
  Shield,
  Layers,
  CheckCircle2,
} from 'lucide-react';
import { PageHero } from '@/components/ui/PageHero';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

export const AutomationOverviewPage: React.FC = () => {
  return (
    <div>
      <PageHero
        badge="Technology Architecture"
        breadcrumbs={[{ label: 'Automation' }]}
        title="Intelligent Automation for Complex Business Workflows"
        description="Discover the core automation pillars, algorithmic principles, and architectural systems that power Germin8’s specialized financial and compliance engines."
        actions={
          <Button variant="primary" size="lg" href="/book-a-demo" icon={ArrowRight}>
            Explore Automation Demo
          </Button>
        }
      />

      <section className="py-20 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader
            eyebrow="Architectural Scope"
            title="Six Specialized Automation Disciplines"
            description="Explore how Germin8 applies specialized automation across data extraction, mathematical reconciliation, and regulatory preparation."
          />

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            <Card variant="interactive" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-blue-light text-blue-primary flex items-center justify-center mb-4">
                <Cpu className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-bold font-display text-navy mb-2">AI Agents</h3>
              <p className="text-xs text-text-secondary leading-relaxed mb-4">
                Constrained, deterministic models that extract financial metrics, resolve ambiguous
                ledger labels, and detect formatting anomalies with 100% human review control.
              </p>
              <Link
                to="/automation/ai-agents"
                className="text-xs font-semibold text-blue-primary hover:underline inline-flex items-center gap-1"
              >
                Explore AI Agents <ArrowRight className="w-3 h-3" />
              </Link>
            </Card>

            <Card variant="interactive" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center mb-4">
                <BarChart2 className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-bold font-display text-navy mb-2">
                Financial Automation
              </h3>
              <p className="text-xs text-text-secondary leading-relaxed mb-4">
                Automated trial balance parity checks, sub-ledger schedule generation, and
                debit/credit validation across multi-entity corporate structures.
              </p>
              <Link
                to="/automation/financial-automation"
                className="text-xs font-semibold text-blue-primary hover:underline inline-flex items-center gap-1"
              >
                View Financial Workflows <ArrowRight className="w-3 h-3" />
              </Link>
            </Card>

            <Card variant="interactive" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-purple-50 text-purple-700 flex items-center justify-center mb-4">
                <BookOpen className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-bold font-display text-navy mb-2">
                Accounting Process Automation
              </h3>
              <p className="text-xs text-text-secondary leading-relaxed mb-4">
                Eliminate repetitive journal creation, voucher classification, and GST tax ledger
                mapping between legacy desktop software and cloud ERPs.
              </p>
              <Link
                to="/automation/accounting-automation"
                className="text-xs font-semibold text-blue-primary hover:underline inline-flex items-center gap-1"
              >
                View Accounting Automation <ArrowRight className="w-3 h-3" />
              </Link>
            </Card>

            <Card variant="interactive" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center mb-4">
                <ScanLine className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-bold font-display text-navy mb-2">
                Document Processing
              </h3>
              <p className="text-xs text-text-secondary leading-relaxed mb-4">
                Optical and layout-aware parsing of audited balance sheet PDFs, extracting Schedule
                III financial lines directly into structured JSON schemas.
              </p>
              <Link
                to="/automation/document-processing"
                className="text-xs font-semibold text-blue-primary hover:underline inline-flex items-center gap-1"
              >
                View Document Processing <ArrowRight className="w-3 h-3" />
              </Link>
            </Card>

            <Card variant="interactive" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-navy/10 text-navy flex items-center justify-center mb-4">
                <GitMerge className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-bold font-display text-navy mb-2">
                Data Reconciliation
              </h3>
              <p className="text-xs text-text-secondary leading-relaxed mb-4">
                Algorithmic comparison matrices that detect differences between source and target
                ledgers, ensuring opening adjustment suspense accounts remain at zero.
              </p>
              <Link
                to="/automation/data-reconciliation"
                className="text-xs font-semibold text-blue-primary hover:underline inline-flex items-center gap-1"
              >
                View Data Reconciliation <ArrowRight className="w-3 h-3" />
              </Link>
            </Card>

            <Card variant="interactive" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-blue-light text-blue-primary flex items-center justify-center mb-4">
                <Globe className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-bold font-display text-navy mb-2">
                Browser Automation
              </h3>
              <p className="text-xs text-text-secondary leading-relaxed mb-4">
                Secure browser helper extension that populates complex web forms on the MCA V3
                portal directly from pre-validated JSON files, preventing session timeouts.
              </p>
              <Link
                to="/automation/browser-automation"
                className="text-xs font-semibold text-blue-primary hover:underline inline-flex items-center gap-1"
              >
                View Browser Extension <ArrowRight className="w-3 h-3" />
              </Link>
            </Card>
          </div>
        </div>
      </section>

      {/* Realistic Scope Disclaimer */}
      <section className="py-12 bg-slate-50 border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 text-center text-xs text-text-secondary leading-relaxed">
          <p>
            <strong>Note on Technical Availability:</strong> Germin8 is transparent regarding active
            products versus broader architectural capabilities. Tally to Zoho Books Migration and
            MCA Form Automation (AOC-4, ADT-1, MGT-7) are currently shipping in production. Other
            capabilities represent our proprietary engine components and roadmap developments.
          </p>
        </div>
      </section>
    </div>
  );
};
