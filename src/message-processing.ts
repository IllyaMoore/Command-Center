import {
  ASSISTANT_NAME,
  DEFAULT_MODEL,
  IDLE_TIMEOUT,
  MAIN_GROUP_FOLDER,
  WARNING_MESSAGE,
  TIMEOUT_MESSAGE,
} from './config.js';
import { AppState, mapApprovalMode, saveState } from './app-state.js';
import { findChannel, getAvailableGroups, groupTrigger, sendToChannel } from './group-management.js';
import {
  ContainerOutput,
  runContainerAgent,
  writeGroupsSnapshot,
  writeTasksSnapshot,
  writeToolPoliciesSnapshot,
} from './container-runner.js';
import {
  getAllTasks,
  getMessagesSince,
  getToolPolicies,
  setSession,
} from './db.js';
import { formatMessages } from './router.js';
import { RegisteredGroup } from './types.js';
import { logger } from './logger.js';

/**
 * Process all pending messages for a group.
 * Called by the GroupQueue when it's this group's turn.
 */
export async function processGroupMessages(state: AppState, chatJid: string): Promise<boolean> {
  const group = state.registeredGroups[chatJid];
  if (!group) return true;

  const isMainGroup = group.folder === MAIN_GROUP_FOLDER;

  const sinceTimestamp = state.lastAgentTimestamp[chatJid] || '';
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
  const previousCursor = state.lastAgentTimestamp[chatJid] || '';
  state.lastAgentTimestamp[chatJid] =
    missedMessages[missedMessages.length - 1].timestamp;
  saveState(state);

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
      state.queue.closeStdin(chatJid);
    }, IDLE_TIMEOUT);
  };

  const channel = findChannel(state, chatJid);
  await channel?.setTyping?.(chatJid, true);
  let hadError = false;
  let outputSentToUser = false;

  const output = await runAgent(
    state,
    group,
    prompt,
    chatJid,
    async (result) => {
      // Mark idle after first response (process stays alive for follow-ups)
      state.queue.markIdle(chatJid, group.folder);

      // Streaming output callback — called for each agent result
      if (result.result) {
        const raw = typeof result.result === 'string' ? result.result : JSON.stringify(result.result);
        // Strip <internal>...</internal> blocks — agent uses these for internal reasoning
        const text = raw.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
        logger.info({ group: group.name }, `Agent output: ${raw.slice(0, 200)}`);
        if (text) {
          const delivered = await sendToChannel(state, chatJid, text);
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
      sendToChannel(state, chatJid, WARNING_MESSAGE).catch((err) => {
        logger.warn({ chatJid, err }, 'Failed to send warning notification');
      });
    },
    (hadOutput: boolean) => {
      // Don't send timeout message if agent already produced output (idle cleanup)
      if (hadOutput) return;
      sendToChannel(state, chatJid, TIMEOUT_MESSAGE).catch((err) => {
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
    state.lastAgentTimestamp[chatJid] = previousCursor;
    saveState(state);
    logger.warn({ group: group.name }, 'Agent error, rolled back message cursor for retry');
    return false;
  }

  return true;
}

export async function runAgent(
  state: AppState,
  group: RegisteredGroup,
  prompt: string,
  chatJid: string,
  onOutput?: (output: ContainerOutput) => Promise<void>,
  onWarning?: () => void,
  onTimeout?: (hadOutput: boolean) => void,
): Promise<'success' | 'error'> {
  const isMain = group.folder === MAIN_GROUP_FOLDER;
  const sessionId = state.sessions[group.folder];

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

  // Write tool policies snapshot for approval flow
  const policies = getToolPolicies(group.folder);
  writeToolPoliciesSnapshot(
    group.folder,
    policies.map((p) => ({ tool_pattern: p.tool_pattern, action: p.action })),
  );

  // Update available groups snapshot (main group only can see all groups)
  const availableGroups = getAvailableGroups(state);
  writeGroupsSnapshot(
    group.folder,
    isMain,
    availableGroups,
    new Set(Object.keys(state.registeredGroups)),
  );

  // Wrap onOutput to track session ID from streamed results
  const wrappedOnOutput = onOutput
    ? async (output: ContainerOutput) => {
        if (output.newSessionId) {
          state.sessions[group.folder] = output.newSessionId;
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
        model: DEFAULT_MODEL,
        approvalMode: mapApprovalMode(group.folder),
      },
      (proc, containerName) => state.queue.registerProcess(chatJid, proc, containerName, group.folder),
      wrappedOnOutput,
      onWarning,
      onTimeout,
    );

    if (output.newSessionId) {
      state.sessions[group.folder] = output.newSessionId;
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
  } finally {
    state.queue.markIdle(chatJid, group.folder);
  }
}

/**
 * Startup recovery: advance cursors to "now" so stale messages from
 * before this restart are not re-processed.
 */
export function recoverPendingMessages(state: AppState): void {
  const now = new Date().toISOString();
  for (const [chatJid, group] of Object.entries(state.registeredGroups)) {
    const sinceTimestamp = state.lastAgentTimestamp[chatJid] || '';
    const pending = getMessagesSince(chatJid, sinceTimestamp, ASSISTANT_NAME);
    if (pending.length > 0) {
      logger.info(
        { group: group.name, pendingCount: pending.length },
        'Skipping stale unprocessed messages from previous session',
      );
      state.lastAgentTimestamp[chatJid] = now;
    }
  }
  saveState(state);
}
