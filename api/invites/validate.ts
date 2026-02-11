import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../../src/db/index.js';
import { invites, tenants } from '../../src/db/schema.js';
import { eq } from 'drizzle-orm';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token } = req.query;

  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Missing token' });
  }

  try {
    const [invite] = await db
      .select({
        id: invites.id,
        email: invites.email,
        status: invites.status,
        expiresAt: invites.expiresAt,
        tenantName: tenants.name,
      })
      .from(invites)
      .innerJoin(tenants, eq(invites.tenantId, tenants.id))
      .where(eq(invites.token, token))
      .limit(1);

    if (!invite) {
      return res.status(404).json({ error: 'Invalid invite link', valid: false });
    }

    if (invite.status === 'accepted') {
      return res.status(200).json({ valid: false, reason: 'already_used', businessName: invite.tenantName });
    }

    if (invite.status === 'expired' || new Date(invite.expiresAt) < new Date()) {
      return res.status(200).json({ valid: false, reason: 'expired', businessName: invite.tenantName });
    }

    return res.status(200).json({
      valid: true,
      businessName: invite.tenantName,
      email: invite.email,
    });

  } catch (err) {
    console.error('Error validating invite:', err);
    return res.status(500).json({ error: 'Failed to validate invite' });
  }
}