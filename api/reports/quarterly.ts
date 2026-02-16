import type { VercelRequest, VercelResponse } from '@vercel/node'
import { db } from '../../src/db/index.js'
import { expenses, categories, sessions, users, userTenantAccess, tenants } from '../../src/db/schema.js'
import { eq, and, desc, gte, lt } from 'drizzle-orm'

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
// Helper: Get quarter (1-4) from a date
// ===========================================
function getQuarter(date: Date): number {
  return Math.floor(date.getMonth() / 3) + 1
}

// ===========================================
// GET: Quarterly breakdown by category
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
  const startDate = new Date(year, 0, 1)   // Jan 1 of year
  const endDate = new Date(year + 1, 0, 1) // Jan 1 of next year

  // Fetch expenses for this year only (SQL-level date filter)
  const filtered = await db
    .select({
      amount: expenses.amount,
      date: expenses.date,
      categoryId: expenses.categoryId,
      categoryName: categories.name,
      categoryEmoji: categories.emoji,
    })
    .from(expenses)
    .leftJoin(categories, eq(expenses.categoryId, categories.id))
    .where(and(
      eq(expenses.tenantId, tenantId),
      gte(expenses.date, startDate),
      lt(expenses.date, endDate)
    ))
    .orderBy(desc(expenses.date))

  // Build category × quarter matrix
  type QuarterlyRow = {
    categoryId: string
    name: string
    emoji: string | null
    q1: number
    q2: number
    q3: number
    q4: number
    total: number
  }

  const matrix = new Map<string, QuarterlyRow>()

  for (const expense of filtered) {
    const key = expense.categoryId || 'uncategorized'
    const quarter = getQuarter(new Date(expense.date))

    if (!matrix.has(key)) {
      matrix.set(key, {
        categoryId: key,
        name: expense.categoryName || 'Uncategorized',
        emoji: expense.categoryEmoji,
        q1: 0,
        q2: 0,
        q3: 0,
        q4: 0,
        total: 0,
      })
    }

    const row = matrix.get(key)!
    const qKey = `q${quarter}` as 'q1' | 'q2' | 'q3' | 'q4'
    row[qKey] += expense.amount
    row.total += expense.amount
  }

  // Sort by total descending
  const rows = Array.from(matrix.values()).sort((a, b) => b.total - a.total)

  // Calculate column totals
  const totals = {
    q1: rows.reduce((sum, r) => sum + r.q1, 0),
    q2: rows.reduce((sum, r) => sum + r.q2, 0),
    q3: rows.reduce((sum, r) => sum + r.q3, 0),
    q4: rows.reduce((sum, r) => sum + r.q4, 0),
    total: rows.reduce((sum, r) => sum + r.total, 0),
  }

  return res.status(200).json({
    year,
    rows,
    totals,
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
    console.error('Error in quarterly report API:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}