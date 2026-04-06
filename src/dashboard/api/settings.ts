import { getTimezone, setTimezone } from '../../db.js';

// ─── GET /api/settings/timezone ───

export function getTimezonesetting(): { timezone: string } {
  return { timezone: getTimezone() };
}

// ─── POST /api/settings/timezone ───

export function updateTimezone(tz: string | undefined): {
  data?: unknown;
  error?: string;
  status: number;
} {
  if (!tz) {
    return { error: 'Missing timezone field', status: 400 };
  }

  try {
    const valid = Intl.supportedValuesOf('timeZone');
    if (!valid.includes(tz)) {
      return { error: 'Invalid timezone', status: 400 };
    }
  } catch {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: tz });
    } catch {
      return { error: 'Invalid timezone', status: 400 };
    }
  }

  setTimezone(tz);
  return { data: { success: true, timezone: tz }, status: 200 };
}
