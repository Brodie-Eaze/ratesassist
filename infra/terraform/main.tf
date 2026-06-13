# =============================================================================
# RatesAssist — production AWS composition (Sydney / ap-southeast-2 only).
#
# Wiring order (Terraform resolves the DAG from these references):
#
#   network ─► security ─► alb ─┐
#         │            │        ├─► dns_cert (cert + ALIAS) ─► alb https listener
#         │            └► ecs ◄─┘
#         ├─► secrets ─► ecs
#         └─► database ─► (writes DATABASE_URL secret) ─► ecs
#                       observability ◄─ alb + ecs
# =============================================================================

# ---- Networking ---------------------------------------------------------------

module "network" {
  source = "./modules/network"

  name_prefix        = local.name_prefix
  vpc_cidr           = var.vpc_cidr
  azs                = local.azs
  single_nat_gateway = var.single_nat_gateway
  tags               = local.common_tags
}

# ---- Security groups ----------------------------------------------------------

module "security" {
  source = "./modules/security"

  name_prefix      = local.name_prefix
  vpc_id           = module.network.vpc_id
  container_port   = var.container_port
  db_port          = 5432
  enable_rds_proxy = var.enable_rds_proxy
  tags             = local.common_tags
}

# ---- Container registry -------------------------------------------------------

module "ecr" {
  source = "./modules/ecr"

  name = "${local.name_prefix}-web"
  tags = local.common_tags
}

# ---- Secrets (shells + generated RA_AUTH_SECRET) ------------------------------

module "secrets" {
  source = "./modules/secrets"

  name_prefix       = local.name_prefix
  kms_key_arn       = aws_kms_key.main.arn
  anthropic_api_key = var.anthropic_api_key
  ra_auth_secret    = var.ra_auth_secret
  tags              = local.common_tags
}

# ---- Database (Postgres, Multi-AZ; writes DATABASE_URL secret) -----------------

module "database" {
  source = "./modules/database"

  name_prefix            = local.name_prefix
  subnet_ids             = module.network.private_subnet_ids
  vpc_security_group_ids = [module.security.rds_sg_id]
  kms_key_arn            = aws_kms_key.main.arn

  db_name               = var.db_name
  username              = var.db_username
  db_port               = 5432
  instance_class        = var.db_instance_class
  engine_version        = var.db_engine_version
  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_max_allocated_storage
  backup_retention_days = var.db_backup_retention_days
  deletion_protection   = var.db_deletion_protection
  multi_az              = var.db_multi_az
  enable_rds_proxy      = var.enable_rds_proxy

  database_url_secret_id = module.secrets.database_url_secret_id
  monitoring_role_arn    = aws_iam_role.rds_monitoring.arn

  tags = local.common_tags
}

# ---- ALB (public) -------------------------------------------------------------
# Created before the cert so its DNS name is available for ACM validation and
# the Route53 ALIAS. The HTTPS listener consumes the validated cert ARN.

module "alb" {
  source = "./modules/alb"

  name_prefix       = local.name_prefix
  vpc_id            = module.network.vpc_id
  public_subnet_ids = module.network.public_subnet_ids
  security_group_id = module.security.alb_sg_id
  container_port    = var.container_port
  certificate_arn   = module.dns_cert.certificate_arn
  health_check_path = "/api/health"
  tags              = local.common_tags
}

# ---- DNS + ACM certificate ----------------------------------------------------

module "dns_cert" {
  source = "./modules/dns_cert"

  domain_name    = var.domain_name
  hosted_zone_id = var.hosted_zone_id
  alb_dns_name   = module.alb.alb_dns_name
  alb_zone_id    = module.alb.alb_zone_id
  tags           = local.common_tags
}

# ---- Observability (log group, SNS, alarms) -----------------------------------

module "observability" {
  source = "./modules/observability"

  name_prefix             = local.name_prefix
  log_group_name          = "/ecs/${local.name_prefix}-web"
  log_retention_days      = var.log_retention_days
  kms_key_arn             = aws_kms_key.main.arn
  alarm_email             = var.alarm_email
  alb_arn_suffix          = module.alb.alb_arn_suffix
  target_group_arn_suffix = module.alb.target_group_arn_suffix
  ecs_cluster_name        = "${local.name_prefix}-cluster"
  ecs_service_name        = "${local.name_prefix}-web"
  region                  = var.region
  db_instance_id          = module.database.instance_id
  tags                    = local.common_tags
}

# ---- ECS (cluster, task, service, autoscaling) --------------------------------

module "ecs" {
  source = "./modules/ecs"

  name_prefix    = local.name_prefix
  region         = var.region
  image          = "${module.ecr.repository_url}:${var.image_tag}"
  container_port = var.container_port
  task_cpu       = var.task_cpu
  task_memory    = var.task_memory
  desired_count  = var.desired_count

  private_subnet_ids = module.network.private_subnet_ids
  security_group_id  = module.security.ecs_sg_id
  target_group_arn   = module.alb.target_group_arn
  log_group_name     = module.observability.log_group_name

  anthropic_api_key_secret_arn = module.secrets.anthropic_api_key_arn
  database_url_secret_arn      = module.secrets.database_url_arn
  ra_auth_secret_arn           = module.secrets.ra_auth_secret_arn
  secrets_kms_key_arn          = aws_kms_key.main.arn

  ra_tool_transport = var.ra_tool_transport
  ra_use_db         = var.ra_use_db
  node_env          = "production"

  enable_execute_command = var.enable_execute_command

  autoscale_min             = var.autoscale_min
  autoscale_max             = var.autoscale_max
  autoscale_cpu_target      = var.autoscale_cpu_target
  autoscale_requests_target = var.autoscale_requests_target
  alb_resource_label        = "${module.alb.alb_arn_suffix}/${module.alb.target_group_arn_suffix}"

  tags = local.common_tags

  # Create the service only after the ALB + its HTTPS/redirect listeners exist,
  # so task registration into the target group has a routable LB.
  depends_on = [module.alb]
}
