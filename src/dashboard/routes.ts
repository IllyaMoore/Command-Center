import { IncomingMessage, ServerResponse } from 'http';

import {
  getAllRegisteredGroups,
  getAllTasks,
  getMessagesPaginated,
  getRecentActivity,
  getRecentMessages,
  getRecentTaskRuns,
  getTimezone,
  setTimezone,
} from '../db.js';
import { TaskRunLog } from '../types.js';
import { getActivity, streamActivity } from './api/activity.js';
import {
  getCalendarAuthStatus,
  getCalendarAuthUrl,
  getCalendarEvents,
  handleCalendarOAuthCallback,
} from './api/calendar.js';
import { sendChatMessage, sendGroupMessage, streamChatMessages } from './api/chat.js';
import {
  getGmailAuthStatus,
  getGmailAuthUrl,
  handleGmailOAuthCallback,
} from './api/gmail.js';
import {
  getSheetsAuthStatus,
  getSheetsAuthUrl,
  handleSheetsOAuthCallback,
} from './api/sheets.js';
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
  },
  {
    basePath: '/api/auth/gmail',
    displayName: 'Gmail',
    postMessageId: 'gmail-connected',
    credentialHint: 'gcp-oauth.keys.json',
    getStatus: getGmailAuthStatus,
    getAuthUrl: getGmailAuthUrl,
    handleCallback: handleGmailOAuthCallback,
  },
  {
    basePath: '/api/auth/google-sheets',
    displayName: 'Google Sheets',
    postMessageId: 'gsheets-connected',
    credentialHint: 'gcp-oauth.keys.json',
    getStatus: getSheetsAuthStatus,
    getAuthUrl: getSheetsAuthUrl,
    handleCallback: handleSheetsOAuthCallback,
  },
];

function oauthSuccessHtml(displayName: string, postMessageId: string): string {
  return `<!DOCTYPE html><html><body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0">
    <div style="text-align:center"><h2>${displayName} connected</h2><p>You can close this tab.</p>
    <script>window.opener&&window.opener.postMessage('${postMessageId}','*');setTimeout(()=>window.close(),2000)</script>
    </div></body></html>`;
}

function oauthErrorHtml(err: unknown): string {
  const message = err instanceof Error ? err.message : 'Unknown error';
  return `<h3>OAuth Error</h3><p>${message}</p><p>Close this tab and try again.</p>`;
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
        } catch {
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

    const agents = Object.entries(groups).map(([jid, group]) => {
      const qs = queueStatus.find((s) => s.jid === jid);
      const lastMessages = getRecentMessages(1, jid);
      const lastActivity = lastMessages.length > 0 ? lastMessages[0].timestamp : null;

      return {
        jid,
        name: group.name,
        folder: group.folder,
        online: qs?.active ?? false,
        lastActivity,
        currentTask: qs?.currentTaskId ?? null,
        containerName: qs?.containerName ?? null,
        pendingMessages: qs?.pendingMessages ?? false,
        pendingTaskCount: qs?.pendingTaskCount ?? 0,
      };
    });

    json(agents);
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
      const groups = getAllRegisteredGroups();
      const entry = Object.entries(groups).find(([, g]) => g.folder === group);
      if (!entry) {
        json({ error: `Group '${group}' not found` }, 404);
        return;
      }
      chatJid = entry[0];
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

    const [jid] = entry;
    const result = await sendGroupMessage(group, jid, text);
    json({ ...result, group, jid });
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

  // ─── Google OAuth (Calendar, Gmail, Sheets) ───
  if (pathname.startsWith('/api/auth/') && method === 'GET') {
    const handled = await handleOAuthRoutes(pathname, method, url, res, json);
    if (handled) return;
  }

  // Calendar endpoints
  if ((pathname === '/api/calendar' || pathname === '/api/calendar/events') && method === 'GET') {
    const view = (url.searchParams.get('view') || 'day') as 'day' | 'week';
    const events = await getCalendarEvents(view);
    json(events);
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

  // Send initial snapshot
  const agentSnapshot = Object.entries(groups).map(([jid, group]) => {
    const qs = queue?.getStatus().find((s) => s.jid === jid);
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

  const interval = setInterval(() => {
    try {
      // New activity (task runs + messages combined)
      const activity = getRecentActivity(10);
      const newActivity = activity.filter((a) => a.timestamp > lastActivityTs);
      if (newActivity.length > 0) {
        lastActivityTs = newActivity[0].timestamp;
        res.write(`data: ${JSON.stringify({ type: 'activity', items: newActivity })}\n\n`);
      }

      // New messages
      const messages = getRecentMessages(10);
      const newMessages = messages.filter((m) => m.timestamp > lastMessageTs);
      if (newMessages.length > 0) {
        lastMessageTs = newMessages[0].timestamp;
        res.write(`data: ${JSON.stringify({ type: 'messages', items: newMessages })}\n\n`);
      }

      // Agent status
      const currentGroups = getAllRegisteredGroups();
      const agents = Object.entries(currentGroups).map(([jid, group]) => {
        const qs = queue?.getStatus().find((s) => s.jid === jid);
        return {
          jid,
          name: group.name,
          folder: group.folder,
          online: qs?.active ?? false,
        };
      });
      res.write(`data: ${JSON.stringify({ type: 'agents', agents })}\n\n`);
    } catch {
      res.write(': heartbeat\n\n');
    }
  }, 2000);

  req.on('close', () => {
    clearInterval(interval);
  });
}
