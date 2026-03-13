# Google MCP Setup on AWS

Guide for setting up Google Calendar, Gmail, and Sheets MCP integrations on an AWS EC2 instance running NanoClaw.

## Prerequisites

- EC2 instance running NanoClaw with Tailscale connected
- GCP project with OAuth 2.0 credentials (Web application type)
- Tailscale MagicDNS hostname known (e.g. `nanoclaw-prod.tail8e7cd9.ts.net`)

## Step 1: Create GCP OAuth Client (Web)

1. Go to [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)
2. Select project `nanoclaw-487711` (or create new)
3. Create OAuth 2.0 Client ID → **Web application**
4. Add **Authorized redirect URIs** (replace hostname with your Tailscale hostname):
   ```
   http://<TAILSCALE_HOSTNAME>:3000/api/auth/google-calendar/callback
   http://<TAILSCALE_HOSTNAME>:3000/api/auth/gmail/callback
   http://<TAILSCALE_HOSTNAME>:3000/api/auth/google-sheets/callback
   ```
5. Download the JSON file — it will look like:
   ```json
   {
     "web": {
       "client_id": "...",
       "project_id": "...",
       "auth_uri": "https://accounts.google.com/o/oauth2/auth",
       "token_uri": "https://oauth2.googleapis.com/token",
       "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
       "client_secret": "...",
       "redirect_uris": ["http://..."]
     }
   }
   ```

> **Important**: Must be **Web** type, not Desktop. Desktop uses `http://localhost` redirects which don't work on a remote server.

## Step 2: Enable Google APIs

In GCP Console → APIs & Services → Enable:
- Google Calendar API
- Gmail API
- Google Sheets API

## Step 3: Upload Credentials to Server

Each MCP server reads credentials from a specific path under the `nanoclaw` user's home (`/opt/nanoclaw/`):

| Service | Credential file path |
|---------|---------------------|
| Calendar | `/opt/nanoclaw/.google-calendar-mcp/credentials.json` |
| Gmail | `/opt/nanoclaw/.gmail-mcp/gcp-oauth.keys.json` |
| Sheets | `/opt/nanoclaw/.google-sheets-mcp/gcp-oauth.keys.json` |

All three files contain the **same** OAuth client JSON (the file downloaded in Step 1).

### Upload via SSM (base64 method)

```bash
# 1. Base64-encode the credentials file locally
B64=$(cat client_secret_web.json | base64 -w 0)

# 2. Write to all 3 paths on the server
aws ssm start-session \
  --target <INSTANCE_ID> \
  --region us-east-2 \
  --profile <PROFILE> \
  --document-name AWS-StartNonInteractiveCommand \
  --parameters "{\"command\":[\"bash -c \\\"echo $B64 | base64 -d | sudo -u nanoclaw tee /opt/nanoclaw/.google-calendar-mcp/credentials.json /opt/nanoclaw/.gmail-mcp/gcp-oauth.keys.json /opt/nanoclaw/.google-sheets-mcp/gcp-oauth.keys.json > /dev/null && sudo chmod 600 /opt/nanoclaw/.google-calendar-mcp/credentials.json /opt/nanoclaw/.gmail-mcp/gcp-oauth.keys.json /opt/nanoclaw/.google-sheets-mcp/gcp-oauth.keys.json && echo OK\\\"\"]}"
```

### Verify files

```bash
aws ssm start-session \
  --target <INSTANCE_ID> \
  --region us-east-2 \
  --profile <PROFILE> \
  --document-name AWS-StartNonInteractiveCommand \
  --parameters '{"command":["bash -c \"sudo cat /opt/nanoclaw/.google-calendar-mcp/credentials.json | python3 -m json.tool > /dev/null && echo Calendar OK; sudo cat /opt/nanoclaw/.gmail-mcp/gcp-oauth.keys.json | python3 -m json.tool > /dev/null && echo Gmail OK; sudo cat /opt/nanoclaw/.google-sheets-mcp/gcp-oauth.keys.json | python3 -m json.tool > /dev/null && echo Sheets OK\""]}'
```

## Step 4: Restart NanoClaw

```bash
aws ssm start-session \
  --target <INSTANCE_ID> \
  --region us-east-2 \
  --profile <PROFILE> \
  --document-name AWS-StartNonInteractiveCommand \
  --parameters '{"command":["bash -c \"sudo systemctl restart nanoclaw && sleep 2 && sudo systemctl is-active nanoclaw\""]}'
```

## Step 5: Complete OAuth Flow via Dashboard

1. Open Dashboard: `http://<TAILSCALE_HOSTNAME>:3000`
2. In the **Google Workspace** section, all 3 services should show "Not authorized" with a **Connect** button
3. Click **Connect** for each service → Google OAuth consent screen → authorize
4. After successful auth, status changes to **Connected**

### What happens during OAuth flow

1. Dashboard generates an OAuth URL using the client credentials + redirect URI
2. Browser redirects to Google consent screen
3. After user approves, Google redirects back to `http://<TAILSCALE_HOSTNAME>:3000/api/auth/<service>/callback`
4. Dashboard exchanges the auth code for tokens and saves them to disk:

| Service | Token file path |
|---------|----------------|
| Calendar | `/opt/nanoclaw/.config/google-calendar-mcp/tokens.json` |
| Gmail | `/opt/nanoclaw/.gmail-mcp/credentials.json` (overwrites — Gmail MCP uses same file for tokens) |
| Sheets | `/opt/nanoclaw/.google-sheets-mcp/credentials.json` |

> **Note**: Gmail tokens go to the same `credentials.json` path but with a different structure (flat token object instead of OAuth client config). The `gcp-oauth.keys.json` file remains unchanged.

## Troubleshooting

### `redirect_uri_mismatch`
- The redirect URI in the OAuth request doesn't match what's configured in GCP Console
- Check `DASHBOARD_URL` in `.env` matches the Tailscale hostname
- Verify redirect URIs in GCP Console match exactly (including port and path)

### "Not configured" (no Connect button)
- Credential file is missing or contains invalid JSON
- Verify file exists and is parseable: `python3 -m json.tool < file.json`
- Must have `{"web": {...}}` or `{"installed": {...}}` structure

### Token expiry
- Google refresh tokens don't expire unless revoked or unused for 6 months
- If status shows "expired", click Connect again to re-authorize

### Instance replacement (Terraform)
- Changing userdata triggers EC2 instance replacement — **all tokens are lost**
- After replacement: re-upload credentials (Step 3), restart (Step 4), re-authorize (Step 5)
- Credentials (client_id/secret) don't change, only tokens need re-authorization

## Architecture Notes

### Credential flow
```
GCP Console → client_secret.json → 3 credential files on disk
                                          ↓
Dashboard OAuth flow → token files on disk
                                          ↓
Agent-runner reads credentials → passes to MCP servers as env/args
                                          ↓
MCP servers (npx) use tokens to call Google APIs
```

### Why Web type, not Desktop?
- Desktop OAuth uses `http://localhost` redirect — works only when browser and server are on the same machine
- On AWS, the browser is on your laptop but the server is remote
- Web type allows custom redirect URIs pointing to the Tailscale hostname

### Agent-runner Web→Installed normalization
The Calendar MCP package (`@cocal/google-calendar-mcp`) expects `{"installed": {...}}` format. The agent-runner (`container/agent-runner/src/index.ts`) automatically normalizes Web credentials to Installed format at runtime, so the same Web credentials file works for both Dashboard OAuth and MCP server.
