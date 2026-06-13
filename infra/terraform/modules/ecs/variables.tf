variable "name_prefix" {
  description = "Resource name prefix."
  type        = string
}

variable "region" {
  description = "AWS region (for the awslogs driver)."
  type        = string
}

variable "image" {
  description = "Fully-qualified container image reference (repo:tag)."
  type        = string
}

variable "container_port" {
  description = "Port the container listens on."
  type        = number
}

variable "task_cpu" {
  description = "Fargate task CPU units."
  type        = number
}

variable "task_memory" {
  description = "Fargate task memory (MiB)."
  type        = number
}

variable "desired_count" {
  description = "Baseline task count."
  type        = number
}

variable "private_subnet_ids" {
  description = "Private subnets the tasks run in."
  type        = list(string)
}

variable "security_group_id" {
  description = "ECS task security group ID."
  type        = string
}

variable "target_group_arn" {
  description = "ALB target group the service registers into."
  type        = string
}

variable "log_group_name" {
  description = "CloudWatch log group for container logs."
  type        = string
}

# ---- Secrets (ARNs injected at runtime via the task definition) ---------------

variable "anthropic_api_key_secret_arn" {
  description = "Secrets Manager ARN for ANTHROPIC_API_KEY."
  type        = string
}

variable "database_url_secret_arn" {
  description = "Secrets Manager ARN for DATABASE_URL."
  type        = string
}

variable "ra_auth_secret_arn" {
  description = "Secrets Manager ARN for RA_AUTH_SECRET."
  type        = string
}

variable "secrets_kms_key_arn" {
  description = "KMS key ARN the secrets are encrypted with (execution role needs kms:Decrypt)."
  type        = string
}

# ---- Non-secret runtime env ---------------------------------------------------

variable "ra_tool_transport" {
  description = "RA_TOOL_TRANSPORT value."
  type        = string
}

variable "ra_use_db" {
  description = "RA_USE_DB value."
  type        = string
}

variable "node_env" {
  description = "NODE_ENV value."
  type        = string
  default     = "production"
}

variable "enable_execute_command" {
  description = "Allow ECS Exec (interactive shell into the running task). Default false: an exec session lands inside the production container that holds council ratepayer PII and the live DB connection, so it must be a deliberate, time-boxed break-glass action — not always-on. Set true only for a specific debugging window, then set back to false."
  type        = bool
  default     = false
}

# ---- Autoscaling --------------------------------------------------------------

variable "autoscale_min" {
  description = "Minimum task count."
  type        = number
}

variable "autoscale_max" {
  description = "Maximum task count."
  type        = number
}

variable "autoscale_cpu_target" {
  description = "Target CPU utilisation (%) for target-tracking scaling."
  type        = number
}

variable "autoscale_requests_target" {
  description = "Target ALB requests-per-target for request-count target-tracking scaling. 0 disables the request-count policy (CPU-only)."
  type        = number
  default     = 0
}

variable "alb_resource_label" {
  description = "ALB/target-group resource label for the ALBRequestCountPerTarget metric: \"<alb_arn_suffix>/<target_group_arn_suffix>\". Required when autoscale_requests_target > 0."
  type        = string
  default     = ""
}

variable "tags" {
  description = "Tags applied to all resources."
  type        = map(string)
  default     = {}
}
