import { useState, useEffect, useRef, useCallback } from 'react'
import { useTenant } from '../hooks/useTenant'

interface AddMileageSheetProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

// Declare google types
declare global {
  interface Window {
    google: typeof google
    initGoogleMaps: () => void
  }
}

export function AddMileageSheet({ isOpen, onClose, onSuccess }: AddMileageSheetProps) {
  const { subdomain } = useTenant()
  
  // Form state
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0])
  const [description, setDescription] = useState('')
  const [startLocation, setStartLocation] = useState('')
  const [endLocation, setEndLocation] = useState('')
  const [distanceMiles, setDistanceMiles] = useState<number | null>(null)
  const [isRoundTrip, setIsRoundTrip] = useState(false)
  const [manualDistance, setManualDistance] = useState('')
  const [useManualDistance, setUseManualDistance] = useState(false)
  
  // UI state
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [calculatingDistance, setCalculatingDistance] = useState(false)
  const [googleLoaded, setGoogleLoaded] = useState(false)
  
  // Refs for autocomplete
  const startInputRef = useRef<HTMLInputElement>(null)
  const endInputRef = useRef<HTMLInputElement>(null)
  const startAutocompleteRef = useRef<google.maps.places.Autocomplete | null>(null)
  const endAutocompleteRef = useRef<google.maps.places.Autocomplete | null>(null)
  const startPlaceRef = useRef<google.maps.places.PlaceResult | null>(null)
  const endPlaceRef = useRef<google.maps.places.PlaceResult | null>(null)

  // Load Google Maps script
  useEffect(() => {
    if (window.google?.maps?.places) {
      setGoogleLoaded(true)
      return
    }

    // Check if script is already loading
    if (document.querySelector('script[src*="maps.googleapis.com"]')) {
      // Wait for it to load
      const checkLoaded = setInterval(() => {
        if (window.google?.maps?.places) {
          setGoogleLoaded(true)
          clearInterval(checkLoaded)
        }
      }, 100)
      return () => clearInterval(checkLoaded)
    }

    // Load the script
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${import.meta.env.VITE_GOOGLE_MAPS_API_KEY}&libraries=places`
    script.async = true
    script.defer = true
    script.onload = () => {
      setGoogleLoaded(true)
    }
    script.onerror = () => {
      console.error('Failed to load Google Maps')
      setError('Failed to load Google Maps. You can enter addresses manually.')
    }
    document.head.appendChild(script)
  }, [])

  // Initialize autocomplete when Google is loaded and sheet is open
  useEffect(() => {
    if (!googleLoaded || !isOpen) return

    // Small delay to ensure inputs are rendered
    const timer = setTimeout(() => {
      if (startInputRef.current && !startAutocompleteRef.current) {
        startAutocompleteRef.current = new window.google.maps.places.Autocomplete(
          startInputRef.current,
          { types: ['address'], fields: ['formatted_address', 'geometry', 'place_id'] }
        )
        startAutocompleteRef.current.addListener('place_changed', () => {
          const place = startAutocompleteRef.current?.getPlace()
          if (place?.formatted_address) {
            setStartLocation(place.formatted_address)
            startPlaceRef.current = place
          }
        })
      }

      if (endInputRef.current && !endAutocompleteRef.current) {
        endAutocompleteRef.current = new window.google.maps.places.Autocomplete(
          endInputRef.current,
          { types: ['address'], fields: ['formatted_address', 'geometry', 'place_id'] }
        )
        endAutocompleteRef.current.addListener('place_changed', () => {
          const place = endAutocompleteRef.current?.getPlace()
          if (place?.formatted_address) {
            setEndLocation(place.formatted_address)
            endPlaceRef.current = place
          }
        })
      }
    }, 100)

    return () => clearTimeout(timer)
  }, [googleLoaded, isOpen])

  // Calculate distance when both locations are set
  const calculateDistance = useCallback(async () => {
    if (!startPlaceRef.current?.geometry?.location || !endPlaceRef.current?.geometry?.location) {
      return
    }

    setCalculatingDistance(true)
    setError(null)

    try {
      const service = new window.google.maps.DistanceMatrixService()
      
      const response = await new Promise<google.maps.DistanceMatrixResponse>((resolve, reject) => {
        service.getDistanceMatrix(
          {
            origins: [startPlaceRef.current!.geometry!.location!],
            destinations: [endPlaceRef.current!.geometry!.location!],
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
  }, [])

  // Trigger distance calculation when both places are selected
  useEffect(() => {
    if (startPlaceRef.current?.geometry?.location && endPlaceRef.current?.geometry?.location && !useManualDistance) {
      calculateDistance()
    }
  }, [startLocation, endLocation, calculateDistance, useManualDistance])

  // Reset form when sheet closes
  useEffect(() => {
    if (!isOpen) {
      setDate(new Date().toISOString().split('T')[0])
      setDescription('')
      setStartLocation('')
      setEndLocation('')
      setDistanceMiles(null)
      setIsRoundTrip(false)
      setManualDistance('')
      setUseManualDistance(false)
      setError(null)
      startPlaceRef.current = null
      endPlaceRef.current = null
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

    // Client-side validation
    if (!startLocation.trim()) {
      setError('Start location is required')
      return
    }
    if (!endLocation.trim()) {
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
          startLocation: startLocation.trim(),
          endLocation: endLocation.trim(),
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
            <label htmlFor="start-location" className="form-label">Start Location *</label>
            <input
              ref={startInputRef}
              type="text"
              id="start-location"
              className="form-input"
              placeholder="Enter starting address"
              value={startLocation}
              onChange={(e) => setStartLocation(e.target.value)}
              autoComplete="off"
              required
            />
          </div>

          {/* End Location */}
          <div className="form-group">
            <label htmlFor="end-location" className="form-label">End Location *</label>
            <input
              ref={endInputRef}
              type="text"
              id="end-location"
              className="form-input"
              placeholder="Enter destination address"
              value={endLocation}
              onChange={(e) => setEndLocation(e.target.value)}
              autoComplete="off"
              required
            />
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
