import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AuroraGlow } from '@/components/motion/Motion';

/* -------------------------------------------------------------------------
   Photos (Unsplash, free licence). Swap the ids for your own images.
   ------------------------------------------------------------------------- */
const U = (id: string, w = 1400) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=80`;

export const PHOTOS = {
  documents: U('photo-1554224155-6726b3ff858f'),
  taxForms: U('photo-1554224154-26032ffc0d07'),
  calculator: U('photo-1554224155-8d04cb21cd6c'),
  laptopData: U('photo-1542744173-05336fcc7ad4'),
  reviewDesk: U('photo-1562564055-71e051d33c19'),
  teamLaptops: U('photo-1622675363311-3e1904dc1885'),
  analyst: U('photo-1758728119257-d88284600a48'),
  reviewPair: U('photo-1551836022-d5d88e9218df'),
};

/* ---------- Layout ---------- */

export const Container: React.FC<{ className?: string; children: React.ReactNode }> = ({
  className,
  children,
}) => <div className={cn('max-w-7xl mx-auto px-5 sm:px-6 lg:px-8', className)}>{children}</div>;

export const Section: React.FC<{
  tone?: 'white' | 'paper' | 'dark';
  id?: string;
  className?: string;
  children: React.ReactNode;
}> = ({ tone = 'white', id, className, children }) => (
  <section
    id={id}
    className={cn(
      'relative overflow-hidden py-20 lg:py-28',
      tone === 'white' && 'bg-white',
      tone === 'paper' && 'bg-gradient-to-b from-paper to-white',
      tone === 'dark' && 'bg-charcoal text-white',
      className
    )}
  >
    {tone === 'paper' && (
      <>
        <div aria-hidden className="pointer-events-none absolute -right-40 -top-40 w-[560px] h-[560px] rounded-full bg-ink-100/60" />
        <div aria-hidden className="pointer-events-none absolute -left-52 -bottom-52 w-[520px] h-[520px] rounded-full bg-ink-50" />
      </>
    )}
    <Container className="relative">{children}</Container>
  </section>
);

/**
 * Standard page header for content pages: warm wash, blueprint grid,
 * pill label, headline with an optional accent phrase, and a short intro.
 */
export const PageIntro: React.FC<{
  eyebrow: string;
  eyebrowIcon?: LucideIcon;
  title: string;
  accent?: string;
  description?: React.ReactNode;
  align?: 'left' | 'center';
  children?: React.ReactNode;
}> = ({ eyebrow, eyebrowIcon, title, accent, description, align = 'center', children }) => (
  <section className="relative overflow-hidden pt-28 lg:pt-36 pb-14 lg:pb-16">
    <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-ink-50/80 to-white" />
    <AuroraGlow />
    <Container className={cn('relative', align === 'center' && 'text-center')}>
      <Eyebrow icon={eyebrowIcon}>{eyebrow}</Eyebrow>
      <h1
        className={cn(
          'mt-5 max-w-4xl text-[38px] sm:text-[54px] font-extrabold font-display tracking-[-0.03em] leading-[1.06] text-ink-950',
          align === 'center' && 'mx-auto'
        )}
      >
        {title}
        {accent && (
          <>
            {' '}
            <Accent>{accent}</Accent>
          </>
        )}
      </h1>
      {description && (
        <p className={cn('mt-6 max-w-2xl text-lg leading-relaxed text-ink-500', align === 'center' && 'mx-auto')}>
          {description}
        </p>
      )}
      {children && <div className="mt-9">{children}</div>}
    </Container>
  </section>
);

/** Hand-drawn swoosh used under accent words. */
export const Swoosh: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 300 24" fill="none" preserveAspectRatio="none" aria-hidden className={className}>
    <path d="M4 17C70 6 170 3 296 11" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
    <path d="M60 21C120 15 190 14 250 17" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity=".55" />
  </svg>
);

/** Accent words: mustard with a swoosh underneath. */
export const Accent: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="relative inline-block bg-gradient-to-r from-mustard-500 via-mustard-600 to-mustard-800 bg-clip-text text-transparent">
    {children}
    <Swoosh className="absolute left-0 -bottom-2 w-full h-3 text-mustard-500" />
  </span>
);

export const Eyebrow: React.FC<{
  children: React.ReactNode;
  invert?: boolean;
  icon?: LucideIcon;
  className?: string;
}> = ({ children, invert, icon: Icon, className }) => (
  <p
    className={cn(
      'inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[14px] font-semibold font-display',
      invert ? 'text-ink-300 ring-1 ring-white/20' : 'text-ink-950 bg-white ring-1 ring-ink-300',
      className
    )}
  >
    {Icon ? (
      <Icon className="w-4 h-4 text-mustard-600" strokeWidth={2} aria-hidden />
    ) : (
      <span className="w-1.5 h-1.5 rounded-full bg-mustard-500" />
    )}
    {children}
  </p>
);

export const SectionTitle: React.FC<{
  eyebrow?: string;
  eyebrowIcon?: LucideIcon;
  title: string;
  accent?: string;
  description?: string;
  align?: 'left' | 'center';
  invert?: boolean;
  className?: string;
}> = ({ eyebrow, eyebrowIcon, title, accent, description, align = 'left', invert, className }) => (
  <div className={cn('max-w-3xl mb-14', align === 'center' && 'mx-auto text-center', className)}>
    {eyebrow && (
      <Eyebrow invert={invert} icon={eyebrowIcon}>
        {eyebrow}
      </Eyebrow>
    )}
    <h2
      className={cn(
        'mt-5 text-[34px] sm:text-[46px] font-extrabold font-display tracking-[-0.03em] leading-[1.08]',
        invert ? 'text-white' : 'text-ink-950'
      )}
    >
      {title}
      {accent && (
        <>
          {' '}
          <Accent>{accent}</Accent>
        </>
      )}
    </h2>
    {description && (
      <p className={cn('mt-4 text-lg leading-relaxed', invert ? 'text-ink-300' : 'text-ink-500')}>
        {description}
      </p>
    )}
  </div>
);

/* ---------- Buttons and links ---------- */

export const Btn: React.FC<{
  to: string;
  variant?: 'primary' | 'secondary' | 'dark' | 'ghost-light';
  size?: 'md' | 'lg';
  arrow?: boolean;
  className?: string;
  children: React.ReactNode;
}> = ({ to, variant = 'primary', size = 'lg', arrow, className, children }) => (
  <Link
    to={to}
    className={cn(
      'group inline-flex items-center justify-center gap-2 rounded-xl font-semibold font-display transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mustard-400 focus-visible:ring-offset-2',
      size === 'lg' ? 'h-12 px-6 text-[15px]' : 'h-10 px-4 text-sm',
      variant === 'primary' && 'bg-mustard-500 text-ink-950 hover:bg-mustard-400',
      variant === 'secondary' && 'bg-white text-ink-950 border border-ink-300 hover:border-ink-950',
      variant === 'dark' && 'bg-ink-950 text-white hover:bg-ink-800',
      variant === 'ghost-light' && 'text-white border border-white/25 hover:bg-white/10',
      className
    )}
  >
    {children}
    {arrow && (
      <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
    )}
  </Link>
);

export const TextLink: React.FC<{ to: string; children: React.ReactNode; invert?: boolean }> = ({
  to,
  children,
  invert,
}) => (
  <Link
    to={to}
    className={cn(
      'group inline-flex items-center gap-1.5 text-[15px] font-semibold font-display',
      invert ? 'text-mustard-400 hover:text-ink-300' : 'text-mustard-700 hover:text-ink-950'
    )}
  >
    {children}
    <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
  </Link>
);

/* ---------- Media ---------- */

export const Photo: React.FC<{
  src: string;
  alt: string;
  className?: string;
  ratio?: string;
  eager?: boolean;
}> = ({ src, alt, className, ratio = 'aspect-[4/3]', eager }) => (
  <div className={cn('relative overflow-hidden rounded-2xl bg-ink-100', ratio, className)}>
    <img
      src={src}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      className="absolute inset-0 h-full w-full object-cover"
    />
  </div>
);

/** Soft tinted stage that product screens sit on. */
export const Stage: React.FC<{ children: React.ReactNode; className?: string; tone?: 'mustard' | 'grey' }> = ({
  children,
  className,
  tone = 'mustard',
}) => (
  <div
    className={cn(
      'relative rounded-[28px] p-4 sm:p-8 lg:p-10 overflow-hidden',
      tone === 'mustard'
        ? 'bg-gradient-to-br from-ink-50 to-ink-100'
        : 'bg-gradient-to-br from-white via-ink-50/50 to-ink-100/70 ring-1 ring-ink-100',
      className
    )}
  >
    {children}
  </div>
);

/* ---------- Hero ---------- */

export const ProductHero: React.FC<{
  eyebrow: string;
  title: string;
  description: string;
  actions: React.ReactNode;
  points?: string[];
  visual: React.ReactNode;
}> = ({ eyebrow, title, description, actions, points, visual }) => (
  <section className="bg-white pt-28 pb-16 lg:pt-36 lg:pb-24">
    <Container>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-10 items-center">
        <div className="lg:col-span-5">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1 className="mt-4 text-4xl sm:text-5xl font-extrabold font-display tracking-tight leading-[1.08] text-ink-950">
            {title}
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-ink-500">{description}</p>
          <div className="mt-8 flex flex-wrap gap-3">{actions}</div>
          {points && (
            <ul className="mt-8 space-y-2.5">
              {points.map((p) => (
                <li key={p} className="flex items-center gap-2.5 text-[15px] text-ink-700">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0" strokeWidth={2.5} aria-hidden />
                  {p}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="lg:col-span-7">{visual}</div>
      </div>
    </Container>
  </section>
);

/* ---------- Content ---------- */

export const IconBox: React.FC<{ icon: LucideIcon; invert?: boolean }> = ({ icon: Icon, invert }) => (
  <div
    className={cn(
      'w-12 h-12 rounded-full flex items-center justify-center shrink-0',
      invert ? 'bg-white/10 text-mustard-400' : 'bg-ink-50 text-mustard-700 ring-1 ring-ink-200'
    )}
  >
    <Icon className="w-5 h-5" strokeWidth={1.75} aria-hidden />
  </div>
);

export interface FeatureItem {
  icon: LucideIcon;
  title: string;
  body: string;
}

export const FeatureCards: React.FC<{ items: FeatureItem[]; cols?: 2 | 3 | 4; invert?: boolean }> = ({
  items,
  cols = 3,
  invert,
}) => (
  <div
    className={cn(
      'grid grid-cols-1 sm:grid-cols-2 gap-5',
      cols === 3 && 'lg:grid-cols-3',
      cols === 4 && 'lg:grid-cols-4'
    )}
  >
    {items.map((it) => (
      <div
        key={it.title}
        className={cn(
          'rounded-2xl p-7 transition-all duration-300',
          invert
            ? 'bg-white/5 ring-1 ring-white/10'
            : 'bg-white ring-1 ring-ink-200 hover:ring-ink-300 hover:-translate-y-1 hover:shadow-[0_24px_48px_-24px_rgba(23,23,22,0.25)]'
        )}
      >
        <IconBox icon={it.icon} invert={invert} />
        <h3 className={cn('mt-5 text-lg font-bold font-display', invert ? 'text-white' : 'text-ink-950')}>
          {it.title}
        </h3>
        <p className={cn('mt-2 text-[15px] leading-relaxed', invert ? 'text-ink-300' : 'text-ink-500')}>
          {it.body}
        </p>
      </div>
    ))}
  </div>
);

/** Text on one side, a picture of the feature on the other. */
export type Bullet = string | { icon: LucideIcon; text: string };

export const FeatureRow: React.FC<{
  eyebrow?: string;
  eyebrowIcon?: LucideIcon;
  title: string;
  body: React.ReactNode;
  bullets?: Bullet[];
  visual: React.ReactNode;
  reverse?: boolean;
  link?: { to: string; label: string };
}> = ({ eyebrow, eyebrowIcon: EIcon, title, body, bullets, visual, reverse, link }) => (
  <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16 items-center">
    <div className={cn('lg:col-span-5', reverse && 'lg:order-2')}>
      {eyebrow && (
        <span className="inline-flex items-center gap-2.5 rounded-xl bg-ink-50 ring-1 ring-ink-100 pl-2.5 pr-4 py-2 text-[15px] font-semibold font-display text-ink-950">
          {EIcon && <EIcon className="w-[18px] h-[18px] text-ink-700" strokeWidth={1.75} aria-hidden />}
          {eyebrow}
        </span>
      )}
      <h3 className="mt-5 text-[28px] sm:text-[34px] font-extrabold font-display tracking-[-0.025em] leading-[1.12] text-ink-950">
        {title}
      </h3>
      <div className="mt-4 text-[17px] leading-relaxed text-ink-500 space-y-4">{body}</div>
      {bullets && (
        <ul className="mt-6 space-y-3">
          {bullets.map((b) => {
            const Icon = typeof b === 'string' ? Check : b.icon;
            const text = typeof b === 'string' ? b : b.text;
            return (
              <li key={text} className="flex items-center gap-3.5 text-[15.5px] text-ink-700">
                <span className="w-9 h-9 rounded-full bg-ink-50 ring-1 ring-ink-100 text-mustard-700 flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4" strokeWidth={2.25} aria-hidden />
                </span>
                {text}
              </li>
            );
          })}
        </ul>
      )}
      {link && (
        <div className="mt-8">
          <Link
            to={link.to}
            className="group inline-flex items-center gap-2 h-12 px-6 rounded-full bg-mustard-500 hover:bg-mustard-400 text-ink-950 text-[15px] font-bold font-display shadow-[0_12px_26px_-12px_rgba(23,23,22,0.23)] transition-colors"
          >
            {link.label}
            <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
        </div>
      )}
    </div>
    <div className={cn('lg:col-span-7', reverse && 'lg:order-1')}>{visual}</div>
  </div>
);

export interface StepItem {
  title: string;
  body: string;
}

export const Steps: React.FC<{ steps: StepItem[]; invert?: boolean }> = ({ steps, invert }) => (
  <ol className="relative grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
    {steps.length === 3 && (
      <span
        aria-hidden
        className="hidden lg:block absolute left-[16%] right-[16%] top-[52px] border-t-2 border-dashed border-ink-300"
      />
    )}
    {steps.map((s, i) => (
      <li
        key={s.title}
        className={cn(
          'relative rounded-2xl p-7 transition-all duration-300',
          invert
            ? 'bg-white/5 ring-1 ring-white/10'
            : 'bg-white ring-1 ring-ink-200 hover:ring-ink-300 hover:shadow-[0_24px_48px_-24px_rgba(23,23,22,0.25)]'
        )}
      >
        <span className="relative z-10 inline-flex w-12 h-12 rounded-full bg-mustard-500 text-ink-950 text-[17px] font-extrabold font-display items-center justify-center ring-[6px] ring-ink-50 shadow-[0_10px_20px_-10px_rgba(23,23,22,0.23)]">
          {i + 1}
        </span>
        <h3 className={cn('mt-4 text-lg font-bold font-display', invert ? 'text-white' : 'text-ink-950')}>
          {s.title}
        </h3>
        <p className={cn('mt-2 text-[15px] leading-relaxed', invert ? 'text-ink-300' : 'text-ink-500')}>
          {s.body}
        </p>
      </li>
    ))}
  </ol>
);

/** Grouped checklists covering every feature. */
export const FeatureList: React.FC<{ groups: { title: string; icon: LucideIcon; items: string[] }[] }> = ({
  groups,
}) => (
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
    {groups.map((g) => (
      <div key={g.title} className="rounded-2xl bg-white ring-1 ring-ink-200 p-6">
        <div className="flex items-center gap-3">
          <IconBox icon={g.icon} />
          <h3 className="text-lg font-bold font-display text-ink-950">{g.title}</h3>
        </div>
        <ul className="mt-5 space-y-3">
          {g.items.map((t) => (
            <li key={t} className="flex items-start gap-2.5 text-[15px] text-ink-700">
              <Check className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" strokeWidth={2.5} aria-hidden />
              {t}
            </li>
          ))}
        </ul>
      </div>
    ))}
  </div>
);

export const Callout: React.FC<{ icon: LucideIcon; title: string; children: React.ReactNode }> = ({
  icon,
  title,
  children,
}) => (
  <div className="flex flex-col sm:flex-row gap-4 rounded-2xl bg-ink-50 ring-1 ring-ink-200 p-6">
    <IconBox icon={icon} />
    <div>
      <h3 className="text-base font-bold font-display text-ink-950">{title}</h3>
      <p className="mt-1.5 text-[15px] leading-relaxed text-ink-700">{children}</p>
    </div>
  </div>
);

export const FinalCTA: React.FC<{
  title: string;
  description: string;
  primary: { to: string; label: string };
  secondary?: { to: string; label: string };
}> = ({ title, description, primary, secondary }) => (
  <section className="bg-white py-20 lg:py-24">
    <Container>
      <div className="relative overflow-hidden rounded-3xl bg-white ring-1 ring-ink-200 px-6 py-14 sm:px-14 sm:py-16">
        <div aria-hidden className="absolute left-0 top-0 h-full w-1.5 bg-mustard-500" />
        <div className="relative grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-8">
            <h2 className="text-3xl sm:text-4xl font-bold font-display tracking-tight text-ink-950">{title}</h2>
            <p className="mt-4 text-lg text-ink-500 max-w-2xl">{description}</p>
          </div>
          <div className="lg:col-span-4 flex flex-wrap lg:justify-end gap-3">
            <Btn to={primary.to} arrow>
              {primary.label}
            </Btn>
            {secondary && (
              <Btn to={secondary.to} variant="secondary">
                {secondary.label}
              </Btn>
            )}
          </div>
        </div>
      </div>
    </Container>
  </section>
);
