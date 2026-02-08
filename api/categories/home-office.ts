import type { VercelRequest, VercelResponse } from '@vercel/node'
import { db } from '../../src/db/index.js'
import { sessions, users, userTenantAccess, tenants } from '../../src/db/schema.js'
import { eq, and } from 'drizzle-orm'

// ============================================
// AUTH HELPER
// ============================================
async function authenticateAndGetTenant(req: VercelRequest): Promise<{ tenantId: string; userId: string } | { error: string; status: number }> {
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

  const tenantSubdomain = req.query.tenant as string | undefined
  if (!tenantSubdomain) {
    return { error: 'No tenant context', status: 400 }
  }

  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.subdomain, tenantSubdomain))
    .limit(1)

  if (!tenant) {
    return { error: 'Tenant not found', status: 404 }
  }

  const [hasAccess] = await db
    .select()
    .from(userTenantAccess)
    .where(and(
      eq(userTenantAccess.userId, user.id),
      eq(userTenantAccess.tenantId, tenant.id)
    ))
    .limit(1)

  if (!hasAccess && !user.isSuperAdmin) {
    return { error: 'Access denied', status: 403 }
  }

  return { tenantId: tenant.id, userId: user.id }
}

// ============================================
// MAIN HANDLER — PUT only
// ============================================
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const auth = await authenticateAndGetTenant(req)
    if ('error' in auth) {
      return res.status(auth.status).json({ error: auth.error })
    }

    const { tenantId } = auth
    const { homeTotalSqft, homeOfficeSqft } = req.body

    // Validation
    const errors: string[] = []

    if (homeTotalSqft !== undefined && homeTotalSqft !== null) {
      const total = Number(homeTotalSqft)
      if (isNaN(total) || total < 0 || total > 100000) {
        errors.push('Total square footage must be between 0 and 100,000')
      }
    }

    if (homeOfficeSqft !== undefined && homeOfficeSqft !== null) {
      const office = Number(homeOfficeSqft)
      if (isNaN(office) || office < 0 || office > 100000) {
        errors.push('Office square footage must be between 0 and 100,000')
      }
    }

    // Office can't be bigger than home
    const totalVal = homeTotalSqft !== undefined ? Number(homeTotalSqft) : null
    const officeVal = homeOfficeSqft !== undefined ? Number(homeOfficeSqft) : null
    if (totalVal !== null && officeVal !== null && officeVal > totalVal) {
      errors.push('Office square footage cannot exceed total home square footage')
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: 'Validation failed', details: errors })
    }

    // Build update
    const updates: Record<string, unknown> = {
      updatedAt: new Date(),
    }

    if (homeTotalSqft !== undefined) {
      updates.homeTotalSqft = homeTotalSqft === null ? null : Math.round(Number(homeTotalSqft))
    }
    if (homeOfficeSqft !== undefined) {
      updates.homeOfficeSqft = homeOfficeSqft === null ? null : Math.round(Number(homeOfficeSqft))
    }

    const [updated] = await db
      .update(tenants)
      .set(updates)
      .where(eq(tenants.id, tenantId))
      .returning({
        homeTotalSqft: tenants.homeTotalSqft,
        homeOfficeSqft: tenants.homeOfficeSqft,
      })

    const deductionPercent = (updated.homeTotalSqft && updated.homeOfficeSqft)
      ? Math.round((updated.homeOfficeSqft / updated.homeTotalSqft) * 10000) / 100
      : null

    return res.status(200).json({
      homeOfficeSettings: {
        homeTotalSqft: updated.homeTotalSqft,
        homeOfficeSqft: updated.homeOfficeSqft,
        deductionPercent,
      },
    })

  } catch (error) {
    console.error('Error updating home office settings:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
