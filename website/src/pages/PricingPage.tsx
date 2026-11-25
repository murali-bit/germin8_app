import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, Check, Sparkles } from 'lucide-react';
import { ORG_PLAN, PRICING_PRODUCTS, type PricingProduct } from '@/data/pricing';
import { HeroNetwork } from '@/components/home/HeroNetwork';
import { cn } from '@/lib/utils';

type Period = 'weekly' | 'monthly' | 'yearly';

const PERIODS: { key: Period; label: string; per: string; note: string }[] = [
  { key: 'weekly', label: 'Weekly', per: 'week', note: 'Billed weekly' },
  { key: 'monthly', label: 'Monthly', per: 'month', note: 'Billed monthly, cancel any time' },
  { key: 'yearly', label: 'Yearly', per: 'month', note: 'Billed yearly' },
];

const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;

/** Cursor-following gold light inside a card. Updates CSS variables only. */
const useSpotlight = () => {
  const reduce = useReducedMotion();
  return reduce
    ? {}
    : {
        onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
          const r = e.currentTarget.getBoundingClientRect();
          e.currentTarget.style.setProperty('--sx', `${e.clientX - r.left}px`);
          e.currentTarget.style.setProperty('--sy', `${e.clientY - r.top}px`);
        },
      };
};

const Features: React.FC<{ items: string[]; dark?: boolean }> = ({ items, dark }) => (
  <ul className="mt-4 space-y-3">
    {items.map((f) => (
      <li key={f} className={cn('flex items-start gap-3 text-[15px]', dark ? 'text-[#FFFFFF]/80' : 'text-[#171717]/80')}>
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#C9A332]/20 text-[#C9A332]">
          <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
        </span>
        {f}
      </li>
    ))}
  </ul>
);

const Spot: React.FC<{ dark?: boolean }> = ({ dark }) => (
  <span
    aria-hidden
    className="pointer-events-none absolute inset-0 rounded-[28px] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
    style={{
      background: `radial-gradient(320px circle at var(--sx, 50%) var(--sy, 0%), rgba(201,163,50,${dark ? 0.22 : 0.16}), transparent 65%)`,
    }}
  />
);

const ProductCard: React.FC<{ p: PricingProduct; period: Period; index: number }> = ({ p, period, index }) => {
  const meta = PERIODS.find((x) => x.key === period)!;
  const price = p[period];
  const link = p.buyUrl[period];
  const spot = useSpotlight();
  const cta =
    'group/btn relative inline-flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-full bg-[#171717] font-display text-[15px] font-semibold text-[#FFFFFF] ring-1 ring-[#171717] transition-all hover:ring-[#C9A332]';

  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, delay: 0.15 + index * 0.1, ease: [0.22, 0.61, 0.36, 1] }}
      className="group relative rounded-[28px] bg-gradient-to-b from-[#C9A332]/50 via-[#171717]/10 to-[#171717]/5 p-px transition-transform duration-300 hover:-translate-y-1.5"
      {...spot}
    >
      <div className="relative flex h-full flex-col overflow-hidden rounded-[27px] bg-[#FFFFFF] p-7 shadow-[0_40px_80px_-50px_rgba(23,23,23,0.45)] sm:p-8">
        <Spot />
        <h2 className="relative font-display text-[22px] font-semibold tracking-[-0.02em] text-[#171717]">{p.name}</h2>
        <p className="relative mt-2 min-h-[44px] text-[14.5px] leading-relaxed text-[#171717]/60">{p.tagline}</p>

        <div className="relative mt-6 h-[92px]">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={period}
              initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -10, filter: 'blur(4px)' }}
              transition={{ duration: 0.22 }}
            >
              {price !== null ? (
                <>
                  <p className="flex items-baseline gap-1.5">
                    <span className="font-display text-[50px] font-semibold leading-none tracking-[-0.045em] text-[#171717]">
                      {rupees(price)}
                    </span>
                    <span className="text-[15px] text-[#171717]/50">/ {meta.per}</span>
                  </p>
                  <p className="mt-2.5 text-[13px] text-[#171717]/50">{meta.note}</p>
                </>
              ) : (
                <p className="font-display text-[32px] font-semibold tracking-[-0.03em] text-[#171717]">Contact us</p>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="relative mt-5">
          {price !== null && link ? (
            <a href={link} className={cta}>
              Buy now <ArrowRight className="h-4 w-4 text-[#C9A332] transition-transform group-hover/btn:translate-x-0.5" />
            </a>
          ) : (
            <Link to={`/book-a-demo?product=${p.slug}`} className={cta}>
              {price !== null ? 'Get started' : 'Book a demo'}
              <ArrowRight className="h-4 w-4 text-[#C9A332] transition-transform group-hover/btn:translate-x-0.5" />
            </Link>
          )}
        </div>

        <div className="relative mt-7 border-t border-[#171717]/10 pt-6">
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.2em] text-[#171717]/45">What it covers</p>
          <Features items={p.features} />
          <Link
            to={p.href}
            className="mt-7 inline-flex items-center gap-1.5 font-display text-[14px] font-semibold text-[#171717] transition-colors hover:text-[#C9A332]"
          >
            See how it works <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </motion.div>
  );
};

const OrgCard: React.FC<{ index: number }> = ({ index }) => {
  const spot = useSpotlight();
  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, delay: 0.15 + index * 0.1, ease: [0.22, 0.61, 0.36, 1] }}
      className="group relative rounded-[28px] bg-gradient-to-b from-[#C9A332] via-[#C9A332]/30 to-[#C9A332]/10 p-px transition-transform duration-300 hover:-translate-y-1.5 md:col-span-2 lg:col-span-1"
      {...spot}
    >
      <div className="relative flex h-full flex-col overflow-hidden rounded-[27px] bg-[#171717] p-7 shadow-[0_40px_80px_-40px_rgba(23,23,23,0.8)] sm:p-8">
        <Spot dark />
        <span
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(201,163,50,0.28), transparent 70%)' }}
        />
        <div className="relative flex items-center justify-between">
          <h2 className="font-display text-[22px] font-semibold tracking-[-0.02em] text-[#FFFFFF]">{ORG_PLAN.name}</h2>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#C9A332]/15 px-3 py-1 text-[11.5px] font-semibold uppercase tracking-[0.14em] text-[#C9A332]">
            <Sparkles className="h-3 w-3" aria-hidden /> Custom
          </span>
        </div>
        <p className="relative mt-2 min-h-[44px] text-[14.5px] leading-relaxed text-[#FFFFFF]/60">{ORG_PLAN.tagline}</p>

        <div className="relative mt-6 h-[92px]">
          <p className="font-display text-[50px] font-semibold leading-none tracking-[-0.045em] text-[#C9A332]">Contact us</p>
          <p className="mt-2.5 text-[13px] text-[#FFFFFF]/50">Pricing built around your team and volume</p>
        </div>

        <div className="relative mt-5">
          <Link
            to="/contact"
            className="group/btn inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#C9A332] font-display text-[15px] font-semibold text-[#171717] transition-all hover:brightness-110"
          >
            Talk to our team <ArrowRight className="h-4 w-4 transition-transform group-hover/btn:translate-x-0.5" />
          </Link>
        </div>

        <div className="relative mt-7 border-t border-[#FFFFFF]/10 pt-6">
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.2em] text-[#FFFFFF]/45">Everything, tailored</p>
          <Features items={ORG_PLAN.features} dark />
        </div>
      </div>
    </motion.div>
  );
};

export const PricingPage: React.FC = () => {
  const [period, setPeriod] = useState<Period>('monthly');

  useEffect(() => {
    document.title = 'Pricing · Germin8';
  }, []);

  return (
    <div className="relative isolate overflow-hidden bg-[#F7F6F2] pb-24 pt-32 lg:pt-40">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-20"
        style={{
          background:
            'radial-gradient(ellipse 60% 40% at 50% 12%, #FFFFFF 0%, rgba(255,255,255,0) 70%),radial-gradient(ellipse 40% 30% at 50% 0%, rgba(201,163,50,0.14), rgba(201,163,50,0) 70%)',
        }}
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[620px] opacity-70">
        <HeroNetwork className="h-full w-full" />
      </div>

      <div className="relative mx-auto max-w-[1180px] px-5 sm:px-8">
        <div className="text-center">
          <p className="inline-flex items-center gap-3 text-[12px] font-semibold uppercase tracking-[0.22em] text-[#171717]/70">
            <span aria-hidden className="h-px w-8 bg-[#C9A332]" />
            Pricing
            <span aria-hidden className="h-px w-8 bg-[#C9A332]" />
          </p>
          <h1 className="mt-6 font-display text-[42px] font-semibold leading-[1.03] tracking-[-0.04em] text-[#171717] sm:text-[64px]">
            Simple pricing.
            <br />
            <span style={{ color: '#C9A332' }}>Built to scale.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-[540px] text-[16px] leading-[1.65] text-[#171717]/70 sm:text-[17px]">
            Pick a product, pick how you pay. Switch between weekly, monthly and yearly any time.
          </p>

          <div
            role="group"
            aria-label="Billing period"
            className="relative mt-10 inline-flex rounded-full bg-[#FFFFFF]/80 p-1.5 ring-1 ring-[#171717]/10 backdrop-blur"
          >
            {PERIODS.map((x) => (
              <button
                key={x.key}
                type="button"
                onClick={() => setPeriod(x.key)}
                aria-pressed={period === x.key}
                className={cn(
                  'relative h-10 rounded-full px-5 font-display text-[14px] font-semibold transition-colors sm:px-7',
                  period === x.key ? 'text-[#FFFFFF]' : 'text-[#171717]/60 hover:text-[#171717]'
                )}
              >
                {period === x.key && (
                  <motion.span
                    layoutId="period-pill"
                    className="absolute inset-0 rounded-full bg-[#171717] shadow-[0_8px_20px_-8px_rgba(23,23,23,0.6)]"
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  />
                )}
                <span className="relative">{x.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {PRICING_PRODUCTS.map((p, i) => (
            <ProductCard key={p.slug} p={p} period={period} index={i} />
          ))}
          <OrgCard index={PRICING_PRODUCTS.length} />
        </div>

        <p className="mt-10 text-center text-[13px] text-[#171717]/50">
          Need a different plan or a custom quote?{' '}
          <Link to="/contact" className="font-semibold text-[#171717] underline decoration-[#C9A332] underline-offset-4">
            Talk to our team
          </Link>
        </p>
      </div>
    </div>
  );
};
