import { describe, it, expect, beforeEach } from 'vitest';

import {
  _initTestDatabase,
  createTask,
  deleteTask,
  deleteToolPolicy,
  getAllChats,
  getMessagesSince,
  getNewMessages,
  getRecentMessages,
  getSession,
  getTaskById,
  getToolPolicies,
  matchToolPolicy,
  setSession,
  storeChatMetadata,
  storeMessage,
  storeMessageDirect,
  updateTask,
  upsertToolPolicy,
} from './db.js';

beforeEach(() => {
  _initTestDatabase();
});

// Helper to store a message using the normalized NewMessage interface
function store(overrides: {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me?: boolean;
}) {
  storeMessage({
    id: overrides.id,
    chat_jid: overrides.chat_jid,
    sender: overrides.sender,
    sender_name: overrides.sender_name,
    content: overrides.content,
    timestamp: overrides.timestamp,
    is_from_me: overrides.is_from_me ?? false,
  });
}

// --- storeMessage (NewMessage format) ---

describe('storeMessage', () => {
  it('stores a message and retrieves it', () => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');

    store({
      id: 'msg-1',
      chat_jid: 'group@g.us',
      sender: '123@s.whatsapp.net',
      sender_name: 'Alice',
      content: 'hello world',
      timestamp: '2024-01-01T00:00:01.000Z',
    });

    const messages = getMessagesSince('group@g.us', '2024-01-01T00:00:00.000Z', 'Andy');
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe('msg-1');
    expect(messages[0].sender).toBe('123@s.whatsapp.net');
    expect(messages[0].sender_name).toBe('Alice');
    expect(messages[0].content).toBe('hello world');
  });

  it('stores empty content', () => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');

    store({
      id: 'msg-2',
      chat_jid: 'group@g.us',
      sender: '111@s.whatsapp.net',
      sender_name: 'Dave',
      content: '',
      timestamp: '2024-01-01T00:00:04.000Z',
    });

    const messages = getMessagesSince('group@g.us', '2024-01-01T00:00:00.000Z', 'Andy');
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('');
  });

  it('stores is_from_me flag', () => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');

    store({
      id: 'msg-3',
      chat_jid: 'group@g.us',
      sender: 'me@s.whatsapp.net',
      sender_name: 'Me',
      content: 'my message',
      timestamp: '2024-01-01T00:00:05.000Z',
      is_from_me: true,
    });

    // Message is stored (we can retrieve it — is_from_me doesn't affect retrieval)
    const messages = getMessagesSince('group@g.us', '2024-01-01T00:00:00.000Z', 'Andy');
    expect(messages).toHaveLength(1);
  });

  it('upserts on duplicate id+chat_jid', () => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');

    store({
      id: 'msg-dup',
      chat_jid: 'group@g.us',
      sender: '123@s.whatsapp.net',
      sender_name: 'Alice',
      content: 'original',
      timestamp: '2024-01-01T00:00:01.000Z',
    });

    store({
      id: 'msg-dup',
      chat_jid: 'group@g.us',
      sender: '123@s.whatsapp.net',
      sender_name: 'Alice',
      content: 'updated',
      timestamp: '2024-01-01T00:00:01.000Z',
    });

    const messages = getMessagesSince('group@g.us', '2024-01-01T00:00:00.000Z', 'Andy');
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('updated');
  });
});

// --- getMessagesSince ---

describe('getMessagesSince', () => {
  beforeEach(() => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');

    store({
      id: 'm1', chat_jid: 'group@g.us', sender: 'Alice@s.whatsapp.net',
      sender_name: 'Alice', content: 'first', timestamp: '2024-01-01T00:00:01.000Z',
    });
    store({
      id: 'm2', chat_jid: 'group@g.us', sender: 'Bob@s.whatsapp.net',
      sender_name: 'Bob', content: 'second', timestamp: '2024-01-01T00:00:02.000Z',
    });
    storeMessage({
      id: 'm3', chat_jid: 'group@g.us', sender: 'Bot@s.whatsapp.net',
      sender_name: 'Bot', content: 'bot reply', timestamp: '2024-01-01T00:00:03.000Z',
      is_bot_message: true,
    });
    store({
      id: 'm4', chat_jid: 'group@g.us', sender: 'Carol@s.whatsapp.net',
      sender_name: 'Carol', content: 'third', timestamp: '2024-01-01T00:00:04.000Z',
    });
  });

  it('returns messages after the given timestamp', () => {
    const msgs = getMessagesSince('group@g.us', '2024-01-01T00:00:02.000Z', 'Andy');
    // Should exclude m1, m2 (before/at timestamp), m3 (bot message)
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('third');
  });

  it('excludes bot messages via is_bot_message flag', () => {
    const msgs = getMessagesSince('group@g.us', '2024-01-01T00:00:00.000Z', 'Andy');
    const botMsgs = msgs.filter((m) => m.content === 'bot reply');
    expect(botMsgs).toHaveLength(0);
  });

  it('returns all non-bot messages when sinceTimestamp is empty', () => {
    const msgs = getMessagesSince('group@g.us', '', 'Andy');
    // 3 user messages (bot message excluded)
    expect(msgs).toHaveLength(3);
  });

  it('filters pre-migration bot messages via content prefix backstop', () => {
    // Simulate a message written before migration: has prefix but is_bot_message = 0
    store({
      id: 'm5', chat_jid: 'group@g.us', sender: 'Bot@s.whatsapp.net',
      sender_name: 'Bot', content: 'Andy: old bot reply',
      timestamp: '2024-01-01T00:00:05.000Z',
    });
    const msgs = getMessagesSince('group@g.us', '2024-01-01T00:00:04.000Z', 'Andy');
    expect(msgs).toHaveLength(0);
  });
});

// --- getNewMessages ---

describe('getNewMessages', () => {
  beforeEach(() => {
    storeChatMetadata('group1@g.us', '2024-01-01T00:00:00.000Z');
    storeChatMetadata('group2@g.us', '2024-01-01T00:00:00.000Z');

    store({
      id: 'a1', chat_jid: 'group1@g.us', sender: 'user@s.whatsapp.net',
      sender_name: 'User', content: 'g1 msg1', timestamp: '2024-01-01T00:00:01.000Z',
    });
    store({
      id: 'a2', chat_jid: 'group2@g.us', sender: 'user@s.whatsapp.net',
      sender_name: 'User', content: 'g2 msg1', timestamp: '2024-01-01T00:00:02.000Z',
    });
    storeMessage({
      id: 'a3', chat_jid: 'group1@g.us', sender: 'user@s.whatsapp.net',
      sender_name: 'User', content: 'bot reply', timestamp: '2024-01-01T00:00:03.000Z',
      is_bot_message: true,
    });
    store({
      id: 'a4', chat_jid: 'group1@g.us', sender: 'user@s.whatsapp.net',
      sender_name: 'User', content: 'g1 msg2', timestamp: '2024-01-01T00:00:04.000Z',
    });
  });

  it('returns new messages across multiple groups', () => {
    const { messages, newTimestamp } = getNewMessages(
      ['group1@g.us', 'group2@g.us'],
      '2024-01-01T00:00:00.000Z',
      'Andy',
    );
    // Excludes bot message, returns 3 user messages
    expect(messages).toHaveLength(3);
    expect(newTimestamp).toBe('2024-01-01T00:00:04.000Z');
  });

  it('filters by timestamp', () => {
    const { messages } = getNewMessages(
      ['group1@g.us', 'group2@g.us'],
      '2024-01-01T00:00:02.000Z',
      'Andy',
    );
    // Only g1 msg2 (after ts, not bot)
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('g1 msg2');
  });

  it('returns empty for no registered groups', () => {
    const { messages, newTimestamp } = getNewMessages([], '', 'Andy');
    expect(messages).toHaveLength(0);
    expect(newTimestamp).toBe('');
  });
});

// --- storeChatMetadata ---

describe('storeChatMetadata', () => {
  it('stores chat with JID as default name', () => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');
    const chats = getAllChats();
    expect(chats).toHaveLength(1);
    expect(chats[0].jid).toBe('group@g.us');
    expect(chats[0].name).toBe('group@g.us');
  });

  it('stores chat with explicit name', () => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z', 'My Group');
    const chats = getAllChats();
    expect(chats[0].name).toBe('My Group');
  });

  it('updates name on subsequent call with name', () => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');
    storeChatMetadata('group@g.us', '2024-01-01T00:00:01.000Z', 'Updated Name');
    const chats = getAllChats();
    expect(chats).toHaveLength(1);
    expect(chats[0].name).toBe('Updated Name');
  });

  it('preserves newer timestamp on conflict', () => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:05.000Z');
    storeChatMetadata('group@g.us', '2024-01-01T00:00:01.000Z');
    const chats = getAllChats();
    expect(chats[0].last_message_time).toBe('2024-01-01T00:00:05.000Z');
  });
});

// --- Task CRUD ---

describe('task CRUD', () => {
  it('creates and retrieves a task', () => {
    createTask({
      id: 'task-1',
      group_folder: 'main',
      chat_jid: 'group@g.us',
      prompt: 'do something',
      schedule_type: 'once',
      schedule_value: '2024-06-01T00:00:00.000Z',
      context_mode: 'isolated',
      model: null,
      next_run: '2024-06-01T00:00:00.000Z',
      status: 'active',
      created_at: '2024-01-01T00:00:00.000Z',
    });

    const task = getTaskById('task-1');
    expect(task).toBeDefined();
    expect(task!.prompt).toBe('do something');
    expect(task!.status).toBe('active');
  });

  it('updates task status', () => {
    createTask({
      id: 'task-2',
      group_folder: 'main',
      chat_jid: 'group@g.us',
      prompt: 'test',
      schedule_type: 'once',
      schedule_value: '2024-06-01T00:00:00.000Z',
      context_mode: 'isolated',
      model: null,
      next_run: null,
      status: 'active',
      created_at: '2024-01-01T00:00:00.000Z',
    });

    updateTask('task-2', { status: 'paused' });
    expect(getTaskById('task-2')!.status).toBe('paused');
  });

  it('deletes a task and its run logs', () => {
    createTask({
      id: 'task-3',
      group_folder: 'main',
      chat_jid: 'group@g.us',
      prompt: 'delete me',
      schedule_type: 'once',
      schedule_value: '2024-06-01T00:00:00.000Z',
      context_mode: 'isolated',
      model: null,
      next_run: null,
      status: 'active',
      created_at: '2024-01-01T00:00:00.000Z',
    });

    deleteTask('task-3');
    expect(getTaskById('task-3')).toBeUndefined();
  });
});

// --- Dashboard message filtering ---

describe('dashboard message filtering', () => {
  beforeEach(() => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');

    store({
      id: 'u1', chat_jid: 'group@g.us', sender: 'user@s.whatsapp.net',
      sender_name: 'User', content: 'user msg', timestamp: '2024-01-01T00:00:01.000Z',
    });
    storeMessageDirect({
      id: 'd1', chat_jid: 'group@g.us', sender: 'dashboard',
      sender_name: 'You (Dashboard)', content: 'dashboard msg',
      timestamp: '2024-01-01T00:00:02.000Z', is_from_me: true,
    });
    store({
      id: 'u2', chat_jid: 'group@g.us', sender: 'user2@s.whatsapp.net',
      sender_name: 'User2', content: 'user msg 2', timestamp: '2024-01-01T00:00:03.000Z',
    });
  });

  it('getNewMessages excludes dashboard messages', () => {
    const { messages } = getNewMessages(
      ['group@g.us'],
      '2024-01-01T00:00:00.000Z',
      'Andy',
    );
    expect(messages.every((m) => m.sender !== 'dashboard')).toBe(true);
    expect(messages).toHaveLength(2);
  });

  it('getMessagesSince excludes dashboard messages', () => {
    const messages = getMessagesSince('group@g.us', '2024-01-01T00:00:00.000Z', 'Andy');
    expect(messages.every((m) => m.sender !== 'dashboard')).toBe(true);
    expect(messages).toHaveLength(2);
  });
});

// --- getRecentMessages rowid ordering ---

describe('getRecentMessages', () => {
  it('returns messages in insertion order (rowid), not timestamp order', () => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');

    // Dashboard message with ms-precision timestamp (later in clock time)
    storeMessageDirect({
      id: 'dash-1', chat_jid: 'group@g.us', sender: 'dashboard',
      sender_name: 'You', content: 'user question',
      timestamp: '2024-01-01T00:00:33.709Z', is_from_me: true,
    });

    // Bot response with second-precision timestamp (earlier in clock time but inserted after)
    storeMessage({
      id: 'bot-1', chat_jid: 'group@g.us', sender: 'bot',
      sender_name: 'Bot', content: 'bot response',
      timestamp: '2024-01-01T00:00:33.000Z', is_bot_message: true,
    });

    const msgs = getRecentMessages(10, 'group@g.us');
    // rowid DESC: bot-1 (inserted last) comes first, then dash-1
    expect(msgs[0].id).toBe('bot-1');
    expect(msgs[1].id).toBe('dash-1');

    // Reversed for display (oldest first): dash-1, then bot-1
    const display = [...msgs].reverse();
    expect(display[0].id).toBe('dash-1');
    expect(display[1].id).toBe('bot-1');
  });

  it('filters by chat_jid when provided', () => {
    storeChatMetadata('g1@g.us', '2024-01-01T00:00:00.000Z');
    storeChatMetadata('g2@g.us', '2024-01-01T00:00:00.000Z');

    store({
      id: 'x1', chat_jid: 'g1@g.us', sender: 'user@s.whatsapp.net',
      sender_name: 'User', content: 'g1', timestamp: '2024-01-01T00:00:01.000Z',
    });
    store({
      id: 'x2', chat_jid: 'g2@g.us', sender: 'user@s.whatsapp.net',
      sender_name: 'User', content: 'g2', timestamp: '2024-01-01T00:00:02.000Z',
    });

    const msgs = getRecentMessages(10, 'g1@g.us');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].chat_jid).toBe('g1@g.us');
  });
});

// --- Scheduler: once-task completion ---

describe('scheduler once-task pre-completion', () => {
  it('updateTask sets status to completed for once-tasks', () => {
    createTask({
      id: 'once-1',
      group_folder: 'main',
      chat_jid: 'group@g.us',
      prompt: 'run once',
      schedule_type: 'once',
      schedule_value: '2024-06-01T00:00:00.000Z',
      context_mode: 'isolated',
      model: null,
      next_run: '2024-06-01T00:00:00.000Z',
      status: 'active',
      created_at: '2024-01-01T00:00:00.000Z',
    });

    // Simulate what the scheduler does when computeNextRun returns null
    updateTask('once-1', { status: 'completed' });

    const task = getTaskById('once-1');
    expect(task!.status).toBe('completed');
  });
});

// ── Tool Policies ──

describe('tool policies', () => {
  it('upsertToolPolicy inserts new policy', () => {
    upsertToolPolicy('ceo', 'Bash', 'allow');
    const policies = getToolPolicies('ceo');
    expect(policies).toHaveLength(1);
    expect(policies[0].tool_pattern).toBe('Bash');
    expect(policies[0].action).toBe('allow');
  });

  it('upsertToolPolicy updates existing policy', () => {
    upsertToolPolicy('ceo', 'Bash', 'allow');
    upsertToolPolicy('ceo', 'Bash', 'deny');
    const policies = getToolPolicies('ceo');
    expect(policies).toHaveLength(1);
    expect(policies[0].action).toBe('deny');
  });

  it('getToolPolicies returns sorted by pattern', () => {
    upsertToolPolicy('ceo', 'Write', 'allow');
    upsertToolPolicy('ceo', 'Bash', 'deny');
    upsertToolPolicy('ceo', 'Read', 'ask');
    const policies = getToolPolicies('ceo');
    expect(policies.map((p) => p.tool_pattern)).toEqual(['Bash', 'Read', 'Write']);
  });

  it('getToolPolicies filters by group', () => {
    upsertToolPolicy('ceo', 'Bash', 'allow');
    upsertToolPolicy('legal', 'Bash', 'deny');
    expect(getToolPolicies('ceo')).toHaveLength(1);
    expect(getToolPolicies('legal')).toHaveLength(1);
    expect(getToolPolicies('finance')).toHaveLength(0);
  });

  it('deleteToolPolicy returns true on delete', () => {
    upsertToolPolicy('ceo', 'Bash', 'allow');
    expect(deleteToolPolicy('ceo', 'Bash')).toBe(true);
    expect(getToolPolicies('ceo')).toHaveLength(0);
  });

  it('deleteToolPolicy returns false if not found', () => {
    expect(deleteToolPolicy('ceo', 'Bash')).toBe(false);
  });

  it('matchToolPolicy returns exact match', () => {
    upsertToolPolicy('ceo', 'Bash', 'allow');
    expect(matchToolPolicy('ceo', 'Bash')).toBe('allow');
  });

  it('matchToolPolicy returns glob match', () => {
    upsertToolPolicy('ceo', 'mcp__google__*', 'allow');
    expect(matchToolPolicy('ceo', 'mcp__google__list_events')).toBe('allow');
    expect(matchToolPolicy('ceo', 'mcp__google__send_email')).toBe('allow');
  });

  it('matchToolPolicy exact takes priority over glob', () => {
    upsertToolPolicy('ceo', 'mcp__google__*', 'allow');
    upsertToolPolicy('ceo', 'mcp__google__send_email', 'deny');
    expect(matchToolPolicy('ceo', 'mcp__google__send_email')).toBe('deny');
    expect(matchToolPolicy('ceo', 'mcp__google__list_events')).toBe('allow');
  });

  it('matchToolPolicy returns null when no match', () => {
    upsertToolPolicy('ceo', 'Bash', 'allow');
    expect(matchToolPolicy('ceo', 'Read')).toBeNull();
  });
});

// ── Sessions ──

describe('sessions', () => {
  it('setSession and getSession round-trip', () => {
    setSession('ceo', 'session-123');
    expect(getSession('ceo')).toBe('session-123');
  });

  it('getSession returns undefined for unknown group', () => {
    expect(getSession('nonexistent')).toBeUndefined();
  });

  it('setSession overwrites existing', () => {
    setSession('ceo', 'old');
    setSession('ceo', 'new');
    expect(getSession('ceo')).toBe('new');
  });

});
