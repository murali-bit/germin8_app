import React from 'react';
import { Download, ScanSearch, Workflow, CheckCircle2, ArrowRight } from 'lucide-react';
import { Card } from '@/components/ui/Card';

export const STEPS = [
  {
    stepNumber: '01',
    name: 'Collect',
    icon: Download,
    title: 'Multi-Source Data Ingestion',
    description:
      'Extract data from TallyPrime / Tally.ERP 9 exports, MCA public company registries, or audited Schedule III PDF financial statements without schema loss.',
    details: ['XML & Excel ledger dumps', 'CIN & DIN registry lookups', 'Audited PDF balance sheets'],
  },
  {
    stepNumber: '02',
    name: 'Analyse',
    icon: ScanSearch,
    title: 'Deterministic Mapping & Validation',
    description:
      'Our engine maps Tally primary groups into Zoho Books account types, cross-references 15-digit GSTINs, and flags discrepancy risks before data moves.',
    details: ['Place of Supply verification', 'HSN/SAC 4-8 digit checks', 'Balance parity dry-run'],
  },
  {
    stepNumber: '03',
    name: 'Automate',
    icon: Workflow,
    title: 'Sequential Migration & Pre-Fill',
    description:
      'Validated records are imported into Zoho Books in strict mathematical order, or pre-populated into MCA V3 portal forms via our secure browser helper.',
    details: ['COA → Contacts → Balances', 'Zero opening adjustments', 'MCA V3 payload injection'],
  },
  {
    stepNumber: '04',
    name: 'Verify',
    icon: CheckCircle2,
    title: 'Human Review & Reconciliation',
    description:
      'Qualified Chartered Accountants and Company Secretaries inspect line-by-line reconciliation reports, verify zero variances, and affix DSC credentials.',
    details: ['Dual-system audit reports', 'Human-in-the-loop control', 'Downloadable audit trail'],
  },
];

export const WorkflowPipeline: React.FC = () => {
  return (
    <div className="relative">
      {/* Horizontal connector line on desktop */}
      <div className="hidden lg:block absolute top-1/2 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-primary/20 via-blue-primary to-blue-primary/20 -translate-y-12 z-0" />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 relative z-10">
        {STEPS.map((step, idx) => {
          const Icon = step.icon;
          return (
            <Card
              key={step.stepNumber}
              variant="default"
              className="p-6 relative group hover:border-blue-primary/60 hover:shadow-lg transition-all duration-300 bg-white"
            >
              {/* Step indicator */}
              <div className="flex items-center justify-between mb-6">
                <span className="font-mono text-2xl font-black text-blue-primary/30 group-hover:text-blue-primary transition-colors">
                  {step.stepNumber}
                </span>
                <div className="w-10 h-10 rounded-xl bg-blue-light text-blue-primary flex items-center justify-center group-hover:bg-blue-primary group-hover:text-white transition-colors shadow-sm">
                  <Icon className="w-5 h-5" />
                </div>
              </div>

              <div className="text-xs font-bold uppercase tracking-wider text-blue-primary mb-1">
                Phase {step.stepNumber}: {step.name}
              </div>

              <h4 className="text-lg font-bold font-display text-navy mb-3 group-hover:text-blue-primary transition-colors">
                {step.title}
              </h4>

              <p className="text-xs text-text-secondary leading-relaxed mb-4">
                {step.description}
              </p>

              {/* Checklist items */}
              <div className="pt-4 border-t border-slate-100 space-y-1.5">
                {step.details.map((item, itemIdx) => (
                  <div key={itemIdx} className="flex items-center gap-2 text-[11px] text-slate-600">
                    <span className="w-1 h-1 rounded-full bg-blue-primary" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
};
