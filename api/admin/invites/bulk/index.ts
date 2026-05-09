import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../../../../src/db/index.js';
import { tenants, invites, inviteTenants } from '../../../../src/db/schema.js';
import { eq, inArray } from 'drizzle-orm';
import crypto from 'crypto';
import { Resend } from 'resend';
import { escapeHtml } from '../../../_lib/utils.js';
import { authenticateSuperAdmin } from '../../../_lib/auth.js';

const resend = new Resend(process.env.RESEND_API_KEY);

interface NewTenantInput {
  businessName: string;
  subdomain: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await authenticateSuperAdmin(req);
  if (!auth) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { email, firstName, lastName, tenantIds = [], newTenants = [] } = req.body ?? {};

  // --- Validate email ---
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'email is required' });
  }

  const cleanEmail = email.toLowerCase().trim();
  if (!cleanEmail.includes('@')) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  // --- Validate at least one tenant source ---
  const hasExistingTenants = Array.isArray(tenantIds) && tenantIds.length > 0;
  const hasNewTenants = Array.isArray(newTenants) && newTenants.length > 0;

  if (!hasExistingTenants && !hasNewTenants) {
    return res.status(400).json({ error: 'At least one tenant must be selected or created' });
  }

  // --- Validate tenantIds are strings ---
  if (hasExistingTenants && !tenantIds.every((id: unknown) => typeof id === 'string')) {
    return res.status(400).json({ error: 'All tenantIds must be strings' });
  }

  // --- Validate newTenants shape ---
  if (hasNewTenants) {
    for (const t of newTenants as NewTenantInput[]) {
      if (!t.businessName || typeof t.businessName !== 'string' || !t.businessName.trim()) {
        return res.status(400).json({ error: 'Each new tenant must have a businessName' });
      }
      if (!t.subdomain || typeof t.subdomain !== 'string') {
        return res.status(400).json({ error: 'Each new tenant must have a subdomain' });
      }
      const cleanSub = t.subdomain.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (cleanSub.length < 3) {
        return res.status(400).json({ error: `Subdomain "${t.subdomain}" must be at least 3 characters` });
      }
    }
  }

  // --- Check for duplicate pending invite (cheap early exit) ---
  const [existingInvite] = await db
    .select({ id: invites.id })
    .from(invites)
    .where(eq(invites.email, cleanEmail))
    .limit(1);

  if (existingInvite) {
    return res.status(409).json({ error: 'A pending invite already exists for this email' });
  }

  // --- Verify existing tenants exist (pre-write check) ---
  let verifiedExistingTenants: { id: string; name: string }[] = [];

  if (hasExistingTenants) {
    verifiedExistingTenants = await db
      .select({ id: tenants.id, name: tenants.name })
      .from(tenants)
      .where(inArray(tenants.id, tenantIds));

    const validTenantIds = new Set(verifiedExistingTenants.map(t => t.id));
    const invalidIds = tenantIds.filter((id: string) => !validTenantIds.has(id));

    if (invalidIds.length > 0) {
      return res.status(400).json({
        error: 'One or more tenantIds are invalid or deleted',
        invalidIds,
      });
    }

    // Preserve caller-supplied order
    verifiedExistingTenants = tenantIds.map((id: string) =>
      verifiedExistingTenants.find(t => t.id === id)!
    );
  }

  // --- Pre-validate subdomain uniqueness before any writes ---
  if (hasNewTenants) {
    for (const t of newTenants as NewTenantInput[]) {
      const cleanSub = t.subdomain.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30);
      const [existing] = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.subdomain, cleanSub))
        .limit(1);

      if (existing) {
        return res.status(409).json({
          error: `Subdomain "${cleanSub}" is already taken`,
        });
      }
    }
  }

  // --- Sequential inserts (neon-http does not support transactions) ---
  // All validation is complete above. Partial-write risk is minimal.
  // If invite/inviteTenants inserts fail after tenants are created, we
  // attempt to clean up the newly created tenants before returning 500.

  const createdTenantIds: string[] = [];

  try {
    // 1. Create new tenants
    const createdTenants: { id: string; name: string }[] = [];

    if (hasNewTenants) {
      for (const t of newTenants as NewTenantInput[]) {
        const cleanSub = t.subdomain.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30);
        const cleanName = t.businessName.trim();

        const [created] = await db
          .insert(tenants)
          .values({
            name: cleanName,
            subdomain: cleanSub,
          })
          .returning({ id: tenants.id, name: tenants.name });

        createdTenants.push(created);
        createdTenantIds.push(created.id);
      }
    }

    // 2. Merge existing + newly created (existing first, preserving order)
    const orderedTenants = [...verifiedExistingTenants, ...createdTenants];

    // 3. Create invite row (tenantId = first tenant for legacy compat)
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

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

    // 4. Insert invite_tenants rows (one per tenant)
    await db.insert(inviteTenants).values(
      orderedTenants.map(t => ({
        inviteId: newInvite.id,
        tenantId: t.id,
        role: 'owner' as const,
      }))
    );

    // --- Send invite email (outside writes — email failure does not roll back DB) ---
    const inviteUrl = `https://wayveexpenses.app/invite?token=${newInvite.token}`;
    const expiryDate = new Date(newInvite.expiresAt).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const tenantListText = orderedTenants.map(t => `  • ${t.name}`).join('\n');
    const tenantListHtml = orderedTenants
      .map(t => `<li style="margin: 4px 0;">${escapeHtml(t.name)}</li>`)
      .join('');

    let emailSent = true;
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
      // Log but don't fail — invite is created, email can be resent manually
      console.error('Failed to send bulk invite email:', emailErr);
      emailSent = false;
    }

    return res.status(201).json({
      invite: newInvite,
      tenants: orderedTenants,
      emailSent,
    });

  } catch (err) {
    // Attempt cleanup of any tenants created before the failure
    if (createdTenantIds.length > 0) {
      try {
        await db
          .delete(tenants)
          .where(inArray(tenants.id, createdTenantIds));
        console.log(`Cleaned up ${createdTenantIds.length} orphaned tenant(s) after invite failure`);
      } catch (cleanupErr) {
        console.error('Failed to clean up orphaned tenants:', cleanupErr);
      }
    }

    console.error('Error creating bulk invite:', err);
    return res.status(500).json({ error: 'Failed to create bulk invite' });
  }
}
