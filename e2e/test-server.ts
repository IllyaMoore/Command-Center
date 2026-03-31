/**
 * Lightweight test server for Playwright e2e tests.
 * Initialises an in-memory SQLite database, seeds it with test data,
 * and starts the dashboard HTTP server on port 3001.
 */
import {
  _initTestDatabase,
  setRegisteredGroup,
  storeChatMetadata,
  storeMessageDirect,
} from '../src/db.js';
import { startDashboardServer, stopDashboardServer } from '../src/dashboard/server.js';

const TEST_PORT = 3001;

// --- Initialise test DB ---
_initTestDatabase();

// Register test agents
const agents = [
  { jid: 'dashboard-ceo', name: 'CEO', folder: 'ceo', trigger: '@CEO' },
  { jid: 'dashboard-legal', name: 'Legal', folder: 'legal', trigger: '@Legal' },
  { jid: 'dashboard-finance', name: 'Finance', folder: 'finance', trigger: '@Finance' },
];

for (const a of agents) {
  storeChatMetadata(a.jid, '2024-01-01T00:00:00.000Z', a.name);
  setRegisteredGroup(a.jid, {
    name: a.name,
    folder: a.folder,
    trigger: a.trigger,
    added_at: '2024-01-01T00:00:00.000Z',
  });
}

// Seed chat messages for CEO
storeMessageDirect({
  id: 'seed-1',
  chat_jid: 'dashboard-ceo',
  sender: 'dashboard',
  sender_name: 'You (Dashboard)',
  content: 'Hello from the test',
  timestamp: '2024-06-01T10:00:00.000Z',
  is_from_me: true,
});

storeMessageDirect({
  id: 'seed-2',
  chat_jid: 'dashboard-ceo',
  sender: 'ceo',
  sender_name: 'CEO',
  content: 'Hi! How can I help you today?',
  timestamp: '2024-06-01T10:00:05.000Z',
  is_from_me: false,
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
