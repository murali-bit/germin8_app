import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  MessageSquare,
  User,
  Mail,
  Building2,
  Phone,
  CircleCheck,
  CalendarCheck,
  BookOpen,
  LifeBuoy,
  Database,
  ArrowUpRight,
  ShieldAlert,
} from 'lucide-react';
import { PageIntro, Container } from '@/components/product/ProductBlocks';
import { Reveal, TiltCard } from '@/components/motion/Motion';
import { Field, SubmitButton } from '@/components/auth/AuthUI';
import { SOLUTIONS, CUSTOM_SOLUTION } from '@/data/solutions';
import { cn } from '@/lib/utils';

const NEED_OPTIONS = [
  ...SOLUTIONS.map((s) => s.name),
  CUSTOM_SOLUTION.name,
  'Company database',
  'Something else',
];

const schema = z.object({
  name: z.string().trim().min(2, 'Enter your name'),
  email: z.string().min(1, 'Enter your work email').email('Enter a valid email address'),
  company: z.string().trim().min(2, 'Enter your company or firm name'),
  phone: z
    .string()
    .trim()
    .refine((v) => v === '' || /^[+\d][\d\s-]{7,15}$/.test(v), 'This phone number looks wrong')
    .optional(),
  need: z.string().min(1, 'Choose what you need'),
  message: z.string().trim().min(10, 'Tell us a little more, in a sentence or two'),
});
type Values = z.infer<typeof schema>;

const WAYS: { icon: typeof Mail; title: string; body: string; to: string; label: string }[] = [
  {
    icon: CalendarCheck,
    title: 'See the tools first',
    body: 'A 30-minute walkthrough of the tools you pick, on a call.',
    to: '/book-a-demo',
    label: 'Book a demo',
  },
  {
    icon: LifeBuoy,
    title: 'Already using Germin8?',
    body: 'Guides, documentation and answers to common questions.',
    to: '/support',
    label: 'Go to support',
  },
  {
    icon: BookOpen,
    title: 'Common questions',
    body: 'Short answers to the questions people ask us most.',
    to: '/faq',
    label: 'Read the FAQ',
  },
  {
    icon: Database,
    title: 'Looking up a company?',
    body: 'Our company and director database is free to search.',
    to: '/companies',
    label: 'Search companies',
  },
];

export const ContactPage: React.FC = () => {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { need: '', phone: '' } });

  useEffect(() => {
    document.title = 'Contact · Germin8';
  }, []);

  // Interface only: simulates a short wait, then shows the sent state.
  const onSubmit = async (v: Values) => {
    await new Promise((r) => setTimeout(r, 900));
    setSentTo(v.email);
  };

  return (
    <div className="bg-white">
      <PageIntro
        eyebrow="Contact"
        eyebrowIcon={MessageSquare}
        title="Tell us what you"
        accent="need"
        description="A question about a tool, a task you want automated, or something you are not sure about. Use the form and we’ll reply by email."
      />

      <Container className="pb-20 lg:pb-28">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-start">
          {/* Form */}
          <Reveal className="lg:col-span-7">
            <div className="rounded-3xl bg-white ring-1 ring-ink-200 p-6 sm:p-10 shadow-[0_40px_80px_-48px_rgba(23,23,22,0.35)]">
              {sentTo ? (
                <div className="py-8 text-center">
                  <span className="mx-auto w-16 h-16 rounded-full bg-emerald-50 ring-8 ring-emerald-50/60 text-emerald-600 flex items-center justify-center">
                    <CircleCheck className="w-8 h-8" strokeWidth={2} aria-hidden />
                  </span>
                  <h2 className="mt-6 text-[28px] font-extrabold font-display tracking-[-0.03em] text-ink-950">
                    Thanks, your message is with us
                  </h2>
                  <p className="mt-2 text-[16px] text-ink-500">
                    We’ll reply to <span className="font-semibold text-ink-950 break-all">{sentTo}</span>.
                  </p>
                  <div className="mt-8 flex flex-col sm:flex-row justify-center gap-3">
                    <Link
                      to="/"
                      className="h-12 px-6 rounded-full bg-ink-950 text-white font-semibold font-display inline-flex items-center justify-center hover:bg-ink-800"
                    >
                      Back to the website
                    </Link>
                    <button
                      type="button"
                      onClick={() => {
                        reset();
                        setSentTo(null);
                      }}
                      className="h-12 px-6 rounded-full ring-1 ring-ink-300 text-ink-950 font-semibold font-display hover:ring-ink-950"
                    >
                      Send another message
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <h2 className="text-[24px] font-extrabold font-display tracking-[-0.02em] text-ink-950">Send us a message</h2>
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
                      <Field
                        label="Phone (optional)"
                        icon={Phone}
                        type="tel"
                        autoComplete="tel"
                        placeholder="Mobile number"
                        error={errors.phone?.message}
                        {...register('phone')}
                      />
                    </div>

                    <div>
                      <label htmlFor="need" className="block mb-1.5 text-[14px] font-semibold text-ink-900">
                        What do you need?
                      </label>
                      <select
                        id="need"
                        aria-invalid={!!errors.need}
                        className={cn(
                          'w-full h-12 rounded-xl bg-white px-3.5 text-[15px] text-ink-950 ring-1 focus:outline-none focus:ring-2',
                          errors.need ? 'ring-rose-400' : 'ring-ink-300 focus:ring-mustard-500'
                        )}
                        {...register('need')}
                      >
                        <option value="">Choose one</option>
                        {NEED_OPTIONS.map((o) => (
                          <option key={o}>{o}</option>
                        ))}
                      </select>
                      {errors.need && <p className="mt-1.5 text-[13px] text-rose-600">{errors.need.message}</p>}
                    </div>

                    <div>
                      <label htmlFor="message" className="block mb-1.5 text-[14px] font-semibold text-ink-900">
                        Message
                      </label>
                      <textarea
                        id="message"
                        rows={5}
                        aria-invalid={!!errors.message}
                        placeholder="What do you do today, and what would you like to change?"
                        className={cn(
                          'w-full rounded-xl bg-white px-3.5 py-3 text-[15px] text-ink-950 placeholder:text-ink-400 ring-1 resize-y focus:outline-none focus:ring-2',
                          errors.message ? 'ring-rose-400' : 'ring-ink-300 focus:ring-mustard-500'
                        )}
                        {...register('message')}
                      />
                      {errors.message && <p className="mt-1.5 text-[13px] text-rose-600">{errors.message.message}</p>}
                    </div>

                    <SubmitButton loading={isSubmitting}>Send message</SubmitButton>
                    <p className="text-center text-[13px] text-ink-500">
                      We use these details only to reply to you. See our{' '}
                      <Link to="/privacy-policy" className="font-semibold text-mustard-700 hover:text-ink-950">
                        privacy policy
                      </Link>
                      .
                    </p>
                  </form>
                </>
              )}
            </div>
          </Reveal>

          {/* Side panel */}
          <aside className="lg:col-span-5 space-y-4 [perspective:1400px]">
            <Reveal>
              <div className="rounded-2xl bg-ink-50 ring-1 ring-ink-200 p-6">
                <h2 className="text-[18px] font-extrabold font-display text-ink-950">Other ways to reach us</h2>
                <p className="mt-1.5 text-[15px] leading-relaxed text-ink-700">
                  Use the form and we’ll reply by email. If one of these fits better, start there instead.
                </p>
              </div>
            </Reveal>
            {WAYS.map((w, i) => (
              <Reveal key={w.title} delay={i * 0.06}>
                <TiltCard max={4}>
                  <Link
                    to={w.to}
                    className="group flex items-start gap-4 rounded-2xl bg-white ring-1 ring-ink-200 p-5 transition-shadow duration-300 hover:ring-ink-300 hover:shadow-[0_30px_60px_-30px_rgba(23,23,22,0.35)]"
                    style={{ transformStyle: 'preserve-3d' }}
                  >
                    <span
                      className="w-11 h-11 rounded-xl bg-ink-950 text-mustard-400 flex items-center justify-center shrink-0"
                      style={{ transform: 'translateZ(24px)' }}
                    >
                      <w.icon className="w-5 h-5" strokeWidth={1.6} aria-hidden />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[16px] font-bold font-display text-ink-950">{w.title}</span>
                      <span className="mt-0.5 block text-[14.5px] leading-relaxed text-ink-500">{w.body}</span>
                      <span className="mt-2 inline-flex items-center gap-1 text-[14px] font-semibold font-display text-mustard-700 group-hover:text-ink-950">
                        {w.label}
                        <ArrowUpRight className="w-4 h-4" aria-hidden />
                      </span>
                    </span>
                  </Link>
                </TiltCard>
              </Reveal>
            ))}
            <Reveal>
              <Link
                to="/security"
                className="flex items-center gap-3 rounded-2xl ring-1 ring-ink-200 px-5 py-4 text-[14.5px] text-ink-700 hover:ring-ink-400 transition-colors"
              >
                <ShieldAlert className="w-5 h-5 shrink-0 text-mustard-700" strokeWidth={1.75} aria-hidden />
                <span>
                  Found a security issue? Read how we handle data, then tell us using this form with{' '}
                  <span className="font-semibold text-ink-950">Something else</span> selected.
                </span>
              </Link>
            </Reveal>
          </aside>
        </div>
      </Container>
    </div>
  );
};
