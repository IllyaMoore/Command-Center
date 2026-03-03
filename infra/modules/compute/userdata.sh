#!/bin/bash
set -euo pipefail
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
dnf install -y https://rpm.nodesource.com/pub_22.x/nodistro/repo/nodesource-release-nodistro-1.noarch.rpm
dnf install -y nodejs

# --- 3. Install Tailscale ---
echo "--- Installing Tailscale ---"
dnf config-manager --add-repo https://pkgs.tailscale.com/stable/amazon-linux/2023/tailscale.repo
dnf install -y tailscale
systemctl enable --now tailscaled

TS_AUTH_KEY=$$(ssm_get "tailscale-auth-key")
tailscale up --authkey="$${TS_AUTH_KEY}" --hostname="nanoclaw-$${ENVIRONMENT}"
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

# --- 7. Clone repo (authenticate with OAuth token for private repos) ---
echo "--- Cloning repository ---"
GH_TOKEN=$$(ssm_get "claude-code-oauth-token")
git clone "https://x-access-token:$${GH_TOKEN}@$${REPO_URL#https://}" "$${APP_DIR}"
unset GH_TOKEN
chown -R nanoclaw:nanoclaw /opt/nanoclaw

# --- 8. Build ---
echo "--- Building application ---"
sudo -u nanoclaw bash -c "cd $${APP_DIR} && npm install && npm run build"

# --- 9. Write .env from SSM parameters ---
echo "--- Writing .env from SSM ---"
cat > "$${APP_DIR}/.env" <<ENV
ANTHROPIC_API_KEY=$$(ssm_get "anthropic-api-key")
CLAUDE_CODE_OAUTH_TOKEN=$$(ssm_get "claude-code-oauth-token")
TELEGRAM_BOT_TOKEN=$$(ssm_get "telegram-bot-token")
ASSISTANT_NAME=$$(ssm_get "assistant-name")
ASSISTANT_HAS_OWN_NUMBER=$$(ssm_get "assistant-has-own-number")
DEV_MODE=false
ENV
chown nanoclaw:nanoclaw "$${APP_DIR}/.env"
chmod 600 "$${APP_DIR}/.env"

# --- 10. Write systemd service ---
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

echo "=== NanoClaw bootstrap complete ==="
