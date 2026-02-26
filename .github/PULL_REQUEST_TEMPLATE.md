## Type of Change

- [ ] **Skill** - adds a new skill in `.claude/skills/`
- [ ] **Fix** - bug fix or security fix to source code
- [ ] **Simplification** - reduces or simplifies source code
- [ ] **Infrastructure** - changes in `infra/`

## Description



## For Skills

- [ ] I have not made any changes to source code
- [ ] My skill contains instructions for Claude to follow (not pre-built code)
- [ ] I tested this skill on a fresh clone

## For Infrastructure

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
