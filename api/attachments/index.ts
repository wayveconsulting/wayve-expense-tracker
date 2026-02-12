import type { VercelRequest, VercelResponse } from '@vercel/node';
import { put } from '@vercel/blob';
import { db } from '../../src/db/index.js';
import { sessions, expenseAttachments, expenses, users, userTenantAccess, tenants } from '../../src/db/schema.js';
import { eq, and } from 'drizzle-orm';

// Allowed MIME types
const ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'application/pdf',
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB (client-side compression handles large images before upload)

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
  // ============================================
  // POST — Upload file to Vercel Blob + record in DB
  // ============================================
  if (req.method === 'POST') {
    try {
      const auth = await getAuth(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });

      const { expenseId, fileName, fileType, fileData } = req.body || {};

      if (!expenseId || !fileName || !fileType || !fileData) {
        return res.status(400).json({ error: 'expenseId, fileName, fileType, and fileData are required' });
      }

      // Validate file type
      if (!ALLOWED_TYPES.includes(fileType)) {
        return res.status(400).json({ 
          error: `File type not allowed. Accepted: ${ALLOWED_TYPES.join(', ')}` 
        });
      }

      // Decode base64 file data
      const buffer = Buffer.from(fileData, 'base64');

      // Validate file size
      if (buffer.length > MAX_FILE_SIZE) {
        return res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
      }

      // Verify expense belongs to this tenant
      const [expense] = await db
        .select({ id: expenses.id })
        .from(expenses)
        .where(and(eq(expenses.id, expenseId), eq(expenses.tenantId, auth.tenantId)))
        .limit(1);

      if (!expense) {
        return res.status(404).json({ error: 'Expense not found' });
      }

      // Upload to Vercel Blob
      // Path: tenantId/expenseId/filename for organized storage
      const blobPath = `${auth.tenantId}/${expenseId}/${Date.now()}-${fileName}`;
      const blob = await put(blobPath, buffer, {
        access: 'public',
        contentType: fileType,
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });

      // Save attachment record
      const [attachment] = await db
        .insert(expenseAttachments)
        .values({
          tenantId: auth.tenantId,
          expenseId: expenseId,
          blobUrl: blob.url,
          fileName: fileName,
          fileSize: buffer.length,
          mimeType: fileType,
          sortOrder: 0,
          uploadedBy: auth.userId,
        })
        .returning();

      return res.status(201).json({ attachment });
    } catch (error) {
      console.error('Upload error:', error);
      return res.status(500).json({ error: 'Upload failed' });
    }
  }

  // ============================================
  // GET — List attachments for an expense
  // ============================================
  if (req.method === 'GET') {
    try {
      const auth = await getAuth(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });

      const expenseId = req.query.expenseId as string;
      if (!expenseId) {
        return res.status(400).json({ error: 'expenseId query param is required' });
      }

      const attachments = await db
        .select()
        .from(expenseAttachments)
        .where(
          and(
            eq(expenseAttachments.expenseId, expenseId),
            eq(expenseAttachments.tenantId, auth.tenantId)
          )
        )
        .orderBy(expenseAttachments.sortOrder, expenseAttachments.createdAt);

      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ attachments });
    } catch (error) {
      console.error('List attachments error:', error);
      return res.status(500).json({ error: 'Failed to fetch attachments' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}