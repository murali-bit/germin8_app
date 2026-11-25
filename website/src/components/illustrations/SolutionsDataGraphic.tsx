import React from 'react';
import { Database, ArrowRight, ShieldCheck, CheckCircle2 } from 'lucide-react';

export const SolutionsDataGraphic: React.FC = () => {
  return (
    <div className="w-full max-w-sm mx-auto bg-white rounded-2xl border border-gray-200 p-5 shadow-lg select-none text-left font-sans">
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-gray-100">
        <span className="text-xs font-bold text-gray-800 font-display">
          Germin8 Data Bus Flow
        </span>
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Active Sync
        </span>
      </div>

      {/* 3 Step Connected Cards */}
      <div className="space-y-2.5">
        {/* Box 1 */}
        <div className="p-3 rounded-lg bg-blue-50/60 border border-blue-200 flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold text-blue-700 uppercase">Input Systems</div>
            <div className="text-xs font-bold text-gray-900">Tally, Invoices, Bank Feeds</div>
          </div>
          <span className="text-[11px] font-mono font-semibold text-blue-700 bg-white px-2 py-0.5 rounded border border-blue-100">
            Raw Data
          </span>
        </div>

        <div className="flex justify-center -my-1 text-blue-400">
          <span className="text-xs font-bold">↓</span>
        </div>

        {/* Box 2 */}
        <div className="p-3 rounded-lg bg-purple-50/60 border border-purple-200 flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold text-purple-700 uppercase">Germin8 AI Engine</div>
            <div className="text-xs font-bold text-gray-900">Auto-Map, Tax & Math Check</div>
          </div>
          <span className="text-[11px] font-mono font-semibold text-purple-700 bg-white px-2 py-0.5 rounded border border-purple-100">
            0 Mismatch
          </span>
        </div>

        <div className="flex justify-center -my-1 text-purple-400">
          <span className="text-xs font-bold">↓</span>
        </div>

        {/* Box 3 */}
        <div className="p-3 rounded-lg bg-emerald-50/60 border border-emerald-200 flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold text-emerald-700 uppercase">Output Systems</div>
            <div className="text-xs font-bold text-gray-900">Zoho Books & MCA Portal</div>
          </div>
          <span className="text-[11px] font-mono font-semibold text-emerald-700 bg-white px-2 py-0.5 rounded border border-emerald-100">
            Audit-Ready
          </span>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between text-[11px] text-gray-500">
        <span>Average time saved:</span>
        <strong className="text-gray-900 font-bold">Up to 70% per client</strong>
      </div>
    </div>
  );
};
