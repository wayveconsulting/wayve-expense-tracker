import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticateRequest } from '../_lib/auth.js';
import { recordUsage } from '../_lib/rate-limit.js';

// Valid beacon action types (prevent arbitrary strings)
const VALID_ACTIONS = new Set([
  'places_autocomplete',
  'distance_matrix',
]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await authenticateRequest(req);
  if (!auth) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { actionType } = req.body || {};

  if (!actionType || typeof actionType !== 'string' || !VALID_ACTIONS.has(actionType)) {
    return res.status(400).json({ error: 'Invalid actionType' });
  }

  try {
    await recordUsage(auth.tenantId, actionType);
    return res.status(204).end();
  } catch (err) {
    console.error('Usage log error:', err);
    return res.status(500).json({ error: 'Failed to log usage' });
  }
}