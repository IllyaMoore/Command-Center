# NanoClaw Infrastructure

AWS infrastructure for NanoClaw using Terraform (us-east-2).

## Workflow

All infrastructure changes go through CI. You never need to run
`terraform apply` manually -- CI does it for you after merge.

```
feature branch --> PR to staging --> merge --> CI applies staging
                                                    |
                              staging --> PR to master --> merge --> CI applies prod
```

Step by step:

1. Create a feature branch from `staging`
2. Make changes in `infra/`
3. Run `terraform plan` locally to verify (see [Local Commands](#local-commands))
4. Open a PR to `staging`
5. CI runs lint, security scan, and plan for staging
6. Plan output is posted as a PR comment -- review it
7. Get approval and merge -- CI applies staging automatically
8. Open a PR from `staging` to `master`
9. CI runs plan for prod -- review it
10. Merge -- CI applies prod automatically

What CI checks on every PR:
- **Lint** -- tflint catches syntax and best practice issues
- **Security Scan** -- tfsec finds security misconfigurations
- **Plan** -- terraform plan shows what will change (posted as PR comment)

Branch protection on `staging` requires all three checks to pass
plus 1 review approval before merge.

## Architecture

Each environment (staging, prod) gets its own isolated VPC
with identical structure. They share nothing -- separate state
files, separate resources.

Per environment:

```
VPC (10.0.0.0/16)
  |-- Private Subnet A (10.0.1.0/24, us-east-2a)
  |     |-- EC2 (t3.small, 30GB gp3)  [not deployed yet]
  |
  |-- Private Subnet B (10.0.3.0/24, us-east-2b)
  |
  |-- Public Subnet (10.0.101.0/24, NAT Gateway only)
  |     |-- NAT Gateway (outbound internet for private subnets)
  |
  |-- VPC Endpoints (Interface): SSM, SSM Messages, EC2 Messages (1 AZ)
  |
  |-- VPC Endpoint (Gateway): S3 (free)
```

Access (planned, requires compute module):
- Application: Tailscale mesh (UDP 41641)
- Shell: SSM Session Manager (`aws ssm start-session`)
- No SSH, no public IPs on EC2

## Prerequisites

- AWS CLI configured with profile `sam`
- Terraform >= 1.5.0
- tflint (for local linting)

```bash
brew install terraform tflint
```

## How Environments Work

There is one set of `.tf` files that describes the infrastructure.
Terraform deploys it twice -- once for staging, once for prod -- using
different inputs and storing state separately:

```
infra/*.tf                 <-- same code for both environments
infra/envs/staging.tfvars  <-- variable values for staging (names, sizes, etc.)
infra/envs/prod.tfvars     <-- variable values for prod
```

Each environment gets its own Terraform state file in S3:

```
s3://nanoclaw-tf-state-796196972655/nanoclaw/staging/terraform.tfstate
s3://nanoclaw-tf-state-796196972655/nanoclaw/prod/terraform.tfstate
```

This means staging and prod are fully isolated -- they share no
resources. Changing one does not affect the other. The `-backend-config`
flag during `terraform init` controls which state file (and therefore
which environment) you are working with.

## Local Commands

Always run from the `infra/` directory.

Working with staging:

```bash
cd infra
terraform init \
  -backend-config="profile=sam" \
  -backend-config="key=nanoclaw/staging/terraform.tfstate"
terraform plan -var-file=envs/staging.tfvars -var="aws_profile=sam"
```

Working with prod (add `-reconfigure` when switching from staging):

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

## Budget Estimate

Monthly cost (us-east-2, on-demand pricing):

| Resource | Per env | Rate |
|----------|---------|------|
| NAT Gateway | $32.85 | $0.045/hr |
| NAT data processing (~5 GB) | $0.23 | $0.045/GB |
| VPC Interface Endpoints (SSM x3, 1 AZ) | $21.90 | $0.01/hr/AZ |
| EC2 t3.small | $15.18 | $0.0208/hr |
| EBS gp3 30 GB | $2.40 | $0.08/GB/mo |
| Elastic IP (attached) | $0.00 | free |
| S3 Gateway Endpoint | $0.00 | free |
| **Per-environment subtotal** | **~$72.50** | |

Shared resources (negligible): S3 state bucket, DynamoDB lock table.

**Total (staging + prod): ~$145/mo**

Cost reduction options:
- Replace NAT Gateway with a NAT instance (t4g.nano ~$3/mo)
- Use Reserved Instances or Savings Plans for EC2 (~40% savings)

## Security Rules

- No hardcoded secrets -- use SSM Parameter Store for all
  sensitive values
- No `0.0.0.0/0` inbound TCP rules -- Tailscale only (UDP 41641)
- No SSH (port 22) security group rules -- use SSM Session Manager
- No public IPs on EC2 instances
- EBS volumes must be encrypted
- IMDSv2 required (`http_tokens = "required"`)
- Private subnets only for compute resources
- Account validation: all plans/applies are checked against
  account `796196972655`

## Common Mistakes

1. **Forgot `terraform init`** after switching environments --
   always re-init with `-reconfigure` when changing backend key
2. **Committed `.terraform/`** -- this directory is gitignored,
   never commit it
3. **Applied without reviewing plan** -- always run `plan` first
   and read the output
4. **Hardcoded AMI IDs** -- use `aws_ami` data source with
   filters for Amazon Linux 2023
5. **Wrong AWS profile** -- the account validation check block
   will catch this, but verify your profile before running
