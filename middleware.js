/*
 * Vercel Edge Middleware — gates the whole site behind Google Workspace SSO.
 *
 * Every request (except the OAuth callback) must carry a valid signed session
 * cookie. Without one, the user is redirected to Google sign-in;
 * api/auth/callback.js verifies the email domain and sets the cookie.
 *
 * Each sign-in redirect also sets a short-lived random nonce cookie that the
 * callback must match against the OAuth `state` — a login can only complete
 * in the browser that started it.
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
const NONCE_COOKIE = 'wt_oauth_nonce';

const enc = (s) => new TextEncoder().encode(s);

function getCookie(header, name) {
  const match = (header || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}

async function hmacKey(secret, usage) {
  return crypto.subtle.importKey(
    'raw', enc(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]
  );
}

// constant-time HMAC check via WebCrypto verify
async function verifySignature(secret, data, sigB64url) {
  let sigBytes;
  try {
    sigBytes = Uint8Array.from(
      atob(sigB64url.replace(/-/g, '+').replace(/_/g, '/')),
      (c) => c.charCodeAt(0)
    );
  } catch {
    return false;
  }
  const key = await hmacKey(secret, 'verify');
  return crypto.subtle.verify('HMAC', key, sigBytes, enc(data));
}

async function hasValidSession(cookieHeader, secret) {
  const value = getCookie(cookieHeader, COOKIE);
  if (!value) return false;
  const [payload, sig] = value.split('.');
  if (!payload || !sig) return false;
  if (!(await verifySignature(secret, payload, sig))) return false;
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

  // bind this login attempt to this browser
  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);
  const nonce = Array.from(nonceBytes, (b) => b.toString(16).padStart(2, '0')).join('');

  const url = new URL(request.url);
  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  auth.searchParams.set('client_id', clientId);
  auth.searchParams.set('redirect_uri', `${url.origin}/api/auth/callback`);
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('scope', 'openid email');
  // hd narrows the Google account picker; real enforcement is in the callback
  auth.searchParams.set('hd', process.env.ALLOWED_DOMAIN || 'wetravel.com');
  auth.searchParams.set('state', `${nonce}|${url.pathname}${url.search}`);

  return new Response(null, {
    status: 302,
    headers: {
      Location: auth.toString(),
      'Set-Cookie': `${NONCE_COOKIE}=${nonce}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    },
  });
}
