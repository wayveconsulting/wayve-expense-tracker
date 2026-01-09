import { useAuth } from '../hooks/useAuth'
import { useTenant } from '../hooks/useTenant'

export default function SettingsPage() {
  const { user, logout } = useAuth()
  const { tenant } = useTenant()

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
            <div className="settings-row">
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
          <div className="settings-row">
            <div className="settings-row__label">
              <span className="settings-row__title">Dark Mode</span>
              <span className="settings-row__description">Use dark theme throughout the app</span>
            </div>
            <button className="toggle toggle--disabled" disabled>
              <span className="toggle__slider" />
            </button>
          </div>
          <div className="settings-row">
            <div className="settings-row__label">
              <span className="settings-row__title">Email Notifications</span>
              <span className="settings-row__description">Receive weekly expense summaries</span>
            </div>
            <button className="toggle toggle--disabled" disabled>
              <span className="toggle__slider" />
            </button>
          </div>
          <div className="settings-row settings-row--last">
            <div className="settings-row__label">
              <span className="settings-row__title">Quick Add Button</span>
              <span className="settings-row__description">Show floating button to add expenses</span>
            </div>
            <button className="toggle toggle--disabled" disabled>
              <span className="toggle__slider" />
            </button>
          </div>
        </div>
        <p className="settings-section__note">Preferences coming soon</p>
      </section>

      {/* Danger Zone */}
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