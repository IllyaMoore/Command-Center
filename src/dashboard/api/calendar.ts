import fs from 'fs';
import path from 'path';
import { google, calendar_v3 } from 'googleapis';

import { logger } from '../../logger.js';

// Path to Google Calendar MCP credentials
const HOME = process.env.HOME || process.env.USERPROFILE || '';
const CREDENTIALS_PATH = path.join(HOME, '.google-calendar-mcp', 'credentials.json');

interface CalendarCredentials {
  client_id: string;
  client_secret: string;
  refresh_token: string;
  access_token?: string;
}

interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  description?: string;
  color?: string;
}

let calendarClient: calendar_v3.Calendar | null = null;
let authClient: InstanceType<typeof google.auth.OAuth2> | null = null;

function loadCredentials(): CalendarCredentials | null {
  try {
    if (!fs.existsSync(CREDENTIALS_PATH)) {
      logger.warn({ path: CREDENTIALS_PATH }, 'Google Calendar credentials not found');
      return null;
    }
    const data = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
    return data;
  } catch (err) {
    logger.error({ err, path: CREDENTIALS_PATH }, 'Error loading calendar credentials');
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

export async function getCalendarEvents(view: 'day' | 'week' = 'day'): Promise<CalendarEvent[]> {
  const client = await getCalendarClient();

  if (!client) {
    // Return mock data when no credentials available
    logger.debug('Returning mock calendar events (no credentials)');
    return getMockEvents(view);
  }

  try {
    const now = new Date();
    const timeMin = new Date(now);
    timeMin.setHours(0, 0, 0, 0);

    const timeMax = new Date(timeMin);
    if (view === 'week') {
      timeMax.setDate(timeMax.getDate() + 7);
    } else {
      timeMax.setDate(timeMax.getDate() + 1);
    }

    const response = await client.events.list({
      calendarId: 'primary',
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 50,
    });

    const events = response.data.items || [];
    return events.map((event): CalendarEvent => ({
      id: event.id || '',
      title: event.summary || 'Untitled',
      start: event.start?.dateTime || event.start?.date || '',
      end: event.end?.dateTime || event.end?.date || '',
      allDay: !event.start?.dateTime,
      location: event.location || undefined,
      description: event.description || undefined,
      color: event.colorId ? getColorFromId(event.colorId) : undefined,
    }));
  } catch (err) {
    logger.error({ err }, 'Error fetching calendar events');
    // Return mock data on error
    return getMockEvents(view);
  }
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
