import { useState, useEffect } from 'react'
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
  Legend,
} from 'recharts'

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

function formatDollars(cents: number): string {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

// Tooltip for the stacked bar chart
function ChartTooltip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string }>
  label?: string
}) {
  if (!active || !payload || !payload.length) return null

  // Filter out zero values and sort descending
  const nonZero = payload.filter(p => p.value > 0).sort((a, b) => b.value - a.value)
  if (nonZero.length === 0) return null

  const total = nonZero.reduce((sum, p) => sum + p.value, 0)

  return (
    <div className="stacked-chart-tooltip">
      <p className="stacked-chart-tooltip__label">{label}</p>
      {nonZero.map((entry, i) => (
        <div key={i} className="stacked-chart-tooltip__row">
          <span
            className="stacked-chart-tooltip__color"
            style={{ backgroundColor: entry.color }}
          />
          <span className="stacked-chart-tooltip__name">{entry.name}</span>
          <span className="stacked-chart-tooltip__value">{formatDollars(entry.value)}</span>
        </div>
      ))}
      <div className="stacked-chart-tooltip__total">
        <span>Total</span>
        <span>{formatDollars(total)}</span>
      </div>
    </div>
  )
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

  // Prepare stacked bar chart data from quarterly rows
  const prepareChartData = () => {
    if (!data || data.rows.length === 0) return { chartBars: [], chartData: [] }

    // Top 6 categories by total, rest grouped as "Other"
    const topCategories = data.rows.slice(0, 6)
    const otherCategories = data.rows.slice(6)

    const quarters = ['Q1', 'Q2', 'Q3', 'Q4']
    const qKeys: Array<'q1' | 'q2' | 'q3' | 'q4'> = ['q1', 'q2', 'q3', 'q4']

    const chartData = quarters.map((label, qi) => {
      const point: Record<string, string | number> = { quarter: label }
      topCategories.forEach((row) => {
        point[row.name] = row[qKeys[qi]]
      })
      if (otherCategories.length > 0) {
        point['Other'] = otherCategories.reduce((sum, row) => sum + row[qKeys[qi]], 0)
      }
      return point
    })

    const chartBars = topCategories.map((row, i) => ({
      key: row.name,
      color: CHART_COLORS[i % CHART_COLORS.length],
    }))
    if (otherCategories.length > 0) {
      chartBars.push({
        key: 'Other',
        color: CHART_COLORS[6],
      })
    }

    return { chartBars, chartData }
  }

  const { chartBars, chartData } = prepareChartData()

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
            <>
              {/* Stacked Bar Chart */}
              <div className="card stacked-chart-card">
                <h2 className="card__title">Quarterly Comparison</h2>
                <div className="stacked-chart" onMouseDown={(e) => e.preventDefault()}>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke="var(--color-border)"
                      />
                      <XAxis
                        dataKey="quarter"
                        tick={{ fill: 'var(--color-text-secondary)', fontSize: 13 }}
                        axisLine={{ stroke: 'var(--color-border)' }}
                        tickLine={false}
                      />
                      <YAxis
                        tickFormatter={(value: number) => formatDollars(value)}
                        tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }}
                        axisLine={false}
                        tickLine={false}
                        width={70}
                      />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--color-bg-hover, rgba(0,0,0,0.04))' }} wrapperStyle={{ zIndex: 10 }} />
                      <Legend
                        wrapperStyle={{ fontSize: '0.8125rem', paddingTop: '8px' }}
                        iconType="square"
                        iconSize={10}
                      />
                      {chartBars.map((bar) => (
                        <Bar
                          key={bar.key}
                          dataKey={bar.key}
                          stackId="spending"
                          fill={bar.color}
                          radius={[0, 0, 0, 0]}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Quarterly Table */}
              <div className="quarterly-table-wrapper">
                <table className="quarterly-table">
                  <thead>
                    <tr>
                      <th className="quarterly-table__category-header quarterly-table__sticky-col">Category</th>
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
                        <td className="quarterly-table__category-cell quarterly-table__sticky-col">
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
                      <td className="quarterly-table__category-cell quarterly-table__category-cell--total quarterly-table__sticky-col">TOTAL</td>
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
            </>
          )}
        </>
      )}
    </div>
  )
}
