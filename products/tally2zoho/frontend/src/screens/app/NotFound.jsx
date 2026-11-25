import React from 'react';
import { ArrowLeft, LayoutDashboard, SearchX } from 'lucide-react';
import { btnPrimary, btnSecondary } from '../../components/ui';
import { HOME } from '../../navigation';

// Shown for an address or a link to a page that does not exist. Never a dead end: back, or to the Dashboard.
export default function NotFound({ onNavigate, unknown }) {
  const canGoBack = typeof window !== 'undefined' && window.history.length > 1;
  return (
    <div className="p-6 md:p-8 max-w-3xl mx-auto">
      <div className="px-6 py-12 rounded-lg border border-line bg-white shadow-sm text-center">
        <span className="mx-auto mb-4 w-14 h-14 rounded-xl bg-soft-2 text-ink flex items-center justify-center">
          <SearchX className="w-6 h-6" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">This page does not exist</h1>
        <p className="text-[15px] text-muted mt-1.5 max-w-xl mx-auto">
          {unknown ? <>There is no page called <span className="font-mono text-ink break-all">{unknown}</span>. </> : null}
          The link may be old or typed wrongly. Nothing has been changed.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {canGoBack && (
            <button type="button" onClick={() => window.history.back()} className={btnSecondary}>
              <ArrowLeft className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /> Go back
            </button>
          )}
          <button type="button" onClick={() => onNavigate(HOME)} className={btnPrimary}>
            <LayoutDashboard className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /> Go to Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
