import { useState, useEffect, useCallback } from 'react'
import { useLocation } from 'wouter'
import { useTenant } from '../hooks/useTenant'
import { useYear } from '../hooks/useYear'
import { AddExpenseSheet } from '../components/AddExpenseSheet'

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

export default function DashboardPage() {
  const { subdomain } = useTenant()
  const { year } = useYear()
  const [, setLocation] = useLocation()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  const fetchDashboard = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (subdomain) params.set('tenant', subdomain)
      params.set('year', String(year))
      params.set('limit', '500')

      const response = await fetch(`/api/expenses?${params}`)
      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || 'Failed to fetch expenses')
      }

      const result = await response.json()
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [subdomain, year])

  useEffect(() => {
    fetchDashboard()
  }, [fetchDashboard])

  // Handle successful expense creation
  const handleExpenseAdded = () => {
    fetchDashboard()
  }

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

  // Format date
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })
  }

  // Get recent expenses (last 10)
  const recentExpenses = expenses.slice(0, 10)

  return (
    <div className="page dashboard">
      {/* Summary Cards */}
      <div className="dashboard__summary">
        <div className="summary-card">
          <span className="summary-card__label">Total Spent</span>
          <span className="summary-card__value">{formatMoney(summary.totalAmount)}</span>
          <span className="summary-card__sub">{summary.year}</span>
        </div>
        <div className="summary-card">
          <span className="summary-card__label">Expenses</span>
          <span className="summary-card__value">{summary.expenseCount}</span>
          <span className="summary-card__sub">transactions</span>
        </div>
        <div className="summary-card">
          <span className="summary-card__label">Average</span>
          <span className="summary-card__value">{formatMoney(summary.averageAmount)}</span>
          <span className="summary-card__sub">per expense</span>
        </div>
      </div>

      {/* Two Column Layout */}
      <div className="dashboard__grid">
        {/* Recent Expenses */}
        <div className="card">
          <h2 className="card__title">Recent Expenses</h2>
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
      </div>

      {/* FAB - TODO: Make visibility controlled by settings */}
      <button 
        className="fab" 
        onClick={() => setSheetOpen(true)}
        aria-label="Add expense"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>

      {/* Add Expense Bottom Sheet */}
      <AddExpenseSheet
        isOpen={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onSuccess={handleExpenseAdded}
      />
    </div>
  )
}