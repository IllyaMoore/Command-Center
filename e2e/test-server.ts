/**
 * Lightweight test server for Playwright e2e tests.
 * Initialises an in-memory SQLite database, seeds it with test data,
 * and starts the dashboard HTTP server on port 3001.
 */
import {
  _initTestDatabase,
  setRegisteredGroup,
  storeChatMetadata,
  storeMessage,
} from '../src/db.js';
import { startDashboardServer, stopDashboardServer } from '../src/dashboard/server.js';

const TEST_PORT = 3001;
const CEO_JID = 'ceo-test@g.us';

// --- Initialise test DB ---
_initTestDatabase();

// Register a CEO group so chat endpoints work
storeChatMetadata(CEO_JID, '2024-01-01T00:00:00.000Z', 'CEO Group');
setRegisteredGroup(CEO_JID, {
  name: 'CEO Group',
  folder: 'ceo',
  trigger: '@Andy',
  added_at: '2024-01-01T00:00:00.000Z',
});

// Seed a few chat messages so SSE initial payload has data
storeMessage({
  id: 'seed-1',
  chat_jid: CEO_JID,
  sender: 'user@s.whatsapp.net',
  sender_name: 'Illya',
  content: 'Hello from the test',
  timestamp: '2024-06-01T10:00:00.000Z',
  is_from_me: false,
});

storeMessage({
  id: 'seed-2',
  chat_jid: CEO_JID,
  sender: 'bot',
  sender_name: 'CEO Agent',
  content: 'Hi! How can I help you today?',
  timestamp: '2024-06-01T10:00:05.000Z',
  is_from_me: true,
  is_bot_message: true,
});

// --- Start server ---
const server = startDashboardServer(TEST_PORT);

// Graceful shutdown
process.on('SIGTERM', async () => {
  await stopDashboardServer();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await stopDashboardServer();
  process.exit(0);
});

console.log(`Test server listening on http://localhost:${TEST_PORT}`);
