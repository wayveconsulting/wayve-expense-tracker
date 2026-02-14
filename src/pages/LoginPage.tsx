import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useTenant } from '../hooks/useTenant';

export function LoginPage() {
  const { isAuthenticated, isLoading: authLoading, login } = useAuth();
  const { tenant, isLoading: tenantLoading } = useTenant();
  const [error, setError] = useState<string | null>(null);

  // Check for error in URL params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const errorParam = params.get('error');
    
    if (errorParam) {
      const errorMessages: Record<string, string> = {
        'not_invited': 'Your account has not been invited to this application. Please contact your administrator.',
        'email_not_verified': 'Your Google email is not verified. Please verify your email and try again.',
        'account_mismatch': 'This Google account is linked to a different user. Please contact support.',
        'no_tenant_access': 'Your account does not have access to any organizations. Please contact your administrator.',
        'token_exchange_failed': 'Authentication failed. Please try again.',
        'user_info_failed': 'Could not retrieve your account information. Please try again.',
        'server_error': 'An unexpected error occurred. Please try again.',
        'missing_code': 'Authentication was cancelled or failed. Please try again.',
      };
      
      setError(errorMessages[errorParam] || `Authentication error: ${errorParam}`);
      
      // Clean up URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // Redirect if already authenticated
  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      window.location.href = '/';
    }
  }, [authLoading, isAuthenticated]);

  const handleGoogleLogin = () => {
    setError(null);
    login();
  };

  const isLoading = authLoading || tenantLoading;

  // Get branding from tenant (if on a subdomain) or use defaults
  const appName = tenant?.appName || 'Wayve Expense Tracker';
  const logoUrl = tenant?.logoUrl;
  const primaryColor = tenant?.primaryColor || '#2A9D8F';

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        {/* Logo / App Name */}
        <div style={styles.header}>
          {logoUrl ? (
            <img src={logoUrl} alt={appName} style={styles.logo} />
          ) : (
            <div style={{ ...styles.logoPlaceholder, backgroundColor: primaryColor }}>
              {appName.charAt(0)}
            </div>
          )}
          <h1 style={styles.title}>{appName}</h1>
          {tenant && (
            <p style={styles.subtitle}>{tenant.name}</p>
          )}
        </div>

        {/* Error Message */}
        {error && (
          <div style={styles.error}>
            {error}
          </div>
        )}

        {/* Login Button */}
        {isLoading ? (
          <div style={styles.loading}>Loading...</div>
        ) : (
          <div style={styles.buttons}>
            <button
              onClick={handleGoogleLogin}
              style={styles.googleButton}
            >
              <svg style={styles.googleIcon} viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Sign in with Google
            </button>

          </div>
        )}

        {/* Footer */}
        <p style={styles.footer}>
          Don't have an account? Contact your administrator for an invite.
        </p>
      </div>
    </div>
  );
}

// Inline styles (we'll move to CSS later)
const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5f5f5',
    padding: '20px',
  },
  card: {
    backgroundColor: 'white',
    borderRadius: '12px',
    padding: '40px',
    maxWidth: '400px',
    width: '100%',
    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
    textAlign: 'center',
  },
  header: {
    marginBottom: '32px',
  },
  logo: {
    width: '80px',
    height: '80px',
    objectFit: 'contain',
    marginBottom: '16px',
  },
  logoPlaceholder: {
    width: '80px',
    height: '80px',
    borderRadius: '16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 16px',
    fontSize: '36px',
    fontWeight: 'bold',
    color: 'white',
  },
  title: {
    fontSize: '24px',
    fontWeight: '600',
    color: '#264653',
    margin: '0 0 8px 0',
  },
  subtitle: {
    fontSize: '14px',
    color: '#666',
    margin: 0,
  },
  error: {
    backgroundColor: '#fee2e2',
    border: '1px solid #ef4444',
    borderRadius: '8px',
    padding: '12px 16px',
    marginBottom: '24px',
    color: '#dc2626',
    fontSize: '14px',
    textAlign: 'left',
  },
  loading: {
    color: '#666',
    fontSize: '14px',
  },
  buttons: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  googleButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    width: '100%',
    padding: '12px 24px',
    fontSize: '16px',
    fontWeight: '500',
    color: '#333',
    backgroundColor: 'white',
    border: '1px solid #ddd',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'background-color 0.2s, box-shadow 0.2s',
  },
  googleIcon: {
    width: '20px',
    height: '20px',
  },
  footer: {
    marginTop: '32px',
    fontSize: '13px',
    color: '#888',
  },
};