import fs from 'fs';
import path from 'path';

import { GROUPS_DIR } from '../../config.js';
import { logger } from '../../logger.js';
import {
  deleteRegisteredGroup,
  getAllRegisteredGroups,
  getRecentMessages,
  getRouterState,
  setRegisteredGroup,
  setRouterState,
} from '../../db.js';
import { AgentStatus } from '../../group-queue.js';
import { getDashboardQueue } from '../context.js';

// ─── GET /api/agents ───

export function getAgents(
  source: string | null,
  queueStatus: AgentStatus[],
): Array<Record<string, unknown>> {
  const groups = getAllRegisteredGroups();
  const seenFolders = new Set<string>();
  const agents: Array<Record<string, unknown>> = [];

  for (const [jid, group] of Object.entries(groups)) {
    const claudeMd = path.join(GROUPS_DIR, group.folder, 'CLAUDE.md');
    if (!fs.existsSync(claudeMd)) continue;
    if (source === 'dashboard' && !jid.startsWith('dashboard-')) continue;
    if (source === 'channel' && jid.startsWith('dashboard-')) continue;

    seenFolders.add(group.folder);
    const qs = queueStatus.find(
      (s) =>
        s.jid === jid ||
        s.jid === `dashboard-${group.folder}` ||
        s.groupFolder === group.folder,
    );
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

  // Add unregistered groups/ directories that have CLAUDE.md
  if (source !== 'channel') {
    try {
      const groupDirs = fs.readdirSync(GROUPS_DIR, { withFileTypes: true });
      for (const dir of groupDirs) {
        if (
          !dir.isDirectory() ||
          seenFolders.has(dir.name) ||
          dir.name.includes('.archived-') ||
          dir.name === 'global'
        )
          continue;
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

  return agents;
}

// ─── POST /api/agents ───

export async function createAgent(body: {
  name?: string;
  folder?: string;
  description?: string;
}): Promise<{ data?: Record<string, unknown>; error?: string; status: number }> {
  const { name, folder, description } = body;

  if (!name || !folder) {
    return { error: 'name and folder are required', status: 400 };
  }

  if (!/^[a-z0-9_-]+$/.test(folder)) {
    return { error: 'folder must be lowercase alphanumeric with hyphens/underscores only', status: 400 };
  }

  const existing = getAllRegisteredGroups();
  const folderTaken = Object.values(existing).some((g) => g.folder === folder);
  if (folderTaken) {
    return { error: `folder '${folder}' already exists`, status: 409 };
  }

  const jid = `dashboard-${folder}-${Date.now()}`;
  const groupDir = path.join(GROUPS_DIR, folder);

  try {
    if (!fs.existsSync(groupDir)) {
      fs.mkdirSync(groupDir, { recursive: true });
    }
  } catch (err) {
    logger.error({ err, folder }, 'Failed to create agent directory');
    return { error: 'Failed to create agent directory on disk', status: 500 };
  }

  const claudeMdPath = path.join(groupDir, 'CLAUDE.md');
  if (description?.trim()) {
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

  setRegisteredGroup(jid, {
    name,
    folder,
    trigger: `(?i)@${folder}`,
    added_at: new Date().toISOString(),
    requiresTrigger: false,
  });

  logger.info({ jid, name, folder }, 'Agent created via dashboard');
  return { data: { jid, name, folder }, status: 201 };
}

// ─── DELETE /api/agents/:folder ───

export function deleteAgent(folder: string): { data?: Record<string, unknown>; error?: string; status: number } {
  if (!folder || !/^[a-z0-9_-]+$/.test(folder)) {
    return { error: 'Invalid folder name', status: 400 };
  }

  const groups = getAllRegisteredGroups();
  const entry = Object.entries(groups).find(([, g]) => g.folder === folder);
  if (!entry) {
    return { error: `Agent '${folder}' not found`, status: 404 };
  }

  const groupDir = path.join(GROUPS_DIR, folder);
  const archiveDir = path.join(GROUPS_DIR, `${folder}.archived-${Date.now()}`);
  try {
    if (fs.existsSync(groupDir)) {
      fs.renameSync(groupDir, archiveDir);
    }
  } catch (err) {
    logger.error({ err, folder }, 'Failed to archive agent directory');
  }

  const [jid] = entry;
  deleteRegisteredGroup(jid);

  logger.info({ jid, folder }, 'Agent deleted via dashboard');
  return { data: { deleted: true, folder }, status: 200 };
}

// ─── GET /api/agents/:folder/prompt ───

export function getAgentPrompt(folder: string): { data?: Record<string, unknown>; error?: string; status: number } {
  if (!/^[a-z0-9_-]+$/i.test(folder)) {
    return { error: 'Invalid folder name', status: 400 };
  }
  const claudeMdPath = path.join(GROUPS_DIR, folder, 'CLAUDE.md');
  try {
    const content = fs.readFileSync(claudeMdPath, 'utf-8');
    return { data: { folder, content }, status: 200 };
  } catch {
    return { error: 'CLAUDE.md not found', status: 404 };
  }
}

// ─── PUT /api/agents/:folder/prompt ───

export function updateAgentPrompt(
  folder: string,
  content: string | undefined,
): { data?: Record<string, unknown>; error?: string; status: number } {
  if (!/^[a-z0-9_-]+$/i.test(folder)) {
    return { error: 'Invalid folder name', status: 400 };
  }
  if (content === undefined) {
    return { error: 'content is required', status: 400 };
  }
  const claudeMdPath = path.join(GROUPS_DIR, folder, 'CLAUDE.md');
  try {
    fs.writeFileSync(claudeMdPath, content, 'utf-8');
    logger.info({ folder }, 'CLAUDE.md updated via dashboard');
    return { data: { folder, saved: true }, status: 200 };
  } catch (err) {
    logger.error({ err, folder }, 'Failed to write CLAUDE.md');
    return { error: 'Failed to save', status: 500 };
  }
}

// ─── GET /api/agents/:folder/settings ───

export function getAgentSettings(folder: string): Record<string, unknown> {
  const approvalMode = getRouterState(`approval_mode:${folder}`) || 'auto';
  return { approvalMode };
}

// ─── PUT /api/agents/:folder/settings ───

export function updateAgentSettings(
  folder: string,
  approvalMode: string | undefined,
): { data?: Record<string, unknown>; error?: string; status: number } {
  if (!approvalMode || !['ask', 'auto'].includes(approvalMode)) {
    return { error: 'approvalMode must be ask or auto', status: 400 };
  }
  setRouterState(`approval_mode:${folder}`, approvalMode);
  const queue = getDashboardQueue();
  const result = queue?.killByFolder(folder) ?? 'none';
  return { data: { ok: true, approvalMode, agent: result }, status: 200 };
}

// ─── Generate agent CLAUDE.md via Anthropic API ───

async function generateAgentPrompt(name: string, description: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not set');
  }

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

  const refBlock =
    references.length > 0
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
