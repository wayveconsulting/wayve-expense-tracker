import { useState, useEffect } from 'react'
import { useTenant } from '../hooks/useTenant'

// Get saved preference from localStorage
function getDefaultMode(): 'view' | 'edit' {
  if (typeof window === 'undefined') return 'view'
  return (localStorage.getItem('expenseDetailMode') as 'view' | 'edit') || 'view'
}

interface Category {
  id: string
  name: string
  emoji: string | null
  homeOfficeEligible?: boolean
}

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
}

interface ExpenseDetailSheetProps {
  expense: Expense | null
  isOpen: boolean
  onClose: () => void
  onUpdate: () => void
  onDelete: () => void
}

export function ExpenseDetailSheet({ expense, isOpen, onClose, onUpdate, onDelete }: ExpenseDetailSheetProps) {
  const { subdomain } = useTenant()
  
  // Mode: 'view' or 'edit' (persisted to localStorage)
  const [mode, setMode] = useState<'view' | 'edit'>(getDefaultMode)
  
  // Persist mode changes to localStorage
  const handleModeChange = (newMode: 'view' | 'edit') => {
    setMode(newMode)
    localStorage.setItem('expenseDetailMode', newMode)
  }
  
  // Edit form state
  const [amount, setAmount] = useState('')
  const [vendor, setVendor] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [expenseType, setExpenseType] = useState<'operating' | 'cogs' | 'home_office'>('operating')
  const [isHomeOffice, setIsHomeOffice] = useState(false)
  
  // UI state
  const [categories, setCategories] = useState<Category[]>([])
  const [loadingCategories, setLoadingCategories] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Derived: is the selected category home-office-eligible?
  const selectedCategory = categories.find(c => c.id === categoryId)
  const showHomeOfficeCheckbox = selectedCategory?.homeOfficeEligible === true

  // Reset home office checkbox when category changes to non-eligible
  useEffect(() => {
    if (!showHomeOfficeCheckbox) {
      setIsHomeOffice(false)
    }
  }, [showHomeOfficeCheckbox])

  // Populate form when expense changes or sheet opens
  useEffect(() => {
    if (expense && isOpen) {
      setAmount(String(expense.amount / 100))
      setVendor(expense.vendor || '')
      setDescription(expense.description || '')
      setDate(new Date(expense.date).toISOString().split('T')[0])
      setCategoryId(expense.categoryId || '')
      setExpenseType((expense.expenseType as 'operating' | 'cogs' | 'home_office') || 'operating')
      setIsHomeOffice(expense.isHomeOffice || false)
      setMode(getDefaultMode())
      setError(null)
      setShowDeleteConfirm(false)
    }
  }, [expense, isOpen])

  // Fetch categories when entering edit mode
  useEffect(() => {
    if (mode === 'edit' && categories.length === 0 && subdomain) {
      async function fetchCategories() {
        setLoadingCategories(true)
        try {
          const response = await fetch(`/api/categories?tenant=${subdomain}`)
          if (response.ok) {
            const data = await response.json()
            setCategories(data.categories)
          }
        } catch (err) {
          console.error('Error fetching categories:', err)
        } finally {
          setLoadingCategories(false)
        }
      }
      fetchCategories()
    }
  }, [mode, categories.length, subdomain])

  // Reset when sheet closes
  useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(() => {
        setMode('view')
        setError(null)
        setShowDeleteConfirm(false)
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  // Format cents to dollars for display
  const formatMoney = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(cents / 100)
  }

  // Format date for display
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
  }

  // Handle save
  async function handleSave() {
    if (!expense) return
    setError(null)

    const amountNum = parseFloat(amount)
    if (!amount || isNaN(amountNum) || amountNum <= 0) {
      setError('Please enter a valid amount')
      return
    }
    if (!date) {
      setError('Please select a date')
      return
    }
    if (!categoryId) {
      setError('Please select a category')
      return
    }

    try {
      setSubmitting(true)
      const amountCents = Math.round(amountNum * 100)

      const response = await fetch(`/api/expenses/${expense.id}?tenant=${subdomain}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amountCents,
          date: new Date(date).toISOString(),
          categoryId,
          vendor: vendor.trim() || null,
          description: description.trim() || null,
          expenseType,
          isHomeOffice,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.details?.join(', ') || data.error || 'Failed to update expense')
      }

      onUpdate()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  // Handle delete
  async function handleDelete() {
    if (!expense) return

    try {
      setDeleting(true)
      const response = await fetch(`/api/expenses/${expense.id}?tenant=${subdomain}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete expense')
      }

      onDelete()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setShowDeleteConfirm(false)
    } finally {
      setDeleting(false)
    }
  }

  // Handle backdrop click
  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  if (!expense) return null

  // Calculate deductible amount for display
  const deductibleAmount = (expense.isHomeOffice && expense.homeOfficePercent)
    ? Math.round(expense.amount * expense.homeOfficePercent / 100)
    : null

  return (
    <>
      {/* Backdrop */}
      <div 
        className={`sheet-backdrop ${isOpen ? 'sheet-backdrop--open' : ''}`}
        onClick={handleBackdropClick}
      />

      {/* Bottom Sheet */}
      <div className={`bottom-sheet ${isOpen ? 'bottom-sheet--open' : ''}`}>
        {/* Handle bar */}
        <div className="bottom-sheet__handle" onClick={onClose}>
          <div className="bottom-sheet__handle-bar" />
        </div>

        {/* Header */}
        <div className="bottom-sheet__header">
          <h2 className="bottom-sheet__title">
            {mode === 'view' ? 'Expense Details' : 'Edit Expense'}
          </h2>
          <div className="bottom-sheet__header-actions">
            {/* View/Edit Toggle */}
            <div className="mode-toggle">
              <button
                className={`mode-toggle__btn ${mode === 'view' ? 'mode-toggle__btn--active' : ''}`}
                onClick={() => handleModeChange('view')}
                aria-label="View mode"
                title="View mode"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
              <button
                className={`mode-toggle__btn ${mode === 'edit' ? 'mode-toggle__btn--active' : ''}`}
                onClick={() => handleModeChange('edit')}
                aria-label="Edit mode"
                title="Edit mode"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
            </div>
            <button 
              className="bottom-sheet__close"
              onClick={onClose}
              aria-label="Close"
            >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
          </div>
        </div>

        {/* Content */}
        <div className="bottom-sheet__form">
          {/* Error Message */}
          {error && (
            <div className="form-error">
              {error}
            </div>
          )}

          {/* Delete Confirmation */}
          {showDeleteConfirm && (
            <div className="delete-confirm">
              <p className="delete-confirm__message">
                Are you sure you want to delete this expense? This cannot be undone.
              </p>
              <div className="delete-confirm__actions">
                <button 
                  className="btn btn--secondary"
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={deleting}
                >
                  Cancel
                </button>
                <button 
                  className="btn btn--danger"
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  {deleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          )}

          {/* View Mode */}
          {mode === 'view' && !showDeleteConfirm && (
            <>
              {/* Amount - Hero Display */}
              <div className="detail-hero">
                <span className="detail-hero__emoji">{expense.categoryEmoji || '📁'}</span>
                <span className="detail-hero__amount">{formatMoney(expense.amount)}</span>
              </div>

              {/* Home Office Deduction Callout */}
              {expense.isHomeOffice && deductibleAmount !== null && (
                <div className="home-office-deduction-callout">
                  <span className="home-office-deduction-callout__icon">🏡</span>
                  <div className="home-office-deduction-callout__details">
                    <span className="home-office-deduction-callout__amount">
                      {formatMoney(deductibleAmount)} deductible
                    </span>
                    <span className="home-office-deduction-callout__rate">
                      {expense.homeOfficePercent}% home office rate
                    </span>
                  </div>
                </div>
              )}

              {/* Details List */}
              <div className="detail-list">
                <div className="detail-row">
                  <span className="detail-row__label">Date</span>
                  <span className="detail-row__value">{formatDate(expense.date)}</span>
                </div>
                
                <div className="detail-row">
                  <span className="detail-row__label">Category</span>
                  <span className="detail-row__value">
                    {expense.categoryEmoji} {expense.categoryName || 'Uncategorized'}
                  </span>
                </div>

                {expense.vendor && (
                  <div className="detail-row">
                    <span className="detail-row__label">Vendor</span>
                    <span className="detail-row__value">{expense.vendor}</span>
                  </div>
                )}

                {expense.description && (
                  <div className="detail-row">
                    <span className="detail-row__label">Description</span>
                    <span className="detail-row__value">{expense.description}</span>
                  </div>
                )}

                <div className="detail-row">
                  <span className="detail-row__label">Type</span>
                  <span className="detail-row__value detail-row__value--capitalize">
                    {expense.expenseType?.replace('_', ' ') || 'Operating'}
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="detail-actions">
                <button 
                  className="btn btn--secondary btn--full"
                  onClick={() => handleModeChange('edit')}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                  Edit Expense
                </button>
                <button 
                  className="btn btn--danger-outline btn--full"
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                  Delete Expense
                </button>
              </div>
            </>
          )}

          {/* Edit Mode */}
          {mode === 'edit' && !showDeleteConfirm && (
            <>
              {/* Amount */}
              <div className="form-group">
                <label htmlFor="edit-amount" className="form-label">Amount *</label>
                <div className="input-with-prefix">
                  <span className="input-prefix">$</span>
                  <input
                    type="number"
                    id="edit-amount"
                    className="form-input form-input--with-prefix"
                    placeholder="0.00"
                    step="0.01"
                    min="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                  />
                </div>
              </div>

              {/* Date */}
              <div className="form-group">
                <label htmlFor="edit-date" className="form-label">Date *</label>
                <input
                  type="date"
                  id="edit-date"
                  className="form-input"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </div>

              {/* Category */}
              <div className="form-group">
                <label htmlFor="edit-category" className="form-label">Category *</label>
                {loadingCategories ? (
                  <div className="form-input form-input--loading">Loading categories...</div>
                ) : (
                  <select
                    id="edit-category"
                    className="form-input form-select"
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    required
                  >
                    <option value="" disabled>Select a category</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.emoji} {cat.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Home Office Checkbox — only when category is eligible */}
              {showHomeOfficeCheckbox && (
                <div className="form-group">
                  <label className="home-office-checkbox">
                    <input
                      type="checkbox"
                      checked={isHomeOffice}
                      onChange={(e) => setIsHomeOffice(e.target.checked)}
                    />
                    <span className="home-office-checkbox__label">
                      🏡 Home Office Expense
                    </span>
                    <span className="home-office-checkbox__hint">
                      Deduction percentage will be applied to this expense
                    </span>
                  </label>
                </div>
              )}

              {/* Vendor */}
              <div className="form-group">
                <label htmlFor="edit-vendor" className="form-label">Vendor</label>
                <input
                  type="text"
                  id="edit-vendor"
                  className="form-input"
                  placeholder="e.g., Home Depot, Amazon"
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                />
              </div>

              {/* Description */}
              <div className="form-group">
                <label htmlFor="edit-description" className="form-label">Description</label>
                <input
                  type="text"
                  id="edit-description"
                  className="form-input"
                  placeholder="What was this for?"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              {/* Expense Type */}
              <div className="form-group">
                <label className="form-label">Expense Type</label>
                <div className="expense-type-group">
                  <label className={`expense-type-option ${expenseType === 'operating' ? 'expense-type-option--selected' : ''}`}>
                    <input
                      type="radio"
                      name="editExpenseType"
                      value="operating"
                      checked={expenseType === 'operating'}
                      onChange={() => setExpenseType('operating')}
                    />
                    <span>Operating</span>
                  </label>
                  <label className={`expense-type-option ${expenseType === 'cogs' ? 'expense-type-option--selected' : ''}`}>
                    <input
                      type="radio"
                      name="editExpenseType"
                      value="cogs"
                      checked={expenseType === 'cogs'}
                      onChange={() => setExpenseType('cogs')}
                    />
                    <span>COGS</span>
                  </label>
                  <label className={`expense-type-option ${expenseType === 'home_office' ? 'expense-type-option--selected' : ''}`}>
                    <input
                      type="radio"
                      name="editExpenseType"
                      value="home_office"
                      checked={expenseType === 'home_office'}
                      onChange={() => setExpenseType('home_office')}
                    />
                    <span>Home Office</span>
                  </label>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="edit-actions">
                <button 
                  className="btn btn--secondary"
                  onClick={() => handleModeChange('view')}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button 
                  className="btn btn--primary"
                  onClick={handleSave}
                  disabled={submitting || loadingCategories}
                >
                  {submitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>

              {/* Delete in Edit Mode */}
              <button 
                className="btn btn--danger-outline btn--full"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={submitting}
                style={{ marginTop: 'var(--spacing-md)' }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                Delete Expense
              </button>
            </>
          )}
        </div>
      </div>
    </>
  )
}