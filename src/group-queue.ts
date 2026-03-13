import { ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';

import { DAILY_API_LIMIT, DATA_DIR, MAX_CONCURRENT_CONTAINERS } from './config.js';
import { logger } from './logger.js';
import { killProcessGroup } from './process-utils.js';

interface QueuedTask {
  id: string;
  groupJid: string;
  fn: () => Promise<void>;
}

const MAX_RETRIES = 5;
const BASE_RETRY_MS = 5000;

interface GroupState {
  active: boolean;
  pendingMessages: boolean;
  pendingTasks: QueuedTask[];
  process: ChildProcess | null;
  containerName: string | null;
  groupFolder: string | null;
  currentTaskId: string | null;
  retryCount: number;
}

export interface AgentStatus {
  jid: string;
  active: boolean;
  containerName: string | null;
  groupFolder: string | null;
  currentTaskId: string | null;
  pendingMessages: boolean;
  pendingTaskCount: number;
}

export class GroupQueue {
  private groups = new Map<string, GroupState>();
  private activeCount = 0;
  private waitingGroups: string[] = [];
  private processMessagesFn: ((groupJid: string) => Promise<boolean>) | null =
    null;
  private shuttingDown = false;
  private dailyInvocations = 0;
  private dailyDate = new Date().toISOString().split('T')[0];

  private checkDailyLimit(): boolean {
    if (DAILY_API_LIMIT === 0) return true;
    const today = new Date().toISOString().split('T')[0];
    if (today !== this.dailyDate) {
      this.dailyDate = today;
      this.dailyInvocations = 0;
    }
    return this.dailyInvocations < DAILY_API_LIMIT;
  }

  private recordInvocation(): void {
    this.dailyInvocations++;
    logger.info(
      { dailyInvocations: this.dailyInvocations, dailyLimit: DAILY_API_LIMIT },
      'Agent invocation recorded',
    );
  }

  getDailyUsage(): { used: number; limit: number } {
    const today = new Date().toISOString().split('T')[0];
    if (today !== this.dailyDate) return { used: 0, limit: DAILY_API_LIMIT };
    return { used: this.dailyInvocations, limit: DAILY_API_LIMIT };
  }

  private getGroup(groupJid: string): GroupState {
    let state = this.groups.get(groupJid);
    if (!state) {
      state = {
        active: false,
        pendingMessages: false,
        pendingTasks: [],
        process: null,
        containerName: null,
        groupFolder: null,
        currentTaskId: null,
        retryCount: 0,
      };
      this.groups.set(groupJid, state);
    }
    return state;
  }

  setProcessMessagesFn(fn: (groupJid: string) => Promise<boolean>): void {
    this.processMessagesFn = fn;
  }

  enqueueMessageCheck(groupJid: string): void {
    if (this.shuttingDown) return;
    if (!this.checkDailyLimit()) {
      logger.warn(
        { groupJid, dailyInvocations: this.dailyInvocations, limit: DAILY_API_LIMIT },
        'Daily API limit reached, dropping message',
      );
      return;
    }

    const state = this.getGroup(groupJid);

    if (state.active) {
      state.pendingMessages = true;
      logger.debug({ groupJid }, 'Container active, message queued');
      return;
    }

    if (this.activeCount >= MAX_CONCURRENT_CONTAINERS) {
      state.pendingMessages = true;
      if (!this.waitingGroups.includes(groupJid)) {
        this.waitingGroups.push(groupJid);
      }
      logger.debug(
        { groupJid, activeCount: this.activeCount },
        'At concurrency limit, message queued',
      );
      return;
    }

    this.runForGroup(groupJid, 'messages');
  }

  enqueueTask(groupJid: string, taskId: string, fn: () => Promise<void>): void {
    if (this.shuttingDown) return;
    if (!this.checkDailyLimit()) {
      logger.warn(
        { groupJid, taskId, dailyInvocations: this.dailyInvocations, limit: DAILY_API_LIMIT },
        'Daily API limit reached, dropping task',
      );
      return;
    }

    const state = this.getGroup(groupJid);

    // Prevent re-queuing a task that is currently running
    if (state.currentTaskId === taskId) {
      logger.debug({ groupJid, taskId }, 'Task already running, skipping');
      return;
    }

    // Prevent double-queuing of the same task
    if (state.pendingTasks.some((t) => t.id === taskId)) {
      logger.debug({ groupJid, taskId }, 'Task already queued, skipping');
      return;
    }

    if (state.active) {
      state.pendingTasks.push({ id: taskId, groupJid, fn });
      logger.debug({ groupJid, taskId }, 'Container active, task queued');
      return;
    }

    if (this.activeCount >= MAX_CONCURRENT_CONTAINERS) {
      state.pendingTasks.push({ id: taskId, groupJid, fn });
      if (!this.waitingGroups.includes(groupJid)) {
        this.waitingGroups.push(groupJid);
      }
      logger.debug(
        { groupJid, taskId, activeCount: this.activeCount },
        'At concurrency limit, task queued',
      );
      return;
    }

    // Run immediately
    this.runTask(groupJid, { id: taskId, groupJid, fn });
  }

  registerProcess(groupJid: string, proc: ChildProcess, containerName: string, groupFolder?: string): void {
    const state = this.getGroup(groupJid);
    state.process = proc;
    state.containerName = containerName;
    if (groupFolder) state.groupFolder = groupFolder;
  }

  /**
   * Send a follow-up message to the active container via IPC file.
   * Returns true if the message was written, false if no active container.
   */
  sendMessage(groupJid: string, text: string): boolean {
    const state = this.getGroup(groupJid);
    if (!state.active || !state.groupFolder) return false;

    const inputDir = path.join(DATA_DIR, 'ipc', state.groupFolder, 'input');
    try {
      fs.mkdirSync(inputDir, { recursive: true });
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`;
      const filepath = path.join(inputDir, filename);
      const tempPath = `${filepath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify({ type: 'message', text, source: 'host' }));
      fs.renameSync(tempPath, filepath);
      return true;
    } catch (err) {
      logger.error({ err, groupJid }, 'Failed to write IPC message');
      return false;
    }
  }

  /**
   * Signal the active container to wind down by writing a close sentinel.
   */
  closeStdin(groupJid: string): void {
    const state = this.getGroup(groupJid);
    if (!state.active || !state.groupFolder) return;

    const inputDir = path.join(DATA_DIR, 'ipc', state.groupFolder, 'input');
    try {
      fs.mkdirSync(inputDir, { recursive: true });
      fs.writeFileSync(path.join(inputDir, '_close'), '');
    } catch (err) {
      logger.error({ err, groupJid }, 'Failed to write IPC close sentinel');
    }
  }

  private async runForGroup(
    groupJid: string,
    reason: 'messages' | 'drain',
  ): Promise<void> {
    const state = this.getGroup(groupJid);
    state.active = true;
    state.pendingMessages = false;
    state.currentTaskId = '_messages';
    this.activeCount++;
    this.recordInvocation();

    logger.debug(
      { groupJid, reason, activeCount: this.activeCount },
      'Starting container for group',
    );

    try {
      if (this.processMessagesFn) {
        const success = await this.processMessagesFn(groupJid);
        if (success) {
          state.retryCount = 0;
        } else {
          this.scheduleRetry(groupJid, state);
        }
      }
    } catch (err) {
      logger.error({ groupJid, err }, 'Error processing messages for group');
      this.scheduleRetry(groupJid, state);
    } finally {
      state.active = false;
      state.process = null;
      state.containerName = null;
      state.groupFolder = null;
      state.currentTaskId = null;
      this.activeCount--;
      this.drainGroup(groupJid);
    }
  }

  private async runTask(groupJid: string, task: QueuedTask): Promise<void> {
    const state = this.getGroup(groupJid);
    state.active = true;
    state.currentTaskId = task.id;
    this.activeCount++;
    this.recordInvocation();

    logger.debug(
      { groupJid, taskId: task.id, activeCount: this.activeCount },
      'Running queued task',
    );

    try {
      await task.fn();
    } catch (err) {
      logger.error({ groupJid, taskId: task.id, err }, 'Error running task');
    } finally {
      state.active = false;
      state.process = null;
      state.containerName = null;
      state.groupFolder = null;
      state.currentTaskId = null;
      this.activeCount--;
      this.drainGroup(groupJid);
    }
  }

  private scheduleRetry(groupJid: string, state: GroupState): void {
    state.retryCount++;
    if (state.retryCount > MAX_RETRIES) {
      logger.error(
        { groupJid, retryCount: state.retryCount },
        'Max retries exceeded, dropping messages (will retry on next incoming message)',
      );
      state.retryCount = 0;
      return;
    }

    const delayMs = BASE_RETRY_MS * Math.pow(2, state.retryCount - 1);
    logger.info(
      { groupJid, retryCount: state.retryCount, delayMs },
      'Scheduling retry with backoff',
    );
    setTimeout(() => {
      if (!this.shuttingDown) {
        this.enqueueMessageCheck(groupJid);
      }
    }, delayMs);
  }

  private drainGroup(groupJid: string): void {
    if (this.shuttingDown) return;

    const state = this.getGroup(groupJid);

    // Already-accepted items drain even if daily limit was hit (they passed the
    // check at enqueue time). Tasks especially cannot be re-discovered from SQLite.
    if (state.pendingTasks.length > 0) {
      const task = state.pendingTasks.shift()!;
      this.runTask(groupJid, task);
      return;
    }

    if (state.pendingMessages) {
      this.runForGroup(groupJid, 'drain');
      return;
    }

    // Nothing pending for this group; check if other groups are waiting for a slot
    // (daily limit applies here — new groups should not start if over limit)
    if (this.checkDailyLimit()) {
      this.drainWaiting();
    }
  }

  private drainWaiting(): void {
    while (
      this.waitingGroups.length > 0 &&
      this.activeCount < MAX_CONCURRENT_CONTAINERS
    ) {
      const nextJid = this.waitingGroups.shift()!;
      const state = this.getGroup(nextJid);

      // Prioritize tasks over messages
      if (state.pendingTasks.length > 0) {
        const task = state.pendingTasks.shift()!;
        this.runTask(nextJid, task);
      } else if (state.pendingMessages) {
        this.runForGroup(nextJid, 'drain');
      }
      // If neither pending, skip this group
    }
  }

  getStatus(): AgentStatus[] {
    const result: AgentStatus[] = [];
    for (const [jid, state] of this.groups) {
      result.push({
        jid,
        active: state.active,
        containerName: state.containerName,
        groupFolder: state.groupFolder,
        currentTaskId: state.currentTaskId,
        pendingMessages: state.pendingMessages,
        pendingTaskCount: state.pendingTasks.length,
      });
    }
    return result;
  }

  getActiveCount(): number {
    return this.activeCount;
  }

  async shutdown(gracePeriodMs: number): Promise<void> {
    this.shuttingDown = true;

    // Send SIGTERM to active child processes and wait for them to exit
    const activeProcesses: { name: string; proc: ChildProcess }[] = [];
    for (const [, state] of this.groups) {
      if (state.process && !state.process.killed && state.containerName) {
        activeProcesses.push({ name: state.containerName, proc: state.process });
        killProcessGroup(state.process.pid, 'SIGTERM');
      }
    }

    if (activeProcesses.length === 0) {
      logger.info('GroupQueue shutting down (no active processes)');
      return;
    }

    logger.info(
      { activeCount: activeProcesses.length, names: activeProcesses.map((p) => p.name) },
      'GroupQueue shutting down, sent SIGTERM to active processes',
    );

    // Wait up to gracePeriodMs for processes to exit
    await Promise.race([
      Promise.all(
        activeProcesses.map(
          ({ proc }) =>
            new Promise<void>((resolve) => {
              if (proc.killed || proc.exitCode !== null) return resolve();
              proc.on('close', () => resolve());
            }),
        ),
      ),
      new Promise<void>((resolve) => setTimeout(resolve, gracePeriodMs)),
    ]);

    // Force kill any remaining
    for (const { name, proc } of activeProcesses) {
      if (!proc.killed && proc.exitCode === null) {
        logger.warn({ name }, 'Force killing process after grace period');
        killProcessGroup(proc.pid, 'SIGKILL');
      }
    }
  }
}
