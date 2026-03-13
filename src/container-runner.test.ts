import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';

// Sentinel markers must match container-runner.ts
const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

// Mock config - CONTAINER_TIMEOUT=10min, IDLE_TIMEOUT=10min, WARNING_TIMEOUT=5min
// Hard timeout fires at IDLE_TIMEOUT + 30s = 630000ms
vi.mock('./config.js', () => ({
  AGENT_RUNNER_PATH: '/tmp/fake-agent-runner.js',
  CONTAINER_MAX_OUTPUT_SIZE: 10_485_760,
  CONTAINER_TIMEOUT: 600_000,
  IDLE_TIMEOUT: 600_000,
  WARNING_TIMEOUT: 300_000,
  DATA_DIR: '/tmp/nanoclaw-test-data',
  DEV_MODE: false,
  GROUPS_DIR: '/tmp/nanoclaw-test-groups',
}));

// Mock logger
vi.mock('./logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock fs
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(() => false),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      readFileSync: vi.fn(() => ''),
      readdirSync: vi.fn(() => []),
      statSync: vi.fn(() => ({ isDirectory: () => false })),
      copyFileSync: vi.fn(),
    },
  };
});

// Mock mount-security
vi.mock('./mount-security.js', () => ({
  validateAdditionalMounts: vi.fn(() => []),
}));

// Mock process-utils (killProcessGroup)
const mockKillProcessGroup = vi.fn();
vi.mock('./process-utils.js', () => ({
  killProcessGroup: (...args: unknown[]) => mockKillProcessGroup(...args),
}));

// Create a controllable fake ChildProcess
function createFakeProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
    pid: number;
  };
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kill = vi.fn();
  proc.pid = 12345;
  return proc;
}

let fakeProc: ReturnType<typeof createFakeProcess>;

// Mock child_process.spawn
vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    spawn: vi.fn(() => fakeProc),
  };
});

import { spawn } from 'child_process';
import { runContainerAgent, ContainerOutput } from './container-runner.js';
import type { RegisteredGroup } from './types.js';

const testGroup: RegisteredGroup = {
  name: 'Test Group',
  folder: 'test-group',
  trigger: '@Andy',
  added_at: new Date().toISOString(),
};

const testInput = {
  prompt: 'Hello',
  groupFolder: 'test-group',
  chatJid: 'test@g.us',
  isMain: false,
};

function emitOutputMarker(proc: ReturnType<typeof createFakeProcess>, output: ContainerOutput) {
  const json = JSON.stringify(output);
  proc.stdout.push(`${OUTPUT_START_MARKER}\n${json}\n${OUTPUT_END_MARKER}\n`);
}

describe('container-runner timeout behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fakeProc = createFakeProcess();
    mockKillProcessGroup.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('timeout after output resolves as success', async () => {
    const onOutput = vi.fn(async () => {});
    const resultPromise = runContainerAgent(
      testGroup,
      testInput,
      () => {},
      onOutput,
    );

    // Emit output with a result
    emitOutputMarker(fakeProc, {
      status: 'success',
      result: 'Here is my response',
      newSessionId: 'session-123',
    });

    // Let output processing settle
    await vi.advanceTimersByTimeAsync(10);

    // Fire the hard timeout (IDLE_TIMEOUT + 30s = 630000ms)
    await vi.advanceTimersByTimeAsync(630_000);

    // Emit close event (as if process was stopped by the timeout)
    fakeProc.emit('close', 137);

    // Let the promise resolve
    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result.status).toBe('success');
    expect(result.newSessionId).toBe('session-123');
    expect(onOutput).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'Here is my response' }),
    );
  });

  it('timeout with no output resolves as error', async () => {
    const onOutput = vi.fn(async () => {});
    const resultPromise = runContainerAgent(
      testGroup,
      testInput,
      () => {},
      onOutput,
    );

    // Fire the hard timeout (IDLE_TIMEOUT + 30s = 630000ms)
    await vi.advanceTimersByTimeAsync(630_000);

    // Emit close event
    fakeProc.emit('close', 137);

    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result.status).toBe('error');
    expect(result.error).toContain('timed out');
    expect(onOutput).not.toHaveBeenCalled();
  });

  it('normal exit after output resolves as success', async () => {
    const onOutput = vi.fn(async () => {});
    const resultPromise = runContainerAgent(
      testGroup,
      testInput,
      () => {},
      onOutput,
    );

    // Emit output
    emitOutputMarker(fakeProc, {
      status: 'success',
      result: 'Done',
      newSessionId: 'session-456',
    });

    await vi.advanceTimersByTimeAsync(10);

    // Normal exit (no timeout)
    fakeProc.emit('close', 0);

    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result.status).toBe('success');
    expect(result.newSessionId).toBe('session-456');
  });

  it('warning callback fires at WARNING_TIMEOUT', async () => {
    const onWarning = vi.fn();
    const onOutput = vi.fn(async () => {});
    const resultPromise = runContainerAgent(
      testGroup,
      testInput,
      () => {},
      onOutput,
      onWarning,
    );

    // Before 5min
    await vi.advanceTimersByTimeAsync(299_000);
    expect(onWarning).not.toHaveBeenCalled();

    // 5min warning
    await vi.advanceTimersByTimeAsync(2_000);
    expect(onWarning).toHaveBeenCalledOnce();

    // Emit output and close normally
    emitOutputMarker(fakeProc, { status: 'success', result: 'Done' });
    await vi.advanceTimersByTimeAsync(10);
    fakeProc.emit('close', 0);
    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result.status).toBe('success');
  });

  it('onTimeout fires when timeout with no output', async () => {
    const onOutput = vi.fn(async () => {});
    const onTimeout = vi.fn();
    const resultPromise = runContainerAgent(
      testGroup,
      testInput,
      () => {},
      onOutput,
      undefined,
      onTimeout,
    );

    // Fire the hard timeout (IDLE_TIMEOUT + 30s = 630000ms)
    await vi.advanceTimersByTimeAsync(630_000);

    // Emit close event
    fakeProc.emit('close', 137);
    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result.status).toBe('error');
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it('onTimeout(true) fires on idle reap (timeout after output)', async () => {
    const onOutput = vi.fn(async () => {});
    const onTimeout = vi.fn();
    const resultPromise = runContainerAgent(
      testGroup,
      testInput,
      () => {},
      onOutput,
      undefined,
      onTimeout,
    );

    // Emit output
    emitOutputMarker(fakeProc, {
      status: 'success',
      result: 'Here is my response',
      newSessionId: 'session-123',
    });
    await vi.advanceTimersByTimeAsync(10);

    // Fire the hard timeout (idle reap)
    await vi.advanceTimersByTimeAsync(630_000);

    // Emit close event
    fakeProc.emit('close', 137);
    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result.status).toBe('success');
    expect(onTimeout).toHaveBeenCalledWith(true);
  });

  it('warning callback does not fire if agent finishes before WARNING_TIMEOUT', async () => {
    const onWarning = vi.fn();
    const resultPromise = runContainerAgent(
      testGroup,
      testInput,
      () => {},
      undefined,
      onWarning,
    );

    // Emit output and close before 5min
    emitOutputMarker(fakeProc, { status: 'success', result: 'Quick response' });
    await vi.advanceTimersByTimeAsync(10);
    fakeProc.emit('close', 0);
    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result.status).toBe('success');
    expect(onWarning).not.toHaveBeenCalled();
  });

  it('spawns agent with detached: true on non-win32', async () => {
    const resultPromise = runContainerAgent(testGroup, testInput, () => {});

    // Verify spawn was called with detached option
    const spawnMock = vi.mocked(spawn);
    const spawnCall = spawnMock.mock.calls[0];
    const opts = spawnCall[2] as { detached?: boolean };
    expect(opts.detached).toBe(process.platform !== 'win32');

    // Clean up
    emitOutputMarker(fakeProc, { status: 'success', result: 'Done' });
    await vi.advanceTimersByTimeAsync(10);
    fakeProc.emit('close', 0);
    await vi.advanceTimersByTimeAsync(10);
    await resultPromise;
  });

  it('kills process group on timeout (negative PID)', async () => {
    const resultPromise = runContainerAgent(
      testGroup,
      testInput,
      () => {},
      undefined,
      undefined,
      vi.fn(),
    );

    // Fire the hard timeout
    await vi.advanceTimersByTimeAsync(630_000);

    // killProcessGroup should have been called with the PID and SIGTERM
    expect(mockKillProcessGroup).toHaveBeenCalledWith(12345, 'SIGTERM');

    // Emit close event
    fakeProc.emit('close', 137);
    await vi.advanceTimersByTimeAsync(10);

    await resultPromise;
  });
});
