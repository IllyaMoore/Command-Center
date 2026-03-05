import { MAIN_GROUP_FOLDER, REMINDER_POLL_INTERVAL } from './config.js';
import {
  CalendarEvent,
  getCalendarEventsLive,
  getCalendarAuthStatus,
} from './dashboard/api/calendar.js';
import { getDueReminders, getTimezone, markReminderSent } from './db.js';
import { logger } from './logger.js';
import { RegisteredGroup } from './types.js';

export interface ReminderDeps {
  sendMessage: (jid: string, text: string) => Promise<void>;
  registeredGroups: () => Record<string, RegisteredGroup>;
}

const REMINDER_WINDOW_MIN_MS = 4 * 60 * 1000; // 4 minutes
const REMINDER_WINDOW_MAX_MS = 9 * 60 * 1000; // 9 minutes (> poll interval, guarantees catch)

let reminderLoopRunning = false;
let calendarFailCount = 0;

export function startMeetingReminderLoop(deps: ReminderDeps): void {
  if (reminderLoopRunning) {
    logger.debug('Reminder loop already running, skipping duplicate start');
    return;
  }
  reminderLoopRunning = true;
  logger.info('Meeting reminder loop started');

  // In-memory only — resets on restart. Duplicate reminder possible if restart
  // happens within 9 min of meeting start. Acceptable trade-off vs DB complexity.
  const remindedEventIds = new Set<string>();
  let lastClearDate = new Date().toDateString();

  const loop = async () => {
    try {
      const today = new Date().toDateString();
      if (today !== lastClearDate) {
        remindedEventIds.clear();
        lastClearDate = today;
      }

      await checkCalendarReminders(deps, remindedEventIds);
      await checkAdHocReminders(deps);
    } catch (err) {
      logger.error({ err }, 'Error in reminder loop');
    }

    setTimeout(loop, REMINDER_POLL_INTERVAL);
  };

  loop();
}

function findMainGroupJid(deps: ReminderDeps): string | null {
  const groups = deps.registeredGroups();
  for (const [jid, g] of Object.entries(groups)) {
    if (g.folder === MAIN_GROUP_FOLDER) return jid;
  }
  return null;
}

async function checkCalendarReminders(
  deps: ReminderDeps,
  remindedEventIds: Set<string>,
): Promise<void> {
  const mainJid = findMainGroupJid(deps);
  if (!mainJid) return;

  const authStatus = await getCalendarAuthStatus();
  if (authStatus !== 'connected') return;

  const events = await getCalendarEventsLive().catch((err: unknown) => {
    calendarFailCount++;
    const logFn = calendarFailCount >= 3 ? logger.error.bind(logger) : logger.warn.bind(logger);
    logFn({ err, consecutiveFailures: calendarFailCount }, 'Failed to fetch calendar events for reminders');
    return null;
  });
  if (!events) return;
  calendarFailCount = 0;

  const now = Date.now();

  for (const event of events) {
    if (event.allDay) continue;
    if (remindedEventIds.has(event.id)) continue;

    const startMs = new Date(event.start).getTime();
    const diff = startMs - now;

    if (diff >= REMINDER_WINDOW_MIN_MS && diff <= REMINDER_WINDOW_MAX_MS) {
      const minutesUntil = Math.round(diff / 60_000);
      const text = formatCalendarReminder(event, minutesUntil);

      try {
        await deps.sendMessage(mainJid, text);
        remindedEventIds.add(event.id);
        logger.info(
          { eventId: event.id, title: event.title },
          'Calendar reminder sent',
        );
      } catch (err) {
        logger.error(
          { err, eventId: event.id },
          'Failed to send calendar reminder',
        );
      }
    }
  }
}

async function checkAdHocReminders(deps: ReminderDeps): Promise<void> {
  const dueReminders = getDueReminders();

  for (const reminder of dueReminders) {
    // Expire reminders that are 1h+ overdue (permanent send failure protection)
    const remindAtMs = new Date(reminder.remind_at).getTime();
    if (Date.now() - remindAtMs > 60 * 60 * 1000) {
      markReminderSent(reminder.id);
      logger.warn({ reminderId: reminder.id }, 'Reminder expired after repeated failures');
      continue;
    }

    const text = `*Reminder*\n${reminder.text}`;

    try {
      await deps.sendMessage(reminder.chat_jid, text);
      markReminderSent(reminder.id);
      logger.info({ reminderId: reminder.id }, 'Ad-hoc reminder sent');
    } catch (err) {
      logger.error(
        { err, reminderId: reminder.id },
        'Failed to send ad-hoc reminder',
      );
    }
  }
}

function formatCalendarReminder(
  event: Pick<CalendarEvent, 'title' | 'start' | 'end' | 'location'>,
  minutesUntil: number,
): string {
  const tz = getTimezone();
  const opts: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: tz,
  };
  const startTime = new Date(event.start).toLocaleTimeString('en-US', opts);
  const endTime = new Date(event.end).toLocaleTimeString('en-US', opts);

  const lines = [
    `*Meeting in ${minutesUntil} min*`,
    event.title,
    `${startTime} – ${endTime}`,
  ];
  if (event.location) lines.push(event.location);
  return lines.join('\n');
}
