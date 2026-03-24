import fs from 'fs';
import { IncomingMessage, ServerResponse } from 'http';
import path from 'path';

import { GROUPS_DIR } from '../config.js';
import { logger } from '../logger.js';
import {
  deleteMessages,
  deleteRegisteredGroup,
  getAllRegisteredGroups,
  getAllTasks,
  getMessagesPaginated,
  getRecentActivity,
  getRecentMessages,
  getRecentTaskRuns,
  getTimezone,
  setRegisteredGroup,
  setTimezone,
} from '../db.js';
import { TaskRunLog } from '../types.js';
import { getActivity, streamActivity } from './api/activity.js';
import {
  getCalendarAuthStatus,
  getCalendarAuthUrl,
  getCalendarEvents,
  createCalendarEvent,
  handleCalendarOAuthCallback,
  disconnectCalendar,
} from './api/calendar.js';
import { sendChatMessage, sendGroupMessage, streamChatMessages } from './api/chat.js';
import {
  getGmailAuthStatus,
  getGmailAuthUrl,
  handleGmailOAuthCallback,
  disconnectGmail,
} from './api/gmail.js';
import {
  getSheetsAuthStatus,
  getSheetsAuthUrl,
  handleSheetsOAuthCallback,
  disconnectSheets,
} from './api/sheets.js';
import {
  getDriveAuthStatus,
  getDriveAuthUrl,
  handleDriveOAuthCallback,
  disconnectDrive,
} from './api/drive.js';
import { getDashboardQueue } from './context.js';

// OAuth provider configurations for the shared callback handler
interface OAuthProvider {
  basePath: string;
  displayName: string;
  postMessageId: string;
  credentialHint: string;
  getStatus: () => Promise<string>;
  getAuthUrl: () => string | null;
  handleCallback: (code: string) => Promise<void>;
  disconnect: () => void;
}

const oauthProviders: OAuthProvider[] = [
  {
    basePath: '/api/auth/google-calendar',
    displayName: 'Google Calendar',
    postMessageId: 'gcal-connected',
    credentialHint: 'credentials.json',
    getStatus: getCalendarAuthStatus,
    getAuthUrl: getCalendarAuthUrl,
    handleCallback: handleCalendarOAuthCallback,
    disconnect: disconnectCalendar,
  },
  {
    basePath: '/api/auth/gmail',
    displayName: 'Gmail',
    postMessageId: 'gmail-connected',
    credentialHint: 'gcp-oauth.keys.json',
    getStatus: getGmailAuthStatus,
    getAuthUrl: getGmailAuthUrl,
    handleCallback: handleGmailOAuthCallback,
    disconnect: disconnectGmail,
  },
  {
    basePath: '/api/auth/google-sheets',
    displayName: 'Google Sheets',
    postMessageId: 'gsheets-connected',
    credentialHint: 'gcp-oauth.keys.json',
    getStatus: getSheetsAuthStatus,
    getAuthUrl: getSheetsAuthUrl,
    handleCallback: handleSheetsOAuthCallback,
    disconnect: disconnectSheets,
  },
  {
    basePath: '/api/auth/google-drive',
    displayName: 'Google Drive',
    postMessageId: 'gdrive-connected',
    credentialHint: 'gcp-oauth.keys.json',
    getStatus: getDriveAuthStatus,
    getAuthUrl: getDriveAuthUrl,
    handleCallback: handleDriveOAuthCallback,
    disconnect: disconnectDrive,
  },
];

function oauthSuccessHtml(displayName: string, postMessageId: string): string {
  return `<!DOCTYPE html><html><body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0">
    <div style="text-align:center"><h2>${displayName} connected</h2><p>You can close this tab.</p>
    <script>window.opener&&window.opener.postMessage('${postMessageId}',window.location.origin);setTimeout(()=>window.close(),2000)</script>
    </div></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function oauthErrorHtml(err: unknown): string {
  const message = err instanceof Error ? err.message : 'Unknown error';
  return `<h3>OAuth Error</h3><p>${escapeHtml(message)}</p><p>Close this tab and try again.</p>`;
}

async function handleOAuthRoutes(
  pathname: string,
  method: string,
  url: URL,
  res: ServerResponse,
  json: (data: unknown, status?: number) => void,
): Promise<boolean> {
  for (const provider of oauthProviders) {
    if (pathname === `${provider.basePath}/status` && method === 'GET') {
      const status = await provider.getStatus();
      json({ status });
      return true;
    }

    if (pathname === provider.basePath && method === 'GET') {
      const authUrl = provider.getAuthUrl();
      if (!authUrl) {
        json({ error: `Missing ${provider.credentialHint} — configure GCP OAuth first` }, 400);
        return true;
      }
      res.writeHead(302, { Location: authUrl });
      res.end();
      return true;
    }

    if (pathname === `${provider.basePath}/disconnect` && method === 'POST') {
      try {
        provider.disconnect();
        json({ ok: true });
      } catch (err) {
        logger.error({ err, provider: provider.displayName }, 'Disconnect failed');
        json({ error: 'disconnect_failed' }, 500);
      }
      return true;
    }

    if (pathname === `${provider.basePath}/callback` && method === 'GET') {
      const code = url.searchParams.get('code');
      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<h3>Error: missing authorization code</h3><p>Close this tab and try again.</p>');
        return true;
      }
      try {
        await provider.handleCallback(code);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(oauthSuccessHtml(provider.displayName, provider.postMessageId));
      } catch (err) {
        logger.error({ err, provider: provider.displayName }, 'OAuth callback failed');
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(oauthErrorHtml(err));
      }
      return true;
    }
  }

  return false;
}

export async function handleApiRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  const pathname = url.pathname;
  const method = req.method || 'GET';

  // Parse request body for POST requests
  const parseBody = (): Promise<Record<string, unknown>> => {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (err) {
          logger.warn({ err }, 'Failed to parse request body as JSON');
          reject(new Error('Invalid JSON'));
        }
      });
      req.on('error', reject);
    });
  };

  // Helper to send JSON response
  const json = (data: unknown, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  // ─── CEO-9: GET /api/agents ───
  if (pathname === '/api/agents' && method === 'GET') {
    const queue = getDashboardQueue();
    const groups = getAllRegisteredGroups();
    const queueStatus = queue?.getStatus() ?? [];
    const source = url.searchParams.get('source');

    // Build agent list from both DB registrations and groups/ directories
    const seenFolders = new Set<string>();
    const agents: Array<Record<string, unknown>> = [];

    // 1. Add registered groups that have CLAUDE.md
    for (const [jid, group] of Object.entries(groups)) {
      const claudeMd = path.join(GROUPS_DIR, group.folder, 'CLAUDE.md');
      if (!fs.existsSync(claudeMd)) continue;
      if (source === 'dashboard' && !jid.startsWith('dashboard-')) continue;
      if (source === 'channel' && jid.startsWith('dashboard-')) continue;

      seenFolders.add(group.folder);
      const qs = queueStatus.find((s) => s.jid === jid || s.jid === `dashboard-${group.folder}` || s.groupFolder === group.folder);
      const lastMessages = getRecentMessages(1, jid);
      const lastActivity = lastMessages.length > 0 ? lastMessages[0].timestamp : null;

      agents.push({
        jid,
        name: group.name,
        folder: group.folder,
        online: qs?.active ?? false,
        lastActivity,
        currentTask: qs?.currentTaskId ?? null,
        containerName: qs?.containerName ?? null,
        pendingMessages: qs?.pendingMessages ?? false,
        pendingTaskCount: qs?.pendingTaskCount ?? 0,
      });
    }

    // 2. Add unregistered groups/ directories that have CLAUDE.md
    if (source !== 'channel') {
      try {
        const groupDirs = fs.readdirSync(GROUPS_DIR, { withFileTypes: true });
        for (const dir of groupDirs) {
          if (!dir.isDirectory() || seenFolders.has(dir.name)) continue;
          const claudeMd = path.join(GROUPS_DIR, dir.name, 'CLAUDE.md');
          if (!fs.existsSync(claudeMd)) continue;

          const displayName = dir.name.charAt(0).toUpperCase() + dir.name.slice(1);
          agents.push({
            jid: `local-${dir.name}`,
            name: displayName,
            folder: dir.name,
            online: false,
            lastActivity: null,
            currentTask: null,
            containerName: null,
            pendingMessages: false,
            pendingTaskCount: 0,
          });
        }
      } catch {
        // groups/ dir may not exist
      }
    }

    json(agents);
    return;
  }

  // ─── OPC-126: POST /api/agents ───
  if (pathname === '/api/agents' && method === 'POST') {
    const body = await parseBody();
    const { name, folder } = body as { name?: string; folder?: string };

    if (!name || !folder) {
      json({ error: 'name and folder are required' }, 400);
      return;
    }

    // Validate folder name (alphanumeric, hyphens, underscores)
    if (!/^[a-z0-9_-]+$/.test(folder)) {
      json({ error: 'folder must be lowercase alphanumeric with hyphens/underscores only' }, 400);
      return;
    }

    // Check folder uniqueness
    const existing = getAllRegisteredGroups();
    const folderTaken = Object.values(existing).some((g) => g.folder === folder);
    if (folderTaken) {
      json({ error: `folder '${folder}' already exists` }, 409);
      return;
    }

    // Generate a dashboard JID for non-messaging agents
    const jid = `dashboard-${folder}-${Date.now()}`;

    // Create group directory with default CLAUDE.md
    const groupDir = path.join(GROUPS_DIR, folder);
    if (!fs.existsSync(groupDir)) {
      fs.mkdirSync(groupDir, { recursive: true });
    }
    const claudeMdPath = path.join(groupDir, 'CLAUDE.md');
    if (!fs.existsSync(claudeMdPath)) {
      fs.writeFileSync(
        claudeMdPath,
        `# ${name}\n\nYou are the ${name} agent. Respond helpfully and concisely.\n`,
        'utf-8',
      );
    }

    // Register in database
    setRegisteredGroup(jid, {
      name,
      folder,
      trigger: `(?i)@${folder}`,
      added_at: new Date().toISOString(),
      requiresTrigger: false,
    });

    logger.info({ jid, name, folder }, 'Agent created via dashboard');
    json({ jid, name, folder }, 201);
    return;
  }

  // ─── OPC-126: DELETE /api/agents/:folder ───
  if (pathname.startsWith('/api/agents/') && method === 'DELETE') {
    const folder = pathname.split('/api/agents/')[1];
    if (!folder) {
      json({ error: 'folder is required' }, 400);
      return;
    }

    const groups = getAllRegisteredGroups();
    const entry = Object.entries(groups).find(([, g]) => g.folder === folder);
    if (!entry) {
      json({ error: `Agent '${folder}' not found` }, 404);
      return;
    }

    const [jid] = entry;
    deleteRegisteredGroup(jid);

    // Archive group directory (rename with .archived suffix)
    const groupDir = path.join(GROUPS_DIR, folder);
    const archiveDir = path.join(GROUPS_DIR, `${folder}.archived-${Date.now()}`);
    if (fs.existsSync(groupDir)) {
      fs.renameSync(groupDir, archiveDir);
    }

    logger.info({ jid, folder }, 'Agent deleted via dashboard');
    json({ deleted: true, folder });
    return;
  }

  // ─── CEO-9: GET /api/tasks ───
  if (pathname === '/api/tasks' && method === 'GET') {
    const tasks = getAllTasks();
    const runsLimit = parseInt(url.searchParams.get('runs') || '5', 10);
    const allRuns = getRecentTaskRuns(tasks.length * runsLimit);

    // Group runs by task_id
    const runsByTask = new Map<string, TaskRunLog[]>();
    for (const run of allRuns) {
      const existing = runsByTask.get(run.task_id) || [];
      existing.push(run);
      runsByTask.set(run.task_id, existing);
    }

    const tasksWithRuns = tasks.map((task) => ({
      ...task,
      recent_runs: (runsByTask.get(task.id) || []).slice(0, runsLimit),
    }));

    json(tasksWithRuns);
    return;
  }

  // ─── CEO-9: GET /api/messages ───
  if (pathname === '/api/messages' && method === 'GET') {
    const group = url.searchParams.get('group');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    let chatJid: string | undefined;
    if (group) {
      // Use dashboard-specific JID for fetching dashboard chat history
      chatJid = `dashboard-${group}`;
    }

    const result = getMessagesPaginated(limit, offset, chatJid);
    json({
      messages: result.messages,
      total: result.total,
      limit,
      offset,
    });
    return;
  }

  // ─── DELETE /api/messages — clear chat history ───
  if (pathname === '/api/messages' && method === 'DELETE') {
    const group = url.searchParams.get('group');
    if (!group) {
      json({ error: 'Missing group parameter' }, 400);
      return;
    }
    const chatJid = `dashboard-${group}`;
    const deleted = deleteMessages(chatJid);
    json({ ok: true, deleted });
    return;
  }

  // ─── CEO-9: POST /api/messages ───
  if (pathname === '/api/messages' && method === 'POST') {
    const body = await parseBody();
    const text = body.text as string | undefined;
    const group = (body.group as string | undefined) || 'ceo';

    if (!text) {
      json({ error: 'Missing text field' }, 400);
      return;
    }

    const groups = getAllRegisteredGroups();
    const entry = Object.entries(groups).find(([, g]) => g.folder === group);
    if (!entry) {
      json({ error: `Group '${group}' not registered` }, 404);
      return;
    }

    // Always use dashboard-specific JID so chat history stays separate from WA/TG
    const dashboardJid = `dashboard-${group}`;
    const result = await sendGroupMessage(group, dashboardJid, text);
    json({ ...result, group, jid: dashboardJid });
    return;
  }

  // ─── CEO-9: SSE /api/events ───
  if (pathname === '/api/events' && method === 'GET') {
    streamEvents(req, res);
    return;
  }

  // Activity endpoints (legacy, kept for backward compat)
  if (pathname === '/api/activity' && method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const activity = await getActivity(limit);
    json(activity);
    return;
  }

  if (pathname === '/api/activity/stream' && method === 'GET') {
    await streamActivity(req, res);
    return;
  }

  // ─── Google OAuth (Calendar, Gmail, Sheets, Drive) ───
  if (pathname.startsWith('/api/auth/')) {
    const handled = await handleOAuthRoutes(pathname, method, url, res, json);
    if (handled) return;
  }

  // Calendar endpoints
  if ((pathname === '/api/calendar' || pathname === '/api/calendar/events') && method === 'GET') {
    const view = (url.searchParams.get('view') || 'day') as 'day' | 'week';
    const result = await getCalendarEvents(view);
    json(result);
    return;
  }

  if ((pathname === '/api/calendar' || pathname === '/api/calendar/events') && method === 'POST') {
    const body = await parseBody();
    if (!body.title || !body.start || !body.end) {
      json({ error: 'Missing required fields: title, start, end' }, 400);
      return;
    }
    const result = await createCalendarEvent({
      title: body.title as string,
      start: body.start as string,
      end: body.end as string,
      description: body.description as string | undefined,
      location: body.location as string | undefined,
    });
    json(result, result.error ? 500 : 201);
    return;
  }

  // Chat endpoints (legacy, kept for backward compat)
  if (pathname === '/api/chat' && method === 'POST') {
    const body = await parseBody();
    const text = body.text as string | undefined;
    if (!text) {
      json({ error: 'Missing text field' }, 400);
      return;
    }
    const result = await sendChatMessage(text);
    json(result);
    return;
  }

  if (pathname === '/api/chat/stream' && method === 'GET') {
    await streamChatMessages(req, res);
    return;
  }

  // Settings: Timezone
  if (pathname === '/api/settings/timezone' && method === 'GET') {
    json({ timezone: getTimezone() });
    return;
  }

  if (pathname === '/api/settings/timezone' && method === 'POST') {
    const body = await parseBody();
    const tz = body.timezone as string | undefined;
    if (!tz) {
      json({ error: 'Missing timezone field' }, 400);
      return;
    }
    // Validate timezone
    try {
      const valid = Intl.supportedValuesOf('timeZone');
      if (!valid.includes(tz)) {
        json({ error: 'Invalid timezone' }, 400);
        return;
      }
    } catch {
      // Fallback for older runtimes: attempt to create a DateTimeFormat
      try {
        Intl.DateTimeFormat(undefined, { timeZone: tz });
      } catch {
        json({ error: 'Invalid timezone' }, 400);
        return;
      }
    }
    setTimezone(tz);
    json({ success: true, timezone: tz });
    return;
  }

  // Health check
  if (pathname === '/api/health' && method === 'GET') {
    json({ status: 'ok', timestamp: new Date().toISOString() });
    return;
  }

  // Debug: raw queue status
  if (pathname === '/api/debug/queue' && method === 'GET') {
    const queue = getDashboardQueue();
    json(queue?.getStatus() ?? []);
    return;
  }

  // 404 for unknown API routes
  json({ error: 'Not found' }, 404);
}

// ─── SSE /api/events — unified real-time stream ───

function streamEvents(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const queue = getDashboardQueue();
  const groups = getAllRegisteredGroups();

  // Helper: find queue status by registered JID or dashboard JID
  const findStatus = (jid: string, folder: string) => {
    const statuses = queue?.getStatus() ?? [];
    return statuses.find((s) => s.jid === jid || s.jid === `dashboard-${folder}` || s.groupFolder === folder);
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
      // New activity (task runs + messages combined)
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
        if (seenActivityKeys.size > 500) seenActivityKeys = new Set(
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
      try { res.end(); } catch { /* already closed */ }
    }
  }, 2000);

  req.on('close', () => {
    clearInterval(interval);
  });
}
