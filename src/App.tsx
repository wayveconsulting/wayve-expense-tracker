import { useTenant } from './hooks/useTenant'

function App() {
  const { tenant, isLoading, error, subdomain } = useTenant()

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
        
        {isLoading && (
          <p style={{ color: 'var(--color-text-secondary)', marginTop: 'var(--spacing-sm)' }}>
            Loading...
          </p>
        )}

        {error && (
          <p style={{ color: 'var(--color-error)', marginTop: 'var(--spacing-sm)' }}>
            {error}
          </p>
        )}

        {!isLoading && !error && !subdomain && (
          <p style={{ color: 'var(--color-text-secondary)', marginTop: 'var(--spacing-sm)' }}>
            Welcome! Use a subdomain to access your business portal.
          </p>
        )}

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
{JSON.stringify({ subdomain, isLoading, error, tenant }, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  )
}

export default App