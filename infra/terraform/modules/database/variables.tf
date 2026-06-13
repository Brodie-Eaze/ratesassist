variable "name_prefix" {
  description = "Resource name prefix."
  type        = string
}

variable "subnet_ids" {
  description = "Private subnet IDs for the DB subnet group."
  type        = list(string)
}

variable "vpc_security_group_ids" {
  description = "Security group IDs attached to the RDS instance (RDS SG)."
  type        = list(string)
}

variable "kms_key_arn" {
  description = "KMS key ARN for storage + Performance Insights encryption."
  type        = string
}

variable "db_name" {
  description = "Initial database name."
  type        = string
}

variable "username" {
  description = "Master username."
  type        = string
}

variable "db_port" {
  description = "Database port."
  type        = number
  default     = 5432
}

variable "instance_class" {
  description = "RDS instance class."
  type        = string
}

variable "engine_version" {
  description = "PostgreSQL engine version."
  type        = string
}

variable "allocated_storage" {
  description = "Initial allocated storage (GiB)."
  type        = number
}

variable "max_allocated_storage" {
  description = "Storage autoscaling upper bound (GiB)."
  type        = number
}

variable "backup_retention_days" {
  description = "Automated backup / PITR retention in days."
  type        = number
}

variable "deletion_protection" {
  description = "Protect the instance from destroy."
  type        = bool
}

variable "multi_az" {
  description = "Run the instance Multi-AZ."
  type        = bool
  default     = true
}

variable "enable_rds_proxy" {
  description = "Place an RDS Proxy in front of the instance and route DATABASE_URL through it as the NOBYPASSRLS app_user. Default false: the baseline apply connects directly as the master user. Flip true after app_user is provisioned (infra/sql/provision-app-role.sql) and SG reachability is confirmed at first apply."
  type        = bool
  default     = false
}

variable "database_url_secret_id" {
  description = "Secrets Manager secret ID to write the assembled DATABASE_URL into."
  type        = string
}

variable "monitoring_role_arn" {
  description = "IAM role ARN for RDS Enhanced Monitoring. Empty disables enhanced monitoring."
  type        = string
  default     = ""
}

variable "tags" {
  description = "Tags applied to all resources."
  type        = map(string)
  default     = {}
}
