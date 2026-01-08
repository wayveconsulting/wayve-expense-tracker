import { Route, Switch } from 'wouter'
import { useTenant } from './hooks/useTenant'
import { useAuth } from './hooks/useAuth'
import { LoginPage } from './pages/LoginPage'
import { Layout } from './components/Layout'
import DashboardPage from './pages/DashboardPage'
import ExpensesPage from './pages/ExpensesPage'
import MileagePage from './pages/MileagePage'
import CategoriesPage from './pages/CategoriesPage'
import ReportsPage from './pages/ReportsPage'
import SettingsPage from './pages/SettingsPage'

function App() {
  const { tenant, isLoading: tenantLoading, error: tenantError, subdomain } = useTenant()
  const { user, isLoading: authLoading, isAuthenticated } = useAuth()

  // Simple routing based on path - login doesn't need Layout
  const path = window.location.pathname
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

  // Main app (authenticated) with routing
  return (
    <Layout>
      <Switch>
        <Route path="/" component={DashboardPage} />
        <Route path="/expenses" component={ExpensesPage} />
        <Route path="/mileage" component={MileagePage} />
        <Route path="/categories" component={CategoriesPage} />
        <Route path="/reports" component={ReportsPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route>
          <div className="page">
            <h1>404</h1>
            <p>Page not found</p>
          </div>
        </Route>
      </Switch>
    </Layout>
  )
}

export default App