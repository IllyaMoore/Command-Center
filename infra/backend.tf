terraform {
  backend "s3" {
    bucket         = "nanoclaw-tf-state-796196972655"
    region         = "us-east-2"
    dynamodb_table = "nanoclaw-tf-locks"
    encrypt        = true
    profile        = "sam"

    # Key set dynamically during init:
    #   terraform init -backend-config="key=nanoclaw/staging/terraform.tfstate"
    #   terraform init -backend-config="key=nanoclaw/prod/terraform.tfstate"
  }
}
