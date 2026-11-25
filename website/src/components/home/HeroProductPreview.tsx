import React, { useState } from 'react';
import { CheckCircle2, ArrowRightLeft, ShieldCheck, Check, FileCheck, Layers } from 'lucide-react';

export const HeroProductPreview: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'tally-zoho' | 'mca'>('tally-zoho');

  return (
    <div className="w-full bg-white rounded-2xl border border-slate-200/90 shadow-xl overflow-hidden text-left font-sans transition-all">
      {/* Window Title Bar */}
      <div className="px-4 py-3 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-[#E7E6E3] inline-block" />
          <span className="w-3 h-3 rounded-full bg-[#E7E6E3] inline-block" />
          <span className="w-3 h-3 rounded-full bg-[#E7E6E3] inline-block" />
          <span className="ml-2 text-xs font-mono text-slate-300 font-medium">
            germin8-app // live-migration-console
          </span>
        </div>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 font-mono">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          100% Trial Balance Verified
        </span>
      </div>

      {/* Product Mode Tabs */}
      <div className="bg-slate-100/80 px-4 pt-2.5 border-b border-slate-200 flex gap-2">
        <button
          type="button"
          onClick={() => setActiveTab('tally-zoho')}
          className={`px-3.5 py-2 text-xs font-bold rounded-t-lg transition-all flex items-center gap-1.5 ${
            activeTab === 'tally-zoho'
              ? 'bg-white text-slate-900 border-t-2 border-t-blue-600 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <ArrowRightLeft className="w-3.5 h-3.5 text-blue-600" />
          <span>Tally → Zoho Books Migration</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('mca')}
          className={`px-3.5 py-2 text-xs font-bold rounded-t-lg transition-all flex items-center gap-1.5 ${
            activeTab === 'mca'
              ? 'bg-white text-slate-900 border-t-2 border-t-blue-600 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <FileCheck className="w-3.5 h-3.5 text-emerald-600" />
          <span>MCA V3 Compliance Engine</span>
        </button>
      </div>

      {/* Main Software View */}
      {activeTab === 'tally-zoho' ? (
        <div className="p-4 sm:p-5 bg-white space-y-4">
          {/* Metadata Subheader */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-800">Source:</span>
              <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[11px]">
                TallyPrime XML (FY 24-25)
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-800">Target:</span>
              <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-mono text-[11px] font-semibold">
                Zoho Books Organization
              </span>
            </div>
          </div>

          {/* High-Contrast Live Comparison Table */}
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200 text-[10px] uppercase tracking-wider">
                <tr>
                  <th className="py-2.5 px-3">Account Head</th>
                  <th className="py-2.5 px-3 text-right">Tally Balance</th>
                  <th className="py-2.5 px-3 text-right">Zoho Balance</th>
                  <th className="py-2.5 px-3 text-center">Reconciliation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-sans text-[11px]">
                <tr className="hover:bg-slate-50/60">
                  <td className="py-2 px-3 font-semibold text-slate-900">
                    HDFC Bank Current A/c
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-slate-700">₹ 42,18,920.00</td>
                  <td className="py-2 px-3 text-right font-mono text-blue-700 font-semibold">₹ 42,18,920.00</td>
                  <td className="py-2 px-3 text-center">
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                      <Check className="w-3 h-3 text-emerald-600" /> Matched
                    </span>
                  </td>
                </tr>

                <tr className="hover:bg-slate-50/60">
                  <td className="py-2 px-3 font-semibold text-slate-900">
                    Sundry Debtors (Customer Ledger)
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-slate-700">₹ 18,45,000.00</td>
                  <td className="py-2 px-3 text-right font-mono text-blue-700 font-semibold">₹ 18,45,000.00</td>
                  <td className="py-2 px-3 text-center">
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                      <Check className="w-3 h-3 text-emerald-600" /> Matched
                    </span>
                  </td>
                </tr>

                <tr className="hover:bg-slate-50/60">
                  <td className="py-2 px-3 font-semibold text-slate-900">
                    Input CGST + SGST (9% Consolidated)
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-slate-700">₹ 7,48,420.00</td>
                  <td className="py-2 px-3 text-right font-mono text-blue-700 font-semibold">₹ 7,48,420.00</td>
                  <td className="py-2 px-3 text-center">
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                      <Check className="w-3 h-3 text-emerald-600" /> Matched
                    </span>
                  </td>
                </tr>

                <tr className="hover:bg-slate-50/60">
                  <td className="py-2 px-3 font-semibold text-slate-900">
                    Finished Goods Stock-in-Hand
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-slate-700">₹ 65,30,000.00</td>
                  <td className="py-2 px-3 text-right font-mono text-blue-700 font-semibold">₹ 65,30,000.00</td>
                  <td className="py-2 px-3 text-center">
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                      <Check className="w-3 h-3 text-emerald-600" /> Matched
                    </span>
                  </td>
                </tr>
              </tbody>
              <tfoot className="bg-slate-50/90 font-bold border-t border-slate-200 text-xs">
                <tr>
                  <td className="py-2.5 px-3 text-slate-900 font-bold">Total Trial Balance</td>
                  <td className="py-2.5 px-3 text-right font-mono text-slate-900">₹ 1,33,43,340.00</td>
                  <td className="py-2.5 px-3 text-right font-mono text-blue-800">₹ 1,33,43,340.00</td>
                  <td className="py-2.5 px-3 text-center">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px]">
                      Zero Delta (₹0.00)
                    </span>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Bottom Audit Parity Stamp */}
          <div className="pt-2 flex items-center justify-between text-xs text-slate-600">
            <span className="flex items-center gap-1.5 font-semibold text-slate-800">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              Automated Audit Parity Certified
            </span>
            <span className="font-mono text-blue-700 font-semibold">4,280 Vouchers Synced</span>
          </div>
        </div>
      ) : (
        <div className="p-4 sm:p-5 bg-white space-y-4">
          {/* MCA V3 View */}
          <div className="p-3.5 bg-emerald-50/70 border border-emerald-200 rounded-xl space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-emerald-900 font-display">
                Apex Infotech Solutions Private Limited
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 bg-white text-emerald-800 rounded font-bold border border-emerald-200">
                CIN: U72200MH2018PTC309182
              </span>
            </div>
            <p className="text-[11px] text-emerald-700">
              Financial Year: 2024-25 • Schedule III Balance Sheet & P&L Auto-Crosschecked
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <div className="text-[10px] text-slate-500 font-bold uppercase">Target Filing</div>
              <div className="text-sm font-bold text-slate-900 mt-0.5">Form AOC-4 (XBRL)</div>
              <div className="text-[11px] text-emerald-700 mt-1 flex items-center gap-1">
                <Check className="w-3 h-3 text-emerald-600" /> Zero Schema Errors
              </div>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <div className="text-[10px] text-slate-500 font-bold uppercase">Annual Return</div>
              <div className="text-sm font-bold text-slate-900 mt-0.5">Form MGT-7 / 7A</div>
              <div className="text-[11px] text-emerald-700 mt-1 flex items-center gap-1">
                <Check className="w-3 h-3 text-emerald-600" /> Share Capital Pre-Validated
              </div>
            </div>
          </div>

          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-700 flex items-center justify-between">
            <span className="font-semibold">MCA V3 Portal Direct Integration</span>
            <span className="text-emerald-700 font-bold font-mono">100% Pre-Filled</span>
          </div>
        </div>
      )}
    </div>
  );
};
