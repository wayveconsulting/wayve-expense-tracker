import { useState, useEffect, useRef, useCallback } from 'react'
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

interface PlaceData {
  address: string
  location: { lat: number; lng: number } | null
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
  const [startLocation, setStartLocation] = useState<PlaceData>({ address: '', location: null })
  const [endLocation, setEndLocation] = useState<PlaceData>({ address: '', location: null })
  const [distanceMiles, setDistanceMiles] = useState('')
  const [isRoundTrip, setIsRoundTrip] = useState(false)
  
  // UI state
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [calculatingDistance, setCalculatingDistance] = useState(false)
  const [googleLoaded, setGoogleLoaded] = useState(false)

  // Refs for autocomplete containers
  const startContainerRef = useRef<HTMLDivElement>(null)
  const endContainerRef = useRef<HTMLDivElement>(null)
  const startAutocompleteRef = useRef<HTMLElement | null>(null)
  const endAutocompleteRef = useRef<HTMLElement | null>(null)

  // Load Google Maps script (same pattern as AddMileageSheet)
  useEffect(() => {
    if (typeof window.google?.maps?.importLibrary === 'function') {
      setGoogleLoaded(true)
      return
    }

    if (document.querySelector('script[src*="maps.googleapis.com"]')) {
      const checkLoaded = setInterval(() => {
        if (typeof window.google?.maps?.importLibrary === 'function') {
          setGoogleLoaded(true)
          clearInterval(checkLoaded)
        }
      }, 100)
      return () => clearInterval(checkLoaded)
    }

    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${import.meta.env.VITE_GOOGLE_MAPS_API_KEY}&libraries=places&v=beta`
    script.async = true
    script.defer = true
    script.onload = () => {
      setGoogleLoaded(true)
    }
    script.onerror = () => {
      console.error('Failed to load Google Maps')
    }
    document.head.appendChild(script)
  }, [])

  // Calculate distance when both locations have geometry
  const calculateDistance = useCallback(async () => {
    if (!startLocation.location || !endLocation.location) return

    setCalculatingDistance(true)
    setError(null)

    try {
      const { DistanceMatrixService } = await window.google.maps.importLibrary('routes') as google.maps.RoutesLibrary

      const service = new DistanceMatrixService()
      const response = await new Promise<google.maps.DistanceMatrixResponse>((resolve, reject) => {
        service.getDistanceMatrix(
          {
            origins: [new google.maps.LatLng(startLocation.location!.lat, startLocation.location!.lng)],
            destinations: [new google.maps.LatLng(endLocation.location!.lat, endLocation.location!.lng)],
            travelMode: google.maps.TravelMode.DRIVING,
            unitSystem: google.maps.UnitSystem.IMPERIAL,
          },
          (response, status) => {
            if (status === 'OK' && response) {
              resolve(response)
            } else {
              reject(new Error(`Distance calculation failed: ${status}`))
            }
          }
        )
      })

      const element = response.rows[0]?.elements[0]
      if (element?.status === 'OK' && element.distance) {
        // Distance comes in meters, convert to miles
        const miles = element.distance.value / 1609.344
        setDistanceMiles(miles.toFixed(1))
      } else {
        setError('Could not calculate distance. Please enter manually.')
      }
    } catch (err) {
      console.error('Distance calculation error:', err)
      setError('Could not calculate distance. Please enter manually.')
    } finally {
      setCalculatingDistance(false)
    }
  }, [startLocation.location, endLocation.location])

  // Auto-calculate when both locations have geometry
  useEffect(() => {
    if (startLocation.location && endLocation.location) {
      calculateDistance()
    }
  }, [startLocation.location, endLocation.location, calculateDistance])

  // Initialize autocomplete elements when in edit mode
  useEffect(() => {
    if (!googleLoaded || !isOpen || mode !== 'edit') return

    // Clean up previous autocomplete elements when re-entering edit mode
    startAutocompleteRef.current = null
    endAutocompleteRef.current = null

    const initAutocomplete = async () => {
      try {
        const { PlaceAutocompleteElement } = await window.google.maps.importLibrary('places') as google.maps.PlacesLibrary

        // Create start location autocomplete
        if (startContainerRef.current && !startAutocompleteRef.current) {
          const startAutocomplete = new PlaceAutocompleteElement({})
          startAutocomplete.style.width = '100%'
          startContainerRef.current.innerHTML = ''
          startContainerRef.current.appendChild(startAutocomplete)
          startAutocompleteRef.current = startAutocomplete

          startAutocomplete.addEventListener('gmp-select', async (event: any) => {
            const placePrediction = event.placePrediction
            if (placePrediction) {
              const place = placePrediction.toPlace()
              await place.fetchFields({ fields: ['formattedAddress', 'location'] })
              const location = place.location
              setStartLocation({
                address: place.formattedAddress || '',
                location: location ? { lat: location.lat(), lng: location.lng() } : null
              })
            }
          })
        }

        // Create end location autocomplete
        if (endContainerRef.current && !endAutocompleteRef.current) {
          const endAutocomplete = new PlaceAutocompleteElement({})
          endAutocomplete.style.width = '100%'
          endContainerRef.current.innerHTML = ''
          endContainerRef.current.appendChild(endAutocomplete)
          endAutocompleteRef.current = endAutocomplete

          endAutocomplete.addEventListener('gmp-select', async (event: any) => {
            const placePrediction = event.placePrediction
            if (placePrediction) {
              const place = placePrediction.toPlace()
              await place.fetchFields({ fields: ['formattedAddress', 'location'] })
              const location = place.location
              setEndLocation({
                address: place.formattedAddress || '',
                location: location ? { lat: location.lat(), lng: location.lng() } : null
              })
            }
          })
        }
      } catch (err) {
        console.error('Error initializing autocomplete:', err)
      }
    }

    const timer = setTimeout(initAutocomplete, 150)
    return () => clearTimeout(timer)
  }, [googleLoaded, isOpen, mode])

  // Populate form when trip changes or sheet opens
  useEffect(() => {
    if (trip && isOpen) {
      setDate(trip.date.substring(0, 10))
      setDescription(trip.description || '')
      // Addresses load as text-only (no geometry) — user must re-select from
      // autocomplete to get geometry for distance recalculation
      setStartLocation({ address: trip.startLocation, location: null })
      setEndLocation({ address: trip.endLocation, location: null })
      setDistanceMiles(String(trip.distanceMiles / 100))
      setIsRoundTrip(trip.isRoundTrip)
      setMode(getDefaultMode())
      setError(null)
      setShowDeleteConfirm(false)
    }
  }, [trip, isOpen])

  // Clean up autocomplete refs when sheet closes
  useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(() => {
        setMode('view')
        setError(null)
        setShowDeleteConfirm(false)
        startAutocompleteRef.current = null
        endAutocompleteRef.current = null
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
    // Use the autocomplete address if selected, otherwise use original trip address
    const finalStart = startLocation.address.trim()
    const finalEnd = endLocation.address.trim()
    if (!finalStart) {
      setError('Please enter a start location')
      return
    }
    if (!finalEnd) {
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
          startLocation: finalStart,
          endLocation: finalEnd,
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

              {/* Start Location — Google Places Autocomplete */}
              <div className="form-group">
                <label className="form-label">Start Location *</label>
                <div ref={startContainerRef} className="autocomplete-container">
                  {/* PlaceAutocompleteElement gets injected here */}
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Loading address search..."
                    value={startLocation.address}
                    onChange={(e) => setStartLocation({ address: e.target.value, location: null })}
                  />
                </div>
                {startLocation.address && !startLocation.location && (
                  <span className="form-hint">Select from dropdown to enable distance calculation</span>
                )}
              </div>

              {/* End Location — Google Places Autocomplete */}
              <div className="form-group">
                <label className="form-label">End Location *</label>
                <div ref={endContainerRef} className="autocomplete-container">
                  {/* PlaceAutocompleteElement gets injected here */}
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Loading address search..."
                    value={endLocation.address}
                    onChange={(e) => setEndLocation({ address: e.target.value, location: null })}
                  />
                </div>
                {endLocation.address && !endLocation.location && (
                  <span className="form-hint">Select from dropdown to enable distance calculation</span>
                )}
              </div>

              {/* Distance */}
              <div className="form-group">
                <label htmlFor="edit-distance" className="form-label">
                  Distance (miles) *
                  {calculatingDistance && <span className="form-label__status"> — Calculating...</span>}
                </label>
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
                  disabled={submitting || calculatingDistance}
                >
                  {submitting ? 'Saving...' : calculatingDistance ? 'Calculating...' : 'Save Changes'}
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
