import React, { useState } from 'react';
import {
  ArrowRightLeft,
  FileCheck,
  CheckCircle2,
  AlertCircle,
  Database,
  ArrowRight,
  Shield,
  RefreshCw,
  Cpu,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';

export const HeroSimulation: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'migration' | 'mca'>('migration');

  return (
    <div className="relative w-full max-w-xl mx-auto lg:max-w-none">
      {/* Ambient background glow */}
      <div className="absolute -inset-1 bg-gradient-to-r from-blue-primary/30 to-blue-sky/20 rounded-2xl blur-xl opacity-70 group-hover:opacity-100 transition duration-1000 -z-10" />

      {/* Main Terminal Card */}
      <Card
        variant="default"
        className="border border-slate-200/90 shadow-2xl rounded-2xl overflow-hidden bg-white/95 backdrop-blur-xl"
      >
        {/* Terminal Header Bar */}
        <div className="bg-[#111110] px-4 py-3 flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
            <span className="text-xs font-mono text-slate-400 ml-2 hidden sm:inline">
              germin8-engine // v3.4.2
            </span>
          </div>

          {/* Interactive Mode Toggle */}
          <div className="flex bg-[#1A1917] p-1 rounded-lg border border-slate-800 text-[11px] font-semibold">
            <button
              type="button"
              onClick={() => setActiveTab('migration')}
              className={`px-2.5 py-1 rounded-md transition-all flex items-center gap-1.5 ${
                activeTab === 'migration'
                  ? 'bg-blue-primary text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <ArrowRightLeft className="w-3 h-3" />
              Tally → Zoho
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('mca')}
              className={`px-2.5 py-1 rounded-md transition-all flex items-center gap-1.5 ${
                activeTab === 'mca'
                  ? 'bg-blue-primary text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <FileCheck className="w-3 h-3" />
              MCA V3 Prep
            </button>
          </div>
        </div>

        {/* Tab 1: Migration Dashboard Content */}
        {activeTab === 'migration' && (
          <div className="p-5 sm:p-6 space-y-5 animate-in fade-in duration-200">
            {/* Top Stat Row */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Target Destination
                </span>
                <div className="text-sm font-bold text-navy flex items-center gap-1.5 mt-0.5">
                  <span>TallyPrime 4.0</span>
                  <ArrowRight className="w-3.5 h-3.5 text-blue-primary" />
                  <span className="text-blue-primary">Zoho Books (India Ed.)</span>
                </div>
              </div>

              <div className="text-right">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Cutoff Date
                </span>
                <div className="text-sm font-bold text-navy mt-0.5">01-Apr-2024 (FY 24-25)</div>
              </div>
            </div>

            {/* Live Progress Bar */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="text-navy flex items-center gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5 text-blue-primary animate-spin" />
                  Trial Balance Validation & Field Alignment
                </span>
                <span className="text-blue-primary font-mono font-bold">98.4% Matched</span>
              </div>
              <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                <div className="bg-gradient-to-r from-blue-primary to-blue-sky h-full rounded-full w-[98.4%]" />
              </div>
            </div>

            {/* Quick Metrics Grid */}
            <div className="grid grid-cols-3 gap-2.5">
              <div className="p-2.5 bg-slate-50 border border-slate-200/60 rounded-lg">
                <span className="text-[10px] text-slate-500 uppercase font-bold block">
                  Ledgers
                </span>
                <span className="text-base font-extrabold text-navy font-display">1,482</span>
                <span className="text-[10px] text-emerald-600 block font-medium">Mapped 100%</span>
              </div>
              <div className="p-2.5 bg-slate-50 border border-slate-200/60 rounded-lg">
                <span className="text-[10px] text-slate-500 uppercase font-bold block">
                  GSTIN Profiles
                </span>
                <span className="text-base font-extrabold text-navy font-display">648</span>
                <span className="text-[10px] text-blue-primary block font-medium">Verified Active</span>
              </div>
              <div className="p-2.5 bg-emerald-50/50 border border-emerald-200 rounded-lg">
                <span className="text-[10px] text-emerald-700 uppercase font-bold block">
                  Adjustment Imbalance
                </span>
                <span className="text-base font-extrabold text-emerald-700 font-display">₹0.00</span>
                <span className="text-[10px] text-emerald-600 block font-medium">Exact Parity</span>
              </div>
            </div>

            {/* Live Validation Stream */}
            <div className="bg-[#111110] text-slate-300 rounded-xl p-3.5 font-mono text-xs space-y-2 border border-slate-800">
              <div className="flex items-center justify-between text-[11px] text-slate-400 border-b border-slate-800 pb-1.5">
                <span>STAGE: DATA CONCILIATION</span>
                <span className="text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> PASS
                </span>
              </div>
              <div className="flex items-center justify-between text-slate-300 text-[11px]">
                <span>Tally Total Debits:</span>
                <span className="text-white font-semibold">₹ 14,82,90,412.50</span>
              </div>
              <div className="flex items-center justify-between text-slate-300 text-[11px]">
                <span>Zoho Books Debits:</span>
                <span className="text-white font-semibold">₹ 14,82,90,412.50</span>
              </div>
              <div className="flex items-center justify-between text-emerald-400 text-[11px] pt-1 border-t border-slate-800/80">
                <span>Net Variance:</span>
                <span className="font-bold">₹ 0.00 (Zero Discrepancy)</span>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: MCA V3 Automation Content */}
        {activeTab === 'mca' && (
          <div className="p-5 sm:p-6 space-y-5 animate-in fade-in duration-200">
            {/* Top Company Info */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Target Entity Master
                </span>
                <div className="text-sm font-bold text-navy flex items-center gap-1.5 mt-0.5">
                  <span>CIN: U72200DL2021PTC384912</span>
                </div>
              </div>
              <Badge variant="green" size="sm">
                RoC Active (ROC Delhi)
              </Badge>
            </div>

            {/* MCA Form Pills */}
            <div className="grid grid-cols-3 gap-2">
              <div className="p-2.5 rounded-lg border border-blue-primary/40 bg-blue-light/50">
                <span className="text-[10px] font-bold text-blue-primary block uppercase">
                  Form AOC-4
                </span>
                <span className="text-xs font-bold text-navy">Schedule III PDF</span>
                <span className="text-[10px] text-emerald-600 block mt-1 font-semibold">
                  Pre-filled 100%
                </span>
              </div>
              <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50">
                <span className="text-[10px] font-bold text-slate-500 block uppercase">
                  Form ADT-1
                </span>
                <span className="text-xs font-bold text-navy">Auditor Appt.</span>
                <span className="text-[10px] text-blue-primary block mt-1 font-semibold">
                  SRN Verified
                </span>
              </div>
              <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50">
                <span className="text-[10px] font-bold text-slate-500 block uppercase">
                  Form MGT-7
                </span>
                <span className="text-xs font-bold text-navy">Annual Return</span>
                <span className="text-[10px] text-slate-600 block mt-1 font-semibold">
                  Shareholders Ready
                </span>
              </div>
            </div>

            {/* Validation Checklist */}
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between p-2 rounded-lg bg-emerald-50/60 border border-emerald-200/80 text-emerald-900">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Director DINs verified active with DIR-3 KYC compliance</span>
                </div>
                <span className="font-mono text-[10px] font-bold text-emerald-700">VALID</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-emerald-50/60 border border-emerald-200/80 text-emerald-900">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Auditor Firm Registration Number (FRN) cross-checked</span>
                </div>
                <span className="font-mono text-[10px] font-bold text-emerald-700">MATCHED</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-blue-50/60 border border-blue-200/80 text-blue-950">
                <div className="flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-blue-primary" />
                  <span>Browser Extension: Pre-fill payload ready for MCA V3 session</span>
                </div>
                <span className="font-mono text-[10px] font-bold text-blue-primary">STANDBY</span>
              </div>
            </div>

            {/* Professional Disclaimer Tag */}
            <div className="p-3 bg-amber-50/60 border border-amber-200 rounded-lg flex items-start gap-2.5 text-amber-900 text-[11px] leading-relaxed">
              <Shield className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>
                Human-in-the-loop: Certified CA/CS review and DSC signing required prior to final
                submission on MCA V3.
              </span>
            </div>
          </div>
        )}
      </Card>

      {/* Floating Trust Badge */}
      <div className="hidden sm:flex items-center gap-3 absolute -bottom-5 -left-4 bg-white/95 backdrop-blur-md p-3 rounded-xl border border-slate-200/80 shadow-lg z-10">
        <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
          <CheckCircle2 className="w-5 h-5" />
        </div>
        <div>
          <div className="text-xs font-bold text-navy">Certified Balance Parity</div>
          <div className="text-[11px] text-text-secondary">Zero paisa variance guaranteed</div>
        </div>
      </div>
    </div>
  );
};
