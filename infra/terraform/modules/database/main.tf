# -----------------------------------------------------------------------------
# Database module — RDS PostgreSQL, Multi-AZ, in private subnets.
#
#   - storage encrypted with the project CMK
#   - master password GENERATED (random_password) — never typed by a human,
#     never set as a literal in tfvars
#   - the assembled DATABASE_URL is written into the pre-created Secrets Manager
#     secret; the password lands in Terraform state (unavoidable for a managed
#     password) but NOT in any committed file
#   - PITR via automated backups, deletion protection on by default
# -----------------------------------------------------------------------------

resource "random_password" "db" {
  length  = 32
  special = false # avoid URL-encoding headaches in the connection string
}

resource "aws_db_subnet_group" "this" {
  name       = "${var.name_prefix}-db"
  subnet_ids = var.subnet_ids
  tags       = merge(var.tags, { Name = "${var.name_prefix}-db-subnet-group" })
}

resource "aws_db_parameter_group" "this" {
  name_prefix = "${var.name_prefix}-pg16-"
  family      = "postgres16"
  description = "RatesAssist Postgres 16 parameters (force TLS)."

  # Refuse non-TLS connections — council PII in transit must be encrypted.
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  tags = var.tags

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_db_instance" "this" {
  identifier     = "${var.name_prefix}-pg"
  engine         = "postgres"
  engine_version = var.engine_version
  instance_class = var.instance_class
  port           = var.db_port

  db_name  = var.db_name
  username = var.username
  password = random_password.db.result

  allocated_storage     = var.allocated_storage
  max_allocated_storage = var.max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = var.kms_key_arn

  multi_az               = var.multi_az
  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = var.vpc_security_group_ids
  parameter_group_name   = aws_db_parameter_group.this.name
  publicly_accessible    = false

  backup_retention_period   = var.backup_retention_days
  backup_window             = "16:00-16:30" # 02:00-02:30 AEST (UTC+10) low-traffic
  maintenance_window        = "Sun:17:00-Sun:17:30"
  copy_tags_to_snapshot     = true
  deletion_protection       = var.deletion_protection
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.name_prefix}-pg-final"
  apply_immediately         = false

  performance_insights_enabled    = true
  performance_insights_kms_key_id = var.kms_key_arn
  monitoring_interval             = var.monitoring_role_arn != "" ? 60 : 0
  monitoring_role_arn             = var.monitoring_role_arn != "" ? var.monitoring_role_arn : null
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]

  auto_minor_version_upgrade = true

  tags = merge(var.tags, { Name = "${var.name_prefix}-pg" })

  lifecycle {
    # Password changes are managed out-of-band via rotation; don't let a
    # re-generated random value force a replace.
    ignore_changes = [password]
  }
}

# Assemble and store the connection string the app reads as DATABASE_URL.
# sslmode=require pairs with rds.force_ssl above.
#
# When the RDS Proxy is enabled the app connects to the PROXY endpoint as the
# NOBYPASSRLS `app_user` (so RLS applies and connection storms are absorbed);
# otherwise it connects directly to the instance as the master user. The splat +
# one() pattern is null-safe when the proxy resources have count = 0, so the
# false branch never indexes a non-existent resource.
locals {
  serving_host = var.enable_rds_proxy ? one(aws_db_proxy.this[*].endpoint) : aws_db_instance.this.address
  serving_user = var.enable_rds_proxy ? "app_user" : var.username
  serving_pass = var.enable_rds_proxy ? one(random_password.app_user[*].result) : random_password.db.result
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id = var.database_url_secret_id
  secret_string = format(
    "postgresql://%s:%s@%s:%d/%s?sslmode=require",
    local.serving_user,
    local.serving_pass,
    local.serving_host,
    var.db_port,
    var.db_name,
  )
}
