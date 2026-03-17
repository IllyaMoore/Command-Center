import path from 'path';

import { readEnvFile } from './env.js';

// Read config values from .env (falls back to process.env).
// Secrets are NOT read here — they stay on disk and are loaded only
// where needed (container-runner.ts) to avoid leaking to child processes.
const envConfig = readEnvFile(['ASSISTANT_NAME', 'ASSISTANT_HAS_OWN_NUMBER', 'DEV_MODE', 'DASHBOARD_URL']);

export const ASSISTANT_NAME =
  process.env.ASSISTANT_NAME || envConfig.ASSISTANT_NAME || 'Assistant';

export const ASSISTANT_HAS_OWN_NUMBER =
  (process.env.ASSISTANT_HAS_OWN_NUMBER || envConfig.ASSISTANT_HAS_OWN_NUMBER) === 'true';

const devMode = process.env.DEV_MODE || envConfig.DEV_MODE || 'false';
export const DEV_MODE = devMode === 'true' || devMode === '1';

export const DASHBOARD_URL =
  process.env.DASHBOARD_URL || envConfig.DASHBOARD_URL || 'http://localhost:3000';

if (DASHBOARD_URL === 'http://localhost:3000' && !DEV_MODE) {
  console.warn(
    '[config] DASHBOARD_URL not set — OAuth redirect URIs will use localhost:3000, which will break OAuth in production',
  );
}

// Model routing (OPC-79)
export const DEFAULT_MODEL = 'claude-sonnet-4-6';
export const ALLOWED_MODELS = ['claude-sonnet-4-6', 'claude-opus-4-6'] as const;
export type ModelId = (typeof ALLOWED_MODELS)[number];

export function isValidModel(model: string): model is ModelId {
  return (ALLOWED_MODELS as readonly string[]).includes(model);
}

export const POLL_INTERVAL = 2000;
export const SCHEDULER_POLL_INTERVAL = 60000;
export const REMINDER_POLL_INTERVAL = 300000;

// Absolute paths
const PROJECT_ROOT = process.cwd();
const HOME_DIR = process.env.HOME || '/Users/user';

// Mount security: allowlist stored OUTSIDE project root, never exposed to agents
export const MOUNT_ALLOWLIST_PATH = path.join(
  HOME_DIR,
  '.config',
  'nanoclaw',
  'mount-allowlist.json',
);
export const STORE_DIR = path.resolve(PROJECT_ROOT, 'store');
export const GROUPS_DIR = path.resolve(PROJECT_ROOT, 'groups');
export const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');
export const MAIN_GROUP_FOLDER = 'ceo';

export const AGENT_RUNNER_PATH = path.resolve(
  PROJECT_ROOT,
  'container',
  'agent-runner',
  'dist',
  'index.js',
);

export const CONTAINER_TIMEOUT = parseInt(
  process.env.CONTAINER_TIMEOUT || '600000',
  10,
); // 10min hard kill
export const WARNING_TIMEOUT = parseInt(
  process.env.WARNING_TIMEOUT || '300000',
  10,
); // 5min warning

export const CONTAINER_MAX_OUTPUT_SIZE = parseInt(
  process.env.CONTAINER_MAX_OUTPUT_SIZE || '10485760',
  10,
); // 10MB default
export const IPC_POLL_INTERVAL = 1000;
export const IDLE_TIMEOUT = parseInt(
  process.env.IDLE_TIMEOUT || '30000',
  10,
); // 30sec default — how long to keep agent process alive after last result
const _parsedMaxContainers = parseInt(process.env.MAX_CONCURRENT_CONTAINERS ?? '3', 10);
export const MAX_CONCURRENT_CONTAINERS = Math.max(
  1,
  Number.isNaN(_parsedMaxContainers) ? 3 : _parsedMaxContainers,
);

const _parsedDailyLimit = parseInt(process.env.DAILY_API_LIMIT ?? '80', 10);
export const DAILY_API_LIMIT = Math.max(
  0,
  Number.isNaN(_parsedDailyLimit) ? 80 : _parsedDailyLimit,
); // 0 = unlimited

export const WARNING_MESSAGE =
  'Processing your request \u2014 this may take a few more minutes';
export const TIMEOUT_MESSAGE =
  "The agent couldn't complete your request within the time limit. Please try again or simplify your request";

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const TRIGGER_PATTERN = new RegExp(
  `^@${escapeRegex(ASSISTANT_NAME)}\\b`,
  'i',
);

// Timezone: managed dynamically via db.ts getTimezone() / setTimezone()
// Reads from DB (set via dashboard), falls back to TZ env var, then system timezone.
