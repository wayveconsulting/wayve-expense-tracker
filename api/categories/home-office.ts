import type { VercelRequest, VercelResponse } from '@vercel/node'
import { db } from '../../src/db/index.js'
import { tenants } from '../../src/db/schema.js'
import { eq } from 'drizzle-orm'
import { authenticateRequest } from '../_lib/auth.js'

// ============================================
// MAIN HANDLER — PUT only
// ============================================
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const auth = await authenticateRequest(req)
    if (!auth) {
      return res.status(401).json({ error: 'Unauthorized' })
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
