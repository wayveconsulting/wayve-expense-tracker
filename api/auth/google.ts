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
  const redirectUri = getRedirectUri();

  // Build Google OAuth URL
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'offline',
    prompt: 'select_account',
  });

  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  res.setHeader('Cache-Control', 'no-store');
  return res.redirect(googleAuthUrl);
}

function getRedirectUri(): string {
  if (process.env.OAUTH_REDIRECT_URI) return process.env.OAUTH_REDIRECT_URI;
  return 'http://localhost:5173/api/auth/callback/google';
}