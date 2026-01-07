import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq, } from 'drizzle-orm';
import * as schema from './schema.js';
import { tenants, categories, expenses } from './schema.js';
import XLSX from 'xlsx';
import * as fs from 'fs';

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

async function importExpenses() {
  console.log('📊 Importing IZR Grooming expenses...\n');

  // 1. Get the tenant
  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.subdomain, 'izrgrooming'))
    .limit(1);

  if (!tenant) {
    throw new Error('IZR Grooming tenant not found. Run seed.ts first!');
  }
  console.log(`✓ Found tenant: ${tenant.name} (${tenant.id})\n`);

  // 2. Get all categories for this tenant (to map names → IDs)
  const categoryList = await db
    .select()
    .from(categories)
    .where(eq(categories.tenantId, tenant.id));

  const categoryMap = new Map<string, string>();
  for (const cat of categoryList) {
    categoryMap.set(cat.name.toLowerCase(), cat.id);
  }
  console.log(`✓ Loaded ${categoryMap.size} categories\n`);

  // 3. Read the Excel file
  const filePath = process.argv[2];
  if (!filePath) {
    throw new Error('Usage: npx tsx src/db/import-expenses.ts <path-to-xlsx>');
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const workbook = XLSX.readFile(filePath);
  console.log(`✓ Opened ${filePath}\n`);

  // 4. Process each year's expenses
  const expenseSheets = ['2023 Expenses', '2024 Expenses', '2025 Expenses'];
  let totalImported = 0;
  let totalSkipped = 0;

  for (const sheetName of expenseSheets) {
    if (!workbook.SheetNames.includes(sheetName)) {
      console.log(`⚠ Sheet "${sheetName}" not found, skipping`);
      continue;
    }

    console.log(`Processing ${sheetName}...`);
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet) as any[];

    let sheetImported = 0;
    let sheetSkipped = 0;

    for (const row of rows) {
      // Skip empty rows
      if (!row.Amount || !row.Date) {
        sheetSkipped++;
        continue;
      }

      // Parse date
      let expenseDate: Date;
      if (typeof row.Date === 'number') {
        // Excel serial date
        expenseDate = XLSX.SSF.parse_date_code(row.Date) as unknown as Date;
        expenseDate = new Date(
          (row.Date - 25569) * 86400 * 1000
        );
      } else if (row.Date instanceof Date) {
        expenseDate = row.Date;
      } else {
        expenseDate = new Date(row.Date);
      }

      // Look up category
      const categoryName = (row.Category || 'Misc').trim();
      const categoryId = categoryMap.get(categoryName.toLowerCase());
      
      if (!categoryId) {
        console.log(`  ⚠ Unknown category "${categoryName}", using Misc`);
      }

      // Convert amount to cents (integer)
      const amountCents = Math.round(parseFloat(row.Amount) * 100);

      // Determine expense type
      let expenseType: 'cogs' | 'operating' | 'home_office' = 'operating';
      const isCog = row['Cost of Goods? '] || row['Cost of Goods?'];
      if (isCog === true || isCog === 1 || isCog === '1') {
        expenseType = 'cogs';
      }

      // Handle receipt URLs
      const receiptUrl = row.Receipt || null;
      // Note: Receipt 2 exists in source but our schema has single receipt
      // We could concatenate or store in notes if needed

      // Insert the expense
      try {
        await db.insert(expenses).values({
          tenantId: tenant.id,
          categoryId: categoryId || categoryMap.get('misc')!,
          amount: amountCents,
          vendor: (row.Vendor || '').trim() || null,
          description: (row.Notes || '').trim() || null,
          date: expenseDate,
          expenseType: expenseType,
          receiptUrl: receiptUrl,
          extractedText: null,
          createdBy: null, // No user context for import
          updatedBy: null,
        });
        sheetImported++;
      } catch (err) {
        console.log(`  ✗ Failed to import row:`, err);
        sheetSkipped++;
      }
    }

    console.log(`  ✓ Imported ${sheetImported}, skipped ${sheetSkipped}\n`);
    totalImported += sheetImported;
    totalSkipped += sheetSkipped;
  }

  console.log('═'.repeat(40));
  console.log(`🎉 Import complete!`);
  console.log(`   Total imported: ${totalImported}`);
  console.log(`   Total skipped: ${totalSkipped}`);
}

importExpenses().catch(console.error);