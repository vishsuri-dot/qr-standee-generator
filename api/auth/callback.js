/*
 * OAuth callback for the Google Workspace SSO gate (see middleware.js).
 * Exchanges the auth code with Google, checks the login nonce, verifies the
 * email domain, then sets the signed session cookie that middleware.js checks
 * on every request.
 */

const crypto = require('crypto');

const SESSION_DAYS = 7;
const NONCE_COOKIE = 'wt_oauth_nonce';

function timingSafeEqualStr(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function getCookie(header, name) {
  const match = (header || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}

module.exports = async (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const secret = process.env.SESSION_SECRET;
  const domain = (process.env.ALLOWED_DOMAIN || 'wetravel.com').toLowerCase();
  if (!clientId || !clientSecret || !secret) {
    res.status(503).send('SSO is not configured.');
    return;
  }

  const { code, state, error } = req.query;
  if (error || !code || typeof state !== 'string') {
    res.status(401).send(`Sign-in failed: ${error || 'missing authorization code'}`);
    return;
  }

  // the login must finish in the same browser that started it
  const sep = state.indexOf('|');
  const stateNonce = sep === -1 ? '' : state.slice(0, sep);
  const cookieNonce = getCookie(req.headers.cookie, NONCE_COOKIE);
  if (!stateNonce || !cookieNonce || !timingSafeEqualStr(stateNonce, cookieNonce)) {
    res.status(401).send('Sign-in failed: state mismatch. Go back to the app and try again.');
    return;
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `https://${req.headers.host}/api/auth/callback`,
      grant_type: 'authorization_code',
    }),
  });
  const tokens = await tokenRes.json();
  if (!tokenRes.ok || !tokens.id_token) {
    res.status(401).send('Sign-in failed: could not exchange the authorization code.');
    return;
  }

  // The id_token comes straight from Google's token endpoint over TLS, so
  // decoding without signature verification is safe here.
  const claims = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString());
  const email = String(claims.email || '').toLowerCase();
  if (!claims.email_verified || !email.endsWith(`@${domain}`)) {
    res.status(403).send(`Access is restricted to @${domain} accounts.`);
    return;
  }

  const payload = Buffer.from(JSON.stringify({
    email,
    exp: Date.now() + SESSION_DAYS * 24 * 3600 * 1000,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  res.setHeader('Set-Cookie', [
    `wt_session=${payload}.${sig}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 24 * 3600}`,
    `${NONCE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
  ]);

  // state holds the originally requested path; only allow a local path —
  // no '//' or '\' forms that browsers would treat as an external redirect
  const path = state.slice(sep + 1);
  const dest = path.startsWith('/') && !path.startsWith('//') && !path.includes('\\') ? path : '/';
  res.statusCode = 302;
  res.setHeader('Location', dest);
  res.end();
};
