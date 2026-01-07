import { useTenant } from './hooks/useTenant'
import { useAuth } from './hooks/useAuth'
import { LoginPage } from './pages/LoginPage'
import { Layout } from './components/Layout'

function App() {
  const { tenant, isLoading: tenantLoading, error: tenantError, subdomain } = useTenant()
  const { user, isLoading: authLoading, isAuthenticated } = useAuth()

  // Simple routing based on path
  const path = window.location.pathname

  // Show login page at /login
  if (path === '/login') {
    return <LoginPage />
  }

  const isLoading = tenantLoading || authLoading

  // Show loading state
  if (isLoading) {
    return (
      <div className="container">
        <div className="card" style={{ marginTop: 'var(--spacing-2xl)', textAlign: 'center' }}>
          <p style={{ color: 'var(--color-text-secondary)' }}>Loading...</p>
        </div>
      </div>
    )
  }

  // If not authenticated, redirect to login
  if (!isAuthenticated) {
    window.location.href = '/login'
    return null
  }

  // Main app (authenticated)
  return (
    <Layout>
      <DashboardPlaceholder 
        tenant={tenant} 
        tenantError={tenantError} 
        subdomain={subdomain} 
        user={user} 
      />
    </Layout>
  )
}

// Temporary placeholder - will be replaced with real dashboard
function DashboardPlaceholder({ tenant, tenantError, subdomain, user }: any) {
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Dashboard</h2>
      
      {tenantError && (
        <p style={{ color: 'var(--color-error)' }}>
          {tenantError}
        </p>
      )}

      {!tenantError && !subdomain && (
        <p style={{ color: 'var(--color-text-secondary)' }}>
          Welcome! Use a subdomain to access your business portal.
        </p>
      )}

      {tenant && (
        <p style={{ color: 'var(--color-text-secondary)' }}>
          You're viewing <strong>{tenant.name}</strong>
        </p>
      )}

      {/* Debug info - remove later */}
      <details style={{ marginTop: 'var(--spacing-lg)' }}>
        <summary style={{ cursor: 'pointer', color: 'var(--color-text-secondary)' }}>
          Debug Info
        </summary>
        <pre style={{ 
          marginTop: 'var(--spacing-sm)',
          padding: 'var(--spacing-md)', 
          background: 'var(--color-bg-secondary)', 
          borderRadius: 'var(--radius-md)',
          fontSize: '0.8rem',
          overflow: 'auto'
        }}>
{JSON.stringify({ 
  subdomain, 
  tenant: tenant ? { id: tenant.id, name: tenant.name, subdomain: tenant.subdomain } : null,
  user: user ? { 
    id: user.id, 
    email: user.email, 
    role: user.role,
    isSuperAdmin: user.isSuperAdmin,
    isAccountant: user.isAccountant,
    tenantAccess: user.tenantAccess?.length || 0,
  } : null 
}, null, 2)}
        </pre>
      </details>
    </div>
  )
}

export default App