# -----------------------------------------------------------------------------
# Input variables — root composition.
# -----------------------------------------------------------------------------

variable "region" {
  description = "AWS region. LOCKED to ap-southeast-2 (Sydney) for AU data residency."
  type        = string
  default     = "ap-southeast-2"

  validation {
    condition     = can(regex("^ap-southeast-2$", var.region))
    error_message = "AU data residency is mandatory: region must be ap-southeast-2 (Sydney). No US regions permitted."
  }
}

variable "project" {
  description = "Project slug used for naming and tagging."
  type        = string
  default     = "ratesassist"
}

variable "environment" {
  description = "Deployment environment (prod, staging, dev). Drives naming + tags."
  type        = string
  default     = "prod"
}

variable "owner" {
  description = "Owner tag applied to every resource (cost attribution + accountability)."
  type        = string
  default     = "platform@ratesassist"
}

# ---- DNS / certificate --------------------------------------------------------

variable "domain_name" {
  description = "Fully-qualified domain the app is served on, e.g. app.ratesassist.com.au."
  type        = string
}

variable "hosted_zone_id" {
  description = "Route53 hosted zone ID that the domain belongs to (zone must be delegated to AWS)."
  type        = string
}

# ---- Container image ----------------------------------------------------------

variable "image_tag" {
  description = "Container image tag to deploy — MUST be an immutable tag that exists in ECR (e.g. a git SHA like sha-1a2b3c4). REQUIRED, no default: the ECR repo is created with IMMUTABLE tags, so a literal 'latest' would never resolve and the ECS task would fail to pull. Set per-deploy to the SHA you pushed."
  type        = string

  validation {
    # Reject the two values that silently break an IMMUTABLE-tag pull.
    condition     = var.image_tag != "" && var.image_tag != "latest"
    error_message = "image_tag must be a concrete immutable tag (e.g. a git SHA); 'latest' and empty string are rejected because the ECR repo uses IMMUTABLE tags."
  }
}

variable "enable_execute_command" {
  description = "Allow ECS Exec (interactive shell into the running task). Default false — an exec session lands inside the production container holding ratepayer PII + the DB connection, so keep it off and flip to true only for a deliberate, time-boxed debugging window."
  type        = bool
  default     = false
}

# ---- ECS sizing ---------------------------------------------------------------

variable "container_port" {
  description = "Port the Next.js standalone server listens on inside the container."
  type        = number
  default     = 3000
}

variable "desired_count" {
  description = "Baseline number of ECS tasks. Default 1 for the pre-pilot stage (synthetic data, no signed council) to keep burn low. PROD-GRADE FLIP: set to 2 (with autoscale_min = 2) before real council PII so a deploy or a task death never leaves zero healthy tasks."
  type        = number
  default     = 1
}

variable "task_cpu" {
  description = "Fargate task CPU units (256/512/1024/2048/4096)."
  type        = number
  default     = 1024
}

variable "task_memory" {
  description = "Fargate task memory in MiB. Must be a valid pairing with task_cpu."
  type        = number
  default     = 2048
}

variable "autoscale_min" {
  description = "Minimum task count for Application Auto Scaling. Default 1 for pre-pilot (pairs with desired_count = 1). PROD-GRADE FLIP: set to 2 before real council PII so there is always a warm second task across an AZ."
  type        = number
  default     = 1
}

variable "autoscale_max" {
  description = "Maximum task count for Application Auto Scaling."
  type        = number
  default     = 8
}

variable "autoscale_cpu_target" {
  description = "Target average CPU utilisation (%) for target-tracking autoscaling."
  type        = number
  default     = 60
}

variable "autoscale_requests_target" {
  description = "Target ALB requests-per-target for request-count autoscaling (a second target-tracking policy alongside CPU; ECS scales on the MAX of the two). 0 = disabled (CPU-only), the pre-pilot default. PROD-GRADE FLIP: set to ~800-1200 before the officer-scale load test so the service scales out on traffic shape, not just CPU. Tune against the load-test p99."
  type        = number
  default     = 0
}

variable "enable_rds_proxy" {
  description = "Front the database with an RDS Proxy and serve as the NOBYPASSRLS app_user (connection multiplexing for officer-scale concurrency). Default false: baseline apply connects directly to the instance as master. PROD-GRADE FLIP: provision app_user (infra/sql/provision-app-role.sql) then set true before the officer-scale load test so connection storms don't exhaust max_connections."
  type        = bool
  default     = false
}

# ---- Networking ---------------------------------------------------------------

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.40.0.0/16"
}

variable "az_count" {
  description = "Number of Availability Zones to span (>= 2 for Multi-AZ ALB + RDS)."
  type        = number
  default     = 2

  validation {
    condition     = var.az_count >= 2
    error_message = "az_count must be >= 2 so the ALB and Multi-AZ RDS have at least two subnets."
  }
}

variable "single_nat_gateway" {
  description = "If true, route all private subnets through ONE NAT gateway (cheaper, lower HA). Set false for one NAT per AZ in prod."
  type        = bool
  default     = true
}

# ---- RDS ----------------------------------------------------------------------

variable "db_name" {
  description = "Initial database name created in the RDS instance."
  type        = string
  default     = "ratesassist"
}

variable "db_username" {
  description = "Master username for the RDS PostgreSQL instance."
  type        = string
  default     = "ratesassist_app"
}

variable "db_instance_class" {
  description = "RDS instance class. Default db.t4g.small for pre-pilot (synthetic data fits comfortably). PROD-GRADE FLIP: step up to db.t4g.medium or larger as real council data volume grows; resize is an in-place modify (brief failover blip on Multi-AZ)."
  type        = string
  default     = "db.t4g.small"
}

variable "db_multi_az" {
  description = "Run RDS as Multi-AZ (synchronous standby in a second AZ). Default false for pre-pilot to halve the DB bill. PROD-GRADE FLIP: set true before real council PII — Multi-AZ is the difference between a ~1-minute automatic failover and a multi-hour restore-from-snapshot during an AZ outage. AU data residency is unaffected (both AZs are in ap-southeast-2)."
  type        = bool
  default     = false
}

variable "db_engine_version" {
  description = "PostgreSQL engine version for RDS."
  type        = string
  default     = "16.4"
}

variable "db_allocated_storage" {
  description = "Initial allocated storage (GiB)."
  type        = number
  default     = 50
}

variable "db_max_allocated_storage" {
  description = "Upper bound for RDS storage autoscaling (GiB)."
  type        = number
  default     = 200
}

variable "db_backup_retention_days" {
  description = "Automated backup / PITR retention window in days."
  type        = number
  default     = 14
}

variable "db_deletion_protection" {
  description = "Protect the production database from accidental destroy."
  type        = bool
  default     = true
}

# ---- Runtime application config (non-secret) ----------------------------------

variable "ra_tool_transport" {
  description = "RA_TOOL_TRANSPORT env value. 'inproc' runs MCP tools in-process (matches Vercel)."
  type        = string
  default     = "inproc"
}

variable "ra_use_db" {
  description = "RA_USE_DB env value. 'true' puts RDS in the serving path."
  type        = string
  default     = "true"
}

variable "log_retention_days" {
  description = "CloudWatch log group retention in days."
  type        = number
  default     = 90
}

variable "alarm_email" {
  description = "Email subscribed to the SNS alarm topic. Leave empty to skip the subscription (wire PagerDuty/Slack later)."
  type        = string
  default     = ""
}

# ---- CI/CD (GitHub Actions OIDC) ----------------------------------------------

variable "github_owner" {
  description = "GitHub org/user that owns the repo (for the OIDC trust subject)."
  type        = string
  default     = "Brodie-Eaze"
}

variable "github_repo" {
  description = "GitHub repository name (for the OIDC trust subject)."
  type        = string
  default     = "ratesassist"
}

variable "create_github_oidc_provider" {
  description = "Create the GitHub Actions OIDC provider. Set false if the account already has one (only one per account is allowed)."
  type        = bool
  default     = true
}

variable "github_deploy_branch" {
  description = "Branch the deploy role trusts (sub claim is scoped to this ref)."
  type        = string
  default     = "main"
}

# ---- Secret seed values (optional) --------------------------------------------
# Prefer leaving these empty and populating Secrets Manager out-of-band so real
# secrets never enter Terraform state. The README documents the aws CLI flow.

variable "anthropic_api_key" {
  description = "OPTIONAL seed for the ANTHROPIC_API_KEY secret. Leave empty and set via aws secretsmanager put-secret-value to keep it out of state."
  type        = string
  default     = ""
  sensitive   = true
}

variable "ra_auth_secret" {
  description = "OPTIONAL seed for the RA_AUTH_SECRET secret (>=16 chars). Leave empty to have Terraform generate a strong random value."
  type        = string
  default     = ""
  sensitive   = true
}
