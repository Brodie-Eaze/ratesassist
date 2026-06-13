# -----------------------------------------------------------------------------
# VPC endpoints — keep ECR / Secrets Manager / CloudWatch Logs / STS / S3
# traffic on the AWS backbone instead of routing out through NAT to the public
# internet. Lowers NAT data-processing cost and tightens the data path: pulling
# the container image and fetching runtime secrets never leaves the AWS network.
#
# The app still needs NAT for the Anthropic API (external), so this is an
# optimisation + hardening layer, not a full egress lockdown.
# -----------------------------------------------------------------------------

# Security group allowing HTTPS from inside the VPC to the interface endpoints.
resource "aws_security_group" "endpoints" {
  name_prefix = "${var.name_prefix}-vpce-"
  description = "HTTPS from VPC CIDR to interface VPC endpoints"
  vpc_id      = aws_vpc.this.id

  ingress {
    description = "HTTPS from within the VPC"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [aws_vpc.this.cidr_block]
  }

  egress {
    description = "Endpoint responses"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-vpce-sg" })

  lifecycle {
    create_before_destroy = true
  }
}

# Gateway endpoint for S3 (free; used by ECR layer storage).
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.this.id
  service_name      = "com.amazonaws.${data.aws_region.current.name}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = aws_route_table.private[*].id

  tags = merge(var.tags, { Name = "${var.name_prefix}-vpce-s3" })
}

# Interface endpoints (billed hourly + per-GB; worth it to keep secrets/image
# pulls off the public path).
locals {
  interface_endpoints = {
    ecr_api    = "ecr.api"
    ecr_dkr    = "ecr.dkr"
    secrets    = "secretsmanager"
    logs       = "logs"
    sts        = "sts"
    monitoring = "monitoring"
  }
}

resource "aws_vpc_endpoint" "interface" {
  for_each = local.interface_endpoints

  vpc_id              = aws_vpc.this.id
  service_name        = "com.amazonaws.${data.aws_region.current.name}.${each.value}"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.private[*].id
  security_group_ids  = [aws_security_group.endpoints.id]
  private_dns_enabled = true

  tags = merge(var.tags, { Name = "${var.name_prefix}-vpce-${each.key}" })
}

data "aws_region" "current" {}
