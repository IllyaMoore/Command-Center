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

variable "repo_url" {
  description = "Git repository URL for NanoClaw"
  type        = string
  default     = "https://github.com/StoryFunnels/command-center.git"
}

variable "ami_id" {
  description = "Pinned AMI ID for EC2 instance. When null, uses latest AL2023 AMI."
  type        = string
  default     = null
}
