import React from 'react';
import { Globe, CheckCircle2, ArrowRight, ShieldCheck, Lock, Cpu, Eye } from 'lucide-react';
import { PageHero } from '@/components/ui/PageHero';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export const BrowserAutomationPage: React.FC = () => {
  return (
    <div>
      <PageHero
        badge="Browser Helper Extension"
        breadcrumbs={[{ label: 'Automation', href: '/automation' }, { label: 'Browser Automation' }]}
        title="Secure Browser-Based Workflow Automation"
        description="Our browser helper extension eliminates tedious re-typing in web portals like MCA V3 by auto-populating validated form fields directly inside active sessions without compromising credential security."
        actions={
          <Button variant="primary" size="lg" href="/book-a-demo" icon={ArrowRight}>
            Request Extension Walkthrough
          </Button>
        }
      />

      <section className="py-20 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader
            eyebrow="Security & Architecture"
            title="Engineered for Government Web Portals"
            description="The MCA V3 portal enforces strict session timeouts and multi-layered web forms. Here is how our extension assists filing without touching private keys."
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <Card variant="default" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-blue-light text-blue-primary flex items-center justify-center mb-4">
                <Lock className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                Zero Credential Storage
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                The extension does not store government portal passwords or manage login sessions. You
                log into the MCA V3 portal using your own credentials and 2FA.
              </p>
            </Card>

            <Card variant="default" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center mb-4">
                <Cpu className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                Local-Only Payload Injection
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                The validated JSON schema prepared in your Germin8 workspace is injected directly into
                the active tab DOM. No external tracking scripts or telemetry are executed.
              </p>
            </Card>

            <Card variant="default" className="p-6">
              <div className="w-10 h-10 rounded-lg bg-purple-50 text-purple-700 flex items-center justify-center mb-4">
                <Eye className="w-5 h-5" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                Step-by-Step Field Review
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                The extension highlights pre-filled inputs in real time, allowing the compliance officer
                to review each populated tab before advancing to the final submission screen.
              </p>
            </Card>
          </div>
        </div>
      </section>

      <section className="py-20 bg-site-bg text-center">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
          <h3 className="text-2xl sm:text-3xl font-bold font-display text-navy">
            See the Extension in Action
          </h3>
          <p className="text-xs sm:text-sm text-text-secondary max-w-xl mx-auto leading-relaxed">
            Watch our compliance engineering team demonstrate a 90-second Form AOC-4 pre-fill on a
            staging MCA portal environment.
          </p>
          <Button variant="primary" size="lg" href="/book-a-demo" icon={ArrowRight}>
            Schedule Live Browser Extension Demo
          </Button>
        </div>
      </section>
    </div>
  );
};
