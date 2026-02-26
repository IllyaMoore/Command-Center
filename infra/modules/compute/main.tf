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

# TODO: Implement — see Jira stories on the LOS board
