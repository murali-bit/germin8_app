import React from 'react';
import { Link } from 'react-router-dom';
import {
  Receipt,
  Sliders,
  ShieldCheck,
  Database,
  ArrowRight,
  Mail,
  Phone,
  CheckCircle2,
  TrendingDown,
  Clock,
  Check,
} from 'lucide-react';
import { SolutionsDataGraphic } from '@/components/illustrations/SolutionsDataGraphic';

export const SolutionsOverviewPage: React.FC = () => {
  return (
    <div className="bg-white min-h-screen font-sans text-gray-900">
      {/* =========================================================================
          HERO SECTION (Page 2 of Germin8.pdf)
          ========================================================================= */}
      <section className="pt-28 pb-12 sm:pt-36 sm:pb-16 border-b border-gray-100 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            {/* Left Header */}
            <div className="lg:col-span-8 space-y-4 text-left">
              <h1 className="text-3xl sm:text-4xl lg:text-[42px] font-bold tracking-tight text-gray-950 font-display leading-[1.2]">
                Solutions Overview — Automate core business operations with Germin8
              </h1>
              <p className="text-sm sm:text-base text-gray-600 leading-relaxed max-w-3xl">
                Germin8 streamlines repetitive back-office work and transforms siloed data into dependable, auditable workflows. Explore how our platform automates financial processes, operational workflows, compliance monitoring, and enterprise data orchestration to reduce costs, save time, and minimize errors.
              </p>
              <div className="pt-2 flex flex-wrap items-center gap-3">
                <Link
                  to="/book-a-demo"
                  className="px-5 py-2.5 text-sm font-medium text-white bg-[#111110] hover:bg-[#292824] rounded-md transition-all shadow-sm"
                >
                  Schedule a Consultation
                </Link>
                <Link
                  to="/products"
                  className="px-5 py-2.5 text-sm font-medium text-gray-800 bg-white hover:bg-gray-50 border border-gray-300 rounded-md transition-all"
                >
                  View Product Features
                </Link>
              </div>
            </div>

            {/* Right 3D Visual */}
            <div className="lg:col-span-4 flex justify-center">
              <SolutionsDataGraphic />
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          MAIN SOLUTIONS 2x2 GRID & RIGHT SIDEBAR (Page 2 of Germin8.pdf)
          ========================================================================= */}
      <section className="py-12 sm:py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Left 2x2 Solutions Grid (8 cols) */}
            <div className="lg:col-span-8 grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
              {/* Solution 1: Financial Processes */}
              <div className="bg-white p-6 rounded-xl border border-gray-200 hover:border-blue-200 transition-all flex flex-col justify-between shadow-sm">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                      <Receipt className="w-5 h-5 text-blue-600" />
                    </div>
                    <span className="text-xs px-2.5 py-1 rounded bg-blue-50 text-blue-700 font-semibold">
                      Savings: 55% AP cost
                    </span>
                  </div>

                  <h3 className="text-lg font-bold text-gray-900 font-display">
                    Financial Processes
                  </h3>
                  <p className="text-xs font-medium text-gray-500 mb-4">
                    Reduce manual reconciliation, speed up close cycles, and automate invoice-to-pay.
                  </p>

                  <div className="space-y-2 text-xs mb-4">
                    <div>
                      <strong className="text-gray-900">Problem:</strong>
                      <p className="text-gray-600 mt-0.5">
                        Fragmented ledgers, slow approvals, and late supplier payments cause missed discounts and lengthy month-ends.
                      </p>
                    </div>
                    <div>
                      <strong className="text-gray-900">Germin8 approach:</strong>
                      <p className="text-gray-600 mt-0.5">
                        Automated invoice ingestion, rule-based validation, and orchestrated approvals that integrate ERP, banks, and AP portals into a single automated flow.
                      </p>
                    </div>
                  </div>

                  {/* Metrics */}
                  <div className="p-3 bg-gray-50 rounded-lg border border-gray-100 text-xs text-gray-700 space-y-1 mb-4 font-mono">
                    <div>• Time saved: Month-end close shortened by 40%</div>
                    <div>• Cost reduction: AP processing cost reduced by 55%</div>
                    <div>• Error reduction: Payment errors cut by 85%</div>
                  </div>
                </div>

                <div className="pt-3 border-t border-gray-100">
                  <p className="text-xs italic text-gray-600">
                    "We closed our books 3 days faster each month with Germin8."
                  </p>
                  <p className="text-[11px] font-semibold text-gray-800 mt-1">
                    — Claire Ng, CFO, Meridian Logistics
                  </p>
                </div>
              </div>

              {/* Solution 2: Operational Workflows */}
              <div className="bg-white p-6 rounded-xl border border-gray-200 hover:border-blue-200 transition-all flex flex-col justify-between shadow-sm">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                      <Sliders className="w-5 h-5 text-blue-600" />
                    </div>
                    <span className="text-xs px-2.5 py-1 rounded bg-emerald-50 text-emerald-700 font-semibold">
                      Throughput: x2
                    </span>
                  </div>

                  <h3 className="text-lg font-bold text-gray-900 font-display">
                    Operational Workflows
                  </h3>
                  <p className="text-xs font-medium text-gray-500 mb-4">
                    Automate repetitive approvals, task routing, and exception handling across teams.
                  </p>

                  <div className="space-y-2 text-xs mb-4">
                    <div>
                      <strong className="text-gray-900">Problem:</strong>
                      <p className="text-gray-600 mt-0.5">
                        Manual task handoffs and email-based approvals create delays and poor visibility into SLAs.
                      </p>
                    </div>
                    <div>
                      <strong className="text-gray-900">Germin8 approach:</strong>
                      <p className="text-gray-600 mt-0.5">
                        Drag-and-drop workflow designer with conditional routing, automated notifications, and SLA dashboards to enforce timelines.
                      </p>
                    </div>
                  </div>

                  {/* Metrics */}
                  <div className="p-3 bg-gray-50 rounded-lg border border-gray-100 text-xs text-gray-700 space-y-1 mb-4 font-mono">
                    <div>• Time saved: Routine approvals automated up to 70%</div>
                    <div>• Cost reduction: Operational overhead lowered by 30%</div>
                    <div>• Error reduction: Exceptions reduced by 60%</div>
                  </div>
                </div>

                <div className="pt-3 border-t border-gray-100">
                  <p className="text-xs italic text-gray-600">
                    "Approval throughput doubled in two months."
                  </p>
                  <p className="text-[11px] font-semibold text-gray-800 mt-1">
                    — Miguel Torres, Head of Ops, NovaHealth
                  </p>
                </div>
              </div>

              {/* Solution 3: Compliance Monitoring */}
              <div className="bg-white p-6 rounded-xl border border-gray-200 hover:border-blue-200 transition-all flex flex-col justify-between shadow-sm">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                      <ShieldCheck className="w-5 h-5 text-blue-600" />
                    </div>
                    <span className="text-xs px-2.5 py-1 rounded bg-purple-50 text-purple-700 font-semibold">
                      Audit Readiness: 95%
                    </span>
                  </div>

                  <h3 className="text-lg font-bold text-gray-900 font-display">
                    Compliance Monitoring
                  </h3>
                  <p className="text-xs font-medium text-gray-500 mb-4">
                    Continuous controls, audit trails, and automated remediation for regulatory obligations.
                  </p>

                  <div className="space-y-2 text-xs mb-4">
                    <div>
                      <strong className="text-gray-900">Problem:</strong>
                      <p className="text-gray-600 mt-0.5">
                        Regulatory checks are frequently manual, scattered, and lack consistent evidence for audits.
                      </p>
                    </div>
                    <div>
                      <strong className="text-gray-900">Germin8 approach:</strong>
                      <p className="text-gray-600 mt-0.5">
                        Policy-driven checks, continuous monitoring agents, and an immutable audit log that surfaces non-compliance with automated remediation playbooks.
                      </p>
                    </div>
                  </div>

                  {/* Metrics */}
                  <div className="p-3 bg-gray-50 rounded-lg border border-gray-100 text-xs text-gray-700 space-y-1 mb-4 font-mono">
                    <div>• Time saved: Audit prep reduced by 65%</div>
                    <div>• Cost reduction: Compliance overhead lowered by 40%</div>
                    <div>• Error reduction: Non-compliance incidents reduced by 75%</div>
                  </div>
                </div>

                <div className="pt-3 border-t border-gray-100">
                  <p className="text-xs italic text-gray-600">
                    "Auditors found our evidence trail complete and easy to verify."
                  </p>
                  <p className="text-[11px] font-semibold text-gray-800 mt-1">
                    — Priya Sharma, Compliance Lead, FinServe
                  </p>
                </div>
              </div>

              {/* Solution 4: Data Orchestration */}
              <div className="bg-white p-6 rounded-xl border border-gray-200 hover:border-blue-200 transition-all flex flex-col justify-between shadow-sm">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                      <Database className="w-5 h-5 text-blue-600" />
                    </div>
                    <span className="text-xs px-2.5 py-1 rounded bg-sky-50 text-sky-700 font-semibold">
                      Latency: -70%
                    </span>
                  </div>

                  <h3 className="text-lg font-bold text-gray-900 font-display">
                    Data Orchestration
                  </h3>
                  <p className="text-xs font-medium text-gray-500 mb-4">
                    Unify, cleanse, and route data to downstream systems with guaranteed delivery.
                  </p>

                  <div className="space-y-2 text-xs mb-4">
                    <div>
                      <strong className="text-gray-900">Problem:</strong>
                      <p className="text-gray-600 mt-0.5">
                        Data silos and fragile ETL pipelines cause delays and inconsistent reporting across teams.
                      </p>
                    </div>
                    <div>
                      <strong className="text-gray-900">Germin8 approach:</strong>
                      <p className="text-gray-600 mt-0.5">
                        Central data bus with schema validation, idempotent ingestion, and replayable pipelines to ensure reliable delivery to ERP, BI, and analytics systems.
                      </p>
                    </div>
                  </div>

                  {/* Metrics */}
                  <div className="p-3 bg-gray-50 rounded-lg border border-gray-100 text-xs text-gray-700 space-y-1 mb-4 font-mono">
                    <div>• Time saved: Data delivery latency cut by 70%</div>
                    <div>• Cost reduction: ETL maintenance cost down 50%</div>
                    <div>• Error reduction: Data mismatches decreased by 90%</div>
                  </div>
                </div>

                <div className="pt-3 border-t border-gray-100">
                  <p className="text-xs italic text-gray-600">
                    "Reliable data pipelines let our analytics run nightly without failures."
                  </p>
                  <p className="text-[11px] font-semibold text-gray-800 mt-1">
                    — Elena Rossi, Data Engineering Manager, Orbit Retail
                  </p>
                </div>
              </div>
            </div>

            {/* Right Sidebar (4 cols) matching PDF */}
            <div className="lg:col-span-4 space-y-6 text-left">
              {/* Box 1: Quick ROI Snapshot */}
              <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                <h3 className="text-base font-bold text-gray-900 font-display mb-1">
                  Quick ROI Snapshot
                </h3>
                <p className="text-xs text-gray-500 mb-4">
                  See a concise summary of expected business impact from automating key operations.
                </p>

                {/* Horizontal Bar Chart visualization matching PDF Page 2 */}
                <div className="space-y-3 mb-5">
                  <div>
                    <div className="flex justify-between text-xs text-gray-700 mb-1 font-medium">
                      <span>Manual Approvals & Routing</span>
                      <span className="font-mono text-gray-500">85% automated</span>
                    </div>
                    <div className="w-full h-3 bg-gray-100 rounded-sm overflow-hidden">
                      <div className="h-full bg-slate-900 rounded-sm" style={{ width: '85%' }} />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs text-gray-700 mb-1 font-medium">
                      <span>Data Reconciliation Speed</span>
                      <span className="font-mono text-gray-500">60% faster</span>
                    </div>
                    <div className="w-full h-3 bg-gray-100 rounded-sm overflow-hidden">
                      <div className="h-full bg-slate-900 rounded-sm" style={{ width: '60%' }} />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs text-gray-700 mb-1 font-medium">
                      <span>Statutory Audit Prep</span>
                      <span className="font-mono text-gray-500">45% reduction</span>
                    </div>
                    <div className="w-full h-3 bg-gray-100 rounded-sm overflow-hidden">
                      <div className="h-full bg-slate-900 rounded-sm" style={{ width: '45%' }} />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs text-gray-700 mb-1 font-medium">
                      <span>Exception Resolution Rate</span>
                      <span className="font-mono text-gray-500">75% direct</span>
                    </div>
                    <div className="w-full h-3 bg-gray-100 rounded-sm overflow-hidden">
                      <div className="h-full bg-slate-900 rounded-sm" style={{ width: '75%' }} />
                    </div>
                  </div>
                </div>

                {/* 2 Stat Boxes */}
                <div className="grid grid-cols-2 gap-3 pt-3 border-t border-gray-100">
                  <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                    <div className="text-[11px] text-gray-500">Avg Time Saved</div>
                    <div className="text-xl font-bold text-gray-900 font-display">60%</div>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                    <div className="text-[11px] text-gray-500">Cost Reduction</div>
                    <div className="text-xl font-bold text-emerald-600 font-display">45%</div>
                  </div>
                </div>
              </div>

              {/* Box 2: Next Steps matching PDF Page 2 */}
              <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm space-y-2.5">
                <h3 className="text-sm font-bold text-gray-900 font-display mb-2">
                  Next Steps
                </h3>
                <Link
                  to="/book-a-demo"
                  className="block w-full text-center py-2 px-3 bg-[#111110] hover:bg-[#292824] text-white rounded-md text-xs font-semibold transition-colors"
                >
                  Schedule a Consultation
                </Link>
                <Link
                  to="/products"
                  className="block w-full text-center py-2 px-3 bg-white hover:bg-gray-50 text-gray-800 border border-gray-300 rounded-md text-xs font-semibold transition-colors"
                >
                  View Product Features
                </Link>
                <Link
                  to="/case-studies"
                  className="block w-full text-center py-2 px-3 bg-white hover:bg-gray-50 text-gray-800 border border-gray-300 rounded-md text-xs font-semibold transition-colors"
                >
                  Request Case Studies & ROI
                </Link>
              </div>

              {/* Box 3: Contact Sales matching PDF Page 2 */}
              <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                <h3 className="text-sm font-bold text-gray-900 font-display mb-1">
                  Contact Sales
                </h3>
                <p className="text-xs text-gray-500 mb-3">
                  Prefer a tailored walkthrough? Our solutions specialists are available for 30-minute consults.
                </p>
                <div className="space-y-1.5 text-xs text-gray-700">
                  <div className="flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-gray-400" />
                    <span>Email: <a href="mailto:sales@germin8.com" className="text-blue-600 hover:underline">sales@germin8.com</a></span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-gray-400" />
                    <span>Phone: +1 (555) 712-0489</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          BOTTOM CTA BANNER (Page 2 of Germin8.pdf)
          ========================================================================= */}
      <section className="py-10 bg-white border-t border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6 p-6 sm:p-8 rounded-xl border border-gray-200 bg-gray-50">
            <div className="text-left">
              <h3 className="text-lg sm:text-xl font-bold text-gray-900 font-display">
                Ready to quantify the impact?
              </h3>
              <p className="text-xs sm:text-sm text-gray-600 mt-1 max-w-xl">
                Request a tailored ROI assessment or browse product features to map Germin8 to your operational processes.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <Link
                to="/book-a-demo"
                className="px-4 py-2.5 bg-[#111110] hover:bg-[#292824] text-white rounded-md text-xs font-semibold transition-colors"
              >
                Schedule a Consultation
              </Link>
              <Link
                to="/products"
                className="px-4 py-2.5 bg-white hover:bg-gray-100 text-gray-800 border border-gray-300 rounded-md text-xs font-semibold transition-colors"
              >
                View Product Features
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
