# NanoClaw

Personal Claude assistant. See [README.md](README.md) for philosophy and setup. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for architecture decisions.

## Quick Context

Single Node.js process that connects to WhatsApp, routes messages to Claude Agent SDK running in Docker containers. Each group has isolated filesystem and memory.

- Repo: `StoryFunnels/command-center`
- Node.js >= 20, npm

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Orchestrator: state, message loop, agent invocation |
| `src/channels/whatsapp.ts` | WhatsApp connection, auth, send/receive |
| `src/ipc.ts` | IPC watcher and task processing |
| `src/router.ts` | Message formatting and outbound routing |
| `src/config.ts` | Trigger pattern, paths, intervals |
| `src/container-runner.ts` | Spawns agent containers with mounts |
| `src/task-scheduler.ts` | Runs scheduled tasks |
| `src/db.ts` | SQLite operations |
| `groups/{name}/CLAUDE.md` | Per-group memory (isolated) |
| `container/skills/agent-browser.md` | Browser automation tool (available to all agents via Bash) |
| `infra/README.md` | Infrastructure docs, architecture, budget |
| `.github/workflows/terraform.yml` | CI pipeline: lint, plan, apply |

## Skills

| Skill | When to Use |
|-------|-------------|
| `/setup` | First-time installation, authentication, service configuration |
| `/customize` | Adding channels, integrations, changing behavior |
| `/debug` | Container issues, logs, troubleshooting |

## Infrastructure

Branching: feature -> `staging` -> `master`. CI applies on merge (no manual apply).
See `infra/README.md` for full docs.

- Terraform envs: `infra/envs/staging.tfvars`, `infra/envs/prod.tfvars` (same `.tf` code, separate state)
- GitHub environments: `staging` (deploys from `staging` branch), `production` (deploys from `master`)
- Default branch: `staging`
- Backport changes to all 3 branches: `staging`, `master`, `devmoor`

## Infrastructure

Branching: feature -> `staging` -> `master`. CI applies on merge (no manual apply).
See `infra/README.md` for full docs.

- Terraform envs: `infra/envs/staging.tfvars`, `infra/envs/prod.tfvars` (same `.tf` code, separate state)
- GitHub environments: `staging` (deploys from `staging` branch), `production` (deploys from `master`)
- Default branch: `staging`
- Backport changes to all 3 branches: `staging`, `master`, `devmoor`

## Development

Run commands directly—don't tell the user to run them.

```bash
npm run dev          # Run with hot reload
npm run build        # Compile TypeScript
npm test             # Run tests (vitest)
npm run format       # Format with prettier
./container/build.sh # Rebuild agent container
```

Service management:
```bash
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist
```

## Container Build Cache

Docker caches build layers aggressively. To force a clean rebuild:

```bash
docker builder prune -f
./container/build.sh
```

Always verify after rebuild: `docker run -i --rm --entrypoint wc nanoclaw-agent:latest -l /app/src/index.ts`
