#!/bin/bash
set -euo pipefail
trap 'echo "FATAL: bootstrap failed at line $LINENO (exit $?)" >&2' ERR
install -m 600 /dev/null /var/log/nanoclaw-bootstrap.log
exec > >(tee /var/log/nanoclaw-bootstrap.log) 2>&1

echo "=== NanoClaw bootstrap starting ==="

ENVIRONMENT="${environment}"
AWS_REGION="${aws_region}"
REPO_URL="${repo_url}"
APP_DIR="/opt/nanoclaw/app"

# Helper: read SSM parameter value
ssm_get() {
  aws ssm get-parameter \
    --name "/nanoclaw/$${ENVIRONMENT}/$1" \
    --with-decryption \
    --query "Parameter.Value" \
    --output text \
    --region "$${AWS_REGION}"
}

# --- 1. Install prerequisites ---
echo "--- Installing prerequisites ---"
dnf install -y 'dnf-command(config-manager)'

# --- 2. Install Node.js 22 (NodeSource) ---
echo "--- Installing Node.js 22 ---"
curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
dnf install -y nodejs

# --- 3. Install Tailscale (use TS_AUTHKEY env var to keep secret out of process args) ---
echo "--- Installing Tailscale ---"
dnf config-manager --add-repo https://pkgs.tailscale.com/stable/amazon-linux/2023/tailscale.repo
dnf install -y tailscale
systemctl enable --now tailscaled
# Wait for tailscaled socket to be ready (status fails before auth, so just wait for daemon)
timeout 30 bash -c 'until [ -S /var/run/tailscale/tailscaled.sock ]; do sleep 1; done'

TS_AUTH_KEY=$(ssm_get "tailscale-auth-key")
TS_AUTHKEY="$${TS_AUTH_KEY}" tailscale up --hostname="nanoclaw-$${ENVIRONMENT}"
unset TS_AUTH_KEY

# --- 4. Install GitHub CLI ---
echo "--- Installing gh CLI ---"
dnf config-manager --add-repo https://cli.github.com/packages/rpm/gh-cli.repo
dnf install -y gh

# --- 5. Install Docker ---
echo "--- Installing Docker ---"
dnf install -y docker
systemctl enable --now docker

# --- 6. Create nanoclaw system user ---
echo "--- Creating nanoclaw user ---"
useradd -r -m -d /opt/nanoclaw -s /bin/bash nanoclaw
usermod -aG docker nanoclaw

# --- 7. Clone repo (use git extraheader to keep token out of URL / process args) ---
echo "--- Cloning repository ---"
GITHUB_TOKEN=$(ssm_get "github-access-token")
AUTH_HEADER=$(echo -n "x-access-token:$${GITHUB_TOKEN}" | base64 -w 0)
git clone --config "http.https://github.com/.extraheader=Authorization: Basic $${AUTH_HEADER}" "$${REPO_URL}" "$${APP_DIR}"
unset AUTH_HEADER GITHUB_TOKEN

# --- 8. Write .env from SSM parameters (before npm install to keep secrets out of build env) ---
echo "--- Writing .env from SSM ---"
ANTHROPIC_API_KEY=$(ssm_get "anthropic-api-key")
TELEGRAM_BOT_TOKEN=$(ssm_get "telegram-bot-token")
ATLASSIAN_BASIC_TOKEN=$(ssm_get "atlassian-basic-token")
ASSISTANT_NAME=$(ssm_get "assistant-name")
ASSISTANT_HAS_OWN_NUMBER=$(ssm_get "assistant-has-own-number")

cat > "$${APP_DIR}/.env" <<ENV
ANTHROPIC_API_KEY=$${ANTHROPIC_API_KEY}
TELEGRAM_BOT_TOKEN=$${TELEGRAM_BOT_TOKEN}
ATLASSIAN_BASIC_TOKEN=$${ATLASSIAN_BASIC_TOKEN}
ASSISTANT_NAME=$${ASSISTANT_NAME}
ASSISTANT_HAS_OWN_NUMBER=$${ASSISTANT_HAS_OWN_NUMBER}
DEV_MODE=false
ENV
unset ANTHROPIC_API_KEY TELEGRAM_BOT_TOKEN ATLASSIAN_BASIC_TOKEN ASSISTANT_NAME ASSISTANT_HAS_OWN_NUMBER

chown -R nanoclaw:nanoclaw /opt/nanoclaw
chown nanoclaw:nanoclaw "$${APP_DIR}/.env"
chmod 600 "$${APP_DIR}/.env"

# --- 9. Build ---
echo "--- Building application ---"
sudo -u nanoclaw bash -c "cd $${APP_DIR} && npm ci && npm run build"

# --- 10. Write systemd service (see launchd/com.nanoclaw.plist for macOS equivalent) ---
echo "--- Creating systemd service ---"
cat > /etc/systemd/system/nanoclaw.service <<SERVICE
[Unit]
Description=NanoClaw Assistant
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=nanoclaw
WorkingDirectory=$${APP_DIR}
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
EnvironmentFile=$${APP_DIR}/.env

[Install]
WantedBy=multi-user.target
SERVICE

# --- 11. Enable and start ---
echo "--- Starting NanoClaw service ---"
systemctl daemon-reload
systemctl enable --now nanoclaw

sleep 5
if ! systemctl is-active --quiet nanoclaw; then
  echo "ERROR: NanoClaw failed to start"
  journalctl -u nanoclaw --no-pager -n 30
  exit 1
fi

echo "=== NanoClaw bootstrap complete ==="
