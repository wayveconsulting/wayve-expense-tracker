import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../../src/db/index.js';
import { users, sessions, tenants } from '../../src/db/schema.js';
import { eq, inArray } from 'drizzle-orm';

// Helper: authenticate and verify super admin
async function authenticateSuperAdmin(req: VercelRequest): Promise<boolean> {
  const cookies = req.headers.cookie || '';
  const sessionToken = cookies.split(';').map(c => c.trim()).find(c => c.startsWith('session='))?.split('=')[1];

  if (!sessionToken) return false;

  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.token, sessionToken))
    .limit(1);

  if (!session || new Date(session.expiresAt) < new Date()) return false;

  const [user] = await db
    .select({ isSuperAdmin: users.isSuperAdmin })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  return !!user?.isSuperAdmin;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const isAdmin = await authenticateSuperAdmin(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { tenantIds } = req.body || {};

  if (!Array.isArray(tenantIds) || tenantIds.length === 0) {
    return res.status(400).json({ error: 'tenantIds array is required' });
  }

  // Validate all IDs are strings
  if (!tenantIds.every((id: unknown) => typeof id === 'string')) {
    return res.status(400).json({ error: 'All tenantIds must be strings' });
  }

  try {
    // Soft delete: set deletedAt on selected tenants
    const now = new Date();
    const updated = await db
      .update(tenants)
      .set({ deletedAt: now, updatedAt: now })
      .where(inArray(tenants.id, tenantIds))
      .returning({ id: tenants.id, subdomain: tenants.subdomain });

    return res.status(200).json({
      deleted: updated.length,
      tenants: updated,
    });
  } catch (err) {
    console.error('Error soft-deleting tenants:', err);
    return res.status(500).json({ error: 'Failed to delete tenants' });
  }
}
