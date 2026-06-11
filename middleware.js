/*
 * Vercel Edge Middleware — gates the whole site behind Google Workspace SSO.
 *
 * Every request (except the OAuth callback) must carry a valid signed session
 * cookie. Without one, the user is redirected to Google sign-in;
 * api/auth/callback.js verifies the email domain and sets the cookie.
 *
 * Required Vercel env vars:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET — OAuth client from Google Cloud console
 *   SESSION_SECRET                         — long random string (e.g. `openssl rand -hex 32`)
 * Optional:
 *   ALLOWED_DOMAIN                         — defaults to wetravel.com
 *
 * Fails closed: if the env vars are missing, the site returns 503 instead of
 * serving unprotected. Only runs on Vercel — local dev servers are unaffected.
 */

export const config = { matcher: ['/((?!api/auth/).*)'] };

const COOKIE = 'wt_session';

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sign(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return b64url(new Uint8Array(sig));
}

async function hasValidSession(cookieHeader, secret) {
  const match = (cookieHeader || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!match) return false;
  const [payload, sig] = match[1].split('.');
  if (!payload || !sig) return false;
  if (await sign(secret, payload) !== sig) return false;
  try {
    const session = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return Date.now() < session.exp;
  } catch {
    return false;
  }
}

export default async function middleware(request) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.SESSION_SECRET;
  if (!clientId || !secret) {
    return new Response(
      'SSO is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and SESSION_SECRET in the Vercel project settings.',
      { status: 503 }
    );
  }

  if (await hasValidSession(request.headers.get('cookie'), secret)) return;

  const url = new URL(request.url);
  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  auth.searchParams.set('client_id', clientId);
  auth.searchParams.set('redirect_uri', `${url.origin}/api/auth/callback`);
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('scope', 'openid email');
  // hd narrows the Google account picker; real enforcement is in the callback
  auth.searchParams.set('hd', process.env.ALLOWED_DOMAIN || 'wetravel.com');
  auth.searchParams.set('state', url.pathname + url.search);
  return Response.redirect(auth.toString(), 302);
}
