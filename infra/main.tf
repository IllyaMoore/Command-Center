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

# Account validation — refuse to plan/apply against any account other than 796196972655
data "aws_caller_identity" "current" {
  lifecycle {
    postcondition {
      condition     = self.account_id == "796196972655"
      error_message = "Terraform must run against AWS account 796196972655. Current: ${self.account_id}"
    }
  }
}

module "networking" {
  source = "./modules/networking"

  environment        = var.environment
  vpc_cidr           = var.vpc_cidr
  private_subnets    = var.private_subnets
  public_subnets     = var.public_subnets
  availability_zones = var.availability_zones
  aws_region         = var.aws_region
  vpce_az_count      = var.vpce_az_count
}

module "compute" {
  source = "./modules/compute"

  environment        = var.environment
  vpc_id             = module.networking.vpc_id
  private_subnet_ids = module.networking.private_subnet_ids
}
