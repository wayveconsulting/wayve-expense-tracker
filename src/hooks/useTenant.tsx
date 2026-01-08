import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

interface Tenant {
  id: string;
  name: string;
  subdomain: string;
  logoUrl: string | null;
  primaryColor: string | null;
  appName: string | null;
  isActive: boolean;
}

interface TenantContextType {
  tenant: Tenant | null;
  isLoading: boolean;
  error: string | null;
  subdomain: string | null;
}

const TenantContext = createContext<TenantContextType>({
  tenant: null,
  isLoading: true,
  error: null,
  subdomain: null,
});

export function useTenant() {
  return useContext(TenantContext);
}

function getSubdomainFromHost(hostname: string): string | null {
  // Handle localhost development (e.g., localhost:5173?tenant=izrgrooming)
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    const params = new URLSearchParams(window.location.search);
    return params.get('tenant');
  }

  // Handle Vercel preview URLs (e.g., wayve-expense-tracker.vercel.app)
  if (hostname.endsWith('.vercel.app')) {
    const params = new URLSearchParams(window.location.search);
    return params.get('tenant');
  }

  // Handle production subdomains (e.g., izrgrooming.wayveconsulting.app)
  const parts = hostname.split('.');
  
  // Expected format: subdomain.wayveconsulting.app (3 parts)
  // or subdomain.domain.com (3 parts)
  if (parts.length >= 3) {
    const subdomain = parts[0];
    // Ignore 'www' as a subdomain
    if (subdomain === 'www') {
      return null;
    }
    return subdomain;
  }

  // Fallback: check query param for root domain (e.g., wayveconsulting.app?tenant=sandbox)
  const params = new URLSearchParams(window.location.search);
  return params.get('tenant');
}

interface TenantProviderProps {
  children: ReactNode;
}

export function TenantProvider({ children }: TenantProviderProps) {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subdomain, setSubdomain] = useState<string | null>(null);

  useEffect(() => {
    const detectedSubdomain = getSubdomainFromHost(window.location.hostname);
    setSubdomain(detectedSubdomain);

    if (!detectedSubdomain) {
      // No subdomain = root domain (marketing site or login redirect)
      setIsLoading(false);
      return;
    }

    // Fetch tenant info
    async function fetchTenant() {
      try {
        const response = await fetch(`/api/tenant?subdomain=${detectedSubdomain}`);
        
        if (response.status === 404) {
          setError('Business not found. Please check the URL.');
          setIsLoading(false);
          return;
        }

        if (response.status === 403) {
          setError('This account is no longer active.');
          setIsLoading(false);
          return;
        }

        if (!response.ok) {
          throw new Error('Failed to load business information');
        }

        const data = await response.json();
        setTenant(data);
        
        // Apply tenant branding to CSS variables
        if (data.primaryColor) {
          document.documentElement.style.setProperty('--color-primary', data.primaryColor);
        }
        
      } catch (err) {
        console.error('Tenant fetch error:', err);
        setError('Unable to load business information. Please try again.');
      } finally {
        setIsLoading(false);
      }
    }

    fetchTenant();
  }, []);

  return (
    <TenantContext.Provider value={{ tenant, isLoading, error, subdomain }}>
      {children}
    </TenantContext.Provider>
  );
}