import fs from 'fs';
import path from 'path';

import { DATA_DIR } from './config.js';
import { logger } from './logger.js';

export interface DelegationRequest {
  id: string;
  sourceGroup: string;
  targetGroup: string;
  task: string;
  context?: string;
  chatJid: string;
  timestamp: string;
}

export interface PendingDelegation extends DelegationRequest {
  receivedAt: number;
}

export interface DelegationResponse {
  id: string;
  status: 'success' | 'error' | 'denied';
  result?: string;
  error?: string;
}

const MAX_AGE_MS = 12 * 60 * 1000; // 12 minutes (longer than agent-side 10min timeout)

export class DelegationManager {
  private pending = new Map<string, PendingDelegation>();
  private seen = new Set<string>();

  ingest(request: DelegationRequest): boolean {
    if (this.seen.has(request.id)) return false;
    if (!request.id || !request.sourceGroup || !request.targetGroup || !request.task) {
      logger.warn({ request }, 'Invalid delegation request — missing required fields');
      return false;
    }
    this.seen.add(request.id);
    this.pending.set(request.id, {
      ...request,
      receivedAt: Date.now(),
    });
    logger.info(
      { id: request.id, source: request.sourceGroup, target: request.targetGroup },
      'Delegation request received',
    );
    return true;
  }

  respond(id: string, response: DelegationResponse): boolean {
    const pending = this.pending.get(id);
    if (!pending) {
      logger.warn({ id }, 'Delegation response for unknown request');
      return false;
    }

    const delegationsDir = path.join(DATA_DIR, 'ipc', pending.sourceGroup, 'delegations');
    const responseFile = path.join(delegationsDir, `${id}.response.json`);
    const tmpFile = `${responseFile}.tmp`;

    try {
      fs.writeFileSync(tmpFile, JSON.stringify(response));
      fs.renameSync(tmpFile, responseFile);
    } catch (err) {
      logger.error({ err, id }, 'Failed to write delegation response');
      this.pending.delete(id);
      return false;
    }

    this.pending.delete(id);
    this.cleanRequestFile(pending.sourceGroup, id);

    logger.info(
      { id, status: response.status, target: pending.targetGroup },
      'Delegation response sent',
    );
    return true;
  }

  getPending(): Readonly<PendingDelegation>[] {
    return Array.from(this.pending.values()).map((p) => ({ ...p }));
  }

  cleanExpired(): void {
    const expired = [...this.pending.entries()]
      .filter(([, d]) => Date.now() - d.receivedAt > MAX_AGE_MS)
      .map(([id]) => id);

    for (const id of expired) {
      logger.warn({ id }, 'Delegation request expired');
      this.respond(id, { id, status: 'error', error: 'Delegation timed out' });
    }

    if (this.seen.size > 500) {
      this.seen = new Set(this.pending.keys());
    }
  }

  scanIpcDirs(): void {
    const ipcDir = path.join(DATA_DIR, 'ipc');
    if (!fs.existsSync(ipcDir)) return;

    let groupDirs: string[];
    try {
      groupDirs = fs.readdirSync(ipcDir);
    } catch (err) {
      logger.warn({ err }, 'Failed to read IPC directory for delegations');
      return;
    }

    for (const group of groupDirs) {
      if (group.includes('..') || group.includes('/') || group.includes('\\')) continue;

      const delegationsDir = path.join(ipcDir, group, 'delegations');
      if (!fs.existsSync(delegationsDir)) continue;

      let files: string[];
      try {
        files = fs.readdirSync(delegationsDir);
      } catch {
        continue;
      }

      for (const file of files) {
        if (!file.endsWith('.request.json')) continue;

        const filePath = path.join(delegationsDir, file);
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const request = JSON.parse(content) as DelegationRequest;
          this.ingest(request);
        } catch (err) {
          logger.warn({ err, file }, 'Failed to parse delegation request file');
        }
      }
    }
  }

  private cleanRequestFile(sourceGroup: string, id: string): void {
    try {
      const requestFile = path.join(
        DATA_DIR, 'ipc', sourceGroup, 'delegations', `${id}.request.json`,
      );
      if (fs.existsSync(requestFile)) fs.unlinkSync(requestFile);
    } catch (err) {
      logger.warn({ err, id }, 'Failed to clean delegation request file');
    }
  }
}

export const delegationManager = new DelegationManager();
