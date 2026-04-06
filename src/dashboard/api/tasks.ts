import { CronExpressionParser } from 'cron-parser';

import { isValidModel } from '../../config.js';
import { logger } from '../../logger.js';
import {
  createTask as dbCreateTask,
  deleteTask as dbDeleteTask,
  getAllTasks,
  getTaskById,
  getTasksForGroup,
  getRecentTaskRuns,
  getTimezone,
  updateTask as dbUpdateTask,
} from '../../db.js';
import { ScheduledTask, TaskRunLog } from '../../types.js';
import { getDashboardQueue } from '../context.js';

// ─── GET /api/tasks ───

export function getTasks(
  group: string | null,
  runsLimit: number,
): Array<ScheduledTask & { recent_runs: TaskRunLog[] }> {
  const tasks = group ? getTasksForGroup(group) : getAllTasks();
  const allRuns = getRecentTaskRuns(tasks.length * runsLimit);

  const runsByTask = new Map<string, TaskRunLog[]>();
  for (const run of allRuns) {
    const existing = runsByTask.get(run.task_id) || [];
    existing.push(run);
    runsByTask.set(run.task_id, existing);
  }

  return tasks.map((task) => ({
    ...task,
    recent_runs: (runsByTask.get(task.id) || []).slice(0, runsLimit),
  }));
}

// ─── POST /api/tasks ───

export function createNewTask(body: Partial<ScheduledTask>): {
  data?: unknown;
  error?: string;
  status: number;
} {
  const { group_folder, chat_jid, prompt, schedule_type, schedule_value, context_mode, model } = body;

  if (!group_folder || !chat_jid || !prompt || !schedule_type || !schedule_value) {
    return { error: 'group_folder, chat_jid, prompt, schedule_type, and schedule_value are required', status: 400 };
  }

  if (!['cron', 'interval', 'once'].includes(schedule_type)) {
    return { error: 'schedule_type must be cron, interval, or once', status: 400 };
  }

  let next_run: string | null = null;
  try {
    next_run = computeNextRunFromValues(schedule_type, schedule_value);
  } catch (err) {
    return { error: `Invalid schedule: ${err instanceof Error ? err.message : err}`, status: 400 };
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

  dbCreateTask(task);
  logger.info({ id, group_folder }, 'Task created via dashboard');
  return { data: getTaskById(id), status: 201 };
}

// ─── PATCH /api/tasks/:id ───

export function patchTask(
  id: string,
  body: Record<string, unknown>,
): { data?: unknown; error?: string; status: number } {
  const existing = getTaskById(id);
  if (!existing) {
    return { error: 'Task not found', status: 404 };
  }

  const updates: Parameters<typeof dbUpdateTask>[1] = {};

  if (body.prompt !== undefined) updates.prompt = body.prompt as string;
  if (body.schedule_type !== undefined) updates.schedule_type = body.schedule_type as ScheduledTask['schedule_type'];
  if (body.schedule_value !== undefined) updates.schedule_value = body.schedule_value as string;
  if (body.status !== undefined) updates.status = body.status as ScheduledTask['status'];

  const newType = updates.schedule_type || existing.schedule_type;
  const newValue = updates.schedule_value || existing.schedule_value;
  if (updates.status === 'paused') {
    updates.next_run = null;
  } else if (updates.schedule_type || updates.schedule_value || updates.status === 'active') {
    try {
      updates.next_run = computeNextRunFromValues(newType, newValue);
    } catch (err) {
      return { error: `Invalid schedule: ${err instanceof Error ? err.message : err}`, status: 400 };
    }
  }

  dbUpdateTask(id, updates);
  logger.info({ id }, 'Task updated via dashboard');
  return { data: getTaskById(id), status: 200 };
}

// ─── DELETE /api/tasks/:id ───

export function removeTask(id: string): { data?: unknown; error?: string; status: number } {
  const existing = getTaskById(id);
  if (!existing) {
    return { error: 'Task not found', status: 404 };
  }
  dbDeleteTask(id);
  logger.info({ id }, 'Task deleted via dashboard');
  return { data: { deleted: true }, status: 200 };
}

// ─── POST /api/tasks/:id/run ───

export function triggerTask(id: string): { data?: unknown; error?: string; status: number } {
  const existing = getTaskById(id);
  if (!existing) {
    return { error: 'Task not found', status: 404 };
  }
  const queue = getDashboardQueue();
  if (!queue) {
    return { error: 'Queue not available', status: 503 };
  }
  dbUpdateTask(id, { next_run: new Date().toISOString(), status: 'active' });
  logger.info({ id }, 'Task triggered manually via dashboard');
  return { data: { triggered: true, task_id: id }, status: 200 };
}

// ─── Helper ───

function computeNextRunFromValues(scheduleType: string, scheduleValue: string): string | null {
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
