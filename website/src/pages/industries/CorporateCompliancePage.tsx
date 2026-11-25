import React from 'react';
import { Shield, CheckCircle2, ArrowRight, ShieldCheck, Clock, FileCheck } from 'lucide-react';
import { PageHero } from '@/components/ui/PageHero';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export const CorporateCompliancePage: React.FC = () => {
  return (
    <div>
      <PageHero
        badge="Corporate Secretarial"
        breadcrumbs={[{ label: 'Industries', href: '/industries' }, { label: 'Corporate Compliance' }]}
        title="Automation for Corporate Secretarial & Compliance Teams"
        description="Shield your corporate entities from statutory MCA late penalties. Automate annual filings (AOC-4, ADT-1, MGT-7) with pre-submission validation engines."
        actions={
          <Button variant="primary" size="lg" href="/book-a-demo" icon={ArrowRight}>
            Request Compliance Demo
          </Button>
        }
      />

      <section className="py-20 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader
            eyebrow="Zero Penalty Protocol"
            title="Eliminate Seasonal Filing Friction and Late Fees"
            description="Designed for in-house company secretaries and compliance practices managing dozens of corporate subsidiaries."
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <Card variant="default" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-blue-light text-blue-primary flex items-center justify-center mb-4">
                <Clock className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                Beat the Statutory 30-Day Window
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                Ensure all subsidiaries file Form AOC-4 comfortably within 30 days of the AGM,
                completely avoiding the uncapped ₹100 per day statutory late fees.
              </p>
            </Card>

            <Card variant="default" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center mb-4">
                <FileCheck className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                Automated Schedule III Mapping
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                Parse audited PDF balance sheets and profit & loss statements directly into the MCA V3
                data schema without manual typing errors.
              </p>
            </Card>

            <Card variant="default" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-purple-50 text-purple-700 flex items-center justify-center mb-4">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                Pre-Scrutiny Validation Gate
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                Validates active DIN status and DIR-3 KYC compliance prior to portal injection,
                preventing sudden session rejections on the MCA portal.
              </p>
            </Card>
          </div>
        </div>
      </section>

      <section className="py-20 bg-site-bg text-center">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
          <h3 className="text-2xl sm:text-3xl font-bold font-display text-navy">
            Prepare for Upcoming MCA Annual Filings
          </h3>
          <p className="text-xs sm:text-sm text-text-secondary max-w-xl mx-auto leading-relaxed">
            See how corporate secretarial teams accelerate filing cycles by 72% using Germin8.
          </p>
          <Button variant="primary" size="lg" href="/book-a-demo" icon={ArrowRight}>
            Schedule Compliance Walkthrough
          </Button>
        </div>
      </section>
    </div>
  );
};
