import { useState, useEffect, useCallback } from 'react'
import { useYear } from '../hooks/useYear'
import { useTenant } from '../hooks/useTenant'
import { Link } from 'wouter'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'

interface MonthlySummary {
  month: number
  label: string
  labelFull: string
  total: number
  count: number
}

interface CategorySummary {
  categoryId: string
  name: string
  emoji: string
  amount: number
  count: number
  percentage: number
}

interface AnnualReportData {
  year: number
  summary: {
    totalSpent: number
    totalDeductible: number
    expenseCount: number
    activeMonths: number
    averagePerMonth: number
    highestMonth: { label: string; total: number } | null
    lowestMonth: { label: string; total: number } | null
    topCategory: { name: string; emoji: string; amount: number; percentage: number } | null
  }
  monthlyBreakdown: MonthlySummary[]
  categoryBreakdown: CategorySummary[]
}

function formatDollars(cents: number): string {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatDollarsShort(cents: number): string {
  const dollars = cents / 100
  if (dollars >= 10000) {
    return '$' + (dollars / 1000).toFixed(1) + 'k'
  }
  return formatDollars(cents)
}

// Custom tooltip for monthly chart
function MonthlyTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
  if (!active || !payload || !payload.length) return null
  return (
    <div className="annual-chart-tooltip">
      <p className="annual-chart-tooltip__label">{label}</p>
      <p className="annual-chart-tooltip__value">{formatDollars(payload[0].value)}</p>
    </div>
  )
}

// Custom bar shape with optional stroke for selected state
function CustomBar(props: any) {
  const { x, y, width, height, fill, isSelected } = props
  if (!height || height <= 0) return null
  const radius = 4
  return (
    <g>
      <path
        d={`M${x},${y + height}
            L${x},${y + radius}
            Q${x},${y} ${x + radius},${y}
            L${x + width - radius},${y}
            Q${x + width},${y} ${x + width},${y + radius}
            L${x + width},${y + height}
            Z`}
        fill={fill}
        stroke={isSelected ? 'var(--color-text-primary)' : 'none'}
        strokeWidth={isSelected ? 2 : 0}
      />
    </g>
  )
}

export default function AnnualSummaryPage() {
  const { year, nextYear, prevYear } = useYear()
  const { subdomain } = useTenant()
  const [data, setData] = useState<AnnualReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeMonth, setActiveMonth] = useState<number | null>(null)

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
        const response = await fetch(`/api/reports/annual?${params}`)
        if (!response.ok) throw new Error('Failed to fetch annual report')
        const result = await response.json()
        setData(result)
      } catch (err) {
        console.error('Annual report error:', err)
        setError('Failed to load annual report')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [subdomain, year])

  // Reset selection on year change
  useEffect(() => {
    setActiveMonth(null)
  }, [year])

  const handleBarClick = useCallback((_: any, index: number) => {
    setActiveMonth((prev) => (prev === index ? null : index))
  }, [])

  // Prepare chart data — always show all 12 months
  const chartData = data
    ? data.monthlyBreakdown.map((m) => ({
        name: m.label,
        total: m.total,
      }))
    : []

  return (
    <div className="page annual-report-page">
      <div className="annual-report-page__nav">
        <Link href="/reports" className="back-link">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Reports
        </Link>
      </div>

      <div className="annual-report-page__header">
        <h1 className="annual-report-page__title">Annual Summary</h1>
        <div className="annual-report-page__year-selector">
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
          <span className="annual-report-page__year">{year}</span>
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

      <p className="annual-report-page__description">
        Complete spending overview for {year}.
      </p>

      {loading && (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--spacing-2xl)' }}>
          <p style={{ color: 'var(--color-text-secondary)' }}>Loading annual data...</p>
        </div>
      )}

      {error && (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--spacing-2xl)' }}>
          <p style={{ color: 'var(--color-error)' }}>{error}</p>
        </div>
      )}

      {!loading && !error && data && (
        <>
          {data.summary.expenseCount === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 'var(--spacing-2xl)' }}>
              <p className="empty-state__icon">📊</p>
              <p style={{ color: 'var(--color-text-secondary)' }}>No expenses recorded for {year}.</p>
            </div>
          ) : (
            <>
              {/* Summary Cards */}
              <div className="annual-report__summary">
                <div className="annual-report__stat-card annual-report__stat-card--primary">
                  <span className="annual-report__stat-label">Total Expenses</span>
                  <span className="annual-report__stat-value">{formatDollars(data.summary.totalDeductible)}</span>
                  <span className="annual-report__stat-sub">
                    {data.summary.expenseCount} transaction{data.summary.expenseCount !== 1 ? 's' : ''} · {year}
                  </span>
                </div>
                <div className="annual-report__stat-card">
                  <span className="annual-report__stat-label">Avg / Month</span>
                  <span className="annual-report__stat-value">{formatDollars(data.summary.averagePerMonth)}</span>
                  <span className="annual-report__stat-sub">{data.summary.activeMonths} active month{data.summary.activeMonths !== 1 ? 's' : ''}</span>
                </div>
                {data.summary.topCategory && (
                  <div className="annual-report__stat-card">
                    <span className="annual-report__stat-label">Top Category</span>
                    <span className="annual-report__stat-value">
                      {data.summary.topCategory.emoji} {data.summary.topCategory.name}
                    </span>
                    <span className="annual-report__stat-sub">
                      {formatDollars(data.summary.topCategory.amount)} ({data.summary.topCategory.percentage}%)
                    </span>
                  </div>
                )}
              </div>

              {/* High / Low months */}
              {data.summary.highestMonth && data.summary.lowestMonth && data.summary.activeMonths > 1 && (
                <div className="annual-report__highlights">
                  <div className="annual-report__highlight">
                    <span className="annual-report__highlight-icon">📈</span>
                    <div>
                      <span className="annual-report__highlight-label">Highest</span>
                      <span className="annual-report__highlight-value">
                        {data.summary.highestMonth.label} — {formatDollars(data.summary.highestMonth.total)}
                      </span>
                    </div>
                  </div>
                  <div className="annual-report__highlight">
                    <span className="annual-report__highlight-icon">📉</span>
                    <div>
                      <span className="annual-report__highlight-label">Lowest</span>
                      <span className="annual-report__highlight-value">
                        {data.summary.lowestMonth.label} — {formatDollars(data.summary.lowestMonth.total)}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Monthly Spending Chart */}
              <div className="card annual-report__chart-card">
                <h2 className="card__title">Monthly Spending</h2>
                <div className="annual-report__chart-scroll" onMouseDown={(e) => e.preventDefault()}>
                  <div className="annual-report__chart-inner">
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }} onClick={(_: any, e: any) => { if (!e) setActiveMonth(null) }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                        <XAxis
                          dataKey="name"
                          tick={{ fontSize: 12, fill: 'var(--color-text-secondary)' }}
                          axisLine={{ stroke: 'var(--color-border)' }}
                          tickLine={false}
                          interval={0}
                        />
                        <YAxis
                          tickFormatter={(v: number) => formatDollarsShort(v)}
                          tick={{ fontSize: 12, fill: 'var(--color-text-secondary)' }}
                          axisLine={false}
                          tickLine={false}
                          width={55}
                        />
                        <Tooltip
                          content={<MonthlyTooltip />}
                          cursor={false}
                          active={activeMonth !== null}
                        />
                        <Bar
                          dataKey="total"
                          fill="var(--color-primary)"
                          radius={[4, 4, 0, 0]}
                          maxBarSize={40}
                          onClick={handleBarClick}
                          shape={(props: any) => (
                            <CustomBar {...props} isSelected={activeMonth === props.index} />
                          )}
                        >
                          {chartData.map((_, index) => (
                            <Cell key={`cell-${index}`} cursor="pointer" />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Category Breakdown Table */}
              <div className="card annual-report__category-card">
                <h2 className="card__title">By Category</h2>
                <div className="annual-report__category-list">
                  {data.categoryBreakdown.map((cat) => (
                    <div key={cat.categoryId} className="annual-report__category-row">
                      <div className="annual-report__category-info">
                        <span className="annual-report__category-emoji">{cat.emoji}</span>
                        <span className="annual-report__category-name">{cat.name}</span>
                      </div>
                      <div className="annual-report__category-stats">
                        <span className="annual-report__category-count">{cat.count} txn{cat.count !== 1 ? 's' : ''}</span>
                        <span className="annual-report__category-pct">{cat.percentage}%</span>
                        <span className="annual-report__category-amount">{formatDollars(cat.amount)}</span>
                      </div>
                      <div className="annual-report__category-bar-track">
                        <div
                          className="annual-report__category-bar-fill"
                          style={{ width: `${cat.percentage}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}