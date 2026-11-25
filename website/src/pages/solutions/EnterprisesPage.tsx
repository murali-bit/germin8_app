import React from 'react';
import { Building2, CheckCircle2, ArrowRight, Shield, Server, Lock, Layers } from 'lucide-react';
import { PageHero } from '@/components/ui/PageHero';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export const EnterprisesPage: React.FC = () => {
  return (
    <div>
      <PageHero
        badge="Enterprise Architecture"
        breadcrumbs={[{ label: 'Solutions', href: '/solutions' }, { label: 'Enterprises' }]}
        title="Germin8 for Large Enterprises & Conglomerates"
        description="High-volume financial data migration, multi-entity corporate compliance, and audited automation pipelines designed for complex corporate governance standards."
        actions={
          <Button variant="primary" size="lg" href="/book-a-demo" icon={ArrowRight}>
            Request Enterprise Architecture Review
          </Button>
        }
      />

      <section className="py-20 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader
            eyebrow="Enterprise Grade"
            title="Meeting the Demands of Corporate Governance"
            description="Large organizations cannot afford data leaks, undocumented balance adjustments, or missed statutory deadlines."
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <Card variant="default" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-blue-light text-blue-primary flex items-center justify-center mb-4">
                <Layers className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                Multi-Entity Batch Migration
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                Migrate corporate groups with dozens of subsidiary entities. Standardize charts of
                accounts into consolidated parent group structures while isolating distinct tax books.
              </p>
            </Card>

            <Card variant="default" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center mb-4">
                <Lock className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                SOC-2 & Ephemeral Security
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                TLS 1.3 encryption in transit, AES-256 at rest, memory-isolated job execution, and
                automatic zeroization of client financial records following certification sign-off.
              </p>
            </Card>

            <Card variant="default" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-purple-50 text-purple-700 flex items-center justify-center mb-4">
                <Server className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                Dedicated Technical Lead
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                Enterprise contracts include a dedicated solutions architect, custom transformation
                rules, priority queue processing, and SLA-backed turnaround commitments.
              </p>
            </Card>
          </div>
        </div>
      </section>

      <section className="py-20 bg-site-bg text-center">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
          <h3 className="text-2xl sm:text-3xl font-bold font-display text-navy">
            Discuss Enterprise Scale Engagements
          </h3>
          <p className="text-xs sm:text-sm text-text-secondary max-w-xl mx-auto leading-relaxed">
            Connect with our VP of Engineering to review data privacy compliance, custom data
            connectors, and multi-entity migration scheduling.
          </p>
          <Button variant="primary" size="lg" href="/book-a-demo" icon={ArrowRight}>
            Schedule Enterprise Briefing
          </Button>
        </div>
      </section>
    </div>
  );
};
