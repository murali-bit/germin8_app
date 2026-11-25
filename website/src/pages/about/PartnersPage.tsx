import React from 'react';
import { Handshake, CheckCircle2, ArrowRight, Shield, Layers, Users } from 'lucide-react';
import { PageHero } from '@/components/ui/PageHero';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export const PartnersPage: React.FC = () => {
  return (
    <div>
      <PageHero
        badge="Ecosystem Alliances"
        breadcrumbs={[{ label: 'About Us', href: '/about' }, { label: 'Partners' }]}
        title="Technology and Business Partnerships"
        description="Collaborating with software platforms, Chartered Accountant associations, and enterprise consulting firms to build an integrated automation ecosystem."
        actions={
          <Button variant="primary" size="lg" href="/contact" icon={ArrowRight}>
            Apply for Partnership
          </Button>
        }
      />

      <section className="py-20 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
          {/* Note on Verified Partnerships */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs text-text-secondary leading-relaxed">
            <strong>Partnership Transparency Note:</strong> In compliance with prompt guidelines,
            verified institutional partner badges will be displayed upon public release of our joint
            technology integration agreements. Below are the core partner tiers currently open for
            application.
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <Card variant="default" className="p-6 space-y-4">
              <div className="w-10 h-10 rounded-lg bg-blue-light text-blue-primary flex items-center justify-center">
                <Users className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy">
                CA Firm Practice Alliances
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                For Chartered Accountancy practices and corporate secretarial firms looking to bundle
                Germin8 automated migration and MCA filing capabilities for their client portfolio.
              </p>
              <ul className="space-y-1.5 text-xs text-slate-600 pt-2 border-t border-slate-100">
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-primary" /> Multi-entity license discounts
                </li>
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-primary" /> Dedicated migration engineering support
                </li>
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-primary" /> Co-branded client audit reports
                </li>
              </ul>
            </Card>

            <Card variant="default" className="p-6 space-y-4">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center">
                <Layers className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy">
                ERP & Software Vendors
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                For cloud accounting vendors and ERP solution providers seeking hardened, certified
                onboarding migration pipelines from legacy desktop software like Tally.
              </p>
              <ul className="space-y-1.5 text-xs text-slate-600 pt-2 border-t border-slate-100">
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Direct API webhook pipelines
                </li>
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Verified trial balance verification
                </li>
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Accelerated customer activation
                </li>
              </ul>
            </Card>

            <Card variant="default" className="p-6 space-y-4">
              <div className="w-10 h-10 rounded-lg bg-purple-50 text-purple-700 flex items-center justify-center">
                <Shield className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy">
                System Integrators & Consultants
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                For management consultancies, digital transformation advisors, and enterprise IT
                resellers deploying cloud ERP transformations across mid-market Indian enterprises.
              </p>
              <ul className="space-y-1.5 text-xs text-slate-600 pt-2 border-t border-slate-100">
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-purple-600" /> Tiered revenue share
                </li>
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-purple-600" /> Technical training and certification
                </li>
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-purple-600" /> Joint enterprise RFP support
                </li>
              </ul>
            </Card>
          </div>
        </div>
      </section>

      <section className="py-20 bg-site-bg text-center">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
          <h3 className="text-2xl sm:text-3xl font-bold font-display text-navy">
            Explore Partnership Opportunities
          </h3>
          <p className="text-xs sm:text-sm text-text-secondary max-w-xl mx-auto leading-relaxed">
            Reach out to our strategic alliances team to discuss ecosystem integration or practice partnership.
          </p>
          <Button variant="primary" size="lg" href="/contact" icon={ArrowRight}>
            Connect with Partner Directorate
          </Button>
        </div>
      </section>
    </div>
  );
};
