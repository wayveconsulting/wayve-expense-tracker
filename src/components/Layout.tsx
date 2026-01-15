import { useState } from 'react'
import { Link, useLocation } from 'wouter'
import { useTenant } from '../hooks/useTenant'
import { useAuth } from '../hooks/useAuth'
import { useYear } from '../hooks/useYear'
import { useRefresh } from '../hooks/useRefresh'
import { useSettings } from '../hooks/useSettings'
import { AddExpenseSheet } from './AddExpenseSheet'

interface LayoutProps {
  children: React.ReactNode
}

export function Layout({ children }: LayoutProps) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const { tenant } = useTenant()
  const { user, logout } = useAuth()
  const [location] = useLocation()
  const { year, nextYear, prevYear } = useYear()
  const { refreshExpenses } = useRefresh()
  const { showFab } = useSettings()
  const currentYear = new Date().getFullYear()

  const appName = tenant?.name || 'Expense Tracker'

  const closeDrawer = () => setDrawerOpen(false)

  const handleExpenseAdded = () => {
    refreshExpenses()
  }

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
        onClick={closeDrawer}
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

        {/* Year Selector */}
        <div className="drawer__year-selector">
          <button 
            className="year-selector__btn year-selector__btn--prev" 
            aria-label="Previous year"
            onClick={prevYear}
            disabled={year <= 2020}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <span className="year-selector__year">{year}</span>
          <button 
            className="year-selector__btn year-selector__btn--next" 
            aria-label="Next year"
            onClick={nextYear}
            disabled={year >= currentYear}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>

        {/* Navigation Links */}
        <ul className="drawer__nav">
          <NavItem icon="dashboard" label="Dashboard" href="/" currentPath={location} onClick={closeDrawer} />
          <NavItem icon="receipt" label="Expenses" href="/expenses" currentPath={location} onClick={closeDrawer} />
          <NavItem icon="car" label="Mileage" href="/mileage" currentPath={location} onClick={closeDrawer} />
          <NavItem icon="folder" label="Categories" href="/categories" currentPath={location} onClick={closeDrawer} />
          <NavItem icon="chart" label="Reports" href="/reports" currentPath={location} onClick={closeDrawer} />
          <NavItem icon="settings" label="Settings" href="/settings" currentPath={location} onClick={closeDrawer} />
        </ul>

        {/* Profile Section */}
        <div className="drawer__profile">
          <div className="drawer__profile-info">
            <div className="drawer__avatar">
              {user?.name?.[0] || user?.email?.[0]?.toUpperCase() || '?'}
            </div>
            <div className="drawer__profile-text">
              <span className="drawer__profile-name">
                {user?.name || user?.email}
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

      {/* Global FAB */}
      {showFab && (
        <button 
          className="fab" 
          onClick={() => setSheetOpen(true)}
          aria-label="Add expense"
        >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        </button>
      )}

      {/* Global Add Expense Sheet */}
      <AddExpenseSheet
        isOpen={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onSuccess={handleExpenseAdded}
      />
    </div>
  )
}

interface NavItemProps {
  icon: 'dashboard' | 'receipt' | 'car' | 'folder' | 'chart' | 'settings'
  label: string
  href: string
  currentPath: string
  onClick: () => void
}

function NavItem({ icon, label, href, currentPath, onClick }: NavItemProps) {
  const isActive = href === '/' ? currentPath === '/' : currentPath.startsWith(href)

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
    settings: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
      </svg>
    ),
  }

  return (
    <li>
      <Link 
        href={href} 
        className={`drawer__nav-item ${isActive ? 'drawer__nav-item--active' : ''}`}
        onClick={onClick}
      >
        {icons[icon]}
        <span>{label}</span>
      </Link>
    </li>
  )
}