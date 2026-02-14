import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../../../src/db/index.js';
import { users, sessions, tenants, invites } from '../../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';
import { Resend } from 'resend';
import { escapeHtml } from '../../_lib/utils.js';

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth check — super admin only
  const cookies = req.headers.cookie || '';
  const sessionToken = cookies.split(';').map(c => c.trim()).find(c => c.startsWith('session='))?.split('=')[1];

  if (!sessionToken) return res.status(401).json({ error: 'Not authenticated' });

  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.token, sessionToken))
    .limit(1);

  if (!session || new Date(session.expiresAt) < new Date()) {
    return res.status(401).json({ error: 'Session expired' });
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  if (!user || !user.isSuperAdmin) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Get invite ID from URL
  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Missing invite ID' });
  }

  try {
    // Look up the invite
    const [invite] = await db
      .select()
      .from(invites)
      .where(eq(invites.id, id))
      .limit(1);

    if (!invite) {
      return res.status(404).json({ error: 'Invite not found' });
    }

    if (invite.status === 'accepted') {
      return res.status(400).json({ error: 'Invite already accepted — cannot resend' });
    }

    // Generate new token and reset expiry
    const newToken = crypto.randomBytes(32).toString('hex');
    const newExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    await db
      .update(invites)
      .set({
        token: newToken,
        status: 'pending',
        expiresAt: newExpiresAt,
        updatedAt: new Date(),
      })
      .where(eq(invites.id, id));

    // Get tenant name for the email
    const [tenant] = await db
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, invite.tenantId))
      .limit(1);

    const businessName = tenant?.name || 'your business';

    // Send email
    const inviteUrl = `https://wayveconsulting.app/invite?token=${newToken}`;
    const expiryDate = newExpiresAt.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    try {
      await resend.emails.send({
        from: 'Wayve Expense Tracker <noreply@wayveconsulting.app>',
        to: invite.email,
        subject: `You've been invited to Wayve Expense Tracker`,
        text: `You've been invited to manage expenses for ${businessName} on Wayve Expense Tracker.\n\nGet started by visiting: ${inviteUrl}\n\nYou'll sign in with your Google account — no new password needed.\n\nThis invite expires on ${expiryDate}. If you have any questions, contact your administrator.\n\nWayve Consulting — Expense Tracking Made Simple`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
            <div style="text-align: center; margin-bottom: 32px;">
              <h1 style="color: #2A9D8F; margin: 0; font-size: 24px;">Wayve Expense Tracker</h1>
            </div>
            
            <p style="font-size: 16px; color: #333; line-height: 1.6;">
              You've been invited to manage expenses for <strong>${escapeHtml(businessName)}</strong>.
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
      console.error('Failed to resend invite email:', emailErr);
    }

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('Error resending invite:', err);
    return res.status(500).json({ error: 'Failed to resend invite' });
  }
}