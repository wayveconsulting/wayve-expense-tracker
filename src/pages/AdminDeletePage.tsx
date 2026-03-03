import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { Link } from 'wouter'

interface ActiveClient {
  tenantId: string
  tenantName: string
  tenantSubdomain: string
  email: string
  firstName: string | null
  lastName: string | null
}

export default function AdminDeletePage() {
  const { isSuperAdmin } = useAuth()
  const [clients, setClients] = useState<ActiveClient[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmStep, setConfirmStep] = useState<0 | 1 | 2>(0)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    fetchClients()
  }, [])

  const fetchClients = async () => {
    try {
      const response = await fetch('/api/admin/invites', {
        credentials: 'include',
      })
      if (response.ok) {
        const data = await response.json()
        // Filter to active (non-deleted) clients only
        const active: ActiveClient[] = data.invites
          .filter((inv: any) => !inv.tenantDeletedAt)
          .map((inv: any) => ({
            tenantId: inv.tenantId,
            tenantName: inv.tenantName,
            tenantSubdomain: inv.tenantSubdomain,
            email: inv.email,
            firstName: inv.firstName,
            lastName: inv.lastName,
          }))
        setClients(active)
      } else {
        setError('Failed to load clients')
      }
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  const toggleSelection = (tenantId: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(tenantId)) {
        next.delete(tenantId)
      } else {
        next.add(tenantId)
      }
      return next
    })
  }

  const selectedClients = clients.filter(c => selected.has(c.tenantId))

  const handleDeleteClick = () => {
    if (selected.size === 0) return
    setConfirmStep(1)
  }

  const handleConfirmStep1 = () => {
    setConfirmStep(2)
  }

  const handleConfirmStep2 = async () => {
    setDeleting(true)
    setError(null)

    try {
      const response = await fetch('/api/admin/delete', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantIds: Array.from(selected) }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete accounts')
      }

      // Success — go back to admin page
      window.location.href = '/admin'
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setConfirmStep(0)
    } finally {
      setDeleting(false)
    }
  }

  const handleCancel = () => {
    setConfirmStep(0)
  }

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
      <div className="admin-delete-header">
        <Link href="/admin" className="admin-delete-back">
          ← Back to Admin
        </Link>
        <h2 className="page-title page-title--danger">⚠️ Deletion Zone</h2>
        <p className="admin-delete-warning">
          Deleted accounts enter a 30-day grace period before permanent removal. 
          During that time they can be restored from the admin page.
        </p>
      </div>

      {error && <div className="admin-alert admin-alert--error">{error}</div>}

      {loading ? (
        <div className="admin-section">
          <p className="admin-section__loading">Loading clients...</p>
        </div>
      ) : clients.length === 0 ? (
        <div className="admin-section">
          <p className="admin-section__empty">No active clients to delete.</p>
        </div>
      ) : (
        <div className="admin-section">
          <div className="admin-delete-list">
            {clients.map(client => (
              <label
                key={client.tenantId}
                className={`admin-delete-item${selected.has(client.tenantId) ? ' admin-delete-item--selected' : ''}`}
              >
                <input
                  type="checkbox"
                  className="admin-delete-item__checkbox"
                  checked={selected.has(client.tenantId)}
                  onChange={() => toggleSelection(client.tenantId)}
                />
                <div className="admin-delete-item__info">
                  <span className="admin-delete-item__name">{client.tenantName}</span>
                  <span className="admin-delete-item__detail">
                    {client.email} · {client.tenantSubdomain}.wayveexpenses.app
                  </span>
                  {(client.firstName || client.lastName) && (
                    <span className="admin-delete-item__detail">
                      {[client.firstName, client.lastName].filter(Boolean).join(' ')}
                    </span>
                  )}
                </div>
              </label>
            ))}
          </div>

          <button
            className="btn btn--danger btn--full admin-delete-btn"
            onClick={handleDeleteClick}
            disabled={selected.size === 0}
          >
            Delete Selected Accounts ({selected.size})
          </button>
        </div>
      )}

      {/* Confirmation Step 1 */}
      {confirmStep >= 1 && (
        <div className="admin-modal-backdrop" onClick={handleCancel}>
          <div className="admin-modal admin-modal--danger" onClick={e => e.stopPropagation()}>
            <h3 className="admin-modal__title">⚠️ Confirm Deletion</h3>
            <p className="admin-modal__message">
              You are about to delete {selectedClients.length} account{selectedClients.length !== 1 ? 's' : ''}:
            </p>
            <ul className="admin-modal__list">
              {selectedClients.map(c => (
                <li key={c.tenantId}>{c.tenantName} ({c.tenantSubdomain})</li>
              ))}
            </ul>
            <p className="admin-modal__message">
              These accounts will be deactivated immediately and permanently deleted after 30 days.
            </p>
            {confirmStep === 1 ? (
              <div className="admin-modal__actions">
                <button className="btn btn--secondary" onClick={handleCancel}>Cancel</button>
                <button className="btn btn--danger" onClick={handleConfirmStep1}>
                  Yes, I'm Sure
                </button>
              </div>
            ) : (
              <>
                <p className="admin-modal__message admin-modal__message--final">
                  Are you absolutely, positively sure? This cannot be undone after the 30-day grace period.
                </p>
                <div className="admin-modal__actions">
                  <button className="btn btn--secondary" onClick={handleCancel} disabled={deleting}>
                    Cancel
                  </button>
                  <button className="btn btn--danger" onClick={handleConfirmStep2} disabled={deleting}>
                    {deleting ? 'Deleting...' : 'Delete Permanently'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
