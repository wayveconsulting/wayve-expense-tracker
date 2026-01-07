import { useTenant } from './hooks/useTenant'
import { useAuth } from './hooks/useAuth'
import { LoginPage } from './pages/LoginPage'

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
    <div className="container">
      <div className="card" style={{ marginTop: 'var(--spacing-2xl)' }}>
        {/* Tenant branding - logo would go here */}
        {tenant?.logoUrl && (
          <img 
            src={tenant.logoUrl} 
            alt={tenant.name} 
            style={{ maxHeight: '60px', marginBottom: 'var(--spacing-md)' }} 
          />
        )}
        
        <h1>{tenant?.appName || tenant?.name || 'Wayve Expense Tracker'}</h1>

        {tenantError && (
          <p style={{ color: 'var(--color-error)', marginTop: 'var(--spacing-sm)' }}>
            {tenantError}
          </p>
        )}

        {!tenantError && !subdomain && (
          <p style={{ color: 'var(--color-text-secondary)', marginTop: 'var(--spacing-sm)' }}>
            Welcome! Use a subdomain to access your business portal.
          </p>
        )}

        {/* User info */}
        {user && (
          <div style={{ 
            marginTop: 'var(--spacing-lg)', 
            padding: 'var(--spacing-md)', 
            background: 'var(--color-bg-tertiary)', 
            borderRadius: 'var(--radius-md)',
          }}>
            <p style={{ margin: 0 }}>
              Logged in as: <strong>{user.email}</strong>
            </p>
            {user.isSuperAdmin && (
              <span style={{ 
                display: 'inline-block',
                marginTop: 'var(--spacing-xs)',
                padding: '2px 8px',
                background: 'var(--color-primary)',
                color: 'white',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.75rem',
              }}>
                Super Admin
              </span>
            )}
            {user.isAccountant && !user.isSuperAdmin && (
              <span style={{ 
                display: 'inline-block',
                marginTop: 'var(--spacing-xs)',
                padding: '2px 8px',
                background: 'var(--color-secondary)',
                color: 'white',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.75rem',
              }}>
                Accountant
              </span>
            )}
          </div>
        )}

        {/* Logout button */}
        <LogoutButton />

        {/* Debug info - remove later */}
        <div style={{ 
          marginTop: 'var(--spacing-xl)', 
          padding: 'var(--spacing-md)', 
          background: 'var(--color-bg-secondary)', 
          borderRadius: 'var(--radius-md)',
          fontSize: '0.85rem',
          textAlign: 'left'
        }}>
          <strong>Debug Info:</strong>
          <pre style={{ margin: 'var(--spacing-sm) 0 0 0', whiteSpace: 'pre-wrap' }}>
{JSON.stringify({ 
  subdomain, 
  tenantLoading, 
  tenantError, 
  tenant,
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
        </div>
      </div>
    </div>
  )
}

function LogoutButton() {
  const { logout } = useAuth()

  return (
    <button
      onClick={logout}
      style={{
        marginTop: 'var(--spacing-lg)',
        padding: 'var(--spacing-sm) var(--spacing-lg)',
        background: 'transparent',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer',
        fontSize: '0.9rem',
      }}
    >
      Sign Out
    </button>
  )
}

export default App