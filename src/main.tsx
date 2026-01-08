import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/theme.css'
import './styles/layout.css'
import { TenantProvider } from './hooks/useTenant.tsx'
import { AuthProvider } from './hooks/useAuth.tsx'
import { YearProvider } from './hooks/useYear.tsx'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TenantProvider>
      <AuthProvider>
        <YearProvider>
          <App />
        </YearProvider>
      </AuthProvider>
    </TenantProvider>
  </StrictMode>,
)