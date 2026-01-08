import { useYear } from '../hooks/useYear'

export default function ReportsPage() {
  const { year } = useYear()

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
      icon: '📑',
      title: 'CSV Export',
      description: 'Spreadsheet-friendly export of all expense data',
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
        Generate reports and export your expense data. Select a report type below.
      </p>

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