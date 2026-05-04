import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../../src/db/index.js';
import { rateLimitUsage } from '../../src/db/schema.js';
import { gte, sql } from 'drizzle-orm';
import { authenticateSuperAdmin } from '../_lib/auth.js';

// Published pricing (per the roadmap)
const COST_PER_ACTION: Record<string, number> = {
  receipt_scan: 0.01,         // Approximate per-call cost — update with actual Anthropic pricing
  places_autocomplete: 0.00283,
  distance_matrix: 0.005,
};

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
    // Get start of current year for YTD scope
    const currentYear = new Date().getFullYear();
    const yearStart = new Date(`${currentYear}-01-01T00:00:00.000Z`);

    // Single query: aggregate usage by tenant, action type, and month
    const rows = await db
      .select({
        tenantId: rateLimitUsage.tenantId,
        actionType: rateLimitUsage.actionType,
        month: sql<number>`EXTRACT(MONTH FROM ${rateLimitUsage.createdAt})`.as('month'),
        count: sql<number>`count(*)`.as('count'),
      })
      .from(rateLimitUsage)
      .where(gte(rateLimitUsage.createdAt, yearStart))
      .groupBy(
        rateLimitUsage.tenantId,
        rateLimitUsage.actionType,
        sql`EXTRACT(MONTH FROM ${rateLimitUsage.createdAt})`,
      );

    // Shape into { tenantId: { actionType: { month: count }, ytd, cost } }
    const usage: Record<string, {
      actions: Record<string, { months: Record<number, number>; ytd: number; cost: number }>;
      totalCost: number;
    }> = {};

    for (const row of rows) {
      const tid = row.tenantId;
      const action = row.actionType;
      const month = Number(row.month);
      const count = Number(row.count);

      if (!usage[tid]) {
        usage[tid] = { actions: {}, totalCost: 0 };
      }
      if (!usage[tid].actions[action]) {
        usage[tid].actions[action] = { months: {}, ytd: 0, cost: 0 };
      }

      usage[tid].actions[action].months[month] = count;
      usage[tid].actions[action].ytd += count;
      usage[tid].actions[action].cost += count * (COST_PER_ACTION[action] || 0);
    }

    // Calculate total cost per tenant
    for (const tid of Object.keys(usage)) {
      usage[tid].totalCost = Object.values(usage[tid].actions)
        .reduce((sum, a) => sum + a.cost, 0);
    }

    return res.status(200).json({ year: currentYear, usage });
  } catch (err) {
    console.error('Error fetching usage data:', err);
    return res.status(500).json({ error: 'Failed to fetch usage data' });
  }
}