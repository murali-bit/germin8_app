import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  User,
  Mail,
  KeyRound,
  Building2,
  Hash,
  Briefcase,
  Calculator,
  Users,
  ArrowRightLeft,
  FileCheck2,
  Database,
  ArrowLeft,
  Check,
  MailCheck,
  type LucideIcon,
} from 'lucide-react';
import {
  AuthLayout,
  AuthHeading,
  Field,
  PasswordField,
  PasswordStrength,
  PASSWORD_RULES,
  Checkbox,
  SubmitButton,
  Divider,
  SocialButtons,
} from '@/components/auth/AuthUI';
import { cn } from '@/lib/utils';

const ORG_TYPES: { value: string; label: string; icon: LucideIcon }[] = [
  { value: 'ca-firm', label: 'CA / CS firm', icon: Briefcase },
  { value: 'finance-team', label: 'Company finance team', icon: Calculator },
  { value: 'other', label: 'Something else', icon: Users },
];

const NEEDS: { value: string; label: string; note: string; icon: LucideIcon }[] = [
  { value: 'tally-zoho', label: 'Tally to Zoho Books', note: 'Migration', icon: ArrowRightLeft },
  { value: 'mca', label: 'MCA filing', note: 'AOC-4, ADT-1, MGT-7', icon: FileCheck2 },
  { value: 'enterprise', label: 'Enterprise migration', note: 'Many entities', icon: Database },
];

const schema = z
  .object({
    fullName: z.string().trim().min(2, 'Enter your full name'),
    email: z.string().min(1, 'Enter your work email').email('Enter a valid email address'),
    phone: z
      .string()
      .min(1, 'Enter your mobile number')
      .regex(/^[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number'),
    password: z
      .string()
      .min(1, 'Choose a password')
      .refine((v) => PASSWORD_RULES.every((r) => r.test(v)), 'Password does not meet all the rules below'),
    confirm: z.string().min(1, 'Type your password again'),
    orgName: z.string().trim().min(2, 'Enter your firm or company name'),
    orgType: z.string().min(1, 'Choose one'),
    teamSize: z.string().min(1, 'Choose your team size'),
    gstin: z
      .string()
      .trim()
      .toUpperCase()
      .refine((v) => v === '' || /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v), 'This GSTIN format looks wrong')
      .optional(),
    needs: z.array(z.string()).min(1, 'Pick at least one'),
    terms: z.boolean().refine((v) => v, 'Please accept the terms to continue'),
    updates: z.boolean().optional(),
  })
  .refine((d) => d.password === d.confirm, { message: 'Passwords do not match', path: ['confirm'] });

type Values = z.infer<typeof schema>;
const STEP1: (keyof Values)[] = ['fullName', 'email', 'phone', 'password', 'confirm'];

export const SignupPage: React.FC = () => {
  const [step, setStep] = useState<1 | 2>(1);
  const [doneEmail, setDoneEmail] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    trigger,
    watch,
    setValue,
    getValues,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: { needs: [], orgType: '', teamSize: '', gstin: '', terms: false, updates: false },
  });

  const password = watch('password') ?? '';
  const orgType = watch('orgType');
  const needs = watch('needs') ?? [];

  // The password match rule only runs once the whole form is valid, so check it here for step 1.
  const next = async () => {
    const ok = await trigger(STEP1);
    const { password: pw, confirm } = getValues();
    if (confirm && pw !== confirm) {
      setError('confirm', { message: 'Passwords do not match' });
      return;
    }
    if (ok) {
      setStep(2);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // Interface only: simulates a short wait, then shows the confirmation.
  const onSubmit = async (v: Values) => {
    await new Promise((r) => setTimeout(r, 1100));
    setDoneEmail(v.email);
  };

  if (doneEmail) {
    return (
      <AuthLayout aside="signup">
        <div className="text-center">
          <span className="mx-auto w-16 h-16 rounded-full bg-ink-50 ring-8 ring-ink-50/60 text-mustard-700 flex items-center justify-center">
            <MailCheck className="w-8 h-8" strokeWidth={1.75} />
          </span>
          <h1 className="mt-6 text-[30px] font-extrabold font-display tracking-[-0.03em] text-ink-950">Check your inbox</h1>
          <p className="mt-3 text-[16px] leading-relaxed text-ink-500">
            We sent a verification link to <span className="font-semibold text-ink-950">{doneEmail}</span>. Open it
            to finish setting up your workspace.
          </p>
          <div className="mt-8 rounded-2xl bg-ink-50 p-5 text-left text-[14px] text-ink-600">
            <p className="font-semibold text-ink-950">Didn’t get it?</p>
            <ul className="mt-2 space-y-1.5 list-disc pl-5">
              <li>Check your spam or promotions folder.</li>
              <li>Make sure the address above is correct.</li>
            </ul>
            <button type="button" className="mt-3 font-semibold text-mustard-700 hover:text-ink-950">
              Resend the email
            </button>
          </div>
          <Link to="/login" className="mt-8 inline-block text-[15px] font-semibold text-ink-950 hover:text-mustard-700">
            Back to sign in
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout aside="signup">
      <AuthHeading
        title="Create your account"
        sub={
          <>
            Already have one?{' '}
            <Link to="/login" className="font-semibold text-mustard-700 hover:text-ink-950">
              Sign in
            </Link>
          </>
        }
      />

      {/* Stepper */}
      <ol className="mb-8 grid grid-cols-2 gap-3" aria-label="Sign-up steps">
        {['Your details', 'Your organisation'].map((label, i) => {
          const n = (i + 1) as 1 | 2;
          const state = step > n ? 'done' : step === n ? 'current' : 'todo';
          return (
            <li key={label} aria-current={state === 'current' ? 'step' : undefined}>
              <span className={cn('block h-1.5 rounded-full', state === 'todo' ? 'bg-ink-100' : 'bg-mustard-500')} />
              <span className="mt-2 flex items-center gap-2 text-[13px]">
                <span
                  className={cn(
                    'w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center',
                    state === 'todo' ? 'bg-ink-100 text-ink-500' : 'bg-ink-950 text-white'
                  )}
                >
                  {state === 'done' ? <Check className="w-3 h-3" strokeWidth={3} /> : n}
                </span>
                <span className={state === 'todo' ? 'text-ink-500' : 'font-semibold text-ink-950'}>{label}</span>
              </span>
            </li>
          );
        })}
      </ol>

      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        {step === 1 && (
          <div className="space-y-5">
            <SocialButtons action="Sign up" />
            <Divider label="or use your email" />
            <Field label="Full name" icon={User} autoComplete="name" placeholder="Anita Rao" error={errors.fullName?.message} {...register('fullName')} />
            <Field
              label="Work email"
              icon={Mail}
              type="email"
              autoComplete="email"
              placeholder="you@firm.com"
              error={errors.email?.message}
              {...register('email')}
            />
            <Field
              label="Mobile number"
              prefix="+91"
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              maxLength={10}
              placeholder="98765 43210"
              error={errors.phone?.message}
              {...register('phone')}
            />
            <div>
              <PasswordField
                label="Password"
                icon={KeyRound}
                autoComplete="new-password"
                placeholder="Create a password"
                error={errors.password?.message}
                {...register('password')}
              />
              <PasswordStrength value={password} />
            </div>
            <PasswordField
              label="Confirm password"
              icon={KeyRound}
              autoComplete="new-password"
              placeholder="Type it again"
              error={errors.confirm?.message}
              {...register('confirm')}
            />
            <button
              type="button"
              onClick={next}
              className="w-full h-12 rounded-full bg-ink-950 hover:bg-ink-800 text-white text-[16px] font-bold font-display transition-colors"
            >
              Continue
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <Field
              label="Firm or company name"
              icon={Building2}
              autoComplete="organization"
              placeholder="Rao & Associates"
              error={errors.orgName?.message}
              {...register('orgName')}
            />

            <fieldset>
              <legend className="mb-2 text-[14px] font-semibold text-ink-900">What best describes you?</legend>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {ORG_TYPES.map((o) => {
                  const on = orgType === o.value;
                  return (
                    <label
                      key={o.value}
                      className={cn(
                        'cursor-pointer rounded-xl p-3.5 ring-1 transition-all flex sm:flex-col items-center sm:items-start gap-2.5',
                        on ? 'ring-2 ring-mustard-500 bg-ink-50' : 'ring-ink-300 hover:ring-ink-400'
                      )}
                    >
                      <input type="radio" value={o.value} className="sr-only" {...register('orgType')} />
                      <o.icon className={cn('w-5 h-5', on ? 'text-mustard-700' : 'text-ink-500')} strokeWidth={1.75} />
                      <span className="text-[13.5px] font-semibold leading-snug text-ink-950">{o.label}</span>
                    </label>
                  );
                })}
              </div>
              {errors.orgType && <p className="mt-1.5 text-[13px] text-rose-600">{errors.orgType.message}</p>}
            </fieldset>

            <div>
              <label htmlFor="teamSize" className="block mb-1.5 text-[14px] font-semibold text-ink-900">
                Team size
              </label>
              <select
                id="teamSize"
                aria-invalid={!!errors.teamSize}
                className={cn(
                  'w-full h-12 rounded-xl bg-white px-3.5 text-[15px] text-ink-950 ring-1 focus:outline-none focus:ring-2',
                  errors.teamSize ? 'ring-rose-400' : 'ring-ink-300 focus:ring-mustard-500'
                )}
                {...register('teamSize')}
              >
                <option value="">Select</option>
                <option>Just me</option>
                <option>2 to 10</option>
                <option>11 to 50</option>
                <option>51 to 200</option>
                <option>More than 200</option>
              </select>
              {errors.teamSize && <p className="mt-1.5 text-[13px] text-rose-600">{errors.teamSize.message}</p>}
            </div>

            <fieldset>
              <legend className="mb-2 text-[14px] font-semibold text-ink-900">What do you want to use Germin8 for?</legend>
              <div className="space-y-2.5">
                {NEEDS.map((n) => {
                  const on = needs.includes(n.value);
                  return (
                    <button
                      type="button"
                      key={n.value}
                      aria-pressed={on}
                      onClick={() =>
                        setValue('needs', on ? needs.filter((x) => x !== n.value) : [...needs, n.value], {
                          shouldValidate: true,
                        })
                      }
                      className={cn(
                        'w-full flex items-center gap-3 rounded-xl px-4 py-3 ring-1 text-left transition-all',
                        on ? 'ring-2 ring-mustard-500 bg-ink-50' : 'ring-ink-300 hover:ring-ink-400'
                      )}
                    >
                      <span className="w-9 h-9 rounded-full bg-white ring-1 ring-ink-200 text-mustard-700 flex items-center justify-center">
                        <n.icon className="w-4 h-4" strokeWidth={1.75} />
                      </span>
                      <span className="flex-1">
                        <span className="block text-[14.5px] font-semibold text-ink-950">{n.label}</span>
                        <span className="block text-[12.5px] text-ink-500">{n.note}</span>
                      </span>
                      <span
                        className={cn(
                          'w-5 h-5 rounded-md flex items-center justify-center',
                          on ? 'bg-ink-950 text-white' : 'ring-1 ring-ink-300 text-transparent'
                        )}
                      >
                        <Check className="w-3.5 h-3.5" strokeWidth={3} />
                      </span>
                    </button>
                  );
                })}
              </div>
              {errors.needs && <p className="mt-1.5 text-[13px] text-rose-600">{errors.needs.message}</p>}
            </fieldset>

            <Field
              label="GSTIN (optional)"
              icon={Hash}
              placeholder="27AAACA9012K1Z5"
              maxLength={15}
              className="[&_input]:uppercase"
              hint="Used to set up your organisation’s state and tax details."
              error={errors.gstin?.message}
              {...register('gstin')}
            />

            <div className="space-y-3 pt-1">
              <Checkbox
                label={
                  <>
                    I agree to the{' '}
                    <Link to="/terms-and-conditions" className="font-semibold text-ink-950 underline underline-offset-2">
                      terms
                    </Link>{' '}
                    and{' '}
                    <Link to="/privacy-policy" className="font-semibold text-ink-950 underline underline-offset-2">
                      privacy policy
                    </Link>
                    .
                  </>
                }
                error={errors.terms?.message}
                {...register('terms')}
              />
              <Checkbox label="Send me occasional product updates." {...register('updates')} />
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setStep(1);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="h-12 px-5 rounded-full ring-1 ring-ink-300 hover:ring-ink-950 text-ink-950 font-semibold font-display inline-flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>
              <div className="flex-1">
                <SubmitButton loading={isSubmitting}>Create account</SubmitButton>
              </div>
            </div>
          </div>
        )}
      </form>
    </AuthLayout>
  );
};
