variable "name_prefix" {
  description = "Resource name prefix."
  type        = string
}

variable "vpc_id" {
  description = "VPC the security groups belong to."
  type        = string
}

variable "container_port" {
  description = "App port ECS tasks listen on (ALB -> ECS)."
  type        = number
}

variable "db_port" {
  description = "Database port (ECS -> RDS)."
  type        = number
  default     = 5432
}

variable "enable_rds_proxy" {
  description = "When true, add a self-referencing 5432 ingress on the RDS SG so an RDS Proxy sharing that SG can reach the instance (proxy -> instance)."
  type        = bool
  default     = false
}

variable "tags" {
  description = "Tags applied to all resources."
  type        = map(string)
  default     = {}
}
