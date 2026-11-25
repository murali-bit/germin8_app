import React, { useState } from 'react';
import { Video, Calendar, Clock, CheckCircle2, ArrowRight, User, Play } from 'lucide-react';
import { PageHero } from '@/components/ui/PageHero';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

export const WebinarsPage: React.FC = () => {
  const [registered, setRegistered] = useState(false);
  const [email, setEmail] = useState('');

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setRegistered(true);
  };

  return (
    <div>
      <PageHero
        badge="Live & Recorded Sessions"
        breadcrumbs={[{ label: 'Resources', href: '/resources' }, { label: 'Webinars' }]}
        title="Product Webinars & Live Architecture Demonstrations"
        description="Join our engineering leads and accounting domain experts for live interactive walkthroughs, migration teardowns, and MCA compliance Q&A sessions."
      />

      {/* Featured Upcoming Webinar */}
      <section className="py-20 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader
            eyebrow="Upcoming Live Session"
            title="Mastering Tally to Zoho Books Migration: The Zero-Variance Playbook"
            description="A live 45-minute technical masterclass for Chartered Accountants, corporate controllers, and financial migration teams."
          />

          <div className="max-w-4xl mx-auto bg-slate-50 border border-slate-200 rounded-2xl p-8 sm:p-10 shadow-sm grid grid-cols-1 md:grid-cols-12 gap-8 items-center">
            <div className="md:col-span-7 space-y-4">
              <div className="flex items-center gap-2">
                <Badge variant="blue" size="sm">
                  Live Interactive Session
                </Badge>
                <span className="text-xs font-semibold text-slate-500">Free Registration</span>
              </div>

              <h3 className="text-xl sm:text-2xl font-bold font-display text-navy">
                Field Mapping, GST Normalization, and Trial Balance Verification in Practice
              </h3>

              <div className="space-y-2 text-xs text-slate-600">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-blue-primary" />
                  <span>Thursday, 28 November 2024 · 4:00 PM – 5:00 PM IST</span>
                </div>
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-blue-primary" />
                  <span>Hosted by Germin8 Migration Systems Architects & CA Advisors</span>
                </div>
              </div>

              <ul className="space-y-1.5 text-xs text-text-secondary pt-2">
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Live dry-run of a multi-year TallyPrime 4.0 export</span>
                </li>
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>How to eliminate Opening Balance Adjustment discrepancies</span>
                </li>
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Live audience Q&A on complex party GSTIN mapping</span>
                </li>
              </ul>
            </div>

            <div className="md:col-span-5 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
              {registered ? (
                <div className="text-center py-4 space-y-2">
                  <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <h4 className="font-bold text-navy text-sm font-display">Registration Confirmed</h4>
                  <p className="text-xs text-text-secondary">
                    Calendar invite and access credentials have been dispatched to your email.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleRegister} className="space-y-3">
                  <h4 className="font-bold text-navy text-sm font-display">Reserve Your Seat</h4>
                  <p className="text-xs text-slate-500">Limited to 150 practitioners per session.</p>
                  <div>
                    <label className="block text-[11px] font-semibold text-navy mb-1">Work Email</label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@firm.com"
                      className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-primary/30"
                    />
                  </div>
                  <Button type="submit" variant="primary" size="sm" className="w-full">
                    Register for Live Webinar
                  </Button>
                </form>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Recorded Technical Archives */}
      <section className="py-20 bg-site-bg border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
          <SectionHeader
            eyebrow="On-Demand Library"
            title="Recorded Architecture Walkthroughs"
            description="Access our library of on-demand technical sessions at your own pace."
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            <Card variant="default" className="p-6 space-y-4">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className="font-mono text-blue-primary font-bold">RECORDED SESSION</span>
                <span>38 min</span>
              </div>
              <h4 className="text-lg font-bold font-display text-navy">
                MCA V3 Filing Prep: Automating Form AOC-4 Financial Tables
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                Step-by-step extraction of audited Schedule III PDF balance sheets and browser extension
                pre-fill on the MCA V3 portal.
              </p>
              <Button
                variant="outline"
                size="sm"
                href="/book-a-demo"
                icon={Play}
                iconPosition="left"
                className="w-full"
              >
                Request Recording Access
              </Button>
            </Card>

            <Card variant="default" className="p-6 space-y-4">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className="font-mono text-blue-primary font-bold">RECORDED SESSION</span>
                <span>42 min</span>
              </div>
              <h4 className="text-lg font-bold font-display text-navy">
                Multi-State GST Reconciliation for Expanding Practices
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                How to align disparate tax ledgers into Zoho Books dynamic tax slabs without breaking
                GSTR-1 and GSTR-3B audit trails.
              </p>
              <Button
                variant="outline"
                size="sm"
                href="/book-a-demo"
                icon={Play}
                iconPosition="left"
                className="w-full"
              >
                Request Recording Access
              </Button>
            </Card>
          </div>
        </div>
      </section>
    </div>
  );
};
