import { useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard, ShieldAlert, Layers, Building2, Users,
  Activity, Sliders, Check, Plus, Edit3, Trash2, Search,
  CheckCircle2, AlertTriangle, ArrowUpRight, TrendingUp,
  DollarSign, Server, Lock, ToggleLeft, ToggleRight, X
} from 'lucide-react'
import DashboardLayout from '../../../layouts/DashboardLayout'
import clsx from 'clsx'

const NAV_ITEMS = [
  { label: 'Overview',        icon: LayoutDashboard, path: '/dashboard/superadmin/overview' },
  { label: 'Plans Manager',   icon: Layers,          path: '/dashboard/superadmin/plans' },
  { label: 'Companies',       icon: Building2,       path: '/dashboard/superadmin/companies' },
  { label: 'All Users',       icon: Users,           path: '/dashboard/superadmin/users' },
  { label: 'System Health',   icon: Server,          path: '/dashboard/superadmin/health' },
]

const INITIAL_PLANS = [
  {
    id: 'starter',
    name: 'Starter Plan',
    price: 2999,
    billing: 'monthly',
    maxUsers: 5,
    maxForms: 50,
    storageGB: 5,
    apiAccess: false,
    fileSureApi: true,
    aiScanner: true,
    companiesCount: 142
  },
  {
    id: 'pro',
    name: 'Professional Plan',
    price: 7999,
    billing: 'monthly',
    maxUsers: 25,
    maxForms: 250,
    storageGB: 25,
    apiAccess: true,
    fileSureApi: true,
    aiScanner: true,
    companiesCount: 284
  },
  {
    id: 'enterprise',
    name: 'Enterprise Plan',
    price: 24999,
    billing: 'monthly',
    maxUsers: 100,
    maxForms: 2000,
    storageGB: 100,
    apiAccess: true,
    fileSureApi: true,
    aiScanner: true,
    companiesCount: 68
  },
]

const INITIAL_COMPANIES = [
  { id: 'c1', name: 'Sharma & Associates', plan: 'pro', usersCount: 14, maxUsers: 25, status: 'Active', mrr: '₹7,999' },
  { id: 'c2', name: 'Mehta Corporate Solutions', plan: 'enterprise', usersCount: 42, maxUsers: 100, status: 'Active', mrr: '₹24,999' },
  { id: 'c3', name: 'Apex Tax & Compliance', plan: 'starter', usersCount: 5, maxUsers: 5, status: 'Active', mrr: '₹2,999' },
  { id: 'c4', name: 'Zenith Legal Partners', plan: 'pro', usersCount: 22, maxUsers: 25, status: 'Active', mrr: '₹7,999' },
  { id: 'c5', name: 'FinTrust Advisory LLP', plan: 'starter', usersCount: 3, maxUsers: 5, status: 'Active', mrr: '₹2,999' },
]

// ─── OVERVIEW TAB ────────────────────────────────────────────────────────────
function Overview() {
  const stats = [
    { label: 'Total MRR',            value: '₹38.4L', delta: '+18.2% MoM',     icon: DollarSign,   color: 'text-gold-700', bg: 'bg-gold-50 border border-gold-100' },
    { label: 'Active Companies',     value: '494',    delta: '+34 this month',   icon: Building2,    color: 'text-gold-700', bg: 'bg-gold-50 border border-gold-100' },
    { label: 'Total Platform Users', value: '3,812',  delta: 'Across all plans', icon: Users,        color: 'text-gold-700', bg: 'bg-gold-50 border border-gold-100' },
    { label: 'Forms Filed (30d)',    value: '52,190', delta: '99.9% success',   icon: TrendingUp,   color: 'text-gold-700', bg: 'bg-gold-50 border border-gold-100' },
  ]

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {stats.map((s, i) => {
          const Icon = s.icon
          return (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="stat-card"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider">{s.label}</p>
                  <p className="text-2xl font-bold text-ink mt-1">{s.value}</p>
                  <p className="text-xs text-ink-subtle mt-1">{s.delta}</p>
                </div>
                <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center', s.bg)}>
                  <Icon className={clsx('w-5 h-5', s.color)} />
                </div>
              </div>
            </motion.div>
          )
        })}
      </div>

      {/* Quick summary table */}
      <div className="glass-card rounded-xl p-6">
        <h3 className="text-sm font-bold text-ink mb-4">Platform Growth & Plan Distribution</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {INITIAL_PLANS.map(plan => (
            <div key={plan.id} className="p-4 rounded-xl border border-line bg-page space-y-2">
              <div className="flex justify-between items-center">
                <span className="font-bold text-sm text-ink">{plan.name}</span>
                <span className="badge-gold text-[11px]">{plan.companiesCount} companies</span>
              </div>
              <p className="text-xl font-bold text-ink">₹{plan.price.toLocaleString('en-IN')}<span className="text-xs font-normal text-ink-subtle">/mo</span></p>
              <p className="text-xs text-ink-muted">Max {plan.maxUsers} people per company account</p>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  )
}

// ─── PLANS MANAGER (SUPER ADMIN CAN CHANGE HOW MANY PPL CAN ADD ETC) ──────────
function PlansManager() {
  const [plans, setPlans] = useState(INITIAL_PLANS)
  const [editingPlan, setEditingPlan] = useState(null)
  const [successMsg, setSuccessMsg] = useState('')

  const handleEditClick = (plan) => {
    setEditingPlan({ ...plan })
  }

  const handleSavePlan = () => {
    setPlans(plans.map(p => p.id === editingPlan.id ? editingPlan : p))
    setEditingPlan(null)
    setSuccessMsg('Plan settings successfully updated!')
    setTimeout(() => setSuccessMsg(''), 3000)
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-ink">Subscription Plans & Seat Limits Manager</h2>
          <p className="text-xs text-ink-subtle">Super Super Admin control: Adjust pricing, quotas, and maximum people (users) companies can invite</p>
        </div>
      </div>

      {successMsg && (
        <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-semibold">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          {successMsg}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {plans.map((plan) => (
          <div key={plan.id} className="glass-card rounded-xl p-6 flex flex-col justify-between border border-line">
            <div className="space-y-4">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-bold text-ink text-base">{plan.name}</h3>
                  <p className="text-2xl font-bold text-ink mt-1">₹{plan.price.toLocaleString('en-IN')} <span className="text-xs text-ink-subtle font-normal">/month</span></p>
                </div>
                <button
                  onClick={() => handleEditClick(plan)}
                  className="p-2 rounded-xl text-ink hover:bg-gold-50 transition-colors"
                  title="Edit Plan Settings"
                >
                  <Edit3 className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-2.5 pt-2 border-t border-line text-xs text-ink-muted">
                <div className="flex justify-between py-1 border-b border-line">
                  <span className="font-semibold text-ink-muted">Max People Allowed (Seats):</span>
                  <span className="font-bold text-ink">{plan.maxUsers} Users</span>
                </div>
                <div className="flex justify-between py-1 border-b border-line">
                  <span>Monthly MCA Forms:</span>
                  <span className="font-bold text-ink">{plan.maxForms} forms</span>
                </div>
                <div className="flex justify-between py-1 border-b border-line">
                  <span>Vault Storage:</span>
                  <span className="font-bold text-ink">{plan.storageGB} GB</span>
                </div>
                <div className="flex justify-between py-1 border-b border-line">
                  <span>FileSure API Direct Submission:</span>
                  <span className={plan.fileSureApi ? 'text-emerald-600 font-bold' : 'text-ink-subtle'}>
                    {plan.fileSureApi ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span>AI Doc Scanner:</span>
                  <span className={plan.aiScanner ? 'text-emerald-600 font-bold' : 'text-ink-subtle'}>
                    {plan.aiScanner ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-5 mt-4 border-t border-line">
              <button
                onClick={() => handleEditClick(plan)}
                className="btn-secondary w-full justify-center text-xs py-2"
              >
                <Sliders className="w-3.5 h-3.5" /> Configure Limits & People
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Edit Modal */}
      {editingPlan && (
        <div className="fixed inset-0 bg-ink/30  flex items-center justify-center z-50 p-4">
          <div className="glass-card bg-white rounded-xl max-w-lg w-full p-6 space-y-4 shadow-glass-xl">
            <div className="flex justify-between items-center border-b border-line pb-3">
              <h3 className="font-bold text-ink text-base">Edit {editingPlan.name} Settings</h3>
              <button onClick={() => setEditingPlan(null)} className="text-ink-subtle hover:text-ink">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Monthly Price (₹)</label>
                <input
                  type="number"
                  className="input-field"
                  value={editingPlan.price}
                  onChange={e => setEditingPlan({ ...editingPlan, price: Number(e.target.value) })}
                />
              </div>

              <div>
                <label className="label">Max People (Company Seats)</label>
                <input
                  type="number"
                  className="input-field"
                  value={editingPlan.maxUsers}
                  onChange={e => setEditingPlan({ ...editingPlan, maxUsers: Number(e.target.value) })}
                />
              </div>

              <div>
                <label className="label">Monthly Form Limit</label>
                <input
                  type="number"
                  className="input-field"
                  value={editingPlan.maxForms}
                  onChange={e => setEditingPlan({ ...editingPlan, maxForms: Number(e.target.value) })}
                />
              </div>

              <div>
                <label className="label">Vault Storage (GB)</label>
                <input
                  type="number"
                  className="input-field"
                  value={editingPlan.storageGB}
                  onChange={e => setEditingPlan({ ...editingPlan, storageGB: Number(e.target.value) })}
                />
              </div>
            </div>

            <div className="space-y-2 pt-2">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-ink-muted">
                <input
                  type="checkbox"
                  checked={editingPlan.fileSureApi}
                  onChange={e => setEditingPlan({ ...editingPlan, fileSureApi: e.target.checked })}
                  className="rounded accent-gold-600"
                />
                Include FileSure API Filing feature
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-ink-muted">
                <input
                  type="checkbox"
                  checked={editingPlan.aiScanner}
                  onChange={e => setEditingPlan({ ...editingPlan, aiScanner: e.target.checked })}
                  className="rounded accent-gold-600"
                />
                Include AI Document Scanner OCR feature
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-ink-muted">
                <input
                  type="checkbox"
                  checked={editingPlan.apiAccess}
                  onChange={e => setEditingPlan({ ...editingPlan, apiAccess: e.target.checked })}
                  className="rounded accent-gold-600"
                />
                Include Developer API Keys & Webhooks access
              </label>
            </div>

            <div className="flex gap-2 justify-end pt-4 border-t border-line">
              <button onClick={() => setEditingPlan(null)} className="btn-secondary">Cancel</button>
              <button onClick={handleSavePlan} className="btn-primary">Save Changes</button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  )
}

// ─── COMPANIES TAB ───────────────────────────────────────────────────────────
function Companies() {
  const [companies, setCompanies] = useState(INITIAL_COMPANIES)
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-ink">Enrolled Companies & Tenant Accounts</h2>
        <span className="text-xs text-ink-subtle">Total: {companies.length}</span>
      </div>

      <div className="glass-card rounded-xl overflow-hidden">
        <table className="w-full data-table">
          <thead>
            <tr>
              <th>Company</th>
              <th>Plan</th>
              <th>People Added / Limit</th>
              <th>Status</th>
              <th>MRR</th>
            </tr>
          </thead>
          <tbody>
            {companies.map((c) => (
              <tr key={c.id}>
                <td>
                  <p className="font-semibold text-ink text-sm">{c.name}</p>
                  <p className="text-xs text-ink-subtle">ID: {c.id}</p>
                </td>
                <td>
                  <span className="badge-gold uppercase text-[10px]">{c.plan}</span>
                </td>
                <td>
                  <div className="text-xs font-semibold text-ink-muted">
                    {c.usersCount} / {c.maxUsers} people
                  </div>
                  <div className="w-24 h-1.5 bg-gold-100/70 rounded-full mt-1 overflow-hidden">
                    <div
                      className="h-full bg-gold-600 rounded-full"
                      style={{ width: `${(c.usersCount / c.maxUsers) * 100}%` }}
                    />
                  </div>
                </td>
                <td>
                  <span className="badge-green text-xs">{c.status}</span>
                </td>
                <td className="font-semibold text-ink text-sm">{c.mrr}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  )
}

// ─── ALL USERS TAB ───────────────────────────────────────────────────────────
function AllUsers() {
  const users = [
    { name: 'Rajan Mehta', email: 'superadmin@germin8.com', company: 'Germin8 Platform', role: 'superadmin' },
    { name: 'Priya Sharma', email: 'admin@demo.com', company: 'Sharma & Associates', role: 'admin' },
    { name: 'Arjun Patel', email: 'dev@demo.com', company: 'Sharma & Associates', role: 'developer' },
    { name: 'Neha Singh', email: 'user@demo.com', company: 'Sharma & Associates', role: 'user' },
    { name: 'Rahul Verma', email: 'rahul@verma.com', company: 'Apex Tax & Compliance', role: 'admin' },
  ]

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-ink">All Platform Users & Roles</h2>
      </div>

      <div className="glass-card rounded-xl overflow-hidden">
        <table className="w-full data-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Company</th>
              <th>Role</th>
              <th>Security</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.email}>
                <td>
                  <p className="font-semibold text-ink text-sm">{u.name}</p>
                  <p className="text-xs text-ink-subtle">{u.email}</p>
                </td>
                <td className="text-xs text-ink-muted font-medium">{u.company}</td>
                <td>
                  <span className={clsx(
                    'badge text-xs capitalize',
                    u.role === 'superadmin' && 'bg-gold-700 text-white',
                    u.role === 'admin' && 'bg-gold-50 text-gold-800 border border-gold-200',
                    u.role === 'developer' && 'bg-sky-50 text-sky-700 border border-sky-200 font-mono',
                    u.role === 'user' && 'badge-gray'
                  )}>
                    {u.role}
                  </span>
                </td>
                <td>
                  <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> 2FA Verified
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  )
}

// ─── SYSTEM HEALTH TAB ───────────────────────────────────────────────────────
function SystemHealth() {
  const services = [
    { name: 'MCA Gateway (V3 Portal API)', status: 'Operational', latency: '124ms' },
    { name: 'FileSure Integration Engine', status: 'Operational', latency: '82ms' },
    { name: 'AI OCR Document Scanner Cluster', status: 'Operational', latency: '210ms' },
    { name: 'PostgreSQL Database Primary', status: 'Operational', latency: '4ms' },
    { name: 'Redis Cache & Queue Workers', status: 'Operational', latency: '1ms' },
  ]

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-ink">Infrastructure & API Health</h2>
        <span className="badge-green text-xs">All Systems Operational</span>
      </div>

      <div className="glass-card rounded-xl p-5 space-y-3">
        {services.map((svc) => (
          <div key={svc.name} className="flex items-center justify-between p-3 rounded-xl bg-page border border-line">
            <div className="flex items-center gap-3">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="font-semibold text-xs text-ink">{svc.name}</span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-xs text-ink-subtle font-mono">{svc.latency}</span>
              <span className="badge-green text-[11px]">{svc.status}</span>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  )
}

// ─── MAIN ROUTER ─────────────────────────────────────────────────────────────
export default function SuperAdminDashboard() {
  return (
    <DashboardLayout navItems={NAV_ITEMS} pageTitle="Super Super Admin">
      <div>
        <Routes>
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview"  element={<Overview />} />
          <Route path="plans"     element={<PlansManager />} />
          <Route path="companies" element={<Companies />} />
          <Route path="users"     element={<AllUsers />} />
          <Route path="health"    element={<SystemHealth />} />
        </Routes>
      </div>
    </DashboardLayout>
  )
}

