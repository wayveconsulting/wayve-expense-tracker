import type { VercelRequest, VercelResponse } from '@vercel/node'
import { db } from '../../src/db/index.js'
import { expenses, categories, sessions, users, userTenantAccess, tenants } from '../../src/db/schema.js'
import { eq, and } from 'drizzle-orm'

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
// Type labels and ordering
// ===========================================
const TYPE_CONFIG: Record<string, { label: string; description: string; order: number }> = {
  cogs: {
    label: 'Cost of Goods Sold (COGS)',
    description: 'Direct costs of producing goods or services sold',
    order: 1,
  },
  operating: {
    label: 'Operating Expenses',
    description: 'Day-to-day business expenses not directly tied to production',
    order: 2,
  },
  home_office: {
    label: 'Home Office Expenses',
    description: 'Expenses related to business use of your home',
    order: 3,
  },
}

// ===========================================
// GET: Tax summary report
// ===========================================
async function handleGet(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req)
  if ('error' in auth) {
    return res.status(auth.status).json({ error: auth.error })
  }
  const { tenantId } = auth

  const year = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear()

  // Fetch all expenses for tenant
  const allExpenses = await db
    .select({
      id: expenses.id,
      amount: expenses.amount,
      date: expenses.date,
      categoryId: expenses.categoryId,
      expenseType: expenses.expenseType,
      vendor: expenses.vendor,
    })
    .from(expenses)
    .where(eq(expenses.tenantId, tenantId))

  // Filter by year
  const yearExpenses = allExpenses.filter((e) => new Date(e.date).getFullYear() === year)

  // Fetch categories
  const tenantCategories = await db
    .select()
    .from(categories)
    .where(eq(categories.tenantId, tenantId))

  const categoryMap = new Map(tenantCategories.map((c) => [c.id, c]))

  // ---- Group by expense type ----
  const typeGroups = new Map<string, typeof yearExpenses>()

  for (const exp of yearExpenses) {
    const type = exp.expenseType || 'operating'
    if (!typeGroups.has(type)) {
      typeGroups.set(type, [])
    }
    typeGroups.get(type)!.push(exp)
  }

  // ---- Build type sections ----
  const totalSpent = yearExpenses.reduce((sum, e) => sum + e.amount, 0)

  const sections = Object.entries(TYPE_CONFIG)
    .map(([typeKey, config]) => {
      const typeExpenses = typeGroups.get(typeKey) || []
      const typeTotal = typeExpenses.reduce((sum, e) => sum + e.amount, 0)

      // Category breakdown within this type
      const catTotals = new Map<string, { amount: number; count: number }>()
      for (const exp of typeExpenses) {
        const catId = exp.categoryId || 'uncategorized'
        const existing = catTotals.get(catId) || { amount: 0, count: 0 }
        existing.amount += exp.amount
        existing.count += 1
        catTotals.set(catId, existing)
      }

      const categoryBreakdown = Array.from(catTotals.entries())
        .map(([catId, data]) => {
          const cat = categoryMap.get(catId)
          return {
            categoryId: catId,
            name: cat?.name || 'Uncategorized',
            emoji: cat?.emoji || '❓',
            amount: data.amount,
            count: data.count,
            percentOfType: typeTotal > 0 ? Math.round((data.amount / typeTotal) * 1000) / 10 : 0,
          }
        })
        .sort((a, b) => b.amount - a.amount)

      return {
        type: typeKey,
        label: config.label,
        description: config.description,
        order: config.order,
        total: typeTotal,
        count: typeExpenses.length,
        percentOfTotal: totalSpent > 0 ? Math.round((typeTotal / totalSpent) * 1000) / 10 : 0,
        categories: categoryBreakdown,
      }
    })
    .sort((a, b) => a.order - b.order)

  return res.status(200).json({
    year,
    totalSpent,
    expenseCount: yearExpenses.length,
    sections,
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
    console.error('Error in tax summary API:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
