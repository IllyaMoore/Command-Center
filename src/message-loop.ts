import {
  ASSISTANT_NAME,
  MAIN_GROUP_FOLDER,
  POLL_INTERVAL,
} from './config.js';
import { AppState, saveState } from './app-state.js';
import { findChannel, groupTrigger, sendToChannel } from './group-management.js';
import { getMessagesSince, getNewMessages, setRegisteredGroup } from './db.js';
import { formatMessages } from './router.js';
import { NewMessage } from './types.js';
import { logger } from './logger.js';

export async function startMessageLoop(state: AppState): Promise<void> {
  if (state.messageLoopRunning) {
    logger.debug('Message loop already running, skipping duplicate start');
    return;
  }
  state.messageLoopRunning = true;

  logger.info(`NanoClaw running (trigger: @${ASSISTANT_NAME})`);

  while (true) {
    try {
      const jids = Object.keys(state.registeredGroups);
      const { messages, newTimestamp } = getNewMessages(jids, state.lastTimestamp, ASSISTANT_NAME);

      if (messages.length > 0) {
        logger.info({ count: messages.length }, 'New messages');

        // Advance the "seen" cursor for all messages immediately
        state.lastTimestamp = newTimestamp;
        saveState(state);

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
          const group = state.registeredGroups[chatJid];
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
            await sendToChannel(state, chatJid, statusText);
            logger.info({ chatJid, mode, requiresTrigger: newRequiresTrigger }, 'Group activation changed');
            // Advance cursor so /activation message doesn't leak into agent context
            state.lastAgentTimestamp[chatJid] = activationMsg.timestamp;
            saveState(state);
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
            state.lastAgentTimestamp[chatJid] || '',
            ASSISTANT_NAME,
          );
          const messagesToSend =
            allPending.length > 0 ? allPending : groupMessages;
          const formatted = formatMessages(messagesToSend);

          if (state.queue.sendMessage(chatJid, formatted)) {
            logger.debug(
              { chatJid, count: messagesToSend.length },
              'Piped messages to active container',
            );
            state.lastAgentTimestamp[chatJid] =
              messagesToSend[messagesToSend.length - 1].timestamp;
            saveState(state);
            // Show typing indicator while the container processes the piped message
            findChannel(state, chatJid)?.setTyping?.(chatJid, true)?.catch((err: unknown) => {
              logger.debug({ chatJid, err }, 'Failed to send typing indicator');
            });
          } else {
            // No active container — enqueue for a new one
            state.queue.enqueueMessageCheck(chatJid);
          }
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error in message loop');
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
}
