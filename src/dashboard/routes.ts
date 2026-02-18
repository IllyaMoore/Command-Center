import { IncomingMessage, ServerResponse } from 'http';

import { getActivity, streamActivity } from './api/activity.js';
import { getCalendarEvents } from './api/calendar.js';
import { sendChatMessage, streamChatMessages } from './api/chat.js';

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

  // Activity endpoints
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

  // Calendar endpoints
  if (pathname === '/api/calendar/events' && method === 'GET') {
    const view = (url.searchParams.get('view') || 'day') as 'day' | 'week';
    const events = await getCalendarEvents(view);
    json(events);
    return;
  }

  // Chat endpoints
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

  // Health check
  if (pathname === '/api/health' && method === 'GET') {
    json({ status: 'ok', timestamp: new Date().toISOString() });
    return;
  }

  // 404 for unknown API routes
  json({ error: 'Not found' }, 404);
}
