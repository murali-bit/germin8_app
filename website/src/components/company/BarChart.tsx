import React, { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

/**
 * Single-series horizontal bar chart.
 * One hue (mustard-600, passes 3:1 against the surface), values as direct
 * labels in text ink, and a per-bar tooltip on hover and keyboard focus.
 * No legend: the card title names the series.
 */
export const BarChart: React.FC<{
  data: { label: string; value: number }[];
  unit: string;
  ariaLabel: string;
}> = ({ data, unit, ariaLabel }) => {
  const reduce = useReducedMotion();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));

  return (
    <ul className="space-y-3" role="list" aria-label={ariaLabel}>
      {data.map((d, i) => {
        const pct = (d.value / max) * 100;
        return (
          <li key={d.label} className="grid grid-cols-[minmax(90px,38%)_1fr] items-center gap-3">
            <span className="text-[13.5px] text-ink-700 truncate" title={d.label}>
              {d.label}
            </span>
            <div
              className="relative h-7 flex items-center"
              tabIndex={0}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              aria-label={`${d.label}: ${d.value} ${unit}`}
            >
              <motion.span
                className="block h-4 rounded-r-[4px] bg-mustard-600"
                style={{ opacity: hover === null || hover === i ? 1 : 0.55 }}
                initial={reduce ? false : { width: 0 }}
                whileInView={{ width: `${Math.max(pct, 3)}%` }}
                viewport={{ once: true }}
                transition={{ duration: 0.7, delay: i * 0.06, ease: [0.21, 0.47, 0.32, 0.98] }}
              />
              <span className="ml-2 text-[13px] font-semibold tabular-nums text-ink-950">{d.value}</span>

              {hover === i && (
                <span
                  role="tooltip"
                  className="pointer-events-none absolute left-0 -top-10 z-10 whitespace-nowrap rounded-lg bg-ink-950 px-3 py-1.5 text-[12px] text-ink-300 shadow-lg"
                >
                  <span className="font-semibold text-white">
                    {d.value} {unit}
                  </span>{' '}
                  · {d.label}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
};
