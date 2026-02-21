import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useTenant } from '../hooks/useTenant'
import { useSettings } from '../hooks/useSettings'

interface Category {
  id: string
  name: string
  emoji: string
}

export default function SettingsPage() {
  const { user, logout } = useAuth()
  const { tenant, subdomain } = useTenant()
  const { darkMode, setDarkMode, showFab, setShowFab } = useSettings()

  // Default category state
  const [categories, setCategories] = useState<Category[]>([])
  const [defaultCategoryId, setDefaultCategoryId] = useState<string>('')
  const [savingDefault, setSavingDefault] = useState(false)
  const [defaultSaved, setDefaultSaved] = useState(false)

  // Fetch categories and current default on mount
  useEffect(() => {
    if (!subdomain) return
    async function fetchData() {
      try {
        const response = await fetch(`/api/categories?tenant=${subdomain}`)
        if (!response.ok) return
        const data = await response.json()
        setCategories(
          [...data.categories]
            .sort((a: Category, b: Category) => a.name.localeCompare(b.name))
        )
        setDefaultCategoryId(data.homeOfficeSettings?.defaultCategoryId || '')
      } catch (err) {
        console.error('Error fetching categories:', err)
      }
    }
    fetchData()
  }, [subdomain])

  // Save default category
  async function handleDefaultCategoryChange(categoryId: string) {
    setDefaultCategoryId(categoryId)
    setDefaultSaved(false)
    setSavingDefault(true)
    try {
      const response = await fetch(`/api/categories/default-category?tenant=${subdomain}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultCategoryId: categoryId || null }),
      })
      if (response.ok) {
        setDefaultSaved(true)
        setTimeout(() => setDefaultSaved(false), 2000)
      }
    } catch (err) {
      console.error('Error saving default category:', err)
    } finally {
      setSavingDefault(false)
    }
  }

  return (
    <div className="page settings-page">
      <h1 className="settings-page__title">Settings</h1>

      {/* Profile Section */}
      <section className="settings-section">
        <h2 className="settings-section__title">Profile</h2>
        <div className="card">
          <div className="profile-display">
            <div className="profile-display__avatar">
              {user?.name?.[0] || user?.email?.[0]?.toUpperCase() || '?'}
            </div>
            <div className="profile-display__info">
              <span className="profile-display__name">{user?.name || 'User'}</span>
              <span className="profile-display__email">{user?.email}</span>
              <span className="profile-display__role">
                {user?.isSuperAdmin ? 'Super Admin' : user?.isAccountant ? 'Accountant' : user?.role || 'User'}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Business Section */}
      {tenant && (
        <section className="settings-section">
          <h2 className="settings-section__title">Business</h2>
          <div className="card">
            <div className="settings-row">
              <div className="settings-row__label">
                <span className="settings-row__title">Business Name</span>
              </div>
              <span className="settings-row__value">{tenant.name}</span>
            </div>
            <div className="settings-row settings-row--last">
              <div className="settings-row__label">
                <span className="settings-row__title">Subdomain</span>
              </div>
              <span className="settings-row__value">{tenant.subdomain}.wayveconsulting.app</span>
            </div>
          </div>
        </section>
      )}

      {/* Preferences Section */}
      <section className="settings-section">
        <h2 className="settings-section__title">Preferences</h2>
        <div className="card">
          {/* Default Category */}
          <div className="settings-row">
            <div className="settings-row__label">
              <span className="settings-row__title">Default Category</span>
              <span className="settings-row__description">
                Pre-select this category when adding expenses
                {defaultSaved && <span className="settings-row__saved"> — Saved!</span>}
              </span>
            </div>
            <select
              className="form-input settings-row__select"
              value={defaultCategoryId}
              onChange={(e) => handleDefaultCategoryChange(e.target.value)}
              disabled={savingDefault}
            >
              <option value="">None (require selection)</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>
              ))}
            </select>
          </div>
          {/* Dark Mode */}
          <div className="settings-row">
            <div className="settings-row__label">
              <span className="settings-row__title">Dark Mode</span>
              <span className="settings-row__description">Use dark theme throughout the app</span>
            </div>
            <button
              className={`toggle ${darkMode ? 'toggle--active' : ''}`}
              onClick={() => setDarkMode(!darkMode)}
              role="switch"
              aria-checked={darkMode}
            >
              <span className="toggle__slider" />
            </button>
          </div>
          {/* Email Notifications */}
          <div className="settings-row">
            <div className="settings-row__label">
              <span className="settings-row__title">Email Notifications</span>
              <span className="settings-row__description">Receive weekly expense summaries</span>
            </div>
            <button className="toggle toggle--disabled" disabled>
              <span className="toggle__slider" />
            </button>
          </div>
          {/* Quick Add Button */}
          <div className="settings-row settings-row--last">
            <div className="settings-row__label">
              <span className="settings-row__title">Quick Add Button</span>
              <span className="settings-row__description">Show floating button to add expenses</span>
            </div>
            <button
              className={`toggle ${showFab ? 'toggle--active' : ''}`}
              onClick={() => setShowFab(!showFab)}
              role="switch"
              aria-checked={showFab}
            >
              <span className="toggle__slider" />
            </button>
          </div>
        </div>
      </section>

      {/* Account Section */}
      <section className="settings-section">
        <h2 className="settings-section__title">Account</h2>
        <div className="card">
          <div className="settings-row settings-row--last">
            <div className="settings-row__label">
              <span className="settings-row__title">Sign Out</span>
              <span className="settings-row__description">Sign out of your account on this device</span>
            </div>
            <button className="btn btn--danger" onClick={logout}>
              Sign Out
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
