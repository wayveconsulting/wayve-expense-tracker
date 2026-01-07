import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema.js';
import { tenants, users, categories } from './schema.js';

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

async function seed() {
  console.log('🌱 Seeding database...\n');

  // 1. Create IZR Grooming tenant
  console.log('Creating tenant: IZR Grooming');
  const [tenant] = await db.insert(tenants).values({
    name: 'IZR Grooming',
    subdomain: 'izrgrooming',
    primaryColor: '#2A9D8F',
    appName: 'IZR Expense Tracker',
    isActive: true,
  }).returning();
  console.log(`  ✓ Tenant created: ${tenant.id}\n`);

  // 2. Create owner user (password will be set later via auth flow)
  console.log('Creating user: zenroomgrooming@gmail.com');
  const [user] = await db.insert(users).values({
    tenantId: tenant.id,
    email: 'zenroomgrooming@gmail.com',
    // passwordHash is null - will use OAuth
    role: 'owner',
  }).returning();
  console.log(`  âœ" User created: ${user.id}\n`);

  // 3. Create categories
  console.log('Creating categories...');
  const categoryData = [
    { emoji: '📰', name: 'Advertising' },
    { emoji: '🎁', name: 'Client Gift' },
    { emoji: '💬', name: 'Communication' },
    { emoji: '🤝', name: 'Donations' },
    { emoji: '🧠', name: 'Education' },
    { emoji: '⛽', name: 'Fuel' },
    { emoji: '🥗', name: 'Meal' },
    { emoji: '❓', name: 'Misc' },
    { emoji: '📓', name: 'Office Supplies' },
    { emoji: '🛠️', name: 'Repair / Maintenance' },
    { emoji: '📪', name: 'Subscriptions' },
    { emoji: '🪣', name: 'Supplies' },
    { emoji: '📳', name: 'Utilities' },
    { emoji: '🐕', name: 'Contracted Work' },
    { emoji: '☂️', name: 'Insurance' },
    { emoji: '🏛️', name: 'Legal / Professional' },
  ];

  for (let i = 0; i < categoryData.length; i++) {
    const cat = categoryData[i];
    await db.insert(categories).values({
      tenantId: tenant.id,
      name: cat.name,
      emoji: cat.emoji,
      sortOrder: i + 1,
      isActive: true,
    });
    console.log(`  ✓ ${cat.emoji} ${cat.name}`);
  }

  console.log('\n🎉 Seed complete!\n');
  console.log('Test it: https://wayve-expense-tracker.vercel.app?tenant=izrgrooming');
}

seed().catch(console.error);