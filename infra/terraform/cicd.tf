# -----------------------------------------------------------------------------
# CI/CD identity — GitHub Actions OIDC + a least-privilege deploy role.
#
# The deploy pipeline IS the security boundary, so the role it assumes is
# scoped hard:
#   - trust: ONLY this repo, ONLY the deploy branch (sub claim pinned)
#   - ECR: auth + push to THIS repository only
#   - ECS: describe/register task defs + update THIS service only
#   - iam:PassRole: ONLY the two ECS roles (execution + task), and only to ECS
#
# No long-lived access keys exist anywhere. The workflow reads this role's ARN
# from the AWS_DEPLOY_ROLE_ARN GitHub secret (the ARN is not sensitive, but the
# secret keeps it out of the repo).
# -----------------------------------------------------------------------------

# GitHub's OIDC thumbprint is no longer validated by IAM for this issuer, but
# the provider still requires the field; this is GitHub's well-known root.
resource "aws_iam_openid_connect_provider" "github" {
  count = var.create_github_oidc_provider ? 1 : 0

  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]

  tags = local.common_tags
}

locals {
  github_oidc_provider_arn = var.create_github_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : "arn:aws:iam::${local.account_id}:oidc-provider/token.actions.githubusercontent.com"
  github_sub_main          = "repo:${var.github_owner}/${var.github_repo}:ref:refs/heads/${var.github_deploy_branch}"
}

data "aws_iam_policy_document" "github_deploy_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.github_oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # Pin to the repo + branch so only deploys from main can assume the role.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = [local.github_sub_main]
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  name                 = "${local.name_prefix}-github-deploy"
  assume_role_policy   = data.aws_iam_policy_document.github_deploy_assume.json
  max_session_duration = 3600
  tags                 = local.common_tags
}

data "aws_iam_policy_document" "github_deploy" {
  # ECR auth token is account-wide by API design.
  statement {
    sid       = "EcrAuth"
    effect    = "Allow"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  # Push/pull limited to the app repository.
  statement {
    sid    = "EcrPushThisRepo"
    effect = "Allow"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
      "ecr:PutImage",
    ]
    resources = [module.ecr.repository_arn]
  }

  # Read task defs (any revision of the family) to render the next one.
  statement {
    sid    = "EcsDescribeRegister"
    effect = "Allow"
    actions = [
      "ecs:DescribeTaskDefinition",
      "ecs:RegisterTaskDefinition",
    ]
    resources = ["*"] # these two actions don't support resource-level scoping
  }

  # Update + observe ONLY this service in this cluster.
  statement {
    sid    = "EcsUpdateThisService"
    effect = "Allow"
    actions = [
      "ecs:UpdateService",
      "ecs:DescribeServices",
    ]
    resources = [module.ecs.service_arn]
    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [module.ecs.cluster_arn]
    }
  }

  # PassRole strictly limited to the two ECS roles, and only to the ECS service.
  statement {
    sid     = "PassEcsRolesOnly"
    effect  = "Allow"
    actions = ["iam:PassRole"]
    resources = [
      module.ecs.execution_role_arn,
      module.ecs.task_role_arn,
    ]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "github_deploy" {
  name   = "${local.name_prefix}-github-deploy"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.github_deploy.json
}

output "github_deploy_role_arn" {
  description = "ARN to set as the GitHub Actions secret AWS_DEPLOY_ROLE_ARN."
  value       = aws_iam_role.github_deploy.arn
}
