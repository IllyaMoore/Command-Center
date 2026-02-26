#!/usr/bin/env bash
set -euo pipefail

PROFILE=""
REGION="us-east-2"

usage() {
  echo "Usage: $0 --profile <aws-profile> [--region <aws-region>]"
  echo ""
  echo "Creates S3 bucket and DynamoDB table for Terraform state."
  echo "Run once before first 'terraform init'."
  exit 1
}

while [[ $# -gt 0 ]]; do
  case $1 in
    --profile) PROFILE="$2"; shift 2 ;;
    --region)  REGION="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "Unknown option: $1"; usage ;;
  esac
done

if [[ -z "$PROFILE" ]]; then
  echo "Error: --profile is required"
  usage
fi

ACCOUNT_ID=$(aws sts get-caller-identity --profile "$PROFILE" --query Account --output text)
BUCKET_NAME="nanoclaw-tf-state-${ACCOUNT_ID}"
TABLE_NAME="nanoclaw-tf-locks"

echo "AWS Account:    $ACCOUNT_ID"
echo "Region:         $REGION"
echo "S3 Bucket:      $BUCKET_NAME"
echo "DynamoDB Table: $TABLE_NAME"
echo ""

# S3 bucket
if aws s3api head-bucket --bucket "$BUCKET_NAME" --profile "$PROFILE" 2>/dev/null; then
  echo "S3 bucket '$BUCKET_NAME' already exists, skipping."
else
  echo "Creating S3 bucket '$BUCKET_NAME'..."
  aws s3api create-bucket \
    --bucket "$BUCKET_NAME" \
    --region "$REGION" \
    --profile "$PROFILE" \
    --create-bucket-configuration LocationConstraint="$REGION"

  aws s3api put-bucket-versioning \
    --bucket "$BUCKET_NAME" \
    --profile "$PROFILE" \
    --versioning-configuration Status=Enabled

  aws s3api put-bucket-encryption \
    --bucket "$BUCKET_NAME" \
    --profile "$PROFILE" \
    --server-side-encryption-configuration '{
      "Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "aws:kms"}, "BucketKeyEnabled": true}]
    }'

  aws s3api put-public-access-block \
    --bucket "$BUCKET_NAME" \
    --profile "$PROFILE" \
    --public-access-block-configuration '{
      "BlockPublicAcls": true,
      "IgnorePublicAcls": true,
      "BlockPublicPolicy": true,
      "RestrictPublicBuckets": true
    }'

  echo "S3 bucket created."
fi

# DynamoDB table
if aws dynamodb describe-table --table-name "$TABLE_NAME" --region "$REGION" --profile "$PROFILE" &>/dev/null; then
  echo "DynamoDB table '$TABLE_NAME' already exists, skipping."
else
  echo "Creating DynamoDB table '$TABLE_NAME'..."
  aws dynamodb create-table \
    --table-name "$TABLE_NAME" \
    --region "$REGION" \
    --profile "$PROFILE" \
    --attribute-definitions AttributeName=LockID,AttributeType=S \
    --key-schema AttributeName=LockID,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    --tags Key=Project,Value=nanoclaw Key=ManagedBy,Value=terraform

  aws dynamodb wait table-exists --table-name "$TABLE_NAME" --region "$REGION" --profile "$PROFILE"
  echo "DynamoDB table created."
fi

echo ""
echo "Bootstrap complete. Run terraform init:"
echo "  cd infra"
echo "  terraform init -backend-config=\"key=nanoclaw/staging/terraform.tfstate\""
