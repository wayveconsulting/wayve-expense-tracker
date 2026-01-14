import type { VercelRequest, VercelResponse } from '@vercel/node'
import { db } from '../../src/db/index.js'
import { expenses, categories, sessions, users, userTenantAccess, tenants } from '../../src/db/schema.js'
import { eq, and, gte, lte, desc } from 'drizzle-orm'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    // Auth check
    const sessionToken = req.cookies.session
    if (!sessionToken) {
      return res.status(401).json({ error: 'Not authenticated' })
    }

    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.token, sessionToken))
      .limit(1)

    if (!session || new Date(session.expiresAt) < new Date()) {
      return res.status(401).json({ error: 'Session expired' })
    }

    // Get tenant from query param
    const tenantSubdomain = req.query.tenant as string
    if (!tenantSubdomain) {
      return res.status(400).json({ error: 'Tenant required' })
    }

    // Look up tenant
    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.subdomain, tenantSubdomain))
      .limit(1)

    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' })
    }

    // Verify user has access to this tenant
    const [access] = await db
      .select()
      .from(userTenantAccess)
      .where(
        and(
          eq(userTenantAccess.userId, session.userId),
          eq(userTenantAccess.tenantId, tenant.id)
        )
      )
      .limit(1)

    // Also check if super admin
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1)

    if (!access && !user?.isSuperAdmin) {
      return res.status(403).json({ error: 'Access denied' })
    }

    // Parse date filters
    const startDate = req.query.startDate as string | undefined
    const endDate = req.query.endDate as string | undefined

    // Build query conditions
    const conditions = [eq(expenses.tenantId, tenant.id)]
    
    if (startDate) {
      conditions.push(gte(expenses.date, new Date(startDate)))
    }
    if (endDate) {
      // Add one day to include the end date fully
      const endDatePlusOne = new Date(endDate)
      endDatePlusOne.setDate(endDatePlusOne.getDate() + 1)
      conditions.push(lte(expenses.date, endDatePlusOne))
    }

    // Fetch expenses with categories
    const expenseData = await db
      .select({
        id: expenses.id,
        date: expenses.date,
        amount: expenses.amount,
        vendor: expenses.vendor,
        description: expenses.description,
        expenseType: expenses.expenseType,
        categoryName: categories.name,
        createdAt: expenses.createdAt,
      })
      .from(expenses)
      .leftJoin(categories, eq(expenses.categoryId, categories.id))
      .where(and(...conditions))
      .orderBy(desc(expenses.date))

    // Generate CSV
    const csvHeaders = [
      'Date',
      'Vendor',
      'Description',
      'Category',
      'Expense Type',
      'Amount',
    ]

    const csvRows = expenseData.map(expense => [
      new Date(expense.date).toISOString().split('T')[0],
      escapeCsvField(expense.vendor || ''),
      escapeCsvField(expense.description || ''),
      escapeCsvField(expense.categoryName || 'Uncategorized'),
      expense.expenseType || 'operating',
      (expense.amount / 100).toFixed(2),
    ])

    const csvContent = [
      csvHeaders.join(','),
      ...csvRows.map(row => row.join(','))
    ].join('\n')

    // Generate filename
    const dateRange = startDate && endDate 
      ? `_${startDate}_to_${endDate}`
      : startDate 
      ? `_from_${startDate}`
      : endDate
      ? `_to_${endDate}`
      : `_${new Date().getFullYear()}`
    
    const filename = `expenses${dateRange}.csv`

    // Send CSV response
    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    return res.status(200).send(csvContent)

  } catch (error) {
    console.error('Export error:', error)
    return res.status(500).json({ error: 'Failed to export expenses' })
  }
}

// Helper to escape CSV fields
function escapeCsvField(field: string): string {
  if (field.includes(',') || field.includes('"') || field.includes('\n')) {
    return `"${field.replace(/"/g, '""')}"`
  }
  return field
}