import type { VercelRequest, VercelResponse } from '@vercel/node'
import { db } from '../../src/db/index.js'
import { expenses, categories, sessions, users, userTenantAccess, tenants } from '../../src/db/schema.js'
import { eq, and, desc } from 'drizzle-orm'

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
// GET: Fetch expenses with category breakdown
// ===========================================
async function handleGet(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  const auth = await authenticateRequest(req)
  if ('error' in auth) {
    return res.status(auth.status).json({ error: auth.error })
  }
  const { tenantId } = auth

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
      expenseType: expenses.expenseType,
      isHomeOffice: expenses.isHomeOffice,
      homeOfficePercent: expenses.homeOfficePercent,
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
}

// ===========================================
// POST: Create a new expense
// ===========================================
async function handlePost(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req)
  if ('error' in auth) {
    return res.status(auth.status).json({ error: auth.error })
  }
  const { user, tenantId } = auth

  // Parse request body
  const {
    amount,       // Required: number in cents
    date,         // Required: ISO date string
    categoryId,   // Required: UUID
    vendor,       // Optional: string
    description,  // Optional: string
    expenseType,  // Optional: 'cogs' | 'operating' | 'home_office' (defaults to 'operating')
    isHomeOffice, // Optional: boolean — true if user checked "Home Office Expense"
  } = req.body

  // If home office, snapshot the tenant's current deduction percentage
  let homeOfficePercent: number | null = null
  if (isHomeOffice) {
    const [tenant] = await db
      .select({
        homeTotalSqft: tenants.homeTotalSqft,
        homeOfficeSqft: tenants.homeOfficeSqft,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1)

    if (tenant?.homeTotalSqft && tenant?.homeOfficeSqft && tenant.homeTotalSqft > 0) {
      homeOfficePercent = Math.round((tenant.homeOfficeSqft / tenant.homeTotalSqft) * 100)
    }
  }

  // ===========================================
  // Validation
  // ===========================================
  const errors: string[] = []

  // Amount: required, must be positive integer
  if (amount === undefined || amount === null) {
    errors.push('Amount is required')
  } else if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
    errors.push('Amount must be a positive integer (in cents)')
  }

  // Date: required, must be valid
  if (!date) {
    errors.push('Date is required')
  } else {
    const parsedDate = new Date(date)
    if (isNaN(parsedDate.getTime())) {
      errors.push('Date must be a valid ISO date string')
    }
  }

  // Category: required, must exist and belong to tenant
  if (!categoryId) {
    errors.push('Category is required')
  } else {
    const [category] = await db
      .select()
      .from(categories)
      .where(and(
        eq(categories.id, categoryId),
        eq(categories.tenantId, tenantId)
      ))
      .limit(1)

    if (!category) {
      errors.push('Invalid category')
    }
  }

  // Expense type: optional, but must be valid if provided
  const validExpenseTypes = ['cogs', 'operating', 'home_office']
  if (expenseType && !validExpenseTypes.includes(expenseType)) {
    errors.push(`Expense type must be one of: ${validExpenseTypes.join(', ')}`)
  }

  // Return all validation errors at once
  if (errors.length > 0) {
    return res.status(400).json({ error: 'Validation failed', details: errors })
  }

  // ===========================================
  // Create the expense
  // ===========================================
  const [newExpense] = await db
    .insert(expenses)
    .values({
      tenantId,
      amount,
      date: new Date(date),
      categoryId,
      vendor: vendor?.trim() || null,
      description: description?.trim() || null,
      expenseType: expenseType || 'operating',
      isHomeOffice: isHomeOffice || false,
      homeOfficePercent,
      createdBy: user.id,
      updatedBy: user.id,
    })
    .returning()

  // Fetch the expense with category info to return
  const [expenseWithCategory] = await db
    .select({
      id: expenses.id,
      amount: expenses.amount,
      vendor: expenses.vendor,
      description: expenses.description,
      date: expenses.date,
      categoryId: expenses.categoryId,
      categoryName: categories.name,
      categoryEmoji: categories.emoji,
      expenseType: expenses.expenseType,
      isHomeOffice: expenses.isHomeOffice,
      homeOfficePercent: expenses.homeOfficePercent,
      receiptUrl: expenses.receiptUrl,
      createdAt: expenses.createdAt,
    })
    .from(expenses)
    .leftJoin(categories, eq(expenses.categoryId, categories.id))
    .where(eq(expenses.id, newExpense.id))
    .limit(1)

  return res.status(201).json({
    message: 'Expense created successfully',
    expense: expenseWithCategory,
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
    console.error('Error in expenses API:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}