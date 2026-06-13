# -----------------------------------------------------------------------------
# Project CMK — one customer-managed key encrypting secrets, RDS storage,
# the CloudWatch log group, and the SNS alarm topic. Rotation enabled.
#
# The key policy grants:
#   - the account root full admin (so IAM can delegate normally)
#   - the regional CloudWatch Logs service principal encrypt/decrypt, scoped to
#     this account's log groups (required or the log group create fails)
# Secrets Manager + RDS + SNS use the key via standard service integration; the
# ECS execution role gets a tightly-scoped kms:Decrypt grant in its own policy.
# -----------------------------------------------------------------------------

data "aws_iam_policy_document" "kms" {
  statement {
    sid       = "EnableAccountAdmin"
    effect    = "Allow"
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${local.account_id}:root"]
    }
  }

  statement {
    sid    = "AllowCloudWatchLogs"
    effect = "Allow"
    actions = [
      "kms:Encrypt",
      "kms:Decrypt",
      "kms:ReEncrypt*",
      "kms:GenerateDataKey*",
      "kms:Describe*",
    ]
    resources = ["*"]
    principals {
      type        = "Service"
      identifiers = ["logs.${local.region}.amazonaws.com"]
    }
    condition {
      test     = "ArnLike"
      variable = "kms:EncryptionContext:aws:logs:arn"
      values   = ["arn:aws:logs:${local.region}:${local.account_id}:log-group:*"]
    }
  }
}

resource "aws_kms_key" "main" {
  description             = "${local.name_prefix} CMK (secrets, RDS, logs, SNS)"
  deletion_window_in_days = 14
  enable_key_rotation     = true
  policy                  = data.aws_iam_policy_document.kms.json
  tags                    = local.common_tags
}

resource "aws_kms_alias" "main" {
  name          = "alias/${local.name_prefix}"
  target_key_id = aws_kms_key.main.key_id
}
