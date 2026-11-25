import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Mail, KeyRound, CircleCheck } from 'lucide-react';
import {
  AuthLayout,
  AuthHeading,
  Field,
  PasswordField,
  Checkbox,
  SubmitButton,
  Divider,
  SocialButtons,
} from '@/components/auth/AuthUI';

const schema = z.object({
  email: z.string().min(1, 'Enter your work email').email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
  remember: z.boolean().optional(),
});
type Values = z.infer<typeof schema>;

export const LoginPage: React.FC = () => {
  const [done, setDone] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { remember: true } });

  // Interface only: simulates a short wait, then shows the signed-in state.
  const onSubmit = async (v: Values) => {
    await new Promise((r) => setTimeout(r, 900));
    setDone(v.email);
  };

  return (
    <AuthLayout aside="signin">
      {done ? (
        <div className="text-center">
          <span className="mx-auto w-16 h-16 rounded-full bg-emerald-50 ring-8 ring-emerald-50/60 text-emerald-600 flex items-center justify-center">
            <CircleCheck className="w-8 h-8" strokeWidth={2} />
          </span>
          <h1 className="mt-6 text-[30px] font-extrabold font-display tracking-[-0.03em] text-ink-950">You’re signed in</h1>
          <p className="mt-2 text-[16px] text-ink-500">
            Signed in as <span className="font-semibold text-ink-950">{done}</span>.
          </p>
          <div className="mt-8 flex flex-col gap-3">
            <Link
              to="/"
              className="h-12 rounded-full bg-ink-950 text-white font-semibold font-display inline-flex items-center justify-center hover:bg-ink-800"
            >
              Go to the website
            </Link>
            <button type="button" onClick={() => setDone(null)} className="text-[14px] font-medium text-ink-500 hover:text-ink-950">
              Sign in with a different account
            </button>
          </div>
        </div>
      ) : (
        <>
          <AuthHeading
            title="Sign in to Germin8"
            sub={
              <>
                New here?{' '}
                <Link to="/signup" className="font-semibold text-mustard-700 hover:text-ink-950">
                  Create an account
                </Link>
              </>
            }
          />

          <SocialButtons action="Sign in" />
          <Divider label="or sign in with email" />

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
            <PasswordField
              label="Password"
              icon={KeyRound}
              autoComplete="current-password"
              placeholder="Your password"
              error={errors.password?.message}
              right={
                <Link to="/forgot-password" className="text-[13.5px] font-semibold text-mustard-700 hover:text-ink-950">
                  Forgot password?
                </Link>
              }
              {...register('password')}
            />
            <Checkbox label="Keep me signed in on this device" {...register('remember')} />
            <SubmitButton loading={isSubmitting}>Sign in</SubmitButton>
          </form>

          <p className="mt-8 text-center text-[13.5px] text-ink-500">
            Your firm uses single sign-on?{' '}
            <button type="button" className="font-semibold text-ink-950 hover:text-mustard-700">
              Sign in with SSO
            </button>
          </p>
        </>
      )}
    </AuthLayout>
  );
};
