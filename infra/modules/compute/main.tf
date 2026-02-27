# Compute module — STUB for Illia to implement
#
# This module will contain:
#   - Security groups (Story 1: LOS board)
#   - IAM instance profile (Story 1)
#   - SSM Parameter Store parameters (Story 2)
#   - EC2 instance (Story 3 staging, Story 6 prod)
#   - User data bootstrap script (Story 4)
#
# Implementation guide:
#   1. Start with security group: UDP 41641 inbound (Tailscale), HTTPS outbound
#   2. Create IAM role with SSM read + S3 backup permissions, attach instance profile
#   3. Create SSM parameters under /nanoclaw/{environment}/ with lifecycle { ignore_changes = [value] }
#   4. Add EC2 instance: Amazon Linux 2023 (data source, not hardcoded AMI),
#      t3.small, 30GB gp3 encrypted, private subnet, IMDSv2 required, no public IP
#   5. Write userdata.sh referencing launchd/com.nanoclaw.plist for service config
#
# Key constraints:
#   - No TCP inbound rules (no SSH — use SSM Session Manager)
#   - No public IP on EC2
#   - EBS volumes must be encrypted
#   - IMDSv2 required (http_tokens = "required")
#   - All resources tagged nanoclaw-{environment}-{purpose}
#   - No hardcoded AMI IDs — use aws_ami data source with filters
#   - No secrets in Terraform code — use SSM SecureString with placeholder values

locals {
  name_prefix = "nanoclaw-${var.environment}"
}

# -----------------------------------------------------------------------------
# SSM Parameter Store (OPC-105)
# -----------------------------------------------------------------------------

resource "aws_ssm_parameter" "anthropic_api_key" {
  name  = "/nanoclaw/${var.environment}/anthropic-api-key"
  type  = "SecureString"
  value = "CHANGE_ME"

  tags = { Name = "${local.name_prefix}-anthropic-api-key" }

  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "tailscale_auth_key" {
  name  = "/nanoclaw/${var.environment}/tailscale-auth-key"
  type  = "SecureString"
  value = "CHANGE_ME"

  tags = { Name = "${local.name_prefix}-tailscale-auth-key" }

  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "telegram_bot_token" {
  name  = "/nanoclaw/${var.environment}/telegram-bot-token"
  type  = "SecureString"
  value = "CHANGE_ME"

  tags = { Name = "${local.name_prefix}-telegram-bot-token" }

  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "assistant_name" {
  name  = "/nanoclaw/${var.environment}/assistant-name"
  type  = "String"
  value = "CHANGE_ME"

  tags = { Name = "${local.name_prefix}-assistant-name" }

  lifecycle { ignore_changes = [value] }
}

resource "aws_ssm_parameter" "instance_id" {
  name  = "/nanoclaw/${var.environment}/instance-id"
  type  = "String"
  value = "pending"

  tags = { Name = "${local.name_prefix}-instance-id" }

  # NO lifecycle ignore — Terraform manages this value
  # Will be updated when EC2 is provisioned (OPC-106)
}
