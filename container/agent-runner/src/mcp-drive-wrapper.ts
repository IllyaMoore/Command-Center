#!/usr/bin/env node
/**
 * Wrapper that reads Google Drive OAuth credentials from files
 * and spawns mcp-google-drive with the correct env vars.
 * This avoids relying on the SDK to pass env vars to MCP servers.
 */
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const HOME = process.env.NANOCLAW_HOME_DIR || process.env.HOME || process.env.USERPROFILE || '';
const CREDS_PATH = path.join(HOME, '.google-drive-mcp', 'gcp-oauth.keys.json');
const TOKENS_PATH = path.join(HOME, '.google-drive-mcp', 'credentials.json');

try {
  const config = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf-8'));
  const creds = config.installed ?? config.web;
  const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf-8'));

  if (!creds?.client_id || !creds?.client_secret || !tokens?.refresh_token) {
    console.error('Missing Google Drive credentials');
    process.exit(1);
  }

  // Spawn mcp-google-drive with full process.env + Drive credentials
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const child = spawn(npxCmd, ['-y', 'mcp-google-drive'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GOOGLE_CLIENT_ID: creds.client_id,
      GOOGLE_CLIENT_SECRET: creds.client_secret,
      GOOGLE_REFRESH_TOKEN: tokens.refresh_token,
    },
  });

  // Pipe stdin/stdout/stderr through
  process.stdin.pipe(child.stdin);
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);

  child.on('exit', (code) => process.exit(code ?? 0));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
  process.on('SIGINT', () => child.kill('SIGINT'));
} catch (err) {
  console.error('Drive MCP wrapper error:', err);
  process.exit(1);
}
