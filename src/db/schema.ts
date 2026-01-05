import { pgTable, uuid, varchar, text, timestamp, boolean } from 'drizzle-orm/pg-core';

// ============================================
// TENANTS (Organizations/Businesses)
// ============================================
export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  
  // Basic info
  name: varchar('name', { length: 255 }).notNull(),
  subdomain: varchar('subdomain', { length: 63 }).notNull().unique(), // e.g., "izrgrooming"
  
  // Branding (white-label ready)
  logoUrl: text('logo_url'),
  primaryColor: varchar('primary_color', { length: 7 }).default('#2A9D8F'), // hex color
  appName: varchar('app_name', { length: 255 }), // custom app name, falls back to global default
  
  // Settings
  isActive: boolean('is_active').default(true).notNull(),
  
  // Audit fields
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================
// USERS
// ============================================
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  
  // Auth
  email: varchar('email', { length: 255 }).notNull(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  
  // Profile
  firstName: varchar('first_name', { length: 100 }),
  lastName: varchar('last_name', { length: 100 }),
  
  // Role: 'owner' | 'admin' | 'editor' | 'data_entry' | 'viewer' | 'accountant'
  role: varchar('role', { length: 50 }).default('viewer').notNull(),
  
  // Preferences
  theme: varchar('theme', { length: 50 }).default('teal-tide'),
  
  // Audit fields
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  lastLoginAt: timestamp('last_login_at'),
});