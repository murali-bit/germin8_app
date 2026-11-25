import React from 'react';
import { Target, Eye, Shield, Lightbulb, Heart, ArrowRight, CheckCircle2 } from 'lucide-react';
import { PageHero } from '@/components/ui/PageHero';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export const MissionVisionPage: React.FC = () => {
  return (
    <div>
      <PageHero
        badge="Purpose & Direction"
        breadcrumbs={[{ label: 'About Us', href: '/about' }, { label: 'Mission & Vision' }]}
        title="Mission, Vision and Core Values"
        description="The driving philosophy behind every algorithmic model, transformation script, and security protocol we construct at Germin8."
      />

      <section className="py-20 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-16">
          {/* Mission & Vision Twin Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="p-8 sm:p-10 rounded-2xl bg-paper ring-1 ring-ink-200 text-ink-950 space-y-4">
              <div className="w-12 h-12 rounded-xl bg-ink-50 text-mustard-700 flex items-center justify-center border border-ink-200">
                <Target className="w-6 h-6" />
              </div>
              <span className="text-xs font-mono uppercase tracking-widest text-mustard-700">
                Our Mission Statement
              </span>
              <h3 className="text-2xl sm:text-3xl font-bold font-display text-ink-950">
                "To build intelligent technology that simplifies complicated business operations."
              </h3>
              <p className="text-xs sm:text-sm text-ink-600 leading-relaxed">
                We exist to liberate accounting and compliance professionals from manual, repetitive
                copy-pasting. We engineer deterministic software that ensures financial data transfers
                and statutory filings are accurate, fast, and mathematically verifiable.
              </p>
            </div>

            <div className="p-8 sm:p-10 rounded-2xl bg-ink-50 ring-1 ring-ink-200 text-ink-950 space-y-4">
              <div className="w-12 h-12 rounded-xl bg-white text-mustard-700 flex items-center justify-center border border-ink-200">
                <Eye className="w-6 h-6" />
              </div>
              <span className="text-xs font-mono uppercase tracking-widest text-mustard-700">
                Our Long-Term Vision
              </span>
              <h3 className="text-2xl sm:text-3xl font-bold font-display text-ink-950">
                "Intelligent Automation. Smarter Business."
              </h3>
              <p className="text-xs sm:text-sm text-ink-600 leading-relaxed">
                We envision a future where business data flows frictionlessly between legacy on-premise
                installations, modern cloud platforms, and government regulatory portals with zero data
                loss, complete auditability, and absolute peace of mind for financial leaders.
              </p>
            </div>
          </div>

          {/* 5 Core Values */}
          <div>
            <SectionHeader
              eyebrow="Ethical Foundations"
              title="Our Five Non-Negotiable Values"
              description="How our team makes design, architectural, and operational decisions every day."
            />

            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-6">
              <Card variant="default" className="p-6">
                <Target className="w-8 h-8 text-blue-primary mb-3" />
                <h4 className="text-base font-bold font-display text-navy mb-1.5">Precision</h4>
                <p className="text-xs text-text-secondary leading-relaxed">
                  Financial data demands exactness. We never approximate or sacrifice mathematical
                  balance for speed.
                </p>
              </Card>

              <Card variant="default" className="p-6">
                <Eye className="w-8 h-8 text-emerald-600 mb-3" />
                <h4 className="text-base font-bold font-display text-navy mb-1.5">Transparency</h4>
                <p className="text-xs text-text-secondary leading-relaxed">
                  No black-box algorithms. We clearly communicate system capabilities, errors, and
                  transformation rules.
                </p>
              </Card>

              <Card variant="default" className="p-6">
                <Shield className="w-8 h-8 text-purple-600 mb-3" />
                <h4 className="text-base font-bold font-display text-navy mb-1.5">Reliability</h4>
                <p className="text-xs text-text-secondary leading-relaxed">
                  Engineered to operate reliably under high seasonal load, complex tax matrices, and
                  dirty legacy datasets.
                </p>
              </Card>

              <Card variant="default" className="p-6">
                <Lightbulb className="w-8 h-8 text-amber-600 mb-3" />
                <h4 className="text-base font-bold font-display text-navy mb-1.5">Innovation</h4>
                <p className="text-xs text-text-secondary leading-relaxed">
                  Continuously modernizing our technology to lead Indian regulatory and ERP automation standards.
                </p>
              </Card>

              <Card variant="default" className="p-6">
                <Heart className="w-8 h-8 text-rose-600 mb-3" />
                <h4 className="text-base font-bold font-display text-navy mb-1.5">User Respect</h4>
                <p className="text-xs text-text-secondary leading-relaxed">
                  Automation is designed to elevate the professional, leaving human judgment in firm control.
                </p>
              </Card>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
