import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../../src/db/index.js';
import { expenseAttachments, expenses } from '../../src/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { authenticateRequest } from '../_lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // ============================================
  // POST — Record attachment metadata (blob already uploaded via client upload)
  // ============================================
  if (req.method === 'POST') {
    try {
      const auth = await authenticateRequest(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });

      const { expenseId, blobUrl, fileName, fileType, fileSize } = req.body || {};

      if (!expenseId || !blobUrl || !fileName || !fileType || !fileSize) {
        return res.status(400).json({ 
          error: 'expenseId, blobUrl, fileName, fileType, and fileSize are required' 
        });
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

      // Save attachment record
      const [attachment] = await db
        .insert(expenseAttachments)
        .values({
          tenantId: auth.tenantId,
          expenseId: expenseId,
          blobUrl: blobUrl,
          fileName: fileName,
          fileSize: fileSize,
          mimeType: fileType,
          sortOrder: 0,
          uploadedBy: auth.user.id,
        })
        .returning();

      return res.status(201).json({ attachment });
    } catch (error) {
      console.error('Record attachment error:', error);
      return res.status(500).json({ error: 'Failed to record attachment' });
    }
  }

  // ============================================
  // GET — List attachments for an expense
  // ============================================
  if (req.method === 'GET') {
    try {
      const auth = await authenticateRequest(req);
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