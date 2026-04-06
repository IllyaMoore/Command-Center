import { IncomingMessage, ServerResponse } from 'http';

import { approvalManager } from '../../approval-manager.js';
import { logger } from '../../logger.js';
import { getAllRegisteredGroups, getRecentActivity, getRecentMessages } from '../../db.js';
import { getDashboardQueue } from '../context.js';

// ─── SSE /api/events — unified real-time stream ───

export function streamEvents(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const queue = getDashboardQueue();
  const groups = getAllRegisteredGroups();

  const findStatus = (jid: string, folder: string) => {
    const statuses = queue?.getStatus() ?? [];
    return statuses.find(
      (s) => s.jid === jid || s.jid === `dashboard-${folder}` || s.groupFolder === folder,
    );
  };

  // Send initial snapshot
  const agentSnapshot = Object.entries(groups).map(([jid, group]) => {
    const qs = findStatus(jid, group.folder);
    return {
      jid,
      name: group.name,
      folder: group.folder,
      online: qs?.active ?? false,
    };
  });
  res.write(`data: ${JSON.stringify({ type: 'init', agents: agentSnapshot })}\n\n`);

  let lastActivityTs = new Date().toISOString();
  let lastMessageTs = new Date().toISOString();
  let seenMessageIds = new Set<string>();
  let seenActivityKeys = new Set<string>();

  const interval = setInterval(() => {
    try {
      // New activity
      const activity = getRecentActivity(10);
      const newActivity = activity.filter((a) => {
        if (a.timestamp < lastActivityTs) return false;
        const key = `${a.timestamp}:${a.task_id ?? ''}:${a.content ?? ''}`;
        return !seenActivityKeys.has(key);
      });
      if (newActivity.length > 0) {
        lastActivityTs = newActivity[0].timestamp;
        for (const a of newActivity) {
          seenActivityKeys.add(`${a.timestamp}:${a.task_id ?? ''}:${a.content ?? ''}`);
        }
        if (seenActivityKeys.size > 500)
          seenActivityKeys = new Set(
            newActivity.map((a) => `${a.timestamp}:${a.task_id ?? ''}:${a.content ?? ''}`),
          );
        res.write(`data: ${JSON.stringify({ type: 'activity', items: newActivity })}\n\n`);
      }

      // New messages
      const messages = getRecentMessages(10);
      const newMessages = messages.filter(
        (m) => m.timestamp >= lastMessageTs && !seenMessageIds.has(m.id),
      );
      if (newMessages.length > 0) {
        lastMessageTs = newMessages[0].timestamp;
        for (const m of newMessages.filter((x) => x.timestamp === lastMessageTs)) {
          seenMessageIds.add(m.id);
        }
        if (seenMessageIds.size > 500) seenMessageIds = new Set();
        res.write(`data: ${JSON.stringify({ type: 'messages', items: newMessages })}\n\n`);
      }

      // Approval requests
      approvalManager.scanIpcDirs();
      approvalManager.cleanExpired();
      const pendingApprovals = approvalManager.getPending();
      if (pendingApprovals.length > 0) {
        res.write(
          `data: ${JSON.stringify({ type: 'approval_requests', items: pendingApprovals })}\n\n`,
        );
      }

      // Agent status
      const currentGroups = getAllRegisteredGroups();
      const agents = Object.entries(currentGroups).map(([jid, group]) => {
        const qs = findStatus(jid, group.folder);
        return {
          jid,
          name: group.name,
          folder: group.folder,
          online: qs?.active ?? false,
        };
      });
      res.write(`data: ${JSON.stringify({ type: 'agents', agents })}\n\n`);
    } catch (err) {
      logger.error({ err }, 'Error in activity stream, closing stream');
      clearInterval(interval);
      try {
        res.end();
      } catch {
        /* already closed */
      }
    }
  }, 2000);

  req.on('close', () => {
    clearInterval(interval);
  });
}
