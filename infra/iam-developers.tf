# IAM user for Illia — scoped to nanoclaw resources only
resource "aws_iam_user" "illia" {
  name = "illia-developer"

  tags = {
    Name      = "illia-developer"
    Developer = "illia"
  }
}

# Managed policy (inline user policies have 2048 byte limit)
resource "aws_iam_policy" "developer_access" {
  name        = "nanoclaw-developer-access"
  description = "Scoped access for NanoClaw developers"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "EC2Describe"
        Effect   = "Allow"
        Action   = "ec2:Describe*"
        Resource = "*"
        Condition = {
          StringEquals = { "aws:RequestedRegion" = "us-east-2" }
        }
      },
      {
        Sid    = "EC2Manage"
        Effect = "Allow"
        Action = [
          "ec2:RunInstances",
          "ec2:StartInstances",
          "ec2:StopInstances",
          "ec2:TerminateInstances",
          "ec2:CreateSecurityGroup",
          "ec2:DeleteSecurityGroup",
          "ec2:AuthorizeSecurityGroupIngress",
          "ec2:RevokeSecurityGroupIngress",
          "ec2:AuthorizeSecurityGroupEgress",
          "ec2:RevokeSecurityGroupEgress",
          "ec2:CreateTags",
          "ec2:DeleteTags",
        ]
        Resource = "*"
        Condition = {
          StringEquals = { "aws:RequestedRegion" = "us-east-2" }
        }
      },
      {
        Sid    = "SSMParameters"
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:GetParametersByPath",
          "ssm:PutParameter",
          "ssm:DeleteParameter",
          "ssm:DescribeParameters",
          "ssm:AddTagsToResource",
          "ssm:RemoveTagsFromResource",
          "ssm:ListTagsForResource",
        ]
        Resource = "arn:aws:ssm:us-east-2:796196972655:parameter/nanoclaw/*"
      },
      {
        Sid    = "SSMSessionManager"
        Effect = "Allow"
        Action = [
          "ssm:StartSession",
          "ssm:TerminateSession",
          "ssm:ResumeSession",
          "ssm:DescribeSessions",
          "ssm:GetConnectionStatus",
        ]
        Resource = "*"
        Condition = {
          StringEquals = { "aws:RequestedRegion" = "us-east-2" }
        }
      },
      {
        Sid    = "IAMNanoclawRoles"
        Effect = "Allow"
        Action = [
          "iam:TagInstanceProfile",
          "iam:UntagInstanceProfile",
          "iam:GetRole",
          "iam:CreateRole",
          "iam:DeleteRole",
          "iam:TagRole",
          "iam:UntagRole",
          "iam:PutRolePolicy",
          "iam:GetRolePolicy",
          "iam:DeleteRolePolicy",
          "iam:AttachRolePolicy",
          "iam:DetachRolePolicy",
          "iam:ListRolePolicies",
          "iam:ListAttachedRolePolicies",
          "iam:ListInstanceProfilesForRole",
          "iam:CreateInstanceProfile",
          "iam:DeleteInstanceProfile",
          "iam:AddRoleToInstanceProfile",
          "iam:RemoveRoleFromInstanceProfile",
          "iam:GetInstanceProfile",
          "iam:PassRole",
        ]
        Resource = [
          "arn:aws:iam::796196972655:role/nanoclaw-*",
          "arn:aws:iam::796196972655:instance-profile/nanoclaw-*",
        ]
      },
      {
        Sid    = "S3Buckets"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket",
        ]
        Resource = [
          "arn:aws:s3:::nanoclaw-backups-*",
          "arn:aws:s3:::nanoclaw-backups-*/*",
          "arn:aws:s3:::nanoclaw-tf-state-*",
          "arn:aws:s3:::nanoclaw-tf-state-*/*",
        ]
      },
      {
        Sid    = "DynamoDBLocks"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:DeleteItem",
        ]
        Resource = "arn:aws:dynamodb:us-east-2:796196972655:table/nanoclaw-tf-locks"
      },
      {
        Sid      = "STSGetCaller"
        Effect   = "Allow"
        Action   = "sts:GetCallerIdentity"
        Resource = "*"
      },
    ]
  })

  tags = {
    Name = "nanoclaw-developer-access"
  }
}

resource "aws_iam_user_policy_attachment" "illia" {
  user       = aws_iam_user.illia.name
  policy_arn = aws_iam_policy.developer_access.arn
}
