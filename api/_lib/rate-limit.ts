import { db } from '../../src/db/index.js';
import { rateLimitUsage } from '../../src/db/schema.js';
import { eq, and, gte, sql } from 'drizzle-orm';
import { sendRateLimitAlert } from './rate-limit-alerts.js';

export interface RateLimitConfig {
  actionType: string;
  limits: {
    perMinute?: number;
    perHour?: number;
    perDay?: number;
    perMonth?: number;
  };
  alertOn?: ('daily' | 'monthly')[];
}

export interface RateLimitResult {
  allowed: boolean;
  limitHit?: string;
  current?: number;
  limit?: number;
  retryAfterSeconds?: number;
}

export const RECEIPT_SCAN_LIMITS: RateLimitConfig = {
  actionType: 'receipt_scan',
  limits: {
    perMinute: 10,
    perHour: 60,
    perDay: 100,
    perMonth: 200,
  },
  alertOn: ['daily', 'monthly'],
};

/**
 * Check whether a tenant has exceeded any rate limit window for the given action.
 * Windows are checked smallest-to-largest for fast failure.
 */
export async function checkRateLimit(
  tenantId: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const windows: { key: keyof RateLimitConfig['limits']; seconds: number; alertKey?: 'daily' | 'monthly' }[] = [
    { key: 'perMinute', seconds: 60 },
    { key: 'perHour', seconds: 3600 },
    { key: 'perDay', seconds: 86400, alertKey: 'daily' },
    { key: 'perMonth', seconds: 2592000, alertKey: 'monthly' },
  ];

  for (const window of windows) {
    const limit = config.limits[window.key];
    if (limit === undefined) continue;

    const since = new Date(Date.now() - window.seconds * 1000);

    const [result] = await db
      .select({ count: sql<number>`count(*)` })
      .from(rateLimitUsage)
      .where(and(
        eq(rateLimitUsage.tenantId, tenantId),
        eq(rateLimitUsage.actionType, config.actionType),
        gte(rateLimitUsage.createdAt, since)
      ));

    const current = Number(result?.count ?? 0);

    if (current >= limit) {
      // Fire alert if this window matches alertOn config
      if (window.alertKey && config.alertOn?.includes(window.alertKey)) {
        sendRateLimitAlert(tenantId, config.actionType, window.key, current, limit).catch((err) => {
          console.error('Failed to send rate limit alert:', err);
        });
      }

      return {
        allowed: false,
        limitHit: window.key,
        current,
        limit,
        retryAfterSeconds: window.seconds,
      };
    }
  }

  return { allowed: true };
}

/**
 * Record a single usage event. Call this AFTER a successful operation.
 */
export async function recordUsage(
  tenantId: string,
  actionType: string
): Promise<void> {
  await db.insert(rateLimitUsage).values({
    tenantId,
    actionType,
  });
}
