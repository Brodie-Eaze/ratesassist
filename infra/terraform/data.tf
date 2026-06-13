# Discover account + region context instead of hardcoding ARNs / IDs.
data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

# Available AZs in-region; we slice the first var.az_count.
data "aws_availability_zones" "available" {
  state = "available"
}
