import React from 'react';
import { Clock, CheckCircle2, ArrowRight, ShieldCheck, Target } from 'lucide-react';
import { PageHero } from '@/components/ui/PageHero';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export const OurStoryPage: React.FC = () => {
  return (
    <div>
      <PageHero
        badge="Company Journey"
        breadcrumbs={[{ label: 'About Us', href: '/about' }, { label: 'Our Story' }]}
        title="The Germin8 Journey"
        description="Built out of firsthand frustration with manual financial copy-pasting and compliance filing hurdles. How we set out to build intelligent technology for Indian businesses."
      />

      <section className="py-20 bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
          <div className="prose prose-slate max-w-none text-sm text-text-secondary leading-relaxed space-y-6">
            <h3 className="text-2xl font-bold font-display text-navy">
              The Genesis of Germin8
            </h3>
            <p>
              Across India, hundreds of thousands of Chartered Accountants, Company Secretaries, and
              corporate finance teams do essential work supporting the nation’s economic expansion.
              Yet behind closed office doors, an astonishing percentage of their working day was spent
              on an agonizingly mundane task: manually exporting ledgers from desktop software,
              cleaning messy Excel formulas, and re-typing audited financial statements line-by-line
              into government portal web forms.
            </p>
            <p>
              When companies attempted to modernize their accounting by moving from desktop Tally to
              cloud systems like Zoho Books, the migration often ground to a halt. Opening balances
              failed to reconcile, customer GSTIN treatments were miscategorized, and significant
              sums landed in mysterious suspense accounts. Similarly, during annual MCA filing seasons,
              teams risked uncapped late penalties of ₹100 per day simply due to portal timeouts and
              minor typographical discrepancies.
            </p>
            <p>
              Germin8 was founded to solve these exact friction points through software engineering.
              Instead of offering generic IT outsourcing or manual data entry retainers, we set out
              to build automated, deterministic platforms: algorithmic mapping engines, automated trial
              balance reconciliation matrices, and browser assistance utilities tailored precisely to
              Indian statutory frameworks.
            </p>
          </div>

          {/* Timeline Milestones (Clearly marked illustrative placeholders) */}
          <div className="pt-8 border-t border-slate-200">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-6">
              Development Milestones (Illustrative Roadmap)
            </span>

            <div className="space-y-8 relative before:absolute before:inset-0 before:left-3.5 before:w-0.5 before:bg-slate-200">
              <div className="relative flex items-start gap-6 pl-10">
                <span className="absolute left-1.5 top-1 w-4 h-4 rounded-full bg-blue-primary border-4 border-white shadow-sm" />
                <div>
                  <span className="text-xs font-mono font-bold text-blue-primary">Phase 1: Inception</span>
                  <h4 className="text-base font-bold font-display text-navy mt-0.5">
                    Research & Mathematical Mapping Architecture
                  </h4>
                  <p className="text-xs text-text-secondary mt-1 leading-relaxed">
                    Detailed analysis of Tally XML structures, Zoho Books schema requirements, and
                    Schedule III financial taxonomy to architect deterministic transformation logic.
                  </p>
                </div>
              </div>

              <div className="relative flex items-start gap-6 pl-10">
                <span className="absolute left-1.5 top-1 w-4 h-4 rounded-full bg-blue-primary border-4 border-white shadow-sm" />
                <div>
                  <span className="text-xs font-mono font-bold text-blue-primary">Phase 2: Alpha Validation</span>
                  <h4 className="text-base font-bold font-display text-navy mt-0.5">
                    Tally to Zoho Books Reconciliation Engine
                  </h4>
                  <p className="text-xs text-text-secondary mt-1 leading-relaxed">
                    Pilot testing with accounting practitioners, proving zero opening balance
                    adjustment imbalance across multi-entity sample ledgers.
                  </p>
                </div>
              </div>

              <div className="relative flex items-start gap-6 pl-10">
                <span className="absolute left-1.5 top-1 w-4 h-4 rounded-full bg-blue-primary border-4 border-white shadow-sm" />
                <div>
                  <span className="text-xs font-mono font-bold text-blue-primary">Phase 3: Production Release</span>
                  <h4 className="text-base font-bold font-display text-navy mt-0.5">
                    MCA V3 Form Automation Suite
                  </h4>
                  <p className="text-xs text-text-secondary mt-1 leading-relaxed">
                    Deployment of intelligent PDF extraction for Form AOC-4 and our secure browser
                    helper extension, drastically cutting annual filing preparation turnaround.
                  </p>
                </div>
              </div>

              <div className="relative flex items-start gap-6 pl-10">
                <span className="absolute left-1.5 top-1 w-4 h-4 rounded-full bg-slate-300 border-4 border-white shadow-sm" />
                <div>
                  <span className="text-xs font-mono font-bold text-slate-400">Phase 4: Future Expansion</span>
                  <h4 className="text-base font-bold font-display text-navy mt-0.5">
                    XBRL Taxonomies & Multi-ERP Connectors
                  </h4>
                  <p className="text-xs text-text-secondary mt-1 leading-relaxed">
                    Expanding our automation framework to include full XBRL reporting schedules and
                    migration bridges for additional accounting platforms.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
