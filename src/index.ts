
import fs from 'fs';
import path from 'path';

import {
  ASSISTANT_NAME,
  DATA_DIR,
  IDLE_TIMEOUT,
  MAIN_GROUP_FOLDER,
  POLL_INTERVAL,
  TRIGGER_PATTERN,
  WARNING_MESSAGE,
  TIMEOUT_MESSAGE,
} from './config.js';
import { WhatsAppChannel } from './channels/whatsapp.js';
import { getRegisteredChannelNames, getChannelFactory } from './channels/index.js';
import {
  ContainerOutput,
  runContainerAgent,
  writeGroupsSnapshot,
  writeTasksSnapshot,
} from './container-runner.js';
import {
  getAllChats,
  getAllRegisteredGroups,
  getAllSessions,
  getAllTasks,
  getMessagesSince,
  getNewMessages,
  getRouterState,
  initDatabase,
  setRegisteredGroup,
  setRouterState,
  setSession,
  storeChatMetadata,
  storeMessage,
} from './db.js';
import { GroupQueue } from './group-queue.js';
import { startIpcWatcher } from './ipc.js';
import { formatMessages, formatOutbound } from './router.js';
import { startMeetingReminderLoop } from './meeting-reminders.js';
import { startSchedulerLoop } from './task-scheduler.js';
import { Channel, NewMessage, RegisteredGroup } from './types.js';
import { logger } from './logger.js';
import { setDashboardQueue } from './dashboard/context.js';
import { startDashboardServer } from './dashboard/server.js';

let lastTimestamp = '';
let sessions: Record<string, string> = {};
let registeredGroups: Record<string, RegisteredGroup> = {};
let lastAgentTimestamp: Record<string, string> = {};
let messageLoopRunning = false;

let whatsapp: WhatsAppChannel;
const channels: Channel[] = [];
const queue = new GroupQueue();

function findChannel(jid: string): Channel | undefined {
  return channels.find((c) => c.ownsJid(jid) && c.isConnected());
}

async function sendToChannel(jid: string, text: string): Promise<boolean> {
  const channel = findChannel(jid);
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

function loadState(): void {
  lastTimestamp = getRouterState('last_timestamp') || '';
  const agentTs = getRouterState('last_agent_timestamp');
  try {
    lastAgentTimestamp = agentTs ? JSON.parse(agentTs) : {};
  } catch (err) {
    logger.warn({ err }, 'Failed to parse last_agent_timestamp in DB, resetting');
    lastAgentTimestamp = {};
  }
  sessions = getAllSessions();
  registeredGroups = getAllRegisteredGroups();
  logger.info(
    { groupCount: Object.keys(registeredGroups).length },
    'State loaded',
  );
}

function saveState(): void {
  try {
    setRouterState('last_timestamp', lastTimestamp);
    setRouterState(
      'last_agent_timestamp',
      JSON.stringify(lastAgentTimestamp),
    );
  } catch (err) {
    logger.error({ err }, 'Failed to persist router state to DB — cursor may be lost on restart');
    throw err;
  }
}

/** Returns the trigger regexp for a specific group (uses group.trigger if set, else global). */
function groupTrigger(group: RegisteredGroup): RegExp {
  const t = group.trigger || `@${ASSISTANT_NAME}`;
  return new RegExp(`^${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
}

function registerGroup(jid: string, group: RegisteredGroup): void {
  // DB write first — if it fails, in-memory state stays consistent
  setRegisteredGroup(jid, group);

  // Create group folder
  const groupDir = path.join(DATA_DIR, '..', 'groups', group.folder);
  fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });

  // Only update in-memory after DB + filesystem succeed
  registeredGroups[jid] = group;

  logger.info(
    { jid, name: group.name, folder: group.folder },
    'Group registered',
  );
}

/**
 * Get available chats list for the agent.
 * Returns groups and DMs ordered by most recent activity.
 */
export function getAvailableGroups(): import('./container-runner.js').AvailableGroup[] {
  const chats = getAllChats();
  const registeredJids = new Set(Object.keys(registeredGroups));

  return chats
    .filter((c) => c.jid !== '__group_sync__' && channels.some((ch) => ch.ownsJid(c.jid)))
    .map((c) => ({
      jid: c.jid,
      name: c.name,
      lastActivity: c.last_message_time,
      isRegistered: registeredJids.has(c.jid),
    }));
}

/** @internal - exported for testing */
export function _setRegisteredGroups(groups: Record<string, RegisteredGroup>): void {
  registeredGroups = groups;
}

/** @internal - exported for testing */
export function _setChannels(chs: Channel[]): void {
  channels.length = 0;
  channels.push(...chs);
}

/**
 * Process all pending messages for a group.
 * Called by the GroupQueue when it's this group's turn.
 */
async function processGroupMessages(chatJid: string): Promise<boolean> {
  const group = registeredGroups[chatJid];
  if (!group) return true;

  const isMainGroup = group.folder === MAIN_GROUP_FOLDER;

  const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
  const missedMessages = getMessagesSince(chatJid, sinceTimestamp, ASSISTANT_NAME);

  if (missedMessages.length === 0) return true;

  // For non-main groups, check if trigger is required and present
  if (!isMainGroup && group.requiresTrigger !== false) {
    const pattern = groupTrigger(group);
    const hasTrigger = missedMessages.some((m) =>
      pattern.test(m.content.trim()),
    );
    if (!hasTrigger) return true;
  }

  const prompt = formatMessages(missedMessages);

  // Advance cursor so the piping path in startMessageLoop won't re-fetch
  // these messages. Save the old cursor so we can roll back on error.
  const previousCursor = lastAgentTimestamp[chatJid] || '';
  lastAgentTimestamp[chatJid] =
    missedMessages[missedMessages.length - 1].timestamp;
  saveState();

  logger.info(
    { group: group.name, messageCount: missedMessages.length },
    'Processing messages',
  );

  // Track idle timer for closing stdin when agent is idle
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      logger.debug({ group: group.name }, 'Idle timeout, closing container stdin');
      queue.closeStdin(chatJid);
    }, IDLE_TIMEOUT);
  };

  const channel = findChannel(chatJid);
  await channel?.setTyping?.(chatJid, true);
  let hadError = false;
  let outputSentToUser = false;

  const output = await runAgent(
    group,
    prompt,
    chatJid,
    async (result) => {
      // Streaming output callback — called for each agent result
      if (result.result) {
        const raw = typeof result.result === 'string' ? result.result : JSON.stringify(result.result);
        // Strip <internal>...</internal> blocks — agent uses these for internal reasoning
        const text = raw.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
        logger.info({ group: group.name }, `Agent output: ${raw.slice(0, 200)}`);
        if (text) {
          const delivered = await sendToChannel(chatJid, text);
          if (delivered) outputSentToUser = true;
        }
        // Only reset idle timer on actual results, not session-update markers (result: null)
        resetIdleTimer();
      }

      if (result.status === 'error') {
        hadError = true;
      }
    },
    () => {
      sendToChannel(chatJid, WARNING_MESSAGE).catch((err) => {
        logger.warn({ chatJid, err }, 'Failed to send warning notification');
      });
    },
    (hadOutput: boolean) => {
      // Don't send timeout message if agent already produced output (idle cleanup)
      if (hadOutput) return;
      sendToChannel(chatJid, TIMEOUT_MESSAGE).catch((err) => {
        logger.warn({ chatJid, err }, 'Failed to send timeout notification');
      });
    },
  );

  await channel?.setTyping?.(chatJid, false);
  if (idleTimer) clearTimeout(idleTimer);

  if (output === 'error' || hadError) {
    // If we already sent output to the user, don't roll back the cursor —
    // the user got their response and re-processing would send duplicates.
    if (outputSentToUser) {
      logger.warn({ group: group.name }, 'Agent error after output was sent, skipping cursor rollback to prevent duplicates');
      return true;
    }
    // Roll back cursor so retries can re-process these messages
    lastAgentTimestamp[chatJid] = previousCursor;
    saveState();
    logger.warn({ group: group.name }, 'Agent error, rolled back message cursor for retry');
    return false;
  }

  return true;
}

async function runAgent(
  group: RegisteredGroup,
  prompt: string,
  chatJid: string,
  onOutput?: (output: ContainerOutput) => Promise<void>,
  onWarning?: () => void,
  onTimeout?: (hadOutput: boolean) => void,
): Promise<'success' | 'error'> {
  const isMain = group.folder === MAIN_GROUP_FOLDER;
  const sessionId = sessions[group.folder];

  // Update tasks snapshot for container to read (filtered by group)
  const tasks = getAllTasks();
  writeTasksSnapshot(
    group.folder,
    isMain,
    tasks.map((t) => ({
      id: t.id,
      groupFolder: t.group_folder,
      prompt: t.prompt,
      schedule_type: t.schedule_type,
      schedule_value: t.schedule_value,
      status: t.status,
      next_run: t.next_run,
    })),
  );

  // Update available groups snapshot (main group only can see all groups)
  const availableGroups = getAvailableGroups();
  writeGroupsSnapshot(
    group.folder,
    isMain,
    availableGroups,
    new Set(Object.keys(registeredGroups)),
  );

  // Wrap onOutput to track session ID from streamed results
  const wrappedOnOutput = onOutput
    ? async (output: ContainerOutput) => {
        if (output.newSessionId) {
          sessions[group.folder] = output.newSessionId;
          setSession(group.folder, output.newSessionId);
        }
        await onOutput(output);
      }
    : undefined;

  try {
    const output = await runContainerAgent(
      group,
      {
        prompt,
        sessionId,
        groupFolder: group.folder,
        chatJid,
        isMain,
        assistantName: ASSISTANT_NAME,
      },
      (proc, containerName) => queue.registerProcess(chatJid, proc, containerName, group.folder),
      wrappedOnOutput,
      onWarning,
      onTimeout,
    );

    if (output.newSessionId) {
      sessions[group.folder] = output.newSessionId;
      setSession(group.folder, output.newSessionId);
    }

    if (output.status === 'error') {
      logger.error(
        { group: group.name, error: output.error },
        'Agent error',
      );
      return 'error';
    }

    return 'success';
  } catch (err) {
    logger.error({ group: group.name, err }, 'Agent error');
    return 'error';
  }
}

async function startMessageLoop(): Promise<void> {
  if (messageLoopRunning) {
    logger.debug('Message loop already running, skipping duplicate start');
    return;
  }
  messageLoopRunning = true;

  logger.info(`NanoClaw running (trigger: @${ASSISTANT_NAME})`);

  while (true) {
    try {
      const jids = Object.keys(registeredGroups);
      const { messages, newTimestamp } = getNewMessages(jids, lastTimestamp, ASSISTANT_NAME);

      if (messages.length > 0) {
        logger.info({ count: messages.length }, 'New messages');

        // Advance the "seen" cursor for all messages immediately
        lastTimestamp = newTimestamp;
        saveState();

        // Deduplicate by group
        const messagesByGroup = new Map<string, NewMessage[]>();
        for (const msg of messages) {
          const existing = messagesByGroup.get(msg.chat_jid);
          if (existing) {
            existing.push(msg);
          } else {
            messagesByGroup.set(msg.chat_jid, [msg]);
          }
        }

        for (const [chatJid, groupMessages] of messagesByGroup) {
          const group = registeredGroups[chatJid];
          if (!group) continue;

          // Handle /activation command before trigger check
          const activationMsg = groupMessages.find((m) =>
            /^\/activation\s+(on|off)\s*$/i.test(m.content.trim()),
          );
          if (activationMsg) {
            const mode = activationMsg.content.trim().match(/^\/activation\s+(on|off)\s*$/i)![1].toLowerCase();
            const newRequiresTrigger = mode === 'off';
            setRegisteredGroup(chatJid, { ...group, requiresTrigger: newRequiresTrigger });
            group.requiresTrigger = newRequiresTrigger;
            const statusText = mode === 'on'
              ? `Activation: ON — responding to all messages in this group.`
              : `Activation: OFF — responding only to @${ASSISTANT_NAME} mentions.`;
            await sendToChannel(chatJid, statusText);
            logger.info({ chatJid, mode, requiresTrigger: newRequiresTrigger }, 'Group activation changed');
            // Advance cursor so /activation message doesn't leak into agent context
            lastAgentTimestamp[chatJid] = activationMsg.timestamp;
            saveState();
            continue;
          }

          const isMainGroup = group.folder === MAIN_GROUP_FOLDER;
          const needsTrigger = !isMainGroup && group.requiresTrigger !== false;

          // For non-main groups, only act on trigger messages.
          // Non-trigger messages accumulate in DB and get pulled as
          // context when a trigger eventually arrives.
          if (needsTrigger) {
            const pattern = groupTrigger(group);
            const hasTrigger = groupMessages.some((m) =>
              pattern.test(m.content.trim()),
            );
            if (!hasTrigger) continue;
          }

          // Pull all messages since lastAgentTimestamp so non-trigger
          // context that accumulated between triggers is included.
          const allPending = getMessagesSince(
            chatJid,
            lastAgentTimestamp[chatJid] || '',
            ASSISTANT_NAME,
          );
          const messagesToSend =
            allPending.length > 0 ? allPending : groupMessages;
          const formatted = formatMessages(messagesToSend);

          if (queue.sendMessage(chatJid, formatted)) {
            logger.debug(
              { chatJid, count: messagesToSend.length },
              'Piped messages to active container',
            );
            lastAgentTimestamp[chatJid] =
              messagesToSend[messagesToSend.length - 1].timestamp;
            saveState();
            // Show typing indicator while the container processes the piped message
            findChannel(chatJid)?.setTyping?.(chatJid, true)?.catch((err: unknown) => {
              logger.debug({ chatJid, err }, 'Failed to send typing indicator');
            });
          } else {
            // No active container — enqueue for a new one
            queue.enqueueMessageCheck(chatJid);
          }
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error in message loop');
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
}

/**
 * Startup recovery: check for unprocessed messages in registered groups.
 * Handles crash between advancing lastTimestamp and processing messages.
 */
function recoverPendingMessages(): void {
  for (const [chatJid, group] of Object.entries(registeredGroups)) {
    const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
    const pending = getMessagesSince(chatJid, sinceTimestamp, ASSISTANT_NAME);
    if (pending.length > 0) {
      logger.info(
        { group: group.name, pendingCount: pending.length },
        'Recovery: found unprocessed messages',
      );
      queue.enqueueMessageCheck(chatJid);
    }
  }
}


async function main(): Promise<void> {
  initDatabase();
  logger.info('Database initialized');
  loadState();

  // Share queue with dashboard API
  setDashboardQueue(queue);

  // Start dashboard server
  const dashboardPort = parseInt(process.env.DASHBOARD_PORT || '3000', 10);
  startDashboardServer(dashboardPort);

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    try { await queue.shutdown(10000); } catch (err) {
      logger.error({ err }, 'Error during queue shutdown');
    }
    for (const ch of channels) {
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
    registeredGroups: () => registeredGroups,
  };

  // Create WhatsApp channel (with WhatsApp-specific auto-registration callback)
  whatsapp = new WhatsAppChannel({
    ...channelOpts,
    onUnregisteredTrigger: (chatJid: string) => {
      const MAX_AUTO_GROUPS = 20;
      if (Object.keys(registeredGroups).length >= MAX_AUTO_GROUPS) {
        logger.warn({ chatJid, max: MAX_AUTO_GROUPS }, 'Auto-registration blocked: group limit reached');
        return false;
      }
      const chat = getAllChats().find((c) => c.jid === chatJid);
      const name = chat?.name || chatJid;
      const jidSlug = chatJid.split('@')[0].replace(/[^a-z0-9]+/gi, '-');
      registerGroup(chatJid, {
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
    await whatsapp.connect();
    channels.push(whatsapp);
  } catch (err) {
    logger.warn({ err }, 'WhatsApp not available (auth required?), continuing without it');
    await whatsapp.disconnect().catch(() => {});
  }

  // Create registry-based channels (Telegram, etc.) — auto-enabled when credentials present
  for (const name of getRegisteredChannelNames()) {
    const factory = getChannelFactory(name);
    if (!factory) continue;
    try {
      const ch = factory(channelOpts);
      if (ch) {
        await ch.connect();
        channels.push(ch);
        logger.info({ channel: name }, 'Channel connected');
      }
    } catch (err) {
      logger.error({ channel: name, err }, 'Failed to connect channel, continuing without it');
    }
  }

  // Start subsystems (independently of connection handler)
  startSchedulerLoop({
    registeredGroups: () => registeredGroups,
    getSessions: () => sessions,
    queue,
    onProcess: (groupJid, proc, containerName, groupFolder) => queue.registerProcess(groupJid, proc, containerName, groupFolder),
    sendMessage: async (jid, rawText) => {
      const text = formatOutbound(rawText);
      if (text) { await sendToChannel(jid, text); }
    },
  });
  startMeetingReminderLoop({
    sendMessage: async (jid, text) => { await sendToChannel(jid, text); },
    registeredGroups: () => registeredGroups,
  });
  startIpcWatcher({
    sendMessage: async (jid, text) => { await sendToChannel(jid, text); },
    registeredGroups: () => registeredGroups,
    registerGroup,
    // WhatsApp-specific: syncGroupMetadata is not part of the Channel interface
    syncGroupMetadata: (force) => whatsapp?.syncGroupMetadata(force) ?? Promise.resolve(),
    getAvailableGroups,
    writeGroupsSnapshot,
    onDashboardInput: async (groupFolder, chatJid, text) => {
      const group = Object.values(registeredGroups).find((g) => g.folder === groupFolder);
      if (!group) {
        logger.warn({ groupFolder }, 'Dashboard input for unknown group');
        return;
      }

      logger.info({ groupFolder, text: text.slice(0, 50) }, 'Running agent for dashboard input');
      const prompt = `[Via Dashboard] ${text}`;
      const safeText = text.replace(/[_*~`]/g, '');
      const result = await runAgent(
        group,
        prompt,
        chatJid,
        async (output) => {
          if (output.result) {
            const formatted = formatOutbound(output.result);
            if (formatted) {
              const wrapped = `📱 _Dashboard_ › ${safeText}\n\n${formatted}`;
              const delivered = await sendToChannel(chatJid, wrapped);
              if (!delivered) {
                logger.error({ groupFolder, chatJid }, 'Dashboard agent response could not be delivered');
              }
            } else {
              logger.warn({ groupFolder, resultLength: output.result.length }, 'Agent output stripped by formatOutbound');
            }
          }
        },
        () => {
          sendToChannel(chatJid, WARNING_MESSAGE).catch((err) => {
            logger.warn({ chatJid, err }, 'Failed to send dashboard warning notification');
          });
        },
        (hadOutput: boolean) => {
          if (hadOutput) return;
          sendToChannel(chatJid, TIMEOUT_MESSAGE).catch((err) => {
            logger.warn({ chatJid, err }, 'Failed to send dashboard timeout notification');
          });
        },
      );
      if (result === 'error') {
        logger.error({ groupFolder }, 'Dashboard agent run failed');
      } else {
        logger.info({ groupFolder, result }, 'Dashboard agent run completed');
      }
    },
  });
  queue.setProcessMessagesFn(processGroupMessages);
  recoverPendingMessages();
  startMessageLoop();
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
