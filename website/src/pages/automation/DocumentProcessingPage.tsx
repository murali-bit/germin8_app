import React from 'react';
import { ScanLine, CheckCircle2, ArrowRight, FileText, Database, Shield } from 'lucide-react';
import { PageHero } from '@/components/ui/PageHero';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export const DocumentProcessingPage: React.FC = () => {
  return (
    <div>
      <PageHero
        badge="Intelligent OCR"
        breadcrumbs={[{ label: 'Automation', href: '/automation' }, { label: 'Document Processing' }]}
        title="Intelligent Financial Document Processing"
        description="High-precision financial extraction engine that ingests audited balance sheet PDFs, extracts multi-column Schedule III tables, and formats them into standardized JSON schemas."
        actions={
          <Button variant="primary" size="lg" href="/book-a-demo" icon={ArrowRight}>
            Request Document Extraction Demo
          </Button>
        }
      />

      <section className="py-20 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader
            eyebrow="Precision Extraction"
            title="Beyond Simple OCR Scanners"
            description="Audited financial statements feature complex spanning headers, multi-year comparisons, and footnote disclosures. Here is how our engine parses them."
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <Card variant="default" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-blue-light text-blue-primary flex items-center justify-center mb-4">
                <FileText className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                Schedule III Layout Recognition
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                Identifies Equity & Liabilities, Non-Current Assets, and Current Assets sections
                regardless of formatting nuances, column spacing, or custom font typography.
              </p>
            </Card>

            <Card variant="default" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center mb-4">
                <Database className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                Multi-Year Column Splitting
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                Separates Current Year (CY) and Previous Year (PY) audited figures cleanly, ensuring
                historical comparison metrics are preserved without line drift.
              </p>
            </Card>

            <Card variant="default" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-purple-50 text-purple-700 flex items-center justify-center mb-4">
                <Shield className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                Cross-Checking Subtotals
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                Runs mathematical equations verifying that parsed line items sum up precisely to the
                reported subtotal and total balance sheet lines before exporting data.
              </p>
            </Card>
          </div>
        </div>
      </section>

      <section className="py-20 bg-site-bg text-center">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
          <h3 className="text-2xl sm:text-3xl font-bold font-display text-navy">
            Test Document Extraction with Your Sample Files
          </h3>
          <p className="text-xs sm:text-sm text-text-secondary max-w-xl mx-auto leading-relaxed">
            Upload an audited PDF balance sheet during a technical demonstration and inspect the
            cleanly formatted JSON extraction in under 30 seconds.
          </p>
          <Button variant="primary" size="lg" href="/book-a-demo" icon={ArrowRight}>
            Schedule PDF Extraction Demo
          </Button>
        </div>
      </section>
    </div>
  );
};
