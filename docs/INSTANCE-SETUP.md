# Instance Setup Guide

How to set up a NanoClaw instance after Terraform creates or replaces it. Covers both staging and production.

## What Terraform Handles Automatically

The `userdata.sh` bootstrap script runs on first boot and handles:
- Node.js 22, Tailscale, GitHub CLI, Chromium, Claude Code CLI
- Clone repo, `npm ci`, build
- Write `.env` from SSM parameters
- Create swap (1GB), systemd service with `MemoryMax=1536M`
- Start NanoClaw

**After bootstrap completes, NanoClaw is running but has no registered groups or Google MCP credentials.**

## What You Must Do Manually

### 1. Find Instance ID and Tailscale Hostname

```bash
# Get instance ID
aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=*nanoclaw*<ENV>*" "Name=instance-state-name,Values=running" \
  --query "Reservations[].Instances[].[InstanceId,LaunchTime]" \
  --output table --region us-east-2 --profile sam

# Get Tailscale hostname (replace INSTANCE_ID)
aws ssm start-session \
  --target <INSTANCE_ID> \
  --region us-east-2 --profile sam \
  --document-name AWS-StartNonInteractiveCommand \
  --parameters '{"command":["bash -c \"tailscale status --self | head -1\""]}'
```

Tailscale hostname format: `nanoclaw-<environment>-<N>.tail8e7cd9.ts.net`

### 2. Register Telegram Group

```bash
aws ssm start-session \
  --target <INSTANCE_ID> \
  --region us-east-2 --profile sam \
  --document-name AWS-StartNonInteractiveCommand \
  --parameters '{"command":["bash -c \"sudo -u nanoclaw node -e \\\"const db=require('"'"'/opt/nanoclaw/app/node_modules/better-sqlite3'"'"')('/opt/nanoclaw/app/store/messages.db'); db.prepare('"'"'INSERT OR REPLACE INTO registered_groups (jid, name, folder, trigger_pattern, requires_trigger) VALUES (?, ?, ?, ?, ?)'"'"').run('tg:914543095', 'Ilya', 'ceo', null, 0); console.log(JSON.stringify(db.prepare('"'"'SELECT * FROM registered_groups'"'"').all()))\\\"\""]}'
```

| Field | Value | Notes |
|-------|-------|-------|
| `jid` | `tg:914543095` | Telegram chat ID (private chat with Ilya) |
| `name` | `Ilya` | Display name |
| `folder` | `ceo` | Maps to `groups/ceo/CLAUDE.md` |
| `requires_trigger` | `0` | No @mention needed in private chat |

To find a Telegram chat ID, send a message to the bot and check NanoClaw logs:
```bash
aws ssm start-session ... --parameters '{"command":["bash -c \"sudo journalctl -u nanoclaw --no-pager -n 50 | grep -i '"'"'chat.*not registered'"'"'\""]}'
```

### 3. Upload Google MCP Credentials

See [GOOGLE-MCP-SETUP.md](GOOGLE-MCP-SETUP.md) for full details on creating GCP OAuth credentials.

**Important:** Redirect URIs must match the current Tailscale hostname. If the instance was replaced and got a new hostname, update redirect URIs in [GCP Console](https://console.cloud.google.com/apis/credentials) first:
```
http://<TAILSCALE_HOSTNAME>:3000/api/auth/google-calendar/callback
http://<TAILSCALE_HOSTNAME>:3000/api/auth/gmail/callback
http://<TAILSCALE_HOSTNAME>:3000/api/auth/google-sheets/callback
```

Upload credentials to all 3 MCP paths:
```bash
# Base64-encode locally
B64=$(base64 -w 0 < client_secret_web.json)

# Upload to instance
aws ssm start-session \
  --target <INSTANCE_ID> \
  --region us-east-2 --profile sam \
  --document-name AWS-StartNonInteractiveCommand \
  --parameters "{\"command\":[\"bash -c \\\"sudo -u nanoclaw mkdir -p /opt/nanoclaw/.google-calendar-mcp /opt/nanoclaw/.gmail-mcp /opt/nanoclaw/.google-sheets-mcp && echo $B64 | base64 -d | sudo -u nanoclaw tee /opt/nanoclaw/.google-calendar-mcp/credentials.json /opt/nanoclaw/.gmail-mcp/gcp-oauth.keys.json /opt/nanoclaw/.google-sheets-mcp/gcp-oauth.keys.json > /dev/null && echo OK\\\"\"]}"
```

Also place a copy at `data/gcp-oauth-credentials.json` (used by Dashboard for OAuth flow):
```bash
aws ssm start-session \
  --target <INSTANCE_ID> \
  --region us-east-2 --profile sam \
  --document-name AWS-StartNonInteractiveCommand \
  --parameters "{\"command\":[\"bash -c \\\"echo $B64 | base64 -d | sudo -u nanoclaw tee /opt/nanoclaw/app/data/gcp-oauth-credentials.json > /dev/null && sudo chmod 600 /opt/nanoclaw/app/data/gcp-oauth-credentials.json && echo OK\\\"\"]}"
```

### 4. Update DASHBOARD_URL (if needed)

Userdata writes `DASHBOARD_URL=http://<tailscale-ip>:3000` to `.env`. If OAuth redirects use the hostname (not IP), update it:

```bash
aws ssm start-session \
  --target <INSTANCE_ID> \
  --region us-east-2 --profile sam \
  --document-name AWS-StartNonInteractiveCommand \
  --parameters '{"command":["bash -c \"sudo sed -i '"'"'s|DASHBOARD_URL=.*|DASHBOARD_URL=http://<TAILSCALE_HOSTNAME>:3000|'"'"' /opt/nanoclaw/app/.env && grep DASHBOARD_URL /opt/nanoclaw/app/.env\""]}'
```

### 5. Restart NanoClaw

```bash
aws ssm start-session \
  --target <INSTANCE_ID> \
  --region us-east-2 --profile sam \
  --document-name AWS-StartNonInteractiveCommand \
  --parameters '{"command":["bash -c \"sudo systemctl restart nanoclaw && sleep 3 && sudo systemctl is-active nanoclaw && sudo journalctl -u nanoclaw --no-pager -n 10\""]}'
```

### 6. Complete OAuth Flow

Open Dashboard at `http://<TAILSCALE_HOSTNAME>:3000` and click **Connect** for each Google service (Calendar, Gmail, Sheets).

## Verification Checklist

```bash
# All-in-one check
aws ssm start-session \
  --target <INSTANCE_ID> \
  --region us-east-2 --profile sam \
  --document-name AWS-StartNonInteractiveCommand \
  --parameters '{"command":["bash -c \"echo === SERVICE === && sudo systemctl is-active nanoclaw && echo === GROUPS === && sudo -u nanoclaw node -e \\\"const db=require('"'"'/opt/nanoclaw/app/node_modules/better-sqlite3'"'"')('/opt/nanoclaw/app/store/messages.db');console.log(JSON.stringify(db.prepare('"'"'SELECT jid,name FROM registered_groups'"'"').all()))\\\" && echo === MCP CREDS === && sudo ls -la /opt/nanoclaw/.google-calendar-mcp/credentials.json /opt/nanoclaw/.gmail-mcp/gcp-oauth.keys.json /opt/nanoclaw/.google-sheets-mcp/gcp-oauth.keys.json 2>&1 && echo === DASHBOARD CREDS === && sudo ls -la /opt/nanoclaw/app/data/gcp-oauth-credentials.json 2>&1 && echo === SWAP === && swapon --show && echo === MEMORY LIMIT === && systemctl show nanoclaw -p MemoryMax\""]}'
```

Expected output:
- SERVICE: `active`
- GROUPS: `[{"jid":"tg:914543095","name":"Ilya"}]`
- MCP CREDS: 3 files present
- SWAP: 1G enabled
- MemoryMax: `1610612736` (1536M in bytes)

## Environment Parameters

| | Staging | Production |
|---|---------|------------|
| Branch | `staging` | `master` |
| Instance tag | `*nanoclaw*staging*` | `*nanoclaw*prod*` |
| SSM prefix | `/nanoclaw/staging/` | `/nanoclaw/prod/` |
| Tailscale hostname | `nanoclaw-staging-*` | `nanoclaw-production-*` |
| GCP redirect URIs | Update per hostname | Update per hostname |
