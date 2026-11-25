import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  User,
  Mail,
  Lock,
  Phone,
  Building2,
  Eye,
  EyeOff,
  ArrowRight,
} from 'lucide-react';
import AuthLayout from '../../layouts/AuthLayout';
import { useAuthStore } from '../../store/authStore';

export default function RegisterPage() {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    company: '',
    role: 'admin',
    password: '',
  });

  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name || !form.phone || !form.email || !form.password) {
      setError('Please fill in all required fields.');
      return;
    }

    setLoading(true);
    try {
      await new Promise((r) => setTimeout(r, 650));

      useAuthStore.setState({
        user: {
          id: 'usr_' + Date.now(),
          name: form.name,
          email: form.email,
          phone: form.phone,
          company: form.company || 'Sharma & Associates LLP',
          role: form.role,
        },
        isAuthenticated: true,
        token: 'token_' + Date.now(),
      });

      navigate('/dashboard/' + form.role);
    } catch (err) {
      setError('Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const inputCls =
    'w-full py-2.5 bg-white border border-line-input hover:border-ink-muted focus:border-gold-600 focus:ring-2 focus:ring-gold-500 rounded-lg text-sm text-ink placeholder:text-ink-subtle focus:outline-none transition-shadow';
  const iconCls = 'absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle';

  return (
    <AuthLayout
      title="Create an account"
      subtitle="Start automating your MCA compliance work in minutes."
      highlights={[
        'AI scanner reads financial statements and KYC documents',
        'Roles for admins, developers and filing staff',
        'Chrome extension fills MCA V3 forms; you review and submit',
      ]}
      topRight={
        <Link to="/login" className="text-xs font-semibold text-ink-muted hover:text-gold-700">
          Sign in →
        </Link>
      }
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-gold-700 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      {error && (
        <div className="p-3 mb-5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label">Full name</label>
          <div className="relative">
            <User className={iconCls} />
            <input
              type="text"
              required
              placeholder="e.g. Ramesh Sharma"
              value={form.name}
              onChange={(e) => handleChange('name', e.target.value)}
              className={`${inputCls} pl-10 pr-3.5`}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Work email</label>
            <div className="relative">
              <Mail className={iconCls} />
              <input
                type="email"
                required
                placeholder="name@firm.com"
                value={form.email}
                onChange={(e) => handleChange('email', e.target.value)}
                className={`${inputCls} pl-10 pr-3`}
              />
            </div>
          </div>

          <div>
            <label className="label">Phone number</label>
            <div className="relative">
              <Phone className={iconCls} />
              <input
                type="tel"
                required
                placeholder="+91 98765 43210"
                value={form.phone}
                onChange={(e) => handleChange('phone', e.target.value)}
                className={`${inputCls} pl-10 pr-3 font-mono`}
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Company / firm name</label>
            <div className="relative">
              <Building2 className={iconCls} />
              <input
                type="text"
                placeholder="Sharma & Associates LLP"
                value={form.company}
                onChange={(e) => handleChange('company', e.target.value)}
                className={`${inputCls} pl-10 pr-3`}
              />
            </div>
          </div>

          <div>
            <label className="label">Role</label>
            <select
              value={form.role}
              onChange={(e) => handleChange('role', e.target.value)}
              className={`${inputCls} px-3 cursor-pointer`}
            >
              <option value="admin">Admin (plan buyer)</option>
              <option value="developer">Developer (API keys)</option>
              <option value="user">Staff / filing user</option>
            </select>
          </div>
        </div>

        <div>
          <label className="label">Password</label>
          <div className="relative">
            <Lock className={iconCls} />
            <input
              type={showPassword ? 'text' : 'password'}
              required
              placeholder="Create a strong password"
              value={form.password}
              onChange={(e) => handleChange('password', e.target.value)}
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

        <button
          type="submit"
          disabled={loading}
          className="w-full mt-2 py-2.5 px-4 bg-gold-700 hover:bg-gold-800 disabled:opacity-60 text-white font-semibold text-sm rounded-lg shadow-sm transition-colors flex items-center justify-center gap-2 cursor-pointer"
        >
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Creating account...
            </span>
          ) : (
            <>
              Create account <ArrowRight size={15} />
            </>
          )}
        </button>
      </form>
    </AuthLayout>
  );
}
