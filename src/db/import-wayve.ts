import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq, and } from 'drizzle-orm';
import * as schema from './schema.js';
import { tenants, categories, expenses } from './schema.js';
import * as fs from 'fs';

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

// Spreadsheet category -> App category mapping
const CATEGORY_MAP: Record<string, string> = {
  'advertising': 'advertising & marketing',
  'bank fees': 'bank fees',
  'client gift': 'client gift',           // will rename from "gifts to clients"
  'contractors': 'contractors',
  'donations': 'donations',               // new - will create
  'education': 'continuing education',
  'equipment': 'hardware (under $500)',
  'fuel': 'fuel',                          // new - will create
  'insurance': 'business insurance',
  'legal & professional': 'legal & professional', // will rename from "professional fees"
  'meals': 'meals',
  'misc': 'uncategorized',
  'office supplies': 'office supplies',
  'rent': 'rent',
  'repair & maintenance': 'repair & maintenance', // will rename from "repairs"
  'software': 'software & subscriptions',
  'travel': 'travel',
  'utilities': 'gas / electric',
  'vehicle': 'vehicle',                    // new - will create
};

function parseCsvLine(line: string): string[] {
  // Simple CSV parser - our data has no quoted fields (verified: all rows have 9 fields)
  return line.split(',');
}

function parseAmount(amountStr: string): number {
  // Convert dollar amount string to cents integer
  // Handle: "2600", "495.99", "81.33"
  const cleaned = amountStr.replace(/[$,\s]/g, '').trim();
  const dollars = parseFloat(cleaned);
  if (isNaN(dollars)) return 0;
  return Math.round(dollars * 100);
}

function parseDate(dateStr: string): Date {
  // Format: M/D/YYYY (e.g., "1/1/2025", "12/11/2025")
  // Use explicit year/month/day construction to avoid timezone issues
  const parts = dateStr.trim().split('/');
  const month = parseInt(parts[0], 10) - 1; // JS months are 0-indexed
  const day = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);
  return new Date(year, month, day, 12, 0, 0); // noon to avoid any timezone edge cases
}

async function importWayve() {
  console.log('🌊 Importing Wayve Consulting (Amber) expenses...\n');

  // ============================================
  // 1. Get the Wayve tenant
  // ============================================
  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.subdomain, 'wayve'))
    .limit(1);

  if (!tenant) {
    throw new Error('Wayve Consulting tenant not found!');
  }
  console.log(`✓ Found tenant: ${tenant.name} (${tenant.id})\n`);

  // ============================================
  // 2. Get existing categories for this tenant
  // ============================================
  const categoryList = await db
    .select()
    .from(categories)
    .where(and(
      eq(categories.tenantId, tenant.id),
      eq(categories.isActive, true)
    ));

  const categoryByName = new Map<string, typeof categoryList[0]>();
  for (const cat of categoryList) {
    categoryByName.set(cat.name.toLowerCase(), cat);
  }
  console.log(`✓ Loaded ${categoryByName.size} existing categories\n`);

  // ============================================
  // 3. Rename categories
  // ============================================
  const renames: [string, string][] = [
    ['gifts to clients', 'Client Gift'],
    ['professional fees', 'Legal & Professional'],
    ['repairs', 'Repair & Maintenance'],
  ];

  const emojiSwaps: [string, string][] = [
    ['contractors', '👷'],
    ['repair & maintenance', '🛠️'], // after rename
  ];

  for (const [oldName, newName] of renames) {
    const existing = categoryByName.get(oldName);
    if (existing) {
      await db.update(categories)
        .set({ name: newName, updatedAt: new Date() })
        .where(eq(categories.id, existing.id));
      console.log(`  ✏️  Renamed "${oldName}" → "${newName}"`);
      // Update our local map
      categoryByName.delete(oldName);
      categoryByName.set(newName.toLowerCase(), { ...existing, name: newName });
    } else {
      console.log(`  ⚠️  Category "${oldName}" not found for rename — skipping`);
    }
  }

  for (const [name, emoji] of emojiSwaps) {
    const existing = categoryByName.get(name);
    if (existing) {
      await db.update(categories)
        .set({ emoji, updatedAt: new Date() })
        .where(eq(categories.id, existing.id));
      console.log(`  🎨 Swapped emoji for "${name}" → ${emoji}`);
    } else {
      console.log(`  ⚠️  Category "${name}" not found for emoji swap — skipping`);
    }
  }
  console.log('');

  // ============================================
  // 4. Create new categories
  // ============================================
  const newCategories: { emoji: string; name: string; expenseType: string }[] = [
    { emoji: '🤝', name: 'Donations', expenseType: 'operating' },
    { emoji: '⛽', name: 'Fuel', expenseType: 'operating' },
    { emoji: '🚗', name: 'Vehicle', expenseType: 'operating' },
  ];

  for (const newCat of newCategories) {
    // Check if already exists (idempotency)
    if (categoryByName.has(newCat.name.toLowerCase())) {
      console.log(`  ℹ️  Category "${newCat.name}" already exists — skipping creation`);
      continue;
    }
    const [created] = await db.insert(categories).values({
      tenantId: tenant.id,
      name: newCat.name,
      emoji: newCat.emoji,
      expenseType: newCat.expenseType,
      homeOfficeEligible: false,
      isSystem: false,
      isActive: true,
      sortOrder: 0,
    }).returning();
    categoryByName.set(newCat.name.toLowerCase(), created);
    console.log(`  ✨ Created category: ${newCat.emoji} ${newCat.name}`);
  }
  console.log('');

  // ============================================
  // 5. Build final category ID lookup
  // ============================================
  // Re-fetch to get clean state after renames
  const updatedCategoryList = await db
    .select()
    .from(categories)
    .where(and(
      eq(categories.tenantId, tenant.id),
      eq(categories.isActive, true)
    ));

  const categoryIdMap = new Map<string, string>();
  for (const cat of updatedCategoryList) {
    categoryIdMap.set(cat.name.toLowerCase(), cat.id);
  }

  // Verify all mappings resolve
  console.log('Category mapping verification:');
  for (const [spreadsheetCat, appCat] of Object.entries(CATEGORY_MAP)) {
    const id = categoryIdMap.get(appCat.toLowerCase());
    const status = id ? '✓' : '✗ MISSING';
    console.log(`  ${status}  "${spreadsheetCat}" → "${appCat}" ${id ? `(${id.slice(0, 8)}...)` : ''}`);
  }
  console.log('');

  // Check for any missing mappings before importing
  const missingMappings = Object.entries(CATEGORY_MAP).filter(
    ([_, appCat]) => !categoryIdMap.get(appCat.toLowerCase())
  );
  if (missingMappings.length > 0) {
    console.error('❌ Missing category mappings! Aborting import.');
    for (const [spreadsheet, app] of missingMappings) {
      console.error(`   "${spreadsheet}" → "${app}" (not found)`);
    }
    process.exit(1);
  }

  // ============================================
  // 6. Parse and import expenses
  // ============================================
  const csvPath = process.argv[2];
  if (!csvPath) {
    throw new Error('Usage: npx tsx src/db/import-wayve.ts <path-to-expenses-csv>');
  }
  if (!fs.existsSync(csvPath)) {
    throw new Error(`File not found: ${csvPath}`);
  }

  const csvContent = fs.readFileSync(csvPath, 'utf-8').replace(/\r/g, '');
  const lines = csvContent.split('\n').filter(line => line.trim() !== '');
  
  // Skip header row, skip blank rows (start with comma)
  const dataLines = lines.slice(1).filter(line => !line.startsWith(','));
  
  console.log(`📄 Found ${dataLines.length} expenses to import\n`);

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (let i = 0; i < dataLines.length; i++) {
    const fields = parseCsvLine(dataLines[i]);
    // Fields: Month, Quarter, Date, Category, Vendor, Amount, Notes, Receipt Image, Receipt File
    const [_month, _quarter, dateStr, categoryName, vendor, amountStr, notes, receiptImage, receiptFile] = fields;

    if (!dateStr || !amountStr) {
      skipped++;
      continue;
    }

    // Map spreadsheet category to app category
    const appCategoryName = CATEGORY_MAP[categoryName.trim().toLowerCase()];
    if (!appCategoryName) {
      errors.push(`Row ${i + 2}: Unknown category "${categoryName}"`);
      skipped++;
      continue;
    }

    const categoryId = categoryIdMap.get(appCategoryName.toLowerCase());
    if (!categoryId) {
      errors.push(`Row ${i + 2}: Category "${appCategoryName}" not found in database`);
      skipped++;
      continue;
    }

    const amount = parseAmount(amountStr);
    if (amount === 0) {
      errors.push(`Row ${i + 2}: Invalid amount "${amountStr}"`);
      skipped++;
      continue;
    }

    const date = parseDate(dateStr);
    
    // Get receipt URL (prefer image, fall back to file)
    const receiptUrl = (receiptImage || receiptFile || '').trim() || null;

    // Look up the category to get its default expense type
    const catRecord = updatedCategoryList.find(c => c.id === categoryId);
    const expenseType = catRecord?.expenseType || 'operating';

    try {
      await db.insert(expenses).values({
        tenantId: tenant.id,
        amount,
        vendor: vendor?.trim() || null,
        description: notes?.trim() || null,
        date,
        categoryId,
        expenseType,
        isHomeOffice: false,
        receiptUrl,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      imported++;
    } catch (err: any) {
      errors.push(`Row ${i + 2}: Insert failed — ${err.message}`);
      skipped++;
    }
  }

  console.log(`\n✅ Import complete!`);
  console.log(`   Imported: ${imported}`);
  console.log(`   Skipped:  ${skipped}`);
  
  if (errors.length > 0) {
    console.log(`\n⚠️  Errors:`);
    for (const err of errors) {
      console.log(`   ${err}`);
    }
  }
}

importWayve().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
