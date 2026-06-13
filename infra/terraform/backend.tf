# -----------------------------------------------------------------------------
# Remote state backend (S3 + DynamoDB lock).
#
# DELIBERATELY COMMENTED so the stack validates offline with:
#
#     terraform init -backend=false && terraform validate
#
# To go live with remote state, you must FIRST create the bucket + lock table
# (one-time bootstrap — see infra/README.md "Step 2: Bootstrap remote state"),
# then uncomment this block, fill in the real bucket/table names, and run:
#
#     terraform init -migrate-state
#
# AU DATA RESIDENCY: the state bucket MUST live in ap-southeast-2. Terraform
# state can contain connection strings / resource metadata; treat it as
# Sydney-resident council-adjacent data. Block public access, enable
# versioning + SSE-KMS, and restrict the bucket policy to the deploy role.
# -----------------------------------------------------------------------------

# terraform {
#   backend "s3" {
#     bucket         = "ratesassist-tfstate-apse2" # must pre-exist, ap-southeast-2
#     key            = "ratesassist/prod/terraform.tfstate"
#     region         = "ap-southeast-2"
#     dynamodb_table = "ratesassist-tflock"        # must pre-exist, ap-southeast-2
#     encrypt        = true
#   }
# }
