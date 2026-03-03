# Compute module outputs — uncomment as resources are implemented

output "instance_id" {
  description = "EC2 instance ID"
  value       = aws_instance.main.id
}

output "instance_private_ip" {
  description = "EC2 instance private IP address"
  value       = aws_instance.main.private_ip
}

output "security_group_id" {
  description = "Compute security group ID"
  value       = aws_security_group.compute.id
}

output "instance_profile_name" {
  description = "IAM instance profile name"
  value       = aws_iam_instance_profile.compute.name
}

output "ssm_parameter_arns" {
  description = "ARNs of all SSM parameters"
  value = [
    aws_ssm_parameter.anthropic_api_key.arn,
    aws_ssm_parameter.tailscale_auth_key.arn,
    aws_ssm_parameter.telegram_bot_token.arn,
    aws_ssm_parameter.assistant_name.arn,
    aws_ssm_parameter.instance_id.arn,
  ]
}
