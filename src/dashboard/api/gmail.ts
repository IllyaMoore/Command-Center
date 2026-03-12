import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';

import { logger } from '../../logger.js';
import { DASHBOARD_URL } from '../../config.js';

// Paths to Gmail MCP credentials
const HOME = process.env.HOME || process.env.USERPROFILE || '';
const OAUTH_KEYS_PATH = path.join(HOME, '.gmail-mcp', 'gcp-oauth.keys.json');
const TOKENS_PATH = path.join(HOME, '.gmail-mcp', 'credentials.json');

export type GmailAuthStatus = 'connected' | 'expired' | 'check_failed' | 'missing_tokens' | 'missing_credentials';

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
];
const REDIRECT_URI = `${DASHBOARD_URL}/api/auth/gmail/callback`;

let cachedAuthStatus: GmailAuthStatus | null = null;

function loadClientConfig(): { client_id: string; client_secret: string } | null {
  if (!fs.existsSync(OAUTH_KEYS_PATH)) return null;
  try {
    const config = JSON.parse(fs.readFileSync(OAUTH_KEYS_PATH, 'utf-8'));
    const creds = config.installed ?? config.web;
    if (!creds?.client_id || !creds?.client_secret) return null;
    return { client_id: creds.client_id, client_secret: creds.client_secret };
  } catch (err) {
    logger.warn({ err, path: OAUTH_KEYS_PATH }, 'Failed to read or parse gcp-oauth.keys.json');
    return null;
  }
}

export async function getGmailAuthStatus(): Promise<GmailAuthStatus> {
  if (cachedAuthStatus === 'connected') return cachedAuthStatus;

  const config = loadClientConfig();
  if (!config) return 'missing_credentials';

  if (!fs.existsSync(TOKENS_PATH)) return 'missing_tokens';

  // Tokens file exists — try a test request
  try {
    const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf-8'));
    if (!tokens.refresh_token) return 'missing_tokens';

    const oauth2 = new google.auth.OAuth2(config.client_id, config.client_secret);
    oauth2.setCredentials({
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token,
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2 });
    await gmail.users.getProfile({ userId: 'me' });
    cachedAuthStatus = 'connected';
    return 'connected';
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('invalid_grant') || message.includes('Token has been expired')) {
      return 'expired';
    }
    logger.error({ err }, 'Gmail auth status check failed');
    return 'check_failed';
  }
}

export function getGmailAuthUrl(): string | null {
  const config = loadClientConfig();
  if (!config) return null;

  const oauth2 = new google.auth.OAuth2(config.client_id, config.client_secret, REDIRECT_URI);

  return oauth2.generateAuthUrl({
    access_type: 'offline',
    scope: GMAIL_SCOPES,
    prompt: 'consent',
  });
}

export async function handleGmailOAuthCallback(code: string): Promise<void> {
  const config = loadClientConfig();
  if (!config) throw new Error('Missing gcp-oauth.keys.json');

  const oauth2 = new google.auth.OAuth2(config.client_id, config.client_secret, REDIRECT_URI);

  const { tokens } = await oauth2.getToken(code);

  // Gmail MCP expects flat token structure (no wrapper)
  const tokensDir = path.dirname(TOKENS_PATH);
  if (!fs.existsSync(tokensDir)) {
    fs.mkdirSync(tokensDir, { recursive: true });
  }
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
  logger.info('Gmail tokens saved');

  cachedAuthStatus = null;
}
