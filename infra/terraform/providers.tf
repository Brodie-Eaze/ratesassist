# Primary provider — Sydney only. AU data residency is a hard legal
# requirement for council data; there is no US/secondary region anywhere
# in this stack.
provider "aws" {
  region = var.region

  default_tags {
    tags = local.common_tags
  }
}
