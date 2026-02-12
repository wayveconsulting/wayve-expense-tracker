import type { VercelRequest, VercelResponse } from '@vercel/node';
import { del } from '@vercel/blob';
import { db } from '../../src/db/index.js';
import { sessions, expenseAttachments, users, userTenantAccess, tenants } from '../../src/db/schema.js';
import { eq, and } from 'drizzle-orm';

// Auth helper — resolves tenant from query param, same pattern as expenses endpoint
async function getAuth(req: VercelRequest) {
  const sessionToken = req.cookies?.session;
  if (!sessionToken) return null;

  // Validate session
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.token, sessionToken))
    .limit(1);

  if (!session || new Date(session.expiresAt) < new Date()) return null;

  // Get user
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  if (!user) return null;

  // Resolve tenant from query param
  const tenantSubdomain = req.query.tenant as string | undefined;
  if (!tenantSubdomain) return null;

  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.subdomain, tenantSubdomain))
    .limit(1);

  if (!tenant) return null;

  // Verify user has access to this tenant
  const [hasAccess] = await db
    .select()
    .from(userTenantAccess)
    .where(and(
      eq(userTenantAccess.userId, user.id),
      eq(userTenantAccess.tenantId, tenant.id)
    ))
    .limit(1);

  if (!hasAccess && !user.isSuperAdmin) return null;

  return { userId: user.id, tenantId: tenant.id };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Attachment ID is required' });
  }

  const auth = await getAuth(req);
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });

  // ============================================
  // GET — Return attachment details (blob URL)
  // ============================================
  if (req.method === 'GET') {
    try {
      const [attachment] = await db
        .select()
        .from(expenseAttachments)
        .where(
          and(
            eq(expenseAttachments.id, id),
            eq(expenseAttachments.tenantId, auth.tenantId)
          )
        )
        .limit(1);

      if (!attachment) {
        return res.status(404).json({ error: 'Attachment not found' });
      }

      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ attachment });
    } catch (error) {
      console.error('Get attachment error:', error);
      return res.status(500).json({ error: 'Failed to fetch attachment' });
    }
  }

  // ============================================
  // DELETE — Remove attachment record + delete blob
  // ============================================
  if (req.method === 'DELETE') {
    try {
      // Fetch the attachment (tenant-scoped)
      const [attachment] = await db
        .select()
        .from(expenseAttachments)
        .where(
          and(
            eq(expenseAttachments.id, id),
            eq(expenseAttachments.tenantId, auth.tenantId)
          )
        )
        .limit(1);

      if (!attachment) {
        return res.status(404).json({ error: 'Attachment not found' });
      }

      // Delete the blob from Vercel Blob storage
      await del(attachment.blobUrl, {
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });

      // Delete the database record
      await db
        .delete(expenseAttachments)
        .where(eq(expenseAttachments.id, id));

      return res.status(200).json({ success: true });
    } catch (error) {
      console.error('Delete attachment error:', error);
      return res.status(500).json({ error: 'Failed to delete attachment' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}