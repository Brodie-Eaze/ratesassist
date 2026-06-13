variable "domain_name" {
  description = "FQDN to issue the certificate for and create the ALIAS record."
  type        = string
}

variable "hosted_zone_id" {
  description = "Route53 hosted zone ID for the domain."
  type        = string
}

variable "alb_dns_name" {
  description = "ALB DNS name to point the ALIAS record at."
  type        = string
}

variable "alb_zone_id" {
  description = "ALB canonical hosted zone ID (for the ALIAS record)."
  type        = string
}

variable "tags" {
  description = "Tags applied to all resources."
  type        = map(string)
  default     = {}
}
