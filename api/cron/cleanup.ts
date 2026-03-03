import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../../src/db/index.js';
import {
  tenants,
  users,
  userTenantAccess,
  categories,
  expenses,
  expenseAttachments,
  expenseHistory,
  mileageTrips,
  savedLocations,
  vendorCategoryMappings,
  recurringExpenses,
  sessions,
  accountantInvites,
  invites,
  expensePolicies,
  rateLimitUsage,
} from '../../src/db/schema.js';
import { eq, and, lte, isNotNull, notInArray, inArray, sql } from 'drizzle-orm';
import { list, del } from '@vercel/blob';

const GRACE_PERIOD_DAYS = 30;
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');

  // Verify this is a cron request (Vercel sends this header)
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Find tenants where deletedAt is older than 30 days
    const cutoff = new Date(Date.now() - GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);

    const expiredTenants = await db
      .select({
        id: tenants.id,
        name: tenants.name,
        subdomain: tenants.subdomain,
        deletedAt: tenants.deletedAt,
      })
      .from(tenants)
      .where(and(
        isNotNull(tenants.deletedAt),
        lte(tenants.deletedAt, cutoff),
      ));

    if (expiredTenants.length === 0) {
      return res.status(200).json({ message: 'No tenants to purge', purged: 0 });
    }

    const results: { subdomain: string; success: boolean; error?: string }[] = [];

    for (const tenant of expiredTenants) {
      try {
        await hardDeleteTenant(tenant.id, tenant.subdomain);
        console.log(`[cron] Hard-deleted tenant: ${tenant.name} (${tenant.subdomain})`);
        results.push({ subdomain: tenant.subdomain, success: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[cron] Failed to hard-delete ${tenant.subdomain}:`, msg);
        results.push({ subdomain: tenant.subdomain, success: false, error: msg });
      }
    }

    return res.status(200).json({
      message: `Processed ${expiredTenants.length} tenant(s)`,
      purged: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      details: results,
    });
  } catch (err) {
    console.error('[cron] Cleanup error:', err);
    return res.status(500).json({ error: 'Cleanup failed' });
  }
}

/**
 * Hard-delete a tenant and all associated data.
 * Cascade logic adapted from scripts/delete-tenant.ts
 */
async function hardDeleteTenant(tenantId: string, subdomain: string): Promise<void> {
  // Step 1: Delete Vercel Blob files
  if (BLOB_TOKEN) {
    try {
      await deleteBlobs(`${subdomain}/`);
    } catch (err) {
      console.error(`[cron] Blob cleanup failed for ${subdomain}:`, err);
      // Continue with DB deletion — blobs can be cleaned manually
    }
  }

  // Step 2: Leaf tables (no other tables reference these)
  await db.delete(rateLimitUsage).where(eq(rateLimitUsage.tenantId, tenantId));
  await db.delete(expensePolicies).where(eq(expensePolicies.tenantId, tenantId));
  await db.delete(accountantInvites).where(eq(accountantInvites.tenantId, tenantId));
  await db.delete(invites).where(eq(invites.tenantId, tenantId));
  await db.delete(savedLocations).where(eq(savedLocations.tenantId, tenantId));
  await db.delete(vendorCategoryMappings).where(eq(vendorCategoryMappings.tenantId, tenantId));
  await db.delete(recurringExpenses).where(eq(recurringExpenses.tenantId, tenantId));
  await db.delete(mileageTrips).where(eq(mileageTrips.tenantId, tenantId));

  // Sessions: by tenantId and by userId for users in this tenant
  await db.delete(sessions).where(eq(sessions.tenantId, tenantId));
  const tenantUserIds = db.select({ id: users.id }).from(users).where(eq(users.tenantId, tenantId));
  await db.delete(sessions).where(inArray(sessions.userId, tenantUserIds));

  // Step 3: Expense history (FK → expenses)
  await db.delete(expenseHistory).where(eq(expenseHistory.tenantId, tenantId));

  // Step 4: Expense attachments (FK → expenses)
  await db.delete(expenseAttachments).where(eq(expenseAttachments.tenantId, tenantId));

  // Step 5: Expenses (FK → categories)
  await db.delete(expenses).where(eq(expenses.tenantId, tenantId));

  // Step 6: Categories
  await db.delete(categories).where(eq(categories.tenantId, tenantId));

  // Step 7: User tenant access
  await db.delete(userTenantAccess).where(eq(userTenantAccess.tenantId, tenantId));

  // Step 8: Users whose primary tenant is this one AND who have no other tenant access
  // (user_tenant_access rows for THIS tenant were already deleted above)
  const usersWithOtherAccess = db
    .select({ userId: userTenantAccess.userId })
    .from(userTenantAccess);

  await db
    .delete(users)
    .where(
      and(
        eq(users.tenantId, tenantId),
        notInArray(users.id, usersWithOtherAccess),
      ),
    );

  // Step 9: The tenant itself
  await db.delete(tenants).where(eq(tenants.id, tenantId));
}

/**
 * Delete all Vercel Blob files under a prefix
 */
async function deleteBlobs(prefix: string): Promise<number> {
  if (!BLOB_TOKEN) return 0;

  let totalDeleted = 0;
  let hasMore = true;

  while (hasMore) {
    const result = await list({ prefix, limit: 1000, token: BLOB_TOKEN });

    if (result.blobs.length > 0) {
      const urls = result.blobs.map(b => b.url);
      await del(urls, { token: BLOB_TOKEN });
      totalDeleted += urls.length;
    }

    hasMore = result.blobs.length === 1000;
  }

  return totalDeleted;
}
