import React, { useState } from 'react';
import { ArrowRight, Check, CircleHelp, Eye, EyeOff, Lock, Mail, ShieldCheck, Zap } from 'lucide-react';
import { api } from '../api';

const FEATURES = [
  { Icon: ShieldCheck, title: 'Secure & Reliable', text: 'Role-based access and a full audit trail' },
  { Icon: Zap, title: 'Fast & Efficient', text: 'Guided steps from TallyPrime to Zoho Books' },
  { Icon: Check, title: 'Built for Professionals', text: 'Source values are never changed silently' },
];

const MESSAGES = {
  google: 'Google sign-in is not set up yet. Please sign in with your email and password.',
  microsoft: 'Microsoft sign-in is not set up yet. Please sign in with your email and password.',
  forgot: 'Password reset is not built yet. Ask your firm administrator to create a new account for you.',
  create: 'Accounts are created by your firm administrator. Ask them to add you under Users and Roles.',
  help: 'Sign in with the email and password your firm administrator gave you. Test accounts are listed in the file seed-users.json in the server folder.',
};

export default function Login({ onSignedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async e => {
    e.preventDefault();
    setBusy(true); setError(''); setInfo('');
    try {
      await api.post('/auth/login', { email, password });
      await onSignedIn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const notice = key => { setError(''); setInfo(MESSAGES[key]); };

  const field = 'w-full h-11 bg-white border border-line-strong rounded-md pl-11 text-[15px] text-ink placeholder:text-subtle focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30';

  return (
    <div className="min-h-screen flex bg-page text-ink">
      {/* Left panel */}
      <aside className="hidden lg:flex relative w-1/2 max-w-[840px] flex-col overflow-hidden bg-nav text-white px-16 pt-14 pb-10">
        <div className="absolute -top-40 -right-40 w-[520px] h-[520px] rounded-full bg-nav-2" aria-hidden="true" />
        <div className="relative z-10 flex items-center gap-4">
          <svg viewBox="0 0 48 44" className="w-11 h-10" aria-hidden="true"><path d="M24 2 4 42h9.5L24 20l10.5 22H44L24 2Z" fill="#408dfb" /><path d="M20 42 30 42 25 32Z" fill="#ffffff" /></svg>
          <div className="leading-tight">
            <div className="text-[22px] font-semibold tracking-tight text-white">Accounting<br />Migration</div>
            <div className="text-[13px] text-nav-text mt-1">TallyPrime to Zoho Books</div>
          </div>
        </div>

        <div className="relative z-10 mt-24">
          <h2 className="text-[40px] leading-[1.15] font-semibold tracking-tight text-white">Seamless Migration.<br />Simplified Accounting.</h2>
          <p className="mt-5 text-[18px] leading-snug text-nav-text max-w-md">Migrate your accounting data with accuracy and a clear record of every step.</p>
          <ul className="mt-12 space-y-5">
            {FEATURES.map(({ Icon, title, text }) => (
              <li key={title} className="flex items-center gap-4">
                <span className="w-11 h-11 rounded-md bg-nav-2 text-brand flex items-center justify-center shrink-0"><Icon className="w-5 h-5" strokeWidth={1.75} aria-hidden="true" /></span>
                <span><span className="block text-[16px] font-semibold text-white">{title}</span><span className="block text-[14px] text-nav-text">{text}</span></span>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* Right panel */}
      <main className="flex-1 flex flex-col px-6 sm:px-12 lg:px-20 py-8">
        <div className="flex justify-end">
          <button type="button" onClick={() => notice('help')} className="inline-flex items-center gap-2 rounded-md border border-line-strong bg-white px-3.5 py-2 text-[14px] font-medium text-ink hover:bg-soft">
            <CircleHelp className="w-4 h-4" /> Need Help?
          </button>
        </div>

        <div className="flex-1 flex items-center">
          <form onSubmit={submit} className="w-full max-w-[615px] mx-auto lg:mx-0 lg:ml-[8%]" noValidate={false}>
            <div className="lg:hidden flex items-center gap-3 mb-8">
              <svg viewBox="0 0 48 44" className="w-9 h-8" aria-hidden="true"><path d="M24 2 4 42h9.5L24 20l10.5 22H44L24 2Z" fill="#408dfb" /></svg>
              <span className="text-[18px] font-semibold">Accounting Migration</span>
            </div>

            <h1 className="text-[32px] leading-tight font-semibold tracking-tight">Welcome Back</h1>
            <p className="mt-2 text-[16px] text-muted">Sign in to continue to your Accounting Migration account</p>

            <div className="mt-8 space-y-5">
              <label className="block">
                <span className="block text-[14px] font-medium mb-1.5">Email Address</span>
                <span className="relative block">
                  <Mail className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-subtle" strokeWidth={1.75} aria-hidden="true" />
                  <input type="email" required autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} placeholder="Enter your email address" className={`${field} pr-4`} />
                </span>
              </label>

              <label className="block">
                <span className="block text-[14px] font-medium mb-1.5">Password</span>
                <span className="relative block">
                  <Lock className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-subtle" strokeWidth={1.75} aria-hidden="true" />
                  <input type={show ? 'text' : 'password'} required autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter your password" className={`${field} pr-14`} />
                  <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}
                    className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-md text-muted hover:bg-soft">
                    {show ? <Eye className="w-5 h-5" strokeWidth={1.75} /> : <EyeOff className="w-5 h-5" strokeWidth={1.75} />}
                  </button>
                </span>
              </label>
            </div>

            {error && <div role="alert" className="mt-5 text-[14px] border border-danger-line bg-danger-soft text-danger-ink rounded-md p-3">{error}</div>}
            {info && <div role="status" className="mt-5 text-[14px] text-ink bg-info-soft border border-info-line rounded-md p-3">{info}</div>}

            <button type="submit" disabled={busy} className="mt-6 w-full h-11 rounded-md bg-action hover:bg-action-hover text-white text-[15px] font-semibold inline-flex items-center justify-center gap-2 shadow-xs disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
              {busy ? 'Signing in…' : <>Sign In <ArrowRight className="w-5 h-5" /></>}
            </button>

            <div className="my-5 flex items-center gap-4 text-[14px] text-muted" aria-hidden="true"><span className="flex-1 h-px bg-line" />or<span className="flex-1 h-px bg-line" /></div>

            <button type="button" onClick={() => notice('google')} className="w-full h-11 rounded-md bg-white border border-line-strong hover:bg-soft text-[14px] font-medium text-ink inline-flex items-center justify-center gap-3">
              <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
                <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.54 5.54 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.54-5.17 3.54-8.87z" />
                <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3c-1.08.72-2.45 1.16-4.05 1.16-3.13 0-5.78-2.11-6.73-4.96H1.27v3.09A12 12 0 0 0 12 24z" />
                <path fill="#FBBC05" d="M5.27 14.29A7.2 7.2 0 0 1 4.89 12c0-.8.14-1.57.38-2.29V6.62H1.27A12 12 0 0 0 0 12c0 1.94.46 3.77 1.27 5.38l4-3.09z" />
                <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.27 6.62l4 3.09C6.22 6.86 8.87 4.75 12 4.75z" />
              </svg>
              Continue with Google
            </button>

            <div className="h-3" />

            <button type="button" onClick={() => notice('microsoft')} className="w-full h-11 rounded-md bg-white border border-line-strong hover:bg-soft text-[14px] font-medium text-ink inline-flex items-center justify-center gap-3">
              <svg viewBox="0 0 20 20" className="w-5 h-5" aria-hidden="true"><rect x="1" y="1" width="8" height="8" fill="#f25022" /><rect x="11" y="1" width="8" height="8" fill="#7fba00" /><rect x="1" y="11" width="8" height="8" fill="#00a4ef" /><rect x="11" y="11" width="8" height="8" fill="#ffb900" /></svg>
              Continue with Microsoft
            </button>

            <div className="mt-6 flex items-center gap-6 text-[14px]">
              <button type="button" onClick={() => notice('forgot')} className="text-info-ink hover:underline">Forgot Password?</button>
              <span className="h-6 w-px bg-line-strong" aria-hidden="true" />
              <button type="button" onClick={() => notice('create')} className="font-medium text-info-ink hover:underline">Create an Account</button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
