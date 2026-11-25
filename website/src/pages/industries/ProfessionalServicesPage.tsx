import React from 'react';
import { Briefcase, CheckCircle2, ArrowRight, ShieldCheck, Clock, FileText } from 'lucide-react';
import { PageHero } from '@/components/ui/PageHero';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export const ProfessionalServicesPage: React.FC = () => {
  return (
    <div>
      <PageHero
        badge="Professional Services"
        breadcrumbs={[{ label: 'Industries', href: '/industries' }, { label: 'Professional Services' }]}
        title="Automation for Consultancies, Legal & Advisory Practices"
        description="Simplify complex project-based accounting, unbilled disbursement tracking, RCM tax workflows, and multi-state GST compliance for professional services firms."
        actions={
          <Button variant="primary" size="lg" href="/book-a-demo" icon={ArrowRight}>
            Request Services Practice Demo
          </Button>
        }
      />

      <section className="py-20 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader
            eyebrow="Sector Challenges"
            title="Tailored for Project & Retainer-Based Billing"
            description="Professional services operations encounter unique billing, advance tax, and reverse charge mechanisms under Indian tax laws."
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <Card variant="default" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-blue-light text-blue-primary flex items-center justify-center mb-4">
                <FileText className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                Unbilled Disbursements Tracking
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                Seamlessly migrate open client disbursements, retainer advances, and expense recovery
                ledgers into Zoho Books without loss of project tags.
              </p>
            </Card>

            <Card variant="default" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center mb-4">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                Legal & RCM Tax Alignment
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                Accurately configures Reverse Charge Mechanism (RCM) voucher rules for legal and
                advocate billings, ensuring compliance with Section 9(3) of the CGST Act.
              </p>
            </Card>

            <Card variant="default" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-purple-50 text-purple-700 flex items-center justify-center mb-4">
                <Clock className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                Multi-State GST Compliance
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                Manages cross-state client invoicing, place-of-supply determination, and input tax
                credit segregation across pan-India office branches.
              </p>
            </Card>
          </div>
        </div>
      </section>

      <section className="py-20 bg-site-bg text-center">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
          <h3 className="text-2xl sm:text-3xl font-bold font-display text-navy">
            Modernize Your Professional Practice
          </h3>
          <p className="text-xs sm:text-sm text-text-secondary max-w-xl mx-auto leading-relaxed">
            Discover how consulting partnerships transition to modern cloud bookkeeping with Germin8 automation.
          </p>
          <Button variant="primary" size="lg" href="/book-a-demo" icon={ArrowRight}>
            Schedule Practice Walkthrough
          </Button>
        </div>
      </section>
    </div>
  );
};
