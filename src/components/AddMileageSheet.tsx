import { useState, useEffect, useRef, useCallback } from 'react'
import { useTenant } from '../hooks/useTenant'

interface AddMileageSheetProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

interface PlaceData {
  address: string
  location: { lat: number; lng: number } | null
}

export function AddMileageSheet({ isOpen, onClose, onSuccess }: AddMileageSheetProps) {
  const { subdomain } = useTenant()
  
  // Form state
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0])
  const [description, setDescription] = useState('')
  const [startLocation, setStartLocation] = useState<PlaceData>({ address: '', location: null })
  const [endLocation, setEndLocation] = useState<PlaceData>({ address: '', location: null })
  const [distanceMiles, setDistanceMiles] = useState<number | null>(null)
  const [isRoundTrip, setIsRoundTrip] = useState(false)
  const [manualDistance, setManualDistance] = useState('')
  const [useManualDistance, setUseManualDistance] = useState(false)
  
  // UI state
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [calculatingDistance, setCalculatingDistance] = useState(false)
  const [googleLoaded, setGoogleLoaded] = useState(false)
  
  // Refs for the autocomplete containers
  const startContainerRef = useRef<HTMLDivElement>(null)
  const endContainerRef = useRef<HTMLDivElement>(null)
  const startAutocompleteRef = useRef<HTMLElement | null>(null)
  const endAutocompleteRef = useRef<HTMLElement | null>(null)

  // Load Google Maps script with beta channel for new Places API
  useEffect(() => {
    // Check if already loaded
    if (typeof window.google?.maps?.importLibrary === 'function') {
      setGoogleLoaded(true)
      return
    }

    // Check if script is already loading
    if (document.querySelector('script[src*="maps.googleapis.com"]')) {
      const checkLoaded = setInterval(() => {
        if (typeof window.google?.maps?.importLibrary === 'function') {
          setGoogleLoaded(true)
          clearInterval(checkLoaded)
        }
      }, 100)
      return () => clearInterval(checkLoaded)
    }

    // Load the script with beta channel for PlaceAutocompleteElement
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${import.meta.env.VITE_GOOGLE_MAPS_API_KEY}&libraries=places&v=beta`
    script.async = true
    script.defer = true
    script.onload = () => {
      setGoogleLoaded(true)
    }
    script.onerror = () => {
      console.error('Failed to load Google Maps')
      setError('Failed to load Google Maps. You can enter addresses manually.')
      setUseManualDistance(true)
    }
    document.head.appendChild(script)
  }, [])

  // Initialize autocomplete elements when Google is loaded and sheet is open
  useEffect(() => {
    if (!googleLoaded || !isOpen) return

    const initAutocomplete = async () => {
      try {
        // Import the places library
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
        setError('Failed to initialize address search. You can enter addresses manually.')
        setUseManualDistance(true)
      }
    }

    // Small delay to ensure containers are rendered
    const timer = setTimeout(initAutocomplete, 100)
    return () => clearTimeout(timer)
  }, [googleLoaded, isOpen])

  // Calculate distance when both locations are set
  const calculateDistance = useCallback(async () => {
    if (!startLocation.location || !endLocation.location) {
      return
    }

    setCalculatingDistance(true)
    setError(null)

    try {
      const { DistanceMatrixService } = await window.google.maps.importLibrary('routes') as google.maps.RoutesLibrary
      const service = new DistanceMatrixService()
      
      const response = await service.getDistanceMatrix({
        origins: [startLocation.location],
        destinations: [endLocation.location],
        travelMode: google.maps.TravelMode.DRIVING,
        unitSystem: google.maps.UnitSystem.IMPERIAL,
      })

      const element = response.rows[0]?.elements[0]
      if (element?.status === 'OK' && element.distance) {
        // Distance comes in meters, convert to miles * 100 for storage
        const miles = element.distance.value / 1609.344
        setDistanceMiles(Math.round(miles * 100))
        setUseManualDistance(false)
      } else {
        setError('Could not calculate distance. Please enter manually.')
        setUseManualDistance(true)
      }
    } catch (err) {
      console.error('Distance calculation error:', err)
      setError('Could not calculate distance. Please enter manually.')
      setUseManualDistance(true)
    } finally {
      setCalculatingDistance(false)
    }
  }, [startLocation.location, endLocation.location])

  // Trigger distance calculation when both places are selected
  useEffect(() => {
    if (startLocation.location && endLocation.location && !useManualDistance) {
      calculateDistance()
    }
  }, [startLocation.location, endLocation.location, calculateDistance, useManualDistance])

  // Reset form when sheet closes
  useEffect(() => {
    if (!isOpen) {
      setDate(new Date().toISOString().split('T')[0])
      setDescription('')
      setStartLocation({ address: '', location: null })
      setEndLocation({ address: '', location: null })
      setDistanceMiles(null)
      setIsRoundTrip(false)
      setManualDistance('')
      setUseManualDistance(false)
      setError(null)
      
      // Clear autocomplete elements
      if (startContainerRef.current) {
        startContainerRef.current.innerHTML = ''
      }
      if (endContainerRef.current) {
        endContainerRef.current.innerHTML = ''
      }
      startAutocompleteRef.current = null
      endAutocompleteRef.current = null
    }
  }, [isOpen])

  // Format miles for display (stored as miles * 100)
  const formatMiles = (miles: number) => (miles / 100).toFixed(1)

  // Get the effective distance (calculated or manual)
  const getEffectiveDistance = (): number | null => {
    if (useManualDistance && manualDistance) {
      return Math.round(parseFloat(manualDistance) * 100)
    }
    return distanceMiles
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const effectiveDistance = getEffectiveDistance()
    const startAddr = startLocation.address || (startContainerRef.current?.querySelector('input') as HTMLInputElement)?.value || ''
    const endAddr = endLocation.address || (endContainerRef.current?.querySelector('input') as HTMLInputElement)?.value || ''

    // Client-side validation
    if (!startAddr.trim()) {
      setError('Start location is required')
      return
    }
    if (!endAddr.trim()) {
      setError('End location is required')
      return
    }
    if (!effectiveDistance || effectiveDistance <= 0) {
      setError('Distance is required')
      return
    }

    setSubmitting(true)

    try {
      const response = await fetch(`/api/mileage?tenant=${subdomain}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          description: description.trim() || null,
          startLocation: startAddr.trim(),
          endLocation: endAddr.trim(),
          distanceMiles: effectiveDistance,
          isRoundTrip,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.details?.join(', ') || data.error || 'Failed to log trip')
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

  const effectiveDistance = getEffectiveDistance()
  const displayDistance = effectiveDistance ? formatMiles(effectiveDistance) : null
  const tripDistance = displayDistance && isRoundTrip ? formatMiles(effectiveDistance! * 2) : displayDistance

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
          <h2 className="bottom-sheet__title">Log Trip</h2>
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

          {/* Date */}
          <div className="form-group">
            <label htmlFor="trip-date" className="form-label">Date *</label>
            <input
              type="date"
              id="trip-date"
              className="form-input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>

          {/* Start Location */}
          <div className="form-group">
            <label className="form-label">Start Location *</label>
            {googleLoaded && !useManualDistance ? (
              <div ref={startContainerRef} className="autocomplete-container" />
            ) : (
              <input
                type="text"
                className="form-input"
                placeholder="Enter starting address"
                value={startLocation.address}
                onChange={(e) => setStartLocation({ address: e.target.value, location: null })}
                required
              />
            )}
          </div>

          {/* End Location */}
          <div className="form-group">
            <label className="form-label">End Location *</label>
            {googleLoaded && !useManualDistance ? (
              <div ref={endContainerRef} className="autocomplete-container" />
            ) : (
              <input
                type="text"
                className="form-input"
                placeholder="Enter destination address"
                value={endLocation.address}
                onChange={(e) => setEndLocation({ address: e.target.value, location: null })}
                required
              />
            )}
          </div>

          {/* Distance Display / Manual Entry */}
          <div className="form-group">
            <label className="form-label">Distance</label>
            
            {calculatingDistance ? (
              <div className="distance-calculating">
                <span className="spinner" /> Calculating...
              </div>
            ) : displayDistance && !useManualDistance ? (
              <div className="distance-display">
                <span className="distance-value">{displayDistance} miles</span>
                {isRoundTrip && (
                  <span className="distance-round-trip">({tripDistance} mi round trip)</span>
                )}
                <button 
                  type="button" 
                  className="distance-edit-btn"
                  onClick={() => {
                    setUseManualDistance(true)
                    setManualDistance((effectiveDistance! / 100).toString())
                  }}
                >
                  Edit
                </button>
              </div>
            ) : (
              <div className="input-with-suffix">
                <input
                  type="number"
                  className="form-input form-input--with-suffix"
                  placeholder="0.0"
                  step="0.1"
                  min="0.1"
                  value={manualDistance}
                  onChange={(e) => setManualDistance(e.target.value)}
                  required={useManualDistance || !distanceMiles}
                />
                <span className="input-suffix">miles</span>
              </div>
            )}
          </div>

          {/* Round Trip Toggle */}
          <div className="form-group form-group--horizontal">
            <label htmlFor="round-trip" className="form-label">Round Trip</label>
            <button
              type="button"
              id="round-trip"
              className={`toggle ${isRoundTrip ? 'toggle--on' : ''}`}
              onClick={() => setIsRoundTrip(!isRoundTrip)}
              aria-pressed={isRoundTrip}
            >
              <span className="toggle__slider" />
            </button>
          </div>

          {/* Description (Optional) */}
          <div className="form-group">
            <label htmlFor="trip-description" className="form-label">Description (Optional)</label>
            <input
              type="text"
              id="trip-description"
              className="form-input"
              placeholder="e.g., Client meeting, Supply pickup"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Submit Button */}
          <button 
            type="submit" 
            className="btn btn--primary btn--full"
            disabled={submitting || calculatingDistance}
          >
            {submitting ? 'Saving...' : 'Log Trip'}
          </button>
        </form>
      </div>
    </>
  )
}