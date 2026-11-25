import React from 'react';
import { Cpu, CheckCircle2, Shield, Eye, ArrowRight, Layers, Target, AlertCircle } from 'lucide-react';
import { PageHero } from '@/components/ui/PageHero';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export const AIAgentsPage: React.FC = () => {
  return (
    <div>
      <PageHero
        badge="Autonomous Parsing Engines"
        breadcrumbs={[{ label: 'Automation', href: '/automation' }, { label: 'AI Agents' }]}
        title="Constrained AI Agents for Financial Workflows"
        description="Deterministic, non-hallucinating agentic models designed to parse ambiguous accounting masters, map disparate ledger groups, and extract Schedule III figures with strict human verification gates."
        actions={
          <Button variant="primary" size="lg" href="/book-a-demo" icon={ArrowRight}>
            Request Agent Architecture Demo
          </Button>
        }
      />

      <section className="py-20 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader
            eyebrow="The Problem & The Solution"
            title="Why Standard LLMs Fail at Accounting"
            description="General-purpose language models hallucinate balances, invent tax accounts, and lack mathematical rigor. Germin8 AI agents operate within closed, verified accounting boundaries."
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <Card variant="default" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-blue-light text-blue-primary flex items-center justify-center mb-4">
                <Target className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                Deterministic Ledger Taxonomy
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                Our agents map ambiguous free-text Tally ledgers (e.g., "Freight Outward Misc Mumbai")
                into strict Zoho Books standard accounts with 100% adherence to Ind-AS classifications.
              </p>
            </Card>

            <Card variant="default" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center mb-4">
                <Shield className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                Zero Numerical Hallucination
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                Numerical values are never generated generatively; they are extracted via coordinate-mapped
                OCR directly from the source balance sheet and verified against debit-credit equality equations.
              </p>
            </Card>

            <Card variant="default" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-purple-50 text-purple-700 flex items-center justify-center mb-4">
                <Eye className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                Mandatory Human Sign-Off
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                Confidence scores accompany every extracted metric. Low-confidence mappings are
                quarantined for human CA/CS approval before being committed to production databases.
              </p>
            </Card>
          </div>
        </div>
      </section>

      <section className="py-20 bg-site-bg text-center">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
          <h3 className="text-2xl sm:text-3xl font-bold font-display text-navy">
            Explore Our Constrained Agent Architecture
          </h3>
          <p className="text-xs sm:text-sm text-text-secondary max-w-xl mx-auto leading-relaxed">
            See how our models handle messy real-world client ledgers and complex multi-page Schedule III PDF tables.
          </p>
          <Button variant="primary" size="lg" href="/book-a-demo" icon={ArrowRight}>
            Schedule Architecture Walkthrough
          </Button>
        </div>
      </section>
    </div>
  );
};
