import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../src/db/index.js';
import { tenants } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const subdomain = req.query.subdomain as string;

  if (!subdomain) {
    return res.status(400).json({ error: 'Subdomain is required' });
  }

  try {
    const tenant = await db
      .select({
        id: tenants.id,
        name: tenants.name,
        subdomain: tenants.subdomain,
        logoUrl: tenants.logoUrl,
        primaryColor: tenants.primaryColor,
        appName: tenants.appName,
        isActive: tenants.isActive,
      })
      .from(tenants)
      .where(eq(tenants.subdomain, subdomain.toLowerCase()))
      .limit(1);

    if (tenant.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    if (!tenant[0].isActive) {
      return res.status(403).json({ error: 'Tenant is inactive' });
    }

    return res.status(200).json(tenant[0]);
  } catch (error) {
    console.error('Tenant lookup error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}