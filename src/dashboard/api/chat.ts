import fs from 'fs';
import path from 'path';
import { IncomingMessage, ServerResponse } from 'http';

import { DATA_DIR } from '../../config.js';
import { getAllRegisteredGroups, getRecentMessages, storeChatMetadata, storeMessageDirect } from '../../db.js';
import { logger } from '../../logger.js';
import { IpcAttachment } from '../../types.js';

const CEO_GROUP_FOLDER = 'ceo';

interface ChatMessage {
  id: string;
  text: string;
  sender: 'user' | 'agent';
  timestamp: string;
  agentName?: string;
  source: 'whatsapp' | 'telegram' | 'dashboard';
}

function getCeoJid(): string | null {
  const groups = getAllRegisteredGroups();
  const entry = Object.entries(groups).find(([, g]) => g.folder === CEO_GROUP_FOLDER);

  if (entry) {
    logger.debug({ jid: entry[0] }, 'Found CEO group');
    return entry[0];
  }

  logger.warn({ groupFolders: Object.values(groups).map(g => g.folder) }, 'No group with folder matches');
  return null;
}

export async function sendGroupMessage(
  groupFolder: string,
  chatJid: string,
  text: string,
  replyToJid?: string,
  attachments?: IpcAttachment[],
): Promise<{ success: boolean; error?: string }> {
  try {
    const msgId = `dashboard-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Write IPC file first so the agent receives the message.
    // DB store comes after to avoid showing a message the agent never gets.
    const inputDir = path.join(DATA_DIR, 'ipc', groupFolder, 'input');
    fs.mkdirSync(inputDir, { recursive: true });

    const filename = `${Date.now()}-dashboard.json`;
    const filePath = path.join(inputDir, filename);

    const message: Record<string, unknown> = {
      type: 'message',
      chatJid,
      text,
      source: 'dashboard',
      replyToJid,
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
    };

    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(message, null, 2));
    fs.renameSync(tempPath, filePath);
    logger.info({ groupFolder, text: text.slice(0, 50) }, 'Dashboard message written to IPC');

    // Cross-agent messages (xagent-*) are stored by the route handler, not here
    if (!chatJid.startsWith('xagent-')) {
      if (chatJid.startsWith('dashboard-')) {
        storeChatMetadata(chatJid, new Date().toISOString(), `Dashboard: ${groupFolder}`);
      }

      storeMessageDirect({
        id: msgId,
        chat_jid: chatJid,
        sender: 'dashboard',
        sender_name: 'You (Dashboard)',
        content: text,
        timestamp: new Date().toISOString(),
        is_from_me: true,
      });
    }

    return { success: true };
  } catch (err) {
    logger.error({ err }, 'Error writing message to IPC');
    return { success: false, error: 'Failed to send message' };
  }
}

export async function sendChatMessage(text: string): Promise<{ success: boolean; error?: string }> {
  const ceoJid = getCeoJid();

  if (!ceoJid) {
    logger.warn('CEO group not registered, cannot send chat message');
    return { success: false, error: 'CEO group not registered' };
  }

  return sendGroupMessage(CEO_GROUP_FOLDER, ceoJid, text);
}

export function streamChatMessages(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const ceoJid = getCeoJid();

  const initialMessages = getChatHistory(ceoJid, 50);
  res.write(`data: ${JSON.stringify({ type: 'initial', messages: initialMessages })}\n\n`);

  // Track sent message IDs to avoid duplicates (timestamp precision varies
  // between dashboard ms and WhatsApp seconds, so ID-based tracking is safer).
  // Cap size to prevent unbounded growth on long-lived connections.
  const MAX_SENT_IDS = 200;
  const sentIds = new Set(initialMessages.map((msg) => msg.id));

  const interval = setInterval(() => {
    try {
      const recentMessages = getChatHistory(ceoJid, 20);
      const newMessages = recentMessages.filter((msg) => !sentIds.has(msg.id));

      if (newMessages.length > 0) {
        newMessages.forEach((msg) => sentIds.add(msg.id));
        // Prune oldest entries when cap exceeded
        if (sentIds.size > MAX_SENT_IDS) {
          const iter = sentIds.values();
          while (sentIds.size > MAX_SENT_IDS) {
            sentIds.delete(iter.next().value as string);
          }
        }
        res.write(`data: ${JSON.stringify({ type: 'update', messages: newMessages })}\n\n`);
      } else {
        res.write(': heartbeat\n\n');
      }
    } catch (err) {
      logger.error({ err }, 'Error in chat stream');
    }
  }, 1000);

  req.on('close', () => {
    clearInterval(interval);
    logger.debug('Chat stream closed');
  });
}

function getChatHistory(ceoJid: string | null, limit: number): ChatMessage[] {
  if (!ceoJid) return [];

  try {
    const messages = getRecentMessages(limit, ceoJid);

    // Convert to chat format and reverse (oldest first for chat display)
    return messages
      .map((msg): ChatMessage => {
        let source: ChatMessage['source'];
        if (msg.sender === 'dashboard') {
          source = 'dashboard';
        } else if (ceoJid.startsWith('tg:')) {
          source = 'telegram';
        } else {
          source = 'whatsapp';
        }

        return {
          id: msg.id,
          text: msg.content,
          sender: msg.is_bot_message ? 'agent' : 'user',
          timestamp: msg.timestamp,
          agentName: msg.is_bot_message ? 'CEO Agent' : undefined,
          source,
        };
      })
      .reverse();
  } catch (err) {
    logger.error({ err }, 'Error fetching chat history');
    return [];
  }
}
