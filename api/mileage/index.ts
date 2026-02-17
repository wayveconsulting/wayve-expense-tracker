import type { VercelRequest, VercelResponse } from '@vercel/node'
import { db } from '../../src/db/index.js'
import { mileageTrips } from '../../src/db/schema.js'
import { eq, and, desc, gte, lt } from 'drizzle-orm'
import { authenticateRequest } from '../_lib/auth.js'

// ===========================================
// GET: Fetch mileage trips
// ===========================================
async function handleGet(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req)
  if (!auth) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const { tenantId } = auth

  // Get query params for filtering
  const year = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear()
  const limit = req.query.limit ? parseInt(req.query.limit as string) : 500

  // Date range for year filter
  const startOfYear = new Date(year, 0, 1)
  const endOfYear = new Date(year + 1, 0, 1)

  // Fetch trips
  const trips = await db
    .select({
      id: mileageTrips.id,
      date: mileageTrips.date,
      description: mileageTrips.description,
      startLocation: mileageTrips.startLocation,
      endLocation: mileageTrips.endLocation,
      distanceMiles: mileageTrips.distanceMiles,
      isRoundTrip: mileageTrips.isRoundTrip,
      createdAt: mileageTrips.createdAt,
    })
    .from(mileageTrips)
    .where(and(
      eq(mileageTrips.tenantId, tenantId),
      gte(mileageTrips.date, startOfYear),
      lt(mileageTrips.date, endOfYear)
    ))
    .orderBy(desc(mileageTrips.date))
    .limit(limit)

  // Calculate summary
  const totalMiles = trips.reduce((sum, trip) => {
    const miles = trip.isRoundTrip ? trip.distanceMiles * 2 : trip.distanceMiles
    return sum + miles
  }, 0)

  // IRS standard mileage rate for 2025 (70 cents)
  const mileageRate = 0.70
  const estimatedDeduction = (totalMiles / 100) * mileageRate

  return res.status(200).json({
    trips: trips.map(trip => ({
      ...trip,
      // Include calculated round-trip miles for display
      displayMiles: trip.isRoundTrip ? trip.distanceMiles * 2 : trip.distanceMiles,
    })),
    summary: {
      totalMiles,
      tripCount: trips.length,
      estimatedDeduction: Math.round(estimatedDeduction * 100), // Store as cents
      year,
    },
  })
}

// ===========================================
// POST: Create new mileage trip
// ===========================================
async function handlePost(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req)
  if (!auth) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const { user, tenantId } = auth

  // Parse request body
  const { date, description, startLocation, endLocation, distanceMiles, isRoundTrip } = req.body

  // Validation
  const errors: string[] = []

  if (!date) {
    errors.push('Date is required')
  } else {
    const parsedDate = new Date(date)
    if (isNaN(parsedDate.getTime())) {
      errors.push('Invalid date format')
    }
  }

  if (!startLocation || typeof startLocation !== 'string' || startLocation.trim().length === 0) {
    errors.push('Start location is required')
  }

  if (!endLocation || typeof endLocation !== 'string' || endLocation.trim().length === 0) {
    errors.push('End location is required')
  }

  if (distanceMiles === undefined || distanceMiles === null) {
    errors.push('Distance is required')
  } else if (typeof distanceMiles !== 'number' || distanceMiles <= 0) {
    errors.push('Distance must be a positive number')
  }

  if (errors.length > 0) {
    return res.status(400).json({ error: 'Validation failed', details: errors })
  }

  // Create the trip
  const [newTrip] = await db
    .insert(mileageTrips)
    .values({
      tenantId,
      date: new Date(date),
      description: description?.trim() || null,
      startLocation: startLocation.trim(),
      endLocation: endLocation.trim(),
      distanceMiles: Math.round(distanceMiles), // Already in miles * 100 from client
      isRoundTrip: Boolean(isRoundTrip),
      createdBy: user.id,
      updatedBy: user.id,
    })
    .returning()

  return res.status(201).json({
    message: 'Trip logged successfully',
    trip: {
      ...newTrip,
      displayMiles: newTrip.isRoundTrip ? newTrip.distanceMiles * 2 : newTrip.distanceMiles,
    },
  })
}

// ===========================================
// Main handler: Route by method
// ===========================================
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    switch (req.method) {
      case 'GET':
        return handleGet(req, res)
      case 'POST':
        return handlePost(req, res)
      default:
        return res.status(405).json({ error: 'Method not allowed' })
    }
  } catch (error) {
    console.error('Error in mileage API:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
