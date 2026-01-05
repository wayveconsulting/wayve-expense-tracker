import 'dotenv/config';
import { db } from './index';
import { tenants } from './schema';

async function testConnection() {
  console.log('Testing database connection...');
  
  try {
    const result = await db.select().from(tenants);
    console.log('✓ Connection successful!');
    console.log('Tenants in database:', result.length);
  } catch (error) {
    console.error('✗ Connection failed:', error);
  }
}

testConnection();