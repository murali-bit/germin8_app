import React from 'react';
import { Users, Shield, ArrowRight, Code2, Cpu, Calculator } from 'lucide-react';
import { PageHero } from '@/components/ui/PageHero';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export const OurTeamPage: React.FC = () => {
  return (
    <div>
      <PageHero
        badge="Engineering Leadership"
        breadcrumbs={[{ label: 'About Us', href: '/about' }, { label: 'Our Team' }]}
        title="The People Building Germin8"
        description="A specialized cross-functional team combining software architects, accounting domain specialists, and corporate compliance engineers."
      />

      <section className="py-20 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
          {/* Transparent Placeholder Notice as per prompt instructions */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs text-text-secondary leading-relaxed">
            <strong>Editorial Transparency Note:</strong> In accordance with Germin8 corporate
            governance guidelines, executive biographies and verified public credentials will be
            published upon completion of our institutional verification rounds. Below are the core
            departmental leadership structures steering our development.
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <Card variant="default" className="p-6 text-center space-y-4">
              <div className="w-20 h-20 rounded-full bg-blue-light text-blue-primary flex items-center justify-center mx-auto text-2xl font-bold font-display">
                ENG
              </div>
              <div>
                <h4 className="text-lg font-bold font-display text-navy">
                  Systems & Architecture Lead
                </h4>
                <span className="text-xs font-semibold text-blue-primary">
                  Engineering Directorate
                </span>
              </div>
              <p className="text-xs text-text-secondary leading-relaxed">
                Oversees our core data transformation pipelines, memory-isolated sandboxing,
                deterministic balance verification algorithms, and browser extension security.
              </p>
            </Card>

            <Card variant="default" className="p-6 text-center space-y-4">
              <div className="w-20 h-20 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center mx-auto text-2xl font-bold font-display">
                TAX
              </div>
              <div>
                <h4 className="text-lg font-bold font-display text-navy">
                  Accounting Domain & Audit Lead
                </h4>
                <span className="text-xs font-semibold text-emerald-700">
                  Accounting Practice Specialist
                </span>
              </div>
              <p className="text-xs text-text-secondary leading-relaxed">
                Directs Chart of Accounts normalization, Indian GST tax mapping schemas, opening
                balance parity logic, and trial balance reconciliation specifications.
              </p>
            </Card>

            <Card variant="default" className="p-6 text-center space-y-4">
              <div className="w-20 h-20 rounded-full bg-purple-50 text-purple-700 flex items-center justify-center mx-auto text-2xl font-bold font-display">
                REG
              </div>
              <div>
                <h4 className="text-lg font-bold font-display text-navy">
                  Regulatory Compliance & MCA Lead
                </h4>
                <span className="text-xs font-semibold text-purple-700">
                  Corporate Governance Practice
                </span>
              </div>
              <p className="text-xs text-text-secondary leading-relaxed">
                Manages MCA V3 portal schema tracking, Form AOC-4 Schedule III financial parsing,
                director DIR-3 KYC verification workflows, and statutory timeline compliance.
              </p>
            </Card>
          </div>
        </div>
      </section>

      <section className="py-20 bg-site-bg text-center">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
          <h3 className="text-2xl sm:text-3xl font-bold font-display text-navy">
            Want to Build the Future of Business Automation?
          </h3>
          <p className="text-xs sm:text-sm text-text-secondary max-w-xl mx-auto leading-relaxed">
            We are actively expanding our software engineering, machine learning, and accounting
            product design teams in India.
          </p>
          <Button variant="primary" size="lg" href="/careers" icon={ArrowRight}>
            Explore Open Career Positions
          </Button>
        </div>
      </section>
    </div>
  );
};
