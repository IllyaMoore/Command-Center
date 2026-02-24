# Command Center — Product Requirements Document v3

**Autonomous AI Task Orchestration on NanoClaw Runtime**

Prepared for Samuel Cook | James Cook Holdings
February 18, 2026 | Version 3.4 | Confidential

---

## 1. Executive Summary

Command Center is a personal AI operations platform built on the NanoClaw runtime. It manages specialized agents across James Cook Holdings' organizations through a unified task orchestration layer with three execution paradigms:

**API Execution.** Agents interact with services through structured APIs — Google Calendar, Gmail, Atlassian, Digital Purse — with no ambient access to anything outside their permission scope.

**Headless Browser.** Agents operate a headless Chromium browser inside isolated Docker containers — navigating websites, filling forms, extracting data — with full session recording and audit trails.

**Voice Calling.** Agents place and receive phone calls using AI voice — navigating phone trees, negotiating with customer service, scheduling appointments — with real-time transcription and human handoff capability.

Additionally, the system supports **voice messages** through WhatsApp and Telegram — incoming voice notes are transcribed (STT) for agents to process, and agents can respond with synthesized voice messages (TTS).

Every execution path flows through a human-in-the-loop checkpoint framework. Agents run autonomously until they hit a defined boundary: payment fields, login requirements, form submissions, external communications, uncertainty thresholds, or cost limits. At each checkpoint, you receive a notification with full context and approve, reject, or take over.

The system is built on NanoClaw — a proven runtime that already handles message routing, container isolation, scheduling, IPC, and per-group memory. Command Center extends this foundation with a web dashboard, structured agent workflows, and AWS infrastructure designed for reliable 24/7 operation.

---

## 2. Product Vision

### Core Principles

1. **Build on what works.** NanoClaw is running, tested, and understood. Every new component must integrate with it, not replace it.
2. **Personal use only.** Single user, single deployment. No multi-tenancy overhead. Optimize for Sam's workflows.
3. **Sequential complexity.** Core agent -> more agents -> voice. Each layer must be stable before starting the next.
4. **Minimal custom code.** Claude Agent SDK + MCP servers + NanoClaw runtime handle most orchestration. Custom code only for glue and UI.
5. **Infrastructure as code.** Everything reproducible via Terraform. No manual server configuration.

### Organizations Served

- **Digital Purse Technologies Inc.** — Financial operations, expense tracking, investor relations
- **HE360** — Ukraine Country Director operations, defense technology research, grants
- **The Borderlands Group Inc.** — Charitable foundation, veteran support, impact tracking
- **Personal** — Health, travel, property management, personal admin

---

## 3. Technical Architecture

### 3.1 Architecture Overview

```
                    Internet
                       |
              [Tailscale Mesh VPN]
                       |
        +--------------+--------------+
        |                             |
   [EC2: nanoclaw-primary]    [User devices]
   |-- NanoClaw process             |-- Telegram
   |   |-- WhatsApp channel         |-- Web Dashboard
   |   |-- Telegram channel         +-- WhatsApp
   |   |-- Message router
   |   |-- Task scheduler
   |   +-- SQLite DB
   |-- Agent containers (Docker)
   |   |-- Group: main (CEO)
   |   |-- Group: legal
   |   |-- Group: finance
   |   |-- Group: personal
   |   |-- Group: defense
   |   |-- Group: foundation
   |   |-- Group: airbnb
   |   +-- Group: marketing
   |-- Web Dashboard (static)
   |   +-- Caddy
   +-- MCP servers
       |-- Google Calendar
       |-- Gmail
       |-- Atlassian
       +-- Google Sheets
```

### 3.2 NanoClaw as Runtime

NanoClaw provides the complete runtime foundation:

| Capability | NanoClaw Component | Status |
|---|---|---|
| Message routing | `src/index.ts` — polling loop, trigger matching | Working |
| Channel abstraction | `src/channels/whatsapp.ts`, `src/telegram.ts` | Working |
| Agent isolation | `src/container-runner.ts` — Docker containers | Working |
| Per-group memory | `groups/{name}/CLAUDE.md` — hierarchical | Working |
| Session continuity | SQLite `sessions` table + Claude SDK resume | Working |
| Scheduled tasks | `src/task-scheduler.ts` — cron/interval/once | Working |
| IPC | `src/ipc.ts` — file-based message/task queues | Working |
| Concurrency control | `src/group-queue.ts` — per-group queues, global limit | Working |
| Mount security | `src/mount-security.ts` — external allowlist | Working |
| Database | `src/db.ts` — SQLite via better-sqlite3 | Working |

**What needs to be added:**

| Capability | Approach | Phase |
|---|---|---|
| Headless browser | Chromium + agent-browser CLI in agent container | Already working |
| Google Calendar sync | MCP server + NanoClaw scheduled task | Phase 1 (MVP) |
| Gmail reading | MCP server (OAuth, read-only) | Phase 1 (MVP) |
| Web Dashboard | Extend HTML prototype, serve via reverse proxy | Phase 1 (MVP) |
| Dashboard API | Lightweight HTTP server in NanoClaw process (or separate) | Phase 1 (MVP) |
| Atlassian integration | MCP server (Jira/Confluence) | Phase 2 |
| Google Sheets integration | MCP server (OAuth) | Phase 2 |
| Agent swarm coordination | NanoClaw MCP tool `send_message` between groups | Phase 2 |
| Voice messages (STT) | Deepgram/Whisper transcription of voice notes | Phase 3 |
| Voice messages (TTS) | ElevenLabs synthesis, send as audio | Phase 3 |
| Voice calling | Twilio + Deepgram + ElevenLabs integration | Phase 3 |

### 3.3 Agent Execution Model

All agents run inside Docker containers spawned by NanoClaw's `container-runner.ts`:

1. **Message arrives** via WhatsApp/Telegram/Dashboard
2. **NanoClaw router** matches trigger pattern, identifies target group
3. **Group queue** checks concurrency (max 5 simultaneous containers)
4. **Container spawns** with:
   - Claude Agent SDK (claude-code)
   - Group-specific `CLAUDE.md` (memory)
   - MCP servers for domain tools (Google Calendar, Atlassian, etc.)
   - Headless Chromium + agent-browser CLI (available from Phase 1)
   - Isolated filesystem per group
   - Read-only access to global memory
5. **Agent executes** using Claude with tool access (Bash inside container, MCP tools, headless browser)
6. **Response routes back** through NanoClaw to originating channel
7. **Container idles** for 30 min (configurable), then destroyed

### 3.4 Dashboard Architecture

The HTML prototype (`docs/command-center-final.html`) provides the design system and layout. The dashboard is delivered in Phase 1 (MVP):

- **Static HTML/CSS/JS** served via Caddy on the EC2 instance
- **API backend**: lightweight HTTP endpoint in NanoClaw (or a separate small Node.js service) exposing:
  - `GET /api/agents` — agent status, activity
  - `GET /api/tasks` — scheduled tasks, recent runs
  - `GET /api/messages` — recent messages per group
  - `POST /api/messages` — send message to agent group
  - `GET /api/calendar` — aggregated calendar view
  - `SSE /api/events` — real-time updates
- **Access**: Tailscale-only (no public internet exposure)
- **Auth**: Tailscale identity (device authentication = user authentication)

### 3.5 Technology Stack

| Component | Technology | Justification |
|---|---|---|
| Runtime | Node.js 22 + TypeScript | NanoClaw already uses this |
| Agent framework | Claude Agent SDK (claude-code) | Proven in NanoClaw, full tool access |
| Database | SQLite (better-sqlite3) | Simple, fast, zero-ops, sufficient for single user |
| Containers | Docker (Linux) | Cross-platform; Apple Container for local dev, Docker for EC2 |
| Messaging | Baileys (WhatsApp) + grammy (Telegram) | NanoClaw channels, working |
| Web server | Caddy | Auto-TLS, reverse proxy, Tailscale integration |
| Browser | Chromium + agent-browser CLI | Already bundled in agent container, working |
| MCP servers | Per-integration (Google, Atlassian) | Claude Agent SDK native support |
| STT | OpenAI Whisper API or Deepgram | Voice message transcription |
| TTS | ElevenLabs | Voice message and call synthesis |
| Voice calling | Twilio + Deepgram + ElevenLabs | Phone call infrastructure |
| Infrastructure | Terraform + AWS + Tailscale | Reproducible, cost-effective |
| Logging | Pino (NanoClaw built-in) | Structured JSON logs |

---

## 4. Agent Roster

### Phase 1 MVP — CEO Master (1 agent)

| # | Agent | Group | Responsibilities | Tools (MCP) |
|---|---|---|---|---|
| 1 | **CEO Master** | `main` | Daily briefing, calendar management, email reading, email digest, meeting prep, task scheduling | Google Calendar, Gmail, send_message (IPC), schedule_task |

### Phase 2 — Core Agents (add 3 agents)

| # | Agent | Group | Responsibilities | Tools (MCP) |
|---|---|---|---|---|
| 2 | **Legal** | `legal` | Wise complaint, FCA filings, contract review, compliance tracking | Atlassian (Jira/Confluence), Google Drive, headless browser |
| 3 | **Finance** | `finance` | Expense categorization, P&L reports, transaction tracking, budget monitoring | Google Sheets, Digital Purse API, headless browser |
| 4 | **Personal** | `personal` | Calendar management, health tracking, travel logistics, Airbnb monitoring | Google Calendar, Garmin API, headless browser |

### Phase 3 — Full Roster (add 4 agents)

| # | Agent | Group | Responsibilities |
|---|---|---|---|
| 5 | **Defense Tech** | `defense` | Security research, risk assessment, UAS/UGV analysis, intel synthesis |
| 6 | **Foundation** | `foundation` | Grant tracking, donor relations, impact reporting, USAID portal navigation |
| 7 | **Airbnb Manager** | `airbnb` | Guest comms, booking optimization, turnover management, pricing |
| 8 | **Marketing** | `marketing` | Campaign management, content creation, CRM pipeline |

Agent configuration follows NanoClaw's existing pattern: register group via main channel, each group gets isolated folder + CLAUDE.md + container config.

---

## 5. Infrastructure

### 5.1 Environments

| | Staging | Production |
|---|---|---|
| **Purpose** | Development, testing, prompt iteration | 24/7 autonomous operation |
| **EC2 instance** | t3.medium (2 vCPU / 4 GB) | t3.xlarge (4 vCPU / 16 GB) |
| **EBS** | 50 GB gp3 | 100 GB gp3 |
| **Concurrent containers** | 2 | 5 |
| **WhatsApp** | Separate number (test) | Primary number |
| **Telegram** | Separate bot (test) | Primary bot |
| **Tailscale tag** | `tag:nanoclaw-staging` | `tag:nanoclaw-prod` |
| **S3 bucket** | `nanoclaw-backups-staging` | `nanoclaw-backups-prod` |
| **SSM prefix** | `/nanoclaw/staging/` | `/nanoclaw/prod/` |

Staging uses its own WhatsApp number and Telegram bot to avoid interfering with production. Deployments are tested on staging first, then promoted to production.

### 5.2 Deployment Topology

```
+---------------------------------------------------+
|                 AWS Account                        |
|                                                    |
|  +---------------------------------------------+  |
|  |        VPC: 10.0.0.0/16                     |  |
|  |                                             |  |
|  |  +---------------------------------------+  |  |
|  |  |    Private Subnet: 10.0.1.0/24        |  |  |
|  |  |                                       |  |  |
|  |  |  +-----------------------------+      |  |  |
|  |  |  |  EC2: nanoclaw-prod         |      |  |  |
|  |  |  |  t3.xlarge (4 vCPU/16 GB)   |      |  |  |
|  |  |  |  100 GB gp3 EBS             |      |  |  |
|  |  |  |                             |      |  |  |
|  |  |  |  |-- NanoClaw process       |      |  |  |
|  |  |  |  |-- Docker daemon          |      |  |  |
|  |  |  |  |-- Caddy (dashboard)      |      |  |  |
|  |  |  |  +-- Tailscale daemon       |      |  |  |
|  |  |  +-----------------------------+      |  |  |
|  |  |                                       |  |  |
|  |  |  +-----------------------------+      |  |  |
|  |  |  |  EC2: nanoclaw-staging      |      |  |  |
|  |  |  |  t3.medium (2 vCPU/4 GB)    |      |  |  |
|  |  |  |  50 GB gp3 EBS              |      |  |  |
|  |  |  +-----------------------------+      |  |  |
|  |  +---------------------------------------+  |  |
|  |                                             |  |
|  |  +---------------------------------------+  |  |
|  |  |    Public Subnet: 10.0.2.0/24         |  |  |
|  |  |    NAT Gateway (outbound only)        |  |  |
|  |  +---------------------------------------+  |  |
|  +---------------------------------------------+  |
|                                                    |
|  SSM Parameter Store (/nanoclaw/{env}/)            |
+----------------------------------------------------+
         |
         | Tailscale mesh (WireGuard)
         |
    +----+----+
    |  User   |
    | devices |
    +---------+
```

### 5.3 Why AWS EC2 (Not ECS/Fargate/Lambda)

- **NanoClaw is a single long-running process** that manages WhatsApp connections, polling loops, and container lifecycle. It is not a request-response workload.
- **Docker-in-Docker**: Agent containers are spawned by NanoClaw inside the EC2 instance. ECS/Fargate don't support spawning sibling containers from within a task.
- **Persistent connections**: WhatsApp (Baileys) and Telegram maintain WebSocket connections that must stay alive 24/7. Serverless cold starts would break reconnection.
- **SQLite on local disk**: Zero-latency database access. No network database needed for single-user workload.
- **Cost**: t3.xlarge at ~$120/month (on-demand) or ~$72/month (reserved 1yr) is cheaper than equivalent ECS + RDS + NAT Gateway.

### 5.4 Instance Sizing

**Production (t3.xlarge):**

| Resource | Requirement | Justification |
|---|---|---|
| vCPU | 4 | NanoClaw process (1) + up to 5 concurrent agent containers (lightweight, mostly waiting on API) |
| RAM | 16 GB | NanoClaw (~200 MB) + Docker daemon (~500 MB) + 5 containers with headless Chromium (~1.5 GB each worst case) + OS overhead |
| Storage | 100 GB gp3 | OS (~8 GB) + Docker images (~10 GB) + SQLite DB + group data + session transcripts + logs + voice files |
| Network | NAT Gateway (outbound) | WhatsApp, Telegram, Anthropic API, Google APIs, Atlassian, Twilio. No inbound from internet. |

**Staging (t3.medium):**

| Resource | Requirement | Justification |
|---|---|---|
| vCPU | 2 | NanoClaw + 2 concurrent containers for testing |
| RAM | 4 GB | Sufficient for development and single-agent testing |
| Storage | 50 GB gp3 | Smaller dataset, shorter log retention |

Upgrade path: if 5 concurrent containers is insufficient on production, move to `t3.2xlarge` (8 vCPU / 32 GB) or split agent execution to a second EC2 instance.

### 5.5 Tailscale Integration

Tailscale provides the entire network access layer:

- **No public IP on EC2.** Both instances sit in a private subnet. All access is via Tailscale mesh.
- **Dashboard access**: `https://nanoclaw.tail-net-name.ts.net` — Caddy serves the dashboard, Tailscale handles auth via device identity.
- **SSH access**: `ssh nanoclaw` via Tailscale SSH (no SSH keys to manage, no port 22 exposed).
- **ACLs**: Tailscale ACL policy restricts which devices can reach which services.
- **MagicDNS**: Internal DNS resolution for `nanoclaw` and `nanoclaw-staging` hostnames.

### 5.6 Terraform Structure

```
infra/
|-- main.tf              # Provider, backend, module composition
|-- variables.tf         # Input variables
|-- outputs.tf           # EC2 IP, Tailscale hostname
|-- backend.tf           # S3 backend for state
|
|-- envs/
|   |-- staging.tfvars
|   +-- prod.tfvars
|
|-- modules/
|   |-- networking/       # VPC, subnets, NAT Gateway, route tables
|   +-- compute/          # EC2 instance, security groups, IAM role, userdata.sh
|
+-- scripts/
    +-- deploy.sh         # Build + push container image, restart service
```

### 5.7 EC2 Bootstrap (userdata.sh)

1. Install Docker Engine + configure daemon (log rotation, storage driver)
2. Install Node.js 22 via nvm
3. Install Tailscale, authenticate with auth key from SSM Parameter Store
4. Clone NanoClaw repo (or pull from S3 artifact)
5. Build agent container image
6. Configure systemd service for NanoClaw
7. Install Caddy, configure reverse proxy for dashboard
8. Restore WhatsApp session from backup (if exists)
9. Start NanoClaw service

### 5.8 Cost Estimate (Monthly)

**Production:**

| Service | Spec | Cost |
|---|---|---|
| EC2 t3.xlarge | On-demand | ~$120 |
| EC2 t3.xlarge | 1-yr reserved (no upfront) | ~$72 |
| EBS 100 GB gp3 | | ~$8 |
| NAT Gateway | ~50 GB outbound | ~$35 |
| Tailscale | Personal plan (free) | $0 |
| **Production total (on-demand)** | | **~$163/month** |
| **Production total (reserved)** | | **~$115/month** |

**Staging:**

| Service | Spec | Cost |
|---|---|---|
| EC2 t3.medium | On-demand | ~$30 |
| EBS 50 GB gp3 | | ~$4 |
| NAT Gateway (shared) | Already accounted | $0 |
| **Staging total** | | **~$34/month** |

**Combined:**

| | On-demand | Reserved (prod) |
|---|---|---|
| AWS infrastructure (prod + staging) | ~$197/month | ~$149/month |
| Anthropic API (Claude) | ~$200-400/month | ~$200-400/month |
| Twilio (Phase 3) | ~$30-50/month | ~$30-50/month |
| ElevenLabs (Phase 3) | ~$22/month | ~$22/month |
| Deepgram (Phase 3) | ~$20/month | ~$20/month |
| **MVP total** | **~$397-597/month** | **~$349-549/month** |
| **Phase 3+ total** | **~$469-689/month** | **~$421-641/month** |

---

## 6. Security Model

### 6.1 Trust Boundaries

```
+------------------------------------------------------+
|  UNTRUSTED: External messages (WhatsApp, Telegram)    |
|  Parsed but never executed as code                    |
+------------------------+-----------------------------+
                         |
+------------------------v-----------------------------+
|  HOST PROCESS: NanoClaw (Node.js)                     |
|  - Runs as unprivileged user (not root)               |
|  - Manages container lifecycle                        |
|  - Holds WhatsApp/Telegram sessions                   |
|  - Accesses SQLite DB                                 |
|  - Reads mount allowlist                              |
+------------------------+-----------------------------+
                         |
+------------------------v-----------------------------+
|  SANDBOXED: Agent containers (Docker)                 |
|  - Non-root user (uid 1000)                           |
|  - Isolated filesystem per group                      |
|  - No access to host filesystem (except mounts)       |
|  - No access to Docker socket                         |
|  - No access to other containers                      |
|  - Network: outbound only (no inbound listeners)      |
|  - Destroyed after idle timeout                       |
+------------------------------------------------------+
```

### 6.2 Network Security

**EC2 Instances:**
- **No public IP.** Both instances live in a private subnet.
- **Security Group (inbound):** DENY ALL from internet. Only Tailscale mesh traffic on UDP 41641.
- **Security Group (outbound):** HTTPS (443) for APIs, WhatsApp (5222), Telegram (443). No unrestricted outbound.
- **NAT Gateway:** Allows outbound connections. No inbound connection initiation from internet.

**Container Networking:**
- Containers use Docker bridge network with outbound-only access.
- No container-to-container direct communication (IPC via host filesystem).

### 6.3 Secret Management

| Secret | Storage | Access |
|---|---|---|
| `ANTHROPIC_API_KEY` | AWS SSM Parameter Store (SecureString) | EC2 IAM role -> NanoClaw process -> container env |
| WhatsApp session | Local disk (`store/`) | NanoClaw process only, never mounted into containers |
| Telegram bot token | AWS SSM Parameter Store | NanoClaw process only |
| Tailscale auth key | AWS SSM Parameter Store | EC2 user-data (one-time) |
| Google OAuth tokens | Local disk (encrypted) | MCP server process only |
| ElevenLabs API key | AWS SSM Parameter Store | Injected into container env |
| Twilio credentials | AWS SSM Parameter Store | NanoClaw process only |
| Integration API keys | AWS SSM Parameter Store | Injected per-container based on agent permissions |

**Principles:**
- Agents never see raw API keys. Keys are resolved at the infrastructure layer and injected as environment variables into the container.
- The mount allowlist (`~/.config/nanoclaw/mount-allowlist.json`) is stored on the host, never mounted into containers. Agents cannot modify their own permissions.
- SSM Parameter Store provides encryption at rest (KMS), audit trail (CloudTrail), and IAM-scoped access.
- Staging and production use separate SSM prefixes (`/nanoclaw/staging/`, `/nanoclaw/prod/`) with IAM policies preventing cross-environment access.

### 6.4 Container Isolation (NanoClaw Existing)

NanoClaw's container security model (already implemented):

- **Filesystem isolation:** Each agent container sees only its group folder (`/workspace/groups/{name}/`), global memory (read-only), and explicitly allowed mounts.
- **Mount allowlist:** External JSON config at `~/.config/nanoclaw/mount-allowlist.json` defines which host paths can be mounted. Blocked patterns include: `.ssh`, `.gnupg`, `.aws`, `.env`, credentials, private keys.
- **Non-root execution:** Containers run as `node` user (uid 1000). No `sudo`, no privilege escalation.
- **IPC authorization:** Group identity is verified before inter-process messages are delivered. Non-main groups can only send to themselves.
- **Main group privileges:** Only the `main` group (CEO agent) can write to global memory and send messages to any other group.

### 6.5 Operational Security

- **OS patching:** Amazon Linux 2023 with automatic security updates enabled.
- **Docker images:** Rebuild agent container weekly to pick up base image security patches. Pin `node:22-slim` to specific digest.
- **Tailscale:** Auto-update enabled. Key rotation every 90 days.
- **SQLite:** WAL mode for crash resilience.
- **Disaster recovery:** Full restore to new EC2 instance via Terraform + bootstrap script.

---

## 7. Human-in-the-Loop Checkpoint Framework

### 7.1 Checkpoint Triggers

| Trigger | Behavior | Notification Channel |
|---|---|---|
| Payment/financial entry | Agent stops before any payment field | Telegram |
| Form submission | Before clicking Submit on external forms | Telegram |
| External communications | Before sending emails/messages representing user | Telegram |
| Uncertainty threshold | Agent confidence drops, pauses with context | Telegram |
| Cost threshold | Task consumed more tokens than budget allows | Telegram |
| Voice call actions | Before committing to agreements or payments on calls | Real-time via Telegram |

### 7.2 Implementation in NanoClaw

Checkpoints are implemented via the NanoClaw MCP tool `send_message`:

1. Agent detects checkpoint condition (via system prompt instructions)
2. Agent calls `send_message` to the main group with checkpoint details
3. CEO agent (main) forwards notification to user via Telegram/WhatsApp
4. User responds via Telegram/WhatsApp
5. Response routes through NanoClaw -> IPC -> waiting agent container
6. Agent resumes execution

Checkpoints are prompt-based (agent system prompts define when to pause).

### 7.3 Escalation Chain

For time-sensitive checkpoints:
1. **Telegram push** — immediate
2. **WhatsApp message** — 30 seconds (if no Telegram response)
3. **Phone call** — 60 seconds (Phase 3, via Twilio)

---

## 8. Recurring Tasks

NanoClaw already implements the core scheduler.

### 8.1 Schedule Types (NanoClaw Native)

| Type | NanoClaw Support | Example |
|---|---|---|
| **Cron** | `schedule_type: 'cron'` | `0 7 * * *` (daily 7am) |
| **Interval** | `schedule_type: 'interval'` | `3600000` (every hour) |
| **Once** | `schedule_type: 'once'` | ISO timestamp |

### 8.2 MVP Recurring Tasks

| Task | Agent | Schedule | Description |
|---|---|---|---|
| Daily Briefing | CEO Master | Cron: `0 7 * * *` | Synthesize overnight activity, email digest, send summary to Telegram |
| Meeting Prep | CEO Master | Cron: `0 20 * * *` | Pull tomorrow's calendar, prepare attendee context |
| Email Digest | CEO Master | Cron: `0 9,14,18 * * *` | Scan Gmail for important unread emails, summarize |
| Weekly Review | CEO Master | Cron: `0 8 * * 1` | Week ahead overview, unfinished tasks, upcoming deadlines |

### 8.3 Phase 2 Recurring Tasks

| Task | Agent | Schedule | Description |
|---|---|---|---|
| Expense Scan | Finance | Cron: `0 21 * * *` | Categorize day's transactions, flag anomalies |
| Legal Watch | Legal | Cron: `0 8 * * 1-5` | Scan Atlassian for overdue items, deadline alerts |
| Weekly Finance | Finance | Cron: `0 8 * * 1` | Cross-org P&L, burn rate, outstanding invoices |

---

## 9. Multi-Surface Clients

### 9.1 Telegram Bot (Primary for MVP)

NanoClaw's Telegram channel is already implemented. Enhancements for Command Center:

- Quick-reply buttons for checkpoint approvals
- `/status` command for agent overview
- `/tasks` command for scheduled task management
- Voice message transcription (STT) and voice responses (TTS) — Phase 3

### 9.2 Web Dashboard (Phase 1 MVP)

Based on the existing HTML prototype (`docs/command-center-final.html`):

- **Calendar pane**: Daily/weekly view with task blocks, Google Calendar sync
- **Activity pane**: Real-time agent activity feed, agent status cards
- **Chat pane**: Direct message to any agent, checkpoint responses
- **Settings**: Agent toggles, schedule configuration, integration status

Served via Caddy on EC2, accessible only over Tailscale mesh.

### 9.3 WhatsApp (Existing)

NanoClaw's primary channel. Used for quick interactions and checkpoint responses when Telegram is unavailable. Voice message support (STT/TTS) — Phase 3.

---

## 10. Integrations

| Service | Method | Purpose | Phase |
|---|---|---|---|
| Google Calendar | MCP server (OAuth) | Read/write calendar events, meeting prep | Phase 1 (MVP) |
| Gmail | MCP server (OAuth, read-only) | Email reading, digest, search | Phase 1 (MVP) |
| Google Drive/Docs | MCP server (OAuth) | Document access for Legal, CEO Master | Phase 2 |
| Google Sheets | MCP server (OAuth) | Finance workflows, expense tracking | Phase 2 |
| Atlassian (Jira/Confluence) | MCP server (OAuth) | Legal tracking, project management | Phase 2 |
| Headless Chromium | Bundled in agent container (agent-browser CLI) | Web browsing, form filling, data extraction | Already working |
| Digital Purse API | Custom MCP server | Financial operations for Finance agent | Phase 2 |
| Garmin Connect | REST API via headless browser | Health tracking for Personal agent | Phase 2 |
| Guesty (Airbnb) | REST API / MCP | Booking management for Airbnb agent | Phase 3 |
| GoHighLevel | REST API / MCP | CRM pipeline for Marketing agent | Phase 3 |
| Deepgram | REST API | STT for voice messages and calls | Phase 3 |
| ElevenLabs | REST API | TTS for voice messages and calls | Phase 3 |
| Twilio | REST + WebSocket | Voice calling infrastructure | Phase 3 |

---

## 11. Deliverables & Phases

### Phase 1 — MVP (1 month)

**Goal:** CEO Master agent on AWS EC2, accessible via Telegram + WhatsApp. Daily briefings, calendar management, email reading running autonomously.

| Deliverable | Estimate |
|---|---|
| **Infrastructure bootstrap.** Terraform modules (VPC, EC2, SSM). Staging and production EC2 running with Docker + Tailscale. NanoClaw deployed to staging, WhatsApp/Telegram connected. GitHub CLI in container. | 6.5 days |
| **CEO Master agent + Google Calendar + Gmail.** Main group configured. Daily briefing cron task. Google Calendar read/write via MCP. Gmail read-only MCP. Email digest cron. Meeting prep cron. Fireflies via Gmail. | 4.5 days |
| **Model routing.** Sonnet 4.6 default for all agents. Per-task model override (Sonnet for data gathering, Opus for analysis). | 1 day |
| **Google Auth for 3 additional accounts.** OAuth setup for samuelpncook@gmail.com, samuel.cook@storypages.ai, samuel.cook@borderlands.com.ua. Multi-account Gmail/Calendar MCP. | 1.5 days |
| **Dashboard API + Web Dashboard v1.** HTTP API endpoints in NanoClaw. Extend HTML prototype with real API integration. Calendar pane, activity feed, chat pane. Deploy via Caddy over Tailscale. | 6 days |
| **Stabilization.** Promote to production. End-to-end testing. Prompt tuning. Dashboard QA. | 3 days |
| **Phase 1 base** | **22 days (4.5 weeks)** |
| **Phase 1 with 30% buffer** | **29 days (6 weeks)** |

**MVP exit criteria:**
- CEO Master running 24/7 on production EC2
- Daily briefing delivered to Telegram by 7am every day
- Email digest 3x daily
- Meeting prep every evening
- Interaction via Telegram + WhatsApp
- Web Dashboard accessible via Tailscale with calendar, activity feed, and chat

### Phase 2 — Core Expansion

**Goal:** 4 agents total. Web Dashboard. Headless browser. Agent swarm coordination.

| Deliverable | Estimate |
|---|---|
| **Legal agent + Atlassian MCP.** Legal group configured. Jira/Confluence integration. Wise complaint workflow. Weekly legal watch cron. | 4 days |
| **Finance agent + Google Sheets.** Finance group configured. Expense categorization workflow. Weekly P&L report cron. | 3 days |
| **Personal agent.** Personal group configured. Calendar management. Health tracking (Oura Ring API, Cronometer, Garmin headless browser). | 3.5 days |
| **Agent swarm coordination.** CEO Master routes tasks to other agents via IPC. Cross-agent dependency chains. | 3 days |
| **Stabilization.** Prompt tuning across 4 agents. Load testing with concurrent containers. | 3 days |
| **Phase 2 base** | **16.5 days (3.5 weeks)** |
| **Phase 2 with 30% buffer** | **21 days (4.5 weeks)** |

**Phase 2 exit criteria:**
- 4 agents running 24/7 without manual intervention
- Dashboard shows live status for all 4 agents
- CEO Master successfully routes tasks to Legal, Finance, Personal

### Phase 3 — Full Roster & Voice

**Goal:** All 8 agents operational. Voice messages via messengers. Voice calling capability.

| Deliverable | Estimate |
|---|---|
| **Defense Tech + Foundation agents.** Domain groups configured. Digital Purse API integration for Finance. | 3 days |
| **Airbnb + Marketing agents.** Guesty integration. GoHighLevel integration. Full 8-agent roster running. | 3 days |
| **Voice messages (STT).** Incoming WhatsApp/Telegram voice notes transcribed via Deepgram or Whisper. Agent receives text transcription. | 4 days |
| **Voice messages (TTS).** Agent can respond with synthesized voice messages via ElevenLabs. Sent as audio files through WhatsApp/Telegram. | 4 days |
| **Voice calling.** Twilio integration via @openclaw/voice-call plugin (primary) or custom Deepgram+ElevenLabs MCP (fallback). Tailscale Funnel for webhooks. Phone tree navigation, appointment scheduling. | 4 days |
| **Multi-provider model support.** Gemini + Grok API integration. Research Claude Agent SDK compatibility. API key management in SSM. | 3 days |
| **Human handoff + Dashboard v2.** Bridge user into active call. Dashboard: voice call history, improved calendar view. | 4 days |
| **Stabilization.** Full roster load testing. Voice quality tuning. Prompt refinement across all 8 agents. | 4 days |
| **Phase 3 base** | **32 days (6.5 weeks)** |
| **Phase 3 with 30% buffer** | **42 days (8.5 weeks)** |

**Phase 3 exit criteria:**
- 8 agents running concurrently without resource contention
- Voice messages work bidirectionally on WhatsApp and Telegram
- Agent can complete a phone call (e.g., schedule an appointment) without manual intervention
- Human handoff works within 30 seconds of escalation

---

## 12. Estimates

### Phase Summary

| Phase | Scope | Base | With 30% Buffer |
|---|---|---|---|
| Phase 1 (MVP) | Infra + CEO Master + Calendar + Gmail + Dashboard + Model Routing + Multi-Account Auth | 22 days (4.5 weeks) | **29 days (6 weeks)** |
| Phase 2 | 3 agents + swarm + health APIs | 16.5 days (3.5 weeks) | **21 days (4.5 weeks)** |
| Phase 3 | 4 agents + voice messages + voice calling + multi-provider models | 32 days (6.5 weeks) | **42 days (8.5 weeks)** |
| **Total** | | **70.5 days (14 weeks)** | **92 days (18.5 weeks)** |

### Monthly Operational Cost (Steady State)

| Item | MVP | Phase 3+ |
|---|---|---|
| AWS infrastructure (prod + staging) | ~$149-197 | ~$149-197 |
| Anthropic API (Claude) | ~$200-400 | ~$200-400 |
| Twilio | -- | ~$30-50 |
| ElevenLabs | -- | ~$22 |
| Deepgram | -- | ~$20 |
| **Total** | **~$349-597** | **~$421-689** |

---

## 13. Success Metrics

| Metric | Target | Phase |
|---|---|---|
| Agent uptime | >99% (measured by daily briefing delivery) | MVP |
| Task completion rate | >85% of tasks complete without manual intervention beyond checkpoints | MVP |
| Time saved | 8+ hours/week of manual task delegation | Phase 2 |
| Active agents | 8 running concurrently | Phase 3 |
| Infrastructure cost | <$200/month AWS (excluding Anthropic API) | All |
| API cost | <$400/month Anthropic spend via model routing (Haiku for simple, Sonnet for complex) | All |
| Voice message accuracy | >95% STT accuracy on English voice notes | Phase 3 |
| Voice call success | >70% of calls achieve objective on first attempt | Phase 3 |

---

## 14. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **WhatsApp connection instability** | High | Agent misses messages, sessions drop | NanoClaw has reconnection with backoff. Telegram as fallback channel. |
| **Agent prompt quality** | High | Agents produce poor results or hallucinate actions | Budget time for prompt engineering per agent. Test on staging before prod. CEO Master reviews other agents' outputs. |
| **Anthropic API cost overrun** | Medium | Monthly bill exceeds budget | Model routing: Haiku for simple tasks, Sonnet for complex. Token budgets per scheduled task. |
| **EC2 instance failure** | Low | All agents offline | Terraform reproduces infrastructure in minutes. |
| **WhatsApp ban** | Medium | Primary channel lost | Telegram as equal-priority channel. Dashboard as backup. Avoid high message volume and automated bulk messaging. |
| **Voice quality issues** | Medium | Poor STT/TTS experience | Use high-quality providers (Deepgram, ElevenLabs). Fallback to text for critical communications. |
| **Integration API changes** | Medium | MCP servers break | Pin API versions. MCP servers are isolated -- one breaking doesn't affect others. |
| **Scope creep** | High | Phases extend | 1-agent MVP is hard limit for Phase 1. Weekly progress review against this document. |
| **NanoClaw-to-Docker migration issues** | Medium | Container runner behaves differently on Docker vs Apple Container | NanoClaw already has Docker support. Test on staging during infrastructure bootstrap. |

---

## Appendix A: NanoClaw Capability Map

| NanoClaw Feature | Source File | Command Center Usage |
|---|---|---|
| Message polling loop | `src/index.ts` | Core message routing for all agents |
| WhatsApp channel | `src/channels/whatsapp.ts` | Primary messaging channel |
| Telegram channel | `src/telegram.ts` | Secondary messaging + checkpoint notifications |
| Container spawning | `src/container-runner.ts` | Agent execution in isolated Docker containers |
| Group queue | `src/group-queue.ts` | Concurrency control (max 5 containers) |
| SQLite DB | `src/db.ts` | Messages, sessions, tasks, audit |
| Task scheduler | `src/task-scheduler.ts` | Cron/interval/once scheduled tasks |
| IPC | `src/ipc.ts` | Cross-agent communication via CEO Master |
| Mount security | `src/mount-security.ts` | Agent filesystem access control |
| MCP tools | `container/agent-runner/src/ipc-mcp-stdio.ts` | send_message, schedule_task, list/pause/resume/cancel |
| Session resume | Claude Agent SDK `createSession`/`send` | Conversation continuity per group |
| Global memory | `groups/CLAUDE.md` | Shared knowledge across all agents |
| Group memory | `groups/{name}/CLAUDE.md` | Per-agent isolated memory |
| Headless browser | `container/skills/agent-browser/`, Chromium in Dockerfile | Web browsing, forms, screenshots, data extraction |

## Appendix B: Glossary

| Term | Definition |
|---|---|
| **NanoClaw** | Lightweight Claude assistant runtime. Single Node.js process managing message routing, container lifecycle, scheduling, and IPC. |
| **Group** | An isolated agent context in NanoClaw. Each group has its own folder, CLAUDE.md memory, container config, and session. |
| **Main group** | The admin group (CEO Master). Has write access to global memory and can send IPC messages to any other group. |
| **MCP** | Model Context Protocol. Standard for providing tools to Claude agents. NanoClaw exposes `send_message` and `schedule_task` via MCP. |
| **Agent container** | Docker container running Claude Agent SDK (claude-code) with headless Chromium, isolated filesystem, and MCP tools. |
| **Checkpoint** | A point where an agent pauses execution and requests human approval before continuing. |
| **Tailscale mesh** | WireGuard-based VPN that connects EC2 instance and user devices. Provides encrypted access without public IP exposure. |
| **STT** | Speech-to-Text. Converting voice audio to text (Deepgram/Whisper). |
| **TTS** | Text-to-Speech. Converting text to voice audio (ElevenLabs). |
| **Mount allowlist** | External JSON config defining which host paths agents can access. Stored outside the project, not accessible to agents. |

---

*End of PRD | Command Center v3.3*
*Built on NanoClaw runtime | AWS EC2 + Tailscale + Terraform*
