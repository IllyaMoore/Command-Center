import { WhatsAppChannel } from './channels/whatsapp.js';
import { GroupQueue } from './group-queue.js';
import {
  getAllRegisteredGroups,
  getAllSessions,
  getRouterState,
  setRouterState,
} from './db.js';
import { Channel, RegisteredGroup } from './types.js';
import { logger } from './logger.js';

export interface AppState {
  lastTimestamp: string;
  sessions: Record<string, string>;
  registeredGroups: Record<string, RegisteredGroup>;
  lastAgentTimestamp: Record<string, string>;
  messageLoopRunning: boolean;
  whatsapp: WhatsAppChannel | null;
  channels: Channel[];
  queue: GroupQueue;
}

export function createAppState(): AppState {
  return {
    lastTimestamp: '',
    sessions: {},
    registeredGroups: {},
    lastAgentTimestamp: {},
    messageLoopRunning: false,
    whatsapp: null,
    channels: [],
    queue: new GroupQueue(),
  };
}

export function loadState(state: AppState): void {
  state.lastTimestamp = getRouterState('last_timestamp') || '';
  const agentTs = getRouterState('last_agent_timestamp');
  try {
    state.lastAgentTimestamp = agentTs ? JSON.parse(agentTs) : {};
  } catch (err) {
    logger.warn({ err }, 'Failed to parse last_agent_timestamp in DB, resetting');
    state.lastAgentTimestamp = {};
  }
  state.sessions = getAllSessions();
  state.registeredGroups = getAllRegisteredGroups();
  logger.info(
    { groupCount: Object.keys(state.registeredGroups).length },
    'State loaded',
  );
}

export function saveState(state: AppState): void {
  try {
    setRouterState('last_timestamp', state.lastTimestamp);
    setRouterState(
      'last_agent_timestamp',
      JSON.stringify(state.lastAgentTimestamp),
    );
  } catch (err) {
    logger.error({ err }, 'Failed to persist router state to DB — cursor may be lost on restart');
    throw err;
  }
}

/** Map UI setting (ask/auto) → agent approvalMode (on-miss/off) */
export function mapApprovalMode(groupFolder: string): 'off' | 'on-miss' {
  const setting = getRouterState(`approval_mode:${groupFolder}`) || 'auto';
  return setting === 'ask' ? 'on-miss' : 'off';
}
