import type { VercelRequest, VercelResponse } from '@vercel/node'
import { db } from '../../src/db/index.js'
import { categories, sessions, users, userTenantAccess, tenants } from '../../src/db/schema.js'
import { eq, and, asc } from 'drizzle-orm'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    // Get session from cookie
    const sessionToken = req.cookies.session
    if (!sessionToken) {
      return res.status(401).json({ error: 'Not authenticated' })
    }

    // Validate session
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.token, sessionToken))
      .limit(1)

    if (!session || new Date(session.expiresAt) < new Date()) {
      return res.status(401).json({ error: 'Session expired' })
    }

    // Get user
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1)

    if (!user) {
      return res.status(401).json({ error: 'User not found' })
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
      return res.status(400).json({ error: 'No tenant context' })
    }

    // Fetch active categories for this tenant, sorted by sortOrder then name
    const categoryList = await db
      .select({
        id: categories.id,
        name: categories.name,
        emoji: categories.emoji,
        sortOrder: categories.sortOrder,
      })
      .from(categories)
      .where(and(
        eq(categories.tenantId, tenantId),
        eq(categories.isActive, true)
      ))
      .orderBy(asc(categories.sortOrder), asc(categories.name))

    return res.status(200).json({
      categories: categoryList,
    })

  } catch (error) {
    console.error('Error fetching categories:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}