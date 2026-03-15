#!/bin/bash
# setup-instance.sh — Provision NanoClaw instance after bootstrap.
# Called from userdata.sh, but can also be run manually via SSM:
#   sudo ENVIRONMENT=staging AWS_REGION=us-east-2 bash /opt/nanoclaw/app/infra/scripts/setup-instance.sh
#
# Requires: ENVIRONMENT, AWS_REGION env vars (set by userdata or caller)
# Optional: APP_DIR (defaults to /opt/nanoclaw/app)
# Reads SSM parameters: gcp-oauth-credentials, telegram-chat-jid
#
# NOTE: Failures here are non-fatal — NanoClaw must start even if
# provisioning partially fails (group can be registered manually).
set -uo pipefail

: "${ENVIRONMENT:?ENVIRONMENT not set}"
: "${AWS_REGION:?AWS_REGION not set}"
: "${APP_DIR:=/opt/nanoclaw/app}"

ERRORS=0

ssm_get() {
  local stderr value exit_code
  stderr=$(mktemp)
  value=$(aws ssm get-parameter \
    --name "/nanoclaw/${ENVIRONMENT}/$1" \
    --with-decryption \
    --query "Parameter.Value" \
    --output text \
    --region "${AWS_REGION}" 2>"${stderr}") && exit_code=0 || exit_code=$?
  if [[ ${exit_code} -ne 0 ]]; then
    if grep -q "ParameterNotFound" "${stderr}"; then
      rm -f "${stderr}"
      echo ""
      return 0
    fi
    echo "ERROR: Failed to read SSM parameter /nanoclaw/${ENVIRONMENT}/$1:" >&2
    cat "${stderr}" >&2
    rm -f "${stderr}"
    return 1
  fi
  rm -f "${stderr}"
  echo "${value}"
}

echo "=== Provisioning instance (env=${ENVIRONMENT}) ==="

# --- 1. Google MCP credentials from SSM → 4 file paths ---
GCP_CREDS=$(ssm_get "gcp-oauth-credentials") || GCP_CREDS=""
if [[ "${GCP_CREDS}" != "CHANGE_ME" && -n "${GCP_CREDS}" ]]; then
  if (
    set -e
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
  ); then
    echo "  MCP credentials written to 4 paths"
  else
    echo "  ERROR: Failed to write MCP credentials (continuing)"
    ERRORS=$((ERRORS + 1))
  fi
else
  echo "  WARN: gcp-oauth-credentials not set in SSM, skipping MCP setup"
fi
unset GCP_CREDS

# --- 2. Register Telegram group from SSM ---
# Uses initDatabase() from built app to avoid schema duplication with src/db.ts
TG_JID=$(ssm_get "telegram-chat-jid") || TG_JID=""
if [[ "${TG_JID}" != "CHANGE_ME" && -n "${TG_JID}" ]]; then
  if (
    set -e
    sudo -u nanoclaw mkdir -p "${APP_DIR}/store"
    sudo -u nanoclaw node --input-type=module -e "
      const [, jid, appDir] = process.argv;
      process.chdir(appDir);
      const { initDatabase, setRegisteredGroup } = await import(appDir + '/dist/db.js');
      initDatabase();
      setRegisteredGroup(jid, {
        name: 'CEO', folder: 'ceo', trigger: '',
        added_at: new Date().toISOString(), requiresTrigger: false
      });
      console.log('  Registered group: ' + jid);
    " "${TG_JID}" "${APP_DIR}"
  ); then
    :
  else
    echo "  ERROR: Failed to register Telegram group (continuing)"
    ERRORS=$((ERRORS + 1))
  fi
else
  echo "  WARN: telegram-chat-jid not set in SSM, skipping group registration"
fi
unset TG_JID

if [[ ${ERRORS} -gt 0 ]]; then
  echo "=== Provisioning completed with ${ERRORS} error(s) ==="
else
  echo "=== Provisioning complete ==="
fi
# Always exit 0 — provisioning failures must not block NanoClaw startup
exit 0
