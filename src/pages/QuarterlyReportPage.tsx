import { useState, useEffect } from 'react'
import { useYear } from '../hooks/useYear'
import { useTenant } from '../hooks/useTenant'
import { Link } from 'wouter'

interface QuarterlyRow {
  categoryId: string
  name: string
  emoji: string | null
  q1: number
  q2: number
  q3: number
  q4: number
  total: number
}

interface QuarterlyData {
  year: number
  rows: QuarterlyRow[]
  totals: {
    q1: number
    q2: number
    q3: number
    q4: number
    total: number
  }
}

function formatDollars(cents: number): string {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

export default function QuarterlyReportPage() {
  const { year, nextYear, prevYear } = useYear()
  const { subdomain } = useTenant()
  const [data, setData] = useState<QuarterlyData | null>(null)
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
        const response = await fetch(`/api/reports/quarterly?${params}`)
        if (!response.ok) throw new Error('Failed to fetch quarterly data')
        const result = await response.json()
        setData(result)
      } catch (err) {
        console.error('Quarterly report error:', err)
        setError('Failed to load quarterly report')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [subdomain, year])

  return (
    <div className="page quarterly-report-page">
      <div className="quarterly-report-page__nav">
        <Link href="/reports" className="back-link">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Reports
        </Link>
      </div>

      <div className="quarterly-report-page__header">
        <h1 className="quarterly-report-page__title">Quarterly Report</h1>
        <div className="quarterly-report-page__year-selector">
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
          <span className="quarterly-report-page__year">{year}</span>
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

      <p className="quarterly-report-page__description">
        Category spending breakdown by quarter for {year}.
      </p>

      {loading && (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--spacing-2xl)' }}>
          <p style={{ color: 'var(--color-text-secondary)' }}>Loading quarterly data...</p>
        </div>
      )}

      {error && (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--spacing-2xl)' }}>
          <p style={{ color: 'var(--color-error)' }}>{error}</p>
        </div>
      )}

      {!loading && !error && data && (
        <>
          {data.rows.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 'var(--spacing-2xl)' }}>
              <p className="empty-state__icon">📅</p>
              <p style={{ color: 'var(--color-text-secondary)' }}>No expenses recorded for {year}.</p>
            </div>
          ) : (
            <div className="quarterly-table-wrapper">
              <table className="quarterly-table">
                <thead>
                  <tr>
                    <th className="quarterly-table__category-header">Category</th>
                    <th className="quarterly-table__quarter-header">Q1</th>
                    <th className="quarterly-table__quarter-header">Q2</th>
                    <th className="quarterly-table__quarter-header">Q3</th>
                    <th className="quarterly-table__quarter-header">Q4</th>
                    <th className="quarterly-table__total-header">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.categoryId} className="quarterly-table__row">
                      <td className="quarterly-table__category-cell">
                        <span className="quarterly-table__emoji">{row.emoji}</span>
                        <span className="quarterly-table__name">{row.name}</span>
                      </td>
                      <td className={`quarterly-table__amount-cell ${row.q1 === 0 ? 'quarterly-table__amount-cell--zero' : ''}`}>
                        {row.q1 === 0 ? '—' : formatDollars(row.q1)}
                      </td>
                      <td className={`quarterly-table__amount-cell ${row.q2 === 0 ? 'quarterly-table__amount-cell--zero' : ''}`}>
                        {row.q2 === 0 ? '—' : formatDollars(row.q2)}
                      </td>
                      <td className={`quarterly-table__amount-cell ${row.q3 === 0 ? 'quarterly-table__amount-cell--zero' : ''}`}>
                        {row.q3 === 0 ? '—' : formatDollars(row.q3)}
                      </td>
                      <td className={`quarterly-table__amount-cell ${row.q4 === 0 ? 'quarterly-table__amount-cell--zero' : ''}`}>
                        {row.q4 === 0 ? '—' : formatDollars(row.q4)}
                      </td>
                      <td className="quarterly-table__amount-cell quarterly-table__amount-cell--total">
                        {formatDollars(row.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="quarterly-table__totals-row">
                    <td className="quarterly-table__category-cell quarterly-table__category-cell--total">TOTAL</td>
                    <td className="quarterly-table__amount-cell quarterly-table__amount-cell--total">
                      {formatDollars(data.totals.q1)}
                    </td>
                    <td className="quarterly-table__amount-cell quarterly-table__amount-cell--total">
                      {formatDollars(data.totals.q2)}
                    </td>
                    <td className="quarterly-table__amount-cell quarterly-table__amount-cell--total">
                      {formatDollars(data.totals.q3)}
                    </td>
                    <td className="quarterly-table__amount-cell quarterly-table__amount-cell--total">
                      {formatDollars(data.totals.q4)}
                    </td>
                    <td className="quarterly-table__amount-cell quarterly-table__amount-cell--grand-total">
                      {formatDollars(data.totals.total)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}