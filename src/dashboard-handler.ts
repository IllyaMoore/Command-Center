import { WARNING_MESSAGE, TIMEOUT_MESSAGE } from './config.js';
import { AppState } from './app-state.js';
import { sendToChannel } from './group-management.js';
import { runAgent } from './message-processing.js';
import { buildAttachmentContext } from './attachments.js';
import { storeMessageDirect } from './db.js';
import { formatOutbound } from './router.js';
import { IpcAttachment } from './types.js';
import { logger } from './logger.js';

/**
 * Creates the onDashboardInput callback for the IPC watcher.
 */
export function createDashboardInputHandler(state: AppState) {
  return async (
    groupFolder: string,
    chatJid: string,
    text: string,
    replyToJid?: string,
    attachments?: IpcAttachment[],
  ): Promise<void> => {
    const group = Object.values(state.registeredGroups).find((g) => g.folder === groupFolder);
    if (!group) {
      logger.warn({ groupFolder }, 'Dashboard input for unknown group');
      return;
    }

    // Build prompt with attachment context
    const promptParts = [`[Via Dashboard] ${text}`];
    if (attachments && attachments.length > 0) {
      promptParts.push('');
      for (const att of attachments) {
        promptParts.push(buildAttachmentContext(att));
      }
    }
    const fullPrompt = promptParts.join('\n');

    // If an agent is already running for this group, pipe as follow-up message
    if (state.queue.sendMessage(chatJid, fullPrompt)) {
      logger.info({ groupFolder, text: text.slice(0, 50) }, 'Piped dashboard message to active agent');
      return;
    }

    logger.info({ groupFolder, text: text.slice(0, 50) }, 'Running agent for dashboard input');
    const isDashboardOnly = chatJid.startsWith('dashboard-') || chatJid.startsWith('xagent-') || !!replyToJid;
    const safeText = text.replace(/[_*~`]/g, '');
    const result = await runAgent(
      state,
      group,
      fullPrompt,
      chatJid,
      async (output) => {
        // Mark idle after first response (process stays alive for follow-ups)
        state.queue.markIdle(chatJid, groupFolder);

        if (output.result) {
          const content = typeof output.result === 'string' ? output.result : JSON.stringify(output.result);
          if (isDashboardOnly) {
            // Dashboard-only agents: store response in DB, no channel delivery
            const responseChatJid = replyToJid || chatJid;
            storeMessageDirect({
              id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              chat_jid: responseChatJid,
              sender: groupFolder,
              sender_name: group.name,
              content,
              timestamp: new Date().toISOString(),
              is_from_me: false,
              is_bot_message: true,
            });
          } else {
            // WA/TG groups: deliver via channel as before
            const formatted = formatOutbound(output.result);
            if (formatted) {
              const wrapped = `📱 _Dashboard_ › ${safeText}\n\n${formatted}`;
              const delivered = await sendToChannel(state, chatJid, wrapped);
              if (!delivered) {
                logger.error({ groupFolder, chatJid }, 'Dashboard agent response could not be delivered');
              }
            } else {
              logger.warn({ groupFolder, resultLength: output.result.length }, 'Agent output stripped by formatOutbound');
            }
          }
        }
      },
      () => {
        if (isDashboardOnly) {
          storeMessageDirect({
            id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            chat_jid: replyToJid || chatJid,
            sender: 'system',
            sender_name: 'System',
            content: WARNING_MESSAGE,
            timestamp: new Date().toISOString(),
            is_from_me: false,
            is_bot_message: true,
          });
        } else {
          sendToChannel(state, chatJid, WARNING_MESSAGE).catch((err) => {
            logger.warn({ chatJid, err }, 'Failed to send dashboard warning notification');
          });
        }
      },
      (hadOutput: boolean) => {
        if (hadOutput) return;
        if (isDashboardOnly) {
          storeMessageDirect({
            id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            chat_jid: chatJid,
            sender: 'system',
            sender_name: 'System',
            content: TIMEOUT_MESSAGE,
            timestamp: new Date().toISOString(),
            is_from_me: false,
            is_bot_message: true,
          });
        } else {
          sendToChannel(state, chatJid, TIMEOUT_MESSAGE).catch((err) => {
            logger.warn({ chatJid, err }, 'Failed to send dashboard timeout notification');
          });
        }
      },
    );
    // Mark agent as no longer active
    state.queue.markIdle(chatJid, groupFolder);

    if (result === 'error') {
      logger.error({ groupFolder }, 'Dashboard agent run failed');
    } else {
      logger.info({ groupFolder, result }, 'Dashboard agent run completed');
    }
  };
}
