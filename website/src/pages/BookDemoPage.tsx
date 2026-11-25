import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CalendarCheck, User, Mail, Building2, Check, CircleCheck, UserRoundCheck, type LucideIcon } from 'lucide-react';
import { PageIntro, Container } from '@/components/product/ProductBlocks';
import { Reveal } from '@/components/motion/Motion';
import { Field, SubmitButton } from '@/components/auth/AuthUI';
import { SOLUTIONS, CUSTOM_SOLUTION } from '@/data/solutions';
import { cn } from '@/lib/utils';

const ROLES = ['Startup founder or finance team', 'CA / CS firm partner or staff', 'Other'];
const TIMES = ['Morning (IST)', 'Afternoon (IST)', 'Evening (IST)'];

const TOOLS: { value: string; label: string; note: string; icon: LucideIcon }[] = [
  ...SOLUTIONS.map((s) => ({ value: s.slug, label: s.name, note: s.short, icon: s.icon })),
  { value: CUSTOM_SOLUTION.slug, label: CUSTOM_SOLUTION.name, note: CUSTOM_SOLUTION.short, icon: CUSTOM_SOLUTION.icon },
];

const STEPS = [
  {
    title: 'We start with your work',
    body: 'Tell us how the task runs today: who does it, how long it takes and where it usually goes wrong.',
  },
  {
    title: 'We show the tools you picked',
    body: 'A live walkthrough of each tool on sample data, from upload to the output your team would review.',
  },
  {
    title: 'You leave with a plain answer',
    body: 'Which piece is worth automating first, what it would involve, and whether a standard tool fits or it needs custom work.',
  },
];

const schema = z.object({
  name: z.string().trim().min(2, 'Enter your name'),
  email: z.string().min(1, 'Enter your work email').email('Enter a valid email address'),
  company: z.string().trim().min(2, 'Enter your company or firm name'),
  role: z.string().min(1, 'Choose your role'),
  tools: z.array(z.string()).min(1, 'Pick at least one'),
  time: z.string().min(1, 'Choose a time of day'),
  notes: z.string().trim().max(1000, 'Keep notes under 1000 characters').optional(),
});
type Values = z.infer<typeof schema>;

const selectClass = (hasError: boolean) =>
  cn(
    'w-full h-12 rounded-xl bg-white px-3.5 text-[15px] text-ink-950 ring-1 focus:outline-none focus:ring-2',
    hasError ? 'ring-rose-400' : 'ring-ink-300 focus:ring-mustard-500'
  );

export const BookDemoPage: React.FC = () => {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setValue,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { role: '', time: '', tools: [], notes: '' },
  });
  const tools = useWatch({ control, name: 'tools' }) ?? [];

  useEffect(() => {
    document.title = 'Book a demo · Germin8';
  }, []);

  // Interface only: simulates a short wait, then shows the requested state.
  const onSubmit = async (v: Values) => {
    await new Promise((r) => setTimeout(r, 900));
    setSentTo(v.email);
  };

  return (
    <div className="bg-white">
      <PageIntro
        eyebrow="Book a demo"
        eyebrowIcon={CalendarCheck}
        title="See the tools on a"
        accent="30-minute call"
        description="Pick the tools you want to see and a time of day that suits you. We’ll email you to fix the slot."
      />

      <Container className="pb-20 lg:pb-28">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-start">
          {/* What happens */}
          <div className="lg:col-span-5 lg:sticky lg:top-28">
            <Reveal>
              <h2 className="text-[28px] sm:text-[32px] font-extrabold font-display tracking-[-0.025em] leading-tight text-ink-950">
                What happens in the demo
              </h2>
              <p className="mt-3 text-[16px] leading-relaxed text-ink-500">
                It is a working session, not a sales pitch. Bring a real example if you have one.
              </p>
            </Reveal>
            <ol className="mt-8 space-y-4">
              {STEPS.map((s, i) => (
                <li key={s.title}>
                  <Reveal delay={i * 0.08}>
                    <div className="flex gap-4 rounded-2xl bg-white ring-1 ring-ink-200 p-5 transition-all duration-300 hover:-translate-y-1 hover:ring-ink-300 hover:shadow-[0_24px_48px_-24px_rgba(23,23,22,0.25)]">
                      <span className="w-10 h-10 rounded-full bg-mustard-500 text-ink-950 text-[15px] font-extrabold font-display flex items-center justify-center shrink-0 ring-[5px] ring-ink-50">
                        {i + 1}
                      </span>
                      <span>
                        <span className="block text-[17px] font-bold font-display text-ink-950">{s.title}</span>
                        <span className="mt-1 block text-[15px] leading-relaxed text-ink-500">{s.body}</span>
                      </span>
                    </div>
                  </Reveal>
                </li>
              ))}
            </ol>
            <Reveal>
              <div className="mt-6 flex items-start gap-3 rounded-2xl bg-ink-50 ring-1 ring-ink-200 p-5 text-[14.5px] leading-relaxed text-ink-700">
                <UserRoundCheck className="w-5 h-5 mt-0.5 shrink-0 text-mustard-700" strokeWidth={1.75} aria-hidden />
                <span>
                  Have a quick question instead?{' '}
                  <Link to="/contact" className="font-semibold text-mustard-700 hover:text-ink-950">
                    Send us a message
                  </Link>
                  .
                </span>
              </div>
            </Reveal>
          </div>

          {/* Form */}
          <Reveal className="lg:col-span-7" delay={0.1}>
            <div className="rounded-3xl bg-white ring-1 ring-ink-200 p-6 sm:p-10 shadow-[0_40px_80px_-48px_rgba(23,23,22,0.35)]">
              {sentTo ? (
                <div className="py-8 text-center">
                  <span className="mx-auto w-16 h-16 rounded-full bg-emerald-50 ring-8 ring-emerald-50/60 text-emerald-600 flex items-center justify-center">
                    <CircleCheck className="w-8 h-8" strokeWidth={2} aria-hidden />
                  </span>
                  <h2 className="mt-6 text-[28px] font-extrabold font-display tracking-[-0.03em] text-ink-950">
                    Demo requested
                  </h2>
                  <p className="mt-2 text-[16px] text-ink-500">
                    We’ll email you to confirm a time at{' '}
                    <span className="font-semibold text-ink-950 break-all">{sentTo}</span>.
                  </p>
                  <div className="mt-8 flex flex-col sm:flex-row justify-center gap-3">
                    <Link
                      to="/products"
                      className="h-12 px-6 rounded-full bg-ink-950 text-white font-semibold font-display inline-flex items-center justify-center hover:bg-ink-800"
                    >
                      Browse the tools
                    </Link>
                    <button
                      type="button"
                      onClick={() => {
                        reset();
                        setSentTo(null);
                      }}
                      className="h-12 px-6 rounded-full ring-1 ring-ink-300 text-ink-950 font-semibold font-display hover:ring-ink-950"
                    >
                      Request another demo
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <h2 className="text-[24px] font-extrabold font-display tracking-[-0.02em] text-ink-950">Request a demo</h2>
                  <p className="mt-1 text-[15px] text-ink-500">All fields are needed unless marked optional.</p>
                  <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-7 space-y-5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                      <Field
                        label="Your name"
                        icon={User}
                        autoComplete="name"
                        placeholder="Full name"
                        error={errors.name?.message}
                        {...register('name')}
                      />
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
                        label="Company or firm"
                        icon={Building2}
                        autoComplete="organization"
                        placeholder="Company name"
                        error={errors.company?.message}
                        {...register('company')}
                      />
                      <div>
                        <label htmlFor="role" className="block mb-1.5 text-[14px] font-semibold text-ink-900">
                          Your role
                        </label>
                        <select id="role" aria-invalid={!!errors.role} className={selectClass(!!errors.role)} {...register('role')}>
                          <option value="">Choose one</option>
                          {ROLES.map((r) => (
                            <option key={r}>{r}</option>
                          ))}
                        </select>
                        {errors.role && <p className="mt-1.5 text-[13px] text-rose-600">{errors.role.message}</p>}
                      </div>
                    </div>

                    <fieldset>
                      <legend className="mb-2 text-[14px] font-semibold text-ink-900">Which tools would you like to see?</legend>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {TOOLS.map((t) => {
                          const on = tools.includes(t.value);
                          return (
                            <button
                              type="button"
                              key={t.value}
                              aria-pressed={on}
                              onClick={() =>
                                setValue('tools', on ? tools.filter((x) => x !== t.value) : [...tools, t.value], {
                                  shouldValidate: true,
                                })
                              }
                              className={cn(
                                'w-full flex items-start gap-3 rounded-xl px-4 py-3 ring-1 text-left transition-all',
                                on ? 'ring-2 ring-mustard-500 bg-ink-50' : 'ring-ink-300 hover:ring-ink-400'
                              )}
                            >
                              <span className="w-9 h-9 rounded-full bg-white ring-1 ring-ink-200 text-mustard-700 flex items-center justify-center shrink-0">
                                <t.icon className="w-4 h-4" strokeWidth={1.75} aria-hidden />
                              </span>
                              <span className="flex-1 min-w-0">
                                <span className="block text-[14.5px] font-semibold text-ink-950">{t.label}</span>
                                <span className="block text-[12.5px] leading-snug text-ink-500">{t.note}</span>
                              </span>
                              <span
                                className={cn(
                                  'mt-0.5 w-5 h-5 rounded-md flex items-center justify-center shrink-0',
                                  on ? 'bg-ink-950 text-white' : 'ring-1 ring-ink-300 text-transparent'
                                )}
                              >
                                <Check className="w-3.5 h-3.5" strokeWidth={3} aria-hidden />
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      {errors.tools && <p className="mt-1.5 text-[13px] text-rose-600">{errors.tools.message}</p>}
                    </fieldset>

                    <div>
                      <label htmlFor="time" className="block mb-1.5 text-[14px] font-semibold text-ink-900">
                        Preferred time of day
                      </label>
                      <select id="time" aria-invalid={!!errors.time} className={selectClass(!!errors.time)} {...register('time')}>
                        <option value="">Choose one</option>
                        {TIMES.map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </select>
                      {errors.time && <p className="mt-1.5 text-[13px] text-rose-600">{errors.time.message}</p>}
                    </div>

                    <div>
                      <label htmlFor="notes" className="block mb-1.5 text-[14px] font-semibold text-ink-900">
                        Notes (optional)
                      </label>
                      <textarea
                        id="notes"
                        rows={4}
                        aria-invalid={!!errors.notes}
                        placeholder="Anything we should know before the call, such as the software you use today."
                        className={cn(
                          'w-full rounded-xl bg-white px-3.5 py-3 text-[15px] text-ink-950 placeholder:text-ink-400 ring-1 resize-y focus:outline-none focus:ring-2',
                          errors.notes ? 'ring-rose-400' : 'ring-ink-300 focus:ring-mustard-500'
                        )}
                        {...register('notes')}
                      />
                      {errors.notes && <p className="mt-1.5 text-[13px] text-rose-600">{errors.notes.message}</p>}
                    </div>

                    <SubmitButton loading={isSubmitting}>Request demo</SubmitButton>
                  </form>
                </>
              )}
            </div>
          </Reveal>
        </div>
      </Container>
    </div>
  );
};

export default BookDemoPage;
