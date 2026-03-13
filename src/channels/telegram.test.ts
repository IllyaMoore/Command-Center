import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// --- Mocks ---

vi.mock('./registry.js', () => ({ registerChannel: vi.fn() }));
vi.mock('../env.js', () => ({ readEnvFile: vi.fn(() => ({})) }));
vi.mock('../db.js', () => ({ setRegisteredGroup: vi.fn(), storeMessageDirect: vi.fn() }));
vi.mock('../config.js', () => ({
  ASSISTANT_NAME: 'Andy',
  TRIGGER_PATTERN: /^@Andy\b/i,
}));
vi.mock('../logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// --- Grammy mock ---

type Handler = (...args: any[]) => any;

const botRef = vi.hoisted(() => ({ current: null as any }));

vi.mock('grammy', () => ({
  Bot: class MockBot {
    token: string;
    commandHandlers = new Map<string, Handler>();
    filterHandlers = new Map<string, Handler[]>();
    errorHandler: Handler | null = null;

    api = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
      sendChatAction: vi.fn().mockResolvedValue(undefined),
    };

    constructor(token: string) {
      this.token = token;
      botRef.current = this;
    }

    command(name: string, handler: Handler) {
      this.commandHandlers.set(name, handler);
    }

    on(filter: string, handler: Handler) {
      const existing = this.filterHandlers.get(filter) || [];
      existing.push(handler);
      this.filterHandlers.set(filter, existing);
    }

    catch(handler: Handler) {
      this.errorHandler = handler;
    }

    start(opts: { onStart: (botInfo: any) => void }) {
      opts.onStart({ username: 'andy_ai_bot', id: 12345 });
      return Promise.resolve();
    }

    stop() { return Promise.resolve(); }
  },
}));

import { TelegramChannel } from './telegram.js';
import type { ChannelOpts } from './registry.js';

// --- Test helpers ---

function createTestOpts(overrides?: Partial<ChannelOpts>): ChannelOpts {
  return {
    onMessage: vi.fn(),
    onChatMetadata: vi.fn(),
    registeredGroups: vi.fn(() => ({
      'tg:100200300': {
        name: 'Test Group',
        folder: 'test-group',
        trigger: '@Andy',
        added_at: '2024-01-01T00:00:00.000Z',
      },
    })),
    ...overrides,
  };
}

function createTextCtx(overrides: {
  chatId?: number;
  chatType?: string;
  chatTitle?: string;
  text: string;
  fromId?: number;
  firstName?: string;
  username?: string;
  messageId?: number;
  date?: number;
  entities?: any[];
}) {
  const chatId = overrides.chatId ?? 100200300;
  const chatType = overrides.chatType ?? 'group';
  return {
    chat: { id: chatId, type: chatType, title: overrides.chatTitle ?? 'Test Group' },
    from: {
      id: overrides.fromId ?? 99001,
      first_name: overrides.firstName ?? 'Alice',
      username: overrides.username ?? 'alice_user',
    },
    message: {
      text: overrides.text,
      date: overrides.date ?? Math.floor(Date.now() / 1000),
      message_id: overrides.messageId ?? 1,
      entities: overrides.entities ?? [],
    },
    me: { username: 'andy_ai_bot' },
    reply: vi.fn(),
  };
}

function createMediaCtx(overrides: {
  chatId?: number;
  chatType?: string;
  fromId?: number;
  firstName?: string;
  date?: number;
  messageId?: number;
  caption?: string;
  extra?: Record<string, any>;
}) {
  const chatId = overrides.chatId ?? 100200300;
  return {
    chat: { id: chatId, type: overrides.chatType ?? 'group', title: 'Test Group' },
    from: {
      id: overrides.fromId ?? 99001,
      first_name: overrides.firstName ?? 'Alice',
      username: 'alice_user',
    },
    message: {
      date: overrides.date ?? Math.floor(Date.now() / 1000),
      message_id: overrides.messageId ?? 1,
      caption: overrides.caption,
      ...(overrides.extra || {}),
    },
    me: { username: 'andy_ai_bot' },
  };
}

function currentBot() {
  return botRef.current;
}

async function triggerTextMessage(ctx: ReturnType<typeof createTextCtx>) {
  const handlers = currentBot().filterHandlers.get('message:text') || [];
  for (const h of handlers) await h(ctx);
}

async function triggerMediaMessage(filter: string, ctx: ReturnType<typeof createMediaCtx>) {
  const handlers = currentBot().filterHandlers.get(filter) || [];
  for (const h of handlers) await h(ctx);
}

// --- Tests ---

describe('TelegramChannel', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  describe('connection lifecycle', () => {
    it('resolves connect() when bot starts', async () => {
      const channel = new TelegramChannel('test-token', createTestOpts());
      await channel.connect();
      expect(channel.isConnected()).toBe(true);
    });

    it('registers command and message handlers on connect', async () => {
      const channel = new TelegramChannel('test-token', createTestOpts());
      await channel.connect();
      expect(currentBot().commandHandlers.has('chatid')).toBe(true);
      expect(currentBot().commandHandlers.has('ping')).toBe(true);
      expect(currentBot().filterHandlers.has('message:text')).toBe(true);
      expect(currentBot().filterHandlers.has('message:photo')).toBe(true);
    });

    it('disconnects cleanly', async () => {
      const channel = new TelegramChannel('test-token', createTestOpts());
      await channel.connect();
      expect(channel.isConnected()).toBe(true);
      await channel.disconnect();
      expect(channel.isConnected()).toBe(false);
    });

    it('isConnected() returns false before connect', () => {
      const channel = new TelegramChannel('test-token', createTestOpts());
      expect(channel.isConnected()).toBe(false);
    });

    it('ignores duplicate connect() calls', async () => {
      const { logger } = await import('../logger.js');
      const channel = new TelegramChannel('test-token', createTestOpts());
      await channel.connect();
      await channel.connect(); // second call — should be no-op
      expect(logger.warn).toHaveBeenCalledWith(
        'Telegram bot already running, ignoring connect() call',
      );
    });
  });

  describe('text message handling', () => {
    it('delivers message for registered group', async () => {
      const opts = createTestOpts();
      const channel = new TelegramChannel('test-token', opts);
      await channel.connect();

      const ctx = createTextCtx({ text: 'Hello everyone' });
      await triggerTextMessage(ctx);

      expect(opts.onChatMetadata).toHaveBeenCalledWith(
        'tg:100200300', expect.any(String), 'Test Group',
      );
      expect(opts.onMessage).toHaveBeenCalledWith(
        'tg:100200300',
        expect.objectContaining({
          id: '1', chat_jid: 'tg:100200300', sender: '99001',
          sender_name: 'Alice', content: 'Hello everyone', is_from_me: false,
        }),
      );
    });

    it('only emits metadata for unregistered chats', async () => {
      const opts = createTestOpts();
      const channel = new TelegramChannel('test-token', opts);
      await channel.connect();

      const ctx = createTextCtx({ chatId: 999999, text: 'Unknown chat' });
      await triggerTextMessage(ctx);

      expect(opts.onChatMetadata).toHaveBeenCalledWith(
        'tg:999999', expect.any(String), 'Test Group',
      );
      expect(opts.onMessage).not.toHaveBeenCalled();
    });

    it('skips command messages (starting with /)', async () => {
      const opts = createTestOpts();
      const channel = new TelegramChannel('test-token', opts);
      await channel.connect();

      const ctx = createTextCtx({ text: '/start' });
      await triggerTextMessage(ctx);

      expect(opts.onMessage).not.toHaveBeenCalled();
      expect(opts.onChatMetadata).not.toHaveBeenCalled();
    });

    it('uses sender name as chat name for private chats', async () => {
      const opts = createTestOpts({
        registeredGroups: vi.fn(() => ({
          'tg:100200300': {
            name: 'Private', folder: 'private',
            trigger: '@Andy', added_at: '2024-01-01T00:00:00.000Z',
          },
        })),
      });
      const channel = new TelegramChannel('test-token', opts);
      await channel.connect();

      const ctx = createTextCtx({ text: 'Hello', chatType: 'private', firstName: 'Alice' });
      await triggerTextMessage(ctx);

      expect(opts.onChatMetadata).toHaveBeenCalledWith(
        'tg:100200300', expect.any(String), 'Alice',
      );
    });

    it('converts message.date to ISO timestamp', async () => {
      const opts = createTestOpts();
      const channel = new TelegramChannel('test-token', opts);
      await channel.connect();

      const ctx = createTextCtx({ text: 'Hello', date: 1704067200 });
      await triggerTextMessage(ctx);

      expect(opts.onMessage).toHaveBeenCalledWith(
        'tg:100200300',
        expect.objectContaining({ timestamp: '2024-01-01T00:00:00.000Z' }),
      );
    });
  });

  describe('@mention translation', () => {
    it('translates @bot_username mention to trigger format', async () => {
      const opts = createTestOpts();
      const channel = new TelegramChannel('test-token', opts);
      await channel.connect();

      const ctx = createTextCtx({
        text: '@andy_ai_bot what time is it?',
        entities: [{ type: 'mention', offset: 0, length: 12 }],
      });
      await triggerTextMessage(ctx);

      expect(opts.onMessage).toHaveBeenCalledWith(
        'tg:100200300',
        expect.objectContaining({ content: '@Andy what time is it?' }),
      );
    });

    it('does not translate if message already matches trigger', async () => {
      const opts = createTestOpts();
      const channel = new TelegramChannel('test-token', opts);
      await channel.connect();

      const ctx = createTextCtx({
        text: '@Andy @andy_ai_bot hello',
        entities: [{ type: 'mention', offset: 6, length: 12 }],
      });
      await triggerTextMessage(ctx);

      expect(opts.onMessage).toHaveBeenCalledWith(
        'tg:100200300',
        expect.objectContaining({ content: '@Andy @andy_ai_bot hello' }),
      );
    });

    it('does not translate mentions of other bots', async () => {
      const opts = createTestOpts();
      const channel = new TelegramChannel('test-token', opts);
      await channel.connect();

      const ctx = createTextCtx({
        text: '@some_other_bot hi',
        entities: [{ type: 'mention', offset: 0, length: 15 }],
      });
      await triggerTextMessage(ctx);

      expect(opts.onMessage).toHaveBeenCalledWith(
        'tg:100200300',
        expect.objectContaining({ content: '@some_other_bot hi' }),
      );
    });
  });

  describe('non-text messages', () => {
    it('stores photo with placeholder', async () => {
      const opts = createTestOpts();
      const channel = new TelegramChannel('test-token', opts);
      await channel.connect();

      await triggerMediaMessage('message:photo', createMediaCtx({}));
      expect(opts.onMessage).toHaveBeenCalledWith(
        'tg:100200300', expect.objectContaining({ content: '[Photo]' }),
      );
    });

    it('stores photo with caption', async () => {
      const opts = createTestOpts();
      const channel = new TelegramChannel('test-token', opts);
      await channel.connect();

      await triggerMediaMessage('message:photo', createMediaCtx({ caption: 'Look at this' }));
      expect(opts.onMessage).toHaveBeenCalledWith(
        'tg:100200300', expect.objectContaining({ content: '[Photo] Look at this' }),
      );
    });

    it('stores document with filename', async () => {
      const opts = createTestOpts();
      const channel = new TelegramChannel('test-token', opts);
      await channel.connect();

      await triggerMediaMessage('message:document', createMediaCtx({
        extra: { document: { file_name: 'report.pdf' } },
      }));
      expect(opts.onMessage).toHaveBeenCalledWith(
        'tg:100200300', expect.objectContaining({ content: '[Document: report.pdf]' }),
      );
    });

    it('stores sticker with emoji', async () => {
      const opts = createTestOpts();
      const channel = new TelegramChannel('test-token', opts);
      await channel.connect();

      await triggerMediaMessage('message:sticker', createMediaCtx({
        extra: { sticker: { emoji: '😂' } },
      }));
      expect(opts.onMessage).toHaveBeenCalledWith(
        'tg:100200300', expect.objectContaining({ content: '[Sticker 😂]' }),
      );
    });

    it('ignores non-text messages from unregistered chats', async () => {
      const opts = createTestOpts();
      const channel = new TelegramChannel('test-token', opts);
      await channel.connect();

      await triggerMediaMessage('message:photo', createMediaCtx({ chatId: 999999 }));
      expect(opts.onMessage).not.toHaveBeenCalled();
    });
  });

  describe('sendMessage', () => {
    it('sends message via bot API with Markdown', async () => {
      const opts = createTestOpts();
      const channel = new TelegramChannel('test-token', opts);
      await channel.connect();

      await channel.sendMessage('tg:100200300', 'Hello');
      expect(currentBot().api.sendMessage).toHaveBeenCalledWith(
        '100200300', 'Hello', { parse_mode: 'Markdown' },
      );
    });

    it('stores sent message in DB for dashboard', async () => {
      const { storeMessageDirect } = await import('../db.js');
      const channel = new TelegramChannel('test-token', createTestOpts());
      await channel.connect();

      await channel.sendMessage('tg:100200300', 'Hello');
      expect(storeMessageDirect).toHaveBeenCalledWith(
        expect.objectContaining({
          chat_jid: 'tg:100200300',
          sender: 'bot',
          content: 'Hello',
          is_from_me: true,
          is_bot_message: true,
        }),
      );
    });

    it('stores full text once for chunked messages', async () => {
      const { storeMessageDirect } = await import('../db.js');
      (storeMessageDirect as ReturnType<typeof vi.fn>).mockClear();
      const channel = new TelegramChannel('test-token', createTestOpts());
      await channel.connect();

      const longText = 'x'.repeat(5000);
      await channel.sendMessage('tg:100200300', longText);
      expect(storeMessageDirect).toHaveBeenCalledTimes(1);
      expect(storeMessageDirect).toHaveBeenCalledWith(
        expect.objectContaining({ content: longText }),
      );
    });

    it('strips tg: prefix from JID', async () => {
      const channel = new TelegramChannel('test-token', createTestOpts());
      await channel.connect();

      await channel.sendMessage('tg:-1001234567890', 'Group message');
      expect(currentBot().api.sendMessage).toHaveBeenCalledWith(
        '-1001234567890', 'Group message', { parse_mode: 'Markdown' },
      );
    });

    it('splits messages exceeding 4096 characters', async () => {
      const channel = new TelegramChannel('test-token', createTestOpts());
      await channel.connect();

      await channel.sendMessage('tg:100200300', 'x'.repeat(5000));
      expect(currentBot().api.sendMessage).toHaveBeenCalledTimes(2);
    });

    it('propagates send errors to caller', async () => {
      const channel = new TelegramChannel('test-token', createTestOpts());
      await channel.connect();
      currentBot().api.sendMessage.mockRejectedValueOnce(new Error('Network error'));

      await expect(channel.sendMessage('tg:100200300', 'Will fail')).rejects.toThrow('Network error');
    });

    it('throws when bot is not initialized', async () => {
      const channel = new TelegramChannel('test-token', createTestOpts());
      await expect(channel.sendMessage('tg:100200300', 'No bot')).rejects.toThrow('not initialized');
    });

    it('falls back to plain text on Markdown parse error', async () => {
      const channel = new TelegramChannel('test-token', createTestOpts());
      await channel.connect();
      currentBot().api.sendMessage
        .mockRejectedValueOnce(new Error("can't parse entities: ..."))
        .mockResolvedValueOnce(undefined);

      await channel.sendMessage('tg:100200300', 'Bad *markdown');
      expect(currentBot().api.sendMessage).toHaveBeenCalledTimes(2);
      // Second call should be plain text (no parse_mode)
      expect(currentBot().api.sendMessage).toHaveBeenLastCalledWith('100200300', 'Bad *markdown');
    });

    it('does not fall back on non-parse errors', async () => {
      const channel = new TelegramChannel('test-token', createTestOpts());
      await channel.connect();
      currentBot().api.sendMessage.mockRejectedValueOnce(new Error('Forbidden: bot was blocked'));

      await expect(channel.sendMessage('tg:100200300', 'Hello')).rejects.toThrow('Forbidden');
      expect(currentBot().api.sendMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('ownsJid', () => {
    it('owns tg: JIDs', () => {
      const channel = new TelegramChannel('test-token', createTestOpts());
      expect(channel.ownsJid('tg:123456')).toBe(true);
    });

    it('owns tg: JIDs with negative IDs (groups)', () => {
      const channel = new TelegramChannel('test-token', createTestOpts());
      expect(channel.ownsJid('tg:-1001234567890')).toBe(true);
    });

    it('does not own WhatsApp JIDs', () => {
      const channel = new TelegramChannel('test-token', createTestOpts());
      expect(channel.ownsJid('12345@g.us')).toBe(false);
      expect(channel.ownsJid('12345@s.whatsapp.net')).toBe(false);
    });
  });

  describe('setTyping', () => {
    it('sends typing action when isTyping is true', async () => {
      const channel = new TelegramChannel('test-token', createTestOpts());
      await channel.connect();

      await channel.setTyping('tg:100200300', true);
      expect(currentBot().api.sendChatAction).toHaveBeenCalledWith('100200300', 'typing');
    });

    it('does nothing when isTyping is false', async () => {
      const channel = new TelegramChannel('test-token', createTestOpts());
      await channel.connect();

      await channel.setTyping('tg:100200300', false);
      expect(currentBot().api.sendChatAction).not.toHaveBeenCalled();
    });

    it('logs error but does not throw on API failure', async () => {
      const { logger } = await import('../logger.js');
      const channel = new TelegramChannel('test-token', createTestOpts());
      await channel.connect();
      currentBot().api.sendChatAction.mockRejectedValueOnce(new Error('Network error'));

      await channel.setTyping('tg:100200300', true);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ jid: 'tg:100200300' }),
        'Failed to send Telegram typing indicator',
      );
    });

    it('logs warn for 403 (bot blocked) errors', async () => {
      const { logger } = await import('../logger.js');
      const channel = new TelegramChannel('test-token', createTestOpts());
      await channel.connect();
      const err = Object.assign(new Error('Forbidden'), { error_code: 403 });
      currentBot().api.sendChatAction.mockRejectedValueOnce(err);

      await channel.setTyping('tg:100200300', true);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ jid: 'tg:100200300' }),
        'Failed to send Telegram typing indicator',
      );
    });
  });

  describe('bot commands', () => {
    it('/chatid replies with chat ID and metadata', async () => {
      const channel = new TelegramChannel('test-token', createTestOpts());
      await channel.connect();

      const handler = currentBot().commandHandlers.get('chatid')!;
      const ctx = {
        chat: { id: 100200300, type: 'group' as const },
        from: { first_name: 'Alice' },
        reply: vi.fn(),
      };
      await handler(ctx);

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('tg:100200300'),
        expect.objectContaining({ parse_mode: 'Markdown' }),
      );
    });

    it('/ping replies with bot status', async () => {
      const channel = new TelegramChannel('test-token', createTestOpts());
      await channel.connect();

      const handler = currentBot().commandHandlers.get('ping')!;
      const ctx = { reply: vi.fn() };
      await handler(ctx);

      expect(ctx.reply).toHaveBeenCalledWith('Andy is online.');
    });
  });

  describe('DB callback error resilience', () => {
    it('logs error when onChatMetadata throws', async () => {
      const { logger } = await import('../logger.js');
      const opts = createTestOpts({
        onChatMetadata: vi.fn(() => { throw new Error('DB locked'); }),
      });
      const channel = new TelegramChannel('test-token', opts);
      await channel.connect();

      const ctx = createTextCtx({ text: 'Hello' });
      await triggerTextMessage(ctx);

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ chatJid: 'tg:100200300' }),
        'Failed to store Telegram chat metadata',
      );
      // onMessage should still be attempted (metadata error is non-fatal for message storage)
      expect(opts.onMessage).toHaveBeenCalled();
    });

    it('logs error and skips when onMessage throws', async () => {
      const { logger } = await import('../logger.js');
      const opts = createTestOpts({
        onMessage: vi.fn(() => { throw new Error('DB locked'); }),
      });
      const channel = new TelegramChannel('test-token', opts);
      await channel.connect();

      const ctx = createTextCtx({ text: 'Hello' });
      await triggerTextMessage(ctx);

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ chatJid: 'tg:100200300', msgId: '1' }),
        'Failed to store Telegram message',
      );
    });

    it('logs error when storeNonText DB callbacks throw', async () => {
      const { logger } = await import('../logger.js');
      const opts = createTestOpts({
        onMessage: vi.fn(() => { throw new Error('DB locked'); }),
      });
      const channel = new TelegramChannel('test-token', opts);
      await channel.connect();

      await triggerMediaMessage('message:photo', createMediaCtx({}));

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ chatJid: 'tg:100200300', placeholder: '[Photo]' }),
        'Failed to store Telegram non-text message',
      );
    });
  });

  describe('disconnect error handling', () => {
    it('handles bot.stop() failure gracefully', async () => {
      const { logger } = await import('../logger.js');
      const channel = new TelegramChannel('test-token', createTestOpts());
      await channel.connect();

      // Make bot.stop() throw
      const bot = currentBot();
      bot.stop = vi.fn().mockRejectedValue(new Error('stop failed'));

      await channel.disconnect();
      expect(channel.isConnected()).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'Error stopping Telegram bot',
      );
    });
  });

  describe('channel properties', () => {
    it('has name "telegram"', () => {
      const channel = new TelegramChannel('test-token', createTestOpts());
      expect(channel.name).toBe('telegram');
    });

    it('throws on empty bot token', () => {
      expect(() => new TelegramChannel('', createTestOpts())).toThrow('bot token is required');
    });
  });
});
