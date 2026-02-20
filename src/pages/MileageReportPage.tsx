import { useState, useEffect } from 'react'
import { useYear } from '../hooks/useYear'
import { useTenant } from '../hooks/useTenant'
import { Link } from 'wouter'

interface MileageTrip {
  id: string
  date: string
  startLocation: string
  endLocation: string
  description: string | null
  distanceMiles: number
  displayMiles: number
  isRoundTrip: boolean
}

interface MonthlyBreakdown {
  month: number
  label: string
  totalMiles: number
  tripCount: number
}

interface MileageReportData {
  year: number
  trips: MileageTrip[]
  summary: {
    totalMiles: number
    tripCount: number
    estimatedDeduction: number
    mileageRate: number
  }
  monthlyBreakdown: MonthlyBreakdown[]
}

function formatMiles(miles: number): string {
  return (miles / 100).toFixed(1)
}

function formatDollars(cents: number): string {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.substring(0, 10).split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  })
}

function formatDateShort(dateStr: string): string {
  const [year, month, day] = dateStr.substring(0, 10).split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

// Truncate long addresses for mobile display
function truncateLocation(location: string, maxLength = 30): string {
  if (location.length <= maxLength) return location
  const commaIndex = location.indexOf(',')
  if (commaIndex > 0 && commaIndex <= maxLength) {
    return location.substring(0, commaIndex)
  }
  return location.substring(0, maxLength) + '...'
}

export default function MileageReportPage() {
  const { year, nextYear, prevYear } = useYear()
  const { subdomain } = useTenant()
  const [data, setData] = useState<MileageReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const currentYear = new Date().getFullYear()

  useEffect(() => {
    if (!subdomain) return

    async function fetchData() {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({
          tenant: subdomain!,
          year: year.toString(),
        })
        const response = await fetch(`/api/reports/mileage?${params}`)
        if (!response.ok) throw new Error('Failed to fetch mileage report')
        const result = await response.json()
        setData(result)
      } catch (err) {
        console.error('Mileage report error:', err)
        setError('Failed to load mileage report')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [subdomain, year])

  return (
    <div className="page mileage-report-page">
      <div className="mileage-report-page__nav">
        <Link href="/reports" className="back-link">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Reports
        </Link>
      </div>

      <div className="mileage-report-page__header">
        <h1 className="mileage-report-page__title">Mileage Log</h1>
        <div className="mileage-report-page__year-selector">
          <button
            className="year-nav-btn"
            onClick={prevYear}
            disabled={year <= 2020}
            aria-label="Previous year"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <span className="mileage-report-page__year">{year}</span>
          <button
            className="year-nav-btn"
            onClick={nextYear}
            disabled={year >= currentYear}
            aria-label="Next year"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
      </div>

      <p className="mileage-report-page__description">
        IRS-ready mileage log for {year}. All business trips with dates, destinations, purpose, and distance.
      </p>

      {loading && (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--spacing-2xl)' }}>
          <p style={{ color: 'var(--color-text-secondary)' }}>Loading mileage data...</p>
        </div>
      )}

      {error && (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--spacing-2xl)' }}>
          <p style={{ color: 'var(--color-error)' }}>{error}</p>
        </div>
      )}

      {!loading && !error && data && (
        <>
          {data.trips.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 'var(--spacing-2xl)' }}>
              <p className="empty-state__icon">🚗</p>
              <p style={{ color: 'var(--color-text-secondary)' }}>No mileage trips recorded for {year}.</p>
            </div>
          ) : (
            <>
              {/* Summary Cards */}
              <div className="mileage-report__summary">
                <div className="mileage-report__stat-card">
                  <span className="mileage-report__stat-label">Total Miles</span>
                  <span className="mileage-report__stat-value">{formatMiles(data.summary.totalMiles)}</span>
                </div>
                <div className="mileage-report__stat-card">
                  <span className="mileage-report__stat-label">Total Trips</span>
                  <span className="mileage-report__stat-value">{data.summary.tripCount}</span>
                </div>
                <div className="mileage-report__stat-card">
                  <span className="mileage-report__stat-label">Est. Deduction</span>
                  <span className="mileage-report__stat-value mileage-report__stat-value--highlight">
                    {formatDollars(data.summary.estimatedDeduction)}
                  </span>
                  <span className="mileage-report__stat-sub">@ {data.summary.mileageRate}¢/mile</span>
                </div>
              </div>

              {/* Monthly Breakdown */}
              {data.monthlyBreakdown.length > 0 && (
                <div className="card mileage-report__monthly-card">
                  <h2 className="card__title">Monthly Summary</h2>
                  <div className="mileage-report__monthly-grid">
                    {data.monthlyBreakdown.map((month) => (
                      <div key={month.month} className="mileage-report__monthly-row">
                        <span className="mileage-report__monthly-label">{month.label}</span>
                        <span className="mileage-report__monthly-trips">
                          {month.tripCount} trip{month.tripCount !== 1 ? 's' : ''}
                        </span>
                        <span className="mileage-report__monthly-miles">
                          {formatMiles(month.totalMiles)} mi
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Trip Log Table */}
              <div className="mileage-table-wrapper">
                <table className="mileage-table">
                  <thead>
                    <tr>
                      <th className="mileage-table__date-header">Date</th>
                      <th className="mileage-table__dest-header">Destination</th>
                      <th className="mileage-table__purpose-header">Business Purpose</th>
                      <th className="mileage-table__miles-header">Miles</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.trips.map((trip) => (
                      <tr key={trip.id} className="mileage-table__row">
                        <td className="mileage-table__date-cell">
                          <span className="mileage-table__date-full">{formatDate(trip.date)}</span>
                          <span className="mileage-table__date-short">{formatDateShort(trip.date)}</span>
                        </td>
                        <td className="mileage-table__dest-cell">
                          <span className="mileage-table__dest-full">
                            {trip.startLocation} → {trip.endLocation}
                          </span>
                          <span className="mileage-table__dest-short">
                            {truncateLocation(trip.startLocation)} → {truncateLocation(trip.endLocation)}
                          </span>
                          {trip.isRoundTrip && (
                            <span className="mileage-table__round-trip-badge">Round Trip</span>
                          )}
                        </td>
                        <td className="mileage-table__purpose-cell">
                          {trip.description || '—'}
                        </td>
                        <td className="mileage-table__miles-cell">
                          {formatMiles(trip.displayMiles)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="mileage-table__totals-row">
                      <td className="mileage-table__totals-label" colSpan={3}>
                        TOTAL ({data.summary.tripCount} trips)
                      </td>
                      <td className="mileage-table__miles-cell mileage-table__miles-cell--total">
                        {formatMiles(data.summary.totalMiles)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* IRS Disclaimer */}
              <p className="mileage-report__disclaimer">
                This log is based on IRS standard mileage rate guidelines. The {year} rate 
                is {data.summary.mileageRate}¢ per business mile. Consult a tax professional 
                for actual deduction calculations. Retain this log and supporting documentation 
                for your records.
              </p>
            </>
          )}
        </>
      )}
    </div>
  )
}
