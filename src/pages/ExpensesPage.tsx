import { useState, useEffect } from 'react'
import { useTenant } from '../hooks/useTenant'
import { useYear } from '../hooks/useYear'

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

export default function ExpensesPage() {
  const { subdomain } = useTenant()
  const { year } = useYear()
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => {
    async function fetchExpenses() {
      try {
        setLoading(true)
        const params = new URLSearchParams()
        if (subdomain) params.set('tenant', subdomain)
        params.set('year', String(year))
        params.set('limit', '1000')

        const response = await fetch(`/api/expenses?${params}`)
        if (!response.ok) {
          const err = await response.json()
          throw new Error(err.error || 'Failed to fetch expenses')
        }

        const result = await response.json()
        setExpenses(result.expenses)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }

    fetchExpenses()
  }, [subdomain, year])

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
      year: 'numeric',
    })
  }

  // Filter expenses by search term
  const filteredExpenses = expenses.filter(expense => {
    if (!searchTerm) return true
    const term = searchTerm.toLowerCase()
    return (
      expense.vendor?.toLowerCase().includes(term) ||
      expense.description?.toLowerCase().includes(term) ||
      expense.categoryName?.toLowerCase().includes(term)
    )
  })

  // Group expenses by month
  const expensesByMonth = filteredExpenses.reduce((acc, expense) => {
    const date = new Date(expense.date)
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    const monthLabel = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    
    if (!acc[monthKey]) {
      acc[monthKey] = { label: monthLabel, expenses: [], total: 0 }
    }
    acc[monthKey].expenses.push(expense)
    acc[monthKey].total += expense.amount
    return acc
  }, {} as Record<string, { label: string; expenses: Expense[]; total: number }>)

  // Sort months descending (newest first)
  const sortedMonths = Object.entries(expensesByMonth).sort((a, b) => b[0].localeCompare(a[0]))

  if (loading) {
    return (
      <div className="page">
        <p style={{ color: 'var(--color-text-secondary)' }}>Loading expenses...</p>
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

  return (
    <div className="page expenses-page">
      {/* Search Bar */}
      <div className="search-bar">
        <svg className="search-bar__icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input
          type="text"
          className="search-bar__input"
          placeholder="Search expenses..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        {searchTerm && (
          <button 
            className="search-bar__clear"
            onClick={() => setSearchTerm('')}
            aria-label="Clear search"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Results Summary */}
      <p className="expenses-page__summary">
        {filteredExpenses.length} expense{filteredExpenses.length !== 1 ? 's' : ''}
        {searchTerm && ` matching "${searchTerm}"`}
        {' · '}
        {formatMoney(filteredExpenses.reduce((sum, e) => sum + e.amount, 0))} total
      </p>

      {/* Expense List by Month */}
      {sortedMonths.length === 0 ? (
        <div className="card">
          <p style={{ color: 'var(--color-text-secondary)', margin: 0 }}>
            {searchTerm ? 'No expenses match your search.' : 'No expenses yet.'}
          </p>
        </div>
      ) : (
        sortedMonths.map(([monthKey, { label, expenses: monthExpenses, total }]) => (
          <div key={monthKey} className="expense-month">
            <div className="expense-month__header">
              <h2 className="expense-month__title">{label}</h2>
              <span className="expense-month__total">{formatMoney(total)}</span>
            </div>
            <div className="card expense-month__list">
              {monthExpenses.map((expense) => (
                <div key={expense.id} className="expense-row">
                  <div className="expense-row__icon">
                    {expense.categoryEmoji || '📝'}
                  </div>
                  <div className="expense-row__details">
                    <span className="expense-row__vendor">
                      {expense.vendor || expense.description || 'Expense'}
                    </span>
                    <span className="expense-row__meta">
                      {expense.categoryName || 'Uncategorized'} · {formatDate(expense.date)}
                    </span>
                  </div>
                  <span className="expense-row__amount">
                    {formatMoney(expense.amount)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}