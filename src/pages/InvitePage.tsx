import { useState, useEffect } from 'react'

export default function InvitePage() {
  const [loading, setLoading] = useState(true)
  const [valid, setValid] = useState(false)
  const [businessName, setBusinessName] = useState('')
  const [reason, setReason] = useState<string | null>(null)

  const params = new URLSearchParams(window.location.search)
  const token = params.get('token')

  useEffect(() => {
    if (!token) {
      setLoading(false)
      setReason('missing_token')
      return
    }

    async function validate() {
      try {
        const response = await fetch(`/api/invites/validate?token=${token}`)
        const data = await response.json()

        if (data.valid) {
          setValid(true)
          setBusinessName(data.businessName)
        } else {
          setValid(false)
          setReason(data.reason || 'invalid')
          setBusinessName(data.businessName || '')
        }
      } catch {
        setReason('error')
      } finally {
        setLoading(false)
      }
    }

    validate()
  }, [token])

  const handleSignIn = () => {
    window.location.href = '/api/auth/google'
  }

  if (loading) {
    return (
      <div className="invite-page">
        <div className="invite-page__card">
          <p className="invite-page__loading">Validating invite...</p>
        </div>
      </div>
    )
  }

  if (!valid) {
    return (
      <div className="invite-page">
        <div className="invite-page__card">
          <h1 className="invite-page__title">Wayve Expense Tracker</h1>
          {reason === 'missing_token' && (
            <p className="invite-page__error">Invalid invite link. Please check the link from your email.</p>
          )}
          {reason === 'expired' && (
            <>
              <p className="invite-page__error">This invite has expired.</p>
              {businessName && <p className="invite-page__detail">Business: {businessName}</p>}
              <p className="invite-page__detail">Please contact your administrator to request a new invite.</p>
            </>
          )}
          {reason === 'already_used' && (
            <>
              <p className="invite-page__error">This invite has already been used.</p>
              {businessName && <p className="invite-page__detail">Business: {businessName}</p>}
              <p className="invite-page__detail">
                <a href="/login" className="invite-page__link">Sign in here</a> if you already have an account.
              </p>
            </>
          )}
          {reason === 'invalid' && (
            <p className="invite-page__error">Invalid invite link. Please check the link from your email.</p>
          )}
          {reason === 'error' && (
            <p className="invite-page__error">Something went wrong. Please try again later.</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="invite-page">
      <div className="invite-page__card">
        <h1 className="invite-page__title">Wayve Expense Tracker</h1>
        <p className="invite-page__welcome">
          You've been invited to manage expenses for
        </p>
        <p className="invite-page__business">{businessName}</p>
        <button className="invite-page__google-btn" onClick={handleSignIn}>
          <svg width="20" height="20" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Sign in with Google
        </button>
        <p className="invite-page__note">
          You'll use your Google account to sign in. No new password needed.
        </p>
      </div>
    </div>
  )
}