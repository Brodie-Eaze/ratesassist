variable "name_prefix" {
  description = "Resource name prefix."
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
}

variable "azs" {
  description = "List of Availability Zone names to span."
  type        = list(string)
}

variable "single_nat_gateway" {
  description = "Route all private subnets through one NAT gateway (cheaper) vs one per AZ (HA)."
  type        = bool
  default     = true
}

variable "tags" {
  description = "Tags applied to all resources."
  type        = map(string)
  default     = {}
}
