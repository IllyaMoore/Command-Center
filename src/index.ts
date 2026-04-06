
import { ASSISTANT_NAME } from './config.js';
import { WhatsAppChannel } from './channels/whatsapp.js';
import { getRegisteredChannelNames, getChannelFactory } from './channels/index.js';
import { writeGroupsSnapshot } from './container-runner.js';
import { getAllChats, initDatabase, storeChatMetadata, storeMessage } from './db.js';
import { startIpcWatcher } from './ipc.js';
import { formatOutbound } from './router.js';
import { startMeetingReminderLoop } from './meeting-reminders.js';
import { startSchedulerLoop } from './task-scheduler.js';
import { Channel, NewMessage, RegisteredGroup } from './types.js';
import { logger } from './logger.js';
import { setDashboardQueue } from './dashboard/context.js';
import { startDashboardServer } from './dashboard/server.js';
import { ensureUploadsDir } from './dashboard/api/upload.js';

import { AppState, createAppState, loadState } from './app-state.js';
import {
  getAvailableGroups as _getAvailableGroups,
  registerGroup,
  sendToChannel,
  _setRegisteredGroups as __setRegisteredGroups,
  _setChannels as __setChannels,
} from './group-management.js';
import { processGroupMessages, recoverPendingMessages } from './message-processing.js';
import { startMessageLoop } from './message-loop.js';
import { createDashboardInputHandler } from './dashboard-handler.js';

// ─── Shared app state ───

const state: AppState = createAppState();

// ─── Re-exports for backward compatibility (routing.test.ts) ───

export function getAvailableGroups() {
  return _getAvailableGroups(state);
}

/** @internal - exported for testing */
export function _setRegisteredGroups(groups: Record<string, RegisteredGroup>): void {
  __setRegisteredGroups(state, groups);
}

/** @internal - exported for testing */
export function _setChannels(chs: Channel[]): void {
  __setChannels(state, chs);
}

// ─── Main ───

async function main(): Promise<void> {
  initDatabase();
  logger.info('Database initialized');
  loadState(state);

  // Share queue with dashboard API
  setDashboardQueue(state.queue);

  // Ensure uploads directory exists
  ensureUploadsDir();

  // Start dashboard server
  const dashboardPort = parseInt(process.env.DASHBOARD_PORT || '3000', 10);
  startDashboardServer(dashboardPort);

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    try { await state.queue.shutdown(10000); } catch (err) {
      logger.error({ err }, 'Error during queue shutdown');
    }
    for (const ch of state.channels) {
      try { await ch.disconnect(); } catch (err) {
        logger.error({ channel: ch.name, err }, 'Error disconnecting channel');
      }
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Channel callbacks (shared by all channels)
  const channelOpts = {
    onMessage: (_chatJid: string, msg: NewMessage) => storeMessage(msg),
    onChatMetadata: (chatJid: string, timestamp: string, name?: string) =>
      storeChatMetadata(chatJid, timestamp, name),
    registeredGroups: () => state.registeredGroups,
  };

  // Create WhatsApp channel (with WhatsApp-specific auto-registration callback)
  state.whatsapp = new WhatsAppChannel({
    ...channelOpts,
    onUnregisteredTrigger: (chatJid: string) => {
      const MAX_AUTO_GROUPS = 20;
      if (Object.keys(state.registeredGroups).length >= MAX_AUTO_GROUPS) {
        logger.warn({ chatJid, max: MAX_AUTO_GROUPS }, 'Auto-registration blocked: group limit reached');
        return false;
      }
      const chat = getAllChats().find((c) => c.jid === chatJid);
      const name = chat?.name || chatJid;
      const jidSlug = chatJid.split('@')[0].replace(/[^a-z0-9]+/gi, '-');
      registerGroup(state, chatJid, {
        name,
        folder: jidSlug,
        trigger: `@${ASSISTANT_NAME}`,
        added_at: new Date().toISOString(),
        requiresTrigger: true,
      });
      logger.info({ chatJid, name, folder: jidSlug }, 'Auto-registered group via trigger');
      return true;
    },
  });
  try {
    await state.whatsapp.connect();
    state.channels.push(state.whatsapp);
  } catch (err) {
    logger.warn({ err }, 'WhatsApp not available (auth required?), continuing without it');
    await state.whatsapp.disconnect().catch(() => {});
  }

  // Create registry-based channels (Telegram, etc.)
  for (const name of getRegisteredChannelNames()) {
    const factory = getChannelFactory(name);
    if (!factory) continue;
    try {
      const ch = factory(channelOpts);
      if (ch) {
        await ch.connect();
        state.channels.push(ch);
        logger.info({ channel: name }, 'Channel connected');
      }
    } catch (err) {
      logger.error({ channel: name, err }, 'Failed to connect channel, continuing without it');
    }
  }

  // Start subsystems
  startSchedulerLoop({
    registeredGroups: () => state.registeredGroups,
    getSessions: () => state.sessions,
    queue: state.queue,
    onProcess: (groupJid, proc, containerName, groupFolder) =>
      state.queue.registerProcess(groupJid, proc, containerName, groupFolder),
    sendMessage: async (jid, rawText) => {
      const text = formatOutbound(rawText);
      if (text) { await sendToChannel(state, jid, text); }
    },
  });
  startMeetingReminderLoop({
    sendMessage: async (jid, text) => { await sendToChannel(state, jid, text); },
    registeredGroups: () => state.registeredGroups,
  });
  startIpcWatcher({
    sendMessage: async (jid, text) => { await sendToChannel(state, jid, text); },
    registeredGroups: () => state.registeredGroups,
    registerGroup: (jid, group) => registerGroup(state, jid, group),
    syncGroupMetadata: (force) => state.whatsapp?.syncGroupMetadata(force) ?? Promise.resolve(),
    getAvailableGroups: () => _getAvailableGroups(state),
    writeGroupsSnapshot,
    onDashboardInput: createDashboardInputHandler(state),
  });
  state.queue.setProcessMessagesFn((chatJid) => processGroupMessages(state, chatJid));
  recoverPendingMessages(state);
  startMessageLoop(state);
}

// Guard: only run when executed directly, not when imported by tests
const isDirectRun =
  process.argv[1] &&
  new URL(import.meta.url).pathname === new URL(`file://${process.argv[1]}`).pathname;

if (isDirectRun) {
  main().catch((err) => {
    logger.error({ err }, 'Failed to start NanoClaw');
    process.exit(1);
  });
}
