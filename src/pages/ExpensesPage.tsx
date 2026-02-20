import { useState, useEffect, useCallback } from 'react'
import { useSearch } from 'wouter'
import { useTenant } from '../hooks/useTenant'
import { useYear } from '../hooks/useYear'
import { useRefresh } from '../hooks/useRefresh'
import { ExpenseDetailSheet } from '../components/ExpenseDetailSheet'
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
  expenseType?: string
  isHomeOffice?: boolean
  homeOfficePercent?: number | null
  attachmentCount?: number
}

export default function ExpensesPage() {
  const { subdomain } = useTenant()
  const { year } = useYear()
  const { expenseKey, refreshExpenses } = useRefresh()
  const searchString = useSearch()
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  
  // Category filter from URL
  const urlParams = new URLSearchParams(searchString)
  const categoryFilter = urlParams.get('category')
  
  // Sheet states
  const [detailSheetOpen, setDetailSheetOpen] = useState(false)
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null)
  const [addSheetOpen, setAddSheetOpen] = useState(false)

  const fetchExpenses = useCallback(async () => {
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
  }, [subdomain, year])

  useEffect(() => {
    fetchExpenses()
  }, [fetchExpenses, expenseKey])

  // Format cents to dollars
  const formatMoney = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(cents / 100)
  }

  // Format date (timezone-safe)
  const formatDate = (dateStr: string) => {
    const [year, month, day] = dateStr.substring(0, 10).split('-').map(Number)
    return new Date(year, month - 1, day).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  // Filter expenses by search term AND category filter
  const filteredExpenses = expenses.filter(expense => {
    // First apply category filter from URL
    if (categoryFilter && expense.categoryName !== categoryFilter) {
      return false
    }
    
    // Then apply search term
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
    const [yr, mo, dy] = expense.date.substring(0, 10).split('-').map(Number)
    const date = new Date(yr, mo - 1, dy)
    const monthKey = `${yr}-${String(mo).padStart(2, '0')}`
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

  // Handle expense click
  const handleExpenseClick = (expense: Expense) => {
    setSelectedExpense(expense)
    setDetailSheetOpen(true)
  }

  // Handle successful expense update
  const handleExpenseUpdated = () => {
    refreshExpenses()
  }

  // Handle successful expense deletion
  const handleExpenseDeleted = () => {
    refreshExpenses()
  }

  // Clear category filter
  const clearCategoryFilter = () => {
    window.history.replaceState({}, '', '/expenses')
    window.location.href = '/expenses'
  }

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
      <h1 className="page__title">Expenses</h1>
      {/* Category Filter Banner */}
      {categoryFilter && (
        <div className="filter-banner">
          <span className="filter-banner__text">
            Showing: <strong>{categoryFilter}</strong>
          </span>
          <button 
            className="filter-banner__clear"
            onClick={clearCategoryFilter}
            aria-label="Clear filter"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
            Clear
          </button>
        </div>
      )}

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

      <button className="add-link" onClick={() => setAddSheetOpen(true)}>
        + Add Expense
      </button>

      {/* Results Summary */}
      <p className="expenses-page__summary">
        {filteredExpenses.length} expense{filteredExpenses.length !== 1 ? 's' : ''}
        {categoryFilter && ` in ${categoryFilter}`}
        {searchTerm && ` matching "${searchTerm}"`}
        {' · '}
        {formatMoney(filteredExpenses.reduce((sum, e) => sum + e.amount, 0))} total
      </p>

      {/* Expense List by Month */}
      {sortedMonths.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__icon">🧾</div>
          <h2 className="empty-state__title">
            {searchTerm || categoryFilter ? 'No matches found' : 'No expenses yet'}
          </h2>
          <p className="empty-state__description">
            {searchTerm 
              ? `No expenses match "${searchTerm}". Try a different search term.`
              : categoryFilter
              ? `No expenses in "${categoryFilter}" for ${year}.`
              : 'Start tracking your business expenses by adding your first one.'}
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
                <div 
                  key={expense.id} 
                  className="expense-row expense-row--clickable"
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
                  <div className="expense-row__icon">
                    {expense.categoryEmoji || '📁'}
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
                    {expense.isHomeOffice && <span className="expense-row__home-icon" title="Home Office Expense">🏡</span>}
                    {Number(expense.attachmentCount) > 0 && <span className="attachment-indicator" title="Has attachments">📎</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {/* Expense Detail Bottom Sheet */}
      <ExpenseDetailSheet
        expense={selectedExpense}
        isOpen={detailSheetOpen}
        onClose={() => setDetailSheetOpen(false)}
        onUpdate={handleExpenseUpdated}
        onDelete={handleExpenseDeleted}
      />

      <AddExpenseSheet
        isOpen={addSheetOpen}
        onClose={() => setAddSheetOpen(false)}
        onSuccess={() => {
          setAddSheetOpen(false)
          refreshExpenses()
        }}
      />

    </div>
  )
}