import http from 'node:http';
import crypto from 'node:crypto';
import { loadConfig, saveConfig, protect, unprotect } from './config.js';

// Full-access scope is the only one Gmail accepts for IMAP and SMTP XOAUTH2.
const SCOPE = 'https://mail.google.com/';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const tokens = new Map(); // alias -> { accessToken, expiresAt }

export function hasOAuth(account) {
  return Boolean(account?.oauth?.client_id && account?.oauth?.refresh_token_enc);
}

async function postToken(params) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${json.error || res.status}: ${json.error_description || 'token request failed'}`);
  return json;
}

export async function accessTokenFor(alias) {
  const cached = tokens.get(alias);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.accessToken;
  const a = loadConfig().accounts[alias];
  if (!hasOAuth(a)) throw new Error(`no OAuth grant stored for "${alias}". Run: node src/cli.js oauth-login ${alias}`);
  const json = await postToken({
    client_id: a.oauth.client_id,
    client_secret: unprotect(a.oauth.client_secret_enc),
    refresh_token: unprotect(a.oauth.refresh_token_enc),
    grant_type: 'refresh_token',
  });
  tokens.set(alias, { accessToken: json.access_token, expiresAt: Date.now() + (json.expires_in || 3600) * 1000 });
  return json.access_token;
}

export function setClient(alias, clientId, clientSecret) {
  const cfg = loadConfig();
  const a = cfg.accounts[alias];
  if (!a) throw new Error(`unknown alias ${alias}`);
  a.oauth = { ...(a.oauth || {}), client_id: clientId.trim(), client_secret_enc: protect(clientSecret.trim()) };
  delete a.oauth.refresh_token_enc;
  saveConfig(cfg);
}

// Loopback authorization-code flow with PKCE. Prints the consent URL; the browser's redirect
// lands on 127.0.0.1, so the refresh token never leaves this machine.
export async function login(alias) {
  const cfg = loadConfig();
  const a = cfg.accounts[alias];
  if (!a?.oauth?.client_id) throw new Error(`no OAuth client for ${alias}. Run: node src/cli.js oauth-client ${alias} <client_id>`);

  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(16).toString('hex');

  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const redirectUri = `http://127.0.0.1:${server.address().port}/`;

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: a.oauth.client_id, redirect_uri: redirectUri, response_type: 'code', scope: SCOPE,
    access_type: 'offline', prompt: 'consent', login_hint: a.email, state,
    code_challenge: challenge, code_challenge_method: 'S256',
  }).toString();
  console.log(`Open this URL in the browser signed in as ${a.email}:\n\n${url}\n`);

  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out after 10 minutes waiting for the browser')), 10 * 60 * 1000);
    server.on('request', (req, res) => {
      const u = new URL(req.url, redirectUri);
      if (u.pathname !== '/') { res.statusCode = 404; res.end(); return; }
      res.setHeader('content-type', 'text/plain');
      if (u.searchParams.get('state') !== state) { res.end('gmail-mcp: state mismatch, try again.'); return; }
      const err = u.searchParams.get('error');
      if (err) { res.end(`gmail-mcp: Google returned "${err}".`); clearTimeout(timer); reject(new Error(err)); return; }
      res.end('gmail-mcp: authorization received. You can close this tab.');
      clearTimeout(timer);
      resolve(u.searchParams.get('code'));
    });
  }).finally(() => server.close());

  const json = await postToken({
    code, client_id: a.oauth.client_id, client_secret: unprotect(a.oauth.client_secret_enc),
    redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier,
  });
  if (!json.refresh_token) throw new Error('Google returned no refresh token; revoke the app at myaccount.google.com/permissions and run oauth-login again');
  a.oauth.refresh_token_enc = protect(json.refresh_token);
  saveConfig(cfg);
  tokens.set(alias, { accessToken: json.access_token, expiresAt: Date.now() + (json.expires_in || 3600) * 1000 });
  return a.email;
}
