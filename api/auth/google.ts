import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { redirect } = req.query;

  // Build state parameter (includes redirect URL, could add CSRF token later)
  const state = Buffer.from(JSON.stringify({
    redirectTo: typeof redirect === 'string' ? redirect : '/',
  })).toString('base64');

  // Determine the correct redirect URI based on environment
  const redirectUri = getRedirectUri(req);

  // Build Google OAuth URL
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'offline', // Gets refresh token (useful for future features)
    prompt: 'select_account', // Always show account picker
  });

  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  return res.redirect(googleAuthUrl);
}

function getRedirectUri(req: VercelRequest): string {
  const host = req.headers.host || 'localhost:5173';
  
  // For subdomains, OAuth callback goes to main domain
  if (host.includes('wayveconsulting.app')) {
    return 'https://wayveconsulting.app/api/auth/callback/google';
  }
  if (host.includes('vercel.app')) {
    // Use the specific Vercel deployment URL
    return `https://wayve-expense-tracker.vercel.app/api/auth/callback/google`;
  }
  
  // Local development
  return 'http://localhost:5173/api/auth/callback/google';
}