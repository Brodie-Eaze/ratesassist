locals {
  name_prefix = "${var.project}-${var.environment}"

  account_id = data.aws_caller_identity.current.account_id
  region     = data.aws_region.current.name

  azs = slice(data.aws_availability_zones.available.names, 0, var.az_count)

  common_tags = {
    Project     = var.project
    Environment = var.environment
    Owner       = var.owner
    ManagedBy   = "terraform"
    DataClass   = "council-pii"    # drives DLP / residency review
    Residency   = "ap-southeast-2" # AU data residency marker
  }
}
