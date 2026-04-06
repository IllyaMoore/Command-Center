import fs from 'fs';
import path from 'path';

import { ASSISTANT_NAME, DATA_DIR } from './config.js';
import { AppState } from './app-state.js';
import { getAllChats, setRegisteredGroup } from './db.js';
import { AvailableGroup } from './container-runner.js';
import { Channel, RegisteredGroup } from './types.js';
import { logger } from './logger.js';

export function findChannel(state: AppState, jid: string): Channel | undefined {
  return state.channels.find((c) => c.ownsJid(jid) && c.isConnected());
}

export async function sendToChannel(state: AppState, jid: string, text: string): Promise<boolean> {
  const channel = findChannel(state, jid);
  if (!channel) {
    logger.warn({ jid }, 'No channel found for JID');
    return false;
  }
  try {
    await channel.sendMessage(jid, text);
    return true;
  } catch (err) {
    logger.error({ jid, channel: channel.name, err }, 'Failed to deliver message');
    return false;
  }
}

/** Returns the trigger regexp for a specific group (uses group.trigger if set, else global). */
export function groupTrigger(group: RegisteredGroup): RegExp {
  const t = group.trigger || `@${ASSISTANT_NAME}`;
  return new RegExp(`^${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
}

export function registerGroup(state: AppState, jid: string, group: RegisteredGroup): void {
  // DB write first — if it fails, in-memory state stays consistent
  setRegisteredGroup(jid, group);

  // Create group folder
  const groupDir = path.join(DATA_DIR, '..', 'groups', group.folder);
  fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });

  // Only update in-memory after DB + filesystem succeed
  state.registeredGroups[jid] = group;

  logger.info(
    { jid, name: group.name, folder: group.folder },
    'Group registered',
  );
}

/**
 * Get available chats list for the agent.
 * Returns groups and DMs ordered by most recent activity.
 */
export function getAvailableGroups(state: AppState): AvailableGroup[] {
  const chats = getAllChats();
  const registeredJids = new Set(Object.keys(state.registeredGroups));

  return chats
    .filter((c) => c.jid !== '__group_sync__' && state.channels.some((ch) => ch.ownsJid(c.jid)))
    .map((c) => ({
      jid: c.jid,
      name: c.name,
      lastActivity: c.last_message_time,
      isRegistered: registeredJids.has(c.jid),
    }));
}

/** @internal - exported for testing */
export function _setRegisteredGroups(state: AppState, groups: Record<string, RegisteredGroup>): void {
  state.registeredGroups = groups;
}

/** @internal - exported for testing */
export function _setChannels(state: AppState, chs: Channel[]): void {
  state.channels.length = 0;
  state.channels.push(...chs);
}
