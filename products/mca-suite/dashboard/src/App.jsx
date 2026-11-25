import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Suspense, lazy } from 'react'

// Auth pages
import LoginPage from './pages/auth/LoginPage'
import RegisterPage from './pages/auth/RegisterPage'

// Dashboard pages
import UserDashboard from './pages/dashboard/user/UserDashboard'
import AdminDashboard from './pages/dashboard/admin/AdminDashboard'
import DevDashboard from './pages/dashboard/developer/DevDashboard'
import SuperAdminDashboard from './pages/dashboard/superadmin/SuperAdminDashboard'

// Auth guard
import { useAuthStore } from './store/authStore'
import LoadingSpinner from './components/ui/LoadingSpinner'

function ProtectedRoute({ children, allowedRoles }) {
  const { user, isAuthenticated } = useAuthStore()

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  if (allowedRoles && !allowedRoles.includes(user?.role)) {
    return <Navigate to="/dashboard" replace />
  }

  return children
}

// "/" has no public page: signed-in users go to their dashboard, everyone else to sign in.
function RootRedirect() {
  const { isAuthenticated } = useAuthStore()
  return <Navigate to={isAuthenticated ? '/dashboard' : '/login'} replace />
}

function DashboardRouter() {
  const { user } = useAuthStore()

  switch (user?.role) {
    case 'superadmin': return <Navigate to="/dashboard/superadmin" replace />
    case 'admin': return <Navigate to="/dashboard/admin" replace />
    case 'developer': return <Navigate to="/dashboard/developer" replace />
    default: return <Navigate to="/dashboard/user" replace />
  }
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<LoadingSpinner />}>
        <Routes>
          <Route path="/" element={<RootRedirect />} />

          {/* Auth */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />

          {/* Dashboard router */}
          <Route path="/dashboard" element={
            <ProtectedRoute>
              <DashboardRouter />
            </ProtectedRoute>
          } />

          {/* Role dashboards */}
          <Route path="/dashboard/user/*" element={
            <ProtectedRoute allowedRoles={['user', 'staff', 'admin', 'developer', 'superadmin']}>
              <UserDashboard />
            </ProtectedRoute>
          } />

          <Route path="/dashboard/admin/*" element={
            <ProtectedRoute allowedRoles={['admin', 'superadmin']}>
              <AdminDashboard />
            </ProtectedRoute>
          } />

          <Route path="/dashboard/developer/*" element={
            <ProtectedRoute allowedRoles={['developer', 'superadmin']}>
              <DevDashboard />
            </ProtectedRoute>
          } />

          <Route path="/dashboard/superadmin/*" element={
            <ProtectedRoute allowedRoles={['superadmin']}>
              <SuperAdminDashboard />
            </ProtectedRoute>
          } />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
