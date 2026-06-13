# -----------------------------------------------------------------------------
# Per-service IAM — two distinct roles, no sharing:
#
#   execution role : what ECS/Fargate uses to START the task — pull the image,
#                    fetch the three secrets, write logs. Scoped to EXACTLY the
#                    three secret ARNs + the KMS key, not secretsmanager:*.
#   task role      : the app's own runtime identity. The app does not call other
#                    AWS APIs (LLM is external), so this role is intentionally
#                    empty — present for least-privilege correctness and so any
#                    future S3/SQS grant is additive and reviewable.
# -----------------------------------------------------------------------------

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# ---- Execution role -----------------------------------------------------------

resource "aws_iam_role" "execution" {
  name               = "${var.name_prefix}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
  tags               = var.tags
}

# Image pull + base log permissions.
resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Tightly-scoped secret read + KMS decrypt for the three secrets only.
data "aws_iam_policy_document" "execution_secrets" {
  statement {
    sid     = "ReadAppSecrets"
    effect  = "Allow"
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      var.anthropic_api_key_secret_arn,
      var.database_url_secret_arn,
      var.ra_auth_secret_arn,
    ]
  }

  statement {
    sid       = "DecryptSecretsCmk"
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = [var.secrets_kms_key_arn]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${var.region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "${var.name_prefix}-ecs-execution-secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

# ---- Task role (runtime identity; intentionally minimal) ----------------------

resource "aws_iam_role" "task" {
  name               = "${var.name_prefix}-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
  tags               = var.tags
}
