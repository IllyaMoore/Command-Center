variable "environment" {
  description = "Deployment environment"
  type        = string

  validation {
    condition     = contains(["staging", "prod"], var.environment)
    error_message = "Environment must be 'staging' or 'prod'."
  }
}

variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-2"
}

variable "aws_profile" {
  description = "AWS CLI profile (default sam for local, null in CI)"
  type        = string
  default     = null
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
}

variable "private_subnets" {
  description = "CIDR blocks for private subnets"
  type        = list(string)
}

variable "public_subnets" {
  description = "CIDR blocks for public subnets (NAT Gateway only, no EC2)"
  type        = list(string)
}

variable "availability_zones" {
  description = "Availability zones to use"
  type        = list(string)
}

variable "vpce_az_count" {
  description = "Number of AZs for VPC interface endpoints (reduces cost in non-prod)"
  type        = number
  default     = 0
}

variable "repo_url" {
  description = "Git repository URL for NanoClaw"
  type        = string
  default     = "https://github.com/StoryFunnels/command-center.git"
}
