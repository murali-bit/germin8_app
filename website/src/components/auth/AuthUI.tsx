import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Eye, EyeOff, ShieldCheck, Lock, UserRoundCheck, ArrowRight, type LucideIcon } from 'lucide-react';
import { Germin8Logo } from '@/components/ui/Germin8Logo';
import { cn } from '@/lib/utils';
import { AuroraGlow } from '@/components/motion/Motion';

/* ---------------------------------------------------------------------------
   Layout: form on the left, brand panel on the right (desktop only).
   --------------------------------------------------------------------------- */

export const AuthLayout: React.FC<{ children: React.ReactNode; aside?: 'signin' | 'signup' }> = ({
  children,
  aside = 'signin',
}) => (
  <div className="min-h-screen bg-white lg:grid lg:grid-cols-2">
    <div className="flex flex-col min-h-screen px-5 sm:px-10 lg:px-16 py-8">
      <div className="flex items-center justify-between">
        <Link to="/" aria-label="Germin8 home">
          <Germin8Logo size="md" />
        </Link>
        <Link to="/" className="text-[14px] font-medium text-ink-500 hover:text-ink-950">
          Back to website
        </Link>
      </div>
      <main className="flex-1 flex items-center py-12">
        <div className="w-full max-w-[440px] mx-auto">{children}</div>
      </main>
      <footer className="flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-ink-400">
        <span>© {new Date().getFullYear()} Germin8</span>
        <Link to="/privacy-policy" className="hover:text-ink-950">Privacy</Link>
        <Link to="/terms-and-conditions" className="hover:text-ink-950">Terms</Link>
        <Link to="/support" className="hover:text-ink-950">Help</Link>
      </footer>
    </div>
    <BrandPanel variant={aside} />
  </div>
);

const BrandPanel: React.FC<{ variant: 'signin' | 'signup' }> = ({ variant }) => {
  const points: { icon: LucideIcon; text: string }[] =
    variant === 'signin'
      ? [
          { icon: ShieldCheck, text: 'Trial balance proof on every migration' },
          { icon: UserRoundCheck, text: 'Reviewer sign-off before data moves' },
          { icon: Lock, text: 'Encrypted, and deleted after each job' },
        ]
      : [
          { icon: Check, text: 'Set up your workspace in a few minutes' },
          { icon: UserRoundCheck, text: 'Invite preparers and reviewers' },
          { icon: Lock, text: 'Each client kept in its own space' },
        ];
  return (
    <aside className="hidden lg:flex lg:sticky lg:top-0 lg:h-screen relative overflow-hidden bg-gradient-to-br from-ink-50 via-ink-100 to-ink-200 p-12 xl:p-16 flex-col justify-between">
      <div aria-hidden className="absolute -right-32 -top-32 w-[520px] h-[520px] rounded-full bg-white/50" />
      <AuroraGlow fade={false} />

      <div className="relative">
        <p className="font-script text-[34px] leading-none text-ink-950 -rotate-3 inline-block">
          {variant === 'signin' ? 'Welcome back.' : 'Let’s get started.'}
        </p>
        <h2 className="mt-6 max-w-md text-[38px] xl:text-[44px] font-extrabold font-display tracking-[-0.03em] leading-[1.08] text-ink-950">
          {variant === 'signin' ? 'Your migrations and filings, in one place.' : 'Move books and file MCA forms with less retyping.'}
        </h2>
        <ul className="mt-8 space-y-3.5">
          {points.map((p) => (
            <li key={p.text} className="flex items-center gap-3 text-[15.5px] text-ink-800">
              <span className="w-9 h-9 rounded-full bg-white ring-1 ring-ink-300 text-mustard-700 flex items-center justify-center">
                <p.icon className="w-4 h-4" strokeWidth={2} />
              </span>
              {p.text}
            </li>
          ))}
        </ul>
      </div>

      {/* Product preview */}
      <div className="relative mt-12 max-w-[460px]">
        <div className="rounded-2xl bg-white ring-1 ring-ink-200 shadow-[0_30px_60px_-28px_rgba(23,23,22,0.4)] p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[12px] text-ink-500">Sharma Traders · Tally to Zoho Books</p>
              <p className="text-[15px] font-bold font-display text-ink-950">Trial balance comparison</p>
            </div>
            <span className="rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 px-2.5 py-1 text-[11px] font-semibold">
              Balanced
            </span>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {[
              ['Tally', '₹ 1.33 Cr'],
              ['Zoho Books', '₹ 1.33 Cr'],
              ['Difference', '₹ 0.00'],
            ].map(([k, v], i) => (
              <div key={k} className={cn('rounded-xl px-3 py-2', i === 2 ? 'bg-emerald-50' : 'bg-ink-50')}>
                <p className="text-[11px] text-ink-500">{k}</p>
                <p className={cn('text-[14px] font-bold font-display', i === 2 ? 'text-emerald-700' : 'text-ink-950')}>{v}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="absolute -right-6 -bottom-6 flex items-center gap-2.5 rounded-full bg-ink-950 text-white pl-1.5 pr-4 py-1.5 shadow-xl">
          <span className="w-8 h-8 rounded-full bg-mustard-500 text-ink-950 text-[12px] font-bold font-display flex items-center justify-center">
            AR
          </span>
          <span className="text-[12px] leading-tight">
            <span className="block font-semibold">AOC-4 approved</span>
            <span className="block text-ink-400">A. Rao, CA</span>
          </span>
        </div>
      </div>
    </aside>
  );
};

/* ---------------------------------------------------------------------------
   Form pieces
   --------------------------------------------------------------------------- */

export const AuthHeading: React.FC<{ title: string; sub: React.ReactNode }> = ({ title, sub }) => (
  <div className="mb-8">
    <h1 className="text-[32px] sm:text-[36px] font-extrabold font-display tracking-[-0.03em] leading-tight text-ink-950">
      {title}
    </h1>
    <p className="mt-2 text-[16px] text-ink-500">{sub}</p>
  </div>
);

type FieldProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  icon?: LucideIcon;
  error?: string;
  hint?: string;
  right?: React.ReactNode;
  prefix?: string;
};

export const Field = React.forwardRef<HTMLInputElement, FieldProps>(
  ({ label, icon: Icon, error, hint, right, prefix, id, className, ...rest }, ref) => {
    const fid = id ?? rest.name;
    const describedBy = error ? `${fid}-error` : hint ? `${fid}-hint` : undefined;
    return (
      <div className={className}>
        <div className="flex items-center justify-between mb-1.5">
          <label htmlFor={fid} className="text-[14px] font-semibold text-ink-900">
            {label}
          </label>
          {right}
        </div>
        <div
          className={cn(
            'flex items-center h-12 rounded-xl bg-white ring-1 transition-shadow focus-within:ring-2',
            error ? 'ring-rose-400 focus-within:ring-rose-400' : 'ring-ink-300 focus-within:ring-mustard-500'
          )}
        >
          {Icon && <Icon className="ml-3.5 w-[18px] h-[18px] text-ink-400 shrink-0" strokeWidth={1.75} aria-hidden />}
          {prefix && (
            <span className="ml-3.5 pr-2.5 mr-0.5 border-r border-ink-200 text-[15px] text-ink-600">{prefix}</span>
          )}
          <input
            ref={ref}
            id={fid}
            aria-invalid={!!error}
            aria-describedby={describedBy}
            className="flex-1 min-w-0 h-full bg-transparent px-3 text-[15px] text-ink-950 placeholder:text-ink-400 focus:outline-none"
            {...rest}
          />
        </div>
        {error ? (
          <p id={`${fid}-error`} className="mt-1.5 text-[13px] text-rose-600">
            {error}
          </p>
        ) : hint ? (
          <p id={`${fid}-hint`} className="mt-1.5 text-[13px] text-ink-500">
            {hint}
          </p>
        ) : null}
      </div>
    );
  }
);
Field.displayName = 'Field';

/** Password input with a show/hide toggle. */
export const PasswordField = React.forwardRef<HTMLInputElement, Omit<FieldProps, 'type'>>((props, ref) => {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Field ref={ref} type={show ? 'text' : 'password'} {...props} />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-2 top-[30px] h-10 w-10 flex items-center justify-center rounded-lg text-ink-500 hover:text-ink-950"
        aria-label={show ? 'Hide password' : 'Show password'}
      >
        {show ? <EyeOff className="w-[18px] h-[18px]" /> : <Eye className="w-[18px] h-[18px]" />}
      </button>
    </div>
  );
});
PasswordField.displayName = 'PasswordField';

export const PASSWORD_RULES: { label: string; test: (v: string) => boolean }[] = [
  { label: 'At least 8 characters', test: (v) => v.length >= 8 },
  { label: 'An uppercase letter', test: (v) => /[A-Z]/.test(v) },
  { label: 'A lowercase letter', test: (v) => /[a-z]/.test(v) },
  { label: 'A number', test: (v) => /\d/.test(v) },
];

/** Strength bar and rule checklist under the password field. */
export const PasswordStrength: React.FC<{ value: string }> = ({ value }) => {
  const passed = PASSWORD_RULES.filter((r) => r.test(value)).length;
  const label = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'][passed];
  const color = ['bg-ink-200', 'bg-rose-500', 'bg-mustard-500', 'bg-mustard-500', 'bg-emerald-500'][passed];
  return (
    <div className="mt-3">
      <div className="flex gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={cn('h-1.5 flex-1 rounded-full', i < passed ? color : 'bg-ink-100')} />
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
          {PASSWORD_RULES.map((r) => {
            const ok = r.test(value);
            return (
              <li key={r.label} className={cn('flex items-center gap-1.5 text-[12.5px]', ok ? 'text-emerald-700' : 'text-ink-500')}>
                <Check className={cn('w-3.5 h-3.5', ok ? 'opacity-100' : 'opacity-30')} strokeWidth={3} />
                {r.label}
              </li>
            );
          })}
        </ul>
        {value && <span className="text-[12.5px] font-semibold text-ink-700 self-start">{label}</span>}
      </div>
    </div>
  );
};

export const Checkbox = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { label: React.ReactNode; error?: string }
>(({ label, error, id, ...rest }, ref) => {
  const fid = id ?? rest.name;
  return (
    <div>
      <label htmlFor={fid} className="flex items-start gap-3 cursor-pointer select-none">
        <input
          ref={ref}
          id={fid}
          type="checkbox"
          className="peer sr-only"
          aria-invalid={!!error}
          {...rest}
        />
        <span
          aria-hidden
          className="mt-0.5 w-5 h-5 rounded-md ring-1 ring-ink-300 bg-white flex items-center justify-center shrink-0 text-transparent peer-checked:bg-ink-950 peer-checked:ring-ink-950 peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-mustard-500"
        >
          <Check className="w-3.5 h-3.5" strokeWidth={3} />
        </span>
        <span className="text-[14px] leading-relaxed text-ink-700">{label}</span>
      </label>
      {error && <p className="mt-1.5 ml-8 text-[13px] text-rose-600">{error}</p>}
    </div>
  );
});
Checkbox.displayName = 'Checkbox';

export const SubmitButton: React.FC<{ loading?: boolean; children: React.ReactNode }> = ({ loading, children }) => (
  <button
    type="submit"
    disabled={loading}
    className="group w-full h-12 rounded-full bg-mustard-500 hover:bg-mustard-400 disabled:opacity-70 text-ink-950 text-[16px] font-bold font-display inline-flex items-center justify-center gap-2 shadow-[0_14px_28px_-14px_rgba(23,23,22,0.23)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-950 focus-visible:ring-offset-2"
  >
    {loading ? (
      <span className="w-5 h-5 border-2 border-ink-950 border-t-transparent rounded-full animate-spin" aria-label="Loading" />
    ) : (
      <>
        {children}
        <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
      </>
    )}
  </button>
);

export const Divider: React.FC<{ label: string }> = ({ label }) => (
  <div className="my-6 flex items-center gap-3 text-[13px] text-ink-400">
    <span className="h-px flex-1 bg-ink-200" />
    {label}
    <span className="h-px flex-1 bg-ink-200" />
  </div>
);

/** Google and Microsoft buttons. Marks are drawn inline; no external assets. */
export const SocialButtons: React.FC<{ action: string }> = ({ action }) => (
  <div className="grid grid-cols-2 gap-3">
    <button
      type="button"
      className="h-12 rounded-xl ring-1 ring-ink-300 bg-white hover:bg-ink-50 inline-flex items-center justify-center gap-2.5 text-[14.5px] font-semibold text-ink-950"
    >
      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
        <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
      </svg>
      {action} with Google
    </button>
    <button
      type="button"
      className="h-12 rounded-xl ring-1 ring-ink-300 bg-white hover:bg-ink-50 inline-flex items-center justify-center gap-2.5 text-[14.5px] font-semibold text-ink-950"
    >
      <svg width="17" height="17" viewBox="0 0 23 23" aria-hidden>
        <path fill="#F35325" d="M1 1h10v10H1z" />
        <path fill="#81BC06" d="M12 1h10v10H12z" />
        <path fill="#05A6F0" d="M1 12h10v10H1z" />
        <path fill="#FFBA08" d="M12 12h10v10H12z" />
      </svg>
      Microsoft
    </button>
  </div>
);
