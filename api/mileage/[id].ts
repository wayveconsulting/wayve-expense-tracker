import type { VercelRequest, VercelResponse } from '@vercel/node'
import { db } from '../../src/db/index.js'
import { mileageTrips } from '../../src/db/schema.js'
import { eq, and } from 'drizzle-orm'
import { authenticateRequest } from '../_lib/auth.js'

// ===========================================
// GET: Fetch single trip
// ===========================================
async function handleGet(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req)
  if (!auth) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const { tenantId } = auth

  const tripId = req.query.id as string

  const [trip] = await db
    .select()
    .from(mileageTrips)
    .where(and(
      eq(mileageTrips.id, tripId),
      eq(mileageTrips.tenantId, tenantId)
    ))
    .limit(1)

  if (!trip) {
    return res.status(404).json({ error: 'Trip not found' })
  }

  return res.status(200).json({
    trip: {
      ...trip,
      displayMiles: trip.isRoundTrip ? trip.distanceMiles * 2 : trip.distanceMiles,
    },
  })
}

// ===========================================
// PUT: Update trip
// ===========================================
async function handlePut(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req)
  if (!auth) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const { user, tenantId } = auth

  const tripId = req.query.id as string

  // Verify trip exists and belongs to tenant
  const [existingTrip] = await db
    .select()
    .from(mileageTrips)
    .where(and(
      eq(mileageTrips.id, tripId),
      eq(mileageTrips.tenantId, tenantId)
    ))
    .limit(1)

  if (!existingTrip) {
    return res.status(404).json({ error: 'Trip not found' })
  }

  const { date, description, startLocation, endLocation, distanceMiles, isRoundTrip } = req.body

  // Validation
  const errors: string[] = []

  if (date !== undefined) {
    const parsedDate = new Date(date)
    if (isNaN(parsedDate.getTime())) {
      errors.push('Invalid date format')
    }
  }

  if (startLocation !== undefined && (typeof startLocation !== 'string' || startLocation.trim().length === 0)) {
    errors.push('Start location cannot be empty')
  }

  if (endLocation !== undefined && (typeof endLocation !== 'string' || endLocation.trim().length === 0)) {
    errors.push('End location cannot be empty')
  }

  if (distanceMiles !== undefined && (typeof distanceMiles !== 'number' || distanceMiles <= 0)) {
    errors.push('Distance must be a positive number')
  }

  if (errors.length > 0) {
    return res.status(400).json({ error: 'Validation failed', details: errors })
  }

  // Build update object
  const updates: Partial<typeof mileageTrips.$inferInsert> = {
    updatedBy: user.id,
    updatedAt: new Date(),
  }

  if (date !== undefined) updates.date = new Date(date)
  if (description !== undefined) updates.description = description?.trim() || null
  if (startLocation !== undefined) updates.startLocation = startLocation.trim()
  if (endLocation !== undefined) updates.endLocation = endLocation.trim()
  if (distanceMiles !== undefined) updates.distanceMiles = Math.round(distanceMiles)
  if (isRoundTrip !== undefined) updates.isRoundTrip = Boolean(isRoundTrip)

  const [updatedTrip] = await db
    .update(mileageTrips)
    .set(updates)
    .where(eq(mileageTrips.id, tripId))
    .returning()

  return res.status(200).json({
    message: 'Trip updated successfully',
    trip: {
      ...updatedTrip,
      displayMiles: updatedTrip.isRoundTrip ? updatedTrip.distanceMiles * 2 : updatedTrip.distanceMiles,
    },
  })
}

// ===========================================
// DELETE: Delete trip
// ===========================================
async function handleDelete(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req)
  if (!auth) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const { tenantId } = auth

  const tripId = req.query.id as string

  // Verify trip exists and belongs to tenant
  const [existingTrip] = await db
    .select()
    .from(mileageTrips)
    .where(and(
      eq(mileageTrips.id, tripId),
      eq(mileageTrips.tenantId, tenantId)
    ))
    .limit(1)

  if (!existingTrip) {
    return res.status(404).json({ error: 'Trip not found' })
  }

  await db
    .delete(mileageTrips)
    .where(eq(mileageTrips.id, tripId))

  return res.status(200).json({ message: 'Trip deleted successfully' })
}

// ===========================================
// Main handler
// ===========================================
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    switch (req.method) {
      case 'GET':
        return handleGet(req, res)
      case 'PUT':
        return handlePut(req, res)
      case 'DELETE':
        return handleDelete(req, res)
      default:
        return res.status(405).json({ error: 'Method not allowed' })
    }
  } catch (error) {
    console.error('Error in mileage/[id] API:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
