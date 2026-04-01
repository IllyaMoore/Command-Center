import fs from 'fs';
import { IncomingMessage, ServerResponse } from 'http';
import path from 'path';

import { CronExpressionParser } from 'cron-parser';

import { GROUPS_DIR, isValidModel } from '../config.js';
import { resetGoogleClients } from '../mcp/google-mcp-server.js';
import { logger } from '../logger.js';
import {
  createTask,
  deleteMessages,
  storeChatMetadata,
  storeMessageDirect,
  deleteRegisteredGroup,
  deleteTask,
  deleteToolPolicy,
  getAllRegisteredGroups,
  getAllTasks,
  getMessagesPaginated,
  getRecentActivity,
  getRecentMessages,
  getRecentTaskRuns,
  getTaskById,
  getTasksForGroup,
  getTimezone,
  getRouterState,
  getToolPolicies,
  setRegisteredGroup,
  setRouterState,
  setTimezone,
  updateTask,
  upsertToolPolicy,
} from '../db.js';
import { approvalManager } from '../approval-manager.js';
import { ScheduledTask, TaskRunLog } from '../types.js';
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
import { handleUpload, serveUpload } from './api/upload.js';
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
    <div style="text-align:center"><h2>${escapeHtml(displayName)} connected</h2><p>You can close this tab.</p>
    <script>window.opener&&window.opener.postMessage(${JSON.stringify(postMessageId)},window.location.origin);setTimeout(()=>window.close(),2000)</script>
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

export async function handleApiRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  const pathname = url.pathname;
  const method = req.method || 'GET';

  // Parse request body for POST requests (1MB limit)
  const parseBody = (): Promise<Record<string, unknown>> => {
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
          if (!dir.isDirectory() || seenFolders.has(dir.name) || dir.name.includes('.archived-') || dir.name === 'global') continue;
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
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') {
          logger.error({ err }, 'Failed to read groups directory for unregistered agents');
        }
      }
    }

    json(agents);
    return;
  }

  // ─── OPC-126: POST /api/agents ───
  if (pathname === '/api/agents' && method === 'POST') {
    const body = await parseBody();
    const { name, folder, description } = body as {
      name?: string;
      folder?: string;
      description?: string;
    };

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

    // Create group directory
    const groupDir = path.join(GROUPS_DIR, folder);
    try {
      if (!fs.existsSync(groupDir)) {
        fs.mkdirSync(groupDir, { recursive: true });
      }
    } catch (err) {
      logger.error({ err, folder }, 'Failed to create agent directory');
      json({ error: 'Failed to create agent directory on disk' }, 500);
      return;
    }

    // Generate CLAUDE.md — use AI if description provided, otherwise use default
    const claudeMdPath = path.join(groupDir, 'CLAUDE.md');
    if (description?.trim()) {
      // Generate system prompt via Anthropic API (non-blocking for registration)
      try {
        const prompt = await generateAgentPrompt(name, description.trim());
        fs.writeFileSync(claudeMdPath, prompt, 'utf-8');
      } catch (err) {
        logger.error({ err, folder }, 'Failed to generate agent prompt, using default');
        fs.writeFileSync(
          claudeMdPath,
          `# ${name}\n\nYou are the ${name} agent. Respond helpfully and concisely.\n`,
          'utf-8',
        );
      }
    } else if (!fs.existsSync(claudeMdPath)) {
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
    const folder = decodeURIComponent(pathname.split('/api/agents/')[1]);
    if (!folder || !/^[a-z0-9_-]+$/.test(folder)) {
      json({ error: 'Invalid folder name' }, 400);
      return;
    }

    const groups = getAllRegisteredGroups();
    const entry = Object.entries(groups).find(([, g]) => g.folder === folder);
    if (!entry) {
      json({ error: `Agent '${folder}' not found` }, 404);
      return;
    }

    // Archive group directory first (before DB delete, so failure doesn't leave ghost)
    const groupDir = path.join(GROUPS_DIR, folder);
    const archiveDir = path.join(GROUPS_DIR, `${folder}.archived-${Date.now()}`);
    try {
      if (fs.existsSync(groupDir)) {
        fs.renameSync(groupDir, archiveDir);
      }
    } catch (err) {
      logger.error({ err, folder }, 'Failed to archive agent directory');
      // Continue — still delete the DB entry
    }

    const [jid] = entry;
    deleteRegisteredGroup(jid);

    logger.info({ jid, folder }, 'Agent deleted via dashboard');
    json({ deleted: true, folder });
    return;
  }

  // ─── GET /api/agents/:folder/prompt ───
  {
    const match = pathname.match(/^\/api\/agents\/([^/]+)\/prompt$/);
    if (match && method === 'GET') {
      const folder = decodeURIComponent(match[1]);
      if (!/^[a-z0-9_-]+$/i.test(folder)) { json({ error: 'Invalid folder name' }, 400); return; }
      const claudeMdPath = path.join(GROUPS_DIR, folder, 'CLAUDE.md');
      try {
        const content = fs.readFileSync(claudeMdPath, 'utf-8');
        json({ folder, content });
      } catch {
        json({ error: 'CLAUDE.md not found' }, 404);
      }
      return;
    }
  }

  // ─── PUT /api/agents/:folder/prompt ───
  {
    const match = pathname.match(/^\/api\/agents\/([^/]+)\/prompt$/);
    if (match && method === 'PUT') {
      const folder = decodeURIComponent(match[1]);
      if (!/^[a-z0-9_-]+$/i.test(folder)) { json({ error: 'Invalid folder name' }, 400); return; }
      const body = await parseBody();
      const content = body.content as string | undefined;
      if (content === undefined) {
        json({ error: 'content is required' }, 400);
        return;
      }
      const claudeMdPath = path.join(GROUPS_DIR, folder, 'CLAUDE.md');
      try {
        fs.writeFileSync(claudeMdPath, content, 'utf-8');
        logger.info({ folder }, 'CLAUDE.md updated via dashboard');
        json({ folder, saved: true });
      } catch (err) {
        logger.error({ err, folder }, 'Failed to write CLAUDE.md');
        json({ error: 'Failed to save' }, 500);
      }
      return;
    }
  }

  // ─── GET /api/tasks ───
  if (pathname === '/api/tasks' && method === 'GET') {
    const group = url.searchParams.get('group');
    const tasks = group ? getTasksForGroup(group) : getAllTasks();
    const runsLimit = parseInt(url.searchParams.get('runs') || '5', 10);
    const allRuns = getRecentTaskRuns(tasks.length * runsLimit);

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

  // ─── POST /api/tasks ───
  if (pathname === '/api/tasks' && method === 'POST') {
    const body = await parseBody();
    const { group_folder, chat_jid, prompt, schedule_type, schedule_value, context_mode, model } =
      body as Partial<ScheduledTask>;

    if (!group_folder || !chat_jid || !prompt || !schedule_type || !schedule_value) {
      json({ error: 'group_folder, chat_jid, prompt, schedule_type, and schedule_value are required' }, 400);
      return;
    }

    if (!['cron', 'interval', 'once'].includes(schedule_type)) {
      json({ error: 'schedule_type must be cron, interval, or once' }, 400);
      return;
    }

    // Compute next_run
    let next_run: string | null = null;
    try {
      next_run = computeNextRunFromValues(schedule_type, schedule_value);
    } catch (err) {
      json({ error: `Invalid schedule: ${err instanceof Error ? err.message : err}` }, 400);
      return;
    }

    const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const task: Omit<ScheduledTask, 'last_run' | 'last_result'> = {
      id,
      group_folder,
      chat_jid,
      prompt,
      schedule_type,
      schedule_value,
      context_mode: context_mode || 'isolated',
      model: model && isValidModel(model) ? model : null,
      next_run,
      status: 'active',
      created_at: new Date().toISOString(),
    };

    createTask(task);
    logger.info({ id, group_folder }, 'Task created via dashboard');
    json(getTaskById(id), 201);
    return;
  }

  // ─── PATCH /api/tasks/:id ───
  {
    const match = pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (match && method === 'PATCH') {
      const id = decodeURIComponent(match[1]);
      const existing = getTaskById(id);
      if (!existing) {
        json({ error: 'Task not found' }, 404);
        return;
      }

      const body = await parseBody();
      const updates: Parameters<typeof updateTask>[1] = {};

      if (body.prompt !== undefined) updates.prompt = body.prompt as string;
      if (body.schedule_type !== undefined) updates.schedule_type = body.schedule_type as ScheduledTask['schedule_type'];
      if (body.schedule_value !== undefined) updates.schedule_value = body.schedule_value as string;
      if (body.status !== undefined) updates.status = body.status as ScheduledTask['status'];

      // Recompute next_run when schedule changes or status changes to active
      const newType = updates.schedule_type || existing.schedule_type;
      const newValue = updates.schedule_value || existing.schedule_value;
      if (updates.status === 'paused') {
        updates.next_run = null;
      } else if (updates.schedule_type || updates.schedule_value || updates.status === 'active') {
        try {
          updates.next_run = computeNextRunFromValues(newType, newValue);
        } catch (err) {
          json({ error: `Invalid schedule: ${err instanceof Error ? err.message : err}` }, 400);
          return;
        }
      }

      updateTask(id, updates);
      logger.info({ id }, 'Task updated via dashboard');
      json(getTaskById(id));
      return;
    }
  }

  // ─── DELETE /api/tasks/:id ───
  {
    const match = pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (match && method === 'DELETE') {
      const id = decodeURIComponent(match[1]);
      const existing = getTaskById(id);
      if (!existing) {
        json({ error: 'Task not found' }, 404);
        return;
      }
      deleteTask(id);
      logger.info({ id }, 'Task deleted via dashboard');
      json({ deleted: true });
      return;
    }
  }

  // ─── POST /api/tasks/:id/run ───
  {
    const match = pathname.match(/^\/api\/tasks\/([^/]+)\/run$/);
    if (match && method === 'POST') {
      const id = decodeURIComponent(match[1]);
      const existing = getTaskById(id);
      if (!existing) {
        json({ error: 'Task not found' }, 404);
        return;
      }
      // Trigger via scheduler's queue — the scheduler picks it up
      const queue = getDashboardQueue();
      if (!queue) {
        json({ error: 'Queue not available' }, 503);
        return;
      }
      // Mark as due now so the scheduler loop picks it up on next poll
      updateTask(id, { next_run: new Date().toISOString(), status: 'active' });
      logger.info({ id }, 'Task triggered manually via dashboard');
      json({ triggered: true, task_id: id });
      return;
    }
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
    // Optional: deliver response to a different chat (cross-agent messaging)
    const replyTo = body.replyTo as string | undefined;
    // Optional: file attachments (uploaded via POST /api/upload)
    const attachments = Array.isArray(body.attachments) ? body.attachments as Array<{id: string; name: string; size: number; mime: string; path: string}> : undefined;

    if (!text && (!attachments || attachments.length === 0)) {
      json({ error: 'Missing text or attachments' }, 400);
      return;
    }

    const groups = getAllRegisteredGroups();
    const entry = Object.entries(groups).find(([, g]) => g.folder === group);
    if (!entry) {
      json({ error: `Group '${group}' not registered` }, 404);
      return;
    }

    // Validate replyTo group exists
    if (replyTo) {
      const replyEntry = Object.values(groups).find((g) => g.folder === replyTo);
      if (!replyEntry) {
        json({ error: `Unknown replyTo group '${replyTo}'` }, 400);
        return;
      }
    }

    // Cross-agent: unique JID prevents queue collision with the source agent.
    // Messages stored under display JID (source chat) for UI.
    const isForward = !!replyTo && replyTo !== group;
    const chatJid = isForward
      ? `xagent-${group}-${Date.now()}`
      : `dashboard-${group}`;
    const displayJid = isForward ? `dashboard-${replyTo}` : chatJid;

    // For cross-agent: store user message in source chat (sendGroupMessage stores in agent chat)
    if (isForward) {
      storeChatMetadata(displayJid, new Date().toISOString(), `Dashboard: ${replyTo}`);
      storeMessageDirect({
        id: `dashboard-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        chat_jid: displayJid,
        sender: 'dashboard',
        sender_name: 'You (Dashboard)',
        content: (text || '') + (attachments && attachments.length > 0 ? `\n\n${attachments.map(a => `[${a.name}]`).join(' ')}` : ''),
        timestamp: new Date().toISOString(),
        is_from_me: true,
      });
    }

    const fileSuffix = attachments && attachments.length > 0
      ? `\n\n${attachments.map(a => `[${a.name}]`).join(' ')}`
      : '';
    const displayText = (text || '') + fileSuffix;
    const result = await sendGroupMessage(group, chatJid, displayText, isForward ? displayJid : undefined, attachments);
    json({ ...result, group, jid: displayJid });
    return;
  }

  // ─── CEO-9: SSE /api/events ───
  if (pathname === '/api/events' && method === 'GET') {
    streamEvents(req, res);
    return;
  }

  // ─── Approval endpoints ───
  if (pathname === '/api/approvals' && method === 'GET') {
    json(approvalManager.getPending());
    return;
  }

  // Respond to a pending approval request
  const approvalMatch = pathname.match(/^\/api\/approvals\/([^/]+)$/);
  if (approvalMatch && method === 'POST') {
    const id = decodeURIComponent(approvalMatch[1]);
    const body = await parseBody();
    const { decision, alwaysAllow } = body as { decision: 'allow' | 'deny'; alwaysAllow?: boolean };
    if (!decision || !['allow', 'deny'].includes(decision)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'decision must be "allow" or "deny"' }));
      return;
    }
    const ok = approvalManager.respond(id, decision, !!alwaysAllow);
    if (!ok) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Approval request not found' }));
      return;
    }
    json({ ok: true });
    return;
  }

  // ─── Tool policy endpoints ───
  if (pathname === '/api/tool-policies' && method === 'GET') {
    const group = url.searchParams.get('group');
    if (!group) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'group query param required' }));
      return;
    }
    json(getToolPolicies(group));
    return;
  }

  if (pathname === '/api/tool-policies' && method === 'PUT') {
    const body = await parseBody();
    const { group_folder, tool_pattern, action } = body as {
      group_folder?: string; tool_pattern?: string; action?: string;
    };
    if (!group_folder || !tool_pattern || !action || !['allow', 'deny', 'ask'].includes(action)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'group_folder, tool_pattern, and action (allow/deny/ask) required' }));
      return;
    }
    upsertToolPolicy(group_folder, tool_pattern, action as 'allow' | 'deny' | 'ask');
    json({ ok: true });
    return;
  }

  if (pathname === '/api/tool-policies' && method === 'DELETE') {
    const body = await parseBody();
    const { group_folder, tool_pattern } = body as { group_folder?: string; tool_pattern?: string };
    if (!group_folder || !tool_pattern) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'group_folder and tool_pattern required' }));
      return;
    }
    const deleted = deleteToolPolicy(group_folder, tool_pattern);
    json({ ok: true, deleted });
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

  // ─── File upload endpoints ───
  if (pathname === '/api/upload' && method === 'POST') {
    handleUpload(req, res);
    return;
  }

  const uploadMatch = pathname.match(/^\/api\/uploads\/([^/]+)$/);
  if (uploadMatch && method === 'GET') {
    serveUpload(req, res, decodeURIComponent(uploadMatch[1]));
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

  // ─── Agent settings (per-agent approval mode) ───
  const agentSettingsMatch = pathname.match(/^\/api\/agents\/([^/]+)\/settings$/);
  if (agentSettingsMatch && method === 'GET') {
    const folder = decodeURIComponent(agentSettingsMatch[1]);
    const approvalMode = getRouterState(`approval_mode:${folder}`) || 'auto';
    json({ approvalMode });
    return;
  }

  if (agentSettingsMatch && method === 'PUT') {
    const folder = decodeURIComponent(agentSettingsMatch[1]);
    const body = await parseBody();
    const approvalMode = body.approvalMode as string | undefined;
    if (approvalMode && ['ask', 'auto'].includes(approvalMode)) {
      setRouterState(`approval_mode:${folder}`, approvalMode);
      // Kill idle agent so next spawn picks up new mode; busy agents apply on next spawn
      const queue = getDashboardQueue();
      const result = queue?.killByFolder(folder) ?? 'none';
      json({ ok: true, approvalMode, agent: result });
      return;
    }
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'approvalMode must be ask or auto' }));
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

// ─── Compute next run for a schedule ───

function computeNextRunFromValues(
  scheduleType: string,
  scheduleValue: string,
): string | null {
  if (scheduleType === 'cron') {
    const interval = CronExpressionParser.parse(scheduleValue, {
      tz: getTimezone(),
    });
    return interval.next().toISOString();
  }
  if (scheduleType === 'interval') {
    const ms = parseInt(scheduleValue, 10);
    if (isNaN(ms) || ms < 60000) throw new Error('Interval must be at least 60000ms');
    return new Date(Date.now() + ms).toISOString();
  }
  if (scheduleType === 'once') {
    const date = new Date(scheduleValue);
    if (isNaN(date.getTime())) throw new Error('Invalid date for once schedule');
    return date.toISOString();
  }
  return null;
}

// ─── Generate agent CLAUDE.md via Anthropic API ───

async function generateAgentPrompt(name: string, description: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not set');
  }

  // Read existing agent prompts as style reference
  const references: string[] = [];
  for (const folder of ['ceo', 'finance', 'legal']) {
    const mdPath = path.join(GROUPS_DIR, folder, 'CLAUDE.md');
    try {
      if (fs.existsSync(mdPath)) {
        references.push(fs.readFileSync(mdPath, 'utf-8'));
      }
    } catch {
      // skip missing files
    }
  }

  const refBlock = references.length > 0
    ? `\n\nHere are existing agent prompts for style reference:\n\n${references.map((r, i) => `--- EXAMPLE ${i + 1} ---\n${r}\n--- END ---`).join('\n\n')}`
    : '';

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: `Generate a CLAUDE.md system prompt for an AI agent.

Agent name: ${name}
User's description of what the agent should do:
${description}
${refBlock}

Generate a complete CLAUDE.md following the same structure and style as the examples:
- Start with a # heading and ## Role section
- Include ## Core Responsibilities with bullet points
- Include ## Communication Style
- Add relevant sections specific to this agent's domain
- Include ## Output Formats with template examples where appropriate
- Include ## Tools Available (mention Browser as available by default)
- Include ## Priorities section
- End with ## Memory section (same pattern as examples — persistent MEMORY.md, max 50 entries, rules)

Important:
- Write the prompt in the same language as the user's description
- Be specific and actionable — avoid generic filler
- Match the depth and quality of the reference examples
- Output ONLY the markdown content, no wrapping or explanation`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${errBody}`);
  }

  const data = (await res.json()) as { content: Array<{ type: string; text: string }> };
  const text = data.content?.find((c) => c.type === 'text')?.text;
  if (!text) {
    throw new Error('No text in Anthropic API response');
  }

  return text;
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

      // Approval requests
      approvalManager.scanIpcDirs();
      approvalManager.cleanExpired();
      const pendingApprovals = approvalManager.getPending();
      if (pendingApprovals.length > 0) {
        res.write(`data: ${JSON.stringify({ type: 'approval_requests', items: pendingApprovals })}\n\n`);
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
