import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Clock,
  DollarSign,
  CheckCircle2,
  Filter,
  ArrowRight,
  TrendingUp,
  ShieldCheck,
  Building2,
  Users,
} from 'lucide-react';
import { RoiCalculator } from '@/components/calculator/RoiCalculator';

export const CaseStudiesPage: React.FC = () => {
  const [activeFilter, setActiveFilter] = useState<'all' | 'finance' | 'operations' | 'compliance'>('all');
  const [sortOrder, setSortOrder] = useState('newest');

  const caseStudies = [
    {
      id: 'meridian-health',
      category: 'finance',
      categoryLabel: 'Finance',
      date: 'Mar 2026',
      title: 'Reducing Claim Reconciliation Time at Meridian Health',
      challenge:
        'Meridian faced slow claims reconciliation causing delayed payouts and manual errors across 150k monthly claims.',
      solution:
        'Automated claim classification and anomaly detection integrated with existing claims pipeline to prioritize high-risk cases.',
      metrics: [
        { label: 'Time Saved', value: '68%' },
        { label: 'Cost Reduction', value: '$120k' },
        { label: 'Accuracy', value: '+22%' },
      ],
      quote:
        'Germin8 helped us reduce reconciliation time dramatically and recover thousands in avoidable payouts.',
      author: 'Asha Raman, VP Claims Operations, Meridian Health',
      image: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=300&auto=format&fit=crop&q=80',
    },
    {
      id: 'nova-logistics',
      category: 'operations',
      categoryLabel: 'Operations',
      date: 'Feb 2026',
      title: 'Streamlining Invoice Processing at Nova Logistics',
      challenge:
        'Nova had a 40% backlog in invoice approvals due to manual matching and validation across vendors.',
      solution:
        'Automated vendor matching and exception routing decreasing manual review volume.',
      metrics: [
        { label: 'Approval Speed', value: '+54%' },
        { label: 'Backlog', value: '-40%' },
        { label: 'Labor Hours', value: '-320 hrs/mo' },
      ],
      quote:
        'Vendor reconciliation time was halved and approvals moved from days to hours.',
      author: 'Jamal Ortega, Head of Operations, Nova Logistics',
    },
    {
      id: 'atlas-bank',
      category: 'compliance',
      categoryLabel: 'Compliance',
      date: 'Jan 2026',
      title: 'Enhancing Regulatory Monitoring for Atlas Bank',
      challenge:
        'Atlas needed continuous monitoring of transaction patterns to meet evolving compliance mandates.',
      solution:
        'Real-time rule-based alerts combined with NLP-driven entity resolution to flag risky activity.',
      metrics: [
        { label: 'False Positives', value: '-33%' },
        { label: 'Investigation Time', value: '-41%' },
        { label: 'Coverage', value: '+70%' },
      ],
      quote:
        'Germin8 allowed us to focus investigations on high-risk cases and reduce wasted analyst time.',
      author: 'Mei Tan, Chief Compliance Officer, Atlas Bank',
    },
    {
      id: 'horizon-retail',
      category: 'operations',
      categoryLabel: 'Operations',
      date: 'Dec 2025',
      title: 'Inventory Accuracy Gains at Horizon Retail',
      challenge:
        'Horizon struggled with inconsistent inventory counts across 230 stores leading to stockouts and overstocks.',
      solution:
        'Cross-referenced POS and supplier feeds to reconcile inventory and flag discrepancies for rapid correction.',
      metrics: [
        { label: 'Stockout Reduction', value: '-29%' },
        { label: 'Inventory Accuracy', value: '+35%' },
        { label: 'Labor Saved', value: '-190 hrs/mo' },
      ],
      quote:
        'Real-time reconciliation cut our cycle counts and improved shelf availability.',
      author: 'Karen Smith, Director of Supply Chain, Horizon Retail',
    },
  ];

  const filteredStudies = caseStudies.filter((item) => {
    if (activeFilter === 'all') return true;
    return item.category === activeFilter;
  });

  return (
    <div className="bg-white min-h-screen font-sans text-gray-900">
      {/* =========================================================================
          HERO & STATS BAR (Page 4 of Germin8.pdf)
          ========================================================================= */}
      <section className="pt-28 pb-10 sm:pt-36 sm:pb-14 border-b border-gray-100 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-left space-y-3 max-w-4xl mb-8">
            <h1 className="text-3xl sm:text-4xl lg:text-[42px] font-bold tracking-tight text-gray-950 font-display">
              Case Studies & ROI
            </h1>
            <p className="text-sm sm:text-base text-gray-600 leading-relaxed">
              Explore real customer stories demonstrating measurable outcomes with Germin8. See challenges, our solutions, quantified results and testimonials — then estimate your own ROI with our calculator.
            </p>
          </div>

          {/* Top Stats & Impact Row matching PDF Page 4 */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            {/* 3 Metric Pills */}
            <div className="lg:col-span-4 flex flex-col justify-between gap-3">
              <div className="flex items-center justify-between p-3.5 bg-gray-50 rounded-lg border border-gray-200">
                <span className="flex items-center gap-2 text-xs font-semibold text-gray-700">
                  <Clock className="w-4 h-4 text-emerald-600" /> Avg. Time Saved
                </span>
                <span className="text-lg font-bold text-gray-900 font-display">42%</span>
              </div>
              <div className="flex items-center justify-between p-3.5 bg-gray-50 rounded-lg border border-gray-200">
                <span className="flex items-center gap-2 text-xs font-semibold text-gray-700">
                  <DollarSign className="w-4 h-4 text-emerald-600" /> Avg. Cost Reduction
                </span>
                <span className="text-lg font-bold text-gray-900 font-display">27%</span>
              </div>
              <div className="flex items-center justify-between p-3.5 bg-gray-50 rounded-lg border border-gray-200">
                <span className="flex items-center gap-2 text-xs font-semibold text-gray-700">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Accuracy Improvement
                </span>
                <span className="text-lg font-bold text-gray-900 font-display">15%</span>
              </div>
            </div>

            {/* Aggregate Impact Card */}
            <div className="lg:col-span-4 bg-gray-50 p-5 rounded-xl border border-gray-200 flex flex-col justify-between text-left">
              <div>
                <div className="text-xs uppercase tracking-wider font-semibold text-gray-500 mb-1">
                  Aggregate impact across clients
                </div>
                <div className="text-xl sm:text-2xl font-bold text-gray-900 font-display">
                  Projected annual savings: up to $1.2M+
                </div>
              </div>
              <div className="pt-3">
                <button
                  type="button"
                  className="px-3 py-1.5 bg-[#111110] hover:bg-[#292824] text-white text-xs font-semibold rounded transition-colors"
                >
                  Explore Methodology
                </button>
              </div>
            </div>

            {/* Featured KPI Snapshot */}
            <div className="lg:col-span-4 bg-white p-5 rounded-xl border border-gray-200 shadow-sm text-left flex flex-col justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-0.5">
                  Featured KPI Snapshot
                </div>
                <div className="text-sm font-bold text-gray-900 font-display mb-3">
                  Healthcare Claims - Finance
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="p-2 bg-gray-50 rounded border border-gray-100">
                    <div className="text-[10px] text-gray-500">Time Saved</div>
                    <div className="text-sm font-bold text-gray-900">68%</div>
                  </div>
                  <div className="p-2 bg-gray-50 rounded border border-gray-100">
                    <div className="text-[10px] text-gray-500">Cost</div>
                    <div className="text-sm font-bold text-emerald-600">-$120k</div>
                  </div>
                  <div className="p-2 bg-gray-50 rounded border border-gray-100">
                    <div className="text-[10px] text-gray-500">Accuracy</div>
                    <div className="text-sm font-bold text-blue-600">+22%</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          FILTER BAR & MAIN CASE STUDIES 2x2 GRID + ROI CALCULATOR (Page 4)
          ========================================================================= */}
      <section className="py-10 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Filter Bar matching PDF Page 4 */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 pb-4 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-500">Filter by industry:</span>
              <div className="flex items-center gap-1.5">
                {(['all', 'finance', 'operations', 'compliance'] as const).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setActiveFilter(cat)}
                    className={`px-3 py-1 text-xs font-semibold rounded-md capitalize transition-colors ${
                      activeFilter === cat
                        ? 'bg-[#111110] text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-500">Sort:</span>
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
                className="text-xs border border-gray-300 rounded px-2.5 py-1 text-gray-700 focus:outline-none"
              >
                <option value="newest">Newest</option>
                <option value="impact">Highest ROI</option>
                <option value="industry">Industry</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Left 4 Case Study Cards (8 cols) */}
            <div className="lg:col-span-8 grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
              {filteredStudies.map((study) => (
                <div
                  key={study.id}
                  className="bg-white p-6 rounded-xl border border-gray-200 hover:border-blue-200 transition-all flex flex-col justify-between shadow-sm"
                >
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100 capitalize">
                        {study.categoryLabel}
                      </span>
                      <span className="text-xs text-gray-400 font-mono">{study.date}</span>
                    </div>

                    <h3 className="text-base font-bold text-gray-900 font-display mb-3">
                      {study.title}
                    </h3>

                    <div className="space-y-2 text-xs mb-4">
                      <div>
                        <strong className="text-gray-900">Challenge:</strong>
                        <p className="text-gray-600 mt-0.5">{study.challenge}</p>
                      </div>
                      <div>
                        <strong className="text-gray-900">Germin8 Solution:</strong>
                        <p className="text-gray-600 mt-0.5">{study.solution}</p>
                      </div>
                    </div>

                    {/* 3 Metric Pills */}
                    <div className="grid grid-cols-3 gap-2 bg-gray-50 p-2.5 rounded-lg border border-gray-100 text-center mb-4">
                      {study.metrics.map((m, idx) => (
                        <div key={idx}>
                          <div className="text-[10px] text-gray-500">{m.label}</div>
                          <div className="text-xs font-bold text-gray-900 mt-0.5">{m.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="pt-3 border-t border-gray-100">
                    <p className="text-xs italic text-gray-600">"{study.quote}"</p>
                    <p className="text-[11px] font-semibold text-gray-800 mt-1">— {study.author}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Right Sidebar: ROI Calculator (4 cols) */}
            <div className="lg:col-span-4">
              <RoiCalculator />
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          CLIENT VOICES (Page 4 of Germin8.pdf)
          ========================================================================= */}
      <section className="py-12 sm:py-16 bg-[#FAFAFA] border-t border-gray-200 text-left">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-xl font-bold text-gray-900 font-display mb-6">
            Client Voices
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm flex flex-col justify-between">
              <p className="text-xs sm:text-sm text-gray-700 leading-relaxed italic mb-4">
                "Our claims team cut processing time in half — the ROI was visible within the first quarter."
              </p>
              <div className="text-xs font-semibold text-gray-900 border-t border-gray-100 pt-3">
                Carlos Mendes, Head of Claims, Evergreen Insurance
              </div>
            </div>

            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm flex flex-col justify-between">
              <p className="text-xs sm:text-sm text-gray-700 leading-relaxed italic mb-4">
                "Automating exception routing saved us 320 hours a month."
              </p>
              <div className="text-xs font-semibold text-gray-900 border-t border-gray-100 pt-3">
                Rina Patel, Finance Director, Solace Retail
              </div>
            </div>

            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm flex flex-col justify-between">
              <p className="text-xs sm:text-sm text-gray-700 leading-relaxed italic mb-4">
                "Compliance monitoring became proactive instead of reactive."
              </p>
              <div className="text-xs font-semibold text-gray-900 border-t border-gray-100 pt-3">
                Liam O'Connor, Chief Risk Officer, Sterling Bank
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
