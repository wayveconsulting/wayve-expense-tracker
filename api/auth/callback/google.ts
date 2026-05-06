import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../../../src/db/index.js';
import { users, sessions, userTenantAccess, tenants, invites, inviteTenants } from '../../../src/db/schema.js';
import { eq, and, inArray } from 'drizzle-orm';
import crypto from 'crypto';

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
  id_token?: string;
}

interface GoogleUserInfo {
  id: string;
  email: string;
  verified_email: boolean;
  name: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Cache-Control', 'no-store');

  const { code, state, error } = req.query;

  // Handle OAuth errors
  if (error) {
    console.error('Google OAuth error:', error);
    return res.redirect(`/login?error=${encodeURIComponent(String(error))}`);
  }

  if (!code || typeof code !== 'string') {
    return res.redirect('/login?error=missing_code');
  }

  // Parse state to get redirect URL (and CSRF token in future)
  let redirectTo = '/';
  if (state && typeof state === 'string') {
    try {
      const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
      redirectTo = stateData.redirectTo || '/';
    } catch {
      // Invalid state, use default redirect
    }
  }

  try {
    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: getRedirectUri(req),
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      console.error('Token exchange failed:', errorData);
      return res.redirect('/login?error=token_exchange_failed');
    }

    const tokens: GoogleTokenResponse = await tokenResponse.json();

    // Get user info from Google
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userInfoResponse.ok) {
      console.error('Failed to get user info');
      return res.redirect('/login?error=user_info_failed');
    }

    const googleUser: GoogleUserInfo = await userInfoResponse.json();

    if (!googleUser.verified_email) {
      return res.redirect('/login?error=email_not_verified');
    }

    // Look up user by email
    const existingUsers = await db
      .select()
      .from(users)
      .where(eq(users.email, googleUser.email.toLowerCase()))
      .limit(1);

    let user = existingUsers[0];

    if (!user) {
      // User not found — check for pending invite
      const [pendingInvite] = await db
        .select()
        .from(invites)
        .where(and(
          eq(invites.email, googleUser.email.toLowerCase()),
          eq(invites.status, 'pending'),
        ))
        .limit(1);

      if (!pendingInvite) {
        console.log(`Login attempt from uninvited user (Google sub: ${googleUser.id})`);
        return res.redirect('/login?error=not_invited');
      }

      // Check if invite is expired
      if (new Date(pendingInvite.expiresAt) < new Date()) {
        console.log(`Expired invite used (Google sub: ${googleUser.id})`);
        return res.redirect('/login?error=invite_expired');
      }

      // --- B4: Resolve tenant list for this invite ---
      // Check invite_tenants first (bulk invites). If empty, fall back to
      // the legacy invites.tenantId (single-tenant invites still in the system).
      const bulkTenantRows = await db
        .select({
          tenantId: inviteTenants.tenantId,
          subdomain: tenants.subdomain,
          role: inviteTenants.role,
        })
        .from(inviteTenants)
        .innerJoin(tenants, eq(inviteTenants.tenantId, tenants.id))
        .where(eq(inviteTenants.inviteId, pendingInvite.id));

      // Build the canonical tenant list for this acceptance.
      // bulkTenantRows is already ordered by DB insertion order (which matches
      // the order Amber selected them in the bulk invite form).
      type TenantEntry = { tenantId: string; subdomain: string; role: string };
      let tenantList: TenantEntry[];

      if (bulkTenantRows.length > 0) {
        // Bulk invite — use the junction table rows
        tenantList = bulkTenantRows;
      } else {
        // Legacy single-tenant invite — derive from invites.tenantId
        const [legacyTenant] = await db
          .select({ subdomain: tenants.subdomain })
          .from(tenants)
          .where(eq(tenants.id, pendingInvite.tenantId))
          .limit(1);

        if (!legacyTenant) {
          console.error(`Invite ${pendingInvite.id} has no valid tenant`);
          return res.redirect('/login?error=invalid_invite');
        }

        tenantList = [{
          tenantId: pendingInvite.tenantId,
          subdomain: legacyTenant.subdomain,
          role: pendingInvite.role || 'owner',
        }];
      }

      const primaryTenant = tenantList[0];

      // Create the new user with primary tenant set
      const [newUser] = await db
        .insert(users)
        .values({
          email: googleUser.email.toLowerCase(),
          firstName: googleUser.given_name || pendingInvite.firstName || null,
          lastName: googleUser.family_name || pendingInvite.lastName || null,
          googleId: googleUser.id,
          tenantId: primaryTenant.tenantId,
          lastTenantId: primaryTenant.tenantId,
          role: primaryTenant.role,
          emailVerified: true,
          isSuperAdmin: false,
          isAccountant: false,
        })
        .returning();

      // Batch-insert all user_tenant_access rows in one query (no N+1)
      await db.insert(userTenantAccess).values(
        tenantList.map((t) => ({
          userId: newUser.id,
          tenantId: t.tenantId,
          role: t.role,
        }))
      );

      // Mark invite as accepted
      await db
        .update(invites)
        .set({
          status: 'accepted',
          acceptedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(invites.id, pendingInvite.id));

      user = newUser;
    }

    // Update user's Google ID if not set (first OAuth login for existing user)
    if (!user.googleId) {
      await db
        .update(users)
        .set({
          googleId: googleUser.id,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));
    } else if (user.googleId !== googleUser.id) {
      // Google ID mismatch - potential account takeover attempt
      console.error(`Google ID mismatch for user ${user.id}`);
      return res.redirect('/login?error=account_mismatch');
    }

    // Create session
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    await db.insert(sessions).values({
      id: crypto.randomUUID(),
      userId: user.id,
      token: sessionToken,
      expiresAt,
      userAgent: req.headers['user-agent'] || null,
      ipAddress: (req.headers['x-forwarded-for'] as string)?.split(',')[0] || null,
    });

    // Set session cookie
    const isProduction = process.env.NODE_ENV === 'production';
    const cookieOptions = [
      `session=${sessionToken}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${30 * 24 * 60 * 60}`, // 30 days in seconds
      isProduction ? 'Secure' : '',
      isProduction ? `Domain=.wayveexpenses.app` : '',
    ].filter(Boolean).join('; ');

    res.setHeader('Set-Cookie', cookieOptions);

    // Stamp last login time
    await db
      .update(users)
      .set({ lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, user.id));

    // --- B5: Determine redirect target ---
    // Look up all tenant access for this user (one JOIN query, no N+1)
    const tenantAccessRecords = await db
      .select({
        tenantId: userTenantAccess.tenantId,
        subdomain: tenants.subdomain,
        name: tenants.name,
      })
      .from(userTenantAccess)
      .innerJoin(tenants, eq(userTenantAccess.tenantId, tenants.id))
      .where(eq(userTenantAccess.userId, user.id));

    // Also include primary tenant if not already in the access list (legacy users)
    let allTenantAccess = [...tenantAccessRecords];

    if (user.tenantId) {
      const alreadyIncluded = allTenantAccess.some((t) => t.tenantId === user.tenantId);
      if (!alreadyIncluded) {
        const [primaryTenant] = await db
          .select({ subdomain: tenants.subdomain, name: tenants.name })
          .from(tenants)
          .where(eq(tenants.id, user.tenantId))
          .limit(1);

        if (primaryTenant) {
          allTenantAccess.push({
            tenantId: user.tenantId,
            subdomain: primaryTenant.subdomain,
            name: primaryTenant.name,
          });
        }
      }
    }

    let finalRedirect = redirectTo;

    if (user.isSuperAdmin) {
      if (allTenantAccess.length === 1) {
        finalRedirect = `/?tenant=${allTenantAccess[0].subdomain}`;
      } else if (allTenantAccess.length > 1) {
        // TODO: tenant picker for super admins with multiple tenants
        console.log(`Super admin ${user.id} has ${allTenantAccess.length} tenants, defaulting to first`);
        finalRedirect = `/?tenant=${allTenantAccess[0].subdomain}`;
      } else {
        // Pure super admin with no tenant
        finalRedirect = '/admin';
      }
    } else if (user.isAccountant) {
      // TODO [MVP - Option B]: Build tenant picker page for accountants
      finalRedirect = '/dashboard';
    } else {
      // Regular user — B5 multi-tenant redirect logic
      if (allTenantAccess.length === 0) {
        return res.redirect('/login?error=no_tenant_access');
      } else if (allTenantAccess.length === 1) {
        // Single tenant — straightforward
        finalRedirect = `/?tenant=${allTenantAccess[0].subdomain}`;
      } else {
        // Multiple tenants — prefer lastTenantId, fall back to alphabetically first by name
        const lastVisited = user.lastTenantId
          ? allTenantAccess.find((t) => t.tenantId === user.lastTenantId)
          : null;

        if (lastVisited) {
          finalRedirect = `/?tenant=${lastVisited.subdomain}`;
        } else {
          // Sort by tenant name alphabetically and take the first
          const sorted = [...allTenantAccess].sort((a, b) =>
            a.name.localeCompare(b.name)
          );
          finalRedirect = `/?tenant=${sorted[0].subdomain}`;
        }
      }
    }

    return res.redirect(finalRedirect);

  } catch (err) {
    console.error('OAuth callback error:', err);
    return res.redirect('/login?error=server_error');
  }
}

function getRedirectUri(req: VercelRequest): string {
  const host = req.headers.host || 'localhost:5173';
  const protocol = host.includes('localhost') ? 'http' : 'https';

  // For subdomains, we need to use the main domain for OAuth callback
  // Google OAuth redirect URI must match exactly what's configured
  if (host.endsWith('.wayveexpenses.app') || host === 'wayveexpenses.app') {
    return 'https://wayveexpenses.app/api/auth/callback/google';
  }
  if (host.includes('vercel.app')) {
    return `https://${host}/api/auth/callback/google`;
  }

  return `${protocol}://${host}/api/auth/callback/google`;
}