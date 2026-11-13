#!/usr/bin/env node
import readline from 'node:readline';
import { loadConfig, saveConfig, protect, HOME } from './config.js';
import { listAccounts, getClient, closeAll } from './accounts.js';
import * as mail from './mail.js';

const [cmd, ...rest] = process.argv.slice(2);

function readSecret(prompt) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      let data = '';
      process.stdin.setEncoding('utf8').on('data', (d) => { data += d; }).on('end', () => resolve(data.trim()));
      return;
    }
    process.stdout.write(prompt);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = () => {}; // no echo
    rl.question('', (ans) => { rl.close(); process.stdout.write('\n'); resolve(ans.trim()); });
  });
}

const usage = `gmail-mcp CLI (config in ${HOME})
  add <alias> <email> [web_index]   register an account (web_index = N in mail.google.com/mail/u/N)
  set-password <alias>              store the Gmail app password (prompted, not echoed; or piped on stdin)
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
      const raw = await readSecret(`App password for ${cfg.accounts[alias].email}: `);
      const pw = raw.replace(/\s+/g, '');
      if (pw.length < 16) throw new Error('that does not look like a 16-character Gmail app password');
      cfg.accounts[alias].password_enc = protect(pw);
      saveConfig(cfg);
      console.log(`stored (DPAPI-protected) for ${alias}`);
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
