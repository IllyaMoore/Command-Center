import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';

import { logger } from '../../logger.js';
import { DASHBOARD_URL } from '../../config.js';

const HOME = process.env.HOME || process.env.USERPROFILE || '';
const OAUTH_KEYS_PATH = path.join(HOME, '.google-drive-mcp', 'gcp-oauth.keys.json');
const TOKENS_PATH = path.join(HOME, '.google-drive-mcp', 'credentials.json');

export type DriveAuthStatus = 'connected' | 'expired' | 'check_failed' | 'missing_tokens' | 'missing_credentials';

const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
];
const REDIRECT_URI = `${DASHBOARD_URL}/api/auth/google-drive/callback`;

let cachedAuthStatus: DriveAuthStatus | null = null;

function loadClientConfig(): { client_id: string; client_secret: string } | null {
  if (!fs.existsSync(OAUTH_KEYS_PATH)) return null;
  try {
    const config = JSON.parse(fs.readFileSync(OAUTH_KEYS_PATH, 'utf-8'));
    const creds = config.installed ?? config.web;
    if (!creds?.client_id || !creds?.client_secret) return null;
    return { client_id: creds.client_id, client_secret: creds.client_secret };
  } catch (err: unknown) {
    logger.warn({ err }, 'Failed to load Google Drive client config');
    return null;
  }
}

export async function getDriveAuthStatus(): Promise<DriveAuthStatus> {
  if (cachedAuthStatus === 'connected') return cachedAuthStatus;

  const config = loadClientConfig();
  if (!config) return 'missing_credentials';

  if (!fs.existsSync(TOKENS_PATH)) return 'missing_tokens';

  try {
    const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf-8'));
    if (!tokens.refresh_token) return 'missing_tokens';

    const oauth2 = new google.auth.OAuth2(config.client_id, config.client_secret);
    oauth2.setCredentials({
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token,
    });

    const drive = google.drive({ version: 'v3', auth: oauth2 });
    await drive.about.get({ fields: 'user' });
    cachedAuthStatus = 'connected';
    return 'connected';
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('invalid_grant') || message.includes('Token has been expired')) {
      return 'expired';
    }
    logger.error({ err }, 'Drive auth status check failed');
    return 'check_failed';
  }
}

export function getDriveAuthUrl(): string | null {
  const config = loadClientConfig();
  if (!config) return null;

  const oauth2 = new google.auth.OAuth2(config.client_id, config.client_secret, REDIRECT_URI);

  return oauth2.generateAuthUrl({
    access_type: 'offline',
    scope: DRIVE_SCOPES,
    prompt: 'consent',
  });
}

export async function handleDriveOAuthCallback(code: string): Promise<void> {
  const config = loadClientConfig();
  if (!config) throw new Error('Missing gcp-oauth.keys.json');

  const oauth2 = new google.auth.OAuth2(config.client_id, config.client_secret, REDIRECT_URI);

  const { tokens } = await oauth2.getToken(code);

  const tokensDir = path.dirname(TOKENS_PATH);
  if (!fs.existsSync(tokensDir)) {
    fs.mkdirSync(tokensDir, { recursive: true });
  }
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
  logger.info('Google Drive tokens saved');

  cachedAuthStatus = null;
}
