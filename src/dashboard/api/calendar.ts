import fs from 'fs';
import path from 'path';
import { google, calendar_v3 } from 'googleapis';

import { logger } from '../../logger.js';
import { DASHBOARD_URL } from '../../config.js';

// Paths to Google Calendar MCP credentials
const HOME = process.env.HOME || process.env.USERPROFILE || '';
const CREDENTIALS_PATH = path.join(HOME, '.google-calendar-mcp', 'credentials.json');
const TOKENS_PATH = path.join(HOME, '.config', 'google-calendar-mcp', 'tokens.json');

// OAuth client config structure (credentials.json)
interface OAuthClientConfig {
  installed: {
    client_id: string;
    client_secret: string;
  };
}

// Tokens file structure (tokens.json)
interface TokensFile {
  normal: {
    access_token: string;
    refresh_token: string;
  };
}

// Combined credentials for OAuth2 client
interface CalendarCredentials {
  client_id: string;
  client_secret: string;
  refresh_token: string;
  access_token?: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  description?: string;
  color?: string;
}

export interface CalendarEventsResult {
  events: CalendarEvent[];
  error?: string;
}

export type CalendarAuthStatus = 'connected' | 'expired' | 'check_failed' | 'missing_tokens' | 'missing_credentials';

const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
];
const REDIRECT_URI = `${DASHBOARD_URL}/api/auth/google-calendar/callback`;

let calendarClient: calendar_v3.Calendar | null = null;
let authClient: InstanceType<typeof google.auth.OAuth2> | null = null;
let cachedAuthStatus: CalendarAuthStatus | null = null;

function loadClientConfig(): OAuthClientConfig | null {
  if (!fs.existsSync(CREDENTIALS_PATH)) return null;
  try {
    const config: OAuthClientConfig = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
    if (!config.installed?.client_id || !config.installed?.client_secret) return null;
    return config;
  } catch (err) {
    logger.error({ err, path: CREDENTIALS_PATH }, 'Failed to read or parse credentials.json');
    return null;
  }
}

function loadCredentials(): CalendarCredentials | null {
  try {
    // Load OAuth client config (client_id, client_secret)
    if (!fs.existsSync(CREDENTIALS_PATH)) {
      logger.warn({ path: CREDENTIALS_PATH }, 'Google Calendar credentials not found');
      return null;
    }
    const clientConfig: OAuthClientConfig = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));

    if (!clientConfig.installed?.client_id || !clientConfig.installed?.client_secret) {
      logger.warn('Invalid credentials.json structure: missing installed.client_id or installed.client_secret');
      return null;
    }

    // Load tokens (access_token, refresh_token)
    if (!fs.existsSync(TOKENS_PATH)) {
      logger.warn({ path: TOKENS_PATH }, 'Google Calendar tokens not found');
      return null;
    }
    const tokensFile: TokensFile = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf-8'));

    if (!tokensFile.normal?.refresh_token) {
      logger.warn('Invalid tokens.json structure: missing normal.refresh_token');
      return null;
    }

    // Merge into flat structure for OAuth2 client
    return {
      client_id: clientConfig.installed.client_id,
      client_secret: clientConfig.installed.client_secret,
      refresh_token: tokensFile.normal.refresh_token,
      access_token: tokensFile.normal.access_token,
    };
  } catch (err) {
    logger.error({ err }, 'Error loading calendar credentials');
    return null;
  }
}

async function getCalendarClient(): Promise<calendar_v3.Calendar | null> {
  if (calendarClient) {
    return calendarClient;
  }

  const credentials = loadCredentials();
  if (!credentials) {
    return null;
  }

  try {
    authClient = new google.auth.OAuth2(
      credentials.client_id,
      credentials.client_secret,
    );

    authClient.setCredentials({
      refresh_token: credentials.refresh_token,
      access_token: credentials.access_token,
    });

    calendarClient = google.calendar({ version: 'v3', auth: authClient });
    logger.info('Google Calendar client initialized');
    return calendarClient;
  } catch (err) {
    logger.error({ err }, 'Error initializing Google Calendar client');
    return null;
  }
}

function mapGoogleEvent(event: calendar_v3.Schema$Event): CalendarEvent {
  return {
    id: event.id || '',
    title: event.summary || 'Untitled',
    start: event.start?.dateTime || event.start?.date || '',
    end: event.end?.dateTime || event.end?.date || '',
    allDay: !event.start?.dateTime,
    location: event.location || undefined,
    description: event.description || undefined,
    color: event.colorId ? getColorFromId(event.colorId) : undefined,
  };
}

function getTodayRange(days: number): { timeMin: string; timeMax: string } {
  const timeMin = new Date();
  timeMin.setHours(0, 0, 0, 0);
  const timeMax = new Date(timeMin);
  timeMax.setDate(timeMax.getDate() + days);
  return { timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString() };
}

async function fetchEvents(
  client: calendar_v3.Calendar,
  days: number,
): Promise<CalendarEvent[]> {
  const { timeMin, timeMax } = getTodayRange(days);
  const response = await client.events.list({
    calendarId: 'primary',
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 50,
  });
  return (response.data.items || []).map(mapGoogleEvent);
}

export async function getCalendarEvents(view: 'day' | 'week' = 'day'): Promise<CalendarEventsResult> {
  const client = await getCalendarClient();

  if (!client) {
    logger.debug('Returning mock calendar events (no credentials)');
    return { events: getMockEvents(view) };
  }

  try {
    const events = await fetchEvents(client, view === 'week' ? 7 : 1);
    return { events };
  } catch (err) {
    logger.error({ err }, 'Error fetching calendar events');
    const msg = err instanceof Error ? err.message : String(err);
    const isAuthError = msg.includes('invalid_grant') || msg.includes('Token has been expired') || msg.includes('UNAUTHENTICATED');
    return { events: [], error: isAuthError ? 'auth_failed' : 'fetch_failed' };
  }
}

/**
 * Fetch real calendar events. Throws on API error (no mock fallback).
 * Use this for automated systems (reminders) where mock data would be harmful.
 */
export async function getCalendarEventsLive(): Promise<CalendarEvent[]> {
  const client = await getCalendarClient();
  if (!client) throw new Error('No calendar client available');
  return fetchEvents(client, 1);
}

// ─── OAuth flow ───

export async function getCalendarAuthStatus(): Promise<CalendarAuthStatus> {
  if (cachedAuthStatus === 'connected') return cachedAuthStatus;

  const config = loadClientConfig();
  if (!config) return 'missing_credentials';

  if (!fs.existsSync(TOKENS_PATH)) return 'missing_tokens';

  // Tokens file exists — try a test request to verify
  const client = await getCalendarClient();
  if (!client) return 'missing_tokens';

  try {
    await client.calendarList.list({ maxResults: 1 });
    cachedAuthStatus = 'connected';
    return 'connected';
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('invalid_grant') || message.includes('Token has been expired')) {
      // Reset stale client so next auth attempt starts fresh
      calendarClient = null;
      authClient = null;
      return 'expired';
    }
    logger.error({ err }, 'Calendar auth status check failed');
    return 'check_failed';
  }
}

export function getCalendarAuthUrl(): string | null {
  const config = loadClientConfig();
  if (!config) return null;

  const oauth2 = new google.auth.OAuth2(
    config.installed.client_id,
    config.installed.client_secret,
    REDIRECT_URI,
  );

  return oauth2.generateAuthUrl({
    access_type: 'offline',
    scope: CALENDAR_SCOPES,
    prompt: 'consent',
  });
}

export async function handleCalendarOAuthCallback(code: string): Promise<void> {
  const config = loadClientConfig();
  if (!config) throw new Error('Missing credentials.json');

  const oauth2 = new google.auth.OAuth2(
    config.installed.client_id,
    config.installed.client_secret,
    REDIRECT_URI,
  );

  const { tokens } = await oauth2.getToken(code);

  // Save in Calendar MCP format: { normal: { ... } }
  const tokensDir = path.dirname(TOKENS_PATH);
  if (!fs.existsSync(tokensDir)) {
    fs.mkdirSync(tokensDir, { recursive: true });
  }
  fs.writeFileSync(TOKENS_PATH, JSON.stringify({ normal: tokens }, null, 2));
  logger.info('Google Calendar tokens saved');

  // Reset cached client so next request uses new tokens
  calendarClient = null;
  authClient = null;
  cachedAuthStatus = null;
}

function getColorFromId(colorId: string): string {
  // Google Calendar color IDs mapped to CSS colors
  const colors: Record<string, string> = {
    '1': '#7986cb', // Lavender
    '2': '#33b679', // Sage
    '3': '#8e24aa', // Grape
    '4': '#e67c73', // Flamingo
    '5': '#f6c026', // Banana
    '6': '#f5511d', // Tangerine
    '7': '#039be5', // Peacock
    '8': '#616161', // Graphite
    '9': '#3f51b5', // Blueberry
    '10': '#0b8043', // Basil
    '11': '#d60000', // Tomato
  };
  return colors[colorId] || '#16a34a'; // Default green
}

function getMockEvents(view: 'day' | 'week'): CalendarEvent[] {
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  if (view === 'day') {
    return [
      {
        id: 'mock-1',
        title: 'Morning Standup',
        start: new Date(today.getTime() + 9 * 60 * 60 * 1000).toISOString(),
        end: new Date(today.getTime() + 9.5 * 60 * 60 * 1000).toISOString(),
        allDay: false,
        color: '#16a34a',
      },
      {
        id: 'mock-2',
        title: 'Deep Work Block',
        start: new Date(today.getTime() + 10 * 60 * 60 * 1000).toISOString(),
        end: new Date(today.getTime() + 12 * 60 * 60 * 1000).toISOString(),
        allDay: false,
        color: '#2563eb',
      },
      {
        id: 'mock-3',
        title: 'Lunch',
        start: new Date(today.getTime() + 12 * 60 * 60 * 1000).toISOString(),
        end: new Date(today.getTime() + 13 * 60 * 60 * 1000).toISOString(),
        allDay: false,
        color: '#d97706',
      },
    ];
  }

  // Week view - add events for multiple days
  const events: CalendarEvent[] = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(today);
    day.setDate(day.getDate() + i);

    events.push({
      id: `mock-${i}-1`,
      title: i === 0 ? 'Morning Standup' : 'Daily Check-in',
      start: new Date(day.getTime() + 9 * 60 * 60 * 1000).toISOString(),
      end: new Date(day.getTime() + 9.5 * 60 * 60 * 1000).toISOString(),
      allDay: false,
      color: '#16a34a',
    });

    if (i % 2 === 0) {
      events.push({
        id: `mock-${i}-2`,
        title: 'Focus Time',
        start: new Date(day.getTime() + 14 * 60 * 60 * 1000).toISOString(),
        end: new Date(day.getTime() + 16 * 60 * 60 * 1000).toISOString(),
        allDay: false,
        color: '#7c3aed',
      });
    }
  }

  return events;
}
