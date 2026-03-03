# Compute module interface — implementation by Illia (LOS Stories 1-4)
#
# This file defines the inputs the compute module expects.
# The main.tf implementation is a stub; see the Jira stories for requirements.

variable "environment" {
  description = "Deployment environment (staging or prod)"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID from networking module"
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs where EC2 instances will be placed"
  type        = list(string)
}

variable "instance_type" {
  description = "EC2 instance type"
  type        = string
  default     = "t3.small"
}

variable "volume_size" {
  description = "EBS root volume size in GB"
  type        = number
  default     = 30
}

variable "repo_url" {
  description = "Git repository URL for NanoClaw"
  type        = string
  default     = "https://github.com/StoryFunnels/command-center.git"
}
