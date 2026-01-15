import type { VercelRequest, VercelResponse } from '@vercel/node'
import { db } from '../../src/db/index.js'
import { mileageTrips, sessions, users, userTenantAccess, tenants } from '../../src/db/schema.js'
import { eq, and, desc, gte, lt } from 'drizzle-orm'

// ===========================================
// Helper: Validate session and get user + tenant
// ===========================================
async function authenticateRequest(req: VercelRequest): Promise<{
  user: typeof users.$inferSelect
  tenantId: string
} | { error: string; status: number }> {
  // Get session from cookie
  const sessionToken = req.cookies.session
  if (!sessionToken) {
    return { error: 'Not authenticated', status: 401 }
  }

  // Validate session
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.token, sessionToken))
    .limit(1)

  if (!session || new Date(session.expiresAt) < new Date()) {
    return { error: 'Session expired', status: 401 }
  }

  // Get user
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1)

  if (!user) {
    return { error: 'User not found', status: 401 }
  }

  // Determine tenant from query param
  let tenantId: string | null = null
  const tenantSubdomain = req.query.tenant as string | undefined

  if (tenantSubdomain) {
    // Get tenant by subdomain
    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.subdomain, tenantSubdomain))
      .limit(1)

    if (tenant) {
      // Verify user has access to this tenant
      const [hasAccess] = await db
        .select()
        .from(userTenantAccess)
        .where(and(
          eq(userTenantAccess.userId, user.id),
          eq(userTenantAccess.tenantId, tenant.id)
        ))
        .limit(1)

      if (hasAccess || user.isSuperAdmin) {
        tenantId = tenant.id
      }
    }
  }

  if (!tenantId) {
    return { error: 'No tenant context', status: 400 }
  }

  return { user, tenantId }
}

// ===========================================
// GET: Fetch mileage trips
// ===========================================
async function handleGet(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req)
  if ('error' in auth) {
    return res.status(auth.status).json({ error: auth.error })
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
  if ('error' in auth) {
    return res.status(auth.status).json({ error: auth.error })
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
