import type { VercelRequest, VercelResponse } from '@vercel/node'
import { db } from '../../src/db/index.js'
import { expenses, categories } from '../../src/db/schema.js'
import { eq, and, gte, lt } from 'drizzle-orm'
import { authenticateRequest } from '../_lib/auth.js'

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
    description: 'Expenses with home office deduction applied (partial deductibility based on sq ft percentage)',
    order: 3,
  },
}

// ===========================================
// Helper: Calculate deductible amount for an expense
// ===========================================
function getDeductibleAmount(expense: {
  amount: number
  isHomeOffice: boolean | null
  homeOfficePercent: number | null
}): number {
  if (expense.isHomeOffice && expense.homeOfficePercent != null) {
    return Math.round(expense.amount * expense.homeOfficePercent / 100)
  }
  return expense.amount
}

// ===========================================
// GET: Tax summary report
// ===========================================
async function handleGet(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  const auth = await authenticateRequest(req)
  if (!auth) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const { tenantId } = auth

  const year = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear()

  // Date range for SQL-level filtering
  const startDate = new Date(year, 0, 1)
  const endDate = new Date(year + 1, 0, 1)

  // Fetch expenses for this year only (SQL-level date filter)
  const yearExpenses = await db
    .select({
      id: expenses.id,
      amount: expenses.amount,
      date: expenses.date,
      categoryId: expenses.categoryId,
      expenseType: expenses.expenseType,
      vendor: expenses.vendor,
      isHomeOffice: expenses.isHomeOffice,
      homeOfficePercent: expenses.homeOfficePercent,
    })
    .from(expenses)
    .where(and(
      eq(expenses.tenantId, tenantId),
      gte(expenses.date, startDate),
      lt(expenses.date, endDate)
    ))

  // Fetch categories
  const tenantCategories = await db
    .select()
    .from(categories)
    .where(eq(categories.tenantId, tenantId))

  const categoryMap = new Map(tenantCategories.map((c) => [c.id, c]))

  // ---- Group by section ----
  const typeGroups = new Map<string, typeof yearExpenses>()

  for (const exp of yearExpenses) {
    let section: string
    if (exp.isHomeOffice) {
      section = 'home_office'
    } else {
      section = exp.expenseType || 'operating'
      if (section === 'home_office') {
        section = 'operating'
      }
    }

    if (!typeGroups.has(section)) {
      typeGroups.set(section, [])
    }
    typeGroups.get(section)!.push(exp)
  }

  // ---- Build type sections ----
  const totalSpent = yearExpenses.reduce((sum, e) => sum + e.amount, 0)
  const totalDeductible = yearExpenses.reduce((sum, e) => sum + getDeductibleAmount(e), 0)

  const sections = Object.entries(TYPE_CONFIG)
    .map(([typeKey, config]) => {
      const typeExpenses = typeGroups.get(typeKey) || []
      const typeTotal = typeExpenses.reduce((sum, e) => sum + e.amount, 0)
      const typeDeductible = typeExpenses.reduce((sum, e) => sum + getDeductibleAmount(e), 0)

      // Category breakdown within this type
      const catTotals = new Map<string, { amount: number; deductible: number; count: number }>()
      for (const exp of typeExpenses) {
        const catId = exp.categoryId || 'uncategorized'
        const existing = catTotals.get(catId) || { amount: 0, deductible: 0, count: 0 }
        existing.amount += exp.amount
        existing.deductible += getDeductibleAmount(exp)
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
            deductible: data.deductible,
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
        deductible: typeDeductible,
        count: typeExpenses.length,
        percentOfTotal: totalSpent > 0 ? Math.round((typeTotal / totalSpent) * 1000) / 10 : 0,
        categories: categoryBreakdown,
      }
    })
    .sort((a, b) => a.order - b.order)

  return res.status(200).json({
    year,
    totalSpent,
    totalDeductible,
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