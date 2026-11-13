#!/usr/bin/env node
import readline from 'node:readline';
import { loadConfig, saveConfig, protect, HOME } from './config.js';
import { listAccounts, getClient, closeAll } from './accounts.js';
import * as oauth from './oauth.js';
import * as mail from './mail.js';

const [cmd, ...rest] = process.argv.slice(2);

function readSecret(prompt) {
  return new Promise((resolve) => {
    const tty = Boolean(process.stdin.isTTY);
    process.stdout.write(`${prompt}${tty ? ' (typing is hidden)' : ' (typing is visible here)'}: `);
    if (!tty) {
      let data = '';
      const finish = () => resolve(data.split(/\r?\n/)[0].trim());
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (d) => { data += d; if (data.includes('\n')) { process.stdin.pause(); finish(); } });
      process.stdin.on('end', finish);
      return;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = () => {}; // no echo
    rl.question('', (ans) => { rl.close(); process.stdout.write('\n'); resolve(ans.trim()); });
  });
}

const usage = `gmail-mcp CLI (config in ${HOME})
  add <alias> <email> [web_index]   register an account (web_index = N in mail.google.com/mail/u/N)
  set-password <alias>              store the Gmail app password (prompted; or piped on stdin)
  oauth-client <alias> <client_id>  store a Google OAuth desktop client (secret prompted; or piped on stdin)
  oauth-login <alias>               print the consent URL, wait for the browser, store the refresh token
  remove <alias>
  list
  test <alias>                      connect over IMAP and show folder counts
  search <alias> "<query>" [limit]
`;

async function main() {
  const cfg = loadConfig();
  switch (cmd) {
    case 'add': {
      const [alias, email, web] = rest;
      if (!alias || !email) throw new Error(usage);
      cfg.accounts[alias] = { ...(cfg.accounts[alias] || {}), email, ...(web !== undefined ? { web_index: Number(web) } : {}) };
      saveConfig(cfg);
      console.log(`added ${alias} -> ${email}`);
      break;
    }
    case 'set-password': {
      const [alias] = rest;
      if (!cfg.accounts[alias]) throw new Error(`unknown alias ${alias}. ${usage}`);
      const raw = await readSecret(`App password for ${cfg.accounts[alias].email}`);
      const pw = raw.replace(/\s+/g, '');
      if (pw.length < 16) throw new Error('that does not look like a 16-character Gmail app password');
      cfg.accounts[alias].password_enc = protect(pw);
      saveConfig(cfg);
      console.log(`stored (DPAPI-protected) for ${alias}`);
      break;
    }
    case 'oauth-client': {
      const [alias, clientId] = rest;
      if (!cfg.accounts[alias] || !clientId) throw new Error(usage);
      const secret = await readSecret(`OAuth client secret for ${cfg.accounts[alias].email}`);
      if (!secret) throw new Error('empty client secret');
      oauth.setClient(alias, clientId, secret);
      console.log(`stored OAuth client for ${alias}; next: node src/cli.js oauth-login ${alias}`);
      break;
    }
    case 'oauth-login': {
      const [alias] = rest;
      if (!cfg.accounts[alias]) throw new Error(usage);
      const email = await oauth.login(alias);
      console.log(`stored refresh token for ${alias} (${email})`);
      break;
    }
    case 'remove': {
      const [alias] = rest;
      delete cfg.accounts[alias];
      saveConfig(cfg);
      console.log(`removed ${alias}`);
      break;
    }
    case 'list':
      console.table(listAccounts());
      break;
    case 'test': {
      const [alias] = rest;
      const entry = await getClient(alias);
      console.log(`connected as ${entry.email}`);
      console.log(JSON.stringify(await mail.listLabels(alias), null, 2));
      await closeAll();
      break;
    }
    case 'search': {
      const [alias, query, limit] = rest;
      console.log(JSON.stringify(await mail.searchEmails(alias, { query, limit: limit ? Number(limit) : 10 }), null, 2));
      await closeAll();
      break;
    }
    default:
      console.log(usage);
  }
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
