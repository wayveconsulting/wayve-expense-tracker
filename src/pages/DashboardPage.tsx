import { useState, useEffect, useCallback } from 'react'
import { useLocation } from 'wouter'
import { useTenant } from '../hooks/useTenant'
import { useYear } from '../hooks/useYear'
import { useRefresh } from '../hooks/useRefresh'

interface Expense {
  id: string
  amount: number
  vendor: string | null
  description: string | null
  date: string
  categoryId: string | null
  categoryName: string | null
  categoryEmoji: string | null
}

interface CategoryBreakdown {
  name: string
  emoji: string | null
  total: number
  count: number
}

interface DashboardData {
  expenses: Expense[]
  summary: {
    totalAmount: number
    expenseCount: number
    averageAmount: number
    year: number
  }
  categoryBreakdown: CategoryBreakdown[]
}

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

interface MileageData {
  trips: MileageTrip[]
  summary: {
    totalMiles: number
    tripCount: number
    estimatedDeduction: number
    year: number
  }
}

export default function DashboardPage() {
  const { subdomain } = useTenant()
  const { year } = useYear()
  const { expenseKey, mileageKey } = useRefresh()
  const [, setLocation] = useLocation()
  const [data, setData] = useState<DashboardData | null>(null)
  const [mileageData, setMileageData] = useState<MileageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchDashboard = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (subdomain) params.set('tenant', subdomain)
      params.set('year', String(year))
      params.set('limit', '500')

      // Fetch expenses and mileage in parallel
      const [expenseResponse, mileageResponse] = await Promise.all([
        fetch(`/api/expenses?${params}`),
        fetch(`/api/mileage?${params}`)
      ])

      if (!expenseResponse.ok) {
        const err = await expenseResponse.json()
        throw new Error(err.error || 'Failed to fetch expenses')
      }

      const expenseResult = await expenseResponse.json()
      setData(expenseResult)

      // Mileage is optional - don't fail if it errors
      if (mileageResponse.ok) {
        const mileageResult = await mileageResponse.json()
        setMileageData(mileageResult)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [subdomain, year])

  useEffect(() => {
    fetchDashboard()
  }, [fetchDashboard, expenseKey, mileageKey])

  // Navigate to expenses filtered by category
  const handleCategoryClick = (categoryName: string) => {
    setLocation(`/expenses?category=${encodeURIComponent(categoryName)}`)
  }

  if (loading) {
    return (
      <div className="page">
        <p style={{ color: 'var(--color-text-secondary)' }}>Loading dashboard...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="page">
        <div className="card" style={{ borderLeft: '4px solid var(--color-error)' }}>
          <h2 style={{ margin: 0, color: 'var(--color-error)' }}>Error</h2>
          <p style={{ marginBottom: 0 }}>{error}</p>
        </div>
      </div>
    )
  }

  if (!data) return null

  const { summary, categoryBreakdown, expenses } = data

  // Format cents to dollars
  const formatMoney = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(cents / 100)
  }

  // Format miles (stored as miles * 100)
  const formatMiles = (miles: number) => (miles / 100).toFixed(1)

  // Format date
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })
  }

  // Get recent expenses (last 10)
  const recentExpenses = expenses.slice(0, 10)

  // Get recent trips (last 5)
  const recentTrips = mileageData?.trips.slice(0, 5) || []

  return (
    <div className="page dashboard">
      <h1 className="page__title">Dashboard</h1>
      {/* Summary Cards */}
      <div className="dashboard__summary">
        <div 
          className="summary-card summary-card--clickable"
          onClick={() => setLocation('/reports')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setLocation('/reports')
            }
          }}
        >
          <span className="summary-card__label">Total Spent</span>
          <span className="summary-card__value">{formatMoney(summary.totalAmount)}</span>
          <span className="summary-card__sub">{summary.year}</span>
        </div>
        <div 
          className="summary-card summary-card--clickable"
          onClick={() => setLocation('/expenses')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setLocation('/expenses')
            }
          }}
        >
          <span className="summary-card__label">Expenses</span>
          <span className="summary-card__value">{summary.expenseCount}</span>
          <span className="summary-card__sub">transactions</span>
        </div>
        <div 
          className="summary-card summary-card--clickable"
          onClick={() => setLocation('/mileage')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setLocation('/mileage')
            }
          }}
        >
          <span className="summary-card__label">Mileage</span>
          <span className="summary-card__value">
            {mileageData?.summary ? formatMiles(mileageData.summary.totalMiles) : '0'}
          </span>
          <span className="summary-card__sub">miles tracked</span>
        </div>
      </div>

      {/* Two Column Layout */}
      <div className="dashboard__grid">
        {/* Recent Expenses */}
        <div className="card">
          <h2 
            className="card__title card__title--clickable"
            onClick={() => setLocation('/expenses')}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setLocation('/expenses')
              }
            }}
          >
            Recent Expenses →
          </h2>
          {recentExpenses.length === 0 ? (
            <p style={{ color: 'var(--color-text-secondary)' }}>No expenses yet</p>
          ) : (
            <ul className="expense-list">
              {recentExpenses.map((expense) => (
                <li key={expense.id} className="expense-list__item">
                  <div className="expense-list__icon">
                    {expense.categoryEmoji || '📁'}
                  </div>
                  <div className="expense-list__details">
                    <span className="expense-list__vendor">
                      {expense.vendor || expense.description || 'Expense'}
                    </span>
                    <span className="expense-list__meta">
                      {expense.categoryName || 'Uncategorized'} • {formatDate(expense.date)}
                    </span>
                  </div>
                  <span className="expense-list__amount">
                    {formatMoney(expense.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Category Breakdown */}
        <div className="card">
          <h2 className="card__title">By Category</h2>
          {categoryBreakdown.length === 0 ? (
            <p style={{ color: 'var(--color-text-secondary)' }}>No categories yet</p>
          ) : (
            <ul className="category-list">
              {categoryBreakdown.slice(0, 8).map((cat) => (
                <li 
                  key={cat.name} 
                  className="category-list__item category-list__item--clickable"
                  onClick={() => handleCategoryClick(cat.name)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handleCategoryClick(cat.name)
                    }
                  }}
                >
                  <div className="category-list__info">
                    <span className="category-list__emoji">{cat.emoji || '📁'}</span>
                    <span className="category-list__name">{cat.name}</span>
                    <span className="category-list__count">{cat.count}</span>
                  </div>
                  <div className="category-list__bar-container">
                    <div 
                      className="category-list__bar" 
                      style={{ 
                        width: `${(cat.total / categoryBreakdown[0].total) * 100}%` 
                      }}
                    />
                  </div>
                  <span className="category-list__total">{formatMoney(cat.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Recent Trips */}
        <div className="card">
          <h2 
            className="card__title card__title--clickable"
            onClick={() => setLocation('/mileage')}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setLocation('/mileage')
              }
            }}
          >
            Recent Trips →
          </h2>
          {recentTrips.length === 0 ? (
            <p style={{ color: 'var(--color-text-secondary)' }}>No trips logged yet</p>
          ) : (
            <ul className="trip-list">
              {recentTrips.map((trip) => (
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
          )}
        </div>
      </div>
    </div>
  )
}

// Helper to truncate long addresses
function truncateLocation(location: string, maxLength = 20): string {
  if (location.length <= maxLength) return location
  const commaIndex = location.indexOf(',')
  if (commaIndex > 0 && commaIndex <= maxLength) {
    return location.substring(0, commaIndex)
  }
  return location.substring(0, maxLength) + '...'
}