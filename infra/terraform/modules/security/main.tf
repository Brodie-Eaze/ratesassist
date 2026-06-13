# -----------------------------------------------------------------------------
# Security groups — deny by default, explicit allow per port + source.
#
#   internet  --443/80--> ALB
#   ALB       --app port-> ECS    (only the ALB SG may reach the app port)
#   ECS       --5432-----> RDS    (only the ECS SG may reach Postgres)
#
# Rules are split into standalone aws_security_group_rule resources so the
# ALB<->ECS and ECS<->RDS references don't form a creation cycle, and so each
# allow is a discrete, reviewable line in the plan.
# -----------------------------------------------------------------------------

# ---- ALB (public) -------------------------------------------------------------

resource "aws_security_group" "alb" {
  name_prefix = "${var.name_prefix}-alb-"
  description = "Public ALB: HTTPS/HTTP in from internet, app port out to ECS"
  vpc_id      = var.vpc_id

  tags = merge(var.tags, { Name = "${var.name_prefix}-alb-sg" })

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_security_group_rule" "alb_https_in" {
  description       = "HTTPS from internet"
  type              = "ingress"
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  cidr_blocks       = ["0.0.0.0/0"]
  ipv6_cidr_blocks  = ["::/0"]
  security_group_id = aws_security_group.alb.id
}

resource "aws_security_group_rule" "alb_http_in" {
  description       = "HTTP from internet (redirected to HTTPS at the listener)"
  type              = "ingress"
  from_port         = 80
  to_port           = 80
  protocol          = "tcp"
  cidr_blocks       = ["0.0.0.0/0"]
  ipv6_cidr_blocks  = ["::/0"]
  security_group_id = aws_security_group.alb.id
}

resource "aws_security_group_rule" "alb_to_ecs" {
  description              = "ALB forwards to ECS app port"
  type                     = "egress"
  from_port                = var.container_port
  to_port                  = var.container_port
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.ecs.id
  security_group_id        = aws_security_group.alb.id
}

# ---- ECS tasks (private) ------------------------------------------------------

resource "aws_security_group" "ecs" {
  name_prefix = "${var.name_prefix}-ecs-"
  description = "ECS tasks: app port in from ALB only, all egress out (NAT/VPCE)"
  vpc_id      = var.vpc_id

  tags = merge(var.tags, { Name = "${var.name_prefix}-ecs-sg" })

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_security_group_rule" "ecs_from_alb" {
  description              = "App port from the ALB only"
  type                     = "ingress"
  from_port                = var.container_port
  to_port                  = var.container_port
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.alb.id
  security_group_id        = aws_security_group.ecs.id
}

# Egress is required: NAT for the Anthropic API + image pulls and VPC endpoints
# for ECR/Secrets/Logs. Locking egress to specific CIDRs is impractical for a
# SaaS calling an external LLM, so allow all outbound from tasks.
resource "aws_security_group_rule" "ecs_egress_all" {
  description       = "All outbound (Anthropic API via NAT, ECR/Secrets/Logs via VPCE)"
  type              = "egress"
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.ecs.id
}

# ---- RDS (private) ------------------------------------------------------------

resource "aws_security_group" "rds" {
  name_prefix = "${var.name_prefix}-rds-"
  description = "RDS Postgres: 5432 in from ECS tasks only, no egress"
  vpc_id      = var.vpc_id

  tags = merge(var.tags, { Name = "${var.name_prefix}-rds-sg" })

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_security_group_rule" "rds_from_ecs" {
  description              = "Postgres from ECS tasks only"
  type                     = "ingress"
  from_port                = var.db_port
  to_port                  = var.db_port
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.ecs.id
  security_group_id        = aws_security_group.rds.id
}

# When an RDS Proxy shares the RDS security group, proxy and instance are both
# members of this SG; a self-referencing ingress lets the proxy reach the
# instance on 5432. ECS already reaches the proxy via rds_from_ecs above. Gated
# so it exists only when the proxy does.
resource "aws_security_group_rule" "rds_self_ingress" {
  count                    = var.enable_rds_proxy ? 1 : 0
  description              = "Postgres from the RDS Proxy sharing this SG (proxy to instance)"
  type                     = "ingress"
  from_port                = var.db_port
  to_port                  = var.db_port
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.rds.id
  security_group_id        = aws_security_group.rds.id
}
