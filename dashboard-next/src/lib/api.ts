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
): Promise<{ jid: string; name: string; folder: string }> {
  const res = await fetch(`${BASE}/api/agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, folder }),
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
