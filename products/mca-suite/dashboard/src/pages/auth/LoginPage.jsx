import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  AlertCircle,
  ArrowRight,
  Check,
  Key,
  Smartphone,
  RefreshCw,
} from 'lucide-react';
import AuthLayout from '../../layouts/AuthLayout';
import { useAuthStore } from '../../store/authStore';
import { sendFirebasePhoneOtp, confirmFirebasePhoneOtp } from '../../lib/firebase.js';

const DEMO_ACCOUNTS = [
  { role: 'superadmin', label: 'Super Admin', email: 'superadmin@germin8.com' },
  { role: 'admin',      label: 'Admin (Plan Buyer)', email: 'admin@demo.com' },
  { role: 'developer',  label: 'Developer',   email: 'dev@demo.com' },
  { role: 'user',       label: 'Staff User',  email: 'user@demo.com' },
];

export default function LoginPage() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const sendOtp = useAuthStore((s) => s.sendOtp);
  const verifyOtp = useAuthStore((s) => s.verifyOtp);
  const otpState = useAuthStore((s) => s.otpState);
  const resetOtp = useAuthStore((s) => s.resetOtp);

  // Tab: 'otp' | 'password'
  const [authMode, setAuthMode] = useState('otp');

  // OTP Form States
  const [phone, setPhone] = useState('9876543210');
  const [enteredOtp, setEnteredOtp] = useState('');
  const [otpStep, setOtpStep] = useState(1); // 1 = enter phone, 2 = enter otp
  const [otpSuccessMessage, setOtpSuccessMessage] = useState('');
  const [confirmationResult, setConfirmationResult] = useState(null);
  const [isFirebaseSms, setIsFirebaseSms] = useState(false);

  // Password Form States
  const [email, setEmail] = useState('admin@demo.com');
  const [password, setPassword] = useState('demo123');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fillDemo = (accEmail) => {
    setEmail(accEmail);
    setPassword('demo123');
    setError('');
  };

  // Handle Send OTP (Real Firebase SMS with SQLite Fallback)
  const handleSendOtp = async (e) => {
    e?.preventDefault();
    setError('');
    setLoading(true);
    setOtpSuccessMessage('');
    const cleanPhone = phone.replace(/\D/g, '');

    try {
      // 1. Try real Firebase SMS delivery to phone
      const formattedPhone = cleanPhone.startsWith('+') ? cleanPhone : `+91${cleanPhone}`;
      const confRes = await sendFirebasePhoneOtp(formattedPhone);
      setConfirmationResult(confRes);
      setIsFirebaseSms(true);
      setOtpStep(2);
      setEnteredOtp(''); // Keep empty waiting for real SMS!
      setOtpSuccessMessage(`Real SMS verification code dispatched to ${formattedPhone} via Firebase! Check your phone messages.`);
    } catch (fbErr) {
      console.error('[FIREBASE PHONE AUTH ERROR]:', fbErr);
      const isOpNotAllowed = fbErr?.code === 'auth/operation-not-allowed';
      const reason = isOpNotAllowed
        ? 'Phone provider is not enabled yet in your Firebase Console (Authentication > Sign-in method > Phone > Enable).'
        : (fbErr?.message || 'Firebase SMS request failed.');

      setError(`Firebase Phone Auth: ${reason}`);

      // 2. Seamless Backend SQLite Fallback
      try {
        const res = await sendOtp(cleanPhone);
        setOtpStep(2);
        setIsFirebaseSms(false);
        setEnteredOtp('');
      } catch (err) {
        setError(err.message || 'Failed to send OTP.');
      }
    } finally {
      setLoading(false);
    }
  };

  // Handle Verify OTP
  const handleVerifyOtp = async (e) => {
    e?.preventDefault();
    setError('');
    setLoading(true);
    const cleanPhone = phone.replace(/\D/g, '');

    try {
      if (isFirebaseSms && confirmationResult) {
        try {
          await confirmFirebasePhoneOtp(confirmationResult, enteredOtp);
        } catch (fbVerErr) {
          console.warn('Firebase confirmation note:', fbVerErr.message);
        }
      }

      // Record and establish session in local backend SQLite
      const res = await verifyOtp(cleanPhone, enteredOtp);
      if (res?.ok) {
        navigate('/dashboard/user');
      }
    } catch (err) {
      setError(err.message || 'Invalid OTP code.');
    } finally {
      setLoading(false);
    }
  };

  // Handle Standard Password Login
  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await login(email, password);
      if (res?.user?.role) {
        navigate(`/dashboard/${res.user.role}`);
      } else {
        navigate('/dashboard');
      }
    } catch (err) {
      setError('Invalid email or password. Select a demo account below to fill automatically.');
    } finally {
      setLoading(false);
    }
  };

  const inputCls =
    'w-full py-2.5 bg-white border border-line-input hover:border-ink-muted focus:border-gold-600 focus:ring-2 focus:ring-gold-500 rounded-lg text-sm text-ink placeholder:text-ink-subtle focus:outline-none transition-shadow';
  const primaryBtn =
    'w-full py-2.5 px-4 bg-gold-700 hover:bg-gold-800 disabled:bg-gold-200 disabled:text-gold-800/60 disabled:cursor-not-allowed text-white font-semibold text-sm rounded-lg shadow-sm transition-colors flex items-center justify-center gap-2 cursor-pointer';
  const Spinner = () => (
    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
  );

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Use your mobile number (OTP) or a demo email account."
      highlights={[
        'Scan balance sheets and P&L into AOC-4 fields',
        'Push a filing to the Chrome extension in one click',
        'Track every filing from draft to SRN',
      ]}
      topRight={
        <Link to="/register" className="text-xs font-semibold text-ink-muted hover:text-gold-700">
          Create an account →
        </Link>
      }
      footer={
        <>
          Don't have an account?{' '}
          <Link to="/register" className="font-semibold text-gold-700 hover:underline">
            Create one
          </Link>
        </>
      }
    >
      {/* Mode Switcher */}
      <div className="flex p-1 bg-page rounded-lg mb-6 border border-line">
        {[
          { id: 'otp', icon: Smartphone, label: 'Mobile OTP' },
          { id: 'password', icon: Mail, label: 'Email & password' },
        ].map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => { setAuthMode(id); setError(''); }}
            className={`flex-1 py-2 text-xs font-semibold rounded-md transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
              authMode === id
                ? 'bg-white text-gold-800 shadow-sm border border-gold-200'
                : 'text-ink-muted hover:text-ink border border-transparent'
            }`}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="p-3 mb-5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium flex items-start gap-2">
          <AlertCircle size={14} className="text-rose-600 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* ─── OTP AUTHENTICATION TAB ─── */}
      {authMode === 'otp' && (
        <div>
          {/* Invisible reCAPTCHA container for Firebase Phone Auth */}
          <div id="recaptcha-container"></div>
          {otpStep === 1 ? (
            <form onSubmit={handleSendOtp} className="space-y-4">
              <div>
                <label className="label">Mobile number</label>
                <div className="relative flex items-center">
                  <span className="absolute left-3.5 text-xs font-semibold text-ink-muted">
                    +91
                  </span>
                  <input
                    type="tel"
                    required
                    maxLength={10}
                    placeholder="9876543210"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                    className={`${inputCls} pl-12 pr-3.5 font-mono`}
                  />
                </div>
                <p className="text-[11px] text-ink-subtle mt-1.5">
                  We send a 6-digit code to this number.
                </p>
              </div>

              <button
                type="submit"
                disabled={loading || phone.length < 10}
                className={primaryBtn}
              >
                {loading ? (
                  <span className="inline-flex items-center gap-2">
                    <Spinner /> Sending code...
                  </span>
                ) : (
                  <>
                    Send verification code <ArrowRight size={15} />
                  </>
                )}
              </button>

              <p className="pt-1 text-center text-[11px] text-ink-subtle">
                Test staff mobile: <strong className="text-ink font-mono">9876543210</strong>
              </p>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div className={`p-3 border rounded-lg text-xs space-y-1.5 ${
                isFirebaseSms ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800'
              }`}>
                <div className="flex items-center justify-between">
                  <span className="font-semibold flex items-center gap-1.5">
                    <Check size={14} /> {isFirebaseSms ? 'SMS sent to ' : 'Test code for '} +91-{phone}
                  </span>
                  <button
                    type="button"
                    onClick={() => { setOtpStep(1); setEnteredOtp(''); }}
                    className="text-[11px] underline cursor-pointer"
                  >
                    Change
                  </button>
                </div>

                {isFirebaseSms ? (
                  <p className="text-[11px] text-emerald-700">
                    Check your phone's messages for the 6-digit code.
                  </p>
                ) : (
                  <div className="bg-white/80 p-2 rounded-md border border-amber-200 flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-amber-900">
                      Offline test code (SMS is not set up):
                    </span>
                    <button
                      type="button"
                      onClick={() => setEnteredOtp(otpState.testOtp || '123456')}
                      className="text-[10px] bg-gold-700 hover:bg-gold-800 text-white px-2 py-0.5 rounded cursor-pointer font-mono"
                    >
                      Fill {otpState.testOtp || '123456'}
                    </button>
                  </div>
                )}
              </div>

              <div>
                <label className="label">Enter the 6-digit code</label>
                <input
                  type="text"
                  required
                  maxLength={6}
                  placeholder="••••••"
                  value={enteredOtp}
                  onChange={(e) => setEnteredOtp(e.target.value.replace(/\D/g, ''))}
                  className={`${inputCls} px-3.5 py-3 text-center tracking-[0.4em] font-mono text-xl font-semibold`}
                />
              </div>

              <button
                type="submit"
                disabled={loading || enteredOtp.length !== 6}
                className={primaryBtn}
              >
                {loading ? (
                  <span className="inline-flex items-center gap-2">
                    <Spinner /> Verifying...
                  </span>
                ) : (
                  <>
                    Verify and sign in <ArrowRight size={15} />
                  </>
                )}
              </button>

              <div className="flex items-center justify-between text-xs pt-1">
                <button
                  type="button"
                  onClick={handleSendOtp}
                  className="text-gold-700 font-semibold hover:underline cursor-pointer flex items-center gap-1"
                >
                  <RefreshCw size={12} /> Resend code
                </button>
                <span className="text-[11px] text-ink-subtle">Test OTP: 123456</span>
              </div>
            </form>
          )}
        </div>
      )}

      {/* ─── EMAIL / PASSWORD DEMO TAB ─── */}
      {authMode === 'password' && (
        <div>
          {/* Quick Demo Accounts Helper */}
          <div className="mb-5 p-3.5 rounded-lg bg-gold-50/60 border border-gold-100">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold text-gold-800 uppercase tracking-wider flex items-center gap-1.5">
                <Key size={13} /> Demo accounts
              </span>
              <span className="text-[10px] text-ink-subtle font-mono">Password: demo123</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {DEMO_ACCOUNTS.map((acc) => (
                <button
                  key={acc.role}
                  type="button"
                  onClick={() => fillDemo(acc.email)}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-medium text-left border transition-colors cursor-pointer ${
                    email === acc.email
                      ? 'bg-gold-700 text-white border-gold-700 font-semibold'
                      : 'bg-white text-ink-muted border-line hover:border-gold-300 hover:text-ink'
                  }`}
                >
                  {acc.label}
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div>
              <label className="label">Email address</label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle" />
                <input
                  type="email"
                  required
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={`${inputCls} pl-10 pr-3.5`}
                />
              </div>
            </div>

            <div>
              <label className="label">Password</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`${inputCls} pl-10 pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-ink-subtle hover:text-ink cursor-pointer"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={loading} className={`${primaryBtn} mt-2`}>
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <Spinner /> Signing in...
                </span>
              ) : (
                <>
                  Sign in <ArrowRight size={15} />
                </>
              )}
            </button>
          </form>
        </div>
      )}
    </AuthLayout>
  );
}
