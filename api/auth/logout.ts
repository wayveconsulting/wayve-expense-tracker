import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../../src/db/index.js';
import { sessions } from '../../src/db/schema.js';
import { eq } from 'drizzle-orm';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Parse session cookie
  const cookies = parseCookies(req.headers.cookie || '');
  const sessionToken = cookies.session;

  if (sessionToken) {
    try {
      // Delete the session from database
      await db
        .delete(sessions)
        .where(eq(sessions.token, sessionToken));
    } catch (err) {
      // Log but don't fail - we still want to clear the cookie
      console.error('Error deleting session:', err);
    }
  }

  // Clear the session cookie
  const isProduction = process.env.NODE_ENV === 'production';
  const cookieOptions = [
    'session=',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0', // Expire immediately
    isProduction ? 'Secure' : '',
    isProduction ? 'Domain=.wayveexpenses.app' : '',
  ].filter(Boolean).join('; ');

  res.setHeader('Set-Cookie', cookieOptions);

  // Support both API calls and direct browser navigation
  const acceptHeader = req.headers.accept || '';
  if (acceptHeader.includes('application/json')) {
    return res.status(200).json({ success: true });
  }

  // Redirect to login page for browser requests
  return res.redirect('/login');
}

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  
  cookieHeader.split(';').forEach(cookie => {
    const [name, ...rest] = cookie.trim().split('=');
    if (name && rest.length > 0) {
      cookies[name] = rest.join('=');
    }
  });
  
  return cookies;
}