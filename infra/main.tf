provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile

  default_tags {
    tags = {
      Project     = "nanoclaw"
      Environment = var.environment
      ManagedBy   = "terraform"
      Repository  = "StoryFunnels/command-center"
    }
  }
}

# Account validation - refuse to plan/apply against any account other than 796196972655
data "aws_caller_identity" "current" {
  lifecycle {
    postcondition {
      condition     = self.account_id == "796196972655"
      error_message = "Terraform must run against AWS account 796196972655. Current: ${self.account_id}"
    }
  }
}

# Shared networking state (VPC, subnets, NAT, endpoints)
data "terraform_remote_state" "shared" {
  backend = "s3"

  config = {
    bucket  = "nanoclaw-tf-state-796196972655"
    key     = "nanoclaw/shared/terraform.tfstate"
    region  = "us-east-2"
    profile = var.aws_profile
  }
}

module "compute" {
  source = "./modules/compute"

  environment        = var.environment
  vpc_id             = data.terraform_remote_state.shared.outputs.vpc_id
  private_subnet_ids = data.terraform_remote_state.shared.outputs.private_subnet_ids
  repo_url           = var.repo_url
  ami_id             = var.ami_id
}
