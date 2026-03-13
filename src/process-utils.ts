import { logger } from './logger.js';

/**
 * Kill an entire process group (agent-runner + claude CLI + MCP servers).
 * On non-Windows, `detached: true` in spawn makes the child a process group leader,
 * so `process.kill(-pid)` sends the signal to every process in that group.
 * On Windows, negative PIDs are not supported — fall back to direct kill.
 */
export function killProcessGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (!pid) return;
  try {
    process.platform !== 'win32' ? process.kill(-pid, signal) : process.kill(pid, signal);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ESRCH') {
      logger.warn({ pid, signal, err }, 'Unexpected error killing process group');
    }
  }
}
