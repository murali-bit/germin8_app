import React from 'react';
import heroNetworkImg from '@/assets/hero-ai-network.jpg';

export const TechNetworkGraphic: React.FC = () => {
  return (
    <div className="relative w-full max-w-lg mx-auto flex items-center justify-center p-2 select-none">
      {/* Clean Professional Hero Image */}
      <div className="relative w-full overflow-hidden rounded-2xl bg-white border border-gray-100 shadow-lg">
        <img
          src={heroNetworkImg}
          alt="Germin8 Enterprise AI Automation & Orchestration Network"
          className="w-full h-auto object-cover rounded-2xl transition-transform duration-500 hover:scale-[1.02]"
          loading="eager"
        />

        {/* Minimalist Design Badges */}
        <div className="absolute top-3 left-3 bg-white/90 backdrop-blur-md border border-gray-200/80 rounded-md px-2.5 py-1 text-[11px] font-mono text-gray-800 flex items-center gap-1.5 shadow-sm">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="font-semibold">FLOW: 100% OPTIMAL</span>
        </div>

        <div className="absolute bottom-3 right-3 bg-white/90 backdrop-blur-md border border-blue-200 rounded-md px-2.5 py-1 text-[11px] font-mono text-blue-700 font-semibold flex items-center gap-1.5 shadow-sm">
          <span>LATENCY &lt; 14ms</span>
        </div>
      </div>
    </div>
  );
};
