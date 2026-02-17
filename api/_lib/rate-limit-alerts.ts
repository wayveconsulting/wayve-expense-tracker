import { Resend } from 'resend';
import { db } from '../../src/db/index.js';
import { tenants } from '../../src/db/schema.js';
import { eq } from 'drizzle-orm';

const resend = new Resend(process.env.RESEND_API_KEY);

const ALERT_RECIPIENTS = [
  'kpowers@gmail.com',
  'amber@wayveconsulting.com',
];

/**
 * Send an email alert when a rate limit is hit.
 * Failures are logged but never thrown — rate limiting still applies
 * even if the notification fails.
 */
export async function sendRateLimitAlert(
  tenantId: string,
  actionType: string,
  limitHit: string,
  current: number,
  limit: number
): Promise<void> {
  // Look up tenant name for the email
  let tenantName = tenantId;
  try {
    const [tenant] = await db
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (tenant) tenantName = tenant.name;
  } catch {
    // Fall back to UUID if lookup fails
  }

  const windowLabel = limitHit.replace('per', '').toLowerCase();
  const timestamp = new Date().toISOString();

  const subject = `⚠️ Rate Limit Alert: ${actionType} — ${limitHit} limit reached`;

  const textBody = [
    `Rate Limit Alert`,
    ``,
    `Tenant: ${tenantName}`,
    `Action: ${actionType}`,
    `Window: ${windowLabel}`,
    `Usage: ${current} of ${limit} ${windowLabel} ${actionType}s used`,
    `Time: ${timestamp}`,
    ``,
    `If this is legitimate usage, Kevin can increase the limit in the database.`,
  ].join('\n');

  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
      <div style="text-align: center; margin-bottom: 32px;">
        <h1 style="color: #E76F51; margin: 0; font-size: 24px;">⚠️ Rate Limit Alert</h1>
      </div>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr>
          <td style="padding: 8px 12px; font-weight: 600; color: #333; border-bottom: 1px solid #eee;">Tenant</td>
          <td style="padding: 8px 12px; color: #555; border-bottom: 1px solid #eee;">${tenantName}</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; font-weight: 600; color: #333; border-bottom: 1px solid #eee;">Action</td>
          <td style="padding: 8px 12px; color: #555; border-bottom: 1px solid #eee;">${actionType}</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; font-weight: 600; color: #333; border-bottom: 1px solid #eee;">Window Hit</td>
          <td style="padding: 8px 12px; color: #555; border-bottom: 1px solid #eee;">${windowLabel}</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; font-weight: 600; color: #333; border-bottom: 1px solid #eee;">Usage</td>
          <td style="padding: 8px 12px; color: #E76F51; font-weight: 600; border-bottom: 1px solid #eee;">${current} of ${limit} ${windowLabel} ${actionType}s used</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; font-weight: 600; color: #333;">Time</td>
          <td style="padding: 8px 12px; color: #555;">${timestamp}</td>
        </tr>
      </table>

      <p style="font-size: 14px; color: #666; line-height: 1.6;">
        If this is legitimate usage, Kevin can increase the limit in the database.
      </p>

      <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />

      <p style="font-size: 12px; color: #999; text-align: center;">
        Wayve Consulting &middot; Automated Rate Limit Alert
      </p>
    </div>
  `;

  try {
    await resend.emails.send({
      from: 'Wayve Expense Tracker <noreply@wayveconsulting.app>',
      to: ALERT_RECIPIENTS,
      subject,
      text: textBody,
      html: htmlBody,
    });
  } catch (emailErr) {
    console.error('Failed to send rate limit alert email:', emailErr);
  }
}
