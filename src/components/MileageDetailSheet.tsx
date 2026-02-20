import { useState, useEffect } from 'react'
import { useTenant } from '../hooks/useTenant'

// Get saved preference from localStorage
function getDefaultMode(): 'view' | 'edit' {
  if (typeof window === 'undefined') return 'view'
  return (localStorage.getItem('mileageDetailMode') as 'view' | 'edit') || 'view'
}

interface MileageTrip {
  id: string
  date: string
  description: string | null
  startLocation: string
  endLocation: string
  distanceMiles: number
  isRoundTrip: boolean
}

interface MileageDetailSheetProps {
  trip: MileageTrip | null
  isOpen: boolean
  onClose: () => void
  onUpdate: () => void
  onDelete: () => void
}

export function MileageDetailSheet({ trip, isOpen, onClose, onUpdate, onDelete }: MileageDetailSheetProps) {
  const { subdomain } = useTenant()
  
  // Mode: 'view' or 'edit' (persisted to localStorage)
  const [mode, setMode] = useState<'view' | 'edit'>(getDefaultMode)
  
  // Persist mode changes to localStorage
  const handleModeChange = (newMode: 'view' | 'edit') => {
    setMode(newMode)
    localStorage.setItem('mileageDetailMode', newMode)
  }
  
  // Edit form state
  const [date, setDate] = useState('')
  const [description, setDescription] = useState('')
  const [startLocation, setStartLocation] = useState('')
  const [endLocation, setEndLocation] = useState('')
  const [distanceMiles, setDistanceMiles] = useState('')
  const [isRoundTrip, setIsRoundTrip] = useState(false)
  
  // UI state
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Populate form when trip changes or sheet opens
  useEffect(() => {
    if (trip && isOpen) {
      setDate(trip.date.substring(0, 10))
      setDescription(trip.description || '')
      setStartLocation(trip.startLocation)
      setEndLocation(trip.endLocation)
      setDistanceMiles(String(trip.distanceMiles / 100))
      setIsRoundTrip(trip.isRoundTrip)
      setMode(getDefaultMode())
      setError(null)
      setShowDeleteConfirm(false)
    }
  }, [trip, isOpen])

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

  // Format miles for display (stored as miles * 100)
  const formatMiles = (miles: number) => (miles / 100).toFixed(1)

  // Format date for display (timezone-safe)
  const formatDate = (dateStr: string) => {
    const [year, month, day] = dateStr.substring(0, 10).split('-').map(Number)
    return new Date(year, month - 1, day).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
  }

  // Calculate estimated deduction (IRS rate for 2025: $0.70/mile)
  const calculateDeduction = (miles: number, roundTrip: boolean) => {
    const effectiveMiles = roundTrip ? miles * 2 : miles
    return ((effectiveMiles / 100) * 0.70).toFixed(2)
  }

  // Handle save
  async function handleSave() {
    if (!trip) return
    setError(null)

    const distanceNum = parseFloat(distanceMiles)
    if (!distanceMiles || isNaN(distanceNum) || distanceNum <= 0) {
      setError('Please enter a valid distance')
      return
    }
    if (!date) {
      setError('Please select a date')
      return
    }
    if (!startLocation.trim()) {
      setError('Please enter a start location')
      return
    }
    if (!endLocation.trim()) {
      setError('Please enter an end location')
      return
    }

    try {
      setSubmitting(true)
      const distanceStored = Math.round(distanceNum * 100)

      const response = await fetch(`/api/mileage/${trip.id}?tenant=${subdomain}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: date + 'T12:00:00.000Z',
          description: description.trim() || null,
          startLocation: startLocation.trim(),
          endLocation: endLocation.trim(),
          distanceMiles: distanceStored,
          isRoundTrip,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.details?.join(', ') || data.error || 'Failed to update trip')
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
    if (!trip) return

    try {
      setDeleting(true)
      const response = await fetch(`/api/mileage/${trip.id}?tenant=${subdomain}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete trip')
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

  if (!trip) return null

  const effectiveMiles = trip.isRoundTrip ? trip.distanceMiles * 2 : trip.distanceMiles

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
            {mode === 'view' ? 'Trip Details' : 'Edit Trip'}
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
                Are you sure you want to delete this trip? This cannot be undone.
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
              {/* Miles - Hero Display */}
              <div className="detail-hero">
                <span className="detail-hero__emoji">🚗</span>
                <span className="detail-hero__amount">{formatMiles(effectiveMiles)} mi</span>
              </div>

              {/* Details List */}
              <div className="detail-list">
                <div className="detail-row">
                  <span className="detail-row__label">Date</span>
                  <span className="detail-row__value">{formatDate(trip.date)}</span>
                </div>
                
                <div className="detail-row">
                  <span className="detail-row__label">From</span>
                  <span className="detail-row__value">{trip.startLocation}</span>
                </div>

                <div className="detail-row">
                  <span className="detail-row__label">To</span>
                  <span className="detail-row__value">{trip.endLocation}</span>
                </div>

                <div className="detail-row">
                  <span className="detail-row__label">Distance</span>
                  <span className="detail-row__value">
                    {formatMiles(trip.distanceMiles)} mi
                    {trip.isRoundTrip && ` × 2 = ${formatMiles(effectiveMiles)} mi`}
                  </span>
                </div>

                <div className="detail-row">
                  <span className="detail-row__label">Round Trip</span>
                  <span className="detail-row__value">{trip.isRoundTrip ? 'Yes' : 'No'}</span>
                </div>

                {trip.description && (
                  <div className="detail-row">
                    <span className="detail-row__label">Description</span>
                    <span className="detail-row__value">{trip.description}</span>
                  </div>
                )}

                <div className="detail-row">
                  <span className="detail-row__label">Est. Deduction</span>
                  <span className="detail-row__value">${calculateDeduction(trip.distanceMiles, trip.isRoundTrip)}</span>
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
                  Edit Trip
                </button>
                <button 
                  className="btn btn--danger-outline btn--full"
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                  Delete Trip
                </button>
              </div>
            </>
          )}

          {/* Edit Mode */}
          {mode === 'edit' && !showDeleteConfirm && (
            <>
              {/* Date */}
              <div className="form-group">
                <label htmlFor="edit-trip-date" className="form-label">Date *</label>
                <input
                  type="date"
                  id="edit-trip-date"
                  className="form-input"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </div>

              {/* Start Location */}
              <div className="form-group">
                <label htmlFor="edit-start-location" className="form-label">Start Location *</label>
                <input
                  type="text"
                  id="edit-start-location"
                  className="form-input"
                  placeholder="Enter starting address"
                  value={startLocation}
                  onChange={(e) => setStartLocation(e.target.value)}
                  required
                />
              </div>

              {/* End Location */}
              <div className="form-group">
                <label htmlFor="edit-end-location" className="form-label">End Location *</label>
                <input
                  type="text"
                  id="edit-end-location"
                  className="form-input"
                  placeholder="Enter destination address"
                  value={endLocation}
                  onChange={(e) => setEndLocation(e.target.value)}
                  required
                />
              </div>

              {/* Distance */}
              <div className="form-group">
                <label htmlFor="edit-distance" className="form-label">Distance (miles) *</label>
                <div className="input-with-suffix">
                  <input
                    type="number"
                    id="edit-distance"
                    className="form-input form-input--with-suffix"
                    placeholder="0.0"
                    step="0.1"
                    min="0.1"
                    value={distanceMiles}
                    onChange={(e) => setDistanceMiles(e.target.value)}
                    required
                  />
                  <span className="input-suffix">miles</span>
                </div>
              </div>

              {/* Round Trip Toggle */}
              <div className="form-group form-group--horizontal">
                <label htmlFor="edit-round-trip" className="form-label">Round Trip</label>
                <button
                  type="button"
                  id="edit-round-trip"
                  className={`toggle ${isRoundTrip ? 'toggle--on' : ''}`}
                  onClick={() => setIsRoundTrip(!isRoundTrip)}
                  aria-pressed={isRoundTrip}
                >
                  <span className="toggle__slider" />
                </button>
              </div>

              {/* Description */}
              <div className="form-group">
                <label htmlFor="edit-trip-description" className="form-label">Description (Optional)</label>
                <input
                  type="text"
                  id="edit-trip-description"
                  className="form-input"
                  placeholder="e.g., Client meeting, Supply pickup"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
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
                  disabled={submitting}
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
                Delete Trip
              </button>
            </>
          )}
        </div>
      </div>
    </>
  )
}