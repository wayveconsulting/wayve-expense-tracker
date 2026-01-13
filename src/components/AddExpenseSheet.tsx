import { useState, useEffect } from 'react'
import { useTenant } from '../hooks/useTenant'

interface Category {
  id: string
  name: string
  emoji: string | null
  sortOrder: number
}

interface AddExpenseSheetProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  preselectedCategoryId?: string | null
}

export function AddExpenseSheet({ isOpen, onClose, onSuccess, preselectedCategoryId }: AddExpenseSheetProps) {
  const { subdomain } = useTenant()
  
  // Form state
  const [amount, setAmount] = useState('')
  const [vendor, setVendor] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0])
  const [categoryId, setCategoryId] = useState('')
  const [expenseType, setExpenseType] = useState<'operating' | 'cogs' | 'home_office'>('operating')
  
  // UI state
  const [categories, setCategories] = useState<Category[]>([])
  const [loadingCategories, setLoadingCategories] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch categories when sheet opens
  useEffect(() => {
    if (!isOpen || !subdomain) return

    async function fetchCategories() {
      try {
        setLoadingCategories(true)
        const response = await fetch(`/api/categories?tenant=${subdomain}`)
        if (!response.ok) {
          throw new Error('Failed to load categories')
        }
        const data = await response.json()
        setCategories(data.categories)
        
        // Set preselected category if provided, otherwise default to first
        if (preselectedCategoryId) {
          setCategoryId(preselectedCategoryId)
        } else if (data.categories.length > 0 && !categoryId) {
          setCategoryId(data.categories[0].id)
        }
      } catch (err) {
        console.error('Error fetching categories:', err)
      } finally {
        setLoadingCategories(false)
      }
    }

    fetchCategories()
  }, [isOpen, subdomain])

  // Reset form when sheet closes
  useEffect(() => {
    if (!isOpen) {
      // Small delay to let animation finish before resetting
      const timer = setTimeout(() => {
        setAmount('')
        setVendor('')
        setDescription('')
        setDate(new Date().toISOString().split('T')[0])
        setCategoryId(preselectedCategoryId || '')
        setExpenseType('operating')
        setError(null)
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [isOpen, preselectedCategoryId])

  // Handle form submission
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    // Client-side validation
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

      // Convert dollars to cents
      const amountCents = Math.round(amountNum * 100)

      const response = await fetch(`/api/expenses?tenant=${subdomain}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: amountCents,
          date: new Date(date).toISOString(),
          categoryId,
          vendor: vendor.trim() || null,
          description: description.trim() || null,
          expenseType,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.details?.join(', ') || data.error || 'Failed to create expense')
      }

      // Success! Close sheet and trigger refresh
      onSuccess()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  // Handle backdrop click
  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

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
          <h2 className="bottom-sheet__title">Add Expense</h2>
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

        {/* Form */}
        <form className="bottom-sheet__form" onSubmit={handleSubmit}>
          {/* Error Message */}
          {error && (
            <div className="form-error">
              {error}
            </div>
          )}

          {/* Amount */}
          <div className="form-group">
            <label htmlFor="amount" className="form-label">Amount *</label>
            <div className="input-with-prefix">
              <span className="input-prefix">$</span>
              <input
                type="number"
                id="amount"
                className="form-input form-input--with-prefix"
                placeholder="0.00"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                autoFocus
              />
            </div>
          </div>

          {/* Date */}
          <div className="form-group">
            <label htmlFor="date" className="form-label">Date *</label>
            <input
              type="date"
              id="date"
              className="form-input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>

          {/* Category */}
          <div className="form-group">
            <label htmlFor="category" className="form-label">Category *</label>
            {loadingCategories ? (
              <div className="form-input form-input--loading">Loading categories...</div>
            ) : (
              <select
                id="category"
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

          {/* Vendor */}
          <div className="form-group">
            <label htmlFor="vendor" className="form-label">Vendor</label>
            <input
              type="text"
              id="vendor"
              className="form-input"
              placeholder="e.g., Home Depot, Amazon"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
            />
          </div>

          {/* Description */}
          <div className="form-group">
            <label htmlFor="description" className="form-label">Description</label>
            <input
              type="text"
              id="description"
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
                  name="expenseType"
                  value="operating"
                  checked={expenseType === 'operating'}
                  onChange={() => setExpenseType('operating')}
                />
                <span>Operating</span>
              </label>
              <label className={`expense-type-option ${expenseType === 'cogs' ? 'expense-type-option--selected' : ''}`}>
                <input
                  type="radio"
                  name="expenseType"
                  value="cogs"
                  checked={expenseType === 'cogs'}
                  onChange={() => setExpenseType('cogs')}
                />
                <span>COGS</span>
              </label>
              <label className={`expense-type-option ${expenseType === 'home_office' ? 'expense-type-option--selected' : ''}`}>
                <input
                  type="radio"
                  name="expenseType"
                  value="home_office"
                  checked={expenseType === 'home_office'}
                  onChange={() => setExpenseType('home_office')}
                />
                <span>Home Office</span>
              </label>
            </div>
          </div>

          {/* Submit Button */}
          <button 
            type="submit" 
            className="btn btn--primary btn--full"
            disabled={submitting || loadingCategories}
          >
            {submitting ? 'Saving...' : 'Save Expense'}
          </button>
        </form>
      </div>
    </>
  )
}
