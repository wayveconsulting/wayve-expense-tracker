import type { VercelRequest } from '@vercel/node';
import { db } from '../../src/db/index.js';
import { sessions, users, userTenantAccess, tenants } from '../../src/db/schema.js';
import { eq, and } from 'drizzle-orm';

export interface AuthResult {
  user: {
    id: string;
    email: string;
    isSuperAdmin: boolean;
    isAccountant: boolean;
  };
  tenantId: string;
  sessionId: string;
}

/**
 * Authenticate a request by validating the session cookie,
 * resolving the tenant from ?tenant= query param, and
 * verifying the user has access to that tenant.
 *
 * Returns null if any step fails — caller is responsible
 * for returning 401 to the client.
 */
export async function authenticateRequest(
  req: VercelRequest
): Promise<AuthResult | null> {
  // 1. Parse session token from cookie
  const sessionToken = req.cookies?.session;
  if (!sessionToken) return null;

  // 2. Look up session and verify not expired
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.token, sessionToken))
    .limit(1);

  if (!session || new Date(session.expiresAt) < new Date()) return null;

  // 3. Look up user
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      isSuperAdmin: users.isSuperAdmin,
      isAccountant: users.isAccountant,
    })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  if (!user) return null;

  // 4. Resolve tenant from query param
  const tenantSubdomain = req.query.tenant as string | undefined;
  if (!tenantSubdomain) return null;

  const [tenant] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.subdomain, tenantSubdomain))
    .limit(1);

  if (!tenant) return null;

  // 5. Verify user has access to this tenant
  const [hasAccess] = await db
    .select()
    .from(userTenantAccess)
    .where(and(
      eq(userTenantAccess.userId, user.id),
      eq(userTenantAccess.tenantId, tenant.id)
    ))
    .limit(1);

  if (!hasAccess && !user.isSuperAdmin) return null;

  return {
    user,
    tenantId: tenant.id,
    sessionId: session.id,
  };
}
