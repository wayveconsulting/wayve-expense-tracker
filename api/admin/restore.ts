import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../../src/db/index.js';
import { tenants } from '../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { authenticateSuperAdmin } from '../_lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await authenticateSuperAdmin(req);
  if (!auth) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { tenantId } = req.body || {};

  if (!tenantId || typeof tenantId !== 'string') {
    return res.status(400).json({ error: 'tenantId is required' });
  }

  try {
    // Verify tenant exists and is actually soft-deleted
    const [tenant] = await db
      .select({ id: tenants.id, deletedAt: tenants.deletedAt })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    if (!tenant.deletedAt) {
      return res.status(400).json({ error: 'Tenant is not deleted' });
    }

    // Restore: stamp restoredAt for audit trail, clear deletedAt
    const now = new Date();
    await db
      .update(tenants)
      .set({
        deletedAt: null,
        restoredAt: now,
        updatedAt: now,
      })
      .where(eq(tenants.id, tenantId));

    return res.status(200).json({ restored: true, tenantId });
  } catch (err) {
    console.error('Error restoring tenant:', err);
    return res.status(500).json({ error: 'Failed to restore tenant' });
  }
}