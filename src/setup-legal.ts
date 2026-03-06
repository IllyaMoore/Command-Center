#!/usr/bin/env tsx
/**
 * LOS-58: Register the Legal agent group and seed scheduled tasks.
 *
 * Usage:
 *   npx tsx src/setup-legal.ts --jid "120363...@g.us"
 *
 * Idempotent — existing tasks with the same ID are skipped.
 * Group registration uses INSERT OR REPLACE, so re-running is safe.
 */
import { CronExpressionParser } from 'cron-parser';

import { createTask, getTimezone, initDatabase, setRegisteredGroup } from './db.js';
import { ScheduledTask } from './types.js';

const GROUP_FOLDER = 'legal';
const GROUP_NAME = 'Legal';
const TRIGGER = '@Legal';

interface TaskDef {
  id: string;
  cron: string;
  prompt: string;
}

const TASKS: TaskDef[] = [
  {
    id: 'legal-watch',
    cron: '0 8 * * 1-5', // Weekdays 8am UTC
    prompt: `Legal watch scan. Using Atlassian tools:
1. Search Jira for overdue issues (duedate < now() AND status != Done), ordered by duedate
2. Search for issues with deadlines in the next 7 days
3. Check status of active complaint issues
4. Search for any FCA or compliance deadlines

Deliver using the Legal Watch Format in your instructions.
Only send a message if there are items to report — skip silently if everything is on track.`,
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
    console.error('Usage: tsx src/setup-legal.ts --jid "GROUP_JID"');
    process.exit(1);
  }

  initDatabase();
  const tz = getTimezone();
  console.log(`Timezone: ${tz}`);
  console.log(`Group JID: ${jid}`);
  console.log('');

  // Register the group
  console.log('Registering legal group...');
  setRegisteredGroup(jid, {
    name: GROUP_NAME,
    folder: GROUP_FOLDER,
    trigger: TRIGGER,
    added_at: new Date().toISOString(),
    requiresTrigger: true,
  });
  console.log(`  + ${GROUP_NAME} (folder: ${GROUP_FOLDER}, trigger: ${TRIGGER})`);
  console.log('');

  // Seed tasks
  console.log('Seeding scheduled tasks...');
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
  console.log('');
  console.log('Next steps:');
  console.log('  1. Add ATLASSIAN_BASIC_TOKEN to .env (base64 of email:api_token)');
  console.log('  2. Rebuild: npm run build');
  console.log('  3. Restart: npm run dev');
  console.log(`  4. Test: send "${TRIGGER} What issues are in Jira?" to the registered group`);
}

main();
