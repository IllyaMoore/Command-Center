#!/bin/bash
# setup-instance.sh — Provision NanoClaw instance after bootstrap.
# Called from userdata.sh, but can also be run manually via SSM:
#   sudo ENVIRONMENT=staging AWS_REGION=us-east-2 bash /opt/nanoclaw/app/infra/scripts/setup-instance.sh
#
# Requires: ENVIRONMENT, AWS_REGION env vars (set by userdata or caller)
# Optional: APP_DIR (defaults to /opt/nanoclaw/app)
# Reads SSM parameters: gcp-oauth-credentials, telegram-chat-jid
set -euo pipefail

: "${ENVIRONMENT:?ENVIRONMENT not set}"
: "${AWS_REGION:?AWS_REGION not set}"
: "${APP_DIR:=/opt/nanoclaw/app}"

ssm_get() {
  aws ssm get-parameter \
    --name "/nanoclaw/${ENVIRONMENT}/$1" \
    --with-decryption \
    --query "Parameter.Value" \
    --output text \
    --region "${AWS_REGION}" 2>/dev/null || echo ""
}

echo "=== Provisioning instance (env=${ENVIRONMENT}) ==="

# --- 1. Google MCP credentials from SSM → 4 file paths ---
GCP_CREDS=$(ssm_get "gcp-oauth-credentials")
if [[ "${GCP_CREDS}" != "CHANGE_ME" && -n "${GCP_CREDS}" ]]; then
  for CRED_DIR in .google-calendar-mcp .gmail-mcp .google-sheets-mcp; do
    sudo -u nanoclaw mkdir -p "/opt/nanoclaw/${CRED_DIR}"
  done
  sudo -u nanoclaw mkdir -p "${APP_DIR}/data"
  printf '%s\n' "${GCP_CREDS}" | sudo -u nanoclaw tee \
    /opt/nanoclaw/.google-calendar-mcp/credentials.json \
    /opt/nanoclaw/.gmail-mcp/gcp-oauth.keys.json \
    /opt/nanoclaw/.google-sheets-mcp/gcp-oauth.keys.json \
    "${APP_DIR}/data/gcp-oauth-credentials.json" > /dev/null
  chmod 600 /opt/nanoclaw/.google-calendar-mcp/credentials.json \
    /opt/nanoclaw/.gmail-mcp/gcp-oauth.keys.json \
    /opt/nanoclaw/.google-sheets-mcp/gcp-oauth.keys.json \
    "${APP_DIR}/data/gcp-oauth-credentials.json"
  echo "  MCP credentials written to 4 paths"
else
  echo "  WARN: gcp-oauth-credentials not set in SSM, skipping MCP setup"
fi
unset GCP_CREDS

# --- 2. Register Telegram group from SSM ---
TG_JID=$(ssm_get "telegram-chat-jid")
if [[ "${TG_JID}" != "CHANGE_ME" && -n "${TG_JID}" ]]; then
  sudo -u nanoclaw node -e "
    const [,, jid, appDir] = process.argv;
    const Database = require(appDir + '/node_modules/better-sqlite3');
    const db = new Database(appDir + '/store/messages.db');
    db.exec(\`CREATE TABLE IF NOT EXISTS registered_groups (
      jid TEXT PRIMARY KEY, name TEXT NOT NULL, folder TEXT NOT NULL UNIQUE,
      trigger_pattern TEXT NOT NULL, added_at TEXT NOT NULL,
      container_config TEXT, requires_trigger INTEGER DEFAULT 1
    )\`);
    db.prepare('INSERT OR REPLACE INTO registered_groups (jid, name, folder, trigger_pattern, added_at, requires_trigger) VALUES (?, ?, ?, ?, ?, ?)')
      .run(jid, 'CEO', 'ceo', '', new Date().toISOString(), 0);
    console.log('  Registered group: ' + jid);
  " -- "${TG_JID}" "${APP_DIR}"
else
  echo "  WARN: telegram-chat-jid not set in SSM, skipping group registration"
fi
unset TG_JID

echo "=== Provisioning complete ==="
