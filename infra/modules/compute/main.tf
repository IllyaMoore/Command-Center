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
#   1. Start with security group: no inbound, all outbound (private subnet behind NAT)
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

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  name_prefix = "nanoclaw-${var.environment}"
}

# --- Security Group ---

resource "aws_security_group" "compute" {
  name        = "${local.name_prefix}-compute-sg"
  description = "Security group for NanoClaw compute instances"
  vpc_id      = var.vpc_id

  tags = {
    Name = "${local.name_prefix}-compute-sg"
  }

  lifecycle {
    create_before_destroy = true
  }
}

# Inbound: none (Tailscale uses NAT traversal, no inbound rules needed)

# Outbound: allow all (private subnet behind NAT gateway)
resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.compute.id
  description       = "Allow all outbound (private subnet behind NAT)"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"

  tags = { Name = "${local.name_prefix}-egress-all" }
}

# --- IAM Role & Instance Profile ---

resource "aws_iam_role" "instance" {
  name = "${local.name_prefix}-instance"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ec2.amazonaws.com"
      }
    }]
  })

  tags = { Name = "${local.name_prefix}-instance-role" }
}

# SSM Session Manager access (managed policy)
resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.instance.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# Application permissions: SSM parameter read + S3 backups
resource "aws_iam_role_policy" "app_permissions" {
  name = "${local.name_prefix}-app-permissions"
  role = aws_iam_role.instance.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SSMParameterRead"
        Effect = "Allow"
        # Single + bulk read for app startup (GetParametersByPath loads all /nanoclaw/{env}/ at once)
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:GetParametersByPath",
        ]
        Resource = "arn:aws:ssm:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:parameter/nanoclaw/*"
      },
      {
        Sid    = "S3BackupObjects"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject"
        ]
        Resource = "arn:aws:s3:::nanoclaw-backups-${var.environment}-*/*"
      },
      {
        Sid      = "S3BackupList"
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = "arn:aws:s3:::nanoclaw-backups-${var.environment}-*"
      }
    ]
  })
}

resource "aws_iam_instance_profile" "compute" {
  name = "${local.name_prefix}-instance-profile"
  role = aws_iam_role.instance.name

  tags = { Name = "${local.name_prefix}-instance-profile" }
}

# --- SSM Parameter Store ---

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
  value = aws_instance.main.id

  tags = { Name = "${local.name_prefix}-instance-id" }

  lifecycle { ignore_changes = [value] }
}

# Amazon Machine Image
# most_recent = true: instance will be replaced when Amazon publishes a new AL2023 AMI.
# Acceptable for staging; pin to a specific version for prod.

data "aws_ami" "amazon_linux" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

#! EC2  

resource "aws_instance" "main" {
  ami                         = data.aws_ami.amazon_linux.id
  instance_type               = var.instance_type
  subnet_id                   = var.private_subnet_ids[0]
  associate_public_ip_address = false
  iam_instance_profile        = aws_iam_instance_profile.compute.name
  vpc_security_group_ids      = [aws_security_group.compute.id]

  metadata_options {
    http_tokens   = "required"
    http_endpoint = "enabled"
  }

  root_block_device {
    volume_size = var.volume_size # 30
    volume_type = "gp3"
    encrypted   = true
  }

  tags = {
    Name = "${local.name_prefix}-instance"
  }
}
