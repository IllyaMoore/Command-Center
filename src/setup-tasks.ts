#!/usr/bin/env tsx
/**
 * CEO-8: Seed scheduled tasks for the CEO assistant.
 *
 * Usage:
 *   npx tsx src/setup-tasks.ts --jid "120363...@g.us"
 *
 * Idempotent — existing tasks with the same ID are skipped.
 */
import { CronExpressionParser } from 'cron-parser';

import { createTask, getTimezone, initDatabase } from './db.js';
import { ScheduledTask } from './types.js';

const GROUP_FOLDER = 'ceo';

interface TaskDef {
  id: string;
  cron: string;
  prompt: string;
}

const TASKS: TaskDef[] = [
  {
    id: 'ceo-briefing',
    cron: '0 13 * * *', // 13:00 UTC
    prompt: `Daily briefing. Synthesize:
1. Check today's calendar events using calendar tools
2. Search for important unread emails from the last 12 hours
3. Summarize overnight activity

Deliver a concise morning briefing following the Daily Briefing Format in your instructions.`,
  },
  {
    id: 'ceo-email-digest',
    cron: '0 9,14,18 * * *', // 9am, 2pm, 6pm UTC
    prompt: `Email digest. Search Gmail for important unread emails since your last digest.
Categorize into:
- Action Required (needs a response or decision)
- FYI (informational, no action needed)

Deliver using the Email Digest Format in your instructions. Skip if no notable emails.`,
  },
  {
    id: 'ceo-meeting-prep',
    cron: '0 20 * * *', // 20:00 UTC
    prompt: `Meeting prep for tomorrow. Using calendar tools:
1. List all events for tomorrow
2. For each meeting, search emails for recent correspondence with attendees
3. Prepare talking points and context

Deliver using the Meeting Prep Format in your instructions. Skip if no meetings tomorrow.`,
  },
  {
    id: 'ceo-weekly-review',
    cron: '0 8 * * 1', // Monday 8am UTC
    prompt: `Weekly review. Prepare a week-ahead overview:
1. List all calendar events for the upcoming week
2. Highlight days with heavy meeting loads
3. Flag any scheduling conflicts
4. Summarize any unfinished email threads that need follow-up

Keep it concise and actionable.`,
  },
];

function main() {
  const jidArg = process.argv.find((a) => a.startsWith('--jid='));
  const jidIdx = process.argv.indexOf('--jid');
  const jid = jidArg
    ? jidArg.split('=')[1]
    : jidIdx !== -1
      ? process.argv[jidIdx + 1]
      : undefined;

  if (!jid) {
    console.error('Usage: tsx src/setup-tasks.ts --jid "GROUP_JID"');
    process.exit(1);
  }

  initDatabase();
  const tz = getTimezone();
  console.log(`Timezone: ${tz}`);
  console.log(`Group JID: ${jid}`);
  console.log('');

  let created = 0;
  let skipped = 0;

  for (const def of TASKS) {
    const interval = CronExpressionParser.parse(def.cron, { tz });
    const nextRun = interval.next().toISOString();

    const task: Omit<ScheduledTask, 'last_run' | 'last_result'> = {
      id: def.id,
      group_folder: GROUP_FOLDER,
      chat_jid: jid,
      prompt: def.prompt,
      schedule_type: 'cron',
      schedule_value: def.cron,
      context_mode: 'group',
      next_run: nextRun,
      status: 'active',
      created_at: new Date().toISOString(),
    };

    try {
      createTask(task);
      console.log(`  + ${def.id}  next_run=${nextRun}`);
      created++;
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        err.message.includes('UNIQUE constraint failed')
      ) {
        console.log(`  ~ ${def.id}  (already exists, skipped)`);
        skipped++;
      } else {
        throw err;
      }
    }
  }

  console.log('');
  console.log(`Done. Created: ${created}, Skipped: ${skipped}`);
}

main();
