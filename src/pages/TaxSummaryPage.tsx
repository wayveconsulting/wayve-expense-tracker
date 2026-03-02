import { useState, useEffect } from 'react'
import { useYear } from '../hooks/useYear'
import { useTenant } from '../hooks/useTenant'
import { Link } from 'wouter'

interface CategoryDetail {
  categoryId: string
  name: string
  emoji: string
  amount: number
  deductible: number
  count: number
  percentOfType: number
}

interface TypeSection {
  type: string
  label: string
  description: string
  order: number
  total: number
  deductible: number
  count: number
  percentOfTotal: number
  categories: CategoryDetail[]
}

interface TaxSummaryData {
  year: number
  totalSpent: number
  totalDeductible: number
  expenseCount: number
  sections: TypeSection[]
}

const TYPE_COLORS: Record<string, string> = {
  cogs: '#e76f51',
  operating: '#2a9d8f',
  home_office: '#e9c46a',
}

function formatDollars(cents: number): string {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export default function TaxSummaryPage() {
  const { year, nextYear, prevYear } = useYear()
  const { subdomain } = useTenant()
  const [data, setData] = useState<TaxSummaryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())

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
        const response = await fetch(`/api/reports/tax-summary?${params}`)
        if (!response.ok) throw new Error('Failed to fetch tax summary')
        const result = await response.json()
        setData(result)
      } catch (err) {
        console.error('Tax summary error:', err)
        setError('Failed to load tax summary')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [subdomain, year])

  function toggleSection(type: string) {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(type)) {
        next.delete(type)
      } else {
        next.add(type)
      }
      return next
    })
  }

  return (
    <div className="page tax-summary-page">
      <div className="tax-summary-page__nav">
        <Link href="/reports" className="back-link">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Reports
        </Link>
      </div>

      <div className="tax-summary-page__header">
        <h1 className="tax-summary-page__title">Tax Summary</h1>
        <div className="tax-summary-page__year-selector">
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
          <span className="tax-summary-page__year">{year}</span>
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

      <p className="tax-summary-page__description">
        Expenses grouped by tax classification for {year}. Tap a section to see category details.
      </p>

      {loading && (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--spacing-2xl)' }}>
          <p style={{ color: 'var(--color-text-secondary)' }}>Loading tax data...</p>
        </div>
      )}

      {error && (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--spacing-2xl)' }}>
          <p style={{ color: 'var(--color-error)' }}>{error}</p>
        </div>
      )}

      {!loading && !error && data && (
        <>
          {data.expenseCount === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 'var(--spacing-2xl)' }}>
              <p className="empty-state__icon">🧾</p>
              <p style={{ color: 'var(--color-text-secondary)' }}>No expenses recorded for {year}.</p>
            </div>
          ) : (
            <>
              {/* Grand Total — deductible is the hero */}
              <div className="tax-summary__grand-total">
                <span className="tax-summary__grand-total-label">Total Expenses</span>
                <span className="tax-summary__grand-total-value">{formatDollars(data.totalDeductible)}</span>
                <span className="tax-summary__grand-total-sub">{data.expenseCount} transactions</span>
                {data.totalDeductible !== data.totalSpent && (
                  <span className="tax-summary__grand-total-deductible">
                    💰 {formatDollars(data.totalSpent)} total spent
                  </span>
                )}
              </div>

              {/* Composition Bar — uses deductible amounts, not raw spend */}
              <div className="tax-summary__composition-bar">
                {data.sections
                  .filter((s) => s.deductible > 0)
                  .map((section) => {
                    const pct = data.totalDeductible > 0
                      ? Math.round((section.deductible / data.totalDeductible) * 100)
                      : 0
                    return (
                      <div
                        key={section.type}
                        className="tax-summary__composition-segment"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: TYPE_COLORS[section.type] || 'var(--color-text-secondary)',
                        }}
                        title={`${section.label}: ${pct}%`}
                      />
                    )
                  })}
              </div>

              {/* Composition Legend — uses deductible amounts */}
              <div className="tax-summary__composition-legend">
                {data.sections
                  .filter((s) => s.deductible > 0)
                  .map((section) => {
                    const pct = data.totalDeductible > 0
                      ? Math.round((section.deductible / data.totalDeductible) * 100)
                      : 0
                    return (
                      <div key={section.type} className="tax-summary__legend-item">
                        <span
                          className="tax-summary__legend-dot"
                          style={{ backgroundColor: TYPE_COLORS[section.type] || 'var(--color-text-secondary)' }}
                        />
                        <span className="tax-summary__legend-label">{section.label.split('(')[0].trim()}</span>
                        <span className="tax-summary__legend-pct">{pct}%</span>
                      </div>
                    )
                  })}
              </div>

              {/* Type Sections — deductible is hero, total spent is subtext */}
              <div className="tax-summary__sections">
                {data.sections.map((section) => {
                  const isExpanded = expandedSections.has(section.type)
                  const accentColor = TYPE_COLORS[section.type] || 'var(--color-text-secondary)'
                  const hasPartialDeduction = section.deductible !== section.total

                  return (
                    <div key={section.type} className="tax-summary__section">
                      <button
                        className="tax-summary__section-header"
                        onClick={() => toggleSection(section.type)}
                        aria-expanded={isExpanded}
                      >
                        <div className="tax-summary__section-left">
                          <span
                            className="tax-summary__section-indicator"
                            style={{ backgroundColor: accentColor }}
                          />
                          <div>
                            <span className="tax-summary__section-title">{section.label}</span>
                            <span className="tax-summary__section-desc">{section.description}</span>
                          </div>
                        </div>
                        <div className="tax-summary__section-right">
                          <div className="tax-summary__section-stats">
                            <span className="tax-summary__section-amount">{formatDollars(section.deductible)}</span>
                            {hasPartialDeduction && (
                              <span className="tax-summary__section-deductible">
                                {formatDollars(section.total)} total spent
                              </span>
                            )}
                            <span className="tax-summary__section-meta">
                              {section.count} txn{section.count !== 1 ? 's' : ''} · {section.percentOfTotal}%
                            </span>
                          </div>
                          <svg
                            className={`tax-summary__section-chevron ${isExpanded ? 'tax-summary__section-chevron--open' : ''}`}
                            width="20"
                            height="20"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </div>
                      </button>

                      {isExpanded && section.categories.length > 0 && (
                        <div className="tax-summary__section-details">
                          {section.categories.map((cat) => {
                            const catHasPartial = cat.deductible !== cat.amount
                            return (
                              <div key={cat.categoryId} className="tax-summary__cat-row">
                                <span className="tax-summary__cat-emoji">{cat.emoji}</span>
                                <div className="tax-summary__cat-info">
                                  <span className="tax-summary__cat-name">{cat.name}</span>
                                  {catHasPartial && (
                                    <span className="tax-summary__cat-deductible">
                                      {formatDollars(cat.amount)} total spent
                                    </span>
                                  )}
                                </div>
                                <span className="tax-summary__cat-count">{cat.count}</span>
                                <span className="tax-summary__cat-amount">{formatDollars(cat.deductible)}</span>
                              </div>
                            )
                          })}
                        </div>
                      )}

                      {isExpanded && section.categories.length === 0 && (
                        <div className="tax-summary__section-details">
                          <p className="tax-summary__section-empty">No expenses in this category for {year}.</p>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Disclaimer */}
              <p className="tax-summary__disclaimer">
                This summary groups expenses by their assigned classification. It is not tax advice. 
                Consult a qualified tax professional for actual tax preparation and filing.
              </p>
            </>
          )}
        </>
      )}
    </div>
  )
}
