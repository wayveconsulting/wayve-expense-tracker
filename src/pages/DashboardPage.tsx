import { useEffect, useState } from 'react'
import { useTenant } from '../hooks/useTenant'
import { useYear } from '../hooks/useYear'
import { useRefresh } from '../hooks/useRefresh'
import { Link } from 'wouter'
import { ExpenseDetailSheet } from '../components/ExpenseDetailSheet'
import { MileageDetailSheet } from '../components/MileageDetailSheet'

interface Expense {
  id: string
  date: string
  vendor: string
  amount: number
  categoryId: string
  categoryName: string
  categoryEmoji: string
  type: 'cogs' | 'operating' | 'home_office'
  description: string | null
  receiptUrl: string | null
}

interface CategoryBreakdown {
  name: string
  emoji: string
  total: number
  count: number
  percentage: number
}

interface MileageTrip {
  id: string
  date: string
  startLocation: string
  endLocation: string
  distanceMiles: number
  isRoundTrip: boolean
  description: string | null
}

interface ExpenseSummary {
  totalAmount: number
  expenseCount: number
  averageAmount: number
  year: number
}

interface MileageSummary {
  totalMiles: number
  tripCount: number
  year: number
}

export default function DashboardPage() {
  const { subdomain } = useTenant()
  const { year } = useYear()
  const { expenseKey, mileageKey, refreshExpenses, refreshMileage } = useRefresh()
  
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [categoryBreakdown, setCategoryBreakdown] = useState<CategoryBreakdown[]>([])
  const [summary, setSummary] = useState<ExpenseSummary | null>(null)
  const [mileageTrips, setMileageTrips] = useState<MileageTrip[]>([])
  const [mileageSummary, setMileageSummary] = useState<MileageSummary | null>(null)
  const [loading, setLoading] = useState(true)
  
  // Detail sheet state
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null)
  const [selectedTrip, setSelectedTrip] = useState<MileageTrip | null>(null)
  const [expenseSheetOpen, setExpenseSheetOpen] = useState(false)
  const [tripSheetOpen, setTripSheetOpen] = useState(false)

  useEffect(() => {
    async function fetchData() {
      if (!subdomain) return
      setLoading(true)
      
      const params = new URLSearchParams({
        tenant: subdomain,
        year: year.toString(),
        limit: '500'
      })

      try {
        const [expenseResponse, mileageResponse] = await Promise.all([
          fetch(`/api/expenses?${params}`),
          fetch(`/api/mileage?${params}`)
        ])

        if (expenseResponse.ok) {
          const result = await expenseResponse.json()
          // Map API response to component interface
          const mappedExpenses = (result.expenses || []).map((exp: any) => ({
            ...exp,
            categoryName: exp.category,
            categoryEmoji: exp.emoji,
            categoryId: exp.categoryId || ''
          }))
          setExpenses(mappedExpenses)
          setCategoryBreakdown(result.categoryBreakdown || [])
          setSummary(result.summary || null)
        }

        if (mileageResponse.ok) {
          const mileageResult = await mileageResponse.json()
          // Map API response to component interface
          const mappedTrips = (mileageResult.trips || []).map((trip: any) => ({
            ...trip,
            distanceMiles: trip.distance,
            isRoundTrip: trip.isRoundTrip || false
          }))
          setMileageTrips(mappedTrips)
          setMileageSummary(mileageResult.summary || null)
        }
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [subdomain, year, expenseKey, mileageKey])

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(cents / 100)
  }

  const formatMiles = (milesX100: number) => {
    return (milesX100 / 100).toFixed(1)
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const recentExpenses = expenses
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5)

  const recentTrips = mileageTrips
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5)

  const totalMiles = mileageSummary?.totalMiles || 0
  const estimatedDeduction = Math.round((totalMiles / 100) * 0.70 * 100) // 70¢/mile, convert back to cents

  const handleExpenseClick = (expense: Expense) => {
    setSelectedExpense(expense)
    setExpenseSheetOpen(true)
  }

  const handleTripClick = (trip: MileageTrip) => {
    setSelectedTrip(trip)
    setTripSheetOpen(true)
  }

  // Handlers for detail sheet callbacks
  const handleExpenseUpdate = () => {
    refreshExpenses()
  }

  const handleExpenseDelete = () => {
    refreshExpenses()
  }

  const handleTripUpdate = () => {
    refreshMileage()
  }

  const handleTripDelete = () => {
    refreshMileage()
  }

  if (loading) {
    return <div className="page-loading">Loading dashboard...</div>
  }

  return (
    <div className="dashboard-page">
      <h1 className="page-title">Dashboard</h1>

      {/* EXPENSES SECTION */}
      <section className="dashboard__section">
        <div className="dashboard__summary-row">
          <Link href="/reports">
            <div className="summary-card summary-card--clickable">
              <div className="summary-card__label">Total Spent</div>
              <div className="summary-card__value">
                {formatCurrency(summary?.totalAmount || 0)}
              </div>
            </div>
          </Link>

          <Link href="/expenses">
            <div className="summary-card summary-card--clickable">
              <div className="summary-card__label"># Transactions</div>
              <div className="summary-card__value">
                {summary?.expenseCount || 0}
              </div>
            </div>
          </Link>
        </div>

        <div className="dashboard__grid">
          <div className="dashboard__card">
            <Link href="/expenses">
              <h2 className="dashboard__card-title dashboard__card-title--clickable">
                Recent Expenses
              </h2>
            </Link>
            {recentExpenses.length === 0 ? (
              <p className="dashboard__empty">No expenses yet</p>
            ) : (
              <ul className="dashboard__list">
                {recentExpenses.map((expense) => (
                  <li 
                    key={expense.id} 
                    className="dashboard__list-item dashboard__list-item--clickable"
                    onClick={() => handleExpenseClick(expense)}
                  >
                    <div className="dashboard__list-item-main">
                      <span className="dashboard__list-emoji">{expense.categoryEmoji}</span>
                      <div className="dashboard__list-details">
                        <div className="dashboard__list-vendor">{expense.vendor}</div>
                        <div className="dashboard__list-category">{expense.categoryName}</div>
                      </div>
                    </div>
                    <div className="dashboard__list-meta">
                      <div className="dashboard__list-amount">{formatCurrency(expense.amount)}</div>
                      <div className="dashboard__list-date">{formatDate(expense.date)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="dashboard__card">
            <h2 className="dashboard__card-title">By Category</h2>
            {categoryBreakdown.length === 0 ? (
              <p className="dashboard__empty">No categories yet</p>
            ) : (
              <ul className="dashboard__list">
                {categoryBreakdown.slice(0, 5).map((cat) => (
                  <Link key={cat.name} href={`/expenses?category=${encodeURIComponent(cat.name)}`}>
                    <li className="dashboard__list-item dashboard__list-item--clickable">
                      <div className="dashboard__list-item-main">
                        <span className="dashboard__list-emoji">{cat.emoji}</span>
                        <div className="dashboard__list-details">
                          <div className="dashboard__list-vendor">{cat.name}</div>
                          <div className="dashboard__list-category">{cat.count} transactions</div>
                        </div>
                      </div>
                      <div className="dashboard__list-meta">
                        <div className="dashboard__list-amount">{formatCurrency(cat.total)}</div>
                        <div className="dashboard__list-percentage">{cat.percentage.toFixed(1)}%</div>
                      </div>
                    </li>
                  </Link>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <div className="dashboard__divider"></div>

      {/* MILEAGE SECTION */}
      <section className="dashboard__section">
        <div className="dashboard__summary-row">
          <div className="summary-card">
            <div className="summary-card__label">Total Miles</div>
            <div className="summary-card__value">
              {formatMiles(totalMiles)}
            </div>
          </div>

          <div className="summary-card">
            <div className="summary-card__label"># Trips</div>
            <div className="summary-card__value">
              {mileageSummary?.tripCount || 0}
            </div>
          </div>
        </div>

        <div className="dashboard__grid">
          <div className="dashboard__card">
            <Link href="/mileage">
              <h2 className="dashboard__card-title dashboard__card-title--clickable">
                Recent Trips
              </h2>
            </Link>
            {recentTrips.length === 0 ? (
              <p className="dashboard__empty">No trips yet</p>
            ) : (
              <ul className="dashboard__list">
                {recentTrips.map((trip) => (
                  <li 
                    key={trip.id} 
                    className="dashboard__list-item dashboard__list-item--clickable"
                    onClick={() => handleTripClick(trip)}
                  >
                    <div className="dashboard__list-item-main">
                      <span className="dashboard__list-emoji">🚗</span>
                      <div className="dashboard__list-details">
                        <div className="dashboard__list-vendor">
                          {trip.startLocation} → {trip.endLocation}
                        </div>
                        {trip.description && (
                          <div className="dashboard__list-category">{trip.description}</div>
                        )}
                      </div>
                    </div>
                    <div className="dashboard__list-meta">
                      <div className="dashboard__list-amount">{formatMiles(trip.distanceMiles)} mi</div>
                      <div className="dashboard__list-date">{formatDate(trip.date)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="dashboard__card">
            <h2 className="dashboard__card-title">Est. Tax Deduction</h2>
            <div className="deduction-display">
              <div className="deduction-display__amount">
                {formatCurrency(estimatedDeduction)}
              </div>
              <div className="deduction-display__note">
                Based on {formatMiles(totalMiles)} miles at $0.70/mile
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Detail Sheets */}
      <ExpenseDetailSheet
        isOpen={expenseSheetOpen}
        onClose={() => {
          setExpenseSheetOpen(false)
          setSelectedExpense(null)
        }}
        expense={selectedExpense}
        onUpdate={handleExpenseUpdate}
        onDelete={handleExpenseDelete}
      />

      <MileageDetailSheet
        isOpen={tripSheetOpen}
        onClose={() => {
          setTripSheetOpen(false)
          setSelectedTrip(null)
        }}
        trip={selectedTrip}
        onUpdate={handleTripUpdate}
        onDelete={handleTripDelete}
      />
    </div>
  )
}