import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowUpRight, Plus } from 'lucide-react';
import { SOLUTIONS, CUSTOM_SOLUTION } from '@/data/solutions';
import { cn } from '@/lib/utils';

/**
 * The finance function shown as small pieces. Hover a solution and the
 * pieces it automates lift out of the grid.
 */
export const FinanceMap: React.FC = () => {
  const [active, setActive] = useState<string | null>(null);

  return (
    <div>
      {/* Solution selector */}
      <div className="flex flex-wrap justify-center gap-2 mb-8">
        {SOLUTIONS.map((s) => (
          <button
            key={s.slug}
            type="button"
            onMouseEnter={() => setActive(s.slug)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(s.slug)}
            onBlur={() => setActive(null)}
            onClick={() => setActive((a) => (a === s.slug ? null : s.slug))}
            className={cn(
              'inline-flex items-center gap-2 rounded-full px-4 py-2 text-[14px] font-semibold font-display transition-all',
              active === s.slug ? 'bg-ink-950 text-white' : 'bg-white text-ink-700 ring-1 ring-ink-200 hover:ring-ink-400'
            )}
          >
            <s.icon className={cn('w-4 h-4', active === s.slug ? 'text-mustard-400' : 'text-mustard-700')} strokeWidth={1.75} />
            {s.name}
          </button>
        ))}
      </div>

      {/* Pieces */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 [perspective:1400px]">
        {SOLUTIONS.map((s) => {
          const on = active === s.slug;
          const dim = active !== null && !on;
          return (
            <div key={s.slug} className="space-y-4" onMouseEnter={() => setActive(s.slug)} onMouseLeave={() => setActive(null)}>
              {s.pieces.map((p, i) => (
                <motion.div
                  key={p.name}
                  animate={{
                    y: on ? -8 : 0,
                    rotateX: on ? 6 : 0,
                    scale: on ? 1.03 : 1,
                    opacity: dim ? 0.45 : 1,
                  }}
                  transition={{ type: 'spring', stiffness: 260, damping: 22, delay: on ? i * 0.05 : 0 }}
                  className={cn(
                    'relative rounded-2xl bg-white p-5 ring-1 transition-shadow',
                    on
                      ? 'ring-mustard-400 shadow-[0_28px_50px_-24px_rgba(23,23,22,0.23)]'
                      : 'ring-ink-200 shadow-[0_1px_0_rgba(23,23,22,0.04)]'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={cn(
                        'w-9 h-9 rounded-xl flex items-center justify-center transition-colors',
                        on ? 'bg-mustard-500 text-ink-950' : 'bg-ink-50 text-mustard-700 ring-1 ring-ink-100'
                      )}
                    >
                      <s.icon className="w-[18px] h-[18px]" strokeWidth={1.75} />
                    </span>
                    <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-400">Automated</span>
                  </div>
                  <h3 className="mt-4 text-[16px] font-bold font-display text-ink-950">{p.name}</h3>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-ink-500">{p.note}</p>
                </motion.div>
              ))}
              <Link
                to={s.href}
                className="group flex items-center justify-between rounded-2xl px-5 py-3.5 text-[14px] font-semibold font-display text-ink-950 bg-ink-50 ring-1 ring-ink-200 hover:bg-ink-100 transition-colors"
              >
                {s.name}
                <ArrowUpRight className="w-4 h-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </Link>
            </div>
          );
        })}
      </div>

      {/* Custom */}
      <Link
        to={CUSTOM_SOLUTION.href}
        className="group mt-4 flex flex-col sm:flex-row sm:items-center gap-4 rounded-2xl border-2 border-dashed border-ink-300 bg-white/70 px-6 py-5 hover:border-mustard-500 transition-colors"
      >
        <span className="w-10 h-10 rounded-xl bg-ink-950 text-mustard-400 flex items-center justify-center shrink-0">
          <Plus className="w-5 h-5" />
        </span>
        <span className="flex-1">
          <span className="block text-[16px] font-bold font-display text-ink-950">A piece that is missing here?</span>
          <span className="block text-[14px] text-ink-500">{CUSTOM_SOLUTION.short}</span>
        </span>
        <span className="inline-flex items-center gap-1.5 text-[14px] font-semibold font-display text-mustard-700 group-hover:text-ink-950">
          Custom automation
          <ArrowUpRight className="w-4 h-4" />
        </span>
      </Link>
    </div>
  );
};
