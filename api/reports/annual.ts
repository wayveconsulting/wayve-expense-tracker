import type { VercelRequest, VercelResponse } from '@vercel/node'
import { db } from '../../src/db/index.js'
import { expenses, categories } from '../../src/db/schema.js'
import { eq, and, gte, lt } from 'drizzle-orm'
import { authenticateRequest } from '../_lib/auth.js'

// ===========================================
// GET: Annual summary report
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
      isHomeOffice: expenses.isHomeOffice,
      homeOfficePercent: expenses.homeOfficePercent,
    })
    .from(expenses)
    .where(and(
      eq(expenses.tenantId, tenantId),
      gte(expenses.date, startDate),
      lt(expenses.date, endDate)
    ))

  // Fetch categories for this tenant
  const tenantCategories = await db
    .select()
    .from(categories)
    .where(eq(categories.tenantId, tenantId))

  const categoryMap = new Map(tenantCategories.map((c) => [c.id, c]))

  // ---- Monthly Spending ----
  // Helper: get effective (deductible) amount for an expense
  function getEffectiveAmount(e: { amount: number; isHomeOffice?: boolean | null; homeOfficePercent?: number | null }): number {
    if (e.isHomeOffice && e.homeOfficePercent) {
      return Math.round(e.amount * e.homeOfficePercent / 100)
    }
    return e.amount
  }

  const monthlyTotals = new Array(12).fill(0)
  const monthlyCounts = new Array(12).fill(0)
  for (const exp of yearExpenses) {
    const month = new Date(exp.date).getMonth()
    monthlyTotals[month] += getEffectiveAmount(exp)
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
    existing.amount += getEffectiveAmount(exp)
    existing.count += 1
    categoryTotals.set(catId, existing)
  }

  const totalSpent = yearExpenses.reduce((sum, e) => sum + getEffectiveAmount(e), 0)
  const totalDeductible = yearExpenses.reduce((sum, e) => {
    if (e.isHomeOffice && e.homeOfficePercent) {
      return sum + Math.round(e.amount * (e.homeOfficePercent / 100))
    }
    return sum + e.amount
  }, 0)

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
      totalDeductible,
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