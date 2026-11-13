import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const HOME = process.env.GMAIL_MCP_HOME || path.join(os.homedir(), '.gmail-mcp');
const FILE = path.join(HOME, 'accounts.json');

export function loadConfig() {
  if (!fs.existsSync(FILE)) return { accounts: {} };
  const cfg = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  cfg.accounts ||= {};
  return cfg;
}

export function saveConfig(cfg) {
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(cfg, null, 2) + '\n');
}

function ps(script, env) {
  return execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { env: { ...process.env, ...env }, encoding: 'utf8', windowsHide: true },
  ).trim();
}

// Windows DPAPI through PowerShell. Only this Windows user can decrypt the stored value.
export function protect(plain) {
  if (process.platform !== 'win32') throw new Error('password protection needs Windows DPAPI');
  return ps('ConvertTo-SecureString -String $env:GM_PLAIN -AsPlainText -Force | ConvertFrom-SecureString', { GM_PLAIN: plain });
}

export function unprotect(enc) {
  if (process.platform !== 'win32') throw new Error('password protection needs Windows DPAPI');
  return ps(
    '$s = ConvertTo-SecureString -String $env:GM_ENC; [Runtime.InteropServices.Marshal]::PtrToStringUni([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))',
    { GM_ENC: enc },
  );
}
