variable "environment" {
  description = "Deployment environment (staging or prod)"
  type        = string
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
  description = "CIDR blocks for public subnets (NAT Gateway only)"
  type        = list(string)
}

variable "availability_zones" {
  description = "Availability zones to use"
  type        = list(string)
}

variable "aws_region" {
  description = "AWS region for VPC endpoint service names"
  type        = string
}

variable "vpce_az_count" {
  description = "Number of AZs for VPC interface endpoints (0 = all AZs)"
  type        = number
  default     = 0
}
