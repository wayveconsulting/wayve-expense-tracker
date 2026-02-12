import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { db } from '../../src/db/index.js';
import { sessions, users, userTenantAccess, tenants } from '../../src/db/schema.js';
import { eq, and } from 'drizzle-orm';

// Allowed MIME types
const ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'application/pdf',
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Auth helper — same pattern as other endpoints
async function getAuth(req: VercelRequest) {
  const sessionToken = req.cookies?.session;
  if (!sessionToken) return null;

  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.token, sessionToken))
    .limit(1);

  if (!session || new Date(session.expiresAt) < new Date()) return null;

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  if (!user) return null;

  const tenantSubdomain = req.query.tenant as string | undefined;
  if (!tenantSubdomain) return null;

  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.subdomain, tenantSubdomain))
    .limit(1);

  if (!tenant) return null;

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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const auth = await getAuth(req);
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
            userId: auth.userId,
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