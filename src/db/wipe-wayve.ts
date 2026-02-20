import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq } from 'drizzle-orm';
import { tenants, categories, expenses } from './schema.js';
import { DEFAULT_CATEGORIES, UNCATEGORIZED_CATEGORY } from './default-categories.js';

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);

async function wipeWayve() {
  console.log('🧹 Wiping Wayve Consulting tenant data back to defaults...\n');

  // 1. Get the Wayve tenant
  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.subdomain, 'wayve'))
    .limit(1);

  if (!tenant) {
    throw new Error('Wayve Consulting tenant not found!');
  }
  console.log(`✓ Found tenant: ${tenant.name} (${tenant.id})\n`);

  // 2. Delete all expenses for this tenant
  const deletedExpenses = await db
    .delete(expenses)
    .where(eq(expenses.tenantId, tenant.id))
    .returning({ id: expenses.id });
  console.log(`🗑️  Deleted ${deletedExpenses.length} expenses`);

  // 3. Delete all categories for this tenant (including system)
  const deletedCategories = await db
    .delete(categories)
    .where(eq(categories.tenantId, tenant.id))
    .returning({ id: categories.id });
  console.log(`🗑️  Deleted ${deletedCategories.length} categories`);

  // 4. Re-seed default categories
  let seeded = 0;
  for (const cat of DEFAULT_CATEGORIES) {
    await db.insert(categories).values({
      tenantId: tenant.id,
      name: cat.name,
      emoji: cat.emoji,
      expenseType: cat.expenseType,
      homeOfficeEligible: cat.homeOfficeEligible,
      isSystem: false,
      isActive: true,
      sortOrder: 0,
    });
    seeded++;
  }

  // Seed Uncategorized system category
  await db.insert(categories).values({
    tenantId: tenant.id,
    name: UNCATEGORIZED_CATEGORY.name,
    emoji: UNCATEGORIZED_CATEGORY.emoji,
    expenseType: UNCATEGORIZED_CATEGORY.expenseType,
    homeOfficeEligible: UNCATEGORIZED_CATEGORY.homeOfficeEligible,
    isSystem: true,
    isActive: true,
    sortOrder: 999,
  });
  seeded++;

  console.log(`✨ Seeded ${seeded} default categories`);
  console.log(`\n✅ Wayve tenant reset complete. Tenant record, user access, and home office settings preserved.`);
}

wipeWayve().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
