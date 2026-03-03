import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { Link } from 'wouter'

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
  tenantId: string
  tenantName: string
  tenantSubdomain: string
  tenantDeletedAt: string | null
  tenantRestoredAt: string | null
  invitedByFirstName: string | null
  invitedByLastName: string | null
  invitedByEmail: string
  ownerLastLoginAt: string | null
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

      {/* D1: Deletion Zone entry point */}
      <div className="admin-section admin-section--danger">
        <button
          className="btn btn--danger btn--full"
          onClick={() => setShowDeleteConfirm(true)}
        >
          ⚠️ Deletion Zone
        </button>
      </div>

      {/* D2: Entry confirmation modal */}
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
function InviteForm({ onSuccess }: { onSuccess: () => void }) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [subdomain, setSubdomain] = useState('')
  const [subdomainEdited, setSubdomainEdited] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    if (!subdomainEdited && businessName) {
      const suggested = businessName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 30)
      setSubdomain(suggested)
    }
  }, [businessName, subdomainEdited])

  const handleSubdomainChange = (value: string) => {
    setSubdomain(value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30))
    setSubdomainEdited(true)
  }

  const handleSubmit = async () => {
    setError(null)
    setSuccess(null)

    if (!email || !businessName || !subdomain) {
      setError('Email, business name, and subdomain are required')
      return
    }

    if (subdomain.length < 3) {
      setError('Subdomain must be at least 3 characters')
      return
    }

    setSubmitting(true)

    try {
      const response = await fetch('/api/admin/invites', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          firstName: firstName.trim() || null,
          lastName: lastName.trim() || null,
          businessName: businessName.trim(),
          subdomain,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        setError(data.error || 'Failed to send invite')
        return
      }

      const data = await response.json()
      setSuccess(`Invite sent to ${email} for ${businessName} (${data.tenant.subdomain}.wayveexpenses.app)`)

      setFirstName('')
      setLastName('')
      setEmail('')
      setBusinessName('')
      setSubdomain('')
      setSubdomainEdited(false)
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
          <label className="admin-form__label">Business Name *</label>
          <input
            type="text"
            className="admin-form__input"
            value={businessName}
            onChange={e => setBusinessName(e.target.value)}
            placeholder="Joe's Plumbing"
          />
        </div>

        <div className="admin-form__field">
          <label className="admin-form__label">Subdomain *</label>
          <div className="admin-form__subdomain-wrapper">
            <input
              type="text"
              className="admin-form__input admin-form__input--subdomain"
              value={subdomain}
              onChange={e => handleSubdomainChange(e.target.value)}
              placeholder="joesplumbing"
            />
            <span className="admin-form__subdomain-suffix">.wayveexpenses.app</span>
          </div>
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
// CLIENT LIST (formerly InviteList)
// ============================================
function ClientList({ refreshKey, onRefresh }: { refreshKey: number; onRefresh: () => void }) {
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resending, setResending] = useState<string | null>(null)
  const [restoring, setRestoring] = useState<string | null>(null)

  const fetchClients = async () => {
    try {
      const response = await fetch('/api/admin/invites', {
        credentials: 'include',
      })
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
      if (response.ok) {
        await fetchClients()
      }
    } catch {
      // Silent fail — user can try again
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
      if (response.ok) {
        onRefresh()
      }
    } catch {
      // Silent fail — user can try again
    } finally {
      setRestoring(null)
    }
  }

  // Count only active (non-deleted) clients for the header
  const activeCount = clients.filter(c => !c.tenantDeletedAt).length

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
  const isDeleted = !!client.tenantDeletedAt
  const deletionDaysLeft = isDeleted
    ? Math.max(0, Math.ceil((new Date(client.tenantDeletedAt!).getTime() + 30 * 24 * 60 * 60 * 1000 - Date.now()) / (24 * 60 * 60 * 1000)))
    : null

  const tenantUrl = `https://${client.tenantSubdomain}.wayveexpenses.app`

  return (
    <div className={`admin-invite-card${isDeleted ? ' admin-invite-card--deleted' : ''}`}>
      <div className="admin-invite-card__header">
        {/* B2: Tenant name as clickable link */}
        
          <a href={tenantUrl}
          className="admin-invite-card__business admin-invite-card__business--link"
          target="_blank"
          rel="noopener noreferrer"
        >
          {client.tenantName}
        </a>
        {isDeleted ? (
          <span className="admin-invite-card__badge admin-invite-card__badge--deleted">
            Deleted — permanent in {deletionDaysLeft} day{deletionDaysLeft !== 1 ? 's' : ''}
          </span>
        ) : (
          <span className={`admin-invite-card__badge admin-invite-card__badge--${client.status}`}>
            {client.status}
          </span>
        )}
      </div>

      <div className="admin-invite-card__details">
        <div className="admin-invite-card__row">
          <span className="admin-invite-card__label">Email</span>
          <span className="admin-invite-card__value">{client.email}</span>
        </div>
        {(client.firstName || client.lastName) && (
          <div className="admin-invite-card__row">
            <span className="admin-invite-card__label">Name</span>
            <span className="admin-invite-card__value">
              {[client.firstName, client.lastName].filter(Boolean).join(' ')}
            </span>
          </div>
        )}
        {/* B3: Subdomain as clickable link */}
        <div className="admin-invite-card__row">
          <span className="admin-invite-card__label">Subdomain</span>
          
            <a href={tenantUrl}
            className="admin-invite-card__value admin-invite-card__value--link"
            target="_blank"
            rel="noopener noreferrer"
          >
            {client.tenantSubdomain}.wayveexpenses.app
          </a>
        </div>
        {/* B4: "Sent" → "Invite Sent" */}
        <div className="admin-invite-card__row">
          <span className="admin-invite-card__label">Invite Sent</span>
          <span className="admin-invite-card__value">
            {new Date(client.createdAt).toLocaleDateString()}
          </span>
        </div>
        {/* B5: Conditional invite status display */}
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
        {/* B6: Last Login */}
        <div className="admin-invite-card__row">
          <span className="admin-invite-card__label">Last Login</span>
          <span className="admin-invite-card__value">
            {client.ownerLastLoginAt
              ? new Date(client.ownerLastLoginAt).toLocaleDateString()
              : '—'}
          </span>
        </div>
        {/* B7 stub: API Usage — wired up in Phase C */}
        <div className="admin-invite-card__row">
          <span className="admin-invite-card__label">API Usage</span>
          <span className="admin-invite-card__value admin-invite-card__value--muted">
            No usage data yet
          </span>
        </div>
      </div>

      {/* B9: Restore button for soft-deleted clients */}
      {isDeleted && (
        <button
          className="btn btn--outline btn--full admin-invite-card__restore"
          onClick={() => onRestore(client.tenantId)}
          disabled={restoring === client.tenantId}
        >
          {restoring === client.tenantId ? 'Restoring...' : 'Restore Account'}
        </button>
      )}

      {/* Resend button for pending/expired invites (only if not deleted) */}
      {!isDeleted && (client.status === 'pending' || client.status === 'expired') && (
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