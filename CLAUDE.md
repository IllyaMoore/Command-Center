# NanoClaw

Personal Claude assistant. See [README.md](README.md) for philosophy and setup. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for architecture decisions.

## Quick Context

Single Node.js process that connects to WhatsApp, routes messages to Claude Agent SDK running as child processes. Each group has isolated filesystem and memory.

- Repo: `StoryFunnels/command-center`
- Node.js >= 20, npm
- Auth: `ANTHROPIC_API_KEY` only. You're NOT allowed `CLAUDE_CODE_OAUTH_TOKEN`

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Orchestrator: state, message loop, agent invocation |
| `src/channels/whatsapp.ts` | WhatsApp connection, auth, send/receive |
| `src/ipc.ts` | IPC watcher and task processing |
| `src/router.ts` | Message formatting and outbound routing |
| `src/config.ts` | Trigger pattern, paths, intervals |
| `src/container-runner.ts` | Spawns agent child processes |
| `src/task-scheduler.ts` | Runs scheduled tasks |
| `src/db.ts` | SQLite operations |
| `groups/{name}/CLAUDE.md` | Per-group memory (isolated) |
| `container/agent-runner/` | Agent-side code (runs as child process) |
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
- AL2023 AMI filter: use `al2023-ami-2023*-x86_64` (not `al2023-ami-*-x86_64`) to exclude minimal variant which lacks SSM agent
- VPC endpoint gotcha: deleting endpoints can leave orphaned Route 53 private hosted zones (owned by vpce.amazonaws.com) that block new endpoint creation with `private_dns_enabled`
- Old VPC `vpc-01be8be65db9be59d` still exists as orphan (orphaned hosted zones, needs AWS support ticket)
- Current VPC: `vpc-0cafee8401c0089ad`, instance: `i-0df8d67eb1b8bac56`

## Agents

| Agent | When to Use |
|-------|-------------|
| `verify-app` | Verify completed Linear tasks against code, or check branch PR-readiness |
| `infra-reviewer` | Review PRs that touch `infra/` or `.github/workflows/`, review planned infra tasks |

When reviewing a PR that modifies Terraform or CI workflow files, always run `infra-reviewer` before approving.

## Pre-commit Workflow

Before creating any git commit, run the `code-simplifier` subagent on all staged files (TypeScript, JavaScript, CSS). This is mandatory — never skip this step.

## Development

Run commands directly—don't tell the user to run them.

```bash
npm run dev          # Run with hot reload
npm run build        # Compile TypeScript (host + agent-runner)
npm test             # Run tests (vitest)
npm run format       # Format with prettier
```

Service management:
```bash
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist
```
