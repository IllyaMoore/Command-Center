# NanoClaw Infrastructure

AWS infrastructure for NanoClaw using Terraform. See
[PRD sections 5.1-5.7](../docs/Command-Center-PRD-v3.md) for architecture.

## Architecture

```
VPC (10.0.0.0/16)
  |-- Private Subnet A (10.0.1.0/24, us-east-2a)
  |     |-- EC2 staging (t3.small, 30GB gp3)
  |     |-- EC2 prod (t3.small, 30GB gp3)
  |
  |-- Private Subnet B (10.0.3.0/24, us-east-2b)
  |
  |-- Public Subnet (10.0.101.0/24, NAT Gateway only)
  |     |-- NAT Gateway (outbound internet for private subnets)
  |
  |-- VPC Endpoints: SSM, SSM Messages, EC2 Messages, S3

Access:
  - Application: Tailscale mesh (UDP 41641)
  - Shell: SSM Session Manager (aws ssm start-session)
  - No SSH, no public IPs on EC2
```

## Prerequisites

- AWS CLI configured with profile `sam`
- Terraform >= 1.5.0
- tflint (for local linting)

Install Terraform and tflint on macOS:

```bash
brew install terraform tflint
```

## Quick Start

One-time bootstrap (creates S3 bucket + DynamoDB for state):

```bash
./scripts/bootstrap.sh --profile sam --region us-east-2
```

Working with staging:

```bash
cd infra
terraform init \
  -backend-config="profile=sam" \
  -backend-config="key=nanoclaw/staging/terraform.tfstate"
terraform plan -var-file=envs/staging.tfvars -var="aws_profile=sam"
terraform apply -var-file=envs/staging.tfvars -var="aws_profile=sam"
```

Working with prod:

```bash
cd infra
terraform init -reconfigure \
  -backend-config="profile=sam" \
  -backend-config="key=nanoclaw/prod/terraform.tfstate"
terraform plan -var-file=envs/prod.tfvars -var="aws_profile=sam"
terraform apply -var-file=envs/prod.tfvars -var="aws_profile=sam"
```

## Directory Layout

```
infra/
  main.tf              Provider, account validation, module wiring
  variables.tf         Shared input variables
  outputs.tf           Root outputs (VPC, subnets)
  backend.tf           S3 + DynamoDB backend (partial config)
  versions.tf          Terraform + provider version pins
  ci-iam.tf            OIDC provider + GitHub Actions role
  iam-developers.tf    IAM user for developers

  envs/
    staging.tfvars     Staging variable values
    prod.tfvars        Production variable values

  modules/
    networking/        VPC, subnets, NAT GW, VPC endpoints
    compute/           EC2, SG, IAM profile (stub)

  scripts/
    bootstrap.sh       One-time S3 + DynamoDB creation
```

## Naming Convention

All resources follow: `nanoclaw-{environment}-{purpose}`

Examples:
- `nanoclaw-staging-vpc`
- `nanoclaw-prod-private-us-east-2a`
- `nanoclaw-staging-nat`

## Tagging Standard

Every resource gets these tags via `default_tags`:

| Tag | Value |
|-----|-------|
| Project | nanoclaw |
| Environment | staging / prod |
| ManagedBy | terraform |
| Repository | StoryFunnels/command-center |

Add a `Name` tag per resource following the naming convention.

## Workflow

1. Create a branch from `devmoor`
2. Make changes in `infra/`
3. Run `terraform plan` locally to verify
4. Open a PR to `devmoor`
5. CI runs lint, security scan, and plan for both environments
6. Plan output is posted as a PR comment - review it
7. Get approval from Mykola
8. Merge - CI applies staging automatically, prod requires
   manual approval

## Security Rules

- No hardcoded secrets - use SSM Parameter Store for all
  sensitive values
- No `0.0.0.0/0` inbound TCP rules - Tailscale only (UDP 41641)
- No SSH (port 22) security group rules - use SSM Session Manager
- No public IPs on EC2 instances
- EBS volumes must be encrypted
- IMDSv2 required (`http_tokens = "required"`)
- Private subnets only for compute resources
- Account validation: all plans/applies are checked against
  account `796196972655`

## Common Mistakes

1. **Forgot `terraform init`** after switching environments -
   always re-init with `-reconfigure` when changing backend key
2. **Committed `.terraform/`** - this directory is gitignored,
   never commit it
3. **Applied without reviewing plan** - always run `plan` first
   and read the output
4. **Hardcoded AMI IDs** - use `aws_ami` data source with
   filters for Amazon Linux 2023
5. **Wrong AWS profile** - the account validation check block
   will catch this, but verify your profile before running

## PR Self-Review Checklist

Copy this into your PR description:

```markdown
- [ ] `terraform plan` output reviewed (no unexpected changes)
- [ ] No hardcoded secrets or AMI IDs
- [ ] No TCP inbound to 0.0.0.0/0
- [ ] No SSH (port 22) security group rules
- [ ] No public IPs on EC2 instances
- [ ] EBS volumes encrypted
- [ ] IMDSv2 enforced (http_tokens = "required")
- [ ] All resources follow nanoclaw-{env}-{purpose} naming
- [ ] Name tag on every resource
- [ ] Variables and outputs have descriptions
- [ ] Account validation check block present
```
