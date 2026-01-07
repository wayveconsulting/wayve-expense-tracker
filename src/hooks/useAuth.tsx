import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

// Types
interface Tenant {
  id: string;
  name: string;
  subdomain: string;
  logoUrl: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  appName?: string | null;
}

interface TenantAccess {
  tenantId: string;
  role: string;
  canEdit: boolean;
  tenant: Tenant;
}

interface User {
  id: string;
  email: string;
  name: string | null;
  tenantId: string | null;
  role: string;
  isSuperAdmin: boolean;
  isAccountant: boolean;
  theme: string | null;
  primaryTenant: Tenant | null;
  tenantAccess: TenantAccess[];
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isSuperAdmin: boolean;
  isAccountant: boolean;
  error: string | null;
  login: (redirect?: string) => void;
  logout: () => Promise<void>;
  refreshAuth: () => Promise<void>;
}

// Context
const AuthContext = createContext<AuthContextType | null>(null);

// Provider component
interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Check auth status
  const refreshAuth = useCallback(async () => {
    try {
      setError(null);
      const response = await fetch('/api/auth/me', {
        credentials: 'include', // Important: sends cookies
      });

      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
      } else {
        setUser(null);
        if (response.status !== 401) {
          // Only set error for unexpected failures
          const data = await response.json().catch(() => ({}));
          setError(data.error || 'Authentication check failed');
        }
      }
    } catch (err) {
      console.error('Auth check failed:', err);
      setUser(null);
      setError('Network error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Check auth on mount
  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  // Login - redirect to Google OAuth
  const login = useCallback((redirect?: string) => {
    const params = redirect ? `?redirect=${encodeURIComponent(redirect)}` : '';
    window.location.href = `/api/auth/google${params}`;
  }, []);

  // Logout
  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      setUser(null);
      window.location.href = '/login';
    }
  }, []);

  const value: AuthContextType = {
    user,
    isLoading,
    isAuthenticated: !!user,
    isSuperAdmin: user?.isSuperAdmin ?? false,
    isAccountant: user?.isAccountant ?? false,
    error,
    login,
    logout,
    refreshAuth,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

// Hook
export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// Convenience component for protected routes
interface RequireAuthProps {
  children: ReactNode;
  fallback?: ReactNode;
  requiredRole?: 'superAdmin' | 'accountant';
}

export function RequireAuth({ children, fallback, requiredRole }: RequireAuthProps) {
  const { isAuthenticated, isLoading, isSuperAdmin, isAccountant, login } = useAuth();

  if (isLoading) {
    return fallback || <div>Loading...</div>;
  }

  if (!isAuthenticated) {
    // Redirect to login
    login(window.location.pathname);
    return fallback || <div>Redirecting to login...</div>;
  }

  // Check role requirements
  if (requiredRole === 'superAdmin' && !isSuperAdmin) {
    return <div>Access denied. Super admin privileges required.</div>;
  }

  if (requiredRole === 'accountant' && !isAccountant && !isSuperAdmin) {
    return <div>Access denied. Accountant privileges required.</div>;
  }

  return <>{children}</>;
}