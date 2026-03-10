/**
 * Agent Runner for NanoClaw
 * Spawns agent execution as a child process and handles IPC
 */
import { ChildProcess, spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  AGENT_RUNNER_PATH,
  CONTAINER_MAX_OUTPUT_SIZE,
  CONTAINER_TIMEOUT,
  DATA_DIR,
  DEV_MODE,
  GROUPS_DIR,
  IDLE_TIMEOUT,
  WARNING_TIMEOUT,
} from './config.js';
import { readEnvFile } from './env.js';
import { logger } from './logger.js';
import { validateAdditionalMounts } from './mount-security.js';
import { RegisteredGroup } from './types.js';

// Sentinel markers for robust output parsing (must match agent-runner)
const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

function getHomeDir(): string {
  const home = process.env.HOME || os.homedir();
  if (!home) {
    throw new Error(
      'Unable to determine home directory: HOME environment variable is not set and os.homedir() returned empty',
    );
  }
  return home;
}

export interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  assistantName?: string;
  secrets?: Record<string, string>;
}

export interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  error?: string;
}

/**
 * Prepare per-group directories (sessions, skills, IPC) and return
 * the env vars that tell the agent-runner where everything lives.
 */
function buildAgentEnv(
  group: RegisteredGroup,
  isMain: boolean,
): Record<string, string> {
  const homeDir = getHomeDir();
  const projectRoot = process.cwd();
  const groupDir = path.join(GROUPS_DIR, group.folder);

  // Per-group Claude sessions directory (isolated from other groups)
  const groupSessionsDir = path.join(
    DATA_DIR,
    'sessions',
    group.folder,
  );
  const claudeDir = path.join(groupSessionsDir, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });
  const settingsFile = path.join(claudeDir, 'settings.json');
  if (!fs.existsSync(settingsFile)) {
    fs.writeFileSync(settingsFile, JSON.stringify({
      env: {
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
        CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1',
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0',
      },
    }, null, 2) + '\n');
  }

  // Sync skills from container/skills/ into each group's .claude/skills/
  const skillsSrc = path.join(projectRoot, 'container', 'skills');
  const skillsDst = path.join(claudeDir, 'skills');
  if (fs.existsSync(skillsSrc)) {
    for (const skillDir of fs.readdirSync(skillsSrc)) {
      const srcDir = path.join(skillsSrc, skillDir);
      if (!fs.statSync(srcDir).isDirectory()) continue;
      const dstDir = path.join(skillsDst, skillDir);
      fs.mkdirSync(dstDir, { recursive: true });
      for (const file of fs.readdirSync(srcDir)) {
        fs.copyFileSync(path.join(srcDir, file), path.join(dstDir, file));
      }
    }
  }

  // Per-group IPC namespace
  const groupIpcDir = path.join(DATA_DIR, 'ipc', group.folder);
  fs.mkdirSync(path.join(groupIpcDir, 'messages'), { recursive: true });
  fs.mkdirSync(path.join(groupIpcDir, 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(groupIpcDir, 'input'), { recursive: true });

  // Build env vars for the agent-runner process
  const env: Record<string, string> = {
    NANOCLAW_GROUP_DIR: groupDir,
    NANOCLAW_IPC_DIR: groupIpcDir,
    NANOCLAW_HOME_DIR: homeDir,
    HOME: groupSessionsDir,
  };

  if (isMain) {
    env.NANOCLAW_PROJECT_DIR = projectRoot;
  }

  // Global memory directory (non-main groups only)
  const globalDir = path.join(GROUPS_DIR, 'global');
  if (!isMain && fs.existsSync(globalDir)) {
    env.NANOCLAW_GLOBAL_DIR = globalDir;
  }

  // Additional mounts → extra dirs (validated against allowlist)
  if (group.containerConfig?.additionalMounts) {
    const validatedMounts = validateAdditionalMounts(
      group.containerConfig.additionalMounts,
      group.name,
      isMain,
    );
    if (validatedMounts.length > 0) {
      env.NANOCLAW_EXTRA_DIRS = JSON.stringify(
        validatedMounts.map((m) => m.hostPath),
      );
    }
  }

  return env;
}

/**
 * Read allowed secrets from .env for passing to the agent via stdin.
 * Secrets are never written to disk or passed as env vars.
 */
function readSecrets(): Record<string, string> {
  return readEnvFile(['ANTHROPIC_API_KEY', 'ATLASSIAN_BASIC_TOKEN']);
}

export async function runContainerAgent(
  group: RegisteredGroup,
  input: ContainerInput,
  onProcess: (proc: ChildProcess, containerName: string) => void,
  onOutput?: (output: ContainerOutput) => Promise<void>,
  onWarning?: () => void,
  onTimeout?: (hadOutput: boolean) => void,
): Promise<ContainerOutput> {
  if (DEV_MODE) {
    logger.info(
      {
        group: group.name,
        folder: group.folder,
        chatJid: input.chatJid,
        isMain: input.isMain,
        isScheduledTask: input.isScheduledTask ?? false,
        secretKeys: input.secrets ? Object.keys(input.secrets) : [],
        prompt: input.prompt.substring(0, 400),
      },
      '[DEV MODE] Skipping agent spawn',
    );
    const devResult = `[DEV] ${input.isScheduledTask ? 'Scheduled task' : 'Message'} received by ${group.name} agent. Prompt: ${input.prompt.length} chars. \n\nDev mode is enabled, so agent execution is skipped.`;
    const output: ContainerOutput = { status: 'success', result: devResult };
    if (onOutput) await onOutput(output);
    return output;
  }

  const startTime = Date.now();

  const groupDir = path.join(GROUPS_DIR, group.folder);
  fs.mkdirSync(groupDir, { recursive: true });

  const agentEnv = buildAgentEnv(group, input.isMain);
  const safeName = group.folder.replace(/[^a-zA-Z0-9-]/g, '-');
  const processName = `nanoclaw-${safeName}-${Date.now()}`;

  logger.debug(
    {
      group: group.name,
      processName,
      agentEnv,
    },
    'Agent process configuration',
  );

  logger.info(
    {
      group: group.name,
      processName,
      isMain: input.isMain,
    },
    'Spawning agent process',
  );

  const logsDir = path.join(GROUPS_DIR, group.folder, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  // Read secrets before spawn so a throw doesn't orphan a child process
  const secrets = readSecrets();

  return new Promise((resolve) => {
    // Strip secrets from inherited env — they're delivered via stdin instead
    const { ANTHROPIC_API_KEY: _, ATLASSIAN_BASIC_TOKEN: __, CLAUDE_CODE_OAUTH_TOKEN: ___, ...sanitizedEnv } = process.env;

    const agentProcess = spawn('node', [AGENT_RUNNER_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: groupDir,
      env: { ...sanitizedEnv, ...agentEnv },
    });

    onProcess(agentProcess, processName);

    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;

    // Prevent unhandled EPIPE if child dies before reading stdin
    agentProcess.stdin.on('error', (err) => {
      logger.warn({ group: group.name, processName, error: err }, 'Agent stdin error (child may have exited early)');
    });

    // Pass secrets via stdin (never written to disk or passed as env vars)
    const payload = { ...input, secrets };
    agentProcess.stdin.write(JSON.stringify(payload));
    agentProcess.stdin.end();

    // --- Timeout management (declared before event handlers that reference them) ---
    let timedOut = false;
    let processExited = false;
    let resolved = false;
    const safeResolve = (value: ContainerOutput) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };
    const configTimeout = group.containerConfig?.timeout || CONTAINER_TIMEOUT;
    // Grace period: hard timeout must be at least IDLE_TIMEOUT + 30s so the
    // graceful _close sentinel has time to trigger before the hard kill fires.
    const timeoutMs = Math.max(configTimeout, IDLE_TIMEOUT + 30_000);

    // Streaming output: parse OUTPUT_START/END marker pairs as they arrive
    let parseBuffer = '';
    let newSessionId: string | undefined;
    let outputChain = Promise.resolve();
    let hadStreamingOutput = false;

    let killFallbackTimer: ReturnType<typeof setTimeout> | null = null;

    const killOnTimeout = () => {
      timedOut = true;
      logger.error({ group: group.name, processName }, 'Agent timeout, stopping gracefully');
      try { if (onTimeout) onTimeout(hadStreamingOutput); } catch { /* don't block SIGTERM */ }
      try { agentProcess.kill('SIGTERM'); } catch { /* ESRCH: already exited */ }
      killFallbackTimer = setTimeout(() => {
        if (!processExited) {
          logger.warn({ group: group.name, processName }, 'Graceful stop failed, force killing');
          try { agentProcess.kill('SIGKILL'); } catch { /* ESRCH: already exited */ }
        }
      }, 15000);
    };

    let timeout = setTimeout(killOnTimeout, timeoutMs);

    // Warning timer: notify user the agent is still working
    let warningSent = false;
    let warningTimer: ReturnType<typeof setTimeout> | null = null;

    const startWarningTimer = () => {
      if (!onWarning || warningSent || WARNING_TIMEOUT >= timeoutMs) return;
      if (warningTimer) clearTimeout(warningTimer);
      warningTimer = setTimeout(() => {
        warningSent = true;
        onWarning();
      }, WARNING_TIMEOUT);
    };

    startWarningTimer();

    // Reset the timeout whenever there's activity (streaming output)
    const resetTimeout = () => {
      clearTimeout(timeout);
      timeout = setTimeout(killOnTimeout, timeoutMs);
      startWarningTimer();
    };

    // --- Event handlers ---
    agentProcess.stdout.on('data', (data) => {
      const chunk = data.toString();

      // Always accumulate for logging
      if (!stdoutTruncated) {
        const remaining = CONTAINER_MAX_OUTPUT_SIZE - stdout.length;
        if (chunk.length > remaining) {
          stdout += chunk.slice(0, remaining);
          stdoutTruncated = true;
          logger.warn(
            { group: group.name, size: stdout.length },
            'Agent stdout truncated due to size limit',
          );
        } else {
          stdout += chunk;
        }
      }

      // Stream-parse for output markers
      if (onOutput) {
        parseBuffer += chunk;
        let startIdx: number;
        while ((startIdx = parseBuffer.indexOf(OUTPUT_START_MARKER)) !== -1) {
          const endIdx = parseBuffer.indexOf(OUTPUT_END_MARKER, startIdx);
          if (endIdx === -1) break; // Incomplete pair, wait for more data

          const jsonStr = parseBuffer
            .slice(startIdx + OUTPUT_START_MARKER.length, endIdx)
            .trim();
          parseBuffer = parseBuffer.slice(endIdx + OUTPUT_END_MARKER.length);

          try {
            const parsed: ContainerOutput = JSON.parse(jsonStr);
            if (parsed.newSessionId) {
              newSessionId = parsed.newSessionId;
            }
            hadStreamingOutput = true;
            // Activity detected — reset the hard timeout
            resetTimeout();
            // Call onOutput for all markers (including null results)
            // so idle timers start even for "silent" query completions.
            outputChain = outputChain.then(() =>
              onOutput(parsed).catch((err) => {
                logger.error({ group: group.name, error: err }, 'Failed to deliver streamed output chunk');
              }),
            );
          } catch (err) {
            logger.warn(
              { group: group.name, error: err },
              'Failed to parse streamed output chunk',
            );
          }
        }
      }
    });

    agentProcess.stderr.on('data', (data) => {
      const chunk = data.toString();
      const lines = chunk.trim().split('\n');
      for (const line of lines) {
        if (line) logger.debug({ agent: group.folder }, line);
      }
      // Don't reset timeout on stderr — SDK writes debug logs continuously.
      // Timeout only resets on actual output (OUTPUT_MARKER in stdout).
      if (stderrTruncated) return;
      const remaining = CONTAINER_MAX_OUTPUT_SIZE - stderr.length;
      if (chunk.length > remaining) {
        stderr += chunk.slice(0, remaining);
        stderrTruncated = true;
        logger.warn(
          { group: group.name, size: stderr.length },
          'Agent stderr truncated due to size limit',
        );
      } else {
        stderr += chunk;
      }
    });

    agentProcess.on('close', (code) => {
      processExited = true;
      clearTimeout(timeout);
      if (warningTimer) clearTimeout(warningTimer);
      if (killFallbackTimer) clearTimeout(killFallbackTimer);
      const duration = Date.now() - startTime;

      if (timedOut) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const timeoutLog = path.join(logsDir, `agent-${ts}.log`);
        fs.writeFileSync(timeoutLog, [
          `=== Agent Run Log (TIMEOUT) ===`,
          `Timestamp: ${new Date().toISOString()}`,
          `Group: ${group.name}`,
          `Process: ${processName}`,
          `Duration: ${duration}ms`,
          `Exit Code: ${code}`,
          `Had Streaming Output: ${hadStreamingOutput}`,
        ].join('\n'));

        // Timeout after output = idle cleanup, not failure.
        if (hadStreamingOutput) {
          logger.info(
            { group: group.name, processName, duration, code },
            'Agent timed out after output (idle cleanup)',
          );
          outputChain
            .then(() => {
              safeResolve({
                status: 'success',
                result: null,
                newSessionId,
              });
            })
            .catch((err) => {
              logger.error({ group: group.name, error: err }, 'Output chain error during idle cleanup');
              safeResolve({ status: 'error', result: null, error: `Output callback failed: ${err}` });
            });
          return;
        }

        logger.error(
          { group: group.name, processName, duration, code },
          'Agent timed out with no output',
        );

        safeResolve({
          status: 'error',
          result: null,
          error: `Agent timed out after ${configTimeout}ms`,
        });
        return;
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const logFile = path.join(logsDir, `agent-${timestamp}.log`);
      const isVerbose = process.env.LOG_LEVEL === 'debug' || process.env.LOG_LEVEL === 'trace';

      const logLines = [
        `=== Agent Run Log ===`,
        `Timestamp: ${new Date().toISOString()}`,
        `Group: ${group.name}`,
        `IsMain: ${input.isMain}`,
        `Duration: ${duration}ms`,
        `Exit Code: ${code}`,
        `Stdout Truncated: ${stdoutTruncated}`,
        `Stderr Truncated: ${stderrTruncated}`,
        ``,
      ];

      const isError = code !== 0;

      if (isVerbose || isError) {
        logLines.push(
          `=== Input ===`,
          JSON.stringify(input, null, 2),
          ``,
          `=== Env ===`,
          Object.entries(agentEnv)
            .map(([k, v]) => `${k}=${v}`)
            .join('\n'),
          ``,
          `=== Stderr${stderrTruncated ? ' (TRUNCATED)' : ''} ===`,
          stderr,
          ``,
          `=== Stdout${stdoutTruncated ? ' (TRUNCATED)' : ''} ===`,
          stdout,
        );
      } else {
        logLines.push(
          `=== Input Summary ===`,
          `Prompt length: ${input.prompt.length} chars`,
          `Session ID: ${input.sessionId || 'new'}`,
          ``,
        );
      }

      fs.writeFileSync(logFile, logLines.join('\n'));
      logger.debug({ logFile, verbose: isVerbose }, 'Agent log written');

      if (code !== 0) {
        logger.error(
          {
            group: group.name,
            code,
            duration,
            stderr,
            stdout,
            logFile,
          },
          'Agent exited with error',
        );

        safeResolve({
          status: 'error',
          result: null,
          error: `Agent exited with code ${code}: ${stderr.slice(-200)}`,
        });
        return;
      }

      // Streaming mode: wait for output chain to settle, return completion marker
      if (onOutput) {
        outputChain
          .then(() => {
            logger.info(
              { group: group.name, duration, newSessionId },
              'Agent completed (streaming mode)',
            );
            safeResolve({
              status: 'success',
              result: null,
              newSessionId,
            });
          })
          .catch((err) => {
            logger.error({ group: group.name, error: err }, 'Output chain error');
            safeResolve({ status: 'error', result: null, error: `Output callback failed: ${err}` });
          });
        return;
      }

      // Legacy mode: parse the last output marker pair from accumulated stdout
      try {
        const startIdx = stdout.lastIndexOf(OUTPUT_START_MARKER);
        const endIdx = stdout.lastIndexOf(OUTPUT_END_MARKER);

        let jsonLine: string;
        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
          jsonLine = stdout
            .slice(startIdx + OUTPUT_START_MARKER.length, endIdx)
            .trim();
        } else {
          const lines = stdout.trim().split('\n');
          jsonLine = lines[lines.length - 1];
        }

        const output: ContainerOutput = JSON.parse(jsonLine);

        logger.info(
          {
            group: group.name,
            duration,
            status: output.status,
            hasResult: !!output.result,
          },
          'Agent completed',
        );

        safeResolve(output);
      } catch (err) {
        logger.error(
          {
            group: group.name,
            stdout,
            stderr,
            error: err,
          },
          'Failed to parse agent output',
        );

        safeResolve({
          status: 'error',
          result: null,
          error: `Failed to parse agent output: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    });

    agentProcess.on('error', (err) => {
      processExited = true;
      clearTimeout(timeout);
      if (warningTimer) clearTimeout(warningTimer);
      logger.error({ group: group.name, processName, error: err }, 'Agent spawn error');
      safeResolve({
        status: 'error',
        result: null,
        error: `Agent spawn error: ${err.message}`,
      });
    });
  });
}

export function writeTasksSnapshot(
  groupFolder: string,
  isMain: boolean,
  tasks: Array<{
    id: string;
    groupFolder: string;
    prompt: string;
    schedule_type: string;
    schedule_value: string;
    status: string;
    next_run: string | null;
  }>,
): void {
  const groupIpcDir = path.join(DATA_DIR, 'ipc', groupFolder);
  fs.mkdirSync(groupIpcDir, { recursive: true });

  const filteredTasks = isMain
    ? tasks
    : tasks.filter((t) => t.groupFolder === groupFolder);

  const tasksFile = path.join(groupIpcDir, 'current_tasks.json');
  fs.writeFileSync(tasksFile, JSON.stringify(filteredTasks, null, 2));
}

export interface AvailableGroup {
  jid: string;
  name: string;
  lastActivity: string;
  isRegistered: boolean;
}

export function writeGroupsSnapshot(
  groupFolder: string,
  isMain: boolean,
  groups: AvailableGroup[],
  registeredJids: Set<string>,
): void {
  const groupIpcDir = path.join(DATA_DIR, 'ipc', groupFolder);
  fs.mkdirSync(groupIpcDir, { recursive: true });

  const visibleGroups = isMain ? groups : [];

  const groupsFile = path.join(groupIpcDir, 'available_groups.json');
  fs.writeFileSync(
    groupsFile,
    JSON.stringify(
      {
        groups: visibleGroups,
        lastSync: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}
