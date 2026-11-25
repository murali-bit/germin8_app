import React from 'react';
import { BrandLogo } from './StatusScreen';

/** Suspense fallback while a page loads: thin gold progress bar plus a quiet logo. */
export const RouteLoader: React.FC = () => (
  <div role="status" aria-label="Loading" className="flex min-h-[70vh] flex-col items-center justify-center bg-[#FFFFFF]">
    <style>{`
      @keyframes gbar { 0% { transform: translateX(-100%) } 100% { transform: translateX(350%) } }
      @keyframes glogo { 0%,100% { opacity: .45 } 50% { opacity: 1 } }
      @media (prefers-reduced-motion: reduce) { .g-load { animation: none !important } }
    `}</style>
    <div className="fixed inset-x-0 top-0 z-[70] h-[2px] overflow-hidden bg-[#C9A332]/15">
      <div
        className="g-load h-full w-1/3 bg-gradient-to-r from-transparent via-[#C9A332] to-transparent"
        style={{ animation: 'gbar 1.2s cubic-bezier(.4,0,.2,1) infinite' }}
      />
    </div>
    <div className="g-load" style={{ animation: 'glogo 1.6s ease-in-out infinite' }}>
      <BrandLogo />
    </div>
    <p className="mt-4 text-[13px] text-[#171717]/50">Getting things ready…</p>
  </div>
);
