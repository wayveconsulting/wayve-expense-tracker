import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../../../src/db/index.js';
import { users, sessions, userTenantAccess, tenants, invites } from '../../../src/db/schema.js';
import { eq, and } from 'drizzle-orm';
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

      // Invite is valid — create the user
      const [newUser] = await db
        .insert(users)
        .values({
          email: googleUser.email.toLowerCase(),
          firstName: googleUser.given_name || pendingInvite.firstName || null,
          lastName: googleUser.family_name || pendingInvite.lastName || null,
          googleId: googleUser.id,
          tenantId: pendingInvite.tenantId,
          role: pendingInvite.role || 'owner',
          emailVerified: true,
          isSuperAdmin: false,
          isAccountant: false,
        })
        .returning();

      // Create tenant access record
      await db.insert(userTenantAccess).values({
        userId: newUser.id,
        tenantId: pendingInvite.tenantId,
        role: pendingInvite.role || 'owner',
      });

      // Mark invite as accepted
      await db
        .update(invites)
        .set({
          status: 'accepted',
          acceptedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(invites.id, pendingInvite.id));

      // Use the newly created user going forward
      user = newUser;
    }

    // Update user's Google ID if not set (first OAuth login)
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
      isProduction ? `Domain=.wayveconsulting.app` : '',
    ].filter(Boolean).join('; ');

    res.setHeader('Set-Cookie', cookieOptions);

    // Determine where to redirect based on user type
    let finalRedirect = redirectTo;
    
    // Look up tenant access for ALL user types (including super admins)
    const tenantAccessRecords = await db
      .select({
        tenantId: userTenantAccess.tenantId,
        subdomain: tenants.subdomain,
      })
      .from(userTenantAccess)
      .innerJoin(tenants, eq(userTenantAccess.tenantId, tenants.id))
      .where(eq(userTenantAccess.userId, user.id));

    // Also check if user has a primary tenant (legacy/direct assignment)
    let allTenantAccess = [...tenantAccessRecords];
    
    if (user.tenantId) {
      const [primaryTenant] = await db
        .select({ subdomain: tenants.subdomain })
        .from(tenants)
        .where(eq(tenants.id, user.tenantId))
        .limit(1);
      
      if (primaryTenant && !allTenantAccess.some(t => t.subdomain === primaryTenant.subdomain)) {
        allTenantAccess.push({ tenantId: user.tenantId, subdomain: primaryTenant.subdomain });
      }
    }

    if (user.isSuperAdmin) {
      if (allTenantAccess.length === 1) {
        // Super admin with one tenant — redirect to their business
        finalRedirect = `/?tenant=${allTenantAccess[0].subdomain}`;
      } else if (allTenantAccess.length > 1) {
        // Super admin with multiple tenants — TODO: tenant picker
        // For now, default to first tenant
        console.log(`Super admin ${user.id} has ${allTenantAccess.length} tenants, defaulting to first`);
        finalRedirect = `/?tenant=${allTenantAccess[0].subdomain}`;
      } else {
        // Pure super admin with no tenant — go to admin
        finalRedirect = '/admin';
      }
    } else if (user.isAccountant) {
      // TODO [MVP - Option B]: Build tenant picker page for accountants
      // For now, accountants go to dashboard and will need to select a tenant
      finalRedirect = '/dashboard';
    } else {
      // Regular user
      if (allTenantAccess.length === 0) {
        return res.redirect('/login?error=no_tenant_access');
      } else if (allTenantAccess.length === 1) {
        finalRedirect = `/?tenant=${allTenantAccess[0].subdomain}`;
      } else {
        // TODO [MVP - Option B]: Multiple tenants - show tenant picker
        console.log(`User ${user.id} has ${allTenantAccess.length} tenants, defaulting to first`);
        finalRedirect = `/?tenant=${allTenantAccess[0].subdomain}`;
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
  if (host.includes('wayveconsulting.app')) {
    return 'https://wayveconsulting.app/api/auth/callback/google';
  }
  if (host.includes('vercel.app')) {
    return `https://${host}/api/auth/callback/google`;
  }
  
  return `${protocol}://${host}/api/auth/callback/google`;
}