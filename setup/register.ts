/**
 * Step: register — Write channel registration config, create group folders.
 *
 * Usage: npx tsx setup/index.ts --step register \
 *   --jid "tg:123456" --name "My Group" --folder "mygroup" \
 *   --trigger "@Andy" --channel telegram [--no-trigger-required]
 */
import fs from 'fs';
import path from 'path';

import { initDatabase, setRegisteredGroup } from '../src/db.js';
import { logger } from '../src/logger.js';
import { emitStatus } from './status.js';

interface RegisterArgs {
  jid: string;
  name: string;
  trigger: string;
  folder: string;
  channel: string;
  requiresTrigger: boolean;
}

function parseArgs(args: string[]): RegisterArgs {
  const result: RegisterArgs = {
    jid: '',
    name: '',
    trigger: '',
    folder: '',
    channel: 'whatsapp',
    requiresTrigger: true,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--jid':
        result.jid = args[++i] || '';
        break;
      case '--name':
        result.name = args[++i] || '';
        break;
      case '--trigger':
        result.trigger = args[++i] || '';
        break;
      case '--folder':
        result.folder = args[++i] || '';
        break;
      case '--channel':
        result.channel = (args[++i] || '').toLowerCase();
        break;
      case '--no-trigger-required':
        result.requiresTrigger = false;
        break;
    }
  }

  return result;
}

// Validate folder name: alphanumeric, hyphens, underscores only
function isValidFolder(folder: string): boolean {
  return /^[a-z0-9][a-z0-9_-]*$/.test(folder);
}

export async function run(args: string[]): Promise<void> {
  const projectRoot = process.cwd();
  const parsed = parseArgs(args);

  if (!parsed.jid || !parsed.name || !parsed.trigger || !parsed.folder) {
    emitStatus('REGISTER_CHANNEL', {
      STATUS: 'failed',
      ERROR: 'Missing required args: --jid, --name, --trigger, --folder',
    });
    process.exit(4);
  }

  if (!isValidFolder(parsed.folder)) {
    emitStatus('REGISTER_CHANNEL', {
      STATUS: 'failed',
      ERROR: 'Invalid folder name (use lowercase alphanumeric, hyphens, underscores)',
    });
    process.exit(4);
  }

  logger.info(parsed, 'Registering channel');

  // Use the app's initDatabase to ensure schema is correct
  initDatabase();

  setRegisteredGroup(parsed.jid, {
    name: parsed.name,
    folder: parsed.folder,
    trigger: parsed.trigger,
    added_at: new Date().toISOString(),
    requiresTrigger: parsed.requiresTrigger,
  });

  logger.info('Wrote registration to SQLite');

  // Create group folders
  fs.mkdirSync(path.join(projectRoot, 'groups', parsed.folder, 'logs'), {
    recursive: true,
  });

  emitStatus('REGISTER_CHANNEL', {
    JID: parsed.jid,
    NAME: parsed.name,
    FOLDER: parsed.folder,
    CHANNEL: parsed.channel,
    TRIGGER: parsed.trigger,
    REQUIRES_TRIGGER: parsed.requiresTrigger,
    STATUS: 'success',
  });
}
