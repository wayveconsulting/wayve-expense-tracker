import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../../../../src/db/index.js';
import { tenants, invites, inviteTenants } from '../../../../src/db/schema.js';
import { eq, inArray } from 'drizzle-orm';
import crypto from 'crypto';
import { Resend } from 'resend';
import { escapeHtml } from '../../../_lib/utils.js';
import { authenticateSuperAdmin } from '../../../_lib/auth.js';

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

  const { email, firstName, lastName, tenantIds } = req.body ?? {};

  // --- Validation ---
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'email is required' });
  }

  if (!Array.isArray(tenantIds) || tenantIds.length === 0) {
    return res.status(400).json({ error: 'tenantIds must be a non-empty array' });
  }

  if (!tenantIds.every((id: unknown) => typeof id === 'string')) {
    return res.status(400).json({ error: 'All tenantIds must be strings' });
  }

  const cleanEmail = email.toLowerCase().trim();
  if (!cleanEmail.includes('@')) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  // --- Check for duplicate pending invite ---
  const [existingInvite] = await db
    .select({ id: invites.id })
    .from(invites)
    .where(eq(invites.email, cleanEmail))
    .limit(1);

  if (existingInvite) {
    return res.status(409).json({ error: 'A pending invite already exists for this email' });
  }

  // --- Verify all tenants exist and are not soft-deleted ---
  const validTenants = await db
    .select({ id: tenants.id, name: tenants.name })
    .from(tenants)
    .where(inArray(tenants.id, tenantIds));

  const validTenantIds = new Set(validTenants.map(t => t.id));
  const invalidIds = tenantIds.filter((id: string) => !validTenantIds.has(id));

  if (invalidIds.length > 0) {
    return res.status(400).json({
      error: 'One or more tenantIds are invalid or deleted',
      invalidIds,
    });
  }

  // Preserve the order the caller supplied for the email listing
  const orderedTenants = tenantIds.map((id: string) =>
    validTenants.find(t => t.id === id)!
  );

  try {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    // --- 1. Create invite row (tenantId = first tenant for legacy compat) ---
    const [newInvite] = await db
      .insert(invites)
      .values({
        email: cleanEmail,
        firstName: firstName?.trim() || null,
        lastName: lastName?.trim() || null,
        tenantId: orderedTenants[0].id,
        role: 'owner',
        invitedBy: auth.user.id,
        token,
        status: 'pending',
        expiresAt,
      })
      .returning();

    // --- 2. Insert invite_tenants rows (one per tenant) ---
    await db.insert(inviteTenants).values(
      orderedTenants.map(t => ({
        inviteId: newInvite.id,
        tenantId: t.id,
        role: 'owner' as const,
      }))
    );

    // --- 3. Send invite email ---
    const inviteUrl = `https://wayveexpenses.app/invite?token=${token}`;
    const expiryDate = expiresAt.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const tenantListText = orderedTenants.map(t => `  • ${t.name}`).join('\n');
    const tenantListHtml = orderedTenants
      .map(t => `<li style="margin: 4px 0;">${escapeHtml(t.name)}</li>`)
      .join('');

    try {
      await resend.emails.send({
        from: 'Wayve Expense Tracker <noreply@wayveconsulting.app>',
        to: cleanEmail,
        subject: `You've been invited to Wayve Expense Tracker`,
        text: `You've been invited to manage expenses for the following businesses on Wayve Expense Tracker:\n\n${tenantListText}\n\nGet started by visiting: ${inviteUrl}\n\nYou'll sign in with your Google account — no new password needed.\n\nThis invite expires on ${expiryDate}. If you have any questions, contact your administrator.\n\nWayve Consulting — Expense Tracking Made Simple`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
            <div style="text-align: center; margin-bottom: 32px;">
              <h1 style="color: #2A9D8F; margin: 0; font-size: 24px;">Wayve Expense Tracker</h1>
            </div>

            <p style="font-size: 16px; color: #333; line-height: 1.6;">
              You've been invited to manage expenses for the following businesses:
            </p>

            <ul style="font-size: 16px; color: #333; line-height: 1.8; padding-left: 24px;">
              ${tenantListHtml}
            </ul>

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
      // Log but don't fail — invite is created, email can be resent
      console.error('Failed to send bulk invite email:', emailErr);
    }

    return res.status(201).json({
      invite: newInvite,
      tenants: orderedTenants,
      emailSent: true,
    });

  } catch (err) {
    console.error('Error creating bulk invite:', err);
    return res.status(500).json({ error: 'Failed to create bulk invite' });
  }
}