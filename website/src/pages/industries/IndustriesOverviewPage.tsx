import React from 'react';
import { Link } from 'react-router-dom';
import { Globe, BookOpen, TrendingUp, Briefcase, Shield, ArrowRight } from 'lucide-react';
import { PageHero } from '@/components/ui/PageHero';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export const IndustriesOverviewPage: React.FC = () => {
  return (
    <div>
      <PageHero
        badge="Industry Verticals"
        breadcrumbs={[{ label: 'Industries' }]}
        title="Specialized Automation Across Key Indian Sectors"
        description="Every industry operates under distinct statutory schedules, audit complexities, and reporting mandates. Discover how Germin8 tailors automation to your vertical."
        actions={
          <Button variant="primary" size="lg" href="/book-a-demo" icon={ArrowRight}>
            Explore Industry Walkthrough
          </Button>
        }
      />

      <section className="py-20 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader
            eyebrow="Targeted Sectors"
            title="Four Primary Industry Specializations"
            description="Deep domain architecture tailored for financial practitioners, compliance officers, and enterprise controllers."
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <Card variant="interactive" className="p-8">
              <div className="w-10 h-10 rounded-lg bg-blue-light text-blue-primary flex items-center justify-center mb-4">
                <BookOpen className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-bold font-display text-navy mb-2">
                Accounting & Bookkeeping Firms
              </h3>
              <p className="text-xs text-text-secondary leading-relaxed mb-6">
                Automate client data migration from desktop Tally to Zoho Books. Enable multi-client
                batch processing and provide clients with verifiable zero-variance reconciliation reports.
              </p>
              <Button variant="outline" size="sm" href="/industries/accounting" icon={ArrowRight}>
                View Accounting Industry Solutions
              </Button>
            </Card>

            <Card variant="interactive" className="p-8">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center mb-4">
                <TrendingUp className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-bold font-display text-navy mb-2">
                Financial Services & FinTech
              </h3>
              <p className="text-xs text-text-secondary leading-relaxed mb-6">
                High transaction throughput, automated daily bank reconciliation, multi-entity loan
                ledger migration, and rigorous audit trail generation for regulatory bodies.
              </p>
              <Button variant="outline" size="sm" href="/industries/financial-services" icon={ArrowRight}>
                View Financial Services Solutions
              </Button>
            </Card>

            <Card variant="interactive" className="p-8">
              <div className="w-10 h-10 rounded-lg bg-purple-50 text-purple-700 flex items-center justify-center mb-4">
                <Briefcase className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-bold font-display text-navy mb-2">
                Professional Services Consultancies
              </h3>
              <p className="text-xs text-text-secondary leading-relaxed mb-6">
                Service billing management, reverse-charge tax mappings, unbilled disbursements
                tracking, and multi-state GST compliance for legal and consulting practices.
              </p>
              <Button variant="outline" size="sm" href="/industries/professional-services" icon={ArrowRight}>
                View Professional Services Solutions
              </Button>
            </Card>

            <Card variant="interactive" className="p-8">
              <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center mb-4">
                <Shield className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-bold font-display text-navy mb-2">
                Corporate Compliance & Secretarial Practices
              </h3>
              <p className="text-xs text-text-secondary leading-relaxed mb-6">
                Automated preparation of annual MCA V3 returns (AOC-4, ADT-1, MGT-7). Pre-submission
                validation prevents late penalties of ₹100/day across client entities.
              </p>
              <Button variant="outline" size="sm" href="/industries/corporate-compliance" icon={ArrowRight}>
                View Corporate Compliance Solutions
              </Button>
            </Card>
          </div>
        </div>
      </section>
    </div>
  );
};
