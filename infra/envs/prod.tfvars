environment        = "prod"
vpc_cidr           = "10.0.0.0/16"
private_subnets    = ["10.0.1.0/24", "10.0.3.0/24"]
public_subnets     = ["10.0.101.0/24"]
availability_zones = ["us-east-2a", "us-east-2b"]
vpce_az_count      = 1
