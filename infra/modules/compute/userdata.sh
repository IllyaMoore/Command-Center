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
dnf install -y 'dnf-command(config-manager)' git

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
tailscale up --hostname="nanoclaw-$${ENVIRONMENT}" --auth-key="$${TS_AUTH_KEY}"
unset TS_AUTH_KEY

# --- 4. Install GitHub CLI ---
echo "--- Installing gh CLI ---"
dnf config-manager --add-repo https://cli.github.com/packages/rpm/gh-cli.repo
dnf install -y gh

# --- 5. Install Chromium (for agent-browser skill) ---
echo "--- Installing Chromium ---"
dnf install -y chromium || {
  echo "WARN: chromium not in default repos, installing via amazon-linux-extras or snap"
  dnf install -y chromium-headless 2>/dev/null || echo "WARN: Chromium not available, agent-browser skill will not work"
}

# --- 6. Install Claude Code CLI (used by agent-runner) ---
echo "--- Installing Claude Code CLI ---"
npm install -g @anthropic-ai/claude-code

# --- 7. Create nanoclaw system user ---
echo "--- Creating nanoclaw user ---"
useradd -r -m -d /opt/nanoclaw -s /bin/bash nanoclaw

# --- 8. Clone repo (use git extraheader to keep token out of URL / process args) ---
echo "--- Cloning repository ---"
GITHUB_TOKEN=$(ssm_get "github-access-token")
AUTH_HEADER=$(echo -n "x-access-token:$${GITHUB_TOKEN}" | base64 -w 0)
git clone --config "http.https://github.com/.extraheader=Authorization: Basic $${AUTH_HEADER}" "$${REPO_URL}" "$${APP_DIR}"
unset AUTH_HEADER GITHUB_TOKEN

# --- 9. Write .env from SSM parameters (before npm install to keep secrets out of build env) ---
echo "--- Writing .env from SSM ---"
ANTHROPIC_API_KEY=$(ssm_get "anthropic-api-key")
TELEGRAM_BOT_TOKEN=$(ssm_get "telegram-bot-token")
ATLASSIAN_BASIC_TOKEN=$(ssm_get "atlassian-basic-token")
ASSISTANT_NAME=$(ssm_get "assistant-name")
ASSISTANT_HAS_OWN_NUMBER=$(ssm_get "assistant-has-own-number")
TS_IP=""
for i in $(seq 1 15); do
  TS_IP=$(tailscale ip -4 2>/dev/null || true)
  [[ -n "$${TS_IP}" ]] && break
  echo "WARN: tailscale ip -4 empty, retrying ($${i}/15)..."
  sleep 2
done
if [[ -z "$${TS_IP}" ]]; then
  echo "ERROR: tailscale ip -4 returned empty after 30s. Tailscale status:" >&2
  tailscale status >&2 || true
  exit 1
fi

cat > "$${APP_DIR}/.env" <<ENV
ANTHROPIC_API_KEY=$${ANTHROPIC_API_KEY}
TELEGRAM_BOT_TOKEN=$${TELEGRAM_BOT_TOKEN}
ATLASSIAN_BASIC_TOKEN=$${ATLASSIAN_BASIC_TOKEN}
ASSISTANT_NAME=$${ASSISTANT_NAME}
ASSISTANT_HAS_OWN_NUMBER=$${ASSISTANT_HAS_OWN_NUMBER}
DEV_MODE=false
DASHBOARD_URL=http://$${TS_IP}:3000
ENV
unset TS_IP
unset ANTHROPIC_API_KEY TELEGRAM_BOT_TOKEN ATLASSIAN_BASIC_TOKEN ASSISTANT_NAME ASSISTANT_HAS_OWN_NUMBER

chown -R nanoclaw:nanoclaw /opt/nanoclaw
chown nanoclaw:nanoclaw "$${APP_DIR}/.env"
chmod 600 "$${APP_DIR}/.env"

# --- 9.5. Configure swap (1GB) for OOM protection ---
echo "--- Configuring swap ---"
fallocate -l 1G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# --- 10. Build (host app + agent-runner) ---
echo "--- Building application ---"
sudo -u nanoclaw bash -c "cd $${APP_DIR} && npm ci && NODE_OPTIONS=--max-old-space-size=1536 npm run build"

# --- 11. Write systemd service ---
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
MemoryMax=1536M
OOMPolicy=stop

[Install]
WantedBy=multi-user.target
SERVICE

# --- 12. Enable and start ---
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
