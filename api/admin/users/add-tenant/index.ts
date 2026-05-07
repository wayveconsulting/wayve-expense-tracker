import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../../../../src/db/index.js';
import { users, tenants, userTenantAccess } from '../../../../src/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { authenticateSuperAdmin } from '../../../_lib/auth.js';
import { Resend } from 'resend';
import { escapeHtml } from '../../../_lib/utils.js';

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await authenticateSuperAdmin(req);
  if (!auth) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { email, tenantId, role } = req.body ?? {};

  // --- Validation ---
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'email is required' });
  }

  if (!tenantId || typeof tenantId !== 'string') {
    return res.status(400).json({ error: 'tenantId is required' });
  }

  const validRoles = ['owner', 'member'];
  const cleanRole = typeof role === 'string' && validRoles.includes(role) ? role : 'owner';
  const cleanEmail = email.toLowerCase().trim();

  if (!cleanEmail.includes('@')) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  try {
    // --- 1. Verify tenant exists and is not soft-deleted ---
    const [tenant] = await db
      .select({
        id: tenants.id,
        name: tenants.name,
        subdomain: tenants.subdomain,
        deletedAt: tenants.deletedAt,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    if (!tenant) {
      return res.status(400).json({ error: 'Tenant not found' });
    }

    if (tenant.deletedAt) {
      return res.status(400).json({ error: 'Tenant is deleted' });
    }

    // --- 2. Look up user by email ---
    const [existingUser] = await db
      .select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(users)
      .where(eq(users.email, cleanEmail))
      .limit(1);

    if (!existingUser) {
      return res.status(404).json({
        error: 'No user found with that email address',
        hint: 'This email has not signed in yet. Send an invite instead.',
      });
    }

    // --- 3. Check for existing access ---
    const [existingAccess] = await db
      .select({ id: userTenantAccess.id })
      .from(userTenantAccess)
      .where(and(
        eq(userTenantAccess.userId, existingUser.id),
        eq(userTenantAccess.tenantId, tenantId),
      ))
      .limit(1);

    if (existingAccess) {
      return res.status(409).json({
        error: 'User already has access to this tenant',
      });
    }

    // --- 4. Grant access ---
    const [newAccess] = await db
      .insert(userTenantAccess)
      .values({
        userId: existingUser.id,
        tenantId,
        role: cleanRole,
      })
      .returning();

    // --- 5. Send notification email ---
    const tenantUrl = `https://${tenant.subdomain}.wayveexpenses.app/`;
    const firstName = existingUser.firstName || existingUser.email;

    try {
      await resend.emails.send({
        from: 'Wayve Expense Tracker <noreply@wayveconsulting.app>',
        to: cleanEmail,
        subject: `You've been added to ${tenant.name} on Wayve Expense Tracker`,
        text: `Hi ${firstName},\n\nYou've been granted access to ${tenant.name} on Wayve Expense Tracker.\n\nYou can access it directly at: ${tenantUrl}\n\nIf you have any questions, contact your administrator.\n\nWayve Consulting — Expense Tracking Made Simple`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
            <div style="text-align: center; margin-bottom: 32px;">
              <h1 style="color: #2A9D8F; margin: 0; font-size: 24px;">Wayve Expense Tracker</h1>
            </div>

            <p style="font-size: 16px; color: #333; line-height: 1.6;">
              Hi ${escapeHtml(firstName)},
            </p>

            <p style="font-size: 16px; color: #333; line-height: 1.6;">
              You've been granted access to <strong>${escapeHtml(tenant.name)}</strong> on Wayve Expense Tracker.
            </p>

            <div style="text-align: center; margin: 32px 0;">
              <a href="${tenantUrl}"
                 style="background: #2A9D8F; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: 600; display: inline-block;">
                Go to ${escapeHtml(tenant.name)}
              </a>
            </div>

            <p style="font-size: 14px; color: #666; line-height: 1.6;">
              If you have any questions, contact your administrator.
            </p>

            <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />

            <p style="font-size: 12px; color: #999; text-align: center;">
              Wayve Consulting &middot; Expense Tracking Made Simple
            </p>
          </div>
        `,
      });
    } catch (emailErr) {
      // Log but don't fail — access is granted, email is secondary
      console.error('Failed to send access notification email:', emailErr);
    }

    return res.status(201).json({
      access: newAccess,
      user: {
        id: existingUser.id,
        email: existingUser.email,
        firstName: existingUser.firstName,
        lastName: existingUser.lastName,
      },
      tenant: {
        id: tenant.id,
        name: tenant.name,
        subdomain: tenant.subdomain,
      },
      emailSent: true,
    });

  } catch (err) {
    console.error('Error adding user to tenant:', err);
    return res.status(500).json({ error: 'Failed to add user to tenant' });
  }
}