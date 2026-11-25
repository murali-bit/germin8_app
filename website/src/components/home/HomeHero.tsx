import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ArrowRight,
  AppWindow,
  BookOpen,
  Cloud,
  FileSpreadsheet,
  Landmark,
  type LucideIcon,
} from 'lucide-react';
import { HomeNav } from './HomeNav';

/** Genuine tools Germin works with. Monochrome, no customer claims. */
const WORKS_WITH: { icon: LucideIcon; name: string }[] = [
  { icon: BookOpen, name: 'TallyPrime' },
  { icon: BookOpen, name: 'Tally.ERP 9' },
  { icon: Cloud, name: 'Zoho Books' },
  { icon: Landmark, name: 'MCA V3 portal' },
  { icon: FileSpreadsheet, name: 'Excel' },
  { icon: AppWindow, name: 'Google Chrome' },
  { icon: AppWindow, name: 'Microsoft Edge' },
];

const KEYWORDS = ['Books migration', 'Compliance tracking', 'ROC filing', 'Reconciliation', 'Financial statements'];

const Word: React.FC<{ children: React.ReactNode; i: number; reduce: boolean | null }> = ({ children, i, reduce }) => (
  <span className="inline-block overflow-hidden align-bottom pb-[0.08em]">
    <motion.span
      className="inline-block"
      initial={reduce ? false : { y: '110%', opacity: 0, filter: 'blur(8px)' }}
      animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
      transition={{ duration: 0.9, delay: 0.15 + i * 0.09, ease: [0.22, 0.61, 0.36, 1] }}
    >
      {children}
    </motion.span>
  </span>
);

export const HomeHero: React.FC = () => {
  const reduce = useReducedMotion();
  const [kw, setKw] = useState(0);

  const up = (delay: number) => ({
    initial: reduce ? false : ({ opacity: 0, y: 18 } as const),
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.8, delay, ease: [0.22, 0.61, 0.36, 1] as const },
  });

  useEffect(() => {
    if (reduce) return;
    const id = window.setInterval(() => setKw((k) => (k + 1) % KEYWORDS.length), 2200);
    return () => window.clearInterval(id);
  }, [reduce]);

  return (
    <section className="relative isolate flex min-h-[100svh] flex-col overflow-hidden bg-[#FFFFFF]">
      <HomeNav />

      {/* Content */}
      <div className="relative flex flex-1 flex-col items-center justify-center px-5 pt-28 pb-16 text-center sm:px-8">
        <motion.p
          {...up(0.05)}
          className="inline-flex items-center gap-3 text-[11.5px] sm:text-[12.5px] font-semibold uppercase tracking-[0.22em] text-[#171717]/70"
        >
          <span aria-hidden className="h-px w-8 bg-[#C9A332]" />
          A next-generation financial technology company
          <span aria-hidden className="h-px w-8 bg-[#C9A332]" />
        </motion.p>

        <h1 className="mt-7 font-display font-semibold tracking-[-0.04em] leading-[1.02] text-[#171717] text-[44px] sm:text-[68px] lg:text-[88px]">
          <span className="block">
            <Word i={0} reduce={reduce}>Intelligent</Word> <Word i={1} reduce={reduce}>technology.</Word>
          </span>
          <span className="block">
            <Word i={2} reduce={reduce}>Built</Word> <Word i={3} reduce={reduce}>for</Word>{' '}
            <Word i={4} reduce={reduce}>
              <span className="text-[#C9A332]">
                business
              </span>
            </Word>
            <Word i={5} reduce={reduce}>.</Word>
          </span>
        </h1>

        <motion.p
          {...up(0.28)}
          className="mt-8 max-w-[640px] text-[16px] sm:text-[18px] leading-[1.65] text-[#171717]/70"
        >
          Germin combines intelligent software, automation, and financial technology to simplify complex business
          operations and help companies scale with confidence.
        </motion.p>

        {/* Rotating capability ticker */}
        <motion.div
          {...up(0.34)}
          className="mt-6 flex items-center gap-2.5 rounded-full bg-[#FFFFFF]/80 px-4 py-2 ring-1 ring-[#171717]/10 backdrop-blur"
        >
          <span className="relative flex h-2 w-2">
            <span className="relative h-2 w-2 rounded-full bg-[#C9A332]" />
          </span>
          <span className="text-[12.5px] font-medium text-[#171717]/55">Automating</span>
          <span className="relative inline-block h-5 w-[150px] overflow-hidden text-left text-[13px] font-semibold text-[#171717]">
            {KEYWORDS.map((k, i) => (
              <span
                key={k}
                className="absolute inset-0 transition-all duration-500"
                style={{ opacity: i === kw ? 1 : 0, transform: `translateY(${i === kw ? 0 : i < kw ? -100 : 100}%)` }}
              >
                {k}
              </span>
            ))}
          </span>
        </motion.div>

        <motion.div {...up(0.42)} className="mt-8 flex w-full flex-col items-center justify-center gap-3 sm:w-auto sm:flex-row">
          <Link
            to="/products"
            className="group relative inline-flex h-14 w-full sm:w-auto items-center justify-center gap-2.5 overflow-hidden rounded-full bg-[#171717] px-8 font-display text-[15px] font-semibold text-[#FFFFFF] ring-1 ring-[#171717] transition-all hover:-translate-y-0.5 hover:ring-[#C9A332]"
          >
            <span className="relative">Explore our solutions</span>
            <ArrowRight className="relative h-4 w-4 text-[#C9A332] transition-transform group-hover:translate-x-0.5" />
          </Link>
          <Link
            to="/contact"
            className="inline-flex h-14 w-full sm:w-auto items-center justify-center rounded-full bg-[#FFFFFF]/80 px-8 font-display text-[15px] font-semibold text-[#171717] ring-1 ring-[#171717]/20 backdrop-blur transition-all hover:-translate-y-0.5 hover:ring-[#171717]"
          >
            Talk to our team
          </Link>
        </motion.div>
      </div>

      {/* Trust strip */}
      <motion.div {...up(0.55)} className="relative border-t border-[#171717]/10 bg-[#FFFFFF]/70 backdrop-blur-sm">
        <div className="mx-auto max-w-[1360px] px-5 py-6 sm:px-8">
          <p className="text-center text-[11px] font-semibold uppercase tracking-[0.22em] text-[#171717]/50">
            Works with the tools you already use
          </p>
          <ul className="mt-4 flex flex-wrap items-center justify-center gap-y-3">
            {WORKS_WITH.map((w, i) => (
              <li
                key={w.name}
                className={`flex items-center gap-2 px-5 text-[14.5px] font-semibold font-display text-[#171717]/55 whitespace-nowrap ${
                  i > 0 ? 'sm:border-l sm:border-[#171717]/12' : ''
                }`}
              >
                <w.icon className="h-[18px] w-[18px]" strokeWidth={1.6} />
                {w.name}
              </li>
            ))}
          </ul>
        </div>
      </motion.div>
    </section>
  );
};
