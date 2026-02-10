import { useState, useEffect } from 'react'
import { useTenant } from '../hooks/useTenant'

// ============================================
// CURATED EMOJI LIST
// Business-relevant + a few fun surprises
// ============================================
const EMOJI_OPTIONS = [
  // Business essentials
  '📦', '🛒', '🏪', '💼', '📋', '🧾', '💳', '🏦',
  // Office & supplies
  '🖨️', '📎', '✏️', '📁', '🗂️', '💻', '📱', '🖥️',
  // Home & utilities
  '🏠', '⚡', '💧', '🌐', '📡', '🔧', '🛠️', '🏗️',
  // Transport & travel
  '🚗', '⛽', '✈️', '🅿️', '🚕', '🛫', '🏨', '🧳',
  // Food & entertainment
  '🍽️', '☕', '🍕', '🎬', '🎯', '🎪', '🍩', '🧁',
  // People & services
  '👔', '🧑‍💼', '🤝', '📞', '📧', '🎓', '⚖️', '🏥',
  // Marketing & creative
  '📣', '🎨', '📸', '🖼️', '✨', '🎁', '🏷️', '📰',
  // Wildcards (the fun ones you asked for)
  '🦄', '🚀', '🔥', '💎', '🌮', '🐕', '🎸', '🤖',
]

interface CategorySheetProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  editCategory?: {
    id: string
    name: string
    emoji: string | null
    expenseType: string
    homeOfficeEligible: boolean
    isSystem: boolean
  } | null
}

export function CategorySheet({ isOpen, onClose, onSuccess, editCategory }: CategorySheetProps) {
  const { subdomain } = useTenant()
  const isEditing = !!editCategory

  // Form state
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('📁')
  const [expenseType, setExpenseType] = useState<'operating' | 'cogs'>('operating')
  const [homeOfficeEligible, setHomeOfficeEligible] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)

  // UI state
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Populate form when editing
  useEffect(() => {
    if (isOpen && editCategory) {
      setName(editCategory.name)
      setEmoji(editCategory.emoji || '📁')
      // Normalize any legacy 'home_office' type to 'operating'
      const type = editCategory.expenseType === 'home_office' ? 'operating' : editCategory.expenseType
      setExpenseType(type as 'operating' | 'cogs')
      setHomeOfficeEligible(editCategory.homeOfficeEligible)
      setShowEmojiPicker(false)
      setError(null)
    }
  }, [isOpen, editCategory])

  // Reset form when sheet closes (only for add mode)
  useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(() => {
        if (!editCategory) {
          setName('')
          setEmoji('📁')
          setExpenseType('operating')
          setHomeOfficeEligible(false)
        }
        setShowEmojiPicker(false)
        setError(null)
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [isOpen, editCategory])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!name.trim()) {
      setError('Please enter a category name')
      return
    }

    try {
      setSubmitting(true)

      const payload = {
        name: name.trim(),
        emoji,
        expenseType,
        homeOfficeEligible,
      }

      const url = isEditing
        ? `/api/categories/${editCategory!.id}?tenant=${subdomain}`
        : `/api/categories?tenant=${subdomain}`

      const response = await fetch(url, {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.details?.join(', ') || data.error || 'Failed to save category')
      }

      onSuccess()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

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
          <h2 className="bottom-sheet__title">
            {isEditing ? 'Edit Category' : 'Add Category'}
          </h2>
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
          {error && <div className="form-error">{error}</div>}

          {/* Emoji + Name row */}
          <div className="form-group">
            <label className="form-label">Category</label>
            <div className="category-form__name-row">
              <button
                type="button"
                className="category-form__emoji-btn"
                onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                aria-label="Pick emoji"
              >
                {emoji}
              </button>
              <input
                type="text"
                className="form-input"
                placeholder="Category name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                required
                autoFocus={isOpen && !isEditing}
              />
            </div>
          </div>

          {/* Emoji Picker */}
          {showEmojiPicker && (
            <div className="category-form__emoji-picker">
              {EMOJI_OPTIONS.map((e) => (
                <button
                  key={e}
                  type="button"
                  className={`category-form__emoji-option ${emoji === e ? 'category-form__emoji-option--selected' : ''}`}
                  onClick={() => {
                    setEmoji(e)
                    setShowEmojiPicker(false)
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
          )}

          {/* Expense Type */}
          <div className="form-group">
            <label className="form-label">Default Expense Type</label>
            {isEditing && (
              <p className="form-hint" style={{ marginBottom: 'var(--spacing-sm)' }}>
                Changing this will not update existing expenses. It only sets the default for new expenses in this category.
              </p>
            )}
            <div className="expense-type-group">
              <label className={`expense-type-option ${expenseType === 'operating' ? 'expense-type-option--selected' : ''}`}>
                <input
                  type="radio"
                  name="catExpenseType"
                  value="operating"
                  checked={expenseType === 'operating'}
                  onChange={() => setExpenseType('operating')}
                />
                <span>Operating</span>
              </label>
              <label className={`expense-type-option ${expenseType === 'cogs' ? 'expense-type-option--selected' : ''}`}>
                <input
                  type="radio"
                  name="catExpenseType"
                  value="cogs"
                  checked={expenseType === 'cogs'}
                  onChange={() => setExpenseType('cogs')}
                />
                <span>COGS</span>
              </label>
            </div>
          </div>

          {/* Home Office Eligible toggle — always visible */}
          <div className="form-group form-group--horizontal">
            <div>
              <label className="form-label">Home Office Deduction Eligible</label>
              <span className="form-hint">
                Enable this for expenses that may apply to your home office
                (e.g., utilities, rent, insurance). When adding an expense in this
                category, you'll see a checkbox to mark it as a home office expense.
                Only checked expenses will have the sq ft deduction percentage applied.
              </span>
            </div>
            <button
              type="button"
              className={`toggle ${homeOfficeEligible ? 'toggle--on' : ''}`}
              onClick={() => setHomeOfficeEligible(!homeOfficeEligible)}
              role="switch"
              aria-checked={homeOfficeEligible}
            >
              <span className="toggle__slider" />
            </button>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            className="btn btn--primary btn--full"
            disabled={submitting}
          >
            {submitting ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Category'}
          </button>
        </form>
      </div>
    </>
  )
}
