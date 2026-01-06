import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/theme.css'
import { TenantProvider } from './hooks/useTenant.tsx'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TenantProvider>
      <App />
    </TenantProvider>
  </StrictMode>,
)