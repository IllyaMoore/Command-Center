# New Feature Requests from Sam (2026-02-18)

## 1. Default Model -> Sonnet 4.6 (Ticket #1)
**Priority:** HIGH (cost critical)
**Complexity:** Low (config change)

Change `agents.defaults.model` to `anthropic/claude-sonnet-4-6`, keep ability to escalate to Opus per-session/per-cron. Target ~80% Sonnet / 20% Opus split. Sam mentions `skills/model-router/SKILL.md` for routing logic -- need to check if this exists or is a wishlist item.

## 2. OpenClaw CLI in Sandbox (Ticket #2)
**Priority:** HIGH
**Complexity:** Medium

`openclaw` CLI not available inside sandbox container. `/usr/lib/node_modules/openclaw/` is empty/missing. Sam wants CLI access + ability to create/register/activate skills from within sandbox. Needs research -- CLI is a Node.js app with dependencies, need to understand if this is supported.

## 3. Google Auth for 3 Additional Accounts (Ticket #3)
**Priority:** HIGH
**Complexity:** Medium (manual work x3)

Accounts to add (Gmail + Calendar for each):
- `samuelpncook@gmail.com` (personal)
- `samuel.cook@storypages.ai`
- `samuel.cook@borderlands.com.ua`

Each requires separate OAuth flow via SSM. May need credentials for each Google Cloud project/domain.

## 4. Cron Job Setup (Ticket #5)
**Priority:** HIGH
**Complexity:** Medium

Daily briefing at 7PM CT (01:00 UTC). Requirements:
- Cron capability configured in OpenClaw
- Per-job model selection (Sonnet for data gathering, Opus for analysis)
- Deliver output to WhatsApp channel

Needs research into OpenClaw `cron` config.

## 5. Health API Integrations (Ticket #7)
**Priority:** LOW
**Complexity:** High (custom integrations)

APIs: Garmin Connect, Oura Ring, Cronometer. Currently analyzing health data via screenshots. Each needs API keys + possibly custom skills.

## 6. Fireflies Integration (Ticket #8)
**Priority:** LOW
**Complexity:** Low

Fireflies meeting recaps come via email. If recaps arrive at a connected Gmail account, this may already work -- bot can read emails. No custom integration needed.

## 7. Agent Instances (Ticket #10)
**Priority:** LOW
**Complexity:** High (architectural)

Sam designed 5 agent roles. Needs multi-agent deployment -- either separate agents in OpenClaw config or separate instances.

## 8. Voice Agent Calling (Ticket #11)
**Priority:** LOW
**Complexity:** High

Phone calls on Sam's behalf. Twilio plan already exists at `.claude/plans/delightful-drifting-sedgewick.md`. Not yet implemented.

## 9. Additional Models -- Gemini + Grok (Ticket #12)
**Priority:** LOW
**Complexity:** Medium

Gemini and Grok model access for comparison/fallback. Needs API keys + config for additional providers.

## 10. GitHub Integration (Ticket #13)
**Priority:** MEDIUM
**Complexity:** Medium

`gh` CLI not installed in sandbox. Needs gh binary in Docker image + authentication (PAT token). James Cook Holdings repo. Similar approach to gog integration.
