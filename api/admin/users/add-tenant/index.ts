import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../../../../src/db/index.js';
import { users, tenants, userTenantAccess } from '../../../../src/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { authenticateSuperAdmin } from '../../../_lib/auth.js';

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
      .select({ id: tenants.id, name: tenants.name, deletedAt: tenants.deletedAt })
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
      },
    });

  } catch (err) {
    console.error('Error adding user to tenant:', err);
    return res.status(500).json({ error: 'Failed to add user to tenant' });
  }
}