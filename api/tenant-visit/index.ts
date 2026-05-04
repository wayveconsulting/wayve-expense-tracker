import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../../src/db/index.js';
import { sessions, users, userTenantAccess } from '../../src/db/schema.js';
import { eq, and } from 'drizzle-orm';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // 1. Validate session cookie
  const sessionToken = req.cookies?.session;
  if (!sessionToken) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.token, sessionToken))
    .limit(1);

  if (!session || new Date(session.expiresAt) < new Date()) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // 2. Look up user
  const [user] = await db
    .select({
      id: users.id,
      isSuperAdmin: users.isSuperAdmin,
    })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // 3. Validate tenantId from request body
  const { tenantId } = req.body ?? {};
  if (!tenantId || typeof tenantId !== 'string') {
    res.status(400).json({ error: 'tenantId is required' });
    return;
  }

  // 4. Verify user has access to this tenant (super admins bypass)
  if (!user.isSuperAdmin) {
    const [hasAccess] = await db
      .select()
      .from(userTenantAccess)
      .where(
        and(
          eq(userTenantAccess.userId, user.id),
          eq(userTenantAccess.tenantId, tenantId)
        )
      )
      .limit(1);

    if (!hasAccess) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
  }

  // 5. Update last visited tenant
  await db
    .update(users)
    .set({ lastTenantId: tenantId })
    .where(eq(users.id, user.id));

  res.status(204).end();
}