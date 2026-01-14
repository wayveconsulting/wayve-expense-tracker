import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/theme.css'
import './styles/layout.css'
import { TenantProvider } from './hooks/useTenant.tsx'
import { AuthProvider } from './hooks/useAuth.tsx'
import { YearProvider } from './hooks/useYear.tsx'
import { RefreshProvider } from './hooks/useRefresh.tsx'
import { SettingsProvider } from './hooks/useSettings.tsx'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <AuthProvider>
        <TenantProvider>
          <YearProvider>
            <RefreshProvider>
              <App />
            </RefreshProvider>
          </YearProvider>
        </TenantProvider>
      </AuthProvider>
    </SettingsProvider>
  </StrictMode>,
)