import { useState, useEffect } from 'react'
import { useTenant } from '../hooks/useTenant'

// Get saved preference from localStorage
function getDefaultMode(): 'view' | 'edit' {
  if (typeof window === 'undefined') return 'view'
  return (localStorage.getItem('expenseDetailMode') as 'view' | 'edit') || 'view'
}

// ============================================
// Client-side image compression via Canvas API
// Only compresses images over 4MB. PDFs and small files pass through.
// ============================================
const COMPRESSION_THRESHOLD = 4 * 1024 * 1024 // 4MB — compress if larger
const MAX_UPLOAD_SIZE = 10 * 1024 * 1024       // 10MB — reject if larger (pre-compression)
const MAX_DIMENSION = 2048                      // Resize longest edge to this

async function compressImageFile(file: File): Promise<{ base64: string; fileName: string; fileType: string; fileSize: number }> {
  // PDFs: never compress, just convert to base64
  if (file.type === 'application/pdf') {
    const base64 = await fileToBase64(file)
    return { base64, fileName: file.name, fileType: file.type, fileSize: file.size }
  }

  // Images under threshold: pass through untouched
  if (file.size <= COMPRESSION_THRESHOLD) {
    const base64 = await fileToBase64(file)
    return { base64, fileName: file.name, fileType: file.type, fileSize: file.size }
  }

  // Image over 4MB — compress via Canvas API
  const img = await loadImage(file)
  const qualitySteps = [0.92, 0.85, 0.75]
  
  for (const quality of qualitySteps) {
    const { base64, blob } = await resizeAndCompress(img, quality)
    
    if (blob.size <= COMPRESSION_THRESHOLD) {
      // Build new filename: original name but .jpg extension
      const compressedName = file.name.replace(/\.[^.]+$/, '') + '.jpg'
      return { base64, fileName: compressedName, fileType: 'image/jpeg', fileSize: blob.size }
    }
  }

  // Even at 75% quality it's still over 4MB — use the last attempt anyway
  // The server will reject if it's truly too large for the body limit
  const { base64, blob } = await resizeAndCompress(img, 0.75)
  const compressedName = file.name.replace(/\.[^.]+$/, '') + '.jpg'
  return { base64, fileName: compressedName, fileType: 'image/jpeg', fileSize: blob.size }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(',')[1]) // Strip data:...;base64, prefix
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(img.src)
      resolve(img)
    }
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}

async function resizeAndCompress(img: HTMLImageElement, quality: number): Promise<{ base64: string; blob: Blob }> {
  // Calculate new dimensions — scale down so longest edge = MAX_DIMENSION
  let { width, height } = img
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    if (width > height) {
      height = Math.round(height * (MAX_DIMENSION / width))
      width = MAX_DIMENSION
    } else {
      width = Math.round(width * (MAX_DIMENSION / height))
      height = MAX_DIMENSION
    }
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, width, height)

  // Export as JPEG blob
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => b ? resolve(b) : reject(new Error('Canvas compression failed')),
      'image/jpeg',
      quality
    )
  })

  // Convert blob to base64
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(',')[1])
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })

  return { base64, blob }
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
      setDate(new Date(expense.date).toISOString().split('T')[0])
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
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  // Handle file upload — with client-side compression for large images
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !expense) return

    // Reset the input so the same file can be re-selected
    e.target.value = ''

    const allowedTypes = ['image/jpeg', 'image/png', 'image/heic', 'application/pdf']
    if (!allowedTypes.includes(file.type)) {
      setError('File type not allowed. Accepted: JPEG, PNG, HEIC, PDF')
      return
    }

    // Pre-compression size gate — reject truly massive files
    if (file.size > MAX_UPLOAD_SIZE) {
      setError('File too large. Maximum size is 10MB.')
      return
    }

    try {
      setUploading(true)
      setUploadStatus(null)
      setError(null)

      // Compress if needed (images >4MB), otherwise pass through
      if (file.size > COMPRESSION_THRESHOLD && file.type.startsWith('image/')) {
        setUploadStatus('Compressing image...')
      }

      const { base64, fileName, fileType, fileSize } = await compressImageFile(file)

      // Show compression result if it happened
      if (file.size > COMPRESSION_THRESHOLD && file.type.startsWith('image/')) {
        const savedPct = Math.round((1 - fileSize / file.size) * 100)
        setUploadStatus(`Compressed: ${formatFileSize(file.size)} → ${formatFileSize(fileSize)} (${savedPct}% smaller)`)
      } else {
        setUploadStatus('Uploading...')
      }

      const response = await fetch(`/api/attachments?tenant=${subdomain}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expenseId: expense.id,
          fileName: fileName,
          fileType: fileType,
          fileData: base64,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Upload failed')
      }

      const data = await response.json()
      setAttachments(prev => [...prev, data.attachment])
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

  // Format file size for display
  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

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

              {/* Attachments Section */}
              <div className="attachments-section">
                <div className="attachments-section__header">
                  <span className="form-label">Attachments</span>
                  <label className="btn btn--small btn--secondary attachments-upload-btn">
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/heic,application/pdf"
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