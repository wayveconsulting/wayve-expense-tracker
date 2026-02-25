import { useState, useEffect } from 'react'
import { useTenant } from '../hooks/useTenant'
import { useScanReceipt, type ScanResult } from '../hooks/useScanReceipt'
import {
  uploadToBlob,
  linkAttachmentToExpense,
  validateFile,
  formatFileSize,
  ALLOWED_FILE_ACCEPT,
} from '../utils/attachment-upload'

// Get saved preference from localStorage
function getDefaultMode(): 'view' | 'edit' {
  if (typeof window === 'undefined') return 'view'
  return (localStorage.getItem('expenseDetailMode') as 'view' | 'edit') || 'view'
}

interface Category {
  id: string
  name: string
  emoji: string | null
  expenseType?: string
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

interface Attachment {
  id: string
  blobUrl: string
  fileName: string
  fileSize: number
  mimeType: string
  createdAt: string
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
  const { scanResult, isScanning, scanError, scanReceipt, clearScan } = useScanReceipt()

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
  const [expenseType, setExpenseType] = useState<'operating' | 'cogs'>('operating')
  const [isHomeOffice, setIsHomeOffice] = useState(false)
  const [extractedText, setExtractedText] = useState<string | null>(null)

  // UI state
  const [categories, setCategories] = useState<Category[]>([])
  const [loadingCategories, setLoadingCategories] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Attachment state
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [loadingAttachments, setLoadingAttachments] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  // Derived: is the selected category home-office-eligible?
  const selectedCategory = categories.find(c => c.id === categoryId)
  const showHomeOfficeCheckbox = selectedCategory?.homeOfficeEligible === true

  // Sync expense type and home office when category changes in edit mode
  // BUT only after categories have loaded — otherwise we'd wipe the saved value
  useEffect(() => {
    if (categories.length > 0) {
      if (selectedCategory) {
        const catType = selectedCategory.expenseType === 'home_office' ? 'operating' : selectedCategory.expenseType
        setExpenseType((catType as 'operating' | 'cogs') || 'operating')
      }
      if (!showHomeOfficeCheckbox) {
        setIsHomeOffice(false)
      }
    }
  }, [categoryId, showHomeOfficeCheckbox, categories.length])

  // Populate form when expense changes or sheet opens
  useEffect(() => {
    if (expense && isOpen) {
      setAmount(String(expense.amount / 100))
      setVendor(expense.vendor || '')
      setDescription(expense.description || '')
      setDate(expense.date.substring(0, 10))
      setCategoryId(expense.categoryId || '')
      const type = expense.expenseType === 'home_office' ? 'operating' : expense.expenseType
      setExpenseType((type as 'operating' | 'cogs') || 'operating')
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
            setCategories([...data.categories].sort((a: Category, b: Category) => a.name.localeCompare(b.name)))
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

  // Fetch attachments when sheet opens
  useEffect(() => {
    if (isOpen && expense && subdomain) {
      async function fetchAttachments() {
        setLoadingAttachments(true)
        try {
          const response = await fetch(`/api/attachments?expenseId=${expense!.id}&tenant=${subdomain}`)
          if (response.ok) {
            const data = await response.json()
            setAttachments(data.attachments)
          }
        } catch (err) {
          console.error('Error fetching attachments:', err)
        } finally {
          setLoadingAttachments(false)
        }
      }
      fetchAttachments()
    }
  }, [isOpen, expense, subdomain])

  // Reset when sheet closes
  useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(() => {
        setMode('view')
        setError(null)
        setShowDeleteConfirm(false)
        setAttachments([])
        setLightboxUrl(null)
        setUploadStatus(null)
        setExtractedText(null)
        clearScan()
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  // Handle file upload — client-side upload directly to Vercel Blob
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !expense) return

    // Reset the input so the same file can be re-selected
    e.target.value = ''

    const validationError = validateFile(file)
    if (validationError) {
      setError(validationError)
      return
    }

    try {
      setUploading(true)
      setUploadStatus(null)
      setError(null)

      // Upload to Vercel Blob (compresses if needed)
      const blobPathPrefix = `${subdomain}/${expense.id}`
      const pending = await uploadToBlob(file, subdomain!, blobPathPrefix, (progress) => {
        setUploadStatus(progress.message || null)
      })

      // Record the attachment in our database
      await linkAttachmentToExpense(pending, expense.id, subdomain!)

      // Refresh attachments list
      const response = await fetch(`/api/attachments?expenseId=${expense.id}&tenant=${subdomain}`)
      if (response.ok) {
        const data = await response.json()
        setAttachments(data.attachments)
      }
      setUploadStatus(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
      setUploadStatus(null)
    } finally {
      setUploading(false)
    }
  }

  // Handle attachment delete
  async function handleDeleteAttachment(attachmentId: string) {
    try {
      const response = await fetch(`/api/attachments/${attachmentId}?tenant=${subdomain}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete attachment')
      }

      setAttachments(prev => prev.filter(a => a.id !== attachmentId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete attachment')
    }
  }

  // Format cents to dollars for display
  const formatMoney = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(cents / 100)
  }

  // Format date for display
  // Parse YYYY-MM-DD directly to avoid timezone shift —
  // new Date("2026-01-03") parses as UTC midnight, which shifts backward in US timezones
  const formatDate = (dateStr: string) => {
    const [year, month, day] = dateStr.substring(0, 10).split('-').map(Number)
    return new Date(year, month - 1, day).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
  }

  // Handle scan result — auto-fill empty fields
  function applyScanResult(result: ScanResult) {
    setExtractedText(result.rawText || null)
    if (!amount && result.total?.value != null) {
      setAmount(Number(result.total.value).toFixed(2))
    }
    if (!vendor && result.vendor?.value) {
      setVendor(String(result.vendor.value))
    }
    if (result.date?.value) {
      const parsed = result.date.value as string
      if (/^\d{4}-\d{2}-\d{2}$/.test(parsed)) {
        setDate(parsed)
      }
    }
  }

  async function handleScanAttachment(blobUrl: string) {
    if (!subdomain) return
    const result = await scanReceipt(blobUrl, subdomain)
    if (result) {
      applyScanResult(result)
    }
  }

  // Confidence indicator helper
  function confidenceDot(confidence: number | undefined) {
    if (confidence === undefined) return null
    if (confidence >= 0.8) return <span className="scan-confidence scan-confidence--high" title="High confidence" />
    if (confidence >= 0.5) return <span className="scan-confidence scan-confidence--medium" title="Review this" />
    return <span className="scan-confidence scan-confidence--low" title="Low confidence" />
  }

  function wasScanned(fieldName: 'total' | 'vendor' | 'date'): number | undefined {
    if (!scanResult) return undefined
    const field = scanResult[fieldName]
    if (field?.value != null) return field.confidence
    return undefined
  }

  function scanSuggestion(fieldName: 'total' | 'vendor' | 'date', applyFn: () => void) {
    if (!scanResult) return null
    const field = scanResult[fieldName]
    if (field?.value == null) return null
    let currentVal: string
    let scannedVal: string
    if (fieldName === 'total') { currentVal = amount; scannedVal = String(field.value) }
    else if (fieldName === 'vendor') { currentVal = vendor; scannedVal = String(field.value) }
    else { currentVal = date; scannedVal = String(field.value) }
    if (currentVal === scannedVal) return null
    if (!currentVal) return null
    return (
      <button type="button" className="scan-suggestion" onClick={applyFn}>
        Use: {fieldName === 'total' ? `$${field.value}` : String(field.value)}
      </button>
    )
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
          date: date + 'T12:00:00.000Z',
          categoryId,
          vendor: vendor.trim() || null,
          description: description.trim() || null,
          expenseType,
          isHomeOffice,
          extractedText,
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
                <span className="detail-hero__amount">
                  {formatMoney(
                    expense.isHomeOffice && expense.homeOfficePercent
                      ? Math.round(expense.amount * expense.homeOfficePercent / 100)
                      : expense.amount
                  )}
                </span>
                {expense.isHomeOffice && expense.homeOfficePercent && (
                  <span className="detail-hero__ho-context">
                    {expense.homeOfficePercent}% of total spent ({formatMoney(expense.amount)})
                  </span>
                )}
              </div>

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

              {/* Attachments Section */}
              <div className="attachments-section">
                <div className="attachments-section__header">
                  <span className="form-label">Attachments</span>
                  <label className="btn btn--small btn--secondary attachments-upload-btn">
                    <input
                      type="file"
                      accept={ALLOWED_FILE_ACCEPT}
                      onChange={handleFileUpload}
                      style={{ display: 'none' }}
                      disabled={uploading}
                    />
                    {uploading ? 'Uploading...' : '📎 Attach'}
                  </label>
                </div>

                {/* Upload status message (compression feedback) */}
                {uploadStatus && (
                  <div className="attachments-status">{uploadStatus}</div>
                )}

                {loadingAttachments && (
                  <div className="attachments-loading">Loading attachments...</div>
                )}

                {!loadingAttachments && attachments.length === 0 && (
                  <div className="attachments-empty">No attachments yet</div>
                )}

                {attachments.length > 0 && (
                  <div className="attachments-list">
                    {attachments.map(att => (
                      <div key={att.id} className="attachment-item">
                        {att.mimeType.startsWith('image/') ? (
                          <img
                            src={att.blobUrl}
                            alt={att.fileName}
                            className="attachment-item__thumbnail"
                            onClick={() => setLightboxUrl(att.blobUrl)}
                          />
                        ) : (
                          <div
                            className="attachment-item__thumbnail attachment-item__thumbnail--pdf"
                            onClick={() => window.open(att.blobUrl, '_blank')}
                          >
                            PDF
                          </div>
                        )}
                        <div className="attachment-item__info">
                          <span className="attachment-item__name">{att.fileName}</span>
                          <span className="attachment-item__size">{formatFileSize(att.fileSize)}</span>
                        </div>
                        <button
                          className="attachment-item__delete"
                          onClick={() => handleDeleteAttachment(att.id)}
                          aria-label="Delete attachment"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 6 6 18M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
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
                <label htmlFor="edit-amount" className="form-label">
                  Amount * {confidenceDot(wasScanned('total'))}
                </label>
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
                {scanSuggestion('total', () => setAmount(String(scanResult!.total.value)))}
              </div>

              {/* Date */}
              <div className="form-group">
                <label htmlFor="edit-date" className="form-label">
                  Date * {confidenceDot(wasScanned('date'))}
                </label>
                <input
                  type="date"
                  id="edit-date"
                  className="form-input"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
                {scanSuggestion('date', () => {
                  const val = String(scanResult!.date.value)
                  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) setDate(val)
                })}
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
                <label htmlFor="edit-vendor" className="form-label">
                  Vendor {confidenceDot(wasScanned('vendor'))}
                </label>
                <input
                  type="text"
                  id="edit-vendor"
                  className="form-input"
                  placeholder="e.g., Home Depot, Amazon"
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                />
                {scanSuggestion('vendor', () => setVendor(String(scanResult!.vendor.value)))}
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
                </div>
              </div>

              {/* Attachments Section */}
              <div className="attachments-section">
                <div className="attachments-section__header">
                  <span className="form-label">Attachments</span>
                  <label className="btn btn--small btn--secondary attachments-upload-btn">
                    <input
                      type="file"
                      accept={ALLOWED_FILE_ACCEPT}
                      onChange={handleFileUpload}
                      style={{ display: 'none' }}
                      disabled={uploading}
                    />
                    {uploading ? 'Uploading...' : '📎 Attach'}
                  </label>
                </div>

                {/* Upload status message (compression feedback) */}
                {uploadStatus && (
                  <div className="attachments-status">{uploadStatus}</div>
                )}

                {/* Scan error */}
                {scanError && (
                  <div className="scan-error">{scanError}</div>
                )}

                {loadingAttachments && (
                  <div className="attachments-loading">Loading attachments...</div>
                )}

                {!loadingAttachments && attachments.length === 0 && (
                  <div className="attachments-empty">No attachments yet</div>
                )}

                {attachments.length > 0 && (
                  <div className="attachments-list">
                    {attachments.map(att => (
                      <div key={att.id} className="attachment-item">
                        <div className="attachment-item__thumb-wrapper">
                          {att.mimeType.startsWith('image/') ? (
                            <img
                              src={att.blobUrl}
                              alt={att.fileName}
                              className="attachment-item__thumbnail"
                              onClick={() => setLightboxUrl(att.blobUrl)}
                            />
                          ) : (
                            <div
                              className="attachment-item__thumbnail attachment-item__thumbnail--pdf"
                              onClick={() => window.open(att.blobUrl, '_blank')}
                            >
                              PDF
                            </div>
                          )}
                          {/* Scan button — images and PDFs */}
                          {(att.mimeType.startsWith('image/') || att.mimeType === 'application/pdf') && (
                            <button
                              type="button"
                              className={`scan-button ${isScanning ? 'scan-button--scanning' : ''}`}
                              onClick={() => handleScanAttachment(att.blobUrl)}
                              disabled={isScanning}
                              aria-label="Scan receipt"
                            >
                              {isScanning ? '...' : '🔍'}
                            </button>
                          )}
                        </div>
                        <div className="attachment-item__info">
                          <span className="attachment-item__name">{att.fileName}</span>
                          <span className="attachment-item__size">{formatFileSize(att.fileSize)}</span>
                        </div>
                        <button
                          className="attachment-item__delete"
                          onClick={() => handleDeleteAttachment(att.id)}
                          aria-label="Delete attachment"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 6 6 18M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
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
                  disabled={submitting || loadingCategories || isScanning}
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

      {/* Lightbox Overlay */}
      {lightboxUrl && (
        <div 
          className="lightbox-overlay"
          onClick={() => setLightboxUrl(null)}
        >
          <button 
            className="lightbox-close"
            onClick={() => setLightboxUrl(null)}
            aria-label="Close image"
          >
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
          <img
            src={lightboxUrl}
            alt="Attachment"
            className="lightbox-image"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  )
}