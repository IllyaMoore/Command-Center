import { IncomingMessage, ServerResponse } from 'http';

import { resetGoogleClients } from '../mcp/google-mcp-server.js';
import { logger } from '../logger.js';
import {
  getCalendarAuthStatus,
  getCalendarAuthUrl,
  getCalendarEvents,
  createCalendarEvent,
  handleCalendarOAuthCallback,
  disconnectCalendar,
} from './api/calendar.js';
import { sendChatMessage, streamChatMessages } from './api/chat.js';
import { handleUpload, serveUpload } from './api/upload.js';
import { getActivity, streamActivity } from './api/activity.js';
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
import {
  getAgents,
  createAgent,
  deleteAgent,
  getAgentPrompt,
  updateAgentPrompt,
  getAgentSettings,
  updateAgentSettings,
} from './api/agents.js';
import { getTasks, createNewTask, patchTask, removeTask, triggerTask } from './api/tasks.js';
import { getMessages, clearMessages, postMessage } from './api/messages.js';
import {
  getPendingApprovals,
  respondToApproval,
  getToolPoliciesForGroup,
  upsertPolicy,
  removePolicy,
} from './api/approvals.js';
import { getTimezonesetting, updateTimezone } from './api/settings.js';
import { streamEvents } from './api/events.js';
import { getDashboardQueue } from './context.js';

// ─── OAuth provider configurations ───

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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function oauthSuccessHtml(displayName: string, postMessageId: string): string {
  return `<!DOCTYPE html><html><body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0">
    <div style="text-align:center"><h2>${escapeHtml(displayName)} connected</h2><p>You can close this tab.</p>
    <script>window.opener&&window.opener.postMessage(${JSON.stringify(postMessageId)},window.location.origin);setTimeout(()=>window.close(),2000)</script>
    </div></body></html>`;
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
        resetGoogleClients();
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

// ─── Helpers ───

function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    let settled = false;
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000 && !settled) {
        settled = true;
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (settled) return;
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        logger.warn({ err }, 'Failed to parse request body as JSON');
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// ─── Main router ───

export async function handleApiRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  const pathname = url.pathname;
  const method = req.method || 'GET';

  const json = (data: unknown, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  // Helper to handle { data, error, status } results from API modules
  const respond = (result: { data?: unknown; error?: string; status: number }) => {
    if (result.error) {
      json({ error: result.error }, result.status);
    } else {
      json(result.data, result.status);
    }
  };

  // ─── Agents ───

  if (pathname === '/api/agents' && method === 'GET') {
    const queue = getDashboardQueue();
    const source = url.searchParams.get('source');
    const queueStatus = queue?.getStatus() ?? [];
    json(getAgents(source, queueStatus));
    return;
  }

  if (pathname === '/api/agents' && method === 'POST') {
    const body = await parseBody(req);
    respond(await createAgent(body as { name?: string; folder?: string; description?: string }));
    return;
  }

  if (pathname.startsWith('/api/agents/') && method === 'DELETE' && !pathname.includes('/prompt') && !pathname.includes('/settings')) {
    const folder = decodeURIComponent(pathname.split('/api/agents/')[1]);
    respond(deleteAgent(folder));
    return;
  }

  {
    const match = pathname.match(/^\/api\/agents\/([^/]+)\/prompt$/);
    if (match && method === 'GET') {
      respond(getAgentPrompt(decodeURIComponent(match[1])));
      return;
    }
    if (match && method === 'PUT') {
      const body = await parseBody(req);
      respond(updateAgentPrompt(decodeURIComponent(match[1]), body.content as string | undefined));
      return;
    }
  }

  {
    const match = pathname.match(/^\/api\/agents\/([^/]+)\/settings$/);
    if (match && method === 'GET') {
      json(getAgentSettings(decodeURIComponent(match[1])));
      return;
    }
    if (match && method === 'PUT') {
      const body = await parseBody(req);
      respond(updateAgentSettings(decodeURIComponent(match[1]), body.approvalMode as string | undefined));
      return;
    }
  }

  // ─── Tasks ───

  if (pathname === '/api/tasks' && method === 'GET') {
    const group = url.searchParams.get('group');
    const runsLimit = parseInt(url.searchParams.get('runs') || '5', 10);
    json(getTasks(group, runsLimit));
    return;
  }

  if (pathname === '/api/tasks' && method === 'POST') {
    const body = await parseBody(req);
    respond(createNewTask(body as Record<string, unknown>));
    return;
  }

  {
    const match = pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (match && method === 'PATCH') {
      const body = await parseBody(req);
      respond(patchTask(decodeURIComponent(match[1]), body));
      return;
    }
    if (match && method === 'DELETE') {
      respond(removeTask(decodeURIComponent(match[1])));
      return;
    }
  }

  {
    const match = pathname.match(/^\/api\/tasks\/([^/]+)\/run$/);
    if (match && method === 'POST') {
      respond(triggerTask(decodeURIComponent(match[1])));
      return;
    }
  }

  // ─── Messages ───

  if (pathname === '/api/messages' && method === 'GET') {
    const group = url.searchParams.get('group');
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);
    json(getMessages(group, limit, offset));
    return;
  }

  if (pathname === '/api/messages' && method === 'DELETE') {
    respond(clearMessages(url.searchParams.get('group')));
    return;
  }

  if (pathname === '/api/messages' && method === 'POST') {
    const body = await parseBody(req);
    respond(await postMessage(body));
    return;
  }

  // ─── SSE Events ───

  if (pathname === '/api/events' && method === 'GET') {
    streamEvents(req, res);
    return;
  }

  // ─── Approvals & Tool Policies ───

  if (pathname === '/api/approvals' && method === 'GET') {
    json(getPendingApprovals());
    return;
  }

  {
    const match = pathname.match(/^\/api\/approvals\/([^/]+)$/);
    if (match && method === 'POST') {
      const body = await parseBody(req);
      respond(
        respondToApproval(
          decodeURIComponent(match[1]),
          body.decision as string | undefined,
          !!(body.alwaysAllow as boolean),
        ),
      );
      return;
    }
  }

  if (pathname === '/api/tool-policies' && method === 'GET') {
    respond(getToolPoliciesForGroup(url.searchParams.get('group')));
    return;
  }

  if (pathname === '/api/tool-policies' && method === 'PUT') {
    const body = await parseBody(req);
    respond(upsertPolicy(body as { group_folder?: string; tool_pattern?: string; action?: string }));
    return;
  }

  if (pathname === '/api/tool-policies' && method === 'DELETE') {
    const body = await parseBody(req);
    respond(removePolicy(body as { group_folder?: string; tool_pattern?: string }));
    return;
  }

  // ─── Activity (legacy) ───

  if (pathname === '/api/activity' && method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    json(await getActivity(limit));
    return;
  }

  if (pathname === '/api/activity/stream' && method === 'GET') {
    await streamActivity(req, res);
    return;
  }

  // ─── OAuth ───

  if (pathname.startsWith('/api/auth/')) {
    const handled = await handleOAuthRoutes(pathname, method, url, res, json);
    if (handled) return;
  }

  // ─── Calendar ───

  if ((pathname === '/api/calendar' || pathname === '/api/calendar/events') && method === 'GET') {
    const view = (url.searchParams.get('view') || 'day') as 'day' | 'week';
    json(await getCalendarEvents(view));
    return;
  }

  if ((pathname === '/api/calendar' || pathname === '/api/calendar/events') && method === 'POST') {
    const body = await parseBody(req);
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

  // ─── Upload ───

  if (pathname === '/api/upload' && method === 'POST') {
    handleUpload(req, res);
    return;
  }

  {
    const match = pathname.match(/^\/api\/uploads\/([^/]+)$/);
    if (match && method === 'GET') {
      serveUpload(req, res, decodeURIComponent(match[1]));
      return;
    }
  }

  // ─── Chat (legacy) ───

  if (pathname === '/api/chat' && method === 'POST') {
    const body = await parseBody(req);
    const text = body.text as string | undefined;
    if (!text) {
      json({ error: 'Missing text field' }, 400);
      return;
    }
    json(await sendChatMessage(text));
    return;
  }

  if (pathname === '/api/chat/stream' && method === 'GET') {
    await streamChatMessages(req, res);
    return;
  }

  // ─── Settings ───

  if (pathname === '/api/settings/timezone' && method === 'GET') {
    json(getTimezonesetting());
    return;
  }

  if (pathname === '/api/settings/timezone' && method === 'POST') {
    const body = await parseBody(req);
    respond(updateTimezone(body.timezone as string | undefined));
    return;
  }

  // ─── Health & Debug ───

  if (pathname === '/api/health' && method === 'GET') {
    json({ status: 'ok', timestamp: new Date().toISOString() });
    return;
  }

  if (pathname === '/api/debug/queue' && method === 'GET') {
    const queue = getDashboardQueue();
    json(queue?.getStatus() ?? []);
    return;
  }

  // 404
  json({ error: 'Not found' }, 404);
}
