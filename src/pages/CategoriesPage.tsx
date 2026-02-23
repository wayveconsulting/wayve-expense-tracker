import { useState, useEffect } from 'react'
import { useLocation } from 'wouter'
import { useTenant } from '../hooks/useTenant'
import { useYear } from '../hooks/useYear'
import { useRefresh } from '../hooks/useRefresh'
import { CategorySheet } from '../components/CategorySheet'

interface Category {
  id: string
  name: string
  emoji: string | null
  expenseType: string
  homeOfficeEligible: boolean
  isSystem: boolean
  sortOrder: number
  isActive: boolean
  total: number
  count: number
}

interface HomeOfficeSettings {
  homeTotalSqft: number | null
  homeOfficeSqft: number | null
  homeOfficeIgnored: boolean
  deductionPercent: number | null
}

export default function CategoriesPage() {
  const { subdomain } = useTenant()
  const { year } = useYear()
  const { expenseKey, refreshExpenses } = useRefresh()
  const [, setLocation] = useLocation()

  // Data state
  const [categories, setCategories] = useState<Category[]>([])
  const [homeOfficeSettings, setHomeOfficeSettings] = useState<HomeOfficeSettings>({
    homeTotalSqft: null,
    homeOfficeSqft: null,
    homeOfficeIgnored: false,
    deductionPercent: null,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Sheet state
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)

  // Delete confirmation state
  const [deletingCategory, setDeletingCategory] = useState<Category | null>(null)
  const [deleteReassignTo, setDeleteReassignTo] = useState<string>('')
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)

  // Home Office edit state
  const [editingHomeOffice, setEditingHomeOffice] = useState(false)
  const [hoTotalSqft, setHoTotalSqft] = useState('')
  const [hoOfficeSqft, setHoOfficeSqft] = useState('')
  const [hoSaving, setHoSaving] = useState(false)
  const [hoError, setHoError] = useState<string | null>(null)

  // Home Office ignore confirmation state
  const [showIgnoreConfirm, setShowIgnoreConfirm] = useState(false)
  const [ignoreSaving, setIgnoreSaving] = useState(false)

  // Local refresh key for category changes that don't affect expenses
  const [categoryKey, setCategoryKey] = useState(0)

  // ============================================
  // DERIVED STATE
  // ============================================
  const homeOfficeComplete = homeOfficeSettings.homeTotalSqft !== null && homeOfficeSettings.homeOfficeSqft !== null
  const homeOfficeIgnored = homeOfficeSettings.homeOfficeIgnored
  const hasHomeOfficeCategories = categories.some(c => c.homeOfficeEligible)
  // Show above categories when: has eligible categories, NOT complete, NOT ignored
  const showHomeOfficeAbove = hasHomeOfficeCategories && !homeOfficeComplete && !homeOfficeIgnored
  // Show below categories when: has eligible categories AND (complete OR ignored)
  const showHomeOfficeBelow = hasHomeOfficeCategories && (homeOfficeComplete || homeOfficeIgnored)

  // ============================================
  // FETCH CATEGORIES WITH SPENDING DATA
  // ============================================
  useEffect(() => {
    async function fetchCategories() {
      try {
        setLoading(true)
        const params = new URLSearchParams()
        if (subdomain) params.set('tenant', subdomain)
        params.set('includeSpending', 'true')
        params.set('year', String(year))

        const response = await fetch(`/api/categories?${params}`)
        if (!response.ok) {
          const err = await response.json()
          throw new Error(err.error || 'Failed to fetch categories')
        }

        const result = await response.json()
        setCategories(result.categories)
        if (result.homeOfficeSettings) {
          setHomeOfficeSettings(result.homeOfficeSettings)
          // Sync local inputs
          setHoTotalSqft(result.homeOfficeSettings.homeTotalSqft?.toString() || '')
          setHoOfficeSqft(result.homeOfficeSettings.homeOfficeSqft?.toString() || '')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }

    fetchCategories()
  }, [subdomain, year, expenseKey, categoryKey])

  // ============================================
  // HELPERS
  // ============================================
  const formatMoney = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(cents / 100)
  }

  const handleCategoryClick = (categoryName: string) => {
    setLocation(`/expenses?category=${encodeURIComponent(categoryName)}`)
  }

  const totalSpent = categories.reduce((sum, cat) => sum + cat.total, 0)
  const totalCount = categories.reduce((sum, cat) => sum + cat.count, 0)

  // ============================================
  // ADD / EDIT HANDLERS
  // ============================================
  function handleAdd() {
    setEditingCategory(null)
    setSheetOpen(true)
  }

  function handleEdit(e: React.MouseEvent, category: Category) {
    e.stopPropagation() // Don't trigger card click → navigate
    setEditingCategory(category)
    setSheetOpen(true)
  }

  function handleSheetSuccess() {
    setCategoryKey(k => k + 1)
    refreshExpenses() // Category changes may affect expense displays
  }

  // ============================================
  // DELETE HANDLERS
  // ============================================
  function handleDeleteClick(e: React.MouseEvent, category: Category) {
    e.stopPropagation()
    setDeletingCategory(category)
    setDeleteReassignTo('') // Default = Uncategorized (empty means server picks it)
  }

  async function handleDeleteConfirm() {
    if (!deletingCategory) return

    try {
      setDeleteSubmitting(true)

      const body: Record<string, string> = {}
      if (deleteReassignTo) {
        body.reassignTo = deleteReassignTo
      }

      const response = await fetch(
        `/api/categories/${deletingCategory.id}?tenant=${subdomain}`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete category')
      }

      setDeletingCategory(null)
      setCategoryKey(k => k + 1)
      refreshExpenses()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setDeleteSubmitting(false)
    }
  }

  // ============================================
  // HOME OFFICE SETTINGS HANDLERS
  // ============================================
  async function handleHomeOfficeSave() {
    setHoError(null)

    const total = hoTotalSqft ? parseInt(hoTotalSqft) : null
    const office = hoOfficeSqft ? parseInt(hoOfficeSqft) : null

    if (total !== null && office !== null && office > total) {
      setHoError('Office space can\'t be larger than total home')
      return
    }

    try {
      setHoSaving(true)

      const response = await fetch(`/api/categories/home-office?tenant=${subdomain}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          homeTotalSqft: total,
          homeOfficeSqft: office,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.details?.join(', ') || data.error || 'Failed to save')
      }

      const result = await response.json()
      setHomeOfficeSettings(result.homeOfficeSettings)
      setEditingHomeOffice(false)
    } catch (err) {
      setHoError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setHoSaving(false)
    }
  }

  // ============================================
  // HOME OFFICE IGNORE HANDLERS
  // ============================================
  async function handleIgnoreConfirm() {
    try {
      setIgnoreSaving(true)

      const response = await fetch(`/api/categories/home-office?tenant=${subdomain}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ homeOfficeIgnored: true }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to save')
      }

      const result = await response.json()
      setHomeOfficeSettings(result.homeOfficeSettings)
      setShowIgnoreConfirm(false)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setIgnoreSaving(false)
    }
  }

  async function handleUnignore() {
    try {
      setIgnoreSaving(true)

      const response = await fetch(`/api/categories/home-office?tenant=${subdomain}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ homeOfficeIgnored: false }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to save')
      }

      const result = await response.json()
      setHomeOfficeSettings(result.homeOfficeSettings)

      // Scroll to top so user sees the section in its new position
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setIgnoreSaving(false)
    }
  }

  // ============================================
  // RENDER: HOME OFFICE SECTION (reusable)
  // ============================================
  function renderHomeOfficeSection() {
    return (
      <div className="home-office-config">
        <div className="home-office-config__header">
          <div>
            <h2 className="home-office-config__title">🏡 Home Office Deduction</h2>
            <p className="home-office-config__desc">
              Set your home dimensions to calculate the deduction percentage applied to eligible categories.
            </p>
          </div>
          {!editingHomeOffice && homeOfficeComplete && (
            <button
              className="btn btn--secondary btn--sm"
              onClick={() => setEditingHomeOffice(true)}
            >
              Edit
            </button>
          )}
          {!editingHomeOffice && !homeOfficeComplete && (
            <button
              className="btn btn--secondary btn--sm"
              onClick={() => setEditingHomeOffice(true)}
            >
              Set Up
            </button>
          )}
        </div>

        {/* Ignore checkbox — show when incomplete (above position) or when ignored (below position) */}
        {(!homeOfficeComplete) && (
          <label className="home-office-config__ignore-label">
            <input
              type="checkbox"
              checked={homeOfficeIgnored}
              onChange={(e) => {
                if (e.target.checked) {
                  setShowIgnoreConfirm(true)
                } else {
                  handleUnignore()
                }
              }}
              disabled={ignoreSaving}
            />
            <span>I don't have a home office</span>
          </label>
        )}

        {editingHomeOffice ? (
          <div className="home-office-config__form">
            {hoError && <div className="form-error">{hoError}</div>}
            <div className="home-office-config__inputs">
              <div className="form-group">
                <label htmlFor="hoTotal" className="form-label">Total Home (sq ft)</label>
                <input
                  type="number"
                  id="hoTotal"
                  className="form-input"
                  placeholder="e.g., 1500"
                  min="0"
                  max="100000"
                  value={hoTotalSqft}
                  onChange={(e) => setHoTotalSqft(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label htmlFor="hoOffice" className="form-label">Office Space (sq ft)</label>
                <input
                  type="number"
                  id="hoOffice"
                  className="form-input"
                  placeholder="e.g., 200"
                  min="0"
                  max="100000"
                  value={hoOfficeSqft}
                  onChange={(e) => setHoOfficeSqft(e.target.value)}
                />
              </div>
            </div>
            {hoTotalSqft && hoOfficeSqft && parseInt(hoOfficeSqft) <= parseInt(hoTotalSqft) && (
              <div className="home-office-config__preview">
                Deduction Rate: <strong>{((parseInt(hoOfficeSqft) / parseInt(hoTotalSqft)) * 100).toFixed(1)}%</strong>
              </div>
            )}
            <div className="home-office-config__actions">
              <button
                className="btn btn--secondary btn--sm"
                onClick={() => {
                  setEditingHomeOffice(false)
                  setHoError(null)
                  // Reset to saved values
                  setHoTotalSqft(homeOfficeSettings.homeTotalSqft?.toString() || '')
                  setHoOfficeSqft(homeOfficeSettings.homeOfficeSqft?.toString() || '')
                }}
              >
                Cancel
              </button>
              <button
                className="btn btn--primary btn--sm"
                onClick={handleHomeOfficeSave}
                disabled={hoSaving}
              >
                {hoSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        ) : homeOfficeComplete ? (
          <div className="home-office-config__display">
            <div className="home-office-config__stat">
              <span className="home-office-config__stat-label">Total Home</span>
              <span className="home-office-config__stat-value">
                {homeOfficeSettings.homeTotalSqft!.toLocaleString()} sq ft
              </span>
            </div>
            <div className="home-office-config__stat">
              <span className="home-office-config__stat-label">Office Space</span>
              <span className="home-office-config__stat-value">
                {homeOfficeSettings.homeOfficeSqft?.toLocaleString() || '—'} sq ft
              </span>
            </div>
            <div className="home-office-config__stat home-office-config__stat--highlight">
              <span className="home-office-config__stat-label">Deduction Rate</span>
              <span className="home-office-config__stat-value">
                {homeOfficeSettings.deductionPercent !== null
                  ? `${homeOfficeSettings.deductionPercent}%`
                  : '—'}
              </span>
            </div>
          </div>
        ) : !homeOfficeIgnored ? (
          <div className="home-office-config__empty">
            Set your home and office dimensions to see your deduction rate.
          </div>
        ) : null}

        {/* Home Office Warnings */}
        {homeOfficeSettings.homeTotalSqft && homeOfficeSettings.homeOfficeSqft && (
          <div className="home-office-config__warnings">
            {homeOfficeSettings.homeOfficeSqft > 300 && (
              <div className="home-office-config__warning">
                <span className="home-office-config__warning-icon">💡</span>
                <span>Your office exceeds 300 sq ft — the IRS simplified method caps at 300 sq ft ($1,500 max deduction). You're using the regular method, which has no cap, but keep documentation handy.</span>
              </div>
            )}
            {homeOfficeSettings.deductionPercent !== null && homeOfficeSettings.deductionPercent > 33 && (
              <div className="home-office-config__warning home-office-config__warning--caution">
                <span className="home-office-config__warning-icon">⚠️</span>
                <span>Claiming over 33% of your home as office space may increase audit scrutiny. Make sure you have documentation (photos, floor plan) to support your claim.</span>
              </div>
            )}
          </div>
        )}

        {/* Eligible categories list */}
        {homeOfficeSettings.deductionPercent !== null && (
          <div className="home-office-config__eligible">
            <span className="home-office-config__eligible-label">Eligible categories:</span>
            {categories.filter(c => c.homeOfficeEligible).map(c => (
              <span key={c.id} className="home-office-config__eligible-tag">
                {c.emoji} {c.name}
              </span>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ============================================
  // RENDER
  // ============================================
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

  // Categories sorted alphabetically by name
  const sortedCategories = [...categories].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="page categories-page">
      <div className="categories-page__header">
        <h1 className="page__title">Categories</h1>
        <button className="btn btn--primary btn--sm" onClick={handleAdd}>
          + Add
        </button>
      </div>

      {/* Summary */}
      <div className="categories-page__summary">
        <span>{categories.length} categories</span>
        <span className="categories-page__dot">·</span>
        <span>{totalCount} expenses</span>
        <span className="categories-page__dot">·</span>
        <span>{formatMoney(totalSpent)} total</span>
      </div>

      {/* Home Office ABOVE categories (incomplete + not ignored) */}
      {showHomeOfficeAbove && (
        <>
          {renderHomeOfficeSection()}
          <div className="categories-page__divider" />
        </>
      )}

      {/* Category Cards */}
      {sortedCategories.length === 0 ? (
        <div className="card">
          <p style={{ color: 'var(--color-text-secondary)', margin: 0 }}>
            No categories yet. Add one to get started!
          </p>
        </div>
      ) : (
        <div className="category-grid">
          {sortedCategories.map((category) => (
            <div
              key={category.id}
              className="category-card category-card--clickable"
              onClick={() => category.count > 0 ? handleCategoryClick(category.name) : undefined}
              role={category.count > 0 ? 'button' : undefined}
              tabIndex={category.count > 0 ? 0 : undefined}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && category.count > 0) {
                  e.preventDefault()
                  handleCategoryClick(category.name)
                }
              }}
            >
              <div className="category-card__header">
                <span className="category-card__emoji">{category.emoji || '📁'}</span>
                <span className="category-card__name">
                  {category.name}
                  {category.homeOfficeEligible && (
                    <span className="category-card__badge" title="Home Office Eligible">🏡</span>
                  )}
                  {category.isSystem && (
                    <span className="category-card__badge category-card__badge--system" title="System category">🔒</span>
                  )}
                </span>
                <span className="category-card__type-label">
                  {category.expenseType === 'cogs' ? 'COGS' :
                   category.expenseType === 'home_office' ? 'Home Office' : 'Operating'}
                </span>
                <div className="category-card__actions">
                  <button
                    className="category-card__action-btn"
                    onClick={(e) => handleEdit(e, category)}
                    aria-label={`Edit ${category.name}`}
                    title="Edit"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                  {!category.isSystem && (
                    <button
                      className="category-card__action-btn category-card__action-btn--danger"
                      onClick={(e) => handleDeleteClick(e, category)}
                      aria-label={`Delete ${category.name}`}
                      title="Delete"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
              <div className="category-card__stats">
                <div className="category-card__total">
                  {category.total > 0 ? formatMoney(category.total) : '—'}
                </div>
                <div className="category-card__count">
                  {category.count > 0
                    ? `${category.count} expense${category.count !== 1 ? 's' : ''}`
                    : 'No expenses'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Home Office BELOW categories (complete OR ignored) */}
      {showHomeOfficeBelow && (
        <>
          <div className="categories-page__divider" />
          {renderHomeOfficeSection()}
        </>
      )}

      {/* ============================================
         IGNORE CONFIRMATION MODAL
         ============================================ */}
      {showIgnoreConfirm && (
        <>
          <div className="sheet-backdrop sheet-backdrop--open" onClick={() => setShowIgnoreConfirm(false)} />
          <div className="delete-modal">
            <h3 className="delete-modal__title">Ignore Home Office Deduction?</h3>
            <div className="delete-modal__body">
              <p>
                This setting is for businesses that <strong>do not claim a home office deduction</strong> on their taxes.
              </p>
              <p>
                You can re-enable this at any time from the Home Office section at the bottom of the Categories page.
              </p>
            </div>
            <div className="delete-modal__actions">
              <button
                className="btn btn--secondary"
                onClick={() => setShowIgnoreConfirm(false)}
                disabled={ignoreSaving}
              >
                Cancel
              </button>
              <button
                className="btn btn--primary"
                onClick={handleIgnoreConfirm}
                disabled={ignoreSaving}
              >
                {ignoreSaving ? 'Saving...' : 'Yes, Ignore'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ============================================
         DELETE CONFIRMATION MODAL
         ============================================ */}
      {deletingCategory && (
        <>
          <div className="sheet-backdrop sheet-backdrop--open" onClick={() => setDeletingCategory(null)} />
          <div className="delete-modal">
            <h3 className="delete-modal__title">Delete "{deletingCategory.name}"?</h3>

            {deletingCategory.count > 0 ? (
              <div className="delete-modal__body">
                <p className="delete-modal__warning">
                  This category has <strong>{deletingCategory.count} expense{deletingCategory.count !== 1 ? 's' : ''}</strong> totaling{' '}
                  <strong>{formatMoney(deletingCategory.total)}</strong>.
                </p>
                <p>These expenses will be reassigned to:</p>
                <select
                  className="form-input form-select"
                  value={deleteReassignTo}
                  onChange={(e) => setDeleteReassignTo(e.target.value)}
                >
                  <option value="">📂 Uncategorized (default)</option>
                  {categories
                    .filter(c => c.id !== deletingCategory.id && !c.isSystem)
                    .map(c => (
                      <option key={c.id} value={c.id}>
                        {c.emoji} {c.name}
                      </option>
                    ))}
                </select>
              </div>
            ) : (
              <p className="delete-modal__body">
                This category has no expenses and will be removed.
              </p>
            )}

            <div className="delete-modal__actions">
              <button
                className="btn btn--secondary"
                onClick={() => setDeletingCategory(null)}
                disabled={deleteSubmitting}
              >
                Cancel
              </button>
              <button
                className="btn btn--danger"
                onClick={handleDeleteConfirm}
                disabled={deleteSubmitting}
              >
                {deleteSubmitting ? 'Deleting...' : 'Delete Category'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ============================================
         CATEGORY SHEET (Add/Edit)
         ============================================ */}
      <CategorySheet
        isOpen={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onSuccess={handleSheetSuccess}
        editCategory={editingCategory}
      />
    </div>
  )
}