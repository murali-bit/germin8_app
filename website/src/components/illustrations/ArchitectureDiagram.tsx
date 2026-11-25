import React from 'react';
import { Network, Cpu, Workflow, BarChart3, Check } from 'lucide-react';

export const ArchitectureDiagram: React.FC = () => {
  return (
    <div className="space-y-4 text-left font-sans">
      {/* Clean White Architecture Flow */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <div className="grid grid-cols-2 gap-2.5">
          <div className="p-3 bg-blue-50/60 rounded-lg border border-blue-200">
            <div className="flex items-center gap-1.5 text-blue-700 font-bold text-xs mb-1">
              <Network className="w-4 h-4 text-blue-600" />
              <span>1. Connectors</span>
            </div>
            <p className="text-[11px] text-gray-600">Reads Tally XML, Invoices, bank files automatically.</p>
          </div>

          <div className="p-3 bg-purple-50/60 rounded-lg border border-purple-200">
            <div className="flex items-center gap-1.5 text-purple-700 font-bold text-xs mb-1">
              <Cpu className="w-4 h-4 text-purple-600" />
              <span>2. AI Validation</span>
            </div>
            <p className="text-[11px] text-gray-600">Checks GSTINs, math, and matches ledger heads.</p>
          </div>

          <div className="p-3 bg-sky-50/60 rounded-lg border border-sky-200">
            <div className="flex items-center gap-1.5 text-sky-700 font-bold text-xs mb-1">
              <Workflow className="w-4 h-4 text-sky-600" />
              <span>3. Automation</span>
            </div>
            <p className="text-[11px] text-gray-600">Routes exceptions to humans if anything looks off.</p>
          </div>

          <div className="p-3 bg-emerald-50/60 rounded-lg border border-emerald-200">
            <div className="flex items-center gap-1.5 text-emerald-700 font-bold text-xs mb-1">
              <BarChart3 className="w-4 h-4 text-emerald-600" />
              <span>4. Final Sync</span>
            </div>
            <p className="text-[11px] text-gray-600">Posts to Zoho Books & prepares MCA filing.</p>
          </div>
        </div>
      </div>

      {/* Bulleted feature points */}
      <ul className="space-y-2 text-xs text-gray-600 leading-relaxed">
        <li className="flex items-start gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-600 mt-1.5 shrink-0" />
          <span><strong>Connectors:</strong> Pull data from Tally, Excel, or PDF invoices with zero manual typing.</span>
        </li>
        <li className="flex items-start gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-600 mt-1.5 shrink-0" />
          <span><strong>AI Services:</strong> Verify numbers and tax rules with 100% accuracy.</span>
        </li>
        <li className="flex items-start gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-600 mt-1.5 shrink-0" />
          <span><strong>Orchestration:</strong> You stay in control with one-click approvals and full audit logs.</span>
        </li>
        <li className="flex items-start gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-600 mt-1.5 shrink-0" />
          <span><strong>Reporting:</strong> Instant reconciliation certificates ready for your CAs and auditors.</span>
        </li>
      </ul>
    </div>
  );
};
