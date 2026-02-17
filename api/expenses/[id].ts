import type { VercelRequest, VercelResponse } from '@vercel/node'
import { db } from '../../src/db/index.js'
import { expenses, categories, tenants } from '../../src/db/schema.js'
import { eq, and } from 'drizzle-orm'
import { authenticateRequest } from '../_lib/auth.js'

// ===========================================
// GET: Fetch single expense by ID
// ===========================================
async function handleGet(req: VercelRequest, res: VercelResponse, expenseId: string) {
  res.setHeader('Cache-Control', 'no-store')
  const auth = await authenticateRequest(req)
  if (!auth) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const { tenantId } = auth

  const [expense] = await db
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
      extractedText: expenses.extractedText,
      createdAt: expenses.createdAt,
      updatedAt: expenses.updatedAt,
    })
    .from(expenses)
    .leftJoin(categories, eq(expenses.categoryId, categories.id))
    .where(and(
      eq(expenses.id, expenseId),
      eq(expenses.tenantId, tenantId)
    ))
    .limit(1)

  if (!expense) {
    return res.status(404).json({ error: 'Expense not found' })
  }

  return res.status(200).json({ expense })
}

// ===========================================
// PUT: Update expense
// ===========================================
async function handlePut(req: VercelRequest, res: VercelResponse, expenseId: string) {
  const auth = await authenticateRequest(req)
  if (!auth) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const { user, tenantId } = auth

  // Verify expense exists and belongs to tenant
  const [existingExpense] = await db
    .select()
    .from(expenses)
    .where(and(
      eq(expenses.id, expenseId),
      eq(expenses.tenantId, tenantId)
    ))
    .limit(1)

  if (!existingExpense) {
    return res.status(404).json({ error: 'Expense not found' })
  }

  const {
    amount,
    date,
    categoryId,
    vendor,
    description,
    expenseType,
    isHomeOffice,
  } = req.body

  // Validation
  const errors: string[] = []

  if (amount !== undefined) {
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
      errors.push('Amount must be a positive integer (in cents)')
    }
  }

  if (date !== undefined) {
    const parsedDate = new Date(date)
    if (isNaN(parsedDate.getTime())) {
      errors.push('Date must be a valid ISO date string')
    }
  }

  if (categoryId !== undefined) {
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

  const validExpenseTypes = ['cogs', 'operating', 'home_office']
  if (expenseType !== undefined && !validExpenseTypes.includes(expenseType)) {
    errors.push(`Expense type must be one of: ${validExpenseTypes.join(', ')}`)
  }

  if (errors.length > 0) {
    return res.status(400).json({ error: 'Validation failed', details: errors })
  }

  // Build update object with only provided fields
  const updateData: Record<string, unknown> = {
    updatedBy: user.id,
    updatedAt: new Date(),
  }

  if (amount !== undefined) updateData.amount = amount
  if (date !== undefined) updateData.date = new Date(date)
  if (categoryId !== undefined) updateData.categoryId = categoryId
  if (vendor !== undefined) updateData.vendor = vendor?.trim() || null
  if (description !== undefined) updateData.description = description?.trim() || null
  if (expenseType !== undefined) updateData.expenseType = expenseType
  if (isHomeOffice !== undefined) {
    updateData.isHomeOffice = isHomeOffice
    if (isHomeOffice) {
      // Snapshot current deduction percentage from tenant
      const [tenant] = await db
        .select({
          homeTotalSqft: tenants.homeTotalSqft,
          homeOfficeSqft: tenants.homeOfficeSqft,
        })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1)

      if (tenant?.homeTotalSqft && tenant?.homeOfficeSqft && tenant.homeTotalSqft > 0) {
        updateData.homeOfficePercent = Math.round((tenant.homeOfficeSqft / tenant.homeTotalSqft) * 100)
      }
    } else {
      updateData.homeOfficePercent = null
    }
  }

  // Update the expense
  const [updatedExpense] = await db
    .update(expenses)
    .set(updateData)
    .where(eq(expenses.id, expenseId))
    .returning()

  // Fetch with category info
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
      updatedAt: expenses.updatedAt,
    })
    .from(expenses)
    .leftJoin(categories, eq(expenses.categoryId, categories.id))
    .where(eq(expenses.id, updatedExpense.id))
    .limit(1)

  return res.status(200).json({
    message: 'Expense updated successfully',
    expense: expenseWithCategory,
  })
}

// ===========================================
// DELETE: Delete expense
// ===========================================
async function handleDelete(req: VercelRequest, res: VercelResponse, expenseId: string) {
  const auth = await authenticateRequest(req)
  if (!auth) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const { tenantId } = auth

  // Verify expense exists and belongs to tenant
  const [existingExpense] = await db
    .select()
    .from(expenses)
    .where(and(
      eq(expenses.id, expenseId),
      eq(expenses.tenantId, tenantId)
    ))
    .limit(1)

  if (!existingExpense) {
    return res.status(404).json({ error: 'Expense not found' })
  }

  // Delete the expense
  await db
    .delete(expenses)
    .where(eq(expenses.id, expenseId))

  return res.status(200).json({
    message: 'Expense deleted successfully',
    deletedId: expenseId,
  })
}

// ===========================================
// Main handler: Route by method
// ===========================================
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const expenseId = req.query.id as string

  if (!expenseId) {
    return res.status(400).json({ error: 'Expense ID is required' })
  }

  try {
    switch (req.method) {
      case 'GET':
        return handleGet(req, res, expenseId)
      case 'PUT':
        return handlePut(req, res, expenseId)
      case 'DELETE':
        return handleDelete(req, res, expenseId)
      default:
        return res.status(405).json({ error: 'Method not allowed' })
    }
  } catch (error) {
    console.error('Error in expense API:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
