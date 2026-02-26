terraform {
  backend "s3" {
    bucket         = "nanoclaw-tf-state-796196972655"
    region         = "us-east-2"
    dynamodb_table = "nanoclaw-tf-locks"
    encrypt        = true

    # Key and profile set dynamically during init:
    #   Local:  terraform init -backend-config="profile=sam" -backend-config="key=nanoclaw/staging/terraform.tfstate"
    #   CI:     terraform init -backend-config="key=nanoclaw/staging/terraform.tfstate"  (uses OIDC, no profile)
  }
}
