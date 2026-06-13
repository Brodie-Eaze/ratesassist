# -----------------------------------------------------------------------------
# ECR repository for the app image.
#
#   - IMMUTABLE tags: a given tag (a git SHA) can be pushed exactly once, so a
#     deployed digest can never be silently overwritten. The pipeline tags with
#     the commit SHA; do NOT rely on a moving ":latest".
#   - scan_on_push: Trivy/Inspector-style CVE scan on every push.
#   - encryption: KMS (AWS-managed key for ECR by default).
#   - lifecycle policy: expire untagged layers and cap retained images so the
#     repo doesn't grow (and bill) unbounded.
# -----------------------------------------------------------------------------

resource "aws_ecr_repository" "this" {
  name                 = var.name
  image_tag_mutability = "IMMUTABLE"
  force_delete         = false

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "KMS"
  }

  tags = var.tags
}

resource "aws_ecr_lifecycle_policy" "this" {
  repository = aws_ecr_repository.this.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images after 7 days"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 7
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep only the 30 most recent tagged images"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["v", "sha-", "main-"]
          countType     = "imageCountMoreThan"
          countNumber   = 30
        }
        action = { type = "expire" }
      }
    ]
  })
}
