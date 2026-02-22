import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { Link } from 'wouter'

interface Invite {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  role: string
  status: string
  expiresAt: string
  acceptedAt: string | null
  createdAt: string
  tenantName: string
  tenantSubdomain: string
  invitedByFirstName: string | null
  invitedByLastName: string | null
  invitedByEmail: string
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

  return (
    <div className="page">
      <h2 className="page-title">Admin</h2>
      <InviteForm onSuccess={() => setListRefreshKey(k => k + 1)} />
      <InviteList refreshKey={listRefreshKey} />
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
// INVITE LIST
// ============================================
function InviteList({ refreshKey }: { refreshKey: number }) {
  const [invitesList, setInvitesList] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resending, setResending] = useState<string | null>(null)

  const fetchInvites = async () => {
    try {
      const response = await fetch('/api/admin/invites', {
        credentials: 'include',
      })
      if (response.ok) {
        const data = await response.json()
        setInvitesList(data.invites)
      } else {
        setError('Failed to load invites')
      }
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchInvites()
  }, [refreshKey])

  const handleResend = async (inviteId: string) => {
    setResending(inviteId)
    try {
      const response = await fetch(`/api/admin/invites/${inviteId}`, {
        method: 'PUT',
        credentials: 'include',
      })
      if (response.ok) {
        await fetchInvites()
      }
    } catch {
      // Silent fail — user can try again
    } finally {
      setResending(null)
    }
  }

  if (loading) {
    return (
      <div className="admin-section">
        <h3 className="admin-section__title">Invites</h3>
        <p className="admin-section__loading">Loading...</p>
      </div>
    )
  }

  return (
    <div className="admin-section">
      <h3 className="admin-section__title">Invites ({invitesList.length})</h3>

      {error && <div className="admin-alert admin-alert--error">{error}</div>}

      {invitesList.length === 0 ? (
        <p className="admin-section__empty">No invites sent yet.</p>
      ) : (
        <div className="admin-invite-list">
          {invitesList.map(invite => (
            <div key={invite.id} className="admin-invite-card">
              <div className="admin-invite-card__header">
                <div className="admin-invite-card__business">{invite.tenantName}</div>
                <span className={`admin-invite-card__badge admin-invite-card__badge--${invite.status}`}>
                  {invite.status}
                </span>
              </div>

              <div className="admin-invite-card__details">
                <div className="admin-invite-card__row">
                  <span className="admin-invite-card__label">Email</span>
                  <span className="admin-invite-card__value">{invite.email}</span>
                </div>
                {(invite.firstName || invite.lastName) && (
                  <div className="admin-invite-card__row">
                    <span className="admin-invite-card__label">Name</span>
                    <span className="admin-invite-card__value">
                      {[invite.firstName, invite.lastName].filter(Boolean).join(' ')}
                    </span>
                  </div>
                )}
                <div className="admin-invite-card__row">
                  <span className="admin-invite-card__label">Subdomain</span>
                  <span className="admin-invite-card__value">{invite.tenantSubdomain}.wayveexpenses.app</span>
                </div>
                <div className="admin-invite-card__row">
                  <span className="admin-invite-card__label">Sent</span>
                  <span className="admin-invite-card__value">
                    {new Date(invite.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="admin-invite-card__row">
                  <span className="admin-invite-card__label">Expires</span>
                  <span className="admin-invite-card__value">
                    {new Date(invite.expiresAt).toLocaleDateString()}
                  </span>
                </div>
              </div>

              {(invite.status === 'pending' || invite.status === 'expired') && (
                <button
                  className="btn btn--outline btn--full admin-invite-card__resend"
                  onClick={() => handleResend(invite.id)}
                  disabled={resending === invite.id}
                >
                  {resending === invite.id ? 'Resending...' : 'Resend Invite'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}