# -----------------------------------------------------------------------------
# Root outputs — what the human needs after apply.
# -----------------------------------------------------------------------------

output "app_url" {
  description = "Public HTTPS URL the app is served on."
  value       = "https://${var.domain_name}"
}

output "alb_dns_name" {
  description = "ALB DNS name (the ALIAS target; useful for debugging before DNS propagates)."
  value       = module.alb.alb_dns_name
}

output "ecr_repository_url" {
  description = "ECR repository URL to tag/push the app image to."
  value       = module.ecr.repository_url
}

output "rds_endpoint" {
  description = "RDS PostgreSQL endpoint (host:port)."
  value       = module.database.endpoint
}

output "ecs_cluster_name" {
  description = "ECS cluster name (for aws ecs update-service)."
  value       = module.ecs.cluster_name
}

output "ecs_service_name" {
  description = "ECS service name (for force-new-deployment)."
  value       = module.ecs.service_name
}

output "cloudwatch_log_group" {
  description = "CloudWatch log group for app container logs."
  value       = module.observability.log_group_name
}

output "sns_alarm_topic_arn" {
  description = "SNS topic alarms publish to (subscribe PagerDuty/Slack here)."
  value       = module.observability.sns_topic_arn
}

output "secret_arns" {
  description = "Secrets Manager ARNs to populate before first deploy."
  value = {
    anthropic_api_key = module.secrets.anthropic_api_key_arn
    database_url      = module.secrets.database_url_arn
    ra_auth_secret    = module.secrets.ra_auth_secret_arn
  }
}

output "kms_key_arn" {
  description = "Project CMK ARN (secrets/RDS/logs/SNS)."
  value       = aws_kms_key.main.arn
}
