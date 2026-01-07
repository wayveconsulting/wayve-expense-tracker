import { pgTable, uuid, varchar, text, timestamp, boolean, integer, unique } from 'drizzle-orm/pg-core';

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
  
  // White-label custom domain (future)
  customDomain: varchar('custom_domain', { length: 255 }), // e.g., "expenses.sarahcpa.com"
  
  // Settings
  isActive: boolean('is_active').default(true).notNull(),
  
  // Billing attribution - who created this tenant?
  createdBy: uuid('created_by'), // references users.id, but can't use FK due to circular dependency
  
  // Audit fields
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================
// USERS
// ============================================
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id), // nullable for super admins who exist outside tenants
  
  // Auth
  email: varchar('email', { length: 255 }).notNull(),
  passwordHash: varchar('password_hash', { length: 255 }), // nullable - OAuth users won't have one
  emailVerified: boolean('email_verified').default(false).notNull(),
  
  // OAuth providers (store provider's user ID for linking)
  googleId: varchar('google_id', { length: 255 }),
  appleId: varchar('apple_id', { length: 255 }),
  
  // Profile
  firstName: varchar('first_name', { length: 100 }),
  lastName: varchar('last_name', { length: 100 }),
  
  // Role: 'owner' | 'admin' | 'editor' | 'data_entry' | 'viewer' | 'accountant'
  // NOTE: This is the user's role within their PRIMARY tenant (tenantId above)
  // For multi-tenant access, see user_tenant_access table
  role: varchar('role', { length: 50 }).default('viewer').notNull(),
  
  // Special user types (exist above tenant level)
  isSuperAdmin: boolean('is_super_admin').default(false).notNull(), // Amber - can see/do everything
  isAccountant: boolean('is_accountant').default(false).notNull(), // CPAs - can access multiple tenants
  
  // Preferences
  theme: varchar('theme', { length: 50 }).default('teal-tide'),
  
  // Audit fields
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  lastLoginAt: timestamp('last_login_at'),
});

// ============================================
// USER TENANT ACCESS (Junction table for multi-tenant access)
// ============================================
export const userTenantAccess = pgTable('user_tenant_access', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  
  // Role within THIS tenant: 'owner' | 'admin' | 'editor' | 'data_entry' | 'viewer' | 'accountant'
  role: varchar('role', { length: 50 }).notNull(),
  
  // For accountants: can they edit expenses? (default: no, read-only)
  canEdit: boolean('can_edit').default(false).notNull(),
  
  // Who invited this user to this tenant?
  invitedBy: uuid('invited_by').references(() => users.id),
  
  // Audit fields
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  // Each user can only have one access record per tenant
  unique('user_tenant_unique').on(table.userId, table.tenantId),
]);

// ============================================
// CATEGORIES
// ============================================
export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  
  // Display
  name: varchar('name', { length: 100 }).notNull(),
  emoji: varchar('emoji', { length: 10 }).default('📁'), // emoji icon
  
  // Sorting
  sortOrder: integer('sort_order').default(0),
  
  // Soft delete (for "move expenses to uncategorized" flow)
  isActive: boolean('is_active').default(true).notNull(),
  
  // Audit fields
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================
// EXPENSES
// ============================================
export const expenses = pgTable('expenses', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  
  // Core fields
  amount: integer('amount').notNull(), // stored in cents to avoid floating point nonsense
  vendor: varchar('vendor', { length: 255 }),
  description: text('description'),
  date: timestamp('date').notNull(),
  
  // Classification
  categoryId: uuid('category_id').references(() => categories.id),
  expenseType: varchar('expense_type', { length: 50 }).default('operating').notNull(), // 'cogs' | 'operating' | 'home_office'
  
  // Home office specific
  homeOfficePercent: integer('home_office_percent'), // e.g., 15 for 15%
  
  // Receipt
  receiptUrl: text('receipt_url'),
  extractedText: text('extracted_text'), // from AI scan, for full-text search
  
  // Recurring expense link
  recurringExpenseId: uuid('recurring_expense_id'), // we'll add the FK after creating that table
  
  // Audit fields
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================
// EXPENSE HISTORY (Audit Trail)
// ============================================
export const expenseHistory = pgTable('expense_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  expenseId: uuid('expense_id').notNull().references(() => expenses.id),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  
  // What changed
  action: varchar('action', { length: 20 }).notNull(), // 'create' | 'update' | 'delete'
  
  // Snapshot of the expense at this point in time
  previousValues: text('previous_values'), // JSON blob of old values (null on create)
  newValues: text('new_values'), // JSON blob of new values (null on delete)
  
  // Who did it and when
  changedBy: uuid('changed_by').references(() => users.id),
  changedAt: timestamp('changed_at').defaultNow().notNull(),
});

// ============================================
// MILEAGE TRIPS
// ============================================
export const mileageTrips = pgTable('mileage_trips', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  
  // Trip details
  date: timestamp('date').notNull(),
  description: varchar('description', { length: 255 }),
  
  // Locations
  startLocation: varchar('start_location', { length: 500 }).notNull(),
  endLocation: varchar('end_location', { length: 500 }).notNull(),
  
  // Distance
  distanceMiles: integer('distance_miles').notNull(), // stored as miles * 100 for precision (e.g., 12.5 miles = 1250)
  isRoundTrip: boolean('is_round_trip').default(false).notNull(),
  
  // Audit fields
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================
// SAVED LOCATIONS (for quick mileage entry)
// ============================================
export const savedLocations = pgTable('saved_locations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  
  // Location info
  name: varchar('name', { length: 100 }).notNull(), // e.g., "Office", "Home", "Client HQ"
  address: varchar('address', { length: 500 }).notNull(),
  
  // Sorting
  sortOrder: integer('sort_order').default(0),
  
  // Audit fields
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================
// VENDOR CATEGORY MAPPINGS (learns from user behavior)
// ============================================
export const vendorCategoryMappings = pgTable('vendor_category_mappings', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  
  // The mapping
  vendorPattern: varchar('vendor_pattern', { length: 255 }).notNull(), // lowercase, trimmed vendor name
  categoryId: uuid('category_id').notNull().references(() => categories.id),
  
  // How confident are we? (increments each time user confirms this mapping)
  useCount: integer('use_count').default(1).notNull(),
  
  // Audit fields
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================
// RECURRING EXPENSES (templates for auto-generation)
// ============================================
export const recurringExpenses = pgTable('recurring_expenses', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  
  // Template details (mirrors expense fields)
  amount: integer('amount').notNull(), // cents
  vendor: varchar('vendor', { length: 255 }),
  description: text('description'),
  categoryId: uuid('category_id').references(() => categories.id),
  expenseType: varchar('expense_type', { length: 50 }).default('operating').notNull(),
  
  // Schedule
  frequency: varchar('frequency', { length: 20 }).default('monthly').notNull(), // 'monthly' | 'quarterly' | 'yearly'
  dayOfMonth: integer('day_of_month').default(1), // 1-31, when to generate
  
  // Tracking
  lastGeneratedAt: timestamp('last_generated_at'),
  nextGenerationAt: timestamp('next_generation_at'),
  isActive: boolean('is_active').default(true).notNull(),
  
  // Audit fields
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================
// SESSIONS (for authentication)
// ============================================
export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  
  // Session token (stored in HTTP-only cookie)
  token: varchar('token', { length: 255 }).notNull().unique(),
  
  // Expiration
  expiresAt: timestamp('expires_at').notNull(),
  
  // Metadata
  userAgent: text('user_agent'),
  ipAddress: varchar('ip_address', { length: 45 }), // supports IPv6
  
  // Audit
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ============================================
// ACCOUNTANT INVITES
// ============================================
export const accountantInvites = pgTable('accountant_invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  
  // Invite details
  email: varchar('email', { length: 255 }).notNull(),
  inviteToken: varchar('invite_token', { length: 255 }).notNull().unique(),
  
  // Status
  status: varchar('status', { length: 20 }).default('pending').notNull(), // 'pending' | 'accepted' | 'revoked'
  expiresAt: timestamp('expires_at').notNull(),
  
  // If accepted, links to the accountant user record
  acceptedByUserId: uuid('accepted_by_user_id').references(() => users.id),
  acceptedAt: timestamp('accepted_at'),
  
  // Audit
  invitedBy: uuid('invited_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ============================================
// EXPENSE POLICIES (per sub-user rules)
// ============================================
export const expensePolicies = pgTable('expense_policies', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  userId: uuid('user_id').notNull().references(() => users.id), // the sub-user this policy applies to
  
  // Policy rules (all optional - null means no restriction)
  maxExpenseAmount: integer('max_expense_amount'), // cents - flag expenses over this
  requireNotesAbove: integer('require_notes_above'), // cents - require notes for expenses over this
  allowedCategories: text('allowed_categories'), // JSON array of category IDs, null = all allowed
  
  // Audit
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

