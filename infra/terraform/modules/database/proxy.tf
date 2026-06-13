# -----------------------------------------------------------------------------
# RDS Proxy — connection multiplexing for officer-scale concurrency.
#
# WHY
# ---
# At thousands of concurrent officers across many autoscaled ECS tasks, each
# task's pg pool (max) × task count can exhaust the instance's max_connections.
# RDS Proxy holds a small warm set of backend connections and multiplexes client
# connections onto them, absorbing connection storms (deploys, scale-out) without
# tipping the database over.
#
# CREDENTIAL MODEL
# ----------------
# The app connects to the PROXY as `app_user` — the NOBYPASSRLS role from
# infra/sql/provision-app-role.sql. The proxy authenticates to RDS using the SAME
# app_user secret, so backend connections run as app_user and RLS (migration 0006)
# applies. app_user must exist in the DB with the password stored in this secret;
# creating it is the human-gated provision step (Q-ra-approle) which reads this
# very secret. Proxy<->instance reachability uses a self-ingress rule on the RDS
# SG (see modules/security) since the proxy shares that SG.
#
# Gated by var.enable_rds_proxy (default false): the baseline apply is unchanged
# (app connects directly to the instance as master). Flip true AFTER app_user is
# provisioned and SG reachability is confirmed at first apply.
# -----------------------------------------------------------------------------

resource "random_password" "app_user" {
  count   = var.enable_rds_proxy ? 1 : 0
  length  = 32
  special = false # avoid URL-encoding headaches in the connection string
}

resource "aws_secretsmanager_secret" "app_user" {
  count       = var.enable_rds_proxy ? 1 : 0
  name_prefix = "${var.name_prefix}-app-user-"
  description = "RatesAssist app_user (NOBYPASSRLS) credentials — RDS Proxy auth + app DATABASE_URL."
  kms_key_id  = var.kms_key_arn
  tags        = var.tags
}

resource "aws_secretsmanager_secret_version" "app_user" {
  count     = var.enable_rds_proxy ? 1 : 0
  secret_id = aws_secretsmanager_secret.app_user[0].id
  secret_string = jsonencode({
    username = "app_user"
    password = random_password.app_user[0].result
  })
}

# IAM role the proxy assumes to read the app_user secret + decrypt it with the CMK.
data "aws_iam_policy_document" "proxy_assume" {
  count = var.enable_rds_proxy ? 1 : 0
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["rds.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "proxy" {
  count              = var.enable_rds_proxy ? 1 : 0
  name_prefix        = "${var.name_prefix}-proxy-"
  assume_role_policy = data.aws_iam_policy_document.proxy_assume[0].json
  tags               = var.tags
}

data "aws_iam_policy_document" "proxy_secret_access" {
  count = var.enable_rds_proxy ? 1 : 0
  statement {
    sid       = "ReadAppUserSecret"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.app_user[0].arn]
  }
  statement {
    sid       = "DecryptAppUserSecret"
    actions   = ["kms:Decrypt"]
    resources = [var.kms_key_arn]
  }
}

resource "aws_iam_role_policy" "proxy_secret_access" {
  count  = var.enable_rds_proxy ? 1 : 0
  name   = "secret-access"
  role   = aws_iam_role.proxy[0].id
  policy = data.aws_iam_policy_document.proxy_secret_access[0].json
}

resource "aws_db_proxy" "this" {
  count                  = var.enable_rds_proxy ? 1 : 0
  name                   = "${var.name_prefix}-proxy"
  engine_family          = "POSTGRESQL"
  role_arn               = aws_iam_role.proxy[0].arn
  vpc_subnet_ids         = var.subnet_ids
  vpc_security_group_ids = var.vpc_security_group_ids
  require_tls            = true # pairs with rds.force_ssl on the instance
  idle_client_timeout    = 1800
  debug_logging          = false

  auth {
    auth_scheme = "SECRETS"
    secret_arn  = aws_secretsmanager_secret.app_user[0].arn
    iam_auth    = "DISABLED"
  }

  tags = var.tags
}

resource "aws_db_proxy_default_target_group" "this" {
  count         = var.enable_rds_proxy ? 1 : 0
  db_proxy_name = aws_db_proxy.this[0].name

  connection_pool_config {
    max_connections_percent      = 90
    max_idle_connections_percent = 50
    connection_borrow_timeout    = 120
  }
}

resource "aws_db_proxy_target" "this" {
  count                  = var.enable_rds_proxy ? 1 : 0
  db_proxy_name          = aws_db_proxy.this[0].name
  target_group_name      = aws_db_proxy_default_target_group.this[0].name
  db_instance_identifier = aws_db_instance.this.id
}
