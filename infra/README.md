# NanoClaw Infrastructure

AWS infrastructure for NanoClaw using Terraform (us-east-2).

## Workflow

All infrastructure changes go through CI. You never need to run
`terraform apply` manually - CI does it for you after merge.

```
feature branch --> PR to staging --> merge --> CI applies shared + staging
                                                    |
                              staging --> PR to master --> merge --> CI applies shared + prod
```

Step by step:

1. Create a feature branch from `staging`
2. Make changes in `infra/`
3. Run `terraform plan` locally to verify (see [Local Commands](#local-commands))
4. Open a PR to `staging`
5. CI runs lint, security scan, and plan (shared + env)
6. Plan output is posted as PR comments - review both
7. Get approval and merge - CI applies shared then staging automatically
8. Open a PR from `staging` to `master`
9. CI runs plan for prod - review it
10. Merge - CI applies shared then prod automatically

What CI checks on every PR:
- **Lint** - tflint catches syntax and best practice issues (both roots)
- **Security Scan** - tfsec finds security misconfigurations (both roots)
- **Plan (shared)** - terraform plan for shared networking/IAM
- **Plan (env)** - terraform plan for env-specific compute

Branch protection on `staging` requires all checks to pass
plus 1 review approval before merge.

## Architecture

Networking and IAM are shared between environments. Each environment
gets its own compute resources (EC2, security groups, SSM parameters).

```
Shared state (infra/shared/)
  |
  |-- VPC (10.0.0.0/16)
  |     |-- Private Subnet A (10.0.1.0/24, us-east-2a)
  |     |-- Private Subnet B (10.0.3.0/24, us-east-2b)
  |     |-- Public Subnet (10.0.101.0/24, NAT Gateway only)
  |     |-- NAT Gateway (outbound internet for private subnets)
  |     |-- VPC Endpoints (Interface): SSM, SSM Messages, EC2 Messages (1 AZ)
  |     |-- VPC Endpoint (Gateway): S3 (free)
  |
  |-- OIDC provider (GitHub Actions)
  |-- CI IAM role (nanoclaw-github-actions-terraform)
  |-- Developer IAM user (illia-developer)

Staging state (infra/)                 Prod state (infra/)
  |-- EC2 (t3.small, 30GB gp3)          |-- EC2 (t3.small, 30GB gp3)
  |-- Security Group                    |-- Security Group
  |-- IAM Instance Profile              |-- IAM Instance Profile
  |-- SSM Parameters                    |-- SSM Parameters
  |   (reads vpc_id, subnet_ids         |   (reads vpc_id, subnet_ids
  |    from shared state)               |    from shared state)
```

Access:
- Application: Tailscale mesh (UDP 41641)
- Shell: SSM Session Manager (`aws ssm start-session --target <instance-id>`)
- No SSH, no public IPs on EC2

## Prerequisites

- AWS CLI configured with profile `sam`
- Terraform >= 1.5.0
- tflint (for local linting)

```bash
brew install terraform tflint
```

## How Environments Work

There are two Terraform roots:

1. **`infra/shared/`** - networking and IAM (one state, shared by all envs)
2. **`infra/`** - compute resources (separate state per env via tfvars)

```
infra/shared/*.tf              <-- shared networking, IAM
infra/shared/terraform.tfvars  <-- VPC CIDR, subnets, AZs

infra/*.tf                     <-- compute (reads shared outputs via remote state)
infra/envs/staging.tfvars      <-- environment = "staging"
infra/envs/prod.tfvars         <-- environment = "prod"
```

Each root gets its own state file in S3:

```
s3://nanoclaw-tf-state-796196972655/nanoclaw/shared/terraform.tfstate
s3://nanoclaw-tf-state-796196972655/nanoclaw/staging/terraform.tfstate
s3://nanoclaw-tf-state-796196972655/nanoclaw/prod/terraform.tfstate
```

The env-specific root reads shared outputs via `terraform_remote_state`:

```hcl
data "terraform_remote_state" "shared" {
  backend = "s3"
  config = {
    bucket  = "nanoclaw-tf-state-796196972655"
    key     = "nanoclaw/shared/terraform.tfstate"
    region  = "us-east-2"
    profile = var.aws_profile
  }
}

# Use in compute module:
vpc_id             = data.terraform_remote_state.shared.outputs.vpc_id
private_subnet_ids = data.terraform_remote_state.shared.outputs.private_subnet_ids
```

## Local Commands

### Shared networking/IAM

```bash
cd infra/shared
terraform init \
  -backend-config="profile=sam" \
  -backend-config="key=nanoclaw/shared/terraform.tfstate"
terraform plan -var="aws_profile=sam"
```

### Staging compute

```bash
cd infra
terraform init \
  -backend-config="profile=sam" \
  -backend-config="key=nanoclaw/staging/terraform.tfstate"
terraform plan -var-file=envs/staging.tfvars -var="aws_profile=sam"
```

### Prod compute (add `-reconfigure` when switching)

```bash
cd infra
terraform init -reconfigure \
  -backend-config="profile=sam" \
  -backend-config="key=nanoclaw/prod/terraform.tfstate"
terraform plan -var-file=envs/prod.tfvars -var="aws_profile=sam"
```

## Directory Layout

```
infra/
  main.tf              Provider, account validation, remote state, compute module
  variables.tf         Input variables (environment, aws_region, aws_profile, repo_url, ami_id)
  outputs.tf           (empty - networking outputs moved to shared)
  backend.tf           S3 + DynamoDB backend (partial config)
  versions.tf          Terraform + provider version pins

  envs/
    staging.tfvars     environment = "staging"
    prod.tfvars        environment = "prod"

  shared/
    main.tf            Provider, networking module, OIDC, CI IAM, developer IAM
    variables.tf       VPC CIDR, subnets, AZs
    outputs.tf         vpc_id, private_subnet_ids, nat_gateway_ip, vpc_endpoint_sg_id
    backend.tf         S3 + DynamoDB backend (partial config)
    versions.tf        Terraform + provider version pins
    terraform.tfvars   Network configuration values
    .tflint.hcl        Linter config (CI uses this)

  modules/
    networking/        VPC, subnets, NAT GW, VPC endpoints
    compute/           EC2, SG, IAM profile, SSM parameters, userdata
```

## Naming Convention

All resources follow: `nanoclaw-{environment}-{purpose}`

Shared networking resources keep `nanoclaw-staging-` prefix
(matches original resource names to avoid recreation during migration).

Examples:
- `nanoclaw-staging-vpc` (shared)
- `nanoclaw-staging-nat` (shared)
- `nanoclaw-prod-instance` (env-specific)

## Tagging Standard

Every resource gets these tags via `default_tags`:

| Tag | Value |
|-----|-------|
| Project | nanoclaw |
| Environment | shared / staging / prod |
| ManagedBy | terraform |
| Repository | StoryFunnels/command-center |

Add a `Name` tag per resource following the naming convention.

## Budget Estimate

Monthly cost (us-east-2, on-demand pricing):

| Resource | Count | Rate |
|----------|-------|------|
| NAT Gateway | 1 (shared) | $32.85/mo |
| NAT data processing (~5 GB) | 1 | $0.23/mo |
| VPC Interface Endpoints (SSM x3, 1 AZ) | 1 set (shared) | $21.90/mo |
| EC2 t3.small | 2 (staging + prod) | $15.18/mo each |
| EBS gp3 30 GB | 2 | $2.40/mo each |
| Elastic IP (attached) | 1 (shared) | free |
| S3 Gateway Endpoint | 1 (shared) | free |

| | Cost |
|---|------|
| **Shared networking** | **~$55/mo** |
| **Per environment (compute)** | **~$17.50/mo** |
| **Total (shared + staging + prod)** | **~$90/mo** |

Savings vs separate VPCs: ~$55/mo (one NAT GW + endpoints instead of two).

Cost reduction options:
- Replace NAT Gateway with a NAT instance (t4g.nano ~$3/mo)
- Use Reserved Instances or Savings Plans for EC2 (~40% savings)

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
6. **Editing shared infra without checking env plan** - changes
   to shared networking can affect both environments; always
   plan both shared and env roots
