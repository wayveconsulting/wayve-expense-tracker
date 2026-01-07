import { useState } from 'react'
import { useTenant } from '../hooks/useTenant'
import { useAuth } from '../hooks/useAuth'

interface LayoutProps {
  children: React.ReactNode
}

export function Layout({ children }: LayoutProps) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { tenant } = useTenant()
  const { user, logout } = useAuth()

  const appName = tenant?.appName || tenant?.name || 'Wayve Expense Tracker'

  return (
    <div className="layout">
      {/* Header */}
      <header className="header">
        <button 
          className="header__menu-btn"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open menu"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>

        <h1 className="header__title">{appName}</h1>

        {/* Spacer to center title */}
        <div className="header__spacer" />
      </header>

      {/* Navigation Drawer Overlay */}
      <div 
        className={`drawer-overlay ${drawerOpen ? 'drawer-overlay--open' : ''}`}
        onClick={() => setDrawerOpen(false)}
      />

      {/* Navigation Drawer */}
      <nav className={`drawer ${drawerOpen ? 'drawer--open' : ''}`}>
        <div className="drawer__header">
          {tenant?.logoUrl ? (
            <img src={tenant.logoUrl} alt={tenant.name} className="drawer__logo" />
          ) : (
            <div className="drawer__logo-placeholder">
              <span>{(tenant?.name || 'W')[0]}</span>
            </div>
          )}
          <span className="drawer__app-name">{appName}</span>
        </div>

        {/* Year Selector - TODO: Make functional */}
        <div className="drawer__year-selector">
          <button className="year-selector__btn year-selector__btn--prev" aria-label="Previous year">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <span className="year-selector__year">2025</span>
          <button className="year-selector__btn year-selector__btn--next" aria-label="Next year">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>

        {/* Navigation Links */}
        <ul className="drawer__nav">
          <NavItem icon="dashboard" label="Dashboard" href="/" active />
          <NavItem icon="receipt" label="Expenses" href="/expenses" />
          <NavItem icon="car" label="Mileage" href="/mileage" />
          <NavItem icon="folder" label="Categories" href="/categories" />
          <NavItem icon="chart" label="Reports" href="/reports" />
        </ul>

        {/* Profile Section */}
        <div className="drawer__profile">
          <div className="drawer__profile-info">
            <div className="drawer__avatar">
              {user?.firstName?.[0] || user?.email?.[0]?.toUpperCase() || '?'}
            </div>
            <div className="drawer__profile-text">
              <span className="drawer__profile-name">
                {user?.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : user?.email}
              </span>
              <span className="drawer__profile-role">{user?.role || 'User'}</span>
            </div>
          </div>
          <button className="drawer__logout-btn" onClick={logout} aria-label="Sign out">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </nav>

      {/* Main Content */}
      <main className="main-content">
        {children}
      </main>
    </div>
  )
}

interface NavItemProps {
  icon: 'dashboard' | 'receipt' | 'car' | 'folder' | 'chart'
  label: string
  href: string
  active?: boolean
}

function NavItem({ icon, label, href, active }: NavItemProps) {
  const icons = {
    dashboard: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="7" height="9" rx="1" />
        <rect x="14" y="3" width="7" height="5" rx="1" />
        <rect x="14" y="12" width="7" height="9" rx="1" />
        <rect x="3" y="16" width="7" height="5" rx="1" />
      </svg>
    ),
    receipt: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 3 2V2l-3 2-3-2-3 2-3-2-3 2-3-2z" />
        <line x1="8" y1="8" x2="16" y2="8" />
        <line x1="8" y1="12" x2="16" y2="12" />
        <line x1="8" y1="16" x2="12" y2="16" />
      </svg>
    ),
    car: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M5 17h14v-5H5v5zm2-3h2v2H7v-2zm8 0h2v2h-2v-2z" />
        <path d="M5 12l2-5h10l2 5" />
        <circle cx="7" cy="17" r="2" />
        <circle cx="17" cy="17" r="2" />
      </svg>
    ),
    folder: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    ),
    chart: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
  }

  return (
    <li>
      <a 
        href={href} 
        className={`drawer__nav-item ${active ? 'drawer__nav-item--active' : ''}`}
      >
        {icons[icon]}
        <span>{label}</span>
      </a>
    </li>
  )
}