import { useState, useEffect } from 'react'
import { useTenant } from '../hooks/useTenant'
import { useScanReceipt, type ScanResult } from '../hooks/useScanReceipt'
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
  preselectedCategoryName?: string | null
}

export function AddExpenseSheet({ isOpen, onClose, onSuccess, preselectedCategoryId, preselectedCategoryName }: AddExpenseSheetProps) {
  const { subdomain } = useTenant()
  const { scanResult, isScanning, scanError, scanReceipt, clearScan } = useScanReceipt()

  // Form state
  const [amount, setAmount] = useState('')
  const [vendor, setVendor] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  })
  const [categoryId, setCategoryId] = useState('')
  const [expenseType, setExpenseType] = useState<'operating' | 'cogs'>('operating')
  const [isHomeOffice, setIsHomeOffice] = useState(false)
  const [extractedText, setExtractedText] = useState<string | null>(null)

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
        setCategories([...data.categories].sort((a: Category, b: Category) => a.name.localeCompare(b.name)))

        // Priority: URL preselect > name preselect > tenant default > blank
        if (preselectedCategoryId) {
          setCategoryId(preselectedCategoryId)
        } else if (preselectedCategoryName) {
          const match = data.categories.find((c: Category) => c.name === preselectedCategoryName)
          if (match) setCategoryId(match.id)
        } else if (data.homeOfficeSettings?.defaultCategoryId) {
          setCategoryId(data.homeOfficeSettings.defaultCategoryId)
        } else {
          setCategoryId('')
        }
      } catch (err) {
        console.error('Error fetching categories:', err)
      } finally {
        setLoadingCategories(false)
      }
    }

    fetchCategories()
  }, [isOpen, subdomain])

  // Reset form when sheet closes (including pending attachments and scan state)
  useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(() => {
        setAmount('')
        setVendor('')
        setDescription('')
        const now = new Date()
        setDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`)
        setCategoryId('')
        setExpenseType('operating')
        setIsHomeOffice(false)
        setExtractedText(null)
        setError(null)
        setPendingAttachments([])
        setUploadProgress({ status: 'idle' })
        clearScan()
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [isOpen, preselectedCategoryId])

  // Handle scan result — auto-fill empty fields, show suggestions for filled ones
  function applyScanResult(result: ScanResult) {
    setExtractedText(result.rawText || null)

    // Auto-fill empty fields
    if (!amount && result.total?.value != null) {
      setAmount(String(result.total.value))
    }
    if (!vendor && result.vendor?.value) {
      setVendor(String(result.vendor.value))
    }
    if (!date.trim() || date === new Date().toISOString().split('T')[0]) {
      // Only auto-fill date if it's still the default (today)
      if (result.date?.value) {
        const parsed = result.date.value as string
        if (/^\d{4}-\d{2}-\d{2}$/.test(parsed)) {
          setDate(parsed)
        }
      }
    }
  }

  // Handle scan button click
  async function handleScan(blobUrl: string) {
    if (!subdomain) return
    const result = await scanReceipt(blobUrl, subdomain)
    if (result) {
      applyScanResult(result)
    }
  }

  // Handle file selection — uploads to Vercel Blob immediately
  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

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

      const response = await fetch(`/api/expenses?tenant=${subdomain}`, {
        method: 'POST',
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
        throw new Error(data.details?.join(', ') || data.error || 'Failed to create expense')
      }

      const { expense } = await response.json()

      // Link pending attachments to the new expense
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
          console.error('Attachment linking errors:', linkErrors)
        }
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

  const isUploading = uploadProgress.status === 'compressing' || uploadProgress.status === 'uploading'

  // Confidence indicator helper
  function confidenceDot(confidence: number | undefined) {
    if (confidence === undefined) return null
    if (confidence >= 0.8) return <span className="scan-confidence scan-confidence--high" title="High confidence" />
    if (confidence >= 0.5) return <span className="scan-confidence scan-confidence--medium" title="Review this" />
    return <span className="scan-confidence scan-confidence--low" title="Low confidence" />
  }

  // Check if a field was populated by scan
  function wasScanned(fieldName: 'total' | 'vendor' | 'date'): number | undefined {
    if (!scanResult) return undefined
    const field = scanResult[fieldName]
    if (field?.value != null) return field.confidence
    return undefined
  }

  // Suggestion helper: show scan suggestion when field already had data
  function scanSuggestion(fieldName: 'total' | 'vendor' | 'date', applyFn: () => void) {
    if (!scanResult) return null
    const field = scanResult[fieldName]
    if (field?.value == null) return null

    // Only show suggestion if the field currently has different data than the scan
    let currentVal: string
    let scannedVal: string
    if (fieldName === 'total') {
      currentVal = amount
      scannedVal = String(field.value)
    } else if (fieldName === 'vendor') {
      currentVal = vendor
      scannedVal = String(field.value)
    } else {
      currentVal = date
      scannedVal = String(field.value)
    }

    if (currentVal === scannedVal) return null
    if (!currentVal) return null // Already auto-filled

    return (
      <button type="button" className="scan-suggestion" onClick={applyFn}>
        Use: {fieldName === 'total' ? `$${field.value}` : String(field.value)}
      </button>
    )
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
            <div className="form-error">{error}</div>
          )}

          {/* Attachment Section — moved to top so scan can fill fields below */}
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

            {/* Scan error */}
            {scanError && (
              <div className="scan-error">{scanError}</div>
            )}

            {/* Thumbnail previews */}
            {pendingAttachments.length > 0 && (
              <div className="add-expense-attachments__preview">
                {pendingAttachments.map((att, index) => (
                  <div key={att.blobUrl} className="add-expense-attachments__item">
                    <div className="add-expense-attachments__thumb-wrapper">
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
                    </div>
                    <div className="add-expense-attachments__item-info">
                      <span className="add-expense-attachments__file-name">{att.fileName}</span>
                      <span className="add-expense-attachments__file-size">{formatFileSize(att.fileSize)}</span>
                      {/* Scan button — images and PDFs */}
                      {(att.fileType.startsWith('image/') || att.fileType === 'application/pdf') && (
                        <button
                          type="button"
                          className={`scan-button-inline ${isScanning ? 'scan-button-inline--scanning' : ''}`}
                          onClick={() => handleScan(att.blobUrl)}
                          disabled={isScanning}
                        >
                          {isScanning ? 'Scanning...' : '🔍 Scan Receipt with AI'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* File picker */}
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

          {/* Amount */}
          <div className="form-group">
            <label htmlFor="amount" className="form-label">
              Amount * {confidenceDot(wasScanned('total'))}
            </label>
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
            {scanSuggestion('total', () => setAmount(String(scanResult!.total.value)))}
          </div>

          {/* Date */}
          <div className="form-group">
            <label htmlFor="date" className="form-label">
              Date * {confidenceDot(wasScanned('date'))}
            </label>
            <input
              type="date"
              id="date"
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

          {/* Home Office Checkbox */}
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
            <label htmlFor="vendor" className="form-label">
              Vendor {confidenceDot(wasScanned('vendor'))}
            </label>
            <input
              type="text"
              id="vendor"
              className="form-input"
              placeholder="e.g., Home Depot, Amazon"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
            />
            {scanSuggestion('vendor', () => setVendor(String(scanResult!.vendor.value)))}
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

          {/* Submit Button */}
          <button
            type="submit"
            className="btn btn--primary btn--full"
            disabled={submitting || loadingCategories || isUploading || isScanning}
          >
            {submitting ? 'Saving...' : 'Save Expense'}
          </button>
        </form>
      </div>
    </>
  )
}
