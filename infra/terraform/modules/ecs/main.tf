# -----------------------------------------------------------------------------
# ECS module — Fargate cluster + service + task definition.
#
#   - Next.js standalone server runs in PRIVATE subnets (no public IP).
#   - secrets injected at runtime via the task definition `secrets` block
#     (ARNs -> env var names); they are NEVER baked into the image.
#   - container health check curls /api/health so a wedged process is replaced
#     even before the ALB notices.
#   - target-tracking autoscaling on CPU between autoscale_min/max.
# -----------------------------------------------------------------------------

resource "aws_ecs_cluster" "this" {
  name = "${var.name_prefix}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = var.tags
}

resource "aws_ecs_cluster_capacity_providers" "this" {
  cluster_name       = aws_ecs_cluster.this.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
    base              = 1
  }
}

locals {
  container_name = "${var.name_prefix}-web"
}

resource "aws_ecs_task_definition" "this" {
  family                   = "${var.name_prefix}-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name      = local.container_name
      image     = var.image
      essential = true

      portMappings = [
        {
          containerPort = var.container_port
          protocol      = "tcp"
        }
      ]

      # Non-secret runtime config (matches the Vercel env + the values the app
      # reads from process.env).
      environment = [
        { name = "NODE_ENV", value = var.node_env },
        { name = "PORT", value = tostring(var.container_port) },
        { name = "HOSTNAME", value = "0.0.0.0" },
        { name = "RA_TOOL_TRANSPORT", value = var.ra_tool_transport },
        { name = "RA_USE_DB", value = var.ra_use_db },
        # Behind the ALB the real client IP is in X-Forwarded-For; tell the
        # rate limiter to trust the proxy (apps/web/lib/rate-limit.ts).
        { name = "RA_TRUSTED_PROXY", value = "1" },
      ]

      # Secrets fetched by the execution role at task start and injected as env
      # vars — never present in the image or in plaintext config.
      secrets = [
        { name = "ANTHROPIC_API_KEY", valueFrom = var.anthropic_api_key_secret_arn },
        { name = "DATABASE_URL", valueFrom = var.database_url_secret_arn },
        { name = "RA_AUTH_SECRET", valueFrom = var.ra_auth_secret_arn },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = var.log_group_name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "web"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:${var.container_port}/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 30
      }
    }
  ])

  tags = var.tags
}

resource "aws_ecs_service" "this" {
  name            = "${var.name_prefix}-web"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.this.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  # Rolling deploy with a circuit breaker that auto-rolls-back a bad release.
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = var.target_group_arn
    container_name   = local.container_name
    container_port   = var.container_port
  }

  health_check_grace_period_seconds = 60
  enable_execute_command            = var.enable_execute_command
  propagate_tags                    = "SERVICE"

  tags = var.tags

  # The CI pipeline updates the running task via `aws ecs update-service
  # --force-new-deployment` against a new image tag. Ignore task_definition and
  # desired_count drift so Terraform and the deploy pipeline don't fight; image
  # rollouts are the pipeline's job, infra shape is Terraform's.
  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }
}

# ---- Application Auto Scaling (target tracking on CPU) ------------------------

resource "aws_appautoscaling_target" "ecs" {
  max_capacity       = var.autoscale_max
  min_capacity       = var.autoscale_min
  resource_id        = "service/${aws_ecs_cluster.this.name}/${aws_ecs_service.this.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "cpu" {
  name               = "${var.name_prefix}-cpu-target-tracking"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.ecs.resource_id
  scalable_dimension = aws_appautoscaling_target.ecs.scalable_dimension
  service_namespace  = aws_appautoscaling_target.ecs.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = var.autoscale_cpu_target
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}

# Second target-tracking policy: scale on ALB requests-per-target. CPU alone
# lags a burst of cheap-but-numerous requests (officer dashboards refreshing,
# chat polling); request count reacts to traffic shape directly. ECS scales on
# the MAX of all attached policies, so this only ever scales OUT faster — it
# never fights the CPU policy. Enabled only when a target + resource label are
# supplied; otherwise the service stays CPU-only (count = 0).
resource "aws_appautoscaling_policy" "requests" {
  count = var.autoscale_requests_target > 0 && var.alb_resource_label != "" ? 1 : 0

  name               = "${var.name_prefix}-requests-target-tracking"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.ecs.resource_id
  scalable_dimension = aws_appautoscaling_target.ecs.scalable_dimension
  service_namespace  = aws_appautoscaling_target.ecs.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ALBRequestCountPerTarget"
      resource_label         = var.alb_resource_label
    }
    target_value       = var.autoscale_requests_target
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}
