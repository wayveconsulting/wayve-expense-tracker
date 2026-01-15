import { useState, useEffect } from 'react'
import { useLocation } from 'wouter'
import { useTenant } from '../hooks/useTenant'
import { useYear } from '../hooks/useYear'
import { useRefresh } from '../hooks/useRefresh'

interface Category {
  name: string
  emoji: string | null
  total: number
  count: number
}

export default function CategoriesPage() {
  const { subdomain } = useTenant()
  const { year } = useYear()
  const { expenseKey } = useRefresh()
  const [, setLocation] = useLocation()
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchCategories() {
      try {
        setLoading(true)
        const params = new URLSearchParams()
        if (subdomain) params.set('tenant', subdomain)
        params.set('year', String(year))
        params.set('limit', '1000')

        const response = await fetch(`/api/expenses?${params}`)
        if (!response.ok) {
          const err = await response.json()
          throw new Error(err.error || 'Failed to fetch data')
        }

        const result = await response.json()
        setCategories(result.categoryBreakdown)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }

    fetchCategories()
  }, [subdomain, year, expenseKey])

  // Format cents to dollars
  const formatMoney = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(cents / 100)
  }

  // Navigate to expenses filtered by category
  const handleCategoryClick = (categoryName: string) => {
    setLocation(`/expenses?category=${encodeURIComponent(categoryName)}`)
  }

  const totalSpent = categories.reduce((sum, cat) => sum + cat.total, 0)
  const totalCount = categories.reduce((sum, cat) => sum + cat.count, 0)

  if (loading) {
    return (
      <div className="page">
        <p style={{ color: 'var(--color-text-secondary)' }}>Loading categories...</p>
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
    <div className="page categories-page">
      {/* Summary */}
      <div className="categories-page__summary">
        <span>{categories.length} categories</span>
        <span className="categories-page__dot">·</span>
        <span>{totalCount} expenses</span>
        <span className="categories-page__dot">·</span>
        <span>{formatMoney(totalSpent)} total</span>
      </div>

      {/* Category Cards */}
      {categories.length === 0 ? (
        <div className="card">
          <p style={{ color: 'var(--color-text-secondary)', margin: 0 }}>
            No expenses recorded for {year}.
          </p>
        </div>
      ) : (
        <div className="category-grid">
          {categories.map((category) => (
            <div 
              key={category.name} 
              className="category-card category-card--clickable"
              onClick={() => handleCategoryClick(category.name)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  handleCategoryClick(category.name)
                }
              }}
            >
              <div className="category-card__header">
                <span className="category-card__emoji">{category.emoji || '📁'}</span>
                <span className="category-card__name">{category.name}</span>
              </div>
              <div className="category-card__stats">
                <div className="category-card__total">{formatMoney(category.total)}</div>
                <div className="category-card__count">
                  {category.count} expense{category.count !== 1 ? 's' : ''}
                </div>
              </div>
              <div className="category-card__bar-container">
                <div 
                  className="category-card__bar" 
                  style={{ width: `${(category.total / categories[0].total) * 100}%` }}
                />
              </div>
              <div className="category-card__percent">
                {((category.total / totalSpent) * 100).toFixed(1)}% of total
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}