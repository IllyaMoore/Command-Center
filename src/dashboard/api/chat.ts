import fs from 'fs';
import path from 'path';
import { IncomingMessage, ServerResponse } from 'http';

import { DATA_DIR } from '../../config.js';
import { getAllRegisteredGroups, getRecentMessages, storeMessageDirect } from '../../db.js';
import { logger } from '../../logger.js';

const CEO_GROUP_FOLDER = 'ceo';

interface ChatMessage {
  id: string;
  text: string;
  sender: 'user' | 'agent';
  timestamp: string;
  agentName?: string;
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
): Promise<{ success: boolean; error?: string }> {
  try {
    const msgId = `dashboard-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Store immediately so SSE delivers the user's message within 1 second.
    // onDashboardInput will INSERT OR REPLACE with the same pattern, so no duplicates.
    storeMessageDirect({
      id: msgId,
      chat_jid: chatJid,
      sender: 'dashboard',
      sender_name: 'You (Dashboard)',
      content: text,
      timestamp: new Date().toISOString(),
      is_from_me: true,
    });

    const inputDir = path.join(DATA_DIR, 'ipc', groupFolder, 'input');
    fs.mkdirSync(inputDir, { recursive: true });

    const filename = `${Date.now()}-dashboard.json`;
    const filePath = path.join(inputDir, filename);

    const message = {
      type: 'message',
      chatJid,
      text,
      source: 'dashboard',
    };

    fs.writeFileSync(filePath, JSON.stringify(message, null, 2));
    logger.info({ groupFolder, text: text.slice(0, 50) }, 'Dashboard message written to IPC');

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
  // between dashboard ms and WhatsApp seconds, so ID-based tracking is safer)
  const sentIds = new Set(initialMessages.map((msg) => msg.id));

  const interval = setInterval(() => {
    try {
      const recentMessages = getChatHistory(ceoJid, 20);
      const newMessages = recentMessages.filter((msg) => !sentIds.has(msg.id));

      if (newMessages.length > 0) {
        newMessages.forEach((msg) => sentIds.add(msg.id));
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
      .map((msg): ChatMessage => ({
        id: msg.id,
        text: msg.content,
        sender: msg.is_bot_message ? 'agent' : 'user',
        timestamp: msg.timestamp,
        agentName: msg.is_bot_message ? 'CEO Agent' : undefined,
      }))
      .reverse();
  } catch (err) {
    logger.error({ err }, 'Error fetching chat history');
    return [];
  }
}
