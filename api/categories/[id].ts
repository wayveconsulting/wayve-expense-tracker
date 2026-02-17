import type { VercelRequest, VercelResponse } from '@vercel/node'
import { db } from '../../src/db/index.js'
import { categories, expenses } from '../../src/db/schema.js'
import { eq, and, sql } from 'drizzle-orm'
import { authenticateRequest } from '../_lib/auth.js'

// ============================================
// MAIN HANDLER
// ============================================
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')

  const { id } = req.query
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Missing category ID' })
  }

  if (req.method === 'PUT') {
    return handlePut(req, res, id)
  } else if (req.method === 'DELETE') {
    return handleDelete(req, res, id)
  } else {
    return res.status(405).json({ error: 'Method not allowed' })
  }
}

// ============================================
// PUT — Update a category
// ============================================
async function handlePut(req: VercelRequest, res: VercelResponse, categoryId: string) {
  try {
    const auth = await authenticateRequest(req)
    if (!auth) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { tenantId } = auth

    // Verify category exists and belongs to this tenant
    const [existing] = await db
      .select()
      .from(categories)
      .where(and(
        eq(categories.id, categoryId),
        eq(categories.tenantId, tenantId)
      ))
      .limit(1)

    if (!existing) {
      return res.status(404).json({ error: 'Category not found' })
    }

    const { name, emoji, expenseType, homeOfficeEligible } = req.body

    // Validation
    const errors: string[] = []
    if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
      errors.push('Name cannot be empty')
    }
    if (name && name.trim().length > 100) {
      errors.push('Name must be 100 characters or less')
    }
    if (expenseType !== undefined && !['operating', 'cogs'].includes(expenseType)) {
      errors.push('Invalid expense type')
    }
    // System categories can have name/emoji edited but not deleted
    // (No restriction on editing system categories for now — just deletion)
    if (errors.length > 0) {
      return res.status(400).json({ error: 'Validation failed', details: errors })
    }

    // Check for duplicate name (excluding self)
    if (name && name.trim().toLowerCase() !== existing.name.toLowerCase()) {
      const [duplicate] = await db
        .select({ id: categories.id })
        .from(categories)
        .where(and(
          eq(categories.tenantId, tenantId),
          eq(categories.isActive, true),
          sql`lower(${categories.name}) = lower(${name.trim()})`,
          sql`${categories.id} != ${categoryId}`
        ))
        .limit(1)

      if (duplicate) {
        return res.status(409).json({ error: 'A category with this name already exists' })
      }
    }

    // Build update object — only include fields that were sent
    const updates: Record<string, unknown> = {
      updatedAt: new Date(),
    }

    if (name !== undefined) updates.name = name.trim()
    if (emoji !== undefined) updates.emoji = emoji
    if (expenseType !== undefined) updates.expenseType = expenseType
    if (homeOfficeEligible !== undefined) updates.homeOfficeEligible = homeOfficeEligible

    const [updated] = await db
      .update(categories)
      .set(updates)
      .where(eq(categories.id, categoryId))
      .returning()

    return res.status(200).json({ category: updated })

  } catch (error) {
    console.error('Error updating category:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

// ============================================
// DELETE — Soft-delete category, reassign expenses
// ============================================
async function handleDelete(req: VercelRequest, res: VercelResponse, categoryId: string) {
  try {
    const auth = await authenticateRequest(req)
    if (!auth) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { tenantId } = auth

    // Verify category exists and belongs to this tenant
    const [existing] = await db
      .select()
      .from(categories)
      .where(and(
        eq(categories.id, categoryId),
        eq(categories.tenantId, tenantId),
        eq(categories.isActive, true)
      ))
      .limit(1)

    if (!existing) {
      return res.status(404).json({ error: 'Category not found' })
    }

    // System categories cannot be deleted
    if (existing.isSystem) {
      return res.status(403).json({ error: 'System categories cannot be deleted' })
    }

    // Determine reassignment target
    const { reassignTo } = req.body || {}

    let targetCategoryId: string

    if (reassignTo) {
      // Verify the target category exists and is active
      const [target] = await db
        .select({ id: categories.id })
        .from(categories)
        .where(and(
          eq(categories.id, reassignTo),
          eq(categories.tenantId, tenantId),
          eq(categories.isActive, true)
        ))
        .limit(1)

      if (!target) {
        return res.status(400).json({ error: 'Reassignment target category not found' })
      }
      targetCategoryId = target.id
    } else {
      // Default: reassign to Uncategorized
      const [uncategorized] = await db
        .select({ id: categories.id })
        .from(categories)
        .where(and(
          eq(categories.tenantId, tenantId),
          eq(categories.isSystem, true),
          eq(categories.isActive, true)
        ))
        .limit(1)

      if (!uncategorized) {
        return res.status(500).json({ error: 'Uncategorized category not found — contact support' })
      }
      targetCategoryId = uncategorized.id
    }

    // Count affected expenses
    const [affectedResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(expenses)
      .where(and(
        eq(expenses.categoryId, categoryId),
        eq(expenses.tenantId, tenantId)
      ))

    const affectedCount = Number(affectedResult?.count || 0)

    // Reassign expenses to target category
    if (affectedCount > 0) {
      await db
        .update(expenses)
        .set({
          categoryId: targetCategoryId,
          updatedAt: new Date(),
        })
        .where(and(
          eq(expenses.categoryId, categoryId),
          eq(expenses.tenantId, tenantId)
        ))
    }

    // Soft-delete the category
    await db
      .update(categories)
      .set({
        isActive: false,
        updatedAt: new Date(),
      })
      .where(eq(categories.id, categoryId))

    return res.status(200).json({
      success: true,
      reassignedExpenses: affectedCount,
      reassignedTo: targetCategoryId,
    })

  } catch (error) {
    console.error('Error deleting category:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
