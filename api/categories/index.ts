import type { VercelRequest, VercelResponse } from '@vercel/node'
import { db } from '../../src/db/index.js'
import { categories, expenses, sessions, users, userTenantAccess, tenants } from '../../src/db/schema.js'
import { eq, and, asc, sql, count, sum } from 'drizzle-orm'

// ============================================
// AUTH HELPER — shared across handlers
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

  // Determine tenant from query param
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

  // Verify access
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
// MAIN HANDLER
// ============================================
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Set no-cache for auth routes
  res.setHeader('Cache-Control', 'no-store')

  if (req.method === 'GET') {
    return handleGet(req, res)
  } else if (req.method === 'POST') {
    return handlePost(req, res)
  } else {
    return res.status(405).json({ error: 'Method not allowed' })
  }
}

// ============================================
// GET — Fetch categories with spending totals
// ============================================
async function handleGet(req: VercelRequest, res: VercelResponse) {
  try {
    const auth = await authenticateAndGetTenant(req)
    if ('error' in auth) {
      return res.status(auth.status).json({ error: auth.error })
    }

    const { tenantId } = auth

    // Determine if we should include spending data
    const includeSpending = req.query.includeSpending === 'true'
    const year = req.query.year ? parseInt(req.query.year as string) : undefined

    if (includeSpending && year) {
      // JOIN with expenses to get spending totals per category for the year
      const startDate = new Date(year, 0, 1)
      const endDate = new Date(year + 1, 0, 1)

      const categoryList = await db
        .select({
          id: categories.id,
          name: categories.name,
          emoji: categories.emoji,
          expenseType: categories.expenseType,
          homeOfficeEligible: categories.homeOfficeEligible,
          isSystem: categories.isSystem,
          sortOrder: categories.sortOrder,
          isActive: categories.isActive,
          total: sql<number>`coalesce(sum(${expenses.amount}), 0)`.as('total'),
          count: sql<number>`count(${expenses.id})`.as('count'),
        })
        .from(categories)
        .leftJoin(
          expenses,
          and(
            eq(expenses.categoryId, categories.id),
            eq(expenses.tenantId, tenantId),
            sql`${expenses.date} >= ${startDate}`,
            sql`${expenses.date} < ${endDate}`
          )
        )
        .where(and(
          eq(categories.tenantId, tenantId),
          eq(categories.isActive, true)
        ))
        .groupBy(categories.id)
        .orderBy(asc(categories.sortOrder), asc(categories.name))

      // Also fetch tenant home office settings
      const [tenant] = await db
        .select({
          homeTotalSqft: tenants.homeTotalSqft,
          homeOfficeSqft: tenants.homeOfficeSqft,
        })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1)

      return res.status(200).json({
        categories: categoryList.map(c => ({
          ...c,
          total: Number(c.total),
          count: Number(c.count),
        })),
        homeOfficeSettings: {
          homeTotalSqft: tenant?.homeTotalSqft ?? null,
          homeOfficeSqft: tenant?.homeOfficeSqft ?? null,
          deductionPercent: (tenant?.homeTotalSqft && tenant?.homeOfficeSqft)
            ? Math.round((tenant.homeOfficeSqft / tenant.homeTotalSqft) * 10000) / 100
            : null,
        },
      })
    }

    // Simple fetch — no spending data (used by AddExpenseSheet, etc.)
    const categoryList = await db
      .select({
        id: categories.id,
        name: categories.name,
        emoji: categories.emoji,
        expenseType: categories.expenseType,
        homeOfficeEligible: categories.homeOfficeEligible,
        isSystem: categories.isSystem,
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

// ============================================
// POST — Create a new category
// ============================================
async function handlePost(req: VercelRequest, res: VercelResponse) {
  try {
    const auth = await authenticateAndGetTenant(req)
    if ('error' in auth) {
      return res.status(auth.status).json({ error: auth.error })
    }

    const { tenantId } = auth
    const { name, emoji, expenseType, homeOfficeEligible } = req.body

    // Validation
    const errors: string[] = []
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      errors.push('Name is required')
    }
    if (name && name.trim().length > 100) {
      errors.push('Name must be 100 characters or less')
    }
    if (expenseType && !['operating', 'cogs'].includes(expenseType)) {
      errors.push('Invalid expense type')
    }
    if (errors.length > 0) {
      return res.status(400).json({ error: 'Validation failed', details: errors })
    }

    // Check for duplicate name within this tenant
    const [existing] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(
        eq(categories.tenantId, tenantId),
        eq(categories.isActive, true),
        sql`lower(${categories.name}) = lower(${name.trim()})`
      ))
      .limit(1)

    if (existing) {
      return res.status(409).json({ error: 'A category with this name already exists' })
    }

    // Get next sort order
    const [maxSort] = await db
      .select({ max: sql<number>`coalesce(max(${categories.sortOrder}), 0)` })
      .from(categories)
      .where(eq(categories.tenantId, tenantId))

    const resolvedType = expenseType || 'operating'
    const resolvedEligible = homeOfficeEligible ?? false

    const [newCategory] = await db
      .insert(categories)
      .values({
        tenantId,
        name: name.trim(),
        emoji: emoji || '📁',
        expenseType: resolvedType,
        homeOfficeEligible: resolvedEligible,
        sortOrder: (Number(maxSort?.max) || 0) + 1,
      })
      .returning()

    return res.status(201).json({ category: newCategory })

  } catch (error) {
    console.error('Error creating category:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
