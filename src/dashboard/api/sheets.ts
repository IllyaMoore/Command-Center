import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';

import { logger } from '../../logger.js';
import { DASHBOARD_URL } from '../../config.js';

const HOME = process.env.HOME || process.env.USERPROFILE || '';
const OAUTH_KEYS_PATH = path.join(HOME, '.google-sheets-mcp', 'gcp-oauth.keys.json');
const TOKENS_PATH = path.join(HOME, '.google-sheets-mcp', 'credentials.json');


export type SheetsAuthStatus = 'connected' | 'expired' | 'check_failed' | 'missing_tokens' | 'missing_credentials';

const SHEETS_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/spreadsheets',
];
const REDIRECT_URI = `${DASHBOARD_URL}/api/auth/google-sheets/callback`;

let cachedAuthStatus: SheetsAuthStatus | null = null;

function loadClientConfig(): { client_id: string; client_secret: string } | null {
  if (!fs.existsSync(OAUTH_KEYS_PATH)) return null;
  try {
    const config = JSON.parse(fs.readFileSync(OAUTH_KEYS_PATH, 'utf-8'));
    const creds = config.installed ?? config.web;
    if (!creds?.client_id || !creds?.client_secret) return null;
    return { client_id: creds.client_id, client_secret: creds.client_secret };
  } catch (err: unknown) {
    logger.warn({ err }, 'Failed to load Google Sheets client config');
    return null;
  }
}

export async function getSheetsAuthStatus(): Promise<SheetsAuthStatus> {
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

    const sheets = google.sheets({ version: 'v4', auth: oauth2 });
    // Light test call — 404 means auth works but spreadsheet doesn't exist, which is fine
    try {
      await sheets.spreadsheets.get({ spreadsheetId: 'test', fields: 'spreadsheetId' });
    } catch (testErr: unknown) {
      // GaxiosError exposes HTTP status in .status; .code is a string like "NOT_FOUND"
      const status = (testErr as { status?: number }).status;
      if (status !== 404) throw testErr;
    }
    cachedAuthStatus = 'connected';
    return 'connected';
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('invalid_grant') || message.includes('Token has been expired')) {
      return 'expired';
    }
    logger.error({ err }, 'Sheets auth status check failed');
    return 'check_failed';
  }
}

export function getSheetsAuthUrl(): string | null {
  const config = loadClientConfig();
  if (!config) return null;

  const oauth2 = new google.auth.OAuth2(config.client_id, config.client_secret, REDIRECT_URI);

  return oauth2.generateAuthUrl({
    access_type: 'offline',
    scope: SHEETS_SCOPES,
    prompt: 'consent',
  });
}

export async function handleSheetsOAuthCallback(code: string): Promise<void> {
  const config = loadClientConfig();
  if (!config) throw new Error('Missing gcp-oauth.keys.json');

  const oauth2 = new google.auth.OAuth2(config.client_id, config.client_secret, REDIRECT_URI);

  const { tokens } = await oauth2.getToken(code);

  const tokensDir = path.dirname(TOKENS_PATH);
  if (!fs.existsSync(tokensDir)) {
    fs.mkdirSync(tokensDir, { recursive: true });
  }
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
  logger.info('Google Sheets tokens saved');

  cachedAuthStatus = null;
}

export function disconnectSheets(): void {
  if (fs.existsSync(TOKENS_PATH)) fs.unlinkSync(TOKENS_PATH);
  cachedAuthStatus = null;
  logger.info('Google Sheets tokens deleted');
}
