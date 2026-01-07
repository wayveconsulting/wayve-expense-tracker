import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../../src/db/index.js';
import { users, sessions, tenants, userTenantAccess } from '../../src/db/schema.js';
import { eq, and, gt } from 'drizzle-orm';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Parse session cookie
  const cookies = parseCookies(req.headers.cookie || '');
  const sessionToken = cookies.session;

  if (!sessionToken) {
    return res.status(401).json({ error: 'Not authenticated', user: null });
  }

  try {
    // Look up session (must be valid and not expired)
    const validSessions = await db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.token, sessionToken),
          gt(sessions.expiresAt, new Date())
        )
      )
      .limit(1);

    const session = validSessions[0];

    if (!session) {
      // Invalid or expired session - clear the cookie
      res.setHeader('Set-Cookie', 'session=; Path=/; HttpOnly; Max-Age=0');
      return res.status(401).json({ error: 'Session expired', user: null });
    }

    // Get user data
    const userResults = await db
      .select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        tenantId: users.tenantId,
        role: users.role,
        isSuperAdmin: users.isSuperAdmin,
        isAccountant: users.isAccountant,
        theme: users.theme,
      })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);

    const user = userResults[0];

    if (!user) {
      // User was deleted but session still exists
      res.setHeader('Set-Cookie', 'session=; Path=/; HttpOnly; Max-Age=0');
      return res.status(401).json({ error: 'User not found', user: null });
    }

    // Get user's tenant access (all tenants they can access)
    const tenantAccessResults = await db
      .select({
        tenantId: userTenantAccess.tenantId,
        role: userTenantAccess.role,
        canEdit: userTenantAccess.canEdit,
        tenant: {
          id: tenants.id,
          name: tenants.name,
          subdomain: tenants.subdomain,
          logoUrl: tenants.logoUrl,
        },
      })
      .from(userTenantAccess)
      .innerJoin(tenants, eq(userTenantAccess.tenantId, tenants.id))
      .where(eq(userTenantAccess.userId, user.id));

    // If user has a primary tenant, get its details too
    let primaryTenant = null;
    if (user.tenantId) {
      const primaryTenantResults = await db
        .select({
          id: tenants.id,
          name: tenants.name,
          subdomain: tenants.subdomain,
          logoUrl: tenants.logoUrl,
          primaryColor: tenants.primaryColor,
          appName: tenants.appName,
        })
        .from(tenants)
        .where(eq(tenants.id, user.tenantId))
        .limit(1);
      
      primaryTenant = primaryTenantResults[0] || null;
    }

    return res.status(200).json({
      user: {
        ...user,
        primaryTenant,
        tenantAccess: tenantAccessResults,
      },
    });

  } catch (err) {
    console.error('Session validation error:', err);
    return res.status(500).json({ error: 'Server error', user: null });
  }
}

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  
  cookieHeader.split(';').forEach(cookie => {
    const [name, ...rest] = cookie.trim().split('=');
    if (name && rest.length > 0) {
      cookies[name] = rest.join('=');
    }
  });
  
  return cookies;
}