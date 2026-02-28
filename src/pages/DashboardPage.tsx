import { useState, useEffect, useCallback } from 'react'
import { useLocation } from 'wouter'
import { useTenant } from '../hooks/useTenant'
import { useYear } from '../hooks/useYear'
import { useRefresh } from '../hooks/useRefresh'
import { ExpenseDetailSheet } from '../components/ExpenseDetailSheet'
import { MileageDetailSheet } from '../components/MileageDetailSheet'
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'

interface Expense {
  id: string
  amount: number
  vendor: string | null
  description: string | null
  date: string
  categoryId: string | null
  categoryName: string | null
  categoryEmoji: string | null
  expenseType?: string
  isHomeOffice?: boolean
  homeOfficePercent?: number | null
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
    totalDeductible: number
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

// Color palette for donut chart (colorblind-friendly)
// Dark-mode-safe palette: all colors have good contrast on both light (#fff) and dark (#1E293B) backgrounds
const CHART_COLORS = [
  '#2EC4B6', // teal (brighter than old #2A9D8F)
  '#E9C46A', // gold
  '#F4A261', // orange
  '#E76F51', // coral
  '#A06CD5', // purple
  '#6B9AC4', // sky blue
  '#8AB17D', // sage
  '#D4A5A5', // dusty rose
  '#F0B5B3', // blush
  '#7EB6C4', // teal light
  '#9DC183', // olive
  '#E0A458', // amber
]

export default function DashboardPage() {
  const { subdomain } = useTenant()
  const { year } = useYear()
  const { expenseKey, mileageKey, refreshExpenses, refreshMileage } = useRefresh()
  const [, setLocation] = useLocation()
  const [data, setData] = useState<DashboardData | null>(null)
  const [mileageData, setMileageData] = useState<MileageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Detail sheet state
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null)
  const [expenseSheetOpen, setExpenseSheetOpen] = useState(false)
  const [selectedTrip, setSelectedTrip] = useState<MileageTrip | null>(null)
  const [tripSheetOpen, setTripSheetOpen] = useState(false)
  const [activeDonutIndex, setActiveDonutIndex] = useState<number | null>(null)

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

  // Open expense detail sheet
  const handleExpenseClick = (expense: Expense) => {
    setSelectedExpense(expense)
    setExpenseSheetOpen(true)
  }

  // Open trip detail sheet
  const handleTripClick = (trip: MileageTrip) => {
    setSelectedTrip(trip)
    setTripSheetOpen(true)
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

  // Format date (timezone-safe)
  const formatDate = (dateStr: string) => {
    const [year, month, day] = dateStr.substring(0, 10).split('-').map(Number)
    return new Date(year, month - 1, day).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })
  }

  // Get recent expenses (last 10)
  const recentExpenses = expenses.slice(0, 10)

  // Get recent trips (last 5)
  const recentTrips = mileageData?.trips.slice(0, 5) || []

  // Prepare donut chart data (top 6 categories + "Other")
  const prepareChartData = () => {
    if (categoryBreakdown.length === 0) return []
    
    const topCategories = categoryBreakdown.slice(0, 6)
    const otherCategories = categoryBreakdown.slice(6)
    
    const chartData = topCategories.map((cat, index) => ({
      name: cat.name,
      value: cat.total,
      emoji: cat.emoji,
      color: CHART_COLORS[index % CHART_COLORS.length],
    }))
    
    if (otherCategories.length > 0) {
      const otherTotal = otherCategories.reduce((sum, cat) => sum + cat.total, 0)
      chartData.push({
        name: 'Other',
        value: otherTotal,
        emoji: '📁',
        color: CHART_COLORS[6],
      })
    }
    
    return chartData
  }

  const chartData = prepareChartData()

  const handleDonutClick = (_: any, index: number) => {
    setActiveDonutIndex((prev) => (prev === index ? null : index))
  }

  return (
    <div className="page dashboard">
      <h1 className="page__title">Dashboard</h1>

      {/* ==================== DONUT CHART ==================== */}
      {chartData.length > 0 && (
        <div className="card donut-card" onClick={(e) => { if (!(e.target as HTMLElement).closest('.recharts-pie')) setActiveDonutIndex(null) }}>
          <h2 className="card__title">Expenses by Category</h2>
          <div className="donut-container">
            <div className="donut-chart">
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={chartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="value"
                    onClick={handleDonutClick}
                    cursor="pointer"
                  >
                    {chartData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={entry.color}
                        stroke={activeDonutIndex === index ? 'var(--color-text-primary)' : 'none'}
                        strokeWidth={activeDonutIndex === index ? 2 : 0}
                      />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              {activeDonutIndex !== null && chartData[activeDonutIndex] && (
                <div className="donut-tooltip donut-tooltip--fixed">
                  <span className="donut-tooltip__emoji">{chartData[activeDonutIndex].emoji}</span>
                  <span className="donut-tooltip__name">{chartData[activeDonutIndex].name}</span>
                  <span className="donut-tooltip__value">{formatMoney(chartData[activeDonutIndex].value)}</span>
                </div>
              )}
              {activeDonutIndex === null && (
                <div className="donut-center">
                  <span className="donut-center__amount">{formatMoney(summary.totalDeductible)}</span>
                  <span className="donut-center__label">Total</span>
                </div>
              )}
            </div>
            <ul className="donut-legend">
              {chartData.map((entry, index) => (
                <li 
                  key={index} 
                  className="donut-legend__item"
                  onClick={() => entry.name !== 'Other' && handleCategoryClick(entry.name)}
                  role={entry.name !== 'Other' ? 'button' : undefined}
                  tabIndex={entry.name !== 'Other' ? 0 : undefined}
                  onKeyDown={(e) => {
                    if (entry.name !== 'Other' && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault()
                      handleCategoryClick(entry.name)
                    }
                  }}
                >
                  <span 
                    className="donut-legend__color" 
                    style={{ backgroundColor: entry.color }}
                  />
                  <span className="donut-legend__emoji">{entry.emoji}</span>
                  <span className="donut-legend__name">{entry.name}</span>
                  <span className="donut-legend__value">{formatMoney(entry.value)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* ==================== EXPENSES SECTION ==================== */}
      
      {/* Expense Summary Cards */}
      <div className="dashboard__summary dashboard__summary--half">
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

          <span className="summary-card__label">Total Expenses</span>
          <span className="summary-card__value">{formatMoney(summary.totalDeductible)}</span>
          <span className="summary-card__sub">
            {summary.year}
          </span>
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
      </div>

      {/* Expense Details Grid */}
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
                <li 
                  key={expense.id} 
                  className="expense-list__item expense-list__item--clickable"
                  onClick={() => handleExpenseClick(expense)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handleExpenseClick(expense)
                    }
                  }}
                >
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
                      {formatMoney(expense.isHomeOffice && expense.homeOfficePercent ? Math.round(expense.amount * (expense.homeOfficePercent / 100)) : expense.amount)}
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
      </div>

      {/* Section Divider */}
      <div className="dashboard__divider" />

      {/* ==================== MILEAGE SECTION ==================== */}
      
      {/* Mileage Summary Cards */}
      <div className="dashboard__summary dashboard__summary--half">
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
          <span className="summary-card__label">Total Miles</span>
          <span className="summary-card__value">
            {mileageData?.summary ? formatMiles(mileageData.summary.totalMiles) : '0'}
          </span>
          <span className="summary-card__sub">{year}</span>
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
          <span className="summary-card__label">Trips</span>
          <span className="summary-card__value">
            {mileageData?.summary?.tripCount || 0}
          </span>
          <span className="summary-card__sub">logged</span>
        </div>
      </div>

      {/* Mileage Details Grid */}
      <div className="dashboard__grid">
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
                <li 
                  key={trip.id} 
                  className="trip-list__item trip-list__item--clickable"
                  onClick={() => handleTripClick(trip)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handleTripClick(trip)
                    }
                  }}
                >
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

        {/* Estimated Deduction Card */}
        <div className="card">
          <h2 className="card__title">Est. Tax Deduction</h2>
          <div className="deduction-display">
            <span className="deduction-display__value">
              {mileageData?.summary ? formatMoney(mileageData.summary.estimatedDeduction) : '$0.00'}
            </span>
            <span className="deduction-display__rate">@ 70¢/mile (2025 IRS rate)</span>
            <p className="deduction-display__note">
              This is an estimate based on IRS standard mileage rates. Consult a tax professional for actual deductions.
            </p>
          </div>
        </div>
      </div>

      {/* Expense Detail Sheet */}
      <ExpenseDetailSheet
        expense={selectedExpense}
        isOpen={expenseSheetOpen}
        onClose={() => setExpenseSheetOpen(false)}
        onUpdate={refreshExpenses}
        onDelete={refreshExpenses}
      />

      {/* Mileage Detail Sheet */}
      <MileageDetailSheet
        trip={selectedTrip}
        isOpen={tripSheetOpen}
        onClose={() => setTripSheetOpen(false)}
        onUpdate={refreshMileage}
        onDelete={refreshMileage}
      />
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