/*
 * OAuth callback for the Google Workspace SSO gate (see middleware.js).
 * Exchanges the auth code with Google, verifies the email domain, then sets
 * the signed session cookie that middleware.js checks on every request.
 */

const crypto = require('crypto');

const SESSION_DAYS = 7;

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
  if (error || !code) {
    res.status(401).send(`Sign-in failed: ${error || 'missing authorization code'}`);
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
  res.setHeader('Set-Cookie',
    `wt_session=${payload}.${sig}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 24 * 3600}`);

  // state holds the originally requested path; reject anything that isn't a
  // local path so the redirect can't be pointed off-site
  const dest = typeof state === 'string' && state.startsWith('/') && !state.startsWith('//') ? state : '/';
  res.statusCode = 302;
  res.setHeader('Location', dest);
  res.end();
};
