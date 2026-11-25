import { useState, useRef, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Bell, Menu, X, LogOut, ChevronDown,
  CheckCircle2, AlertCircle, Info, Trash2,
  Building2, FileText, Radio
} from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { useNotificationStore } from '../store/notificationStore'
import BrandMark from '../components/common/BrandMark'
import clsx from 'clsx'

function getInitials(name = '') {
  if (!name) return 'ST'
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

function getRoleBadgeClass(role) {
  switch (role) {
    case 'superadmin': return 'badge bg-gold-700 text-white border-gold-700'
    case 'admin':      return 'badge bg-gold-50 text-gold-800 border-gold-200'
    case 'developer':  return 'badge bg-sky-50 text-sky-700 border-sky-200 font-mono'
    default:           return 'badge bg-page text-ink-muted border-line'
  }
}

function getRoleLabel(role) {
  switch (role) {
    case 'superadmin': return 'Super Admin'
    case 'admin':      return 'Admin'
    case 'developer':  return 'Developer'
    default:           return 'Staff'
  }
}

const USER_MENU_LINKS = [
  { icon: FileText, label: 'MCA Master Directory (58 forms)', to: '/dashboard/user/forms?tab=directory' },
  { icon: Radio,    label: 'Germin8 Extension Bridge',        to: '/dashboard/user/forms?mode=connector' },
  { icon: Building2, label: 'Document Vault & Challans',      to: '/dashboard/user/vault' },
]

export default function DashboardLayout({ navItems = [], pageTitle = 'Dashboard', children }) {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [notifFilter, setNotifFilter] = useState('all') // 'all' | 'unread'

  const notifRef = useRef(null)
  const userMenuRef = useRef(null)

  const {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    removeNotification,
    clearAll
  } = useNotificationStore()

  const count = unreadCount()

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (notifRef.current && !notifRef.current.contains(e.target)) {
        setNotifOpen(false)
      }
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setUserMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleLogout = () => {
    setUserMenuOpen(false)
    logout()
    navigate('/login', { replace: true })
  }

  const handleNotificationClick = (n) => {
    markAsRead(n.id)
    if (n.actionUrl) {
      setNotifOpen(false)
      navigate(n.actionUrl)
    }
  }

  const filteredNotifications = notifFilter === 'unread'
    ? notifications.filter(n => !n.read)
    : notifications

  const SidebarContent = () => (
    <div className="flex flex-col h-full bg-surface">
      {/* Logo */}
      <div className="h-16 px-5 border-b border-line flex items-center shrink-0">
        <BrandMark size={34} subtitle="MCA V3 Automation" />
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">Workspace</p>
        {navItems.map((item) => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) => clsx('nav-item', isActive && 'active')}
            >
              {({ isActive }) => (
                <>
                  <Icon className={clsx('w-4 h-4 shrink-0', isActive ? 'text-gold-600' : 'text-ink-subtle')} />
                  <span>{item.label}</span>
                  {item.badge && (
                    <span className="ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-gold-100 text-gold-800">
                      {item.badge}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          )
        })}
      </nav>

      {/* User + Logout in Sidebar */}
      <div className="px-3 py-4 border-t border-line">
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-page border border-line mb-2">
          <div className="w-8 h-8 rounded-full bg-gold-100 text-gold-800 text-xs font-bold flex items-center justify-center shrink-0">
            {getInitials(user?.name)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-ink truncate">{user?.name || 'Staff User'}</p>
            <p className="text-xs text-ink-subtle truncate">{user?.email || 'staff@germin8.com'}</p>
          </div>
          <span className={clsx(getRoleBadgeClass(user?.role), 'text-[9px] px-1.5 py-0.5 shrink-0')}>
            {getRoleLabel(user?.role)}
          </span>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-line bg-white text-sm font-medium text-ink-muted hover:bg-gold-50 hover:text-ink transition-colors cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
          <span>Sign out</span>
        </button>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-page">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-64 bg-surface border-r border-line flex-col z-30">
        <SidebarContent />
      </aside>

      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-ink/20 z-40 lg:hidden"
              onClick={() => setSidebarOpen(false)}
            />
            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="fixed inset-y-0 left-0 w-72 bg-surface border-r border-line shadow-pop z-50 flex flex-col lg:hidden"
            >
              <div className="absolute top-3.5 right-3 z-10">
                <button
                  onClick={() => setSidebarOpen(false)}
                  className="p-2 rounded-lg text-ink-subtle hover:text-ink hover:bg-gold-50 transition-colors cursor-pointer"
                  aria-label="Close menu"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <SidebarContent />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Top Header Bar */}
      <header className="fixed top-0 right-0 left-0 lg:left-64 h-16 z-20 flex items-center px-4 lg:px-6 gap-3 bg-surface border-b border-line">
        <button
          onClick={() => setSidebarOpen(true)}
          className="lg:hidden p-2 rounded-lg text-ink-muted hover:bg-gold-50 transition-colors cursor-pointer"
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold text-ink truncate leading-tight">{pageTitle}</h1>
        </div>

        {/* ── NOTIFICATION BELL & DROPDOWN ── */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => setNotifOpen(!notifOpen)}
            className={clsx(
              'p-2 rounded-full border transition-colors relative cursor-pointer',
              notifOpen
                ? 'bg-gold-50 text-gold-700 border-gold-200'
                : 'bg-white border-line text-ink-muted hover:bg-gold-50 hover:text-ink'
            )}
            title="Notifications"
          >
            <Bell className="w-4 h-4" />
            {count > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold font-mono flex items-center justify-center bg-gold-700 text-white">
                {count}
              </span>
            )}
          </button>

          <AnimatePresence>
            {notifOpen && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.98 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 top-full mt-2 w-80 sm:w-96 bg-surface border border-line rounded-xl shadow-pop z-50 overflow-hidden"
              >
                {/* Header */}
                <div className="p-4 border-b border-line flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-ink">Compliance notifications</span>
                    {count > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-gold-50 text-gold-800 border border-gold-200 text-[10px] font-mono">
                        {count} new
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {count > 0 && (
                      <button
                        onClick={markAllAsRead}
                        className="text-[11px] font-medium text-gold-700 hover:underline cursor-pointer"
                      >
                        Mark all read
                      </button>
                    )}
                    {notifications.length > 0 && (
                      <button
                        onClick={clearAll}
                        className="text-ink-subtle hover:text-ink transition-colors cursor-pointer"
                        title="Clear all"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Filter tabs */}
                <div className="px-4 py-2 bg-page border-b border-line flex gap-2">
                  {[
                    { id: 'all', label: `All (${notifications.length})` },
                    { id: 'unread', label: `Unread (${count})` },
                  ].map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setNotifFilter(t.id)}
                      className={clsx(
                        'px-2.5 py-1 rounded-full text-[11px] font-medium cursor-pointer transition-colors',
                        notifFilter === t.id ? 'bg-gold-100 text-gold-800' : 'text-ink-muted hover:text-ink'
                      )}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {/* Notifications list */}
                <div className="max-h-80 overflow-y-auto divide-y divide-line">
                  {filteredNotifications.length === 0 ? (
                    <div className="p-8 text-center text-xs text-ink-subtle">
                      No notifications to show
                    </div>
                  ) : (
                    filteredNotifications.map((n) => (
                      <div
                        key={n.id}
                        onClick={() => handleNotificationClick(n)}
                        className={clsx(
                          'p-3.5 hover:bg-gold-50/50 transition-colors cursor-pointer flex items-start gap-3 relative group',
                          !n.read && 'bg-gold-50/30'
                        )}
                      >
                        <div className="shrink-0 mt-0.5">
                          {n.type === 'warning' && <AlertCircle className="w-4 h-4 text-amber-600" />}
                          {n.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                          {n.type === 'info' && <Info className="w-4 h-4 text-sky-600" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <p className={clsx('text-xs font-semibold leading-tight truncate', !n.read ? 'text-ink' : 'text-ink-muted')}>
                              {n.title}
                            </p>
                            <span className="text-[10px] text-ink-subtle font-mono shrink-0">{n.timestamp}</span>
                          </div>
                          <p className="text-[11px] text-ink-muted mt-1 leading-relaxed line-clamp-2">{n.message}</p>
                          {n.formCode && (
                            <span className="inline-block mt-1.5 px-1.5 py-0.5 rounded bg-gold-50 text-gold-800 text-[9px] font-mono font-medium border border-gold-200">
                              {n.formCode}
                            </span>
                          )}
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            removeNotification(n.id)
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 text-ink-subtle hover:text-ink transition-opacity cursor-pointer"
                          aria-label="Dismiss notification"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))
                  )}
                </div>

                {/* Footer */}
                <div className="p-2.5 bg-page border-t border-line text-center">
                  <button
                    onClick={() => {
                      setNotifOpen(false)
                      navigate('/dashboard/user/forms')
                    }}
                    className="text-xs font-semibold text-gold-700 hover:underline cursor-pointer"
                  >
                    Open MCA Forms Hub →
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── USER MENU & LOGOUT DROPDOWN ── */}
        <div className="relative" ref={userMenuRef}>
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="flex items-center gap-2 p-1 pr-2 rounded-full border border-line hover:bg-gold-50 transition-colors cursor-pointer bg-white"
          >
            <div className="w-7 h-7 rounded-full bg-gold-100 text-gold-800 text-xs font-bold flex items-center justify-center">
              {getInitials(user?.name)}
            </div>
            <span className="hidden sm:block text-xs font-semibold text-ink">
              {user?.name?.split(' ')[0] || 'Staff'}
            </span>
            <ChevronDown className={clsx('w-3.5 h-3.5 text-ink-subtle transition-transform', userMenuOpen && 'rotate-180')} />
          </button>

          <AnimatePresence>
            {userMenuOpen && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.98 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 top-full mt-2 w-64 bg-surface border border-line rounded-xl shadow-pop z-50 overflow-hidden"
              >
                {/* User Info Header */}
                <div className="p-4 border-b border-line bg-page">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gold-100 text-gold-800 font-bold text-sm flex items-center justify-center shrink-0">
                      {getInitials(user?.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-ink truncate">{user?.name || 'Staff Specialist'}</p>
                      <p className="text-[11px] text-ink-muted truncate">{user?.email || 'staff@germin8.com'}</p>
                      <div className="mt-1">
                        <span className={clsx(getRoleBadgeClass(user?.role), 'text-[9px] px-1.5 py-0.5')}>
                          {getRoleLabel(user?.role)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Quick Links */}
                <div className="p-2 space-y-0.5 text-xs">
                  {USER_MENU_LINKS.map(({ icon: Icon, label, to }) => (
                    <button
                      key={to}
                      onClick={() => {
                        setUserMenuOpen(false)
                        navigate(to)
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-ink-muted hover:text-ink hover:bg-gold-50 transition-colors cursor-pointer text-left"
                    >
                      <Icon className="w-4 h-4 text-gold-600" />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>

                {/* Logout Button */}
                <div className="p-2 border-t border-line">
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-semibold text-ink hover:bg-rose-50 hover:text-rose-700 transition-colors cursor-pointer"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Sign out</span>
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </header>

      {/* Main Page Content */}
      <main className="lg:ml-64 pt-16 min-h-screen bg-page">
        <div className="p-4 lg:p-6">
          {children}
        </div>
      </main>
    </div>
  )
}
