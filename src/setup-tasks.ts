#!/usr/bin/env tsx
/**
 * Seed scheduled tasks for agent groups.
 *
 * Usage:
 *   npx tsx src/setup-tasks.ts --jid "120363...@g.us" [--group ceo|finance]
 *
 * Defaults to --group ceo if not specified.
 * Idempotent — existing tasks with the same ID are skipped.
 */
import { CronExpressionParser } from 'cron-parser';

import { createTask, getTimezone, initDatabase } from './db.js';
import { ScheduledTask } from './types.js';

interface TaskDef {
  id: string;
  cron: string;
  prompt: string;
}

interface GroupConfig {
  folder: string;
  tasks: TaskDef[];
}

const CEO_TASKS: TaskDef[] = [
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

const FINANCE_TASKS: TaskDef[] = [
  {
    id: 'finance-expense-scan',
    cron: '0 21 * * *', // 21:00 UTC daily
    prompt: `Daily expense scan. Using Google Sheets tools:
1. Open the finance spreadsheets for Digital Purse and Borderlands
2. Scan for new/uncategorized transactions added today
3. Categorize each transaction using the Standard Categories in your instructions
4. Flag any anomalies (unusual amounts, duplicate charges, unexpected merchants)
5. Update the spreadsheet with categories

Deliver using the Daily Expense Summary format in your instructions. Skip if no new transactions.`,
  },
  {
    id: 'finance-weekly-report',
    cron: '0 8 * * 1', // Monday 8am UTC
    prompt: `Weekly finance report. Using Google Sheets tools:
1. Pull revenue and expense data for the past week from Digital Purse and Borderlands spreadsheets
2. Calculate P&L per organization and combined
3. Compare against budget — flag any categories >15% over
4. Calculate burn rate and cash flow summary

Deliver using the Weekly P&L Report format in your instructions.`,
  },
];

const GROUPS: Record<string, GroupConfig> = {
  ceo: { folder: 'ceo', tasks: CEO_TASKS },
  finance: { folder: 'finance', tasks: FINANCE_TASKS },
};

function parseArg(name: string): string | undefined {
  const flag = `--${name}`;
  const equalsArg = process.argv.find((a) => a.startsWith(`${flag}=`));
  if (equalsArg) return equalsArg.slice(flag.length + 1);
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function main(): void {
  const jid = parseArg('jid');
  const groupName = parseArg('group') || 'ceo';

  if (!jid) {
    console.error(
      'Usage: tsx src/setup-tasks.ts --jid "GROUP_JID" [--group ceo|finance]',
    );
    process.exit(1);
  }

  const groupConfig = GROUPS[groupName];
  if (!groupConfig) {
    console.error(
      `Unknown group: ${groupName}. Available: ${Object.keys(GROUPS).join(', ')}`,
    );
    process.exit(1);
  }

  initDatabase();
  const tz = getTimezone();
  console.log(`Group: ${groupName} (folder: ${groupConfig.folder})`);
  console.log(`Timezone: ${tz}`);
  console.log(`Group JID: ${jid}`);
  console.log('');

  let created = 0;
  let skipped = 0;

  for (const def of groupConfig.tasks) {
    const interval = CronExpressionParser.parse(def.cron, { tz });
    const nextRun = interval.next().toISOString();

    const task: Omit<ScheduledTask, 'last_run' | 'last_result'> = {
      id: def.id,
      group_folder: groupConfig.folder,
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
