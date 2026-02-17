import type { VercelRequest, VercelResponse } from '@vercel/node'
import { db } from '../../src/db/index.js'
import { mileageTrips, sessions, users, userTenantAccess, tenants } from '../../src/db/schema.js'
import { eq, and, asc, gte, lt } from 'drizzle-orm'

// ===========================================
// Helper: Validate session and get user + tenant
// ===========================================
async function authenticateRequest(req: VercelRequest): Promise<{
  user: typeof users.$inferSelect
  tenantId: string
} | { error: string; status: number }> {
  const sessionToken = req.cookies.session
  if (!sessionToken) {
    return { error: 'Not authenticated', status: 401 }
  }

  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.token, sessionToken))
    .limit(1)

  if (!session || new Date(session.expiresAt) < new Date()) {
    return { error: 'Session expired', status: 401 }
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1)

  if (!user) {
    return { error: 'User not found', status: 401 }
  }

  let tenantId: string | null = null
  const tenantSubdomain = req.query.tenant as string | undefined

  if (tenantSubdomain) {
    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.subdomain, tenantSubdomain))
      .limit(1)

    if (tenant) {
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
// GET: Mileage log report for a year
// ===========================================
async function handleGet(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  const auth = await authenticateRequest(req)
  if ('error' in auth) {
    return res.status(auth.status).json({ error: auth.error })
  }
  const { tenantId } = auth

  const year = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear()

  // Date range for SQL-level filtering
  const startDate = new Date(year, 0, 1)
  const endDate = new Date(year + 1, 0, 1)

  // Fetch mileage trips for this year only, sorted chronologically (oldest first for IRS report)
  const yearTrips = await db
    .select()
    .from(mileageTrips)
    .where(and(
      eq(mileageTrips.tenantId, tenantId),
      gte(mileageTrips.date, startDate),
      lt(mileageTrips.date, endDate)
    ))
    .orderBy(asc(mileageTrips.date))

  // Build report rows
  const trips = yearTrips.map((trip) => ({
    id: trip.id,
    date: trip.date,
    startLocation: trip.startLocation,
    endLocation: trip.endLocation,
    description: trip.description,
    distanceMiles: trip.distanceMiles,
    displayMiles: trip.isRoundTrip ? trip.distanceMiles * 2 : trip.distanceMiles,
    isRoundTrip: trip.isRoundTrip,
  }))

  // Calculate summary
  const totalMiles = trips.reduce((sum, t) => sum + t.displayMiles, 0)
  const tripCount = trips.length
  // IRS standard mileage rate for 2025: $0.70/mile
  const mileageRate = 70 // cents per mile
  const estimatedDeduction = Math.round((totalMiles / 100) * mileageRate)

  // Monthly breakdown
  const monthlyMiles = new Array(12).fill(0)
  for (const trip of trips) {
    const month = new Date(trip.date).getMonth()
    monthlyMiles[month] += trip.displayMiles
  }

  const monthlyBreakdown = monthlyMiles.map((miles, i) => ({
    month: i + 1,
    label: new Date(year, i).toLocaleString('en-US', { month: 'long' }),
    totalMiles: miles,
    tripCount: trips.filter((t) => new Date(t.date).getMonth() === i).length,
  })).filter((m) => m.totalMiles > 0 || m.tripCount > 0)

  return res.status(200).json({
    year,
    trips,
    summary: {
      totalMiles,
      tripCount,
      estimatedDeduction,
      mileageRate,
    },
    monthlyBreakdown,
  })
}

// ===========================================
// Main handler
// ===========================================
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    switch (req.method) {
      case 'GET':
        return handleGet(req, res)
      default:
        return res.status(405).json({ error: 'Method not allowed' })
    }
  } catch (error) {
    console.error('Error in mileage report API:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}