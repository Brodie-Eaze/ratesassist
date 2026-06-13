variable "name_prefix" {
  description = "Resource name prefix."
  type        = string
}

variable "vpc_id" {
  description = "VPC for the target group."
  type        = string
}

variable "public_subnet_ids" {
  description = "Public subnets the ALB lives in."
  type        = list(string)
}

variable "security_group_id" {
  description = "ALB security group ID."
  type        = string
}

variable "container_port" {
  description = "Port the target group forwards to."
  type        = number
}

variable "certificate_arn" {
  description = "Validated ACM certificate ARN for the HTTPS listener."
  type        = string
}

variable "health_check_path" {
  description = "Path the target group health check hits."
  type        = string
  default     = "/api/health"
}

variable "ssl_policy" {
  description = "ALB HTTPS listener SSL policy (TLS 1.2+ baseline)."
  type        = string
  default     = "ELBSecurityPolicy-TLS13-1-2-2021-06"
}

variable "deletion_protection" {
  description = "Enable ALB deletion protection."
  type        = bool
  default     = true
}

variable "enable_access_logs" {
  description = "Whether to ship ALB access logs to S3."
  type        = bool
  default     = false
}

variable "access_logs_bucket" {
  description = "S3 bucket for ALB access logs (required if enable_access_logs)."
  type        = string
  default     = ""
}

variable "tags" {
  description = "Tags applied to all resources."
  type        = map(string)
  default     = {}
}
