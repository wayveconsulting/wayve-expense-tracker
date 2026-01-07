import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema.js';
import { tenants, users, categories, expenses, userTenantAccess } from './schema.js';
import { eq } from 'drizzle-orm';

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

async function seedSandbox() {
  console.log('🏖️  Creating Sandbox environment...\n');

  // 1. Create Sandbox tenant
  console.log('Creating tenant: Sandbox');
  const [tenant] = await db.insert(tenants).values({
    name: 'Sandbox',
    subdomain: 'sandbox',
    primaryColor: '#E76F51', // A nice orange to differentiate from IZR's teal
    appName: 'Sandbox Expense Tracker',
    isActive: true,
  }).returning();
  console.log(`  ✓ Tenant created: ${tenant.id}\n`);

  // 2. Create owner user
  console.log('Creating user: kpowersms@gmail.com');
  const [user] = await db.insert(users).values({
    tenantId: tenant.id,
    email: 'kpowersms@gmail.com',
    firstName: 'Kevin',
    lastName: 'Powers',
    role: 'owner',
  }).returning();
  console.log(`  ✓ User created: ${user.id}\n`);

  // 3. Add user_tenant_access record (for consistency)
  console.log('Creating tenant access record...');
  await db.insert(userTenantAccess).values({
    userId: user.id,
    tenantId: tenant.id,
    role: 'owner',
    canEdit: true,
  });
  console.log(`  ✓ Tenant access granted\n`);

  // 4. Copy categories from IZR Grooming
  console.log('Copying categories from IZR Grooming...');
  
  // First, find IZR Grooming tenant
  const [izrTenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.subdomain, 'izrgrooming'))
    .limit(1);

  if (!izrTenant) {
    console.error('❌ IZR Grooming tenant not found! Run the original seed first.');
    return;
  }

  // Get IZR's categories
  const izrCategories = await db
    .select()
    .from(categories)
    .where(eq(categories.tenantId, izrTenant.id));

  // Create a mapping of old category ID -> new category ID (needed for expenses)
  const categoryMap = new Map<string, string>();

  for (const cat of izrCategories) {
    const [newCat] = await db.insert(categories).values({
      tenantId: tenant.id,
      name: cat.name,
      emoji: cat.emoji,
      sortOrder: cat.sortOrder,
      isActive: cat.isActive,
    }).returning();
    
    categoryMap.set(cat.id, newCat.id);
    console.log(`  ✓ ${cat.emoji} ${cat.name}`);
  }
  console.log(`  → Copied ${izrCategories.length} categories\n`);

  // 5. Copy expenses from IZR Grooming
  console.log('Copying expenses from IZR Grooming...');
  
  const izrExpenses = await db
    .select()
    .from(expenses)
    .where(eq(expenses.tenantId, izrTenant.id));

  let copiedCount = 0;
  for (const expense of izrExpenses) {
    await db.insert(expenses).values({
      tenantId: tenant.id,
      amount: expense.amount,
      vendor: expense.vendor,
      description: expense.description,
      date: expense.date,
      categoryId: expense.categoryId ? categoryMap.get(expense.categoryId) || null : null,
      expenseType: expense.expenseType,
      homeOfficePercent: expense.homeOfficePercent,
      receiptUrl: expense.receiptUrl,
      extractedText: expense.extractedText,
      createdBy: user.id, // Attribute to sandbox owner
      updatedBy: user.id,
    });
    copiedCount++;
    
    // Progress indicator every 100 expenses
    if (copiedCount % 100 === 0) {
      console.log(`  → ${copiedCount} expenses copied...`);
    }
  }
  console.log(`  ✓ Copied ${copiedCount} expenses\n`);

  console.log('🎉 Sandbox environment ready!\n');
  console.log('Test it: https://wayveconsulting.app?tenant=sandbox');
  console.log('Login with: kpowersms@gmail.com');
}

seedSandbox().catch(console.error);