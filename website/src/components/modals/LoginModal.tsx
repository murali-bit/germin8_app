import React, { useState } from 'react';
import { X, Lock, Mail, ArrowRight, ShieldCheck, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({ isOpen, onClose }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [portalType, setPortalType] = useState<'ca' | 'business'>('ca');
  const [submitted, setSubmitted] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setSubmitted(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-navy to-[#292824] p-6 text-white relative">
          <button
            onClick={onClose}
            type="button"
            className="absolute top-4 right-4 p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 mb-2 text-blue-sky text-xs font-semibold tracking-wider uppercase">
            <Lock className="w-3.5 h-3.5" />
            Customer Portal
          </div>
          <h3 className="text-xl font-bold font-display text-white">Sign in to Germin8</h3>
          <p className="text-xs text-slate-300 mt-1">
            Access your migration pipelines, MCA draft batches, and reconciliation reports.
          </p>
        </div>

        {/* Portal selector */}
        <div className="flex border-b border-slate-200 bg-slate-50 p-1.5 gap-1.5">
          <button
            type="button"
            onClick={() => setPortalType('ca')}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
              portalType === 'ca'
                ? 'bg-white text-navy shadow-sm'
                : 'text-text-secondary hover:text-navy'
            }`}
          >
            CA Firm & Practice Portal
          </button>
          <button
            type="button"
            onClick={() => setPortalType('business')}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
              portalType === 'business'
                ? 'bg-white text-navy shadow-sm'
                : 'text-text-secondary hover:text-navy'
            }`}
          >
            Enterprise & Business Portal
          </button>
        </div>

        {/* Form Body */}
        <div className="p-6">
          {submitted ? (
            <div className="text-center py-6">
              <div className="w-12 h-12 bg-blue-light text-blue-primary rounded-full flex items-center justify-center mx-auto mb-4">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <h4 className="text-lg font-bold font-display text-navy mb-2">
                Authentication Required
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed mb-6">
                Active customer authentication tokens are issued upon account provisioning. If you
                have an active contract, please check your registered enterprise email for your
                direct SSO access link.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSubmitted(false);
                  onClose();
                }}
              >
                Close
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-navy mb-1.5">
                  Work Email Address
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@firm.com"
                    className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-primary/30 focus:border-blue-primary"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-navy">Password</label>
                  <a
                    href="#forgot"
                    onClick={(e) => {
                      e.preventDefault();
                      alert('Please contact your firm administrator or support@germin8.com for password reset.');
                    }}
                    className="text-xs text-blue-primary hover:underline"
                  >
                    Forgot password?
                  </a>
                </div>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-primary/30 focus:border-blue-primary"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1 text-xs text-text-secondary">
                <input
                  type="checkbox"
                  id="remember"
                  className="rounded border-slate-300 text-blue-primary focus:ring-blue-primary"
                />
                <label htmlFor="remember">Remember this device for 30 days</label>
              </div>

              <Button type="submit" variant="primary" className="w-full mt-2" icon={ArrowRight}>
                Sign In to Dashboard
              </Button>

              <div className="mt-4 pt-4 border-t border-slate-100 text-center">
                <p className="text-xs text-text-secondary">
                  New to Germin8?{' '}
                  <a
                    href="/book-a-demo"
                    onClick={onClose}
                    className="text-blue-primary font-semibold hover:underline"
                  >
                    Request organization demo
                  </a>
                </p>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
