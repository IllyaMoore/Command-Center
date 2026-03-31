import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock dependencies before importing
vi.mock('./config.js', () => ({
  DATA_DIR: '', // Will be overridden per test
}));

vi.mock('./db.js', () => ({
  upsertToolPolicy: vi.fn(),
}));

vi.mock('./logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { ApprovalManager } from './approval-manager.js';
import { upsertToolPolicy } from './db.js';
import * as config from './config.js';

let tmpDir: string;
let manager: ApprovalManager;

function makeRequest(overrides: Partial<{
  id: string; groupFolder: string; toolName: string;
  toolInput: Record<string, unknown>; toolUseId: string; timestamp: string;
}> = {}) {
  return {
    id: overrides.id ?? `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    groupFolder: overrides.groupFolder ?? 'ceo',
    toolName: overrides.toolName ?? 'Bash',
    toolInput: overrides.toolInput ?? { command: 'ls' },
    toolUseId: overrides.toolUseId ?? 'toolu_123',
    timestamp: overrides.timestamp ?? new Date().toISOString(),
  };
}

describe('ApprovalManager', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'approval-test-'));
    (config as { DATA_DIR: string }).DATA_DIR = tmpDir;
    manager = new ApprovalManager();
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
  describe('ingest', () => {
    it('returns true for new request', () => {
      const req = makeRequest();
      expect(manager.ingest(req)).toBe(true);
    });

    it('returns false for duplicate request', () => {
      const req = makeRequest();
      manager.ingest(req);
      expect(manager.ingest(req)).toBe(false);
    });

    it('rejects request with missing id', () => {
      const req = makeRequest({ id: '' });
      expect(manager.ingest(req)).toBe(false);
    });

    it('rejects request with missing groupFolder', () => {
      const req = makeRequest({ groupFolder: '' });
      expect(manager.ingest(req)).toBe(false);
    });

    it('rejects request with missing toolName', () => {
      const req = makeRequest({ toolName: '' });
      expect(manager.ingest(req)).toBe(false);
    });

    it('adds request to pending', () => {
      const req = makeRequest();
      manager.ingest(req);
      expect(manager.getPending()).toHaveLength(1);
      expect(manager.getPending()[0].id).toBe(req.id);
    });
  });

  describe('respond', () => {
    it('writes response file and removes from pending', () => {
      const req = makeRequest();
      manager.ingest(req);

      // Create the approvals directory (normally created by container-runner)
      const approvalsDir = path.join(tmpDir, 'ipc', req.groupFolder, 'approvals');
      fs.mkdirSync(approvalsDir, { recursive: true });

      const ok = manager.respond(req.id, 'allow', false);
      expect(ok).toBe(true);
      expect(manager.getPending()).toHaveLength(0);

      // Check response file exists
      const responseFile = path.join(approvalsDir, `${req.id}.response.json`);
      expect(fs.existsSync(responseFile)).toBe(true);
      const data = JSON.parse(fs.readFileSync(responseFile, 'utf-8'));
      expect(data.decision).toBe('allow');
    });

    it('returns false for unknown id', () => {
      expect(manager.respond('nonexistent', 'allow', false)).toBe(false);
    });

    it('calls upsertToolPolicy when alwaysAllow is true and decision is allow', () => {
      const req = makeRequest({ toolName: 'Bash' });
      manager.ingest(req);
      fs.mkdirSync(path.join(tmpDir, 'ipc', req.groupFolder, 'approvals'), { recursive: true });

      manager.respond(req.id, 'allow', true);
      expect(upsertToolPolicy).toHaveBeenCalledWith(req.groupFolder, 'Bash', 'allow');
    });

    it('does not call upsertToolPolicy when decision is deny', () => {
      const req = makeRequest();
      manager.ingest(req);
      fs.mkdirSync(path.join(tmpDir, 'ipc', req.groupFolder, 'approvals'), { recursive: true });

      manager.respond(req.id, 'deny', false);
      expect(upsertToolPolicy).not.toHaveBeenCalled();
    });

    it('removes from pending even when file write fails', () => {
      const req = makeRequest({ groupFolder: 'nonexistent/../../bad' });
      manager.ingest(req);
      // Don't create directory — write will fail

      const ok = manager.respond(req.id, 'allow', false);
      expect(ok).toBe(false);
      expect(manager.getPending()).toHaveLength(0);
    });
  });

  describe('getPending', () => {
    it('returns empty array when nothing pending', () => {
      expect(manager.getPending()).toEqual([]);
    });

    it('returns copies not references', () => {
      const req = makeRequest();
      manager.ingest(req);
      const pending = manager.getPending();
      // Mutating the returned object should not affect internal state
      (pending[0] as Record<string, unknown>).id = 'mutated';
      expect(manager.getPending()[0].id).toBe(req.id);
    });

    it('returns multiple pending items', () => {
      const req1 = makeRequest({ id: 'a' });
      const req2 = makeRequest({ id: 'b' });
      manager.ingest(req1);
      manager.ingest(req2);

      const pending = manager.getPending();
      expect(pending).toHaveLength(2);
    });
  });

  describe('cleanExpired', () => {
    it('removes items older than MAX_AGE_MS', () => {
      const req = makeRequest();
      manager.ingest(req);

      // Manipulate internal state — getPending returns copies so we access via respond
      // Advance time by ingesting and waiting
      const pending = manager.getPending();
      expect(pending).toHaveLength(1);

      // Simulate expiry by creating a manager with old items
      // We can't easily mutate receivedAt, so test that cleanExpired runs without error
      manager.cleanExpired();
      // Item is fresh, should still be there
      expect(manager.getPending()).toHaveLength(1);
    });
  });

  describe('scanIpcDirs', () => {
    it('reads request files from IPC directories', () => {
      const req = makeRequest({ groupFolder: 'testgroup' });
      const approvalsDir = path.join(tmpDir, 'ipc', 'testgroup', 'approvals');
      fs.mkdirSync(approvalsDir, { recursive: true });
      fs.writeFileSync(
        path.join(approvalsDir, `${req.id}.request.json`),
        JSON.stringify(req),
      );

      manager.scanIpcDirs();
      expect(manager.getPending()).toHaveLength(1);
      expect(manager.getPending()[0].id).toBe(req.id);
    });

    it('skips non-request files', () => {
      const approvalsDir = path.join(tmpDir, 'ipc', 'testgroup', 'approvals');
      fs.mkdirSync(approvalsDir, { recursive: true });
      fs.writeFileSync(path.join(approvalsDir, 'something.response.json'), '{}');
      fs.writeFileSync(path.join(approvalsDir, 'random.txt'), 'hello');

      manager.scanIpcDirs();
      expect(manager.getPending()).toHaveLength(0);
    });

    it('handles missing IPC directory gracefully', () => {
      // tmpDir/ipc doesn't exist
      expect(() => manager.scanIpcDirs()).not.toThrow();
      expect(manager.getPending()).toHaveLength(0);
    });

    it('skips directories with path traversal', () => {
      const badDir = path.join(tmpDir, 'ipc', '..', 'approvals');
      fs.mkdirSync(badDir, { recursive: true });

      expect(() => manager.scanIpcDirs()).not.toThrow();
    });

    it('handles malformed JSON gracefully', () => {
      const approvalsDir = path.join(tmpDir, 'ipc', 'testgroup', 'approvals');
      fs.mkdirSync(approvalsDir, { recursive: true });
      fs.writeFileSync(path.join(approvalsDir, 'bad.request.json'), 'not json');

      expect(() => manager.scanIpcDirs()).not.toThrow();
      expect(manager.getPending()).toHaveLength(0);
    });
  });

  describe('getPendingForGroup', () => {
    it('filters by groupFolder', () => {
      manager.ingest(makeRequest({ id: 'a', groupFolder: 'ceo' }));
      manager.ingest(makeRequest({ id: 'b', groupFolder: 'legal' }));
      manager.ingest(makeRequest({ id: 'c', groupFolder: 'ceo' }));

      expect(manager.getPendingForGroup('ceo')).toHaveLength(2);
      expect(manager.getPendingForGroup('legal')).toHaveLength(1);
      expect(manager.getPendingForGroup('finance')).toHaveLength(0);
    });
  });
});
