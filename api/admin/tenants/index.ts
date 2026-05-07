import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../../../src/db/index.js';
import { tenants } from '../../../src/db/schema.js';
import { isNull } from 'drizzle-orm';
import { authenticateSuperAdmin } from '../../_lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await authenticateSuperAdmin(req);
  if (!auth) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const allTenants = await db
      .select({
        id: tenants.id,
        name: tenants.name,
        subdomain: tenants.subdomain,
      })
      .from(tenants)
      .where(isNull(tenants.deletedAt))
      .orderBy(tenants.name);

    return res.status(200).json({ tenants: allTenants });
  } catch (err) {
    console.error('Error fetching tenants:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}