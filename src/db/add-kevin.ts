import { db } from './index.js';
import { users } from './schema.js';

async function addKevin() {
  const userId = crypto.randomUUID();
  
  await db.insert(users).values({
    id: userId,
    email: 'kpowers@gmail.com',
    firstName: 'Kevin',
    lastName: 'Powers',
    tenantId: null,
    role: 'owner',
    isSuperAdmin: true,
    isAccountant: false,
    passwordHash: null,
    googleId: null,
    appleId: null,
    theme: 'teal-tide',
  });

  console.log('✅ Kevin added as super admin!');
  console.log('   User ID:', userId);
  console.log('   Email: kpowers@gmail.com');
  
  process.exit(0);
}

addKevin().catch((err) => {
  console.error('Failed to add Kevin:', err);
  process.exit(1);
});