import { useState, useEffect } from 'react'
import { useTenant } from '../hooks/useTenant'
import {
  type PendingAttachment,
  type UploadProgress,
  uploadToBlob,
  linkAttachmentToExpense,
  validateFile,
  formatFileSize,
  ALLOWED_FILE_ACCEPT,
} from '../utils/attachment-upload'

const MAX_ATTACHMENTS = 2

interface Category {
  id: string
  name: string
  emoji: string | null
  sortOrder: number
  expenseType?: string
  homeOfficeEligible?: boolean
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
  const [expenseType, setExpenseType] = useState<'operating' | 'cogs'>('operating')
  const [isHomeOffice, setIsHomeOffice] = useState(false)

  // UI state
  const [categories, setCategories] = useState<Category[]>([])
  const [loadingCategories, setLoadingCategories] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Attachment state
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([])
  const [uploadProgress, setUploadProgress] = useState<UploadProgress>({ status: 'idle' })

  // Derived: selected category properties
  const selectedCategory = categories.find(c => c.id === categoryId)
  const showHomeOfficeCheckbox = selectedCategory?.homeOfficeEligible === true

  // Sync expense type and home office checkbox when category changes
  useEffect(() => {
    if (selectedCategory) {
      const catType = selectedCategory.expenseType === 'home_office' ? 'operating' : selectedCategory.expenseType
      setExpenseType((catType as 'operating' | 'cogs') || 'operating')
    }
    if (!showHomeOfficeCheckbox) {
      setIsHomeOffice(false)
    }
  }, [categoryId, showHomeOfficeCheckbox])

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

  // Reset form when sheet closes (including pending attachments)
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
        setIsHomeOffice(false)
        setError(null)
        setPendingAttachments([])
        setUploadProgress({ status: 'idle' })
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [isOpen, preselectedCategoryId])

  // Handle file selection — uploads to Vercel Blob immediately
  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    // Reset the input so the same file can be re-selected
    e.target.value = ''

    if (pendingAttachments.length >= MAX_ATTACHMENTS) {
      setError(`Maximum ${MAX_ATTACHMENTS} attachments allowed`)
      return
    }

    const validationError = validateFile(file)
    if (validationError) {
      setError(validationError)
      return
    }

    try {
      setError(null)
      setUploadProgress({ status: 'uploading', message: 'Uploading...' })

      // Upload to Vercel Blob (compresses if needed)
      // Use a generic prefix since we don't have an expense ID yet
      const blobPathPrefix = `${subdomain}/pending`
      const pending = await uploadToBlob(file, subdomain!, blobPathPrefix, (progress) => {
        setUploadProgress(progress)
      })

      setPendingAttachments(prev => [...prev, pending])
      setUploadProgress({ status: 'idle' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
      setUploadProgress({ status: 'error', message: 'Upload failed' })
    }
  }

  // Remove a pending attachment
  function handleRemoveAttachment(index: number) {
    setPendingAttachments(prev => prev.filter((_, i) => i !== index))
  }

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

      // Step 1: Create the expense
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
          isHomeOffice,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.details?.join(', ') || data.error || 'Failed to create expense')
      }

      const { expense } = await response.json()

      // Step 2: Link pending attachments to the new expense
      if (pendingAttachments.length > 0) {
        const linkErrors: string[] = []
        for (const attachment of pendingAttachments) {
          try {
            await linkAttachmentToExpense(attachment, expense.id, subdomain!)
          } catch (err) {
            linkErrors.push(err instanceof Error ? err.message : 'Failed to link attachment')
          }
        }

        if (linkErrors.length > 0) {
          // Expense saved but some attachments failed to link — still close
          console.error('Attachment linking errors:', linkErrors)
        }
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

  const isUploading = uploadProgress.status === 'compressing' || uploadProgress.status === 'uploading'

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
                autoFocus={isOpen}
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
            </div>
          </div>

          {/* Attachment Section */}
          <div className="add-expense-attachments">
            <div className="add-expense-attachments__header">
              <span className="form-label">Receipts</span>
              {pendingAttachments.length > 0 && (
                <span className="add-expense-attachments__limit">
                  {pendingAttachments.length} of {MAX_ATTACHMENTS}
                </span>
              )}
            </div>

            {/* Upload progress */}
            {uploadProgress.message && (
              <div className="attachments-status">{uploadProgress.message}</div>
            )}

            {/* Thumbnail previews */}
            {pendingAttachments.length > 0 && (
              <div className="add-expense-attachments__preview">
                {pendingAttachments.map((att, index) => (
                  <div key={att.blobUrl} className="add-expense-attachments__thumb-wrapper">
                    {att.fileType.startsWith('image/') ? (
                      <img
                        src={att.blobUrl}
                        alt={att.fileName}
                        className="add-expense-attachments__thumb"
                      />
                    ) : (
                      <div className="add-expense-attachments__thumb add-expense-attachments__thumb--pdf">
                        PDF
                      </div>
                    )}
                    <button
                      type="button"
                      className="add-expense-attachments__remove"
                      onClick={() => handleRemoveAttachment(index)}
                      aria-label="Remove attachment"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M18 6 6 18M6 6l12 12" />
                      </svg>
                    </button>
                    <span className="add-expense-attachments__file-size">{formatFileSize(att.fileSize)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* File picker — hidden when max reached or uploading */}
            {pendingAttachments.length < MAX_ATTACHMENTS && (
              <label className={`add-expense-attachments__picker ${isUploading ? 'add-expense-attachments__picker--disabled' : ''}`}>
                <input
                  type="file"
                  accept={ALLOWED_FILE_ACCEPT}
                  onChange={handleFileSelect}
                  style={{ display: 'none' }}
                  disabled={isUploading}
                />
                {isUploading ? 'Uploading...' : '📎 Attach Receipt'}
              </label>
            )}
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            className="btn btn--primary btn--full"
            disabled={submitting || loadingCategories || isUploading}
          >
            {submitting ? 'Saving...' : 'Save Expense'}
          </button>
        </form>
      </div>
    </>
  )
}
