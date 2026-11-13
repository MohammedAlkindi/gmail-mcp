import { ImapFlow } from 'imapflow';
import { loadConfig, unprotect } from './config.js';
import { hasOAuth, accessTokenFor } from './oauth.js';

const clients = new Map();
const passwords = new Map();

export function authKind(a) {
  if (hasOAuth(a)) return 'oauth';
  if (a?.password_enc) return 'app_password';
  return 'none';
}

export function listAccounts() {
  const cfg = loadConfig();
  return Object.entries(cfg.accounts).map(([alias, a]) => ({
    alias, email: a.email, auth: authKind(a), web_index: a.web_index,
  }));
}

// Credentials for the IMAP and SMTP libraries: an OAuth access token when the account has a
// grant, otherwise the stored app password.
export async function imapAuth(alias) {
  const a = loadConfig().accounts[alias];
  if (hasOAuth(a)) return { user: a.email, accessToken: await accessTokenFor(alias) };
  return { user: a.email, pass: getPassword(alias) };
}

export async function smtpAuth(alias) {
  const a = loadConfig().accounts[alias];
  if (hasOAuth(a)) return { type: 'OAuth2', user: a.email, accessToken: await accessTokenFor(alias) };
  return { user: a.email, pass: getPassword(alias) };
}

export function resolveAlias(alias) {
  const names = Object.keys(loadConfig().accounts);
  if (!alias) {
    if (names.length === 1) return names[0];
    throw new Error(`account is required. Configured accounts: ${names.join(', ') || 'none'}`);
  }
  if (!names.includes(alias)) throw new Error(`unknown account "${alias}". Configured accounts: ${names.join(', ') || 'none'}`);
  return alias;
}

export function getPassword(alias) {
  if (passwords.has(alias)) return passwords.get(alias);
  const a = loadConfig().accounts[alias];
  if (!a?.password_enc) throw new Error(`no app password stored for "${alias}". Run: node src/cli.js set-password ${alias}`);
  const p = unprotect(a.password_enc);
  passwords.set(alias, p);
  return p;
}

export async function getClient(alias) {
  alias = resolveAlias(alias);
  const existing = clients.get(alias);
  if (existing && existing.client.usable) return existing;
  clients.delete(alias);

  const a = loadConfig().accounts[alias];
  const client = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: await imapAuth(alias),
    logger: false,
    clientInfo: { name: 'gmail-mcp', vendor: 'local' },
  });
  client.on('error', () => clients.delete(alias));
  client.on('close', () => clients.delete(alias));
  await client.connect();

  const special = {};
  for (const box of await client.list()) if (box.specialUse) special[box.specialUse] = box.path;
  if (!special['\\All']) throw new Error(`${a.email}: no All Mail folder exposed over IMAP. Check "Show in IMAP" in Gmail label settings.`);

  const entry = { alias, email: a.email, web_index: a.web_index, client, special };
  clients.set(alias, entry);
  return entry;
}

export async function closeAll() {
  for (const { client } of clients.values()) {
    try { await client.logout(); } catch { /* already gone */ }
  }
  clients.clear();
}
