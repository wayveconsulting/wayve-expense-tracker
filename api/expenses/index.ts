import type { VercelRequest, VercelResponse } from '@vercel/node'
import { db } from '../../src/db/index.js'
import { expenses, categories, sessions, users, userTenantAccess } from '../../src/db/schema.js'
import { eq, and, desc } from 'drizzle-orm'

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

    // Determine tenant from query param or user's access
    let tenantId: string | null = null
    const tenantSubdomain = req.query.tenant as string | undefined

    if (tenantSubdomain) {
      // Verify user has access to this tenant
      const access = await db
        .select({ tenantId: userTenantAccess.tenantId })
        .from(userTenantAccess)
        .innerJoin(
          db.select().from(require('../../src/db/schema.js').tenants).as('t'),
          eq(userTenantAccess.tenantId, require('../../src/db/schema.js').tenants.id)
        )
        .where(eq(userTenantAccess.userId, user.id))
        .limit(1)
      
      // Simpler approach - just get tenant by subdomain and verify access
      const { tenants } = require('../../src/db/schema.js')
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
      return res.status(400).json({ error: 'No tenant context' })
    }

    // Get query params for filtering
    const year = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear()
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 100

    // Fetch expenses with category info
    const expenseList = await db
      .select({
        id: expenses.id,
        amount: expenses.amount,
        vendor: expenses.vendor,
        description: expenses.description,
        date: expenses.date,
        categoryId: expenses.categoryId,
        categoryName: categories.name,
        categoryEmoji: categories.emoji,
        receiptUrl: expenses.receiptUrl,
        createdAt: expenses.createdAt,
      })
      .from(expenses)
      .leftJoin(categories, eq(expenses.categoryId, categories.id))
      .where(eq(expenses.tenantId, tenantId))
      .orderBy(desc(expenses.date))
      .limit(limit)

    // Filter by year in JS (Drizzle date filtering can be tricky)
    const filteredExpenses = expenseList.filter(e => {
      const expenseYear = new Date(e.date).getFullYear()
      return expenseYear === year
    })

    // Calculate summary stats
    const totalAmount = filteredExpenses.reduce((sum, e) => sum + e.amount, 0)
    const expenseCount = filteredExpenses.length
    const averageAmount = expenseCount > 0 ? Math.round(totalAmount / expenseCount) : 0

    // Category breakdown
    const categoryTotals = new Map<string, { name: string; emoji: string | null; total: number; count: number }>()
    for (const expense of filteredExpenses) {
      const key = expense.categoryId || 'uncategorized'
      const existing = categoryTotals.get(key)
      if (existing) {
        existing.total += expense.amount
        existing.count += 1
      } else {
        categoryTotals.set(key, {
          name: expense.categoryName || 'Uncategorized',
          emoji: expense.categoryEmoji,
          total: expense.amount,
          count: 1,
        })
      }
    }

    const categoryBreakdown = Array.from(categoryTotals.values())
      .sort((a, b) => b.total - a.total)

    return res.status(200).json({
      expenses: filteredExpenses,
      summary: {
        totalAmount,
        expenseCount,
        averageAmount,
        year,
      },
      categoryBreakdown,
    })

  } catch (error) {
    console.error('Error fetching expenses:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}