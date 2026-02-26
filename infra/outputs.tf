output "vpc_id" {
  description = "VPC ID"
  value       = module.networking.vpc_id
}

output "private_subnet_ids" {
  description = "Private subnet IDs"
  value       = module.networking.private_subnet_ids
}

output "nat_gateway_ip" {
  description = "NAT Gateway Elastic IP address"
  value       = module.networking.nat_gateway_ip
}
