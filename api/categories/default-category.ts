import type { VercelRequest, VercelResponse } from '@vercel/node'
import { db } from '../../src/db/index.js'
import { tenants, categories } from '../../src/db/schema.js'
import { eq, and } from 'drizzle-orm'
import { authenticateRequest } from '../_lib/auth.js'

// ============================================
// MAIN HANDLER — PUT only
// ============================================
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const auth = await authenticateRequest(req)
    if (!auth) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { tenantId } = auth
    const { defaultCategoryId } = req.body

    // Allow null to clear the default
    if (defaultCategoryId !== null && defaultCategoryId !== undefined) {
      // Validate that the category belongs to this tenant
      const [category] = await db
        .select({ id: categories.id })
        .from(categories)
        .where(and(
          eq(categories.id, defaultCategoryId),
          eq(categories.tenantId, tenantId)
        ))
        .limit(1)

      if (!category) {
        return res.status(400).json({ error: 'Category not found' })
      }
    }

    await db.update(tenants)
      .set({ defaultCategoryId: defaultCategoryId || null })
      .where(eq(tenants.id, tenantId))

    return res.status(200).json({ defaultCategoryId: defaultCategoryId || null })

  } catch (err) {
    console.error('Error updating default category:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
