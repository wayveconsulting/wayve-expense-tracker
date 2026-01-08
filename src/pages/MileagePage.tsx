import { useState, useEffect } from 'react'
import { useTenant } from '../hooks/useTenant'
import { useYear } from '../hooks/useYear'

interface MileageTrip {
  id: string
  date: string
  description: string | null
  startLocation: string | null
  endLocation: string | null
  miles: number
  isRoundTrip: boolean
}

export default function MileagePage() {
  const { subdomain } = useTenant()
  const { year } = useYear()
  const [trips, setTrips] = useState<MileageTrip[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchMileage() {
      try {
        setLoading(true)
        const params = new URLSearchParams()
        if (subdomain) params.set('tenant', subdomain)
        params.set('year', String(year))

        const response = await fetch(`/api/mileage?${params}`)
        
        // If endpoint doesn't exist yet, just show empty state
        if (response.status === 404) {
          setTrips([])
          return
        }
        
        if (!response.ok) {
          const err = await response.json()
          throw new Error(err.error || 'Failed to fetch mileage')
        }

        const result = await response.json()
        setTrips(result.trips || [])
      } catch (err) {
        // Don't show error for missing endpoint - just empty state
        setTrips([])
      } finally {
        setLoading(false)
      }
    }

    fetchMileage()
  }, [subdomain, year])

  // Format miles (stored as miles * 100)
  const formatMiles = (miles: number) => {
    return (miles / 100).toFixed(1)
  }

  // Format date
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const totalMiles = trips.reduce((sum, trip) => sum + trip.miles, 0)

  if (loading) {
    return (
      <div className="page">
        <p style={{ color: 'var(--color-text-secondary)' }}>Loading mileage...</p>
      </div>
    )
  }

  return (
    <div className="page mileage-page">
      {trips.length === 0 ? (
        /* Empty State */
        <div className="empty-state">
          <div className="empty-state__icon">🚗</div>
          <h2 className="empty-state__title">No mileage tracked yet</h2>
          <p className="empty-state__description">
            Track your business miles to maximize your tax deductions. 
            The IRS standard mileage rate for 2025 is 70¢ per mile.
          </p>
          <button className="empty-state__btn" disabled>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Log Trip (Coming Soon)
          </button>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="mileage-summary">
            <div className="summary-card">
              <span className="summary-card__label">Total Miles</span>
              <span className="summary-card__value">{formatMiles(totalMiles)}</span>
              <span className="summary-card__sub">{year}</span>
            </div>
            <div className="summary-card">
              <span className="summary-card__label">Trips</span>
              <span className="summary-card__value">{trips.length}</span>
              <span className="summary-card__sub">logged</span>
            </div>
            <div className="summary-card">
              <span className="summary-card__label">Deduction</span>
              <span className="summary-card__value">
                ${((totalMiles / 100) * 0.70).toFixed(2)}
              </span>
              <span className="summary-card__sub">@ 70¢/mile</span>
            </div>
          </div>

          {/* Trip List */}
          <div className="card">
            <h2 className="card__title">Recent Trips</h2>
            <ul className="trip-list">
              {trips.map((trip) => (
                <li key={trip.id} className="trip-list__item">
                  <div className="trip-list__icon">📍</div>
                  <div className="trip-list__details">
                    <span className="trip-list__route">
                      {trip.startLocation && trip.endLocation
                        ? `${trip.startLocation} → ${trip.endLocation}`
                        : trip.description || 'Business trip'}
                    </span>
                    <span className="trip-list__meta">
                      {formatDate(trip.date)}
                      {trip.isRoundTrip && ' · Round trip'}
                    </span>
                  </div>
                  <span className="trip-list__miles">{formatMiles(trip.miles)} mi</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  )
}