import type { VercelRequest, VercelResponse } from '@vercel/node';
import { put } from '@vercel/blob';
import { db } from '../../src/db/index.js';
import { sessions, expenseAttachments, expenses } from '../../src/db/schema.js';
import { eq, and } from 'drizzle-orm';

// Allowed MIME types
const ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'application/pdf',
];

const MAX_FILE_SIZE = 4 * 1024 * 1024; // 4MB (Vercel function body limit safety margin)

// Auth helper — returns { userId, tenantId } or null
async function getAuth(req: VercelRequest) {
  console.log('ATTACH DEBUG cookies:', JSON.stringify(req.cookies));
  console.log('ATTACH DEBUG cookie header:', req.headers.cookie);
  const sessionToken = req.cookies?.session;
  if (!sessionToken) return null;

  const [session] = await db
    .select({ userId: sessions.userId, tenantId: sessions.tenantId })
    .from(sessions)
    .where(eq(sessions.token, sessionToken))
    .limit(1);

  if (!session || !session.tenantId) return null;
  if (!session.userId) return null;
  return { userId: session.userId, tenantId: session.tenantId };
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
        return res.status(400).json({ error: 'File too large. Maximum size is 4MB.' });
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