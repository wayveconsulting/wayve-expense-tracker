/**
 * delete-tenant.ts — Cascade-delete a tenant and ALL associated data
 * 
 * Usage:
 *   npx tsx scripts/delete-tenant.ts <subdomain>
 *   npx tsx scripts/delete-tenant.ts <subdomain> --force   (skip confirmation)
 * 
 * Requires DATABASE_URL in .env or environment.
 * 
 * This script deletes in FK-safe order:
 *   1. Leaf tables (rate limits, policies, invites, saved locations, vendor mappings, recurring, sessions)
 *   2. Expense attachments (FK → expenses)
 *   3. Expenses (FK → categories)
 *   4. Categories
 *   5. User tenant access records
 *   6. Users (only those whose primary tenant is this one AND who have no other tenant access)
 *   7. The tenant record itself
 * 
 * NOTE: Vercel Blob files (receipt images) under the tenant's path prefix are NOT deleted.
 *       Clean those up manually from the Vercel Blob dashboard if needed.
 */

import 'dotenv/config'
import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'
import { eq, and, notInArray, sql } from 'drizzle-orm'
import {
  tenants,
  users,
  userTenantAccess,
  categories,
  expenses,
  expenseAttachments,
  mileageTrips,
  savedLocations,
  vendorCategoryMappings,
  recurringExpenses,
  sessions,
  accountantInvites,
  invites,
  expensePolicies,
  rateLimitUsage,
} from '../src/db/schema.js'

// ============================================
// SETUP
// ============================================
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not set. Add it to .env or export it.')
  process.exit(1)
}

const client = neon(DATABASE_URL)
const db = drizzle(client)

const subdomain = process.argv[2]
const forceFlag = process.argv.includes('--force')

if (!subdomain) {
  console.error('❌ Usage: npx tsx scripts/delete-tenant.ts <subdomain> [--force]')
  console.error('   Example: npx tsx scripts/delete-tenant.ts izrgrooming')
  process.exit(1)
}

// ============================================
// MAIN
// ============================================
async function main() {
  // Step 0: Find the tenant
  const [tenant] = await db
    .select({ id: tenants.id, name: tenants.name, subdomain: tenants.subdomain })
    .from(tenants)
    .where(eq(tenants.subdomain, subdomain))
    .limit(1)

  if (!tenant) {
    console.error(`❌ No tenant found with subdomain "${subdomain}"`)
    process.exit(1)
  }

  const tenantId = tenant.id
  console.log(`\n🔍 Found tenant:`)
  console.log(`   Name:      ${tenant.name}`)
  console.log(`   Subdomain: ${tenant.subdomain}`)
  console.log(`   ID:        ${tenantId}`)

  // Step 0b: Count what we're about to delete
  const counts = await getCounts(tenantId)
  console.log(`\n📊 Data to be deleted:`)
  for (const [table, count] of Object.entries(counts)) {
    if (count > 0) {
      console.log(`   ${table}: ${count}`)
    }
  }

  const totalRows = Object.values(counts).reduce((sum, n) => sum + n, 0)
  if (totalRows === 0) {
    console.log(`   (no child records — only the tenant row itself)`)
  }

  // Step 0c: Confirmation
  if (!forceFlag) {
    console.log(`\n⚠️  This will permanently delete tenant "${tenant.name}" (${subdomain}) and ALL associated data.`)
    console.log(`   This cannot be undone.\n`)

    const readline = await import('readline')
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const answer = await new Promise<string>((resolve) => {
      rl.question(`   Type the subdomain "${subdomain}" to confirm: `, resolve)
    })
    rl.close()

    if (answer.trim() !== subdomain) {
      console.log('\n❌ Confirmation failed. Aborting.')
      process.exit(1)
    }
  }

  console.log(`\n🗑️  Deleting...`)

  // Step 1: Leaf tables (no other tables reference these)
  const step1 = [
    { name: 'rate_limit_usage', fn: () => db.delete(rateLimitUsage).where(eq(rateLimitUsage.tenantId, tenantId)) },
    { name: 'expense_policies', fn: () => db.delete(expensePolicies).where(eq(expensePolicies.tenantId, tenantId)) },
    { name: 'accountant_invites', fn: () => db.delete(accountantInvites).where(eq(accountantInvites.tenantId, tenantId)) },
    { name: 'invites', fn: () => db.delete(invites).where(eq(invites.tenantId, tenantId)) },
    { name: 'saved_locations', fn: () => db.delete(savedLocations).where(eq(savedLocations.tenantId, tenantId)) },
    { name: 'vendor_category_mappings', fn: () => db.delete(vendorCategoryMappings).where(eq(vendorCategoryMappings.tenantId, tenantId)) },
    { name: 'recurring_expenses', fn: () => db.delete(recurringExpenses).where(eq(recurringExpenses.tenantId, tenantId)) },
    { name: 'sessions', fn: () => db.delete(sessions).where(eq(sessions.tenantId, tenantId)) },
    { name: 'mileage_trips', fn: () => db.delete(mileageTrips).where(eq(mileageTrips.tenantId, tenantId)) },
  ]

  for (const step of step1) {
    await step.fn()
    if (counts[step.name]! > 0) console.log(`   ✓ ${step.name}`)
  }

  // Step 2: Attachments (FK → expenses)
  await db.delete(expenseAttachments).where(eq(expenseAttachments.tenantId, tenantId))
  if (counts.expense_attachments > 0) console.log(`   ✓ expense_attachments`)

  // Step 3: Expenses (FK → categories)
  await db.delete(expenses).where(eq(expenses.tenantId, tenantId))
  if (counts.expenses > 0) console.log(`   ✓ expenses`)

  // Step 4: Categories
  await db.delete(categories).where(eq(categories.tenantId, tenantId))
  if (counts.categories > 0) console.log(`   ✓ categories`)

  // Step 5: User tenant access
  await db.delete(userTenantAccess).where(eq(userTenantAccess.tenantId, tenantId))
  if (counts.user_tenant_access > 0) console.log(`   ✓ user_tenant_access`)

  // Step 6: Users whose primary tenant is this one AND who have no other tenant access
  // Find users who have access to OTHER tenants (don't delete those)
  const usersWithOtherAccess = db
    .select({ userId: userTenantAccess.userId })
    .from(userTenantAccess)
    // user_tenant_access rows for THIS tenant were already deleted in step 5,
    // so any remaining rows mean the user has access to another tenant

  const deletedUsers = await db
    .delete(users)
    .where(
      and(
        eq(users.tenantId, tenantId),
        notInArray(users.id, usersWithOtherAccess)
      )
    )
    .returning({ id: users.id })

  if (deletedUsers.length > 0) console.log(`   ✓ users (${deletedUsers.length} deleted, preserved users with other tenant access)`)

  // Step 7: The tenant itself
  await db.delete(tenants).where(eq(tenants.id, tenantId))
  console.log(`   ✓ tenant "${tenant.name}" (${subdomain})`)

  console.log(`\n✅ Done. Tenant "${tenant.name}" and all associated data have been deleted.`)
  console.log(`\n💡 Reminder: Vercel Blob files under "${subdomain}/" are still there.`)
  console.log(`   Clean them up from the Vercel dashboard if needed.\n`)
}

// ============================================
// COUNT HELPER
// ============================================
async function getCounts(tenantId: string): Promise<Record<string, number>> {
  const countQuery = async (table: any, field: any) => {
    const [result] = await db
      .select({ count: sql<number>`count(*)` })
      .from(table)
      .where(eq(field, tenantId))
    return Number(result.count)
  }

  return {
    users: await countQuery(users, users.tenantId),
    user_tenant_access: await countQuery(userTenantAccess, userTenantAccess.tenantId),
    categories: await countQuery(categories, categories.tenantId),
    expenses: await countQuery(expenses, expenses.tenantId),
    expense_attachments: await countQuery(expenseAttachments, expenseAttachments.tenantId),
    mileage_trips: await countQuery(mileageTrips, mileageTrips.tenantId),
    saved_locations: await countQuery(savedLocations, savedLocations.tenantId),
    vendor_category_mappings: await countQuery(vendorCategoryMappings, vendorCategoryMappings.tenantId),
    recurring_expenses: await countQuery(recurringExpenses, recurringExpenses.tenantId),
    sessions: await countQuery(sessions, sessions.tenantId),
    accountant_invites: await countQuery(accountantInvites, accountantInvites.tenantId),
    invites: await countQuery(invites, invites.tenantId),
    expense_policies: await countQuery(expensePolicies, expensePolicies.tenantId),
    rate_limit_usage: await countQuery(rateLimitUsage, rateLimitUsage.tenantId),
  }
}

// ============================================
// RUN
// ============================================
main().catch((err) => {
  console.error('❌ Fatal error:', err)
  process.exit(1)
})
