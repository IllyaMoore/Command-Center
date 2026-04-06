import {
  deleteMessages,
  getAllRegisteredGroups,
  getMessagesPaginated,
  storeChatMetadata,
  storeMessageDirect,
} from '../../db.js';
import { IpcAttachment } from '../../types.js';
import { sendGroupMessage } from './chat.js';
import { resolveAttachments } from './upload.js';

// ─── GET /api/messages ───

export function getMessages(
  group: string | null,
  limit: number,
  offset: number,
): { messages: unknown[]; total: number; limit: number; offset: number } {
  const clampedLimit = Math.min(limit, 200);
  let chatJid: string | undefined;
  if (group) {
    chatJid = `dashboard-${group}`;
  }

  const result = getMessagesPaginated(clampedLimit, offset, chatJid);
  return {
    messages: result.messages,
    total: result.total,
    limit: clampedLimit,
    offset,
  };
}

// ─── DELETE /api/messages ───

export function clearMessages(group: string | null): {
  data?: unknown;
  error?: string;
  status: number;
} {
  if (!group) {
    return { error: 'Missing group parameter', status: 400 };
  }
  const chatJid = `dashboard-${group}`;
  const deleted = deleteMessages(chatJid);
  return { data: { ok: true, deleted }, status: 200 };
}

// ─── POST /api/messages ───

export async function postMessage(body: Record<string, unknown>): Promise<{
  data?: unknown;
  error?: string;
  status: number;
}> {
  const text = body.text as string | undefined;
  const group = (body.group as string | undefined) || 'ceo';
  const replyTo = body.replyTo as string | undefined;
  const rawAttachments = Array.isArray(body.attachments)
    ? (body.attachments as Array<{ id: string; name: string; size: number; mime: string }>)
    : undefined;
  const attachments = rawAttachments ? resolveAttachments(rawAttachments) : undefined;

  if (!text && (!attachments || attachments.length === 0)) {
    return { error: 'Missing text or attachments', status: 400 };
  }

  const groups = getAllRegisteredGroups();
  const entry = Object.entries(groups).find(([, g]) => g.folder === group);
  if (!entry) {
    return { error: `Group '${group}' not registered`, status: 404 };
  }

  if (replyTo) {
    const replyEntry = Object.values(groups).find((g) => g.folder === replyTo);
    if (!replyEntry) {
      return { error: `Unknown replyTo group '${replyTo}'`, status: 400 };
    }
  }

  const isForward = !!replyTo && replyTo !== group;
  const chatJid = isForward ? `xagent-${group}-${Date.now()}` : `dashboard-${group}`;
  const displayJid = isForward ? `dashboard-${replyTo}` : chatJid;

  if (isForward) {
    storeChatMetadata(displayJid, new Date().toISOString(), `Dashboard: ${replyTo}`);
    storeMessageDirect({
      id: `dashboard-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      chat_jid: displayJid,
      sender: 'dashboard',
      sender_name: 'You (Dashboard)',
      content:
        (text || '') +
        (attachments && attachments.length > 0
          ? `\n\n${attachments.map((a: IpcAttachment) => `[${a.name}]`).join(' ')}`
          : ''),
      timestamp: new Date().toISOString(),
      is_from_me: true,
    });
  }

  const fileSuffix =
    attachments && attachments.length > 0
      ? `\n\n${attachments.map((a: IpcAttachment) => `[${a.name}]`).join(' ')}`
      : '';
  const displayText = (text || '') + fileSuffix;
  const result = await sendGroupMessage(
    group,
    chatJid,
    displayText,
    isForward ? displayJid : undefined,
    attachments,
  );
  return { data: { ...result, group, jid: displayJid }, status: 200 };
}
