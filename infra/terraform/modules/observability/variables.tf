variable "name_prefix" {
  description = "Resource name prefix."
  type        = string
}

variable "log_group_name" {
  description = "CloudWatch log group name for the ECS task."
  type        = string
}

variable "log_retention_days" {
  description = "Log retention in days."
  type        = number
}

variable "kms_key_arn" {
  description = "KMS key ARN to encrypt the log group."
  type        = string
}

variable "alarm_email" {
  description = "Optional email to subscribe to the SNS alarm topic."
  type        = string
  default     = ""
}

variable "alb_arn_suffix" {
  description = "ALB ARN suffix for the 5xx alarm dimension."
  type        = string
}

variable "target_group_arn_suffix" {
  description = "Target group ARN suffix for the unhealthy-host alarm dimension."
  type        = string
}

variable "ecs_cluster_name" {
  description = "ECS cluster name for the CPU alarm dimension."
  type        = string
}

variable "ecs_service_name" {
  description = "ECS service name for the CPU alarm dimension."
  type        = string
}

variable "cpu_high_threshold" {
  description = "ECS service CPU utilisation (%) that trips the high-CPU alarm."
  type        = number
  default     = 85
}

variable "alb_5xx_threshold" {
  description = "Count of ALB 5xx responses over the period that trips the alarm."
  type        = number
  default     = 10
}

variable "region" {
  description = "AWS region (for the dashboard widgets)."
  type        = string
}

variable "db_instance_id" {
  description = "RDS instance identifier for the DatabaseConnections alarm + dashboard. Empty disables the RDS alarm."
  type        = string
  default     = ""
}

variable "p99_latency_threshold_s" {
  description = "ALB target p99 response time (seconds) that trips the latency alarm. Mirrors the officer-read SLO."
  type        = number
  default     = 1.5
}

variable "rds_connections_threshold" {
  description = "DatabaseConnections count that trips the RDS-near-max alarm. Tune to ~80% of the instance's max_connections."
  type        = number
  default     = 80
}

variable "ecs_task_floor" {
  description = "Running-task count below which the ECS task-floor alarm fires (a deploy/crashloop left too few tasks)."
  type        = number
  default     = 1
}

variable "tags" {
  description = "Tags applied to all resources."
  type        = map(string)
  default     = {}
}
