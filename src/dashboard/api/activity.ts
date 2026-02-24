import { IncomingMessage, ServerResponse } from 'http';

import { getRecentActivity, ActivityItem } from '../../db.js';
import { logger } from '../../logger.js';

// Main group folder name - messages/tasks filtered to this
const CEO_GROUP = 'ceo';

export async function getActivity(limit: number = 50): Promise<ActivityItem[]> {
  try {
    const activity = getRecentActivity(limit, CEO_GROUP);
    return activity;
  } catch (err) {
    logger.error({ err }, 'Error fetching activity');
    return [];
  }
}

// SSE stream for real-time activity updates
export async function streamActivity(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Send initial activity
  const initialActivity = await getActivity(20);
  res.write(`data: ${JSON.stringify({ type: 'initial', items: initialActivity })}\n\n`);

  // Keep track of the last timestamp we've seen
  let lastTimestamp = initialActivity.length > 0 ? initialActivity[0].timestamp : new Date().toISOString();

  // Poll for new activity every 2 seconds
  const interval = setInterval(async () => {
    try {
      const activity = await getActivity(10);
      const newItems = activity.filter((item) => item.timestamp > lastTimestamp);

      if (newItems.length > 0) {
        lastTimestamp = newItems[0].timestamp;
        res.write(`data: ${JSON.stringify({ type: 'update', items: newItems })}\n\n`);
      }

      // Send heartbeat to keep connection alive
      res.write(': heartbeat\n\n');
    } catch (err) {
      logger.error({ err }, 'Error in activity stream');
    }
  }, 2000);

  // Clean up on client disconnect
  req.on('close', () => {
    clearInterval(interval);
    logger.debug('Activity stream closed');
  });
}
