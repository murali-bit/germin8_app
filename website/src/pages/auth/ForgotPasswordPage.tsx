import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Mail, ArrowLeft, MailCheck } from 'lucide-react';
import { AuthLayout, AuthHeading, Field, SubmitButton } from '@/components/auth/AuthUI';

const schema = z.object({
  email: z.string().min(1, 'Enter your work email').email('Enter a valid email address'),
});
type Values = z.infer<typeof schema>;

export const ForgotPasswordPage: React.FC = () => {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  // Interface only: simulates a short wait, then shows the confirmation.
  const onSubmit = async (v: Values) => {
    await new Promise((r) => setTimeout(r, 900));
    setSentTo(v.email);
  };

  return (
    <AuthLayout aside="signin">
      <Link to="/login" className="mb-8 inline-flex items-center gap-1.5 text-[14px] font-semibold text-ink-500 hover:text-ink-950">
        <ArrowLeft className="w-4 h-4" />
        Back to sign in
      </Link>

      {sentTo ? (
        <div>
          <span className="w-14 h-14 rounded-full bg-ink-50 ring-8 ring-ink-50/60 text-mustard-700 flex items-center justify-center">
            <MailCheck className="w-7 h-7" strokeWidth={1.75} />
          </span>
          <h1 className="mt-6 text-[30px] font-extrabold font-display tracking-[-0.03em] text-ink-950">Check your email</h1>
          <p className="mt-3 text-[16px] leading-relaxed text-ink-500">
            If <span className="font-semibold text-ink-950">{sentTo}</span> has a Germin8 account, you’ll get a link to
            reset your password. The link works for 30 minutes.
          </p>
          <button
            type="button"
            onClick={() => setSentTo(null)}
            className="mt-8 text-[15px] font-semibold text-mustard-700 hover:text-ink-950"
          >
            Use a different email
          </button>
        </div>
      ) : (
        <>
          <AuthHeading
            title="Reset your password"
            sub="Enter the email you use for Germin8 and we’ll send you a reset link."
          />
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
            <Field
              label="Work email"
              icon={Mail}
              type="email"
              autoComplete="email"
              placeholder="you@firm.com"
              error={errors.email?.message}
              {...register('email')}
            />
            <SubmitButton loading={isSubmitting}>Send reset link</SubmitButton>
          </form>
        </>
      )}
    </AuthLayout>
  );
};
