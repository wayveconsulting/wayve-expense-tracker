import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../../../src/db/index.js';
import { users, sessions, tenants, categories, invites } from '../../../src/db/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import crypto from 'crypto';
import { Resend } from 'resend';
import { DEFAULT_CATEGORIES, UNCATEGORIZED_CATEGORY } from '../../../src/db/default-categories.js';

const resend = new Resend(process.env.RESEND_API_KEY);

// Helper: authenticate and verify super admin
async function authenticateSuperAdmin(req: VercelRequest): Promise<{ user: typeof users.$inferSelect } | null> {
  const cookies = req.headers.cookie || '';
  const sessionToken = cookies.split(';').map(c => c.trim()).find(c => c.startsWith('session='))?.split('=')[1];

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

  if (!user || !user.isSuperAdmin) return null;

  return { user };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    return handleGet(req, res);
  } else if (req.method === 'POST') {
    return handlePost(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

// ============================================
// GET — List all invites
// ============================================
async function handleGet(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateSuperAdmin(req);
  if (!auth) return res.status(403).json({ error: 'Forbidden' });

  try {
    const allInvites = await db
      .select({
        id: invites.id,
        email: invites.email,
        firstName: invites.firstName,
        lastName: invites.lastName,
        role: invites.role,
        status: invites.status,
        expiresAt: invites.expiresAt,
        acceptedAt: invites.acceptedAt,
        createdAt: invites.createdAt,
        tenantName: tenants.name,
        tenantSubdomain: tenants.subdomain,
        invitedByFirstName: users.firstName,
        invitedByLastName: users.lastName,
        invitedByEmail: users.email,
      })
      .from(invites)
      .innerJoin(tenants, eq(invites.tenantId, tenants.id))
      .innerJoin(users, eq(invites.invitedBy, users.id))
      .orderBy(desc(invites.createdAt));

    // Auto-expire: if pending and past expiry, mark as expired in response
    const now = new Date();
    const enriched = allInvites.map(invite => ({
      ...invite,
      status: invite.status === 'pending' && new Date(invite.expiresAt) < now
        ? 'expired'
        : invite.status,
    }));

    return res.status(200).json({ invites: enriched });
  } catch (err) {
    console.error('Error fetching invites:', err);
    return res.status(500).json({ error: 'Failed to fetch invites' });
  }
}

// ============================================
// POST — Create tenant + seed categories + invite + send email
// ============================================
async function handlePost(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateSuperAdmin(req);
  if (!auth) return res.status(403).json({ error: 'Forbidden' });

  const { email, firstName, lastName, businessName, subdomain } = req.body;

  // --- Validation ---
  if (!email || !businessName || !subdomain) {
    return res.status(400).json({ error: 'Email, business name, and subdomain are required' });
  }

  const cleanEmail = email.toLowerCase().trim();
  const cleanSubdomain = subdomain.toLowerCase().trim().replace(/[^a-z0-9]/g, '');

  if (!cleanEmail.includes('@')) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  if (cleanSubdomain.length < 3) {
    return res.status(400).json({ error: 'Subdomain must be at least 3 characters' });
  }

  if (cleanSubdomain.length > 30) {
    return res.status(400).json({ error: 'Subdomain must be 30 characters or fewer' });
  }

  // Check subdomain uniqueness
  const [existingTenant] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.subdomain, cleanSubdomain))
    .limit(1);

  if (existingTenant) {
    return res.status(409).json({ error: 'Subdomain already taken' });
  }

  // Check for duplicate pending invite
  const [existingInvite] = await db
    .select({ id: invites.id })
    .from(invites)
    .where(and(
      eq(invites.email, cleanEmail),
      eq(invites.status, 'pending'),
    ))
    .limit(1);

  if (existingInvite) {
    return res.status(409).json({ error: 'A pending invite already exists for this email' });
  }

  try {
    // --- 1. Create tenant ---
    const [newTenant] = await db
      .insert(tenants)
      .values({
        name: businessName.trim(),
        subdomain: cleanSubdomain,
        createdBy: auth.user.id,
      })
      .returning({ id: tenants.id });

    // --- 2. Seed default categories ---
    const categoryValues = [
      ...DEFAULT_CATEGORIES.map((cat, index) => ({
        tenantId: newTenant.id,
        name: cat.name,
        emoji: cat.emoji,
        expenseType: cat.expenseType,
        homeOfficeEligible: cat.homeOfficeEligible,
        isSystem: false,
        sortOrder: index + 1,
      })),
      {
        tenantId: newTenant.id,
        name: UNCATEGORIZED_CATEGORY.name,
        emoji: UNCATEGORIZED_CATEGORY.emoji,
        expenseType: UNCATEGORIZED_CATEGORY.expenseType,
        homeOfficeEligible: UNCATEGORIZED_CATEGORY.homeOfficeEligible,
        isSystem: true,
        sortOrder: 0,
      },
    ];

    await db.insert(categories).values(categoryValues);

    // --- 3. Create invite ---
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    const [newInvite] = await db
      .insert(invites)
      .values({
        email: cleanEmail,
        firstName: firstName?.trim() || null,
        lastName: lastName?.trim() || null,
        tenantId: newTenant.id,
        role: 'owner',
        invitedBy: auth.user.id,
        token,
        status: 'pending',
        expiresAt,
      })
      .returning();

    // --- 4. Send invite email ---
    const inviteUrl = `https://wayveconsulting.app/invite?token=${token}`;
    const expiryDate = expiresAt.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    try {
      await resend.emails.send({
        from: 'Wayve Expense Tracker <noreply@wayveconsulting.app>',
        to: cleanEmail,
        subject: `You've been invited to Wayve Expense Tracker`,
        text: `You've been invited to manage expenses for ${businessName.trim()} on Wayve Expense Tracker.\n\nGet started by visiting: ${inviteUrl}\n\nYou'll sign in with your Google account — no new password needed.\n\nThis invite expires on ${expiryDate}. If you have any questions, contact your administrator.\n\nWayve Consulting — Expense Tracking Made Simple`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
            <div style="text-align: center; margin-bottom: 32px;">
              <h1 style="color: #2A9D8F; margin: 0; font-size: 24px;">Wayve Expense Tracker</h1>
            </div>
            
            <p style="font-size: 16px; color: #333; line-height: 1.6;">
              You've been invited to manage expenses for <strong>${businessName.trim()}</strong>.
            </p>
            
            <p style="font-size: 16px; color: #333; line-height: 1.6;">
              Click the button below to set up your account. You'll sign in with your Google account — no new password needed.
            </p>
            
            <div style="text-align: center; margin: 32px 0;">
              <a href="${inviteUrl}" 
                 style="background: #2A9D8F; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: 600; display: inline-block;">
                Get Started
              </a>
            </div>
            
            <p style="font-size: 14px; color: #666; line-height: 1.6;">
              This invite expires on ${expiryDate}. If you have any questions, contact your administrator.
            </p>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />
            
            <p style="font-size: 12px; color: #999; text-align: center;">
              Wayve Consulting &middot; Expense Tracking Made Simple
            </p>
          </div>
        `,
      });
    } catch (emailErr) {
      // Log but don't fail — the invite is created, email can be resent
      console.error('Failed to send invite email:', emailErr);
    }

    return res.status(201).json({
      invite: newInvite,
      tenant: { id: newTenant.id, subdomain: cleanSubdomain },
      emailSent: true,
    });

  } catch (err) {
    console.error('Error creating invite:', err);
    return res.status(500).json({ error: 'Failed to create invite' });
  }
}