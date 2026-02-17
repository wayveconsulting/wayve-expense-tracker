import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { authenticateRequest } from '../_lib/auth.js';

// Allowed MIME types
const ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'application/pdf',
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const auth = await authenticateRequest(req);
    if (!auth) return res.status(401).json({ error: 'Unauthorized' });

    const body = req.body as HandleUploadBody;

    const jsonResponse = await handleUpload({
      body,
      request: req as any, // VercelRequest is compatible with the expected type
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        // clientPayload contains our expenseId + tenantId for validation
        // Auth already verified above — user has access to this tenant

        return {
          allowedContentTypes: ALLOWED_TYPES,
          maximumSizeInBytes: MAX_FILE_SIZE,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({
            userId: auth.user.id,
            tenantId: auth.tenantId,
            clientPayload,
          }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // This callback is called by Vercel's servers when upload completes.
        // It won't work on localhost (Vercel can't reach it).
        // We don't rely on it — the client records the attachment via POST /api/attachments.
        // This is just a safety net for production if we ever need server-side post-processing.
        console.log('Client upload completed:', blob.pathname);
      },
    });

    return res.status(200).json(jsonResponse);
  } catch (error) {
    console.error('Upload token error:', error);
    return res.status(400).json({ error: (error as Error).message });
  }
}