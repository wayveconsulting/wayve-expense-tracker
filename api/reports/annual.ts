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
// GET: Annual summary report
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
    })
    .from(expenses)
    .where(eq(expenses.tenantId, tenantId))

  // Filter by year
  const yearExpenses = allExpenses.filter((e) => new Date(e.date).getFullYear() === year)

  // Fetch categories for this tenant
  const tenantCategories = await db
    .select()
    .from(categories)
    .where(eq(categories.tenantId, tenantId))

  const categoryMap = new Map(tenantCategories.map((c) => [c.id, c]))

  // ---- Monthly Spending ----
  const monthlyTotals = new Array(12).fill(0)
  const monthlyCounts = new Array(12).fill(0)
  for (const exp of yearExpenses) {
    const month = new Date(exp.date).getMonth()
    monthlyTotals[month] += exp.amount
    monthlyCounts[month] += 1
  }

  const monthlyBreakdown = monthlyTotals.map((total, i) => ({
    month: i + 1,
    label: new Date(year, i).toLocaleString('en-US', { month: 'short' }),
    labelFull: new Date(year, i).toLocaleString('en-US', { month: 'long' }),
    total,
    count: monthlyCounts[i],
  }))

  // ---- Category Breakdown ----
  const categoryTotals = new Map<string, { amount: number; count: number }>()
  for (const exp of yearExpenses) {
    const catId = exp.categoryId || 'uncategorized'
    const existing = categoryTotals.get(catId) || { amount: 0, count: 0 }
    existing.amount += exp.amount
    existing.count += 1
    categoryTotals.set(catId, existing)
  }

  const totalSpent = yearExpenses.reduce((sum, e) => sum + e.amount, 0)

  const categoryBreakdown = Array.from(categoryTotals.entries())
    .map(([catId, data]) => {
      const cat = categoryMap.get(catId)
      return {
        categoryId: catId,
        name: cat?.name || 'Uncategorized',
        emoji: cat?.emoji || '❓',
        amount: data.amount,
        count: data.count,
        percentage: totalSpent > 0 ? Math.round((data.amount / totalSpent) * 1000) / 10 : 0,
      }
    })
    .sort((a, b) => b.amount - a.amount)

  // ---- Top-line Summary ----
  const expenseCount = yearExpenses.length
  const activeMonths = monthlyCounts.filter((c) => c > 0).length
  const averagePerMonth = activeMonths > 0 ? Math.round(totalSpent / activeMonths) : 0
  const highestMonth = monthlyBreakdown.reduce(
    (max, m) => (m.total > max.total ? m : max),
    monthlyBreakdown[0]
  )
  const lowestActiveMonth = monthlyBreakdown
    .filter((m) => m.total > 0)
    .reduce(
      (min, m) => (m.total < min.total ? m : min),
      monthlyBreakdown.find((m) => m.total > 0) || monthlyBreakdown[0]
    )

  const topCategory = categoryBreakdown.length > 0 ? categoryBreakdown[0] : null

  return res.status(200).json({
    year,
    summary: {
      totalSpent,
      expenseCount,
      activeMonths,
      averagePerMonth,
      highestMonth: highestMonth ? { label: highestMonth.labelFull, total: highestMonth.total } : null,
      lowestMonth: lowestActiveMonth ? { label: lowestActiveMonth.labelFull, total: lowestActiveMonth.total } : null,
      topCategory: topCategory ? { name: topCategory.name, emoji: topCategory.emoji, amount: topCategory.amount, percentage: topCategory.percentage } : null,
    },
    monthlyBreakdown,
    categoryBreakdown,
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
    console.error('Error in annual report API:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
