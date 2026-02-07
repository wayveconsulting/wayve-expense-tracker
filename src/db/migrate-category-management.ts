/**
 * Migration: Add Category Management + Home Office fields
 * 
 * Run this AFTER `npx drizzle-kit push` to sync the schema.
 * Then run: DATABASE_URL='...' npx tsx src/db/migrate-category-management.ts
 * 
 * This script:
 * 1. Adds "Uncategorized" system category to all tenants that don't have one
 * 2. Sets existing categories to have expenseType = 'operating' and homeOfficeEligible = false
 *    (the schema defaults handle this, but this makes it explicit for existing rows)
 */

import { db } from './index.js'
import { tenants, categories } from './schema.js'
import { eq, and, sql } from 'drizzle-orm'

async function migrate() {
  console.log('Starting Category Management migration...\n')

  // 1. Get all tenants
  const allTenants = await db
    .select({ id: tenants.id, name: tenants.name })
    .from(tenants)

  console.log(`Found ${allTenants.length} tenant(s)\n`)

  for (const tenant of allTenants) {
    // Check if tenant already has a system Uncategorized category
    const [existing] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(
        eq(categories.tenantId, tenant.id),
        eq(categories.isSystem, true)
      ))
      .limit(1)

    if (existing) {
      console.log(`  ✓ ${tenant.name} — already has system category`)
      continue
    }

    // Create Uncategorized system category
    await db.insert(categories).values({
      tenantId: tenant.id,
      name: 'Uncategorized',
      emoji: '📂',
      expenseType: 'operating',
      homeOfficeEligible: false,
      isSystem: true,
      sortOrder: 9999, // Always last
    })

    console.log(`  ✓ ${tenant.name} — created "Uncategorized" system category`)
  }

  // 2. Ensure all existing categories without expenseType get the default
  // (This is defensive — the schema default should handle it, but belt + suspenders)
  await db.execute(sql`
    UPDATE categories 
    SET expense_type = 'operating' 
    WHERE expense_type IS NULL
  `)
  console.log('\n✓ Backfilled expense_type defaults')

  console.log('\n✅ Migration complete!')
  process.exit(0)
}

migrate().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
