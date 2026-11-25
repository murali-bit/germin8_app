import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CheckCircle2, TrendingUp, Building2, Users } from 'lucide-react';
import { PageHero } from '@/components/ui/PageHero';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { MetricCard } from '@/components/ui/MetricCard';
import { CASE_STUDIES } from '@/data/caseStudiesData';

export const CaseStudyDetailPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const study = CASE_STUDIES.find((s) => s.slug === slug) || CASE_STUDIES[0];

  return (
    <div>
      <PageHero
        badge={study.industry}
        breadcrumbs={[
          { label: 'Resources', href: '/resources' },
          { label: 'Case Studies', href: '/case-studies' },
          { label: study.title.slice(0, 32) + '...' },
        ]}
        title={study.title}
        description={study.summary}
      />

      <section className="py-20 bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
          {/* Metrics Spotlight Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {study.metrics.map((metric, idx) => (
              <MetricCard
                key={idx}
                label={metric.label}
                value={metric.value}
                description={metric.description}
              />
            ))}
          </div>

          {/* Client & Challenge Background */}
          <div className="space-y-6">
            <h3 className="text-2xl font-bold font-display text-navy">
              Operational Context & Initial Hurdle
            </h3>
            <p className="text-sm text-text-secondary leading-relaxed">
              {study.challenge}
            </p>
          </div>

          {/* Solution & Implementation */}
          <div className="space-y-6">
            <h3 className="text-2xl font-bold font-display text-navy">
              The Germin8 Automation Solution
            </h3>
            <p className="text-sm text-text-secondary leading-relaxed">
              {study.solution}
            </p>

            <div className="space-y-4">
              {study.content.map((para, idx) => (
                <p key={idx} className="text-sm text-slate-700 leading-relaxed">
                  {para}
                </p>
              ))}
            </div>
          </div>

          {/* Footer Back Link */}
          <div className="pt-8 border-t border-slate-200 flex items-center justify-between">
            <Link
              to="/case-studies"
              className="text-xs font-semibold text-blue-primary hover:underline inline-flex items-center gap-1"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to Case Studies
            </Link>

            <Link
              to="/book-a-demo"
              className="text-xs font-semibold text-navy hover:text-blue-primary inline-flex items-center gap-1"
            >
              Request custom benchmark demo <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
};
