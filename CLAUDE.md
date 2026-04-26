# NanoClaw

Personal Claude assistant. See [README.md](README.md) for philosophy and setup.

## Quick Context

Single Node.js process that connects to WhatsApp and Telegram, routes messages to Claude Code agents spawned as child processes. Each group has isolated filesystem and memory.

- Node.js >= 20, npm
- Auth: `ANTHROPIC_API_KEY` only

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Orchestrator: state, message loop, agent invocation |
| `src/channels/whatsapp.ts` | WhatsApp connection, auth, send/receive |
| `src/channels/telegram.ts` | Telegram bot connection, send/receive |
| `src/channels/registry.ts` | Channel registry - routes messages to correct channel |
| `src/ipc.ts` | IPC watcher and task processing |
| `src/router.ts` | Message formatting and outbound routing |
| `src/config.ts` | Trigger pattern, paths, intervals |
| `src/container-runner.ts` | Spawns agent child processes |
| `src/task-scheduler.ts` | Runs scheduled tasks |
| `src/db.ts` | SQLite operations |
| `src/dashboard/server.ts` | Dashboard HTTP server and API routes |
| `container/agent-runner/` | Agent-side code (runs as child process) |
| `container/skills/agent-browser.md` | Browser automation tool (available to all agents via Bash) |

## Skills

| Skill | When to Use |
|-------|-------------|
| `/setup` | First-time installation, authentication, service configuration |
| `/customize` | Adding channels, integrations, changing behavior |
| `/debug` | Agent issues, logs, troubleshooting |

## Development

```bash
npm run dev          # Run with tsx (single run, no watch)
npm run build        # Compile TypeScript (host + agent-runner)
npm test             # Run tests (vitest)
npm run typecheck    # Type-check without emitting
npm run format       # Format with prettier
npm run test:e2e     # End-to-end tests (playwright)
```
