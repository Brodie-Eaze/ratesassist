variable "name_prefix" {
  description = "Resource name prefix."
  type        = string
}

variable "kms_key_arn" {
  description = "KMS key ARN used to encrypt the secrets at rest."
  type        = string
}

variable "anthropic_api_key" {
  description = "OPTIONAL seed value for ANTHROPIC_API_KEY. Empty => create the secret shell only (populate out-of-band)."
  type        = string
  default     = ""
  sensitive   = true
}

variable "ra_auth_secret" {
  description = "OPTIONAL seed value for RA_AUTH_SECRET. Empty => Terraform generates a strong random value."
  type        = string
  default     = ""
  sensitive   = true
}

variable "recovery_window_days" {
  description = "Secrets Manager recovery window before permanent deletion."
  type        = number
  default     = 7
}

variable "tags" {
  description = "Tags applied to all resources."
  type        = map(string)
  default     = {}
}
