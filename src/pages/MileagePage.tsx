import { useState, useEffect } from 'react'
import { useTenant } from '../hooks/useTenant'
import { useYear } from '../hooks/useYear'
import { useRefresh } from '../hooks/useRefresh'
import { AddMileageSheet } from '../components/AddMileageSheet'

interface MileageTrip {
  id: string
  date: string
  description: string | null
  startLocation: string
  endLocation: string
  distanceMiles: number
  displayMiles: number
  isRoundTrip: boolean
}

interface MileageSummary {
  totalMiles: number
  tripCount: number
  estimatedDeduction: number
  year: number
}

export default function MileagePage() {
  const { subdomain } = useTenant()
  const { year } = useYear()
  const { mileageKey, refreshMileage } = useRefresh()
  
  const [trips, setTrips] = useState<MileageTrip[]>([])
  const [summary, setSummary] = useState<MileageSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [sheetOpen, setSheetOpen] = useState(false)

  useEffect(() => {
    async function fetchMileage() {
      if (!subdomain) return
      
      try {
        setLoading(true)
        const params = new URLSearchParams()
        params.set('tenant', subdomain)
        params.set('year', String(year))

        const response = await fetch(`/api/mileage?${params}`)
        
        if (!response.ok) {
          throw new Error('Failed to fetch mileage')
        }

        const data = await response.json()
        setTrips(data.trips || [])
        setSummary(data.summary || null)
      } catch (err) {
        console.error('Error fetching mileage:', err)
        setTrips([])
        setSummary(null)
      } finally {
        setLoading(false)
      }
    }

    fetchMileage()
  }, [subdomain, year, mileageKey])

  // Format miles (stored as miles * 100)
  const formatMiles = (miles: number) => (miles / 100).toFixed(1)

  // Format money (stored as cents)
  const formatMoney = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(cents / 100)
  }

  // Format date
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })
  }

  // Group trips by month
  const tripsByMonth = trips.reduce((acc, trip) => {
    const date = new Date(trip.date)
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    const monthName = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    
    if (!acc[monthKey]) {
      acc[monthKey] = { name: monthName, trips: [], totalMiles: 0 }
    }
    acc[monthKey].trips.push(trip)
    acc[monthKey].totalMiles += trip.displayMiles
    return acc
  }, {} as Record<string, { name: string; trips: MileageTrip[]; totalMiles: number }>)

  const sortedMonths = Object.entries(tripsByMonth).sort(([a], [b]) => b.localeCompare(a))

  function handleTripAdded() {
    refreshMileage()
  }

  if (loading) {
    return (
      <div className="page">
        <p style={{ color: 'var(--color-text-secondary)' }}>Loading mileage...</p>
      </div>
    )
  }

  return (
    <div className="page mileage-page">
      <h1 className="page__title">Mileage</h1>
      <button className="add-link" onClick={() => setSheetOpen(true)}>
        + Log Trip
      </button>
      {trips.length === 0 ? (
        /* Empty State */
        <div className="empty-state">
          <div className="empty-state__icon">🚗</div>
          <h2 className="empty-state__title">No mileage tracked yet</h2>
          <p className="empty-state__description">
            Track your business miles to maximize your tax deductions. 
            The IRS standard mileage rate for 2025 is 70¢ per mile.
          </p>
          <button 
            className="empty-state__btn"
            onClick={() => setSheetOpen(true)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Log Your First Trip
          </button>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="mileage-summary">
            <div className="summary-card">
              <span className="summary-card__label">Total Miles</span>
              <span className="summary-card__value">
                {summary ? formatMiles(summary.totalMiles) : '0'}
              </span>
              <span className="summary-card__sub">{year}</span>
            </div>
            <div className="summary-card">
              <span className="summary-card__label">Trips</span>
              <span className="summary-card__value">
                {summary?.tripCount || 0}
              </span>
              <span className="summary-card__sub">logged</span>
            </div>
            <div className="summary-card">
              <span className="summary-card__label">Est. Deduction</span>
              <span className="summary-card__value">
                {summary ? formatMoney(summary.estimatedDeduction) : '$0.00'}
              </span>
              <span className="summary-card__sub">@ 70¢/mile</span>
            </div>
          </div>

          {/* Trips by Month */}
          {sortedMonths.map(([monthKey, { name, trips: monthTrips, totalMiles }]) => (
            <div key={monthKey} className="card">
              <div className="card__header">
                <h2 className="card__title">{name}</h2>
                <span className="card__subtitle">{formatMiles(totalMiles)} mi</span>
              </div>
              <ul className="trip-list">
                {monthTrips.map((trip) => (
                  <li key={trip.id} className="trip-list__item">
                    <div className="trip-list__icon">
                      {trip.isRoundTrip ? '🔄' : '📍'}
                    </div>
                    <div className="trip-list__details">
                      <span className="trip-list__route">
                        {trip.description || `${truncateLocation(trip.startLocation)} → ${truncateLocation(trip.endLocation)}`}
                      </span>
                      <span className="trip-list__meta">
                        {formatDate(trip.date)}
                        {trip.isRoundTrip && ' · Round trip'}
                      </span>
                    </div>
                    <span className="trip-list__miles">
                      {formatMiles(trip.displayMiles)} mi
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}

      {/* Add Mileage Bottom Sheet */}
      <AddMileageSheet
        isOpen={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onSuccess={handleTripAdded}
      />
    </div>
  )
}

// Helper to truncate long addresses
function truncateLocation(location: string, maxLength = 25): string {
  if (location.length <= maxLength) return location
  // Try to find a comma and truncate there
  const commaIndex = location.indexOf(',')
  if (commaIndex > 0 && commaIndex <= maxLength) {
    return location.substring(0, commaIndex)
  }
  return location.substring(0, maxLength) + '...'
}
