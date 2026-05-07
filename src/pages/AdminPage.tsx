import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { Link } from 'wouter'

interface InviteTenant {
  id: string
  name: string
  subdomain: string
  deletedAt: string | null
  restoredAt: string | null
  role: string
}

interface Client {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  role: string
  status: string
  expiresAt: string
  acceptedAt: string | null
  createdAt: string
  invitedByFirstName: string | null
  invitedByLastName: string | null
  invitedByEmail: string
  ownerLastLoginAt: string | null
  tenants: InviteTenant[]
}

interface ExistingTenant {
  id: string
  name: string
  subdomain: string
}

interface NewTenantRow {
  key: number
  businessName: string
  subdomain: string
  subdomainEdited: boolean
}

export default function AdminPage() {
  const { isSuperAdmin } = useAuth()
  const [listRefreshKey, setListRefreshKey] = useState(0)

  if (!isSuperAdmin) {
    return (
      <div className="page">
        <div className="admin-forbidden">
          <h1>🔐 Access Denied</h1>
          <p>You don't have access to this page.</p>
          <Link href="/" className="btn btn--primary">Back to Dashboard</Link>
        </div>
      </div>
    )
  }

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  return (
    <div className="page">
      <h2 className="page-title">Admin</h2>
      <InviteForm onSuccess={() => setListRefreshKey(k => k + 1)} />
      <ClientList refreshKey={listRefreshKey} onRefresh={() => setListRefreshKey(k => k + 1)} />

      {/* Deletion Zone entry point */}
      <div className="admin-section admin-section--danger">
        <button
          className="btn btn--danger btn--full"
          onClick={() => setShowDeleteConfirm(true)}
        >
          ⚠️ Deletion Zone
        </button>
      </div>

      {/* Entry confirmation modal */}
      {showDeleteConfirm && (
        <div className="admin-modal-backdrop" onClick={() => setShowDeleteConfirm(false)}>
          <div className="admin-modal admin-modal--danger" onClick={e => e.stopPropagation()}>
            <h3 className="admin-modal__title">⚠️ Deletion Zone</h3>
            <p className="admin-modal__message">
              You are entering the area where accounts can be deleted. Are you sure you want to proceed?
            </p>
            <div className="admin-modal__actions">
              <button className="btn btn--secondary" onClick={() => setShowDeleteConfirm(false)}>
                Cancel
              </button>
              <Link href="/admin/delete" className="btn btn--danger">
                Enter Deletion Zone
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================
// INVITE FORM
// ============================================
let newTenantKeyCounter = 0

function InviteForm({ onSuccess }: { onSuccess: () => void }) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')

  const [existingTenants, setExistingTenants] = useState<ExistingTenant[]>([])
  const [selectedTenantIds, setSelectedTenantIds] = useState<Set<string>>(new Set())
  const [tenantsLoading, setTenantsLoading] = useState(true)
  const [tenantsError, setTenantsError] = useState<string | null>(null)

  const [newTenantRows, setNewTenantRows] = useState<NewTenantRow[]>([])

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    async function fetchTenants() {
      try {
        const response = await fetch('/api/admin/tenants', { credentials: 'include' })
        if (response.ok) {
          const data = await response.json()
          setExistingTenants(data.tenants)
        } else {
          setTenantsError('Failed to load tenants')
        }
      } catch {
        setTenantsError('Network error loading tenants')
      } finally {
        setTenantsLoading(false)
      }
    }
    fetchTenants()
  }, [])

  const toggleTenant = (id: string) => {
    setSelectedTenantIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const addNewTenantRow = () => {
    setNewTenantRows(prev => [
      ...prev,
      { key: newTenantKeyCounter++, businessName: '', subdomain: '', subdomainEdited: false },
    ])
  }

  const removeNewTenantRow = (key: number) => {
    setNewTenantRows(prev => prev.filter(r => r.key !== key))
  }

  const updateNewTenantRow = (key: number, field: 'businessName' | 'subdomain', value: string) => {
    setNewTenantRows(prev =>
      prev.map(r => {
        if (r.key !== key) return r

        if (field === 'businessName') {
          const suggested = value
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '')
            .slice(0, 30)
          return {
            ...r,
            businessName: value,
            subdomain: r.subdomainEdited ? r.subdomain : suggested,
          }
        }

        if (field === 'subdomain') {
          return {
            ...r,
            subdomain: value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30),
            subdomainEdited: true,
          }
        }

        return r
      })
    )
  }

  const handleSubmit = async () => {
    setError(null)
    setSuccess(null)

    if (!email) {
      setError('Email is required')
      return
    }

    const tenantIds = [...selectedTenantIds]
    const newTenants = newTenantRows.map(r => ({
      businessName: r.businessName.trim(),
      subdomain: r.subdomain,
    }))

    if (tenantIds.length === 0 && newTenants.length === 0) {
      setError('Select at least one tenant or add a new one')
      return
    }

    for (const t of newTenants) {
      if (!t.businessName) {
        setError('All new tenants must have a business name')
        return
      }
      if (t.subdomain.length < 3) {
        setError(`Subdomain "${t.subdomain}" must be at least 3 characters`)
        return
      }
    }

    setSubmitting(true)

    try {
      const response = await fetch('/api/admin/invites/bulk', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          firstName: firstName.trim() || null,
          lastName: lastName.trim() || null,
          tenantIds,
          newTenants,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        setError(data.error || 'Failed to send invite')
        return
      }

      const data = await response.json()
      const tenantNames = (data.tenants as { name: string }[]).map(t => t.name).join(', ')
      setSuccess(`Invite sent to ${email.trim()} for: ${tenantNames}`)

      setFirstName('')
      setLastName('')
      setEmail('')
      setSelectedTenantIds(new Set())
      setNewTenantRows([])

      // Refresh tenant checklist so newly created tenants appear
      const refreshResponse = await fetch('/api/admin/tenants', { credentials: 'include' })
      if (refreshResponse.ok) {
        const refreshData = await refreshResponse.json()
        setExistingTenants(refreshData.tenants)
      }

      onSuccess()
    } catch {
      setError('Network error — please try again')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="admin-section">
      <h3 className="admin-section__title">Invite New Client</h3>

      {error && <div className="admin-alert admin-alert--error">{error}</div>}
      {success && <div className="admin-alert admin-alert--success">{success}</div>}

      <div className="admin-form">
        <div className="admin-form__row">
          <div className="admin-form__field">
            <label className="admin-form__label">First Name</label>
            <input
              type="text"
              className="admin-form__input"
              value={firstName}
              onChange={e => setFirstName(e.target.value)}
              placeholder="Joe"
            />
          </div>
          <div className="admin-form__field">
            <label className="admin-form__label">Last Name</label>
            <input
              type="text"
              className="admin-form__input"
              value={lastName}
              onChange={e => setLastName(e.target.value)}
              placeholder="Smith"
            />
          </div>
        </div>

        <div className="admin-form__field">
          <label className="admin-form__label">Email *</label>
          <input
            type="email"
            className="admin-form__input"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="joe@example.com"
          />
        </div>

        <div className="admin-form__field">
          <label className="admin-form__label">Tenant(s) *</label>

          {tenantsLoading && (
            <p className="admin-form__hint">Loading tenants...</p>
          )}

          {tenantsError && (
            <p className="admin-form__hint admin-form__hint--error">{tenantsError}</p>
          )}

          {!tenantsLoading && !tenantsError && (
            <div className="admin-form__tenant-checklist">
              {existingTenants.length === 0 && newTenantRows.length === 0 && (
                <p className="admin-form__hint">No existing tenants — add one below.</p>
              )}

              {existingTenants.map(tenant => (
                <label key={tenant.id} className="admin-form__tenant-option">
                  <input
                    type="checkbox"
                    className="admin-form__tenant-checkbox"
                    checked={selectedTenantIds.has(tenant.id)}
                    onChange={() => toggleTenant(tenant.id)}
                  />
                  <span className="admin-form__tenant-name">{tenant.name}</span>
                  <span className="admin-form__tenant-subdomain">{tenant.subdomain}.wayveexpenses.app</span>
                </label>
              ))}

              {newTenantRows.map(row => (
                <div key={row.key} className="admin-form__new-tenant-row">
                  <div className="admin-form__new-tenant-fields">
                    <input
                      type="text"
                      className="admin-form__input"
                      value={row.businessName}
                      onChange={e => updateNewTenantRow(row.key, 'businessName', e.target.value)}
                      placeholder="Business Name"
                    />
                    <div className="admin-form__subdomain-wrapper">
                      <input
                        type="text"
                        className="admin-form__input admin-form__input--subdomain"
                        value={row.subdomain}
                        onChange={e => updateNewTenantRow(row.key, 'subdomain', e.target.value)}
                        placeholder="subdomain"
                      />
                      <span className="admin-form__subdomain-suffix">.wayveexpenses.app</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="admin-form__remove-tenant"
                    onClick={() => removeNewTenantRow(row.key)}
                    aria-label="Remove tenant"
                  >
                    ×
                  </button>
                </div>
              ))}

              <button
                type="button"
                className="admin-form__add-tenant-btn"
                onClick={addNewTenantRow}
              >
                + Add New Tenant
              </button>
            </div>
          )}
        </div>

        <button
          className="btn btn--primary btn--full"
          onClick={handleSubmit}
          disabled={submitting}
        >
          {submitting ? 'Sending...' : 'Send Invite'}
        </button>
      </div>
    </div>
  )
}

// ============================================
// CLIENT LIST
// ============================================
function ClientList({ refreshKey, onRefresh }: { refreshKey: number; onRefresh: () => void }) {
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resending, setResending] = useState<string | null>(null)
  const [restoring, setRestoring] = useState<string | null>(null)

  const fetchClients = async () => {
    try {
      const response = await fetch('/api/admin/invites', { credentials: 'include' })
      if (response.ok) {
        const data = await response.json()
        setClients(data.invites)
      } else {
        setError('Failed to load clients')
      }
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchClients()
  }, [refreshKey])

  const handleResend = async (inviteId: string) => {
    setResending(inviteId)
    try {
      const response = await fetch(`/api/admin/invites/${inviteId}`, {
        method: 'PUT',
        credentials: 'include',
      })
      if (response.ok) await fetchClients()
    } catch {
      // Silent fail
    } finally {
      setResending(null)
    }
  }

  const handleRestore = async (tenantId: string) => {
    setRestoring(tenantId)
    try {
      const response = await fetch('/api/admin/restore', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      })
      if (response.ok) onRefresh()
    } catch {
      // Silent fail
    } finally {
      setRestoring(null)
    }
  }

  // Count cards where at least one tenant is still active
  const activeCount = clients.filter(c => c.tenants.some(t => !t.deletedAt)).length

  if (loading) {
    return (
      <div className="admin-section">
        <h3 className="admin-section__title">Clients</h3>
        <p className="admin-section__loading">Loading...</p>
      </div>
    )
  }

  return (
    <div className="admin-section">
      <h3 className="admin-section__title">Clients ({activeCount})</h3>

      {error && <div className="admin-alert admin-alert--error">{error}</div>}

      {clients.length === 0 ? (
        <p className="admin-section__empty">No clients yet.</p>
      ) : (
        <div className="admin-invite-list">
          {clients.map(client => (
            <ClientCard
              key={client.id}
              client={client}
              resending={resending}
              restoring={restoring}
              onResend={handleResend}
              onRestore={handleRestore}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================
// CLIENT CARD
// ============================================
function ClientCard({
  client,
  resending,
  restoring,
  onResend,
  onRestore,
}: {
  client: Client
  resending: string | null
  restoring: string | null
  onResend: (id: string) => void
  onRestore: (tenantId: string) => void
}) {
  // Card is styled as deleted only if ALL tenants are deleted
  const allDeleted = client.tenants.length > 0 && client.tenants.every(t => !!t.deletedAt)

  return (
    <div className={`admin-invite-card${allDeleted ? ' admin-invite-card--deleted' : ''}`}>
      <div className="admin-invite-card__header">
        <span className="admin-invite-card__email">{client.email}</span>
        <span className={`admin-invite-card__badge admin-invite-card__badge--${client.status}`}>
          {client.status}
        </span>
      </div>

      {/* Tenant chips — one per tenant */}
      <div className="admin-invite-card__tenants">
        {client.tenants.map(tenant => {
          const isDeleted = !!tenant.deletedAt
          const deletionDaysLeft = isDeleted
            ? Math.max(0, Math.ceil(
                (new Date(tenant.deletedAt!).getTime() + 30 * 24 * 60 * 60 * 1000 - Date.now())
                / (24 * 60 * 60 * 1000)
              ))
            : null
          const url = `https://${tenant.subdomain}.wayveexpenses.app`

          return (
            <div
              key={tenant.id}
              className={`admin-invite-card__tenant-chip${isDeleted ? ' admin-invite-card__tenant-chip--deleted' : ''}`}
            >
              <div className="admin-invite-card__tenant-chip-main">
                <a href={url} className="admin-invite-card__tenant-name">
                  {tenant.name}
                </a>
                <span className="admin-invite-card__tenant-subdomain">
                  {tenant.subdomain}.wayveexpenses.app
                </span>
              </div>
              {isDeleted && (
                <div className="admin-invite-card__tenant-chip-meta">
                  <span className="admin-invite-card__badge admin-invite-card__badge--deleted">
                    Deleted — permanent in {deletionDaysLeft} day{deletionDaysLeft !== 1 ? 's' : ''}
                  </span>
                  <button
                    className="btn btn--outline btn--sm admin-invite-card__restore"
                    onClick={() => onRestore(tenant.id)}
                    disabled={restoring === tenant.id}
                  >
                    {restoring === tenant.id ? 'Restoring...' : 'Restore'}
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="admin-invite-card__details">
        {(client.firstName || client.lastName) && (
          <div className="admin-invite-card__row">
            <span className="admin-invite-card__label">Name</span>
            <span className="admin-invite-card__value">
              {[client.firstName, client.lastName].filter(Boolean).join(' ')}
            </span>
          </div>
        )}
        <div className="admin-invite-card__row">
          <span className="admin-invite-card__label">Invite Sent</span>
          <span className="admin-invite-card__value">
            {new Date(client.createdAt).toLocaleDateString()}
          </span>
        </div>
        <div className="admin-invite-card__row">
          <span className="admin-invite-card__label">
            {client.status === 'accepted' ? 'Invite Accepted' : 'Invite Expires'}
          </span>
          <span className="admin-invite-card__value">
            {client.status === 'accepted' && client.acceptedAt
              ? new Date(client.acceptedAt).toLocaleDateString()
              : new Date(client.expiresAt).toLocaleDateString()}
          </span>
        </div>
        <div className="admin-invite-card__row">
          <span className="admin-invite-card__label">Last Login</span>
          <span className="admin-invite-card__value">
            {client.ownerLastLoginAt
              ? new Date(client.ownerLastLoginAt).toLocaleDateString()
              : '—'}
          </span>
        </div>
        <div className="admin-invite-card__row">
          <span className="admin-invite-card__label">API Usage</span>
          <span className="admin-invite-card__value admin-invite-card__value--muted">
            No usage data yet
          </span>
        </div>
      </div>

      {!allDeleted && (client.status === 'pending' || client.status === 'expired') && (
        <button
          className="btn btn--outline btn--full admin-invite-card__resend"
          onClick={() => onResend(client.id)}
          disabled={resending === client.id}
        >
          {resending === client.id ? 'Resending...' : 'Resend Invite'}
        </button>
      )}
    </div>
  )
}
