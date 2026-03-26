import fs from 'fs';
import path from 'path';

import { DATA_DIR } from './config.js';
import { upsertToolPolicy } from './db.js';
import { logger } from './logger.js';

export interface ApprovalRequest {
  id: string;
  groupFolder: string;
  toolName: string;
  toolInput: unknown;
  toolUseId: string;
  timestamp: string;
}

export interface PendingApproval extends ApprovalRequest {
  receivedAt: number;
}

export interface ApprovalResponse {
  id: string;
  decision: 'allow' | 'deny';
  alwaysAllow: boolean;
  message?: string;
}

const MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

export class ApprovalManager {
  private pending = new Map<string, PendingApproval>();
  private seen = new Set<string>();

  /** Ingest a new approval request from IPC. Returns true if it's new. */
  ingest(request: ApprovalRequest): boolean {
    if (this.seen.has(request.id)) return false;
    this.seen.add(request.id);
    this.pending.set(request.id, {
      ...request,
      receivedAt: Date.now(),
    });
    logger.info(
      { id: request.id, tool: request.toolName, group: request.groupFolder },
      'Approval request received',
    );
    return true;
  }

  /** Respond to a pending approval. Writes response file for agent to pick up. */
  respond(id: string, decision: 'allow' | 'deny', alwaysAllow: boolean): boolean {
    const pending = this.pending.get(id);
    if (!pending) {
      logger.warn({ id }, 'Approval response for unknown request');
      return false;
    }

    // Write response file for agent
    const approvalsDir = path.join(DATA_DIR, 'ipc', pending.groupFolder, 'approvals');
    const responseFile = path.join(approvalsDir, `${id}.response.json`);
    const tmpFile = `${responseFile}.tmp`;

    const response: ApprovalResponse = { id, decision, alwaysAllow };

    try {
      fs.writeFileSync(tmpFile, JSON.stringify(response));
      fs.renameSync(tmpFile, responseFile);
    } catch (err) {
      logger.error({ err, id }, 'Failed to write approval response');
      return false;
    }

    // If always allow, persist to tool_policies
    if (alwaysAllow && decision === 'allow') {
      try {
        upsertToolPolicy(pending.groupFolder, pending.toolName, 'allow');
        logger.info(
          { group: pending.groupFolder, tool: pending.toolName },
          'Tool policy added: always allow',
        );
      } catch (err) {
        logger.error({ err }, 'Failed to persist tool policy');
      }
    }

    // Clean up
    this.pending.delete(id);
    this.cleanRequestFile(pending.groupFolder, id);

    logger.info(
      { id, decision, alwaysAllow, tool: pending.toolName },
      'Approval response sent',
    );
    return true;
  }

  /** Get all pending approval requests. */
  getPending(): PendingApproval[] {
    return Array.from(this.pending.values());
  }

  /** Get pending approvals for a specific group. */
  getPendingForGroup(groupFolder: string): PendingApproval[] {
    return this.getPending().filter((p) => p.groupFolder === groupFolder);
  }

  /** Remove expired approvals. */
  cleanExpired(): void {
    const now = Date.now();
    for (const [id, approval] of this.pending) {
      if (now - approval.receivedAt > MAX_AGE_MS) {
        logger.warn({ id, tool: approval.toolName }, 'Approval request expired');
        // Write a deny response so the agent unblocks
        this.respond(id, 'deny', false);
      }
    }

    // Trim seen set to prevent unbounded growth
    if (this.seen.size > 1000) {
      const pendingIds = new Set(this.pending.keys());
      this.seen = pendingIds;
    }
  }

  /** Scan IPC directories for new approval request files. */
  scanIpcDirs(): void {
    const ipcDir = path.join(DATA_DIR, 'ipc');
    if (!fs.existsSync(ipcDir)) return;

    let groupDirs: string[];
    try {
      groupDirs = fs.readdirSync(ipcDir);
    } catch {
      return;
    }

    for (const groupFolder of groupDirs) {
      const approvalsDir = path.join(ipcDir, groupFolder, 'approvals');
      if (!fs.existsSync(approvalsDir)) continue;

      let files: string[];
      try {
        files = fs.readdirSync(approvalsDir);
      } catch {
        continue;
      }

      for (const file of files) {
        if (!file.endsWith('.request.json')) continue;

        const filePath = path.join(approvalsDir, file);
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const request = JSON.parse(content) as ApprovalRequest;
          this.ingest(request);
        } catch (err) {
          logger.warn({ err, file }, 'Failed to parse approval request file');
        }
      }
    }
  }

  private cleanRequestFile(groupFolder: string, id: string): void {
    try {
      const requestFile = path.join(
        DATA_DIR, 'ipc', groupFolder, 'approvals', `${id}.request.json`,
      );
      if (fs.existsSync(requestFile)) fs.unlinkSync(requestFile);
    } catch {
      // best effort
    }
  }
}

// Singleton
export const approvalManager = new ApprovalManager();
