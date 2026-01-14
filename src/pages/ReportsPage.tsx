import { useState } from 'react'
import { useYear } from '../hooks/useYear'
import { useTenant } from '../hooks/useTenant'

export default function ReportsPage() {
  const { year } = useYear()
  const { subdomain } = useTenant()
  
  // Date range state
  const [startDate, setStartDate] = useState(`${year}-01-01`)
  const [endDate, setEndDate] = useState(`${year}-12-31`)
  const [exporting, setExporting] = useState<string | null>(null)

  // Handle CSV export
  const handleCsvExport = async () => {
    if (!subdomain) return
    
    setExporting('csv')
    try {
      const params = new URLSearchParams({
        tenant: subdomain,
        startDate,
        endDate,
      })
      
      const response = await fetch(`/api/exports/expenses?${params}`)
      
      if (!response.ok) {
        throw new Error('Export failed')
      }
      
      // Get the blob and trigger download
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `expenses_${startDate}_to_${endDate}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Export error:', error)
      alert('Failed to export. Please try again.')
    } finally {
      setExporting(null)
    }
  }

  // Quick date range presets
  const setPreset = (preset: 'ytd' | 'year' | 'q1' | 'q2' | 'q3' | 'q4' | 'last30' | 'last90') => {
    const now = new Date()
    const currentYear = year
    
    switch (preset) {
      case 'ytd':
        setStartDate(`${currentYear}-01-01`)
        setEndDate(now.toISOString().split('T')[0])
        break
      case 'year':
        setStartDate(`${currentYear}-01-01`)
        setEndDate(`${currentYear}-12-31`)
        break
      case 'q1':
        setStartDate(`${currentYear}-01-01`)
        setEndDate(`${currentYear}-03-31`)
        break
      case 'q2':
        setStartDate(`${currentYear}-04-01`)
        setEndDate(`${currentYear}-06-30`)
        break
      case 'q3':
        setStartDate(`${currentYear}-07-01`)
        setEndDate(`${currentYear}-09-30`)
        break
      case 'q4':
        setStartDate(`${currentYear}-10-01`)
        setEndDate(`${currentYear}-12-31`)
        break
      case 'last30': {
        const thirtyAgo = new Date(now)
        thirtyAgo.setDate(thirtyAgo.getDate() - 30)
        setStartDate(thirtyAgo.toISOString().split('T')[0])
        setEndDate(now.toISOString().split('T')[0])
        break
      }
      case 'last90': {
        const ninetyAgo = new Date(now)
        ninetyAgo.setDate(ninetyAgo.getDate() - 90)
        setStartDate(ninetyAgo.toISOString().split('T')[0])
        setEndDate(now.toISOString().split('T')[0])
        break
      }
    }
  }

  const reportTypes = [
    {
      icon: '📊',
      title: 'Annual Summary',
      description: 'Complete breakdown of expenses by category for the year',
      available: false,
    },
    {
      icon: '📅',
      title: 'Quarterly Report',
      description: 'Side-by-side comparison of Q1, Q2, Q3, Q4 spending',
      available: false,
    },
    {
      icon: '🚗',
      title: 'Mileage Log',
      description: 'IRS-ready mileage report with dates, destinations, and totals',
      available: false,
    },
    {
      icon: '📎',
      title: 'Receipts Export',
      description: 'Download all receipts as a ZIP file organized by month',
      available: false,
    },
    {
      icon: '🧾',
      title: 'Tax Summary',
      description: 'Expenses grouped by tax category (COGS, Operating, Home Office)',
      available: false,
    },
  ]

  return (
    <div className="page reports-page">
      <div className="reports-page__header">
        <h1 className="reports-page__title">Reports</h1>
        <span className="reports-page__year">{year}</span>
      </div>

      <p className="reports-page__description">
        Generate reports and export your expense data.
      </p>

      {/* Date Range Selector */}
      <div className="card date-range-card">
        <h2 className="date-range-card__title">Date Range</h2>
        
        <div className="date-range-card__inputs">
          <div className="form-group">
            <label htmlFor="startDate" className="form-label">From</label>
            <input
              type="date"
              id="startDate"
              className="form-input"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label htmlFor="endDate" className="form-label">To</label>
            <input
              type="date"
              id="endDate"
              className="form-input"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>

        <div className="date-range-card__presets">
          <button className="preset-btn" onClick={() => setPreset('ytd')}>YTD</button>
          <button className="preset-btn" onClick={() => setPreset('year')}>Full Year</button>
          <button className="preset-btn" onClick={() => setPreset('q1')}>Q1</button>
          <button className="preset-btn" onClick={() => setPreset('q2')}>Q2</button>
          <button className="preset-btn" onClick={() => setPreset('q3')}>Q3</button>
          <button className="preset-btn" onClick={() => setPreset('q4')}>Q4</button>
          <button className="preset-btn" onClick={() => setPreset('last30')}>Last 30</button>
          <button className="preset-btn" onClick={() => setPreset('last90')}>Last 90</button>
        </div>
      </div>

      {/* CSV Export - Now Functional */}
      <div className="card export-card">
        <div className="export-card__icon">📑</div>
        <div className="export-card__content">
          <h3 className="export-card__title">CSV Export</h3>
          <p className="export-card__description">
            Download expenses as a spreadsheet-friendly CSV file
          </p>
        </div>
        <button 
          className="btn btn--primary"
          onClick={handleCsvExport}
          disabled={exporting === 'csv'}
        >
          {exporting === 'csv' ? 'Exporting...' : 'Download CSV'}
        </button>
      </div>

      {/* Other Report Types - Coming Soon */}
      <h2 className="reports-page__section-title">More Reports</h2>
      <div className="report-grid">
        {reportTypes.map((report) => (
          <button
            key={report.title}
            className="report-card"
            disabled={!report.available}
          >
            <span className="report-card__icon">{report.icon}</span>
            <div className="report-card__content">
              <span className="report-card__title">{report.title}</span>
              <span className="report-card__description">{report.description}</span>
            </div>
            {!report.available && (
              <span className="report-card__badge">Coming Soon</span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}