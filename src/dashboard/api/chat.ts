import fs from 'fs';
import path from 'path';
import { IncomingMessage, ServerResponse } from 'http';

import { DATA_DIR } from '../../config.js';
import { getAllRegisteredGroups, getRecentMessages } from '../../db.js';
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
  for (const [jid, group] of Object.entries(groups)) {
    if (group.folder === CEO_GROUP_FOLDER) {
      logger.debug({ jid }, 'Found CEO group');
      return jid;
    }
  }
  logger.warn({ groupFolders: Object.values(groups).map(g => g.folder) }, 'No group with folder matches');
  return null;
}

export async function sendChatMessage(text: string): Promise<{ success: boolean; error?: string }> {
  const ceoJid = getCeoJid();

  if (!ceoJid) {
    logger.warn('CEO group not registered, cannot send chat message');
    return { success: false, error: 'CEO group not registered' };
  }

  try {
    // Write to the CEO group's IPC input directory
    const inputDir = path.join(DATA_DIR, 'ipc', CEO_GROUP_FOLDER, 'input');
    fs.mkdirSync(inputDir, { recursive: true });

    const filename = `${Date.now()}-dashboard.json`;
    const filePath = path.join(inputDir, filename);

    const message = {
      type: 'message',
      chatJid: ceoJid,
      text: text,
      source: 'dashboard', // Mark as coming from dashboard
    };

    fs.writeFileSync(filePath, JSON.stringify(message, null, 2));
    logger.info({ text: text.slice(0, 50) }, 'Dashboard chat message written to IPC');

    return { success: true };
  } catch (err) {
    logger.error({ err }, 'Error writing chat message to IPC');
    return { success: false, error: 'Failed to send message' };
  }
}

export async function streamChatMessages(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const ceoJid = getCeoJid();

  // Send initial messages
  const initialMessages = await getChatHistory(ceoJid, 50);
  res.write(`data: ${JSON.stringify({ type: 'initial', messages: initialMessages })}\n\n`);

  let lastTimestamp = initialMessages.length > 0
    ? initialMessages[initialMessages.length - 1].timestamp
    : new Date(0).toISOString();

  // Poll for new messages
  const interval = setInterval(async () => {
    try {
      if (!ceoJid) {
        res.write(': heartbeat\n\n');
        return;
      }

      const recentMessages = await getChatHistory(ceoJid, 10);
      const newMessages = recentMessages.filter((msg) => msg.timestamp > lastTimestamp);

      if (newMessages.length > 0) {
        lastTimestamp = newMessages[newMessages.length - 1].timestamp;
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

async function getChatHistory(ceoJid: string | null, limit: number): Promise<ChatMessage[]> {
  if (!ceoJid) {
    return [];
  }

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
