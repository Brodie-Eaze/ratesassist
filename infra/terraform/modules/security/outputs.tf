output "alb_sg_id" {
  description = "Security group ID for the public ALB."
  value       = aws_security_group.alb.id
}

output "ecs_sg_id" {
  description = "Security group ID for ECS tasks."
  value       = aws_security_group.ecs.id
}

output "rds_sg_id" {
  description = "Security group ID for the RDS instance."
  value       = aws_security_group.rds.id
}
