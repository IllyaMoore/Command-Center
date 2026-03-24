export interface Agent {
  jid: string;
  name: string;
  folder: string;
  online: boolean;
  lastActivity: string | null;
  currentTask: string | null;
  containerName: string | null;
  pendingMessages: boolean;
  pendingTaskCount: number;
}

const BASE = "";

export async function fetchAgents(): Promise<Agent[]> {
  const res = await fetch(`${BASE}/api/agents`);
  if (!res.ok) throw new Error(`Failed to fetch agents: ${res.status}`);
  return res.json();
}

export async function createAgent(
  name: string,
  folder: string,
  description?: string,
): Promise<{ jid: string; name: string; folder: string }> {
  const res = await fetch(`${BASE}/api/agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, folder, description }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to create agent: ${res.status}`);
  }
  return res.json();
}

export async function deleteAgent(folder: string): Promise<void> {
  const res = await fetch(`${BASE}/api/agents/${folder}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to delete agent: ${res.status}`);
  }
}

// ── Agent Prompt ──

export async function fetchPrompt(folder: string): Promise<string> {
  const res = await fetch(`${BASE}/api/agents/${encodeURIComponent(folder)}/prompt`);
  if (!res.ok) throw new Error(`Failed to fetch prompt: ${res.status}`);
  const data = await res.json();
  return data.content;
}

export async function savePrompt(folder: string, content: string): Promise<void> {
  const res = await fetch(`${BASE}/api/agents/${encodeURIComponent(folder)}/prompt`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to save prompt: ${res.status}`);
  }
}

// ── Messages ──

export interface Message {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me: boolean;
  is_bot_message: boolean;
}

export async function fetchMessages(
  group: string,
  limit = 50,
  offset = 0,
): Promise<Message[]> {
  const res = await fetch(
    `${BASE}/api/messages?group=${encodeURIComponent(group)}&limit=${limit}&offset=${offset}`,
  );
  if (!res.ok) throw new Error(`Failed to fetch messages: ${res.status}`);
  const data = await res.json();
  return data.messages ?? data;
}

export async function sendMessage(
  group: string,
  text: string,
): Promise<void> {
  const res = await fetch(`${BASE}/api/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, group }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to send message: ${res.status}`);
  }
}

// ── Tasks / Automations ──

export interface TaskRunLog {
  task_id: string;
  run_at: string;
  duration_ms: number;
  status: "success" | "error";
  result: string | null;
  error: string | null;
}

export interface ScheduledTask {
  id: string;
  group_folder: string;
  chat_jid: string;
  prompt: string;
  schedule_type: "cron" | "interval" | "once";
  schedule_value: string;
  context_mode: "group" | "isolated";
  model: string | null;
  next_run: string | null;
  last_run: string | null;
  last_result: string | null;
  status: "active" | "paused" | "completed";
  created_at: string;
  recent_runs?: TaskRunLog[];
}

export interface CreateTaskPayload {
  group_folder: string;
  chat_jid: string;
  prompt: string;
  schedule_type: "cron" | "interval" | "once";
  schedule_value: string;
  context_mode?: "group" | "isolated";
  model?: string;
}

export interface UpdateTaskPayload {
  prompt?: string;
  schedule_type?: "cron" | "interval" | "once";
  schedule_value?: string;
  status?: "active" | "paused";
}

async function taskError(res: Response, fallback: string): Promise<never> {
  const err = await res.json().catch(() => ({}));
  throw new Error(err.error || `${fallback}: ${res.status}`);
}

export async function fetchTasks(group?: string): Promise<ScheduledTask[]> {
  const q = group ? `?group=${encodeURIComponent(group)}` : "";
  const res = await fetch(`${BASE}/api/tasks${q}`);
  if (!res.ok) throw new Error(`Failed to fetch tasks: ${res.status}`);
  return res.json();
}

export async function createTaskApi(task: CreateTaskPayload): Promise<ScheduledTask> {
  const res = await fetch(`${BASE}/api/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(task),
  });
  if (!res.ok) return taskError(res, "Failed to create task");
  return res.json();
}

export async function updateTaskApi(id: string, updates: UpdateTaskPayload): Promise<ScheduledTask> {
  const res = await fetch(`${BASE}/api/tasks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) return taskError(res, "Failed to update task");
  return res.json();
}

export async function deleteTaskApi(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/tasks/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) return taskError(res, "Failed to delete task");
}

export async function runTaskNow(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/tasks/${encodeURIComponent(id)}/run`, {
    method: "POST",
  });
  if (!res.ok) return taskError(res, "Failed to trigger task");
}
